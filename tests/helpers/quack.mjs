// Local DuckDB server (quack) fixture.
//
// Needs Python with the duckdb package on DuckDB >= 1.5.3 (that is where the
// quack extension appeared). If anything is missing the suite SKIPS with a
// clear message instead of failing — a missing optional toolchain is not a
// regression.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './browser.mjs';

export const URI = 'quack:localhost:9599';
export const TOKEN = 'qrx-test-token';
const WORK = join(ROOT, 'tests', '.cache', 'quack');

// Tables the suite relies on:
//   main.hello   – small, readable
//   main.people  – PII-ish, for cleaner runs
//   demo.orders  – in another schema: listed by quack but NOT readable
const SERVER_PY = `
import duckdb, sys, time
con = duckdb.connect()
con.sql("INSTALL quack"); con.sql("LOAD quack")
con.sql("CREATE TABLE hello AS SELECT * FROM (VALUES (1,'Anna','DE'),(2,'Bob','AT'),(3,'Carol','CH')) t(id,name,country)")
con.sql("""CREATE TABLE people AS SELECT * FROM (VALUES
  (1,'Anna Berger','anna.berger@example.com','DE44500105175407324931', 1250.50),
  (2,'Bob Neumann','bob.neumann@example.com','DE02120300000000202051',  -89.90),
  (3,'Carol Frei','carol.frei@example.com','DE02100500000054540402',   4200.00)
) t(id, kunde, email, iban, betrag)""")
con.sql("CREATE SCHEMA demo")
con.sql("CREATE TABLE demo.orders AS SELECT * FROM (VALUES (10, 99.90)) t(order_id, amount)")
try:
    con.sql("CALL quack_serve('${URI}', token='${TOKEN}')").fetchall()
except Exception as e:
    print("SERVE_ERROR", e, flush=True); sys.exit(1)
print("SERVER_UP", flush=True)
while True:
    time.sleep(3600)
`;

/** Why the quack suite cannot run here, or null if it can. */
export function unavailableReason() {
  if (process.env.QRX_SKIP_QUACK) return 'disabled via QRX_SKIP_QUACK';
  for (const py of ['python', 'python3']) {
    try {
      const v = execFileSync(py, ['-c',
        'import duckdb;print(duckdb.sql("select version()").fetchall()[0][0])'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const m = /v?(\d+)\.(\d+)\.(\d+)/.exec(v);
      if (!m) return `could not parse the DuckDB version from "${v}"`;
      const [maj, min, patch] = m.slice(1).map(Number);
      const ok = maj > 1 || (maj === 1 && (min > 5 || (min === 5 && patch >= 3)));
      if (!ok) return `python duckdb is ${v}, quack needs >= 1.5.3`;
      process.env.QRX_PY = py;
      return null;
    } catch (_) { /* try the next interpreter */ }
  }
  return 'no python with the duckdb package found';
}

let proc = null;

export async function startServer() {
  mkdirSync(WORK, { recursive: true });
  const script = join(WORK, 'server.py');
  writeFileSync(script, SERVER_PY, 'utf8');
  proc = spawn(process.env.QRX_PY || 'python', [script], { cwd: WORK, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  proc.stdout.on('data', d => out.push(String(d)));
  proc.stderr.on('data', d => out.push(String(d)));
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    if (out.join('').includes('SERVER_UP')) return;
    if (proc.exitCode !== null) throw new Error('quack server died:\n' + out.join(''));
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('quack server did not come up:\n' + out.join(''));
}

export async function stopServer() {
  if (!proc) return;
  proc.kill();
  proc = null;
  await new Promise(r => setTimeout(r, 300));
  rmSync(WORK, { recursive: true, force: true });
}

/** Read a table straight from the server (independent of the app under test). */
export function queryServer(sql) {
  const py = `
import duckdb, json
con = duckdb.connect()
con.sql("INSTALL quack"); con.sql("LOAD quack")
con.sql("CREATE SECRET (TYPE quack, TOKEN '${TOKEN}')")
con.sql("ATTACH '${URI}' AS r")
rows = con.sql(${JSON.stringify(sql)}).fetchall()
print(json.dumps(rows, default=str))
`;
  const out = execFileSync(process.env.QRX_PY || 'python', ['-c', py], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}
