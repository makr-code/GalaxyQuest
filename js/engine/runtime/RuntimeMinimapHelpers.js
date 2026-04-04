/**
 * RuntimeMinimapHelpers.js
 *
 * Shared minimap projection and pose helpers.
 */

'use strict';

(function () {
  function createMinimapHelpers(opts = {}) {
    const worldScale = Number(opts.worldScale || 0.028) || 0.028;
    const minimapPad = Number(opts.minimapPad || 14) || 14;
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const getMinimapCamera = typeof opts.getMinimapCamera === 'function' ? opts.getMinimapCamera : (() => ({}));

    function projectPoint(state, x, y) {
      return {
        x: state.offX + (Number(x || 0) - state.minX) * state.scale,
        y: state.offY + (Number(y || 0) - state.minY) * state.scale,
      };
    }

    function clampCanvasPoint(state, point) {
      const pad = minimapPad + 2;
      return {
        x: Math.max(pad, Math.min((state.width || 0) - pad, Number(point?.x || 0))),
        y: Math.max(pad, Math.min((state.height || 0) - pad, Number(point?.y || 0))),
      };
    }

    function unprojectPoint(state, px, py) {
      const x = state.minX + ((Number(px || 0) - state.offX) / Math.max(0.0001, state.scale));
      const y = state.minY + ((Number(py || 0) - state.offY) / Math.max(0.0001, state.scale));
      return {
        x: Math.max(state.minX, Math.min(state.maxX, x)),
        y: Math.max(state.minY, Math.min(state.maxY, y)),
      };
    }

    function resolveRendererPose() {
      const renderer = getGalaxy3d();
      const minimapCamera = getMinimapCamera() || {};

      if (!renderer) {
        return {
          kind: 'virtual',
          backend: 'offline',
          scale: worldScale,
          zoom: minimapCamera.zoom,
          cameraX: minimapCamera.cameraX,
          cameraY: minimapCamera.cameraY,
          targetX: minimapCamera.targetX,
          targetY: minimapCamera.targetY,
        };
      }

      const delegate = renderer._delegate || null;
      const base = delegate || renderer;
      const scale = Number(base?._starScale || renderer?._starScale || worldScale) || worldScale;

      if (base?.camera?.position && base?.controls?.target) {
        return {
          kind: 'orbit',
          backend: String(renderer.backendType || base.rendererBackend || 'threejs'),
          scale,
          zoom: Number(renderer?._view?.zoom || renderer?._view?.targetZoom || 1) || 1,
          cameraX: Number(base.camera.position.x || 0) / scale,
          cameraY: Number(base.camera.position.z || 0) / scale,
          targetX: Number(base.controls.target.x || 0) / scale,
          targetY: Number(base.controls.target.z || 0) / scale,
        };
      }

      if (renderer?._view) {
        const zoom = Number(renderer._view.zoom || renderer._view.targetZoom || 1) || 1;
        const targetX = -(Number(renderer._view.targetPanX ?? renderer._view.panX ?? 0) / scale);
        const targetY = -(Number(renderer._view.targetPanY ?? renderer._view.panY ?? 0) / scale);
        const distanceLy = Math.max(55, Math.min(240, 118 / Math.max(0.45, zoom)));
        return {
          kind: 'panzoom',
          backend: String(renderer.backendType || 'webgpu'),
          scale,
          zoom,
          cameraX: targetX + distanceLy * 0.58,
          cameraY: targetY + distanceLy * 0.92,
          targetX,
          targetY,
        };
      }

      return {
        kind: 'virtual',
        backend: 'offline',
        scale: worldScale,
        zoom: minimapCamera.zoom,
        cameraX: minimapCamera.cameraX,
        cameraY: minimapCamera.cameraY,
        targetX: minimapCamera.targetX,
        targetY: minimapCamera.targetY,
      };
    }

    return {
      projectPoint,
      clampCanvasPoint,
      unprojectPoint,
      resolveRendererPose,
    };
  }

  const api = {
    createMinimapHelpers,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
