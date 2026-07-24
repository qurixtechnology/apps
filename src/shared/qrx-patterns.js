// ============================================================================
// qrx.patterns — column structure / value-pattern analysis.
//
// Was the cleaner's "Column structure — pattern analysis". Extracted so the
// profiler can reuse it as a tab when a column is expanded. The engine is
// decoupled from any specific view or connection: it takes a `query` function
// and a `from` source, so it works on the cleaner's `original` view, on the
// profiler's active file, on a DuckDB-server table — anything.
//
// Each value is reduced to a MASK: A = uppercase letter, a = lowercase letter,
// 9 = digit, every other character kept literally (Unicode letters, incl.
// umlauts, are recognised). Two views: exact keeps the run length
// (999 → \d{3}); compact collapses any run (9+ → \d+).
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});

  // SQL expression that masks a (quoted) column. In compact mode a run of the
  // same class collapses to one symbol, so 9 / 99 / 999 fold into one pattern.
  function maskExpr(quotedCol, compact) {
    const c = `CAST(${quotedCol} AS VARCHAR)`;
    const q = compact ? '+' : '';
    return `regexp_replace(regexp_replace(regexp_replace(${c}, '\\p{Lu}${q}', 'A', 'g'), '\\p{Ll}${q}', 'a', 'g'), '[0-9]${q}', '9', 'g')`;
  }

  // Display form of a compact mask: each class symbol shown as "A+"/"a+"/"9+".
  function compactDisplay(mask) {
    let s = '';
    for (const ch of mask) s += (ch === 'A' || ch === 'a' || ch === '9') ? ch + '+' : ch;
    return s;
  }

  // A mask → an anchored regex. Exact: run-length → {n}; compact: run → "+".
  function maskToRegex(mask, compact) {
    let out = '^', i = 0;
    while (i < mask.length) {
      const ch = mask[i];
      const cls = ch === 'A' ? '\\p{Lu}' : ch === 'a' ? '\\p{Ll}' : ch === '9' ? '\\d' : null;
      if (cls) {
        let n = 1;
        while (i + n < mask.length && mask[i + n] === ch) n++;
        out += cls + (compact ? '+' : (n > 1 ? `{${n}}` : ''));
        i += n;
      } else {
        out += /[.*+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch;
        i++;
      }
    }
    return out + '$';
  }

  /**
   * Run the analysis.
   * @param {object} o
   * @param {(sql:string)=>Promise<any>} o.query  runs SQL, returns an Arrow result
   * @param {string} o.from   the FROM source (a view name, table, or 'table')
   * @param {string} o.col    the quoted column identifier
   * @param {number} o.total  total row count (for share %)
   * @param {number} [o.limit=30]
   * @returns {{exact,compact,nulls,total}} exact/compact = { rows:[{pat,c,example}], distinct }
   */
  async function analyze(o) {
    const { query, from, col, total } = o;
    const limit = o.limit || 30;

    async function group(expr) {
      const res = await query(
        `WITH m AS (SELECT ${expr} AS pat, CAST(${col} AS VARCHAR) AS ex `
        + `FROM ${from} WHERE ${col} IS NOT NULL) `
        + `SELECT pat, count(*)::BIGINT AS c, min(ex) AS example FROM m `
        + `GROUP BY pat ORDER BY c DESC LIMIT ${limit}`);
      const rows = qrx.duckdb.rows(res).map(r => ({
        pat: r.pat, c: Number(r.c), example: r.example == null ? '' : String(r.example),
      }));
      const dres = await query(`SELECT count(DISTINCT ${expr})::BIGINT AS c FROM ${from} WHERE ${col} IS NOT NULL`);
      const distinct = Number(qrx.duckdb.rows(dres)[0].c);
      return { rows, distinct };
    }

    const exact = await group(maskExpr(col, false));
    const compact = await group(maskExpr(col, true));
    const nres = await query(`SELECT count(*)::BIGINT AS c FROM ${from} WHERE ${col} IS NULL`);
    const nulls = Number(qrx.duckdb.rows(nres)[0].c);
    return { exact, compact, nulls, total: total || 1 };
  }

  qrx.patterns = { maskExpr, compactDisplay, maskToRegex, analyze };
})();
