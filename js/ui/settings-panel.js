/**
 * Settings Panel UI Controller
 * 
 * Handles:
 * - Tab navigation in settings dialog
 * - Loading/saving settings from/to game state
 * - 2FA commit flow for sensitive changes
 * 
 * Integration:
 *   Called from game.js during UI initialization
 *   Uses window.GQ_GAME_STATE or settingsState for data persistence
 */

(function() {
  'use strict';

  const SETTINGS_MODAL_ID = 'settings-modal';
  const SETTINGS_STORAGE_KEY = 'gq_game_settings';

  /**
   * Initialize Settings Panel
   * @param {Object} options - Configuration
   * @param {Object} options.gameState - Reference to game settings state
   * @param {Function} options.onSave - Callback when settings are saved
   * @param {Function} options.onCommit2FA - Callback for 2FA commit
   */
  function initSettingsPanel(options = {}) {
    const modal = document.getElementById(SETTINGS_MODAL_ID);
    if (!modal) {
      console.warn('[Settings] Modal element not found:', SETTINGS_MODAL_ID);
      return;
    }

    const gameState = options.gameState || window.GQ_GAME_STATE || {};
    const onSave = options.onSave || (() => {});
    const onCommit2FA = options.onCommit2FA || (() => {});

    // Initialize tabs
    setupTabNavigation(modal);

    // Load current settings into form
    loadSettingsIntoForm(modal, gameState);

    // Bind buttons
    const applyBtn = modal.querySelector('#settings-apply-btn');
    const commitBtn = modal.querySelector('#settings-commit-btn');
    const resetBtn = modal.querySelector('#settings-reset-btn');

    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const changes = captureSettingsFormValues(modal);
        const require2FA = changes.require2faCommit || false;

        if (require2FA && hasSignificantChanges(changes, gameState)) {
          // Show 2FA commit button, hide apply button
          applyBtn.style.display = 'none';
          commitBtn.style.display = '';
          console.log('[Settings] 2FA required for changes:', changes);
        } else {
          applySettings(modal, changes, gameState);
          onSave(changes);
          if (window.WM) window.WM.modal(SETTINGS_MODAL_ID, { onClose: () => {} });
        }
      });
    }

    if (commitBtn) {
      commitBtn.addEventListener('click', () => {
        // Trigger 2FA flow
        const changes = captureSettingsFormValues(modal);
        console.log('[Settings] Attempting 2FA commit:', changes);
        
        // Call 2FA handler (should show auth modal/challenge)
        if (typeof onCommit2FA === 'function') {
          onCommit2FA(changes, (verified) => {
            if (verified) {
              applySettings(modal, changes, gameState);
              onSave(changes);
              
              // Reset UI
              commitBtn.style.display = 'none';
              applyBtn.style.display = '';
              
              if (window.WM) window.WM.modal(SETTINGS_MODAL_ID, { onClose: () => {} });
              console.log('[Settings] 2FA verified and settings applied');
            } else {
              console.log('[Settings] 2FA verification failed');
            }
          });
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) {
          const defaults = getDefaultSettings();
          loadSettingsIntoForm(modal, defaults);
          console.log('[Settings] Reset to defaults');
        }
      });
    }

    // Bind range inputs to show live values
    modal.querySelectorAll('.settings-range').forEach((input) => {
      const valueDisplay = input.parentElement.querySelector('.settings-value');
      if (valueDisplay) {
        const updateValue = () => {
          const val = parseFloat(input.value).toFixed(2);
          valueDisplay.textContent = val;
        };
        input.addEventListener('input', updateValue);
        updateValue();
      }
    });
  }

  function setupTabNavigation(modal) {
    const tabHost = modal.querySelector('[data-ui-tabs]');
    if (!tabHost || !window.GQUIKit || typeof window.GQUIKit.initTabs !== 'function') return;

    window.GQUIKit.initTabs(modal);

    if (tabHost.__gqSettingsTabsBound) return;
    tabHost.__gqSettingsTabsBound = true;
    tabHost.addEventListener('gq:ui-tab-change', (ev) => {
      const tabName = ev?.detail?.tabId || '';
      if (tabName) {
        console.log('[Settings] Switched to tab:', tabName);
      }
    });
  }

  function loadSettingsIntoForm(modal, state) {
    modal.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting;
      const value = state[key];

      if (el.type === 'checkbox') {
        el.checked = Boolean(value);
      } else if (el.tagName === 'SELECT' || el.tagName === 'INPUT') {
        el.value = value ?? '';
      }
    });

    // Update range value displays
    modal.querySelectorAll('.settings-range').forEach((input) => {
      const valueDisplay = input.parentElement?.querySelector('.settings-value');
      if (valueDisplay) {
        const val = parseFloat(input.value).toFixed(2);
        valueDisplay.textContent = val;
      }
    });
  }

  function captureSettingsFormValues(modal) {
    const changes = {};

    modal.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting;

      if (el.type === 'checkbox') {
        changes[key] = el.checked;
      } else if (el.tagName === 'INPUT' && el.type === 'number') {
        changes[key] = parseInt(el.value, 10) || 0;
      } else if (el.tagName === 'INPUT' && el.type === 'range') {
        changes[key] = parseFloat(el.value) || 0;
      } else if (el.tagName === 'SELECT') {
        changes[key] = el.value;
      }
    });

    return changes;
  }

  function hasSignificantChanges(changes, gameState) {
    // Define which settings are "significant" (gameplay/account changes)
    const significantKeys = [
      'transitionPreset',
      'orbitSimulationMode',
      'systemOrbitPathsVisible',
      'systemOrbitMarkersVisible',
      'systemOrbitFocusOnly',
      'clusterDensityMode',
      'galaxyColonyFilterMode',
      'homeEnterSystem',
      'introFlightMode',
      'uiThemeMode',
      'uiThemeFactionId',
      'uiThemeCustomAccent',
    ];

    return significantKeys.some((key) => {
      return changes.hasOwnProperty(key) && changes[key] !== gameState[key];
    });
  }

  function applySettings(modal, changes, gameState) {
    // Update game state
    Object.assign(gameState, changes);

    // Persist to localStorage
    try {
      const key = window.localStorage ? SETTINGS_STORAGE_KEY : null;
      if (key) {
        localStorage.setItem(key, JSON.stringify(gameState));
        console.log('[Settings] Saved to localStorage');
      }
    } catch (err) {
      console.warn('[Settings] Failed to save to localStorage:', err.message);
    }

    // Trigger any reactive updates
    if (window.GQ_GAME_STATE) {
      window.GQ_GAME_STATE = Object.assign({}, gameState);
    }

    console.log('[Settings] Applied:', changes);
  }

  function getDefaultSettings() {
    return {
      transitionPreset: 'balanced',
      orbitSimulationMode: 'auto',
      systemOrbitPathsVisible: true,
      systemOrbitMarkersVisible: true,
      systemOrbitFocusOnly: false,
      autoTransitions: true,
      renderQualityProfile: 'auto',
      clusterDensityMode: 'auto',
      galaxyColonyFilterMode: 'all',
      galaxyColoniesOnly: false,
      clusterBoundsVisible: true,
      galaxyFleetVectorsVisible: true,
      galacticCoreFxEnabled: true,
      magnetPreset: 'balanced',
      hoverMagnetEnabled: true,
      clickMagnetEnabled: true,
      transitionStableMinMs: 160,
      masterVolume: 0.8,
      musicVolume: 0.55,
      sfxVolume: 0.8,
      masterMuted: false,
      musicMuted: false,
      sfxMuted: false,
      musicTransitionMode: 'fade',
      autoSceneMusic: true,
      uiThemeMode: 'auto',
      uiThemeFactionId: 0,
      uiThemeCustomAccent: '#3aa0ff',
      require2faCommit: false,
      require2faForStateChanges: false,
    };
  }

  // Export to global
  window.GQSettingsPanel = {
    init: initSettingsPanel,
    getDefaults: getDefaultSettings,
  };
})();
