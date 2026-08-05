#!/usr/bin/env node

/**
 * Cairn — agent-first browser automation tool
 *
 * An agent-optimized CLI for browser automation. The agent navigates pages
 * by stable ref (never coordinates), gets compact hierarchical output, and
 * benefits from a persistent session across commands.
 *
 * Usage: cairn <command> [args] [--session <id>] [--steel] [--proxy <url>] ...
 */

import { SessionManager } from './session/session.js';
import { buildPageModel } from './model/page-model.js';
import { renderPage } from './render/renderer.js';
import { clickByRef } from './actions/click.js';
import { typeByRef } from './actions/type.js';
import { hoverByRef } from './actions/hover.js';
import { scrollByRef, scrollDirection, isScrollDirection } from './actions/scroll.js';
import { selectByRef } from './actions/select.js';
import { keypress, normalizeKey } from './actions/keypress.js';
import { dragByRef } from './actions/drag.js';
import { listTabs, formatTabs, switchTab, closeTab, newTab } from './actions/tabs.js';
import { setDialogHandler, parseDialogConfig, getDialogConfig } from './actions/dialog.js';
import { uploadFile, downloadFile, resolvePath, getDownloadDir } from './actions/files.js';
import { waitForPageSettled, computeDelta, renderDelta } from './model/delta.js';
import { captureMarkedScreenshot, renderLegend } from './vision/screenshot.js';
import { executeGoto } from './intent/execute.js';
import { extractData } from './intent/extract.js';
import { resolveConfig, parseFlags } from './config.js';
import { categorizeError, renderError, CairnError } from './errors.js';
import { TaskRecorder, replayTask, listTasks, loadTask, deleteTask, renderTaskList, renderTaskDetails, getDataDir, getTasksDir } from './intent/recorder.js';
import { selfHealByRef } from './intent/self-heal.js';

/** Detect whether a string looks like a URL (vs an NL intent goal). */
function isURL(s: string): boolean {
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('file://')) return true;
  if (/^\w+:\/\//i.test(s)) return true;
  // Bare domain: example.com, sub.example.com:8080/path, localhost:3000
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) return true;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s)) return true;
  return false;
}

// ─── Arg parsing ───────────────────────────────────────────────

const rawArgs = process.argv.slice(2);

// Phase 4: parse global flags (--steel, --proxy, --user-agent, --headless, etc.)
// parseFlags extracts these and returns the remaining args (command + command args)
const { flags: cliFlags, remainingArgs } = parseFlags(rawArgs);

// Parse remaining args for --session, --visual, --interactive-only, --include-hidden
let sessionId = 'default';
let visualMode = false;
let interactiveOnly = false;
let includeHidden = false;
let recordName: string | null = null;  // --record <name>: enable task recording
const cmdArgs: string[] = [];
for (let i = 0; i < remainingArgs.length; i++) {
  if (remainingArgs[i] === '--session' && i + 1 < remainingArgs.length) {
    sessionId = remainingArgs[i + 1];
    i++;
  } else if (remainingArgs[i] === '--visual') {
    visualMode = true;
  } else if (remainingArgs[i] === '--interactive-only' || remainingArgs[i] === '-i') {
    interactiveOnly = true;
  } else if (remainingArgs[i] === '--include-hidden') {
    includeHidden = true;
  } else if (remainingArgs[i] === '--record' && i + 1 < remainingArgs.length) {
    recordName = remainingArgs[i + 1];
    i++;
  } else {
    cmdArgs.push(remainingArgs[i]);
  }
}

const command = cmdArgs[0];
const commandArgs = cmdArgs.slice(1);

const COMMANDS = ['focus', 'click', 'type', 'hover', 'scroll', 'select', 'keypress', 'drag', 'look', 'status', 'goto', 'extract', 'tab', 'dialog', 'upload', 'download', 'cookies', 'storage', 'release', 'replay', 'tasks', 'task'] as const;
type Command = (typeof COMMANDS)[number];

function printHelp(): void {
  console.log(`Cairn — agent-first browser automation tool

Usage: cairn <command> [args] [options]

Commands:
  focus <region|ref>     Zoom into a region/subtree (token-efficient)
  click <ref>            Deterministic click by stable ref
  type <ref> <text>      Fill a field by ref
  hover <ref>            Hover over an element (dropdowns, tooltips)
  scroll <ref|dir>       Scroll element into view, or page up/down/top/bottom
  select <ref> <value>   Select an option in a dropdown by ref
  keypress <key>         Press a key (Enter, Escape, Control+a, etc.)
  drag <ref1> <ref2>     Drag element ref1 to element ref2
  look [--visual] [-i]   Show page tree; --visual adds a marked screenshot,
                           -i shows only interactive elements (compact)
                          --include-hidden surfaces CSS/aria-hidden content
  status                 Show session state (URL, region, backend, session info)
  goto <url|"nl goal">   Navigate to URL or run an NL intent
  extract <schema>       Structured data extraction (JSON output)
  tab <list|switch|      Tab management:
    close|new>             tab list              — show all open tabs
                           tab switch <N|url>    — switch to a tab
                           tab close [<N|url>]   — close a tab (current if none)
                           tab new [url]         — open a new tab
  dialog <accept|dismiss> Auto-handle JS dialogs (alert/confirm/prompt)
    [text]                accept with optional prompt text (default: accept)
  upload <ref> <filepath> Upload a file to an <input type="file"> by ref
  download <ref>         Click a download link by ref, save to .sessions/
  cookies <list|clear>   Cookie management:
                           cookies list           — show current cookies
                           cookies clear          — clear all cookies + storage
  storage <save|restore> Storage state persistence:
                           storage save            — save cookies + localStorage
                           storage restore        — restore from saved state
   release                Release the browser session (Steel: frees the browser;
                           local Chrome: clears session state)
  goto <url|"goal"> --record <name>
                          Record a task: run an NL intent and save the trace
                           for zero-LLM replay (Leap 2)
  replay <task-id>        Deterministic replay of a recorded task (zero LLM).
                           Self-heals stale refs automatically (Leap 3)
  tasks                   List all recorded tasks (stored in OS data dir)
  task <id>               Show recorded task details (steps, refs, fallbacks)
  task delete <id>        Delete a recorded task

Options:
  --session <id>         Session ID (default: default)
  --steel                Use self-hosted Steel Browser backend (anti-detect +
                           proxy rotation; requires Steel container running)
  --proxy <url>          Per-session proxy (http://user:pass@host:port or
                           socks5://host:port) — passed to Steel session
  --user-agent <str>     Custom User-Agent for the browser session
  --headless             Run browser in headless mode (default)
  --no-headless          Run browser in headed mode (visible window)
  --visual               Capture a marked screenshot (numbered boxes over
                           interactive elements, labeled with the same refs)
  --interactive-only, -i Show only interactive elements (compact, ~3x smaller)
  --include-hidden       Surface CSS-hidden / aria-hidden content (disclaimers,
                           deceptive patterns the a11y tree normally excludes)
  --record <name>        Record an NL goto intent as a replayable task (Leap 2)
  --help, -h             Show this help

Environment variables:
  STEEL_API_URL          Steel API base URL (e.g. http://localhost:3000)
  STEEL_API_KEY          Steel API key (self-hosted usually has none)
  STEEL_PROXY_URL        Default proxy URL for all Steel sessions
  STEEL_HEADLESS         "false" to run Steel browser headed

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

// ─── Resolve config + create session ───────────────────────────

const config = resolveConfig(cliFlags);
const session = new SessionManager(sessionId, config);
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

  // Auto-restore storage state (cookies + localStorage) if it exists.
  // This persists auth sessions across release/reconnect — the agent can
  // log in once, then use `cairn storage save` + subsequent sessions
  // automatically get the cookies restored.
  if (session.hasStorageState() && page.url() !== 'about:blank') {
    const restoreResult = await session.restoreStorageState(page);
    if (restoreResult.success) {
      process.stderr.write(`[session] ${restoreResult.message}\n`);
    }
  }

  switch (command as Command) {
    case 'look': {
      // Build the spatial-semantic page model and render it hierarchically.
      // --include-hidden surfaces CSS-hidden / aria-hidden content (disclaimers,
      // deceptive patterns) that the a11y tree normally excludes.
      const model = await buildPageModel(page, { includeHidden });

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
        console.log('View the image, then act by ref, e.g. "cairn click e15" — never by coordinate.');
      } else {
        const output = renderPage(model, { focusedRegion: savedState?.focusedRegion, interactiveOnly });
        console.log(output);
      }
      break;
    }

    case 'status': {
      const state = session.loadState();
      const backendName = connection.backendType === 'steel' ? 'Steel Browser' : 'local Chrome';
      console.log(`Session:    ${sessionId}`);
      console.log(`Backend:    ${backendName}`);
      if (connection.steelSessionId) {
        console.log(`Steel ID:   ${connection.steelSessionId}`);
      }
      if (config.proxyUrl) {
        console.log(`Proxy:      ${config.proxyUrl}`);
      }
      if (config.userAgent) {
        console.log(`User-Agent: ${config.userAgent.slice(0, 60)}${config.userAgent.length > 60 ? '...' : ''}`);
      }
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
        console.error('Usage: cairn goto <url|"nl goal">');
        console.error('  URL:   cairn goto https://example.com');
        console.error('  Intent: cairn goto "click the sign in button"');
        console.error('          cairn goto "type hello into the email field"');
        console.error('          cairn goto "go to settings"');
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
        // Self-heal (Leap 3) is on by default — stale refs are re-grounded
        // transparently. Recording (Leap 2) is enabled with --record <name>.
        let recorder: TaskRecorder | undefined;
        if (recordName) {
          recorder = new TaskRecorder(recordName, page.url());
        }
        const result = await executeGoto(page, goal, undefined, {
          useSelfHeal: true,
          recorder,
          sessionId,
        });
        if (result.success) {
          // If self-heal triggered, surface it transparently
          if (result.healed) {
            console.log(`✓ [self-healed] ${result.message}`);
            if (result.healLog && result.healLog.length > 0) {
              console.error(`  heal log:`);
              for (const line of result.healLog) {
                console.error(`    ${line}`);
              }
            }
          } else {
            console.log(`✓ ${result.message}`);
          }
          // Save the recorded task (if recording was enabled)
          if (recorder && recorder.stepCount > 0) {
            const saved = recorder.save();
            console.log(`  recorded task: ${saved.id} (${recorder.stepCount} step${recorder.stepCount === 1 ? '' : 's'})`);
            console.log(`  replay with: cairn replay ${saved.id}`);
          }
        } else {
          // Categorize the failure into an agent-actionable error code.
          // The agent reads E_NOT_FOUND / E_AMBIGUOUS to decide the next step.
          // If self-heal was attempted but failed, show the heal log.
          if (result.healLog && result.healLog.length > 0) {
            console.error(`  self-heal log:`);
            for (const line of result.healLog) {
              console.error(`    ${line}`);
            }
          }
          const code = result.ground?.status === 'notFound' ? 'E_NOT_FOUND'
            : result.ground?.status === 'ambiguous' ? 'E_AMBIGUOUS'
            : 'E_UNKNOWN';
          console.error(renderError(new CairnError(code, result.message, 'See the message above for next steps.')));
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
        console.error('Usage: cairn focus <region>');
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
        console.error('Usage: cairn click <ref>');
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
        // ── Self-heal (Leap 3): try to find a matching element by role+name ──
        const heal = await selfHealByRef(page, ref, prevModel);
        if (heal.healed && heal.newRef) {
          console.error(`  [self-heal] ref ${ref} → ${heal.newRef} (role+name match)`);
          const retryResult = await clickByRef(page, heal.newRef);
          if (retryResult.success) {
            console.log(`✓ [self-healed] ${retryResult.message}`);
            await waitForPageSettled(page);
            const newModel = await buildPageModel(page);
            const delta = computeDelta(heal.newModel, newModel);
            if (delta.nodes.length > 0 || delta.urlChanged) {
              console.log(renderDelta(delta));
            }
            break;
          }
        }
        console.error(renderError(new CairnError('E_CLICK_FAILED', result.message, 'The ref may be stale — run "cairn look" for fresh refs, then retry. Or use "cairn look --visual".')));
        process.exit(1);
      }
      break;
    }

    case 'type': {
      const ref = commandArgs[0];
      const text = commandArgs.slice(1).join(' ');
      if (!ref || !text) {
        console.error('Usage: cairn type <ref> <text>');
        process.exit(1);
      }
      // Stamp fresh data-cairn-ref attributes before resolving
      await buildPageModel(page);
      const result = await typeByRef(page, ref, text);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(renderError(new CairnError('E_TYPE_FAILED', result.message, 'The ref may be stale — run "cairn look" for fresh refs, then retry. Or use "cairn look --visual".')));
        process.exit(1);
      }
      break;
    }

    case 'hover': {
      const ref = commandArgs[0];
      if (!ref) {
        console.error('Usage: cairn hover <ref>');
        process.exit(1);
      }
      const prevModel = await buildPageModel(page);
      const result = await hoverByRef(page, ref);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        await waitForPageSettled(page);
        const newModel = await buildPageModel(page);
        const delta = computeDelta(prevModel, newModel);
        if (delta.nodes.length > 0) console.log(renderDelta(delta));
      } else {
        console.error(renderError(new CairnError('E_REF_STALE', result.message, 'Run "cairn look" for fresh refs, then retry.')));
        process.exit(1);
      }
      break;
    }

    case 'scroll': {
      const arg = commandArgs[0];
      if (!arg) {
        console.error('Usage: cairn scroll <ref|up|down|top|bottom>');
        process.exit(1);
      }
      await buildPageModel(page);
      let result;
      if (isScrollDirection(arg)) {
        result = await scrollDirection(page, arg);
      } else {
        result = await scrollByRef(page, arg);
      }
      if (result.success) {
        console.log(`✓ ${result.message}`);
        await waitForPageSettled(page);
      } else {
        console.error(renderError(new CairnError('E_REF_STALE', result.message, 'Run "cairn look" for fresh refs, then retry.')));
        process.exit(1);
      }
      break;
    }

    case 'select': {
      const ref = commandArgs[0];
      const value = commandArgs.slice(1).join(' ');
      if (!ref || !value) {
        console.error('Usage: cairn select <ref> <value>');
        process.exit(1);
      }
      await buildPageModel(page);
      const result = await selectByRef(page, ref, value);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(renderError(new CairnError('E_REF_STALE', result.message, 'Run "cairn look" for fresh refs, then retry.')));
        process.exit(1);
      }
      break;
    }

    case 'keypress': {
      const key = commandArgs.join(' ');
      if (!key) {
        console.error('Usage: cairn keypress <key>');
        console.error('  Examples: cairn keypress Enter, cairn keypress Escape, cairn keypress Control+a');
        process.exit(1);
      }
      const result = await keypress(page, key);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        await waitForPageSettled(page);
      } else {
        console.error(renderError(new CairnError('E_UNKNOWN', result.message, 'Check the key name. Use Enter, Escape, Tab, Control+a, etc.')));
        process.exit(1);
      }
      break;
    }

    case 'drag': {
      const sourceRef = commandArgs[0];
      const targetRef = commandArgs[1];
      if (!sourceRef || !targetRef) {
        console.error('Usage: cairn drag <source-ref> <target-ref>');
        process.exit(1);
      }
      await buildPageModel(page);
      const result = await dragByRef(page, sourceRef, targetRef);
      if (result.success) {
        console.log(`✓ ${result.message}`);
        await waitForPageSettled(page);
      } else {
        console.error(renderError(new CairnError('E_REF_STALE', result.message, 'Run "cairn look" for fresh refs, then retry.')));
        process.exit(1);
      }
      break;
    }

    case 'extract': {
      const schema = commandArgs.join(' ');
      if (!schema) {
        console.error('Usage: cairn extract <schema>');
        console.error('  Examples:');
        console.error('    cairn extract "title, price, description"');
        console.error('    cairn extract "heading: h1, price: textbox"');
        console.error('    cairn extract "button: e15"');
        console.error('    cairn extract "table"');
        process.exit(1);
      }
      const result = await extractData(page, schema);
      if (result.success) {
        console.log(JSON.stringify(result.data, null, 2));
        console.error(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'tab': {
      const subcommand = commandArgs[0];
      const tabArg = commandArgs.slice(1).join(' ');
      if (!subcommand || !['list', 'switch', 'close', 'new'].includes(subcommand)) {
        console.error('Usage: cairn tab <list|switch|close|new>');
        console.error('  cairn tab list              — show all open tabs');
        console.error('  cairn tab switch <N|url>    — switch to a tab');
        console.error('  cairn tab close [<N|url>]   — close a tab (current if none)');
        console.error('  cairn tab new [url]         — open a new tab');
        process.exit(1);
      }
      switch (subcommand) {
        case 'list': {
          const tabs = await listTabs(page);
          console.log(formatTabs(tabs));
          break;
        }
        case 'switch': {
          if (!tabArg) {
            console.error('Usage: cairn tab switch <N|url-substring>');
            process.exit(1);
          }
          const result = await switchTab(page, tabArg);
          if (result.success) {
            console.log(`✓ ${result.message}`);
          } else {
            console.error(`✗ ${result.message}`);
            process.exit(1);
          }
          break;
        }
        case 'close': {
          const result = await closeTab(page, tabArg || undefined);
          if (result.success) {
            console.log(`✓ ${result.message}`);
          } else {
            console.error(`✗ ${result.message}`);
            process.exit(1);
          }
          break;
        }
        case 'new': {
          const result = await newTab(page, tabArg || undefined);
          if (result.success) {
            console.log(`✓ ${result.message}`);
          } else {
            console.error(`✗ ${result.message}`);
            process.exit(1);
          }
          break;
        }
      }
      break;
    }

    case 'dialog': {
      const input = commandArgs.join(' ') || 'accept';
      const config = parseDialogConfig(input);
      const result = setDialogHandler(page, config);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'upload': {
      const ref = commandArgs[0];
      const filepath = commandArgs.slice(1).join(' ');
      if (!ref || !filepath) {
        console.error('Usage: cairn upload <ref> <filepath>');
        process.exit(1);
      }
      await buildPageModel(page);
      const result = await uploadFile(page, ref, filepath);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(renderError(new CairnError('E_REF_STALE', result.message, 'Run "cairn look" for fresh refs, then retry.')));
        process.exit(1);
      }
      break;
    }

    case 'download': {
      const ref = commandArgs[0];
      if (!ref) {
        console.error('Usage: cairn download <ref>');
        process.exit(1);
      }
      await buildPageModel(page);
      const result = await downloadFile(page, ref, sessionId);
      if (result.success) {
        console.log(`✓ ${result.message}`);
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'cookies': {
      const subcommand = commandArgs[0];
      if (!subcommand || !['list', 'clear'].includes(subcommand)) {
        console.error('Usage: cairn cookies <list|clear>');
        console.error('  cairn cookies list  — show current cookies');
        console.error('  cairn cookies clear — clear all cookies + storage');
        process.exit(1);
      }
      switch (subcommand) {
        case 'list': {
          const cookies = await session.getCookies(page);
          if (cookies.length === 0) {
            console.log('No cookies set.');
          } else {
            console.log(`Cookies (${cookies.length}):`);
            for (const c of cookies) {
              console.log(`  ${c.name}=${c.value}  (domain: ${c.domain}, path: ${c.path})`);
            }
          }
          break;
        }
        case 'clear': {
          const result = await session.clearStorageState(page);
          if (result.success) {
            console.log(`✓ ${result.message}`);
          } else {
            console.error(`✗ ${result.message}`);
            process.exit(1);
          }
          break;
        }
      }
      break;
    }

    case 'storage': {
      const subcommand = commandArgs[0];
      if (!subcommand || !['save', 'restore'].includes(subcommand)) {
        console.error('Usage: cairn storage <save|restore>');
        console.error('  cairn storage save     — save cookies + localStorage');
        console.error('  cairn storage restore  — restore from saved state');
        process.exit(1);
      }
      switch (subcommand) {
        case 'save': {
          const result = await session.saveStorageState(page);
          if (result.success) {
            console.log(`✓ ${result.message}`);
          } else {
            console.error(`✗ ${result.message}`);
            process.exit(1);
          }
          break;
        }
        case 'restore': {
          const result = await session.restoreStorageState(page);
          if (result.success) {
            console.log(`✓ ${result.message}`);
          } else {
            console.error(`✗ ${result.message}`);
            process.exit(1);
          }
          break;
        }
      }
      break;
    }
    case 'replay': {
      // ── Task Replay (Leap 2) — deterministic zero-LLM replay ──
      // Replays a recorded task by ID. Each recorded step's ref is tried
      // first (fast path); if stale, self-heal re-grounds by intent.
      const taskId = commandArgs[0];
      if (!taskId) {
        console.error('Usage: cairn replay <task-id>');
        console.error('  List recorded tasks: cairn tasks');
        process.exit(1);
      }
      process.stderr.write(`replaying task: ${taskId}...\n`);
      const result = await replayTask(page, taskId, {
        useSelfHeal: true,
        onStep: (step, stepResult) => {
          const status = stepResult.success ? '✓' : '✗';
          const healed = stepResult.healed ? ' [self-healed]' : '';
          const newRef = stepResult.newRef ? ` → [${stepResult.newRef}]` : '';
          process.stderr.write(`  ${status} step ${step.stepIndex + 1}: ${stepResult.message.slice(0, 80)}${healed}${newRef}\n`);
        },
      });
      if (result.success) {
        console.log(`✓ ${result.message}`);
        if (result.healsTriggered > 0) {
          console.log(`  (${result.healsTriggered} self-heal${result.healsTriggered === 1 ? '' : 's'} triggered)`);
        }
      } else {
        console.error(`✗ ${result.message}`);
        process.exit(1);
      }
      break;
    }

    case 'tasks': {
      // ── List recorded tasks (Leap 2) ──
      const tasks = listTasks();
      console.log(renderTaskList(tasks));
      if (tasks.length > 0) {
        console.log(`\nData dir: ${getTasksDir()}`);
      }
      break;
    }

    case 'task': {
      // ── Task management: show details or delete ──
      //   cairn task <id>          — show task details
      //   cairn task delete <id>   — delete a task
      const subcommand = commandArgs[0];
      if (!subcommand) {
        console.error('Usage: cairn task <id> | cairn task delete <id>');
        console.error('  cairn task <id>        — show task details (steps, refs, fallbacks)');
        console.error('  cairn task delete <id> — delete a recorded task');
        process.exit(1);
      }

      if (subcommand === 'delete') {
        const taskId = commandArgs[1];
        if (!taskId) {
          console.error('Usage: cairn task delete <id>');
          process.exit(1);
        }
        const deleted = deleteTask(taskId);
        if (deleted) {
          console.log(`✓ deleted task: ${taskId}`);
        } else {
          console.error(`✗ task not found: ${taskId}`);
          process.exit(1);
        }
        break;
      }

      // Show task details
      const task = loadTask(subcommand);
      if (!task) {
        console.error(`✗ task not found: ${subcommand}`);
        console.error('  List tasks: cairn tasks');
        process.exit(1);
      }
      console.log(renderTaskDetails(task));
      break;
    }

    case 'release': {
      // Release the browser session. For Steel, this POSTs /release to free
      // the browser process. For local Chrome, it's a no-op (Chrome stays
      // running as a detached process; we just clear saved state).
      await session.release();
      if (connection.backendType === 'steel') {
        console.log(`✓ released Steel session${connection.steelSessionId ? ` ${connection.steelSessionId}` : ''}`);
      } else {
        console.log('✓ cleared session state (local Chrome stays running; use --steel for managed sessions)');
      }
      // Don't disconnect normally — release already handled cleanup
      return;
    }
  }

  await session.disconnect(connection);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // Categorize the error and emit structured, agent-actionable output.
    // The agent reads the error CODE (E_BROWSER_DEAD, E_REF_STALE, etc.) to
    // decide retry vs look --visual vs give up — no free-text parsing needed.
    const error = categorizeError(e);
    console.error(renderError(error));
    process.exit(1);
  });
