// === App-Logik: Reisekosten ===
// Erfasst Reisen und rechnet Reisekosten nach deutschen Regeln automatisch ab:
// Verpflegungspauschalen (Inland & Ausland) mit An-/Abreise-Logik, Mahlzeiten-
// kürzungen, Kilometerpauschale und Übernachtung. Alles bleibt lokal im Browser
// (localStorage über qrx.core.storage). Die Auslands-Sätze kommen aus dem
// Datenmodul window.qrx.reisekostenRates und sind pro Reise überschreibbar.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = qrx.core.escapeHtml;
  const store = qrx.core.storage;
  const RATES = (qrx.reisekostenRates || { year: '—', source: '', countries: [] });

  // ---------------------------------------------------------------- Konstanten
  const KEY_TRIPS = 'reisekosten_trips';
  const KEY_SETTINGS = 'reisekosten_settings';

  // Gesetzliche Default-Beträge (Inland, Stand 2024–2026) — in den Einstellungen
  // überschreibbar, damit die App bei Änderungen ohne Code-Update stimmt.
  const DEFAULTS = {
    inlandFull: 28,    // voller Tag (24 h Abwesenheit)
    inlandOver8: 14,   // An-/Abreisetag bzw. eintägig > 8 h
    inlandNight: 20,   // Übernachtungspauschale Inland
    kmCar: 0.30,       // PKW €/km
    kmBike: 0.20,      // Motorrad €/km
    perspektive: 'beides',
  };
  // Mahlzeitenkürzung als Anteil des vollen Tagessatzes (§ 9 Abs. 4a EStG).
  const REDUCE = { f: 0.20, m: 0.40, a: 0.40 };
  // Ausland: An-/Abreise- bzw. >8h-Satz = 80 % des vollen Auslands-Tagegeldes.
  const ABROAD_PARTIAL = 0.80;

  // ---------------------------------------------------------------- State
  const state = {
    trips: [],
    settings: Object.assign({}, DEFAULTS),
    current: null,   // Arbeitskopie der gerade bearbeiteten Reise
    view: 'list',
  };

  // ---------------------------------------------------------------- i18n
  qrx.i18n.register('app', {
    de: {
      appTitle: 'Reisekosten', appSubtitle: 'Reisekosten nach deutschen Regeln — automatisch berechnet.',
      settings: 'Einstellungen', newTrip: '+ Neue Reise',
      emptyTitle: 'Noch keine Reisen', emptyText: 'Lege deine erste Reise an — Ziel, Zeitraum und Mahlzeiten genügen, den Rest rechnet die App.',
      grandTotal: 'Gesamt aller Reisen', exportAllCsv: 'Alle als CSV',
      inland: 'Deutschland (Inland)', abroadCustom: 'Anderes Land / eigene Sätze…',
      back: 'Zurück', save: 'Speichern', cancel: 'Abbrechen', deleteTrip: 'Reise löschen',
      confirmDelete: 'Diese Reise wirklich löschen?',
      secTrip: 'Reise', secTransport: 'Fahrtkosten', secDays: 'Tage & Verpflegung',
      secNight: 'Übernachtung', secExtras: 'Reisenebenkosten',
      fldReason: 'Anlass / Zweck', fldReasonPh: 'z. B. Kundentermin, Messe, Projekt',
      fldPlace: 'Ort', fldPlacePh: 'z. B. München, Paris',
      fldCountry: 'Reiseziel (Land)',
      fldDepart: 'Abreise', fldReturn: 'Rückkehr',
      fldFullRate: 'Voller Tagessatz (€)', fldNightRate: 'Übernachtungspauschale (€)',
      fldCustomName: 'Land / Stadt',
      rateHint: 'Auslands-Pauschbeträge {year} (überschreibbar). An-/Abreisetag = 80 % davon.',
      inlandHint: 'Inland: {full} € voller Tag · {over8} € An-/Abreise · {night} € Übernachtung (in Einstellungen änderbar).',
      transportMeans: 'Verkehrsmittel',
      mPkw: 'PKW (0,30 €/km)', mMotorrad: 'Motorrad (0,20 €/km)', mBahn: 'Bahn (Beleg)',
      mFlug: 'Flug (Beleg)', mOepnv: 'ÖPNV/Taxi (Beleg)', mSonstige: 'Sonstiges (Beleg)', mNone: 'Keine',
      fldKm: 'Kilometer', fldAmount: 'Betrag (€)',
      quickMeals: 'Schnell setzen:', qBreakfast: 'Frühstück alle', qLunch: 'Mittag alle', qDinner: 'Abend alle', qClear: 'Zurücksetzen',
      colBreakfast: 'F', colLunch: 'M', colDinner: 'A',
      breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen',
      typeSingle: 'Eintägig', typeArrival: 'Anreise', typeDeparture: 'Abreise', typeFull: 'Voller Tag', typeNone: '≤ 8 h — keine Pauschale',
      night: 'Übernachtung', nightMode: 'Abrechnung',
      nightPauschale: 'Pauschale je Nacht', nightBeleg: 'Tatsächliche Kosten (Beleg)', nightNone: 'Keine Übernachtung',
      nights: '{n} Nächte', nightsOne: '1 Nacht',
      extraName: 'Bezeichnung', extraNamePh: 'z. B. Parken, Maut, Gepäck', addExtra: '+ Position',
      sumVerpflegung: 'Verpflegung', sumFahrt: 'Fahrt', sumUebernachtung: 'Übernachtung', sumNeben: 'Nebenkosten', sumTotal: 'Summe',
      print: 'Drucken / PDF', csv: 'CSV', report: 'Abrechnung',
      reportTitle: 'Reisekostenabrechnung', reportPeriod: 'Zeitraum', reportPlace: 'Ziel', reportReason: 'Anlass',
      reportDays: 'Abwesenheit', reportDaysVal: '{days} Tage · {hours} Std.',
      thDate: 'Datum', thType: 'Art', thMeals: 'Mahlzeiten', thPerDiem: 'Verpflegung',
      reportName: 'Name', reportDate: 'Datum', reportSignEmp: 'Unterschrift Reisende/r', reportSignApprove: 'Unterschrift / Freigabe',
      untitled: 'Ohne Ziel', invalidDates: 'Bitte Abreise und Rückkehr angeben (Rückkehr nach Abreise).',
      setTitle: 'Einstellungen', setRates: 'Inland-Pauschalen & Kilometersätze', setPerspektive: 'Perspektive',
      pBeides: 'Neutral (beides)', pArbeitnehmer: 'Arbeitnehmer → Arbeitgeber', pSelbst: 'Selbstständig / Steuererklärung',
      setReset: 'Auf gesetzliche Standardwerte zurücksetzen',
      disclaimer: 'Hinweis: Alle Beträge sind Richtwerte ohne Gewähr. Verpflegungs- und Übernachtungspauschalen sind Jahreswerte (BMF); bitte gegen das aktuelle BMF-Schreiben prüfen. Für dieselbe auswärtige Tätigkeitsstätte gilt die Verpflegungspauschale nur für die ersten drei Monate.',
      secReceipts: 'Belege', importReceipt: '＋ Beleg importieren (PDF/Foto)',
      receiptHint: 'PDF, Foto oder Scan — Beträge und Daten werden automatisch erkannt und gegengeprüft. Erste Erkennung lädt einmalig die Lese-Bibliothek (Internet nötig); der Beleg bleibt lokal im Browser.',
      receiptsEmpty: 'Noch keine Belege importiert.',
      readingPdf: 'PDF wird gelesen …', readingOcr: 'Text wird erkannt (OCR) … {pct}%', analysing: 'Beleg wird ausgewertet …',
      importFailed: 'Beleg konnte nicht gelesen werden: {msg}',
      libFailed: 'Die Lese-Bibliothek konnte nicht geladen werden (Internet nötig beim ersten Mal).',
      crossTitle: 'Beleg geprüft', crossSub: 'Erkannt in: {name}',
      crossField: 'Feld', crossCurrent: 'Aktuell', crossDetected: 'Erkannt', crossApply: 'Übernehmen',
      stMatch: 'stimmt überein', stFill: 'wird gefüllt', stMismatch: 'weicht ab',
      applySel: 'Ausgewählte übernehmen', dismiss: 'Verwerfen',
      bcHotelCost: 'Übernachtung (Beleg)', bcPeriod: 'Zeitraum', bcBreakfast: 'Frühstück',
      bcAllNights: 'an allen Übernachtungstagen', bcTravelCost: 'Fahrtkosten', bcTravelDate: 'Reisedatum', bcExtraCost: 'Nebenkosten',
      no: 'nein', detectedNothing: 'Keine übernehmbaren Werte erkannt. Der Beleg wurde nur zur Dokumentation gespeichert.',
      typeHotel: 'Hotel', typeBahn: 'Bahn', typeOepnv: 'ÖPNV', typeUnknown: 'Beleg',
      reportReceipts: 'Belege', route: 'Strecke',
    },
    en: {
      appTitle: 'Travel Expenses', appSubtitle: 'German travel-expense rules — calculated automatically.',
      settings: 'Settings', newTrip: '+ New trip',
      emptyTitle: 'No trips yet', emptyText: 'Add your first trip — destination, dates and meals are enough, the app does the rest.',
      grandTotal: 'Total of all trips', exportAllCsv: 'All as CSV',
      inland: 'Germany (domestic)', abroadCustom: 'Other country / custom rates…',
      back: 'Back', save: 'Save', cancel: 'Cancel', deleteTrip: 'Delete trip',
      confirmDelete: 'Really delete this trip?',
      secTrip: 'Trip', secTransport: 'Travel', secDays: 'Days & meals',
      secNight: 'Accommodation', secExtras: 'Incidental costs',
      fldReason: 'Purpose', fldReasonPh: 'e.g. client meeting, trade fair, project',
      fldPlace: 'Place', fldPlacePh: 'e.g. Munich, Paris',
      fldCountry: 'Destination (country)',
      fldDepart: 'Departure', fldReturn: 'Return',
      fldFullRate: 'Full daily rate (€)', fldNightRate: 'Accommodation flat rate (€)',
      fldCustomName: 'Country / city',
      rateHint: 'Foreign per-diem {year} (editable). Arrival/departure day = 80 % of it.',
      inlandHint: 'Domestic: €{full} full day · €{over8} arrival/departure · €{night} accommodation (change in settings).',
      transportMeans: 'Means of transport',
      mPkw: 'Car (€0.30/km)', mMotorrad: 'Motorcycle (€0.20/km)', mBahn: 'Train (receipt)',
      mFlug: 'Flight (receipt)', mOepnv: 'Public transport/taxi (receipt)', mSonstige: 'Other (receipt)', mNone: 'None',
      fldKm: 'Kilometres', fldAmount: 'Amount (€)',
      quickMeals: 'Quick set:', qBreakfast: 'Breakfast all', qLunch: 'Lunch all', qDinner: 'Dinner all', qClear: 'Reset',
      colBreakfast: 'B', colLunch: 'L', colDinner: 'D',
      breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner',
      typeSingle: 'Single day', typeArrival: 'Arrival', typeDeparture: 'Departure', typeFull: 'Full day', typeNone: '≤ 8 h — no allowance',
      night: 'Overnight', nightMode: 'Billing',
      nightPauschale: 'Flat rate per night', nightBeleg: 'Actual cost (receipt)', nightNone: 'No overnight',
      nights: '{n} nights', nightsOne: '1 night',
      extraName: 'Description', extraNamePh: 'e.g. parking, toll, luggage', addExtra: '+ Item',
      sumVerpflegung: 'Meals', sumFahrt: 'Travel', sumUebernachtung: 'Accommodation', sumNeben: 'Incidentals', sumTotal: 'Total',
      print: 'Print / PDF', csv: 'CSV', report: 'Settlement',
      reportTitle: 'Travel expense settlement', reportPeriod: 'Period', reportPlace: 'Destination', reportReason: 'Purpose',
      reportDays: 'Absence', reportDaysVal: '{days} days · {hours} hrs',
      thDate: 'Date', thType: 'Type', thMeals: 'Meals', thPerDiem: 'Meals',
      reportName: 'Name', reportDate: 'Date', reportSignEmp: 'Signature traveller', reportSignApprove: 'Signature / approval',
      untitled: 'No destination', invalidDates: 'Please enter departure and return (return after departure).',
      setTitle: 'Settings', setRates: 'Domestic allowances & mileage rates', setPerspektive: 'Perspective',
      pBeides: 'Neutral (both)', pArbeitnehmer: 'Employee → employer', pSelbst: 'Self-employed / tax return',
      setReset: 'Reset to statutory defaults',
      disclaimer: 'Note: all amounts are guideline values without warranty. Meal and accommodation flat rates are annual (BMF); please verify against the current BMF publication. For the same external workplace the meal allowance applies only for the first three months.',
      secReceipts: 'Receipts', importReceipt: '＋ Import receipt (PDF/photo)',
      receiptHint: 'PDF, photo or scan — amounts and dates are detected automatically and cross-checked. The first detection loads the reader library once (internet needed); the receipt stays local in your browser.',
      receiptsEmpty: 'No receipts imported yet.',
      readingPdf: 'Reading PDF …', readingOcr: 'Recognising text (OCR) … {pct}%', analysing: 'Analysing receipt …',
      importFailed: 'Could not read the receipt: {msg}',
      libFailed: 'The reader library could not be loaded (internet needed the first time).',
      crossTitle: 'Receipt checked', crossSub: 'Detected in: {name}',
      crossField: 'Field', crossCurrent: 'Current', crossDetected: 'Detected', crossApply: 'Apply',
      stMatch: 'matches', stFill: 'will fill', stMismatch: 'differs',
      applySel: 'Apply selected', dismiss: 'Discard',
      bcHotelCost: 'Accommodation (receipt)', bcPeriod: 'Period', bcBreakfast: 'Breakfast',
      bcAllNights: 'on all overnight days', bcTravelCost: 'Travel cost', bcTravelDate: 'Travel date', bcExtraCost: 'Incidental cost',
      no: 'no', detectedNothing: 'No applicable values detected. The receipt was saved for documentation only.',
      typeHotel: 'Hotel', typeBahn: 'Train', typeOepnv: 'Transit', typeUnknown: 'Receipt',
      reportReceipts: 'Receipts', route: 'Route',
    },
  });
  const t = (k, p) => qrx.i18n.t('app.' + k, p);
  const locale = () => qrx.i18n.locale();
  const eur = (n) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(n || 0);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };

  // ---------------------------------------------------------------- Persistenz
  function load() {
    state.settings = Object.assign({}, DEFAULTS, store.getJSON(KEY_SETTINGS, {}));
    const trips = store.getJSON(KEY_TRIPS, []);
    state.trips = Array.isArray(trips) ? trips.map(normalizeTrip) : [];
  }
  function saveTrips() { store.setJSON(KEY_TRIPS, state.trips); }
  function saveSettings() { store.setJSON(KEY_SETTINGS, state.settings); }

  function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function normalizeTrip(tp) {
    return Object.assign({
      id: newId(), ort: '', country: 'DE', abName: '', abFull: 0, abNight: 0,
      abreise: '', rueckkehr: '', reason: '', notiz: '',
      verkehr: { mittel: 'pkw', km: 0, betrag: 0 },
      uebernachtung: { mode: 'pauschale', betrag: 0 },
      meals: {}, nights: {}, extras: [], belege: [],
    }, tp, {
      verkehr: Object.assign({ mittel: 'pkw', km: 0, betrag: 0 }, tp.verkehr),
      uebernachtung: Object.assign({ mode: 'pauschale', betrag: 0 }, tp.uebernachtung),
      meals: tp.meals || {}, nights: tp.nights || {}, extras: tp.extras || [], belege: tp.belege || [],
    });
  }
  function blankTrip() {
    return normalizeTrip({ id: newId(), country: 'DE' });
  }

  // ---------------------------------------------------------------- Datumslogik
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toDateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseDay(str) { return str ? new Date(str.slice(0, 10) + 'T12:00:00') : null; }

  // Liste der Kalendertage zwischen Abreise und Rückkehr mit Tagestyp.
  function tripDays(trip) {
    const a = trip.abreise ? new Date(trip.abreise) : null;
    const r = trip.rueckkehr ? new Date(trip.rueckkehr) : null;
    if (!a || !r || isNaN(a) || isNaN(r) || r <= a) return [];
    const start = parseDay(trip.abreise), end = parseDay(trip.rueckkehr);
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(toDateStr(new Date(d)));
    }
    const single = days.length === 1;
    const hours = (r - a) / 3600000;
    return days.map((date, i) => {
      let type;
      if (single) type = hours > 8 ? 'single' : 'none';
      else if (i === 0) type = 'arrival';
      else if (i === days.length - 1) type = 'departure';
      else type = 'full';
      return { date, type };
    });
  }

  function isInland(trip) { return trip.country === 'DE'; }
  function fullDayRate(trip) { return isInland(trip) ? num(state.settings.inlandFull) : num(trip.abFull); }
  function over8Rate(trip) {
    return isInland(trip) ? num(state.settings.inlandOver8) : round2(num(trip.abFull) * ABROAD_PARTIAL);
  }
  function nightRate(trip) { return isInland(trip) ? num(state.settings.inlandNight) : num(trip.abNight); }

  // Vollständige Berechnung einer Reise.
  function compute(trip) {
    const days = tripDays(trip);
    const full = fullDayRate(trip), over8 = over8Rate(trip);
    let verpflegung = 0, nightsCount = 0;
    const rows = days.map((d) => {
      const meals = trip.meals[d.date] || {};
      let base = 0;
      if (d.type === 'full') base = full;
      else if (d.type === 'arrival' || d.type === 'departure' || d.type === 'single') base = over8;
      // Kürzung stets vom vollen Tagessatz, gedeckelt bei 0.
      const reduction = full * ((meals.f ? REDUCE.f : 0) + (meals.m ? REDUCE.m : 0) + (meals.a ? REDUCE.a : 0));
      const amount = Math.max(0, round2(base - reduction));
      const nightDefault = d.type === 'arrival' || d.type === 'full';
      const hasNight = (d.date in trip.nights) ? !!trip.nights[d.date] : nightDefault;
      if (hasNight) nightsCount++;
      return { date: d.date, type: d.type, base, reduction: round2(reduction), amount, meals, hasNight };
    });
    verpflegung = round2(rows.reduce((s, r) => s + r.amount, 0));

    // Fahrtkosten
    const v = trip.verkehr || {};
    let fahrt = 0;
    if (v.mittel === 'pkw') fahrt = num(v.km) * num(state.settings.kmCar);
    else if (v.mittel === 'motorrad') fahrt = num(v.km) * num(state.settings.kmBike);
    else if (['bahn', 'flug', 'oepnv', 'sonstige'].includes(v.mittel)) fahrt = num(v.betrag);
    fahrt = round2(fahrt);

    // Übernachtung
    const u = trip.uebernachtung || {};
    let uebernachtung = 0;
    if (u.mode === 'pauschale') uebernachtung = round2(nightsCount * nightRate(trip));
    else if (u.mode === 'beleg') uebernachtung = round2(num(u.betrag));

    // Nebenkosten
    const neben = round2((trip.extras || []).reduce((s, e) => s + num(e.betrag), 0));

    const total = round2(verpflegung + fahrt + uebernachtung + neben);
    const hours = (trip.abreise && trip.rueckkehr) ? (new Date(trip.rueckkehr) - new Date(trip.abreise)) / 3600000 : 0;
    return { rows, days, verpflegung, fahrt, uebernachtung, neben, total, nightsCount, hours: Math.max(0, hours), dayCount: days.length };
  }

  // ---------------------------------------------------------------- Views
  const views = {
    list: $('rk-view-list'), edit: $('rk-view-edit'),
    settings: $('rk-view-settings'), report: $('rk-view-report'),
  };
  function showView(name) {
    state.view = name;
    Object.keys(views).forEach((k) => { views[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  // -------- Länder-Optionen --------
  function countryOptions(selected) {
    let html = '<option value="DE"' + (selected === 'DE' ? ' selected' : '') + '>' + esc(t('inland')) + '</option>';
    RATES.countries.forEach((c) => {
      const label = qrx.i18n.lang() === 'en' ? (c.name_en || c.name) : c.name;
      html += '<option value="' + esc(c.code) + '"' + (selected === c.code ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    html += '<option value="CUSTOM"' + (selected === 'CUSTOM' ? ' selected' : '') + '>' + esc(t('abroadCustom')) + '</option>';
    return html;
  }
  function rateOf(code) { return RATES.countries.find((c) => c.code === code) || null; }

  // ============================================================ LISTE
  function renderList() {
    const el = views.list;
    if (!state.trips.length) {
      el.innerHTML =
        '<div class="rk-empty"><h2>' + esc(t('emptyTitle')) + '</h2><p>' + esc(t('emptyText')) + '</p>' +
        '<p><button class="qrx-btn qrx-btn-primary" data-action="new">' + esc(t('newTrip')) + '</button></p></div>';
      return;
    }
    // nach Monat gruppieren (Abreise), neueste zuerst
    const groups = {};
    state.trips.forEach((tp) => {
      const key = (tp.abreise || '0000-00').slice(0, 7);
      (groups[key] = groups[key] || []).push(tp);
    });
    const keys = Object.keys(groups).sort().reverse();
    let grand = 0;
    state.trips.forEach((tp) => { grand += compute(tp).total; });

    let html =
      '<div class="rk-summary rk-noprint" style="position:static;margin-bottom:var(--qrx-s-6)">' +
      '<div class="rk-sum-item rk-sum-total"><span class="rk-sum-label">' + esc(t('grandTotal')) + '</span>' +
      '<span class="rk-sum-value">' + esc(eur(grand)) + '</span></div>' +
      '<div class="rk-summary-actions" style="width:auto;margin-left:auto">' +
      '<button class="qrx-btn" data-action="csv-all">' + esc(t('exportAllCsv')) + '</button></div></div>';

    keys.forEach((key) => {
      const monthTrips = groups[key];
      const sum = monthTrips.reduce((s, tp) => s + compute(tp).total, 0);
      const title = key === '0000-00' ? '—' :
        new Date(key + '-01T12:00:00').toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
      html += '<div class="rk-month-group"><div class="rk-month-head">' +
        '<span class="rk-month-title">' + esc(title) + '</span>' +
        '<span class="rk-month-sum">' + esc(eur(sum)) + '</span></div>' +
        '<div class="rk-trip-list">';
      monthTrips.forEach((tp) => {
        const c = compute(tp);
        const inland = isInland(tp);
        const dest = tp.ort || destName(tp) || t('untitled');
        const range = tp.abreise && tp.rueckkehr
          ? fmtDate(tp.abreise) + ' – ' + fmtDate(tp.rueckkehr)
          : t('invalidDates');
        html += '<article class="rk-trip-card" data-action="edit" data-id="' + esc(tp.id) + '">' +
          '<div class="rk-trip-card-head"><span class="rk-trip-dest">' + esc(dest) + '</span>' +
          '<span class="rk-trip-flag' + (inland ? '' : ' rk-abroad') + '">' + esc(inland ? 'Inland' : (destName(tp) || 'Ausland')) + '</span></div>' +
          '<div class="rk-trip-dates">' + esc(range) + '</div>' +
          '<div class="rk-trip-foot"><span class="rk-trip-total">' + esc(eur(c.total)) + '</span></div>' +
          '</article>';
      });
      html += '</div></div>';
    });
    el.innerHTML = html;
  }
  function destName(tp) {
    if (tp.country === 'DE') return '';
    if (tp.country === 'CUSTOM') return tp.abName || '';
    const r = rateOf(tp.country);
    return r ? (qrx.i18n.lang() === 'en' ? (r.name_en || r.name) : r.name) : '';
  }
  function fmtDate(dtStr) {
    if (!dtStr) return '';
    return new Date(dtStr.slice(0, 10) + 'T12:00:00').toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // ============================================================ FORMULAR
  function renderEdit() {
    const tp = state.current;
    const el = views.edit;
    el.innerHTML =
      '<div class="rk-form">' +
        '<div class="rk-form-head">' +
          '<button class="rk-back" data-action="back">← ' + esc(t('back')) + '</button>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secTrip')) + '</h2>' +
          '<div class="rk-grid">' +
            field(t('fldReason'), '<input class="qrx-input" data-field="reason" value="' + esc(tp.reason) + '" placeholder="' + esc(t('fldReasonPh')) + '">', 'rk-span-2') +
            field(t('fldCountry'), '<select class="qrx-select" data-field="country">' + countryOptions(tp.country) + '</select>') +
            field(t('fldPlace'), '<input class="qrx-input" data-field="ort" value="' + esc(tp.ort) + '" placeholder="' + esc(t('fldPlacePh')) + '">') +
          '</div>' +
          '<div id="rk-rate-fields"></div>' +
          '<div class="rk-grid" style="margin-top:var(--qrx-s-4)">' +
            field(t('fldDepart'), '<input class="qrx-input" type="datetime-local" data-field="abreise" value="' + esc(tp.abreise) + '">') +
            field(t('fldReturn'), '<input class="qrx-input" type="datetime-local" data-field="rueckkehr" value="' + esc(tp.rueckkehr) + '">') +
          '</div>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secTransport')) + '</h2>' +
          '<div class="rk-grid">' +
            field(t('transportMeans'),
              '<select class="qrx-select" data-field="verkehrMittel">' + transportOptions(tp.verkehr.mittel) + '</select>') +
            '<div id="rk-verkehr-fields" class="rk-field"></div>' +
          '</div>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secDays')) + '</h2>' +
          '<div id="rk-days"></div>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secNight')) + '</h2>' +
          '<div class="rk-grid">' +
            field(t('nightMode'), '<select class="qrx-select" data-field="nightMode">' + nightOptions(tp.uebernachtung.mode) + '</select>') +
            '<div id="rk-night-fields" class="rk-field"></div>' +
          '</div>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secExtras')) + '</h2>' +
          '<div id="rk-extras"></div>' +
          '<button class="qrx-btn qrx-btn-sm" data-action="add-extra">' + esc(t('addExtra')) + '</button>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secReceipts')) + '</h2>' +
          '<div id="rk-belege"></div>' +
          '<label class="qrx-btn qrx-btn-sm rk-file-btn">' + esc(t('importReceipt')) +
            '<input id="rk-file" type="file" accept="application/pdf,image/*" hidden></label>' +
          '<p class="rk-hint">' + esc(t('receiptHint')) + '</p>' +
        '</div>' +

        '<div id="rk-summary"></div>' +
      '</div>';

    renderRateFields();
    renderVerkehrFields();
    renderNightFields();
    renderExtras();
    renderBelege();
    rebuildDays();
    refreshCalc();
  }

  function field(label, control, extraClass) {
    return '<label class="rk-field ' + (extraClass || '') + '"><span class="qrx-label">' + esc(label) + '</span>' + control + '</label>';
  }
  function transportOptions(sel) {
    const opts = [['pkw', 'mPkw'], ['motorrad', 'mMotorrad'], ['bahn', 'mBahn'], ['flug', 'mFlug'], ['oepnv', 'mOepnv'], ['sonstige', 'mSonstige'], ['none', 'mNone']];
    return opts.map(([v, k]) => '<option value="' + v + '"' + (sel === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('');
  }
  function nightOptions(sel) {
    const opts = [['pauschale', 'nightPauschale'], ['beleg', 'nightBeleg'], ['none', 'nightNone']];
    return opts.map(([v, k]) => '<option value="' + v + '"' + (sel === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('');
  }

  function renderRateFields() {
    const tp = state.current;
    const box = $('rk-rate-fields');
    if (!box) return;
    if (isInland(tp)) {
      box.innerHTML = '<p class="rk-hint">' + esc(t('inlandHint', {
        full: state.settings.inlandFull, over8: state.settings.inlandOver8, night: state.settings.inlandNight,
      })) + '</p>';
      return;
    }
    const customName = tp.country === 'CUSTOM'
      ? field(t('fldCustomName'), '<input class="qrx-input" data-field="abName" value="' + esc(tp.abName) + '" placeholder="' + esc(t('fldCustomName')) + '">')
      : '';
    box.innerHTML =
      '<div class="rk-grid" style="margin-top:var(--qrx-s-4)">' + customName +
        field(t('fldFullRate'), '<input class="qrx-input" type="number" min="0" step="0.01" inputmode="decimal" data-field="abFull" value="' + esc(tp.abFull) + '">') +
        field(t('fldNightRate'), '<input class="qrx-input" type="number" min="0" step="0.01" inputmode="decimal" data-field="abNight" value="' + esc(tp.abNight) + '">') +
      '</div>' +
      '<p class="rk-hint">' + esc(t('rateHint', { year: RATES.year })) + '</p>';
  }

  function renderVerkehrFields() {
    const tp = state.current;
    const box = $('rk-verkehr-fields');
    if (!box) return;
    const m = tp.verkehr.mittel;
    if (m === 'pkw' || m === 'motorrad') {
      box.innerHTML = '<span class="qrx-label">' + esc(t('fldKm')) + '</span>' +
        '<input class="qrx-input" type="number" min="0" step="1" inputmode="numeric" data-field="km" value="' + esc(tp.verkehr.km) + '">';
    } else if (m === 'none') {
      box.innerHTML = '';
    } else {
      box.innerHTML = '<span class="qrx-label">' + esc(t('fldAmount')) + '</span>' +
        '<input class="qrx-input" type="number" min="0" step="0.01" inputmode="decimal" data-field="verkehrBetrag" value="' + esc(tp.verkehr.betrag) + '">';
    }
  }

  function renderNightFields() {
    const tp = state.current;
    const box = $('rk-night-fields');
    if (!box) return;
    if (tp.uebernachtung.mode === 'beleg') {
      box.innerHTML = '<span class="qrx-label">' + esc(t('fldAmount')) + '</span>' +
        '<input class="qrx-input" type="number" min="0" step="0.01" inputmode="decimal" data-field="nightBetrag" value="' + esc(tp.uebernachtung.betrag) + '">';
    } else {
      box.innerHTML = '';
    }
  }

  function renderExtras() {
    const tp = state.current;
    const box = $('rk-extras');
    if (!box) return;
    box.innerHTML = (tp.extras || []).map((e, i) =>
      '<div class="rk-extra-row">' +
        '<input class="qrx-input rk-extra-name" data-field="extraName" data-idx="' + i + '" value="' + esc(e.bez || '') + '" placeholder="' + esc(t('extraNamePh')) + '">' +
        '<input class="qrx-input rk-extra-amount" type="number" min="0" step="0.01" inputmode="decimal" data-field="extraBetrag" data-idx="' + i + '" value="' + esc(e.betrag || '') + '">' +
        '<button class="rk-icon-btn" data-action="del-extra" data-idx="' + i + '" aria-label="' + esc(t('deleteTrip')) + '">✕</button>' +
      '</div>').join('');
  }

  // ---------------------------------------------------------------- Belege
  const RECEIPT_ICON = {
    hotel: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01',
    bahn: 'M4 11h16M6 3h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 20l-2 2M16 20l2 2M8 16h.01M16 16h.01',
    oepnv: 'M4 11h16M6 3h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 20l-2 2M16 20l2 2M8 16h.01M16 16h.01',
    unknown: 'M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14 4v5h5',
  };
  function typeLabelOf(ty) { return t('type' + ty.charAt(0).toUpperCase() + ty.slice(1)) || t('typeUnknown'); }

  function renderBelege() {
    const box = $('rk-belege');
    if (!box) return;
    const list = state.current.belege || [];
    if (!list.length) { box.innerHTML = '<p class="rk-hint">' + esc(t('receiptsEmpty')) + '</p>'; return; }
    box.innerHTML = list.map((b, i) =>
      '<div class="rk-beleg-row">' +
        '<svg class="rk-beleg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (RECEIPT_ICON[b.type] || RECEIPT_ICON.unknown) + '"/></svg>' +
        '<div class="rk-beleg-main"><span class="rk-beleg-name">' + esc(b.name || t('typeUnknown')) + '</span>' +
          '<span class="rk-beleg-meta">' + esc(typeLabelOf(b.type || 'unknown')) + (b.total != null ? ' · ' + esc(eur(b.total)) : '') + '</span></div>' +
        '<button class="rk-icon-btn" data-action="del-beleg" data-idx="' + i + '" aria-label="✕">✕</button>' +
      '</div>').join('');
  }

  // Datei importieren: Text gewinnen (PDF/OCR) → parsen → Gegenprüf-Panel.
  async function importReceipt(file) {
    if (!file) return;
    if (!qrx.rkReceipts) { alert(t('libFailed')); return; }
    const prog = showProgress(t('analysing'));
    try {
      prog.set(t('readingPdf'), null);
      const { text, method } = await qrx.rkReceipts.extractText(file, (p) => {
        prog.set(t('readingOcr', { pct: Math.round((p || 0) * 100) }), p);
      });
      prog.set(t('analysing'), null);
      const parsed = qrx.rkReceipts.parseReceipt(text);
      prog.close();
      showCrossCheck(parsed, file.name, method);
    } catch (e) {
      prog.close();
      console.warn('receipt import failed', e);
      alert(t('importFailed', { msg: (e && e.message) || String(e) }));
    }
  }

  // Fortschritts-Overlay.
  function showProgress(label) {
    const ov = document.createElement('div');
    ov.className = 'rk-modal-overlay';
    ov.innerHTML = '<div class="rk-modal rk-modal-progress"><div class="rk-spinner" aria-hidden="true"></div>' +
      '<p class="rk-progress-label"></p><div class="rk-progress-bar"><span></span></div></div>';
    document.body.appendChild(ov);
    const lbl = ov.querySelector('.rk-progress-label');
    const bar = ov.querySelector('.rk-progress-bar span');
    lbl.textContent = label;
    return {
      set(text, p) { lbl.textContent = text; bar.style.width = p == null ? '' : Math.round(p * 100) + '%'; ov.querySelector('.rk-progress-bar').classList.toggle('rk-indeterminate', p == null); },
      close() { ov.remove(); },
    };
  }

  // Vorschläge aus einem geparsten Beleg für die aktuelle Reise ableiten.
  function buildSuggestions(p, tp, fileName) {
    const S = [];
    const money = (a, b) => a != null && b != null && Math.abs(a - b) < 0.01;
    const sug = (label, curTxt, sugTxt, current, match, apply) => {
      const status = match ? 'match' : (current == null ? 'fill' : 'mismatch');
      S.push({ label, curTxt, sugTxt, status, checked: status !== 'mismatch', apply });
    };
    const dpart = (s) => (s || '').slice(0, 10);

    if (p.type === 'hotel') {
      if (p.total != null) {
        const cur = tp.uebernachtung.mode === 'beleg' ? tp.uebernachtung.betrag : null;
        sug(t('bcHotelCost'), cur == null ? '—' : eur(cur), eur(p.total), cur, money(cur, p.total),
          () => { tp.uebernachtung.mode = 'beleg'; tp.uebernachtung.betrag = p.total; });
      }
      if (p.hotel && p.hotel.checkIn) {
        const inSet = !!tp.abreise, outSet = !!tp.rueckkehr;
        const co = p.hotel.checkOut || p.hotel.checkIn;
        const curTxt = (tp.abreise ? fmtDate(tp.abreise) : '—') + ' – ' + (tp.rueckkehr ? fmtDate(tp.rueckkehr) : '—');
        const sugTxt = fmtDate(p.hotel.checkIn) + ' – ' + fmtDate(co);
        const match = dpart(tp.abreise) === p.hotel.checkIn && dpart(tp.rueckkehr) === co;
        sug(t('bcPeriod'), curTxt, sugTxt, (inSet && outSet) ? curTxt : null, match,
          () => { if (!tp.abreise) tp.abreise = p.hotel.checkIn + 'T14:00'; if (!tp.rueckkehr) tp.rueckkehr = co + 'T11:00'; });
      }
      if (p.hotel && p.hotel.breakfast) {
        sug(t('bcBreakfast'), t('no'), t('bcAllNights'), null, false,
          () => { tripDays(tp).forEach((d) => { if (d.type === 'none' || d.type === 'arrival') return; tp.meals[d.date] = tp.meals[d.date] || {}; tp.meals[d.date].f = true; }); });
      }
    } else if (p.type === 'bahn' || p.type === 'oepnv') {
      if (p.total != null) {
        const receiptMode = ['bahn', 'flug', 'oepnv', 'sonstige'].includes(tp.verkehr.mittel);
        const cur = receiptMode ? tp.verkehr.betrag : null;
        sug(t('bcTravelCost'), cur == null ? '—' : eur(cur), eur(p.total), cur, money(cur, p.total),
          () => {
            // Nur wenn tatsächlich km eingetragen sind (= gefahren), Ticket als
            // Nebenkosten führen; sonst das Verkehrsmittel auf das Ticket setzen.
            const drove = (tp.verkehr.mittel === 'pkw' || tp.verkehr.mittel === 'motorrad') && num(tp.verkehr.km) > 0;
            if (drove) tp.extras.push({ bez: typeLabelOf(p.type), betrag: p.total });
            else { tp.verkehr.mittel = p.type === 'bahn' ? 'bahn' : 'oepnv'; tp.verkehr.betrag = p.total; }
          });
      }
      if (p.dates && p.dates.length) {
        const d0 = p.dates[0], d1 = p.dates[p.dates.length - 1];
        const curTxt = (tp.abreise ? fmtDate(tp.abreise) : '—') + ' – ' + (tp.rueckkehr ? fmtDate(tp.rueckkehr) : '—');
        const sugTxt = d0 === d1 ? fmtDate(d0) : fmtDate(d0) + ' – ' + fmtDate(d1);
        const match = dpart(tp.abreise) === d0 && dpart(tp.rueckkehr) === d1;
        sug(t('bcTravelDate'), curTxt, sugTxt, (tp.abreise && tp.rueckkehr) ? curTxt : null, match,
          () => { if (!tp.abreise) tp.abreise = d0 + 'T08:00'; if (!tp.rueckkehr) tp.rueckkehr = (d1 || d0) + 'T18:00'; });
      }
    } else if (p.total != null) {
      sug(t('bcExtraCost'), '—', eur(p.total), null, false,
        () => { tp.extras.push({ bez: (fileName || t('typeUnknown')).replace(/\.[^.]+$/, ''), betrag: p.total }); });
    }
    return S;
  }

  // Gegenprüf-Panel: erkannte Werte neben den aktuellen, einzeln übernehmbar.
  function showCrossCheck(parsed, fileName, method) {
    const tp = state.current;
    const suggestions = buildSuggestions(parsed, tp, fileName);
    const ov = document.createElement('div');
    ov.className = 'rk-modal-overlay';

    const routeStr = parsed.travel && (parsed.travel.from || parsed.travel.to)
      ? '<p class="rk-cross-route">' + esc(t('route')) + ': ' + esc([parsed.travel.from, parsed.travel.to].filter(Boolean).join(' → ')) +
        (parsed.travel.roundTrip ? ' ⇄' : '') + '</p>' : '';
    const rows = suggestions.map((s, i) =>
      '<div class="rk-cross-item rk-cross-' + s.status + '">' +
        '<label class="rk-cross-check"><input type="checkbox" data-i="' + i + '"' + (s.checked ? ' checked' : '') + '>' + esc(s.label) + '</label>' +
        '<span class="rk-badge rk-badge-' + s.status + '">' + esc(t('st' + s.status.charAt(0).toUpperCase() + s.status.slice(1))) + '</span>' +
        '<div class="rk-cross-vals"><span class="rk-cross-cur">' + esc(s.curTxt) + '</span>' +
          '<span class="rk-cross-arrow">→</span><span class="rk-cross-new">' + esc(s.sugTxt) + '</span></div>' +
      '</div>').join('');

    ov.innerHTML =
      '<div class="rk-modal rk-modal-cross" role="dialog" aria-modal="true">' +
        '<div class="rk-modal-head"><div><h3>' + esc(t('crossTitle')) + ' · ' + esc(typeLabelOf(parsed.type)) + '</h3>' +
          '<p class="rk-modal-sub">' + esc(t('crossSub', { name: fileName || '' })) + '</p></div>' +
          '<button class="rk-icon-btn rk-modal-x" data-x aria-label="✕">✕</button></div>' +
        routeStr +
        (suggestions.length
          ? '<div class="rk-cross-list">' + rows + '</div>'
          : '<p class="rk-hint">' + esc(t('detectedNothing')) + '</p>') +
        '<div class="rk-modal-actions">' +
          '<button class="qrx-btn" data-x>' + esc(t('dismiss')) + '</button>' +
          '<button class="qrx-btn qrx-btn-primary" data-apply>' + esc(suggestions.length ? t('applySel') : t('crossApply')) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    const close = () => ov.remove();
    ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-apply]').addEventListener('click', () => {
      const boxes = ov.querySelectorAll('input[type="checkbox"][data-i]');
      boxes.forEach((cb) => { if (cb.checked) { try { suggestions[+cb.getAttribute('data-i')].apply(); } catch (_) {} } });
      tp.belege.push({ name: fileName || t('typeUnknown'), type: parsed.type, total: parsed.total, dates: parsed.dates || [], method });
      close();
      renderEdit();  // Felder, Tage und Summen neu aus dem aktualisierten Stand
    });
  }

  // Tagesstruktur an neue Daten angleichen (bestehende Auswahl behalten).
  function rebuildDays() {
    const tp = state.current;
    const days = tripDays(tp);
    const validDates = new Set(days.map((d) => d.date));
    // verwaiste Einträge entfernen
    Object.keys(tp.meals).forEach((d) => { if (!validDates.has(d)) delete tp.meals[d]; });
    Object.keys(tp.nights).forEach((d) => { if (!validDates.has(d)) delete tp.nights[d]; });
  }

  function renderDays() {
    const tp = state.current;
    const box = $('rk-days');
    if (!box) return;
    const c = compute(tp);
    if (!c.days.length) {
      box.innerHTML = '<p class="rk-hint">' + esc(t('invalidDates')) + '</p>';
      return;
    }
    const typeLabel = { single: 'typeSingle', arrival: 'typeArrival', departure: 'typeDeparture', full: 'typeFull', none: 'typeNone' };
    let html =
      '<div class="rk-quickmeals"><span>' + esc(t('quickMeals')) + '</span>' +
        '<button class="qrx-btn qrx-btn-sm" data-action="quick-meal" data-meal="f">' + esc(t('qBreakfast')) + '</button>' +
        '<button class="qrx-btn qrx-btn-sm" data-action="quick-meal" data-meal="m">' + esc(t('qLunch')) + '</button>' +
        '<button class="qrx-btn qrx-btn-sm" data-action="quick-meal" data-meal="a">' + esc(t('qDinner')) + '</button>' +
        '<button class="qrx-btn qrx-btn-sm" data-action="quick-clear">' + esc(t('qClear')) + '</button>' +
      '</div><div class="rk-days">';
    c.rows.forEach((row) => {
      const d = new Date(row.date + 'T12:00:00');
      const dow = d.toLocaleDateString(locale(), { weekday: 'short' });
      const dateStr = d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
      html += '<div class="rk-day">' +
        '<div class="rk-day-date"><span class="rk-day-dow">' + esc(dow) + ', ' + esc(dateStr) + '</span>' +
          '<span class="rk-day-type">' + esc(t(typeLabel[row.type])) + '</span></div>' +
        '<div class="rk-meals">' + mealChip(row, 'f', t('colBreakfast'), t('breakfast')) +
          mealChip(row, 'm', t('colLunch'), t('lunch')) + mealChip(row, 'a', t('colDinner'), t('dinner')) + '</div>' +
        '<label class="rk-day-night"><input type="checkbox" data-field="night" data-date="' + esc(row.date) + '"' + (row.hasNight ? ' checked' : '') + '> ' + esc(t('night')) + '</label>' +
        '<div class="rk-day-amount">' + esc(eur(row.amount)) + '</div>' +
      '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  }
  function mealChip(row, key, short, title) {
    const on = !!(row.meals && row.meals[key]);
    return '<label class="rk-meal' + (on ? ' rk-on' : '') + '" title="' + esc(title) + '">' +
      '<input type="checkbox" data-field="meal" data-date="' + esc(row.date) + '" data-meal="' + key + '"' + (on ? ' checked' : '') + '>' + esc(short) + '</label>';
  }

  function renderSummary() {
    const box = $('rk-summary');
    if (!box) return;
    const c = compute(state.current);
    box.innerHTML = '<div class="rk-summary">' +
      sumItem('sumVerpflegung', c.verpflegung) +
      sumItem('sumFahrt', c.fahrt) +
      sumItem('sumUebernachtung', c.uebernachtung) +
      sumItem('sumNeben', c.neben) +
      '<div class="rk-sum-item rk-sum-total"><span class="rk-sum-label">' + esc(t('sumTotal')) + '</span>' +
        '<span class="rk-sum-value">' + esc(eur(c.total)) + '</span></div>' +
      '<div class="rk-summary-actions">' +
        '<button class="qrx-btn qrx-btn-primary" data-action="save">' + esc(t('save')) + '</button>' +
        '<button class="qrx-btn" data-action="report">' + esc(t('report')) + '</button>' +
        '<button class="qrx-btn" data-action="csv-trip">' + esc(t('csv')) + '</button>' +
        '<button class="qrx-btn" data-action="delete-trip">' + esc(t('deleteTrip')) + '</button>' +
      '</div></div>';
  }
  function sumItem(key, val) {
    return '<div class="rk-sum-item"><span class="rk-sum-label">' + esc(t(key)) + '</span>' +
      '<span class="rk-sum-value">' + esc(eur(val)) + '</span></div>';
  }
  function refreshCalc() { renderDays(); renderSummary(); }

  // ============================================================ EINSTELLUNGEN
  function renderSettings() {
    const s = state.settings;
    const el = views.settings;
    const numField = (label, key, step) =>
      field(label, '<input class="qrx-input" type="number" min="0" step="' + step + '" inputmode="decimal" data-setting="' + key + '" value="' + esc(s[key]) + '">');
    el.innerHTML = '<div class="rk-form">' +
      '<div class="rk-form-head"><button class="rk-back" data-action="back">← ' + esc(t('back')) + '</button></div>' +
      '<div class="rk-section"><h2>' + esc(t('setRates')) + '</h2><div class="rk-settings-grid">' +
        numField(t('fldFullRate') + ' — Inland', 'inlandFull', '0.01') +
        numField(t('typeArrival') + '/' + t('typeDeparture') + ' — Inland', 'inlandOver8', '0.01') +
        numField(t('sumUebernachtung') + ' — Inland', 'inlandNight', '0.01') +
        numField('PKW €/km', 'kmCar', '0.01') +
        numField('Motorrad €/km', 'kmBike', '0.01') +
      '</div></div>' +
      '<div class="rk-section"><h2>' + esc(t('setPerspektive')) + '</h2>' +
        field(t('setPerspektive'), '<select class="qrx-select" data-setting="perspektive">' +
          [['beides', 'pBeides'], ['arbeitnehmer', 'pArbeitnehmer'], ['selbst', 'pSelbst']]
            .map(([v, k]) => '<option value="' + v + '"' + (s.perspektive === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('') +
          '</select>') +
        '<div class="rk-note">' + esc(t('disclaimer')) + '</div>' +
      '</div>' +
      '<div class="rk-form-head"><button class="qrx-btn" data-action="reset-settings">' + esc(t('setReset')) + '</button></div>' +
      '</div>';
  }

  // ============================================================ ABRECHNUNG
  function renderReport(tp) {
    const c = compute(tp);
    const el = views.report;
    const typeLabel = { single: 'typeSingle', arrival: 'typeArrival', departure: 'typeDeparture', full: 'typeFull', none: 'typeNone' };
    const mealsStr = (m) => [m.f ? t('colBreakfast') : '', m.m ? t('colLunch') : '', m.a ? t('colDinner') : ''].filter(Boolean).join(' ') || '–';
    let daysRows = c.rows.map((r) =>
      '<tr><td>' + esc(fmtDate(r.date)) + '</td><td>' + esc(t(typeLabel[r.type])) + '</td>' +
      '<td>' + esc(mealsStr(r.meals)) + '</td><td class="rk-num">' + esc(eur(r.amount)) + '</td></tr>').join('');
    const dest = (tp.ort ? tp.ort + (destName(tp) ? ', ' + destName(tp) : '') : destName(tp)) || t('untitled');
    el.innerHTML =
      '<div class="rk-report">' +
        '<div class="rk-report-actions rk-noprint">' +
          '<button class="rk-back" data-action="back">← ' + esc(t('back')) + '</button>' +
          '<button class="qrx-btn qrx-btn-primary" data-action="print">' + esc(t('print')) + '</button>' +
          '<button class="qrx-btn" data-action="csv-trip" data-id="' + esc(tp.id) + '">' + esc(t('csv')) + '</button>' +
        '</div>' +
        '<div class="rk-report-sheet">' +
          '<h1>' + esc(t('reportTitle')) + '</h1>' +
          '<div class="rk-report-meta">' +
            '<div><b>' + esc(t('reportPlace')) + ':</b> ' + esc(dest) + '</div>' +
            '<div><b>' + esc(t('reportReason')) + ':</b> ' + esc(tp.reason || '–') + '</div>' +
            '<div><b>' + esc(t('reportPeriod')) + ':</b> ' + esc(fmtDateTime(tp.abreise) + ' – ' + fmtDateTime(tp.rueckkehr)) + '</div>' +
            '<div><b>' + esc(t('reportDays')) + ':</b> ' + esc(t('reportDaysVal', { days: c.dayCount, hours: Math.round(c.hours) })) + '</div>' +
          '</div>' +
          '<table class="rk-table"><thead><tr><th>' + esc(t('thDate')) + '</th><th>' + esc(t('thType')) + '</th>' +
            '<th>' + esc(t('thMeals')) + '</th><th class="rk-num">' + esc(t('thPerDiem')) + '</th></tr></thead>' +
            '<tbody>' + daysRows + '</tbody>' +
            '<tfoot>' +
              rowFoot(t('sumVerpflegung'), c.verpflegung) +
              rowFoot(t('sumFahrt'), c.fahrt) +
              rowFoot(t('sumUebernachtung'), c.uebernachtung) +
              rowFoot(t('sumNeben'), c.neben) +
              '<tr><td colspan="3">' + esc(t('sumTotal')) + '</td><td class="rk-num">' + esc(eur(c.total)) + '</td></tr>' +
            '</tfoot>' +
          '</table>' +
          (tp.belege && tp.belege.length
            ? '<p class="rk-report-receipts"><b>' + esc(t('reportReceipts')) + ':</b> ' +
                esc(tp.belege.map((b) => b.name + (b.total != null ? ' (' + eur(b.total) + ')' : '')).join(' · ')) + '</p>'
            : '') +
          '<div class="rk-report-sign"><div>' + esc(t('reportSignEmp')) + '</div><div>' + esc(t('reportSignApprove')) + '</div></div>' +
        '</div>' +
      '</div>';
  }
  function rowFoot(label, val) {
    return '<tr><td colspan="3">' + esc(label) + '</td><td class="rk-num">' + esc(eur(val)) + '</td></tr>';
  }
  function fmtDateTime(dtStr) {
    if (!dtStr) return '–';
    const d = new Date(dtStr);
    if (isNaN(d)) return '–';
    return d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------- CSV
  function csvNum(n) { return (Math.round((n || 0) * 100) / 100).toFixed(2).replace('.', ','); }
  function csvCell(s) { s = String(s == null ? '' : s); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv(trips, filename) {
    const head = ['Anlass', 'Ort', 'Ziel', 'Abreise', 'Rückkehr', 'Tage', 'Verpflegung', 'Fahrt', 'Übernachtung', 'Nebenkosten', 'Summe'];
    const lines = [head.map(csvCell).join(';')];
    trips.forEach((tp) => {
      const c = compute(tp);
      lines.push([
        tp.reason, tp.ort, isInland(tp) ? 'Inland' : (destName(tp) || 'Ausland'),
        tp.abreise, tp.rueckkehr, c.dayCount,
        csvNum(c.verpflegung), csvNum(c.fahrt), csvNum(c.uebernachtung), csvNum(c.neben), csvNum(c.total),
      ].map(csvCell).join(';'));
    });
    const csv = '﻿' + lines.join('\r\n');
    qrx.core.download(csv, filename, 'text/csv;charset=utf-8');
  }

  // ---------------------------------------------------------------- Events
  function openTrip(id) {
    const tp = state.trips.find((x) => x.id === id);
    if (!tp) return;
    state.current = JSON.parse(JSON.stringify(tp));
    renderEdit();
    showView('edit');
  }
  function newTrip() {
    state.current = blankTrip();
    renderEdit();
    showView('edit');
  }
  function saveCurrent() {
    const tp = state.current;
    const idx = state.trips.findIndex((x) => x.id === tp.id);
    if (idx >= 0) state.trips[idx] = tp; else state.trips.push(tp);
    saveTrips();
    renderList();
    showView('list');
  }
  function deleteCurrent() {
    if (!confirm(t('confirmDelete'))) return;
    state.trips = state.trips.filter((x) => x.id !== state.current.id);
    saveTrips();
    renderList();
    showView('list');
  }

  // Eingaben (input/change) — delegiert auf beide Views.
  function onInput(e) {
    const eln = e.target;
    if (eln.type === 'file') {
      const file = eln.files && eln.files[0];
      eln.value = '';            // gleiche Datei erneut wählbar machen
      if (file) importReceipt(file);
      return;
    }
    const f = eln.getAttribute('data-field');
    const settingKey = eln.getAttribute('data-setting');
    if (settingKey) {
      state.settings[settingKey] = eln.type === 'number' ? num(eln.value) : eln.value;
      saveSettings();
      return;
    }
    if (!f || !state.current) return;
    const tp = state.current;
    switch (f) {
      case 'reason': tp.reason = eln.value; break;
      case 'ort': tp.ort = eln.value; break;
      case 'abName': tp.abName = eln.value; break;
      case 'country':
        tp.country = eln.value;
        if (tp.country !== 'DE') {
          const r = rateOf(tp.country);
          if (r) { tp.abFull = r.full; tp.abNight = r.night; tp.abName = destName(tp); }
          else if (tp.country === 'CUSTOM' && !tp.abFull) { tp.abFull = 0; tp.abNight = 0; }
        }
        renderRateFields(); rebuildDays(); refreshCalc(); break;
      case 'abFull': tp.abFull = num(eln.value); refreshCalc(); break;
      case 'abNight': tp.abNight = num(eln.value); refreshCalc(); break;
      case 'abreise': tp.abreise = eln.value; rebuildDays(); refreshCalc(); break;
      case 'rueckkehr': tp.rueckkehr = eln.value; rebuildDays(); refreshCalc(); break;
      case 'verkehrMittel': tp.verkehr.mittel = eln.value; renderVerkehrFields(); refreshCalc(); break;
      case 'km': tp.verkehr.km = num(eln.value); refreshCalc(); break;
      case 'verkehrBetrag': tp.verkehr.betrag = num(eln.value); refreshCalc(); break;
      case 'nightMode': tp.uebernachtung.mode = eln.value; renderNightFields(); refreshCalc(); break;
      case 'nightBetrag': tp.uebernachtung.betrag = num(eln.value); refreshCalc(); break;
      case 'meal': {
        const date = eln.getAttribute('data-date'), meal = eln.getAttribute('data-meal');
        tp.meals[date] = tp.meals[date] || {};
        tp.meals[date][meal] = eln.checked;
        refreshCalc(); break;
      }
      case 'night': {
        const date = eln.getAttribute('data-date');
        tp.nights[date] = eln.checked;
        refreshCalc(); break;
      }
      case 'extraName': tp.extras[+eln.getAttribute('data-idx')].bez = eln.value; break;
      case 'extraBetrag': tp.extras[+eln.getAttribute('data-idx')].betrag = num(eln.value); renderSummary(); break;
    }
  }

  function onClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    switch (action) {
      case 'new': newTrip(); break;
      case 'edit': openTrip(target.getAttribute('data-id')); break;
      case 'back': renderList(); showView('list'); break;
      case 'save': saveCurrent(); break;
      case 'delete-trip': deleteCurrent(); break;
      case 'report': saveCurrentQuiet(); renderReport(state.current); showView('report'); break;
      case 'print': window.print(); break;
      case 'csv-trip': exportCsv([state.current], 'reisekosten-' + (state.current.ort || 'reise') + '.csv'); break;
      case 'csv-all': exportCsv(state.trips, 'reisekosten-alle.csv'); break;
      case 'add-extra': state.current.extras.push({ bez: '', betrag: 0 }); renderExtras(); break;
      case 'del-extra':
        state.current.extras.splice(+target.getAttribute('data-idx'), 1);
        renderExtras(); renderSummary(); break;
      case 'del-beleg':
        state.current.belege.splice(+target.getAttribute('data-idx'), 1);
        renderBelege(); break;
      case 'quick-meal': {
        const meal = target.getAttribute('data-meal');
        tripDays(state.current).forEach((d) => {
          if (d.type === 'none') return;
          state.current.meals[d.date] = state.current.meals[d.date] || {};
          state.current.meals[d.date][meal] = true;
        });
        refreshCalc(); break;
      }
      case 'quick-clear': state.current.meals = {}; refreshCalc(); break;
      case 'reset-settings':
        state.settings = Object.assign({}, DEFAULTS);
        saveSettings(); renderSettings(); break;
    }
  }
  // Aktuellen Stand ohne Views-Wechsel sichern (für Abrechnung/Report).
  function saveCurrentQuiet() {
    const tp = state.current;
    const idx = state.trips.findIndex((x) => x.id === tp.id);
    if (idx >= 0) state.trips[idx] = tp; else state.trips.push(tp);
    saveTrips();
  }

  // ---------------------------------------------------------------- Sprache
  qrx.i18n.onChange(() => {
    if (state.view === 'list') renderList();
    else if (state.view === 'edit' && state.current) renderEdit();
    else if (state.view === 'settings') renderSettings();
    else if (state.view === 'report' && state.current) renderReport(state.current);
  });

  // ---------------------------------------------------------------- Snapshot
  // Aller Zustand liegt in localStorage; "Mit Daten exportieren" serialisiert die
  // reisekosten_*-Keys, hydrateState schreibt sie zurück und lädt einmal neu.
  const SNAP_KEYS = [KEY_TRIPS, KEY_SETTINGS];
  window.qurixApp = window.qurixApp || {};
  window.qurixApp.serializeState = function () {
    const data = {};
    SNAP_KEYS.forEach((k) => { const v = store.get(k); if (v != null) data[k] = v; });
    return data;
  };
  window.qurixApp.hydrateState = function (s) {
    if (!s || typeof s !== 'object') return;
    let changed = false;
    SNAP_KEYS.forEach((k) => {
      if (s[k] == null) return;
      if (store.get(k) !== s[k]) { store.set(k, s[k]); changed = true; }
    });
    if (changed) location.reload();
  };

  // ---------------------------------------------------------------- Init
  load();
  renderSettings();
  renderList();
  showView('list');

  document.querySelector('.rk-nav-new').addEventListener('click', newTrip);
  document.querySelector('.rk-nav-settings').addEventListener('click', () => { renderSettings(); showView('settings'); });
  document.querySelector('.rk').addEventListener('input', onInput);
  document.querySelector('.rk').addEventListener('change', onInput);
  document.querySelector('.rk').addEventListener('click', onClick);
})();
