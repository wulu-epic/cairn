/**
 * Test the Phase 2 vision fallback: media-rich detection + marked screenshot.
 *
 * Creates a page with a real <canvas> (2D drawing), a native button, a form,
 * and a div-as-button. Verifies that:
 *   - buildPageModel flags the page as media-rich (canvasCount > 0)
 *   - captureMarkedScreenshot() draws numbered boxes over the interactive
 *     elements, labeled with the same refs, and saves a PNG to .sessions/
 *
 * Run: npx tsx scripts/test-vision.ts
 */
import { chromium } from 'playwright';
import { buildPageModel, getInteractiveNodes, isMediaRich } from '../src/model/page-model.js';
import { renderPage } from '../src/render/renderer.js';
import { captureMarkedScreenshot, renderLegend } from '../src/vision/screenshot.js';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // A page with a real canvas (drawn via 2D context) + interactive controls.
  // The canvas has no DOM children, so the structured model can't describe its
  // contents — exactly the media-rich case the vision fallback targets.
  await page.setContent(`
    <html><head><style>
      body { font-family: sans-serif; margin: 20px; }
      canvas { border: 1px solid #333; display: block; margin: 10px 0; }
      .draw-btn { padding: 8px 16px; background: #2563eb; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
      form { margin: 20px 0; }
      .div-btn { padding: 10px; border: 1px solid #ccc; cursor: pointer; }
    </style></head><body>
      <header><h1>Canvas Demo — Phase 2 Vision Test</h1></header>
      <main>
        <p>Click the button to draw on the canvas. The canvas itself is invisible
           to the structured model (no DOM children), so vision is needed to
           see what's drawn.</p>
        <canvas id="board" width="400" height="200"></canvas>
        <button class="draw-btn" id="draw">Draw a circle</button>
        <button class="draw-btn" id="clear" style="background:#dc2626">Clear</button>
        <form>
          <label for="label">Circle label</label>
          <input id="label" type="text" placeholder="e.g. hello" />
          <button type="submit">Submit</button>
        </form>
        <div class="div-btn" onclick="document.getElementById('draw').click()">
          Div acting as a button — also draws a circle
        </div>
      </main>
      <script>
        // Draw an initial circle so the canvas isn't blank in the screenshot.
        (function () {
          var c = document.getElementById('board');
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#2563eb';
          ctx.beginPath();
          ctx.arc(200, 100, 60, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '16px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('hello', 200, 105);
        })();
      </script>
    </body></html>
  `);

  // ── Media-rich detection ─────────────────────────────────────────
  const model = await buildPageModel(page);
  const mr = model.mediaRich;
  console.log('=== Media-rich detection ===');
  console.log(`  canvasCount:    ${mr.canvasCount}`);
  console.log(`  webglCount:     ${mr.webglCount}`);
  console.log(`  shadowDomCount: ${mr.shadowDomCount}`);
  console.log(`  isMediaRich:    ${isMediaRich(mr)}`);
  if (mr.canvasCount < 1) {
    console.error('✗ FAIL: expected canvasCount >= 1');
    process.exit(1);
  }
  console.log('  ✓ canvas detected — media-rich path should trigger\n');

  // ── Interactive nodes + renderer (should show the media-rich warning) ──
  const interactive = getInteractiveNodes(model);
  console.log(`=== Interactive nodes (${interactive.length}) ===`);
  for (const n of interactive) {
    console.log(`  [${n.ref}] ${n.role}${n.name ? ` "${n.name}"` : ''}`);
  }
  console.log('\n=== Rendered tree (note the media-rich warning) ===\n');
  console.log(renderPage(model, {}));

  // ── Marked screenshot ────────────────────────────────────────────
  console.log('\n=== Marked screenshot ===');
  const shot = await captureMarkedScreenshot(page, model, { sessionId: 'vision-test' });
  console.log(`  saved:        ${shot.path}`);
  console.log(`  marked:       ${shot.markedCount} of ${shot.totalInteractive} interactive`);
  console.log(`  legend:`);
  console.log(renderLegend(shot.legend).replace(/^/gm, '    '));

  if (shot.markedCount === 0) {
    console.error('✗ FAIL: no elements were marked');
    process.exit(1);
  }
  console.log('\n  ✓ marked screenshot captured. Inspect the PNG to verify boxes.');

  await browser.close();
}

test().catch((e) => {
  console.error(e);
  process.exit(1);
});
