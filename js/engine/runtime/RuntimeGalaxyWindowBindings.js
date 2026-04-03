/**
 * RuntimeGalaxyWindowBindings.js
 *
 * Binds galaxy window controls after the DOM markup is created.
 */

'use strict';

(function () {
  const state = {
    bindGalaxyOverlayHotkeys: null,
    makeGalaxyOverlayDraggable: null,
    bindGalaxyNavOrb: null,
    loadStars3D: null,
    getGalaxy3d: null,
    updateGalaxyFollowUi: null,
    getSettingsState: null,
    applyRuntimeSettings: null,
    refreshGalaxyDensityMetrics: null,
    updateClusterBoundsUi: null,
    updateClusterHeatmapUi: null,
    isGalaxyFiltersEnabled: null,
    getGalaxyColonyFilterMode: null,
    updateGalaxyColonyFilterUi: null,
    updateCoreFxUi: null,
    updateFleetVectorsUi: null,
    updateLegacyFallbackUi: null,
    updateMagnetUi: null,
    applyMagnetPreset: null,
    saveUiSettings: null,
    showToast: null,
    applyPolicyMode: null,
    getPolicyProfileLabel: null,
    refreshPolicyUi: null,
    getGalaxyHydrationToken: null,
    setGalaxyHydrationToken: null,
    clearGalaxyModel: null,
    clearGalaxyDb: null,
    setGalaxyStars: null,
    setPinnedStar: null,
    clearGalaxyRendererStars: null,
    copyLastGalaxyDebugError: null,
    downloadGalaxyDebugLog: null,
    clearGalaxyDebugErrors: null,
    toggleGalaxyOverlay: null,
    refreshGalaxyHealth: null,
    renderGalaxyDebugPanel: null,
    getPinnedStar: null,
    getUiState: null,
    renderGalaxySystemDetails: null,
    isSystemModeActive: null,
  };

  function configureGalaxyWindowBindingsRuntime(opts = {}) {
    Object.keys(state).forEach((key) => {
      state[key] = typeof opts[key] === 'function' ? opts[key] : null;
    });
  }

  function bindGalaxyWindowControls(root) {
    if (!root) return;

    const stageEl = root.querySelector('.galaxy-3d-stage');
    if (stageEl) {
      stageEl.style.pointerEvents = 'none';
      stageEl.style.zIndex = '1';
    }
    root.querySelectorAll('.galaxy-overlay-window').forEach((overlay) => {
      overlay.style.pointerEvents = 'auto';
    });

    if (typeof state.bindGalaxyOverlayHotkeys === 'function') {
      state.bindGalaxyOverlayHotkeys();
    }
    if (typeof state.makeGalaxyOverlayDraggable === 'function') {
      state.makeGalaxyOverlayDraggable(root, '#galaxy-controls-overlay');
      state.makeGalaxyOverlayDraggable(root, '#galaxy-info-overlay');
      state.makeGalaxyOverlayDraggable(root, '#galaxy-nav-orb-overlay');
    }
    if (typeof state.bindGalaxyNavOrb === 'function') {
      state.bindGalaxyNavOrb(root);
    }

    root.querySelector('#gal-load-3d-btn')?.addEventListener('click', () => {
      if (typeof state.loadStars3D === 'function') {
        state.loadStars3D(root);
      }
    });

    root.querySelector('#gal-follow-toggle-btn')?.addEventListener('click', () => {
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      if (!galaxy3d || typeof galaxy3d.toggleFollowSelection !== 'function') return;
      galaxy3d.toggleFollowSelection();
      if (typeof state.updateGalaxyFollowUi === 'function') {
        state.updateGalaxyFollowUi(root);
      }
    });

    root.querySelector('#gal-cluster-bounds-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.clusterBoundsVisible = !(settingsState.clusterBoundsVisible !== false);
      state.applyRuntimeSettings?.();
      state.refreshGalaxyDensityMetrics?.(root);
      state.updateClusterBoundsUi?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`Cluster-Boxen: ${settingsState.clusterBoundsVisible ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-cluster-heatmap-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.clusterHeatmapEnabled = !(settingsState.clusterHeatmapEnabled !== false);
      state.applyRuntimeSettings?.();
      state.refreshGalaxyDensityMetrics?.(root);
      state.updateClusterHeatmapUi?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`Cluster-Heatmap: ${settingsState.clusterHeatmapEnabled ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-colonies-only-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      if (!(typeof state.isGalaxyFiltersEnabled === 'function' && state.isGalaxyFiltersEnabled())) {
        state.showToast?.('Galaxie-Filter ist derzeit deaktiviert.', 'info');
        return;
      }
      const modes = ['all', 'colonies', 'own', 'foreign'];
      const currentMode = typeof state.getGalaxyColonyFilterMode === 'function'
        ? state.getGalaxyColonyFilterMode()
        : 'all';
      const currentIndex = modes.indexOf(currentMode);
      settingsState.galaxyColonyFilterMode = modes[(currentIndex + 1 + modes.length) % modes.length];
      settingsState.galaxyColoniesOnly = settingsState.galaxyColonyFilterMode !== 'all';
      state.refreshGalaxyDensityMetrics?.(root);
      state.updateGalaxyColonyFilterUi?.(root);
      state.saveUiSettings?.();
      state.loadStars3D?.(root);
      const modeLabels = {
        all: 'alle Systeme',
        colonies: 'nur Kolonien',
        own: 'nur eigene Kolonien',
        foreign: 'nur fremde Kolonien',
      };
      const labelMode = typeof state.getGalaxyColonyFilterMode === 'function'
        ? state.getGalaxyColonyFilterMode()
        : settingsState.galaxyColonyFilterMode;
      state.showToast?.(`Galaxie-Filter: ${modeLabels[labelMode] || 'alle Systeme'}`, 'info');
    });

    root.querySelector('#gal-core-fx-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.galacticCoreFxAuto = false;
      settingsState.galacticCoreFxEnabled = !(settingsState.galacticCoreFxEnabled !== false);
      state.applyRuntimeSettings?.();
      state.updateCoreFxUi?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`Galactic Core FX: ${settingsState.galacticCoreFxEnabled ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-fleet-vectors-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.galaxyFleetVectorsVisible = !(settingsState.galaxyFleetVectorsVisible !== false);
      state.applyRuntimeSettings?.();
      state.updateFleetVectorsUi?.(root);
      if (root.querySelector('#galaxy-system-details') && typeof state.renderGalaxySystemDetails === 'function') {
        const uiState = typeof state.getUiState === 'function' ? state.getUiState() : {};
        const activeStar = (typeof state.getPinnedStar === 'function' ? state.getPinnedStar() : null)
          || uiState.activeStar
          || null;
        state.renderGalaxySystemDetails(root, activeStar, state.isSystemModeActive?.() || false);
      }
      state.saveUiSettings?.();
      state.showToast?.(`Fleet-Vektoren: ${settingsState.galaxyFleetVectorsVisible ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-system-legacy-fallback-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.systemViewLegacyFallback = !(settingsState.systemViewLegacyFallback === true);
      state.updateLegacyFallbackUi?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`System Legacy Fallback: ${settingsState.systemViewLegacyFallback ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-magnet-hover-toggle-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.hoverMagnetEnabled = !(settingsState.hoverMagnetEnabled !== false);
      state.applyRuntimeSettings?.();
      state.updateMagnetUi?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`Magnet-Hover: ${settingsState.hoverMagnetEnabled ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-magnet-click-toggle-btn')?.addEventListener('click', () => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.clickMagnetEnabled = !(settingsState.clickMagnetEnabled !== false);
      state.applyRuntimeSettings?.();
      state.updateMagnetUi?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`Magnet-Klick: ${settingsState.clickMagnetEnabled ? 'an' : 'aus'}`, 'info');
    });

    root.querySelector('#gal-magnet-star-px')?.addEventListener('input', (e) => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.hoverMagnetStarPx = Math.max(8, Math.min(64, Number(e.target.value || 24)));
      settingsState.magnetPreset = 'custom';
      state.applyRuntimeSettings?.();
      state.updateMagnetUi?.(root);
      state.saveUiSettings?.();
    });

    root.querySelector('#gal-magnet-planet-px')?.addEventListener('input', (e) => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.hoverMagnetPlanetPx = Math.max(8, Math.min(72, Number(e.target.value || 30)));
      settingsState.magnetPreset = 'custom';
      state.applyRuntimeSettings?.();
      state.updateMagnetUi?.(root);
      state.saveUiSettings?.();
    });

    root.querySelector('#gal-magnet-cluster-px')?.addEventListener('input', (e) => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      settingsState.hoverMagnetClusterPx = Math.max(8, Math.min(72, Number(e.target.value || 28)));
      settingsState.magnetPreset = 'custom';
      state.applyRuntimeSettings?.();
      state.updateMagnetUi?.(root);
      state.saveUiSettings?.();
    });

    root.querySelectorAll('[data-magnet-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = String(btn.getAttribute('data-magnet-preset') || 'balanced');
        state.applyMagnetPreset?.(preset, root);
      });
    });

    root.querySelector('#gal-policy-profile')?.addEventListener('change', (e) => {
      const selected = String(e.target.value || 'auto');
      if (selected === 'auto') {
        state.applyPolicyMode?.('auto');
        state.showToast?.(`Policy: Auto -> ${state.getPolicyProfileLabel?.() || 'Auto'}`, 'info');
      } else {
        state.applyPolicyMode?.('manual', selected);
        state.showToast?.(`Policy: ${state.getPolicyProfileLabel?.() || selected}`, 'info');
      }
      state.refreshPolicyUi?.(root);
      state.loadStars3D?.(root);
    });

    root.querySelector('#gal-cluster-density')?.addEventListener('change', (e) => {
      const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : null;
      if (!settingsState) return;
      const selected = String(e.target.value || 'auto').toLowerCase();
      settingsState.clusterDensityMode = ['auto', 'high', 'max'].includes(selected) ? selected : 'auto';
      state.applyRuntimeSettings?.();
      state.refreshGalaxyDensityMetrics?.(root);
      state.saveUiSettings?.();
      state.showToast?.(`Cluster-Dichte: ${settingsState.clusterDensityMode.toUpperCase()}`, 'info');
    });

    root.querySelector('#gal-clear-cache-btn')?.addEventListener('click', async () => {
      const nextToken = (typeof state.getGalaxyHydrationToken === 'function' ? state.getGalaxyHydrationToken() : 0) + 1;
      state.setGalaxyHydrationToken?.(nextToken);
      state.clearGalaxyModel?.();
      await Promise.resolve(state.clearGalaxyDb?.());
      state.setGalaxyStars?.([]);
      state.setPinnedStar?.(null);
      state.clearGalaxyRendererStars?.();
      const details = root.querySelector('#galaxy-system-details');
      const panel = root.querySelector('#galaxy-planets-panel');
      if (details) details.innerHTML = '<span class="text-muted">Galaxy cache cleared.</span>';
      if (panel) panel.innerHTML = '';
      state.showToast?.('Galaxy cache cleared.', 'success');
    });

    root.querySelector('#galaxy-debug-copy-btn')?.addEventListener('click', () => {
      state.copyLastGalaxyDebugError?.();
    });
    root.querySelector('#galaxy-debug-download-btn')?.addEventListener('click', () => {
      state.downloadGalaxyDebugLog?.();
    });
    root.querySelector('#galaxy-debug-clear-btn')?.addEventListener('click', () => {
      state.clearGalaxyDebugErrors?.();
    });

    root.querySelector('#gal-from')?.addEventListener('change', () => {
      const from = root.querySelector('#gal-from');
      const to = root.querySelector('#gal-to');
      if (from && to && parseInt(from.value, 10) > parseInt(to.value, 10)) {
        to.value = from.value;
      }
    });

    root.querySelectorAll('[data-overlay-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const selector = btn.getAttribute('data-overlay-close');
        if (!selector) return;
        state.toggleGalaxyOverlay?.(root, selector, false);
      });
    });

    state.refreshPolicyUi?.(root);
    state.refreshGalaxyHealth?.(root, false);
    state.refreshGalaxyDensityMetrics?.(root);
    state.updateGalaxyFollowUi?.(root);
    state.updateClusterBoundsUi?.(root);
    state.updateClusterHeatmapUi?.(root);
    state.updateGalaxyColonyFilterUi?.(root);
    state.updateCoreFxUi?.(root);
    state.updateFleetVectorsUi?.(root);
    state.updateLegacyFallbackUi?.(root);
    state.updateMagnetUi?.(root);
    state.renderGalaxyDebugPanel?.(root);
  }

  const api = {
    configureGalaxyWindowBindingsRuntime,
    bindGalaxyWindowControls,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyWindowBindings = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();