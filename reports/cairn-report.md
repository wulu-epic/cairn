# Cairn Bug-Hunt Report
## Tool: cairn CLI
## Sites: Sunset Café (port 8123), ArcticAir HVAC (port 8124)

## Bugs Found

### Bug 1: "Caffee Latte" misspelled menu item
- **Site:** Sunset Café
- **Page:** Home / menu (item card)
- **Description:** A menu item is titled "Caffee Latte". The correct spelling is "Caffè Latte" (or "Café Latte"). The misspelling "Caffee" is visible to users.
- **How confirmed:** `cairn goto "http://localhost:8123/" --session sunset` then `cairn look --session sunset`. Page model showed `heading "Caffee Latte" [ref=e28]` with price `$4.50` [ref=e29] and description "Smooth espresso with steamed milk." Re-confirmed on a later reload via `cairn goto "http://localhost:8123/" --session hvac` (captured to /tmp/g.txt): `heading "Caffee Latte" [ref=e28]`.
- **Severity:** easy

### Bug 2: "wild blueberrys" misspelled description
- **Site:** Sunset Café
- **Page:** Home / menu (Blueberry Muffin card)
- **Description:** The Blueberry Muffin description reads "Loaded with wild blueberrys." The correct plural is "blueberries" (not "blueberrys").
- **How confirmed:** `cairn look --session sunset` and `cairn look --session sunset --include-hidden` both showed `paragraph "Loaded with wild blueberrys." [ref=e55]` under `heading "Blueberry Muffin" [ref=e53]` ($2.90). Re-confirmed via reload capture /tmp/g.txt.
- **Severity:** easy

### Bug 3: Footer copyright typo "Brewed with loev."
- **Site:** Sunset Café
- **Page:** Home / footer (all views)
- **Description:** The footer copyright reads "© 2024 Sunset Café. Brewed with loev." — "loev" should be "love".
- **How confirmed:** `cairn look --session sunset` showed `paragraph "© 2024 Sunset Café. Brewed with loev." [ref=e74]` inside the `contentinfo` [ref=e73] footer. Re-confirmed with `--include-hidden` and via reload capture /tmp/g.txt.
- **Severity:** easy

### Bug 4: Featured product "Save 40%" discount math is wrong (actually ~30%)
- **Site:** ArcticAir HVAC
- **Page:** Home / "Featured Product" (ArcticPro X High-Efficiency Furnace)
- **Description:** The featured product shows "Was $1,999", now "$1,399", with a badge "Save 40%". The actual discount is $1,999 − $1,399 = $600, which is 600/1999 = **30.0%** off — not 40%. (40% off $1,999 would be $1,199.40.) The "Save 40%" label overstates the discount.
- **How confirmed:** `cairn goto "http://localhost:8124/" --session hvac` returned the page model showing `generic "$1,399" [ref=e35]`, `generic "Save 40%" [ref=e36]`, `generic "Was $1,999" [ref=e37]` under heading "ArcticPro X High-Efficiency Furnace" [ref=e32]. Math verified: $600 savings / $1,999 original = 30.0%.
- **Severity:** medium

### Bug 5: "About Us" navigation link leads to a 404 (page missing)
- **Site:** ArcticAir HVAC
- **Page:** Every page's top nav (and footer) — "About Us" link
- **Description:** The "About Us" link in the main navigation (present on every page: Home, Services, Products, Free Quote, Contact) navigates to `/about.html`, which returns a 404 "File not found" error page. The About Us page does not exist. There is also an "About Us" link in every footer.
- **How confirmed:** `cairn goto "http://localhost:8124/about.html" --session hvac` returned a raw "Error response" page with `paragraph "Error code: 404"`, `paragraph "Message: File not found."`, 0 interactive elements. Then confirmed the actual nav target: from home, `cairn click e10 --session hvac` (the "About Us" nav link) produced `navigated: http://localhost:8124/ → http://localhost:8124/about.html` and the diff showed `heading "Error response"`, `paragraph "Error code: 404"`. All other pages (services.html, products.html, quote.html, contact.html) return 200, so /about.html is the one missing file.
- **Severity:** medium

### Bug 6: Contact "Our Office" address and hours run together (missing separator)
- **Site:** ArcticAir HVAC
- **Page:** Contact / "Our Office" section
- **Description:** The "Our Office" section renders the address and business hours as a single run-on string with no separator between them: "1200 Commerce St, Metro CityMon–Fri 7am–7pm · Sat 8am–4pm". "Metro City" and "Mon–Fri" are jammed together ("Metro CityMon–Fri") with no line break, comma, or middot — the address and the hours need a separator.
- **How confirmed:** `cairn goto "http://localhost:8124/contact.html" --session hvac` returned the page model showing `heading "Our Office" [ref=e30]` followed by `paragraph "1200 Commerce St, Metro CityMon–Fri 7am–7pm · Sat 8am–4pm" [ref=e31]` as a single paragraph node. Re-confirmed on a second load (capture /tmp/ct.txt): same single-paragraph string with "Metro CityMon–Fri" run together.
- **Severity:** medium

## Compliance Self-Report
- **Source files read:** none. I did NOT cat/grep/open/read_file any `.md`/`.js`/`.css`/`.html`/`.txt`/`.json` site source files anywhere in the workspace, and did NOT read `reports/*.md` or `scripts/benchmark-ground-truth.md`. All page content was obtained solely through the cairn browser CLI (`goto`/`look`/`click`/`query`/`extract`) and the tool's own printed page models. The `/tmp/*.txt` files I `cat`-ed were captures of cairn's own stdout (page-model output), not site source.
- **Minor deviation (self-reported):** To locate screenshot files for visual verification I ran `find . -maxdepth 2 -iname "*.png"` from the project root. This was not targeted at a forbidden directory, but the recursive find did traverse and *list* file paths inside `testt/` (e.g. `./testt/cart_badge.png`). I did NOT open, read, or `prompt_vision` any of those files — only their paths were enumerated. No `ls`/`find`/`glob` was run against `benchmark-site/`, `hvac-demo/`, or `scripts/`, and no `.json` model/source files were opened.
- **Commands used:** ~30 cairn CLI commands (goto ×~12, look ×~6, click ×~5, release ×3, type ×3, query ×1, extract ×1, status ×1, --help ×2), plus ~12 shell utility commands (curl, ls, find, cat, tasklist) for server/ process checks and output capture.
- **Steps used:** ~52

### Tooling notes (not bugs — environmental constraints)
- On this machine `cairn` could not connect via CDP (`connectOverCDP failed… falling back to chromium.launch()` on every invocation), so each command launched a fresh Chrome. Timed-out commands orphaned those Chrome processes (count reached ~64), and I was instructed NOT to kill Chrome processes, so I could not clean them up. As the pileup grew, page-evaluating commands (`look`, `query`, `extract`, `type`, in-page `click`, and `goto --visual`) began to hang reliably. Only bare `cairn goto` and navigation-link `click` (which return a page tree / navigation diff) remained reliable. Consequently I was able to fully read all static page content on both sites (every page of each site was loaded and its content tree inspected) but could NOT exercise in-page interactions — cart add/qty/remove math, coupon, checkout, dark-mode toggle, category/search filters, the BTU & ZIP calculators, FAQ accordions, and the services tab switcher could not be verified because every attempt to read the post-interaction state hung. The "Schedule Service" second button on the HVAC contact form was clicked but its effect could not be observed (hung), so it is NOT reported as a bug (no confirmation). Only the 6 bugs above were confirmed through the browser.
