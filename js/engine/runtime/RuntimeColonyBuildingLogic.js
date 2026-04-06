/**
 * RuntimeColonyBuildingLogic.js
 *
 * Colony building metadata, zone priorities, focus selection, and sub-view routing.
 */

'use strict';

(function () {
  const BUILDING_UI_META = {
    metal_mine:       { cat:'Extraction', icon:'MET', desc:'Mines metal from the planet crust. Output scales with richness.' },
    crystal_mine:     { cat:'Extraction', icon:'CRY', desc:'Extracts crystal formations. Higher levels deplete deposits faster.' },
    deuterium_synth:  { cat:'Extraction', icon:'DEU', desc:'Synthesises deuterium from surface water or atmosphere.' },
    rare_earth_drill: { cat:'Extraction', icon:'RRE', desc:'Extracts rare earth elements - finite deposit, high value.' },
    solar_plant:      { cat:'Energy', icon:'SOL', desc:'Converts sunlight to energy. Output depends on star type.' },
    fusion_reactor:   { cat:'Energy', icon:'FUS', desc:'High-output fusion reactor. Consumes deuterium.' },
    hydroponic_farm:  { cat:'Life Support', icon:'FOD', desc:'Grows food for the population. Required to prevent starvation.' },
    food_silo:        { cat:'Life Support', icon:'SILO', desc:'Increases food storage capacity.' },
    habitat:          { cat:'Population', icon:'HAB', desc:'+200 max population per level.' },
    hospital:         { cat:'Population', icon:'MED', desc:'Improves healthcare. Raises happiness and public services index.' },
    school:           { cat:'Population', icon:'EDU', desc:'Education facility. Improves public services and colony productivity.' },
    security_post:    { cat:'Population', icon:'SEC', desc:'Maintains order. Reduces unrest and deters pirate raids.' },
    robotics_factory: { cat:'Industry', icon:'ROB', desc:'Reduces building construction time.' },
    shipyard:         { cat:'Industry', icon:'YRD', desc:'Required to build spacecraft.' },
    metal_storage:    { cat:'Storage', icon:'STO', desc:'Increases metal storage cap.' },
    crystal_storage:  { cat:'Storage', icon:'STO', desc:'Increases crystal storage cap.' },
    deuterium_tank:   { cat:'Storage', icon:'STO', desc:'Increases deuterium storage cap.' },
    research_lab:     { cat:'Science', icon:'LAB', desc:'Enables and accelerates research.' },
    missile_silo:     { cat:'Military', icon:'MSL', desc:'Launches defensive missiles.' },
    nanite_factory:   { cat:'Advanced', icon:'NAN', desc:'Nano-assemblers that dramatically cut build times.' },
    terraformer:      { cat:'Advanced', icon:'TER', desc:'Reshapes planetary geology to expand available tiles.' },
    colony_hq:        { cat:'Advanced', icon:'HQ', desc:'Colony administration. Raises colony level cap.' },
    solar_satellite:  { cat:'Orbital', icon:'SAT', desc:'Orbital solar collectors supporting planetary energy output.' },
  };

  const BUILDING_ZONE_PRIORITY = {
    industrial: ['metal_mine', 'crystal_mine', 'deuterium_synth', 'robotics_factory'],
    utility: ['solar_plant', 'fusion_reactor', 'metal_storage', 'crystal_storage', 'deuterium_tank'],
    civic: ['habitat', 'hydroponic_farm', 'hospital', 'school'],
    science: ['research_lab', 'terraformer'],
    military: ['shipyard', 'missile_silo', 'security_post'],
    orbital: ['solar_satellite', 'shipyard', 'missile_silo'],
    flex: ['colony_hq', 'robotics_factory', 'habitat'],
  };

  const state = {
    getColonies: () => [],
    getWm: () => null,
    setColonyViewFocusCallback: null,
    selectColonyById: null,
    showToast: null,
    prefillFleetTarget: null,
  };

  function configureColonyBuildingLogicRuntime(opts = {}) {
    const {
      getColonies = null,
      getWm = null,
      setColonyViewFocusCallback = null,
      selectColonyById = null,
      showToast = null,
      prefillFleetTarget = null,
    } = opts;

    state.getColonies = typeof getColonies === 'function' ? getColonies : () => [];
    state.getWm = typeof getWm === 'function' ? getWm : () => null;
    state.setColonyViewFocusCallback = typeof setColonyViewFocusCallback === 'function' ? setColonyViewFocusCallback : null;
    state.selectColonyById = typeof selectColonyById === 'function' ? selectColonyById : null;
    state.showToast = typeof showToast === 'function' ? showToast : null;
    state.prefillFleetTarget = typeof prefillFleetTarget === 'function' ? prefillFleetTarget : null;
  }

  function getBuildingUiMeta(type) {
    return BUILDING_UI_META[String(type || '')] || { cat:'Other', icon:'BLD', desc:'' };
  }

  function getRecommendedBuildingFocus(colony) {
    if (!colony) return 'colony_hq';
    const type = String(colony.colony_type || '').toLowerCase();
    if (type === 'mining') return 'metal_mine';
    if (type === 'industrial') return 'robotics_factory';
    if (type === 'research') return 'research_lab';
    if (type === 'agricultural') return 'hydroponic_farm';
    if (type === 'military') return 'shipyard';
    return 'colony_hq';
  }

  function pickZoneBuildFocus(zone, colony, buildings = []) {
    const normalizedZone = String(zone || 'flex');
    const priorities = BUILDING_ZONE_PRIORITY[normalizedZone] || BUILDING_ZONE_PRIORITY.flex;
    const existing = new Set((buildings || []).map((building) => String(building.type || '')));
    const missing = priorities.find((type) => !existing.has(type));
    return missing || priorities[0] || getRecommendedBuildingFocus(colony);
  }

  function setColonyViewFocus(colonyId, focusBuilding = '', source = 'manual') {
    if (typeof state.setColonyViewFocusCallback === 'function') {
      state.setColonyViewFocusCallback(colonyId, focusBuilding, source);
    }
  }

  function focusColonyDevelopment(colonyId, opts = {}) {
    const colonies = state.getColonies();
    const colony = colonies.find((col) => Number(col.id || 0) === Number(colonyId || 0));
    if (!colony) return;
    const focusBuilding = String(opts.focusBuilding || getRecommendedBuildingFocus(colony));
    setColonyViewFocus(colony.id, focusBuilding, opts.source || 'planet');
    if (typeof state.selectColonyById === 'function') {
      state.selectColonyById(colony.id, {
        openWindows: true,
        focusBuilding,
        openOverview: !!opts.openOverview,
      });
    }
  }

  function openColonySubview(colonyId, view, opts = {}) {
    const colonies = state.getColonies();
    const colony = colonies.find((col) => Number(col.id || 0) === Number(colonyId || 0));
    if (!colony) return false;

    const WM = state.getWm();
    const targetView = String(view || '').toLowerCase();
    const focusBuilding = String(opts.focusBuilding || getRecommendedBuildingFocus(colony));

    if (typeof state.selectColonyById === 'function') {
      state.selectColonyById(colony.id, {
        openWindows: false,
        focusBuilding: targetView === 'buildings' ? focusBuilding : '',
        focusSource: opts.source || 'view-chain',
      });
    }

    if (targetView === 'overview') {
      if (WM) WM.open('overview');
      return true;
    }
    if (targetView === 'colony' || targetView === 'planet') {
      if (WM) WM.open('colony');
      return true;
    }
    if (targetView === 'buildings') {
      if (WM) WM.open('buildings');
      return true;
    }
    if (targetView === 'shipyard' || targetView === 'vessels' || targetView === 'ships') {
      if (WM) WM.open('shipyard');
      if (targetView === 'vessels' || targetView === 'ships') {
        if (typeof state.showToast === 'function') {
          state.showToast('Vessels werden im Shipyard verwaltet.', 'info');
        }
      }
      return true;
    }
    if (targetView === 'orbitals' || targetView === 'orbital-installations') {
      setColonyViewFocus(colony.id, 'solar_satellite', opts.source || 'view-chain');
      if (WM) WM.open('shipyard');
      if (typeof state.showToast === 'function') {
        state.showToast('Orbital-Installationen werden im Shipyard verwaltet.', 'info');
      }
      return true;
    }
    if (targetView === 'wormholes' || targetView === 'gates' || targetView === 'gate-installations') {
      if (WM) WM.open('wormholes');
      return true;
    }
    if (targetView === 'fleet') {
      if (opts.prefillTarget && typeof state.prefillFleetTarget === 'function') {
        state.prefillFleetTarget(opts.prefillTarget, String(opts.mission || 'transport'), {
          owner: opts.owner || '',
          threatLevel: opts.threatLevel || '',
          intel: opts.intel || null,
        });
      } else {
        if (WM) WM.open('fleet');
      }
      return true;
    }

    return false;
  }

  const api = {
    configureColonyBuildingLogicRuntime,
    getBuildingUiMeta,
    getRecommendedBuildingFocus,
    pickZoneBuildFocus,
    setColonyViewFocus,
    focusColonyDevelopment,
    openColonySubview,
    getBuildingUiMetaAll: () => BUILDING_UI_META,
    getBuildingZonePriority: () => BUILDING_ZONE_PRIORITY,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeColonyBuildingLogic = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
