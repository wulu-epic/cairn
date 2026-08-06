/**
 * Unit tests for Leap 4 (Page Model as Query) — tests the pure query functions
 * (parseQueryType, queryMatch, queryPrimaryAction, queryFormFields) with mock
 * PageModels from test-utils.ts. No browser needed.
 */
import { describe, it, expect } from 'vitest';
import { parseQueryType, queryMatch, queryPrimaryAction, queryFormFields, renderQueryResult } from './query.js';
import { makeNode, makeModel } from '../test-utils.js';

// ─── parseQueryType ────────────────────────────────────────────

describe('parseQueryType — query type detection', () => {
  it('detects diff queries', () => {
    expect(parseQueryType('what changed').type).toBe('diff');
    expect(parseQueryType('what is the diff').type).toBe('diff');
    expect(parseQueryType('changes since last step').type).toBe('diff');
    expect(parseQueryType('delta').type).toBe('diff');
    expect(parseQueryType("what's changed").type).toBe('diff');
  });

  it('detects primary-action queries', () => {
    expect(parseQueryType('primary action').type).toBe('primary-action');
    expect(parseQueryType('main action').type).toBe('primary-action');
    expect(parseQueryType('primary button').type).toBe('primary-action');
    expect(parseQueryType('main cta').type).toBe('primary-action');
    expect(parseQueryType('call to action').type).toBe('primary-action');
  });

  it('detects form-fields queries', () => {
    expect(parseQueryType('form fields').type).toBe('form-fields');
    expect(parseQueryType('input fields').type).toBe('form-fields');
    expect(parseQueryType('typeable').type).toBe('form-fields');
    expect(parseQueryType('all inputs').type).toBe('form-fields');
    expect(parseQueryType('fillable').type).toBe('form-fields');
  });

  it('defaults to match for unknown questions', () => {
    expect(parseQueryType('submit button').type).toBe('match');
    expect(parseQueryType('sign in').type).toBe('match');
    expect(parseQueryType('email').type).toBe('match');
  });

  it('extracts the target for match queries', () => {
    const q = parseQueryType('submit button');
    expect(q.type).toBe('match');
    expect(q.target).toBe('submit button');
  });

  it('strips query prefixes from match targets', () => {
    expect(parseQueryType('find the sign in button').target).toBe('sign in button');
    expect(parseQueryType('where is the email field').target).toBe('email field');
    expect(parseQueryType('which elements match submit').target).toBe('submit');
    expect(parseQueryType('show me the login form').target).toBe('login form');
  });

  it('extracts region from the question', () => {
    expect(parseQueryType('primary action in the main').region).toBe('main');
    expect(parseQueryType('form fields in the form').region).toBe('form');
    expect(parseQueryType('submit button in the nav').region).toBe('nav');
  });
});

// ─── queryMatch ─────────────────────────────────────────────────

describe('queryMatch — find elements by text', () => {
  it('finds a button by name', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = queryMatch('sign in', model);
    expect(result.success).toBe(true);
    expect(result.ref).toBe('e1');
    expect(result.answer).toContain('button');
    expect(result.answer).toContain('Sign In');
    expect(result.answer).toContain('[e1]');
  });

  it('returns not found when no element matches', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = queryMatch('totally nonexistent thing', model);
    expect(result.success).toBe(false);
    expect(result.answer).toContain('not found');
  });

  it('reports ambiguous when multiple elements match equally', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = queryMatch('submit', model);
    expect(result.success).toBe(false);
    expect(result.answer).toContain('ambiguous');
  });

  it('scopes to a region when provided', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Home', interactive: true, region: 'nav' }),
      makeNode({ ref: 'e2', role: 'button', name: 'Home', interactive: true, region: 'main' }),
    ]);
    const result = queryMatch('home', model, 'nav');
    expect(result.success).toBe(true);
    expect(result.ref).toBe('e1');
  });
});

// ─── queryPrimaryAction ─────────────────────────────────────────

describe('queryPrimaryAction — find the highest-priority action', () => {
  it('prefers a submit/sign-in button over other buttons', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Cancel', interactive: true }),
      makeNode({ ref: 'e2', role: 'button', name: 'Sign In', interactive: true }),
      makeNode({ ref: 'e3', role: 'button', name: 'Help', interactive: true }),
    ]);
    const result = queryPrimaryAction(model);
    expect(result.success).toBe(true);
    expect(result.ref).toBe('e2');
    expect(result.answer).toContain('Sign In');
  });

  it('prefers buttons over links', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'link', name: 'Home', interactive: true }),
      makeNode({ ref: 'e2', role: 'button', name: 'About', interactive: true }),
    ]);
    const result = queryPrimaryAction(model);
    expect(result.success).toBe(true);
    expect(result.ref).toBe('e2');
  });

  it('boosts elements in a form region', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true, region: 'main' }),
      makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true, region: 'form' }),
    ]);
    // Both have "Submit" text, but e2 is in a form region → higher priority
    const result = queryPrimaryAction(model);
    expect(result.success).toBe(true);
    expect(result.ref).toBe('e2');
  });

  it('scopes to a region when provided', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Sign In', interactive: true, region: 'main' }),
      makeNode({ ref: 'e2', role: 'button', name: 'Sign In', interactive: true, region: 'nav' }),
    ]);
    const result = queryPrimaryAction(model, 'nav');
    expect(result.success).toBe(true);
    expect(result.ref).toBe('e2');
  });

  it('returns failure when no interactive elements exist', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'paragraph', text: 'Hello', interactive: false }),
    ]);
    const result = queryPrimaryAction(model);
    expect(result.success).toBe(false);
    expect(result.answer).toContain('no interactive');
  });

  it('returns failure when region has no interactive elements', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true, region: 'main' }),
    ]);
    const result = queryPrimaryAction(model, 'nav');
    expect(result.success).toBe(false);
    expect(result.answer).toContain('nav');
  });
});

// ─── queryFormFields ────────────────────────────────────────────

describe('queryFormFields — find all typeable elements', () => {
  it('finds all typeable elements on the page', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'textbox', name: 'Email', interactive: true }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'Password', interactive: true }),
      makeNode({ ref: 'e3', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = queryFormFields(model);
    expect(result.success).toBe(true);
    expect(result.answer).toContain('2 typeable');
    expect(result.answer).toContain('[e1]');
    expect(result.answer).toContain('Email');
    expect(result.answer).toContain('[e2]');
    expect(result.answer).toContain('Password');
    // Button should NOT be listed
    expect(result.answer).not.toContain('Sign In');
  });

  it('includes searchboxes and comboboxes', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'searchbox', name: 'Search', interactive: true }),
      makeNode({ ref: 'e2', role: 'combobox', name: 'Country', interactive: true }),
      makeNode({ ref: 'e3', role: 'textbox', name: 'Email', interactive: true }),
    ]);
    const result = queryFormFields(model);
    expect(result.success).toBe(true);
    expect(result.answer).toContain('3 typeable');
    expect(result.answer).toContain('searchbox');
    expect(result.answer).toContain('combobox');
  });

  it('scopes to a region when provided', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'textbox', name: 'Search', interactive: true, region: 'nav' }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'Email', interactive: true, region: 'form' }),
    ]);
    const result = queryFormFields(model, 'form');
    expect(result.success).toBe(true);
    expect(result.answer).toContain('1 typeable');
    expect(result.answer).toContain('Email');
    expect(result.answer).not.toContain('Search');
  });

  it('returns failure when no typeable elements exist', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const result = queryFormFields(model);
    expect(result.success).toBe(false);
    expect(result.answer).toContain('no typeable');
  });

  it('handles a single field', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'textbox', name: 'Email', interactive: true }),
    ]);
    const result = queryFormFields(model);
    expect(result.success).toBe(true);
    // Should use singular "field" not "fields"
    expect(result.answer).toContain('1 typeable field');
    expect(result.answer).not.toContain('1 typeable fields');
  });
});

// ─── renderQueryResult ─────────────────────────────────────────

describe('renderQueryResult — compact output', () => {
  it('renders a match result as a compact one-liner', () => {
    const model = makeModel([
      makeNode({ ref: 'e15', role: 'button', name: 'Sign In', interactive: true }),
    ]);
    const result = queryMatch('sign in', model);
    const rendered = renderQueryResult(result);
    // Should be one line containing role, name, and ref
    expect(rendered).toContain('button');
    expect(rendered).toContain('Sign In');
    expect(rendered).toContain('[e15]');
    // Should be compact (under ~60 chars for a single element)
    expect(rendered.length).toBeLessThan(60);
  });
});
