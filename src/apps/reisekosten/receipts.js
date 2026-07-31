// ============================================================================
// Beleg-Erkennung für die Reisekosten-App.
//
// Zwei Teile:
//  1) Ein reiner Heuristik-Parser (parseReceipt) — nimmt den Text eines Belegs
//     und extrahiert Betrag, Datum/Zeitraum, Beleg-Art sowie Details für Hotel
//     (Frühstück, Nächte) und Bahn/ÖPNV (Hin-/Rückfahrt, Strecke). Testbar ohne
//     Browser.
//  2) Text-Gewinnung im Browser: PDF.js liest die Textebene von PDFs, Tesseract
//     erkennt Foto-/Scan-Belege per OCR. Beide werden ERST BEI BEDARF vom CDN
//     nachgeladen (einmalig Internet nötig), damit die App ansonsten schlank und
//     offline bleibt. Nichts wird hochgeladen — alles läuft im Browser.
// ============================================================================
(function (root) {
  'use strict';

  // Pinned CDN builds (UMD/global), nur bei erstem Import geladen.
  const LIBS = {
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    ocr: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  };

  // ---------------------------------------------------------------- Parser
  function pad2(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  const MONTHS = {
    jan: 1, januar: 1, feb: 2, februar: 2, 'mär': 3, 'märz': 3, mrz: 3, maerz: 3, mar: 3, march: 3,
    apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10,
    nov: 11, november: 11, dez: 12, dezember: 12, dec: 12, december: 12,
  };

  // Alle Geldbeträge (deutsches Format 1.234,56) mit Position im Text.
  function findAmounts(text) {
    const out = [];
    const re = /(\d{1,3}(?:[.  ]\d{3})+|\d+),(\d{2})(?!\d)/g;
    let m;
    while ((m = re.exec(text))) {
      out.push({ value: parseFloat(m[1].replace(/[.  ]/g, '') + '.' + m[2]), start: m.index, end: re.lastIndex, text: m[0] });
    }
    return out;
  }

  // Wahrscheinlichen Gesamtbetrag bestimmen: Betrag in der Nähe eines
  // Summen-Schlüsselworts, Steuerzeilen abgewertet; Fallback größter Betrag.
  function pickTotal(text, amounts) {
    if (!amounts.length) return null;
    const tiers = [
      [/(gesamtbetrag|gesamtsumme|rechnungsbetrag|endbetrag|zu\s*zahlen|zahlbetrag|grand\s*total|total\s*amount|to\s*pay|zahlungsbetrag)/gi, 5],
      [/(gesamt|total|brutto)/gi, 3],
      [/(betrag|summe|preis|amount|price|fahrpreis)/gi, 2],
    ];
    let best = null;
    for (const [re, score] of tiers) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const kwEnd = m.index + m[0].length;
        let cand = null;
        for (const a of amounts) {
          if (a.start >= m.index && a.start - kwEnd < 80) { if (!cand || a.start < cand.start) cand = a; }
        }
        if (!cand) continue;
        const ctx = text.slice(Math.max(0, m.index - 30), kwEnd + 80).toLowerCase();
        let s = score;
        if (/mwst|ust\.|umsatzsteuer|mehrwertsteuer|\bvat\b|steuer|enthalten/.test(ctx)) s -= 3;
        const total = s + (cand.start / Math.max(1, text.length)) * 0.5; // spätere Beträge leicht bevorzugen
        if (!best || total > best._s) best = { value: cand.value, _s: total };
      }
    }
    if (best && best._s > 0) return best.value;
    return amounts.reduce((mx, a) => (a.value > mx ? a.value : mx), amounts[0].value);
  }

  function findDates(text) {
    const set = new Set();
    let m;
    const re1 = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/g;
    while ((m = re1.exec(text))) {
      const d = +m[1], mo = +m[2]; let y = +m[3]; if (y < 100) y += 2000;
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y < 2100) set.add(iso(y, mo, d));
    }
    const re2 = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = re2.exec(text))) {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) set.add(iso(y, mo, d));
    }
    const re3 = /\b(\d{1,2})\.?\s+([A-Za-zäöüÄÖÜ]{3,9})\.?\s+(\d{4})\b/g;
    while ((m = re3.exec(text))) {
      const d = +m[1], mo = MONTHS[m[2].toLowerCase()], y = +m[3];
      if (mo && d >= 1 && d <= 31) set.add(iso(y, mo, d));
    }
    return [...set].sort();
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
  }

  function detectType(text) {
    const t = text.toLowerCase();
    if (/hotel|übernachtung|beherberg|zimmer|room\s*rate|check[\s-]?out|check[\s-]?in|logis|pension|gästehaus|n[aä]chtigung/.test(t)) return 'hotel';
    if (/deutsche\s*bahn|bahn\.de|fahrkarte|fahrschein|bahncard|\bice\b|\bintercity\b|zugbindung|db\s*vertrieb|db\s*fernverkehr/.test(t)) return 'bahn';
    if (/verkehrsverbund|nahverkehr|einzelfahr|tageskarte|deutschlandticket|\bhvv\b|\bbvg\b|\bmvv\b|\bmvg\b|\bvbb\b|\brmv\b|\bvrr\b|\bvrs\b|\bvvs\b|u-?bahn|s-?bahn|straßenbahn|\btram\b/.test(t)) return 'oepnv';
    if (/\bbahn\b|\bticket\b|reservierung/.test(t)) return 'bahn';
    return 'unknown';
  }

  function parseReceipt(rawText) {
    const text = String(rawText || '');
    const amounts = findAmounts(text);
    const total = pickTotal(text, amounts);
    const dates = findDates(text);
    const type = detectType(text);
    const low = text.toLowerCase();

    const result = {
      type, total, currency: 'EUR',
      dates, amounts: amounts.map((a) => a.value),
      hotel: null, travel: null, raw: text.slice(0, 4000),
    };

    if (type === 'hotel') {
      let nights = null;
      const mn = low.match(/(\d+)\s*(?:nächte|naechte|übernachtungen|uebernachtungen|nights)/);
      if (mn) nights = +mn[1];
      let checkIn = dates[0] || null, checkOut = dates.length > 1 ? dates[dates.length - 1] : null;
      if (checkIn && checkOut && nights == null) nights = Math.max(0, daysBetween(checkIn, checkOut));
      if (nights != null && checkIn && !checkOut) checkOut = null;
      const breakfast = /frühstück|fruehstueck|breakfast|petit\s*déjeuner/.test(low);
      result.hotel = { checkIn, checkOut, nights, breakfast };
    } else if (type === 'bahn' || type === 'oepnv') {
      const roundTrip = /hin.?\s*und\s*rück|hin.?\s*&\s*rück|round\s*trip/.test(low) ||
        (/hinfahrt/.test(low) && /rückfahrt|rueckfahrt/.test(low));
      let from = null, to = null;
      let mr = text.match(/\bvon\s+([A-ZÄÖÜ][\wäöüÄÖÜ .()\/-]{1,40}?)\s+nach\s+([A-ZÄÖÜ][\wäöüÄÖÜ .()\/-]{1,40}?)(?:\s{2,}|[\n,;]|$)/);
      if (!mr) mr = text.match(/([A-ZÄÖÜ][\wäöüÄÖÜ .()\/-]{1,40}?)\s*(?:→|->|—|–)\s*([A-ZÄÖÜ][\wäöüÄÖÜ .()\/-]{1,40}?)(?:\s{2,}|[\n,;]|$)/);
      if (mr) {
        const clean = (s) => s.replace(/\s+(ICE|IC|EC|RE|RB|IRE|TGV|Wagen|Platz|Gleis|S-?Bahn|U-?Bahn)\b.*$/i, '').trim();
        from = clean(mr[1]); to = clean(mr[2]);
      }
      result.travel = { roundTrip, from, to };
    }
    return result;
  }

  // ---------------------------------------------------------------- Text-Gewinnung (Browser)
  const loaded = {};
  function loadScript(src) {
    return loaded[src] || (loaded[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res(true);
      s.onerror = () => { loaded[src] = null; rej(new Error('Konnte Bibliothek nicht laden: ' + src)); };
      document.head.appendChild(s);
    }));
  }

  async function ensurePdf() {
    if (!root.pdfjsLib) {
      await loadScript(LIBS.pdf);
      if (root.pdfjsLib) root.pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    }
    return root.pdfjsLib;
  }
  async function ensureOcr() {
    if (!root.Tesseract) await loadScript(LIBS.ocr);
    return root.Tesseract;
  }

  async function pdfToText(file) {
    const pdfjs = await ensurePdf();
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += content.items.map((i) => i.str).join(' ') + '\n';
    }
    return { text, doc };
  }

  async function ocrImageLike(source, onProgress) {
    const T = await ensureOcr();
    const res = await T.recognize(source, 'deu+eng', {
      logger: (mm) => { if (onProgress && mm.status === 'recognizing text') onProgress(mm.progress); },
    });
    return res.data.text;
  }

  async function pdfPagesToText(doc, onProgress) {
    let text = '';
    const pages = Math.min(doc.numPages, 3); // erste Seiten genügen für einen Beleg
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      text += await ocrImageLike(canvas, (pr) => onProgress && onProgress((p - 1 + pr) / pages)) + '\n';
    }
    return text;
  }

  // Öffentlich: Datei → Text (PDF-Text, sonst OCR). onProgress(0..1) optional.
  async function extractText(file, onProgress) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if (isPdf) {
      const { text, doc } = await pdfToText(file);
      if (text.replace(/\s/g, '').length >= 20) return { text, method: 'pdf-text' };
      const ocr = await pdfPagesToText(doc, onProgress); // gescanntes PDF
      return { text: ocr, method: 'pdf-ocr' };
    }
    const text = await ocrImageLike(file, onProgress);
    return { text, method: 'image-ocr' };
  }

  const api = { LIBS, parseReceipt, findAmounts, pickTotal, findDates, detectType, extractText, ensurePdf, ensureOcr };
  if (typeof window !== 'undefined') { (window.qrx = window.qrx || {}).rkReceipts = api; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof self !== 'undefined' ? self : this);
