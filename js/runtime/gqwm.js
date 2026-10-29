/**
 * GQWM – GalaxyQuest Window Manager
 *
 * GalaxyQuest-specific WM instance.
 * Wraps WMCore (js/runtime/wm.js) with:
 *   - GQ default window configurations
 *   - GQ localStorage key prefix  ('gq_')
 *   - GQ cookie key               ('gq_wm_state_v1')
 *   - Live viewport insets from   #topbar-section / #taskbar-section
 *   - German UI labels
 *
 * Exposes global `window.WM` for backward compatibility.
 * Depends on: WMCore (js/runtime/wm.js), GQUI (js/ui/gq-ui.js)
 */
const WM = (function () {

  var CONSOLE_TITLEBAR_HEIGHT_KEY = 'gq_console_titlebar_height_px';

  function clampConsoleTitlebarHeight(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 18;
    return Math.max(15, Math.min(20, Math.round(n)));
  }

  function applyConsoleTitlebarHeight(valuePx) {
    var height = clampConsoleTitlebarHeight(valuePx);
    try {
      document.documentElement.style.setProperty('--gq-console-titlebar-height', String(height) + 'px');
    } catch (_) {}
    try {
      localStorage.setItem(CONSOLE_TITLEBAR_HEIGHT_KEY, String(height));
    } catch (_) {}
    return height;
  }

  function initConsoleTitlebarHeight() {
    var fallback = 18;
    try {
      var raw = localStorage.getItem(CONSOLE_TITLEBAR_HEIGHT_KEY);
      if (raw == null || raw === '') {
        document.documentElement.style.setProperty('--gq-console-titlebar-height', String(fallback) + 'px');
        return fallback;
      }
      return applyConsoleTitlebarHeight(raw);
    } catch (_) {
      try {
        document.documentElement.style.setProperty('--gq-console-titlebar-height', String(fallback) + 'px');
      } catch (__){ }
      return fallback;
    }
  }

  // ── GQ default window configurations ───────────────────────────────────────
  var GQ_WINDOW_DEFAULTS = {
    overview:    { title: 'Overview',    w: 860, h: 540 },
    buildings:   { title: 'Buildings',   w: 680, h: 540 },
    research:    { title: 'Research',    w: 680, h: 540 },
    shipyard:    { title: 'Shipyard',    w: 740, h: 540 },
    fleet:       { title: 'Fleet',       w: 640, h: 640 },
    galaxy:      { title: 'Galaxy Map',  w: 860, h: 540 },
    console:     { title: 'Console',     w: 1280, h: 170, defaultDock: 'bottom', autoDockOnOpen: true, forceDockSide: 'bottom', dockBottomFullWidth: true, dockMargin: 12, defaultDockMargin: 12, dockBottomInset: 0, minHeight: 120, maxHeight: 260, ignoreSavedSize: true, keepExistingGeometry: false, dockable: true, dockableSides: ['bottom', 'left', 'right'] },
    messages:    { title: 'Messages',    w: 640, h: 520 },
    quests:      { title: 'Quests',      w: 860, h: 620 },
    leaderboard: { title: 'Leaderboard', w: 540, h: 480 },
    'system-bodies-cards': { title: 'System Bodies', w: 740, h: 500 },
  };

  // ── GQ viewport insets (live DOM measurement) ───────────────────────────────
  function getGQViewportInsets() {
    var viewportH  = Math.max(220, window.innerHeight ||
      (document.documentElement && document.documentElement.clientHeight) || 720);
    var topInset   = 0;
    var bottomInset= 0;

    var topSection = document.getElementById('topbar-section');
    var titlebarBottom = null;
    if (topSection instanceof HTMLElement) {
      var topStyle = window.getComputedStyle(topSection);
      var topRect  = topSection.getBoundingClientRect();
      if (topStyle.display !== 'none' && topStyle.visibility !== 'hidden' && topRect.height > 0) {
        titlebarBottom = Math.max(0, Math.round(topRect.bottom));
        topInset = Math.max(topInset, Math.max(0, Math.round(topRect.bottom)));
      }
    }

    var resourceSection = document.getElementById('resource-section');
    var resourceBottom = null;
    if (resourceSection instanceof HTMLElement) {
      var resourceStyle = window.getComputedStyle(resourceSection);
      var resourceRect  = resourceSection.getBoundingClientRect();
      if (resourceStyle.display !== 'none' && resourceStyle.visibility !== 'hidden' && resourceRect.height > 0) {
        resourceBottom = Math.max(0, Math.round(resourceRect.bottom));
        topInset = Math.max(topInset, Math.max(0, Math.round(resourceRect.bottom)));
      }
    }

    var taskbarSection = document.getElementById('taskbar-section');
    if (taskbarSection instanceof HTMLElement) {
      var tbStyle = window.getComputedStyle(taskbarSection);
      var tbRect  = taskbarSection.getBoundingClientRect();
      if (tbStyle.display !== 'none' && tbStyle.visibility !== 'hidden' && tbRect.height > 0) {
        bottomInset = Math.max(bottomInset, Math.max(0, Math.round(viewportH - tbRect.top)));
      }
    }

    return {
      top: topInset,
      bottom: bottomInset,
      left: 0,
      right: 0,
      titlebarBottom: titlebarBottom,
      resourceBottom: resourceBottom,
    };
  }

  // ── German UI labels ────────────────────────────────────────────────────────
  var GQ_LABELS = {
    restore:          'Wiederherstellen',
    focus:            'Fokussieren',
    minimize:         'Minimieren',
    dockLeft:         'Links andocken',
    dockRight:        'Rechts andocken',
    dockTopbar:       'An Titelbar andocken',
    dockResource:     'An Ressourcenleiste andocken',
    dockTop:          'Oben andocken',
    dockBottom:       'Unten andocken',
    resetPosition:    'Position zur\u00fccksetzen',
    close:            'Schliessen',
    noRecentClosed:   'Keine zuletzt geschlossenen Fenster',
    clearList:        'Liste leeren',
    recentClosedTitle:'Zuletzt geschlossen',
    showRecentClosed: 'Zuletzt geschlossene Fenster anzeigen',
    commandPalette:   'Befehlspalette',
    noCommands:       'Keine Befehle gefunden',
    saveLayout:       'Layout speichern',
    loadLayout:       'Layout laden',
    snapLeft:         'Snap: Links',
    snapRight:        'Snap: Rechts',
    snapTop:          'Snap: Oben',
    snapBottom:       'Snap: Unten',
    tileWithSelected: 'Mit Auswahl kacheln',
    createDockGroup:  'Gruppe erstellen',
  };

  // ── Instantiate WMCore with GQ-specific configuration ─────────────────────
  return WMCore.create({
    storagePrefix:     'gq_',
    cookieKey:         'gq_wm_state_v1',
    cookieDays:        60,
    mobileBreakpoint:  800,
    recentClosedLimit: 10,
    getViewportInsets: getGQViewportInsets,
    windowDefaults:    GQ_WINDOW_DEFAULTS,
    labels:            GQ_LABELS,
    supportedThemes:   ['nebula', 'alliance', 'raider', 'zenith', 'dusk',
                        'dark', 'light', 'gq-blue', 'gq-red', 'gq-green', 'high-contrast'],
    defaultTheme:      'nebula',
  });

}());

if (typeof WMWidgets !== 'undefined') WM.widgets = WMWidgets;

// ── Theme bridge: emit custom event whenever WM theme changes ──────────────
// Game runtime can listen to 'gq:wm-theme-changed' to react (e.g. update
// settings panel).  Also listen on 'gq:theme-changed' to re-apply WM class.
(function () {
  var origSetTheme = WM.setTheme;
  if (typeof origSetTheme === 'function') {
    WM.setTheme = function (themeName, optsTheme) {
      var result = origSetTheme.call(WM, themeName, optsTheme);
      try {
        window.dispatchEvent(new CustomEvent('gq:wm-theme-changed', {
          detail: { theme: result, opts: optsTheme || {} },
        }));
      } catch (_) {}
      return result;
    };
  }

  // When the game palette changes theme (faction / custom), keep WM theme class.
  window.addEventListener('gq:theme-changed', function (ev) {
    try {
      var source = (ev && ev.detail && ev.detail.source) ? String(ev.detail.source) : '';
      // Map game theme sources → WM theme tokens heuristically.
      if (typeof WM.applyTheme !== 'function') return;
      if (source === 'custom' || source === 'faction') {
        // Keep whatever the user explicitly set via WM; do not override.
        return;
      }
      WM.applyTheme({});
    } catch (_) {}
  });
}());

if (typeof window !== 'undefined') {
  var consoleTitlebarKey = 'gq_console_titlebar_height_px';
  var clampConsoleTitlebarHeightGlobal = function (value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 18;
    return Math.max(15, Math.min(20, Math.round(n)));
  };
  var applyConsoleTitlebarHeightGlobal = function (valuePx) {
    var height = clampConsoleTitlebarHeightGlobal(valuePx);
    try {
      document.documentElement.style.setProperty('--gq-console-titlebar-height', String(height) + 'px');
    } catch (_) {}
    try {
      localStorage.setItem(consoleTitlebarKey, String(height));
    } catch (_) {}
    return height;
  };
  var initConsoleTitlebarHeightGlobal = function () {
    var fallback = 18;
    try {
      var raw = localStorage.getItem(consoleTitlebarKey);
      if (raw == null || raw === '') {
        document.documentElement.style.setProperty('--gq-console-titlebar-height', String(fallback) + 'px');
        return fallback;
      }
      return applyConsoleTitlebarHeightGlobal(raw);
    } catch (_) {
      try {
        document.documentElement.style.setProperty('--gq-console-titlebar-height', String(fallback) + 'px');
      } catch (__){ }
      return fallback;
    }
  };

  window.WM = WM;
  window.GQConsoleChrome = {
    getSmallTitlebarHeight: function () {
      try {
        var raw = getComputedStyle(document.documentElement).getPropertyValue('--gq-console-titlebar-height');
        return clampConsoleTitlebarHeightGlobal(parseInt(String(raw || '').replace('px', '').trim(), 10));
      } catch (_) {
        return 18;
      }
    },
    setSmallTitlebarHeight: function (valuePx) {
      return applyConsoleTitlebarHeightGlobal(valuePx);
    },
    resetSmallTitlebarHeight: function () {
      try { localStorage.removeItem(consoleTitlebarKey); } catch (_) {}
      return applyConsoleTitlebarHeightGlobal(18);
    },
  };
  initConsoleTitlebarHeightGlobal();
}
