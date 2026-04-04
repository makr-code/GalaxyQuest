/**
 * RuntimeLifecycleManager.js
 *
 * Orchestrates transitions between runtime lifecycle phases and invokes
 * optional feature hooks in phase order.
 */
(function () {
  const phasesApi = (typeof window !== 'undefined' && window.GQRuntimeLifecyclePhases)
    || (typeof require !== 'undefined' ? require('./RuntimeLifecyclePhases.js') : null);

  const registryApi = (typeof window !== 'undefined' && window.GQRuntimeFeatureRegistry)
    || (typeof require !== 'undefined' ? require('./RuntimeFeatureRegistry.js') : null);

  if (!phasesApi) {
    throw new Error('[RuntimeLifecycleManager] RuntimeLifecyclePhases is not available');
  }

  const LIFECYCLE_PHASES = phasesApi.LIFECYCLE_PHASES;

  const PHASE_HOOKS = Object.freeze({
    BOOTSTRAPPING: 'onBootstrap',
    SERVICES_READY: 'onServicesReady',
    UI_READY: 'onUiReady',
    RUNNING: 'onRunning',
    PAUSED: 'onPause',
    RESUMING: 'onResume',
    SHUTTING_DOWN: 'onShutdown',
    DISPOSED: 'onDispose',
    ERROR: 'onError',
  });

  class LifecycleManager {
    constructor(opts = {}) {
      const fallbackRegistry = registryApi?.createFeatureRegistry ? registryApi.createFeatureRegistry() : null;
      this._registry = opts.registry || fallbackRegistry;
      this._logger = typeof opts.logger === 'function' ? opts.logger : null;
      this._phase = LIFECYCLE_PHASES.CREATED;
      this._history = [{ phase: this._phase, ts: Date.now() }];
      this._transitionLock = Promise.resolve();
    }

    getPhase() {
      return this._phase;
    }

    getHistory() {
      return this._history.slice();
    }

    registerFeature(feature) {
      if (!this._registry) {
        throw new Error('[RuntimeLifecycleManager] Feature registry is not available');
      }
      return this._registry.register(feature);
    }

    async transitionTo(nextPhase, context = {}) {
      this._transitionLock = this._transitionLock.then(async () => {
        if (!phasesApi.isLifecyclePhase(nextPhase)) {
          throw new Error(`[RuntimeLifecycleManager] Unknown lifecycle phase: ${nextPhase}`);
        }

        const previousPhase = this._phase;
        this._phase = nextPhase;
        this._history.push({ phase: nextPhase, previousPhase, ts: Date.now() });

        this._log('info', `[Lifecycle] ${previousPhase} -> ${nextPhase}`);

        const hookName = PHASE_HOOKS[nextPhase] || null;
        if (!hookName || !this._registry || typeof this._registry.getAllSorted !== 'function') {
          return;
        }

        const features = this._registry.getAllSorted();
        for (const feature of features) {
          const hook = feature?.[hookName];
          if (typeof hook !== 'function') continue;
          await hook({
            phase: nextPhase,
            previousPhase,
            manager: this,
            ...context,
          });
        }
      });

      return this._transitionLock;
    }

    _log(level, message, detail) {
      if (!this._logger) return;
      try {
        this._logger(level, message, detail);
      } catch (_) {
        // Ignore logger failures to keep lifecycle transitions robust.
      }
    }
  }

  function createLifecycleManager(opts = {}) {
    return new LifecycleManager(opts);
  }

  const api = {
    LIFECYCLE_PHASES,
    PHASE_HOOKS,
    LifecycleManager,
    createLifecycleManager,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeLifecycleManager = api;
  }
})();
