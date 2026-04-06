/**
 * NavActions.js
 *
 * Maps high-level galaxy nav actions to renderer method calls.
 */

'use strict';

(function () {
  const state = {
    callRendererMethod: null,
    getRollStep: null,
  };

  function configureGalaxyNavActionsRuntime(opts = {}) {
    const {
      callRendererMethod = null,
      getRollStep = null,
    } = opts;

    state.callRendererMethod = typeof callRendererMethod === 'function' ? callRendererMethod : null;
    state.getRollStep = typeof getRollStep === 'function' ? getRollStep : null;
  }

  function runRendererNavAction(action) {
    if (typeof state.callRendererMethod !== 'function') return false;

    const normalized = String(action || '');
    const rollStep = typeof state.getRollStep === 'function'
      ? Number(state.getRollStep()) || 0.05
      : 0.05;

    const navActionMap = {
      'zoom-in': () => state.callRendererMethod('nudgeZoom', 'in'),
      'zoom-out': () => state.callRendererMethod('nudgeZoom', 'out'),
      'rotate-left': () => state.callRendererMethod('nudgeOrbit', 'left'),
      'rotate-right': () => state.callRendererMethod('nudgeOrbit', 'right'),
      'rotate-up': () => state.callRendererMethod('nudgeOrbit', 'up'),
      'rotate-down': () => state.callRendererMethod('nudgeOrbit', 'down'),
      'pan-left': () => state.callRendererMethod('nudgePan', 'left'),
      'pan-right': () => state.callRendererMethod('nudgePan', 'right'),
      'pan-up': () => state.callRendererMethod('nudgePan', 'up'),
      'pan-down': () => state.callRendererMethod('nudgePan', 'down'),
      'pan-up-left': () => state.callRendererMethod('nudgePan', 'up-left'),
      'pan-up-right': () => state.callRendererMethod('nudgePan', 'up-right'),
      'pan-down-left': () => state.callRendererMethod('nudgePan', 'down-left'),
      'pan-down-right': () => state.callRendererMethod('nudgePan', 'down-right'),
      'translate-x-plus': () => state.callRendererMethod('nudgePan', 'right'),
      'translate-x-minus': () => state.callRendererMethod('nudgePan', 'left'),
      'translate-y-plus': () => state.callRendererMethod('nudgePan', 'up'),
      'translate-y-minus': () => state.callRendererMethod('nudgePan', 'down'),
      'translate-z-plus': () => state.callRendererMethod('nudgeZoom', 'in'),
      'translate-z-minus': () => state.callRendererMethod('nudgeZoom', 'out'),
      'rotate-u-plus': () => state.callRendererMethod('nudgeOrbit', 'left'),
      'rotate-u-minus': () => state.callRendererMethod('nudgeOrbit', 'right'),
      'rotate-v-plus': () => state.callRendererMethod('nudgeOrbit', 'up'),
      'rotate-v-minus': () => state.callRendererMethod('nudgeOrbit', 'down'),
      'rotate-w-plus': () => state.callRendererMethod('nudgeRoll', 'cw', rollStep),
      'rotate-w-minus': () => state.callRendererMethod('nudgeRoll', 'ccw', rollStep),
    };

    const run = navActionMap[normalized];
    if (!run) return false;
    return !!run();
  }

  const api = {
    configureGalaxyNavActionsRuntime,
    runRendererNavAction,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyNavActions = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
