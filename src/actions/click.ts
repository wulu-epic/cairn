/**
 * Click Action — deterministic click by stable ref.
 *
 * Resolves ref → live element via data-abt-ref attribute → Playwright click.
 * The agent never outputs coordinates. Uses Playwright's auto-wait + retry.
 * Returns what changed (compact result, not a full page dump).
 */

import type { Page } from 'playwright';
import { buildPageModel } from '../model/page-model.js';
import { renderPage } from '../render/renderer.js';

export interface ActionResult {
  success: boolean;
  message: string;
  ref: string;
  role?: string;
  name?: string;
}

export async function clickByRef(page: Page, ref: string): Promise<ActionResult> {
  // Resolve ref → live element. The data-abt-ref attribute was stamped
  // during the last buildPageModel() call.
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

  // Get element info before clicking (for the result message)
  const info = await locator.evaluate((el: HTMLElement) => ({
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
  })).catch(() => ({ role: '', name: '' }));

  // Click using Playwright (auto-waits, scrolls into view, retries)
  await locator.click({ timeout: 5000 });

  // Wait for any navigation or DOM changes to settle
  await page.waitForTimeout(500);

  // Build the new page model and render a compact result
  const model = await buildPageModel(page);
  const output = renderPage(model, {});

  // Check if navigation occurred
  const navigated = !page.url().includes('about:blank') && model.url !== page.url();

  return {
    success: true,
    message: `clicked [${ref}] ${info.role}${info.name ? ` "${info.name}"` : ''}`,
    ref,
    role: info.role,
    name: info.name,
  };
}
