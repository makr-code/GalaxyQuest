'use strict';

(function () {
  function createColonyViewController(opts = {}) {
    const {
      wm = null,
      api = null,
      getCurrentColony = () => null,
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
      esc = (value) => String(value || ''),
      showToast = () => {},
      gameLog = () => {},
    } = opts;

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
          </div>
        </div>
        ${buildingFocus ? `<div class="build-focus-banner">Rasterfokus: ${esc(fmtName(buildingFocus))}${uiState.colonyViewFocus?.source ? ` ┬À Quelle: ${esc(uiState.colonyViewFocus.source)}` : ''}</div>` : ''}
        ${(() => {
          const ev = currentColony.active_event;
          if (!ev) return '';
          const meta = {
            solar_flare: { icon: 'ÔÿÇ´©Å', label: 'Solar Flare', cls: 'event-solar', desc: 'Energy production ÔêÆ30%', duration: 60 },
            mineral_vein: { icon: 'ÔøÅ´©Å', label: 'Mineral Vein', cls: 'event-mineral', desc: 'Metal production +20%', duration: 60 },
            disease: { icon: '­ƒªá', label: 'Disease Outbreak', cls: 'event-disease', desc: 'Happiness ÔêÆ25 (until Hospital Lv3)', duration: 120 },
            archaeological_find: { icon: '­ƒÅ║', label: 'Archaeological Find', cls: 'event-unknown', desc: '+500 Dark Matter discovered', duration: 30 },
          }[ev.type] || { icon: 'ÔÜá´©Å', label: ev.type, cls: 'event-unknown', desc: '', duration: 60 };
          const mins = Number(ev.ends_in_min || 0);
          const timeLeft = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;

          let eventProgressPct = 0;
          let eventTone = 'is-good';
          const eventDurationMins = meta.duration || 60;
          if (mins < eventDurationMins) {
            eventProgressPct = Math.min(100, Math.round((1 - (mins / eventDurationMins)) * 100));
            eventTone = eventProgressPct < 30 ? 'is-good' : (eventProgressPct < 70 ? 'is-warning' : 'is-critical');
          }

          return `<div class="colony-event-banner ${esc(meta.cls)}"><span class="ce-icon">${meta.icon}</span><span class="ce-label"><strong>${esc(meta.label)}</strong> ÔÇö ${esc(meta.desc)}</span><span class="ce-timer">ends in ${esc(timeLeft)}</span>
            <div class="entity-bars" style="margin-top:0.3rem;">
              <div class="entity-bar-row" title="Event progress ${eventProgressPct}%">
                <span class="entity-bar-label" style="font-size:0.75rem;">Prog</span>
                <div class="bar-wrap"><div class="bar-fill bar-integrity ${eventTone}" style="width:${eventProgressPct}%; height:6px;"></div></div>
                <span class="entity-bar-value" style="font-size:0.75rem;">${eventProgressPct}%</span>
              </div>
            </div></div>`;
        })()}
        <div class="colony-capacity-row">${Object.entries(classCaps).map(([key, value]) => `<span class="colony-cap-chip">${esc(buildingZoneLabel(key))}: ${esc(String(value))}</span>`).join('')}</div>
        <div class="colony-grid" style="grid-template-columns:repeat(${grid.cols}, minmax(0, 1fr));">
          ${grid.cells.map((cell) => {
            const building = cell.building;
            const anchor = !!building && cell.fill === 0;
            const focusType = building ? String(building.type || '') : pickZoneBuildFocus(cell.zone, currentColony, buildings);
            return `<button type="button" class="colony-cell colony-zone-${esc(cell.zone)} ${building ? 'occupied' : 'empty'} ${anchor ? 'anchor' : ''} ${buildingFocus && focusType === buildingFocus ? 'colony-cell-focus' : ''}" data-focus-building="${esc(focusType)}" data-cell-zone="${esc(cell.zone)}" data-cell-state="${building ? 'occupied' : 'empty'}" title="${building ? esc(building.meta?.label || fmtName(building.type)) : esc(buildingZoneLabel(cell.zone))}">
              ${building ? `<span class="colony-cell-icon">${esc(building.meta?.icon || '­ƒÅù')}</span><span class="colony-cell-label">${esc(fmtName(building.type))}</span><span class="colony-cell-level">Lv ${esc(String(building.level || 0))}</span>` : `<span class="colony-cell-icon">${esc(getBuildingUiMeta(focusType).icon || '­ƒÅù')}</span><span class="colony-cell-label">${esc(fmtName(focusType))}</span><span class="colony-cell-empty">${esc(buildingZoneLabel(cell.zone))}</span>`}
            </button>`;
          }).join('')}
        </div>
        <div class="colony-orbital-band">
          <h4>Orbital Layer</h4>
          <div class="colony-orbital-list">${orbitalFacilities.length ? orbitalFacilities.map((facility) => `<button type="button" class="colony-orbital-card" data-focus-building="${esc(facility.type || 'solar_satellite')}"><strong>${esc(facility.icon)} ${esc(facility.label)}</strong><span>Lv ${esc(String(facility.level || 0))}</span></button>`).join('') : '<p class="text-muted">No orbital facilities online.</p>'}</div>
        </div>`;
      },

      bindActions(root) {
        const currentColony = getCurrentColony();
        root.querySelector('#colony-open-buildings-btn')?.addEventListener('click', () => wm.open('buildings'));
        root.querySelector('#colony-open-shipyard-btn')?.addEventListener('click', () => wm.open('shipyard'));
        root.querySelectorAll('[data-focus-building]').forEach((el) => {
          el.addEventListener('click', () => {
            const focusBuilding = String(el.getAttribute('data-focus-building') || getRecommendedBuildingFocus(currentColony));
            const cellState = String(el.getAttribute('data-cell-state') || 'occupied');
            const cellZone = String(el.getAttribute('data-cell-zone') || 'flex');
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