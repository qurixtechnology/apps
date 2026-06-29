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
  const pcLayout       = $('pcLayout');
  const expandAllBtn   = $('expandAllBtn');
  const collapseAllBtn = $('collapseAllBtn');
  const piiScanBtn     = $('piiScanBtn');
  const piiApplyAllBtn = $('piiApplyAllBtn');
  const piiResults     = $('piiResults');
  const piiSummary     = $('piiSummary');

  // ---- State ----
  const state = {
    file: null, fileSize: 0, duckFile: null,
    schema: [],            // original columns [{name,type,typeClass}]
    rowCountOriginal: 0,
    rowCountCleaned: 0,
    pipeline: [],          // [{id, kind, enabled, params, impact}]
    view: 'original',
    page: 0,
    layout: 'default',
    salt: '',
    seq: 0,
    cleanedSig: null,
    pii: null,             // { colName: { type, via:'name'|'content', conf } } after a scan
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
  function colOr(name) { return state.schema.some(c => c.name === name) ? name : firstCol(); }
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

  // ---- Anonymization helpers ----
  // Small curated dictionaries for the Faker step (synthetic, structure-preserving).
  const FK = {
    firstName: ['Anna', 'Lena', 'Sophie', 'Maria', 'Julia', 'Laura', 'Sarah', 'Lisa', 'Katharina', 'Nina', 'Thomas', 'Michael', 'Andreas', 'Stefan', 'Markus', 'Daniel', 'Christian', 'Martin', 'Peter', 'Tobias', 'Jonas', 'Lukas', 'Felix', 'David', 'Jan', 'Paul', 'Fritz', 'Hans', 'Klaus', 'Werner'],
    lastName: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Krause', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Köhler'],
    city: ['Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt', 'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dortmund', 'Essen', 'Bremen', 'Dresden', 'Hannover', 'Nürnberg', 'Wien', 'Zürich', 'Basel', 'Graz', 'Linz', 'Salzburg'],
    country: ['Deutschland', 'Österreich', 'Schweiz', 'Frankreich', 'Italien', 'Spanien', 'Niederlande', 'Belgien', 'Polen', 'Tschechien', 'Dänemark', 'Schweden', 'Norwegen', 'Portugal', 'Irland'],
    street: ['Hauptstraße', 'Bahnhofstraße', 'Gartenstraße', 'Schulstraße', 'Dorfstraße', 'Lindenstraße', 'Bergstraße', 'Birkenweg', 'Kirchgasse', 'Ringstraße', 'Am Markt', 'Parkweg', 'Wiesenweg', 'Mühlweg', 'Goethestraße'],
    company: ['Nordwind GmbH', 'Alpenbau AG', 'Rheindata GmbH', 'Seestern KG', 'Blautech GmbH', 'Mustermann AG', 'Sonnenhof GmbH', 'Brückner & Co', 'Kontor 7 GmbH', 'Vento Solutions'],
    domain: ['example.org', 'example.com', 'mail.example', 'test.example', 'demo.example'],
  };
  function listLit(arr) { return '[' + arr.map(x => `'${sqlEscape(x)}'`).join(', ') + ']'; }
  // 0..mod-1 integer: deterministic from the value (+salt+suffix) or random per row.
  function rndIdx(colId, salt, suffix, mod, mode) {
    return mode === 'rand'
      ? `CAST(floor(random() * ${mod}) AS BIGINT)`
      : `CAST(hash(CAST(${colId} AS VARCHAR) || '${salt}${suffix}') % ${mod} AS BIGINT)`;
  }
  // Shuffle/bootstrap: map each value to a value drawn from the column's own pool.
  function shufFrom(inputSql, col) {
    return `(${inputSql}) s, (SELECT array_agg(${col}) FILTER (WHERE ${col} IS NOT NULL) AS _a, count(${col})::BIGINT AS _n FROM (${inputSql})) p`;
  }
  function shufRepl(col, mode, salt) {
    const idx = mode === 'rand'
      ? `CAST(floor(random() * p._n) AS BIGINT)`
      : `CAST(hash(CAST(s.${col} AS VARCHAR) || '${salt}') % p._n AS BIGINT)`;
    return `CASE WHEN s.${col} IS NULL OR p._n = 0 THEN s.${col} ELSE p._a[${idx} + 1] END`;
  }

  // ---- Consistent, type-aware entity pseudonymization (analytics-preserving) ----
  const ORGN = ['Nordwind', 'Alpenbau', 'Rheindata', 'Seestern', 'Blautech', 'Sonnenhof', 'Brückner',
    'Kontor', 'Vento', 'Maintal', 'Hanse', 'Donau', 'Spree', 'Isar', 'Elbtal', 'Taunus', 'Westfalen',
    'Allgäu', 'Saturn', 'Merkur', 'Atlas', 'Orbit', 'Delta', 'Vertex', 'Pioneer', 'Horizont', 'Fokus',
    'Prime', 'Synergie', 'Matrix'];
  const FORMS = ['GmbH', 'AG', 'GmbH & Co. KG', 'KG', 'SE', 'mbH', 'UG'];
  const ORG_RE = '(GmbH|AG|KG|e\\.?V\\.?|SE|mbB|mbH|UG|gGmbH|& Co|Inc\\.?|Ltd|SARL|Pty|s\\.r\\.o)';
  const AUTH_RE = '(?i)(finanzamt|krankenkasse|AOK|sozialvers|\\bkasse\\b|stadt |gemeinde|bundes|zoll|berufsgenossenschaft)';
  function personLabel(rk) {
    const F = listLit(FK.firstName), L = listLit(FK.lastName), nf = FK.firstName.length, nl = FK.lastName.length, cap = nf * nl;
    return `${F}[((${rk} - 1) % ${nf}) + 1] || ' ' || ${L}[(CAST(floor((${rk} - 1) / ${nf}) AS BIGINT) % ${nl}) + 1]`
      + ` || CASE WHEN ${rk} > ${cap} THEN ' ' || CAST(${rk} AS VARCHAR) ELSE '' END`;
  }
  function orgLabel(rk) {
    const N = listLit(ORGN), Fo = listLit(FORMS), nn = ORGN.length, nfm = FORMS.length, cap = nn * nfm;
    return `${N}[((${rk} - 1) % ${nn}) + 1] || ' ' || ${Fo}[(CAST(floor((${rk} - 1) / ${nn}) AS BIGINT) % ${nfm}) + 1]`
      + ` || CASE WHEN ${rk} > ${cap} THEN ' ' || CAST(${rk} AS VARCHAR) ELSE '' END`;
  }
  function pseudCase(type, k) {
    const person = personLabel('rk'), org = orgLabel('rk');
    const isOrg = `regexp_matches(v, '${ORG_RE}')`, isAuth = `regexp_matches(v, '${AUTH_RE}')`;
    if (type === 'authority') return `v`;
    if (type === 'person') return `CASE ${k > 0 ? `WHEN cnt < ${k} THEN 'Weitere Personen (Sammel)' ` : ''}ELSE ${person} END`;
    if (type === 'org') return `CASE ${k > 0 ? `WHEN cnt < ${k} THEN 'Weitere Organisationen (Sammel)' ` : ''}ELSE ${org} END`;
    // auto
    const collapse = k > 0 ? `WHEN NOT ${isAuth} AND cnt < ${k} THEN (CASE WHEN ${isOrg} THEN 'Weitere Organisationen (Sammel)' ELSE 'Weitere Personen (Sammel)' END) ` : '';
    return `CASE WHEN ${isAuth} THEN v ${collapse}WHEN ${isOrg} THEN ${org} ELSE ${person} END`;
  }
  // Build the full SQL for compile / count / sample. A salted dense_rank gives a
  // stable, non-guessable, collision-free mapping per distinct value → analytics
  // (GROUP BY partner) are preserved exactly; rare entities (< k) collapse.
  function pseudoBuild(inputSql, p, salt, what) {
    const col = id(p.column), k = Number(p.k) || 0, type = p.entityType || 'auto';
    const cte = `WITH __map AS (SELECT v, cnt, rk, ${pseudCase(type, k)} AS pseud FROM (`
      + `SELECT ${col} AS v, count(*) AS cnt, dense_rank() OVER (ORDER BY hash(CAST(${col} AS VARCHAR) || '${salt}')) AS rk`
      + ` FROM (${inputSql}) WHERE ${col} IS NOT NULL GROUP BY ${col}))`;
    if (what === 'compile')
      return `${cte} SELECT s.* REPLACE (CASE WHEN s.${col} IS NULL THEN NULL ELSE m.pseud END AS ${col}) FROM (${inputSql}) s LEFT JOIN __map m ON s.${col} = m.v`;
    if (what === 'count')
      return `${cte} SELECT (SELECT count(*) FROM __map) AS entities, (SELECT count(*) FROM __map WHERE pseud LIKE 'Weitere %(Sammel)') AS collapsed, SUM(CASE WHEN s.${col} IS NOT NULL AND m.pseud IS DISTINCT FROM s.${col} THEN 1 ELSE 0 END) AS changed, COUNT(*) AS total FROM (${inputSql}) s LEFT JOIN __map m ON s.${col} = m.v`;
    return `${cte} SELECT CAST(s.${col} AS VARCHAR) AS b, CAST(m.pseud AS VARCHAR) AS a, CASE WHEN s.${col} IS NULL THEN 'noeffect' WHEN m.pseud IS DISTINCT FROM s.${col} THEN 'ok' ELSE 'noeffect' END AS cls FROM (${inputSql}) s LEFT JOIN __map m ON s.${col} = m.v LIMIT 60`;
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
    faker: {
      label: 'Faker — synthetic value', group: 'anon', impact: 'cell',
      complete: p => !!p.column && !!p.category,
      defaults: () => ({ column: firstCol(), category: 'fullName', mode: 'det' }),
      cellExpr(p, c) {
        const col = id(p.column), salt = sqlEscape((c && c.salt) || ''), mode = p.mode === 'rand' ? 'rand' : 'det';
        const pick = (suf, arr) => `${listLit(arr)}[${rndIdx(col, salt, suf, arr.length, mode)} + 1]`;
        let v;
        switch (p.category) {
          case 'firstName': v = pick('', FK.firstName); break;
          case 'lastName': v = pick('', FK.lastName); break;
          case 'city': v = pick('', FK.city); break;
          case 'country': v = pick('', FK.country); break;
          case 'company': v = pick('', FK.company); break;
          case 'street': v = `${pick('S', FK.street)} || ' ' || CAST(${rndIdx(col, salt, 'N', 150, mode)} + 1 AS VARCHAR)`; break;
          case 'email': v = `lower(${pick('F', FK.firstName)}) || '.' || lower(${pick('L', FK.lastName)}) || '@' || ${pick('D', FK.domain)}`; break;
          case 'phone': v = `'+49 ' || lpad(CAST(${rndIdx(col, salt, 'P1', 900, mode)} + 100 AS VARCHAR), 3, '0') || ' ' || lpad(CAST(${rndIdx(col, salt, 'P2', 10000000, mode)} AS VARCHAR), 7, '0')`; break;
          case 'zip': v = `lpad(CAST(${rndIdx(col, salt, 'Z', 100000, mode)} AS VARCHAR), 5, '0')`; break;
          case 'fullName': default: v = `${pick('F', FK.firstName)} || ' ' || ${pick('L', FK.lastName)}`; break;
        }
        return `CASE WHEN ${col} IS NULL THEN NULL ELSE ${v} END`;
      },
      compile(src, p, c) { return this.complete(p) ? colReplace(src, p.column, this.cellExpr(p, c)) : src; },
      title: p => `Faker · ${p.category || ''}`,
    },
    shuffle: {
      label: 'Shuffle / bootstrap', group: 'anon', impact: 'shuffle',
      complete: p => !!p.column, defaults: () => ({ column: firstCol(), mode: 'det' }),
      compile(src, p, c) {
        if (!this.complete(p)) return src;
        const col = id(p.column);
        return `SELECT s.* REPLACE (${shufRepl(col, p.mode, sqlEscape((c && c.salt) || ''))} AS ${col}) FROM ${shufFrom(src, col)}`;
      },
      title: () => 'Shuffle / bootstrap',
    },
    numRound: {
      label: 'Round / bucket (number)', group: 'col', impact: 'cast',
      complete: p => !!p.column && Number(p.step) > 0,
      defaults: () => ({ column: firstCol(), step: '100' }),
      safeExpr(p) { const k = Number(p.step) || 1; return `round(TRY_CAST(${id(p.column)} AS DOUBLE) / ${k}) * ${k}`; },
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.safeExpr(p)) : src; },
      title: p => `Round → ${p.step || '?'}`,
    },
    numNoise: {
      label: 'Add noise (number)', group: 'col', impact: 'cast',
      complete: p => !!p.column && Number(p.amount) > 0,
      defaults: () => ({ column: firstCol(), amount: '1', mode: 'det' }),
      safeExpr(p, c) {
        const col = id(p.column), amt = Number(p.amount) || 0, base = `TRY_CAST(${col} AS DOUBLE)`;
        const salt = sqlEscape((c && c.salt) || '');
        const noise = p.mode === 'rand'
          ? `(random() * 2 - 1) * ${amt}`
          : `(((hash(CAST(${col} AS VARCHAR) || '${salt}') % 2001)) / 1000.0 - 1.0) * ${amt}`;
        return `CASE WHEN ${base} IS NULL THEN NULL ELSE ${base} + ${noise} END`;
      },
      compile(src, p, c) { return this.complete(p) ? colReplace(src, p.column, this.safeExpr(p, c)) : src; },
      title: p => `Add noise ±${p.amount || '?'}`,
    },
    parseDate: {
      label: 'Parse date', group: 'col', impact: 'cast',
      complete: p => !!p.column && !!p.target,
      defaults: () => ({ column: firstCol(), formats: '', target: 'DATE', generalize: 'none' }),
      // Parse text → date/time with one or more (mixed) patterns, then optionally
      // generalize to month/quarter/year (the former "Generalize date").
      safeExpr(p) {
        const c = id(p.column), target = p.target || 'DATE';
        const fmts = parseFormats(p.formats);
        const parsed = fmts.length
          ? `try_strptime(CAST(${c} AS VARCHAR), [${fmts.map(f => `'${sqlEscape(f)}'`).join(', ')}])`
          : `TRY_CAST(${c} AS TIMESTAMP)`;
        const g = (p.generalize && p.generalize !== 'none') ? `date_trunc('${p.generalize}', ${parsed})` : parsed;
        return `CAST(${g} AS ${target})`;
      },
      compile(src, p) { return this.complete(p) ? colReplace(src, p.column, this.safeExpr(p)) : src; },
      title: p => `Parse date → ${p.target || 'DATE'}${p.generalize && p.generalize !== 'none' ? ' · ' + p.generalize : ''}`,
    },
    pseudoEntity: {
      label: 'Pseudonymize entity (consistent)', group: 'anon', impact: 'pseudo',
      complete: p => !!p.column,
      defaults: () => ({ column: firstCol(), entityType: 'auto', k: '5' }),
      compile(src, p, c) { return this.complete(p) ? pseudoBuild(src, p, sqlEscape((c && c.salt) || ''), 'compile') : src; },
      title: p => `Pseudonymize · ${p.entityType || 'auto'}`,
    },
    coarsen: {
      label: 'Coarsen amounts (sum-preserving)', group: 'anon', impact: 'coarsen',
      complete: p => !!p.column && Number(p.step) > 0,
      defaults: () => ({ column: colOr('betrag'), step: '100', groupBy: colOr('kategorie') }),
      compile(src, p) {
        if (!this.complete(p)) return src;
        const col = id(p.column), k = Number(p.step) || 1;
        const grp = (p.groupBy && p.groupBy !== 'none') ? id(p.groupBy) : '1';
        const base = `TRY_CAST(${col} AS DOUBLE)`;
        const inner = `SELECT *, round(${base}/${k})*${k} AS _rx,`
          + ` sum(${base}) OVER (PARTITION BY ${grp}) AS _gx,`
          + ` sum(round(${base}/${k})*${k}) OVER (PARTITION BY ${grp}) AS _grx,`
          + ` row_number() OVER (PARTITION BY ${grp} ORDER BY abs(${base}) DESC NULLS LAST) AS _rn FROM (${src})`;
        return `SELECT t.* EXCLUDE (_rx, _gx, _grx, _rn) REPLACE (`
          + `CASE WHEN t._rx IS NULL THEN NULL`
          + ` WHEN t._rn = 1 THEN round(t._rx + (t._gx - t._grx), 2) ELSE round(t._rx, 2) END AS ${col}) FROM (${inner}) t`;
      },
      title: p => `Coarsen → ${p.step || '?'} (sum-preserving)`,
    },
    recalcSaldo: {
      label: 'Recompute running balance', group: 'col', impact: 'struct',
      complete: p => !!p.column && !!p.amountCol,
      defaults: () => ({ column: colOr('saldo'), amountCol: colOr('betrag'), orderByCol: colOr('buchungstag'), opening: '0' }),
      compile(src, p) {
        if (!this.complete(p)) return src;
        const sc = id(p.column), ac = id(p.amountCol), oc = id(p.orderByCol || 'buchungstag'), open = Number(p.opening) || 0;
        const inner = `SELECT *, (${open} + sum(${ac}) OVER (ORDER BY ${oc} ROWS UNBOUNDED PRECEDING)) AS _sd FROM (${src})`;
        return `SELECT t.* EXCLUDE (_sd) REPLACE (round(t._sd, 2) AS ${sc}) FROM (${inner}) t`;
      },
      title: () => 'Recompute running balance',
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
    if (def.impact === 'shuffle') {
      const col = id(step.params.column), repl = shufRepl(col, step.params.mode, sqlEscape(ctx().salt || ''));
      const r = (await conn.query(`SELECT
        SUM(CASE WHEN s.${col} IS NULL THEN 1 ELSE 0 END) AS noeffect,
        SUM(CASE WHEN s.${col} IS NOT NULL AND (${repl}) IS DISTINCT FROM s.${col} THEN 1 ELSE 0 END) AS changed,
        COUNT(*) AS total FROM ${shufFrom(inputSql, col)}`)).toArray()[0];
      const total = Number(r.total || 0), changed = Number(r.changed || 0);
      return { kind: 'shuffle', changed, noEffect: Number(r.noeffect || 0), total };
    }
    if (def.impact === 'pseudo') {
      const r = (await conn.query(pseudoBuild(inputSql, step.params, sqlEscape(ctx().salt || ''), 'count'))).toArray()[0];
      return { kind: 'pseudo', entities: Number(r.entities || 0), collapsed: Number(r.collapsed || 0), changed: Number(r.changed || 0), total: Number(r.total || 0) };
    }
    if (def.impact === 'coarsen') {
      const col = id(step.params.column), k = Number(step.params.step) || 1, base = `TRY_CAST(${col} AS DOUBLE)`;
      const r = (await conn.query(`SELECT
        SUM(CASE WHEN ${base} IS NOT NULL AND round(${base}/${k})*${k} IS DISTINCT FROM ${base} THEN 1 ELSE 0 END) AS changed,
        SUM(CASE WHEN ${base} IS NULL THEN 1 ELSE 0 END) AS noeffect,
        COUNT(*) AS total FROM (${inputSql})`)).toArray()[0];
      const total = Number(r.total || 0), changed = Number(r.changed || 0);
      return { kind: 'coarsen', changed, noEffect: Number(r.noeffect || 0), total };
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
    if (imp.kind === 'shuffle') {
      return `<span class="pc-badge is-change">↻ ${fmtN(imp.changed)} reassigned</span><span class="pc-badge">• ${fmtN(imp.noEffect)} unchanged / null</span>`;
    }
    if (imp.kind === 'pseudo') {
      return `<span class="pc-badge is-change">🔒 ${fmtN(imp.entities)} entities</span>`
        + `<span class="pc-badge">${fmtN(imp.changed)} pseudonymized</span>`
        + (imp.collapsed ? `<span class="pc-badge is-fail">${fmtN(imp.collapsed)} collapsed (k)</span>` : '');
    }
    if (imp.kind === 'coarsen') {
      return `<span class="pc-badge is-change">${fmtN(imp.changed)} coarsened</span><span class="pc-badge is-ok">sum preserved</span>`;
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
    if (def.impact === 'cast' || def.impact === 'extract' || def.impact === 'cell' || def.impact === 'shuffle' || def.impact === 'pseudo') {
      let q;
      if (def.impact === 'cast' || def.impact === 'extract') {
        const expr = def.safeExpr(step.params);
        q = `SELECT CAST(${c} AS VARCHAR) AS b, CAST((${expr}) AS VARCHAR) AS a,
             CASE WHEN ${c} IS NULL THEN 'noeffect' WHEN (${expr}) IS NULL THEN 'failed' ELSE 'ok' END AS cls
             FROM (${inputSql}) LIMIT 60`;
      } else if (def.impact === 'shuffle') {
        const repl = shufRepl(c, step.params.mode, sqlEscape(ctx().salt || ''));
        q = `SELECT CAST(s.${c} AS VARCHAR) AS b, CAST((${repl}) AS VARCHAR) AS a,
             CASE WHEN s.${c} IS NULL THEN 'noeffect' WHEN (${repl}) IS DISTINCT FROM s.${c} THEN 'ok' ELSE 'noeffect' END AS cls
             FROM ${shufFrom(inputSql, c)} LIMIT 60`;
      } else if (def.impact === 'pseudo') {
        q = pseudoBuild(inputSql, step.params, sqlEscape(ctx().salt || ''), 'sample');
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
    if (step.kind === 'coarsen') return `<div class="pc-diff-note">Rounds <code>${escapeHtml(step.params.column || '')}</code> to multiples of ${escapeHtml(step.params.step || '')}, preserving the exact sum within each <code>${escapeHtml(step.params.groupBy || 'group')}</code>.</div>`;
    if (step.kind === 'recalcSaldo') return `<div class="pc-diff-note">Recomputes <code>${escapeHtml(step.params.column || '')}</code> as opening + running sum of <code>${escapeHtml(step.params.amountCol || '')}</code> ordered by <code>${escapeHtml(step.params.orderByCol || '')}</code>.</div>`;
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
  function modeSelect(sid, mode) {
    return `<div class="pc-field"><label>Mode</label><select class="qrx-select" data-step="${sid}" data-field="mode">`
      + `<option value="det" ${mode !== 'rand' ? 'selected' : ''}>Deterministic — same input → same output</option>`
      + `<option value="rand" ${mode === 'rand' ? 'selected' : ''}>Random — every row independent</option></select></div>`;
  }
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
          + `<div class="pc-diff-note">Replaces values with <code>sha256(value + salt)</code> (deterministic). NULLs stay NULL. Set a shared salt above for consistent pseudonyms.</div>`;
      case 'faker':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Category</label><select class="qrx-select" data-step="${sid}" data-field="category">`
          + [['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['city', 'City'], ['country', 'Country'], ['street', 'Street + no.'], ['company', 'Company'], ['email', 'Email (structure)'], ['phone', 'Phone (structure)'], ['zip', 'ZIP (structure)']].map(([v, l]) => `<option value="${v}" ${p.category === v ? 'selected' : ''}>${l}</option>`).join('')
          + `</select></div></div>`
          + modeSelect(sid, p.mode)
          + `<div class="pc-diff-note">Replaces values with realistic synthetic data, keeping the structure. <strong>Deterministic</strong>: same input → same fake value (joins kept). <strong>Random</strong>: every row independent (breaks linkage). NULLs stay NULL.</div>`;
      case 'shuffle':
        return `<div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + modeSelect(sid, p.mode)
          + `<div class="pc-diff-note">Replaces each value with another value drawn from <em>this column</em> — the overall distribution is preserved, the row link is broken. <strong>Deterministic</strong> = stable mapping; <strong>Random</strong> = bootstrap (fresh per run). Loads the column into memory.</div>`;
      case 'numRound':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Round to multiple of</label><input class="qrx-input" data-step="${sid}" data-field="step" type="number" min="0" step="any" value="${escapeAttr(p.step || '100')}"></div></div>`
          + `<div class="pc-diff-note">Coarsens numbers to a multiple (e.g. 100 → 0, 100, 200 …). Deterministic; keeps aggregates roughly and gives k-anonymity. Non-numbers become NULL.</div>`;
      case 'numNoise':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Noise amount (±)</label><input class="qrx-input" data-step="${sid}" data-field="amount" type="number" min="0" step="any" value="${escapeAttr(p.amount || '1')}"></div></div>`
          + modeSelect(sid, p.mode)
          + `<div class="pc-diff-note">Adds zero-centred noise; stays a number. <strong>Deterministic</strong> = stable per value; <strong>Random</strong> = fresh per run. Non-numbers become NULL.</div>`;
      case 'parseDate': {
        const presets = [
          ['DE date', 'DD.MM.YYYY'], ['US date', 'MM/DD/YYYY'], ['ISO date', 'YYYY-MM-DD'],
          ['ISO timestamp', 'YYYY-MM-DD HH:mm:ss'], ['DE date+time', 'DD.MM.YYYY HH:mm:ss'],
        ];
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Target type</label><select class="qrx-select" data-step="${sid}" data-field="target">`
          + [['DATE', 'Date'], ['TIMESTAMP', 'Timestamp (date + time)'], ['TIME', 'Time']].map(([v, l]) => `<option value="${v}" ${(p.target || 'DATE') === v ? 'selected' : ''}>${l}</option>`).join('')
          + `</select></div>`
          + `<div class="pc-field"><label>Generalize to</label><select class="qrx-select" data-step="${sid}" data-field="generalize">`
          + [['none', '— (keep exact)'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']].map(([v, l]) => `<option value="${v}" ${(p.generalize || 'none') === v ? 'selected' : ''}>${l}</option>`).join('')
          + `</select></div></div>`
          + `<div class="pc-field"><label>Date/time pattern(s) — one per line; mixed spellings are tried in order</label>`
          + `<textarea class="qrx-input" data-step="${sid}" data-field="formats" rows="2" spellcheck="false" placeholder="DD.MM.YYYY&#10;MM/DD/YYYY">${escapeHtml(p.formats || '')}</textarea>`
          + `<div class="pc-presets">` + presets.map(([lbl, pat]) => `<button type="button" class="pc-preset" data-preset="${escapeAttr(pat)}" data-step="${sid}">+ ${escapeHtml(lbl)}</button>`).join('') + `</div>`
          + `<div class="pc-diff-note">Tokens: YYYY YY · MM (month) DD · HH (24h) hh (12h) mm (min) SS — or raw strptime like <code>%d.%m.%Y</code>. Empty = automatic ISO. Unparseable values become NULL (counted as failures). <strong>Generalize</strong> reduces the parsed date to the start of the month/quarter/year.</div>`
          + `</div>`;
      }
      case 'pseudoEntity':
        return `<div class="pc-row"><div class="pc-field"><label>Column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Entity type</label><select class="qrx-select" data-step="${sid}" data-field="entityType">`
          + [['auto', 'Auto-detect'], ['person', 'Person'], ['org', 'Organization'], ['authority', 'Authority (keep)']].map(([v, l]) => `<option value="${v}" ${p.entityType === v ? 'selected' : ''}>${l}</option>`).join('')
          + `</select></div>`
          + `<div class="pc-field"><label>Collapse rare (&lt; k, 0 = off)</label><input class="qrx-input" data-step="${sid}" data-field="k" type="number" min="0" value="${escapeAttr(p.k != null ? p.k : '5')}"></div></div>`
          + `<div class="pc-diff-note">Consistent, collision-free pseudonyms (same entity → same value), so per-partner totals stay exact. Type-aware (Person/Organization keep their shape; Authorities kept). <strong>k</strong>: entities with fewer than k transactions are merged into a “Weitere … (Sammel)” bucket to prevent singling-out. Uses the salt above.</div>`;
      case 'coarsen':
        return `<div class="pc-row"><div class="pc-field"><label>Amount column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Round to multiple of</label><input class="qrx-input" data-step="${sid}" data-field="step" type="number" min="0" step="any" value="${escapeAttr(p.step || '100')}"></div>`
          + `<div class="pc-field"><label>Preserve sum within</label><select class="qrx-select" data-step="${sid}" data-field="groupBy"><option value="none" ${p.groupBy === 'none' ? 'selected' : ''}>(whole column)</option>${colOptions(p.groupBy)}</select></div></div>`
          + `<div class="pc-diff-note">Rounds amounts to remove unique fingerprints, but keeps the <strong>exact sum</strong> within each group (e.g. per category) — category/monthly totals stay. Run <em>Recompute running balance</em> afterwards so the saldo matches.</div>`;
      case 'recalcSaldo':
        return `<div class="pc-row"><div class="pc-field"><label>Balance column</label>${colSelect(sid, 'column', p.column)}</div>`
          + `<div class="pc-field"><label>Amount column</label>${colSelect(sid, 'amountCol', p.amountCol)}</div></div>`
          + `<div class="pc-row"><div class="pc-field"><label>Order by</label>${colSelect(sid, 'orderByCol', p.orderByCol)}</div>`
          + `<div class="pc-field"><label>Opening balance</label><input class="qrx-input" data-step="${sid}" data-field="opening" type="number" step="any" value="${escapeAttr(p.opening || '0')}"></div></div>`
          + `<div class="pc-diff-note">Rebuilds the running balance = opening + cumulative sum of the amount column. Use after coarsening amounts.</div>`;
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
    return `<div class="pc-step ${step.enabled ? '' : 'is-disabled'} ${step._open ? '' : 'is-collapsed'}" data-card="${step.id}">
      <div class="pc-step-head" data-step="${step.id}" title="Click to expand / collapse">
        <span class="pc-step-chev" aria-hidden="true">▸</span>
        <span class="pc-step-title">${stepTitle(step)}</span>
        <span class="pc-step-mini" id="impmini-${step.id}"></span>
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
      if (state.pii) renderPii();
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
      if (!step.enabled) { badges.innerHTML = '<span class="pc-badge">disabled</span>'; if (diff) diff.innerHTML = ''; step.impact = null; setMini(step); continue; }
      if (!def.complete(step.params)) { badges.innerHTML = '<span class="pc-badge is-pending">needs configuration</span>'; if (diff) diff.innerHTML = ''; step.impact = null; setMini(step); continue; }
      try {
        const imp = await computeImpact(step, i);
        if (seq !== state.seq) return;
        step.impact = imp;
        badges.innerHTML = impactBadges(imp);
        setMini(step);
        if (diff) diff.innerHTML = step._open ? await buildDiffHtml(step, i) : '';
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
      if (['hash', 'faker', 'shuffle', 'numNoise', 'numRound', 'pseudoEntity', 'coarsen'].includes(s.kind) && STEP_DEFS[s.kind].complete(s.params)) anon.add(s.params.column);
      if (s.kind === 'parseDate' && s.params.generalize && s.params.generalize !== 'none' && STEP_DEFS.parseDate.complete(s.params)) anon.add(s.params.column);
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
  // Which displayed columns are touched by an enabled column-based step → labels.
  function columnStepMap() {
    const m = new Map();
    const add = (name, label) => { if (!name) return; if (!m.has(name)) m.set(name, []); m.get(name).push(label); };
    for (const s of state.pipeline) {
      if (!s.enabled) continue;
      const def = STEP_DEFS[s.kind];
      if (def.group !== 'col' && def.group !== 'anon') continue;
      add(s.params && s.params.column, def.label);
      if (s.kind === 'rename' && s.params.newName) add(s.params.newName.trim(), 'renamed');
    }
    return m;
  }
  function renderGrid(res) {
    const fields = arrowFields(res.schema), rows = arrowRows(res);
    const stepMap = columnStepMap();
    let h = '<tr>'; if (!fields.length) h += '<th>—</th>';
    for (const f of fields) {
      const labels = stepMap.get(f.name);
      const has = labels && labels.length;
      const pii = state.pii && state.pii[f.name];
      const piiTag = pii
        ? `<span class="pii-tag ${PII_LEVELS[pii.type.level].cls}" title="${escapeAttr(pii.type.label + ' — ' + PII_LEVELS[pii.type.level].label + ' (detected ' + (pii.via === 'content' ? 'by content' : 'by name') + ')')}">PII</span>`
        : '';
      const tip = has ? `${f.name}\nSteps: ${labels.join(', ')}\n(click to add another rule)` : `${f.name}\nClick to add a column rule`;
      h += `<th class="${has ? 'has-steps' : ''}" title="${escapeAttr(tip)}">`
        + `<button type="button" class="pc-col-btn" data-col="${escapeAttr(f.name)}"><span class="col-name-cell">${escapeHtml(f.name)}</span>${has ? '<span class="pc-col-dot" aria-hidden="true"></span>' : ''}<span class="pc-col-caret" aria-hidden="true">▾</span></button>`
        + `<span class="col-type"><span class="type-badge ${f.typeClass}">${escapeHtml(f.type)}</span>${piiTag}</span></th>`;
    }
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
  function setMini(step) {
    const el = $(`impmini-${step.id}`); if (!el) return;
    let t = '', cls = '';
    if (!step.enabled) t = 'off';
    else if (!STEP_DEFS[step.kind].complete(step.params)) { t = 'setup'; cls = 'is-pending'; }
    else {
      const imp = step.impact;
      if (imp) {
        if (imp.kind === 'cast' || imp.kind === 'extract') { t = imp.failed ? `⚠ ${fmtN(imp.failed)}` : `✓ ${fmtN(imp.ok)}`; cls = imp.failed ? 'is-fail' : 'is-ok'; }
        else if (imp.kind === 'cell') { t = `✎ ${fmtN(imp.changed)}`; cls = 'is-change'; }
        else if (imp.kind === 'shuffle') { t = `↻ ${fmtN(imp.changed)}`; cls = 'is-change'; }
        else if (imp.kind === 'pseudo') { t = `🔒 ${fmtN(imp.entities)}${imp.collapsed ? ' · k' + fmtN(imp.collapsed) : ''}`; cls = 'is-change'; }
        else if (imp.kind === 'coarsen') { t = `≈ ${fmtN(imp.changed)}`; cls = 'is-change'; }
        else if (imp.kind === 'rows') { t = imp.removed ? `− ${fmtN(imp.removed)}` : '0'; cls = imp.removed ? 'is-fail' : ''; }
        else t = '≈';
      }
    }
    el.textContent = t;
    el.className = 'pc-step-mini ' + cls;
  }
  // Render the before→after diff for one (open, complete) step.
  function renderStepDiff(step) {
    const d = $(`imp-diff-${step.id}`); if (!d) return;
    const i = state.pipeline.indexOf(step);
    if (!step._open || !step.enabled || !STEP_DEFS[step.kind].complete(step.params)) { d.innerHTML = ''; return; }
    buildDiffHtml(step, i).then(html => { if (step._open) d.innerHTML = html; }).catch(() => {});
  }
  // Toggle a single step's collapsed state (DOM-only, no recompute).
  function toggleStep(sid) {
    const step = getStep(sid); if (!step) return;
    step._open = !step._open;
    const card = document.querySelector(`.pc-step[data-card="${sid}"]`);
    if (card) card.classList.toggle('is-collapsed', !step._open);
    if (step._open) renderStepDiff(step); else { const d = $(`imp-diff-${sid}`); if (d) d.innerHTML = ''; }
  }
  function setAllOpen(open) {
    state.pipeline.forEach(s => s._open = open);
    document.querySelectorAll('.pc-step').forEach(card => card.classList.toggle('is-collapsed', !open));
    if (open) state.pipeline.forEach(renderStepDiff);
    else document.querySelectorAll('[id^="imp-diff-"]').forEach(d => { d.innerHTML = ''; });
  }
  function addStep(kind, preset) {
    const def = STEP_DEFS[kind]; if (!def) return;
    state.pipeline.forEach(s => s._open = false);   // collapse the rest
    const step = { id: uid(), kind, enabled: true, params: Object.assign(def.defaults(), preset || {}), impact: null, _open: true };
    state.pipeline.push(step);
    renderSteps();
    scheduleRecompute();
    const card = document.querySelector(`.pc-step[data-card="${step.id}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    renderSteps();
    scheduleRecompute();
  }
  function setLayout(mode) {
    state.layout = mode;
    if (pcLayout) pcLayout.className = 'pc-layout is-' + mode;
    document.querySelectorAll('.pc-layoutbar [data-layout]').forEach(b => b.classList.toggle('is-active', b.getAttribute('data-layout') === mode));
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
      state.pipeline = []; state.page = 0; state.view = 'original'; state.cleanedSig = null;
      resetPii();
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
      setLayout('default');
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
    state.page = 0; state.cleanedSig = null;
    dropzone.hidden = false; fileInfo.hidden = true; workspace.hidden = true;
    if (analyzeResults) analyzeResults.innerHTML = '';
    resetPii();
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
  // Compact variant: collapse each run of a class to one symbol, so 9/99/999 all
  // become a single "9" (displayed as "9+", regex \d+). Groups variable lengths.
  function compactMaskedExpr(col) {
    const c = `CAST(${id(col)} AS VARCHAR)`;
    return `regexp_replace(regexp_replace(regexp_replace(${c}, '\\p{Lu}+', 'A', 'g'), '\\p{Ll}+', 'a', 'g'), '[0-9]+', '9', 'g')`;
  }
  function compactDisplay(mask) {
    let s = ''; for (const ch of mask) s += (ch === 'A' || ch === 'a' || ch === '9') ? ch + '+' : ch; return s;
  }
  // Exact: run-length → {n}. Compact: every class symbol → "+".
  function maskToRegex(mask, compact) {
    let out = '^', i = 0;
    while (i < mask.length) {
      const ch = mask[i];
      const cls = ch === 'A' ? '\\p{Lu}' : ch === 'a' ? '\\p{Ll}' : ch === '9' ? '\\d' : null;
      if (cls) {
        let n = 1; while (i + n < mask.length && mask[i + n] === ch) n++;
        out += cls + (compact ? '+' : (n > 1 ? `{${n}}` : '')); i += n;
      } else {
        out += /[.*+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch; i++;
      }
    }
    return out + '$';
  }

  let lastAnalyze = null, analyzeMode = 'exact';
  async function groupPatterns(c, expr) {
    const res = await conn.query(`WITH m AS (SELECT ${expr} AS pat, CAST(${c} AS VARCHAR) AS ex FROM original WHERE ${c} IS NOT NULL)
      SELECT pat, count(*)::BIGINT AS c, min(ex) AS example FROM m GROUP BY pat ORDER BY c DESC LIMIT 30`);
    const distinct = Number((await conn.query(`SELECT count(DISTINCT ${expr})::BIGINT AS c FROM original WHERE ${c} IS NOT NULL`)).toArray()[0].c);
    return { rows: res.toArray().map(r => ({ pat: r.pat, c: Number(r.c), example: r.example == null ? '' : String(r.example) })), distinct };
  }
  async function runAnalyze() {
    const col = analyzeCol.value;
    if (!col || !conn) return;
    analyzeBtn.disabled = true;
    analyzeResults.innerHTML = '<p class="pc-diff-note">Analyzing…</p>';
    try {
      const c = id(col);
      const exact = await groupPatterns(c, maskedExpr(col));
      const compact = await groupPatterns(c, compactMaskedExpr(col));
      const nulls = Number((await conn.query(`SELECT count(*)::BIGINT AS c FROM original WHERE ${c} IS NULL`)).toArray()[0].c);
      lastAnalyze = { col, exact, compact, nulls, total: state.rowCountOriginal || 1 };
      renderAnalyze();
    } catch (err) {
      console.error(err);
      lastAnalyze = null;
      analyzeResults.innerHTML = `<p class="pc-diff-note" style="color:var(--qrx-danger)">Analysis failed: ${escapeHtml(err && err.message ? err.message : String(err))}</p>`;
    } finally {
      analyzeBtn.disabled = false;
    }
  }
  function renderAnalyze() {
    if (!lastAnalyze) { analyzeResults.innerHTML = ''; return; }
    const { col, nulls, total } = lastAnalyze;
    const compact = analyzeMode === 'compact';
    const data = compact ? lastAnalyze.compact : lastAnalyze.exact;
    let html = `<div class="pc-toggle pc-pat-toggle">`
      + `<button type="button" class="qrx-btn qrx-btn-sm ${!compact ? 'is-active' : ''}" data-mode="exact">Exact length</button>`
      + `<button type="button" class="qrx-btn qrx-btn-sm ${compact ? 'is-active' : ''}" data-mode="compact">Compact (\\d+)</button></div>`;
    html += `<div class="pc-pat-meta">Column <strong>${escapeHtml(col)}</strong> · ${fmtN(data.distinct)} distinct ${compact ? 'compact ' : ''}pattern(s)`
      + (data.distinct > data.rows.length ? ` (showing top ${data.rows.length})` : '') + ` · ${fmtN(nulls)} null</div>`;
    html += '<table class="pc-pat-table"><thead><tr><th>Pattern</th><th>Count</th><th>Share</th><th>Example</th><th>Regex</th></tr></thead><tbody>';
    for (const r of data.rows) {
      const share = r.c / total * 100;
      const isEmpty = r.pat === '';
      const mask = isEmpty ? '∅ (empty)' : (compact ? compactDisplay(r.pat) : r.pat);
      const rx = isEmpty ? '^$' : maskToRegex(r.pat, compact);
      html += `<tr><td class="pc-pat-mask">${escapeHtml(mask)}</td>`
        + `<td>${fmtN(r.c)}</td>`
        + `<td><div class="pc-pat-share"><span class="pc-pat-bar" style="width:${Math.max(2, Math.round(share))}px"></span>${share.toFixed(1)}%</div></td>`
        + `<td class="pc-pat-ex" title="${escapeAttr(r.example)}">${escapeHtml(r.example)}</td>`
        + `<td class="pc-pat-rx">${escapeHtml(rx)} <button type="button" class="pc-copy" data-copy="${escapeAttr(rx)}" title="Copy regex">copy</button></td></tr>`;
    }
    if (nulls) html += `<tr class="pc-pat-muted"><td>(null)</td><td>${fmtN(nulls)}</td><td>${(nulls / total * 100).toFixed(1)}%</td><td></td><td></td></tr>`;
    html += '</tbody></table>';
    html += `<div class="pc-diff-note">Mask: <code>A</code> uppercase · <code>a</code> lowercase · <code>9</code> digit · other characters kept literally (Unicode letters incl. umlauts). `
      + `<strong>Exact length</strong> keeps the run length (<code>999</code> ⇒ <code>\\d{3}</code>); <strong>Compact</strong> collapses any run (<code>9+</code> ⇒ <code>\\d+</code>). Copy the derived regex into a Regex step.</div>`;
    analyzeResults.innerHTML = html;
  }

  // ---- PII / sensitive-data detection (heuristic: column name + content sample) ----
  const PII_LEVELS = {
    direct:    { label: 'Direct identifier', cls: 'pii-direct' },
    quasi:     { label: 'Quasi-identifier',  cls: 'pii-quasi' },
    sensitive: { label: 'Sensitive (special category)', cls: 'pii-sensitive' },
  };
  function luhn(s) {
    s = s.replace(/\D/g, ''); if (s.length < 13) return false;
    let sum = 0, alt = false;
    for (let i = s.length - 1; i >= 0; i--) { let n = +s[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
    return sum % 10 === 0;
  }
  // Each type: name (regex on lowercased column name), optional content (value→bool),
  // level, and a suggested anonymization step. Content match (≥60% of sampled values) wins over name.
  const PII_TYPES = [
    // -- content-detectable (strong signal) --
    { key: 'email', label: 'Email address', level: 'direct',
      name: /e[\W_]?mail/i, content: s => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s),
      suggest: c => ({ kind: 'faker', params: { column: c, category: 'email', mode: 'det' } }) },
    { key: 'iban', label: 'IBAN / bank account', level: 'direct',
      name: /\biban\b|\bbic\b|kontonummer|konto[\W_]?nr|account[\W_]?(no|number|nr)/i,
      content: s => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s.replace(/\s+/g, '').toUpperCase()),
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    { key: 'phone', label: 'Phone number', level: 'direct',
      name: /telefon|\btel\b|\bfon\b|phone|mobil|handy|\bfax\b/i,
      content: s => {
        const t = s.trim();
        // exclude date / datetime strings that also consist of digits + separators
        if (/^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}.*)?$/.test(t)) return false;
        if (/^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/.test(t)) return false;
        if (/^\d{4}[.\/]\d{1,2}[.\/]\d{1,2}$/.test(t)) return false;
        if (!/^[+(]?\d[\d\s()\/.\-]{6,}$/.test(t)) return false;
        const d = t.replace(/\D/g, '');
        return d.length >= 7 && d.length <= 15 && (/[+()\/\-\s]/.test(t) || t[0] === '0' || t[0] === '+');
      },
      suggest: c => ({ kind: 'faker', params: { column: c, category: 'phone', mode: 'det' } }) },
    { key: 'creditcard', label: 'Credit card number', level: 'direct',
      name: /kreditkart|credit[\W_]?card|card[\W_]?(no|number)|kartennummer/i,
      content: s => { const d = s.replace(/[\s\-]/g, ''); return /^\d{13,19}$/.test(d) && luhn(d); },
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    { key: 'uuid', label: 'Unique identifier (UUID)', level: 'direct',
      name: /\buuid\b|\bguid\b/i, content: s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim()),
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    { key: 'ip', label: 'IP address', level: 'quasi',
      name: /\bip[\W_]?(addr|adresse|address)?\b/i,
      content: s => /^(\d{1,3}\.){3}\d{1,3}$/.test(s.trim()) && s.trim().split('.').every(o => +o <= 255),
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    // -- name-only direct identifiers --
    // Recurring business party (partner/recipient): pseudonymize keeps per-entity
    // aggregates exact while bucketing the rare long tail (k-anonymity). Checked first.
    { key: 'partyname', label: 'Business party / recipient', level: 'direct',
      name: /beg[uü]nstigt|empf[aä]nger|zahlungspflicht|\bpartner\b|inhaber|kontoinhaber|holder|lieferant|vendor|supplier|debitor|kreditor/i,
      suggest: c => ({ kind: 'pseudoEntity', params: { column: c, entityType: 'auto', k: '5' } }) },
    // Plain person/customer name (mostly unique) → realistic fake name, deterministic.
    { key: 'personname', label: 'Person / customer name', level: 'direct',
      name: /(vor|nach|nick|spitz|familien)[\W_]?name|first[\W_]?name|last[\W_]?name|sur[\W_]?name|full[\W_]?name|name\b|kunde|customer[\W_]?name|ansprechpartner|kontaktperson/i,
      suggest: c => {
        const l = c.toLowerCase();
        const cat = /vor|first/.test(l) ? 'firstName' : (/nach|last|sur|familien/.test(l) ? 'lastName' : 'fullName');
        return { kind: 'faker', params: { column: c, category: cat, mode: 'det' } };
      } },
    { key: 'govid', label: 'Government / tax ID', level: 'direct',
      name: /\bssn\b|sozialvers|steuer[\W_]?(id|nr|nummer)|tax[\W_]?id|\bvat\b|ust[\W_]?id|personalausweis|\bausweis\b|reisepass|passport|\bnino\b/i,
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    { key: 'address', label: 'Street address', level: 'direct',
      name: /stra(ss|ß)e\b|\bstreet\b|adresse|address|anschrift|hausnummer/i,
      suggest: c => ({ kind: 'faker', params: { column: c, category: 'street', mode: 'det' } }) },
    { key: 'customerid', label: 'Customer / personal ID', level: 'direct',
      name: /^id$|kunden[\W_]?(id|nummer|nr)|customer[\W_]?(id|no|number)|personal[\W_]?nr|mitarbeiter[\W_]?(id|nr)|user[\W_]?id|benutzer[\W_]?id|patient[\W_]?(id|nr)/i,
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    // -- quasi-identifiers --
    { key: 'birthdate', label: 'Date of birth', level: 'quasi',
      name: /geb(urts)?[\W_]?(datum|tag)?|\bdob\b|date[\W_]?of[\W_]?birth|birth[\W_]?date|geboren/i,
      suggest: c => ({ kind: 'parseDate', params: { column: c, target: 'DATE', generalize: 'year', formats: '' } }) },
    { key: 'zip', label: 'Postal code', level: 'quasi',
      name: /\bplz\b|postleitzahl|\bzip\b|postal[\W_]?code/i,
      suggest: c => ({ kind: 'faker', params: { column: c, category: 'zip', mode: 'det' } }) },
    { key: 'city', label: 'City / place', level: 'quasi',
      name: /\bort\b|wohnort|\bstadt\b|\bcity\b|gemeinde|\btown\b/i,
      suggest: c => ({ kind: 'faker', params: { column: c, category: 'city', mode: 'det' } }) },
    { key: 'gender', label: 'Gender / salutation', level: 'quasi',
      name: /geschlecht|gender|\bsex\b|anrede|salutation/i,
      suggest: c => ({ kind: 'shuffle', params: { column: c, mode: 'det' } }) },
    { key: 'age', label: 'Age', level: 'quasi',
      name: /\balter\b|\bage\b|jahrgang/i,
      suggest: c => ({ kind: 'numRound', params: { column: c, step: '5' } }) },
    { key: 'nationality', label: 'Nationality / origin', level: 'quasi',
      name: /nationalit|staatsang|staatsb[uü]rger|\bcountry\b|herkunft|ethni/i,
      suggest: c => ({ kind: 'faker', params: { column: c, category: 'country', mode: 'det' } }) },
    { key: 'marital', label: 'Marital status', level: 'quasi',
      name: /familienstand|marital/i,
      suggest: c => ({ kind: 'shuffle', params: { column: c, mode: 'det' } }) },
    // -- sensitive / special categories --
    { key: 'health', label: 'Health data', level: 'sensitive',
      name: /diagnos|krankheit|\bkrank\b|health|gesundheit|medik|behandlung|\bicd\b|allerg|disab|behinder|\bpfleg/i,
      suggest: c => ({ kind: 'hash', params: { column: c } }) },
    { key: 'religion', label: 'Religion / belief', level: 'sensitive',
      name: /religion|konfession|glaube/i,
      suggest: c => ({ kind: 'shuffle', params: { column: c, mode: 'det' } }) },
    { key: 'political', label: 'Political / union', level: 'sensitive',
      name: /\bpartei\b|politic|gewerkschaft/i,
      suggest: c => ({ kind: 'shuffle', params: { column: c, mode: 'det' } }) },
    { key: 'income', label: 'Income / salary', level: 'sensitive',
      name: /gehalt|salary|einkommen|income|\blohn\b|verdienst|bonus/i,
      suggest: c => ({ kind: 'numRound', params: { column: c, step: '1000' } }) },
  ];
  function resetPii() {
    state.pii = null;
    if (piiResults) piiResults.innerHTML = '';
    if (piiSummary) piiSummary.textContent = '';
    if (piiApplyAllBtn) piiApplyAllBtn.hidden = true;
    const k = $('sumPii'); if (k) k.textContent = '—';
  }
  async function scanPII() {
    if (!conn || !state.schema.length) return;
    piiScanBtn.disabled = true;
    piiResults.innerHTML = '<p class="pc-diff-note">Scanning columns…</p>';
    try {
      let sample;
      try { sample = arrowRows(await conn.query('SELECT * FROM original USING SAMPLE 200 ROWS')); }
      catch (_) { sample = arrowRows(await conn.query('SELECT * FROM original LIMIT 200')); }
      const det = {};
      for (const col of state.schema) {
        const name = col.name, lname = name.toLowerCase();
        const vals = sample.map(r => r[name]).filter(v => v != null).map(v => cellText(v, col.type).trim()).filter(v => v !== '');
        let found = null, via = null, conf = 0;
        if (vals.length >= 5) {
          let bestRatio = 0;
          for (const t of PII_TYPES) {
            if (!t.content) continue;
            let m = 0; for (const v of vals) if (t.content(v)) m++;
            const ratio = m / vals.length;
            if (ratio >= 0.6 && ratio > bestRatio) { found = t; via = 'content'; conf = ratio; bestRatio = ratio; }
          }
        }
        if (!found) {
          for (const t of PII_TYPES) { if (t.name && t.name.test(lname)) { found = t; via = 'name'; conf = 1; break; } }
        }
        if (found) det[name] = { type: found, via, conf };
      }
      state.pii = det;
      renderPii();
      renderPreview().catch(e => console.error(e));
    } catch (err) {
      console.error(err);
      piiResults.innerHTML = `<p class="pc-diff-note" style="color:var(--qrx-danger)">Scan failed: ${escapeHtml(err && err.message ? err.message : String(err))}</p>`;
    } finally {
      piiScanBtn.disabled = false;
    }
  }
  function renderPii() {
    const det = state.pii;
    const k = $('sumPii');
    if (!det) { piiResults.innerHTML = ''; piiSummary.textContent = ''; piiApplyAllBtn.hidden = true; if (k) k.textContent = '—'; return; }
    const entries = Object.entries(det);
    if (k) k.textContent = fmtN(entries.length);
    if (!entries.length) {
      piiResults.innerHTML = '<p class="pc-diff-note">No PII-looking columns detected. This is a heuristic — always sanity-check manually.</p>';
      piiSummary.textContent = ''; piiApplyAllBtn.hidden = true; return;
    }
    const stepMap = columnStepMap();
    const byLevel = { direct: [], quasi: [], sensitive: [] };
    for (const [col, d] of entries) byLevel[d.type.level].push([col, d]);
    let html = '', pending = 0;
    for (const lvl of ['direct', 'quasi', 'sensitive']) {
      const list = byLevel[lvl]; if (!list.length) continue;
      const L = PII_LEVELS[lvl];
      html += `<div class="pc-pii-group"><div class="pc-pii-grouphead"><span class="pii-badge ${L.cls}">${escapeHtml(L.label)}</span> <span class="muted">${list.length} column(s)</span></div>`;
      for (const [col, d] of list) {
        const handled = stepMap.has(col);
        if (!handled) pending++;
        const sug = d.type.suggest(col), sdef = STEP_DEFS[sug.kind];
        html += `<div class="pc-pii-row ${handled ? 'is-handled' : ''}">`
          + `<div class="pc-pii-col"><span class="pc-pii-name">${escapeHtml(col)}</span>`
          + `<span class="pc-pii-type">${escapeHtml(d.type.label)}</span>`
          + `<span class="pc-pii-via">${d.via === 'content' ? 'by content · ' + Math.round(d.conf * 100) + '%' : 'by name'}</span></div>`
          + `<div class="pc-pii-action">`
          + (handled
            ? `<span class="pc-pii-done">✓ rule added</span>`
            : `<span class="pc-pii-suggest" title="Suggested rule">→ ${escapeHtml(sdef.label)}</span><button type="button" class="qrx-btn qrx-btn-sm" data-pii-apply="${escapeAttr(col)}">Apply</button>`)
          + `</div></div>`;
      }
      html += `</div>`;
    }
    piiResults.innerHTML = html;
    piiSummary.textContent = `${entries.length} PII column(s) · ${pending} without a rule`;
    piiApplyAllBtn.hidden = pending === 0;
  }
  function applyPiiSuggestion(col) {
    const d = state.pii && state.pii[col]; if (!d) return;
    const sug = d.type.suggest(col);
    if (state.layout === 'preview') setLayout('split');
    addStep(sug.kind, sug.params);
    renderPii();
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
  if (piiScanBtn) piiScanBtn.addEventListener('click', scanPII);
  if (piiResults) piiResults.addEventListener('click', e => {
    const b = e.target.closest('[data-pii-apply]'); if (!b) return;
    applyPiiSuggestion(b.getAttribute('data-pii-apply'));
  });
  if (piiApplyAllBtn) piiApplyAllBtn.addEventListener('click', () => {
    if (!state.pii) return;
    const stepMap = columnStepMap();
    for (const [col, d] of Object.entries(state.pii)) {
      if (stepMap.has(col)) continue;
      const sug = d.type.suggest(col);
      addStep(sug.kind, sug.params);
    }
    renderPii();
  });
  if (analyzeResults) analyzeResults.addEventListener('click', e => {
    const mb = e.target.closest('[data-mode]');
    if (mb) { analyzeMode = mb.getAttribute('data-mode'); renderAnalyze(); return; }
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
      scheduleRecompute();
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
      scheduleRecompute();
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
    if (head) toggleStep(head.getAttribute('data-step'));
  });

  // Expand / collapse all
  if (expandAllBtn) expandAllBtn.addEventListener('click', () => setAllOpen(true));
  if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => setAllOpen(false));

  // Layout switcher
  document.querySelectorAll('.pc-layoutbar [data-layout]').forEach(b =>
    b.addEventListener('click', () => setLayout(b.getAttribute('data-layout'))));

  // ---- Add a column rule straight from the preview header ----
  let colMenuEl = null;
  function closeColMenu() { if (colMenuEl) { colMenuEl.remove(); colMenuEl = null; document.removeEventListener('click', onDocClick, true); } }
  function onDocClick(e) { if (colMenuEl && !colMenuEl.contains(e.target) && !e.target.closest('.pc-col-btn')) closeColMenu(); }
  // Grouped rules for the per-column popover (sensible intent-based sections).
  const COL_MENU_GROUPS = [
    ['Convert / parse', ['cast', 'parseNumber', 'parseDate']],
    ['Clean text', ['trim', 'case', 'emptyToNull', 'regexReplace', 'regexExtract']],
    ['Anonymize / pseudonymize', ['pseudoEntity', 'faker', 'hash', 'shuffle', 'numRound', 'numNoise', 'coarsen']],
    ['Column / structure', ['rename', 'drop', 'recalcSaldo']],
  ];
  function openColMenu(anchor, col) {
    closeColMenu();
    const el = document.createElement('div');
    el.className = 'pc-colmenu';
    let html = `<div class="pc-colmenu-title">Add rule for <strong>${escapeHtml(col)}</strong></div>`;
    for (const [label, kinds] of COL_MENU_GROUPS) {
      const avail = kinds.filter(k => STEP_DEFS[k]);
      if (!avail.length) continue;
      html += `<div class="pc-colmenu-sec">${escapeHtml(label)}</div>`
        + avail.map(k => `<button type="button" class="pc-colmenu-item" data-kind="${k}">${escapeHtml(STEP_DEFS[k].label)}</button>`).join('');
    }
    el.innerHTML = html;
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 220;
    el.style.top = (r.bottom + 4 + window.scrollY) + 'px';
    el.style.left = (Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
    el.addEventListener('click', ev => {
      const b = ev.target.closest('[data-kind]'); if (!b) return;
      const kind = b.getAttribute('data-kind');
      closeColMenu();
      if (state.layout === 'preview') setLayout('split');   // make the pipeline visible
      addStep(kind, { column: col });
    });
    colMenuEl = el;
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  }
  previewGrid.addEventListener('click', e => {
    const b = e.target.closest('.pc-col-btn');
    if (b) { e.stopPropagation(); openColMenu(b, b.getAttribute('data-col')); }
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
    scheduleRecompute();
  }
  stepsList.addEventListener('change', onField);
  stepsList.addEventListener('input', onField);

})();
