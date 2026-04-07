/**
 * PostFxController.js
 *
 * Bridges the in-game post-effects settings UI panel with a running GameEngine.
 * Reads HTML range/checkbox inputs from the `#gfx-postfx-panel` section and
 * calls `engine.configurePostFx()` whenever a control changes.
 *
 * Usage (browser, after engine is ready):
 *
 *   const ctrl = new PostFxController(engine);
 *   ctrl.attach(); // reads current engine state → fills inputs
 *
 *   // Later, when the user opens a different scene / engine:
 *   ctrl.detach();
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Default parameter ranges shown in the UI sliders. */
const PARAM_META = {
  bloom: {
    threshold: { min: 0, max: 1,    step: 0.01, default: 0.8  },
    strength:  { min: 0, max: 3,    step: 0.05, default: 1.2  },
    radius:    { min: 0, max: 2,    step: 0.05, default: 0.6  },
  },
  vignette: {
    darkness:  { min: 0, max: 1,    step: 0.01, default: 0.5  },
    falloff:   { min: 0.1, max: 5,  step: 0.1,  default: 2.0  },
  },
  chromatic: {
    power:     { min: 0, max: 0.05, step: 0.001, default: 0.005 },
    angle:     { min: 0, max: 6.28, step: 0.01,  default: 0     },
  },
  ssao: {
    radius:    { min: 0.05, max: 2.0, step: 0.05, default: 0.5  },
    power:     { min: 0.5,  max: 4.0, step: 0.1,  default: 2.0  },
    bias:      { min: 0,    max: 0.1, step: 0.005, default: 0.025 },
  },
};

class PostFxController {
  /**
   * @param {import('../GameEngine').GameEngine} engine
   * @param {string} [panelId='gfx-postfx-panel']  id of the root panel element
   */
  constructor(engine, panelId = 'gfx-postfx-panel') {
    this._engine   = engine;
    this._panelId  = panelId;
    this._panel    = null;
    this._handlers = []; // { el, event, fn } for teardown
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Attach to the DOM panel and sync initial values from the engine.
   * Safe to call multiple times — re-attaches cleanly.
   */
  attach() {
    if (typeof document === 'undefined') return;

    this.detach();

    this._panel = document.getElementById(this._panelId);
    if (!this._panel) return;

    this._bindAll();
    this._syncFromEngine();
  }

  /** Remove all DOM listeners. */
  detach() {
    for (const { el, event, fn } of this._handlers) {
      el.removeEventListener(event, fn);
    }
    this._handlers = [];
    this._panel    = null;
  }

  // ---------------------------------------------------------------------------
  // Private — wiring
  // ---------------------------------------------------------------------------

  _bindAll() {
    const effects = ['bloom', 'vignette', 'chromatic', 'ssao'];

    for (const effect of effects) {
      // Enable/disable checkbox
      const chk = this._panel.querySelector(`[data-postfx="${effect}"][data-param="enabled"]`);
      if (chk) this._on(chk, 'change', () => this._applyOne(effect, 'enabled', chk.checked));

      // Parameter sliders
      for (const param of Object.keys(PARAM_META[effect] ?? {})) {
        const el = this._panel.querySelector(`[data-postfx="${effect}"][data-param="${param}"]`);
        if (!el) continue;

        this._on(el, 'input', () => {
          const val = parseFloat(el.value);
          this._applyOne(effect, param, val);
          // Update companion display value element if present
          const disp = this._panel.querySelector(
            `[data-postfx-display="${effect}"][data-param="${param}"]`
          );
          if (disp) disp.textContent = val.toFixed(el.dataset.decimals ?? 2);
        });
      }
    }
  }

  /**
   * Apply a single parameter change to the engine.
   * @param {string} effect  'bloom' | 'vignette' | 'chromatic'
   * @param {string} param   parameter name
   * @param {*}      value
   */
  _applyOne(effect, param, value) {
    if (!this._engine) return;
    this._engine.configurePostFx({ [effect]: { [param]: value } });
  }

  /**
   * Read current pass values from the engine and push them into the UI inputs.
   */
  _syncFromEngine() {
    const engine = this._engine;
    if (!engine) return;

    const passes = {
      bloom:    engine._bloomPass,
      vignette: engine._vignettePass,
      chromatic: engine._chromaticPass,
      ssao:     engine._ssaoPass,
    };

    for (const [effect, pass] of Object.entries(passes)) {
      if (!pass) continue;

      // Checkbox
      const chk = this._panel.querySelector(`[data-postfx="${effect}"][data-param="enabled"]`);
      if (chk) chk.checked = !!pass.enabled;

      // Sliders
      for (const param of Object.keys(PARAM_META[effect] ?? {})) {
        const el = this._panel.querySelector(`[data-postfx="${effect}"][data-param="${param}"]`);
        if (!el) continue;
        if (param in pass) {
          el.value = pass[param];
          const disp = this._panel.querySelector(
            `[data-postfx-display="${effect}"][data-param="${param}"]`
          );
          if (disp) disp.textContent = Number(pass[param]).toFixed(el.dataset.decimals ?? 2);
        }
      }
    }
  }

  /**
   * Register a DOM event listener and keep track of it for teardown.
   * @private
   */
  _on(el, event, fn) {
    el.addEventListener(event, fn);
    this._handlers.push({ el, event, fn });
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PostFxController, PARAM_META };
} else {
  window.GQPostFxController = PostFxController;
  window.GQPostFxParamMeta  = PARAM_META;
}
