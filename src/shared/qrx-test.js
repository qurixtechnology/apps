// ============================================================================
// Test hooks. Included via app.config.json "inlineScripts".
//
// Two things, both deliberately tiny:
//
// 1. qrxTest.state('busy'|'ready') writes data-qrx-state on <body>. Always on —
//    it costs nothing and lets the test suite wait for an app-owned state
//    instead of sleeping, which is the single biggest source of flaky E2E runs.
//
// 2. qrxTest.expose(name, obj) publishes internals under window.__qrx, but ONLY
//    when the page is opened with ?qrxtest. That keeps pure logic (pipeline SQL,
//    PII detection, heuristics) testable without clicking through the UI, while
//    a normally-opened app exposes nothing.
// ============================================================================
(function () {
  'use strict';
  const enabled = /(?:^|[?&])qrxtest(?:[=&]|$)/.test(location.search);
  window.qrxTest = {
    enabled,
    state(s) {
      try { document.body.dataset.qrxState = s; } catch (_) { /* pre-body call */ }
    },
    // Per-operation completion counters in data-qrx-ticks, e.g.
    // {"preview":3,"scan":1}. A test captures the counter for the operation it
    // triggers and waits for THAT one to advance. A single global "ready" flag
    // is not enough: any unrelated render would satisfy it and the test would
    // read a half-finished screen.
    tick(op) {
      try {
        const el = document.body;
        const m = JSON.parse(el.dataset.qrxTicks || '{}');
        m[op] = (m[op] || 0) + 1;
        el.dataset.qrxTicks = JSON.stringify(m);
      } catch (_) { /* pre-body call */ }
    },
    expose(name, obj) {
      if (!enabled) return;
      (window.__qrx = window.__qrx || {})[name] = obj;
    },
  };
})();
