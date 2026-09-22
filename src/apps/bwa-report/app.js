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
      dropTitle: 'BWA-PDFs hierher ziehen oder klicken', dropAria: 'BWA-PDFs importieren',
      dropSub: 'Mehrere Monats-BWAs möglich — für den Verlauf. Nichts verlässt den Browser.',
      newImport: 'Zurücksetzen', addBwa: 'BWA hinzufügen', print: 'Als PDF / Drucken',
      parsing: 'Lese BWA…', parsingN: 'Lese {n} BWA-Datei(en)…', notBwa: 'Bitte eine PDF-Datei auswählen.',
      importedWithErrors: '{n} BWA importiert, {e} übersprungen (keine gültige BWA).',
      notBwaMsg: 'In der PDF wurde keine „Kurzfristige Erfolgsrechnung“ gefunden. Ist das eine DATEV-BWA?',
      parseError: 'Fehler beim Lesen: {msg}',
      secTrend: 'Entwicklung', trUmsatzErgebnis: 'Umsatz & Betriebsergebnis pro Monat',
      trLiquiditaet: 'Liquide Mittel je Monatsende', thMonat: 'Monat',
      companyLabel: 'Firma:', removePeriod: 'Monat entfernen', unknownCompany: 'Unbekannt',
      needMorePeriods: 'Weitere Monats-BWAs importieren, um den Verlauf zu sehen.',
      trKostenmix: 'Kostenmix pro Monat', days: '{n} Tage', wfLeistung: 'Leistung',
      secRisk: 'Kunden- & Lieferantenstruktur', secCustomers: 'Kundenstruktur', secSuppliers: 'Lieferantenstruktur',
      secCustRevenue: 'Umsatz je Kunde', thKunde: 'Kunde',
      crAnfang: 'Anfangssaldo (Vorjahr)', crFakturiert: 'Fakturiert (kum.)', crVereinnahmt: 'Vereinnahmt (kum.)', crOffen: 'Offen',
      crIntro: 'Verteilung des fakturierten Umsatzes auf die größten Kunden — zeigt die Abhängigkeit auf der Umsatzseite (ergänzend zum Forderungsrisiko).',
      crNote: 'Bruttowerte inkl. Umsatzsteuer aus den Debitoren-Bewegungen der Summen & Salden. „Fakturiert“ = in diesem Jahr in Rechnung gestellt, „Vereinnahmt“ = Zahlungseingänge dieses Jahres (auch auf Vorjahresrechnungen). „Offen“ ist der aktuelle Saldo = Anfangssaldo + Fakturiert − Vereinnahmt (enthält also Vorjahres-Offenposten); deshalb kann Vereinnahmt größer als Fakturiert sein. Sammelkonten „DIVERSE“ bündeln mehrere kleine Kunden. Nur verfügbar, wenn die BWA die Bewegungsspalten enthält.',
      tabOverview: 'Überblick', tabRevenue: 'Einnahmen', tabCosts: 'Ausgaben / Kosten', tabTaxes: 'Steuern', tabLiquidity: 'Liquidität',
      riskIntro: 'Verteilung der offenen Forderungen und Verbindlichkeiten — eine hohe Konzentration auf wenige Namen ist ein Risiko.',
      kDso: 'Forderungslaufzeit (DSO)', kDpo: 'Zahlungsziel Lieferanten (DPO)',
      breakEvenTitle: 'Break-even (Gewinnschwelle)',
      breakEvenLine: 'Geschätzte Gewinnschwelle bei rund {be} Umsatz (≈ {beM}/Monat). Aktuell liegst du {safety} darüber (Sicherheitsabstand).',
      breakEvenCaveat: 'Grobe Schätzung: Fixkosten (u. a. Personal, Raum) vs. variable Kosten; die Trennung ist vereinfachend.',
      concCustomers: 'Größte Kunden (Forderungen)', concSuppliers: 'Größte Lieferanten (Verbindlichkeiten)',
      concTop: 'Top-Position {share} · {n} Konten', expenseDrill: 'Größte Einzel-Aufwandskonten',
      'rec.concentration': 'Klumpenrisiko: {share} der offenen Forderungen entfallen auf „{name}“. Ein Ausfall würde stark treffen — Abhängigkeit streuen, Bonität im Blick behalten.',
      'rec.breakeven': 'Der Abstand zur Gewinnschwelle (~{be}) ist mit {safety} knapp. Auslastung/Preise sichern und Fixkosten im Blick behalten.',
      'def.dso': 'Forderungslaufzeit: Wie viele Tage es im Schnitt dauert, bis Kunden zahlen (Forderungen ÷ Umsatz × Tage). Kürzer ist besser.',
      'def.dpo': 'Zahlungsziel gegenüber Lieferanten in Tagen (offene Verbindlichkeiten ÷ Kosten × Tage).',
      'def.breakeven': 'Umsatz, ab dem die Kosten gedeckt sind. Der Sicherheitsabstand zeigt, wie weit du darüber liegst. Grobe Schätzung.',
      'def.expenseDrill': 'Die betragsmäßig größten einzelnen Aufwandskonten aus den Summen & Salden — oft steckt hier der Großteil der „Sonstigen Kosten“.',
      secCockpit: 'Cockpit', gaugeSafety: 'Sicherheitsabstand', gaugeCluster: 'Klumpenrisiko (Top-Kunde)', gaugeTaxCov: 'Ertragsteuer-Deckung', gaugeNoTaxDue: 'keine fällig',
      'def.marge': 'Umsatzrendite = Betriebsergebnis ÷ Umsatz. Wie viel von jedem Euro Umsatz als Ergebnis übrig bleibt.',
      'def.cluster': 'Anteil des größten Kunden an den offenen Forderungen. Hoch = starke Abhängigkeit von einem Kunden (Risiko).',
      'def.taxcov': 'Nur Ertragsteuer (Körperschaft-/Gewerbesteuer): Wie weit die Steuerrückstellungen die überschlägig erwartete Ertragsteuer decken (Verlustvorträge berücksichtigt). Sagt nichts über Umsatzsteuer-Zahllasten aus — dafür die Netto-Steuerposition. Grobe Orientierung.',
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
      // run-rate & tax check
      runRateTitle: 'Hochrechnung aufs Jahr:',
      runRateLine: 'Auf Basis von {months} Monaten linear hochgerechnet ergäbe das rund {u} Umsatz und {e} Ergebnis pro Jahr.',
      taxCheckCaveat: 'Grobe Orientierung; Gewerbesteuer-Hebesatz, Verlustvorträge und Abgrenzungen verändern den Betrag deutlich. Keine Steuerberatung.',
      // Taxes & reserves section
      secTaxes: 'Steuern & Rücklagen',
      liqBindTitle: 'Vorzuhaltende vs. frei verfügbare Liquidität',
      liqUst: 'Umsatzsteuer-Zahllast', liqWage: 'Lohnsteuer & Sozialabgaben', liqRes: 'Steuerrückstellungen',
      liqBound: 'Vorzuhalten (Summe)', liqFree: 'Frei verfügbar', liqFreeSub: '{p} der liquiden Mittel',
      liqUstBreak: 'USt-Zahllast = vereinnahmte Umsatzsteuer {output} − abziehbare Vorsteuer {vorsteuer} − geleistete Vorauszahlungen {prepaid}.',
      liqRefundNote: 'Zusätzlich bestehen Steuer-Erstattungsansprüche von {amount} (voraussichtlicher Mittelzufluss, hier nicht gegengerechnet).',
      'def.bound': 'Teil der liquiden Mittel, der bereits verplant ist: Umsatzsteuer (durchlaufendes Fremdgeld), abzuführende Lohnsteuer/Sozialabgaben und gebildete Steuerrückstellungen. Nur der Rest ist frei verfügbar.',
      ntRefunds: 'Steuer-Erstattungsansprüche', ntPayrollHint: 'Teil der Personalkosten',
      ntOutflow: 'Netto-Abfluss (Steuern & Fremdgeld)', ntOutflowSub: 'nach Verrechnung der Erstattungen', ntInflowSub: 'netto Zufluss nach Erstattungen',
      'def.ntoutflow': 'Was nach Verrechnung der Erstattungsansprüche tatsächlich abfließt: durchlaufende Posten (Umsatzsteuer, Lohnsteuer/Sozialabgaben) plus eigene Ertragsteuer minus Erstattungen. Als Liquiditätspuffer bereithalten.',
      ptTitle: 'Vorzuhalten nach Art', ptPassThrough: 'Durchlaufende Posten (Fremdgeld)', ptOwnTax: 'Eigene Ertragsteuer (netto)',
      ptSumPass: 'Summe Fremdgeld', ptOwnNet: 'Eigene Ertragsteuer netto', ptTotal: 'Netto-Abfluss gesamt',
      ptNote: 'Umsatzsteuer (Geld der Kunden) und Lohnsteuer/Sozialabgaben (aus den Löhnen einbehalten — Teil der Personalkosten) sind durchlaufende Posten: Sie werden nur ans Finanzamt bzw. an die Sozialkassen weitergeleitet.',
      ptVerdictOwed: 'Nach Verrechnung der Erstattungen fließen netto rund {amount} ab. Diesen Betrag als Liquiditätspuffer bereithalten.',
      ptVerdictCredit: 'Nach Verrechnung ergibt sich unterm Strich ein Zufluss von rund {amount}.',
      ptReconcile: 'Abgleich mit dem Steuerberater — nur Finanzamt (Umsatzsteuer + Ertragsteuer, ohne Lohnsteuer/Sozialabgaben): {amount}.',
      'def.ust': 'Aus den USt-Konten der Summen & Salden: vereinnahmte Umsatzsteuer minus abziehbare Vorsteuer minus bereits geleistete Vorauszahlungen ergibt die offene Zahllast. Grobe Orientierung, keine USt-Voranmeldung.',
      'def.freeliq': 'Anteil der liquiden Mittel, der nach Abzug von Steuer- und Fremdgeld (Umsatzsteuer, Lohnsteuer/Sozialabgaben, Steuerrückstellungen) frei verfügbar bleibt.',
      etTitle: 'Ertragsteuer — Prognose & Deckung',
      etErgebnis: 'Ergebnis vor Steuern', etLoss: 'Verlustvortrag (verrechenbar)',
      etTaxable: 'Zu versteuern (nach Verlustvortrag)', etExpected: 'Erwartete Ertragsteuer (~{rate})',
      etReserved: 'Bereits zurückgestellt',
      etVerdictShield: 'Dank des Verlustvortrags ({loss}) ist aktuell voraussichtlich keine Ertragsteuer-Nachzahlung zu erwarten.',
      etVerdictGap: 'Mögliche Nachzahlung: Die erwartete Ertragsteuer übersteigt die Rückstellungen um rund {gap}. Rücklage entsprechend erhöhen.',
      etVerdictCovered: 'Die gebildeten Rückstellungen decken die überschlägig erwartete Ertragsteuer.',
      etVerdictNoSusa: 'Überschlägig wären rund {expected} Ertragsteuer zurückzustellen (ohne Summen & Salden nicht mit den Rückstellungen abgeglichen).',
      etRefund: 'Es bestehen Steuer-Erstattungsansprüche von {amount} (z. B. KSt-/GewSt-Überzahlungen) — voraussichtlicher Mittelzufluss.',
      vpTitle: 'Verprobung (grobe Orientierung)',
      vpUst: 'Umsatzsteuer aus Verkäufen: {booked} gebucht. Bei 19 % auf den Umsatz wären es rechnerisch {exp} — die Quote von {q} ist plausibel, sofern steuerfreie oder EU-Umsätze enthalten sind.',
      vpVst: 'Vorsteuer aus Aufwand: {vst} gezogen — rund {q} des vorsteuerfähigen Aufwands ({base}). Ein Wert deutlich über 19 % wäre auffällig.',
      vpCaveat: 'Grobe Verprobung aus den BWA-Salden — ersetzt keine Umsatzsteuer-Voranmeldung oder Prüfung. Steuersätze, steuerfreie Umsätze und Abgrenzungen verschieben die Werte.',
      'def.verprobung': 'Einfache Gegenrechnung: Passt die gebuchte Umsatzsteuer zu 19 % des Umsatzes und die Vorsteuer zum steuerpflichtigen Aufwand? Grobe Orientierung, keine Prüfung.',
      gaugeFreeLiq: 'Freie Liquidität',
      'rec.bound': 'Von den liquiden Mitteln sind rund {bound} als Steuer- und Fremdgeld gebunden (Umsatzsteuer, Lohnsteuer/Sozialabgaben, Steuerrückstellungen) — nur etwa {free} sind frei verfügbar. Diesen Puffer nicht verplanen.',
      'rec.boundNet': 'Von den liquiden Mitteln sind rund {bound} brutto für Steuern und Fremdgeld reserviert (Umsatzsteuer, Lohnsteuer/Sozialabgaben, Steuerrückstellungen). Dem stehen {refunds} Steuer-Erstattungsansprüche gegenüber, sodass der Netto-Abfluss bei etwa {net} liegt. Diesen Betrag als Puffer bereithalten und nicht verplanen — die Erstattungen kommen zeitversetzt.',
      'rec.taxgap': 'Für die Ertragsteuer zeichnet sich eine Deckungslücke von rund {gap} ab (erwartete Steuer über den Rückstellungen). Rücklage erhöhen.',
      // glossary (tooltips)
      'def.umsatz': 'Erlöse aus der eigentlichen Geschäftstätigkeit (ohne Umsatzsteuer). „Kumuliert“ = seit Jahresbeginn.',
      'def.betriebsergebnis': 'Ergebnis aus dem eigentlichen Geschäft: Leistung minus Kosten — vor neutralen Posten (z. B. Zinsen) und Steuern.',
      'def.ergebnis': 'Vorläufiges Gesamtergebnis der Periode nach neutralen Posten, vor Abschlussbuchungen. Kann sich noch ändern.',
      'def.liquide': 'Sofort verfügbares Geld: Bankguthaben und Kasse.',
      'def.nettoLiq': 'Liquide Mittel + offene Forderungen − kurzfristige Verbindlichkeiten. Grober Puffer, der kurzfristig zur Verfügung steht.',
      'def.forderungen': 'Geld, das Kunden dir noch schulden (offene Rechnungen).',
      'def.verbindl': 'Kurzfristig fällige Verbindlichkeiten: Lieferanten, Kreditkarte, Löhne/Sozialabgaben.',
      'def.rueckstellungen': 'Zurückgestellte Beträge für später anfallende Ausgaben (z. B. Steuern, Abschlusskosten).',
      'def.runway': 'Stresstest: So viele Monate würden die liquiden Mittel die laufenden Kosten decken, falls kein Umsatz mehr käme.',
      'def.runrate': 'Lineare Hochrechnung der bisherigen Monate auf zwölf Monate. Keine Prognose — ignoriert Saisonalität.',
      'def.steuercheck': 'Grobe Orientierung, ob genug für die Ertragsteuern zurückgelegt ist. Ersetzt keine Steuerberechnung.',
      // details
      detKer: 'Kurzfristige Erfolgsrechnung (GuV)', detExpense: 'Größte Aufwandskonten (kumuliert)',
      thLabel: 'Bezeichnung', thMonth: 'Monat', thYtd: 'kumuliert', thPct: '% Umsatz', thAccount: 'Konto', thAmount: 'Betrag',
      noSusa: 'Diese BWA enthält keine „Summen & Salden“-Blätter — die Liquiditätsanalyse benötigt sie. Ertrag und Kosten werden dennoch ausgewertet.',
      disclaimer: 'Vorläufige Auswertung auf Basis der importierten BWA · {company} · erstellt am {today} · Alle Berechnungen erfolgen lokal im Browser. Keine Steuer- oder Rechtsberatung.',
    },
    en: {
      intro: 'Import a DATEV BWA as a PDF and get a report anyone can understand, with the key figures — result, cost structure and liquidity — including a rating and recommendations. Everything runs locally in the browser; nothing is uploaded.',
      dropTitle: 'Drop BWA PDFs here, or click', dropAria: 'Import BWA PDFs',
      dropSub: 'Several monthly BWAs are possible — for the trend. Nothing leaves the browser.',
      newImport: 'Reset', addBwa: 'Add BWA', print: 'Save as PDF / print',
      parsing: 'Reading BWA…', parsingN: 'Reading {n} BWA file(s)…', notBwa: 'Please pick a PDF file.',
      importedWithErrors: '{n} BWA imported, {e} skipped (not a valid BWA).',
      notBwaMsg: 'No “Kurzfristige Erfolgsrechnung” was found in the PDF. Is this a DATEV BWA?',
      parseError: 'Read error: {msg}',
      secTrend: 'Trend', trUmsatzErgebnis: 'Revenue & operating result per month',
      trLiquiditaet: 'Cash at each month-end', thMonat: 'Month',
      companyLabel: 'Company:', removePeriod: 'Remove month', unknownCompany: 'Unknown',
      needMorePeriods: 'Import more monthly BWAs to see the trend.',
      trKostenmix: 'Cost mix per month', days: '{n} days', wfLeistung: 'Output',
      secRisk: 'Customer & supplier structure', secCustomers: 'Customer structure', secSuppliers: 'Supplier structure',
      secCustRevenue: 'Revenue per customer', thKunde: 'Customer',
      crAnfang: 'Opening balance (prior year)', crFakturiert: 'Invoiced (YTD)', crVereinnahmt: 'Collected (YTD)', crOffen: 'Open',
      crIntro: 'Distribution of invoiced turnover across the largest customers — shows dependency on the revenue side (complementing the receivables risk).',
      crNote: 'Gross values incl. VAT from the debtor movements of the trial balance. “Invoiced” = billed this year, “Collected” = payments received this year (also on prior-year invoices). “Open” is the current balance = opening balance + invoiced − collected (so it includes prior-year open items); this is why collected can exceed invoiced. Collective accounts “DIVERSE” bundle several small customers. Only available when the BWA contains the movement columns.',
      tabOverview: 'Overview', tabRevenue: 'Revenue', tabCosts: 'Expenses / costs', tabTaxes: 'Taxes', tabLiquidity: 'Liquidity',
      riskIntro: 'Distribution of open receivables and payables — high concentration on a few names is a risk.',
      kDso: 'Receivable days (DSO)', kDpo: 'Payable days (DPO)',
      breakEvenTitle: 'Break-even',
      breakEvenLine: 'Estimated break-even at about {be} revenue (≈ {beM}/month). You are currently {safety} above it (safety margin).',
      breakEvenCaveat: 'Rough estimate: fixed costs (e.g. personnel, rent) vs. variable costs; the split is simplified.',
      concCustomers: 'Largest customers (receivables)', concSuppliers: 'Largest suppliers (payables)',
      concTop: 'Top item {share} · {n} accounts', expenseDrill: 'Largest single expense accounts',
      'rec.concentration': 'Concentration risk: {share} of open receivables are on “{name}”. A default would hit hard — spread the dependency and watch creditworthiness.',
      'rec.breakeven': 'The distance to break-even (~{be}) is tight at {safety}. Secure utilisation/pricing and watch fixed costs.',
      'def.dso': 'Receivable days: how many days on average until customers pay (receivables ÷ revenue × days). Shorter is better.',
      'def.dpo': 'Payment terms towards suppliers in days (open payables ÷ costs × days).',
      'def.breakeven': 'The revenue at which costs are covered. The safety margin shows how far above it you are. Rough estimate.',
      'def.expenseDrill': 'The largest individual expense accounts from the trial balance — often the bulk of “other costs” sits here.',
      secCockpit: 'Cockpit', gaugeSafety: 'Safety margin', gaugeCluster: 'Concentration (top customer)', gaugeTaxCov: 'Income-tax coverage', gaugeNoTaxDue: 'none due',
      'def.marge': 'Operating margin = operating result ÷ revenue. How much of each euro of revenue remains as result.',
      'def.cluster': 'Share of the largest customer in open receivables. High = strong dependence on one customer (risk).',
      'def.taxcov': 'Income tax only (corporate/trade tax): how far the tax provisions cover the roughly expected income tax (loss carry-forwards considered). Says nothing about VAT liabilities — see the net tax position for that. Rough orientation.',
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
      runRateTitle: 'Year projection:',
      runRateLine: 'Extrapolated linearly from {months} months, that is roughly {u} revenue and {e} result per year.',
      taxCheckCaveat: 'Rough orientation; the trade-tax multiplier, loss carry-forwards and accruals change the amount considerably. Not tax advice.',
      secTaxes: 'Taxes & reserves',
      liqBindTitle: 'Reserved vs. freely usable liquidity',
      liqUst: 'VAT liability', liqWage: 'Wage tax & social security', liqRes: 'Tax provisions',
      liqBound: 'To keep aside (total)', liqFree: 'Freely usable', liqFreeSub: '{p} of cash',
      liqUstBreak: 'VAT liability = output VAT collected {output} − deductible input VAT {vorsteuer} − advance payments made {prepaid}.',
      liqRefundNote: 'In addition, tax refund claims of {amount} exist (expected cash inflow, not netted here).',
      'def.bound': 'The part of the cash that is already committed: VAT (pass-through money), wage tax/social security to be remitted, and tax provisions. Only the rest is freely usable.',
      ntRefunds: 'Tax refund claims', ntPayrollHint: 'part of personnel costs',
      ntOutflow: 'Net outflow (taxes & pass-through)', ntOutflowSub: 'after offsetting refunds', ntInflowSub: 'net inflow after refunds',
      'def.ntoutflow': 'What actually flows out after offsetting the refund claims: pass-through money (VAT, wage tax/social security) plus the own income tax minus refunds. Keep it as a liquidity buffer.',
      ptTitle: 'What to keep aside, by type', ptPassThrough: 'Pass-through money', ptOwnTax: 'Own income tax (net)',
      ptSumPass: 'Total pass-through', ptOwnNet: 'Own income tax, net', ptTotal: 'Total net outflow',
      ptNote: 'VAT (customers’ money) and wage tax/social security (withheld from wages — part of personnel costs) are pass-through items: they are merely forwarded to the tax office or the social-security funds.',
      ptVerdictOwed: 'After offsetting the refunds, roughly {amount} flows out net. Keep that amount as a liquidity buffer.',
      ptVerdictCredit: 'After offsetting, there is a net inflow of about {amount} on balance.',
      ptReconcile: 'Reconciliation with the tax advisor — tax office only (VAT + income tax, excluding wage tax/social security): {amount}.',
      'def.ust': 'From the VAT accounts of the trial balance: output VAT collected minus deductible input VAT minus advance payments already made gives the open liability. Rough orientation, not a VAT return.',
      'def.freeliq': 'Share of cash that remains freely usable after deducting tax and pass-through money (VAT, wage tax/social security, tax provisions).',
      etTitle: 'Income tax — outlook & coverage',
      etErgebnis: 'Result before taxes', etLoss: 'Loss carry-forward (usable)',
      etTaxable: 'Taxable (after loss carry-forward)', etExpected: 'Expected income tax (~{rate})',
      etReserved: 'Already provisioned',
      etVerdictShield: 'Thanks to the loss carry-forward ({loss}), no income-tax back-payment is expected at present.',
      etVerdictGap: 'Possible back-payment: the expected income tax exceeds the provisions by about {gap}. Increase the reserve accordingly.',
      etVerdictCovered: 'The provisions made cover the roughly expected income tax.',
      etVerdictNoSusa: 'Roughly {expected} income tax should be reserved (without the trial balance, not reconciled against provisions).',
      etRefund: 'Tax refund claims of {amount} exist (e.g. corporate/trade tax overpayments) — expected cash inflow.',
      vpTitle: 'Plausibility check (rough orientation)',
      vpUst: 'Output VAT on sales: {booked} booked. At 19 % of revenue that would be about {exp} — the ratio of {q} is plausible if tax-free or EU sales are included.',
      vpVst: 'Input VAT on expenses: {vst} claimed — about {q} of the VAT-eligible expense ({base}). A value well above 19 % would be notable.',
      vpCaveat: 'Rough check from the BWA balances — not a VAT return or audit. Tax rates, tax-free sales and accruals shift the figures.',
      'def.verprobung': 'A simple counter-check: does the booked output VAT match 19 % of revenue, and the input VAT the taxable expense? Rough orientation, not an audit.',
      gaugeFreeLiq: 'Free liquidity',
      'rec.bound': 'About {bound} of the cash is tied up as tax and pass-through money (VAT, wage tax/social security, tax provisions) — only about {free} is freely usable. Do not spend this buffer.',
      'rec.boundNet': 'About {bound} gross of the cash is reserved for taxes and pass-through money (VAT, wage tax/social security, tax provisions). Against this stand {refunds} in tax refund claims, so the net outflow is roughly {net}. Keep that amount as a buffer and do not spend it — the refunds arrive with a delay.',
      'rec.taxgap': 'A coverage gap of about {gap} is emerging for income tax (expected tax above provisions). Increase the reserve.',
      'def.umsatz': 'Revenue from the core business (excl. VAT). “YTD” = since the start of the year.',
      'def.betriebsergebnis': 'Result from the core business: output minus costs — before neutral items (e.g. interest) and taxes.',
      'def.ergebnis': 'Preliminary overall result after neutral items, before year-end entries. May still change.',
      'def.liquide': 'Immediately available money: bank balances and cash.',
      'def.nettoLiq': 'Cash + open receivables − short-term liabilities. A rough buffer available at short notice.',
      'def.forderungen': 'Money customers still owe you (open invoices).',
      'def.verbindl': 'Short-term liabilities due soon: suppliers, credit card, wages/social security.',
      'def.rueckstellungen': 'Amounts reserved for future expenses (e.g. taxes, year-end costs).',
      'def.runway': 'Stress test: how many months cash would cover the running costs if no more revenue came in.',
      'def.runrate': 'Linear extrapolation of the months so far to twelve months. Not a forecast — ignores seasonality.',
      'def.steuercheck': 'A rough orientation whether enough is set aside for income taxes. Not a tax calculation.',
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
      // Ordered value tokens (numbers + S/H side letters) with x-position.
      const seq = [];
      for (const it of l.items.filter((i) => i.x > 150)) {
        for (const part of it.s.trim().split(/\s+/)) {
          if (part === 'S' || part === 'H') seq.push({ x: it.x, t: 's', v: part });
          else if (isNum(part)) seq.push({ x: it.x, t: 'n', v: num(part) });
        }
      }
      // One entry per numeric column, with the side letter that immediately follows it.
      const cols = [];
      for (let i = 0; i < seq.length; i++) {
        if (seq[i].t !== 'n') continue;
        cols.push({ x: seq[i].x, v: seq[i].v, side: (seq[i + 1] && seq[i + 1].t === 's') ? seq[i + 1].v : null });
      }
      if (!cols.length) continue;
      const last = cols[cols.length - 1];
      accounts.push({ no: Number(m[1]), label: m[2].trim(), saldoAbs: last.v, side: last.side, cols });
    }
    return accounts;
  }
  // Per-customer/-supplier turnover from the trial-balance movement columns
  // (cumulative Soll = invoiced, Haben = collected). Only attached when the
  // columns exist and the double-entry identity EB + Soll − Haben = Saldo holds
  // broadly — otherwise left off, so a BWA without movement columns just keeps
  // the closing balances. Mutates the accounts (adds .soll / .haben).
  function analyzeTurnover(accounts) {
    const personal = accounts.filter((a) => a.no >= 10000 && a.no <= 99999 && a.cols && a.cols.length);
    if (personal.length < 3) return;
    const xs = [];
    personal.forEach((a) => a.cols.forEach((c) => xs.push(c.x)));
    xs.sort((p, q) => p - q);
    const centers = []; let cur = [xs[0]];
    for (let i = 1; i < xs.length; i++) { if (xs[i] - xs[i - 1] > 18) { centers.push(avg(cur)); cur = []; } cur.push(xs[i]); }
    centers.push(avg(cur));
    if (centers.length < 3) return;                       // need Soll, Haben, Saldo at least
    const colOf = (x) => { let best = 0, bd = Infinity; centers.forEach((c, i) => { const d = Math.abs(c - x); if (d < bd) { bd = d; best = i; } }); return best; };
    const withSide = centers.map(() => 0), noSide = centers.map(() => 0);
    personal.forEach((a) => a.cols.forEach((c) => { const ci = colOf(c.x); if (c.side) withSide[ci]++; else noSide[ci]++; }));
    // Balance columns (EB, Saldo) carry S/H side letters; movement columns (Soll/
    // Haben) never do. Zero balances print without a side, so use a fraction, not
    // a majority, to separate them.
    const isBalance = centers.map((_, i) => (withSide[i] + noSide[i]) > 0 && withSide[i] / (withSide[i] + noSide[i]) >= 0.15);
    let ebCol = -1, saldoCol = -1;
    centers.forEach((_, i) => { if (isBalance[i]) { if (ebCol < 0) ebCol = i; saldoCol = i; } });
    if (saldoCol < 0) return;
    const moveCols = [];
    for (let i = 0; i < saldoCol; i++) if (!isBalance[i]) moveCols.push(i);
    if (moveCols.length < 2) return;
    const kumSollCol = moveCols[moveCols.length - 2], kumHabenCol = moveCols[moveCols.length - 1];
    const readCol = (a, ci) => a.cols.find((c) => colOf(c.x) === ci) || null;
    const signed = (c) => c ? (c.side === 'H' ? -c.v : c.v) : 0;   // debit-positive
    let ok = 0, tot = 0; const rows = [];
    for (const a of personal) {
      const sC = readCol(a, kumSollCol), hC = readCol(a, kumHabenCol), sal = readCol(a, saldoCol);
      const eb = ebCol !== saldoCol ? readCol(a, ebCol) : null;
      const soll = sC ? sC.v : 0, haben = hC ? hC.v : 0, ebS = signed(eb);
      const good = Math.abs(ebS + soll - haben - signed(sal)) < 0.02;
      rows.push({ a, soll, haben, ebS, good }); tot++; if (good) ok++;
    }
    if (!tot || ok / tot < 0.8) return;                   // columns not as assumed → stay safe
    rows.forEach((r) => { if (r.soll > 0 || r.haben > 0) { r.a.soll = r.soll; r.a.haben = r.haben; r.a.eb = r.ebS; } });
  }
  // Largest customers by invoiced turnover (with collected + open), if available.
  function customerRevenue(parsed) {
    const list = (parsed.susa || []).filter((a) => a.no >= 10000 && a.no <= 69999 && a.soll != null && a.soll > 0)
      .map((a) => ({ no: a.no, label: a.label, anfang: a.eb || 0, fakturiert: a.soll, vereinnahmt: a.haben || 0,
        offen: a.side === 'S' ? a.saldoAbs : (a.side === 'H' ? -a.saldoAbs : 0) }))
      .sort((x, y) => y.fakturiert - x.fakturiert);
    return list.length ? list : null;
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
    const susa = parseSusa(susaPages);
    analyzeTurnover(susa);
    return { meta: meta(pages), ker: parseKer(kerPage), susa, hasSusa: susaPages.length > 0 };
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
      personalMonth: v('personalkosten', 'month'), personalYtd: v('personalkosten', 'ytd'),
      sonstigeMonth: v('sonstigeKosten', 'month'), sonstigeYtd: v('sonstigeKosten', 'ytd'), months,
    };
    o.umsatzrenditeYtd = o.umsatzYtd ? o.betriebsergebnisYtd / o.umsatzYtd : 0;
    o.personalquoteYtd = o.gesamtleistungYtd ? o.personalYtd / o.gesamtleistungYtd : 0;
    o.avgMonthlyUmsatz = o.umsatzYtd / months;
    o.avgMonthlyKosten = o.gesamtkostenYtd / months;
    o.umsatzTrend = o.avgMonthlyUmsatz ? (o.umsatzMonth - o.avgMonthlyUmsatz) / o.avgMonthlyUmsatz : 0;
    o.costStructure = COST_KEYS.map((id) => ({ id, label: k[id] && k[id].label, ytd: v(id, 'ytd') }))
      .filter((c) => c.ytd > 0).sort((x, y) => y.ytd - x.ytd);
    // Break-even: rough fixed/variable split of the cost blocks.
    const FIXED = ['personalkosten', 'raumkosten', 'versicherungen', 'betrSteuern', 'abschreibungen', 'reparatur', 'besondereKosten'];
    const fixedYtd = FIXED.reduce((s, id) => s + v(id, 'ytd'), 0);
    const variableYtd = Math.max(0, o.gesamtkostenYtd - fixedYtd);
    const cmRatio = o.umsatzYtd > 0 ? (o.umsatzYtd - variableYtd) / o.umsatzYtd : 0;
    o.breakEven = { fixedYtd, variableYtd, cmRatio, umsatz: cmRatio > 0 ? fixedYtd / cmRatio : null };
    o.breakEven.safety = (o.breakEven.umsatz != null && o.umsatzYtd > 0) ? (o.umsatzYtd - o.breakEven.umsatz) / o.umsatzYtd : null;
    // Linear year projection (run-rate) from the year-to-date figures.
    o.runRateUmsatz = (o.umsatzYtd / months) * 12;
    o.runRateErgebnis = (o.ergebnisYtd / months) * 12;
    o.ergebnisVorSteuernYtd = v('ergebnisVorSteuern', 'ytd') || o.betriebsergebnisYtd;
    // Rough income-tax orientation for corporations (GmbH/UG/AG). Loss carry-
    // forwards (868) can reduce/remove it, so it is shown as orientation only.
    o.taxProvisions = a.length ? bucket(a, 955, 969, false) : 0;
    const vv = a.find((x) => x.no === 868);
    o.lossCarry = vv && vv.side === 'S' ? vv.saldoAbs : 0;
    const isKapGes = /gmbh|mbh|\bag\b|\bug\b|\bse\b/i.test(parsed.meta.company || '');
    if (isKapGes && o.ergebnisVorSteuernYtd > 0) {
      // loss carry-forwards (868) shield the current profit → taxable base after offset
      const taxable = Math.max(0, o.ergebnisVorSteuernYtd - o.lossCarry), expAdj = taxable * 0.30;
      o.taxCheck = { rate: 0.30, base: o.ergebnisVorSteuernYtd, expected: o.ergebnisVorSteuernYtd * 0.30,
        taxable, expectedAdj: expAdj, reserved: o.taxProvisions, gap: expAdj - o.taxProvisions,
        lossCarry: o.lossCarry, hasSusa: parsed.hasSusa };
      if (parsed.hasSusa) o.taxCoverage = expAdj > 0 ? o.taxProvisions / expAdj : 2;   // 2 = comfortably covered
    }
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
      const days = months * 30;                                     // days sales/payables outstanding
      L.dso = (L.receivables > 0 && o.umsatzYtd > 0) ? L.receivables / o.umsatzYtd * days : null;
      L.dpo = (L.payablesLuL > 0 && o.gesamtkostenYtd > 0) ? L.payablesLuL / o.gesamtkostenYtd * days : null;
      o.liquidity = L;
    }
    // USt (VAT) status — SKR03 input VAT 1570–1589 (Soll), output VAT 1770–1799
    // (Haben), advance payments 1780/1781 (Soll). VAT is pass-through money; the
    // open liability is not part of net liquidity above (shown as orientation).
    if (parsed.hasSusa && a.length) {
      const vst = a.filter((x) => x.no >= 1570 && x.no <= 1589);
      const ustAll = a.filter((x) => x.no >= 1770 && x.no <= 1799);
      if (vst.length || ustAll.length) {
        const vorsteuer = vst.reduce((s, x) => s + (x.side === 'S' ? x.saldoAbs : x.side === 'H' ? -x.saldoAbs : 0), 0);
        const output = ustAll.filter((x) => x.side === 'H').reduce((s, x) => s + x.saldoAbs, 0);
        const prepaid = ustAll.filter((x) => x.side === 'S').reduce((s, x) => s + x.saldoAbs, 0);
        o.ust = { output, vorsteuer, prepaid, net: output - vorsteuer - prepaid };
      }
    }
    // Tax & reserves — how much of the cash is not freely usable, plus an income-
    // tax outlook and a rough plausibility check from revenue/expenses.
    if (parsed.hasSusa && a.length) {
      const cash = o.liquidity ? o.liquidity.cash : 0;
      const ustOwed = (o.ust && o.ust.net > 0) ? o.ust.net : 0;
      const wageTax = o.liquidity ? Math.max(0, o.liquidity.wageLiab) : 0;
      const reserves = Math.max(0, o.taxProvisions);
      // Tax refund claims (income taxes): GewSt/KSt overpayments 1540–1549, but
      // NOT 1548 (input VAT deductible in a later period — a VAT, not a tax refund).
      const refunds = a.filter((x) => x.no >= 1540 && x.no <= 1549 && x.no !== 1548 && x.side === 'S').reduce((s, x) => s + x.saldoAbs, 0);
      const ustNet = o.ust ? o.ust.net : 0;
      const bound = ustOwed + wageTax + reserves;
      o.taxSummary = { cash, ustOwed, wageTax, reserves, refunds, bound,
        free: cash - bound, freeRatio: cash > 0 ? (cash - bound) / cash : null,
        // Two clear buckets: pass-through money (VAT + wage tax/SV, part of payroll)
        // and the company's own income tax netted with refunds. Their sum is the
        // real net cash outflow once refunds arrive.
        passThrough: ustOwed + wageTax,          // durchlaufende Posten (Fremdgeld)
        ownTaxNet: reserves - refunds,           // eigene Ertragsteuer, netto
        netOutflow: bound - refunds,             // = passThrough + ownTaxNet
        netTax: ustNet + reserves - refunds };   // Finanzamt-only (VAT + income tax), advisor reconciliation
      // Verprobung (plausibility): sales VAT vs. 19 % of revenue, input VAT vs. taxable expense.
      const salesVat = a.filter((x) => x.no >= 1770 && x.no <= 1779 && x.side === 'H').reduce((s, x) => s + x.saldoAbs, 0);
      const vstBase = Math.max(0, o.gesamtkostenYtd - v('personalkosten', 'ytd') - v('abschreibungen', 'ytd') - v('betrSteuern', 'ytd'));
      o.taxPlaus = { salesVat, expectedVat: 0.19 * o.umsatzYtd, vatQuote: o.umsatzYtd > 0 ? salesVat / o.umsatzYtd : null,
        vorsteuer: o.ust ? o.ust.vorsteuer : 0, vstBase, vstQuote: (vstBase > 0 && o.ust) ? o.ust.vorsteuer / vstBase : null };
    }
    o.concentration = concentrationOf(a);
    return o;
  }
  // Customer/supplier concentration from the personal (debtor/creditor) accounts.
  function concentrationOf(a) {
    if (!a || !a.length) return null;
    const build = (accs, side) => {
      const list = accs.filter((x) => x.side === side && x.saldoAbs > 0)
        .map((x) => ({ no: x.no, label: x.label, amount: x.saldoAbs })).sort((x, y) => y.amount - x.amount);
      const total = list.reduce((s, x) => s + x.amount, 0);
      if (!total || list.length < 2) return null;
      list.forEach((x) => { x.share = x.amount / total; });
      return { total, count: list.length, top: list.slice(0, 6),
        top1: list[0].share, top3: list.slice(0, 3).reduce((s, x) => s + x.share, 0) };
    };
    const customers = build(a.filter((x) => x.no >= 10000 && x.no <= 69999), 'S');
    const suppliers = build(a.filter((x) => x.no >= 70000 && x.no <= 99999), 'H');
    return (customers || suppliers) ? { customers, suppliers } : null;
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
      if (gl && L.receivables > 0.15 * gl) recs.push(t('rec.receivables', { amount: eur0(L.receivables) }));
      if (!ergPos && L.runwayMonths != null && L.runwayMonths < 3) recs.push(t('rec.runway', { m: L.runwayMonths.toFixed(1) }));
    }
    if (K.taxSummary && K.taxSummary.bound > 0) {
      const S = K.taxSummary;
      if (S.refunds > 0)   // refund claims flow back → show the net outflow, not just the gross binding
        recs.push(t('rec.boundNet', { bound: eur0(S.bound), refunds: eur0(S.refunds), net: eur0(Math.max(0, S.bound - S.refunds)) }));
      else
        recs.push(t('rec.bound', { bound: eur0(S.bound), free: eur0(S.free) }));
    }
    if (K.taxCheck && K.taxCheck.taxable > 0 && K.taxCheck.gap > 0)
      recs.push(t('rec.taxgap', { gap: eur0(K.taxCheck.gap) }));
    if (K.umsatzTrend < -0.15) recs.push(t('rec.trend', { p: pct(Math.abs(K.umsatzTrend)) }));
    const cc = K.concentration && K.concentration.customers;
    if (cc && cc.top1 >= 0.30) recs.push(t('rec.concentration', { share: pct(cc.top1, 0), name: cc.top[0].label || ('Konto ' + cc.top[0].no) }));
    if (K.breakEven && K.breakEven.safety != null && K.breakEven.safety < 0.10 && K.betriebsergebnisYtd > 0)
      recs.push(t('rec.breakeven', { be: eur0(K.breakEven.umsatz), safety: pct(K.breakEven.safety, 0) }));
    recs.push(t('rec.preliminary'));
    const levels = [ertrag, liqui].filter(Boolean);
    const overall = levels.includes('bad') ? 'bad' : levels.includes('ok') ? 'ok' : 'good';
    return { ertrag, liqui, overall, recs };
  }

  // ------------------------------------------------------------ rendering
  const dot = (lvl) => `<span class="bwa-dot bwa-${lvl}" title="${esc(t('lv' + lvl[0].toUpperCase() + lvl.slice(1)))}"></span>`;
  const lvlWord = (lvl) => t('lv' + lvl[0].toUpperCase() + lvl.slice(1));

  function info(defKey) {
    const txt = defKey ? t('def.' + defKey) : '';
    return txt && txt !== 'def.' + defKey
      ? `<span class="bwa-info" tabindex="0" role="note" title="${esc(txt)}" aria-label="${esc(txt)}">i</span>` : '';
  }
  function card(label, value, sub, lvl, defKey, spark) {
    return `<div class="bwa-card">
      <div class="bwa-card-label">${lvl ? dot(lvl) : ''}${esc(label)}${info(defKey)}</div>
      <div class="bwa-card-value">${value}</div>
      ${sub ? `<div class="bwa-card-sub">${sub}</div>` : ''}
      ${spark || ''}
    </div>`;
  }
  function money2(n) { return `<span class="${n < 0 ? 'bwa-neg' : ''}">${eur0(n)}</span>`; }

  // Taxes & reserves section: (A) bound vs. free liquidity, (B) income-tax
  // outlook incl. loss carry-forwards, (C) plausibility check from the figures.
  function taxSection(K) {
    const inner = bindingBlock(K) + netTaxBlock(K) + ertragTaxBlock(K) + verprobungBlock(K);
    return inner ? section('secTaxes', inner) : '';
  }
  // What must be kept aside, split into two plainly-named buckets: pass-through
  // money (VAT + wage tax/SV, part of payroll) and the company's own income tax
  // netted with refund claims. Their sum is the real net cash outflow.
  const taxRow = (rows) => `<table class="bwa-table bwa-taxtable"><tbody>${rows.map((r) =>
    `<tr class="${r[2] ? 'bwa-tr-bold' : ''}"><td>${esc(r[0])}</td><td class="bwa-num">${esc(r[1])}</td></tr>`).join('')}</tbody></table>`;
  function netTaxBlock(K) {
    const S = K.taxSummary;
    if (!S || (S.refunds <= 0 && S.reserves <= 0 && S.ustOwed <= 0 && S.wageTax <= 0)) return '';
    const passRows = [[t('liqUst'), eur0(S.ustOwed)]];
    if (S.wageTax > 0) passRows.push([t('liqWage'), eur0(S.wageTax)]);
    passRows.push([t('ptSumPass'), eur0(S.passThrough), true]);
    const ownRows = [[t('liqRes'), eur0(S.reserves)]];
    if (S.refunds > 0) ownRows.push([t('ntRefunds'), '− ' + eur0(S.refunds)]);
    ownRows.push([t('ptOwnNet'), (S.ownTaxNet < 0 ? '− ' : '') + eur0(Math.abs(S.ownTaxNet)), true]);
    const owed = S.netOutflow >= 0;
    const verdict = owed ? t('ptVerdictOwed', { amount: eur0(S.netOutflow) }) : t('ptVerdictCredit', { amount: eur0(-S.netOutflow) });
    return `<div class="bwa-subtitle"><strong>${esc(t('ptTitle'))}</strong>${info('ntoutflow')}</div>
      <div class="bwa-h4">${esc(t('ptPassThrough'))}</div>${taxRow(passRows)}
      <p class="bwa-note">${esc(t('ptNote'))}</p>
      <div class="bwa-h4">${esc(t('ptOwnTax'))}</div>${taxRow(ownRows)}
      ${taxRow([[t('ptTotal'), (S.netOutflow < 0 ? '− ' : '') + eur0(Math.abs(S.netOutflow)), true]])}
      <div class="bwa-assess bwa-assess-${owed ? 'ok' : 'good'}">${dot(owed ? 'ok' : 'good')}<div>${esc(verdict)}</div></div>
      <p class="bwa-note">${esc(t('ptReconcile', { amount: eur0(S.netTax) }))}</p>`;
  }
  // (A) How much of the cash is pass-through / reserved, and what stays free.
  function bindingBlock(K) {
    const S = K.taxSummary;
    if (!S || S.cash <= 0) return '';
    const segs = [
      { key: 'liqUst', val: S.ustOwed, cls: 'bwa-seg-ust' },
      { key: 'liqWage', val: S.wageTax, cls: 'bwa-seg-wage' },
      { key: 'liqRes', val: S.reserves, cls: 'bwa-seg-res' },
    ].filter((s) => s.val > 0);
    const w = (val) => (Math.max(0, Math.min(val, S.cash)) / S.cash * 100).toFixed(1) + '%';
    const bar = `<div class="bwa-flow-bar">
      ${segs.map((s) => `<div class="bwa-seg ${s.cls}" style="width:${w(s.val)}" title="${esc(t(s.key))}: ${esc(eur0(s.val))}"></div>`).join('')}
      ${S.free > 0 ? `<div class="bwa-seg bwa-seg-free" style="width:${w(S.free)}" title="${esc(t('liqFree'))}: ${esc(eur0(S.free))}"></div>` : ''}
    </div>${legend([...segs.map((s) => ({ name: t(s.key), cls: s.cls })), { name: t('liqFree'), cls: 'bwa-seg-free' }])}`;
    const lvl = S.free <= 0 ? 'bad' : (S.freeRatio != null && S.freeRatio < 0.25 ? 'ok' : 'good');
    const cards = card(t('kLiquide'), eur0(S.cash), null, null, 'liquide')
      + (S.ustOwed > 0 ? card(t('liqUst'), eur0(S.ustOwed), null, null, 'ust') : '')
      + (S.wageTax > 0 ? card(t('liqWage'), eur0(S.wageTax), t('ntPayrollHint'), null) : '')
      + (S.reserves > 0 ? card(t('liqRes'), eur0(S.reserves), null, null, 'rueckstellungen') : '')
      + card(t('liqBound'), eur0(S.bound), null, null, 'bound')
      + card(t('liqFree'), money2(S.free), S.freeRatio != null ? t('liqFreeSub', { p: pct(S.freeRatio, 0) }) : null, lvl);
    const ustBreak = S.ustOwed > 0 && K.ust
      ? `<p class="bwa-note">${esc(t('liqUstBreak', { output: eur0(K.ust.output), vorsteuer: eur0(K.ust.vorsteuer), prepaid: eur0(K.ust.prepaid) }))}</p>` : '';
    const refundNote = S.refunds > 0 ? `<p class="bwa-note">${esc(t('liqRefundNote', { amount: eur0(S.refunds) }))}</p>` : '';
    return `<div class="bwa-taxbox-head"><strong>${esc(t('liqBindTitle'))}</strong>${info('bound')}</div>
      ${bar}<div class="bwa-cards" style="margin-top:var(--qrx-s-3)">${cards}</div>${ustBreak}${refundNote}`;
  }
  // (B) Income-tax outlook: result → loss carry-forward → expected tax → coverage.
  function ertragTaxBlock(K) {
    const T = K.taxCheck;
    if (!T) return '';
    const rows = [[t('etErgebnis'), eur0(T.base)]];
    if (T.lossCarry > 0) { rows.push([t('etLoss'), '− ' + eur0(Math.min(T.lossCarry, T.base))]); rows.push([t('etTaxable'), eur0(T.taxable)]); }
    rows.push([t('etExpected', { rate: pct(T.rate, 0) }), eur0(T.expectedAdj)]);
    if (T.hasSusa) rows.push([t('etReserved'), eur0(T.reserved)]);
    const shielded = T.lossCarry > 0 && T.taxable === 0;
    const vlvl = (shielded || T.gap <= 0) ? 'good' : 'bad';
    const verdict = shielded ? t('etVerdictShield', { loss: eur0(T.lossCarry) })
      : (T.hasSusa && T.gap > 0) ? t('etVerdictGap', { gap: eur0(T.gap) })
        : (T.hasSusa) ? t('etVerdictCovered') : t('etVerdictNoSusa', { expected: eur0(T.expectedAdj) });
    const refund = (K.taxSummary && K.taxSummary.refunds > 0)
      ? `<p class="bwa-note">${esc(t('etRefund', { amount: eur0(K.taxSummary.refunds) }))}</p>` : '';
    const tbl = `<table class="bwa-table bwa-taxtable"><tbody>${rows.map((r, i) =>
      `<tr class="${i === rows.length - 1 ? 'bwa-tr-bold' : ''}"><td>${esc(r[0])}</td><td class="bwa-num">${esc(r[1])}</td></tr>`).join('')}</tbody></table>`;
    return `<div class="bwa-subtitle"><strong>${esc(t('etTitle'))}</strong>${info('steuercheck')}</div>
      ${tbl}<div class="bwa-assess bwa-assess-${vlvl}">${dot(vlvl)}<div>${esc(verdict)}</div></div>${refund}
      <p class="bwa-note">${esc(t('taxCheckCaveat'))}</p>`;
  }
  // (C) Rough plausibility from revenue (output VAT) and expenses (input VAT).
  function verprobungBlock(K) {
    const P = K.taxPlaus;
    if (!P || P.vatQuote == null) return '';
    const vatOk = P.vatQuote > 0 && P.vatQuote <= 0.19 * 1.06;
    let out = `<div class="bwa-assess bwa-assess-${vatOk ? 'good' : 'ok'}">${dot(vatOk ? 'good' : 'ok')}<div>${esc(t('vpUst', {
      booked: eur0(P.salesVat), exp: eur0(P.expectedVat), q: pct(P.vatQuote, 0) }))}</div></div>`;
    if (P.vstQuote != null) out += `<div class="bwa-note">${esc(t('vpVst', { vst: eur0(P.vorsteuer), q: pct(P.vstQuote, 0), base: eur0(P.vstBase) }))}</div>`;
    return `<div class="bwa-subtitle"><strong>${esc(t('vpTitle'))}</strong>${info('verprobung')}</div>${out}
      <p class="bwa-note">${esc(t('vpCaveat'))}</p>`;
  }

  // Semicircle gauge ("Tacho") for a bounded ratio KPI with green/amber/red zones.
  function gauge(spec) {
    const cx = 100, cy = 100, r = 80, rMid = 69, thick = 22;
    const clamp = (v) => Math.max(spec.min, Math.min(spec.max, v));
    const ang = (v) => Math.PI * (1 - (clamp(v) - spec.min) / (spec.max - spec.min));
    const arc = (a0, a1) => {
      const steps = Math.max(2, Math.round(Math.abs(a0 - a1) / 0.08)); let d = '';
      for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * i / steps; d += (i ? 'L' : 'M') + (cx + rMid * Math.cos(a)).toFixed(1) + ' ' + (cy - rMid * Math.sin(a)).toFixed(1) + ' '; }
      return d;
    };
    let arcs = '', from = spec.min;
    for (const z of spec.zones) { const to = Math.min(z.to, spec.max); arcs += `<path d="${arc(ang(from), ang(to))}" class="bwa-g-${z.cls}" fill="none" stroke-width="${thick}"/>`; from = to; if (from >= spec.max) break; }
    let cls = spec.zones[spec.zones.length - 1].cls;
    for (const z of spec.zones) { if (clamp(spec.value) <= z.to) { cls = z.cls; break; } }
    const av = ang(spec.value), nx = cx + (r - 8) * Math.cos(av), ny = cy - (r - 8) * Math.sin(av);
    const lvl = cls === 'g' ? 'good' : cls === 'a' ? 'ok' : 'bad';
    return `<div class="bwa-gauge">
      <div class="bwa-gauge-label">${esc(t(spec.labelKey))}${info(spec.defKey)}</div>
      <svg viewBox="0 0 200 116" class="bwa-gauge-svg" aria-hidden="true">${arcs}
        <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="bwa-g-needle"/>
        <circle cx="${cx}" cy="${cy}" r="4.5" class="bwa-g-hub"/></svg>
      <div class="bwa-gauge-value">${esc(spec.fmt(spec.value))}</div>
      <div class="bwa-gauge-verdict bwa-verd-${cls}">${esc(lvlWord(lvl))}</div>
    </div>`;
  }
  function renderCockpit(K) {
    const gs = [];
    gs.push(gauge({ labelKey: 'kMarge', defKey: 'marge', value: K.umsatzrenditeYtd, min: -0.10, max: 0.30,
      zones: [{ to: 0, cls: 'r' }, { to: 0.10, cls: 'a' }, { to: 0.30, cls: 'g' }], fmt: (v) => pct(v, 1) }));
    if (K.breakEven && K.breakEven.umsatz != null)
      gs.push(gauge({ labelKey: 'gaugeSafety', defKey: 'breakeven', value: K.breakEven.safety, min: -0.30, max: 0.40,
        zones: [{ to: 0, cls: 'r' }, { to: 0.15, cls: 'a' }, { to: 0.40, cls: 'g' }], fmt: (v) => pct(v, 0) }));
    if (K.liquidity && K.liquidity.runwayMonths != null)
      gs.push(gauge({ labelKey: 'kRunway', defKey: 'runway', value: K.liquidity.runwayMonths, min: 0, max: 12,
        zones: [{ to: 3, cls: 'r' }, { to: 6, cls: 'a' }, { to: 12, cls: 'g' }], fmt: (v) => t('months', { n: v.toFixed(1) }) }));
    if (K.concentration && K.concentration.customers)
      gs.push(gauge({ labelKey: 'gaugeCluster', defKey: 'cluster', value: K.concentration.customers.top1, min: 0, max: 1,
        zones: [{ to: 0.25, cls: 'g' }, { to: 0.40, cls: 'a' }, { to: 1, cls: 'r' }], fmt: (v) => pct(v, 0) }));
    if (K.taxCoverage != null) {
      const noTaxDue = K.taxCheck && K.taxCheck.expectedAdj === 0;   // shielded by loss carry-forward
      gs.push(gauge({ labelKey: 'gaugeTaxCov', defKey: 'taxcov', value: K.taxCoverage, min: 0, max: 1.5,
        zones: [{ to: 0.70, cls: 'r' }, { to: 1.0, cls: 'a' }, { to: 1.5, cls: 'g' }],
        fmt: () => noTaxDue ? t('gaugeNoTaxDue') : (K.taxCoverage > 1.5 ? '≥ ' : '') + pct(Math.min(K.taxCoverage, 1.5), 0) }));
    }
    if (K.taxSummary && K.taxSummary.freeRatio != null)
      gs.push(gauge({ labelKey: 'gaugeFreeLiq', defKey: 'freeliq', value: K.taxSummary.freeRatio, min: 0, max: 1,
        zones: [{ to: 0.20, cls: 'r' }, { to: 0.50, cls: 'a' }, { to: 1, cls: 'g' }], fmt: (val) => pct(val, 0) }));
    return gs.length >= 2 ? section('secCockpit', `<div class="bwa-cockpit">${gs.join('')}</div>`) : '';
  }

  // Mini sparkline for a KPI card (from the multi-period series).
  function sparkSVG(vals) {
    const v = (vals || []).filter((x) => x != null);
    if (v.length < 2) return '';
    const W = 96, H = 26, p = 3, max = Math.max(...v), min = Math.min(...v, 0), range = (max - min) || 1;
    const x = (i) => p + i / (v.length - 1) * (W - 2 * p), y = (val) => p + (max - val) / range * (H - 2 * p);
    const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" class="bwa-spark" preserveAspectRatio="none"><polyline points="${pts}" class="bwa-spark-line"/><circle cx="${x(v.length - 1).toFixed(1)}" cy="${y(v[v.length - 1]).toFixed(1)}" r="2.3" class="bwa-spark-dot"/></svg>`;
  }

  // GuV waterfall: income → minus cost blocks → operating result.
  function waterfallSVG(K) {
    const uebrige = Math.max(0, K.gesamtkostenYtd - K.personalYtd - K.sonstigeYtd);
    const items = [
      { label: t('wfLeistung'), value: K.betrRohertragYtd, type: 'start' },
      { label: t('segPersonal'), value: -K.personalYtd, type: 'delta' },
      { label: t('segSonstige'), value: -K.sonstigeYtd, type: 'delta' },
      { label: t('segUebrige'), value: -uebrige, type: 'delta' },
      { label: t('segErgebnis'), value: K.betriebsergebnisYtd, type: 'end' },
    ];
    const W = 580, H = 200, padT = 12, padB = 42, padL = 6, padR = 6, plotW = W - padL - padR, plotH = H - padT - padB;
    let run = 0, hi = 0, lo = 0; const bars = [];
    for (const it of items) {
      if (it.type === 'delta') { const from = run, to = run + it.value; bars.push({ it, from, to }); run = to; }
      else { bars.push({ it, from: 0, to: it.value }); if (it.type === 'start') run = it.value; }
      hi = Math.max(hi, bars[bars.length - 1].from, bars[bars.length - 1].to);
      lo = Math.min(lo, bars[bars.length - 1].from, bars[bars.length - 1].to);
    }
    const range = (hi - lo) || 1, y = (val) => padT + (hi - val) / range * plotH;
    const slot = plotW / items.length, bw = Math.min(64, slot * 0.62);
    let out = `<line x1="${padL}" y1="${y(0).toFixed(1)}" x2="${W - padR}" y2="${y(0).toFixed(1)}" class="bwa-axisline"/>`;
    bars.forEach((b, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      const yTop = Math.min(y(b.from), y(b.to)), h = Math.max(1, Math.abs(y(b.from) - y(b.to)));
      const cls = b.it.type === 'start' ? 'bwa-wf-total' : b.it.type === 'end' ? (b.it.value >= 0 ? 'bwa-wf-pos' : 'bwa-wf-neg') : 'bwa-wf-cost';
      out += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" class="${cls}"><title>${esc(b.it.label)}: ${esc(eur0(b.it.value))}</title></rect>`;
      if (i < bars.length - 1 && b.it.type !== 'end') out += `<line x1="${(x + bw).toFixed(1)}" y1="${y(b.to).toFixed(1)}" x2="${(padL + (i + 1) * slot + (slot - bw) / 2).toFixed(1)}" y2="${y(b.to).toFixed(1)}" class="bwa-wf-conn"/>`;
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 24}" text-anchor="middle" class="bwa-axis">${esc(b.it.label)}</text>`;
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="bwa-wf-val">${esc(eur0(Math.abs(b.it.value)))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bwa-svg">${out}</svg>`;
  }

  // Biggest single expense accounts (drills into "other costs").
  function expenseBars(parsed) {
    const top = (parsed.susa || []).filter((a) => a.no >= 4000 && a.no <= 4999 && a.side === 'S' && a.saldoAbs > 0)
      .sort((a, b) => b.saldoAbs - a.saldoAbs).slice(0, 8);
    if (top.length < 2) return '';
    const max = top[0].saldoAbs;
    const bars = top.map((a) => `<div class="bwa-bar-row">
      <div class="bwa-bar-label" title="${esc(a.label)}">${esc(a.label)}</div>
      <div class="bwa-bar-track"><div class="bwa-bar-fill" style="width:${Math.round(a.saldoAbs / max * 100)}%"></div></div>
      <div class="bwa-bar-val">${eur0(a.saldoAbs)}</div></div>`).join('');
    return `<div class="bwa-chart-title bwa-subtitle">${esc(t('expenseDrill'))} ${info('expenseDrill')}</div>${bars}`;
  }

  // Customer / supplier concentration (Klumpenrisiko) — one side at a time.
  function concentrationPart(c, titleKey) {
    if (!c) return '';
    const lvl = c.top1 >= 0.4 ? 'bad' : c.top1 >= 0.25 ? 'ok' : 'good';
    const max = c.top[0].share;
    const bars = c.top.map((x) => `<div class="bwa-bar-row">
      <div class="bwa-bar-label" title="${esc(x.label || ('Konto ' + x.no))}">${esc(x.label || ('Konto ' + x.no))}</div>
      <div class="bwa-bar-track"><div class="bwa-bar-fill" style="width:${Math.round(x.share / max * 100)}%"></div></div>
      <div class="bwa-bar-val">${eur0(x.amount)} · ${pct(x.share, 0)}</div></div>`).join('');
    return `<div class="bwa-chart-box">
      <div class="bwa-chart-title">${esc(t(titleKey))} ${dot(lvl)} <span class="bwa-muted">${esc(t('concTop', { share: pct(c.top1, 0), n: c.count }))}</span></div>${bars}</div>`;
  }
  function concentrationSide(conc, which) {
    const html = which === 'cust' ? concentrationPart(conc.customers, 'concCustomers') : concentrationPart(conc.suppliers, 'concSuppliers');
    return html ? `<div class="bwa-trend-grid">${html}</div>` : '';
  }
  // Revenue per customer (invoiced + collected + open), largest first. Only when
  // the trial balance carries the movement columns (else returns '').
  function customerRevenueBlock(parsed) {
    const list = customerRevenue(parsed);
    if (!list) return '';
    const top = list.slice(0, 10);
    const rows = top.map((c) => `<tr>
      <td>${esc(c.label || ('Konto ' + c.no))}</td>
      <td class="bwa-num bwa-muted">${eur0(c.anfang)}</td>
      <td class="bwa-num">${eur0(c.fakturiert)}</td>
      <td class="bwa-num">${eur0(c.vereinnahmt)}</td>
      <td class="bwa-num">${eur0(c.offen)}</td></tr>`).join('');
    return section('secCustRevenue', `<p class="bwa-note bwa-subnote">${esc(t('crIntro'))}</p>
      <div class="bwa-table-wrap"><table class="bwa-table"><thead><tr>
        <th>${esc(t('thKunde'))}</th><th class="bwa-num">${esc(t('crAnfang'))}</th><th class="bwa-num">${esc(t('crFakturiert'))}</th>
        <th class="bwa-num">${esc(t('crVereinnahmt'))}</th><th class="bwa-num">${esc(t('crOffen'))}</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
      <p class="bwa-note">${esc(t('crNote'))}</p>`);
  }

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

  function renderReport(parsed, series) {
    const K = kpis(parsed), A = assess(K), m = parsed.meta;
    series = series || [];
    const sp = (sel) => sparkSVG(series.map(sel));
    $('bwa-company').textContent = m.company || 'BWA';
    $('bwa-period').textContent = t('periodLine', { m: m.currentMonth || '–', p: m.periodLabel || '–', d: m.date || '–' });

    const S = K.taxSummary;
    const showNet = S && (S.refunds > 0 || S.reserves > 0 || S.ustOwed > 0 || S.wageTax > 0);
    const glance = card(t('kUmsatz') + ' · ' + t('suffYtd'), eur0(K.umsatzYtd), t('perMonth') + ' ' + eur0(K.avgMonthlyUmsatz), null, 'umsatz', sp((s) => s.umsatz))
      + card(t('kBetriebsergebnis'), money2(K.betriebsergebnisYtd), t('kMarge') + ' ' + pct(K.umsatzrenditeYtd), A.ertrag, 'betriebsergebnis', sp((s) => s.betriebsergebnis))
      + card(t('kErgebnis'), money2(K.ergebnisYtd), t('suffMonth') + ' ' + eur0(K.ergebnisMonth), null, 'ergebnis', sp((s) => s.ergebnis))
      + (K.liquidity ? card(t('kLiquide'), eur0(K.liquidity.cash), t('kNettoLiq') + ' ' + eur0(K.liquidity.netLiquidity), A.liqui, 'liquide', sp((s) => s.cash)) : '')
      + (showNet ? card(t('ntOutflow'), eur0(Math.abs(S.netOutflow)), t(S.netOutflow >= 0 ? 'ntOutflowSub' : 'ntInflowSub'), S.netOutflow > 0 ? 'ok' : 'good', 'ntoutflow') : '');

    // Ertrag section — GuV waterfall + assessment + break-even + run-rate
    const ertragText = t('aErtrag' + capitalize(A.ertrag), { erg: eur0(K.betriebsergebnisYtd), marge: pct(K.umsatzrenditeYtd) });
    const be = K.breakEven;
    const beBox = (be && be.umsatz != null) ? `<div class="bwa-taxbox">
      <div class="bwa-taxbox-head"><strong>${esc(t('breakEvenTitle'))}</strong>${info('breakeven')}</div>
      <p>${esc(t('breakEvenLine', { be: eur0(be.umsatz), beM: eur0(be.umsatz / K.months), safety: pct(be.safety, 0) }))}</p>
      <p class="bwa-note">${esc(t('breakEvenCaveat'))}</p></div>` : '';
    const runrate = `<div class="bwa-runrate">${info('runrate')}<strong>${esc(t('runRateTitle'))}</strong>
      ${esc(t('runRateLine', { months: K.months, u: eur0(K.runRateUmsatz), e: eur0(K.runRateErgebnis) }))}</div>`;
    const ertragBody = `<div class="bwa-cols">
      <div class="bwa-chart-box"><div class="bwa-chart-title">${esc(t('flowTitle'))}</div>${waterfallSVG(K)}</div>
      <div class="bwa-assess bwa-assess-${A.ertrag}">${dot(A.ertrag)}<div>${esc(ertragText)}</div></div>
    </div>${beBox}${runrate}`;

    const kostenBody = `<div class="bwa-chart-title">${esc(t('costTitle'))}</div>${costBars(K)}${expenseBars(parsed)}`;

    let liquiBody = '';
    if (K.liquidity) {
      const L = K.liquidity;
      const cards = card(t('kLiquide'), eur0(L.cash), null, null, 'liquide')
        + card(t('kForderungen'), eur0(L.receivables), null, null, 'forderungen')
        + card(t('kVerbindl'), eur0(L.shortTermLiab), null, null, 'verbindl')
        + card(t('kRueckstellungen'), eur0(L.provisions), null, null, 'rueckstellungen')
        + card(t('kNettoLiq'), money2(L.netLiquidity), null, A.liqui, 'nettoLiq')
        + (L.runwayMonths != null ? card(t('kRunway'), t('months', { n: L.runwayMonths.toFixed(1) }), null, null, 'runway') : '')
        + (L.dso != null ? card(t('kDso'), t('days', { n: Math.round(L.dso) }), null, null, 'dso') : '')
        + (L.dpo != null ? card(t('kDpo'), t('days', { n: Math.round(L.dpo) }), null, null, 'dpo') : '');
      const runwayHint = L.runwayMonths != null ? `<p class="bwa-note">${esc(t('runwayHint', { m: t('months', { n: L.runwayMonths.toFixed(1) }) }))}</p>` : '';
      const liquiText = t('aLiqui' + capitalize(A.liqui), { netto: eur0(L.netLiquidity) });
      liquiBody = `<div class="bwa-cards">${cards}</div>
        <div class="bwa-assess bwa-assess-${A.liqui}">${dot(A.liqui)}<div>${esc(liquiText)}</div></div>${runwayHint}`;
    } else {
      liquiBody = `<p class="bwa-note">${esc(t('noSusa'))}</p>`;
    }

    const recs = `<div class="bwa-overall bwa-assess-${A.overall}">${dot(A.overall)}<strong>${esc(t('overall'))}: ${esc(lvlWord(A.overall))}</strong></div>
      <ul class="bwa-recs">${A.recs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;

    const kerBlock = `<details class="bwa-details"><summary>${esc(t('detKer'))}</summary>
      <div class="bwa-table-wrap">${kerTable(K, parsed)}</div></details>`;
    const expTbl = expenseTable(parsed);
    const expBlock = expTbl ? `<div class="bwa-table-wrap">${expTbl}</div>` : '';
    const conc = K.concentration;
    const custBlock = (conc && conc.customers) ? section('secCustomers', `<p class="bwa-note bwa-subnote">${esc(t('riskIntro'))}</p>${concentrationSide(conc, 'cust')}`) : '';
    const supBlock = (conc && conc.suppliers) ? section('secSuppliers', concentrationSide(conc, 'sup')) : '';

    // Organise the report into topic tabs for a clearer overview.
    const tabs = [
      { id: 'overview', label: t('tabOverview'),
        html: renderCockpit(K) + section('secGlance', `<div class="bwa-cards">${glance}</div>`) + section('secBewertung', recs) + trendHTML(series) },
      { id: 'revenue', label: t('tabRevenue'), html: section('secErtrag', ertragBody) + customerRevenueBlock(parsed) + custBlock + kerBlock },
      { id: 'costs', label: t('tabCosts'), html: section('secKosten', kostenBody) + supBlock + expBlock },
      { id: 'taxes', label: t('tabTaxes'), html: taxSection(K) },
      { id: 'liquidity', label: t('tabLiquidity'), html: section('secLiqui', liquiBody) },
    ];
    $('bwa-body').innerHTML = tabbed(tabs);
    attachTabHandlers();

    $('bwa-disclaimer').textContent = t('disclaimer', {
      company: m.company || '–',
      today: new Date().toLocaleDateString(loc(), { year: 'numeric', month: '2-digit', day: '2-digit' }),
    });
  }
  const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
  function section(key, body) {
    return `<section class="bwa-sec"><h3 class="bwa-h3">${esc(t(key))}</h3>${body}</section>`;
  }
  // Tab bar + panels. Empty tabs are dropped; the active tab is remembered.
  function tabbed(tabs) {
    const avail = tabs.filter((tb) => tb.html && tb.html.trim());
    if (!avail.some((tb) => tb.id === state.activeTab)) state.activeTab = avail.length ? avail[0].id : null;
    const bar = avail.map((tb) => `<button type="button" class="bwa-tab${tb.id === state.activeTab ? ' is-active' : ''}" role="tab" aria-selected="${tb.id === state.activeTab}" data-tab="${tb.id}">${esc(tb.label)}</button>`).join('');
    const panels = avail.map((tb) => `<div class="bwa-tabpanel" role="tabpanel" data-tab="${tb.id}"${tb.id === state.activeTab ? '' : ' hidden'}>${tb.html}</div>`).join('');
    return `<div class="bwa-tabs" role="tablist">${bar}</div><div class="bwa-tabpanels">${panels}</div>`;
  }
  function attachTabHandlers() {
    const body = $('bwa-body');
    body.querySelectorAll('.bwa-tab').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      state.activeTab = id;
      body.querySelectorAll('.bwa-tab').forEach((b) => { const on = b.dataset.tab === id; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); });
      body.querySelectorAll('.bwa-tabpanel').forEach((p) => { p.hidden = p.dataset.tab !== id; });
    }));
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

  // ------------------------------------------------------- trend charts (SVG)
  const shortMonth = (lab) => { const [mon, yr] = String(lab).split('/'); return yr ? mon + ' ' + yr.slice(2) : lab; };
  function barsSVG(labels, sets) {
    const W = 580, H = 180, padT = 12, padB = 26, padL = 6, padR = 6;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const all = sets.flatMap((s) => s.vals);
    const maxV = Math.max(1, ...all, 0), minV = Math.min(0, ...all), range = (maxV - minV) || 1;
    const y = (v) => padT + (maxV - v) / range * plotH;
    const zeroY = y(0), n = labels.length, g = sets.length, groupW = plotW / n, barW = Math.min(26, (groupW * 0.68) / g);
    let out = `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${W - padR}" y2="${zeroY.toFixed(1)}" class="bwa-axisline"/>`;
    labels.forEach((lab, i) => {
      const gx = padL + i * groupW + (groupW - barW * g) / 2;
      sets.forEach((s, j) => {
        const v = s.vals[i], top = v >= 0 ? y(v) : zeroY, h = Math.max(1, Math.abs(y(v) - zeroY));
        out += `<rect x="${(gx + j * barW).toFixed(1)}" y="${top.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" class="${s.cls}"><title>${esc(lab)} · ${esc(s.name)}: ${esc(eur0(v))}</title></rect>`;
      });
      out += `<text x="${(gx + barW * g / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="bwa-axis">${esc(shortMonth(lab))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bwa-svg">${out}</svg>`;
  }
  function lineSVG(labels, vals) {
    const W = 580, H = 180, padT = 12, padB = 26, padL = 30, padR = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxV = Math.max(1, ...vals), minV = Math.min(0, ...vals), range = (maxV - minV) || 1;
    const x = (i) => padL + (labels.length === 1 ? plotW / 2 : i / (labels.length - 1) * plotW);
    const y = (v) => padT + (maxV - v) / range * plotH;
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="bwa-c3-dot"><title>${esc(labels[i])}: ${esc(eur0(v))}</title></circle>`).join('');
    const xlab = labels.map((lab, i) => `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="bwa-axis">${esc(shortMonth(lab))}</text>`).join('');
    const zero = minV < 0 ? `<line x1="${padL}" y1="${y(0).toFixed(1)}" x2="${W - padR}" y2="${y(0).toFixed(1)}" class="bwa-axisline"/>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="bwa-svg">${zero}<polyline points="${pts}" class="bwa-line"/>${dots}${xlab}</svg>`;
  }
  function stackedSVG(labels, layers) {
    const W = 580, H = 180, padT = 12, padB = 26, padL = 6, padR = 6, plotW = W - padL - padR, plotH = H - padT - padB;
    const totals = labels.map((_, i) => layers.reduce((s, l) => s + (l.vals[i] || 0), 0));
    const maxV = Math.max(1, ...totals), n = labels.length, slot = plotW / n, bw = Math.min(42, slot * 0.6);
    let out = '';
    labels.forEach((lab, i) => {
      const x = padL + i * slot + (slot - bw) / 2; let acc = 0;
      layers.forEach((l) => {
        const v = l.vals[i] || 0; if (v <= 0) return;
        const yTop = padT + (1 - (acc + v) / maxV) * plotH, h = (v / maxV) * plotH;
        out += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" class="${l.cls}"><title>${esc(lab)} · ${esc(l.name)}: ${esc(eur0(v))}</title></rect>`;
        acc += v;
      });
      out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="bwa-axis">${esc(shortMonth(lab))}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="bwa-svg">${out}</svg>`;
  }
  const legend = (items) => `<span class="bwa-flow-legend">${items.map((i) => `<span class="bwa-leg"><span class="bwa-leg-dot ${i.cls}"></span>${esc(i.name)}</span>`).join('')}</span>`;
  function trendTable(series) {
    const rows = series.map((s) => `<tr>
      <td>${esc(s.label)}</td><td class="bwa-num">${eur0(s.umsatz)}</td>
      <td class="bwa-num">${money2(s.betriebsergebnis)}</td><td class="bwa-num bwa-muted">${pct(s.marge, 1)}</td>
      <td class="bwa-num">${s.cash != null ? eur0(s.cash) : ''}</td></tr>`).join('');
    return `<table class="bwa-table"><thead><tr>
      <th>${esc(t('thMonat'))}</th><th class="bwa-num">${esc(t('kUmsatz'))}</th>
      <th class="bwa-num">${esc(t('kBetriebsergebnis'))}</th><th class="bwa-num">${esc(t('kMarge'))}</th>
      <th class="bwa-num">${esc(t('kLiquide'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  function trendHTML(series) {
    if (series.length < 2) return '';
    const labels = series.map((s) => s.label);
    const revErg = barsSVG(labels, [
      { name: t('kUmsatz'), cls: 'bwa-c1', vals: series.map((s) => s.umsatz) },
      { name: t('kBetriebsergebnis'), cls: 'bwa-c2', vals: series.map((s) => s.betriebsergebnis) },
    ]);
    const hasCash = series.some((s) => s.cash != null);
    const cashChart = hasCash ? lineSVG(labels, series.map((s) => s.cash || 0)) : '';
    const costMix = stackedSVG(labels, [
      { name: t('segPersonal'), cls: 'bwa-c1', vals: series.map((s) => s.personal) },
      { name: t('segSonstige'), cls: 'bwa-cf-warn', vals: series.map((s) => s.sonstige) },
      { name: t('segUebrige'), cls: 'bwa-cf-grey', vals: series.map((s) => s.uebrige) },
    ]);
    return `<div id="bwa-trend">${section('secTrend',
      `<div class="bwa-trend-grid">
        <div class="bwa-chart-box"><div class="bwa-chart-title">${esc(t('trUmsatzErgebnis'))} ${legend([{ name: t('kUmsatz'), cls: 'bwa-c1' }, { name: t('kBetriebsergebnis'), cls: 'bwa-c2' }])}</div>${revErg}</div>
        ${hasCash ? `<div class="bwa-chart-box"><div class="bwa-chart-title">${esc(t('trLiquiditaet'))} ${legend([{ name: t('kLiquide'), cls: 'bwa-c3' }])}</div>${cashChart}</div>` : ''}
        <div class="bwa-chart-box"><div class="bwa-chart-title">${esc(t('trKostenmix'))} ${legend([{ name: t('segPersonal'), cls: 'bwa-c1' }, { name: t('segSonstige'), cls: 'bwa-cf-warn' }, { name: t('segUebrige'), cls: 'bwa-cf-grey' }])}</div>${costMix}</div>
      </div>
      <div class="bwa-table-wrap">${trendTable(series)}</div>`)}</div>`;
  }

  // ------------------------------------------------------------ store / flow
  const STORE_KEY = 'bwa_store', ACTIVE_KEY = 'bwa_active';
  const state = { store: {}, activeCompany: null, activeKey: null, activeTab: 'overview' };
  const status = qrx.ui.status($('bwa-status'));

  function monthMeta(parsed) {
    const cm = parsed.meta.currentMonth || '';
    const [mon, yr] = cm.split('/');
    const mn = MONTHS[(mon || '').toLowerCase().slice(0, 3)];
    const key = (yr && mn) ? yr + '-' + String(mn).padStart(2, '0') : 'x-' + Date.now();
    return { company: parsed.meta.company || t('unknownCompany'), key, label: cm || key };
  }
  function saveStore() { try { qrx.core.storage.set(STORE_KEY, JSON.stringify(state.store)); saveActive(); } catch (_) {} }
  function saveActive() { try { qrx.core.storage.set(ACTIVE_KEY, JSON.stringify({ c: state.activeCompany, k: state.activeKey })); } catch (_) {} }
  function loadStore() {
    try {
      state.store = JSON.parse(qrx.core.storage.get(STORE_KEY) || 'null') || {};
      const a = JSON.parse(qrx.core.storage.get(ACTIVE_KEY) || 'null');
      if (a) { state.activeCompany = a.c; state.activeKey = a.k; }
    } catch (_) { state.store = {}; }
  }
  function seriesFor(comp) {
    const byMonth = state.store[comp] || {};
    return Object.keys(byMonth).sort().map((k) => {
      const p = byMonth[k], K = kpis(p);
      return { key: k, label: p.meta.currentMonth || k, umsatz: K.umsatzMonth, betriebsergebnis: K.betriebsergebnisMonth,
        ergebnis: K.ergebnisMonth, marge: K.umsatzMonth ? K.betriebsergebnisMonth / K.umsatzMonth : 0,
        cash: K.liquidity ? K.liquidity.cash : null,
        personal: K.personalMonth, sonstige: K.sonstigeMonth,
        uebrige: Math.max(0, K.gesamtkostenMonth - K.personalMonth - K.sonstigeMonth) };
    });
  }
  function renderPeriods() {
    const companies = Object.keys(state.store).filter((c) => Object.keys(state.store[c]).length);
    const comp = state.activeCompany, keys = Object.keys(state.store[comp] || {}).sort();
    const companySel = companies.length > 1
      ? `<label class="bwa-periods-label">${esc(t('companyLabel'))}
          <select class="qrx-select" id="bwa-company-sel">${companies.map((c) => `<option value="${esc(c)}"${c === comp ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : '';
    const chips = keys.map((k) => {
      const lab = (state.store[comp][k].meta.currentMonth) || k;
      return `<span class="bwa-chip${k === state.activeKey ? ' is-active' : ''}">
        <button type="button" class="bwa-chip-sel" data-key="${esc(k)}">${esc(lab)}</button>
        <button type="button" class="bwa-chip-x" data-key="${esc(k)}" title="${esc(t('removePeriod'))}" aria-label="${esc(t('removePeriod'))}">×</button></span>`;
    }).join('');
    $('bwa-periods').innerHTML = `${companySel}<div class="bwa-chips">${chips}</div>`
      + (keys.length < 2 ? `<span class="bwa-periods-hint">${esc(t('needMorePeriods'))}</span>` : '');
    const sel = $('bwa-company-sel');
    if (sel) sel.addEventListener('change', () => { state.activeCompany = sel.value; const ks = Object.keys(state.store[sel.value]).sort(); state.activeKey = ks[ks.length - 1]; saveActive(); renderAll(); });
    $('bwa-periods').querySelectorAll('.bwa-chip-sel').forEach((b) => b.addEventListener('click', () => { state.activeKey = b.dataset.key; saveActive(); renderAll(); }));
    $('bwa-periods').querySelectorAll('.bwa-chip-x').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); removeMonth(b.dataset.key); }));
  }
  function removeMonth(key) {
    const comp = state.activeCompany;
    if (!state.store[comp]) return;
    delete state.store[comp][key];
    if (!Object.keys(state.store[comp]).length) delete state.store[comp];
    saveStore();
    const companies = Object.keys(state.store);
    if (!companies.length) { reset(); return; }
    if (!state.store[comp]) state.activeCompany = companies[companies.length - 1];
    const ks = Object.keys(state.store[state.activeCompany]).sort();
    state.activeKey = ks[ks.length - 1];
    saveActive();
    renderAll();
  }
  function renderAll() {
    const comp = state.activeCompany, byMonth = state.store[comp] || {};
    const keys = Object.keys(byMonth).sort();
    if (!keys.length) { reset(); return; }
    if (!byMonth[state.activeKey]) state.activeKey = keys[keys.length - 1];
    const series = seriesFor(comp);
    renderPeriods();
    renderReport(byMonth[state.activeKey], series);
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => /pdf/i.test(f.type || '') || /\.pdf$/i.test(f.name || ''));
    if (!files.length) { status.set(t('notBwa'), 'error'); return; }
    status.set(t('parsingN', { n: files.length }));
    await new Promise((r) => setTimeout(r, 15));
    let added = 0, errors = 0;
    for (const f of files) {
      try {
        const parsed = parseBwa(await extractPages(new Uint8Array(await f.arrayBuffer())));
        if (parsed.error === 'no-ker') { errors++; continue; }
        const mm = monthMeta(parsed);
        (state.store[mm.company] = state.store[mm.company] || {})[mm.key] = parsed;
        state.activeCompany = mm.company; state.activeKey = mm.key; added++;
      } catch (err) { console.error(err); errors++; }
    }
    if (!added) { status.set(t('notBwaMsg'), 'error'); return; }
    saveStore();
    $('bwa-intro').hidden = true; $('bwa-drop').hidden = true; $('bwa-report').hidden = false;
    renderAll();
    status.set(errors ? t('importedWithErrors', { n: added, e: errors }) : '', errors ? 'warn' : undefined);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.qrxTest) window.qrxTest.tick('report');
  }
  function reset() {
    state.store = {}; state.activeCompany = null; state.activeKey = null; state.activeTab = 'overview';
    try { qrx.core.storage.remove(STORE_KEY); qrx.core.storage.remove(ACTIVE_KEY); } catch (_) {}
    $('bwa-report').hidden = true;
    $('bwa-periods').innerHTML = ''; $('bwa-body').innerHTML = '';
    $('bwa-intro').hidden = false; $('bwa-drop').hidden = false; $('bwa-file').value = '';
  }

  // dropzone + buttons + whole-window drop (to add more once the report is shown)
  qrx.ui.dropzone($('bwa-drop'), {
    input: $('bwa-file'), accept: '.pdf,application/pdf', multiple: true,
    onFiles: (files) => handleFiles(files),
  });
  $('bwa-add').addEventListener('click', () => $('bwa-file').click());
  $('bwa-reset').addEventListener('click', reset);
  $('bwa-print').addEventListener('click', () => window.print());
  qrx.i18n.onChange(() => { if (Object.keys(state.store).length) renderAll(); });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!$('bwa-report').hidden && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); handleFiles(e.dataTransfer.files); }
  });

  // restore a previous session
  loadStore();
  if (Object.keys(state.store).length) {
    if (!state.activeCompany || !state.store[state.activeCompany]) {
      state.activeCompany = Object.keys(state.store)[0];
      const ks = Object.keys(state.store[state.activeCompany]).sort();
      state.activeKey = ks[ks.length - 1];
    }
    $('bwa-intro').hidden = true; $('bwa-drop').hidden = true; $('bwa-report').hidden = false;
    renderAll();
  }

  // test hook
  window.__bwa = {
    parseBwa, kpis, assess, handleFiles, seriesFor, reset, analyzeTurnover, customerRevenue,
    get store() { return state.store; },
    get parsed() { return (state.store[state.activeCompany] || {})[state.activeKey] || null; },
  };
})();
