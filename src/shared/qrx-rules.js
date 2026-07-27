// ============================================================================
// qrx.rules — data validation: compile rule specs to SQL and run them.
//
// A companion to qrx.patterns/qrx.duckdb, decoupled from any app. A RULE is a
// small JSON object; the engine compiles each to a per-row PREDICATE P that is
// TRUE for a valid row, so violations are the rows where NOT P. Value checks
// pass on NULL — absence is the job of an explicit `not_null` rule, so a
// missing value is never penalised twice.
//
// validate() batches every per-row rule into a single pass
// (sum(CASE WHEN <violation> THEN 1) per rule) and, in the same query, counts
// the rows that break at least one error-severity rule (the "58/60 valid"
// headline). Only table-level rules (row_count) run on their own. sample()
// fetches the actual offending rows on demand, mirroring patterns.outlierRows.
//
// Rule shapes (severity defaults to 'error'):
//   { col, type:'not_null' }
//   { cols|col, type:'unique' }
//   { col, type:'allowed', values:[…] }
//   { col, type:'range', min?, max?, exclusive? }
//   { col, type:'length', min?, max? }
//   { col, type:'regex', pattern }
//   { col, type:'pattern', mode:'exact'|'compact' }     // uses qrx.patterns
//   { col, type:'castable', as:'DOUBLE' }
//   { col, type:'trimmed' }
//   { col, type:'reference', refFrom, refCol }
//   { type:'sql', expr, label? }   // expr is TRUE for a BREAKING row (dbt-style)
//   { type:'row_count', min?, max? }
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});
  const ident = (s) => qrx.duckdb.ident(s);
  const str = (s) => qrx.duckdb.str(s);

  // A typed SQL literal for allowed/range values: numbers and booleans raw,
  // everything else a quoted string. A rule may force it with valueType:'raw'.
  function lit(v, valueType) {
    if (valueType === 'raw') return String(v);
    if (typeof v === 'number' && isFinite(v)) return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return str(v);
  }

  function varchar(colSql) { return `CAST(${colSql} AS VARCHAR)`; }

  // The left-hand side of a numeric comparison. When the values being compared
  // are numbers, wrap the column in TRY_CAST(... AS DOUBLE) so a text column
  // (e.g. a numeric id stored as VARCHAR) can be compared without DuckDB's
  // "cannot compare VARCHAR and INTEGER_LITERAL" binder error. TRY_CAST is
  // deliberate: a non-numeric value casts to NULL and is left unevaluated
  // rather than aborting the whole query. Genuinely numeric columns are
  // unaffected (casting a number to DOUBLE is a no-op).
  function numericLhs(colSql, values) {
    return values.some(v => typeof v === 'number') ? `TRY_CAST(${colSql} AS DOUBLE)` : colSql;
  }

  // Build the per-row predicate P (valid when TRUE) for a batchable rule.
  // Pattern rules are resolved earlier (their masks are attached as _masks).
  // Returns null for rules that are not per-row (row_count) or skipped.
  function predicate(rule) {
    const c = rule.col != null ? ident(rule.col) : null;
    switch (rule.type) {
      case 'not_null':
        return `${c} IS NOT NULL`;
      case 'allowed': {
        const values = rule.values || [];
        const vals = values.map(v => lit(v, rule.valueType));
        if (!vals.length) return 'FALSE';
        return `${c} IS NULL OR ${numericLhs(c, values)} IN (${vals.join(', ')})`;
      }
      case 'range': {
        const parts = [];
        const lo = rule.exclusive ? '>' : '>=';
        const hi = rule.exclusive ? '<' : '<=';
        const lhs = numericLhs(c, [rule.min, rule.max]);
        if (rule.min != null) parts.push(`${lhs} ${lo} ${lit(rule.min, rule.valueType)}`);
        if (rule.max != null) parts.push(`${lhs} ${hi} ${lit(rule.max, rule.valueType)}`);
        if (!parts.length) return 'TRUE';
        return `${c} IS NULL OR (${parts.join(' AND ')})`;
      }
      case 'length': {
        const parts = [];
        if (rule.min != null) parts.push(`length(${varchar(c)}) >= ${Number(rule.min)}`);
        if (rule.max != null) parts.push(`length(${varchar(c)}) <= ${Number(rule.max)}`);
        if (!parts.length) return 'TRUE';
        return `${c} IS NULL OR (${parts.join(' AND ')})`;
      }
      case 'regex':
        return `${c} IS NULL OR regexp_full_match(${varchar(c)}, ${str(rule.pattern || '')})`;
      case 'pattern': {
        if (!rule._masks || !rule._masks.length) return null;   // no dominant shape → skipped
        const expr = qrx.patterns.maskExpr(c, rule.mode === 'compact');
        return `${c} IS NULL OR (${expr}) IN (${rule._masks.map(m => str(m)).join(', ')})`;
      }
      case 'castable':
        return `${c} IS NULL OR TRY_CAST(${c} AS ${sqlType(rule.as)}) IS NOT NULL`;
      case 'trimmed':
        return `${c} IS NULL OR ${varchar(c)} = trim(${varchar(c)})`;
      case 'reference': {
        const rc = ident(rule.refCol);
        return `${c} IS NULL OR ${c} IN (SELECT ${rc} FROM ${rule.refFrom})`;
      }
      case 'sql':
        // The expression flags BREAKING rows, so a valid row is one where it is
        // not true. violationSql() special-cases sql and emits the un-negated
        // form; this negated shape only matters if predicate() is used directly.
        return `NOT COALESCE((${rule.expr}), FALSE)`;
      default:
        return null;
    }
  }

  // Key tuple for a unique rule (single or composite).
  function uniqueKey(rule) {
    const cols = rule.cols && rule.cols.length ? rule.cols : [rule.col];
    return cols.map(ident);
  }

  // The SQL condition that SELECTS the violating rows (used by the batch sum
  // and by sample()). For per-row rules that's NOT P; unique is its own shape.
  function violationSql(rule, from) {
    if (rule.type === 'unique') {
      const keys = uniqueKey(rule);
      const tuple = keys.join(', ');
      const notNull = keys.map(k => `${k} IS NOT NULL`).join(' AND ');
      return `(${tuple}) IN (SELECT ${tuple} FROM ${from} WHERE ${notNull} `
        + `GROUP BY ${tuple} HAVING count(*) > 1)`;
    }
    // Custom SQL follows the usual data-test convention: the expression selects
    // the BREAKING rows (TRUE = violation), so it is the violation condition
    // directly — no negation. Emitting it cleanly matters, it is shown to users.
    if (rule.type === 'sql') return `COALESCE((${rule.expr}), FALSE)`;
    const p = predicate(rule);
    return p == null ? null : `NOT (${p})`;
  }

  // Only a small allow-list of cast targets, to keep `castable` injection-free.
  function sqlType(t) {
    const ok = ['BOOLEAN', 'TINYINT', 'SMALLINT', 'INTEGER', 'BIGINT', 'HUGEINT',
      'FLOAT', 'DOUBLE', 'DECIMAL', 'VARCHAR', 'DATE', 'TIME', 'TIMESTAMP', 'UUID'];
    const up = String(t || '').toUpperCase();
    return ok.includes(up) ? up : 'VARCHAR';
  }

  function severityOf(rule) { return rule.severity === 'warning' ? 'warning' : 'error'; }

  // Resolve `pattern` rules: analyse the column and attach the dominant masks
  // so predicate() can build the IN-list. Mutates a shallow copy, returns it.
  async function resolvePattern(rule, ctx) {
    const col = ident(rule.col);
    const data = await qrx.patterns.analyze({
      query: ctx.query, from: ctx.from, col, total: ctx.total || 1,
    });
    const compact = rule.mode === 'compact';
    const d = compact ? data.compact : data.exact;
    const nonNull = Math.max(0, (ctx.total || 0) - (data.nulls || 0));
    const ol = qrx.patterns.outliers(d, nonNull);
    return Object.assign({}, rule, { _masks: ol.hasDominant ? [...ol.normalPats] : [] });
  }

  // Resolve any rule that needs a pre-analysis (currently only `pattern`), so
  // that predicate()/violationSql()/explain() can run on it. A no-op for every
  // other type. Idempotent: an already-resolved pattern rule is returned as-is.
  async function resolve(rule, ctx) {
    return (rule.type === 'pattern' && !rule._masks) ? resolvePattern(rule, ctx) : rule;
  }

  /**
   * The SQL for a single (resolved) rule — ready to show and copy. Returns the
   * query that selects the violating rows, or, for a table-level rule, the
   * count query with the expected bounds as a comment.
   * @returns {{violationSql:string|null, sql:string|null}}
   */
  function explain(rule, from) {
    from = from || 'data';
    if (rule.type === 'row_count') {
      const b = [rule.min != null ? `>= ${Number(rule.min)}` : '',
        rule.max != null ? `<= ${Number(rule.max)}` : ''].filter(Boolean).join(' AND ');
      return { violationSql: null, sql: `SELECT count(*) AS n FROM ${from}${b ? `  -- expected: n ${b}` : ''}` };
    }
    const v = violationSql(rule, from);
    if (v == null) return { violationSql: null, sql: null };
    return { violationSql: v, sql: `SELECT *\nFROM ${from}\nWHERE ${v}` };
  }

  /**
   * Run a whole ruleset.
   * @param {object} o
   * @param {(sql:string)=>Promise<any>} o.query
   * @param {string} o.from   the source view/table
   * @param {object[]} o.rules
   * @param {number} [o.total]  row count (queried if absent)
   * @returns {{total,valid,invalid,score,ok,results:object[]}}
   */
  async function validate(o) {
    const { query, from } = o;
    const rows = (res) => qrx.duckdb.rows(res);
    let total = o.total;
    if (total == null) total = Number(rows(await query(`SELECT count(*)::BIGINT AS c FROM ${from}`))[0].c);

    // Resolve pattern rules up front (they need a pre-analysis). Already-
    // resolved rules (a single-rule run passes one in) are left untouched.
    const rules = [];
    for (const r of o.rules) {
      rules.push(await resolve(r, { query, from, total }));
    }

    // Partition: table-level (row_count) runs alone; everything else batches.
    const perRow = [];
    const results = new Array(rules.length);
    let invalidRows = 0;
    rules.forEach((rule, i) => {
      if (rule.type === 'row_count') { results[i] = { table: true }; return; }
      if (rule.type === 'pattern' && (!rule._masks || !rule._masks.length)) {
        results[i] = { status: 'skipped', violations: 0, share: 0 };
        return;
      }
      const vsql = violationSql(rule, from);
      if (vsql == null) { results[i] = { status: 'skipped', violations: 0, share: 0 }; return; }
      perRow.push({ i, rule, vsql });
    });

    // One pass: total invalid rows (any error rule) + per-rule violation counts.
    if (perRow.length) {
      const errorConds = perRow.filter(p => severityOf(p.rule) === 'error').map(p => p.vsql);
      const invalidExpr = errorConds.length ? errorConds.map(c => `(${c})`).join(' OR ') : 'FALSE';
      const cols = [
        `sum(CASE WHEN ${invalidExpr} THEN 1 ELSE 0 END)::BIGINT AS invalid`,
        ...perRow.map(p => `sum(CASE WHEN ${p.vsql} THEN 1 ELSE 0 END)::BIGINT AS r${p.i}`),
      ];
      const row = rows(await query(`SELECT ${cols.join(', ')} FROM ${from}`))[0];
      invalidRows = Number(row.invalid);
      for (const p of perRow) {
        const v = Number(row['r' + p.i]);
        results[p.i] = {
          violations: v, share: total ? v / total : 0,
          status: v > 0 ? (severityOf(p.rule) === 'error' ? 'fail' : 'warn') : 'pass',
        };
      }
    }

    // Table-level rules.
    for (let i = 0; i < rules.length; i++) {
      if (rules[i].type !== 'row_count') continue;
      const n = Number(rows(await query(`SELECT count(*)::BIGINT AS c FROM ${from}`))[0].c);
      let ok = true;
      if (rules[i].min != null && n < rules[i].min) ok = false;
      if (rules[i].max != null && n > rules[i].max) ok = false;
      results[i] = { table: true, actual: n, violations: ok ? 0 : 1, share: 0,
        status: ok ? 'pass' : (severityOf(rules[i]) === 'error' ? 'fail' : 'warn') };
    }

    const out = rules.map((rule, i) => Object.assign({ rule }, results[i]));
    const ok = out.every(r => r.status !== 'fail');
    return {
      total, invalid: invalidRows, valid: Math.max(0, total - invalidRows),
      score: total ? (total - invalidRows) / total : 1, ok, results: out,
    };
  }

  /**
   * Fetch a sample of the rows a rule flags. The UI calls this lazily when a
   * failing rule is expanded.
   * @returns {{cols:string[], rows:any[][]}} — a raw result the app can grid.
   */
  async function sample(o) {
    const { query, from, rule } = o;
    const limit = o.limit || 20;
    const vsql = violationSql(rule, from);
    if (vsql == null) return await query(`SELECT * FROM ${from} WHERE FALSE`);
    return await query(`SELECT * FROM ${from} WHERE ${vsql} LIMIT ${limit}`);
  }

  /**
   * Propose a ruleset from a quick profile of the given columns.
   * @param {object} o  { query, from, total, columns:[{name,category}] }
   * @returns {object[]} rule specs
   */
  async function suggest(o) {
    const { query, from } = o;
    const rows = (res) => qrx.duckdb.rows(res);
    const total = o.total || Number(rows(await query(`SELECT count(*)::BIGINT AS c FROM ${from}`))[0].c);
    const out = [];
    for (const col of (o.columns || [])) {
      const c = ident(col.name);
      const s = rows(await query(
        `SELECT count(*)::BIGINT AS nn, count(DISTINCT ${c})::BIGINT AS d FROM ${from} WHERE ${c} IS NOT NULL`))[0];
      const nn = Number(s.nn), distinct = Number(s.d);
      if (nn === total && total > 0) out.push({ col: col.name, type: 'not_null', severity: 'error' });
      if (distinct === nn && nn > 1) out.push({ col: col.name, type: 'unique', severity: 'error' });
      const textLike = col.category === 'string' || col.category === 'binary' || col.category === 'other';
      if (textLike && distinct > 0 && distinct <= 12 && distinct < nn) {
        const vals = rows(await query(
          `SELECT DISTINCT ${c} AS v FROM ${from} WHERE ${c} IS NOT NULL ORDER BY 1 LIMIT 12`)).map(r => r.v);
        out.push({ col: col.name, type: 'allowed', values: vals, severity: 'error' });
      } else if (textLike && distinct > 12) {
        // a clear dominant shape → a pattern rule
        const data = await qrx.patterns.analyze({ query, from, col: c, total });
        const ol = qrx.patterns.outliers(data.exact, nn);
        if (ol.hasDominant) out.push({ col: col.name, type: 'pattern', mode: 'exact', severity: 'error' });
      }
      if (col.category === 'integer' || col.category === 'numeric') {
        const mm = rows(await query(`SELECT min(${c}) AS lo, max(${c}) AS hi FROM ${from}`))[0];
        if (mm.lo != null && mm.hi != null) {
          out.push({ col: col.name, type: 'range', min: Number(mm.lo), max: Number(mm.hi), severity: 'warning' });
        }
      }
    }
    return out;
  }

  qrx.rules = { predicate, violationSql, validate, sample, suggest, resolve, explain, lit, sqlType };
})();
