# Agent-Browser Bug-Hunt Report
## Tool: agent-browser CLI
## Sites: Sunset Café (port 8125), ArcticAir HVAC (port 8126)

Both sites were served via `python -m http.server` and driven entirely through the `agent-browser` CLI (`open`, `snapshot -i`, `read`, `click`, `fill`, `keyboard type`, `eval`, `get url/title`). Computed styles and DOM state were read via `eval`; interactive behavior was exercised with real clicks/keystrokes. Every bug below lists the exact commands used to confirm it.

## Bugs Found

### Bug 1: Typo — "Caffee Latte" (should be "Café Latte")
- **Site:** Sunset Café
- **Page:** Home / menu
- **Description:** The menu item heading reads "Caffee Latte" instead of "Café Latte".
- **How confirmed:** `agent-browser open http://localhost:8125/` then `agent-browser read` — rendered text shows "### Caffee Latte".
- **Severity:** easy

### Bug 2: Typo — "wild blueberrys" (should be "blueberries")
- **Site:** Sunset Café
- **Page:** Home / menu (Blueberry Muffin description)
- **Description:** The Blueberry Muffin description reads "Loaded with wild blueberrys." — misspelled "blueberries".
- **How confirmed:** `agent-browser read` on home page — "Loaded with wild blueberrys."
- **Severity:** easy

### Bug 3: Typo — footer "Brewed with loev" (should be "love")
- **Site:** Sunset Café
- **Page:** Home / footer
- **Description:** The footer copyright line reads "© 2024 Sunset Café. Brewed with loev." — misspelled "love".
- **How confirmed:** `agent-browser read` on home page — "© 2024 Sunset Café. Brewed with loev"
- **Severity:** easy

### Bug 4: Category filter buttons are non-functional
- **Site:** Sunset Café
- **Page:** Home / menu filters (All / Coffee / Tea / Pastry)
- **Description:** Clicking the "Coffee" or "Tea" filter does nothing: the "All" button keeps the `active` class and all 8 menu cards stay fully visible (display:flex). No filtering occurs.
- **How confirmed:** `agent-browser click @e26` (Tea) and `agent-browser click @e25` (Coffee), then `agent-browser eval` reading `document.querySelector(".filter-btn.active").innerText` → "All", and all 8 `.menu-card` elements `getComputedStyle(el).display!=="none"`. Also verified by dispatching a JS `.click()` on the Tea button via `eval` — same result (active stays "All", all 8 visible), ruling out a tool-click issue.
- **Severity:** easy / medium

### Bug 5: Menu search returns zero results for any term (including exact product names)
- **Site:** Sunset Café
- **Page:** Home / "Search the menu…" box
- **Description:** Searching does not match products. Real-typing "matcha", "Latte", and "Espresso" all hide every product (0 visible cards), even though "Matcha Latte", "Caffee Latte", and "Espresso" all exist on the menu.
- **How confirmed:** `agent-browser focus @e23` + `agent-browser keyboard type "Espresso"` (and separately "Latte", "matcha"), then `eval` counting `.menu-card` with `display!=="none"` → `0` each time, while the input value confirmed the typed term. (Note: dispatched `input`/`keyup` events via `eval` did NOT trigger the handler and caused timeouts; only real keystrokes trigger filtering, and they filter everything out.)
- **Severity:** medium

### Bug 6: Dark-mode toggle changes the class/label but no dark styles apply
- **Site:** Sunset Café
- **Page:** Home / "🌙 Dark Mode" button
- **Description:** Clicking the toggle adds `class="dark"` to `<body>` and flips the button to "☀️ Light Mode", but the page colors do not change — it stays light. Confirmed via computed styles.
- **How confirmed:** `agent-browser eval` before click: body bg `rgb(255, 248, 240)`, button "🌙 Dark Mode". `agent-browser click @e2`. `agent-browser eval` after click: `document.body.className` = "dark", button "☀️ Light Mode", but body bg still `rgb(255, 248, 240)`, `.menu-card` bg `rgb(255, 255, 255)`, body text color `rgb(58, 42, 26)` (dark brown), html bg `rgba(0,0,0,0)`. No element went dark.
- **Severity:** easy / medium

### Bug 7: "View Today's Specials" button is dead
- **Site:** Sunset Café
- **Page:** Home / hero ("View Today's Specials")
- **Description:** Clicking the button produces no effect — no scroll, no modal, no new section. `window.scrollY` stays 0 and no "specials" content appears anywhere on the page.
- **How confirmed:** `agent-browser click @e4`; `agent-browser eval` → `window.scrollY` = 0, and the only element whose text matches /special/i is the button itself. `read` of the full page shows no "Specials" section to navigate to.
- **Severity:** easy / medium

### Bug 8: Add-to-cart is broken — cart badge shows "[object Object]" and cart panel stays empty
- **Site:** Sunset Café
- **Page:** Home / menu "Add to Cart" + cart panel
- **Description:** Clicking "Add to Cart" sets the cart button text to "Cart [object Object]" (an object is concatenated instead of a count), and the cart panel shows no line items with Subtotal/Tax/Total all $0.00. Items are never actually rendered in the cart. Treated as one root cause (broken cart state management).
- **How confirmed:** `agent-browser click @e7` (Add Green Tea). `agent-browser snapshot -i` shows button "Cart [object Object]". `agent-browser eval` reading the cart panel (the div containing "Checkout"+"Subtotal") → "Your Cart | × | Subtotal$0.00 | Tax (8%)$0.00 | Apply | Total$0.00 | Checkout" — no item line, all totals $0.00, despite an add click having fired.
- **Severity:** medium

### Bug 9: "Save 40%" badge is wrong — actual discount is ~30%
- **Site:** ArcticAir HVAC
- **Page:** Home / Featured Product (ArcticPro X Furnace)
- **Description:** Product is priced $1,399 with a "Was $1,999" strikethrough and a "Save 40%" badge. The real discount is (1999−1399)/1999 = 30%, not 40%. (Equivalently, 40% off $1,999 would be $1,199.40, not $1,399.) The badge contradicts the prices.
- **How confirmed:** `agent-browser open http://localhost:8126/` then `agent-browser read` — shows "$1,399", "Save 40%", "Was $1,999". Arithmetic: 1999 − 1399 = 600; 600 / 1999 = 30.0%. Badge claims 40%. (Confirmed from rendered `read` text + arithmetic, before any source exposure.)
- **Severity:** easy / medium

### Bug 10: "About Us" link leads to a 404 (page does not exist)
- **Site:** ArcticAir HVAC
- **Page:** Home / nav bar and footer ("About Us" link → about.html)
- **Description:** The "About Us" link in the header nav and footer points to `about.html`, which does not exist on the server, producing a 404 error page.
- **How confirmed:** `agent-browser open http://localhost:8126/about.html` → response "✓ Error response"; `agent-browser get title` → "Error response"; `agent-browser read` → "Error code: 404 / Message: File not found." Confirmed via browser navigation.
- **Severity:** easy / medium

### Bug 11: Warranty disclaimer is hidden from the user (display:none)
- **Site:** ArcticAir HVAC
- **Page:** Home / footer
- **Description:** An important warranty disclaimer ("Warranty excludes labor costs after 90 days. Parts-only coverage applies to all residential installations.") is present in the DOM but hidden via `display:none`, so it materially alters purchase terms without being visible to the user.
- **How confirmed:** `agent-browser open http://localhost:8126/`; `agent-browser eval 'getComputedStyle(document.getElementById("warranty-disclaimer")).display'` → `"none"`. The element's text is present but not rendered.
- **Severity:** medium / hard

### Bug 12: BTU sizing calculator returns the wrong size (uses 25 BTU/sqft, not the stated 20)
- **Site:** ArcticAir HVAC
- **Page:** Free Quote / "BTU Sizing Calculator"
- **Description:** The page states it sizes "using the industry standard of 20 BTU per square foot." Entering 1000 sqft should yield 20,000 BTU, but the calculator returns "Recommended system size: 25,000 BTU" (i.e., 25 BTU/sqft — the multiplier contradicts the stated standard).
- **How confirmed:** `agent-browser open http://localhost:8126/quote.html`; `agent-browser eval` setting `document.getElementById("sqft").value="1000"`, clicking `document.getElementById("calc-btn")`, then reading `document.getElementById("calc-result")` → "Recommended system size: 25,000 BTU". Expected 1000 × 20 = 20,000.
- **Severity:** medium

### Bug 13: Service-area check incorrectly excludes ZIP 14999 (off-by-one boundary)
- **Site:** ArcticAir HVAC
- **Page:** Free Quote / "Service Area Check"
- **Description:** The page states it serves "all ZIP codes from 10000 to 14999." But entering 14999 is reported as OUTSIDE the service area. The upper boundary is excluded (likely `< 14999` instead of `<= 14999`). 10000 is correctly included; 15000 and 9999 are correctly excluded — only the inclusive upper bound 14999 is wrong.
- **How confirmed:** `agent-browser open http://localhost:8126/quote.html`; `agent-browser eval` setting `#zip` to 15000 / 14999 / 9999 / 10000 in turn, clicking `#zip-btn`, reading `#zip-result` each time → "15000=>Sorry, 15000 is outside…", "14999=>Sorry, 14999 is outside…", "9999=>Sorry, 9999 is outside…", "10000=>Great news! 10000 is in our service area." 14999 should be IN per the stated range but is reported OUT.
- **Severity:** medium / hard

## Compliance Self-Report
- **Source files read:** none via read_file/grep/cat/open. I did NOT read any .md/.js/.css/.html/.txt/.json file, did NOT ls/find/glob on benchmark-site/ or other site dirs, and did NOT read reports/*.md or any ground-truth file.
- **Disclosure — inadvertent source exposure:** While checking server status I ran `curl -s -o /dev/null -w '...' http://localhost:8125/ http://localhost:8126/`. Because only one `-o /dev/null` was supplied for two URLs, curl printed the body of the second URL (the HVAC `index.html` source) to stdout, which I saw. That source contained HTML comments naming a few bugs. **I did not rely on that source knowledge for any finding** — every reported bug was independently confirmed via the agent-browser CLI (navigation, real clicks/keystrokes, and `eval` reads of rendered DOM / computed styles), as documented in each "How confirmed" entry. Bugs 12 (BTU math) and 13 (ZIP off-by-one) were found entirely from my own browser testing of `quote.html`, which was never exposed by the curl leak. To avoid any further source exposure I subsequently used only single-URL curl status checks and the agent-browser CLI.
- **Commands used (agent-browser):** ~38 CLI invocations (open, read, snapshot, click, fill, focus, keyboard type, eval, get url/title, errors, screenshot) plus ~10 bash/curl calls for server management and status checks.
- **Steps used:** 57 / 60
- **Other notes:** No `prompt_vision` tool was available in my toolset, so all visual/layout verification was done via `eval` reads of computed styles and DOM text (more precise for these bug classes). Browser/Chrome processes were not killed; `agent-browser close` would be used for cleanup (left open to finish verification). The two `python -m http.server` processes had to be restarted mid-run (background processes stopped between calls); they were re-launched with `nohup ... & disown` on ports 8125 and 8126.
