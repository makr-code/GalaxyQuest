/**
 * RuntimeMinimapLoop.js
 *
 * Animation loop management for minimap rendering.
 */

'use strict';

(function () {
  function createMinimapLoop(opts = {}) {
    const draw = typeof opts.draw === 'function' ? opts.draw : (() => {});
    const isMinimapOpen = typeof opts.isMinimapOpen === 'function' ? opts.isMinimapOpen : (() => true);
    const requestFrame = typeof opts.requestFrame === 'function'
      ? opts.requestFrame
      : (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : ((fn) => setTimeout(fn, 16)));

    function ensureLoop(root, wrap, canvas, hud) {
      if (!canvas || canvas.__minimapLoopActive) return;
      canvas.__minimapLoopActive = true;

      const tick = () => {
        if (!canvas.__minimapLoopActive) return;
        if (!root || !root.isConnected || !isMinimapOpen()) {
          canvas.__minimapLoopActive = false;
          canvas.__minimapRaf = 0;
          return;
        }
        draw(root, wrap, canvas, hud);
        canvas.__minimapRaf = requestFrame(tick);
      };

      canvas.__minimapRaf = requestFrame(tick);
    }

    return {
      ensureLoop,
    };
  }

  const api = {
    createMinimapLoop,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapLoop = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
