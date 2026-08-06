# COMPARISON.md — Browser Bug-Hunting Showdown: cairn vs agent-browser

A head-to-head test of two browser-automation tools used by AI subagents to **find
and report** bugs in a live website (no fixing, no source-code reading — browser +
vision + interaction only).

---

## 1. Setup

| | |
|---|---|
| **Site** | "Sunset Café" — a static interactive café app (index.html, styles.css, app.js) served at `http://localhost:8000`. Features: menu, search, category filters, cart (add / qty± / remove), dark-mode toggle, contact form, coupon, checkout. |
| **Planted bugs** | 17 defects seeded across 4 tiers: **easy** (3) → **medium** (5) → **hard** (5) → **near-impossible** (4). |
| **Contenders** | **Subagent A (cairn)** — used the `cairn/skills/cairn` browser CLI. **Subagent B (agent-browser)** — used the `agent-browser` CLI (v0.33.0) + its core guide. Both were write-capable, given identical briefs (only the browser skill + report filename differed), 60-step budget, and instructed to hunt bugs **purely via browser + `prompt_vision` + interaction — no reading source/answer-key files, no fixing.** |
| **Ground truth** | A hidden answer key (`_GROUND_TRUTH.md`) was kept **outside the workspace** so neither agent could read it. |
| **Validity checks** | • Both agents self-reported **0 website source-file reads** (compliant).<br>• **Website files were NOT modified** — SHA-256 of index.html / styles.css / app.js after both runs **match the pre-run baseline** exactly.<br>• Two earlier dispatches were discarded: the first read the ground-truth file; the second read source code. The results below are from the clean, browser-only run. |

### Correction to the planted-bug list (author error)
One "near-impossible" bug, **N4** (intended: `form.reset()` clears the success
message before it shows), turned out **not to be a bug at all**. `form.reset()`
only resets *form controls* (inputs/textareas), not the `<p id="formMsg">` that
holds the message — so the success message **does** appear. Both agents correctly
observed the success message showing. **N4 is excluded from scoring**, leaving
**16 real bugs** as the denominator.

---

## 2. Ground truth (16 real bugs)

| ID | Tier | Description |
|---|---|---|
| E1 | easy | "Caffee Latte" misspelled (menu) |
| E2 | easy | footer "Brewed with loev" typo |
| E3 | easy | "wild blueberrys" misspelling (muffin desc) |
| M1 | medium | Search broken — query is lowercased then matched case-sensitively against mixed-case names, so almost no query ever matches |
| M2 | medium | Espresso "Add to Cart" adds a Caffee Latte (wrong id mapping) |
| M3 | medium | Email regex accepts "foo@bar" (no TLD) |
| M4 | medium | Cart count badge not updated after Remove |
| M5 | medium | Dark-mode toggle changes label but not colors (JS toggles `.dark`, CSS targets `.dark-mode`) |
| H1 | hard | `reduce()` with no initial value — badge shows `[object Object]` (non-empty cart) **and** throws "Reduce of empty array" on empty cart (hit at checkout) |
| H2 | hard | Cart Total rendered without rounding → e.g. `$10.152000000000001` |
| H3 | hard | Quantity ± re-renders items but not totals (stale subtotal/tax/total) |
| H4 | hard | `var`-in-loop closure — filter clicks throw (undefined index), so Coffee/Tea/Pastry do nothing; "All" stays active, all 8 items always show |
| H5 | hard | Search debounce never cancels prior timers (`clearTimeout` never called) |
| N1 | near-imp | CSS specificity war — featured "special" CTA overridden to ordinary blue (indistinguishable from a design choice) |
| N2 | near-imp | z-index — sticky header (z 9999) sits above cart overlay (z 1000); cart's top strip / close button is occluded |
| N3 | near-imp | Loose-equality coupon — empty `"" == 0` is true → 100% off → Total $0 |

> Two of my predicted *symptoms* were off, but the underlying code defects are real
> and were caught by their real behavior: **H4** actually makes filters do nothing
> (not "pastry only" as predicted — the closure reads `filterBtns[4]` which is
> undefined → TypeError → handler aborts); **H1** surfaces as the `[object Object]`
> badge (accumulator starts as an item object) plus a checkout throw, not just a
> latent throw.

---

## 3. Self-reported metrics (side-by-side)

| Metric | cairn (Subagent A) | agent-browser (Subagent B) |
|---|---|---|
| Total tool calls | **~51** | ~66 |
| Browser navigation / page-loads | 2 | 5 |
| Browser interaction actions (clicks/typing/etc.) | ~50 | ~38 |
| Screenshots taken | 13 | ~20 |
| `prompt_vision` (vision) calls | 9 | 13 |
| Source-file reads (website) | **0** ✅ | **0** ✅ |
| Console errors captured | **1** | 0 |
| Bugs reported (their own count) | 14 | 14 |
| — their easy / medium / hard / near-imp | 3 / 7 / 4 / 0 | 3 / 4 / 5 / 2 |
| Findings they flagged as unsure (possible FP) | 2 | 3 |

**Read of the raw metrics:** cairn was more **token/call-efficient** (~51 vs ~66
calls, 9 vs 13 vision calls, 13 vs 20 screenshots) while performing *more*
interaction actions (~50 vs ~38). agent-browser did more page loads (5 vs 2)
because **its browser session hung after the Checkout test** — the `alert()` modal
blocked a `Runtime.evaluate` until it timed out, then the `reduce` throw fired, and
the CDP session became unresponsive, forcing reloads. That hang also cost agent-browser
the steps needed to test quantity, remove, and the empty-coupon case.

---

## 4. Bug-finding results vs ground truth

| GT bug | Tier | cairn found? | agent-browser found? | Notes |
|---|---|:-:|:-:|---|
| E1 Caffee Latte typo | easy | ✅ | ✅ | both via vision |
| E2 footer "loev" | easy | ✅ | ❌ | **agent-browser misread "loev" as "love"** and explicitly wrote "looks fine" |
| E3 blueberrys typo | easy | ✅ | ✅ | both via vision |
| M1 search broken | medium | ✅ | ✅ | both via interaction; bg used a11y-tree to confirm the input really held the query |
| M2 Espresso→Latte | medium | ❌ | ✅ | **agent-browser only** — caught via careful ref tracking (e15 = Espresso's add btn → cart shows Caffee Latte) |
| M3 email "foo@bar" accepted | medium | ✅ | ✅ | both via interaction |
| M4 badge stale after remove | medium | ❌ | ❌ | neither tested remove+badge (and H1 breaks the badge anyway, masking it) |
| M5 dark mode no effect | medium | ✅ | ✅ | both; bg confirmed via `getComputedStyle` eval (body stays rgb(255,248,240)) |
| H1 reduce no-init (badge object + checkout throw) | hard | ✅ | ✅ | both found the `[object Object]` badge; **cairn also caught the checkout "Reduce of empty array" via `--trace`**; bg mischaracterized checkout as a "hang" |
| H2 FP total unrounded | hard | ✅ | ❌ | **cairn only** — hit it with a 3-item $9.40 cart ($10.152000000000001); bg only tested a $4.50 item ($4.86, clean) and concluded "cart math correct" |
| H3 qty± no total refresh | hard | ✅ | ❌ | **cairn only** (medium conf); bg didn't test — browser hung first |
| H4 filters broken (var closure) | hard | ✅ | ✅ | both found the symptom (filters do nothing, All stays active); bg added a11y `get attr` proof (class unchanged) |
| H5 debounce never cancels | hard | ❌ | ❌ | neither caught it (very low-impact; effectively unobservable via casual browsing) |
| N1 CTA specificity (blue not green) | near-imp | ❌ | ❌ | **both saw the blue button and dismissed it as "intentional/distinct"** — validates the near-impossible tier |
| N2 z-index cart behind header | near-imp | ❌ | ✅ | **agent-browser only** — click hit-tests reported "covered by `<header.site-header>`"; cairn muddled it into a cart-dismiss "false positive" |
| N3 empty coupon → $0 | near-imp | ❌ | ✅ | **agent-browser only** — observed coupon→Total $0 (mislabeled the trigger as "SUNSET10", but $0 is only reachable via the empty-input path) |

### Totals

| | cairn | agent-browser |
|---|:-:|:-:|
| **Unique real bugs found** | **10 / 16** | **10 / 16** |
| **Recall** | **62.5%** | **62.5%** |
| Shared (both found) | 7 | 7 |
| Uniquely found by this agent | 3 (E2, H2, H3) | 3 (M2, N2, N3) |
| Missed by both | 3 (M4, H5, N1) | 3 (M4, H5, N1) |

### Recall by difficulty tier (ground-truth tiers)

| Tier | cairn | agent-browser |
|---|:-:|:-:|
| Easy (3) | **3/3** | 2/3 |
| Medium (5) | 3/5 | **4/5** |
| Hard (5) | **4/5** | 2/5 |
| Near-impossible (3) | 0/3 | **2/3** |

**The headline pattern:** identical overall recall, but **complementary profiles**.
cairn swept **easy + hard** (read text reliably + logic/console diagnosis);
agent-browser swept **medium + near-impossible** (precise DOM/interaction probing
+ hit-test error messages). The 3 bugs only cairn found (footer typo, FP-total,
qty-totals) are *reading/observation* bugs; the 3 only agent-browser found
(espresso-mis-wire, z-index, coupon-$0) are *interaction edge-case* bugs.

---

## 5. Precision & false positives

Both agents reported **14 findings**, of which **10 map to unique real bugs** →
**precision 10/14 = 71.4%** (or 11/14 = 78.6% if you count the duplicate H1
symptom — both agents reported H1 twice: once as the `[object Object]` badge, once
as the checkout failure, which are one root cause).

### cairn false positives (3)
1. **"No feedback on invalid coupon"** — a minor UX gap, not a planted bug.
2. **"Valid coupon SUNNET10 doesn't apply"** — **cairn's own typo**: it typed
   `SUNNET10` instead of `SUNSET10`; the real code `SUNSET10` works (10% off). A
   self-inflicted false positive.
3. **"Cart overlay can't be dismissed (× / Escape)"** — Escape isn't wired in the
   code at all (so "Escape doesn't close" is expected, not a bug); the × timeout is
   likely a cairn interaction artifact (a grain of the real N2 z-index issue, but
   misattributed). cairn itself flagged this as a possible FP.

### agent-browser false positives (3)
1. **"Search field low contrast / black background"** — the CSS gives the input no
   dark background; likely a rendering/screenshot misread. Not planted.
2. **"Contact form inputs render as solid black boxes"** — same; the CSS specifies
   a light border, no black fill. Likely a rendering artifact. Not planted.
3. **"Phantom 'Espresso' text appears on first load"** — a one-time transient
   (likely leftover state / a re-render glitch during automation); did not recur on
   reload. Not planted. bg itself marked it low confidence.

> Both agents also **double-counted H1**: they reported the `[object Object]` badge
> and the checkout failure as two separate findings. Both are symptoms of one root
> cause (`reduce` with no initial value). These aren't false positives, but they
> inflate the raw "14 findings" count by one each.

---

## 6. Qualitative comparison

### cairn — workflow
Activated the `cairn` CLI directly (`use_skill` wasn't surfaced as a tool to the
subagent, so it used the installed `cairn` binary). Drove the page with cairn
commands, took `cairn look --visual` screenshots after each interaction, and read
them with `prompt_vision`. Used cairn's **`--trace` flag** to capture JS console
errors on clicks — this is what let it correctly diagnose Checkout as a
`Reduce of empty array` throw rather than a generic "hang".

**Strengths**
- **Most efficient** of the two: ~51 calls, 9 vision calls, 13 screenshots — fewer
  than agent-browser across the board, yet same recall.
- **Best text reading**: caught **all 3 easy typos**, including the footer "loev"
  that agent-browser misread as "love". Vision was used well for rendered text.
- **Console-error diagnosis**: the only agent to capture a JS error (`--trace`),
  nailing the checkout `reduce` bug's real cause.
- Found the two "observation" hard bugs agent-browser missed — **H2 (FP total)** and
  **H3 (qty totals)** — by building a multi-item cart and watching the numbers.

**Weaknesses**
- **No accessibility-tree / exact-DOM reads** — cairn's `look` tree didn't surface
  the cart overlay's text nodes (Subtotal/Tax/Total), forcing reliance on visual
  screenshots for dollar values. This likely contributed to missing interaction
  edge-cases.
- **Missed every near-impossible bug** (M2 espresso-mis-wire, N2 z-index, N3
  coupon-$0) — the interaction-edge-case tier where precise DOM/hit-test info
  matters most.
- **Self-inflicted FP**: mistyped the coupon code (`SUNNET10`), generating a false
  "coupon broken" finding.

### agent-browser — workflow
Used `agent-browser` (v0.33.0) with **accessibility-tree snapshots (`snapshot -i`)**
and **`get attr`** to read exact DOM state (text, classes, input values), screenshots
+ `prompt_vision` for visuals, and **`eval`** to read computed styles and rendered
`innerText`. The a11y tree gave it ground-truth DOM facts (e.g., confirming the
search input really held "Cappuccino" while the menu was empty; reading the cart's
`innerText` to see `Total$0`).

**Strengths**
- **Precise DOM/interaction probing** found the bugs cairn completely missed:
  **M2** (tracked that `e15` = Espresso's add button yet the cart got Caffee Latte),
  **N2** (click hit-tests literally reported "covered by `<header.site-header>`" →
  z-index), and **N3** (read cart `innerText` → `Total$0`).
- **Found 2 of 3 near-impossible bugs** — the hardest tier — including the only
  near-impossible either agent caught.
- The `get attr` + `eval` workflow produced *evidenced* findings (exact class names,
  computed colors, innerText strings) rather than purely visual judgments.

**Weaknesses**
- **Browser session hung on Checkout**: `alert()` is a blocking modal; agent-browser's
  `Runtime.evaluate` timed out waiting for it, then the `reduce` threw, and the CDP
  session died. This **cost it the quantity, remove, and empty-coupon tests** →
  missed H2 (it only ever saw a clean $4.86 total) and H3, and captured **0 console
  errors** (it mischaracterized checkout as a "hang" instead of the `reduce` throw).
- **Worse text reading**: misread the footer "loev" as "love" and explicitly cleared
  it as fine → missed an easy bug. More vision calls (13) but a worse read.
- **More false-positive visual judgments**: "black search box" and "black form
  inputs" aren't in the CSS — likely screenshot/rendering artifacts reported as bugs.
- **More calls** (~66) for the same recall.

---

## 7. Verdict

**It's a tie on quantity, complementary in kind.** Both found **10/16 bugs (62.5%
recall)** at **71.4% precision**, but they found *different* bugs:

- **cairn** is the better **visual / observation / console-diagnosis** hunter: it
  read rendered text more reliably (3/3 typos), caught the floating-point and
  quantity-total logic bugs by watching numbers, and uniquely used JS console
  tracing to correctly diagnose the checkout failure — all while using **~23% fewer
  tool calls**.
- **agent-browser** is the better **interaction / DOM-precision / edge-case**
  hunter: its accessibility-tree + `eval` + click hit-test errors surfaced the
  subtlest bugs — the espresso-mis-wire, the z-index occlusion, and the
  loose-equality coupon-to-$0 — including **2 of 3 near-impossible** bugs that cairn
  entirely missed.

**For "visual bug hunting" specifically** (the original brief: find bugs via the
browser + vision), **cairn has a slight edge**: it caught all visible text defects,
the numeric/format defects, and the dark-mode defect, and its `--trace` console
capture turned an interaction symptom into a root-caused finding — more efficiently.
**For "interaction / DOM edge-case hunting"**, **agent-browser has the edge**: its
exact-DOM reads and hit-test error messages found the near-impossible tier that
vision-only browsing can't reach.

**Bottom line:** neither tool is strictly better. cairn wins on efficiency and
visual/text/console diagnosis; agent-browser wins on depth at the interaction
edge-case / near-impossible tier. The two are **complementary** — a combined
workflow (cairn's console tracing + agent-browser's a11y-tree/eval DOM reads) would
likely have found **13/16** (everything except M4, H5, and the visually-indistinguishable
N1).

### Bugs nobody found (3)
- **M4** (badge stale after remove) — untested by both; also masked by H1, which
  breaks the badge (`[object Object]`) regardless.
- **H5** (search debounce never cancels) — effectively unobservable via casual
  browsing; very low impact.
- **N1** (featured CTA overridden to blue) — both agents saw the blue button and
  *correctly could not tell* it was a bug, since a blue button is indistinguishable
  from an intentional design choice. This validates the "near-impossible" tier: some
  defects are genuinely undetectable without reading the source.
