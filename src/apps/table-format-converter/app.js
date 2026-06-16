// === Table Format Converter app logic =======================================
// ============================================================================
(function() {
  'use strict';

  // ---------------------------------------------------------------- DOM refs
  const $  = id => document.getElementById(id);
  const dropzone        = $('dropzone');
  const filePicker      = $('filePicker');
  const fileInfo        = $('fileInfo');
  const fileIcon        = $('fileIcon');
  const fileName        = $('fileName');
  const fileMeta        = $('fileMeta');
  const resetFileBtn    = $('resetFileBtn');
  const statusBar       = $('statusBar');
  const statusSpinner   = $('statusSpinner');
  const statusText      = $('statusText');
  const workspace       = $('workspace');
  const heuristicPanel  = $('heuristicPanel');
  const heuristicFields = $('heuristicFields');
  const resetHeuristicBtn = $('resetHeuristicBtn');
  const rangePickerCard = $('rangePickerCard');
  const rangePickerEl   = $('rangePicker');
  const rangePickerTitle = $('rangePickerTitle');
  const rangePickerHint  = $('rangePickerHint');
  const rangePickerHelp  = $('rangePickerHelp');
  const previewStats    = $('previewStats');
  const previewGrid     = $('previewGrid');
  // Format chip group acts as the source of truth for the selected target format.
  // Wrapped in a small object that mimics the prior <select> API (value getter,
  // addEventListener('change', ...)) so downstream code didn't need to change.
  const formatChipsEl = $('formatChips');
  const targetFormatListeners = [];
  const targetFormat = {
    get value() {
      const active = formatChipsEl.querySelector('.format-chip.is-active');
      return active ? active.dataset.format : 'csv';
    },
    set value(v) {
      formatChipsEl.querySelectorAll('.format-chip').forEach(b => {
        const on = b.dataset.format === v;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    },
    addEventListener(ev, fn) {
      if (ev === 'change') targetFormatListeners.push(fn);
    },
  };
  formatChipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.format-chip');
    if (!chip) return;
    const fmt = chip.dataset.format;
    if (fmt === targetFormat.value) return;
    targetFormat.value = fmt;
    targetFormatListeners.forEach(fn => { try { fn(); } catch (_) {} });
  });
  const exportOptions   = $('exportOptions');
  const exportBtn       = $('exportBtn');
  const exportProgress  = $('exportProgress');
  const sqlCard         = $('sqlCard');
  const sqlEditor       = $('sqlEditor');
  const sqlRunBtn       = $('sqlRunBtn');
  const sqlStatus       = $('sqlStatus');
  const sqlResultWrap   = $('sqlResultWrap');
  const sqlResult       = $('sqlResult');
  const sqlParquetHint  = $('sqlParquetHint');

  // ---------------------------------------------------------------- State
  const state = {
    file: null,
    fileSize: 0,
    format: null,         // 'csv' | 'parquet' | 'json' | 'ndjson' | 'xlsx'
    duckFile: null,       // virtual filename inside duckdb (full file / representative)
    duckFiles: [],        // >1 entry when several same-structure files are combined
    duckPreviewFile: null, // virtual filename of a small in-heap slice for fast previews
    detected: {},         // auto-detected heuristics
    user: {},             // user overrides (merged on top of detected)
    schema: [],           // [{name, type, typeClass}]
    previewRows: [],
    rowCountEstimate: null, // {value, exact: bool}
    sheets: [],           // for xlsx: [{name, rows, range}]
    excelBookSample: null, // SheetJS workbook (sheetRows: 100)
    excelHeader: [],      // current header for excel preview
    excelData: [],        // current data rows for excel preview
    csvSampleText: null,  // raw sample text (BOM-stripped) for CSV picker
    csvFullColumnNames: null, // full column names from unprojected CSV read
    duckdbAlias: null,    // ATTACH alias for DuckDB source files
    duckdbTables: [],     // [{schema, name, qualified}] from attached DB (also reused for SQLite)
    sqliteDb: null,       // sql.js Database instance for SQLite sources
    sqliteCsvName: null,  // VFS name of the table materialised as CSV for export
    markdownTables: [],   // [{name, columns:[], rows:[[]]}] parsed from a Markdown file
    mdCsvName: null,      // VFS name of the selected Markdown table materialised as CSV
    pasteSource: null,    // 'html' | 'text' — how the pasted clipboard data was parsed
    pasteText: null,      // raw plain-text payload (text source) for delimiter re-parse
    pasteTables: [],      // [{name, matrix:[[...]]}] parsed from pasted clipboard data
    pasteCsvName: null,   // VFS name of the selected pasted table materialised as CSV
    excelCsvName: null,   // VFS name of the full Excel/ODS/Numbers sheet materialised as CSV (for SQL)
    sqlDataViewSig: null, // signature of the source last bound to the `data` view (cache key)
    snapshotMode: false,  // true when viewing a "with data" export (no live file)
    snapshotMeta: null,   // {fileName, fileSize} of the captured snapshot
  };
  // Active heuristic = detected merged with user overrides
  function eff() { return Object.assign({}, state.detected, state.user); }

  // ---------------------------------------------------------------- Utilities
  let _statusDismissTimer = null;
  function setStatus(text, kind) {
    if (_statusDismissTimer) { clearTimeout(_statusDismissTimer); _statusDismissTimer = null; }
    if (!text) { statusBar.hidden = true; return; }
    statusBar.hidden = false;
    statusText.textContent = text;
    statusBar.classList.toggle('is-error',   kind === 'error');
    statusBar.classList.toggle('is-warn',    kind === 'warn');
    statusBar.classList.toggle('is-success', kind === 'success');
    // Spinner is only meaningful for ongoing work — suppress for terminal states.
    const isTerminal = kind === 'error' || kind === 'warn' || kind === 'success';
    statusSpinner.style.display = isTerminal ? 'none' : '';
    // Success messages are confirmations, not ongoing state — auto-clear them.
    if (kind === 'success') {
      _statusDismissTimer = setTimeout(() => {
        if (statusText.textContent === text) setStatus('');
      }, 2500);
    }
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function readSlice(file, start, end) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file.slice(start, end));
    });
  }
  function readSliceAB(file, start, end) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file.slice(start, end));
    });
  }
  function readAll(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  // Map DuckDB / Arrow type strings to friendly category for badge color
  function typeClass(t) {
    const T = String(t).toUpperCase();
    if (/INT|DEC|FLOAT|DOUBLE|NUMERIC|REAL|HUGEINT|UTINY|TINYINT|SMALLINT|BIGINT/.test(T)) return 't-number';
    if (/BOOL/.test(T)) return 't-bool';
    if (/DATE|TIMESTAMP|TIME/.test(T)) return 't-date';
    if (/VARCHAR|TEXT|CHAR|STRING|UTF/.test(T)) return 't-string';
    return 't-other';
  }
  // Friendly type name from Arrow type object
  function arrowFriendlyType(arrowType) {
    if (!arrowType) return 'UNKNOWN';
    const n = arrowType.toString();
    // Arrow type strings like "Int64", "Float64", "Utf8", "Bool", "Date<...>"
    if (/Int(8|16|32|64)/i.test(n)) return /Int64/.test(n) ? 'BIGINT' : 'INTEGER';
    if (/Uint(8|16|32|64)/i.test(n)) return 'UINTEGER';
    if (/Float64|Double/i.test(n)) return 'DOUBLE';
    if (/Float(16|32)/i.test(n)) return 'FLOAT';
    if (/Decimal/i.test(n)) return 'DECIMAL';
    if (/Utf8|String|LargeUtf8/i.test(n)) return 'VARCHAR';
    if (/Bool/i.test(n)) return 'BOOLEAN';
    if (/Timestamp/i.test(n)) return 'TIMESTAMP';
    if (/Date/i.test(n)) return 'DATE';
    if (/Time/i.test(n)) return 'TIME';
    if (/Struct/i.test(n)) return 'STRUCT';
    if (/List/i.test(n)) return 'LIST';
    if (/Map/i.test(n)) return 'MAP';
    if (/Binary/i.test(n)) return 'BLOB';
    return n.toUpperCase();
  }

  // ---------------------------------------------------------------- DuckDB-WASM
  let duckdb = null;
  let db = null;
  let conn = null;
  let dbInitPromise = null;

  async function initDuckDB() {
    if (dbInitPromise) return dbInitPromise;
    dbInitPromise = (async () => {
      setStatus('Loading DuckDB engine…');
      // v1.30.0 wraps DuckDB v1.3.2 — first version that exposes
      // `strict_mode=false`, which is essential for reading real-world CSVs
      // with multi-line quoted fields. Earlier versions (1.29 → DuckDB v1.1)
      // can't handle the bare LF inside quoted stack traces and the sniffer
      // bails. Extensions (json/parquet/etc.) still autoload as in 1.29.
      duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.30.0/+esm');
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);
      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );
      const worker = new Worker(worker_url);
      const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
      db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(worker_url);
      conn = await db.connect();
      // Allow on-demand loading of optional extensions like 'json' (needed
      // for COPY ... (FORMAT JSON) and read_json on the WASM build).
      try {
        await conn.query(`SET autoinstall_known_extensions=1; SET autoload_known_extensions=1;`);
      } catch (e) { console.warn('Could not enable extension autoload', e); }
      setStatus('');
    })();
    return dbInitPromise;
  }

  // Files are registered with DuckDB in one of two ways:
  //  - Tiny files (<= PREVIEW_SLICE_BYTES): loaded into the WASM heap as a
  //    single buffer. Preview AND export both run against this buffer.
  //  - Larger files: a Handle is registered (instant — no bytes loaded yet).
  //    Additionally, a small slice of the head is pre-loaded into the heap
  //    and registered as a SECOND virtual file. Preview queries run against
  //    the slice (fast, all-in-heap). Export runs against the full handle.
  // This keeps drop instant regardless of file size, makes preview fast even
  // on multi-GB files, and only pays the full IO cost when the user actually
  // exports.
  const PREVIEW_SLICE_BYTES = 512 * 1024; // 512 KB — covers ~10 rows even with
                                          // very wide cells (multi-line stack
                                          // traces in CSV, for example).

  async function registerWithDuckDB(file, virtualName) {
    if (file.size <= PREVIEW_SLICE_BYTES) {
      // Small enough to just hold in the heap once — no slice trickery needed.
      const buf = await readAll(file);
      await db.registerFileBuffer(virtualName, buf);
      state.duckPreviewFile = null;
    } else {
      // Big file: register a handle for the full file (instant, no bytes
      // copied), plus pre-load the head slice for cheap previews.
      await db.registerFileHandle(virtualName, file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
      const sliceName = virtualName + '__preview';
      const slice = file.slice(0, PREVIEW_SLICE_BYTES);
      const buf = await readAll(slice);
      try { await db.dropFile(sliceName); } catch (_) {}
      await db.registerFileBuffer(sliceName, buf);
      state.duckPreviewFile = sliceName;
    }
  }

  function sqlEscape(s) { return String(s).replace(/'/g, "''"); }
  function sqlIdent(s)  { return '"' + String(s).replace(/"/g, '""') + '"'; }

  // ---------------------------------------------------------------- Format detection
  async function detectFormat(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'parquet' || ext === 'pq') return 'parquet';
    if (ext === 'xlsx' || ext === 'xls')   return 'xlsx';
    // ODS / flat-ODS / Apple Numbers are all read by SheetJS (the Excel path).
    if (ext === 'ods' || ext === 'fods' || ext === 'numbers') return 'xlsx';
    if (ext === 'html' || ext === 'htm') return 'html';
    if (ext === 'ndjson' || ext === 'jsonl') return 'ndjson';
    if (ext === 'tsv') return 'csv';
    if (ext === 'sqlite' || ext === 'sqlite3') return 'sqlite';
    if (ext === 'duckdb' || ext === 'ddb') return 'duckdb';
    if (ext === 'md' || ext === 'markdown' || ext === 'mdown' || ext === 'mkd') return 'markdown';
    // '.db' is ambiguous (SQLite vs DuckDB) — decided by magic bytes below.
    if (ext === 'json') {
      const text = (await readSlice(file, 0, 4096)).replace(/^\uFEFF/, '');
      const trimmed = text.trimStart();
      if (trimmed.startsWith('[')) return 'json';
      if (trimmed.startsWith('{')) {
        const lines = trimmed.split(/\r?\n/).filter(l => l.trim()).slice(0, 3);
        if (lines.length > 1 && lines.every(l => l.trim().startsWith('{'))) return 'ndjson';
        return 'json';
      }
      return 'json';
    }
    if (ext === 'csv' || ext === 'txt') return 'csv';
    // Magic-byte fallback
    const buf = await readSliceAB(file, 0, 16);
    if (buf[0] === 0x50 && buf[1] === 0x41 && buf[2] === 0x52 && buf[3] === 0x31) return 'parquet';
    if (buf[0] === 0x50 && buf[1] === 0x4B) return 'xlsx';
    // SQLite files start with "SQLite format 3\0"
    if (buf.length >= 6 &&
        buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4C &&
        buf[3] === 0x69 && buf[4] === 0x74 && buf[5] === 0x65) return 'sqlite';
    // DuckDB v0.10+ files have "DUCK" at offset 8
    if (buf.length >= 12 &&
        buf[8] === 0x44 && buf[9] === 0x55 && buf[10] === 0x43 && buf[11] === 0x4B) return 'duckdb';
    // Ambiguous '.db' that matched neither signature → assume DuckDB (prior behaviour)
    if (ext === 'db') return 'duckdb';
    return 'csv';
  }

  // ---------------------------------------------------------------- File handling
  async function loadFile(file) {
    exitSnapshotMode();  // leave static-snapshot view when a real file arrives
    state.file = file;
    state.fileSize = file.size;
    state.user = {};
    state.detected = {};
    // Drop any previously-registered files (full + preview slice + combined set)
    if (db) {
      if (state.duckFile)        { try { await db.dropFile(state.duckFile); }        catch (_) {} }
      if (state.duckPreviewFile) { try { await db.dropFile(state.duckPreviewFile); } catch (_) {} }
      for (const n of state.duckFiles) { try { await db.dropFile(n); } catch (_) {} }
    }
    state.duckFile = null;
    state.duckFiles = [];
    state.duckPreviewFile = null;
    state.sheets = [];
    state.excelBookSample = null;
    state.csvSampleText = null;
    state.csvFullColumnNames = null;
    // Detach any previously-attached source DB so a new file can be opened
    if (state.duckdbAlias && conn) {
      try { await conn.query(`DETACH ${sqlIdent(state.duckdbAlias)}`); } catch (_) {}
    }
    state.duckdbAlias = null;
    state.duckdbTables = [];
    // Release any previously-opened SQLite database + its materialised CSV.
    if (state.sqliteDb) { try { state.sqliteDb.close(); } catch (_) {} }
    state.sqliteDb = null;
    if (state.sqliteCsvName && db) { try { await db.dropFile(state.sqliteCsvName); } catch (_) {} }
    state.sqliteCsvName = null;
    if (state.mdCsvName && db) { try { await db.dropFile(state.mdCsvName); } catch (_) {} }
    state.mdCsvName = null;
    state.markdownTables = [];
    if (state.excelCsvName && db) { try { await db.dropFile(state.excelCsvName); } catch (_) {} }
    state.excelCsvName = null;
    resetSqlEditor();

    try {
      setStatus('Detecting format…');
      const fmt = await detectFormat(file);
      state.format = fmt;

      // Show file info
      const ext0 = (file.name.split('.').pop() || '').toLowerCase();
      dropzone.hidden = true;
      fileInfo.hidden = false;
      fileIcon.textContent = fmt === 'parquet' ? 'PRQ' :
                             fmt === 'xlsx' ? (ext0 === 'ods' || ext0 === 'fods' ? 'ODS' : ext0 === 'numbers' ? 'NUM' : 'XLS') :
                             fmt === 'ndjson' ? 'NDJ' :
                             fmt === 'duckdb' ? 'DDB' :
                             fmt === 'sqlite' ? 'SQL' :
                             fmt === 'markdown' ? 'MD' :
                             fmt === 'html' ? 'HTM' :
                             fmt === 'json' ? 'JSN' : 'CSV';
      fileName.textContent = file.name;
      fileMeta.textContent = `${ext0.toUpperCase() || fmt.toUpperCase()} · ${fmtBytes(file.size)}`;

      // Excel/ODS/Numbers and SQLite are read by their own JS engines
      // (SheetJS / sql.js); DuckDB is only spun up later, at export time.
      if (fmt === 'xlsx') {
        await loadExcel(file);
      } else if (fmt === 'sqlite') {
        await loadSqlite(file);
      } else if (fmt === 'markdown') {
        await loadMarkdown(file);
      } else if (fmt === 'html') {
        // An .html file is treated like pasted HTML: extract its <table>s.
        const text = await readSlice(file, 0, file.size);
        state.format = 'paste';
        loadPaste({ html: text, text: text });
      } else {
        await initDuckDB();
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        state.duckFile = `input_${Date.now()}_${safeName}`;
        setStatus('Registering file with DuckDB…');
        await registerWithDuckDB(file, state.duckFile);
        setStatus('Detecting parsing parameters…');
        if (fmt === 'csv') await detectCSV();
        else if (fmt === 'parquet') await detectParquet();
        else if (fmt === 'json' || fmt === 'ndjson') await detectJSON(fmt);
        else if (fmt === 'duckdb') await detectDuckDB();
      }

      workspace.hidden = false;
      renderHeuristicPanel();
      renderExportOptions();
      await refreshPreview();
      updateHeuristicCollapseState();
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  // ---------------------------------------------------------------- Multi-file import
  // Register a file for combined reads (no head-slice — that's single-file only).
  async function registerFullFile(file, vname) {
    if (file.size <= PREVIEW_SLICE_BYTES) {
      await db.registerFileBuffer(vname, await readAll(file));
    } else {
      await db.registerFileHandle(vname, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    }
  }
  // "column:type, …" signature of one registered file using the detected options.
  async function fileSchemaSig(vname, fmt) {
    const e = eff();
    let src;
    if (fmt === 'csv') src = `read_csv('${sqlEscape(vname)}', ${buildCsvOpts(e)})`;
    else if (fmt === 'parquet') src = `read_parquet('${sqlEscape(vname)}')`;
    else if (fmt === 'ndjson') src = `read_json('${sqlEscape(vname)}', format='newline_delimited', auto_detect=true)`;
    else src = `read_json('${sqlEscape(vname)}', format='array', auto_detect=true)`;
    const d = await conn.query(`DESCRIBE SELECT * FROM ${src}`);
    return d.toArray().map(r => `${r.column_name}:${r.column_type}`);
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.length === 1) { await loadFile(files[0]); return; }

    exitSnapshotMode();
    setStatus('Detecting format…');
    let fmts = [];
    try { fmts = await Promise.all(files.map(detectFormat)); } catch (_) {}
    const fmt = fmts[0];
    const SUPPORTED = ['csv', 'parquet', 'json', 'ndjson'];
    if (!fmt || !SUPPORTED.includes(fmt) || fmts.some(x => x !== fmt)) {
      dropzone.hidden = false; fileInfo.hidden = true; workspace.hidden = true;
      setStatus('Multiple files can only be combined when they are all the same type — '
        + 'CSV, Parquet, JSON or NDJSON. Excel/ODS/Numbers/SQLite/… must be imported one at a time.', 'error');
      return;
    }

    try {
      // Release any previous source(s).
      if (db) {
        if (state.duckFile)        { try { await db.dropFile(state.duckFile); }        catch (_) {} }
        if (state.duckPreviewFile) { try { await db.dropFile(state.duckPreviewFile); } catch (_) {} }
        for (const n of state.duckFiles) { try { await db.dropFile(n); } catch (_) {} }
        if (state.sqliteCsvName)   { try { await db.dropFile(state.sqliteCsvName); }   catch (_) {} }
        if (state.mdCsvName)       { try { await db.dropFile(state.mdCsvName); }       catch (_) {} }
        if (state.pasteCsvName)    { try { await db.dropFile(state.pasteCsvName); }    catch (_) {} }
        if (state.excelCsvName)    { try { await db.dropFile(state.excelCsvName); }    catch (_) {} }
      }
      if (state.duckdbAlias && conn) { try { await conn.query(`DETACH ${sqlIdent(state.duckdbAlias)}`); } catch (_) {} }
      if (state.sqliteDb) { try { state.sqliteDb.close(); } catch (_) {} }
      resetSqlEditor();
      Object.assign(state, {
        duckPreviewFile: null, duckdbAlias: null, duckdbTables: [],
        sqliteDb: null, sqliteCsvName: null, mdCsvName: null, markdownTables: [],
        pasteCsvName: null, pasteTables: [], pasteText: null, pasteSource: null,
        excelCsvName: null,
        sheets: [], excelBookSample: null, csvSampleText: null, csvFullColumnNames: null,
        user: {}, detected: {},
      });

      await initDuckDB();
      setStatus('Registering files…');
      state.duckFiles = [];
      const stamp = Date.now();
      for (let i = 0; i < files.length; i++) {
        const safe = files[i].name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const vname = `input_${stamp}_${i}_${safe}`;
        await registerFullFile(files[i], vname);
        state.duckFiles.push(vname);
      }
      state.format = fmt;
      state.duckFile = state.duckFiles[0];   // representative for detection
      state.duckPreviewFile = null;
      state.file = files[0];
      state.fileSize = files.reduce((s, f) => s + (f.size || 0), 0);

      setStatus('Detecting parsing parameters…');
      if (fmt === 'csv') await detectCSV();
      else if (fmt === 'parquet') await detectParquet();
      else await detectJSON(fmt);

      // Verify identical structure across all files; clear error otherwise.
      setStatus('Checking structure…');
      const first = await fileSchemaSig(state.duckFiles[0], fmt);
      for (let i = 1; i < state.duckFiles.length; i++) {
        const cur = await fileSchemaSig(state.duckFiles[i], fmt);
        if (cur.length !== first.length || cur.some((c, k) => c !== first[k])) {
          throw new Error(`"${files[i].name}" has a different structure than "${files[0].name}". `
            + `All files must share the same columns and types.\n`
            + `• ${files[0].name}: ${first.join(', ')}\n`
            + `• ${files[i].name}: ${cur.join(', ')}`);
        }
      }

      dropzone.hidden = true;
      fileInfo.hidden = false;
      fileIcon.textContent = fmt === 'parquet' ? 'PRQ' : fmt === 'ndjson' ? 'NDJ' : fmt === 'json' ? 'JSN' : 'CSV';
      fileName.textContent = `${files.length} files combined`;
      fileMeta.textContent = `${fmt.toUpperCase()} · ${files.length} files · ${fmtBytes(state.fileSize)}`;
      workspace.hidden = false;
      renderHeuristicPanel();
      renderExportOptions();
      await refreshPreview();
      updateHeuristicCollapseState();
      setStatus(`${files.length} files combined into one table.`, 'success');
    } catch (err) {
      console.error(err);
      if (db) for (const n of state.duckFiles) { try { await db.dropFile(n); } catch (_) {} }
      state.duckFiles = [];
      dropzone.hidden = false; fileInfo.hidden = true; workspace.hidden = true;
      setStatus('Import failed: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  function resetFile() {
    exitSnapshotMode();
    if (state.duckdbAlias && conn) {
      // Best-effort detach; fire-and-forget since resetFile is sync
      try { conn.query(`DETACH ${sqlIdent(state.duckdbAlias)}`); } catch (_) {}
    }
    if (db) {
      if (state.duckFile)        { try { db.dropFile(state.duckFile); }        catch (_) {} }
      if (state.duckPreviewFile) { try { db.dropFile(state.duckPreviewFile); } catch (_) {} }
      for (const n of state.duckFiles) { try { db.dropFile(n); } catch (_) {} }
      if (state.sqliteCsvName)   { try { db.dropFile(state.sqliteCsvName); }   catch (_) {} }
      if (state.mdCsvName)       { try { db.dropFile(state.mdCsvName); }       catch (_) {} }
      if (state.pasteCsvName)    { try { db.dropFile(state.pasteCsvName); }    catch (_) {} }
      if (state.excelCsvName)    { try { db.dropFile(state.excelCsvName); }    catch (_) {} }
    }
    if (state.sqliteDb) { try { state.sqliteDb.close(); } catch (_) {} }
    resetSqlEditor();
    state.sqliteDb = null;
    state.sqliteCsvName = null;
    state.mdCsvName = null;
    state.markdownTables = [];
    state.pasteCsvName = null;
    state.pasteTables = [];
    state.pasteText = null;
    state.pasteSource = null;
    state.excelCsvName = null;
    { const ec = $('editorCard'); if (ec) ec.hidden = true; const pe = $('pasteEditor'); if (pe) pe.value = ''; }
    state.file = null;
    state.format = null;
    state.duckFile = null;
    state.duckFiles = [];
    state.duckPreviewFile = null;
    state.detected = {};
    state.user = {};
    state.schema = [];
    state.previewRows = [];
    state.sheets = [];
    state.excelBookSample = null;
    state.csvSampleText = null;
    state.csvFullColumnNames = null;
    state.duckdbAlias = null;
    state.duckdbTables = [];
    fileInfo.hidden = true;
    workspace.hidden = true;
    rangePickerCard.hidden = true;
    dropzone.hidden = false;
    setStatus('');
    filePicker.value = '';
  }

  // ---------------------------------------------------------------- CSV detection
  async function detectCSV() {
    // DuckDB-WASM 1.28.0 does not expose sniff_csv as a table function,
    // so we run the heuristic directly on a sample slice.
    const sample = await readSlice(state.file, 0, Math.min(state.file.size, 64 * 1024));
    let bom = false;
    let txt = sample;
    if (txt.charCodeAt(0) === 0xFEFF) { bom = true; txt = txt.slice(1); }

    let lineEnding = 'LF';
    if (txt.indexOf('\r\n') !== -1) lineEnding = 'CRLF';
    else if (txt.indexOf('\r') !== -1 && txt.indexOf('\n') === -1) lineEnding = 'CR';

    const delim = guessDelim(txt);
    const skip  = guessSkip(txt, delim);
    const header = guessHeader(txt, delim, skip);
    const dateformat = guessDateFormat(txt, delim, skip, header);

    state.detected = {
      delim,
      quote:    '"',
      escape:   '"',
      skip,
      header,
      encoding: 'utf-8',
      decimal:  '.',
      nulls:    ['', 'NULL'],
      dateformat,            // '' = let DuckDB auto-detect
      lineEnding,
      bom,
    };
    state.csvSampleText = txt;
  }
  // Try to detect a German/European DD.MM date format from the sample. If we
  // find lots of values matching DD.MM.YYYY or DD.MM.YY (with day > 12 in any
  // of them — the disambiguating signal vs MM.DD), suggest that format. If
  // values are all ambiguous (day ≤ 12), still suggest DD.MM if delimiter is
  // ';' (strong European convention signal). Otherwise return '' so DuckDB
  // auto-detect runs unmodified.
  function guessDateFormat(txt, delim, skip, header) {
    const lines = txt.split(/\r?\n/).slice(skip + (header ? 1 : 0), skip + 60)
      .filter(l => l.length > 0);
    if (!lines.length) return '';
    const cells = [];
    for (const l of lines) {
      const row = splitCsvLine(l, delim);
      for (const c of row) cells.push(String(c).trim());
    }

    const patterns = [
      // [regex, format string, hasFourDigitYear]
      { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, fmt: '%d.%m.%Y', y4: true  },
      { re: /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, fmt: '%d.%m.%y', y4: false },
      { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, fmt: '%d/%m/%Y', y4: true  },
      { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, fmt: '%d/%m/%y', y4: false },
    ];
    let best = null, bestCount = 0, bestUnambiguous = false;
    for (const p of patterns) {
      let count = 0, anyDayOver12 = false;
      for (const c of cells) {
        const m = p.re.exec(c);
        if (!m) continue;
        const a = +m[1], b = +m[2];
        if (a < 1 || a > 31 || b < 1 || b > 31) continue;
        // For our European hypothesis, m[1] is day. Day > 12 unambiguously
        // rules out a US MM/DD interpretation.
        if (a > 12 && b <= 12) anyDayOver12 = true;
        count++;
      }
      if (count > bestCount || (count === bestCount && anyDayOver12 && !bestUnambiguous)) {
        best = p; bestCount = count; bestUnambiguous = anyDayOver12;
      }
    }
    if (!best || bestCount < 3) return '';
    // If ambiguous (no value with day>12) AND delimiter isn't ';', be cautious
    // and don't override DuckDB. Semicolon delimiter strongly implies German
    // locale where DD.MM is virtually universal.
    if (!bestUnambiguous && delim !== ';') return '';
    return best.fmt;
  }
  function guessHeader(txt, delim, skip) {
    const lines = txt.split(/\r?\n/).slice(skip, skip + 6).filter(l => l.length > 0);
    if (lines.length < 2) return true;
    const first  = splitCsvLine(lines[0], delim);
    const others = lines.slice(1).map(l => splitCsvLine(l, delim));
    // Header heuristic: first row has no numeric cells, and at least one
    // following row has a numeric cell in the same column.
    const isNum = s => s !== '' && /^-?\d+([.,]\d+)?$/.test(s.trim());
    const firstHasNum = first.some(isNum);
    if (firstHasNum) return false;
    const followingHasNum = others.some(row => row.some(isNum));
    return followingHasNum || true;
  }
  function guessDelim(txt) {
    const lines = txt.split(/\r?\n/).filter(l => l.length > 0).slice(0, 30);
    const cands = [',', ';', '\t', '|'];
    let best = ',', bestScore = -1;
    for (const c of cands) {
      const counts = lines.map(l => splitCsvLine(l, c).length);
      const mode = counts.sort((a,b)=>a-b)[Math.floor(counts.length/2)] || 1;
      const cons = counts.filter(n => n === mode).length / Math.max(counts.length, 1);
      const score = cons * mode; // prefer consistent + multi-column
      if (score > bestScore && mode > 1) { bestScore = score; best = c; }
    }
    return best;
  }
  function splitCsvLine(line, delim) {
    // very simple split respecting double quotes
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delim) { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }
  function guessSkip(txt, delim) {
    const lines = txt.split(/\r?\n/);
    const counts = lines.slice(0, 200).map(l => l ? splitCsvLine(l, delim).length : 0);
    // dominant column count, ignoring 0/1
    const freq = {};
    counts.forEach(n => { if (n > 1) freq[n] = (freq[n] || 0) + 1; });
    let mode = 0, modeFreq = 0;
    for (const k in freq) if (freq[k] > modeFreq) { modeFreq = freq[k]; mode = +k; }
    if (!mode) return 0;
    let skip = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] === mode) break;
      skip++;
    }
    return skip;
  }

  // ---------------------------------------------------------------- Parquet detection
  async function detectParquet() {
    state.detected = {};
  }

  // ---------------------------------------------------------------- DuckDB detection
  async function detectDuckDB() {
    // ATTACH the registered file as a read-only database, then list tables.
    const alias = `srcdb_${Date.now().toString(36)}`;
    state.duckdbAlias = alias;
    await conn.query(`ATTACH '${sqlEscape(state.duckFile)}' AS ${sqlIdent(alias)} (READ_ONLY)`);
    // List tables + views via the global metadata functions filtered by the
    // attached database. The catalog-qualified path
    // "<alias>.information_schema.tables" isn't reliably addressable on this
    // DuckDB-WASM build, so we use duckdb_tables()/duckdb_views() instead.
    const aliasLit = sqlEscape(alias);
    const res = await conn.query(`
      SELECT schema_name AS table_schema, table_name
      FROM duckdb_tables() WHERE database_name = '${aliasLit}' AND internal = false
      UNION ALL
      SELECT schema_name AS table_schema, view_name AS table_name
      FROM duckdb_views()  WHERE database_name = '${aliasLit}' AND internal = false
      ORDER BY table_schema, table_name
    `);
    const rows = res.toArray();
    state.duckdbTables = rows.map(r => ({
      schema: String(r.table_schema),
      name:   String(r.table_name),
      qualified: `${sqlIdent(alias)}.${sqlIdent(String(r.table_schema))}.${sqlIdent(String(r.table_name))}`,
    }));
    if (!state.duckdbTables.length) throw new Error('No tables found in this database file.');
    // Default to first user table; user can pick another via the heuristic panel.
    state.detected = { table: state.duckdbTables[0].qualified };
  }

  // ---------------------------------------------------------------- SQLite detection (sql.js)
  // DuckDB-Wasm's sqlite extension can't reliably open files from its virtual
  // filesystem (duckdb-wasm issues #1213 / #1972), so SQLite is read with sql.js
  // instead. Preview runs directly against sql.js; export materialises the chosen
  // table to an in-memory CSV that DuckDB then converts (same trick as Excel).
  let sqlJsPromise = null;
  function loadSqlJs() {
    if (sqlJsPromise) return sqlJsPromise;
    const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
    sqlJsPromise = new Promise((resolve, reject) => {
      if (window.initSqlJs) return resolve(window.initSqlJs);
      const s = document.createElement('script');
      s.src = BASE + 'sql-wasm.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.initSqlJs);
      s.onerror = () => reject(new Error('Could not load sql.js from CDN (needs internet).'));
      document.head.appendChild(s);
    }).then(initSqlJs => initSqlJs({ locateFile: f => BASE + f }));
    return sqlJsPromise;
  }

  function sqliteTypeClass(declType) {
    const t = String(declType || '').toUpperCase();
    if (/INT/.test(t))                 return { label: t || 'INTEGER', cls: 't-number' };
    if (/REAL|FLOA|DOUB|NUM|DEC/.test(t)) return { label: t || 'DOUBLE', cls: 't-number' };
    if (/DATE|TIME/.test(t))           return { label: t || 'TIMESTAMP', cls: 't-date' };
    if (/BOOL/.test(t))                return { label: t || 'BOOLEAN', cls: 't-bool' };
    if (/BLOB/.test(t))                return { label: t || 'BLOB', cls: 't-string' };
    return { label: t || 'TEXT', cls: 't-string' };
  }

  async function loadSqlite(file) {
    setStatus('Loading SQLite engine…');
    const SQL = await loadSqlJs();
    const buf = await readAll(file);
    state.sqliteDb = new SQL.Database(new Uint8Array(buf));
    setStatus('Reading tables…');
    const res = state.sqliteDb.exec(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') " +
      "AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const names = res.length ? res[0].values.map(r => String(r[0])) : [];
    if (!names.length) throw new Error('No tables found in this SQLite database.');
    // Reuse the DuckDB table-picker UI; for SQLite "qualified" is the quoted name.
    state.duckdbTables = names.map(n => ({ schema: 'main', name: n, qualified: sqlIdent(n) }));
    state.detected = { table: state.duckdbTables[0].qualified };
  }

  async function previewSqlite() {
    const tbl = eff().table;
    if (!tbl || !state.sqliteDb) { state.schema = []; state.previewRows = []; state.rowCountEstimate = null; return; }
    // Schema from PRAGMA (reliable even for empty tables / views).
    let cols = [];
    try {
      const info = state.sqliteDb.exec(`PRAGMA table_info(${tbl})`);
      if (info.length) cols = info[0].values.map(r => ({ name: String(r[1]), declType: String(r[2] || '') }));
    } catch (_) {}
    state.schema = cols.map(c => { const m = sqliteTypeClass(c.declType); return { name: c.name, type: m.label, typeClass: m.cls }; });
    // Preview rows (first 10).
    const r = state.sqliteDb.exec(`SELECT * FROM ${tbl} LIMIT 10`);
    if (r.length) {
      const columns = r[0].columns;
      if (!state.schema.length) state.schema = columns.map(name => ({ name, type: 'TEXT', typeClass: 't-string' }));
      state.previewRows = r[0].values.map(row => {
        const o = {}; columns.forEach((c, i) => { o[c] = row[i]; }); return o;
      });
    } else {
      state.previewRows = [];
    }
    try {
      const c = state.sqliteDb.exec(`SELECT count(*) AS c FROM ${tbl}`);
      state.rowCountEstimate = { value: Number(c[0].values[0][0]), exact: true };
    } catch (_) { state.rowCountEstimate = null; }
  }

  // Read the selected SQLite table fully via sql.js and register it with DuckDB
  // as an in-memory CSV, so the standard SQL export path can convert it.
  async function materializeSqlite() {
    if (!db) { exportProgress.textContent = 'Loading DuckDB engine…'; await initDuckDB(); }
    const tbl = eff().table;
    exportProgress.textContent = 'Reading SQLite table…';
    const r = state.sqliteDb.exec(`SELECT * FROM ${tbl}`);
    const header   = r.length ? r[0].columns : [];
    const dataRows = r.length ? r[0].values  : [];
    const lines = [header.map(csvEscape).join(',')];
    for (const row of dataRows) lines.push(header.map((_, i) => csvEscape(row[i])).join(','));
    if (state.sqliteCsvName) { try { await db.dropFile(state.sqliteCsvName); } catch (_) {} }
    const name = `sqlite_export_${Date.now()}.csv`;
    await db.registerFileBuffer(name, new TextEncoder().encode(lines.join('\n')));
    state.sqliteCsvName = name;
  }

  // ---------------------------------------------------------------- Markdown tables
  // GFM pipe tables are parsed in JS, then the selected table is materialised to
  // an in-memory CSV that DuckDB reads (same trick as Excel/SQLite) — so type
  // inference, filter, rename and all export targets work via the normal path.
  function splitMdRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|'))   s = s.slice(0, -1);
    // split on unescaped pipes, then unescape \| and \\
    return s.split(/(?<!\\)\|/).map(c =>
      c.replace(/\\\|/g, '|').replace(/\\\\/g, '\\').trim());
  }
  function isMdSeparator(line) {
    const s = line.trim();
    if (!s.includes('-')) return false;
    const cells = splitMdRow(s);
    return cells.length > 0 && cells.every(c => /^:?-{1,}:?$/.test(c.replace(/\s+/g, '')));
  }
  function dedupeMdCols(cols) {
    const seen = new Map(); const out = [];
    cols.forEach((c, i) => {
      let name = (c && c.trim()) || `column${i + 1}`;
      let base = name, n = 1;
      while (seen.has(name)) name = `${base}_${++n}`;
      seen.set(name, true); out.push(name);
    });
    return out;
  }
  function parseMarkdownTables(text) {
    const lines = text.split(/\r?\n/);
    const tables = [];
    let lastHeading = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hm = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
      if (hm) { lastHeading = hm[1].replace(/\s*#*\s*$/, '').trim(); continue; }
      if (line.includes('|') && i + 1 < lines.length && isMdSeparator(lines[i + 1])) {
        const columns = dedupeMdCols(splitMdRow(line));
        const rows = [];
        let j = i + 2;
        for (; j < lines.length; j++) {
          const l = lines[j];
          if (!l.trim() || !l.includes('|')) break;
          const cells = splitMdRow(l);
          rows.push(columns.map((_, k) => (cells[k] != null ? cells[k] : '')));
        }
        tables.push({
          name: `Table ${tables.length + 1}` + (lastHeading ? ` — ${lastHeading}` : ''),
          columns, rows,
        });
        i = j - 1;
        lastHeading = '';
      } else if (line.trim()) {
        lastHeading = '';   // any non-heading content breaks heading association
      }
    }
    return tables;
  }

  async function loadMarkdown(file) {
    setStatus('Parsing Markdown tables…');
    const text = await readSlice(file, 0, file.size);
    const tables = parseMarkdownTables(text);
    if (!tables.length) throw new Error('No Markdown (pipe) table found in this file.');
    state.markdownTables = tables;
    state.detected = { mdTable: 0 };
  }

  // Materialise the selected Markdown table to an in-memory CSV for DuckDB.
  async function materializeMarkdownCsv() {
    if (!db) { await initDuckDB(); }
    const idx = Number(eff().mdTable) || 0;
    const t = state.markdownTables[idx];
    if (!t) throw new Error('No Markdown table selected.');
    const lines = [t.columns.map(csvEscape).join(',')];
    for (const row of t.rows) lines.push(t.columns.map((_, i) => csvEscape(row[i])).join(','));
    if (state.mdCsvName) { try { await db.dropFile(state.mdCsvName); } catch (_) {} }
    const name = `md_table_${Date.now()}.csv`;
    await db.registerFileBuffer(name, new TextEncoder().encode(lines.join('\n')));
    state.mdCsvName = name;
  }

  function markdownSourceSql() {
    return `SELECT * FROM read_csv('${sqlEscape(state.mdCsvName)}', delim=',', quote='"', header=true, auto_detect=true)`;
  }

  async function previewMarkdown() {
    if (!state.markdownTables.length) { state.schema = []; state.previewRows = []; state.rowCountEstimate = null; return; }
    await materializeMarkdownCsv();
    const src = markdownSourceSql();
    const res = await conn.query(`${src} LIMIT 10`);
    state.schema = arrowFields(res.schema);
    state.previewRows = arrowRows(res);
    try {
      const cnt = await conn.query(`SELECT count(*) AS c FROM (${src})`);
      state.rowCountEstimate = { value: Number(cnt.toArray()[0].c), exact: true };
    } catch (_) { state.rowCountEstimate = null; }
  }

  // ---------------------------------------------------------------- Pasted clipboard data
  // Heuristically extract a table from clipboard content. Prefers an HTML <table>
  // (Excel / browser copies include text/html); otherwise detects a delimiter in
  // plain text (tab / ; / | / , / whitespace). Parsed rows are materialised to an
  // in-memory CSV that DuckDB reads (same path as Markdown/SQLite/Excel).
  function csvSplitLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function splitDelim(line, delim) {
    if (delim === 'ws') return line.trim().split(/\s{2,}|\t/);
    if (delim === ',')  return csvSplitLine(line);
    return line.split(delim);
  }
  function detectDelim(text) {
    const raw = text.split(/\r?\n/);
    // Markdown pipe table? (a header row with pipes followed by a |---|--- row)
    for (let i = 1; i < raw.length; i++) {
      if (raw[i - 1].includes('|') && isMdSeparator(raw[i])) return 'md';
    }
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
    if (!lines.length) return ',';
    let best = null, bestScore = -1;
    for (const d of ['\t', ';', '|', ',']) {
      const counts = lines.map(l => splitDelim(l, d).length);
      const freq = {};
      counts.forEach(c => { if (c >= 2) freq[c] = (freq[c] || 0) + 1; });
      let modeCount = 0, modeLines = 0;
      for (const k in freq) if (freq[k] > modeLines) { modeLines = freq[k]; modeCount = +k; }
      if (modeCount < 2) continue;
      const score = modeLines * 100 + modeCount;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    if (best) return best;
    if (lines.some(l => /\S(?: {2,}|\t)\S/.test(l))) return 'ws';
    return ',';
  }
  function parseDelimited(text, delim) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length);
    const matrix = lines.map(l => splitDelim(l, delim).map(c => c.trim()));
    const w = matrix.reduce((m, r) => Math.max(m, r.length), 0);
    matrix.forEach(r => { while (r.length < w) r.push(''); });
    return matrix;
  }
  function parseHtmlTables(html) {
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (_) { return []; }
    const tables = [];
    doc.querySelectorAll('table').forEach(tbl => {
      const matrix = [];
      tbl.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(td =>
          cells.push((td.textContent || '').replace(/\s+/g, ' ').trim()));
        if (cells.length) matrix.push(cells);
      });
      if (!matrix.length) return;
      const w = matrix.reduce((m, r) => Math.max(m, r.length), 0);
      matrix.forEach(r => { while (r.length < w) r.push(''); });
      const cap = tbl.querySelector('caption');
      const capTxt = cap && cap.textContent.trim();
      tables.push({ name: `Table ${tables.length + 1}` + (capTxt ? ` — ${capTxt}` : ''), matrix });
    });
    return tables;
  }
  function loadPaste(payload) {
    const html = (payload.html || '').trim();
    const text = payload.text || '';
    const htmlTables = html ? parseHtmlTables(html) : [];
    if (htmlTables.length) {
      state.pasteSource = 'html';
      state.pasteText = null;
      state.pasteTables = htmlTables;
      state.detected = { pasteTable: 0, pasteHeader: true };
      return;
    }
    if (!text.trim()) throw new Error('Clipboard contained no table-like data.');
    const delim = detectDelim(text);
    const matrix = parseDelimited(text, delim);
    if (!matrix.length) throw new Error('Could not detect any rows in the pasted text.');
    state.pasteSource = 'text';
    state.pasteText = text;
    state.pasteTables = [{ name: 'Pasted table', matrix }];
    state.detected = { pasteTable: 0, pasteDelim: delim, pasteHeader: true };
  }

  // Resolve the current matrix for the active paste table. For the text/editor
  // source it is (re)parsed from state.pasteText using the chosen delimiter —
  // including 'md' (Markdown pipe table, separator row dropped).
  function activePasteMatrix() {
    const idx = Number(eff().pasteTable) || 0;
    let t = state.pasteTables[idx] || { matrix: [] };
    if (state.pasteSource === 'text') {
      const text = state.pasteText || '';
      const delim = eff().pasteDelim || detectDelim(text);
      let matrix;
      if (delim === 'md') {
        const mdt = parseMarkdownTables(text);
        matrix = mdt.length ? [mdt[0].columns.slice(), ...mdt[0].rows.map(r => r.slice())] : [];
      } else {
        matrix = parseDelimited(text, delim);
      }
      t = { name: t.name || 'Pasted table', matrix };
      state.pasteTables[idx] = t;
    }
    return t.matrix || [];
  }
  async function registerPasteCsv(matrix) {
    const header = eff().pasteHeader !== false;
    const columns = header ? dedupeMdCols(matrix[0]) : matrix[0].map((_, i) => `column${i + 1}`);
    const dataRows = header ? matrix.slice(1) : matrix;
    const lines = [columns.map(csvEscape).join(',')];
    for (const row of dataRows) lines.push(columns.map((_, i) => csvEscape(row[i])).join(','));
    if (state.pasteCsvName) { try { await db.dropFile(state.pasteCsvName); } catch (_) {} }
    const name = `paste_${Date.now()}.csv`;
    await db.registerFileBuffer(name, new TextEncoder().encode(lines.join('\n')));
    state.pasteCsvName = name;
  }
  async function materializePasteCsv() {
    if (!db) { await initDuckDB(); }
    const matrix = activePasteMatrix();
    if (!matrix.length) throw new Error('No rows to import — the editor is empty.');
    await registerPasteCsv(matrix);
  }
  function pasteSourceSql() {
    return `SELECT * FROM read_csv('${sqlEscape(state.pasteCsvName)}', delim=',', quote='"', header=true, auto_detect=true)`;
  }
  async function previewPaste() {
    if (!db) { await initDuckDB(); }
    const matrix = activePasteMatrix();
    if (!matrix.length) { state.schema = []; state.previewRows = []; state.rowCountEstimate = null; return; }
    await registerPasteCsv(matrix);
    const src = pasteSourceSql();
    const res = await conn.query(`${src} LIMIT 10`);
    state.schema = arrowFields(res.schema);
    state.previewRows = arrowRows(res);
    try {
      const cnt = await conn.query(`SELECT count(*) AS c FROM (${src})`);
      state.rowCountEstimate = { value: Number(cnt.toArray()[0].c), exact: true };
    } catch (_) { state.rowCountEstimate = null; }
  }

  // Convert the active pasted table to tab-separated text and switch to the
  // text/editor source so an HTML-pasted table becomes editable.
  function editPasteAsText() {
    const idx = Number(eff().pasteTable) || 0;
    const m = (state.pasteTables[idx] || { matrix: [] }).matrix;
    state.pasteSource = 'text';
    state.pasteText = m.map(r => r.join('\t')).join('\n');
    state.pasteTables = [{ name: 'Edited table', matrix: m }];
    state.detected = { pasteTable: 0, pasteDelim: '\t', pasteHeader: eff().pasteHeader !== false };
    state.user = {};
    renderHeuristicPanel();
    renderExportOptions();
    refreshPreview().then(syncPasteEditor);
  }

  // Show/refresh the source editor card for the text/editor paste source.
  function syncPasteEditor() {
    const card = $('editorCard');
    const ta = $('pasteEditor');
    if (!card || !ta) return;
    const show = state.format === 'paste' && state.pasteSource === 'text';
    card.hidden = !show;
    if (show && document.activeElement !== ta) ta.value = state.pasteText || '';
  }

  // Open an empty editor to author a table from scratch (defaults to Markdown).
  function enterEditorMode() {
    const starter =
      '| column1 | column2 | column3 |\n' +
      '| --- | --- | --- |\n' +
      '| a | 1 | 2024-01-01 |\n' +
      '| b | 2 | 2024-02-01 |\n';
    return enterPasteMode({ html: '', text: starter }, 'New table');
  }

  // Enter the workspace with pasted clipboard data (no file involved).
  async function enterPasteMode(payload, label) {
    exitSnapshotMode();
    if (db) {
      if (state.duckFile)        { try { await db.dropFile(state.duckFile); }        catch (_) {} }
      if (state.duckPreviewFile) { try { await db.dropFile(state.duckPreviewFile); } catch (_) {} }
      if (state.sqliteCsvName)   { try { await db.dropFile(state.sqliteCsvName); }   catch (_) {} }
      if (state.mdCsvName)       { try { await db.dropFile(state.mdCsvName); }       catch (_) {} }
      if (state.pasteCsvName)    { try { await db.dropFile(state.pasteCsvName); }    catch (_) {} }
    }
    if (state.duckdbAlias && conn) { try { await conn.query(`DETACH ${sqlIdent(state.duckdbAlias)}`); } catch (_) {} }
    if (state.sqliteDb) { try { state.sqliteDb.close(); } catch (_) {} }
    Object.assign(state, {
      duckFile: null, duckPreviewFile: null, duckdbAlias: null, duckdbTables: [],
      sqliteDb: null, sqliteCsvName: null, mdCsvName: null, markdownTables: [],
      pasteCsvName: null, sheets: [], excelBookSample: null,
      csvSampleText: null, csvFullColumnNames: null, user: {},
    });
    state.format = 'paste';
    state.file = { name: 'clipboard.txt' };
    state.fileSize = (payload.text || payload.html || '').length;

    try {
      setStatus('Reading clipboard…');
      loadPaste(payload);
      dropzone.hidden = true;
      fileInfo.hidden = false;
      fileIcon.textContent = state.pasteSource === 'html' ? 'CLP' : 'TXT';
      fileName.textContent = label || 'Pasted data';
      const n = state.pasteTables.length;
      fileMeta.textContent = `PASTE (${state.pasteSource === 'html' ? 'HTML' : 'text'}) · ${n} table${n === 1 ? '' : 's'}`;
      workspace.hidden = false;
      renderHeuristicPanel();
      renderExportOptions();
      await refreshPreview();
      syncPasteEditor();
      updateHeuristicCollapseState();
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('Error: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }

  // ---------------------------------------------------------------- JSON / NDJSON detection
  async function detectJSON(fmt) {
    // For nested JSON (object with data under a path), try to find longest array
    if (fmt === 'json') {
      // Read first chunk only — check if root is array or object with nested array
      const text = await readSlice(state.file, 0, Math.min(state.file.size, 256 * 1024));
      const trimmed = text.replace(/^\uFEFF/, '').trimStart();
      if (trimmed.startsWith('[')) {
        state.detected = { mode: 'array' };
      } else {
        // Try to parse and find longest array path
        try {
          const fullText = await readSlice(state.file, 0, state.file.size);
          const obj = JSON.parse(fullText);
          const path = findLongestArrayPath(obj);
          state.detected = { mode: 'nested', jsonPath: path || '$' };
        } catch (e) {
          state.detected = { mode: 'array' };
        }
      }
    } else {
      state.detected = { mode: 'ndjson' };
    }
  }
  function findLongestArrayPath(obj) {
    // BFS over object, return path-like string for longest array of objects
    let best = null, bestLen = 0;
    function walk(v, path) {
      if (Array.isArray(v)) {
        if (v.length > bestLen && (v.length === 0 || typeof v[0] === 'object')) {
          best = path; bestLen = v.length;
        }
      } else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) walk(v[k], path ? path + '.' + k : k);
      }
    }
    walk(obj, '');
    return best;
  }

  // ---------------------------------------------------------------- Excel handling
  async function loadExcel(file) {
    setStatus('Parsing Excel sample (first 100 rows)…');
    const buf = await readAll(file);
    const wb = XLSX.read(buf, { type: 'array', sheetRows: 100, cellDates: true });
    state.excelBookSample = wb;
    state.sheets = wb.SheetNames.map(name => {
      const ws = wb.Sheets[name];
      const ref = ws['!ref'] || 'A1:A1';
      return { name, ref };
    });
    // Pick first non-empty sheet as default
    let firstName = wb.SheetNames[0];
    for (const n of wb.SheetNames) {
      const ws = wb.Sheets[n];
      if (ws['!ref'] && ws['!ref'] !== 'A1:A1') { firstName = n; break; }
    }
    const firstSheet = wb.Sheets[firstName];
    const detected = detectExcelDataBlock(firstSheet);
    state.detected = {
      sheet: firstName,
      range: extendRangeToSheetEnd(detected.range, firstSheet),
      detectedRange: detected.range,   // unchanged — used only for the green highlight
      header: true,
    };
  }

  // Find largest contiguous block of non-empty cells, skipping title rows
  function detectExcelDataBlock(ws) {
    const ref = ws['!ref'];
    if (!ref) return { range: 'A1:A1', headerRowIdx: 0 };
    const range = XLSX.utils.decode_range(ref);
    // Build a 2D occupancy matrix
    const rows = [];
    for (let R = range.s.r; R <= range.e.r; R++) {
      const row = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        row.push(ws[addr] && ws[addr].v != null && String(ws[addr].v).trim() !== '');
      }
      rows.push(row);
    }
    // Per row: count of filled cells
    const fill = rows.map(r => r.reduce((a,b) => a + (b ? 1 : 0), 0));
    if (fill.every(f => f === 0)) return { range: ref, headerRowIdx: 0 };

    // Mode of row width (only for rows with > 1 filled cells)
    const widths = fill.filter(n => n > 1);
    const freq = {};
    widths.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
    let modeW = 0, modeF = 0;
    for (const k in freq) if (freq[k] > modeF) { modeF = freq[k]; modeW = +k; }
    if (!modeW) modeW = Math.max(...fill);

    // Find first row with (>= modeW * 0.6) filled cells AND followed by another similar row → data start
    let dataStart = -1;
    for (let i = 0; i < rows.length - 1; i++) {
      if (fill[i] >= modeW * 0.6 && fill[i+1] >= modeW * 0.6) { dataStart = i; break; }
    }
    if (dataStart === -1) {
      for (let i = 0; i < rows.length; i++) if (fill[i] >= modeW * 0.6) { dataStart = i; break; }
    }
    if (dataStart === -1) dataStart = 0;

    // Find first row of zero fill after dataStart → end
    let dataEnd = rows.length - 1;
    for (let i = dataStart + 1; i < rows.length; i++) {
      if (fill[i] === 0) { dataEnd = i - 1; break; }
    }

    // Find horizontal extent at dataStart row
    const startRow = rows[dataStart];
    let firstCol = 0; while (firstCol < startRow.length && !startRow[firstCol]) firstCol++;
    let lastCol = startRow.length - 1; while (lastCol > firstCol && !startRow[lastCol]) lastCol--;

    const s = { r: range.s.r + dataStart, c: range.s.c + firstCol };
    const e = { r: range.s.r + dataEnd, c: range.s.c + lastCol };
    const rng = XLSX.utils.encode_range({ s, e });
    return { range: rng, headerRowIdx: dataStart };
  }

  // ---------------------------------------------------------------- Heuristic UI
  function renderHeuristicPanel() {
    const e = eff();
    let html = '';

    if (state.format === 'csv') {
      html += renderField('Delimiter', selectMarkup('h_delim', [
        { v: ',', label: ', (comma)' },
        { v: ';', label: '; (semicolon)' },
        { v: '\t', label: '\\t (tab)' },
        { v: '|', label: '| (pipe)' },
      ], e.delim, true), e, 'delim');
      html += renderField('Quote', selectMarkup('h_quote', [
        { v: '"', label: '"' },
        { v: "'", label: "'" },
        { v: '', label: 'none' },
      ], e.quote, true), e, 'quote');
      html += renderField('Encoding', selectMarkup('h_enc', [
        { v: 'utf-8', label: 'utf-8' },
        { v: 'latin-1', label: 'latin-1' },
        { v: 'windows-1252', label: 'windows-1252' },
      ], e.encoding, false), e, 'encoding');
      html += renderField('Skip rows', `<input class="qrx-input" id="h_skip" type="number" min="0" value="${e.skip ?? 0}">`, e, 'skip');
      html += `<div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="h_header" ${e.header ? 'checked' : ''}>
        <span class="qrx-label" style="margin: 0;">Has header row</span>
      </label></div>`;
      html += renderField('Decimal separator', selectMarkup('h_decimal', [
        { v: '.', label: '. (dot)' },
        { v: ',', label: ', (comma)' },
      ], e.decimal, false), e, 'decimal');
      html += renderField('Date format', `<input class="qrx-input" id="h_dateformat" type="text"
        value="${escapeAttr(e.dateformat || '')}" spellcheck="false"
        placeholder="auto-detect — e.g. %d.%m.%Y or %Y-%m-%d">`, e, 'dateformat');
      html += renderField('NULL strings', `<div class="tag-chip-input" id="h_nulls"></div>`, e, 'nulls');
      html += `<div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="h_tolerant" ${e.tolerant ? 'checked' : ''}>
        <span class="qrx-label" style="margin: 0;">Tolerate malformed rows
          <span class="muted" style="font-weight: 400; font-size: 0.8125rem;">
            — skip the sniffer, treat all columns as text, ignore parse errors
          </span>
        </span>
      </label></div>`;
    }
    else if (state.format === 'parquet') {
      html += `<p class="muted" style="font-size: 0.875rem;">
        Parquet self-describes its schema and types. No parsing options needed.
      </p>`;
    }
    else if (state.format === 'duckdb' || state.format === 'sqlite') {
      const opts = state.duckdbTables.map(t =>
        `<option value="${escapeAttr(t.qualified)}" ${t.qualified === e.table ? 'selected' : ''}>${escapeHtml(t.schema)}.${escapeHtml(t.name)}</option>`
      ).join('');
      html += renderField('Table', `<select class="qrx-select" id="h_table">${opts}</select>`, e, 'table');
      html += `<p class="muted" style="font-size: 0.8125rem; margin-top: var(--qrx-s-2);">
        ${state.duckdbTables.length} table${state.duckdbTables.length === 1 ? '' : 's'} in this database.
        Pick one to read from. Schema and types come straight from the file.
      </p>`;
    }
    else if (state.format === 'markdown') {
      const sel = Number(e.mdTable) || 0;
      const opts = state.markdownTables.map((t, i) =>
        `<option value="${i}" ${i === sel ? 'selected' : ''}>${escapeHtml(t.name)} (${t.rows.length} rows)</option>`
      ).join('');
      html += renderField('Table', `<select class="qrx-select" id="h_mdtable">${opts}</select>`, e, 'mdTable');
      html += `<p class="muted" style="font-size: 0.8125rem; margin-top: var(--qrx-s-2);">
        ${state.markdownTables.length} table${state.markdownTables.length === 1 ? '' : 's'} found.
        Column types are inferred (Markdown carries none).
      </p>`;
    }
    else if (state.format === 'paste') {
      if (state.pasteTables.length > 1) {
        const sel = Number(e.pasteTable) || 0;
        const opts = state.pasteTables.map((t, i) =>
          `<option value="${i}" ${i === sel ? 'selected' : ''}>${escapeHtml(t.name)} (${t.matrix.length} rows)</option>`
        ).join('');
        html += renderField('Table', `<select class="qrx-select" id="h_pastetable">${opts}</select>`, e, 'pasteTable');
      }
      if (state.pasteSource === 'text') {
        html += renderField('Delimiter', selectMarkup('h_pastedelim', [
          { v: '\t', label: '\\t (tab)' },
          { v: ',',  label: ', (comma)' },
          { v: ';',  label: '; (semicolon)' },
          { v: '|',  label: '| (pipe)' },
          { v: 'ws', label: 'whitespace' },
          { v: 'md', label: 'Markdown table' },
        ], e.pasteDelim, true), e, 'pasteDelim');
      }
      const mdHint = (eff().pasteDelim === 'md')
        ? ' The <code>|---|</code> separator row is ignored; the first row is the header.' : '';
      if (state.pasteSource !== 'text') {
        html += `<div class="qrx-form-group">
          <button class="qrx-btn" id="h_pasteedit" type="button">Edit as text</button>
        </div>`;
      }
      html += `<div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="h_pasteheader" ${e.pasteHeader !== false ? 'checked' : ''}
               ${eff().pasteDelim === 'md' ? 'disabled' : ''}>
        <span class="qrx-label" style="margin: 0;">First row is header</span>
      </label></div>`;
      html += `<p class="muted" style="font-size: 0.8125rem; margin-top: var(--qrx-s-2);">
        Pasted ${state.pasteSource === 'html' ? 'HTML table' : 'text'} ·
        ${state.pasteTables.length} table${state.pasteTables.length === 1 ? '' : 's'}.
        Column types are inferred.${mdHint}
      </p>`;
    }
    else if (state.format === 'json' || state.format === 'ndjson') {
      const mode = e.mode || (state.format === 'ndjson' ? 'ndjson' : 'array');
      html += `<div class="qrx-form-group">
        <span class="qrx-label">Mode</span>
        <label class="checkbox-row" style="margin-bottom: 4px;">
          <input type="radio" name="h_mode" value="ndjson" ${mode==='ndjson'?'checked':''}> NDJSON / JSON Lines
        </label>
        <label class="checkbox-row" style="margin-bottom: 4px;">
          <input type="radio" name="h_mode" value="array" ${mode==='array'?'checked':''}> JSON Array
        </label>
        <label class="checkbox-row">
          <input type="radio" name="h_mode" value="nested" ${mode==='nested'?'checked':''}> Nested object
        </label>
      </div>`;
      html += `<div class="qrx-form-group" id="h_pathGroup" ${mode==='nested'?'':'hidden'}>
        <label class="qrx-label" for="h_path">JSON path
          ${state.detected.jsonPath ? '<span class="auto-badge">auto</span>' : ''}
        </label>
        <input class="qrx-input" id="h_path" type="text"
               value="${(e.jsonPath ?? '').replace(/"/g,'&quot;')}"
               placeholder="results.items">
      </div>`;
      if (state.format === 'json' && state.fileSize > 100 * 1024 * 1024) {
        html += `<div class="warn-banner">
          This JSON file is larger than 100&nbsp;MB. JSON arrays must be parsed in
          full. Consider converting to NDJSON for streaming.
        </div>`;
      }
    }
    else if (state.format === 'xlsx') {
      const sheetOpts = state.sheets.map(s =>
        `<option value="${s.name}" ${s.name === e.sheet ? 'selected' : ''}>${s.name}</option>`).join('');
      html += `<div class="qrx-form-group">
        <label class="qrx-label" for="h_sheet">Sheet</label>
        <select class="qrx-select" id="h_sheet">${sheetOpts}</select>
      </div>`;
      html += renderField('Range', `<input class="qrx-input" id="h_range" type="text"
        value="${(e.range || '').replace(/"/g,'&quot;')}"
        placeholder="A1:Z1000">`, e, 'range');
      html += `<div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="h_header" ${e.header ? 'checked' : ''}>
        <span class="qrx-label" style="margin: 0;">First row is header</span>
      </label></div>`;
    }

    heuristicFields.innerHTML = html;
    wireHeuristicHandlers();

    // After render — update range picker visibility
    if (state.format === 'xlsx' || state.format === 'csv') {
      rangePickerCard.hidden = false;
      renderRangePicker();
    } else {
      rangePickerCard.hidden = true;
    }
  }
  function renderField(label, controlHTML, e, key) {
    const isUserOverride = key in state.user;
    const hasDetected = key in state.detected;
    const badge = isUserOverride ? '<span class="user-badge">user</span>' :
                  hasDetected ? '<span class="auto-badge">auto</span>' : '';
    return `<div class="qrx-form-group">
      <label class="qrx-label">${label}${badge}</label>${controlHTML}
    </div>`;
  }
  function selectMarkup(id, options, current, allowCustom) {
    const seen = options.some(o => o.v === current);
    let html = `<select class="qrx-select" id="${id}">`;
    for (const o of options) {
      const sel = o.v === current ? 'selected' : '';
      html += `<option value="${escapeAttr(o.v)}" ${sel}>${escapeHtml(o.label)}</option>`;
    }
    if (allowCustom && !seen && current != null) {
      html += `<option value="${escapeAttr(current)}" selected>${escapeHtml(JSON.stringify(current))} (custom)</option>`;
    }
    html += '</select>';
    return html;
  }
  function escapeAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function wireHeuristicHandlers() {
    const onChange = debounce(refreshPreview, 300);
    function setUser(key, value) {
      // Mark as user override only if value differs from detected
      if (state.detected[key] !== undefined && deepEq(state.detected[key], value)) {
        delete state.user[key];
      } else {
        state.user[key] = value;
      }
    }
    function deepEq(a, b) {
      if (a === b) return true;
      if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x,i)=>x===b[i]);
      }
      return false;
    }

    if (state.format === 'csv') {
      $('h_delim').addEventListener('change', e => { setUser('delim', e.target.value); rerenderBadges(); onChange(); });
      $('h_quote').addEventListener('change', e => { setUser('quote', e.target.value); rerenderBadges(); onChange(); });
      $('h_enc').addEventListener('change',   e => { setUser('encoding', e.target.value); rerenderBadges(); onChange(); });
      $('h_skip').addEventListener('input',   e => { setUser('skip', Number(e.target.value) || 0); rerenderBadges(); onChange(); });
      $('h_header').addEventListener('change', e => { setUser('header', e.target.checked); rerenderBadges(); onChange(); });
      $('h_decimal').addEventListener('change', e => { setUser('decimal', e.target.value); rerenderBadges(); onChange(); });
      $('h_dateformat').addEventListener('input', e => { setUser('dateformat', e.target.value.trim()); rerenderBadges(); onChange(); });
      $('h_tolerant').addEventListener('change', e => {
        setUser('tolerant', e.target.checked);
        rerenderBadges();
        onChange();
      });
      // tag chips for nulls
      mountChipsInput($('h_nulls'), eff().nulls, list => { setUser('nulls', list); rerenderBadges(); onChange(); });
    }
    else if (state.format === 'duckdb' || state.format === 'sqlite') {
      $('h_table').addEventListener('change', e => {
        setUser('table', e.target.value);
        // Switching tables completely changes the column space — reset
        // any per-column edits so they don't carry over orphaned.
        delete state.user.columnEdits;
        rerenderBadges();
        onChange();
      });
    }
    else if (state.format === 'markdown') {
      $('h_mdtable').addEventListener('change', e => {
        setUser('mdTable', Number(e.target.value));
        // Switching tables changes the column space — drop per-column edits.
        delete state.user.columnEdits;
        rerenderBadges(); onChange();
      });
    }
    else if (state.format === 'paste') {
      const tp = $('h_pastetable');
      if (tp) tp.addEventListener('change', e => {
        setUser('pasteTable', Number(e.target.value));
        delete state.user.columnEdits;
        rerenderBadges(); onChange();
      });
      const dl = $('h_pastedelim');
      if (dl) dl.addEventListener('change', e => {
        setUser('pasteDelim', e.target.value);
        delete state.user.columnEdits;
        // Re-render so the header toggle / hint reflect the Markdown mode.
        renderHeuristicPanel();
        refreshPreview();
      });
      const hd = $('h_pasteheader');
      if (hd) hd.addEventListener('change', e => {
        setUser('pasteHeader', e.target.checked);
        delete state.user.columnEdits;
        rerenderBadges(); onChange();
      });
      const ed = $('h_pasteedit');
      if (ed) ed.addEventListener('click', editPasteAsText);
    }
    else if (state.format === 'json' || state.format === 'ndjson') {
      document.querySelectorAll('input[name="h_mode"]').forEach(r => {
        r.addEventListener('change', e => {
          setUser('mode', e.target.value);
          $('h_pathGroup').hidden = e.target.value !== 'nested';
          rerenderBadges(); onChange();
        });
      });
      const pathEl = $('h_path');
      if (pathEl) pathEl.addEventListener('input', e => {
        setUser('jsonPath', e.target.value);
        rerenderBadges(); onChange();
      });
    }
    else if (state.format === 'xlsx') {
      $('h_sheet').addEventListener('change', async e => {
        // Re-detect range when switching sheet
        const newSheet = e.target.value;
        state.user = {};
        const ws = state.excelBookSample.Sheets[newSheet];
        const detected = detectExcelDataBlock(ws);
        state.detected = {
          sheet: newSheet,
          range: extendRangeToSheetEnd(detected.range, ws),
          detectedRange: detected.range,
          header: true,
        };
        renderHeuristicPanel();
        await refreshPreview();
      });
      $('h_range').addEventListener('input', e => {
        setUser('range', e.target.value.trim());
        rerenderBadges();
        renderRangePicker();
        onChange();
      });
      $('h_header').addEventListener('change', e => { setUser('header', e.target.checked); rerenderBadges(); onChange(); });
    }
  }

  function rerenderBadges() {
    // Light update: re-render heuristic panel to refresh auto/user badges
    // (preserves focus by using requestAnimationFrame-deferred re-render)
    // Simpler: just re-render
    const focusId = document.activeElement && document.activeElement.id;
    const selStart = document.activeElement && document.activeElement.selectionStart;
    renderHeuristicPanel();
    // Refresh the summary hint label so it tracks override state, but
    // don't toggle the panel's open/close — that should only change on
    // load/reset, not on every keystroke.
    const hint = $('heuristicSummaryHint');
    if (hint) {
      const hasUserOverride = state.user && Object.keys(state.user).length > 0;
      hint.textContent = hasUserOverride
        ? 'overrides active'
        : 'auto-detected — click to adjust';
    }
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (selStart != null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selStart); } catch (e) {}
        }
      }
    }
  }

  // Chips-style input for NULL strings
  function mountChipsInput(container, initial, onChange) {
    let chips = (initial || []).slice();
    function render() {
      container.innerHTML = '';
      chips.forEach((c, i) => {
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.innerHTML = `${c === '' ? '<i style="color:var(--qrx-text-subtle)">empty</i>' : escapeHtml(c)} <button aria-label="remove">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
          chips.splice(i, 1);
          render();
          onChange(chips.slice());
        });
        container.appendChild(chip);
      });
      const inp = document.createElement('input');
      inp.placeholder = 'add… (enter)';
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          const v = inp.value;
          if (v.length > 0 || e.shiftKey) {
            chips.push(v);
            inp.value = '';
            render();
            onChange(chips.slice());
          }
        }
      });
      container.appendChild(inp);
    }
    render();
  }

  resetHeuristicBtn.addEventListener('click', () => {
    state.user = {};
    rerenderBadges();
    refreshPreview().then(updateHeuristicCollapseState);
  });

  $('copySchemaBtn').addEventListener('click', e => {
    e.stopPropagation();
    openSchemaCopyPopover(e.currentTarget);
  });

  // Decide whether the heuristic panel should be open after a (re)load.
  // Open when detection failed (no schema produced) or the user has set
  // any explicit override; otherwise keep it collapsed to save vertical space.
  function updateHeuristicCollapseState() {
    const hint = $('heuristicSummaryHint');
    const hasUserOverride = state.user && Object.keys(state.user).length > 0;
    const detectionFailed = !state.schema || state.schema.length === 0;
    if (hasUserOverride) {
      heuristicPanel.open = true;
      if (hint) hint.textContent = 'overrides active';
    } else if (detectionFailed) {
      heuristicPanel.open = true;
      if (hint) hint.textContent = 'detection incomplete — please check';
    } else {
      heuristicPanel.open = false;
      if (hint) hint.textContent = 'auto-detected — click to adjust';
    }
  }

  // ---------------------------------------------------------------- Range picker
  // Simplified model: the user just picks WHERE the data starts.
  // Any selection (single cell or drag) is interpreted as:
  //   start row    = top row of the selection (= header row, or first data row)
  //   column span  = leftmost..rightmost column of the selection
  //   end row      = sheet's last data row (auto)
  // So the user only ever needs to mark the header / first data row.
  let rpDragStart = null;
  let rpDragCurrent = null;
  let rpMouseUpBound = false;

  function decodeRangeSafe(s) {
    if (!s) return null;
    try { return XLSX.utils.decode_range(s); } catch (e) { return null; }
  }
  function getSheetExtent(ws) {
    if (!ws) return null;
    // SheetJS sets !fullref when sheetRows truncates the load; prefer it
    // so we know the true end of the sheet, not just the loaded sample.
    const ref = ws['!fullref'] || ws['!ref'];
    if (!ref) return null;
    return decodeRangeSafe(ref);
  }
  // Stretch a range's end-row down to the sheet's true last row.
  function extendRangeToSheetEnd(rangeStr, ws) {
    const r = decodeRangeSafe(rangeStr);
    const ext = getSheetExtent(ws);
    if (!r || !ext) return rangeStr;
    if (ext.e.r <= r.e.r) return rangeStr;
    return XLSX.utils.encode_range({
      s: { r: r.s.r, c: r.s.c },
      e: { r: ext.e.r, c: r.e.c },
    });
  }

  // Bind document-level mouseup once globally — avoids listener leak across re-renders
  function ensureMouseUpBound() {
    if (rpMouseUpBound) return;
    rpMouseUpBound = true;
    document.addEventListener('mouseup', () => {
      if (rpDragStart && rpDragCurrent) {
        applyRangeFromDrag(true);
      }
      rpDragStart = null;
      rpDragCurrent = null;
    });
  }

  function renderRangePicker() {
    // Reset transient handlers — each format installs its own
    rangePickerEl.onmousedown = null;
    rangePickerEl.onmousemove = null;
    rangePickerEl.onclick = null;
    rangePickerEl.classList.remove('is-csv');

    if (state.format === 'xlsx') {
      rangePickerTitle.textContent = 'Excel data block';
      rangePickerHint.textContent  = 'drag to select range';
      rangePickerHelp.textContent  =
        'Detected block is highlighted in green. Click the header row (or the first data row) ' +
        'and drag across the columns you want to include — all rows from there to the end of ' +
        'the sheet will be used.';
      renderRangePickerExcel();
    } else if (state.format === 'csv') {
      rangePickerTitle.textContent = 'CSV data block';
      rangePickerHint.textContent  = 'drag to select the header row';
      rangePickerHelp.textContent  =
        'The detected start row is highlighted in green. Click or drag to mark the row that ' +
        'contains the column headers (or the first data row, if there are no headers) — ' +
        'everything before it will be skipped.';
      renderRangePickerCsv();
    } else {
      rangePickerEl.innerHTML = '';
    }
  }

  function renderRangePickerExcel() {
    if (!state.excelBookSample) { rangePickerEl.innerHTML = ''; return; }
    const e = eff();
    const ws = state.excelBookSample.Sheets[e.sheet];
    if (!ws) { rangePickerEl.innerHTML = '<p class="muted">Empty sheet</p>'; return; }

    const ROWS = 15;
    // Show every column that exists in the sheet, capped at a sane upper bound
    // so we don't render thousands of cells. Picker scrolls horizontally
    // if needed (range-picker has overflow: auto).
    const ext = getSheetExtent(ws);
    const sheetCols = ext ? (ext.e.c + 1) : 12;
    const COLS = Math.max(12, Math.min(sheetCols, 200));

    let html = '<table><thead><tr><th class="corner"></th>';
    for (let c = 0; c < COLS; c++) {
      html += `<th>${XLSX.utils.encode_col(c)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let r = 0; r < ROWS; r++) {
      html += `<tr><td class="row-head">${r + 1}</td>`;
      for (let c = 0; c < COLS; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const v = cell ? (cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : '')) : '';
        html += `<td class="cell" data-r="${r}" data-c="${c}" title="${escapeAttr(v)}">${escapeHtml(v)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    rangePickerEl.innerHTML = html;
    wireRangePicker();
    updateSelectionHighlight();
  }

  function renderRangePickerCsv() {
    if (!state.csvSampleText) { rangePickerEl.innerHTML = ''; return; }
    rangePickerEl.classList.add('is-csv');

    const e = eff();
    const delim = e.delim || ',';
    const ROWS = 30;

    // Parse the first ROWS lines of the sample with the current delimiter
    const lines = state.csvSampleText.split(/\r?\n/);
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const slice = lines.slice(0, ROWS);
    const parsed = slice.map(l => splitCsvLine(l, delim));
    // Show every detected column, capped at 200 to avoid runaway DOM
    const detectedCols = Math.max(1, ...parsed.map(r => r.length));
    const maxCols = Math.min(200, detectedCols);

    let html = '<table><thead><tr><th class="corner"></th>';
    for (let c = 0; c < maxCols; c++) html += `<th>${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < parsed.length; r++) {
      html += `<tr data-r="${r}"><td class="row-head">${r + 1}</td>`;
      for (let c = 0; c < maxCols; c++) {
        const v = parsed[r][c] != null ? String(parsed[r][c]) : '';
        html += `<td class="cell" data-r="${r}" data-c="${c}" title="${escapeAttr(v)}">${escapeHtml(v)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    rangePickerEl.innerHTML = html;
    wireRangePicker();
    updateSelectionHighlight();
  }

  // -------- Format adapter --------------------------------------------------
  // The picker is a generic rectangle-selection widget. Format-specific behaviour
  // is isolated to two methods: getRect() reads format state and returns a
  // picker-space rectangle to highlight; commit() takes a committed drag
  // rectangle and writes it back to format-specific state.
  function getPickerAdapter() {
    if (state.format === 'xlsx') return excelPickerAdapter;
    if (state.format === 'csv')  return csvPickerAdapter;
    return null;
  }
  const excelPickerAdapter = {
    getRect(useDetected) {
      const src = useDetected ? state.detected.detectedRange : eff().range;
      return decodeRangeSafe(src);
    },
    commit(sR, sC, eR, eC) {
      // Collapse to start-row + column-span, extend end-row to sheet's last row
      const ws = state.excelBookSample && state.excelBookSample.Sheets[eff().sheet];
      const ext = getSheetExtent(ws);
      const lastRow = ext ? Math.max(ext.e.r, sR) : sR;
      const range = XLSX.utils.encode_range({
        s: { r: sR, c: sC },
        e: { r: lastRow, c: eC },
      });
      state.user.range = range;
      const inp = $('h_range');
      if (inp) inp.value = range;
    },
  };
  const csvPickerAdapter = {
    getRect(useDetected) {
      const skip = useDetected ? (state.detected.skip ?? 0) : (eff().skip ?? 0);
      // Detected is shown over full width; user selection respects colRange if set
      const colRange = useDetected ? null : eff().colRange;
      const sC = colRange ? colRange.start : 0;
      const eC = colRange ? colRange.end   : 9999;
      return { s: { r: skip, c: sC }, e: { r: 9999, c: eC } };
    },
    commit(sR, sC, eR, eC) {
      // Start row
      if (state.detected.skip === sR) delete state.user.skip;
      else state.user.skip = sR;

      // Column range: store whatever was dragged. buildSourceSql() decides
      // whether the range covers all known columns and skips projection if so.
      state.user.colRange = { start: sC, end: eC };

      const skipInp = $('h_skip');
      if (skipInp) skipInp.value = sR;
    },
  };

  // -------- Shared highlight + gesture handling ---------------------------
  function rectContains(rect, r, c) {
    return rect && r >= rect.s.r && r <= rect.e.r && c >= rect.s.c && c <= rect.e.c;
  }

  function updateSelectionHighlight() {
    const adp = getPickerAdapter();
    if (!adp) return;
    const sel = adp.getRect(false);
    const det = adp.getRect(true);
    rangePickerEl.querySelectorAll('td.cell').forEach(td => {
      const r = +td.dataset.r, c = +td.dataset.c;
      td.classList.toggle('in-detected',  rectContains(det, r, c));
      td.classList.toggle('in-selection', rectContains(sel, r, c));
    });
    // CSV-only: dim rows above the selected start row to indicate they'll be skipped
    if (state.format === 'csv') {
      const skip = eff().skip ?? 0;
      rangePickerEl.querySelectorAll('tr[data-r]').forEach(tr => {
        tr.classList.toggle('row-skipped', +tr.dataset.r < skip);
      });
    }
  }

  // Use event delegation so we don't bind listeners to every cell (faster + no leaks).
  // The gesture is identical for every format; only commit semantics differ.
  function wireRangePicker() {
    ensureMouseUpBound();
    rangePickerEl.onmousedown = (e) => {
      const td = e.target.closest('td.cell');
      if (!td) return;
      rpDragStart = { r: +td.dataset.r, c: +td.dataset.c };
      rpDragCurrent = rpDragStart;
      e.preventDefault();
      applyRangeFromDrag(false);
    };
    rangePickerEl.onmousemove = (e) => {
      if (!rpDragStart) return;
      const td = e.target.closest('td.cell');
      if (!td) return;
      rpDragCurrent = { r: +td.dataset.r, c: +td.dataset.c };
      applyRangeFromDrag(false);
    };
  }

  function applyRangeFromDrag(commit) {
    const sR = Math.min(rpDragStart.r, rpDragCurrent.r);
    const sC = Math.min(rpDragStart.c, rpDragCurrent.c);
    const eR = Math.max(rpDragStart.r, rpDragCurrent.r);
    const eC = Math.max(rpDragStart.c, rpDragCurrent.c);

    if (commit) {
      const adp = getPickerAdapter();
      if (adp) adp.commit(sR, sC, eR, eC);
      rerenderBadges();
      renderRangePicker();   // full re-render so post-commit highlight + skipped rows are correct
      refreshPreview();
    } else {
      // Live drag: paint the literal rectangle directly. Doesn't touch state —
      // updateSelectionHighlight() will overwrite this on the next render anyway.
      rangePickerEl.querySelectorAll('td.cell').forEach(td => {
        const r = +td.dataset.r, c = +td.dataset.c;
        const inDrag = r >= sR && r <= eR && c >= sC && c <= eC;
        td.classList.toggle('in-selection', inDrag);
      });
    }
  }

  // -------- Column edits (rename / exclude) --------------------------------
  // Stored on state.user.columnEdits keyed by *original* column name so they
  // survive re-renders, column-order changes, etc.
  function getColumnEdit(name) {
    return (state.user.columnEdits && state.user.columnEdits[name]) || null;
  }
  function setColumnEdit(name, patch) {
    if (!state.user.columnEdits) state.user.columnEdits = {};
    const cur = state.user.columnEdits[name] || {};
    const next = Object.assign({}, cur, patch);
    // Drop empty rename strings; collapse fully-empty entries
    if (next.rename === '' || next.rename == null) delete next.rename;
    if (next.excluded === false) delete next.excluded;
    if (Object.keys(next).length === 0) {
      delete state.user.columnEdits[name];
      if (Object.keys(state.user.columnEdits).length === 0) delete state.user.columnEdits;
    } else {
      state.user.columnEdits[name] = next;
    }
  }
  function isColumnExcluded(name) {
    const e = getColumnEdit(name);
    return !!(e && e.excluded);
  }
  function effectiveColumnName(name) {
    const e = getColumnEdit(name);
    return (e && e.rename) ? e.rename : name;
  }
  function visibleColumns() {
    return state.schema.filter(c => !isColumnExcluded(c.name));
  }

  // ---------------------------------------------------------------- Preview & schema
  async function refreshPreview() {
    if (state.snapshotMode) return;  // no live file behind a static snapshot
    try {
      setStatus('Loading preview…');
      if (state.format === 'csv') await previewCSV();
      else if (state.format === 'parquet') await previewParquet();
      else if (state.format === 'json' || state.format === 'ndjson') await previewJSON();
      else if (state.format === 'xlsx') await previewExcel();
      else if (state.format === 'duckdb') await previewDuckdb();
      else if (state.format === 'sqlite') await previewSqlite();
      else if (state.format === 'markdown') await previewMarkdown();
      else if (state.format === 'paste') await previewPaste();
      pruneColumnEdits();
      renderPreviewStats();
      renderPreviewGrid();
      updateParquetHint();
      setStatus('');
    } catch (err) {
      console.error(err);
      // CSV sniffer or read failures: retry once with ignore_errors+null_padding
      // (tolerant mode now keeps types since strict_mode=false handles most
      // common quirks already).
      const msg = String(err.message || err);
      if (state.format === 'csv' && !state.user.tolerant
          && /sniffing|CSV Parsing dialect|Could not convert|null_padding|ignore_errors|Failed to bind.*read_csv/i.test(msg)) {
        state.user.tolerant = true;
        try {
          setStatus('Preview failed; retrying in tolerant mode…', 'warn');
          await previewCSV();
          pruneColumnEdits();
          renderPreviewStats();
          renderPreviewGrid();
          renderHeuristicPanel();
          setStatus('Loaded in tolerant mode — malformed rows skipped, short rows padded with NULL. Toggle off in Source format to disable.', 'warn');
          return;
        } catch (err2) {
          state.user.tolerant = false;
          renderHeuristicPanel();
          console.error(err2);
          setStatus('Preview failed (tolerant retry also failed): ' + (err2.message || String(err2)), 'error');
          return;
        }
      }
      setStatus('Preview failed: ' + msg, 'error');
    }
  }
  // Drop edit entries whose original column name no longer appears in the
  // current schema (e.g. after a CSV column-projection narrowing).
  function pruneColumnEdits() {
    const edits = state.user.columnEdits;
    if (!edits) return;
    const known = new Set(state.schema.map(c => c.name));
    let changed = false;
    for (const k of Object.keys(edits)) {
      if (!known.has(k)) { delete edits[k]; changed = true; }
    }
    if (changed && Object.keys(edits).length === 0) delete state.user.columnEdits;
  }

  function buildCsvOpts(e) {
    const opts = [];
    opts.push(`delim='${sqlEscape(e.delim || ',')}'`);
    if (e.quote != null) {
      opts.push(`quote='${sqlEscape(e.quote)}'`);
      // DuckDB defaults escape to backslash; for typical RFC-4180 CSVs the
      // escape char is the same as the quote ("" inside a quoted field).
      if (e.quote) opts.push(`escape='${sqlEscape(e.quote)}'`);
    }
    opts.push(`header=${e.header ? 'true' : 'false'}`);
    if (e.skip) opts.push(`skip=${Number(e.skip) || 0}`);
    if (e.nulls && e.nulls.length) {
      const ns = e.nulls.map(n => `'${sqlEscape(n)}'`).join(',');
      opts.push(`nullstr=[${ns}]`);
    }
    if (e.decimal === ',') opts.push(`decimal_separator=','`);
    if (e.encoding && e.encoding !== 'utf-8') {
      opts.push(`encoding='${sqlEscape(e.encoding)}'`);
    }
    if (e.dateformat) {
      opts.push(`dateformat='${sqlEscape(e.dateformat)}'`);
      opts.push(`timestampformat='${sqlEscape(e.dateformat)} %H:%M:%S'`);
    }
    // strict_mode=false is essentially "RFC 4180 with real-world tolerance".
    // It lets DuckDB read CSVs that have e.g. bare LF inside quoted multi-line
    // values (very common in exports of stack traces / log messages). Without
    // this the sniffer rejects them outright. Strict superset behaviour: any
    // file the strict sniffer accepts, this one accepts too.
    opts.push(`strict_mode=false`);
    opts.push(`auto_detect=true`);
    if (e.tolerant) {
      // Extra safety belt for files that still have rows DuckDB can't parse:
      // skip them and pad short rows. Types are still inferred normally.
      opts.push(`ignore_errors=true`);
      opts.push(`null_padding=true`);
    }
    return opts.join(', ');
  }




  // True when several same-structure files are combined into one table.
  function isMultiFile() { return state.duckFiles && state.duckFiles.length > 1; }
  // The path argument for read_csv/read_parquet/read_json: a single quoted path,
  // or a DuckDB list ['a','b',…] when multiple files are combined (UNION by position).
  function readPathArg() {
    if (isMultiFile()) return '[' + state.duckFiles.map(n => `'${sqlEscape(n)}'`).join(', ') + ']';
    return `'${sqlEscape(state.duckFile)}'`;
  }

  function buildSourceSql(forFullRead) {
    const e = eff();
    const f = readPathArg();
    let sql = null;
    if (state.format === 'csv') {
      sql = `SELECT * FROM read_csv(${f}, ${buildCsvOpts(e)})`;
    } else if (state.format === 'parquet') {
      sql = `SELECT * FROM read_parquet(${f})`;
    } else if (state.format === 'ndjson') {
      sql = `SELECT * FROM read_json(${f}, format='newline_delimited', auto_detect=true)`;
    } else if (state.format === 'json') {
      const mode = e.mode || 'array';
      if (mode === 'array') {
        sql = `SELECT * FROM read_json(${f}, format='array', auto_detect=true)`;
      } else {
        // nested: rebuilt from JS as a temporary ndjson stream at export time
        return null;
      }
    } else if (state.format === 'duckdb') {
      // Selected qualified table (alias.schema.name); already SQL-safe (we
      // built it from sqlIdent in detectDuckDB).
      sql = `SELECT * FROM ${e.table}`;
    } else if (state.format === 'sqlite') {
      // SQLite is read via sql.js and materialised to an in-memory CSV that
      // DuckDB queries (see materializeSqlite, called before export).
      sql = `SELECT * FROM read_csv('${sqlEscape(state.sqliteCsvName)}', delim=',', quote='"', header=true, auto_detect=true)`;
    } else if (state.format === 'markdown') {
      // Markdown is parsed in JS and materialised to an in-memory CSV that DuckDB
      // queries (see materializeMarkdownCsv, called before export / preview).
      sql = markdownSourceSql();
    } else if (state.format === 'paste') {
      // Pasted clipboard data is parsed in JS and materialised to an in-memory CSV.
      sql = pasteSourceSql();
    }
    if (!sql) return null;

    // CSV column projection — only after preview has populated full column
    // names, and only when colRange is a strict subset of the file's columns.
    if (state.format === 'csv' && e.colRange
        && state.csvFullColumnNames && state.csvFullColumnNames.length) {
      const cols  = state.csvFullColumnNames;
      const start = Math.max(0, e.colRange.start);
      const end   = Math.min(e.colRange.end, cols.length - 1);
      const isSubset = start <= end && !(start === 0 && end === cols.length - 1);
      if (isSubset) {
        const picked = cols.slice(start, end + 1)
          .map(n => `"${String(n).replace(/"/g, '""')}"`);
        sql = `SELECT ${picked.join(', ')} FROM (${sql})`;
      }
    }

    return sql;
  }

  // -------- WHERE filter ---------------------------------------------------
  function getExportFilter() {
    const el = $('ex_filter');
    if (!el) return '';
    return String(el.value || '').trim();
  }
  // Wrap any source SQL with a WHERE clause. References original (un-renamed)
  // column names, so call this BEFORE applyColumnEditsToSql.
  function applyFilterToSql(sourceSql) {
    if (!sourceSql) return sourceSql;
    const filter = getExportFilter();
    if (!filter) return sourceSql;
    return `SELECT * FROM (${sourceSql}) WHERE ${filter}`;
  }

  // SQL value formatter for the column-header filter quick-pick. Returns null
  // for values we can't safely express (and the caller falls back to IS NULL /
  // IS NOT NULL or skips the suggestion).
  function sqlIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }
  function sqlLiteral(v) {
    if (v == null) return null;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Date) {
      const iso = v.toISOString();
      // Use TIMESTAMP if there's a time component, DATE otherwise
      const t = iso.slice(11, 19);
      if (t === '00:00:00') return `DATE '${iso.slice(0, 10)}'`;
      return `TIMESTAMP '${iso.slice(0, 10)} ${t}'`;
    }
    if (typeof v === 'object') return null; // arrays/structs — too complex for quick filter
    const s = String(v);
    return `'${s.replace(/'/g, "''")}'`;
  }
  // Append a clause to the export filter textarea, AND-ing with any existing
  // expression. Auto-opens the source-format details aren't relevant here —
  // the export card is always visible.
  function appendFilterClause(clause) {
    const el = $('ex_filter');
    if (!el) return;
    const cur = String(el.value || '').trim();
    el.value = cur ? `${cur} AND ${clause}` : clause;
    // Visual nudge: focus + scroll to end
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }

  // Pick distinct preview values for a column, capped, with type info.
  function distinctPreviewValues(colName, max) {
    const seen = new Set();
    const items = [];
    let hasNull = false;
    for (const row of state.previewRows) {
      const v = row[colName];
      if (v == null) { hasNull = true; continue; }
      // Use a stable key for de-dup; include type because 1 != "1"
      const key = (typeof v) + ':' + (v instanceof Date ? v.toISOString() : String(v));
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(v);
      if (items.length >= max) break;
    }
    return { items, hasNull };
  }

  // Wrap any source SQL with a SELECT that drops excluded columns and aliases
  // renamed ones. Safe no-op when state.schema is empty or no edits are set.
  function applyColumnEditsToSql(sourceSql) {
    if (!sourceSql || !state.schema || !state.schema.length) return sourceSql;
    const edits = state.user.columnEdits;
    if (!edits || !Object.keys(edits).length) return sourceSql;
    const visible = state.schema.filter(c => !isColumnExcluded(c.name));
    if (!visible.length) {
      // Edge case: user excluded everything. Fall back to all visible (no-op).
      return sourceSql;
    }
    const cols = visible.map(c => {
      const orig = `"${String(c.name).replace(/"/g, '""')}"`;
      const eff  = effectiveColumnName(c.name);
      if (eff === c.name) return orig;
      const alias = `"${String(eff).replace(/"/g, '""')}"`;
      return `${orig} AS ${alias}`;
    });
    return `SELECT ${cols.join(', ')} FROM (${sourceSql})`;
  }

  // AOA equivalent for Excel-source export paths. The `aoa` is assumed to have
  // a header row at index 0 (we'll synthesise one if `aoaHeader` is provided
  // separately). Returns a new AOA with excluded columns dropped and renames
  // applied in the header row.
  function applyColumnEditsToAoa(aoa, hasHeaderRow) {
    if (!aoa.length || !state.schema || !state.schema.length) return aoa;
    const edits = state.user.columnEdits;
    if (!edits || !Object.keys(edits).length) return aoa;

    // Map state.schema index → keep flag + display name
    const cols = state.schema.map(c => ({
      orig: c.name,
      keep: !isColumnExcluded(c.name),
      eff:  effectiveColumnName(c.name),
    }));
    const keepIdx = cols.map((c, i) => c.keep ? i : -1).filter(i => i >= 0);
    if (!keepIdx.length) return aoa;

    const out = [];
    if (hasHeaderRow) {
      const newHeader = keepIdx.map(i => cols[i].eff);
      out.push(newHeader);
      for (let r = 1; r < aoa.length; r++) {
        out.push(keepIdx.map(i => aoa[r][i]));
      }
    } else {
      for (let r = 0; r < aoa.length; r++) {
        out.push(keepIdx.map(i => aoa[r][i]));
      }
    }
    return out;
  }

  async function previewCSV() {
    // Always run the unprojected query so we know the file's full column
    // names — needed by buildSourceSql() to project columns at export time.
    // Run against the in-heap slice if available (fast); fall back to the
    // full file if the slice doesn't yield results (e.g. the head was a
    // single huge line that couldn't be parsed in isolation).
    const e = eff();
    const sliceFile = state.duckPreviewFile;
    const fullFile  = state.duckFile;

    let res;
    if (isMultiFile()) {
      // Combined read over all files (no head-slice optimisation).
      res = await conn.query(`SELECT * FROM read_csv(${readPathArg()}, ${buildCsvOpts(e)}) LIMIT 10`);
    } else {
      let usedFile = sliceFile || fullFile;
      try {
        const sql = `SELECT * FROM read_csv('${sqlEscape(usedFile)}', ${buildCsvOpts(e)}) LIMIT 10`;
        res = await conn.query(sql);
      } catch (err) {
        if (sliceFile && usedFile === sliceFile) {
          // Slice failed — retry against the full file
          console.warn('Preview slice failed, retrying full file:', err.message);
          usedFile = fullFile;
          const sql = `SELECT * FROM read_csv('${sqlEscape(usedFile)}', ${buildCsvOpts(e)}) LIMIT 10`;
          res = await conn.query(sql);
        } else {
          throw err;
        }
      }
    }
    const fullSchema = arrowFields(res.schema);
    const fullRows   = arrowRows(res);
    state.csvFullColumnNames = fullSchema.map(f => f.name);

    // Apply column projection in JS for the preview view
    const r = e.colRange;
    const total = fullSchema.length;
    const isSubset = r && total > 0
                   && !(r.start === 0 && r.end >= total - 1);
    if (isSubset) {
      const start = Math.max(0, r.start);
      const end   = Math.min(r.end, total - 1);
      state.schema = fullSchema.slice(start, end + 1);
      state.previewRows = fullRows.map(row => {
        const o = {};
        for (let i = start; i <= end; i++) {
          const name = fullSchema[i].name;
          o[name] = row[name];
        }
        return o;
      });
    } else {
      state.schema = fullSchema;
      state.previewRows = fullRows;
    }

    state.rowCountEstimate = isMultiFile() ? await countCombined() : await estimateCsvRows();
  }
  // Exact row count over the combined multi-file source.
  async function countCombined() {
    try {
      const src = buildSourceSql(true);
      if (!src) return null;
      const r = await conn.query(`SELECT count(*) AS c FROM (${src})`);
      return { value: Number(r.toArray()[0].c), exact: true };
    } catch (_) { return null; }
  }
  async function previewParquet() {
    const f = readPathArg();
    const res = await conn.query(`SELECT * FROM read_parquet(${f}) LIMIT 10`);
    state.schema = arrowFields(res.schema);
    state.previewRows = arrowRows(res);
    // Exact row count from parquet metadata is fast
    try {
      const cnt = await conn.query(`SELECT count(*) AS c FROM read_parquet(${f})`);
      const c = cnt.toArray()[0].c;
      state.rowCountEstimate = { value: Number(c), exact: true };
    } catch (e) {
      state.rowCountEstimate = null;
    }
  }
  async function previewDuckdb() {
    const e = eff();
    const tbl = e.table;
    if (!tbl) { state.schema = []; state.previewRows = []; state.rowCountEstimate = null; return; }
    const res = await conn.query(`SELECT * FROM ${tbl} LIMIT 10`);
    state.schema = arrowFields(res.schema);
    state.previewRows = arrowRows(res);
    try {
      const cnt = await conn.query(`SELECT count(*) AS c FROM ${tbl}`);
      const c = cnt.toArray()[0].c;
      state.rowCountEstimate = { value: Number(c), exact: true };
    } catch (err) {
      state.rowCountEstimate = null;
    }
  }
  async function previewJSON() {
    const e = eff();
    if (state.format === 'ndjson' || e.mode === 'ndjson') {
      // NDJSON is line-oriented like CSV — we can preview from the slice
      const sliceFile = state.duckPreviewFile;
      const fullFile  = state.duckFile;
      let res;
      if (isMultiFile()) {
        res = await conn.query(`SELECT * FROM read_json(${readPathArg()}, format='newline_delimited', auto_detect=true) LIMIT 10`);
      } else {
        let usedFile = sliceFile || fullFile;
        try {
          res = await conn.query(`SELECT * FROM read_json('${sqlEscape(usedFile)}', format='newline_delimited', auto_detect=true) LIMIT 10`);
        } catch (err) {
          if (sliceFile && usedFile === sliceFile) {
            console.warn('NDJSON preview slice failed, retrying full file:', err.message);
            usedFile = fullFile;
            res = await conn.query(`SELECT * FROM read_json('${sqlEscape(usedFile)}', format='newline_delimited', auto_detect=true) LIMIT 10`);
          } else {
            throw err;
          }
        }
      }
      state.schema = arrowFields(res.schema);
      state.previewRows = arrowRows(res);
      state.rowCountEstimate = isMultiFile() ? await countCombined() : await estimateNdjsonRows();
    } else if (e.mode === 'array' || !e.mode) {
      // JSON arrays must be parsed as a whole — use the full file
      const f = sqlEscape(state.duckFile);
      const res = await conn.query(`SELECT * FROM read_json('${f}', format='array', auto_detect=true) LIMIT 10`);
      state.schema = arrowFields(res.schema);
      state.previewRows = arrowRows(res);
      state.rowCountEstimate = null;
    } else if (e.mode === 'nested') {
      // Parse the file in JS, navigate path, register a temporary NDJSON file
      const text = await readSlice(state.file, 0, state.fileSize);
      const root = JSON.parse(text);
      const arr = navigatePath(root, e.jsonPath || '');
      if (!Array.isArray(arr)) {
        throw new Error(`Path '${e.jsonPath}' did not resolve to an array`);
      }
      const ndjson = arr.map(o => JSON.stringify(o)).join('\n');
      const tmpName = `tmp_nested_${Date.now()}.ndjson`;
      const enc = new TextEncoder();
      await db.registerFileBuffer(tmpName, enc.encode(ndjson));
      const res = await conn.query(`SELECT * FROM read_json('${tmpName}', format='newline_delimited', auto_detect=true) LIMIT 10`);
      state.schema = arrowFields(res.schema);
      state.previewRows = arrowRows(res);
      state.rowCountEstimate = { value: arr.length, exact: true };
      // Keep the buffer around; export will re-register if needed
      state._nestedNdjsonName = tmpName;
    }
  }
  function navigatePath(obj, path) {
    if (!path || path === '$' || path === '') {
      // Try root if it's an array, else find longest array
      if (Array.isArray(obj)) return obj;
      return obj;
    }
    const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return null;
      // Support array index syntax key[0] (basic)
      const m = p.match(/^([^\[]+)(\[(\d+)\])?$/);
      if (m) {
        cur = cur[m[1]];
        if (m[3] != null && cur != null) cur = cur[Number(m[3])];
      } else {
        cur = cur[p];
      }
    }
    return cur;
  }

  async function previewExcel() {
    const e = eff();
    const ws = state.excelBookSample.Sheets[e.sheet];
    if (!ws) { state.schema = []; state.previewRows = []; return; }
    let range = e.range;
    let aoa;
    try {
      aoa = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        range: range || undefined,
        defval: null,
        raw: false,
        blankrows: false,
      });
    } catch (err) {
      state.schema = []; state.previewRows = [];
      throw new Error('Invalid range: ' + range);
    }
    if (!aoa.length) { state.schema = []; state.previewRows = []; return; }

    let header, dataRows;
    if (e.header) {
      header = aoa[0].map((h, i) => h != null && String(h).trim() !== '' ? String(h) : `col${i+1}`);
      dataRows = aoa.slice(1, 11);
    } else {
      header = aoa[0].map((_, i) => `col${i+1}`);
      dataRows = aoa.slice(0, 10);
    }
    // Infer types per column from up to 100 sampled rows
    const sampleRows = e.header ? aoa.slice(1) : aoa;
    state.schema = header.map((name, ci) => {
      const cls = inferColumnType(sampleRows, ci);
      return { name, type: cls.label, typeClass: cls.cls };
    });
    state.previewRows = dataRows.map(row => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
    state.excelHeader = header;
    state.excelData = sampleRows;
    // Row count: use the height of the selected range (which we already
    // extended to the sheet's true end). Subtract 1 for the header row if used.
    // Approximate because blankrows:false at preview/export time may drop some.
    const selRange = decodeRangeSafe(range);
    if (selRange) {
      const rowsInRange = selRange.e.r - selRange.s.r + 1;
      const dataRowCount = e.header ? Math.max(0, rowsInRange - 1) : rowsInRange;
      state.rowCountEstimate = { value: dataRowCount, exact: false };
    } else {
      state.rowCountEstimate = { value: sampleRows.length, exact: false };
    }
  }
  function inferColumnType(rows, colIdx) {
    let nNum = 0, nDate = 0, nBool = 0, nStr = 0, nNull = 0;
    let total = 0;
    for (let i = 0; i < rows.length && i < 100; i++) {
      const v = rows[i][colIdx];
      if (v == null || v === '') { nNull++; continue; }
      total++;
      if (typeof v === 'number') nNum++;
      else if (typeof v === 'boolean') nBool++;
      else if (v instanceof Date) nDate++;
      else if (typeof v === 'string') {
        if (/^-?\d+(\.\d+)?$/.test(v.replace(',', '.'))) nNum++;
        else if (!isNaN(Date.parse(v)) && /\d{4}/.test(v)) nDate++;
        else nStr++;
      } else nStr++;
    }
    if (!total) return { label: 'VARCHAR', cls: 't-string' };
    if (nDate / total > 0.7) return { label: 'TIMESTAMP', cls: 't-date' };
    if (nNum / total > 0.7) return { label: 'DOUBLE', cls: 't-number' };
    if (nBool / total > 0.7) return { label: 'BOOLEAN', cls: 't-bool' };
    return { label: 'VARCHAR', cls: 't-string' };
  }

  function arrowFields(schema) {
    return schema.fields.map(f => {
      const t = arrowFriendlyType(f.type);
      return { name: f.name, type: t, typeClass: typeClass(t) };
    });
  }
  // Arrow JS returns DuckDB DATE / TIMESTAMP / TIME values as raw numbers
  // (Date32: days, Date64: ms) or bigints (Timestamp: us / ns). Convert them
  // to JS Date so downstream code (preview render, JSON / Excel export) can
  // format them in a human-readable way.
  function coerceDateValue(v) {
    if (v == null || v instanceof Date) return v;
    let n;
    if (typeof v === 'bigint') n = Number(v);
    else if (typeof v === 'number') n = v;
    else return v;
    if (!Number.isFinite(n)) return v;
    const a = Math.abs(n);
    if (a < 1e6)  return new Date(n * 86400000);   // days since epoch (Date32)
    if (a < 1e13) return new Date(n);              // milliseconds (Date64)
    if (a < 1e16) return new Date(n / 1000);       // microseconds (Timestamp[us])
    return new Date(n / 1000000);                  // nanoseconds (Timestamp[ns])
  }
  function isDateLikeArrowType(arrowType) {
    if (!arrowType) return false;
    return /Date|Time|Timestamp/i.test(arrowType.toString());
  }
  // Format a JS Date according to the column type: DATE → 'YYYY-MM-DD',
  // TIME → 'HH:MM:SS', everything else (incl. TIMESTAMP) → 'YYYY-MM-DD HH:MM:SS'.
  function formatDateByType(d, colType) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return String(d);
    const T = String(colType || '').toUpperCase();
    const iso = d.toISOString();
    if (T === 'DATE') return iso.slice(0, 10);
    if (T === 'TIME') return iso.slice(11, 19);
    return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
  }

  function arrowRows(table) {
    // Pre-compute per-column coercion based on Arrow type
    const fields = table.schema.fields.map(f => ({
      name: f.name,
      coerce: isDateLikeArrowType(f.type) ? coerceDateValue : (v) => v,
    }));
    const arr = table.toArray();
    return arr.map(r => {
      const obj = {};
      for (const f of fields) obj[f.name] = f.coerce(r[f.name]);
      return obj;
    });
  }

  async function estimateCsvRows() {
    if (!state.fileSize) return null;
    // Sample first 256KB to estimate avg line length
    const sampleBytes = Math.min(state.fileSize, 256 * 1024);
    const sample = await readSlice(state.file, 0, sampleBytes);
    const lineCount = (sample.match(/\n/g) || []).length;
    if (lineCount === 0) return null;
    const avgBytesPerLine = sampleBytes / lineCount;
    const skip = Number(eff().skip) || 0;
    const headerOffset = eff().header ? 1 : 0;
    const est = Math.max(0, Math.round(state.fileSize / avgBytesPerLine) - skip - headerOffset);
    return { value: est, exact: state.fileSize === sampleBytes };
  }
  async function estimateNdjsonRows() {
    return estimateCsvRows();
  }

  // ---------------------------------------------------------------- Render preview / schema
  // ---------------------------------------------------------------- Schema copy
  // Build {name, type} pairs for the export-effective schema: applies
  // exclusions and renames so what the user copies matches what they'd export.
  function effectiveSchemaPairs() {
    return visibleColumns().map(c => ({
      original: c.name,
      name: effectiveColumnName(c.name),
      type: c.type,
    }));
  }
  function suggestedTableName() {
    const base = (state.file && state.file.name || 'data').replace(/\.[^.]+$/, '');
    return base.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'data';
  }
  function formatSchemaAsDDL(pairs) {
    const tbl = sqlIdent(suggestedTableName());
    const cols = pairs.map(p => `  ${sqlIdent(p.name)} ${p.type}`).join(',\n');
    return `CREATE TABLE ${tbl} (\n${cols}\n);`;
  }
  function formatSchemaAsMarkdown(pairs) {
    const lines = ['| Column | Type |', '|---|---|'];
    for (const p of pairs) lines.push(`| ${p.name} | ${p.type} |`);
    return lines.join('\n');
  }
  function formatSchemaAsTSV(pairs) {
    return ['Column\tType', ...pairs.map(p => `${p.name}\t${p.type}`)].join('\n');
  }
  function formatSchemaAsJSON(pairs) {
    return JSON.stringify(pairs.map(p => ({ name: p.name, type: p.type })), null, 2);
  }
  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    }
    // Fallback for older browsers / non-https contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.pointerEvents = 'none';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }

  let openSchemaPop = null;
  function closeSchemaPopover() {
    if (openSchemaPop && openSchemaPop.parentNode) openSchemaPop.parentNode.removeChild(openSchemaPop);
    openSchemaPop = null;
    document.removeEventListener('click', onDocClickCloseSchemaPop, true);
    document.removeEventListener('keydown', onEscCloseSchemaPop, true);
    window.removeEventListener('scroll', closeSchemaPopover, true);
    window.removeEventListener('resize', closeSchemaPopover);
  }
  function onDocClickCloseSchemaPop(e) {
    if (openSchemaPop && !openSchemaPop.contains(e.target)) closeSchemaPopover();
  }
  function onEscCloseSchemaPop(e) {
    if (e.key === 'Escape') closeSchemaPopover();
  }
  function openSchemaCopyPopover(anchorEl) {
    if (openSchemaPop) { closeSchemaPopover(); return; }
    if (!state.schema || !state.schema.length) {
      setStatus('No schema available yet.', 'warn');
      return;
    }
    const pairs = effectiveSchemaPairs();
    if (!pairs.length) {
      setStatus('All columns are excluded — nothing to copy.', 'warn');
      return;
    }

    const pop = document.createElement('div');
    pop.className = 'schema-copy-pop';

    const title = document.createElement('div');
    title.className = 'schema-copy-pop-title';
    title.textContent = `Copy schema · ${pairs.length} column${pairs.length === 1 ? '' : 's'}`;
    pop.appendChild(title);

    const opts = [
      { label: 'CREATE TABLE', hint: 'DDL with DuckDB types',  fn: () => formatSchemaAsDDL(pairs) },
      { label: 'Markdown',     hint: 'Table for docs / chat',  fn: () => formatSchemaAsMarkdown(pairs) },
      { label: 'TSV',          hint: 'name⇥type · for sheets', fn: () => formatSchemaAsTSV(pairs) },
      { label: 'JSON',         hint: '[{name, type}, …]',      fn: () => formatSchemaAsJSON(pairs) },
    ];
    for (const o of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'schema-copy-pop-item';
      b.innerHTML = `${escapeHtml(o.label)}<span class="pop-hint">${escapeHtml(o.hint)}</span>`;
      b.addEventListener('click', async () => {
        const text = o.fn();
        const ok = await copyTextToClipboard(text);
        closeSchemaPopover();
        if (ok) {
          // Brief visual confirmation on the icon + status line
          anchorEl.classList.add('is-success');
          setStatus(`${o.label} schema copied to clipboard (${pairs.length} column${pairs.length === 1 ? '' : 's'}).`, 'success');
          setTimeout(() => anchorEl.classList.remove('is-success'), 1200);
        } else {
          setStatus('Copy failed — clipboard not available in this context.', 'error');
        }
      });
      pop.appendChild(b);
    }

    openSchemaPop = pop;
    document.body.appendChild(pop);

    const rect = anchorEl.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let left = rect.right - popRect.width;       // right-align with the icon
    if (left < 8) left = 8;
    if (left + popRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popRect.width - 8);
    }
    pop.style.left = left + 'px';
    pop.style.top  = (rect.bottom + 4) + 'px';

    setTimeout(() => {
      document.addEventListener('click', onDocClickCloseSchemaPop, true);
      document.addEventListener('keydown', onEscCloseSchemaPop, true);
      window.addEventListener('scroll', closeSchemaPopover, true);
      window.addEventListener('resize', closeSchemaPopover);
    }, 0);
  }

  function renderPreviewStats() {
    const total   = state.schema.length;
    const visible = visibleColumns().length;
    const colsHtml = visible === total
      ? String(total)
      : `${visible} <span class="approx">of ${total}</span>`;
    previewStats.innerHTML = `
      <div class="preview-stat">
        <div class="preview-stat-label">Columns</div>
        <div class="preview-stat-value">${colsHtml}</div>
      </div>
      <div class="preview-stat">
        <div class="preview-stat-label">Rows</div>
        <div class="preview-stat-value">${
          state.rowCountEstimate ?
            (state.rowCountEstimate.exact ? '' : '<span class="approx">≈</span> ') +
            state.rowCountEstimate.value.toLocaleString()
          : '<span class="approx">unknown</span>'
        }</div>
      </div>`;
  }

  // Filter popover — single instance, anchored to the active th. Closes on
  // outside click, Esc, or another open call.
  let openFilterPop = null;
  function closeFilterPopover() {
    if (openFilterPop && openFilterPop.parentNode) {
      openFilterPop.parentNode.removeChild(openFilterPop);
    }
    openFilterPop = null;
    document.removeEventListener('click', onDocClickClosePop, true);
    document.removeEventListener('keydown', onEscClosePop, true);
    window.removeEventListener('scroll', closeFilterPopover, true);
    window.removeEventListener('resize', closeFilterPopover);
  }
  function onDocClickClosePop(e) {
    if (openFilterPop && !openFilterPop.contains(e.target)) closeFilterPopover();
  }
  function onEscClosePop(e) {
    if (e.key === 'Escape') closeFilterPopover();
  }
  function toggleFilterPopover(th, col, anchorEl) {
    // If we're re-clicking the same column's funnel, just close
    if (openFilterPop && openFilterPop._col === col.name) {
      closeFilterPopover();
      return;
    }
    closeFilterPopover();

    const pop = document.createElement('div');
    pop.className = 'col-filter-pop';
    pop._col = col.name;

    const title = document.createElement('div');
    title.className = 'col-filter-pop-title';
    title.textContent = `Filter by ${col.name}`;
    pop.appendChild(title);

    // Build filter suggestion buttons
    const { items, hasNull } = distinctPreviewValues(col.name, 12);
    const ident = sqlIdent(col.name);  // ALWAYS uses the original column name

    const addItem = (label, clause, extraClass) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'col-filter-pop-item' + (extraClass ? ' ' + extraClass : '');
      b.innerHTML = label;
      b.title = clause;
      b.addEventListener('click', () => {
        appendFilterClause(clause);
        closeFilterPopover();
      });
      pop.appendChild(b);
    };

    if (!items.length && !hasNull) {
      const empty = document.createElement('div');
      empty.className = 'col-filter-pop-empty';
      empty.textContent = 'No values in preview to suggest';
      pop.appendChild(empty);
    } else {
      for (const v of items) {
        const lit = sqlLiteral(v);
        if (lit == null) continue;  // skip un-formattable
        const display = (v instanceof Date) ? formatDateByType(v, col.type)
                       : (typeof v === 'string') ? v
                       : String(v);
        const safe = escapeHtml(display.length > 40 ? display.slice(0, 40) + '…' : display);
        addItem(`<span class="pop-op">=</span>${safe}`, `${ident} = ${lit}`);
      }
      if (hasNull) {
        addItem(`<span class="pop-op">IS</span>null`, `${ident} IS NULL`, 'pop-null');
        addItem(`<span class="pop-op">IS NOT</span>null`, `${ident} IS NOT NULL`, 'pop-null');
      }
    }

    openFilterPop = pop;

    // Attach to body so the wrap's overflow doesn't clip us
    document.body.appendChild(pop);
    const rect = anchorEl.getBoundingClientRect();
    // Place below the funnel; nudge left if it would overflow viewport
    const popRect = pop.getBoundingClientRect();
    let left = rect.left;
    if (left + popRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - popRect.width - 8);
    }
    pop.style.left = left + 'px';
    pop.style.top  = (rect.bottom + 4) + 'px';

    // Defer listener install so the originating click doesn't immediately close us
    setTimeout(() => {
      document.addEventListener('click', onDocClickClosePop, true);
      document.addEventListener('keydown', onEscClosePop, true);
      window.addEventListener('scroll', closeFilterPopover, true);
      window.addEventListener('resize', closeFilterPopover);
    }, 0);
  }

  function renderPreviewGrid() {
    closeFilterPopover();
    const thead = previewGrid.querySelector('thead');
    const tbody = previewGrid.querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (!state.schema.length) {
      thead.innerHTML = '<tr><th>—</th></tr>';
      tbody.innerHTML = '<tr><td class="muted">No data to preview</td></tr>';
      return;
    }
    const headRow = document.createElement('tr');
    state.schema.forEach(col => {
      const th = document.createElement('th');
      const excluded = isColumnExcluded(col.name);
      const renamed  = effectiveColumnName(col.name);
      const isRen    = renamed !== col.name;
      if (excluded) th.classList.add('col-excluded');

      const row = document.createElement('div');
      row.className = 'col-head-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'col-name' + (isRen ? ' is-renamed' : '');
      nameSpan.textContent = renamed;
      nameSpan.title = isRen
        ? `Renamed from "${col.name}" — click to edit, blank to reset`
        : 'Click to rename';
      if (!excluded) {
        nameSpan.contentEditable = 'true';
        nameSpan.spellcheck = false;
        nameSpan.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); nameSpan.blur(); }
          if (ev.key === 'Escape') {
            ev.preventDefault();
            nameSpan.textContent = renamed;
            nameSpan.blur();
          }
        });
        nameSpan.addEventListener('blur', () => {
          const v = nameSpan.textContent.trim();
          // Empty or matches original → drop the rename
          const newRename = (v === '' || v === col.name) ? undefined : v;
          const cur = getColumnEdit(col.name);
          const wasRename = cur && cur.rename;
          if (newRename === wasRename) return;
          setColumnEdit(col.name, { rename: newRename });
          renderPreviewGrid();
        });
      }
      row.appendChild(nameSpan);

      const btn = document.createElement('button');
      btn.className = 'col-toggle';
      btn.type = 'button';
      btn.innerHTML = excluded ? '↺' : '×';
      btn.title = excluded ? 'Include column in export' : 'Exclude column from export';
      btn.addEventListener('click', () => {
        setColumnEdit(col.name, { excluded: !excluded });
        renderPreviewGrid();
        renderPreviewStats();
      });

      // Filter funnel — opens a popover of distinct preview values
      const filterBtn = document.createElement('button');
      filterBtn.className = 'col-toggle';
      filterBtn.type = 'button';
      filterBtn.title = 'Add a filter for this column';
      // Compact funnel icon
      filterBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1 2.5A.5.5 0 0 1 1.5 2h13a.5.5 0 0 1 .39.81l-5.39 6.74V14a.5.5 0 0 1-.71.45l-2-1A.5.5 0 0 1 6.5 13V9.55L1.11 2.81A.5.5 0 0 1 1 2.5z"/></svg>';
      filterBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        toggleFilterPopover(th, col, filterBtn);
      });
      row.appendChild(filterBtn);
      row.appendChild(btn);

      th.appendChild(row);
      const typeSpan = document.createElement('span');
      typeSpan.className = 'col-type';
      typeSpan.innerHTML = `<span class="type-badge ${col.typeClass}">${escapeHtml(col.type)}</span>`;
      th.appendChild(typeSpan);

      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    state.previewRows.forEach(row => {
      const tr = document.createElement('tr');
      state.schema.forEach(col => {
        const td = document.createElement('td');
        if (isColumnExcluded(col.name)) td.classList.add('col-excluded');
        const v = row[col.name];
        if (v == null) {
          td.innerHTML = '<span class="null-val">null</span>';
        } else if (typeof v === 'object' && !(v instanceof Date)) {
          let txt;
          try { txt = JSON.stringify(v); } catch (e) { txt = String(v); }
          td.textContent = txt;
          td.title = txt;
        } else {
          let s;
          if (v instanceof Date) {
            s = formatDateByType(v, col.type);
          } else if (typeof v === 'bigint') {
            s = v.toString();
          } else {
            s = String(v);
          }
          td.textContent = s;
          td.title = s;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // ---------------------------------------------------------------- SQL editor
  // Full Excel/ODS/Numbers sheet → in-memory CSV registered with DuckDB, so SQL
  // (and the `data` view) can query the entire sheet, not just the preview sample.
  async function materializeExcelCsv() {
    if (!db) await initDuckDB();
    const buf = await readAll(state.file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const e = eff();
    const ws = wb.Sheets[e.sheet];
    if (!ws) throw new Error('Sheet not found: ' + e.sheet);
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: e.range || undefined, defval: null, blankrows: false });
    let header, dataRows;
    if (e.header) {
      header = aoa.length ? aoa[0].map((h, i) => (h != null && String(h).trim() !== '') ? String(h) : `col${i+1}`) : [];
      dataRows = aoa.slice(1);
    } else {
      header = aoa.length ? aoa[0].map((_, i) => `col${i+1}`) : [];
      dataRows = aoa;
    }
    const lines = [header.map(csvEscape).join(',')];
    for (const r of dataRows) lines.push(header.map((_, i) => csvEscape(r[i])).join(','));
    if (state.excelCsvName) { try { await db.dropFile(state.excelCsvName); } catch (_) {} }
    const name = `xlsx_sql_${Date.now()}.csv`;
    await db.registerFileBuffer(name, new TextEncoder().encode(lines.join('\n')));
    state.excelCsvName = name;
    return `SELECT * FROM read_csv('${sqlEscape(name)}', delim=',', quote='"', header=true, auto_detect=true)`;
  }

  function sqlSourceSig() {
    return JSON.stringify({ f: state.format, df: state.duckFile, fs: state.duckFiles, e: eff() });
  }
  // (Re)bind the current source to a view named `data` for the SQL editor.
  async function ensureDataView() {
    await initDuckDB();
    const sig = sqlSourceSig();
    if (sig === state.sqlDataViewSig) {
      try { await conn.query('SELECT 1 FROM data LIMIT 0'); return; } catch (_) { /* fall through, rebuild */ }
    }
    let src;
    if (state.format === 'xlsx')          src = await materializeExcelCsv();
    else if (state.format === 'sqlite')   { await materializeSqlite();     src = buildSourceSql(true); }
    else if (state.format === 'markdown') { await materializeMarkdownCsv(); src = buildSourceSql(true); }
    else if (state.format === 'paste')    { await materializePasteCsv();    src = buildSourceSql(true); }
    else                                  src = buildSourceSql(true);
    if (!src) throw new Error('SQL is not available for this source — export it to Parquet or CSV first, then open that file.');
    await conn.query(`CREATE OR REPLACE VIEW data AS ${src}`);
    state.sqlDataViewSig = sig;
  }

  const SQL_MAX_DISPLAY_ROWS = 2000;
  function fmtDuration(ms) {
    if (ms < 1) return '<1 ms';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  }
  function sqlCellHtml(v) {
    if (v == null) return '<span class="null-val">null</span>';
    if (typeof v === 'object' && !(v instanceof Date)) {
      let txt; try { txt = JSON.stringify(v); } catch (_) { txt = String(v); }
      return escapeHtml(txt);
    }
    let s;
    if (v instanceof Date) s = v.toISOString().replace('T', ' ').replace('Z', '');
    else if (typeof v === 'bigint') s = v.toString();
    else s = String(v);
    return escapeHtml(s);
  }
  function renderSqlResult(res) {
    const fields = res.schema.fields.map(f => f.name);
    const rows = res.toArray();
    const shown = Math.min(rows.length, SQL_MAX_DISPLAY_ROWS);
    let html = '<table class="preview-grid"><thead><tr>';
    if (!fields.length) html += '<th>—</th>';
    for (const f of fields) html += `<th>${escapeHtml(f)}</th>`;
    html += '</tr></thead><tbody>';
    if (!rows.length) {
      html += `<tr><td class="muted" colspan="${Math.max(1, fields.length)}">No rows</td></tr>`;
    }
    for (let i = 0; i < shown; i++) {
      const r = rows[i];
      html += '<tr>';
      for (const f of fields) html += `<td>${sqlCellHtml(r[f])}</td>`;
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (rows.length > shown) {
      html += `<div class="sql-result-trunc">Showing the first ${shown.toLocaleString()} rows. Refine with a tighter WHERE / LIMIT, or use the Export card for the full result.</div>`;
    }
    sqlResult.innerHTML = html;
    sqlResultWrap.hidden = false;
  }

  let _sqlRunning = false;
  async function runSqlEditor() {
    if (_sqlRunning) return;
    const raw = (sqlEditor.value || '').trim().replace(/;\s*$/, '');
    if (!raw) { sqlEditor.focus(); return; }
    _sqlRunning = true;
    sqlRunBtn.disabled = true;
    sqlStatus.className = 'sql-status';
    sqlStatus.textContent = 'Running…';
    const t0 = performance.now();
    try {
      await ensureDataView();
      // Wrap as a subquery: restricts the editor to read queries and caps the
      // rows materialised into the browser for display.
      const wrapped = `SELECT * FROM (\n${raw}\n) AS _q LIMIT ${SQL_MAX_DISPLAY_ROWS + 1}`;
      const res = await conn.query(wrapped);
      const elapsed = performance.now() - t0;
      renderSqlResult(res);
      const n = res.toArray().length;
      const rows = n > SQL_MAX_DISPLAY_ROWS
        ? `${SQL_MAX_DISPLAY_ROWS.toLocaleString()}+ rows`
        : `${n.toLocaleString()} row${n === 1 ? '' : 's'}`;
      sqlStatus.className = 'sql-status is-ok';
      sqlStatus.textContent = `${rows} · ${fmtDuration(elapsed)}`;
    } catch (err) {
      console.error(err);
      sqlResult.innerHTML = `<div class="sql-error">${escapeHtml(err && err.message ? err.message : String(err))}</div>`;
      sqlResultWrap.hidden = false;
      sqlStatus.className = 'sql-status is-error';
      sqlStatus.textContent = `Error · ${fmtDuration(performance.now() - t0)}`;
    } finally {
      _sqlRunning = false;
      sqlRunBtn.disabled = false;
    }
  }

  // Suggest converting to Parquet when the source is large and row-oriented:
  // each SQL run re-scans CSV/JSON/Excel, whereas Parquet/DuckDB are columnar
  // and pruned, so repeated analysis is dramatically faster.
  function updateParquetHint() {
    if (!sqlParquetHint) return;
    const optimized = state.format === 'parquet' || state.format === 'duckdb';
    const LARGE_BYTES = 25 * 1024 * 1024;
    const big = (state.fileSize || 0) > LARGE_BYTES
      || (state.duckFiles && state.duckFiles.length > 1)
      || (state.rowCountEstimate && state.rowCountEstimate.value > 1000000);
    sqlParquetHint.hidden = optimized || !big;
  }
  function resetSqlEditor() {
    state.sqlDataViewSig = null;
    if (db && conn) { try { conn.query('DROP VIEW IF EXISTS data'); } catch (_) {} }
    if (sqlResult) sqlResult.innerHTML = '';
    if (sqlResultWrap) sqlResultWrap.hidden = true;
    if (sqlStatus) { sqlStatus.textContent = ''; sqlStatus.className = 'sql-status'; }
  }

  // ---------------------------------------------------------------- Export
  function renderExportOptions() {
    const fmt = targetFormat.value;
    let html = '';
    if (fmt === 'csv') {
      html += `<div class="qrx-form-group">
        <label class="qrx-label" for="ex_delim">Delimiter</label>
        <select class="qrx-select" id="ex_delim">
          <option value=",">, (comma)</option>
          <option value=";">; (semicolon)</option>
          <option value="\t">\\t (tab)</option>
          <option value="|">| (pipe)</option>
        </select>
      </div>
      <div class="qrx-form-group">
        <label class="qrx-label" for="ex_compression">Compression</label>
        <select class="qrx-select" id="ex_compression">
          <option value="none">None</option>
          <option value="gzip">gzip</option>
        </select>
      </div>
      <div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="ex_header" checked>
        <span class="qrx-label" style="margin: 0;">Write header</span>
      </label></div>`;
    } else if (fmt === 'parquet') {
      html += `<div class="qrx-form-group">
        <label class="qrx-label" for="ex_compression">Compression</label>
        <select class="qrx-select" id="ex_compression">
          <option value="snappy" selected>snappy</option>
          <option value="zstd">zstd</option>
          <option value="gzip">gzip</option>
          <option value="uncompressed">uncompressed</option>
        </select>
      </div>
      <div class="qrx-form-group">
        <label class="qrx-label" for="ex_rowgroup">Row group size</label>
        <input class="qrx-input" id="ex_rowgroup" type="number" value="100000" min="1024">
      </div>`;
    } else if (fmt === 'json') {
      html += `<div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="ex_pretty">
        <span class="qrx-label" style="margin: 0;">Pretty-print</span>
      </label></div>
      <p class="empty-note">Output is a single JSON array.</p>`;
    } else if (fmt === 'ndjson') {
      html += `<p class="empty-note">No options — one JSON object per line.</p>`;
    } else if (fmt === 'markdown') {
      html += `<p class="empty-note">No options — GitHub-flavored pipe table (max ${MD_EXPORT_ROW_LIMIT.toLocaleString('en-US')} rows).</p>`;
    } else if (fmt === 'html') {
      html += `<p class="empty-note">No options — a standalone HTML document with one table (max ${HTML_EXPORT_ROW_LIMIT.toLocaleString('en-US')} rows).</p>`;
    } else if (fmt === 'xlsx' || fmt === 'ods') {
      html += `<div class="qrx-form-group">
        <label class="qrx-label" for="ex_sheet">Sheet name</label>
        <input class="qrx-input" id="ex_sheet" type="text" value="Sheet1">
      </div>
      <div class="qrx-form-group"><label class="checkbox-row">
        <input type="checkbox" id="ex_header" checked>
        <span class="qrx-label" style="margin: 0;">Write header</span>
      </label></div>`;
    }
    exportOptions.innerHTML = html;
  }
  targetFormat.addEventListener('change', renderExportOptions);

  exportBtn.addEventListener('click', async () => {
    if (state.snapshotMode) return;  // export needs the live source file
    const fmt = targetFormat.value;
    exportBtn.disabled = true;
    exportProgress.textContent = 'Reading source…';
    setStatus('Exporting to ' + fmt + '…');
    try {
      // Excel source must be funneled through DuckDB for non-xlsx targets,
      // OR handled directly with SheetJS for xlsx target.
      const spreadsheet = (fmt === 'xlsx' || fmt === 'ods');  // SheetJS-written targets
      if (state.format === 'sqlite') {
        // Materialise the chosen table to a CSV DuckDB can read, then export
        // through the normal SQL path (gives filter / rename / exclude for free).
        await materializeSqlite();
        if (spreadsheet) await exportSqlToExcel(fmt);
        else await exportSqlToFile(fmt);
      } else if (state.format === 'markdown') {
        // Re-materialise the selected table (CSV) so the normal SQL path applies.
        await materializeMarkdownCsv();
        if (spreadsheet) await exportSqlToExcel(fmt);
        else await exportSqlToFile(fmt);
      } else if (state.format === 'paste') {
        // Re-materialise the pasted table (CSV) so the normal SQL path applies.
        await materializePasteCsv();
        if (spreadsheet) await exportSqlToExcel(fmt);
        else await exportSqlToFile(fmt);
      } else if (state.format === 'xlsx' && spreadsheet) {
        await exportExcelToExcel(fmt);
      } else if (state.format === 'xlsx') {
        await exportExcelToOther(fmt);
      } else if (spreadsheet) {
        await exportSqlToExcel(fmt);
      } else {
        await exportSqlToFile(fmt);
      }
      exportProgress.textContent = 'Done.';
      setStatus('');
    } catch (err) {
      console.error(err);
      exportProgress.textContent = 'Failed: ' + (err.message || String(err));
      setStatus('Export failed: ' + (err.message || String(err)), 'error');
    } finally {
      exportBtn.disabled = false;
      setTimeout(() => { exportProgress.textContent = ''; }, 5000);
    }
  });

  function makeOutName(ext) {
    const base = (state.file.name.replace(/\.[^.]+$/, '') || 'output');
    return `${base}.converted.${ext}`;
  }

  // DuckDB-WASM 1.28.0's autoloader can't fetch the json extension on this
  // build, so COPY ... (FORMAT JSON) is unavailable. We serialize JSON output
  // in JS instead — the same query result already contains everything we need.
  async function exportJsonViaJs(sourceSql, fmt) {
    exportProgress.textContent = 'Reading data into memory…';
    const result = await conn.query(sourceSql);
    const fieldInfo = result.schema.fields.map(f => ({
      name: f.name,
      isDate: isDateLikeArrowType(f.type),
      arrowType: f.type,
    }));
    const fields = fieldInfo.map(f => f.name);
    const rows = result.toArray();
    const pretty = !!($('ex_pretty') && $('ex_pretty').checked);

    // Normalise values (BigInt → Number, Date → ISO, Arrow nested → plain).
    // Date-typed columns get coerced from raw numerics first.
    const norm = (v) => {
      if (v == null) return null;
      if (typeof v === 'bigint') {
        return (v >= -9007199254740992n && v <= 9007199254740992n) ? Number(v) : v.toString();
      }
      if (v instanceof Date) return v.toISOString();
      if (Array.isArray(v)) return v.map(norm);
      if (typeof v === 'object') {
        const o = {};
        for (const k of Object.keys(v)) o[k] = norm(v[k]);
        return o;
      }
      return v;
    };
    const cellOf = (r, f) => {
      let v = r[f.name];
      if (f.isDate) v = coerceDateValue(v);   // numeric → Date, then norm() → ISO
      return norm(v);
    };

    exportProgress.textContent = 'Serializing…';
    let text;
    if (fmt === 'ndjson') {
      const parts = [];
      for (const r of rows) {
        const o = {};
        for (const f of fieldInfo) o[f.name] = cellOf(r, f);
        parts.push(JSON.stringify(o));
      }
      text = parts.join('\n');
      if (text.length) text += '\n';
    } else {
      const arr = [];
      for (const r of rows) {
        const o = {};
        for (const f of fieldInfo) o[f.name] = cellOf(r, f);
        arr.push(o);
      }
      text = JSON.stringify(arr, null, pretty ? 2 : 0);
    }
    const buf = new TextEncoder().encode(text);
    const ext = fmt === 'ndjson' ? 'ndjson' : 'json';
    triggerDownload(buf, makeOutName(ext), mimeFor(fmt));
  }

  // Markdown has no DuckDB writer; serialize a GitHub-flavored pipe table in JS.
  // Capped at MD_EXPORT_ROW_LIMIT rows (Markdown is impractical for huge tables).
  const MD_EXPORT_ROW_LIMIT = 50000;
  async function exportMarkdownViaJs(sourceSql) {
    exportProgress.textContent = 'Reading data into memory…';
    const result = await conn.query(`SELECT * FROM (${sourceSql}) LIMIT ${MD_EXPORT_ROW_LIMIT + 1}`);
    const fields = result.schema.fields.map(f => f.name);
    const allRows = result.toArray();
    const truncated = allRows.length > MD_EXPORT_ROW_LIMIT;
    const rows = truncated ? allRows.slice(0, MD_EXPORT_ROW_LIMIT) : allRows;

    const cell = (v) => {
      if (v == null) return '';
      let s = (v instanceof Date) ? v.toISOString()
            : (typeof v === 'bigint') ? v.toString()
            : (typeof v === 'object') ? JSON.stringify(v) : String(v);
      // Escape backslashes and pipes, collapse newlines (cells can't span lines).
      return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    };

    exportProgress.textContent = 'Serializing…';
    const head = '| ' + fields.map(cell).join(' | ') + ' |';
    const sep  = '| ' + fields.map(() => '---').join(' | ') + ' |';
    const lines = [head, sep];
    for (const r of rows) lines.push('| ' + fields.map(f => cell(r[f])).join(' | ') + ' |');
    let text = lines.join('\n') + '\n';
    if (truncated) {
      text += `\n> Note: output truncated to ${MD_EXPORT_ROW_LIMIT.toLocaleString('en-US')} rows.\n`;
    }
    const buf = new TextEncoder().encode(text);
    triggerDownload(buf, makeOutName('md'), mimeFor('markdown'));
  }

  // HTML: serialize a standalone document with a single <table> in JS.
  // Capped at HTML_EXPORT_ROW_LIMIT rows (HTML tables are impractical for huge data).
  const HTML_EXPORT_ROW_LIMIT = 100000;
  async function exportHtmlViaJs(sourceSql) {
    exportProgress.textContent = 'Reading data into memory…';
    const result = await conn.query(`SELECT * FROM (${sourceSql}) LIMIT ${HTML_EXPORT_ROW_LIMIT + 1}`);
    const fields = result.schema.fields.map(f => f.name);
    const allRows = result.toArray();
    const truncated = allRows.length > HTML_EXPORT_ROW_LIMIT;
    const rows = truncated ? allRows.slice(0, HTML_EXPORT_ROW_LIMIT) : allRows;

    const esc = (v) => {
      if (v == null) return '';
      let s = (v instanceof Date) ? v.toISOString()
            : (typeof v === 'bigint') ? v.toString()
            : (typeof v === 'object') ? JSON.stringify(v) : String(v);
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    exportProgress.textContent = 'Serializing…';
    const title = esc((state.file && state.file.name) || 'table');
    const parts = [];
    parts.push('<!DOCTYPE html>');
    parts.push('<html lang="en"><head><meta charset="UTF-8">');
    parts.push(`<title>${title}</title>`);
    parts.push('<style>table{border-collapse:collapse;font-family:sans-serif;font-size:14px}'
             + 'th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}'
             + 'th{background:#f2f2f2}</style>');
    parts.push('</head><body>');
    parts.push('<table>');
    parts.push('<thead><tr>' + fields.map(f => `<th>${esc(f)}</th>`).join('') + '</tr></thead>');
    parts.push('<tbody>');
    for (const r of rows) parts.push('<tr>' + fields.map(f => `<td>${esc(r[f])}</td>`).join('') + '</tr>');
    parts.push('</tbody></table>');
    if (truncated) parts.push(`<p>Note: output truncated to ${HTML_EXPORT_ROW_LIMIT.toLocaleString('en-US')} rows.</p>`);
    parts.push('</body></html>');
    const buf = new TextEncoder().encode(parts.join('\n'));
    triggerDownload(buf, makeOutName('html'), mimeFor('html'));
  }

  async function exportSqlToFile(fmt) {
    // Build source SQL from current heuristic (full file, no LIMIT)
    let sourceSql = buildSourceSql(true);
    let sourceFilename = null;

    if (state.format === 'json' && eff().mode === 'nested') {
      // Use the registered nested ndjson buffer
      const f = sqlEscape(state._nestedNdjsonName);
      sourceSql = `SELECT * FROM read_json('${f}', format='newline_delimited', auto_detect=true)`;
    }
    sourceSql = applyFilterToSql(sourceSql);
    sourceSql = applyColumnEditsToSql(sourceSql);

    // JSON / NDJSON: serialize in JS (DuckDB-WASM can't load the json extension)
    if (fmt === 'json' || fmt === 'ndjson') {
      return exportJsonViaJs(sourceSql, fmt);
    }
    // Markdown: no DuckDB writer — serialize a GFM table in JS.
    if (fmt === 'markdown') {
      return exportMarkdownViaJs(sourceSql);
    }
    // HTML: serialize a standalone document with a <table> in JS.
    if (fmt === 'html') {
      return exportHtmlViaJs(sourceSql);
    }

    const ext = fmt;
    const outName = `out_${Date.now()}.${ext}`;
    let copyOpts = '';
    if (fmt === 'csv') {
      const delim = $('ex_delim').value;
      const header = $('ex_header').checked;
      const comp = $('ex_compression').value;
      copyOpts = `(FORMAT CSV, HEADER ${header}, DELIMITER '${sqlEscape(delim)}'`
               + (comp === 'gzip' ? `, COMPRESSION 'gzip'` : '') + ')';
    } else if (fmt === 'parquet') {
      const comp = $('ex_compression').value;
      const rg = Number($('ex_rowgroup').value) || 100000;
      copyOpts = `(FORMAT PARQUET, COMPRESSION '${sqlEscape(comp)}', ROW_GROUP_SIZE ${rg})`;
    }

    const finalOutName = (fmt === 'csv' && $('ex_compression') && $('ex_compression').value === 'gzip')
      ? outName + '.gz' : outName;

    exportProgress.textContent = 'Writing…';
    await conn.query(`COPY (${sourceSql}) TO '${sqlEscape(finalOutName)}' ${copyOpts}`);
    exportProgress.textContent = 'Preparing download…';
    const buf = await db.copyFileToBuffer(finalOutName);
    const downloadName = makeOutName(
      fmt === 'csv' && $('ex_compression') && $('ex_compression').value === 'gzip' ? 'csv.gz' :
      ext);
    triggerDownload(buf, downloadName, mimeFor(fmt));
    try { await db.dropFile(finalOutName); } catch (e) {}
  }

  async function exportSqlToExcel(fmt) {
    const bookType = fmt === 'ods' ? 'ods' : 'xlsx';
    let sourceSql = buildSourceSql(true);
    if (state.format === 'json' && eff().mode === 'nested') {
      const f = sqlEscape(state._nestedNdjsonName);
      sourceSql = `SELECT * FROM read_json('${f}', format='newline_delimited', auto_detect=true)`;
    }
    sourceSql = applyFilterToSql(sourceSql);
    sourceSql = applyColumnEditsToSql(sourceSql);
    exportProgress.textContent = 'Reading data into memory…';
    const result = await conn.query(sourceSql);
    // Pre-detect which fields are date-like so we can coerce numerics → Date.
    const fieldInfo = result.schema.fields.map(f => ({
      name: f.name,
      isDate: isDateLikeArrowType(f.type),
    }));
    const rows = result.toArray().map(r => {
      const o = {};
      for (const f of fieldInfo) {
        let v = r[f.name];
        if (f.isDate) v = coerceDateValue(v);
        if (typeof v === 'bigint') v = Number(v);
        if (v && typeof v === 'object' && !(v instanceof Date)) v = JSON.stringify(v);
        o[f.name] = v;
      }
      return o;
    });
    exportProgress.textContent = 'Building Excel file…';
    const sheetName = ($('ex_sheet') && $('ex_sheet').value) || 'Sheet1';
    const writeHeader = !$('ex_header') || $('ex_header').checked;
    const ws = writeHeader
      ? XLSX.utils.json_to_sheet(rows, { cellDates: true })
      : XLSX.utils.json_to_sheet(rows, { cellDates: true, skipHeader: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { type: 'array', bookType: bookType });
    triggerDownload(new Uint8Array(buf), makeOutName(bookType), mimeFor(bookType));
  }

  async function exportExcelToExcel(fmt) {
    const bookType = fmt === 'ods' ? 'ods' : 'xlsx';
    // Read the original file fully with SheetJS, then re-write using selected sheet+range
    exportProgress.textContent = 'Reading Excel file (full)…';
    const buf = await readAll(state.file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const e = eff();
    const ws = wb.Sheets[e.sheet];
    if (!ws) throw new Error('Sheet not found');
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: e.range || undefined, defval: null, blankrows: false });

    const filter = getExportFilter();
    let outAoa;
    if (filter) {
      // Bridge through DuckDB: WHERE filter must reference original column
      // names, so we register CSV with the original header, then apply filter
      // and column edits in SQL, then convert back to AOA.
      if (!db) {
        exportProgress.textContent = 'Loading DuckDB engine…';
        await initDuckDB();
      }
      let header, dataRows;
      if (e.header) { header = aoa[0]; dataRows = aoa.slice(1); }
      else { header = aoa[0].map((_, i) => `col${i+1}`); dataRows = aoa; }
      const csvLines = [header.map(csvEscape).join(',')];
      for (const r of dataRows) {
        csvLines.push(header.map((_, i) => csvEscape(r[i])).join(','));
      }
      const tmpName = `tmp_xlsx_${Date.now()}.csv`;
      await db.registerFileBuffer(tmpName, new TextEncoder().encode(csvLines.join('\n')));
      let sql = `SELECT * FROM read_csv('${sqlEscape(tmpName)}', delim=',', quote='"', header=true, auto_detect=true)`;
      sql = applyFilterToSql(sql);
      sql = applyColumnEditsToSql(sql);
      exportProgress.textContent = 'Filtering…';
      const result = await conn.query(sql);
      const fields = result.schema.fields.map(f => f.name);
      const rows = result.toArray();
      outAoa = [fields];
      for (const r of rows) {
        outAoa.push(fields.map(name => {
          let v = r[name];
          if (typeof v === 'bigint') v = Number(v);
          if (v && typeof v === 'object' && !(v instanceof Date)) v = JSON.stringify(v);
          return v;
        }));
      }
      try { await db.dropFile(tmpName); } catch (_) {}
    } else {
      // Fast path: no filter, just SheetJS + JS-side column projection
      outAoa = applyColumnEditsToAoa(aoa, !!e.header);
    }

    const newWs = XLSX.utils.aoa_to_sheet(outAoa);
    const newWb = XLSX.utils.book_new();
    const sheetName = ($('ex_sheet') && $('ex_sheet').value) || e.sheet;
    XLSX.utils.book_append_sheet(newWb, newWs, sheetName);
    const out = XLSX.write(newWb, { type: 'array', bookType: bookType });
    triggerDownload(new Uint8Array(out), makeOutName(bookType), mimeFor(bookType));
  }

  async function exportExcelToOther(fmt) {
    // Read Excel fully → AOA → CSV string → register with DuckDB → COPY to target
    if (!db) {
      exportProgress.textContent = 'Loading DuckDB engine…';
      await initDuckDB();
    }
    exportProgress.textContent = 'Reading Excel file (full)…';
    const buf = await readAll(state.file);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const e = eff();
    const ws = wb.Sheets[e.sheet];
    if (!ws) throw new Error('Sheet not found');
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: e.range || undefined, defval: null, blankrows: false });
    if (!aoa.length) throw new Error('No data rows in selected range');
    let header, dataRows;
    if (e.header) { header = aoa[0]; dataRows = aoa.slice(1); }
    else { header = aoa[0].map((_, i) => `col${i+1}`); dataRows = aoa; }

    // Build CSV in memory using the ORIGINAL header (so the WHERE filter can
    // reference original column names). Filter and column edits are applied
    // afterwards in SQL.
    const csvLines = [header.map(csvEscape).join(',')];
    for (const r of dataRows) {
      csvLines.push(header.map((_, i) => csvEscape(r[i])).join(','));
    }
    const csvStr = csvLines.join('\n');
    const tmpName = `tmp_xlsx_${Date.now()}.csv`;
    const enc = new TextEncoder();
    await db.registerFileBuffer(tmpName, enc.encode(csvStr));

    let sourceSql = `SELECT * FROM read_csv('${sqlEscape(tmpName)}', delim=',', quote='"', header=true, auto_detect=true)`;
    sourceSql = applyFilterToSql(sourceSql);
    sourceSql = applyColumnEditsToSql(sourceSql);

    // JSON / NDJSON: serialize in JS (DuckDB-WASM can't load the json extension)
    if (fmt === 'json' || fmt === 'ndjson') {
      try {
        await exportJsonViaJs(sourceSql, fmt);
      } finally {
        try { await db.dropFile(tmpName); } catch (_) {}
      }
      return;
    }
    // Markdown: serialize a GFM table in JS.
    if (fmt === 'markdown') {
      try {
        await exportMarkdownViaJs(sourceSql);
      } finally {
        try { await db.dropFile(tmpName); } catch (_) {}
      }
      return;
    }
    // HTML: serialize a standalone document in JS.
    if (fmt === 'html') {
      try {
        await exportHtmlViaJs(sourceSql);
      } finally {
        try { await db.dropFile(tmpName); } catch (_) {}
      }
      return;
    }

    const ext = fmt;
    const outName = `out_${Date.now()}.${ext}`;

    let copyOpts = '';
    if (fmt === 'csv') {
      const delim = $('ex_delim').value;
      const writeHeader = $('ex_header').checked;
      const comp = $('ex_compression').value;
      copyOpts = `(FORMAT CSV, HEADER ${writeHeader}, DELIMITER '${sqlEscape(delim)}'`
                + (comp === 'gzip' ? `, COMPRESSION 'gzip'` : '') + ')';
    } else if (fmt === 'parquet') {
      const comp = $('ex_compression').value;
      const rg = Number($('ex_rowgroup').value) || 100000;
      copyOpts = `(FORMAT PARQUET, COMPRESSION '${sqlEscape(comp)}', ROW_GROUP_SIZE ${rg})`;
    }
    const finalOutName = (fmt === 'csv' && $('ex_compression').value === 'gzip')
      ? outName + '.gz' : outName;

    exportProgress.textContent = 'Writing…';
    await conn.query(`COPY (${sourceSql}) TO '${sqlEscape(finalOutName)}' ${copyOpts}`);
    const outBuf = await db.copyFileToBuffer(finalOutName);
    const downloadName = makeOutName(
      fmt === 'csv' && $('ex_compression').value === 'gzip' ? 'csv.gz' : ext);
    triggerDownload(outBuf, downloadName, mimeFor(fmt));
    try { await db.dropFile(finalOutName); await db.dropFile(tmpName); } catch (e) {}
  }

  function csvEscape(v) {
    if (v == null) return '';
    let s = (v instanceof Date) ? v.toISOString() : String(v);
    if (/[,"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function mimeFor(fmt) {
    return fmt === 'csv' ? 'text/csv' :
           fmt === 'parquet' ? 'application/octet-stream' :
           fmt === 'json' ? 'application/json' :
           fmt === 'ndjson' ? 'application/x-ndjson' :
           fmt === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
           fmt === 'ods' ? 'application/vnd.oasis.opendocument.spreadsheet' :
           fmt === 'markdown' ? 'text/markdown' :
           fmt === 'html' ? 'text/html' :
           'application/octet-stream';
  }
  function triggerDownload(buf, name, mime) {
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------- Wire-up
  dropzone.addEventListener('click', () => filePicker.click());
  dropzone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filePicker.click(); }
  });
  dropzone.addEventListener('dragover', e => {
    e.preventDefault(); dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const fs = e.dataTransfer.files;
    if (fs && fs.length) loadFiles(fs);
  });
  filePicker.addEventListener('change', e => {
    const fs = e.target.files;
    if (fs && fs.length) loadFiles(fs);
    filePicker.value = '';   // allow re-selecting the same file(s)
  });
  resetFileBtn.addEventListener('click', resetFile);

  // ---------------------------------------------------------------- SQL editor wiring
  if (sqlEditor && !sqlEditor.value) sqlEditor.value = 'SELECT * FROM data\nLIMIT 100';
  if (sqlRunBtn) sqlRunBtn.addEventListener('click', runSqlEditor);
  if (sqlEditor) sqlEditor.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSqlEditor(); }
  });

  // ---------------------------------------------------------------- Paste import
  const pasteBtn       = $('pasteBtn');
  const pasteModal     = $('pasteModal');
  const pasteArea      = $('pasteArea');
  const pasteCancelBtn = $('pasteCancelBtn');

  function openPasteModal() {
    if (!pasteModal) return;
    pasteArea.innerHTML = '';
    pasteModal.hidden = false;
    setTimeout(() => pasteArea.focus(), 0);
  }
  function closePasteModal() { if (pasteModal) pasteModal.hidden = true; }

  // One-click via the async Clipboard API (needs https + permission); falls back
  // to a focused paste box that captures the native paste event (works on file://).
  async function tryClipboardPaste() {
    if (navigator.clipboard && navigator.clipboard.read) {
      try {
        const items = await navigator.clipboard.read();
        let html = '', text = '';
        for (const it of items) {
          if (it.types.includes('text/html'))  html = await (await it.getType('text/html')).text();
          if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
        }
        if (html || text.trim()) { await enterPasteMode({ html, text }); return; }
      } catch (_) { /* permission denied / unsupported → modal fallback */ }
    }
    openPasteModal();
  }

  if (pasteBtn) {
    pasteBtn.addEventListener('click', e => { e.stopPropagation(); tryClipboardPaste(); });
    pasteBtn.addEventListener('keydown', e => e.stopPropagation());
  }
  if (pasteArea) {
    pasteArea.addEventListener('paste', e => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      const html = cd ? cd.getData('text/html') : '';
      const text = cd ? cd.getData('text/plain') : '';
      closePasteModal();
      enterPasteMode({ html, text });
    });
    pasteArea.addEventListener('keydown', e => { if (e.key === 'Escape') closePasteModal(); });
  }
  if (pasteCancelBtn) pasteCancelBtn.addEventListener('click', closePasteModal);
  if (pasteModal) pasteModal.addEventListener('click', e => { if (e.target === pasteModal) closePasteModal(); });

  const newTableBtn = $('newTableBtn');
  if (newTableBtn) {
    newTableBtn.addEventListener('click', e => { e.stopPropagation(); enterEditorMode(); });
    newTableBtn.addEventListener('keydown', e => e.stopPropagation());
  }
  const pasteEditorEl = $('pasteEditor');
  if (pasteEditorEl) {
    const onEdit = debounce(() => { refreshPreview(); }, 350);
    pasteEditorEl.addEventListener('input', () => {
      if (state.format !== 'paste') return;
      state.pasteText = pasteEditorEl.value;
      state.pasteSource = 'text';
      onEdit();
    });
    // Tab inserts a tab character instead of moving focus.
    pasteEditorEl.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = pasteEditorEl.selectionStart, en = pasteEditorEl.selectionEnd;
      pasteEditorEl.value = pasteEditorEl.value.slice(0, s) + '\t' + pasteEditorEl.value.slice(en);
      pasteEditorEl.selectionStart = pasteEditorEl.selectionEnd = s + 1;
      state.pasteText = pasteEditorEl.value;
      onEdit();
    });
  }

  // ---------------------------------------------------------------- Snapshot ("Export with data")
  // The source file is a live browser handle and cannot be embedded, so a
  // snapshot captures the configuration plus the visible preview sample as a
  // static, read-only view. Live actions (re-parse / convert / export) are
  // disabled until the user re-drops the original file.
  window.qurixApp = window.qurixApp || {};
  // Preview rows may hold BigInt (int64) or Arrow nested objects, which JSON
  // cannot serialize directly — coerce to JSON-safe primitives. BigInt → string
  // (no precision loss); Date stays (JSON emits ISO); anything exotic → String.
  function jsonSafeValue(v) {
    if (typeof v === 'bigint') return v.toString();
    if (v === null || v === undefined || v instanceof Date) return v;
    if (Array.isArray(v)) return v.map(jsonSafeValue);
    if (typeof v === 'object') {
      try {
        const o = {};
        for (const k in v) o[k] = jsonSafeValue(v[k]);
        return o;
      } catch (_) { return String(v); }
    }
    return v;
  }
  window.qurixApp.serializeState = () => {
    if (!state.schema.length && !state.previewRows.length) return null;
    let rows;
    try { rows = state.previewRows.map(r => jsonSafeValue(r)); }
    catch (_) { rows = []; }
    return {
      v: 1,
      fileName: (state.file && state.file.name) || (state.snapshotMeta && state.snapshotMeta.fileName) || 'data',
      fileSize: state.fileSize || 0,
      format: state.format,
      detected: state.detected,
      user: state.user,
      schema: state.schema,
      previewRows: rows,
      rowCountEstimate: state.rowCountEstimate,
      targetFormat: targetFormat.value,
      exFilter: ($('ex_filter') && $('ex_filter').value) || '',
    };
  };
  window.qurixApp.hydrateState = (s) => {
    if (!s || (!Array.isArray(s.schema) && !Array.isArray(s.previewRows))) return;
    enterSnapshotMode(s);
  };

  function enterSnapshotMode(s) {
    state.snapshotMode = true;
    state.snapshotMeta = { fileName: s.fileName || 'data', fileSize: s.fileSize || 0 };
    state.file = null;
    state.fileSize = s.fileSize || 0;
    state.format = s.format || null;
    state.detected = s.detected || {};
    state.user = s.user || {};
    state.schema = Array.isArray(s.schema) ? s.schema : [];
    state.previewRows = Array.isArray(s.previewRows) ? s.previewRows : [];
    state.rowCountEstimate = s.rowCountEstimate || null;

    // Reveal the workspace exactly like loadFile, but without any DuckDB work.
    dropzone.hidden = true;
    fileInfo.hidden = false;
    const fmt = state.format || '';
    fileIcon.textContent = ({ parquet:'PRQ', xlsx:'XLS', ndjson:'NDJ', duckdb:'DDB', json:'JSN' })[fmt] || 'CSV';
    fileName.textContent = state.snapshotMeta.fileName;
    fileMeta.textContent = (fmt ? fmt.toUpperCase() + ' · ' : '') + fmtBytes(state.fileSize);
    workspace.hidden = false;

    if (s.targetFormat) targetFormat.value = s.targetFormat;
    renderHeuristicPanel();
    renderExportOptions();
    const exf = $('ex_filter'); if (exf && s.exFilter) exf.value = s.exFilter;
    renderPreviewStats();
    renderPreviewGrid();

    workspace.classList.add('is-snapshot');
    exportBtn.disabled = true;
    showSnapshotBanner();
  }

  function exitSnapshotMode() {
    if (!state.snapshotMode) { const b0 = $('snapshotBanner'); if (b0) b0.remove(); return; }
    state.snapshotMode = false;
    state.snapshotMeta = null;
    workspace.classList.remove('is-snapshot');
    exportBtn.disabled = false;
    const b = $('snapshotBanner'); if (b) b.remove();
  }

  function showSnapshotBanner() {
    if ($('snapshotBanner')) return;
    const b = document.createElement('div');
    b.id = 'snapshotBanner';
    b.className = 'snapshot-banner';
    b.innerHTML =
      '<span><strong>Static snapshot.</strong> Showing the preview captured for '
      + '<code>' + escapeHtml(state.snapshotMeta.fileName) + '</code>. '
      + 'Re-parsing, conversion and export are disabled.</span>'
      + '<button type="button" class="qrx-btn" id="snapshotReloadBtn">Load the original file</button>';
    const shell = document.querySelector('.app-shell');
    shell.insertBefore(b, shell.firstChild);
    $('snapshotReloadBtn').addEventListener('click', () => { resetFile(); filePicker.click(); });
  }

  renderExportOptions();
})();
