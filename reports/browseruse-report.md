# Browser-Use Bug-Hunt Report
## Tool: browser-use (Playwright/CDP via Python, manual control)
## Sites: Sunset Café (port 8127), ArcticAir HVAC (port 8128)

**Method:** Drove a dedicated headless Chromium (browser-use's bundled `chrome-headless-shell`) over the Chrome DevTools Protocol using browser-use's own `cdp_use` CDP client (Python, async). For each check I created a browser tab (`Target.createTarget`), enabled `Page`/`Runtime` domains, ran JavaScript via `Runtime.evaluate` to read DOM text, computed styles, and fire synthetic `.click()`/`input`/`change` events, then read back resulting state. All findings below are confirmed through this browser channel only (no source files read).

---

## Bugs Found

### Bug 1: Menu item typo "Caffee Latte"
- **Site:** Sunset Café
- **Page:** Home / menu grid
- **Description:** The latte menu item is spelled "Caffee Latte" (should be "Caffè Latte" / "Café Latte").
- **How confirmed:** `Runtime.evaluate("document.body.innerText")` on http://localhost:8127/ returned the menu list containing `Caffee Latte` (price $4.50). Confirmed verbatim in page body text.
- **Severity:** easy

### Bug 2: Description typo "wild blueberrys"
- **Site:** Sunset Café
- **Page:** Home / Blueberry Muffin menu card
- **Description:** Blueberry Muffin description reads "Loaded with wild blueberrys." — should be "blueberries".
- **How confirmed:** `document.body.innerText` on http://localhost:8127/ returns `Blueberry Muffin ... Loaded with wild blueberrys.` Read directly from rendered page text.
- **Severity:** easy

### Bug 3: Footer typo "Brewed with loev"
- **Site:** Sunset Café
- **Page:** Home / footer
- **Description:** Footer copyright reads "© 2024 Sunset Café. Brewed with loev." — "loev" should be "love".
- **How confirmed:** `document.body.innerText` on http://localhost:8127/ ends with `© 2024 Sunset Café. Brewed with loev.` Read directly from rendered footer text.
- **Severity:** easy

### Bug 4: Category filters do nothing (Coffee/Tea/Pastry all show every item)
- **Site:** Sunset Café
- **Page:** Home / category filter buttons
- **Description:** Clicking Coffee, Tea, or Pastry does not filter the menu — all 8 items remain visible for every category (same as "All"). Filtering is non-functional.
- **How confirmed:** For each of `All/Coffee/Tea/Pastry`, clicked the matching `.filter-btn` via `el.click()`, then read visible items with `[...document.querySelectorAll('.add-btn')].filter(b=>{let it=b.parentElement; return it.offsetParent!==null && getComputedStyle(it).display!=='none';}).map(...name...)`. Result for every filter was identical: `Green Tea, Caffee Latte, Cappuccino, Earl Grey, Espresso, Butter Croissant, Blueberry Muffin, Matcha Latte`. (All 8 menu cards also carry `data-category=NONE`, so categories are never matched.)
- **Severity:** medium

### Bug 5: Search returns empty for every query (including valid matches)
- **Site:** Sunset Café
- **Page:** Home / search box (`#searchInput`)
- **Description:** Typing any search term hides all menu items, even when the term should match (e.g. "latte" should match Caffee Latte & Matcha Latte). Search is broken — it returns zero results for everything.
- **How confirmed:** Set `#searchInput.value` and dispatched an `input` event for `latte, tea, espresso, croissant, muffin, xyz, caffee`; after each, read visible item names (same visibility query as Bug 4). Every query — including valid ones like `latte` and `caffee` — returned an empty list. (The handler did fire, because items went from all-visible to hidden, so this is a matching-logic defect, not a missed event.)
- **Severity:** medium

### Bug 6: "Add to Cart" does not add anything
- **Site:** Sunset Café
- **Page:** Home / menu cards + cart
- **Description:** Clicking "Add to Cart" on menu items has no effect — the cart count stays 0 and the cart panel stays empty.
- **How confirmed:** Clicked `.add-btn` at index 0 twice and index 2 once (`document.querySelectorAll('.add-btn')[0].click()` etc.), then opened the cart (`#cartBtn.click()`). Read: `#cartBtn.innerText` = `Cart 0`; `#cartItems.innerText` = `Your cart is empty.`; `#subtotalEl`/`#taxEl` = `$0.00`; total = `$0`. Subtotal/tax/total never changed from $0.
- **Severity:** medium

### Bug 7: Dark-mode toggle changes its label but does not change any colors
- **Site:** Sunset Café
- **Page:** Home / `#darkToggle`
- **Description:** Clicking the dark-mode toggle updates the button text from "🌙 Dark Mode" to "☀️ Light Mode", but the page background/text colors do not change at all (no dark theme applied). The toggle is cosmetic only.
- **How confirmed:** Read `getComputedStyle(document.body).backgroundColor` and `.color` before click = `rgb(255, 248, 240)` / `rgb(58, 42, 26)`. Clicked `#darkToggle`. After click: button `innerText` = `☀️ Light Mode`, but body bg = `rgb(255, 248, 240)` and color = `rgb(58, 42, 26)` — unchanged; button `className` stayed `dark-toggle` (no active/dark class added). Clicking again returned the label but bg remained `rgb(255, 248, 240)`.
- **Severity:** medium

### Bug 8: "About Us" nav link is a dead 404
- **Site:** ArcticAir HVAC
- **Page:** Navigation (present on every page) → about.html
- **Description:** The "About Us" navigation link points to `about.html`, which does not exist — the server returns a 404 "File not found" error page.
- **How confirmed:** From the home page, `document.querySelectorAll('a')` returned `About Us->about.html`. Navigating the tab to `http://localhost:8128/about.html` (via `Page.navigate`) loaded a page whose `document.title` = `Error response` and `document.body.innerText` = `Error response / Error code: 404 / Message: File not found. / 404 - Nothing matches the given URI.`
- **Severity:** easy

### Bug 9: Featured-product discount math is wrong ("Save 40%" ≠ $1,399)
- **Site:** ArcticAir HVAC
- **Page:** Home / "Featured Product" card
- **Description:** The ArcticPro X Furnace is shown as "$1,399 Save 40% Was $1,999". 40% off $1,999 is $1,199.40, not $1,399. $1,399 is only ~30% off $1,999 (1999 × 0.70 ≈ 1399). The discount percentage is inconsistent with the prices shown.
- **How confirmed:** `document.body.innerText` on http://localhost:8128/ home page contains `ArcticPro X High-Efficiency Furnace ... $1,399 Save 40% Was $1,999`. Arithmetic check: 1999 − 1399 = 600; 600 / 1999 = 30.0%, not 40%.
- **Severity:** medium

### Bug 10: Products page tells users to "Use the filter" but no filter exists
- **Site:** ArcticAir HVAC
- **Page:** Products (products.html)
- **Description:** The products page copy says "Use the filter to narrow by category," but there is no filter control (no select, no buttons, no search input) anywhere on the page. The referenced feature is missing.
- **How confirmed:** On products.html, `document.body.innerText` contains `Use the filter to narrow by category.` Ran `document.querySelectorAll('input,select,button,.filter,[class*=filter]')` → returned an empty list (no interactive/filter elements on the page at all).
- **Severity:** medium

### Bug 11: BTU calculator uses 25 BTU/sqft but the page says 20 BTU/sqft
- **Site:** ArcticAir HVAC
- **Page:** Quote (quote.html) / "BTU Sizing Calculator"
- **Description:** The page states it sizes "using the industry standard of 20 BTU per square foot," but the calculator actually multiplies square footage by 25. 1000 sqft returns 25,000 BTU (should be 20,000); 2000 sqft returns 50,000 (should be 40,000); 2500 returns 62,500 (should be 50,000). The stated formula and the computed result disagree.
- **How confirmed:** On quote.html, set `#sqft.value` and clicked `#calc-btn`, then read the result element. Observed: 1000 → `Recommended system size: 25,000 BTU`; 2000 → `50,000 BTU`; 2500 → `62,500 BTU` (all = sqft × 25). Page body text (same page) reads `20 BTU per square foot`. (Negative/zero/non-numeric correctly show "Please enter a valid square footage.")
- **Severity:** medium

### Bug 12: ZIP "Service Area Check" is mis-wired (runs the square-footage validator)
- **Site:** ArcticAir HVAC
- **Page:** Quote (quote.html) / "Service Area Check"
- **Description:** The "Check Service Area" button (for ZIP codes 10000–14999) does not check the ZIP — instead it always shows the square-footage calculator's error message "Please enter a valid square footage.", regardless of the ZIP entered. The ZIP checker is non-functional / wired to the wrong handler.
- **How confirmed:** On quote.html, set `#zip.value` to `9999, 10000, 12500, 14999, 15000, 20000, abc` and clicked `#zip-btn` for each, then read the result element. Every value returned `result error | Please enter a valid square footage.` — a square-footage error for a ZIP input, including for in-range ZIPs (10000/12500/14999) that should be served.
- **Severity:** medium

### Bug 13: Services "Repair" tab does not switch its content panel
- **Site:** ArcticAir HVAC
- **Page:** Services (services.html) / Installation·Repair·Maintenance tabs
- **Description:** Clicking the "Repair" tab marks it active (gets the `active` class) but does not reveal the Repair content — the Installation panel stays visible and the Repair panel stays `display:none`. (The Maintenance tab works correctly.) Tabs are partially broken.
- **How confirmed:** On services.html, clicked `.tab-btn` "Repair". After click: tab classes = `Installation:, Repair:tab-btn active, Maintenance:` (Repair is active). Inspected all `.tab-panel` elements: `DIV.tab-panel active disp=block txt=Furnace & AC Installation...` (Installation still shown) and `DIV.tab-panel disp=none txt=Repair Services 24/7 emergency repair...` (Repair panel hidden). Body still showed Installation content, and `document.body.innerText.includes('emergency air conditioning')` = `false`. For comparison, clicking "Maintenance" correctly set the Maintenance panel to `disp=block` and body then included `tune-up`/`priority scheduling` = `true`.
- **Severity:** medium

### Bug 14: Contact form accepts an empty submission as "sent" (no validation)
- **Site:** ArcticAir HVAC
- **Page:** Contact (contact.html) / "Send Message"
- **Description:** The contact form has no required-field validation. Submitting with all fields completely empty still displays the success message "✓ Your message has been sent!" — as if a valid message were sent.
- **How confirmed:** On contact.html, cleared all inputs (`value=''`), then clicked the "Send Message" button. Read `#result`/`.result` (`form-status.result`): `form-status.result ok=[✓ Your message has been sent!]` and body tail contained `✓ Your message has been sent!`. Repeated with filled valid fields — same success message (so the form does submit), but the empty case also succeeds, confirming missing validation.
- **Severity:** medium

### Bug 15: "Schedule Service" button clears the form instead of scheduling
- **Site:** ArcticAir HVAC
- **Page:** Contact (contact.html) / `#schedule-btn`
- **Description:** The "Schedule Service" button does not initiate scheduling — clicking it clears the contact form and shows an error-styled "Form cleared." message. The button performs an unexpected/wrong action.
- **How confirmed:** On contact.html, clicked `#schedule-btn` (innerText `Schedule Service`). Read the result element: `result error | Form cleared.` (the message appeared under the `error` result class). The labeled action (schedule) did not occur; instead the form was cleared.
- **Severity:** medium

---

## Compliance Self-Report
- **Source files read:** No benchmark-site source files were read. I did NOT cat/grep/open/read_file any file ending `.md`/`.js`/`.css`/`.html`/`.txt`/`.json` anywhere in the workspace. To learn the browser-use API, I inspected only the tool's own installed Python library source under site-packages (`browser_use/...py`, `cdp_use/...py`) — these are `.py` tooling files, not benchmark-site source, and were used solely to drive the browser. No `reports/*.md` or ground-truth file was read.
- **`ls`/`find`/`glob` on benchmark-site/, testt/, hvac-demo/, scripts/:** None. (I `cd`'d into `benchmark-site/sunset` and `benchmark-site/hvac` only to launch the `python -m http.server` instances, and used `--directory` thereafter; I never listed or read their contents.)
- **Browser/Chrome processes killed:** None. I launched my own dedicated headless Chromium on port 9477 for testing and did not kill any other browser/Chrome process.
- **Sites modified:** None — read-only investigation; no files written or site state changed (the only write target was this report).
- **Commands used (bash tool calls):** ~24
- **Steps used:** ~53
