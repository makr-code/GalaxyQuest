/*
 * Core renderer galaxy-context action resolver.
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
    const dragButton = Number(ctx?.state?.drag?.button ?? -1);

    if ((phase === 'keydown' || phase === 'keyup') && isEditableTarget(ctx?.nativeEvent?.target)) {
      return actions;
    }

    if (phase === 'pointerdown') {
      if (ctx.button === 0) {
        actions.push({ type: T.CAMERA_DRAG_BEGIN || 'camera.drag.begin', mode: renderer?.hasExternalOrbitControls ? 'orbit-passive' : 'orbit', button: 0 });
      } else if (ctx.button === 1 || ctx.button === 2) {
        actions.push({ type: T.CAMERA_DRAG_BEGIN || 'camera.drag.begin', mode: 'pan', button: ctx.button });
      }
    }

    if (phase === 'pointermove' && ctx?.state?.drag?.active) {
      if (dragButton === 1 || dragButton === 2) {
        actions.push({ type: T.CAMERA_DRAG_MOVE || 'camera.drag.move', mode: 'pan', button: dragButton });
      } else if (dragButton === 0 && !renderer?.hasExternalOrbitControls) {
        actions.push({ type: T.CAMERA_DRAG_MOVE || 'camera.drag.move', mode: 'orbit', button: 0 });
      }
    }

    if ((phase === 'pointerup' || phase === 'pointercancel') && renderer?._inputDragState?.active) {
      actions.push({ type: T.CAMERA_DRAG_END || 'camera.drag.end', mode: renderer._inputDragState.mode, button: renderer._inputDragState.button });
    }

    if (phase === 'wheel') {
      actions.push({
        type: T.CAMERA_ZOOM_STEP || 'camera.zoom.step',
        direction: ctx.deltaY < 0 ? 'in' : 'out',
        factor: ctx.deltaY < 0 ? 0.88 : 1.14,
      });
    }

    if (phase === 'keydown' || phase === 'keyup') {
      if (key === 'f' && active) actions.push({ type: T.CAMERA_FRAME_FIT || 'camera.frame.fit' });
      if (key === 'r' && active) actions.push({ type: T.CAMERA_FRAME_RESET || 'camera.frame.reset' });
      if (key === '+' || key === '=' || key === 'w') actions.push({ type: T.CAMERA_ZOOM_HOLD || 'camera.zoom.hold', direction: 'in', active });
      if (key === '-' || key === 's') actions.push({ type: T.CAMERA_ZOOM_HOLD || 'camera.zoom.hold', direction: 'out', active });
      if (key === 'a') actions.push({ type: T.CAMERA_ORBIT_HOLD || 'camera.orbit.hold', direction: 'left', active });
      if (key === 'd') actions.push({ type: T.CAMERA_ORBIT_HOLD || 'camera.orbit.hold', direction: 'right', active });
      if (key === 'e') actions.push({ type: T.CAMERA_ORBIT_HOLD || 'camera.orbit.hold', direction: 'up', active });
      if (key === 'q') actions.push({ type: T.CAMERA_ORBIT_HOLD || 'camera.orbit.hold', direction: 'down', active });
      if (key === 'arrowleft') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'left', active });
      if (key === 'arrowright') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'right', active });
      if (key === 'arrowup') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'up', active });
      if (key === 'arrowdown') actions.push({ type: T.CAMERA_PAN_HOLD || 'camera.pan.hold', direction: 'down', active });
    }

    return actions;
  }

  window.GQCoreInputContextGalaxy = { resolve };
})();
