/**
 * Type Action — fill a field by stable ref.
 *
 * Resolves ref → live element → Playwright fill (clears first, then types).
 * The agent never outputs coordinates.
 *
 * Handles wrapper elements: if the ref points to a container (e.g. a
 * <div role="combobox">) rather than the <input> itself, finds and types
 * into the child input/textarea/contenteditable.
 */

import type { Page } from 'playwright';

export interface TypeResult {
  success: boolean;
  message: string;
  ref: string;
}

export async function typeByRef(page: Page, ref: string, text: string): Promise<TypeResult> {
  const locator = page.locator(`[data-abt-ref="${ref}"]`);

  // The ref might point to a wrapper element (e.g. a <div role="combobox">)
  // that contains the actual <input>. Try the ref'd element first, then fall
  // back to a child input/textarea/contenteditable if it's not directly typeable.
  let target = locator;
  let usedChild = false;

  // Check if the ref'd element itself is visible and typeable
  let refVisible = false;
  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    refVisible = true;
  } catch {
    refVisible = false;
  }

  if (refVisible) {
    // Check if it's directly typeable (input, textarea, or contenteditable)
    const isTypeable = await locator.evaluate((el: HTMLElement) => {
      const tag = el.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }).catch(() => false);

    if (!isTypeable) {
      // Not directly typeable — look for a child input/textarea/contenteditable
      const child = locator.locator('input, textarea, [contenteditable=""], [contenteditable="true"]').first();
      try {
        await child.waitFor({ state: 'visible', timeout: 2000 });
        target = child;
        usedChild = true;
      } catch {
        // No visible child input — keep using the ref'd element (fill() may still work)
      }
    }
  } else {
    // The ref'd element isn't visible — try a visible child input directly
    const child = locator.locator('input, textarea, [contenteditable=""], [contenteditable="true"]').first();
    try {
      await child.waitFor({ state: 'visible', timeout: 3000 });
      target = child;
      usedChild = true;
    } catch {
      return {
        success: false,
        message: `ref ${ref} not found or not visible. Run "abt look" to see current refs, or "abt look --visual" for a marked screenshot.`,
        ref,
      };
    }
  }

  // Get element info for the result message
  const info = await target.evaluate((el: HTMLElement) => ({
    tag: el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '',
  })).catch(() => ({ tag: '', name: '' }));

  // Clear the field and type the text
  try {
    await target.fill(text, { timeout: 5000 });
  } catch {
    // fill() can fail on contenteditable — try click + keyboard.type as fallback
    try {
      await target.click({ timeout: 3000 });
      await target.fill('', { timeout: 2000 });
      await page.keyboard.type(text);
    } catch {
      return {
        success: false,
        message: `ref ${ref} found but could not type into it. The element may not accept text input.`,
        ref,
      };
    }
  }

  return {
    success: true,
    message: `typed "${text}" into [${ref}] ${info.tag}${info.name ? ` "${info.name}"` : ''}${usedChild ? ' (via child input)' : ''}`,
    ref,
  };
}
