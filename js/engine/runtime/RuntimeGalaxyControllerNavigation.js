/**
 * RuntimeGalaxyControllerNavigation.js
 *
 * Extracted galaxy navigation actions used by GalaxyController.
 */

'use strict';

(function () {
  function createGalaxyControllerNavigation(opts = {}) {
    const closeTopbarSearchOverlay = typeof opts.closeTopbarSearchOverlay === 'function' ? opts.closeTopbarSearchOverlay : (() => {});
    const getTopbarSearchDom = typeof opts.getTopbarSearchDom === 'function' ? opts.getTopbarSearchDom : (() => ({}));
    const wm = opts.wm;
    const uiState = opts.uiState || {};
    const loadGalaxyStars3D = typeof opts.loadGalaxyStars3D === 'function' ? opts.loadGalaxyStars3D : (async () => {});
    const getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
    const getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : (() => null);
    const setPinnedStar = typeof opts.setPinnedStar === 'function' ? opts.setPinnedStar : (() => {});
    const setGalaxyContext = typeof opts.setGalaxyContext === 'function' ? opts.setGalaxyContext : (() => {});
    const runPhysicsCinematicFlight = typeof opts.runPhysicsCinematicFlight === 'function' ? opts.runPhysicsCinematicFlight : (async () => ({ ok: false }));
    const getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : (() => null);
    const toggleGalaxyOverlay = typeof opts.toggleGalaxyOverlay === 'function' ? opts.toggleGalaxyOverlay : (() => {});
    const renderGalaxySystemDetails = typeof opts.renderGalaxySystemDetails === 'function' ? opts.renderGalaxySystemDetails : (() => {});
    const loadStarSystemPlanets = typeof opts.loadStarSystemPlanets === 'function' ? opts.loadStarSystemPlanets : (async () => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const colonies = Array.isArray(opts.colonies) ? opts.colonies : [];
    const getCurrentColony = typeof opts.getCurrentColony === 'function' ? opts.getCurrentColony : (() => null);
    const galaxySystemMax = Number(opts.galaxySystemMax || 4999);
    const settingsState = opts.settingsState || {};
    const selectColonyById = typeof opts.selectColonyById === 'function' ? opts.selectColonyById : (() => {});
    const gameLog = typeof opts.gameLog === 'function' ? opts.gameLog : (() => {});
    const isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : (() => false);
    const waitMs = typeof opts.waitMs === 'function' ? opts.waitMs : (async () => {});
    const focusSystemPlanetInView = typeof opts.focusSystemPlanetInView === 'function' ? opts.focusSystemPlanetInView : (() => {});

    async function jumpToSearchStar(star) {
      if (!star) return;
      closeTopbarSearchOverlay();
      const { input } = getTopbarSearchDom();
      if (input) input.blur();

      const g = Math.max(1, Number(star.galaxy_index || uiState.activeGalaxy || 1));
      const s = Math.max(1, Number(star.system_index || 1));
      wm.open('galaxy');
      const root = wm.body('galaxy');
      if (!root) return;

      const from = Math.max(1, s - 420);
      const to = Math.min(galaxySystemMax, s + 420);
      const galInput = root.querySelector('#gal-galaxy');
      const fromInput = root.querySelector('#gal-from');
      const toInput = root.querySelector('#gal-to');
      if (galInput) galInput.value = String(g);
      if (fromInput) fromInput.value = String(from);
      if (toInput) toInput.value = String(to);

      await loadGalaxyStars3D(root);

      const stars = Array.isArray(getGalaxyStars()) ? getGalaxyStars() : [];
      let target = stars.find((row) => Number(row?.galaxy_index || 0) === g && Number(row?.system_index || 0) === s) || null;
      if (!target) target = Object.assign({}, star, { galaxy_index: g, system_index: s });

      setPinnedStar(target);
      uiState.activeStar = target;
      setGalaxyContext(g, s, target);
      const flight = await runPhysicsCinematicFlight(target, {
        durationSec: 1.8,
        holdMs: 760,
        label: `${target.name || target.catalog_name || `System ${s}`} [${g}:${s}]`,
      });
      const galaxy3d = getGalaxy3d();
      if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
        galaxy3d.focusOnStar(target, !flight.ok);
      }
      toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
      renderGalaxySystemDetails(root, target, isSystemModeActive());
      loadStarSystemPlanets(root, target);
      showToast(`Navigation: ${target.name || target.catalog_name || `System ${s}`}`, 'info');
    }

    async function focusHomeSystem(root, opts = {}) {
      const silent = !!opts.silent;
      const cinematic = !!opts.cinematic;
      const shouldEnterSystem = (typeof opts.enterSystem === 'boolean')
        ? !!opts.enterSystem
        : !!settingsState.homeEnterSystem;
      const shouldFocusPlanet = (typeof opts.focusPlanet === 'boolean')
        ? !!opts.focusPlanet
        : false;

      const homeColony = colonies.find((colony) => !!colony?.is_homeworld) || getCurrentColony() || null;
      if (!root || !homeColony) {
        if (!silent) showToast('Kein Heimatplanet verfuegbar.', 'warning');
        return;
      }
      const g = Math.max(1, Number(homeColony.galaxy || 1));
      const s = Math.max(1, Number(homeColony.system || 1));
      const p = Math.max(1, Number(homeColony.position || 1));
      const from = Math.max(1, s - 420);
      const to = Math.min(galaxySystemMax, s + 420);

      const galInput = root.querySelector('#gal-galaxy');
      const fromInput = root.querySelector('#gal-from');
      const toInput = root.querySelector('#gal-to');
      if (galInput) galInput.value = String(g);
      if (fromInput) fromInput.value = String(from);
      if (toInput) toInput.value = String(to);

      await loadGalaxyStars3D(root);

      const stars = Array.isArray(getGalaxyStars()) ? getGalaxyStars() : [];
      let target = stars.find((star) => Number(star.system_index || 0) === s) || null;
      if (!target && stars.length) {
        target = stars.slice().sort((a, b) => Math.abs(Number(a.system_index || 0) - s) - Math.abs(Number(b.system_index || 0) - s))[0] || null;
      }
      if (!target) {
        let recovered = false;
        try {
          selectColonyById(homeColony.id, {
            openWindows: false,
            focusSource: 'home-visible-zero',
          });
          if (shouldEnterSystem) {
            wm.open('colony');
            recovered = true;
          }
          if (shouldFocusPlanet) {
            wm.open('buildings');
            recovered = true;
          }
        } catch (err) {
          gameLog('warn', 'Home fallback navigation fehlgeschlagen', err);
        }
        if (!silent) showToast('Heimatsystem nicht im aktuellen Sternbereich gefunden.', 'warning');
        if (recovered) {
          gameLog('warn', 'Heimatsystem nicht sichtbar, native Kolonie-Recovery aktiv', {
            galaxy: g,
            system: s,
            position: p,
          });
        }
        return;
      }

      setPinnedStar(target);
      uiState.activeStar = target;

      if (cinematic) {
        const label = `${target.name || target.catalog_name || `System ${s}`} [${g}:${s}:${p}]`;
        const details = root.querySelector('#galaxy-system-details');
        if (details) {
          details.innerHTML = `<span class="text-muted">Warp-Lock: ${label} ...</span>`;
        }
        const flight = await runPhysicsCinematicFlight(target, {
          durationSec: 2.4,
          holdMs: 1050,
          label,
        });
        const galaxy3d = getGalaxy3d();
        if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
          galaxy3d.focusOnStar(target, !flight.ok);
        }
      }

      if (!cinematic) {
        const galaxy3d = getGalaxy3d();
        if (galaxy3d && typeof galaxy3d.focusOnStar === 'function') {
          galaxy3d.focusOnStar(target, true);
        }
      }

      if (cinematic) {
        toggleGalaxyOverlay(root, '#galaxy-info-overlay', true);
        renderGalaxySystemDetails(root, target, false);
        await waitMs(700);
      }

      if (shouldEnterSystem && !isSystemModeActive()) {
        renderGalaxySystemDetails(root, target, true);
        await loadStarSystemPlanets(root, target);
        if (cinematic) {
          await waitMs(450);
        }
      } else {
        renderGalaxySystemDetails(root, target, isSystemModeActive());
      }

      if (shouldFocusPlanet && isSystemModeActive()) {
        focusSystemPlanetInView({ position: p }, true);
        if (cinematic) {
          await waitMs(350);
        }
      }

      if (!silent) {
        showToast(`Heimatnavigation: ${target.name || target.catalog_name || `System ${s}`}`, 'success');
      }
    }

    return {
      jumpToSearchStar,
      focusHomeSystem,
    };
  }

  const api = {
    createGalaxyControllerNavigation,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyControllerNavigation = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
