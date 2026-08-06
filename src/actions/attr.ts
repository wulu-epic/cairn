/**
 * Attr Action — read an element's exact state by stable ref.
 *
 * Given a ref, returns the element's tag, role, accessible name, direct text,
 * input value, href, classes, checked/disabled state, aria-* state attributes,
 * and bounding box. This is the "read one element" primitive — what lets the
 * agent confirm a toggle's active class, read a cart's innerText, or track a
 * button's aria-pressed state without a full page dump or a screenshot.
 *
 * The pure formatting logic (formatAttrs) is extracted for unit testing.
 */

import type { Page } from 'playwright';

export interface ElementAttrs {
  tag: string;
  role: string;
  name: string;
  text?: string;
  value?: string;
  href?: string;
  id?: string;
  type?: string;
  placeholder?: string;
  classes: string[];
  checked?: boolean;
  disabled?: boolean;
  ariaExpanded?: string | null;
  ariaSelected?: string | null;
  ariaPressed?: string | null;
  innerText?: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface AttrResult {
  success: boolean;
  message: string;
  ref: string;
  attrs?: ElementAttrs;
}

/**
 * Format an ElementAttrs object as a compact, agent-readable string.
 * Pure function — no browser dependency, unit-testable.
 */
export function formatAttrs(ref: string, attrs: ElementAttrs): string {
  const lines: string[] = [];
  lines.push(`[${ref}] ${attrs.tag} (${attrs.role})`);

  if (attrs.name) lines.push(`  name: "${attrs.name}"`);
  if (attrs.text) lines.push(`  text: "${attrs.text}"`);
  if (attrs.value !== undefined) lines.push(`  value: "${attrs.value}"`);
  if (attrs.placeholder) lines.push(`  placeholder: "${attrs.placeholder}"`);
  if (attrs.href) lines.push(`  href: ${attrs.href}`);
  if (attrs.id) lines.push(`  id: ${attrs.id}`);
  if (attrs.type) lines.push(`  type: ${attrs.type}`);

  // State attributes — only show when set
  if (attrs.checked !== undefined) lines.push(`  checked: ${attrs.checked}`);
  if (attrs.disabled !== undefined) lines.push(`  disabled: ${attrs.disabled}`);
  if (attrs.ariaExpanded !== null && attrs.ariaExpanded !== undefined) lines.push(`  aria-expanded: ${attrs.ariaExpanded}`);
  if (attrs.ariaSelected !== null && attrs.ariaSelected !== undefined) lines.push(`  aria-selected: ${attrs.ariaSelected}`);
  if (attrs.ariaPressed !== null && attrs.ariaPressed !== undefined) lines.push(`  aria-pressed: ${attrs.ariaPressed}`);

  if (attrs.classes.length > 0) lines.push(`  classes: ${attrs.classes.join(' ')}`);

  // innerText shows the full visible text of the element (including children) —
  // useful for reading a cart total or a list item that contains nested spans.
  if (attrs.innerText && attrs.innerText !== attrs.text) {
    lines.push(`  innerText: "${attrs.innerText}"`);
  }

  lines.push(`  bbox: x=${attrs.bbox.x} y=${attrs.bbox.y} w=${attrs.bbox.width} h=${attrs.bbox.height}`);

  return lines.join('\n');
}

/**
 * Read an element's attributes by stable ref.
 * Resolves ref → live element via data-cairn-ref attribute, then reads state.
 */
export async function attrByRef(page: Page, ref: string): Promise<AttrResult> {
  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  // Verify the element exists
  try {
    await locator.waitFor({ state: 'attached', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found. Run "cairn look" to see current refs, or "cairn look --visual" for a marked screenshot.`,
      ref,
    };
  }

  const attrs = await locator.evaluate((el: HTMLElement) => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || tag;

    // Accessible name (mirrors page-model.ts logic)
    let name = el.getAttribute('aria-label') || '';
    if (!name) {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl) name = (labelEl.textContent || '').trim().slice(0, 100);
      }
    }
    if (!name && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
      const id = el.id;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label) name = (label.textContent || '').trim().slice(0, 100);
      }
      const parentLabel = el.closest('label');
      if (parentLabel) name = (parentLabel.textContent || '').trim().slice(0, 100);
    }

    // Direct text (text node children only — not descendants)
    let directText = '';
    for (let i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) directText += el.childNodes[i].textContent;
    }
    directText = directText.trim();

    const inputEl = el as HTMLInputElement;
    const rect = el.getBoundingClientRect();

    return {
      tag,
      role,
      name: name || '',
      text: directText.slice(0, 200) || undefined,
      value: (tag === 'input' || tag === 'textarea' || tag === 'select') ? inputEl.value : undefined,
      href: (tag === 'a') ? (el as HTMLAnchorElement).href : undefined,
      id: el.id || undefined,
      type: (tag === 'input') ? (inputEl.type || undefined) : undefined,
      placeholder: (tag === 'input' || tag === 'textarea') ? (inputEl.placeholder || undefined) : undefined,
      classes: Array.from(el.classList),
      checked: (tag === 'input' && (inputEl.type === 'checkbox' || inputEl.type === 'radio')) ? inputEl.checked : undefined,
      disabled: (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') ? (el as HTMLButtonElement).disabled : undefined,
      ariaExpanded: el.getAttribute('aria-expanded'),
      ariaSelected: el.getAttribute('aria-selected'),
      ariaPressed: el.getAttribute('aria-pressed'),
      innerText: (el.innerText || '').trim().slice(0, 500) || undefined,
      bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    } as ElementAttrs;
  }).catch(() => null);

  if (!attrs) {
    return {
      success: false,
      message: `ref ${ref} found but could not read attributes (element may be detached).`,
      ref,
    };
  }

  return {
    success: true,
    message: formatAttrs(ref, attrs),
    ref,
    attrs,
  };
}
