/*
 * WebGPU renderer input context actions
 * Extracted policy layer for context-dependent action resolving + handling.
 */
(function () {
  'use strict';

  function resolve(renderer, ctx, phase, inputContextHint = '') {
    const inputContext = String(inputContextHint || ctx?.inputContext || renderer?._getInputContext?.() || (renderer?.systemMode ? 'system' : 'galaxy'));
    const resolver = (inputContext === 'system' || inputContext === 'planetApproach' || inputContext === 'colonySurface' || inputContext === 'objectApproach')
      ? window.GQWebGPUInputContextSystem?.resolve
      : window.GQWebGPUInputContextGalaxy?.resolve;
    if (typeof resolver === 'function') {
      return resolver(renderer, ctx, phase);
    }
    return [];
  }

  function handle(renderer, action, ctx) {
    if (!renderer || !action || !action.type) return;
    const api = window.GQInputActionTypes || {};
    const T = api.types || {};
    switch (action.type) {
      case (T.UI_SYSTEM_EXIT || 'ui.system.exit'):
        if (renderer.systemMode) {
          ctx?.nativeEvent?.preventDefault?.();
          renderer.exitSystemView(true);
        }
        break;
      case (T.CAMERA_DRAG_BEGIN || 'camera.drag.begin'):
        renderer._isDragging = true;
        renderer._dragStartX = Number(ctx?.clientX || 0);
        renderer._dragStartY = Number(ctx?.clientY || 0);
        renderer._dragPanX = Number(renderer._view.targetPanX || 0);
        renderer._dragPanY = Number(renderer._view.targetPanY || 0);
        ctx?.nativeEvent?.preventDefault?.();
        break;
      case (T.CAMERA_DRAG_MOVE || 'camera.drag.move'): {
        if (!renderer._isDragging) return;
        const dx = Number(ctx?.state?.drag?.deltaClientX || 0) / Math.max(1, renderer._canvas?.clientWidth || 1) * 2;
        const dy = Number(ctx?.state?.drag?.deltaClientY || 0) / Math.max(1, renderer._canvas?.clientHeight || 1) * 2;
        renderer._view.targetPanX = renderer._dragPanX + dx / Math.max(0.45, Number(renderer._view.zoom || 1));
        renderer._view.targetPanY = renderer._dragPanY - dy / Math.max(0.45, Number(renderer._view.zoom || 1));
        break;
      }
      case (T.CAMERA_DRAG_END || 'camera.drag.end'):
        renderer._isDragging = false;
        break;
      case (T.CAMERA_ZOOM_STEP || 'camera.zoom.step'): {
        const delta = action.direction === 'out' ? -0.15 : 0.15;
        const baseZoom = Number(renderer._view.targetZoom || renderer._view.zoom || 1);
        renderer._view.targetZoom = Math.max(0.45, Math.min(6, baseZoom + delta * baseZoom));
        break;
      }
      case (T.CAMERA_ZOOM_HOLD || 'camera.zoom.hold'):
        if (action.direction === 'in') renderer._kbdMove.zoomIn = !!action.active;
        if (action.direction === 'out') renderer._kbdMove.zoomOut = !!action.active;
        break;
      case (T.CAMERA_PAN_HOLD || 'camera.pan.hold'):
        if (action.direction === 'left') renderer._kbdMove.panL = !!action.active;
        if (action.direction === 'right') renderer._kbdMove.panR = !!action.active;
        if (action.direction === 'up') renderer._kbdMove.panU = !!action.active;
        if (action.direction === 'down') renderer._kbdMove.panD = !!action.active;
        if (String(ctx?.key || '').startsWith('Arrow')) ctx?.nativeEvent?.preventDefault?.();
        break;
      default:
        break;
    }
  }

  window.GQWebGPUInputContexts = {
    resolve,
    handle,
  };
})();
