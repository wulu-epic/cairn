/**
 * Scroll Action — scroll the page or a specific element into view.
 *
 * Two modes:
 *   1. Directional scroll: scroll the page up/down/top/bottom by a viewport.
 *      `cairn scroll down` — scrolls down one viewport height.
 *   2. Scroll-to-element: scroll a ref'd element into view.
 *      `cairn scroll e15` — scrolls element e15 into the viewport.
 *      This is essential for lazy-loaded content that isn't in the DOM until
 *      scrolled near (infinite lists, "load more" patterns).
 *
 * Resolves ref → live element via data-cairn-ref attribute → Playwright scrollIntoView.
 */

import type { Page } from 'playwright';

export type ScrollDirection = 'up' | 'down' | 'top' | 'bottom';

export interface ScrollResult {
  success: boolean;
  message: string;
  ref?: string;
}

/** Check if the argument is a scroll direction (vs a ref like "e15"). */
export function isScrollDirection(arg: string): arg is ScrollDirection {
  return ['up', 'down', 'top', 'bottom'].includes(arg);
}

/** Scroll the page in a direction by one viewport height (or to top/bottom). */
export async function scrollDirection(page: Page, direction: ScrollDirection): Promise<ScrollResult> {
  const viewportHeight = page.viewportSize()?.height ?? 800;
  const beforeY = await page.evaluate(() => window.scrollY);

  try {
    switch (direction) {
      case 'up':
        await page.evaluate((h) => window.scrollBy(0, -h), viewportHeight);
        break;
      case 'down':
        await page.evaluate((h) => window.scrollBy(0, h), viewportHeight);
        break;
      case 'top':
        await page.evaluate(() => window.scrollTo(0, 0));
        break;
      case 'bottom':
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        break;
    }
  } catch {
    return {
      success: false,
      message: `could not scroll ${direction} — the page may not be scrollable.`,
    };
  }

  await page.waitForTimeout(300);
  const afterY = await page.evaluate(() => window.scrollY);
  const delta = Math.round(afterY - beforeY);

  return {
    success: true,
    message: `scrolled ${direction} (${delta >= 0 ? '+' : ''}${delta}px → y=${Math.round(afterY)})`,
  };
}

/** Scroll a ref'd element into view (Playwright's scrollIntoViewIfNeeded). */
export async function scrollByRef(page: Page, ref: string): Promise<ScrollResult> {
  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  try {
    await locator.waitFor({ state: 'attached', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} not found. Run "cairn look" to see current refs, or "cairn look --visual" for a marked screenshot.`,
      ref,
    };
  }

  const info = await locator.evaluate((el: HTMLElement) => ({
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
    inViewport: isElementInViewport(el),
  })).catch(() => ({ role: '', name: '', inViewport: false }));

  // If already in viewport, no scroll needed
  if (info.inViewport) {
    return {
      success: true,
      message: `already in viewport [${ref}] ${info.role}${info.name ? ` "${info.name}"` : ''}`,
      ref,
    };
  }

  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `ref ${ref} found but could not scroll it into view.`,
      ref,
    };
  }

  await page.waitForTimeout(300); // allow lazy-loaded content to appear

  return {
    success: true,
    message: `scrolled [${ref}] into view${info.name ? ` (${info.role} "${info.name}")` : ''}`,
    ref,
  };
}

/** Check if an element is currently within the viewport (browser-side). */
function isElementInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}
