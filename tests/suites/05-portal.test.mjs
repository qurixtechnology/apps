// Portal (index.html) — categories, the collapsed archive and the search box.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, openApp } from '../helpers/browser.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const state = (page) => page.evaluate(() => {
  // content of a collapsed <details> still has boxes in Chrome, so check that explicitly
  const collapsed = (el) => { const d = el.parentElement && el.parentElement.closest('details:not([open])'); return !!d && !el.closest('summary'); };
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0 && !collapsed(el);
  return {
    categories: [...document.querySelectorAll('.qrx-cat')].filter(shown).map((s) => s.dataset.cat),
    cards: [...document.querySelectorAll('.qrx-card')].filter(shown).map((c) => c.querySelector('h3').textContent.trim()),
    archiveOpen: document.querySelector('.qrx-archive').open,
    empty: shown(document.getElementById('qrx-empty')),
  };
});
async function search(page, q) {
  await page.$eval('#qrx-search', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, q);
}

describe('portal', () => {
  test('groups the apps into categories and keeps archived apps out of sight', async () => {
    const page = await openApp(browser, 'index.html');
    try {
      await page.evaluate(() => { localStorage.removeItem('qurix_lang'); }); await page.reload();
      await page.waitForSelector('#qrx-search');
      const s = await state(page);
      const titles = await page.$$eval('.qrx-cat-title', (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(s.categories, ['tables', 'finance', 'docs', 'archive']);
      assert.deepEqual(titles, ['Datentabellen', 'Finanzen', 'Dokumente & Kommunikation', 'Archiv']);
      assert.equal(s.cards.length, 9, 'every app except the archived one is shown');
      assert.ok(['Table Profiler', 'Table Cleaner', 'Table Validator'].every((n) => s.cards.includes(n)), 'the Parquet apps are named Table …');
      assert.ok(!s.cards.some((n) => /Parquet (Profiler|Cleaner|Validator)/.test(n)));
      assert.ok(!s.cards.some((n) => /WM 2026/.test(n)), 'the archived app is not shown');
      assert.equal(s.archiveOpen, false, 'the archive starts collapsed');
      await page.click('.qrx-archive > summary');
      assert.ok((await state(page)).cards.some((n) => /WM 2026/.test(n)), 'opening the archive reveals it');
      page.assertNoErrors();
    } finally { await page.close(); }
  });

  test('the search filters by title, description, tags and category in both languages', async () => {
    const page = await openApp(browser, 'index.html');
    try {
      await page.evaluate(() => { localStorage.removeItem('qurix_lang'); }); await page.reload();
      await page.waitForSelector('#qrx-search');

      await search(page, 'profiler');
      let s = await state(page);
      assert.deepEqual(s.cards, ['Table Profiler']);
      assert.deepEqual(s.categories, ['tables'], 'categories without a match are hidden');

      await search(page, 'finance');                       // English category name on the German page
      s = await state(page);
      assert.deepEqual(s.cards, ['BWA-Bericht', 'Reisekosten']);

      await search(page, 'liquidität');                    // a tag
      assert.deepEqual((await state(page)).cards, ['BWA-Bericht']);

      await search(page, 'tippspiel');                     // only in the archive
      s = await state(page);
      assert.deepEqual(s.categories, ['archive']);
      assert.equal(s.archiveOpen, true, 'the archive opens while it has a match');
      assert.equal(s.cards.length, 1);

      await search(page, 'gibtesnicht');
      s = await state(page);
      assert.deepEqual(s.cards, []);
      assert.equal(s.empty, true, 'an empty result says so');

      await search(page, '');
      s = await state(page);
      assert.equal(s.cards.length, 9);
      assert.equal(s.archiveOpen, false, 'clearing the search collapses the archive again');
      assert.equal(s.empty, false);

      await page.click('#langToggle');
      const en = await page.evaluate(() => ({ ph: document.getElementById('qrx-search').placeholder,
        cat: document.querySelector('.qrx-cat-title').textContent.trim() }));
      assert.deepEqual(en, { ph: 'Search apps …', cat: 'Data tables' });
      await page.click('#langToggle');
      page.assertNoErrors();
    } finally { await page.close(); }
  });
});
