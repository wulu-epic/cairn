---
name: cairn
description: Browser automation CLI for AI agents. Use whenever the user needs to interact with websites, navigate pages, fill forms, click buttons, take screenshots, test web apps, verify dev server output, extract page data, or automate any browser task. Triggers on browser automation, web testing, page interaction, form filling, web scraping, visual verification of a running app, or any task requiring a headless browser. Prefer this over writing raw Playwright/Puppeteer scripts for agentic browser work — Cairn's stable-ref actions, delta output, and NL intents make it far more step-efficient than orchestrating low-level primitives.
allowed-tools: Bash(cairn:*), Bash(npx cairn-browser:*)
hidden: true
---

# Browser Automation with Cairn

Cairn is an agent-first browser automation CLI. The agent navigates pages by **stable ref** (never pixel coordinates), gets compact hierarchical output, and sees only what changed after each action (deltas, not full re-snapshots). A persistent session keeps the browser alive across commands.

## Why Cairn (not raw Playwright/Puppeteer)

- **Act by ref, never by coordinate** — eliminates location hallucination. You pick `e15`; Cairn resolves it to the live element and clicks. No coordinate reasoning, no fabricated clicks.
- **Deltas, not snapshots** — after an action, Cairn shows only what changed (`+` added / `-` removed / `~` changed), not a full page dump. Saves ~50% tokens per step on iterative tasks.
- **Region focus** — zoom into just the relevant subtree (`focus main`) instead of re-reading the whole page.
- **NL intents collapse the loop** — `goto "click the sign in button"` runs perceive→ground→act→verify internally. One command, not five.
- **Inferred interactivity** — catches `div`-as-button (no ARIA, just `cursor:pointer + onclick`) that attribute-only tools miss entirely.

## Core Workflow

Every browser task follows this pattern:

1. **Navigate**: `cairn goto <url>` — shows the page tree immediately (self-describing, no separate "look" needed)
2. **Act by ref**: `cairn click e15` or `cairn type e15 "text"` — deterministic, no coordinates
3. **Read the delta**: the action output shows what changed; re-`look` only when you need the full tree

```bash
cairn goto http://localhost:3000
# → navigated: http://localhost:3000  +  full hierarchical tree with [ref=eN] markers

cairn type e13 "user@example.com"
# → ✓ typed "user@example.com into [e13] input  +  delta (only what changed)
```

## Essential Commands

```bash
# Navigation + page model
cairn goto <url>              # Navigate to URL (shows page tree immediately)
cairn goto "<nl goal>"        # NL intent: perceive → ground → act → verify in one command
cairn look                    # Show full page tree (regions + refs)
cairn look -i                 # Interactive elements only (compact, ~3x smaller)
cairn look --visual           # Marked screenshot with numbered boxes over interactive els
cairn focus <region|ref>      # Zoom into a region/subtree (token-efficient)

# Actions (use refs from goto/look)
cairn click <ref>             # Click by stable ref (deterministic, auto-wait)
cairn type <ref> <text>       # Clear + type into a field by ref
cairn hover <ref>             # Hover (dropdowns, tooltips)
cairn scroll <ref|dir>        # Scroll element into view, or page up/down/top/bottom
cairn select <ref> <value>    # Select a dropdown option by ref
cairn keypress <key>          # Press a key (Enter, Escape, Control+a, …)
cairn drag <ref1> <ref2>      # Drag element ref1 to element ref2
cairn extract <schema>        # Structured data extraction (JSON output)

# Tabs, dialogs, files, storage
cairn tab <list|switch|close|new>      # Tab management
cairn dialog <accept|dismiss> [text]  # Auto-handle JS dialogs (alert/confirm/prompt)
cairn upload <ref> <path>     # Upload a file to an <input type=file> by ref
cairn download <ref>          # Click a download link, save to .sessions/
cairn cookies <list|clear>    # Cookie management
cairn storage <save|restore> # Persist cookies + localStorage across sessions

# Session
cairn status                  # Session state (URL, region, backend, connection)
cairn release                 # Release the browser session

# Options (global, work with any command)
--session <id>                # Named session (run multiple browsers in parallel)
--steel                       # Use self-hosted Steel Browser backend (anti-detect + proxy)
--proxy <url>                 # Per-session proxy (http://user:pass@host:port or socks5://)
--user-agent <str>            # Custom User-Agent
--headless / --no-headless    # Headless (default) or visible browser window
```

> **Dev invocation:** if `cairn` is not on PATH, run `npx tsx src/cli.ts <command>` instead. All commands and flags are identical.

## NL Intents — Collapse the Loop

`goto` accepts either a URL or a natural-language goal. The tool runs the full perceive→ground→act→verify loop internally (deterministic, no in-tool LLM call), so you state intent in English and it handles grounding:

```bash
cairn goto "click the sign in button"
# → ✓ clicked [e15]

cairn goto "type hello into the email field"
# → ✓ typed "hello" into [e11] input

cairn goto "go to settings"
# → ✓ clicked [e5], detected URL change
```

When the target is ambiguous or not found, Cairn reports candidates and suggests `look --visual`:

```bash
cairn goto "click the submit button"
# → ✗ not found, closest: [e15] [e16]
#   → try "cairn look --visual" for a marked screenshot
```

**Click-to-reveal:** when a field is hidden behind a dialog (e.g. Wikipedia/DuckDuckGo search behind a link), Cairn auto-clicks the matching link/button, waits for the dialog to open, and re-grounds + types — all in one `goto` command.

## Ref Lifecycle (Important)

Refs (`e1`, `e2`, ...) are stamped as `data-cairn-ref` attributes during the page-model build. They are **stable within a page** — they survive in-page mutations (a dropdown opening, a form filling) because the attributes persist. But they **invalidate on navigation** (new page = new DOM = new stamps).

- After `cairn goto <url>`: refs are fresh and shown in the output.
- After `cairn click` that **navigates**: Cairn re-builds the model and shows the delta (new refs included).
- After `cairn click`/`type` that **stays on the page**: refs are still valid; the delta shows what changed.
- If a ref is stale (page re-rendered): `cairn look` re-stamps fresh refs.

**Rule of thumb:** the output of each command tells you the current refs. You rarely need a separate `look` — `goto` and `click` are self-describing.

## Vision Fallback — When to Use `--visual`

The structured model is fast, cheap, and precise — but blind to **canvas/WebGL** and **closed shadow-DOM** (no DOM nodes to model). Use the marked screenshot when:

- `look` shows a **media-rich warning** ("canvas/WebGL/shadow-DOM detected — run `cairn look --visual`")
- You can't find an element the user described (the page may use canvas widgets)
- You need to visually confirm layout/colors/a rendered state

```bash
cairn look --visual
# → page tree  +  marked screenshot saved to .sessions/<id>.png
#   (numbered boxes over interactive els, labeled with the SAME refs the tree uses)
#   legend: e1 → button "Submit", e2 → link "Home", ...

# View the image, then act by ref — never by coordinate:
cairn click e15
```

The marked screenshot uses the **same refs** as the tree, so you look at the image to disambiguate, then act by ref. This is what eliminates location hallucination: vision perceives, refs ground.

For the full vision-fallback decision tree and advanced patterns, see `references/advanced-patterns.md`.

## Common Patterns

### Form Submission

```bash
cairn goto http://localhost:3000/signup
# → tree shows [e13] = "Name" textbox, [e14] = "Email" textbox, [e15] = "Sign up" button

cairn type e13 "Jane Doe"
cairn type e14 "jane@example.com"
cairn click e15
# → ✓ clicked [e15]  +  delta (navigation to /welcome)
```

Or with NL intents (no need to read refs):

```bash
cairn goto http://localhost:3000/signup
cairn goto "type Jane Doe into the name field"
cairn goto "type jane@example.com into the email field"
cairn goto "click the sign up button"
```

### Verify a Dev Server

```bash
# After starting a dev server (next dev, vite, etc.)
cairn goto http://localhost:3000
# → tree shows the rendered page; check for expected elements
cairn look --visual    # if you need to visually confirm the layout
```

### Token-Efficient Navigation on Large Pages

```bash
cairn goto https://example.com         # full tree (~all regions)
cairn focus main                       # zoom into just the main region (~3x smaller)
cairn look                             # now shows only the main subtree
# ... act within main ...
cairn focus sidebar                    # switch to sidebar when needed
```

### Multi-Session (Parallel Browsers)

```bash
cairn goto http://localhost:3000 --session app1
cairn goto http://localhost:3001 --session app2
cairn status --session app1            # check app1's state
cairn release --session app2           # release app2 when done
```

## Key Differentiators Summary

| Feature | Cairn | Plain Playwright | agent-browser |
|---|---|---|---|
| Act by stable ref (no coords) | ✅ | ❌ (selectors) | ✅ (AX refs) |
| Delta output (no re-snapshot) | ✅ | ❌ | ❌ |
| Region focus/zoom | ✅ | ❌ | ❌ |
| NL `goto` intent | ✅ | ❌ | ❌ |
| Inferred interactivity (div-as-button) | ✅ | ❌ | ❌ |
| Marked screenshot (same refs) | ✅ | ❌ | ✅ (annotate) |
| Self-describing actions | ✅ | ❌ | ❌ |

## When NOT to Use Cairn

- **Single-page static scrape** where you already know the CSS selector — `curl` + a parser is cheaper.
- **Performance auditing** — use Lighthouse directly.
- **Network-level mocking/testing** — Cairn doesn't intercept network; use Playwright's `page.route()` directly.

For advanced usage (vision-fallback decision tree, Steel backend, delta interpretation, click-to-reveal internals), read **`references/advanced-patterns.md`**.
