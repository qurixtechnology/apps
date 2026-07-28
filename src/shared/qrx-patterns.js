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

  /**
   * Literal-substring analysis — a complement to the class-mask view. Instead of
   * reducing a value to A/a/9, it surfaces the concrete pieces that recur:
   *   - prefixes  : a leading alphanumeric run plus its delimiter (BAU_, 2024-)
   *   - suffixes  : a delimiter plus a trailing run (_LTD, -01)
   *   - tokens    : words, splitting on non-alphanumerics AND camelCase
   *                 boundaries (X_POWER_Y and HydroPower both yield POWER)
   * Each is one GROUP BY, so it stays cheap. A piece has to occur at least twice
   * to show up (a one-off is not a recurring segment).
   *
   * @param {object} o  { query, from, col, total, limit=15 }
   * @returns {{prefixes,suffixes,tokens,total}} — lists of {value,c,example}
   */
  // A ready-to-run query that returns the records matching one segment/motif.
  // prefix → starts_with, suffix → ends_with, token/substring → contains.
  function matchSql(o) {
    const from = o.from || 'data';
    const c = `CAST(${o.col} AS VARCHAR)`;
    const lit = qrx.duckdb.str(o.value);
    const pred = o.kind === 'prefix' ? `starts_with(${c}, ${lit})`
      : o.kind === 'suffix' ? `ends_with(${c}, ${lit})`
      : `contains(${c}, ${lit})`;
    return `SELECT *\nFROM ${from}\nWHERE ${pred}`;
  }

  async function segments(o) {
    const { query, from, col, total } = o;
    const limit = o.limit || 200;
    const v = `CAST(${col} AS VARCHAR)`;
    const src = `FROM ${from} WHERE ${col} IS NOT NULL`;

    async function grp(expr) {
      const res = await query(
        `WITH m AS (SELECT ${expr} AS seg, ${v} AS ex ${src}) `
        + `SELECT seg, count(*)::BIGINT AS c, min(ex) AS example FROM m `
        + `WHERE seg <> '' AND seg IS NOT NULL GROUP BY seg HAVING count(*) >= 2 `
        + `ORDER BY c DESC LIMIT ${limit}`);
      return qrx.duckdb.rows(res).map(r => ({
        value: r.seg, c: Number(r.c), example: r.example == null ? '' : String(r.example),
      }));
    }

    // leading alnum run + one non-alnum char; and its mirror for the suffix
    const prefixes = await grp(`regexp_extract(${v}, '^[[:alnum:]]+[^[:alnum:]]')`);
    const suffixes = await grp(`regexp_extract(${v}, '[^[:alnum:]][[:alnum:]]+$')`);

    // tokens: break camelCase into words first, then split on non-alnum runs
    const split = `regexp_split_to_array(regexp_replace(${v}, '([a-z])([A-Z])', '\\1 \\2', 'g'), '[^[:alnum:]]+')`;
    const tres = await query(
      `WITH m AS (SELECT unnest(${split}) AS tok, ${v} AS ex ${src}) `
      + `SELECT tok, count(*)::BIGINT AS c, min(ex) AS example FROM m `
      + `WHERE length(tok) >= 2 GROUP BY tok HAVING count(*) >= 2 `
      + `ORDER BY c DESC LIMIT ${limit}`);
    const tokens = qrx.duckdb.rows(tres).map(r => ({
      value: r.tok, c: Number(r.c), example: r.example == null ? '' : String(r.example),
    }));

    return { prefixes, suffixes, tokens, total: total || 1 };
  }

  // From a set of frequent substring candidates, keep only the MAXIMAL ones:
  // drop a shorter substring when a longer one that contains it explains
  // (nearly) all of its occurrences. So HYDROPOWERUNIT / SOLARPOWER yield
  // POWER, not also OWER / POWE / OWE. Runs on the top candidates only, in JS.
  function maximalSubstrings(cands, mergeRatio) {
    const r = mergeRatio || 0.8;
    const byLen = [...cands].sort((a, b) => b.value.length - a.value.length || b.c - a.c);
    const kept = [];
    for (const g of byLen) {
      const redundant = kept.some(k =>
        k.value.length > g.value.length && k.value.includes(g.value) && k.c >= g.c * r);
      if (!redundant) kept.push(g);
    }
    return kept.sort((a, b) => b.c - a.c || b.value.length - a.value.length);
  }

  /**
   * Deep, delimiter-free motif search: frequent substrings that recur ACROSS
   * values even when embedded (POWER inside HYDROPOWERUNIT). More expensive than
   * segments() — it generates character n-grams — so it runs on a bounded sample
   * and is meant to be triggered on demand.
   *
   * @param {object} o  { query, from, col, total,
   *                      minLen=3, maxLen=12, sampleRows=2000, minShare=0.1,
   *                      capLen=40, limit=40 }
   * @returns {{substrings:{value,c,example}[], sampleRows:number, total:number}}
   */
  async function substrings(o) {
    const { query, from, col, total } = o;
    const minLen = o.minLen || 3;
    // maxLen is generous on purpose: when a gram can span a whole recurring
    // string, maximalSubstrings() absorbs its sub-windows, so the result is the
    // motif itself instead of a cloud of overlapping fragments.
    const maxLen = o.maxLen || 24;
    const sampleRows = o.sampleRows || 2000;
    const minShare = o.minShare != null ? o.minShare : 0.1;
    const capLen = o.capLen || 40;   // ignore very long tails when generating n-grams
    const limit = o.limit || 40;

    const v = `left(CAST(${col} AS VARCHAR), ${capLen})`;
    const sample = `SELECT ${v} AS v FROM ${from} WHERE ${col} IS NOT NULL LIMIT ${sampleRows}`;
    const cnt = Number(qrx.duckdb.rows(await query(`SELECT count(*)::BIGINT AS c FROM (${sample})`))[0].c);
    if (!cnt) return { substrings: [], sampleRows: 0, total: total || 1 };
    const minSupport = Math.max(2, Math.ceil(cnt * minShare));

    // Generate every n-gram (length minLen..maxLen) of every sampled value via
    // two correlated range() table functions, then count how many DISTINCT
    // values contain each gram.
    const res = await query(
      `WITH s AS (${sample}), `
      + `g AS (SELECT substring(v, pos, len) AS gram, v FROM s, `
      + `range(${minLen}, ${maxLen + 1}) AS n(len), range(1, length(v) - len + 2) AS p(pos) `
      + `WHERE length(v) >= len) `
      + `SELECT gram, count(DISTINCT v)::BIGINT AS c, min(v) AS example FROM g `
      + `WHERE gram <> '' GROUP BY gram HAVING count(DISTINCT v) >= ${minSupport} `
      + `ORDER BY length(gram) DESC, c DESC LIMIT 400`);
    const cands = qrx.duckdb.rows(res).map(r => ({
      value: r.gram, c: Number(r.c), example: r.example == null ? '' : String(r.example),
    }));
    return { substrings: maximalSubstrings(cands).slice(0, limit), sampleRows: cnt, total: total || 1 };
  }

  // Classify the analysed masks into a dominant "normal" set and the deviating
  // long tail. A value is an outlier when its mask is not one of the few that
  // dominate the column — a cheap, honest signal for dirty data (a stray
  // format, a typo, a wrong country code).
  //
  // Only meaningful when the column HAS a dominant shape. For free-text columns
  // (names, notes) no single mask reaches `dominantFloor`, so we report
  // hasDominant=false and flag nothing — better silent than crying wolf on
  // every distinct value.
  //
  // Operates on one already-analysed mode (exact or compact), so it costs
  // nothing extra: the high-share masks are always within analyze()'s top-N.
  //
  // @param {{rows:{pat,c,example}[],distinct:number}} d  one mode from analyze()
  // @param {number} nonNull  non-null row count (total - nulls)
  // @param {{minShare?:number,dominantFloor?:number}} [opts]
  // @returns {{hasDominant,normalPats:Set,outlierCount,outlierShare,topShare}}
  function outliers(d, nonNull, opts) {
    opts = opts || {};
    // A mask counts as "normal" at or above minShare; the column only has a
    // dominant shape at all if its top mask clears dominantFloor.
    const minShare = opts.minShare != null ? opts.minShare : 0.15;
    const dominantFloor = opts.dominantFloor != null ? opts.dominantFloor : 0.4;
    const none = { hasDominant: false, normalPats: new Set(), outlierCount: 0, outlierShare: 0, topShare: 0 };
    if (!d || !d.rows || !d.rows.length || !nonNull) return none;
    const topShare = d.rows[0].c / nonNull;
    if (topShare < dominantFloor) { none.topShare = topShare; return none; }
    const normalPats = new Set();
    let normalCount = 0;
    for (const r of d.rows) {
      if (r.c / nonNull >= minShare) { normalPats.add(r.pat); normalCount += r.c; }
    }
    const outlierCount = Math.max(0, nonNull - normalCount);
    return { hasDominant: true, normalPats, outlierCount, outlierShare: outlierCount / nonNull, topShare };
  }

  /**
   * Fetch the actual deviating values — the rows whose mask is NOT one of the
   * dominant "normal" masks. Companion to outliers(): that one counts, this one
   * shows. Same mode (exact/compact) as the masks it is given.
   *
   * @param {object} o
   * @param {(sql:string)=>Promise<any>} o.query
   * @param {string} o.from
   * @param {string} o.col            quoted column identifier
   * @param {boolean} o.compact
   * @param {string[]|Set<string>} o.normalPats  the masks to treat as normal
   * @param {number} [o.limit=50]
   * @returns {{rows:{value,mask}[], shown:number, total:number}}
   */
  async function outlierRows(o) {
    const { query, from, col } = o;
    const compact = !!o.compact;
    const limit = o.limit || 50;
    const masks = (o.normalPats instanceof Set) ? [...o.normalPats] : (o.normalPats || []);
    if (!masks.length) return { rows: [], shown: 0, total: 0 };

    const expr = maskExpr(col, compact);
    const inList = masks.map(m => qrx.duckdb.str(m)).join(', ');
    const where = `${col} IS NOT NULL AND (${expr}) NOT IN (${inList})`;

    const res = await query(
      `SELECT CAST(${col} AS VARCHAR) AS ex, ${expr} AS pat `
      + `FROM ${from} WHERE ${where} LIMIT ${limit}`);
    const rows = qrx.duckdb.rows(res).map(r => ({
      value: r.ex == null ? '' : String(r.ex), mask: String(r.pat),
    }));
    const cres = await query(`SELECT count(*)::BIGINT AS c FROM ${from} WHERE ${where}`);
    const total = Number(qrx.duckdb.rows(cres)[0].c);
    return { rows, shown: rows.length, total };
  }

  qrx.patterns = { maskExpr, compactDisplay, maskToRegex, analyze, segments, substrings, matchSql, outliers, outlierRows };
})();
