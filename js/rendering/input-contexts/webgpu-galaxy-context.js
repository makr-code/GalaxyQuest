/*
 * WebGPU renderer galaxy-context action resolver.
 */
(function () {
  'use strict';

  function resolve(renderer, ctx, phase) {
    const api = window.GQInputActionTypes || {};
    const T = api.types || {};
    const isEditableTarget = api.isEditableTarget || (() => false);
    const actions = [];
    const key = String(ctx?.key || '').toLowerCase();
    const active = phase === 'keydown';

    if ((phase === 'keydown' || phase === 'keyup') && isEditableTarget(ctx?.nativeEvent?.target)) {
      return actions;
    }

    if (phase === 'pointerdown' && (ctx.button === 1 || ctx.button === 2)) {
      actions.push({ type: T.CAMERA_DRAG_BEGIN || 'camera.drag.begin', mode: 'pan', button: ctx.button });
    }
    if (phase === 'pointermove' && ctx?.state?.drag?.active && (ctx.state.drag.button === 1 || ctx.state.drag.button === 2)) {
      actions.push({ type: T.CAMERA_DRAG_MOVE || 'camera.drag.move', mode: 'pan', button: ctx.state.drag.button });
    }
    if ((phase === 'pointerup' || phase === 'pointercancel') && renderer?._isDragging) {
      actions.push({ type: T.CAMERA_DRAG_END || 'camera.drag.end' });
    }
    if (phase === 'wheel') {
      actions.push({ type: T.CAMERA_ZOOM_STEP || 'camera.zoom.step', direction: ctx.deltaY < 0 ? 'in' : 'out' });
    }

    if (phase === 'keydown' || phase === 'keyup') {
      if (key === '+' || key === '=' || key === 'w') actions.push({ type: T.CAMERA_ZOOM_HOLD || 'camera.zoom.hold', direction: 'in', active });
      if (key === '-' || key === 's') actions.push({ type: T.CAMERA_ZOOM_HOLD || 'camera.zoom.hold', direction: 'out', active });
      if (key === 'arrowleft' || key === 'a') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'left', active });
      if (key === 'arrowright' || key === 'd') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'right', active });
      if (key === 'arrowup' || key === 'e') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'up', active });
      if (key === 'arrowdown' || key === 'q') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'down', active });
    }

    return actions;
  }

  window.GQWebGPUInputContextGalaxy = { resolve };
})();
