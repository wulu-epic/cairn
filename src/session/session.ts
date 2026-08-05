/**
 * Session Manager — keeps a browser alive across CLI invocations.
 *
 * Delegates to a pluggable BrowserBackend:
 * - LocalChromeBackend: detached headless Chrome on 127.0.0.1:9222 (MVP/dev)
 * - SteelBackend: self-hosted Steel Browser for session mgmt + anti-detect + proxy
 *
 * The backend is selected at construction time from AppConfig. If Steel is
 * requested but unreachable, we fall back to local Chrome so the CLI never
 * hard-fails just because the Steel container is down.
 */

import type { Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { LocalChromeBackend } from './backend.js';
import type { BrowserBackend, BrowserConnection } from './backend.js';
import { SteelBackend } from './steel.js';
import type { AppConfig } from '../config.js';

const SESSION_DIR = '.sessions';

export interface SessionState {
  sessionId: string;
  cdpPort: number;
  currentUrl: string;
  focusedRegion: string | null;
  createdAt: number;
  /** Steel session ID — reused across CLI calls to keep the same browser. */
  steelSessionId?: string;
  /** Which backend was used last (for status display). */
  backendType?: 'local' | 'steel';
}

export type { BrowserConnection };

export class SessionManager {
  private sessionId: string;
  private stateFile: string;
  private config: AppConfig;
  private backend: BrowserBackend | null = null;

  constructor(sessionId: string = 'default', config: AppConfig) {
    this.sessionId = sessionId;
    this.config = config;
    this.stateFile = path.join(SESSION_DIR, `${sessionId}.json`);
  }

  /** Select and instantiate the appropriate backend. */
  private createBackend(): BrowserBackend {
    if (this.config.useSteel) {
      const steel = new SteelBackend(this.config);
      // Restore saved Steel session ID so we reuse the same browser
      const saved = this.loadState();
      if (saved?.steelSessionId) {
        steel.setSessionId(saved.steelSessionId);
      }
      return steel;
    }
    return new LocalChromeBackend();
  }

  /** Ensure a browser is running and return a connected Browser. */
  async connect(): Promise<BrowserConnection> {
    this.backend = this.createBackend();

    // If Steel is requested, try it — but fall back to local Chrome on failure
    // so the CLI stays usable even if the Steel container is down.
    if (this.config.useSteel) {
      try {
        const conn = await this.backend.connect();
        this.saveState({ steelSessionId: conn.steelSessionId, backendType: 'steel' });
        return conn;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[session] Steel backend failed: ${msg}\n`);
        process.stderr.write('[session] falling back to local Chrome\n');
        this.backend = new LocalChromeBackend();
      }
    }

    // Health-check before reuse: if we have a saved session (a previously
    // launched Chrome), check that it's still alive. A dead detached Chrome
    // (crashed, OOM-killed, manually closed) would otherwise cause an opaque
    // failure on the next command. healthCheck() + connect() handle the
    // relaunch transparently inside the backend.
    const saved = this.loadState();
    if (saved && this.backend.name === 'local') {
      const alive = await this.backend.healthCheck();
      if (!alive) {
        process.stderr.write('[session] previous Chrome session is dead, will relaunch\n');
      }
    }

    const conn = await this.backend.connect();
    this.saveState({ backendType: conn.backendType });
    return conn;
  }

  /** Get the current page (or create one). */
  async getPage(browser: Browser): Promise<Page> {
    if (!this.backend) throw new Error('Not connected — call connect() first');
    return this.backend.getPage(browser);
  }

  /** Release the backend session entirely (Steel: POST /release; local: no-op). */
  async release(): Promise<void> {
    if (this.backend?.release) {
      await this.backend.release();
    }
    // Clear saved Steel session ID so next connect creates a fresh session
    this.saveState({ steelSessionId: undefined });
  }

  /** Save session state to disk. */
  saveState(state: Partial<SessionState>): void {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
    const existing = this.loadState() || {
      sessionId: this.sessionId,
      cdpPort: 9222,
      currentUrl: '',
      focusedRegion: null,
      createdAt: Date.now(),
    };
    const merged: SessionState = { ...existing, ...state, sessionId: this.sessionId };
    // Don't persist undefined values
    if (merged.steelSessionId === undefined) delete merged.steelSessionId;
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

  // ─── Storage State (cookies + localStorage + sessionStorage) ────

  /** Path to the storage state file for this session. */
  get storageStateFile(): string {
    return path.join(SESSION_DIR, `${this.sessionId}.storage.json`);
  }

  /** Check if a saved storage state exists for this session. */
  hasStorageState(): boolean {
    return fs.existsSync(this.storageStateFile);
  }

  /**
   * Save the current browser storage state (cookies + localStorage) to disk.
   * Enables persisting auth sessions across release/reconnect.
   */
  async saveStorageState(page: Page): Promise<{ success: boolean; message: string }> {
    try {
      const context = page.context();
      const state = await context.storageState();

      if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
      }
      fs.writeFileSync(this.storageStateFile, JSON.stringify(state, null, 2));

      const cookieCount = state.cookies.length;
      const originCount = state.origins.length;
      return {
        success: true,
        message: `saved ${cookieCount} cookie(s) + localStorage from ${originCount} origin(s)`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, message: `failed to save storage state: ${msg}` };
    }
  }

  /**
   * Restore storage state from disk (cookies + localStorage).
   * Call after connecting to persist auth sessions across reconnects.
   */
  async restoreStorageState(page: Page): Promise<{ success: boolean; message: string }> {
    if (!fs.existsSync(this.storageStateFile)) {
      return { success: false, message: 'no saved storage state for this session' };
    }

    try {
      const state = JSON.parse(fs.readFileSync(this.storageStateFile, 'utf8'));
      const context = page.context();

      // Restore cookies
      if (state.cookies && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
      }

      // Restore localStorage for each origin
      let lsCount = 0;
      if (state.origins) {
        for (const origin of state.origins) {
          if (origin.localStorage && origin.localStorage.length > 0) {
            // Navigate to the origin and set localStorage items
            try {
              await page.goto(origin.origin, { waitUntil: 'domcontentloaded', timeout: 10000 });
              await page.evaluate((items: { name: string; value: string }[]) => {
                for (const item of items) {
                  localStorage.setItem(item.name, item.value);
                }
              }, origin.localStorage);
              lsCount += origin.localStorage.length;
            } catch {
              // Origin may be unreachable — skip silently
            }
          }
        }
      }

      const cookieCount = state.cookies?.length ?? 0;
      return {
        success: true,
        message: `restored ${cookieCount} cookie(s) + ${lsCount} localStorage item(s)`,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, message: `failed to restore storage state: ${msg}` };
    }
  }

  /**
   * Clear all cookies and storage state (localStorage + sessionStorage) for the
   * current page. Also removes the saved storage state file.
   */
  async clearStorageState(page: Page): Promise<{ success: boolean; message: string }> {
    try {
      const context = page.context();
      await context.clearCookies();

      // Clear localStorage and sessionStorage on the current page
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

      // Remove the saved storage state file
      if (fs.existsSync(this.storageStateFile)) {
        fs.unlinkSync(this.storageStateFile);
      }

      return { success: true, message: 'cleared all cookies + localStorage + sessionStorage' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, message: `failed to clear storage state: ${msg}` };
    }
  }

  /**
   * Get the current cookies for display (cairn cookies list).
   * Returns an array of { name, value, domain, path }.
   */
  async getCookies(page: Page): Promise<{ name: string; value: string; domain: string; path: string }[]> {
    const context = page.context();
    const cookies = await context.cookies();
    return cookies.map((c) => ({
      name: c.name,
      value: c.value.slice(0, 50), // truncate long values for display
      domain: c.domain,
      path: c.path,
    }));
  }

  /** Clean up the browser connection without killing the persistent browser. */
  async disconnect(connection: BrowserConnection): Promise<void> {
    if (this.backend) {
      await this.backend.disconnect(connection);
    }
  }

  /** Get the backend name for status display. */
  get backendName(): string {
    return this.backend?.name ?? 'none';
  }
}
