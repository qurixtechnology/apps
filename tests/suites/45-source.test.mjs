// qrx.source — the shared ingest layer.
//
// The load-bearing assertion in here is the round trip: a CSV is rewritten with
// COPY … TO '<vfs>.parquet' and then read back out of DuckDB's virtual file
// system in the SAME session. Three apps write Parquet that way today, but all
// of them only copy the bytes OUT — none reads the result back. If that stops
// working, every non-Parquet format loses its fast path silently, so it is
// tested against a real engine rather than mocked.
//
// Files are built in-page (new File([...])) instead of uploaded: it keeps the
// fixtures next to the assertion and covers encodings a repo file would not.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp } from '../helpers/browser.mjs';

let browser, page;
before(async () => {
  browser = await launch();
  page = await openApp(browser, 'parquet-validator.html');
  await page.evaluate(() => window.qrx.duckdb.init());
});
after(async () => { await browser?.close(); });

const CSV = 'id,name,score\n1,Ada,9.5\n2,Grace,8.25\n3,Alan,7\n';

describe('source: format detection', () => {
  test('recognises the formats it can open', async () => {
    const got = await page.evaluate(async () => {
      const mk = (name, body) => new File([body], name);
      const s = window.qrx.source;
      return {
        csv:    await s.detect(mk('a.csv', 'x,y\n1,2\n')),
        tsv:    await s.detect(mk('a.tsv', 'x\ty\n1\t2\n')),
        ndjson: await s.detect(mk('a.ndjson', '{"a":1}\n{"a":2}\n')),
        json:   await s.detect(mk('a.json', '[{"a":1}]')),
        // .json holding one object per line is NDJSON, whatever the extension
        jsonl:  await s.detect(mk('a.json', '{"a":1}\n{"a":2}\n{"a":3}\n')),
      };
    });
    assert.deepEqual(got, { csv: 'csv', tsv: 'csv', ndjson: 'ndjson', json: 'json', jsonl: 'ndjson' });
  });

  test('falls back to magic bytes when the extension lies', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const bytes = (arr, name) => new File([new Uint8Array(arr)], name);
      const PAR1 = [0x50, 0x41, 0x52, 0x31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const ZIP  = [0x50, 0x4B, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const SQLI = [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const DUCK = [0, 0, 0, 0, 0, 0, 0, 0, 0x44, 0x55, 0x43, 0x4B, 0, 0, 0, 0];
      return {
        parquet: await s.detect(bytes(PAR1, 'mystery')),
        xlsx:    await s.detect(bytes(ZIP, 'mystery')),
        sqlite:  await s.detect(bytes(SQLI, 'mystery')),
        duckdb:  await s.detect(bytes(DUCK, 'mystery')),
      };
    });
    assert.deepEqual(got, { parquet: 'parquet', xlsx: 'xlsx', sqlite: 'sqlite', duckdb: 'duckdb' });
  });

  test('inspect() reports the plan before any work happens', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const csv = await s.inspect(new File(['a,b\n1,2\n'], 'x.csv'));
      const par = await s.inspect(new File([new Uint8Array([0x50, 0x41, 0x52, 0x31])], 'x.parquet'));
      const xls = await s.inspect(new File([''], 'x.xlsx'));
      return { csv, par, xls };
    });
    assert.equal(got.csv.plan, 'normalize');
    assert.equal(got.csv.willNormalize, true, 'a CSV must be rewritten, or every query re-parses it');
    assert.equal(got.par.plan, 'lazy');
    assert.equal(got.par.willNormalize, false, 'Parquet must be passed through untouched');
    // qrx-source-ext (loaded here) teaches the module to read Excel — it is a
    // size-gated 'parse' format now, no longer refused.
    assert.equal(got.xls.supported, true);
    assert.equal(got.xls.plan, 'parse');
    assert.equal(got.xls.label, 'Excel/ODS');
  });
});

describe('source: opening a CSV', () => {
  test('rewrites to Parquet and reads the result back', async () => {
    const got = await page.evaluate(async (csv) => {
      const s = window.qrx.source;
      const statuses = [];
      const d = await s.open(new File([csv], 'people.csv'), { onStatus: (m) => statuses.push(m) });
      // Query it the way a consuming app would.
      const rows = window.qrx.duckdb.rows(
        await window.qrx.duckdb.query(`SELECT * FROM ${d.from} ORDER BY id`));
      const out = {
        kind: d.kind, plan: d.plan, normalized: d.normalized, rows: d.rows,
        from: d.from, vfsName: d.vfsName, rawVfsName: d.rawVfsName,
        columns: d.columns.map(c => [c.name, c.type, c.typeClass]),
        warnings: d.warnings, statuses: statuses.filter(Boolean),
        data: rows.map(r => [r.id, r.name, r.score]),
      };
      await s.release(d);
      return out;
    }, CSV);

    assert.equal(got.normalized, true);
    assert.match(got.from, /^read_parquet\('qrx_norm_/, 'consumers must see a Parquet source');
    assert.match(got.vfsName, /\.parquet$/);
    assert.equal(got.rawVfsName, null, 'the original registration is released after the rewrite');
    assert.equal(got.rows, 3, 'row count comes from the Parquet footer');
    assert.deepEqual(got.data, [[1, 'Ada', 9.5], [2, 'Grace', 8.25], [3, 'Alan', 7]]);
    assert.deepEqual(got.columns, [
      ['id', 'BIGINT', 't-number'],
      ['name', 'VARCHAR', 't-string'],
      ['score', 'DOUBLE', 't-number'],
    ], 'auto-detected types survive the rewrite');
    assert.deepEqual(got.warnings, []);
    assert.ok(got.statuses.length >= 2, 'progress is reported while the file is being read');
  });

  test('keeps non-UTF-8 text intact', async () => {
    // A Latin-1 CSV is the classic silent-corruption case: DuckDB rejects the
    // bytes and drops the rows unless the encoding is passed in.
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const text = 'stadt;einwohner\nKöln;1080000\nMünchen;1490000\n';
      const bytes = new Uint8Array([...text].map(ch => ch.charCodeAt(0)));  // latin-1
      const d = await s.open(new File([bytes], 'staedte.csv'));
      const rows = window.qrx.duckdb.rows(
        await window.qrx.duckdb.query(`SELECT * FROM ${d.from} ORDER BY einwohner`));
      const out = { encoding: d.encoding, rows: d.rows, data: rows.map(r => r.stadt) };
      await s.release(d);
      return out;
    });
    assert.equal(got.encoding, 'latin-1');
    assert.equal(got.rows, 2, 'no row may be dropped');
    assert.deepEqual(got.data, ['Köln', 'München']);
  });

  // DuckDB's sniffer does not raise on a file with inconsistent field counts —
  // it silently degrades to a single column holding the raw line text. Without
  // the degenerate-result check in qrx.source, a validator run against such a
  // file would report one VARCHAR column and look like the file's own fault.
  test('recovers a file with ragged rows instead of collapsing it to one column', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source, d3 = window.qrx.duckdb;
      const csv = 'a,b,c\n1,2,3\n4,5\n6,7,8\n';    // row 2 is one field short
      const d = await s.open(new File([csv], 'ragged.csv'));
      const rows = d3.rows(await d3.query(`SELECT * FROM ${d.from} ORDER BY a`));
      const out = {
        rows: d.rows, warnings: d.warnings.length,
        columns: d.columns.map(c => c.name),
        data: rows.map(r => [r.a, r.b, r.c]),
      };
      await s.release(d);
      return out;
    });
    assert.deepEqual(got.columns, ['a', 'b', 'c'], 'the columns must survive one ragged row');
    assert.equal(got.rows, 3, 'no row may be dropped');
    assert.deepEqual(got.data, [[1, 2, 3], [4, 5, null], [6, 7, 8]], 'the gap becomes NULL');
    assert.ok(got.warnings >= 1, 'and the user is told the file was uneven');
  });

  test('a genuinely single-column file is left alone', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const d = await s.open(new File(['a\n1\n2\n'], 'one.csv'));
      const out = { columns: d.columns.map(c => c.name), rows: d.rows, warnings: d.warnings.length };
      await s.release(d);
      return out;
    });
    assert.deepEqual(got.columns, ['a']);
    assert.equal(got.rows, 2);
    assert.equal(got.warnings, 0, 'no warning without a real problem');
  });
});

describe('source: opening a Parquet', () => {
  test('passes it through without copying or rewriting', async () => {
    const got = await page.evaluate(async () => {
      const d3 = window.qrx.duckdb;
      // Build a real Parquet with the engine, then hand it back in as a File.
      await d3.query(`CREATE OR REPLACE TABLE _src AS SELECT * FROM (VALUES
        (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd')) AS t(id, tag)`);
      await d3.query(`COPY _src TO 'made.parquet' (FORMAT PARQUET)`);
      const buf = await d3.db().copyFileToBuffer('made.parquet');
      await d3.query('DROP TABLE _src');
      await d3.dropFiles('made.parquet');

      const s = window.qrx.source;
      const d = await s.open(new File([buf], 'made.parquet'));
      const rows = d3.rows(await d3.query(`SELECT count(*) AS c FROM ${d.from}`));
      const out = {
        kind: d.kind, plan: d.plan, normalized: d.normalized, rows: d.rows,
        from: d.from, count: Number(rows[0].c),
        columns: d.columns.map(c => c.name),
        hasHandle: !!d.handle,
      };
      await s.release(d);
      return out;
    });

    assert.equal(got.kind, 'parquet');
    assert.equal(got.plan, 'lazy');
    assert.equal(got.normalized, false, 'rewriting a Parquet would destroy its real footer metadata');
    assert.match(got.from, /^read_parquet\('qrx_raw_/, 'it is queried where it lies');
    assert.equal(got.rows, 4);
    assert.equal(got.count, 4);
    assert.deepEqual(got.columns, ['id', 'tag']);
    assert.equal(got.hasHandle, true, 'the File stays available for a buffered re-registration');
  });
});

describe('source: refusals and cleanup', () => {
  test('release() drops the registration', async () => {
    const got = await page.evaluate(async (csv) => {
      const s = window.qrx.source;
      const d = await s.open(new File([csv], 'gone.csv'));
      const from = d.from;
      await s.release(d);
      let stillReadable = true;
      try { await window.qrx.duckdb.query(`SELECT * FROM ${from}`); }
      catch (_) { stillReadable = false; }
      return { stillReadable, vfsName: d.vfsName, handle: d.handle };
    }, CSV);
    assert.equal(got.stillReadable, false, 'a released source must not linger in the VFS');
    assert.equal(got.vfsName, null);
    assert.equal(got.handle, null, 'the reference to the user\'s File is dropped too');
  });

  test('the page stayed clean throughout', () => {
    page.assertNoErrors('qrx.source');
  });
});

describe('sourcePicker: the widget around it', () => {
  test('hands a descriptor to the app and reports progress', async () => {
    const got = await page.evaluate(async (csv) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const seen = [], statuses = [];
      const picker = window.qrx.ui.sourcePicker(host, {
        confirmBytes: 0,                                  // never ask in a test
        status: { set: (m, k) => { if (m) statuses.push([m, k || null]); } },
        onSource: (d) => seen.push({ name: d.name, rows: d.rows, normalized: d.normalized }),
      });
      await picker.open(new File([csv], 'via-widget.csv'));
      const out = { seen, statuses: statuses.length, current: !!picker.current() };
      await picker.release();
      out.afterRelease = picker.current();
      picker.destroy(); host.remove();
      return out;
    }, CSV);

    assert.deepEqual(got.seen, [{ name: 'via-widget.csv', rows: 3, normalized: true }]);
    assert.ok(got.statuses > 0, 'the user sees what is happening during the rewrite');
    assert.equal(got.current, true);
    assert.equal(got.afterRelease, null, 'release() forgets the source');
  });

  test('turns an oversized file into a message with a converter link, not an exception', async () => {
    const got = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const errs = [], shown = [];
      const picker = window.qrx.ui.sourcePicker(host, {
        confirmBytes: 0,
        blockBytes: 1,                                   // anything counts as too large
        status: { set: (m, k) => { if (m) shown.push([m, k]); } },
        converterHref: 'table-format-converter.html',
        onError: (e) => errs.push({ code: e.code, kind: e.kind, href: e.converterHref }),
        onSource: () => { throw new Error('must not be called'); },
      });
      const result = await picker.open(new File(['a,b\n1,2\n'], 'big.csv'));
      picker.destroy(); host.remove();
      return { result, errs, shown };
    });

    assert.equal(got.result, null, 'open() resolves to null instead of rejecting');
    assert.equal(got.errs.length, 1);
    assert.equal(got.errs[0].code, 'too-large');
    assert.equal(got.errs[0].kind, 'csv');
    assert.equal(got.errs[0].href, 'table-format-converter.html', 'the app can offer a way out');
    assert.equal(got.shown[0][1], 'error', 'and the message reaches the status bar');
  });

  test('asks before rewriting a file above the threshold', async () => {
    const got = await page.evaluate(async (csv) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const picker = window.qrx.ui.sourcePicker(host, {
        confirmBytes: 1,                                  // anything counts as large
        onSource: () => {},
      });
      const pending = picker.open(new File([csv], 'big.csv'));
      // The dialog is modal and owns the decision — nothing may start before it.
      await new Promise(r => setTimeout(r, 50));
      const dialog = [...document.querySelectorAll('.qrx-modal')].find(m => !m.hidden);
      const hint = dialog ? dialog.querySelector('.qrx-modal-hint').textContent : '';
      dialog.querySelector('[data-key="cancel"]').click();
      const cancelled = await pending;

      // Confirming must let the same file through.
      const p2 = picker.open(new File([csv], 'big.csv'));
      await new Promise(r => setTimeout(r, 50));
      const d2 = [...document.querySelectorAll('.qrx-modal')].find(m => !m.hidden);
      d2.querySelector('[data-key="go"]').click();
      const confirmed = await p2;
      const rows = confirmed ? confirmed.rows : null;

      await picker.release();
      picker.destroy(); host.remove();
      return { asked: !!dialog, hint, cancelled, rows };
    }, CSV);

    assert.equal(got.asked, true, 'a long rewrite must not start unannounced');
    assert.match(got.hint, /big\.csv/, 'the question names the file');
    assert.equal(got.cancelled, null, 'declining opens nothing');
    assert.equal(got.rows, 3, 'confirming opens the file');
  });

  test('the page stayed clean throughout', () => {
    page.assertNoErrors('qrx.ui.sourcePicker');
  });
});

describe('source: preflight policy', () => {
  test('decides format and size before touching the file', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const csv = new File(['a,b\n1,2\n'], 'x.csv');
      const par = new File([new Uint8Array([0x50, 0x41, 0x52, 0x31])], 'x.parquet');
      const xls = new File(['PK'], 'x.xlsx');
      return {
        parquet:     await s.preflight(par),                       // lazy → never gated
        parquetHuge: await s.preflight(par, { confirmBytes: 1, blockBytes: 1 }),
        csvOk:       await s.preflight(csv),
        csvConfirm:  await s.preflight(csv, { confirmBytes: 3 }),
        csvBlock:    await s.preflight(csv, { blockBytes: 3 }),
        xlsxOk:      await s.preflight(xls),                        // parse, small → ok
        xlsxBlock:   await s.preflight(xls, { blockBytes: 1 }),     // parse, over the ceiling
      };
    });
    assert.equal(got.parquet.decision, 'ok');
    assert.equal(got.parquetHuge.decision, 'ok', 'a Parquet is byte-range read — size never matters');
    assert.equal(got.csvOk.decision, 'ok');
    assert.equal(got.csvConfirm.decision, 'confirm', 'a large rewrite is worth a heads-up');
    assert.equal(got.csvBlock.decision, 'block');
    assert.equal(got.csvBlock.recommendConverter, true, 'and points at the streaming converter');
    assert.equal(got.xlsxOk.plan, 'parse');
    assert.equal(got.xlsxOk.decision, 'ok', 'a small Excel file just parses');
    assert.equal(got.xlsxBlock.decision, 'block', 'an oversized parse is refused');
    assert.match(got.xlsxBlock.message, /Converter/);
  });
});

describe('source: combining several files', () => {
  test('openMany unions same-type files into one source', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const a = new File(['id,name\n1,Ada\n2,Grace\n'], 'a.csv');
      const b = new File(['id,name\n3,Alan\n'], 'b.csv');
      const desc = await s.openMany([a, b]);
      const rows = Number(window.qrx.duckdb.rows(
        await window.qrx.duckdb.query(`SELECT count(*)::BIGINT AS n FROM ${desc.from}`))[0].n);
      const out = { rows, cols: desc.columns.map(c => c.name), parts: desc.parts.length, kind: desc.kind };
      await s.release(desc);
      out.afterRelease = desc.from;
      return out;
    });
    assert.equal(got.rows, 3, 'two CSVs become three rows');
    assert.deepEqual(got.cols, ['id', 'name']);
    assert.equal(got.parts, 2);
    assert.equal(got.afterRelease, null, 'release() tears down every part');
  });

  test('preflightMany blocks a mix of types, openMany refuses it', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const csv = new File(['a\n1\n'], 'a.csv');
      const par = new File([new Uint8Array([0x50, 0x41, 0x52, 0x31])], 'b.parquet');
      const pre = await s.preflightMany([csv, par]);
      let code = null;
      try { await s.openMany([csv, par]); } catch (e) { code = e.code; }
      return { decision: pre.decision, message: pre.message, code };
    });
    assert.equal(got.decision, 'block');
    assert.match(got.message, /typ/i, 'names the single-type requirement');
    assert.equal(got.code, 'mixed-kinds');
  });
});

describe('source: exotic formats (qrx-source-ext)', () => {
  test('the extension registered its plans and widened ACCEPT', async () => {
    const got = await page.evaluate(() => ({
      duckdb: window.qrx.source.PLANS.duckdb,
      sqlite: window.qrx.source.PLANS.sqlite,
      markdown: window.qrx.source.PLANS.markdown,
      html: window.qrx.source.PLANS.html,
      hasOpen: typeof window.qrx.source.openExternal === 'function',
      xlsx: window.qrx.source.ACCEPT.includes('.xlsx'),
      duckdbExt: window.qrx.source.ACCEPT.includes('.duckdb'),
    }));
    assert.equal(got.duckdb, 'attach', 'DuckDB files attach lazily');
    assert.equal(got.sqlite, 'parse');
    assert.equal(got.markdown, 'parse');
    assert.equal(got.html, 'parse');
    assert.equal(got.hasOpen, true);
    assert.ok(got.xlsx && got.duckdbExt, 'the picker accepts the new extensions');
  });

  test('preflight: DuckDB attaches (ungated), a parse format is size-gated', async () => {
    const got = await page.evaluate(async () => {
      const s = window.qrx.source;
      const duck = new File([new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0x44, 0x55, 0x43, 0x4B])], 'x.duckdb');
      const md = new File(['# t\n\n| a |\n|---|\n| 1 |\n'], 'x.md');
      return {
        duck: await s.preflight(duck),
        duckHuge: await s.preflight(duck, { confirmBytes: 1, blockBytes: 1 }),
        md: await s.preflight(md, { confirmBytes: 3 }),
      };
    });
    assert.equal(got.duck.plan, 'attach');
    assert.equal(got.duck.decision, 'ok');
    assert.equal(got.duckHuge.decision, 'ok', 'an attached DB is never gated on size');
    assert.equal(got.md.plan, 'parse');
    assert.equal(got.md.decision, 'confirm', 'a parse format is gated like a rewrite');
  });

  test('reads a Markdown pipe table', async () => {
    const got = await page.evaluate(async () => {
      const md = '# People\n\n| id | name |\n|----|------|\n| 1 | Ada |\n| 2 | Grace |\n';
      const desc = await window.qrx.source.openExternal(new File([md], 'x.md'), {});
      const n = Number(window.qrx.duckdb.rows(await window.qrx.duckdb.query(
        `SELECT count(*)::BIGINT AS n FROM ${desc.from}`))[0].n);
      const out = { cols: desc.columns.map(c => c.name), n, normalized: desc.normalized };
      await window.qrx.source.release(desc);
      return out;
    });
    assert.deepEqual(got.cols, ['id', 'name']);
    assert.equal(got.n, 2);
    assert.equal(got.normalized, true, 'parsed once, then queried as a Parquet-fast CSV');
  });

  test('reads an HTML <table>', async () => {
    const got = await page.evaluate(async () => {
      const html = '<table><caption>People</caption><tr><th>id</th><th>name</th></tr>'
        + '<tr><td>1</td><td>Ada</td></tr><tr><td>2</td><td>Grace</td></tr><tr><td>3</td><td>Alan</td></tr></table>';
      const desc = await window.qrx.source.openExternal(new File([html], 'x.html'), {});
      const n = Number(window.qrx.duckdb.rows(await window.qrx.duckdb.query(
        `SELECT count(*)::BIGINT AS n FROM ${desc.from}`))[0].n);
      const out = { cols: desc.columns.map(c => c.name), n };
      await window.qrx.source.release(desc);
      return out;
    });
    assert.deepEqual(got.cols, ['id', 'name']);
    assert.equal(got.n, 3);
  });

  // (DuckDB/SQLite ATTACH is exercised structurally by the plan/preflight tests
  // and by a broken-file refusal below; a full attach round trip needs a real
  // .duckdb/.sqlite file, which cannot be minted in-page — copyFileToBuffer does
  // not see an ATTACH-created database. Covered manually / by the app suites.)

  test('a broken exotic file fails with a typed error, not a crash', async () => {
    const got = await page.evaluate(async () => {
      try {
        // a Markdown file with no pipe table — fails deterministically, no CDN
        await window.qrx.source.open(new File(['just prose, no table here'], 'x.md'));
        return { threw: false };
      } catch (e) {
        return { threw: true, code: e.code, name: e.name };
      }
    });
    assert.equal(got.threw, true);
    assert.equal(got.name, 'SourceError', 'a typed error the app can turn into a message');
    assert.equal(got.code, 'read-failed');
  });
});
