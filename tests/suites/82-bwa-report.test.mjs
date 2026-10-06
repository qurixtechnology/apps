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

  test('parseKer keeps the label when a non-numeric token (>9999) trails the numbers', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      const r = await page.evaluate(() => {
        const it = (x, y, s) => ({ x, y, s });
        // 10-column layout (month block | ytd block); the "Aufschlag" column shows ">9999".
        const line = (y, label, m, yt, auf) => [
          it(50, y, label), it(200, y, m), it(260, y, '100,00'), it(320, y, '80,00'), it(380, y, '120,00'),
          ...(auf ? [it(440, y, auf)] : []),
          it(600, y, yt), it(660, y, '100,00'), it(720, y, '80,00'), it(780, y, '120,00'),
          ...(auf ? [it(900, y, '>9999')] : []),
        ];
        const items = [].concat(
          line(80, 'Umsatzerlöse', '149.574,07', '1.010.154,12'),
          line(100, 'Rohertrag', '151.870,72', '1.003.782,97', '-6.612,71'),
          line(120, 'Betrieblicher Rohertrag', '151.870,72', '1.003.782,97', '-6.612,71'),
          line(140, 'Betriebsergebnis', '63.301,66', '68.014,88'),
        );
        const k = window.__bwa.parseKer({ items });
        return { betr: k.betrRohertrag || null, roh: k.rohertrag || null, umsatz: k.umsatz || null };
      });
      assert.ok(r.betr && Math.round(r.betr.ytd) === 1003783, `betrieblicher Rohertrag parses despite >9999 (${r.betr && r.betr.ytd})`);
      assert.equal(r.betr.label, 'Betrieblicher Rohertrag', 'label is clean (no >9999 appended)');
      assert.ok(r.roh && Math.round(r.roh.ytd) === 1003783, 'Rohertrag parses too');
      assert.ok(r.umsatz && Math.round(r.umsatz.ytd) === 1010154, 'control: revenue still parses');
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
        recIcons: document.querySelectorAll('#bwa-body .bwa-recs li.bwa-rec .bwa-rec-ic').length,
        recGoodIcon: !!document.querySelector('#bwa-body .bwa-recs .bwa-rec-ic-good'),
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
      assert.equal(dom.recIcons, dom.recs, 'every recommendation has a level icon');
      assert.ok(dom.recGoodIcon, 'a positive recommendation shows the green check icon');
      assert.ok(dom.hasGlance && dom.hasOverall, 'sections and overall rating present');
      assert.ok(dom.kerRows >= 8, `the KER detail table is filled (${dom.kerRows} rows)`);
      assert.ok(dom.hasBetriebsergebnisRow, 'the P&L detail includes the operating result');
      assert.ok(dom.hasWaterfall, 'the GuV waterfall is rendered');
      assert.ok(dom.hasRisk, 'the customer/supplier concentration sections are rendered');
      assert.ok(dom.hasExpenseDrill, 'the expense drill-down is rendered');
      assert.ok(dom.hasDso, 'DSO card is rendered');
      assert.equal(dom.tabs, 6, 'six topic tabs (overview, P&L, taxes, liquidity, source, accounts)');
      assert.equal(dom.panels, 6, 'a panel per tab');
      assert.equal(dom.visiblePanels, 1, 'only the active tab panel is visible');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('organises the report into topic tabs and switches on click', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const labels = await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].map((b) => b.textContent));
      assert.deepEqual(labels, ['Überblick', 'GuV', 'Steuern', 'Liquidität', 'BWA (Quelle)', 'Kontenrahmen']);
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
        return { count: vis.length, tab: vis[0].dataset.tab, hasTax: /Steuern \(laut BWA\)/.test(vis[0].textContent),
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

  test('reads revenue per customer from trial-balance movement columns (robustly)', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        // Synthetic trial balance with the DATEV column layout:
        // [EB, VZ-Soll(month), VZ-Haben(month), cum-Soll, cum-Haben, Saldo].
        const col = (x, v, side) => ({ x, v, side: side || null });
        const susa = [
          { no: 11001, label: 'Krongaard AG', saldoAbs: 13518.40, side: 'S',
            cols: [col(337, 60199.72, 'S'), col(437, 13518.40), col(523, 28661.75), col(607, 323494.97), col(697, 370176.29), col(787, 13518.40, 'S')] },
          { no: 12000, label: 'DIVERSE U', saldoAbs: 28560, side: 'S',
            cols: [col(607, 28560), col(787, 28560, 'S')] },                       // new customer: invoiced, not yet paid
          { no: 10200, label: 'DIVERSE B', saldoAbs: 12250, side: 'S',
            cols: [col(337, 12250, 'S'), col(523, 8250), col(607, 59450), col(697, 59450), col(787, 12250, 'S')] },
          { no: 70001, label: 'Lieferant X', saldoAbs: 1000, side: 'H',
            cols: [col(337, 800, 'H'), col(607, 5000), col(697, 5200), col(787, 1000, 'H')] },
        ];
        window.__bwa.analyzeTurnover(susa);
        const list = window.__bwa.customerRevenue({ susa });
        const suppliers = window.__bwa.supplierPurchases({ susa });
        // Robustness: a trial balance with only closing balances (no movement columns) yields nothing.
        const saldoOnly = [
          { no: 10001, label: 'A', saldoAbs: 3000, side: 'S', cols: [{ x: 787, v: 3000, side: 'S' }] },
          { no: 10002, label: 'B', saldoAbs: 1500, side: 'S', cols: [{ x: 787, v: 1500, side: 'S' }] },
          { no: 10003, label: 'C', saldoAbs: 500, side: 'S', cols: [{ x: 787, v: 500, side: 'S' }] },
        ];
        window.__bwa.analyzeTurnover(saldoOnly);
        return { list, suppliers, hasSollSaldoOnly: saldoOnly.some((a) => a.soll != null), saldoOnlyRevenue: window.__bwa.customerRevenue({ susa: saldoOnly }) };
      });
      assert.ok(r.list, 'revenue per customer is available when movement columns exist');
      assert.deepEqual(r.list.map((c) => c.label), ['Krongaard AG', 'DIVERSE B', 'DIVERSE U'], 'customers sorted by invoiced turnover (suppliers excluded)');
      assert.deepEqual(r.list[0], { no: 11001, label: 'Krongaard AG', anfang: 60199.72, fakturiert: 323494.97, vereinnahmt: 370176.29, offen: 13518.40 }, 'opening (EB), invoiced (cum-Soll), collected (cum-Haben) and open (saldo)');
      assert.ok(Math.abs(r.list[0].anfang + r.list[0].fakturiert - r.list[0].vereinnahmt - r.list[0].offen) < 0.01, 'open = opening + invoiced − collected');
      assert.equal(r.list[2].vereinnahmt, 0, 'a newly invoiced customer shows nothing collected yet');
      // Supplier side: mirrored roles (billed = Haben, paid = Soll), customers excluded.
      assert.ok(r.suppliers, 'purchases per supplier available when movement columns exist');
      assert.deepEqual(r.suppliers.map((c) => c.no), [70001], 'only creditor accounts; sorted by billed volume');
      assert.deepEqual(r.suppliers[0], { no: 70001, label: 'Lieferant X', anfang: 800, berechnet: 5200, bezahlt: 5000, offen: 1000 }, 'opening, billed (Haben), paid (Soll) and open payable');
      assert.ok(Math.abs(r.suppliers[0].anfang + r.suppliers[0].berechnet - r.suppliers[0].bezahlt - r.suppliers[0].offen) < 0.01, 'open = opening + billed − paid');
      assert.equal(r.hasSollSaldoOnly, false, 'no turnover is inferred without movement columns');
      assert.equal(r.saldoOnlyRevenue, null, 'revenue-per-customer stays off when only balances are present');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('customer/supplier tables are sortable by column header', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      // Restore a synthetic session (with turnover already attached) from storage,
      // so the sortable tables render even though the fixtures have no movement columns.
      await page.evaluate(() => {
        const susa = [
          { no: 11001, label: 'Krongaard AG', saldoAbs: 13518.40, side: 'S', soll: 323494.97, haben: 370176.29, eb: 60199.72 },
          { no: 12000, label: 'DIVERSE U', saldoAbs: 28560, side: 'S', soll: 28560, haben: 0, eb: 0 },
          { no: 10200, label: 'DIVERSE B', saldoAbs: 12250, side: 'S', soll: 59450, haben: 59450, eb: 12250 },
        ];
        const parsed = { meta: { company: 'Test GmbH', date: '31.07.2025', monthsElapsed: 1, periodLabel: 'Jan/2025 – Jul/2025', currentMonth: 'Jul/2025', currency: 'EUR' }, ker: {}, hasSusa: true, susa };
        localStorage.setItem('bwa_store', JSON.stringify({ 'Test GmbH': { '2025-07': parsed } }));
        localStorage.setItem('bwa_active', JSON.stringify({ c: 'Test GmbH', k: '2025-07' }));
      });
      await page.reload();
      await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector('#bwa-body .bwa-tab'), { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'pnl').click());
      const firstCell = () => page.evaluate(() => document.querySelector('#bwa-body .bwa-sortable tbody tr td').textContent);
      // default sort = invoiced desc → Krongaard first
      assert.match(await firstCell(), /Krongaard/, 'default sort by invoiced (descending)');
      // click "Offen" → open receivables desc → DIVERSE U (28.560) first
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-sortable th')].find((th) => /Offen/.test(th.textContent)).click());
      assert.match(await firstCell(), /DIVERSE U/, 'sorting by open receivable reorders the table');
      // click the customer column → alphabetical descending (DIVERSE U first of D/K)
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-sortable th')].find((th) => /Kunde/.test(th.textContent)).click());
      const alpha = await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-sortable tbody tr td:first-child')].map((td) => td.textContent));
      assert.deepEqual(alpha, ['Krongaard AG', 'DIVERSE U', 'DIVERSE B'], 'name sort (descending) on first click');
      await page.evaluate(() => window.__bwa.reset());
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
          recBound: A.recs.some((x) => /brutto/.test(x.text) && /Netto-Abfluss/.test(x.text) && /Erstattungsansprüche/.test(x.text)),
          recGap: A.recs.some((x) => /Deckungslücke/.test(x.text)),
        };
      });
      assert.deepEqual(r.ust, { output: 5700, vorsteuer: 3000, prepaid: 2500, net: 200 }, 'VAT composition');
      assert.deepEqual(r.sum, { cash: 100000, ustOwed: 200, wageTax: 4000, reserves: 1000, hold: 1000, sonstigeRueck: 0, refunds: 12000, bound: 5200, free: 94800, freeRatio: r.sum.freeRatio,
        passThrough: 4200, ownTaxNet: -11000, netOutflow: -6800, netTax: -10800 }, 'refunds exclude 1548 (deferred VAT); two buckets + net outflow');
      assert.equal(r.freeRatio, 0.948, 'free liquidity ratio');
      assert.equal(r.sum.passThrough, 200 + 4000, 'pass-through = USt owed + wage tax/SV');
      assert.equal(r.sum.ownTaxNet, 1000 - 12000, 'own income tax net = provisions − refund claims');
      assert.equal(r.sum.netOutflow, 5200 - 12000, 'net outflow = bound − refunds = pass-through + own tax net');
      assert.equal(r.sum.netTax, 200 + 1000 - 12000, 'Finanzamt reconciliation = USt net + provisions − refunds');
      assert.deepEqual(r.tax, { base: 9000, taxable: 9000, expectedAdj: 2700, reserved: 1000, gap: 1700 }, 'income-tax outlook with coverage gap');
      assert.deepEqual(r.plaus, { salesVat: 5700, vatQuote: 0.19 }, 'VAT plausibility (19 % of revenue)');
      assert.ok(r.recBound, 'the recommendation nets the refund claims and states the net outflow');
      assert.ok(r.recGap, 'a recommendation flags the income-tax coverage gap');
      // The fixture itself renders the section (cash > 0) with the free-liquidity card.
      const dom = await page.evaluate(() => ({
        section: /Steuern \(laut BWA\)/.test(document.getElementById('bwa-body').textContent),
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

  test('splits the tax provision into this year’s addition and prior-year remainder', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        const col = (x, v, side) => ({ x, v, side: side || null });
        // A cumulative tax reserve (closing 37.120) with a 10.752 addition this year;
        // two debtors give the movement-column layout enough rows to detect.
        const susa = [
          { no: 963, label: 'Körperschaftsteuerrückstellung', saldoAbs: 37120, side: 'H',
            cols: [col(337, 37120, 'H'), col(607, 10752), col(697, 10752), col(787, 37120, 'H')] },
          { no: 11001, label: 'Krongaard AG', saldoAbs: 13518.40, side: 'S',
            cols: [col(337, 60199.72, 'S'), col(437, 13518.40), col(523, 28661.75), col(607, 323494.97), col(697, 370176.29), col(787, 13518.40, 'S')] },
          { no: 12000, label: 'DIVERSE U', saldoAbs: 28560, side: 'S', cols: [col(607, 28560), col(787, 28560, 'S')] },
        ];
        const hasTurnover = window.__bwa.analyzeTurnover(susa);
        const parsed = { meta: { company: 'Test GmbH', monthsElapsed: 12 }, ker: { ergebnisVorSteuern: { ytd: 40000, month: 0, label: 'Ergebnis vor Steuern' } }, hasSusa: true, hasTurnover, susa };
        const K = window.__bwa.kpis(parsed);
        const round = (n) => Math.round(n * 100) / 100;
        return { hasTurnover, total: K.taxProvisions, current: K.taxProvCurrent, prior: K.taxProvPrior, detail: K.taxDetail,
          tax: { expected: round(K.taxCheck.expectedAdj), reservedCurrent: K.taxCheck.reservedCurrent, gap: round(K.taxCheck.gap), hasSplit: K.taxCheck.hasSplit }, coverage: round(K.taxCoverage) };
      });
      assert.equal(r.hasTurnover, true, 'movement columns detected');
      assert.equal(r.total, 37120, 'total provision = closing balance');
      assert.equal(r.current, 10752, 'this year’s addition = Haben movement');
      assert.equal(r.prior, 37120 - 10752, 'prior-year remainder = total − addition');
      assert.deepEqual(r.detail, [{ no: 963, label: 'Körperschaftsteuerrückstellung', kind: 'kst', anfang: 37120, berechnet: 10752, bezahlt: 10752, offen: 37120 }], 'per-tax-type flow (opening + booked − paid = open)');
      assert.deepEqual(r.tax, { expected: 12000, reservedCurrent: 10752, gap: 1248, hasSplit: true }, 'coverage judged against the yearly addition, not the whole reserve');
      assert.equal(r.coverage, 0.9, 'tax coverage uses the yearly addition (10.752 / 12.000)');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('tax tab shows BWA facts (4 flow columns, no estimates); liquidity tab holds the forecast', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.evaluate(() => {
        const susa = [
          { no: 1200, label: 'Bank', saldoAbs: 250000, side: 'S' },
          { no: 1740, label: 'Verbindlichkeiten aus Lohn und Gehalt', saldoAbs: 3000, side: 'S' },   // net wages — must NOT count as wage tax
          { no: 1741, label: 'Verbindl. Lohn- und Kirchensteuer', saldoAbs: 15853, side: 'H' },
          { no: 1766, label: 'Umsatzsteuer nicht fällig 19%', saldoAbs: 5000, side: 'H' },            // deferred VAT → memo row
          { no: 1776, label: 'Umsatzsteuer 19%', saldoAbs: 24231, side: 'H' },
          { no: 956, label: 'Gewerbesteuerrückstellung § 4 (5b) EStG', saldoAbs: 38577, side: 'H', soll: 8883.90, haben: 8883.90, eb: -38577 },
          { no: 963, label: 'Körperschaftsteuerrückstellung', saldoAbs: 37120, side: 'H', soll: 10752, haben: 10752, eb: -37120 },
        ];
        const parsed = { meta: { company: 'Test GmbH', date: '31.12.2024', monthsElapsed: 12, periodLabel: 'Jan/2024 – Dez/2024', currentMonth: 'Dez/2024', currency: 'EUR' },
          ker: { ergebnisVorSteuern: { ytd: 74078.30, month: 0, label: 'Ergebnis vor Steuern' }, umsatz: { ytd: 100000, month: 0, label: 'Umsatzerlöse' } }, hasSusa: true, hasTurnover: true, susa };
        localStorage.setItem('bwa_store', JSON.stringify({ 'Test GmbH': { '2024-12': parsed } }));
        localStorage.setItem('bwa_active', JSON.stringify({ c: 'Test GmbH', k: '2024-12' }));
      });
      await page.reload();
      await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'taxes').click());
      const r = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((p) => p.dataset.tab === 'taxes');
        const txt = panel.textContent;
        const table = panel.querySelector('table.bwa-taxoverview');
        const cells = (re) => { const tr = table && [...table.querySelectorAll('tbody tr')].find((t) => re.test(t.textContent)); return tr ? [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/[  ]/g, ' ').replace(/−/g, '-').trim()) : []; };
        return {
          headers: table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [],
          groups: table ? [...table.querySelectorAll('tbody tr.bwa-tr-group td')].map((td) => td.textContent.trim()) : [],
          ust: cells(/Umsatzsteuer-Zahllast/), wage: cells(/Lohnsteuer & Sozial/), fremd: cells(/Summe Fremdgeld/),
          gewst: cells(/Gewerbesteuer/), etSum: cells(/Summe Ertragsteuer/), total: cells(/Offen gesamt/),
          noVorjahr: !/Finanzamt-Saldo Vorjahre/.test(txt),
          noEstimate: !/Eigene Berechnung/.test(txt) && !/Δ \(/.test(txt),
          memoRow: (() => { const tr = table && [...table.querySelectorAll('tbody tr.bwa-tr-memo')][0]; return tr ? tr.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
          nfNote: /noch nicht fällige Umsatzsteuer/.test(txt),
          berTip: (() => { const tr = table && [...table.querySelectorAll('tbody tr')].find((t) => /Umsatzsteuer-Zahllast/.test(t.textContent)); const td = tr && [...tr.querySelectorAll('td[title]')].find((c) => /24\.231/.test(c.textContent)); return td ? td.getAttribute('title') : ''; })(),
        };
      });
      assert.deepEqual(r.headers, ['Steuer / Posten', 'Anfang (Vorjahr)', 'Berechnet dieses Jahr', 'Bezahlt/abziehbar', 'Offen (Saldo)'], 'four flow columns, no estimate columns');
      assert.deepEqual(r.groups, ['Durchlaufende Posten (Fremdgeld)', 'Eigene Ertragsteuer (netto)']);
      assert.deepEqual(r.ust.slice(1, 5), ['–', '24.231 €', '–', '24.231 €'], 'VAT flow opening/booked/paid/open');
      assert.equal(r.wage[4], '15.853 €', 'wage tax/SV shown as open only');
      assert.equal(r.fremd[4], '40.084 €', 'pass-through subtotal');
      assert.deepEqual(r.gewst.slice(1, 5), ['38.577 €', '8.884 €', '8.884 €', '38.577 €'], 'income-tax flow is factual (opening/booked/paid/closing)');
      assert.deepEqual(r.etSum.slice(1, 5), ['75.697 €', '19.636 €', '19.636 €', '75.697 €'], 'income-tax subtotal reconciles');
      assert.equal(r.total[4], '115.781 €', 'total open = pass-through 40.084 + income tax 75.697');
      assert.ok(r.noVorjahr, 'the prior-year row is hidden when there is no VAT opening or refund');
      assert.ok(r.noEstimate, 'the tax tab has no estimate/Δ columns');
      assert.match(r.memoRow, /noch nicht fällig.*1766.*5\.000/, 'deferred VAT (1766) memo row stays');
      assert.ok(r.nfNote, 'the not-yet-due VAT note stays');
      assert.match(r.berTip || '', /1776 Umsatzsteuer/, 'cells still carry the account-derivation tooltip');
      // The forecast (estimate + buffer) now lives in the liquidity tab.
      const l = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((p) => p.dataset.tab === 'liquidity');
        const txt = panel.textContent;
        return { reserveSection: /Steuer-Rücklage \(Prognose\)/.test(txt), hasBar: !!panel.querySelector('.bwa-seg-net'), bound: /115\.781/.test(txt), gap: /2\.588/.test(txt) };
      });
      assert.ok(l.reserveSection, 'the liquidity tab has the forecast section');
      assert.ok(l.hasBar, 'the reserved-vs-free bar moved to the liquidity tab');
      assert.ok(l.bound, 'the amount to keep aside (115.781) is in the liquidity tab');
      assert.ok(l.gap, 'the income-tax coverage gap (~2.588) is flagged in the liquidity tab');
      await page.evaluate(() => window.__bwa.reset());
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('reconciles the prior-year tax-office balance (advisor delta) and keeps the forecast in the liquidity tab', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.evaluate(() => {
        // The real 2026 (mid-year) case: prior-year VAT (1790), prior-year income-tax
        // reserves (956/963), large refund claims (Verlustrücktrag) and a net
        // Gewinnvortrag. The tax tab must reconcile the advisor's 21.236 € delta.
        const susa = [
          { no: 1200, label: 'Bank', saldoAbs: 117048, side: 'S' },
          { no: 1540, label: 'Forderung aus Gewerbesteuerüberzahlung', saldoAbs: 1645, side: 'S' },
          { no: 1549, label: 'Körperschaftsteuerrückforderung', saldoAbs: 42971.50, side: 'S' },
          { no: 1741, label: 'Verbindl. Lohn- und Kirchensteuer', saldoAbs: 7740, side: 'H' },
          { no: 1776, label: 'Umsatzsteuer 19%', saldoAbs: 509, side: 'H' },
          { no: 1790, label: 'Umsatzsteuerverbindlichkeiten Vorjahr', saldoAbs: 58354.15, side: 'H' },
          { no: 860, label: 'Gewinnvortrag vor Verwendung', saldoAbs: 258067.14, side: 'H' },
          { no: 868, label: 'Verlustvortrag vor Verwendung', saldoAbs: 220443.53, side: 'S' },
          { no: 956, label: 'Gewerbesteuerrückstellung § 4 (5b) EStG', saldoAbs: 3816, side: 'H', soll: 0, haben: 0, eb: -3816 },
          { no: 963, label: 'Körperschaftsteuerrückstellung', saldoAbs: 3682.80, side: 'H', soll: 0, haben: 0, eb: -3682.80 },
        ];
        const parsed = { meta: { company: 'Test GmbH', date: '31.07.2026', monthsElapsed: 7, periodLabel: 'Jan/2026 – Jul/2026', currentMonth: 'Jul/2026', currency: 'EUR' },
          ker: { ergebnisVorSteuern: { ytd: 46884, month: 0, label: 'Ergebnis vor Steuern' }, umsatz: { ytd: 397018, month: 0, label: 'Umsatzerlöse' } }, hasSusa: true, hasTurnover: true, susa };
        localStorage.setItem('bwa_store', JSON.stringify({ 'Test GmbH': { '2026-07': parsed } }));
        localStorage.setItem('bwa_active', JSON.stringify({ c: 'Test GmbH', k: '2026-07' }));
      });
      await page.reload();
      await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'taxes').click());
      const r = await page.evaluate(() => {
        const K = window.__bwa.kpis(window.__bwa.parsed);
        const table = document.querySelector('#bwa-body table.bwa-taxoverview');
        const panel = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((p) => p.dataset.tab === 'taxes');
        const cells = (re) => { const tr = table && [...table.querySelectorAll('tbody tr')].find((t) => re.test(t.textContent)); return tr ? [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/[  ]/g, ' ').replace(/−/g, '-').trim()) : []; };
        return {
          hold: K.incomeTaxHold, reserves: K.taxSummary.reserves, sumHold: K.taxSummary.hold, lossCarry: Math.round(K.lossCarry),
          ust: cells(/Umsatzsteuer-Zahllast/), gewst: cells(/Gewerbesteuer/), kst: cells(/Körperschaftsteuer/),
          etSum: cells(/Summe Ertragsteuer/), refunds: cells(/Erstattungsansprüche/), fa: cells(/Finanzamt-Saldo Vorjahre/), total: cells(/Offen gesamt/),
          faNote: /Finanzamt-Saldo Vorjahre: 21\.236/.test(panel.textContent),
          noEstimate: !/≈/.test(table.textContent) && !/Eigene Berechnung/.test(panel.textContent),
        };
      });
      assert.equal(r.lossCarry, 0, 'the net Gewinnvortrag leaves no usable loss carry-forward');
      assert.deepEqual(r.ust.slice(1, 5), ['58.354 €', '509 €', '–', '58.863 €'], 'VAT flow with prior-year opening');
      assert.deepEqual(r.gewst.slice(1, 5), ['3.816 €', '–', '–', '3.816 €'], 'GewSt reserve at its actual balance (no estimate)');
      assert.deepEqual(r.kst.slice(1, 5), ['3.683 €', '–', '–', '3.683 €'], 'KSt reserve at its actual balance');
      assert.deepEqual(r.etSum.slice(1, 5), ['7.499 €', '–', '–', '7.499 €'], 'income-tax subtotal is factual');
      assert.equal(r.refunds[4], '-44.617 €', 'refund claims (1540 + 1549)');
      assert.equal(r.fa[4], '21.236 €', 'prior-year tax-office balance matches the advisor delta');
      assert.equal(r.total[4], '29.485 €', 'total open = pass-through + income tax − refunds');
      assert.ok(r.faNote, 'a note states the prior-year tax-office balance');
      assert.ok(r.noEstimate, 'the tax tab carries no estimate');
      assert.ok(Math.abs(r.reserves - 7498.80) < 1, `factual reserve stock (${r.reserves})`);
      assert.ok(Math.abs(r.hold - 21564.5) < 2 && Math.abs(r.sumHold - r.hold) < 0.01, `estimate-based hold (${r.hold})`);
      const l = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((p) => p.dataset.tab === 'liquidity');
        const txt = panel.textContent;
        const table = panel.querySelector('table.bwa-taxtable-2');
        const cells = (re) => { const tr = table && [...table.querySelectorAll('tbody tr')].find((t) => re.test(t.textContent)); return tr ? [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/[  ]/g, ' ').replace(/−/g, '-').trim()) : []; };
        const estTd = table && [...table.querySelectorAll('td[title]')].find((td) => /Vorauszahlungen/.test(td.getAttribute('title')));
        return { reserveSection: /Steuer-Rücklage \(Prognose\)/.test(txt), hasBar: !!panel.querySelector('.bwa-seg-net'),
          refundZone: !!panel.querySelector('.bwa-seg-refund'), caption: /nach Eingang der Erstattung effektiv frei/.test(txt), expected: /14\.06\d/.test(txt),
          headers: table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [],
          vorz: cells(/Vorzuhalten/), frei: cells(/Frei verfügbar/), refund: cells(/Erstattungsansprüche/),
          estTip: estTd ? estTd.getAttribute('title') : '', hasSrc: !!(table && table.querySelector('td.bwa-td-src[data-src]')) };
      });
      assert.ok(l.reserveSection && l.hasBar, 'the forecast section + bar are in the liquidity tab');
      assert.ok(l.refundZone, 'the bar has a distinct refund-covered zone');
      assert.ok(l.caption, 'a caption bridges free-today and free-after-refund');
      assert.ok(l.expected, 'the expected current-year income tax (~14.065) is shown as a forecast');
      assert.deepEqual(l.headers, ['Steuer / Posten', 'Brutto', 'Netto (nach Erstattung)'], 'gross vs. net columns');
      assert.match(l.vorz[1], /88\.16[78]/, 'gross amount to keep aside'); assert.match(l.vorz[2], /43\.55[01]/, 'net amount to keep aside');
      assert.match(l.frei[1], /28\.88[01]/, 'free today'); assert.match(l.frei[2], /73\.49[678]/, 'free after the refund');
      assert.equal(l.refund[1], '–', 'no refund in the gross column'); assert.match(l.refund[2], /-\s?44\.617/, 'refund reduces only the net column');
      assert.match(l.estTip, /Vorauszahlungen/, 'the estimate tooltip states that advance payments are deducted');
      assert.ok(l.hasSrc, 'the forecast table cells link to the BWA source accounts');
      await page.evaluate(() => window.__bwa.reset());
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('nets the book Gewinnvortrag (860) against the Verlustvortrag (868) for the loss shield', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        // A 2026-style case: a debit Verlustvortrag (868) but an even larger credit
        // Gewinnvortrag (860) — the net is retained profit, so nothing shields.
        const susa = [
          { no: 860, label: 'Gewinnvortrag vor Verwendung', saldoAbs: 258067.14, side: 'H' },
          { no: 868, label: 'Verlustvortrag vor Verwendung', saldoAbs: 220443.53, side: 'S' },
          { no: 956, label: 'Gewerbesteuerrückstellung § 4 (5b) EStG', saldoAbs: 3816, side: 'H', soll: 0, haben: 0, eb: -3816 },
          { no: 963, label: 'Körperschaftsteuerrückstellung', saldoAbs: 3682.80, side: 'H', soll: 0, haben: 0, eb: -3682.80 },
          { no: 1200, label: 'Bank', saldoAbs: 117048, side: 'S' },
        ];
        const base = { meta: { company: 'Test GmbH', monthsElapsed: 7 }, ker: { ergebnisVorSteuern: { ytd: 46884, month: 0, label: 'Ergebnis vor Steuern' } }, hasSusa: true, hasTurnover: true };
        const net = window.__bwa.kpis({ ...base, susa });
        const lossOnly = window.__bwa.kpis({ ...base, susa: susa.filter((a) => a.no !== 860) });
        return { netLoss: Math.round(net.lossCarry), netTaxable: Math.round(net.taxCheck.taxable), lossOnly: Math.round(lossOnly.lossCarry) };
      });
      assert.equal(r.netLoss, 0, 'a net Gewinnvortrag leaves no usable loss carry-forward');
      assert.equal(r.netTaxable, 46884, 'the profit is taxable again, so the estimate can fill');
      assert.equal(r.lossOnly, 220444, 'without an offsetting Gewinnvortrag the full 868 balance shields');
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

  test('source tab reconstructs the BWA and highlights the origin of a clicked value', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        const body = document.getElementById('bwa-body');
        const srcPanel = [...body.querySelectorAll('.bwa-tabpanel')].find((p) => p.dataset.tab === 'source');
        const hasKer = !!srcPanel.querySelector('#bwa-src-ker-umsatz');
        const susaRows = srcPanel.querySelectorAll('.bwa-srctable tbody tr').length;
        const helpCells = srcPanel.querySelectorAll('.bwa-srctable td.bwa-src-help[title]').length;
        const helpTitle = (srcPanel.querySelector('.bwa-srctable td.bwa-src-help[title]') || {}).title || '';
        const rev = body.querySelector('.bwa-clickable[data-src-ker*="umsatz"]');
        if (rev) rev.click();
        return {
          hasKer, susaRows, helpCells, helpTitle, revExists: !!rev,
          active: document.querySelector('#bwa-body .bwa-tab.is-active').dataset.tab,
          visSource: !srcPanel.hidden,
          hitKer: !!document.querySelector('#bwa-src-ker-umsatz.bwa-src-hit'),
        };
      });
      assert.ok(r.hasKer, 'the source tab reconstructs the KER with addressable rows');
      assert.ok(r.susaRows >= 3, `the source tab lists the trial-balance accounts (${r.susaRows})`);
      assert.ok(r.helpCells >= 1, `account names carry an explanatory tooltip (${r.helpCells})`);
      assert.ok(r.helpTitle.length > 10, 'the account tooltip explains what the account means');
      assert.ok(r.revExists, 'the revenue figure is a clickable, source-linked value');
      assert.equal(r.active, 'source', 'clicking a value opens the source tab');
      assert.ok(r.visSource, 'the source panel becomes visible');
      assert.ok(r.hitKer, 'the underlying KER row is highlighted');
      const r2 = await page.evaluate(() => {
        const body = document.getElementById('bwa-body');
        const el = body.querySelector('.bwa-clickable[data-src]');
        const nos = el ? el.getAttribute('data-src').split(',') : [];
        if (el) el.click();
        return { hasSrc: !!el, hit: nos.some((n) => !!document.querySelector('#bwa-src-' + n + '.bwa-src-hit')) };
      });
      assert.ok(r2.hasSrc, 'account-based values carry data-src');
      assert.ok(r2.hit, 'clicking an account value highlights its trial-balance row');
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

  test('other provisions (970–999) are included in the liquidity buffer, not just taxes', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.evaluate(() => {
        const susa = [
          { no: 1200, label: 'Bank', saldoAbs: 100000, side: 'S' },
          { no: 1776, label: 'Umsatzsteuer 19%', saldoAbs: 5000, side: 'H' },
          { no: 970, label: 'Sonstige Rückstellungen', saldoAbs: 2000, side: 'H' },
          { no: 977, label: 'Rückstellungen für Abschluss u. Prüfung', saldoAbs: 5500, side: 'H' },
        ];
        const parsed = { meta: { company: 'Test GmbH', monthsElapsed: 12, currentMonth: 'Dez/2024', date: '31.12.2024', currency: 'EUR' }, ker: { umsatz: { ytd: 50000, month: 0, label: 'Umsatzerlöse' } }, hasSusa: true, hasTurnover: false, susa };
        localStorage.setItem('bwa_store', JSON.stringify({ 'Test GmbH': { '2024-12': parsed } }));
        localStorage.setItem('bwa_active', JSON.stringify({ c: 'Test GmbH', k: '2024-12' }));
      });
      await page.reload();
      await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'liquidity').click());
      const r = await page.evaluate(() => {
        const K = window.__bwa.kpis(window.__bwa.parsed);
        const panel = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((p) => p.dataset.tab === 'liquidity');
        const table = panel.querySelector('table.bwa-taxtable');
        const findRow = (re) => table && [...table.querySelectorAll('tbody tr')].find((t) => re.test(t.textContent));
        const val = (tr) => tr ? tr.querySelectorAll('td')[1].textContent.replace(/[  ]/g, ' ').trim() : '';
        const sr = findRow(/Sonstige Rückstellungen/);
        return { sonstigeRueck: K.taxSummary.sonstigeRueck, bound: K.taxSummary.bound,
          srVal: val(sr), srTip: sr ? ((sr.querySelector('td[title]') || {}).title || '') : '', vorzVal: val(findRow(/Vorzuhalten/)) };
      });
      assert.equal(r.sonstigeRueck, 7500, 'other provisions = 970 (2.000) + 977 (5.500)');
      assert.equal(r.bound, 12500, 'to keep aside = VAT 5.000 + other provisions 7.500');
      assert.equal(r.srVal, '7.500 €', 'the forecast table has an Other-provisions row');
      assert.match(r.srTip, /Abschluss/, 'the Other-provisions row carries a source tooltip');
      assert.equal(r.vorzVal, '12.500 €', 'the keep-aside total includes other provisions');
      await page.evaluate(() => window.__bwa.reset());
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('P&L tab switches between cumulative and monthly and compares both', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.evaluate(() => {
        const line = (label, month, ytd) => ({ label, month, ytd });
        // 10 months: average = ytd / 10; the current month is above average.
        const ker = {
          umsatz: line('Umsatzerlöse', 12000, 100000), gesamtleistung: line('Gesamtleistung', 12000, 100000),
          betrRohertrag: line('Betrieblicher Rohertrag', 12000, 100000), personalkosten: line('Personalkosten', 5000, 40000),
          sonstigeKosten: line('Sonstige Kosten', 2500, 20000), gesamtkosten: line('Gesamtkosten', 8500, 70000),
          betriebsergebnis: line('Betriebsergebnis', 3500, 30000), vorlaeufigesErgebnis: line('Vorläufiges Ergebnis', 3500, 30000),
        };
        const parsed = { meta: { company: 'Test GmbH', monthsElapsed: 10, periodLabel: 'Jan/2026 – Okt/2026', currentMonth: 'Okt/2026', date: '31.10.2026', currency: 'EUR' }, ker, hasSusa: false, hasTurnover: false, susa: [] };
        localStorage.setItem('bwa_store', JSON.stringify({ 'Test GmbH': { '2026-10': parsed } }));
        localStorage.setItem('bwa_active', JSON.stringify({ c: 'Test GmbH', k: '2026-10' }));
      });
      await page.reload();
      await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'pnl').click());
      const r = await page.evaluate(() => {
        const p = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((x) => x.dataset.tab === 'pnl');
        return { btns: [...p.querySelectorAll('.bwa-viewbtn')].map((b) => b.textContent.trim()),
          active: (p.querySelector('.bwa-viewbtn.is-active') || {}).textContent, title: p.querySelector('.bwa-chart-title').textContent, wf: p.querySelector('svg.bwa-svg').textContent };
      });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-viewbtn')].find((b) => b.dataset.pnlview === 'month').click());
      const rm = await page.evaluate(() => {
        const p = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((x) => x.dataset.tab === 'pnl');
        return { active: (p.querySelector('.bwa-viewbtn.is-active') || {}).textContent, title: p.querySelector('.bwa-chart-title').textContent, wf: p.querySelector('svg.bwa-svg').textContent };
      });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-viewbtn')].find((b) => b.dataset.pnlview === 'compare').click());
      const rc = await page.evaluate(() => {
        const p = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((x) => x.dataset.tab === 'pnl');
        const table = [...p.querySelectorAll('table.bwa-table')].pop();
        const headers = table ? [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()) : [];
        return { active: (p.querySelector('.bwa-viewbtn.is-active') || {}).textContent, headers,
          charts: p.querySelectorAll('.bwa-cmp-charts svg.bwa-svg').length, groupedBars: p.querySelectorAll('.bwa-bar-cmp').length,
          hasDiff: /\+\s?2\.000/.test(p.textContent), hasCompareHead: /Vergleich/.test(p.textContent) };
      });
      assert.deepEqual(r.btns, ['kumuliert', 'Monat', 'Vergleich'], 'three view modes');
      assert.equal(r.active, 'kumuliert', 'cumulative is the default');
      assert.match(r.title, /kumuliert/, 'title shows the cumulative view');
      assert.match(r.wf, /100\.000/, 'waterfall shows cumulative figures');
      assert.equal(rm.active, 'Monat', 'switched to the monthly view');
      assert.match(rm.title, /Okt\/2026/, 'title shows the current month');
      assert.doesNotMatch(rm.wf, /100\.000/, 'waterfall no longer shows the cumulative total');
      assert.match(rm.wf, /12\.000/, 'waterfall shows the monthly figures');
      assert.equal(rc.active, 'Vergleich', 'switched to compare');
      assert.deepEqual(rc.headers, ['Bezeichnung', 'Ø/Monat', 'Monat', 'Δ (Monat − Ø)'], 'compare shows average, month and Δ');
      assert.equal(rc.charts, 2, 'two waterfalls (month and average) side by side');
      assert.ok(rc.groupedBars >= 1, 'cost structure shows grouped month/average bars');
      assert.ok(rc.hasDiff, 'the Δ (month − average) is shown (+2.000)');
      assert.ok(rc.hasCompareHead, 'the compare view is labelled');
      await page.evaluate(() => window.__bwa.reset());
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('waterfall bars carry derivation tooltips and link to their BWA source line', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await fresh(page);
      await page.evaluate(() => {
        const line = (label, month, ytd) => ({ label, month, ytd });
        const ker = {
          umsatz: line('Umsatzerlöse', 12000, 100000), gesamtleistung: line('Gesamtleistung', 12000, 100000),
          betrRohertrag: line('Betrieblicher Rohertrag', 12000, 100000), personalkosten: line('Personalkosten', 5000, 40000),
          sonstigeKosten: line('Sonstige Kosten', 2500, 20000), gesamtkosten: line('Gesamtkosten', 8500, 70000),
          betriebsergebnis: line('Betriebsergebnis', 3500, 30000), vorlaeufigesErgebnis: line('Vorläufiges Ergebnis', 3500, 30000),
        };
        const parsed = { meta: { company: 'Test GmbH', monthsElapsed: 10, periodLabel: 'Jan/2026 – Okt/2026', currentMonth: 'Okt/2026', date: '31.10.2026', currency: 'EUR' }, ker, hasSusa: false, hasTurnover: false, susa: [] };
        localStorage.setItem('bwa_store', JSON.stringify({ 'Test GmbH': { '2026-10': parsed } }));
        localStorage.setItem('bwa_active', JSON.stringify({ c: 'Test GmbH', k: '2026-10' }));
      });
      await page.reload();
      await page.waitForSelector('#bwa-report:not([hidden])', { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.dataset.tab === 'pnl').click());
      const r = await page.evaluate(() => {
        const svg = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((x) => x.dataset.tab === 'pnl').querySelector('svg.bwa-svg');
        const bars = [...svg.querySelectorAll('g.bwa-wf-bar')];
        const kers = bars.map((g) => g.getAttribute('data-src-ker'));
        const byKer = (k) => bars.find((g) => g.getAttribute('data-src-ker') === k);
        return {
          bars: bars.length,
          clickable: bars.filter((g) => g.classList.contains('bwa-clickable')).length,
          kers,
          uebrigeKer: bars[3].getAttribute('data-src-ker'),
          leistungTip: byKer('betrRohertrag').querySelector('title').textContent,
          uebrigeTip: bars[3].querySelector('title').textContent,
          hasHint: /BWA \(Quelle\)/.test([...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((x) => x.dataset.tab === 'pnl').querySelector('.bwa-wf-hint').textContent),
        };
      });
      const click = await page.evaluate(() => {
        const g = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((x) => x.dataset.tab === 'pnl')
          .querySelector('svg.bwa-svg g.bwa-wf-bar[data-src-ker="personalkosten"]');
        g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const active = [...document.querySelectorAll('#bwa-body .bwa-tab')].find((b) => b.classList.contains('is-active')).dataset.tab;
        const hit = document.querySelector('#bwa-src-ker-personalkosten');
        return { active, highlighted: !!hit && hit.classList.contains('bwa-src-hit') };
      });
      assert.equal(r.bars, 5, 'five waterfall bars');
      assert.equal(r.clickable, 5, 'every bar is clickable');
      assert.equal(r.kers[0], 'betrRohertrag', 'output bar links to its KER line');
      assert.equal(r.kers[1], 'personalkosten', 'personnel bar links to its KER line');
      assert.equal(r.kers[2], 'sonstigeKosten', 'other-costs bar links to its KER line');
      assert.equal(r.kers[4], 'betriebsergebnis', 'result bar links to its KER line');
      // "Übrige Kosten" links to the remaining cost lines, NOT to the Gesamtkosten subtotal.
      assert.ok(r.uebrigeKer.includes('raumkosten') && r.uebrigeKer.includes('abschreibungen'), 'remaining-costs bar links to the actual remaining cost lines');
      assert.ok(!/\bgesamtkosten\b/.test(r.uebrigeKer), 'remaining-costs bar does not link to the Gesamtkosten subtotal');
      assert.ok(!r.uebrigeKer.includes('personalkosten') && !r.uebrigeKer.includes('sonstigeKosten'), 'remaining-costs bar excludes personnel and other costs');
      assert.match(r.leistungTip, /Leistung:\s*100\.000/, 'the output bar tooltip states its value');
      assert.match(r.uebrigeTip, /Gesamtkosten.*−.*Personalkosten.*−.*Sonstige/, 'the remaining-costs bar tooltip shows the derivation');
      assert.ok(r.hasHint, 'a hint points to the BWA source tab');
      assert.equal(click.active, 'source', 'clicking a bar jumps to the BWA source tab');
      assert.ok(click.highlighted, 'the matching KER line is highlighted');
      await page.evaluate(() => window.__bwa.reset());
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('chart-of-accounts tab explains accounts with tax effects and marks the present ones', async () => {
    const page = await openApp(browser, 'bwa-report.html');
    try {
      await importFixture(page);
      const r = await page.evaluate(() => {
        const panel = [...document.querySelectorAll('#bwa-body .bwa-tabpanel')].find((p) => p.dataset.tab === 'accounts');
        const txt = panel.textContent;
        return {
          tables: panel.querySelectorAll('table.bwa-acctable').length,
          headers: [...(panel.querySelector('table.bwa-acctable')?.querySelectorAll('thead th') || [])].map((th) => th.textContent.trim()),
          hasKst: /Körperschaftsteuer/.test(txt) && /nicht abzugsfähig/.test(txt),
          hasUst: /Umsatzsteuer nicht fällig/.test(txt),
          badges: panel.querySelectorAll('.bwa-acc-badge').length,
          clickable: !!panel.querySelector('tr.bwa-acc-here .bwa-clickable[data-src]'),
        };
      });
      assert.ok(r.tables >= 5, `grouped account tables (${r.tables})`);
      assert.deepEqual(r.headers, ['Konto', 'Bezeichnung', 'Beschreibung', 'Steuerliche Auswirkung']);
      assert.ok(r.hasKst, 'corporate-tax row with its tax effect (not deductible)');
      assert.ok(r.hasUst, 'VAT-not-yet-due account explained');
      assert.ok(r.badges >= 1, `present accounts are badged (${r.badges})`);
      assert.ok(r.clickable, 'a present account links to the BWA source tab');
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});
