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
  const KEY_FILE_PREFIX = 'reisekosten_file_';   // je „behaltenem" Beleg ein Key: reisekosten_file_<fileId>
  const KEY_PREFIX = 'reisekosten_';

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
      secReceipts: 'Belege', importReceipt: '＋ Beleg importieren (PDF/Foto)', dropOr: 'oder Datei hierher ziehen',
      receiptHint: 'PDF, Foto oder Scan — Beträge und Daten werden automatisch erkannt. Erste Erkennung lädt einmalig die Lese-Bibliothek (Internet nötig). Gespeichert werden nur die erkannten Werte und der Dateiname als Referenz — die Datei selbst wird standardmäßig nicht abgelegt (schont den Speicher). Anzeigen geht per Klick auf 📎 (hier direkt und in jeder Position); nach einem Neuladen wählst du eine nicht behaltene Datei einmalig neu. Beim Bearbeiten einer Position kannst du „Beleg behalten" ankreuzen, um genau diese Datei mitzuspeichern.',
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
      viewReceipt: 'Ansehen', openNewTab: 'In neuem Tab öffnen', downloadFile: 'Herunterladen',
      tooBig: 'Datei zu groß zum Speichern', quotaWarn: 'Speicher voll — die Beleg-Datei wurde nicht gespeichert (nur die erkannten Daten).',
      storageBlocked: 'Achtung: Der Browser speichert gerade keine Daten (z. B. privater/Inkognito-Modus oder für diese Seite blockierte Website-Daten). Deine Reisen können so nicht gesichert werden. Bitte den normalen Modus nutzen bzw. Website-Daten für apps.qurix.tech erlauben.',
      secCosts: 'Kosten', catFahrt: 'Fahrt', catUeb: 'Übernachtung', catNeben: 'Nebenkosten',
      addFahrt: '+ Fahrt', addUeb: '+ Übernachtung', addNeben: '+ Nebenkosten',
      modeBetrag: '€ (fester Betrag)', modeKm: 'km × Satz', modePauschale: 'Nächte × Satz',
      posKmRate: '€/km', posNights: 'Nächte', posNightRate: '€/Nacht', posDescPh: 'Bezeichnung',
      costsEmpty: 'Noch keine Positionen — manuell hinzufügen oder Belege importieren.',
      batchTitle: 'Belege erkannt', batchOne: 'Beleg erkannt',
      batchSub: '{n} Datei(en) — wähle, welche als Position übernommen werden',
      colPeriod: 'Zeitraum', diffPeriod: 'anderer Zeitraum', noPeriod: 'ohne Datum',
      tripUpdates: 'Reise aktualisieren', suggSetPeriod: 'Reisezeitraum aus Beleg setzen',
      suggBreakfast: 'Frühstück an Übernachtungstagen', applyBatch: 'Übernehmen',
      tripPeriodTitle: 'Reisezeitraum (aus Belegen wählen)', periodKeep: 'nicht ändern', periodSource: 'aus {n} Beleg(en)',
      editPosTitle: 'Position bearbeiten', posCategory: 'Kategorie', posMode: 'Berechnung', posDelete: 'Löschen', posDesc: 'Bezeichnung',
      importingN: 'Beleg {i}/{n} wird gelesen …', nothingDetected: 'In den Dateien wurde nichts Auswertbares erkannt.',
      reportCosts: 'Kosten', thCat: 'Art', thDesc: 'Bezeichnung', thAmount: 'Betrag', posReceipt: 'Beleg',
      viewReceipt: 'Anzeigen', viewFailed: 'Die Datei konnte nicht geöffnet werden.',
      keepReceipt: 'Beleg behalten', keepReceiptHint: 'Speichert genau diese Datei mit, damit sie auch nach dem Neuladen ohne erneutes Auswählen angezeigt werden kann (belegt etwas Speicher).',
      keepFailed: 'Der Beleg konnte nicht gespeichert werden (Speicher voll?). Die Referenz bleibt erhalten.',
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
      secReceipts: 'Receipts', importReceipt: '＋ Import receipt (PDF/photo)', dropOr: 'or drag a file here',
      receiptHint: 'PDF, photo or scan — amounts and dates are detected automatically. The first detection loads the reader library once (internet needed). Only the detected values and the file name (as a reference) are stored — by default the file itself is not kept (saves storage). Tap 📎 to view (here and on every position); after a reload a non-kept file is picked once more. While editing a position you can tick “Keep receipt" to store that one file with the trip.',
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
      viewReceipt: 'View', openNewTab: 'Open in new tab', downloadFile: 'Download',
      tooBig: 'File too large to store', quotaWarn: 'Storage full — the receipt file was not saved (only the detected data).',
      storageBlocked: 'Note: your browser is not storing data right now (e.g. private/incognito mode or site data blocked for this page). Your trips cannot be saved. Please use normal mode or allow site data for apps.qurix.tech.',
      secCosts: 'Costs', catFahrt: 'Travel', catUeb: 'Accommodation', catNeben: 'Incidentals',
      addFahrt: '+ Travel', addUeb: '+ Accommodation', addNeben: '+ Incidental',
      modeBetrag: '€ (fixed amount)', modeKm: 'km × rate', modePauschale: 'nights × rate',
      posKmRate: '€/km', posNights: 'Nights', posNightRate: '€/night', posDescPh: 'Description',
      costsEmpty: 'No positions yet — add manually or import receipts.',
      batchTitle: 'Receipts detected', batchOne: 'Receipt detected',
      batchSub: '{n} file(s) — choose which to add as a position',
      colPeriod: 'Period', diffPeriod: 'different period', noPeriod: 'no date',
      tripUpdates: 'Update trip', suggSetPeriod: 'Set trip period from receipt',
      suggBreakfast: 'Breakfast on overnight days', applyBatch: 'Apply',
      tripPeriodTitle: 'Trip period (choose from receipts)', periodKeep: 'keep current', periodSource: 'from {n} receipt(s)',
      editPosTitle: 'Edit position', posCategory: 'Category', posMode: 'Calculation', posDelete: 'Delete', posDesc: 'Description',
      importingN: 'Reading receipt {i}/{n} …', nothingDetected: 'Nothing usable was detected in the files.',
      reportCosts: 'Costs', thCat: 'Type', thDesc: 'Description', thAmount: 'Amount', posReceipt: 'Receipt',
      viewReceipt: 'View', viewFailed: 'The file could not be opened.',
      keepReceipt: 'Keep receipt', keepReceiptHint: 'Stores this file with the trip so it can be viewed after a reload without picking it again (uses some storage).',
      keepFailed: 'The receipt could not be stored (storage full?). The reference is kept.',
    },
  });
  const t = (k, p) => qrx.i18n.t('app.' + k, p);
  const locale = () => qrx.i18n.locale();
  const eur = (n) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(n || 0);
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };

  // ---------------------------------------------------------------- Persistenz
  // Beleg-Dateien (base64) liegen NICHT in der Reisen-JSON, sondern je Datei in
  // einem eigenen localStorage-Key. So bleibt die Reisenliste klein und wird auch
  // bei knappem Speicher (mobil) zuverlässig gesichert; Dateien sind best-effort.
  function load() {
    state.settings = Object.assign({}, DEFAULTS, store.getJSON(KEY_SETTINGS, {}));
    const trips = store.getJSON(KEY_TRIPS, []);
    state.trips = Array.isArray(trips) ? trips.map(normalizeTrip) : [];
    purgeOrphanFileKeys();   // verwaiste Beleg-Dateien entfernen (nur behaltene bleiben)
  }
  // fileIds aller aktuell referenzierten „behaltenen" Belege.
  function referencedFileKeys() {
    const set = new Set();
    (state.trips || []).forEach((tp) => (tp.positions || []).forEach((p) => { if (p.fileId) set.add(storedFileKey(p.fileId)); }));
    return set;
  }
  // Beleg-Datei-Keys entfernen, die zu keiner Position mehr gehören (Legacy oder
  // abgewähltes „behalten") — behaltene Dateien bleiben erhalten.
  function purgeOrphanFileKeys() {
    try {
      const keep = referencedFileKeys();
      const del = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(KEY_FILE_PREFIX) === 0 && !keep.has(k)) del.push(k); }
      del.forEach((k) => store.remove(k));
    } catch (_) {}
  }
  function persistTrips() {
    const ok = store.setJSON(KEY_TRIPS, state.trips);
    if (!ok) { try { alert(t('storageBlocked')); } catch (_) {} }
    purgeOrphanFileKeys();   // verwaiste Beleg-Dateien aufräumen
    return ok;
  }
  function saveSettings() { store.setJSON(KEY_SETTINGS, state.settings); }

  function newId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Alt-Modell (verkehr/uebernachtung/extras/belege) → Positionsliste.
  function migratePositions(tp) {
    const pos = [];
    const v = tp.verkehr || {};
    if ((v.mittel === 'pkw' || v.mittel === 'motorrad') && num(v.km) > 0)
      pos.push({ id: newId(), kind: 'fahrt', bez: v.mittel === 'pkw' ? 'PKW' : 'Motorrad', mode: 'km', km: num(v.km), ratePerKm: v.mittel === 'pkw' ? num(state.settings.kmCar) : num(state.settings.kmBike), betrag: 0 });
    else if (['bahn', 'flug', 'oepnv', 'sonstige'].includes(v.mittel) && num(v.betrag) > 0)
      pos.push({ id: newId(), kind: 'fahrt', bez: '', mode: 'betrag', betrag: num(v.betrag) });
    const u = tp.uebernachtung || {};
    const nights = Math.max(0, tripDays(tp).length - 1);
    if (u.mode === 'pauschale' && nights > 0)
      pos.push({ id: newId(), kind: 'uebernachtung', bez: 'Übernachtung', mode: 'pauschale', nights, nightRate: nightRate(tp), betrag: 0 });
    else if (u.mode === 'beleg' && num(u.betrag) > 0)
      pos.push({ id: newId(), kind: 'uebernachtung', bez: 'Übernachtung', mode: 'betrag', betrag: num(u.betrag) });
    (tp.extras || []).forEach((e) => pos.push({ id: newId(), kind: 'neben', bez: e.bez || '', mode: 'betrag', betrag: num(e.betrag) }));
    // Alte Belege (Dateien) als Anhang an eine passende Position hängen, ohne
    // deren Betrag erneut zu zählen; sonst als Betrag-0-Anhangposition.
    (tp.belege || []).forEach((b) => {
      if (!b.dataUrl && !b.tooBig) return;
      const kind = b.type === 'hotel' ? 'uebernachtung' : (b.type === 'bahn' || b.type === 'oepnv') ? 'fahrt' : 'neben';
      const target = pos.find((p) => p.kind === kind && !p.belegName);
      const att = { belegName: b.name, mime: b.mime, dataUrl: b.dataUrl, method: b.method, tooBig: b.tooBig };
      if (target) Object.assign(target, att);
      else pos.push(Object.assign({ id: newId(), kind, bez: b.name || '', mode: 'betrag', betrag: 0 }, att));
    });
    return pos;
  }

  function normalizeTrip(tp) {
    const base = Object.assign({
      id: newId(), ort: '', country: 'DE', abName: '', abFull: 0, abNight: 0,
      abreise: '', rueckkehr: '', reason: '', notiz: '', meals: {}, positions: [],
    }, tp, { meals: tp.meals || {} });
    const legacy = tp.verkehr || tp.uebernachtung || (tp.extras && tp.extras.length) || (tp.belege && tp.belege.length);
    if (!Array.isArray(base.positions) || (!base.positions.length && legacy)) base.positions = migratePositions(base);
    base.positions = (base.positions || []).map((p) => {
      const q = Object.assign({ id: newId(), kind: 'neben', bez: '', mode: 'betrag', betrag: 0 }, p);
      // Dateiname (Referenz) und fileId (behaltener Beleg) behalten; alte inline-Felder verwerfen.
      delete q.dataUrl; delete q.mime; delete q.tooBig; delete q.method;
      // fileId nur behalten, wenn die zugehörige Datei wirklich (noch) gespeichert ist.
      if (q.fileId && store.get(storedFileKey(q.fileId), null) == null) delete q.fileId;
      return q;
    });
    // Alt-Felder nicht weiterschleppen
    ['verkehr', 'uebernachtung', 'extras', 'belege', 'nights'].forEach((k) => delete base[k]);
    return base;
  }
  function blankTrip() {
    return normalizeTrip({ id: newId(), country: 'DE' });
  }

  // ---------------------------------------------------------------- Positionen
  function posAmount(p) {
    if (p.mode === 'km') return round2(num(p.km) * num(p.ratePerKm));
    if (p.mode === 'pauschale') return round2(num(p.nights) * num(p.nightRate));
    return round2(num(p.betrag));
  }
  function newPosition(kind, tp) {
    if (kind === 'fahrt') return { id: newId(), kind, bez: '', mode: 'km', km: 0, ratePerKm: num(state.settings.kmCar), betrag: 0 };
    if (kind === 'uebernachtung') return { id: newId(), kind, bez: t('catUeb'), mode: 'pauschale', nights: Math.max(0, tripDays(tp).length - 1), nightRate: nightRate(tp), betrag: 0 };
    return { id: newId(), kind: 'neben', bez: '', mode: 'betrag', betrag: 0 };
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
    const rows = days.map((d) => {
      const meals = trip.meals[d.date] || {};
      let base = 0;
      if (d.type === 'full') base = full;
      else if (d.type === 'arrival' || d.type === 'departure' || d.type === 'single') base = over8;
      // Kürzung stets vom vollen Tagessatz, gedeckelt bei 0.
      const reduction = full * ((meals.f ? REDUCE.f : 0) + (meals.m ? REDUCE.m : 0) + (meals.a ? REDUCE.a : 0));
      const amount = Math.max(0, round2(base - reduction));
      return { date: d.date, type: d.type, base, reduction: round2(reduction), amount, meals };
    });
    const verpflegung = round2(rows.reduce((s, r) => s + r.amount, 0));

    // Kosten-Positionen (Fahrt / Übernachtung / Nebenkosten)
    const pos = trip.positions || [];
    const sumKind = (k) => round2(pos.filter((p) => p.kind === k).reduce((s, p) => s + posAmount(p), 0));
    const fahrt = sumKind('fahrt'), uebernachtung = sumKind('uebernachtung'), neben = sumKind('neben');

    const total = round2(verpflegung + fahrt + uebernachtung + neben);
    const hours = (trip.abreise && trip.rueckkehr) ? (new Date(trip.rueckkehr) - new Date(trip.abreise)) / 3600000 : 0;
    return { rows, days, verpflegung, fahrt, uebernachtung, neben, total, hours: Math.max(0, hours), dayCount: days.length };
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

        '<div class="rk-section"><h2>' + esc(t('secDays')) + '</h2>' +
          '<div id="rk-days"></div>' +
        '</div>' +

        '<div class="rk-section"><h2>' + esc(t('secCosts')) + '</h2>' +
          '<div id="rk-positions"></div>' +
          '<div class="rk-pos-add">' +
            '<button class="qrx-btn qrx-btn-sm" data-action="add-pos" data-kind="fahrt">' + esc(t('addFahrt')) + '</button>' +
            '<button class="qrx-btn qrx-btn-sm" data-action="add-pos" data-kind="uebernachtung">' + esc(t('addUeb')) + '</button>' +
            '<button class="qrx-btn qrx-btn-sm" data-action="add-pos" data-kind="neben">' + esc(t('addNeben')) + '</button>' +
          '</div>' +
          '<label class="rk-dropzone" id="rk-dropzone">' +
            '<input id="rk-file" type="file" accept="application/pdf,image/*" multiple hidden>' +
            '<svg class="rk-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>' +
            '<span class="rk-dropzone-title">' + esc(t('importReceipt')) + '</span>' +
            '<span class="rk-dropzone-sub">' + esc(t('dropOr')) + '</span>' +
          '</label>' +
          '<p class="rk-hint">' + esc(t('receiptHint')) + '</p>' +
        '</div>' +

        '<div id="rk-summary"></div>' +
      '</div>';

    renderRateFields();
    renderPositions();
    rebuildDays();
    refreshCalc();
  }

  function field(label, control, extraClass) {
    return '<label class="rk-field ' + (extraClass || '') + '"><span class="qrx-label">' + esc(label) + '</span>' + control + '</label>';
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

  // -------- Kosten-Positionen (Fahrt / Übernachtung / Nebenkosten) --------
  function catOptions(sel) {
    return [['fahrt', 'catFahrt'], ['uebernachtung', 'catUeb'], ['neben', 'catNeben']]
      .map(([v, k]) => '<option value="' + v + '"' + (sel === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('');
  }
  const nfmt = (n) => num(n).toLocaleString(locale());
  function posDetail(p) {
    if (p.mode === 'km') return nfmt(p.km) + ' km × ' + nfmt(p.ratePerKm) + ' ' + t('posKmRate');
    if (p.mode === 'pauschale') return nfmt(p.nights) + ' ' + t('posNights') + ' × ' + nfmt(p.nightRate) + ' ' + t('posNightRate');
    return '';
  }
  // Kompakte, einzeilige Anzeige-Zeile; Klick öffnet das Bearbeiten-Popup.
  function posRowHtml(p, i) {
    const detail = posDetail(p);
    const clip = p.belegName
      ? ' <button type="button" class="rk-pos-clip" data-action="view-pos" data-idx="' + i + '"' +
        ' title="' + esc(t('viewReceipt')) + ': ' + esc(p.belegName) + '" aria-label="' + esc(t('viewReceipt')) + '">📎</button>'
      : '';
    return '<div class="rk-pos-row rk-pos-' + p.kind + '" data-action="edit-pos" data-idx="' + i + '" role="button" tabindex="0">' +
      '<span class="rk-pos-chip">' + esc(catLabel(p.kind)) + '</span>' +
      '<span class="rk-pos-main"><span class="rk-pos-desc">' + esc(p.bez || catLabel(p.kind)) + clip + '</span>' +
        (detail ? '<span class="rk-pos-detail">' + esc(detail) + '</span>' : '') + '</span>' +
      '<span class="rk-pos-amt">' + esc(eur(posAmount(p))) + '</span>' +
      '<span class="rk-pos-actions">' +
        '<button class="rk-icon-btn rk-pos-act" data-action="del-pos" data-idx="' + i + '" aria-label="✕">✕</button></span>' +
    '</div>';
  }
  function renderPositions() {
    const box = $('rk-positions');
    if (!box) return;
    const list = state.current.positions || [];
    box.innerHTML = list.length
      ? list.map((p, i) => posRowHtml(p, i)).join('')
      : '<p class="rk-hint">' + esc(t('costsEmpty')) + '</p>';
  }

  // Bearbeiten-Popup für eine Position (isNew: bei Abbruch wird sie entfernt).
  function editPosition(idx, isNew) {
    const orig = state.current.positions[idx];
    if (!orig) return;
    const draft = JSON.parse(JSON.stringify(orig));
    let keepWanted = !!draft.fileId;   // „Beleg behalten" aktiv?
    let pickedFile = null;             // frisch gewählte Datei (für Behalten/Anzeigen)
    const efNum = (ef, val, step) => '<input class="qrx-input" type="number" min="0" step="' + step + '" inputmode="decimal" data-ef="' + ef + '" value="' + esc(val) + '">';
    function modeSelect() {
      const opts = draft.kind === 'fahrt' ? [['km', 'modeKm'], ['betrag', 'modeBetrag']]
        : draft.kind === 'uebernachtung' ? [['pauschale', 'modePauschale'], ['betrag', 'modeBetrag']] : null;
      if (!opts) return '';
      return field(t('posMode'), '<select class="qrx-select" data-ef="mode">' +
        opts.map(([v, k]) => '<option value="' + v + '"' + (draft.mode === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('') + '</select>');
    }
    function modeControls() {
      if (draft.kind === 'fahrt' && draft.mode === 'km') return field(t('fldKm'), efNum('km', draft.km, '1')) + field(t('posKmRate'), efNum('ratePerKm', draft.ratePerKm, '0.01'));
      if (draft.kind === 'uebernachtung' && draft.mode === 'pauschale') return field(t('posNights'), efNum('nights', draft.nights, '1')) + field(t('posNightRate'), efNum('nightRate', draft.nightRate, '0.01'));
      return field(t('fldAmount'), efNum('betrag', draft.betrag, '0.01'));
    }
    function bodyHtml() {
      return '<div class="rk-grid">' +
          field(t('posCategory'), '<select class="qrx-select" data-ef="kind">' + catOptions(draft.kind) + '</select>') +
          field(t('posDesc'), '<input class="qrx-input" data-ef="bez" value="' + esc(draft.bez || '') + '" placeholder="' + esc(t('posDescPh')) + '">') +
          modeSelect() + modeControls() +
        '</div>' +
        (draft.belegName ? '<div class="rk-pos-beleg">' +
          '<span class="rk-pos-beleg-name">📎 ' + esc(t('posReceipt')) + ': ' + esc(draft.belegName) + '</span> ' +
          '<button type="button" class="rk-link-btn" data-view-beleg>' + esc(t('viewReceipt')) + '</button>' +
          '<label class="rk-keep"><input type="checkbox" data-ef="keep"' + (keepWanted ? ' checked' : '') + '><span>' + esc(t('keepReceipt')) + '</span></label>' +
          '<span class="rk-keep-hint">' + esc(t('keepReceiptHint')) + '</span>' +
        '</div>' : '');
    }
    const ov = document.createElement('div');
    ov.className = 'rk-modal-overlay';
    ov.innerHTML = '<div class="rk-modal rk-modal-edit" role="dialog" aria-modal="true">' +
      '<div class="rk-modal-head"><h3>' + esc(t('editPosTitle')) + '</h3>' +
        '<button class="rk-icon-btn rk-modal-x" data-x aria-label="✕">✕</button></div>' +
      '<div class="rk-pos-edit-body"></div>' +
      '<div class="rk-pos-edit-total"><span>' + esc(t('thAmount')) + '</span><span class="rk-pos-edit-amount"></span></div>' +
      '<div class="rk-modal-actions">' +
        '<button class="qrx-btn" data-del>' + esc(t('posDelete')) + '</button>' +
        '<button class="qrx-btn" data-x>' + esc(t('cancel')) + '</button>' +
        '<button class="qrx-btn qrx-btn-primary" data-save>' + esc(t('save')) + '</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    const bodyEl = ov.querySelector('.rk-pos-edit-body');
    const amtEl = ov.querySelector('.rk-pos-edit-amount');
    function render() { bodyEl.innerHTML = bodyHtml(); amtEl.textContent = eur(posAmount(draft)); }
    render();
    ov.addEventListener('input', onEf); ov.addEventListener('change', onEf);
    function onEf(e) {
      const ef = e.target.getAttribute('data-ef');
      if (!ef) return;
      if (ef === 'kind') { setPosKind(draft, e.target.value); render(); }
      else if (ef === 'mode') { draft.mode = e.target.value; ensurePosDefaults(draft); render(); }
      else if (ef === 'bez') draft.bez = e.target.value;
      else if (ef === 'keep') {
        if (e.target.checked) {
          if (sessionFiles.has(draft.belegName) || draft.fileId) keepWanted = true;
          else { // Datei nicht (mehr) im Speicher → einmalig wählen, dann behalten
            e.target.checked = false;
            pickBelegFile(draft.belegName, (f) => { pickedFile = f; keepWanted = true; render(); });
          }
        } else keepWanted = false;
      }
      else { draft[ef] = num(e.target.value); amtEl.textContent = eur(posAmount(draft)); }
    }
    const done = () => { ov.remove(); renderPositions(); renderSummary(); };
    const cancel = () => { if (isNew) state.current.positions.splice(idx, 1); done(); };
    ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', cancel));
    ov.addEventListener('click', (e) => {
      if (e.target === ov) { cancel(); return; }
      if (e.target.closest('[data-view-beleg]') && draft.belegName) viewBeleg(draft);
    });
    ov.querySelector('[data-del]').addEventListener('click', () => {
      if (draft.fileId) store.remove(storedFileKey(draft.fileId));
      state.current.positions.splice(idx, 1); done();
    });
    ov.querySelector('[data-save]').addEventListener('click', async () => {
      await commitKeep();
      state.current.positions[idx] = draft;
      done();
    });
    // „Beleg behalten" umsetzen: Datei speichern bzw. gespeicherte Datei entfernen.
    async function commitKeep() {
      if (!draft.belegName) { if (draft.fileId) { store.remove(storedFileKey(draft.fileId)); delete draft.fileId; } return; }
      if (keepWanted) {
        if (draft.fileId && !pickedFile && store.get(storedFileKey(draft.fileId), null) != null) return; // schon gespeichert
        const file = pickedFile || sessionFiles.get(draft.belegName);
        if (!file) return; // keine Datei verfügbar → nicht als behalten markieren
        const fid = draft.fileId || ('f' + draft.id);
        try {
          const durl = await fileToDataUrl(file);
          if (store.set(storedFileKey(fid), durl)) draft.fileId = fid;
          else { try { alert(t('keepFailed')); } catch (_) {} delete draft.fileId; }
        } catch (_) { try { alert(t('keepFailed')); } catch (_) {} }
      } else if (draft.fileId) {
        store.remove(storedFileKey(draft.fileId)); delete draft.fileId;
      }
    }
  }
  function ensurePosDefaults(p) {
    if (p.mode === 'km') { if (p.ratePerKm == null || p.ratePerKm === '') p.ratePerKm = num(state.settings.kmCar); if (p.km == null) p.km = 0; }
    else if (p.mode === 'pauschale') { if (p.nightRate == null || p.nightRate === '') p.nightRate = nightRate(state.current); if (p.nights == null) p.nights = Math.max(0, tripDays(state.current).length - 1); }
    else if (p.betrag == null) p.betrag = 0;
  }
  function setPosKind(p, kind) {
    p.kind = kind;
    if (kind === 'fahrt') p.mode = (p.mode === 'km' || p.mode === 'betrag') ? p.mode : 'km';
    else if (kind === 'uebernachtung') p.mode = (p.mode === 'pauschale' || p.mode === 'betrag') ? p.mode : 'pauschale';
    else p.mode = 'betrag';
    ensurePosDefaults(p);
  }
  // ---------------------------------------------------------------- Belege
  const RECEIPT_ICON = {
    hotel: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01',
    bahn: 'M4 11h16M6 3h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 20l-2 2M16 20l2 2M8 16h.01M16 16h.01',
    oepnv: 'M4 11h16M6 3h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 20l-2 2M16 20l2 2M8 16h.01M16 16h.01',
    unknown: 'M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM14 4v5h5',
  };
  function typeLabelOf(ty) { return t('type' + ty.charAt(0).toUpperCase() + ty.slice(1)) || t('typeUnknown'); }
  // Position-Art aus Beleg-Typ.
  function kindForType(ty) { return ty === 'hotel' ? 'uebernachtung' : (ty === 'bahn' || ty === 'oepnv') ? 'fahrt' : 'neben'; }
  function catLabel(kind) { return t(kind === 'fahrt' ? 'catFahrt' : kind === 'uebernachtung' ? 'catUeb' : 'catNeben'); }

  // Standard: Beleg-Dateien werden NICHT gespeichert. Aus einem Beleg werden nur der
  // Betrag/die Daten erkannt und der Dateiname als Referenz behalten — das hält den
  // Speicher generell unbelastet (und inline-PDF-Anzeige ist auf Mobilbrowsern ohnehin
  // unzuverlässig).
  //
  // Anzeigen ist trotzdem möglich: importierte Dateien liegen für die Dauer der
  // geöffneten Seite im Arbeitsspeicher (sessionFiles, NICHT persistiert). Ein Klick
  // auf 📎 öffnet die Datei über eine Blob-URL in einem neuen Tab — so übernimmt der
  // Browser/das Betriebssystem die Anzeige (funktioniert mobil, anders als die frühere
  // Inline-Einbettung).
  //
  // Optional kann eine einzelne Position „Beleg behalten": dann wird genau diese Datei
  // in einem eigenen localStorage-Key (reisekosten_file_<fileId>) als data-URL abgelegt
  // und lässt sich auch nach einem Neuladen ohne erneutes Auswählen anzeigen. Nicht
  // behaltene Belege werden nach einem Reload beim ersten Anzeigen einmalig neu gewählt.
  const sessionFiles = new Map();
  const storedFileKey = (id) => KEY_FILE_PREFIX + id;

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('read failed'));
      r.readAsDataURL(file);
    });
  }
  function dataUrlToBlob(dataUrl) {
    const comma = String(dataUrl).indexOf(',');
    const head = String(dataUrl).slice(0, comma);
    const body = String(dataUrl).slice(comma + 1);
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = /;base64/i.test(head) ? atob(body) : decodeURIComponent(body);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function openBelegFile(file) {
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
    } catch (_) { try { alert(t('viewFailed')); } catch (_) {} }
  }
  // Datei einmalig vom Gerät wählen (wenn nicht im Speicher, z. B. nach Reload) und
  // für die Sitzung merken; cb bekommt die gewählte Datei.
  function pickBelegFile(name, cb) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/pdf,image/*';
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.remove();
      if (f) { if (name) sessionFiles.set(name, f); if (cb) cb(f); else openBelegFile(f); }
    });
    document.body.appendChild(inp);
    inp.click();
  }
  // Position anzeigen: 1) im Speicher, 2) behaltene Datei aus localStorage, 3) auswählen.
  function viewBeleg(pos) {
    if (!pos || !pos.belegName) return;
    const mem = sessionFiles.get(pos.belegName);
    if (mem) { openBelegFile(mem); return; }
    if (pos.fileId) {
      const durl = store.get(storedFileKey(pos.fileId), null);
      if (durl) { try { openBelegFile(dataUrlToBlob(durl)); } catch (_) { try { alert(t('viewFailed')); } catch (_) {} } return; }
    }
    pickBelegFile(pos.belegName);
  }

  // Eine oder mehrere Dateien importieren: Text gewinnen (PDF/OCR) → parsen →
  // Auswahl-Panel (je Beleg eine Position + optionale Reise-Vorschläge).
  async function importFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    if (!qrx.rkReceipts) { alert(t('libFailed')); return; }
    const prog = showProgress(t('analysing'));
    const detected = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      prog.set(t('importingN', { i: i + 1, n: files.length }), files.length > 1 ? i / files.length : null);
      try {
        const { text, method } = await qrx.rkReceipts.extractText(file, (p) => {
          prog.set(t('readingOcr', { pct: Math.round((p || 0) * 100) }), p);
        });
        const parsed = qrx.rkReceipts.parseReceipt(text);
        sessionFiles.set(file.name, file);   // nur im Speicher der Seite (nicht persistiert) → Anzeigen möglich
        detected.push({ fileName: file.name, parsed, method, file });
      } catch (e) { console.warn('receipt import failed', file.name, e); }
    }
    prog.close();
    if (!detected.length) { alert(t('nothingDetected')); return; }
    showBatchPanel(detected);
  }

  function receiptPeriod(parsed) {
    if (parsed.type === 'hotel' && parsed.hotel && parsed.hotel.checkIn) return { d0: parsed.hotel.checkIn, d1: parsed.hotel.checkOut || parsed.hotel.checkIn };
    if (parsed.dates && parsed.dates.length) return { d0: parsed.dates[0], d1: parsed.dates[parsed.dates.length - 1] };
    return null;
  }
  function periodText(pr) { return !pr ? t('noPeriod') : (pr.d0 === pr.d1 ? fmtDate(pr.d0) : fmtDate(pr.d0) + ' – ' + fmtDate(pr.d1)); }

  // Aus einem erkannten Beleg eine Kosten-Position bauen. Der Dateiname wird als
  // Referenz behalten, die Datei selbst NICHT gespeichert (Referenz-only).
  function positionFromReceipt(item) {
    const p = item.parsed, kind = kindForType(p.type);
    let bez = p.type === 'hotel' ? t('catUeb') : (p.type === 'bahn' || p.type === 'oepnv') ? typeLabelOf(p.type) : (item.fileName || t('typeUnknown')).replace(/\.[^.]+$/, '');
    if ((p.type === 'bahn' || p.type === 'oepnv') && p.travel && (p.travel.from || p.travel.to)) bez += ' ' + [p.travel.from, p.travel.to].filter(Boolean).join('→');
    const pos = { id: newId(), kind, bez, mode: 'betrag', betrag: p.total != null ? p.total : 0 };
    if (item.fileName) pos.belegName = item.fileName;
    return pos;
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

  // Auswahl-Panel: erkannte Belege als Liste (Häkchen) → je Beleg eine Position;
  // dazu optionale Reise-Vorschläge (Zeitraum/Frühstück). Bei mehreren PDFs mit
  // abweichendem Zeitraum wird das markiert, damit man fremde aussortieren kann.
  function svgIcon(type) {
    return '<svg class="rk-beleg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + (RECEIPT_ICON[type] || RECEIPT_ICON.unknown) + '"/></svg>';
  }
  function showBatchPanel(items) {
    const tp = state.current;
    const ov = document.createElement('div');
    ov.className = 'rk-modal-overlay';

    // Belege (Betrag → Position). Zeitraum je Beleg nur informativ anzeigen.
    const rows = items.map((it, i) => {
      const meta = typeLabelOf(it.parsed.type) + ' · ' + (it.parsed.total != null ? eur(it.parsed.total) : '—') + ' · ' + periodText(receiptPeriod(it.parsed));
      return '<label class="rk-batch-item">' +
        '<input type="checkbox" data-i="' + i + '" checked>' + svgIcon(it.parsed.type) +
        '<div class="rk-batch-main"><span class="rk-batch-name">' + esc(it.fileName) + '</span>' +
          '<span class="rk-batch-meta">' + esc(meta) + '</span></div>' +
        (it.file ? '<button type="button" class="rk-link-btn rk-batch-view" data-vi="' + i + '">' + esc(t('viewReceipt')) + '</button>' : '') +
      '</label>';
    }).join('');

    // Zeitraum-Kandidaten aus den Belegen sammeln (dedupliziert, nach Häufigkeit
    // sortiert). Mehrere übereinstimmende Belege ⇒ wahrscheinlich der echte
    // Reisezeitraum; Ausreißer (z. B. erkanntes Rechnungsdatum) fallen auf.
    const periodMap = new Map();
    items.forEach((it) => {
      const pr = receiptPeriod(it.parsed);
      if (!pr) return;
      const key = pr.d0 + '|' + pr.d1;
      const e = periodMap.get(key) || { d0: pr.d0, d1: pr.d1, count: 0, hotel: false };
      e.count++; if (it.parsed.type === 'hotel') e.hotel = true;
      periodMap.set(key, e);
    });
    const candidates = [...periodMap.values()].sort((a, b) => (b.count - a.count) || (b.hotel - a.hotel) || (a.d0 < b.d0 ? -1 : 1));
    const tripHasPeriod = !!(tp.abreise && tp.rueckkehr);
    // Vorauswahl: Mehrheits-Kandidat (wenn Reise noch keinen Zeitraum hat), sonst „nicht ändern".
    const defaultVal = (!tripHasPeriod && candidates.length) ? (candidates[0].d0 + '|' + candidates[0].d1) : 'keep';

    let periodSection = '';
    if (candidates.length) {
      const opt = (val, label, checked) =>
        '<label class="rk-batch-item rk-batch-radio"><input type="radio" name="rk-period" value="' + esc(val) + '"' + (checked ? ' checked' : '') + '><span>' + label + '</span></label>';
      let opts = candidates.map((c) => {
        const val = c.d0 + '|' + c.d1;
        const label = '<b>' + esc(periodText(c)) + '</b> <span class="rk-batch-meta">· ' + esc(t('periodSource', { n: c.count })) + '</span>';
        return opt(val, label, val === defaultVal);
      }).join('');
      const keepLabel = tripHasPeriod
        ? esc(t('periodKeep')) + ' <span class="rk-batch-meta">(' + esc(fmtDate(tp.abreise) + ' – ' + fmtDate(tp.rueckkehr)) + ')</span>'
        : esc(t('periodKeep'));
      opts += opt('keep', keepLabel, defaultVal === 'keep');
      periodSection = '<div class="rk-batch-sub">' + esc(t('tripPeriodTitle')) + '</div>' + opts;
    }

    const anyBreakfast = items.some((it) => it.parsed.type === 'hotel' && it.parsed.hotel && it.parsed.hotel.breakfast);
    const breakfastSection = anyBreakfast
      ? '<div class="rk-batch-sub">' + esc(t('tripUpdates')) + '</div>' +
        '<label class="rk-batch-item"><input type="checkbox" data-sug="breakfast" checked><span>' + esc(t('suggBreakfast')) + '</span></label>'
      : '';

    ov.innerHTML =
      '<div class="rk-modal rk-modal-cross" role="dialog" aria-modal="true">' +
        '<div class="rk-modal-head"><div><h3>' + esc(items.length > 1 ? t('batchTitle') : t('batchOne')) + '</h3>' +
          '<p class="rk-modal-sub">' + esc(t('batchSub', { n: items.length })) + '</p></div>' +
          '<button class="rk-icon-btn rk-modal-x" data-x aria-label="✕">✕</button></div>' +
        '<div class="rk-batch-list">' + rows + '</div>' + periodSection + breakfastSection +
        '<div class="rk-modal-actions">' +
          '<button class="qrx-btn" data-x>' + esc(t('dismiss')) + '</button>' +
          '<button class="qrx-btn qrx-btn-primary" data-apply>' + esc(t('applyBatch')) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    const close = () => ov.remove();
    ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    // Anzeigen je Beleg (verhindert das Umschalten der Checkbox des umgebenden Labels).
    ov.querySelectorAll('.rk-batch-view').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const it = items[+b.getAttribute('data-vi')];
      if (it && it.file) openBelegFile(it.file);
    }));
    ov.querySelector('[data-apply]').addEventListener('click', () => {
      const checked = [];
      ov.querySelectorAll('input[type="checkbox"][data-i]').forEach((cb) => { if (cb.checked) checked.push(items[+cb.getAttribute('data-i')]); });
      checked.forEach((it) => tp.positions.push(positionFromReceipt(it)));
      // Gewählten Reisezeitraum setzen (überschreibt bewusst, wenn ein Kandidat gewählt wurde).
      const sel = ov.querySelector('input[name="rk-period"]:checked');
      if (sel && sel.value !== 'keep') {
        const parts = sel.value.split('|');
        tp.abreise = parts[0] + 'T08:00';
        tp.rueckkehr = parts[1] + 'T18:00';
      }
      const doBreak = ov.querySelector('input[data-sug="breakfast"]');
      if (doBreak && doBreak.checked && checked.some((it) => it.parsed.type === 'hotel' && it.parsed.hotel && it.parsed.hotel.breakfast)) {
        tripDays(tp).forEach((d) => { if (d.type === 'none' || d.type === 'arrival') return; tp.meals[d.date] = tp.meals[d.date] || {}; tp.meals[d.date].f = true; });
      }
      close();
      renderEdit();
    });
  }

  // Tagesstruktur an neue Daten angleichen (bestehende Auswahl behalten).
  function rebuildDays() {
    const tp = state.current;
    const days = tripDays(tp);
    const validDates = new Set(days.map((d) => d.date));
    // verwaiste Mahlzeiten-Einträge entfernen
    Object.keys(tp.meals).forEach((d) => { if (!validDates.has(d)) delete tp.meals[d]; });
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
            '<tfoot>' + rowFoot(t('sumVerpflegung'), c.verpflegung) + '</tfoot>' +
          '</table>' +
          (tp.positions && tp.positions.length
            ? '<h3 class="rk-report-h3">' + esc(t('reportCosts')) + '</h3>' +
              '<table class="rk-table"><thead><tr><th>' + esc(t('thCat')) + '</th><th>' + esc(t('thDesc')) + '</th>' +
                '<th class="rk-num">' + esc(t('thAmount')) + '</th></tr></thead><tbody>' +
                tp.positions.map((p) => '<tr><td>' + esc(catLabel(p.kind)) + '</td><td>' + esc(p.bez || p.belegName || '–') +
                  '</td><td class="rk-num">' + esc(eur(posAmount(p))) + '</td></tr>').join('') +
              '</tbody></table>'
            : '') +
          '<table class="rk-table rk-report-totals"><tbody>' +
            rowFoot(t('sumVerpflegung'), c.verpflegung) + rowFoot(t('sumFahrt'), c.fahrt) +
            rowFoot(t('sumUebernachtung'), c.uebernachtung) + rowFoot(t('sumNeben'), c.neben) +
            '<tr class="rk-report-grand"><td colspan="3">' + esc(t('sumTotal')) + '</td><td class="rk-num">' + esc(eur(c.total)) + '</td></tr>' +
          '</tbody></table>' +
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
    persistTrips();
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
      const files = eln.files;
      const list = files ? Array.from(files) : [];
      eln.value = '';            // gleiche Datei(en) erneut wählbar machen
      if (list.length) importFiles(list);
      return;
    }
    const settingKey = eln.getAttribute('data-setting');
    if (settingKey) {
      state.settings[settingKey] = eln.type === 'number' ? num(eln.value) : eln.value;
      saveSettings();
      return;
    }
    if (!state.current) return;
    const tp = state.current;

    const f = eln.getAttribute('data-field');
    if (!f) return;
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
      case 'meal': {
        const date = eln.getAttribute('data-date'), meal = eln.getAttribute('data-meal');
        tp.meals[date] = tp.meals[date] || {};
        tp.meals[date][meal] = eln.checked;
        refreshCalc(); break;
      }
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
      case 'add-pos':
        state.current.positions.push(newPosition(target.getAttribute('data-kind'), state.current));
        renderPositions(); renderSummary();
        editPosition(state.current.positions.length - 1, true); break;
      case 'edit-pos': editPosition(+target.getAttribute('data-idx'), false); break;
      case 'view-pos': {
        const pv = state.current.positions[+target.getAttribute('data-idx')];
        if (pv && pv.belegName) viewBeleg(pv);
        break;
      }
      case 'del-pos':
        state.current.positions.splice(+target.getAttribute('data-idx'), 1);
        renderPositions(); renderSummary(); break;
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
    persistTrips();
  }

  // ---------------------------------------------------------------- Sprache
  qrx.i18n.onChange(() => {
    if (state.view === 'list') renderList();
    else if (state.view === 'edit' && state.current) renderEdit();
    else if (state.view === 'settings') renderSettings();
    else if (state.view === 'report' && state.current) renderReport(state.current);
  });

  // ---------------------------------------------------------------- Snapshot
  // "Mit Daten exportieren" serialisiert ALLE reisekosten_*-Keys (Reisen,
  // Einstellungen und die einzelnen Beleg-Dateien); hydrateState schreibt sie
  // zurück und lädt einmal neu.
  window.qurixApp = window.qurixApp || {};
  window.qurixApp.serializeState = function () {
    const data = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(KEY_PREFIX) === 0) { const v = localStorage.getItem(k); if (v != null) data[k] = v; }
      }
    } catch (_) {}
    return data;
  };
  window.qurixApp.hydrateState = function (s) {
    if (!s || typeof s !== 'object') return;
    let changed = false;
    Object.keys(s).forEach((k) => {
      if (k.indexOf(KEY_PREFIX) !== 0) return;
      if (store.get(k) !== s[k]) { store.set(k, s[k]); changed = true; }
    });
    if (changed) location.reload();
  };

  // localStorage nutzbar? (privater Modus / deaktivierte Website-Daten blockieren es)
  function storageWorks() {
    try { const k = KEY_PREFIX + 'probe'; localStorage.setItem(k, '1'); const ok = localStorage.getItem(k) === '1'; localStorage.removeItem(k); return ok; }
    catch (_) { return false; }
  }

  // ---------------------------------------------------------------- Init
  load();
  if (!storageWorks()) { try { alert(t('storageBlocked')); } catch (_) {} }
  renderSettings();
  renderList();
  showView('list');

  const rkRoot = document.querySelector('.rk');
  document.querySelector('.rk-nav-new').addEventListener('click', newTrip);
  document.querySelector('.rk-nav-settings').addEventListener('click', () => { renderSettings(); showView('settings'); });
  rkRoot.addEventListener('input', onInput);
  rkRoot.addEventListener('change', onInput);
  rkRoot.addEventListener('click', onClick);

  // Drag & Drop für den Beleg-Import (delegiert, übersteht Re-Renders).
  rkRoot.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dz = e.target.closest && e.target.closest('.rk-dropzone');
    if (dz) dz.classList.add('rk-drag');
  });
  rkRoot.addEventListener('dragleave', (e) => {
    const dz = e.target.closest && e.target.closest('.rk-dropzone');
    if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('rk-drag');
  });
  rkRoot.addEventListener('drop', (e) => {
    e.preventDefault();
    const dz = e.target.closest && e.target.closest('.rk-dropzone');
    if (dz) dz.classList.remove('rk-drag');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (dz && files && files.length) importFiles(files);
  });
})();
