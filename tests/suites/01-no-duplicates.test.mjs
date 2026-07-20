// Guard against re-duplication.
//
// Every entry below was, at some point, implemented separately in several apps.
// Now it lives in src/shared/. If an app defines its own version again, this
// test fails and says where the canonical one is — that is the whole point of
// the modularisation, and without a guard it silently erodes.
//
// Aliasing the shared function to a local name is fine and expected:
//   const escapeHtml = qrx.core.escapeHtml;   ← allowed
//   function escapeHtml(s) { … }              ← fails here
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../helpers/browser.mjs';

const APPS = readdirSync(join(ROOT, 'src', 'apps'));

// name -> where it now belongs
const OWNED = {
  escapeHtml: 'qrx.core.escapeHtml',
  escapeAttr: 'qrx.core.escapeHtml (escapes quotes too — no separate attr escaper)',
  debounce: 'qrx.core.debounce',
  triggerDownload: 'qrx.core.download',
  downloadBlob: 'qrx.core.download',
  downloadFile: 'qrx.core.download',
  fmtBytes: 'qrx.core.fmt.bytes',
  formatBytes: 'qrx.core.fmt.bytes',
  fmtDur: 'qrx.core.fmt.duration',
  fmtDuration: 'qrx.core.fmt.duration',
  formatDateByType: 'qrx.core.fmt.dateByType',

  sqlEscape: 'qrx.duckdb.esc',
  sqlIdent: 'qrx.duckdb.ident',
  quoteIdent: 'qrx.duckdb.ident',
  quoteString: 'qrx.duckdb.str (returns a finished literal, unlike esc)',
  arrowFriendlyType: 'qrx.duckdb.friendlyType',
  typeClass: 'qrx.duckdb.typeClass',
  arrowFields: 'qrx.duckdb.fields',
  arrowRows: 'qrx.duckdb.rows',
  rowsFromQuery: 'qrx.duckdb.rows',
  coerceDateValue: 'qrx.duckdb.toDate',
  isDateLikeArrowType: 'qrx.duckdb.isDateLike',
  cellText: 'qrx.duckdb.cellText',

  showToast: 'qrx.ui.toast',
};

describe('no re-duplication of shared code', () => {
  test('no app declares a function that a shared module owns', () => {
    const offences = [];
    for (const app of APPS) {
      const file = join(ROOT, 'src', 'apps', app, 'app.js');
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const [name, home] of Object.entries(OWNED)) {
          // a declaration, not an alias assignment
          const decl = new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\s*\\(`);
          if (decl.test(line)) {
            offences.push(`${app}/app.js:${i + 1}  "${name}" belongs to ${home}`);
          }
        }
      });
    }
    assert.deepEqual(offences, [], 'shared code was re-implemented:\n  ' + offences.join('\n  '));
  });

  test('every app loads qrx-core', () => {
    for (const app of APPS) {
      const cfg = JSON.parse(readFileSync(join(ROOT, 'src', 'apps', app, 'app.config.json'), 'utf8'));
      assert.ok((cfg.inlineScripts || []).includes('../../shared/qrx-core.js'),
        `${app}: app.config.json must include ../../shared/qrx-core.js`);
    }
  });

  test('qrx-core is loaded before the other shared modules', () => {
    for (const app of APPS) {
      const cfg = JSON.parse(readFileSync(join(ROOT, 'src', 'apps', app, 'app.config.json'), 'utf8'));
      const scripts = cfg.inlineScripts || [];
      const core = scripts.indexOf('../../shared/qrx-core.js');
      scripts.forEach((s, i) => {
        if (s.startsWith('../../shared/') && s !== '../../shared/qrx-core.js') {
          assert.ok(core < i, `${app}: qrx-core must come before ${s}`);
        }
      });
    }
  });
});
