/**
 * Click Action — deterministic click by stable ref.
 *
 * Resolves ref → live element via data-cairn-ref attribute → Playwright click.
 * The agent never outputs coordinates. Uses Playwright's auto-wait + retry.
 * Returns what changed (compact result, not a full page dump).
 *
 * Occlusion diagnostic (gap #3): when a click fails or times out, runs
 * document.elementFromPoint at the target's center and reports what's on
 * top — the occluder's tag, classes, and ref. This was the single bug
 * (N2) that agent-browser found and Cairn wholly misplayed: agent-browser's
 * "covered by <header.site-header>" message WAS the finding. Now Cairn
 * surfaces the same diagnostic on click failure.
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
  occlusion?: OcclusionInfo;
}

/** What's covering the click target (if anything). */
export interface OcclusionInfo {
  occluderTag: string;
  occluderClasses: string[];
  occluderRef?: string;
  occluderRole?: string;
}

/**
 * Format an occlusion diagnostic as an agent-readable message.
 * Pure function — unit-testable. Given the target ref + what's on top,
 * produces "ref e15 is occluded by <header.site-header> (ref e3)".
 */
export function formatOcclusion(ref: string, occ: OcclusionInfo): string {
  const classStr = occ.occluderClasses.length > 0 ? '.' + occ.occluderClasses.join('.') : '';
  const refStr = occ.occluderRef ? ` (ref ${occ.occluderRef})` : '';
  const roleStr = occ.occluderRole ? ` [${occ.occluderRole}]` : '';
  return `ref ${ref} is occluded by <${occ.occluderTag}${classStr}>${roleStr}${refStr} — close/dismiss it or scroll to expose the target.`;
}

export async function clickByRef(page: Page, ref: string): Promise<ActionResult> {
  // Resolve ref → live element. The data-cairn-ref attribute was stamped
  // during the last buildPageModel() call.
  const locator = page.locator(`[data-cairn-ref="${ref}"]`);

  let visible = false;
  try {
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    visible = true;
  } catch {
    // Not visible — check if it's occluded before giving up
    const occ = await checkOcclusion(page, ref);
    return {
      success: false,
      message: `ref ${ref} not found or not visible${occ ? ` — ${formatOcclusion(ref, occ)}` : ''}. Run "cairn look" to see current refs, or "cairn look --visual" for a marked screenshot.`,
      ref,
      occlusion: occ,
    };
  }

  // Get element info before clicking (for the result message)
  const info = await locator.evaluate((el: HTMLElement) => ({
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
  })).catch(() => ({ role: '', name: '' }));

  // Click using Playwright (auto-waits, scrolls into view, retries).
  // On timeout, run the occlusion diagnostic so the agent knows WHY.
  try {
    await locator.click({ timeout: 5000 });
  } catch {
    const occ = await checkOcclusion(page, ref);
    return {
      success: false,
      message: `click on ref ${ref} timed out${occ ? ` — ${formatOcclusion(ref, occ)}` : ' — the element may be covered, or not actionable.'}. Run "cairn look" for fresh refs, or "cairn look --visual".`,
      ref,
      role: info.role,
      name: info.name,
      occlusion: occ,
    };
  }

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

/**
 * Check if an element is occluded by another element at its center point.
 * Runs document.elementFromPoint at the target's bounding-box center and
 * compares it to the target. If they differ, the target is occluded.
 */
export async function checkOcclusion(page: Page, ref: string): Promise<OcclusionInfo | undefined> {
  const result = await page.evaluate((targetRef: string) => {
    const el = document.querySelector(`[data-cairn-ref="${targetRef}"]`) as HTMLElement | null;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const cx = Math.round(rect.x + rect.width / 2);
    const cy = Math.round(rect.y + rect.height / 2);
    const onTop = document.elementFromPoint(cx, cy) as HTMLElement | null;
    if (!onTop || onTop === el || el.contains(onTop) || onTop.contains(el)) {
      return null; // not occluded (or element contains itself / vice versa)
    }
    return {
      occluderTag: onTop.tagName.toLowerCase(),
      occluderClasses: Array.from(onTop.classList),
      occluderRef: onTop.getAttribute('data-cairn-ref') || undefined,
      occluderRole: onTop.getAttribute('role') || undefined,
    };
  }, ref).catch(() => null);

  return result ?? undefined;
}
