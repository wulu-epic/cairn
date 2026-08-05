#!/usr/bin/env node

/**
 * ai-browser-tester — agent-first browser testing tool
 *
 * An agent-optimized CLI for browser automation. The agent navigates pages
 * by stable ref (never coordinates), gets compact hierarchical output, and
 * benefits from a persistent session across commands.
 *
 * Usage: abt <command> [args] [--session <id>]
 */

import { SessionManager } from './session/session.js';
import { buildPageModel } from './model/page-model.js';
import { renderPage } from './render/renderer.js';
import { clickByRef } from './actions/click.js';
import { typeByRef } from './actions/type.js';
import { waitForPageSettled, computeDelta, renderDelta } from './model/delta.js';
import { captureMarkedScreenshot, renderLegend } from './vision/screenshot.js';
import { executeGoto } from './intent/execute.js';

/** Detect whether a string looks like a URL (vs an NL intent goal). */
function isURL(s: string): boolean {
  // Any protocol:// URL (http, https, file, ftp, etc.)
  if (/^\w+:\/\//i.test(s)) return true;
  // Bare domain: example.com, sub.example.com:8080/path, localhost:3000
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return true;
  return false;
}

// ─── Arg parsing ───────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

let sessionId = 'default';
let visualMode = false;
const cmdArgs: string[] = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--session' && i + 1 < rawArgs.length) {
    sessionId = rawArgs[i + 1];
    i++;
  } else if (rawArgs[i] === '--visual') {
    visualMode = true;
  } else {
    cmdArgs.push(rawArgs[i]);
  }
}

const command = cmdArgs[0];
const commandArgs = cmdArgs.slice(1);

const COMMANDS = ['focus', 'click', 'type', 'look', 'status', 'goto', 'extract'] as const;
type Command = (typeof COMMANDS)[number];

function printHelp(): void {
  console.log(`ai-browser-tester — agent-first browser testing tool

Usage: abt <command> [args] [--session <id>]

Commands:
  focus <region|ref>   Zoom into a region/subtree (token-efficient)
  click <ref>          Deterministic click by stable ref
  type <ref> <text>    Fill a field by ref
  look [--visual]       Show page tree; --visual adds a marked screenshot
  status               Show session state (URL, focused region, last delta)
  goto <url|"nl goal">  Navigate to URL or run an NL intent
  extract <schema>     Structured data extraction (Phase 3)

Options:
  --session <id>       Session ID (default: default)
  --visual             Capture a marked screenshot (numbered boxes over
                       interactive elements, labeled with the same refs)
  --help, -h           Show this help

Design: act by stable ref, never by coordinate. Every output is self-describing.`);
}

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (!COMMANDS.includes(command as Command)) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available commands: ${COMMANDS.join(', ')}`);
  process.exit(1);
}

// ─── Command handlers ──────────────────────────────────────────

const session = new SessionManager(sessionId);

async function main(): Promise<void> {
  const connection = await session.connect();
  const page = await session.getPage(connection.browser);

  // Restore saved URL if the page is blank
  const savedState = session.loadState();
  if (savedState?.currentUrl && page.url() === 'about:blank') {
    try {
      await page.goto(savedState.currentUrl, { waitUntil: 'domcontentloaded' });
    } catch {
      // ignore navigation errors on restore
    }
  }

  switch (command as Command) {
    case 'look': {
      // Build the spatial-semantic page model and render it hierarchically.
      const model = await buildPageModel(page);

      if (visualMode) {
        // Vision fallback: capture a marked screenshot (numbered boxes over
        // every interactive element, labeled with the same refs) so the agent
        // can visually disambiguate — especially on canvas/shadow-DOM pages
        // where the structured model is blind. The agent still acts by ref.
        const shot = await captureMarkedScreenshot(page, model, { sessionId });
        console.log(renderPage(model, { focusedRegion: savedState?.focusedRegion, visualMode: true }));
        console.log('---');
        console.log(`marked screenshot: ${shot.path}`);
        console.log(`(${shot.markedCount} of ${shot.totalInteractive} interactive elements marked)`);
        console.log('legend (ref → element):');
        console.log(renderLegend(shot.legend));
        console.log('View the image, then act by ref, e.g. "abt click e15" — never by coordinate.');
      } else {
        const output = renderPage(model, { focusedRegion: savedState?.focusedRegion });
        console.log(output);
      }
      break;
    }

    case 'status': {
      const state = session.loadState();
      console.log(`Session:    ${sessionId}`);
      console.log(`URL:        ${page.url()}`);
      console.log(`Title:      ${await page.title().catch(() => 'N/A')}`);
      console.log(`Region:     ${state?.focusedRegion ?? 'none'}`);
      console.log(`Connection: ${connection.viaCDP ? 'CDP (persistent)' : 'launch (ephemeral)'}`);
      break;
    }

    case 'goto': {
      // The arg may be a URL ("goto example.com") or an NL intent
      // ("goto click the sign in button"). Join all args into one string.
      const goal = commandArgs.join(' ');
      if (!goal) {
        console.error('Usage: abt goto <url|"nl goal">');
        console.error('  URL:   abt goto https://example.com');
        console.error('  Intent: abt goto "click the sign in button"');
        console.error('          abt goto "type hello into the email field"');
        console.error('          abt goto "go to settings"');
        process.exit(1);
      }

      if (isURL(goal)) {
        // ── URL navigation (existing behavior) ──
        await page.goto(goal, { waitUntil: 'domcontentloaded' });
        const title = await page.title().catch(() => 'N/A');
        session.saveState({ currentUrl: page.url(), focusedRegion: null });
        // Show the page immediately after navigation (self-describing)
        const model = await buildPageModel(page);
        const output = renderPage(model, {});
        console.log(`navigated: ${page.url()}`);
        console.log(`title:     ${title}`);
        console.log(output);
      } else {
        // ── NL intent: perceive → ground → act → verify (Phase 3) ──
        // The tool runs the full loop internally using deterministic logic,
        // collapsing 4-5 agent round-trips into one command.
        const result = await executeGoto(page, goal);
        if (result.success) {
          console.log(`✓ ${result.message}`);
        } else {
          console.error(`✗ ${result.message}`);
          process.exit(1);
        }
        // Persist session state (URL may have changed via a navigated click)
        session.saveState({ currentUrl: page.url(), focusedRegion: null });
      }
      break;
    }

    case 'focus': {
      const target = commandArgs[0];
      if (!target) {
        console.error('Usage: abt focus <region>');
        process.exit(1);
      }
      session.saveState({ focusedRegion: target });
      // Re-render with the focused region
      const model = await buildPageModel(page);
      const output = renderPage(model, { focusedRegion: target });
      console.log(output);
      break;
    }

    case 'click': {
      const ref = commandArgs[0];
      if (!ref) {
        console.error('Usage: abt click <ref>');
        process.exit(1);
      }
      // Build model before click (for delta comparison) + stamp attributes
      const prevModel = await buildPageModel(page);
      const result = await clickByRef(page, ref);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        // Wait for page to settle, then show compact delta (not full dump)
        await waitForPageSettled(page);
        const newModel = await buildPageModel(page);
        const delta = computeDelta(prevModel, newModel);
        if (delta.nodes.length > 0 || delta.urlChanged) {
          console.log(renderDelta(delta));
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'type': {
      const ref = commandArgs[0];
      const text = commandArgs.slice(1).join(' ');
      if (!ref || !text) {
        console.error('Usage: abt type <ref> <text>');
        process.exit(1);
      }
      // Stamp fresh data-abt-ref attributes before resolving
      await buildPageModel(page);
      const result = await typeByRef(page, ref, text);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'extract': {
      console.error('[stub] extract — structured extraction is Phase 2');
      process.exit(1);
    }
  }

  await session.disconnect(connection);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
