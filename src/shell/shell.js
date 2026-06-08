(function () {
  'use strict';

  // === Docs toggle ===
  const docsBtn = document.querySelector('[data-action="toggle-docs"]');
  const docs = document.getElementById('qrx-docs');
  docsBtn.addEventListener('click', () => {
    const open = !docs.hasAttribute('hidden');
    if (open) { docs.setAttribute('hidden', ''); docsBtn.setAttribute('aria-expanded', 'false'); }
    else      { docs.removeAttribute('hidden');   docsBtn.setAttribute('aria-expanded', 'true');
                docs.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  // === Version stamp YYMMDD-HHMMSS ===
  const versionEl = document.querySelector('[data-build-version]');
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  versionEl.textContent =
    `${String(d.getFullYear()).slice(2)}${pad(d.getMonth()+1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  // === App state hooks ===
  window.qurixApp = window.qurixApp || {};

  // Capture the pristine app region BEFORE any data is rendered into it, so a
  // blank export can be restored to this clean state. (Runs synchronously at
  // parse time, before DOMContentLoaded / any user interaction.)
  const pristineApp = document.getElementById('qrx-app');
  const pristineAppHTML = pristineApp ? pristineApp.innerHTML : null;

  function hydrate() {
    const el = document.getElementById('qrx-app-state');
    if (!el || !window.qurixApp.hydrateState) return;
    try { window.qurixApp.hydrateState(JSON.parse(el.textContent)); }
    catch (e) { console.warn('qurix: state hydrate failed', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
  } else { hydrate(); }

  // === Export logic ===
  function syncFormState(clone) {
    const liveIn = document.querySelectorAll('input');
    const cIn = clone.querySelectorAll('input');
    liveIn.forEach((live, i) => {
      const c = cIn[i]; if (!c) return;
      if (live.type === 'password' || live.type === 'file') return;
      if (live.type === 'checkbox' || live.type === 'radio') {
        if (live.checked) c.setAttribute('checked', ''); else c.removeAttribute('checked');
      } else { c.setAttribute('value', live.value); }
    });
    const liveTa = document.querySelectorAll('textarea');
    const cTa = clone.querySelectorAll('textarea');
    liveTa.forEach((live, i) => { if (cTa[i]) cTa[i].textContent = live.value; });
    const liveSel = document.querySelectorAll('select');
    const cSel = clone.querySelectorAll('select');
    liveSel.forEach((live, i) => {
      const c = cSel[i]; if (!c) return;
      Array.from(c.options).forEach((opt, j) => {
        if (live.options[j] && live.options[j].selected) opt.setAttribute('selected', '');
        else opt.removeAttribute('selected');
      });
    });
    const liveDet = document.querySelectorAll('details');
    const cDet = clone.querySelectorAll('details');
    liveDet.forEach((live, i) => {
      const c = cDet[i]; if (!c) return;
      if (live.open) c.setAttribute('open', ''); else c.removeAttribute('open');
    });
  }

  function writeAppState(clone) {
    if (!window.qurixApp.serializeState) return;
    let stateData;
    try { stateData = window.qurixApp.serializeState(); }
    catch (e) { console.warn('qurix: state serialize failed', e); return; }
    let s = clone.querySelector('#qrx-app-state');
    if (!s) {
      s = clone.ownerDocument.createElement('script');
      s.type = 'application/json';
      s.id = 'qrx-app-state';
      clone.querySelector('body').appendChild(s);
    }
    s.textContent = JSON.stringify(stateData);
  }

  function download(clone, suffix) {
    const html = '<!DOCTYPE html>\n' + clone.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const title = (document.title || 'qurix-app').replace(/\s+/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}-${versionEl.textContent}${suffix ? '-' + suffix : ''}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  document.querySelector('[data-action="export-html"]').addEventListener('click', () => {
    const clone = document.documentElement.cloneNode(true);
    const oldState = clone.querySelector('#qrx-app-state');
    if (oldState) oldState.remove();
    // Restore the pristine app region — clears any data the app rendered into
    // the DOM (tables, results, lists, etc.) so the blank export is truly blank.
    const cApp = clone.querySelector('#qrx-app');
    if (cApp && pristineAppHTML !== null) cApp.innerHTML = pristineAppHTML;
    download(clone);
  });

  document.querySelector('[data-action="export-html-state"]').addEventListener('click', () => {
    const clone = document.documentElement.cloneNode(true);
    syncFormState(clone);
    writeAppState(clone);
    download(clone, 'snapshot');
  });
})();
