/**
 * LifecyclePhases.js
 *
 * Shared lifecycle phase constants for runtime orchestration.
 */
(function () {
  const LIFECYCLE_PHASES = Object.freeze({
    CREATED: 'CREATED',
    BOOTSTRAPPING: 'BOOTSTRAPPING',
    SERVICES_READY: 'SERVICES_READY',
    UI_READY: 'UI_READY',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    RESUMING: 'RESUMING',
    SHUTTING_DOWN: 'SHUTTING_DOWN',
    DISPOSED: 'DISPOSED',
    ERROR: 'ERROR',
  });

  function getLifecyclePhaseValues() {
    return Object.values(LIFECYCLE_PHASES);
  }

  function isLifecyclePhase(value) {
    return getLifecyclePhaseValues().includes(value);
  }

  const api = {
    LIFECYCLE_PHASES,
    getLifecyclePhaseValues,
    isLifecyclePhase,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeLifecyclePhases = api;
  }
})();
