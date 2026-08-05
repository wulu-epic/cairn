/**
 * Browser Backend Abstraction — makes SessionManager backend-agnostic.
 *
 * The tool can drive Chrome in two ways:
 * 1. **Local Chrome** (LocalChromeBackend): launch a detached headless Chrome
 *    on 127.0.0.1:9222 and connect via CDP. Used for MVP/dev with no Docker.
 * 2. **Steel Browser** (SteelBackend): talk to a self-hosted Steel Browser API
 *    (REST on :3000, CDP proxy on :9223) for session management, anti-detect
 *    (fingerprint injection), and proxy rotation. Used for production/scaling.
 *
 * Everything downstream (page-model, renderer, actions, intent) operates on a
 * Playwright `Page` object and is completely backend-agnostic — the backend's
 * only job is to produce a connected `Browser` and tear it down cleanly.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const SESSION_DIR = '.sessions';
const DEFAULT_PORT = 9222;

export interface BrowserConnection {
  browser: Browser;
  /** Whether we connected via CDP (persistent) or launched ephemeral. */
  viaCDP: boolean;
  /** Which backend produced this connection. */
  backendType: 'local' | 'steel';
  /** For Steel: the session ID assigned by the Steel API. */
  steelSessionId?: string;
}

/**
 * A browser backend produces a connected `Browser` and tears it down.
 * The `release` method is optional (Steel sessions are explicitly released;
 * local Chrome just disconnects the WebSocket).
 */
export interface BrowserBackend {
  /** Ensure a browser is running and return a connected Browser. */
  connect(): Promise<BrowserConnection>;
  /** Get the current page (or create one) from a connected browser. */
  getPage(browser: Browser): Promise<Page>;
  /** Disconnect without necessarily killing the browser. */
  disconnect(conn: BrowserConnection): Promise<void>;
  /** Release the backend session entirely (e.g. Steel POST /release). */
  release?(): Promise<void>;
  /**
   * Check if the backend's browser is alive and reachable.
   * Used by SessionManager to detect a dead Chrome before reuse and
   * relaunch transparently instead of failing opaquely.
   */
  healthCheck(): Promise<boolean>;
  /** Human-readable backend name for status output. */
  readonly name: string;
}

// ─── Helpers shared by backends ──────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if a CDP endpoint is responding on the given port (from localhost). */
export async function isCdpAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => resolve(data.length > 0));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Launch Chrome as a detached background process with CDP enabled. */
async function launchChromeDetached(port: number): Promise<void> {
  const execPath = chromium.executablePath();
  const userDataDir = path.resolve(SESSION_DIR, 'chrome-data');

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const chromeArgs = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];

  const child = spawn(execPath, chromeArgs, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await isCdpAvailable(port)) return;
  }
  throw new Error(`Chrome failed to start on port ${port} within 15 seconds`);
}

// ─── LocalChromeBackend ──────────────────────────────────────────────

/**
 * Local Chrome backend — launches a detached headless Chrome with CDP on
 * 127.0.0.1:9222 and connects via Playwright connectOverCDP. The browser
 * stays alive across CLI invocations (detached process). Falls back to
 * chromium.launch() if CDP connection fails.
 */
export class LocalChromeBackend implements BrowserBackend {
  readonly name = 'local';
  private port: number;

  constructor(port: number = DEFAULT_PORT) {
    this.port = port;
  }

  /** Check if the CDP endpoint is responding (Chrome is alive). */
  async healthCheck(): Promise<boolean> {
    return isCdpAvailable(this.port);
  }

  async connect(): Promise<BrowserConnection> {
    // Health-check the CDP endpoint before reuse. If Chrome is dead (crashed,
    // OOM-killed, or never started), relaunch transparently instead of failing
    // opaquely on the next command.
    if (!(await isCdpAvailable(this.port))) {
      process.stderr.write(`[session] Chrome not reachable on port ${this.port}, starting...\n`);
      await launchChromeDetached(this.port);
    }

    // Try connectOverCDP with one retry — the CDP socket can fail on a
    // transiently-unresponsive Chrome (GC pause, high CPU). If retry also
    // fails, fall back to an ephemeral chromium.launch().
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
        return { browser, viaCDP: true, backendType: 'local' };
      } catch (e) {
        if (attempt === 0) {
          process.stderr.write('[session] connectOverCDP failed, retrying in 1s...\n');
          await sleep(1000);
          // Chrome may have died between the health check and the connect attempt
          if (!(await isCdpAvailable(this.port))) {
            process.stderr.write('[session] Chrome died mid-connect, relaunching...\n');
            await launchChromeDetached(this.port);
          }
          continue;
        }
        process.stderr.write('[session] connectOverCDP failed after retry, falling back to chromium.launch()\n');
        const browser = await chromium.launch({ headless: true });
        return { browser, viaCDP: false, backendType: 'local' };
      }
    }
    // Unreachable — the loop always returns or throws. TypeScript needs this.
    throw new Error('connect failed unexpectedly');
  }

  async getPage(browser: Browser): Promise<Page> {
    const context = browser.contexts()[0] || (await browser.newContext());
    const pages = context.pages();
    return pages[0] || (await context.newPage());
  }

  async disconnect(conn: BrowserConnection): Promise<void> {
    if (conn.viaCDP) {
      // For connectOverCDP: do NOT call browser.close() — that would kill Chrome.
      // The WebSocket disconnects naturally when the process exits.
    } else {
      // For chromium.launch(): close the ephemeral browser.
      try {
        await conn.browser.close();
      } catch {
        // ignore
      }
    }
  }
}
