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
