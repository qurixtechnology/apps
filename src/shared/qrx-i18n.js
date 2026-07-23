// ============================================================================
// qrx.i18n — German/English for shell, widgets and apps.
//
// Design points that matter:
//
//  * Dictionaries are REGISTERED, not imported. Every widget ships its own
//    strings under its own namespace, so a widget works the same in a German
//    app and an English one. Nothing hard-codes text any more.
//
//  * The starting language comes from <html lang> (the build writes it from
//    app.config.json). A user choice overrides it and is stored under one key
//    for all qurix apps, so the language follows you from app to app.
//
//  * Number and date formats follow the language — one switch, not two
//    settings that can drift apart (which is exactly what happened before:
//    de-DE in the profiler, en-US and browser default in the converter).
//
//  * Static markup uses data-qrx-i18n attributes and is translated in place, so
//    content.html does not have to move into JavaScript.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});

  const SUPPORTED = ['de', 'en'];
  const STORAGE_KEY = 'qrx_lang';
  const LOCALES = { de: 'de-DE', en: 'en-GB' };

  const dicts = Object.create(null);          // namespace -> { de: {...}, en: {...} }
  const listeners = new Set();

  function docLang() {
    const l = (document.documentElement.getAttribute('lang') || '').slice(0, 2).toLowerCase();
    return SUPPORTED.includes(l) ? l : 'en';
  }

  let current = (() => {
    const stored = qrx.core ? qrx.core.storage.get(STORAGE_KEY) : null;
    return SUPPORTED.includes(stored) ? stored : docLang();
  })();

  const registerListeners = new Set();

  function register(namespace, tables) {
    const slot = dicts[namespace] || (dicts[namespace] = { de: {}, en: {} });
    for (const lang of SUPPORTED) Object.assign(slot[lang], (tables && tables[lang]) || {});
    apply();
    registerListeners.forEach(fn => {
      try { fn(namespace); } catch (e) { console.warn('qrx.i18n register listener failed', e); }
    });
    return qrx.i18n;
  }

  // "namespace.key" — falls back to the other language and finally to the key
  // itself, so a missing translation degrades to something readable instead of
  // an empty label.
  function lookup(key, lang) {
    const dot = key.indexOf('.');
    if (dot < 0) return undefined;
    const ns = dicts[key.slice(0, dot)];
    if (!ns) return undefined;
    return ns[lang] ? ns[lang][key.slice(dot + 1)] : undefined;
  }

  function t(key, params) {
    let s = lookup(key, current);
    if (s === undefined) s = lookup(key, current === 'de' ? 'en' : 'de');
    if (s === undefined) return key;
    if (params) {
      s = String(s).replace(/\{(\w+)\}/g, (m, name) =>
        (params[name] === undefined ? m : String(params[name])));
    }
    return s;
  }

  // Translates an element tree in place:
  //   <h2 data-qrx-i18n="app.title">              -> textContent
  //   <input data-qrx-i18n-placeholder="app.hint"> -> placeholder attribute
  //   also -title, -aria-label, -value
  //
  // The attribute is prefixed on purpose: wm2026-spielplan ships its own
  // translation layer that uses the bare data-i18n attribute, and a shared
  // module must never fight an app for its markup.
  //
  // An unresolved key is left alone rather than written into the page — a
  // missing translation should show the original text, not "app.title".
  const ATTRS = ['placeholder', 'title', 'aria-label', 'value'];
  function apply(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return;
    scope.querySelectorAll('[data-qrx-i18n]').forEach(el => {
      const key = el.getAttribute('data-qrx-i18n');
      const val = t(key);
      if (val !== key) el.textContent = val;
    });
    for (const a of ATTRS) {
      scope.querySelectorAll(`[data-qrx-i18n-${a}]`).forEach(el => {
        const key = el.getAttribute(`data-qrx-i18n-${a}`);
        const val = t(key);
        if (val !== key) el.setAttribute(a, val);
      });
    }
    // Whole blocks per language — used for the documentation, which is prose:
    // one key per sentence would be unreadable and unmaintainable.
    const blocks = scope.querySelectorAll('[data-qrx-docs]');
    if (blocks.length) {
      blocks.forEach(el => { el.hidden = el.getAttribute('data-qrx-docs') !== current; });
    }
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === current) return;
    current = lang;
    if (qrx.core) qrx.core.storage.set(STORAGE_KEY, lang);
    document.documentElement.setAttribute('lang', lang);
    apply();
    listeners.forEach(fn => { try { fn(lang); } catch (e) { console.warn('qrx.i18n listener failed', e); } });
  }

  qrx.i18n = {
    SUPPORTED,
    register,
    t,
    apply,
    setLang,
    lang: () => current,
    /** BCP-47 tag for toLocaleString etc. — derived from the language. */
    locale: () => LOCALES[current],
    /** True once the app itself has registered strings (the shell uses this
     *  to decide whether offering a language switch would help or would only
     *  produce a half-translated screen). */
    hasNamespace: (ns) => !!dicts[ns],
    /** Test/debug view of what is registered. */
    dicts: () => dicts,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Fires when a dictionary is registered — an app may do that long after
     *  the shell has rendered. */
    onRegister(fn) { registerListeners.add(fn); return () => registerListeners.delete(fn); },
  };

  // translate whatever is already in the document
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else { apply(); }
})();
