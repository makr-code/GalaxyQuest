/**
 * WebGLTexture3DPatch.js
 *
 * Suppresses texImage3D FLIP_Y warnings from THREE.js WebGL renderer.
 *
 * ROOT CAUSE:
 *   THREE.js WebGLTextures.js sets pixelStorei(UNPACK_FLIP_Y_WEBGL, true)
 *   even for 3D textures (Data3DTexture, DataArrayTexture), where these
 *   flags are semantically invalid and trigger non-blocking warnings.
 *
 * SOLUTION:
 *   Lazy patch applied only when WebGL context is created.
 *   This avoids interfering with early boot sequence.
 *
 * License: MIT
 */

'use strict';

(function() {
  'use strict';

  // Lazy initialization: Apply patch only when WebGL context is created
  let patchApplied = false;

  function ensurePatchApplied() {
    if (patchApplied) return;
    patchApplied = true;

    if (typeof console === 'undefined' || typeof console.warn !== 'function') {
      return;
    }

    const originalWarn = console.warn;

    console.warn = function(...args) {
      const msg = String(args[0] || '');

      // ONLY suppress specific THREE.js texImage3D/pixelStorei warnings
      // Regex match for both texImage3D and pixelStorei messages with FLIP flags
      if (
        /texImage3D/.test(msg) && /FLIP_Y|PREMULTIPLY_ALPHA/.test(msg) ||
        /pixelStorei/.test(msg) && /FLIP_Y|PREMULTIPLY_ALPHA/.test(msg)
      ) {
        // Drop this warning silently
        return;
      }

      // CRITICAL: Pass through ALL other warnings!
      originalWarn.apply(console, args);
    };

    if (typeof window !== 'undefined') {
      window.GQWebGLTexture3DPatch = { patchApplied: true };
    }
  }

  // Hook into canvas.getContext to trigger patch on first WebGL use
  if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.getContext) {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = function(contextType, ...args) {
      // Apply patch  just before a WebGL context is created
      if (contextType === 'webgl' || contextType === 'webgl2' || contextType === 'experimental-webgl') {
        ensurePatchApplied();
      }
      return originalGetContext.apply(this, [contextType, ...args]);
    };
  }

  // Expose for manual trigger if needed
  if (typeof window !== 'undefined') {
    window.GQWebGLTexture3DPatch = { ensurePatchApplied };
  }
})();

