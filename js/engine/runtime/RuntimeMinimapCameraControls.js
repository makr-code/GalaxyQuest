/**
 * RuntimeMinimapCameraControls.js
 *
 * Minimap camera control helpers.
 */

'use strict';

(function () {
  function createMinimapCameraControls(opts = {}) {
    const wm = opts.wm;
    const worldScale = Number(opts.worldScale || 0.028) || 0.028;
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const getMinimapCamera = typeof opts.getMinimapCamera === 'function' ? opts.getMinimapCamera : (() => ({}));

    function setTarget(targetX, targetY, immediate = false) {
      const minimapCamera = getMinimapCamera() || {};

      // Keep virtual camera in sync for offline/headless paths.
      const tx = Number(targetX || 0);
      const ty = Number(targetY || 0);
      minimapCamera.targetX = tx;
      minimapCamera.targetY = ty;
      minimapCamera.cameraX = tx + 68;
      minimapCamera.cameraY = ty + 109;

      const renderer = getGalaxy3d();
      if (!renderer) return false;

      const delegate = renderer._delegate || null;
      const base = delegate || renderer;
      const scale = Number(base?._starScale || renderer?._starScale || worldScale) || worldScale;

      if (base?.camera?.position && base?.controls?.target) {
        const nextX = Number(targetX || 0) * scale;
        const nextZ = Number(targetY || 0) * scale;
        const deltaX = nextX - Number(base.controls.target.x || 0);
        const deltaZ = nextZ - Number(base.controls.target.z || 0);
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) return false;
        base.controls.target.x += deltaX;
        base.controls.target.z += deltaZ;
        base.camera.position.x += deltaX;
        base.camera.position.z += deltaZ;
        if (immediate && typeof base.controls.update === 'function') {
          try { base.controls.update(); } catch (_) {}
        }
        return true;
      }

      if (renderer?._view) {
        const nextPanX = -Number(targetX || 0) * scale;
        const nextPanY = -Number(targetY || 0) * scale;
        renderer._view.targetPanX = nextPanX;
        renderer._view.targetPanY = nextPanY;
        if (immediate) {
          renderer._view.panX = nextPanX;
          renderer._view.panY = nextPanY;
        }
        return true;
      }

      return false;
    }

    function zoom(deltaY) {
      const minimapCamera = getMinimapCamera() || {};

      // Keep virtual zoom in sync for smoke tests/offline mode.
      const zoomOut = Number(deltaY || 0) > 0;
      const vz = Number(minimapCamera.zoom || 1) || 1;
      minimapCamera.zoom = zoomOut ? Math.max(0.25, vz * 0.88) : Math.min(8, vz * 1.12);

      const renderer = getGalaxy3d();
      if (!renderer) return false;

      const delegate = renderer._delegate || null;
      const base = delegate || renderer;

      if (base?.camera?.position && base?.controls?.target) {
        const factor = zoomOut ? 1.12 : 0.88;
        const offset = base.camera.position.clone().sub(base.controls.target).multiplyScalar(factor);
        base.camera.position.copy(base.controls.target.clone().add(offset));
        if (typeof base.controls.update === 'function') {
          try { base.controls.update(); } catch (_) {}
        }
        return true;
      }

      if (renderer?._view) {
        const currentZoom = Number(renderer._view.targetZoom || renderer._view.zoom || 1) || 1;
        const nextZoom = zoomOut
          ? Math.max(0.45, currentZoom * 0.88)
          : Math.min(6, currentZoom * 1.12);
        renderer._view.targetZoom = nextZoom;
        return true;
      }

      return false;
    }

    function queueTarget(targetX, targetY, immediate = false) {
      wm.open('galaxy');
      if (setTarget(targetX, targetY, immediate)) return;
      setTimeout(() => { setTarget(targetX, targetY, immediate); }, 120);
      setTimeout(() => { setTarget(targetX, targetY, immediate); }, 360);
    }

    return {
      setTarget,
      zoom,
      queueTarget,
    };
  }

  const api = {
    createMinimapCameraControls,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapCameraControls = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
