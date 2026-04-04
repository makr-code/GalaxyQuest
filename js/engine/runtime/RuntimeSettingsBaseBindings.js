/**
 * RuntimeSettingsBaseBindings.js
 *
 * Shared binding helpers for base settings controls.
 */

'use strict';

(function () {
  function createSettingsBaseBindings() {
    function bind(opts = {}) {
      const root = opts.root;
      if (!root) {
        return {
          bindRange: () => {},
        };
      }

      const settingsState = opts.settingsState || {};
      const settingsController = opts.settingsController;
      const wm = opts.wm;
      const getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : (() => null);
      const getActiveStar = typeof opts.getActiveStar === 'function' ? opts.getActiveStar : (() => null);
      const renderGalaxySystemDetails = typeof opts.renderGalaxySystemDetails === 'function' ? opts.renderGalaxySystemDetails : (() => {});
      const isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : (() => false);
      const galaxyController = opts.galaxyController || null;
      const applyTransitionPreset = typeof opts.applyTransitionPreset === 'function' ? opts.applyTransitionPreset : (() => {});

      const bindRange = (id, valueId, setter) => {
        const input = root.querySelector(id);
        const out = root.querySelector(valueId);
        if (!input || !out) return;
        const apply = () => {
          out.textContent = String(input.value);
          setter(Number(input.value || 0));
        };
        input.addEventListener('input', apply);
        input.addEventListener('change', apply);
      };

      const autoTransitions = root.querySelector('#set-auto-transitions');
      autoTransitions?.addEventListener('change', () => {
        settingsState.autoTransitions = !!autoTransitions.checked;
        settingsController.applyRuntimeSettings();
        settingsController.saveUiSettings();
      });

      const fleetVectors = root.querySelector('#set-galaxy-fleet-vectors');
      fleetVectors?.addEventListener('change', () => {
        settingsState.galaxyFleetVectorsVisible = !!fleetVectors.checked;
        settingsController.applyRuntimeSettings();
        settingsController.saveUiSettings();
        const galaxyRoot = wm.body('galaxy');
        if (galaxyRoot?.querySelector('#galaxy-system-details')) {
          const activeStar = getPinnedStar() || getActiveStar() || null;
          renderGalaxySystemDetails(galaxyRoot, activeStar, isSystemModeActive());
        }
      });

      const homeEnterSystem = root.querySelector('#set-home-enter-system');
      homeEnterSystem?.addEventListener('change', () => {
        settingsState.homeEnterSystem = !!homeEnterSystem.checked;
        settingsController.saveUiSettings();
      });

      const systemLegacyFallback = root.querySelector('#set-system-legacy-fallback');
      systemLegacyFallback?.addEventListener('change', () => {
        settingsState.systemViewLegacyFallback = !!systemLegacyFallback.checked;
        settingsController.saveUiSettings();
        const galaxyRoot = wm.body('galaxy');
        if (galaxyRoot && galaxyController) {
          galaxyController.updateLegacyFallbackUi(galaxyRoot);
        }
      });

      const transitionPreset = root.querySelector('#set-transition-preset');
      transitionPreset?.addEventListener('change', () => {
        applyTransitionPreset(transitionPreset.value);
        const hoverSlider = root.querySelector('#set-hover-distance');
        const stableSlider = root.querySelector('#set-transition-ms');
        const hoverOut = root.querySelector('#set-hover-distance-value');
        const stableOut = root.querySelector('#set-transition-ms-value');
        if (hoverSlider) hoverSlider.value = String(Math.round(settingsState.persistentHoverDistance));
        if (stableSlider) stableSlider.value = String(Math.round(settingsState.transitionStableMinMs));
        if (hoverOut) hoverOut.textContent = String(Math.round(settingsState.persistentHoverDistance));
        if (stableOut) stableOut.textContent = String(Math.round(settingsState.transitionStableMinMs));
        settingsController.applyRuntimeSettings();
        settingsController.saveUiSettings();
      });

      const bindDefaultRanges = () => {
        bindRange('#set-hover-distance', '#set-hover-distance-value', (v) => {
          settingsState.persistentHoverDistance = Math.max(120, v);
          settingsController.applyRuntimeSettings();
          settingsController.saveUiSettings();
        });

        bindRange('#set-transition-ms', '#set-transition-ms-value', (v) => {
          settingsState.transitionStableMinMs = Math.max(80, v);
          settingsController.applyRuntimeSettings();
          settingsController.saveUiSettings();
        });
      };

      return {
        bindRange,
        bindDefaultRanges,
      };
    }

    return {
      bind,
    };
  }

  const api = {
    createSettingsBaseBindings,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeSettingsBaseBindings = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
