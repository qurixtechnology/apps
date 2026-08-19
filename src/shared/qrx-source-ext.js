// ============================================================================
// qrx.source-ext — the "exotic" formats, ported from the Table Format Converter.
//
// Optional companion to qrx.source. When present it teaches the base module to
// open the formats it otherwise refuses, in two resource-conscious styles:
//
//   ATTACH  (DuckDB files): registered as a lazy byte-range handle and ATTACHed
//           READ-ONLY. Nothing is read up front; row counts and the table list
//           come from the catalogue. This is the metadata-only, O(1) path.
//   PARSE   (SQLite, Excel/ODS/Numbers, Markdown, HTML): decoded in the browser
//           and rewritten ONCE to a Parquet, then queried like any other Parquet.
//           A full read, so qrx.source gates it on size (PARSE_* thresholds) and
//           points at the streaming converter above the ceiling.
//
// SQLite goes through sql.js and Excel through SheetJS, both loaded on demand
// from their CDNs — so those two formats want internet, exactly like the
// converter. (DuckDB-WASM's own sqlite scanner cannot read a VFS-registered
// database, so a native ATTACH is not an option for SQLite.) DuckDB, Markdown
// and HTML need no library.
//
// It installs itself onto qrx.source: extends PLANS/ACCEPT and sets openExternal.
// ============================================================================
(function () {
  'use strict';
  const qrx = window.qrx;
  if (!qrx || !qrx.source) return;   // nothing to extend

  const q = (sql) => qrx.duckdb.query(sql);
  const rows = (res) => qrx.duckdb.rows(res);
  const str = (s) => qrx.duckdb.str(s);
  const ident = (s) => qrx.duckdb.ident(s);

  qrx.i18n.register('sourceExt', {
    de: {
      parsing: 'Datei wird gelesen…', attaching: 'Datenbank wird eingebunden…',
      tables: 'Tabellen werden gelesen…',
      noTables: 'In dieser Datei wurden keine Tabellen gefunden.',
      noSheet: 'Das gewählte Blatt ist leer.',
      noMdTable: 'In dieser Datei wurde keine Markdown-Tabelle (Pipe-Tabelle) gefunden.',
      noHtmlTable: 'In dieser Datei wurde keine HTML-Tabelle gefunden.',
      sqliteFailed: 'Diese SQLite-Datei ließ sich hier nicht öffnen — wandle sie mit dem '
        + 'Table Format Converter zu Parquet um.',
      sqliteEngine: 'SQLite-Engine wird geladen…',
      needSheetJS: 'Die Excel-Bibliothek konnte nicht geladen werden (Internet nötig).',
      needSqlJs: 'Die SQLite-Bibliothek konnte nicht geladen werden (Internet nötig).',
    },
    en: {
      parsing: 'Reading file…', attaching: 'Attaching database…',
      tables: 'Reading tables…',
      noTables: 'No tables were found in this file.',
      noSheet: 'The chosen sheet is empty.',
      noMdTable: 'No Markdown (pipe) table was found in this file.',
      noHtmlTable: 'No HTML table was found in this file.',
      sqliteFailed: 'This SQLite file could not be opened here — convert it to Parquet '
        + 'with the Table Format Converter.',
      sqliteEngine: 'Loading SQLite engine…',
      needSheetJS: 'The Excel library could not be loaded (needs internet).',
      needSqlJs: 'The SQLite library could not be loaded (needs internet).',
    },
  });
  const t = (k, p) => qrx.i18n.t('sourceExt.' + k, p);

  function SourceError(code, message, extra) {
    const e = new Error(message); e.name = 'SourceError'; e.code = code;
    Object.assign(e, extra || {});
    return e;
  }

  let seq = 0;
  const vfs = (file, kind, suffix) =>
    `ext_${kind}_${Date.now()}_${seq++}_${String(file.name || 'x').replace(/[^a-zA-Z0-9._-]/g, '_')}${suffix ? '.' + suffix : ''}`;

  // ---------------------------------------------------------------- CDN: SheetJS
  let sheetPromise = null;
  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (sheetPromise) return sheetPromise;
    sheetPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(SourceError('read-failed', t('needSheetJS')));
      document.head.appendChild(s);
    });
    return sheetPromise;
  }

  // ---------------------------------------------------------------- helpers
  function csvEscape(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, dataRows) {
    const lines = [header.map(csvEscape).join(',')];
    for (const r of dataRows) lines.push(header.map((_, i) => csvEscape(r[i])).join(','));
    return lines.join('\n');
  }
  function dedupeCols(cols) {
    const seen = new Map(); const out = [];
    (cols || []).forEach((c, i) => {
      let name = (c != null && String(c).trim()) || `column${i + 1}`;
      const base = name; let n = 1;
      while (seen.has(name)) name = `${base}_${++n}`;
      seen.set(name, true); out.push(name);
    });
    return out;
  }
  async function fill(desc, rowsHint) {
    const d = rows(await q(`DESCRIBE SELECT * FROM ${desc.from}`));
    desc.columns = d.map((r) => ({ name: r.column_name, type: r.column_type, typeClass: qrx.duckdb.typeClass(r.column_type) }));
    if (rowsHint != null) { desc.rows = rowsHint; return; }
    try { desc.rows = Number(rows(await q(`SELECT count(*)::BIGINT AS n FROM ${desc.from}`))[0].n); }
    catch (_) { desc.rows = null; }
  }

  // Parsed rows become an in-VFS CSV, then a single COPY rewrites them to a
  // zstd-Parquet — exactly what qrx.source does for a CSV. So every consumer,
  // the profiler's footer reader included, sees the same thing: a Parquet, plus
  // `normalized: true`. One O(n) pass, then every query is fast.
  async function materializeParquet(file, kind, header, dataRows, say) {
    say(qrx.i18n.t('source.normalizing'));
    const csvName = vfs(file, kind, 'csv');
    await qrx.duckdb.registerBuffer(csvName, new TextEncoder().encode(toCsv(dedupeCols(header), dataRows)));
    const parquetName = vfs(file, kind, 'parquet');
    try {
      await q(`COPY (SELECT * FROM read_csv(${str(csvName)}, delim=',', quote='"', header=true, auto_detect=true)) `
        + `TO ${str(parquetName)} (FORMAT PARQUET, COMPRESSION 'zstd')`);
    } finally { await qrx.duckdb.dropFiles(csvName); }
    const desc = {
      id: 'src' + (seq++), name: file.name, bytes: file.size, kind,
      from: `read_parquet(${str(parquetName)})`,
      normalized: true, attached: false, vfsName: parquetName, warnings: [], rows: null, columns: [],
    };
    say(qrx.i18n.t('source.describing'));
    await fill(desc);
    say('');
    return desc;
  }

  // ---------------------------------------------------------------- ATTACH (DuckDB / SQLite)
  async function finishAttach(file, kind, alias, vname, opts, say, failMsg) {
    say(t('tables'));
    const teardown = async () => { try { await q('DETACH ' + ident(alias)); } catch (_) {} await qrx.duckdb.dropFiles(vname); };
    // ATTACH may succeed lazily; the file is only really opened when we read the
    // catalogue, so a bad/unreadable database surfaces here.
    let listed;
    try {
      listed = rows(await q(
        `SELECT schema_name AS s, table_name AS n, estimated_size AS est FROM duckdb_tables() `
        + `WHERE database_name = ${str(alias)} AND internal = false `
        + `UNION ALL SELECT schema_name, view_name, NULL FROM duckdb_views() `
        + `WHERE database_name = ${str(alias)} AND internal = false ORDER BY 1, 2`));
    } catch (e) {
      await teardown();
      throw SourceError('read-failed', failMsg || (e && e.message) || String(e), { converterHref: opts.converterHref || null });
    }
    if (!listed.length) { await teardown(); throw SourceError('read-failed', failMsg || t('noTables'), { converterHref: opts.converterHref || null }); }

    const tables = listed.map((r) => ({
      schema: String(r.s), name: String(r.n),
      qualified: `${ident(alias)}.${ident(String(r.s))}.${ident(String(r.n))}`,
      rows: r.est == null ? null : Number(r.est),
    }));
    let chosen = tables[0];
    if (tables.length > 1 && opts.pickTable) {
      const picked = await opts.pickTable(tables.map((tb) => ({
        name: tb.qualified,
        label: (tb.schema && tb.schema !== 'main' ? tb.schema + '.' : '') + tb.name,
        rows: tb.rows,
      })));
      if (picked == null) { await teardown(); throw SourceError('cancelled', ''); }
      chosen = tables.find((tb) => tb.qualified === picked) || tables[0];
    }
    const desc = {
      id: 'src' + (seq++), name: file.name, bytes: file.size, kind,
      from: chosen.qualified, normalized: false, attached: true,
      vfsName: vname, warnings: [], rows: null, columns: [],
      dispose: async () => { try { await q('DETACH ' + ident(alias)); } catch (_) {} },
    };
    say(qrx.i18n.t('source.describing'));
    await fill(desc, chosen.rows);
    say('');
    return desc;
  }

  async function openDuckdb(file, opts, say) {
    await qrx.duckdb.init({ onStatus: say });
    say(t('attaching'));
    const vname = vfs(file, 'duckdb');
    await qrx.duckdb.registerHandle(vname, file);   // lazy byte-range handle
    const alias = 'db' + (seq++).toString(36);
    try { await q(`ATTACH ${str(vname)} AS ${ident(alias)} (READ_ONLY)`); }
    catch (e) { await qrx.duckdb.dropFiles(vname); throw SourceError('read-failed', (e && e.message) || String(e)); }
    return finishAttach(file, 'duckdb', alias, vname, opts, say);
  }

  // SQLite via sql.js. DuckDB-WASM's sqlite scanner cannot open a VFS-registered
  // database (duckdb-wasm #1213/#1972 — "unable to open database file"), so, like
  // the converter, we read it with sql.js and normalise the chosen table to
  // Parquet. That holds the whole database in the heap, which is why sqlite is a
  // size-gated 'parse' plan, not a lazy 'attach'.
  const SQLJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
  let sqlJsPromise = null;
  function loadSqlJs() {
    if (sqlJsPromise) return sqlJsPromise;
    sqlJsPromise = new Promise((resolve, reject) => {
      if (window.initSqlJs) return resolve(window.initSqlJs);
      const s = document.createElement('script');
      s.src = SQLJS_BASE + 'sql-wasm.js';
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.initSqlJs);
      s.onerror = () => reject(SourceError('read-failed', t('needSqlJs')));
      document.head.appendChild(s);
    }).then((initSqlJs) => initSqlJs({ locateFile: (f) => SQLJS_BASE + f }));
    return sqlJsPromise;
  }
  const sqIdent = (s) => '"' + String(s).replace(/"/g, '""') + '"';

  async function openSqlite(file, opts, say) {
    await qrx.duckdb.init({ onStatus: say });
    say(t('sqliteEngine'));
    const SQL = await loadSqlJs();
    say(t('parsing'));
    let db;
    try { db = new SQL.Database(new Uint8Array(await file.arrayBuffer())); }
    catch (e) { throw SourceError('read-failed', t('sqliteFailed'), { converterHref: opts.converterHref || null }); }
    try {
      const res = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') "
        + "AND name NOT LIKE 'sqlite_%' ORDER BY name");
      const names = res.length ? res[0].values.map((r) => String(r[0])) : [];
      if (!names.length) throw SourceError('read-failed', t('noTables'), { converterHref: opts.converterHref || null });
      let table = names[0];
      if (names.length > 1 && opts.pickTable) {
        const picked = await opts.pickTable(names.map((n) => ({ name: n })));
        if (picked == null) throw SourceError('cancelled', '');
        table = picked;
      }
      const tr = db.exec(`SELECT * FROM ${sqIdent(table)}`);
      const header = tr.length ? tr[0].columns : [];
      const dataRows = tr.length ? tr[0].values : [];
      return await materializeParquet(file, 'sqlite', header, dataRows, say);
    } finally { try { db.close(); } catch (_) {} }
  }

  // ---------------------------------------------------------------- PARSE: Excel
  function decodeRangeSafe(XLSX, ref) { try { return XLSX.utils.decode_range(ref); } catch (_) { return null; } }
  function extendRangeToSheetEnd(XLSX, rangeStr, ws) {
    const r = decodeRangeSafe(XLSX, rangeStr);
    const ext = ws['!ref'] ? decodeRangeSafe(XLSX, ws['!ref']) : null;
    if (!r || !ext || ext.e.r <= r.e.r) return rangeStr;
    return XLSX.utils.encode_range({ s: { r: r.s.r, c: r.s.c }, e: { r: ext.e.r, c: r.e.c } });
  }
  // Find the rectangular data block on a sheet (skip title rows / stray cells).
  function detectExcelDataBlock(XLSX, ws) {
    const ref = ws['!ref'];
    if (!ref) return { range: 'A1:A1', headerRowIdx: 0 };
    const range = XLSX.utils.decode_range(ref);
    const grid = [];
    for (let R = range.s.r; R <= range.e.r; R++) {
      const row = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        row.push(!!(cell && cell.v != null && String(cell.v).trim() !== ''));
      }
      grid.push(row);
    }
    const fill = grid.map((r) => r.reduce((a, b) => a + (b ? 1 : 0), 0));
    if (fill.every((f) => f === 0)) return { range: ref, headerRowIdx: 0 };
    const widths = fill.filter((n) => n > 1); const freq = {};
    widths.forEach((n) => { freq[n] = (freq[n] || 0) + 1; });
    let modeW = 0, modeF = 0;
    for (const k in freq) if (freq[k] > modeF) { modeF = freq[k]; modeW = +k; }
    if (!modeW) modeW = Math.max.apply(null, fill);
    let dataStart = -1;
    for (let i = 0; i < grid.length - 1; i++) {
      if (fill[i] >= modeW * 0.6 && fill[i + 1] >= modeW * 0.6) { dataStart = i; break; }
    }
    if (dataStart === -1) { for (let i = 0; i < grid.length; i++) if (fill[i] >= modeW * 0.6) { dataStart = i; break; } }
    if (dataStart === -1) dataStart = 0;
    let dataEnd = grid.length - 1;
    for (let i = dataStart + 1; i < grid.length; i++) if (fill[i] === 0) { dataEnd = i - 1; break; }
    const startRow = grid[dataStart];
    let firstCol = 0; while (firstCol < startRow.length && !startRow[firstCol]) firstCol++;
    let lastCol = startRow.length - 1; while (lastCol > firstCol && !startRow[lastCol]) lastCol--;
    return {
      range: XLSX.utils.encode_range({ s: { r: range.s.r + dataStart, c: range.s.c + firstCol }, e: { r: range.s.r + dataEnd, c: range.s.c + lastCol } }),
      headerRowIdx: dataStart,
    };
  }

  async function openExcel(file, opts, say) {
    const XLSX = await loadSheetJS();
    await qrx.duckdb.init({ onStatus: say });
    say(t('parsing'));
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true, dense: true });
    const nonEmpty = wb.SheetNames.filter((n) => { const ws = wb.Sheets[n]; return ws && ws['!ref'] && ws['!ref'] !== 'A1:A1'; });
    const names = nonEmpty.length ? nonEmpty : wb.SheetNames;
    let sheet = names[0];
    if (names.length > 1 && opts.pickTable) {
      const picked = await opts.pickTable(names.map((n) => ({ name: n })));
      if (picked == null) throw SourceError('cancelled', '');
      sheet = picked;
    }
    const ws = wb.Sheets[sheet];
    if (!ws || !ws['!ref']) throw SourceError('read-failed', t('noSheet'));
    const block = detectExcelDataBlock(XLSX, ws);
    const range = extendRangeToSheetEnd(XLSX, block.range, ws);
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: range || undefined, defval: null, blankrows: false });
    if (!aoa.length) throw SourceError('read-failed', t('noSheet'));
    const header = aoa[0].map((h, i) => (h != null && String(h).trim() !== '') ? String(h) : `col${i + 1}`);
    return materializeParquet(file, 'xlsx', header, aoa.slice(1), say);
  }

  // ---------------------------------------------------------------- PARSE: Markdown
  function splitMdRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').replace(/\\\\/g, '\\').trim());
  }
  function isMdSeparator(line) {
    const s = line.trim();
    if (!s.includes('-')) return false;
    const cells = splitMdRow(s);
    return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s+/g, '')));
  }
  function parseMarkdownTables(text) {
    const lines = text.split(/\r?\n/); const tables = []; let lastHeading = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hm = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
      if (hm) { lastHeading = hm[1].replace(/\s*#*\s*$/, '').trim(); continue; }
      if (line.includes('|') && i + 1 < lines.length && isMdSeparator(lines[i + 1])) {
        const columns = dedupeCols(splitMdRow(line)); const trows = []; let j = i + 2;
        for (; j < lines.length; j++) {
          const l = lines[j];
          if (!l.trim() || !l.includes('|')) break;
          const cells = splitMdRow(l);
          trows.push(columns.map((_, k) => (cells[k] != null ? cells[k] : '')));
        }
        tables.push({ name: `Table ${tables.length + 1}` + (lastHeading ? ` — ${lastHeading}` : ''), columns, rows: trows });
        i = j - 1; lastHeading = '';
      } else if (line.trim()) { lastHeading = ''; }
    }
    return tables;
  }
  async function openMarkdown(file, opts, say) {
    await qrx.duckdb.init({ onStatus: say });
    say(t('parsing'));
    const tables = parseMarkdownTables(await file.text());
    if (!tables.length) throw SourceError('read-failed', t('noMdTable'));
    let tbl = tables[0];
    if (tables.length > 1 && opts.pickTable) {
      const picked = await opts.pickTable(tables.map((tb, i) => ({ name: String(i), label: tb.name, rows: tb.rows.length })));
      if (picked == null) throw SourceError('cancelled', '');
      tbl = tables[Number(picked)] || tables[0];
    }
    return materializeParquet(file, 'markdown', tbl.columns, tbl.rows, say);
  }

  // ---------------------------------------------------------------- PARSE: HTML
  function parseHtmlTables(html) {
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (_) { return []; }
    const tables = [];
    doc.querySelectorAll('table').forEach((tbl) => {
      const matrix = [];
      tbl.querySelectorAll('tr').forEach((tr) => {
        const cells = [];
        tr.querySelectorAll('th, td').forEach((td) => cells.push((td.textContent || '').replace(/\s+/g, ' ').trim()));
        if (cells.length) matrix.push(cells);
      });
      if (!matrix.length) return;
      const w = matrix.reduce((m, r) => Math.max(m, r.length), 0);
      matrix.forEach((r) => { while (r.length < w) r.push(''); });
      const cap = tbl.querySelector('caption'); const capTxt = cap && cap.textContent.trim();
      tables.push({ name: `Table ${tables.length + 1}` + (capTxt ? ` — ${capTxt}` : ''), matrix });
    });
    return tables;
  }
  async function openHtml(file, opts, say) {
    await qrx.duckdb.init({ onStatus: say });
    say(t('parsing'));
    const tables = parseHtmlTables(await file.text());
    if (!tables.length) throw SourceError('read-failed', t('noHtmlTable'));
    let tbl = tables[0];
    if (tables.length > 1 && opts.pickTable) {
      const picked = await opts.pickTable(tables.map((tb, i) => ({ name: String(i), label: tb.name, rows: tb.matrix.length })));
      if (picked == null) throw SourceError('cancelled', '');
      tbl = tables[Number(picked)] || tables[0];
    }
    return materializeParquet(file, 'html', tbl.matrix[0], tbl.matrix.slice(1), say);
  }

  // ---------------------------------------------------------------- entry point
  async function openExternal(file, opts = {}) {
    const say = (m) => { try { opts.onStatus && opts.onStatus(m); } catch (_) {} };
    const kind = opts.kind || await qrx.source.detect(file);
    switch (kind) {
      case 'duckdb':   return openDuckdb(file, opts, say);
      case 'sqlite':   return openSqlite(file, opts, say);
      case 'xlsx':     return openExcel(file, opts, say);
      case 'markdown': return openMarkdown(file, opts, say);
      case 'html':     return openHtml(file, opts, say);
      default:
        throw SourceError('unsupported-format',
          qrx.i18n.t('source.unsupported', { kind: (qrx.source.LABELS[kind] || kind).toUpperCase() }), { kind });
    }
  }

  // Install onto the base module: DuckDB attaches lazily, the rest parse-then-
  // normalise (size-gated). Widen the accepted extensions to match.
  Object.assign(qrx.source.PLANS, { duckdb: 'attach', sqlite: 'parse', xlsx: 'parse', markdown: 'parse', html: 'parse' });
  qrx.source.ACCEPT += ',.xlsx,.xls,.ods,.fods,.numbers,.sqlite,.sqlite3,.db,.duckdb,.ddb,.md,.markdown,.mdown,.mkd,.html,.htm';
  qrx.source.openExternal = openExternal;
})();
