import { describe, it, expect } from 'vitest';
import { formatAttrs } from './attr.js';
import type { ElementAttrs } from './attr.js';

/** Build a minimal ElementAttrs with sensible defaults. */
function makeAttrs(overrides: Partial<ElementAttrs> = {}): ElementAttrs {
  return {
    tag: 'button',
    role: 'button',
    name: '',
    classes: [],
    bbox: { x: 100, y: 200, width: 80, height: 30 },
    ...overrides,
  };
}

// ─── formatAttrs ───────────────────────────────────────────────

describe('formatAttrs', () => {
  it('shows tag + role in the header line', () => {
    const out = formatAttrs('e5', makeAttrs({ tag: 'button', role: 'button' }));
    expect(out.startsWith('[e5] button (button)')).toBe(true);
  });

  it('includes name when set', () => {
    const out = formatAttrs('e1', makeAttrs({ name: 'Submit' }));
    expect(out).toContain('name: "Submit"');
  });

  it('omits name line when empty', () => {
    const out = formatAttrs('e1', makeAttrs({ name: '' }));
    expect(out).not.toContain('name:');
  });

  it('shows value for input elements', () => {
    const out = formatAttrs('e2', makeAttrs({ tag: 'input', role: 'textbox', value: 'hello@example.com' }));
    expect(out).toContain('value: "hello@example.com"');
  });

  it('shows href for anchors', () => {
    const out = formatAttrs('e3', makeAttrs({ tag: 'a', role: 'link', href: 'https://example.com/page' }));
    expect(out).toContain('href: https://example.com/page');
  });

  it('shows checked state for checkboxes', () => {
    const out = formatAttrs('e4', makeAttrs({ tag: 'input', role: 'checkbox', type: 'checkbox', checked: true }));
    expect(out).toContain('checked: true');
    expect(out).toContain('type: checkbox');
  });

  it('shows classes when present', () => {
    const out = formatAttrs('e6', makeAttrs({ classes: ['btn', 'btn-primary', 'active'] }));
    expect(out).toContain('classes: btn btn-primary active');
  });

  it('omits classes line when empty', () => {
    const out = formatAttrs('e6', makeAttrs({ classes: [] }));
    expect(out).not.toContain('classes:');
  });

  it('shows aria-expanded when set', () => {
    const out = formatAttrs('e7', makeAttrs({ ariaExpanded: 'true' }));
    expect(out).toContain('aria-expanded: true');
  });

  it('omits aria-expanded when null/undefined', () => {
    const out = formatAttrs('e7', makeAttrs({ ariaExpanded: null }));
    expect(out).not.toContain('aria-expanded');
  });

  it('shows innerText when it differs from text', () => {
    const out = formatAttrs('e8', makeAttrs({ text: 'Total', innerText: 'Total $9.40' }));
    expect(out).toContain('innerText: "Total $9.40"');
  });

  it('omits innerText when identical to text', () => {
    const out = formatAttrs('e8', makeAttrs({ text: 'Hello', innerText: 'Hello' }));
    expect(out).not.toContain('innerText:');
  });

  it('shows bbox', () => {
    const out = formatAttrs('e9', makeAttrs({ bbox: { x: 10, y: 20, width: 100, height: 50 } }));
    expect(out).toContain('bbox: x=10 y=20 w=100 h=50');
  });

  it('shows disabled state', () => {
    const out = formatAttrs('e10', makeAttrs({ tag: 'button', role: 'button', disabled: true }));
    expect(out).toContain('disabled: true');
  });

  it('includes multiple attributes together', () => {
    const out = formatAttrs('e11', makeAttrs({
      tag: 'input', role: 'textbox', name: 'Email', type: 'email',
      placeholder: 'you@example.com', value: 'test@test.com', disabled: false,
    }));
    expect(out).toContain('name: "Email"');
    expect(out).toContain('type: email');
    expect(out).toContain('placeholder: "you@example.com"');
    expect(out).toContain('value: "test@test.com"');
    expect(out).toContain('disabled: false');
  });
});
