// Build & static integrity — no browser, runs in seconds.
// Catches the class of breakage that is otherwise only found by clicking:
// syntax errors, unreplaced slots, missing shared modules, stale versions.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DIST } from '../helpers/browser.mjs';

const APPS = readdirSync(join(ROOT, 'src', 'apps'));
const DUCK_APPS = ['table-format-converter', 'parquet-cleaner', 'parquet-profiler'];
const cfg = (a) => JSON.parse(readFileSync(join(ROOT, 'src', 'apps', a, 'app.config.json'), 'utf8'));

describe('build', () => {
  before(() => {
    execFileSync(process.execPath, [join(ROOT, 'tools', 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
  });

  test('every app source parses', () => {
    const files = [
      ...APPS.map(a => join(ROOT, 'src', 'apps', a, 'app.js')),
      ...readdirSync(join(ROOT, 'src', 'shared')).map(f => join(ROOT, 'src', 'shared', f)),
      join(ROOT, 'src', 'shell', 'shell.js'),
    ].filter(f => f.endsWith('.js'));
    for (const f of files) {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    }
  });

  test('referenced inline assets exist', () => {
    for (const a of APPS) {
      const c = cfg(a);
      for (const p of [...(c.inlineScripts || []), ...(c.inlineStyles || [])]) {
        const full = join(ROOT, 'src', 'apps', a, p);
        assert.ok(existsSync(full), `${a}: missing ${p}`);
      }
    }
  });

  test('each app produces a dist file', () => {
    for (const a of APPS) {
      const out = join(DIST, cfg(a).output);
      assert.ok(existsSync(out), `missing ${out}`);
      assert.ok(readFileSync(out, 'utf8').length > 1000);
    }
  });

  test('no unreplaced template slots or stray undefined in dist', () => {
    for (const f of readdirSync(DIST).filter(f => f.endsWith('.html'))) {
      const html = readFileSync(join(DIST, f), 'utf8');
      assert.ok(!html.includes('<!--SLOT:'), `${f} has an unreplaced slot`);
      // the build's placeholders look like {{APP_NAME}} — match that shape, not
      // any double brace, which also occurs in legitimate JSDoc and templates
      assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/, `${f} has an unreplaced placeholder`);
      assert.ok(!/>undefined</.test(html), `${f} renders "undefined"`);
    }
  });

  test('DuckDB apps ship the shared modules and a quack-capable engine', () => {
    for (const a of DUCK_APPS) {
      const html = readFileSync(join(DIST, cfg(a).output), 'utf8');
      assert.match(html, /window\.qrxDuckServer\s*=/, `${a}: shared duckdb-server module missing`);
      assert.match(html, /window\.qrxTest\s*=/, `${a}: test hooks missing`);
      assert.match(html, /qrx\.duckdb\s*=/, `${a}: shared duckdb module missing`);
    }
  });

  test('the engine version lives in one place and is quack-capable', () => {
    // quack (the DuckDB remote protocol) needs engine >= 1.5.3, which is
    // duckdb-wasm 1.33.1-dev57.0 or newer. Older pins silently load an
    // unrelated namesake extension instead of failing.
    const mod = readFileSync(join(ROOT, 'src', 'shared', 'qrx-duckdb.js'), 'utf8');
    const m = /const VERSION = '([^']+)'/.exec(mod);
    assert.ok(m, 'qrx-duckdb.js must declare a VERSION constant');
    const [maj, min] = m[1].split('.').map(Number);
    assert.ok(maj > 1 || (maj === 1 && min >= 33), `duckdb-wasm ${m[1]} is too old for quack`);

    // no app may pin its own version any more
    for (const app of APPS) {
      const src = readFileSync(join(ROOT, 'src', 'apps', app, 'app.js'), 'utf8');
      const own = [...src.matchAll(/duckdb-wasm@([0-9a-z.-]+)/g)].map(x => x[1]);
      assert.deepEqual(own, [], `${app} pins its own duckdb-wasm version: ${own.join(', ')}`);
    }
  });
});
