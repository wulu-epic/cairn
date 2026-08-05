# ai-browser-tester

An agent-first browser testing tool — optimized for LLM agents, not test scripts.

> **Status:** Phase 1 (MVP) + Phase 2 (vision fallback) + Phase 3 (NL goto intents). The core loop works: navigate → look → click/type by stable ref → see compact deltas. Canvas/WebGL/shadow-DOM pages auto-suggest a marked screenshot (`abt look --visual`). NL intents collapse the loop: `goto "click the sign in button"` runs perceive→ground→act→verify internally. Dialog-based search auto-resolves via click-to-reveal fallback. See [DESIGN.md](DESIGN.md) for the full design and [COMPARISON.md](COMPARISON.md) for a head-to-head vs agent-browser.

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
abt goto <url>           Navigate to a URL (shows page tree immediately)
abt goto "<nl goal>"     Run an NL intent: perceive → ground → act → verify
                         e.g. goto "click the sign in button"
                         e.g. goto "type hello into the email field"
abt look [--visual] [-i] Show page tree; --visual adds a marked screenshot,
                         -i shows only interactive elements (compact, ~2.5x smaller)
abt focus <region|ref>   Zoom into a region (nav/main/sidebar/footer/modal)
abt click <ref>          Click by stable ref (deterministic, no coordinates)
abt type <ref> <text>    Fill a field by ref
abt status               Show session state (URL, focused region, connection)
abt extract <schema>     Structured extraction (planned)
```

## How it works

1. **Persistent session**: Chrome launches as a detached background process on `127.0.0.1:9222`. Each CLI command connects via Playwright `connectOverCDP` — the browser stays alive across commands.

2. **Page model**: One `page.evaluate()` call walks the DOM and builds a tree of enhanced nodes — each with a stable ref (`e1`, `e2`, ...), role, accessible name, bounding box, inferred interactivity, and region classification.

3. **Inferred interactivity**: Instead of trusting ARIA attributes (which "lie" on custom widgets), we fuse: native tags + ARIA roles + tabindex + `cursor:pointer` + inline `onclick` + contenteditable + visibility. This catches div-as-button that attribute-only tools miss.

4. **Hierarchical renderer**: Produces a compact, bash-like tree with `[ref=eN]` refs and region clustering (▼ Header / ▼ Main / ▼ Footer). `focus` zooms into a subtree for token efficiency.

5. **Ref-based actions**: Refs are stamped as `data-abt-ref` attributes during model build. Actions resolve `ref → [data-abt-ref="eN"] → Playwright action`. The agent never outputs coordinates.

6. **Delta output**: After an action, a `MutationObserver` waits for the page to settle, then we re-snapshot and diff by ref — emitting only what changed (`+` added / `-` removed / `~` changed). An action that changes one field costs ~one line, not a full page dump.

7. **Vision fallback** (Phase 2): The structured model is blind to canvas/WebGL/closed shadow-DOM. When the page is media-rich, `look` auto-suggests `--visual`, which captures a full-page screenshot with numbered boxes over every interactive element — labeled with the *same* refs the tree uses. The agent looks at the image to disambiguate, then still acts by ref (`abt click e15`), never by coordinate. This is what eliminates location hallucination: vision perceives, refs ground.

8. **NL goto intents** (Phase 3): The `goto` command accepts either a URL or a natural-language goal. `goto "click the sign in button"` runs the full perceive→ground→act→verify loop internally (deterministic, no in-tool LLM call) — the agent states intent in English and the tool handles grounding via fuzzy token overlap + role/region/typeability scoring. When a type intent can't find the field (e.g. search hidden behind a dialog), the click-to-reveal fallback auto-clicks the matching link/button, waits for the dialog to open, and re-grounds + types — all in one command.

## Architecture

```
src/
├── cli.ts                  CLI entry point + command dispatch
├── session/session.ts      Persistent session (detached Chrome + connectOverCDP)
├── model/
│   ├── page-model.ts       Spatial-semantic page model (DOM walk + interactivity + regions + media-rich detection)
│   ├── interactivity.ts    Interactivity inference logic (injected into browser)
│   └── delta.ts            MutationObserver + diff-by-ref delta output
├── intent/
│   ├── parser.ts           NL intent parser (deterministic pattern matching → Click/Type/Navigate)
│   ├── grounding.ts        Fuzzy grounding (token overlap + role/region/typeability scoring → ref)
│   └── execute.ts          Full perceive→ground→act→verify loop + click-to-reveal fallback
├── render/renderer.ts      Hierarchical tree renderer with region clustering + media-rich warning + interactive-only
├── vision/
│   └── screenshot.ts       Marked screenshot capture (numbered boxes over interactive els, same refs)
└── actions/
    ├── click.ts            Ref-based click (Playwright auto-wait)
    ├── type.ts             Ref-based fill (clear + type, child-input fallback for wrappers)
    └── focus.ts            Element focus + region focus (session state)
```

## Development

```bash
npx tsc --noEmit           # Typecheck
npx tsx src/cli.ts --help  # Run CLI
npx tsx scripts/test-cdp.ts   # Test CDP connection + ariaSnapshot
npx tsx scripts/test-model.ts # Test page model + interactivity inference
```

## Docker (for Linux deployment)

The Dockerfile runs chrome-headless-shell with CDP on port 9222. Works on Linux with `network_mode: host`. On Windows/Mac Docker Desktop, Chrome 111+ blocks DevTools connections from Docker's non-loopback proxy — use local `chromium.launch()` instead (the session manager falls back automatically).

```bash
docker compose up --build -d   # Start Chrome in Docker
./scripts/launch-chrome.sh     # Build + start + health check
```

## Roadmap

- [x] **Phase 1 (MVP)**: Page model + ref-based actions + persistent session + delta output
- [x] **Phase 2**: Vision fallback (marked screenshots for canvas/shadow-DOM ambiguity)
- [x] **Phase 3**: High-level `goto "nl goal"` (internal perceive→ground→act→verify loop) + `--interactive-only` flag + click-to-reveal multi-step intent composition
- [ ] **Phase 4**: Steel.dev chrome farm + anti-detect + proxy rotation
- [ ] **Phase 5**: Skill packaging (CLI + injected instructions, like agent-browser ships)
- [ ] **Phase 6**: Scale path (Browserbase managed, optional Rust CDP orchestrator)

See [DESIGN.md](DESIGN.md) §7 for the full roadmap.
