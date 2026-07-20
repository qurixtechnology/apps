// ============================================================================
// Shared DuckDB-server (quack) bridge — used by every qurix app that talks to
// a running DuckDB server. Included via app.config.json "inlineScripts":
// "../../shared/duckdb-server.js", so it gets its own top-level scope and
// publishes exactly one global.
//
// It deliberately owns only the parts that must NOT drift between apps: the
// token vault and the attach/list SQL. Each app keeps its own UI wiring and its
// own "what to do once a table is picked" logic.
//
// quack needs a DuckDB engine >= 1.5.3 — i.e. duckdb-wasm 1.33.1-dev57.0 or
// newer. Older builds silently load an unrelated namesake extension.
// ============================================================================
(function () {
  'use strict';

  // Shared across all qurix apps, so one saved token covers all of them.
  const VAULT_KEY = 'qrx_duckdb_conn';

  // Opt-in token storage. The token is encrypted with AES-GCM; the key lives in
  // IndexedDB as a NON-EXTRACTABLE CryptoKey, so it can never be read back out
  // and the stored value is a blob rather than plaintext in the browser profile.
  // This guards against profile dumps, backups and browser sync — NOT against
  // code running on the same origin, which can simply call decrypt().
  const vault = (() => {
    let keyPromise = null;
    function openIdb() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('qrx_secrets', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('keys')) r.result.createObjectStore('keys'); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    function idbTx(db, mode, fn) {
      return new Promise((res, rej) => {
        const tx = db.transaction('keys', mode);
        const rq = fn(tx.objectStore('keys'));
        tx.onerror = () => rej(tx.error);
        tx.oncomplete = () => res(rq && rq.result);
      });
    }
    async function getKey() {
      if (!keyPromise) keyPromise = (async () => {
        const db = await openIdb();
        const found = await idbTx(db, 'readonly', s => s.get(VAULT_KEY));
        if (found) return found;
        const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await idbTx(db, 'readwrite', s => s.put(k, VAULT_KEY));
        return k;
      })().catch(e => { keyPromise = null; throw e; });
      return keyPromise;
    }
    const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    function readAll() {
      try { const o = JSON.parse(localStorage.getItem(VAULT_KEY) || '{}'); return (o && o.entries) ? o : { entries: {} }; }
      catch (_) { return { entries: {} }; }
    }
    function writeAll(o) { try { localStorage.setItem(VAULT_KEY, JSON.stringify(o)); } catch (_) {} }
    return {
      available() { try { return !!(window.localStorage && window.indexedDB && crypto.subtle); } catch (_) { return false; } },
      has(uri) { return !!readAll().entries[uri]; },
      lastUri() { return readAll().last || null; },
      noteUri(uri) { const all = readAll(); all.last = uri; writeAll(all); },
      async get(uri) {
        const e = readAll().entries[uri];
        if (!e) return null;
        try {
          const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, await getKey(), unb64(e.ct));
          return new TextDecoder().decode(pt);
        } catch (_) { this.forget(uri); return null; }   // key gone / storage cleared
      },
      async put(uri, token) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), new TextEncoder().encode(token));
        const all = readAll();
        all.entries[uri] = { iv: b64(iv), ct: b64(ct) };
        all.last = uri;
        writeAll(all);
      },
      forget(uri) {
        const all = readAll();
        if (uri) delete all.entries[uri]; else all.entries = {};
        writeAll(all);
      },
    };
  })();

  const esc = s => String(s).replace(/'/g, "''");
  const ident = s => '"' + String(s).replace(/"/g, '""') + '"';

  // quack reports a bad token as a generic error ("Invalid Input Error:
  // Authentication failed") — match loosely so a rotated token gets dropped
  // instead of failing forever.
  function isAuthError(e) {
    return /token|auth|unauthor|forbidden|401|403/i.test((e && e.message) || String(e));
  }

  // quack only addresses the server's `main` schema.
  function remoteRef(input) {
    const parts = String(input).includes('.') ? String(input).split('.') : ['main', input];
    return 'remote.' + parts.map(p => ident(p.trim())).join('.');
  }

  async function attach(conn, uri, token) {
    await conn.query('INSTALL quack; LOAD quack;');
    try { await conn.query('DETACH remote'); } catch (_) {}
    await conn.query(`CREATE OR REPLACE SECRET __quack (TYPE quack, TOKEN '${esc(token)}')`);
    await conn.query(`ATTACH '${esc(uri)}' AS remote`);
  }

  // The DDL in sqlite_master.sql carries the schema, which is the only way to
  // tell a reachable table from an unreachable one before querying it:
  //   CREATE TABLE hello(...)        -> main        (reachable)
  //   CREATE TABLE demo.orders(...)  -> demo        (listed, but NOT reachable)
  // The reference may be quoted and contain dots or spaces, e.g.
  // CREATE TABLE "my schema"."tbl"(...) — so parse it part by part.
  const PART = '"(?:[^"]|"")*"|[^\\s.(]+';
  const DDL_RE = new RegExp(
    'CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMP\\w*\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?'
    + `((?:${PART})(?:\\s*\\.\\s*(?:${PART}))*)`, 'i');
  function schemaFromDdl(sql) {
    const m = DDL_RE.exec(sql || '');
    if (!m) return 'main';
    const parts = (m[1].match(new RegExp(PART, 'g')) || [])
      .map(s => s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s);
    return parts.length >= 2 ? parts[parts.length - 2] : 'main';
  }

  // Remote tables show up in neither duckdb_tables() nor information_schema —
  // sqlite_master is the one listing quack exposes. Returns
  // [{name, schema, sql, reachable}]; quack strips the schema when forwarding a
  // query, so only the server's `main` schema can actually be read.
  async function listTables(conn) {
    const rows = (await conn.query("SELECT name, sql FROM remote.sqlite_master WHERE type='table' ORDER BY name")).toArray();
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const name = String(r.name);
      if (seen.has(name)) continue;
      seen.add(name);
      const sql = r.sql == null ? '' : String(r.sql);
      const schema = schemaFromDdl(sql);
      out.push({ name, schema, sql, reachable: schema === 'main' });
    }
    return out;
  }

  window.qrxDuckServer = { vault, attach, listTables, isAuthError, remoteRef, ident, esc };
})();
