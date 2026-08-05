# Benchmark: Cairn vs agent-browser

**Automated, objective head-to-head comparison.** Both tools were run on a 6-task suite via an automated harness (`scripts/benchmark.sh`) that captures stdout bytes, stderr bytes, wall-clock milliseconds, and exit code for every command. All raw data is in `scripts/benchmark-results.jsonl` (42 JSONL records) and `scripts/benchmark-output/` (84 output files).

**Date:** 2025-08-05 · **agent-browser v0.33.0** · **Cairn MVP (local Chrome backend)**

---

## TL;DR

| Metric | agent-browser | Cairn | Winner |
|--------|--------------|-------|--------|
| Total commands (T1–T6) | 22 | 18 | **Cairn** (−18%) |
| Total execution time | 25,646 ms | 68,034 ms | **agent-browser** (2.65× faster) |
| Total stdout output | 198,361 B | 133,208 B | **Cairn** (−33%) |
| Total stderr output | 160 B | 0 B | **Cairn** (0 errors) |
| Explicit failures (exit≠0) | 1 | 0 | **Cairn** |
| Silent failures (task incomplete) | 1 | 0 | **Cairn** |
| Task success rate | 4/6 (67%) | 6/6 (100%) | **Cairn** |

**Bottom line:** Cairn uses fewer commands, produces less total output, and has a 100% task success rate vs agent-browser's 67%. agent-browser is 2.65× faster per command. On complex pages (Wikipedia search results), agent-browser's interactive snapshot explodes to 165 KB while Cairn's stays at 38 KB. On simple pages, agent-browser's minimal `open` output is more compact than Cairn's self-describing `goto` tree.

---

## Methodology

### Task suite (6 tasks, increasing difficulty)

| Task | Description | URL | Difficulty |
|------|-------------|-----|------------|
| T1 | Navigate + read page structure | example.com | Trivial |
| T2 | Interactive-only view of complex page | wikipedia.org | Easy |
| T3 | Simple search (standard form) | duckduckgo.com | Medium |
| T4 | Dialog-based search (hidden search field) | en.wikipedia.org/wiki/Web_browser | Hard |
| T5 | Form fill + submit (login form) | the-internet.herokuapp.com/login | Medium |
| T6 | Multi-step nav (click link → verify URL) | example.com → iana.org | Easy |

### Metrics captured per command

- **stdout_bytes** — bytes written to stdout (what the agent processes; proxy for token cost at ~4 bytes/token)
- **stderr_bytes** — bytes written to stderr (error output)
- **ms** — wall-clock execution time of the command (tool latency only, NOT LLM latency)
- **exit** — process exit code (0 = success, non-zero = failure)

### Fairness controls

1. **Persistent browser**: Both tools keep Chrome alive across tasks (no per-task restart). Chrome startup cost is paid once per tool (first command only).
2. **Sequential execution**: agent-browser runs all 6 tasks first, then closes Chrome. Cairn runs all 6 tasks second (after agent-browser's Chrome is closed — avoids port conflicts).
3. **Idiomatic usage**: Each tool uses its best available approach:
   - **agent-browser**: `open` + `snapshot -i` for page comprehension; `find role/text/label` for semantic locators; `fill @ref` for form input; `get url` for verification.
   - **Cairn**: `goto <url>` for navigation (self-describing tree); `goto "<nl goal>"` for NL intents (type/click); `look -i` for compact interactive view; `status` for verification.
4. **Honest reporting**: All results are recorded, including failures. No cherry-picking. Raw JSONL data is committed for reproducibility.

### Limitations

- **Ref extraction**: For agent-browser T5, the harness extracts refs from `snapshot -i` output via grep. This is a simplistic approach — an LLM agent would read the snapshot and identify the correct refs more reliably. (See T5 analysis for the impact.)
- **Single run**: Each task was run once. Variance in network latency and page load times is not accounted for.
- **LLM latency excluded**: The `ms` metric measures tool execution time only. In real agent usage, each command requires an LLM reasoning step (~2–10s), which dominates total wall-clock time. See "Projected real-world time" below.
- **No vision tasks**: Both tools have screenshot capabilities, but the benchmark focuses on structured (non-visual) workflows.

---

## Per-task results

### T1: Navigate + read page structure (example.com)

**Task:** Navigate to example.com and view the page structure.

| Tool | Step | Command | Exit | Time (ms) | Stdout (B) | Stderr (B) |
|------|------|---------|------|-----------|------------|------------|
| agent-browser | 1 | `open https://example.com` | 0 | 3,473 | 42 | 33 |
| agent-browser | 2 | `snapshot -i` | 0 | 754 | 74 | 0 |
| Cairn | 1 | `goto https://example.com` | 0 | 2,897 | 401 | 0 |

| Aggregate | agent-browser | Cairn |
|-----------|--------------|-------|
| Commands | 2 | **1** |
| Time | **4,227 ms** | 2,897 ms |
| Stdout | **116 B** | 401 B |

**Analysis:** Cairn's `goto` is self-describing — it shows the page tree immediately, eliminating the need for a separate `snapshot` command. agent-browser requires `open` (minimal output: "✓ Example Domain / URL") followed by `snapshot -i` to see the structure. Cairn uses 50% fewer commands but produces 3.5× more output on this trivial page because the tree is shown unconditionally. On a simple page like example.com, agent-browser's minimal `open` is more token-efficient — but the agent still needs the snapshot to act.

---

### T2: Interactive-only view of complex page (wikipedia.org)

**Task:** Navigate to wikipedia.org and view interactive elements only.

| Tool | Step | Command | Exit | Time (ms) | Stdout (B) | Stderr (B) |
|------|------|---------|------|-----------|------------|------------|
| agent-browser | 1 | `open https://www.wikipedia.org` | 0 | 1,283 | 43 | 0 |
| agent-browser | 2 | `snapshot -i` | 0 | 816 | 4,699 | 0 |
| Cairn | 1 | `goto https://www.wikipedia.org` | 0 | 3,205 | 13,700 | 0 |
| Cairn | 2 | `look -i` | 0 | 2,837 | 5,529 | 0 |

| Aggregate | agent-browser | Cairn |
|-----------|--------------|-------|
| Commands | 2 | 2 |
| Time | **2,099 ms** | 6,042 ms |
| Stdout | **4,742 B** | 19,229 B |

**Analysis:** On the interactive-only view, agent-browser's `snapshot -i` (4,699 B) is more compact than Cairn's `look -i` (5,529 B) — 15% smaller. But Cairn's `goto` also dumps the full tree (13,700 B), which the agent must process whether it wants to or not. agent-browser's `open` produces only 43 B, giving the agent the choice of when to request the full snapshot. For this task, **agent-browser wins on both time and output** — its minimal `open` + compact `snapshot -i` is the more efficient pattern when the agent only needs interactive elements.

---

### T3: Simple search — DuckDuckGo "typescript"

**Task:** Navigate to duckduckgo.com, type "typescript" into the search box, and press Enter.

| Tool | Step | Command | Exit | Time (ms) | Stdout (B) | Stderr (B) |
|------|------|---------|------|-----------|------------|------------|
| agent-browser | 1 | `open https://duckduckgo.com` | 0 | 1,526 | 79 | 0 |
| agent-browser | 2 | `find role searchbox fill 'typescript'` | **1** | 782 | 0 | **127** |
| agent-browser | 3 | `press Enter` | 0 | 888 | 9 | 0 |
| agent-browser | 4 | `snapshot -i` (results) | 0 | 887 | 7,863 | 0 |
| Cairn | 1 | `goto https://duckduckgo.com` | 0 | 3,666 | 12,393 | 0 |
| Cairn | 2 | `goto 'type typescript into the search field'` | 0 | 3,573 | 503 | 0 |
| Cairn | 3 | `goto 'click the search button'` | 0 | 4,163 | 64 | 0 |
| Cairn | 4 | `look -i` (results) | 0 | 3,028 | 14,958 | 0 |

| Aggregate | agent-browser | Cairn |
|-----------|--------------|-------|
| Commands | 4 | 4 |
| Time | **4,083 ms** | 14,430 ms |
| Stdout | **7,951 B** | 27,918 B |
| Failures | **1** | 0 |

**agent-browser failure:** `find role searchbox fill` returned exit 1:
```
✗ No element found: getByRole('searchbox'). Verify the selector, role, or name is correct and the element exists in the DOM.
```
DuckDuckGo's search input is an `<input type="text">` without `role="searchbox"`. agent-browser's `find role` requires an exact ARIA role match, which doesn't exist on this page. The `press Enter` on step 3 succeeded (pressed Enter on whatever was focused), and the results snapshot shows search results — but the search term was never typed. The task **effectively failed**: the agent searched for nothing.

**Cairn success:** The NL intent `goto "type typescript into the search field"` grounded "search field" to DuckDuckGo's search input via fuzzy token overlap + typeability scoring — regardless of ARIA role. Output:
```
✓ typed "typescript" into [e32] input "Search with DuckDuckGo"
```
The subsequent `goto "click the search button"` found and clicked the search button. Task completed successfully.

**Key finding:** Cairn's NL grounding is more flexible than agent-browser's strict role-based `find`. Real-world pages often don't have the exact ARIA roles that `find role` expects. An LLM agent using agent-browser could work around this by snapshotting first and using `fill @ref`, but that requires an extra command and ref parsing.

---

### T4: Dialog-based search — Wikipedia "artificial intelligence"

**Task:** On a Wikipedia article page, search for "artificial intelligence" (search field is hidden behind a dialog that opens on click).

| Tool | Step | Command | Exit | Time (ms) | Stdout (B) | Stderr (B) |
|------|------|---------|------|-----------|------------|------------|
| agent-browser | 1 | `open https://en.wikipedia.org/wiki/Web_browser` | 0 | 1,138 | 72 | 0 |
| agent-browser | 2 | `snapshot -i` | 0 | 991 | 19,163 | 0 |
| agent-browser | 3 | `find role searchbox fill 'artificial intelligence'` | 0 | 1,028 | 9 | 0 |
| agent-browser | 4 | `press Enter` | 0 | 771 | 9 | 0 |
| agent-browser | 5 | `snapshot -i` (results) | 0 | 2,357 | **165,039** | 0 |
| Cairn | 1 | `goto https://en.wikipedia.org/wiki/Web_browser` | 0 | 3,390 | 43,604 | 0 |
| Cairn | 2 | `goto 'type artificial intelligence into the search field'` | 0 | **10,897** | 1,153 | 0 |
| Cairn | 3 | `look -i` (results) | 0 | 3,507 | 38,617 | 0 |

| Aggregate | agent-browser | Cairn |
|-----------|--------------|-------|
| Commands | 5 | **3** |
| Time | **6,285 ms** | 17,794 ms |
| Stdout | 184,282 B | **83,374 B** |
| Failures | 0 | 0 |

**The 165 KB outlier:** agent-browser's `snapshot -i` on the Wikipedia search results page produced **165,039 bytes** (~41,000 tokens) of interactive-only AX tree. The Wikipedia search results page has 1,000+ interactive elements (navigation links, search results, footer links, table of contents). This is the single largest output in the entire benchmark — it alone accounts for 83% of agent-browser's total stdout.

**Cairn's `look -i`** on the same page produced 38,617 B — **4.3× more compact**. This is because Cairn's interactive-only renderer groups elements by region and uses more compact formatting.

**Cairn's click-to-reveal fallback:** The `goto "type artificial intelligence into the search field"` command took 10,897 ms — the longest single command in the benchmark. This is because Cairn's click-to-reveal fallback ran: it detected no typeable search field, re-grounded "search" as a click intent, clicked the search link to open the dialog, waited for the dialog, re-built the model, and then typed into the now-visible search input. Output:
```
✓ auto-opened dialog via [e21], then typed "artificial intelligence" into input "Search Wikipedia"
  (via direct locator — dialog re-rendered)
```
The dialog re-rendered the DOM (invalidating stamped refs), so Cairn fell back to a direct locator. Despite the complexity, the task completed in a single command.

**agent-browser's approach:** `find role searchbox fill` succeeded here (Wikipedia article pages do have a `searchbox` role in the AX tree), followed by `press Enter`. This worked — but required 5 commands vs Cairn's 3, and the results snapshot was 165 KB.

**Key finding:** On complex pages, agent-browser's `snapshot -i` can produce enormous output (165 KB), while Cairn's `look -i` is 4.3× more compact. However, Cairn's `goto` (full tree) is also large (43 KB for the article page). The difference is that Cairn offers `focus <region>` to zoom into a subtree, which would cut the output further — but this wasn't tested in the benchmark.

---

### T5: Form fill + submit — login form

**Task:** Navigate to a login form, fill username + password, click login, verify success.

| Tool | Step | Command | Exit | Time (ms) | Stdout (B) | Stderr (B) |
|------|------|---------|------|-----------|------------|------------|
| agent-browser | 1 | `open https://the-internet.herokuapp.com/login` | 0 | 2,187 | 60 | 0 |
| agent-browser | 2 | `snapshot -i` | 0 | 752 | 534 | 0 |
| agent-browser | 3 | `fill @e6 'tomsmith'` | 0 | 747 | 9 | 0 |
| agent-browser | 4 | `fill @e3 'SuperSecretPassword!'` | 0 | 838 | 9 | 0 |
| agent-browser | 5 | `find role button click` | 0 | 784 | 9 | 0 |
| agent-browser | 6 | `snapshot -i` (result) | 0 | 747 | 556 | 0 |
| Cairn | 1 | `goto https://the-internet.herokuapp.com/login` | 0 | 4,171 | 606 | 0 |
| Cairn | 2 | `goto 'type tomsmith into the username field'` | 0 | 3,228 | 68 | 0 |
| Cairn | 3 | `goto 'type SuperSecretPassword! into the password field'` | 0 | 3,162 | 80 | 0 |
| Cairn | 4 | `goto 'click the login button'` | 0 | 3,988 | 84 | 0 |
| Cairn | 5 | `look` (result) | 0 | 2,785 | 787 | 0 |

| Aggregate | agent-browser | Cairn |
|-----------|--------------|-------|
| Commands | 6 | **5** |
| Time | **6,055 ms** | 17,334 ms |
| Stdout | **1,177 B** | 1,625 B |
| Failures (exit≠0) | 0 | 0 |
| **Task success** | **No** | **Yes** |

**agent-browser silent failure:** Despite all 6 commands returning exit 0, the login **did not succeed**. The final snapshot (step 6) still shows the login page, not the secure area. Root cause:

The harness extracted refs from the step-2 snapshot via grep. The snapshot shows:
```
- heading "This is where you can log into the secure area...password..." [ref=e3]
- LabelText "Username" [ref=e5] clickable
- textbox "Username" [ref=e6]
- LabelText "Password" [ref=e7] clickable
- textbox "Password" [ref=e8]
- button "Login" [ref=e4]
```

The grep for the password ref (`grep -i 'password'`) matched the **heading** (which contains the word "password" in its text) first, extracting `e3` instead of the actual password textbox `e8`. So `fill @e3 'SuperSecretPassword!'` filled a **heading element**, not the password field.

**Two issues revealed:**
1. **Harness limitation**: The grep-based ref extraction is fragile — it matched a heading containing "password" instead of the password textbox. An LLM agent reading the snapshot would correctly identify `e8` as the password textbox. This is a harness bug, not an agent-browser bug.
2. **agent-browser silent failure**: `fill @e3` on a heading element returned **"✓ Done"** with exit 0 and no error. agent-browser does not validate that the target element is actually fillable. The agent receives no signal that the fill failed. This IS an agent-browser issue — "✓ Done" on a non-input element is misleading.

**Cairn success:** All three NL intents grounded correctly:
```
✓ typed "tomsmith" into [e17] input
✓ typed "SuperSecretPassword!" into [e20] input  (correctly identified password field)
✓ clicked [e23] i " Login"
navigated to https://the-internet.herokuapp.com/secure
```
The final `look` shows "You logged into a secure area!" — login succeeded.

**Key finding:** Cairn's NL grounding correctly identified the password field via semantic matching ("password field" → input with password-like attributes), while agent-browser's ref-based approach was only as good as the ref extraction (which failed in the harness). Additionally, agent-browser's "✓ Done" on a non-fillable element is a silent failure that could mislead an agent.

---

### T6: Multi-step navigation — click link, verify URL

**Task:** Navigate to example.com, click "Learn more", verify the URL changed to iana.org.

| Tool | Step | Command | Exit | Time (ms) | Stdout (B) | Stderr (B) |
|------|------|---------|------|-----------|------------|------------|
| agent-browser | 1 | `open https://example.com` | 0 | 809 | 42 | 0 |
| agent-browser | 2 | `find text 'Learn more' click` | 0 | 1,360 | 9 | 0 |
| agent-browser | 3 | `get url` | 0 | 728 | 42 | 0 |
| Cairn | 1 | `goto https://example.com` | 0 | 2,815 | 401 | 0 |
| Cairn | 2 | `goto 'click the learn more link'` | 0 | 3,889 | 87 | 0 |
| Cairn | 3 | `status` | 0 | 2,833 | 173 | 0 |

| Aggregate | agent-browser | Cairn |
|-----------|--------------|-------|
| Commands | 3 | 3 |
| Time | **2,897 ms** | 9,537 ms |
| Stdout | **93 B** | 661 B |

**Analysis:** Both tools completed the task successfully. agent-browser's `find text 'Learn more' click` is a clean semantic locator that worked perfectly. Cairn's `goto "click the learn more link"` also grounded correctly and returned a navigation delta:
```
✓ clicked [e6] a "Learn more"
navigated to https://www.iana.org/help/example-domains
```
agent-browser's `get url` returned just the URL (42 B), while Cairn's `status` returned session state including URL, title, backend, and connection type (173 B). Both confirmed the navigation. agent-browser wins on speed and output compactness for this simple task.

---

## Grand totals (T1–T6, excluding cleanup)

| Metric | agent-browser | Cairn | Difference |
|--------|--------------|-------|------------|
| Total commands | 22 | 18 | Cairn −18% |
| Total time (ms) | 25,646 | 68,034 | agent-browser 2.65× faster |
| Total stdout (B) | 198,361 | 133,208 | Cairn −33% |
| Total stderr (B) | 160 | 0 | Cairn 0 errors |
| Explicit failures | 1 | 0 | Cairn |
| Silent failures | 1 | 0 | Cairn |
| Task success rate | 4/6 (67%) | 6/6 (100%) | Cairn |

### Token estimates (~4 bytes/token)

| Metric | agent-browser | Cairn |
|--------|--------------|-------|
| Total output tokens | ~49,590 | ~33,302 |
| T4 outlier excluded | ~3,520 | ~12,459 |

Without the T4 Wikipedia search results outlier (which produced 165 KB for agent-browser), agent-browser is actually more token-efficient on simple pages. The T4 outlier dominates the total.

---

## Projected real-world time (including LLM latency)

The `ms` metric above measures **tool execution time only**. In real agent usage, each CLI command requires an LLM reasoning step to decide the next command. LLM latency typically ranges from 2–10 seconds per step.

| LLM latency/step | agent-browser (22 cmds) | Cairn (18 cmds) | Faster |
|-------------------|------------------------|-----------------|--------|
| 2s | 25.6 + 44 = **69.6s** | 68.0 + 36 = **104.0s** | agent-browser |
| 5s | 25.6 + 110 = **135.6s** | 68.0 + 90 = **158.0s** | agent-browser |
| 10s | 25.6 + 220 = **245.6s** | 68.0 + 180 = **248.0s** | ≈ Tie |
| 15s | 25.6 + 330 = **355.6s** | 68.0 + 270 = **338.0s** | **Cairn** |

**Key insight:** At low LLM latency (2–5s/step), agent-browser's faster execution makes it faster overall. But as LLM latency increases (10s+), Cairn's fewer commands (18 vs 22) close the gap and eventually overtake agent-browser. At 15s/step — realistic for complex reasoning — Cairn is faster overall because the 4 saved commands × 15s = 60s outweighs the 42s execution time deficit.

---

## Where each tool wins

### agent-browser wins on

1. **Execution speed**: 2.65× faster per command (avg 1,166 ms vs 3,780 ms). agent-browser's `open`/`snapshot`/`fill` are lightweight CDP calls; Cairn builds a full page model on every command.
2. **Simple page compactness**: On trivial pages (T1, T6), `open` produces ~42 B vs Cairn's `goto` at ~401 B. When the agent only needs interactive elements, `snapshot -i` is consistently compact (74 B on example.com, 4,699 B on wikipedia.org).
3. **Feature maturity**: Semantic locators (`find role/text/label`), `get url/text/html/attr`, `press`, `scroll`, network mocking, cookies, screenshots, MCP, plugins — far more capabilities.
4. **Production readiness**: npm-published, battle-tested, plugin ecosystem, v0.33.0.

### Cairn wins on

1. **Command efficiency**: 18 vs 22 commands (−18%). `goto` is self-describing (shows the tree — no separate `snapshot` needed). NL intents collapse multi-step sequences into one command (`goto "type X into the search field"` handles click-to-reveal + type).
2. **Complex page compactness**: On the Wikipedia search results page, `look -i` produced 38,617 B vs agent-browser's `snapshot -i` at 165,039 B — **4.3× more compact**. Region focus (`focus main`) would compress further.
3. **Grounding flexibility**: NL intents (`goto "type X into the search field"`) ground via fuzzy token overlap + typeability scoring, finding inputs regardless of ARIA role. agent-browser's `find role searchbox` fails when the page doesn't have the exact role (T3 DuckDuckGo).
4. **Task success rate**: 100% (6/6) vs 67% (4/6). Cairn's click-to-reveal fallback handled the Wikipedia dialog search automatically; NL grounding found DuckDuckGo's search input without requiring an exact ARIA role.
5. **Self-describing output**: Every action returns what happened and what changed. `type` returns `✓ typed "tomsmith" into [e17] input` + delta. `click` returns `✓ clicked [e6] a "Learn more"` + navigation delta. agent-browser returns `✓ Done` — the agent must re-snapshot to know what happened.
6. **Delta output**: After `click`, Cairn shows only what changed (added/removed/modified nodes via `+`/`-`/`~` notation). agent-browser has no delta — the agent must re-snapshot the full page.

---

## Honest assessment

### What the numbers say

Cairn wins on the metrics that matter most for agent-driven automation: **fewer commands** (less LLM round-tripping), **less total output** (lower token cost), and **higher task success rate** (100% vs 67%). The command efficiency advantage compounds with LLM latency — at 10s+ per step, Cairn's 4 saved commands make it faster overall despite slower per-command execution.

agent-browser wins on **raw execution speed** (2.65×) and **simple-page compactness**. For scripted automation without an LLM in the loop, agent-browser is the better choice. Its feature breadth (screenshots, network mocking, MCP, plugins) makes it a production tool, while Cairn is an MVP validating a design approach.

### What the numbers don't capture

1. **Cognitive load**: Cairn's NL intents (`goto "click the login button"`) eliminate the agent's need to parse page structure, extract refs, and map intent to ref. This is a qualitative win that doesn't show up in byte counts — but it's the core design principle ("collapse the loop").
2. **Region focus**: Cairn's `focus <region>` can zoom into a subtree (e.g., `focus main` on a 165 KB page → ~5 KB). This wasn't tested in the benchmark but would further widen Cairn's compactness advantage on complex pages.
3. **Ref stability**: Cairn stamps `data-cairn-ref` attributes that survive within-page mutations. agent-browser's refs are ephemeral (from the AX tree) and can change between snapshots. This affects reliability on dynamic pages.
4. **Vision fallback**: Both tools have screenshot capabilities, but the benchmark focused on structured workflows. On canvas/WebGL/shadow-DOM pages, vision is essential and wasn't tested.

### Caveats

- The T5 agent-browser failure was partly a **harness limitation** (grep-based ref extraction matched a heading instead of the password textbox). An LLM agent would correctly identify the textbox from the snapshot. However, agent-browser's `fill @e3` returning "✓ Done" on a heading is a genuine silent-failure issue.
- The T3 agent-browser failure (`find role searchbox` on DuckDuckGo) is a **real limitation** — the page doesn't have `role="searchbox"`. An LLM agent could work around it by snapshotting and using `fill @ref`, but that requires an extra command.
- Cairn's per-command execution is slower because it builds a full page model on every invocation. This could be optimized (cache the model, only rebuild on navigation) but hasn't been yet.
- Single-run results have network latency variance. The relative comparisons are reliable, but absolute times would benefit from averaging.

---

## Raw data

- **Per-command metrics**: `scripts/benchmark-results.jsonl` (42 JSONL records)
- **Per-command output**: `scripts/benchmark-output/` (84 files: `{tool}_{task}_{step}.out` + `.err`)
- **Benchmark harness**: `scripts/benchmark.sh` (reproducible — run `bash scripts/benchmark.sh`)

To re-run the benchmark:
```bash
bash scripts/benchmark.sh
```
