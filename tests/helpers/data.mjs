// Reading exported files back. Byte comparison against a golden file would
// break on every DuckDB/SheetJS version bump, so exports are verified by their
// CONTENT: the file is parsed with the same engine the apps use and compared
// row by row.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIST } from './browser.mjs';

const DUCKDB = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm';

/** Read any DuckDB-readable file (parquet/csv/json/ndjson) into plain rows. */
export async function readRows(browser, filePath, { sql } = {}) {
  const bytes = Array.from(readFileSync(filePath));
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(join(DIST, 'parquet-cleaner.html')).href,
      { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return await page.evaluate(async (url, name, bytes, sql) => {
      const duckdb = await import(url);
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const wu = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR), new Worker(wu));
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      await db.registerFileBuffer(name, new Uint8Array(bytes));
      const res = await conn.query(sql || `SELECT * FROM '${name}'`);
      return res.toArray().map(r => JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? Number(v) : v))));
    }, DUCKDB, name, bytes, sql);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Newest file in a download directory (downloads are async). */
export function newestFile(dir) {
  const files = readdirSync(dir).filter(f => !f.endsWith('.crdownload'));
  if (!files.length) return null;
  return files
    .map(f => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0].f;
}

/** Wait for a completed download and return its path. */
export async function waitForDownload(dir, timeout = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = newestFile(dir);
    if (f && statSync(join(dir, f)).size > 0) {
      await new Promise(r => setTimeout(r, 250));       // let the write settle
      return join(dir, f);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('no download appeared in ' + dir);
}
