// ============================================================================
// Auslands-Pauschbeträge für Reisekosten (Verpflegung & Übernachtung).
//
// Datenmodul — via app.config.json "inlineScripts" verbatim eingebunden. Setzt
// window.qrx.reisekostenRates. app.js liest daraus die Länderliste und die
// vollen Tagessätze; der An-/Abreisesatz (bzw. > 8 h) wird gemäß § 9 Abs. 4a
// EStG als 80 % des vollen Auslands-Tagegeldes berechnet, die Mahlzeiten-
// kürzungen (20/40/40 %) beziehen sich auf denselben vollen Tagessatz.
//
// WICHTIG: Dies ist ein kuratierter Auszug der jährlich vom BMF veröffentlichten
// Auslandsreisekosten-Tabelle für gängige Reiseziele. Die Beträge sind Jahres-
// werte und können sich ändern — im Zweifel gegen das aktuelle BMF-Schreiben
// prüfen. In der App ist jeder Satz pro Reise frei überschreibbar, und ein
// beliebiges Land/eine Stadt kann mit eigenen Sätzen erfasst werden.
//
// Werte in EUR: full = voller Tagessatz (24 h), night = Übernachtungspauschale.
// ============================================================================
(function () {
  'use strict';
  const qrx = (window.qrx = window.qrx || {});

  qrx.reisekostenRates = {
    year: '2025',
    source: 'BMF-Schreiben zu den Auslandsreisekosten (Auszug, kuratiert) — bitte gegen das aktuelle Schreiben prüfen.',
    // Voller Tagessatz (24 h) / Übernachtungspauschale in EUR.
    countries: [
      { code: 'AT',     name: 'Österreich',                         name_en: 'Austria',                    full: 40, night: 108 },
      { code: 'BE',     name: 'Belgien',                            name_en: 'Belgium',                    full: 42, night: 141 },
      { code: 'BG',     name: 'Bulgarien',                          name_en: 'Bulgaria',                   full: 22, night: 115 },
      { code: 'HR',     name: 'Kroatien',                           name_en: 'Croatia',                    full: 35, night: 120 },
      { code: 'CZ',     name: 'Tschechien',                         name_en: 'Czech Republic',             full: 33, night: 97 },
      { code: 'DK',     name: 'Dänemark',                           name_en: 'Denmark',                    full: 75, night: 183 },
      { code: 'EE',     name: 'Estland',                            name_en: 'Estonia',                    full: 29, night: 85 },
      { code: 'FI',     name: 'Finnland',                           name_en: 'Finland',                    full: 50, night: 171 },
      { code: 'FR',     name: 'Frankreich',                         name_en: 'France',                     full: 44, night: 115 },
      { code: 'FR-PAR', name: 'Frankreich – Paris',                 name_en: 'France – Paris',             full: 58, night: 159 },
      { code: 'GR',     name: 'Griechenland',                       name_en: 'Greece',                     full: 40, night: 132 },
      { code: 'HU',     name: 'Ungarn',                             name_en: 'Hungary',                    full: 32, night: 90 },
      { code: 'IE',     name: 'Irland',                             name_en: 'Ireland',                    full: 58, night: 165 },
      { code: 'IT',     name: 'Italien',                            name_en: 'Italy',                      full: 40, night: 155 },
      { code: 'IT-ROM', name: 'Italien – Rom',                      name_en: 'Italy – Rome',               full: 40, night: 160 },
      { code: 'IT-MIL', name: 'Italien – Mailand',                  name_en: 'Italy – Milan',              full: 45, night: 158 },
      { code: 'LU',     name: 'Luxemburg',                          name_en: 'Luxembourg',                 full: 63, night: 134 },
      { code: 'NL',     name: 'Niederlande',                        name_en: 'Netherlands',                full: 47, night: 129 },
      { code: 'NO',     name: 'Norwegen',                           name_en: 'Norway',                     full: 80, night: 182 },
      { code: 'PL',     name: 'Polen',                              name_en: 'Poland',                     full: 33, night: 117 },
      { code: 'PL-WAW', name: 'Polen – Warschau',                   name_en: 'Poland – Warsaw',            full: 30, night: 143 },
      { code: 'PT',     name: 'Portugal',                           name_en: 'Portugal',                   full: 36, night: 102 },
      { code: 'RO',     name: 'Rumänien',                           name_en: 'Romania',                    full: 27, night: 92 },
      { code: 'ES',     name: 'Spanien',                            name_en: 'Spain',                      full: 34, night: 128 },
      { code: 'ES-MAD', name: 'Spanien – Madrid',                   name_en: 'Spain – Madrid',             full: 40, night: 136 },
      { code: 'ES-BCN', name: 'Spanien – Barcelona',                name_en: 'Spain – Barcelona',          full: 34, night: 144 },
      { code: 'SE',     name: 'Schweden',                           name_en: 'Sweden',                     full: 66, night: 140 },
      { code: 'CH',     name: 'Schweiz',                            name_en: 'Switzerland',                full: 64, night: 180 },
      { code: 'CH-GEN', name: 'Schweiz – Genf',                     name_en: 'Switzerland – Geneva',       full: 66, night: 186 },
      { code: 'SK',     name: 'Slowakei',                           name_en: 'Slovakia',                   full: 33, night: 100 },
      { code: 'SI',     name: 'Slowenien',                          name_en: 'Slovenia',                   full: 38, night: 143 },
      { code: 'GB',     name: 'Vereinigtes Königreich',             name_en: 'United Kingdom',             full: 45, night: 121 },
      { code: 'GB-LON', name: 'Vereinigtes Königreich – London',    name_en: 'United Kingdom – London',    full: 62, night: 224 },
      { code: 'TR',     name: 'Türkei',                             name_en: 'Turkey',                     full: 26, night: 95 },
      { code: 'TR-IST', name: 'Türkei – Istanbul',                  name_en: 'Turkey – Istanbul',          full: 30, night: 135 },
      { code: 'US',     name: 'USA',                                name_en: 'USA',                        full: 59, night: 234 },
      { code: 'US-NYC', name: 'USA – New York City',                name_en: 'USA – New York City',        full: 66, night: 308 },
      { code: 'US-WAS', name: 'USA – Washington, D.C.',             name_en: 'USA – Washington, D.C.',     full: 66, night: 311 },
      { code: 'US-SFO', name: 'USA – San Francisco',                name_en: 'USA – San Francisco',        full: 66, night: 327 },
      { code: 'US-LAX', name: 'USA – Los Angeles',                  name_en: 'USA – Los Angeles',          full: 64, night: 242 },
      { code: 'CA',     name: 'Kanada',                             name_en: 'Canada',                     full: 47, night: 178 },
      { code: 'MX',     name: 'Mexiko',                             name_en: 'Mexico',                     full: 41, night: 141 },
      { code: 'BR',     name: 'Brasilien',                          name_en: 'Brazil',                     full: 51, night: 171 },
      { code: 'CN',     name: 'China',                              name_en: 'China',                      full: 39, night: 116 },
      { code: 'CN-PEK', name: 'China – Peking',                     name_en: 'China – Beijing',            full: 34, night: 135 },
      { code: 'CN-SHA', name: 'China – Shanghai',                   name_en: 'China – Shanghai',           full: 45, night: 288 },
      { code: 'HK',     name: 'Hongkong',                           name_en: 'Hong Kong',                  full: 74, night: 207 },
      { code: 'JP',     name: 'Japan',                              name_en: 'Japan',                      full: 51, night: 156 },
      { code: 'JP-TYO', name: 'Japan – Tokio',                      name_en: 'Japan – Tokyo',              full: 66, night: 233 },
      { code: 'SG',     name: 'Singapur',                           name_en: 'Singapore',                  full: 54, night: 223 },
      { code: 'AE-DXB', name: 'VAE – Dubai',                        name_en: 'UAE – Dubai',                full: 65, night: 156 },
      { code: 'IN',     name: 'Indien',                             name_en: 'India',                      full: 33, night: 155 },
      { code: 'TH',     name: 'Thailand',                           name_en: 'Thailand',                   full: 40, night: 140 },
      { code: 'AU',     name: 'Australien',                         name_en: 'Australia',                  full: 60, night: 173 },
      { code: 'ZA',     name: 'Südafrika',                          name_en: 'South Africa',               full: 29, night: 119 },
    ],
  };
})();
