import { describe, it, expect } from 'vitest';
import { renderPage } from './renderer.js';
import { makeNode, makeModel } from '../test-utils.js';

// ─── Basic render ──────────────────────────────────────────────

describe('renderPage — basic output', () => {
  const model = makeModel([
    makeNode({ ref: 'e0', role: 'navigation', region: 'nav', children: [
      makeNode({ ref: 'e1', role: 'link', name: 'Home', interactive: true }),
    ]}),
    makeNode({ ref: 'e0b', role: 'main', region: 'main', children: [
      makeNode({ ref: 'e2', role: 'heading', name: 'Welcome' }),
      makeNode({ ref: 'e3', role: 'textbox', name: 'Email', interactive: true }),
      makeNode({ ref: 'e4', role: 'button', name: 'Submit', interactive: true }),
    ]}),
  ]);

  it('shows the page URL in the header', () => {
    const output = renderPage(model, {});
    expect(output).toContain('page: https://example.test');
  });

  it('includes region sections', () => {
    const output = renderPage(model, {});
    expect(output).toContain('▼ Navigation');
    expect(output).toContain('▼ Main');
  });

  it('shows interactive elements with refs', () => {
    const output = renderPage(model, {});
    expect(output).toContain('link "Home" [ref=e1]');
    expect(output).toContain('button "Submit" [ref=e4]');
  });

  it('shows interactive count in footer', () => {
    const output = renderPage(model, {});
    expect(output).toContain('3 interactive elements');
  });
});

// ─── Interactive-only mode ─────────────────────────────────────

describe('renderPage — interactiveOnly mode', () => {
  const model = makeModel([
    makeNode({ ref: 'e1', role: 'link', name: 'Home', interactive: true, region: 'nav' }),
    makeNode({ ref: 'e2', role: 'heading', name: 'Welcome', region: 'main' }),
    makeNode({ ref: 'e3', role: 'textbox', name: 'Email', interactive: true, region: 'main' }),
    makeNode({ ref: 'e4', role: 'button', name: 'Submit', interactive: true, region: 'main' }),
  ]);

  it('shows only interactive elements, grouped by region', () => {
    const output = renderPage(model, { interactiveOnly: true });
    expect(output).toContain('link "Home" [ref=e1]');
    expect(output).toContain('textbox "Email" [ref=e3]');
    expect(output).toContain('button "Submit" [ref=e4]');
  });

  it('excludes non-interactive nodes (heading)', () => {
    const output = renderPage(model, { interactiveOnly: true });
    expect(output).not.toContain('heading');
    expect(output).not.toContain('Welcome');
  });

  it('shows the interactive count in footer', () => {
    const output = renderPage(model, { interactiveOnly: true });
    expect(output).toContain('3 interactive elements');
  });
});

// ─── Focused region ────────────────────────────────────────────

describe('renderPage — focusedRegion', () => {
  const model = makeModel([
    makeNode({ ref: 'e0', role: 'navigation', region: 'nav', children: [
      makeNode({ ref: 'e1', role: 'link', name: 'Home', interactive: true }),
    ]}),
    makeNode({ ref: 'e0b', role: 'main', region: 'main', children: [
      makeNode({ ref: 'e2', role: 'button', name: 'Submit', interactive: true }),
    ]}),
  ]);

  it('shows region label in header', () => {
    const output = renderPage(model, { focusedRegion: 'nav' });
    expect(output).toContain('region: Navigation');
  });

  it('shows only the focused region content', () => {
    const output = renderPage(model, { focusedRegion: 'nav' });
    expect(output).toContain('link "Home"');
    expect(output).not.toContain('Submit');
  });
});

// ─── Media-rich warning ────────────────────────────────────────

describe('renderPage — media-rich warning', () => {
  it('warns when canvas is present', () => {
    const model = makeModel([], {
      mediaRich: { canvasCount: 1, webglCount: 0, shadowDomCount: 0 },
    });
    const output = renderPage(model, {});
    expect(output).toContain('media-rich');
    expect(output).toContain('1 canvas');
  });

  it('warns when shadow-DOM is present', () => {
    const model = makeModel([], {
      mediaRich: { canvasCount: 0, webglCount: 0, shadowDomCount: 2 },
    });
    const output = renderPage(model, {});
    expect(output).toContain('media-rich');
    expect(output).toContain('2 shadow-dom');
  });

  it('suggests look --visual in non-visual mode', () => {
    const model = makeModel([], {
      mediaRich: { canvasCount: 1, webglCount: 0, shadowDomCount: 0 },
    });
    const output = renderPage(model, {});
    expect(output).toContain('cairn look --visual');
  });

  it('references the marked screenshot in visual mode', () => {
    const model = makeModel([], {
      mediaRich: { canvasCount: 1, webglCount: 0, shadowDomCount: 0 },
    });
    const output = renderPage(model, { visualMode: true });
    expect(output).toContain('marked screenshot');
    expect(output).not.toContain('run "cairn look --visual"');
  });

  it('does not warn when page is not media-rich', () => {
    const model = makeModel([]);
    const output = renderPage(model, {});
    expect(output).not.toContain('media-rich');
  });
});
