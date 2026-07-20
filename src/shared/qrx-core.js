// ============================================================================
// qrx.core — the DOM-independent basics every qurix app needs.
//
// Included via app.config.json "inlineScripts": "../../shared/qrx-core.js".
// Loaded before the app script, so an app can just call qrx.core.*.
//
// Everything here replaces code that used to exist two to six times over. Where
// the copies differed, the safest variant won; the notes say which and why.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});

  // --- HTML escaping -------------------------------------------------------
  // Escapes five characters, not three: quotes included, so the result is safe
  // in text nodes AND in attributes. That makes the old separate escapeAttr()
  // unnecessary. The null guard renders empty instead of the literal "null".
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --- Downloads -----------------------------------------------------------
  // Accepts a Blob, an ArrayBuffer, a typed array or a string, so the three
  // former signatures (buffer+mime / blob / string+mime) all collapse here.
  // The <a> is attached to the document because Firefox ignores detached ones.
  function download(data, filename, mime) {
    const blob = (data instanceof Blob)
      ? data
      : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // --- Timing --------------------------------------------------------------
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // --- Formatting ----------------------------------------------------------
  // The locale is always explicit. The apps used to disagree silently: the
  // profiler hard-coded de-DE, the converter mixed en-US with the browser
  // default, the cleaner used the browser default. qrx.i18n will later supply
  // the active language; until then every caller states what it wants.
  const DASH = '—';

  function bytes(n) {
    if (n == null || isNaN(n)) return DASH;
    if (n < 1024) return `${n} B`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    // adaptive precision: 12.34 MB, but 123 MB
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
  }

  function number(n, locale) {
    if (n == null) return DASH;
    if (typeof n === 'bigint') return n.toLocaleString(locale);
    const num = Number(n);
    if (isNaN(num)) return DASH;
    return num.toLocaleString(locale);
  }

  function duration(ms) {
    if (ms == null || isNaN(ms)) return DASH;
    if (ms < 1) return '<1 ms';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  }

  // Renders a Date the way its SQL column type implies: DATE without a time,
  // TIME without a date, everything else as "YYYY-MM-DD HH:MM:SS".
  function dateByType(d, colType) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return String(d);
    const T = String(colType || '').toUpperCase();
    const iso = d.toISOString();
    if (T === 'DATE') return iso.slice(0, 10);
    if (T === 'TIME') return iso.slice(11, 19);
    return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
  }

  // --- localStorage --------------------------------------------------------
  // Every access is guarded: private windows, disabled storage and quota
  // errors must never take an app down. Reads fall back, writes report false.
  const storage = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); return true; }
      catch (_) { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); return true; }
      catch (_) { return false; }
    },
    getJSON(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }   // also covers corrupt JSON
    },
    setJSON(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (_) { return false; }
    },
  };

  qrx.core = {
    escapeHtml,
    download,
    debounce,
    fmt: { bytes, number, duration, dateByType, DASH },
    storage,
  };
})();
