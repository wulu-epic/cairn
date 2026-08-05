/**
 * Marked Screenshot Capture — the Phase 2 vision-fallback path.
 *
 * The structured page model is blind to canvas/WebGL/closed-shadow-DOM. When
 * the agent is stuck on a media-rich page (or just wants a visual look), this
 * module captures a full-page screenshot with numbered boxes drawn over every
 * interactive element, each labeled with the SAME eN ref the structured model
 * uses. The agent looks at the image to disambiguate, then still acts by ref
 * (`cairn click e15`) — never by coordinate. This is what eliminates location
 * hallucination: vision perceives, refs ground.
 *
 * docs/DESIGN.md §4.4: "falls back to a marked screenshot only when the structured
 * model is blind (canvas/WebGL/shadow-DOM) or the agent requests a visual look."
 */

import type { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import type { PageModel } from '../model/page-model.js';
import { getInteractiveNodes } from '../model/page-model.js';

const SESSION_DIR = '.sessions';
const OVERLAY_ID = 'cairn-vision-overlay';

export interface LegendEntry {
  ref: string;
  role: string;
  name?: string;
}

export interface MarkedScreenshotResult {
  path: string;
  legend: LegendEntry[];
  markedCount: number;
  /** Total interactive elements on the page (may exceed markedCount if capped). */
  totalInteractive: number;
}

export interface MarkedScreenshotOptions {
  sessionId?: string;
  /** Max nodes to mark — prevents illegible clutter on huge pages. Default 150. */
  maxMarks?: number;
}

/**
 * Capture a full-page screenshot with numbered boxes over every interactive
 * element, labeled with the same refs the structured model uses. The overlay
 * is injected, the screenshot taken, and the overlay removed — leaving the
 * page untouched. Returns the saved PNG path + a compact ref legend.
 */
export async function captureMarkedScreenshot(
  page: Page,
  model: PageModel,
  opts: MarkedScreenshotOptions = {},
): Promise<MarkedScreenshotResult> {
  const sessionId = opts.sessionId ?? 'default';
  const maxMarks = opts.maxMarks ?? 150;

  // Collect interactive nodes to mark. These use the SAME refs stamped as
  // data-cairn-ref during buildPageModel, so the overlay boxes line up with the
  // structured model the agent is already reasoning over.
  const interactive = getInteractiveNodes(model);
  const toMark = interactive.slice(0, maxMarks);
  const refs = toMark.map((n) => n.ref);

  // Inject the overlay: numbered boxes positioned over the LIVE element
  // bounding boxes (queried via data-cairn-ref). Reading live geometry — not
  // the model's stale rects — guarantees the boxes land on the right pixels.
  await page.evaluate(injectOverlay, refs);

  // Capture the full scrollable page (the overlay is in document coordinates).
  const png = await page.screenshot({ fullPage: true, type: 'png' });

  // Remove the overlay so the page is left untouched for subsequent actions.
  await page
    .evaluate(`document.getElementById('${OVERLAY_ID}')?.remove();`)
    .catch(() => {});

  // Save to .sessions/<id>-vision-<timestamp>.png
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SESSION_DIR, `${sessionId}-vision-${ts}.png`);
  fs.writeFileSync(file, png);

  // Build the legend: a compact ref → role/name map so the agent can map a
  // numbered box in the image back to a ref it can act on.
  const legend: LegendEntry[] = toMark.map((n) => ({
    ref: n.ref,
    role: n.role,
    name: n.name,
  }));

  return {
    path: file,
    legend,
    markedCount: toMark.length,
    totalInteractive: interactive.length,
  };
}

/**
 * Render the legend as a compact, agent-facing string. One line per ref so
 * the agent can scan it alongside the screenshot.
 */
export function renderLegend(legend: LegendEntry[]): string {
  return legend
    .map((e) => {
      const label = e.name ? ` "${e.name}"` : '';
      return `${e.ref}: ${e.role}${label}`;
    })
    .join('\n');
}

// ─── Browser-side overlay injection (serialized by Playwright) ───────────

/**
 * Injects an absolutely-positioned overlay covering the full document, with a
 * numbered box + label drawn at each ref's live bounding box. Passed to
 * page.evaluate as a real function so Playwright serializes it and passes the
 * refs array as the argument.
 */
function injectOverlay(refs: string[]): void {
  // Remove any leftover overlay from a previous call.
  document.getElementById('cairn-vision-overlay')?.remove();

  const docW = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0,
  );
  const docH = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
  );

  const overlay = document.createElement('div');
  overlay.id = 'cairn-vision-overlay';
  overlay.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    `width:${docW}px`,
    `height:${docH}px`,
    'z-index:2147483647',
    'pointer-events:none',
    'background:transparent',
  ].join(';');
  // Append to documentElement so the overlay isn't affected by body positioning.
  document.documentElement.appendChild(overlay);

  for (const ref of refs) {
    const el = document.querySelector(`[data-cairn-ref="${ref}"]`) as HTMLElement | null;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Document coordinates (rect is viewport-relative; add scroll offset).
    const docX = rect.left + window.scrollX;
    const docY = rect.top + window.scrollY;

    const box = document.createElement('div');
    box.style.cssText = [
      'position:absolute',
      `left:${docX}px`,
      `top:${docY}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'border:2px solid #e63946',
      'background:rgba(230,57,70,0.10)',
      'box-sizing:border-box',
    ].join(';');
    overlay.appendChild(box);

    const label = document.createElement('div');
    label.textContent = ref;
    label.style.cssText = [
      'position:absolute',
      `left:${docX - 2}px`,
      `top:${Math.max(docY - 18, 0)}px`,
      'background:#e63946',
      'color:#fff',
      'font:bold 12px/16px monospace',
      'padding:1px 5px',
      'border-radius:3px',
      'z-index:2147483647',
      'white-space:nowrap',
    ].join(';');
    overlay.appendChild(label);
  }
}
