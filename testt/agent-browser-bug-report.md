# Agent-Browser Bug Hunt Report — Sunset Café

## Metrics

| Metric | Count |
|---|---|
| Total tool calls (every invocation: bash, prompt_vision, scratchpad, write_file, glob, list_directory, read_file) | ~66 |
| Browser navigation / page-load actions (`open`, `reload`, `close --all`) | 5 |
| Browser interaction actions (clicks, fills, eval clicks, find/click, toggles, add-to-cart) | ~38 |
| Screenshots taken (saved to disk) | ~20 (plus ~3 attempted but lost to the browser hang) |
| prompt_vision (vision) calls | 13 |
| Source-file reads (website files: index.html, app.js, styles.css, server.log, etc.) | **0** |
| Console errors captured | 0 (console buffer was empty on clean reload; the fatal failure was a CDP/Runtime timeout, not a console error) |
| **Total bugs found** | **14** |
| — easy | 3 |
| — medium | 4 |
| — hard | 5 |
| — near-impossible | 2 |
| Findings I am unsure about (possible false positives) | 3 |

Notes on methodology compliance: I did NOT read any website source/data file. The only `read_file` attempts I made (2) targeted `claude-skills/agent-browser/skill-data/core/SKILL.md` — the **browser tool's own documentation** (which the task told me to load first) — and both **failed with "File not found"** because the skill ships inside the CLI, not as a project file; I therefore loaded it via the CLI's own `agent-browser skills get core --full` command (running the tool, not reading a website file). Zero website source files were inspected.

## Methodology

I loaded http://localhost:8000 with the `agent-browser` CLI (v0.33.0), used accessibility-tree snapshots (`snapshot -i`) and attribute checks (`get attr`) to read exact DOM state (text, classes, input values), took a screenshot after every meaningful interaction, and used `prompt_vision` on those screenshots to visually read rendered text, colors, layout, and broken states. For two findings (dark-mode CSS and coupon total) I additionally used `eval` to read computed styles and rendered DOM `innerText` — both are browser runtime reads of the live page, not source-file reads. I deliberately did NOT open app.js / styles.css / index.html / server.log.

## Bugs Found

### Bug 1: Menu item misspelled "Caffee Latte"
- Difficulty (your guess): easy
- Found via: [visual]
- Location: Menu card name, second card in the first row of the menu grid.
- Description: The item is spelled "Caffee Latte" — a misspelling. The correct spelling is "Caffè Latte" (or "Café Latte"). Price $4.50.
- Reproduce: Load the home page; read the second menu card name.
- Expected vs Actual: Expected "Caffè Latte"; actual "Caffee Latte".
- Confidence: high

### Bug 2: Description misspelled "wild blueberrys"
- Difficulty (your guess): easy
- Found via: [visual]
- Location: Description text on the "Blueberry Muffin" menu card (second row of the menu grid).
- Description: The description reads "Loaded with wild blueberrys." The plural of "blueberry" is "blueberries", not "blueberrys".
- Reproduce: Load the home page; scroll to the Blueberry Muffin card; read its description.
- Expected vs Actual: Expected "Loaded with wild blueberries."; actual "Loaded with wild blueberrys."
- Confidence: high

### Bug 3: Search field low contrast
- Difficulty (your guess): easy
- Found via: [visual]
- Location: The "Search the menu..." input box in the controls bar.
- Description: The search input has a black background with gray placeholder text, which is lower contrast than the rest of the light theme and looks inconsistent with the page styling. Minor/possible cosmetic issue.
- Reproduce: Load the home page; observe the search input styling.
- Expected vs Actual: Expected a light-themed input consistent with the page; actual a dark box with gray placeholder.
- Confidence: low

### Bug 4: Category filters Coffee / Tea / Pastry do not work
- Difficulty (your guess): medium
- Found via: [interaction] (+ visual confirmation)
- Location: The filter button row (All / Coffee / Tea / Pastry) above the menu grid.
- Description: Clicking the Coffee, Tea, or Pastry filter buttons neither activates them nor filters the menu. After clicking any of them, the "All" button keeps the CSS class `filter-btn active` while the clicked filter stays `filter-btn` (no `active`), and all 8 items (Green Tea, Caffee Latte, Cappuccino, Earl Grey, Espresso, Butter Croissant, Blueberry Muffin, Matcha Latte) remain visible regardless. Only the "All" filter functions.
- Reproduce: Load page; `get attr` shows e24(All)=`filter-btn active`, e25/e26/e27=`filter-btn`. Click Coffee (e25); re-check classes — All still `active`, Coffee not. Screenshot shows all 8 items still listed (including teas Green Tea/Earl Grey and pastries Croissant/Muffin). Repeat for Tea and Pastry — same result.
- Expected vs Actual: Expected clicking "Coffee" to highlight Coffee and show only coffee items (Caffee Latte, Cappuccino, Espresso, Matcha Latte); actual nothing changes, All stays active, all 8 items stay visible.
- Confidence: high

### Bug 5: Sticky header overlaps/cart covers the cart controls (z-index)
- Difficulty (your guess): medium
- Found via: [interaction]
- Location: Header area — the "Cart" button in the header, the cart drawer's "×" close button, and the cart's "Apply" coupon button.
- Description: The cart UI controls are visually covered by the sticky header element, so normal clicks do not land on them. Clicking the Cart button reports "covered by <div.header-inner>"; clicking the cart's "×" close button reports "covered by <header.site-header>"; clicking the "Apply" coupon button reports "covered by <header.site-header>". The cart can only be opened/closed/interacted with by calling `.click()` via JS (eval), bypassing the hit-test. This indicates a stacking-context / z-index defect where the sticky header sits above the cart button and cart drawer.
- Reproduce: Load page; add an item; run `agent-browser click` on the Cart button → "covered by <div.header-inner>". Open cart via JS `.click()`; run `agent-browser click` on the "×" → "covered by <header.site-header>"; run `agent-browser click` on "Apply" → "covered by <header.site-header>".
- Expected vs Actual: Expected the Cart button, cart close (×), and Apply to be directly clickable; actual they are occluded by the sticky header and only clickable via JS.
- Confidence: high

### Bug 6: Contact form accepts an invalid email and shows a success message
- Difficulty (your guess): medium
- Found via: [interaction] (+ visual confirmation)
- Location: The "Get in touch" contact form — Email field and the success message that appears after "Send Message".
- Description: Submitting the contact form with an invalid email "foo@bar" (no TLD / invalid format) is accepted and produces the success message "Message sent! We'll get back to you soon." with no validation error. The Name field is marked required, but the Email field performs no format validation.
- Reproduce: Load page; fill Name = "Test User", Email = "foo@bar", Message = "Hello from QA"; click "Send Message". A success toast "Message sent! We'll get back to you soon." appears; no error is shown.
- Expected vs Actual: Expected a validation error / rejection for the malformed email "foo@bar"; actual a success confirmation.
- Confidence: high

### Bug 7: Contact form inputs render as solid black boxes
- Difficulty (your guess): medium
- Found via: [visual]
- Location: The three contact-form inputs (Name, Email, Message) in the "Get in touch" section.
- Description: On the light theme, the Name/Email/Message inputs render as solid black-filled rectangles with no visible placeholder text, which looks broken and inconsistent with the rest of the light page. The boxes stay black in dark mode too.
- Reproduce: Load the home page; scroll to the contact form; observe the input fields (also visible in full-page screenshots).
- Expected vs Actual: Expected light-bordered inputs consistent with the light theme (with visible placeholders/labels); actual solid black boxes.
- Confidence: medium

### Bug 8: Search returns no results for any query (including exact item names)
- Difficulty (your guess): hard
- Found via: [interaction] (+ visual confirmation + accessibility value read)
- Location: The search input + the menu grid / "No menu items match your search." empty state.
- Description: The search box filters the menu but matches nothing. Searching "Espresso" or "Green" (which are exact names of items), as well as partials "latte", "Latte", and "Caff", all yield the empty state "No menu items match your search." The input's value was confirmed (via accessibility snapshot) to actually hold the typed query, so the typing works — the matching logic is broken (it never returns a match).
- Reproduce: Load page; type "Espresso" into the search box (placeholder "Search the menu..."); wait. Screenshot shows "No menu items match your search." and zero item cards. Repeat with "Green", "latte", "Latte", "Caff" — all return the same empty state.
- Expected vs Actual: Expected searching "Espresso" to show the Espresso card (and "latte" to show Caffee Latte + Matcha Latte); actual no items for every query.
- Confidence: high

### Bug 9: Dark-mode toggle changes the label but does not change the colors
- Difficulty (your guess): hard
- Found via: [interaction] + [visual] (+ computed-style read via eval)
- Location: The "🌙 Dark Mode" / "☀️ Light Mode" toggle button and the whole page background/cards.
- Description: Clicking the Dark Mode toggle changes the button label to "☀️ Light Mode" and a dark flag is set on the body/html element, but the page colors do not change at all — the body background stays `rgb(255, 248, 240)` (light cream) and menu cards stay `rgb(255, 255, 255)` (white) per `getComputedStyle`. Side-by-side full-page screenshots before/after the toggle are visually identical except for the button label. The dark-mode CSS rules are not actually applied (likely a broken/missing selector despite the class being toggled).
- Reproduce: Load page; full-page screenshot (light). Click "Dark Mode"; button becomes "Light Mode"; full-page screenshot. Compare — backgrounds/cards/text are unchanged. `eval` of `getComputedStyle(body).backgroundColor` returns `rgb(255,248,240)` while the dark flag is `true`.
- Expected vs Actual: Expected a true dark theme (dark background, light text, dark cards) when toggled on; actual only the button label changes, the page stays light.
- Confidence: high

### Bug 10: Coupon "SUNSET10" makes the cart Total $0
- Difficulty (your guess): hard
- Found via: [interaction] (+ DOM innerText read via eval)
- Location: The cart drawer — Coupon field, Apply button, and the Total line.
- Description: Applying the coupon code "SUNSET10" to a cart with a $4.50 item sets the cart **Total to $0.00** while the Subtotal ($4.50) and Tax (8% = $0.36) remain unchanged. The cart's rendered DOM text reads "Subtotal$4.50 | Tax (8%)$0.36 | ... | Total$0". A 10%-off coupon should reduce the total by ~$0.45 (to roughly $4.41), not zero it out, so the discount is drastically over-applied / the total is computed wrong.
- Reproduce: Add an item to the cart (cart shows Subtotal $4.50, Tax $0.36, Total $4.86). Apply coupon "SUNSET10". Read the cart total — it becomes $0.
- Expected vs Actual: Expected Total ≈ $4.41 (subtotal+tax minus a 10% discount); actual Total = $0.00.
- Confidence: high

### Bug 11: Checkout appears to hang / freeze the page
- Difficulty (your guess): hard
- Found via: [interaction]
- Location: The "Checkout" button in the cart drawer.
- Description: Clicking the Checkout button (with items in the cart) caused the checkout-click JavaScript evaluation to time out (`Runtime.evaluate` timed out — the handler never returned), and immediately afterward the browser became permanently unresponsive: every subsequent CDP command failed with a connection timeout ("os error 10060"). Even a full `close --all` + fresh `open http://localhost:8000` did not restore usable automation (commands kept timing out). This is consistent with the checkout handler running a blocking/infinite operation that freezes the page.
- Reproduce: Load page; add an item to the cart; open the cart; trigger Checkout (via `.click()`). The command that clicks Checkout times out and the browser session stops responding to all further commands.
- Expected vs Actual: Expected checkout to complete and show an order confirmation (or, for an empty cart, a "cart is empty" message); actual the page/runtime hangs and the browser session becomes unresponsive.
- Confidence: medium

### Bug 12: Cart badge shows "[object Object]" instead of the item count
- Difficulty (your guess): near-impossible
- Found via: [interaction] (+ accessibility-tree text read)
- Location: The "Cart" button / its count badge in the header.
- Description: The cart count badge renders the literal string "[object Object]" instead of a number. With one item in the cart the button reads "Cart [object Object]"; with four items it read "Cart [object Object]111". This is a classic JavaScript bug where an object is concatenated into a string (`"Cart " + someObject`) instead of its numeric value being extracted. Confirmed via the accessibility snapshot (button name = "Cart [object Object]") and via `.textContent`.
- Reproduce: Load page; add one item to the cart; read the Cart button text — it is "Cart [object Object]" (not "Cart 1"). Add more items — the count part stays a broken object string.
- Expected vs Actual: Expected "Cart 1" (or a numeric badge showing the item count); actual "Cart [object Object]".
- Confidence: high

### Bug 13: Espresso's "Add to Cart" button adds the wrong item (Caffee Latte)
- Difficulty (your guess): near-impossible
- Found via: [interaction] (+ visual/DOM confirmation of the resulting cart)
- Location: The "Add to Cart" button on the Espresso menu card; the resulting cart contents.
- Description: Clicking the **Espresso** card's "Add to Cart" button adds **Caffee Latte** ($4.50) to the cart instead of Espresso ($3.50). Reproduced cleanly: after a reload (Cart 0) and a fresh snapshot where `e14` = the "Espresso" heading and `e15` = the Add-to-Cart button immediately under it, clicking `e15` produced a cart containing "Caffe Latte" at $4.50 (Subtotal $4.50, Tax $0.36, Total $4.86) — not Espresso at $3.50. The other add buttons tested (Green Tea, Butter Croissant, Blueberry Muffin) added the correct items; only Espresso's button is mis-wired to the wrong item.
- Reproduce: Reload page (Cart 0); snapshot; the Espresso heading is `e14`, its Add button is `e15`; click `@e15`; open the cart — it contains "Caffe Latte" $4.50, not "Espresso" $3.50.
- Expected vs Actual: Expected clicking Espresso's Add to Cart to add Espresso ($3.50); actual it adds Caffee Latte ($4.50).
- Confidence: high

### Bug 14: Phantom "Espresso" text appears in the search box on first load
- Difficulty (your guess): hard
- Found via: [interaction] (+ accessibility value read + visual)
- Location: The search input box and the menu grid empty state.
- Description: Shortly after the very first page load (before I had typed anything), the search box spontaneously contained the text "Espresso" and the page showed "No menu items match your search." with no item cards. This was confirmed by BOTH the accessibility snapshot (the search textbox's value was "Espresso") and a vision read of the screenshot. The page later self-corrected to an empty search box and all 8 items, and the phenomenon did not recur after a clean reload. This suggests an async/re-render glitch that seeds the search box on load.
- Reproduce: Hard to reproduce reliably — observed once on the initial load; did not recur on reload.
- Expected vs Actual: Expected the search box to be empty on load (showing all items); actual it transiently contained "Espresso" and showed the empty state.
- Confidence: low

## Notes

- **Possible false positives / lower-confidence items:** Bug 3 (search-field low contrast) is a cosmetic judgment; Bug 7 (black form inputs) might be intentional styling but looks broken; Bug 11 (checkout hang) — the browser becoming unresponsive right after the checkout click is strong circumstantial evidence, but I could not cleanly separate it from a possible CDP/daemon crash, and I could not complete a clean empty-cart checkout because the browser session died; Bug 14 (phantom "Espresso") was a one-time transient I could not reliably re-trigger.
- **Cart math, where observable, was correct:** per-line prices summed exactly to the Subtotal; Tax was correctly 8% of the subtotal (e.g. $4.50 → $0.36, $12.80 → $1.02); Total = Subtotal + Tax; all money values used 2 decimal places. The coupon (Bug 10) is the exception that breaks the Total.
- **Untested due to step budget / browser hang:** quantity +/- and whether totals update on quantity change; item Remove and whether the header cart badge stays accurate; wrong-code coupon; empty-coupon (blank) Apply; and a clean empty-cart checkout. The browser session became unresponsive after the checkout test (Bug 11) and I prioritized compiling this report over further recovery attempts.
- **"Green Tea" ordering:** Under the "All" filter the first item is Green Tea (a tea), not a coffee — the ordering is Tea, Coffee, Coffee, Tea, Coffee, Pastry, Pastry, Coffee. I did not flag this as a bug since "All" need not be category-sorted, but noting it for completeness.
- **Featured/special button:** The "View Today's Specials" button is blue and is visually distinct from the orange "Add to Cart" buttons — this appears intentional and not a bug.
- **Workflow note:** Because adding items / searching re-renders the page, accessibility refs (`@eN`) went stale quickly; I learned to re-snapshot or use `find placeholder/text` / JS `.click()` for reliability. The `[object Object]` cart badge made ref-based cart clicks unreliable and contributed to the covered-element click failures.
