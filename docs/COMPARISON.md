# Comparison: agent-browser vs Cairn

> **See [BENCHMARK.md](BENCHMARK.md) for the full automated, objective comparison** — a 6-task suite run via `scripts/benchmark.sh` with per-command metrics (stdout bytes, stderr bytes, wall-clock ms, exit code) captured for both tools. Results: Cairn 100% task success rate (6/6) vs agent-browser 67% (4/6), 18% fewer commands, 33% less total output. The comparison below is a preliminary manual analysis on a single task (Wikipedia search), retained for historical context.

Head-to-head comparison on the same task: **search Wikipedia for "artificial intelligence"** (navigate to https://www.wikipedia.org, find the search box, type into it, observe results).

Both tools were run via bash CLI. Metrics captured on 2025-08-05.

---

## Task Flow Comparison

### agent-browser (v0.33.0)

| Step | Command | Output |
|------|---------|--------|
| 1 | `agent-browser open https://www.wikipedia.org` | `✓ Wikipedia` + URL (2 lines) |
| 2 | `agent-browser snapshot -i` | 4699 bytes (~1175 tokens) — full interactive AX tree |
| 3 | `agent-browser fill @e34 "artificial intelligence"` | `✓ Done` (1 line, no detail) |
| 4 | `agent-browser snapshot -i` | 4699 bytes again — must re-snapshot to see changes |

**Total: 4 commands, ~9400 bytes output (~2350 tokens)**

The agent must re-snapshot after every action to see what changed. Refs are fresh on every snapshot — `@e34` from step 2 is stale by step 4.

### Cairn (our tool, MVP)

| Step | Command | Output |
|------|---------|--------|
| 1 | `cairn goto https://www.wikipedia.org` | 13696 bytes — full hierarchical tree with regions + refs (self-describing) |
| 2 | `cairn type e64 "artificial intelligence"` | `✓ typed "artificial intelligence" into [e64] input` + delta output |

**Total: 2 commands, ~14K bytes output (~3500 tokens)** for the full task.

`goto` shows the page tree immediately (no separate "look" needed). `type` returns a compact delta showing only what changed.

---

## Metric-by-Metric Comparison

### 1. Commands per task
- **agent-browser**: 4 (open, snapshot, fill, re-snapshot)
- **Cairn**: 2 (goto, type)
- **Winner: Cairn** — 50% fewer commands. `goto` is self-describing (shows the tree), and `type` shows the delta (no re-snapshot needed).

### 2. Token efficiency (page representation)
- **agent-browser `snapshot -i`**: 4699 bytes (~1175 tokens) — interactive elements only, flat AX tree, no region structure
- **Cairn `look` (full)**: 13637 bytes (~3400 tokens) — ALL nodes with regions, inferred interactivity markers
- **Cairn `focus main` + `look` (zoomed)**: ~4K bytes (~1000 tokens) — only the focused region subtree
- **Winner: agent-browser** for raw compactness on the interactive-only view. But **Cairn** wins on large pages where `focus` zooming cuts the view to just the relevant region.

### 3. Delta output (after an action)
- **agent-browser**: No delta support. Must re-snapshot the entire page (~4699 bytes) to see what changed. The agent doesn't know if the fill worked without re-snapshotting.
- **Cairn**: Compact delta output — shows only added/removed/changed nodes with `+`/`-`/`~` notation. Typing into a field = ~1-2 lines. Clicking a link = navigation delta (URL change + changed/added nodes).
- **Winner: Cairn** — massive token savings on iterative tasks. Each action shows only what changed, not the full page.

### 4. Navigation ease (finding elements)
- **agent-browser**: Refs (`@e34`) are from the AX tree. Flat list — no region structure. Must scan the full snapshot to find the search box among ~100 elements. Refs are STALE after any page change (must re-snapshot).
- **Cairn**: Refs (`[e64]`) are stamped as `data-cairn-ref` attributes. Hierarchical tree with region clustering (▼ Header / ▼ Main / ▼ Footer). Agent can `focus main` to zoom into just the relevant region. Refs are stable within the same page (stamped attributes don't change unless the page changes).
- **Winner: Cairn** for navigation efficiency (region zooming + hierarchical structure). **Tie** on ref stability — both require re-snapshotting after navigation, but our refs survive within-page mutations better (stamped attributes vs ephemeral AX tree refs).

### 5. Interactivity detection
- **agent-browser**: Uses the Chrome AX tree. Detects standard interactive elements (button, link, textbox). Does NOT detect div-as-button (no role, no aria) — these are invisible in the snapshot.
- **Cairn**: Fuses AX tree + computed style + inline handlers + tabindex + contenteditable. DETECTS div-as-button via `cursor:pointer + onclick` even without any ARIA role. Distinguishes `clickable` (native/aria) vs `inferred clickable` (heuristic).
- **Winner: Cairn** — catches non-standard interactive elements that attribute-only approaches miss. This is the core differentiator from DESIGN.md.

### 6. Action feedback
- **agent-browser**: `✓ Done` — minimal, no detail about what happened or what's now possible.
- **Cairn**: `✓ typed "artificial intelligence" into [e64] input` + delta showing what changed. Self-describing — the agent knows what happened and what to do next.
- **Winner: Cairn** — self-describing output reduces the need for follow-up "look" commands.

### 7. Feature maturity
- **agent-browser**: Production-grade. Has screenshots, `--annotate` vision overlays, `find` semantic locators, tab management, network mocking, video recording, MCP integration, session restore, React introspection, accessibility audits, plugin system.
- **Cairn**: MVP. Has goto, look, focus, click, type, status, delta. No vision, no screenshots, no semantic locators, no tabs, no network mocking, no MCP, no plugins.
- **Winner: agent-browser** — far more feature-complete. Our tool is an MVP validating the core approach.

---

## Summary

| Metric | agent-browser | Cairn |
|--------|--------------|-------------------|
| Commands per task | 4 | 2 |
| Page rep tokens (interactive-only) | ~1175 | ~3400 (full) / ~1000 (zoomed) |
| Delta output | ❌ (must re-snapshot) | ✅ (compact +/-/~ notation) |
| Region clustering | ❌ | ✅ (focus/zoom) |
| Inferred interactivity | ❌ (AX tree only) | ✅ (cursor:pointer + onclick) |
| Self-describing actions | ❌ ("✓ Done") | ✅ ("typed X into [e64]") |
| Feature maturity | Production (v0.33.0) | MVP (v0.1.0) |

### The core insight
agent-browser is more mature and has a more token-efficient interactive-only snapshot. But our tool's key differentiators — **delta output** (don't re-snapshot after every action), **region focus** (zoom into relevant subtrees), **inferred interactivity** (catch div-as-button), and **self-describing actions** (know what happened without re-looking) — directly address the pain points the user identified: agents getting confused and taking too many steps to navigate.

On iterative tasks (click → observe → click → observe), our delta output saves ~50% of tokens per step vs re-snapshotting. On large pages, region focus saves tokens by zooming into the relevant area. On non-standard UIs (div-as-button), inferred interactivity catches elements that AX-tree-only tools miss entirely.

### Where agent-browser still wins
1. **Raw snapshot compactness**: `snapshot -i` at 4699 bytes is hard to beat for the interactive-only view. Our full tree is 3x larger.
2. **Feature breadth**: screenshots, MCP, network mocking, tabs, plugins, semantic locators — all things we haven't built yet.
3. **Production readiness**: battle-tested, npm published, plugin ecosystem.

### Phase 3 Re-Test: NL `goto` intent (2025-08-05)

After building Phase 3 (the NL `goto "<nl goal>"` intent), we re-ran the same task to measure the improvement. The `goto` command now accepts either a URL or a natural-language intent — the tool runs perceive→ground→act→verify internally using deterministic logic (no in-tool LLM call).

**Task:** Fill the email field on a login form (same structural task as the Wikipedia search — find an input, type into it).

#### MVP approach (ref-based, Phase 1)

| Step | Command | Output |
|------|---------|--------|
| 1 | `cairn goto <url>` | 987 bytes — full hierarchical tree with regions + refs |
| 2 | `cairn type e11 "hello"` | 53 bytes — `✓ typed "hello" into [e11] input` |

**Total: 2 commands, 1040 bytes.** The agent must parse the step-1 tree, identify that `[e11]` is the email textbox, then issue `type e11`.

#### Phase 3 approach (NL intent)

| Step | Command | Output |
|------|---------|--------|
| 1 | `cairn goto <url>` | 987 bytes — same self-describing tree |
| 2 | `cairn goto "type hello into the email field"` | 83 bytes — `✓ typed "hello" into [e11] input` + delta `(no visible changes detected)` |

**Total: 2 commands, 1070 bytes.** The agent states intent in English — no need to parse the tree or find the ref. The tool grounds "email field" → `[e11]` internally via fuzzy token overlap + role-hint + typeability scoring.

#### What Phase 3 changes

| Metric | MVP (ref-based) | Phase 3 (NL intent) |
|--------|----------------|---------------------|
| Commands per task | 2 | 2 (same) |
| Output bytes | 1040 | 1070 (+3%, includes delta) |
| Agent must parse page tree? | ✅ Yes (find e11) | ❌ No (tool grounds automatically) |
| Agent must know ref system? | ✅ Yes | ❌ No (states intent in English) |
| Built-in delta verification? | ❌ No (type doesn't compute delta) | ✅ Yes (goto intent includes delta) |
| Ambiguity handling? | ❌ Wrong ref = failure | ✅ Reports candidates + suggests `look --visual` |
| Not-found handling? | ❌ Cryptic Playwright error | ✅ "not found, closest: ..." with suggestions |

**The core Phase 3 win is cognitive load, not command count.** Both approaches take 2 commands, but Phase 3 eliminates the agent's need to understand the page structure and map natural intent to a ref. The agent says "type hello into the email field" and the tool handles grounding. This is the "collapse the loop" principle from DESIGN.md §3.5 — the tool runs perceive→ground→act→verify internally, so the agent doesn't have to orchestrate those steps.

#### Grounding quality findings

Dogfooding on real pages revealed two important edge cases:

1. **Typeability scoring (fixed):** On Wikipedia's main page, the grounder initially matched "search" to a `<span>Search</span>` label (high token overlap) instead of looking for an actual `<input>`. Fix: for type intents, strongly prefer typeable roles (textbox/searchbox/combobox/textarea/contenteditable, +0.20 bonus) and heavily penalize non-typeable matches (-0.55). Now correctly returns "not found" when no real input field exists.

2. **Shadow-DOM / dialog-based search (fixed):** Wikipedia and DuckDuckGo both hide their search inputs behind links (open a dialog) or shadow DOM (closed custom elements). The structured model can't see inside these, so the NL type intent correctly returns "not found". **Fix:** the executor now runs a click-to-reveal fallback — when a type intent returns notFound, it re-grounds the target as a click intent, clicks the matching "Search" link/button to open the dialog, re-builds the model, and re-grounds the type intent. If the dialog re-renders DOM (invalidating `data-cairn-ref` attributes, as Wikipedia does), a direct-locator fallback finds the first visible input and fills it. Verified end-to-end on en.wikipedia.org article pages: `goto "type artificial intelligence into the search field"` → auto-clicks Search link → opens dialog → types into the search input. ✓

#### Intent types verified

All three intent kinds work end-to-end on the test login form:

| Intent | Example | Result |
|--------|---------|--------|
| Type | `goto "type hello into the email field"` | ✓ typed into [e11] |
| Type | `goto "type secret123 into the password field"` | ✓ typed into [e14] |
| Click | `goto "click the sign in button"` | ✓ clicked [e15] |
| Navigate | `goto "go to settings"` | ✓ clicked [e5], detected URL change |
| Not-found | `goto "click the submit button"` | ✗ not found, closest: [e15] [e16] |

### Updated next steps for Cairn

1. ~~Add screenshot support (Phase 2 vision fallback)~~ ✅ **Done** — `look --visual` captures marked screenshots with numbered boxes over interactive elements
2. ~~Add NL `goto` intent (Phase 3)~~ ✅ **Done** — deterministic perceive→ground→act→verify in one command
3. ~~Add an `--interactive-only` flag to `look` (match agent-browser's `-i` compactness)~~ ✅ **Done** — `cairn look -i` / `cairn look --interactive-only` shows a compact flat list of interactive elements grouped by region. Tested on wikipedia.org: 5525 bytes vs 13637 bytes full tree (2.5x more compact, approaching agent-browser's 4699-byte `-i`).
4. ~~Multi-step intent composition: "type X into the search field" → auto-click search link → re-ground in dialog~~ ✅ **Done** — click-to-reveal fallback in execute.ts. When a type intent returns notFound, re-grounds as click intent, clicks matching link/button, waits for dialog, re-grounds + types. Direct-locator fallback handles DOM re-renders. Verified on en.wikipedia.org article pages.
5. Add semantic locators (`find role button --name "Submit"`) as a complement to refs
6. Package as a skill (like agent-browser ships)
7. Add MCP integration
8. Optional: local embedding model (Xenova/all-MiniLM-L6-v2 via @huggingface/transformers) as a lazy fallback for synonym matching when deterministic grounding returns not-found/ambiguous
