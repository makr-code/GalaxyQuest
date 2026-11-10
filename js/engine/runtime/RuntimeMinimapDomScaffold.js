/**
 * RuntimeMinimapDomScaffold.js
 *
 * Ensures minimap DOM container, canvas and HUD exist.
 */

'use strict';

(function () {
  function createMinimapDomScaffold() {
    function ensure(root) {
      if (!root) return { wrap: null, canvas: null, hud: null };

      let wrap = root.querySelector('.minimap-wrap');
      if (!wrap) {
        root.replaceChildren();
        wrap = document.createElement('div');
        wrap.className = 'minimap-wrap';
        root.appendChild(wrap);
      }

      let canvas = wrap.querySelector('.minimap-canvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'minimap-canvas';
        wrap.appendChild(canvas);
      }

      let hud = wrap.querySelector('.minimap-hud');
      if (!hud) {
        hud = document.createElement('div');
        hud.className = 'minimap-hud';
        const content = [
          ['minimap-badge', 'LIVE'],
          ['minimap-meta', 'Ziehen bewegt die Kamera'],
          ['minimap-hint', 'Klick fokussiert Systeme, Mausrad zoomt'],
        ];
        content.forEach(([className, text]) => {
          const item = document.createElement('span');
          item.className = className;
          item.textContent = text;
          hud.appendChild(item);
        });
        wrap.appendChild(hud);
      }

      return { wrap, canvas, hud };
    }

    return {
      ensure,
    };
  }

  const api = {
    createMinimapDomScaffold,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapDomScaffold = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
