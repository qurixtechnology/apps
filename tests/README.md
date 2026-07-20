# Regressionstest-Suite

```bash
npm install          # einmalig (puppeteer-core)
npm test             # alles, ~90 s
npm run test:quick   # Build + Logik, ohne Browser-Klicks, ~3 s
npm run test:quack   # nur die DuckDB-Server-Integration
```

Getestet wird **`dist/`**, nicht `src/` — nur das gebaute Artefakt ist das, was
ausgeliefert wird. `npm test` baut vorher selbst.

## Aufbau

| Datei | Inhalt | Dauer |
|---|---|---|
| `suites/00-build.test.mjs` | Syntax aller App-Quellen, Build läuft, `dist/` vollständig, keine offenen Slots, duckdb-wasm-Version quack-tauglich und überall gleich | ~1 s |
| `suites/10-converter.test.mjs` | CSV/Parquet/NDJSON/JSON lesen, Export nach Parquet/NDJSON inhaltlich prüfen | ~25 s |
| `suites/20-cleaner.test.mjs` | Laden, Dedup, PII-Scan, Anonymisierung, Export | ~10 s |
| `suites/30-profiler.test.mjs` | Profiling, Spaltentypen, Mehrdateibetrieb, SQL-Editor | ~12 s |
| `suites/40-duckdb-server.test.mjs` | Reine Logik ohne UI: DDL-Schema-Parser, Token-Tresor, Pipeline-SQL, PII-Matcher | ~1 s |
| `suites/50-quack.test.mjs` | Import/Export gegen einen echten DuckDB-Server, alle drei Apps | ~30 s |

## Voraussetzungen

* **Chrome/Chromium.** Wird an den üblichen Orten gesucht; sonst `CHROME_PATH` setzen.
* **Für `50-quack`:** Python mit `duckdb` ≥ 1.5.3 (davor gibt es die quack-Extension nicht).
  Fehlt das, wird die Suite mit klarer Begründung **übersprungen** statt rot zu werden.
  Erzwingen lässt sich das mit `QRX_SKIP_QUACK=1`.
* Beim ersten Lauf lädt Chrome die duckdb-wasm-Bundles aus dem CDN; sie bleiben
  im Profil unter `tests/.cache/` und werden danach nicht mehr geholt.

Nützliche Umgebungsvariablen: `QRX_HEADED=1` (Browser sichtbar, zum Debuggen),
`QRX_PROFILE=<name>` (eigenes Chrome-Profil, für parallele Läufe),
`CHROME_PATH`, `QRX_SKIP_QUACK`.

## Test-Hooks in den Apps

`src/shared/qrx-test.js` liefert zwei Dinge:

* `qrxTest.state('busy'|'ready')` und `qrxTest.tick('<operation>')` schreiben
  `data-qrx-state` bzw. `data-qrx-ticks` an `<body>`. **Immer aktiv.** Damit
  wartet die Suite auf einen App-eigenen Zustand statt auf `sleep`.
* `qrxTest.expose(name, obj)` veröffentlicht Interna unter `window.__qrx` —
  **nur** wenn die Seite mit `?qrxtest` geöffnet wird. Normal geöffnete Apps
  legen nichts offen.

Bekannte Tick-Operationen: `preview`, `recompute`, `scan` (Cleaner), `preview`
(Converter), `profile` (Profiler).

## Regeln, die diese Suite stabil halten

1. **Kein `sleep`.** Immer `settle(page, op, action)` benutzen. Es wartet auf
   einen neuen Tick *dieser* Operation **und** darauf, dass nichts mehr
   rendert. Nur das eine oder das andere reicht nachweislich nicht: ein bereits
   laufender Render erfüllt den Zähler, und ein globales „ready" erfüllt jeder
   beliebige andere Vorgang.
2. **Eindeutige Selektoren.** `#previewGrid tbody tr`, nicht `table tbody tr` —
   die Review-Tabelle ist auch eine `table`.
3. **`textContent`, nicht `innerText`** — letzteres ist bei unsichtbaren
   Elementen leer.
4. **`page.assertNoErrors()`** am Ende jedes Tests: jeder `pageerror` und jedes
   `console.error` lässt den Test scheitern.
5. **Exporte inhaltlich prüfen**, nie per Byte-Vergleich: `readRows()` liest die
   Datei mit derselben Engine wieder ein. Ein Golden File müsste sonst bei jedem
   DuckDB-Update neu erzeugt werden.
6. **Anonymisierung über Eigenschaften prüfen** (Werte ersetzt, Format erhalten,
   gleiche Eingabe → gleiches Pseudonym, Nicht-PII-Spalten unverändert) statt
   über feste Erwartungswerte.
7. Bei Fehlschlag landen Screenshot, HTML-Dump und Konsolenlog in
   `tests/artifacts/`.

## Fixtures

`tests/fixtures/` enthält kleine, synthetische Dateien (~16 KB gesamt):
`tiny.{csv,ndjson,json,parquet}` (6 Zeilen, ein Duplikat, ein NULL, ein Komma im
Wert) und `pii.{csv,parquet}` (60 Zeilen mit Name, E-Mail, Telefon, IBAN, BIC,
PLZ, Geburtsdatum — plus ein Datumsfeld als Falle für den Telefon-Matcher).

Neu erzeugen: `npm run fixtures:make`. Das Parquet entsteht dabei über
DuckDB-WASM im Browser, damit es keine zweite Toolchain braucht.

## Neue Tests hinzufügen

Regressionen bekommen einen benannten Test, der die *Ursache* beschreibt, nicht
das Symptom — z. B. „Connect-Button öffnet keinen Dateidialog" statt „Button
funktioniert". Wo möglich in `40-*` als Logiktest (schnell und stabil), erst
sonst als E2E.
