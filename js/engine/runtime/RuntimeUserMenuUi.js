/**
 * RuntimeUserMenuUi.js
 *
 * Commander split-button menu UI orchestration.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

(function () {
  function closeUserMenuUi(opts = {}) {
    const {
      WM = null,
      documentRef = (typeof document !== 'undefined' ? document : null),
    } = opts;

    const wrap = documentRef?.getElementById('user-menu-wrap');
    const btn = documentRef?.getElementById('commander-name');
    const arrow = documentRef?.getElementById('commander-menu-arrow');
    if (WM && typeof WM.closeContextMenu === 'function') WM.closeContextMenu();
    if (wrap) wrap.classList.remove('open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    if (arrow) arrow.setAttribute('aria-expanded', 'false');
  }

  function openUserMenuUi(opts = {}) {
    const {
      WM = null,
      settingsState = {},
      onCloseTopbarSearchOverlay = () => {},
      onCloseTopbarPlayerMenu = () => {},
      onMenuAction = null,
      onCloseUserMenu = null,
      documentRef = (typeof document !== 'undefined' ? document : null),
    } = opts;

    const wrap = documentRef?.getElementById('user-menu-wrap');
    const btn = documentRef?.getElementById('commander-name');
    const arrow = documentRef?.getElementById('commander-menu-arrow');
    if (!btn || !arrow || !WM || typeof WM.contextMenu !== 'function') return;

    onCloseTopbarSearchOverlay();
    onCloseTopbarPlayerMenu();

    const meta = window._GQ_meta || {};
    const username = String(meta.username || btn.textContent || 'Commander').trim() || 'Commander';
    const isAdmin = Number(meta.is_admin || 0) === 1;

    const closeMenu = () => {
      if (typeof onCloseUserMenu === 'function') onCloseUserMenu();
      else closeUserMenuUi({ WM, documentRef });
    };
    const runAction = (action) => {
      if (typeof onMenuAction === 'function') onMenuAction(action);
    };

    const items = [
      {
        label: 'Einstellungen',
        onSelect: () => {
          closeMenu();
          if (WM && typeof WM.modal === 'function') WM.modal('settings-modal');
        },
      },
      {
        label: settingsState.masterMuted ? 'Ton aktivieren' : 'Ton stummschalten',
        onSelect: () => {
          closeMenu();
          runAction('toggle-master-mute');
        },
      },
      {
        label: 'Transition-Preset wechseln',
        onSelect: () => {
          closeMenu();
          runAction('cycle-transition');
        },
      },
      {
        label: 'Home-Navigation wechseln',
        onSelect: () => {
          closeMenu();
          runAction('toggle-home-enter');
        },
      },
      {
        label: 'Intro-Flight wechseln',
        onSelect: () => {
          closeMenu();
          runAction('cycle-intro-flight');
        },
      },
      { type: 'separator' },
      {
        label: 'PvP umschalten',
        onSelect: () => {
          closeMenu();
          runAction('toggle-pvp');
        },
      },
      {
        label: 'Profildaten neu laden',
        onSelect: () => {
          closeMenu();
          runAction('refresh-profile');
        },
      },
    ];

    if (isAdmin) {
      items.push({
        label: 'Users (Admin)',
        onSelect: () => {
          closeMenu();
          if (WM && typeof WM.open === 'function') WM.open('admin-users');
        },
      });
    }

    items.push({ type: 'separator' });
    items.push({
      label: 'Logout',
      danger: true,
      onSelect: () => {
        closeMenu();
        runAction('logout');
      },
    });

    const rect = arrow.getBoundingClientRect();
    WM.contextMenu(items, {
      title: username,
      x: Math.max(8, Number(rect.right || rect.left || 0) - 8),
      y: Math.max(8, Number(rect.bottom || rect.top || 0) + 6),
    });

    if (wrap) wrap.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    arrow.setAttribute('aria-expanded', 'true');
  }

  function toggleUserMenuUi(opts = {}) {
    const {
      documentRef = (typeof document !== 'undefined' ? document : null),
      onCloseUserMenu = null,
      onOpenUserMenu = null,
    } = opts;
    const arrow = documentRef?.getElementById('commander-menu-arrow');
    if (!arrow) return;
    if (arrow.getAttribute('aria-expanded') === 'true') {
      if (typeof onCloseUserMenu === 'function') onCloseUserMenu();
    } else if (typeof onOpenUserMenu === 'function') {
      onOpenUserMenu();
    }
  }

  function initUserMenuBindings(opts = {}) {
    const {
      WM = null,
      onCloseUserMenu = null,
      onToggleUserMenu = null,
      documentRef = (typeof document !== 'undefined' ? document : null),
      windowRef = (typeof window !== 'undefined' ? window : null),
    } = opts;

    const wrap = documentRef?.getElementById('user-menu-wrap');
    const btn = documentRef?.getElementById('commander-name');
    const arrow = documentRef?.getElementById('commander-menu-arrow');
    if (!wrap || !btn || !arrow) return;

    if (wrap.__gqCommanderSplitBound) return;
    wrap.__gqCommanderSplitBound = true;

    const closeMenu = () => {
      if (typeof onCloseUserMenu === 'function') onCloseUserMenu();
      else closeUserMenuUi({ WM, documentRef });
    };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      if (WM && typeof WM.modal === 'function') WM.modal('settings-modal');
    });

    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onToggleUserMenu === 'function') onToggleUserMenu();
    });

    documentRef.addEventListener('click', (e) => {
      const target = e.target;
      const NodeCtor = windowRef?.Node;
      if (NodeCtor && !(target instanceof NodeCtor)) return;
      if (!wrap.contains(target)) {
        closeMenu();
      }
    });

    windowRef?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      closeUserMenuUi,
      openUserMenuUi,
      toggleUserMenuUi,
      initUserMenuBindings,
    };
  } else {
    window.GQRuntimeUserMenuUi = {
      closeUserMenuUi,
      openUserMenuUi,
      toggleUserMenuUi,
      initUserMenuBindings,
    };
  }
})();
