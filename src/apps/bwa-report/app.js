// === BWA Report — import a DATEV BWA (PDF) and produce a layperson report =====
// PDF text is read locally with pdf.js; the parser reconstructs the Kurzfristige
// Erfolgsrechnung (KER) and the Summen & Salden (SuSa) from text positions. The
// Umsatzsteuer-Voranmeldung sheet is intentionally ignored. Everything stays in
// the browser — nothing is uploaded.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const t = (k, p) => qrx.i18n.t('app.' + k, p);
  const esc = qrx.core.escapeHtml;
  const loc = () => qrx.i18n.locale();
  const eur0 = (n) => n == null ? '–' : n.toLocaleString(loc(), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eur2 = (n) => n == null ? '–' : n.toLocaleString(loc(), { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n, d) => (n == null ? '–' : (n * 100).toLocaleString(loc(), { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }) + ' %');

  // ------------------------------------------------------------------ i18n
  qrx.i18n.register('app', {
    de: {
      intro: 'Importiere eine DATEV-BWA als PDF und erhalte einen verständlichen Bericht mit den wichtigsten Kennzahlen — Ergebnis, Kostenstruktur und Liquidität — inklusive Bewertung und Empfehlungen. Alles läuft lokal im Browser, es wird nichts hochgeladen.',
      dropTitle: 'BWA-PDF hierher ziehen oder klicken', dropAria: 'BWA-PDF importieren',
      dropSub: 'DATEV-BWA (Kurzfristige Erfolgsrechnung + Summen & Salden). Nichts verlässt den Browser.',
      newImport: 'Neue BWA', print: 'Als PDF / Drucken',
      parsing: 'Lese BWA…', notBwa: 'Bitte eine PDF-Datei auswählen.',
      notBwaMsg: 'In der PDF wurde keine „Kurzfristige Erfolgsrechnung“ gefunden. Ist das eine DATEV-BWA?',
      parseError: 'Fehler beim Lesen: {msg}',
      periodLine: 'Monat {m} · kumuliert {p} · Stand {d}',
      // sections
      secGlance: 'Auf einen Blick', secErtrag: 'Wirtschaftliche Lage', secKosten: 'Kostenstruktur',
      secLiqui: 'Liquidität', secBewertung: 'Bewertung & Empfehlungen', secDetails: 'Details',
      // kpi labels
      kUmsatz: 'Umsatz', kBetriebsergebnis: 'Betriebsergebnis', kErgebnis: 'Ergebnis (vorläufig)',
      kMarge: 'Umsatzrendite', kLiquide: 'Liquide Mittel', kRunway: 'Reichweite (Stresstest)',
      kForderungen: 'Offene Forderungen', kVerbindl: 'Kurzfristige Verbindlichkeiten',
      kRueckstellungen: 'Rückstellungen', kNettoLiq: 'Netto-Liquidität', kPersonalquote: 'Personalkostenquote',
      suffMonth: 'Monat', suffYtd: 'kumuliert', perMonth: 'Ø/Monat', months: '{n} Monate', ofRevenue: 'vom Umsatz',
      // charts
      flowTitle: 'Wohin geht der Umsatz? (kumuliert)', costTitle: 'Größte Kostenblöcke (kumuliert)',
      segPersonal: 'Personalkosten', segSonstige: 'Sonstige Kosten', segUebrige: 'Übrige Kosten',
      segErgebnis: 'Betriebsergebnis', segVerlust: 'Verlust',
      // assessment
      lvGood: 'Gut', lvOk: 'Beachten', lvBad: 'Handeln', overall: 'Gesamteinschätzung',
      aErtragGood: 'Solide Ertragslage: Das Betriebsergebnis ist positiv ({erg}) bei einer Umsatzrendite von {marge}. Das Geschäft trägt sich aus eigener Kraft.',
      aErtragOk: 'Das Betriebsergebnis ist positiv ({erg}), die Marge ist mit {marge} aber dünn. Auf Kostendisziplin und Preise achten.',
      aErtragBad: 'Das Betriebsergebnis ist negativ ({erg}). Das Geschäft verbraucht mehr, als es einbringt — Gegensteuern hat Priorität.',
      aLiquiGood: 'Komfortable Liquidität: Nach Abzug kurzfristiger Verbindlichkeiten bleiben {netto}. Die liquiden Mittel decken die laufenden Verpflichtungen.',
      aLiquiOk: 'Die Liquidität ist positiv ({netto}), aber ohne großen Puffer. Zahlungsein- und -ausgänge im Blick behalten.',
      aLiquiBad: 'Die Liquidität ist angespannt ({netto}). Kurzfristige Verpflichtungen übersteigen die schnell verfügbaren Mittel — Liquiditätsplanung ist dringend.',
      runwayHint: 'Die liquiden Mittel würden die laufenden Kosten rund {m} decken, falls kein Umsatz mehr käme.',
      recTitle: 'Empfehlungen',
      'rec.solid': 'Ertragslage ist gesund (Marge {marge}). Rücklagen für Steuern und Investitionen bilden, statt Überschüsse ungenutzt zu lassen.',
      'rec.thin': 'Die Marge ist mit {marge} knapp. Preise, Auslastung und die größten Kostenblöcke gezielt prüfen.',
      'rec.loss': 'Operativer Verlust: Zuerst die größten Kostenblöcke senken oder Umsatz/Preise erhöhen; einen kurzfristigen Maßnahmenplan aufsetzen.',
      'rec.sonstige': 'Ein großer Kostenblock steckt in „Sonstige Kosten“ ({share} vom Umsatz) — häufig Fremdleistungen. Prüfen, ob planbar oder reduzierbar (siehe Details).',
      'rec.personal': 'Die Personalkostenquote ist mit {q} hoch. Für Dienstleister normal, aber Auslastung und Verrechnungssätze im Blick behalten.',
      'rec.tax': 'Für Steuern und Sozialabgaben sind rund {amount} zurückzustellen/abzuführen. Diese Liquidität separat bereithalten, nicht verplanen.',
      'rec.receivables': 'Es stehen {amount} an offenen Forderungen aus. Konsequentes Mahnwesen sichert die Liquidität und verkürzt die Kapitalbindung.',
      'rec.runway': 'Die Liquiditätsreichweite liegt unter {m} Monaten. Liquiditätsplanung erstellen und ggf. Finanzierung/Reserve aufbauen.',
      'rec.trend': 'Der Monatsumsatz liegt {p} unter dem bisherigen Schnitt. Prüfen, ob saisonal oder ein Trend — Auftragslage beobachten.',
      'rec.preliminary': 'Diese Auswertung ist vorläufig (Stand der Buchführung). Abschluss- und Abgrenzungsbuchungen können die Zahlen noch verändern.',
      // details
      detKer: 'Kurzfristige Erfolgsrechnung (GuV)', detExpense: 'Größte Aufwandskonten (kumuliert)',
      thLabel: 'Bezeichnung', thMonth: 'Monat', thYtd: 'kumuliert', thPct: '% Umsatz', thAccount: 'Konto', thAmount: 'Betrag',
      noSusa: 'Diese BWA enthält keine „Summen & Salden“-Blätter — die Liquiditätsanalyse benötigt sie. Ertrag und Kosten werden dennoch ausgewertet.',
      disclaimer: 'Vorläufige Auswertung auf Basis der importierten BWA · {company} · erstellt am {today} · Alle Berechnungen erfolgen lokal im Browser. Keine Steuer- oder Rechtsberatung.',
    },
    en: {
      intro: 'Import a DATEV BWA as a PDF and get a report anyone can understand, with the key figures — result, cost structure and liquidity — including a rating and recommendations. Everything runs locally in the browser; nothing is uploaded.',
      dropTitle: 'Drop a BWA PDF here, or click', dropAria: 'Import a BWA PDF',
      dropSub: 'DATEV BWA (short-term result statement + trial balance). Nothing leaves the browser.',
      newImport: 'New BWA', print: 'Save as PDF / print',
      parsing: 'Reading BWA…', notBwa: 'Please pick a PDF file.',
      notBwaMsg: 'No “Kurzfristige Erfolgsrechnung” was found in the PDF. Is this a DATEV BWA?',
      parseError: 'Read error: {msg}',
      periodLine: 'Month {m} · year-to-date {p} · as of {d}',
      secGlance: 'At a glance', secErtrag: 'Economic situation', secKosten: 'Cost structure',
      secLiqui: 'Liquidity', secBewertung: 'Rating & recommendations', secDetails: 'Details',
      kUmsatz: 'Revenue', kBetriebsergebnis: 'Operating result', kErgebnis: 'Result (preliminary)',
      kMarge: 'Operating margin', kLiquide: 'Cash & bank', kRunway: 'Runway (stress test)',
      kForderungen: 'Open receivables', kVerbindl: 'Short-term liabilities',
      kRueckstellungen: 'Provisions', kNettoLiq: 'Net liquidity', kPersonalquote: 'Personnel cost ratio',
      suffMonth: 'month', suffYtd: 'YTD', perMonth: 'avg/month', months: '{n} months', ofRevenue: 'of revenue',
      flowTitle: 'Where does revenue go? (YTD)', costTitle: 'Largest cost blocks (YTD)',
      segPersonal: 'Personnel', segSonstige: 'Other costs', segUebrige: 'Remaining costs',
      segErgebnis: 'Operating result', segVerlust: 'Loss',
      lvGood: 'Good', lvOk: 'Watch', lvBad: 'Act', overall: 'Overall assessment',
      aErtragGood: 'Solid earnings: the operating result is positive ({erg}) at a margin of {marge}. The business sustains itself.',
      aErtragOk: 'The operating result is positive ({erg}), but the margin of {marge} is thin. Keep cost discipline and pricing in view.',
      aErtragBad: 'The operating result is negative ({erg}). The business spends more than it earns — course-correcting is the priority.',
      aLiquiGood: 'Comfortable liquidity: after short-term liabilities, {netto} remains. Cash covers the running obligations.',
      aLiquiOk: 'Liquidity is positive ({netto}) but without much buffer. Keep an eye on incoming and outgoing payments.',
      aLiquiBad: 'Liquidity is tight ({netto}). Short-term obligations exceed the readily available funds — liquidity planning is urgent.',
      runwayHint: 'Cash would cover the running costs for about {m} if no more revenue came in.',
      recTitle: 'Recommendations',
      'rec.solid': 'Earnings are healthy (margin {marge}). Build reserves for taxes and investments rather than leaving surpluses idle.',
      'rec.thin': 'The margin is tight ({marge}). Review pricing, utilisation and the largest cost blocks.',
      'rec.loss': 'Operating loss: first reduce the largest cost blocks or raise revenue/prices; set up a short-term action plan.',
      'rec.sonstige': 'A large cost block sits in “other costs” ({share} of revenue) — often subcontracting. Check whether it is plannable or reducible (see details).',
      'rec.personal': 'The personnel cost ratio is high ({q}). Normal for a service business, but keep utilisation and billing rates in view.',
      'rec.tax': 'About {amount} should be set aside/remitted for taxes and social security. Keep this cash separate and unspent.',
      'rec.receivables': '{amount} in receivables is outstanding. Consistent dunning protects liquidity and shortens capital tie-up.',
      'rec.runway': 'The liquidity runway is below {m} months. Create a liquidity plan and build a reserve/financing if needed.',
      'rec.trend': 'Monthly revenue is {p} below the average so far. Check whether seasonal or a trend — watch the order book.',
      'rec.preliminary': 'This evaluation is preliminary (current bookkeeping status). Year-end and accrual entries may still change the figures.',
      detKer: 'Short-term result statement (P&L)', detExpense: 'Largest expense accounts (YTD)',
      thLabel: 'Item', thMonth: 'Month', thYtd: 'YTD', thPct: '% revenue', thAccount: 'Account', thAmount: 'Amount',
      noSusa: 'This BWA has no trial-balance sheets — the liquidity analysis needs them. Earnings and costs are still evaluated.',
      disclaimer: 'Preliminary evaluation based on the imported BWA · {company} · generated on {today} · All calculations run locally in the browser. Not tax or legal advice.',
    },
  });

  // ============================ pure parser (validated) ====================
  function num(s) {
    if (s == null) return null;
    const x = String(s).replace(/\s/g, '');
    if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(x)) return null;
    return Number(x.replace(/\./g, '').replace(',', '.'));
  }
  const isNum = (s) => num(s) != null;
  function normLabel(s) {
    return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  }
  function toLines(items) {
    const its = items.filter((i) => i.s.trim() !== '').slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const out = [];
    for (const it of its) {
      let l = out.find((l) => Math.abs(l.y - it.y) < 2.5);
      if (!l) { l = { y: it.y, items: [] }; out.push(l); }
      l.items.push(it);
    }
    out.forEach((l) => l.items.sort((a, b) => a.x - b.x));
    return out;
  }
  const pageText = (p) => p.items.map((i) => i.s).join(' ');
  const KER_MAP = {
    umsatzerloese: 'umsatz', bestandsveraendergfeue: 'bestand', aktivierteeigenleistungen: 'eigenleistung',
    gesamtleistung: 'gesamtleistung', materialwareneinkauf: 'wareneinkauf', rohertrag: 'rohertrag',
    sobetrerloese: 'sonstErloese', betrieblicherrohertrag: 'betrRohertrag', personalkosten: 'personalkosten',
    raumkosten: 'raumkosten', betrieblichesteuern: 'betrSteuern', versicherungenbeitraege: 'versicherungen',
    besonderekosten: 'besondereKosten', fahrzeugkostenohnesteuer: 'fahrzeugkosten', werbereisekosten: 'werbeReise',
    kostenwarenabgabe: 'kostenWarenabgabe', abschreibungen: 'abschreibungen', reparaturinstandhaltung: 'reparatur',
    sonstigekosten: 'sonstigeKosten', gesamtkosten: 'gesamtkosten', betriebsergebnis: 'betriebsergebnis',
    zinsaufwand: 'zinsaufwand', sonstigerneutraleraufwand: 'sonstNeutrAufwand', neutraleraufwand: 'neutralerAufwand',
    zinsertraege: 'zinsertraege', sonstigerneutralerertrag: 'sonstNeutrErtrag', verrechnetekalkkosten: 'verrechKalk',
    neutralerertrag: 'neutralerErtrag', kontenklasseunbesetzt: 'kontenklasseUnbesetzt',
    ergebnisvorsteuern: 'ergebnisVorSteuern', steuerneinkommenuertrag: 'steuernEinkommen',
    vorlaeufigesergebnis: 'vorlaeufigesErgebnis',
  };
  const COST_KEYS = ['personalkosten', 'raumkosten', 'betrSteuern', 'versicherungen', 'besondereKosten',
    'fahrzeugkosten', 'werbeReise', 'kostenWarenabgabe', 'abschreibungen', 'reparatur', 'sonstigeKosten'];
  const KER_ORDER = ['umsatz', 'bestand', 'eigenleistung', 'gesamtleistung', 'wareneinkauf', 'rohertrag',
    'sonstErloese', 'betrRohertrag', 'personalkosten', 'raumkosten', 'betrSteuern', 'versicherungen',
    'besondereKosten', 'fahrzeugkosten', 'werbeReise', 'kostenWarenabgabe', 'abschreibungen', 'reparatur',
    'sonstigeKosten', 'gesamtkosten', 'betriebsergebnis', 'zinsaufwand', 'sonstNeutrAufwand', 'neutralerAufwand',
    'zinsertraege', 'sonstNeutrErtrag', 'verrechKalk', 'neutralerErtrag', 'kontenklasseUnbesetzt',
    'ergebnisVorSteuern', 'steuernEinkommen', 'vorlaeufigesErgebnis'];
  const KER_BOLD = new Set(['gesamtleistung', 'rohertrag', 'betrRohertrag', 'gesamtkosten', 'betriebsergebnis',
    'ergebnisVorSteuern', 'vorlaeufigesErgebnis']);
  const MONTHS = { jan: 1, feb: 2, mar: 3, 'mär': 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 };

  function parseKer(page) {
    const rows = toLines(page.items).map((l) => ({
      label: l.items.filter((i) => !isNum(i.s) && i.s !== 'S' && i.s !== 'H').map((i) => i.s).join(' ').trim(),
      nums: l.items.filter((i) => isNum(i.s)),
    })).filter((r) => r.nums.length);
    const xs = [];
    rows.forEach((r) => r.nums.forEach((n) => xs.push(n.x)));
    xs.sort((a, b) => a - b);
    const centers = []; let cur = [xs[0]];
    for (let i = 1; i < xs.length; i++) { if (xs[i] - xs[i - 1] > 25) { centers.push(avg(cur)); cur = []; } cur.push(xs[i]); }
    centers.push(avg(cur));
    let gi = 1, gmax = -1;
    for (let i = 1; i < centers.length; i++) { const g = centers[i] - centers[i - 1]; if (g > gmax) { gmax = g; gi = i; } }
    const divider = (centers[gi] + centers[gi - 1]) / 2;
    const ker = {};
    for (const r of rows) {
      const id = KER_MAP[normLabel(r.label)];
      if (!id) continue;
      const left = r.nums.filter((n) => n.x < divider).sort((a, b) => a.x - b.x);
      const right = r.nums.filter((n) => n.x >= divider).sort((a, b) => a.x - b.x);
      ker[id] = { label: r.label, month: left.length ? num(left[0].s) : null, ytd: right.length ? num(right[0].s) : null };
    }
    return ker;
  }
  const avg = (a) => a.reduce((s, b) => s + b, 0) / a.length;

  function parseSusa(pages) {
    const accounts = [];
    for (const p of pages) for (const l of toLines(p.items)) {
      const m = l.items[0].s.match(/^(\d{3,6})\b\s*(.*)$/);
      if (!m) continue;
      const toks = [];
      for (const it of l.items.filter((i) => i.x > 150)) {
        for (const part of it.s.trim().split(/\s+/)) {
          if (part === 'S' || part === 'H') toks.push({ t: 's', v: part });
          else if (isNum(part)) toks.push({ t: 'n', v: num(part) });
        }
      }
      const nums = toks.filter((x) => x.t === 'n'), sides = toks.filter((x) => x.t === 's');
      if (!nums.length) continue;
      accounts.push({ no: Number(m[1]), label: m[2].trim(), saldoAbs: nums[nums.length - 1].v, side: sides.length ? sides[sides.length - 1].v : null });
    }
    return accounts;
  }
  function companyName(pages) {
    const counts = {};
    for (const p of pages) for (const l of toLines(p.items)) {
      const s = l.items.map((i) => i.s).join(' ').trim();
      const m = s.match(/^(.{2,50}?(?:GmbH|AG|UG|KG|GbR|SE|mbH|e\.K\.))(?:\s|$)/);
      if (m && !/Auswertung|Rechnungswesen|Kanzlei|Voranmeldung/.test(m[1])) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || '';
  }
  function meta(pages) {
    const all = pages.map(pageText).join('  ');
    const date = (all.match(/\b(\d{2}\.\d{2}\.\d{4})\b/) || [])[1] || '';
    const rangeM = all.match(/([A-Za-zä]{3})\/(\d{4})\s*-\s*([A-Za-zä]{3})\/(\d{4})/);
    let monthsElapsed = null, periodLabel = '', currentMonth = '';
    if (rangeM) {
      const s = MONTHS[rangeM[1].toLowerCase().slice(0, 3)], e = MONTHS[rangeM[3].toLowerCase().slice(0, 3)];
      if (s && e) monthsElapsed = e - s + 1;
      periodLabel = rangeM[1] + '/' + rangeM[2] + ' – ' + rangeM[3] + '/' + rangeM[4];
      currentMonth = rangeM[3] + '/' + rangeM[4];
    }
    return { company: companyName(pages), date, monthsElapsed, periodLabel, currentMonth, currency: 'EUR' };
  }
  function parseBwa(pages) {
    const kerPage = pages.find((p) => /Kurzfristige Erfolgsrechnung/i.test(pageText(p)));
    const susaPages = pages.filter((p) => /Summen und Salden/i.test(pageText(p)));
    if (!kerPage) return { error: 'no-ker' };
    return { meta: meta(pages), ker: parseKer(kerPage), susa: parseSusa(susaPages), hasSusa: susaPages.length > 0 };
  }

  // ------------------------------------------------------------ KPI engine
  const bucket = (accs, lo, hi, asset) => accs.filter((a) => a.no >= lo && a.no <= hi)
    .reduce((s, a) => s + (a.side === 'S' ? a.saldoAbs : a.side === 'H' ? -a.saldoAbs : 0) * (asset ? 1 : -1), 0);
  function kpis(parsed) {
    const k = parsed.ker, a = parsed.susa || [];
    const v = (id, f) => (k[id] && k[id][f] != null ? k[id][f] : 0);
    const months = parsed.meta.monthsElapsed || 1;
    const o = {
      umsatzMonth: v('umsatz', 'month'), umsatzYtd: v('umsatz', 'ytd'),
      gesamtleistungYtd: v('gesamtleistung', 'ytd'), betrRohertragYtd: v('betrRohertrag', 'ytd'),
      gesamtkostenMonth: v('gesamtkosten', 'month'), gesamtkostenYtd: v('gesamtkosten', 'ytd'),
      betriebsergebnisMonth: v('betriebsergebnis', 'month'), betriebsergebnisYtd: v('betriebsergebnis', 'ytd'),
      ergebnisMonth: v('vorlaeufigesErgebnis', 'month'), ergebnisYtd: v('vorlaeufigesErgebnis', 'ytd'),
      personalYtd: v('personalkosten', 'ytd'), sonstigeYtd: v('sonstigeKosten', 'ytd'), months,
    };
    o.umsatzrenditeYtd = o.umsatzYtd ? o.betriebsergebnisYtd / o.umsatzYtd : 0;
    o.personalquoteYtd = o.gesamtleistungYtd ? o.personalYtd / o.gesamtleistungYtd : 0;
    o.avgMonthlyUmsatz = o.umsatzYtd / months;
    o.avgMonthlyKosten = o.gesamtkostenYtd / months;
    o.umsatzTrend = o.avgMonthlyUmsatz ? (o.umsatzMonth - o.avgMonthlyUmsatz) / o.avgMonthlyUmsatz : 0;
    o.costStructure = COST_KEYS.map((id) => ({ id, label: k[id] && k[id].label, ytd: v(id, 'ytd') }))
      .filter((c) => c.ytd > 0).sort((x, y) => y.ytd - x.ytd);
    if (parsed.hasSusa && a.length) {
      const L = {
        cash: bucket(a, 1000, 1099, true) + bucket(a, 1200, 1290, true) + bucket(a, 1360, 1360, true),
        receivables: bucket(a, 1400, 1449, true), payablesLuL: bucket(a, 1600, 1609, false),
        creditCard: bucket(a, 1730, 1739, false), wageLiab: bucket(a, 1740, 1749, false),
        provisions: bucket(a, 950, 999, false),
      };
      L.shortTermLiab = L.payablesLuL + L.creditCard + L.wageLiab;
      L.netLiquidity = L.cash + L.receivables - L.shortTermLiab;
      L.runwayMonths = o.avgMonthlyKosten > 0 ? L.cash / o.avgMonthlyKosten : null;
      o.liquidity = L;
    }
    return o;
  }

  // ---------------------------------------------------------- assessment
  function assess(K) {
    const recs = [];
    const ergPos = K.betriebsergebnisYtd > 0;
    const margin = K.umsatzrenditeYtd;
    const ertrag = ergPos ? (margin >= 0.10 ? 'good' : 'ok') : 'bad';
    let liqui = null;
    if (K.liquidity) {
      const L = K.liquidity;
      if (L.netLiquidity > 0 && L.cash >= L.shortTermLiab && (ergPos || (L.runwayMonths || 0) >= 6)) liqui = 'good';
      else if (L.netLiquidity > 0) liqui = 'ok';
      else liqui = 'bad';
    }
    if (ertrag === 'bad') recs.push(t('rec.loss'));
    else if (ertrag === 'good') recs.push(t('rec.solid', { marge: pct(margin) }));
    else recs.push(t('rec.thin', { marge: pct(margin) }));
    const gl = K.gesamtleistungYtd;
    if (gl && K.sonstigeYtd / gl > 0.20) recs.push(t('rec.sonstige', { share: pct(K.sonstigeYtd / gl) }));
    if (K.personalquoteYtd > 0.70) recs.push(t('rec.personal', { q: pct(K.personalquoteYtd) }));
    if (K.liquidity) {
      const L = K.liquidity;
      const taxLike = L.provisions + Math.max(0, L.wageLiab);
      if (taxLike > 0) recs.push(t('rec.tax', { amount: eur0(taxLike) }));
      if (gl && L.receivables > 0.15 * gl) recs.push(t('rec.receivables', { amount: eur0(L.receivables) }));
      if (!ergPos && L.runwayMonths != null && L.runwayMonths < 3) recs.push(t('rec.runway', { m: L.runwayMonths.toFixed(1) }));
    }
    if (K.umsatzTrend < -0.15) recs.push(t('rec.trend', { p: pct(Math.abs(K.umsatzTrend)) }));
    recs.push(t('rec.preliminary'));
    const levels = [ertrag, liqui].filter(Boolean);
    const overall = levels.includes('bad') ? 'bad' : levels.includes('ok') ? 'ok' : 'good';
    return { ertrag, liqui, overall, recs };
  }

  // ------------------------------------------------------------ rendering
  const dot = (lvl) => `<span class="bwa-dot bwa-${lvl}" title="${esc(t('lv' + lvl[0].toUpperCase() + lvl.slice(1)))}"></span>`;
  const lvlWord = (lvl) => t('lv' + lvl[0].toUpperCase() + lvl.slice(1));

  function card(label, value, sub, lvl) {
    return `<div class="bwa-card">
      <div class="bwa-card-label">${lvl ? dot(lvl) : ''}${esc(label)}</div>
      <div class="bwa-card-value">${value}</div>
      ${sub ? `<div class="bwa-card-sub">${sub}</div>` : ''}
    </div>`;
  }
  function money2(n) { return `<span class="${n < 0 ? 'bwa-neg' : ''}">${eur0(n)}</span>`; }

  function costBars(K) {
    const items = K.costStructure.slice(0, 7);
    const max = Math.max(...items.map((c) => c.ytd), 1);
    return items.map((c) => {
      const w = Math.round((c.ytd / max) * 100);
      const share = K.gesamtleistungYtd ? c.ytd / K.gesamtleistungYtd : 0;
      const hot = c.id === 'personalkosten' || c.id === 'sonstigeKosten';
      return `<div class="bwa-bar-row">
        <div class="bwa-bar-label" title="${esc(c.label || '')}">${esc(c.label || '')}</div>
        <div class="bwa-bar-track"><div class="bwa-bar-fill${hot ? ' bwa-bar-hot' : ''}" style="width:${w}%"></div></div>
        <div class="bwa-bar-val">${eur0(c.ytd)} · ${pct(share, 0)}</div>
      </div>`;
    }).join('');
  }
  function euroFlow(K) {
    const erg = K.betriebsergebnisYtd;
    const uebrige = Math.max(0, K.gesamtkostenYtd - K.personalYtd - K.sonstigeYtd);
    const loss = Math.max(0, -erg);
    const segs = [
      { k: 'segPersonal', v: K.personalYtd, c: 'p' },
      { k: 'segSonstige', v: K.sonstigeYtd, c: 's' },
      { k: 'segUebrige', v: uebrige, c: 'u' },
      { k: 'segErgebnis', v: Math.max(0, erg), c: 'e' },
      { k: 'segVerlust', v: loss, c: 'l' },
    ].filter((s) => s.v > 0);
    const base = segs.reduce((a, b) => a + b.v, 0) || 1;
    const bar = segs.map((s) => `<div class="bwa-seg bwa-seg-${s.c}" style="width:${(s.v / base) * 100}%" title="${esc(t(s.k))}: ${eur0(s.v)}"></div>`).join('');
    const legend = segs.map((s) => `<span class="bwa-leg"><span class="bwa-leg-dot bwa-seg-${s.c}"></span>${esc(t(s.k))} · ${pct(s.v / base, 0)}</span>`).join('');
    return `<div class="bwa-flow"><div class="bwa-flow-bar">${bar}</div><div class="bwa-flow-legend">${legend}</div></div>`;
  }

  function kerTable(K, parsed) {
    const k = parsed.ker;
    const rows = KER_ORDER.filter((id) => k[id]).map((id) => {
      const r = k[id];
      const share = K.gesamtleistungYtd && r.ytd != null ? r.ytd / K.gesamtleistungYtd : null;
      return `<tr class="${KER_BOLD.has(id) ? 'bwa-tr-bold' : ''}">
        <td>${esc(r.label)}</td>
        <td class="bwa-num">${r.month != null ? eur2(r.month) : ''}</td>
        <td class="bwa-num">${r.ytd != null ? eur2(r.ytd) : ''}</td>
        <td class="bwa-num bwa-muted">${share != null ? pct(share, 1) : ''}</td>
      </tr>`;
    }).join('');
    return `<table class="bwa-table"><thead><tr>
      <th>${esc(t('thLabel'))}</th><th class="bwa-num">${esc(t('thMonth'))}</th>
      <th class="bwa-num">${esc(t('thYtd'))}</th><th class="bwa-num">${esc(t('thPct'))}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }
  function expenseTable(parsed) {
    const top = (parsed.susa || []).filter((a) => a.no >= 4000 && a.no <= 4999 && a.side === 'S' && a.saldoAbs > 0)
      .sort((a, b) => b.saldoAbs - a.saldoAbs).slice(0, 10);
    if (!top.length) return '';
    const rows = top.map((a) => `<tr><td class="bwa-muted">${a.no}</td><td>${esc(a.label)}</td><td class="bwa-num">${eur2(a.saldoAbs)}</td></tr>`).join('');
    return `<h4 class="bwa-h4">${esc(t('detExpense'))}</h4><table class="bwa-table"><thead><tr>
      <th>${esc(t('thAccount'))}</th><th>${esc(t('thLabel'))}</th><th class="bwa-num">${esc(t('thAmount'))}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderReport(parsed) {
    const K = kpis(parsed), A = assess(K), m = parsed.meta;
    $('bwa-company').textContent = m.company || 'BWA';
    $('bwa-period').textContent = t('periodLine', { m: m.currentMonth || '–', p: m.periodLabel || '–', d: m.date || '–' });

    const glance = card(t('kUmsatz') + ' · ' + t('suffYtd'), eur0(K.umsatzYtd), t('perMonth') + ' ' + eur0(K.avgMonthlyUmsatz))
      + card(t('kBetriebsergebnis'), money2(K.betriebsergebnisYtd), t('kMarge') + ' ' + pct(K.umsatzrenditeYtd), A.ertrag)
      + card(t('kErgebnis'), money2(K.ergebnisYtd), t('suffMonth') + ' ' + eur0(K.ergebnisMonth))
      + (K.liquidity ? card(t('kLiquide'), eur0(K.liquidity.cash), t('kNettoLiq') + ' ' + eur0(K.liquidity.netLiquidity), A.liqui) : '');

    // Ertrag section
    const ertragText = t('aErtrag' + capitalize(A.ertrag), { erg: eur0(K.betriebsergebnisYtd), marge: pct(K.umsatzrenditeYtd) });
    const ertragBody = `<div class="bwa-cols">
      <div class="bwa-chart-box"><div class="bwa-chart-title">${esc(t('flowTitle'))}</div>${euroFlow(K)}</div>
      <div class="bwa-assess bwa-assess-${A.ertrag}">${dot(A.ertrag)}<div>${esc(ertragText)}</div></div>
    </div>`;

    const kostenBody = `<div class="bwa-chart-title">${esc(t('costTitle'))}</div>${costBars(K)}`;

    let liquiBody = '';
    if (K.liquidity) {
      const L = K.liquidity;
      const cards = card(t('kLiquide'), eur0(L.cash))
        + card(t('kForderungen'), eur0(L.receivables))
        + card(t('kVerbindl'), eur0(L.shortTermLiab))
        + card(t('kRueckstellungen'), eur0(L.provisions))
        + card(t('kNettoLiq'), money2(L.netLiquidity), null, A.liqui)
        + (L.runwayMonths != null ? card(t('kRunway'), t('months', { n: L.runwayMonths.toFixed(1) })) : '');
      const runwayHint = L.runwayMonths != null ? `<p class="bwa-note">${esc(t('runwayHint', { m: t('months', { n: L.runwayMonths.toFixed(1) }) }))}</p>` : '';
      const liquiText = t('aLiqui' + capitalize(A.liqui), { netto: eur0(L.netLiquidity) });
      liquiBody = `<div class="bwa-cards">${cards}</div>
        <div class="bwa-assess bwa-assess-${A.liqui}">${dot(A.liqui)}<div>${esc(liquiText)}</div></div>${runwayHint}`;
    } else {
      liquiBody = `<p class="bwa-note">${esc(t('noSusa'))}</p>`;
    }

    const recs = `<div class="bwa-overall bwa-assess-${A.overall}">${dot(A.overall)}<strong>${esc(t('overall'))}: ${esc(lvlWord(A.overall))}</strong></div>
      <ul class="bwa-recs">${A.recs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;

    const details = `<details class="bwa-details"><summary>${esc(t('detKer'))}</summary>
        <div class="bwa-table-wrap">${kerTable(K, parsed)}</div>
        ${expenseTable(parsed)}
      </details>`;

    $('bwa-body').innerHTML =
      section('secGlance', `<div class="bwa-cards">${glance}</div>`)
      + section('secErtrag', ertragBody)
      + section('secKosten', kostenBody)
      + section('secLiqui', liquiBody)
      + section('secBewertung', recs)
      + section('secDetails', details);

    $('bwa-disclaimer').textContent = t('disclaimer', {
      company: m.company || '–',
      today: new Date().toLocaleDateString(loc(), { year: 'numeric', month: '2-digit', day: '2-digit' }),
    });
  }
  const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
  function section(key, body) {
    return `<section class="bwa-sec"><h3 class="bwa-h3">${esc(t(key))}</h3>${body}</section>`;
  }

  // ------------------------------------------------------------ pdf.js
  let pdfReady = false;
  function ensurePdf() {
    if (pdfReady) return;
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfReady = true;
  }
  async function extractPages(buf) {
    ensurePdf();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p);
      const tc = await pg.getTextContent();
      pages.push({ items: tc.items.filter((i) => i.str.trim() !== '').map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] })) });
    }
    return pages;
  }

  // ------------------------------------------------------------ flow
  const state = { parsed: null };
  const status = qrx.ui.status($('bwa-status'));

  async function handleFile(file) {
    if (!file) return;
    if (!/pdf/i.test(file.type || '') && !/\.pdf$/i.test(file.name || '')) { status.set(t('notBwa'), 'error'); return; }
    status.set(t('parsing'));
    await new Promise((r) => setTimeout(r, 15));
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const pages = await extractPages(buf);
      const parsed = parseBwa(pages);
      if (parsed.error === 'no-ker') { status.set(t('notBwaMsg'), 'error'); return; }
      state.parsed = parsed;
      renderReport(parsed);
      $('bwa-intro').hidden = true;
      $('bwa-drop').hidden = true;
      $('bwa-report').hidden = false;
      status.set('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (window.qrxTest) window.qrxTest.tick('report');
    } catch (err) {
      console.error(err);
      status.set(t('parseError', { msg: err && err.message ? err.message : String(err) }), 'error');
    }
  }
  function reset() {
    state.parsed = null;
    $('bwa-report').hidden = true;
    $('bwa-body').innerHTML = '';
    $('bwa-intro').hidden = false;
    $('bwa-drop').hidden = false;
    $('bwa-file').value = '';
  }

  // dropzone + file input (shared widget)
  qrx.ui.dropzone($('bwa-drop'), {
    input: $('bwa-file'), accept: '.pdf,application/pdf',
    onFiles: (files) => { if (files && files[0]) handleFile(files[0]); },
  });
  $('bwa-reset').addEventListener('click', reset);
  $('bwa-print').addEventListener('click', () => window.print());
  qrx.i18n.onChange(() => { if (state.parsed) renderReport(state.parsed); });

  // test hook
  window.__bwa = { parseBwa, kpis, assess, handleFile, get parsed() { return state.parsed; } };
})();
