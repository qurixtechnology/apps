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
   * SQL editor behaviour for a <textarea>.
   *
   * Only the behaviour: the panels around it (table chips, examples, export
   * buttons, hints) differ per app for good reasons, and the result table and
   * the pager are already shared. What was actually duplicated is this —
   * and inconsistently: only the profiler indented with Tab, so the same key
   * jumped out of the field in the converter.
   *
   * opts: { onRun, onChange, indent }
   */
  ui.sqlEditor = function sqlEditor(mount, opts = {}) {
    const el = (typeof mount === 'string') ? document.querySelector(mount) : mount;
    if (!el) throw new Error('qrx.ui.sqlEditor: mount element not found');
    const indent = opts.indent || '  ';

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = el;
        el.value = el.value.slice(0, a) + indent + el.value.slice(b);
        el.selectionStart = el.selectionEnd = a + indent.length;
        if (opts.onChange) opts.onChange(el.value);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (opts.onRun) opts.onRun(el.value);
      }
    });
    if (opts.onChange) el.addEventListener('input', () => opts.onChange(el.value));

    return {
      el,
      value: () => el.value,
      set(v) { el.value = v; if (opts.onChange) opts.onChange(v); return this; },
      focus() { el.focus(); return this; },
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
