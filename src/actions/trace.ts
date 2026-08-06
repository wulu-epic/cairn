/**
 * Action Trace — lightweight, LLM-consumable side-effect capture.
 *
 * Distinct from Playwright's context.tracing (which produces a heavy trace.zip
 * for the Trace Viewer GUI). This is the opposite: opt-in, text-only,
 * structured for an LLM to consume inline. It answers "I clicked Submit and
 * nothing visible happened — why?" by decoding the non-DOM side effects
 * (failed XHRs, console errors, JS exceptions, redirect chains) that the
 * DOM delta can't see.
 *
 * Design:
 * - Capture: page.on('request'/'response'/'console'/'pageerror'/'framenavigated')
 * - Filter: drop static assets (keep only xhr/fetch/document), dedupe same-URL
 *   retries (last wins), cap at ~10 entries, group failures to top, truncate
 *   long strings.
 * - Decode: the "← likely culprit" heuristic marks the first failed request
 *   — or, if none, the first uncaught JS error — turning a dump into a
 *   diagnosis.
 *
 * Usage: a --trace flag on existing actions (goto "...", click <ref>) scopes
 * capture to exactly that action's window. Never on by default — it'd bloat
 * every action's output.
 */

import type { Page, Request, Response, ConsoleMessage, Frame } from 'playwright';

// ─── Event types (canned input for the pure decoder) ──────────────

export interface NetworkEvent {
  method: string;
  url: string;
  /** Playwright resourceType: 'xhr', 'fetch', 'document', 'stylesheet', 'image', ... */
  resourceType: string;
  /** HTTP status (undefined for requests that got no response — blocked/aborted). */
  status?: number;
  statusText?: string;
}

export interface ConsoleEvent {
  /** Playwright console type: 'log', 'warning', 'error', 'info', 'debug'. */
  type: string;
  text: string;
}

export interface ErrorEvent {
  message: string;
}

export interface NavigationEvent {
  url: string;
}

export interface TraceEvents {
  network: NetworkEvent[];
  console: ConsoleEvent[];
  errors: ErrorEvent[];
  navigations: NavigationEvent[];
}

export interface DecodeOptions {
  /** Max network entries to show (rest summarized as "+N more"). Default 10. */
  maxNetwork?: number;
  /** Max console entries to show. Default 5. */
  maxConsole?: number;
  /** Max chars of a string before truncation. Default 120. */
  maxTextLength?: number;
}

const DEFAULTS: Required<DecodeOptions> = {
  maxNetwork: 10,
  maxConsole: 5,
  maxTextLength: 120,
};

// Resource types to KEEP (everything else is a static asset we drop).
const KEPT_RESOURCE_TYPES = new Set([
  'xhr', 'fetch', 'document', 'websocket', 'manifest', 'other',
]);

// ─── Pure decoder ──────────────────────────────────────────────────

/** True if the request failed (4xx/5xx or no response at all). */
function isFailed(n: NetworkEvent): boolean {
  return n.status === undefined || n.status >= 400;
}

/** Extract the path (no origin) from a URL, truncated for compactness. */
function urlToPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + u.search;
    if (path.length > 80) return path.slice(0, 77) + '...';
    return path || '/';
  } catch {
    return url.length > 80 ? url.slice(0, 77) + '...' : url;
  }
}

/** Truncate a string to maxLen, appending "..." if cut. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

/**
 * Pure decoder: takes canned TraceEvents + duration, returns the compact
 * text digest. Unit-testable with no Playwright/browser dependency.
 *
 * Output format:
 *   ── trace (0.8s) ──
 *   network (4 reqs, 1 failed):
 *     POST /api/login → 200
 *     POST /api/analytics → 500 internal server error ← likely culprit
 *   console (2):
 *     [warn] submitButton.onclick deprecated
 *   errors (0)
 */
export function decodeTrace(
  events: TraceEvents,
  durationMs: number,
  opts: DecodeOptions = {},
): string {
  const o = { ...DEFAULTS, ...opts };
  const lines: string[] = [];
  const secs = (durationMs / 1000).toFixed(1);
  lines.push(`── trace (${secs}s) ──`);

  // ── Network: filter static assets, dedupe (last wins), group failures to top ──
  const deduped = new Map<string, NetworkEvent>();
  for (const ev of events.network) {
    if (!KEPT_RESOURCE_TYPES.has(ev.resourceType)) continue;
    deduped.set(`${ev.method} ${ev.url}`, ev);
  }
  const all = [...deduped.values()];
  const failed = all.filter(isFailed);
  const ok = all.filter((n) => !isFailed(n));
  const ordered = [...failed, ...ok];
  const total = ordered.length;

  lines.push(
    `network (${total} req${total === 1 ? '' : 's'}${failed.length > 0 ? `, ${failed.length} failed` : ''}):`,
  );
  if (total === 0) {
    lines.push('  (none)');
  } else {
    const shown = ordered.slice(0, o.maxNetwork);
    for (let i = 0; i < shown.length; i++) {
      const n = shown[i];
      const path = urlToPath(n.url);
      const status =
        n.status !== undefined
          ? `${n.status}${n.statusText ? ` ${n.statusText}` : ''}`
          : 'blocked';
      // Only failed entries at the top of the ordered list get the culprit marker.
      const culprit = i < failed.length ? ' ← likely culprit' : '';
      lines.push(`  ${n.method} ${path} → ${status}${culprit}`);
    }
    const more = total - shown.length;
    if (more > 0) lines.push(`  … +${more} more`);
  }

  // ── Console ──
  const con = events.console;
  lines.push(`console (${con.length}):`);
  if (con.length === 0) {
    lines.push('  (none)');
  } else {
    const shown = con.slice(0, o.maxConsole);
    for (const c of shown) {
      const tag = c.type === 'warning' ? 'warn' : c.type;
      lines.push(`  [${tag}] ${truncate(c.text, o.maxTextLength)}`);
    }
    const more = con.length - shown.length;
    if (more > 0) lines.push(`  … +${more} more`);
  }

  // ── Errors (uncaught JS exceptions via pageerror) ──
  const errs = events.errors;
  lines.push(`errors (${errs.length})`);
  if (errs.length > 0) {
    const shown = errs.slice(0, 3);
    for (let i = 0; i < shown.length; i++) {
      // If no failed network request, the first JS error is the likely culprit.
      const culprit = failed.length === 0 && i === 0 ? ' ← likely culprit' : '';
      lines.push(`  ${truncate(shown[i].message, o.maxTextLength)}${culprit}`);
    }
    const more = errs.length - shown.length;
    if (more > 0) lines.push(`  … +${more} more`);
  }

  return lines.join('\n');
}

// ─── Collector (wraps a Playwright Page) ───────────────────────────

/**
 * Attaches Playwright page event listeners for the action's duration,
 * collects side-effect events, then decodes them into a compact digest.
 *
 * Usage:
 *   const tc = new TraceCollector(page);
 *   tc.start();
 *   ... action ...
 *   const digest = decodeTrace(tc.stop(), tc.durationMs);
 */
export class TraceCollector {
  private network: NetworkEvent[] = [];
  private consoleEvents: ConsoleEvent[] = [];
  private errors: ErrorEvent[] = [];
  private navigations: NavigationEvent[] = [];
  private startTime = 0;
  private _durationMs = 0;
  private active = false;

  constructor(private page: Page) {}

  start(): void {
    this.active = true;
    this.startTime = Date.now();
    this.page.on('request', this.onRequest);
    this.page.on('response', this.onResponse);
    this.page.on('console', this.onConsole);
    this.page.on('pageerror', this.onPageError);
    this.page.on('framenavigated', this.onFrameNavigated);
  }

  stop(): TraceEvents {
    this._durationMs = Date.now() - this.startTime;
    this.active = false;
    this.page.off('request', this.onRequest);
    this.page.off('response', this.onResponse);
    this.page.off('console', this.onConsole);
    this.page.off('pageerror', this.onPageError);
    this.page.off('framenavigated', this.onFrameNavigated);
    return {
      network: this.network,
      console: this.consoleEvents,
      errors: this.errors,
      navigations: this.navigations,
    };
  }

  get durationMs(): number {
    return this._durationMs;
  }

  /**
   * Convenience: start, run an action, stop, and return the decoded digest.
   * The digest is returned even if the action throws (the throw is re-raised
   * after the digest is computed, so the caller can print + rethrow).
   */
  static async capture(
    page: Page,
    action: () => Promise<void>,
    opts?: DecodeOptions,
  ): Promise<string> {
    const tc = new TraceCollector(page);
    tc.start();
    let threw = false;
    let thrownErr: unknown;
    try {
      await action();
    } catch (e) {
      threw = true;
      thrownErr = e;
    }
    const events = tc.stop();
    const digest = decodeTrace(events, tc.durationMs, opts);
    if (threw) throw thrownErr;
    return digest;
  }

  // ─── Bound event handlers (removable via page.off) ───

  private onRequest = (req: Request): void => {
    if (!this.active) return;
    this.network.push({
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
    });
  };

  private onResponse = (res: Response): void => {
    if (!this.active) return;
    const req = res.request();
    const method = req.method();
    const url = req.url();
    // Update the last unmatched request entry for this method+url.
    for (let i = this.network.length - 1; i >= 0; i--) {
      const n = this.network[i];
      if (n.method === method && n.url === url && n.status === undefined) {
        n.status = res.status();
        n.statusText = res.statusText();
        return;
      }
    }
    // No matching request (rare) — add a response-only entry.
    this.network.push({
      method,
      url,
      resourceType: req.resourceType(),
      status: res.status(),
      statusText: res.statusText(),
    });
  };

  private onConsole = (msg: ConsoleMessage): void => {
    if (!this.active) return;
    this.consoleEvents.push({ type: msg.type(), text: msg.text() });
  };

  private onPageError = (err: Error): void => {
    if (!this.active) return;
    this.errors.push({ message: err.message });
  };

  private onFrameNavigated = (frame: Frame): void => {
    if (!this.active) return;
    // Only track top-frame navigations (iframe navs are noise for the agent).
    if (frame === frame.page().mainFrame()) {
      this.navigations.push({ url: frame.url() });
    }
  };
}
