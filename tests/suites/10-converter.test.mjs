// Table Format Converter — read a format, preview it, export another format,
// and verify the exported CONTENT (not its bytes).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openApp, waitReady, tableRows, ROOT } from '../helpers/browser.mjs';
import { readRows, waitForDownload } from '../helpers/data.mjs';

const FIX = join(ROOT, 'tests', 'fixtures');
const DL = join(ROOT, 'tests', 'artifacts', 'downloads-converter');
let browser;

before(async () => { rmSync(DL, { recursive: true, force: true }); browser = await launch(); });
after(async () => { await browser?.close(); });

async function load(page, file) {
  await page.waitForSelector('#filePicker', { timeout: 30_000 });
  await (await page.$('#filePicker')).uploadFile(join(FIX, file));
  await page.waitForFunction(() => !document.getElementById('workspace').hidden, { timeout: 120_000 });
  await waitReady(page);
}

describe('converter', () => {
  test('reads CSV and previews every row', async () => {
    const page = await openApp(browser, 'table-format-converter.html');
    try {
      await load(page, 'tiny.csv');
      const rows = await tableRows(page, '#previewGrid');
      assert.equal(rows.length, 6, 'six data rows incl. the duplicate');
      assert.equal(rows[0][1], 'Anna Berger');
      assert.equal(rows[3][1], 'Dora Klein, MBA', 'quoted comma survives the CSV sniffer');
      assert.equal(rows[4][2], 'null', 'an empty CSV field is shown as NULL, not as empty text');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('reads Parquet, NDJSON and JSON with the same shape', async () => {
    for (const f of ['tiny.parquet', 'tiny.ndjson', 'tiny.json']) {
      const page = await openApp(browser, 'table-format-converter.html');
      try {
        await load(page, f);
        const rows = await tableRows(page, '#previewGrid');
        assert.ok(rows.length >= 3, `${f}: expected rows, got ${rows.length}`);
        assert.equal(rows[0][1], 'Anna Berger', f);
        page.assertNoErrors(f);
      } finally { await page.close(); }
    }
  });

  test('CSV → Parquet export keeps the data', async () => {
    const page = await openApp(browser, 'table-format-converter.html', { downloadPath: DL });
    try {
      await load(page, 'tiny.csv');
      await page.evaluate(() => document.querySelector('.format-chip[data-format="parquet"]').click());
      await page.click('#exportBtn');
      await page.waitForFunction(() => /Done|failed|error/i.test(document.getElementById('exportProgress').textContent),
        { timeout: 180_000 });
      const file = await waitForDownload(DL);
      assert.match(file, /\.parquet$/);
      const rows = await readRows(browser, file);
      assert.equal(rows.length, 6);
      assert.equal(rows[0].name, 'Anna Berger');
      assert.equal(Number(rows[0].amount), 1250.5, 'numeric column stays numeric');
      assert.equal(rows[3].name, 'Dora Klein, MBA');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('CSV → NDJSON export keeps the data', async () => {
    const dl = DL + '-ndjson';
    rmSync(dl, { recursive: true, force: true });
    const page = await openApp(browser, 'table-format-converter.html', { downloadPath: dl });
    try {
      await load(page, 'tiny.csv');
      await page.evaluate(() => document.querySelector('.format-chip[data-format="ndjson"]').click());
      await page.click('#exportBtn');
      await page.waitForFunction(() => /Done|failed|error/i.test(document.getElementById('exportProgress').textContent),
        { timeout: 180_000 });
      const file = await waitForDownload(dl);
      const rows = await readRows(browser, file);
      assert.equal(rows.length, 6);
      assert.equal(rows[1].city, 'Wien');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  // Regression: the button lives inside the clickable dropzone, so its click
  // used to bubble up and open the file dialog on top of the modal.
  test('“Connect with DuckDB” does not open the file dialog', async () => {
    const page = await openApp(browser, 'table-format-converter.html');
    try {
      await page.waitForSelector('#srvConnectBtn', { timeout: 30_000 });
      await page.evaluate(() => {
        window.__picker = false;
        document.getElementById('filePicker').click = () => { window.__picker = true; };
        window.qrxDuckServer.vault.forget();   // a remembered token would skip the dialog
      });
      await page.click('#srvConnectBtn');
      await page.waitForSelector('.qrx-modal:not([hidden])', { timeout: 10_000 });
      assert.equal(await page.evaluate(() => window.__picker), false, 'file dialog must stay closed');

      // and the dropzone itself must still open it
      await page.click('.qrx-modal:not([hidden]) [data-key="cancel"]');
      await page.evaluate(() => { window.__picker = false; });
      await page.click('.dz-title');
      assert.equal(await page.evaluate(() => window.__picker), true, 'dropzone still opens the dialog');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('the SQL panel runs a query and pages through the result', async () => {
    const page = await openApp(browser, 'table-format-converter.html');
    try {
      await load(page, 'pii.parquet');                       // 60 rows
      await page.evaluate(() => { document.getElementById('sqlCard').open = true; });
      await page.evaluate(() => {
        document.getElementById('sqlEditor').value = 'SELECT kunde, betrag FROM data ORDER BY kunde';
        document.getElementById('sqlRunBtn').click();
      });
      await page.waitForFunction(() => !document.getElementById('sqlResultWrap').hidden, { timeout: 60_000 });
      const rows = await page.$$eval('#sqlResult tbody tr', tr => tr.length);
      assert.ok(rows > 0, 'the query produced rows');
      const numeric = await page.$$eval('#sqlResult tbody tr:first-child td', td => td.map(x => x.className));
      assert.ok(numeric.includes('qrx-grid-num'), 'the numeric column is right-aligned');
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});
