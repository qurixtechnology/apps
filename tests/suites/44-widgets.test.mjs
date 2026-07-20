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
