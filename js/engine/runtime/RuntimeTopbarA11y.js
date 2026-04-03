/**
 * RuntimeTopbarA11y.js
 *
 * Topbar bottom-sheet, focus trap, and related menu close helpers.
 */

'use strict';

(function () {
  const runtimeConfig = {
    wm: null,
    documentRef: (typeof document !== 'undefined' ? document : null),
    windowRef: (typeof window !== 'undefined' ? window : null),
    localStorageRef: (typeof localStorage !== 'undefined' ? localStorage : null),
    navigatorRef: (typeof navigator !== 'undefined' ? navigator : null),
  };

  const focusTrapState = {
    container: null,
    returnEl: null,
  };

  const backgroundIds = [
    'resource-section',
    'left_sidebar',
    'right_sidebar',
    'taskbar-section',
    'terminal-section',
    'modal_container',
    'context_menu_container',
  ];

  let debugIndicatorNode = null;
  let listenersInitialized = false;

  function configureTopbarA11yRuntime(options = {}) {
    Object.assign(runtimeConfig, options || {});
  }

  function isTopbarBottomSheetMode() {
    try {
      return runtimeConfig.windowRef?.matchMedia('(max-width: 560px) and (hover: none) and (pointer: coarse)').matches;
    } catch (_) {
      const smallScreen = Number(runtimeConfig.windowRef?.innerWidth || 0) <= 560;
      const coarsePointer = Number(runtimeConfig.navigatorRef?.maxTouchPoints || 0) > 0;
      return smallScreen && coarsePointer;
    }
  }

  function isTopbarSheetDebugEnabled() {
    try {
      const search = String(runtimeConfig.windowRef?.location?.search || '');
      const params = new URLSearchParams(search);
      if (params.get('debugTopbarSheet') === '1') return true;
    } catch (_) {
      // Ignore query parsing failures.
    }
    try {
      return runtimeConfig.localStorageRef?.getItem('gq.debug.topbarSheet') === '1';
    } catch (_) {
      return false;
    }
  }

  function ensureTopbarDebugIndicator() {
    if (!isTopbarSheetDebugEnabled()) return null;
    if (debugIndicatorNode instanceof HTMLElement && runtimeConfig.documentRef?.body?.contains(debugIndicatorNode)) {
      return debugIndicatorNode;
    }
    const node = runtimeConfig.documentRef?.createElement('aside');
    if (!(node instanceof HTMLElement)) return null;
    node.className = 'gq-topbar-debug-indicator';
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-label', 'Topbar Bottom Sheet Debug');
    node.innerHTML = '<strong>Topbar Debug</strong><div class="gq-topbar-debug-indicator-body"></div>';
    runtimeConfig.documentRef?.body?.appendChild(node);
    debugIndicatorNode = node;
    return node;
  }

  function updateTopbarDebugIndicator(state = null) {
    const node = ensureTopbarDebugIndicator();
    if (!(node instanceof HTMLElement)) return;

    const body = runtimeConfig.documentRef?.body;
    const data = state || {};
    const inBottomSheetMode = !!data.inBottomSheetMode;
    const searchOpen = !!data.searchOpen;
    const playerOpen = !!data.playerOpen;
    const scrollLock = !!(body && body.classList.contains('gq-mobile-sheet-open'));
    const trappedId = focusTrapState.container?.id || '-';
    const activeEl = runtimeConfig.documentRef?.activeElement;
    const activeLabel = activeEl instanceof HTMLElement
      ? (activeEl.id ? `#${activeEl.id}` : activeEl.tagName.toLowerCase())
      : '-';

    const bodyEl = node.querySelector('.gq-topbar-debug-indicator-body');
    if (!(bodyEl instanceof HTMLElement)) return;
    bodyEl.textContent = `mode:${inBottomSheetMode ? 'bottom-sheet' : 'normal'} | search:${searchOpen ? 'open' : 'closed'} | player:${playerOpen ? 'open' : 'closed'} | lock:${scrollLock ? 'on' : 'off'} | trap:${trappedId} | focus:${activeLabel}`;
  }

  function applyTopbarBackgroundInert(enabled) {
    backgroundIds.forEach((id) => {
      const node = runtimeConfig.documentRef?.getElementById(id);
      if (!(node instanceof HTMLElement)) return;

      if (enabled) {
        if (!node.hasAttribute('data-gq-prev-aria-hidden')) {
          const prevAriaHidden = node.getAttribute('aria-hidden');
          node.setAttribute('data-gq-prev-aria-hidden', prevAriaHidden === null ? '__none__' : prevAriaHidden);
        }
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('inert', '');
        return;
      }

      if (node.hasAttribute('data-gq-prev-aria-hidden')) {
        const prev = node.getAttribute('data-gq-prev-aria-hidden');
        if (prev === '__none__') node.removeAttribute('aria-hidden');
        else if (prev !== null) node.setAttribute('aria-hidden', prev);
        node.removeAttribute('data-gq-prev-aria-hidden');
      } else {
        node.removeAttribute('aria-hidden');
      }
      node.removeAttribute('inert');
    });
  }

  function syncTopbarBottomSheetA11y(state) {
    const inBottomSheetMode = !!state?.inBottomSheetMode;
    const searchOpen = !!state?.searchOpen;
    const playerOpen = !!state?.playerOpen;
    const searchMenu = state?.searchMenu;
    const playerMenu = state?.playerMenu;
    const anyOpen = searchOpen || playerOpen;

    if (searchMenu instanceof HTMLElement) {
      if (inBottomSheetMode && searchOpen) searchMenu.setAttribute('aria-modal', 'true');
      else searchMenu.removeAttribute('aria-modal');
    }

    if (playerMenu instanceof HTMLElement) {
      if (inBottomSheetMode && playerOpen) playerMenu.setAttribute('aria-modal', 'true');
      else playerMenu.removeAttribute('aria-modal');
    }

    applyTopbarBackgroundInert(inBottomSheetMode && anyOpen);
  }

  function syncTopbarBottomSheetState() {
    const body = runtimeConfig.documentRef?.body;
    if (!body || !body.classList.contains('game-page')) return;

    const searchMenu = runtimeConfig.documentRef?.getElementById('topbar-search-menu');
    const playerMenu = runtimeConfig.documentRef?.getElementById('topbar-player-menu');
    const searchOpen = !!(searchMenu && !searchMenu.classList.contains('hidden'));
    const playerOpen = !!(playerMenu && !playerMenu.classList.contains('hidden'));
    const inBottomSheetMode = isTopbarBottomSheetMode();
    const shouldLock = inBottomSheetMode && (searchOpen || playerOpen);

    syncTopbarBottomSheetA11y({
      inBottomSheetMode,
      searchOpen,
      playerOpen,
      searchMenu,
      playerMenu,
    });

    body.classList.toggle('gq-mobile-sheet-open', shouldLock);
    updateTopbarDebugIndicator({ inBottomSheetMode, searchOpen, playerOpen });
  }

  function focusFirstInTopbarMenu(container, preferredSelector = '') {
    if (!(container instanceof HTMLElement)) return;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let target = null;
    if (preferredSelector) target = container.querySelector(preferredSelector);
    if (!(target instanceof HTMLElement)) target = container.querySelector(focusableSelector);
    if (target instanceof HTMLElement && typeof target.focus === 'function') {
      target.focus();
    }
  }

  function setTopbarMenuFocusTrap(container, returnEl) {
    if (!(container instanceof HTMLElement)) return;
    focusTrapState.container = container;
    focusTrapState.returnEl = returnEl instanceof HTMLElement ? returnEl : null;
    updateTopbarDebugIndicator();
  }

  function clearTopbarMenuFocusTrap({ restoreFocus = false } = {}) {
    const returnEl = focusTrapState.returnEl;
    focusTrapState.container = null;
    focusTrapState.returnEl = null;
    if (restoreFocus && returnEl && typeof returnEl.focus === 'function') {
      returnEl.focus();
    }
    updateTopbarDebugIndicator();
  }

  function isTopbarMenuFocusTrapped(menu) {
    return focusTrapState.container === menu;
  }

  function closeCommanderMenuPanel() {
    const wrap = runtimeConfig.documentRef?.getElementById('user-menu-wrap');
    const btn = runtimeConfig.documentRef?.getElementById('commander-name');
    const arrow = runtimeConfig.documentRef?.getElementById('commander-menu-arrow');
    if (runtimeConfig.wm && typeof runtimeConfig.wm.closeContextMenu === 'function') {
      runtimeConfig.wm.closeContextMenu();
    }
    if (wrap) wrap.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (arrow) arrow.setAttribute('aria-expanded', 'false');
  }

  function closeTopbarPlayerMenu() {
    const menuWrap = runtimeConfig.documentRef?.getElementById('topbar-player');
    const menu = runtimeConfig.documentRef?.getElementById('topbar-player-menu');
    const menuToggle = runtimeConfig.documentRef?.getElementById('topbar-player-menu-toggle');
    if (menu) menu.classList.add('hidden');
    if (menuWrap) menuWrap.classList.remove('open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    if (isTopbarMenuFocusTrapped(menu)) {
      clearTopbarMenuFocusTrap({ restoreFocus: true });
    }
    syncTopbarBottomSheetState();
  }

  function initTopbarA11yRuntime() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    runtimeConfig.documentRef?.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const container = focusTrapState.container;
      if (!(container instanceof HTMLElement) || container.classList.contains('hidden')) {
        clearTopbarMenuFocusTrap();
        return;
      }

      const focusable = container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = runtimeConfig.documentRef?.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        if (last instanceof HTMLElement) last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        if (first instanceof HTMLElement) first.focus();
      }
    });

    runtimeConfig.windowRef?.addEventListener('resize', () => {
      syncTopbarBottomSheetState();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      configureTopbarA11yRuntime,
      initTopbarA11yRuntime,
      focusFirstInTopbarMenu,
      syncTopbarBottomSheetState,
      setTopbarMenuFocusTrap,
      clearTopbarMenuFocusTrap,
      isTopbarMenuFocusTrapped,
      closeCommanderMenuPanel,
      closeTopbarPlayerMenu,
    };
  } else {
    window.GQRuntimeTopbarA11y = {
      configureTopbarA11yRuntime,
      initTopbarA11yRuntime,
      focusFirstInTopbarMenu,
      syncTopbarBottomSheetState,
      setTopbarMenuFocusTrap,
      clearTopbarMenuFocusTrap,
      isTopbarMenuFocusTrapped,
      closeCommanderMenuPanel,
      closeTopbarPlayerMenu,
    };
  }
})();