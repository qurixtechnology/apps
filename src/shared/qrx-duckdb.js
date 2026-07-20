// ============================================================================
// qrx.duckdb — one DuckDB-WASM layer for every app that queries data.
//
// Four apps used to bootstrap the engine themselves, with four slightly
// different results. The merged version takes the best of each:
//
//   * one pinned version (markdown-display was still on 1.30.0),
//   * WARNING log level (the profiler ran the noisy default),
//   * extension autoload (the profiler never enabled it, so anything that
//     needs a loadable extension failed there),
//   * errors surfaced through a callback instead of being swallowed,
//   * and — new in all four — a failed init can be RETRIED. Every app cached
//     the rejected promise, so one flaky CDN response bricked the app until
//     the page was reloaded.
//
// quack (the DuckDB remote protocol) needs engine >= 1.5.3, which is what
// duckdb-wasm 1.33.1-dev57.0 wraps. Do not downgrade without checking that.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});

  const VERSION = '1.33.1-dev57.0';
  const CDN = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${VERSION}/+esm`;

  let duckdb = null, db = null, conn = null, initPromise = null;

  /**
   * Boot the engine (idempotent).
   * @param opts - optional { onStatus: (msg) => void } progress callback
   */
  function init(opts = {}) {
    if (initPromise) return initPromise;
    const say = (m) => { try { opts.onStatus && opts.onStatus(m); } catch (_) {} };
    initPromise = (async () => {
      say('Loading DuckDB engine…');
      duckdb = await import(CDN);
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
      const worker = new Worker(workerUrl);
      db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      conn = await db.connect();
      try {
        await conn.query('SET autoinstall_known_extensions=1; SET autoload_known_extensions=1;');
      } catch (e) {
        console.warn('qrx.duckdb: could not enable extension autoload', e);
      }
      say('');
    })().catch((e) => {
      // let the next call try again instead of caching the failure forever
      initPromise = null; duckdb = null; db = null; conn = null;
      throw e;
    });
    return initPromise;
  }

  async function query(sql) {
    if (!conn) throw new Error('DuckDB connection not initialized — call qrx.duckdb.init() first');
    return conn.query(sql);
  }

  // --- SQL quoting ---------------------------------------------------------
  // Two conventions coexisted: sqlEscape() returned the bare escaped text,
  // quoteString() returned a finished literal. Both are exported under names
  // that say which is which, so no call site has to guess.
  const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''");
  const str = (s) => "'" + esc(s) + "'";
  const ident = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';

  // --- Arrow → JavaScript --------------------------------------------------
  function friendlyType(arrowType) {
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

  function typeClass(t) {
    const T = String(t).toUpperCase();
    if (/INT|DEC|FLOAT|DOUBLE|NUMERIC|REAL|HUGEINT|UTINY|TINYINT|SMALLINT|BIGINT/.test(T)) return 't-number';
    if (/BOOL/.test(T)) return 't-bool';
    if (/DATE|TIMESTAMP|TIME/.test(T)) return 't-date';
    if (/VARCHAR|TEXT|CHAR|STRING|UTF/.test(T)) return 't-string';
    return 't-other';
  }

  function fields(schema) {
    return schema.fields.map(f => {
      const t = friendlyType(f.type);
      return { name: f.name, type: t, typeClass: typeClass(t) };
    });
  }

  const isDateLike = (arrowType) => !!arrowType && /Date|Time|Timestamp/i.test(arrowType.toString());

  // Arrow hands DuckDB DATE/TIME/TIMESTAMP back as raw numbers (Date32: days,
  // Date64: ms) or BigInt (us / ns). The magnitude tells the unit apart.
  function toDate(v) {
    if (v == null || v instanceof Date) return v;
    let n;
    if (typeof v === 'bigint') n = Number(v);
    else if (typeof v === 'number') n = v;
    else return v;
    if (!Number.isFinite(n)) return v;
    const a = Math.abs(n);
    if (a < 1e6) return new Date(n * 86400000);    // days since epoch
    if (a < 1e13) return new Date(n);              // milliseconds
    if (a < 1e16) return new Date(n / 1000);       // microseconds
    return new Date(n / 1000000);                  // nanoseconds
  }

  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER);
  // A BigInt that fits in a Number becomes one, so arithmetic downstream works
  // without every call site remembering to convert. Anything larger stays a
  // BigInt rather than silently losing precision.
  function unwrapBigInt(v) {
    if (typeof v !== 'bigint') return v;
    return (v <= MAX_SAFE && v >= MIN_SAFE) ? Number(v) : v;
  }

  /** Arrow table -> plain objects: dates as Date, safe BigInts as Number. */
  function rows(table) {
    const cols = table.schema.fields.map(f => ({
      name: f.name,
      convert: isDateLike(f.type) ? toDate : unwrapBigInt,
    }));
    return table.toArray().map(r => {
      const o = {};
      for (const c of cols) o[c.name] = c.convert(r[c.name]);
      return o;
    });
  }

  /** One cell as display text — type-aware, BigInt- and object-safe. */
  function cellText(v, colType) {
    if (v == null) return 'null';
    if (v instanceof Date) return qrx.core.fmt.dateByType(v, colType);
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
    return String(v);
  }

  const cellHtml = (v, colType) => qrx.core.escapeHtml(cellText(v, colType));

  // --- File registration ---------------------------------------------------
  // Always drop first: re-registering under a name that still exists is a
  // silent no-op in some duckdb-wasm versions.
  async function dropFiles(...names) {
    for (const n of names.flat()) {
      if (!n) continue;
      try { await db.dropFile(n); } catch (_) { /* not registered */ }
    }
  }

  /** Lazy registration: DuckDB range-reads the File, nothing is copied. */
  async function registerHandle(name, file) {
    await dropFiles(name);
    await db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  }

  /** Full copy into WASM memory — faster for repeated queries, costs RAM. */
  async function registerBuffer(name, bufferOrFile) {
    const buf = (bufferOrFile instanceof Blob)
      ? new Uint8Array(await bufferOrFile.arrayBuffer())
      : bufferOrFile;
    await dropFiles(name);
    await db.registerFileBuffer(name, buf);
  }

  async function registerText(name, text) {
    await dropFiles(name);
    await db.registerFileText(name, text);
  }

  qrx.duckdb = {
    VERSION, CDN,
    init, query,
    duckdb: () => duckdb, db: () => db, conn: () => conn,
    esc, str, ident,
    friendlyType, typeClass, fields, rows, isDateLike, toDate, unwrapBigInt,
    cellText, cellHtml,
    registerHandle, registerBuffer, registerText, dropFiles,
  };
})();
