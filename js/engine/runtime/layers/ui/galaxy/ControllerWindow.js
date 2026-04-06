/**
 * ControllerWindow.js
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

      root.innerHTML = `
          <div class="galaxy-3d-stage galaxy-bg-stage">
            <div id="galaxy-controls-overlay" class="galaxy-overlay-window hidden">
              <div class="galaxy-overlay-head">
                <strong>Galaxy Controls</strong>
                <span class="galaxy-overlay-hotkeys">O:Controls | I:Info | L:Follow | V:Vectors</span>
                <button class="btn btn-sm" data-overlay-close="#galaxy-controls-overlay">Close</button>
              </div>
              <div class="galaxy-nav">
                <label>Galaxy: <input type="number" id="gal-galaxy" min="1" max="9" value="1" /></label>
                <label>From: <input type="number" id="gal-from" min="1" max="${galaxySystemMax}" value="1" /></label>
                <label>To: <input type="number" id="gal-to" min="1" max="${galaxySystemMax}" value="${galaxySystemMax}" /></label>
                <button class="btn btn-secondary" id="gal-follow-toggle-btn">Follow: on</button>
                <label>Policy:
                  <select id="gal-policy-profile">
                    <option value="auto" ${getActivePolicyMode() === 'auto' ? 'selected' : ''}>Auto (${policyProfile.label})</option>
                    <option value="balanced" ${getActivePolicyMode() === 'manual' && policyProfileId === 'balanced' ? 'selected' : ''}>Balanced</option>
                    <option value="cache_aggressive" ${getActivePolicyMode() === 'manual' && policyProfileId === 'cache_aggressive' ? 'selected' : ''}>Aggressive Cache</option>
                    <option value="always_fresh" ${getActivePolicyMode() === 'manual' && policyProfileId === 'always_fresh' ? 'selected' : ''}>Always Fresh</option>
                  </select>
                </label>
                <label>Density:
                  <select id="gal-cluster-density">
                    <option value="auto" ${clusterDensityMode === 'auto' ? 'selected' : ''}>Auto</option>
                    <option value="high" ${clusterDensityMode === 'high' ? 'selected' : ''}>High</option>
                    <option value="max" ${clusterDensityMode === 'max' ? 'selected' : ''}>Max</option>
                  </select>
                </label>
                <button class="btn btn-secondary" id="gal-cluster-bounds-btn">Cluster Boxes: on</button>
                <button class="btn btn-secondary" id="gal-cluster-heatmap-btn">Cluster Heatmap: on</button>
                <button class="btn btn-secondary" id="gal-colonies-only-btn">Nur Kolonien: aus</button>
                <button class="btn btn-secondary" id="gal-core-fx-btn">Core FX: on</button>
                <button class="btn btn-secondary" id="gal-fleet-vectors-btn">Fleet Vectors: on</button>
                <button class="btn btn-secondary" id="gal-system-legacy-fallback-btn">System Legacy Fallback: off</button>
                <button class="btn btn-secondary" id="gal-magnet-hover-toggle-btn">Magnet Hover: on</button>
                <button class="btn btn-secondary" id="gal-magnet-click-toggle-btn">Magnet Click: on</button>
                <div class="galaxy-nav-strip" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:0.25rem;">
                  <button class="btn btn-secondary btn-sm" type="button" data-magnet-preset="precise">Preset: Precise</button>
                  <button class="btn btn-secondary btn-sm" type="button" data-magnet-preset="balanced">Preset: Balanced</button>
                  <button class="btn btn-secondary btn-sm" type="button" data-magnet-preset="sticky">Preset: Sticky</button>
                </div>
                <label>Star Magnet Px:
                  <input type="range" id="gal-magnet-star-px" min="8" max="64" step="1" value="${starMagnetPx}" />
                  <span id="gal-magnet-star-px-value" class="text-muted">${starMagnetPx}</span>
                </label>
                <label>Planet Magnet Px:
                  <input type="range" id="gal-magnet-planet-px" min="8" max="72" step="1" value="${planetMagnetPx}" />
                  <span id="gal-magnet-planet-px-value" class="text-muted">${planetMagnetPx}</span>
                </label>
                <label>Cluster Magnet Px:
                  <input type="range" id="gal-magnet-cluster-px" min="8" max="72" step="1" value="${clusterMagnetPx}" />
                  <span id="gal-magnet-cluster-px-value" class="text-muted">${clusterMagnetPx}</span>
                </label>
                <span id="gal-magnet-help" class="text-muted">Magnetik wirkt vor allem bei langsamer Mausbewegung.</span>
                <span id="gal-policy-hint" class="text-muted"></span>
                <span id="gal-density-metrics" class="text-muted">Density: n/a</span>
                <span id="gal-health-badge" class="text-muted">Health: checking...</span>
                <button class="btn btn-secondary" id="gal-load-3d-btn">Load 3D Stars</button>
                <button class="btn btn-warning" id="gal-clear-cache-btn">Clear Cache</button>
              </div>
            </div>

            <aside id="galaxy-info-overlay" class="galaxy-overlay-window galaxy-info-overlay hidden">
              <div class="galaxy-overlay-head">
                <strong>Galaxy Intel</strong>
                <button class="btn btn-sm" data-overlay-close="#galaxy-info-overlay">Close</button>
              </div>
              <div class="galaxy-overlay-shortcuts">Shortcuts: O Controls | I Info | L Follow | V Vectors</div>

              <div class="galaxy-info-tabs" role="tablist" aria-label="Galaxy Info Tabs">
                <button class="galaxy-info-tab is-active" type="button" role="tab" aria-selected="true" data-info-tab="details">Details</button>
                <button class="galaxy-info-tab" type="button" role="tab" aria-selected="false" data-info-tab="planets">Planets</button>
                <button class="galaxy-info-tab" type="button" role="tab" aria-selected="false" data-info-tab="debug">Debug</button>
              </div>

              <section class="galaxy-info-panel is-active" data-info-panel="details">
                <div id="galaxy-system-details" class="text-muted">Overlay hidden. Press I to open details.</div>
                <div class="galaxy-colony-legend" aria-label="Kolonie-Ring-Legende">
                  <div class="galaxy-colony-legend-title">Kolonie-Ringe</div>
                  <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-sm"></span><span>Aussenposten</span></div>
                  <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-md"></span><span>Kolonie</span></div>
                  <div class="galaxy-colony-legend-row"><span class="galaxy-colony-legend-ring galaxy-colony-legend-ring-lg"></span><span>Kernwelt</span></div>
                </div>
              </section>

              <section class="galaxy-info-panel" data-info-panel="planets">
                <div id="galaxy-planets-panel" class="galaxy-planets-panel"></div>
              </section>

              <section class="galaxy-info-panel" data-info-panel="debug">
                <div class="galaxy-debug-wrap">
                  <div class="galaxy-debug-headline">
                    <div class="galaxy-debug-title">Lade-/Render-Log</div>
                    <div class="galaxy-debug-actions">
                      <button class="btn btn-secondary btn-sm" id="galaxy-debug-copy-btn" type="button">Letzten kopieren</button>
                      <button class="btn btn-secondary btn-sm" id="galaxy-debug-download-btn" type="button">Download</button>
                      <button class="btn btn-secondary btn-sm" id="galaxy-debug-clear-btn" type="button">Leeren</button>
                    </div>
                  </div>
                  <div id="galaxy-debug-log" class="galaxy-debug-log">Keine aktuellen Lade-/Renderfehler.</div>
                </div>
              </section>
            </aside>

          </div>
        `;

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
