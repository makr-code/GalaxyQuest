/**
 * RuntimeMinimapRenderOrchestrator.js
 *
 * Coordinates the minimap render flow.
 */

'use strict';

(function () {
  function createMinimapRenderOrchestrator(opts = {}) {
    const seedIfNeeded = typeof opts.seedIfNeeded === 'function' ? opts.seedIfNeeded : (() => {});
    const ensureDom = typeof opts.ensureDom === 'function' ? opts.ensureDom : (() => ({ wrap: null, canvas: null, hud: null }));
    const bindInteractions = typeof opts.bindInteractions === 'function' ? opts.bindInteractions : (() => {});
    const draw = typeof opts.draw === 'function' ? opts.draw : (() => {});
    const ensureLoop = typeof opts.ensureLoop === 'function' ? opts.ensureLoop : (() => {});

    function render(root) {
      if (!root) return;
      seedIfNeeded();
      const dom = ensureDom(root) || {};
      const wrap = dom.wrap || null;
      const canvas = dom.canvas || null;
      const hud = dom.hud || null;

      bindInteractions(root, canvas);
      draw(root, wrap, canvas, hud);
      ensureLoop(root, wrap, canvas, hud);
    }

    return {
      render,
    };
  }

  const api = {
    createMinimapRenderOrchestrator,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapRenderOrchestrator = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
