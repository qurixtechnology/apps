// === App logic: Parquet Validator ===
// Load a file → build a ruleset → validate → report. The validation engine is
// the shared module qrx.rules (src/shared/qrx-rules.js); this app owns the
// rule-builder UI, the report, and the source loading. The source is always a
// view named `data`; reference tables are views named ref_<n>.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = qrx.core.escapeHtml;
  const fmtBytes = qrx.core.fmt.bytes;
  const fmtN = (n) => qrx.core.fmt.number(n, qrx.i18n.locale());

  // ---------------------------------------------------------------- DOM refs
  const dropzoneEl = $('dropzone');
  const filePicker = $('filePicker');
  const srvConnectBtn = $('srvConnectBtn');
  const workspace = $('workspace');
  const refCard = $('refCard');
  const refList = $('refList');
  const refPicker = $('refPicker');
  const addRefBtn = $('addRefBtn');
  const previewMetaEl = $('previewMeta');
  const previewGridEl = $('previewGrid');
  const previewPagerEl = $('previewPager');
  const rulesList = $('rulesList');
  const suggestBtn = $('suggestBtn');
  const addRuleBtn = $('addRuleBtn');
  const validateBtn = $('validateBtn');
  const saveRulesetBtn = $('saveRulesetBtn');
  const loadRulesetBtn = $('loadRulesetBtn');
  const rulesetPicker = $('rulesetPicker');
  const resultsCard = $('resultsCard');
  const resultsSummary = $('resultsSummary');
  const resultsList = $('resultsList');
  const exportReportBtn = $('exportReportBtn');

  // ---------------------------------------------------------------- widgets
  const fileBar = qrx.ui.fileInfo($('fileInfo'), { onReset: () => resetAll() });
  const statusWidget = qrx.ui.status($('statusBar'));
  const setStatus = (text, kind) => statusWidget.set(text, kind);
  const PREVIEW_PAGE = 100;
  const previewGrid = qrx.ui.resultGrid(previewGridEl, { localeNumbers: true });
  const previewPager = qrx.ui.pager(previewPagerEl, { pageSize: PREVIEW_PAGE, onPage: (p) => renderPreview(p) });

  // ---------------------------------------------------------------- i18n
  qrx.i18n.register('app', {
    de: {
      dropTitle: 'Parquet-Datei hier ablegen oder klicken',
      dropAria: 'Parquet-Datei hier ablegen oder klicken',
      dropFormats: 'Parquet — bis ~1 GB · oder eine DuckDB-Verbindung',
      previewTitle: 'Vorschau', previewRows: 'erste {n} von {total} Zeilen',
      connectBtn: 'Mit DuckDB verbinden', connectBtnHint: 'Eine Tabelle von einem laufenden DuckDB-Server lesen',
      refTitle: 'Referenztabellen', refHint: 'für Referenz-/Fremdschlüsselregeln', addRef: '+ Referenz-Parquet',
      rulesTitle: 'Regeln', suggest: 'Regeln vorschlagen', suggestHint: 'Regeln aus einem Schnellprofil vorschlagen',
      addRule: '+ Regel', rulesEmpty: 'Noch keine Regeln. Füge eine hinzu oder lass sie vorschlagen.',
      validate: 'Validieren', saveRuleset: 'Regelsatz speichern', loadRuleset: 'Regelsatz laden',
      resultTitle: 'Ergebnis', exportReport: 'Bericht ⤓', exportReportHint: 'Bericht als Markdown herunterladen',
      loading: 'Wird geladen …', analysing: 'Profil wird erstellt …', validating: 'Wird validiert …',
      loadFailed: 'Laden fehlgeschlagen: {msg}', validateFailed: 'Validierung fehlgeschlagen: {msg}',
      unsupported: 'Nur Parquet-Dateien. Für andere Formate den Table-Format-Converter nutzen.',
      column: 'Spalte', ruleType: 'Regel', params: 'Parameter', severity: 'Schweregrad', error: 'Fehler', warning: 'Warnung',
      remove: 'Entfernen',
      // rule type labels
      'type.not_null': 'Nicht null', 'type.unique': 'Eindeutig', 'type.allowed': 'Erlaubte Werte',
      'type.range': 'Wertebereich', 'type.length': 'Länge', 'type.regex': 'Regex',
      'type.pattern': 'Dominantes Muster', 'type.castable': 'Typ-castbar', 'type.trimmed': 'Getrimmt',
      'type.reference': 'Referenz', 'type.sql': 'Eigenes SQL', 'type.row_count': 'Zeilenzahl',
      // param labels/placeholders
      pAllowed: 'Werte, kommagetrennt', pMin: 'min', pMax: 'max', pExclusive: 'exklusiv',
      pRegex: 'z. B. ^[^@]+@[^@]+\\.[^@]+$', pMode: 'Modus', modeExact: 'exakt', modeCompact: 'kompakt',
      pCastType: 'Zieltyp', pRefTable: 'Referenztabelle', pRefCol: 'Spalte',
      pSql: 'boolescher SQL-Ausdruck je Zeile', pSqlLabel: 'Bezeichnung (optional)',
      noColumns: 'keine Spalten', noRefs: 'keine Referenztabellen — oben hinzufügen',
      // results
      valid: 'gültig', violationsWord: 'Verstöße', score: 'Score', rowsWord: 'Zeilen',
      showRows: 'Zeilen', pass: 'erfüllt', skipped: 'übersprungen (kein dominantes Muster)',
      runRule: 'Regel ausführen', showSql: 'SQL anzeigen', copy: 'kopieren', copied: 'kopiert',
      noSql: 'Kein SQL für diese Regel.',
      noSample: 'Keine Beispielzeilen.', allPass: 'Alle Regeln erfüllt.',
      suggestNone: 'Keine Vorschläge — die Spalten wirken unauffällig.',
      needRules: 'Zuerst mindestens eine Regel hinzufügen.',
      reportTitle: 'Validierungsbericht',
    },
    en: {
      dropTitle: 'Drop a Parquet file here or click', dropAria: 'Drop a Parquet file here or click',
      dropFormats: 'Parquet — up to ~1 GB · or a DuckDB connection',
      previewTitle: 'Preview', previewRows: 'first {n} of {total} rows',
      connectBtn: 'Connect with DuckDB', connectBtnHint: 'Read a table from a running DuckDB server',
      refTitle: 'Reference tables', refHint: 'for reference / foreign-key rules', addRef: '+ Reference Parquet',
      rulesTitle: 'Rules', suggest: 'Suggest rules', suggestHint: 'Propose rules from a quick profile',
      addRule: '+ Rule', rulesEmpty: 'No rules yet. Add one or let them be suggested.',
      validate: 'Validate', saveRuleset: 'Save ruleset', loadRuleset: 'Load ruleset',
      resultTitle: 'Result', exportReport: 'Report ⤓', exportReportHint: 'Download the report as Markdown',
      loading: 'Loading …', analysing: 'Profiling …', validating: 'Validating …',
      loadFailed: 'Load failed: {msg}', validateFailed: 'Validation failed: {msg}',
      unsupported: 'Parquet files only. Use the Table Format Converter for other formats.',
      column: 'Column', ruleType: 'Rule', params: 'Parameters', severity: 'Severity', error: 'Error', warning: 'Warning',
      remove: 'Remove',
      'type.not_null': 'Not null', 'type.unique': 'Unique', 'type.allowed': 'Allowed values',
      'type.range': 'Range', 'type.length': 'Length', 'type.regex': 'Regex',
      'type.pattern': 'Dominant pattern', 'type.castable': 'Type-castable', 'type.trimmed': 'Trimmed',
      'type.reference': 'Reference', 'type.sql': 'Custom SQL', 'type.row_count': 'Row count',
      pAllowed: 'values, comma-separated', pMin: 'min', pMax: 'max', pExclusive: 'exclusive',
      pRegex: 'e.g. ^[^@]+@[^@]+\\.[^@]+$', pMode: 'mode', modeExact: 'exact', modeCompact: 'compact',
      pCastType: 'target type', pRefTable: 'reference table', pRefCol: 'column',
      pSql: 'boolean SQL expression per row', pSqlLabel: 'label (optional)',
      noColumns: 'no columns', noRefs: 'no reference tables — add one above',
      valid: 'valid', violationsWord: 'violations', score: 'Score', rowsWord: 'rows',
      showRows: 'Rows', pass: 'passed', skipped: 'skipped (no dominant pattern)',
      runRule: 'Run rule', showSql: 'Show SQL', copy: 'copy', copied: 'copied',
      noSql: 'No SQL for this rule.',
      noSample: 'No sample rows.', allPass: 'All rules passed.',
      suggestNone: 'No suggestions — the columns look unremarkable.',
      needRules: 'Add at least one rule first.',
      reportTitle: 'Validation report',
    },
  });
  const t = (k, p) => qrx.i18n.t('app.' + k, p);

  const RULE_TYPES = ['not_null', 'unique', 'allowed', 'range', 'length', 'regex',
    'pattern', 'castable', 'trimmed', 'reference', 'sql', 'row_count'];
  const COL_SCOPED = new Set(['not_null', 'unique', 'allowed', 'range', 'length',
    'regex', 'pattern', 'castable', 'trimmed', 'reference']);
  const CAST_TYPES = ['INTEGER', 'BIGINT', 'DOUBLE', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'TIME', 'UUID'];

  // ---------------------------------------------------------------- state
  const state = {
    duckdb: null, db: null, conn: null,
    fileName: null, columns: [], total: 0,
    refs: [],          // [{name, view, columns:[{name,category}]}]
    refSeq: 0,
    lastReport: null,
  };
  const q = (sql) => state.conn.query(sql);

  function getColCategory(type) {
    const ty = String(type).toUpperCase();
    if (/^(BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT)\b/.test(ty)) return 'integer';
    if (/^(DOUBLE|FLOAT|REAL|DECIMAL)/.test(ty)) return 'numeric';
    if (/^(VARCHAR|TEXT|STRING|CHAR|UUID)/.test(ty)) return 'string';
    if (/^(DATE|TIMESTAMP|TIME|INTERVAL)/.test(ty)) return 'temporal';
    if (ty === 'BOOLEAN') return 'boolean';
    if (/^(BLOB|BINARY|BIT)/.test(ty)) return 'binary';
    if (/^(STRUCT|MAP|LIST|ARRAY)/.test(ty) || ty.endsWith('[]')) return 'complex';
    return 'other';
  }

  // ---------------------------------------------------------------- DuckDB
  let dbInitPromise = null;
  function initDuckDB() {
    if (dbInitPromise) return dbInitPromise;
    dbInitPromise = qrx.duckdb.init({ onStatus: setStatus }).then(() => {
      state.duckdb = qrx.duckdb.duckdb();
      state.db = qrx.duckdb.db();
      state.conn = qrx.duckdb.conn();
    }).catch((e) => { dbInitPromise = null; throw e; });
    return dbInitPromise;
  }

  function isParquet(file) {
    return /\.(parquet|pq)$/.test(file.name.toLowerCase());
  }
  function srcExpr(vname) {
    return `read_parquet('${qrx.duckdb.esc(vname)}')`;
  }
  async function registerSource(file, vname) {
    if (file.size <= 64 * 1024 * 1024) {
      const buf = new Uint8Array(await file.arrayBuffer());
      await state.db.registerFileBuffer(vname, buf);
    } else {
      await state.db.registerFileHandle(vname, file,
        state.duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    }
  }
  async function describe(viewName) {
    const d = qrx.duckdb.rows(await q(`DESCRIBE ${qrx.duckdb.ident(viewName)}`));
    return d.map((r) => ({ name: r.column_name, category: getColCategory(r.column_type), type: r.column_type }));
  }

  // ---------------------------------------------------------------- load
  async function loadFile(file) {
    if (!isParquet(file)) { setStatus(t('unsupported'), 'error'); return; }
    qrxTest.state('busy');
    try {
      await initDuckDB();
      setStatus(t('loading'));
      const vname = `src_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await registerSource(file, vname);
      await q(`CREATE OR REPLACE VIEW data AS SELECT * FROM ${srcExpr(vname)}`);
      state.columns = await describe('data');
      state.total = Number(qrx.duckdb.rows(await q('SELECT count(*)::BIGINT AS c FROM data'))[0].c);
      state.fileName = file.name;
      await afterSourceLoaded(file.name, fmtBytes(file.size));
    } catch (e) {
      console.error(e);
      setStatus(t('loadFailed', { msg: (e && e.message) || String(e) }), 'error');
    } finally {
      qrxTest.state('ready'); qrxTest.tick('load');
    }
  }

  async function afterSourceLoaded(name, sizeMeta) {
    dropzoneEl.hidden = true;
    workspace.hidden = false;
    resultsCard.hidden = true;
    fileBar.show({ icon: 'PRQ', name, meta: `${fmtN(state.columns.length)} ${t('column')} · ${fmtN(state.total)} ${t('rowsWord')}${sizeMeta ? ' · ' + sizeMeta : ''}` });
    setStatus('');
    await renderPreview(0);
    if (!rulesList.children.length) addRule();
  }

  // First rows of the loaded source, paged, via the shared grid + pager.
  async function renderPreview(page) {
    try {
      const res = await q(`SELECT * FROM data LIMIT ${PREVIEW_PAGE} OFFSET ${page * PREVIEW_PAGE}`);
      const got = previewGrid.render(res);
      previewPager.set({ page, total: state.total, got });
      previewMetaEl.textContent = t('previewRows', {
        n: fmtN(Math.min(PREVIEW_PAGE, state.total)), total: fmtN(state.total),
      });
    } catch (e) { console.error(e); }
  }

  function resetAll() {
    state.columns = []; state.total = 0; state.fileName = null; state.refs = []; state.lastReport = null;
    rulesList.innerHTML = ''; refList.innerHTML = ''; resultsList.innerHTML = ''; resultsSummary.innerHTML = '';
    previewGrid.clear(); previewPager.hide(); previewMetaEl.textContent = '';
    workspace.hidden = true; resultsCard.hidden = true; dropzoneEl.hidden = false;
    fileBar.hide(); setStatus('');
  }

  // ---------------------------------------------------------------- reference tables
  async function loadReference(file) {
    if (!isParquet(file)) { setStatus(t('unsupported'), 'error'); return; }
    qrxTest.state('busy');
    try {
      await initDuckDB();
      const id = ++state.refSeq;
      const view = `ref_${id}`;
      const vname = `${view}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await registerSource(file, vname);
      await q(`CREATE OR REPLACE VIEW ${view} AS SELECT * FROM ${srcExpr(vname)}`);
      const columns = await describe(view);
      state.refs.push({ name: file.name, view, columns });
      renderRefs();
    } catch (e) {
      console.error(e);
      setStatus(t('loadFailed', { msg: (e && e.message) || String(e) }), 'error');
    } finally {
      qrxTest.state('ready'); qrxTest.tick('ref');
    }
  }

  function renderRefs() {
    refList.innerHTML = state.refs.map((r) =>
      `<div class="v-ref"><code>${esc(r.view)}</code> <span>${esc(r.name)}</span>`
      + ` <span class="v-ref-cols">· ${r.columns.length} ${t('column')}</span></div>`).join('');
    // reference-rule dropdowns depend on the ref list
    rulesList.querySelectorAll('.v-rule').forEach((row) => {
      if (row.dataset.type === 'reference') renderParams(row);
    });
  }

  // ---------------------------------------------------------------- rule builder
  function optionList(values, selected, labelFn) {
    return values.map((v) => {
      const val = typeof v === 'object' ? v.value : v;
      const lab = labelFn ? labelFn(v) : (typeof v === 'object' ? v.label : v);
      return `<option value="${esc(val)}"${val === selected ? ' selected' : ''}>${esc(lab)}</option>`;
    }).join('');
  }
  const colOptions = (sel) => state.columns.length
    ? optionList(state.columns.map((c) => c.name), sel)
    : `<option value="">${esc(t('noColumns'))}</option>`;

  function addRule(spec) {
    const row = document.createElement('div');
    row.className = 'v-rule';
    const type = (spec && spec.type) || 'not_null';
    const col = (spec && (spec.col || (spec.cols && spec.cols[0]))) || (state.columns[0] && state.columns[0].name) || '';
    row.dataset.type = type;
    row._spec = spec || {};
    row.innerHTML =
      `<select class="qrx-select v-rule-col" data-role="col">${colOptions(col)}</select>`
      + `<select class="qrx-select v-rule-type" data-role="type">`
      + optionList(RULE_TYPES, type, (rt) => t('type.' + rt)) + `</select>`
      + `<span class="v-rule-params" data-role="params"></span>`
      + `<select class="qrx-select v-rule-sev" data-role="sev">`
      + optionList([{ value: 'error', label: t('error') }, { value: 'warning', label: t('warning') }],
        (spec && spec.severity) || 'error') + `</select>`
      + `<span class="v-rule-tools">`
      + `<button type="button" class="v-rule-icon v-rule-run" data-role="run" title="${esc(t('runRule'))}" aria-label="${esc(t('runRule'))}">▶</button>`
      + `<button type="button" class="v-rule-icon v-rule-sqlbtn" data-role="sql" title="${esc(t('showSql'))}" aria-label="${esc(t('showSql'))}">SQL</button>`
      + `<button type="button" class="v-rule-remove" data-role="remove" title="${esc(t('remove'))}" aria-label="${esc(t('remove'))}">×</button>`
      + `</span>`
      + `<div class="v-rule-extra" data-role="extra" hidden>`
      + `<div class="v-rule-result" data-role="result"></div>`
      + `<div class="v-rule-sqlbox" data-role="sqlbox" hidden></div></div>`;
    rulesList.appendChild(row);
    renderParams(row);
  }

  // Build the params area for a rule row from its current type + stored spec.
  function renderParams(row) {
    const type = row.querySelector('[data-role="type"]').value;
    row.dataset.type = type;
    const colSel = row.querySelector('[data-role="col"]');
    colSel.style.display = COL_SCOPED.has(type) ? '' : 'none';
    const s = row._spec || {};
    const box = row.querySelector('[data-role="params"]');
    const L = (k) => `<span class="v-param-label">${esc(t(k))}</span>`;
    let h = '';
    switch (type) {
      case 'allowed':
        h = `<input class="qrx-input v-text" data-p="values" placeholder="${esc(t('pAllowed'))}" value="${esc((s.values || []).join(', '))}">`;
        break;
      case 'range':
        h = `${L('pMin')}<input class="qrx-input v-num" data-p="min" type="number" value="${s.min != null ? esc(s.min) : ''}">`
          + `${L('pMax')}<input class="qrx-input v-num" data-p="max" type="number" value="${s.max != null ? esc(s.max) : ''}">`
          + `<label class="v-param-label"><input type="checkbox" data-p="exclusive"${s.exclusive ? ' checked' : ''}> ${esc(t('pExclusive'))}</label>`;
        break;
      case 'length':
        h = `${L('pMin')}<input class="qrx-input v-num" data-p="min" type="number" min="0" value="${s.min != null ? esc(s.min) : ''}">`
          + `${L('pMax')}<input class="qrx-input v-num" data-p="max" type="number" min="0" value="${s.max != null ? esc(s.max) : ''}">`;
        break;
      case 'regex':
        h = `<input class="qrx-input v-text" data-p="pattern" placeholder="${esc(t('pRegex'))}" value="${esc(s.pattern || '')}">`;
        break;
      case 'pattern':
        h = `${L('pMode')}<select class="qrx-select" data-p="mode">`
          + optionList([{ value: 'exact', label: t('modeExact') }, { value: 'compact', label: t('modeCompact') }], s.mode || 'exact')
          + `</select>`;
        break;
      case 'castable':
        h = `${L('pCastType')}<select class="qrx-select" data-p="as">` + optionList(CAST_TYPES, s.as || 'INTEGER') + `</select>`;
        break;
      case 'reference': {
        if (!state.refs.length) { h = `<span class="v-param-label">${esc(t('noRefs'))}</span>`; break; }
        const refView = s.refFrom || state.refs[0].view;
        const ref = state.refs.find((r) => r.view === refView) || state.refs[0];
        h = `${L('pRefTable')}<select class="qrx-select" data-p="refFrom">`
          + optionList(state.refs.map((r) => ({ value: r.view, label: `${r.view} (${r.name})` })), ref.view) + `</select>`
          + `${L('pRefCol')}<select class="qrx-select" data-p="refCol">`
          + optionList(ref.columns.map((c) => c.name), s.refCol || (ref.columns[0] && ref.columns[0].name)) + `</select>`;
        break;
      }
      case 'sql':
        h = `<input class="qrx-input v-text" data-p="expr" placeholder="${esc(t('pSql'))}" value="${esc(s.expr || '')}">`
          + `<input class="qrx-input v-text" data-p="label" placeholder="${esc(t('pSqlLabel'))}" value="${esc(s.label || '')}">`;
        break;
      case 'row_count':
        h = `${L('pMin')}<input class="qrx-input v-num" data-p="min" type="number" min="0" value="${s.min != null ? esc(s.min) : ''}">`
          + `${L('pMax')}<input class="qrx-input v-num" data-p="max" type="number" min="0" value="${s.max != null ? esc(s.max) : ''}">`;
        break;
      default:
        h = '';
    }
    box.innerHTML = h;
  }

  // Read a rule row back into a rule spec for the engine.
  function readRule(row) {
    const type = row.querySelector('[data-role="type"]').value;
    const severity = row.querySelector('[data-role="sev"]').value;
    const col = row.querySelector('[data-role="col"]').value;
    const p = (name) => { const el = row.querySelector(`[data-p="${name}"]`); return el ? el.value : undefined; };
    const num = (name) => { const v = p(name); return v === '' || v == null ? undefined : Number(v); };
    const spec = { type, severity };
    if (COL_SCOPED.has(type)) spec.col = col;
    switch (type) {
      case 'allowed': {
        let vals = String(p('values') || '').split(/[\n,]/).map((x) => x.trim()).filter((x) => x.length);
        const cat = (state.columns.find((c) => c.name === col) || {}).category;
        if ((cat === 'integer' || cat === 'numeric') && vals.every((x) => x !== '' && isFinite(Number(x)))) {
          vals = vals.map(Number);
        }
        spec.values = vals;
        break;
      }
      case 'range':
        spec.min = num('min'); spec.max = num('max');
        spec.exclusive = !!row.querySelector('[data-p="exclusive"]').checked;
        break;
      case 'length':
        spec.min = num('min'); spec.max = num('max'); break;
      case 'regex':
        spec.pattern = p('pattern') || ''; break;
      case 'pattern':
        spec.mode = p('mode') || 'exact'; break;
      case 'castable':
        spec.as = p('as') || 'INTEGER'; break;
      case 'reference':
        spec.refFrom = p('refFrom'); spec.refCol = p('refCol'); break;
      case 'sql':
        spec.expr = p('expr') || 'TRUE'; if (p('label')) spec.label = p('label'); break;
      case 'row_count':
        spec.min = num('min'); spec.max = num('max'); break;
      default: break;
    }
    return spec;
  }
  const readAllRules = () => [...rulesList.querySelectorAll('.v-rule')].map(readRule);

  const ruleCtx = () => ({ query: q, from: 'data', total: state.total });
  function clearExtra(row) {
    const extra = row.querySelector('[data-role="extra"]');
    if (extra) { extra.hidden = true; }
    const res = row.querySelector('[data-role="result"]'); if (res) res.innerHTML = '';
    const sb = row.querySelector('[data-role="sqlbox"]'); if (sb) { sb.hidden = true; sb.innerHTML = ''; }
    row._rule = null;
  }

  // Delegated events for the rule list.
  rulesList.addEventListener('change', (e) => {
    const row = e.target.closest('.v-rule'); if (!row) return;
    const role = e.target.dataset.role || e.target.dataset.p;
    if (role === 'type' || role === 'refFrom') {
      // capture current inputs before rebuilding, so a type toggle keeps params
      row._spec = readRule(row);
      renderParams(row);
    }
    clearExtra(row);   // any edit invalidates a shown result / SQL
  });
  rulesList.addEventListener('click', async (e) => {
    const row = e.target.closest('.v-rule'); if (!row) return;
    if (e.target.closest('[data-role="remove"]')) { row.remove(); return; }
    if (e.target.closest('[data-role="run"]')) { await runRule(row); return; }
    if (e.target.closest('[data-role="sql"]')) { await toggleSql(row); return; }
    const ir = e.target.closest('[data-role="inrows"]'); if (ir) { await toggleInlineRows(row, ir); return; }
    const cp = e.target.closest('[data-role="copysql"]'); if (cp) { copyText(cp.getAttribute('data-sql'), cp); return; }
  });
  addRuleBtn.addEventListener('click', () => addRule());

  // --- run a single rule, inline -------------------------------------------
  async function runRule(row) {
    if (!state.columns.length) return;
    const extra = row.querySelector('[data-role="extra"]');
    const resEl = row.querySelector('[data-role="result"]');
    extra.hidden = false;
    resEl.innerHTML = `<span class="muted">${esc(t('validating'))}</span>`;
    try {
      const resolved = await qrx.rules.resolve(readRule(row), ruleCtx());
      const report = await qrx.rules.validate({ query: q, from: 'data', rules: [resolved], total: state.total });
      row._rule = resolved;
      renderInlineResult(row, report.results[0]);
    } catch (err) {
      console.error(err);
      resEl.innerHTML = `<span class="muted">${esc((err && err.message) || String(err))}</span>`;
    }
  }

  function renderInlineResult(row, res) {
    const resEl = row.querySelector('[data-role="result"]');
    const st = res.status || 'pass';
    const sym = st === 'pass' ? '✓' : st === 'fail' ? '✗' : st === 'warn' ? '⚠' : '–';
    let count;
    if (st === 'skipped') count = t('skipped');
    else if (res.table) count = res.actual != null ? `${t('rowsWord')}: ${fmtN(res.actual)}` : '';
    else if (res.violations > 0) count = `${fmtN(res.violations)} ${t('violationsWord')} (${((res.share || 0) * 100).toFixed(1)} %)`;
    else count = t('pass');
    const canRows = (st === 'fail' || st === 'warn');
    resEl.innerHTML = `<span class="v-inline is-${st}"><span class="v-inline-badge">${sym}</span>`
      + `<span class="v-inline-count">${esc(count)}</span>`
      + (canRows ? ` <button type="button" class="v-res-toggle" data-role="inrows">${esc(t('showRows'))}</button>` : '')
      + `</span><div class="v-inline-rows" data-role="inrowbox" hidden></div>`;
  }

  async function toggleInlineRows(row, btn) {
    const box = row.querySelector('[data-role="inrowbox"]');
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<span class="muted">${esc(t('loading'))}</span>`;
    try {
      const res = await qrx.rules.sample({ query: q, from: 'data', rule: row._rule, limit: 20 });
      if (!qrx.duckdb.rows(res).length) { box.innerHTML = `<span class="muted">${esc(t('noSample'))}</span>`; return; }
      box.innerHTML = '';
      qrx.ui.resultGrid(box, { localeNumbers: true }).render(res);
    } catch (err) {
      console.error(err); box.innerHTML = `<span class="muted">${esc((err && err.message) || String(err))}</span>`;
    }
  }

  // --- show / copy the SQL for a single rule -------------------------------
  async function toggleSql(row) {
    const extra = row.querySelector('[data-role="extra"]');
    const box = row.querySelector('[data-role="sqlbox"]');
    extra.hidden = false;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<span class="muted">${esc(t('validating'))}</span>`;
    try {
      const resolved = await qrx.rules.resolve(readRule(row), ruleCtx());
      const { sql } = qrx.rules.explain(resolved, 'data');
      if (!sql) { box.innerHTML = `<span class="muted">${esc(t('noSql'))}</span>`; return; }
      box.innerHTML = `<pre class="v-sql">${esc(sql)}</pre>`
        + `<button type="button" class="v-copy" data-role="copysql" data-sql="${esc(sql)}">${esc(t('copy'))}</button>`;
    } catch (err) {
      console.error(err); box.innerHTML = `<span class="muted">${esc((err && err.message) || String(err))}</span>`;
    }
  }

  function copyText(text, btn) {
    const done = () => { btn.classList.add('is-copied'); btn.textContent = t('copied');
      setTimeout(() => { btn.classList.remove('is-copied'); btn.textContent = t('copy'); }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
    else {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {} ta.remove(); done();
    }
  }

  // ---------------------------------------------------------------- validate
  function ruleLabel(rule) {
    const ty = t('type.' + rule.type);
    if (rule.type === 'sql') return rule.label ? esc(rule.label) : `${ty}: <code>${esc(rule.expr)}</code>`;
    if (rule.type === 'row_count') {
      const b = [rule.min != null ? '≥ ' + fmtN(rule.min) : '', rule.max != null ? '≤ ' + fmtN(rule.max) : ''].filter(Boolean).join(' · ');
      return `${ty} ${b}`;
    }
    let extra = '';
    if (rule.type === 'range') extra = ` ${rule.min != null ? rule.min : '−∞'} … ${rule.max != null ? rule.max : '∞'}`;
    else if (rule.type === 'length') extra = ` ${rule.min != null ? rule.min : 0}…${rule.max != null ? rule.max : '∞'}`;
    else if (rule.type === 'allowed') extra = ` {${(rule.values || []).join(', ')}}`;
    else if (rule.type === 'regex') extra = ` <code>${esc(rule.pattern)}</code>`;
    else if (rule.type === 'castable') extra = ` ${rule.as}`;
    else if (rule.type === 'pattern') extra = ` (${rule.mode === 'compact' ? t('modeCompact') : t('modeExact')})`;
    else if (rule.type === 'reference') extra = ` → <code>${esc(rule.refFrom)}.${esc(rule.refCol)}</code>`;
    return `<code>${esc(rule.col || '')}</code> · ${ty}${extra}`;
  }

  async function runValidate() {
    const rules = readAllRules();
    if (!rules.length) { setStatus(t('needRules'), 'warn'); return; }
    qrxTest.state('busy');
    validateBtn.disabled = true;
    setStatus(t('validating'));
    try {
      const report = await qrx.rules.validate({ query: q, from: 'data', rules, total: state.total });
      state.lastReport = report;
      renderReport(report);
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus(t('validateFailed', { msg: (e && e.message) || String(e) }), 'error');
    } finally {
      validateBtn.disabled = false;
      qrxTest.state('ready'); qrxTest.tick('validate');
    }
  }

  function renderReport(report) {
    resultsCard.hidden = false;
    const failed = report.results.filter((r) => r.status === 'fail').length;
    const warned = report.results.filter((r) => r.status === 'warn').length;
    const scorePct = (report.score * 100).toFixed(1);
    resultsSummary.className = 'v-summary ' + (report.ok ? 'is-ok' : 'is-fail');
    resultsSummary.innerHTML =
      `<span class="v-score">${scorePct} %</span>`
      + `<span>${fmtN(report.valid)} / ${fmtN(report.total)} ${t('valid')}</span>`
      + `<span class="v-summary-sub">· ${fmtN(report.invalid)} ${t('rowsWord')} ${t('violationsWord')}`
      + (failed || warned ? ` · ${failed} ✗ · ${warned} ⚠` : '') + `</span>`;

    resultsList.innerHTML = report.results.map((r, i) => {
      const st = r.status || 'pass';
      const sym = st === 'pass' ? '✓' : st === 'fail' ? '✗' : st === 'warn' ? '⚠' : '–';
      let count = '';
      if (st === 'skipped') count = t('skipped');
      else if (r.table) count = r.actual != null ? `${t('rowsWord')}: ${fmtN(r.actual)}` : '';
      else if (r.violations > 0) count = `${fmtN(r.violations)} (${((r.share || 0) * 100).toFixed(1)} %)`;
      else count = t('pass');
      return `<div class="v-res is-${st}" data-idx="${i}">`
        + `<div class="v-res-head"><span class="v-res-badge">${sym}</span>`
        + `<span class="v-res-label">${ruleLabel(r.rule)}</span>`
        + `<span class="v-res-count">${esc(count)}</span>`
        + (st === 'fail' || st === 'warn'
          ? `<button type="button" class="v-res-toggle" data-role="rows">${esc(t('showRows'))}</button>` : '')
        + `</div><div class="v-res-rows" data-role="rowbox" hidden></div></div>`;
    }).join('');
  }

  // Lazy sample of the offending rows for a failing rule.
  resultsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-role="rows"]'); if (!btn) return;
    const card = btn.closest('.v-res');
    const box = card.querySelector('[data-role="rowbox"]');
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    const idx = Number(card.dataset.idx);
    const rule = state.lastReport.results[idx].rule;
    box.innerHTML = `<span class="muted">${esc(t('loading'))}</span>`;
    try {
      const res = await qrx.rules.sample({ query: q, from: 'data', rule, limit: 20 });
      const rows = qrx.duckdb.rows(res);
      if (!rows.length) { box.innerHTML = `<span class="muted">${esc(t('noSample'))}</span>`; return; }
      box.innerHTML = '';
      qrx.ui.resultGrid(box, { localeNumbers: true }).render(res);
    } catch (err) {
      console.error(err);
      box.innerHTML = `<span class="muted">${esc((err && err.message) || String(err))}</span>`;
    }
  });

  // ---------------------------------------------------------------- suggest
  async function runSuggest() {
    if (!state.columns.length) return;
    qrxTest.state('busy'); suggestBtn.disabled = true; setStatus(t('analysing'));
    try {
      const specs = await qrx.rules.suggest({ query: q, from: 'data', total: state.total, columns: state.columns });
      if (!specs.length) { setStatus(t('suggestNone'), 'warn'); return; }
      rulesList.innerHTML = '';
      specs.forEach(addRule);
      setStatus('');
    } catch (e) {
      console.error(e);
      setStatus(t('validateFailed', { msg: (e && e.message) || String(e) }), 'error');
    } finally {
      suggestBtn.disabled = false; qrxTest.state('ready'); qrxTest.tick('suggest');
    }
  }

  // ---------------------------------------------------------------- ruleset save/load
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function saveRuleset() {
    const doc = { version: 1, source: state.fileName || null, rules: readAllRules() };
    const base = (state.fileName || 'ruleset').replace(/\.[^.]+$/, '');
    download(`${base}.rules.json`, JSON.stringify(doc, null, 2), 'application/json');
  }
  function loadRulesetFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result));
        const rules = Array.isArray(doc) ? doc : (doc.rules || []);
        rulesList.innerHTML = '';
        rules.forEach(addRule);
      } catch (e) {
        setStatus(t('loadFailed', { msg: (e && e.message) || String(e) }), 'error');
      }
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------- report export
  function exportReport() {
    const r = state.lastReport; if (!r) return;
    const L = [];
    L.push(`# ${t('reportTitle')}`);
    L.push('');
    L.push(`- ${t('column')}s: ${state.columns.length} · ${t('rowsWord')}: ${state.total}`);
    L.push(`- ${t('score')}: ${(r.score * 100).toFixed(1)} % · ${r.valid}/${r.total} ${t('valid')} · ${r.invalid} ${t('rowsWord')} ${t('violationsWord')}`);
    L.push('');
    L.push(`| ${t('ruleType')} | Status | ${t('violationsWord')} |`);
    L.push('|---|---|---|');
    for (const res of r.results) {
      const label = ruleLabel(res.rule).replace(/<\/?code>/g, '`').replace(/<[^>]+>/g, '');
      const status = res.status === 'pass' ? '✓' : res.status === 'fail' ? '✗' : res.status === 'warn' ? '⚠' : '–';
      const v = res.table ? (res.actual != null ? String(res.actual) : '') : (res.violations || 0);
      L.push(`| ${label} | ${status} | ${v} |`);
    }
    const base = (state.fileName || 'report').replace(/\.[^.]+$/, '');
    download(`${base}.validation.md`, L.join('\n'), 'text/markdown');
  }

  // ---------------------------------------------------------------- wiring
  qrx.ui.dropzone(dropzoneEl, {
    input: filePicker, accept: '.parquet,.pq',
    extraTargets: [], onFiles: (files) => { if (files && files[0]) loadFile(files[0]); },
  });
  addRefBtn.addEventListener('click', () => refPicker.click());
  refPicker.addEventListener('change', () => { if (refPicker.files[0]) loadReference(refPicker.files[0]); refPicker.value = ''; });
  suggestBtn.addEventListener('click', runSuggest);
  validateBtn.addEventListener('click', runValidate);
  saveRulesetBtn.addEventListener('click', saveRuleset);
  loadRulesetBtn.addEventListener('click', () => rulesetPicker.click());
  rulesetPicker.addEventListener('change', () => { if (rulesetPicker.files[0]) loadRulesetFile(rulesetPicker.files[0]); rulesetPicker.value = ''; });
  exportReportBtn.addEventListener('click', exportReport);

  // DuckDB server source (optional) — copy the picked table into a local `data`.
  const srv = window.qrxDuckServer;
  const srvDialog = qrx.ui.connectDialog({
    selection: 'single',
    onPick: async ({ uri, tables }) => {
      qrxTest.state('busy');
      try {
        await initDuckDB();
        setStatus(t('loading'));
        await q(`CREATE OR REPLACE TABLE data AS SELECT * FROM ${srv.remoteRef(tables[0])}`);
        state.columns = await describe('data');
        state.total = Number(qrx.duckdb.rows(await q('SELECT count(*)::BIGINT AS c FROM data'))[0].c);
        state.fileName = tables[0];
        await afterSourceLoaded(`${uri} · ${tables[0]}`, '');
      } catch (e) {
        console.error(e);
        setStatus(t('loadFailed', { msg: (e && e.message) || String(e) }), 'error');
      } finally {
        qrxTest.state('ready'); qrxTest.tick('load');
      }
    },
  });
  srvConnectBtn.addEventListener('click', () => srvDialog.open());

  // Re-render language-dependent bits when the language changes: rebuild every
  // rule row from its current spec (so option labels follow the language) and
  // re-render the last report.
  qrx.i18n.onChange(() => {
    const specs = readAllRules();
    rulesList.innerHTML = '';
    specs.forEach(addRule);
    if (state.lastReport && !resultsCard.hidden) renderReport(state.lastReport);
  });

  // ---------------------------------------------------------------- test hooks
  qrxTest.expose('validator', {
    state, readAllRules, runValidate, runSuggest, addRule, loadFile, ruleLabel,
  });
  qrxTest.state('ready');
})();
