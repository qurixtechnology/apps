// ============================================================================
// qrx.ui.connectDialog — "Connect with DuckDB", once instead of three times.
//
// The three apps had grown apart: the cleaner offered a <select>, the profiler
// checkboxes, the converter no picker at all, and the labels were half English
// half German. One widget now covers all three shapes:
//
//   selection: 'none'   – just connect (the app lists tables itself)
//              'single' – pick one table
//              'multi'  – pick several
//
// It owns the whole credential flow: a remembered token skips the fields
// entirely, a rejected one is discarded and asked for again, and tables that
// quack cannot read are shown but disabled, with the reason.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});
  const ui = (qrx.ui = qrx.ui || {});

  qrx.i18n.register('connect', {
    de: {
      title: 'Mit DuckDB verbinden',
      hint: 'Liest Tabellen eines laufenden DuckDB-Servers über die quack-Extension.',
      uri: 'Server-URI',
      token: 'Auth-Token',
      tokenPlaceholder: 'Token',
      tokenSaved: 'gespeicherter Token wird verwendet',
      remember: 'Token auf diesem Gerät merken',
      rememberHint: 'Verschlüsselt im Browser gespeichert, pro Server-URI — geteilt mit den anderen qurix-Apps.',
      savedHint: 'Für diesen Server ist ein Token gespeichert (verschlüsselt). Feld leer lassen, um ihn zu verwenden.',
      forget: 'Token löschen',
      forgotten: 'Gespeicherter Token gelöscht.',
      unavailable: 'Nicht verfügbar — dieser Browser blockiert lokalen Speicher.',
      connected: 'Verbunden mit {uri}',
      change: 'anderer Server oder Token',
      tables: 'Tabellen',
      table: 'Tabelle',
      connect: 'Verbinden',
      load: 'Tabelle laden',
      loadMulti: 'Tabellen laden',
      cancel: 'Abbrechen',
      connecting: 'Verbinde …',
      loadingTables: 'Tabellen werden geladen …',
      loading: 'Lädt …',
      noUri: 'Bitte eine Server-URI eingeben.',
      noTables: 'Auf diesem Server wurden keine Tabellen gefunden.',
      noneReachable: 'Keine der {count} Tabellen liegt im Schema „main". quack entfernt das Schema beim Weiterleiten einer Abfrage, daher ist nur „main" lesbar.',
      unreachable: 'Schema „{schema}" — über quack nicht erreichbar',
      alreadyLoaded: 'bereits geladen',
      pickOne: 'Bitte mindestens eine Tabelle wählen.',
      rejected: 'Gespeicherter Token wurde abgelehnt — bitte neu eingeben.',
      failed: 'Fehlgeschlagen: {message}',
    },
    en: {
      title: 'Connect with DuckDB',
      hint: 'Reads tables from a running DuckDB server through the quack extension.',
      uri: 'Server URI',
      token: 'Auth token',
      tokenPlaceholder: 'token',
      tokenSaved: 'using saved token',
      remember: 'Remember this token on this device',
      rememberHint: 'Stored encrypted in this browser, per server URI — shared with the other qurix apps.',
      savedHint: 'A token for this server is saved (encrypted). Leave the field empty to reuse it.',
      forget: 'Forget it',
      forgotten: 'Saved token deleted.',
      unavailable: 'Not available — this browser blocks local storage.',
      connected: 'Connected to {uri}',
      change: 'use a different server or token',
      tables: 'Tables',
      table: 'Table',
      connect: 'Connect',
      load: 'Load table',
      loadMulti: 'Load tables',
      cancel: 'Cancel',
      connecting: 'Connecting…',
      loadingTables: 'Loading tables…',
      loading: 'Loading…',
      noUri: 'Enter a server URI.',
      noTables: 'No tables found on this server.',
      noneReachable: 'None of the {count} tables are in the “main” schema. quack drops the schema when forwarding a query, so only “main” can be read.',
      unreachable: 'schema “{schema}” — not reachable through quack',
      alreadyLoaded: 'already loaded',
      pickOne: 'Select at least one table.',
      rejected: 'Saved token was rejected — enter it again.',
      failed: 'Failed: {message}',
    },
  });

  const t = (k, p) => qrx.i18n.t('connect.' + k, p);

  /**
   * opts:
   *   selection: 'none' | 'single' | 'multi'      (default 'none')
   *   defaultUri: string                          (default 'quack:localhost')
   *   loadedTables: () => string[]                already-loaded table names
   *   onConnected: async ({uri}) => void          selection 'none'
   *   onPick: async ({uri, tables}) => void       selection 'single' | 'multi'
   */
  ui.connectDialog = function connectDialog(opts = {}) {
    const selection = opts.selection || 'none';
    const server = window.qrxDuckServer;
    const vault = server.vault;

    let uri = '';
    let connected = false;
    let phase = 'connect';          // 'connect' | 'pick'
    let tables = [];

    const body = document.createElement('div');
    body.innerHTML = `
      <p class="qrx-note qrx-connect-note" hidden></p>
      <div class="qrx-connect-creds">
        <div class="qrx-field">
          <label class="qrx-label" data-role="uri-label"></label>
          <input class="qrx-input" data-role="uri" spellcheck="false">
        </div>
        <div class="qrx-field">
          <label class="qrx-label" data-role="token-label"></label>
          <input class="qrx-input" data-role="token" type="password" autocomplete="off">
        </div>
        <div class="qrx-field">
          <label class="qrx-check">
            <input type="checkbox" data-role="remember">
            <span class="qrx-label" style="margin:0;" data-role="remember-label"></span>
          </label>
          <p class="qrx-note" data-role="remember-hint"></p>
        </div>
      </div>
      <div class="qrx-field qrx-connect-tables" hidden>
        <label class="qrx-label" data-role="tables-label"></label>
        <select class="qrx-select" data-role="table-select" hidden></select>
        <div class="qrx-picker" data-role="table-picker" hidden></div>
      </div>`;

    const $ = (role) => body.querySelector(`[data-role="${role}"]`);
    const noteEl = body.querySelector('.qrx-connect-note');
    const credsEl = body.querySelector('.qrx-connect-creds');
    const tablesEl = body.querySelector('.qrx-connect-tables');

    const dlg = qrx.ui.modal({
      titleKey: 'connect.title',
      hintKey: 'connect.hint',
      body,
      actions: [
        { key: 'cancel', labelKey: 'connect.cancel', onClick: (m) => m.close() },
        { key: 'go', primary: true, label: '', onClick: () => go() },
      ],
    });

    function goLabel() {
      if (phase === 'connect') return t('connect');
      return selection === 'multi' ? t('loadMulti') : t('load');
    }

    function renderLabels() {
      $('uri-label').textContent = t('uri');
      $('token-label').textContent = t('token');
      $('remember-label').textContent = t('remember');
      $('tables-label').textContent = selection === 'multi' ? t('tables') : t('table');
      dlg.button('go').textContent = goLabel();
      renderTokenState();
      renderNote();
    }

    function renderTokenState() {
      const u = ($('uri').value || '').trim();
      const cb = $('remember'), hint = $('remember-hint'), tok = $('token');
      if (!vault.available()) {
        cb.checked = false; cb.disabled = true;
        hint.textContent = t('unavailable');
        return;
      }
      if (vault.has(u)) {
        cb.checked = true;
        tok.placeholder = t('tokenSaved');
        hint.innerHTML = qrx.core.escapeHtml(t('savedHint')) + ' <a href="#" data-role="forget"></a>';
        const link = $('forget');
        link.textContent = t('forget');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          vault.forget(u);
          tok.value = '';
          renderTokenState();
          dlg.setStatus(t('forgotten'));
        });
      } else {
        tok.placeholder = t('tokenPlaceholder');
        hint.textContent = t('rememberHint');
      }
    }

    // In the pick phase the credentials are accepted already — hiding them
    // stops the dialog from looking like it is asking for the token again.
    function renderNote() {
      const pick = phase === 'pick';
      credsEl.hidden = pick;
      noteEl.hidden = !pick;
      if (pick) {
        noteEl.innerHTML = qrx.core.escapeHtml(t('connected', { uri })).replace(
          qrx.core.escapeHtml(uri), `<strong>${qrx.core.escapeHtml(uri)}</strong>`)
          + ' · <a href="#" data-role="change"></a>';
        const link = $('change');
        link.textContent = t('change');
        link.addEventListener('click', (e) => {
          e.preventDefault();
          setPhase('connect');
          dlg.setStatus('');
          setTimeout(() => $('token').focus(), 0);
        });
      }
    }

    function setPhase(p) {
      phase = p;
      const pick = p === 'pick';
      tablesEl.hidden = !pick || selection === 'none';
      dlg.button('go').textContent = goLabel();
      renderNote();
    }

    function renderTables() {
      const loaded = new Set((opts.loadedTables && opts.loadedTables()) || []);
      const reachable = tables.filter(x => x.reachable);
      if (!reachable.length) throw new Error(t('noneReachable', { count: tables.length }));

      if (selection === 'single') {
        const sel = $('table-select');
        sel.hidden = false;
        $('table-picker').hidden = true;
        sel.innerHTML = tables.map(x => {
          const label = x.reachable ? x.name : `${x.schema}.${x.name} — ${t('unreachable', { schema: x.schema })}`;
          return `<option value="${qrx.core.escapeHtml(x.name)}"${x.reachable ? '' : ' disabled'}>`
            + `${qrx.core.escapeHtml(label)}</option>`;
        }).join('');
        sel.value = reachable[0].name;
      } else if (selection === 'multi') {
        const box = $('table-picker');
        box.hidden = false;
        $('table-select').hidden = true;
        box.innerHTML = tables.map(x => {
          const off = !x.reachable || loaded.has(x.name);
          const why = !x.reachable ? ' · ' + t('unreachable', { schema: x.schema })
            : (loaded.has(x.name) ? ' · ' + t('alreadyLoaded') : '');
          return `<label class="${off ? 'is-disabled' : ''}">`
            + `<input type="checkbox" value="${qrx.core.escapeHtml(x.name)}"${off ? ' disabled' : ''}>`
            + `<span>${qrx.core.escapeHtml(x.name + why)}</span></label>`;
        }).join('');
      }
    }

    async function attach(u, token) {
      await qrx.duckdb.init();
      await server.attach(qrx.duckdb.conn(), u, token);
      connected = true;
      uri = u;
      vault.noteUri(u);
    }

    async function loadTables() {
      dlg.setStatus(t('loadingTables'));
      tables = await server.listTables(qrx.duckdb.conn());
      if (!tables.length) throw new Error(t('noTables'));
      renderTables();
      setPhase('pick');
      dlg.setStatus('');
    }

    async function go() {
      dlg.setBusy(true);
      try {
        if (phase === 'connect') {
          const u = ($('uri').value || '').trim();
          if (!u) { dlg.setStatus(t('noUri'), 'err'); return; }
          let token = $('token').value;
          if (!token && vault.has(u)) token = (await vault.get(u)) || '';
          dlg.setStatus(t('connecting'));
          try {
            await attach(u, token);
          } catch (e) {
            if (server.isAuthError(e)) { vault.forget(u); renderTokenState(); }
            connected = false;
            throw e;
          }
          if ($('remember').checked && token) await vault.put(u, token);
          else if (!$('remember').checked) vault.forget(u);

          if (selection === 'none') {
            dlg.setStatus(t('loading'));
            if (opts.onConnected) await opts.onConnected({ uri });
            dlg.close();
          } else {
            await loadTables();
          }
        } else {
          const picked = selection === 'single'
            ? [$('table-select').value]
            : [...body.querySelectorAll('[data-role="table-picker"] input:checked')].map(i => i.value);
          if (!picked.length || !picked[0]) { dlg.setStatus(t('pickOne'), 'err'); return; }
          dlg.setStatus(t('loading'));
          dlg.close();
          if (opts.onPick) await opts.onPick({ uri, tables: picked });
        }
      } catch (e) {
        const msg = (e && e.message) || String(e);
        dlg.setStatus(t('failed', { message: msg }), 'err');
      } finally {
        dlg.setBusy(false);
      }
    }

    $('uri').addEventListener('input', renderTokenState);
    $('token').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    qrx.i18n.onChange(renderLabels);
    renderLabels();      // labels must be there before the first open(), too

    return {
      dialog: dlg,
      isConnected: () => connected,
      uri: () => uri,
      /**
       * Open the dialog. With a remembered token it connects silently first,
       * so the user lands straight on the table picker (or, for selection
       * 'none', never sees a dialog at all).
       */
      async open() {
        const last = vault.lastUri() || opts.defaultUri || 'quack:localhost';
        $('uri').value = connected ? uri : last;
        $('token').value = '';
        renderLabels();

        if (connected) {
          dlg.open();
          setPhase('connect');
          if (selection !== 'none') {
            try { await loadTables(); }
            catch (e) { dlg.setStatus(t('failed', { message: e.message || String(e) }), 'err'); }
          }
          return;
        }

        const token = vault.has(last) ? await vault.get(last) : null;
        if (token === null) { dlg.open('[data-role="token"]'); setPhase('connect'); return; }

        // silent reconnect
        try {
          await attach(last, token);
          if (selection === 'none') {
            if (opts.onConnected) await opts.onConnected({ uri });
            return;                       // no dialog at all
          }
          dlg.open();
          await loadTables();
        } catch (e) {
          connected = false;
          if (server.isAuthError(e)) vault.forget(last);
          dlg.open('[data-role="token"]');
          setPhase('connect');
          renderTokenState();
          dlg.setStatus(
            (server.isAuthError(e) ? t('rejected') + ' ' : '') + t('failed', { message: e.message || String(e) }),
            'err');
        }
      },
      close: () => dlg.close(),
    };
  };
})();
