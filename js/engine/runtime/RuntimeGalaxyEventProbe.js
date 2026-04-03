/**
 * RuntimeGalaxyEventProbe.js
 *
 * Console helper for temporary input-event probing on the galaxy canvas.
 */

'use strict';

(function () {
  const state = {
    documentRef: (typeof document !== 'undefined' ? document : null),
    windowRef: (typeof window !== 'undefined' ? window : null),
    consoleRef: (typeof console !== 'undefined' ? console : null),
  };

  function configureGalaxyEventProbeRuntime(opts = {}) {
    const {
      documentRef = (typeof document !== 'undefined' ? document : null),
      windowRef = (typeof window !== 'undefined' ? window : null),
      consoleRef = (typeof console !== 'undefined' ? console : null),
    } = opts;

    state.documentRef = documentRef || null;
    state.windowRef = windowRef || null;
    state.consoleRef = consoleRef || null;
  }

  function runGalaxyEventProbe(seconds, pushLine) {
    const sec = Math.max(2, Math.min(20, Number(seconds || 6)));
    const doc = state.documentRef;
    const win = state.windowRef;

    if (!doc) {
      if (typeof pushLine === 'function') pushLine('[galprobe] document nicht verfuegbar.');
      return false;
    }

    const canvas = doc.getElementById('starfield');
    const canvasCtor = win && win.HTMLCanvasElement ? win.HTMLCanvasElement : null;
    if (!canvasCtor || !(canvas instanceof canvasCtor)) {
      if (typeof pushLine === 'function') pushLine('[galprobe] canvas #starfield nicht gefunden.');
      return false;
    }

    const counters = {
      mousemove: 0,
      mousedown: 0,
      mouseup: 0,
      click: 0,
      dblclick: 0,
      wheel: 0,
      contextmenu: 0,
    };

    const opts = { capture: true, passive: false };
    const bump = (key) => (e) => {
      counters[key] += 1;
      if (key === 'wheel' || key === 'contextmenu') {
        void e;
      }
    };

    const handlers = {
      mousemove: bump('mousemove'),
      mousedown: bump('mousedown'),
      mouseup: bump('mouseup'),
      click: bump('click'),
      dblclick: bump('dblclick'),
      wheel: bump('wheel'),
      contextmenu: bump('contextmenu'),
    };

    Object.keys(handlers).forEach((type) => {
      canvas.addEventListener(type, handlers[type], opts);
    });

    if (typeof pushLine === 'function') {
      pushLine(`[galprobe] Starte Event-Probe fuer ${sec}s auf #starfield ...`);
    }

    setTimeout(() => {
      Object.keys(handlers).forEach((type) => {
        canvas.removeEventListener(type, handlers[type], opts);
      });
      if (typeof pushLine === 'function') {
        pushLine('[galprobe] Ergebnis: '
          + `move=${counters.mousemove}, down=${counters.mousedown}, up=${counters.mouseup}, `
          + `click=${counters.click}, dbl=${counters.dblclick}, wheel=${counters.wheel}, ctx=${counters.contextmenu}`);
      }
      try {
        if (state.consoleRef && typeof state.consoleRef.log === 'function') {
          state.consoleRef.log('[GQ][galprobe]', counters);
        }
      } catch (_) {}
    }, Math.round(sec * 1000));

    return true;
  }

  const api = {
    configureGalaxyEventProbeRuntime,
    runGalaxyEventProbe,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyEventProbe = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
