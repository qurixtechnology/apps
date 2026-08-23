// Test Data Generator — end-to-end: generation is deterministic and
// referentially sound, the quality presets behave, the typed CSV → DuckDB load
// keeps types, and every export target produces a valid file. Language pinned
// to German so the asserted status text is stable.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch, openApp } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

async function open() {
  const page = await openApp(browser, 'test-data-generator.html');
  await page.evaluate(() => {
    window.qrx.core.storage.remove('qrx_lang');
    window.qrx.i18n.setLang('de');
  });
  await page.waitForSelector('#tdg-generate', { timeout: 20000 });
  return page;
}

async function generate(page, { size = 30, preset = 'realistic', seed = 'qurix', region = 'de' } = {}) {
  await page.evaluate((s, r) => {
    document.getElementById('tdg-size').value = String(s);
    document.getElementById('tdg-seed').value = 'qurix';
    document.getElementById('tdg-region').value = r;
    document.getElementById('tdg-region').dispatchEvent(new Event('change'));
  }, size, region);
  await page.evaluate((sd) => { document.getElementById('tdg-seed').value = sd; }, seed);
  await page.evaluate((p) => document.querySelector(`.tdg-preset[data-preset="${p}"]`).click(), preset);
  await page.evaluate(() => document.getElementById('tdg-generate').click());
  await page.waitForFunction(
    () => /erzeugt/.test(document.querySelector('#tdg-status .qrx-status-text')?.textContent || ''),
    { timeout: 60000 });
}

describe('test data generator', () => {
  test('generates all linked tables with referential integrity (clean)', async () => {
    const page = await open();
    try {
      await generate(page, { preset: 'clean', size: 40 });
      const r = await page.evaluate(async () => {
        const D = window.qrx.duckdb, st = window.__tdg.state;
        const names = st.tables.map((t) => t.name);
        const desc = window.qrx.duckdb.rows(await D.conn().query('DESCRIBE customers'));
        const typeOf = (c) => (desc.find((x) => x.column_name === c) || {}).column_type;
        const orphanOrders = Number(window.qrx.duckdb.rows(await D.conn().query(
          'SELECT count(*) n FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE c.id IS NULL'))[0].n);
        const orphanItems = Number(window.qrx.duckdb.rows(await D.conn().query(
          'SELECT count(*) n FROM order_items i LEFT JOIN orders o ON i.order_id=o.id WHERE o.id IS NULL'))[0].n);
        const anyIssue = st.tables.some((t) => Object.values(t.issues).some((v) => v > 0));
        // money round-trip: the value read back from DuckDB must match the
        // in-memory value (DECIMAL used to read back as an unscaled integer).
        const cust = st.tables.find((t) => t.name === 'customers');
        const memRow = cust.rows.find((x) => x.revenue_ytd != null);
        const dbRev = Number(window.qrx.duckdb.rows(await D.conn().query(
          `SELECT revenue_ytd FROM customers WHERE id=${memRow.id}`))[0].revenue_ytd);
        return { names, createdAt: typeOf('created_at'), revenue: typeOf('revenue_ytd'),
          orphanOrders, orphanItems, anyIssue, memRev: memRow.revenue_ytd, dbRev };
      });
      assert.deepEqual(r.names, ['customers', 'products', 'employees', 'orders', 'order_items', 'transactions']);
      assert.equal(r.createdAt, 'DATE', 'clean dates stay typed');
      assert.equal(r.revenue, 'DOUBLE', 'money is DOUBLE (round-trips cleanly, unlike DECIMAL in WASM)');
      assert.equal(r.orphanOrders, 0, 'every order references a real customer');
      assert.equal(r.orphanItems, 0, 'every line item references a real order');
      assert.equal(r.anyIssue, false, 'clinically clean injects no issues');
      assert.ok(Math.abs(r.memRev - r.dbRev) < 0.01,
        `money round-trips correctly (memory ${r.memRev} vs DuckDB ${r.dbRev})`);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('the same seed reproduces the exact same data', async () => {
    const page = await open();
    try {
      await generate(page, { preset: 'realistic', seed: 'seed-A', size: 30 });
      const a = await page.evaluate(() => JSON.stringify(window.__tdg.state.tables.map((t) => [t.name, t.count])));
      await generate(page, { preset: 'realistic', seed: 'seed-A', size: 30 });
      const b = await page.evaluate(() => JSON.stringify(window.__tdg.state.tables.map((t) => [t.name, t.count])));
      const first = await page.evaluate(async () =>
        window.qrx.duckdb.rows(await window.qrx.duckdb.conn().query('SELECT customer_no, city FROM customers ORDER BY id LIMIT 5')));
      assert.equal(a, b, 'row counts are identical for the same seed');
      // regenerate once more and compare the first customers row-for-row
      await generate(page, { preset: 'realistic', seed: 'seed-A', size: 30 });
      const second = await page.evaluate(async () =>
        window.qrx.duckdb.rows(await window.qrx.duckdb.conn().query('SELECT customer_no, city FROM customers ORDER BY id LIMIT 5')));
      assert.deepEqual(second, first, 'the generated values themselves are reproducible');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('the "messy" preset injects issues and turns chaos columns into text', async () => {
    const page = await open();
    try {
      await generate(page, { preset: 'messy', size: 40 });
      const r = await page.evaluate(async () => {
        const D = window.qrx.duckdb, st = window.__tdg.state;
        const desc = window.qrx.duckdb.rows(await D.conn().query('DESCRIBE customers'));
        const typeOf = (c) => (desc.find((x) => x.column_name === c) || {}).column_type;
        const total = st.tables.reduce((s, t) => s + Object.values(t.issues).reduce((x, y) => x + y, 0), 0);
        return { createdAt: typeOf('created_at'), total };
      });
      assert.equal(r.createdAt, 'VARCHAR', 'format chaos stores dates as text');
      assert.ok(r.total > 0, 'issues were injected');
      // the on-screen quality report shows chips
      const chips = await page.$$eval('#tdg-report .tdg-issue', (els) => els.length);
      assert.ok(chips > 0, 'the quality report lists issues');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('exports produce valid files (Parquet, ZIP of CSVs, Excel workbook)', async () => {
    const page = await open();
    try {
      await generate(page, { preset: 'realistic', size: 30 });
      const out = await page.evaluate(async () => {
        const captured = [];
        const orig = URL.createObjectURL;
        URL.createObjectURL = (b) => { captured.push(b); return 'blob:stub'; };
        async function run(fmt, scope) {
          captured.length = 0;
          document.querySelector(`.tdg-fmt[data-fmt="${fmt}"]`).click();
          document.getElementById('tdg-export-scope').value = scope;
          document.getElementById('tdg-export-btn').click();
          await new Promise((r) => setTimeout(r, 700));
          const buf = new Uint8Array(await captured[0].arrayBuffer());
          return { size: buf.length, magic: Array.from(buf.slice(0, 4)).map((x) => x.toString(16).padStart(2, '0')).join('') };
        }
        const parquet = await run('parquet', 'current');
        const zip = await run('csv', 'all');
        const xlsx = await run('xlsx', 'all');
        URL.createObjectURL = orig;
        return { parquet, zip, xlsx };
      });
      assert.equal(out.parquet.magic, '50415231', 'Parquet magic PAR1');
      assert.ok(out.parquet.size > 100);
      assert.equal(out.zip.magic.slice(0, 4), '504b', 'ZIP magic PK');
      assert.ok(out.zip.size > 100);
      assert.equal(out.xlsx.magic.slice(0, 4), '504b', 'xlsx is a zip container');
      assert.ok(out.xlsx.size > 100);
      // one blob:stub console error is expected from the capture stub
    } finally { await page.close(); }
  });
});

describe('test data generator — import mode', () => {
  const csvPath = join(tmpdir(), 'tdg-import-fixture.csv');
  before(() => {
    const rows = [['id', 'code', 'email', 'status', 'amount', 'signup', 'score']];
    for (let i = 1; i <= 400; i++) {
      const code = 'CUST-' + String(1000 + i).slice(-4);
      const email = (i % 7 === 0) ? '' : `user${i}@example.com`;   // ~14% nulls
      const status = ['active', 'inactive', 'pending'][i % 3];
      const amount = (10 + (i * 7.13) % 980).toFixed(2);
      const y = 2020 + (i % 4), m = String(1 + (i % 12)).padStart(2, '0'), d = String(1 + (i % 27)).padStart(2, '0');
      rows.push([i, code, email, status, amount, `${y}-${m}-${d}`, i % 101]);
    }
    writeFileSync(csvPath, rows.map((r) => r.join(',')).join('\n'));
  });
  after(() => { try { rmSync(csvPath); } catch (_) {} });

  async function importAndGenerate(page, { rows = 800, seed = 'imp' } = {}) {
    await page.evaluate(() => document.querySelector('.tdg-mode[data-mode="file"]').click());
    await page.waitForSelector('#tdg-file-input', { timeout: 10000 });
    const input = await page.$('#tdg-file-input');
    await input.uploadFile(csvPath);
    await page.waitForFunction(() => window.__tdg && window.__tdg.state.template, { timeout: 60000 });
    await page.evaluate((n, s) => {
      document.getElementById('tdg-file-rows').value = String(n);
      document.getElementById('tdg-seed').value = s;
      document.getElementById('tdg-generate').click();
    }, rows, seed);
    await page.waitForFunction(
      () => /erzeugt/.test(document.querySelector('#tdg-status .qrx-status-text')?.textContent || ''),
      { timeout: 60000 });
  }

  test('derives structure, statistics and patterns from an imported file', async () => {
    const page = await open();
    try {
      await importAndGenerate(page, { rows: 800 });
      const r = await page.evaluate(async () => {
        const D = window.qrx.duckdb, q = D.ident(window.__tdg.state.tables[0].name);
        const R = async (sql) => D.rows(await D.conn().query(sql));
        const desc = await R(`DESCRIBE ${q}`);
        const types = Object.fromEntries(desc.map((x) => [x.column_name, x.column_type]));
        const cnt = Number((await R(`SELECT count(*) n FROM ${q}`))[0].n);
        const badStatus = Number((await R(`SELECT count(*) n FROM ${q} WHERE status NOT IN ('active','inactive','pending')`))[0].n);
        const badCode = Number((await R(`SELECT count(*) n FROM ${q} WHERE code NOT SIMILAR TO 'CUST-[0-9]{4}'`))[0].n);
        const badEmail = Number((await R(`SELECT count(*) n FROM ${q} WHERE email IS NOT NULL AND email NOT SIMILAR TO '[a-z]+[0-9]+@example\\.com'`))[0].n);
        const rng = (await R(`SELECT min(amount) mn, max(amount) mx, min(score) smn, max(score) smx FROM ${q}`))[0];
        const emailNulls = Number((await R(`SELECT count(*) n FROM ${q} WHERE email IS NULL`))[0].n);
        return { types, cnt, badStatus, badCode, badEmail,
          amin: Number(rng.mn), amax: Number(rng.mx), smin: Number(rng.smn), smax: Number(rng.smx),
          emailNullPct: emailNulls / cnt };
      });
      assert.equal(r.cnt, 800, 'generates the requested number of rows');
      assert.equal(r.types.id, 'BIGINT');
      assert.equal(r.types.amount, 'DOUBLE');
      assert.equal(r.types.signup, 'DATE');
      assert.equal(r.types.status, 'VARCHAR');
      assert.equal(r.badStatus, 0, 'categorical values stay within the observed set');
      assert.equal(r.badCode, 0, 'the CUST-#### pattern (constant prefix + digits) is reproduced');
      assert.equal(r.badEmail, 0, 'the e-mail pattern with constant domain is reproduced');
      assert.ok(r.amin >= 10 && r.amax <= 991, `amount stays in the observed range (${r.amin}…${r.amax})`);
      assert.ok(r.smin >= 0 && r.smax <= 100, 'score stays in the observed range');
      assert.ok(r.emailNullPct > 0.05 && r.emailNullPct < 0.25, `null rate is reproduced (${r.emailNullPct.toFixed(2)})`);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('a categorical column can be switched off → synthetic values, no real ones leak', async () => {
    const bankPath = join(tmpdir(), 'tdg-bank-fixture.csv');
    const payers = ['Müller GmbH', 'Schmidt AG', 'Meyer KG', 'Weber & Co', 'Fischer Handel', 'Wagner OHG', 'Becker GmbH', 'Hoffmann AG'];
    const rows = [['booking_no', 'amount', 'payer']];
    for (let i = 1; i <= 300; i++) rows.push(['B-' + (500000 + i), ((i * 3.7) % 2000 - 500).toFixed(2), payers[i % payers.length]]);
    writeFileSync(bankPath, rows.map((r) => r.join(',')).join('\n'));
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('.tdg-mode[data-mode="file"]').click());
      await page.waitForSelector('#tdg-file-input', { timeout: 10000 });
      await (await page.$('#tdg-file-input')).uploadFile(bankPath);
      await page.waitForFunction(() => window.__tdg && window.__tdg.state.template, { timeout: 60000 });

      const col = await page.evaluate(() => {
        const c = window.__tdg.state.template.columns.find((x) => x.name === 'payer');
        return { categorical: !!c.categorical, useCategory: c.useCategory, hasMasks: !!(c.masks && c.masks.length) };
      });
      assert.ok(col.categorical && col.useCategory, 'the name column is detected as a category by default');
      assert.ok(col.hasMasks, 'a synthetic pattern fallback is available so it can be switched off');

      const gen = async () => {
        await page.evaluate(() => { document.getElementById('tdg-file-rows').value = '500'; document.getElementById('tdg-generate').click(); });
        await page.waitForFunction(() => /erzeugt/.test(document.querySelector('#tdg-status .qrx-status-text')?.textContent || ''), { timeout: 60000 });
        return page.evaluate(async (real) => {
          const D = window.qrx.duckdb, q = D.ident(window.__tdg.state.tables[0].name);
          const vals = D.rows(await D.conn().query(`SELECT DISTINCT payer v FROM ${q}`)).map((r) => r.v);
          return { distinct: vals.length, inReal: vals.filter((v) => real.includes(v)).length };
        }, payers);
      };

      // category ON → real values are resampled
      const on = await gen();
      assert.ok(on.distinct <= payers.length && on.inReal === on.distinct, 'with the category on, only real values appear');

      // switch the category OFF, regenerate → synthetic values, none of them real
      await page.evaluate(() => {
        const c = window.__tdg.state.template.columns.find((x) => x.name === 'payer');
        c.useCategory = false;
      });
      const off = await gen();
      assert.ok(off.distinct > payers.length * 3, `synthetic generation yields many new values (${off.distinct})`);
      assert.equal(off.inReal, 0, 'no real name leaks into the synthetic output');
      page.assertNoErrors();
    } finally { await page.close(); try { rmSync(bankPath); } catch (_) {} }
  });

  test('a detected name column uses the Faker — no real fragments leak', async () => {
    // high-cardinality name column (so it is NOT categorical) with recurring
    // real-looking surname fragments that mask-synthesis would otherwise keep.
    const first = ['Andree', 'Jan', 'Piet', 'Klaas', 'Willem', 'Bram', 'Sander', 'Tom', 'Lars', 'Nils'];
    const surn = ['de Boer', 'van Dijk', 'von Neumann', 'de Vries', 'van der Berg'];
    const path = join(tmpdir(), 'tdg-names-fixture.csv');
    const rows = [['id', 'zahlungspflichtiger', 'betrag']];
    let k = 0;
    for (const f of first) for (const s of surn) { k++; rows.push([k, `${f} ${s}`, (k * 3.1).toFixed(2)]); }  // 50 distinct
    writeFileSync(path, rows.map((r) => r.join(',')).join('\n'));
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('.tdg-mode[data-mode="file"]').click());
      await page.waitForSelector('#tdg-file-input', { timeout: 10000 });
      await (await page.$('#tdg-file-input')).uploadFile(path);
      await page.waitForFunction(() => window.__tdg && window.__tdg.state.template, { timeout: 60000 });

      const col = await page.evaluate(() => {
        const c = window.__tdg.state.template.columns.find((x) => x.name === 'zahlungspflichtiger');
        return { semantic: c.semantic, categorical: !!c.categorical };
      });
      assert.equal(col.semantic, 'person', 'the column is recognised as a person name');
      assert.equal(col.categorical, false, 'it is high-cardinality → not a category, Faker applies by default');

      await page.evaluate(() => { document.getElementById('tdg-file-rows').value = '600'; document.getElementById('tdg-generate').click(); });
      await page.waitForFunction(() => /erzeugt/.test(document.querySelector('#tdg-status .qrx-status-text')?.textContent || ''), { timeout: 60000 });
      const leak = await page.evaluate(async (frags) => {
        const D = window.qrx.duckdb, q = D.ident(window.__tdg.state.tables[0].name);
        const vals = D.rows(await D.conn().query(`SELECT DISTINCT zahlungspflichtiger v FROM ${q}`)).map((r) => r.v);
        return { distinct: vals.length, withFragment: vals.filter((v) => frags.some((f) => v.includes(f))).length, sample: vals.slice(0, 4) };
      }, surn);
      assert.equal(leak.withFragment, 0, `no real surname fragment (de Boer, van Dijk, …) appears — samples: ${leak.sample.join(' | ')}`);
      assert.ok(leak.distinct > 10, 'the Faker produces varied synthetic names');
      page.assertNoErrors();
    } finally { await page.close(); try { rmSync(path); } catch (_) {} }
  });
});
