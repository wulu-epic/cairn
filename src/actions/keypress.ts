/**
 * Keypress Action — press a key or key combination.
 *
 * Uses Playwright's keyboard.press() which supports single keys ("Enter",
 * "Escape", "Tab") and modifiers+key combos ("Control+a", "Shift+ArrowDown",
 * "Meta+v"). The key is pressed on the currently focused element.
 *
 * This is NOT ref-based (unlike click/type) — it operates on whatever element
 * currently has focus. The agent typically focuses an element first
 * (`cairn focus <ref>`) then presses a key. For typing text into a field,
 * use `cairn type` instead.
 *
 * docs/DESIGN.md §4.5: keypress is a one-line Playwright call. Common use cases:
 *   - Submit a form: `cairn keypress Enter` (after typing in a field)
 *   - Close a dialog: `cairn keypress Escape`
 *   - Tab between fields: `cairn keypress Tab`
 *   - Select all: `cairn keypress Control+a`
 *   - Copy/paste: `cairn keypress Control+c` / `Meta+v`
 */

import type { Page } from 'playwright';

export interface KeypressResult {
  success: boolean;
  message: string;
}

/**
 * Map common key aliases to Playwright key names.
 * Accepts both human names ("enter", "esc") and Playwright names ("Enter", "Escape").
 */
const KEY_ALIASES: Record<string, string> = {
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',
  home: 'Home',
  end: 'End',
};

/**
 * Normalize a key name: handle aliases, casing, and modifier prefixes.
 * "control+a" → "Control+a", "ENTER" → "Enter", "cmd+c" → "Meta+c"
 */
export function normalizeKey(key: string): string {
  // Split on '+' to handle modifier combos
  const parts = key.split('+').map((p) => p.trim());

  const normalized = parts.map((part) => {
    const lower = part.toLowerCase();
    // Modifier aliases
    if (lower === 'ctrl' || lower === 'control') return 'Control';
    if (lower === 'cmd' || lower === 'meta' || lower === 'command') return 'Meta';
    if (lower === 'shift') return 'Shift';
    if (lower === 'alt' || lower === 'option' || lower === 'opt') return 'Alt';
    // Key aliases (enter, esc, tab, arrows, etc.)
    if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
    // Single letter keys — keep lowercase (Playwright uses "a" not "A")
    if (part.length === 1) return part.toLowerCase();
    // Otherwise return as-is (F1, F2, etc. are already correct)
    return part;
  });

  return normalized.join('+');
}

/** Validate that a key name is a recognized Playwright key. */
export function isValidKey(key: string): boolean {
  const normalized = normalizeKey(key);
  // Basic validation: non-empty, alphanumeric-ish or a known key
  if (!normalized || normalized.length === 0) return false;
  return /^[A-Za-z0-9+]+$/.test(normalized);
}

export async function keypress(page: Page, key: string): Promise<KeypressResult> {
  const normalized = normalizeKey(key);

  if (!isValidKey(key)) {
    return {
      success: false,
      message: `invalid key "${key}". Use a key name like "Enter", "Escape", "Tab", or a combo like "Control+a", "Shift+ArrowDown".`,
    };
  }

  // Report what element currently has focus (for the result message)
  const focusedInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    return {
      tag: el.tagName.toLowerCase(),
      name: (el as HTMLElement).getAttribute('aria-label') ||
            (el as HTMLInputElement).placeholder ||
            (el as HTMLElement).getAttribute('data-cairn-ref') ||
            '',
    };
  }).catch(() => null);

  try {
    await page.keyboard.press(normalized);
  } catch {
    return {
      success: false,
      message: `could not press key "${normalized}" — keyboard input may be blocked.`,
    };
  }

  // Small delay for any JS handlers / navigation to settle
  await page.waitForTimeout(200);

  const focusDesc = focusedInfo
    ? ` on focused ${focusedInfo.tag}${focusedInfo.name ? ` "${focusedInfo.name}"` : ''}`
    : ' (no focused element)';

  return {
    success: true,
    message: `pressed ${normalized}${focusDesc}`,
  };
}
