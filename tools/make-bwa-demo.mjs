// Demo BWA for the bwa-report app (fictitious company, fictitious figures).
//
//   npm run build && npm run bwa:demo && npm run build
//
// 1. Renders a PDF in the layout of a DATEV standard BWA with trial balance
//    (.ignore/bwa/Demo-BWA_2026_09.pdf — for screenshots, not committed).
// 2. Runs that PDF through the built app's own parser and writes the result to
//    src/apps/bwa-report/demo-data.js, which the app offers as "load demo BWA".
//    Rebuild afterwards so dist/ picks the new data up.
//
// Edit the bookings below and re-run. Everything is derived from balanced ledger
// entries, so the sheets stay consistent; the script fails if they do not.
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromePath } from '../tests/helpers/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.ignore', 'bwa', 'Demo-BWA_2026_09.pdf');
const DATA = join(ROOT, 'src', 'apps', 'bwa-report', 'demo-data.js');

const FIRMA = 'Musterwerk Digital GmbH';
const MANDANT = '12345/67890/2026';
const DATUM = '05.10.2026';
const MONAT_LANG = 'September 2026', MONAT = 'Sep/2026', MONAT_SUSA = 'Sep 2026', VON = 'Jan/2026';

// ============================================================ bookkeeping
// The demo is booked like a real ledger: every business event is a balanced
// entry (debit = credit), given as a year-to-date amount and its September
// share. Balances, the trial balance and the short-term P&L all follow from
// these entries, so the opening balance sheet, the bank account, the payroll
// accounts and the VAT accounts add up the way an accountant expects.
const KONTEN = {
  410: 'Geschäftsausstattung', 630: 'Verbindlichkeiten gegenüber Kreditinstituten',
  800: 'Gezeichnetes Kapital', 860: 'Gewinnvortrag vor Verwendung',
  956: 'Gewerbesteuerrückstellung', 963: 'Körperschaftsteuerrückstellung',
  970: 'Sonstige Rückstellungen', 977: 'Rückstellungen für Abschluss und Prüfung',
  1000: 'Kasse', 1200: 'Bank Geschäftskonto', 1400: 'Forderungen aus Lieferungen und Leistungen',
  1571: 'Abziehbare Vorsteuer 7%', 1576: 'Abziehbare Vorsteuer 19%',
  1600: 'Verbindlichkeiten aus Lieferungen und Leistungen', 1730: 'Kreditkartenabrechnung',
  1740: 'Verbindlichkeiten aus Lohn und Gehalt', 1741: 'Verbindlichkeiten Lohn- und Kirchensteuer',
  1742: 'Verbindlichkeiten soziale Sicherheit', 1776: 'Umsatzsteuer 19%',
  1780: 'Umsatzsteuer-Vorauszahlungen', 1781: 'Umsatzsteuer-Vorauszahlungen 1/11', 1790: 'Umsatzsteuer Vorjahr',
  2100: 'Zinsen und ähnliche Aufwendungen', 2200: 'Körperschaftsteuer', 2208: 'Solidaritätszuschlag',
  2650: 'Sonstige Zinsen und ähnliche Erträge', 3100: 'Fremdleistungen',
  4120: 'Gehälter', 4124: 'Geschäftsführergehälter GmbH-Gesells.', 4130: 'Gesetzliche soziale Aufwendungen',
  4138: 'Beiträge zur Berufsgenossenschaft', 4210: 'Miete, unbewegliche Wirtschaftsgüter', 4240: 'Gas, Strom, Wasser',
  4320: 'Gewerbesteuer', 4360: 'Versicherungen', 4380: 'Beiträge', 4510: 'Kfz-Steuern',
  4530: 'Laufende Fahrzeug-Betriebskosten', 4570: 'Mietleasing Kfz', 4600: 'Werbekosten', 4650: 'Bewirtungskosten',
  4663: 'Reisekosten Arbeitnehmer, Fahrtkosten', 4805: 'Reparaturen und Instandhaltung',
  4830: 'Abschreibungen auf Sachanlagen', 4920: 'Telefon', 4930: 'Bürobedarf', 4945: 'Fortbildungskosten',
  4950: 'Rechts- und Beratungskosten', 4955: 'Buchführungskosten', 4964: 'Softwarelizenzen und Cloud-Dienste',
  4970: 'Nebenkosten des Geldverkehrs', 8400: 'Erlöse 19% USt',
};
// P&L accounts → line of the short-term P&L (everything else is a balance-sheet account).
const KERLINE = {
  8400: 'umsatz', 3100: 'wareneinkauf', 4120: 'personalkosten', 4124: 'personalkosten', 4130: 'personalkosten',
  4138: 'personalkosten', 4210: 'raumkosten', 4240: 'raumkosten', 4320: 'steuernEinkommen', 4360: 'versicherungen',
  4380: 'versicherungen', 4510: 'betrSteuern', 4530: 'fahrzeugkosten', 4570: 'fahrzeugkosten', 4600: 'werbeReise',
  4650: 'werbeReise', 4663: 'werbeReise', 4805: 'reparatur', 4830: 'abschreibungen', 4920: 'sonstigeKosten',
  4930: 'sonstigeKosten', 4945: 'sonstigeKosten', 4950: 'sonstigeKosten', 4955: 'sonstigeKosten', 4964: 'sonstigeKosten',
  4970: 'sonstigeKosten', 2100: 'zinsaufwand', 2200: 'steuernEinkommen', 2208: 'steuernEinkommen', 2650: 'zinsertraege',
};
const ERTRAG = new Set([8400, 2650]);
const PERSONEN = {
  10100: 'Muster Logistik AG', 10200: 'Beispiel Versicherung AG', 10300: 'Demo Energie GmbH',
  10400: 'Stadtwerke Musterstadt', 10500: 'Mustermann Maschinenbau KG', 10900: 'Diverse Kunden',
  70100: 'Cloudhost Beispiel GmbH', 70200: 'Freelancer-Pool Muster GbR', 70300: 'Bürohaus Musterstadt Verwaltung',
  70400: 'Autoleasing Demo AG', 70500: 'Steuerkanzlei Beispiel und Partner', 70900: 'Diverse Lieferanten',
};

// Ledger in cents: konto → { eb (debit +), kS, kH (year to date), mS, mH (September) }.
const ct = (eur) => Math.round(eur * 100);
const led = {};
const acct = (no) => (led[no] = led[no] || { eb: 0, kS: 0, kH: 0, mS: 0, mH: 0 });
// Personal accounts are a sub-ledger: they roll up into the control accounts 1400 / 1600.
const mitSammel = (no) => (no >= 70000 ? [no, 1600] : no >= 10000 ? [no, 1400] : [no]);
const eroeffnung = (no, eur) => mitSammel(no).forEach((n) => { acct(n).eb += ct(eur); });
// One business event: lines [konto, 'S' | 'H', year-to-date EUR, September EUR].
function buche(text, lines) {
  for (const f of [2, 3]) {
    const diff = lines.reduce((sum, l) => sum + (l[1] === 'S' ? 1 : -1) * ct(l[f]), 0);
    if (diff !== 0) throw new Error(`unbalanced entry "${text}" (${f === 2 ? 'ytd' : 'September'}): ${diff / 100}`);
  }
  for (const [no, side, ytd, sep] of lines) mitSammel(no).forEach((n) => {
    const k = acct(n); k['k' + side] += ct(ytd); k['m' + side] += ct(sep);
  });
}
const steuer = (netto, satz) => Math.round(ct(netto) * satz) / 100;
// Purchase invoices on a creditor or the credit card: items [konto, net ytd, net September, VAT rate].
// Returns the gross totals { ytd, sep }.
function eingang(text, gegenkonto, items) {
  const lines = []; let gy = 0, gs = 0;
  for (const [konto, ny, ns, satz] of items) {
    const vy = steuer(ny, satz), vs = steuer(ns, satz);
    lines.push([konto, 'S', ny, ns]);
    if (satz) lines.push([satz === 0.07 ? 1571 : 1576, 'S', vy, vs]);
    gy += ct(ny) + ct(vy); gs += ct(ns) + ct(vs);
  }
  lines.push([gegenkonto, 'H', gy / 100, gs / 100]);
  buche(text, lines);
  return { ytd: gy / 100, sep: gs / 100 };
}
// Settles a payable from the bank: everything except the September invoices is
// paid by month-end (September itself pays roughly the August volume).
function zahle(text, konto, ebOffen, rechn, sofort) {
  const sep = sofort ? rechn.sep : Math.round(ct(rechn.ytd - rechn.sep) / 8) / 100;
  const ytd = sofort ? ebOffen + rechn.ytd : ebOffen + rechn.ytd - rechn.sep;
  buche(text, [[konto, 'S', ytd, sep], [1200, 'H', ytd, sep]]);
}

// ---- Opening balance sheet (1 January)
eroeffnung(410, 48600.00); eroeffnung(1000, 312.40); eroeffnung(1200, 142318.45);
[[10100, 68425.00], [10200, 22610.00], [10400, 14280.00], [10900, 5950.00]].forEach(([no, v]) => eroeffnung(no, v));
eroeffnung(630, -36000.00); eroeffnung(800, -25000.00); eroeffnung(860, -163949.60);
eroeffnung(956, -3150.00); eroeffnung(963, -3420.00); eroeffnung(970, -6000.00); eroeffnung(977, -8500.00);
const KRED_EB = { 70100: 4820.00, 70200: 9520.00, 70300: 0, 70400: 0, 70500: 2380.00, 70900: 3115.40 };
Object.entries(KRED_EB).forEach(([no, v]) => eroeffnung(Number(no), -v));
eroeffnung(1730, -1240.15); eroeffnung(1741, -13920.40); eroeffnung(1790, -21480.30);

// ---- Sales: invoices (net ytd, net September) and payments received (ytd, September)
[[10100, 637700, 81000, 652190, 71400], [10200, 291100, 34500, 331534, 38675], [10300, 187400, 21000, 198016, 26180],
  [10400, 118900, 15000, 141491, 15470], [10500, 84300, 10000, 88417, 9520], [10900, 67000, 9800, 78540, 9877],
].forEach(([deb, ny, ns, zy, zs]) => {
  buche('Ausgangsrechnungen', [[deb, 'S', ny + steuer(ny, 0.19), ns + steuer(ns, 0.19)], [8400, 'H', ny, ns], [1776, 'H', steuer(ny, 0.19), steuer(ns, 0.19)]]);
  buche('Zahlungseingang', [[1200, 'S', zy, zs], [deb, 'H', zy, zs]]);
});

// ---- Purchases on account, paid the following month (rent: same month)
[[70200, [[3100, 96800.00, 14200.00, 0.19]]],
  [70100, [[4964, 52380.90, 6212.30, 0.19]]],
  [70300, [[4210, 40500.00, 4500.00, 0]], true],
  [70400, [[4570, 8910.00, 990.00, 0.19]]],
  [70500, [[4950, 9450.00, 0, 0.19], [4955, 7650.00, 850.00, 0.19]]],
  [70900, [[4240, 5214.60, 548.30, 0.19], [4600, 21460.00, 3150.00, 0.19], [4920, 3866.40, 431.10, 0.19],
    [4945, 11300.00, 1850.00, 0.19], [4805, 2140.00, 0, 0.19], [410, 9800.00, 0, 0.19],
    [4360, 6840.00, 760.00, 0], [4380, 1980.00, 220.00, 0]]],
].forEach(([kred, items, sofort]) => zahle('Zahlung Lieferant', kred, KRED_EB[kred], eingang('Eingangsrechnungen', kred, items), sofort));

// ---- Company credit card, settled the following month
zahle('Kreditkartenabrechnung', 1730, 1240.15, eingang('Kreditkartenumsätze', 1730, [
  [4663, 18722.35, 2416.90, 0.07], [4650, 3208.45, 412.60, 0.19], [4930, 2370.00, 223.15, 0.19], [4530, 5934.80, 702.40, 0.19]]));

// ---- Payroll: gross → wage tax, employee social security, net pay; plus the employer share
{
  const brutto = [612450.00, 69800.00], gf = [108000.00, 12000.00], ag = [131720.40, 14985.20];
  const lst = [0, 1].map((i) => steuer(brutto[i] + gf[i], 0.18)), an = brutto.map((v) => steuer(v, 0.195));
  const netto = [0, 1].map((i) => (ct(brutto[i]) + ct(gf[i]) - ct(lst[i]) - ct(an[i])) / 100);
  const sv = [0, 1].map((i) => (ct(an[i]) + ct(ag[i])) / 100);
  buche('Lohnlauf', [[4120, 'S', ...brutto], [4124, 'S', ...gf], [1741, 'H', ...lst], [1742, 'H', ...an], [1740, 'H', ...netto]]);
  buche('Arbeitgeberanteil', [[4130, 'S', ...ag], [1742, 'H', ...ag]]);
  buche('Nettolöhne', [[1740, 'S', ...netto], [1200, 'H', ...netto]]);
  buche('Sozialversicherung', [[1742, 'S', ...sv], [1200, 'H', ...sv]]);                 // due within the month
  zahle('Lohnsteuer', 1741, 13920.40, { ytd: lst[0], sep: lst[1] });                     // due the following month
}

// ---- Bank: direct debits, interest, loan, cash, taxes
buche('Berufsgenossenschaft', [[4138, 'S', 3184.00, 0], [1200, 'H', 3184.00, 0]]);
buche('Kfz-Steuer', [[4510, 'S', 312.00, 0], [1200, 'H', 312.00, 0]]);
buche('Kontoführung', [[4970, 'S', 624.15, 71.20], [1200, 'H', 624.15, 71.20]]);
buche('Darlehen', [[630, 'S', 9000.00, 1000.00], [2100, 'S', 1215.00, 135.00], [1200, 'H', 10215.00, 1135.00]]);
buche('Habenzinsen', [[1200, 'S', 486.20, 61.40], [2650, 'H', 486.20, 61.40]]);
buche('Barabhebung', [[1000, 'S', 600.00, 100.00], [1200, 'H', 600.00, 100.00]]);
buche('Barkäufe Bürobedarf', [[4930, 'S', 548.75, 64.30], [1000, 'H', 548.75, 64.30]]);
buche('Verbrauch Rückstellung', [[970, 'S', 2400.00, 0], [1200, 'H', 2400.00, 0]]);
buche('Abschreibung', [[4830, 'S', 14850.00, 1650.00], [410, 'H', 14850.00, 1650.00]]);
// Income-tax advance payments (three quarters; the third falls into September)
buche('Vorauszahlung Körperschaftsteuer', [[2200, 'S', 6900.00, 2300.00], [2208, 'S', 379.50, 126.50], [1200, 'H', 7279.50, 2426.50]]);
buche('Vorauszahlung Gewerbesteuer', [[4320, 'S', 6300.00, 2100.00], [1200, 'H', 6300.00, 2100.00]]);

// ---- VAT: prior-year balance, special advance payment (1/11), and the monthly returns.
// With a permanent extension the returns for January–July are paid by end of September;
// August and September are still open.
buche('Umsatzsteuer Vorjahr', [[1790, 'S', 21480.30, 0], [1200, 'H', 21480.30, 0]]);
buche('Sondervorauszahlung', [[1781, 'S', 18700.00, 0], [1200, 'H', 18700.00, 0]]);
{
  const vst = (f) => acct(1576)[f] + acct(1571)[f];
  const zahllastJanAug = (acct(1776).kH - acct(1776).mH) - (vst('kS') - vst('mS'));
  const proMonat = Math.round(zahllastJanAug / 8) / 100;
  buche('Umsatzsteuer-Vorauszahlungen', [[1780, 'S', 7 * proMonat, proMonat], [1200, 'H', 7 * proMonat, proMonat]]);
}

// ---- Consistency: opening balance sheet, movements and closing balances must each balance.
{
  const sach = Object.keys(KONTEN).map(Number);
  const sum = (fn) => sach.reduce((t, no) => t + fn(acct(no)), 0);
  const checks = { 'opening balances': sum((k) => k.eb), 'movements ytd': sum((k) => k.kS - k.kH),
    'movements September': sum((k) => k.mS - k.mH), 'closing balances': sum((k) => k.eb + k.kS - k.kH) };
  for (const [what, v] of Object.entries(checks)) if (v !== 0) throw new Error(`ledger does not balance (${what}): ${v / 100}`);
  for (const no of Object.keys(led)) if (!KONTEN[no] && !PERSONEN[no]) throw new Error(`booking on unknown account ${no}`);
}

// ---- Rows for the sheets below
const eur = (c) => c / 100;
const zeile = (no, label) => { const k = acct(no); return [no, label, eur(k.eb), eur(k.kS), eur(k.kH), eur(k.mS), eur(k.mH)]; };
// P&L accounts: [Konto, Bezeichnung, kumuliert, Monat, KER-Zeile, Seite]
const GUV = Object.keys(KERLINE).map(Number).map((no) => {
  const k = acct(no), h = ERTRAG.has(no);
  return [no, KONTEN[no], eur(h ? k.kH - k.kS : k.kS - k.kH), eur(h ? k.mH - k.mS : k.mS - k.mH), KERLINE[no], h ? 'H' : 'S'];
});
// Balance-sheet and personal accounts: [Konto, Bezeichnung, EB (Soll +, Haben −), kum. Soll, kum. Haben, Monat Soll, Monat Haben]
const BESTAND = Object.keys(KONTEN).map(Number).filter((no) => !KERLINE[no]).map((no) => zeile(no, KONTEN[no]));
const personen = (von, bis) => Object.keys(PERSONEN).map(Number).filter((no) => no >= von && no <= bis).map((no) => zeile(no, PERSONEN[no]));
const DEBITOREN = personen(10000, 69999), KREDITOREN = personen(70000, 99999);

// ---------------------------------------------------------------- Rechnen
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => r2(x).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const line = (id, f) => r2(GUV.filter((g) => g[4] === id).reduce((s, g) => s + g[f], 0));
const KOSTEN = [
  ['personalkosten', 'Personalkosten'], ['raumkosten', 'Raumkosten'], ['betrSteuern', 'Betriebliche Steuern'],
  ['versicherungen', 'Versicherungen/Beiträge'], ['besondereKosten', 'Besondere Kosten'],
  ['fahrzeugkosten', 'Fahrzeugkosten (ohne Steuer)'], ['werbeReise', 'Werbe-/Reisekosten'],
  ['kostenWarenabgabe', 'Kosten Warenabgabe'], ['abschreibungen', 'Abschreibungen'],
  ['reparatur', 'Reparatur/Instandhaltung'], ['sonstigeKosten', 'Sonstige Kosten'],
];
function ker(f) {                       // f: 2 = kumuliert, 3 = Monat
  const v = { umsatz: line('umsatz', f), wareneinkauf: line('wareneinkauf', f) };
  v.gesamtleistung = v.umsatz;
  v.rohertrag = r2(v.gesamtleistung - v.wareneinkauf);
  v.betrRohertrag = v.rohertrag;
  KOSTEN.forEach(([id]) => { v[id] = line(id, f); });
  v.gesamtkosten = r2(KOSTEN.reduce((s, [id]) => s + v[id], 0));
  v.betriebsergebnis = r2(v.betrRohertrag - v.gesamtkosten);
  v.zinsaufwand = line('zinsaufwand', f); v.neutralerAufwand = v.zinsaufwand;
  v.zinsertraege = line('zinsertraege', f); v.neutralerErtrag = v.zinsertraege;
  v.ergebnisVorSteuern = r2(v.betriebsergebnis - v.neutralerAufwand + v.neutralerErtrag);
  v.steuernEinkommen = line('steuernEinkommen', f);
  v.vorlaeufigesErgebnis = r2(v.ergebnisVorSteuern - v.steuernEinkommen);
  return v;
}
const M = ker(3), Y = ker(2);

// ------------------------------------------------- Kurzfristige Erfolgsrechnung
// [Bezeichnung, id, Stil, Prozentspalten]  Stil: b = fett, i = eingerückt, ii = doppelt eingerückt
const KER_ROWS = [
  null,
  ['Umsatzerlöse', 'umsatz', 'i', 'L'], ['Bestandsveränderg. FE/UE', null, 'i', 'L'], ['Aktivierte Eigenleistungen', null, 'i', 'L'],
  null, ['Gesamtleistung', 'gesamtleistung', 'b', 'LKP'],
  null, ['Material-/Wareneinkauf', 'wareneinkauf', 'i', 'LKPA'],
  null, ['Rohertrag', 'rohertrag', 'b', 'LKPA'],
  null, ['So. betr. Erlöse', null, 'i', 'LKP'],
  null, ['Betrieblicher Rohertrag', 'betrRohertrag', 'b', 'LKPA'],
  null, ['Kostenarten:', '-'],
  ...KOSTEN.map(([id, label]) => [label, id, 'i', 'LKP']),
  ['Gesamtkosten', 'gesamtkosten', 'b', 'LKP'],
  null, ['Betriebsergebnis', 'betriebsergebnis', 'b', 'L'],
  null, ['Zinsaufwand', 'zinsaufwand', 'ii', 'L'], ['Sonstiger neutraler Aufwand', null, 'ii', 'L'], ['Neutraler Aufwand', 'neutralerAufwand', 'bi', 'L'],
  null, ['Zinserträge', 'zinsertraege', 'ii', 'L'], ['Sonstiger neutraler Ertrag', null, 'ii', 'L'],
  ['Verrechnete kalk. Kosten', null, 'ii', 'L'], ['Neutraler Ertrag', 'neutralerErtrag', 'bi', 'L'],
  null, ['Kontenklasse unbesetzt', null, 'i', 'L'],
  null, ['Ergebnis vor Steuern', 'ergebnisVorSteuern', 'b', 'L'],
  null, ['Steuern Einkommen u. Ertrag', 'steuernEinkommen', 'i', 'L'],
  null, ['Vorläufiges Ergebnis', 'vorlaeufigesErgebnis', 'b', 'L'],
  null,
];
function kerBlock(V, id, cols) {
  const v = id ? V[id] : 0;
  const pc = (base) => (base ? fmt(v / base * 100) : '');
  const auf = !cols.includes('A') ? '' : id === 'wareneinkauf' ? '100,00' : (V.wareneinkauf ? fmt(v / V.wareneinkauf * 100) : '');
  return `<td class="n">${fmt(v)}</td><td class="n">${cols.includes('L') ? pc(V.gesamtleistung) : ''}</td>`
    + `<td class="n">${cols.includes('K') ? pc(V.gesamtkosten) : ''}</td><td class="n">${cols.includes('P') ? pc(V.personalkosten) : ''}</td>`
    + `<td class="n">${auf}</td>`;
}
const kerRows = KER_ROWS.map((r, i) => {
  const z = i % 2 ? ' class="z"' : '';
  if (!r) return `<tr${z}><td colspan="12">&nbsp;</td></tr>`;
  const [label, id, stil = '', cols = ''] = r;
  if (id === '-') return `<tr${z}><td colspan="12">${esc(label)}</td></tr>`;
  const cls = [stil.includes('b') ? 'b' : '', stil.includes('ii') ? 'ii' : stil.includes('i') ? 'i' : ''].join(' ').trim();
  return `<tr${z}><td class="${cls}">${esc(label)}</td>${kerBlock(M, id, cols).replace(/class="n"/g, `class="n ${stil.includes('b') ? 'b' : ''}"`)}`
    + `<td></td>${kerBlock(Y, id, cols).replace(/class="n"/g, `class="n ${stil.includes('b') ? 'b' : ''}"`)}</tr>`;
}).join('\n');

const head = (mitte, blatt) => `<div class="head">
  <div class="hl">${MANDANT}<br>${esc(FIRMA)}</div>
  <div class="hm">${mitte}</div>
  <div class="hr">${DATUM}<br>Blatt&nbsp;${blatt}</div></div>`;
const foot = (text) => `<div class="foot"><div>${text}</div><div class="fr">Demo-BWA · erfundene Firma und Zahlen<br>Werte in EUR</div></div>`;

const pctHead = '<th class="n">% Ges.-<br>Leistg.</th><th class="n">% Ges.-<br>Kosten</th><th class="n">% Pers.-<br>Kosten</th><th class="n">Auf-<br>schlag</th>';
const kerPage = `<section class="page">
  ${head(`<span class="title">Kurzfristige Erfolgsrechnung</span><br>${MONAT_LANG.replace(' ', '&nbsp;')}<br>SKR:&nbsp;03 &nbsp; BWA-Nr.:&nbsp;1 &nbsp; BWA-Form: DATEV-BWA &nbsp; Wareneinsatz: Wareneinkauf`, '1')}
  <table class="ker">
    <colgroup><col style="width:170pt"><col style="width:80pt"><col span="4" style="width:52pt"><col style="width:28pt"><col style="width:88pt"><col span="4" style="width:52pt"></colgroup>
    <thead><tr><th>Bezeichnung</th><th class="n">${MONAT}</th>${pctHead}<th></th><th class="n">${VON} -<br>${MONAT}</th>${pctHead}</tr></thead>
    <tbody>${kerRows}</tbody>
  </table>
  ${foot('Das vorläufige Ergebnis entspricht dem derzeitigen Stand der Buchführung. Abschluss-/Abgrenzungsbuchungen können es noch verändern.')}
</section>`;

// ------------------------------------------------------------ Summen und Salden
const bal = (x) => (Math.abs(r2(x)) < 0.005 ? '0,00' : `${fmt(Math.abs(x))} ${x > 0 ? 'S' : 'H'}`);
const mov = (x) => (Math.abs(r2(x)) < 0.005 ? '' : fmt(x));
const susaRow = ([no, label, eb, kS, kH, mS, mH]) => {
  const hatEb = Math.abs(eb) > 0.005;
  return `<td class="k">${no} ${esc(label)}</td><td class="n">${hatEb ? bal(eb) : ''}</td><td class="n">${mov(mS)}</td><td class="n">${mov(mH)}</td>`
    + `<td class="n">${mov(kS)}</td><td class="n">${mov(kH)}</td><td class="n">${bal(eb + kS - kH)}</td>`;
};
const guvAsRow = ([no, label, ytd, month, , side]) => (side === 'H' ? [no, label, 0, 0, ytd, 0, month] : [no, label, 0, ytd, 0, month, 0]);
const sach = [...BESTAND, ...GUV.map(guvAsRow)].sort((a, b) => a[0] - b[0]);

// Leerzeile zwischen den Kontenklassen, dann auf Seiten verteilen.
function mitKlassen(rows, klasse) {
  const out = []; let last = null;
  for (const r of rows) { const k = klasse(r[0]); if (last !== null && k !== last) out.push(null); last = k; out.push(r); }
  return out;
}
function susaPages(rows, untertitel, startBlatt) {
  const PER = 36, pages = [];
  for (let i = 0; i < rows.length; i += PER) {
    const body = rows.slice(i, i + PER).map((r, j) => `<tr${j % 2 ? ' class="z"' : ''}>${r ? susaRow(r) : '<td colspan="7">&nbsp;</td>'}</tr>`).join('\n');
    pages.push(`<section class="page">
  ${head(`Rechnungswesen<br>Summen und Salden (pro Monat) &nbsp; ${MONAT_LANG.replace(' ', '&nbsp;')}<br>${untertitel}`, String(1 + startBlatt + pages.length))}
  <table class="susa">
    <colgroup><col style="width:232pt"><col style="width:95pt"><col span="2" style="width:85pt"><col span="3" style="width:95pt"></colgroup>
    <thead><tr><th>Konto Beschriftung</th><th class="n">EB-Wert</th><th class="n">${MONAT_SUSA.replace(' ', '&nbsp;')}<br>Soll</th><th class="n"><br>Haben</th><th class="n">kum. Werte<br>Soll</th><th class="n"><br>Haben</th><th class="n">Saldo</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  ${foot('Die Auswertung entspricht dem derzeitigen Stand der Buchführung.')}
</section>`);
  }
  return pages;
}
const sachPages = susaPages(mitKlassen(sach, (no) => Math.floor(no / 1000)), 'Alle bebuchten Konten', 1);
const persPages = susaPages(mitKlassen([...DEBITOREN, ...KREDITOREN], (no) => (no < 70000 ? 1 : 7)), 'Debitoren und Kreditoren', 1 + sachPages.length);

const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 7.5pt Arial, Helvetica, sans-serif; color: #000; }
  .page { width: 842pt; height: 594pt; padding: 26pt 30pt 20pt; page-break-after: always; position: relative; overflow: hidden; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8pt; line-height: 1.35; }
  .hl { width: 200pt; } .hm { text-align: center; flex: 1; } .hr { width: 200pt; text-align: right; }
  .title { font-size: 12pt; }
  table { border-collapse: collapse; table-layout: fixed; width: 782pt; border: 0.75pt solid #000; }
  th { font-weight: normal; text-align: left; vertical-align: top; padding: 3pt 4pt 5pt; border-bottom: 0.75pt solid #000; line-height: 1.25; }
  td { padding: 0 4pt; height: 9.6pt; line-height: 9.6pt; white-space: nowrap; overflow: hidden; }
  .ker td:first-child, .ker th:first-child { border-right: 0.75pt solid #000; }
  .susa td { height: 10.4pt; line-height: 10.4pt; }
  .n { text-align: right; } .b { font-weight: bold; } .i { padding-left: 11pt; } .ii { padding-left: 18pt; }
  .k { padding-left: 14pt; }
  tr.z td { background: #ececec; }
  .foot { position: absolute; left: 30pt; right: 30pt; bottom: 14pt; display: flex; justify-content: space-between; font-size: 6.5pt; line-height: 1.3; }
  .fr { text-align: right; }
</style></head><body>${kerPage}${sachPages.join('')}${persPages.join('')}</body></html>`;

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  mkdirSync(dirname(OUT), { recursive: true });
  await page.pdf({ path: OUT, printBackground: true, preferCSSPageSize: true });
  await page.close();

  // Parse the PDF with the app itself, so the embedded demo is exactly what an
  // import of this file yields.
  const app = await browser.newPage();
  await app.goto(pathToFileURL(join(ROOT, 'dist', 'bwa-report.html')).href, { waitUntil: 'domcontentloaded' });
  await app.waitForSelector('#bwa-file');
  await (await app.$('#bwa-file')).uploadFile(OUT);
  await app.waitForFunction(() => window.__bwa && window.__bwa.parsed, { timeout: 60000 });
  const parsed = await app.evaluate(() => window.__bwa.parsed);
  if (!parsed.hasTurnover || Object.keys(parsed.ker).length < 30) throw new Error('demo BWA was not parsed completely');
  parsed.meta.demo = true;
  writeFileSync(DATA, '// Generated by tools/make-bwa-demo.mjs — do not edit by hand.\n'
    + '// Fictitious company and figures: the parsed demo BWA offered on the import screen.\n'
    + `window.qrxBwaDemo = ${JSON.stringify(parsed)};\n`);
} finally { await browser.close(); }

console.log(`written: ${OUT}`);
console.log(`written: ${DATA}`);
{
  const sal = (no) => fmt(Math.abs(eur(acct(no).eb + acct(no).kS - acct(no).kH)));
  console.log(`Bank ${sal(1200)} · Forderungen ${sal(1400)} · Verbindlichkeiten L+L ${sal(1600)} · Lohnsteuer ${sal(1741)}`);
}
console.log(`Umsatz kum. ${fmt(Y.umsatz)} · Betriebsergebnis ${fmt(Y.betriebsergebnis)} · Ergebnis vor Steuern ${fmt(Y.ergebnisVorSteuern)} · vorl. Ergebnis ${fmt(Y.vorlaeufigesErgebnis)}`);
