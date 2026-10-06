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
// Edit the figures below and re-run. The short-term P&L is derived from the P&L
// accounts, the balances from opening + debit − credit.
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

// ---- Erfolgskonten: [Konto, Bezeichnung, kumuliert, Monat, KER-Zeile, Seite]
const GUV = [
  [8400, 'Erlöse 19% USt', 1386400.00, 171300.00, 'umsatz', 'H'],
  [3100, 'Fremdleistungen', 96800.00, 14200.00, 'wareneinkauf'],
  [4120, 'Gehälter', 612450.00, 69800.00, 'personalkosten'],
  [4124, 'Geschäftsführergehälter GmbH-Gesells.', 108000.00, 12000.00, 'personalkosten'],
  [4130, 'Gesetzliche soziale Aufwendungen', 131720.40, 14985.20, 'personalkosten'],
  [4138, 'Beiträge zur Berufsgenossenschaft', 3184.00, 0, 'personalkosten'],
  [4210, 'Miete, unbewegliche Wirtschaftsgüter', 40500.00, 4500.00, 'raumkosten'],
  [4240, 'Gas, Strom, Wasser', 5214.60, 548.30, 'raumkosten'],
  [4320, 'Gewerbesteuer', 6300.00, 2100.00, 'steuernEinkommen'],
  [4360, 'Versicherungen', 6840.00, 760.00, 'versicherungen'],
  [4380, 'Beiträge', 1980.00, 220.00, 'versicherungen'],
  [4510, 'Kfz-Steuern', 312.00, 0, 'betrSteuern'],
  [4530, 'Laufende Fahrzeug-Betriebskosten', 5934.80, 702.40, 'fahrzeugkosten'],
  [4570, 'Mietleasing Kfz', 8910.00, 990.00, 'fahrzeugkosten'],
  [4600, 'Werbekosten', 21460.00, 3150.00, 'werbeReise'],
  [4650, 'Bewirtungskosten', 3208.45, 412.60, 'werbeReise'],
  [4663, 'Reisekosten Arbeitnehmer, Fahrtkosten', 18722.35, 2416.90, 'werbeReise'],
  [4805, 'Reparaturen und Instandhaltung', 2140.00, 0, 'reparatur'],
  [4830, 'Abschreibungen auf Sachanlagen', 14850.00, 1650.00, 'abschreibungen'],
  [4920, 'Telefon', 3866.40, 431.10, 'sonstigeKosten'],
  [4930, 'Bürobedarf', 2918.75, 287.45, 'sonstigeKosten'],
  [4945, 'Fortbildungskosten', 11300.00, 1850.00, 'sonstigeKosten'],
  [4950, 'Rechts- und Beratungskosten', 9450.00, 0, 'sonstigeKosten'],
  [4955, 'Buchführungskosten', 7650.00, 850.00, 'sonstigeKosten'],
  [4964, 'Softwarelizenzen und Cloud-Dienste', 52380.90, 6212.30, 'sonstigeKosten'],
  [4970, 'Nebenkosten des Geldverkehrs', 624.15, 71.20, 'sonstigeKosten'],
  [2100, 'Zinsen und ähnliche Aufwendungen', 1215.00, 135.00, 'zinsaufwand'],
  [2200, 'Körperschaftsteuer', 6900.00, 2300.00, 'steuernEinkommen'],
  [2208, 'Solidaritätszuschlag', 379.50, 126.50, 'steuernEinkommen'],
  [2650, 'Sonstige Zinsen und ähnliche Erträge', 486.20, 61.40, 'zinsertraege', 'H'],
];

// ---- Personenkonten: [Konto, Name, EB, kum. Soll, kum. Haben, Monat Soll, Monat Haben]
// Debitoren: EB/Saldo im Soll. Soll = fakturiert (brutto), Haben = Zahlungseingang.
const DEBITOREN = [
  [10100, 'Muster Logistik AG', 68425.00, 758863.00, 652190.00, 96390.00, 71400.00],
  [10200, 'Beispiel Versicherung AG', 22610.00, 346409.00, 331534.00, 41055.00, 38675.00],
  [10300, 'Demo Energie GmbH', 0, 223006.00, 198016.00, 24990.00, 26180.00],
  [10400, 'Stadtwerke Musterstadt', 14280.00, 141491.00, 141491.00, 17850.00, 15470.00],
  [10500, 'Mustermann Maschinenbau KG', 0, 100317.00, 88417.00, 11900.00, 9520.00],
  [10900, 'Diverse Kunden', 5950.00, 79730.00, 78540.00, 11662.00, 9877.00],
];
// Kreditoren: EB/Saldo im Haben (hier negativ). Haben = Rechnungen, Soll = Zahlungen.
const KREDITOREN = [
  [70100, 'Cloudhost Beispiel GmbH', -4820.00, 60940.10, 62333.27, 7104.30, 7392.67],
  [70200, 'Freelancer-Pool Muster GbR', -9520.00, 107814.00, 115192.00, 13090.00, 16898.00],
  [70300, 'Bürohaus Musterstadt Verwaltung', 0, 40500.00, 40500.00, 4500.00, 4500.00],
  [70400, 'Autoleasing Demo AG', 0, 9424.80, 10602.90, 1178.10, 1178.10],
  [70500, 'Steuerkanzlei Beispiel und Partner', -2380.00, 19694.50, 20349.00, 1011.50, 1011.50],
  [70900, 'Diverse Lieferanten', -3115.40, 81376.25, 84920.65, 9214.80, 9871.45],
];
const sumCol = (rows, i) => rows.reduce((s, r) => s + r[i], 0);

// ---- Bestandskonten: [Konto, Bezeichnung, EB (Soll +, Haben −), kum. Soll, kum. Haben, Monat Soll, Monat Haben]
const BESTAND = [
  [410, 'Geschäftsausstattung', 48600.00, 9800.00, 14850.00, 0, 1650.00],
  [630, 'Verbindlichkeiten gegenüber Kreditinstituten', -36000.00, 9000.00, 0, 1000.00, 0],
  [800, 'Gezeichnetes Kapital', -25000.00, 0, 0, 0, 0],
  [860, 'Gewinnvortrag vor Verwendung', -84312.60, 0, 0, 0, 0],
  [956, 'Gewerbesteuerrückstellung', -3150.00, 0, 0, 0, 0],
  [963, 'Körperschaftsteuerrückstellung', -3420.00, 0, 0, 0, 0],
  [970, 'Sonstige Rückstellungen', -6000.00, 2400.00, 0, 0, 0],
  [977, 'Rückstellungen für Abschluss und Prüfung', -8500.00, 0, 0, 0, 0],
  [1000, 'Kasse', 312.40, 600.00, 548.75, 100.00, 64.30],
  [1200, 'Bank Geschäftskonto', 142318.45, 1490674.20, 1404580.35, 171183.40, 158942.18],
  [1400, 'Forderungen aus Lieferungen und Leistungen', sumCol(DEBITOREN, 2), sumCol(DEBITOREN, 3), sumCol(DEBITOREN, 4), sumCol(DEBITOREN, 5), sumCol(DEBITOREN, 6)],
  [1576, 'Abziehbare Vorsteuer 19%', 0, 33905.47, 0, 4212.18, 0],
  [1600, 'Verbindlichkeiten aus Lieferungen und Leistungen', sumCol(KREDITOREN, 2), sumCol(KREDITOREN, 3), sumCol(KREDITOREN, 4), sumCol(KREDITOREN, 5), sumCol(KREDITOREN, 6)],
  [1730, 'Kreditkartenabrechnung', -1240.15, 28410.60, 30025.85, 3104.25, 3388.90],
  [1740, 'Verbindlichkeiten aus Lohn und Gehalt', 0, 498230.10, 498230.10, 56412.35, 56412.35],
  [1741, 'Verbindlichkeiten Lohn- und Kirchensteuer', -13920.40, 128455.20, 130340.60, 14410.75, 15805.80],
  [1742, 'Verbindlichkeiten soziale Sicherheit', 0, 252310.80, 259728.30, 28614.90, 29102.40],
  [1776, 'Umsatzsteuer 19%', 0, 0, 263416.00, 0, 32547.00],
  [1780, 'Umsatzsteuer-Vorauszahlungen', 0, 172640.00, 0, 26118.40, 0],
  [1781, 'Umsatzsteuer-Vorauszahlungen 1/11', 0, 19800.00, 0, 0, 0],
  [1790, 'Umsatzsteuer Vorjahr', -21480.30, 21480.30, 0, 0, 0],
];

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
console.log(`Umsatz kum. ${fmt(Y.umsatz)} · Betriebsergebnis ${fmt(Y.betriebsergebnis)} · Ergebnis vor Steuern ${fmt(Y.ergebnisVorSteuern)} · vorl. Ergebnis ${fmt(Y.vorlaeufigesErgebnis)}`);
