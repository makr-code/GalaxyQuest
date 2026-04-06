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

  // ── GQ default window configurations ───────────────────────────────────────
  var GQ_WINDOW_DEFAULTS = {
    overview:    { title: 'Overview',    w: 860, h: 540 },
    buildings:   { title: 'Buildings',   w: 680, h: 540 },
    research:    { title: 'Research',    w: 680, h: 540 },
    shipyard:    { title: 'Shipyard',    w: 740, h: 540 },
    fleet:       { title: 'Fleet',       w: 640, h: 640 },
    galaxy:      { title: 'Galaxy Map',  w: 860, h: 540 },
    messages:    { title: 'Messages',    w: 640, h: 520 },
    quests:      { title: 'Quests',      w: 860, h: 620 },
    leaderboard: { title: 'Leaderboard', w: 540, h: 480 },
  };

  // ── GQ viewport insets (live DOM measurement) ───────────────────────────────
  function getGQViewportInsets() {
    var viewportH  = Math.max(220, window.innerHeight ||
      (document.documentElement && document.documentElement.clientHeight) || 720);
    var topInset   = 0;
    var bottomInset= 0;

    var topSection = document.getElementById('topbar-section');
    if (topSection instanceof HTMLElement) {
      var topStyle = window.getComputedStyle(topSection);
      var topRect  = topSection.getBoundingClientRect();
      if (topStyle.display !== 'none' && topStyle.visibility !== 'hidden' && topRect.height > 0) {
        topInset = Math.max(topInset, Math.max(0, Math.round(topRect.bottom)));
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

    return { top: topInset, bottom: bottomInset, left: 0, right: 0 };
  }

  // ── German UI labels ────────────────────────────────────────────────────────
  var GQ_LABELS = {
    restore:          'Wiederherstellen',
    focus:            'Fokussieren',
    minimize:         'Minimieren',
    dockLeft:         'Links andocken',
    dockRight:        'Rechts andocken',
    dockBottom:       'Unten andocken',
    resetPosition:    'Position zur\u00fccksetzen',
    close:            'Schliessen',
    noRecentClosed:   'Keine zuletzt geschlossenen Fenster',
    clearList:        'Liste leeren',
    recentClosedTitle:'Zuletzt geschlossen',
    showRecentClosed: 'Zuletzt geschlossene Fenster anzeigen',
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
  });

}());

if (typeof WMWidgets !== 'undefined') WM.widgets = WMWidgets;

if (typeof window !== 'undefined') {
  window.WM = WM;
}
