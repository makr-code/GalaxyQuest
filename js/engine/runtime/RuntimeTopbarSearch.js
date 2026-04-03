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

  const templates = {
    item: '<button type="button" class="topbar-search-item" data-search-source="{{{source}}}" data-search-index="{{{index}}}" role="option"><div class="topbar-search-title">{{{name}}}</div><div class="topbar-search-meta">{{{coords}}} | {{{starClass}}} | {{{origin}}}</div></button>',
    sections: '<div class="topbar-search-section"><div class="topbar-search-head">Lokal (Three)</div>{{{localHtml}}}</div><div class="topbar-search-section"><div class="topbar-search-head">Server-Erweiterung</div>{{{serverHtml}}}</div>',
  };

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
      overlay.innerHTML = '';
      return;
    }

    const localRows = Array.isArray(store.localResults) ? store.localResults : [];
    const serverRows = Array.isArray(store.serverResults) ? store.serverResults : [];
    const renderRow = (star, source, index) => {
      const name = star?.name || star?.catalog_name || `System ${Number(star?.system_index || 0)}`;
      const cls = `${String(star?.spectral_class || '?')}${String(star?.subtype || '')}`;
      const g = Number(star?.galaxy_index || runtimeConfig.getActiveGalaxy?.() || 1);
      const s = Number(star?.system_index || 0);
      return runtimeConfig.renderInlineTemplate?.(templates.item, {
        source: runtimeConfig.esc?.(source),
        index: runtimeConfig.esc?.(String(index)),
        name: runtimeConfig.esc?.(name),
        coords: runtimeConfig.esc?.(`${g}:${s}`),
        starClass: runtimeConfig.esc?.(cls),
        origin: source === 'local' ? 'lokal (3D)' : 'server',
      });
    };

    const localHtml = localRows.length
      ? localRows.map((star, idx) => renderRow(star, 'local', idx)).join('')
      : '<div class="topbar-search-empty">Keine lokalen Treffer im aktuell geladenen 3D-Sternfeld.</div>';

    const serverHtml = store.serverPending
      ? '<div class="topbar-search-empty">Server-Suche laeuft...</div>'
      : (serverRows.length
        ? serverRows.map((star, idx) => renderRow(star, 'server', idx)).join('')
        : '<div class="topbar-search-empty">Keine zusaetzlichen Server-Treffer.</div>');

    overlay.innerHTML = runtimeConfig.renderInlineTemplate?.(templates.sections, {
      localHtml,
      serverHtml,
    });
    overlay.classList.remove('hidden');

    overlay.querySelectorAll('.topbar-search-item').forEach((button) => {
      button.addEventListener('click', async () => {
        const source = String(button.getAttribute('data-search-source') || 'local');
        const index = Number(button.getAttribute('data-search-index') || -1);
        const list = source === 'server' ? serverRows : localRows;
        const star = (index >= 0 && index < list.length) ? list[index] : null;
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