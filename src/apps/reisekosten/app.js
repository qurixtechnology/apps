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
      meals: {}, nights: {}, extras: [],
    }, tp, {
      verkehr: Object.assign({ mittel: 'pkw', km: 0, betrag: 0 }, tp.verkehr),
      uebernachtung: Object.assign({ mode: 'pauschale', betrag: 0 }, tp.uebernachtung),
      meals: tp.meals || {}, nights: tp.nights || {}, extras: tp.extras || [],
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

        '<div id="rk-summary"></div>' +
      '</div>';

    renderRateFields();
    renderVerkehrFields();
    renderNightFields();
    renderExtras();
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
