/**
 * RuntimeUserMenuActions.js
 *
 * Handles commander menu actions for runtime settings and profile flows.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  async function handleUserMenuAction(action, deps = {}) {
    const {
      settingsState,
      audioManager,
      saveUiSettings = () => {},
      refreshAudioUi = () => {},
      renderUserMenu = () => {},
      applyTransitionPreset = () => {},
      applyRuntimeSettings = () => {},
      showToast = () => {},
      API = null,
      loadOverview = async () => {},
      closeUserMenu = () => {},
      documentRef = (typeof document !== 'undefined' ? document : null),
    } = deps;

    if (!settingsState) return;
    if (audioManager && typeof audioManager.playNavigation === 'function') audioManager.playNavigation();

    if (action === 'toggle-master-mute') {
      settingsState.masterMuted = !settingsState.masterMuted;
      if (audioManager && typeof audioManager.setMasterMuted === 'function') {
        audioManager.setMasterMuted(settingsState.masterMuted);
      }
      saveUiSettings();
      refreshAudioUi();
      renderUserMenu();
      return;
    }

    if (action === 'cycle-transition') {
      const order = ['smooth', 'balanced', 'snappy'];
      const idx = Math.max(0, order.indexOf(String(settingsState.transitionPreset || 'balanced')));
      const next = order[(idx + 1) % order.length];
      applyTransitionPreset(next);
      applyRuntimeSettings();
      saveUiSettings();
      renderUserMenu();
      showToast(`Transition-Preset: ${next}`, 'info');
      return;
    }

    if (action === 'toggle-home-enter') {
      settingsState.homeEnterSystem = !settingsState.homeEnterSystem;
      saveUiSettings();
      renderUserMenu();
      showToast(`Home-Navigation: ${settingsState.homeEnterSystem ? 'Systemansicht' : 'Galaxieansicht'}`, 'info');
      return;
    }

    if (action === 'cycle-intro-flight') {
      const order = ['off', 'fast', 'cinematic'];
      const idx = Math.max(0, order.indexOf(String(settingsState.introFlightMode || 'cinematic')));
      const next = order[(idx + 1) % order.length];
      settingsState.introFlightMode = next;
      saveUiSettings();
      renderUserMenu();
      const label = next === 'off' ? 'Aus' : next === 'fast' ? 'Schnell' : 'Cinematic';
      showToast(`Intro-Flight: ${label}`, 'info');
      return;
    }

    if (action === 'toggle-pvp') {
      if (!API || typeof API.togglePvp !== 'function') return;
      const response = await API.togglePvp();
      if (response.success) {
        if (audioManager && typeof audioManager.playPvpToggle === 'function') audioManager.playPvpToggle();
        showToast(response.pvp_mode ? 'PvP enabled!' : 'PvP disabled.', 'info');
        await loadOverview();
        renderUserMenu();
      } else {
        showToast(response.error || 'PvP konnte nicht geaendert werden.', 'error');
      }
      return;
    }

    if (action === 'refresh-profile') {
      await loadOverview();
      renderUserMenu();
      showToast('Profildaten aktualisiert.', 'success');
      return;
    }

    if (action === 'logout') {
      closeUserMenu();
      documentRef?.getElementById('logout-btn')?.click();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { handleUserMenuAction };
  } else {
    window.GQRuntimeUserMenuActions = { handleUserMenuAction };
  }
})();
