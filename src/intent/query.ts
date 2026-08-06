/**
 * Page Model as Query — docs/REVOLUTION.md Leap 4.
 *
 * Instead of dumping the full page tree (`look`), let the agent ask targeted
 * queries and get one-line answers: "what's the primary action in this form?",
 * "what changed since the last step?", "which elements match 'submit'?"
 *
 * A query API returns: `query("primary-action", region="main")` →
 * `button "Sign in" [e15]` (one line, ~30 bytes) — a ~180× reduction on a
 * 5.5 KB tree.
 *
 * Query types:
 *   - match <text>     → reuse groundIntent to find the best interactive node
 *   - primary-action   → highest-priority interactive node in a region
 *   - form-fields      → all typeable elements in the focused form/region
 *   - diff             → reuse computeDelta against a stored previous model
 *
 * Pure query functions (queryMatch, queryPrimaryAction, queryFormFields) take a
 * PageModel and are unit-testable without a browser. Only queryDiff needs a
 * Page (to build a fresh model).
 *
 * Model snapshots are persisted to .sessions/<id>.model.json so the diff query
 * can compare across CLI invocations.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import type { PageModel, EnhancedNode } from '../model/page-model.js';
import { buildPageModel, getInteractiveNodes } from '../model/page-model.js';
import { groundIntent, TYPEABLE_ROLES, type GroundResult } from './grounding.js';
import { computeDelta, renderDelta, type DeltaResult } from '../model/delta.js';
import type { ClickIntent } from './parser.js';

// ─── Types ─────────────────────────────────────────────────────

export type QueryType = 'match' | 'primary-action' | 'form-fields' | 'diff';

export interface ParsedQuery {
  type: QueryType;
  /** The search target for match queries (the question text itself). */
  target?: string;
  /** Region extracted from the question (e.g. "in the main"). */
  region?: string;
}

export interface QueryResult {
  type: QueryType;
  success: boolean;
  /** Compact one-line (or few-line) answer. */
  answer: string;
  /** The ref of the matched element (for match / primary-action). */
  ref?: string;
  /** Full fidelity for programmatic use. */
  ground?: GroundResult;
  delta?: DeltaResult;
}

// ─── Query type detection (pure — no browser) ──────────────────

// Region keywords → canonical region names (mirrors parser.ts REGION_HINTS).
const REGION_HINTS: Record<string, string> = {
  nav: 'nav', navigation: 'nav', navbar: 'nav', menu: 'nav',
  header: 'header', top: 'header',
  main: 'main', content: 'main', body: 'main',
  sidebar: 'sidebar', aside: 'sidebar',
  footer: 'footer', bottom: 'footer',
  modal: 'modal', dialog: 'modal', popup: 'modal',
  form: 'form',
};

/**
 * Parse a natural-language question into a structured query.
 *
 * Detection heuristics:
 *   - "what changed" / "diff" / "delta" / "changes since" → diff
 *   - "primary action" / "main action" / "main cta" / "primary button" → primary-action
 *   - "form fields" / "input fields" / "typeable" / "fillable" / "all inputs" → form-fields
 *   - anything else → match (the question text is the search target)
 *
 * Also extracts a region hint from the question ("in the main", "in the form").
 */
export function parseQueryType(question: string): ParsedQuery {
  const lower = question.toLowerCase().trim();

  // ── Diff queries ──
  if (/\b(what(?:'s|s| is)? changed|diff|delta|changes?\s+since|what (?:is|are) (?:the\s+)?changes|recent changes)\b/.test(lower)) {
    return { type: 'diff', region: extractRegion(lower) };
  }

  // ── Primary-action queries ──
  if (/\b(primary action|main action|primary (?:button|cta)|main (?:button|cta)|call to action|primary submit|main submit)\b/.test(lower)) {
    const region = extractRegion(lower);
    return { type: 'primary-action', region };
  }

  // ── Form-fields queries ──
  if (/\b(form fields?|input fields?|typeable|fillable|all inputs?|text fields?|input elements|fill\s+in fields?)\b/.test(lower)) {
    const region = extractRegion(lower);
    return { type: 'form-fields', region };
  }

  // ── Match query (default) ──
  // The question text IS the search target. Strip query-like prefixes
  // ("which elements match X", "find X", "where is X") to get the clean target.
  const region = extractRegion(lower);
  const target = stripQueryPrefixes(question);
  return { type: 'match', target, region };
}

/**
 * Extract a region hint from a question ("... in the main", "... in the form").
 * Returns the canonical region name or undefined.
 */
function extractRegion(lower: string): string | undefined {
  const m = lower.match(/\s+(?:in|from|inside|within)\s+(?:the\s+)?(\w+)\s*$/);
  if (m) {
    const region = REGION_HINTS[m[1]];
    if (region) return region;
  }
  return undefined;
}

/**
 * Strip query-like prefixes from a match question to get the clean search target.
 *   "which elements match submit" → "submit"
 *   "find the sign in button" → "sign in button"
 *   "where is the email field" → "email field"
 */
function stripQueryPrefixes(question: string): string {
  const lower = question.toLowerCase().trim();
  // "which elements match X" / "which elements match X"
  let m = lower.match(/^which\s+(?:elements?|buttons?|links?|fields?)\s+(?:match(?:es)?|contain[s]?)\s+/);
  if (m) return stripLeadingArticle(question.trim().slice(m[0].length));
  // "find X" / "find the X"
  m = lower.match(/^find\s+(?:the\s+)?/);
  if (m) return stripLeadingArticle(question.trim().slice(m[0].length));
  // "where is X" / "where is the X" / "where are the X"
  m = lower.match(/^where\s+(?:is|are)\s+(?:the\s+)?/);
  if (m) return stripLeadingArticle(question.trim().slice(m[0].length));
  // "show me X" / "show X"
  m = lower.match(/^show(?:\s+me)?\s+(?:the\s+)?/);
  if (m) return stripLeadingArticle(question.trim().slice(m[0].length));
  return question.trim();
}

/** Strip a leading article ("the", "a", "an") from a phrase. */
function stripLeadingArticle(s: string): string {
  return s.replace(/^(?:the|a|an)\s+/i, '').trim();
}

// ─── Query: match (pure — no browser) ──────────────────────────

/**
 * Find the best interactive element matching the given text.
 * Reuses groundIntent with a synthetic click intent (no typeability penalty —
 * we want any interactive element, not just typeable ones).
 */
export function queryMatch(target: string, model: PageModel, region?: string): QueryResult {
  const intent: ClickIntent = {
    kind: 'click',
    target,
    region,
  };
  const ground = groundIntent(intent, model);

  if (ground.status === 'match') {
    return {
      type: 'match',
      success: true,
      ref: ground.ref,
      answer: renderNodeLine(ground.node, ground.ref),
      ground,
    };
  }

  if (ground.status === 'ambiguous') {
    // Disambiguation heuristic: prefer typeable elements (inputs) over
    // labels/non-interactive matches. When "email" matches both a <label>
    // and an <input>, the input is the more useful answer.
    const typeable = ground.candidates.find(
      (c) => TYPEABLE_ROLES.includes(c.node.role) || c.node.interactivitySignals?.isEditable,
    );
    if (typeable) {
      return {
        type: 'match',
        success: true,
        ref: typeable.ref,
        answer: renderNodeLine(typeable.node, typeable.ref),
        ground: { status: 'match', ref: typeable.ref, node: typeable.node, score: typeable.score, reasons: typeable.reasons },
      };
    }
    const lines = ground.candidates.map(
      (c) => `  [${c.ref}] ${c.node.role}${c.node.name ? ` "${c.node.name}"` : ''}`,
    );
    return {
      type: 'match',
      success: false,
      answer: `ambiguous — ${ground.candidates.length} matches:\n${lines.join('\n')}`,
      ground,
    };
  }

  // notFound
  const closest = ground.closest.slice(0, 3).map(
    (c) => `  [${c.ref}] ${c.node.role}${c.node.name ? ` "${c.node.name}"` : ''}`,
  );
  return {
    type: 'match',
    success: false,
    answer: closest.length > 0
      ? `not found — closest:\n${closest.join('\n')}`
      : 'not found — no interactive elements on the page',
    ground,
  };
}

// ─── Query: primary-action (pure — no browser) ─────────────────

/**
 * Find the highest-priority interactive node in a region (or the whole page).
 *
 * Priority heuristic:
 *   1. Buttons with submit-like text (submit, sign in, log in, save, continue, ...) — highest
 *   2. Buttons (general)
 *   3. Links with action-like text
 *   4. Links (general)
 *   5. Other interactive elements
 *
 * Within the same priority tier, prefer larger elements (by bbox area —
 * prominence) and elements in a form region.
 */
export function queryPrimaryAction(model: PageModel, region?: string): QueryResult {
  let nodes = getInteractiveNodes(model);

  // Filter by region if specified
  if (region) {
    nodes = nodes.filter((n) => n.region === region);
  }

  if (nodes.length === 0) {
    return {
      type: 'primary-action',
      success: false,
      answer: region
        ? `no interactive elements in region "${region}"`
        : 'no interactive elements on the page',
    };
  }

  // Score each node by action priority
  const scored = nodes
    .map((node) => ({ node, score: actionPriority(node, region) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best || best.score <= 0) {
    return {
      type: 'primary-action',
      success: false,
      answer: region
        ? `no actionable elements found in region "${region}"`
        : 'no actionable elements found on the page',
    };
  }

  return {
    type: 'primary-action',
    success: true,
    ref: best.node.ref,
    answer: renderNodeLine(best.node, best.node.ref),
  };
}

/**
 * Score an interactive node by how likely it is to be the primary action.
 * Higher = more likely.
 */
function actionPriority(node: EnhancedNode, region?: string): number {
  const name = (node.name ?? '').toLowerCase();
  const text = (node.text ?? '').toLowerCase();
  const labelText = `${name} ${text}`.trim();

  let priority = 0;

  // Base priority by role
  if (node.role === 'button') priority = 80;
  else if (node.role === 'link') priority = 60;
  else if (node.role === 'tab') priority = 50;
  else if (node.interactive) priority = 30;
  else return 0; // non-interactive shouldn't be here, but guard

  // Boost for submit-like action text (common primary actions)
  if (/\b(submit|sign in|sign-in|signin|log in|log-in|login|register|continue|save|confirm|send|create|delete|add|buy|purchase|checkout|next|apply|search|go)\b/.test(labelText)) {
    priority += 25;
  }

  // Boost for elements in a form region (forms usually have the primary action)
  if (node.region === 'form') priority += 15;
  if (region === 'form' && node.region === 'form') priority += 10;

  // Size bonus: larger elements are more prominent (cap at +10)
  const area = node.bbox.width * node.bbox.height;
  if (area > 50000) priority += 10;
  else if (area > 10000) priority += 5;
  else if (area > 2000) priority += 2;

  return priority;
}

// ─── Query: form-fields (pure — no browser) ────────────────────

/**
 * Find all typeable elements (inputs, textareas, searchboxes, comboboxes,
 * spinbuttons) in a region (or the whole page).
 */
export function queryFormFields(model: PageModel, region?: string): QueryResult {
  let nodes = getInteractiveNodes(model);

  // Filter to typeable roles
  nodes = nodes.filter(
    (n) => TYPEABLE_ROLES.includes(n.role) || n.interactivitySignals?.isEditable,
  );

  // Filter by region if specified
  if (region) {
    nodes = nodes.filter((n) => n.region === region);
  }

  if (nodes.length === 0) {
    return {
      type: 'form-fields',
      success: false,
      answer: region
        ? `no typeable elements in region "${region}"`
        : 'no typeable elements on the page',
    };
  }

  const lines = nodes.map((n) => `  [${n.ref}] ${n.role}${n.name ? ` "${n.name}"` : ''}`);
  return {
    type: 'form-fields',
    success: true,
    answer: `${nodes.length} typeable field${nodes.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
  };
}

// ─── Query: diff (needs Page — builds fresh model) ─────────────

/**
 * Compare the current page state against the last saved model snapshot.
 * Loads the snapshot from .sessions/<id>.model.json, builds a fresh model,
 * and computes the delta.
 *
 * @param page       The Playwright page.
 * @param sessionId  The session ID (for snapshot file naming).
 */
export async function queryDiff(page: Page, sessionId: string): Promise<QueryResult> {
  const prevModel = loadModelSnapshot(sessionId);

  if (!prevModel) {
    return {
      type: 'diff',
      success: false,
      answer: 'no previous model snapshot — run "cairn look" or "cairn goto" first to establish a baseline',
    };
  }

  const currModel = await buildPageModel(page);
  const delta = computeDelta(prevModel, currModel);

  if (delta.nodes.length === 0 && !delta.urlChanged) {
    return {
      type: 'diff',
      success: true,
      answer: 'no changes since the last snapshot',
      delta,
    };
  }

  return {
    type: 'diff',
    success: true,
    answer: renderDelta(delta),
    delta,
  };
}

// ─── Model snapshot persistence ────────────────────────────────

const SESSION_DIR = '.sessions';

/** Path to the model snapshot file for a session. */
export function getModelSnapshotPath(sessionId: string): string {
  return path.join(SESSION_DIR, `${sessionId}.model.json`);
}

/**
 * Save a page model snapshot to disk for later diff queries.
 * Only the tree is serialized (the refIndex Map is rebuilt on load).
 */
export function saveModelSnapshot(model: PageModel, sessionId: string): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  const snapshot = {
    url: model.url,
    title: model.title,
    tree: model.tree,
    timestamp: model.timestamp,
  };
  fs.writeFileSync(getModelSnapshotPath(sessionId), JSON.stringify(snapshot, null, 2));
}

/**
 * Load a saved model snapshot from disk. Returns null if not found.
 * Rebuilds the refIndex Map from the tree.
 */
export function loadModelSnapshot(sessionId: string): PageModel | null {
  const file = getModelSnapshotPath(sessionId);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      url: string;
      title: string;
      tree: EnhancedNode;
      timestamp: number;
    };
    // Rebuild the refIndex Map
    const refIndex = new Map<string, EnhancedNode>();
    function index(node: EnhancedNode) {
      refIndex.set(node.ref, node);
      for (const child of node.children) index(child);
    }
    index(data.tree);

    return {
      url: data.url,
      title: data.title,
      tree: data.tree,
      refIndex,
      mediaRich: { canvasCount: 0, webglCount: 0, shadowDomCount: 0 },
      timestamp: data.timestamp,
    };
  } catch {
    return null;
  }
}

// ─── Rendering ─────────────────────────────────────────────────

/**
 * Render a single node as a compact one-line answer.
 * e.g. `button "Sign in" [e15]`
 */
function renderNodeLine(node: EnhancedNode, ref: string): string {
  const name = node.name ? ` "${node.name}"` : '';
  return `${node.role}${name} [${ref}]`;
}

/**
 * Render a query result as a compact, agent-readable string.
 * This is the main output of the `cairn query` command.
 */
export function renderQueryResult(result: QueryResult): string {
  return result.answer;
}
