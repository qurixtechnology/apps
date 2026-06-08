// === App logic ===
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Constants & state
  // -------------------------------------------------------------------------
  const DUCKDB_URL  = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm';
  // These point at the *active* file and are reassigned in setActiveFile().
  // The whole profiling layer reads them at query time, so re-pointing them
  // (plus the `data` view) is all that's needed to switch the profiled file.
  let PARQUET_VFS = 'data.parquet';
  let PARQUET_SQL = `'${PARQUET_VFS}'`;
  const HIST_BINS   = 30;
  const TOPN_VALUES = 20;
  const FILTER_DISTINCT_LIMIT = 5000;   // safety cap for filter value list

  const state = {
    duckdb: null,
    db: null,
    conn: null,
    fileMeta: null,         // mirrors the ACTIVE file: {name, size}
    files: [],              // [{id, name, size, vfsName, alias, handle, rows, profiled}]
    activeFileId: null,     // id of the file currently being profiled
    bufferActive: false,    // when true, the active file is fully loaded into RAM
    rowCountTotal: 0,
    rowCountFiltered: 0,
    columns: [],            // [{name, type, category, ...}]
    fileMetaRow: null,      // parquet_file_metadata row
    rowGroupAgg: null,      // aggregated parquet_metadata
    filters: {},            // {colName: filterObj}
    expandedCols: new Set(),
    charts: new Map(),      // canvasId -> Chart
    statsCache: new Map(),  // key `${col}` -> stats (full dataset, no filter dep)
    filterCache: new Map(), // key `${col}|${filterHashWithoutSelf}` -> filter source data
    previewLimit: 100,
    previewPage: 0,         // 0-based
    distinctScanId: 0,      // increments per file load; lets background scans bail out
    colsTable: {
      sortKey: null,        // 'index' | 'name' | 'category' | 'type' | 'min' | 'max' | 'nullPct' | 'distinct' | 'compressed' | null
      sortDir: 'asc',       // 'asc' | 'desc'
      filters: {},          // {field: {kind, ...}}
    },
    pivot: {
      rows: [],             // ['attribute_name', ...]   (multiple allowed)
      cols: [],             // ['attribute_name']        (0 or 1 allowed in v1)
      values: [],           // [{ agg: 'sum'|'avg'|..., field: 'name'|null }, ...]
      lastResult: null,     // rendered result snapshot for sort/re-render
      resultSort: null,     // { key, dir }
    },
    sql: {
      query: '',            // the editor's current text
      lastRunCount: null,   // last result row count, used by the tab-count badge
    },
    activeTab: 'cols',      // 'cols' | 'preview' | 'pivot' | 'sql'
    snapshotMode: false,    // true when viewing a "with data" export (no live file/DuckDB)
  };

  // -------------------------------------------------------------------------
  // DOM refs
  // -------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const dropSection    = $('pp-dropSection');
  const dropZone       = $('pp-dropZone');
  const fileInput      = $('pp-fileInput');
  const pickBtn        = $('pp-pickBtn');
  const statusSection  = $('pp-statusSection');
  const fileListEl     = $('pp-fileList');
  const filesCountEl   = $('pp-filesCount');
  const addFilesBtn    = $('pp-addFilesBtn');
  const bufferActiveCb = $('pp-bufferActive');
  const loadingSection = $('pp-loadingSection');
  const loadingText    = $('pp-loadingText');
  const errorBox       = $('pp-errorBox');
  const metaSection    = $('pp-metaSection');
  const metaGrid       = $('pp-metaGrid');
  const metaTech       = $('pp-metaTech');
  const previewFilters = $('pp-previewFilters');
  const filtersList    = $('pp-filtersList');
  const filterResult   = $('pp-filterResult');
  const clearFiltersBtn= $('pp-clearFiltersBtn');
  const columnsSection = $('pp-columnsSection');
  const columnsList    = $('pp-columnsList');
  const colsFilters    = $('pp-colsFilters');
  const colsFiltersList= $('pp-colsFiltersList');
  const colsFilterResult = $('pp-colsFilterResult');
  const clearColsFiltersBtn = $('pp-clearColsFiltersBtn');
  const colsMeta       = $('pp-colsMeta');
  const pivotSection   = $('pp-pivotSection');
  const pivotRunBtn    = $('pp-pivotRunBtn');
  const pivotResetBtn  = $('pp-pivotResetBtn');
  const pivotStatus    = $('pp-pivotStatus');
  const pivotResult    = $('pp-pivotResult');
  const pivotSummary   = $('pp-pivotSummaryCount');
  const tabsBar        = $('pp-tabs');
  const sqlEditor      = $('pp-sqlEditor');
  const sqlRunBtn      = $('pp-sqlRunBtn');
  const sqlClearBtn    = $('pp-sqlClearBtn');
  const sqlExamplesSel = $('pp-sqlExamples');
  const sqlTablesEl    = $('pp-sqlTables');
  const sqlStatus      = $('pp-sqlStatus');
  const sqlResult      = $('pp-sqlResult');
  const sqlSummary     = $('pp-sqlSummaryCount');
  const previewSection = $('pp-previewSection');
  const previewTable   = $('pp-previewTable');
  const previewLimitSel= $('pp-previewLimit');
  const previewMeta    = $('pp-previewMeta');
  const paginationBar  = $('pp-pagination');
  const paginationInfo = $('pp-paginationInfo');
  const pageJumpInput  = $('pp-pageJump');

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function quoteIdent(name) {
    // DuckDB identifier quoting
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function quoteString(val) {
    // SQL single-quoted string literal
    return "'" + String(val).replace(/'/g, "''") + "'";
  }

  function formatBytes(b) {
    if (b == null || isNaN(b)) return '\u2014';
    if (b < 1024) return `${b} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = b / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
  }

  function formatNumber(n) {
    if (n == null) return '\u2014';
    if (typeof n === 'bigint') return n.toLocaleString('de-DE');
    const num = Number(n);
    if (isNaN(num)) return '\u2014';
    return num.toLocaleString('de-DE');
  }

  function formatStat(v, type) {
    if (v == null) return '\u2014';
    if (typeof v === 'bigint') v = Number(v);
    if (type === 'integer' || type === 'numeric') {
      if (typeof v === 'number') {
        if (Number.isInteger(v) || Math.abs(v) >= 1000) return formatNumber(Math.round(v * 1000) / 1000);
        return v.toLocaleString('de-DE', { maximumFractionDigits: 4 });
      }
    }
    return String(v);
  }

  function formatCellValue(v) {
    if (v == null) return { text: 'NULL', isNull: true };
    if (typeof v === 'bigint') return { text: v.toString(), isNull: false };
    if (v instanceof Date) return { text: v.toISOString(), isNull: false };
    if (typeof v === 'object') {
      try { return { text: JSON.stringify(v), isNull: false }; }
      catch (e) { return { text: String(v), isNull: false }; }
    }
    return { text: String(v), isNull: false };
  }

  function getColCategory(type) {
    const t = String(type).toUpperCase();
    if (/^(BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)\b/.test(t)) return 'integer';
    if (/^(DOUBLE|FLOAT|REAL|DECIMAL)/.test(t)) return 'numeric';
    if (/^(VARCHAR|TEXT|STRING|CHAR|UUID)/.test(t)) return 'string';
    if (/^(DATE|TIMESTAMP|TIME|INTERVAL)/.test(t)) return 'temporal';
    if (t === 'BOOLEAN') return 'boolean';
    if (/^(BLOB|BINARY|BIT)/.test(t)) return 'binary';
    if (/^(STRUCT|MAP|LIST|ARRAY)/.test(t) || t.endsWith('[]')) return 'complex';
    return 'other';
  }

  function getTypeBadge(category) {
    const map = {
      integer:  { label: 'INT', cls: 'pp-type-int' },
      numeric:  { label: 'NUM', cls: 'pp-type-num' },
      string:   { label: 'STR', cls: 'pp-type-str' },
      temporal: { label: 'DT',  cls: 'pp-type-temporal' },
      boolean:  { label: 'BL',  cls: 'pp-type-bool' },
      binary:   { label: 'BIN', cls: 'pp-type-binary' },
      complex:  { label: '{}',  cls: 'pp-type-complex' },
      other:    { label: '?',   cls: 'pp-type-other' },
    };
    return map[category] || map.other;
  }

  function showError(title, detail) {
    errorBox.innerHTML = `
      <div class="pp-error">
        <strong>${escapeHtml(title)}</strong>
        ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ''}
      </div>`;
  }
  function clearError() { errorBox.innerHTML = ''; }

  function showLoading(text) {
    loadingText.textContent = text || 'Lade \u2026';
    loadingSection.removeAttribute('hidden');
  }
  function hideLoading() { loadingSection.setAttribute('hidden', ''); }

  // Convert Arrow-style result rows into plain JS objects with sane types.
  // We rely on Arrow's .toArray() but guard for BigInt where needed.
  function rowsFromQuery(result) {
    const rows = result.toArray();
    return rows.map(r => {
      const o = {};
      for (const k of Object.keys(r)) {
        let v = r[k];
        // Convert BigInt counts to Number when safe
        if (typeof v === 'bigint') {
          if (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) {
            v = Number(v);
          }
        }
        o[k] = v;
      }
      return o;
    });
  }

  async function runQuery(sql) {
    if (!state.conn) throw new Error('DuckDB connection not initialized');
    return await state.conn.query(sql);
  }

  // Build a stable hash of the active filter set for cache keys
  function hashFilters(excludeCol = null) {
    const keys = Object.keys(state.filters).filter(k => k !== excludeCol).sort();
    if (!keys.length) return '0';
    const parts = keys.map(k => {
      const f = state.filters[k];
      if (f.kind === 'values') return `${k}:V:${f.values.slice().sort().join(',')}:N${!!f.includeNull}`;
      if (f.kind === 'range') return `${k}:R:${f.min ?? ''}:${f.max ?? ''}:N${!!f.includeNull}`;
      return `${k}:?`;
    });
    let h = 0;
    const s = parts.join('|');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return String(h);
  }

  // SQL WHERE clause for current filters (optionally excluding one column)
  function buildWhereClause(excludeCol = null) {
    const parts = [];
    for (const col of Object.keys(state.filters)) {
      if (col === excludeCol) continue;
      const f = state.filters[col];
      const id = quoteIdent(col);
      if (f.kind === 'values') {
        const vals = (f.values || []).map(v => quoteString(v));
        const fragments = [];
        if (vals.length) fragments.push(`${id} IN (${vals.join(', ')})`);
        if (f.includeNull) fragments.push(`${id} IS NULL`);
        if (!fragments.length) parts.push('1=0'); // nothing selected -> no rows
        else parts.push(`(${fragments.join(' OR ')})`);
      } else if (f.kind === 'range') {
        const fragments = [];
        const bounds = [];
        const colType = state.columns.find(c => c.name === col)?.type || 'VARCHAR';
        // Use TRY_CAST so a malformed bound input doesn't error the whole query
        if (f.min != null && f.min !== '') bounds.push(`${id} >= TRY_CAST(${quoteString(f.min)} AS ${colType})`);
        if (f.max != null && f.max !== '') bounds.push(`${id} <= TRY_CAST(${quoteString(f.max)} AS ${colType})`);
        if (bounds.length) fragments.push(`(${bounds.join(' AND ')})`);
        if (f.includeNull) fragments.push(`${id} IS NULL`);
        if (fragments.length) parts.push(`(${fragments.join(' OR ')})`);
      }
    }
    return parts.length ? ' WHERE ' + parts.join(' AND ') : '';
  }

  // -------------------------------------------------------------------------
  // DuckDB initialization (lazy)
  // -------------------------------------------------------------------------
  let initPromise = null;
  function initDuckDB() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      showLoading('DuckDB wird initialisiert \u2026');
      try {
        const duckdb = await import(DUCKDB_URL);
        state.duckdb = duckdb;
        const bundles = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(bundles);
        const workerScript = `importScripts("${bundle.mainWorker}");`;
        const workerUrl = URL.createObjectURL(
          new Blob([workerScript], { type: 'text/javascript' })
        );
        const worker = new Worker(workerUrl);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(workerUrl);
        state.db = db;
        state.conn = await db.connect();
      } catch (e) {
        console.error(e);
        showError('DuckDB konnte nicht initialisiert werden', e && e.message || String(e));
        hideLoading();
        throw e;
      }
    })();
    return initPromise;
  }

  // -------------------------------------------------------------------------
  // File loading (multi-file)
  //
  // Memory model: files are registered with registerFileHandle() using the
  // BROWSER_FILEREADER protocol. DuckDB then issues *range reads* against the
  // File object (Blob.slice) and only pulls the byte ranges a query actually
  // needs — for Parquet that means the footer plus the relevant column chunks.
  // The full file is never copied into WASM memory, so adding several files
  // for a join costs almost nothing until a query touches them.
  // -------------------------------------------------------------------------
  let fileSeq = 0;

  // Derive a safe, unique SQL view name (and VFS filename) from a file name.
  function makeAlias(fileName, taken) {
    let base = String(fileName).replace(/\.parquet$/i, '').toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'file';
    if (/^[0-9]/.test(base)) base = 't_' + base;
    let alias = base, i = 2;
    while (taken.has(alias)) { alias = base + '_' + i; i++; }
    return alias;
  }

  function activeFileRec() {
    return state.files.find(f => f.id === state.activeFileId) || null;
  }

  // Register one or more new files (does NOT replace existing ones).
  async function addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter(Boolean);
    if (!incoming.length) return;
    exitSnapshotMode();  // a real file replaces the static snapshot view
    clearError();
    showLoading('Dateien werden registriert \u2026');
    try {
      await initDuckDB();
      const FR = state.duckdb.DuckDBDataProtocol.BROWSER_FILEREADER;
      const taken = new Set(['data']);   // reserve the convenience-view name
      for (const f of state.files) taken.add(f.alias);
      let firstNewId = null;

      for (const file of incoming) {
        const id = 'f' + (fileSeq++);
        const alias = makeAlias(file.name, taken);
        taken.add(alias);
        const vfsName = alias + '.parquet';   // friendly VFS path mirrors the alias

        try { await state.db.dropFile(vfsName); } catch (e) { /* ignore */ }
        // Lazy, range-read registration — minimal memory footprint.
        await state.db.registerFileHandle(vfsName, file, FR, true);

        // Per-file view so SQL users can `FROM alias` and join across files.
        try {
          await runQuery(`CREATE OR REPLACE VIEW ${quoteIdent(alias)} AS SELECT * FROM '${vfsName}'`);
        } catch (e) { console.warn('view create failed for', alias, e); }

        // Cheap footer-only row count for the list display.
        let rows = null;
        try {
          const m = rowsFromQuery(await runQuery(
            `SELECT num_rows FROM parquet_file_metadata('${vfsName}')`));
          if (m[0] && m[0].num_rows != null) rows = Number(m[0].num_rows);
        } catch (e) { /* leave null on error */ }

        const rec = { id, name: file.name, size: file.size, vfsName, alias, handle: file,
                      rows, profiled: false, mode: 'handle' };
        state.files.push(rec);
        if (firstNewId === null) firstNewId = id;
      }

      hideLoading();

      if (!state.activeFileId) {
        // First file(s) ever — reveal the workspace and profile the first one.
        await setActiveFile(firstNewId);
      } else {
        // Already profiling a file; just refresh the list + SQL helper.
        renderFileList();
        rebuildSqlExamples();
        renderSqlTables();
      }
    } catch (e) {
      console.error(e);
      hideLoading();
      showError('Dateien konnten nicht geladen werden', e && e.message || String(e));
    }
  }

  // Backward-compatible single-file entry point.
  function handleFile(file) { return addFiles([file]); }

  // Switch a file's registration between lazy (range reads, low RAM) and
  // fully buffered (whole file in WASM memory, faster repeated queries).
  // Re-registering under the same VFS name keeps its view valid.
  async function registerAsHandle(rec) {
    if (rec.mode === 'handle') return;
    const FR = state.duckdb.DuckDBDataProtocol.BROWSER_FILEREADER;
    try { await state.db.dropFile(rec.vfsName); } catch (e) { /* ignore */ }
    await state.db.registerFileHandle(rec.vfsName, rec.handle, FR, true);
    rec.mode = 'handle';
  }
  async function registerAsBuffer(rec) {
    if (rec.mode === 'buffer') return;
    const buf = new Uint8Array(await rec.handle.arrayBuffer());
    try { await state.db.dropFile(rec.vfsName); } catch (e) { /* ignore */ }
    await state.db.registerFileBuffer(rec.vfsName, buf);
    rec.mode = 'buffer';
  }
  // Ensure registration matches the toggle: active file buffered iff bufferActive,
  // every other file back to a lazy handle so its RAM is released.
  async function applyRegistrationModes(activeId) {
    for (const f of state.files) {
      if (f.id !== activeId && f.mode === 'buffer') await registerAsHandle(f);
    }
    const act = state.files.find(f => f.id === activeId);
    if (!act) return;
    if (state.bufferActive) await registerAsBuffer(act);
    else await registerAsHandle(act);
  }

  // Switch the profiled file and recompute the whole profile for it.
  async function setActiveFile(id) {
    const rec = state.files.find(f => f.id === id);
    if (!rec) return;
    if (state.activeFileId === id && rec.profiled) return; // already active

    closeFilterPopover();
    destroyAllCharts();
    state.statsCache.clear();
    state.filterCache.clear();
    state.filters = {};
    state.expandedCols.clear();
    state.previewPage = 0;
    state.distinctScanId++;  // invalidates any in-flight distinct scan
    state.colsTable.sortKey = null;
    state.colsTable.sortDir = 'asc';
    state.colsTable.filters = {};
    state.pivot.rows = [];
    state.pivot.cols = [];
    state.pivot.values = [];
    state.pivot.lastResult = null;
    state.pivot.resultSort = null;
    if (pivotResult) pivotResult.innerHTML = '';
    if (pivotStatus) { pivotStatus.textContent = ''; pivotStatus.className = 'pp-pivot-status'; }
    if (pivotSummary) pivotSummary.textContent = '';

    // Re-point the active-file path variables + the `data` convenience view.
    state.activeFileId = id;
    PARQUET_VFS = rec.vfsName;
    PARQUET_SQL = `'${PARQUET_VFS}'`;
    state.fileMeta = { name: rec.name, size: rec.size };

    showLoading('Parquet-Metadaten werden gelesen \u2026');
    try {
      if (state.bufferActive) showLoading('Aktive Datei wird in den Speicher geladen \u2026');
      await applyRegistrationModes(id);
      try {
        await runQuery(`CREATE OR REPLACE VIEW data AS SELECT * FROM ${PARQUET_SQL}`);
      } catch (e) { console.warn('Could not create data view', e); }

      // File-level metadata (footer only)
      const fileMetaRes = await runQuery(`SELECT * FROM parquet_file_metadata(${PARQUET_SQL})`);
      state.fileMetaRow = rowsFromQuery(fileMetaRes)[0] || null;

      // Schema
      const descRes = await runQuery(`DESCRIBE SELECT * FROM ${PARQUET_SQL}`);
      state.columns = rowsFromQuery(descRes).map(r => ({
        name: r.column_name,
        type: String(r.column_type),
        category: getColCategory(r.column_type),
        nullable: r.null === 'YES' || r.null === true,
      }));

      // Row count
      const rcRes = await runQuery(`SELECT COUNT(*)::BIGINT AS c FROM ${PARQUET_SQL}`);
      state.rowCountTotal = Number(rowsFromQuery(rcRes)[0].c);
      state.rowCountFiltered = state.rowCountTotal;
      rec.rows = state.rowCountTotal;

      // Row group aggregate stats (file-level)
      const rgRes = await runQuery(`
        SELECT
          COUNT(DISTINCT row_group_id)::BIGINT  AS rg_count,
          SUM(total_compressed_size)::BIGINT    AS compressed_size,
          SUM(total_uncompressed_size)::BIGINT  AS uncompressed_size
        FROM parquet_metadata(${PARQUET_SQL})
      `);
      state.rowGroupAgg = rowsFromQuery(rgRes)[0] || {};

      // Per-column metadata (footer-only)
      await loadColumnMetadata();
      for (const c of state.columns) c.distinctCount = undefined;

      rec.profiled = true;

      hideLoading();
      renderFileList();
      renderMetaCards();
      renderColumns();
      renderActiveFilters();
      await refreshPreview();

      dropSection.setAttribute('hidden', '');
      statusSection.removeAttribute('hidden');
      metaSection.removeAttribute('hidden');
      tabsBar.removeAttribute('hidden');
      setActiveTab(state.activeTab || 'cols');
      renderPivotConfig();
      rebuildSqlExamples();
      renderSqlTables();

      // Reset SQL result panel — switching the active file makes the previous
      // result potentially meaningless; the editor text is kept.
      if (sqlResult) sqlResult.innerHTML = '';
      if (sqlStatus) { sqlStatus.textContent = ''; sqlStatus.className = 'pp-sql-status'; }
      if (sqlSummary) sqlSummary.textContent = '';
      state.sql.lastRunCount = null;

      loadDistinctCounts(); // background, not awaited
    } catch (e) {
      console.error(e);
      hideLoading();
      showError('Datei konnte nicht profiliert werden', e && e.message || String(e));
    }
  }

  // Remove a file: drop its view + handle, then re-pick an active file.
  async function removeFile(id) {
    const idx = state.files.findIndex(f => f.id === id);
    if (idx < 0) return;
    const rec = state.files[idx];
    try { await runQuery(`DROP VIEW IF EXISTS ${quoteIdent(rec.alias)}`); } catch (e) { /* ignore */ }
    try { await state.db.dropFile(rec.vfsName); } catch (e) { /* ignore */ }
    state.files.splice(idx, 1);

    if (state.activeFileId === id) {
      state.activeFileId = null;
      if (state.files.length) {
        // Activate a neighbour (prefer the previous file in the list).
        const next = state.files[Math.max(0, idx - 1)];
        await setActiveFile(next.id);
      } else {
        await resetToEmpty();
      }
    } else {
      renderFileList();
      rebuildSqlExamples();
      renderSqlTables();
    }
  }

  // Return the UI to the initial empty state (no files loaded).
  async function resetToEmpty() {
    destroyAllCharts();
    try { await runQuery('DROP VIEW IF EXISTS data'); } catch (e) { /* ignore */ }
    state.activeFileId = null;
    state.fileMeta = null;
    state.fileMetaRow = null;
    state.columns = [];
    state.rowCountTotal = 0;
    state.rowCountFiltered = 0;
    state.filters = {};
    state.statsCache.clear();
    state.filterCache.clear();
    PARQUET_VFS = 'data.parquet';
    PARQUET_SQL = `'${PARQUET_VFS}'`;
    statusSection.setAttribute('hidden', '');
    metaSection.setAttribute('hidden', '');
    tabsBar.setAttribute('hidden', '');
    dropSection.removeAttribute('hidden');
    renderFileList();
    renderSqlTables();
  }

  // -------------------------------------------------------------------------
  // File list rendering
  // -------------------------------------------------------------------------
  const FILE_ICON_SVG =
    '<svg class="pp-file-icon" width="26" height="26" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
    + '<polyline points="14 2 14 8 20 8"/></svg>';

  function renderFileList() {
    if (!fileListEl) return;
    filesCountEl.textContent = state.files.length ? `(${state.files.length})` : '';
    const parts = [];
    for (const f of state.files) {
      const isActive = f.id === state.activeFileId;
      const rowsTxt = f.rows != null ? `${formatNumber(f.rows)} Zeilen` : '\u2014';
      const attrsTxt = (isActive && state.columns.length)
        ? ` \u00B7 ${state.columns.length} Attribute` : '';
      parts.push(
        `<li class="pp-file-item${isActive ? ' pp-file-item-active' : ''}" data-id="${escapeHtml(f.id)}">`
        + `<span class="pp-file-radio" aria-hidden="true"></span>`
        + FILE_ICON_SVG
        + `<span class="pp-file-meta">`
          + `<span class="pp-file-name">${escapeHtml(f.name)}`
          + (isActive ? `<span class="pp-file-active-badge">aktiv</span>` : '')
          + (isActive && f.mode === 'buffer' ? `<span class="pp-file-buffered-badge">im Speicher</span>` : '')
          + `</span>`
          + `<span class="pp-file-detail">${formatBytes(f.size)} \u00B7 ${rowsTxt}${attrsTxt}`
          + ` \u00B7 View: <code>${escapeHtml(f.alias)}</code></span>`
        + `</span>`
        + `<button class="pp-file-remove" type="button" data-action="remove" `
          + `data-id="${escapeHtml(f.id)}" title="Datei entfernen" aria-label="Datei entfernen">&times;</button>`
        + `</li>`
      );
    }
    fileListEl.innerHTML = parts.join('');
  }

  // -------------------------------------------------------------------------
  // Metadata cards
  // -------------------------------------------------------------------------
  // German percentage formatting (1 decimal).
  function fmtPct(x) {
    if (x == null || isNaN(x)) return '\u2014';
    return (x * 100).toLocaleString('de-DE',
      { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
  }

  // Whole-table quality KPIs derived WITHOUT scanning data:
  //  - Füllgrad: from the Parquet footer null counts (zero cost, instant).
  //  - Eindeutigkeit: from the distinct counts the app already computes in the
  //    background batch (no additional query). Pending until that batch lands.
  function computeQualityKpis() {
    const N = state.columns.length;
    const rows = state.rowCountTotal || 0;

    // --- Füllgrad (footer-only) ---
    let knownCells = 0, nonNull = 0, statCols = 0, fullCols = 0, emptyCols = 0, unknownCols = 0;
    for (const c of state.columns) {
      const nc = (c.meta && c.meta.nullCount != null) ? c.meta.nullCount : null;
      if (nc == null || !rows) { unknownCols++; continue; }
      statCols++;
      knownCells += rows;
      nonNull += (rows - nc);
      if (nc === 0) fullCols++;
      if (nc >= rows) emptyCols++;
    }
    const fillRate = knownCells > 0 ? nonNull / knownCells : null;

    // --- Eindeutigkeit (reuses the background distinct scan) ---
    let uniqSum = 0, uniqCols = 0, keyCands = 0, constCols = 0, pending = 0, distinctKnown = 0;
    for (const c of state.columns) {
      if (c.category === 'complex') continue;
      const d = c.distinctCount;
      if (d === undefined) { pending++; continue; }
      if (d === null) continue;
      distinctKnown++;
      const nc = (c.meta && c.meta.nullCount != null) ? c.meta.nullCount : 0;
      const nn = rows - nc;                       // COUNT(DISTINCT) ignores NULLs
      if (nn > 0) { uniqSum += Math.min(1, d / nn); uniqCols++; }
      if (rows > 0 && d === rows && nc === 0) keyCands++;   // unique + complete
      if (d === 1) constCols++;                              // single value
    }
    const uniqAvg = uniqCols > 0 ? uniqSum / uniqCols : null;

    return { N, rows, fillRate, statCols, fullCols, emptyCols, unknownCols,
             uniqAvg, distinctKnown, keyCands, constCols, pending };
  }

  function renderMetaCards() {
    const fm = state.fileMetaRow || {};
    const rg = state.rowGroupAgg || {};
    const compressed = Number(rg.compressed_size || 0);
    const uncompressed = Number(rg.uncompressed_size || 0);
    const compressionRatio = compressed > 0 ? (uncompressed / compressed) : null;
    const k = computeQualityKpis();

    // Füllgrad sub-line
    let fillSub = `${k.fullCols}/${k.N} ohne NULL`;
    if (k.emptyCols) fillSub += ` \u00B7 ${k.emptyCols} leer`;
    if (k.unknownCols) fillSub += ` \u00B7 ${k.unknownCols} ohne Statistik`;

    // Eindeutigkeit sub-line
    let uniqSub;
    if (k.pending) uniqSub = 'wird berechnet \u2026';
    else {
      const segs = [`${k.keyCands} Schl\u00FCsselkandidat${k.keyCands === 1 ? '' : 'en'}`];
      if (k.constCols) segs.push(`${k.constCols} konstant`);
      uniqSub = segs.join(' \u00B7 ');
    }

    const cards = [
      { label: 'Zeilen',
        value: formatNumber(state.rowCountTotal),
        sub: fm.num_rows != null ? `Footer: ${formatNumber(Number(fm.num_rows))}` : '' },
      { label: 'Attribute',
        value: String(state.columns.length),
        sub: countByCategory() },
      { label: 'F\u00FCllgrad',
        value: fmtPct(k.fillRate),
        sub: fillSub,
        barPct: k.fillRate != null ? Math.round(k.fillRate * 1000) / 10 : null,
        barClass: '' },
      { label: 'Eindeutigkeit',
        value: k.pending ? '\u2026' : fmtPct(k.uniqAvg),
        sub: uniqSub,
        pending: k.pending,
        barPct: (!k.pending && k.uniqAvg != null) ? Math.round(k.uniqAvg * 1000) / 10 : null,
        barClass: 'pp-meta-bar-blue' },
    ];

    metaGrid.innerHTML = cards.map(c => {
      const valCls = 'pp-meta-card-value'
        + (c.pending ? ' pp-meta-card-value-pending pp-meta-loading' : '');
      const bar = (c.barPct != null)
        ? `<div class="pp-meta-bar ${c.barClass || ''}"><span style="width:${c.barPct}%"></span></div>`
        : '';
      return `
      <div class="pp-meta-card">
        <div class="pp-meta-card-label">${escapeHtml(c.label)}</div>
        <div class="${valCls}" title="${escapeHtml(c.value)}">${escapeHtml(c.value)}</div>
        ${bar}
        ${c.sub ? `<div class="pp-meta-card-sub">${escapeHtml(c.sub)}</div>` : ''}
      </div>`;
    }).join('');

    renderMetaTech();
  }

  // Subtle, secondary technical facts (purely from footer metadata).
  function renderMetaTech() {
    if (!metaTech) return;
    const fm = state.fileMetaRow || {};
    const rg = state.rowGroupAgg || {};
    const compressed = Number(rg.compressed_size || 0);
    const uncompressed = Number(rg.uncompressed_size || 0);
    const rgCount = Number(rg.rg_count || fm.num_row_groups || 0);
    const rows = state.rowCountTotal || 0;
    const compressionRatio = compressed > 0 ? (uncompressed / compressed) : null;
    const avgRowBytes = rows > 0 && uncompressed > 0 ? uncompressed / rows : null;

    const items = [];
    items.push(['Dateigr\u00F6\u00DFe', formatBytes(state.fileMeta.size)]);
    if (compressed) {
      items.push(['Komprimiert',
        `${formatBytes(compressed)}${compressionRatio ? ` (${compressionRatio.toFixed(2)}\u00D7)` : ''}`]);
    }
    if (uncompressed) items.push(['Unkomprimiert', formatBytes(uncompressed)]);
    if (rgCount) {
      items.push(['Row Groups',
        rows && rgCount
          ? `${formatNumber(rgCount)} (\u2300 ${formatNumber(Math.round(rows / rgCount))} Zeilen)`
          : formatNumber(rgCount)]);
    }
    if (avgRowBytes != null) items.push(['\u00D8 Zeilengr\u00F6\u00DFe', `${formatBytes(avgRowBytes)}/Zeile`]);
    const mix = countByCategory();
    if (mix) items.push(['Datentypen', mix]);
    if (fm.created_by) items.push(['Erzeugt mit', truncate(String(fm.created_by), 40)]);
    if (fm.format_version != null) items.push(['Format', `v${fm.format_version}`]);

    metaTech.innerHTML = items.map(([label, val]) =>
      `<span class="pp-meta-tech-item"><span class="pp-meta-tech-label">${escapeHtml(label)}</span>`
      + `<b>${escapeHtml(val)}</b></span>`
    ).join('');
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }

  function countByCategory() {
    const counts = {};
    for (const c of state.columns) counts[c.category] = (counts[c.category] || 0) + 1;
    const parts = [];
    if (counts.integer)  parts.push(`${counts.integer} int`);
    if (counts.numeric)  parts.push(`${counts.numeric} num`);
    if (counts.string)   parts.push(`${counts.string} str`);
    if (counts.temporal) parts.push(`${counts.temporal} dt`);
    if (counts.boolean)  parts.push(`${counts.boolean} bool`);
    if (counts.complex)  parts.push(`${counts.complex} struct`);
    return parts.join(', ');
  }

  // ==========================================================================
  // Columns TABLE
  //
  // Renders state.columns as a proper table with sortable headers and Excel-
  // style header filters. Each row can be expanded to show the detail panel
  // (stats + charts). Sorting and filtering are entirely client-side over the
  // already-loaded column metadata; no SQL is involved.
  // ==========================================================================

  // Field definitions — drive the thead, the sort comparator, the filter
  // popover UIs, and the cell renderers below.
  const COLS_FIELDS = [
    { id: 'chevron',    label: '',          sortable: false, filterable: false, width: '36px', titleAttr: '' },
    { id: 'category',   label: 'Typ',       sortable: true,  filterable: true,  filterKind: 'values', width: '60px',  align: 'center' },
    { id: 'name',       label: 'Name',      sortable: true,  filterable: true,  filterKind: 'search', width: null },
    { id: 'type',       label: 'Datentyp',  sortable: true,  filterable: true,  filterKind: 'values', width: '130px' },
    { id: 'min',        label: 'Min',       sortable: true,  filterable: true,  filterKind: 'search', width: '150px' },
    { id: 'max',        label: 'Max',       sortable: true,  filterable: true,  filterKind: 'search', width: '150px' },
    { id: 'nullPct',    label: 'Null',      sortable: true,  filterable: true,  filterKind: 'range',  width: '110px' },
    { id: 'distinct',   label: 'Eindeutig', sortable: true,  filterable: true,  filterKind: 'range',  width: '110px' },
    { id: 'compressed', label: 'Gr\u00F6\u00DFe', sortable: true, filterable: true, filterKind: 'range', width: '110px' },
  ];

  // Accessor: returns the typed value of `fieldId` for sorting/filtering.
  // null/undefined means "no value" (sorts last; range filter ignores).
  function getColField(col, fieldId) {
    switch (fieldId) {
      case 'name':     return col.name;
      case 'category': return col.category;
      case 'type':     return col.type;
      case 'min':      return col.meta ? col.meta.min : null;
      case 'max':      return col.meta ? col.meta.max : null;
      case 'nullPct':
        if (!col.meta || col.meta.nullCount == null || !state.rowCountTotal) return null;
        return col.meta.nullCount / state.rowCountTotal;
      case 'distinct': return (col.distinctCount === undefined || col.distinctCount === null) ? null : col.distinctCount;
      case 'compressed': return col.meta ? col.meta.compressed : null;
    }
    return null;
  }

  function compareColField(a, b, fieldId, dir) {
    const va = getColField(a, fieldId);
    const vb = getColField(b, fieldId);
    const sign = dir === 'desc' ? -1 : 1;
    // Nulls always sort last regardless of direction.
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    // Numeric comparison when both are numbers
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * sign;
    }
    // String comparison (case-insensitive, locale-aware)
    const sa = String(va).toLowerCase();
    const sb = String(vb).toLowerCase();
    return sa.localeCompare(sb, 'de') * sign;
  }

  function colMatchesFilters(col) {
    const fs = state.colsTable.filters;
    for (const fieldId in fs) {
      const f = fs[fieldId];
      const v = getColField(col, fieldId);
      if (f.kind === 'values') {
        // f.values is a Set of strings; null means "show NULL"
        if (v == null) {
          if (!f.includeNull) return false;
        } else if (!f.values.has(String(v))) {
          return false;
        }
      } else if (f.kind === 'search') {
        const q = (f.query || '').toLowerCase();
        if (!q) continue;
        if (v == null) return false;
        if (!String(v).toLowerCase().includes(q)) return false;
      } else if (f.kind === 'range') {
        if (v == null) {
          if (!f.includeNull) return false;
        } else {
          // Range values are typed numbers for nullPct/distinct/compressed
          if (f.min != null && v < f.min) return false;
          if (f.max != null && v > f.max) return false;
        }
      }
    }
    return true;
  }

  function computeColsView() {
    const filtered = state.columns.filter(colMatchesFilters);
    const sortKey = state.colsTable.sortKey;
    if (!sortKey) return filtered;
    const dir = state.colsTable.sortDir;
    return filtered.slice().sort((a, b) => compareColField(a, b, sortKey, dir));
  }

  // -------------------------------------------------------------------------
  // Render entry point: rebuilds the table thead+tbody from scratch.
  // -------------------------------------------------------------------------
  function renderColumns() {
    destroyAllCharts();
    columnsList.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'pp-cols-table';
    table.id = 'pp-colsTable';

    // colgroup for fixed widths
    const colgroup = document.createElement('colgroup');
    for (const f of COLS_FIELDS) {
      const c = document.createElement('col');
      if (f.width) c.style.width = f.width;
      colgroup.appendChild(c);
    }
    table.appendChild(colgroup);

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr>' + COLS_FIELDS.map(f => renderColsTableHeaderCell(f)).join('') + '</tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    columnsList.appendChild(table);

    fillColsTableBody(tbody);
    attachColsTableHeaderHandlers(thead);
    renderActiveColsFilters();
    updateColsMeta();
  }

  function fillColsTableBody(tbody) {
    tbody.innerHTML = '';
    const view = computeColsView();
    if (!view.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="${COLS_FIELDS.length}"
        style="text-align:center;color:var(--qrx-text-muted);padding:1.5rem;">
        Keine Attribute entsprechen den aktuellen Filtern.</td>`;
      tbody.appendChild(tr);
      return;
    }
    for (const col of view) {
      const tr = buildColsTableRow(col);
      tbody.appendChild(tr);
      // If previously expanded, append a detail row and re-render its content
      if (state.expandedCols.has(col.name)) {
        const detailTr = buildColsTableDetailRow(col);
        tbody.appendChild(detailTr);
        // Detail content rendering is async; fire-and-forget
        renderColumnDetails(col.name);
      }
    }
  }

  // Re-render only the tbody (keeps thead intact — used after sort/filter
  // changes and when expansion state changes).
  function refreshColsTableBody() {
    const table = document.getElementById('pp-colsTable');
    if (!table) return;
    destroyAllCharts();
    const tbody = table.tBodies[0];
    fillColsTableBody(tbody);
    renderActiveColsFilters();
    updateColsMeta();
    updateColsHeaderState();
  }

  function updateColsHeaderState() {
    const table = document.getElementById('pp-colsTable');
    if (!table) return;
    const thead = table.tHead;
    COLS_FIELDS.forEach(f => {
      const th = thead.querySelector(`th[data-field="${f.id}"]`);
      if (!th) return;
      // Sort indicator
      const sortBtn = th.querySelector('.pp-cols-th-sort');
      if (sortBtn) {
        sortBtn.classList.remove('pp-sort-asc', 'pp-sort-desc');
        if (state.colsTable.sortKey === f.id) {
          sortBtn.classList.add('pp-sort-' + state.colsTable.sortDir);
        }
      }
      // Filtered indicator
      const filterBtn = th.querySelector('.pp-cols-th-filter-btn');
      const hasFilter = !!state.colsTable.filters[f.id];
      if (filterBtn) filterBtn.classList.toggle('pp-active', hasFilter);
      th.classList.toggle('pp-th-filtered', hasFilter);
    });
  }

  function renderColsTableHeaderCell(f) {
    if (f.id === 'chevron') return '<th data-field="chevron"></th>';
    const sortClass = state.colsTable.sortKey === f.id ? ('pp-sort-' + state.colsTable.sortDir) : '';
    const sortInd = f.sortable
      ? `<span class="pp-sort-ind" aria-hidden="true">
           <span class="pp-sort-up">\u25B2</span>
           <span class="pp-sort-down">\u25BC</span>
         </span>`
      : '';
    const sortRole = f.sortable ? 'button' : '';
    const sortAria = f.sortable ? `aria-label="Sortieren nach ${escapeHtml(f.label)}"` : '';
    const filterIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                         <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                       </svg>`;
    const filterBtn = f.filterable
      ? `<button class="pp-cols-th-filter-btn" data-action="open-cols-filter" data-field="${f.id}"
                 type="button" aria-label="Filter ${escapeHtml(f.label)}">${filterIcon}</button>`
      : '';
    const sortCls = f.sortable ? 'pp-cols-th-sort' : 'pp-cols-th-sort pp-cols-th-nosort';
    return `<th data-field="${f.id}">
      <div class="pp-cols-th-content">
        <button type="button" class="${sortCls} ${sortClass}"
                data-action="sort-cols" data-field="${f.id}" ${sortAria} ${sortRole ? 'role="button"' : ''}>
          <span class="pp-cols-th-label">${escapeHtml(f.label)}</span>
          ${sortInd}
        </button>
        ${filterBtn}
      </div>
    </th>`;
  }

  function attachColsTableHeaderHandlers(thead) {
    thead.addEventListener('click', e => {
      const sortBtn = e.target.closest('[data-action="sort-cols"]');
      if (sortBtn) {
        const field = sortBtn.dataset.field;
        const def = COLS_FIELDS.find(f => f.id === field);
        if (!def || !def.sortable) return;
        toggleColsSort(field);
        return;
      }
      const filterBtn = e.target.closest('[data-action="open-cols-filter"]');
      if (filterBtn) {
        e.stopPropagation();
        openColsFilterPopover(filterBtn.dataset.field, filterBtn);
      }
    });
  }

  function toggleColsSort(fieldId) {
    if (state.snapshotMode) return;  // re-render would wipe the frozen snapshot table
    const t = state.colsTable;
    if (t.sortKey !== fieldId) {
      t.sortKey = fieldId;
      t.sortDir = 'asc';
    } else if (t.sortDir === 'asc') {
      t.sortDir = 'desc';
    } else {
      // Tri-state: asc → desc → off
      t.sortKey = null;
      t.sortDir = 'asc';
    }
    refreshColsTableBody();
  }

  function buildColsTableRow(col) {
    const tr = document.createElement('tr');
    tr.className = 'pp-cols-row';
    tr.dataset.col = col.name;
    if (state.expandedCols.has(col.name)) tr.classList.add('pp-cols-row-expanded');

    const badge = getTypeBadge(col.category);
    const meta = col.meta || null;
    const cells = [];

    // Chevron
    cells.push(`<td>
      <span class="pp-cols-chevron" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    </td>`);
    // Category badge
    cells.push(`<td class="pp-cols-cell-badge">
      <span class="pp-col-type-badge ${badge.cls}" title="${escapeHtml(col.category)}">${badge.label}</span>
    </td>`);
    // Name
    cells.push(`<td class="pp-cols-cell-name" title="${escapeHtml(col.name)}">
      <code>${escapeHtml(col.name)}</code>
    </td>`);
    // Datentyp
    cells.push(`<td class="pp-cols-cell-type" title="${escapeHtml(col.type)}">${escapeHtml(col.type)}</td>`);
    // Min / Max
    cells.push(renderRangeCell(col, meta, 'min'));
    cells.push(renderRangeCell(col, meta, 'max'));
    // Null bar
    cells.push(`<td class="pp-cols-cell-null">
      <div class="pp-col-null-bar"><div class="pp-col-null-bar-fill" style="width:0%"></div></div>
      <span class="pp-col-null-label">\u2014</span>
    </td>`);
    // Distinct
    cells.push(`<td class="pp-cols-cell-distinct">${renderColumnDistinct(col)}</td>`);
    // Size
    cells.push(`<td class="pp-cols-cell-size">${renderColumnSize(meta)}</td>`);

    tr.innerHTML = cells.join('');

    // Row click toggles expansion (except clicks on the chevron column's content
    // — actually we let the whole row toggle for simplicity).
    tr.addEventListener('click', e => {
      // Ignore clicks inside an open filter popover (those are managed there)
      if (e.target.closest('.pp-filter-popover')) return;
      // Ignore clicks on header buttons (shouldn't happen — thead is separate)
      if (e.target.closest('thead')) return;
      toggleColumn(col.name);
    });

    // Apply footer-derived null ratio immediately
    if (col.meta && col.meta.nullCount != null && state.rowCountTotal) {
      // Defer to next tick so the element is actually in the DOM
      queueMicrotask(() => updateColumnHeaderStats(col, {
        nulls: col.meta.nullCount,
        total: state.rowCountTotal,
      }));
    }
    return tr;
  }

  function buildColsTableDetailRow(col) {
    const tr = document.createElement('tr');
    tr.className = 'pp-cols-detail-row pp-cols-detail-visible';
    tr.dataset.col = col.name;
    tr.innerHTML = `
      <td class="pp-cols-detail-cell" colspan="${COLS_FIELDS.length}">
        <div class="pp-cols-detail-inner">
          <div class="pp-section-loading">
            <div class="pp-spinner" aria-hidden="true"></div>
            <span>Statistiken werden berechnet \u2026</span>
          </div>
        </div>
      </td>
    `;
    return tr;
  }

  function renderRangeCell(col, meta, which) {
    const rangeable = col.category === 'integer'
                   || col.category === 'numeric'
                   || col.category === 'temporal'
                   || col.category === 'string';
    if (!rangeable) return '<td class="pp-cols-cell-range pp-empty">\u2014</td>';
    if (!meta || meta[which] == null) {
      return '<td class="pp-cols-cell-range pp-empty">\u2014</td>';
    }
    const raw = String(meta[which]);
    const disp = formatRangeValue(meta[which], col);
    return `<td class="pp-cols-cell-range" title="${escapeHtml(raw)}">${escapeHtml(disp)}</td>`;
  }

  function formatRangeValue(v, col) {
    if (v == null) return '\u2014';
    if (col.category === 'integer' || col.category === 'numeric') {
      return formatStat(v, col.category);
    }
    if (col.category === 'temporal') {
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const isTimestamp = col.type.toUpperCase().includes('TIMESTAMP');
        if (isTimestamp && s.length > 10) {
          return s.replace('T', ' ').substring(0, 16);
        }
        return s.substring(0, 10);
      }
      return s;
    }
    if (col.category === 'string') {
      return truncate(String(v), 32);
    }
    return String(v);
  }

  function renderColumnSize(meta) {
    if (!meta || meta.compressed == null) {
      return '<span class="pp-col-range-empty">\u2014</span>';
    }
    const sizeStr = formatBytes(meta.compressed);
    const ratio = meta.compressionRatio;
    const ratioStr = (ratio != null && ratio > 0 && ratio < 1)
      ? `<span class="pp-col-size-ratio">${(1 / ratio).toFixed(1)}\u00D7</span>`
      : '';
    const title = `${formatBytes(meta.compressed)} komprimiert / `
                + `${formatBytes(meta.uncompressed)} unkomprimiert`
                + (meta.compression ? ' (' + meta.compression + ')' : '');
    return `<span class="pp-col-size-val" title="${escapeHtml(title)}">${sizeStr}</span>${ratioStr}`;
  }

  function updateColsMeta() {
    const sum = document.getElementById('pp-colsSummaryCount');
    if (!state.columns.length) {
      colsMeta.textContent = '';
      if (sum) sum.textContent = '';
      return;
    }
    const view = computeColsView();
    const total = state.columns.length;
    if (view.length === total) {
      colsMeta.innerHTML = `<strong>${formatNumber(total)}</strong> Attribute`;
      if (sum) sum.textContent = `${formatNumber(total)} Attribute`;
    } else {
      colsMeta.innerHTML = `<strong>${formatNumber(view.length)}</strong> von <strong>${formatNumber(total)}</strong> Attributen gefiltert`;
      if (sum) sum.textContent = `${formatNumber(view.length)} von ${formatNumber(total)} Attributen`;
    }
  }

  // -------------------------------------------------------------------------
  // Expansion / detail row
  // -------------------------------------------------------------------------
  async function toggleColumn(colName) {
    if (state.snapshotMode) return;  // column stats need a live DuckDB connection
    const table = document.getElementById('pp-colsTable');
    if (!table) return;
    const row = table.querySelector(`tr.pp-cols-row[data-col="${CSS.escape(colName)}"]`);
    if (!row) return;
    const isExpanded = row.classList.contains('pp-cols-row-expanded');

    if (isExpanded) {
      row.classList.remove('pp-cols-row-expanded');
      state.expandedCols.delete(colName);
      // Remove detail row and destroy any charts inside
      const detailRow = row.nextElementSibling;
      if (detailRow && detailRow.classList.contains('pp-cols-detail-row')) {
        const canvases = detailRow.querySelectorAll('canvas');
        canvases.forEach(c => {
          const ch = state.charts.get(c.id);
          if (ch) { ch.destroy(); state.charts.delete(c.id); }
        });
        detailRow.remove();
      }
      return;
    }

    row.classList.add('pp-cols-row-expanded');
    state.expandedCols.add(colName);
    const col = state.columns.find(c => c.name === colName);
    if (!col) return;
    const detailRow = buildColsTableDetailRow(col);
    row.parentNode.insertBefore(detailRow, row.nextSibling);
    await renderColumnDetails(colName);
  }

  async function renderColumnDetails(colName) {
    const col = state.columns.find(c => c.name === colName);
    if (!col) return;
    const table = document.getElementById('pp-colsTable');
    if (!table) return;
    const detailRow = table.querySelector(`tr.pp-cols-detail-row[data-col="${CSS.escape(colName)}"]`);
    if (!detailRow) return;
    const inner = detailRow.querySelector('.pp-cols-detail-inner');
    try {
      const stats = await computeColumnStats(col);
      updateColumnHeaderStats(col, stats);
      const html = renderColumnContent(col, stats);
      inner.innerHTML = html;
      drawColumnCharts(col, inner, stats);
    } catch (e) {
      console.error(e);
      inner.innerHTML = `
        <div class="pp-error">
          <strong>Statistiken konnten nicht berechnet werden</strong>
          <pre>${escapeHtml(e && e.message || String(e))}</pre>
        </div>`;
    }
  }

  function updateColumnHeaderStats(col, stats) {
    const table = document.getElementById('pp-colsTable');
    if (!table) return;
    const row = table.querySelector(`tr.pp-cols-row[data-col="${CSS.escape(col.name)}"]`);
    if (!row) return;
    const fill = row.querySelector('.pp-col-null-bar-fill');
    const label = row.querySelector('.pp-col-null-label');
    if (!fill || !label) return;
    if (!stats || !stats.total) return;
    const nullRatio = stats.total === 0 ? 0 : stats.nulls / stats.total;
    const nonNullRatio = 1 - nullRatio;
    fill.style.width = (nonNullRatio * 100).toFixed(1) + '%';
    if (nullRatio > 0) fill.classList.add('pp-has-nulls'); else fill.classList.remove('pp-has-nulls');
    label.textContent = nullRatio > 0
      ? `${(nullRatio * 100).toFixed(1)} % NULL`
      : '0 % NULL';
  }

  // -------------------------------------------------------------------------
  // Per-column metadata (footer-only, no data scan)
  //
  // Pulls per-column-chunk statistics from parquet_metadata() and aggregates
  // across row groups. Produces exact values for:
  //   - null count
  //   - min / max (typed per column category)
  //   - compressed and uncompressed size
  // These are attached to each state.columns[i].meta so renderColumns can
  // display them immediately, before the user expands any column.
  //
  // Stats in the Parquet footer are optional; if a writer didn't include them
  // the corresponding fields stay null and the UI shows them as "—".
  // -------------------------------------------------------------------------
  async function loadColumnMetadata() {
    let rows;
    try {
      const res = await runQuery(`
        SELECT
          path_in_schema                            AS col,
          CAST(stats_null_count AS BIGINT)          AS null_count,
          stats_min_value                           AS min_val,
          stats_max_value                           AS max_val,
          CAST(total_compressed_size AS BIGINT)     AS compressed,
          CAST(total_uncompressed_size AS BIGINT)   AS uncompressed,
          compression                               AS compression
        FROM parquet_metadata(${PARQUET_SQL})
      `);
      rows = rowsFromQuery(res);
    } catch (e) {
      console.warn('parquet_metadata column-level query failed:', e);
      for (const col of state.columns) col.meta = null;
      return;
    }

    // Group raw chunk rows by path_in_schema. Top-level scalar columns
    // produce one path == column name; nested types produce dotted paths
    // (e.g. "addr.street") which won't match any DESCRIBE column and are
    // silently ignored.
    const byCol = new Map();
    for (const r of rows) {
      const key = r.col;
      if (key == null) continue;
      let agg = byCol.get(key);
      if (!agg) {
        agg = {
          nullCount: 0, nullCountSeen: false,
          compressed: 0, uncompressed: 0,
          rawMins: [], rawMaxs: [],
          compression: null, chunkCount: 0,
        };
        byCol.set(key, agg);
      }
      agg.chunkCount++;
      if (r.null_count != null) {
        agg.nullCount += Number(r.null_count);
        agg.nullCountSeen = true;
      }
      if (r.compressed   != null) agg.compressed   += Number(r.compressed);
      if (r.uncompressed != null) agg.uncompressed += Number(r.uncompressed);
      if (r.min_val != null) agg.rawMins.push(r.min_val);
      if (r.max_val != null) agg.rawMaxs.push(r.max_val);
      if (r.compression && !agg.compression) agg.compression = String(r.compression);
    }

    for (const col of state.columns) {
      const agg = byCol.get(col.name);
      if (!agg) { col.meta = null; continue; }

      // Typed min/max per column category.
      // We avoid Math.min(...arr) because the array may exceed the call-stack
      // arg limit when row-group counts are very high; reduce() is safe.
      let typedMin = null, typedMax = null;
      if (agg.rawMins.length || agg.rawMaxs.length) {
        if (col.category === 'integer' || col.category === 'numeric') {
          const mins = agg.rawMins.map(v => Number(v)).filter(v => !isNaN(v));
          const maxs = agg.rawMaxs.map(v => Number(v)).filter(v => !isNaN(v));
          if (mins.length) typedMin = mins.reduce((a, b) => a < b ? a : b);
          if (maxs.length) typedMax = maxs.reduce((a, b) => a > b ? a : b);
        } else if (col.category === 'temporal' || col.category === 'string') {
          // ISO-8601 / DATE strings sort lexicographically — preserve as
          // strings. For VARCHAR we surface the lexicographic min/max as
          // well; it's the actual smallest/largest string value seen.
          const mins = agg.rawMins.map(String);
          const maxs = agg.rawMaxs.map(String);
          if (mins.length) typedMin = mins.reduce((a, b) => a < b ? a : b);
          if (maxs.length) typedMax = maxs.reduce((a, b) => a > b ? a : b);
        }
        // For boolean / binary / complex we deliberately don't surface a range.
      }

      col.meta = {
        nullCount: agg.nullCountSeen ? agg.nullCount : null,
        compressed: agg.compressed,
        uncompressed: agg.uncompressed,
        compressionRatio: agg.uncompressed > 0 ? agg.compressed / agg.uncompressed : null,
        min: typedMin,
        max: typedMax,
        compression: agg.compression,
        chunkCount: agg.chunkCount,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Background distinct-count batch
  //
  // The Parquet footer doesn't reliably carry stats_distinct_count (writers
  // only set it for dict-encoded columns, and even then it's per row group,
  // not summable across row groups). So we run ONE batched query post-load
  // that computes COUNT(DISTINCT col_i) for all eligible columns in a single
  // file scan. DuckDB executes this as a single pass with one hash set per
  // column, which is dramatically cheaper than N individual queries.
  //
  // The scan is non-blocking: cells start in a "..." loading state and get
  // filled in when the query returns. If the user loads another file before
  // this finishes, distinctScanId guards against the stale results landing.
  //
  // Complex types (STRUCT, MAP, LIST, ARRAY) are skipped — they'd dominate
  // the query string and aren't really useful for cardinality profiling.
  // -------------------------------------------------------------------------
  async function loadDistinctCounts() {
    const scanId = state.distinctScanId;
    const eligible = state.columns.filter(c => c.category !== 'complex');

    // Mark complex columns as known-skipped so their loading state clears
    for (const c of state.columns) {
      if (c.category === 'complex') {
        c.distinctCount = null;
        updateDistinctCell(c);
      }
    }
    if (!eligible.length) return;

    const aggParts = eligible.map((c, i) =>
      `COUNT(DISTINCT ${quoteIdent(c.name)})::BIGINT AS d_${i}`
    );
    const sql = `SELECT ${aggParts.join(', ')} FROM ${PARQUET_SQL}`;

    try {
      const res = await runQuery(sql);
      if (scanId !== state.distinctScanId) return;  // file changed mid-scan
      const row = rowsFromQuery(res)[0] || {};
      eligible.forEach((c, i) => {
        const v = row['d_' + i];
        c.distinctCount = (v == null) ? null : Number(v);
        updateDistinctCell(c);
      });
      maybeRefreshAfterDistinctLoaded();
    } catch (e) {
      console.warn('distinct-count batch failed:', e);
      if (scanId !== state.distinctScanId) return;
      // Per-column fallback so a single bad column doesn't strand all others
      for (const c of eligible) {
        if (c.distinctCount !== undefined) continue;
        try {
          const r = await runQuery(
            `SELECT COUNT(DISTINCT ${quoteIdent(c.name)})::BIGINT AS d FROM ${PARQUET_SQL}`
          );
          if (scanId !== state.distinctScanId) return;
          const v = rowsFromQuery(r)[0]?.d;
          c.distinctCount = (v == null) ? null : Number(v);
        } catch (e2) {
          c.distinctCount = null;
        }
        updateDistinctCell(c);
      }
      maybeRefreshAfterDistinctLoaded();
    }
  }

  function renderColumnDistinct(col) {
    if (col.distinctCount === undefined) {
      // Pending: complex types already marked at scan start, others get a
      // pulsing loading indicator
      if (col.category === 'complex') {
        return '<span class="pp-col-distinct-empty">\u2014</span>';
      }
      return '<span class="pp-col-distinct-loading" title="wird berechnet">\u2026</span>';
    }
    if (col.distinctCount === null) {
      return '<span class="pp-col-distinct-empty">\u2014</span>';
    }
    return `<span class="pp-col-distinct-val">${escapeHtml(formatNumber(col.distinctCount))}</span>`
         + `<span class="pp-col-distinct-label">eindeutig</span>`;
  }

  function updateDistinctCell(col) {
    const table = document.getElementById('pp-colsTable');
    if (!table) return;
    const row = table.querySelector(`tr.pp-cols-row[data-col="${CSS.escape(col.name)}"]`);
    if (!row) return;
    const cell = row.querySelector('.pp-cols-cell-distinct');
    if (cell) cell.innerHTML = renderColumnDistinct(col);
  }

  // Once all distinct counts have arrived, the user may already have sorted
  // or filtered by distinct — re-apply view in that case.
  function maybeRefreshAfterDistinctLoaded() {
    const t = state.colsTable;
    const needs = t.sortKey === 'distinct' || (t.filters && t.filters.distinct);
    if (needs) refreshColsTableBody();
    else updateColsMeta();
    // The Eindeutigkeit KPI depends on distinct counts — refresh it now.
    if (metaSection && !metaSection.hasAttribute('hidden')) renderMetaCards();
  }

  async function computeColumnStats(col) {
    const cacheKey = col.name;
    if (state.statsCache.has(cacheKey)) return state.statsCache.get(cacheKey);

    const id = quoteIdent(col.name);
    const from = `FROM ${PARQUET_SQL}`;

    // Common counts
    const commonRes = await runQuery(`
      SELECT
        COUNT(*)::BIGINT          AS total,
        COUNT(${id})::BIGINT       AS non_null,
        (COUNT(*) - COUNT(${id}))::BIGINT AS nulls
      ${from}
    `);
    const commonRow = rowsFromQuery(commonRes)[0];

    // Distinct count (approx for very large data)
    let distinct = null;
    try {
      const distRes = await runQuery(`
        SELECT COUNT(DISTINCT ${id})::BIGINT AS d ${from}
      `);
      distinct = rowsFromQuery(distRes)[0].d;
    } catch (e) {
      // Some types (LIST/STRUCT) don't support DISTINCT
      distinct = null;
    }

    const stats = {
      total: Number(commonRow.total),
      nonNull: Number(commonRow.non_null),
      nulls: Number(commonRow.nulls),
      distinct: distinct != null ? Number(distinct) : null,
      category: col.category,
    };

    if (stats.nonNull > 0) {
      try {
        if (col.category === 'integer' || col.category === 'numeric') {
          const numRes = await runQuery(`
            SELECT
              MIN(${id})::DOUBLE  AS mn,
              MAX(${id})::DOUBLE  AS mx,
              AVG(${id})::DOUBLE  AS avg,
              STDDEV_POP(${id})::DOUBLE AS sd,
              MEDIAN(${id})::DOUBLE AS med,
              QUANTILE_CONT(${id}, 0.25)::DOUBLE AS q1,
              QUANTILE_CONT(${id}, 0.75)::DOUBLE AS q3
            ${from}
          `);
          const r = rowsFromQuery(numRes)[0];
          stats.min = r.mn; stats.max = r.mx; stats.avg = r.avg; stats.std = r.sd;
          stats.median = r.med; stats.q1 = r.q1; stats.q3 = r.q3;
          stats.histogram = await computeHistogram(col, stats.min, stats.max);
        } else if (col.category === 'string' || col.category === 'binary' || col.category === 'other') {
          // String stats: top-N + length stats
          try {
            const lenRes = await runQuery(`
              SELECT
                MIN(LENGTH(${id})::INTEGER) AS min_len,
                MAX(LENGTH(${id})::INTEGER) AS max_len,
                AVG(LENGTH(${id})::DOUBLE)  AS avg_len
              ${from}
            `);
            const r = rowsFromQuery(lenRes)[0];
            stats.minLen = r.min_len; stats.maxLen = r.max_len; stats.avgLen = r.avg_len;
          } catch (e) { /* ignore */ }
          stats.topValues = await computeTopValues(col);
        } else if (col.category === 'temporal') {
          const tRes = await runQuery(`
            SELECT
              MIN(${id})::VARCHAR AS mn,
              MAX(${id})::VARCHAR AS mx
            ${from}
          `);
          const r = rowsFromQuery(tRes)[0];
          stats.min = r.mn; stats.max = r.mx;
          stats.timeBuckets = await computeTimeBuckets(col, r.mn, r.mx);
        } else if (col.category === 'boolean') {
          const bRes = await runQuery(`
            SELECT ${id} AS v, COUNT(*)::BIGINT AS c
            ${from}
            GROUP BY ${id}
          `);
          stats.boolCounts = rowsFromQuery(bRes).map(r => ({ value: r.v, count: Number(r.c) }));
        }
      } catch (e) {
        console.warn(`Stat computation partial failure for column ${col.name}:`, e);
      }
    }

    state.statsCache.set(cacheKey, stats);
    return stats;
  }

  async function computeHistogram(col, mn, mx) {
    if (mn == null || mx == null) return null;
    if (mn === mx) {
      // Degenerate: single value
      return { bins: [{ lower: mn, upper: mx, count: 0 }], min: mn, max: mx };
    }
    const id = quoteIdent(col.name);
    const from = `FROM ${PARQUET_SQL}`;
    const binCount = HIST_BINS;
    // Use width_bucket which is robust against floating point edge cases
    const sql = `
      WITH bounds AS (
        SELECT ${mn}::DOUBLE AS mn, ${mx}::DOUBLE AS mx
      ),
      binned AS (
        SELECT
          LEAST(
            ${binCount},
            GREATEST(1, CAST(FLOOR((${id}::DOUBLE - mn) / NULLIF((mx - mn), 0) * ${binCount}) AS INTEGER) + 1)
          ) AS bin_idx
        ${from} , bounds
        WHERE ${id} IS NOT NULL
      )
      SELECT bin_idx, COUNT(*)::BIGINT AS c
      FROM binned
      GROUP BY bin_idx
      ORDER BY bin_idx
    `;
    const res = await runQuery(sql);
    const rows = rowsFromQuery(res);
    const range = mx - mn;
    const step = range / binCount;
    // Build a complete bin array including empty bins
    const counts = new Array(binCount).fill(0);
    for (const r of rows) {
      const idx = Math.min(binCount - 1, Math.max(0, Number(r.bin_idx) - 1));
      counts[idx] += Number(r.c);
    }
    const bins = counts.map((c, i) => ({
      lower: mn + i * step,
      upper: mn + (i + 1) * step,
      count: c,
    }));
    return { bins, min: mn, max: mx };
  }

  async function computeTopValues(col) {
    const id = quoteIdent(col.name);
    const from = `FROM ${PARQUET_SQL}`;
    const sql = `
      SELECT ${id} AS v, COUNT(*)::BIGINT AS c
      ${from}
      WHERE ${id} IS NOT NULL
      GROUP BY ${id}
      ORDER BY c DESC, v ASC
      LIMIT ${TOPN_VALUES}
    `;
    const res = await runQuery(sql);
    return rowsFromQuery(res).map(r => ({ value: r.v, count: Number(r.c) }));
  }

  async function computeTimeBuckets(col, mnStr, mxStr) {
    const id = quoteIdent(col.name);
    const from = `FROM ${PARQUET_SQL}`;
    // Decide bucket granularity from range
    if (!mnStr || !mxStr) return null;
    const mn = new Date(mnStr);
    const mx = new Date(mxStr);
    if (isNaN(mn) || isNaN(mx)) return null;
    const days = (mx - mn) / (1000 * 60 * 60 * 24);
    let bucket;
    let dateFmt;
    if (days <= 2)            { bucket = 'hour';    dateFmt = '%Y-%m-%d %H:00'; }
    else if (days <= 60)      { bucket = 'day';     dateFmt = '%Y-%m-%d'; }
    else if (days <= 365 * 3) { bucket = 'month';   dateFmt = '%Y-%m'; }
    else                      { bucket = 'year';    dateFmt = '%Y'; }
    const sql = `
      SELECT
        strftime(date_trunc('${bucket}', ${id}::TIMESTAMP), '${dateFmt}') AS bucket,
        COUNT(*)::BIGINT AS c
      ${from}
      WHERE ${id} IS NOT NULL
      GROUP BY 1
      ORDER BY 1
      LIMIT 200
    `;
    try {
      const res = await runQuery(sql);
      const rows = rowsFromQuery(res);
      return { bucket, rows: rows.map(r => ({ label: r.bucket, count: Number(r.c) })) };
    } catch (e) {
      console.warn('time bucket fail', e);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Column body rendering
  // -------------------------------------------------------------------------
  function renderColumnContent(col, stats) {
    const cells = [];

    // === Stats grid ===
    cells.push(`<div class="pp-stat">
      <div class="pp-stat-label">Zeilen (gefiltert)</div>
      <div class="pp-stat-value">${formatNumber(stats.total)}</div>
    </div>`);
    cells.push(`<div class="pp-stat">
      <div class="pp-stat-label">Non-Null</div>
      <div class="pp-stat-value">${formatNumber(stats.nonNull)}</div>
      <div class="pp-meta-card-sub">${stats.total ? ((stats.nonNull / stats.total) * 100).toFixed(1) : '0'} %</div>
    </div>`);
    cells.push(`<div class="pp-stat">
      <div class="pp-stat-label">Null-Werte</div>
      <div class="pp-stat-value">${formatNumber(stats.nulls)}</div>
      <div class="pp-meta-card-sub">${stats.total ? ((stats.nulls / stats.total) * 100).toFixed(1) : '0'} %</div>
    </div>`);
    if (stats.distinct != null) {
      cells.push(`<div class="pp-stat">
        <div class="pp-stat-label">Eindeutige Werte</div>
        <div class="pp-stat-value">${formatNumber(stats.distinct)}</div>
        <div class="pp-meta-card-sub">${
          stats.nonNull ? ((stats.distinct / stats.nonNull) * 100).toFixed(1) + ' % der Non-Null' : ''
        }</div>
      </div>`);
    }

    if (col.category === 'integer' || col.category === 'numeric') {
      cells.push(numStat('Min', stats.min, col.category));
      cells.push(numStat('Max', stats.max, col.category));
      cells.push(numStat('Mittelwert', stats.avg, col.category));
      cells.push(numStat('Median', stats.median, col.category));
      cells.push(numStat('Std.-Abw.', stats.std, col.category));
      cells.push(numStat('Q1', stats.q1, col.category));
      cells.push(numStat('Q3', stats.q3, col.category));
    } else if (col.category === 'string' || col.category === 'binary' || col.category === 'other') {
      if (stats.minLen != null) cells.push(numStat('Min. Länge', stats.minLen, 'integer'));
      if (stats.maxLen != null) cells.push(numStat('Max. Länge', stats.maxLen, 'integer'));
      if (stats.avgLen != null) cells.push(numStat('\u2300 Länge', stats.avgLen, 'numeric'));
    } else if (col.category === 'temporal') {
      cells.push(`<div class="pp-stat">
        <div class="pp-stat-label">Frühestes</div>
        <div class="pp-stat-value pp-mono">${escapeHtml(stats.min ?? '\u2014')}</div>
      </div>`);
      cells.push(`<div class="pp-stat">
        <div class="pp-stat-label">Spätestes</div>
        <div class="pp-stat-value pp-mono">${escapeHtml(stats.max ?? '\u2014')}</div>
      </div>`);
    }

    let html = `<div class="pp-stats-grid">${cells.join('')}</div>`;

    // === Chart ===
    if (col.category === 'integer' || col.category === 'numeric') {
      if (stats.histogram) {
        html += `<div class="pp-chart-wrap">
          <h4>Histogramm (${HIST_BINS} Bins)</h4>
          <div class="pp-chart-canvas-wrap"><canvas id="pp-chart-${cssId(col.name)}"></canvas></div>
        </div>`;
      }
    } else if (col.category === 'string' || col.category === 'binary' || col.category === 'other') {
      if (stats.topValues && stats.topValues.length) {
        html += `<div class="pp-chart-wrap">
          <h4>Top ${stats.topValues.length} häufigste Werte</h4>
          ${renderTopValuesList(stats, col)}
        </div>`;
      }
    } else if (col.category === 'temporal') {
      if (stats.timeBuckets && stats.timeBuckets.rows.length) {
        html += `<div class="pp-chart-wrap">
          <h4>Verteilung (${escapeHtml(stats.timeBuckets.bucket)})</h4>
          <div class="pp-chart-canvas-wrap"><canvas id="pp-chart-${cssId(col.name)}"></canvas></div>
        </div>`;
      }
    } else if (col.category === 'boolean') {
      if (stats.boolCounts && stats.boolCounts.length) {
        html += `<div class="pp-chart-wrap">
          <h4>Verteilung</h4>
          <div class="pp-chart-canvas-wrap"><canvas id="pp-chart-${cssId(col.name)}"></canvas></div>
        </div>`;
      }
    }

    return html;
  }

  function numStat(label, val, type) {
    return `<div class="pp-stat">
      <div class="pp-stat-label">${escapeHtml(label)}</div>
      <div class="pp-stat-value pp-mono">${escapeHtml(formatStat(val, type))}</div>
    </div>`;
  }

  function cssId(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  // -------------------------------------------------------------------------
  // Charts
  // -------------------------------------------------------------------------
  function destroyChartFor(canvasId) {
    const ex = state.charts.get(canvasId);
    if (ex) { ex.destroy(); state.charts.delete(canvasId); }
  }
  function destroyAllCharts() {
    state.charts.forEach(c => c.destroy());
    state.charts.clear();
  }

  // Render the top-N values as a readable list (rank, value, relative bar,
  // count, percentage of non-null). Replaces the previous horizontal bar
  // chart for string-like columns where you couldn't see the labels without
  // hovering each bar.
  function renderTopValuesList(stats, col) {
    if (!stats.topValues || !stats.topValues.length) return '';
    // Bar scales relative to the top value, so the most frequent gets a
    // full-width fill and visual ranking is immediately obvious.
    const maxCount = Number(stats.topValues[0].count) || 1;
    const nonNull = Number(stats.nonNull) || 0;
    const rows = stats.topValues.map((tv, i) => {
      const count = Number(tv.count);
      const pctOfNonNull = nonNull > 0 ? (count / nonNull) * 100 : 0;
      const barWidth = (count / maxCount) * 100;
      const valStr = (tv.value == null) ? '' : String(tv.value);
      const isEmpty = valStr.length === 0;
      const display = isEmpty ? '(leerer String)' : valStr;
      return `
        <div class="pp-topvalues-row">
          <span class="pp-topvalues-rank">${i + 1}</span>
          <span class="pp-topvalues-value ${isEmpty ? 'pp-topvalues-empty' : ''}"
                title="${escapeHtml(valStr)}">${escapeHtml(display)}</span>
          <span class="pp-topvalues-bar" aria-hidden="true">
            <span class="pp-topvalues-bar-fill" style="width:${barWidth.toFixed(1)}%"></span>
          </span>
          <span class="pp-topvalues-count" title="Anzahl">${escapeHtml(formatNumber(count))}</span>
          <span class="pp-topvalues-pct" title="Anteil an Non-NULL-Werten">${pctOfNonNull.toFixed(1)} %</span>
        </div>
      `;
    }).join('');
    return `<div class="pp-topvalues" role="list">${rows}</div>`;
  }

  function drawColumnCharts(col, body, stats) {
    const canvasId = `pp-chart-${cssId(col.name)}`;
    const canvas = body.querySelector(`#${CSS.escape(canvasId)}`);
    if (!canvas) return;
    destroyChartFor(canvasId);

    const fontFamily = getComputedStyle(document.body).getPropertyValue('--qrx-font-sans').trim() ||
      'system-ui, sans-serif';
    const textColor  = getComputedStyle(document.body).getPropertyValue('--qrx-text').trim() || '#0E2530';
    const mutedColor = getComputedStyle(document.body).getPropertyValue('--qrx-text-muted').trim() || '#5A6B75';
    const blueColor  = getComputedStyle(document.body).getPropertyValue('--qrx-blue').trim() || '#156B8E';
    const greenColor = getComputedStyle(document.body).getPropertyValue('--qrx-green').trim() || '#2EC4A2';
    const gridColor  = getComputedStyle(document.body).getPropertyValue('--qrx-border').trim() || '#DBE3E8';

    Chart.defaults.font.family = fontFamily;
    Chart.defaults.color = mutedColor;

    let config;

    if (col.category === 'integer' || col.category === 'numeric') {
      const hist = stats.histogram;
      const labels = hist.bins.map(b => formatBinLabel(b.lower, b.upper, col.category));
      config = {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Anzahl',
            data: hist.bins.map(b => b.count),
            backgroundColor: blueColor,
            borderColor: blueColor,
            borderWidth: 0,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
          }]
        },
        options: chartCommon({ xLabel: col.name, yLabel: 'Anzahl', gridColor, textColor }),
      };
    } else if (col.category === 'string' || col.category === 'binary' || col.category === 'other') {
      const top = stats.topValues;
      config = {
        type: 'bar',
        data: {
          labels: top.map(t => truncate(String(t.value), 40)),
          datasets: [{
            label: 'Anzahl',
            data: top.map(t => t.count),
            backgroundColor: greenColor,
            borderColor: greenColor,
            borderWidth: 0,
          }]
        },
        options: Object.assign(chartCommon({ xLabel: 'Anzahl', yLabel: col.name, gridColor, textColor }), {
          indexAxis: 'y',
        }),
      };
    } else if (col.category === 'temporal') {
      const tb = stats.timeBuckets;
      config = {
        type: 'bar',
        data: {
          labels: tb.rows.map(r => r.label),
          datasets: [{
            label: 'Anzahl',
            data: tb.rows.map(r => r.count),
            backgroundColor: blueColor,
            borderColor: blueColor,
            borderWidth: 0,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
          }]
        },
        options: chartCommon({ xLabel: tb.bucket, yLabel: 'Anzahl', gridColor, textColor }),
      };
    } else if (col.category === 'boolean') {
      const bc = stats.boolCounts;
      const labels = bc.map(b => b.value == null ? 'NULL' : (b.value ? 'TRUE' : 'FALSE'));
      const colors = bc.map(b => b.value == null ? mutedColor : (b.value ? greenColor : blueColor));
      config = {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: bc.map(b => b.count),
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: getComputedStyle(document.body).getPropertyValue('--qrx-surface').trim() || '#FFFFFF',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'right' },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.label}: ${formatNumber(ctx.parsed)} (${
                  ((ctx.parsed / bc.reduce((s, b) => s + b.count, 0)) * 100).toFixed(1)
                } %)`
              }
            }
          }
        }
      };
    }

    if (config) {
      const chart = new Chart(canvas, config);
      state.charts.set(canvasId, chart);
    }
  }

  function chartCommon({ xLabel, yLabel, gridColor, textColor }) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${formatNumber(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed)}`
          }
        }
      },
      scales: {
        x: {
          title: { display: !!xLabel, text: xLabel || '', color: textColor },
          ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 },
          grid: { color: gridColor, drawTicks: false },
        },
        y: {
          title: { display: !!yLabel, text: yLabel || '', color: textColor },
          ticks: {
            callback: v => formatNumber(v),
          },
          grid: { color: gridColor, drawTicks: false },
          beginAtZero: true,
        }
      }
    };
  }

  function formatBinLabel(lower, upper, category) {
    const f = v => {
      if (category === 'integer') return Math.round(v).toString();
      const abs = Math.abs(v);
      if (abs >= 1000 || abs === 0) return v.toLocaleString('de-DE', { maximumFractionDigits: 1 });
      return v.toLocaleString('de-DE', { maximumFractionDigits: 3 });
    };
    return `${f(lower)} – ${f(upper)}`;
  }

  // -------------------------------------------------------------------------
  // Filter panel
  // -------------------------------------------------------------------------
  function renderFilterPanel(col, stats) {
    const f = state.filters[col.name];
    const isNumeric  = col.category === 'integer' || col.category === 'numeric';
    const isTemporal = col.category === 'temporal';
    const supportsRange  = isNumeric || isTemporal;
    const supportsValues = !['complex'].includes(col.category);

    // Default mode: range for numeric/temporal, values otherwise
    const mode = (f && f.kind) || (supportsRange ? 'range' : 'values');

    let html = `<div class="pp-filter-panel" data-col="${escapeHtml(col.name)}">
      <h4>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        Filter
      </h4>`;

    if (supportsRange && supportsValues) {
      html += `<div class="pp-filter-tabs">
        <button class="pp-filter-tab ${mode === 'range' ? 'pp-active' : ''}" data-mode="range">
          Bereich
        </button>
        <button class="pp-filter-tab ${mode === 'values' ? 'pp-active' : ''}" data-mode="values">
          Werteliste
        </button>
      </div>`;
    }

    html += `<div class="pp-filter-content" data-mode="${mode}">`;
    if (mode === 'range') {
      html += renderRangeFilter(col, stats, f);
    } else if (col.category === 'complex') {
      html += `<p style="color:var(--qrx-text-muted);font-size:.875rem;margin:0;">
        Filterung wird für komplexe Typen (${escapeHtml(col.type)}) nicht unterstützt.
      </p>`;
    } else {
      html += renderValuesFilterPlaceholder(col);
    }
    html += `</div>`;

    html += `<div class="pp-filter-actions">
      <span class="pp-filter-summary" data-role="summary"></span>
      <button class="qrx-btn qrx-btn-sm" data-action="clear" type="button">Entfernen</button>
      <button class="qrx-btn qrx-btn-sm qrx-btn-primary" data-action="apply" type="button">Anwenden</button>
    </div>`;
    html += `</div>`;
    return html;
  }

  function renderRangeFilter(col, stats, f) {
    const mn = (col.category === 'temporal') ? (stats.min ?? '') : (stats.min ?? '');
    const mx = (col.category === 'temporal') ? (stats.max ?? '') : (stats.max ?? '');
    const curMin = (f && f.kind === 'range' && f.min != null) ? f.min : '';
    const curMax = (f && f.kind === 'range' && f.max != null) ? f.max : '';
    const includeNull = !!(f && f.includeNull);
    const placeholderMin = mn === '' ? '' : (typeof mn === 'number' ? formatStat(mn, col.category) : String(mn));
    const placeholderMax = mx === '' ? '' : (typeof mx === 'number' ? formatStat(mx, col.category) : String(mx));
    return `
      <div class="pp-filter-range">
        <div class="qrx-form-group" style="margin:0;">
          <label class="qrx-label">Von (≥)</label>
          <input type="text" class="qrx-input" data-role="range-min"
                 placeholder="${escapeHtml(placeholderMin)}" value="${escapeHtml(curMin)}">
        </div>
        <div class="qrx-form-group" style="margin:0;">
          <label class="qrx-label">Bis (≤)</label>
          <input type="text" class="qrx-input" data-role="range-max"
                 placeholder="${escapeHtml(placeholderMax)}" value="${escapeHtml(curMax)}">
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:.5rem;font-size:.875rem;color:var(--qrx-text-muted);">
        <input type="checkbox" data-role="include-null" ${includeNull ? 'checked' : ''}>
        NULL-Werte einschließen
      </label>
    `;
  }

  function renderValuesFilterPlaceholder(col) {
    return `
      <div class="pp-filter-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" class="qrx-input" data-role="filter-search" placeholder="Werte suchen \u2026">
      </div>
      <div class="pp-filter-toolbar">
        <button class="qrx-btn qrx-btn-sm" data-action="select-all" type="button">Alle auswählen</button>
        <button class="qrx-btn qrx-btn-sm" data-action="deselect-all" type="button">Alle abwählen</button>
      </div>
      <div class="pp-filter-values" data-role="filter-values">
        <div class="pp-section-loading">
          <div class="pp-spinner" aria-hidden="true"></div>
          <span>Werte werden geladen \u2026</span>
        </div>
      </div>
    `;
  }

  function attachFilterPanelHandlers(col, root, stats, onApplyOrClear) {
    const panel = root.querySelector('.pp-filter-panel');
    if (!panel) return;
    const summary = panel.querySelector('[data-role="summary"]');
    const updateSummary = () => {
      const mode = panel.querySelector('.pp-filter-content').dataset.mode;
      if (mode === 'values') {
        const checkedBoxes = panel.querySelectorAll('input[type="checkbox"][data-value-row]:checked');
        const total = panel.querySelectorAll('input[type="checkbox"][data-value-row]').length;
        summary.textContent = `${checkedBoxes.length} / ${total} ausgewählt`;
      } else {
        summary.textContent = '';
      }
    };

    // Tab switching
    panel.querySelectorAll('.pp-filter-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        const mode = tab.dataset.mode;
        panel.querySelectorAll('.pp-filter-tab').forEach(t => t.classList.toggle('pp-active', t === tab));
        const content = panel.querySelector('.pp-filter-content');
        content.dataset.mode = mode;
        if (mode === 'range') {
          content.innerHTML = renderRangeFilter(col, stats, state.filters[col.name]);
          updateSummary();
        } else {
          content.innerHTML = renderValuesFilterPlaceholder(col);
          await loadValuesIntoPanel(col, panel);
          updateSummary();
        }
      });
    });

    // Apply/clear
    panel.querySelector('[data-action="apply"]').addEventListener('click', () => {
      const mode = panel.querySelector('.pp-filter-content').dataset.mode;
      if (col.category === 'complex') return;
      let newFilter = null;
      if (mode === 'range') {
        const minIn = panel.querySelector('[data-role="range-min"]').value.trim();
        const maxIn = panel.querySelector('[data-role="range-max"]').value.trim();
        const inclNull = panel.querySelector('[data-role="include-null"]').checked;
        if (minIn === '' && maxIn === '' && !inclNull) {
          // empty => no filter
        } else {
          newFilter = {
            kind: 'range',
            min: minIn === '' ? null : minIn,
            max: maxIn === '' ? null : maxIn,
            includeNull: inclNull,
          };
        }
      } else {
        const boxes = panel.querySelectorAll('input[type="checkbox"][data-value-row]');
        const selected = [];
        let includeNull = false;
        boxes.forEach(b => {
          if (!b.checked) return;
          if (b.dataset.isNull === '1') { includeNull = true; }
          else { selected.push(b.dataset.value); }
        });
        if (boxes.length === 0) {
          // nothing loaded
        } else if (selected.length === boxes.length - (Array.from(boxes).some(b => b.dataset.isNull === '1') ? 1 : 0) &&
                   (!Array.from(boxes).some(b => b.dataset.isNull === '1') || includeNull)) {
          // All selected => no filter
          newFilter = null;
        } else {
          newFilter = {
            kind: 'values',
            values: selected,
            includeNull,
          };
        }
      }
      if (typeof onApplyOrClear === 'function') onApplyOrClear();
      setFilter(col.name, newFilter);
    });

    panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
      if (typeof onApplyOrClear === 'function') onApplyOrClear();
      setFilter(col.name, null);
    });

    // Values mode auto-load
    if (panel.querySelector('.pp-filter-content').dataset.mode === 'values' &&
        col.category !== 'complex') {
      loadValuesIntoPanel(col, panel).then(updateSummary);
    }

    // Range bounds: changes only fire on apply
    panel.addEventListener('change', updateSummary);
    panel.addEventListener('input',  updateSummary);
  }

  async function loadValuesIntoPanel(col, panel) {
    const container = panel.querySelector('[data-role="filter-values"]');
    if (!container) return;
    try {
      // Cache key without this column's own filter
      const cacheKey = `${col.name}|${hashFilters(col.name)}`;
      let values;
      if (state.filterCache.has(cacheKey)) {
        values = state.filterCache.get(cacheKey);
      } else {
        values = await loadDistinctValuesForFilter(col);
        state.filterCache.set(cacheKey, values);
      }
      renderFilterValues(col, panel, container, values);
      attachFilterValueHandlers(col, panel);
    } catch (e) {
      console.error(e);
      container.innerHTML = `<div class="pp-error" style="margin:0;border-radius:0;border:none;">
        <strong>Werte konnten nicht geladen werden</strong>
        <pre>${escapeHtml(e && e.message || String(e))}</pre>
      </div>`;
    }
  }

  async function loadDistinctValuesForFilter(col) {
    const id = quoteIdent(col.name);
    // Build a WHERE clause EXCLUDING this column's own filter so the list is stable
    const from = `FROM ${PARQUET_SQL}${buildWhereClause(col.name)}`;
    // Plain values
    const sql = `
      SELECT ${id} AS v, COUNT(*)::BIGINT AS c
      ${from}
      GROUP BY ${id}
      ORDER BY c DESC, v ASC
      LIMIT ${FILTER_DISTINCT_LIMIT + 1}
    `;
    const res = await runQuery(sql);
    const rows = rowsFromQuery(res);
    const truncated = rows.length > FILTER_DISTINCT_LIMIT;
    if (truncated) rows.length = FILTER_DISTINCT_LIMIT;
    const nullRow = rows.find(r => r.v == null);
    const nonNull = rows.filter(r => r.v != null);
    return {
      values: nonNull.map(r => ({ value: r.v, count: Number(r.c) })),
      nullCount: nullRow ? Number(nullRow.c) : 0,
      truncated,
    };
  }

  function renderFilterValues(col, panel, container, src) {
    const currentFilter = state.filters[col.name];
    const isFilteredByValues = currentFilter && currentFilter.kind === 'values';
    const checkedValues = isFilteredByValues ? new Set(currentFilter.values.map(String)) : null;
    const checkedNull = isFilteredByValues ? !!currentFilter.includeNull : true;

    const rowsHtml = [];
    if (src.nullCount > 0) {
      const checked = isFilteredByValues ? checkedNull : true;
      rowsHtml.push(`
        <label class="pp-filter-value-row">
          <input type="checkbox" data-value-row data-is-null="1" ${checked ? 'checked' : ''}>
          <span class="pp-filter-value-label pp-null">(NULL)</span>
          <span class="pp-filter-value-count">${formatNumber(src.nullCount)}</span>
        </label>
      `);
    }
    for (const v of src.values) {
      const strVal = (typeof v.value === 'bigint') ? v.value.toString() : String(v.value);
      const display = (typeof v.value === 'boolean') ? (v.value ? 'TRUE' : 'FALSE') : strVal;
      const checked = isFilteredByValues ? checkedValues.has(strVal) : true;
      rowsHtml.push(`
        <label class="pp-filter-value-row" data-search="${escapeHtml(display.toLowerCase())}">
          <input type="checkbox" data-value-row data-value="${escapeHtml(strVal)}" ${checked ? 'checked' : ''}>
          <span class="pp-filter-value-label" title="${escapeHtml(display)}">${escapeHtml(display)}</span>
          <span class="pp-filter-value-count">${formatNumber(v.count)}</span>
        </label>
      `);
    }
    if (src.truncated) {
      rowsHtml.push(`
        <div class="pp-filter-value-row" style="cursor:default;justify-content:center;font-style:italic;color:var(--qrx-warning);">
          Liste auf ${formatNumber(FILTER_DISTINCT_LIMIT)} Werte gekürzt
        </div>`);
    }
    container.innerHTML = rowsHtml.join('') || `<div class="pp-section-loading"><span>Keine Werte vorhanden</span></div>`;
  }

  function attachFilterValueHandlers(col, panel) {
    const search = panel.querySelector('[data-role="filter-search"]');
    const container = panel.querySelector('[data-role="filter-values"]');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        const rows = container.querySelectorAll('.pp-filter-value-row');
        rows.forEach(r => {
          const s = r.dataset.search || '';
          r.style.display = !q || s.includes(q) ? '' : 'none';
        });
      });
    }
    const selAll = panel.querySelector('[data-action="select-all"]');
    const deselAll = panel.querySelector('[data-action="deselect-all"]');
    selAll && selAll.addEventListener('click', () => {
      container.querySelectorAll('.pp-filter-value-row').forEach(r => {
        if (r.style.display === 'none') return;
        const cb = r.querySelector('input[type="checkbox"]'); if (cb) cb.checked = true;
      });
    });
    deselAll && deselAll.addEventListener('click', () => {
      container.querySelectorAll('.pp-filter-value-row').forEach(r => {
        if (r.style.display === 'none') return;
        const cb = r.querySelector('input[type="checkbox"]'); if (cb) cb.checked = false;
      });
    });
  }

  // -------------------------------------------------------------------------
  // Filter state operations
  // -------------------------------------------------------------------------
  async function setFilter(colName, filter) {
    if (filter == null) {
      delete state.filters[colName];
    } else {
      state.filters[colName] = filter;
    }
    // Stats cache is filter-independent; only the filter value-list cache must reset
    state.filterCache.clear();

    await applyFiltersAndRefresh();
  }

  async function applyFiltersAndRefresh() {
    if (state.snapshotMode) return;  // filtering needs a live DuckDB connection
    try {
      // Recompute filtered row count
      const r = await runQuery(`SELECT COUNT(*)::BIGINT AS c FROM ${PARQUET_SQL}${buildWhereClause()}`);
      state.rowCountFiltered = Number(rowsFromQuery(r)[0].c);
    } catch (e) {
      console.error('row count failed', e);
    }
    state.previewPage = 0;
    renderActiveFilters();
    await refreshPreview();
  }

  function renderActiveFilters() {
    const keys = Object.keys(state.filters);
    if (!keys.length) {
      previewFilters.setAttribute('hidden', '');
      filtersList.innerHTML = '';
      filterResult.innerHTML = '';
      return;
    }
    previewFilters.removeAttribute('hidden');
    filtersList.innerHTML = keys.map(k => {
      const f = state.filters[k];
      let desc;
      if (f.kind === 'range') {
        const parts = [];
        if (f.min != null && f.min !== '') parts.push(`≥ ${escapeHtml(String(f.min))}`);
        if (f.max != null && f.max !== '') parts.push(`≤ ${escapeHtml(String(f.max))}`);
        if (f.includeNull) parts.push('NULL');
        desc = parts.join(', ') || 'kein Bereich';
      } else if (f.kind === 'values') {
        const total = f.values.length + (f.includeNull ? 1 : 0);
        desc = `${total} Wert${total === 1 ? '' : 'e'}`;
        if (f.includeNull) desc += ' (inkl. NULL)';
      } else {
        desc = '?';
      }
      return `
        <span class="pp-filter-chip" data-col="${escapeHtml(k)}">
          <span class="pp-filter-chip-col">${escapeHtml(k)}</span>
          <span class="pp-filter-chip-val">${desc}</span>
          <button type="button" data-action="remove-filter" aria-label="Filter entfernen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </span>
      `;
    }).join('');
    filterResult.innerHTML = `
      <strong>${formatNumber(state.rowCountFiltered)}</strong> von
      <strong>${formatNumber(state.rowCountTotal)}</strong> Zeilen gefiltert
      (${state.rowCountTotal
          ? ((state.rowCountFiltered / state.rowCountTotal) * 100).toFixed(1)
          : '0'} %)
    `;
    filtersList.querySelectorAll('[data-action="remove-filter"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const chip = e.currentTarget.closest('.pp-filter-chip');
        const col = chip.dataset.col;
        setFilter(col, null);
      });
    });
  }

  clearFiltersBtn.addEventListener('click', async () => {
    state.filters = {};
    state.filterCache.clear();
    closeFilterPopover();
    await applyFiltersAndRefresh();
  });

  // -------------------------------------------------------------------------
  // Data preview + pagination
  // -------------------------------------------------------------------------
  previewLimitSel.addEventListener('change', () => {
    state.previewLimit = parseInt(previewLimitSel.value, 10) || 100;
    state.previewPage = 0;
    refreshPreview();
  });

  paginationBar.addEventListener('click', e => {
    const btn = e.target.closest('[data-page-action]');
    if (!btn) return;
    const action = btn.dataset.pageAction;
    const lim = state.previewLimit || 100;
    const total = state.rowCountFiltered || 0;
    const pageCount = Math.max(1, Math.ceil(total / lim));
    let next = state.previewPage;
    if (action === 'first') next = 0;
    else if (action === 'prev')  next = Math.max(0, state.previewPage - 1);
    else if (action === 'next')  next = Math.min(pageCount - 1, state.previewPage + 1);
    else if (action === 'last')  next = pageCount - 1;
    if (next === state.previewPage) return;
    state.previewPage = next;
    refreshPreview();
  });

  pageJumpInput.addEventListener('change', () => {
    const lim = state.previewLimit || 100;
    const total = state.rowCountFiltered || 0;
    const pageCount = Math.max(1, Math.ceil(total / lim));
    let p = parseInt(pageJumpInput.value, 10);
    if (isNaN(p) || p < 1) p = 1;
    if (p > pageCount) p = pageCount;
    pageJumpInput.value = String(p);
    if (p - 1 !== state.previewPage) {
      state.previewPage = p - 1;
      refreshPreview();
    }
  });

  async function refreshPreview() {
    if (state.snapshotMode) return;  // no live data behind a static snapshot
    if (!state.columns.length) return;
    const lim = state.previewLimit || 100;
    const total = state.rowCountFiltered || 0;
    const pageCount = Math.max(1, Math.ceil(total / lim));
    if (state.previewPage >= pageCount) state.previewPage = pageCount - 1;
    if (state.previewPage < 0) state.previewPage = 0;
    const offset = state.previewPage * lim;
    const sql = `SELECT * FROM ${PARQUET_SQL}${buildWhereClause()} LIMIT ${lim} OFFSET ${offset}`;
    try {
      const res = await runQuery(sql);
      const rows = rowsFromQuery(res);
      renderPreviewTable(rows);
      const from = total === 0 ? 0 : offset + 1;
      const to   = Math.min(offset + rows.length, total);
      previewMeta.textContent = total === 0
        ? 'Keine Zeilen'
        : `Zeile ${formatNumber(from)}–${formatNumber(to)} von ${formatNumber(total)}`;
      // Mirror a compact form into the section summary
      const sum = document.getElementById('pp-previewSummaryCount');
      if (sum) {
        const grand = state.rowCountTotal;
        if (total === grand) sum.textContent = `${formatNumber(total)} Zeilen`;
        else sum.textContent = `${formatNumber(total)} von ${formatNumber(grand)} Zeilen`;
      }
      renderPagination(pageCount);
    } catch (e) {
      console.error('preview failed', e);
      previewTable.tHead.innerHTML = '';
      previewTable.tBodies[0].innerHTML = `<tr><td>Vorschau konnte nicht erzeugt werden: ${escapeHtml(e && e.message || String(e))}</td></tr>`;
      paginationBar.setAttribute('hidden', '');
    }
  }

  function renderPagination(pageCount) {
    if (pageCount <= 1) {
      paginationBar.setAttribute('hidden', '');
      return;
    }
    paginationBar.removeAttribute('hidden');
    const p = state.previewPage;
    paginationInfo.innerHTML = `Seite <strong>${formatNumber(p + 1)}</strong> von <strong>${formatNumber(pageCount)}</strong>`;
    pageJumpInput.max = String(pageCount);
    pageJumpInput.value = String(p + 1);
    const first = paginationBar.querySelector('[data-page-action="first"]');
    const prev  = paginationBar.querySelector('[data-page-action="prev"]');
    const next  = paginationBar.querySelector('[data-page-action="next"]');
    const last  = paginationBar.querySelector('[data-page-action="last"]');
    [first, prev].forEach(b => b.toggleAttribute('disabled', p <= 0));
    [next, last].forEach(b => b.toggleAttribute('disabled', p >= pageCount - 1));
  }

  function renderPreviewTable(rows) {
    const cols = state.columns;
    const thead = previewTable.tHead;
    const tbody = previewTable.tBodies[0];
    thead.innerHTML = '<tr>' + cols.map(c => {
      const hasFilter = !!state.filters[c.name];
      const cls = hasFilter ? ' class="pp-th-filtered"' : '';
      const btnCls = hasFilter ? 'pp-th-filter-btn pp-active' : 'pp-th-filter-btn';
      const aria = hasFilter ? 'Filter (aktiv) öffnen' : 'Filter öffnen';
      // Funnel icon
      const icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>`;
      return `<th${cls}>
        <span class="pp-th-content">
          <span class="pp-th-name">${escapeHtml(c.name)}</span>
          <span class="pp-th-type">${escapeHtml(c.type)}</span>
          <button type="button" class="${btnCls}"
                  data-action="open-filter" data-col="${escapeHtml(c.name)}"
                  aria-label="${aria}" title="${aria}">${icon}</button>
        </span>
      </th>`;
    }).join('') + '</tr>';
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" style="text-align:center;color:var(--qrx-text-muted);padding:1.5rem;">Keine Zeilen</td></tr>`;
      return;
    }
    const html = rows.map(r => {
      return '<tr>' + cols.map(c => {
        const cell = formatCellValue(r[c.name]);
        return `<td class="${cell.isNull ? 'pp-null' : ''}" title="${escapeHtml(cell.text)}">${escapeHtml(cell.text)}</td>`;
      }).join('') + '</tr>';
    }).join('');
    tbody.innerHTML = html;
    // Wire up header filter buttons
    thead.querySelectorAll('[data-action="open-filter"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const colName = btn.dataset.col;
        openFilterPopover(colName, btn);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Header filter popover (Excel-style)
  // -------------------------------------------------------------------------
  let activePopover = null;
  function closeFilterPopover() {
    if (activePopover && activePopover.parentNode) {
      activePopover.parentNode.removeChild(activePopover);
    }
    activePopover = null;
    document.removeEventListener('mousedown', onDocMouseDownForPopover, true);
    document.removeEventListener('keydown', onDocKeyDownForPopover, true);
    window.removeEventListener('resize', closeFilterPopover);
    window.removeEventListener('scroll', closeFilterPopover, true);
  }
  function onDocMouseDownForPopover(e) {
    if (!activePopover) return;
    if (activePopover.contains(e.target)) return;
    // Keep open if clicking the trigger button (the click handler then toggles)
    const previewBtn = e.target.closest && e.target.closest('[data-action="open-filter"]');
    if (previewBtn && previewBtn.dataset.col === activePopover.dataset.col) return;
    const colsBtn = e.target.closest && e.target.closest('[data-action="open-cols-filter"]');
    if (colsBtn && colsBtn.dataset.field === activePopover.dataset.colsField) return;
    closeFilterPopover();
  }
  function onDocKeyDownForPopover(e) {
    if (e.key === 'Escape') closeFilterPopover();
  }

  async function openFilterPopover(colName, triggerBtn) {
    // Toggle: if already open for same column, close
    if (activePopover && activePopover.dataset.col === colName) {
      closeFilterPopover();
      return;
    }
    closeFilterPopover();
    const col = state.columns.find(c => c.name === colName);
    if (!col) return;

    // We need stats for min/max placeholders (range mode). Use cached if available,
    // otherwise compute (this is cheap for one column and shared with the column view).
    let stats;
    try {
      stats = await computeColumnStats(col);
    } catch (e) {
      // Fall back to an empty stats object; range mode shows blank placeholders
      stats = { min: null, max: null, total: 0, nonNull: 0, nulls: 0, distinct: 0 };
    }

    const pop = document.createElement('div');
    pop.className = 'pp-filter-popover';
    pop.dataset.col = colName;
    pop.innerHTML = renderFilterPanel(col, stats);
    document.body.appendChild(pop);
    activePopover = pop;

    // Position below trigger
    positionPopover(pop, triggerBtn);

    // Wire up panel handlers (Apply closes popover)
    attachFilterPanelHandlers(col, pop, stats, /*onApplyOrClear=*/closeFilterPopover);

    // Outside click + Esc + viewport changes
    document.addEventListener('mousedown', onDocMouseDownForPopover, true);
    document.addEventListener('keydown',  onDocKeyDownForPopover, true);
    window.addEventListener('resize', closeFilterPopover);
    window.addEventListener('scroll', closeFilterPopover, true);
  }

  function positionPopover(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const margin = 8;
    let left = r.left;
    let top  = r.bottom + 4;
    if (left + w > window.innerWidth - margin)  left = Math.max(margin, window.innerWidth - margin - w);
    if (top  + h > window.innerHeight - margin) top  = Math.max(margin, r.top - h - 4);
    pop.style.left = `${left}px`;
    pop.style.top  = `${top}px`;
  }

  // -------------------------------------------------------------------------
  // Cols-table filter popover (filters operate in JS, not SQL)
  // -------------------------------------------------------------------------
  function openColsFilterPopover(fieldId, triggerBtn) {
    const def = COLS_FIELDS.find(f => f.id === fieldId);
    if (!def || !def.filterable) return;
    if (activePopover && activePopover.dataset.colsField === fieldId) {
      closeFilterPopover(); return;
    }
    closeFilterPopover();

    const pop = document.createElement('div');
    pop.className = 'pp-filter-popover';
    pop.dataset.colsField = fieldId;
    pop.innerHTML = renderColsFilterPanel(def);
    document.body.appendChild(pop);
    activePopover = pop;
    positionPopover(pop, triggerBtn);
    attachColsFilterPanelHandlers(def, pop);

    document.addEventListener('mousedown', onDocMouseDownForPopover, true);
    document.addEventListener('keydown',  onDocKeyDownForPopover, true);
    window.addEventListener('resize', closeFilterPopover);
    window.addEventListener('scroll', closeFilterPopover, true);
  }

  function renderColsFilterPanel(def) {
    const current = state.colsTable.filters[def.id];
    const titleIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                         <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                       </svg>`;
    let body = '';
    if (def.filterKind === 'values') {
      // Collect distinct values across state.columns for this field
      const counts = new Map();
      let nullCount = 0;
      for (const col of state.columns) {
        const v = getColField(col, def.id);
        if (v == null) nullCount++;
        else counts.set(String(v), (counts.get(String(v)) || 0) + 1);
      }
      const entries = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], 'de'));
      const selectedSet = current && current.kind === 'values' ? current.values : null;
      const includeNull = current && current.kind === 'values' ? current.includeNull : true;
      const allOn = !current; // if no filter, all are conceptually selected
      const rowsHtml = entries.map(([val, cnt]) => {
        const checked = allOn || (selectedSet && selectedSet.has(val));
        return `<label class="pp-filter-value-row">
          <input type="checkbox" data-value-row data-value="${escapeHtml(val)}" ${checked ? 'checked' : ''}>
          <span class="pp-filter-value-text">${escapeHtml(val)}</span>
          <span class="pp-filter-value-count">${cnt}</span>
        </label>`;
      }).join('');
      const nullRow = nullCount > 0
        ? `<label class="pp-filter-value-row">
             <input type="checkbox" data-value-row data-is-null="1" ${allOn || includeNull ? 'checked' : ''}>
             <span class="pp-filter-value-text"><em>(leer)</em></span>
             <span class="pp-filter-value-count">${nullCount}</span>
           </label>`
        : '';
      body = `
        <div class="pp-filter-toolbar">
          <button type="button" class="qrx-btn qrx-btn-sm qrx-btn-ghost" data-action="select-all">Alle</button>
          <button type="button" class="qrx-btn qrx-btn-sm qrx-btn-ghost" data-action="select-none">Keine</button>
        </div>
        <div class="pp-filter-values-list">${rowsHtml}${nullRow}</div>
      `;
    } else if (def.filterKind === 'search') {
      const q = current && current.kind === 'search' ? current.query : '';
      body = `
        <div class="pp-filter-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" class="qrx-input" data-role="search-query"
                 placeholder="Enthält\u2026" value="${escapeHtml(q)}">
        </div>
      `;
    } else if (def.filterKind === 'range') {
      const fmin = current && current.kind === 'range' && current.min != null ? current.min : '';
      const fmax = current && current.kind === 'range' && current.max != null ? current.max : '';
      const inclNull = current && current.kind === 'range' ? !!current.includeNull : false;
      const hint = def.id === 'compressed' ? ' (Bytes)' :
                   def.id === 'nullPct'   ? ' (Anteil 0\u20131)' : '';
      body = `
        <div class="pp-filter-range">
          <div class="qrx-form-group" style="margin:0;">
            <label class="qrx-label">Min${hint}</label>
            <input type="number" step="any" class="qrx-input" data-role="range-min" value="${escapeHtml(String(fmin))}">
          </div>
          <div class="qrx-form-group" style="margin:0;">
            <label class="qrx-label">Max${hint}</label>
            <input type="number" step="any" class="qrx-input" data-role="range-max" value="${escapeHtml(String(fmax))}">
          </div>
        </div>
        <label style="display:flex;align-items:center;gap:.5rem;font-size:.875rem;color:var(--qrx-text-muted);margin-top:.5rem;">
          <input type="checkbox" data-role="include-null" ${inclNull ? 'checked' : ''}>
          Leere Werte einschlie\u00DFen
        </label>
      `;
    }
    return `
      <div class="pp-filter-panel" data-kind="${def.filterKind}">
        <h4>${titleIcon} Filter \u2013 ${escapeHtml(def.label)}</h4>
        ${body}
        <div class="pp-filter-actions">
          <button type="button" class="qrx-btn qrx-btn-sm" data-action="clear">Zur\u00FCcksetzen</button>
          <button type="button" class="qrx-btn qrx-btn-sm qrx-btn-primary" data-action="apply">Anwenden</button>
        </div>
      </div>
    `;
  }

  function attachColsFilterPanelHandlers(def, pop) {
    const panel = pop.querySelector('.pp-filter-panel');
    if (!panel) return;

    // Bulk select for values mode
    const selAll = panel.querySelector('[data-action="select-all"]');
    const selNone = panel.querySelector('[data-action="select-none"]');
    if (selAll) selAll.addEventListener('click', () => {
      panel.querySelectorAll('input[type=checkbox][data-value-row]').forEach(b => b.checked = true);
    });
    if (selNone) selNone.addEventListener('click', () => {
      panel.querySelectorAll('input[type=checkbox][data-value-row]').forEach(b => b.checked = false);
    });

    panel.querySelector('[data-action="apply"]').addEventListener('click', () => {
      let newFilter = null;
      if (def.filterKind === 'values') {
        const boxes = panel.querySelectorAll('input[type=checkbox][data-value-row]');
        if (!boxes.length) {
          newFilter = null;
        } else {
          const allChecked = Array.from(boxes).every(b => b.checked);
          if (allChecked) {
            newFilter = null;  // no filtering required
          } else {
            const values = new Set();
            let includeNull = false;
            boxes.forEach(b => {
              if (!b.checked) return;
              if (b.dataset.isNull === '1') includeNull = true;
              else values.add(b.dataset.value);
            });
            newFilter = { kind: 'values', values, includeNull };
          }
        }
      } else if (def.filterKind === 'search') {
        const q = panel.querySelector('[data-role="search-query"]').value.trim();
        newFilter = q ? { kind: 'search', query: q } : null;
      } else if (def.filterKind === 'range') {
        const minIn = panel.querySelector('[data-role="range-min"]').value.trim();
        const maxIn = panel.querySelector('[data-role="range-max"]').value.trim();
        const inclNull = panel.querySelector('[data-role="include-null"]').checked;
        const min = minIn === '' ? null : parseFloat(minIn);
        const max = maxIn === '' ? null : parseFloat(maxIn);
        if (min == null && max == null && !inclNull) {
          newFilter = null;
        } else {
          newFilter = { kind: 'range', min, max, includeNull: inclNull };
        }
      }
      setColsFilter(def.id, newFilter);
      closeFilterPopover();
    });

    panel.querySelector('[data-action="clear"]').addEventListener('click', () => {
      setColsFilter(def.id, null);
      closeFilterPopover();
    });
  }

  function setColsFilter(fieldId, filter) {
    if (filter == null) delete state.colsTable.filters[fieldId];
    else state.colsTable.filters[fieldId] = filter;
    refreshColsTableBody();
  }

  function renderActiveColsFilters() {
    const fs = state.colsTable.filters;
    const keys = Object.keys(fs);
    if (!keys.length) {
      colsFilters.setAttribute('hidden', '');
      colsFiltersList.innerHTML = '';
      colsFilterResult.innerHTML = '';
      return;
    }
    colsFilters.removeAttribute('hidden');
    colsFiltersList.innerHTML = keys.map(k => {
      const f = fs[k];
      const def = COLS_FIELDS.find(d => d.id === k);
      let desc;
      if (f.kind === 'values') {
        const n = (f.values ? f.values.size : 0) + (f.includeNull ? 1 : 0);
        desc = `${n} Wert${n === 1 ? '' : 'e'}`;
      } else if (f.kind === 'search') {
        desc = `enth\u00E4lt "${truncate(String(f.query), 24)}"`;
      } else {
        const parts = [];
        if (f.min != null) parts.push(`\u2265 ${f.min}`);
        if (f.max != null) parts.push(`\u2264 ${f.max}`);
        if (f.includeNull) parts.push('leer');
        desc = parts.join(', ') || '\u2014';
      }
      return `<span class="pp-filter-chip" data-cols-field="${escapeHtml(k)}">
        <span class="pp-filter-chip-col">${escapeHtml(def ? def.label : k)}</span>
        <span class="pp-filter-chip-val">${escapeHtml(desc)}</span>
        <button type="button" data-action="remove-cols-filter" aria-label="Filter entfernen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </span>`;
    }).join('');
    colsFiltersList.querySelectorAll('[data-action="remove-cols-filter"]').forEach(btn => {
      btn.addEventListener('click', e => {
        const chip = e.currentTarget.closest('.pp-filter-chip');
        setColsFilter(chip.dataset.colsField, null);
      });
    });
  }

  clearColsFiltersBtn.addEventListener('click', () => {
    state.colsTable.filters = {};
    closeFilterPopover();
    refreshColsTableBody();
  });

  // ==========================================================================
  // Pivot
  //
  // Excel-style pivot table. Configuration uses three drop zones — Zeilen
  // (rows), Spalten (cols), Werte (values). Aggregation happens in DuckDB via
  // a GROUP BY query; the column-dim "spread" into wide form is done in JS
  // so we have full control over the top-N column-value limit and don't
  // accidentally generate a 5000-column result when the user picks a high-
  // cardinality field.
  // ==========================================================================
  const PIVOT_MAX_COL_VALUES = 100;
  const PIVOT_AGGS = [
    { id: 'count_all',      label: 'Anzahl',           needsField: false },
    { id: 'count',          label: 'Anzahl Nicht-Null', needsField: true,  fieldKinds: ['integer','numeric','string','temporal','boolean','binary','other'] },
    { id: 'count_distinct', label: 'Anzahl Eindeutig', needsField: true,  fieldKinds: ['integer','numeric','string','temporal','boolean','binary','other'] },
    { id: 'sum',            label: 'Summe',            needsField: true,  fieldKinds: ['integer','numeric'] },
    { id: 'avg',            label: 'Mittelwert',       needsField: true,  fieldKinds: ['integer','numeric'] },
    { id: 'min',            label: 'Min',              needsField: true,  fieldKinds: ['integer','numeric','temporal','string'] },
    { id: 'max',            label: 'Max',              needsField: true,  fieldKinds: ['integer','numeric','temporal','string'] },
  ];

  function aggDef(aggId)   { return PIVOT_AGGS.find(a => a.id === aggId) || PIVOT_AGGS[0]; }
  function aggLabel(v)     {
    const a = aggDef(v.agg);
    return a.needsField && v.field ? `${a.label}: ${v.field}` : a.label;
  }

  function pivotAddField(zone) {
    if (zone === 'rows' || zone === 'cols') {
      if (zone === 'cols' && state.pivot.cols.length >= 1) {
        setPivotStatus('Nur eine Spalten-Dimension wird unterst\u00FCtzt.', 'warning');
        return;
      }
      state.pivot[zone].push('');
    } else if (zone === 'values') {
      state.pivot.values.push({ agg: 'count_all', field: null });
    }
    renderPivotConfig();
  }

  function pivotRemoveChip(zone, idx) {
    state.pivot[zone].splice(idx, 1);
    renderPivotConfig();
  }

  function pivotUpdateChip(zone, idx, patch) {
    if (zone === 'rows' || zone === 'cols') {
      state.pivot[zone][idx] = patch.field;
    } else {
      state.pivot.values[idx] = Object.assign({}, state.pivot.values[idx], patch);
      // If agg switches to one that doesn't need a field, clear field
      const a = aggDef(state.pivot.values[idx].agg);
      if (!a.needsField) state.pivot.values[idx].field = null;
    }
    renderPivotConfig();
  }

  function renderPivotConfig() {
    for (const zone of ['rows', 'cols', 'values']) {
      const container = pivotSection.querySelector(`[data-chips="${zone}"]`);
      if (!container) continue;
      container.innerHTML = '';
      const items = state.pivot[zone];
      items.forEach((item, i) => {
        container.appendChild(buildPivotChip(zone, i, item));
      });
    }
  }

  function buildPivotChip(zone, idx, item) {
    const chip = document.createElement('div');
    chip.className = 'pp-pivot-chip';
    chip.dataset.zone = zone;
    chip.dataset.idx = String(idx);

    if (zone === 'values') {
      const selectedAgg = item.agg || 'count_all';
      const aggDfn = aggDef(selectedAgg);
      // Agg select
      const aggSel = document.createElement('select');
      aggSel.dataset.role = 'agg';
      for (const a of PIVOT_AGGS) {
        const opt = document.createElement('option');
        opt.value = a.id; opt.textContent = a.label;
        if (a.id === selectedAgg) opt.selected = true;
        aggSel.appendChild(opt);
      }
      aggSel.addEventListener('change', () => {
        pivotUpdateChip('values', idx, { agg: aggSel.value });
      });
      chip.appendChild(aggSel);

      // Field select (conditional on agg)
      if (aggDfn.needsField) {
        const fldSel = document.createElement('select');
        fldSel.dataset.role = 'field';
        const placeholder = document.createElement('option');
        placeholder.value = ''; placeholder.textContent = '\u2014 Feld w\u00E4hlen \u2014';
        if (!item.field) placeholder.selected = true;
        fldSel.appendChild(placeholder);
        const compatible = state.columns.filter(c => aggDfn.fieldKinds.includes(c.category));
        for (const col of compatible) {
          const opt = document.createElement('option');
          opt.value = col.name; opt.textContent = col.name;
          if (col.name === item.field) opt.selected = true;
          fldSel.appendChild(opt);
        }
        fldSel.addEventListener('change', () => {
          pivotUpdateChip('values', idx, { field: fldSel.value || null });
        });
        chip.appendChild(fldSel);
      }
    } else {
      // rows / cols: simple field picker (only categorical-ish types make sense
      // for grouping, but we let anything except complex through)
      const sel = document.createElement('select');
      sel.dataset.role = 'field';
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = '\u2014 Feld w\u00E4hlen \u2014';
      if (!item) placeholder.selected = true;
      sel.appendChild(placeholder);
      const eligible = state.columns.filter(c => c.category !== 'complex');
      for (const col of eligible) {
        const opt = document.createElement('option');
        opt.value = col.name; opt.textContent = col.name;
        if (col.name === item) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        pivotUpdateChip(zone, idx, { field: sel.value });
      });
      chip.appendChild(sel);
    }

    // Remove button
    const btn = document.createElement('button');
    btn.className = 'pp-pivot-chip-remove';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Entfernen');
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                       <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                     </svg>`;
    btn.addEventListener('click', () => pivotRemoveChip(zone, idx));
    chip.appendChild(btn);

    return chip;
  }

  // Wire up the "add field" buttons (delegated)
  pivotSection.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="add-pivot-field"]');
    if (!btn) return;
    pivotAddField(btn.dataset.zone);
  });

  pivotResetBtn.addEventListener('click', () => {
    state.pivot.rows = [];
    state.pivot.cols = [];
    state.pivot.values = [];
    state.pivot.lastResult = null;
    state.pivot.resultSort = null;
    pivotResult.innerHTML = '';
    pivotStatus.textContent = '';
    pivotStatus.className = 'pp-pivot-status';
    if (pivotSummary) pivotSummary.textContent = '';
    renderPivotConfig();
  });

  pivotRunBtn.addEventListener('click', runPivot);

  function setPivotStatus(text, level) {
    pivotStatus.textContent = text || '';
    pivotStatus.className = 'pp-pivot-status' + (level ? ' pp-pivot-' + level : '');
  }

  // -------------------------------------------------------------------------
  // SQL builder + execution
  // -------------------------------------------------------------------------
  function buildPivotAggExpr(v, alias) {
    const id = v.field ? quoteIdent(v.field) : null;
    switch (v.agg) {
      case 'count_all':      return `COUNT(*)::BIGINT AS ${alias}`;
      case 'count':          return `COUNT(${id})::BIGINT AS ${alias}`;
      case 'count_distinct': return `COUNT(DISTINCT ${id})::BIGINT AS ${alias}`;
      case 'sum':            return `SUM(${id}) AS ${alias}`;
      case 'avg':            return `AVG(${id}) AS ${alias}`;
      case 'min':            return `MIN(${id}) AS ${alias}`;
      case 'max':            return `MAX(${id}) AS ${alias}`;
      default: throw new Error('Unbekannte Aggregation: ' + v.agg);
    }
  }

  function validatePivotConfig() {
    const cfg = state.pivot;
    const valids = cfg.values.filter(v => {
      const a = aggDef(v.agg);
      return !a.needsField || v.field;
    });
    if (!valids.length) return { ok: false, error: 'Bitte mindestens einen vollst\u00E4ndigen Wert ausw\u00E4hlen.' };
    const rowsClean = cfg.rows.filter(Boolean);
    const colsClean = cfg.cols.filter(Boolean);
    return { ok: true, rows: rowsClean, cols: colsClean, values: valids };
  }

  async function runPivot() {
    if (state.snapshotMode) { setPivotStatus('Originaldatei erneut ablegen, um zu rechnen.'); return; }
    setPivotStatus('');
    pivotResult.innerHTML = '';
    const v = validatePivotConfig();
    if (!v.ok) { setPivotStatus(v.error, 'warning'); return; }

    setPivotStatus('Berechnung l\u00E4uft \u2026');
    pivotRunBtn.disabled = true;
    try {
      const cfg = { rows: v.rows, cols: v.cols, values: v.values };
      const colDim = cfg.cols.length ? cfg.cols[0] : null;
      const groupCols = [...cfg.rows, ...(colDim ? [colDim] : [])];
      const aggParts = cfg.values.map((vv, i) => buildPivotAggExpr(vv, `v_${i}`));

      let sql;
      if (groupCols.length) {
        const groupIds = groupCols.map(quoteIdent).join(', ');
        sql = `SELECT ${groupIds}, ${aggParts.join(', ')}
               FROM ${PARQUET_SQL}
               GROUP BY ${groupIds}
               ORDER BY ${groupIds}`;
      } else {
        sql = `SELECT ${aggParts.join(', ')} FROM ${PARQUET_SQL}`;
      }

      const t0 = performance.now();
      const res = await runQuery(sql);
      const rows = rowsFromQuery(res);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);

      const pivoted = colDim
        ? jsPivot(rows, cfg, colDim)
        : flatResult(rows, cfg);

      state.pivot.lastResult = pivoted;
      state.pivot.resultSort = null;
      renderPivotResult();
      const note = pivoted.truncated
        ? `${pivoted.rowCount.toLocaleString('de-DE')} Zeilen \u00B7 Spalten gek\u00FCrzt auf Top ${PIVOT_MAX_COL_VALUES} (von ${pivoted.totalColValues}) \u00B7 ${elapsed}s`
        : `${pivoted.rowCount.toLocaleString('de-DE')} Zeilen \u00B7 ${elapsed}s`;
      setPivotStatus(note, pivoted.truncated ? 'warning' : null);
      if (pivotSummary) pivotSummary.textContent = `${pivoted.rowCount.toLocaleString('de-DE')} Ergebnis-Zeilen`;
    } catch (e) {
      console.error('pivot failed', e);
      setPivotStatus('Fehler: ' + (e && e.message || String(e)), 'error');
    } finally {
      pivotRunBtn.disabled = false;
    }
  }

  // -------------------------------------------------------------------------
  // Result shapes
  //
  // flatResult: when no column-dim, the SQL already returned the wanted shape.
  // jsPivot:    when there's a column-dim, we get one row per (rowDim..., colDim)
  //             tuple from SQL. We bin to a 2D matrix in JS, applying a top-N
  //             cap on the column-dim values.
  // -------------------------------------------------------------------------
  function flatResult(rows, cfg) {
    const rowFields = cfg.rows;
    const valueLabels = cfg.values.map(aggLabel);
    const dataRows = rows.map(r => {
      const dims = rowFields.map(f => r[f]);
      const vals = cfg.values.map((_, i) => r['v_' + i]);
      return { dims, vals };
    });
    return {
      kind: 'flat',
      rowFields, valueLabels,
      rows: dataRows,
      rowCount: dataRows.length,
      truncated: false,
    };
  }

  function jsPivot(rows, cfg, colDim) {
    const rowFields = cfg.rows;
    const valueLabels = cfg.values.map(aggLabel);

    // First, gather all distinct col-dim values with a quick frequency count.
    const colCounts = new Map();
    for (const r of rows) {
      const cv = r[colDim];
      const k = (cv == null) ? '\u0000NULL' : String(cv);
      colCounts.set(k, (colCounts.get(k) || 0) + 1);
    }
    const allColValues = Array.from(colCounts.entries())
      .map(([k, c]) => ({ key: k, label: k === '\u0000NULL' ? '(leer)' : k, count: c }));
    // Sort: alphabetically (numerically when keys are numeric strings)
    allColValues.sort((a, b) => {
      const an = Number(a.key), bn = Number(b.key);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.label.localeCompare(b.label, 'de');
    });
    const totalColValues = allColValues.length;
    const kept = allColValues.slice(0, PIVOT_MAX_COL_VALUES);
    const keptKeys = new Set(kept.map(c => c.key));
    const truncated = totalColValues > kept.length;

    // Bin rows by their row-dim tuple
    const rowMap = new Map();
    for (const r of rows) {
      const dims = rowFields.map(f => r[f]);
      const rowKey = dims.map(d => d == null ? '\u0000NULL' : String(d)).join('\u0001');
      const colKey = r[colDim] == null ? '\u0000NULL' : String(r[colDim]);
      if (!keptKeys.has(colKey)) continue;
      let rec = rowMap.get(rowKey);
      if (!rec) {
        rec = { dims, cells: {} };
        rowMap.set(rowKey, rec);
      }
      rec.cells[colKey] = cfg.values.map((_, i) => r['v_' + i]);
    }

    // Order rows
    const ordered = Array.from(rowMap.values()).sort((a, b) => {
      for (let i = 0; i < a.dims.length; i++) {
        const va = a.dims[i], vb = b.dims[i];
        if (va == null && vb == null) continue;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') {
          if (va !== vb) return va - vb;
        } else {
          const cmp = String(va).localeCompare(String(vb), 'de');
          if (cmp !== 0) return cmp;
        }
      }
      return 0;
    });

    return {
      kind: 'pivot',
      rowFields, valueLabels,
      colField: colDim,
      colValues: kept,    // [{ key, label, count }, ...]
      rows: ordered,      // [{ dims, cells: { colKey -> [vals] } }, ...]
      rowCount: ordered.length,
      totalColValues, truncated,
    };
  }

  // -------------------------------------------------------------------------
  // Result rendering
  // -------------------------------------------------------------------------
  function formatPivotValue(v, isCount) {
    if (v == null) return '';
    if (typeof v === 'bigint') return v.toLocaleString('de-DE');
    const n = Number(v);
    if (isNaN(n)) return String(v);
    if (isCount || Number.isInteger(n)) return n.toLocaleString('de-DE');
    return n.toLocaleString('de-DE', { maximumFractionDigits: 4 });
  }

  // Used for sortable header cells in the rendered table.
  function pivotSortableHeader(key, label, alignLeft) {
    const sort = state.pivot.resultSort;
    const cls = (sort && sort.key === key) ? ('pp-pivot-sort-' + sort.dir) : '';
    return `<th class="${cls}${alignLeft ? ' pp-pivot-dim' : ''}" data-sort-key="${escapeHtml(key)}"
                 title="Klicken zum Sortieren">${escapeHtml(label)}</th>`;
  }

  function renderPivotResult() {
    const r = state.pivot.lastResult;
    pivotResult.innerHTML = '';
    if (!r) return;

    if (r.kind === 'flat') {
      renderFlatResult(r);
    } else {
      renderPivotMatrix(r);
    }
  }

  function renderFlatResult(r) {
    // Sort the rows if a sort is active
    const sortedRows = applyPivotSort(r);
    const valueIsCount = r.valueLabels.map((_, i) => {
      // Heuristic: aggregation labels starting with 'Anzahl' are integer counts
      return r.valueLabels[i].startsWith('Anzahl');
    });
    let html = '<table class="pp-pivot-table"><thead><tr>';
    r.rowFields.forEach((f, i) => {
      html += pivotSortableHeader('dim_' + i, f, true);
    });
    r.valueLabels.forEach((lbl, i) => {
      html += pivotSortableHeader('v_' + i, lbl, false);
    });
    html += '</tr></thead><tbody>';
    for (const row of sortedRows) {
      html += '<tr>';
      row.dims.forEach(d => {
        const s = d == null ? '<em>(leer)</em>' : escapeHtml(String(d));
        html += `<td class="pp-pivot-dim">${s}</td>`;
      });
      row.vals.forEach((v, i) => {
        html += `<td>${escapeHtml(formatPivotValue(v, valueIsCount[i]))}</td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    pivotResult.innerHTML = html;
    attachPivotResultHandlers();
  }

  function renderPivotMatrix(r) {
    const sortedRows = applyPivotSort(r);
    const valueIsCount = r.valueLabels.map(l => l.startsWith('Anzahl'));
    const multiValue = r.valueLabels.length > 1;

    let html = '<table class="pp-pivot-table"><thead>';
    if (multiValue) {
      // Two-row header: col-value spans, sub-row per value-label
      html += '<tr>';
      r.rowFields.forEach(f => {
        html += `<th class="pp-pivot-dim" rowspan="2">${escapeHtml(f)}</th>`;
      });
      r.colValues.forEach(cv => {
        html += `<th class="pp-pivot-col-group" colspan="${r.valueLabels.length}">${escapeHtml(cv.label)}</th>`;
      });
      html += '</tr><tr>';
      r.colValues.forEach(cv => {
        r.valueLabels.forEach((lbl, vi) => {
          html += pivotSortableHeader(`cv_${cv.key}_v_${vi}`, lbl, false);
        });
      });
      html += '</tr>';
    } else {
      html += '<tr>';
      r.rowFields.forEach((f, i) => {
        html += pivotSortableHeader('dim_' + i, f, true);
      });
      r.colValues.forEach(cv => {
        html += pivotSortableHeader(`cv_${cv.key}_v_0`, cv.label, false);
      });
      html += '</tr>';
    }
    html += '</thead><tbody>';
    for (const row of sortedRows) {
      html += '<tr>';
      row.dims.forEach(d => {
        const s = d == null ? '<em>(leer)</em>' : escapeHtml(String(d));
        html += `<td class="pp-pivot-dim">${s}</td>`;
      });
      r.colValues.forEach(cv => {
        const vals = row.cells[cv.key];
        if (!vals) {
          r.valueLabels.forEach((_, vi) => {
            html += '<td class="pp-pivot-empty">\u2014</td>';
          });
        } else {
          vals.forEach((v, vi) => {
            html += `<td>${escapeHtml(formatPivotValue(v, valueIsCount[vi]))}</td>`;
          });
        }
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    pivotResult.innerHTML = html;
    attachPivotResultHandlers();
  }

  function attachPivotResultHandlers() {
    pivotResult.querySelectorAll('th[data-sort-key]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        const cur = state.pivot.resultSort;
        if (!cur || cur.key !== key) {
          state.pivot.resultSort = { key, dir: 'asc' };
        } else if (cur.dir === 'asc') {
          state.pivot.resultSort = { key, dir: 'desc' };
        } else {
          state.pivot.resultSort = null;
        }
        renderPivotResult();
      });
    });
  }

  function applyPivotSort(r) {
    const s = state.pivot.resultSort;
    if (!s) return r.rows;
    const sign = s.dir === 'desc' ? -1 : 1;
    const sorted = r.rows.slice();
    sorted.sort((a, b) => {
      const va = extractSortValue(a, s.key, r);
      const vb = extractSortValue(b, s.key, r);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
      return String(va).localeCompare(String(vb), 'de') * sign;
    });
    return sorted;
  }

  function extractSortValue(row, key, r) {
    if (key.startsWith('dim_')) {
      const i = parseInt(key.slice(4), 10);
      return row.dims[i];
    }
    if (r.kind === 'flat' && key.startsWith('v_')) {
      const i = parseInt(key.slice(2), 10);
      const v = row.vals[i];
      return v == null ? null : (typeof v === 'bigint' ? Number(v) : v);
    }
    if (r.kind === 'pivot') {
      // key like cv_<colKey>_v_<i>
      const m = key.match(/^cv_(.+)_v_(\d+)$/);
      if (m) {
        const cells = row.cells[m[1]];
        if (!cells) return null;
        const v = cells[parseInt(m[2], 10)];
        return v == null ? null : (typeof v === 'bigint' ? Number(v) : v);
      }
    }
    return null;
  }
  // ===================== End of Pivot module ===================================

  // ==========================================================================
  // Tabs
  //
  // Three tabs (Attribute / Daten-Vorschau / Pivot) with ARIA roles and
  // keyboard navigation. Only the active tab's panel is visible; switching
  // is purely a visibility toggle — panel content is built up-front, so
  // switching is instant and stats/state are preserved.
  // ==========================================================================
  const TAB_TO_PANEL = {
    cols:    'pp-columnsSection',
    preview: 'pp-previewSection',
    pivot:   'pp-pivotSection',
    sql:     'pp-sqlSection',
  };
  const TAB_IDS = Object.keys(TAB_TO_PANEL);

  function setActiveTab(tabId) {
    if (!TAB_TO_PANEL[tabId]) tabId = 'cols';
    state.activeTab = tabId;
    if (!tabsBar) return;
    // Update tab buttons
    tabsBar.querySelectorAll('.pp-tab').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('pp-tab-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    // Update panels
    for (const id of TAB_IDS) {
      const panel = document.getElementById(TAB_TO_PANEL[id]);
      if (!panel) continue;
      if (id === tabId) panel.removeAttribute('hidden');
      else              panel.setAttribute('hidden', '');
    }
  }

  // Click + keyboard handlers on the tab bar
  if (tabsBar) {
    tabsBar.addEventListener('click', e => {
      const btn = e.target.closest('.pp-tab');
      if (!btn) return;
      setActiveTab(btn.dataset.tab);
    });
    tabsBar.addEventListener('keydown', e => {
      const cur = e.target.closest('.pp-tab');
      if (!cur) return;
      const idx = TAB_IDS.indexOf(cur.dataset.tab);
      if (idx < 0) return;
      let nextIdx = null;
      if (e.key === 'ArrowRight')      nextIdx = (idx + 1) % TAB_IDS.length;
      else if (e.key === 'ArrowLeft')  nextIdx = (idx - 1 + TAB_IDS.length) % TAB_IDS.length;
      else if (e.key === 'Home')       nextIdx = 0;
      else if (e.key === 'End')        nextIdx = TAB_IDS.length - 1;
      if (nextIdx == null) return;
      e.preventDefault();
      setActiveTab(TAB_IDS[nextIdx]);
      const focusBtn = tabsBar.querySelector(`.pp-tab[data-tab="${TAB_IDS[nextIdx]}"]`);
      if (focusBtn) focusBtn.focus();
    });
  }

  // ==========================================================================
  // Fullscreen for the active tab panel
  // ==========================================================================
  const fullscreenBtn = $('pp-fullscreenBtn');

  function isFullscreen() {
    return document.body.classList.contains('pp-fullscreen');
  }

  function setFullscreen(on) {
    document.body.classList.toggle('pp-fullscreen', !!on);
    if (fullscreenBtn) {
      fullscreenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      fullscreenBtn.setAttribute('aria-label', on ? 'Vollbild verlassen' : 'Vollbild');
      fullscreenBtn.setAttribute('title',
        on ? 'Vollbild verlassen (Esc)' : 'Vollbild f\u00FCr aktiven Tab (Esc zum Verlassen)');
    }
    // Scroll back to top so the user sees the panel head, not mid-scroll.
    if (on) window.scrollTo(0, 0);
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => setFullscreen(!isFullscreen()));
  }

  // ESC exits fullscreen — registered as a bubble-phase listener, so any
  // popover-close ESC handler (which lives on document and closes on keydown)
  // gets a chance to handle it first.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isFullscreen() && !e.defaultPrevented) {
      setFullscreen(false);
    }
  });

  // ==========================================================================
  // SQL panel
  //
  // Free-form SQL editor with example dropdown. Queries run against the loaded
  // Parquet file directly; we also register a VIEW called `data` on file load
  // so users can write `FROM data` instead of `FROM 'data.parquet'`.
  // Display is capped to SQL_DISPLAY_LIMIT rows even if the underlying result
  // is larger — keeps the DOM responsive.
  // ==========================================================================
  const SQL_DISPLAY_LIMIT = 10000;
  const SQL_DEFAULT_QUERY = 'SELECT * FROM data LIMIT 100;';
  let sqlExamples = [];
  function buildSqlExamples() {
    const ex = [
      { label: 'Erste 100 Zeilen', sql: 'SELECT * FROM data\nLIMIT 100;' },
      { label: 'Schema (DESCRIBE)', sql: 'DESCRIBE data;' },
      { label: 'Zeilenanzahl', sql: 'SELECT COUNT(*) AS rows FROM data;' },
      { label: 'Gruppieren & sortieren',
        sql:   '-- Eine Spalte z\u00E4hlen, Top-20 nach H\u00E4ufigkeit:\n'
             + 'SELECT my_column, COUNT(*) AS n\n'
             + 'FROM data\n'
             + 'GROUP BY my_column\n'
             + 'ORDER BY n DESC\n'
             + 'LIMIT 20;' },
      { label: 'NULL-Anteil pro Spalte',
        sql:   '-- Pro Spalte den Anteil NULL-Werte:\n'
             + 'SUMMARIZE data;' },
      { label: 'PIVOT (DuckDB native)',
        sql:   '-- DuckDB unterst\u00FCtzt PIVOT direkt:\n'
             + 'PIVOT data\n'
             + 'ON my_pivot_column\n'
             + 'USING COUNT(*)\n'
             + 'GROUP BY my_row_column;' },
    ];
    // Join example across the first two loaded files (when available).
    if (state.files.length >= 2) {
      const a = state.files[0].alias, b = state.files[1].alias;
      ex.push({ label: `Join: ${a} \u2A1D ${b}`,
        sql:   '-- Join \u00FCber zwei Dateien (Join-Spalten anpassen):\n'
             + `SELECT a.*, b.*\n`
             + `FROM ${a} AS a\n`
             + `JOIN ${b} AS b ON a.id = b.id\n`
             + `LIMIT 100;` });
    }
    const act = activeFileRec();
    const vfs = act ? act.vfsName : 'data.parquet';
    ex.push({ label: 'Parquet-Footer-Metadaten',
      sql: 'SELECT *\n' + `FROM parquet_metadata('${vfs}');` });
    ex.push({ label: 'Schema des Parquet-Files',
      sql: 'SELECT *\n' + `FROM parquet_schema('${vfs}');` });
    return ex;
  }

  function rebuildSqlExamples() {
    if (!sqlExamplesSel) return;
    sqlExamples = buildSqlExamples();
    sqlExamplesSel.length = 1;   // keep the "— wählen —" placeholder
    sqlExamples.forEach((ex, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = ex.label;
      sqlExamplesSel.appendChild(opt);
    });
  }

  if (sqlExamplesSel) {
    rebuildSqlExamples();
    sqlExamplesSel.addEventListener('change', () => {
      const i = parseInt(sqlExamplesSel.value, 10);
      if (!isNaN(i) && sqlExamples[i]) {
        sqlEditor.value = sqlExamples[i].sql;
        state.sql.query = sqlEditor.value;
        sqlEditor.focus();
      }
      // Reset to placeholder so the same example can be re-selected next time
      sqlExamplesSel.value = '';
    });
  }

  // Insert text at the editor's caret (used by the table chips).
  function insertIntoSqlEditor(text) {
    if (!sqlEditor) return;
    const ss = sqlEditor.selectionStart, se = sqlEditor.selectionEnd;
    const v = sqlEditor.value;
    sqlEditor.value = v.slice(0, ss) + text + v.slice(se);
    sqlEditor.selectionStart = sqlEditor.selectionEnd = ss + text.length;
    state.sql.query = sqlEditor.value;
    sqlEditor.focus();
  }

  // Available-tables helper: one chip per loaded file (+ the `data` alias).
  function renderSqlTables() {
    if (!sqlTablesEl) return;
    if (!state.files.length) { sqlTablesEl.innerHTML = ''; return; }
    const act = activeFileRec();
    const parts = ['<span class="pp-sql-tables-label">Tabellen:</span>'];
    parts.push(
      `<button type="button" class="pp-sql-table-chip pp-sql-table-chip-active" `
      + `data-insert="data" title="Aktive Datei${act ? ' \u2014 ' + escapeHtml(act.name) : ''}">`
      + `data <small>aktiv</small></button>`);
    for (const f of state.files) {
      parts.push(
        `<button type="button" class="pp-sql-table-chip" data-insert="${escapeHtml(f.alias)}" `
        + `title="${escapeHtml(f.name)}">${escapeHtml(f.alias)}</button>`);
    }
    sqlTablesEl.innerHTML = parts.join('');
  }

  if (sqlTablesEl) {
    sqlTablesEl.addEventListener('click', e => {
      const chip = e.target.closest('[data-insert]');
      if (chip) insertIntoSqlEditor(chip.getAttribute('data-insert'));
    });
  }

  function setSqlStatus(text, level) {
    sqlStatus.textContent = text || '';
    sqlStatus.className = 'pp-sql-status' + (level ? ' pp-sql-' + level : '');
  }

  // Editor keybindings: Tab inserts two spaces; Ctrl/Cmd+Enter runs
  if (sqlEditor) {
    sqlEditor.value = SQL_DEFAULT_QUERY;
    state.sql.query = SQL_DEFAULT_QUERY;
    sqlEditor.addEventListener('input', () => {
      state.sql.query = sqlEditor.value;
    });
    sqlEditor.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ss = sqlEditor.selectionStart;
        const se = sqlEditor.selectionEnd;
        sqlEditor.value = sqlEditor.value.substring(0, ss) + '  ' + sqlEditor.value.substring(se);
        sqlEditor.selectionStart = sqlEditor.selectionEnd = ss + 2;
        state.sql.query = sqlEditor.value;
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runSqlQuery();
      }
    });
  }

  if (sqlClearBtn) {
    sqlClearBtn.addEventListener('click', () => {
      sqlEditor.value = '';
      state.sql.query = '';
      setSqlStatus('');
      sqlResult.innerHTML = '';
      if (sqlSummary) sqlSummary.textContent = '';
      state.sql.lastRunCount = null;
      sqlEditor.focus();
    });
  }

  if (sqlRunBtn) sqlRunBtn.addEventListener('click', runSqlQuery);

  async function runSqlQuery() {
    if (state.snapshotMode) { setSqlStatus('Originaldatei erneut ablegen, um Abfragen auszuführen.'); return; }
    const sql = (sqlEditor.value || '').trim();
    if (!sql) {
      setSqlStatus('Bitte SQL eingeben.', 'warning');
      return;
    }
    if (!state.db || !state.files.length) {
      setSqlStatus('Keine Datei geladen.', 'warning');
      return;
    }

    sqlResult.innerHTML = '';
    setSqlStatus('Ausf\u00FChrung l\u00E4uft \u2026');
    sqlRunBtn.disabled = true;
    try {
      const t0 = performance.now();
      const res = await runQuery(sql);
      const rows = rowsFromQuery(res);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      const total = rows.length;
      const truncated = total > SQL_DISPLAY_LIMIT;
      const display = truncated ? rows.slice(0, SQL_DISPLAY_LIMIT) : rows;

      renderSqlResult(display, res);

      state.sql.lastRunCount = total;
      const msg = truncated
        ? `${formatNumber(total)} Zeilen \u00B7 Anzeige auf ${formatNumber(SQL_DISPLAY_LIMIT)} begrenzt \u00B7 ${elapsed}s`
        : `${formatNumber(total)} Zeilen \u00B7 ${elapsed}s`;
      setSqlStatus(msg, truncated ? 'warning' : null);
      if (sqlSummary) sqlSummary.textContent = `${formatNumber(total)} Zeilen`;
    } catch (e) {
      console.error('SQL failed', e);
      const msg = (e && e.message) ? e.message : String(e);
      sqlResult.innerHTML = `<div class="pp-sql-error-box">${escapeHtml(msg)}</div>`;
      setSqlStatus('Fehler', 'error');
      if (sqlSummary) sqlSummary.textContent = 'Fehler';
      state.sql.lastRunCount = null;
    } finally {
      sqlRunBtn.disabled = false;
    }
  }

  function renderSqlResult(rows, res) {
    if (!rows.length) {
      sqlResult.innerHTML = '<div class="pp-sql-result-empty">Keine Zeilen.</div>';
      return;
    }
    // Determine column order from the result schema; fall back to the first
    // row's keys if the schema isn't available.
    let columns = null;
    try {
      if (res && res.schema && res.schema.fields) {
        columns = res.schema.fields.map(f => f.name);
      }
    } catch (_) { /* ignore */ }
    if (!columns || !columns.length) columns = Object.keys(rows[0]);

    // Detect which columns are numeric (right-align) by scanning the first
    // batch of rows — cheaper than introspecting Arrow types and works fine
    // for display purposes.
    const numericCol = new Array(columns.length).fill(true);
    const probeRows = Math.min(rows.length, 100);
    for (let r = 0; r < probeRows; r++) {
      const row = rows[r];
      for (let c = 0; c < columns.length; c++) {
        const v = row[columns[c]];
        if (v == null) continue;
        if (typeof v === 'number' || typeof v === 'bigint') continue;
        // string that parses cleanly to number is still ok
        if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) continue;
        numericCol[c] = false;
      }
    }

    const parts = [];
    parts.push('<table class="pp-sql-result-table"><thead><tr>');
    for (const name of columns) parts.push(`<th>${escapeHtml(name)}</th>`);
    parts.push('</tr></thead><tbody>');
    for (const row of rows) {
      parts.push('<tr>');
      for (let c = 0; c < columns.length; c++) {
        const v = row[columns[c]];
        if (v == null) {
          parts.push('<td class="pp-sql-cell-null">NULL</td>');
        } else {
          const cellClass = numericCol[c] ? ' class="pp-sql-cell-num"' : '';
          parts.push(`<td${cellClass}>${escapeHtml(formatSqlCell(v))}</td>`);
        }
      }
      parts.push('</tr>');
    }
    parts.push('</tbody></table>');
    sqlResult.innerHTML = parts.join('');
  }

  function formatSqlCell(v) {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'number') {
      if (Number.isInteger(v)) return v.toLocaleString('de-DE');
      return v.toLocaleString('de-DE', { maximumFractionDigits: 6 });
    }
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (_) { return String(v); }
    }
    return String(v);
  }
  // ===================== End of SQL module =====================================

  // -------------------------------------------------------------------------
  // File pick / drop handlers
  // -------------------------------------------------------------------------
  pickBtn.addEventListener('click', () => fileInput.click());
  addFilesBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) addFiles(fileInput.files);
    fileInput.value = '';
  });

  if (bufferActiveCb) {
    bufferActiveCb.addEventListener('change', async () => {
      state.bufferActive = bufferActiveCb.checked;
      const rec = activeFileRec();
      if (!rec) return;
      showLoading(state.bufferActive
        ? 'Aktive Datei wird in den Speicher geladen \u2026'
        : 'Speicher wird freigegeben \u2026');
      try {
        await applyRegistrationModes(rec.id);
        await runQuery(`CREATE OR REPLACE VIEW data AS SELECT * FROM ${PARQUET_SQL}`);
        hideLoading();
        renderFileList();
      } catch (e) {
        console.error(e);
        hideLoading();
        showError('Speichermodus konnte nicht umgeschaltet werden', e && e.message || String(e));
      }
    });
  }

  // File-list interactions: pick active file / remove file (event delegation).
  fileListEl.addEventListener('click', e => {
    const removeBtn = e.target.closest('[data-action="remove"]');
    if (removeBtn) {
      e.stopPropagation();
      removeFile(removeBtn.getAttribute('data-id'));
      return;
    }
    const item = e.target.closest('.pp-file-item');
    if (item) {
      const id = item.getAttribute('data-id');
      if (id && id !== state.activeFileId) setActiveFile(id);
    }
  });

  // Robustly extract EVERY dropped file, synchronously — the DataTransfer is
  // only valid during the event, and items.getAsFile() must be called now.
  // We try items (skips directories, most reliable for multi-select) and fall
  // back to the .files list.
  function filesFromDrop(e) {
    const dt = e.dataTransfer;
    if (!dt) return [];
    const out = [];
    if (dt.items && dt.items.length) {
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (it && it.kind === 'file') {
          const f = it.getAsFile();
          if (f) out.push(f);
        }
      }
    }
    if (out.length) return out;
    return dt.files ? Array.from(dt.files) : [];
  }

  // Attach drag-active styling + a multi-file drop handler to an element.
  function wireDropTarget(el, activeClass) {
    if (!el) return;
    let depth = 0;
    el.addEventListener('dragenter', e => {
      e.preventDefault(); e.stopPropagation();
      depth++; el.classList.add(activeClass);
    });
    el.addEventListener('dragleave', e => {
      e.preventDefault(); e.stopPropagation();
      depth--; if (depth <= 0) { depth = 0; el.classList.remove(activeClass); }
    });
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    el.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      depth = 0; el.classList.remove(activeClass);
      const files = filesFromDrop(e);
      if (files.length) addFiles(files);
    });
  }

  wireDropTarget(dropZone, 'pp-drag-active');          // initial empty-state zone
  wireDropTarget(statusSection, 'pp-files-dragover');  // file-list panel (after load)

  // Page-wide drop fallback — adds files dropped anywhere on the page once at
  // least one file is loaded (so dropping outside the panel still works).
  document.addEventListener('dragover', e => {
    if (e.dataTransfer && e.dataTransfer.types
        && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
    }
  });
  document.addEventListener('drop', e => {
    if (!state.files.length) return; // empty state is handled by dropZone
    const t = e.target;
    // Skip if a dedicated drop target already handled it.
    if (t && t.closest && (t.closest('.pp-drop-zone') || t.closest('#pp-statusSection'))) return;
    const files = filesFromDrop(e);
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // -------------------------------------------------------------------------
  // Snapshot hooks for the shell's export-with-data button.
  // We export filter state + which columns were expanded. The actual data
  // file cannot be embedded (it's binary and arbitrarily large), so the
  // snapshot is meant as a session-state reminder rather than a self-
  // contained reproduction.
  // -------------------------------------------------------------------------
  window.qurixApp = window.qurixApp || {};
  window.qurixApp.serializeState = () => {
    // Convert Set values inside the values-kind filters to arrays for JSON
    const colsFilters = {};
    for (const k in state.colsTable.filters) {
      const f = state.colsTable.filters[k];
      colsFilters[k] = (f.kind === 'values')
        ? { ...f, values: Array.from(f.values) }
        : f;
    }
    return {
      fileMeta: state.fileMeta,
      files: state.files.map(f => ({ name: f.name, size: f.size, alias: f.alias })),
      activeAlias: (activeFileRec() || {}).alias || null,
      filters: state.filters,
      expandedCols: Array.from(state.expandedCols),
      previewLimit: state.previewLimit,
      previewPage: state.previewPage,
      colsTable: {
        sortKey: state.colsTable.sortKey,
        sortDir: state.colsTable.sortDir,
        filters: colsFilters,
      },
      pivot: {
        rows: state.pivot.rows,
        cols: state.pivot.cols,
        values: state.pivot.values,
      },
      sql: {
        query: (sqlEditor && sqlEditor.value) || state.sql.query || '',
      },
      activeTab: state.activeTab,
    };
  };
  function exitSnapshotMode() {
    if (!state.snapshotMode) return;
    state.snapshotMode = false;
    const appEl = document.getElementById('qrx-app');
    if (appEl) appEl.classList.remove('pp-snapshot');
    // The informational note in errorBox is cleared by clearError() in addFiles.
  }

  window.qurixApp.hydrateState = (s) => {
    if (!s) return;
    // A snapshot has data frozen in the cloned DOM but no live file/DuckDB:
    // mark snapshot mode so live actions are blocked and the frozen view stays.
    state.snapshotMode = true;
    const appEl = document.getElementById('qrx-app');
    if (appEl) appEl.classList.add('pp-snapshot');
    const fileList = Array.isArray(s.files) && s.files.length
      ? s.files
      : (s.fileMeta ? [{ name: s.fileMeta.name, size: s.fileMeta.size, alias: null }] : []);
    if (fileList.length) {
      // We can't reconstruct the binary handles; just show a note.
      const items = fileList.map(f => {
        const aliasTxt = f.alias ? ` &rarr; <code>${escapeHtml(f.alias)}</code>` : '';
        return `<li><code>${escapeHtml(f.name)}</code> (${formatBytes(f.size)})${aliasTxt}</li>`;
      }).join('');
      const note = document.createElement('div');
      note.className = 'pp-error';
      note.style.background = 'rgba(232,163,23,0.08)';
      note.style.borderColor = 'var(--qrx-warning)';
      note.innerHTML = `
        <strong style="color:var(--qrx-warning)">Statischer Snapshot</strong>
        <p style="margin:.25rem 0 0;">
          Die angezeigten Daten sind ein eingefrorenes Abbild vom Export-Zeitpunkt.
          Live-Funktionen (Filter, Spaltenstatistik, Pivot, SQL, Sortierung) sind deaktiviert.
          Bitte ${fileList.length === 1 ? 'die folgende Datei' : 'die folgenden Dateien'}
          erneut ablegen, um die Ansicht voll funktionsf&auml;hig zu rekonstruieren:
        </p>
        <ul style="margin:.25rem 0 0; padding-left:1.25rem;">${items}</ul>
      `;
      errorBox.appendChild(note);
    }
    if (s.filters) state.filters = s.filters;
    if (Array.isArray(s.expandedCols)) state.expandedCols = new Set(s.expandedCols);
    if (s.previewLimit) {
      state.previewLimit = s.previewLimit;
      previewLimitSel.value = String(s.previewLimit);
    }
    if (typeof s.previewPage === 'number') state.previewPage = s.previewPage;
    if (s.colsTable) {
      state.colsTable.sortKey = s.colsTable.sortKey || null;
      state.colsTable.sortDir = s.colsTable.sortDir || 'asc';
      const restored = {};
      for (const k in (s.colsTable.filters || {})) {
        const f = s.colsTable.filters[k];
        if (f.kind === 'values' && Array.isArray(f.values)) {
          restored[k] = { ...f, values: new Set(f.values) };
        } else {
          restored[k] = f;
        }
      }
      state.colsTable.filters = restored;
    }
    if (s.pivot) {
      state.pivot.rows = Array.isArray(s.pivot.rows) ? s.pivot.rows : [];
      state.pivot.cols = Array.isArray(s.pivot.cols) ? s.pivot.cols : [];
      state.pivot.values = Array.isArray(s.pivot.values) ? s.pivot.values : [];
    }
    if (s.sql && typeof s.sql.query === 'string' && sqlEditor) {
      sqlEditor.value = s.sql.query;
      state.sql.query = s.sql.query;
    }
    if (s.activeTab && TAB_TO_PANEL[s.activeTab]) {
      state.activeTab = s.activeTab;
    }
  };

})();
