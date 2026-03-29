/*
 * Galaxy Renderer Events
 * Adapter layer over shared event bindings.
 */
(function () {
  const shared = window.GQGalaxyRendererEventBindingShared;
  if (shared && typeof shared.bindEvents === 'function' && typeof shared.unbindEvents === 'function') {
    window.GQGalaxyRendererEvents = shared;
    return;
  }

  // Safe fallback if script order is broken; keeps renderer construction alive.
  window.GQGalaxyRendererEvents = {
    bindEvents() {},
    unbindEvents() {},
  };
})();
