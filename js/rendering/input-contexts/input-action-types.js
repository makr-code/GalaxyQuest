/*
 * Shared input action type constants.
 */
(function () {
  'use strict';

  const types = Object.freeze({
    CAMERA_DRAG_BEGIN: 'camera.drag.begin',
    CAMERA_DRAG_MOVE: 'camera.drag.move',
    CAMERA_DRAG_END: 'camera.drag.end',
    CAMERA_ZOOM_STEP: 'camera.zoom.step',
    CAMERA_ZOOM_HOLD: 'camera.zoom.hold',
    CAMERA_ORBIT_HOLD: 'camera.orbit.hold',
    CAMERA_PAN_HOLD: 'camera.pan.hold',
    CAMERA_FRAME_FIT: 'camera.frame.fit',
    CAMERA_FRAME_RESET: 'camera.frame.reset',
    UI_SYSTEM_EXIT: 'ui.system.exit',
  });

  function isEditableTarget(target) {
    const tag = String(target?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || !!target?.isContentEditable;
  }

  window.GQInputActionTypes = {
    types,
    isEditableTarget,
  };
})();
