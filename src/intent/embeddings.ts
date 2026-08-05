/**
 * Semantic Grounding Fallback — embeddings-based synonym matching.
 *
 * Used ONLY when deterministic grounding (token overlap + substring + Levenshtein)
 * returns notFound or ambiguous. Catches synonym/paraphrase mismatches that
 * dominate real UIs: "sign in" ↔ "log in", "submit" ↔ "continue", "email" ↔
 * "username" — without an LLM call and without breaking the deterministic
 * fast path.
 *
 * Uses @huggingface/transformers (all-MiniLM-L6-v2) loaded lazily on first use.
 * The model is ~25MB, downloaded once and cached. If the package is not
 * installed, the fallback is silently skipped — deterministic grounding
 * still works.
 *
 * COMPARISON.md item 8 / PRODUCTION.md Tier 1.2.
 */

import type { PageModel, EnhancedNode } from '../model/page-model.js';
import { getInteractiveNodes } from '../model/page-model.js';
import type { Intent } from './parser.js';
import type { GroundCandidate, GroundResult } from './grounding.js';
import { TYPEABLE_ROLES } from './grounding.js';

// ─── Lazy-loaded model (singleton) ─────────────────────────────

type ExtractorFn = (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

let extractor: ExtractorFn | null = null;
let loadPromise: Promise<ExtractorFn> | null = null;

const SEMANTIC_THRESHOLD = 0.55;  // minimum cosine similarity for a semantic match
const SEMANTIC_AMBIGUITY_MARGIN = 0.12;

/** Lazy-load the embedding pipeline (downloads model on first call). */
async function getExtractor(): Promise<ExtractorFn> {
  if (extractor) return extractor;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Dynamic import — if @huggingface/transformers is not installed, this throws
    // and the caller falls back to deterministic grounding.
    // @ts-ignore — optional dependency; types may not be available if not installed
    const transformers = await import('@huggingface/transformers');
    const pipe = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    extractor = pipe as ExtractorFn;
    return extractor;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null;  // allow retry on next call
    throw e;
  }
}

// ─── Embedding + similarity ────────────────────────────────────

/** Embed a text string into a normalized 384-dim vector. */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getExtractor();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/** Cosine similarity between two vectors (assumes normalized → dot product). */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;  // vectors are normalized, so dot product = cosine similarity
}

/** Semantic similarity between two text strings (0–1). */
export async function semanticSimilarity(a: string, b: string): Promise<number> {
  const [embA, embB] = await Promise.all([embed(a), embed(b)]);
  return cosineSimilarity(embA, embB);
}

// ─── Semantic grounding ────────────────────────────────────────

/** The searchable text for a node: name + text, combined. */
function nodeSearchText(node: EnhancedNode): string {
  return [node.name ?? '', node.text ?? ''].join(' ').trim();
}

/**
 * Ground an Intent using semantic similarity (embeddings).
 * Called only as a fallback when deterministic grounding fails.
 * Applies the same typeability/role/region bonuses as deterministic scoring.
 */
export async function semanticGroundIntent(intent: Intent, model: PageModel): Promise<GroundResult> {
  const interactiveNodes = getInteractiveNodes(model);
  if (interactiveNodes.length === 0) {
    return { status: 'notFound', closest: [] };
  }

  // Embed the target once
  const targetEmbed = await embed(intent.target ?? '');

  // Score each interactive node by semantic similarity
  const candidates: GroundCandidate[] = [];
  for (const node of interactiveNodes) {
    const text = nodeSearchText(node);
    if (!text) continue;

    const nodeEmbed = await embed(text);
    let score = cosineSimilarity(targetEmbed, nodeEmbed);
    const reasons = [`semantic similarity: ${(score * 100).toFixed(0)}%`];

    // Apply typeability bonus/penalty for type intents (same as deterministic)
    if (intent.kind === 'type') {
      const isTypeable = TYPEABLE_ROLES.includes(node.role)
        || node.interactivitySignals?.isEditable;
      if (isTypeable) {
        score += 0.10;
        reasons.push('typeable role');
      } else {
        score -= 0.30;
        reasons.push('non-typeable for type intent');
      }
    }

    // Role hint bonus
    if (intent.kind !== 'navigate' && 'roleHint' in intent && intent.roleHint) {
      const aliases: Record<string, string[]> = {
        button: ['button'], link: ['link'], textbox: ['textbox', 'searchbox', 'spinbutton'],
      };
      const acceptable = aliases[intent.roleHint] ?? [intent.roleHint];
      if (acceptable.includes(node.role)) {
        score += 0.05;
        reasons.push(`role match: ${node.role}`);
      }
    }

    // Navigate prefers links
    if (intent.kind === 'navigate' && node.role === 'link') {
      score += 0.05;
      reasons.push('navigate prefers link');
    }

    // Clamp
    score = Math.max(0, Math.min(1, score));
    candidates.push({ ref: node.ref, node, score, reasons });
  }

  candidates.sort((a, b) => b.score - a.score);
  const filtered = candidates.filter((c) => c.score > 0);

  if (filtered.length === 0 || filtered[0].score < SEMANTIC_THRESHOLD) {
    return { status: 'notFound', closest: filtered.slice(0, 5) };
  }

  const best = filtered[0];

  // Ambiguity check
  if (filtered.length > 1) {
    const second = filtered[1];
    if (second.score >= SEMANTIC_THRESHOLD && best.score - second.score <= SEMANTIC_AMBIGUITY_MARGIN) {
      return {
        status: 'ambiguous',
        candidates: filtered
          .filter((c) => c.score >= SEMANTIC_THRESHOLD && best.score - c.score <= SEMANTIC_AMBIGUITY_MARGIN)
          .slice(0, 5),
      };
    }
  }

  return { status: 'match', ref: best.ref, node: best.node, score: best.score, reasons: best.reasons };
}
