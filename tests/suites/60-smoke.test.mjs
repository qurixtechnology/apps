// Smoke test for EVERY built app — including the ones without a full E2E suite
// (markdown-display, secure-chat, wm2026-spielplan). It is deliberately shallow:
// load the page, let it initialise, and require that nothing threw.
//
// This is the safety net for cross-cutting changes to shared modules. Note that
// converting a hoisted `function foo()` into a `const foo = …` breaks any call
// that happens before the declaration is evaluated — exactly the kind of silent
// breakage a shared-module migration can cause, and exactly what this catches.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, openApp, ROOT } from '../helpers/browser.mjs';

const APPS = readdirSync(join(ROOT, 'src', 'apps')).map(a => ({
  name: a,
  output: JSON.parse(readFileSync(join(ROOT, 'src', 'apps', a, 'app.config.json'), 'utf8')).output,
}));

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

describe('smoke: every app boots cleanly', () => {
  for (const app of APPS) {
    test(app.name, async () => {
      const page = await openApp(browser, app.output);
      try {
        // give deferred initialisation (timers, rAF, CDN libs) a chance to run
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30_000 });
        await new Promise(r => setTimeout(r, 1500));

        const info = await page.evaluate(() => ({
          core: typeof (window.qrx && window.qrx.core && window.qrx.core.escapeHtml),
          escapes: window.qrx && window.qrx.core ? window.qrx.core.escapeHtml('<"x">') : null,
          bodyText: document.body.innerText.trim().length,
          title: document.title,
        }));
        assert.equal(info.core, 'function', 'qrx.core is available');
        assert.equal(info.escapes, '&lt;&quot;x&quot;&gt;');
        assert.ok(info.bodyText > 50, 'the app rendered visible content');
        assert.ok(info.title.length > 0, 'the page has a title');
        page.assertNoErrors(app.name);
      } finally { await page.close(); }
    });
  }
});
