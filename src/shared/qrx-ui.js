// ============================================================================
// qrx.ui — reusable widgets. Each one owns its markup, its CSS classes and its
// texts; an app places a mount point and passes callbacks. Nothing here reaches
// back into an app.
//
// Texts come from qrx.i18n, which is what makes a widget usable in the German
// profiler and the English converter at the same time.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});
  const ui = (qrx.ui = qrx.ui || {});
  const esc = (s) => qrx.core.escapeHtml(s);

  qrx.i18n.register('ui', {
    de: { close: 'Schließen', cancel: 'Abbrechen', ok: 'OK' },
    en: { close: 'Close', cancel: 'Cancel', ok: 'OK' },
  });

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),'
    + 'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  /**
   * A modal dialog. Three visibility mechanisms existed across the apps
   * (hidden attribute, .active, .open) and none of them trapped focus or
   * restored it on close — a keyboard user could tab out of the dialog into
   * the page behind it. This one does both.
   *
   * opts: { title, titleKey, hint, hintKey, body (HTMLElement|string),
   *         actions: [{ key, label, labelKey, primary, onClick }],
   *         onClose, closeOnBackdrop = true, closeOnEscape = true }
   */
  ui.modal = function modal(opts = {}) {
    const root = document.createElement('div');
    root.className = 'qrx-modal';
    root.hidden = true;
    const titleId = 'qrx-modal-title-' + Math.random().toString(36).slice(2, 8);

    root.innerHTML = `
      <div class="qrx-modal-card" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <h3 class="qrx-modal-title" id="${titleId}"></h3>
        <p class="qrx-modal-hint" hidden></p>
        <div class="qrx-modal-body"></div>
        <p class="qrx-modal-status" hidden></p>
        <div class="qrx-modal-actions"></div>
      </div>`;
    const card = root.querySelector('.qrx-modal-card');
    const titleEl = root.querySelector('.qrx-modal-title');
    const hintEl = root.querySelector('.qrx-modal-hint');
    const bodyEl = root.querySelector('.qrx-modal-body');
    const statusEl = root.querySelector('.qrx-modal-status');
    const actionsEl = root.querySelector('.qrx-modal-actions');

    const T = (text, key) => (key ? qrx.i18n.t(key) : (text || ''));

    function renderTexts() {
      titleEl.textContent = T(opts.title, opts.titleKey);
      const hint = T(opts.hint, opts.hintKey);
      hintEl.hidden = !hint;
      if (hint) hintEl.innerHTML = opts.hintHtml ? hint : esc(hint);
      [...actionsEl.children].forEach((btn) => {
        const a = opts.actions[Number(btn.dataset.index)];
        const label = T(a.label, a.labelKey);
        // An action declared without a label is managed by the caller (the
        // connect dialog switches its primary button between "Connect" and
        // "Load table"), so leave it alone instead of blanking it.
        if (label) btn.textContent = label;
      });
    }

    opts.actions = opts.actions || [];
    opts.actions.forEach((a, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qrx-btn' + (a.primary ? ' qrx-btn-primary' : '');
      btn.dataset.index = String(i);
      if (a.key) btn.dataset.key = a.key;
      btn.addEventListener('click', () => a.onClick && a.onClick(api));
      actionsEl.appendChild(btn);
    });

    if (opts.body instanceof Node) bodyEl.appendChild(opts.body);
    else if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body;

    let lastFocused = null;

    function onKeydown(e) {
      if (e.key === 'Escape' && opts.closeOnEscape !== false) { e.stopPropagation(); api.close(); return; }
      if (e.key !== 'Tab') return;
      // focus trap: cycle inside the dialog instead of escaping into the page
      const items = [...card.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    root.addEventListener('click', (e) => {
      if (e.target === root && opts.closeOnBackdrop !== false) api.close();
    });
    root.addEventListener('keydown', onKeydown);
    qrx.i18n.onChange(renderTexts);

    const api = {
      el: root,
      body: bodyEl,
      button: (key) => actionsEl.querySelector(`[data-key="${key}"]`),
      open(focusSelector) {
        if (!root.isConnected) document.body.appendChild(root);
        lastFocused = document.activeElement;
        renderTexts();
        api.setStatus('');
        root.hidden = false;
        setTimeout(() => {
          const target = (focusSelector && card.querySelector(focusSelector))
            || card.querySelector(FOCUSABLE);
          if (target) target.focus();
        }, 0);
        return api;
      },
      close() {
        if (root.hidden) return api;
        root.hidden = true;
        if (opts.onClose) opts.onClose();
        // give focus back to whatever opened the dialog
        if (lastFocused && lastFocused.isConnected) { try { lastFocused.focus(); } catch (_) {} }
        return api;
      },
      isOpen: () => !root.hidden,
      setStatus(msg, kind) {
        statusEl.hidden = !msg;
        statusEl.textContent = msg || '';
        statusEl.className = 'qrx-modal-status' + (kind ? ' is-' + kind : '');
        return api;
      },
      setBusy(busy) {
        actionsEl.querySelectorAll('button').forEach(b => { b.disabled = !!busy; });
        card.classList.toggle('is-busy', !!busy);
        return api;
      },
      setTitle(text, key) { opts.title = text; opts.titleKey = key; renderTexts(); return api; },
      destroy() { qrx.i18n.onChange(() => {}); root.remove(); },
    };

    renderTexts();
    return api;
  };

  /**
   * A status bar: one line of state, with a spinner while something is running.
   *
   * Merged from the converter and the cleaner (near-identical copies). The
   * spinner is suppressed for terminal states, success messages clear
   * themselves after a moment, and — new — the element is an ARIA live region,
   * so a screen reader announces the change. Only markdown-display's toast had
   * that before.
   */
  ui.status = function status(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.status: mount element not found');
    el.className = 'qrx-status';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="qrx-status-spinner" aria-hidden="true"></span><span class="qrx-status-text"></span>';
    const spinner = el.querySelector('.qrx-status-spinner');
    const textEl = el.querySelector('.qrx-status-text');
    const successMs = opts.successMs || 2500;
    let timer = null;

    function set(text, kind) {
      if (timer) { clearTimeout(timer); timer = null; }
      if (!text) { el.hidden = true; textEl.textContent = ''; return api; }
      el.hidden = false;
      textEl.textContent = text;
      el.classList.toggle('is-error', kind === 'error');
      el.classList.toggle('is-warn', kind === 'warn');
      el.classList.toggle('is-success', kind === 'success');
      const terminal = kind === 'error' || kind === 'warn' || kind === 'success';
      spinner.style.display = terminal ? 'none' : '';
      if (kind === 'success') {
        timer = setTimeout(() => { if (textEl.textContent === text) set(''); }, successMs);
      }
      return api;
    }

    const api = { el, set, clear: () => set(''), text: () => textEl.textContent };
    set('');
    return api;
  };

  /**
   * A drop zone with a click-to-pick fallback.
   *
   * Merged from four implementations:
   *  - the profiler's enter/leave DEPTH COUNTER (without it the highlight
   *    flickers whenever the pointer crosses a child element) and its
   *    DataTransferItemList extraction, which skips dropped directories,
   *  - the converter's keyboard activation and ARIA, so the zone is usable
   *    without a mouse,
   *  - resetting the input after every pick, so choosing the same file twice
   *    in a row still fires.
   *
   * It also ignores clicks that start on a control INSIDE the zone. Both apps
   * with a button in their drop zone had shipped the same bug: the click
   * bubbled up and opened the file dialog on top of the dialog the button had
   * just opened. Solving it here means no app has to remember stopPropagation.
   *
   * opts: { input, accept, multiple, activeClass, label, onFiles, extraTargets }
   */
  ui.dropzone = function dropzone(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.dropzone: mount element not found');
    const activeClass = opts.activeClass || 'is-dragover';
    const onFiles = opts.onFiles || (() => {});

    let input = opts.input || el.querySelector('input[type="file"]');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.hidden = true;
      el.appendChild(input);
    }
    if (opts.accept) input.accept = opts.accept;
    input.multiple = !!opts.multiple;

    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (opts.label) el.setAttribute('aria-label', opts.label);

    function deliver(files) {
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length) return;
      onFiles(opts.multiple ? list : [list[0]]);
    }

    function pick() { input.click(); }

    // A dropped directory yields an entry with no File — dt.items lets us skip
    // those; dt.files is the fallback for browsers that do not populate items.
    function filesFromDrop(e) {
      const dt = e.dataTransfer;
      if (!dt) return [];
      const out = [];
      if (dt.items && dt.items.length) {
        for (const it of dt.items) {
          if (it && it.kind === 'file') {
            const f = it.getAsFile();
            if (f) out.push(f);
          }
        }
      }
      return out.length ? out : (dt.files ? Array.from(dt.files) : []);
    }

    function wireTarget(target) {
      let depth = 0;
      target.addEventListener('dragenter', (e) => {
        e.preventDefault(); e.stopPropagation();
        depth++; target.classList.add(activeClass);
      });
      target.addEventListener('dragleave', (e) => {
        e.preventDefault(); e.stopPropagation();
        depth--; if (depth <= 0) { depth = 0; target.classList.remove(activeClass); }
      });
      target.addEventListener('dragover', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      target.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        depth = 0; target.classList.remove(activeClass);
        deliver(filesFromDrop(e));
      });
    }

    wireTarget(el);
    (opts.extraTargets || []).forEach(t => { if (t) wireTarget(t); });

    el.addEventListener('click', (e) => {
      // a control inside the zone does its own thing
      if (e.target !== el && e.target.closest('button,a,input,select,textarea,label')) return;
      pick();
    });
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;                 // let inner controls keep their keys
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    input.addEventListener('change', () => {
      deliver(input.files);
      input.value = '';                            // same file twice must work
    });

    return { el, input, pick, deliver };
  };

  /**
   * The "what is loaded" bar: icon, name, one line of metadata, and a button
   * to start over. Identical in the converter and the cleaner, down to the
   * markup.
   *
   * opts: { onReset, resetLabelKey }
   */
  qrx.i18n.register('fileInfo', {
    de: { reset: 'Andere Datei laden' },
    en: { reset: 'Load another file' },
  });

  ui.fileInfo = function fileInfo(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.fileInfo: mount element not found');
    el.className = 'qrx-fileinfo';
    el.innerHTML = `
      <div class="qrx-fileinfo-left">
        <div class="qrx-fileinfo-icon"></div>
        <div style="min-width: 0;">
          <div class="qrx-fileinfo-name"></div>
          <div class="qrx-fileinfo-meta"></div>
        </div>
      </div>
      <div><button class="qrx-btn" type="button" data-role="reset"></button></div>`;

    const iconEl = el.querySelector('.qrx-fileinfo-icon');
    const nameEl = el.querySelector('.qrx-fileinfo-name');
    const metaEl = el.querySelector('.qrx-fileinfo-meta');
    const resetBtn = el.querySelector('[data-role="reset"]');

    const label = () => qrx.i18n.t(opts.resetLabelKey || 'fileInfo.reset');
    resetBtn.textContent = label();
    qrx.i18n.onChange(() => { resetBtn.textContent = label(); });
    if (opts.onReset) resetBtn.addEventListener('click', opts.onReset);

    const api = {
      el,
      show({ icon, name, meta } = {}) {
        if (icon !== undefined) iconEl.textContent = icon;
        if (name !== undefined) nameEl.textContent = name;
        if (meta !== undefined) metaEl.textContent = meta;
        el.hidden = false;
        return api;
      },
      setMeta(meta) { metaEl.textContent = meta; return api; },
      hide() { el.hidden = true; return api; },
    };
    el.hidden = true;
    return api;
  };

  qrx.i18n.register('sourcePicker', {
    de: {
      confirmTitle: 'Große Datei',
      confirmHint: '{name} ({size}) wird einmalig nach Parquet umgeschrieben, damit die '
        + 'Analyse danach schnell bleibt. Das dauert einen Moment und belegt Arbeitsspeicher.',
      confirmGo: 'Umschreiben',
      converterLink: 'Zum Table Format Converter',
    },
    en: {
      confirmTitle: 'Large file',
      confirmHint: '{name} ({size}) will be rewritten to Parquet once, so the analysis '
        + 'stays fast afterwards. This takes a moment and uses memory.',
      confirmGo: 'Rewrite',
      converterLink: 'Open the Table Format Converter',
    },
  });

  // A single reusable "this file is large, rewrite it?" dialog. Returns a
  // Promise<boolean>. Shared so the sourcePicker and the profiler's own
  // multi-file loader ask the same question the same way. `file` needs only
  // { name, size }.
  let largeConfirmModal = null;
  ui.confirmLargeFile = function confirmLargeFile(file) {
    const T = (k, p) => qrx.i18n.t('sourcePicker.' + k, p);
    return new Promise((resolve) => {
      const hint = T('confirmHint', { name: file.name, size: qrx.core.fmt.bytes(file.size) });
      if (!largeConfirmModal) {
        largeConfirmModal = ui.modal({
          titleKey: 'sourcePicker.confirmTitle',
          actions: [
            { key: 'cancel', labelKey: 'ui.cancel', onClick: (m) => m.close() },
            { key: 'go', labelKey: 'sourcePicker.confirmGo', primary: true,
              onClick: (m) => { largeConfirmModal._go = true; m.close(); } },
          ],
          onClose: () => {
            const go = !!largeConfirmModal._go; largeConfirmModal._go = false;
            const done = largeConfirmModal._resolve; largeConfirmModal._resolve = null;
            if (done) done(go);
          },
        });
      }
      largeConfirmModal._go = false;
      largeConfirmModal._resolve = resolve;
      largeConfirmModal.setTitle(undefined, 'sourcePicker.confirmTitle');
      const h = largeConfirmModal.el.querySelector('.qrx-modal-hint');
      h.textContent = hint; h.hidden = false;
      largeConfirmModal.open('[data-key="go"]');
    });
  };

  qrx.i18n.register('tablePicker', {
    de: {
      title: 'Tabelle wählen',
      hint: 'Diese Datei enthält mehrere Tabellen/Blätter. Welche soll geladen werden?',
      pick: 'Laden', rows: 'Zeilen',
    },
    en: {
      title: 'Choose a table',
      hint: 'This file holds several tables/sheets. Which one should be loaded?',
      pick: 'Load', rows: 'rows',
    },
  });

  // Ask which table/sheet to load from a multi-table source (DuckDB/SQLite files,
  // Excel workbooks). Resolves to the chosen name, or null if cancelled. With a
  // single item it resolves immediately without a dialog. `items` is a list of
  // { name, rows?, label? } (or bare strings).
  ui.tablePicker = function tablePicker(items, opts = {}) {
    const list = (items || []).map((it) => (typeof it === 'string' ? { name: it } : it))
      .filter((x) => x && x.name != null);
    if (list.length <= 1) return Promise.resolve(list.length ? list[0].name : null);
    const esc = qrx.core.escapeHtml;
    const T = (k, p) => qrx.i18n.t('tablePicker.' + k, p);
    return new Promise((resolve) => {
      let picked = list[0].name;
      const body = document.createElement('div');
      body.className = 'qrx-picker';
      body.innerHTML = list.map((it, i) => {
        const meta = it.rows != null ? ` <span class="qrx-picker-meta">${esc(qrx.core.fmt.number(it.rows))} ${esc(T('rows'))}</span>` : '';
        return `<label><input type="radio" name="qrx-tp" value="${esc(it.name)}"${i === 0 ? ' checked' : ''}>`
          + `<span>${esc(it.label || it.name)}</span>${meta}</label>`;
      }).join('');
      body.addEventListener('change', (e) => { const r = e.target.closest('input[type=radio]'); if (r) picked = r.value; });
      const m = ui.modal({
        titleKey: 'tablePicker.title', hintKey: 'tablePicker.hint', body,
        actions: [
          { key: 'cancel', labelKey: 'ui.cancel', onClick: (mm) => mm.close() },
          { key: 'go', labelKey: 'tablePicker.pick', primary: true, onClick: (mm) => { m._picked = picked; mm.close(); } },
        ],
        onClose: () => { const v = m._picked || null; m.destroy(); resolve(v); },
      });
      m.open('[data-key="go"]');
    });
  };

  /**
   * The whole "get a file in" step: drop zone, format detection, normalisation
   * and the messages around it. Wraps ui.dropzone and qrx.source so an app no
   * longer knows what a Parquet is — it receives a descriptor and queries
   * `desc.from`.
   *
   * Two things it handles that a plain dropzone cannot:
   *  - a format DuckDB can't read here (Excel, SQLite, …) becomes a readable
   *    message plus a link to the converter, not a stack trace,
   *  - a large file that needs rewriting is CONFIRMED first. There is no
   *    reliable way to cancel a running COPY in duckdb-wasm, so the question
   *    comes before the work rather than as a cancel button during it.
   *
   * opts: { input, accept, multiple, combine, label, extraTargets, activeClass,
   *         status,          // a qrx.ui.status api (or anything with .set)
   *         confirmBytes,    // ask before rewriting above this size (0 = never)
   *         blockBytes,      // refuse an in-browser rewrite above this size
   *         converterHref,   // shown when a format needs the converter
   *         onSource(desc), onError(err) }
   *
   * With `combine`, dropping several files of the SAME type yields one merged
   * source (UNION ALL BY NAME); without it, each file is opened on its own.
   */
  ui.sourcePicker = function sourcePicker(mount, opts = {}) {
    const policy = {
      confirmBytes: opts.confirmBytes != null ? opts.confirmBytes : qrx.source.CONFIRM_BYTES,
      blockBytes: opts.blockBytes != null ? opts.blockBytes : qrx.source.BLOCK_BYTES,
    };
    // Multi-table sources (DuckDB/SQLite files, Excel) ask which table to load.
    const pickTable = opts.pickTable || ui.tablePicker;
    const status = opts.status || null;
    const say = (msg, kind) => { if (status && status.set) status.set(msg || '', kind); };

    let current = null;

    const zone = ui.dropzone(mount, {
      input: opts.input,
      accept: opts.accept || qrx.source.ACCEPT,
      multiple: !!opts.multiple,
      label: opts.label,
      activeClass: opts.activeClass,
      extraTargets: opts.extraTargets,
      onFiles: (files) => { queue(files); },
    });

    // Files are opened one after another, never concurrently: each one runs a
    // COPY through the same DuckDB connection, and two of those in flight would
    // compete for the same WASM heap.
    let chain = Promise.resolve();
    function queue(files) {
      const list = Array.from(files || []).filter(Boolean);
      if (!list.length) return;
      if (opts.combine && list.length > 1) { chain = chain.then(() => openCombined(list)).catch(() => {}); return; }
      for (const f of list) chain = chain.then(() => open(f)).catch(() => {});
    }

    function fail(err) {
      if (err && err.code === 'cancelled') { say(''); return; }   // user closed the table picker
      say(err && err.message ? err.message : String(err), 'error');
      if (opts.onError) opts.onError(err);
      else console.warn('qrx.ui.sourcePicker:', err);
    }

    // Turn a preflight 'block' into a typed, link-carrying error.
    function blocked(p) {
      const err = new Error(p.message);
      err.code = p.supported === false ? 'unsupported-format' : 'too-large';
      err.kind = p.kind;
      if (p.recommendConverter) err.converterHref = opts.converterHref || null;
      return err;
    }

    async function open(file) {
      try {
        const p = await qrx.source.preflight(file, policy);
        if (p.decision === 'block') throw blocked(p);
        if (p.decision === 'confirm' && !await ui.confirmLargeFile(file)) { say(''); return null; }
        const desc = await qrx.source.open(file, { kind: p.kind, onStatus: (m) => say(m), pickTable });
        return deliver(desc);
      } catch (err) { fail(err); return null; }
    }

    async function openCombined(list) {
      try {
        const p = await qrx.source.preflightMany(list, policy);
        if (p.decision === 'block') throw blocked(p);
        if (p.decision === 'confirm'
            && !await ui.confirmLargeFile({ name: qrx.i18n.t('source.nFiles', { n: list.length }), size: p.bytes })) {
          say(''); return null;
        }
        const desc = await qrx.source.openMany(list, { onStatus: (m) => say(m), pickTable });
        return deliver(desc);
      } catch (err) { fail(err); return null; }
    }

    function deliver(desc) {
      current = desc;
      say(desc.warnings.length ? desc.warnings.join(' ') : '', desc.warnings.length ? 'warn' : undefined);
      if (opts.onSource) opts.onSource(desc);
      return desc;
    }

    return {
      el: zone.el,
      input: zone.input,
      pick: zone.pick,
      open,
      deliver: (files) => queue(files),
      current: () => current,
      async release() {
        if (!current) return;
        const d = current; current = null;
        await qrx.source.release(d);
      },
      destroy() {},
    };
  };

  qrx.i18n.register('grid', {
    de: {
      prev: '‹ Zurück', next: 'Weiter ›', noRows: 'Keine Zeilen',
      rangeOf: 'Zeilen {from}–{to} von {total} · Seite {page}/{pages}',
      range: 'Zeilen {from}–{to} · Seite {page}',
    },
    en: {
      prev: '‹ Prev', next: 'Next ›', noRows: 'No rows',
      rangeOf: 'Rows {from}–{to} of {total} · page {page}/{pages}',
      range: 'Rows {from}–{to} · page {page}',
    },
  });

  /**
   * Prev / page info / next. The wording and the disabled logic were written
   * twice; the converter's version also handles the case where the total is
   * unknown (a streamed query result), which is kept here.
   *
   * opts: { pageSize, onPage(page) }
   */
  ui.pager = function pager(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.pager: mount element not found');
    const pageSize = opts.pageSize || 100;
    el.className = 'qrx-pager';
    el.innerHTML = '<button class="qrx-btn" type="button" data-role="prev"></button>'
      + '<span class="qrx-pager-info" data-role="info"></span>'
      + '<button class="qrx-btn" type="button" data-role="next"></button>';
    const prev = el.querySelector('[data-role="prev"]');
    const next = el.querySelector('[data-role="next"]');
    const info = el.querySelector('[data-role="info"]');
    let page = 0;

    function labels() {
      prev.textContent = qrx.i18n.t('grid.prev');
      next.textContent = qrx.i18n.t('grid.next');
    }
    labels();
    qrx.i18n.onChange(labels);
    prev.addEventListener('click', () => opts.onPage && opts.onPage(Math.max(0, page - 1)));
    next.addEventListener('click', () => opts.onPage && opts.onPage(page + 1));

    const api = {
      el,
      /** total may be null when it is not known (then paging is open-ended). */
      set({ page: p = 0, total = null, got = null } = {}) {
        page = Math.max(0, p);
        const n = (got == null) ? pageSize : got;
        const lastPage = (total != null && total > 0) ? Math.ceil(total / pageSize) - 1 : null;
        const from = (total === 0 || n === 0) ? 0 : page * pageSize + 1;
        const to = page * pageSize + n;
        const fmt = (x) => qrx.core.fmt.number(x, qrx.i18n.locale());
        info.textContent = (total != null)
          ? qrx.i18n.t('grid.rangeOf', { from: fmt(from), to: fmt(to), total: fmt(total),
                                         page: page + 1, pages: Math.max(1, (lastPage ?? 0) + 1) })
          : qrx.i18n.t('grid.range', { from: fmt(from), to: fmt(to), page: page + 1 });
        prev.disabled = page <= 0;
        next.disabled = (lastPage != null) ? (page >= lastPage) : (n < pageSize);
        el.hidden = (total != null && total <= pageSize && page === 0);
        return api;
      },
      hide() { el.hidden = true; return api; },
      page: () => page,
    };
    return api;
  };

  /**
   * A read-only result table: sticky header, NULL marked as such, numeric
   * columns right-aligned. Values are rendered by qrx.duckdb.cellText, so a
   * date looks the same here as in every other table — the converter used to
   * format dates one way in its preview and another in its SQL results.
   */
  ui.resultGrid = function resultGrid(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.resultGrid: mount element not found');
    const esc = qrx.core.escapeHtml;
    // The apps genuinely disagree here: the profiler shows grouped numbers in
    // its German UI, the converter shows them raw. That stays a choice.
    const localeNumbers = !!opts.localeNumbers;
    const cell = (v, type) => (localeNumbers && typeof v === 'number')
      ? qrx.core.fmt.number(v, qrx.i18n.locale())
      : qrx.duckdb.cellText(v, type);

    const api = {
      el,
      clear() { el.innerHTML = ''; return api; },
      /** @returns {number} rows rendered */
      render(result) {
        const fields = qrx.duckdb.fields(result.schema);
        // Go through the shared conversion, not result.toArray(): Arrow hands
        // DATE/TIMESTAMP back as raw numbers, and both apps used to print them
        // as epoch milliseconds in their SQL results while their previews
        // showed proper dates.
        const rows = qrx.duckdb.rows(result);
        let html = '<table class="qrx-grid"><thead><tr>';
        if (!fields.length) html += '<th>—</th>';
        for (const f of fields) html += `<th>${esc(f.name)}</th>`;
        html += '</tr></thead><tbody>';
        if (!rows.length) {
          html += `<tr><td class="qrx-grid-empty" colspan="${Math.max(1, fields.length)}">`
            + `${esc(qrx.i18n.t('grid.noRows'))}</td></tr>`;
        }
        for (const r of rows) {
          html += '<tr>';
          for (const f of fields) {
            const v = r[f.name];
            html += (v == null)
              ? '<td class="qrx-grid-null">null</td>'
              : `<td${f.typeClass === 't-number' ? ' class="qrx-grid-num"' : ''}>`
                + `${esc(cell(v, f.type))}</td>`;
          }
          html += '</tr>';
        }
        el.innerHTML = html + '</tbody></table>';
        return rows.length;
      },
    };
    return api;
  };

  /**
   * SQL editor behaviour for a <textarea>, with optional autocompletion.
   *
   * The panels around it (table chips, examples, export buttons) stay per app;
   * this is the editor behaviour, which was duplicated and had drifted (only
   * the profiler indented with Tab). Completion is opt-in: pass a `completions`
   * provider and the app keeps full control of the schema and the values.
   *
   * A <textarea> cannot highlight syntax (it renders no markup), so this offers
   * completion but not colouring; a real editor library would be a separate,
   * larger step.
   *
   * opts:
   *   onRun(value), onChange(value), indent
   *   completions: () => ({
   *     tables:  string[],                    // e.g. ['data','hello']
   *     columns: { [table]: string[] },       // known columns per table
   *     keywords: string[] | 'sql',           // 'sql' = the built-in DuckDB set
   *     values?: (table, column, prefix) => Promise<string[]>  // insert-ready literals
   *   })
   */
  const SQL_KEYWORDS = ('SELECT FROM WHERE GROUP BY HAVING ORDER LIMIT OFFSET JOIN LEFT RIGHT '
    + 'FULL INNER OUTER ON USING AS AND OR NOT NULL IS IN LIKE ILIKE BETWEEN DISTINCT UNION '
    + 'ALL CASE WHEN THEN ELSE END ASC DESC COUNT SUM AVG MIN MAX CAST TRY_CAST OVER PARTITION '
    + 'WITH DESCRIBE SUMMARIZE PIVOT UNPIVOT QUALIFY EXCLUDE').split(' ');

  ui.sqlEditor = function sqlEditor(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.sqlEditor: mount element not found');
    const indent = opts.indent || '  ';
    const hasCompletion = typeof opts.completions === 'function';

    // --- completion popup ---------------------------------------------------
    let pop = null, items = [], active = -1, valueSeq = 0;

    function closePopup() {
      if (pop) { pop.remove(); pop = null; }
      items = []; active = -1;
    }

    // Pixel position of the caret, via the classic hidden-mirror technique: a
    // div styled exactly like the textarea, holding the text up to the caret,
    // with a marker span whose offset is the caret.
    function caretPos() {
      const style = getComputedStyle(el);
      const div = document.createElement('div');
      const props = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
        'textTransform', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom',
        'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'boxSizing'];
      props.forEach(p => { div.style[p] = style[p]; });
      div.style.position = 'absolute';
      div.style.visibility = 'hidden';
      div.style.whiteSpace = 'pre-wrap';
      div.style.wordWrap = 'break-word';
      div.style.overflow = 'hidden';
      div.style.width = el.clientWidth + 'px';
      div.textContent = el.value.slice(0, el.selectionStart);
      const span = document.createElement('span');
      span.textContent = '​';
      div.appendChild(span);
      document.body.appendChild(div);
      const r = el.getBoundingClientRect();
      const lh = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.3);
      const x = r.left + span.offsetLeft - el.scrollLeft;
      const y = r.top + span.offsetTop - el.scrollTop;
      div.remove();
      return { x, y, lineHeight: lh };
    }

    // What is being typed, and what kind of thing fits here.
    function analyze() {
      const before = el.value.slice(0, el.selectionStart);
      const tokenM = /[\w".]*$/.exec(before);
      const token = tokenM ? tokenM[0] : '';
      const head = before.slice(0, before.length - token.length);

      // value position: "<col> = '<prefix>"  (also != <> < > <= >= LIKE ILIKE, IN ( )
      const valM = /([\w".]+)\s*(?:=|!=|<>|<=|>=|<|>|i?like|in\s*\()\s*'?([^'\s]*)$/i.exec(before);
      if (valM && !/[.]$/.test(token)) {
        return { kind: 'value', column: valM[1].replace(/"/g, ''), prefix: valM[2] || '' };
      }
      // qualified column: "table."
      if (token.includes('.')) {
        const [tbl, part] = token.split('.');
        return { kind: 'column', table: tbl.replace(/"/g, ''), prefix: part || '' };
      }
      // table position: right after FROM / JOIN / INTO / UPDATE
      if (/\b(from|join|into|update)\s+[\w"]*$/i.test(head + token)) {
        return { kind: 'table', prefix: token };
      }
      return { kind: 'any', prefix: token };
    }

    function snapshot() {
      const c = (opts.completions && opts.completions()) || {};
      const kw = c.keywords === 'sql' || c.keywords == null ? SQL_KEYWORDS : c.keywords;
      return { tables: c.tables || [], columns: c.columns || {}, keywords: kw, values: c.values };
    }

    // Which table does an (unqualified) column belong to?
    function tableOfColumn(snap, col) {
      const hit = Object.keys(snap.columns).find(t => (snap.columns[t] || []).includes(col));
      return hit || snap.tables[0] || null;
    }

    function buildList(ctx, snap) {
      const pre = ctx.prefix.toLowerCase();
      const starts = (s) => s.toLowerCase().startsWith(pre);
      const list = [];
      const add = (label, type, insert) => list.push({ label, type, insert: insert == null ? label : insert });

      if (ctx.kind === 'table') {
        snap.tables.filter(starts).forEach(t => add(t, 'table'));
      } else if (ctx.kind === 'column') {
        (snap.columns[ctx.table] || []).filter(starts).forEach(c => add(c, 'column'));
      } else {
        // 'any' — columns first (most useful), then tables, then keywords
        const cols = new Set();
        Object.values(snap.columns).forEach(arr => (arr || []).forEach(c => cols.add(c)));
        [...cols].filter(starts).forEach(c => add(c, 'column'));
        snap.tables.filter(starts).forEach(t => add(t, 'table'));
        snap.keywords.filter(k => k.toLowerCase().startsWith(pre)).forEach(k => add(k, 'keyword'));
      }
      return list.slice(0, 30);
    }

    function renderPopup(ctx) {
      if (!items.length) { closePopup(); return; }
      if (!pop) {
        pop = document.createElement('div');
        pop.className = 'qrx-sql-pop';
        document.body.appendChild(pop);
        pop.addEventListener('mousedown', (e) => {
          const li = e.target.closest('[data-i]');
          if (li) { e.preventDefault(); accept(Number(li.dataset.i)); }
        });
      }
      pop.innerHTML = items.map((it, i) =>
        `<div class="qrx-sql-pop-item${i === active ? ' is-active' : ''}" data-i="${i}">`
        + `<span class="qrx-sql-pop-kind qrx-sql-pop-${it.type}">${it.type[0].toUpperCase()}</span>`
        + `<span class="qrx-sql-pop-label">${qrx.core.escapeHtml(it.label)}</span></div>`).join('');
      const p = caretPos();
      pop.style.left = Math.round(p.x) + 'px';
      pop.style.top = Math.round(p.y + p.lineHeight + 2) + 'px';
      const activeEl = pop.children[active];
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }

    function accept(i) {
      const it = items[i];
      if (!it) return;
      const start = el.selectionStart;
      const before = el.value.slice(0, start);
      const prefixLen = (/[\w".']*$/.exec(before)[0] || '').length;
      const from = start - prefixLen;
      el.value = el.value.slice(0, from) + it.insert + el.value.slice(start);
      const caret = from + it.insert.length;
      el.selectionStart = el.selectionEnd = caret;
      closePopup();
      el.focus();
      if (opts.onChange) opts.onChange(el.value);
    }

    async function updateCompletion() {
      if (!hasCompletion) return;
      const ctx = analyze();
      const snap = snapshot();

      if (ctx.kind === 'value' && snap.values) {
        const table = tableOfColumn(snap, ctx.column);
        const seq = ++valueSeq;
        items = [{ label: '…', type: 'value', insert: '' }];  // loading hint
        active = -1;
        renderPopup(ctx);
        let vals = [];
        try { vals = await snap.values(table, ctx.column, ctx.prefix); } catch (_) { vals = []; }
        if (seq !== valueSeq) return;                          // a newer keystroke won
        items = vals.slice(0, 30).map(v => ({ label: String(v), type: 'value', insert: String(v) }));
        active = items.length ? 0 : -1;
        renderPopup(ctx);
        return;
      }

      // only offer once there is at least one character to filter on, so the
      // popup does not appear on every space
      if (!ctx.prefix && ctx.kind === 'any') { closePopup(); return; }
      items = buildList(ctx, snap);
      active = items.length ? 0 : -1;
      renderPopup(ctx);
    }

    // --- key handling -------------------------------------------------------
    el.addEventListener('keydown', (e) => {
      if (pop) {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; renderPopup(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; renderPopup(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(active); return; }
        if (e.key === 'Escape') { e.preventDefault(); closePopup(); return; }
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = el;
        el.value = el.value.slice(0, a) + indent + el.value.slice(b);
        el.selectionStart = el.selectionEnd = a + indent.length;
        if (opts.onChange) opts.onChange(el.value);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (opts.onRun) opts.onRun(el.value);
      } else if (e.ctrlKey && e.key === ' ' && hasCompletion) {
        e.preventDefault();
        updateCompletion();
      }
    });

    el.addEventListener('input', () => {
      if (opts.onChange) opts.onChange(el.value);
      if (hasCompletion) updateCompletion();
    });
    el.addEventListener('blur', () => setTimeout(closePopup, 120));   // let a click land
    el.addEventListener('scroll', () => { if (pop) renderPopup(); });

    return {
      el,
      value: () => el.value,
      set(v) { el.value = v; if (opts.onChange) opts.onChange(v); return this; },
      focus() { el.focus(); return this; },
      closeCompletion: closePopup,
    };
  };

  qrx.i18n.register('patterns', {
    de: {
      exactLength: 'Exakte Länge', compact: 'Kompakt (\\d+)',
      pattern: 'Muster', count: 'Anzahl', share: 'Anteil', example: 'Beispiel', regex: 'Regex',
      copy: 'kopieren', copied: 'kopiert',
      distinctPatterns: '{n} verschiedene {kind}Muster', kindCompact: 'Kompakt-',
      showingTop: '(oben {n})', nulls: '{n} null', empty: '∅ (leer)', nullRow: '(null)',
      analyzing: 'Analysiere …',
      outlierSummary: '{n} Werte ({pct} %) weichen vom dominanten Muster ab',
      uniform: 'Einheitlich – keine Musterausreißer',
      noDominant: 'Kein dominantes Muster – zu heterogen für eine Ausreißerprüfung',
      showOutliers: 'Zeilen anzeigen', outlierRowsMeta: '{shown} von {total} Ausreißern',
      noOutlierRows: 'Keine abweichenden Zeilen gefunden.',
      segments: 'Segmente', segPrefix: 'Präfix', segSuffix: 'Suffix', segToken: 'Token/Wort',
      segEmpty: 'Keine wiederkehrenden Segmente gefunden.',
      segLegend: 'Wiederkehrende Literale: Präfix (führender Teil + Trenner, z. B. BAU_), '
        + 'Suffix (Trenner + Endteil, z. B. _LTD), Token (Wörter, auch aus CamelCase, z. B. POWER).',
      findSubstrings: 'Eingebettete Teilstrings suchen',
      segSubstring: 'Teilstring', subMeta: 'auf Stichprobe von {n} Zeilen',
      subEmpty: 'Keine häufigen Teilstrings gefunden.',
      legend: 'Maske: A Großbuchstabe · a Kleinbuchstabe · 9 Ziffer · andere Zeichen bleiben. '
        + 'Exakte Länge behält die Lauflänge (999 ⇒ \\d{3}); Kompakt fasst jede Folge zusammen (9+ ⇒ \\d+).',
    },
    en: {
      exactLength: 'Exact length', compact: 'Compact (\\d+)',
      pattern: 'Pattern', count: 'Count', share: 'Share', example: 'Example', regex: 'Regex',
      copy: 'copy', copied: 'copied',
      distinctPatterns: '{n} distinct {kind}pattern(s)', kindCompact: 'compact ',
      showingTop: '(showing top {n})', nulls: '{n} null', empty: '∅ (empty)', nullRow: '(null)',
      analyzing: 'Analysing…',
      outlierSummary: '{n} values ({pct} %) deviate from the dominant pattern',
      uniform: 'Uniform – no pattern outliers',
      noDominant: 'No dominant pattern – too varied for outlier detection',
      showOutliers: 'Show rows', outlierRowsMeta: '{shown} of {total} outliers',
      noOutlierRows: 'No deviating rows found.',
      segments: 'Segments', segPrefix: 'Prefix', segSuffix: 'Suffix', segToken: 'Token/word',
      segEmpty: 'No recurring segments found.',
      segLegend: 'Recurring literals: prefix (leading part + delimiter, e.g. BAU_), '
        + 'suffix (delimiter + trailing part, e.g. _LTD), token (words, also from CamelCase, e.g. POWER).',
      findSubstrings: 'Find embedded substrings',
      segSubstring: 'Substring', subMeta: 'on a sample of {n} rows',
      subEmpty: 'No frequent substrings found.',
      legend: 'Mask: A uppercase · a lowercase · 9 digit · other characters kept literally. '
        + 'Exact length keeps the run length (999 ⇒ \\d{3}); Compact collapses any run (9+ ⇒ \\d+).',
    },
  });

  /**
   * Renders the result of qrx.patterns.analyze: an exact/compact toggle and a
   * table of the most frequent value patterns with a derived regex. Owns the
   * toggle and the copy-to-clipboard buttons; bilingual.
   *
   * opts: { data, mode='exact', fmt=(n)=>String(n) }
   */
  ui.patternTable = function patternTable(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.patternTable: mount element not found');
    el.classList.add('qrx-pat');
    const fmt = opts.fmt || ((n) => String(n));
    const esc = qrx.core.escapeHtml;
    let data = opts.data || null;
    let mode = opts.mode || 'exact';
    let segData = null;   // lazily fetched literal-segment analysis
    let subData = null;   // lazily fetched deep substring analysis
    let subBusy = false;
    const t = (k, p) => qrx.i18n.t('patterns.' + k, p);
    const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tglBtn = (m, key) => `<button type="button" class="qrx-btn qrx-btn-sm ${mode === m ? 'is-active' : ''}" data-mode="${m}">${esc(t(key))}</button>`;

    // The action button for one segment/motif row. When the app wires up
    // recordSql, it becomes an "SQL" button that copies a ready-to-run query
    // returning the matching records; otherwise it copies the bare matcher.
    function segButton(kind, value) {
      if (opts.recordSql) {
        const sql = opts.recordSql({ kind, value });
        return `<button type="button" class="qrx-pat-copy" data-copy="${esc(sql)}" data-label="SQL" title="${esc(sql)}">SQL</button>`;
      }
      const rx = kind === 'prefix' ? '^' + reEsc(value) : kind === 'suffix' ? reEsc(value) + '$' : reEsc(value);
      return `<button type="button" class="qrx-pat-copy" data-copy="${esc(rx)}" title="${esc(rx)}">${esc(t('copy'))}</button>`;
    }

    // One "Prefix / Suffix / Token" sub-table for the segments view. The copy
    // value is a ready-to-use matcher: ^BAU_ / _LTD$ / POWER.
    // Compact: value · count · share · copy-matcher. Three of these sit side by
    // side, so the example rides in the value's tooltip and the matcher regex in
    // the copy button's — keeping each table narrow enough to wrap gracefully.
    function renderSegTable(titleKey, rows, kind) {
      if (!rows || !rows.length) return '';
      const total = (segData && segData.total) || 1;
      let h = `<div class="qrx-pat-segblock"><div class="qrx-pat-segtitle">${esc(t(titleKey))}</div>`
        + '<div class="qrx-pat-segscroll"><table class="qrx-pat-table qrx-pat-segtable"><tbody>';
      for (const r of rows) {
        const share = r.c / total * 100;
        h += `<tr><td class="qrx-pat-mask" title="${esc(r.example)}">${esc(r.value)}</td><td>${fmt(r.c)}</td>`
          + `<td><div class="qrx-pat-share"><span class="qrx-pat-bar" style="width:${Math.max(2, Math.round(share))}px"></span>${share.toFixed(1)}%</div></td>`
          + `<td class="qrx-pat-rx">${segButton(kind, r.value)}</td></tr>`;
      }
      return h + '</tbody></table></div></div>';
    }

    // Deep, on-demand substring search (Stufe 2). A single narrow table of
    // frequent embedded motifs; the value cell copies as a plain matcher.
    function renderSubstrings() {
      if (!opts.onSubstrings) return '';
      if (subBusy) return `<p class="qrx-pat-busy">${esc(t('analyzing'))}</p>`;
      if (!subData) {
        return `<div class="qrx-pat-subtrigger"><button type="button" class="qrx-btn qrx-btn-sm" data-substrings>${esc(t('findSubstrings'))}</button></div>`;
      }
      const rows = subData.substrings || [];
      if (!rows.length) return `<div class="qrx-pat-outliers is-none">${esc(t('subEmpty'))}</div>`;
      const total = subData.total || 1;
      let h = `<div class="qrx-pat-subwrap"><div class="qrx-pat-segtitle">`
        + `${esc(t('segSubstring'))} · ${esc(t('subMeta', { n: fmt(subData.sampleRows) }))}</div>`
        + '<div class="qrx-pat-segscroll"><table class="qrx-pat-table qrx-pat-segtable"><tbody>';
      for (const r of rows) {
        const share = r.c / total * 100;
        h += `<tr><td class="qrx-pat-mask" title="${esc(r.example)}">${esc(r.value)}</td><td>${fmt(r.c)}</td>`
          + `<td><div class="qrx-pat-share"><span class="qrx-pat-bar" style="width:${Math.max(2, Math.round(share))}px"></span>${share.toFixed(1)}%</div></td>`
          + `<td class="qrx-pat-rx">${segButton('substring', r.value)}</td></tr>`;
      }
      return h + '</tbody></table></div></div>';
    }

    function renderSegments() {
      if (!segData) return `<p class="qrx-pat-busy">${esc(t('analyzing'))}</p>`;
      if (!segData.prefixes.length && !segData.suffixes.length && !segData.tokens.length) {
        return `<div class="qrx-pat-outliers is-none">${esc(t('segEmpty'))}</div>` + renderSubstrings();
      }
      return '<div class="qrx-pat-segwrap">'
        + renderSegTable('segPrefix', segData.prefixes, 'prefix')
        + renderSegTable('segSuffix', segData.suffixes, 'suffix')
        + renderSegTable('segToken', segData.tokens, 'token')
        + '</div>'
        + `<div class="qrx-pat-legend">${esc(t('segLegend'))}</div>`
        + renderSubstrings();
    }

    function render() {
      if (!data) { el.innerHTML = ''; return; }
      const hasSeg = !!(opts.onSegments || segData);
      const toggle = '<div class="qrx-pat-toggle">'
        + tglBtn('exact', 'exactLength') + tglBtn('compact', 'compact')
        + (hasSeg ? tglBtn('segments', 'segments') : '') + '</div>';
      if (mode === 'segments') { el.innerHTML = toggle + renderSegments(); return; }

      const compact = mode === 'compact';
      const d = compact ? data.compact : data.exact;
      const total = data.total || 1;
      const nonNull = Math.max(0, total - (data.nulls || 0));
      // Flag the deviating long tail (unless disabled or the column is free-text).
      const ol = (opts.outliers === false)
        ? { hasDominant: false, normalPats: new Set(), outlierCount: 0 }
        : qrx.patterns.outliers(d, nonNull);

      let html = toggle;

      html += '<div class="qrx-pat-meta">'
        + t('distinctPatterns', { n: fmt(d.distinct), kind: compact ? t('kindCompact') : '' })
        + (d.distinct > d.rows.length ? ' ' + t('showingTop', { n: d.rows.length }) : '')
        + ' · ' + t('nulls', { n: fmt(data.nulls) }) + '</div>';

      if (opts.outliers !== false) {
        if (!ol.hasDominant) {
          html += `<div class="qrx-pat-outliers is-none">${esc(t('noDominant'))}</div>`;
        } else if (ol.outlierCount === 0) {
          html += `<div class="qrx-pat-outliers is-uniform">${esc(t('uniform'))}</div>`;
        } else {
          const showBtn = opts.onShowOutliers
            ? ` <button type="button" class="qrx-pat-oshow" data-outliers-show>${esc(t('showOutliers'))}</button>`
            : '';
          html += `<div class="qrx-pat-outliers is-flagged">${esc(t('outlierSummary', {
            n: fmt(ol.outlierCount), pct: (ol.outlierShare * 100).toFixed(1),
          }))}${showBtn}</div>`;
        }
      }

      html += '<table class="qrx-pat-table"><thead><tr>'
        + `<th>${esc(t('pattern'))}</th><th>${esc(t('count'))}</th><th>${esc(t('share'))}</th>`
        + `<th>${esc(t('example'))}</th><th>${esc(t('regex'))}</th></tr></thead><tbody>`;
      for (const r of d.rows) {
        const isEmpty = r.pat === '';
        const mask = isEmpty ? t('empty') : (compact ? qrx.patterns.compactDisplay(r.pat) : r.pat);
        const rx = isEmpty ? '^$' : qrx.patterns.maskToRegex(r.pat, compact);
        const share = r.c / total * 100;
        const isOutlier = ol.hasDominant && !ol.normalPats.has(r.pat);
        html += `<tr class="${isOutlier ? 'qrx-pat-outlier' : ''}"><td class="qrx-pat-mask">${esc(mask)}</td>`
          + `<td>${fmt(r.c)}</td>`
          + `<td><div class="qrx-pat-share"><span class="qrx-pat-bar" style="width:${Math.max(2, Math.round(share))}px"></span>${share.toFixed(1)}%</div></td>`
          + `<td class="qrx-pat-ex" title="${esc(r.example)}">${esc(r.example)}</td>`
          + `<td class="qrx-pat-rx">${esc(rx)} <button type="button" class="qrx-pat-copy" data-copy="${esc(rx)}">${esc(t('copy'))}</button></td></tr>`;
      }
      if (data.nulls) {
        html += `<tr class="qrx-pat-null"><td>${esc(t('nullRow'))}</td><td>${fmt(data.nulls)}</td>`
          + `<td>${(data.nulls / total * 100).toFixed(1)}%</td><td></td><td></td></tr>`;
      }
      html += '</tbody></table>';
      if (opts.onShowOutliers && ol.hasDominant && ol.outlierCount > 0) {
        html += '<div class="qrx-pat-orows-wrap" hidden></div>';
      }
      html += `<div class="qrx-pat-legend">${esc(t('legend'))}</div>`;
      el.innerHTML = html;
    }

    // Render the fetched outlier values into the container below the table.
    function renderOutlierRows(rc, res) {
      const rows = (res && res.rows) || [];
      if (!rows.length) { rc.innerHTML = `<p class="qrx-pat-busy">${esc(t('noOutlierRows'))}</p>`; return; }
      let h = `<div class="qrx-pat-orows-meta">${esc(t('outlierRowsMeta', {
        shown: fmt(rows.length), total: fmt((res && res.total) || rows.length),
      }))}</div><ul class="qrx-pat-orows">`;
      for (const r of rows) {
        h += `<li><span class="qrx-pat-oval">${esc(r.value)}</span>`
          + `<span class="qrx-pat-omask">${esc(r.mask)}</span></li>`;
      }
      rc.innerHTML = h + '</ul>';
    }

    el.addEventListener('click', (e) => {
      const mb = e.target.closest('[data-mode]');
      if (mb) {
        mode = mb.getAttribute('data-mode');
        // Segments are analysed lazily on first switch (they cost extra queries).
        if (mode === 'segments' && !segData && opts.onSegments) {
          render();   // shows the busy placeholder
          Promise.resolve(opts.onSegments())
            .then(s => { segData = s; }, err => { console.error(err); segData = { prefixes: [], suffixes: [], tokens: [], total: 1 }; })
            .then(() => { if (mode === 'segments') render(); });
          return;
        }
        render();
        return;
      }
      // Deep substring search (Stufe 2), triggered on demand from the segments tab.
      const sb = e.target.closest('[data-substrings]');
      if (sb) {
        if (!opts.onSubstrings) return;
        subBusy = true; render();
        Promise.resolve(opts.onSubstrings())
          .then(s => { subData = s; }, err => { console.error(err); subData = { substrings: [], sampleRows: 0, total: 1 }; })
          .then(() => { subBusy = false; if (mode === 'segments') render(); });
        return;
      }
      // "Show rows": fetch the actual deviating values for the current mode.
      const os = e.target.closest('[data-outliers-show]');
      if (os) {
        const dd = (mode === 'compact') ? data.compact : data.exact;
        const nn = Math.max(0, (data.total || 1) - (data.nulls || 0));
        const o2 = qrx.patterns.outliers(dd, nn);
        const rc = el.querySelector('.qrx-pat-orows-wrap');
        if (!rc) return;
        os.disabled = true;
        rc.hidden = false;
        rc.innerHTML = `<p class="qrx-pat-busy">${esc(t('analyzing'))}</p>`;
        Promise.resolve(opts.onShowOutliers({ compact: mode === 'compact', normalPats: [...o2.normalPats] }))
          .then(res => renderOutlierRows(rc, res))
          .catch(err => { rc.innerHTML = `<p class="qrx-pat-busy">${esc(String(err && err.message || err))}</p>`; });
        return;
      }
      const cb = e.target.closest('[data-copy]');
      if (!cb) return;
      const txt = cb.getAttribute('data-copy');
      const orig = cb.getAttribute('data-label') || t('copy');
      const done = () => {
        cb.classList.add('is-copied'); cb.textContent = t('copied');
        setTimeout(() => { cb.classList.remove('is-copied'); cb.textContent = orig; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, done);
      else {
        const ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        ta.remove(); done();
      }
    });
    qrx.i18n.onChange(render);

    render();
    return {
      el,
      setData(d) { data = d; render(); return this; },
      setBusy() { el.innerHTML = `<p class="qrx-pat-busy">${esc(t('analyzing'))}</p>`; return this; },
    };
  };

  /** A transient message. One container, reused. */
  let toastEl = null, toastTimer = null;
  ui.toast = function toast(message, kind, ms = 3200) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'qrx-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', kind === 'error');
    toastEl.classList.toggle('is-success', kind === 'success');
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), ms);
    return toastEl;
  };
})();
