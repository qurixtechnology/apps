// qrx.core — the shared basics. Pure functions, so they are called directly in
// the page context instead of being clicked through an app.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp } from '../helpers/browser.mjs';

let browser, page;
const run = (fn, ...args) => page.evaluate(fn, ...args);

before(async () => {
  browser = await launch();
  page = await openApp(browser, 'parquet-cleaner.html');
});
after(async () => { await browser?.close(); });

describe('core: escapeHtml', () => {
  test('escapes all five dangerous characters', async () => {
    const got = await run(() => window.qrx.core.escapeHtml(`<a href="x" title='y'>&</a>`));
    assert.equal(got, '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  test('is safe inside a double- and single-quoted attribute', async () => {
    // this is why the separate escapeAttr() could be dropped
    const r = await run(() => {
      const e = window.qrx.core.escapeHtml('" onerror="alert(1)');
      const d = document.createElement('div');
      d.innerHTML = `<img alt="${e}">`;
      const img = d.querySelector('img');
      return { attrs: img.getAttributeNames(), alt: img.getAttribute('alt') };
    });
    assert.deepEqual(r.attrs, ['alt'], 'no attribute was injected');
    assert.equal(r.alt, '" onerror="alert(1)');
  });

  test('null and undefined render as empty, not as text', async () => {
    const got = await run(() => [
      window.qrx.core.escapeHtml(null),
      window.qrx.core.escapeHtml(undefined),
      window.qrx.core.escapeHtml(0),
      window.qrx.core.escapeHtml(false),
    ]);
    assert.deepEqual(got, ['', '', '0', 'false']);
  });
});

describe('core: formatting', () => {
  test('bytes use adaptive precision and a dash for nothing', async () => {
    const got = await run(() => [512, 2048, 1536 * 1024, 5.5 * 1024 ** 3, 1024 ** 4, null, NaN]
      .map(v => window.qrx.core.fmt.bytes(v)));
    assert.deepEqual(got, ['512 B', '2.00 KB', '1.50 MB', '5.50 GB', '1.00 TB', '—', '—']);
  });

  test('numbers follow the locale that is passed in', async () => {
    const got = await run(() => {
      const f = window.qrx.core.fmt.number;
      return [f(1234567.5, 'de-DE'), f(1234567.5, 'en-GB'), f(10n ** 12n, 'de-DE'), f(null, 'de-DE'), f('x', 'de-DE')];
    });
    assert.equal(got[0], '1.234.567,5');
    assert.equal(got[1], '1,234,567.5');
    assert.equal(got[2], '1.000.000.000.000', 'BigInt is supported');
    assert.equal(got[3], '—');
    assert.equal(got[4], '—');
  });

  test('durations switch unit and precision', async () => {
    const got = await run(() => [0.4, 12.6, 999, 1500, 45000, null]
      .map(v => window.qrx.core.fmt.duration(v)));
    assert.deepEqual(got, ['<1 ms', '13 ms', '999 ms', '1.50 s', '45.0 s', '—']);
  });

  test('dates render according to the column type', async () => {
    const got = await run(() => {
      const d = new Date(Date.UTC(2024, 0, 15, 13, 45, 30));
      const f = window.qrx.core.fmt.dateByType;
      return [f(d, 'DATE'), f(d, 'TIME'), f(d, 'TIMESTAMP'), f(d, null), f('not a date', 'DATE')];
    });
    assert.deepEqual(got, ['2024-01-15', '13:45:30', '2024-01-15 13:45:30', '2024-01-15 13:45:30', 'not a date']);
  });
});

describe('core: storage', () => {
  test('round-trips strings and JSON, and survives corrupt data', async () => {
    const got = await run(() => {
      const s = window.qrx.core.storage;
      s.set('qrx_t_a', 'hello');
      s.setJSON('qrx_t_b', { x: [1, 2] });
      localStorage.setItem('qrx_t_c', '{not json');
      const out = {
        a: s.get('qrx_t_a'),
        b: s.getJSON('qrx_t_b'),
        corrupt: s.getJSON('qrx_t_c', 'fallback'),
        missing: s.get('qrx_t_missing', 'default'),
      };
      s.remove('qrx_t_a');
      out.afterRemove = s.get('qrx_t_a', 'gone');
      return out;
    });
    assert.equal(got.a, 'hello');
    assert.deepEqual(got.b, { x: [1, 2] });
    assert.equal(got.corrupt, 'fallback', 'corrupt JSON must not throw');
    assert.equal(got.missing, 'default');
    assert.equal(got.afterRemove, 'gone');
  });

  test('a blocked localStorage never throws', async () => {
    const got = await run(() => {
      const real = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new Error('blocked (private mode)'); },
      });
      let out;
      try {
        const s = window.qrx.core.storage;
        out = { set: s.set('k', 'v'), get: s.get('k', 'fb'), json: s.getJSON('k', 'fb'), remove: s.remove('k') };
      } finally {
        Object.defineProperty(window, 'localStorage', real);
      }
      return out;
    });
    assert.deepEqual(got, { set: false, get: 'fb', json: 'fb', remove: false });
  });
});

describe('core: download', () => {
  test('accepts blob, string and typed array without throwing', async () => {
    const got = await run(() => {
      const created = [];
      const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
      URL.createObjectURL = (b) => { created.push({ size: b.size, type: b.type }); return 'blob:stub'; };
      URL.revokeObjectURL = () => {};
      const clicks = [];
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { clicks.push({ download: this.download, href: this.href }); };
      try {
        window.qrx.core.download(new Blob(['a'], { type: 'text/plain' }), 'a.txt');
        window.qrx.core.download('hello', 'b.csv', 'text/csv');
        window.qrx.core.download(new Uint8Array([1, 2, 3]), 'c.bin');
      } finally {
        URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke;
        HTMLAnchorElement.prototype.click = realClick;
      }
      return { created, clicks, leftovers: document.querySelectorAll('a[download]').length };
    });
    assert.deepEqual(got.clicks.map(c => c.download), ['a.txt', 'b.csv', 'c.bin']);
    assert.deepEqual(got.created.map(c => c.size), [1, 5, 3]);
    assert.equal(got.created[1].type, 'text/csv', 'explicit mime is honoured');
    assert.equal(got.created[2].type, 'application/octet-stream', 'default mime');
    assert.equal(got.leftovers, 0, 'the anchor is removed again');
  });
});

describe('core: debounce', () => {
  test('collapses a burst into one call with the last arguments', async () => {
    const got = await run(async () => {
      const calls = [];
      const f = window.qrx.core.debounce((x) => calls.push(x), 30);
      f(1); f(2); f(3);
      await new Promise(r => setTimeout(r, 80));
      f(4);
      await new Promise(r => setTimeout(r, 80));
      return calls;
    });
    assert.deepEqual(got, [3, 4]);
  });
});
