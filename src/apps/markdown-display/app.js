// === Markdown Display — app logic ===
// Docs toggle, build-version stamp and the Export buttons are provided by the
// shared shell (shell.js). This file only renders Markdown, draws Mermaid
// diagrams, exports the rendered document as PDF, and wires the snapshot hooks.
(function () {
  'use strict';

  // ----- Refs -----
  const fileInput   = document.getElementById('md-file-input');
  const openBtn     = document.querySelector('[data-action="open-file"]');
  const sampleBtn   = document.querySelector('[data-action="load-sample"]');
  const clearBtn    = document.querySelector('[data-action="clear"]');
  const pdfBtn      = document.querySelector('[data-action="export-pdf"]');
  const dropzone    = document.getElementById('md-dropzone');
  const output      = document.getElementById('md-output');
  const filenameEl  = document.querySelector('[data-current-filename]');
  const toast       = document.getElementById('md-toast');

  // ----- State -----
  let currentFilename = null;
  let currentText = null;   // raw markdown of the loaded document (for snapshots)
  let currentFmTitle = null; // title from YAML front matter, if any

  // ----- Configure marked -----
  if (typeof marked === 'undefined') {
    showToast('Markdown library failed to load. Check your internet connection.', 'error');
    return;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: true,
    mangle: false,
    highlight: function (code, lang) {
      // Leave mermaid blocks untouched — they are turned into diagrams after render.
      if ((lang || '').toLowerCase() === 'mermaid') return escapeHtml(code);
      if (typeof hljs === 'undefined') return code;
      try {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        }
        return hljs.highlightAuto(code).value;
      } catch (_e) {
        return code;
      }
    }
  });

  // ----- Toast helper -----
  let toastTimer = null;
  function showToast(msg, kind) {
    toast.textContent = msg;
    toast.classList.remove('is-error', 'is-success');
    if (kind === 'error')   toast.classList.add('is-error');
    if (kind === 'success') toast.classList.add('is-success');
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  // ----- Mermaid -----
  // qurix-branded palette for diagrams (light, on the white figure surface).
  // Values mirror the design tokens in qurix.css (literals here because mermaid
  // reads them in JS, not via CSS var()).
  const MERMAID_THEME = {
    fontFamily: '"Quicksand","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
    fontSize: '15px',
    background: '#FFFFFF',
    primaryColor: '#E7F1F0',        // node fill — light brand tint
    primaryBorderColor: '#156B8E',  // qrx-blue
    primaryTextColor: '#0E2530',    // qrx-text
    secondaryColor: '#E8EEF2',      // qrx-bg-muted
    secondaryBorderColor: '#2EC4A2',// qrx-green accent
    secondaryTextColor: '#0E2530',
    tertiaryColor: '#F4F7F9',       // qrx-bg-subtle
    tertiaryBorderColor: '#BCC8D0',
    tertiaryTextColor: '#0E2530',
    mainBkg: '#E7F1F0',
    nodeBorder: '#156B8E',
    nodeTextColor: '#0E2530',
    lineColor: '#5A6B75',           // qrx-text-muted (edges)
    titleColor: '#156B8E',
    edgeLabelBackground: '#FFFFFF',
    clusterBkg: '#F4F7F9',          // subgraph background
    clusterBorder: '#DBE3E8',
    // sequence diagrams
    actorBkg: '#E7F1F0',
    actorBorder: '#156B8E',
    actorTextColor: '#0E2530',
    signalColor: '#5A6B75',
    signalTextColor: '#0E2530',
    labelBoxBkgColor: '#F4F7F9',
    labelBoxBorderColor: '#DBE3E8',
    // notes
    noteBkgColor: '#FCEFCC',
    noteBorderColor: '#E8A317',
    noteTextColor: '#0E2530'
  };
  let mermaidSeq = 0;
  function renderMermaid() {
    if (typeof mermaid === 'undefined') return;
    const blocks = output.querySelectorAll('pre > code.language-mermaid');
    if (!blocks.length) return;

    try {
      // Brand the diagrams with the qurix palette + font (mermaid "base" theme +
      // themeVariables). Kept light on purpose — diagrams sit on a light figure
      // surface (see app.css) so they stay legible in dark mode and print cleanly.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: MERMAID_THEME,
        flowchart: { curve: 'basis', useMaxWidth: true },
        themeCSS: '.edgeLabel { font-size: 0.85em; }'
      });
    } catch (_e) { /* ignore re-init issues */ }

    const nodes = [];
    blocks.forEach((codeEl) => {
      const pre = codeEl.closest('pre');
      if (!pre) return;
      const def = codeEl.textContent || '';
      const el = document.createElement('div');
      el.className = 'mermaid';
      el.id = 'mmd-' + (++mermaidSeq);
      el.textContent = def;
      pre.replaceWith(el);
      nodes.push(el);
    });
    if (!nodes.length) return;

    // mermaid.run (v10) renders the given nodes; fall back to legacy init.
    try {
      const p = mermaid.run({ nodes });
      if (p && typeof p.catch === 'function') {
        p.catch((err) => console.error('Mermaid render error:', err));
      }
    } catch (_e) {
      try { mermaid.init(undefined, nodes); }
      catch (err) { console.error('Mermaid render error:', err); }
    }
  }

  // ----- YAML front matter (the leading --- … --- block) -----
  const FM_LABELS = {
    title: 'Title', project: 'Project', date: 'Date', status: 'Status',
    authors: 'Authors', author: 'Author', audience: 'Audience',
    version: 'Version', tags: 'Tags', subtitle: 'Subtitle'
  };

  function extractFrontMatter(text) {
    // Front matter must be the very first thing in the file (optional BOM).
    const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!m) return { data: null, body: text };
    const data = [];
    m[1].split(/\r?\n/).forEach((line) => {
      if (!line.trim() || /^\s*#/.test(line)) return;
      const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (!kv) return;
      let val = kv[2].trim();
      if (val.length >= 2 &&
          ((val[0] === '"' && val.slice(-1) === '"') ||
           (val[0] === "'" && val.slice(-1) === "'"))) {
        const q = val[0];
        val = val.slice(1, -1).replace(new RegExp('\\\\' + q, 'g'), q);
      }
      data.push({ key: kv[1], value: val });
    });
    return { data: data.length ? data : null, body: text.slice(m[0].length) };
  }

  function frontMatterHtml(data) {
    const title = data.find((d) => d.key.toLowerCase() === 'title');
    const meta = data.filter((d) => d.key.toLowerCase() !== 'title');
    let h = '<header class="md-fm">';
    if (title) h += '<div class="md-fm-title">' + escapeHtml(title.value) + '</div>';
    if (meta.length) {
      h += '<dl class="md-fm-meta">';
      meta.forEach((d) => {
        const label = FM_LABELS[d.key.toLowerCase()] ||
          (d.key.charAt(0).toUpperCase() + d.key.slice(1));
        const value = d.key.toLowerCase() === 'status'
          ? '<span class="md-fm-badge">' + escapeHtml(d.value) + '</span>'
          : escapeHtml(d.value);
        h += '<div><dt>' + escapeHtml(label) + '</dt><dd>' + value + '</dd></div>';
      });
      h += '</dl>';
    }
    return h + '</header>';
  }

  // ----- Render markdown -----
  function renderMarkdown(text, filename) {
    try {
      const fm = extractFrontMatter(text);
      const titleEntry = fm.data && fm.data.find((d) => d.key.toLowerCase() === 'title');
      currentFmTitle = titleEntry ? titleEntry.value : null;

      const html = marked.parse(fm.body);
      output.innerHTML = (fm.data ? frontMatterHtml(fm.data) : '') + html;

      // Make external links open in new tabs
      output.querySelectorAll('a[href^="http"]').forEach(a => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      });

      renderMermaid();
      setupTableExports();
      buildOutline();

      output.removeAttribute('hidden');
      dropzone.setAttribute('hidden', '');
      pdfBtn.disabled = false;
      clearBtn.removeAttribute('hidden');

      currentText = text;
      currentFilename = filename || 'document';
      filenameEl.textContent = filename || '';

      // Scroll to top of rendered content
      output.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      showToast('Failed to render Markdown: ' + err.message, 'error');
    }
  }

  // ----- File loading -----
  function loadFile(file) {
    if (!file) return;
    // Light type check — we accept by extension OR text mime type
    const name = (file.name || '').toLowerCase();
    const looksLikeMarkdown =
      /\.(md|markdown|mdown|mkd|txt)$/.test(name) ||
      /^text\//.test(file.type || '') ||
      file.type === 'text/markdown' ||
      file.type === '';

    if (!looksLikeMarkdown) {
      showToast('That doesn’t look like a text or Markdown file.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      renderMarkdown(String(e.target.result || ''), file.name);
    };
    reader.onerror = function () {
      showToast('Could not read the file.', 'error');
    };
    reader.readAsText(file);
  }

  // ----- Open file -----
  openBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadFile(file);
    // Reset so picking the same file again still triggers change
    fileInput.value = '';
  });

  // ----- Drag & drop (whole window) -----
  let dragDepth = 0;
  function isFileDrag(e) {
    return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  }
  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    dropzone.classList.add('is-hover');
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-hover');
  });
  window.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-hover');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // ----- Sample -----
  const SAMPLE_MD = [
    '# Markdown Display',
    '',
    'A clean viewer for your `.md` files, in the qurix style. ',
    'Drop a file anywhere on the page, or use the **Open Markdown File** button.',
    '',
    '## Features',
    '',
    '- GitHub Flavored Markdown (GFM)',
    '- Syntax-highlighted code blocks',
    '- Tables, task lists, blockquotes',
    '- **Mermaid** diagrams',
    '- One-click **PDF export** of the rendered document',
    '',
    '> "The best documentation is the one you actually read." — anonymous engineer',
    '',
    '## Diagram',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[Open .md file] --> B{mermaid block?}',
    '  B -->|yes| C[Render diagram]',
    '  B -->|no| D[Render markdown]',
    '  C --> E[Export as PDF]',
    '  D --> E',
    '```',
    '',
    '## Code',
    '',
    '```python',
    'def fibonacci(n: int) -> int:',
    '    """Return the n-th Fibonacci number."""',
    '    a, b = 0, 1',
    '    for _ in range(n):',
    '        a, b = b, a + b',
    '    return a',
    '',
    'print([fibonacci(i) for i in range(10)])',
    '```',
    '',
    '## A small table',
    '',
    '| Component       | Purpose                          | Status |',
    '|-----------------|----------------------------------|--------|',
    '| `marked`        | Markdown → HTML parsing          | ✅     |',
    '| `highlight.js`  | Syntax highlighting              | ✅     |',
    '| `mermaid`       | Diagrams                         | ✅     |',
    '| Browser print   | Document → PDF (vector)          | ✅     |',
    '',
    '## Task list',
    '',
    '- [x] Render Markdown',
    '- [x] Draw diagrams',
    '- [x] Export to PDF',
    '- [ ] Make coffee',
    '',
    '---',
    '',
    'Built with the qurix design system.'
  ].join('\n');

  sampleBtn.addEventListener('click', () => {
    renderMarkdown(SAMPLE_MD, 'sample.md');
  });

  // ----- Clear -----
  clearBtn.addEventListener('click', () => {
    output.innerHTML = '';
    output.setAttribute('hidden', '');
    clearOutline();
    dropzone.removeAttribute('hidden');
    pdfBtn.disabled = true;
    clearBtn.setAttribute('hidden', '');
    filenameEl.textContent = '';
    currentFilename = null;
    currentText = null;
    currentFmTitle = null;
  });

  // ----- Export as PDF (native browser print → "Save as PDF") -----
  // A print stylesheet (app.css @media print) shows only the rendered document.
  // This renders Mermaid SVGs as crisp vectors, keeps text selectable/searchable,
  // produces real page breaks and tiny files — and avoids the html2canvas
  // failure modes that left captured PDFs blank.
  function sanitizeName(s) {
    return String(s == null ? '' : s)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'document';
  }
  function pdfBaseName() {
    return sanitizeName(currentFmTitle || currentFilename || 'document');
  }

  // Default the saved-PDF filename to the document's name (browsers use the
  // page title as the print filename).
  let savedDocTitle = null;
  window.addEventListener('beforeprint', () => {
    if (currentText != null) { savedDocTitle = document.title; document.title = pdfBaseName(); }
  });
  window.addEventListener('afterprint', () => {
    if (savedDocTitle != null) { document.title = savedDocTitle; savedDocTitle = null; }
  });

  pdfBtn.addEventListener('click', () => {
    if (output.hasAttribute('hidden') || !output.innerHTML.trim()) {
      showToast('Nothing to export yet.', 'error');
      return;
    }
    window.print();
  });

  // ----- Document outline (left sidebar) -----
  // Built from the rendered content: headings (indented by level) plus tables
  // and diagrams. Clicking jumps to the element; a scroll-spy marks the section
  // currently in view.
  const HEADER_OFFSET = 80;   // sticky shell header height (px) for scroll targets
  let outlineEntries = [];

  function scrollToTarget(el) {
    const y = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function buildOutline() {
    const nav = document.getElementById('md-outline-nav');
    const aside = document.getElementById('md-outline');
    if (!nav || !aside) return;
    nav.innerHTML = '';
    outlineEntries = [];

    const els = output.querySelectorAll('h1, h2, h3, h4, h5, h6, table, .mermaid');
    let lastLevel = 1, tableNo = 0, figNo = 0, headNo = 0;

    els.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      let level, type, text;
      if (/^h[1-6]$/.test(tag)) {
        type = 'heading'; level = +tag[1]; text = (el.textContent || '').trim();
        lastLevel = level;
        if (!el.id) el.id = 'md-h-' + (++headNo);
      } else if (tag === 'table') {
        type = 'table'; level = Math.min(lastLevel + 1, 6);
        text = 'Table ' + (++tableNo);
        if (!el.id) el.id = 'md-tbl-' + tableNo;
      } else {
        type = 'figure'; level = Math.min(lastLevel + 1, 6);
        text = 'Diagram ' + (++figNo);
        if (!el.id) el.id = 'md-fig-' + figNo;
      }
      if (!text) return;

      const a = document.createElement('a');
      a.className = 'md-ol-link md-ol-l' + level + ' md-ol-' + type;
      a.href = '#' + el.id;
      const icon = type === 'table' ? '▦' : type === 'figure' ? '◇' : '';
      a.innerHTML = (icon ? '<span class="md-ol-icon" aria-hidden="true">' + icon + '</span>' : '') +
                    '<span class="md-ol-text"></span>';
      a.querySelector('.md-ol-text').textContent = text;
      a.title = text;
      a.addEventListener('click', (e) => { e.preventDefault(); scrollToTarget(el); });
      nav.appendChild(a);
      outlineEntries.push({ el: el, link: a });
    });

    if (outlineEntries.length) aside.removeAttribute('hidden');
    else aside.setAttribute('hidden', '');
    updateOutlineActive();
  }

  function clearOutline() {
    const nav = document.getElementById('md-outline-nav');
    const aside = document.getElementById('md-outline');
    if (nav) nav.innerHTML = '';
    if (aside) aside.setAttribute('hidden', '');
    outlineEntries = [];
  }

  function updateOutlineActive() {
    if (!outlineEntries.length) return;
    let activeIdx = 0;
    for (let i = 0; i < outlineEntries.length; i++) {
      if (outlineEntries[i].el.getBoundingClientRect().top - (HEADER_OFFSET + 20) <= 0) activeIdx = i;
      else break;
    }
    outlineEntries.forEach((en, i) => en.link.classList.toggle('is-active', i === activeIdx));
  }

  let spyScheduled = false;
  window.addEventListener('scroll', () => {
    if (spyScheduled) return;
    spyScheduled = true;
    requestAnimationFrame(() => { spyScheduled = false; updateOutlineActive(); });
  }, { passive: true });

  // ----- Table export (CSV / Parquet) -----
  // A small toolbar above every rendered table offers CSV (pure JS) and Parquet
  // (via DuckDB-WASM, lazy-loaded from CDN only on first use).
  let tblSeq = 0;

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function tableToMatrix(table) {
    const matrix = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [];
      tr.querySelectorAll('th, td').forEach((c) => cells.push((c.textContent || '').trim()));
      if (cells.length) matrix.push(cells);
    });
    return matrix;
  }

  function toCSV(matrix) {
    const cell = (v) => {
      v = String(v == null ? '' : v);
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    return matrix.map((row) => row.map(cell).join(',')).join('\r\n');
  }

  function tableBaseName(idx) {
    return sanitizeName(currentFmTitle || currentFilename || 'document') + '-table-' + idx;
  }

  function exportTableCsv(table, idx) {
    const matrix = tableToMatrix(table);
    if (!matrix.length) { showToast('This table is empty.', 'error'); return; }
    // UTF-8 BOM so Excel opens special characters correctly.
    const blob = new Blob(['﻿' + toCSV(matrix)], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, tableBaseName(idx) + '.csv');
    showToast('CSV saved as ' + tableBaseName(idx) + '.csv', 'success');
  }

  // DuckDB-WASM (lazy) — same engine the other qurix data apps use.
  let duckdb = null, db = null, conn = null, dbInitPromise = null;
  async function initDuckDB() {
    if (dbInitPromise) return dbInitPromise;
    dbInitPromise = (async () => {
      duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.30.0/+esm');
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );
      const worker = new Worker(workerUrl);
      db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      conn = await db.connect();
      try {
        await conn.query('SET autoinstall_known_extensions=1; SET autoload_known_extensions=1;');
      } catch (e) { console.warn('Could not enable extension autoload', e); }
    })();
    return dbInitPromise;
  }

  async function exportTableParquet(table, idx, btn) {
    const matrix = tableToMatrix(table);
    if (!matrix.length) { showToast('This table is empty.', 'error'); return; }

    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Parquet…';
    const firstTime = !dbInitPromise;
    if (firstTime) showToast('Loading Parquet engine (first time)…');

    const csv = toCSV(matrix);                 // no BOM — DuckDB reads it raw
    const n = ++tblSeq;
    const inName = 'mdtbl_' + n + '.csv';
    const outName = 'mdtbl_' + n + '.parquet';
    try {
      await initDuckDB();
      await db.registerFileText(inName, csv);
      await conn.query(
        `CREATE OR REPLACE TABLE _mdtbl AS ` +
        `SELECT * FROM read_csv_auto('${inName}', header=true, all_varchar=false)`
      );
      await conn.query(`COPY _mdtbl TO '${outName}' (FORMAT PARQUET, COMPRESSION 'zstd')`);
      const buf = await db.copyFileToBuffer(outName);
      downloadBlob(new Blob([buf], { type: 'application/octet-stream' }),
        tableBaseName(idx) + '.parquet');
      showToast('Parquet saved as ' + tableBaseName(idx) + '.parquet', 'success');
    } catch (err) {
      console.error(err);
      showToast('Parquet export failed: ' + (err && err.message || err), 'error');
    } finally {
      try { await conn.query('DROP TABLE IF EXISTS _mdtbl'); } catch (_) {}
      try { await db.dropFile(inName); } catch (_) {}
      try { await db.dropFile(outName); } catch (_) {}
      btn.disabled = false; btn.textContent = original;
    }
  }

  function setupTableExports() {
    const tables = output.querySelectorAll('table');
    tables.forEach((table, i) => {
      const idx = i + 1;
      const bar = document.createElement('div');
      bar.className = 'md-tbl-bar';
      bar.setAttribute('contenteditable', 'false');

      const label = document.createElement('span');
      label.className = 'md-tbl-label';
      label.textContent = tables.length > 1 ? 'Table ' + idx : 'Export table';
      bar.appendChild(label);

      const csvBtn = document.createElement('button');
      csvBtn.type = 'button'; csvBtn.className = 'md-tbl-btn';
      csvBtn.textContent = 'CSV';
      csvBtn.addEventListener('click', () => exportTableCsv(table, idx));

      const pqBtn = document.createElement('button');
      pqBtn.type = 'button'; pqBtn.className = 'md-tbl-btn';
      pqBtn.textContent = 'Parquet';
      pqBtn.addEventListener('click', () => exportTableParquet(table, idx, pqBtn));

      bar.appendChild(csvBtn);
      bar.appendChild(pqBtn);
      table.parentNode.insertBefore(bar, table);
    });
  }

  // ----- qurix snapshot hooks -----
  // "Export with data" captures the raw markdown + filename; reopening the
  // snapshot re-renders the document (incl. diagrams). "Export blank" restores
  // the pristine empty state automatically (handled by the shell).
  window.qurixApp = window.qurixApp || {};
  window.qurixApp.serializeState = function () {
    return currentText != null ? { text: currentText, filename: currentFilename } : {};
  };
  window.qurixApp.hydrateState = function (s) {
    if (s && typeof s.text === 'string') {
      renderMarkdown(s.text, s.filename || 'document');
    }
  };
})();
