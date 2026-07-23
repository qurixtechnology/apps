// Parquet Profiler — profiling a file, the column table, multi-file handling
// and the SQL editor.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, settle, text, ROOT } from '../helpers/browser.mjs';

const FIX = join(ROOT, 'tests', 'fixtures');
let browser;

before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

// The language is stored per browser profile and the suites share one, so a
// test that asserts on visible text has to state which language it expects.
async function openProfiler(opts) {
  const page = await openApp(browser, 'parquet-profiler.html', opts);
  await page.evaluate(() => {
    window.qrx.core.storage.remove('qrx_lang');
    window.qrx.i18n.setLang('de');            // this app's default
  });
  return page;
}

async function loadFiles(page, ...files) {
  await page.waitForSelector('#pp-fileInput', { timeout: 30_000 });
  await settle(page, 'profile', async () => {
    await (await page.$('#pp-fileInput')).uploadFile(...files.map(f => join(FIX, f)));
  });
}

const cards = (page) => page.$$eval('.pp-meta-card', els =>
  els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));

describe('profiler', () => {
  test('profiles a Parquet file from its footer', async () => {
    const page = await openProfiler();
    try {
      await loadFiles(page, 'tiny.parquet');
      const c = await cards(page);
      const rowsCard = c.find(x => /Zeilen/i.test(x));
      assert.ok(rowsCard, 'row-count card present: ' + JSON.stringify(c));
      assert.match(rowsCard, /\b6\b/, 'six rows');
      assert.ok(c.some(x => /Attribute/i.test(x) && /\b5\b/.test(x)), 'five columns: ' + JSON.stringify(c));
      // the footer row count must be reported next to the scanned one
      assert.match(rowsCard, /Footer/i, 'footer metadata is read');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('lists every column with its type', async () => {
    const page = await openProfiler({ query: 'qrxtest' });
    try {
      await loadFiles(page, 'tiny.parquet');
      const cols = await page.evaluate(() => window.__qrx.profiler.state.columns.map(c => [c.name, c.category]));
      assert.deepEqual(cols.map(c => c[0]), ['id', 'name', 'city', 'amount', 'booked_on']);
      const byName = Object.fromEntries(cols);
      assert.equal(byName.id, 'integer');
      assert.equal(byName.name, 'string');
      assert.equal(byName.amount, 'numeric');
      assert.equal(byName.booked_on, 'temporal', 'a date column is recognised as temporal');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('handles several files and switches the active one', async () => {
    const page = await openProfiler({ query: 'qrxtest' });
    try {
      await loadFiles(page, 'tiny.parquet', 'pii.parquet');
      const files = await page.evaluate(() => window.__qrx.profiler.state.files.map(f => [f.name, f.alias]));
      assert.equal(files.length, 2);
      const list = await text(page, '#pp-fileList');
      assert.match(list, /tiny\.parquet/);
      assert.match(list, /pii\.parquet/);

      // switching the active file re-profiles it
      const otherId = await page.evaluate(() => {
        const s = window.__qrx.profiler.state;
        return s.files.find(f => f.id !== s.activeFileId).id;
      });
      await settle(page, 'profile', () => page.evaluate((id) => {
        document.querySelector(`.pp-file-item[data-id="${id}"]`).click();
      }, otherId));
      const active = await page.evaluate(() => {
        const s = window.__qrx.profiler.state;
        return s.files.find(f => f.id === s.activeFileId).name;
      });
      assert.equal(active, 'pii.parquet');
      assert.ok((await cards(page)).some(x => /Attribute/i.test(x) && /\b10\b/.test(x)), 'pii fixture has 10 columns');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('SQL editor queries the active file through the data view', async () => {
    const page = await openProfiler();
    try {
      await loadFiles(page, 'tiny.parquet');
      await page.evaluate(() => document.querySelector('[data-tab="sql"]').click());
      await page.evaluate(() => {
        const ed = document.getElementById('pp-sqlEditor');
        ed.value = "SELECT city, count(*) AS n FROM data WHERE city IS NOT NULL GROUP BY 1 ORDER BY 1";
        ed.dispatchEvent(new Event('input'));
        document.getElementById('pp-sqlRunBtn').click();
      });
      await page.waitForFunction(() => /Zeile|Fehler/i.test(document.getElementById('pp-sqlStatus').textContent),
        { timeout: 60_000 });
      const status = await text(page, '#pp-sqlStatus');
      assert.doesNotMatch(status, /Fehler/i, status);
      const res = await text(page, '#pp-sqlResult');
      assert.match(res, /Berlin/);
      assert.match(res, /München/);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('a self-join works (would break on a streaming source)', async () => {
    const page = await openProfiler();
    try {
      await loadFiles(page, 'tiny.parquet');
      await page.evaluate(() => document.querySelector('[data-tab="sql"]').click());
      await page.evaluate(() => {
        const ed = document.getElementById('pp-sqlEditor');
        ed.value = 'SELECT a.id FROM data a JOIN data b USING (id) ORDER BY 1 LIMIT 3';
        ed.dispatchEvent(new Event('input'));
        document.getElementById('pp-sqlRunBtn').click();
      });
      await page.waitForFunction(() => /Zeile|Fehler/i.test(document.getElementById('pp-sqlStatus').textContent),
        { timeout: 60_000 });
      assert.doesNotMatch(await text(page, '#pp-sqlStatus'), /Fehler/i);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  // Regression: the connect button sits inside the clickable drop zone.
  test('“Connect with DuckDB” does not open the file dialog', async () => {
    const page = await openProfiler();
    try {
      await page.waitForSelector('#pp-srvConnectBtn', { timeout: 30_000 });
      await page.evaluate(() => {
        window.__picker = false;
        document.getElementById('pp-fileInput').click = () => { window.__picker = true; };
        window.qrxDuckServer.vault.forget();   // a remembered token would skip the dialog
      });
      await page.click('#pp-srvConnectBtn');
      await page.waitForSelector('.qrx-modal:not([hidden])', { timeout: 10_000 });
      assert.equal(await page.evaluate(() => window.__picker), false);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('the SQL editor autocompletes real columns and values', async () => {
    const page = await openProfiler();
    try {
      await loadFiles(page, 'pii.parquet');                  // real columns
      await page.evaluate(() => document.querySelector('[data-tab="sql"]').click());
      const ed = '#pp-sqlEditor';
      // column completion in expression position
      await page.evaluate((sel) => {
        const ta = document.querySelector(sel);
        ta.value = 'SELECT kun'; ta.selectionStart = ta.selectionEnd = ta.value.length;
        ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, ed);
      await new Promise(r => setTimeout(r, 60));
      const cols = await page.$$eval('.qrx-sql-pop-item .qrx-sql-pop-label', els => els.map(e => e.textContent));
      assert.ok(cols.includes('kunde'), 'a real column from the file is offered: ' + JSON.stringify(cols));

      // value completion from a DISTINCT query on that column
      await page.evaluate((sel) => {
        const ta = document.querySelector(sel);
        ta.value = "SELECT * FROM data WHERE kategorie = '";
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, ed);
      await new Promise(r => setTimeout(r, 400));            // async DISTINCT query
      const vals = await page.$$eval('.qrx-sql-pop-item .qrx-sql-pop-label', els => els.map(e => e.textContent));
      assert.ok(vals.length > 0 && vals.every(v => v.startsWith("'")),
        'real values, quoted as string literals: ' + JSON.stringify(vals));
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});

