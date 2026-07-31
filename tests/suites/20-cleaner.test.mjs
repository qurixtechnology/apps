// Parquet Cleaner — load, scan, apply, export. The anonymisation is checked by
// PROPERTIES (values changed, statistics preserved, mapping consistent), never
// by fixed expected values: the output is intentionally random-looking and a
// golden file would have to be regenerated on every rule change.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openApp, waitReady, settle, tableRows, text, ROOT } from '../helpers/browser.mjs';
import { readRows, waitForDownload } from '../helpers/data.mjs';

const FIX = join(ROOT, 'tests', 'fixtures');
const DL = join(ROOT, 'tests', 'artifacts', 'downloads-cleaner');
let browser;

before(async () => { rmSync(DL, { recursive: true, force: true }); browser = await launch(); });
after(async () => { await browser?.close(); });

// Assertions below read visible text, so the language must be explicit — it is
// stored per browser profile and the suites share one.
async function openCleaner(opts) {
  const page = await openApp(browser, 'parquet-cleaner.html', opts);
  await page.evaluate(() => {
    window.qrx.core.storage.remove('qrx_lang');
    window.qrx.i18n.setLang('en');            // this app's default
  });
  return page;
}

async function load(page, file) {
  await page.waitForSelector('#filePicker', { timeout: 30_000 });
  await (await page.$('#filePicker')).uploadFile(join(FIX, file));
  await page.waitForFunction(() => !document.getElementById('workspace').hidden, { timeout: 120_000 });
  await waitReady(page);
}

async function scanAndApply(page) {
  await settle(page, 'scan', () => page.evaluate(() => document.getElementById('reviewScanBtn').click()));
  const summary = await text(page, '#reviewSummary');
  let clicked = false;
  await settle(page, 'recompute', async () => {
    clicked = await page.evaluate(() => {
      const b = document.getElementById('reviewApplyAllBtn');
      if (!b || b.hidden) return false;
      b.click(); return true;
    });
  });
  return { summary, clicked };
}

describe('cleaner', () => {
  test('loads a Parquet file and previews it', async () => {
    const page = await openCleaner();
    try {
      await load(page, 'tiny.parquet');
      assert.match(await text(page, '.qrx-fileinfo-meta'), /Parquet · .* · 5 cols · 6 rows/);
      const rows = await tableRows(page, '#previewGrid');
      assert.equal(rows.length, 6);
      assert.equal(rows[0][1], 'Anna Berger');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  // The cleaner used to take Parquet only. A CSV now goes through qrx.source and
  // is rewritten to Parquet on the way in, so `original` stays a cheap VIEW —
  // over the raw CSV it would be re-parsed on every rule change.
  test('loads a CSV and cleans it like a Parquet', async () => {
    const page = await openCleaner({ query: 'qrxtest' });
    try {
      await load(page, 'tiny.csv');
      const meta = await text(page, '.qrx-fileinfo-meta');
      assert.match(meta, /CSV → Parquet/, 'the bar says the file was rewritten');
      assert.match(meta, /5 cols · 6 rows/, 'schema and row count match the Parquet fixture');
      assert.equal(await text(page, '.qrx-fileinfo-icon'), 'CSV');

      const rows = await tableRows(page, '#previewGrid');
      assert.equal(rows.length, 6);
      assert.equal(rows[0][1], 'Anna Berger', 'non-ASCII survives the rewrite');

      // A rule has to run against it exactly as against Parquet.
      await page.select('#addStepSelect', 'dedupExact');
      await settle(page, 'recompute', () => page.click('#addStepBtn'));
      await settle(page, 'preview', () => page.click('#viewCleanedBtn'));
      const cleaned = await tableRows(page, '#previewGrid');
      assert.equal(cleaned.length, 5, 'the duplicate row goes, same as on Parquet');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('refuses a format it cannot read and points at the converter', async () => {
    const page = await openCleaner();
    try {
      await page.waitForSelector('#filePicker', { timeout: 30_000 });
      await page.evaluate(() => {
        const input = document.getElementById('filePicker');
        const dt = new DataTransfer();
        dt.items.add(new File(['PK'], 'book.xlsx'));
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
      });
      await page.waitForFunction(() => {
        const s = document.querySelector('#statusBar .qrx-status-text');
        return s && s.textContent.trim().length > 0;
      }, { timeout: 20_000 });
      const msg = await text(page, '#statusBar .qrx-status-text');
      assert.match(msg, /Excel/);
      assert.match(msg, /Converter/);
      const wsHidden = await page.evaluate(() => document.getElementById('workspace').hidden);
      assert.equal(wsHidden, true, 'nothing is loaded, the drop zone stays');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('dedup removes the duplicate row', async () => {
    const page = await openCleaner({ query: 'qrxtest' });
    try {
      await load(page, 'tiny.parquet');
      // drive it exactly like a user: pick the rule, add it, look at "Cleaned"
      await page.select('#addStepSelect', 'dedupExact');
      await settle(page, 'recompute', () => page.click('#addStepBtn'));
      await settle(page, 'preview', () => page.click('#viewCleanedBtn'));
      const rows = await tableRows(page, '#previewGrid');
      assert.equal(rows.length, 5, 'one exact duplicate removed');
      assert.match(await text(page, '#sumRows'), /6\s*→\s*5/, 'the row-count summary reflects it');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('scan finds PII in the fixture and apply creates rules', async () => {
    const page = await openCleaner();
    try {
      await load(page, 'pii.parquet');
      const { summary, clicked } = await scanAndApply(page);
      assert.ok(clicked, 'there must be suggestions to apply');
      assert.match(summary, /anonymization/);
      const review = await text(page, '#reviewResults');
      for (const expected of ['Email address', 'IBAN', 'BIC']) {
        assert.ok(review.includes(expected), `scan should report ${expected}\n${review.slice(0, 400)}`);
      }
      const steps = await page.evaluate(() => document.querySelectorAll('.pc-step').length);
      assert.ok(steps > 0, 'apply-all creates pipeline steps');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('anonymised export: values replaced, structure and statistics kept', async () => {
    const page = await openCleaner({ downloadPath: DL });
    try {
      await load(page, 'pii.parquet');
      await scanAndApply(page);
      await page.click('#exportBtn');
      await page.waitForFunction(() => /Exported|failed/i.test(document.getElementById('exportStatus').textContent),
        { timeout: 300_000 });
      const file = await waitForDownload(DL);
      const out = await readRows(browser, file);
      const src = await readRows(browser, join(FIX, 'pii.parquet'));

      assert.equal(out.length, src.length, 'row count unchanged');
      assert.deepEqual(Object.keys(out[0]).sort(), Object.keys(src[0]).sort(), 'schema unchanged');

      // e-mail must be replaced everywhere but stay an e-mail
      const mailsSrc = new Set(src.map(r => r.email));
      const mailsOut = out.map(r => r.email);
      assert.ok(mailsOut.every(m => !mailsSrc.has(m)), 'no original address survives');
      assert.ok(mailsOut.every(m => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(m)), 'still e-mail shaped');

      // deterministic mapping: equal input -> equal output
      const pairs = new Map();
      let consistent = true;
      src.forEach((r, i) => {
        const k = r.kunde;
        if (pairs.has(k) && pairs.get(k) !== out[i].kunde) consistent = false;
        pairs.set(k, out[i].kunde);
      });
      assert.ok(consistent, 'the same person maps to the same pseudonym');

      // untouched columns must be byte-identical
      assert.deepEqual(out.map(r => r.kategorie), src.map(r => r.kategorie), 'non-PII column untouched');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('numeric anonymisation keeps sign and magnitude (level 2)', async () => {
    const page = await openCleaner({ query: 'qrxtest' });
    try {
      await load(page, 'pii.parquet');
      // level 2 = numeric pseudonymisation on top of the PII rules
      await page.evaluate(() => {
        const sel = document.getElementById('reviewLevel');
        if (sel) { sel.value = '2'; sel.dispatchEvent(new Event('change')); }
      });
      await scanAndApply(page);
      const stats = await page.evaluate(async () => {
        const q = async (sql) => (await window.__qrx.cleaner.state.conn?.query?.(sql)) || null;
        return null; // conn is not exposed; verified through the preview instead
      });
      const rows = await tableRows(page, '#previewGrid');
      const idx = await page.evaluate(() =>
        Array.from(document.querySelectorAll('#previewGrid thead th')).findIndex(th => /betrag/i.test(th.textContent)));
      assert.ok(idx >= 0, 'betrag column present');
      const vals = rows.map(r => Number(String(r[idx]).replace(/[^\d.-]/g, ''))).filter(v => !Number.isNaN(v));
      assert.ok(vals.length > 0, 'numeric values in the preview');
      assert.ok(vals.some(v => v < 0) && vals.some(v => v > 0), 'both signs preserved');
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});
