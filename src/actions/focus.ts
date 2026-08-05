/**
 * Focus Action — focus an element or zoom into a region by ref.
 *
 * For region focus: saves the focused region to session state (the renderer
 * zooms into that subtree on the next "look").
 * For ref focus: uses Playwright to programmatically focus the element
 * (useful for focusing a specific input before typing).
 */

import type { Page } from 'playwright';
import type { SessionManager } from '../session/session.js';

export interface FocusResult {
  success: boolean;
  message: string;
}

export async function focusByRef(page: Page, ref: string): Promise<FocusResult> {
  const locator = page.locator(`[data-abt-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found or not visible. Run "abt look" to see current refs.`,
    };
  }

  await locator.focus({ timeout: 5000 });

  const info = await locator.evaluate((el: HTMLElement) => ({
    tag: el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
  })).catch(() => ({ tag: '', name: '' }));

  return {
    success: true,
    message: `focused [${ref}] ${info.tag}${info.name ? ` "${info.name}"` : ''}`,
  };
}

/** Focus a region (saves to session state for the renderer to zoom into). */
export function focusRegion(session: SessionManager, region: string): FocusResult {
  session.saveState({ focusedRegion: region });
  return {
    success: true,
    message: `focused region: ${region}`,
  };
}
