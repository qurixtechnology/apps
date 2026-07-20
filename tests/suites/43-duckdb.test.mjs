// qrx.duckdb — the shared engine layer. The conversion tests run against a
// real DuckDB result rather than a hand-built Arrow table: the whole point of
// this module is to get the Arrow edge cases right.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp } from '../helpers/browser.mjs';

let browser, page;
before(async () => {
  browser = await launch();
  page = await openApp(browser, 'parquet-cleaner.html');
  await page.evaluate(() => window.qrx.duckdb.init());
});
after(async () => { await browser?.close(); });

describe('duckdb: SQL quoting', () => {
  test('escapes, quotes and guards against null', async () => {
    const got = await page.evaluate(() => {
      const d = window.qrx.duckdb;
      return {
        esc: d.esc("it's"), str: d.str("it's"), ident: d.ident('a"b'),
        escNull: d.esc(null), identNull: d.ident(undefined), strNull: d.str(null),
      };
    });
    assert.equal(got.esc, "it''s", 'esc returns the bare escaped text');
    assert.equal(got.str, "'it''s'", 'str returns a finished literal');
    assert.equal(got.ident, '"a""b"');
    assert.equal(got.escNull, '', 'null must not become the text "null"');
    assert.equal(got.identNull, '""');
    assert.equal(got.strNull, "''");
  });

  test('quoted identifiers survive a round trip through the engine', async () => {
    const got = await page.evaluate(async () => {
      const d = window.qrx.duckdb;
      const weird = 'a"b c';
      await d.query(`CREATE OR REPLACE TABLE t_q AS SELECT 1 AS ${d.ident(weird)}`);
      const r = d.rows(await d.query('SELECT * FROM t_q'));
      const lit = d.rows(await d.query(`SELECT ${d.str("it's")} AS s`));
      await d.query('DROP TABLE t_q');
      return { cols: Object.keys(r[0]), lit: lit[0].s };
    });
    assert.deepEqual(got.cols, ['a"b c']);
    assert.equal(got.lit, "it's");
  });
});

describe('duckdb: type names', () => {
  test('maps Arrow types to readable SQL names and CSS classes', async () => {
    const got = await page.evaluate(async () => {
      const d = window.qrx.duckdb;
      const res = await d.query(`SELECT 1::BIGINT AS a, 1.5::DOUBLE AS b, 'x' AS c,
                                        DATE '2024-01-15' AS e, TRUE AS f`);
      return d.fields(res.schema).map(f => [f.name, f.type, f.typeClass]);
    });
    assert.deepEqual(got, [
      ['a', 'BIGINT', 't-number'],
      ['b', 'DOUBLE', 't-number'],
      ['c', 'VARCHAR', 't-string'],
      ['e', 'DATE', 't-date'],
      ['f', 'BOOLEAN', 't-bool'],
    ]);
  });
});

describe('duckdb: Arrow to JavaScript', () => {
  test('dates become Date objects, whatever unit Arrow used', async () => {
    const got = await page.evaluate(async () => {
      const d = window.qrx.duckdb;
      const r = d.rows(await d.query(`SELECT DATE '2024-01-15' AS d,
                                             TIMESTAMP '2024-01-15 13:45:30' AS ts,
                                             TIME '13:45:30' AS t`));
      const row = r[0];
      return {
        types: [row.d instanceof Date, row.ts instanceof Date, row.t instanceof Date],
        d: window.qrx.core.fmt.dateByType(row.d, 'DATE'),
        ts: window.qrx.core.fmt.dateByType(row.ts, 'TIMESTAMP'),
      };
    });
    assert.deepEqual(got.types, [true, true, true], 'all date-like columns are converted');
    assert.equal(got.d, '2024-01-15');
    assert.equal(got.ts, '2024-01-15 13:45:30');
  });

  test('BigInt becomes Number when safe and stays BigInt when not', async () => {
    const got = await page.evaluate(async () => {
      const d = window.qrx.duckdb;
      const r = d.rows(await d.query(`SELECT 42::BIGINT AS small,
                                             9007199254740993::BIGINT AS huge`));
      return {
        smallType: typeof r[0].small, small: r[0].small,
        hugeType: typeof r[0].huge, huge: String(r[0].huge),
      };
    });
    assert.equal(got.smallType, 'number', 'counts are usable in arithmetic directly');
    assert.equal(got.small, 42);
    assert.equal(got.hugeType, 'bigint', 'beyond Number.MAX_SAFE_INTEGER precision is kept');
    assert.equal(got.huge, '9007199254740993');
  });

  test('a NULL stays null and does not become a date', async () => {
    const got = await page.evaluate(async () => {
      const d = window.qrx.duckdb;
      const r = d.rows(await d.query('SELECT NULL::DATE AS d, NULL::BIGINT AS n'));
      return [r[0].d, r[0].n];
    });
    assert.deepEqual(got, [null, null]);
  });
});

describe('duckdb: cell rendering', () => {
  test('renders every value kind, and escapes for HTML', async () => {
    const got = await page.evaluate(() => {
      const d = window.qrx.duckdb;
      const day = new Date(Date.UTC(2024, 0, 15, 13, 45, 30));
      return {
        nul: d.cellText(null),
        date: d.cellText(day, 'DATE'),
        stamp: d.cellText(day, 'TIMESTAMP'),
        big: d.cellText(10n ** 20n),
        obj: d.cellText({ a: 1 }),
        text: d.cellText('plain'),
        html: d.cellHtml('<b>"x"</b>'),
      };
    });
    assert.equal(got.nul, 'null');
    assert.equal(got.date, '2024-01-15');
    assert.equal(got.stamp, '2024-01-15 13:45:30');
    assert.equal(got.big, '100000000000000000000');
    assert.equal(got.obj, '{"a":1}');
    assert.equal(got.text, 'plain');
    assert.equal(got.html, '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  });
});

describe('duckdb: lifecycle', () => {
  test('query before init fails with a clear message', async () => {
    const p2 = await openApp(browser, 'parquet-cleaner.html');
    try {
      const msg = await p2.evaluate(async () => {
        try { await window.qrx.duckdb.query('SELECT 1'); return 'no error'; }
        catch (e) { return e.message; }
      });
      assert.match(msg, /not initialized/i);
    } finally { await p2.close(); }
  });

  test('a failed init can be retried instead of poisoning the app', async () => {
    // every app used to cache the rejected promise, so one bad CDN response
    // bricked the page until a reload
    const p2 = await openApp(browser, 'parquet-cleaner.html');
    try {
      const got = await p2.evaluate(async () => {
        const d = window.qrx.duckdb;
        const realWorker = window.Worker;
        window.Worker = function () { throw new Error('simulated worker failure'); };
        let first = 'no error';
        try { await d.init(); } catch (e) { first = e.message; }
        window.Worker = realWorker;
        let second = 'ok';
        try { await d.init(); } catch (e) { second = 'still failing: ' + e.message; }
        return { first, second, conn: !!d.conn() };
      });
      assert.match(got.first, /simulated worker failure/);
      assert.equal(got.second, 'ok', 'the second attempt must actually run again');
      assert.equal(got.conn, true, 'and leave a working connection behind');
      p2.assertNoErrors();
    } finally { await p2.close(); }
  });

  test('the version is exported once, for everyone', async () => {
    const v = await page.evaluate(() => window.qrx.duckdb.VERSION);
    assert.match(v, /^\d+\.\d+/);
  });
});
