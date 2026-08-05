# Cairn — Advanced Patterns

Reference doc loaded as needed. The main `SKILL.md` covers the core workflow; this covers the deeper patterns.

## Table of Contents

1. [Vision-fallback decision tree](#vision-fallback-decision-tree)
2. [NL goto — grounding internals + click-to-reveal](#nl-goto--grounding-internals--click-to-reveal)
3. [Region focus strategy](#region-focus-strategy)
4. [Delta interpretation](#delta-interpretation)
5. [Steel backend usage](#steel-backend-usage)
6. [Session management](#session-management)

---

## Vision-fallback decision tree

The structured page model is the default — it's fast, cheap, and precise. Pull in a marked screenshot (`cairn look --visual`) only when the structured model is insufficient.

```
Is the target a normal DOM element (button, link, input, div)?
├── YES → use the structured model (cairn goto / look). Done.
└── NO / UNSURE → did `look` show a media-rich warning?
    ├── YES (canvas/WebGL/shadow-DOM detected) → cairn look --visual
    │     → view the marked screenshot → act by the SAME ref shown in the image
    │     → e.g. cairn click e15  (never click a pixel coordinate)
    └── NO → is the element present in the tree but you can't identify it?
        ├── YES → cairn look --visual (numbered boxes disambiguate visually)
        └── NO (element not in tree at all) → it may be in a closed shadow root
              or an iframe → cairn look --visual; if still not found, the page
              may require scrolling → cairn look --visual after scrolling
```

**Key principle:** the marked screenshot and the tree use the **same refs**. You look at the image to *perceive* which element is the right one, then you *act by ref* (`cairn click e15`). You never output or reason about pixel coordinates. This is what eliminates location hallucination — vision perceives, refs ground.

**When the structured model is better than vision:**
- Forms with many similar inputs (refs + labels are unambiguous; a screenshot of 20 similar fields is harder to read)
- Pages where the visual layout is misleading (overlays, hidden elements)
- Any task where you already have the ref from a prior `goto`/`look`

**When vision is better:**
- Canvas/WebGL widgets (Google Maps, Figma-like editors, charting libraries)
- Closed shadow-DOM custom elements (no DOM nodes to model)
- Visual verification ("does this look right?" / "is the button red?")
- Disambiguating among visually similar elements

---

## NL goto — grounding internals + click-to-reveal

`cairn goto "<nl goal>"` parses the intent and grounds it to a ref using deterministic logic (no in-tool LLM call):

**Intent types:**
| Intent | Pattern example | Action |
|---|---|---|
| Click | `goto "click the sign in button"` | ground → clickByRef |
| Type | `goto "type hello into the email field"` | ground (typeable only) → typeByRef |
| Navigate | `goto "go to settings"` | ground → clickByRef → detect URL change |

**Grounding scoring** (fuzzy, deterministic):
- Token overlap between the goal and the element's accessible name + role
- Role hints: "button"→button role, "field"/"input"→textbox, "link"→link
- Typeability: for type intents, typeable roles (textbox/searchbox/combobox/textarea/contenteditable) get +0.20; non-typeable matches get -0.55 (prevents matching "search" to a `<span>Search</span>` label instead of the actual `<input>`)
- Region context: if a region is focused, elements in that region get a small bonus

**Not-found handling** (instead of a cryptic Playwright error):
```
✗ not found: no element matched "submit button"
  closest: [e15] button "Sign in" (0.42), [e16] link "Reset" (0.31)
  → try "cairn look --visual" for a marked screenshot to visually locate the element.
```

**Ambiguity handling:**
```
✗ ambiguous: 2 elements match "sign in" —
  [e15] button "Sign in" (0.78)
  [e22] link "Sign in" (0.71)
  → specify which one (e.g. "click the <unique name> button") or run "cairn look --visual".
```

### Click-to-reveal (dialog-based search)

Some sites (Wikipedia, DuckDuckGo) hide search inputs behind a link that opens a dialog, or inside a closed shadow root. The structured model can't see inside these, so a type intent returns "not found." Cairn's click-to-reveal fallback handles this automatically:

1. Type intent returns `notFound` for "search field"
2. Cairn re-grounds "search" as a **click** intent instead
3. Clicks the matching "Search" link/button to open the dialog
4. Waits for the page to settle (MutationObserver quiet)
5. Re-builds the page model (now the dialog's input is in the DOM)
6. Re-grounds the type intent and types

If the dialog re-renders the DOM (invalidating `data-cairn-ref` attributes, as Wikipedia does), a direct-locator fallback finds the first visible input and fills it directly.

**You don't need to do anything special** — `goto "type artificial intelligence into the search field"` just works on these sites. If it still fails, the error message suggests `cairn look --visual`.

---

## Region focus strategy

Pages are spatially clustered into regions: `header`, `nav`, `main`, `sidebar`, `footer`, `modal`. The renderer shows them as a tree:

```
page: example.com/login
▼ Header
  link "Logo" [ref=e1]    link "Help" [ref=e2]
▼ Main
  form "Sign in" [ref=e12]
  ├── textbox "Email" [ref=e13]
  ├── textbox "Password" [ref=e14]
  └── button "Sign in" [ref=e15]
▼ Footer
  link "Terms" [ref=e20]    link "Privacy" [ref=e21]
```

**`focus` zooms into one region** so you only pay tokens for the relevant subtree:

```bash
cairn goto https://example.com       # full tree (all regions)
cairn focus main                     # → only the Main subtree
cairn look                           # → shows just Main (compact)
```

**Strategy for large pages:**
1. `cairn goto <url>` — scan the full tree to find which region your target is in
2. `cairn focus <region>` — zoom into that region
3. Act within the region — deltas are even cheaper now (fewer nodes to diff)
4. `cairn focus <other-region>` — switch when needed (e.g. `focus nav` to find a menu link)

`focus` also accepts a ref (`cairn focus e12`) to zoom into a specific subtree — useful for deeply nested widgets.

To exit focus: `cairn focus` with no clear semantics resets to the full page on the next `goto`, or just `cairn look` shows the full tree regardless of focus.

**Token savings:** on a page with 200 interactive elements, `focus main` might cut the view to 30 elements — ~6x smaller. Combined with `look -i` (interactive-only), even more compact.

---

## Delta interpretation

After `cairn click` (and after `goto` intents), Cairn injects a MutationObserver, waits for the page to settle, re-snapshots, and diffs by ref. The delta uses three markers:

```
✓ clicked [e15]

delta:
  - [e12] form "Sign in"          (removed: form was replaced)
  + [e30] heading "Welcome back"  (added: new page content)
  + [e31] link "Dashboard"        (added)
  ~ [e1] link "Logo"              (changed: href updated)
  url: /login → /dashboard        (URL changed = navigation happened)
```

| Marker | Meaning |
|---|---|
| `+ [ref]` | Element appeared (new content, dialog opened, page section loaded) |
| `- [ref]` | Element disappeared (old content removed, dialog closed) |
| `~ [ref]` | Element changed (text, href, state, or position updated) |
| `url: A → B` | Navigation occurred (URL changed) |

**Why deltas matter:** on iterative tasks (click → observe → click → observe), reading only the delta saves ~50% tokens vs re-snapshotting the full page each step. You see exactly what your action caused, without re-reading the 90% of the page that didn't change.

**When the delta is empty:** `(no visible changes detected)` — your action didn't change the DOM (e.g. typing into a field that doesn't trigger a re-render). This is normal for `type`; the `✓ typed ...` line already confirms the action succeeded.

**When you need the full tree:** after a navigation that substantially changes the page, or when you've lost track of the current refs, run `cairn look` (or `cairn look -i` for the compact interactive-only view).

---

## Steel backend usage

By default, Cairn launches a local Chrome instance via Playwright. For anti-detect, proxy rotation, and managed chrome-farm sessions, use the self-hosted [Steel Browser](https://github.com/steel-dev/steel-browser) backend (Apache-2.0, free to self-host).

**Start Steel:**
```bash
docker compose up -d     # starts Steel Browser (ports 3000=API, 9223=CDP)
```

**Use Steel with Cairn:**
```bash
cairn goto https://example.com --steel
cairn look --steel
cairn click e15 --steel --proxy http://user:pass@proxy:8080
cairn status --steel     # shows "Backend: Steel Browser" + Steel session ID
```

**Flags:**
| Flag | What it does |
|---|---|
| `--steel` | Use the Steel backend instead of local Chrome |
| `--proxy <url>` | Per-session proxy (http://user:pass@host:port or socks5://host:port) |
| `--user-agent <str>` | Custom User-Agent for the session |
| `--no-headless` | Run the browser with a visible window (for debugging) |

**Environment variables** (set in shell or `.env`):
| Var | Purpose |
|---|---|
| `STEEL_API_URL` | Steel API base URL (default: http://localhost:3000) |
| `STEEL_API_KEY` | Steel API key (self-hosted usually has none) |
| `STEEL_PROXY_URL` | Default proxy for all Steel sessions |
| `STEEL_HEADLESS` | `"false"` to run Steel browser headed |

**Auto-fallback:** if Steel is unreachable, Cairn automatically falls back to local Chrome (with a console warning). So `--steel` is safe to use even if the container is down.

**Release a Steel session** (frees the browser process on the Steel farm):
```bash
cairn release --steel
# → ✓ released Steel session <id>
```

For local Chrome, `release` just clears saved session state (Chrome stays running as a detached background process).

---

## Session management

Cairn keeps the browser alive across commands via a persistent session:

- **Local Chrome:** launched as a detached background process on `127.0.0.1:9222`; each CLI command connects via Playwright `connectOverCDP`. The browser stays running until `release` or you kill it.
- **Steel:** each `--steel` session creates a Steel-managed browser; `release` frees it.

**Named sessions** (`--session <id>`) let you run multiple independent browsers:

```bash
cairn goto http://localhost:3000 --session app
cairn goto http://staging.example.com --session staging
cairn status --session app        # app's URL + state
cairn click e5 --session staging  # act on the staging browser
cairn release --session app       # free the app session
```

Session state (current URL, focused region) is persisted to `.sessions/<id>.json`. On the next command with the same session ID, Cairn reconnects and restores the saved URL if the page is blank.

**When to release:** at the end of a task to free resources — especially on Steel (frees a browser slot on the farm). For local Chrome during iterative dev, you can leave the session running; `release` is optional cleanup.
