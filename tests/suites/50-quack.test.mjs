// DuckDB-server (quack) integration across all three apps.
// Gated: skips with a clear reason when no suitable Python/DuckDB is present.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, settle, text, tableRows, ROOT } from '../helpers/browser.mjs';
import { unavailableReason, startServer, stopServer, queryServer, URI, TOKEN } from '../helpers/quack.mjs';

const reason = unavailableReason();
const opts = reason ? { skip: `quack unavailable: ${reason}` } : {};
let browser;

before(async () => {
  if (reason) return;
  await startServer();
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await stopServer();
});

// The connect dialog is the shared widget (src/shared/qrx-connect.js), so all
// three apps are driven through the same selectors.
const DLG = '.qrx-modal:not([hidden])';
const field = (role) => DLG + ' [data-role="' + role + '"]';
const GO = DLG + ' [data-key="go"]';

async function app(file, opts) {
  const page = await openApp(browser, file, opts);
  await page.evaluate(() => {
    window.qrxDuckServer.vault.forget();          // no leftover token
    window.qrx.core.storage.remove('qrx_lang');   // and no leftover language
    window.qrx.i18n.setLang(document.documentElement.getAttribute('lang') === 'de' ? 'de' : 'en');
  });
  return page;
}

async function openDialog(page, buttonSel) {
  await page.click(buttonSel);
  await page.waitForSelector(DLG, { timeout: 20_000 });
}

async function enterCredentials(page, { remember = false } = {}) {
  await page.evaluate((sel, u) => {
    const e = document.querySelector(sel); e.value = u; e.dispatchEvent(new Event('input'));
  }, field('uri'), URI);
  await page.type(field('token'), TOKEN);
  if (remember) await page.click(field('remember'));
  await page.click(GO);
}

/** Connect and wait for the table picker (selection 'single' or 'multi'). */
async function connectAndPick(page, buttonSel, opts = {}) {
  await openDialog(page, buttonSel);
  await enterCredentials(page, opts);
  await page.waitForSelector(field('table-select') + ':not([hidden]), ' + field('table-picker') + ':not([hidden])',
    { timeout: 120_000 });
}

const connectCleaner = (page, opts) => connectAndPick(page, '#srvConnectBtn', opts);

describe('quack integration', opts, () => {
  test('cleaner: the table picker marks unreachable schemas', async () => {
    const page = await app('parquet-cleaner.html');
    try {
      await connectCleaner(page);
      const options = await page.$$eval(field('table-select') + ' option', os =>
        os.map(o => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled })));
      const hello = options.find(o => o.value === 'hello');
      const orders = options.find(o => o.value === 'orders');
      assert.ok(hello && !hello.disabled, 'main.hello is selectable');
      assert.ok(orders && orders.disabled, 'demo.orders is listed but disabled');
      assert.match(orders.label, /demo\.orders/, 'the schema is shown');
      assert.equal(await page.$eval(field('table-select'), e => e.value), 'hello', 'preselects a reachable table');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('cleaner: loads a server table and cleans it (no streaming-scan error)', async () => {
    const page = await app('parquet-cleaner.html');
    try {
      await connectCleaner(page);
      await page.select(field('table-select'), 'people');
      await settle(page, 'preview', () => page.click(GO));
      assert.match(await text(page, '.qrx-fileinfo-meta'), /DuckDB server · copied into memory · 5 cols · 3 rows/);
      assert.equal((await tableRows(page, '#previewGrid')).length, 3);

      // the full clean + anonymise run — this used to fail with
      // "Multiple streaming scans ... not supported" when the table was a view
      await settle(page, 'scan', () => page.evaluate(() => document.getElementById('reviewScanBtn').click()));
      await settle(page, 'recompute', () => page.evaluate(() => {
        const b = document.getElementById('reviewApplyAllBtn');
        if (b && !b.hidden) b.click();
      }));
      const steps = await page.evaluate(() => document.querySelectorAll('.pc-step').length);
      assert.ok(steps > 0, 'anonymisation rules were applied');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('cleaner: exports the cleaned result back into a server table', async () => {
    const page = await app('parquet-cleaner.html');
    try {
      await connectCleaner(page);
      await page.select(field('table-select'), 'people');
      await settle(page, 'preview', () => page.click(GO));
      await settle(page, 'scan', () => page.evaluate(() => document.getElementById('reviewScanBtn').click()));
      await settle(page, 'recompute', () => page.evaluate(() => {
        const b = document.getElementById('reviewApplyAllBtn');
        if (b && !b.hidden) b.click();
      }));
      await page.click('#exportSrvBtn');
      await page.waitForFunction(() => !document.getElementById('srvExpModal').hidden, { timeout: 20_000 });
      await page.evaluate(() => { document.getElementById('srvExpTable').value = 'people_anon'; });
      await page.click('#srvExpGoBtn');
      await page.waitForFunction(() => /Wrote|Failed/i.test(document.getElementById('exportStatus').textContent)
        || /Failed/i.test(document.getElementById('srvExpStatus').textContent), { timeout: 180_000 });
      assert.match(await text(page, '#exportStatus'), /Wrote people_anon \(3 rows\)/);

      // verified on the SERVER, not through the app
      const src = queryServer('SELECT kunde, email FROM r.main.people ORDER BY id');
      const out = queryServer('SELECT kunde, email FROM r.main.people_anon ORDER BY id');
      assert.equal(out.length, 3);
      const srcMails = new Set(src.map(r => r[1]));
      assert.ok(out.every(r => !srcMails.has(r[1])), 'e-mail addresses were replaced');
      assert.ok(out.every(r => /@/.test(r[1])), 'and still look like addresses');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('profiler: picks server tables and profiles one', async () => {
    const page = await app('parquet-profiler.html', { query: 'qrxtest' });
    try {
      await connectAndPick(page, '#pp-srvConnectBtn');

      const entries = await page.$$eval(field('table-picker') + ' label', ls => ls.map(l => ({
        value: l.querySelector('input').value,
        disabled: l.querySelector('input').disabled,
        text: l.textContent.replace(/\s+/g, ' ').trim(),
      })));
      const orders = entries.find(e => e.value === 'orders');
      assert.ok(orders.disabled && /demo/.test(orders.text), 'unreachable table disabled, with its schema');

      await settle(page, 'profile', () => page.evaluate((pickSel, goSel) => {
        document.querySelector(pickSel + ' input[value="hello"]').checked = true;
        document.querySelector(goSel).click();
      }, field('table-picker'), GO));
      const rec = await page.evaluate(() =>
        window.__qrx.profiler.state.files.map(f => ({ name: f.name, kind: f.kind })));
      assert.deepEqual(rec, [{ name: 'hello', kind: 'duckdb' }]);
      assert.match(await text(page, '#pp-fileList'), /DuckDB-Server/);
      const cards = await page.$$eval('.pp-meta-card', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
      assert.ok(cards.some(c => /Füllgrad/i.test(c) && /%/.test(c)),
        'fill rate is computed remotely although there is no Parquet footer');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('converter: connects, previews and writes a table back', async () => {
    const page = await app('table-format-converter.html');
    try {
      await openDialog(page, '#srvConnectBtn');
      await settle(page, 'preview', () => enterCredentials(page));

      const tables = await page.$$eval('#h_table option', os => os.map(o => o.textContent.trim()));
      assert.ok(tables.includes('main.hello'), JSON.stringify(tables));
      assert.ok(!tables.some(t => /orders/.test(t)), 'unreachable table is not offered');
      assert.match(await text(page, '.qrx-fileinfo-meta'), /not reachable/, 'and the skip is reported');

      await page.evaluate(() => document.querySelector('.format-chip[data-format="duckdb"]').click());
      await page.evaluate(() => { document.getElementById('ex_srv_table').value = 'from_converter'; });
      await page.click('#exportBtn');
      await page.waitForFunction(() => /Wrote|Failed|error/i.test(document.getElementById('exportProgress').textContent),
        { timeout: 180_000 });
      assert.match(await text(page, '#exportProgress'), /Wrote from_converter/);
      assert.equal(Number(queryServer('SELECT count(*) FROM r.main.from_converter')[0][0]), 3);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  // Regression: the DIALOG-first test above skips the export form's own connect
  // path (serverConn.connected is already true). Exporting straight from the
  // form used to throw "srvAttach/srvIsAuthError is not defined" — this drives
  // exactly that path.
  test('converter: exports to DuckDB straight from the export form (no dialog)', async () => {
    const page = await app('table-format-converter.html');
    try {
      await page.waitForSelector('#filePicker', { timeout: 30_000 });
      await (await page.$('#filePicker')).uploadFile(join(ROOT, 'tests/fixtures/tiny.parquet'));
      await page.waitForFunction(() => !document.getElementById('workspace').hidden, { timeout: 120_000 });

      await page.evaluate(() => document.querySelector('.format-chip[data-format="duckdb"]').click());
      await page.evaluate((u, tk) => {
        document.getElementById('ex_srv_uri').value = u;
        document.getElementById('ex_srv_token').value = tk;
        document.getElementById('ex_srv_table').value = 'from_form';
      }, URI, TOKEN);
      await page.click('#exportBtn');
      await page.waitForFunction(
        () => /Wrote|Failed|error|not defined/i.test(document.getElementById('exportProgress').textContent),
        { timeout: 180_000 });
      assert.match(await text(page, '#exportProgress'), /Wrote from_form/, 'the form-driven attach + write works');
      assert.equal(Number(queryServer('SELECT count(*) FROM r.main.from_form')[0][0]), 6);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('token vault: a remembered token reconnects without asking again', async () => {
    // 1) connect and tick "remember"
    let page = await openApp(browser, 'parquet-cleaner.html');
    try {
      await page.evaluate(() => window.qrxDuckServer.vault.forget());
      await connectCleaner(page, { remember: true });
      await page.waitForFunction((u) => window.qrxDuckServer.vault.has(u), { timeout: 20_000 }, URI);
    } finally { await page.close(); }

    // 2) a fresh page goes straight to the table picker, without credential fields
    page = await openApp(browser, 'parquet-cleaner.html');
    try {
      await page.click('#srvConnectBtn');
      await page.waitForSelector(field('table-select') + ':not([hidden])', { timeout: 120_000 });
      assert.equal(await page.$eval(field('token'), e => !!e.offsetParent), false,
        'credential fields stay hidden once the connection stands');
      assert.match(await text(page, DLG + ' .qrx-connect-note'), /Connected to/);
      page.assertNoErrors();
    } finally { await page.close(); }

    // 3) a rejected token is dropped and asked for again
    page = await openApp(browser, 'parquet-cleaner.html');
    try {
      await page.evaluate(async (u) => { await window.qrxDuckServer.vault.put(u, 'wrong-token'); }, URI);
      await page.click('#srvConnectBtn');
      await page.waitForFunction(() => {
        const el = document.querySelector('.qrx-modal:not([hidden]) .qrx-modal-status');
        return el && /rejected|Failed/i.test(el.textContent);
      }, { timeout: 120_000 });
      assert.match(await text(page, DLG + ' .qrx-modal-status'), /rejected/i);
      assert.equal(await page.evaluate((u) => window.qrxDuckServer.vault.has(u), URI), false,
        'the rejected token is discarded');
    } finally { await page.close(); }
  });
});
