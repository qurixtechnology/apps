// Parquet Validator — the shared rule engine (qrx.rules) tested against real
// DuckDB tables, plus an end-to-end pass through the app (load → suggest →
// validate → offending rows).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, settle, ROOT } from '../helpers/browser.mjs';

const FIX = join(ROOT, 'tests', 'fixtures');
let browser, page;

before(async () => {
  browser = await launch();
  // The engine tests only need qrx.rules + a DuckDB connection; one page does.
  page = await openApp(browser, 'parquet-validator.html', { query: 'qrxtest' });
  await page.evaluate(async () => {
    window.qrx.core.storage.remove('qrx_lang');
    window.qrx.i18n.setLang('de');
    await window.qrx.duckdb.init();
  });
});
after(async () => { await browser?.close(); });

describe('rule engine: validate', () => {
  test('counts violations per rule and the invalid rows overall', async () => {
    const got = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      await q(`CREATE OR REPLACE TABLE v AS SELECT * FROM (VALUES
        (1,'a@b.com','DE-12',10,'ok'),
        (2,'b@c.com','DE-34',20,'ok'),
        (3,'bad','DE-56',30,' spaced'),
        (4,NULL,'XX-9',999,'ok'),
        (5,'d@e.com','DE-78',20,'ok')
      ) AS t(id,email,code,amount,note)`);
      const rules = [
        { col: 'email', type: 'not_null' },                                 // 0 → row4
        { col: 'email', type: 'regex', pattern: '^[^@]+@[^@]+\\.[^@]+$' },   // 1 → row3
        { col: 'amount', type: 'range', min: 1, max: 100 },                 // 2 → row4
        { col: 'amount', type: 'unique' },                                  // 3 → rows2,5
        { col: 'note', type: 'trimmed' },                                   // 4 → row3
        { col: 'code', type: 'length', min: 2, max: 5 },                    // 5 → none
        { type: 'sql', expr: 'amount >= 0' },                              // 6 → none
        { type: 'row_count', min: 3 },                                      // 7 → pass
      ];
      const r = await window.qrx.rules.validate({ query: q, from: 'v', rules, total: 5 });
      return {
        total: r.total, valid: r.valid, invalid: r.invalid, ok: r.ok,
        v: r.results.map(x => x.violations != null ? x.violations : null),
        status: r.results.map(x => x.status),
        rowCountActual: r.results[7].actual,
      };
    });
    assert.equal(got.total, 5);
    assert.deepEqual(got.v, [1, 1, 1, 2, 1, 0, 0, 0], 'per-rule violation counts');
    assert.equal(got.invalid, 4, 'rows 2,3,4,5 each break at least one error rule');
    assert.equal(got.valid, 1);
    assert.equal(got.ok, false, 'error rules failed');
    assert.equal(got.status[5], 'pass', 'length holds');
    assert.equal(got.status[7], 'pass');
    assert.equal(got.rowCountActual, 5);
  });

  test('a warning lowers the score but does not fail the run', async () => {
    const got = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      const rules = [{ col: 'amount', type: 'range', min: 1, max: 100, severity: 'warning' }];
      const r = await window.qrx.rules.validate({ query: q, from: 'v', rules, total: 5 });
      return { ok: r.ok, status: r.results[0].status, invalid: r.invalid };
    });
    assert.equal(got.status, 'warn');
    assert.equal(got.ok, true, 'a warning alone keeps the run ok');
    assert.equal(got.invalid, 0, 'warnings do not count toward invalid rows');
  });

  test('pattern rule flags values off the dominant shape', async () => {
    const got = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      const vals = [];
      for (let i = 0; i < 19; i++) vals.push(`('DE-${10 + i}')`);
      vals.push(`('junk')`);   // the lone outlier, 5%
      await q(`CREATE OR REPLACE TABLE vp AS SELECT * FROM (VALUES ${vals.join(',')}) AS t(code)`);
      const r = await window.qrx.rules.validate({
        query: q, from: 'vp', total: 20,
        rules: [{ col: 'code', type: 'pattern', mode: 'exact' }],
      });
      return r.results[0];
    });
    assert.equal(got.status, 'fail');
    assert.equal(got.violations, 1, 'only the odd shape is flagged');
  });

  test('reference rule checks membership in another table', async () => {
    const got = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      await q(`CREATE OR REPLACE TABLE ref_ids AS SELECT * FROM (VALUES (1),(2),(3)) AS t(id)`);
      await q(`CREATE OR REPLACE TABLE vf AS SELECT * FROM (VALUES (1),(2),(9),(NULL)) AS t(fk)`);
      const r = await window.qrx.rules.validate({
        query: q, from: 'vf', total: 4,
        rules: [{ col: 'fk', type: 'reference', refFrom: 'ref_ids', refCol: 'id' }],
      });
      return r.results[0];
    });
    assert.equal(got.violations, 1, 'only 9 is absent (NULL is not a violation)');
    assert.equal(got.status, 'fail');
  });

  test('sample returns the actual offending rows', async () => {
    const got = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      const res = await window.qrx.rules.sample({
        query: q, from: 'v', rule: { col: 'amount', type: 'range', min: 1, max: 100 }, limit: 20,
      });
      return window.qrx.duckdb.rows(res).map(r => Number(r.amount));
    });
    assert.deepEqual(got, [999], 'the row above the range');
  });

  test('suggest proposes sensible rules from a profile', async () => {
    const types = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      await q(`CREATE OR REPLACE TABLE vs AS SELECT * FROM (VALUES
        (1,'aktiv'),(2,'aktiv'),(3,'gesperrt'),(4,'aktiv'),(5,'gesperrt')
      ) AS t(id,status)`);
      const specs = await window.qrx.rules.suggest({
        query: q, from: 'vs', total: 5,
        columns: [{ name: 'id', category: 'integer' }, { name: 'status', category: 'string' }],
      });
      return specs.map(s => `${s.col}:${s.type}`);
    });
    assert.ok(types.includes('id:not_null'), 'a complete column → not null');
    assert.ok(types.includes('id:unique'), 'all-distinct integer → unique');
    assert.ok(types.includes('status:allowed'), 'low-cardinality text → allowed values');
  });

  test('explain emits the copyable SQL for a rule', async () => {
    const got = await page.evaluate(() => ({
      range: window.qrx.rules.explain({ col: 'amount', type: 'range', min: 1, max: 100 }, 'v').sql,
      count: window.qrx.rules.explain({ type: 'row_count', min: 3 }, 'v').sql,
    }));
    assert.match(got.range, /SELECT \*\s+FROM v\s+WHERE NOT \("amount" IS NULL OR \("amount" >= 1 AND "amount" <= 100\)\)/);
    assert.match(got.count, /SELECT count\(\*\) AS n FROM v\s+-- expected: n >= 3/);
  });

  test('a pattern rule resolves to a mask IN-list before explain/run', async () => {
    const got = await page.evaluate(async () => {
      const q = (sql) => window.qrx.duckdb.query(sql);
      const vals = [];
      for (let i = 0; i < 19; i++) vals.push(`('DE-${10 + i}')`);
      vals.push(`('junk')`);
      await q(`CREATE OR REPLACE TABLE vpat AS SELECT * FROM (VALUES ${vals.join(',')}) AS t(code)`);
      const resolved = await window.qrx.rules.resolve(
        { col: 'code', type: 'pattern', mode: 'exact' }, { query: q, from: 'vpat', total: 20 });
      return { masks: resolved._masks, sql: window.qrx.rules.explain(resolved, 'vpat').sql };
    });
    assert.deepEqual(got.masks, ['AA-99'], 'the dominant mask is resolved');
    assert.match(got.sql, /IN \('AA-99'\)/, 'and baked into the SQL');
  });
});

// ---- language pinned for text assertions (see other app suites) ----
async function openValidator(opts) {
  const p = await openApp(browser, 'parquet-validator.html', opts);
  await p.evaluate(() => { window.qrx.core.storage.remove('qrx_lang'); window.qrx.i18n.setLang('de'); });
  return p;
}

describe('validator app', () => {
  test('load → suggest → validate produces a report', async () => {
    const p = await openValidator({ query: 'qrxtest' });
    try {
      await settle(p, 'load', async () => {
        await (await p.$('#filePicker')).uploadFile(join(FIX, 'pii.parquet'));
      });
      // the dropzone gives way to the workspace once a file is loaded
      const dzHidden = await p.evaluate(() => document.getElementById('dropzone').hidden);
      assert.equal(dzHidden, true, 'the dropzone is hidden after loading');
      // the preview grid shows the loaded rows
      const previewRows = await p.evaluate(() => document.querySelectorAll('#previewGrid table tbody tr').length);
      assert.ok(previewRows > 0, 'the data preview renders rows');

      await settle(p, 'suggest', () => p.evaluate(() => document.getElementById('suggestBtn').click()));
      const ruleCount = await p.evaluate(() => document.querySelectorAll('#rulesList .v-rule').length);
      assert.ok(ruleCount > 0, 'suggestions created rules');

      await settle(p, 'validate', () => p.evaluate(() => document.getElementById('validateBtn').click()));
      const summary = await p.evaluate(() => document.getElementById('resultsSummary').textContent);
      assert.match(summary, /%/, 'a score is shown');
      assert.match(summary, /gültig/, 'German result wording');
      p.assertNoErrors();
    } finally { await p.close(); }
  });

  test('a failing rule shows violations and opens the offending rows', async () => {
    const p = await openValidator({ query: 'qrxtest' });
    try {
      await settle(p, 'load', async () => {
        await (await p.$('#filePicker')).uploadFile(join(FIX, 'pii.parquet'));
      });
      // one rule that must fail: plz within an impossible range
      await p.evaluate(() => {
        const v = window.__qrx.validator;
        document.getElementById('rulesList').innerHTML = '';
        v.addRule({ col: 'plz', type: 'range', min: 100000, max: 200000, severity: 'error' });
      });
      await settle(p, 'validate', () => p.evaluate(() => document.getElementById('validateBtn').click()));
      const failed = await p.evaluate(() => document.querySelectorAll('.v-res.is-fail').length);
      assert.ok(failed >= 1, 'the impossible range fails');

      // expand the offending rows → a result grid appears
      await p.evaluate(() => document.querySelector('.v-res.is-fail .v-res-toggle').click());
      await p.waitForSelector('.v-res.is-fail .v-res-rows table', { timeout: 15000 });
      const cells = await p.evaluate(() => document.querySelectorAll('.v-res.is-fail .v-res-rows table tbody tr').length);
      assert.ok(cells > 0, 'sample rows are listed');
      p.assertNoErrors();
    } finally { await p.close(); }
  });

  test('a ruleset round-trips through the builder', async () => {
    const p = await openValidator({ query: 'qrxtest' });
    try {
      await settle(p, 'load', async () => {
        await (await p.$('#filePicker')).uploadFile(join(FIX, 'pii.parquet'));
      });
      const roundtrip = await p.evaluate(() => {
        const v = window.__qrx.validator;
        document.getElementById('rulesList').innerHTML = '';
        v.addRule({ col: 'iban', type: 'pattern', mode: 'compact', severity: 'error' });
        v.addRule({ col: 'plz', type: 'range', min: 1000, max: 99999, severity: 'warning' });
        const first = JSON.stringify(v.readAllRules());
        // simulate save→load: rebuild from the read specs
        const specs = v.readAllRules();
        document.getElementById('rulesList').innerHTML = '';
        specs.forEach(v.addRule);
        return { first, second: JSON.stringify(v.readAllRules()) };
      });
      assert.equal(roundtrip.second, roundtrip.first, 'specs survive a rebuild unchanged');
      p.assertNoErrors();
    } finally { await p.close(); }
  });

  test('a single rule can be run and its SQL shown inline', async () => {
    const p = await openValidator({ query: 'qrxtest' });
    try {
      await settle(p, 'load', async () => {
        await (await p.$('#filePicker')).uploadFile(join(FIX, 'pii.parquet'));
      });
      await p.evaluate(() => {
        const v = window.__qrx.validator;
        document.getElementById('rulesList').innerHTML = '';
        v.addRule({ col: 'plz', type: 'range', min: 100000, max: 200000, severity: 'error' });
      });
      // run just this rule
      await p.evaluate(() => document.querySelector('.v-rule [data-role="run"]').click());
      await p.waitForSelector('.v-rule .v-inline.is-fail', { timeout: 20000 });
      const count = await p.evaluate(() => document.querySelector('.v-rule .v-inline-count').textContent);
      assert.match(count, /Verstöße/, 'the inline result reports violations');

      // show its SQL, copyable
      await p.evaluate(() => document.querySelector('.v-rule [data-role="sql"]').click());
      await p.waitForSelector('.v-rule .v-sql', { timeout: 20000 });
      const sql = await p.evaluate(() => document.querySelector('.v-rule [data-role="copysql"]').getAttribute('data-sql'));
      assert.match(sql, /SELECT \*[\s\S]*FROM data[\s\S]*WHERE NOT/, 'the violation query is offered to copy');
      p.assertNoErrors();
    } finally { await p.close(); }
  });
});
