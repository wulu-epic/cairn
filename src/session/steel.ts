/**
 * Steel Browser Backend — self-hosted Steel Browser (Apache-2.0, free).
 *
 * Steel provides a REST API for browser session management + a CDP websocket
 * proxy. This backend talks to the Steel API to create/reuse sessions, then
 * connects Playwright via connectOverCDP using the session's websocketUrl.
 *
 * API endpoints (all under /v1):
 *   GET  /v1/health              — health check
 *   POST /v1/sessions            — create session → SessionDetails
 *   GET  /v1/sessions/:id        — get session details
 *   POST /v1/sessions/:id/release — release a session
 *
 * Anti-detect: Steel injects fingerprints by default (fingerprint-generator +
 * injector). Set skipFingerprintInjection to disable. Custom userAgent and
 * deviceConfig further customize the browser identity.
 *
 * Proxy rotation: pass a proxyUrl per session (http://user:pass@host:port or
 * socks5://host:port). Steel uses proxy-chain internally — auth is embedded
 * in the URL.
 *
 * Self-hosted Steel has NO auth by default. If STEEL_API_KEY is set, it's
 * passed as the `steel-api-key` header (the convention Steel's SDK uses).
 *
 * GOTCHA: Steel returns a context with a page ALREADY OPEN — reuse
 * browser.contexts()[0].pages()[0] instead of creating a new context/page.
 */

import { chromium, type Browser, type Page } from 'playwright';
import type { BrowserBackend, BrowserConnection } from './backend.js';
import type { AppConfig } from '../config.js';

/** Steel session status enum. */
type SteelSessionStatus = 'idle' | 'live' | 'released' | 'failed';

/** SessionDetails response from POST /v1/sessions. */
interface SteelSession {
  id: string;
  status: SteelSessionStatus;
  /** CDP websocket endpoint — pass directly to chromium.connectOverCDP. */
  websocketUrl: string;
  debugUrl?: string;
  debuggerUrl?: string;
  sessionViewerUrl?: string;
  userAgent?: string;
  proxy?: string;
  createdAt?: string;
  duration?: number;
}

/** CreateSession request body. */
interface CreateSessionBody {
  sessionId?: string;
  proxyUrl?: string;
  userAgent?: string;
  skipFingerprintInjection?: boolean;
  headless?: boolean;
  blockAds?: boolean;
  deviceConfig?: { device: 'desktop' | 'mobile' };
  dimensions?: { width: number; height: number };
  timeout?: number;
}

export class SteelBackend implements BrowserBackend {
  readonly name = 'steel';
  private config: AppConfig;
  private sessionId: string | null = null;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /** Set a specific Steel session ID to reuse (from saved state). */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  /** Get the current Steel session ID (if connected). */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Check if the Steel API is reachable and healthy. */
  async isHealthy(): Promise<boolean> {
    try {
      const resp = await fetch(`${this.config.steelApiUrl}/v1/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.steelApiKey) {
      h['steel-api-key'] = this.config.steelApiKey;
    }
    return h;
  }

  /** Create a new Steel browser session via POST /v1/sessions. */
  async createSession(): Promise<SteelSession> {
    const body: CreateSessionBody = {
      headless: this.config.headless,
    };

    if (this.config.proxyUrl) {
      body.proxyUrl = this.config.proxyUrl;
    }
    if (this.config.userAgent) {
      body.userAgent = this.config.userAgent;
    }
    if (this.config.timeout > 0) {
      body.timeout = this.config.timeout;
    }

    // If we have a saved session ID, try to reuse it by checking if it's still live
    if (this.sessionId) {
      const existing = await this.getSession(this.sessionId);
      if (existing && (existing.status === 'live' || existing.status === 'idle')) {
        return existing;
      }
      // Session is gone/released — create a new one
    }

    const resp = await fetch(`${this.config.steelApiUrl}/v1/sessions`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown error');
      throw new Error(`Steel createSession failed (${resp.status}): ${text}`);
    }

    const session = (await resp.json()) as SteelSession;
    this.sessionId = session.id;
    return session;
  }

  /** Get details of an existing Steel session. */
  async getSession(id: string): Promise<SteelSession | null> {
    try {
      const resp = await fetch(`${this.config.steelApiUrl}/v1/sessions/${id}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;
      return (await resp.json()) as SteelSession;
    } catch {
      return null;
    }
  }

  /** Release a Steel session (frees the browser process). */
  async release(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(`${this.config.steelApiUrl}/v1/sessions/${this.sessionId}/release`, {
        method: 'POST',
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // best-effort — session may already be gone
    }
    this.sessionId = null;
  }

  async connect(): Promise<BrowserConnection> {
    if (!(await this.isHealthy())) {
      throw new Error(`Steel API not reachable at ${this.config.steelApiUrl}. Is the Steel container running? (docker compose up)`);
    }

    const session = await this.createSession();
    process.stderr.write(`[session] Steel session ${session.id} (${session.status})\n`);

    // Connect Playwright to the Steel session's CDP websocket.
    // Self-hosted Steel has no auth — use websocketUrl directly.
    const browser = await chromium.connectOverCDP(session.websocketUrl);
    return {
      browser,
      viaCDP: true,
      backendType: 'steel',
      steelSessionId: session.id,
    };
  }

  async getPage(browser: Browser): Promise<Page> {
    // Steel returns a context with a page ALREADY OPEN — reuse it.
    const contexts = browser.contexts();
    const context = contexts[0] || (await browser.newContext());
    const pages = context.pages();
    return pages[0] || (await context.newPage());
  }

  async disconnect(conn: BrowserConnection): Promise<void> {
    // For Steel: just disconnect the CDP websocket. The Steel-managed Chrome
    // stays alive (the session persists). Call release() to tear it down.
    // Do NOT call browser.close() — that would kill the Steel-managed Chrome.
    // The WebSocket disconnects naturally when the process exits.
  }
}
