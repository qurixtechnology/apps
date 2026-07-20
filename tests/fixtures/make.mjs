// Regenerates every fixture deterministically:  npm run fixtures:make
//
// Text formats are written in plain Node. Parquet is produced by DuckDB-WASM in
// headless Chrome — the same engine the apps use, so no Python/native toolchain
// is needed and there is exactly one stack to keep working.
//
// Everything is synthetic. The PII values are made up but follow real formats
// (IBAN/BIC checksums are not valid, only the shape is) so the detectors have
// something meaningful to chew on.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
mkdirSync(HERE, { recursive: true });

// ---------------------------------------------------------------- tiny.csv --
// 6 rows, mixed types, one NULL, one duplicate row, one value with a comma.
const TINY_CSV = [
  'id,name,city,amount,booked_on',
  '1,Anna Berger,München,1250.50,2024-01-15',
  '2,Bob Neumann,Wien,-89.90,2024-01-16',
  '3,Carol Frei,Zürich,0.00,2024-02-01',
  '4,"Dora Klein, MBA",Berlin,17500.00,2024-02-14',
  '5,Emil Stark,,42.42,2024-03-03',
  '5,Emil Stark,,42.42,2024-03-03',
  '',
].join('\n');
writeFileSync(join(HERE, 'tiny.csv'), TINY_CSV, 'utf8');

// ------------------------------------------------------------- tiny.ndjson --
const NDJSON_ROWS = [
  { id: 1, name: 'Anna Berger', city: 'München', amount: 1250.5, booked_on: '2024-01-15' },
  { id: 2, name: 'Bob Neumann', city: 'Wien', amount: -89.9, booked_on: '2024-01-16' },
  { id: 3, name: 'Carol Frei', city: 'Zürich', amount: 0, booked_on: '2024-02-01' },
];
writeFileSync(join(HERE, 'tiny.ndjson'), NDJSON_ROWS.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
writeFileSync(join(HERE, 'tiny.json'), JSON.stringify(NDJSON_ROWS, null, 2) + '\n', 'utf8');

// ----------------------------------------------------------------- pii.csv --
// Feeds the PII detector: every direct identifier it knows, plus quasi-
// identifiers, plus a decoy date column that must NOT be read as a phone number.
const PII_HEADER = 'kunde,email,telefon,iban,bic,plz,geburtsdatum,buchungstag,betrag,kategorie';
const FIRST = ['Anna', 'Bob', 'Carol', 'Dora', 'Emil', 'Frida', 'Gustav', 'Hana', 'Igor', 'Jana'];
const LAST = ['Berger', 'Neumann', 'Frei', 'Klein', 'Stark', 'Wolf', 'Ritter', 'Sommer', 'Adler', 'Falk'];
const CITY_ZIP = ['80331', '10115', '20095', '50667', '70173'];
const CAT = ['Miete', 'Gehalt', 'Versicherung', 'Einkauf', 'Reise'];
const piiRows = [];
for (let i = 0; i < 60; i++) {                       // deterministic, no RNG
  const fn = FIRST[i % FIRST.length], ln = LAST[(i * 3) % LAST.length];
  const n = String(1000000 + i * 7919);
  piiRows.push([
    `${fn} ${ln}`,
    `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`,
    `+49 89 ${n.slice(0, 3)} ${n.slice(3)}`,
    `DE${String(10 + (i % 89))}${'1'.padStart(2, '0')}${n}${String(i).padStart(6, '0')}`.slice(0, 22),
    ['DEUTDEFFXXX', 'GENODEF1M04', 'BYLADEM1001'][i % 3],
    CITY_ZIP[i % CITY_ZIP.length],
    `19${60 + (i % 40)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    `2024-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    (((i % 2 ? 1 : -1) * (100 + i * 37.5))).toFixed(2),
    CAT[i % CAT.length],
  ].join(','));
}
writeFileSync(join(HERE, 'pii.csv'), [PII_HEADER, ...piiRows, ''].join('\n'), 'utf8');

// ------------------------------------------------- parquet via DuckDB-WASM --
async function makeParquet() {
  const puppeteer = (await import('puppeteer-core')).default;
  const { chromePath } = await import('../helpers/browser.mjs');
  const browser = await puppeteer.launch({
    executablePath: chromePath(), headless: 'new', args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    // any built app works as a host page with the right CSP-free file:// origin
    await page.goto(pathToFileURL(join(ROOT, 'dist', 'parquet-cleaner.html')).href,
      { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const files = await page.evaluate(async (csvTiny, csvPii) => {
      const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.33.1-dev57.0/+esm');
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const wu = URL.createObjectURL(new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }));
      const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR), new Worker(wu));
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const conn = await db.connect();
      const out = {};
      for (const [name, csv] of [['tiny', csvTiny], ['pii', csvPii]]) {
        await db.registerFileText(name + '.csv', csv);
        await conn.query(`CREATE OR REPLACE TABLE t AS SELECT * FROM read_csv('${name}.csv', header=true)`);
        await conn.query(`COPY (SELECT * FROM t) TO '${name}.parquet' (FORMAT PARQUET, COMPRESSION 'zstd')`);
        const buf = await db.copyFileToBuffer(name + '.parquet');
        out[name] = Array.from(buf);
      }
      return out;
    }, TINY_CSV, [PII_HEADER, ...piiRows, ''].join('\n'));
    for (const [name, bytes] of Object.entries(files)) {
      writeFileSync(join(HERE, name + '.parquet'), Buffer.from(bytes));
      console.log('wrote', name + '.parquet', bytes.length, 'bytes');
    }
  } finally {
    await browser.close();
  }
}

await makeParquet();
console.log('fixtures written to', HERE);
