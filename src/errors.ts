/**
 * Error Taxonomy — categorized, agent-actionable errors.
 *
 * PRODUCTION.md §2A: "Errors are opaque strings. The agent can't decide
 * 'retry' vs 'look --visual' vs 'give up' from 'Error: Target closed'."
 *
 * This module replaces the opaque top-level string dump (cli.ts) with
 * structured error codes that tell the agent exactly what to do next:
 *
 *   E_NOT_FOUND          → run "cairn look --visual" to visually locate
 *   E_AMBIGUOUS          → list candidates; agent picks one or uses --visual
 *   E_NAVIGATION_TIMEOUT → retry, or adjust the URL/wait strategy
 *   E_BROWSER_DEAD       → auto-relaunch (SessionManager handles this)
 *   E_REF_STALE          → re-run "cairn look" for fresh refs, then retry
 *   E_PARSE_FAILED       → rephrase the intent
 *   E_TYPE_FAILED        → check the ref, or use "cairn look --visual"
 *   E_CLICK_FAILED       → check the ref, or use "cairn look --visual"
 *   E_UNKNOWN            → check "cairn status" + "cairn look"
 *
 * The agent consumes the error CODE (deterministic routing) + the suggestion
 * (human-readable next step). No free-text parsing required.
 */

// ─── Error codes ───────────────────────────────────────────────

export type ErrorCode =
  | 'E_NOT_FOUND'
  | 'E_AMBIGUOUS'
  | 'E_NAVIGATION_TIMEOUT'
  | 'E_BROWSER_DEAD'
  | 'E_REF_STALE'
  | 'E_PARSE_FAILED'
  | 'E_TYPE_FAILED'
  | 'E_CLICK_FAILED'
  | 'E_UNKNOWN';

// ─── Error class ───────────────────────────────────────────────

/**
 * A categorized error with a code (for programmatic routing) and a
 * suggestion (for the agent's next action).
 */
export class CairnError extends Error {
  readonly code: ErrorCode;
  readonly suggestion: string;
  /** Relevant ref, if the error is about a specific element. */
  readonly ref?: string;
  /** Candidate refs for E_AMBIGUOUS. */
  readonly candidates?: string[];

  constructor(
    code: ErrorCode,
    message: string,
    suggestion: string,
    opts?: { ref?: string; candidates?: string[]; cause?: unknown },
  ) {
    super(message);
    this.name = 'CairnError';
    this.code = code;
    this.suggestion = suggestion;
    if (opts?.ref) this.ref = opts.ref;
    if (opts?.candidates) this.candidates = opts.candidates;
  }
}

// ─── Categorization: map unknown errors → CairnError ───────────

/** Pattern → error code mapping for categorizing thrown errors. */
const PATTERNS: Array<{ regex: RegExp; code: ErrorCode; suggestion: string }> = [
  {
    regex: /Target closed|Browser.*(?:closed|crashed)|Connection.*closed|WebSocket.*(?:closed|error)|socket.*hang/i,
    code: 'E_BROWSER_DEAD',
    suggestion: 'The browser session died. Run the command again — Cairn auto-relaunches Chrome. Or run "cairn status" to check the session.',
  },
  {
    regex: /Timeout.*exceeded|TimeoutError|navigation.*timeout|page\.goto.*timeout/i,
    code: 'E_NAVIGATION_TIMEOUT',
    suggestion: 'The page took too long to load. Retry, or navigate to a simpler URL first. Use --no-headless to watch what happens.',
  },
  {
    regex: /stale|detached|not.*attached|Element.*not.*found|locator.*not.*found/i,
    code: 'E_REF_STALE',
    suggestion: 'The element ref is stale — the page changed since you last ran "cairn look". Run "cairn look" to get fresh refs, then retry.',
  },
  {
    regex: /connectOverCDP|connect.*ECONNREFUSED|Empty reply|ECONNRESET/i,
    code: 'E_BROWSER_DEAD',
    suggestion: 'Could not connect to Chrome. Run the command again — Cairn will relaunch Chrome automatically.',
  },
];

/**
 * Categorize an unknown thrown error into a CairnError.
 * Falls back to E_UNKNOWN with a generic suggestion.
 */
export function categorizeError(e: unknown): CairnError {
  // Already a CairnError — pass through
  if (e instanceof CairnError) return e;

  const msg = e instanceof Error ? e.message : String(e);

  for (const { regex, code, suggestion } of PATTERNS) {
    if (regex.test(msg)) {
      return new CairnError(code, msg, suggestion);
    }
  }

  return new CairnError(
    'E_UNKNOWN',
    msg,
    'An unexpected error occurred. Run "cairn status" to check the session, or "cairn look" to see the current page state.',
  );
}

// ─── Rendering ─────────────────────────────────────────────────

/**
 * Render a CairnError as structured, agent-actionable text.
 * Format:
 *   Error [E_CODE]: <message>
 *   → <suggestion>
 *
 * For E_AMBIGUOUS, also lists the candidate refs.
 */
export function renderError(error: CairnError): string {
  const lines: string[] = [];
  lines.push(`Error [${error.code}]: ${error.message}`);
  if (error.ref) {
    lines.push(`  ref: ${error.ref}`);
  }
  if (error.candidates && error.candidates.length > 0) {
    lines.push(`  candidates: ${error.candidates.join(', ')}`);
  }
  lines.push(`→ ${error.suggestion}`);
  return lines.join('\n');
}

// ─── Convenience constructors ──────────────────────────────────

export function notFoundError(target: string): CairnError {
  return new CairnError(
    'E_NOT_FOUND',
    `no element matched "${target}"`,
    'Run "cairn look --visual" for a marked screenshot to visually locate the element, then act by ref.',
  );
}

export function ambiguousError(target: string, candidates: string[]): CairnError {
  return new CairnError(
    'E_AMBIGUOUS',
    `${candidates.length} elements match "${target}"`,
    'Specify which one (e.g. "click the <unique name> button") or run "cairn look --visual" to disambiguate.',
    { candidates },
  );
}

export function parseFailedError(goal: string): CairnError {
  return new CairnError(
    'E_PARSE_FAILED',
    `could not parse intent from "${goal}"`,
    'Try: "click the <name> button", "type \\"<text>\\" into the <name> field", or "go to <page>".',
  );
}
