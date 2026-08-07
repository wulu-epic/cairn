import { describe, it, expect, vi } from 'vitest';
import { groundIntent, groundIntentWithFallback, renderGroundResult, levenshtein, canonicalizePhrase, stemToken, expandAbbreviation } from './grounding.js';
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

// ─── Synonym matching (canonicalization) ──────────────────────

describe('groundIntent — synonym matching', () => {
  it('matches "log in" to a "Sign In" button (zero token overlap without dictionary)', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'log in' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "login" to a "Sign In" button', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'login' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "log out" to a "Sign Out" button', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign Out', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'log out' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "continue" to a "Submit" button', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'continue' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "e-mail" to an "Email" field for type intents', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'textbox', name: 'Email', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'type', target: 'e-mail', text: 'test@test.com' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "dismiss" to a "Cancel" button', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Cancel', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'dismiss' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "preferences" to a "Settings" link', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'link', name: 'Settings', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'navigate', target: 'preferences' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('does NOT canonicalize "login" inside "logintoken" (word boundaries)', () => {
    expect(canonicalizePhrase('logintoken')).toBe('logintoken');
  });

  it('canonicalizes both target and node text, so "register" matches "Sign Up"', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign Up', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'register' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });
});

// ─── Light stemming ────────────────────────────────────────────

describe('stemToken', () => {
  it('strips -ing (clicking → click)', () => {
    expect(stemToken('clicking')).toBe('click');
  });

  it('strips -ed (clicked → click, disabled → disabl)', () => {
    expect(stemToken('clicked')).toBe('click');
    // "disabled" → "disabl" (not "disable") — the root ends in 'e' but a
    // simple suffix stripper can't know that. The Levenshtein fuzzy matcher
    // catches the 1-char gap (disabl ≈ disable, distance 1).
    expect(stemToken('disabled')).toBe('disabl');
  });

  it('strips -s (settings → setting)', () => {
    expect(stemToken('settings')).toBe('setting');
  });

  it('strips -es (boxes → box)', () => {
    expect(stemToken('boxes')).toBe('box');
  });

  it('does NOT strip -ss (class stays class)', () => {
    expect(stemToken('class')).toBe('class');
  });

  it('does NOT stem words ≤ 4 chars (yes stays yes)', () => {
    expect(stemToken('yes')).toBe('yes');
    expect(stemToken('this')).toBe('this');
  });

  it('does NOT strip -ing from root nouns (setting stays setting)', () => {
    expect(stemToken('setting')).toBe('setting');
    expect(stemToken('warning')).toBe('warning');
  });

  it('strips -est (smallest → small)', () => {
    expect(stemToken('smallest')).toBe('small');
  });

  it('strips -er (smaller → small)', () => {
    expect(stemToken('smaller')).toBe('small');
  });
});

describe('groundIntent — morphological variants via stemming', () => {
  it('matches "clicking" to a "Click" button', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Click', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'clicking' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "settings" to a "Setting" link', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'link', name: 'Setting', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'navigate', target: 'settings' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "disabled" to a "Disable" toggle', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'switch', name: 'Disable', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'disabled' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });
});

// ─── Abbreviation expansion ────────────────────────────────────

describe('expandAbbreviation', () => {
  it('expands pwd → password', () => {
    expect(expandAbbreviation('pwd')).toBe('password');
  });

  it('expands btn → button', () => {
    expect(expandAbbreviation('btn')).toBe('button');
  });

  it('expands cfg → config', () => {
    expect(expandAbbreviation('cfg')).toBe('config');
  });

  it('expands qty → quantity', () => {
    expect(expandAbbreviation('qty')).toBe('quantity');
  });

  it('passes through non-abbreviations unchanged', () => {
    expect(expandAbbreviation('submit')).toBe('submit');
    expect(expandAbbreviation('email')).toBe('email');
  });
});

describe('groundIntent — abbreviation matching', () => {
  it('matches "pwd" to a "Password" field for type intents', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'textbox', name: 'Password', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'type', target: 'pwd', text: 'secret123' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "btn" to a "Button" label (via expansion + overlap)', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit Button', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'click', target: 'submit btn' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "cfg" to a "Config" link', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'link', name: 'Config', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'navigate', target: 'cfg' }, model);
    expect(result.status).toBe('match');
    if (result.status === 'match') expect(result.ref).toBe('e1');
  });

  it('matches "qty" to a "Quantity" field', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'spinbutton', name: 'Quantity', interactive: true }),
    ]);
    const result = groundIntent({ kind: 'type', target: 'qty', text: '3' }, model);
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
// Uses "authenticate" — a synonym NOT in the static dictionary — so deterministic
// grounding fails and the embeddings fallback path is exercised.
vi.mock('../intent/embeddings.js', () => ({
  semanticGroundIntent: vi.fn(async (intent: { target: string; kind: string }, model: { refIndex: Map<string, unknown> }) => {
    if (intent.target === 'authenticate') {
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

  it('falls back to embeddings for synonym not in dictionary (authenticate ↔ sign in)', async () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    // "authenticate" is not in the synonym dictionary → deterministic returns notFound.
    // The embeddings fallback should catch the semantic similarity.
    const result = await groundIntentWithFallback({ kind: 'click', target: 'authenticate' }, model);
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
    const result = await groundIntentWithFallback({ kind: 'click', target: 'authenticate' }, model);
    // Should return the deterministic notFound, not crash
    expect(result.status).toBe('notFound');

    // Restore the mock
    mockFn.mockImplementation(async (intent: { target: string; kind: string }, mdl: { refIndex: Map<string, unknown> }) => {
      if (intent.target === 'authenticate') {
        const node = mdl.refIndex.get('e1');
        if (node) return { status: 'match', ref: 'e1', node, score: 0.78, reasons: ['semantic similarity: 78%'] };
      }
      return { status: 'notFound', closest: [] };
    });
  });
});
