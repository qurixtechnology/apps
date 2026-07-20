// Shared widgets, tested in isolation instead of through an app: faster, and
// it pins down the behaviour every app now depends on.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp } from '../helpers/browser.mjs';

let browser, page;
before(async () => {
  browser = await launch();
  page = await openApp(browser, 'parquet-cleaner.html');
});
after(async () => { await browser?.close(); });

describe('widget: modal', () => {
  test('opens, closes on backdrop and on Escape', async () => {
    const got = await page.evaluate(async () => {
      const m = window.qrx.ui.modal({ title: 'T', body: '<input id="x">' });
      const out = {};
      m.open();
      out.open = m.isOpen();
      m.el.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // backdrop
      out.afterBackdrop = m.isOpen();
      m.open();
      m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.afterEscape = m.isOpen();
      m.destroy();
      return out;
    });
    assert.deepEqual(got, { open: true, afterBackdrop: false, afterEscape: false });
  });

  test('a click inside the card does not close it', async () => {
    const still = await page.evaluate(() => {
      const m = window.qrx.ui.modal({ title: 'T', body: '<p id="inside">text</p>' });
      m.open();
      m.el.querySelector('#inside').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const open = m.isOpen();
      m.destroy();
      return open;
    });
    assert.equal(still, true);
  });

  test('traps focus and gives it back on close', async () => {
    // no app had this: a keyboard user could tab out of the dialog into the
    // page behind it, and focus was lost entirely when it closed
    const got = await page.evaluate(async () => {
      const opener = document.createElement('button');
      opener.textContent = 'open';
      document.body.appendChild(opener);
      opener.focus();

      const m = window.qrx.ui.modal({
        title: 'T',
        body: '<input data-role="first"><input data-role="last">',
        actions: [{ key: 'ok', label: 'OK' }],
      });
      m.open();
      await new Promise(r => setTimeout(r, 30));
      const firstFocused = document.activeElement.getAttribute('data-role');

      // Tab from the last focusable element must wrap to the first
      const items = [...m.el.querySelectorAll('input,button')];
      items[items.length - 1].focus();
      m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      await new Promise(r => setTimeout(r, 10));
      const wrapped = document.activeElement === items[0];

      m.close();
      await new Promise(r => setTimeout(r, 10));
      const restored = document.activeElement === opener;
      m.destroy(); opener.remove();
      return { firstFocused, wrapped, restored };
    });
    assert.equal(got.firstFocused, 'first', 'focus moves into the dialog');
    assert.equal(got.wrapped, true, 'Tab wraps inside the dialog');
    assert.equal(got.restored, true, 'focus returns to the opener');
  });

  test('carries the ARIA a screen reader needs', async () => {
    const got = await page.evaluate(() => {
      const m = window.qrx.ui.modal({ title: 'Hello' });
      m.open();
      const card = m.el.querySelector('.qrx-modal-card');
      const out = {
        role: card.getAttribute('role'),
        modal: card.getAttribute('aria-modal'),
        labelled: card.getAttribute('aria-labelledby') === m.el.querySelector('.qrx-modal-title').id,
        title: m.el.querySelector('.qrx-modal-title').textContent,
      };
      m.destroy();
      return out;
    });
    assert.deepEqual(got, { role: 'dialog', modal: 'true', labelled: true, title: 'Hello' });
  });

  test('titles and buttons follow the language', async () => {
    const got = await page.evaluate(async () => {
      const i = window.qrx.i18n;
      i.register('t9', { de: { hi: 'Hallo', ok: 'Fertig' }, en: { hi: 'Hi', ok: 'Done' } });
      i.setLang('en');
      const m = window.qrx.ui.modal({
        titleKey: 't9.hi',
        actions: [{ key: 'ok', labelKey: 't9.ok' }],
      });
      m.open();
      const en = { title: m.el.querySelector('.qrx-modal-title').textContent, btn: m.button('ok').textContent };
      i.setLang('de');
      const de = { title: m.el.querySelector('.qrx-modal-title').textContent, btn: m.button('ok').textContent };
      m.destroy();
      i.setLang('en');
      return { en, de };
    });
    assert.deepEqual(got.en, { title: 'Hi', btn: 'Done' });
    assert.deepEqual(got.de, { title: 'Hallo', btn: 'Fertig' });
  });
});

describe('widget: connect dialog', () => {
  test('all three shapes exist and are configured per app', async () => {
    // 'none' for the converter (it has its own table picker), 'single' for the
    // cleaner, 'multi' for the profiler
    const shapes = await page.evaluate(() => {
      const made = [];
      for (const selection of ['none', 'single', 'multi']) {
        const c = window.qrx.ui.connectDialog({ selection });
        c.dialog.open();
        const el = c.dialog.el;
        made.push({
          selection,
          hasUri: !!el.querySelector('[data-role="uri"]'),
          hasToken: !!el.querySelector('[data-role="token"]'),
          hasRemember: !!el.querySelector('[data-role="remember"]'),
          hasSelect: !!el.querySelector('[data-role="table-select"]'),
          hasPicker: !!el.querySelector('[data-role="table-picker"]'),
          connected: c.isConnected(),
        });
        c.dialog.destroy();
      }
      return made;
    });
    for (const s of shapes) {
      assert.equal(s.hasUri, true, s.selection);
      assert.equal(s.hasToken, true, s.selection);
      assert.equal(s.hasRemember, true, s.selection);
      assert.equal(s.connected, false);
    }
  });

  test('refuses an empty URI before touching the network', async () => {
    const msg = await page.evaluate(async () => {
      const c = window.qrx.ui.connectDialog({ selection: 'single' });
      c.dialog.open();
      c.dialog.el.querySelector('[data-role="uri"]').value = '   ';
      c.dialog.button('go').click();
      await new Promise(r => setTimeout(r, 50));
      const t = c.dialog.el.querySelector('.qrx-modal-status').textContent;
      c.dialog.destroy();
      return t;
    });
    assert.match(msg, /URI/i);
  });

  test('the whole dialog speaks both languages', async () => {
    const got = await page.evaluate(async () => {
      const i = window.qrx.i18n;
      const c = window.qrx.ui.connectDialog({ selection: 'single' });
      const read = () => ({
        title: c.dialog.el.querySelector('.qrx-modal-title').textContent,
        uri: c.dialog.el.querySelector('[data-role="uri-label"]').textContent,
        go: c.dialog.button('go').textContent,
      });
      i.setLang('en'); c.dialog.open();
      const en = read();
      i.setLang('de');
      const de = read();
      c.dialog.destroy();
      i.setLang('en');
      return { en, de };
    });
    assert.equal(got.en.title, 'Connect with DuckDB');
    assert.equal(got.en.uri, 'Server URI');
    assert.equal(got.en.go, 'Connect');
    assert.equal(got.de.title, 'Mit DuckDB verbinden');
    assert.equal(got.de.uri, 'Server-URI');
    assert.equal(got.de.go, 'Verbinden');
  });

  test('the remember hint reflects whether a token is stored', async () => {
    const got = await page.evaluate(async () => {
      const v = window.qrxDuckServer.vault;
      v.forget();
      const c = window.qrx.ui.connectDialog({ selection: 'single' });
      c.dialog.open();
      const uriEl = c.dialog.el.querySelector('[data-role="uri"]');
      const hint = () => c.dialog.el.querySelector('[data-role="remember-hint"]').textContent;
      uriEl.value = 'quack:example'; uriEl.dispatchEvent(new Event('input'));
      const before = hint();
      await v.put('quack:example', 'secret');
      uriEl.dispatchEvent(new Event('input'));
      const after = hint();
      const checked = c.dialog.el.querySelector('[data-role="remember"]').checked;
      v.forget();
      c.dialog.destroy();
      return { before, after, checked };
    });
    assert.match(got.before, /encrypted/i);
    assert.match(got.after, /saved/i, 'it says a token is on file');
    assert.equal(got.checked, true, 'and the checkbox reflects that');
  });
});

describe('widget: status bar', () => {
  test('shows a spinner while working and hides it when done', async () => {
    const got = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const st = window.qrx.ui.status(host);
      const read = () => ({
        hidden: st.el.hidden,
        text: st.el.querySelector('.qrx-status-text').textContent,
        spinner: st.el.querySelector('.qrx-status-spinner').style.display !== 'none',
        cls: st.el.className,
      });
      const out = { initial: read() };
      st.set('Working…');
      out.working = read();
      st.set('Broken', 'error');
      out.error = read();
      st.set('');
      out.cleared = read();
      host.remove();
      return out;
    });
    assert.equal(got.initial.hidden, true, 'starts empty and hidden');
    assert.equal(got.working.text, 'Working…');
    assert.equal(got.working.spinner, true, 'ongoing work shows the spinner');
    assert.equal(got.error.spinner, false, 'a terminal state does not');
    assert.match(got.error.cls, /is-error/);
    assert.equal(got.cleared.hidden, true);
  });

  test('a success message clears itself', async () => {
    const got = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const st = window.qrx.ui.status(host, { successMs: 120 });
      st.set('Saved', 'success');
      const immediately = st.text();
      await new Promise(r => setTimeout(r, 260));
      const later = st.text();
      host.remove();
      return { immediately, later };
    });
    assert.equal(got.immediately, 'Saved');
    assert.equal(got.later, '', 'confirmations are not permanent state');
  });

  test('is an ARIA live region', async () => {
    // only markdown-display's toast announced anything before
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const st = window.qrx.ui.status(host);
      const out = { role: st.el.getAttribute('role'), live: st.el.getAttribute('aria-live') };
      host.remove();
      return out;
    });
    assert.deepEqual(got, { role: 'status', live: 'polite' });
  });
});

describe('widget: toast', () => {
  test('shows, styles by kind and disappears again', async () => {
    const got = await page.evaluate(async () => {
      const el = window.qrx.ui.toast('Hello', 'success', 120);
      const shown = { text: el.textContent, visible: el.classList.contains('is-visible'), cls: el.className };
      await new Promise(r => setTimeout(r, 260));
      return { shown, after: el.classList.contains('is-visible'),
               role: el.getAttribute('role'), live: el.getAttribute('aria-live') };
    });
    assert.equal(got.shown.text, 'Hello');
    assert.equal(got.shown.visible, true);
    assert.match(got.shown.cls, /is-success/);
    assert.equal(got.after, false);
    assert.equal(got.role, 'status');
    assert.equal(got.live, 'polite');
  });

  test('reuses one element instead of stacking them up', async () => {
    const count = await page.evaluate(async () => {
      window.qrx.ui.toast('a'); window.qrx.ui.toast('b'); window.qrx.ui.toast('c');
      return document.querySelectorAll('.qrx-toast').length;
    });
    assert.equal(count, 1);
  });
});

describe('widget: dropzone', () => {
  test('a click on the zone opens the picker, a click on a button inside does not', async () => {
    // both apps with a button in their drop zone had shipped exactly this bug
    const got = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.innerHTML = '<span class="t">drop here</span><button class="b">Connect</button>';
      document.body.appendChild(host);
      const input = document.createElement('input');
      input.type = 'file'; input.hidden = true;
      document.body.appendChild(input);

      let picks = 0;
      input.click = () => { picks++; };
      window.qrx.ui.dropzone(host, { input, onFiles: () => {} });

      host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const afterZone = picks;
      host.querySelector('.b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const afterButton = picks;
      host.querySelector('.t').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const afterText = picks;

      host.remove(); input.remove();
      return { afterZone, afterButton, afterText };
    });
    assert.equal(got.afterZone, 1, 'the zone itself opens the picker');
    assert.equal(got.afterButton, 1, 'a button inside must not');
    assert.equal(got.afterText, 2, 'plain content inside still does');
  });

  test('keyboard activation works, and only on the zone itself', async () => {
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<input class="inner">';
      document.body.appendChild(host);
      const input = document.createElement('input');
      input.type = 'file'; input.hidden = true; document.body.appendChild(input);
      let picks = 0;
      input.click = () => { picks++; };
      window.qrx.ui.dropzone(host, { input, label: 'Drop files', onFiles: () => {} });

      host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      host.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      const afterZone = picks;
      host.querySelector('.inner').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const afterInner = picks;
      const attrs = { role: host.getAttribute('role'), tab: host.getAttribute('tabindex'),
                      label: host.getAttribute('aria-label') };
      host.remove(); input.remove();
      return { afterZone, afterInner, attrs };
    });
    assert.equal(got.afterZone, 2, 'Enter and Space both activate');
    assert.equal(got.afterInner, 2, 'typing in a field inside must not');
    assert.deepEqual(got.attrs, { role: 'button', tab: '0', label: 'Drop files' });
  });

  test('the highlight survives moving over child elements', async () => {
    // without a depth counter the class flickers off as soon as the pointer
    // enters a child, which is what three of the four implementations did
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<span class="c">child</span>';
      document.body.appendChild(host);
      const input = document.createElement('input'); input.type = 'file';
      window.qrx.ui.dropzone(host, { input, onFiles: () => {} });
      const dt = () => new DragEvent('dragenter', { bubbles: true });

      host.dispatchEvent(dt());
      const afterEnter = host.classList.contains('is-dragover');
      host.dispatchEvent(new DragEvent('dragenter', { bubbles: true }));  // into the child
      host.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));  // out of the child
      const stillActive = host.classList.contains('is-dragover');
      host.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));  // out of the zone
      const afterLeave = host.classList.contains('is-dragover');
      host.remove();
      return { afterEnter, stillActive, afterLeave };
    });
    assert.deepEqual(got, { afterEnter: true, stillActive: true, afterLeave: false });
  });
});

describe('widget: file info bar', () => {
  test('shows what is loaded and resets on demand', async () => {
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      let resets = 0;
      const bar = window.qrx.ui.fileInfo(host, { onReset: () => { resets++; } });
      const out = { hiddenInitially: bar.el.hidden };
      bar.show({ icon: 'PRQ', name: 'data.parquet', meta: '5 cols · 6 rows' });
      out.visible = !bar.el.hidden;
      out.icon = bar.el.querySelector('.qrx-fileinfo-icon').textContent;
      out.name = bar.el.querySelector('.qrx-fileinfo-name').textContent;
      out.meta = bar.el.querySelector('.qrx-fileinfo-meta').textContent;
      bar.setMeta('changed');
      out.metaAfter = bar.el.querySelector('.qrx-fileinfo-meta').textContent;
      bar.el.querySelector('[data-role="reset"]').click();
      out.resets = resets;
      bar.hide();
      out.hiddenAfter = bar.el.hidden;
      host.remove();
      return out;
    });
    assert.equal(got.hiddenInitially, true);
    assert.equal(got.visible, true);
    assert.equal(got.icon, 'PRQ');
    assert.equal(got.name, 'data.parquet');
    assert.equal(got.meta, '5 cols · 6 rows');
    assert.equal(got.metaAfter, 'changed');
    assert.equal(got.resets, 1);
    assert.equal(got.hiddenAfter, true);
  });

  test('its button follows the language', async () => {
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const i = window.qrx.i18n;
      const bar = window.qrx.ui.fileInfo(host);
      const btn = bar.el.querySelector('[data-role="reset"]');
      i.setLang('en'); const en = btn.textContent;
      i.setLang('de'); const de = btn.textContent;
      i.setLang('en');
      host.remove();
      return { en, de };
    });
    assert.equal(got.en, 'Load another file');
    assert.equal(got.de, 'Andere Datei laden');
  });
});

describe('widget: result grid and pager', () => {
  test('renders a query result with NULLs and right-aligned numbers', async () => {
    const got = await page.evaluate(async () => {
      await window.qrx.duckdb.init();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const grid = window.qrx.ui.resultGrid(host);
      const res = await window.qrx.duckdb.query(
        "SELECT 1::BIGINT AS n, 'x' AS s, NULL::VARCHAR AS empty, DATE '2024-01-15' AS d");
      const n = grid.render(res);
      const cells = [...host.querySelectorAll('tbody td')].map(td => ({ t: td.textContent, c: td.className }));
      const headers = [...host.querySelectorAll('thead th')].map(th => th.textContent);
      host.remove();
      return { n, cells, headers };
    });
    assert.equal(got.n, 1);
    assert.deepEqual(got.headers, ['n', 's', 'empty', 'd']);
    assert.equal(got.cells[0].c, 'qrx-grid-num', 'numbers are right-aligned');
    assert.equal(got.cells[1].t, 'x');
    assert.equal(got.cells[2].c, 'qrx-grid-null', 'NULL is marked, not printed as text');
    assert.equal(got.cells[3].t, '2024-01-15', 'dates use the shared formatting');
  });

  test('an empty result says so instead of showing an empty table', async () => {
    const got = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const grid = window.qrx.ui.resultGrid(host);
      const res = await window.qrx.duckdb.query('SELECT 1 AS a WHERE false');
      const n = grid.render(res);
      const txt = host.querySelector('.qrx-grid-empty').textContent;
      host.remove();
      return { n, txt };
    });
    assert.equal(got.n, 0);
    assert.match(got.txt, /No rows/i);
  });

  test('the pager reports the range and disables what it must', async () => {
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const seen = [];
      const pg = window.qrx.ui.pager(host, { pageSize: 100, onPage: (p) => seen.push(p) });
      const read = () => ({
        info: host.querySelector('.qrx-pager-info').textContent,
        prev: host.querySelector('[data-role="prev"]').disabled,
        next: host.querySelector('[data-role="next"]').disabled,
        hidden: host.hidden,
      });
      pg.set({ page: 0, total: 250, got: 100 });
      const first = read();
      pg.set({ page: 2, total: 250, got: 50 });
      const last = read();
      pg.set({ page: 0, total: 12, got: 12 });
      const single = read();
      pg.set({ page: 1, total: null, got: 100 });     // unknown total
      const open = read();
      host.querySelector('[data-role="prev"]').click();
      host.querySelector('[data-role="next"]').click();
      host.remove();
      return { first, last, single, open, seen };
    });
    assert.match(got.first.info, /Rows 1–100 of 250 · page 1\/3/);
    assert.equal(got.first.prev, true, 'no previous page on the first one');
    assert.equal(got.first.next, false);
    assert.match(got.last.info, /Rows 201–250 of 250 · page 3\/3/);
    assert.equal(got.last.next, true, 'no next page on the last one');
    assert.equal(got.single.hidden, true, 'a single page needs no pager');
    assert.match(got.open.info, /Rows 101–200 · page 2/, 'unknown total: open-ended wording');
    assert.deepEqual(got.seen, [0, 2], 'prev/next report the target page');
  });

  test('the pager speaks both languages', async () => {
    const got = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const i = window.qrx.i18n;
      const pg = window.qrx.ui.pager(host, { pageSize: 10 });
      pg.set({ page: 0, total: 100, got: 10 });
      i.setLang('en');
      const en = host.querySelector('.qrx-pager-info').textContent;
      const enPrev = host.querySelector('[data-role="prev"]').textContent;
      i.setLang('de');
      pg.set({ page: 0, total: 100, got: 10 });
      const de = host.querySelector('.qrx-pager-info').textContent;
      const dePrev = host.querySelector('[data-role="prev"]').textContent;
      i.setLang('en');
      host.remove();
      return { en, enPrev, de, dePrev };
    });
    assert.match(got.en, /Rows 1–10 of 100/);
    assert.match(got.de, /Zeilen 1–10 von 100/);
    assert.match(got.enPrev, /Prev/);
    assert.match(got.dePrev, /Zurück/);
  });
});
