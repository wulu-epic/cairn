/**
 * Hover Action — hover over an element by stable ref.
 *
 * Resolves ref → live element via data-cairn-ref attribute → Playwright hover.
 * Triggers CSS :hover states and JS mouseenter/mouseover handlers — essential
 * for dropdown menus, tooltips, and hover-reveal UIs.
 *
 * docs/DESIGN.md §4.5: the agent never outputs coordinates. Hover is a one-line
 * Playwright call behind a ref.
 */

import type { Page } from 'playwright';

export interface HoverResult {
  success: boolean;
  message: string;
  ref: string;
}

export async function hoverByRef(page: Page, ref: string): Promise<HoverResult> {
  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found or not visible. Run "cairn look" to see current refs, or "cairn look --visual" for a marked screenshot.`,
      ref,
    };
  }

  const info = await locator.evaluate((el: HTMLElement) => ({
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
  })).catch(() => ({ role: '', name: '' }));

  try {
    await locator.hover({ timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} found but could not hover (element may be obscured or animating). Try "cairn look --visual" to check the page state.`,
      ref,
    };
  }

  // Small delay for hover-triggered animations/menus to appear
  await page.waitForTimeout(300);

  return {
    success: true,
    message: `hovered [${ref}] ${info.role}${info.name ? ` "${info.name}"` : ''}`,
    ref,
  };
}
