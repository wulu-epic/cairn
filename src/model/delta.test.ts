import { describe, it, expect } from 'vitest';
import { computeDelta, renderDelta } from './delta.js';
import { makeNode, makeModel } from '../test-utils.js';

// ─── computeDelta ──────────────────────────────────────────────

describe('computeDelta — added nodes', () => {
  it('detects a newly added node', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'Email', interactive: true }),
    ]);
    const delta = computeDelta(prev, curr);
    expect(delta.nodes).toHaveLength(1);
    expect(delta.nodes[0].change).toBe('added');
    expect(delta.nodes[0].ref).toBe('e2');
    expect(delta.nodes[0].after?.interactive).toBe(true);
  });
});

describe('computeDelta — removed nodes', () => {
  it('detects a removed node', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'link', name: 'Home', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const delta = computeDelta(prev, curr);
    const removed = delta.nodes.filter((d) => d.change === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].ref).toBe('e2');
    expect(removed[0].before?.name).toBe('Home');
  });
});

describe('computeDelta — changed nodes', () => {
  it('detects a name change', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Old Label', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'New Label', interactive: true }),
    ]);
    const delta = computeDelta(prev, curr);
    expect(delta.nodes).toHaveLength(1);
    expect(delta.nodes[0].change).toBe('changed');
    expect(delta.nodes[0].before?.name).toBe('Old Label');
    expect(delta.nodes[0].after?.name).toBe('New Label');
  });

  it('detects a text change', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'paragraph', text: 'old content' }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'paragraph', text: 'new content' }),
    ]);
    const delta = computeDelta(prev, curr);
    expect(delta.nodes).toHaveLength(1);
    expect(delta.nodes[0].change).toBe('changed');
    expect(delta.nodes[0].before?.text).toBe('old content');
    expect(delta.nodes[0].after?.text).toBe('new content');
  });

  it('detects an interactivity change', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: false }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const delta = computeDelta(prev, curr);
    expect(delta.nodes).toHaveLength(1);
    expect(delta.nodes[0].change).toBe('changed');
    expect(delta.nodes[0].before?.interactive).toBe(false);
    expect(delta.nodes[0].after?.interactive).toBe(true);
  });
});

describe('computeDelta — URL change', () => {
  it('detects when the URL changes', () => {
    const prev = makeModel([], { url: 'https://old.test' });
    const curr = makeModel([], { url: 'https://new.test' });
    const delta = computeDelta(prev, curr);
    expect(delta.urlChanged).toBe(true);
    expect(delta.oldUrl).toBe('https://old.test');
    expect(delta.newUrl).toBe('https://new.test');
  });

  it('does not report a URL change when URLs are identical', () => {
    const prev = makeModel([], { url: 'https://same.test' });
    const curr = makeModel([], { url: 'https://same.test' });
    const delta = computeDelta(prev, curr);
    expect(delta.urlChanged).toBe(false);
  });
});

describe('computeDelta — no changes', () => {
  it('reports no changes for identical models', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const delta = computeDelta(model, model);
    expect(delta.nodes).toHaveLength(0);
    expect(delta.urlChanged).toBe(false);
    expect(delta.summary).toBe('no changes');
  });
});

describe('computeDelta — summary', () => {
  it('builds a summary with added, removed, and changed counts', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Old', interactive: true }),
      makeNode({ ref: 'e2', role: 'link', name: 'Remove Me', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'New', interactive: true }),
      makeNode({ ref: 'e3', role: 'textbox', name: 'Added', interactive: true }),
    ]);
    const delta = computeDelta(prev, curr);
    // e1: changed, e2: removed, e3: added — same URL so no url in summary
    expect(delta.summary).toBe('+1 added, -1 removed, ~1 changed');
  });

  it('includes URL change in summary', () => {
    const prev = makeModel([], { url: 'https://a.test' });
    const curr = makeModel([], { url: 'https://b.test' });
    const delta = computeDelta(prev, curr);
    expect(delta.summary).toContain('url:');
  });
});

// ─── renderDelta ───────────────────────────────────────────────

describe('renderDelta — output format', () => {
  it('renders added nodes with + prefix', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'Email', interactive: true }),
    ]);
    const output = renderDelta(computeDelta(prev, curr));
    expect(output).toContain('+ [e2]');
    expect(output).toContain('textbox');
    expect(output).toContain('new');
  });

  it('renders removed nodes with - prefix', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'link', name: 'Home', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const output = renderDelta(computeDelta(prev, curr));
    expect(output).toContain('- [e2]');
    expect(output).toContain('removed');
  });

  it('renders changed nodes with ~ prefix', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Old', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'New', interactive: true }),
    ]);
    const output = renderDelta(computeDelta(prev, curr));
    expect(output).toContain('~ [e1]');
    expect(output).toContain('Old');
    expect(output).toContain('New');
  });

  it('renders navigation on URL change', () => {
    const prev = makeModel([], { url: 'https://old.test' });
    const curr = makeModel([], { url: 'https://new.test' });
    const output = renderDelta(computeDelta(prev, curr));
    expect(output).toContain('navigated:');
    expect(output).toContain('https://old.test');
    expect(output).toContain('https://new.test');
  });

  it('renders "no changes detected" for identical models', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const output = renderDelta(computeDelta(model, model));
    expect(output).toContain('no changes detected');
  });

  it('includes the summary line in parentheses', () => {
    const prev = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const curr = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
      makeNode({ ref: 'e2', role: 'textbox', name: 'Email', interactive: true }),
    ]);
    const output = renderDelta(computeDelta(prev, curr));
    expect(output).toContain('(+1 added)');
  });
});
