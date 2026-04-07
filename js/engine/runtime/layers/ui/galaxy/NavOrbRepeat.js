/**
 * RuntimeGalaxyNavOrbRepeat.js
 *
 * Repeat/hold button behavior for galaxy nav orb actions.
 */

'use strict';

(function () {
  const state = {
    triggerNavAction: null,
    windowRef: null,
  };

  function configureGalaxyNavOrbRepeatRuntime(opts = {}) {
    const {
      triggerNavAction = null,
      windowRef = null,
    } = opts;

    state.triggerNavAction = typeof triggerNavAction === 'function' ? triggerNavAction : null;
    state.windowRef = windowRef || window;
  }

  function bindNavRepeatButton(button, rootRef = null) {
    if (!button || typeof state.triggerNavAction !== 'function') return false;

    const action = String(button.dataset.navAction || '');
    if (!action) return false;

    let intervalTimer = null;
    let delayTimer = null;
    let held = false;

    const clearTimers = () => {
      if (delayTimer) {
        state.windowRef.clearTimeout(delayTimer);
        delayTimer = null;
      }
      if (intervalTimer) {
        state.windowRef.clearInterval(intervalTimer);
        intervalTimer = null;
      }
    };

    const fire = () => state.triggerNavAction(action, rootRef);

    const startHold = () => {
      held = true;
      fire();
      clearTimers();
      delayTimer = state.windowRef.setTimeout(() => {
        intervalTimer = state.windowRef.setInterval(fire, 96);
      }, 190);
    };

    const stopHold = () => {
      clearTimers();
      state.windowRef.setTimeout(() => { held = false; }, 0);
    };

    button.addEventListener('click', (e) => {
      e.preventDefault();
      if (held) return;
      fire();
    });
    button.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      startHold();
    });
    button.addEventListener('mouseup', stopHold);
    button.addEventListener('mouseleave', stopHold);
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startHold();
    }, { passive: false });
    button.addEventListener('touchend', stopHold);
    button.addEventListener('touchcancel', stopHold);
    state.windowRef.addEventListener('mouseup', stopHold);
    state.windowRef.addEventListener('touchend', stopHold);
    state.windowRef.addEventListener('touchcancel', stopHold);

    return true;
  }

  const api = {
    configureGalaxyNavOrbRepeatRuntime,
    bindNavRepeatButton,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyNavOrbRepeat = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();