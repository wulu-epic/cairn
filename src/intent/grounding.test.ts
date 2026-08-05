import { describe, it, expect, vi } from 'vitest';
import { groundIntent, groundIntentWithFallback, renderGroundResult, levenshtein } from './grounding.js';
import type { Intent } from './parser.js';
import { makeNode, makeModel } from '../test-utils.js';

// ─── Exact match ───────────────────────────────────────────────

describe('groundIntent — exact match', () => {
  it('matches a button by name (token overlap + substring)', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'sign in' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('scores exact matches above 0.7', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit Form', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'submit form' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.score).toBeGreaterThan(0.7);
  });
});

// ─── Typeability penalty ───────────────────────────────────────

describe('groundIntent — typeability penalty', () => {
  it('prefers a typeable input over a non-typeable span for type intents', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'generic', name: 'Search', interactive: true }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'search', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'type', target: 'search', text: 'hello' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e2');
  });

  it('rejects a non-typeable element for type intents (below threshold)', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'generic', name: 'Search', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'type', target: 'search', text: 'hello' }, model);
    // Span "Search" is penalized -0.55 for non-typeability → score ~0.25 < 0.35 threshold
    expect(result.status).toBe('notFound');
  });
});

// ─── Ambiguity ─────────────────────────────────────────────────

describe('groundIntent — ambiguity', () => {
  it('reports ambiguous when two nodes have identical scores', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'submit' }, model);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ─── Not found ─────────────────────────────────────────────────

describe('groundIntent — not found', () => {
  it('returns notFound when no node matches', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'xyzabcnotreal' }, model);
    expect(result.status).toBe('notFound');
  });

  it('returns notFound with empty closest when no interactive nodes exist', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'heading', name: 'Welcome', interactive: false }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'welcome' }, model);
    expect(result.status).toBe('notFound');
    if (result.status === 'notFound') expect(result.closest).toHaveLength(0);
  });
});

// ─── Role hint ─────────────────────────────────────────────────

describe('groundIntent — role hint', () => {
  it('matches with roleHint bonus', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'submit', roleHint: 'button' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('roleHint boost produces higher score than without', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const withoutHint = groundIntent({ kind: 'click', target: 'submit' }, model);
    const withHint = groundIntent({ kind: 'click', target: 'submit', roleHint: 'button' }, model);
    if (withoutHint.status === 'match' && withHint.status === 'match') {
      expect(withHint.score).toBeGreaterThan(withoutHint.score);
    }
  });
});

// ─── Region hint ───────────────────────────────────────────────

describe('groundIntent — region hint', () => {
  it('matches with region bonus', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true, region: 'nav' }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'submit', region: 'nav' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });
});

// ─── Navigate prefers links ────────────────────────────────────

describe('groundIntent — navigate prefers links', () => {
  it('matches a link for navigate intents', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'link', name: 'About', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'navigate', target: 'about' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });
});

// ─── renderGroundResult ────────────────────────────────────────

describe('renderGroundResult', () => {
  it('renders a match', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'sign in' }, model);
    const output = renderGroundResult(result);
    expect(output).toContain('matched [e1]');
    expect(output).toContain('button');
    expect(output).toContain('Sign In');
  });

  it('renders notFound', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'xyzabcnotreal' }, model);
    const output = renderGroundResult(result);
    expect(output).toContain('not found');
  });

  it('renders ambiguous with candidates', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'submit' }, model);
    const output = renderGroundResult(result);
    expect(output).toContain('ambiguous');
    expect(output).toContain('[e1]');
    expect(output).toContain('[e2]');
  });
});

// ─── Levenshtein distance ──────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns the length of the other string when one is empty', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
  });

  it('computes edit distance for typos', () => {
    expect(levenshtein('submt', 'submit')).toBe(1); // missing 'i'
    expect(levenshtein('signin', 'sign')).toBe(2);  // extra 'in'
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

// ─── Fuzzy token matching (via groundIntent) ───────────────────

describe('groundIntent — fuzzy (Levenshtein) token matching', () => {
  it('matches a single-character typo in the target', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    // "submt" is edit-distance 1 from "submit" → fuzzy match should bring it above threshold
    const result = groundIntent({ kind: 'click', target: 'submt' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('still does NOT match completely unrelated words', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'xyzabc' }, model);
    expect(result.status).toBe('notFound');
  });
});

// ─── groundIntentWithFallback (embeddings fallback) ────────────

// Mock the embeddings module so tests don't need @huggingface/transformers installed.
// The mock simulates semantic similarity for the "sign in"↔"log in" synonym case.
vi.mock('../intent/embeddings.js', () => ({
  semanticGroundIntent: vi.fn(async (intent: { target: string; kind: string }, model: { refIndex: Map<string, unknown> }) => {
    // Simulate: "log in" semantically matches a "Sign In" button
    if (intent.target === 'log in') {
      const node = model.refIndex.get('e1');
      if (node) {
        return {
          status: 'match',
          ref: 'e1',
          node,
          score: 0.78,
          reasons: ['semantic similarity: 78%'],
        };
      }
    }
    return { status: 'notFound', closest: [] };
  }),
}));

describe('groundIntentWithFallback', () => {
  it('returns deterministic match immediately (no embeddings call)', async () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = await groundIntentWithFallback({ kind: 'click', target: 'sign in' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('falls back to embeddings for synonym mismatch (log in ↔ sign in)', async () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    // "log in" has zero token overlap with "sign in" → deterministic returns notFound.
    // The embeddings fallback should catch the synonym.
    const result = await groundIntentWithFallback({ kind: 'click', target: 'log in' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('returns deterministic result when embeddings also fail', async () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    // "xyzabc" won't match deterministically or semantically → notFound
    const result = await groundIntentWithFallback({ kind: 'click', target: 'xyzabc' }, model);
    expect(result.status).toBe('notFound');
  });

  it('degrades gracefully when embeddings module is unavailable', async () => {
    // Reset the mock to throw, simulating @huggingface/transformers not installed
    const { semanticGroundIntent } = await import('./embeddings.js');
    const mockFn = semanticGroundIntent as unknown as { mockImplementation: (fn: unknown) => void };
    mockFn.mockImplementation(() => { throw new Error('module not found'); });

    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = await groundIntentWithFallback({ kind: 'click', target: 'log in' }, model);
    // Should return the deterministic notFound, not crash
    expect(result.status).toBe('notFound');

    // Restore the mock
    mockFn.mockImplementation(async (intent: { target: string; kind: string }, mdl: { refIndex: Map<string, unknown> }) => {
      if (intent.target === 'log in') {
        const node = mdl.refIndex.get('e1');
        if (node) return { status: 'match', ref: 'e1', node, score: 0.78, reasons: ['semantic similarity: 78%'] };
      }
      return { status: 'notFound', closest: [] };
    });
  });
});
