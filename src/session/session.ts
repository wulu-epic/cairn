/**
 * Session Manager — keeps a Chrome browser alive across CLI invocations.
 *
 * Strategy: launch Chrome as a detached background process with --remote-debugging-port,
 * then connect via Playwright's connectOverCDP on each CLI call. The browser stays
 * alive between commands because it's a detached process — the CLI just disconnects
 * the WebSocket without closing Chrome.
 *
 * Fallback: if connectOverCDP fails (e.g. Chrome didn't start), use chromium.launch()
 * (non-persistent — browser closes when the CLI exits, but session state file persists).
 */

import { chromium, type Browser, type Page } from 'playwright';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const SESSION_DIR = '.sessions';
const DEFAULT_PORT = 9222;

export interface SessionState {
  sessionId: string;
  cdpPort: number;
  currentUrl: string;
  focusedRegion: string | null;
  createdAt: number;
}

export interface BrowserConnection {
  browser: Browser;
  viaCDP: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Check if a CDP endpoint is responding on the given port (from localhost — passes Chrome 111+ source-IP check). */
async function isCdpAvailable(port: number): Promise<boolean> {
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

/** Launch Chrome as a detached background process with CDP enabled on 127.0.0.1. */
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

  // Wait for CDP endpoint to be ready
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await isCdpAvailable(port)) return;
  }
  throw new Error(`Chrome failed to start on port ${port} within 15 seconds`);
}

export class SessionManager {
  private sessionId: string;
  private stateFile: string;
  private port: number;

  constructor(sessionId: string = 'default', port: number = DEFAULT_PORT) {
    this.sessionId = sessionId;
    this.port = port;
    this.stateFile = path.join(SESSION_DIR, `${sessionId}.json`);
  }

  /** Ensure Chrome is running and return a connected Browser. */
  async connect(): Promise<BrowserConnection> {
    if (!(await isCdpAvailable(this.port))) {
      process.stderr.write(`[session] starting Chrome on port ${this.port}...\n`);
      await launchChromeDetached(this.port);
    }

    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
      return { browser, viaCDP: true };
    } catch {
      process.stderr.write('[session] connectOverCDP failed, falling back to chromium.launch()\n');
      const browser = await chromium.launch({ headless: true });
      return { browser, viaCDP: false };
    }
  }

  /** Get the current page (or create one). */
  async getPage(browser: Browser): Promise<Page> {
    const context = browser.contexts()[0] || (await browser.newContext());
    const pages = context.pages();
    return pages[0] || (await context.newPage());
  }

  /** Save session state to disk. */
  saveState(state: Partial<SessionState>): void {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    const existing = this.loadState() || {
      sessionId: this.sessionId,
      cdpPort: this.port,
      currentUrl: '',
      focusedRegion: null,
      createdAt: Date.now(),
    };
    const merged: SessionState = { ...existing, ...state, sessionId: this.sessionId };
    fs.writeFileSync(this.stateFile, JSON.stringify(merged, null, 2));
  }

  /** Load session state from disk. */
  loadState(): SessionState | null {
    if (!fs.existsSync(this.stateFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Clean up the browser connection without killing the persistent Chrome process. */
  async disconnect(connection: BrowserConnection): Promise<void> {
    if (connection.viaCDP) {
      // For connectOverCDP: do NOT call browser.close() — that would kill Chrome.
      // The WebSocket disconnects naturally when the process exits.
    } else {
      // For chromium.launch(): close the ephemeral browser.
      try {
        await connection.browser.close();
      } catch {
        // ignore
      }
    }
  }
}
