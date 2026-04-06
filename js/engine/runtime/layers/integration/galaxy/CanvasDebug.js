/**
 * CanvasDebug.js
 *
 * DOM/canvas layering diagnostics for galaxy renderer troubleshooting.
 */

'use strict';

(function () {
  const state = {
    windowRef: (typeof window !== 'undefined' ? window : null),
    documentRef: (typeof document !== 'undefined' ? document : null),
  };

  function configureGalaxyCanvasDebugRuntime(opts = {}) {
    const {
      windowRef = (typeof window !== 'undefined' ? window : null),
      documentRef = (typeof document !== 'undefined' ? document : null),
    } = opts;

    state.windowRef = windowRef || null;
    state.documentRef = documentRef || null;
  }

  function inspectGalaxyCanvasLayering() {
    const win = state.windowRef;
    const doc = state.documentRef;
    if (!win || !doc) {
      return {
        ok: false,
        bodyClass: '',
        canvas: null,
        stage: null,
        desktop: null,
        windows: [],
        topElementsAtCanvas: [],
      };
    }

    const stage = doc.querySelector('.galaxy-3d-stage') || doc.getElementById('galaxy-stage');
    const canvas = doc.getElementById('starfield');
    const desktop = doc.body;
    const report = {
      ok: !!canvas,
      bodyClass: String(doc.body?.className || ''),
      canvas: null,
      stage: null,
      desktop: null,
      windows: [],
      topElementsAtCanvas: [],
    };

    const styleOf = (el) => {
      if (!el) return null;
      const cs = win.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id: String(el.id || ''),
        className: String(el.className || ''),
        display: String(cs.display || ''),
        visibility: String(cs.visibility || ''),
        opacity: Number(cs.opacity || 0),
        pointerEvents: String(cs.pointerEvents || ''),
        position: String(cs.position || ''),
        zIndex: String(cs.zIndex || ''),
        width: Math.round(Number(r.width || 0)),
        height: Math.round(Number(r.height || 0)),
        top: Math.round(Number(r.top || 0)),
        left: Math.round(Number(r.left || 0)),
      };
    };

    report.canvas = styleOf(canvas);
    report.stage = styleOf(stage);
    report.desktop = styleOf(desktop);

    doc.querySelectorAll('.wm-window').forEach((el) => {
      const item = styleOf(el);
      if (item) report.windows.push(item);
    });

    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const points = [
        [Math.round(rect.left + rect.width * 0.5), Math.round(rect.top + rect.height * 0.5)],
        [Math.round(rect.left + rect.width * 0.2), Math.round(rect.top + rect.height * 0.25)],
        [Math.round(rect.left + rect.width * 0.8), Math.round(rect.top + rect.height * 0.75)],
      ];
      points.forEach(([x, y]) => {
        const top = doc.elementFromPoint(x, y);
        report.topElementsAtCanvas.push({
          x,
          y,
          topId: String(top?.id || ''),
          topClass: String(top?.className || ''),
          topTag: String(top?.tagName || ''),
        });
      });
    }

    return report;
  }

  function attachGlobalGalaxyCanvasDebug() {
    const win = state.windowRef;
    if (!win) return;
    win.GQGalaxyCanvasDebug = {
      inspect: inspectGalaxyCanvasLayering,
    };
  }

  function runGalaxyCanvasDiag(pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    const diag = inspectGalaxyCanvasLayering();
    logLine(`[diag] body=${diag.bodyClass || '(none)'}`);
    logLine(`[diag] stage z=${diag.stage?.zIndex || 'n/a'} display=${diag.stage?.display || 'n/a'} vis=${diag.stage?.visibility || 'n/a'} size=${diag.stage?.width || 0}x${diag.stage?.height || 0}`);
    logLine(`[diag] canvas z=${diag.canvas?.zIndex || 'n/a'} display=${diag.canvas?.display || 'n/a'} vis=${diag.canvas?.visibility || 'n/a'} op=${diag.canvas?.opacity ?? 'n/a'} size=${diag.canvas?.width || 0}x${diag.canvas?.height || 0}`);
    logLine(`[diag] desktop z=${diag.desktop?.zIndex || 'n/a'} display=${diag.desktop?.display || 'n/a'} vis=${diag.desktop?.visibility || 'n/a'} size=${diag.desktop?.width || 0}x${diag.desktop?.height || 0}`);
    const topInfo = (diag.topElementsAtCanvas || []).map((p) => `${p.x},${p.y}->${p.topTag}${p.topId ? '#' + p.topId : ''}`).join(' | ');
    logLine(`[diag] elementFromPoint: ${topInfo || 'n/a'}`);
    const visibleWindows = (diag.windows || []).filter((w) => w.display !== 'none' && w.visibility !== 'hidden' && (w.width > 0 && w.height > 0));
    logLine(`[diag] wm windows visible=${visibleWindows.length}`);
    visibleWindows.slice(0, 6).forEach((w) => {
      logLine(`[diag] win ${w.id || '(no-id)'} z=${w.zIndex} pos=${w.left},${w.top} size=${w.width}x${w.height}`);
    });
    try {
      if (state.windowRef && state.windowRef.console && typeof state.windowRef.console.table === 'function') {
        state.windowRef.console.table(diag.windows || []);
      }
    } catch (_) {}
    try {
      if (state.windowRef && state.windowRef.console && typeof state.windowRef.console.log === 'function') {
        state.windowRef.console.log('[GQ][galdiag]', diag);
      }
    } catch (_) {}
    return diag;
  }

  const api = {
    configureGalaxyCanvasDebugRuntime,
    inspectGalaxyCanvasLayering,
    attachGlobalGalaxyCanvasDebug,
    runGalaxyCanvasDiag,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyCanvasDebug = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
