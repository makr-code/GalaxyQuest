/*
 * WebGPU renderer system-context action resolver.
 */
(function () {
  'use strict';

  function resolve(renderer, ctx, phase) {
    const galaxyResolver = window.GQWebGPUInputContextGalaxy?.resolve;
    const actions = typeof galaxyResolver === 'function'
      ? galaxyResolver(renderer, ctx, phase)
      : [];

    const api = window.GQInputActionTypes || {};
    const T = api.types || {};
    const key = String(ctx?.key || '').toLowerCase();
    const active = phase === 'keydown';

    if ((phase === 'keydown' || phase === 'keyup') && key === 'escape' && active) {
      actions.push({ type: T.UI_SYSTEM_EXIT || 'ui.system.exit' });
    }

    return actions;
  }

  window.GQWebGPUInputContextSystem = { resolve };
})();
