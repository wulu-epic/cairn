/**
 * Drag Action — drag one element to another by stable ref.
 *
 * Resolves source ref → target ref → Playwright dragTo. Useful for:
 *   - Drag-and-drop file uploads (drag a file icon to a drop zone)
 *   - Reordering list items
 *   - Sliders (drag the handle)
 *   - Kanban boards (drag a card between columns)
 *
 * docs/DESIGN.md §4.5: the agent never outputs coordinates. Drag is a one-line
 * Playwright call behind two refs (source + target).
 *
 * Note: many modern drag-and-drop implementations use HTML5 drag events
 * rather than mouse events. Playwright's dragTo() dispatches mouse events
 * (mousedown → mousemove → mouseup). If dragTo doesn't trigger the target's
 * drop handler, the agent may need to use a manual mouse-down/move/up sequence
 * (a future enhancement). For sliders and simple drags, dragTo works.
 */

import type { Page } from 'playwright';

export interface DragResult {
  success: boolean;
  message: string;
  sourceRef: string;
  targetRef: string;
}

export async function dragByRef(page: Page, sourceRef: string, targetRef: string): Promise<DragResult> {
  const source = page.locator(`[data-cairn-ref="${sourceRef}"]`);
  const target = page.locator(`[data-cairn-ref="${targetRef}"]`);

  // Validate both elements exist and are visible
  try {
    await source.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `source ref ${sourceRef} not found or not visible. Run "cairn look" to see current refs.`,
      sourceRef,
      targetRef,
    };
  }

  try {
    await target.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return {
      success: false,
      message: `target ref ${targetRef} not found or not visible. Run "cairn look" to see current refs.`,
      sourceRef,
      targetRef,
    };
  }

  const sourceInfo = await source.evaluate((el: HTMLElement) => ({
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
  })).catch(() => ({ role: '', name: '' }));

  const targetInfo = await target.evaluate((el: HTMLElement) => ({
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: el.getAttribute('aria-label') || el.textContent?.slice(0, 60) || '',
  })).catch(() => ({ role: '', name: '' }));

  // Get the target's center coordinates for the manual drag approach
  const targetCenter = await target.evaluate((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }).catch(() => ({ x: 0, y: 0 }));

  try {
    // First try Playwright's dragTo (dispatches mouse events)
    await source.dragTo(target, { timeout: 5000 });
  } catch {
    // Fallback: manual mouse down → move → up (works for some HTML5 DnD impls)
    try {
      await source.hover({ timeout: 3000 });
      await page.mouse.down();
      await page.waitForTimeout(100);
      // Move in steps toward the target for smoother dragging
      const sourceCenter = await source.evaluate((el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }).catch(() => ({ x: 0, y: 0 }));

      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const x = sourceCenter.x + (targetCenter.x - sourceCenter.x) * (i / steps);
        const y = sourceCenter.y + (targetCenter.y - sourceCenter.y) * (i / steps);
        await page.mouse.move(x, y);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
    } catch {
      return {
        success: false,
        message: `could not drag [${sourceRef}] to [${targetRef}] — the drag-and-drop implementation may require HTML5 events not supported by this method.`,
        sourceRef,
        targetRef,
      };
    }
  }

  await page.waitForTimeout(300); // allow drop handlers to fire

  return {
    success: true,
    message: `dragged [${sourceRef}] ${sourceInfo.role}${sourceInfo.name ? ` "${sourceInfo.name}"` : ''} → [${targetRef}] ${targetInfo.role}${targetInfo.name ? ` "${targetInfo.name}"` : ''}`,
    sourceRef,
    targetRef,
  };
}
