// BWA Report — end-to-end: import a (synthetic) DATEV BWA PDF, parse the KER and
// the trial balance, compute the KPIs, and render the layperson report. The VAT
// sheet must be ignored. Language pinned to German for stable text assertions.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, ROOT } from '../helpers/browser.mjs';

const FIXTURE = join(ROOT, 'tests', 'fixtures', 'bwa-sample.pdf');       // Muster GmbH, Mar/2025 (Jan–Mar)
const FIX_JAN = join(ROOT, 'tests', 'fixtures', 'bwa-2025-01.pdf');
const FIX_FEB = join(ROOT, 'tests', 'fixtures', 'bwa-2025-02.pdf');
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

// localStorage is shared across pages of the same browser, so start each test clean.
async function fresh(page) {
  await page.waitForFunction(() => window.__bwa && window.__bwa.reset, { timeout: 20000 });
  await page.evaluate(() => { window.qrx.core.storage.remove('qrx_lang'); window.__bwa.reset(); window.qrx.i18n.setLang('de'); });
}
async function importFixture(page) {
  await fresh(page);
  await page.waitForSelector('#bwa-file', { timeout: 20000 });
  await (await page.$('#bwa-file')).uploadFile(FIXTURE);
  await page.waitForFunction(() => window.__bwa && window.__bwa.parsed, { timeout: 60000 });
  await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
}

describe('bwa report', () => {
  test('parses the KER + trial balance into the expected KPIs (VAT sheet ignored)', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        const p = window.__bwa.parsed, K = window.__bwa.kpis(p), A = window.__bwa.assess(K);
        const round = (n) => Math.round(n * 100) / 100;
        return {
          company: p.meta.company, months: p.meta.monthsElapsed,
          umsatzYtd: K.umsatzYtd, betriebsergebnisYtd: K.betriebsergebnisYtd,
          marge: round(K.umsatzrenditeYtd), personalquote: round(K.personalquoteYtd),
          liq: {
            cash: K.liquidity.cash, receivables: K.liquidity.receivables, stLiab: K.liquidity.shortTermLiab,
            net: K.liquidity.netLiquidity, prov: K.liquidity.provisions, runway: round(K.liquidity.runwayMonths),
          },
          assess: A,
          susaAccounts: p.susa.length,
        };
      });
      assert.equal(r.company, 'Muster GmbH');
      assert.equal(r.months, 3);
      assert.equal(r.umsatzYtd, 30000);
      assert.equal(r.betriebsergebnisYtd, 9000);
      assert.equal(r.marge, 0.3);
      assert.equal(r.personalquote, 0.4);
      assert.deepEqual(r.liq, { cash: 20000, receivables: 5000, stLiab: 3500, net: 21500, prov: 2000, runway: 2.86 });
      assert.equal(r.assess.ertrag, 'good');
      assert.equal(r.assess.liqui, 'good');
      assert.equal(r.assess.overall, 'good');
      // VAT page carries no S/H accounts → the 1.900 figure never enters the model
      assert.ok(!r.susa || true);
      const cashHasVat = await page.evaluate(() =>
        window.__bwa.parsed.susa.some((a) => Math.abs(a.saldoAbs - 1900) < 0.01));
      assert.equal(cashHasVat, false, 'the VAT return value is not picked up as an account');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('renders the report with KPI cards, a rating and recommendations', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const dom = await page.evaluate(() => ({
        company: document.getElementById('bwa-company').textContent,
        cards: document.querySelectorAll('#bwa-body .bwa-card').length,
        goodDots: document.querySelectorAll('#bwa-body .bwa-dot.bwa-good').length,
        recs: document.querySelectorAll('#bwa-body .bwa-recs li').length,
        hasGlance: /Auf einen Blick/.test(document.getElementById('bwa-body').textContent),
        hasOverall: /Gesamteinsch/.test(document.getElementById('bwa-body').textContent),
        kerRows: document.querySelectorAll('#bwa-body .bwa-table tbody tr').length,
        hasBetriebsergebnisRow: /Betriebsergebnis/.test(document.querySelector('#bwa-body .bwa-table')?.textContent || ''),
      }));
      assert.equal(dom.company, 'Muster GmbH');
      assert.ok(dom.cards >= 8, `KPI cards rendered (${dom.cards})`);
      assert.ok(dom.goodDots >= 3, 'green traffic-light dots for a healthy business');
      assert.ok(dom.recs >= 3, `recommendations rendered (${dom.recs})`);
      assert.ok(dom.hasGlance && dom.hasOverall, 'sections and overall rating present');
      assert.ok(dom.kerRows >= 8, `the KER detail table is filled (${dom.kerRows} rows)`);
      assert.ok(dom.hasBetriebsergebnisRow, 'the P&L detail includes the operating result');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('adds the year projection and a tax-reserve orientation with tooltips', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        const K = window.__bwa.kpis(window.__bwa.parsed);
        const body = document.getElementById('bwa-body').textContent;
        return {
          runRateUmsatz: Math.round(K.runRateUmsatz), runRateErgebnis: Math.round(K.runRateErgebnis),
          tax: K.taxCheck && { base: K.taxCheck.base, expected: Math.round(K.taxCheck.expected), reserved: K.taxCheck.reserved, loss: K.taxCheck.lossCarry },
          runrateShown: /Hochrechnung aufs Jahr/.test(body), taxShown: /Steuer-R/.test(body),
          infoIcons: document.querySelectorAll('#bwa-body .bwa-info').length,
          tooltip: document.querySelector('#bwa-body .bwa-info')?.getAttribute('title') || '',
        };
      });
      assert.equal(r.runRateUmsatz, 120000, 'revenue run-rate = YTD × 12/months');
      assert.equal(r.runRateErgebnis, 36000);
      assert.deepEqual(r.tax, { base: 9000, expected: 2700, reserved: 0, loss: 0 }, 'tax orientation for the GmbH');
      assert.ok(r.runrateShown && r.taxShown, 'year projection and tax box are rendered');
      assert.ok(r.infoIcons >= 8, `glossary tooltips present (${r.infoIcons})`);
      assert.ok(r.tooltip.length > 10, 'the info icon carries an explanatory tooltip');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('imports several monthly BWAs and builds a sorted trend', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.waitForSelector('#bwa-file', { timeout: 20000 });
      await (await page.$('#bwa-file')).uploadFile(FIX_JAN, FIX_FEB, FIXTURE);   // Jan, Feb, Mar
      await page.waitForFunction(() => window.__bwa && window.__bwa.parsed
        && Object.keys(window.__bwa.store['Muster GmbH'] || {}).length === 3, { timeout: 60000 });
      const r = await page.evaluate(() => {
        const store = window.__bwa.store, comp = Object.keys(store)[0];
        const series = window.__bwa.seriesFor(comp);
        return {
          companies: Object.keys(store).length, months: Object.keys(store[comp]).length,
          labels: series.map((s) => s.label), umsatz: series.map((s) => s.umsatz),
          erg: series.map((s) => s.betriebsergebnis), cash: series.map((s) => s.cash),
          chips: document.querySelectorAll('#bwa-periods .bwa-chip').length,
          trendShown: /Entwicklung/.test(document.getElementById('bwa-trend').textContent),
          svgs: document.querySelectorAll('#bwa-trend svg').length,
          trendRows: document.querySelectorAll('#bwa-trend .bwa-table tbody tr').length,
        };
      });
      assert.equal(r.companies, 1);
      assert.equal(r.months, 3, 'three months stored');
      assert.deepEqual(r.labels, ['Jan/2025', 'Feb/2025', 'Mar/2025'], 'sorted chronologically');
      assert.deepEqual(r.umsatz, [8000, 9000, 10000], 'monthly revenue from each BWA month column');
      assert.deepEqual(r.erg, [2000, 2500, 3000]);
      assert.deepEqual(r.cash, [15000, 18000, 20000], 'cash trend from each month-end trial balance');
      assert.equal(r.chips, 3, 'a period chip per month');
      assert.ok(r.trendShown, 'trend section is rendered');
      assert.ok(r.svgs >= 2, 'revenue/result and cash charts rendered');
      assert.equal(r.trendRows, 3, 'a trend-table row per month');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('a stored session is restored on reload (persistence)', async () => {
    let page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.waitForSelector('#bwa-file', { timeout: 20000 });
      await (await page.$('#bwa-file')).uploadFile(FIX_JAN, FIX_FEB);
      await page.waitForFunction(() => Object.keys((window.__bwa.store['Muster GmbH'] || {})).length === 2, { timeout: 60000 });
    } finally { await page.close(); }
    // a brand-new page (same origin) must restore the two months from localStorage
    page = await openApp(browser, 'bwa-report.html');
    try {
      await page.waitForFunction(() => window.__bwa && Object.keys(window.__bwa.store['Muster GmbH'] || {}).length === 2, { timeout: 20000 });
      const shown = await page.evaluate(() => !document.getElementById('bwa-report').hidden
        && document.querySelectorAll('#bwa-periods .bwa-chip').length);
      assert.equal(shown, 2, 'the report reopens with both stored months');
      await page.evaluate(() => window.__bwa.reset());   // clean up for later tests
    } finally { await page.close(); }
  });

  test('switching language re-renders the report in English', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      await page.evaluate(() => window.qrx.i18n.setLang('en'));
      const txt = await page.evaluate(() => document.getElementById('bwa-body').textContent);
      assert.match(txt, /At a glance/);
      assert.match(txt, /Overall assessment/);
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});
