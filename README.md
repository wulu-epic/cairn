# Cairn

An agent-first browser testing tool — optimized for LLM agents, not test scripts.

> **Status:** Phase 1 (MVP) + Phase 2 (vision fallback) + Phase 3 (NL goto intents) + Phase 4 (Steel Browser backend) + Phase 5 (skill packaging). The core loop works: navigate → look → click/type by stable ref → see compact deltas. Canvas/WebGL/shadow-DOM pages auto-suggest a marked screenshot (`cairn look --visual`). NL intents collapse the loop: `goto "click the sign in button"` runs perceive→ground→act→verify internally. Dialog-based search auto-resolves via click-to-reveal fallback. **Phase 4** adds a pluggable backend: drive a self-hosted [Steel Browser](https://github.com/steel-dev/steel-browser) chrome farm for session management, anti-detect (fingerprint injection), and per-session proxy rotation — or use the default local Chrome backend. **Phase 5** packages Cairn as an installable skill (`skills/cairn/SKILL.md` + agent usage instructions), modeled on the agent-browser skill format. **Capability hardening** (Tiers 1–2): 27 commands total — extended actions (`hover`/`scroll`/`select`/`keypress`/`drag`), tab/dialog/file-upload handling, structured `extract`, open-shadow-DOM piercing (refs stamped on shadow-root controls), `look --include-hidden` (surfaces `display:none`/`aria-hidden` content), `--trace` (captures failed XHRs/console errors/JS exceptions), a 9-code error taxonomy, and a lazy all-MiniLM-L6-v2 grounding-embeddings fallback for synonym matching. **Leaps 1–4**: task recording/replay with zero-LLM replay, transparent stale-ref self-healing, NL-to-plan compilation (`compile`/`run`/`plans`), and page model as query (`query` — targeted one-line answers instead of full tree dumps). 19 test files (unit + E2E + hvac-regression). See [DESIGN.md](docs/DESIGN.md) for the full design and [COMPARISON.md](docs/COMPARISON.md) for a head-to-head vs agent-browser.

## Quick start

```bash
# Install deps (Playwright is the browser control layer)
npm install

# Install Chromium browser (one-time)
npx playwright install chromium

# Run the CLI
npx tsx src/cli.ts goto https://example.com
npx tsx src/cli.ts look
npx tsx src/cli.ts click e6
```

## Commands

```
# Navigation + page model
cairn goto <url>           Navigate to a URL (shows page tree immediately)
cairn goto "<nl goal>"     Run an NL intent: perceive → ground → act → verify
                          e.g. goto "click the sign in button"
                          e.g. goto "type hello into the email field"
cairn look [--visual] [-i] Show page tree; --visual adds a marked screenshot,
                          -i shows only interactive elements (compact, ~2.5x smaller)
                          --include-hidden surfaces CSS/aria-hidden content
cairn focus <region|ref>   Zoom into a region (nav/main/sidebar/footer/modal)

# Actions (by stable ref)
cairn click <ref>          Click by stable ref (deterministic, no coordinates)
cairn type <ref> <text>    Fill a field by ref
cairn hover <ref>          Hover over an element (dropdowns, tooltips)
cairn scroll <ref|dir>     Scroll element into view, or page up/down/top/bottom
cairn select <ref> <value> Select a dropdown option by ref
cairn keypress <key>       Press a key (Enter, Escape, Control+a, …)
cairn drag <ref1> <ref2>   Drag element ref1 to element ref2
cairn extract <schema>     Structured data extraction (JSON output)

# Tabs, dialogs, files, storage
cairn tab <list|switch|close|new>   Tab management
cairn dialog <accept|dismiss> [text] Auto-handle JS dialogs (alert/confirm/prompt)
cairn upload <ref> <path>  Upload a file to an <input type=file> by ref
cairn download <ref>       Click a download link by ref, save to .sessions/
cairn cookies <list|clear> Cookie management
cairn storage <save|restore> Storage state persistence (cookies + localStorage)

# Session
cairn status               Show session state (URL, region, connection)
cairn release              Release the browser session
```

**Leaps — recording, replay, and planning (zero-LLM deterministic execution):**
```
cairn goto "<goal>" --record <name>  Record a task trace for zero-LLM replay
cairn replay <task-id>               Replay a recorded task (self-heals stale refs)
cairn tasks / task <id>              List / inspect recorded tasks
cairn compile "<goal>"               Compile a compound NL goal into a multi-step plan
cairn run <plan-id>                  Re-execute a saved plan deterministically
cairn plans / plan <id>              List / inspect saved plans
```

**Leap 4 — page model as query (targeted one-line answers, not full tree dumps):**
```
cairn query "<question>" [--region <r>]  Ask a targeted question about the page
  query "sign in"       → find element by text (match)
  query "primary action" → highest-priority CTA in a region
  query "form fields"   → all typeable inputs
  query "what changed"  → diff since last snapshot
```

## How it works

1. **Persistent session**: Chrome launches as a detached background process on `127.0.0.1:9222`. Each CLI command connects via Playwright `connectOverCDP` — the browser stays alive across commands.

2. **Page model**: One `page.evaluate()` call walks the DOM and builds a tree of enhanced nodes — each with a stable ref (`e1`, `e2`, ...), role, accessible name, bounding box, inferred interactivity, and region classification.

3. **Inferred interactivity**: Instead of trusting ARIA attributes (which "lie" on custom widgets), we fuse: native tags + ARIA roles + tabindex + `cursor:pointer` + inline `onclick` + contenteditable + visibility. This catches div-as-button that attribute-only tools miss.

4. **Hierarchical renderer**: Produces a compact, bash-like tree with `[ref=eN]` refs and region clustering (▼ Header / ▼ Main / ▼ Footer). `focus` zooms into a subtree for token efficiency.

5. **Ref-based actions**: Refs are stamped as `data-cairn-ref` attributes during model build. Actions resolve `ref → [data-cairn-ref="eN"] → Playwright action`. The agent never outputs coordinates.

6. **Delta output**: After an action, a `MutationObserver` waits for the page to settle, then we re-snapshot and diff by ref — emitting only what changed (`+` added / `-` removed / `~` changed). An action that changes one field costs ~one line, not a full page dump.

7. **Vision fallback** (Phase 2): The structured model is blind to canvas/WebGL/closed shadow-DOM. When the page is media-rich, `look` auto-suggests `--visual`, which captures a full-page screenshot with numbered boxes over every interactive element — labeled with the *same* refs the tree uses. The agent looks at the image to disambiguate, then still acts by ref (`cairn click e15`), never by coordinate. This is what eliminates location hallucination: vision perceives, refs ground.

8. **NL goto intents** (Phase 3): The `goto` command accepts either a URL or a natural-language goal. `goto "click the sign in button"` runs the full perceive→ground→act→verify loop internally (deterministic, no in-tool LLM call) — the agent states intent in English and the tool handles grounding via fuzzy token overlap + role/region/typeability scoring. When a type intent can't find the field (e.g. search hidden behind a dialog), the click-to-reveal fallback auto-clicks the matching link/button, waits for the dialog to open, and re-grounds + types — all in one command.

## Architecture

```
src/
├── cli.ts                  CLI entry point + command dispatch (27 commands) + flag parsing
├── config.ts               Config layering (defaults < env vars < CLI flags)
├── errors.ts               Error taxonomy (9 codes: E_NOT_FOUND/E_AMBIGUOUS/E_BROWSER_DEAD/E_REF_STALE/…) + CairnError
├── test-utils.ts           Mock builders (makeNode/makeModel) for unit tests
├── session/
│   ├── session.ts          SessionManager — backend-agnostic, Steel or local Chrome + auto-fallback
│   ├── backend.ts          BrowserBackend interface + LocalChromeBackend (detached Chrome + connectOverCDP)
│   └── steel.ts            SteelBackend — REST API client + connectOverCDP via websocketUrl
├── model/
│   ├── page-model.ts       Spatial-semantic page model (DOM walk + interactivity + regions
│   │                       + open-shadow-DOM piercing + iframe + CSS-hidden surfacing)
│   ├── interactivity.ts    Interactivity inference logic (injected into browser)
│   └── delta.ts            MutationObserver + diff-by-ref delta output
├── intent/
│   ├── parser.ts           NL intent parser (deterministic → Click/Type/Navigate)
│   ├── grounding.ts        Fuzzy grounding (token overlap + role/region/typeability scoring → ref)
│   ├── execute.ts          Full perceive→ground→act→verify loop + click-to-reveal fallback
│   ├── embeddings.ts       Semantic grounding fallback (lazy all-MiniLM-L6-v2, synonym matching)
│   ├── extract.ts          Structured data extraction (schema → JSON)
│   ├── planner.ts          NL-to-plan compiler (splitGoal + compilePlan + executePlan) — Leap 1
│   ├── query.ts            Page model as query (match/primary-action/form-fields/diff + snapshots) — Leap 4
│   ├── recorder.ts         Task recording/replay (TaskRecorder + replayTask) — Leap 2
│   └── self-heal.ts        Transparent stale-ref self-healing (findReplacementByAttributes) — Leap 3
├── actions/
│   ├── click.ts / type.ts / focus.ts   Core ref-based actions
│   ├── hover.ts / scroll.ts / select.ts / keypress.ts / drag.ts   Extended actions
│   ├── tabs.ts / dialog.ts / files.ts  Tab / dialog / file-upload-download handling
│   └── trace.ts            Non-DOM side-effect capture (--trace: failed XHRs, console errors)
├── render/renderer.ts      Hierarchical tree renderer (regions + media-rich warning
│                           + interactive-only + hidden-content markers)
└── vision/
    └── screenshot.ts       Marked screenshot capture (numbered boxes over interactive els, same refs)
```

## Development

```bash
npx tsc --noEmit           # Typecheck
npx tsx src/cli.ts --help  # Run CLI
npx tsx scripts/test-cdp.ts   # Test CDP connection + ariaSnapshot
npx tsx scripts/test-model.ts # Test page model + interactivity inference
```

## Docker — Steel Browser (Phase 4)

The docker-compose runs [Steel Browser](https://github.com/steel-dev/steel-browser) (Apache-2.0, free to self-host) — a chrome farm with session management, anti-detect (fingerprint injection), and proxy rotation. Ports: 3000 (REST API + UI), 9223 (CDP websocket proxy). Steel handles the Chrome 111+ non-loopback CDP restriction internally via its own CDP proxy, so it works on Windows/Mac Docker Desktop (unlike raw Chromium in Docker).

```bash
docker compose up -d                    # Start Steel Browser
# UI: http://localhost:3000/ui          # Visual session viewer
# Then drive it with the CLI:
npx tsx src/cli.ts goto https://example.com --steel
```

## Roadmap

- [x] **Phase 1 (MVP)**: Page model + ref-based actions + persistent session + delta output
- [x] **Phase 2**: Vision fallback (marked screenshots for canvas/shadow-DOM ambiguity)
- [x] **Phase 3**: High-level `goto "nl goal"` (internal perceive→ground→act→verify loop) + `--interactive-only` flag + click-to-reveal multi-step intent composition
- [x] **Phase 4**: Steel Browser backend (self-hosted chrome farm, anti-detect, proxy rotation, `--steel`/`--proxy`/`--user-agent` flags, `release` command, backend abstraction)
- [x] **Phase 5**: Skill packaging (renamed to Cairn, `skills/cairn/SKILL.md` + agent usage instructions + reference doc, like agent-browser ships)
- [x] **Capability hardening**: extended actions (hover/scroll/select/keypress/drag), tabs, iframe support, dialogs, file upload/download, cookies/storage, structured `extract`, open-shadow-DOM piercing, `look --include-hidden`, `--trace` (non-DOM side-effect capture), error taxonomy, grounding embeddings fallback, 17 test files
- [x] **Leap 1**: NL-to-plan compiler (`compile`/`run`/`plans`) — compound NL goals compiled to deterministic multi-step plans
- [x] **Leap 2**: Task recording/replay (`goto --record`/`replay`/`tasks`) — zero-LLM replay of recorded traces
- [x] **Leap 3**: Transparent self-healing — stale refs auto-replaced by attribute matching on replay
- [x] **Leap 4**: Page model as query (`query "question"`) — targeted one-line answers (match/primary-action/form-fields/diff) instead of full page tree dumps, with model snapshot persistence for cross-invocation diffs
- [ ] **Phase 6**: Scale path (npm publish, `--json` output, MCP, session pool, Browserbase managed, optional Rust CDP orchestrator)

See [DESIGN.md](docs/DESIGN.md) §7 for the full roadmap.
