# Cairn-Browser Bug Hunt Report — Sunset Café

## Metrics

| Metric | Count |
|---|---|
| Total tool calls | ~51 |
| Browser navigation / page-load actions | 2 (initial `goto http://localhost:8000`, one reload `goto`) |
| Browser interaction actions (clicks, typing, keypresses, scrolls) | ~50 (13 type, ~22 click, 13 keypress, 4 scroll) |
| Screenshots taken (via `cairn look --visual`) | 13 |
| prompt_vision (vision) calls | 9 |
| Source-file reads | 0 (complied — no source/log/.md files read; browser + vision only) |
| Console errors captured | 1 (`Reduce of empty array with no initial value` on Checkout) |
| Total bugs found | 14 |
| — easy | 3 |
| — medium | 7 |
| — hard | 4 |
| — near-impossible | 0 |
| Findings I am unsure about (possible false positives) | 2 (Bug 10 quantity, Bug 14 cart-dismiss) |

## Methodology

I activated the **cairn** browser CLI (`cairn` command via bash — `use_skill` was not an available tool, so I used the installed `cairn` binary directly) and used ONLY cairn for all navigation, clicking, typing, scrolling, and screenshots. I loaded `http://localhost:8000`, interacted with every feature (search, category filters, cart add/qty/remove, dark mode, contact form, coupon, checkout), took a fresh `cairn look --visual` screenshot after each meaningful interaction, and used **prompt_vision** to read the rendered screenshots (text, colors, layout, numbers). I also used cairn's `--trace` flag to capture JS console errors on button clicks. I confirm I used **cairn, NOT agent-browser**, and read **zero** source files.

## Bugs Found

### Bug 1: "Caffee Latte" misspelled menu item name
- Difficulty: easy
- Found via: [visual]
- Location: Menu card #2 (the latte item), item name heading.
- Description: The item is spelled "Caffee Latte" — should be "Café Latte" / "Caffe Latte".
- Reproduce: Load http://localhost:8000; read the second menu card.
- Expected vs Actual: Expected "Café Latte" (or "Caffe Latte"); actual "Caffee Latte".
- Confidence: high

### Bug 2: "blueberrys" misspelled in description
- Difficulty: easy
- Found via: [visual]
- Location: Blueberry Muffin card description text.
- Description: Description reads "Loaded with wild blueberrys." — "blueberrys" should be "blueberries".
- Reproduce: Load home page; read the Blueberry Muffin card description.
- Expected vs Actual: Expected "blueberries"; actual "blueberrys".
- Confidence: high

### Bug 3: Footer "Brewed with loev" misspelled
- Difficulty: easy
- Found via: [visual]
- Location: Page footer (bottom of page).
- Description: Footer reads "© 2024 Sunset Café. Brewed with loev." — "loev" should be "love".
- Reproduce: Load home page; scroll to footer.
- Expected vs Actual: Expected "Brewed with love."; actual "Brewed with loev."
- Confidence: high

### Bug 4: Menu search is completely broken (no query ever matches)
- Difficulty: medium
- Found via: [interaction]
- Location: Search box ("Search the menu...") + menu results area.
- Description: Searching returns "No menu items match your search." for every term tested, including the EXACT full name of an existing item. Tested: "latte", "Latte", "Green", "sencha" (a description word), and "Cappuccino" (exact item name). I verified via screenshot+vision that the field truly contained "Cappuccino" while the menu showed "No menu items match your search." The search appears to match no item by name or description.
- Reproduce: Type "Cappuccino" (an exact item name) into the search box.
- Expected vs Actual: Expected the Cappuccino card to appear; actual "No menu items match your search."
- Confidence: high

### Bug 5: Category filters (Coffee/Tea/Pastry) do not filter
- Difficulty: medium
- Found via: [interaction] + [visual]
- Location: Category filter buttons row (All / Coffee / Tea / Pastry) + menu grid.
- Description: Clicking Coffee, Tea, or Pastry each shows ALL 8 items (teas + coffees + pastries mixed). None of the filters reduce the list. Additionally, vision confirmed the "All" button stays visually highlighted/active (filled orange) even after clicking "Pastry" — the clicked filter never becomes the active state.
- Reproduce: Click "Coffee" filter; observe all 8 items (incl. Green Tea, Earl Grey, Croissant, Muffin) still shown. Repeat for Tea and Pastry.
- Expected vs Actual: Expected Coffee to show only coffee items; actual shows all 8 items, and "All" remains highlighted.
- Confidence: high

### Bug 6: Cart badge shows "[object Object]" + wrong count
- Difficulty: medium
- Found via: [interaction] + [visual]
- Location: Cart button / count badge in the header controls row.
- Description: After adding 3 distinct items (Green Tea, Cappuccino, Butter Croissant — each qty 1, confirmed in the open cart), the cart badge/button reads "Cart [object Object]11" (cairn tree) / "Cart [object Object]1" (visual). A JS object is being stringified into the UI ("[object Object]") and the numeric count is wrong (should be 3).
- Reproduce: Add 3 different items to cart; read the Cart button text.
- Expected vs Actual: Expected badge "3"; actual "[object Object]11" (object leak + incorrect count).
- Confidence: high

### Bug 7: Cart Total shows raw floating-point value ($10.152000000000001)
- Difficulty: hard
- Found via: [visual]
- Location: Cart summary panel — Subtotal / Tax (8%) / Total lines.
- Description: With 3 items (subtotal $9.40), the Total displays as "$10.152000000000001" — an unrounded raw JS float. The Tax line is shown rounded as "$0.75", but the Total is computed from the UNROUNDED tax (9.40 + 0.752 = 10.152000000000001) and never formatted. This is both a formatting defect and an internal inconsistency (Tax rounded, Total uses unrounded tax).
- Reproduce: Add items totaling $9.40; open cart; scroll to totals.
- Expected vs Actual: Expected Total "$10.15"; actual "$10.152000000000001".
- Confidence: high

### Bug 8: Coupon field gives no feedback on invalid code
- Difficulty: medium
- Found via: [interaction] + [visual]
- Location: Coupon code input + Apply button (inside cart panel).
- Description: Applying an invalid code ("WRONGCODE") produces NO error message — no "invalid coupon" / red text appears anywhere in the cart (confirmed via vision + accessibility tree grep). The coupon field gives zero user feedback on failure.
- Reproduce: Open cart; type "WRONGCODE" in coupon field; click Apply.
- Expected vs Actual: Expected an "invalid code" error message; actual no feedback at all.
- Confidence: high

### Bug 9: Valid coupon "SUNNET10" does not apply any discount
- Difficulty: hard
- Found via: [interaction] + [visual]
- Location: Coupon field / cart totals.
- Description: Applying the real coupon code "SUNNET10" produces no success message, no discount line, and the Total stays at $10.152000000000001 (unchanged). A 10% discount should reduce the $9.40 subtotal to $8.46 and the total to ~$9.14. The coupon system appears entirely non-functional.
- Reproduce: Open cart; type "SUNNET10"; click Apply; observe totals.
- Expected vs Actual: Expected discount applied + total ~$9.14; actual no change, no message.
- Confidence: high

### Bug 10: Quantity "+" button does not update cart totals
- Difficulty: hard
- Found via: [interaction] + [visual]
- Location: Cart item quantity +/- controls + cart totals.
- Description: Clicking "+" on Green Tea did NOT change Subtotal ($9.40), Tax ($0.75), or Total ($10.152000000000001). Expected with qty 2: subtotal $11.60, tax $0.928, total $12.528. (I could not see the quantity number itself after scrolling the checkout into view, so I cannot confirm whether the qty incremented but totals failed to recompute, or the qty didn't increment at all — either way the totals are wrong.)
- Reproduce: Open cart; click "+" on an item; observe totals.
- Expected vs Actual: Expected totals to increase; actual totals unchanged.
- Confidence: medium

### Bug 11: Dark mode toggle does not apply to page content
- Difficulty: medium
- Found via: [interaction] + [visual]
- Location: Dark Mode toggle button + entire page body.
- Description: Clicking "🌙 Dark Mode" flips the button label to "☀️ Light Mode" (state toggles) but the page body, hero banner, menu cards, contact section, and footer ALL remain light cream/white. Only the header (already dark brown in light mode) appears dark. Dark mode is not actually applied to the content area.
- Reproduce: Click "🌙 Dark Mode"; screenshot; compare colors.
- Expected vs Actual: Expected full dark theme (dark backgrounds, light text) across the page; actual only the header is dark, rest stays light.
- Confidence: high

### Bug 12: Checkout throws JS error and does nothing
- Difficulty: hard
- Found via: [console-error] + [interaction] + [visual]
- Location: Checkout button (bottom of cart panel).
- Description: Clicking Checkout throws a console error "Reduce of empty array with no initial value" (captured via `cairn click e121 --trace`) and produces NO visible effect — no order-confirmation message, the cart is not cleared, items and totals remain. Checkout is non-functional.
- Reproduce: Add items to cart; open cart; click Checkout (with trace enabled).
- Expected vs Actual: Expected an order confirmation / cart cleared; actual console error + nothing happens.
- Confidence: high

### Bug 13: Contact form accepts invalid email "foo@bar"
- Difficulty: medium
- Found via: [interaction] + [console-error]
- Location: Contact form ("Get in touch") — Email field + Send Message button.
- Description: Submitting the contact form with email "foo@bar" (no valid TLD / invalid email) is ACCEPTED and shows the success message "Message sent! We'll get back to you soon." (confirmed via trace: the paragraph was added with no error). No email validation occurs.
- Reproduce: Fill Name="Test User", Email="foo@bar", Message="Hello"; click Send Message.
- Expected vs Actual: Expected a validation error rejecting "foo@bar"; actual success message shown.
- Confidence: high

### Bug 14: Cart overlay cannot be dismissed (close × / Escape fail) and blocks the page
- Difficulty: medium
- Found via: [interaction]
- Location: Cart panel close (×) button + cart overlay (`#cartOverlay`).
- Description: Once the cart is open, the overlay intercepts pointer events on elements behind it (cairn trace reported `<div id="cartOverlay" class="cart-overlay open"> intercepts pointer events` when clicking the contact form's Send Message button). The close (×) button click timed out, and pressing Escape did not close the cart — the overlay remained open and continued blocking the contact form. (Possible false positive: could be a cairn interaction artifact rather than a true site bug, but two dismissal methods failing is suspicious.)
- Reproduce: Add items; open cart; click × and/or press Escape; try to click an element behind the cart.
- Expected vs Actual: Expected cart to close on ×/Escape; actual cart stays open and blocks background elements.
- Confidence: medium

## Notes

- **Possible false positives / lower confidence:** Bug 10 (quantity) and Bug 14 (cart dismiss) are my two lower-confidence findings. For Bug 10 I could not see the quantity digit after scrolling the checkout into view, so I report the observable symptom (totals unchanged) rather than root cause. For Bug 14, the close-button timeout could be a cairn interaction quirk, though the Escape key also failing and the explicit "intercepts pointer events" trace message support it being real.
- **Features not fully tested due to step budget:** I did not click "View Today's Specials" (the hero CTA). From the initial vision pass it appears visually distinct (blue vs the orange other buttons), so it is likely correctly styled, but its click behavior was not verified. I also did not test the quantity "−" button going to/negative, empty-cart checkout, or the empty-coupon Apply case (the empty case would likely show the same no-feedback behavior as Bug 8).
- **Cairn tool observations:** cairn's accessibility tree (`look`) did not surface the cart overlay's text nodes (Subtotal/Tax/Total) even though the cart was visually open — only the cart's interactive buttons (×, +/−, Remove, Apply, Checkout) appeared via `look -i`. I therefore relied on `look --visual` screenshots + prompt_vision to read the cart's dollar values. The `--trace` flag was valuable: it captured the checkout JS error and confirmed the contact-form success message appeared. The `--visual` screenshots include numbered annotation boxes over interactive elements, which occasionally sat over text; I mitigated this by scrolling elements into view and asking vision targeted questions.
- **Cart badge count discrepancy:** cairn's tree reported the badge as "[object Object]11" while one vision pass read "[object Object]1"; the cart button text on click showed "Cart [object Object]11". The exact trailing digits are unstable/wrong in any case — the "[object Object]" leak and the count not matching the 3 items in the cart are the reliable defects.
- All findings were discovered purely through the cairn browser (navigation/interaction/screenshots/trace) and prompt_vision on screenshots. No source, style, script, log, or markdown file was read.
