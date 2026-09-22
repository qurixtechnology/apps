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
          dso: Math.round(K.liquidity.dso),
          breakEvenUmsatz: Math.round(K.breakEven.umsatz), breakEvenSafety: Math.round(K.breakEven.safety * 1000) / 1000,
          custTop1: Math.round(K.concentration.customers.top1 * 1000) / 1000, custCount: K.concentration.customers.count,
          supTop1: Math.round(K.concentration.suppliers.top1 * 1000) / 1000,
        };
      });
      assert.equal(r.company, 'Muster GmbH');
      assert.equal(r.months, 3);
      assert.equal(r.umsatzYtd, 30000);
      assert.equal(r.betriebsergebnisYtd, 9000);
      assert.equal(r.marge, 0.3);
      assert.equal(r.personalquote, 0.4);
      assert.deepEqual(r.liq, { cash: 20000, receivables: 5000, stLiab: 3500, net: 21500, prov: 2000, runway: 2.86 });
      assert.equal(r.dso, 15, 'DSO = receivables / revenue × days');
      assert.equal(r.breakEvenUmsatz, 18750, 'break-even = fixed / contribution ratio');
      assert.equal(r.breakEvenSafety, 0.375);
      assert.equal(r.custTop1, 0.6, 'top customer share of receivables');
      assert.equal(r.custCount, 3);
      assert.equal(r.supTop1, 0.8, 'top supplier share of payables');
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
        hasBetriebsergebnisRow: /Betriebsergebnis/.test(document.querySelector('#bwa-body .bwa-details .bwa-table')?.textContent || ''),
        hasWaterfall: !!document.querySelector('#bwa-body .bwa-wf-total'),
        hasRisk: /Kundenstruktur/.test(document.getElementById('bwa-body').textContent) && /Lieferantenstruktur/.test(document.getElementById('bwa-body').textContent),
        hasExpenseDrill: /Einzel-Aufwandskonten/.test(document.getElementById('bwa-body').textContent),
        tabs: document.querySelectorAll('#bwa-body .bwa-tab').length,
        panels: document.querySelectorAll('#bwa-body .bwa-tabpanel').length,
        visiblePanels: [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].filter((p) => !p.hidden).length,
        hasDso: /Forderungslaufzeit/.test(document.getElementById('bwa-body').textContent),
      }));
      assert.equal(dom.company, 'Muster GmbH');
      assert.ok(dom.cards >= 8, `KPI cards rendered (${dom.cards})`);
      assert.ok(dom.goodDots >= 3, 'green traffic-light dots for a healthy business');
      assert.ok(dom.recs >= 3, `recommendations rendered (${dom.recs})`);
      assert.ok(dom.hasGlance && dom.hasOverall, 'sections and overall rating present');
      assert.ok(dom.kerRows >= 8, `the KER detail table is filled (${dom.kerRows} rows)`);
      assert.ok(dom.hasBetriebsergebnisRow, 'the P&L detail includes the operating result');
      assert.ok(dom.hasWaterfall, 'the GuV waterfall is rendered');
      assert.ok(dom.hasRisk, 'the customer/supplier concentration sections are rendered');
      assert.ok(dom.hasExpenseDrill, 'the expense drill-down is rendered');
      assert.ok(dom.hasDso, 'DSO card is rendered');
      assert.equal(dom.tabs, 5, 'five topic tabs (overview, revenue, costs, taxes, liquidity)');
      assert.equal(dom.panels, 5, 'a panel per tab');
      assert.equal(dom.visiblePanels, 1, 'only the active tab panel is visible');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('organises the report into topic tabs and switches on click', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const labels = await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].map((b) => b.textContent));
      assert.deepEqual(labels, ['Überblick', 'Einnahmen', 'Ausgaben / Kosten', 'Steuern', 'Liquidität']);
      // Overview is active by default and holds the cockpit.
      const before = await page.evaluate(() => {
        const active = document.querySelector('#bwa-body .bwa-tabpanel:not([hidden])');
        return { tab: active.dataset.tab, hasCockpit: !!active.querySelector('.bwa-cockpit') };
      });
      assert.equal(before.tab, 'overview');
      assert.ok(before.hasCockpit, 'the overview tab holds the cockpit');
      // Click the "Steuern" tab → its panel becomes the only visible one.
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'taxes').click());
      const after = await page.evaluate(() => {
        const vis = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].filter((p) => !p.hidden);
        return { count: vis.length, tab: vis[0].dataset.tab, hasTax: /Steuern & Rücklagen/.test(vis[0].textContent),
          activeBtn: document.querySelector('#bwa-body .bwa-tab.is-active').dataset.tab };
      });
      assert.equal(after.count, 1, 'exactly one panel visible after switching');
      assert.equal(after.tab, 'taxes');
      assert.ok(after.hasTax, 'the taxes panel shows the Steuern & Rücklagen content');
      assert.equal(after.activeBtn, 'taxes', 'the clicked tab is marked active');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('renders a cockpit of gauges with the right green/amber/red verdicts', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const g = await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-cockpit .bwa-gauge')].map((el) => ({
        label: el.querySelector('.bwa-gauge-label').textContent.trim(),
        value: el.querySelector('.bwa-gauge-value').textContent,
        cls: [...el.querySelector('.bwa-gauge-verdict').classList].find((c) => c.startsWith('bwa-verd-')),
      })));
      assert.equal(g.length, 6, 'six gauges (margin, safety, runway, concentration, tax coverage, free liquidity)');
      // margin 30% → good, safety 37.5% → good, runway 2.86mo → bad(<3),
      // top-customer 60% → bad(>40%), tax coverage 0% (no provisions) → bad(<70%)
      assert.deepEqual(g.slice(0, 5).map((x) => x.cls), ['bwa-verd-g', 'bwa-verd-g', 'bwa-verd-r', 'bwa-verd-r', 'bwa-verd-r']);
      assert.ok(['bwa-verd-g', 'bwa-verd-a', 'bwa-verd-r'].includes(g[5].cls), 'free-liquidity gauge has a valid verdict');
      // The income-tax gauge is renamed and — since the fixture is not loss-shielded — shows a percentage.
      assert.match(g[4].label, /Ertragsteuer-Deckung/, 'tax gauge renamed to income-tax coverage');
      assert.match(g[4].value, /%/, 'non-shielded case shows a coverage percentage, not "keine fällig"');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('computes taxes & reserves: bound vs. free liquidity, income-tax outlook, plausibility', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      // The tax model is derived purely from the trial-balance accounts; feed a
      // synthetic one (bank, VAT, wage tax, provision, refund) to the pure engine.
      const r = await page.evaluate(() => {
        const p = window.__bwa.parsed;
        const synth = {
          meta: p.meta, ker: p.ker, hasSusa: true,
          susa: [
            { no: 1200, label: 'Bank', saldoAbs: 100000, side: 'S' },
            { no: 1576, label: 'Abziehbare Vorsteuer 19%', saldoAbs: 3000, side: 'S' },
            { no: 1776, label: 'Umsatzsteuer 19%', saldoAbs: 5700, side: 'H' },
            { no: 1780, label: 'Umsatzsteuer-Vorauszahlungen', saldoAbs: 2500, side: 'S' },
            { no: 1741, label: 'Verbindl. Lohn- und Kirchensteuer', saldoAbs: 4000, side: 'H' },
            { no: 963, label: 'Körperschaftsteuerrückstellung', saldoAbs: 1000, side: 'H' },
            { no: 1548, label: 'Vorst. in Folgeperiode abziehbar', saldoAbs: 500, side: 'S' },
            { no: 1549, label: 'Körperschaftsteuerrückforderung', saldoAbs: 12000, side: 'S' },
          ],
        };
        const K = window.__bwa.kpis(synth);
        const A = window.__bwa.assess(K);
        const round = (n) => Math.round(n * 1000) / 1000;
        return {
          ust: K.ust, sum: K.taxSummary, freeRatio: round(K.taxSummary.freeRatio),
          tax: { base: K.taxCheck.base, taxable: K.taxCheck.taxable, expectedAdj: Math.round(K.taxCheck.expectedAdj), reserved: K.taxCheck.reserved, gap: Math.round(K.taxCheck.gap) },
          plaus: { salesVat: K.taxPlaus.salesVat, vatQuote: round(K.taxPlaus.vatQuote) },
          recBound: A.recs.some((x) => /brutto/.test(x) && /Netto-Abfluss/.test(x) && /Erstattungsansprüche/.test(x)),
          recGap: A.recs.some((x) => /Deckungslücke/.test(x)),
        };
      });
      assert.deepEqual(r.ust, { output: 5700, vorsteuer: 3000, prepaid: 2500, net: 200 }, 'VAT composition');
      assert.deepEqual(r.sum, { cash: 100000, ustOwed: 200, wageTax: 4000, reserves: 1000, refunds: 12000, bound: 5200, free: 94800, freeRatio: r.sum.freeRatio, netTax: -10800 }, 'refunds exclude 1548 (deferred VAT); netTax = USt + provisions − refunds');
      assert.equal(r.freeRatio, 0.948, 'free liquidity ratio');
      assert.equal(r.sum.netTax, 200 + 1000 - 12000, 'net tax position = USt net + provisions − refund claims');
      assert.deepEqual(r.tax, { base: 9000, taxable: 9000, expectedAdj: 2700, reserved: 1000, gap: 1700 }, 'income-tax outlook with coverage gap');
      assert.deepEqual(r.plaus, { salesVat: 5700, vatQuote: 0.19 }, 'VAT plausibility (19 % of revenue)');
      assert.ok(r.recBound, 'the recommendation nets the refund claims and states the net outflow');
      assert.ok(r.recGap, 'a recommendation flags the income-tax coverage gap');
      // The fixture itself renders the section (cash > 0) with the free-liquidity card.
      const dom = await page.evaluate(() => ({
        section: /Steuern & Rücklagen/.test(document.getElementById('bwa-body').textContent),
        bar: !!document.querySelector('#bwa-body .bwa-seg-free, #bwa-body .bwa-seg-ust, #bwa-body .bwa-seg-wage, #bwa-body .bwa-seg-res'),
        free: /Frei verfügbar/.test(document.getElementById('bwa-body').textContent),
        ertrag: /Ertragsteuer/.test(document.getElementById('bwa-body').textContent),
        verprobung: /Verprobung/.test(document.getElementById('bwa-body').textContent),
      }));
      assert.ok(dom.section, 'the Taxes & reserves section is rendered');
      assert.ok(dom.bar, 'the reserved-vs-free liquidity bar is rendered');
      assert.ok(dom.free && dom.ertrag && dom.verprobung, 'free-liquidity, income-tax and plausibility blocks present');
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
          runrateShown: /Hochrechnung aufs Jahr/.test(body), taxShown: /Ertragsteuer/.test(body),
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
          costMix: /Kostenmix pro Monat/.test(document.getElementById('bwa-trend').textContent),
          sparklines: document.querySelectorAll('#bwa-body .bwa-spark').length,
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
      assert.ok(r.svgs >= 3, 'revenue/result, cash and cost-mix charts rendered');
      assert.equal(r.trendRows, 3, 'a trend-table row per month');
      assert.ok(r.costMix, 'the monthly cost-mix chart is rendered');
      assert.ok(r.sparklines >= 3, `KPI cards show sparklines with multiple months (${r.sparklines})`);
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
