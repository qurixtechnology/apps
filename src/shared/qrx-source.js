// ============================================================================
// qrx.source — one way in for every file an app can read.
//
// The problem it solves: profiler, cleaner and validator each accepted only
// Parquet, each with their own registration code, while the converter knew how
// to read a dozen formats. Widening the others by copying the converter's
// readers would have widened the performance trap with them — a VIEW over a
// CSV re-parses the whole file on EVERY access, and those apps query their
// source dozens of times.
//
// So this module normalises instead of branching:
//
//   Parquet  -> passed through untouched. Registered as a lazy handle, queried
//               by byte range, footer metadata intact. Exactly what the apps do
//               today; nothing gets slower.
//   CSV/JSON -> rewritten ONCE into a zstd-Parquet inside DuckDB's virtual file
//   /NDJSON     system (one COPY, no round trip through JS), then queried like
//               any other Parquet. One O(n) pass instead of one per query.
//   everything  reported as 'external'. Excel, SQLite, DuckDB files, Markdown
//   else        and HTML need an engine outside DuckDB or a "which table?"
//               decision — that is the Table Format Converter's job, and
//               callers get a typed error they can turn into a link.
//
// The result is that a consuming app sees ONE kind of source: a FROM expression
// over a Parquet, plus a `normalized` flag. That flag is not cosmetic — see the
// warning on it below.
//
// DOM-free on purpose (like qrx.core and qrx.duckdb). The drop zone, the
// progress display and the "this is large, continue?" question live in
// qrx.ui.sourcePicker.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});

  qrx.i18n.register('source', {
    de: {
      detecting: 'Format wird erkannt…',
      registering: 'Datei wird registriert…',
      normalizing: 'Wird einmalig nach Parquet umgeschrieben…',
      describing: 'Schema wird gelesen…',
      unsupported: 'Dateien vom Typ {kind} können hier nicht direkt gelesen werden — '
        + 'wandle sie zuerst mit dem Table Format Converter in Parquet um.',
      tooLarge: 'Die {kind}-Datei ist mit {size} zu groß, um sie hier im Browser einzulesen — '
        + 'wandle sie mit dem Table Format Converter zu Parquet um (der liest streamend, ohne alles in den Speicher zu laden).',
      mixedKinds: 'Zum Kombinieren bitte nur Dateien desselben Typs auswählen.',
      nFiles: '{n} Dateien',
      raggedRows: 'Die Datei hat Zeilen mit abweichender Spaltenzahl — fehlende Werte wurden '
        + 'mit NULL aufgefüllt, unlesbare Zeilen übersprungen.',
      readFailed: 'Die Datei konnte nicht gelesen werden: {msg}',
    },
    en: {
      detecting: 'Detecting format…',
      registering: 'Registering file…',
      normalizing: 'Rewriting to Parquet, once…',
      describing: 'Reading schema…',
      unsupported: '{kind} files cannot be read here directly — convert them to '
        + 'Parquet with the Table Format Converter first.',
      tooLarge: 'The {kind} file is too large ({size}) to read here in the browser — '
        + 'convert it to Parquet with the Table Format Converter (it streams, without loading everything into memory).',
      mixedKinds: 'To combine files, please pick files of the same type only.',
      nFiles: '{n} files',
      raggedRows: 'The file has rows with differing field counts — missing values were '
        + 'padded with NULL, unreadable rows skipped.',
      readFailed: 'Could not read this file: {msg}',
    },
  });

  const t = (k, p) => qrx.i18n.t('source.' + k, p);

  // --- What happens to which format ----------------------------------------
  // 'lazy'      queried in place — byte-range reads, nothing copied
  // 'normalize' rewritten to Parquet once, then treated as 'lazy'
  // 'external'  not handled here (needs SheetJS / sql.js, or a table choice)
  const PLANS = {
    parquet: 'lazy',
    csv: 'normalize',
    ndjson: 'normalize',
    json: 'normalize',
    xlsx: 'external',
    sqlite: 'external',
    duckdb: 'external',
    markdown: 'external',
    html: 'external',
  };

  /** File extensions this module can open — for an <input accept="…">. */
  const ACCEPT = '.parquet,.pq,.csv,.tsv,.txt,.json,.ndjson,.jsonl';

  // --- Resource policy ------------------------------------------------------
  // Only a `normalize` (CSV/JSON → Parquet) rewrite is memory-hungry: the COPY
  // reads the whole file. Parquet is 'lazy' (byte-range) and never gated, no
  // matter the size. Above CONFIRM the rewrite is worth a heads-up; above BLOCK
  // an in-browser rewrite is likely to run the WASM heap out, so we refuse and
  // point at the converter (which streams the conversion instead).
  const CONFIRM_BYTES = 64 * 1024 * 1024;         // 64 MB — CSV/JSON rewrite
  const BLOCK_BYTES = 1024 * 1024 * 1024;         // 1 GB
  // 'parse' formats (Excel/ODS, Markdown, HTML, sql.js SQLite) are fully
  // decoded in memory and can balloon well past their file size, so they are
  // gated much tighter than a straight CSV rewrite.
  const PARSE_CONFIRM_BYTES = 16 * 1024 * 1024;   // 16 MB
  const PARSE_BLOCK_BYTES = 128 * 1024 * 1024;    // 128 MB
  const fmtBytes = (n) => qrx.core.fmt.bytes(n);

  /** Human label per kind, for messages ("XLSX files cannot be read here"). */
  const LABELS = {
    parquet: 'Parquet', csv: 'CSV', ndjson: 'NDJSON', json: 'JSON',
    xlsx: 'Excel/ODS', sqlite: 'SQLite', duckdb: 'DuckDB',
    markdown: 'Markdown', html: 'HTML',
  };

  // --- Errors --------------------------------------------------------------
  // Typed so a caller can react to the format case without matching on text.
  function SourceError(code, message, extra) {
    const e = new Error(message);
    e.name = 'SourceError';
    e.code = code;                       // 'unsupported-format' | 'read-failed'
    Object.assign(e, extra || {});
    return e;
  }

  // --- Reading slices of a File --------------------------------------------
  function readSliceText(file, start, end) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file.slice(start, end));
    });
  }
  function readSliceBytes(file, start, end) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file.slice(start, end));
    });
  }

  // A UTF-8 BOM would otherwise end up as part of the first token we look at.
  const BOM = String.fromCharCode(0xFEFF);
  const stripBom = (s) => (s.charAt(0) === BOM ? s.slice(1) : s);

  // --- Format detection ----------------------------------------------------
  // Extension first, magic bytes as the fallback. Lifted from the converter,
  // which is where it was proven; it stays the single definition of "what is
  // this file" for every app.
  async function detect(file) {
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
      const text = stripBom(await readSliceText(file, 0, 4096));
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
    const buf = await readSliceBytes(file, 0, 16);
    if (buf[0] === 0x50 && buf[1] === 0x41 && buf[2] === 0x52 && buf[3] === 0x31) return 'parquet';
    if (buf[0] === 0x50 && buf[1] === 0x4B) return 'xlsx';
    // SQLite files start with "SQLite format 3\0"
    if (buf.length >= 6 &&
        buf[0] === 0x53 && buf[1] === 0x51 && buf[2] === 0x4C &&
        buf[3] === 0x69 && buf[4] === 0x74 && buf[5] === 0x65) return 'sqlite';
    // DuckDB v0.10+ files have "DUCK" at offset 8
    if (buf.length >= 12 &&
        buf[8] === 0x44 && buf[9] === 0x55 && buf[10] === 0x43 && buf[11] === 0x4B) return 'duckdb';
    if (ext === 'db') return 'duckdb';
    return 'csv';
  }

  // Best-effort text-encoding sniff from a head-slice byte buffer. Returns one
  // of 'utf-8' | 'utf-16' | 'latin-1'. Non-UTF-8 bytes (German umlauts from a
  // Windows-1252 export, say) would otherwise make DuckDB's CSV reader drop
  // those rows — which, during an unattended normalisation, nobody would see.
  function detectEncoding(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
    if (bytes.length >= 2 && ((bytes[0] === 0xFF && bytes[1] === 0xFE)
                           || (bytes[0] === 0xFE && bytes[1] === 0xFF))) return 'utf-16';
    // A multi-byte UTF-8 char may be split by the slice boundary — trim a
    // partial trailing sequence before the strict decode so it isn't a false miss.
    let end = bytes.length, k = 0;
    while (end > 0 && k < 3 && (bytes[end - 1] & 0xC0) === 0x80) { end--; k++; }
    if (end > 0 && (bytes[end - 1] & 0x80) !== 0) end--;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)); return 'utf-8'; }
    catch (_) { return 'latin-1'; }
  }

  // --- Naming --------------------------------------------------------------
  let seq = 0;
  const EXT_OF = { parquet: 'parquet', csv: 'csv', json: 'json', ndjson: 'ndjson' };

  // The VFS name carries a truthful extension. Nothing here depends on it —
  // every FROM expression names its reader explicitly — but the profiler builds
  // `SELECT * FROM '<vfsName>'` for its per-file views, and there DuckDB picks
  // the reader BY EXTENSION. A wrong one silently reads a CSV as Parquet.
  function vfsNameFor(file, kind, suffix) {
    const safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const base = safe.replace(/\.[^.]*$/, '') || 'file';
    return `qrx_${suffix}_${seq}_${base}.${EXT_OF[kind] || 'bin'}`;
  }

  // --- Reader expressions --------------------------------------------------
  // The raw source, i.e. how the ORIGINAL file is read. Only used as the input
  // of the normalising COPY; consumers never see these.
  function rawFrom(kind, vfs, o = {}) {
    const p = qrx.duckdb.str(vfs);
    if (kind === 'parquet') return `read_parquet(${p})`;
    if (kind === 'ndjson')  return `read_json(${p}, format='newline_delimited', auto_detect=true)`;
    if (kind === 'json')    return `read_json(${p}, format='array', auto_detect=true)`;
    // CSV: auto_detect handles delimiter, header and types. strict_mode=false is
    // "RFC 4180 with real-world tolerance" — it accepts bare LF inside quoted
    // fields (stack traces in exports), which the strict sniffer rejects outright.
    const opts = ['auto_detect=true', 'strict_mode=false'];
    if (o.encoding && o.encoding !== 'utf-8') opts.push(`encoding=${qrx.duckdb.str(o.encoding)}`);
    if (o.tolerant) opts.push('ignore_errors=true', 'null_padding=true');
    return `read_csv(${p}, ${opts.join(', ')})`;
  }

  // --- Opening -------------------------------------------------------------

  function readFailed(e) {
    const msg = (e && e.message) ? e.message : String(e);
    return SourceError('read-failed', t('readFailed', { msg }), { cause: e });
  }
  const cleanup = (...names) => qrx.duckdb.dropFiles(names);

  const describeNames = async (from) => qrx.duckdb.rows(
    await qrx.duckdb.query(`DESCRIBE SELECT * FROM ${from}`)).map(r => r.column_name);

  // DuckDB's CSV sniffer does NOT fail on a file with inconsistent field counts.
  // It quietly falls back to "one column per line" and hands back the raw text
  // under a header like `a,b,c` — no exception, no warning. An app would show a
  // single VARCHAR column and nobody would know why. Retrying on an error alone
  // would therefore never trigger; the strict result has to be looked at.
  //
  // The tolerant read is kept only when it actually recovers more columns, so a
  // genuinely single-column file whose header happens to contain a comma is
  // left as it is.
  const DELIM_IN_NAME = /[,;\t|]/;
  async function chooseCsvSource(vfs, encoding, warnings) {
    const strict = rawFrom('csv', vfs, { encoding });
    const tolerant = rawFrom('csv', vfs, { encoding, tolerant: true });
    let cols = null;
    try { cols = await describeNames(strict); } catch (_) { /* fall through */ }
    if (cols && !(cols.length === 1 && DELIM_IN_NAME.test(cols[0]))) return strict;
    try {
      const tcols = await describeNames(tolerant);
      if (!cols || tcols.length > cols.length) { warnings.push(t('raggedRows')); return tolerant; }
    } catch (_) { /* keep the strict read and let the COPY report the problem */ }
    return strict;
  }

  /**
   * What open() will do, without doing it — so a caller can warn or ask first.
   * @returns { kind, plan, label, supported, willNormalize, bytes }
   */
  async function inspect(file) {
    const kind = await detect(file);
    const plan = PLANS[kind] || 'external';
    return {
      kind, plan,
      label: LABELS[kind] || kind.toUpperCase(),
      supported: plan !== 'external',
      willNormalize: plan === 'normalize',
      bytes: file.size,
    };
  }

  /**
   * The one place that decides how to treat a file, so every app reacts the
   * same. Reads only the sniff bytes, never the whole file.
   *
   * opts: { kind (skip detect), confirmBytes, blockBytes }
   * @returns {{ kind,label,plan,bytes,supported,willNormalize,
   *             decision:'ok'|'confirm'|'block', recommendConverter, message }}
   *   - 'block'   : cannot / should not load here → recommendConverter, message set
   *   - 'confirm' : loadable but a large rewrite → ask before doing the work
   *   - 'ok'      : just load it
   */
  async function preflight(file, opts = {}) {
    const kind = opts.kind || await detect(file);
    const plan = PLANS[kind] || 'external';
    const label = LABELS[kind] || kind.toUpperCase();
    const bytes = file.size;
    const base = { kind, label, plan, bytes, supported: plan !== 'external', willNormalize: plan === 'normalize' };
    if (plan === 'external') {
      return Object.assign(base, { decision: 'block', recommendConverter: true, message: t('unsupported', { kind: label }) });
    }
    // 'lazy' (Parquet) and 'attach' (DuckDB/SQLite) are byte-range / catalogue
    // reads — never gated on size. Only a full read ('normalize', 'parse') is.
    const gated = plan === 'normalize' || plan === 'parse';
    if (!gated) return Object.assign(base, { decision: 'ok', recommendConverter: false, message: '' });
    const isParse = plan === 'parse';
    const confirmBytes = opts.confirmBytes != null ? opts.confirmBytes : (isParse ? PARSE_CONFIRM_BYTES : CONFIRM_BYTES);
    const blockBytes = opts.blockBytes != null ? opts.blockBytes : (isParse ? PARSE_BLOCK_BYTES : BLOCK_BYTES);
    if (blockBytes && bytes > blockBytes) {
      return Object.assign(base, { decision: 'block', recommendConverter: true, message: t('tooLarge', { kind: label, size: fmtBytes(bytes) }) });
    }
    if (confirmBytes && bytes > confirmBytes) {
      return Object.assign(base, { decision: 'confirm', recommendConverter: false, message: '' });
    }
    return Object.assign(base, { decision: 'ok', recommendConverter: false, message: '' });
  }

  /**
   * Preflight a whole batch that will be COMBINED into one source. Requires a
   * single kind, sums the sizes for the size decision, and surfaces the
   * mixed-type case as its own block.
   */
  async function preflightMany(files, opts = {}) {
    const list = Array.from(files || []).filter(Boolean);
    if (list.length <= 1) return list.length ? preflight(list[0], opts) : null;
    const kinds = [];
    for (const f of list) kinds.push(await detect(f));
    if (kinds.some(k => k !== kinds[0])) {
      return { kind: null, plan: null, supported: false, willNormalize: false, bytes: 0,
               decision: 'block', recommendConverter: false, message: t('mixedKinds') };
    }
    const totalBytes = list.reduce((s, f) => s + f.size, 0);
    // Reuse the single-file policy on the aggregate, tagged with the shared kind.
    const p = await preflight({ size: totalBytes, name: list[0].name }, Object.assign({}, opts, { kind: kinds[0] }));
    return Object.assign(p, { bytes: totalBytes, count: list.length });
  }

  /**
   * Open a file as a queryable source.
   *
   * opts: { onStatus(msg), kind (skip detection), keepRaw (leave the original
   *         registration in place — the converter needs it) }
   *
   * @returns a descriptor:
   *   { id, name, bytes, kind, plan, normalized, vfsName, rawVfsName, from,
   *     handle, rows, columns: [{name,type,typeClass}], encoding, warnings[] }
   *
   * `from` is a finished FROM expression — `SELECT * FROM ${desc.from}`.
   *
   * `normalized === true` means the bytes being queried are OUR Parquet, not
   * the user's file. Row groups, compression and encodings then describe
   * DuckDB's writer defaults. Anything that reports on FILE STRUCTURE (the
   * profiler) must say so rather than present it as the user's data.
   */
  async function open(file, opts = {}) {
    const say = (m) => { try { opts.onStatus && opts.onStatus(m); } catch (_) {} };
    const id = 'src' + (seq++);

    say(t('detecting'));
    const kind = opts.kind || await detect(file);
    const plan = PLANS[kind] || 'external';
    // 'attach' (DuckDB/SQLite) and 'parse' (Excel/Markdown/HTML) are handled by
    // the optional qrx-source-ext module. Delegate when it is loaded; otherwise
    // they behave like any other unsupported format.
    if ((plan === 'attach' || plan === 'parse') && qrx.source && qrx.source.openExternal) {
      return qrx.source.openExternal(file, Object.assign({}, opts, { kind, plan }));
    }
    if (plan === 'external' || plan === 'attach' || plan === 'parse') {
      throw SourceError('unsupported-format',
        t('unsupported', { kind: LABELS[kind] || kind.toUpperCase() }), { kind });
    }

    await qrx.duckdb.init({ onStatus: say });
    const warnings = [];

    say(t('registering'));
    const rawVfsName = vfsNameFor(file, kind, 'raw');
    // Always a lazy handle: a normalising COPY reads the bytes exactly once, so
    // buffering them first would only duplicate them in WASM memory. An app that
    // wants a fully buffered Parquet can re-register desc.handle itself.
    await qrx.duckdb.registerHandle(rawVfsName, file);

    let encoding = null;
    let rawExpr;
    if (kind === 'csv') {
      encoding = detectEncoding(await readSliceBytes(file, 0, 64 * 1024));
      rawExpr = await chooseCsvSource(rawVfsName, encoding, warnings);
    } else {
      rawExpr = rawFrom(kind, rawVfsName);
    }

    const desc = {
      id, name: file.name, bytes: file.size, kind, plan,
      normalized: false, handle: file, encoding, warnings,
      vfsName: rawVfsName, rawVfsName,
      from: rawExpr,
      rows: null, columns: [],
    };

    if (plan === 'normalize') {
      say(t('normalizing'));
      const normVfsName = vfsNameFor(file, 'parquet', 'norm');
      const copyTo = (src) => qrx.duckdb.query(
        `COPY (SELECT * FROM ${src}) TO ${qrx.duckdb.str(normVfsName)} `
        + `(FORMAT PARQUET, COMPRESSION 'zstd')`);
      try {
        await copyTo(rawExpr);
      } catch (e) {
        const tolerant = kind === 'csv' && !warnings.length;
        if (!tolerant) { await cleanup(rawVfsName, normVfsName); throw readFailed(e); }
        // A CSV can still fail on rows the sniffer never saw. Last attempt:
        // skip unparseable rows, pad short ones — recorded as a warning,
        // because dropping rows in silence is the failure mode this module
        // exists to prevent.
        try {
          await qrx.duckdb.dropFiles(normVfsName);
          await copyTo(rawFrom('csv', rawVfsName, { encoding, tolerant: true }));
          warnings.push(t('raggedRows'));
        } catch (e2) { await cleanup(rawVfsName, normVfsName); throw readFailed(e2); }
      }
      // The original is no longer needed — the data now lives in the Parquet.
      // Dropping it also releases our reference to the user's File.
      if (!opts.keepRaw) { await qrx.duckdb.dropFiles(rawVfsName); desc.rawVfsName = null; }
      desc.normalized = true;
      desc.vfsName = normVfsName;
      desc.from = `read_parquet(${qrx.duckdb.str(normVfsName)})`;
    }

    say(t('describing'));
    try {
      // Footer lookup — O(1), whatever the file size. True for a passed-through
      // Parquet and for one we just wrote.
      const m = qrx.duckdb.rows(await qrx.duckdb.query(
        `SELECT num_rows FROM parquet_file_metadata(${qrx.duckdb.str(desc.vfsName)})`));
      if (m[0] && m[0].num_rows != null) desc.rows = Number(m[0].num_rows);
    } catch (_) { /* leave null rather than guess */ }

    try {
      const d = qrx.duckdb.rows(await qrx.duckdb.query(`DESCRIBE SELECT * FROM ${desc.from}`));
      desc.columns = d.map(r => ({
        name: r.column_name,
        type: r.column_type,
        typeClass: qrx.duckdb.typeClass(r.column_type),
      }));
    } catch (e) { await release(desc); throw readFailed(e); }

    say('');
    return desc;
  }

  /**
   * Open several same-kind files as ONE combined source. Each file goes through
   * open() (so a CSV is still normalised once, a Parquet still stays a lazy
   * handle), then the parts are stitched with UNION ALL BY NAME so a column that
   * moved or is missing in one file still lines up. A one-element list is just
   * open(). Callers preflight the batch (size, single-kind) via preflightMany().
   *
   * @returns a descriptor like open()'s, plus `parts` (the per-file descriptors);
   *          release() tears the whole set down.
   */
  async function openMany(files, opts = {}) {
    const list = Array.from(files || []).filter(Boolean);
    if (list.length <= 1) return list.length ? open(list[0], opts) : null;
    const say = (m) => { try { opts.onStatus && opts.onStatus(m); } catch (_) {} };

    const kinds = [];
    for (const f of list) kinds.push(await detect(f));
    const kind = kinds[0];
    if (kinds.some(k => k !== kind)) throw SourceError('mixed-kinds', t('mixedKinds'));
    if ((PLANS[kind] || 'external') === 'external') {
      throw SourceError('unsupported-format', t('unsupported', { kind: LABELS[kind] || kind.toUpperCase() }), { kind });
    }

    const parts = [];
    try {
      for (const f of list) parts.push(await open(f, Object.assign({}, opts, { kind, onStatus: say })));
    } catch (e) {
      for (const p of parts) { try { await release(p); } catch (_) {} }
      throw e;
    }

    const desc = {
      id: 'src' + (seq++), name: t('nFiles', { n: list.length }),
      bytes: list.reduce((s, f) => s + f.size, 0),
      kind, plan: PLANS[kind], normalized: parts.some(p => p.normalized),
      from: '(' + parts.map(p => `SELECT * FROM ${p.from}`).join(' UNION ALL BY NAME ') + ')',
      parts, handle: null, encoding: null,
      warnings: parts.flatMap(p => p.warnings || []),
      vfsName: null, rawVfsName: null, rows: null, columns: [],
    };
    say(t('describing'));
    try {
      const d = qrx.duckdb.rows(await qrx.duckdb.query(`DESCRIBE SELECT * FROM ${desc.from}`));
      desc.columns = d.map(r => ({ name: r.column_name, type: r.column_type, typeClass: qrx.duckdb.typeClass(r.column_type) }));
      const c = qrx.duckdb.rows(await qrx.duckdb.query(`SELECT count(*)::BIGINT AS n FROM ${desc.from}`));
      desc.rows = Number(c[0].n);
    } catch (e) {
      for (const p of parts) { try { await release(p); } catch (_) {} }
      throw readFailed(e);
    }
    say('');
    return desc;
  }

  /** Drop everything a descriptor registered. Safe to call twice. */
  async function release(desc) {
    if (!desc) return;
    if (desc.parts) {
      for (const p of desc.parts) { try { await release(p); } catch (_) {} }
      desc.parts = null; desc.from = null;
      return;
    }
    // External sources (ATTACHed DuckDB/SQLite, a sql.js handle) carry their own
    // teardown — DETACH, free the JS engine — as desc.dispose().
    if (typeof desc.dispose === 'function') { try { await desc.dispose(); } catch (_) {} desc.dispose = null; }
    await qrx.duckdb.dropFiles([desc.vfsName, desc.rawVfsName].filter(Boolean));
    desc.vfsName = null; desc.rawVfsName = null; desc.handle = null; desc.from = null;
  }

  qrx.source = {
    ACCEPT, PLANS, LABELS, CONFIRM_BYTES, BLOCK_BYTES, PARSE_CONFIRM_BYTES, PARSE_BLOCK_BYTES,
    detect, inspect, preflight, preflightMany, open, openMany, release,
    // exposed for tests and for callers that want the sniff on its own
    detectEncoding,
    // openExternal is installed by the optional qrx-source-ext module
  };
})();
