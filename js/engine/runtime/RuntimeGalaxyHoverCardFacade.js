(function (global) {
  'use strict';

  function createGalaxyHoverCardFacade(options = {}) {
    const documentRef = options.documentRef || global.document;
    const windowRef = options.windowRef || global;
    const esc = typeof options.esc === 'function' ? options.esc : (value) => String(value || '');
    const fmtName = typeof options.fmtName === 'function' ? options.fmtName : (value) => String(value || '');
    const planetIcon = typeof options.planetIcon === 'function' ? options.planetIcon : () => '';
    const starClassColor = typeof options.starClassColor === 'function' ? options.starClassColor : () => '#7db7ee';
    const getPinnedStar = typeof options.getPinnedStar === 'function' ? options.getPinnedStar : () => null;
    const getColonies = typeof options.getColonies === 'function' ? options.getColonies : () => [];

    function formatColonyPopulation(value) {
      const population = Math.max(0, Number(value || 0));
      if (!population) return '0';
      if (population >= 1000000000) return (population / 1000000000).toFixed(1) + 'B';
      if (population >= 1000000) return (population / 1000000).toFixed(1) + 'M';
      if (population >= 1000) return (population / 1000).toFixed(1) + 'K';
      return String(Math.round(population));
    }

    function getColonyMarkerMeta(target) {
      const colonyCount = Math.max(0, Number(target && target.colony_count ? target.colony_count : 0));
      if (colonyCount <= 0) return null;
      const colonyPopulation = Math.max(0, Number(target && target.colony_population ? target.colony_population : 0));
      const colonyColor = String(
        (target && (target.colony_owner_color || target.owner_color || target.faction_color)) || '#7db7ee'
      );
      const ownerName = String((target && (target.colony_owner_name || target.owner)) || '').trim();
      const isPlayer = Number(target && target.colony_is_player ? target.colony_is_player : 0) === 1;
      const countStrength = colonyCount > 0
        ? Math.max(0, Math.min(1, (Math.log2(colonyCount + 1) - 0.3) / 3.2))
        : 0;
      const popStrength = colonyPopulation > 0
        ? Math.max(0, Math.min(1, (Math.log10(colonyPopulation + 1) - 2.2) / 3.0))
        : 0;
      const strength = Math.max(countStrength, popStrength);
      let label = 'Aussenposten';
      if (strength >= 0.75) label = 'Kernwelt';
      else if (strength >= 0.4) label = 'Kolonie';

      return {
        count: colonyCount,
        population: colonyPopulation,
        populationShort: formatColonyPopulation(colonyPopulation),
        color: colonyColor,
        strength,
        label: isPlayer ? 'Eigene ' + label : label,
        ownerName,
        isPlayer,
      };
    }

    function renderHoverCard(star, pos, pinned) {
      const card = documentRef.getElementById('galaxy-hover-card');
      if (!card) return;

      if (!star || !pos) {
        if (!getPinnedStar() || !pinned) card.classList.add('hidden');
        return;
      }

      if (star.__kind === 'planet') {
        const sourceStar = star.__sourceStar || {};
        const title = star.name || fmtName(String(star.planet_class || 'planet'));
        const owner = star.owner ? ' | ' + esc(star.owner) : '';
        const colonies = Array.isArray(getColonies()) ? getColonies() : [];
        const ownColony = colonies.find((col) =>
          Number(col.id || 0) === Number(star.colony_id || star.__slot?.player_planet?.colony_id || 0)
        ) || null;
        const ownerColor = String(star.owner_color || star.__slot?.player_planet?.owner_color || '#7db7ee');
        const ownerBadge = star.owner
          ? '<div class="hover-meta hover-meta-colony"><span class="hover-colony-swatch" style="background:'
            + esc(ownerColor)
            + ';box-shadow:0 0 8px '
            + esc(ownerColor)
            + ';"></span>'
            + esc(ownColony ? 'Eigene Kolonie' : 'Fremde Kolonie')
            + (star.owner ? ' | Besitzer: ' + esc(star.owner) : '')
            + '</div>'
          : '';

        card.innerHTML = ''
          + '<div class="hover-title hover-title-planet"><span class="hover-planet-icon">'
          + planetIcon(star.planet_class)
          + '</span>'
          + esc(title)
          + '</div>'
          + '<div class="hover-meta">'
          + esc(star.planet_class || 'Planet')
          + ' | slot '
          + esc(String(star.__slot?.position || star.position || '?'))
          + owner
          + '</div>'
          + '<div class="hover-meta">around '
          + esc(sourceStar.name || sourceStar.catalog_name || 'system star')
          + '</div>'
          + ownerBadge;
      } else if (star.__kind === 'cluster') {
        const systems = Array.isArray(star.__clusterSystems) ? star.__clusterSystems : [];
        const from = systems.length ? Math.min(...systems) : Number(star.from || 0);
        const to = systems.length ? Math.max(...systems) : Number(star.to || 0);
        const clusterColor = String(star.__clusterColor || '#ff7b72');

        card.innerHTML = ''
          + '<div class="hover-title"><span class="hover-star-dot" style="background:'
          + esc(clusterColor)
          + ';box-shadow:0 0 10px '
          + esc(clusterColor)
          + ';"></span>'
          + esc(star.label || star.name || ('Cluster ' + String(Number(star.__clusterIndex || 0) + 1)))
          + '</div>'
          + '<div class="hover-meta">Systeme: '
          + esc(String(from || '?'))
          + ' - '
          + esc(String(to || '?'))
          + '</div>'
          + '<div class="hover-meta">Hover/Klick selektiert | Doppelklick zoomt in die Bounding Box</div>';
      } else {
        const starColor = starClassColor(star.spectral_class);
        const colonyMeta = getColonyMarkerMeta(star);
        const colonyLine = colonyMeta
          ? '<div class="hover-meta hover-meta-colony"><span class="hover-colony-swatch" style="background:'
            + esc(colonyMeta.color)
            + ';box-shadow:0 0 8px '
            + esc(colonyMeta.color)
            + ';"></span>'
            + esc(colonyMeta.label)
            + ' | '
            + esc(String(colonyMeta.count))
            + ' Kolonien | Pop '
            + esc(colonyMeta.populationShort)
            + (colonyMeta.ownerName
              ? ' | ' + esc(colonyMeta.isPlayer ? 'Besitzer: Du' : ('Besitzer: ' + colonyMeta.ownerName))
              : '')
            + '</div>'
          : '';

        card.innerHTML = ''
          + '<div class="hover-title"><span class="hover-star-dot" style="background:'
          + starColor
          + ';box-shadow:0 0 8px '
          + starColor
          + ';"></span>'
          + esc(star.name)
          + '</div>'
          + '<div class="hover-meta">'
          + esc(star.spectral_class)
          + esc(String(star.subtype ?? ''))
          + ' | '
          + String(star.galaxy_index)
          + ':'
          + String(star.system_index)
          + '</div>'
          + colonyLine;
      }

      const hostWidth = documentRef.getElementById('galaxy-3d-host')?.clientWidth || windowRef.innerWidth;
      card.style.left = String(Math.max(10, Math.min(pos.x, hostWidth - 10))) + 'px';
      card.style.top = String(Math.max(18, pos.y - 18)) + 'px';
      card.classList.remove('hidden');
      card.classList.toggle('pinned', !!pinned);
    }

    return {
      renderHoverCard,
    };
  }

  global.GQRuntimeGalaxyHoverCardFacade = {
    createGalaxyHoverCardFacade,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.GQRuntimeGalaxyHoverCardFacade;
  }
})(typeof window !== 'undefined' ? window : globalThis);
