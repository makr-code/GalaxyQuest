/*
 * Core renderer input context actions (Three/WebGL path)
 * Separates context policy (resolver + command handling) from renderer class.
 */
(function () {
  'use strict';

  function resolve(renderer, ctx, phase, inputContextHint = '') {
    const inputContext = String(inputContextHint || ctx?.inputContext || renderer?._getInputContext?.() || (renderer?.systemMode ? 'system' : 'galaxy'));
    const resolver = (inputContext === 'system' || inputContext === 'planetApproach' || inputContext === 'colonySurface' || inputContext === 'objectApproach')
      ? window.GQCoreInputContextSystem?.resolve
      : window.GQCoreInputContextGalaxy?.resolve;
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
      case (T.CAMERA_DRAG_BEGIN || 'camera.drag.begin'): {
        renderer.autoFrameEnabled = false;
        renderer.controls.dragging = true;
        renderer._inputDragState.active = true;
        renderer._inputDragState.button = Number(action.button ?? -1);
        renderer._inputDragState.mode = String(action.mode || '');
        renderer._inputDragState.startTarget = renderer.controls.target.clone();
        renderer._inputDragState.startPosition = renderer.camera.position.clone();
        renderer._inputDragState.startSpherical = new THREE.Spherical().setFromVector3(
          renderer.camera.position.clone().sub(renderer.controls.target)
        );
        break;
      }
      case (T.CAMERA_DRAG_MOVE || 'camera.drag.move'): {
        if (!renderer._inputDragState.active) return;
        renderer.autoFrameEnabled = false;
        if (action.mode === 'pan') {
          const width = Math.max(220, Number(renderer.renderer?.domElement?.clientWidth || 0));
          const panScale = Math.max(0.025, renderer._cameraDistance() / width);
          const startTarget = renderer._inputDragState.startTarget || renderer.controls.target.clone();
          const startPosition = renderer._inputDragState.startPosition || renderer.camera.position.clone();
          const dx = Number(ctx?.state?.drag?.deltaClientX || 0);
          const dy = Number(ctx?.state?.drag?.deltaClientY || 0);
          const nextTargetX = Number(startTarget.x || 0) - dx * panScale;
          const nextTargetZ = Number(startTarget.z || 0) + dy * panScale;
          const deltaX = nextTargetX - Number(renderer.controls.target.x || 0);
          const deltaZ = nextTargetZ - Number(renderer.controls.target.z || 0);
          renderer.controls.target.x = nextTargetX;
          renderer.controls.target.z = nextTargetZ;
          renderer.camera.position.x = Number(startPosition.x || 0) + (nextTargetX - Number(startTarget.x || 0));
          renderer.camera.position.z = Number(startPosition.z || 0) + (nextTargetZ - Number(startTarget.z || 0));
          if (typeof renderer.controls.update === 'function' && (Math.abs(deltaX) > 1e-6 || Math.abs(deltaZ) > 1e-6)) {
            renderer.controls.update();
          }
          break;
        }
        if (action.mode === 'orbit' && !renderer.hasExternalOrbitControls) {
          const startTarget = renderer._inputDragState.startTarget || renderer.controls.target.clone();
          const startSpherical = renderer._inputDragState.startSpherical || new THREE.Spherical().setFromVector3(renderer.camera.position.clone().sub(renderer.controls.target));
          const dx = Number(ctx?.state?.drag?.deltaClientX || 0);
          const dy = Number(ctx?.state?.drag?.deltaClientY || 0);
          const spherical = new THREE.Spherical(startSpherical.radius, startSpherical.phi, startSpherical.theta);
          spherical.theta -= dx * 0.01;
          spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, spherical.phi + dy * 0.008));
          const offset = new THREE.Vector3().setFromSpherical(spherical);
          renderer.controls.target.copy(startTarget);
          renderer.camera.position.copy(startTarget.clone().add(offset));
          if (typeof renderer.controls.update === 'function') {
            renderer.controls.update();
          }
        }
        break;
      }
      case (T.CAMERA_DRAG_END || 'camera.drag.end'): {
        renderer.controls.dragging = false;
        renderer._inputDragState.active = false;
        renderer._inputDragState.button = -1;
        renderer._inputDragState.mode = '';
        renderer._inputDragState.startTarget = null;
        renderer._inputDragState.startPosition = null;
        renderer._inputDragState.startSpherical = null;
        break;
      }
      case (T.CAMERA_ZOOM_STEP || 'camera.zoom.step'): {
        if (renderer.hasExternalOrbitControls) return;
        ctx?.nativeEvent?.preventDefault?.();
        renderer.autoFrameEnabled = false;
        renderer._lastZoomInputMs = performance.now();
        if (action.direction !== 'in') renderer._lastZoomOutInputMs = renderer._lastZoomInputMs;
        renderer._zoomTowardsTarget(Number(action.factor || 1));
        break;
      }
      case (T.UI_SYSTEM_EXIT || 'ui.system.exit'): {
        const isEditableTarget = api.isEditableTarget || (() => false);
        if (isEditableTarget(ctx?.nativeEvent?.target)) return;
        if (renderer.systemMode) {
          ctx?.nativeEvent?.preventDefault?.();
          renderer.exitSystemView(true);
        }
        break;
      }
      case (T.CAMERA_FRAME_FIT || 'camera.frame.fit'): {
        ctx?.nativeEvent?.preventDefault?.();
        if (renderer.systemMode) renderer.exitSystemView(false);
        renderer.autoFrameEnabled = true;
        renderer.fitCameraToStars(true);
        break;
      }
      case (T.CAMERA_FRAME_RESET || 'camera.frame.reset'): {
        ctx?.nativeEvent?.preventDefault?.();
        if (renderer.systemMode) renderer.exitSystemView(false);
        renderer.autoFrameEnabled = true;
        renderer.fitCameraToStars(false, true);
        break;
      }
      case (T.CAMERA_ZOOM_HOLD || 'camera.zoom.hold'):
        if (action.direction === 'in') renderer._kbdMove.forward = !!action.active;
        if (action.direction === 'out') renderer._kbdMove.back = !!action.active;
        break;
      case (T.CAMERA_ORBIT_HOLD || 'camera.orbit.hold'):
        if (action.direction === 'left') renderer._kbdMove.left = !!action.active;
        if (action.direction === 'right') renderer._kbdMove.right = !!action.active;
        if (action.direction === 'up') renderer._kbdMove.up = !!action.active;
        if (action.direction === 'down') renderer._kbdMove.down = !!action.active;
        break;
      case (T.CAMERA_PAN_HOLD || 'camera.pan.hold'):
        if (action.direction === 'left') renderer._kbdMove.panL = !!action.active;
        if (action.direction === 'right') renderer._kbdMove.panR = !!action.active;
        if (action.direction === 'up') renderer._kbdMove.panU = !!action.active;
        if (action.direction === 'down') renderer._kbdMove.panD = !!action.active;
        if (String(action.direction || '').startsWith('arrow')) ctx?.nativeEvent?.preventDefault?.();
        break;
      default:
        break;
    }
  }

  window.GQCoreInputContexts = {
    resolve,
    handle,
  };
})();
