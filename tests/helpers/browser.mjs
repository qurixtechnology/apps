// Browser plumbing shared by every E2E suite.
//
// Design rules learned the hard way:
//  - a page error or console.error fails the test (silent breakage is worse
//    than a red test),
//  - never sleep: wait for app-owned state (data-qrx-state) or a real condition,
//  - on failure, dump a screenshot + the console log to tests/artifacts/.
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DIST = join(ROOT, 'dist');
export const ARTIFACTS = join(ROOT, 'tests', 'artifacts');

// Chrome location: CHROME_PATH wins, otherwise try the usual suspects.
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function chromePath() {
  const found = CANDIDATES.find(p => existsSync(p));
  if (!found) {
    throw new Error('No Chrome found. Set CHROME_PATH to a Chrome/Chromium binary.\nTried:\n  '
      + CANDIDATES.join('\n  '));
  }
  return found;
}

// A persistent profile keeps Chrome's own HTTP cache across runs, so the
// multi-megabyte duckdb-wasm bundles are fetched once instead of per run.
// (Request interception was tried instead and broke the WASM worker.)
// Suites run serially (--test-concurrency=1) and share this profile. Set
// QRX_PROFILE to run a suite in parallel with another one.
export const PROFILE = join(ROOT, 'tests', '.cache', process.env.QRX_PROFILE || 'chrome-profile');

export async function launch(opts = {}) {
  mkdirSync(PROFILE, { recursive: true });
  return puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env.QRX_HEADED ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    userDataDir: PROFILE,
    ...opts,
  });
}

/**
 * Open a built app from dist/ and attach error capture.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} file  e.g. 'parquet-cleaner.html'
 * @param {{query?: string, downloadPath?: string}} [o]
 */
export async function openApp(browser, file, o = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text();
      // Chrome logs failed favicon/devtools noise on file:// — ignore that only.
      if (!/favicon|net::ERR_FILE_NOT_FOUND.*favicon/i.test(t)) errors.push('console.error: ' + t);
    }
  });
  page.errors = errors;
  page.assertNoErrors = (label = '') => {
    if (errors.length) {
      throw new Error(`Page reported errors${label ? ' (' + label + ')' : ''}:\n  ` + errors.join('\n  '));
    }
  };
  if (o.downloadPath) {
    mkdirSync(o.downloadPath, { recursive: true });
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: o.downloadPath });
  }
  const url = pathToFileURL(join(DIST, file)).href + (o.query ? '?' + o.query : '');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return page;
}

/** Wait until the app reports it is idle (data-qrx-state="ready"). */
export function waitReady(page, timeout = 180_000) {
  return page.waitForFunction(() => document.body.dataset.qrxState === 'ready', { timeout });
}

/**
 * Run an action and wait for THAT operation to complete one more time.
 * `op` is an app-side tick name ('preview', 'recompute', 'scan', 'profile').
 * Waiting for a generic "ready" is not enough: an unrelated render would
 * satisfy it and the test would then read a half-finished screen.
 */
export async function settle(page, op, action, timeout = 180_000) {
  const snap = () => page.evaluate(() => ({
    ticks: document.body.dataset.qrxTicks || '{}',
    state: document.body.dataset.qrxState || '',
  }));
  const opCount = (s) => { try { return JSON.parse(s.ticks)[op] || 0; } catch (_) { return 0; } };

  const before = opCount(await snap());
  await action();

  // Two conditions, both needed:
  //  - the operation completed at least once AFTER the action, and
  //  - nothing else is still rendering. A render that was already in flight
  //    when the action started would otherwise satisfy the counter alone and
  //    the test would read the screen mid-update.
  const t0 = Date.now();
  let last = '', stableSince = 0;
  while (Date.now() - t0 < timeout) {
    const s = await snap();
    const key = s.ticks + '|' + s.state;
    const advanced = opCount(s) > before;
    if (key === last && s.state === 'ready' && advanced) {
      if (!stableSince) stableSince = Date.now();
      else if (Date.now() - stableSince >= 250) return;
    } else {
      last = key; stableSince = 0;
    }
    await new Promise(r => setTimeout(r, 40));
  }
  const s = await snap();
  throw new Error(`settle("${op}") timed out after ${timeout}ms — state=${s.state} ticks=${s.ticks}`);
}

/** Wait for an arbitrary predicate evaluated in the page. */
export function waitFor(page, fn, timeout = 120_000, ...args) {
  return page.waitForFunction(fn, { timeout }, ...args);
}

/** textContent of a selector — innerText is empty for non-rendered elements. */
export function text(page, sel) {
  return page.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim());
}

/** Rows of a table body as string[][]. */
export function tableRows(page, sel) {
  return page.$$eval(sel + ' tbody tr', trs =>
    trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())));
}

/** Dump a screenshot + console log for a failed test. */
export async function dumpArtifacts(page, name) {
  try {
    mkdirSync(ARTIFACTS, { recursive: true });
    const safe = name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
    await page.screenshot({ path: join(ARTIFACTS, safe + '.png'), fullPage: true });
    writeFileSync(join(ARTIFACTS, safe + '.log'), (page.errors || []).join('\n'), 'utf8');
    writeFileSync(join(ARTIFACTS, safe + '.html'), await page.content(), 'utf8');
  } catch (_) { /* artifacts are best-effort */ }
}

/** Run body(page) and always dump artifacts + close on failure. */
export async function withApp(browser, file, o, body) {
  const page = await openApp(browser, file, o);
  try {
    const r = await body(page);
    page.assertNoErrors(file);
    return r;
  } catch (e) {
    await dumpArtifacts(page, file + '-' + Date.now());
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}
