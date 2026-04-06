/**
 * ControlUi.js
 *
 * Encapsulates galaxy control/status UI synchronization and health checks.
 */

'use strict';

(function () {
  const state = {
    getGalaxy3d: null,
    getSettingsState: null,
    getUiState: null,
    getPinnedStar: null,
    renderGalaxySystemDetails: null,
    isSystemModeActive: null,
    applyRuntimeSettings: null,
    saveUiSettings: null,
    showToast: null,
    gameLog: null,
    apiHealth: null,
    apiNetworkHealth: null,
    getGalaxyHealthState: null,
    setGalaxyHealthState: null,
  };

  function configureGalaxyControlUiRuntime(opts = {}) {
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    state.getSettingsState = typeof opts.getSettingsState === 'function' ? opts.getSettingsState : null;
    state.getUiState = typeof opts.getUiState === 'function' ? opts.getUiState : null;
    state.getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : null;
    state.renderGalaxySystemDetails = typeof opts.renderGalaxySystemDetails === 'function' ? opts.renderGalaxySystemDetails : null;
    state.isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : null;
    state.applyRuntimeSettings = typeof opts.applyRuntimeSettings === 'function' ? opts.applyRuntimeSettings : null;
    state.saveUiSettings = typeof opts.saveUiSettings === 'function' ? opts.saveUiSettings : null;
    state.showToast = typeof opts.showToast === 'function' ? opts.showToast : null;
    state.gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : null;
    state.apiHealth = typeof opts.apiHealth === 'function' ? opts.apiHealth : null;
    state.apiNetworkHealth = typeof opts.apiNetworkHealth === 'function' ? opts.apiNetworkHealth : null;
    state.getGalaxyHealthState = typeof opts.getGalaxyHealthState === 'function' ? opts.getGalaxyHealthState : null;
    state.setGalaxyHealthState = typeof opts.setGalaxyHealthState === 'function' ? opts.setGalaxyHealthState : null;
  }

  function getGalaxy3d() {
    return typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
  }

  function getSettingsState() {
    return typeof state.getSettingsState === 'function' ? state.getSettingsState() : {};
  }

  function getUiState() {
    return typeof state.getUiState === 'function' ? state.getUiState() : {};
  }

  function getGalaxyHealthState() {
    return typeof state.getGalaxyHealthState === 'function'
      ? state.getGalaxyHealthState()
      : { last: null, lastCheckMs: 0, warned: false };
  }

  function setGalaxyHealthState(nextState) {
    if (typeof state.setGalaxyHealthState === 'function') {
      state.setGalaxyHealthState(nextState || {});
    }
  }

  function refreshDensityMetrics(root) {
    const label = root?.querySelector?.('#gal-density-metrics');
    if (!label) return;
    const galaxy3d = getGalaxy3d();
    if (!galaxy3d || typeof galaxy3d.getRenderStats !== 'function') {
      label.textContent = 'Density: renderer offline';
      label.className = 'text-muted';
      return;
    }
    const stats = galaxy3d.getRenderStats();
    const raw = Number(stats.rawStars || 0);
    const visible = Number(stats.visibleStars || 0);
    const target = Number(stats.targetPoints || 0);
    const clusters = Number(stats.clusterCount || 0);
    const clusterLabel = stats.clusterBoundsVisible ? 'boxes on' : 'boxes off';
    const heatmapLabel = stats.clusterHeatmapEnabled ? 'heat on' : 'heat off';
    const ratioPct = raw > 0 ? Math.max(0, Math.min(100, Math.round((visible / raw) * 100))) : 0;
    label.textContent = `Density: ${visible}/${raw} (${ratioPct}%) | target ${target} | ${clusters} clusters | ${clusterLabel} | ${heatmapLabel} | ${String(stats.densityMode || 'auto').toUpperCase()} | ${String(stats.lodProfile || 'n/a')} | q=${String(stats.qualityProfile || 'n/a')}`;
    label.className = ratioPct >= 70 ? 'text-green' : ratioPct >= 35 ? 'text-yellow' : 'text-muted';
  }

  function updateClusterBoundsUi(root) {
    const btn = root?.querySelector('#gal-cluster-bounds-btn');
    const galaxy3d = getGalaxy3d();
    const settingsState = getSettingsState();
    const enabled = !galaxy3d || typeof galaxy3d.areClusterBoundsVisible !== 'function'
      ? (settingsState.clusterBoundsVisible !== false)
      : galaxy3d.areClusterBoundsVisible();
    if (!btn) return;
    btn.textContent = `Cluster Boxes: ${enabled ? 'on' : 'off'}`;
    btn.classList.toggle('btn-secondary', enabled);
    btn.classList.toggle('btn-warning', !enabled);
  }

  function updateClusterHeatmapUi(root) {
    const btn = root?.querySelector('#gal-cluster-heatmap-btn');
    const galaxy3d = getGalaxy3d();
    const settingsState = getSettingsState();
    const enabled = !galaxy3d || typeof galaxy3d.areClusterHeatmapEnabled !== 'function'
      ? (settingsState.clusterHeatmapEnabled !== false)
      : galaxy3d.areClusterHeatmapEnabled();
    if (!btn) return;
    btn.textContent = `Cluster Heatmap: ${enabled ? 'on' : 'off'}`;
    btn.classList.toggle('btn-secondary', enabled);
    btn.classList.toggle('btn-warning', !enabled);
  }

  function updateCoreFxUi(root) {
    const btn = root?.querySelector('#gal-core-fx-btn');
    const galaxy3d = getGalaxy3d();
    const settingsState = getSettingsState();
    if (!btn) return;
    const enabled = !galaxy3d || typeof galaxy3d.areGalacticCoreFxEnabled !== 'function'
      ? (settingsState.galacticCoreFxEnabled !== false)
      : galaxy3d.areGalacticCoreFxEnabled();
    btn.textContent = `Core FX: ${enabled ? 'on' : 'off'}${settingsState.galacticCoreFxAuto !== false ? ' (auto)' : ''}`;
    btn.classList.toggle('btn-secondary', enabled);
    btn.classList.toggle('btn-warning', !enabled);
  }

  function updateFleetVectorsUi(root) {
    const btn = root?.querySelector('#gal-fleet-vectors-btn');
    const settingsState = getSettingsState();
    if (!btn) return;
    const enabled = settingsState.galaxyFleetVectorsVisible !== false;
    btn.textContent = `Fleet Vectors: ${enabled ? 'on' : 'off'}`;
    btn.classList.toggle('btn-secondary', enabled);
    btn.classList.toggle('btn-warning', !enabled);
  }

  function updateLegacyFallbackUi(root) {
    const btn = root?.querySelector('#gal-system-legacy-fallback-btn');
    const settingsState = getSettingsState();
    if (!btn) return;
    const enabled = settingsState.systemViewLegacyFallback === true;
    btn.textContent = `System Legacy Fallback: ${enabled ? 'on' : 'off'}`;
    btn.classList.toggle('btn-secondary', !enabled);
    btn.classList.toggle('btn-warning', enabled);
  }

  function updateFollowUi(root) {
    const btn = root?.querySelector('#gal-follow-toggle-btn');
    const galaxy3d = getGalaxy3d();
    const uiState = getUiState();
    const enabled = !galaxy3d || typeof galaxy3d.isFollowingSelection !== 'function'
      ? true
      : galaxy3d.isFollowingSelection();
    if (btn) {
      btn.textContent = `Follow: ${enabled ? 'on' : 'off'}`;
      btn.classList.toggle('btn-secondary', enabled);
      btn.classList.toggle('btn-warning', !enabled);
    }
    const activeStar = (typeof state.getPinnedStar === 'function' ? state.getPinnedStar() : null)
      || uiState.activeStar
      || null;
    if (root?.querySelector('#galaxy-system-details') && typeof state.renderGalaxySystemDetails === 'function') {
      state.renderGalaxySystemDetails(root, activeStar, typeof state.isSystemModeActive === 'function' ? state.isSystemModeActive() : false);
    }
  }

  function applyMagnetPreset(presetName, root) {
    const settingsState = getSettingsState();
    const preset = String(presetName || 'balanced').toLowerCase();
    const presets = {
      precise: { star: 16, planet: 20, cluster: 18 },
      balanced: { star: 24, planet: 30, cluster: 28 },
      sticky: { star: 34, planet: 42, cluster: 40 },
    };
    const selected = presets[preset] || presets.balanced;
    settingsState.magnetPreset = presets[preset] ? preset : 'balanced';
    settingsState.hoverMagnetStarPx = selected.star;
    settingsState.hoverMagnetPlanetPx = selected.planet;
    settingsState.hoverMagnetClusterPx = selected.cluster;
    if (typeof state.applyRuntimeSettings === 'function') {
      state.applyRuntimeSettings();
    }
    updateMagnetUi(root);
    if (typeof state.saveUiSettings === 'function') {
      state.saveUiSettings();
    }
    if (typeof state.showToast === 'function') {
      state.showToast(`Magnet-Preset: ${settingsState.magnetPreset}`, 'info');
    }
  }

  function updateMagnetUi(root) {
    const settingsState = getSettingsState();
    const hoverBtn = root?.querySelector('#gal-magnet-hover-toggle-btn');
    const clickBtn = root?.querySelector('#gal-magnet-click-toggle-btn');
    const presetButtons = root?.querySelectorAll?.('[data-magnet-preset]') || [];
    const starRange = root?.querySelector('#gal-magnet-star-px');
    const planetRange = root?.querySelector('#gal-magnet-planet-px');
    const clusterRange = root?.querySelector('#gal-magnet-cluster-px');
    const starValue = root?.querySelector('#gal-magnet-star-px-value');
    const planetValue = root?.querySelector('#gal-magnet-planet-px-value');
    const clusterValue = root?.querySelector('#gal-magnet-cluster-px-value');

    const hoverEnabled = settingsState.hoverMagnetEnabled !== false;
    const clickEnabled = settingsState.clickMagnetEnabled !== false;
    const starPx = Math.max(8, Math.min(64, Number(settingsState.hoverMagnetStarPx || 24)));
    const planetPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetPlanetPx || 30)));
    const clusterPx = Math.max(8, Math.min(72, Number(settingsState.hoverMagnetClusterPx || 28)));
    const activePreset = String(settingsState.magnetPreset || 'custom');

    if (hoverBtn) {
      hoverBtn.textContent = `Magnet Hover: ${hoverEnabled ? 'on' : 'off'}`;
      hoverBtn.classList.toggle('btn-secondary', hoverEnabled);
      hoverBtn.classList.toggle('btn-warning', !hoverEnabled);
    }
    if (clickBtn) {
      clickBtn.textContent = `Magnet Click: ${clickEnabled ? 'on' : 'off'}`;
      clickBtn.classList.toggle('btn-secondary', clickEnabled);
      clickBtn.classList.toggle('btn-warning', !clickEnabled);
    }
    if (starRange) starRange.value = String(starPx);
    if (planetRange) planetRange.value = String(planetPx);
    if (clusterRange) clusterRange.value = String(clusterPx);
    if (starValue) starValue.textContent = String(starPx);
    if (planetValue) planetValue.textContent = String(planetPx);
    if (clusterValue) clusterValue.textContent = String(clusterPx);

    presetButtons.forEach((btn) => {
      const preset = String(btn.getAttribute('data-magnet-preset') || '');
      const active = preset === activePreset;
      btn.classList.toggle('btn-secondary', !active);
      btn.classList.toggle('btn-primary', active);
    });
  }

  async function refreshHealth(root, force) {
    const badge = root ? root.querySelector('#gal-health-badge') : null;
    if (!badge) return;

    const healthState = getGalaxyHealthState();
    if (!force && (Date.now() - Number(healthState.lastCheckMs || 0)) < 8000) return;

    badge.textContent = 'Health: checking...';
    badge.className = 'text-muted';
    try {
      const data = typeof state.apiHealth === 'function' ? await state.apiHealth() : null;
      healthState.lastCheckMs = Date.now();
      if (!data || !data.success || !data.health) {
        setGalaxyHealthState(healthState);
        badge.textContent = 'Health: unavailable';
        badge.className = 'text-muted';
        return;
      }

      healthState.last = data.health;
      const checks = data.health.checks || {};
      const missing = Number(checks.star_systems_missing_metadata || 0);
      if (data.health.ok) {
        badge.textContent = `Health: OK (${Number(checks.star_systems_total || 0)} systems)`;
        badge.className = 'text-green';
      } else {
        badge.textContent = `Health: WARN (${missing} missing metadata)`;
        badge.className = 'text-red';
        if (!healthState.warned && typeof state.showToast === 'function') {
          state.showToast(`Galaxy metadata warnings: ${missing} rows`, 'warning');
          healthState.warned = true;
        }
      }
      setGalaxyHealthState(healthState);
    } catch (err) {
      if (typeof state.gameLog === 'function') {
        state.gameLog('warn', 'Health check (API) fehlgeschlagen', err);
      }
      healthState.lastCheckMs = Date.now();
      setGalaxyHealthState(healthState);
      try {
        const net = typeof state.apiNetworkHealth === 'function' ? await state.apiNetworkHealth(false) : null;
        const kind = String(net?.kind || 'unknown');
        if (kind === 'offline') {
          badge.textContent = 'Health: offline';
          badge.className = 'text-red';
        } else if (kind === 'timeout') {
          badge.textContent = 'Health: timeout';
          badge.className = 'text-yellow';
        } else if (kind === 'unreachable') {
          badge.textContent = 'Health: API unreachable';
          badge.className = 'text-red';
        } else if (kind === 'http' || kind === 'auth') {
          badge.textContent = `Health: API ${Number(net?.status || 0) || 'error'}`;
          badge.className = 'text-yellow';
        } else {
          badge.textContent = 'Health: unavailable';
          badge.className = 'text-muted';
        }
      } catch (netErr) {
        if (typeof state.gameLog === 'function') {
          state.gameLog('info', 'Health fallback network probe fehlgeschlagen', netErr);
        }
        badge.textContent = 'Health: unavailable';
        badge.className = 'text-muted';
      }
    }
  }

  const api = {
    configureGalaxyControlUiRuntime,
    refreshDensityMetrics,
    updateClusterBoundsUi,
    updateClusterHeatmapUi,
    updateCoreFxUi,
    updateFleetVectorsUi,
    updateLegacyFallbackUi,
    updateFollowUi,
    applyMagnetPreset,
    updateMagnetUi,
    refreshHealth,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControlUi = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
