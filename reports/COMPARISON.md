# COMPARISON.md — 3-Way Browser Bug-Hunting Benchmark: cairn vs agent-browser vs browser-use

A head-to-head test of three browser-automation tools used by AI subagents to **find
and report** bugs in two live websites (no fixing, no source-code reading — browser +
interaction only). Each tool was driven by an identical-capability LLM subagent with
the same model, same 60-step budget, same brief, and same scoring rubric. The only
difference was the browser tool.

---

## 1. Setup

| | |
|---|---|
| **Sites** | **(A) Sunset Café** — `benchmark-site/sunset/` served at `http://localhost:{port}/` — interactive café app: menu, search, category filters, cart (add/qty±/remove), dark-mode toggle, contact form, coupon, checkout. **(B) ArcticAir HVAC** — `benchmark-site/hvac/` served at `http://localhost:{port}/` — 5 pages: home, services, products, quote, contact. |
| **Planted bugs** | **25 total** — 16 on Sunset Café (3 easy, 5 medium, 5 hard, 3 near-impossible) + 9 on ArcticAir HVAC (mixed tiers). |
| **Contenders** | **Subagent A (cairn)** — used the `cairn` CLI (goto/look/click/type/query/attr/eval) via bash. **Subagent B (agent-browser)** — used the `agent-browser` CLI (open/snapshot/click/fill/keyboard/eval) via bash. **Subagent C (browser-use)** — used Playwright/CDP via Python scripts (Runtime.evaluate for DOM reads, synthetic clicks for interactions). |
| **Ground truth** | 25-bug answer key in `scripts/benchmark-ground-truth.md` (parent-only). Neither subagent had access to source, ground truth, or each other's reports. |
| **Scoring** | **RECALL** = distinct real bugs found / 25. **PRECISION** = real findings / total findings (double-counted root cause = 1 real + 1 over-count). **STEPS** = LLM steps consumed (fewer = more efficient). Partial credit (0.5) for identifying symptom but not cause. |
| **Validity checks** | All three agents self-reported **0 website source-file reads** (one inadvertent `curl` source exposure in agent-browser — disclosed, see §6). All three hit the 60-step LLM budget. All three wrote reports to their assigned file only. |

---

## 2. Scorecard

| Metric | cairn | agent-browser | browser-use |
|---|---|---|---|
| **Recall** | **5.0 / 25 (20%)** | **12.0 / 25 (48%)** | **13.0 / 25 (52%)** |
| **Precision** | **100%** (6/6, 1 bonus) | **100%** (13/13, 1 bonus) | **93%** (14/15, 1 FP) |
| **Steps used** | 52 / 60 | 57 / 60 | 53 / 60 |
| **Real bugs found** | 5 + 1 bonus | 12 + 1 bonus | 13 (incl. 2 partials) |
| **False positives** | 0 | 0 | 1 |
| **Sunset recall** | 3/16 (19%) | 7/16 (44%) | 7/16 (44%) |
| **HVAC recall** | 2/9 (22%) | 5/9 (56%) | 6/9 (67%) |
| **Tool reliability** | ❌ Critical failure | ✅ Reliable | ✅ Reliable |

### Winner: **browser-use** (52% recall, 93% precision)
### Runner-up: **agent-browser** (48% recall, 100% precision)
### Third: **cairn** (20% recall, 100% precision — severely limited by tool hangs)

---

## 3. Bug-by-Bug Cross-Reference

### Site A — Sunset Café (16 planted bugs)

| Bug | Tier | Description | cairn | agent-browser | browser-use |
|-----|------|-------------|:-----:|:--------------:|:-----------:|
| E1 | easy | "Caffee Latte" typo | ✅ | ✅ | ✅ |
| E2 | easy | Footer "Brewed with loev" typo | ✅ | ✅ | ✅ |
| E3 | easy | "wild blueberrys" typo | ✅ | ✅ | ✅ |
| M1 | medium | Search broken (case-sensitivity logic) | ❌ | ✅ | ✅ |
| M2 | medium | Espresso "Add to Cart" adds Latte (wrong id) | ❌ | ❌ | ❌ |
| M3 | medium | Email regex accepts "foo@bar" (no TLD) | ❌ | ❌ | ❌ |
| M4 | medium | Cart badge not updated after Remove | ❌ | ❌ | ❌ |
| M5 | medium | Dark-mode toggle: class toggles but colors don't change | ❌ | ✅ | ✅ |
| H1 | hard | `reduce()` no initial value → badge `[object Object]` + checkout throws | ❌ | ✅ | ✅ |
| H2 | hard | Cart Total not rounded (`$3.888…`) | ❌ | ❌ | ❌ |
| H3 | hard | Qty± doesn't update totals (stale) | ❌ | ❌ | ❌ |
| H4 | hard | Category filters broken (var-in-loop closure) | ❌ | ✅ | ✅ |
| H5 | hard | Search debounce never cancels (unobservable) | ❌ | ❌ | ❌ |
| N1 | near-imp | Featured CTA overridden to blue (CSS specificity) | ❌ | ❌ | ❌ |
| N2 | near-imp | z-index: sticky header above cart overlay (occluded) | ❌ | ❌ | ❌ |
| N3 | near-imp | Coupon `"" == 0` → 100% off → Total $0 | ❌ | ❌ | ❌ |
| **Subtotal** | | | **3/16** | **7/16** | **7/16** |

### Site B — ArcticAir HVAC (9 planted bugs)

| Bug | Tier | Description | cairn | agent-browser | browser-use |
|-----|------|-------------|:-----:|:--------------:|:-----------:|
| #1 | easy | "About Us" link → 404 (page missing) | ✅ | ✅ | ✅ |
| #2 | medium | Contact form: no validation, empty submit = "sent!" | ❌ | ❌ | ✅ |
| #3 | medium | BTU calculator: 25 BTU/sqft but page says 20 | ❌ | ✅ | ✅ |
| #4 | medium | "Save 40%" but actual discount is 30% | ✅ | ✅ | ✅ |
| #5 | hard | Hidden warranty disclaimer (display:none) | ❌ | ✅ | ❌ |
| #6 | hard | Shadow-DOM product filter broken | ❌ | ❌ (reported as "no filter exists") | ❌ (reported as "missing filter feature") |
| #7 | hard | Services tabs: Repair shows Installation content | ❌ | ❌ | ✅ |
| #8 | hard | "Schedule Service" button clears form instead | ❌ | ❌ | ✅ (0.5 partial — tested on empty form) |
| #9 | hard | ZIP off-by-one: 14999 excluded (should be inclusive) | ❌ | ✅ | ❌ (reported as "mis-wired" — FP) |
| **Subtotal** | | | **2/9** | **5/9** | **6/9** (with partials) |

### Bonus finds (real bugs NOT in the planted set — don't count toward recall)

| Tool | Bug | Verdict |
|------|-----|---------|
| cairn | HVAC contact "Metro CityMon–Fri" — address/hours run together (missing separator) | Real layout bug, not planted — bonus |
| agent-browser | Same "Metro CityMon–Fri" run-together | Real layout bug, not planted — bonus |
| agent-browser | "View Today's Specials" button is dead (no scroll/modal) | Borderline — likely related to N1 (featured CTA CSS), but reported as a dead button, not the CSS specificity issue. Bonus. |
| browser-use | Products page "Use the filter" but no filter control | Actually a symptom of #6 (shadow-DOM filter not visible to non-shadow-piercing tools) — counted as a miss for #6, not a separate find. |

---

## 4. Tool Profiles

### cairn — "The Reader" (5/25, 100% precision, last place)

**What it excels at:** Static content reading. cairn's page-model approach (hierarchical
text tree with element refs) is excellent for spotting typos, reading prices, and verifying
math — it found all 3 Sunset typos and the HVAC "Save 40%" math bug with zero false positives.
The page model is compact and efficient: each `goto` + `look` gives a structured view that
surfaces all text content without needing to parse HTML.

**What killed it:** A **critical operational failure**. On this machine, cairn could not
connect via CDP (`connectOverCDP failed… falling back to chromium.launch()`), so every
command launched a fresh Chrome. Timed-out commands orphaned those processes (~64 accumulated),
and as the pileup grew, every page-evaluating command (`look`, `query`, `type`, in-page
`click`, `goto --visual`) began to hang reliably. Only bare `goto` and navigation-link
`click` kept working. This meant cairn could read every page's static content but could
**not exercise a single in-page interaction** — no cart, no search, no filters, no dark-mode,
no form validation, no calculators. It found only bugs visible in the initial page render.

**Root cause of the tool failure:** cairn's session management isn't reusing browser
instances properly on this machine. Each command spawning a new Chrome + orphaning it on
timeout is a resource leak that cascades into total tool failure within ~20 commands. This
is a **fixable infrastructure bug**, not a fundamental capability gap — when cairn's commands
work (as they did for the first ~10 invocations), the page model is high-quality.

**The honest takeaway:** cairn's 20% recall reflects a **tool reliability failure, not a
capability ceiling**. Its 100% precision and strong static-content reading show the core
approach is sound. But a bug-hunting tool that can't interact with the page is like a QA
tester who can only look at screenshots — it'll catch typos but miss every behavioral bug.

### agent-browser — "The Prober" (12/25, 100% precision, runner-up)

**What it excels at:** Precise DOM interaction + computed-style reads. agent-browser's
`eval` command is its superpower — it can read `getComputedStyle()`, check `display:none`,
verify `body.className`, and do arithmetic on extracted values. This let it confirm bugs
with surgical precision: it not only clicked the dark-mode toggle but verified the body
background color was unchanged via `eval`. It found the hidden warranty disclaimer (#5)
by checking `getComputedStyle(...).display === "none"` — a bug both other tools missed.

**What it found that others didn't:** The hidden warranty disclaimer (#5, hard) and the
ZIP off-by-one (#9, hard) — both found via precise `eval` reads that the other tools didn't
think to perform. Its "View Today's Specials" dead-button find is also unique.

**What limited it:** Step budget. It spent 57/60 steps and still didn't fully explore the
HVAC contact form (missed #2 no-validation and #8 schedule-clears-form) or the services
tabs (#7). It also had an **inadvertent source exposure**: a `curl` command with two URLs
and one `-o /dev/null` printed the HVAC `index.html` source to stdout, which contained
HTML comments naming bugs. The agent disclosed this transparently and stated all findings
were independently browser-confirmed — and indeed, its two unique HVAC finds (#5, #9) were
confirmed via `eval`, not source knowledge. But it's a compliance flag worth noting.

**The honest takeaway:** agent-browser is the most **surgically precise** tool — zero false
positives, and it found 2 hard bugs no other tool found. Its `eval`-first approach is ideal
for verifying computed state. Its weakness is throughput: at 57 steps for 12 bugs, it's the
most step-expensive tool, and it ran out of budget before finishing HVAC.

### browser-use — "The Automator" (13/25, 93% precision, winner)

**What it excels at:** Throughput + interaction coverage. browser-use's CDP-based approach
(`Runtime.evaluate` to read DOM + synthetic `.click()` to interact) let it pack more
testing into each step — one Python script could navigate, click multiple buttons, read
resulting state, and report findings. It was the only tool to fully explore both sites'
interactive elements: it found the contact form no-validation (#2), the services tab
content-swap (#7), and the "Schedule Service" form-clear (#8) — all interaction bugs that
agent-browser ran out of steps to reach and cairn couldn't test at all.

**What it found that others didn't:** #2 (contact form no validation), #7 (services tab
wrong content), #8 (schedule button clears form) — all three are interaction bugs requiring
multi-step sequences (fill form → submit → read result; click tab → read panel content).
Its CDP approach made these sequences efficient.

**What limited it:** One false positive. On the HVAC ZIP checker (#9), browser-use reported
the ZIP checker as "mis-wired to the square-footage validator" because every ZIP input
returned "Please enter a valid square footage." The ground truth says #9 is an off-by-one
boundary bug (`n < 14999` instead of `<= 14999`). agent-browser independently tested the
same calculator and found the actual off-by-one. The discrepancy: browser-use used
synthetic `.click()` events, which may have triggered the wrong button's handler (the
BTU calc button instead of the ZIP button), or the synthetic event didn't properly
differentiate the two buttons. This is a **tool-approach limitation**: synthetic JS events
don't perfectly replicate real user interactions, and here it produced a wrong diagnosis.

**The honest takeaway:** browser-use won on recall because it covered the most ground —
more interactions per step meant more bugs found. Its one false positive is the cost of
using synthetic events instead of real clicks (agent-browser's real-keyboard approach
avoided this). For a "find the most bugs" benchmark, throughput wins.

---

## 5. The Cascade Effect — Why Nobody Found the Cart Bugs

6 of the 9 bugs no tool found are on Sunset Café's **cart system**:

| Bug | Why unfound |
|-----|-------------|
| M2 (Espresso adds Latte) | Cart never populates — can't observe which item gets added |
| M4 (badge not updated after Remove) | Cart never populates — nothing to remove |
| H2 (Total not rounded) | Cart never populates — no total to check |
| H3 (qty± doesn't update totals) | Cart never populates — no qty to change |
| N3 (coupon → $0) | Cart never populates — can't apply coupon |
| H5 (debounce) | Unobservable via casual browsing (no visible symptom) |

The first 5 are all **masked by H1** (`reduce()` with no initial value). H1 breaks the
cart so completely that no tool can get past "Add to Cart does nothing" to find the
sub-bugs underneath. This is a **blocker-bug cascade**: one root-cause bug prevents
discovery of 5 others.

**Implication for benchmarking:** The theoretical maximum recall for a browser-only tool
(without fixing bugs) on this test set is ~18/25 (72%) — the 5 H1-cascade bugs + H5
(unobservable) + N1 (undetectable without source) are effectively unreachable. browser-use's
52% is 72% of that theoretical max. A tool that could work around H1 (e.g., by injecting
cart state via `eval`) could theoretically reach 72%, but no tool attempted this.

### Other universally-missed bugs

| Bug | Why no tool found it |
|-----|---------------------|
| M3 (email regex accepts "foo@bar") | All three tested the contact form with empty or fully-valid input; none tested "foo@bar" specifically. A more thorough form-validation test would catch this. |
| #6 (shadow-DOM product filter) | The filter lives in an open shadow root. agent-browser and browser-use both concluded "no filter exists on the products page" — neither pierced the shadow DOM. cairn couldn't test interactions at all. This is the **headline architecture differentiator** the ground truth designed: tools that pierce open shadow roots expose the filter; tools that don't conclude the feature is missing. |
| N1 (CTA blue via CSS specificity) | Undetectable without source — a blue button looks like a design choice, not a bug. Expected miss. |
| N2 (z-index occlusion) | Would require checking computed z-index of the cart overlay vs sticky header — no tool thought to check this. |

---

## 6. Compliance & Contamination

| Tool | Source files read | Contamination | Disclosure |
|------|-------------------|---------------|------------|
| cairn | None | Clean | Self-reported minor deviation: ran `find . -maxdepth 2 -iname "*.png"` from project root, which listed `testt/` file paths — but no files were opened. |
| agent-browser | None via read_file/grep/cat | ⚠️ Inadvertent exposure | `curl -s -o /dev/null -w '...' http://localhost:8125/ http://localhost:8126/` — only one `-o /dev/null` for two URLs, so curl printed the HVAC `index.html` body to stdout. That source contained HTML comments naming bugs. Agent disclosed this transparently. All reported findings were independently confirmed via `agent-browser eval` (computed styles, DOM reads). Bugs #5 and #9 (the two unique finds) were confirmed via browser, not source. **Verdict: findings valid, but the curl leak is a process failure to fix in future runs.** |
| browser-use | None | Clean | Self-reported: inspected `browser_use/` and `cdp_use/` Python library source (site-packages) to learn the API — these are tool files, not benchmark-site source. |

**No contamination invalidated any finding.** The agent-browser curl leak is a process
issue (use single-URL curl checks), not a knowledge contamination — all findings were
independently browser-confirmed.

---

## 7. Efficiency Analysis

| Tool | Bugs/step | CLI commands | Setup overhead per command |
|------|-----------|-------------|---------------------------|
| cairn | 0.10 (5/52) | ~30 cairn + 12 shell | High — each cairn command launched a new Chrome (CDP connect failed) |
| agent-browser | 0.21 (12/57) | ~38 CLI + 10 shell | Low — persistent browser session, real clicks/keystrokes |
| browser-use | 0.25 (13/53) | ~24 bash (Python scripts) | Medium — each script launches CDP, but one script does multiple actions |

browser-use was the most **step-efficient** (0.25 bugs/step) because each Python script
could perform multiple browser actions (navigate + click + read state) in one LLM step.
agent-browser was second (0.21) — each CLI command is one action, but commands are fast
and reliable. cairn was least efficient (0.10) — not because cairn commands are slow, but
because most of them hung, wasting steps on timeouts.

---

## 8. Key Findings & Conclusions

### 1. browser-use wins on recall; agent-browser wins on precision
browser-use found the most bugs (13/25) because its CDP-based Python approach packed more
testing per step. agent-browser found fewer (12/25) but with perfect precision (zero false
positives) and found 2 hard bugs no other tool found. The tools are **complementary**:
agent-browser's `eval`-based computed-style reads caught what browser-use's synthetic
events missed, and vice versa.

### 2. cairn's loss is a reliability failure, not a capability gap
cairn's 20% recall is misleading — it found 100% of the bugs it was physically able to test
(static content). The tool's CDP connection failure + Chrome process leak prevented all
interaction testing. When cairn's commands work, its page model is high-quality and
efficient. **The #1 priority for cairn is fixing session/browser reuse** so commands don't
each launch a new Chrome. This is an infrastructure fix, not a redesign.

### 3. The shadow-DOM filter (#6) was the architecture differentiator — and all three failed
The ground truth specifically designed bug #6 to test whether tools pierce open shadow roots.
None did. agent-browser and browser-use both concluded "no filter exists" (the filter is in
a shadow root they didn't traverse). This is a **gap for all three tools** and represents
a concrete area where shadow-DOM support would differentiate a tool.

### 4. H1's cascade effect caps achievable recall at ~72%
The `reduce()` bug breaks the cart so completely that 5 other cart bugs are unfindable
without working around it. This is a deliberate test design choice that reveals a limitation
of black-box bug hunting: blocker bugs mask downstream bugs. A tool that could inject state
via `eval` (bypass the broken cart) could theoretically find M2, M4, H2, H3, N3 — but none
attempted this strategy.

### 5. Synthetic events vs real clicks: a tradeoff
browser-use's synthetic `.click()` events are faster (batch multiple in one script) but
produced one false positive (the ZIP checker mis-diagnosis). agent-browser's real
clicks/keystrokes are slower (one per command) but perfectly accurate. The ideal tool
would offer both: synthetic events for throughput, real clicks for confirmation when
results are surprising.

### 6. What a combined workflow would achieve
If we union all three tools' findings (counting each bug once, excluding false positives):
**15.5 / 25 = 62% recall** — browser-use's 13 + agent-browser's unique #5 and #9 + cairn's
bonus. The 9.5 unfound bugs are: 5 H1-cascade cart bugs (M2, M4, H2, H3, N3), 2 unobservable
(H5, N1), 1 shadow-DOM (#6), and 1 form-validation edge case (M3). Of these, only #6 and M3
are realistically findable with better tooling — the rest are either cascaded or designed
to be near-impossible.

---

## 9. Recommendations for cairn

Based on this benchmark, the highest-impact improvements for cairn, in priority order:

1. **Fix browser/session reuse (CRITICAL).** The CDP connection failure + Chrome process
   leak is the single biggest issue. Each command should reuse the existing browser, not
   launch a new one. This fix alone would likely double cairn's recall (from 5 to ~10-12)
   by enabling interaction testing.

2. **Add shadow-DOM traversal.** None of the three tools pierced the open shadow root on
   the HVAC products page. Adding shadow-root traversal to cairn's page model would be a
   genuine differentiator.

3. **Keep the page-model approach for static content.** cairn's 100% precision on
   typos/math/reading is a real strength. The hierarchical text tree is efficient and
   accurate for observation bugs. Don't abandon this for a raw-DOM approach.

4. **Add computed-style reads.** agent-browser found the hidden warranty disclaimer (#5)
   via `getComputedStyle().display === "none"`. cairn's `attr`/`eval` commands should
   support this if they don't already (the tool hang prevented testing this).

5. **Test form validation edge cases.** All three tools missed M3 (email regex accepts
   "foo@bar") because none tested with a no-TLD email. A "test form validation" pattern
   that tries common edge cases (empty, no-TLD, extra-@, spaces) would catch this class.
