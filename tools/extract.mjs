// One-off extractor: slices the existing monolithic parquet-profiler.html into
// source modules (theme / shell / app) by stable comment + tag anchors.
// Verbatim content; only line endings normalise to LF. Re-runnable.
//
//   node tools/extract.mjs [source.html] [appName]
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = process.argv[2] || 'parquet-profiler.html';
const APP = process.argv[3] || 'parquet-profiler';
const APP_ONLY = process.argv.includes('--app-only'); // skip shared theme/shell (keep canonical)

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);
const has = (sub, from = 0) => { for (let i = from; i < lines.length; i++) if (lines[i].includes(sub)) return i; return -1; };
const hasi = (sub, from = 0) => { const s = sub.toLowerCase(); for (let i = from; i < lines.length; i++) if (lines[i].toLowerCase().includes(s)) return i; return -1; };
const eq  = (val, from = 0) => { for (let i = from; i < lines.length; i++) if (lines[i].trim() === val) return i; return -1; };
const eqLast = (val) => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim() === val) return i; return -1; };
// Slice [a,b) → string, trim trailing blank lines, terminate with exactly one LF.
const block = (a, b) => lines.slice(a, b).join('\n').replace(/\s*$/, '') + '\n';

// ---- CSS: theme (tokens+dark) / shell (reset+components+layout) / app ----
const iStyle      = eq('<style>');
const iTokens     = has('=== qurix design tokens', iStyle);
const iReset      = has('=== Reset & base ===', iTokens);
const iApp        = has('=== App-specific styles ===', iReset);
const iStyleClose = eq('</style>', iApp);

// ---- body chrome boundaries ----
const iHeadClose    = eq('</head>', iStyleClose);
const iDocsInner    = has('qrx-shell-docs-inner', iHeadClose);
const iDocsSecClose = eq('</section>', iDocsInner);
const iMain         = has('<main id="qrx-app"', iDocsSecClose);
const iMainClose    = eq('</main>', iMain);

// ---- scripts: shell IIFE / app logic ----
const iScript      = eq('<script>', iMainClose);
const iAppLogic    = hasi('app logic ===', iScript);
const iScriptClose = eqLast('</script>');

for (const [n, v] of Object.entries({ iStyle, iTokens, iReset, iApp, iStyleClose, iHeadClose, iDocsInner, iDocsSecClose, iMain, iMainClose, iScript, iAppLogic, iScriptClose }))
  if (v < 0) throw new Error('anchor not found: ' + n);

const shared = APP_ONLY ? {} : {
  'src/themes/qurix.css': block(iTokens, iReset),
  'src/shell/shell.css':  block(iReset, iApp),
  'src/shell/shell.js':   block(iScript + 1, iAppLogic),
};
const out = {
  ...shared,
  [`src/apps/${APP}/app.css`]:      block(iApp, iStyleClose),
  [`src/apps/${APP}/app.js`]:       block(iAppLogic, iScriptClose),
  [`src/apps/${APP}/docs.html`]:    block(iDocsInner + 1, iDocsSecClose - 1), // excl. closing </div>
  [`src/apps/${APP}/content.html`]: block(iMain + 1, iMainClose),
};

for (const [p, c] of Object.entries(out)) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c);
  console.log('extracted', p, '(' + c.length + ' bytes)');
}
console.log('done.');
