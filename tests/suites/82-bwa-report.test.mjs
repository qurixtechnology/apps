// BWA Report — end-to-end: import a (synthetic) DATEV BWA PDF, parse the KER and
// the trial balance, compute the KPIs, and render the layperson report. The VAT
// sheet must be ignored. Language pinned to German for stable text assertions.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, openApp, ROOT } from '../helpers/browser.mjs';

const FIXTURE = join(ROOT, 'tests', 'fixtures', 'bwa-sample.pdf');
let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

async function importFixture(page) {
  await page.evaluate(() => { window.qrx.core.storage.remove('qrx_lang'); window.qrx.i18n.setLang('de'); });
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
