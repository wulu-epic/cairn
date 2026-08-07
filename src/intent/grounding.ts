/**
 * Element Grounding — fuzzy-match an Intent's target to a page-model ref.
 *
 * docs/DESIGN.md §4.3: grounding (not perception) is the bottleneck. This module
 * takes a parsed Intent (e.g. { target: "sign in", roleHint: "button" }) and
 * finds the best-matching interactive node in the page model by ref.
 *
 * Scoring is deterministic — token overlap, substring match, role/region
 * bonuses — NO LLM call. Returns one of:
 *   - { status: 'match', ref, node, score }      — clear best match
 *   - { status: 'ambiguous', candidates }         — 2+ nodes within margin
 *   - { status: 'notFound', closest }             — nothing above threshold
 *
 * The agent then either acts on the ref (match) or disambiguates (ambiguous /
 * notFound), with a suggestion to run `cairn look --visual` for visual grounding.
 */

import type { PageModel, EnhancedNode } from '../model/page-model.js';
import { getInteractiveNodes } from '../model/page-model.js';
import type { Intent } from './parser.js';

// ─── Types ─────────────────────────────────────────────────────

export interface GroundCandidate {
  ref: string;
  node: EnhancedNode;
  score: number;
  reasons: string[];   // human-readable scoring reasons for debug/transparency
}

export type GroundResult =
  | { status: 'match'; ref: string; node: EnhancedNode; score: number; reasons: string[] }
  | { status: 'ambiguous'; candidates: GroundCandidate[] }
  | { status: 'notFound'; closest: GroundCandidate[] };

// ─── Tuning constants ──────────────────────────────────────────

const MATCH_THRESHOLD = 0.35;   // minimum score to consider a node a candidate
const AMBIGUITY_MARGIN = 0.15;   // if 2nd-best is within this of best → ambiguous

// Role aliases: an intent roleHint maps to one or more node roles that match.
const ROLE_ALIASES: Record<string, string[]> = {
  button: ['button'],
  link: ['link'],
  textbox: ['textbox', 'searchbox', 'spinbutton'],
  checkbox: ['checkbox'],
  radio: ['radio'],
  combobox: ['combobox', 'listbox'],
  menu: ['menu', 'menuitem'],
  tab: ['tab'],
  img: ['img'],
  searchbox: ['searchbox', 'textbox'],
  slider: ['slider'],
  switch: ['switch', 'button'],
};

// ─── Synonym dictionary ────────────────────────────────────────
// Multi-word phrases like "log in" and "sign in" share zero tokens, so
// token overlap + Levenshtein can never bridge them. This static map
// canonicalizes known UI synonyms before scoring, catching the majority
// of real-world vocabulary mismatches without an embeddings download.
// The first element of each group is the canonical form.

const SYNONYM_GROUPS: string[][] = [
  ['sign in', 'log in', 'login', 'log on', 'sign on'],
  ['sign out', 'log out', 'logout', 'log off', 'sign off'],
  ['sign up', 'register', 'create account', 'join'],
  ['submit', 'continue', 'proceed'],
  ['email', 'e-mail', 'email address'],
  ['username', 'user id'],
  ['password', 'passcode'],
  ['search', 'find', 'lookup'],
  ['cart', 'basket', 'shopping cart'],
  ['checkout', 'purchase'],
  ['cancel', 'dismiss', 'close'],
  ['confirm', 'ok', 'accept'],
  ['settings', 'preferences', 'config', 'options'],
  ['delete', 'remove', 'trash'],
  ['edit', 'modify'],
  ['save', 'update', 'apply'],
  ['buy now', 'buy'],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compile: each synonym phrase → its canonical form, sorted longest-first
// so "sign in" is replaced before "sign" (prevents partial-match clobbers).
const SYNONYM_ENTRIES: Array<{ regex: RegExp; canonical: string }> = SYNONYM_GROUPS
  .flatMap((group) => {
    const canonical = group[0];
    return group.map((phrase) => ({ phrase, canonical }));
  })
  .filter((e) => e.phrase !== e.canonical)
  .sort((a, b) => b.phrase.length - a.phrase.length)
  .map((e) => ({
    regex: new RegExp(`\\b${escapeRegex(e.phrase)}\\b`, 'gi'),
    canonical: e.canonical,
  }));

/** Replace known synonym phrases with their canonical form. */
export function canonicalizePhrase(s: string): string {
  let result = s;
  for (const { regex, canonical } of SYNONYM_ENTRIES) {
    result = result.replace(regex, canonical);
  }
  return result;
}

// ─── Helpers ───────────────────────────────────────────────────

// Common UI abbreviations → their expanded forms. Applied during
// tokenization so "pwd" matches "password", "btn" matches "button", etc.
const ABBREVIATIONS: Record<string, string> = {
  pwd: 'password',
  pw: 'password',
  usr: 'user',
  usrnm: 'username',
  cfg: 'config',
  acct: 'account',
  btn: 'button',
  msg: 'message',
  auth: 'authentication',
  repo: 'repository',
  desc: 'description',
  pref: 'preferences',
  dlg: 'dialog',
  del: 'delete',
  img: 'image',
  max: 'maximum',
  min: 'minimum',
  num: 'number',
  qty: 'quantity',
  db: 'database',
  attr: 'attribute',
  opt: 'option',
  opts: 'options',
  sys: 'system',
  txt: 'text',
};

/** Expand a known abbreviation to its full form, or return the token as-is. */
export function expandAbbreviation(t: string): string {
  return ABBREVIATIONS[t] ?? t;
}

// Pre-compile abbreviation regexes for phrase-level expansion (before canonicalization)
const ABBREVIATION_ENTRIES: Array<{ regex: RegExp; full: string }> = Object.entries(ABBREVIATIONS)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([abbr, full]) => ({
    regex: new RegExp(`\\b${escapeRegex(abbr)}\\b`, 'gi'),
    full,
  }));

/** Expand abbreviations at the phrase level so they flow through canonicalization too. */
function expandAbbreviationsInPhrase(s: string): string {
  let result = s;
  for (const { regex, full } of ABBREVIATION_ENTRIES) {
    result = result.replace(regex, full);
  }
  return result;
}

// Common UI nouns where "-ing" is part of the root, not a suffix.
// Without this, "setting" would be stripped to "sett", breaking the
// "settings" → "setting" match.
const ING_EXCEPTIONS = new Set([
  'setting', 'warning', 'meeting', 'building', 'heading', 'listing',
  'rating', 'timing', 'shipping', 'billing', 'morning', 'during',
  'something', 'anything', 'everything',
]);

/**
 * Light suffix stripper — normalizes common English morphological variants
 * so "clicking" matches "click", "settings" matches "setting", etc.
 * Strips at most one suffix per word; skips words too short to safely stem.
 * Words where "-ing" is part of the root (setting, warning, …) are excluded.
 */
export function stemToken(w: string): string {
  if (w.length <= 4) return w;

  // -ing → strip (clicking → click), unless it's a root noun (setting)
  if (w.endsWith('ing') && w.length > 5 && !ING_EXCEPTIONS.has(w)) return w.slice(0, -3);

  // -est → strip (smallest → small) — check before -es/-s
  if (w.endsWith('est') && w.length > 5) return w.slice(0, -3);

  // -ed → strip (clicked → click, disabled → disabl)
  // Words whose root ends in 'e' (disabled→disable, saved→save) lose an
  // extra char, but the Levenshtein fuzzy matcher catches the 1-char gap.
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);

  // -es → strip (boxes → box)
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);

  // -er → strip (smaller → small)
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2);

  // -ly → strip (quickly → quick)
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);

  // -s → strip (items → item) — skip -ss (class, address)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 4) return w.slice(0, -1);

  return w;
}

/** Tokenize: lowercase, strip punctuation, split, expand abbreviations, stem. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => stemToken(expandAbbreviation(t)));
}

/**
 * Levenshtein edit distance — typo tolerance for token matching.
 * Catches "signin" ≈ "sign in", "submt" ≈ "submit", etc.
 * Uses O(n) space (two-row DP) for efficiency.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** The searchable text for a node: name + text, combined. */
function nodeSearchText(node: EnhancedNode): string {
  return [node.name ?? '', node.text ?? ''].join(' ').trim();
}

/**
 * Jaccard-like token overlap score with fuzzy (Levenshtein) matching.
 * Exact token matches count fully; near-matches (edit distance ≤ 2, relative
 * distance ≤ 0.3) count at reduced weight. Catches typos like "submt"≈"submit"
 * and concatenated words like "signin"≈"sign in" (via cross-token check).
 */
function tokenOverlapScore(targetTokens: string[], nodeTokens: string[]): { score: number; matched: string[] } {
  if (targetTokens.length === 0 || nodeTokens.length === 0) return { score: 0, matched: [] };
  const targetSet = new Set(targetTokens);
  const nodeSet = new Set(nodeTokens);
  let intersection = 0;
  const matched: string[] = [];
  for (const t of targetSet) {
    if (nodeSet.has(t)) {
      intersection++;
      matched.push(t);
    }
  }
  const union = targetSet.size + nodeSet.size - intersection;
  const exact = union > 0 ? intersection / union : 0;

  // Fuzzy matching: for unmatched target tokens, try Levenshtein against node tokens.
  // Only kicks in when exact overlap is low (otherwise exact matches dominate).
  if (exact < 0.6) {
    let fuzzyMatches = 0;
    const matchedTargets = new Set(matched);
    for (const t of targetSet) {
      if (matchedTargets.has(t)) continue;
      for (const n of nodeSet) {
        if (matchedTargets.has(n)) continue;
        const dist = levenshtein(t, n);
        const relDist = dist / Math.max(t.length, n.length);
        // Accept if edit distance ≤ 2 and relative distance ≤ 0.3
        if (dist > 0 && dist <= 2 && relDist <= 0.3) {
          fuzzyMatches++;
          matched.push(`${t}≈${n}`);
          break;
        }
      }
    }
    if (fuzzyMatches > 0) {
      // Fuzzy matches count at 70% weight vs exact
      const fuzzyScore = (fuzzyMatches * 0.7) / (targetSet.size + nodeSet.size - fuzzyMatches);
      return { score: Math.max(exact, fuzzyScore), matched };
    }
  }

  return { score: exact, matched };
}

/** Check if target appears as a substring of the node text (normalized). */
function substringScore(targetNorm: string, nodeNorm: string): boolean {
  if (targetNorm.length < 3 || nodeNorm.length < 3) return false;
  return nodeNorm.includes(targetNorm);
}

/** Normalize for substring matching: lowercase, collapse spaces. */
function normalizeForSubstring(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Does the node's role match the intent's roleHint? */
function roleMatches(nodeRole: string, roleHint?: string): boolean {
  if (!roleHint) return false;
  const aliases = ROLE_ALIASES[roleHint];
  if (!aliases) return nodeRole === roleHint;
  return aliases.includes(nodeRole);
}

// ─── Scoring ───────────────────────────────────────────────────

/**
 * Score a single node against the intent target.
 * Returns a score in [0, 1] and human-readable reasons.
 *
 * Scoring breakdown:
 *   - Token overlap (name+text vs target):      up to 0.55
 *   - Substring match bonus:                    up to 0.25
 *   - Role hint match bonus:                    up to 0.15
 *   - Region hint match bonus:                  up to 0.10
 *   - Intent-aware typeability (type intents):  +0.20 typeable / -0.30 not
 *   - Penalty for non-interactive:              -0.20
 */

// Roles that accept text input — for type intents, strongly prefer these.
export const TYPEABLE_ROLES = ['textbox', 'searchbox', 'combobox', 'spinbutton', 'textarea'];

function scoreNode(node: EnhancedNode, intent: Intent): GroundCandidate {
  let score = 0;
  const reasons: string[] = [];

  const targetText = canonicalizePhrase(expandAbbreviationsInPhrase(intent.target ?? ''));
  const targetTokens = tokenize(targetText);
  const nodeText = canonicalizePhrase(expandAbbreviationsInPhrase(nodeSearchText(node)));
  const nodeTokens = tokenize(nodeText);

  // Token overlap (primary signal)
  const { score: overlap, matched } = tokenOverlapScore(targetTokens, nodeTokens);
  if (overlap > 0) {
    score += overlap * 0.55;
    reasons.push(`token overlap: ${matched.join(', ')} (${(overlap * 100).toFixed(0)}%)`);
  }

  // Substring match bonus (target appears within node text, or vice versa)
  const targetNorm = normalizeForSubstring(targetText);
  const nodeNorm = normalizeForSubstring(nodeText);
  if (substringScore(targetNorm, nodeNorm)) {
    score += 0.25;
    reasons.push('substring match');
  } else if (substringScore(nodeNorm, targetNorm) && targetNorm.length >= 4) {
    // Node text is a substring of the target (e.g. node="email", target="email address")
    score += 0.15;
    reasons.push('partial substring match');
  }

  // Role hint bonus
  if (intent.kind !== 'navigate' && 'roleHint' in intent && intent.roleHint) {
    if (roleMatches(node.role, intent.roleHint)) {
      score += 0.15;
      reasons.push(`role match: ${node.role}`);
    }
  }

  // Intent-aware typeability: for type intents, strongly prefer elements
  // that can actually accept text input. Without this, the grounder matches
  // "search" to a "Search" span/label instead of the actual <input> field.
  // The penalty is aggressive (-0.55) because token overlap + substring can
  // reach 0.80, so we need to push non-typeable matches below the 0.35
  // threshold when no real input field exists.
  if (intent.kind === 'type') {
    const isTypeable = TYPEABLE_ROLES.includes(node.role)
      || node.interactivitySignals?.isEditable;
    if (isTypeable) {
      score += 0.20;
      reasons.push('typeable role');
    } else {
      score -= 0.55;
      reasons.push('non-typeable for type intent');
    }
  }

  // Region hint bonus
  if (intent.region) {
    if (node.region === intent.region) {
      score += 0.10;
      reasons.push(`region match: ${node.region}`);
    } else if (node.region) {
      // Small penalty for being in a different region
      score -= 0.05;
    }
  }

  // For navigate intents, prefer links
  if (intent.kind === 'navigate' && node.role === 'link') {
    score += 0.10;
    reasons.push('navigate prefers link');
  }

  // For select intents, prefer combobox/listbox (dropdown) elements.
  // A native <select> maps to 'combobox' role. Strongly prefer these and
  // penalize non-selectable elements (buttons, links) that can't hold options.
  if (intent.kind === 'select') {
    if (node.role === 'combobox' || node.role === 'listbox') {
      score += 0.20;
      reasons.push('selectable role for select intent');
    } else {
      score -= 0.30;
      reasons.push('non-selectable for select intent');
    }
  }

  // Only interactive nodes should be actionable
  if (!node.interactive) {
    score -= 0.20;
    reasons.push('non-interactive penalty');
  }

  // Clamp
  score = Math.max(0, Math.min(1, score));

  return { ref: node.ref, node, score, reasons };
}

// ─── Main grounding function ───────────────────────────────────

/**
 * Ground an Intent against the page model: find the best-matching interactive
 * node by ref, or report ambiguity / not-found.
 */
export function groundIntent(intent: Intent, model: PageModel): GroundResult {
  // Score all interactive nodes
  const interactiveNodes = getInteractiveNodes(model);
  let candidates: GroundCandidate[] = [];

  if (interactiveNodes.length === 0) {
    return { status: 'notFound', closest: [] };
  }

  // Also consider non-interactive nodes that have names (they might be
  // containers/labels the agent is referring to, but with lower priority).
  // For now, only score interactive nodes — they're the actionable targets.
  candidates = interactiveNodes
    .map((node) => scoreNode(node, intent))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { status: 'notFound', closest: [] };
  }

  const best = candidates[0];

  // Not found: best score below threshold
  if (best.score < MATCH_THRESHOLD) {
    return { status: 'notFound', closest: candidates.slice(0, 5) };
  }

  // Ambiguous: 2nd-best is within AMBIGUITY_MARGIN of best AND both above threshold
  if (candidates.length > 1) {
    const second = candidates[1];
    if (second.score >= MATCH_THRESHOLD && best.score - second.score <= AMBIGUITY_MARGIN) {
      return {
        status: 'ambiguous',
        candidates: candidates
          .filter((c) => c.score >= MATCH_THRESHOLD && best.score - c.score <= AMBIGUITY_MARGIN)
          .slice(0, 5),
      };
    }
  }

  // Clear match
  return {
    status: 'match',
    ref: best.ref,
    node: best.node,
    score: best.score,
    reasons: best.reasons,
  };
}

/** Render a ground result as a compact, agent-readable string. */
export function renderGroundResult(result: GroundResult): string {
  if (result.status === 'match') {
    const n = result.node;
    return `matched [${result.ref}] ${n.role}${n.name ? ` "${n.name}"` : ''} (score: ${result.score.toFixed(2)})`;
  }
  if (result.status === 'ambiguous') {
    const lines = result.candidates.map(
      (c) => `  [${c.ref}] ${c.node.role}${c.node.name ? ` "${c.node.name}"` : ''} (score: ${c.score.toFixed(2)})`,
    );
    return `ambiguous — ${result.candidates.length} candidates:\n${lines.join('\n')}`;
  }
  // notFound
  if (result.closest.length === 0) {
    return `not found — no interactive elements on the page`;
  }
  const lines = result.closest.map(
    (c) => `  [${c.ref}] ${c.node.role}${c.node.name ? ` "${c.node.name}"` : ''} (score: ${c.score.toFixed(2)})`,
  );
  return `not found — closest candidates:\n${lines.join('\n')}`;
}

// ─── Embeddings fallback wrapper ───────────────────────────────

/**
 * Ground an Intent with a semantic (embeddings) fallback.
 *
 * 1. Try deterministic grounding (token overlap + substring + Levenshtein).
 *    This is the fast path — no model download, no async I/O.
 * 2. If deterministic returns 'match', return it immediately.
 * 3. If deterministic returns 'notFound' or 'ambiguous', try semantic grounding
 *    via embeddings (all-MiniLM-L6-v2). This catches synonyms like
 *    "sign in"↔"log in" that token overlap misses entirely.
 * 4. If embeddings are unavailable (package not installed / model download
 *    fails), return the original deterministic result unchanged.
 *
 * The deterministic result is always the first thing tried, so the fast path
 * is never broken. The fallback only costs an async call when deterministic
 * grounding already failed — which is exactly when the agent would otherwise
 * have to fall back to `look --visual`.
 */
export async function groundIntentWithFallback(intent: Intent, model: PageModel): Promise<GroundResult> {
  const deterministic = groundIntent(intent, model);

  // Fast path: deterministic match — return immediately, no embeddings
  if (deterministic.status === 'match') return deterministic;

  // Fallback path: deterministic failed — try semantic grounding
  if (deterministic.status === 'notFound' || deterministic.status === 'ambiguous') {
    try {
      const { semanticGroundIntent } = await import('./embeddings.js');
      const semantic = await semanticGroundIntent(intent, model);
      if (semantic.status === 'match') return semantic;
      // If semantic also failed, return whichever result has closer candidates
      if (semantic.status === 'notFound' && deterministic.status === 'notFound') {
        // Prefer the one with closer candidates (higher best score)
        const detBest = deterministic.closest[0]?.score ?? 0;
        const semBest = semantic.closest[0]?.score ?? 0;
        return semBest > detBest ? semantic : deterministic;
      }
      return semantic;
    } catch {
      // Embeddings unavailable (package not installed / download failed) —
      // return deterministic result. The agent can still use look --visual.
      return deterministic;
    }
  }

  return deterministic;
}
