(function (global) {
  'use strict';

  const QUICKNAV_KEY = 'gq_quicknav';
  const QUICKNAV_RIBBONS = [
    { id: '', label: 'Keine' },
    { id: 'home', label: 'Home' },
    { id: 'colony', label: 'Kolonie' },
    { id: 'combat', label: 'Kampf' },
    { id: 'watch', label: 'Beobachten' },
  ];

  function createQuickNavFacade(options = {}) {
    const wm = options.wm;
    const documentRef = options.documentRef || global.document;
    const esc = typeof options.esc === 'function' ? options.esc : (value) => String(value || '');
    const gameLog = typeof options.gameLog === 'function' ? options.gameLog : function () {};
    const showToast = typeof options.showToast === 'function' ? options.showToast : function () {};
    const runPhysicsCinematicFlight = typeof options.runPhysicsCinematicFlight === 'function'
      ? options.runPhysicsCinematicFlight
      : async function () { return { ok: false }; };
    const renderGalaxySystemDetails = typeof options.renderGalaxySystemDetails === 'function'
      ? options.renderGalaxySystemDetails
      : function () {};
    const isSystemModeActive = typeof options.isSystemModeActive === 'function'
      ? options.isSystemModeActive
      : function () { return false; };

    const readGalaxyStars = typeof options.getGalaxyStars === 'function'
      ? options.getGalaxyStars
      : () => [];
    const readPinnedStar = typeof options.getPinnedStar === 'function'
      ? options.getPinnedStar
      : () => null;
    const writePinnedStar = typeof options.setPinnedStar === 'function'
      ? options.setPinnedStar
      : function () {};
    const readGalaxyRenderer = typeof options.getGalaxyRenderer === 'function'
      ? options.getGalaxyRenderer
      : () => null;
    const readAudioManager = typeof options.getAudioManager === 'function'
      ? options.getAudioManager
      : () => null;

    function loadQuickNavData() {
      try {
        return JSON.parse(global.localStorage.getItem(QUICKNAV_KEY) || '{}');
      } catch (err) {
        gameLog('info', 'QuickNav Daten konnten nicht geladen werden, fallback leer', err);
        return {};
      }
    }

    function saveQuickNavData(data) {
      try {
        global.localStorage.setItem(QUICKNAV_KEY, JSON.stringify(data));
      } catch (err) {
        gameLog('info', 'QuickNav Daten konnten nicht gespeichert werden', err);
      }
    }

    function getQuickNavFavorites() {
      const raw = loadQuickNavData();
      return Array.isArray(raw.favorites) ? raw.favorites : [];
    }

    function isFavoriteStar(star) {
      if (!star || !star.galaxy_index || !star.system_index) return false;
      const key = String(Number(star.galaxy_index)) + ':' + String(Number(star.system_index));
      return getQuickNavFavorites().some((entry) => entry.key === key);
    }

    function addFavorite(star, ribbon) {
      const ribbonValue = String(ribbon || '');
      const g = Number(star && star.galaxy_index ? star.galaxy_index : 1);
      const s = Number(star && star.system_index ? star.system_index : 0);
      if (!s) return;
      const key = String(g) + ':' + String(s);
      const data = loadQuickNavData();
      if (!Array.isArray(data.favorites)) data.favorites = [];
      if (data.favorites.some((entry) => entry.key === key)) return;
      data.favorites.unshift({
        key,
        galaxy_index: g,
        system_index: s,
        name: String((star && (star.name || star.catalog_name)) || ('System ' + String(s))),
        catalog_name: String((star && star.catalog_name) || ''),
        spectral_class: String((star && star.spectral_class) || 'G'),
        subtype: String((star && star.subtype) || ''),
        x_ly: Number((star && star.x_ly) || 0),
        y_ly: Number((star && star.y_ly) || 0),
        z_ly: Number((star && star.z_ly) || 0),
        ribbon: ribbonValue,
        pinnedAt: Date.now(),
      });
      saveQuickNavData(data);
    }

    function removeFavorite(key) {
      const data = loadQuickNavData();
      if (!Array.isArray(data.favorites)) return;
      data.favorites = data.favorites.filter((entry) => entry.key !== key);
      saveQuickNavData(data);
    }

    function setFavoriteRibbon(key, ribbon) {
      const data = loadQuickNavData();
      if (!Array.isArray(data.favorites)) return;
      const favorite = data.favorites.find((entry) => entry.key === key);
      if (favorite) {
        favorite.ribbon = String(ribbon || '');
        saveQuickNavData(data);
      }
    }

    function updateFooterQuickNavBadge() {
      const badge = documentRef.getElementById('footer-quicknav-badge');
      if (!badge) return;
      const count = getQuickNavFavorites().length;
      badge.textContent = String(count);
      badge.classList.toggle('hidden', count === 0);
    }

    async function navigateToFavorite(key) {
      const favorites = getQuickNavFavorites();
      const favorite = favorites.find((entry) => entry.key === key);
      if (!favorite) return;

      const stars = Array.isArray(readGalaxyStars()) ? readGalaxyStars() : [];
      const liveData = stars.find((star) =>
        Number(star.galaxy_index) === favorite.galaxy_index
        && Number(star.system_index) === favorite.system_index
      );

      const starData = liveData || {
        galaxy_index: favorite.galaxy_index,
        system_index: favorite.system_index,
        name: favorite.name,
        catalog_name: favorite.catalog_name,
        spectral_class: favorite.spectral_class,
        subtype: favorite.subtype,
        x_ly: favorite.x_ly,
        y_ly: favorite.y_ly,
        z_ly: favorite.z_ly,
      };

      wm.open('galaxy');
      writePinnedStar(starData);

      const label = String(starData.name || starData.catalog_name || ('System ' + String(Number(starData.system_index || 0))));
      const flight = await runPhysicsCinematicFlight(starData, {
        durationSec: 1.7,
        holdMs: 720,
        label: label + ' [' + String(Number(starData.galaxy_index || 1)) + ':' + String(Number(starData.system_index || 0)) + ']',
      });

      const renderer = readGalaxyRenderer();
      if (renderer && typeof renderer.focusOnStar === 'function') {
        renderer.focusOnStar(starData, !flight.ok);
      }

      const galaxyRoot = wm.body('galaxy');
      if (galaxyRoot) {
        renderGalaxySystemDetails(galaxyRoot, starData, false);
      }

      const audioManager = readAudioManager();
      if (audioManager && typeof audioManager.playNavigation === 'function') {
        audioManager.playNavigation();
      }
    }

    function renderQuickNav() {
      const root = wm.body('quicknav');
      if (!root) return;

      const prevSearch = root.querySelector('#qn-search') && root.querySelector('#qn-search').value ? root.querySelector('#qn-search').value : '';
      const activeRibbonNode = root.querySelector('.quicknav-ribbon-pill.active');
      const prevRibbon = activeRibbonNode && activeRibbonNode.dataset ? (activeRibbonNode.dataset.ribbon ?? 'all') : 'all';
      const sortNode = root.querySelector('#qn-sort');
      const prevSort = sortNode && sortNode.value ? sortNode.value : 'recent';

      root.innerHTML = '<div class="quicknav-wrap">'
        + '<div class="quicknav-toolbar">'
        + '<input id="qn-search" class="quicknav-search" type="search" placeholder="Name oder Koordinate suchen..." value="' + esc(prevSearch) + '" autocomplete="off" />'
        + '<select id="qn-sort" class="quicknav-sort" title="Sortierung">'
        + '<option value="recent" ' + (prevSort === 'recent' ? 'selected' : '') + '>Hinzugefuegt</option>'
        + '<option value="name" ' + (prevSort === 'name' ? 'selected' : '') + '>A-Z Name</option>'
        + '<option value="name-z" ' + (prevSort === 'name-z' ? 'selected' : '') + '>Z-A Name</option>'
        + '<option value="system" ' + (prevSort === 'system' ? 'selected' : '') + '>System-Nr.</option>'
        + '<option value="ribbon" ' + (prevSort === 'ribbon' ? 'selected' : '') + '>Ribbon</option>'
        + '</select>'
        + '<div class="quicknav-ribbon-filter">'
        + '<button class="quicknav-ribbon-pill' + (prevRibbon === 'all' ? ' active' : '') + '" data-ribbon="all">Alle</button>'
        + '<button class="quicknav-ribbon-pill' + (prevRibbon === 'home' ? ' active' : '') + '" data-ribbon="home">Home</button>'
        + '<button class="quicknav-ribbon-pill' + (prevRibbon === 'colony' ? ' active' : '') + '" data-ribbon="colony">Kolonie</button>'
        + '<button class="quicknav-ribbon-pill' + (prevRibbon === 'combat' ? ' active' : '') + '" data-ribbon="combat">Kampf</button>'
        + '<button class="quicknav-ribbon-pill' + (prevRibbon === 'watch' ? ' active' : '') + '" data-ribbon="watch">Watch</button>'
        + '<button class="quicknav-ribbon-pill' + (prevRibbon === '' ? ' active' : '') + '" data-ribbon="">Keine</button>'
        + '</div>'
        + '</div>'
        + '<div class="quicknav-list" id="qn-list"></div>'
        + '</div>';

      const renderList = function () {
        const listEl = root.querySelector('#qn-list');
        if (!listEl) return;
        const searchNode = root.querySelector('#qn-search');
        const search = searchNode && searchNode.value ? searchNode.value.trim().toLowerCase() : '';
        const ribbonNode = root.querySelector('.quicknav-ribbon-pill.active');
        const ribbon = ribbonNode && ribbonNode.dataset ? (ribbonNode.dataset.ribbon ?? 'all') : 'all';
        const sortNodeCurrent = root.querySelector('#qn-sort');
        const sortMode = sortNodeCurrent && sortNodeCurrent.value ? sortNodeCurrent.value : 'recent';
        let favorites = getQuickNavFavorites();

        if (ribbon !== 'all') {
          favorites = favorites.filter((entry) => (entry.ribbon || '') === ribbon);
        }
        if (search) {
          favorites = favorites.filter((entry) =>
            entry.name.toLowerCase().includes(search)
            || entry.catalog_name.toLowerCase().includes(search)
            || (String(entry.galaxy_index) + ':' + String(entry.system_index)).includes(search)
          );
        }

        if (sortMode === 'name') {
          favorites = [].concat(favorites).sort((a, b) => a.name.localeCompare(b.name));
        } else if (sortMode === 'name-z') {
          favorites = [].concat(favorites).sort((a, b) => b.name.localeCompare(a.name));
        } else if (sortMode === 'system') {
          favorites = [].concat(favorites).sort((a, b) => a.galaxy_index - b.galaxy_index || a.system_index - b.system_index);
        } else if (sortMode === 'ribbon') {
          favorites = [].concat(favorites).sort((a, b) => (a.ribbon || '').localeCompare(b.ribbon || ''));
        }

        if (!favorites.length) {
          listEl.innerHTML = '<div class="quicknav-empty">'
            + 'Keine Favoriten' + (ribbon !== 'all' || search ? ' fuer diese Auswahl' : '') + '.<br/>'
            + '<span style="font-size:0.77rem">Stern im Galaxy-Detail-Panel mit <strong>Favorit</strong> markieren.</span>'
            + '</div>';
          return;
        }

        listEl.innerHTML = favorites.map((fav) => {
          const ribbonId = fav.ribbon || '';
          const cls = String(fav.spectral_class || 'G') + String(fav.subtype || '');
          return '<div class="quicknav-item" data-fav-key="' + esc(fav.key) + '">'
            + '<div class="quicknav-ribbon-dot" data-r="' + esc(ribbonId) + '"></div>'
            + '<div class="quicknav-item-name" title="' + esc(fav.name) + '">' + esc(fav.name) + '</div>'
            + '<span class="quicknav-item-class">' + esc(cls) + '</span>'
            + '<span class="quicknav-item-meta">' + String(fav.galaxy_index) + ':' + String(fav.system_index) + '</span>'
            + '<div class="quicknav-item-actions">'
            + '<select class="quicknav-ribbon-select" data-fav-key="' + esc(fav.key) + '" title="Ribbon">'
            + QUICKNAV_RIBBONS.map((rb) => '<option value="' + esc(rb.id) + '"' + ((fav.ribbon || '') === rb.id ? ' selected' : '') + '>' + esc(rb.label) + '</option>').join('')
            + '</select>'
            + '<button class="quicknav-item-btn go" data-fav-key="' + esc(fav.key) + '" title="Ansteuern">Go</button>'
            + '<button class="quicknav-item-btn remove" data-fav-key="' + esc(fav.key) + '" title="Aus Favoriten entfernen">Del</button>'
            + '</div>'
            + '</div>';
        }).join('');
      };

      renderList();

      const searchInput = root.querySelector('#qn-search');
      if (searchInput) searchInput.addEventListener('input', renderList);
      const sortInput = root.querySelector('#qn-sort');
      if (sortInput) sortInput.addEventListener('change', renderList);

      root.querySelectorAll('.quicknav-ribbon-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
          root.querySelectorAll('.quicknav-ribbon-pill').forEach((item) => item.classList.remove('active'));
          pill.classList.add('active');
          renderList();
        });
      });

      const listRoot = root.querySelector('#qn-list');
      if (listRoot) {
        listRoot.addEventListener('click', (event) => {
          const goBtn = event.target.closest('.quicknav-item-btn.go');
          const removeBtn = event.target.closest('.quicknav-item-btn.remove');
          const itemRow = event.target.closest('.quicknav-item');

          if (goBtn) {
            navigateToFavorite(goBtn.dataset.favKey).catch((err) => {
              gameLog('info', 'QuickNav Navigation (Button) fehlgeschlagen', err);
            });
            return;
          }

          if (removeBtn) {
            removeFavorite(removeBtn.dataset.favKey);
            updateFooterQuickNavBadge();
            renderList();
            const galaxyRoot = wm.body('galaxy');
            const pinnedStar = readPinnedStar();
            if (galaxyRoot && pinnedStar) {
              renderGalaxySystemDetails(galaxyRoot, pinnedStar, isSystemModeActive());
            }
            return;
          }

          if (itemRow && !event.target.closest('select') && !event.target.closest('button')) {
            navigateToFavorite(itemRow.dataset.favKey).catch((err) => {
              gameLog('info', 'QuickNav Navigation (Item) fehlgeschlagen', err);
            });
          }
        });

        listRoot.addEventListener('change', (event) => {
          const select = event.target.closest('.quicknav-ribbon-select');
          if (!select) return;
          setFavoriteRibbon(select.dataset.favKey, select.value);
          renderList();
        });
      }
    }

    return {
      loadQuickNavData,
      saveQuickNavData,
      getQuickNavFavorites,
      isFavoriteStar,
      addFavorite,
      removeFavorite,
      setFavoriteRibbon,
      updateFooterQuickNavBadge,
      renderQuickNav,
    };
  }

  global.GQRuntimeQuickNavFacade = {
    createQuickNavFacade,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.GQRuntimeQuickNavFacade;
  }
})(typeof window !== 'undefined' ? window : globalThis);
