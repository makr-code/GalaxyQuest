'use strict';

(function () {
  const COLONY_ZONES = new Set(['industrial', 'utility', 'civic', 'science', 'military', 'orbital', 'flex']);
  const EVENT_META = {
    solar_flare: { icon: 'ÔÿÇ´©Å', label: 'Solar Flare', cls: 'event-solar', desc: 'Energy production ÔêÆ30%' },
    mineral_vein: { icon: 'ÔøÅ´©Å', label: 'Mineral Vein', cls: 'event-mineral', desc: 'Metal production +20%' },
    disease: { icon: '­ƒªá', label: 'Disease Outbreak', cls: 'event-disease', desc: 'Happiness ÔêÆ25 (until Hospital Lv3)' },
    archaeological_find: { icon: '­ƒÅ║', label: 'Archaeological Find', cls: 'event-unknown', desc: '+500 Dark Matter discovered' },
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeZone(value) {
    const zone = String(value || '');
    return COLONY_ZONES.has(zone) ? zone : 'flex';
  }

  function safeBuildingType(value) {
    const type = String(value || '');
    return /^[a-z][a-z0-9_]*$/.test(type) ? type : 'colony_hq';
  }

  function createColonyViewController(opts = {}) {
    const {
      wm = null,
      api = null,
      getCurrentColony = () => null,
      getColonies = () => [],
      getGalaxy3d = () => null,
      getUiState = () => ({}),
      buildColonyGridCells = () => ({ cols: 1, cells: [] }),
      buildingZoneLabel = (value) => String(value || ''),
      pickZoneBuildFocus = () => 'metal_mine',
      getBuildingUiMeta = () => ({ icon: '🏗' }),
      getRecommendedBuildingFocus = () => 'metal_mine',
      selectColonyById = () => {},
      focusColonyDevelopment = () => {},
      queueColonySurfaceSceneData = () => {},
      fmtName = (value) => String(value || ''),
      showToast = () => {},
      gameLog = () => {},
    } = opts;
    const esc = escapeHtml;

    function colonyDistance(a, b) {
      const ga = Number(a?.galaxy || 0);
      const gb = Number(b?.galaxy || 0);
      const sa = Number(a?.system || 0);
      const sb = Number(b?.system || 0);
      const pa = Number(a?.position || 0);
      const pb = Number(b?.position || 0);

      // Weighted discrete distance keeps same-system neighbors closest.
      return Math.abs(ga - gb) * 10000 + Math.abs(sa - sb) * 100 + Math.abs(pa - pb);
    }

    function colonyDistText(d) {
      if (d < 100) return `\u0394${d}`;
      if (d < 10000) return `${Math.floor(d / 100)} Sys`;
      return `${Math.floor(d / 10000)} Gal`;
    }

    function collectNearestColonyNeighbors(currentColony) {
      if (!currentColony) return [];

      return (Array.isArray(getColonies()) ? getColonies() : [])
        .filter((col) => Number(col?.id || 0) > 0 && Number(col.id || 0) !== Number(currentColony.id || 0))
        .map((col) => ({
          colony: col,
          distance: colonyDistance(currentColony, col),
          label: `${fmtName(col?.name || `Kolonie ${Number(col?.id || 0)}`)} · G${Number(col?.galaxy || 0)}:${Number(col?.system || 0)}:${Number(col?.position || 0)}`,
          distText: colonyDistText(colonyDistance(currentColony, col)),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);
    }

    return {
      buildViewHtml(data) {
        const currentColony = getCurrentColony();
        const uiState = getUiState();
        const layout = data.layout || currentColony.layout || null;
        const buildings = data.buildings || [];
        const orbitalFacilities = data.orbital_facilities || [];
        const grid = buildColonyGridCells(layout, buildings);
        const classCaps = layout?.class_caps || {};
        const buildingFocus = uiState.colonyViewFocus && Number(uiState.colonyViewFocus.colonyId) === Number(currentColony.id)
          ? String(uiState.colonyViewFocus.focusBuilding || '')
          : '';

        return `
        <div class="colony-view-head">
          <div>
            <h3>${esc(currentColony.name)}</h3>
            <div class="colony-view-meta">${esc(fmtName(currentColony.planet_class || currentColony.planet_type || 'planet'))} ┬À ${esc(String(currentColony.diameter || layout?.planet_scale?.diameter || 0))} km ┬À ${esc(layout?.planet_scale?.tier || 'standard')}</div>
          </div>
          <div class="colony-view-actions">
            <button class="btn btn-secondary btn-sm" id="colony-open-buildings-btn">Buildings</button>
            <button class="btn btn-secondary btn-sm" id="colony-open-shipyard-btn">Shipyard</button>
            <button class="btn btn-secondary btn-sm" id="colony-open-surface-btn">3D city</button>
          </div>
        </div>
        ${buildingFocus ? `<div class="build-focus-banner">Rasterfokus: ${esc(fmtName(buildingFocus))}${uiState.colonyViewFocus?.source ? ` ┬À Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>` : ''}
        ${(() => {
          const ev = currentColony.active_event;
          if (!ev) return '';
          const meta = Object.hasOwn(EVENT_META, ev.type)
            ? EVENT_META[ev.type]
            : { icon: 'ÔÜá´©Å', label: ev.type, cls: 'event-unknown', desc: '' };
          const rawMins = ev.ends_in_min;
          const parsedMins = rawMins === null || rawMins === undefined || rawMins === ''
            ? NaN
            : Number(rawMins);
          const mins = Number.isFinite(parsedMins) && parsedMins >= 0 ? parsedMins : null;
          const timeLeft = mins === null
            ? 'time unavailable'
            : (mins >= 60 ? `${Math.floor(mins / 60)}h ${Math.floor(mins % 60)}m` : `${Math.floor(mins)}m`);

          const startedAt = Date.parse(ev.started_at || '');
          const expiresAt = Date.parse(ev.expires_at || '');
          const eventDurationMins = (expiresAt - startedAt) / 60000;
          const eventProgressPct = mins !== null
            && Number.isFinite(eventDurationMins)
            && eventDurationMins > 0
            ? Math.min(100, Math.max(0, Math.round((1 - (mins / eventDurationMins)) * 100)))
            : null;
          const eventTone = eventProgressPct === null
            ? ''
            : (eventProgressPct < 30 ? 'is-good' : (eventProgressPct < 70 ? 'is-warning' : 'is-critical'));
          const eventProgressHtml = eventProgressPct === null ? '' : `
            <div class="entity-bars" style="margin-top:0.3rem;">
              <div class="entity-bar-row" title="Event elapsed ${eventProgressPct}%">
                <span class="entity-bar-label" style="font-size:0.75rem;">Elapsed</span>
                <div class="bar-wrap"><div class="bar-fill bar-integrity ${eventTone}" style="width:${eventProgressPct}%; height:6px;"></div></div>
                <span class="entity-bar-value" style="font-size:0.75rem;">${eventProgressPct}%</span>
              </div>
            </div>`;

          return `<div class="colony-event-banner ${esc(meta.cls)}"><span class="ce-icon">${meta.icon}</span><span class="ce-label"><strong>${esc(meta.label)}</strong> ÔÇö ${esc(meta.desc)}</span><span class="ce-timer">ends in ${esc(timeLeft)}</span>${eventProgressHtml}</div>`;
        })()}
        <div class="colony-capacity-row">${Object.entries(classCaps).map(([key, value]) => `<span class="colony-cap-chip">${esc(buildingZoneLabel(key))}: ${esc(String(value))}</span>`).join('')}</div>
        <div class="colony-grid" style="grid-template-columns:repeat(${Number.isSafeInteger(Number(grid.cols)) && Number(grid.cols) > 0 && Number(grid.cols) <= 12 ? Number(grid.cols) : 1}, minmax(0, 1fr));">
          ${grid.cells.map((cell) => {
            const building = cell.building;
            const anchor = !!building && cell.fill === 0;
            const zone = safeZone(cell.zone);
            const focusType = safeBuildingType(building ? building.type : pickZoneBuildFocus(zone, currentColony, buildings));
            return `<button type="button" class="colony-cell colony-zone-${zone} ${building ? 'occupied' : 'empty'} ${anchor ? 'anchor' : ''} ${buildingFocus && focusType === buildingFocus ? 'colony-cell-focus' : ''}" data-focus-building="${focusType}" data-cell-zone="${zone}" data-cell-state="${building ? 'occupied' : 'empty'}" title="${building ? esc(building.meta?.label || fmtName(building.type)) : esc(buildingZoneLabel(zone))}">
              ${building ? `<span class="colony-cell-icon">${esc(building.meta?.icon || '­ƒÅù')}</span><span class="colony-cell-label">${esc(fmtName(building.type))}</span><span class="colony-cell-level">Lv ${esc(String(building.level || 0))}</span>` : `<span class="colony-cell-icon">${esc(getBuildingUiMeta(focusType).icon || '­ƒÅù')}</span><span class="colony-cell-label">${esc(fmtName(focusType))}</span><span class="colony-cell-empty">${esc(buildingZoneLabel(cell.zone))}</span>`}
            </button>`;
          }).join('')}
        </div>
        <div class="colony-orbital-band">
          <h4>Orbital Layer</h4>
          <div class="colony-orbital-list">${orbitalFacilities.length ? orbitalFacilities.map((facility) => `<button type="button" class="colony-orbital-card" data-focus-building="${safeBuildingType(facility.type || 'solar_satellite')}"><strong>${esc(facility.icon)} ${esc(facility.label)}</strong><span>Lv ${esc(String(facility.level || 0))}</span></button>`).join('') : '<p class="text-muted">No orbital facilities online.</p>'}</div>
        </div>`;
      },

      bindActions(root) {
        const currentColony = getCurrentColony();
        root.querySelector('#colony-open-buildings-btn')?.addEventListener('click', () => wm.open('buildings'));
        root.querySelector('#colony-open-shipyard-btn')?.addEventListener('click', () => wm.open('shipyard'));
        root.querySelector('#colony-open-surface-btn')?.addEventListener('click', async () => {
          const orchestrator = window.__GQ_ZOOM_ORCHESTRATOR;
          const level = window.GQSeamlessZoomOrchestrator?.ZOOM_LEVEL?.COLONY_SURFACE;
          const mapper = window.GQRuntimeColonySurfaceSlotMapping;
          if (!orchestrator || level == null || !mapper) {
            showToast('Open the galaxy view to initialize the shared WebGPU renderer first.', 'info');
            wm.open('galaxy');
            return;
          }
          if (orchestrator._backend?.backendType !== 'webgpu') {
            showToast('The 3D city requires the native shared WebGPU renderer.', 'info');
            return;
          }
          try {
            const data = await api.buildings(currentColony.id);
            if (!data.success) throw new Error('Building snapshot unavailable');
            const mapped = mapper.buildColonySurfaceVfxSlots(currentColony, data);
            wm.open('galaxy');
            await orchestrator.zoomTo(level, {
              colony: currentColony, layout: data.layout, slots: mapped.slots,
              onOpenBuildings: () => {
                selectColonyById(currentColony.id, { openWindows: false });
                wm.open('buildings');
              },
            });
          } catch (error) {
            gameLog('warn', 'Colony surface failed', error);
            showToast('Could not open the colony surface.', 'error');
          }
        });

        const overlay = typeof window?.GQNeighborWaypointOverlay?.getOverlay === 'function'
          ? window.GQNeighborWaypointOverlay.getOverlay() : null;
        const galaxy3d = getGalaxy3d();
        const neighbors = collectNearestColonyNeighbors(currentColony);
        const canvas3d = galaxy3d?.renderer?.domElement || null;

        if (overlay && canvas3d) {
          overlay.mount(canvas3d, getGalaxy3d);
          if (galaxy3d?.systemMode && neighbors.length) {
            overlay.setColonyNeighbors(currentColony, neighbors, (entry) => {
              const targetId = Number(entry?.colony?.id || 0);
              if (!targetId) return;
              selectColonyById(targetId, { openWindows: false });
              showToast('Kolonie gewechselt.', 'info');
            });
          } else {
            overlay.clear();
          }
        }

        root.addEventListener('keydown', (e) => {
          const tag = String(e.target?.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
          const rank = Number(e.key);
          if (rank < 1 || rank > 3) return;
          if (!overlay) return;
          e.preventDefault();
          overlay.activate(rank);
        });

        root.querySelectorAll('[data-focus-building]').forEach((el) => {
          el.addEventListener('click', () => {
            const focusBuilding = safeBuildingType(el.getAttribute('data-focus-building') || getRecommendedBuildingFocus(currentColony));
            const cellState = String(el.getAttribute('data-cell-state') || 'occupied');
            const cellZone = safeZone(el.getAttribute('data-cell-zone'));
            if (focusBuilding === 'solar_satellite') {
              selectColonyById(currentColony.id, { openWindows: false });
              wm.open('shipyard');
              showToast('Orbitalenergie wird im Shipyard verwaltet.', 'info');
              return;
            }
            focusColonyDevelopment(currentColony.id, {
              source: cellState === 'empty' ? `colony-zone:${cellZone}` : 'colony-grid',
              focusBuilding,
            });
            if (cellState === 'empty') {
              showToast(`Zone ${buildingZoneLabel(cellZone)}: Fokus auf ${fmtName(focusBuilding)}.`, 'info');
            }
          });
        });
      },

      async render() {
        const root = wm.body('colony');
        if (!root) return;
        const currentColony = getCurrentColony();
        if (!currentColony) {
          const overlay = typeof window?.GQNeighborWaypointOverlay?.getOverlay === 'function'
            ? window.GQNeighborWaypointOverlay.getOverlay() : null;
          if (overlay) overlay.clear();
          root.innerHTML = '<p class="text-muted">Select a colony first.</p>';
          return;
        }
        root.innerHTML = '<p class="text-muted">Loading colony viewÔÇª</p>';

        try {
          const data = await api.buildings(currentColony.id);
          if (!data.success) {
            root.innerHTML = '<p class="text-red">Failed to load colony view.</p>';
            return;
          }
          queueColonySurfaceSceneData(currentColony, data);
          root.innerHTML = this.buildViewHtml(data);
          this.bindActions(root);
          // Bind View Hyperlinks for navigation
          const ViewHyperlinks = window.GQRuntimeViewHyperlinks?.ViewHyperlinks;
          if (ViewHyperlinks) ViewHyperlinks.bindAll(root);
        } catch (err) {
          gameLog('warn', 'Colony view render fehlgeschlagen', err);
          root.innerHTML = '<p class="text-red">Failed to render colony view.</p>';
        }
      },
    };
  }

  const api = { createColonyViewController };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.GQRuntimeColonyViewController = api;
  }
})();