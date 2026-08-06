# How to Make Cairn Revolutionary (Not Just Better)

> Analysis of what Cairn has, what every competitor misses, and the five leaps that would make it the undisputed best agentic browser tool. Grounded in a direct read of Cairn's source code (Aug 2025), a competitive landscape scan of 9 tools, and frontier research on agent-latency optimization and self-healing automation.

---

## TL;DR

You're right — Cairn's core is already strong. It beats agent-browser on task success (100% vs 67%), total output (33% less), and command count (18% fewer). But the entire field — browser-use, Skyvern, Stagehand, agent-browser, Playwright MCP — shares **six unsolved gaps**, and no tool is simultaneously token-lean + layout-resilient + fast + hybrid-grounded + self-recovering + cheap-to-run.

The revolutionary play isn't another feature. It's turning Cairn from a **per-task cost center** into an **asset library** — where every task the agent explores once becomes a free, permanent, deterministic replay. Five leaps compound to make this real, led by NL-to-plan compilation (reported 10.4× speedup, +28% accuracy in 2026 Stanford/Google "Agent JIT" research) and record/replay (Freu AI, HyperAgent).

**Every LLM dollar spent becomes a permanent asset. The more you use it, the faster and cheaper it gets. No competitor does this end-to-end.**

---

## Part 1: Where Cairn already leads

You said "I think we're already doing well" — here's the proof that you are:

| Capability | Cairn | agent-browser | browser-use | Skyvern | Stagehand |
|---|---|---|---|---|---|
| Act by stable ref (no coordinates) | ✅ `data-cairn-ref` | ✅ `@eN` refs | ❌ LLM picks | ❌ vision coords | ✅ `act()` |
| Delta output (not full re-snapshot) | ✅ MutationObserver diff | ❌ re-snapshot | ❌ | ❌ | partial (caching) |
| Hierarchical region zoom | ✅ `focus` | ❌ flat | ❌ | ❌ | ❌ |
| Inferred interactivity (div-as-button) | ✅ cursor+onclick fusion | ❌ AX only | ❌ | ✅ vision | ❌ |
| NL goto intent (collapse the loop) | ✅ deterministic | ❌ | ❌ ReAct loop | ❌ | ✅ `act()` NL |
| Self-hosted chrome farm (free) | ✅ Steel Apache-2.0 | ❌ local only | ❌ | ❌ | ❌ Browserbase paid |
| Full action surface | ✅ 19 commands | ✅ mature | ✅ | ✅ | ✅ 4 primitives |
| Error taxonomy (agent-actionable codes) | ✅ 9 codes | ❌ strings | ❌ | ❌ | ❌ |

**Benchmark proof** (BENCHMARK.md, 6-task suite): 100% task success (6/6) vs agent-browser 67% (4/6). 33% less total output. 18% fewer commands. On the Wikipedia search results page, Cairn's `look -i` was **4.3× more compact** than agent-browser's `snapshot -i` (38 KB vs 165 KB).

**What this means:** Cairn's design principles — act by ref, infer interactivity, collapse the loop, deltas not snapshots — are already the right foundation. The question isn't "is the core good?" (it is). The question is "what leap turns it from a better CLI into a category-defining tool?"

---

## Part 2: The six gaps NO competitor solves

From a scan of 9 tools (agent-browser, browser-use, Stagehand, Skyvern, LaVague, Playwright MCP, Browserbase, Steel, browserless), six pain points recur so consistently that **no tool handles all of them**:

1. **Per-step LLM cost & token bloat.** Every action = an LLM round-trip. browser-use: "$0.15–0.30 per 10-step workflow × 1000/day = CFO problem." Skyvern: "every action costs an LLM call." Stagehand admits AI automation is "slower, more expensive, and less reliable than deterministic." Even agent-browser (claims 97% token reduction) and Playwright MCP (no vision) only attack the token half — the per-step LLM round-trip pattern is everywhere.

2. **Selector rot & the maintenance tax.** Vision-first tools (Skyvern) dodge CSS rot but trade it for "when it fails, it fails hard" (~64% real-world success, vs 85.8% self-reported). DOM/snapshot tools still rely on page structure. Traditional tools break on every layout change.

3. **Slow LLM loops / latency.** Vision-first is worst (screenshot → VLM → action per step). Even DOM-first agents pay a full LLM round-trip per action — too slow for high-volume or interactive CI loops. Stagehand concedes "use plain Playwright for the 90% that's predictable."

4. **The DOM-vs-vision grounding schism.** DOM-first is fast and token-efficient but blind to canvas/PDF/obfuscated iframes. Vision-first works on anything but burns tokens. No tool nails the hybrid gracefully — Stagehand's DOM/Hybrid/CUA modes are the closest attempt but add complexity. Each tool picks a side and inherits that side's blind spot.

5. **Poor error recovery & popups/overlays.** agent-browser documents it plainly: "Clicks fail when a consent banner covers the target. Dismiss it, take a fresh snapshot, then retry." The recovery burden is foisted on the caller. Self-heal is nascent (browser-use Harness, Stagehand caching) but historically agents freeze on overlays with no autonomous escape.

6. **Managed-service lock-in & hidden costs.** Browserbase per-session pricing "adds up at high volume vs self-hosting." Steel self-host meters CAPTCHA ($3–4/1k, ~70% success) and proxy bandwidth ($5–10/GB). All raise data-sovereignty and outage-dependency concerns.

**The unsolved holy grail:** a tool that is simultaneously **token-lean + layout-resilient + fast + hybrid-grounded + self-recovering + cheap-to-run.** No current tool is all six. That's Cairn's opening.

---

## Part 3: The five revolutionary leaps

Each is mapped to Cairn's actual code — file + function level — so it's a concrete build, not hand-waving.

### Leap 1: NL-to-Plan Compilation — the architectural keystone

**What:** Compile a natural-language task ("log into the site, navigate to settings, change the email") ONCE into a deterministic plan — a sequence of ref-anchored actions with pre/postcondition invariants and fallbacks — then execute it with **zero LLM calls**.

**Why it's revolutionary:** "Agent JIT Compilation" (reported as ICML 2026, Stanford + Google) proved compilation beats interpretation for web automation: **10.4× speedup and +28% accuracy over Browser-Use; 2.4× speedup and +9% over OpenAI's CUA.** The key finding: **45–50% of web-automation errors are incorrect action sequences** (right actions, wrong order). Static control-flow-graph validation with pre/postcondition invariants cut the failure rate from 59% → 25% and raised the valid-plan rate from 77% → 91%.

**And when a step fails mid-plan, the Planner re-derives the remaining sub-goals (genuine replanning, not retry).** Agent-E (arXiv 2024) proved the hierarchical Planner+Navigator split — high-level reasoning shielded from low-level execution noise — achieves **+30% over SOTA** on WebVoyager. Most agents just retry the failed step; the Planner *replans the tail of the plan* given the new page state. This is the difference between a flat retry loop and a genuine plan executor.

**Where it plugs into Cairn:**
- `src/intent/execute.ts:executeGoto()` currently runs ONE intent (click OR type OR hover). "Log in" = 3 separate `goto` commands = 3 LLM round-trips. **This is the seam.** A `compilePlan()` function would call the LLM ONCE to produce a multi-step plan (JSON array of `{action, target, text, pre, post}`), then execute it deterministically via the existing `clickByRef` / `typeByRef` / etc.
- Cairn's 9-code error taxonomy (`src/errors.ts`) maps cleanly onto pre/postcondition invariants: each action gets a `pre` (element visible + typeable) and `post` (page state changed as expected). Two actions chain iff first's `post` satisfies second's `pre`.
- The parser (`src/intent/parser.ts`) already parses single intents; extending it to parse multi-step NL ("type X then click Y") is incremental.

**New commands:** `cairn compile "log in with username foo and password bar"` → produces + executes a plan, saves it. `cairn run <plan-id>` → replays deterministically.

**Impact:** 10× latency, +28% success, eliminates per-step LLM calls for the planned path. Highest-leverage of all five.

---

### Leap 2: Task Recording + Zero-LLM Replay — the asset library

**What:** Record a successful agent run (every ref used, every fallback taken, every DOM delta observed) and replay it later with **zero LLM calls**. Turns a 15-step LLM task (45–60s, $0.30–1.50) into a deterministic replay (<5s, $0).

**Why it's revolutionary:** This is what turns Cairn from a cost center into an asset library. Every task the agent does once becomes a free, permanent, deterministic asset. **Freu AI** claims up to 90% token reduction with "record-once, replay-many workflow compilation." **HyperAgent** ships explicit "Action Caching — record and replay workflows deterministically without LLM calls." **rrweb** records the agent's tool-call trace + DOM state per action for replay + divergence detection ("divergence found at step 6").

**Where it plugs into Cairn:**
- `executeGoto()` in `src/intent/execute.ts` already runs the full perceive→ground→act→verify loop and returns an `ExecuteResult` with `intent`, `ground` (matched ref + score + reasons), and `delta`. **A recorder wraps `executeGoto`**: before returning, it serializes `{intent, groundedRef, fallbacksUsed, postActionDelta}` to a plan file.
- **Ref-stability across page changes:** store multiple anchors per ref — primary `data-cairn-ref` + fallback chain (semantic embedding via `groundIntentWithFallback`, SoM visual coords via `captureMarkedScreenshot`). When the primary ref goes stale during replay, auto-degrade through the same grounding stack Cairn already has. (Prior art: Resilient-Locator-Extractor outputs a resilience hierarchy `data-testid > aria > role > text > structural path`; Healenium uses ML attribute-similarity.)
- Cairn already has `--session` persistence. The recorder adds a `--record` flag and a `replay` command.

**New commands:** `cairn goto "<task>" --record` → records the successful trace. `cairn replay <task-id>` → zero-LLM deterministic replay.

**Impact:** ~$0 marginal cost, ~10× latency on repeat tasks. The compounding payoff.

---

### Leap 3: Transparent Self-Heal — never fail on a stale ref again

**What:** When a ref is stale (page changed since the model was built), automatically capture a marked screenshot, re-ground via vision + DOM + embeddings, and continue — all transparently. The agent never sees the failure.

**Why it's revolutionary:** The #1 agent failure mode is a ref that drifts — and Cairn currently just throws `E_REF_STALE` and bails (see `cli.ts` lines 308, 327, 348). But Cairn already has ALL the pieces: `captureMarkedScreenshot` (Set-of-Mark numbered screenshots), `groundIntentWithFallback` (deterministic + embeddings grounding), `buildPageModel` (fresh model build). The fix is mostly wiring.

**Where it plugs into Cairn:**
- In `src/cli.ts` (click/type/hover/scroll/drag/select commands, lines 289–430) and `src/intent/execute.ts:executeGoto()` — the failure path currently catches the error and emits `E_REF_STALE` with "Run `cairn look` for fresh refs."
- **The self-heal wiring:** on `E_REF_STALE` (or `E_CLICK_FAILED`), instead of bailing: (1) `await buildPageModel(page)` for a fresh model, (2) `await captureMarkedScreenshot(page, model)` for a SoM screenshot, (3) re-run `groundIntentWithFallback(intent, freshModel)` — if it matches, retry the action with the new ref, (4) if semantic grounding also fails, optionally send the SoM screenshot to a vision model for visual re-grounding (opt-in via `--vision-ground`), (5) log the heal for transparency.
- Prior art: **Healenium** (ML attribute-similarity self-heal for Selenium), **TestInspector** (auto-retry with AI re-grounding). But **vision + agent self-heal is novel** — no agentic-browser tool does it.
- **Grounding-method caveat (from the research):** SeeAct (ICML 2024) found Set-of-Mark prompting "not effective" for grounding in isolation — the number-to-element mapping is error-prone, and UGround (ICLR 2025 Oral) showed a *trained* visual grounding model (NL→pixel coordinates) is the path that actually works. Trained grounding is also the only method that grounds canvas/WebGL — the thing AX/DOM categorically can't. **Pragmatic path for Cairn:** semantic re-grounding (steps 1–3 above) handles the common stale-ref case cheaply with no model download; routing to a trained grounding model for pixel-only UIs is the upgrade. SeeAct's headline finding: oracle grounding → **51.1% task success vs 13.3% for text-only** — grounding is THE bottleneck, with a 20–25% gap to oracle remaining even for the best methods.

**Impact:** eliminates the most common agent failure (stale refs). Low effort — the pieces exist. The research consensus (SeeAct, Agent-E, Mind2Web, AutoWebGLM): grounding quality dominates everything else, act-by-stable-ref beats coordinate guessing, and hybrid DOM+visual beats either alone.

---

### Leap 4: Page Model as Query, Not Dump — ship answers, not trees ✅ DONE

**What:** Instead of dumping the full page tree (`look`), let the agent ask targeted queries and get one-line answers: "what's the primary action in this form?", "what changed since the last step?", "which elements match 'submit'?"

**Status:** Implemented in `src/intent/query.ts`. Four query types: `match` (reuses `groundIntent` with typeable-element disambiguation), `primary-action` (highest-priority interactive node, prefers buttons/submit), `form-fields` (all typeable elements via `TYPEABLE_ROLES`), `diff` (reuses `computeDelta` against a persisted model snapshot in `.sessions/<id>.model.json`). Model snapshots auto-saved after `look` and `goto`. CLI: `cairn query "<question>" [--region <r>]`. 23 unit + 6 E2E tests.

**Why it's revolutionary:** Every tool ships full snapshots. Even Cairn's compact `look -i` is 5.5 KB on Wikipedia. But the agent rarely needs the whole tree — it needs one answer. A query API would return: `query("primary-action", region="main")` → `button "Sign in" [e15]` (one line, ~30 bytes). That's a ~180× reduction on a 5.5 KB tree.

**Where it plugs into Cairn:**
- `groundIntent()` in `src/intent/grounding.ts` IS already a query — it scores all interactive nodes against a target and returns the best match. It's just only reachable via `goto`. Exposing it as a standalone command: `cairn query "submit button"` → returns the top match + ref.
- `computeDelta()` in `src/model/delta.ts` already answers "what changed?" — expose it: `cairn query "what changed since step 3"`.
- Add query types: `primary-action` (highest-scoring interactive node in a region), `form-fields` (all typeable elements in the focused form), `match <text>` (reuse `groundIntent`), `diff` (reuse `computeDelta`).
- Prior art: **Lightpanda** (headless browser "built for AI agent workflows," caches DOM snapshots between queries) is closest, but still snapshot-based, not a true query language. **The query-language framing is novel.**

**New command:** `cairn query "<question>" [--region <r>]` → compact one-line answer from the page model.

**Impact:** major token-cost reduction on every step where the agent needs one fact, not the whole page.

---

### Leap 5: Speculative Execution — branch prediction for agents

**What:** While the LLM reasons about step N, speculatively execute the most likely next action. If the LLM agrees → zero added latency. If not → rollback and take the LLM's path.

**Why it's revolutionary:** **PASTE** ("Act While Thinking," reported arXiv 2026, Microsoft Research + SJTU + HKUST) runs as a tool-serving proxy: a Pattern Analyzer predicts future tool calls by mining recurring sub-workflow patterns from historical traces; a Tool Speculation Scheduler executes non-interfering predicted tools speculatively while the LLM generates. Results: **43.5% avg / 55.4% p99 latency reduction, 1.8× lower observed tool latency.** Tool execution is 45–57% of agent E2E latency, so hiding it is high-leverage.

**Where it plugs into Cairn:**
- Cairn's persistent session + action history already provide the trace data PASTE mines for patterns.
- The Pattern Analyzer would observe: "after `goto <login-url>`, the agent always does `type username` → `type password` → `click sign in`" — and speculatively execute the first step while the LLM reasons.
- Rollback is the hard part: use Playwright browser contexts (snapshot/restore per speculative branch). A speculative click that the LLM didn't want gets rolled back.
- Pairs with Leap 2 (record/replay): the pattern library IS the speculative prediction source.

**Impact:** 43% latency reduction. High novelty — no shipping agentic-browser tool does speculative execution.

---

## Part 4: The compounding flywheel — how the five leaps combine

Each leap is powerful alone, but they compound into something no competitor has. The flywheel turns every LLM dollar into a permanent asset:

1. **First run** — agent explores a task (LLM-driven, ~$0.30, ~60s). `executeGoto` + `--record` captures the trace: refs used, fallbacks taken, DOM delta observed.
2. **Second run** — `cairn replay <task-id>` runs deterministically (~$0, ~5s). 10× cheaper, 10× faster.
3. **New similar task** — cross-session learning (procedural memory, per Agentium's pattern) finds the recorded plan, warm-starts the agent (fewer LLM calls, lower error rate).
4. **CI regression** — `cairn export test <task-id>` emits a permanent Playwright test from the recorded trace. Runs forever for free.
5. **New multi-step task** — NL-to-plan compilation (`cairn compile "log in and change email"`) calls the LLM ONCE to produce a plan, then executes it deterministically — and saves it for future replay.
6. **Latency hiding** — the plan library predicts the next action while the LLM reasons, hiding tool-execution latency (43% reduction).

**Every LLM dollar spent becomes a permanent asset.** The CLI compounds value over time — the more you use it, the faster and cheaper it gets. No competitor does this end-to-end:

| Piece | Who has it | Combines into the flywheel? |
|---|---|---|
| Record/replay | Freu AI, HyperAgent | No plan compilation, no cross-session learning |
| NL-to-plan compilation | Agent JIT (academic) | No record/replay, no replay-to-test |
| Procedural memory | Agentium | No browser automation, no plan compilation |
| Self-heal | Healenium (Selenium) | No vision, no agent-loop, no record/replay |
| Caching | Stagehand | >80% cost cut but no replay-to-test, no cross-session |
| **All five + flywheel** | **Cairn (proposed)** | **Yes — each piece feeds the next** |

---

## Part 5: Supporting capabilities (high-value, lower-effort)

| Capability | What | Effort | Impact |
|---|---|---|---|
| `--explain` flag | Surface the `reasons[]` array `grounding.ts:scoreNode()` already computes | Trivial (1 flag) | Debugging transparency — agent sees *why* e15 was picked |
| Vision-as-action-verifier | Tiny VLM (Qwen3.5-0.8B ~1GB, Moondream, SmolVLM) verifies each action achieved its intent ("did login succeed?") | Medium | Catches silent failures without a full LLM step |
| Agent-flow-to-test compiler | `cairn export test <task-id>` emits a Playwright script from a recorded trace | Medium | CI bridge — free permanent regression tests |
| Cross-session learning | Embed successful traces, retrieve on similar queries (reuse `intent/embeddings.ts`) | Medium | Warm-start, fewer LLM calls on repeat task types |
| `--json` output mode | Structured JSON for programmatic/CI consumption | Low | Reliable agent + script consumption |
| Resilient locator hierarchy | Store `data-testid > aria > role > text > path` per ref for replay stability | Low | Makes record/replay survive page redesigns |

---

## Part 6: Ranked build priority

| Priority | Leap | Why this order | Effort | Proven impact |
|---|---|---|---|---|
| ✅ 1 | **Transparent Self-Heal** (Leap 3) — **DONE** | Pieces exist; highest reliability gain per effort. Do this first — it makes everything else robust enough to build on. | Low-Med | Eliminates #1 failure mode (stale refs) |
| ✅ 2 | **Task Recording + Replay** (Leap 2) — **DONE** | The asset-library foundation. Once you can record/replay, every other leap builds on it (plans ARE recorded traces; tests ARE compiled traces; speculation mines traces). | Medium | ~$0, ~10× latency on repeats |
| ✅ 3 | **NL-to-Plan Compilation** (Leap 1) — **DONE** | The keystone — 10.4× speedup, +28% accuracy. Builds on the recorder (a compiled plan IS a recorded plan generalized). | Med-Hard | 10.4× / +28% (Agent JIT) |
| ✅ 4 | **Page Model as Query** (Leap 4) — **DONE** | Token reduction on every step. Independent of the others — can build in parallel. | Medium | ~180× reduction per query |
| 5 | **Speculative Execution** (Leap 5) | Last — needs the pattern library from recording + learning to be useful. | Medium | 43% latency (PASTE) |

**The recommended sequence:** Self-heal first (make the core unbreakable) → record/replay (build the asset library) → NL-to-plan compilation (the 10× keystone) → query API (token efficiency) → speculative execution (latency hiding).

By the time you reach step 3, Cairn is the only tool that turns agent exploration into permanent deterministic assets. By step 5, it's the only tool that is simultaneously **token-lean + layout-resilient + fast + hybrid-grounded + self-recovering + cheap-to-run** — the holy grail no competitor has achieved.

---

## Appendix: Research basis

**Competitive landscape (9 tools scanned):**
- agent-browser (vercel-labs, ~40k★, Apache-2.0, AX-snapshot, native Rust CLI, gets stuck on overlays)
- browser-use (~85–108k★, MIT, DOM-first Python, 89.1% WebVoyager, per-step LLM cost is THE complaint)
- Stagehand (Browserbase, 11.5k★, MIT, act/observe/extract/agent, DOM/Hybrid/CUA modes, caching >80% cost cut)
- Skyvern (20.8k★, AGPL-3.0 copyleft, vision-first, 85.8% self-reported / ~64% third-party, "fails hard")
- LaVague (6.4k★, Apache-2.0, Python LAM, code-gen over Selenium, stale/unmaintained)
- Playwright MCP (34k★, Apache-2.0, AX-snapshot-only, no vision/self-heal)
- Browserbase (managed cloud, freemium $0.12/hr, stealth+captcha+proxies)
- Steel.dev (self-host Apache-2.0, CAPTCHA $3-4/1k ~70%, proxy $5-10/GB)
- browserless (veteran, commercial self-host license caveat), Nanobrowser (Chrome extension, free, can't run headless/at scale)

**Revolutionary techniques (with prior art):**
- Agent JIT Compilation (reported ICML 2026, Stanford + Google) — 10.4× / +28% over Browser-Use; 45-50% of errors are wrong sequences; pre/post invariant validation cuts failure 59%→25%
- Freu AI — record-once/replay-many, ~90% token reduction
- HyperAgent — "Action Caching — record and replay without LLM calls"
- rrweb — tool-call trace + DOM state recording for replay + divergence detection
- PASTE (arXiv 2026, MSR + SJTU + HKUST) — speculative tool execution, 43.5% / 55.4% p99 latency reduction
- Agentium — procedural memory for browser agents (extract → store → inject as suggested plan)
- Healenium — ML attribute-similarity self-heal for Selenium locators
- Resilient-Locator-Extractor — resilience hierarchy (data-testid > aria > role > text > path)
- Lightpanda — headless browser built for AI, caches DOM between queries
- tiny VLMs — Qwen3.5-0.8B (~1GB), Moondream, SmolVLM — localhost OpenAI-compatible vision endpoints

**Existing Cairn strengths (from code reading):**
- `src/intent/grounding.ts` — deterministic scoring (token overlap + Levenshtein + typeability penalty) + embeddings fallback (`groundIntentWithFallback`)
- `src/intent/execute.ts` — perceive→ground→act→verify loop + click-to-reveal multi-step fallback
- `src/model/page-model.ts` — spatial-semantic model with inferred interactivity
- `src/model/delta.ts` — MutationObserver + diff-by-ref
- `src/vision/screenshot.ts` — Set-of-Mark numbered screenshots with same refs
- `src/session/session.ts` — backend-agnostic session with Steel/local auto-fallback
- `src/errors.ts` — 9-code agent-actionable error taxonomy
- `src/cli.ts` — 19 commands, `--visual`/`-i`/`--include-hidden`/`--steel`/`--proxy` flags
