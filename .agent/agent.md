# qurix apps — module & theme spec

## What this is

The qurix apps are authored as **source modules** and assembled by a small generator into **one self-contained HTML file per app** (all custom CSS + JS inlined, runnable by double-click / `file://`). You no longer hand-write a full single-file HTML with placeholder markers — you write the app's modules + a config, and `npm run build` produces `dist/<app>.html`.

The **shell** (header / docs / app / footer chrome, its CSS, and the export/version/hydrate IIFE) and the **theme** (design tokens) are shared modules. An app contributes only its content, docs, CSS, JS and a config. Swapping the theme (standard qurix vs. a client design) is a one-line config change.

## Source layout

```
src/
  shell/
    chrome.html        # header/docs/main/footer markup with slot markers (shared)
    shell.css          # reset + components + .qrx-shell-* layout (token-driven, shared)
    shell.js           # the IIFE: docs toggle, version stamp, pristine capture,
                       #   hydrate, syncFormState, writeAppState, download,
                       #   export-blank + export-with-data handlers (shared, DO NOT edit per app)
  themes/
    qurix.css          # :root design tokens, light + @media dark  (the --qrx-* contract)
    qurix.fonts.html   # optional <link> webfonts for this theme
    <client>.css       # a client theme: same token names, different values/fonts
  apps/
    <app>/
      app.config.json  # name, lang, theme, output, fonts[], headAssets[], card{}
      content.html     # inner HTML of <main id="qrx-app">
      docs.html        # inner HTML of <section id="qrx-docs"> (.qrx-shell-docs-inner)
      app.css          # app-specific CSS — TOKENS ONLY, no literal colors
      app.js           # app logic + window.qurixApp.serializeState/hydrateState
      icon.svg         # card icon for the portal (single source per app)
      assets/          # (optional) verbatim files to inline, e.g. a vendored lib
  portal/              # the landing page (index.html): THEME but NO shell
    portal.config.json # title, lang, theme, output, description, fonts[], apps[]
    portal.html        # header / hero / grid (<!--SLOT:cards-->) / footer
    portal.css         # portal-specific CSS (reset + hero/grid/card) — tokens only
tools/
  build.mjs            # generator (zero-dep Node ESM): builds every src/apps/* + the portal into dist/
  slots.mjs            # literal string-replace slot filler (no regex on payloads)
  extract.mjs          # one-off: re-derive app modules from a legacy monolithic HTML
  extract-wm.mjs       # one-off: same, for the bespoke wm2026 structure
dist/                  # GENERATED, self-contained, the deployable artifacts (commit these)
```

## Build & verify

- `npm run build` → regenerates every `dist/<app>.html` **and** the portal `dist/index.html`. No dependencies; needs Node only.
- The generated file MUST stay self-contained: one inline `<style>` (theme + shell + app CSS), one inline `<script>` (shell IIFE then app JS), external libs only as the `<script src>` refs declared in `headAssets`, fonts only via theme `<link>`s.
- After building, sanity-check: open `dist/<app>.html` via `file://` (no console errors); exercise docs toggle, the footer version stamp, **Export blank** (clean copy, no entered data) and **Export with data** (reopen the snapshot → state restored).
- Editing `dist/*.html` by hand is forbidden — change the source modules and rebuild. (`tools/extract.mjs` can re-derive modules from an old monolith by stable anchors.)

## Authoring a new app — files to produce

1. `content.html` — the UI that fills `<main id="qrx-app">`. Keep the **initial markup static**; render dynamic content via JS so "Export blank" (which restores the pristine `#qrx-app`) yields a truly clean copy.
2. `docs.html` — plain HTML docs (`<h2>`, `<p>`, `<code>`, `<ul>` …, no Markdown) that fill `.qrx-shell-docs-inner`.
3. `app.css` — app styles. **Use only the design tokens** (`var(--qrx-*)`) for colors/spacing/radius/shadow/typography; never hardcode hex/rgba. This is what makes the app themeable.
4. `app.js` — app logic. May set the two optional state hooks (below).
5. `app.config.json` — see schema below.

Do **not** re-create the shell chrome, shell CSS, or the IIFE in an app — they come from `src/shell/*`. Treat the shell IIFE as owned by `shell.js`.

### app.config.json schema

```jsonc
{
  "name": "Parquet Profiler",        // app label (header) + <title> "<name> – qurix"
  "lang": "de",                       // <html lang>
  "theme": "qurix",                   // file in src/themes/<theme>.css
  "output": "parquet-profiler.html",  // dist filename
  "title": "Parquet Profiler – qurix",// optional; default "<name> – qurix"
  "shellCss": true,                   // optional; false = app.css ships a bespoke shell skin
  "fonts": [],                        // optional theme font snippets, e.g. ["qurix.fonts.html"]
  "headAssets": [                     // external CDN libs, kept as <script src> refs
    { "comment": "Chart.js via CDN, pinned version, minified",
      "src": "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
      "crossorigin": "anonymous" }
  ],
  "inlineStyles": [],                 // optional: assets/*.css inlined verbatim as own <style>
  "inlineScripts": [],                // optional: assets/*.js inlined verbatim as own <script>
  "card": {                           // optional: how this app appears on the portal
    "description": "…one paragraph…",
    "tags": ["…", "…"]
  }
}
```

Optional fields: `title` overrides the default `<name> – qurix`. `shellCss:false` omits the shared `shell.css` (for an app whose `app.css` carries a fully custom shell skin — e.g. a dark theme). `inlineStyles`/`inlineScripts` inline a vendored library from `assets/` verbatim as separate blocks (with inline scripts present, shell/lib/app are emitted as separate `<script>` blocks so the library keeps its own top-level scope). `card` (+ a sibling `icon.svg`) supplies this app's tile on the portal — `name`/`output` are reused as title/link.

To ship a client-branded variant: add `src/themes/<client>.css` (same token names, different values/fonts) and either point `theme` at it or add a second config with a different `output`. A radically different skin (like the dark `wm-dark` theme) pairs a custom theme with `shellCss:false` + shell rules in `app.css`.

## Portal (`index.html`)

The landing page is its own page type: it uses the **theme** (tokens + fonts) for design consistency but **not** the shell (no header/docs/footer chrome, no export IIFE). It lives in `src/portal/` (`portal.html` = its own header/hero/grid/footer with `<!--SLOT:cards-->`; `portal.css` = portal-only styles, tokens only) and is themeable the same way (`portal.config.json` → `theme`), so a client gets a branded portal too.

Cards are **generated from the app configs** — for each entry in `portal.config.json`'s `apps[]`, the generator reads that app's `name` (title), `output` (link), `card.description`, `card.tags`, and `icon.svg`. So adding/migrating an app and listing it in `apps[]` makes its tile appear automatically; there is no hand-maintained card markup. `portal.config.json` also carries the portal `title`, `description` (meta), `lang`, and `fonts[]`.

## Slot markers (in `chrome.html`)

The generator fills these by **literal** replacement (safe for any app payload):

- `{{APP_NAME}}` — header label + `<title>`.
- `<!--SLOT:app-docs-->` — replaced with `docs.html`.
- `<!--SLOT:app-content-->` — replaced with `content.html`.

## Themes & the token contract

A **theme = one CSS file** that defines `:root` (and an optional `@media (prefers-color-scheme: dark)`) for the canonical `--qrx-*` contract. `src/themes/qurix.css` is the standard. App CSS and shell CSS depend ONLY on these names, so a re-skin never touches markup or logic.

Token contract (names defined in `qurix.css`):

- **Brand:** `--qrx-blue`, `--qrx-blue-dark`, `--qrx-blue-light`, `--qrx-green`, `--qrx-green-dark`, `--qrx-green-light`, `--qrx-gradient`.
- **Functional:** `--qrx-primary`, `--qrx-primary-hover`, `--qrx-accent`, `--qrx-accent-hover`.
- **Surfaces:** `--qrx-bg`, `--qrx-bg-subtle`, `--qrx-bg-muted`, `--qrx-surface`, `--qrx-bg-dark`.
- **Text:** `--qrx-text`, `--qrx-text-muted`, `--qrx-text-subtle`, `--qrx-text-inverse`, `--qrx-text-on-brand`.
- **Borders:** `--qrx-border`, `--qrx-border-strong`.
- **Semantic:** `--qrx-success`, `--qrx-warning`, `--qrx-danger`, `--qrx-info`.
- **Spacing:** `--qrx-s-1` … `--qrx-s-10` (0.25rem … 2.5rem).
- **Shape/effects:** `--qrx-radius-sm`, `--qrx-radius`, `--qrx-radius-lg`, `--qrx-shadow-sm`, `--qrx-shadow`, `--qrx-shadow-lg`, `--qrx-transition`.
- **Typography:** `--qrx-font-sans`, `--qrx-font-mono` (a theme may add `--qrx-font-display`).

**Rule:** app CSS introduces no new color values — only `var(--qrx-*)`. If you need a tint/overlay, add a token to the theme rather than a literal `rgba()`.

**Brand usage:** `--qrx-primary` (blue) for primary actions/headings/links/focus; `--qrx-accent` (green) sparingly for highlights/success; `--qrx-gradient` at most once or twice per app. Generous whitespace; group controls in `.qrx-card` rather than dividers.

## State & export semantics (in `shell.js`, hooks in `app.js`)

The shell footer has **Export blank** (`data-action="export-html"`) and **Export with data** (`data-action="export-html-state"`).

- **Export blank** clones the document, drops any `#qrx-app-state`, and restores `#qrx-app` to the markup captured at first load — so anything the app rendered into the DOM is excluded. (Keep initial app markup static; render data via JS.)
- **Export with data** syncs live form values, calls `serializeState()`, writes a `<script id="qrx-app-state" type="application/json">` block, and downloads a snapshot.
- Form inputs (`<input>`, `<textarea>`, `<select>`, `<details>`) are synced automatically — no hook needed.

**Stateful apps** (state outside form elements — lists, timers, canvases, localStorage) implement:

```js
window.qurixApp.serializeState = () => ({ /* your state */ });
window.qurixApp.hydrateState   = (state) => { /* restore from object */ };
```

**Apps that reference external/live resources** (uploaded `File` handle, WASM/DB connection, remote URL) cannot embed the live data — treat "Export with data" as a *static snapshot*:
- `serializeState` captures **configuration + the visible preview** (schema + sample rows). Coerce to JSON-safe primitives first (`BigInt → String`, Arrow/nested → plain) or `JSON.stringify` throws.
- `hydrateState` enters a **read-only snapshot mode**: render the captured preview, show a banner ("static snapshot — re-load the original to enable live features"), and disable/guard every action needing the live resource. Keep the re-load control active; clear snapshot mode when a real resource arrives.

## Hard constraints (non-negotiable)

- **One self-contained file per app** at output. All custom CSS/JS inlined; no external CSS/JS of your own. Icons inline as SVG.
- **External libraries only via pinned CDN** (`cdnjs`, `cdn.jsdelivr.net`, `unpkg`, `esm.sh`), minified, with `crossorigin`/SRI where available — declared in `headAssets` (kept as refs) or `import()`ed in app.js. A vendored library that must be offline goes in `assets/` and is inlined verbatim (do not reformat).
- **Fonts** via theme `<link>` (`fonts` in config) — rely on the token font stacks otherwise.
- **`localStorage` wrapped in try/catch** (blocked for some `file://` origins).
- **Accessibility:** all interactive elements labelled; buttons have readable text or `aria-label`.
- Must run from `file://` (double-click). With CDN libs, internet is needed on first load only.
