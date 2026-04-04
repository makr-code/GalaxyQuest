(function (global) {
  'use strict';

  function createGalaxySystemDetailsFacade(options = {}) {
    const esc = typeof options.esc === 'function' ? options.esc : (value) => String(value || '');
    const settingsState = options.settingsState || {};
    const getGalaxy3d = typeof options.getGalaxy3d === 'function' ? options.getGalaxy3d : () => null;
    const getWindowRef = typeof options.getWindowRef === 'function' ? options.getWindowRef : () => global;
    const triggerGalaxyNavAction = typeof options.triggerGalaxyNavAction === 'function' ? options.triggerGalaxyNavAction : function () {};
    const applyClusterRangeToControls = typeof options.applyClusterRangeToControls === 'function' ? options.applyClusterRangeToControls : () => null;
    const flashGalaxyControlBtn = typeof options.flashGalaxyControlBtn === 'function' ? options.flashGalaxyControlBtn : function () {};
    const loadGalaxyStars3D = typeof options.loadGalaxyStars3D === 'function' ? options.loadGalaxyStars3D : async function () {};
    const isFavoriteStar = typeof options.isFavoriteStar === 'function' ? options.isFavoriteStar : () => false;
    const addFavorite = typeof options.addFavorite === 'function' ? options.addFavorite : function () {};
    const removeFavorite = typeof options.removeFavorite === 'function' ? options.removeFavorite : function () {};
    const showToast = typeof options.showToast === 'function' ? options.showToast : function () {};
    const updateFooterQuickNavBadge = typeof options.updateFooterQuickNavBadge === 'function' ? options.updateFooterQuickNavBadge : function () {};
    const refreshWindow = typeof options.refreshWindow === 'function' ? options.refreshWindow : function () {};
    const prefillFleetTarget = typeof options.prefillFleetTarget === 'function' ? options.prefillFleetTarget : function () {};
    const getUiState = typeof options.getUiState === 'function' ? options.getUiState : () => ({});
    const getColonies = typeof options.getColonies === 'function' ? options.getColonies : () => [];
    const openColonySubview = typeof options.openColonySubview === 'function' ? options.openColonySubview : function () {};
    const isCurrentUserAdmin = typeof options.isCurrentUserAdmin === 'function' ? options.isCurrentUserAdmin : () => false;
    const rerenderSystemDetails = typeof options.rerenderSystemDetails === 'function' ? options.rerenderSystemDetails : function () {};
    const isSystemModeActive = typeof options.isSystemModeActive === 'function' ? options.isSystemModeActive : () => false;

    function renderGalaxySystemDetails(root, star, zoomed) {
      const details = root.querySelector('#galaxy-system-details');
      if (!details) return;

      const formatColonyPopulation = (value) => {
        const population = Math.max(0, Number(value || 0));
        if (!population) return '0';
        return population.toLocaleString('de-DE');
      };

      const getColonyMarkerMeta = (target) => {
        const colonyCount = Math.max(0, Number(target?.colony_count || 0));
        if (colonyCount <= 0) return null;
        const colonyPopulation = Math.max(0, Number(target?.colony_population || 0));
        const colonyColor = String(target?.colony_owner_color || target?.owner_color || target?.faction_color || '#7db7ee');
        const ownerName = String(target?.colony_owner_name || target?.owner || '').trim();
        const isPlayer = Number(target?.colony_is_player || 0) === 1;
        const countStrength = colonyCount > 0 ? Math.max(0, Math.min(1, (Math.log2(colonyCount + 1) - 0.3) / 3.2)) : 0;
        const popStrength = colonyPopulation > 0 ? Math.max(0, Math.min(1, (Math.log10(colonyPopulation + 1) - 2.2) / 3.0)) : 0;
        const strength = Math.max(countStrength, popStrength);
        let label = 'Aussenposten';
        if (strength >= 0.75) label = 'Kernwelt';
        else if (strength >= 0.4) label = 'Kolonie';
        return {
          count: colonyCount,
          population: colonyPopulation,
          populationFull: formatColonyPopulation(colonyPopulation),
          color: colonyColor,
          label: isPlayer ? `Eigene ${label}` : label,
          ownerName,
          isPlayer,
        };
      };

      const galaxy3d = getGalaxy3d();
      const windowRef = getWindowRef();
      const uiState = getUiState();
      const colonies = getColonies();

      const followEnabled = !galaxy3d || typeof galaxy3d.isFollowingSelection !== 'function'
        ? true
        : galaxy3d.isFollowingSelection();

      const quickNavActions = [
        { action: 'home', label: 'Home', title: 'Jump to home system' },
        { action: 'zoom-in', label: '+', title: 'Zoom in' },
        { action: 'zoom-out', label: '-', title: 'Zoom out' },
        { action: 'rotate-left', label: 'Left', title: 'Rotate left' },
        { action: 'rotate-right', label: 'Right', title: 'Rotate right' },
        { action: 'rotate-up', label: 'Up', title: 'Rotate up' },
        { action: 'rotate-down', label: 'Down', title: 'Rotate down' },
        { action: 'focus', label: 'Focus', title: 'Focus selection' },
      ];

      if (star && !zoomed) {
        quickNavActions.unshift({ action: 'enter-system', label: 'System', title: 'Enter selected system', className: 'galaxy-detail-nav-btn-mode' });
      }
      if (star && zoomed) {
        quickNavActions.unshift({ action: 'exit-system', label: 'Galaxie', title: 'Return to galaxy view', className: 'galaxy-detail-nav-btn-mode' });
      }
      quickNavActions.push({ action: 'reset', label: 'Reset', title: 'Reset', className: 'galaxy-detail-nav-btn-reset' });

      const navButtons = `
      <div class="galaxy-detail-nav" aria-label="Schnellnavigation 3D">
        ${quickNavActions.map((entry) => `<button type="button" class="galaxy-detail-nav-btn ${esc(entry.className || '')}" data-nav-action="${esc(entry.action)}" title="${esc(entry.title)}">${esc(entry.label)}</button>`).join('')}
      </div>`;

      const fleetVectorsOn = settingsState.galaxyFleetVectorsVisible !== false;
      const visibleFleetCount = zoomed
        ? Number(galaxy3d?.systemFleetEntries?.length || 0)
        : Number(galaxy3d?.galaxyFleetEntries?.length || (windowRef._GQ_fleets || []).length || 0);
      const showFleetLegend = visibleFleetCount > 0;

      const fleetLegendBodyHtml = !showFleetLegend
        ? ''
        : (fleetVectorsOn
          ? (zoomed
            ? `
        <div class="galaxy-fleet-legend-title">Fleet-Richtungsfarben (kompakt)</div>
        <div class="galaxy-fleet-legend-row galaxy-fleet-legend-row-compact">
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#ff4d3d"></span>Angriff
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#41d1ff"></span>Spionage
        </div>
        <div class="galaxy-fleet-legend-row galaxy-fleet-legend-row-compact">
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#86ff66"></span>Transport
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#5cf2a5"></span>Kolonisieren
          <span class="galaxy-fleet-legend-line" style="--fleet-color:#ffd15c"></span>Ernten
        </div>
      `
            : `
        <div class="galaxy-fleet-legend-title">Fleet-Richtungsfarben</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#ff4d3d"></span>Angriff</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#41d1ff"></span>Spionage</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#86ff66"></span>Transport</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#5cf2a5"></span>Kolonisieren</div>
        <div class="galaxy-fleet-legend-row"><span class="galaxy-fleet-legend-line" style="--fleet-color:#ffd15c"></span>Ernten</div>
      `)
          : `
        <div class="galaxy-fleet-legend-title">Fleet-Richtungsfarben</div>
        <div class="galaxy-fleet-legend-row text-muted">In Settings deaktiviert (Galaxy: Fleet-Marker und Fluglinien anzeigen).</div>
      `);

      const fleetLegendHtml = `
      <div class="galaxy-fleet-legend ${showFleetLegend ? 'is-visible' : 'is-hidden'}" aria-label="Fleet-Richtungsfarben" aria-hidden="${showFleetLegend ? 'false' : 'true'}">
        ${fleetLegendBodyHtml}
      </div>`;

      if (!star) {
        details.innerHTML = `${navButtons}<span class="text-muted">Press I for this overlay. Camera: mouse drag + wheel, keyboard WASD/QE + arrows, F fit, R reset, L follow ${followEnabled ? 'off' : 'on'}.</span>${fleetLegendHtml}`;
        details.querySelectorAll('[data-nav-action]').forEach((button) => {
          button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
        });
        return;
      }

      if (star.__kind === 'cluster') {
        const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
        const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
        const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
        const factionName = star?.faction?.name ? ` | ${esc(star.faction.name)}` : '';
        details.innerHTML = `
        <div class="system-card">
          <div class="system-title">${esc(star.label || `Cluster ${Number(star.__clusterIndex || 0) + 1}`)}</div>
          ${navButtons}
          <div class="system-row">Clusterbereich: ${esc(String(from || '?'))} - ${esc(String(to || '?'))}${factionName}</div>
          <div class="system-row">Bounding Box: ${Number(star.__clusterSize?.x || 0).toFixed(1)} x ${Number(star.__clusterSize?.y || 0).toFixed(1)} x ${Number(star.__clusterSize?.z || 0).toFixed(1)}</div>
          <div class="system-row">Center: ${Number(star.__clusterCenter?.x || 0).toFixed(1)}, ${Number(star.__clusterCenter?.y || 0).toFixed(1)}, ${Number(star.__clusterCenter?.z || 0).toFixed(1)}</div>
          <div class="system-row">Cluster gebunden, rotiert mit der Sternwolke und ist per Mouse hover-/selektierbar.</div>
          <div class="system-row">Klick fokussiert die Box, Doppelklick zoomt clusterweise hinein.</div>
          ${fleetLegendHtml}
          <div class="system-row" style="margin-top:0.45rem;">
            <button id="gal-load-cluster-range-btn" type="button" class="btn btn-secondary btn-sm">Cluster-Range laden</button>
          </div>
        </div>`;
        details.querySelectorAll('[data-nav-action]').forEach((button) => {
          button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
        });
        details.querySelector('#gal-load-cluster-range-btn')?.addEventListener('click', async () => {
          const range = applyClusterRangeToControls(root, star, { toast: true });
          if (!range) return;
          flashGalaxyControlBtn(root, '#gal-cluster-bounds-btn');
          flashGalaxyControlBtn(root, '#gal-density-metrics');
          await loadGalaxyStars3D(root);
        });
        return;
      }

      const countRaw = Number(star.planet_count);
      const hasKnownPlanetCount = Number.isFinite(countRaw) && countRaw > 0;
      const planetCountHtml = hasKnownPlanetCount
        ? String(Math.round(countRaw))
        : '<span class="text-muted" title="legacy cache/no count">n/a</span>';
      const isFav = isFavoriteStar(star);
      const colonyMeta = getColonyMarkerMeta(star);
      const colonyHtml = colonyMeta
        ? `<div class="system-row system-row-colony"><span class="system-colony-swatch" style="background:${esc(colonyMeta.color)};box-shadow:0 0 10px ${esc(colonyMeta.color)};"></span>${esc(colonyMeta.label)} | ${esc(String(colonyMeta.count))} Kolonien | Bevoelkerung ${esc(colonyMeta.populationFull)}${colonyMeta.ownerName ? ` | ${esc(colonyMeta.isPlayer ? 'Dominanz: Du' : `Dominanz: ${colonyMeta.ownerName}`)}` : ''}</div>`
        : '<div class="system-row text-muted">Keine bekannten Kolonien in diesem System.</div>';
      const scientificScaleEnabled = galaxy3d?.getRenderStats?.()?.scientificScaleEnabled === true;
      const scaleButtonHtml = zoomed ? `<button type="button" class="btn btn-secondary btn-sm${scientificScaleEnabled ? ' active' : ''}" data-system-action="scientific-scale" title="Toggle between game scale and scientific proportions">${scientificScaleEnabled ? 'Spielmodus' : 'Wissenschaft'}</button>` : '';
      const systemActionHtml = `
      <div class="system-row" style="margin-top:0.42rem; display:flex; gap:0.36rem; flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" data-system-action="enter-system">Planet View</button>
        <button type="button" class="btn btn-secondary btn-sm" data-system-action="fleet">Fleet</button>
        <button type="button" class="btn btn-secondary btn-sm" data-system-action="gates">Gate Installations</button>
        ${scaleButtonHtml}
      </div>`;

      const fowLevel = isCurrentUserAdmin() ? 'own' : (star.visibility_level || 'unknown');
      const fowLabels = { own: 'Eigene Kolonie', active: 'Flotte aktiv', stale: 'Veraltete Aufklaerung', unknown: 'Unerforscht' };
      const fowHtml = `<div class="system-row ${fowLevel === 'unknown' ? 'fow-unknown-badge' : ''}" style="${fowLevel === 'stale' ? 'color:#e8c843' : ''}">${esc(fowLabels[fowLevel] || fowLevel)}</div>`;

      details.innerHTML = `
      <div class="system-card">
        <div class="system-title">${esc(star.name)}</div>
        ${navButtons}
        <div class="system-row">Catalog: ${esc(star.catalog_name || '-')}</div>
        <div class="system-row">Galaxy/System: ${star.galaxy_index}:${star.system_index}</div>
        <div class="system-row">Class: ${esc(star.spectral_class)}${esc(String(star.subtype ?? ''))}</div>
        <div class="system-row">Coordinates: ${Number(star.x_ly || 0).toFixed(0)}, ${Number(star.y_ly || 0).toFixed(0)}, ${Number(star.z_ly || 0).toFixed(0)} ly</div>
        <div class="system-row">Habitable Zone: ${Number(star.hz_inner_au || 0).toFixed(2)} - ${Number(star.hz_outer_au || 0).toFixed(2)} AU</div>
        <div class="system-row">Planets: ${planetCountHtml}</div>
        ${colonyHtml}
        ${fowHtml}
        <div class="system-row">Selection Follow: ${followEnabled ? 'locked' : 'free'} (L)</div>
        <div class="system-row">${zoomed ? 'System view active. Esc/F/R returns to galaxy overview.' : 'Double click to zoom into the system and show planets.'}</div>
        ${systemActionHtml}
        ${fleetLegendHtml}
        <div class="system-row" style="margin-top:0.4rem">
          <button id="gal-quicknav-fav-btn" type="button" class="btn btn-secondary btn-sm${isFav ? ' active' : ''}">${isFav ? 'Favorit entfernen' : 'Favorit hinzufuegen'}</button>
        </div>
      </div>`;

      details.querySelectorAll('[data-nav-action]').forEach((button) => {
        button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
      });

      details.querySelector('#gal-quicknav-fav-btn')?.addEventListener('click', () => {
        const btn = details.querySelector('#gal-quicknav-fav-btn');
        if (isFavoriteStar(star)) {
          removeFavorite(`${Number(star.galaxy_index)}:${Number(star.system_index)}`);
          if (btn) {
            btn.textContent = 'Favorit hinzufuegen';
            btn.classList.remove('active');
          }
          showToast(`${star.name} aus Favoriten entfernt.`, 'info');
        } else {
          addFavorite(star);
          if (btn) {
            btn.textContent = 'Favorit entfernen';
            btn.classList.add('active');
          }
          showToast(`${star.name} als Favorit gespeichert.`, 'success');
        }
        updateFooterQuickNavBadge();
        refreshWindow('quicknav');
      });

      details.querySelectorAll('[data-system-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = String(button.getAttribute('data-system-action') || '').toLowerCase();
          if (action === 'enter-system') {
            if (zoomed) return;
            triggerGalaxyNavAction('enter-system', root);
            return;
          }
          if (action === 'fleet') {
            prefillFleetTarget({
              galaxy: Number(star.galaxy_index || uiState.activeGalaxy || 1),
              system: Number(star.system_index || uiState.activeSystem || 1),
              position: 1,
            }, 'transport', {
              owner: String(star.colony_owner_name || ''),
            });
            return;
          }
          if (action === 'gates') {
            const colonyInSystem = colonies.find((col) =>
              Number(col.galaxy || 0) === Number(star.galaxy_index || 0)
              && Number(col.system || 0) === Number(star.system_index || 0)
            );
            if (!colonyInSystem) {
              showToast('Keine eigene Kolonie in diesem System fuer Gate-Installationen.', 'warning');
              return;
            }
            openColonySubview(colonyInSystem.id, 'gates', { source: 'system-view' });
            return;
          }
          if (action === 'scientific-scale') {
            if (galaxy3d && typeof galaxy3d.toggleScientificScale === 'function') {
              const newState = galaxy3d.toggleScientificScale();
              const msg = newState
                ? 'Wissenschaftliche Skalierung: Relative Planetengroessen korrekt'
                : 'Spielmodus: Alle Planeten gleichzeitig sichtbar';
              showToast(msg, 'info');
              rerenderSystemDetails(root, star, isSystemModeActive());
            } else {
              showToast('Wissenschaftliche Skalierung ist derzeit nicht verfuegbar.', 'warning');
            }
          }
        });
      });
    }

    return {
      renderGalaxySystemDetails,
    };
  }

  global.GQRuntimeGalaxySystemDetailsFacade = {
    createGalaxySystemDetailsFacade,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.GQRuntimeGalaxySystemDetailsFacade;
  }
})(typeof window !== 'undefined' ? window : globalThis);
