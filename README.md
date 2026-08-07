# Cairn

An agent-first browser automation tool — optimized for LLM agents, not test scripts.

Act by **stable ref**, never by coordinate. See compact **deltas** after actions, not full page dumps. Run **natural-language intents** that collapse 4–5 agent round-trips into one command.

## Install

```bash
npm install -g cairn-browser
npx playwright install chromium
```

> Prefer not to install globally? Use `npx cairn-browser <command>` — same commands, downloads on first run.

### Agent skill (Claude Code, Cursor, Codex, …)

Cairn ships as an [Agent Skill](https://agentskills.io) — instructions that tell your AI agent to reach for `cairn` instead of hand-writing Playwright scripts.

**Claude Code:**
```
/plugin marketplace add https://github.com/wulu-epic/cairn.git
/plugin install cairn
```

**Other harnesses** (auto-discovery via `package.json` `agents.skills` field):
```bash
npm install --save-dev cairn-browser
```

## Quick start

```bash
cairn goto https://example.com         # navigate → page tree with [ref=eN] markers
cairn type e13 "hello"                 # fill a field by ref
cairn click e15                        # click by ref → see only what changed
cairn goto "click the sign in button"  # NL intent: perceive → ground → act → verify
```

## Why Cairn

**Refs, not coordinates.** Elements get stable refs (`e1`, `e2`, …) stamped as DOM attributes. The agent says "click e15" — deterministic, no location hallucination. Vision can perceive (`look --visual`), but refs always ground.

**Delta output.** After an action, Cairn shows only what changed (`+` added / `-` removed / `~` changed), not a full page re-dump. One action = ~one line of output.

**NL intents.** `goto "click the sign in button"` runs the full perceive→ground→act→verify loop internally — deterministic, no in-tool LLM call. The agent states intent in English; Cairn handles grounding via fuzzy token overlap, role/region scoring, synonym matching, and light stemming.

**Interactivity fusion.** Cairn doesn't just trust ARIA. It fuses native tags + ARIA roles + `tabindex` + `cursor:pointer` + inline `onclick` + `contenteditable` — catches div-as-button that attribute-only tools miss.

**Self-healing.** Stale refs are automatically re-grounded by attribute matching. Task recording/replay lets you capture a flow once and replay it deterministically with zero LLM calls.

## Commands

### Navigation + page model

```
cairn goto <url>           Navigate to a URL (shows page tree immediately)
cairn goto "<nl goal>"     Run an NL intent: perceive → ground → act → verify
cairn look [--visual] [-i] Show page tree; --visual adds a marked screenshot,
                           -i shows only interactive elements (compact)
cairn focus <region|ref>   Zoom into a region (nav/main/sidebar/footer/modal)
cairn query "<question>"   Ask a targeted question → one-line answer, not a full dump
                           query "sign in"       → find element by text
                           query "primary action" → highest-priority CTA
                           query "form fields"   → all typeable inputs
                           query "what changed"  → diff since last snapshot
```

### Actions (by stable ref)

```
cairn click <ref>          Click by ref
cairn type <ref> <text>    Fill a field by ref (echoes the actual value received)
cairn attr <ref>           Read one element's exact state: tag, role, name, text,
                           value, classes, checked/disabled, aria-*
cairn eval "<js>"          Run read-only JS in the page (getComputedStyle, innerText)
cairn hover <ref>          Hover over an element (dropdowns, tooltips)
cairn scroll <ref|dir>     Scroll element into view, or page up/down/top/bottom
cairn select <ref> <value> Select a dropdown option by ref
cairn keypress <key>       Press a key (Enter, Escape, Control+a, …)
cairn drag <ref1> <ref2>   Drag element ref1 to element ref2
cairn extract <schema>     Structured data extraction (JSON output)
```

### Tabs, dialogs, files, storage

```
cairn tab <list|switch|close|new>   Tab management
cairn dialog <accept|dismiss> [text] Auto-handle JS dialogs (alert/confirm/prompt)
cairn upload <ref> <path>  Upload a file to an <input type=file> by ref
cairn download <ref>       Click a download link by ref, save to .sessions/
cairn cookies <list|clear> Cookie management
cairn storage <save|restore> Storage state persistence (cookies + localStorage)
```

### Recording, replay, and planning

```
cairn goto "<goal>" --record <name>  Record a task trace for zero-LLM replay
cairn replay <task-id>               Replay a recorded task (self-heals stale refs)
cairn tasks / task <id>              List / inspect recorded tasks
cairn compile "<goal>"               Compile a compound NL goal into a multi-step plan
cairn run <plan-id>                  Re-execute a saved plan deterministically
cairn plans / plan <id>              List / inspect saved plans
```

### Session

```
cairn status               Show session state (URL, region, connection)
cairn release              Release the browser session
```

### Flags

```
--session <id>         Session ID (default: default)
--steel                Use self-hosted Steel Browser backend (anti-detect + proxy)
--proxy <url>          Per-session proxy (http://user:pass@host:port or socks5://)
--user-agent <str>     Custom User-Agent
--headless / --no-headless  Headless (default) or visible window
--visual               Marked screenshot (numbered boxes over interactive elements)
-i, --interactive-only Show only interactive elements (compact, ~3x smaller)
--include-hidden       Surface CSS-hidden / aria-hidden content
--record <name>        Record an NL goto intent as a replayable task
--trace                Capture non-DOM side effects (failed XHRs, console errors)
```

## How it works

1. **Persistent session** — Chrome launches as a detached background process. Each CLI command connects via Playwright `connectOverCDP`. The browser stays alive across commands.

2. **Page model** — One `page.evaluate()` call walks the DOM and builds a tree of enhanced nodes: stable ref, role, accessible name, bounding box, inferred interactivity, region classification. Shadow-DOM piercing and iframe support included.

3. **Ref-based actions** — Refs are stamped as `data-cairn-ref` attributes. Actions resolve `ref → [data-cairn-ref="eN"] → Playwright action`. The agent never outputs coordinates.

4. **Delta output** — A `MutationObserver` waits for the page to settle after an action, then Cairn re-snapshots and diffs by ref. An action that changes one field costs ~one line, not a full page dump.

5. **NL grounding** — The intent parser extracts verb + target + role/region hints. The grounder scores all interactive nodes via token overlap, Levenshtein fuzzy matching, substring match, synonym dictionary, light stemming, abbreviation expansion, and role/region/typeability bonuses — all deterministic, no LLM call. An optional embeddings fallback (all-MiniLM-L6-v2, 25MB) catches novel synonyms.

6. **Vision fallback** — On canvas/WebGL/shadow-DOM pages, `look --visual` captures a marked screenshot with numbered boxes over every interactive element — labeled with the same refs the tree uses. Vision perceives, refs ground.

## Steel Browser backend

Cairn supports a pluggable backend. The default is local Chrome; alternatively, drive a self-hosted [Steel Browser](https://github.com/steel-dev/steel-browser) chrome farm for session management, anti-detect (fingerprint injection), and per-session proxy rotation.

```bash
docker compose up -d                    # Start Steel Browser
cairn goto https://example.com --steel  # Drive it with the CLI
```

## Developing

```bash
git clone https://github.com/wulu-epic/cairn.git
cd cairn
npm install
npx playwright install chromium

npx tsx src/cli.ts <command>     # Run CLI
npx tsc --noEmit                 # Typecheck
npm test                         # Run tests
```

## License

MIT
