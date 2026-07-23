# Backlog

Findings and open work, kept next to the code so a point can be closed in the
same commit that fixes it. Each entry says **where** it applies and **why** it
is on the list — so it still makes sense months later.

Three sections on purpose:

- **Open** — things to do, roughly ordered by priority.
- **Watch** — no action possible or wanted right now (upstream limits,
  deliberate decisions). Listed so they are not rediscovered as "bugs".
- **Done** — closed items with the commit that closed them.

---

## Open

### High

- [ ] **Remove the stale HTML copies in the repository root**
      `index.html`, `table-format-converter.html`, `parquet-profiler.html`,
      `wm2026-spielplan.html` are outdated copies of `dist/` (last touched
      2026-06-07). The build neither produces nor updates them; the converter
      copy is 169 KB against 402 KB in `dist/`. Anyone opening them gets an app
      from June.
      *Check first* whether one of them is a published URL — if so, keep it and
      publish from `dist/` instead.

- [ ] **Move off the duckdb-wasm pre-release**
      `src/shared/qrx-duckdb.js` pins `1.33.1-dev57.0`. A dev build is needed
      because the `quack` extension (DuckDB remote protocol) requires engine
      ≥ 1.5.3, and no stable duckdb-wasm shipped that yet. Switch as soon as a
      stable release wraps engine ≥ 1.5.3. The version lives in exactly one
      place, and `00-build` asserts it is new enough.

### Medium

- [ ] **secure-chat: replace `alert()` with the toast widget**
      10 blocking `alert()` calls in `src/apps/secure-chat/app.js`. The change
      itself is small (`qrx.ui.toast`), but the app has only smoke coverage
      (2 suites, none of them functional), so do it **together with a real test
      suite** — otherwise nobody notices if an error path stops reporting.

- [ ] **secure-chat: guard the localStorage accesses**
      6 direct `localStorage.*` calls without try/catch (identity, contacts).
      Reading `window.localStorage` itself throws a `SecurityError` when the
      browser is configured to block site data (Chrome/Edge/Firefox setting, or
      enterprise policy) — not in a normal incognito window, where it works and
      is merely cleared on close. The first call sits in `init()`, so the whole
      start sequence aborts: verified with blocked storage, the app hangs with
      "Lädt…" and never loads contacts or connects. `qrx.core.storage` already
      handles this and is loaded by the app.

- [ ] **Profiler: bound the memory use of DuckDB server tables**
      A remote table is copied into memory in full (`addRemoteTables`), because
      quack tables are streaming scans and cannot be read twice per query. That
      is correct but unbounded: a very large server table will hit the 32-bit
      WASM ceiling. Offer a row limit or a column selection when picking the
      table.

- [ ] **markdown-display and secure-chat are single-language**
      Neither registers an `app` dictionary, so the shell keeps the language
      switch hidden (by design — a half-translated screen is worse). The
      infrastructure is in place; what is missing is the translation.

### Low
- [ ] **Profiler SQL tab: a few strings stayed untranslated**
      The SQL panel hint ("Direkter SQL-Zugriff …") and the "Beispiel:" label
      (`content.html` ~226/236) were missed by the bilingual pass — they sit in
      elements with nested markup, which the string extractor skipped. Small,
      just needs `data-qrx-i18n` hooks + dictionary entries.


- [ ] **wm2026-spielplan runs its own i18n next to `qrx.i18n`**
      Its `I18N`/`t()` layer and the `data-i18n` attribute predate the shared
      module (which is why the shared one uses `data-qrx-i18n` — see Watch).
      Merging is possible but the app's subject matter has expired, so the
      effort is hard to justify. Listed for completeness.

- [ ] **Self-host the CDN libraries**
      Six external dependencies are loaded at runtime: duckdb-wasm, SheetJS,
      Chart.js, marked, mermaid, highlight.js. First load therefore needs
      internet access, which contradicts the "everything stays local" promise —
      the *data* never leaves the browser, but the *code* is fetched. Vendoring
      them (as wm2026 already does with Leaflet) would make the apps fully
      offline-capable, at the cost of repository size.

- [ ] **Widget test host page**
      `tests/suites/44-widgets` drives the widgets through an app page. A
      dedicated host page (`tests/fixtures/widget-host.html`) would isolate them
      from app state and run faster. Planned during modularisation, not built —
      the current form works.

---

## Watch

- **quack only reaches the server's `main` schema.**
  quack strips the schema when forwarding a query, so tables in other schemas
  are listed by `remote.sqlite_master` but cannot be read. The apps detect this
  from the DDL and disable those entries with a reason. Nothing to fix locally;
  revisit if the extension gains schema support.

- **The preview tables are deliberately NOT unified.**
  Converter (editable headers, filter popovers), cleaner (column resizing,
  compare mode, PII tags) and profiler (sortable/filterable column table with
  charts) differ in substance, not by accident. Only the read-only part is
  shared (`qrx.ui.resultGrid`, `qrx.ui.pager`). Forcing them into one widget
  would produce a component with many modes and no clear owner. If this comes up
  again: it was considered and rejected.

- **SQL and export panels stay per app** — same reasoning. What was actually
  duplicated (editor behaviour, result grid, pager) is shared.

- **`data-qrx-i18n` is prefixed on purpose.**
  The first version used the bare `data-i18n`, which wm2026-spielplan uses for
  its own translation layer — every text in that app was replaced by its key.
  Do not drop the prefix.

- **Generated column names (`column1`, `column2` …) are not translated.**
  They end up in the exported data. Making them language-dependent would mean
  the same input produces different column names depending on a UI setting.

- **Test suites must pin the language they assert on.**
  The choice is stored per browser profile and the suites share one, so a suite
  that switches language leaks into the next. Converter, cleaner and profiler
  suites set their language explicitly; new suites that assert on visible text
  have to do the same.

---

## Done

- [x] Extract shared basics into `qrx-core` — `558665f`
- [x] Bilingual infrastructure (`qrx-i18n`) + shell language switch — `cfd76b0`
- [x] One DuckDB layer (`qrx-duckdb`), retryable init, one pinned version — `81dd54b`
- [x] Modal and DuckDB connect dialog as widgets, incl. focus trap — `4f3808c`
- [x] Status bar and toast as widgets, with an ARIA live region — `c4d3543`
- [x] Drop zone and file-info bar as widgets — `9661a01`
- [x] Shared SQL result grid and pager; fixed dates rendered as epoch ms — `68a95bd`
- [x] Shared SQL editor behaviour (Tab indents everywhere now) — `a729a4d`
- [x] Table Format Converter bilingual — `d26c9d9`
- [x] Cleaner and profiler bilingual; fixed a literal `ü` in a tooltip — `9b1b3c8`
- [x] JS-built labels translated; bilingual documentation — `c0e29c7`
- [x] Regression suite (`tests/`), 40 → 112 tests — `a546a8f` and later
