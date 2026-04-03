'use strict';

(function () {
  function initSystemBreadcrumb(deps = {}) {
    const windowRef = deps.windowRef || window;
    const setIntegration = typeof deps.setIntegration === 'function' ? deps.setIntegration : () => {};
    const logger = deps.logger || console;
    if (!windowRef.SystemBreadcrumbIntegration) return;
    try {
      setIntegration(new windowRef.SystemBreadcrumbIntegration());
      logger.log('[GQ] SystemBreadcrumb initialized');
    } catch (err) {
      logger.warn('[GQ] Failed to initialize SystemBreadcrumb:', err);
    }
  }

  function triggerSystemBreadcrumbEnter(payload, renderer, deps = {}) {
    const getIntegration = typeof deps.getIntegration === 'function' ? deps.getIntegration : () => null;
    const logger = deps.logger || console;
    const integration = getIntegration();
    if (integration && typeof integration.onSystemEnter === 'function') {
      try {
        integration.onSystemEnter(payload, renderer);
      } catch (err) {
        logger.warn('[GQ] SystemBreadcrumb.onSystemEnter failed:', err);
      }
    }
  }

  function triggerSystemBreadcrumbExit(deps = {}) {
    const getIntegration = typeof deps.getIntegration === 'function' ? deps.getIntegration : () => null;
    const logger = deps.logger || console;
    const integration = getIntegration();
    if (integration && typeof integration.onSystemExit === 'function') {
      try {
        integration.onSystemExit();
      } catch (err) {
        logger.warn('[GQ] SystemBreadcrumb.onSystemExit failed:', err);
      }
    }
  }

  const api = {
    initSystemBreadcrumb,
    triggerSystemBreadcrumbEnter,
    triggerSystemBreadcrumbExit,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSystemBreadcrumbHelpers = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();