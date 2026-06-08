// One-off extractor for wm2026-spielplan.html (bespoke structure: custom :root,
// two <style> blocks (app+shell-dark, then inline Leaflet CSS), three <script>
// blocks (shell IIFE, inline Leaflet JS, app JS)). Writes the wm-dark theme,
// app modules, and the vendored Leaflet as verbatim assets. Re-runnable.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const APP = 'wm2026-spielplan';
const lines = readFileSync('wm2026-spielplan.html', 'utf8').split(/\r?\n/);
const eq  = (v, from = 0) => { for (let i = from; i < lines.length; i++) if (lines[i].trim() === v) return i; return -1; };
const has = (s, from = 0) => { for (let i = from; i < lines.length; i++) if (lines[i].includes(s)) return i; return -1; };
const eqLast = (v) => { for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim() === v) return i; return -1; };
const block = (a, b) => lines.slice(a, b).join('\n').replace(/\s*$/, '') + '\n';
// like block() but strip a leading tag (<style>/<script>) off the first line
const asset = (a, b, tag) => {
  const ls = lines.slice(a, b).slice();
  ls[0] = ls[0].replace(new RegExp('^' + tag), '');
  return ls.join('\n').replace(/\s*$/, '') + '\n';
};

const iStyle1     = eq('<style>');
const iRoot       = has(':root{', iStyle1);
let   iRootClose  = -1; for (let i = iRoot + 1; i < lines.length; i++) { if (lines[i].trim() === '}') { iRootClose = i; break; } }
const iStyle1End  = eq('</style>', iRoot);
const iStyle2     = has('<style>', iStyle1End);     // '<style>/* Leaflet ...'
const iStyle2End  = eq('</style>', iStyle2);
const iHeadClose  = eq('</head>', iStyle2End);
const iDocsInner  = has('qrx-shell-docs-inner', iHeadClose);
const iDocsSecEnd = eq('</section>', iDocsInner);
const iMain       = has('<main id="qrx-app"', iDocsSecEnd);
const iMainClose  = eq('</main>', iMain);
const iScript1    = eq('<script>', iMainClose);     // shell IIFE
const iScript1End = eq('</script>', iScript1);
const iScript2    = has('<script>', iScript1End);   // '<script>/* Leaflet ...'
const iScript2End = eq('</script>', iScript2);
const iScript3    = eq('<script>', iScript2End);    // app JS
const iScript3End = eqLast('</script>');

for (const [n, v] of Object.entries({ iStyle1, iRoot, iRootClose, iStyle1End, iStyle2, iStyle2End, iHeadClose, iDocsInner, iDocsSecEnd, iMain, iMainClose, iScript1, iScript1End, iScript2, iScript2End, iScript3, iScript3End }))
  if (v < 0) throw new Error('anchor not found: ' + n);

const out = {
  'src/themes/wm-dark.css':              block(iRoot, iRootClose + 1),           // :root tokens only
  [`src/apps/${APP}/app.css`]:           block(iRootClose + 1, iStyle1End),      // reset+@font-face+app+shell-dark
  [`src/apps/${APP}/app.js`]:            block(iScript3 + 1, iScript3End),
  [`src/apps/${APP}/docs.html`]:         block(iDocsInner + 1, iDocsSecEnd - 1), // excl. closing </div>
  [`src/apps/${APP}/content.html`]:      block(iMain + 1, iMainClose),
  [`src/apps/${APP}/assets/leaflet-1.9.4.css`]: asset(iStyle2, iStyle2End, '<style>'),
  [`src/apps/${APP}/assets/leaflet-1.9.4.js`]:  asset(iScript2, iScript2End, '<script>'),
};

for (const [p, c] of Object.entries(out)) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, c);
  console.log('extracted', p, '(' + c.length + ' bytes)');
}
console.log('done.');
