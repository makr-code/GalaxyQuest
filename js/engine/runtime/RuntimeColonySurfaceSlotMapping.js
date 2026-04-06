/**
 * RuntimeColonySurfaceSlotMapping.js
 *
 * Colony surface grid mapping and VFX slot payload helpers.
 */

'use strict';

(function () {
  const state = {
    fmtName: null,
    getSettingsState: null,
    getZoomTransitionContext: null,
    windowRef: null,
  };

  function configureColonySurfaceSlotMappingRuntime(opts = {}) {
    state.fmtName = typeof opts.fmtName === 'function' ? opts.fmtName : ((value) => String(value || ''));
    state.getSettingsState = typeof opts.getSettingsState === 'function' ? opts.getSettingsState : (() => null);
    state.getZoomTransitionContext = typeof opts.getZoomTransitionContext === 'function' ? opts.getZoomTransitionContext : (() => null);
    state.windowRef = opts.windowRef || window;
  }

  function buildingZoneLabel(zone) {
    return {
      industrial: 'Industry',
      utility: 'Utility',
      civic: 'Civic',
      science: 'Science',
      military: 'Defense',
      orbital: 'Orbital',
      flex: 'Flexible',
    }[String(zone || '')] || state.fmtName(String(zone || 'flex'));
  }

  function buildColonyGridCells(layout, buildings) {
    const cols = Number(layout?.grid?.cols || 6);
    const rows = Number(layout?.grid?.rows || 4);
    const surfaceSlots = cols * rows;
    const caps = Object.assign({}, layout?.class_caps || {});
    const zones = [];
    const order = ['industrial', 'utility', 'civic', 'science', 'military', 'flex'];
    order.forEach((zone) => {
      const count = Math.max(0, Number(caps[zone] || 0));
      for (let index = 0; index < count; index++) zones.push(zone);
    });
    while (zones.length < surfaceSlots) zones.push('flex');
    zones.length = surfaceSlots;

    const cells = zones.map((zone, index) => ({ index, zone, building: null, fill: 0, locked: false }));
    const sortedBuildings = (buildings || []).filter((b) => (b.meta?.zone || 'surface') === 'surface')
      .slice()
      .sort((a, b) => Number(b.meta?.footprint || 1) - Number(a.meta?.footprint || 1));

    for (const building of sortedBuildings) {
      const footprint = Math.max(1, Number(building.meta?.footprint || 1));
      const zone = String(building.meta?.class_key || 'flex');
      let anchor = cells.findIndex((cell, idx) => {
        if (cell.building || cell.locked) return false;
        if (cell.zone !== zone && cell.zone !== 'flex') return false;
        for (let offset = 0; offset < footprint; offset++) {
          const next = cells[idx + offset];
          if (!next || next.building || next.locked) return false;
          if (offset > 0 && Math.floor((idx + offset) / cols) !== Math.floor(idx / cols)) return false;
        }
        return true;
      });
      if (anchor < 0) {
        anchor = cells.findIndex((cell, idx) => {
          if (cell.building || cell.locked) return false;
          for (let offset = 0; offset < footprint; offset++) {
            const next = cells[idx + offset];
            if (!next || next.building || next.locked) return false;
            if (offset > 0 && Math.floor((idx + offset) / cols) !== Math.floor(idx / cols)) return false;
          }
          return true;
        });
      }
      if (anchor < 0) continue;
      for (let offset = 0; offset < footprint; offset++) {
        const cell = cells[anchor + offset];
        cell.building = building;
        cell.fill = offset;
      }
    }
    return { cols, rows, cells };
  }

  function mapBuildingToVfxProfile(building) {
    const type = String(building?.type || '').toLowerCase();
    const category = String(building?.meta?.cat || '').toLowerCase();
    const busy = !!building?.upgrade_end;
    if (busy) return { profile: 'construction', intensity: 1.4 };
    if (/mine|refinery|factory|forge|smelter/.test(type) || /industry|extraction/.test(category)) {
      return { profile: 'industry', intensity: 1.2 };
    }
    if (/reactor|fusion|power|energy/.test(type) || /energy/.test(category)) {
      return { profile: 'power', intensity: 1.06 };
    }
    if (/lab|research|academy|science/.test(type) || /science/.test(category)) {
      return { profile: 'research', intensity: 0.96 };
    }
    if (/storage|habitat|residential|housing/.test(type)) {
      return { profile: 'quiet', intensity: 0.78 };
    }
    return { profile: '', intensity: 1.0 };
  }

  function buildColonySurfaceVfxSlots(colony, buildingPayload) {
    const buildings = Array.isArray(buildingPayload?.buildings) ? buildingPayload.buildings : [];
    const layout = buildingPayload?.layout || colony?.layout || null;
    const grid = buildColonyGridCells(layout, buildings);
    const cols = Math.max(1, Number(grid?.cols || 6));
    const rows = Math.max(1, Number(grid?.rows || 4));
    const spacing = 3.1;
    const offsetX = ((cols - 1) * spacing) * 0.5;
    const offsetZ = ((rows - 1) * spacing) * 0.5;

    const slots = [];
    const profileCounts = {};
    (grid?.cells || []).forEach((cell) => {
      if (!cell?.building || Number(cell.fill || 0) !== 0) return;
      const building = cell.building;
      const idx = Number(cell.index || 0);
      const gx = idx % cols;
      const gz = Math.floor(idx / cols);
      const mapped = mapBuildingToVfxProfile(building);
      const profileName = String(mapped.profile || 'auto');
      profileCounts[profileName] = (profileCounts[profileName] || 0) + 1;
      slots.push({
        x: gx * spacing - offsetX,
        y: 0,
        z: gz * spacing - offsetZ,
        type: String(building.type || ''),
        category: String(building.meta?.cat || ''),
        owner_color: String(colony?.owner_color || colony?.colony_owner_color || colony?.faction_color || ''),
        upgrade_end: building.upgrade_end || null,
        vfx_profile: mapped.profile,
        vfx_intensity: mapped.intensity,
      });
    });
    return {
      slots,
      stats: {
        mappedSlots: slots.length,
        profileCounts,
      },
    };
  }

  function queueColonySurfaceSceneData(colony, buildingPayload) {
    const ctx = state.getZoomTransitionContext?.();
    const colonyLevel = Number(ctx?.ZOOM_LEVEL?.COLONY_SURFACE);
    if (!ctx?.orchestrator || !Number.isFinite(colonyLevel) || typeof ctx.orchestrator.setSceneData !== 'function') {
      return;
    }
    const mapped = buildColonySurfaceVfxSlots(colony, buildingPayload);
    const slots = Array.isArray(mapped?.slots) ? mapped.slots : [];
    const settingsState = state.getSettingsState?.();
    const payload = {
      colony: colony || null,
      layout: buildingPayload?.layout || colony?.layout || null,
      slots,
      vfx_quality: String(settingsState?.renderQualityProfile === 'webgpu' ? 'high' : 'medium'),
      vfx_mapper_stats: mapped?.stats || null,
    };
    if (state.windowRef) {
      state.windowRef.__GQ_COLONY_VFX_MAPPER = Object.assign({}, mapped?.stats || {}, { ts: Date.now() });
    }
    Promise.resolve(ctx.orchestrator.setSceneData(colonyLevel, payload)).catch(() => {});
  }

  const api = {
    configureColonySurfaceSlotMappingRuntime,
    buildingZoneLabel,
    buildColonyGridCells,
    mapBuildingToVfxProfile,
    buildColonySurfaceVfxSlots,
    queueColonySurfaceSceneData,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeColonySurfaceSlotMapping = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();