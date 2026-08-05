# Bug-Hunt Comparison: Cairn vs agent-browser on the ArcticAir HVAC Demo

**A controlled, ground-truth bug hunt.** A purpose-built HVAC company demo site (`hvac-demo/`) was seeded with **9 known bugs** as an answer key. Two fresh-context subagents — one driving **Cairn**, one driving **agent-browser** — were each told *only* "explore this live site and find bugs" (they had no knowledge of the planted bugs). Both hunted the same site, page by page, capturing per-command output. This report scores what each surfaced against the ground truth.

**Date:** 2025-08-05 · **Cairn MVP (local Chrome backend)** · **agent-browser v0.33.0**

---

## TL;DR

| Metric | Cairn | agent-browser | Winner |
|--------|-------|---------------|--------|
| Planted bugs found (full) | 7 / 9 | 7 / 9 | **Tie** |
| Planted bugs found (incl. partial) | 7 / 9 | 7.5 / 9 | **agent-browser** |
| Commands run | 72 | ~98 | **Cairn** (−27%) |
| Total output (bytes) | 96,611 | 62,417 | **agent-browser** (−35%) |
| Bytes per command | ~1,342 | ~637 | **agent-browser** (2.1× more compact) |
| Both-missed bugs | 2 (#5, #6) | 1 (#5) | **agent-browser** |

**Bottom line:** Both tools found **7 of 9** planted bugs — but **different sevens**. The single decisive differentiator is the **shadow-DOM product filter (#6)**: agent-browser pierced the open shadow root, saw the filter buttons, clicked them, and watched every product vanish — Cairn's page model was **completely blind** to the shadow-root controls (it saw only 9 nav links on that page and reported "filter does not exist"). Going the other way, Cairn **fully characterized** the schedule-button bug (#8: "clicking it clears the form") while agent-browser only managed a **partial** ("button does nothing") because it tested on an empty form and grepped for the wrong confirmation words. Both missed the hidden `display:none` warranty disclaimer (#5) — a shared accessibility-tree limitation. On efficiency, Cairn used fewer commands (72 vs ~98) but emitted more bytes per command; agent-browser's compact `snapshot -i` made its *total* output 35% smaller despite needing more commands.

---

## Methodology

### The demo site

A 5-page static HVAC company website ("ArcticAir HVAC"), served locally via `python -m http.server` on port 8123. Pages: `index.html` (home), `services.html`, `products.html`, `quote.html`, `contact.html`. Shared `style.css` + `app.js`. The site is gitignored (`hvac-demo/`) — it is test material, not part of the Cairn tool itself.

### The 9 planted bugs (ground-truth answer key)

These were authored into the site *before* either hunt, so scoring is objective:

| # | Bug | Location | What's wrong |
|---|-----|----------|--------------|
| 1 | Broken "About Us" nav/footer link | all pages | links to `about.html`, which does not exist → HTTP 404 |
| 2 | Contact form has no validation | contact.html | submit handler shows "✓ Your message has been sent!" on empty fields and invalid email (no `@`); email field is `type=text`, no `required` |
| 3 | BTU calculator miscalculation | quote.html | page text states "20 BTU/sq ft" but JS computes `sqft × 25`; 1000 sqft → 25,000 BTU (should be 20,000) |
| 4 | "Save 40%" discount is wrong | index.html | "Was $1,999 → Now $1,399 → Save 40%"; actual discount = (1999−1399)/1999 = **30%**, not 40% |
| 5 | Hidden warranty disclaimer | index.html footer | `<p class="hidden">` (display:none) — material purchase-term info ("Warranty excludes labor costs after 90 days") invisible to users |
| 6 | Broken shadow-DOM product filter | products.html | filter widget lives in an open shadow root; clicking any category except "All" sets `display:none` on **every** product card (logic never matches category) |
| 7 | Services tabs show wrong content | services.html | JS `wrongMap` swaps installation↔repair; clicking "Repair" tab shows the "Installation" panel content (and vice versa) |
| 8 | "Schedule Service" button clears form | contact.html | button labelled "Schedule Service" calls `form.reset()` — clears all fields instead of scheduling |
| 9 | ZIP service-area off-by-one | quote.html | page claims "10000 to 14999" inclusive, but JS uses `n < 14999` (strict) — testing 14999 → "outside our service area" |

### Hunt protocol

- **Fresh-context, genuinely-blind subagents.** Each hunt was a separate subagent with no conversation history and no access to the answer key — it only knew "explore this live site and find bugs." (This is why the subagent approach was used: a fresh subagent truly cannot know what was planted, which an author-agent cannot un-know.)
- **No source access.** Both were instructed *not* to read files under `hvac-demo/` — explore only through the browser tool, as a real blind tester would.
- **Equivalent mandate.** Both were told to visit all 5 pages, read content, and exercise every interactive element, then report a numbered bug list + command count + output bytes.
- **Output capture.** Every command's stdout+stderr was redirected to `scripts/hvac-output/{cairn,ab}_NN_*.out` for byte accounting.
- **Separate Chrome instances.** Cairn's local backend (port 9222, `.sessions/` profile) and agent-browser's Playwright-managed launch (ephemeral port, separate profile) ran concurrently without collision.
- **No bug-fixing.** This is a hunting exercise; the planted bugs remain in the demo site.

### Limitations

- **Single run each.** No variance measurement; a thorough subagent could find more or fewer bugs on a re-run.
- **LLM-driven, not scripted.** The hunts are LLM-steered explorations, not deterministic scripts — the command counts and findings reflect how a capable agent *chose* to explore, which is itself the thing being measured (these are agent tools, after all).
- **Step-capped.** agent-browser's subagent hit its 60-step LLM cap mid-verification of bug #8 (hence the partial); Cairn's subagent finished with 19 steps to spare.
- **Subagent-reported counts.** Command counts (~98 for agent-browser) are as reported by the subagent; captured-file counts (84) differ slightly where a few commands weren't individually saved. Byte totals are exact (`wc -c`).

---

## Per-bug results

| # | Bug | Cairn | agent-browser | Notes |
|---|-----|:-----:|:-------------:|-------|
| 1 | About Us → 404 | ✅ | ✅ | Both clicked the link and saw the 404 page. |
| 2 | Contact form no validation | ✅ | ✅ | Both submitted empty fields + invalid email; both saw the fake success message. |
| 3 | BTU calc (25 not 20) | ✅ | ✅ | Both tested 1000 & 2000 sqft; both caught the 25× multiplier vs the stated 20. |
| 4 | "Save 40%" (actual 30%) | ✅ | ✅ | Both read the card and did the math. |
| 5 | Hidden warranty disclaimer | ❌ | ❌ | **Both blind** — `display:none` content is excluded from the accessibility tree both tools build on. Requires raw-DOM inspection. |
| 6 | Shadow-DOM product filter | ❌ | ✅ | **Key differentiator.** agent-browser pierced the open shadow root, saw the 4 filter buttons (`@e17–20`), clicked each, and watched all products vanish. Cairn's page model did **not** surface shadow-root interactive controls — it saw only 9 nav/footer links and concluded "the filter does not exist." |
| 7 | Services tabs miswired | ✅ | ✅ | Both clicked Repair and saw Installation content. |
| 8 | Schedule button clears form | ✅ | ◐ | Cairn **fully** characterized it: filled the form, clicked Schedule, saw "Form cleared." agent-browser **partial**: tested on an *empty* form (so `reset()` had no visible field effect) and grepped for `sent/scheduled/booked/thank/success/error` — missing the word "cleared" — and concluded "button does nothing." |
| 9 | ZIP off-by-one (14999 rejected) | ✅ | ✅ | Both tested the boundary (10000 ✓, 14999 ✗) and flagged the exclusive upper bound. Both also noted empty/non-numeric ZIP isn't validated (minor bonus find). |

**Overlap:** 6 of 9 bugs (#1, #2, #3, #4, #7, #9) were found by **both** tools — these are the "easy" bugs (bad links, bad math, broken validation, boundary errors) that any competent structural tester catches.

**Differentiators (the interesting 3):**
- **#5 (hidden disclaimer)** — both missed. Shared limitation: `display:none` content is correctly hidden from the a11y tree both tools model on. Neither does raw-DOM "show me everything including hidden" inspection by default.
- **#6 (shadow-DOM filter)** — **agent-browser found, Cairn missed.** This is the headline. Despite Cairn's Phase 2 claim of shadow-DOM *detection* (it noted "1 shadow-dom" on the page), it did not surface the shadow-root's **interactive** controls as actionable refs. agent-browser's snapshot pierced the open shadow root and exposed the filter buttons as normal `@eN` refs.
- **#8 (schedule button)** — **Cairn found fully, agent-browser partial.** A methodology difference, not a capability gap: Cairn's subagent happened to fill the form *first*, so the clearing was visible; agent-browser's subagent tested on an empty form and asked the wrong grep question. The tool *could* have found it; the agent's exploration path didn't.

---

## Aggregate metrics

| Metric | Cairn | agent-browser |
|--------|-------|---------------|
| Commands run | 72 | ~98 |
| Captured `.out` files | 72 | 84 |
| Total output (bytes) | 96,611 | 62,417 |
| Bytes per command | ~1,342 | ~637 |
| Planted bugs found (full) | 7 / 9 (78%) | 7 / 9 (78%) |
| Planted bugs found (incl. partial) | 7 / 9 | 7.5 / 9 (83%) |
| Both-missed bugs | 2 (#5, #6) | 1 (#5) |
| Bonus minor finds | 2 | 2 |

### Why the command-count and byte-count winners differ

- **Cairn uses fewer commands** because `goto <url>` is self-describing — it navigates *and* prints the page tree in one command. agent-browser needs `open <url>` *then* `snapshot -i` to see structure (≥2 commands per page). Over 5 pages, that compounds.
- **agent-browser uses fewer total bytes** because its `snapshot -i` interactive-only view is dramatically more compact than Cairn's full self-describing `goto` tree. agent-browser emits ~637 B/command vs Cairn's ~1,342 B/command (2.1× more compact per command).

**Notable reversal vs the prior [BENCHMARK.md](BENCHMARK.md):** In the earlier real-world-site benchmark, Cairn produced **33% less** total output than agent-browser (Cairn won on bytes). Here on the controlled local site, agent-browser produces **35% less** than Cairn (agent-browser wins on bytes). The cause: page complexity. On complex real-world pages (Wikipedia search results = 165 KB for agent-browser), Cairn's hierarchical + delta model wins; on simple, controlled pages like this HVAC demo, agent-browser's compact interactive snapshot wins. **The output-cost winner is page-complexity-dependent, not absolute.**

---

## Qualitative observations — where each tool struggled

### Cairn

- **Shadow DOM is its blind spot.** On `products.html`, Cairn reported only 9 interactive elements (all nav/footer links) and an NL `goto "click the Furnaces filter button"` returned `E_NOT_FOUND`. It even noted "1 shadow-dom" on the page but could not turn that into actionable refs for the shadow-root controls. The "use the filter" copy it could read made the absence conspicuous (so it flagged the *symptom*), but it could not *exercise* the actual bug.
- **Verbose self-describing navigation.** Every `goto` re-dumps the full page tree — great for not needing a separate `look`, but it inflates output on simple pages where a compact interactive view would suffice.
- **Strong on behavioral bugs.** Cairn fully caught the schedule-button-clears-form bug (#8) — its NL-intent exploration path happened to fill the form first, making the `reset()` visible. Its delta model (showing what changed after a click) helped it notice the form state change.
- **Math & boundaries: solid.** Caught the discount math, the BTU multiplier, the ZIP boundary, and the form validation gap — all by reading content and testing inputs.

### agent-browser

- **Shadow DOM is a strength.** Its `snapshot` pierced the open shadow root and exposed the filter buttons as ordinary `@eN` refs — no special handling needed. This single capability is why it beat Cairn on bug #6.
- **Methodology-dependent misses.** Its partial on #8 wasn't a tool limitation — the *agent* tested on an empty form and asked a grep that excluded the word "cleared." A different exploration path would have found it. This illustrates that agent-browser's effectiveness is more sensitive to the agent's choices.
- **More commands, less output.** The 2-command-per-page floor (open + snapshot) inflated its command count, but its compact snapshots kept total bytes low.
- **Step-capped.** Hit the 60-LLM-call cap mid-verification, which is why #8 stayed partial. More steps would likely have resolved it.

### Both tools

- **Blind to `display:none` content (#5).** Neither surfaces hidden-by-CSS text by default — both build on accessibility-tree representations that (correctly, per spec) exclude invisible content. Finding such bugs requires explicit raw-DOM inspection, which neither agent attempted.
- **Strong on the "easy six."** Broken links, bad math, missing validation, and boundary errors were reliably caught by both — these are the bugs where structural (non-visual) testing shines.

---

## Conclusions

1. **Equal headline bug-finding (7/9), but different bugs.** The overlap is 6/9; each tool uniquely found one the other missed (or only partially found). A combined run would surface 8/9 (only the hidden disclaimer eludes both).
2. **Shadow DOM is the decisive differentiator on this site.** agent-browser's open-shadow-root piercing exposed bug #6, which Cairn's page model could not. This is a real, reproducible capability gap — not a methodology artifact. Cairn's "shadow-dom detection" notes the root's existence but doesn't lift its interactive controls into the ref space, so the agent cannot act on them.
3. **Cairn's NL-intent + delta model catches behavioral state changes well** (fully characterized #8), but its verbosity on simple pages and shadow-DOM blindness are the trade-offs.
4. **agent-browser is more compact per command but needs more commands**, and its results are more sensitive to the agent's exploration path (the #8 partial was an agent-choice miss, not a tool gap).
5. **Output-cost winner is page-complexity-dependent:** Cairn wins on complex real-world pages (hierarchical + delta), agent-browser wins on simple/controlled pages (compact interactive snapshots). Neither is universally cheaper.

### Raw data
- All captured command output: `scripts/hvac-output/cairn_*.out` (72 files, 96,611 B) and `scripts/hvac-output/ab_*.out` (84 files, 62,417 B).
- Ground-truth site: `hvac-demo/` (gitignored).
- Answer key + per-hunt findings: this report and the scratchpad.
