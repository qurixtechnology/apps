// === Test Data Generator — app logic ========================================
// Generates realistic, referentially-linked business test data entirely in the
// browser, loads it into DuckDB-WASM through a typed CSV round-trip (read_csv is
// a core reader — no JSON extension needed), and exports to every format the
// converter supports. Quality problems are injected on a tunable scale.
// ============================================================================
(function () {
  'use strict';

  const D = qrx.duckdb;
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => qrx.i18n.t('app.' + k, p);
  const nf = (n) => Number(n).toLocaleString(qrx.i18n.locale());

  // ------------------------------------------------------------------ i18n
  qrx.i18n.register('app', {
    de: {
      intro: 'Erzeugt realistische, verknüpfte Testdaten für typische Unternehmensbereiche. '
        + 'Nichts verlässt den Browser — Generierung und Export laufen vollständig lokal auf DuckDB-WASM.',
      configTitle: 'Konfiguration', domains: 'Bereiche',
      'dom.customers': 'Kundendaten', 'dom.orders': 'Auftrags- / Bestelldaten',
      'dom.finance': 'Finanz- / Buchungsdaten', 'dom.catalog': 'Produkt- & Mitarbeiterdaten',
      region: 'Region der Daten', 'region.de': 'Deutschland (DE)', 'region.en': 'International (EN)',
      size: 'Datenmenge — Basis-Datensätze', quality: 'Qualitätsstufe',
      'q.clean': 'klinisch sauber', 'q.light': 'leicht', 'q.realistic': 'realistisch', 'q.messy': 'stark fehlerhaft',
      fineTune: 'Feinjustierung der Fehlerarten', seed: 'Seed (für reproduzierbare Daten)',
      rerollHint: 'Neuen Zufalls-Seed würfeln', generate: 'Testdaten erzeugen',
      exportTitle: 'Export',
      exportHint: 'Alle von DuckDB unterstützten Formate. Bei mehreren Tabellen: Excel/ODS als eine Mappe mit einem Blatt pro Tabelle, andere Formate als ZIP.',
      scope: 'Umfang', 'scope.current': 'Aktuelle Tabelle', 'scope.all': 'Alle Tabellen',
      exportBtn: 'Exportieren', resultsTitle: 'Daten & Export', 'q.custom': 'individuell',
      configSummary: '{quality} · {rows} Basis · {region}',
      resultsSummary: '{tables} Tabellen · {rows} Zeilen',
      // dynamic
      sizeHint: 'Ergibt ca.: {list}.',
      depHint: 'Automatisch ergänzt (für Verknüpfungen nötig): {list}.',
      qCleanHint: 'Perfekt konsistente Daten — keine Fehler, ideale Typen und Formate.',
      qLightHint: 'Wenige, dezente Qualitätsprobleme — wie in gepflegten Systemen.',
      qRealisticHint: 'Typischer Mix aus fehlenden Werten, Formatchaos, Dubletten und Tippfehlern.',
      qMessyHint: 'Stark verrauschte Daten — viele NULLs, inkonsistente Formate, Ausreißer.',
      qCustomHint: 'Individuell justiert.',
      'knob.nulls': 'Fehlende Werte (NULL)', 'knob.duplicates': 'Dubletten',
      'knob.typos': 'Tippfehler', 'knob.formatChaos': 'Formatinkonsistenz',
      'knob.outliers': 'Ausreißer / Fehlwerte', 'knob.whitespace': 'Whitespace & Groß-/Kleinschreibung',
      'knobd.nulls': 'Setzt zufällig Felder auf NULL.',
      'knobd.duplicates': 'Fügt doppelte / fast doppelte Datensätze ein.',
      'knobd.typos': 'Vertauscht, löscht oder verdoppelt Zeichen in Namen/Texten.',
      'knobd.formatChaos': 'Gemischte Datums-, Zahlen-, Telefon- und Länderformate (als Text).',
      'knobd.outliers': 'Negative Preise, unmögliche Datumswerte, extreme Beträge.',
      'knobd.whitespace': 'Führende/abschließende Leerzeichen und wechselnde Schreibweise.',
      generating: 'Erzeuge Testdaten…', loading: 'Lade in DuckDB…',
      done: '{tables} Tabellen, {rows} Zeilen erzeugt.',
      genError: 'Fehler bei der Generierung: {msg}',
      previewMeta: '{cols} Spalten · {rows} Zeilen · Vorschau der ersten {shown}',
      issuesClean: 'Keine Qualitätsprobleme injiziert (klinisch sauber).',
      'issue.nulls': '{n}× NULL', 'issue.duplicates': '{n}× Dublette',
      'issue.typos': '{n}× Tippfehler', 'issue.formatIssues': '{n}× Formatabweichung',
      'issue.outliers': '{n}× Ausreißer', 'issue.whitespace': '{n}× Whitespace/Casing',
      exporting: 'Exportiere…', exportDone: 'Export fertig: {name}',
      exportError: 'Export fehlgeschlagen: {msg}',
      pickFormat: 'Bitte ein Format wählen.',
      optCompression: 'Komprimierung', optNone: 'keine',
      'tbl.customers': 'Kunden', 'tbl.orders': 'Aufträge', 'tbl.order_items': 'Auftragspositionen',
      'tbl.transactions': 'Buchungen', 'tbl.products': 'Produkte', 'tbl.employees': 'Mitarbeiter',
      // import mode
      'mode.domains': 'Vorlagen (Bereiche)', 'mode.file': 'Aus Datei ableiten',
      importDrop: 'Datei hierher ziehen oder klicken zum Auswählen',
      importFormats: 'CSV · TSV · Parquet · JSON · NDJSON — Struktur, Statistik und Muster werden übernommen',
      importAria: 'Datei importieren', importing: 'Analysiere Datei…',
      importDone: '{cols} Spalten · {rows} Zeilen analysiert.', importError: 'Import fehlgeschlagen: {msg}',
      fileRows: 'Anzahl zu erzeugender Zeilen',
      templateHead: 'Erkannt aus „{name}": {cols} Spalten, {rows} Zeilen. Muster, Wertebereiche und NULL-Quoten werden nachgebildet.',
      tplNull: '{p}% NULL', tplRange: 'Bereich {min}…{max}', tplBool: '{p}% wahr',
      tplCat: 'Kategorie ({n}): {vals}', tplPattern: 'Muster: {pats}', tplFaker: 'Synthetisch: {type}',
      'sem.person': 'Name', 'sem.firstname': 'Vorname', 'sem.lastname': 'Nachname', 'sem.company': 'Firma',
      'sem.city': 'Stadt', 'sem.street': 'Straße', 'sem.country': 'Land', 'sem.reference': 'Verwendungszweck',
      asCategory: 'als Kategorie',
      asCategoryHint: 'Aktiv: echte Werte werden gemäß Häufigkeit übernommen. Deaktivieren, um stattdessen vollsynthetische Werte per Faker (anhand des erkannten Spaltentyps) zu erzeugen — so landen keine echten Werte in den Testdaten.',
      needImport: 'Bitte zuerst eine Datei importieren.',
      cfgFile: '{quality} · {rows} Zeilen · {name}',
    },
    en: {
      intro: 'Generates realistic, linked test data for typical business domains. '
        + 'Nothing leaves the browser — generation and export run entirely locally on DuckDB-WASM.',
      configTitle: 'Configuration', domains: 'Domains',
      'dom.customers': 'Customer data', 'dom.orders': 'Order data',
      'dom.finance': 'Finance / transactions', 'dom.catalog': 'Product & employee data',
      region: 'Data region', 'region.de': 'Germany (DE)', 'region.en': 'International (EN)',
      size: 'Data volume — base records', quality: 'Quality level',
      'q.clean': 'clinically clean', 'q.light': 'light', 'q.realistic': 'realistic', 'q.messy': 'heavily flawed',
      fineTune: 'Fine-tune the issue types', seed: 'Seed (for reproducible data)',
      rerollHint: 'Roll a new random seed', generate: 'Generate test data',
      exportTitle: 'Export',
      exportHint: 'Every format DuckDB supports. With multiple tables: Excel/ODS as one workbook with a sheet per table, other formats as a ZIP.',
      scope: 'Scope', 'scope.current': 'Current table', 'scope.all': 'All tables',
      exportBtn: 'Export', resultsTitle: 'Data & Export', 'q.custom': 'custom',
      configSummary: '{quality} · {rows} base · {region}',
      resultsSummary: '{tables} tables · {rows} rows',
      sizeHint: 'Yields approx.: {list}.',
      depHint: 'Added automatically (needed for links): {list}.',
      qCleanHint: 'Perfectly consistent data — no errors, ideal types and formats.',
      qLightHint: 'Few, subtle quality issues — like well-maintained systems.',
      qRealisticHint: 'A typical mix of missing values, format chaos, duplicates and typos.',
      qMessyHint: 'Heavily noisy data — many NULLs, inconsistent formats, outliers.',
      qCustomHint: 'Custom-tuned.',
      'knob.nulls': 'Missing values (NULL)', 'knob.duplicates': 'Duplicates',
      'knob.typos': 'Typos', 'knob.formatChaos': 'Format inconsistency',
      'knob.outliers': 'Outliers / bad values', 'knob.whitespace': 'Whitespace & casing',
      'knobd.nulls': 'Randomly sets fields to NULL.',
      'knobd.duplicates': 'Inserts duplicate / near-duplicate records.',
      'knobd.typos': 'Swaps, drops or doubles characters in names/text.',
      'knobd.formatChaos': 'Mixed date, number, phone and country formats (as text).',
      'knobd.outliers': 'Negative prices, impossible dates, extreme amounts.',
      'knobd.whitespace': 'Leading/trailing spaces and inconsistent casing.',
      generating: 'Generating test data…', loading: 'Loading into DuckDB…',
      done: 'Generated {tables} tables, {rows} rows.',
      genError: 'Generation failed: {msg}',
      previewMeta: '{cols} columns · {rows} rows · preview of the first {shown}',
      issuesClean: 'No quality issues injected (clinically clean).',
      'issue.nulls': '{n} NULLs', 'issue.duplicates': '{n} duplicates',
      'issue.typos': '{n} typos', 'issue.formatIssues': '{n} format deviations',
      'issue.outliers': '{n} outliers', 'issue.whitespace': '{n} whitespace/casing',
      exporting: 'Exporting…', exportDone: 'Export ready: {name}',
      exportError: 'Export failed: {msg}',
      pickFormat: 'Please pick a format.',
      optCompression: 'Compression', optNone: 'none',
      'tbl.customers': 'Customers', 'tbl.orders': 'Orders', 'tbl.order_items': 'Order items',
      'tbl.transactions': 'Transactions', 'tbl.products': 'Products', 'tbl.employees': 'Employees',
      // import mode
      'mode.domains': 'Templates (domains)', 'mode.file': 'Derive from a file',
      importDrop: 'Drop a file here, or click to pick one',
      importFormats: 'CSV · TSV · Parquet · JSON · NDJSON — structure, statistics and patterns are reused',
      importAria: 'Import a file', importing: 'Analysing file…',
      importDone: '{cols} columns · {rows} rows analysed.', importError: 'Import failed: {msg}',
      fileRows: 'Number of rows to generate',
      templateHead: 'Detected from “{name}”: {cols} columns, {rows} rows. Patterns, value ranges and NULL rates are reproduced.',
      tplNull: '{p}% NULL', tplRange: 'range {min}…{max}', tplBool: '{p}% true',
      tplCat: 'category ({n}): {vals}', tplPattern: 'pattern: {pats}', tplFaker: 'synthetic: {type}',
      'sem.person': 'Name', 'sem.firstname': 'First name', 'sem.lastname': 'Last name', 'sem.company': 'Company',
      'sem.city': 'City', 'sem.street': 'Street', 'sem.country': 'Country', 'sem.reference': 'Reference / text',
      asCategory: 'as category',
      asCategoryHint: 'On: real values are kept by frequency. Turn off to generate fully synthetic values via the Faker (based on the detected column type) instead — so no real values end up in the test data.',
      needImport: 'Please import a file first.',
      cfgFile: '{quality} · {rows} rows · {name}',
    },
  });

  // ------------------------------------------------------------ seeded RNG
  function makeRng(seedStr) {
    let h = 2166136261 >>> 0;
    for (const ch of String(seedStr)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rng = makeRng('qurix');
  const rnd = () => rng();
  const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const round2 = (x) => Math.round(x * 100) / 100;

  // ------------------------------------------------------------ locale data
  const DATA = {
    de: {
      firstM: ['Lukas', 'Elias', 'Paul', 'Jonas', 'Leon', 'Finn', 'Noah', 'Ben', 'Luis', 'Felix', 'Maximilian', 'Anton', 'Jan', 'Tim', 'Moritz', 'Niklas', 'David', 'Julian', 'Philipp', 'Sebastian', 'Andreas', 'Thomas', 'Michael', 'Stefan', 'Markus'],
      firstF: ['Emma', 'Mia', 'Hannah', 'Sophia', 'Lea', 'Marie', 'Lena', 'Anna', 'Laura', 'Julia', 'Sarah', 'Lisa', 'Katharina', 'Johanna', 'Clara', 'Nele', 'Ida', 'Charlotte', 'Emilia', 'Frida', 'Petra', 'Sabine', 'Claudia', 'Nicole', 'Andrea'],
      last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Schäfer', 'Koch', 'Bauer', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Lange', 'Werner', 'Krause'],
      streets: ['Hauptstraße', 'Bahnhofstraße', 'Gartenstraße', 'Schulstraße', 'Dorfstraße', 'Lindenstraße', 'Bergstraße', 'Kirchweg', 'Ringstraße', 'Goethestraße', 'Schillerstraße', 'Wiesenweg', 'Am Markt', 'Mühlenweg', 'Birkenweg'],
      cities: [['10115', 'Berlin'], ['20095', 'Hamburg'], ['80331', 'München'], ['50667', 'Köln'], ['60311', 'Frankfurt'], ['70173', 'Stuttgart'], ['40213', 'Düsseldorf'], ['44135', 'Dortmund'], ['04109', 'Leipzig'], ['01067', 'Dresden'], ['30159', 'Hannover'], ['90402', 'Nürnberg'], ['28195', 'Bremen'], ['45127', 'Essen'], ['53111', 'Bonn']],
      country: 'Deutschland', countryVariants: ['Deutschland', 'DE', 'Germany', 'GER', 'deutschland'],
      companyWords: ['Nordwind', 'Alpen', 'Rheinland', 'Kontor', 'Technik', 'Digital', 'Solar', 'Bau', 'Handel', 'Logistik', 'Pharma', 'Automotive', 'Data', 'Systeme', 'Metall'],
      companySuffix: ['GmbH', 'AG', 'KG', 'GmbH & Co. KG', 'e.K.', 'SE'],
      segments: ['Privat', 'Geschäftskunde', 'Großkunde', 'Öffentlich'],
      orderStatus: ['offen', 'bezahlt', 'versendet', 'storniert', 'retourniert'],
      productCats: ['Elektronik', 'Bürobedarf', 'Werkzeug', 'Möbel', 'Verbrauchsmaterial', 'Software', 'Ersatzteile', 'Zubehör'],
      productWords: ['Pro', 'Basic', 'Kompakt', 'Premium', 'XL', 'Mini', 'Eco', 'Plus', 'Industrie', 'Home'],
      departments: ['Vertrieb', 'Einkauf', 'Buchhaltung', 'IT', 'Personal', 'Marketing', 'Produktion', 'Logistik', 'Support'],
      roles: ['Sachbearbeiter/in', 'Teamleiter/in', 'Referent/in', 'Manager/in', 'Werkstudent/in', 'Abteilungsleiter/in'],
      txCats: ['Wareneingang', 'Gehalt', 'Miete', 'Provision', 'Erstattung', 'Steuer', 'Zinsen', 'Sonstiges'],
      reference: ['Rechnung', 'Gutschrift', 'Zahlung', 'Lastschrift', 'Erstattung', 'Bestellung', 'Abschlag', 'Mitgliedsbeitrag', 'Miete', 'Gehalt'],
      domains: ['example.de', 'firma.de', 'mail.de', 'web.de', 'gmx.de', 't-online.de'],
      phoneCc: '+49', currency: 'EUR',
    },
    en: {
      firstM: ['James', 'Oliver', 'Jack', 'Harry', 'George', 'Noah', 'Charlie', 'Jacob', 'Thomas', 'William', 'Oscar', 'Henry', 'Leo', 'Archie', 'Ethan', 'Joshua', 'Alexander', 'Daniel', 'Samuel', 'Max', 'Michael', 'David', 'John', 'Robert', 'Mark'],
      firstF: ['Olivia', 'Amelia', 'Isla', 'Ava', 'Emily', 'Sophia', 'Grace', 'Mia', 'Poppy', 'Ella', 'Lily', 'Charlotte', 'Freya', 'Ivy', 'Rosie', 'Emma', 'Chloe', 'Sophie', 'Hannah', 'Alice', 'Sarah', 'Laura', 'Rachel', 'Jessica', 'Anna'],
      last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Robinson', 'Wright', 'Thompson', 'Evans', 'Walker', 'White', 'Roberts', 'Green', 'Hall', 'Wood', 'Jackson', 'Clarke', 'Harris', 'Lewis', 'Turner', 'Martin', 'Cooper'],
      streets: ['High Street', 'Station Road', 'Church Lane', 'Main Street', 'Park Avenue', 'Victoria Road', 'Green Lane', 'Manor Road', 'Kings Road', 'Queens Road', 'Mill Lane', 'The Grove', 'Oak Avenue', 'Elm Street', 'North Road'],
      cities: [['EC1A', 'London'], ['M1', 'Manchester'], ['B1', 'Birmingham'], ['LS1', 'Leeds'], ['G1', 'Glasgow'], ['L1', 'Liverpool'], ['S1', 'Sheffield'], ['BS1', 'Bristol'], ['EH1', 'Edinburgh'], ['CF10', 'Cardiff'], ['NE1', 'Newcastle'], ['NG1', 'Nottingham'], ['OX1', 'Oxford'], ['CB1', 'Cambridge'], ['BN1', 'Brighton']],
      country: 'United Kingdom', countryVariants: ['United Kingdom', 'UK', 'GB', 'Great Britain', 'united kingdom'],
      companyWords: ['Northwind', 'Summit', 'Vertex', 'Harbour', 'Nova', 'Bright', 'Solar', 'Iron', 'Trade', 'Logistics', 'Pharma', 'Motors', 'Data', 'Systems', 'Metal'],
      companySuffix: ['Ltd', 'Inc', 'LLC', 'PLC', 'Group', 'Co.'],
      segments: ['Retail', 'Business', 'Enterprise', 'Public sector'],
      orderStatus: ['open', 'paid', 'shipped', 'cancelled', 'returned'],
      productCats: ['Electronics', 'Office supplies', 'Tools', 'Furniture', 'Consumables', 'Software', 'Spare parts', 'Accessories'],
      productWords: ['Pro', 'Basic', 'Compact', 'Premium', 'XL', 'Mini', 'Eco', 'Plus', 'Industrial', 'Home'],
      departments: ['Sales', 'Purchasing', 'Accounting', 'IT', 'HR', 'Marketing', 'Production', 'Logistics', 'Support'],
      roles: ['Associate', 'Team Lead', 'Specialist', 'Manager', 'Working Student', 'Head of Department'],
      txCats: ['Goods receipt', 'Payroll', 'Rent', 'Commission', 'Refund', 'Tax', 'Interest', 'Other'],
      reference: ['Invoice', 'Credit note', 'Payment', 'Direct debit', 'Refund', 'Order', 'Instalment', 'Membership fee', 'Rent', 'Salary'],
      domains: ['example.com', 'company.co.uk', 'mail.com', 'outlook.com', 'gmail.com', 'yahoo.co.uk'],
      phoneCc: '+44', currency: 'GBP',
    },
  };

  const translit = (s) => s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^a-zA-Z0-9._-]/g, '');

  function emailOf(first, last, loc) {
    const sep = pick(['.', '_', '']);
    return translit(first).toLowerCase() + sep + translit(last).toLowerCase() + '@' + pick(loc.domains);
  }
  function phoneOf(loc) {
    return loc.phoneCc + ' ' + randInt(20, 89) + ' ' + randInt(1000000, 9999999);
  }
  // IBAN with valid ISO 13616 check digits (DE = 22 chars, GB = 22 chars).
  function ibanOf(region) {
    const digits = (s) => s.toUpperCase().replace(/[A-Z]/g, (c) => (c.charCodeAt(0) - 55).toString());
    const mod97 = (str) => { let r = 0; for (const c of str) r = (r * 10 + Number(c)) % 97; return r; };
    let cc, bban;
    if (region === 'en') {
      const bank = String.fromCharCode(65 + randInt(0, 25), 65 + randInt(0, 25), 65 + randInt(0, 25), 65 + randInt(0, 25));
      bban = bank + String(randInt(0, 999999)).padStart(6, '0') + String(randInt(0, 99999999)).padStart(8, '0');
      cc = 'GB';
    } else {
      bban = String(randInt(10000000, 99999999)) + String(randInt(0, 9999999999)).padStart(10, '0');
      cc = 'DE';
    }
    const check = 98 - mod97(digits(bban + cc + '00'));
    return cc + String(check).padStart(2, '0') + bban;
  }

  const DAY = 86400000;
  const now = new Date();
  function dateBetween(startY, endDaysAgo) {
    const start = new Date(startY, 0, 1).getTime();
    const end = now.getTime() - (endDaysAgo || 0) * DAY;
    return new Date(start + rnd() * (end - start));
  }
  const fmtISO = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  // ------------------------------------------------------------ generators
  // Each returns { cols: [{name, kind, type}], rows: [obj] } with CANONICAL
  // native values (numbers, Date, strings, null). dirtify() mutates later.
  function genCustomers(n, loc, region) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const isCompany = chance(0.3);
      const female = chance(0.5);
      const first = female ? pick(loc.firstF) : pick(loc.firstM);
      const last = pick(loc.last);
      const [zip, city] = pick(loc.cities);
      rows.push({
        id: i,
        customer_no: 'K-' + String(100000 + i),
        type: isCompany ? 'company' : 'person',
        first_name: isCompany ? null : first,
        last_name: isCompany ? null : last,
        company_name: isCompany ? (pick(loc.companyWords) + ' ' + pick(loc.companyWords) + ' ' + pick(loc.companySuffix)) : null,
        email: emailOf(isCompany ? pick(loc.companyWords) : first, isCompany ? 'info' : last, loc),
        phone: phoneOf(loc),
        street: pick(loc.streets) + ' ' + randInt(1, 199),
        zip: zip, city: city, country: loc.country,
        segment: pick(loc.segments),
        created_at: dateBetween(2015, 1),
        revenue_ytd: round2(rnd() * (isCompany ? 500000 : 20000)),
      });
    }
    return {
      cols: [
        c('id', 'id'), c('customer_no', 'code'), c('type', 'category'),
        c('first_name', 'name', true), c('last_name', 'name', true), c('company_name', 'name', true),
        c('email', 'email', true), c('phone', 'phone', true),
        c('street', 'text', true), c('zip', 'code', true), c('city', 'text', true), c('country', 'country', true),
        c('segment', 'category', true), c('created_at', 'date', true), c('revenue_ytd', 'money', true),
      ], rows,
    };
  }

  function genProducts(n, loc) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const cat = pick(loc.productCats);
      rows.push({
        id: i, sku: 'SKU-' + String(10000 + i),
        name: cat + ' ' + pick(loc.productWords) + ' ' + randInt(100, 999),
        category: cat,
        unit_price: round2(1 + rnd() * 900),
        currency: loc.currency,
        in_stock: randInt(0, 500),
        created_at: dateBetween(2016, 1),
      });
    }
    return {
      cols: [
        c('id', 'id'), c('sku', 'code'), c('name', 'text'), c('category', 'category'),
        c('unit_price', 'money'), c('currency', 'category'), c('in_stock', 'int'), c('created_at', 'date', true),
      ], rows,
    };
  }

  function genEmployees(n, loc) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const female = chance(0.5);
      const first = female ? pick(loc.firstF) : pick(loc.firstM);
      const last = pick(loc.last);
      rows.push({
        id: i, employee_no: 'E-' + String(1000 + i),
        first_name: first, last_name: last,
        email: emailOf(first, last, loc),
        department: pick(loc.departments), role: pick(loc.roles),
        hire_date: dateBetween(2010, 30),
        salary: round2(30000 + rnd() * 90000),
        manager_id: i > 3 ? randInt(1, Math.max(1, Math.floor(n / 8))) : null,
      });
    }
    return {
      cols: [
        c('id', 'id'), c('employee_no', 'code'), c('first_name', 'name'), c('last_name', 'name'),
        c('email', 'email', true), c('department', 'category'), c('role', 'category'),
        c('hire_date', 'date', true), c('salary', 'money', true), c('manager_id', 'fk', true),
      ], rows,
    };
  }

  function genOrders(n, loc, custIds, empIds) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
      rows.push({
        id: i, order_no: 'A-' + String(2024000 + i),
        customer_id: pick(custIds),
        sales_rep_id: empIds.length ? pick(empIds) : null,
        order_date: dateBetween(2022, 0),
        status: pick(loc.orderStatus),
        total_amount: 0,             // filled from items later if present
        currency: loc.currency,
      });
    }
    return {
      cols: [
        c('id', 'id'), c('order_no', 'code'), c('customer_id', 'fk'), c('sales_rep_id', 'fk', true),
        c('order_date', 'date'), c('status', 'category'), c('total_amount', 'money'), c('currency', 'category'),
      ], rows,
    };
  }

  function genOrderItems(orders, products) {
    const rows = [];
    let id = 1;
    for (const o of orders) {
      const lines = randInt(1, 5);
      let total = 0;
      for (let k = 0; k < lines; k++) {
        const p = pick(products.rows);
        const qty = randInt(1, 20);
        const unit = p.unit_price;
        const lt = round2(qty * unit);
        total += lt;
        rows.push({
          id: id++, order_id: o.id, product_id: p.id,
          quantity: qty, unit_price: unit, line_total: lt,
        });
      }
      o.total_amount = round2(total);
    }
    return {
      cols: [
        c('id', 'id'), c('order_id', 'fk'), c('product_id', 'fk'),
        c('quantity', 'int'), c('unit_price', 'money'), c('line_total', 'money'),
      ], rows,
    };
  }

  function genTransactions(n, loc, region, custIds, orderIds) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
      const credit = chance(0.5);
      rows.push({
        id: i, booking_no: 'B-' + String(500000 + i),
        booking_date: dateBetween(2022, 0),
        amount: round2((credit ? 1 : -1) * (10 + rnd() * 9000)),
        currency: loc.currency,
        direction: credit ? 'credit' : 'debit',
        iban: ibanOf(region),
        category: pick(loc.txCats),
        customer_id: custIds.length ? pick(custIds) : null,
        order_id: orderIds.length && chance(0.5) ? pick(orderIds) : null,
      });
    }
    return {
      cols: [
        c('id', 'id'), c('booking_no', 'code'), c('booking_date', 'date'),
        c('amount', 'money'), c('currency', 'category'), c('direction', 'category'),
        c('iban', 'iban', true), c('category', 'category', true),
        c('customer_id', 'fk', true), c('order_id', 'fk', true),
      ], rows,
    };
  }

  function c(name, kind, nullable) { return { name, kind, nullable: !!nullable }; }

  // kind → clean DuckDB type
  const CLEAN_TYPE = {
    // money is DOUBLE, not DECIMAL: DuckDB-WASM hands DECIMAL back to Arrow as an
    // unscaled 128-bit integer, so 16486.37 would read back / preview as "1648637".
    // DOUBLE round-trips cleanly and round2() keeps the two decimals.
    id: 'BIGINT', fk: 'BIGINT', int: 'INTEGER', money: 'DOUBLE', date: 'DATE',
    bool: 'BOOLEAN', code: 'VARCHAR', name: 'VARCHAR', email: 'VARCHAR', phone: 'VARCHAR',
    iban: 'VARCHAR', country: 'VARCHAR', category: 'VARCHAR', text: 'VARCHAR',
  };
  const CHAOS_KINDS = { date: 1, money: 1, phone: 1, country: 1 };

  // ------------------------------------------------------ import & profiling
  // Learn a per-column model (type, null rate, ranges, categories, value masks)
  // from an imported file, then synthesise NEW rows that match the structure,
  // the statistics and the character patterns — without copying real values.
  const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', LO = 'abcdefghijklmnopqrstuvwxyz';
  function gaussian(mean, std) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function weightedPick(items) {
    let sum = 0; for (const it of items) sum += it.w;
    let x = rnd() * sum;
    for (const it of items) { x -= it.w; if (x <= 0) return it; }
    return items[items.length - 1];
  }
  // From an exact mask + real samples, produce a fill template: each position is
  // either a class token ('A'/'a'/'9', randomised on generation) or a literal
  // character (punctuation from the mask, or a letter/digit that is CONSTANT
  // across all samples — so fixed prefixes/suffixes like "CUST-" survive).
  // A template element is either a plain string (literal char — punctuation or a
  // constant letter/digit) or a token object {c:'A'|'a'|'9'} to be randomised.
  // Tokens must be objects, not the chars 'A'/'a'/'9', so a CONSTANT value that
  // happens to be 'a'/'A'/'9' (e.g. the "a" in "example") stays literal.
  function buildTemplate(mask, samples) {
    const chars = Array.from(mask);
    const usable = samples.map((s) => Array.from(s)).filter((a) => a.length === chars.length);
    // Only lock a letter/digit position as constant when at least TWO distinct
    // source values share this mask. Otherwise a mask that maps to a single real
    // value (a unique name) would be reproduced verbatim — which is exactly what
    // "as category = off" must avoid. Punctuation always stays literal.
    const lock = new Set(usable.map((a) => a.join(''))).size >= 2;
    return chars.map((ch, i) => {
      if (ch !== 'A' && ch !== 'a' && ch !== '9') return ch;   // punctuation → literal
      if (lock && usable.length) { const c0 = usable[0][i]; if (usable.every((a) => a[i] === c0)) return c0; }
      return { c: ch };                                        // token → randomised
    });
  }
  function fillTemplate(tpl) {
    let s = '';
    for (const el of tpl) {
      if (typeof el === 'string') { s += el; continue; }
      if (el.c === 'A') s += UP[randInt(0, 25)];
      else if (el.c === 'a') s += LO[randInt(0, 25)];
      else s += String(randInt(0, 9));
    }
    return s;
  }
  // Learn the value masks (patterns) of a string column from tdg_src, keeping
  // constant positions literal. Used for high-cardinality columns AND for
  // categoricals (so the user can switch a category off → synthetic values).
  async function buildMasks(conn, q, total) {
    const an = await qrx.patterns.analyze({ query: (sql) => conn.query(sql), from: 'tdg_src', col: q, total, limit: 12 });
    const mexpr = qrx.patterns.maskExpr(q, false);   // exact mask (run lengths kept)
    const masks = [];
    for (const row of an.exact.rows) {
      const sample = D.rows(await conn.query(
        `SELECT CAST(${q} AS VARCHAR) AS v FROM tdg_src WHERE ${mexpr} = ${D.str(row.pat)} AND ${q} IS NOT NULL LIMIT 40`))
        .map((r) => r.v);
      masks.push({ mask: row.pat, w: row.c, template: buildTemplate(row.pat, sample) });
    }
    return { masks, example: (an.exact.rows[0] && an.exact.rows[0].example) || '' };
  }

  // ---- semantic column typing → Faker -------------------------------------
  // Detect what a text column MEANS (name, city, street, …). Detected PII-ish
  // text types are generated by a Faker (fully synthetic, from the locale pools)
  // so no original characters survive. Structured columns (codes, phone, IBAN,
  // postal, e-mail) keep the mask synthesis — there the variable parts are
  // already randomised and only non-personal structure (a "+49 " or "@host")
  // stays. Categorical columns are reproduced as-is unless switched off.
  const FAKER_SEMANTICS = new Set(['person', 'firstname', 'lastname', 'company', 'city', 'street', 'country', 'reference']);
  const NAME_HINTS = {
    firstname: ['vorname', 'firstname', 'first_name', 'given', 'rufname'],
    lastname: ['nachname', 'lastname', 'last_name', 'surname', 'familienname'],
    person: ['name', 'kunde', 'zahlungspflicht', 'zahlungsempf', 'empfänger', 'empfaenger', 'payer', 'payee',
      'inhaber', 'ansprechpartner', 'kontoinhaber', 'customer', 'client', 'person', 'contact', 'auftraggeber',
      'debitor', 'kreditor', 'beguenstigt', 'begünstigt'],
    company: ['firma', 'unternehmen', 'company', 'organis', 'betrieb', 'mandant', 'lieferant', 'vendor'],
    postal: ['plz', 'postleit', 'zip', 'postcode', 'postal'],
    street: ['straße', 'strasse', 'street', 'anschrift', 'adresse', 'address'],
    city: ['stadt', 'wohnort', 'city', 'town'],
    country: ['land', 'country', 'staat', 'nation'],
    email: ['email', 'e-mail', 'mail'],
    phone: ['telefon', 'phone', 'tel', 'mobil', 'handy', 'fax', 'mobile'],
    iban: ['iban', 'konto'],
    reference: ['verwendungszweck', 'betreff', 'beschreibung', 'description', 'kommentar', 'comment', 'memo',
      'zweck', 'purpose', 'subject', 'notiz', 'note', 'bemerkung', 'text'],
  };
  function detectSemantic(name, example, masks) {
    const n = String(name).toLowerCase();
    // 'ort' only as a whole word / suffix (avoids matching "sort", "wort")
    if (/(^|[^a-z])ort($|[^a-z])/.test(n) || /\bort\b/.test(n)) return 'city';
    for (const sem of ['firstname', 'lastname', 'postal', 'street', 'city', 'country', 'email', 'phone', 'iban', 'company', 'reference', 'person']) {
      if (NAME_HINTS[sem].some((w) => n.includes(w))) return sem;
    }
    // value-based fallbacks
    const ex = String(example || '');
    if (/@/.test(ex)) return 'email';
    if (/^[A-Z]{2}\d{2}/.test(ex.replace(/\s/g, ''))) return 'iban';
    if (masks && masks.length) {                       // multi-word capitalised ⇒ a person name
      const share = masks.filter((x) => x.mask.split(/\s+/).filter((g) => g[0] === 'A').length >= 2)
        .reduce((s, x) => s + x.w, 0) / masks.reduce((s, x) => s + x.w, 0);
      if (share > 0.6) return 'person';
    }
    return null;
  }
  function fakerFor(sem, region) {
    const loc = DATA[region] || DATA.de;
    switch (sem) {
      case 'firstname': return () => pick(loc.firstM.concat(loc.firstF));
      case 'lastname': return () => pick(loc.last);
      case 'person': return () => pick(chance(0.5) ? loc.firstF : loc.firstM) + ' ' + pick(loc.last);
      case 'company': return () => pick(loc.companyWords) + ' ' + pick(loc.companyWords) + ' ' + pick(loc.companySuffix);
      case 'city': return () => pick(loc.cities)[1];
      case 'street': return () => pick(loc.streets) + ' ' + randInt(1, 199);
      case 'country': return () => loc.country;
      case 'reference': return () => pick(loc.reference) + ' ' + randInt(1000, 99999);
      default: return null;
    }
  }
  function usesFaker(m) { return m.semantic && FAKER_SEMANTICS.has(m.semantic) && !(m.categorical && m.useCategory); }
  function sanitizeIdent(s) {
    const base = String(s || 'import').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return (base || 'import').slice(0, 40);
  }
  function decimalsOf(type) { const m = /DECIMAL\s*\(\s*\d+\s*,\s*(\d+)\s*\)/i.exec(type); return m ? Number(m[1]) : 2; }
  const roundTo = (x, d) => { const f = Math.pow(10, d); return Math.round(x * f) / f; };

  const CAT_MAX = 25;          // ≤ this many distinct string values ⇒ categorical
  async function profileSource(desc) {
    const conn = D.conn();
    const totalSrc = desc.rows != null ? Number(desc.rows)
      : Number(D.rows(await conn.query(`SELECT count(*) AS n FROM ${desc.from}`))[0].n);
    // materialise a (sampled) copy for fast, stable stats
    const cap = 20000;
    const sample = totalSrc > cap ? ` USING SAMPLE ${cap} ROWS` : '';
    await conn.query(`CREATE OR REPLACE TABLE tdg_src AS SELECT * FROM ${desc.from}${sample}`);
    const total = Number(D.rows(await conn.query('SELECT count(*) AS n FROM tdg_src'))[0].n) || 1;

    const columns = [];
    for (const col of desc.columns) {
      const q = D.ident(col.name);
      let tc = col.typeClass, type = col.type;
      if (tc === 't-other') { tc = 't-string'; type = 'VARCHAR'; }   // complex → treat as text
      const b = D.rows(await conn.query(
        `SELECT count(*) AS tot, count(${q}) AS nn, approx_count_distinct(${q}) AS dc FROM tdg_src`))[0];
      const tot = Number(b.tot), nn = Number(b.nn), dc = Number(b.dc);
      const m = { name: col.name, type, typeClass: tc, nullRate: tot ? 1 - nn / tot : 0, distinct: dc, kind: 'text' };

      if (tc === 't-number') {
        // Cast to DOUBLE: min()/max() on a DECIMAL return an unscaled Arrow value
        // that Number() cannot read (→ NaN).
        const s = D.rows(await conn.query(
          `SELECT min(CAST(${q} AS DOUBLE)) mn, max(CAST(${q} AS DOUBLE)) mx, avg(CAST(${q} AS DOUBLE)) av, stddev_pop(CAST(${q} AS DOUBLE)) sd FROM tdg_src`))[0];
        m.min = Number(s.mn); m.max = Number(s.mx); m.mean = Number(s.av); m.std = Number(s.sd) || 0;
        m.isInt = /INT/i.test(type) && !/DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC/i.test(type);
        m.decimals = m.isInt ? 0 : decimalsOf(type);
        m.kind = m.isInt ? 'int' : 'money';
        // Generate DECIMAL sources as DOUBLE so values round-trip correctly.
        if (/DECIMAL|NUMERIC/i.test(type)) m.type = 'DOUBLE';
      } else if (tc === 't-date') {
        const s = D.rows(await conn.query(`SELECT min(${q}) mn, max(${q}) mx FROM tdg_src`))[0];
        m.minMs = s.mn instanceof Date ? s.mn.getTime() : Date.parse(s.mn) || (now.getTime() - 3650 * DAY);
        m.maxMs = s.mx instanceof Date ? s.mx.getTime() : Date.parse(s.mx) || now.getTime();
        if (m.maxMs < m.minMs) m.maxMs = m.minMs;
        m.kind = 'date';
      } else if (tc === 't-bool') {
        const s = D.rows(await conn.query(`SELECT avg(CASE WHEN ${q} THEN 1.0 ELSE 0.0 END) tr FROM tdg_src WHERE ${q} IS NOT NULL`))[0];
        m.trueRate = Number(s.tr) || 0; m.kind = 'category';
      } else { // t-string — always learn the value masks so a category can be
        // switched to synthetic (pattern-based) generation on demand.
        const mm = await buildMasks(conn, q, total);
        m.masks = mm.masks;
        if (dc > 0 && dc <= CAT_MAX) {
          const vs = D.rows(await conn.query(
            `SELECT ${q} AS v, count(*) AS c FROM tdg_src WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT ${CAT_MAX}`));
          m.categorical = true; m.useCategory = true; m.values = vs.map((r) => ({ v: String(r.v), w: Number(r.c) }));
          m.kind = 'category';
        } else {
          m.kind = /@/.test(mm.example) ? 'email' : 'text';
        }
        m.example = m.categorical && m.values.length ? m.values[0].v : mm.example;
        m.semantic = detectSemantic(col.name, m.example, m.masks);
      }
      columns.push(m);
    }
    // Infer a Faker locale from the data (IBAN / phone / country hints), default DE.
    let locale = 'de';
    for (const m of columns) {
      const ex = String(m.example || '');
      if (/\+44|United Kingdom|Great Britain|^GB\d/i.test(ex)) { locale = 'en'; break; }
      if (/\+49|Deutschland|^DE\d/i.test(ex)) { locale = 'de'; break; }
    }
    return { name: sanitizeIdent(desc.name), sourceName: desc.name, rows: totalSrc, columns, locale };
  }

  function genCell(m, region) {
    if (m.nullRate > 0 && chance(m.nullRate)) return null;
    if (m.typeClass === 't-number') {
      let v = (m.std > 0) ? gaussian(m.mean, m.std) : (m.min + rnd() * (m.max - m.min));
      v = Math.min(m.max, Math.max(m.min, v));
      return m.isInt ? Math.round(v) : roundTo(v, m.decimals != null ? m.decimals : 2);
    }
    if (m.typeClass === 't-date') return new Date(m.minMs + rnd() * (m.maxMs - m.minMs));
    if (m.typeClass === 't-bool') return chance(m.trueRate);
    // category kept as-is (unless switched off)
    if (m.categorical && m.useCategory && m.values.length) return weightedPick(m.values).v;
    // detected PII-ish text type → fully synthetic Faker value (no original chars)
    if (m.semantic && FAKER_SEMANTICS.has(m.semantic)) { const f = fakerFor(m.semantic, region); if (f) return f(); }
    // structured text (codes, phone, e-mail, IBAN, postal) → mask synthesis
    if (m.masks && m.masks.length) return fillTemplate(weightedPick(m.masks).template);
    if (m.categorical && m.values.length) return weightedPick(m.values).v;   // fallback if no masks
    return '';
  }
  function genFromTemplate(model, n) {
    const region = model.locale || 'de';
    const cols = model.columns.map((m) => ({ name: m.name, kind: m.kind, type: m.type, nullable: true }));
    const rows = new Array(n);
    for (let i = 0; i < n; i++) {
      const r = {};
      for (const m of model.columns) r[m.name] = genCell(m, region);
      rows[i] = r;
    }
    return { cols, rows };
  }

  // ------------------------------------------------------------ quality
  const KNOBS = ['nulls', 'duplicates', 'typos', 'formatChaos', 'outliers', 'whitespace'];
  const PRESETS = {
    clean:     { nulls: 0, duplicates: 0, typos: 0, formatChaos: 0, outliers: 0, whitespace: 0 },
    light:     { nulls: 0.10, duplicates: 0.02, typos: 0.05, formatChaos: 0.10, outliers: 0.02, whitespace: 0.10 },
    realistic: { nulls: 0.30, duplicates: 0.05, typos: 0.12, formatChaos: 0.35, outliers: 0.06, whitespace: 0.30 },
    messy:     { nulls: 0.60, duplicates: 0.12, typos: 0.30, formatChaos: 0.70, outliers: 0.15, whitespace: 0.60 },
  };

  function typoOf(s) {
    if (!s || s.length < 2) return s;
    const i = randInt(0, s.length - 1);
    const mode = randInt(0, 2);
    if (mode === 0) return s.slice(0, i) + s.slice(i + 1);                       // drop
    if (mode === 1) return s.slice(0, i) + s[i] + s[i] + s.slice(i + 1);         // double
    if (i < s.length - 1) return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2); // swap
    return s;
  }
  function wsCase(s) {
    let out = s;
    const m = randInt(0, 3);
    if (m === 0) out = ' ' + out;
    else if (m === 1) out = out + '  ';
    else if (m === 2) out = out.toUpperCase();
    else out = out.toLowerCase();
    return out;
  }
  // format variants (value already the canonical native)
  function dateVariant(d) {
    const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0'), yy = d.getFullYear();
    return pick([`${dd}.${mm}.${yy}`, `${mm}/${dd}/${yy}`, `${yy}/${mm}/${dd}`, `${d.getDate()}.${d.getMonth() + 1}.${yy}`, fmtISO(d)]);
  }
  function moneyVariant(x) {
    const s = Math.abs(x).toFixed(2);
    return pick([
      s,                                                    // 1234.56
      s.replace('.', ','),                                  // 1234,56
      Number(x).toLocaleString('de-DE', { minimumFractionDigits: 2 }), // 1.234,56
      s + ' €', '€ ' + s, x < 0 ? '(' + Math.abs(x).toFixed(2) + ')' : s,
    ]);
  }
  function phoneVariant(s) {
    return pick([s, s.replace(/\s/g, ''), s.replace(/^\+\d+\s/, '0'), s.replace(/\s/g, '-'), '(' + s + ')']);
  }

  /** Mutates cols (types) and rows (values); returns issue counts. */
  function dirtify(table, k, region) {
    const cols = table.cols, rows = table.rows;
    const issues = { nulls: 0, duplicates: 0, typos: 0, formatIssues: 0, outliers: 0, whitespace: 0 };
    const loc = DATA[region];

    // 1) Format chaos → the eligible column becomes VARCHAR text with mixed formats
    for (const col of cols) {
      if (k.formatChaos > 0 && CHAOS_KINDS[col.kind]) {
        col.type = 'VARCHAR';
        for (const r of rows) {
          const v = r[col.name];
          if (v == null) continue;
          if (!chance(k.formatChaos)) {           // canonical, but as string
            r[col.name] = (col.kind === 'date') ? fmtISO(v) : (col.kind === 'money') ? Math.abs(v).toFixed(2) : String(v);
          } else {
            r[col.name] = col.kind === 'date' ? dateVariant(v)
              : col.kind === 'money' ? moneyVariant(v)
              : col.kind === 'phone' ? phoneVariant(String(v))
              : pick(loc.countryVariants);
            issues.formatIssues++;
          }
        }
      } else {
        col.type = col.type || CLEAN_TYPE[col.kind];
      }
    }

    // 2) Outliers on still-numeric / still-date columns
    if (k.outliers > 0) {
      for (const col of cols) {
        // still numeric = a money/int column that formatChaos did NOT turn to text
        const numeric = col.type !== 'VARCHAR' && (col.kind === 'money' || col.kind === 'int');
        const isMoney = col.kind === 'money';
        for (const r of rows) {
          if (r[col.name] == null) continue;
          if (numeric && (isMoney || col.kind === 'int') && chance(k.outliers * 0.5)) {
            r[col.name] = chance(0.5) ? -Math.abs(r[col.name]) : round2(r[col.name] * randInt(50, 500));
            issues.outliers++;
          } else if (col.type === 'DATE' && chance(k.outliers * 0.3)) {
            r[col.name] = new Date(now.getTime() + randInt(400, 4000) * DAY); // impossible future
            issues.outliers++;
          }
        }
      }
    }

    // 3) Typos on names / free text / emails
    if (k.typos > 0) {
      for (const col of cols) {
        if (!(col.kind === 'name' || col.kind === 'text' || col.kind === 'email')) continue;
        for (const r of rows) {
          const v = r[col.name];
          if (typeof v === 'string' && v && chance(k.typos)) { r[col.name] = typoOf(v); issues.typos++; }
        }
      }
    }

    // 4) Whitespace / casing on string-ish columns
    if (k.whitespace > 0) {
      for (const col of cols) {
        if (!(col.kind === 'name' || col.kind === 'text' || col.kind === 'email' || col.kind === 'category')) continue;
        for (const r of rows) {
          const v = r[col.name];
          if (typeof v === 'string' && v && chance(k.whitespace)) { r[col.name] = wsCase(v); issues.whitespace++; }
        }
      }
    }

    // 5) NULLs on nullable columns (keys/ids protected)
    if (k.nulls > 0) {
      for (const col of cols) {
        if (!col.nullable) continue;
        const rate = k.nulls * (col.kind === 'fk' ? 0.4 : 0.5);
        for (const r of rows) {
          if (r[col.name] != null && chance(rate)) { r[col.name] = null; issues.nulls++; }
        }
      }
    }

    // 6) Duplicate whole rows (near-dupes: sometimes tweak a text field)
    if (k.duplicates > 0) {
      const extra = [];
      for (const r of rows) {
        if (chance(k.duplicates)) {
          const copy = Object.assign({}, r);
          extra.push(copy);
          issues.duplicates++;
        }
      }
      for (const e of extra) rows.push(e);
    }

    return issues;
  }

  // ------------------------------------------------------------ DuckDB load
  let dbReady = null;
  function ensureDb() {
    // Pass the empty final message through too, so the "Loading…" line clears.
    if (!dbReady) dbReady = D.init({ onStatus: (m) => status.set(m || '') });
    return dbReady;
  }

  const fmtTS = (d) => fmtISO(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':'
    + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
  const csvField = (col, v) => {
    if (v == null) return '\\N';
    let s;
    if (v instanceof Date) s = /TIMESTAMP/i.test(col.type) ? fmtTS(v) : fmtISO(v);
    else if (typeof v === 'number') s = String(v);
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else s = String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };

  async function loadTable(name, table) {
    const conn = D.conn(), db = D.db();
    const cols = table.cols, rows = table.rows;
    const header = cols.map((c) => c.name).join(',');
    const lines = new Array(rows.length + 1);
    lines[0] = header;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let line = '';
      for (let j = 0; j < cols.length; j++) { if (j) line += ','; line += csvField(cols[j], r[cols[j].name]); }
      lines[i + 1] = line;
    }
    const csv = lines.join('\n');
    const vname = 'gen_' + name + '.csv';
    await D.registerText(vname, csv);
    const colSpec = cols.map((c) => `'${c.name}': '${c.type}'`).join(', ');
    await conn.query(`CREATE OR REPLACE TABLE ${D.ident(name)} AS
      SELECT * FROM read_csv('${D.esc(vname)}', header=true, auto_detect=false, delim=',',
        quote='"', escape='"', nullstr='\\N', dateformat='%Y-%m-%d',
        timestampformat='%Y-%m-%d %H:%M:%S', columns={${colSpec}})`);
    try { await db.dropFile(vname); } catch (_) {}
  }

  // ------------------------------------------------------------ state / UI
  const state = { mode: 'domains', template: null, tables: [], current: null, format: 'parquet', quality: 'realistic', knobs: Object.assign({}, PRESETS.realistic) };
  const status = qrx.ui.status($('tdg-status'));
  const exportStatus = qrx.ui.status($('tdg-export-status'));
  const grid = qrx.ui.resultGrid($('tdg-grid'), { localeNumbers: false });

  const TABLE_ORDER = ['customers', 'products', 'employees', 'orders', 'order_items', 'transactions'];
  const DOMAIN_TABLES = { customers: ['customers'], orders: ['orders', 'order_items'], finance: ['transactions'], catalog: ['products', 'employees'] };

  function selectedDomains() {
    return Array.from(document.querySelectorAll('[data-domain]:checked')).map((el) => el.dataset.domain);
  }
  function plannedTables() {
    const chosen = selectedDomains();
    const set = new Set();
    chosen.forEach((d) => DOMAIN_TABLES[d].forEach((tbl) => set.add(tbl)));
    // dependency closure
    if (set.has('orders') || set.has('transactions')) set.add('customers');
    if (set.has('order_items')) { set.add('orders'); set.add('products'); }
    return { tables: TABLE_ORDER.filter((x) => set.has(x)), chosen };
  }

  function derivedCounts(base) {
    return {
      customers: base,
      products: Math.min(5000, Math.max(10, Math.round(base * 0.2))),
      employees: Math.min(2000, Math.max(5, Math.round(base * 0.05))),
      orders: Math.round(base * 2.5),
      transactions: Math.round(base * 2),
    };
  }

  function refreshHints() {
    const qLabel = state.quality === 'custom' ? t('q.custom') : t('q.' + state.quality);
    const qhint = { clean: 'qCleanHint', light: 'qLightHint', realistic: 'qRealisticHint', messy: 'qMessyHint', custom: 'qCustomHint' }[state.quality];
    $('tdg-quality-hint').textContent = t(qhint);

    // File mode: the summary describes the imported template instead of domains.
    if (state.mode === 'file') {
      const fr = Math.max(1, Math.min(1000000, Number($('tdg-file-rows').value) || 0));
      $('tdg-config-summary').textContent = state.template
        ? t('cfgFile', { quality: qLabel, rows: nf(fr), name: state.template.sourceName })
        : t('mode.file');
      return;
    }

    const base = Math.max(1, Math.min(200000, Number($('tdg-size').value) || 0));
    const cnt = derivedCounts(base);
    const plan = plannedTables();
    const parts = plan.tables.map((tbl) => {
      const n = tbl === 'order_items' ? '≈ ' + nf(Math.round(cnt.orders * 3)) : nf(cnt[tbl] != null ? cnt[tbl] : base);
      return `${t('tbl.' + tbl)} ${n}`;
    });
    $('tdg-size-hint').textContent = t('sizeHint', { list: parts.join(', ') });
    // dependency hint (tables added beyond the chosen domains)
    const chosenTables = new Set();
    plan.chosen.forEach((d) => DOMAIN_TABLES[d].forEach((x) => chosenTables.add(x)));
    const added = plan.tables.filter((x) => !chosenTables.has(x));
    const depEl = $('tdg-dep-hint');
    if (added.length) { depEl.hidden = false; depEl.textContent = t('depHint', { list: added.map((x) => t('tbl.' + x)).join(', ') }); }
    else depEl.hidden = true;
    // collapsed-panel summary line
    $('tdg-config-summary').textContent = t('configSummary', {
      quality: qLabel, rows: nf(base), region: ($('tdg-region').value || 'de').toUpperCase(),
    });
  }

  function updateResultsSummary() {
    const total = state.tables.reduce((s, x) => s + x.count, 0);
    $('tdg-results-summary').textContent = t('resultsSummary', { tables: state.tables.length, rows: nf(total) });
  }

  // sliders
  function renderSliders() {
    const box = $('tdg-sliders');
    box.innerHTML = KNOBS.map((key) => `
      <div class="tdg-slider" data-knob="${key}">
        <label for="knob-${key}">${qrx.core.escapeHtml(t('knob.' + key))}</label>
        <span class="tdg-slider-val" id="knobval-${key}">${Math.round(state.knobs[key] * 100)}%</span>
        <input type="range" id="knob-${key}" min="0" max="100" step="5" value="${Math.round(state.knobs[key] * 100)}">
        <small>${qrx.core.escapeHtml(t('knobd.' + key))}</small>
      </div>`).join('');
    KNOBS.forEach((key) => {
      $('knob-' + key).addEventListener('input', (e) => {
        state.knobs[key] = Number(e.target.value) / 100;
        $('knobval-' + key).textContent = e.target.value + '%';
        setPreset('custom', false);
      });
    });
  }
  function syncSliders() {
    KNOBS.forEach((key) => {
      const el = $('knob-' + key); if (!el) return;
      el.value = Math.round(state.knobs[key] * 100);
      $('knobval-' + key).textContent = el.value + '%';
    });
  }
  function setPreset(name, applyValues) {
    state.quality = name;
    document.querySelectorAll('.tdg-preset').forEach((b) => b.classList.toggle('is-active', b.dataset.preset === name));
    if (applyValues && PRESETS[name]) { state.knobs = Object.assign({}, PRESETS[name]); syncSliders(); }
    refreshHints();
  }

  // ------------------------------------------------------------ generate
  async function generate() {
    if (state.mode === 'file') return generateFromFile();
    const region = $('tdg-region').value;
    const loc = DATA[region];
    const base = Math.max(1, Math.min(200000, Math.round(Number($('tdg-size').value) || 1000)));
    $('tdg-size').value = base;
    rng = makeRng($('tdg-seed').value || 'qurix');
    const plan = plannedTables();
    if (!plan.tables.length) { status.set(t('genError', { msg: t('domains') }), 'error'); return; }
    const cnt = derivedCounts(base);
    const k = state.knobs;

    status.set(t('generating'));
    await new Promise((r) => setTimeout(r, 15));   // let the spinner paint

    try {
      // canonical generation (respecting FK dependencies)
      const raw = {};
      if (plan.tables.includes('products')) raw.products = genProducts(cnt.products, loc);
      if (plan.tables.includes('employees')) raw.employees = genEmployees(cnt.employees, loc);
      if (plan.tables.includes('customers')) raw.customers = genCustomers(cnt.customers, loc, region);
      const custIds = raw.customers ? raw.customers.rows.map((r) => r.id) : [];
      const empIds = raw.employees ? raw.employees.rows.map((r) => r.id) : [];
      if (plan.tables.includes('orders')) raw.orders = genOrders(cnt.orders, loc, custIds, empIds);
      if (plan.tables.includes('order_items') && raw.orders && raw.products)
        raw.order_items = genOrderItems(raw.orders.rows, raw.products);
      const orderIds = raw.orders ? raw.orders.rows.map((r) => r.id) : [];
      if (plan.tables.includes('transactions')) raw.transactions = genTransactions(cnt.transactions, loc, region, custIds, orderIds);

      // quality injection
      const tables = [];
      for (const name of TABLE_ORDER) {
        if (!raw[name]) continue;
        const issues = dirtify(raw[name], k, region);
        tables.push({ name, label: t('tbl.' + name), cols: raw[name].cols, rows: raw[name].rows, count: raw[name].rows.length, issues });
      }

      // load into DuckDB
      status.set(t('loading'));
      await ensureDb();
      for (const tbl of tables) await loadTable(tbl.name, tbl);

      state.tables = tables;
      state.current = tables[0].name;
      const totalRows = tables.reduce((s, x) => s + x.count, 0);
      renderResults();
      // Give the data room: collapse the config, open the results.
      $('tdg-config-panel').open = false;
      $('tdg-results').open = true;
      status.set(t('done', { tables: tables.length, rows: nf(totalRows) }), 'success');
      if (window.qrxTest) window.qrxTest.tick('generate');
    } catch (err) {
      console.error(err);
      status.set(t('genError', { msg: err && err.message ? err.message : String(err) }), 'error');
    }
  }

  async function generateFromFile() {
    if (!state.template) { status.set(t('needImport'), 'error'); return; }
    const n = Math.max(1, Math.min(1000000, Math.round(Number($('tdg-file-rows').value) || 1000)));
    $('tdg-file-rows').value = n;
    rng = makeRng($('tdg-seed').value || 'qurix');
    status.set(t('generating'));
    await new Promise((r) => setTimeout(r, 15));
    try {
      const gen = genFromTemplate(state.template, n);
      const issues = dirtify(gen, state.knobs, 'de');   // region only matters for the 'country' kind, absent here
      const tbl = { name: state.template.name, label: state.template.sourceName,
        cols: gen.cols, rows: gen.rows, count: gen.rows.length, issues };
      status.set(t('loading'));
      await ensureDb();
      await loadTable(tbl.name, tbl);
      state.tables = [tbl];
      state.current = tbl.name;
      renderResults();
      $('tdg-config-panel').open = false;
      $('tdg-results').open = true;
      status.set(t('done', { tables: 1, rows: nf(tbl.count) }), 'success');
      if (window.qrxTest) window.qrxTest.tick('generate');
    } catch (err) {
      console.error(err);
      status.set(t('genError', { msg: err && err.message ? err.message : String(err) }), 'error');
    }
  }

  // ------------------------------------------------------------ import UI
  const importStatus = qrx.ui.status($('tdg-import-status'));
  const picker = qrx.ui.sourcePicker($('tdg-drop'), {
    input: $('tdg-file-input'),
    status: importStatus,
    converterHref: 'table-format-converter.html',
    onSource: async (desc) => {
      try {
        importStatus.set(t('importing'));
        const model = await profileSource(desc);
        state.template = model;
        $('tdg-file-rows').value = Math.max(1, Math.min(1000000, model.rows || 1000));
        renderTemplate(model);
        // A freshly imported file should reproduce faithfully by default.
        setPreset('clean', true);
        importStatus.set(t('importDone', { cols: model.columns.length, rows: nf(model.rows) }), 'success');
        refreshHints();
      } catch (err) {
        console.error(err);
        importStatus.set(t('importError', { msg: err && err.message ? err.message : String(err) }), 'error');
      } finally {
        try { await qrx.source.release(desc); } catch (_) {}   // stats are captured; drop the source handle
      }
    },
  });

  function colMeta(m) {
    const bits = [];
    if (m.typeClass === 't-number') bits.push(t('tplRange', { min: nf(roundTo(m.min, 2)), max: nf(roundTo(m.max, 2)) }));
    else if (m.typeClass === 't-date') bits.push(t('tplRange', { min: fmtISO(new Date(m.minMs)), max: fmtISO(new Date(m.maxMs)) }));
    else if (m.typeClass === 't-bool') bits.push(t('tplBool', { p: Math.round(m.trueRate * 100) }));
    else if (m.categorical && m.useCategory) bits.push(t('tplCat', { n: m.distinct, vals: m.values.slice(0, 3).map((v) => v.v).join(', ') }));
    else if (usesFaker(m)) bits.push(t('tplFaker', { type: t('sem.' + m.semantic) }));
    else if (m.masks && m.masks.length) bits.push(t('tplPattern', { pats: m.masks.slice(0, 2).map((x) => x.mask).join(', ') }));
    if (m.nullRate > 0.001) bits.push(t('tplNull', { p: Math.round(m.nullRate * 100) }));
    return bits;
  }
  function renderTemplate(model) {
    $('tdg-template').hidden = false;
    $('tdg-template-head').textContent = t('templateHead', { name: model.sourceName, cols: model.columns.length, rows: nf(model.rows) });
    const esc = qrx.core.escapeHtml;
    const canToggle = (m) => m.categorical && m.masks && m.masks.length;   // only if a synthetic fallback exists
    $('tdg-template-cols').innerHTML = model.columns.map((m, i) =>
      `<div class="tdg-tcol">
        <div class="tdg-tcol-name" title="${esc(m.name)}">${esc(m.name)} <span class="tdg-tcol-type">${esc(m.type)}</span></div>
        <div class="tdg-tcol-meta" id="tcolmeta-${i}" title="${esc(colMeta(m).join(' · '))}">${colMeta(m).map((b) => esc(b)).join(' · ') || '&nbsp;'}</div>
        ${canToggle(m) ? `<label class="tdg-tcol-toggle" title="${esc(t('asCategoryHint'))}">
          <input type="checkbox" data-cat-idx="${i}"${m.useCategory ? ' checked' : ''}> ${esc(t('asCategory'))}</label>` : ''}
      </div>`).join('');
    $('tdg-template-cols').querySelectorAll('[data-cat-idx]').forEach((cb) => cb.addEventListener('change', () => {
      const i = Number(cb.dataset.catIdx);
      model.columns[i].useCategory = cb.checked;
      const meta = colMeta(model.columns[i]).join(' · ');
      const el = $('tcolmeta-' + i);
      if (el) { el.textContent = meta || ' '; el.title = meta; }
    }));
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.tdg-mode').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    $('tdg-mode-domains').hidden = mode !== 'domains';
    $('tdg-mode-file').hidden = mode !== 'file';
    if (mode === 'file') ensureDb();     // warm the engine so the first import is snappy
    refreshHints();
  }

  // ------------------------------------------------------------ results view
  function renderResults() {
    $('tdg-results').hidden = false;
    updateResultsSummary();
    const tabs = $('tdg-tabs');
    tabs.innerHTML = state.tables.map((tbl) =>
      `<button type="button" class="tdg-tab${tbl.name === state.current ? ' is-active' : ''}" data-table="${tbl.name}">`
      + `${qrx.core.escapeHtml(tbl.label)}<span class="tdg-tab-count">${nf(tbl.count)}</span></button>`).join('');
    tabs.querySelectorAll('.tdg-tab').forEach((b) => b.addEventListener('click', () => { state.current = b.dataset.table; showTable(); }));
    showTable();
  }

  async function showTable() {
    const tbl = state.tables.find((x) => x.name === state.current);
    if (!tbl) return;
    document.querySelectorAll('.tdg-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.table === state.current));
    $('tdg-preview-title').textContent = tbl.label + ' · ' + tbl.name;
    const shown = Math.min(50, tbl.count);
    $('tdg-preview-meta').textContent = t('previewMeta', { cols: tbl.cols.length, rows: nf(tbl.count), shown });
    // quality report chips
    const rep = $('tdg-report');
    const anyIssue = Object.values(tbl.issues).some((v) => v > 0);
    if (!anyIssue) {
      rep.innerHTML = `<span class="tdg-issue">${qrx.core.escapeHtml(t('issuesClean'))}</span>`;
    } else {
      rep.innerHTML = Object.keys(tbl.issues).filter((key) => tbl.issues[key] > 0).map((key) =>
        `<span class="tdg-issue">${t('issue.' + key, { n: '<b>' + nf(tbl.issues[key]) + '</b>' })}</span>`).join('');
    }
    // preview grid from DuckDB (canonical typed view)
    try {
      const res = await D.conn().query(`SELECT * FROM ${D.ident(tbl.name)} LIMIT 50`);
      grid.render(res);
    } catch (e) { $('tdg-grid').innerHTML = '<p class="tdg-hint" style="padding:10px">' + qrx.core.escapeHtml(String(e.message || e)) + '</p>'; }
  }

  // ------------------------------------------------------------ export
  const FORMATS = [
    { id: 'parquet', label: 'Parquet', ext: 'parquet', mime: 'application/octet-stream' },
    { id: 'csv', label: 'CSV', ext: 'csv', mime: 'text/csv' },
    { id: 'json', label: 'JSON', ext: 'json', mime: 'application/json' },
    { id: 'ndjson', label: 'NDJSON', ext: 'ndjson', mime: 'application/x-ndjson' },
    { id: 'xlsx', label: 'Excel (xlsx)', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { id: 'ods', label: 'ODS', ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet' },
    { id: 'markdown', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
    { id: 'html', label: 'HTML', ext: 'html', mime: 'text/html' },
  ];
  function renderFormats() {
    $('tdg-formats').innerHTML = FORMATS.map((f) =>
      `<button type="button" class="tdg-fmt${f.id === state.format ? ' is-active' : ''}" data-fmt="${f.id}">${f.label}</button>`).join('');
    $('tdg-formats').querySelectorAll('.tdg-fmt').forEach((b) => b.addEventListener('click', () => {
      state.format = b.dataset.fmt;
      document.querySelectorAll('.tdg-fmt').forEach((x) => x.classList.toggle('is-active', x === b));
    }));
  }

  // value for text-based serializers (JSON/MD/HTML): Dates → ISO, else native
  function exportVal(v) {
    if (v == null) return null;
    if (v instanceof Date) return fmtISO(v);
    return v;
  }
  function serializeJson(tbl) {
    const arr = tbl.rows.map((r) => { const o = {}; for (const c of tbl.cols) o[c.name] = exportVal(r[c.name]); return o; });
    return new TextEncoder().encode(JSON.stringify(arr, null, 2));
  }
  function serializeNdjson(tbl) {
    const lines = tbl.rows.map((r) => { const o = {}; for (const c of tbl.cols) o[c.name] = exportVal(r[c.name]); return JSON.stringify(o); });
    return new TextEncoder().encode(lines.join('\n'));
  }
  function serializeMarkdown(tbl) {
    const cell = (v) => { const x = exportVal(v); return x == null ? '' : String(x).replace(/\|/g, '\\|').replace(/\n/g, ' '); };
    const head = '| ' + tbl.cols.map((c) => c.name).join(' | ') + ' |';
    const sep = '| ' + tbl.cols.map(() => '---').join(' | ') + ' |';
    const body = tbl.rows.map((r) => '| ' + tbl.cols.map((c) => cell(r[c.name])).join(' | ') + ' |');
    return new TextEncoder().encode([head, sep, ...body].join('\n'));
  }
  function serializeHtml(tbl) {
    const esc = qrx.core.escapeHtml;
    const cell = (v) => { const x = exportVal(v); return x == null ? '' : esc(String(x)); };
    const p = ['<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + esc(tbl.name) + '</title>',
      '<style>table{border-collapse:collapse;font-family:sans-serif;font-size:14px}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f2f2f2}</style></head><body><table><thead><tr>',
      tbl.cols.map((c) => '<th>' + esc(c.name) + '</th>').join(''), '</tr></thead><tbody>'];
    for (const r of tbl.rows) p.push('<tr>' + tbl.cols.map((c) => '<td>' + cell(r[c.name]) + '</td>').join('') + '</tr>');
    p.push('</tbody></table></body></html>');
    return new TextEncoder().encode(p.join('\n'));
  }
  // Excel/ODS worksheet from a table
  function sheetFromTable(tbl) {
    const rows = tbl.rows.map((r) => { const o = {}; for (const cc of tbl.cols) { let v = r[cc.name]; if (v instanceof Date) v = v; o[cc.name] = v; } return o; });
    return XLSX.utils.json_to_sheet(rows, { cellDates: true });
  }

  async function copyFromDuck(tbl, fmt) {
    const conn = D.conn(), db = D.db();
    const out = 'exp_' + tbl.name + '.' + fmt.ext;
    const opts = fmt.id === 'parquet'
      ? `(FORMAT PARQUET, COMPRESSION 'zstd')`
      : `(FORMAT CSV, HEADER true)`;
    await conn.query(`COPY ${D.ident(tbl.name)} TO '${D.esc(out)}' ${opts}`);
    const buf = await db.copyFileToBuffer(out);
    try { await db.dropFile(out); } catch (_) {}
    return buf;
  }

  // returns { filename, data:Uint8Array }
  async function buildFile(tbl, fmt) {
    if (fmt.id === 'parquet' || fmt.id === 'csv') return { filename: tbl.name + '.' + fmt.ext, data: await copyFromDuck(tbl, fmt) };
    if (fmt.id === 'json') return { filename: tbl.name + '.json', data: serializeJson(tbl) };
    if (fmt.id === 'ndjson') return { filename: tbl.name + '.ndjson', data: serializeNdjson(tbl) };
    if (fmt.id === 'markdown') return { filename: tbl.name + '.md', data: serializeMarkdown(tbl) };
    if (fmt.id === 'html') return { filename: tbl.name + '.html', data: serializeHtml(tbl) };
    if (fmt.id === 'xlsx' || fmt.id === 'ods') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, sheetFromTable(tbl), tbl.name.slice(0, 31));
      const data = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: fmt.id }));
      return { filename: tbl.name + '.' + fmt.ext, data };
    }
    throw new Error('unknown format');
  }

  async function doExport() {
    const fmt = FORMATS.find((f) => f.id === state.format);
    if (!fmt) { exportStatus.set(t('pickFormat'), 'error'); return; }
    const scope = $('tdg-export-scope').value;
    const targets = scope === 'all' ? state.tables : state.tables.filter((x) => x.name === state.current);
    exportStatus.set(t('exporting'));
    try {
      let outName;
      if (scope === 'all' && (fmt.id === 'xlsx' || fmt.id === 'ods')) {
        // one workbook, one sheet per table
        const wb = XLSX.utils.book_new();
        for (const tbl of targets) XLSX.utils.book_append_sheet(wb, sheetFromTable(tbl), tbl.name.slice(0, 31));
        const data = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: fmt.id }));
        outName = 'testdata.' + fmt.ext;
        qrx.core.download(new Blob([data], { type: fmt.mime }), outName);
      } else if (scope === 'all') {
        // one file per table → ZIP
        const files = [];
        for (const tbl of targets) files.push(await buildFile(tbl, fmt));
        const zip = makeZip(files);
        outName = 'testdata_' + fmt.id + '.zip';
        qrx.core.download(new Blob([zip], { type: 'application/zip' }), outName);
      } else {
        const f = await buildFile(targets[0], fmt);
        outName = f.filename;
        qrx.core.download(new Blob([f.data], { type: fmt.mime }), outName);
      }
      exportStatus.set(t('exportDone', { name: outName }), 'success');
      if (window.qrxTest) window.qrxTest.tick('export');
    } catch (err) {
      console.error(err);
      exportStatus.set(t('exportError', { msg: err && err.message ? err.message : String(err) }), 'error');
    }
  }

  // ------------------------------------------------------------ minimal ZIP
  // Store-only (no compression) ZIP — enough to bundle already-compact files.
  const CRC_TABLE = (() => {
    const tbl = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); tbl[n] = c >>> 0; }
    return tbl;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const u16 = (n) => [n & 0xFF, (n >>> 8) & 0xFF];
    const u32 = (n) => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
    for (const f of files) {
      const nameBuf = enc.encode(f.filename);
      const data = f.data;
      const crc = crc32(data);
      const local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0));
      chunks.push(new Uint8Array(local), nameBuf, data);
      const localLen = local.length + nameBuf.length + data.length;
      const cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
      central.push(new Uint8Array(cen), nameBuf);
      offset += localLen;
    }
    const centralStart = offset;
    let centralLen = 0;
    for (const c of central) centralLen += c.length;
    const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(centralLen), u32(centralStart), u16(0)));
    const all = [...chunks, ...central, end];
    let total = 0; for (const a of all) total += a.length;
    const out = new Uint8Array(total);
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  // ------------------------------------------------------------ wire up
  document.querySelectorAll('[data-domain]').forEach((el) => el.addEventListener('change', refreshHints));
  $('tdg-size').addEventListener('input', refreshHints);
  $('tdg-region').addEventListener('change', refreshHints);
  $('tdg-presets').addEventListener('click', (e) => {
    const b = e.target.closest('.tdg-preset'); if (!b) return; setPreset(b.dataset.preset, true);
  });
  $('tdg-reroll').addEventListener('click', () => {
    $('tdg-seed').value = Math.random().toString(36).slice(2, 10);
  });
  $('tdg-generate').addEventListener('click', generate);
  $('tdg-export-btn').addEventListener('click', doExport);
  $('tdg-file-rows').addEventListener('input', refreshHints);
  $('tdg-modes').addEventListener('click', (e) => {
    const b = e.target.closest('.tdg-mode'); if (!b) return; setMode(b.dataset.mode);
  });
  // (click / drag-drop / keyboard on #tdg-drop are handled by qrx.ui.dropzone)
  qrx.i18n.onChange(() => {
    renderSliders(); refreshHints();
    if (state.mode === 'domains') state.tables.forEach((tbl) => { tbl.label = t('tbl.' + tbl.name); });
    if (state.template) renderTemplate(state.template);
    if (state.tables.length) renderResults();
  });

  renderSliders();
  renderFormats();
  refreshHints();

  // test hook
  window.__tdg = { state, generate, generateFromFile, doExport, plannedTables, derivedCounts, profileSource, picker };
})();
