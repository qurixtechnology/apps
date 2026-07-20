// Pure-logic tests. No clicking: the functions are called directly in the page
// context (window.qrxDuckServer is always there, window.__qrx only with
// ?qrxtest). Fast and stable — this is where behaviour should be pinned down
// whenever it can be expressed without the UI.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp } from '../helpers/browser.mjs';

let browser, page;

before(async () => {
  browser = await launch();
  page = await openApp(browser, 'parquet-cleaner.html', { query: 'qrxtest' });
});
after(async () => { await browser?.close(); });

describe('shared: schema detection from sqlite_master DDL', () => {
  // quack drops the schema when forwarding a query, so only tables in `main`
  // are readable. The DDL is the only place the real schema shows up.
  const CASES = [
    ['CREATE TABLE hello(id INTEGER);', 'main', true],
    ['CREATE TABLE demo.orders(a INT);', 'demo', false],
    ['CREATE TABLE "my schema"."tbl"(a INT);', 'my schema', false],
    ['CREATE TABLE IF NOT EXISTS sales.q1(a INT);', 'sales', false],
    ['CREATE OR REPLACE TABLE analytics.t(a INT);', 'analytics', false],
    ['CREATE TEMPORARY TABLE tmp(a INT);', 'main', true],
    ['CREATE TABLE db.sch.tbl(a INT);', 'sch', false],
    ['CREATE TABLE "weird.name"(a INT);', 'main', true],   // dot belongs to the name
    ['CREATE TABLE demo . spaced (a INT);', 'demo', false],
    ['CREATE TABLE "a""b".t(a INT);', 'a"b', false],
    ['', 'main', true],
  ];

  test('parses schema and reachability', async () => {
    const got = await page.evaluate(async (ddls) => {
      const fake = { query: async () => ({ toArray: () => ddls.map((sql, i) => ({ name: 't' + i, sql })) }) };
      return (await window.qrxDuckServer.listTables(fake)).map(r => [r.schema, r.reachable]);
    }, CASES.map(c => c[0]));
    got.forEach(([schema, reachable], i) => {
      assert.equal(schema, CASES[i][1], `schema for: ${CASES[i][0]}`);
      assert.equal(reachable, CASES[i][2], `reachable for: ${CASES[i][0]}`);
    });
  });

  test('deduplicates repeated table names', async () => {
    const n = await page.evaluate(async () => {
      const rows = [{ name: 'a', sql: 'CREATE TABLE a(x INT);' }, { name: 'a', sql: 'CREATE TABLE a(x INT);' }];
      const fake = { query: async () => ({ toArray: () => rows }) };
      return (await window.qrxDuckServer.listTables(fake)).length;
    });
    assert.equal(n, 1);
  });
});

describe('shared: SQL helpers', () => {
  test('remoteRef always qualifies through the main schema', async () => {
    const r = await page.evaluate(() => [
      window.qrxDuckServer.remoteRef('hello'),
      window.qrxDuckServer.remoteRef('main.hello'),
      window.qrxDuckServer.remoteRef('we"ird'),
    ]);
    assert.deepEqual(r, ['remote."main"."hello"', 'remote."main"."hello"', 'remote."main"."we""ird"']);
  });

  test('identifier and literal quoting escape their delimiters', async () => {
    const r = await page.evaluate(() => [
      window.qrxDuckServer.ident('a"b'), window.qrxDuckServer.esc("it's"),
    ]);
    assert.deepEqual(r, ['"a""b"', "it''s"]);
  });

  test('auth errors are recognised, other errors are not', async () => {
    const r = await page.evaluate(() => [
      window.qrxDuckServer.isAuthError(new Error('Invalid Input Error: Authentication failed')),
      window.qrxDuckServer.isAuthError(new Error('403 Forbidden')),
      window.qrxDuckServer.isAuthError(new Error('Catalog Error: Table with name x does not exist!')),
      window.qrxDuckServer.isAuthError(new Error('Out of Memory Error')),
    ]);
    assert.deepEqual(r, [true, true, false, false]);
  });
});

describe('shared: token vault', () => {
  test('stores encrypted, round-trips, and forgets per URI', async () => {
    const r = await page.evaluate(async () => {
      const v = window.qrxDuckServer.vault;
      v.forget();                                    // start clean
      await v.put('quack:a', 'secret-A');
      await v.put('quack:b', 'secret-B');
      const raw = localStorage.getItem('qrx_duckdb_conn');
      return {
        available: v.available(),
        plaintextLeak: /secret-A|secret-B/.test(raw),
        a: await v.get('quack:a'),
        b: await v.get('quack:b'),
        last: v.lastUri(),
        hasA: v.has('quack:a'),
        afterForget: (v.forget('quack:a'), [v.has('quack:a'), v.has('quack:b')]),
        missing: await v.get('quack:nope'),
      };
    });
    assert.equal(r.available, true);
    assert.equal(r.plaintextLeak, false, 'token must not be stored in plaintext');
    assert.equal(r.a, 'secret-A');
    assert.equal(r.b, 'secret-B');
    assert.equal(r.last, 'quack:b');
    assert.equal(r.hasA, true);
    assert.deepEqual(r.afterForget, [false, true]);
    assert.equal(r.missing, null);
  });

  test('the AES key is non-extractable', async () => {
    const r = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const q = indexedDB.open('qrx_secrets', 1);
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      });
      const key = await new Promise((res, rej) => {
        const tx = db.transaction('keys', 'readonly').objectStore('keys').get('qrx_duckdb_conn');
        tx.onsuccess = () => res(tx.result); tx.onerror = () => rej(tx.error);
      });
      let exported = 'threw';
      try { await crypto.subtle.exportKey('raw', key); exported = 'LEAKED'; } catch (_) {}
      return { type: key && key.type, extractable: key && key.extractable, exported };
    });
    assert.equal(r.type, 'secret');
    assert.equal(r.extractable, false);
    assert.equal(r.exported, 'threw');
  });

  test('a corrupt entry is dropped instead of throwing', async () => {
    const r = await page.evaluate(async () => {
      const v = window.qrxDuckServer.vault;
      await v.put('quack:c', 'x');
      const all = JSON.parse(localStorage.getItem('qrx_duckdb_conn'));
      all.entries['quack:c'].ct = 'not-base64-!!';
      localStorage.setItem('qrx_duckdb_conn', JSON.stringify(all));
      return { got: await v.get('quack:c'), stillThere: v.has('quack:c') };
    });
    assert.equal(r.got, null);
    assert.equal(r.stillThere, false);
  });
});

describe('cleaner: pipeline SQL', () => {
  test('compiles from the base view and stacks steps in order', async () => {
    const sql = await page.evaluate(() => {
      const c = window.__qrx.cleaner;
      c.state.schema = [{ name: 'name', type: 'VARCHAR' }, { name: 'amount', type: 'DOUBLE' }];
      c.state.pipeline = [
        { kind: 'trim', enabled: true, params: { column: 'name' } },
        { kind: 'case', enabled: true, params: { column: 'name', mode: 'upper' } },
      ];
      return c.compilePipeline();
    });
    assert.match(sql, /FROM original/);
    const up = sql.toUpperCase();
    assert.ok(up.indexOf('TRIM') >= 0 && up.indexOf('UPPER') >= 0, 'both steps present: ' + sql);
  });

  test('disabled steps are skipped', async () => {
    const sql = await page.evaluate(() => {
      const c = window.__qrx.cleaner;
      c.state.schema = [{ name: 'name', type: 'VARCHAR' }];
      c.state.pipeline = [{ kind: 'case', enabled: false, params: { column: 'name', mode: 'upper' } }];
      return c.compilePipeline();
    });
    assert.doesNotMatch(sql.toUpperCase(), /UPPER\(/);
  });
});

describe('cleaner: PII detection rules', () => {
  // Name- and content-matchers are pure — pin them down here rather than
  // through a full scan, which needs data and takes seconds.
  const NAME_HITS = [
    ['email', 'email'], ['email', 'E-Mail'], ['iban', 'iban'], ['iban', 'kontonummer'],
    ['bic', 'BIC'], ['bic', 'swift'], ['phone', 'telefon'], ['zip', 'plz'],
  ];
  test('column names map to the expected PII type', async () => {
    const got = await page.evaluate((pairs) => pairs.map(([, name]) => {
      const t = window.__qrx.cleaner.PII_TYPES.find(t => t.name && t.name.test(name));
      return t ? t.key : null;
    }), NAME_HITS);
    got.forEach((key, i) => assert.equal(key, NAME_HITS[i][0], `name "${NAME_HITS[i][1]}"`));
  });

  const CONTENT = [
    ['email', 'anna.berger@example.com', true],
    ['email', 'not an email', false],
    ['iban', 'DE44500105175407324931', true],
    ['bic', 'DEUTDEFFXXX', true],
    ['iban', 'DEUTDEFFXXX', false],          // BIC must not be read as IBAN
    ['phone', '+49 89 1234567', true],
    ['phone', '2024-01-15', false],          // dates must not be read as phones
    ['phone', '089/12345', true],
  ];
  test('content matchers accept and reject the right values', async () => {
    const got = await page.evaluate((cases) => cases.map(([key, val]) => {
      const t = window.__qrx.cleaner.PII_TYPES.find(t => t.key === key);
      return !!(t && t.content && t.content(val));
    }), CONTENT);
    got.forEach((hit, i) => assert.equal(hit, CONTENT[i][2],
      `${CONTENT[i][0]} vs ${JSON.stringify(CONTENT[i][1])}`));
  });
});
