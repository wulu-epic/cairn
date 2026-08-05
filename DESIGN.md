# Design: An Agent-First Browser Testing Tool

> Planning document. No code yet — this captures the research synthesis, the proposed approach, and the recommended tech stack for review and iteration.

---

## 1. The Problem

Current agentic browser tools (Playwright-driven agents, agent-browser skills, browser-use, Stagehand, etc.) make life hard for the **agent itself**, not just the developer. Three concrete pain points, all backed by the research:

**Slow comprehension.** The agent receives either a giant raw DOM (100k+ tokens), a lossy accessibility tree (blind to layout/canvas/shadow-DOM), or a screenshot (grounding unreliable). It takes several round-trips just to figure out "what's on this page and what can I do."

**Brittle grounding.** Tools that rely on HTML attributes (CSS selectors, ARIA roles, `data-testid`) break when the page changes or when authors didn't add the right attributes — a `<div>` acting as a button with no `role` is invisible to an attribute-only approach. You called this out directly: navigation shouldn't depend *just* on attributes on HTML. Meanwhile, pure-vision tools suffer **"location hallucination"** — they correctly reason about the target but output fabricated coordinates (GUI-Perturbed study). Accuracy collapses under ordinary visual perturbation.

**Too many steps to act.** Existing primitives (`observe → decide → act → verify`) force the agent into a multi-call loop per action. At ~2-5s and ~$0.02-0.30 per LLM step, a 15-action task becomes 45-60 steps and real money. And because this will ship as a **skill** (a CLI the agent drives via bash), every round-trip is expensive — each command is ~60s away.

**The research consensus:** *grounding — not perception — is the bottleneck.* SeeAct (ICML 2024) showed that with **oracle** grounding, GPT-4V completes 51.1% of tasks vs 13.3% for text/DOM agents. Vision perceives better, but only if the chosen element can be reliably mapped to an executable target. The field ships **hybrid** (vision + DOM/AX) in production because each channel disambiguates the other — but that doubles cost and failure surfaces.

---

## 2. The Key Insight

The bottleneck isn't only *perception* — it's the **interface** the agent is given. Most tools expose low-level primitives and make the agent do the orchestration. For a skill-packaged tool driven via bash, that's the wrong abstraction: the agent pays a round-trip for every observe/act/verify and must hold a mental model of session state across calls.

So this tool's differentiator is **not** "a better DOM parser" or "a better VLM." It's an **agent-optimized interaction surface** built on top of a **spatial-semantic page model** that fuses the best of every channel and is presented in a form an LLM navigates effortlessly.

---

## 3. Design Principles

1. **Agent-first, not developer-first.** Optimize for LLM comprehension and step-efficiency, not for a human writing test scripts. Every output is self-describing; every action returns "what changed + what's now possible."
2. **Act by stable ID, never by coordinate.** The agent never outputs pixel coordinates. It picks a numbered ref; the tool deterministically resolves ref → element → action. This **eliminates location hallucination entirely.**
3. **Infer interactivity — don't trust attributes.** Don't rely on the DOM's declared attributes (which "lie" on custom widgets). Compute the interaction model from a fusion of: AX tree + computed style (cursor, click handlers, tabindex) + layout geometry + visual appearance. A div-as-button with no ARIA still gets a correct, clickable ref.
4. **Navigate hierarchically, like a filesystem.** The page is a tree of regions. The agent gets a compact overview, then "zooms" into the relevant region — paying tokens only for the subtree it's acting in. No 50KB dump every step.
5. **Collapse the loop.** High-level intent commands ("go to the login button and click it") handle perception + grounding + action + verify internally using cheap deterministic logic, returning a compact result. One bash command per unit of progress, not five.
6. **Deltas, not snapshots.** After an action, send only what changed (MutationObserver/IntersectionObserver quiet → re-snapshot filtered elements → diff by stable ref → emit delta).
7. **Persistent session.** The CLI keeps the browser alive across commands; state (current URL, focused region, element index) persists. The agent doesn't re-establish context each call.
8. **Vision as fallback, not primary.** Use the structured model by default (fast, cheap, precise); pull in a marked screenshot only when the structured model is ambiguous, or for canvas/WebGL/shadow-DOM where there are no nodes.

---

## 4. The Proposed Approach

### 4.1 The spatial-semantic page model

On each step, the tool builds a unified model by fusing three CDP sources (the browser-use "three trees to one" pattern, proven to take 10k+ nodes → ~200 interactive elements, ~5-10KB):

- **DOM** (structure, text, attributes)
- **Accessibility tree** (`Accessibility.getFullAXTree` — semantic roles/labels, **3-5x more token-efficient** than injected-JS DOM dumps)
- **Layout geometry** (`DOM.getBoxModel` — bounding boxes for spatial grounding)

Fused into an enhanced node carrying: stable `ref`, role, accessible name, bounding box, and — crucially — an **inferred interactivity flag** computed from computed style + event listeners + geometry, not just declared ARIA. *This is what makes it work on pages that "lie."*

The model is then **spatially clustered into a region tree** (nav / main / sidebar / footer / modal), so the agent can navigate it like a filesystem.

### 4.2 The agent-facing representation

The agent sees a **compact, hierarchical, bash-like** view:

```
page: example.com/login  (region: main)
├── form "Sign in"                    [ref=e12]
│   ├── textbox "Email"               [ref=e13]
│   ├── textbox "Password"            [ref=e14]
│   ├── button "Sign in"             [ref=e15]  (primary)
│   └── link "Forgot password?"      [ref=e16]
└── link "Create account"            [ref=e17]
```

- Compact, role-based, with stable refs (Playwright `ariaSnapshot({mode:'ai'})` format as the base).
- The agent "focuses" a region to see only that subtree (token-efficient).
- A marked screenshot (numbered boxes over the *same* refs) is available on demand for visual disambiguation — but the agent acts via `[ref=e15]`, never coordinates.

### 4.3 Grounding: deterministic, hallucination-proof

When the agent says `click [ref=e15]`, the tool resolves e15 → its bounding box (from the **live** model, not a stale screenshot) → dispatches the CDP input event. No coordinate reasoning by the LLM = no location hallucination. The ref is stable across re-renders (it's a semantic identity, not a CSS selector), so it survives visual restyling.

### 4.4 Hybrid vision, on demand

The structured model is blind to canvas/WebGL and closed shadow roots. So the tool falls back to a marked screenshot **only** when:
- The structured model finds no interactive node where the agent expects one, or
- The target is canvas/WebGL-rich, or
- The agent explicitly requests a visual look (`ab look`).

This keeps vision as a cheap fallback rather than the primary, expensive loop.

### 4.5 High-level intent commands (the skill surface)

Instead of observe/act/extract primitives, the CLI exposes intents:

| Command | What it does | Why |
|---|---|---|
| `ab focus <region\|ref>` | Zoom into a region/subtree (compact output) | Token-efficient navigation |
| `ab click <ref>` | Deterministic click by ref | No coordinate reasoning |
| `ab type <ref> <text>` | Fill a field | |
| `ab goto "<nl goal>"` | Tool perceives+grounds+acts+verifies internally, returns compact result | **Collapses 4-5 steps into 1** |
| `ab extract <schema>` | Structured data extraction | |
| `ab look` | Marked screenshot + current region tree (the "I'm confused, show me" command) | Vision fallback |
| `ab status` | Session state (URL, focused region, last delta) | Re-orient without a full snapshot |

The `goto` command is the key step-efficiency win: the agent states intent in English, the tool runs the perceive/ground/act/verify loop internally (using deterministic logic + at most one cheap vision call), and returns `"done: clicked Sign in, now on /dashboard"` or `"ambiguous: two 'Sign in' buttons, which?"`. This is what makes it feel **easy to navigate.**

### 4.6 Delta-based state

After every action: inject MutationObserver + IntersectionObserver via `Runtime.evaluate`; wait for mutation-quiet (page settled); re-snapshot the filtered element list; diff against previous by stable ref; emit only the delta to the agent. An action that changes one field costs ~one line of output, not a full page dump.

---

## 5. Tech Stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| Control | **Playwright (TS)** + `connectOverCDP('ws://...')` | Auto-wait, locators, tracing, cross-browser, mature; drop to raw CDP only for extraction (`getFullAXTree`, `getBoxModel`, `Runtime.evaluate`) |
| Language | **TypeScript/Node** | Agent loop is LLM-latency-bound (2-5s/step) so language speed is irrelevant; TS aligns with Playwright/Stagehand/Playwright-MCP ecosystem |
| Page rep | **`ariaSnapshot({mode:'ai'})`** as base, enhanced with inferred interactivity + geometry | Canonical token-efficient AI rep; 3-5x fewer tokens than JS DOM dumps |
| Change detection | **MutationObserver + IntersectionObserver** → diff by ref → delta | browser-use's proven reactive pattern |
| Browser infra | **Self-hosted Steel Browser** (Apache-2.0, free) to start; **Browserbase** at scale | Steel Browser (`steel-dev/steel-browser`, 7.4k★, TypeScript) is fully open-source Apache-2.0 — self-hosting is free forever; only the managed cloud is paid. Gives session mgmt + anti-detect + token optimization. Managed (Browserbase) removes DevOps when it hurts |
| Perf-critical (optional) | **Rust** only for a CDP-orchestrator/chrome-farm microservice | 5-10x footprint reduction; only if profiling proves the orchestrator is the bottleneck (it won't be — LLM latency dominates) |

**One-line stack:** TypeScript + Playwright (connectOverCDP) + `ariaSnapshot({mode:'ai'})` + inferred-interactivity enhancement + MutationObserver/IntersectionObserver delta-diffing + self-hosted Steel Browser chrome farm (Apache-2.0, free), Rust reserved for an optional CDP-orchestrator microservice.

**Browser-infra alternatives (all free to self-host):** Steel Browser is the default — TypeScript-native, agent-oriented CDP API, Docker. If avoiding Steel: **Browserless** (13.6k★, OSS Docker image, Playwright/Puppeteer via `ws://`, but license is "free for non-commercial use" — caveat for a shippable product; BrowserQL/persistent-sessions are cloud-only); **Selenium Grid** (Apache-2.0, free, multi-language, but heavier and less AI-agent-oriented); **DIY Playwright + `chromium.launch()` in your own Docker pool** (fully free, you own the orchestration — what we do locally now). Per established finding: the agent loop is LLM-latency-bound, so the chrome farm is a *scale* concern, not a correctness one — local `chromium.launch()` is fine for MVP/dev.

**Why not Python** (browser-use's stack)? Equally valid if you're Python-first, but TS keeps the whole stack (control + extraction + MCP) in one language and aligns with where the ecosystem (Playwright, Stagehand, Playwright-MCP) is investing. **Why not Rust for everything?** The agent loop is latency-bound on the LLM, so Rust's speed is wasted there; its value is footprint/throughput in the orchestrator layer only.

---

## 6. How this maps to a skill

Like agent-browser, this ships as: a **CLI binary + a skill that injects usage instructions**. The agent drives it via bash. The design choices above are tuned for exactly that model:

- **Few round-trips:** high-level `goto`/`extract` intents collapse multi-step loops.
- **Self-describing output:** every command returns "what happened + what's possible next," so the agent rarely needs a separate observe step.
- **Persistent session:** the CLI holds the browser; commands share state via a session ID/file.
- **LLM-optimized output:** hierarchical, compact, ref-based — easy to parse and reason about.

---

## 7. Roadmap (phased)

1. **MVP — structured model + ref-based actions.** Playwright+CDP, `ariaSnapshot` base + inferred interactivity, `focus`/`click`/`type`/`look`/`status` commands, persistent session, delta output. Self-hosted chrome-headless-shell in Docker. No vision yet. ✅ done.
2. **Vision fallback.** Marked screenshot on demand; canvas/WebGL/shadow-DOM detection → vision path. ✅ done.
3. **High-level `goto` intent.** Internal perceive→ground→act→verify loop with one cheap vision call max.
4. **Steel Browser integration + anti-detect.** Self-hosted chrome farm (Apache-2.0, free — `steel-dev/steel-browser`), session mgmt, proxy rotation.
5. **Skill packaging.** CLI + injected instructions; polish the agent-facing surface.
6. **Scale path.** Browserbase for managed; optional Rust CDP-orchestrator if profiling demands.

---

## 8. Open decisions (want your input)

- **Python vs TS?** I lean TS for ecosystem alignment, but if you'd rather build on browser-use's Python foundations, that's defensible too.
- **Start from an existing project or greenfield?** Forking browser-use / Stagehand gets you ~80% but inherits their abstractions; greenfield is cleaner for the agent-optimized surface but more work.
- **`goto` autonomous depth** — how much should the tool decide vs. the agent? More autonomy = fewer round-trips but less agent control/visibility.
- **Vision model choice** for the fallback path — depends on what you'll have access to (Claude vision, GPT-4o, Gemini, on-device Gemini Nano for cheap classification).

---

## Appendix: Research basis (key findings)

- **Grounding is the bottleneck, not perception.** SeeAct (ICML 2024): oracle grounding → GPT-4V 51.1% vs GPT-4 text/a11y 13.3%. OmniParser+GPT-4V beats GPT-4V+HTML on Mind2Web. UGround/SeeAct-V (ICLR 2025) = first vision-only agent at practical SOTA. (subagent bg2)
- **Hybrid wins production.** browser-use, Stagehand, Computer Use, Operator, WebVoyager all effectively hybrid under the hood; each channel fails differently and disambiguates the other. Cost: doubled observation pipelines + failure surfaces. (bg1, bg2)
- **Common failure modes across the field:** (a) location hallucination (vision agents fabricate coords), (b) captchas / popups / direct-URL navigation (BrowserArena), (c) anti-bot + DOM drift keep agents "nowhere near fire-and-forget" (MultiOn experience generalizes), (d) agents prefer costly visual validation over structural checks. (bg1)
- **Token-efficient page rep exists:** Playwright `ariaSnapshot({mode:'ai'})` (compact role tree with `[ref=eN]`); CDP `getFullAXTree` is 3-5x cheaper than JS DOM dumps; browser-use's DOM Processing Engine fuses DOM+AX+layout → ~200 interactive elements / 5-10KB. (bg3)
- **Agent loop is LLM-latency-bound** (2-5s/step), so the implementation language's speed is irrelevant — what matters is ecosystem. Rust only earns its place in a chrome-farm/CDP-pool orchestrator microservice. (bg3)
