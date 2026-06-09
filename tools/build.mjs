// qurix app generator (zero-dependency).
// Assembles each app under src/apps/* from {theme + shell + app} modules into a
// single self-contained HTML file in dist/. CDN libs stay external <script src>;
// fonts stay <link>. Run: npm run build  (or: node tools/build.mjs)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fillSlots } from './slots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const trimNl = (s) => s.replace(/\n+$/, '');

// Build version = newest modification time among an app's source files,
// formatted YYMMDD-HHMMSS (local time). Baked into [data-build-version].
const mtimeMs = (p) => { try { return statSync(join(ROOT, p)).mtimeMs; } catch { return 0; } };
const pad2 = (n) => String(n).padStart(2, '0');
function fmtVersion(ms) {
  const d = new Date(ms);
  return `${String(d.getFullYear()).slice(2)}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
       + `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function buildApp(appRel) {
  const cfg = JSON.parse(rd(`${appRel}/app.config.json`));
  const title = cfg.title || `${cfg.name} – qurix`;
  const includeShellCss = cfg.shellCss !== false; // apps with a bespoke shell skin set false

  // --- one main <style>: theme [+ shared shell] + app ---
  const styleParts = [rd(`src/themes/${cfg.theme}.css`)];
  if (includeShellCss) styleParts.push(rd('src/shell/shell.css'));
  styleParts.push(rd(`${appRel}/app.css`));
  const styleBlock = styleParts.map(trimNl).join('\n\n');

  // --- verbatim inline <style> assets (e.g. a vendored lib), own blocks ---
  const inlineStylesHtml = (cfg.inlineStyles || [])
    .map((p) => `\n<style>\n${trimNl(rd(`${appRel}/${p}`))}\n</style>`).join('');

  // --- head: optional theme fonts + external CDN <script src> refs ---
  const fonts = (cfg.fonts || []).map((f) => '\n' + trimNl(rd(`src/themes/${f}`))).join('');
  const headAssets = (cfg.headAssets || []).map((a) => {
    const cross = a.crossorigin ? ` crossorigin="${a.crossorigin}"` : '';
    return (a.comment ? `<!-- ${a.comment} -->\n` : '') + `<script src="${a.src}"${cross}></script>`;
  });
  const headAssetsHtml = headAssets.length ? '\n\n' + headAssets.join('\n') : '';

  // --- build version: newest mtime across this app's dependent source files ---
  const deps = [
    `src/themes/${cfg.theme}.css`,
    ...(cfg.fonts || []).map((f) => `src/themes/${f}`),
    ...(includeShellCss ? ['src/shell/shell.css'] : []),
    'src/shell/shell.js', 'src/shell/chrome.html',
    `${appRel}/app.config.json`, `${appRel}/app.css`, `${appRel}/app.js`,
    `${appRel}/content.html`, `${appRel}/docs.html`,
    ...(cfg.inlineStyles || []).map((p) => `${appRel}/${p}`),
    ...(cfg.inlineScripts || []).map((p) => `${appRel}/${p}`),
  ];
  const version = fmtVersion(Math.max(...deps.map(mtimeMs)));

  // --- chrome with app slots filled (literal replace) ---
  const chrome = trimNl(fillSlots(rd('src/shell/chrome.html'), {
    '{{APP_NAME}}': cfg.name,
    '{{BUILD_VERSION}}': version,
    '<!--SLOT:app-docs-->': trimNl(rd(`${appRel}/docs.html`)),
    '<!--SLOT:app-content-->': trimNl(rd(`${appRel}/content.html`)),
  }));

  // --- scripts: shell IIFE [+ verbatim inline libs] + app logic ---
  const shellJs = trimNl(rd('src/shell/shell.js'));
  const appJs = trimNl(rd(`${appRel}/app.js`));
  const inlineScripts = (cfg.inlineScripts || []).map((p) => trimNl(rd(`${appRel}/${p}`)));
  // With inline libs, emit separate <script> blocks (shell, lib(s), app) so a
  // vendored library keeps its own top-level scope; otherwise one combined block.
  const scriptsHtml = inlineScripts.length
    ? [shellJs, ...inlineScripts, appJs].map((s) => `<script>\n${s}\n</script>`).join('\n\n')
    : `<script>\n${shellJs}\n\n${appJs}\n</script>`;

  const html =
`<!DOCTYPE html>
<html lang="${cfg.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>${fonts}
<style>
${styleBlock}
</style>${inlineStylesHtml}${headAssetsHtml}
</head>
<body>

${chrome}

${scriptsHtml}

</body>
</html>
`;

  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  writeFileSync(join(ROOT, 'dist', cfg.output), html);
  console.log('built dist/' + cfg.output, 'v' + version, '(' + html.length + ' bytes)');
}

// Portal (index.html): uses the THEME but NOT the shell; cards are derived
// from each app's config + icon.svg, so adding an app surfaces it automatically.
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

function buildPortal() {
  const cfgRel = 'src/portal/portal.config.json';
  if (!existsSync(join(ROOT, cfgRel))) return false;
  const cfg = JSON.parse(rd(cfgRel));

  const styleBlock = [rd(`src/themes/${cfg.theme}.css`), rd('src/portal/portal.css')].map(trimNl).join('\n\n');
  const fonts = (cfg.fonts || []).map((f) => '\n' + trimNl(rd(`src/themes/${f}`))).join('');

  const cards = (cfg.apps || []).map((app) => {
    const a = JSON.parse(rd(`src/apps/${app}/app.config.json`));
    const card = a.card || {};
    const icon = trimNl(rd(`src/apps/${app}/icon.svg`)).split('\n').map((l) => '        ' + l).join('\n');

    // Bilingual card text: German is the rendered default, English carried in
    // data-en (the portal's DE/EN toggle swaps it client-side).
    const titleDe = card.title || a.name;
    const titleEn = card.title_en || titleDe;
    const titleAttrs = (card.title || card.title_en)
      ? ` data-de="${escAttr(titleDe)}" data-en="${escAttr(titleEn)}"` : '';
    const descDe = card.description || '';
    const descEn = card.description_en || descDe;
    const tagsDe = card.tags || [];
    const tagsEn = card.tags_en || tagsDe;
    const tags = tagsDe.map((t, i) => {
      const en = tagsEn[i] != null ? tagsEn[i] : t;
      return `        <span class="qrx-tagchip" data-de="${escAttr(t)}" data-en="${escAttr(en)}">${esc(t)}</span>`;
    }).join('\n');

    return `    <!-- ${esc(a.name)} -->
    <article class="qrx-card">
      <div class="qrx-card-icon">
${icon}
      </div>
      <h2${titleAttrs}>${esc(titleDe)}</h2>
      <p data-de="${escAttr(descDe)}" data-en="${escAttr(descEn)}">
        ${esc(descDe)}
      </p>
      <div class="qrx-card-meta">
${tags}
      </div>
      <a class="qrx-launch" href="${a.output}">
        <span data-de="App öffnen" data-en="Launch app">App öffnen</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </a>
    </article>`;
  }).join('\n\n');

  const body = fillSlots(rd('src/portal/portal.html'), { '<!--SLOT:cards-->': cards });

  const html =
`<!DOCTYPE html>
<html lang="${cfg.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${cfg.title}</title>
<meta name="description" content="${esc(cfg.description || '')}">${fonts}
<style>
${styleBlock}
</style>
</head>
<body>

${trimNl(body)}

</body>
</html>
`;
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  writeFileSync(join(ROOT, 'dist', cfg.output), html);
  console.log('built dist/' + cfg.output + ' (portal)');
  return true;
}

const appsDir = join(ROOT, 'src/apps');
let n = 0;
for (const name of readdirSync(appsDir)) {
  if (existsSync(join(appsDir, name, 'app.config.json'))) { buildApp(`src/apps/${name}`); n++; }
}
if (buildPortal()) console.log('portal built.');
console.log(n + ' app(s) built.');
