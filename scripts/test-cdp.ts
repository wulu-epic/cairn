import { chromium } from 'playwright';

const CDP_URL = process.env.CDP_URL; // if set, use connectOverCDP; else launch local

async function test() {
  let browser;
  try {
    if (CDP_URL) {
      console.log(`Connecting to CDP at ${CDP_URL}...`);
      browser = await chromium.connectOverCDP(CDP_URL);
      console.log('✓ Connected via CDP!');
    } else {
      console.log('Launching local Chromium...');
      browser = await chromium.launch({ headless: true });
      console.log('✓ Launched local Chromium!');
    }
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://example.com');
    console.log('✓ Page title:', await page.title());

    // Test ariaSnapshot({mode:'ai'}) — the token-efficient page rep
    const snapshot = await page.ariaSnapshot({ mode: 'ai' });
    console.log('✓ ariaSnapshot (ai mode):');
    console.log(snapshot);

    // Test CDP session for AX tree + box model
    const cdp = await context.newCDPSession(page);
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    console.log(`✓ CDP AX tree: ${nodes.length} nodes`);
    console.log(`  First node role: ${nodes[0]?.role?.value ?? 'N/A'}`);

    await cdp.detach();
    await browser.close();
    console.log('✓ All tests passed!');
  } catch (e) {
    console.error('✗ Test failed:', e instanceof Error ? e.message : String(e));
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
}

test();
