// qrx.i18n — the translation layer that lets one widget serve a German and an
// English app. Mostly pure logic, so it is exercised directly in the page.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openApp, ROOT } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

// Each test starts from the app's own default language: the choice is stored
// per browser profile, so without this the suites would leak into each other.
async function fresh(file = 'parquet-cleaner.html') {
  const page = await openApp(browser, file);
  await page.evaluate(() => {
    window.qrx.core.storage.remove('qrx_lang');
    window.qrx.i18n.setLang(document.documentElement.getAttribute('lang') === 'de' ? 'de' : 'en');
  });
  return page;
}

describe('i18n: lookup and fallbacks', () => {
  test('translates, interpolates, and degrades gracefully', async () => {
    const page = await fresh();
    try {
      const got = await page.evaluate(() => {
        const i = window.qrx.i18n;
        i.register('t1', {
          de: { hello: 'Hallo {name}', onlyDe: 'nur deutsch' },
          en: { hello: 'Hello {name}', onlyEn: 'english only' },
        });
        i.setLang('en');
        return {
          plain: i.t('t1.hello', { name: 'Anna' }),
          missingParam: i.t('t1.hello'),
          fallbackToOther: i.t('t1.onlyDe'),
          unknownKey: i.t('t1.nope'),
          unknownNamespace: i.t('nope.nope'),
          noNamespace: i.t('bare'),
        };
      });
      assert.equal(got.plain, 'Hello Anna');
      assert.equal(got.missingParam, 'Hello {name}', 'a missing parameter stays visible');
      assert.equal(got.fallbackToOther, 'nur deutsch', 'falls back to the other language');
      assert.equal(got.unknownKey, 't1.nope', 'unknown keys degrade to the key itself');
      assert.equal(got.unknownNamespace, 'nope.nope');
      assert.equal(got.noNamespace, 'bare');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('locale follows the language, one switch for text and numbers', async () => {
    const page = await fresh();
    try {
      const got = await page.evaluate(() => {
        const i = window.qrx.i18n, c = window.qrx.core;
        i.setLang('de');
        const de = { locale: i.locale(), num: c.fmt.number(1234567.5, i.locale()) };
        i.setLang('en');
        const en = { locale: i.locale(), num: c.fmt.number(1234567.5, i.locale()) };
        return { de, en };
      });
      assert.deepEqual(got.de, { locale: 'de-DE', num: '1.234.567,5' });
      assert.deepEqual(got.en, { locale: 'en-GB', num: '1,234,567.5' });
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});

describe('i18n: DOM application', () => {
  test('translates text and attributes, and re-applies on switch', async () => {
    const page = await fresh();
    try {
      const got = await page.evaluate(() => {
        const i = window.qrx.i18n;
        i.register('t2', {
          de: { label: 'Beschriftung', hint: 'Hinweis', tip: 'Tipp' },
          en: { label: 'Label', hint: 'Hint', tip: 'Tooltip' },
        });
        const host = document.createElement('div');
        host.innerHTML = `<h4 data-qrx-i18n="t2.label"></h4>
          <input data-qrx-i18n-placeholder="t2.hint">
          <button data-qrx-i18n-title="t2.tip" data-qrx-i18n="t2.label"></button>`;
        document.body.appendChild(host);
        i.setLang('en');
        i.apply(host);            // markup added later is translated on demand
        const read = () => ({
          text: host.querySelector('h4').textContent,
          placeholder: host.querySelector('input').getAttribute('placeholder'),
          title: host.querySelector('button').getAttribute('title'),
        });
        const en = read();
        i.setLang('de');
        const de = read();
        host.remove();
        return { en, de };
      });
      assert.deepEqual(got.en, { text: 'Label', placeholder: 'Hint', title: 'Tooltip' });
      assert.deepEqual(got.de, { text: 'Beschriftung', placeholder: 'Hinweis', title: 'Tipp' });
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('switching updates <html lang>, persists, and notifies listeners', async () => {
    const page = await fresh();
    try {
      const got = await page.evaluate(() => {
        const i = window.qrx.i18n;
        const seen = [];
        const off = i.onChange(l => seen.push(l));
        i.setLang('de');
        i.setLang('de');                      // no-op, must not notify twice
        i.setLang('en');
        off();
        i.setLang('de');                      // after unsubscribe
        return {
          seen,
          htmlLang: document.documentElement.getAttribute('lang'),
          stored: localStorage.getItem('qrx_lang'),
        };
      });
      assert.deepEqual(got.seen, ['de', 'en'], 'no duplicate notifications, unsubscribe works');
      assert.equal(got.htmlLang, 'de');
      assert.equal(got.stored, 'de');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('the stored language survives a reload', async () => {
    let page = await fresh();
    try {
      await page.evaluate(() => window.qrx.i18n.setLang('de'));
    } finally { await page.close(); }
    page = await openApp(browser, 'parquet-cleaner.html');   // no reset: that is the point
    try {
      const lang = await page.evaluate(() => window.qrx.i18n.lang());
      assert.equal(lang, 'de', 'the choice follows the user across apps and reloads');
      // leave the profile in a defined state for the other suites
      await page.evaluate(() => window.qrx.core.storage.remove('qrx_lang'));
    } finally { await page.close(); }
  });
});

describe('i18n: dictionaries are complete', () => {
  test('every registered namespace has the same keys in de and en', async () => {
    const page = await fresh();
    try {
      const gaps = await page.evaluate(() => {
        const out = [];
        const dicts = window.qrx.i18n.dicts();
        for (const [ns, tables] of Object.entries(dicts)) {
          const de = Object.keys(tables.de || {}).sort();
          const en = Object.keys(tables.en || {}).sort();
          for (const k of de) if (!en.includes(k)) out.push(`${ns}.${k} missing in en`);
          for (const k of en) if (!de.includes(k)) out.push(`${ns}.${k} missing in de`);
        }
        return out;
      });
      assert.deepEqual(gaps, []);
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('every data-qrx-i18n key in the shipped apps resolves', async () => {
    const apps = readdirSync(join(ROOT, 'src', 'apps')).map(a =>
      JSON.parse(readFileSync(join(ROOT, 'src', 'apps', a, 'app.config.json'), 'utf8')).output);
    for (const file of apps) {
      const page = await openApp(browser, file);
      try {
        const unresolved = await page.evaluate(() => {
          const bad = [];
          const check = (attr) => document.querySelectorAll(`[${attr}]`).forEach(el => {
            const key = el.getAttribute(attr);
            if (window.qrx.i18n.t(key) === key) bad.push(key);
          });
          check('data-qrx-i18n');
          ['placeholder', 'title', 'aria-label', 'value'].forEach(a => check(`data-qrx-i18n-${a}`));
          return bad;
        });
        assert.deepEqual(unresolved, [], `${file} has data-i18n keys without a translation`);
      } finally { await page.close(); }
    }
  });
});

describe('i18n: the shell language switch', () => {
  test('stays hidden while the app has no translations', async () => {
    // markdown-display has no app dictionary yet
    const page = await openApp(browser, 'markdown-display.html');
    try {
      const hidden = await page.evaluate(() =>
        document.querySelector('[data-action="toggle-lang"]').hidden);
      assert.equal(hidden, true, 'a half-translated screen is worse than no switch');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('appears and switches once the app registers strings', async () => {
    const page = await fresh();
    try {
      const got = await page.evaluate(() => {
        const i = window.qrx.i18n;
        i.setLang('en');
        i.register('app', { de: { x: 'x' }, en: { x: 'x' } });
        const btn = document.querySelector('[data-action="toggle-lang"]');
        const before = { hidden: btn.hidden, label: btn.textContent, docs: document.querySelector('[data-action="toggle-docs"]').textContent.trim() };
        btn.click();
        const after = { lang: i.lang(), label: btn.textContent, docs: document.querySelector('[data-action="toggle-docs"]').textContent.trim() };
        return { before, after };
      });
      assert.equal(got.before.hidden, false, 'switch becomes available');
      assert.equal(got.before.label, 'Deutsch');
      assert.equal(got.before.docs, 'Documentation');
      assert.equal(got.after.lang, 'de');
      assert.equal(got.after.label, 'English', 'the button now offers the way back');
      assert.equal(got.after.docs, 'Dokumentation', 'shell texts followed the switch');
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});

describe('i18n: the converter is bilingual end to end', () => {
  test('the switch appears and flips the whole screen', async () => {
    const page = await openApp(browser, 'table-format-converter.html');
    try {
      await page.evaluate(() => {
        window.qrx.core.storage.remove('qrx_lang');
        window.qrx.i18n.setLang('en');
      });
      const read = () => page.evaluate(() => ({
        switchHidden: document.querySelector('[data-action="toggle-lang"]').hidden,
        dropTitle: document.querySelector('.dz-title').textContent.trim(),
        connectBtn: document.getElementById('srvConnectBtn').textContent.trim(),
        connectTitle: document.getElementById('srvConnectBtn').getAttribute('title'),
        exportBtn: document.getElementById('exportBtn').textContent.trim(),
        exportHead: document.querySelector('[data-qrx-i18n="app.export"]').textContent.trim(),
        docs: document.querySelector('[data-action="toggle-docs"]').textContent.trim(),
      }));
      const en = await read();
      await page.evaluate(() => document.querySelector('[data-action="toggle-lang"]').click());
      const de = await read();

      assert.equal(en.switchHidden, false, 'the app registered translations, so the switch shows');
      assert.equal(en.dropTitle, 'Drop a file here, or click to pick one');
      assert.equal(en.connectBtn, 'Connect with DuckDB');
      assert.equal(en.exportBtn, 'Export & download');

      assert.equal(de.dropTitle, 'Datei hier ablegen oder klicken, um eine auszuwählen');
      assert.equal(de.connectBtn, 'Mit DuckDB verbinden');
      assert.match(de.connectTitle, /DuckDB-Server/, 'tooltips switch too');
      assert.equal(de.exportBtn, 'Exportieren & herunterladen', 'a JS-rendered label switches as well');
      assert.equal(de.exportHead, 'Export');
      assert.equal(de.docs, 'Dokumentation', 'and the shell around it');
      page.assertNoErrors();
    } finally {
      await page.evaluate(() => window.qrx.core.storage.remove('qrx_lang')).catch(() => {});
      await page.close();
    }
  });

  test('the apps without a dictionary still hide the switch', async () => {
    for (const file of ['markdown-display.html', 'secure-chat.html']) {
      const page = await openApp(browser, file);
      try {
        const hidden = await page.evaluate(() =>
          document.querySelector('[data-action="toggle-lang"]').hidden);
        assert.equal(hidden, true, `${file} has no app dictionary yet`);
      } finally { await page.close(); }
    }
  });
});

describe('i18n: cleaner and profiler are bilingual too', () => {
  test('the cleaner flips markup, rule labels and the shell', async () => {
    const page = await openApp(browser, 'parquet-cleaner.html', { query: 'qrxtest' });
    try {
      await page.evaluate(() => { window.qrx.core.storage.remove('qrx_lang'); window.qrx.i18n.setLang('en'); });
      const read = () => page.evaluate(() => ({
        switchHidden: document.querySelector('[data-action="toggle-lang"]').hidden,
        drop: document.querySelector('.dz-title').textContent.trim(),
        scan: document.getElementById('reviewScanBtn').textContent.trim(),
        kpi: document.querySelector('.pc-kpi-label').textContent.trim(),
        // a rule label built in JavaScript, not in the markup
        rule: window.__qrx.cleaner.STEP_DEFS.dedupExact.label,
      }));
      const en = await read();
      await page.evaluate(() => document.querySelector('[data-action="toggle-lang"]').click());
      const de = await read();

      assert.equal(en.switchHidden, false, 'the cleaner now offers the switch');
      assert.equal(en.scan, 'Scan data');
      assert.equal(en.kpi, 'Rows');
      assert.equal(en.rule, 'Remove exact duplicates');

      assert.equal(de.drop, 'Parquet-Datei hier ablegen oder klicken, um eine auszuwählen');
      assert.equal(de.scan, 'Daten prüfen');
      assert.equal(de.kpi, 'Zeilen');
      assert.equal(de.rule, 'Exakte Duplikate entfernen', 'rule labels follow the language');
      page.assertNoErrors();
    } finally {
      await page.evaluate(() => window.qrx.core.storage.remove('qrx_lang')).catch(() => {});
      await page.close();
    }
  });

  test('the profiler flips markup, KPI cards and column headers', async () => {
    const page = await openApp(browser, 'parquet-profiler.html', { query: 'qrxtest' });
    try {
      await page.evaluate(() => { window.qrx.core.storage.remove('qrx_lang'); window.qrx.i18n.setLang('de'); });
      const read = () => page.evaluate(() => ({
        switchHidden: document.querySelector('[data-action="toggle-lang"]').hidden,
        heading: document.querySelector('#pp-dropZone h2').textContent.trim(),
        pick: document.getElementById('pp-pickBtn').textContent.trim(),
        tab: document.querySelector('#pp-tab-preview .pp-tab-label').textContent.trim(),
        tooltip: document.getElementById('pp-fullscreenBtn').getAttribute('title'),
      }));
      const de = await read();
      await page.evaluate(() => document.querySelector('[data-action="toggle-lang"]').click());
      const en = await read();

      assert.equal(de.switchHidden, false, 'the profiler now offers the switch');
      assert.equal(de.heading, 'Parquet-Dateien laden');
      assert.equal(de.tab, 'Daten-Vorschau');
      assert.match(de.tooltip, /^Vollbild für aktiven Tab/,
        'the tooltip used to show a literal \u00FC escape');

      assert.equal(en.heading, 'Load Parquet files');
      assert.equal(en.pick, 'Choose files');
      assert.equal(en.tab, 'Data preview');
      assert.match(en.tooltip, /^Full screen/);
      page.assertNoErrors();
    } finally {
      await page.evaluate(() => window.qrx.core.storage.remove('qrx_lang')).catch(() => {});
      await page.close();
    }
  });
});

describe('i18n: the documentation switches with the language', () => {
  // Docs are prose: one key per sentence would be unreadable, so each app ships
  // docs.html plus docs.<other>.html and the matching block is shown.
  const CASES = [
    ['table-format-converter.html', 'en', /A browser-only tool/, 'de', /Ein reines Browser-Werkzeug/],
    ['parquet-cleaner.html', 'en', /A browser-only tool/, 'de', /Ein reines Browser-Werkzeug/],
    ['parquet-profiler.html', 'de', /browserbasierte Anwendung/, 'en', /A browser-based tool/],
  ];

  for (const [file, langA, reA, langB, reB] of CASES) {
    test(`${file} has both languages, one visible at a time`, async () => {
      const page = await openApp(browser, file);
      try {
        const read = () => page.evaluate(() => {
          const blocks = [...document.querySelectorAll('[data-qrx-docs]')];
          const shown = blocks.filter(b => !b.hidden);
          return {
            count: blocks.length,
            shownCount: shown.length,
            lang: shown[0] && shown[0].getAttribute('data-qrx-docs'),
            text: shown[0] ? shown[0].textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
          };
        });

        await page.evaluate((l) => {
          window.qrx.core.storage.remove('qrx_lang');
          window.qrx.i18n.setLang(l);
        }, langA);
        const a = await read();
        assert.equal(a.count, 2, 'both language variants are embedded');
        assert.equal(a.shownCount, 1, 'exactly one is visible');
        assert.equal(a.lang, langA);
        assert.match(a.text, reA);

        await page.evaluate((l) => window.qrx.i18n.setLang(l), langB);
        const b = await read();
        assert.equal(b.shownCount, 1);
        assert.equal(b.lang, langB);
        assert.match(b.text, reB);
        page.assertNoErrors();
      } finally {
        await page.evaluate(() => window.qrx.core.storage.remove('qrx_lang')).catch(() => {});
        await page.close();
      }
    });
  }
});
