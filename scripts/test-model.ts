/**
 * Test the spatial-semantic page model + interactivity inference.
 * Uses page.setContent() to create a page with tricky interactive elements:
 *   - div-as-button (no role, no aria, but cursor:pointer + onclick)
 *   - native button, input, link
 *   - non-interactive paragraphs
 *   - hidden elements (should be pruned)
 */
import { chromium } from 'playwright';
import { buildPageModel, getInteractiveNodes } from '../src/model/page-model.js';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setContent(`
    <html><body>
      <header>
        <h1>Test Page</h1>
        <nav>
          <a href="/home">Home</a>
          <a href="/about">About</a>
        </nav>
      </header>
      <main>
        <form>
          <label for="email">Email</label>
          <input id="email" type="email" placeholder="you@example.com" />
          <label for="pw">Password</label>
          <input id="pw" type="password" />
          <button type="submit">Sign in</button>
        </form>
        <div onclick="alert('clicked')" style="cursor:pointer; padding:10px; border:1px solid #ccc;">
          I'm a div acting as a button — no role, no aria
        </div>
        <div style="cursor:pointer;" id="no-handler">
          I have cursor:pointer but no onclick — should I be interactive?
        </div>
        <p>Just a paragraph of text. Not interactive.</p>
        <span style="cursor:pointer; color:blue; text-decoration:underline;" onclick="void(0)">
          Span acting as a link
        </span>
        <div style="display:none;">I'm hidden — should be pruned</div>
        <div style="visibility:hidden;">I'm invisible — should be pruned</div>
      </main>
      <footer>
        <p>© 2025 Test</p>
      </footer>
    </body></html>
  `);

  const model = await buildPageModel(page);

  console.log('=== Page Model Tree ===\n');
  printTree(model.tree, 0);

  console.log('\n=== Interactive Nodes ===\n');
  const interactive = getInteractiveNodes(model);
  for (const node of interactive) {
    const sig = node.interactivitySignals;
    const why = [
      sig?.nativeInteractive && 'native',
      sig?.ariaInteractive && 'aria',
      sig?.hasTabindex && 'tabindex',
      sig?.cursorPointer && 'cursor:pointer',
      sig?.hasOnclick && 'onclick',
      sig?.isEditable && 'editable',
    ].filter(Boolean).join(', ');
    console.log(`  [${node.ref}] ${node.role}${node.name ? ` "${node.name}"` : ''} — interactive via: ${why}`);
  }

  console.log(`\nTotal nodes: ${model.refIndex.size}, Interactive: ${interactive.length}`);

  await browser.close();
}

function printTree(node: any, depth: number) {
  const indent = '  '.repeat(depth);
  const flags = [
    node.interactive ? 'INTERACTIVE' : '',
    node.region ? `region:${node.region}` : '',
  ].filter(Boolean).join(' ');
  const label = node.name ? `"${node.name}"` : node.text ? `"${node.text.slice(0, 50)}"` : '';
  console.log(`${indent}[${node.ref}] ${node.role} ${label}${flags ? `  (${flags})` : ''}`);
  for (const child of node.children) {
    printTree(child, depth + 1);
  }
}

test().catch(console.error);
