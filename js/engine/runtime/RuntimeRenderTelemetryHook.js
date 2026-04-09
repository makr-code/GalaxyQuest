/**
 * RuntimeRenderTelemetryHook.js
 *
 * Installs the global render telemetry event listener and fallback warning toast.
 */

'use strict';

(function () {
  function formatBackendLabel(rawBackend) {
    const value = String(rawBackend || '').toLowerCase();
    if (value === 'webgpu') return 'webgpu';
    if (value === 'three-webgl' || value === 'engine-webgl' || value === 'threejs' || value === 'webgl2') {
      return 'webgl-compat';
    }
    if (value === 'webgl1') return 'webgl1-compat';
    return String(rawBackend || 'unknown');
  }

  const state = {
    hookInstalled: false,
    lastToastMs: 0,
    expectedFallbackReasons: new Set([
      'interactive-galaxy-uses-three-path',
    ]),
    showToast: null,
    windowRef: (typeof window !== 'undefined' ? window : null),
    consoleRef: (typeof console !== 'undefined' ? console : null),
  };

  function configureRenderTelemetryRuntime(opts = {}) {
    const {
      showToast = null,
      windowRef = (typeof window !== 'undefined' ? window : null),
      consoleRef = (typeof console !== 'undefined' ? console : null),
      expectedFallbackReasons = null,
    } = opts;

    state.showToast = typeof showToast === 'function' ? showToast : null;
    state.windowRef = windowRef || null;
    state.consoleRef = consoleRef || null;
    if (Array.isArray(expectedFallbackReasons) && expectedFallbackReasons.length) {
      state.expectedFallbackReasons = new Set(expectedFallbackReasons.map((value) => String(value || '')));
    }
  }

  function installRenderTelemetryHook() {
    const win = state.windowRef;
    if (state.hookInstalled || !win || typeof win.addEventListener !== 'function') {
      return;
    }

    state.hookInstalled = true;
    win.addEventListener('gq:render-telemetry', (ev) => {
      const detail = ev?.detail || {};
      const type = String(detail.type || '').toLowerCase();
      if (type === 'backend-active') {
        const backend = String(detail.backend || 'unknown');
        win.__GQ_ACTIVE_RENDERER_BACKEND = backend;
        if (state.consoleRef && typeof state.consoleRef.info === 'function') {
          state.consoleRef.info('[render-telemetry] backend-active:', formatBackendLabel(backend), detail);
        }
        return;
      }

      if (type === 'fallback') {
        const from = String(detail.from || 'unknown');
        const to = String(detail.to || 'unknown');
        const reason = String(detail.reason || 'n/a');
        const isExpected = state.expectedFallbackReasons.has(reason);

        if (isExpected) {
          if (state.consoleRef && typeof state.consoleRef.info === 'function') {
            state.consoleRef.info('[render-telemetry] fallback(expected):', { from, to, reason, detail });
          }
          return;
        }

        if (state.consoleRef && typeof state.consoleRef.warn === 'function') {
          state.consoleRef.warn('[render-telemetry] fallback:', { from, to, reason, detail });
        }

        const now = Date.now();
        if ((now - state.lastToastMs) > 2500) {
          state.lastToastMs = now;
          if (typeof state.showToast === 'function') {
            state.showToast(`Renderer-Fallback: ${from} -> ${to} (${reason})`, 'warning');
          }
        }
      }
    });
  }

  const api = {
    configureRenderTelemetryRuntime,
    installRenderTelemetryHook,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeRenderTelemetryHook = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
