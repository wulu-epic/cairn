/**
 * Element Grounding — fuzzy-match an Intent's target to a page-model ref.
 *
 * DESIGN.md §4.3: grounding (not perception) is the bottleneck. This module
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
 * notFound), with a suggestion to run `abt look --visual` for visual grounding.
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

// ─── Helpers ───────────────────────────────────────────────────

/** Tokenize: lowercase, strip punctuation, split on whitespace. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** The searchable text for a node: name + text, combined. */
function nodeSearchText(node: EnhancedNode): string {
  return [node.name ?? '', node.text ?? ''].join(' ').trim();
}

/** Jaccard-like token overlap score: |intersection| / |union|. */
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
  return { score: union > 0 ? intersection / union : 0, matched };
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
const TYPEABLE_ROLES = ['textbox', 'searchbox', 'combobox', 'spinbutton', 'textarea'];

function scoreNode(node: EnhancedNode, intent: Intent): GroundCandidate {
  let score = 0;
  const reasons: string[] = [];

  const targetText = intent.target;
  const targetTokens = tokenize(targetText);
  const nodeText = nodeSearchText(node);
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
