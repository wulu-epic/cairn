import { describe, it, expect } from 'vitest';
import { renderPage, type RenderOptions } from '../render/renderer.js';
import { extractFromModel, parseSchema } from '../intent/extract.js';
import { makeNode, makeModel } from '../test-utils.js';
import { getInteractiveNodes } from './page-model.js';

// ─── Renderer iframe markers ──────────────────────────────────

describe('renderer — iframe markers', () => {
  it('shows (iframe) marker for same-origin iframe', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'iframe', name: 'Embedded Form', isIframe: true,
        children: [
          makeNode({ ref: 'e2', role: 'textbox', name: 'email', interactive: true }),
        ],
      }),
    ]);
    const output = renderPage(model);
    expect(output).toContain('(iframe)');
    expect(output).toContain('[ref=e1]');
  });

  it('shows (cross-origin iframe) marker for inaccessible iframe', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'iframe', isIframe: true, frameInaccessible: true,
        children: [],
      }),
    ]);
    const output = renderPage(model);
    expect(output).toContain('(cross-origin iframe)');
  });

  it('does not show iframe marker for non-iframe nodes', () => {
    const model = makeModel([
      makeNode({ ref: 'e1', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const output = renderPage(model);
    expect(output).not.toContain('(iframe)');
    expect(output).not.toContain('(cross-origin iframe)');
  });

  it('renders iframe children as nested subtree', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'iframe', isIframe: true,
        children: [
          makeNode({ ref: 'e2', role: 'textbox', name: 'email', interactive: true }),
          makeNode({ ref: 'e3', role: 'button', name: 'Submit', interactive: true }),
        ],
      }),
    ]);
    const output = renderPage(model, { showAll: true });
    expect(output).toContain('[ref=e2]');
    expect(output).toContain('[ref=e3]');
  });
});

// ─── Extract with iframe content ──────────────────────────────

describe('extract — finds content inside iframe children', () => {
  it('extracts fields from nodes inside an iframe', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'iframe', isIframe: true,
        children: [
          makeNode({ ref: 'e2', role: 'heading', text: 'Form Title' }),
          makeNode({ ref: 'e3', role: 'textbox', name: 'email' }),
        ],
      }),
    ]);
    const fields = parseSchema('title, email');
    const result = extractFromModel(model, fields);
    expect(result.success).toBe(true);
    const data = result.data as Record<string, string>;
    expect(data['title']).toContain('Form Title');
    expect(data['email']).toContain('email');
  });
});

// ─── refIndex + getInteractiveNodes with iframes ──────────────

describe('page model — iframe children in refIndex', () => {
  it('includes iframe children in the refIndex', () => {
    const iframeNode = makeNode({
      ref: 'e1', role: 'iframe', isIframe: true,
      children: [
        makeNode({ ref: 'e2', role: 'button', name: 'Click Me', interactive: true }),
      ],
    });
    const model = makeModel([iframeNode]);
    expect(model.refIndex.has('e2')).toBe(true);
    const node = model.refIndex.get('e2')!;
    expect(node.role).toBe('button');
    expect(node.name).toBe('Click Me');
  });

  it('getInteractiveNodes finds interactive elements inside iframes', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'iframe', isIframe: true,
        children: [
          makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true }),
          makeNode({ ref: 'e3', role: 'textbox', name: 'search', interactive: true }),
        ],
      }),
      makeNode({ ref: 'e4', role: 'button', name: 'Outer', interactive: true }),
    ]);
    const interactive = getInteractiveNodes(model);
    expect(interactive).toHaveLength(3); // e2, e3, e4
    const refs = interactive.map((n) => n.ref);
    expect(refs).toContain('e2');
    expect(refs).toContain('e3');
    expect(refs).toContain('e4');
  });

  it('getInteractiveNodes skips cross-origin iframe (no children)', () => {
    const model = makeModel([
      makeNode({
        ref: 'e1', role: 'iframe', isIframe: true, frameInaccessible: true,
        children: [],
      }),
      makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true }),
    ]);
    const interactive = getInteractiveNodes(model);
    expect(interactive).toHaveLength(1); // only e2
  });
});
