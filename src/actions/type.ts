/**
 * Type Action — fill a field by stable ref.
 *
 * Resolves ref → live element → Playwright fill (clears first, then types).
 * The agent never outputs coordinates.
 */

import type { Page } from 'playwright';

export interface TypeResult {
  success: boolean;
  message: string;
  ref: string;
}

export async function typeByRef(page: Page, ref: string, text: string): Promise<TypeResult> {
  const locator = page.locator(`[data-abt-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found or not visible. Run "abt look" to see current refs, or "abt look --visual" for a marked screenshot.`,
      ref,
    };
  }

  // Get element info for the result message
  const info = await locator.evaluate((el: HTMLElement) => ({
    tag: el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
  })).catch(() => ({ tag: '', name: '' }));

  // Clear the field and type the text
  await locator.fill(text, { timeout: 5000 });

  return {
    success: true,
    message: `typed "${text}" into [${ref}] ${info.tag}${info.name ? ` "${info.name}"` : ''}`,
    ref,
  };
}
