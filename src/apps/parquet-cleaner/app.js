// === Parquet Cleaner app logic =============================================
// Browser-only Parquet cleaning & anonymization. A stacked, composable SQL
// pipeline over DuckDB-WASM. Reuses the engine/IO patterns of the Table Format
// Converter. No data leaves the browser.
// ===========================================================================
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const PAGE = 100;

  // ---- DOM refs ----
  const dropzone     = $('dropzone');
  const filePicker   = $('filePicker');
  const fileInfo     = $('fileInfo');
  const fileIcon     = $('fileIcon');
  const fileName     = $('fileName');
  const fileMeta     = $('fileMeta');
  const resetFileBtn = $('resetFileBtn');
  const statusBar    = $('statusBar');
  const statusSpinner= $('statusSpinner');
  const statusText   = $('statusText');
  const workspace    = $('workspace');
  const addStepSelect= $('addStepSelect');
  const addStepBtn   = $('addStepBtn');
  const saltInput    = $('saltInput');
  const stepsList    = $('stepsList');
  const stepsEmpty   = $('stepsEmpty');
  const pipelineCount= $('pipelineCount');
  const previewStats = $('previewStats');
  const previewGrid  = $('previewGrid');
  const previewHint  = $('previewHint');
  const viewOriginalBtn = $('viewOriginalBtn');
  const viewCleanedBtn  = $('viewCleanedBtn');
  const pager        = $('pager');
  const prevBtn      = $('prevBtn');
  const nextBtn      = $('nextBtn');
  const pageInfo     = $('pageInfo');
  const exportBtn    = $('exportBtn');
  const exportStatus = $('exportStatus');
  const analyzeCol     = $('analyzeCol');
  const analyzeBtn     = $('analyzeBtn');
  const analyzeResults = $('analyzeResults');

  // ---- State ----
  const state = {
    file: null, fileSize: 0, duckFile: null,
    schema: [],            // original columns [{name,type,typeClass}]
    rowCountOriginal: 0,
    rowCountCleaned: 0,
    pipeline: [],          // [{id, kind, enabled, params, impact}]
    view: 'original',
    page: 0,
    editingStepId: null,
    salt: '',
    seq: 0,
    cleanedSig: null,
  };
  let stepSeq = 0;
  const uid = () => 's' + (++stepSeq);
  const ctx = () => ({ salt: state.salt });

  // ---- Utilities (mirrors table-format-converter) ----
  let _statusTimer = null;
  function setStatus(text, kind) {
    if (_statusTimer) { clearTimeout(_statusTimer); _statusTimer = null; }
    if (!text) { statusBar.hidden = true; return; }
    statusBar.hidden = false;
    statusText.textContent = text;
    statusBar.classList.toggle('is-error', kind === 'error');
    statusBar.classList.toggle('is-warn', kind === 'warn');
    statusBar.classList.toggle('is-success', kind === 'success');
    statusSpinner.style.display = (kind === 'error' || kind === 'warn' || kind === 'success') ? 'none' : '';
    if (kind === 'success') _statusTimer = setTimeout(() => { if (statusText.textContent === text) setStatus(''); }, 2500);
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
  function fmtN(n) { return (n == null) ? '—' : Number(n).toLocaleString(); }
  function fmtDur(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s'; }
  function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
  function readAll(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result)); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); });
  }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function sqlEscape(s) { return String(s).replace(/'/g, "''"); }
  function sqlIdent(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }
  const id = sqlIdent;

  function typeClass(t) {
    const T = String(t).toUpperCase();
    if (/INT|DEC|FLOAT|DOUBLE|NUMERIC|REAL|HUGEINT|UTINY|TINYINT|SMALLINT|BIGINT/.test(T)) return 't-number';
    if (/BOOL/.test(T)) return 't-bool';
    if (/DATE|TIMESTAMP|TIME/.test(T)) return 't-date';
    if (/VARCHAR|TEXT|CHAR|STRING|UTF/.test(T)) return 't-string';
    return 't-other';
  }
  function arrowFriendlyType(arrowType) {
    if (!arrowType) return 'UNKNOWN';
    const n = arrowType.toString();
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
  function arrowFields(schema) {
    return schema.fields.map(f => { const t = arrowFriendlyType(f.type); return { name: f.name, type: t, typeClass: typeClass(t) }; });
  }
  function coerceDateValue(v) {
    if (v == null || v instanceof Date) return v;
    let n; if (typeof v === 'bigint') n = Number(v); else if (typeof v === 'number') n = v; else return v;
    if (!Number.isFinite(n)) return v;
    const a = Math.abs(n);
    if (a < 1e6) return new Date(n * 86400000);
    if (a < 1e13) return new Date(n);
    if (a < 1e16) return new Date(n / 1000);
    return new Date(n / 1000000);
  }
  function isDateLikeArrowType(t) { return t && /Date|Time|Timestamp/i.test(t.toString()); }
  function formatDateByType(d, colType) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return String(d);
    const T = String(colType || '').toUpperCase();
    const iso = d.toISOString();
    if (T === 'DATE') return iso.slice(0, 10);
    if (T === 'TIME') return iso.slice(11, 19);
    return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
  }
  function arrowRows(table) {
    const fields = table.schema.fields.map(f => ({ name: f.name, coerce: isDateLikeArrowType(f.type) ? coerceDateValue : (v) => v }));
    return table.toArray().map(r => { const o = {}; for (const f of fields) o[f.name] = f.coerce(r[f.name]); return o; });
  }

  // ---- DuckDB-WASM engine ----
  let duckdb = null, db = null, conn = null, dbInitPromise = null;
  async function initDuckDB() {
    if (dbInitPromise) return dbInitPromise;
    dbInitPromise = (async () => {
      duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.30.0/+esm');
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const worker_url = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
      const worker = new Worker(worker_url);
      db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(worker_url);
      conn = await db.connect();
      try { await conn.query(`SET autoinstall_known_extensions=1; SET autoload_known_extensions=1;`); } catch (_) {}
    })();
    return dbInitPromise;
  }
  async function countRows(sql) {
    const r = await conn.query(`SELECT count(*) AS c FROM (${sql})`);
    return Number(r.toArray()[0].c);
  }

  // ---- Step registry: kind -> { label, group, impact, complete, defaults, compile, title, cellExpr? } ----
  const TYPE_OPTIONS = ['VARCHAR', 'BIGINT', 'INTEGER', 'DOUBLE', 'DECIMAL(18,2)', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'TIME'];
  function firstCol() { return state.schema.length ? state.schema[0].name : ''; }
  function colReplace(src, col, expr) { return `SELECT * REPLACE (${expr} AS ${id(col)}) FROM (${src})`; }

  // ---- Date/time pattern support ----
  function isTemporalType(t) { return t === 'DATE' || t === 'TIMESTAMP' || t === 'TIME'; }
  // Translate a human pattern (DD.MM.YYYY) to a DuckDB strptime format (%d.%m.%Y).
  // Raw strptime (anything containing '%') is passed through unchanged.
  // Note: MM = month, mm/MI = minutes, HH = 24h, hh = 12h.
  function humanToStrptime(s) {
    s = String(s).trim();
    if (!s) return '';
    if (s.indexOf('%') >= 0) return s;
    const map = { YYYY: '%Y', YY: '%y', MM: '%m', DD: '%d', HH: '%H', hh: '%I', mm: '%M', MI: '%M', SS: '%S', ss: '%S' };
    return s.replace(/YYYY|YY|MM|DD|HH|hh|mm|MI|SS|ss/g, m => map[m]);
  }
  // Parse a multi-pattern field (newline / comma / semicolon separated) → strptime list.
  function parseFormats(text) {
    return String(text || '').split(/[\n,;]+/).map(humanToStrptime).filter(Boolean);
  }

  const STEP_DEFS = {
    cast: {
      label: 'Convert type', group: 'col', impact: 'cast',
      complete: p => !!p.column && !!p.toType,
      defaults: () => ({ column: firstCol(), toType: 'BIGINT', formats: '' }),
      // NULL-on-failure conversion expression (used by compile, impact and diff).
      // For temporal targets with one or more patterns, try_strptime tries each
      // format in order per value → mixed spellings (DE + US) in one column work.
      safeExpr(p) {
        const c = id(p.column);
        if (isTemporalType(p.toType)) {
          const fmts = parseFormats(p.formats);
          if (fmts.length) {
            const list = '[' + fmts.map(f => `'${sqlEscape(f)}'`).join(', ') + ']';
            const parsed = `try_strptime(CAST(${c} AS VARCHAR), ${list})`;
            return p.toType === 'TIMESTAMP' ? parsed : `CAST(${parsed} AS ${p.toType})`;
          }
        }
        return `TRY_CAST(${c} AS ${p.toType})`;
      },
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.safeExpr(p)) : src; },
      title: p => `Convert type → ${p.toType || '?'}`,
    },
    trim: {
      label: 'Trim & collapse whitespace', group: 'col', impact: 'cell',
      complete: p => !!p.column, defaults: () => ({ column: firstCol() }),
      cellExpr: p => `regexp_replace(trim(CAST(${id(p.column)} AS VARCHAR)), '\\s+', ' ', 'g')`,
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.cellExpr(p)) : src; },
      title: () => 'Trim & collapse whitespace',
    },
    case: {
      label: 'Change case', group: 'col', impact: 'cell',
      complete: p => !!p.column, defaults: () => ({ column: firstCol(), mode: 'upper' }),
      cellExpr: p => `${p.mode === 'lower' ? 'lower' : 'upper'}(CAST(${id(p.column)} AS VARCHAR))`,
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.cellExpr(p)) : src; },
      title: p => `Change case → ${p.mode || 'upper'}`,
    },
    regexReplace: {
      label: 'Regex replace', group: 'col', impact: 'cell',
      complete: p => !!p.column && !!p.pattern,
      defaults: () => ({ column: firstCol(), pattern: '', replacement: '', global: true, icase: false }),
      cellExpr(p) {
        const flags = (p.global !== false ? 'g' : '') + (p.icase ? 'i' : '');
        return `regexp_replace(CAST(${id(p.column)} AS VARCHAR), '${sqlEscape(p.pattern)}', '${sqlEscape(p.replacement || '')}', '${flags}')`;
      },
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.cellExpr(p)) : src; },
      title: () => 'Regex replace',
    },
    regexExtract: {
      label: 'Regex extract', group: 'col', impact: 'extract',
      complete: p => !!p.column && !!p.pattern,
      defaults: () => ({ column: firstCol(), pattern: '', group: '0', icase: false }),
      safeExpr(p) {
        const c = `CAST(${id(p.column)} AS VARCHAR)`;
        const opt = p.icase ? `, 'i'` : '';
        const g = Number(p.group) || 0;
        return `CASE WHEN regexp_matches(${c}, '${sqlEscape(p.pattern)}'${opt}) THEN regexp_extract(${c}, '${sqlEscape(p.pattern)}', ${g}) ELSE NULL END`;
      },
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.safeExpr(p)) : src; },
      title: () => 'Regex extract',
    },
    parseNumber: {
      label: 'Parse number', group: 'col', impact: 'cast',
      complete: p => !!p.column && !!p.target,
      defaults: () => ({ column: firstCol(), decimal: ',', target: 'DOUBLE' }),
      // Strip everything except digits, sign and the decimal separator, then
      // normalise the decimal to '.' and TRY_CAST. Removes thousand separators,
      // spaces and currency symbols automatically.
      safeExpr(p) {
        const c = id(p.column);
        const dec = p.decimal === ',' ? ',' : '.';
        const cls = dec === ',' ? '[^0-9,-]' : '[^0-9.-]';
        let e = `regexp_replace(trim(CAST(${c} AS VARCHAR)), '${cls}', '', 'g')`;
        if (dec === ',') e = `replace(${e}, ',', '.')`;
        return `TRY_CAST(NULLIF(${e}, '') AS ${p.target})`;
      },
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.safeExpr(p)) : src; },
      title: p => `Parse number → ${p.target || '?'}`,
    },
    emptyToNull: {
      label: 'Empty → NULL', group: 'col', impact: 'cell',
      complete: p => !!p.column, defaults: () => ({ column: firstCol() }),
      cellExpr: p => `NULLIF(trim(CAST(${id(p.column)} AS VARCHAR)), '')`,
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.cellExpr(p)) : src; },
      title: () => 'Empty → NULL',
    },
    hash: {
      label: 'Hash / pseudonymize', group: 'anon', impact: 'cell',
      complete: p => !!p.column, defaults: () => ({ column: firstCol() }),
      cellExpr: (p, c) => {
        const salt = (c && c.salt) ? ` || '${sqlEscape(c.salt)}'` : '';
        return `CASE WHEN ${id(p.column)} IS NULL THEN NULL ELSE sha256(CAST(${id(p.column)} AS VARCHAR)${salt}) END`;
      },
      compile(src, p, c) { return this.complete(p) ? colReplace(src, p.column, this.cellExpr(p, c)) : src; },
      title: () => 'Hash / pseudonymize',
    },
    rename: {
      label: 'Rename column', group: 'col', impact: 'struct',
      complete: p => !!p.column && !!(p.newName && p.newName.trim()),
      defaults: () => ({ column: firstCol(), newName: '' }),
      compile(src, p) { return this.complete(p) ? `SELECT * RENAME (${id(p.column)} AS ${id(p.newName.trim())}) FROM (${src})` : src; },
      title: p => `Rename ${p.column || ''} → ${(p.newName || '').trim() || '?'}`,
    },
    drop: {
      label: 'Drop column', group: 'col', impact: 'struct',
      complete: p => !!p.column, defaults: () => ({ column: firstCol() }),
      compile(src, p) { return this.complete(p) ? `SELECT * EXCLUDE (${id(p.column)}) FROM (${src})` : src; },
      title: p => `Drop ${p.column || ''}`,
    },
    dedupExact: {
      label: 'Remove exact duplicates', group: 'row', impact: 'rows',
      complete: () => true, defaults: () => ({}),
      compile(src) { return `SELECT DISTINCT * FROM (${src})`; },
      title: () => 'Remove exact duplicates',
    },
    dedupKeys: {
      label: 'Remove duplicates by keys', group: 'row', impact: 'rows',
      complete: p => !!(p.keys && p.keys.length), defaults: () => ({ keys: [], keep: 'first', orderBy: '' }),
      compile(src, p) {
        if (!this.complete(p)) return src;
        const part = p.keys.map(id).join(', ');
        const ob = p.orderBy ? ` ORDER BY ${id(p.orderBy)} ${p.keep === 'last' ? 'DESC' : 'ASC'}` : '';
        return `SELECT * FROM (${src}) QUALIFY ROW_NUMBER() OVER (PARTITION BY ${part}${ob}) = 1`;
      },
      title: p => `Dedup by ${(p.keys || []).length} key col(s)`,
    },
    dropNulls: {
      label: 'Drop null / empty rows', group: 'row', impact: 'rows',
      complete: p => !!(p.cols && p.cols.length), defaults: () => ({ cols: [], emptyToo: true }),
      compile(src, p) {
        if (!this.complete(p)) return src;
        const conds = p.cols.map(c => {
          let x = `${id(c)} IS NOT NULL`;
          if (p.emptyToo) x += ` AND trim(CAST(${id(c)} AS VARCHAR)) <> ''`;
          return '(' + x + ')';
        });
        return `SELECT * FROM (${src}) WHERE ${conds.join(' AND ')}`;
      },
      title: p => `Drop null/empty · ${(p.cols || []).length} col(s)`,
    },
    filter: {
      label: 'Filter rows (WHERE)', group: 'row', impact: 'rows',
      complete: p => !!(p.where && p.where.trim()), defaults: () => ({ where: '' }),
      compile(src, p) { return this.complete(p) ? `SELECT * FROM (${src}) WHERE ${p.where}` : src; },
      title: () => 'Filter rows (WHERE)',
    },
  };

  // ---- Pipeline compilation ----
  // Compose the enabled+complete steps' SQL over the `original` view. uptoIdx
  // (exclusive) yields the input SQL feeding the step at that position.
  function compilePipeline(uptoIdx) {
    let sql = 'SELECT * FROM original';
    const n = (uptoIdx == null) ? state.pipeline.length : uptoIdx;
    for (let i = 0; i < n; i++) {
      const s = state.pipeline[i];
      if (!s.enabled) continue;
      const def = STEP_DEFS[s.kind];
      if (!def.complete(s.params)) continue;
      sql = def.compile(sql, s.params, ctx());
    }
    return sql;
  }

  // ---- Impact computation (OK / FAILED / NO-EFFECT) ----
  async function computeImpact(step, index) {
    const def = STEP_DEFS[step.kind];
    const inputSql = compilePipeline(index);
    if (def.impact === 'cast' || def.impact === 'extract') {
      const c = id(step.params.column), expr = def.safeExpr(step.params);
      const r = (await conn.query(`SELECT
        SUM(CASE WHEN ${c} IS NOT NULL AND (${expr}) IS NOT NULL THEN 1 ELSE 0 END) AS ok,
        SUM(CASE WHEN ${c} IS NOT NULL AND (${expr}) IS NULL THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN ${c} IS NULL THEN 1 ELSE 0 END) AS noeffect,
        COUNT(*) AS total FROM (${inputSql})`)).toArray()[0];
      return { kind: def.impact, ok: Number(r.ok || 0), failed: Number(r.failed || 0), noEffect: Number(r.noeffect || 0), total: Number(r.total || 0) };
    }
    if (def.impact === 'cell') {
      const c = id(step.params.column), expr = def.cellExpr(step.params, ctx());
      const r = (await conn.query(`SELECT
        SUM(CASE WHEN CAST((${expr}) AS VARCHAR) IS DISTINCT FROM CAST(${c} AS VARCHAR) THEN 1 ELSE 0 END) AS changed,
        COUNT(*) AS total FROM (${inputSql})`)).toArray()[0];
      const total = Number(r.total || 0), changed = Number(r.changed || 0);
      return { kind: 'cell', changed, noEffect: total - changed, total };
    }
    if (def.impact === 'rows') {
      const stepSql = def.compile(inputSql, step.params, ctx());
      const [ri, ro] = await Promise.all([countRows(inputSql), countRows(stepSql)]);
      return { kind: 'rows', rowsIn: ri, rowsOut: ro, removed: ri - ro };
    }
    return { kind: 'struct' };
  }

  function impactBadges(imp) {
    if (!imp) return '<span class="pc-badge is-pending">computing…</span>';
    if (imp.kind === 'cast' || imp.kind === 'extract') {
      const okWord = imp.kind === 'extract' ? 'matched' : 'converted';
      const failWord = imp.kind === 'extract' ? 'no match → NULL' : 'failed → NULL';
      let h = `<span class="pc-badge is-ok">✓ ${fmtN(imp.ok)} ${okWord}</span>`;
      if (imp.failed) h += `<span class="pc-badge is-fail">⚠ ${fmtN(imp.failed)} ${failWord}</span>`;
      if (imp.noEffect) h += `<span class="pc-badge">• ${fmtN(imp.noEffect)} null</span>`;
      return h;
    }
    if (imp.kind === 'cell') {
      return `<span class="pc-badge is-change">${fmtN(imp.changed)} changed</span><span class="pc-badge">• ${fmtN(imp.noEffect)} unchanged</span>`;
    }
    if (imp.kind === 'rows') {
      return `<span class="pc-badge">${fmtN(imp.rowsIn)} → ${fmtN(imp.rowsOut)} rows</span>` +
        (imp.removed ? `<span class="pc-badge is-fail">− ${fmtN(imp.removed)} removed</span>` : `<span class="pc-badge is-ok">0 removed</span>`);
    }
    return '<span class="pc-badge">structural change</span>';
  }

  function diffCell(v) {
    if (v == null) return '<span class="null-val">null</span>';
    return escapeHtml(String(v));
  }
  async function buildDiffHtml(step, index) {
    const def = STEP_DEFS[step.kind];
    const c = id(step.params.column), inputSql = compilePipeline(index);
    if (def.impact === 'cast' || def.impact === 'extract' || def.impact === 'cell') {
      let q;
      if (def.impact === 'cast' || def.impact === 'extract') {
        const expr = def.safeExpr(step.params);
        q = `SELECT CAST(${c} AS VARCHAR) AS b, CAST((${expr}) AS VARCHAR) AS a,
             CASE WHEN ${c} IS NULL THEN 'noeffect' WHEN (${expr}) IS NULL THEN 'failed' ELSE 'ok' END AS cls
             FROM (${inputSql}) LIMIT 60`;
      } else {
        const expr = def.cellExpr(step.params, ctx());
        q = `SELECT CAST(${c} AS VARCHAR) AS b, CAST((${expr}) AS VARCHAR) AS a,
             CASE WHEN CAST((${expr}) AS VARCHAR) IS NOT DISTINCT FROM CAST(${c} AS VARCHAR) THEN 'noeffect' ELSE 'ok' END AS cls
             FROM (${inputSql}) LIMIT 60`;
      }
      const rows = (await conn.query(q)).toArray();
      if (!rows.length) return '<div class="pc-diff-note">No rows to preview.</div>';
      let body = '';
      for (const r of rows) {
        body += `<tr class="cls-${r.cls}"><td>${diffCell(r.b)}</td><td class="pc-arrow-cell">→</td><td>${diffCell(r.a)}</td></tr>`;
      }
      return `<div class="pc-diff"><div class="pc-diff-head"><span>before</span><span>after (${escapeHtml(step.params.column)})</span></div>`
        + `<div class="pc-diff-wrap"><table><tbody>${body}</tbody></table></div></div>`
        + `<div class="pc-diff-note">Sample of up to 60 rows · <span class="pc-badge is-ok">ok</span> changed · <span class="pc-badge is-fail">red</span> failed → NULL · grey = no effect.</div>`;
    }
    // Row / structural ops — no per-row before→after; explain instead.
    if (step.kind === 'filter') return `<div class="pc-diff-note">Keeps only rows where <code>${escapeHtml(step.params.where || '')}</code>. See removed count above.</div>`;
    if (step.kind === 'dropNulls') return `<div class="pc-diff-note">Drops rows that are NULL${step.params.emptyToo ? ' or empty' : ''} in: ${(step.params.cols || []).map(escapeHtml).join(', ') || '—'}.</div>`;
    if (step.kind === 'dedupKeys') return `<div class="pc-diff-note">Keeps the ${step.params.keep === 'last' ? 'last' : 'first'} row per ${(step.params.keys || []).map(escapeHtml).join(', ')}${step.params.orderBy ? ' (ordered by ' + escapeHtml(step.params.orderBy) + ')' : ''}.</div>`;
    if (step.kind === 'dedupExact') return `<div class="pc-diff-note">Collapses fully identical rows. See removed count above.</div>`;
    if (step.kind === 'rename') return `<div class="pc-diff-note">Renames column <code>${escapeHtml(step.params.column || '')}</code> → <code>${escapeHtml((step.params.newName || '').trim())}</code>.</div>`;
    if (step.kind === 'drop') return `<div class="pc-diff-note">Removes column <code>${escapeHtml(step.params.column || '')}</code>.</div>`;
    return '';
  }

  // ---- Step card rendering ----
  function getStep(sid) { return state.pipeline.find(s => s.id === sid); }
  function colOptions(selected) {
    return state.schema.map(c => `<option value="${escapeAttr(c.name)}" ${c.name === selected ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  }
  function colSelect(sid, field, selected) {
    return `<select class="qrx-select" data-step="${sid}" data-field="${field}">${colOptions(selected)}</select>`;
  }
  function colChecks(sid, multi, arr) {
    const set = new Set(arr || []);
    return `<div class="pc-checks">${state.schema.map(c =>
      `<label class="pc-check"><input type="checkbox" data-step="${sid}" data-multi="${multi}" value="${escapeAttr(c.name)}" ${set.has(c.name) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('')}</div>`;
  }
  const REGEX_NOTE = '<div class="pc-diff-note">Operates on the text form (cast to VARCHAR); for already-typed columns the result becomes VARCHAR — best run <strong>before</strong> a type conversion.</div>';
  function buildConfig(step) {
    const sid = step.id, p = step.params;
    switch (step.kind) {
      case 'cast': {
        const presets = [
          ['DE date', 'DD.MM.YYYY'], ['US date', 'MM/DD/YYYY'], ['ISO date', 'YYYY-MM-DD'],
          ['ISO timestamp', 'YYYY-MM-DD HH:mm:ss'],
        ];
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Target type</label><select class="qrx-select" data-step="${sid}" data-field="toType">`
          + TYPE_OPTIONS.map(t => `<option ${t === p.toType ? 'selected' : ''}>${t}</option>`).join('') + `</select></div></div>`
          + `<div class="pc-field" id="fmtwrap-${sid}" ${isTemporalType(p.toType) ? '' : 'hidden'}>`
          + `<label>Date/time pattern(s) — one per line; mixed spellings are tried in order</label>`
          + `<textarea class="qrx-input" data-step="${sid}" data-field="formats" rows="2" spellcheck="false" placeholder="DD.MM.YYYY&#10;MM/DD/YYYY">${escapeHtml(p.formats || '')}</textarea>`
          + `<div class="pc-presets">` + presets.map(([lbl, pat]) => `<button type="button" class="pc-preset" data-preset="${escapeAttr(pat)}" data-step="${sid}">+ ${escapeHtml(lbl)}</button>`).join('') + `</div>`
          + `<div class="pc-diff-note">Tokens: YYYY YY · MM (month) DD · HH (24h) hh (12h) mm (min) SS — or raw strptime like <code>%d.%m.%Y</code>. Empty = automatic ISO.</div>`
          + `</div>`;
      }
      case 'case':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Mode</label><select class="qrx-select" data-step="${sid}" data-field="mode">`
          + `<option value="upper" ${p.mode !== 'lower' ? 'selected' : ''}>UPPER</option><option value="lower" ${p.mode === 'lower' ? 'selected' : ''}>lower</option></select></div></div>`;
      case 'regexReplace': {
        const presets = [
          ['Collapse spaces', '\\s+', ' '], ['Digits only', '[^0-9]', ''],
          ['Strip [..] tags', '\\[[^\\]]*\\]', ''], ['Letters only', '[^A-Za-zÀ-ÿ ]', ''],
        ];
        return `<div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + REGEX_NOTE
          + `<div class="pc-row"><div class="pc-field"><label>Pattern (regex)</label><input class="qrx-input" data-step="${sid}" data-field="pattern" type="text" spellcheck="false" value="${escapeAttr(p.pattern || '')}" placeholder="\\s+"></div>`
          + `<div class="pc-field"><label>Replacement (use \\1 for groups)</label><input class="qrx-input" data-step="${sid}" data-field="replacement" type="text" spellcheck="false" value="${escapeAttr(p.replacement || '')}" placeholder="(empty = remove)"></div></div>`
          + `<div class="pc-flags"><label class="pc-check"><input type="checkbox" data-step="${sid}" data-bool="global" ${p.global !== false ? 'checked' : ''}> global (all matches)</label>`
          + `<label class="pc-check"><input type="checkbox" data-step="${sid}" data-bool="icase" ${p.icase ? 'checked' : ''}> case-insensitive</label></div>`
          + `<div class="pc-presets">` + presets.map(([l, pat, rep]) => `<button type="button" class="pc-preset" data-rxpreset="1" data-step="${sid}" data-pat="${escapeAttr(pat)}" data-repl="${escapeAttr(rep)}">+ ${escapeHtml(l)}</button>`).join('') + `</div>`;
      }
      case 'regexExtract': {
        const presets = [['Email domain', '@(.*)$', '1'], ['First number', '[0-9]+([.,][0-9]+)?', '0'], ['Letters', '[A-Za-zÀ-ÿ]+', '0']];
        return `<div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + REGEX_NOTE
          + `<div class="pc-row"><div class="pc-field"><label>Pattern (regex)</label><input class="qrx-input" data-step="${sid}" data-field="pattern" type="text" spellcheck="false" value="${escapeAttr(p.pattern || '')}" placeholder="@(.*)$"></div>`
          + `<div class="pc-field"><label>Group (0 = whole match)</label><input class="qrx-input" data-step="${sid}" data-field="group" type="number" min="0" value="${escapeAttr(p.group != null ? p.group : '0')}"></div></div>`
          + `<label class="pc-check"><input type="checkbox" data-step="${sid}" data-bool="icase" ${p.icase ? 'checked' : ''}> case-insensitive</label>`
          + `<div class="pc-presets">` + presets.map(([l, pat, g]) => `<button type="button" class="pc-preset" data-rxpreset="1" data-step="${sid}" data-pat="${escapeAttr(pat)}" data-grp="${escapeAttr(g)}">+ ${escapeHtml(l)}</button>`).join('') + `</div>`
          + `<div class="pc-diff-note">Rows where the pattern doesn't match become NULL.</div>`;
      }
      case 'parseNumber':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Decimal separator</label><select class="qrx-select" data-step="${sid}" data-field="decimal">`
          + `<option value="," ${p.decimal !== '.' ? 'selected' : ''}>, (German: 1.234,56)</option><option value="." ${p.decimal === '.' ? 'selected' : ''}>. (US: 1,234.56)</option></select></div>`
          + `<div class="pc-field"><label>Target type</label><select class="qrx-select" data-step="${sid}" data-field="target">`
          + ['DOUBLE', 'DECIMAL(18,2)', 'BIGINT', 'INTEGER'].map(t => `<option ${t === p.target ? 'selected' : ''}>${t}</option>`).join('') + `</select></div></div>`
          + `<div class="pc-diff-note">Removes thousand separators, spaces and currency symbols, normalizes the decimal, then converts. Non-numbers become NULL (counted as failures).</div>`;
      case 'trim': case 'emptyToNull': case 'drop':
        return `<div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`;
      case 'hash':
        return `<div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-diff-note">Replaces values with <code>sha256(value + salt)</code>. NULLs stay NULL. Set a shared salt above for consistent pseudonyms.</div>`;
      case 'rename':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>New name</label><input class="qrx-input" data-step="${sid}" data-field="newName" type="text" spellcheck="false" value="${escapeAttr(p.newName || '')}" placeholder="new_name"></div></div>`;
      case 'dedupExact':
        return `<div class="pc-diff-note">Removes rows that are identical across <strong>all</strong> columns.</div>`;
      case 'dedupKeys':
        return `<div class="pc-field"><label>Key columns (a duplicate = same values in these)</label>${colChecks(sid, 'keys', p.keys)}</div>`
          + `<div class="pc-row"><div class="pc-field"><label>Keep</label><select class="qrx-select" data-step="${sid}" data-field="keep">`
          + `<option value="first" ${p.keep !== 'last' ? 'selected' : ''}>first</option><option value="last" ${p.keep === 'last' ? 'selected' : ''}>last</option></select></div>`
          + `<div class="pc-field"><label>Order by (optional)</label><select class="qrx-select" data-step="${sid}" data-field="orderBy"><option value="">(file order)</option>${colOptions(p.orderBy)}</select></div></div>`;
      case 'dropNulls':
        return `<div class="pc-field"><label>Drop a row if any of these is null/empty</label>${colChecks(sid, 'cols', p.cols)}</div>`
          + `<label class="pc-check"><input type="checkbox" data-step="${sid}" data-bool="emptyToo" ${p.emptyToo ? 'checked' : ''}> treat empty / whitespace as null</label>`;
      case 'filter':
        return `<div class="pc-field"><label>SQL WHERE expression (references original column names)</label>`
          + `<input class="qrx-input" data-step="${sid}" data-field="where" type="text" spellcheck="false" value="${escapeAttr(p.where || '')}" placeholder="amount > 0 AND region = 'EU'"></div>`;
    }
    return '';
  }
  function stepTitle(step) {
    const def = STEP_DEFS[step.kind];
    let t = def.title ? def.title(step.params) : def.label;
    const col = step.params && step.params.column;
    if (col && step.kind !== 'rename' && step.kind !== 'drop' && def.impact !== 'rows') t += ` · <span class="pc-step-col">${escapeHtml(col)}</span>`;
    return t;
  }
  function buildStepCard(step, index) {
    const last = state.pipeline.length - 1;
    return `<div class="pc-step ${step.enabled ? '' : 'is-disabled'} ${step.id === state.editingStepId ? 'is-editing' : ''}" data-card="${step.id}">
      <div class="pc-step-head" data-step="${step.id}">
        <span class="pc-step-grip" title="${escapeAttr(STEP_DEFS[step.kind].label)}">⋮⋮</span>
        <span class="pc-step-title">${stepTitle(step)}</span>
        <button class="pc-step-btn" data-act="up" data-step="${step.id}" title="Move up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="pc-step-btn" data-act="down" data-step="${step.id}" title="Move down" ${index === last ? 'disabled' : ''}>▼</button>
        <label class="pc-step-btn" title="Enable / disable" style="cursor:pointer;"><input type="checkbox" data-toggle="1" data-step="${step.id}" ${step.enabled ? 'checked' : ''}></label>
        <button class="pc-step-btn" data-act="remove" data-step="${step.id}" title="Remove">✕</button>
      </div>
      <div class="pc-step-body">
        ${buildConfig(step)}
        <div class="pc-impact" id="imp-badges-${step.id}"><span class="pc-badge is-pending">computing…</span></div>
        <div id="imp-diff-${step.id}"></div>
      </div>
    </div>`;
  }
  function renderSteps() {
    pipelineCount.textContent = state.pipeline.length + (state.pipeline.length === 1 ? ' step' : ' steps');
    stepsEmpty.hidden = state.pipeline.length > 0;
    stepsList.innerHTML = state.pipeline.map((s, i) => buildStepCard(s, i)).join('');
  }

  // ---- Recompute (debounced) ----
  const scheduleRecompute = debounce(recompute, 250);
  async function recompute() {
    if (!conn || !state.duckFile) return;
    const seq = ++state.seq;
    try {
      const sql = compilePipeline();
      const sig = JSON.stringify(state.pipeline.filter(s => s.enabled && STEP_DEFS[s.kind].complete(s.params)).map(s => ({ k: s.kind, p: s.params }))) + '|' + state.salt;
      if (sig !== state.cleanedSig) {
        await conn.query(`CREATE OR REPLACE VIEW cleaned AS ${sql}`);
        state.cleanedSig = sig;
      }
      if (seq !== state.seq) return;
      await refreshImpacts(seq);
      if (seq !== state.seq) return;
      await renderSummary(seq);
      if (seq !== state.seq) return;
      await renderPreview();
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('Pipeline error: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }
  async function refreshImpacts(seq) {
    for (let i = 0; i < state.pipeline.length; i++) {
      if (seq !== state.seq) return;
      const step = state.pipeline[i];
      const badges = $(`imp-badges-${step.id}`), diff = $(`imp-diff-${step.id}`);
      if (!badges) continue;
      const def = STEP_DEFS[step.kind];
      if (!step.enabled) { badges.innerHTML = '<span class="pc-badge">disabled</span>'; if (diff) diff.innerHTML = ''; step.impact = null; continue; }
      if (!def.complete(step.params)) { badges.innerHTML = '<span class="pc-badge is-pending">needs configuration</span>'; if (diff) diff.innerHTML = ''; step.impact = null; continue; }
      try {
        const imp = await computeImpact(step, i);
        if (seq !== state.seq) return;
        step.impact = imp;
        badges.innerHTML = impactBadges(imp);
        if (diff) diff.innerHTML = (step.id === state.editingStepId) ? await buildDiffHtml(step, i) : '';
      } catch (err) {
        console.error(err);
        badges.innerHTML = `<span class="pc-badge is-fail">error: ${escapeHtml(err && err.message ? err.message : String(err))}</span>`;
        if (diff) diff.innerHTML = '';
      }
    }
  }
  async function renderSummary(seq) {
    const rowsCleaned = await countRows('SELECT * FROM cleaned');
    if (seq !== state.seq) return;
    const cols = (await conn.query('SELECT * FROM cleaned LIMIT 0')).schema.fields.length;
    if (seq !== state.seq) return;
    state.rowCountCleaned = rowsCleaned;
    let dupes = 0, fails = 0; const anon = new Set();
    for (const s of state.pipeline) {
      if (!s.enabled || !s.impact) continue;
      if ((s.kind === 'dedupExact' || s.kind === 'dedupKeys') && s.impact.kind === 'rows') dupes += s.impact.removed;
      if (s.kind === 'cast' && s.impact.kind === 'cast') fails += s.impact.failed;
      if (s.kind === 'hash' && STEP_DEFS.hash.complete(s.params)) anon.add(s.params.column);
    }
    $('sumRows').innerHTML = `${fmtN(state.rowCountOriginal)} <span class="pc-arrow">→</span> ${fmtN(rowsCleaned)}`;
    $('sumCols').innerHTML = `${fmtN(state.schema.length)} <span class="pc-arrow">→</span> ${fmtN(cols)}`;
    $('sumDupes').textContent = fmtN(dupes);
    const failEl = $('sumFails'); failEl.textContent = fmtN(fails); failEl.classList.toggle('is-warn', fails > 0);
    $('sumAnon').textContent = fmtN(anon.size);
  }
  async function renderPreview() {
    const base = state.view === 'cleaned' ? 'cleaned' : 'original';
    const total = state.view === 'cleaned' ? state.rowCountCleaned : state.rowCountOriginal;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    const res = await conn.query(`SELECT * FROM ${base} LIMIT ${PAGE} OFFSET ${state.page * PAGE}`);
    renderGrid(res);
    renderPreviewStats(total, res.schema.fields.length);
    pager.hidden = total <= PAGE;
    const start = total ? state.page * PAGE + 1 : 0;
    pageInfo.textContent = `Rows ${fmtN(start)}–${fmtN(Math.min(total, (state.page + 1) * PAGE))} of ${fmtN(total)} · page ${state.page + 1}/${pages}`;
    prevBtn.disabled = state.page <= 0;
    nextBtn.disabled = state.page >= pages - 1;
  }
  function renderGrid(res) {
    const fields = arrowFields(res.schema), rows = arrowRows(res);
    let h = '<tr>'; if (!fields.length) h += '<th>—</th>';
    for (const f of fields) h += `<th title="${escapeAttr(f.name)}"><div class="col-name-cell">${escapeHtml(f.name)}</div><span class="col-type"><span class="type-badge ${f.typeClass}">${escapeHtml(f.type)}</span></span></th>`;
    previewGrid.querySelector('thead').innerHTML = h + '</tr>';
    let b = ''; if (!rows.length) b = `<tr><td class="muted" colspan="${Math.max(1, fields.length)}">No rows</td></tr>`;
    for (const r of rows) {
      b += '<tr>';
      for (const f of fields) { const v = r[f.name]; b += `<td title="${escapeAttr(cellText(v, f.type))}">${cellHtml(v, f.type)}</td>`; }
      b += '</tr>';
    }
    previewGrid.querySelector('tbody').innerHTML = b;
  }
  function cellText(v, type) {
    if (v == null) return 'null';
    if (v instanceof Date) return formatDateByType(v, type);
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
    return String(v);
  }
  function cellHtml(v, type) {
    if (v == null) return '<span class="null-val">null</span>';
    return escapeHtml(cellText(v, type));
  }
  function renderPreviewStats(total, cols) {
    previewStats.innerHTML =
      `<div class="preview-stat"><div class="preview-stat-label">${state.view === 'cleaned' ? 'Cleaned rows' : 'Rows'}</div><div class="preview-stat-value">${fmtN(total)}</div></div>` +
      `<div class="preview-stat"><div class="preview-stat-label">Columns</div><div class="preview-stat-value">${fmtN(cols)}</div></div>`;
    if (previewHint) previewHint.textContent = cols > 8
      ? `${fmtN(cols)} columns — scroll horizontally to see more. Hover a cell or header for the full value.`
      : 'Hover a cell for the full value.';
  }

  // ---- Step actions ----
  function setEditing(sid) {
    state.editingStepId = sid;
    document.querySelectorAll('.pc-step').forEach(el => el.classList.toggle('is-editing', el.getAttribute('data-card') === sid));
    const step = getStep(sid); const index = state.pipeline.indexOf(step);
    if (step && step.enabled && STEP_DEFS[step.kind].complete(step.params)) {
      const diff = $(`imp-diff-${sid}`);
      if (diff) buildDiffHtml(step, index).then(html => { if (state.editingStepId === sid) diff.innerHTML = html; }).catch(() => {});
    }
  }
  function addStep(kind) {
    const def = STEP_DEFS[kind]; if (!def) return;
    const step = { id: uid(), kind, enabled: true, params: def.defaults(), impact: null };
    state.pipeline.push(step);
    state.editingStepId = step.id;
    renderSteps();
    scheduleRecompute();
  }
  function moveStep(sid, dir) {
    const i = state.pipeline.findIndex(s => s.id === sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.pipeline.length) return;
    const t = state.pipeline[i]; state.pipeline[i] = state.pipeline[j]; state.pipeline[j] = t;
    renderSteps();
    scheduleRecompute();
  }
  function removeStep(sid) {
    state.pipeline = state.pipeline.filter(s => s.id !== sid);
    if (state.editingStepId === sid) state.editingStepId = null;
    renderSteps();
    scheduleRecompute();
  }

  // ---- Load / reset ----
  async function loadFile(file) {
    try {
      setStatus('Loading DuckDB engine…');
      await initDuckDB();
      // tear down any previous source
      try { await conn.query('DROP VIEW IF EXISTS cleaned'); } catch (_) {}
      try { await conn.query('DROP VIEW IF EXISTS original'); } catch (_) {}
      if (state.duckFile) { try { await db.dropFile(state.duckFile); } catch (_) {} }
      state.file = file; state.fileSize = file.size;
      state.pipeline = []; state.editingStepId = null; state.page = 0; state.view = 'original'; state.cleanedSig = null;
      const vname = `input_${Date.now()}_` + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      state.duckFile = vname;
      setStatus('Registering file…');
      await db.registerFileHandle(vname, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
      setStatus('Reading schema…');
      await conn.query(`CREATE OR REPLACE VIEW original AS SELECT * FROM read_parquet('${sqlEscape(vname)}')`);
      state.schema = arrowFields((await conn.query('SELECT * FROM original LIMIT 0')).schema);
      state.rowCountOriginal = Number((await conn.query('SELECT count(*) AS c FROM original')).toArray()[0].c);
      analyzeCol.innerHTML = state.schema.map(c => `<option value="${escapeAttr(c.name)}">${escapeHtml(c.name)}</option>`).join('');
      analyzeResults.innerHTML = '';
      fileIcon.textContent = 'PRQ';
      fileName.textContent = file.name;
      fileMeta.textContent = `Parquet · ${fmtBytes(file.size)} · ${fmtN(state.schema.length)} cols · ${fmtN(state.rowCountOriginal)} rows`;
      dropzone.hidden = true; fileInfo.hidden = false; workspace.hidden = false;
      setView('original');
      renderSteps();
      await recompute();
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus('Could not read this Parquet file: ' + (err && err.message ? err.message : String(err)), 'error');
    }
  }
  function resetFile() {
    try { if (conn) { conn.query('DROP VIEW IF EXISTS cleaned'); conn.query('DROP VIEW IF EXISTS original'); } } catch (_) {}
    if (state.duckFile && db) { try { db.dropFile(state.duckFile); } catch (_) {} }
    state.file = null; state.duckFile = null; state.schema = []; state.pipeline = [];
    state.editingStepId = null; state.page = 0; state.cleanedSig = null;
    dropzone.hidden = false; fileInfo.hidden = true; workspace.hidden = true;
    if (analyzeResults) analyzeResults.innerHTML = '';
    filePicker.value = '';
    setStatus('');
  }
  function setView(v) {
    state.view = v; state.page = 0;
    viewOriginalBtn.classList.toggle('is-active', v === 'original');
    viewCleanedBtn.classList.toggle('is-active', v === 'cleaned');
    if (conn && state.duckFile) renderPreview().catch(e => console.error(e));
  }

  // ---- Export ----
  async function exportCleaned() {
    if (!conn || !state.duckFile) return;
    exportBtn.disabled = true;
    exportStatus.className = 'sql-status'; exportStatus.textContent = 'Exporting…';
    const t0 = performance.now();
    const out = `cleaned_${Date.now()}.parquet`;
    try {
      await conn.query(`CREATE OR REPLACE VIEW cleaned AS ${compilePipeline()}`);
      await conn.query(`COPY (SELECT * FROM cleaned) TO '${sqlEscape(out)}' (FORMAT PARQUET, COMPRESSION 'zstd')`);
      const buf = await db.copyFileToBuffer(out);
      const base = (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, '') : 'data');
      triggerDownload(buf, base + '.cleaned.parquet', 'application/octet-stream');
      exportStatus.className = 'sql-status is-ok';
      exportStatus.textContent = `Exported ${fmtN(state.rowCountCleaned)} rows · ${fmtDur(performance.now() - t0)}`;
    } catch (err) {
      console.error(err);
      exportStatus.className = 'sql-status is-error';
      exportStatus.textContent = 'Export failed: ' + (err && err.message ? err.message : String(err));
    } finally {
      try { await db.dropFile(out); } catch (_) {}
      exportBtn.disabled = false;
    }
  }
  // ---- Pattern analysis (assistance) ----
  // Mask each value: \p{Lu}->A, \p{Ll}->a, [0-9]->9, other chars kept literal.
  function maskedExpr(col) {
    const c = `CAST(${id(col)} AS VARCHAR)`;
    return `regexp_replace(regexp_replace(regexp_replace(${c}, '\\p{Lu}', 'A', 'g'), '\\p{Ll}', 'a', 'g'), '[0-9]', '9', 'g')`;
  }
  // Translate a mask (e.g. "+99 99 9999") into an anchored regex.
  function maskToRegex(mask) {
    let out = '^', i = 0;
    while (i < mask.length) {
      const ch = mask[i];
      const cls = ch === 'A' ? '\\p{Lu}' : ch === 'a' ? '\\p{Ll}' : ch === '9' ? '\\d' : null;
      if (cls) {
        let n = 1; while (i + n < mask.length && mask[i + n] === ch) n++;
        out += cls + (n > 1 ? `{${n}}` : ''); i += n;
      } else {
        out += /[.*+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch; i++;
      }
    }
    return out + '$';
  }
  async function runAnalyze() {
    const col = analyzeCol.value;
    if (!col || !conn) return;
    analyzeBtn.disabled = true;
    analyzeResults.innerHTML = '<p class="pc-diff-note">Analyzing…</p>';
    try {
      const c = id(col), m = maskedExpr(col);
      const res = await conn.query(`WITH m AS (SELECT ${m} AS pat, CAST(${c} AS VARCHAR) AS ex FROM original WHERE ${c} IS NOT NULL)
        SELECT pat, count(*)::BIGINT AS c, min(ex) AS example FROM m GROUP BY pat ORDER BY c DESC LIMIT 30`);
      const rows = res.toArray();
      const nulls = Number((await conn.query(`SELECT count(*)::BIGINT AS c FROM original WHERE ${c} IS NULL`)).toArray()[0].c);
      const distinct = Number((await conn.query(`SELECT count(DISTINCT ${m})::BIGINT AS c FROM original WHERE ${c} IS NOT NULL`)).toArray()[0].c);
      renderAnalyze(col, rows, nulls, distinct);
    } catch (err) {
      console.error(err);
      analyzeResults.innerHTML = `<p class="pc-diff-note" style="color:var(--qrx-danger)">Analysis failed: ${escapeHtml(err && err.message ? err.message : String(err))}</p>`;
    } finally {
      analyzeBtn.disabled = false;
    }
  }
  function renderAnalyze(col, rows, nulls, distinct) {
    const total = state.rowCountOriginal || 1;
    const top = rows.reduce((s, r) => s + Number(r.c), 0);
    let html = `<div class="pc-pat-meta">Column <strong>${escapeHtml(col)}</strong> · ${fmtN(distinct)} distinct pattern(s)`
      + (distinct > rows.length ? ` (showing top ${rows.length})` : '') + ` · ${fmtN(nulls)} null</div>`;
    html += '<table class="pc-pat-table"><thead><tr><th>Pattern</th><th>Count</th><th>Share</th><th>Example</th><th>Regex</th></tr></thead><tbody>';
    for (const r of rows) {
      const cnt = Number(r.c), share = cnt / total * 100;
      const isEmpty = r.pat === '';
      const mask = isEmpty ? '∅ (empty)' : r.pat;
      const rx = isEmpty ? '^$' : maskToRegex(r.pat);
      html += `<tr><td class="pc-pat-mask">${escapeHtml(mask)}</td>`
        + `<td>${fmtN(cnt)}</td>`
        + `<td><div class="pc-pat-share"><span class="pc-pat-bar" style="width:${Math.max(2, Math.round(share))}px"></span>${share.toFixed(1)}%</div></td>`
        + `<td class="pc-pat-ex" title="${escapeAttr(r.example == null ? '' : String(r.example))}">${escapeHtml(r.example == null ? '' : String(r.example))}</td>`
        + `<td class="pc-pat-rx">${escapeHtml(rx)} <button type="button" class="pc-copy" data-copy="${escapeAttr(rx)}" title="Copy regex">copy</button></td></tr>`;
    }
    if (nulls) html += `<tr class="pc-pat-muted"><td>(null)</td><td>${fmtN(nulls)}</td><td>${(nulls / total * 100).toFixed(1)}%</td><td></td><td></td></tr>`;
    html += '</tbody></table>';
    html += `<div class="pc-diff-note">Mask: <code>A</code> uppercase · <code>a</code> lowercase · <code>9</code> digit · other characters kept literally (Unicode letters incl. umlauts). The derived regex can be pasted into a Regex step.</div>`;
    analyzeResults.innerHTML = html;
  }

  function triggerDownload(buf, name, mime) {
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Wire-up ----
  dropzone.addEventListener('click', () => filePicker.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); filePicker.click(); } });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('is-dragover');
    const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) loadFile(f);
  });
  filePicker.addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) loadFile(f); filePicker.value = ''; });
  resetFileBtn.addEventListener('click', resetFile);

  addStepBtn.addEventListener('click', () => addStep(addStepSelect.value));
  saltInput.addEventListener('input', () => { state.salt = saltInput.value; scheduleRecompute(); });

  viewOriginalBtn.addEventListener('click', () => setView('original'));
  viewCleanedBtn.addEventListener('click', () => setView('cleaned'));
  prevBtn.addEventListener('click', () => { state.page--; renderPreview().catch(e => console.error(e)); });
  nextBtn.addEventListener('click', () => { state.page++; renderPreview().catch(e => console.error(e)); });
  exportBtn.addEventListener('click', exportCleaned);
  if (analyzeBtn) analyzeBtn.addEventListener('click', runAnalyze);
  if (analyzeResults) analyzeResults.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const txt = b.getAttribute('data-copy');
    const done = () => { b.classList.add('is-copied'); b.textContent = 'copied'; setTimeout(() => { b.classList.remove('is-copied'); b.textContent = 'copy'; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(done);
    else { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove(); done(); }
  });

  // Step list delegation
  stepsList.addEventListener('click', e => {
    const rx = e.target.closest('[data-rxpreset]');
    if (rx) {
      const sid = rx.getAttribute('data-step'); const step = getStep(sid); if (!step) return;
      const setF = (f, v) => {
        if (v == null) return;
        step.params[f] = v;
        const inp = document.querySelector(`.pc-step[data-card="${sid}"] [data-field="${f}"]`);
        if (inp) inp.value = v;
      };
      setF('pattern', rx.getAttribute('data-pat'));
      if (rx.hasAttribute('data-repl')) setF('replacement', rx.getAttribute('data-repl'));
      if (rx.hasAttribute('data-grp')) setF('group', rx.getAttribute('data-grp'));
      setEditing(sid); scheduleRecompute();
      return;
    }
    const pre = e.target.closest('[data-preset]');
    if (pre) {
      const sid = pre.getAttribute('data-step'); const step = getStep(sid); if (!step) return;
      const pat = pre.getAttribute('data-preset');
      const cur = (step.params.formats || '').trim();
      const lines = cur ? cur.split(/\n/) : [];
      if (!lines.includes(pat)) lines.push(pat);
      step.params.formats = lines.join('\n');
      const ta = document.querySelector(`.pc-step[data-card="${sid}"] textarea[data-field="formats"]`);
      if (ta) ta.value = step.params.formats;
      setEditing(sid); scheduleRecompute();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const sid = btn.getAttribute('data-step'), act = btn.dataset.act;
      if (act === 'up') moveStep(sid, -1);
      else if (act === 'down') moveStep(sid, 1);
      else if (act === 'remove') removeStep(sid);
      return;
    }
    if (e.target.closest('input,select,button,label')) return;
    const head = e.target.closest('.pc-step-head');
    if (head) setEditing(head.getAttribute('data-step'));
  });
  function onField(e) {
    const el = e.target; const sid = el.getAttribute('data-step'); if (!sid) return;
    const step = getStep(sid); if (!step) return;
    if (el.dataset.toggle) { step.enabled = el.checked; const card = document.querySelector(`.pc-step[data-card="${sid}"]`); if (card) card.classList.toggle('is-disabled', !step.enabled); scheduleRecompute(); return; }
    if (el.dataset.multi) {
      const arr = step.params[el.dataset.multi] || (step.params[el.dataset.multi] = []);
      const i = arr.indexOf(el.value);
      if (el.checked && i < 0) arr.push(el.value); else if (!el.checked && i >= 0) arr.splice(i, 1);
    } else if (el.dataset.bool) {
      step.params[el.dataset.bool] = el.checked;
    } else if (el.dataset.field) {
      step.params[el.dataset.field] = el.value;
      // keep the header title in sync without rebuilding (preserves input focus)
      const titleEl = document.querySelector(`.pc-step[data-card="${sid}"] .pc-step-title`);
      if (titleEl) titleEl.innerHTML = stepTitle(step);
      // show/hide the date/time pattern field when the target type changes
      if (el.dataset.field === 'toType') {
        const fw = $(`fmtwrap-${sid}`);
        if (fw) fw.hidden = !isTemporalType(el.value);
      }
    }
    setEditing(sid);
    scheduleRecompute();
  }
  stepsList.addEventListener('change', onField);
  stepsList.addEventListener('input', onField);

})();
