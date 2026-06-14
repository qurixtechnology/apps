# qurix apps

A suite of **local-first, single-file web apps** by [qurix Technology](https://www.qurix.tech).
Each app is authored as small **source modules** and assembled by a zero-dependency Node
generator into **one self-contained HTML file** that runs by double-click (`file://`) or from any
static host — no build step at runtime, no backend, no data leaves the browser.

Live: **[apps.qurix.tech](https://apps.qurix.tech)**

## Apps

| App | Output | What it does |
|---|---|---|
| **Table Format Converter** | `table-format-converter.html` | Read CSV/Parquet/JSON/NDJSON/Excel, inspect the schema, tune the parsing heuristic with a live preview, export to another format (DuckDB-WASM). |
| **Parquet Profiler** | `parquet-profiler.html` | Structural & statistical analysis of Parquet files — footer metadata, column/row-group/compression stats, preview, pivot and a free SQL editor (DuckDB-WASM). |
| **Markdown Display** | `markdown-display.html` | Render Markdown as a clean paper-style document — syntax highlighting, GFM tables, Mermaid diagrams, document outline, source editor, table → CSV/Parquet and diagram → PNG/SVG export, print-to-PDF. |
| **Secure Chat** | `secure-chat.html` | Encrypted peer-to-peer video chat in the browser (WebRTC + PeerJS) — no account, end-to-end between devices. |
| **WM 2026 Spielplan** | `wm2026-spielplan.html` | Interactive 2026 World Cup schedule & scenario planner — groups, bracket, calendar, Monte-Carlo simulator, prediction game (optional Supabase cloud rounds), DE/EN toggle. |
| **Portal** | `index.html` | The landing page / app store (DE/EN), generated from the app configs. |

## Quick start

```bash
npm run build        # regenerate every dist/<app>.html + dist/index.html
```

Then open any file in `dist/` in a browser (double-click works). The generator has **zero
dependencies** — only Node.js is required.

## How it works

The **shell** (header / docs / app / footer chrome, its CSS, and the export/version/hydrate IIFE)
and the **theme** (design tokens) are shared modules. An app contributes only its content, docs,
CSS, JS and a config. Swapping the theme (standard qurix vs. a client design) is a one-line config
change. The generator inlines all custom CSS/JS into a single HTML file; external libraries stay as
pinned CDN `<script src>` refs.

### Source layout

```
src/
  shell/
    chrome.html        # header/docs/main/footer markup with slot markers (shared)
    shell.css          # reset + components + .qrx-shell-* layout (token-driven, shared)
    shell.js           # docs toggle, build-version readout, pristine capture, hydrate,
                       #   export-blank + export-with-data handlers (shared — do not edit per app)
  themes/
    qurix.css          # :root design tokens (light + @media dark), the --qrx-* contract
    qurix.fonts.html   # webfont <link>s for the theme
    wm-dark.css        # an alternative theme
  apps/<app>/
    app.config.json    # name, lang, theme, output, fonts[], headAssets[], card{}
    content.html       # inner HTML of <main id="qrx-app">
    docs.html          # inner HTML of the docs section
    app.css            # app-specific CSS — design tokens only, no literal colors
    app.js             # app logic + window.qurixApp.serializeState/hydrateState
    icon.svg           # card icon for the portal
    assets/            # (optional) verbatim files to inline, e.g. a vendored lib
  portal/              # the landing page (uses the theme, not the shell)
    portal.config.json # title, lang, theme, output, description, fonts[], apps[]
    portal.html        # header / hero / grid (<!--SLOT:cards-->) / footer
    portal.css
tools/
  build.mjs            # generator (zero-dep Node ESM): builds every src/apps/* + the portal
  slots.mjs            # literal string-replace slot filler
  extract.mjs          # one-off: re-derive app modules from a legacy monolithic HTML
dist/                  # GENERATED, self-contained, deployable artifacts (committed)
.agent/agent.md        # full module & theme spec (the authoritative reference)
```

## Authoring a new app

1. Create `src/apps/<app>/` with `content.html`, `docs.html`, `app.css`, `app.js`, `icon.svg`
   and `app.config.json` (keep the **initial markup static** so "Export blank" yields a clean copy;
   render dynamic content via JS).
2. Use **only design tokens** (`var(--qrx-*)`) in `app.css` — no hardcoded hex/rgba. This is what
   makes apps themeable.
3. Declare external libraries in `headAssets` (pinned CDN) or vendor them into `assets/` and inline
   via `inlineStyles`/`inlineScripts`.
4. List the app in `src/portal/portal.config.json` (`apps[]`) so its card appears on the portal.
5. `npm run build` and check `dist/<app>.html` (`file://`): no console errors, docs toggle, footer
   version stamp, **Export blank** (clean copy) and **Export with data** (snapshot re-opens with
   state restored).

`app.config.json` essentials:

```jsonc
{
  "name": "My App",                 // header label + <title> "<name> – qurix"
  "lang": "de",                      // <html lang>
  "theme": "qurix",                  // file in src/themes/<theme>.css
  "output": "my-app.html",           // dist filename
  "fonts": ["qurix.fonts.html"],     // optional theme font snippets
  "headAssets": [                     // external CDN libs kept as <script src> refs
    { "comment": "lib", "src": "https://cdn…/lib.min.js", "crossorigin": "anonymous" }
  ],
  "card": { "description": "…", "description_en": "…", "tags": ["…"], "tags_en": ["…"] }
}
```

See **[.agent/agent.md](.agent/agent.md)** for the complete spec (config schema, slot markers,
the `--qrx-*` token contract, and the state/export hooks).

## State & export

Every app ships two footer actions, handled by the shared `shell.js`:

- **Export blank** — a clean copy of the app with no entered data (the `#qrx-app` region is restored
  to its pristine, first-load markup).
- **Export with data** — a snapshot: form values + `window.qurixApp.serializeState()` are written
  into the file; on reopen `hydrateState()` restores them.

Apps with state outside form elements implement:

```js
window.qurixApp.serializeState = () => ({ /* your state */ });
window.qurixApp.hydrateState   = (state) => { /* restore from object */ };
```

## Theming

A theme is one CSS file defining `:root` for the `--qrx-*` contract (and an optional dark
`@media`). App and shell CSS depend only on those names, so a re-skin never touches markup or
logic. To ship a client-branded variant, add `src/themes/<client>.css` with the same token names
and point an app's `theme` at it.

## Build versioning

The footer **build version** (`YYMMDD-HHMMSS`) is the newest modification time among an app's
dependent source files, baked into the HTML at build time (stable, not a runtime clock). It also
forms the export filename suffix.

## Deployment

`dist/*.html` are the deployable artifacts and are committed to the repo. The public site
`apps.qurix.tech` is served as static files (nginx). Because every output is self-contained, any
static host works; with the CDN-loaded libraries, internet is needed only on first load.

## Constraints (non-negotiable)

- **One self-contained file per app** — all custom CSS/JS inlined; icons inline as SVG.
- **External libraries only via pinned CDN** (minified, with `crossorigin`/SRI where available),
  declared in `headAssets`; an offline-required lib is vendored in `assets/` and inlined verbatim.
- **`localStorage` wrapped in try/catch** (blocked on some `file://` origins).
- **Accessibility**: interactive elements labelled; buttons have readable text or `aria-label`.
- Must run from `file://` (double-click).

## License & ownership

© qurix Technology GmbH. Internal project. Not an official product of any third party referenced
by the apps; provided without warranty.
