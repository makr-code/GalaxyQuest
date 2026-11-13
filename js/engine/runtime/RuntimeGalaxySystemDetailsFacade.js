(function (global) {
  'use strict';

  function createElement(documentRef, tagName, className = '', text = '') {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text !== null && text !== undefined) element.textContent = String(text);
    return element;
  }

  function createGalaxySystemDetailsFacade(options = {}) {
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
    const getNearestSystemNeighbors = typeof options.getNearestSystemNeighbors === 'function' ? options.getNearestSystemNeighbors : () => [];
    const navigateToSystemNeighbor = typeof options.navigateToSystemNeighbor === 'function' ? options.navigateToSystemNeighbor : function () {};

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
        const colonyColorCandidate = String(target?.colony_owner_color || target?.owner_color || target?.faction_color || '');
        const colonyColor = /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(colonyColorCandidate)
          ? colonyColorCandidate
          : '#7db7ee';
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

      const documentRef = details.ownerDocument;
      const createNavButtons = () => {
        const nav = createElement(documentRef, 'div', 'galaxy-detail-nav');
        nav.setAttribute('aria-label', 'Schnellnavigation 3D');
        quickNavActions.forEach((entry) => {
          const button = createElement(
            documentRef,
            'button',
            `galaxy-detail-nav-btn ${entry.className || ''}`.trim(),
            entry.label
          );
          button.type = 'button';
          button.dataset.navAction = entry.action;
          button.title = entry.title;
          nav.append(button);
        });
        return nav;
      };

      const fleetVectorsOn = settingsState.galaxyFleetVectorsVisible !== false;
      const visibleFleetCount = zoomed
        ? Number(galaxy3d?.systemFleetEntries?.length || 0)
        : Number(galaxy3d?.galaxyFleetEntries?.length || (windowRef._GQ_fleets || []).length || 0);
      const showFleetLegend = visibleFleetCount > 0;

      const createFleetLegend = () => {
        const legend = createElement(
          documentRef,
          'div',
          `galaxy-fleet-legend ${showFleetLegend ? 'is-visible' : 'is-hidden'}`
        );
        legend.setAttribute('aria-label', 'Fleet-Richtungsfarben');
        legend.setAttribute('aria-hidden', showFleetLegend ? 'false' : 'true');
        if (!showFleetLegend) return legend;

        legend.append(createElement(documentRef, 'div', 'galaxy-fleet-legend-title', 'Fleet-Richtungsfarben'));
        if (!fleetVectorsOn) {
          legend.append(createElement(
            documentRef,
            'div',
            'galaxy-fleet-legend-row text-muted',
            'In Settings deaktiviert (Galaxy: Fleet-Marker und Fluglinien anzeigen).'
          ));
          return legend;
        }

        if (zoomed) {
          legend.querySelector('.galaxy-fleet-legend-title').textContent = 'Fleet-Richtungsfarben (kompakt)';
          const groups = [
            [['#ff4d3d', 'Angriff'], ['#41d1ff', 'Spionage']],
            [['#86ff66', 'Transport'], ['#5cf2a5', 'Kolonisieren'], ['#ffd15c', 'Ernten']],
          ];
          groups.forEach((items) => {
            const row = createElement(documentRef, 'div', 'galaxy-fleet-legend-row galaxy-fleet-legend-row-compact');
            items.forEach(([color, label]) => {
              const line = createElement(documentRef, 'span', 'galaxy-fleet-legend-line');
              line.style.setProperty('--fleet-color', color);
              row.append(line, documentRef.createTextNode(label));
            });
            legend.append(row);
          });
          return legend;
        }

        [
          ['#ff4d3d', 'Angriff'],
          ['#41d1ff', 'Spionage'],
          ['#86ff66', 'Transport'],
          ['#5cf2a5', 'Kolonisieren'],
          ['#ffd15c', 'Ernten'],
        ].forEach(([color, label]) => {
          const row = createElement(documentRef, 'div', 'galaxy-fleet-legend-row');
          const line = createElement(documentRef, 'span', 'galaxy-fleet-legend-line');
          line.style.setProperty('--fleet-color', color);
          row.append(line, documentRef.createTextNode(label));
          legend.append(row);
        });
        return legend;
      };

      if (!star) {
        const hint = createElement(
          documentRef,
          'span',
          'text-muted',
          `Press I for this overlay. Camera: mouse drag + wheel, keyboard WASD/QE + arrows, F fit, R reset, L follow ${followEnabled ? 'off' : 'on'}.`
        );
        details.replaceChildren(createNavButtons(), hint, createFleetLegend());
        details.querySelectorAll('[data-nav-action]').forEach((button) => {
          button.addEventListener('click', () => triggerGalaxyNavAction(button.getAttribute('data-nav-action'), root));
        });
        return;
      }

      if (star.__kind === 'cluster') {
        const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
        const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
        const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
        const card = createElement(documentRef, 'div', 'system-card');
        card.append(createElement(
          documentRef,
          'div',
          'system-title',
          star.label || `Cluster ${Number(star.__clusterIndex || 0) + 1}`
        ));
        card.append(createNavButtons());
        card.append(createElement(
          documentRef,
          'div',
          'system-row',
          `Clusterbereich: ${String(from || '?')} - ${String(to || '?')}${star?.faction?.name ? ` | ${String(star.faction.name)}` : ''}`
        ));
        card.append(createElement(
          documentRef,
          'div',
          'system-row',
          `Bounding Box: ${Number(star.__clusterSize?.x || 0).toFixed(1)} x ${Number(star.__clusterSize?.y || 0).toFixed(1)} x ${Number(star.__clusterSize?.z || 0).toFixed(1)}`
        ));
        card.append(createElement(
          documentRef,
          'div',
          'system-row',
          `Center: ${Number(star.__clusterCenter?.x || 0).toFixed(1)}, ${Number(star.__clusterCenter?.y || 0).toFixed(1)}, ${Number(star.__clusterCenter?.z || 0).toFixed(1)}`
        ));
        card.append(createElement(documentRef, 'div', 'system-row', 'Cluster gebunden, rotiert mit der Sternwolke und ist per Mouse hover-/selektierbar.'));
        card.append(createElement(documentRef, 'div', 'system-row', 'Klick fokussiert die Box, Doppelklick zoomt clusterweise hinein.'));
        card.append(createFleetLegend());
        const clusterActions = createElement(documentRef, 'div', 'system-row');
        clusterActions.style.marginTop = '0.45rem';
        const loadRangeButton = createElement(documentRef, 'button', 'btn btn-secondary btn-sm', 'Cluster-Range laden');
        loadRangeButton.id = 'gal-load-cluster-range-btn';
        loadRangeButton.type = 'button';
        clusterActions.append(loadRangeButton);
        card.append(clusterActions);
        details.replaceChildren(card);
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
      const isFav = isFavoriteStar(star);
      const colonyMeta = getColonyMarkerMeta(star);
      const scientificScaleEnabled = galaxy3d?.getRenderStats?.()?.scientificScaleEnabled === true;
      getNearestSystemNeighbors(star, 3);
      // Neighbor waypoints rendered as canvas-2D/3D objects via GQNeighborWaypointOverlay.
      const _waypointOverlay = typeof global.GQNeighborWaypointOverlay?.getOverlay === 'function'
        ? global.GQNeighborWaypointOverlay.getOverlay() : null;
      const _canvas3d = galaxy3d?.renderer?.domElement || null;
      if (_waypointOverlay && _canvas3d) _waypointOverlay.mount(_canvas3d, getGalaxy3d);
      const createSystemActions = () => {
        const actions = createElement(documentRef, 'div', 'system-row');
        Object.assign(actions.style, { marginTop: '0.42rem', display: 'flex', gap: '0.36rem', flexWrap: 'wrap' });
        [
          ['enter-system', 'Planet View'],
          ['fleet', 'Fleet'],
          ['gates', 'Gate Installations'],
        ].forEach(([action, label]) => {
          const button = createElement(documentRef, 'button', 'btn btn-secondary btn-sm', label);
          button.type = 'button';
          button.dataset.systemAction = action;
          actions.append(button);
        });
        if (zoomed) {
          const scaleButton = createElement(
            documentRef,
            'button',
            `btn btn-secondary btn-sm${scientificScaleEnabled ? ' active' : ''}`,
            scientificScaleEnabled ? 'Spielmodus' : 'Wissenschaft'
          );
          scaleButton.type = 'button';
          scaleButton.dataset.systemAction = 'scientific-scale';
          scaleButton.title = 'Toggle between game scale and scientific proportions';
          actions.append(scaleButton);
        }
        return actions;
      };

      const fowLevel = isCurrentUserAdmin() ? 'own' : (star.visibility_level || 'unknown');
      const fowLabels = { own: 'Eigene Kolonie', active: 'Flotte aktiv', stale: 'Veraltete Aufklaerung', unknown: 'Unerforscht' };
      const card = createElement(documentRef, 'div', 'system-card');
      card.append(createElement(documentRef, 'div', 'system-title', star.name));
      card.append(createNavButtons());
      card.append(createElement(documentRef, 'div', 'system-row', `Catalog: ${String(star.catalog_name || '-')}`));
      card.append(createElement(documentRef, 'div', 'system-row', `Galaxy/System: ${star.galaxy_index}:${star.system_index}`));
      card.append(createElement(documentRef, 'div', 'system-row', `Class: ${String(star.spectral_class || '')}${String(star.subtype ?? '')}`));
      card.append(createElement(
        documentRef,
        'div',
        'system-row',
        `Coordinates: ${Number(star.x_ly || 0).toFixed(0)}, ${Number(star.y_ly || 0).toFixed(0)}, ${Number(star.z_ly || 0).toFixed(0)} ly`
      ));
      card.append(createElement(
        documentRef,
        'div',
        'system-row',
        `Habitable Zone: ${Number(star.hz_inner_au || 0).toFixed(2)} - ${Number(star.hz_outer_au || 0).toFixed(2)} AU`
      ));
      const planetCount = createElement(documentRef, 'div', 'system-row');
      planetCount.append(documentRef.createTextNode(`Planets: `));
      if (hasKnownPlanetCount) {
        planetCount.append(documentRef.createTextNode(String(Math.round(countRaw))));
      } else {
        const unknownCount = createElement(documentRef, 'span', 'text-muted', 'n/a');
        unknownCount.title = 'legacy cache/no count';
        planetCount.append(unknownCount);
      }
      card.append(planetCount);

      if (colonyMeta) {
        const colonyRow = createElement(documentRef, 'div', 'system-row system-row-colony');
        const swatch = createElement(documentRef, 'span', 'system-colony-swatch');
        swatch.style.backgroundColor = colonyMeta.color;
        swatch.style.boxShadow = `0 0 10px ${colonyMeta.color}`;
        colonyRow.append(swatch, documentRef.createTextNode(
          `${colonyMeta.label} | ${String(colonyMeta.count)} Kolonien | Bevoelkerung ${colonyMeta.populationFull}${colonyMeta.ownerName ? ` | ${colonyMeta.isPlayer ? 'Dominanz: Du' : `Dominanz: ${colonyMeta.ownerName}`}` : ''}`
        ));
        card.append(colonyRow);
      } else {
        card.append(createElement(documentRef, 'div', 'system-row text-muted', 'Keine bekannten Kolonien in diesem System.'));
      }

      const fowRow = createElement(
        documentRef,
        'div',
        `system-row ${fowLevel === 'unknown' ? 'fow-unknown-badge' : ''}`,
        Object.prototype.hasOwnProperty.call(fowLabels, fowLevel) ? fowLabels[fowLevel] : fowLevel
      );
      if (fowLevel === 'stale') fowRow.style.color = '#e8c843';
      card.append(fowRow);
      card.append(createElement(
        documentRef,
        'div',
        'system-row',
        `Selection Follow: ${followEnabled ? 'locked' : 'free'} (L)`
      ));
      card.append(createElement(
        documentRef,
        'div',
        'system-row',
        zoomed ? 'System view active. Esc/F/R returns to galaxy overview.' : 'Double click to zoom into the system and show planets.'
      ));
      card.append(createSystemActions(), createFleetLegend());
      const favoriteRow = createElement(documentRef, 'div', 'system-row');
      favoriteRow.style.marginTop = '0.4rem';
      const favoriteButton = createElement(
        documentRef,
        'button',
        `btn btn-secondary btn-sm${isFav ? ' active' : ''}`,
        isFav ? 'Favorit entfernen' : 'Favorit hinzufuegen'
      );
      favoriteButton.id = 'gal-quicknav-fav-btn';
      favoriteButton.type = 'button';
      favoriteRow.append(favoriteButton);
      card.append(favoriteRow);
      details.replaceChildren(card);

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

      details.querySelectorAll('[data-system-neighbor-galaxy][data-system-neighbor-system]').forEach((button) => {
        button.addEventListener('click', () => {
          const galaxy = Number(button.getAttribute('data-system-neighbor-galaxy') || 0);
          const system = Number(button.getAttribute('data-system-neighbor-system') || 0);
          if (!galaxy || !system) return;
          navigateToSystemNeighbor({ galaxy_index: galaxy, system_index: system });
        });
      });

      details.addEventListener('keydown', (e) => {
        const tag = String(e.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
        if (e.key !== '1' && e.key !== '2' && e.key !== '3') return;
        const rankBtn = details.querySelector(`[data-neighbor-rank="${e.key}"]`);
        if (!rankBtn) return;
        e.preventDefault();
        rankBtn.click();
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
