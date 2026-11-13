/**
 * RuntimeGalaxyControllerWindow.js
 *
 * Extracted GalaxyController window shell renderer.
 */

'use strict';

(function () {
  function createGalaxyControllerWindow(opts = {}) {
    const wm = opts.wm;
    const galaxySystemMax = Number(opts.galaxySystemMax || 4999);
    const getActivePolicyMode = typeof opts.getActivePolicyMode === 'function' ? opts.getActivePolicyMode : (() => 'auto');
    const getActivePolicyProfile = typeof opts.getActivePolicyProfile === 'function' ? opts.getActivePolicyProfile : (() => 'balanced');
    const policyProfiles = opts.policyProfiles || {};
    const settingsState = opts.settingsState || {};
    const bindGalaxyWindowControls = typeof opts.bindGalaxyWindowControls === 'function' ? opts.bindGalaxyWindowControls : (() => {});

    function clampNumber(value, min, max, fallback) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(min, Math.min(max, n));
    }

    function renderWindowShell(root) {
      if (!root) return;

      const galaxyWindow = root.closest('.wm-window[data-winid="galaxy"]');
      if (galaxyWindow) {
        galaxyWindow.style.pointerEvents = 'none';
      }
      root.style.pointerEvents = 'none';

      if (root.querySelector('.galaxy-3d-stage')) {
        return;
      }

      const policyProfileId = String(getActivePolicyProfile() || 'balanced');
      const policyProfile = policyProfiles[policyProfileId] || policyProfiles.balanced || { label: 'Balanced' };
      const clusterDensityMode = String(settingsState.clusterDensityMode || 'auto');
      const starMagnetPx = clampNumber(settingsState.hoverMagnetStarPx, 8, 64, 24);
      const planetMagnetPx = clampNumber(settingsState.hoverMagnetPlanetPx, 8, 72, 30);
      const clusterMagnetPx = clampNumber(settingsState.hoverMagnetClusterPx, 8, 72, 28);

      const documentRef = root.ownerDocument;
      const createElement = (tagName, className = '', text = null) => {
        const element = documentRef.createElement(tagName);
        if (className) element.className = className;
        if (text !== null && text !== undefined) element.textContent = String(text);
        return element;
      };
      const createButton = (id, label, className = 'btn btn-secondary') => {
        const button = createElement('button', className, label);
        button.type = 'button';
        button.id = id;
        return button;
      };
      const createInput = (type, id, min, max, value, step = null) => {
        const input = createElement('input');
        input.type = type;
        input.id = id;
        input.setAttribute('min', String(min));
        input.setAttribute('max', String(max));
        if (step !== null) input.setAttribute('step', String(step));
        input.setAttribute('value', String(value));
        return input;
      };
      const createLabel = (labelText, control) => {
        const label = createElement('label');
        label.append(documentRef.createTextNode(labelText), control);
        return label;
      };
      const addOption = (select, value, label, selected = false) => {
        const option = createElement('option', '', label);
        option.value = value;
        if (selected) option.selected = true;
        select.append(option);
      };

      const stage = createElement('div', 'galaxy-3d-stage galaxy-bg-stage');
      const controls = createElement('div', 'galaxy-overlay-window hidden');
      controls.id = 'galaxy-controls-overlay';
      const header = createElement('div', 'galaxy-overlay-head');
      header.append(
        createElement('strong', '', 'Galaxy Controls'),
        createElement('span', 'galaxy-overlay-hotkeys', 'O:Controls | I:Info | L:Follow | V:Vectors')
      );
      const closeButton = createElement('button', 'btn btn-sm', 'Close');
      closeButton.type = 'button';
      closeButton.dataset.overlayClose = '#galaxy-controls-overlay';
      header.append(closeButton);

      const nav = createElement('div', 'galaxy-nav');
      nav.append(createLabel('Galaxy: ', createInput('number', 'gal-galaxy', 1, 9, 1)));
      nav.append(createLabel('From: ', createInput('number', 'gal-from', 1, galaxySystemMax, 1)));
      nav.append(createLabel('To: ', createInput('number', 'gal-to', 1, galaxySystemMax, galaxySystemMax)));
      nav.append(createButton('gal-follow-toggle-btn', 'Follow: on'));

      const policySelect = createElement('select');
      policySelect.id = 'gal-policy-profile';
      const activePolicyMode = getActivePolicyMode();
      addOption(policySelect, 'auto', `Auto (${policyProfile.label})`, activePolicyMode === 'auto');
      addOption(policySelect, 'balanced', 'Balanced', activePolicyMode === 'manual' && policyProfileId === 'balanced');
      addOption(policySelect, 'cache_aggressive', 'Aggressive Cache', activePolicyMode === 'manual' && policyProfileId === 'cache_aggressive');
      addOption(policySelect, 'always_fresh', 'Always Fresh', activePolicyMode === 'manual' && policyProfileId === 'always_fresh');
      nav.append(createLabel('Policy: ', policySelect));

      const densitySelect = createElement('select');
      densitySelect.id = 'gal-cluster-density';
      addOption(densitySelect, 'auto', 'Auto', clusterDensityMode === 'auto');
      addOption(densitySelect, 'high', 'High', clusterDensityMode === 'high');
      addOption(densitySelect, 'max', 'Max', clusterDensityMode === 'max');
      nav.append(createLabel('Density: ', densitySelect));

      [
        ['gal-cluster-bounds-btn', 'Cluster Boxes: on'],
        ['gal-cluster-heatmap-btn', 'Cluster Heatmap: on'],
        ['gal-colonies-only-btn', 'Nur Kolonien: aus'],
        ['gal-core-fx-btn', 'Core FX: on'],
        ['gal-fleet-vectors-btn', 'Fleet Vectors: on'],
        ['gal-system-legacy-fallback-btn', 'System Legacy Fallback: off'],
        ['gal-magnet-hover-toggle-btn', 'Magnet Hover: on'],
        ['gal-magnet-click-toggle-btn', 'Magnet Click: on'],
      ].forEach(([id, label]) => nav.append(createButton(id, label)));

      const presets = createElement('div', 'galaxy-nav-strip');
      Object.assign(presets.style, {
        gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
        gap: '0.25rem',
      });
      [
        ['precise', 'Preset: Precise'],
        ['balanced', 'Preset: Balanced'],
        ['sticky', 'Preset: Sticky'],
      ].forEach(([preset, label]) => {
        const button = createElement('button', 'btn btn-secondary btn-sm', label);
        button.type = 'button';
        button.dataset.magnetPreset = preset;
        presets.append(button);
      });
      nav.append(presets);

      [
        ['Star Magnet Px: ', 'gal-magnet-star-px', 64, starMagnetPx, 'gal-magnet-star-px-value'],
        ['Planet Magnet Px: ', 'gal-magnet-planet-px', 72, planetMagnetPx, 'gal-magnet-planet-px-value'],
        ['Cluster Magnet Px: ', 'gal-magnet-cluster-px', 72, clusterMagnetPx, 'gal-magnet-cluster-px-value'],
      ].forEach(([labelText, id, max, value, valueId]) => {
        const input = createInput('range', id, 8, max, value, 1);
        const valueLabel = createElement('span', 'text-muted', value);
        valueLabel.id = valueId;
        const label = createElement('label');
        label.append(documentRef.createTextNode(labelText), input, valueLabel);
        nav.append(label);
      });

      nav.append(createElement('span', 'text-muted', 'Magnetik wirkt vor allem bei langsamer Mausbewegung.'));
      const policyHint = createElement('span', 'text-muted');
      policyHint.id = 'gal-policy-hint';
      const densityMetrics = createElement('span', 'text-muted', 'Density: n/a');
      densityMetrics.id = 'gal-density-metrics';
      const healthBadge = createElement('span', 'text-muted', 'Health: checking...');
      healthBadge.id = 'gal-health-badge';
      nav.append(policyHint, densityMetrics, healthBadge);
      nav.append(
        createButton('gal-load-3d-btn', 'Load 3D Stars'),
        createButton('gal-clear-cache-btn', 'Clear Cache', 'btn btn-warning')
      );

      controls.append(header, nav);
      stage.append(controls);
      root.replaceChildren(stage);

      bindGalaxyWindowControls(root);
    }

    return {
      renderWindowShell,
    };
  }

  const api = {
    createGalaxyControllerWindow,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerWindow = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
