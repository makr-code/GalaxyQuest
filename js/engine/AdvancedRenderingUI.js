/**
 * AdvancedRenderingUI.js
 * Handles UI controls for advanced 3D rendering features
 *
 * Manages:
 * - Quality preset selection
 * - Individual feature toggles
 * - Performance monitor display
 * - localStorage persistence
 */

export class AdvancedRenderingUI {
  static instance = null;

  /**
   * @param {GameEngine} gameEngine
   */
  constructor(gameEngine) {
    this.engine = gameEngine;
    this.perfMonInterval = null;
    this.perfMonVisible = false;

    // Bind event handlers
    this._onPresetChange = this._onPresetChange.bind(this);
    this._onFeatureToggle = this._onFeatureToggle.bind(this);
    this._onPerfMonToggle = this._onPerfMonToggle.bind(this);
    this._updatePerfMonitor = this._updatePerfMonitor.bind(this);
  }

  /**
   * Initialize UI controls and restore saved preferences.
   * @returns {this}
   */
  init() {
    this._attachEventListeners();
    this._restorePreferences();
    return this;
  }

  /**
   * Attach UI event listeners.
   * @private
   */
  _attachEventListeners() {
    // Quality preset selector
    const presetSelect = document.getElementById('adv-rendering-preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', this._onPresetChange);
    }

    // Feature toggles
    const featureCheckboxes = [
      'adv-rendering-lod',
      'adv-rendering-bloom',
      'adv-rendering-motionblur',
      'adv-rendering-dof',
      'adv-rendering-decals',
      'adv-rendering-tonemapping',
    ];

    featureCheckboxes.forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.addEventListener('change', this._onFeatureToggle);
      }
    });

    // Performance monitor toggle
    const perfMonCheckbox = document.getElementById('adv-rendering-perfmon');
    if (perfMonCheckbox) {
      perfMonCheckbox.addEventListener('change', this._onPerfMonToggle);
    }

    // Colorblind mode selector
    const colorblindSelect = document.getElementById('adv-rendering-colorblind');
    if (colorblindSelect) {
      colorblindSelect.addEventListener('change', this._onColorblindModeChange.bind(this));
    }
  }

  /**
   * Restore UI state and engine settings from localStorage.
   * @private
   */
  _restorePreferences() {
    const savedPreset = localStorage.getItem('adv-rendering-preset') || 'high';
    const presetSelect = document.getElementById('adv-rendering-preset');
    if (presetSelect) {
      presetSelect.value = savedPreset;
    }

    // Apply preset to engine
    this._applyPreset(savedPreset);

    // Restore individual feature toggles
    const featureSettings = [
      { id: 'adv-rendering-lod', feature: 'lod' },
      { id: 'adv-rendering-bloom', feature: 'bloom' },
      { id: 'adv-rendering-motionblur', feature: 'motionblur' },
      { id: 'adv-rendering-dof', feature: 'dof' },
      { id: 'adv-rendering-decals', feature: 'decals' },
      { id: 'adv-rendering-tonemapping', feature: 'tonemapping' },
    ];

    featureSettings.forEach(({ id, feature }) => {
      const checkbox = document.getElementById(id);
      const savedState = localStorage.getItem(`adv-rendering-${feature}`);
      if (checkbox && savedState !== null) {
        checkbox.checked = savedState === 'true';
      }
    });

    // Restore colorblind mode
    const savedColorblindMode = localStorage.getItem('adv-rendering-colorblind') || 'normal';
    const colorblindSelect = document.getElementById('adv-rendering-colorblind');
    if (colorblindSelect) {
      colorblindSelect.value = savedColorblindMode;
      this._applyColorblindMode(savedColorblindMode);
    }
  }

  /**
   * Handle quality preset selection.
   * @private
   */
  _onPresetChange(evt) {
    const preset = evt.target.value;
    localStorage.setItem('adv-rendering-preset', preset);
    this._applyPreset(preset);
  }

  /**
   * Apply a quality preset to the engine.
   * @private
   */
  _applyPreset(preset) {
    if (!this.engine?.renderingMgr) return;

    // Apply preset
    this.engine.renderingMgr.applyPreset(preset);

    // Update UI checkboxes to reflect preset settings
    const presetSettings = {
      ultra: { lod: true, bloom: true, motionblur: true, dof: true, decals: true, tonemapping: true },
      high: { lod: true, bloom: true, motionblur: true, dof: false, decals: true, tonemapping: true },
      medium: { lod: true, bloom: true, motionblur: false, dof: false, decals: true, tonemapping: true },
      low: { lod: true, bloom: false, motionblur: false, dof: false, decals: false, tonemapping: true },
      mobile: { lod: true, bloom: false, motionblur: false, dof: false, decals: false, tonemapping: false },
    };

    const settings = presetSettings[preset] || {};
    this._updateCheckboxes(settings);
  }

  /**
   * Update feature toggle checkboxes to reflect engine state.
   * @private
   */
  _updateCheckboxes(settings) {
    const featureMap = {
      lod: 'adv-rendering-lod',
      bloom: 'adv-rendering-bloom',
      motionblur: 'adv-rendering-motionblur',
      dof: 'adv-rendering-dof',
      decals: 'adv-rendering-decals',
      tonemapping: 'adv-rendering-tonemapping',
    };

    Object.entries(featureMap).forEach(([feature, elementId]) => {
      const checkbox = document.getElementById(elementId);
      if (checkbox && settings[feature] !== undefined) {
        checkbox.checked = settings[feature];
      }
    });
  }

  /**
   * Handle individual feature toggle.
   * @private
   */
  _onFeatureToggle(evt) {
    const checkbox = evt.target;
    const id = checkbox.id;

    // Map ID to feature name and setting key
    const featureMap = {
      'adv-rendering-lod': 'lod',
      'adv-rendering-bloom': 'bloom',
      'adv-rendering-motionblur': 'motionblur',
      'adv-rendering-dof': 'dof',
      'adv-rendering-decals': 'decals',
      'adv-rendering-tonemapping': 'tonemapping',
    };

    const feature = featureMap[id];
    if (!feature || !this.engine?.renderingMgr) return;

    // Save to localStorage
    localStorage.setItem(`adv-rendering-${feature}`, checkbox.checked);

    // Apply to engine
    if (checkbox.checked) {
      this.engine.renderingMgr.enableFeature(feature);
    } else {
      this.engine.renderingMgr.disableFeature(feature);
    }
  }

  /**
   * Handle performance monitor toggle.
   * @private
   */
  _onPerfMonToggle(evt) {
    const checkbox = evt.target;
    this.perfMonVisible = checkbox.checked;
    localStorage.setItem('adv-rendering-perfmon', checkbox.checked);

    const statsDisplay = document.getElementById('adv-rendering-stats');
    if (statsDisplay) {
      statsDisplay.style.display = this.perfMonVisible ? 'block' : 'none';
    }

    if (this.perfMonVisible) {
      // Start performance monitoring
      if (!this.perfMonInterval) {
        this.perfMonInterval = setInterval(this._updatePerfMonitor, 500);
      }
    } else {
      // Stop performance monitoring
      if (this.perfMonInterval) {
        clearInterval(this.perfMonInterval);
        this.perfMonInterval = null;
      }
    }
  }

  /**
   * Update performance monitor display.
   * @private
   */
  _updatePerfMonitor() {
    if (!this.engine?.renderingMgr) return;

    const metrics = this.engine.renderingMgr._performanceMonitor || {};

    // Update FPS
    const fpsBadge = document.getElementById('perf-fps');
    if (fpsBadge) {
      fpsBadge.textContent = metrics.fps ? metrics.fps.toFixed(1) : '--';
    }

    // Update memory (if available from performance.memory)
    const memBadge = document.getElementById('perf-memory');
    if (memBadge && performance.memory) {
      const usedMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
      memBadge.textContent = `${usedMB} MB`;
    }

    // Update triangle count
    const trianglesBadge = document.getElementById('perf-triangles');
    if (trianglesBadge && this.engine.renderingMgr.getFeatureSummary) {
      const summary = this.engine.renderingMgr.getFeatureSummary();
      trianglesBadge.textContent = summary.triangles
        ? this._formatNumber(summary.triangles)
        : '--';
    }

    // Update draw calls (if available)
    const drawsBadge = document.getElementById('perf-draws');
    if (drawsBadge && metrics.drawCalls) {
      drawsBadge.textContent = metrics.drawCalls;
    }
  }

  /**
   * Format large numbers with commas.
   * @private
   */
  _formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /**
   * Handle colorblind mode selection change.
   * @private
   */
  _onColorblindModeChange(evt) {
    const mode = evt.target.value;
    localStorage.setItem('adv-rendering-colorblind', mode);
    this._applyColorblindMode(mode);
  }

  /**
   * Apply colorblind mode to rendering systems.
   * @private
   * @param {string} mode - Colorblind mode (normal|deuteranopia|protanopia|tritanopia|achromatic)
   */
  _applyColorblindMode(mode) {
    if (!this.engine) return;

    // Apply to ownership visuals system if available
    if (this.engine.ownershipSystem?.setColorblindMode) {
      this.engine.ownershipSystem.setColorblindMode(mode);
    }

    // Apply to ownership aura bloom pass if available
    if (this.engine.ownershipAuraBloom?.setColorblindMode) {
      this.engine.ownershipAuraBloom.setColorblindMode(mode);
    }

    // Dispatch event for other systems that need colorblind mode
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(
        new CustomEvent('colorblind-mode-changed', {
          detail: { mode },
        })
      );
    }
  }

  /**
   * Dispose and clean up resources.
   */
  dispose() {
    if (this.perfMonInterval) {
      clearInterval(this.perfMonInterval);
      this.perfMonInterval = null;
    }

    const presetSelect = document.getElementById('adv-rendering-preset');
    if (presetSelect) {
      presetSelect.removeEventListener('change', this._onPresetChange);
    }

    const featureCheckboxes = [
      'adv-rendering-lod',
      'adv-rendering-bloom',
      'adv-rendering-motionblur',
      'adv-rendering-dof',
      'adv-rendering-decals',
      'adv-rendering-tonemapping',
    ];

    featureCheckboxes.forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.removeEventListener('change', this._onFeatureToggle);
      }
    });

    const perfMonCheckbox = document.getElementById('adv-rendering-perfmon');
    if (perfMonCheckbox) {
      perfMonCheckbox.removeEventListener('change', this._onPerfMonToggle);
    }

    const colorblindSelect = document.getElementById('adv-rendering-colorblind');
    if (colorblindSelect) {
      colorblindSelect.removeEventListener('change', this._onColorblindModeChange);
    }
  }

  /**
   * Get or create singleton instance.
   * @static
   */
  static getInstance(gameEngine) {
    if (!AdvancedRenderingUI.instance) {
      AdvancedRenderingUI.instance = new AdvancedRenderingUI(gameEngine);
    }
    return AdvancedRenderingUI.instance;
  }
}

// Export for browser environments
if (typeof window !== 'undefined') {
  window.GQAdvancedRenderingUI = { AdvancedRenderingUI };
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AdvancedRenderingUI };
}
