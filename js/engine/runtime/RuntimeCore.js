/**
 * RuntimeCore.js
 *
 * Thin runtime coordinator built on top of EventBus + GameLoop.
 *
 * Goals:
 *  - decouple game runtime modules from direct window event wiring
 *  - provide a shared app-level event hub for runtime concerns
 *  - expose a lightweight frame ticker for UI/runtime housekeeping
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  const EventBusCtor = (typeof window !== 'undefined' && window.GQEventBus?.EventBus)
    || (typeof require !== 'undefined' ? require('../EventBus.js').EventBus : null);
  const GameLoopCtor = (typeof window !== 'undefined' && window.GQGameLoop)
    || (typeof require !== 'undefined' ? require('../GameLoop.js').GameLoop : null);

  class RuntimeCore {
    constructor(opts = {}) {
      if (!EventBusCtor) throw new Error('[RuntimeCore] EventBus is not available');
      this.events = new EventBusCtor();
      this._windowBindings = [];
      this._started = false;

      this._loop = null;
      if (GameLoopCtor) {
        const fixedStep = Number(opts.fixedStep || (1 / 30));
        this._loop = new GameLoopCtor({
          fixedStep,
          maxDt: Number(opts.maxDt || 0.25),
          onUpdate: (dt, alpha) => {
            this.events.emit('runtime:frame', { dt, alpha, ts: Date.now() });
          },
        });
      }
    }

    on(eventName, listener, opts = {}) {
      return this.events.on(eventName, listener, opts);
    }

    once(eventName, listener) {
      return this.events.once(eventName, listener);
    }

    emit(eventName, payload) {
      this.events.emit(eventName, payload);
    }

    bindWindowEvent(name, handler, runtimeEventName = null) {
      if (typeof window === 'undefined' || !window?.addEventListener) return () => {};

      const wrapped = (ev) => {
        try {
          if (runtimeEventName) {
            this.events.emit(runtimeEventName, { nativeEvent: ev, detail: ev?.detail || null });
          }
          if (typeof handler === 'function') handler(ev);
        } catch (err) {
          console.error('[RuntimeCore] window event handler failed:', name, err);
        }
      };

      window.addEventListener(name, wrapped);
      this._windowBindings.push({ name, wrapped });

      return () => {
        window.removeEventListener(name, wrapped);
      };
    }

    start() {
      if (this._started) return;
      this._started = true;
      this.events.emit('runtime:start', { ts: Date.now() });
      if (this._loop) this._loop.start();
    }

    stop() {
      if (!this._started) return;
      this._started = false;
      if (this._loop) this._loop.stop();
      this.events.emit('runtime:stop', { ts: Date.now() });

      if (typeof window !== 'undefined' && window?.removeEventListener) {
        this._windowBindings.forEach((entry) => {
          window.removeEventListener(entry.name, entry.wrapped);
        });
      }
      this._windowBindings = [];
    }
  }

  function createRuntimeCore(opts = {}) {
    const core = new RuntimeCore(opts);
    if (opts.autoStart !== false) core.start();
    return core;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RuntimeCore, createRuntimeCore };
  } else {
    window.GQRuntimeCore = { RuntimeCore, createRuntimeCore };
  }
})();
