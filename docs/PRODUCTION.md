# Cairn: MVP → Production Grade

> A grounded assessment of where Cairn is today, the specific gaps that separate it from production-grade, and a prioritized path to close them. Written from a direct read of the current code (Aug 2025). Companion to [DESIGN.md](DESIGN.md) (approach) and [COMPARISON.md](COMPARISON.md) (vs agent-browser).

> **UPDATE (post-assessment):** Most of the Tier 1–2 gaps below are now **closed**. Status as of the latest pass:
> - **Tier 1 (reliability):** ✅ Test suite — 17 test files (unit + E2E + hvac-regression, `npx vitest run`). ✅ Grounding embeddings fallback (`intent/embeddings.ts`, lazy all-MiniLM-L6-v2). ✅ Error taxonomy (`errors.ts`, 9 codes `E_NOT_FOUND`/`E_AMBIGUOUS`/`E_BROWSER_DEAD`/`E_REF_STALE`/… + `CairnError` + `renderError`). ⚠️ Crash recovery / CDP-reconnect on a dead persistent Chrome — still open.
> - **Tier 2 (capability):** ✅ `extract` (structured JSON). ✅ Tabs + iframe support in the page model. ✅ Action set — `hover`/`scroll`/`select`/`keypress`/`drag`. ✅ Dialog + file upload/download + cookies/storage persistence. ✅ Open-shadow-DOM piercing (refs stamped on shadow-root controls) + `look --include-hidden` (surfaces `display:none`/`aria-hidden` content). These two close the [HVAC_BUGREPORT.md](HVAC_BUGREPORT.md) bugs #6 and #5 that the original hunt missed.
> - **Beyond the tiers:** ✅ Task recording/replay (Leap 2) + transparent self-healing of stale refs (Leap 3) + NL-to-plan compilation `compile`/`run`/`plans` (Leap 1). ✅ `--trace` (non-DOM side-effect capture: failed XHRs, console errors, JS exceptions). ✅ Skill packaging (`skills/cairn/SKILL.md`, installable). ✅ `--include-hidden`, `--interactive-only`/`-i`, `--visual`.
> - **Still open:** CDP reconnect + dead-browser relaunch; `--json` output mode; npm publish (`npm i -g cairn-browser`); MCP integration; network mocking; session pool/concurrency (Tier 4).
>
> The section below is the **original assessment**, retained for context; read it as the "before" picture against the update above.

---

## 1. Where we are — an honest read

**What's genuinely solid (the core loop is real):**

| Capability | Evidence |
|---|---|
| Spatial-semantic page model + inferred interactivity | `model/page-model.ts` fuses AX role + computed style + cursor + tabindex + contenteditable. Catches div-as-button that AX-only tools miss. |
| Stable ref-based actions (no coordinates) | `data-cairn-ref` stamped in model build; `click`/`type`/`focus` resolve ref → `[data-cairn-ref]` → Playwright. Eliminates location hallucination by construction. |
| Delta output | `model/delta.ts` MutationObserver → settle → diff-by-ref. An action costs ~1 line, not a full dump. |
| NL `goto` intent (collapse the loop) | `intent/execute.ts` runs perceive→ground→act→verify deterministically, no in-tool LLM. Click-to-reveal handles Wikipedia/DuckDuckGo dialog-search. |
| Vision fallback | `vision/screenshot.ts` overlays numbered boxes over *live* bboxes with the *same* refs. Vision perceives, refs ground. |
| Pluggable backend + auto-fallback | Steel (self-hosted chrome farm) or local Chrome; falls back to local if Steel is down (`session.ts:69-80`). |
| Skill packaging | `skills/cairn/SKILL.md` + references, modeled on agent-browser's format. |

**What's MVP-level / unproven (the gap):**

- **No tests.** Zero unit or e2e tests for Cairn's own `src/`. The 6-task benchmark (`BENCHMARK.md`, 100% vs agent-browser 67%) is a *sample of 6* on simple pages — not production evidence. Grounding weights, the parser, the renderer, and the delta differ are all untested logic that will drift the moment real pages hit it.
- **Never built or published.** No `dist/`. The CLI runs only via `npx tsx src/cli.ts`. `npm run build` (`tsc`) has never produced a shippable artifact, and the `cairn` binary in `package.json` points at `dist/cli.js` which doesn't exist yet. Not on npm.
- **Shallow resilience.** Top-level catch (`cli.ts:302`) dumps `Error: <message>` and exits. No retry, no timeouts exposed, no CDP-reconnect when the persistent Chrome dies, no dead-browser detection. A crashed detached Chrome = an opaque failure on the next command.
- **Brittle grounding.** `grounding.ts` scores on Jaccard token overlap + substring + role/region hints with hand-tuned constants (`MATCH_THRESHOLD=0.35`, `AMBIGUITY_MARGIN=0.15`). It works on exact words and fails on the synonyms and paraphrases that dominate real UIs: "log in" ≠ "sign in", "submit" ≠ "continue", "email" ≠ "username". This is the single biggest correctness risk — and it's the core differentiator, so it deserves the most investment.
- **Capability holes.** `extract` is a stub (`cli.ts:279`). No tabs, no iframes in the page model, no hover/scroll/select/drag/keyboard/keypress, no file upload/download, no dialog (alert/confirm) or basic-auth handling, no cookie/storage persistence. agent-browser ships all of these.

---

## 2. The production gap, categorized

### A. Reliability & robustness (highest priority — don't build on an untested core)

| Gap | Where | Why it matters |
|---|---|---|
| No test suite | — | Every refactor will silently regress grounding/rendering/delta. First thing to fix. |
| No crash recovery / dead-browser detection | `session/backend.ts` | Detached Chrome dies → next command fails opaquely. Must detect + relaunch. |
| No CDP reconnect | `session/session.ts` | A dropped CDP socket mid-session is unrecoverable today. |
| No retry/timeout strategy | `actions/*.ts`, `cli.ts` | Playwright auto-wait helps, but navigation timeouts and flaky-click retries aren't configurable. |
| No error taxonomy | `cli.ts:302` | Errors are opaque strings. The agent can't decide "retry" vs "look --visual" vs "give up" from `Error: Target closed`. |
| Grounding fails on synonyms | `intent/grounding.ts` | The differentiator. "Sign in"/"Log in" mismatch is the #1 real-world failure. |

### B. Capability completeness (what real tasks need that's missing)

| Gap | Notes |
|---|---|
| `extract` is a stub | DESIGN.md lists it as a core command. Structured extraction (schema → JSON) is a headline agent capability. |
| No tabs / windows | Real browsing opens popups and new tabs. agent-browser has full tab management. |
| No iframe support in the page model | The DOM walk in `page-model.ts` doesn't cross iframe boundaries. Many real forms live in iframes (payment, embedded widgets). |
| Limited action set | Missing: hover, scroll, select (dropdown), drag, keyboard shortcuts, keypress, scroll-to-element (for lazy-loaded content not yet in DOM). |
| No dialog / popup / basic-auth handling | `page.on('dialog')` isn't wired. alert/confirm/prompt will block the page. |
| No file upload / download | Common in real automation. |
| No cookie / storage persistence | Can't persist an auth session across `release`/reconnect. Steel session helps but local Chrome can't. |
| No semantic `find` locator | COMPARISON.md item 5. A complement to refs for when the agent knows the role+name but not the ref. |

### C. Packaging & distribution

| Gap | Notes |
|---|---|
| Build pipeline unproven | `tsc` → `dist/` never run to completion. Must verify it compiles and the CLI works from `dist/cli.js` (not just `tsx`). |
| Not published | Not on npm. `npx cairn` / `npm i -g cairn-browser` doesn't work. Skill isn't installable end-to-end. |
| Playwright browser install is manual | `npx playwright install chromium` is a friction step. For a skill, auto-handle or document prominently. |
| No `--json` output mode | Agent parses free text. A structured JSON mode makes agent consumption reliable and enables programmatic use. |
| No CHANGELOG / semver discipline | — |

### D. Observability & debuggability

| Gap | Notes |
|---|---|
| No logging / `--verbose` / `--debug` | `.sessions/` stores screenshots + state, but no structured logs of what the tool decided and why. |
| No Playwright tracing exposed | Playwright has world-class tracing; exposing `--trace` would make agent-failure debugging trivial. |
| No grounding debug output | `grounding.ts` computes `reasons[]` per candidate but the CLI doesn't surface them. A `--explain` flag would show *why* it picked e15. |
| No session history / replay | — |

### E. Scale & operations (Phase 6 — later)

| Gap | Notes |
|---|---|
| Single browser per session | No session pool, no concurrency. Fine for one agent; not for a farm. |
| No local-Chrome health checks / cleanup | Detached process can zombie. No resource limits. |
| Steel backend untested at scale | Works in dev; no load/concurrency data. |
| No metrics | No success-rate / latency / grounding-accuracy telemetry to know if you're *getting* more production-grade. |
| Browserbase managed path | DESIGN.md §7 reserves this for when self-hosting hurts. |

---

## 3. Recommended path (prioritized)

The ordering principle: **Cairn's differentiator is grounding quality + step efficiency, so harden that first, then broaden, then ship, then scale.** Don't add features on an untested core.

### Tier 1 — Make the core trustworthy (reliability)
*Goal: the existing loop is provably correct and recovers from failure.*

1. **Test suite.** Unit tests for the pure logic that's currently untested and most likely to drift: `grounding.ts` (scoring, thresholds, typeability penalty), `parser.ts` (intent parsing), `renderer.ts` (tree output), `delta.ts` (diff-by-ref). E2E tests for the CLI on a set of stable local test pages (a login form, a page with a div-as-button, a dialog-search page) asserting on command output. This is the foundation everything else stands on.
2. **Grounding robustness.** Add the embeddings fallback already flagged in COMPARISON.md item 8: a local model (`@huggingface/transformers` all-MiniLM-L6-v2) loaded lazily, used *only* when deterministic grounding returns notFound/ambiguous. Semantic similarity catches "sign in" ↔ "log in" without an LLM call and without breaking the deterministic fast path. Add Levenshtein fuzzy match for typos. This is the highest-leverage investment because it directly upgrades the differentiator.
3. **Crash recovery + reconnect.** `SessionManager` should health-check the CDP endpoint before reuse, detect a dead Chrome, and relaunch transparently. Reconnect on dropped socket.
4. **Error taxonomy.** Replace the top-level string-dump with categorized, agent-actionable errors: `E_NOT_FOUND` (→ suggest `look --visual`), `E_AMBIGUOUS` (→ list candidates), `E_NAVIGATION_TIMEOUT` (→ retry/adjust), `E_BROWSER_DEAD` (→ auto-relaunch), `E_REF_STALE` (→ re-`look`). Emit as structured text today, `--json` later.

### Tier 2 — Make it complete enough for real tasks (capability)
*Goal: the agent can finish tasks that today it can't start.*

5. **Build `extract`.** Schema → JSON structured extraction. Natural complement to `goto`; completes the command surface from DESIGN.md §4.5.
6. **Tabs + iframes.** Extend the page model to cross iframe boundaries (stamp refs inside frames). Add `tab` commands (list/switch/close/new). Popups and embedded forms are common.
7. **Action set: hover, scroll, select, keypress, drag.** These are one-line Playwright calls behind a ref. Scroll-to-element also fixes lazy-loaded content that isn't in the DOM until visible.
8. **Dialog + file upload/download + cookies/storage.** Wire `page.on('dialog')`, `setInputFiles`, download events, and `storageState` persistence. These unblock a large class of real flows (auth, file handling).

### Tier 3 — Make it installable and observable (packaging)
*Goal: a user can `npx cairn` and debug failures.*

9. **Verify + fix the build.** Run `npm run build`, fix whatever `tsc` complains about, confirm `node dist/cli.js goto https://example.com` works (not just `tsx`). Wire a `prepublish` + `postinstall` (Playwright browser download).
10. **Publish to npm.** `cairn-browser` → npm with a `0.x` semver. Verify the skill (`skills/cairn/SKILL.md`) loads in an agent runtime end-to-end.
11. **`--json` output mode + `--explain` grounding debug + `--trace`.** Structured output for reliable agent consumption; `--explain` surfaces the `reasons[]` the grounder already computes; `--trace` wraps Playwright tracing for failure debugging.

### Tier 4 — Scale (only when self-hosting starts to hurt)
*Goal: many concurrent agents, managed infra option.*

12. **Session pool + concurrency** for the local backend; health checks + zombie cleanup.
13. **Steel at scale** — load-test the Steel backend, add connection pooling.
14. **Browserbase managed path** (DESIGN.md §7) for when DevOps outweighs value.
15. **Metrics** — success rate, latency, grounding accuracy — so you can *measure* production-grade rather than guess.

---

## 4. What I'd do first

If the goal is "production grade" and not just "more features," **Tier 1 is non-negotiable and Tier 1.1 (tests) + Tier 1.2 (grounding robustness) are the two highest-leverage moves**:

- **Tests** because every later change will regress the untested scoring/parser/delta logic without anyone noticing, and the 6-task benchmark isn't enough to catch it.
- **Grounding embeddings** because it's the one upgrade that materially changes *whether the tool works on real pages*, and it's already scoped in your own COMPARISON.md. It turns "works on exact words" into "works on intent" without adding an LLM round-trip — which is the whole thesis of the tool.

Everything in Tier 2+ is additive capability on top of a core that, after Tier 1, you can trust.

---

## 5. Open decisions

- **Grounding fallback philosophy.** Keep deterministic-only and let the agent (which *is* an LLM) resolve ambiguity via `look --visual`? Or add an optional `--vision-ground` mode that sends the marked screenshot to a vision model and gets a ref back automatically? The former preserves "no in-tool LLM call" (a stated design principle); the latter is more autonomous but costs a round-trip. My lean: embeddings fallback (deterministic-ish, cheap) first; vision-ground as an explicit opt-in flag, never default.
- **Extract strategy.** Pure DOM/AX extraction (deterministic, cheap) vs. vision-based extraction (handles canvas/PDFs, costs a model call). Likely both, gated like `look --visual`.
- **`--json` from day one vs. after?** If any non-agent (CI, scripts) will consume Cairn, do it early. If it's purely an agent skill, free-text self-describing output is fine and JSON can wait for Tier 3.
- **How much `goto` autonomy?** DESIGN.md §8 flagged this. More autonomy = fewer round-trips but less agent visibility/control. The click-to-reveal fallback already took a step toward autonomy; decide where the ceiling is before it grows.
