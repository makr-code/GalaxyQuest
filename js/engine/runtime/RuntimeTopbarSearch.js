/**
 * RuntimeTopbarSearch.js
 *
 * Topbar search overlay runtime bindings.
 */

'use strict';

(function () {
  const runtimeConfig = {
    getTopbarSearchStore: () => null,
    collectLocalStarSearch: () => [],
    starSearchKey: (star) => String(star?.id || ''),
    getActiveGalaxy: () => 1,
    api: null,
    esc: (value) => String(value || ''),
    renderInlineTemplate: (tpl) => String(tpl || ''),
    closeCommanderMenuPanel: () => {},
    closeTopbarPlayerMenu: () => {},
    setTopbarMenuFocusTrap: () => {},
    syncTopbarBottomSheetState: () => {},
    focusFirstInTopbarMenu: () => {},
    clearTopbarMenuFocusTrap: () => {},
    isTopbarMenuFocusTrapped: () => false,
    onJumpToSearchStar: async () => {},
    documentRef: (typeof document !== 'undefined' ? document : null),
    windowRef: (typeof window !== 'undefined' ? window : null),
  };

  let initialized = false;

  function configureTopbarSearchRuntime(options = {}) {
    Object.assign(runtimeConfig, options || {});
  }

  function getTopbarSearchStore() {
    return runtimeConfig.getTopbarSearchStore?.() || null;
  }

  function getTopbarSearchDom() {
    const documentRef = runtimeConfig.documentRef;
    const wrap = documentRef?.getElementById('topbar-search-wrap');
    const toggle = documentRef?.getElementById('topbar-search-toggle');
    const menu = documentRef?.getElementById('topbar-search-menu');
    const input = documentRef?.getElementById('topbar-search-input');
    const overlay = documentRef?.getElementById('topbar-search-overlay');
    return { wrap, toggle, menu, input, overlay };
  }

  function closeTopbarSearchOverlay() {
    const store = getTopbarSearchStore();
    store?.closeOverlay?.();
    renderTopbarSearchOverlay();
    const { wrap, menu, toggle } = getTopbarSearchDom();
    wrap?.classList.remove('open');
    menu?.classList.add('hidden');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (runtimeConfig.isTopbarMenuFocusTrapped?.(menu)) {
      runtimeConfig.clearTopbarMenuFocusTrap?.({ restoreFocus: true });
    }
    runtimeConfig.syncTopbarBottomSheetState?.();
  }

  function renderTopbarSearchOverlay() {
    const store = getTopbarSearchStore();
    const { overlay } = getTopbarSearchDom();
    if (!overlay || !store) return;
    if (!store.open) {
      overlay.classList.add('hidden');
      overlay.replaceChildren();
      return;
    }

    const localRows = Array.isArray(store.localResults) ? store.localResults : [];
    const serverRows = Array.isArray(store.serverResults) ? store.serverResults : [];
    const renderRow = (star, source, index) => {
      const name = star?.name || star?.catalog_name || `System ${Number(star?.system_index || 0)}`;
      const cls = `${String(star?.spectral_class || '?')}${String(star?.subtype || '')}`;
      const rawGalaxy = Number(star?.galaxy_index || runtimeConfig.getActiveGalaxy?.() || 1);
      const rawSystem = Number(star?.system_index || 0);
      const g = Number.isSafeInteger(rawGalaxy) && rawGalaxy > 0
        ? rawGalaxy
        : Number(runtimeConfig.getActiveGalaxy?.() || 1);
      const s = Number.isSafeInteger(rawSystem) && rawSystem >= 0 ? rawSystem : 0;
      const button = runtimeConfig.documentRef.createElement('button');
      button.type = 'button';
      button.className = 'topbar-search-item';
      button.dataset.searchSource = source;
      button.dataset.searchIndex = String(index);
      button.setAttribute('role', 'option');

      const title = runtimeConfig.documentRef.createElement('div');
      title.className = 'topbar-search-title';
      title.textContent = String(name);
      const meta = runtimeConfig.documentRef.createElement('div');
      meta.className = 'topbar-search-meta';
      meta.textContent = `${g}:${s} | ${cls} | ${source === 'local' ? 'lokal (3D)' : 'server'}`;
      button.append(title, meta);
      return button;
    };

    const createSection = (heading, rows, source, emptyMessage) => {
      const section = runtimeConfig.documentRef.createElement('div');
      section.className = 'topbar-search-section';
      const header = runtimeConfig.documentRef.createElement('div');
      header.className = 'topbar-search-head';
      header.textContent = heading;
      section.appendChild(header);

      if (rows.length) {
        rows.forEach((star, index) => section.appendChild(renderRow(star, source, index)));
      } else {
        const empty = runtimeConfig.documentRef.createElement('div');
        empty.className = 'topbar-search-empty';
        empty.textContent = emptyMessage;
        section.appendChild(empty);
      }
      return section;
    };

    const serverEmptyMessage = store.serverPending
      ? 'Server-Suche laeuft...'
      : 'Keine zusaetzlichen Server-Treffer.';
    overlay.replaceChildren(
      createSection('Lokal (Three)', localRows, 'local', 'Keine lokalen Treffer im aktuell geladenen 3D-Sternfeld.'),
      createSection('Server-Erweiterung', store.serverPending ? [] : serverRows, 'server', serverEmptyMessage),
    );
    overlay.classList.remove('hidden');

    overlay.querySelectorAll('.topbar-search-item').forEach((button) => {
      button.addEventListener('click', async () => {
        const source = String(button.getAttribute('data-search-source') || 'local');
        if (source !== 'local' && source !== 'server') return;
        const index = Number(button.getAttribute('data-search-index'));
        const list = source === 'server' ? serverRows : localRows;
        const star = Number.isSafeInteger(index) && index >= 0 && index < list.length ? list[index] : null;
        if (!star) return;
        await runtimeConfig.onJumpToSearchStar?.(star);
        closeTopbarSearchOverlay();
      });
    });
  }

  function queueServerStarSearch(query, token) {
    const store = getTopbarSearchStore();
    if (!store) return;
    store.queueServerFetch(async () => {
      if (!store.matchesToken(token)) return;
      const g = Number(runtimeConfig.getActiveGalaxy?.() || 1);
      try {
        const data = await runtimeConfig.api?.galaxySearch?.(g, query, store.maxServer);
        if (!store.matchesToken(token)) return;
        const localKeys = new Set((store.localResults || []).map((star) => runtimeConfig.starSearchKey?.(star)));
        const stars = Array.isArray(data?.stars) ? data.stars : [];
        store.setServerResults(stars.filter((star) => !localKeys.has(runtimeConfig.starSearchKey?.(star))));
      } catch (_) {
        if (!store.matchesToken(token)) return;
        store.setServerResults([]);
      }
      store.setServerPending(false);
      renderTopbarSearchOverlay();
    }, 260);
  }

  function runTopbarSearch(query) {
    const store = getTopbarSearchStore();
    if (!store) return;
    const normalized = String(query || '').trim();
    const token = store.nextToken(normalized);

    if (!normalized) {
      store.reset();
      closeTopbarSearchOverlay();
      return;
    }

    store.setLocalResults(runtimeConfig.collectLocalStarSearch?.(normalized, store.maxLocal));
    store.setServerResults([]);
    store.setServerPending(normalized.length >= 2);
    store.openOverlay();
    renderTopbarSearchOverlay();

    if (store.serverPending) {
      queueServerStarSearch(normalized, token);
    }
  }

  function initTopbarSearch() {
    if (initialized) return;
    initialized = true;

    const store = getTopbarSearchStore();
    const { wrap, toggle, menu, input, overlay } = getTopbarSearchDom();
    if (!store || !wrap || !input || !overlay || !menu || !toggle) return;

    const openSearchMenu = () => {
      runtimeConfig.closeCommanderMenuPanel?.();
      runtimeConfig.closeTopbarPlayerMenu?.();
      wrap.classList.add('open');
      menu.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
      runtimeConfig.setTopbarMenuFocusTrap?.(menu, toggle);
      runtimeConfig.syncTopbarBottomSheetState?.();
      runtimeConfig.focusFirstInTopbarMenu?.(menu, '#topbar-search-input');
    };

    input.addEventListener('input', () => runTopbarSearch(input.value));
    input.addEventListener('focus', () => {
      if (!String(input.value || '').trim()) return;
      openSearchMenu();
      store.openOverlay();
      renderTopbarSearchOverlay();
    });

    toggle.addEventListener('click', () => {
      const willOpen = menu.classList.contains('hidden');
      if (willOpen) openSearchMenu();
      else closeTopbarSearchOverlay();
    });

    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTopbarSearchOverlay();
        input.blur();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const candidate = store.firstCandidate();
        if (candidate) {
          await runtimeConfig.onJumpToSearchStar?.(candidate);
          closeTopbarSearchOverlay();
        }
      }
    });

    runtimeConfig.documentRef?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!wrap.contains(target)) closeTopbarSearchOverlay();
    });

    runtimeConfig.windowRef?.addEventListener('keydown', (event) => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const active = runtimeConfig.documentRef?.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
          return;
        }
        event.preventDefault();
        openSearchMenu();
        input.focus();
      }
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      configureTopbarSearchRuntime,
      getTopbarSearchDom,
      closeTopbarSearchOverlay,
      renderTopbarSearchOverlay,
      initTopbarSearch,
    };
  } else {
    window.GQRuntimeTopbarSearch = {
      configureTopbarSearchRuntime,
      getTopbarSearchDom,
      closeTopbarSearchOverlay,
      renderTopbarSearchOverlay,
      initTopbarSearch,
    };
  }
})();