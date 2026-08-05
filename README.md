# ai-browser-tester

An agent-first browser testing tool — optimized for LLM agents, not test scripts.

> **Status:** MVP (Phase 1). The core loop works: navigate → look → click/type by stable ref → see compact deltas. No vision yet (Phase 2). See [DESIGN.md](DESIGN.md) for the full design and [COMPARISON.md](COMPARISON.md) for a head-to-head vs agent-browser.

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
abt look                 Show current page as hierarchical tree with refs
abt focus <region|ref>   Zoom into a region (nav/main/sidebar/footer/modal)
abt click <ref>          Click by stable ref (deterministic, no coordinates)
abt type <ref> <text>    Fill a field by ref
abt status               Show session state (URL, focused region, connection)
abt extract <schema>     Structured extraction (Phase 2)
```

## How it works

1. **Persistent session**: Chrome launches as a detached background process on `127.0.0.1:9222`. Each CLI command connects via Playwright `connectOverCDP` — the browser stays alive across commands.

2. **Page model**: One `page.evaluate()` call walks the DOM and builds a tree of enhanced nodes — each with a stable ref (`e1`, `e2`, ...), role, accessible name, bounding box, inferred interactivity, and region classification.

3. **Inferred interactivity**: Instead of trusting ARIA attributes (which "lie" on custom widgets), we fuse: native tags + ARIA roles + tabindex + `cursor:pointer` + inline `onclick` + contenteditable + visibility. This catches div-as-button that attribute-only tools miss.

4. **Hierarchical renderer**: Produces a compact, bash-like tree with `[ref=eN]` refs and region clustering (▼ Header / ▼ Main / ▼ Footer). `focus` zooms into a subtree for token efficiency.

5. **Ref-based actions**: Refs are stamped as `data-abt-ref` attributes during model build. Actions resolve `ref → [data-abt-ref="eN"] → Playwright action`. The agent never outputs coordinates.

6. **Delta output**: After an action, a `MutationObserver` waits for the page to settle, then we re-snapshot and diff by ref — emitting only what changed (`+` added / `-` removed / `~` changed). An action that changes one field costs ~one line, not a full page dump.

## Architecture

```
src/
├── cli.ts                  CLI entry point + command dispatch
├── session/session.ts      Persistent session (detached Chrome + connectOverCDP)
├── model/
│   ├── page-model.ts       Spatial-semantic page model (DOM walk + interactivity + regions)
│   ├── interactivity.ts    Interactivity inference logic (injected into browser)
│   └── delta.ts            MutationObserver + diff-by-ref delta output
├── render/renderer.ts      Hierarchical tree renderer with region clustering
└── actions/
    ├── click.ts            Ref-based click (Playwright auto-wait)
    ├── type.ts             Ref-based fill (clear + type)
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
- [ ] **Phase 2**: Vision fallback (marked screenshots for canvas/shadow-DOM ambiguity)
- [ ] **Phase 3**: High-level `goto "nl goal"` (internal perceive→ground→act→verify loop)
- [ ] **Phase 4**: Steel.dev chrome farm + anti-detect + proxy rotation
- [ ] **Phase 5**: Skill packaging (CLI + injected instructions, like agent-browser ships)
- [ ] **Phase 6**: Scale path (Browserbase managed, optional Rust CDP orchestrator)

See [DESIGN.md](DESIGN.md) §7 for the full roadmap.
