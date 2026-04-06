/**
 * WMCore – Generic Window Manager
 *
 * Framework-agnostic, reusable floating-window system.
 * Depends on: GQUI (js/ui/gq-ui.js) for DOM construction helpers.
 *
 * Usage
 * -----
 *   const wm = WMCore.create(opts);
 *
 * Options (opts)
 * --------------
 *   storagePrefix      (string)   localStorage key prefix.  Default: 'wm_'
 *   cookieKey          (string)   State-persistence cookie name.  Default: 'wm_state_v1'
 *   cookieDays         (number)   Cookie lifetime in days.  Default: 60
 *   mobileBreakpoint   (number)   px below which mobile mode activates.  Default: 800
 *   recentClosedLimit  (number)   Max entries in recent-closed list.  Default: 10
 *   defaultTheme       (string)   Fallback theme name. Default: 'nebula'
 *   supportedThemes    (string[]) Allowed theme names. Default: built-in set
 *   getViewportInsets  (function) () => { top, bottom, left, right } in px.
 *                                 Default: returns all zeros.
 *   windowDefaults     (object)   Map of id => { title, w, h } default configs.
 *   labels             (object)   UI label overrides (see DEFAULT_LABELS below).
 *
 * Public API (per instance)
 * -------------------------
 *   wm.register(id, cfg)         – register config (no open)
 *   wm.adopt(id, cfg)            – register + open an existing DOM container
 *   wm.open(id)                  – open or focus a named window
 *   wm.close(id)                 – close a window
 *   wm.refresh(id)               – re-run the registered render function
 *   wm.body(id)                  – returns the window's content <div> or null
 *   wm.isOpen(id)                – true if window exists and is not closed
 *   wm.setTitle(id, title)       – update a window's title bar text
 *   wm.modal(sectionId, opts)    – open a <section class="wm-modal"> dialog
 *   wm.contextMenu(items, opts)  – show a floating context menu
 *   wm.closeContextMenu()        – dismiss any open context menu
 *   wm.restorePersistedState()   – reopen windows from the state cookie
 *   wm.listThemes()              – list supported theme names
 *   wm.setTheme(theme, opts)     – set theme for scope: global|faction|user
 *   wm.getTheme(opts)            – read raw/effective theme for scope
 *   wm.clearTheme(opts)          – clear theme in scope
 *   wm.applyTheme(opts)          – resolve + apply effective theme to DOM
 */
const WMCore = (() => {

  // ── Default UI labels (English; override via opts.labels) ──────────────────
  const DEFAULT_LABELS = {
    restore:          'Restore',
    focus:            'Focus',
    minimize:         'Minimize',
    dockLeft:         'Dock left',
    dockRight:        'Dock right',
    dockBottom:       'Dock bottom',
    resetPosition:    'Reset position',
    close:            'Close',
    noRecentClosed:   'No recently closed windows',
    clearList:        'Clear list',
    recentClosedTitle:'Recently closed',
    showRecentClosed: 'Show recently closed windows',
    commandPalette:   'Command Palette',
    noCommands:       'No commands found',
    saveLayout:       'Save layout',
    loadLayout:       'Load layout',
    snapLeft:         'Snap left',
    snapRight:        'Snap right',
    snapTop:          'Snap top',
    snapBottom:       'Snap bottom',
    tileWithSelected: 'Tile with selection',
    createDockGroup:  'Create group',
  };

  // ── Factory ─────────────────────────────────────────────────────────────────
  function create(opts) {
    opts = opts || {};

    // ── Per-instance state ─────────────────────────────────────────────────
    /** @type {Map<string, {el:HTMLElement, hostEl:HTMLElement, cfg:object, minimized:boolean, adopted:boolean, preserveOnClose:boolean, hostManaged:boolean}>} */
    const _wins     = new Map();
    /** @type {Map<string, object>} */
    const _registry = new Map();

    let _topZ                 = 240;
    let _nextX                = 60;
    let _nextY                = 60;
    let _contextMenuState     = null;
    let _restoreAttempted     = false;
    let _isRestoringState     = false;
    let _recentClosed         = [];
    let _prebuiltHydrationDone= false;
    let _selectedWindows      = new Set();
    let _dockGroups           = new Map();
    let _dockGroupUis         = new Map();
    let _dockGroupCounter     = 0;
    let _commands             = new Map();
    let _hotkeyMap            = new Map(); // Map: "Ctrl+K" -> "command_id"
    let _lastSelectedWindowId  = null; // For Shift+click range selection
    let _focusHistory          = [];   // MRU list, most recent first
    let _paletteState         = null;

    // ── Configuration ──────────────────────────────────────────────────────
    const _storagePrefix    = String(opts.storagePrefix    != null ? opts.storagePrefix    : 'wm_');
    const _cookieKey        = String(opts.cookieKey        != null ? opts.cookieKey        : 'wm_state_v1');
    const _cookieDays       = Number(opts.cookieDays       != null ? opts.cookieDays       : 60);
    const _mobileBreakpoint = Number(opts.mobileBreakpoint != null ? opts.mobileBreakpoint : 800);
    const _recentClosedLimit= Number(opts.recentClosedLimit!= null ? opts.recentClosedLimit: 10);
    const _windowDefaults   = (opts.windowDefaults && typeof opts.windowDefaults === 'object')
                                ? Object.assign({}, opts.windowDefaults) : {};
    const _labels           = Object.assign({}, DEFAULT_LABELS, opts.labels || {});
    const _supportedThemes  = Array.isArray(opts.supportedThemes) && opts.supportedThemes.length
                  ? opts.supportedThemes.map(function (t) { return String(t || '').trim().toLowerCase(); }).filter(Boolean)
                  : ['nebula', 'alliance', 'raider', 'zenith', 'dusk'];
    const _defaultTheme     = String(opts.defaultTheme != null ? opts.defaultTheme : (_supportedThemes[0] || 'nebula')).trim().toLowerCase();
    const _getViewportInsets= typeof opts.getViewportInsets === 'function'
                                ? opts.getViewportInsets
                                : function () { return { top: 0, bottom: 0, left: 0, right: 0 }; };

    const _posPrefix  = _storagePrefix + 'wpos_';
    const _dockPrefix = _storagePrefix + 'wdock_';
    const _themeGlobalKey  = _storagePrefix + 'theme_global';
    const _themeFactionKey = _storagePrefix + 'theme_faction_';
    const _themeUserKey    = _storagePrefix + 'theme_user_';
    const _layoutProfilePrefix = _storagePrefix + 'layout_profile_';

    // ── Responsive ────────────────────────────────────────────────────────
    function _isMobileMode() {
      return (window.innerWidth || 0) < _mobileBreakpoint;
    }

    function _syncResponsiveClass() {
      const root = document.body || document.documentElement;
      if (!root) return;
      root.classList.toggle('wm-mobile', _isMobileMode());
    }

    window.addEventListener('resize', function () {
      _syncResponsiveClass();
      _syncFullscreenWindows();
    });
    _syncResponsiveClass();

    // ── Theme system (global/faction/user) ──────────────────────────────
    function _normalizeThemeName(name) {
      var raw = String(name != null ? name : '').trim().toLowerCase();
      if (!raw) return _defaultTheme;
      return _supportedThemes.indexOf(raw) >= 0 ? raw : _defaultTheme;
    }

    function _scopeKey(scope, refId) {
      var sid = String(scope || 'global').trim().toLowerCase();
      if (sid === 'user') return _themeUserKey + String(refId != null ? refId : 'default');
      if (sid === 'faction') return _themeFactionKey + String(refId != null ? refId : 'default');
      return _themeGlobalKey;
    }

    function _setThemeStored(scope, refId, themeName) {
      try {
        localStorage.setItem(_scopeKey(scope, refId), _normalizeThemeName(themeName));
      } catch (_) {}
    }

    function _getThemeStored(scope, refId) {
      try {
        var raw = localStorage.getItem(_scopeKey(scope, refId));
        if (!raw) return null;
        var norm = _normalizeThemeName(raw);
        return norm || null;
      } catch (_) {
        return null;
      }
    }

    function _clearThemeStored(scope, refId) {
      try {
        localStorage.removeItem(_scopeKey(scope, refId));
      } catch (_) {}
    }

    function _themeRoot() {
      return document.body || document.documentElement;
    }

    function _applyThemeClass(themeName) {
      var root = _themeRoot();
      if (!root || !root.classList) return themeName;
      var next = _normalizeThemeName(themeName);

      _supportedThemes.forEach(function (name) {
        root.classList.remove('wm-theme-' + name);
      });

      root.classList.add('wm-theme-' + next);
      root.setAttribute('data-wm-theme', next);
      return next;
    }

    function _resolveEffectiveTheme(optsTheme) {
      var o = optsTheme || {};
      var userId = o.userId != null ? o.userId : null;
      var factionId = o.factionId != null ? o.factionId : null;

      var userTheme = (userId != null) ? _getThemeStored('user', userId) : null;
      if (userTheme) return userTheme;

      var factionTheme = (factionId != null) ? _getThemeStored('faction', factionId) : null;
      if (factionTheme) return factionTheme;

      var globalTheme = _getThemeStored('global', null);
      if (globalTheme) return globalTheme;

      return _defaultTheme;
    }

    function listThemes() {
      return _supportedThemes.slice();
    }

    function setTheme(themeName, optsTheme) {
      var o = optsTheme || {};
      var scope = String(o.scope != null ? o.scope : 'global').trim().toLowerCase();
      var refId = (scope === 'user') ? o.userId : (scope === 'faction' ? o.factionId : null);
      var normalized = _normalizeThemeName(themeName);
      var persist = o.persist !== false;

      if (persist) _setThemeStored(scope, refId, normalized);
      if (o.apply !== false) _applyThemeClass(_resolveEffectiveTheme(o));
      return normalized;
    }

    function getTheme(optsTheme) {
      var o = optsTheme || {};
      if (o.effective === true) return _resolveEffectiveTheme(o);

      var scope = String(o.scope != null ? o.scope : 'global').trim().toLowerCase();
      var refId = (scope === 'user') ? o.userId : (scope === 'faction' ? o.factionId : null);
      return _getThemeStored(scope, refId) || null;
    }

    function clearTheme(optsTheme) {
      var o = optsTheme || {};
      var scope = String(o.scope != null ? o.scope : 'global').trim().toLowerCase();
      var refId = (scope === 'user') ? o.userId : (scope === 'faction' ? o.factionId : null);
      _clearThemeStored(scope, refId);
      if (o.apply !== false) _applyThemeClass(_resolveEffectiveTheme(o));
    }

    function applyTheme(optsTheme) {
      return _applyThemeClass(_resolveEffectiveTheme(optsTheme || {}));
    }

    applyTheme({});

    // ── Hotkey helper methods ────────────────────────────────────────────
    function _getHotkeyString(ev) {
      var parts = [];
      if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl');
      if (ev.altKey) parts.push('Alt');
      if (ev.shiftKey) parts.push('Shift');

      var key = '';
      if (ev.code === 'Backquote') key = 'BACKQUOTE';
      else key = String(ev.key || '').toUpperCase();

      if (key && key.length > 0 && key !== 'CONTROL' && key !== 'ALT' && key !== 'SHIFT' && key !== 'META') {
        parts.push(key);
      }
      return parts.join('+');
    }

    function _registerHotkey(commandId, hotkeyString) {
      var hk = String(hotkeyString || '').trim().toUpperCase();
      if (!hk || !commandId) return false;
      var cid = String(commandId).trim();
      var existing = _hotkeyMap.get(hk);
      // Reject conflicts across different commands; allow idempotent rebind.
      if (existing && existing !== cid) return false;
      _hotkeyMap.set(hk, cid);
      return true;
    }

    function _unregisterHotkey(hotkeyString) {
      var hk = String(hotkeyString || '').trim().toUpperCase();
      if (!hk) return false;
      return _hotkeyMap.delete(hk);
    }

    function _isEditableTarget(target) {
      if (!target || !(target instanceof Element)) return false;
      var tag = String(target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (target.isContentEditable) return true;
      var editableAncestor = target.closest('[contenteditable="true"], input, textarea, select');
      return !!editableAncestor;
    }

    function _handleGlobalKeydown(ev) {
      if (!ev || ev.defaultPrevented) return;
      var hk = _getHotkeyString(ev).toUpperCase();
      var cid = _hotkeyMap.get(hk);
      if (!cid) return;

      var cmd = _commands.get(cid);
      var active = document.activeElement;
      var target = ev.target;
      var isEditing = _isEditableTarget(target) || _isEditableTarget(active);
      if (isEditing && !(cmd && cmd.allowInInputs === true)) return;

      ev.preventDefault();
      executeCommand(cid, {});
    }

    // ── Commands / Palette ───────────────────────────────────────────────
    function _extractCommandShortcuts(cfg) {
      if (!cfg || typeof cfg !== 'object') return [];
      if (cfg.shortcuts) {
        return Array.isArray(cfg.shortcuts) ? cfg.shortcuts.slice() : [cfg.shortcuts];
      }
      if (cfg.shortcut) return [cfg.shortcut];
      return [];
    }

    function registerCommand(id, cfg) {
      var cid = String(id || '').trim();
      if (!cid) return false;
      var current = _commands.get(cid) || {};

      // Remove currently bound shortcuts for this command so updates don't
      // leave stale bindings behind.
      _extractCommandShortcuts(current).forEach(function (hk) {
        _unregisterHotkey(hk);
      });

      var next = Object.assign({ id: cid }, current, cfg || {});

      // Validate and reserve shortcuts atomically: if any conflicts, rollback.
      var shortcuts = _extractCommandShortcuts(next);
      var claimed = [];
      for (var i = 0; i < shortcuts.length; i++) {
        var hk = shortcuts[i];
        if (!_registerHotkey(cid, hk)) {
          claimed.forEach(function (bound) { _unregisterHotkey(bound); });
          // Restore previous bindings before aborting.
          _extractCommandShortcuts(current).forEach(function (oldHk) {
            _registerHotkey(cid, oldHk);
          });
          return false;
        }
        claimed.push(hk);
      }

      _commands.set(cid, next);
      return true;
    }

    function unregisterCommand(id) {
      var cid = String(id || '').trim();
      var cmd = _commands.get(cid);
      if (cmd) {
        var shortcuts = cmd.shortcuts
          ? (Array.isArray(cmd.shortcuts) ? cmd.shortcuts : [cmd.shortcuts])
          : (cmd.shortcut ? [cmd.shortcut] : []);
        shortcuts.forEach(function (hk) { _unregisterHotkey(hk); });
      }
      return _commands.delete(cid);
    }

    function executeCommand(id, payload) {
      var cid = String(id || '').trim();
      var cmd = _commands.get(cid);
      if (!cmd || typeof cmd.execute !== 'function') return false;
      try {
        cmd.execute(payload || {}, {
          wm: {
            open: open,
            close: close,
            refresh: refresh,
            body: body,
            isOpen: isOpen,
            contextMenu: contextMenu,
            executeCommand: executeCommand,
          },
          getOpenWindows: function () { return Array.from(_wins.keys()); },
          getSelectedWindows: getSelectedWindows,
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    function _normalizeCommandSearchText(value) {
      var raw = String(value || '').toLowerCase().trim();
      if (!raw) return '';
      return raw
        .replace(/\s*\+\s*/g, '+')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function listCommands(query) {
      var qRaw = String(query || '').trim().toLowerCase();
      var qNorm = _normalizeCommandSearchText(query);
      return Array.from(_commands.values()).filter(function (cmd) {
        if (!qRaw) return true;
        var shortcuts = _extractCommandShortcuts(cmd).join(' ');
        var hay = [cmd.id, cmd.label, cmd.category, cmd.shortcut, shortcuts, cmd.keywords]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (hay.indexOf(qRaw) >= 0) return true;
        if (!qNorm) return false;
        return _normalizeCommandSearchText(hay).indexOf(qNorm) >= 0;
      });
    }

    function hideCommandPalette() {
      if (!_paletteState) return;
      if (_paletteState.onKey) document.removeEventListener('keydown', _paletteState.onKey, true);
      if (_paletteState.root && _paletteState.root.parentNode) _paletteState.root.parentNode.removeChild(_paletteState.root);
      _paletteState = null;
    }

    function showCommandPalette(optsPalette) {
      optsPalette = optsPalette || {};
      hideCommandPalette();

      var host = document.body || document.documentElement;
      if (!host) return;

      var root = document.createElement('section');
      root.className = 'wm-command-palette';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-label', _labels.commandPalette || 'Command Palette');

      var panel = document.createElement('div');
      panel.className = 'wm-command-palette-panel';
      var input = document.createElement('input');
      input.className = 'wm-command-palette-input';
      input.type = 'search';
      input.placeholder = String(optsPalette.placeholder || _labels.commandPalette || 'Command Palette');

      var list = document.createElement('div');
      list.className = 'wm-command-palette-list';

      panel.appendChild(input);
      panel.appendChild(list);
      root.appendChild(panel);
      host.appendChild(root);

      var currentRows = [];
      var currentIndex = 0;

      function renderRows(query) {
        currentRows = listCommands(query);
        list.innerHTML = '';
        if (!currentRows.length) {
          var empty = document.createElement('div');
          empty.className = 'wm-command-palette-empty';
          empty.textContent = String(_labels.noCommands || 'No commands found');
          list.appendChild(empty);
          return;
        }
        currentRows.forEach(function (cmd, idx) {
          var shortcuts = _extractCommandShortcuts(cmd).map(function (s) { return String(s || '').trim(); }).filter(Boolean);
          var shortcutText = shortcuts.join(' / ');
          var inputBadge = cmd && cmd.allowInInputs === true
            ? '<span class="wm-command-palette-flag" title="Hotkey works in inputs">Input</span>'
            : '';
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'wm-command-palette-row' + (idx === currentIndex ? ' is-active' : '');
          row.innerHTML = '<span class="wm-command-palette-label">' + _esc(String(cmd.label || cmd.id || 'Command')) + '</span>'
            + '<span class="wm-command-palette-meta">'
            + (shortcutText ? '<span class="wm-command-palette-shortcut">' + _esc(shortcutText) + '</span>' : '')
            + inputBadge
            + '</span>';
          row.addEventListener('click', function () {
            executeCommand(cmd.id, { source: 'wm.commandPalette' });
            hideCommandPalette();
          });
          list.appendChild(row);
        });
      }

      function setActive(nextIndex) {
        currentIndex = Math.max(0, Math.min(nextIndex, Math.max(0, currentRows.length - 1)));
        Array.from(list.querySelectorAll('.wm-command-palette-row')).forEach(function (row, idx) {
          row.classList.toggle('is-active', idx === currentIndex);
        });
      }

      input.addEventListener('input', function () {
        currentIndex = 0;
        renderRows(input.value);
      });

      var onKey = function (ev) {
        if (!_paletteState) return;
        if (ev.key === 'Escape') {
          ev.preventDefault();
          hideCommandPalette();
          return;
        }
        if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive(currentIndex + 1); return; }
        if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive(currentIndex - 1); return; }
        if (ev.key === 'Home') { ev.preventDefault(); setActive(0); return; }
        if (ev.key === 'End') { ev.preventDefault(); setActive(currentRows.length - 1); return; }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var cmd = currentRows[currentIndex];
          if (cmd) {
            executeCommand(cmd.id, { source: 'wm.commandPalette' });
            hideCommandPalette();
          }
        }
      };

      _paletteState = { root: root, onKey: onKey };
      document.addEventListener('keydown', onKey, true);

      renderRows('');
      requestAnimationFrame(function () { input.focus(); });
    }

    function _registerBuiltinCommands() {
      registerCommand('wm.palette.show', {
        label: _labels.commandPalette || 'Command Palette',
        shortcut: 'Ctrl+K',
        execute: function () { showCommandPalette({}); },
      });
      registerCommand('wm.tile.2x2', {
        label: 'Tile Windows 2x2',
        execute: function () { tileWindows('2x2'); },
      });
      registerCommand('wm.tile.3col', {
        label: 'Tile Windows 3 Columns',
        execute: function () { tileWindows('3col'); },
      });
      registerCommand('wm.tile.selected.2x2', {
        label: 'Tile Selected Windows 2x2',
        execute: function () { tileSelected('2x2'); },
      });
      registerCommand('wm.layout.save.quick', {
        label: 'Save Layout: Quick',
        execute: function () { saveLayoutProfile('quick', { scope: 'global' }); },
      });
      registerCommand('wm.layout.load.quick', {
        label: 'Load Layout: Quick',
        execute: function () { loadLayoutProfile('quick', { scope: 'global' }); },
      });
      registerCommand('wm.dock.tab.next', {
        label: 'Switch to Next Dock Tab',
        shortcut: 'Ctrl+Tab',
        execute: function () { cycleDockTabNext(); },
      });
      registerCommand('wm.dock.tab.prev', {
        label: 'Switch to Previous Dock Tab',
        shortcuts: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
        execute: function () { cycleDockTabPrev(); },
      });
      registerCommand('wm.window.focus.next', {
        label: 'Switch to Next Window',
        shortcut: 'Alt+Tab',
        execute: function () { cycleWindowFocusNext(); },
      });
      registerCommand('wm.window.focus.prev', {
        label: 'Switch to Previous Window',
        shortcut: 'Alt+Shift+Tab',
        execute: function () { cycleWindowFocusPrev(); },
      });
      registerCommand('wm.window.linear.next', {
        label: 'Linear Window Switch (No Raise)',
        shortcut: 'Alt+Escape',
        execute: function () { cycleWindowLinearNext(); },
      });
      registerCommand('wm.window.linear.prev', {
        label: 'Linear Window Switch Backward (No Raise)',
        shortcut: 'Alt+Shift+Escape',
        execute: function () { cycleWindowLinearPrev(); },
      });
      registerCommand('wm.window.toggle.recent', {
        label: 'Toggle Most Recent Window',
        shortcut: 'Ctrl+Backquote',
        execute: function () { toggleMostRecentWindow(); },
      });
    }

    _registerBuiltinCommands();

    // ── Global hotkey dispatcher (attach after built-in commands registered) ──
    if (document.__wmGlobalHotkeyHandler) {
      document.removeEventListener('keydown', document.__wmGlobalHotkeyHandler, true);
    }
    document.__wmGlobalHotkeyHandler = function (ev) {
      _handleGlobalKeydown(ev);
    };
    document.addEventListener('keydown', document.__wmGlobalHotkeyHandler, true);

    // ── Window selection / tiling / docking groups ──────────────────────
    function setWindowSelected(id, selected) {
      var sid = String(id || '').trim();
      if (!sid || !_wins.has(sid)) return false;
      var win = _wins.get(sid);
      if (selected === false) _selectedWindows.delete(sid);
      else _selectedWindows.add(sid);
      if (win && win.el) win.el.classList.toggle('wm-selected', _selectedWindows.has(sid));
      if (selected && sid) _lastSelectedWindowId = sid;
      return true;
    }

    function clearWindowSelection() {
      Array.from(_selectedWindows).forEach(function (id) { setWindowSelected(id, false); });
      _selectedWindows.clear();
      _lastSelectedWindowId = null;
    }

    function getSelectedWindows() {
      return Array.from(_selectedWindows.values()).filter(function (id) { return _wins.has(id); });
    }

    function suggestSnapTargets(id) {
      var sid = String(id || '').trim();
      if (!sid || !_wins.has(sid)) return [];
      var ds = _desktopSize(_desktop());
      return [
        { id: 'left-half', x: 8, y: 8, w: Math.floor((ds.w - 24) / 2), h: ds.h - 72 },
        { id: 'right-half', x: Math.floor(ds.w / 2) + 4, y: 8, w: Math.floor((ds.w - 24) / 2), h: ds.h - 72 },
        { id: 'top-half', x: 8, y: 8, w: ds.w - 16, h: Math.floor((ds.h - 80) / 2) },
        { id: 'bottom-half', x: 8, y: Math.floor(ds.h / 2), w: ds.w - 16, h: Math.floor((ds.h - 80) / 2) },
      ];
    }

    function tileWindows(preset, ids) {
      var targets = Array.isArray(ids) && ids.length ? ids.slice() : Array.from(_wins.keys());
      targets = targets.filter(function (id) {
        var w = _wins.get(id);
        return !!(w && !w.minimized && !(w.cfg && w.cfg.backgroundLayer));
      });
      if (!targets.length) return 0;

      var ds = _desktopSize(_desktop());
      var spacing = 8;
      var workTop = 8;
      var workBottom = 64;
      var workH = Math.max(160, ds.h - workTop - workBottom);
      var workW = Math.max(240, ds.w - spacing * 2);

      var layout = String(preset || '2x2').toLowerCase();
      var slots = [];

      if (layout === '3-spalten' || layout === '3col' || layout === '3-columns') {
        var colW = Math.floor((workW - spacing * 2) / 3);
        slots = [0, 1, 2].map(function (i) {
          return { x: spacing + i * (colW + spacing), y: workTop, w: colW, h: workH };
        });
      } else if (layout === '2x2') {
        var halfW = Math.floor((workW - spacing) / 2);
        var halfH = Math.floor((workH - spacing) / 2);
        slots = [
          { x: spacing, y: workTop, w: halfW, h: halfH },
          { x: spacing + halfW + spacing, y: workTop, w: halfW, h: halfH },
          { x: spacing, y: workTop + halfH + spacing, w: halfW, h: halfH },
          { x: spacing + halfW + spacing, y: workTop + halfH + spacing, w: halfW, h: halfH },
        ];
      } else {
        var twoW = Math.floor((workW - spacing) / 2);
        slots = [
          { x: spacing, y: workTop, w: twoW, h: workH },
          { x: spacing + twoW + spacing, y: workTop, w: twoW, h: workH },
        ];
      }

      targets.forEach(function (id, idx) {
        var slot = slots[idx % slots.length];
        var win = _wins.get(id);
        if (!win || !win.el) return;
        win.el.style.left = slot.x + 'px';
        win.el.style.top = slot.y + 'px';
        win.el.style.width = slot.w + 'px';
        win.el.style.height = slot.h + 'px';
        _savePos(id, slot.x, slot.y, slot.w, slot.h);
      });
      _syncAllDockGroupUis();

      return targets.length;
    }

    function tileSelected(preset) {
      return tileWindows(preset, getSelectedWindows());
    }

    function createDockGroup(ids, optsGroup) {
      optsGroup = optsGroup || {};
      var tabIds = Array.isArray(ids) ? ids.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
      tabIds = tabIds.filter(function (id) { return _wins.has(id); });
      if (!tabIds.length) return null;

      var groupId = String(optsGroup.id || ('dock_group_' + (++_dockGroupCounter)));
      _dockGroups.set(groupId, {
        id: groupId,
        tabs: tabIds.slice(),
        activeId: tabIds[0],
      });

      tabIds.forEach(function (id) {
        var win = _wins.get(id);
        if (win && win.el) win.el.classList.toggle('wm-dock-group-hidden', id !== tabIds[0]);
      });
      _syncDockGroupUi(groupId);
      return groupId;
    }

    function activateDockTab(groupId, winId) {
      var gid = String(groupId || '');
      var sid = String(winId || '');
      var group = _dockGroups.get(gid);
      if (!group || group.tabs.indexOf(sid) < 0) return false;

      // Transfer geometry from currently active window to incoming tab
      var prevWin = _wins.get(group.activeId);
      var nextWin = _wins.get(sid);
      if (prevWin && prevWin.el && nextWin && nextWin.el && group.activeId !== sid) {
        var pl = prevWin.el.style.left;
        var pt = prevWin.el.style.top;
        var pw = prevWin.el.style.width;
        var ph = prevWin.el.style.height;
        nextWin.el.style.left   = pl;
        nextWin.el.style.top    = pt;
        nextWin.el.style.width  = pw;
        nextWin.el.style.height = ph;
        _savePos(sid,
          parseInt(pl, 10), parseInt(pt, 10),
          parseInt(pw, 10), parseInt(ph, 10));
      }

      group.activeId = sid;
      group.tabs.forEach(function (id) {
        var win = _wins.get(id);
        if (win && win.el) win.el.classList.toggle('wm-dock-group-hidden', id !== sid);
      });
      _syncDockGroupUi(gid);
      return true;
    }

    function listDockGroups() {
      return Array.from(_dockGroups.values()).map(function (g) {
        return { id: g.id, tabs: g.tabs.slice(), activeId: g.activeId };
      });
    }

    function reorderDockTab(groupId, winId, toIndex) {
      var gid = String(groupId || '');
      var sid = String(winId || '');
      var group = _dockGroups.get(gid);
      if (!group || !Array.isArray(group.tabs) || !group.tabs.length) return false;

      var from = group.tabs.indexOf(sid);
      if (from < 0) return false;

      var next = Math.max(0, Math.min(Number(toIndex) || 0, group.tabs.length - 1));
      if (from === next) return true;

      var moved = group.tabs.splice(from, 1)[0];
      group.tabs.splice(next, 0, moved);
      _syncDockGroupUi(gid);
      return true;
    }

    function _findActiveDockGroup() {
      // Find the first dock group that has the focused/topmost window
      var topWinId = null;
      var topZ = -1;
      _wins.forEach(function (win, id) {
        if (!win || !win.el) return;
        var z = parseInt(win.el.style.zIndex, 10) || 0;
        if (z > topZ) { topZ = z; topWinId = id; }
      });

      if (!topWinId) return null;
      
      var found = null;
      _dockGroups.forEach(function (group) {
        if (found || !group || !Array.isArray(group.tabs)) return;
        if (group.tabs.indexOf(topWinId) >= 0) found = group;
      });
      return found;
    }

    function cycleDockTabNext() {
      var group = _findActiveDockGroup();
      if (!group || !Array.isArray(group.tabs) || group.tabs.length < 2) return false;

      var currentIdx = group.tabs.indexOf(group.activeId);
      if (currentIdx < 0) currentIdx = 0;
      var nextIdx = (currentIdx + 1) % group.tabs.length;
      return activateDockTab(group.id, group.tabs[nextIdx]);
    }

    function cycleDockTabPrev() {
      var group = _findActiveDockGroup();
      if (!group || !Array.isArray(group.tabs) || group.tabs.length < 2) return false;

      var currentIdx = group.tabs.indexOf(group.activeId);
      if (currentIdx < 0) currentIdx = 0;
      var nextIdx = (currentIdx - 1 + group.tabs.length) % group.tabs.length;
      return activateDockTab(group.id, group.tabs[nextIdx]);
    }

    function _removeDockGroupUi(groupId) {
      var gid = String(groupId || '');
      var ui = _dockGroupUis.get(gid);
      if (!ui) return;
      if (ui.root) {
        ui.root.classList.remove('wm-dock-group-tabs-mounted');
        ui.root.removeAttribute('data-group-active-win');
      }
      if (ui.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
      _dockGroupUis.delete(gid);
    }

    function _syncDockGroupUi(groupId) {
      var gid = String(groupId || '');
      var group = _dockGroups.get(gid);
      if (!group || !Array.isArray(group.tabs) || group.tabs.length <= 1) {
        _removeDockGroupUi(gid);
        return;
      }

      var activeWin = _wins.get(group.activeId);
      if (!activeWin || !activeWin.el) {
        _removeDockGroupUi(gid);
        return;
      }

      var ui = _dockGroupUis.get(gid);
      if (!ui) {
        var root = document.createElement('div');
        root.className = 'wm-dock-group-tabs';
        root.setAttribute('role', 'tablist');
        root.setAttribute('aria-label', 'Dock Group Tabs');
        ui = { root: root, parentWinId: null };
        _dockGroupUis.set(gid, ui);
      }

      var titlebar = activeWin.el.querySelector('.wm-titlebar');
      if (!(titlebar instanceof HTMLElement)) {
        _removeDockGroupUi(gid);
        return;
      }

      if (ui.root.parentNode !== titlebar) {
        var controlsEl = titlebar.querySelector('.wm-controls');
        if (controlsEl && controlsEl.parentNode === titlebar) {
          titlebar.insertBefore(ui.root, controlsEl);
        } else {
          titlebar.appendChild(ui.root);
        }
      }

      ui.root.classList.add('wm-dock-group-tabs-mounted');
      ui.root.setAttribute('data-group-active-win', String(group.activeId || ''));
      ui.parentWinId = String(group.activeId || '');

      ui.root.innerHTML = '';
      group.tabs.forEach(function (winId) {
        var win = _wins.get(winId);
        if (!win) return;
        var titleEl = win.el ? win.el.querySelector('.wm-title') : null;
        var title = (titleEl && titleEl.textContent) ? String(titleEl.textContent) : String(winId);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wm-dock-group-tab' + (winId === group.activeId ? ' is-active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', winId === group.activeId ? 'true' : 'false');
        btn.setAttribute('draggable', 'true');
        btn.dataset.dockTabWinId = String(winId);
        btn.textContent = title;
        btn.addEventListener('click', function () { activateDockTab(gid, winId); _focus(winId); });

        btn.addEventListener('dragstart', function (ev) {
          btn.classList.add('is-dragging');
          if (ev && ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', String(winId));
          }
        });

        btn.addEventListener('dragover', function (ev) {
          if (ev) ev.preventDefault();
          btn.classList.add('is-drop-target');
        });

        btn.addEventListener('dragleave', function () {
          btn.classList.remove('is-drop-target');
        });

        btn.addEventListener('drop', function (ev) {
          if (ev) ev.preventDefault();
          btn.classList.remove('is-drop-target');
          var draggedId = '';
          if (ev && ev.dataTransfer) draggedId = String(ev.dataTransfer.getData('text/plain') || '').trim();
          if (!draggedId) return;
          var targetIndex = group.tabs.indexOf(String(winId));
          if (targetIndex < 0) return;
          reorderDockTab(gid, draggedId, targetIndex);
        });

        btn.addEventListener('dragend', function () {
          btn.classList.remove('is-dragging');
          Array.from(ui.root.querySelectorAll('.wm-dock-group-tab.is-drop-target')).forEach(function (n) {
            n.classList.remove('is-drop-target');
          });
        });

        ui.root.appendChild(btn);
      });
    }

    function _syncAllDockGroupUis() {
      Array.from(_dockGroups.keys()).forEach(function (gid) { _syncDockGroupUi(gid); });
    }

    // ── Workspace layout profiles ────────────────────────────────────────
    function _scopeSuffix(optsScope) {
      var o = optsScope || {};
      var scope = String(o.scope || 'global').toLowerCase();
      if (scope === 'user') return 'user:' + String(o.userId != null ? o.userId : 'default');
      if (scope === 'faction') return 'faction:' + String(o.factionId != null ? o.factionId : 'default');
      return 'global';
    }

    function _captureLayoutSnapshot() {
      // Serialize dock groups: only include if they have members
      var dockGroupsData = [];
      _dockGroups.forEach(function (group) {
        if (group && group.tabs && group.tabs.length > 0) {
          dockGroupsData.push({
            id: group.id,
            tabs: group.tabs.slice(),
            activeId: group.activeId,
          });
        }
      });

      return {
        windows: Array.from(_wins.keys()).map(function (id) {
          var win = _wins.get(id);
          return {
            id: id,
            minimized: !!(win && win.minimized),
            open: !!win,
            geometry: _loadPos(id),
            dock: _loadDock(id),
          };
        }),
        dockGroups: dockGroupsData,
        selected: getSelectedWindows(),
        theme: {
          global: getTheme({ scope: 'global' }),
        },
        ts: Date.now(),
      };
    }

    function saveLayoutProfile(name, optsScope) {
      var profile = String(name || '').trim();
      if (!profile) return false;
      var key = _layoutProfilePrefix + _scopeSuffix(optsScope) + ':' + profile;
      try {
        localStorage.setItem(key, JSON.stringify(_captureLayoutSnapshot()));
        return true;
      } catch (_) {
        return false;
      }
    }

    function loadLayoutProfile(name, optsScope) {
      var profile = String(name || '').trim();
      if (!profile) return false;
      var key = _layoutProfilePrefix + _scopeSuffix(optsScope) + ':' + profile;
      try {
        var raw = localStorage.getItem(key);
        if (!raw) return false;
        var data = JSON.parse(raw);
        var rows = Array.isArray(data && data.windows) ? data.windows : [];
        rows.forEach(function (row) {
          if (!row || !row.id) return;
          if (!_wins.has(row.id) && (_registry.has(row.id) || _windowDefaults[row.id])) open(row.id);
          if (_wins.has(row.id) && row.minimized) _minimize(row.id);
          if (_wins.has(row.id) && row.geometry && row.geometry.x != null) {
            var w = _wins.get(row.id);
            if (w && w.el) {
              w.el.style.left = Number(row.geometry.x) + 'px';
              w.el.style.top = Number(row.geometry.y) + 'px';
              w.el.style.width = Number(row.geometry.w) + 'px';
              w.el.style.height = Number(row.geometry.h) + 'px';
              _savePos(row.id, Number(row.geometry.x), Number(row.geometry.y), Number(row.geometry.w), Number(row.geometry.h));
            }
          }
          if (_wins.has(row.id) && row.dock && row.dock.side) {
            var w2 = _wins.get(row.id);
            _applyDockPosition(w2.el, w2.cfg || {}, String(row.dock.side), true);
          }
        });

        // Restore dock groups from snapshot
        var dockGroupsData = Array.isArray(data && data.dockGroups) ? data.dockGroups : [];
        dockGroupsData.forEach(function (groupData) {
          if (groupData && groupData.id && Array.isArray(groupData.tabs) && groupData.tabs.length > 0) {
            // Only recreate if all tabs exist
            var validTabs = groupData.tabs.filter(function (id) { return _wins.has(id); });
            if (validTabs.length === groupData.tabs.length) {
              createDockGroup(validTabs, { id: groupData.id });
              if (groupData.activeId && validTabs.indexOf(groupData.activeId) >= 0) {
                activateDockTab(groupData.id, groupData.activeId);
              }
            }
          }
        });

        _syncAllDockGroupUis();
        if (data && data.theme && data.theme.global) setTheme(data.theme.global, { scope: 'global', apply: true, persist: true });
        clearWindowSelection();
        (Array.isArray(data && data.selected) ? data.selected : []).forEach(function (id) { setWindowSelected(id, true); });
        return true;
      } catch (_) {
        return false;
      }
    }

    function listLayoutProfiles(optsScope) {
      var prefix = _layoutProfilePrefix + _scopeSuffix(optsScope) + ':';
      var names = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var key = String(localStorage.key(i) || '');
          if (key.indexOf(prefix) !== 0) continue;
          names.push(key.slice(prefix.length));
        }
      } catch (_) {}
      return names.sort();
    }

    function deleteLayoutProfile(name, optsScope) {
      var profile = String(name || '').trim();
      if (!profile) return false;
      try {
        localStorage.removeItem(_layoutProfilePrefix + _scopeSuffix(optsScope) + ':' + profile);
        return true;
      } catch (_) {
        return false;
      }
    }

    function exportWorkspaceConfig(optsScope) {
      return {
        scope: _scopeSuffix(optsScope),
        profiles: listLayoutProfiles(optsScope).reduce(function (acc, name) {
          var key = _layoutProfilePrefix + _scopeSuffix(optsScope) + ':' + name;
          try { acc[name] = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_) { acc[name] = {}; }
          return acc;
        }, {}),
        theme: {
          global: getTheme({ scope: 'global' }),
          faction: getTheme({ scope: 'faction', factionId: optsScope && optsScope.factionId }),
          user: getTheme({ scope: 'user', userId: optsScope && optsScope.userId }),
        },
      };
    }

    function importWorkspaceConfig(payload, optsScope) {
      var data = payload && typeof payload === 'object' ? payload : null;
      if (!data) return false;
      try {
        var profiles = data.profiles && typeof data.profiles === 'object' ? data.profiles : {};
        Object.keys(profiles).forEach(function (name) {
          localStorage.setItem(
            _layoutProfilePrefix + _scopeSuffix(optsScope) + ':' + name,
            JSON.stringify(profiles[name] || {}),
          );
        });
        if (data.theme && data.theme.global) setTheme(data.theme.global, { scope: 'global', persist: true, apply: true });
        if (data.theme && data.theme.faction && optsScope && optsScope.factionId != null) {
          setTheme(data.theme.faction, { scope: 'faction', factionId: optsScope.factionId, persist: true, apply: true });
        }
        if (data.theme && data.theme.user && optsScope && optsScope.userId != null) {
          setTheme(data.theme.user, { scope: 'user', userId: optsScope.userId, persist: true, apply: true });
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    function resetScope(optsScope) {
      var suffix = _scopeSuffix(optsScope);
      try {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var key = String(localStorage.key(i) || '');
          if (key.indexOf(_layoutProfilePrefix + suffix + ':') === 0) keys.push(key);
        }
        keys.forEach(function (k) { localStorage.removeItem(k); });
      } catch (_) {}
      if (suffix.indexOf('user:') === 0 && optsScope && optsScope.userId != null) clearTheme({ scope: 'user', userId: optsScope.userId, apply: true });
      if (suffix.indexOf('faction:') === 0 && optsScope && optsScope.factionId != null) clearTheme({ scope: 'faction', factionId: optsScope.factionId, apply: true });
      if (suffix === 'global') clearTheme({ scope: 'global', apply: true });
    }

    // ── Public: register ──────────────────────────────────────────────────
    function register(id, cfg) {
      _registry.set(id, Object.assign({}, _windowDefaults[id] || {}, cfg));
    }

    // ── Public: adopt existing DOM container as window ────────────────────
    function adopt(id, cfg) {
      cfg = cfg || {};
      var nextCfg = Object.assign({ adaptExisting: true }, cfg);
      register(id, nextCfg);
      open(id);
    }

    // ── Public: open or focus ─────────────────────────────────────────────
    function open(id) {
      if (_wins.has(id)) {
        var existingWin = _wins.get(id);
        if (existingWin.minimized) _restore(id);
        else if (!existingWin.cfg || !existingWin.cfg.backgroundLayer) _focus(id);
        _callRender(id);
        return;
      }

      var cfg     = _registry.get(id) || _windowDefaults[id] || { title: id, w: 600, h: 400 };
      var desktop = _desktop();
      if (!desktop) return;
      var ds      = _desktopSize(desktop);

      var resolved = _resolveWindowElement(id, cfg, desktop);
      var el       = resolved.el;
      var hostEl   = resolved.hostEl;
      var adopted  = resolved.adopted;
      var hostManaged = resolved.hostManaged;
      if (!el || !hostEl) return;

      el.classList.remove('wm-closed');

      if (cfg.fullscreenDesktop) {
        el.style.left   = '0px';
        el.style.top    = '0px';
        el.style.width  = ds.w + 'px';
        el.style.height = ds.h + 'px';
      } else if (!cfg.keepExistingGeometry) {
        var saved = _loadPos(id);
        var x     = saved ? saved.x : _nextX;
        var y     = saved ? saved.y : _nextY;

        if (!saved) {
          if (cfg.defaultDock === 'right') {
            var rMargin = Number(cfg.defaultDockMargin != null ? cfg.defaultDockMargin : 12);
            var dockY   = Number(cfg.defaultY          != null ? cfg.defaultY          : 12);
            x = Math.max(0, ds.w - (cfg.w != null ? cfg.w : 600) - rMargin);
            y = Math.max(0, dockY);
          } else if (cfg.defaultDock === 'bottom') {
            var bMargin      = Number(cfg.defaultDockMargin != null ? cfg.defaultDockMargin : 12);
            var bBottomInset = Math.max(0, Number(cfg.dockBottomInset != null ? cfg.dockBottomInset : 56));
            x = Number.isFinite(Number(cfg.defaultX))
              ? Number(cfg.defaultX)
              : Math.max(0, Math.floor((ds.w - (cfg.w != null ? cfg.w : 600)) / 2));
            y = Math.max(0, ds.h - (cfg.h != null ? cfg.h : 400) - bMargin - bBottomInset);
          } else {
            if (Number.isFinite(Number(cfg.defaultX))) x = Number(cfg.defaultX);
            if (Number.isFinite(Number(cfg.defaultY))) y = Number(cfg.defaultY);
          }
        }

        if (!saved) {
          _nextX = (_nextX + 32) % Math.max(100, ds.w - (cfg.w || 0) - 60);
          _nextY = (_nextY + 32) % Math.max(100, ds.h - (cfg.h || 0) - 60);
        }

        var targetW   = Number(saved && saved.w != null ? saved.w : (cfg.w  != null ? cfg.w  : 600));
        var targetH   = Number(saved && saved.h != null ? saved.h : (cfg.h  != null ? cfg.h  : 400));
        var clamped   = _clampWindowPosition(x, y, targetW, targetH, 10);
        x = clamped.x;
        y = clamped.y;

        el.style.left   = x + 'px';
        el.style.top    = y + 'px';
        el.style.width  = (saved && saved.w != null ? saved.w : cfg.w) + 'px';
        el.style.height = (saved && saved.h != null ? saved.h : cfg.h) + 'px';
      }

      if (el.parentElement !== hostEl) hostEl.appendChild(el);
      _wins.set(id, {
        el: el,
        hostEl: hostEl,
        cfg: cfg,
        minimized: false,
        adopted: !!adopted,
        preserveOnClose: !!(adopted && cfg.preserveOnClose !== false),
        hostManaged: !!hostManaged,
      });

      _removeFromRecentClosed(id);

      var savedDock = _loadDock(id);
      if (savedDock && savedDock.side) {
        _applyDockPosition(el, cfg, savedDock.side, false);
      } else {
        _setDockState(el, null);
      }

      if (!cfg.hideTaskButton) _addTaskBtn(id, cfg.title);
      if (cfg.backgroundLayer) {
        el.style.zIndex = '1';
      } else {
        _focus(id);
      }
      _callRender(id);
      _persistWindowStateCookie();
      _syncAllDockGroupUis();
    }

    // ── Public: close ─────────────────────────────────────────────────────
    function close(id) {
      if (!_wins.has(id)) return;
      var win = _wins.get(id);
      var cfg = (win && win.cfg) || _registry.get(id) || _windowDefaults[id] || {};
      if (win && win.preserveOnClose) {
        win.el.classList.add('wm-closed');
        win.el.classList.remove('wm-focused');
        win.el.classList.remove('wm-minimized');
      } else {
        if (win && win.el) win.el.remove();
        if (win && win.hostManaged && win.hostEl) win.hostEl.remove();
      }
      _wins.delete(id);
      _focusHistory = _focusHistory.filter(function (x) { return x !== String(id); });
      var taskBtn = document.getElementById('wm-task-' + id);
      if (taskBtn) taskBtn.remove();
      _selectedWindows.delete(String(id));

      Array.from(_dockGroups.entries()).forEach(function (entry) {
        var gid = entry[0];
        var group = entry[1];
        group.tabs = group.tabs.filter(function (wid) { return String(wid) !== String(id); });
        if (!group.tabs.length) {
          _dockGroups.delete(gid);
          _removeDockGroupUi(gid);
          return;
        }
        if (group.activeId === id) group.activeId = group.tabs[0];
        activateDockTab(gid, group.activeId);
      });

      _pushRecentClosed(id, cfg.title || id);
      _persistWindowStateCookie();
      _syncAllDockGroupUis();
    }

    // ── Public: refresh ───────────────────────────────────────────────────
    function refresh(id) {
      var win = _wins.get(id);
      if (!win || win.minimized) return;
      _callRender(id);
    }

    // ── Public: body ──────────────────────────────────────────────────────
    function body(id) {
      var win = _wins.get(id);
      if (!win) return null;
      return win.el.querySelector('.wm-body') || null;
    }

    // ── Public: isOpen ────────────────────────────────────────────────────
    function isOpen(id) { return _wins.has(id); }

    // ── Public: setTitle ──────────────────────────────────────────────────
    function setTitle(id, title) {
      var el = document.getElementById('wm-win-' + id);
      if (el) {
        var titleEl = el.querySelector('.wm-title');
        if (titleEl) titleEl.textContent = title;
      }
      var tb = document.getElementById('wm-task-' + id);
      if (tb) {
        var labelEl = tb.querySelector('.wm-task-label');
        if (labelEl) labelEl.textContent = title;
      }
    }

    // ── Internal: resolve window element ─────────────────────────────────
    function _resolveWindowElement(id, cfg, desktop) {
      var host = _resolveHostSection(id, cfg, desktop);
      if (!host) return { el: null, hostEl: null, adopted: false, hostManaged: false };

      var el = null;
      if (cfg.adaptExisting !== false) {
        el = _findAdaptableWindow(id, cfg, host);
        if (el) _prepareAdaptedWindow(el, id, cfg);
      }
      if (!el) el = _buildEl(id, cfg);

      _wireWindowInteractions(el, id, cfg);
      return {
        el: el,
        hostEl: host,
        adopted: !!cfg.adaptExisting && !!_isAdaptedWindow(el),
        hostManaged: host.classList.contains('wm-window-host'),
      };
    }

    function _resolveHostSection(id, cfg, desktop) {
      if (cfg.sectionId) {
        var explicit = document.getElementById(String(cfg.sectionId));
        if (explicit) return explicit;
      }
      if (cfg.hostSectionId) {
        var explicitHost = document.getElementById(String(cfg.hostSectionId));
        if (explicitHost) return explicitHost;
      }
      return _ensureWindowHost(id, desktop);
    }

    function _findAdaptableWindow(id, cfg, host) {
      var selectors = [];
      if (cfg.prebuiltSelector) selectors.push(String(cfg.prebuiltSelector));
      selectors.push('[data-wm-window="' + id + '"]', '.wm-window', '.wm-adaptable-window');
      for (var i = 0; i < selectors.length; i++) {
        var found = host.querySelector(selectors[i]);
        if (found) return found;
      }
      if (cfg.adaptSelf && host instanceof HTMLElement) return host;
      if (cfg.adaptFirstChild && host.firstElementChild instanceof HTMLElement) {
        return host.firstElementChild;
      }
      return null;
    }

    function _prepareAdaptedWindow(el, id, cfg) {
      if (!(el instanceof HTMLElement)) return;
      el.classList.remove('hidden');
      el.classList.add('wm-window', 'wm-window-adapted');
      if (cfg.fullscreenDesktop) el.classList.add('wm-window-fullscreen');
      if (cfg.backgroundLayer)   el.classList.add('wm-window-background');
      if (!el.id) el.id = 'wm-win-' + id;
      el.setAttribute('data-winid', id);

      var existingBody   = el.querySelector(':scope > .wm-body');
      var titlebar       = el.querySelector(':scope > .wm-titlebar');
      var resizeHandle   = el.querySelector(':scope > .wm-resize-handle');

      if (!cfg.fullscreenDesktop && !titlebar) {
        var minBtn   = new GQUI.Button('\u2013').setClass('wm-btn wm-btn-min');
        minBtn.dom.title = 'Minimise';
        var closeBtn = new GQUI.Button('\u2715').setClass('wm-btn wm-btn-close');
        closeBtn.dom.title = 'Close';
        var head = new GQUI.Div()
          .setClass('wm-titlebar')
          .add(new GQUI.Span().setClass('wm-title').setTextContent(cfg.title || id))
          .add(new GQUI.Div().setClass('wm-controls').add(minBtn, closeBtn));
        el.insertBefore(head.dom, el.firstChild);
      }

      if (!existingBody) {
        var bodyEl = document.createElement('div');
        bodyEl.className = 'wm-body';
        var moveNodes = Array.from(el.childNodes).filter(function (node) {
          if (!(node instanceof HTMLElement)) return true;
          return !node.classList.contains('wm-titlebar') &&
                 !node.classList.contains('wm-resize-handle');
        });
        moveNodes.forEach(function (node) { bodyEl.appendChild(node); });
        var existingResize = el.querySelector(':scope > .wm-resize-handle');
        if (existingResize) el.insertBefore(bodyEl, existingResize);
        else el.appendChild(bodyEl);
      }

      if (!cfg.fullscreenDesktop && !resizeHandle) {
        var handle = document.createElement('div');
        handle.className = 'wm-resize-handle';
        handle.title = 'Resize';
        el.appendChild(handle);
      }
    }

    function _isAdaptedWindow(el) {
      return !!(el && el.classList && el.classList.contains('wm-window-adapted'));
    }

    // ── Internal: build window DOM ────────────────────────────────────────
    function _buildEl(id, cfg) {
      var el = document.createElement('section');
      el.className = 'wm-window'
        + (cfg.fullscreenDesktop ? ' wm-window-fullscreen' : '')
        + (cfg.backgroundLayer   ? ' wm-window-background' : '');
      el.id = 'wm-win-' + id;
      el.setAttribute('data-winid', id);
      if (!cfg.fullscreenDesktop) {
        var minBtn   = new GQUI.Button('\u2013').setClass('wm-btn wm-btn-min');
        minBtn.dom.title = 'Minimise';
        var closeBtn = new GQUI.Button('\u2715').setClass('wm-btn wm-btn-close');
        closeBtn.dom.title = 'Close';
        el.appendChild(new GQUI.Div()
          .setClass('wm-titlebar')
          .add(new GQUI.Span().setClass('wm-title').setTextContent(cfg.title))
          .add(new GQUI.Div().setClass('wm-controls').add(minBtn, closeBtn))
          .dom);
      }
      el.appendChild(new GQUI.Div().setClass('wm-body').dom);
      if (!cfg.fullscreenDesktop) {
        var handle = new GQUI.Div().setClass('wm-resize-handle');
        handle.dom.title = 'Resize';
        el.appendChild(handle.dom);
      }
      return el;
    }

    function _wireWindowInteractions(el, id, cfg) {
      if (!el || el.dataset.wmInteractiveBound === '1') return;
      el.dataset.wmInteractiveBound = '1';

      if (!cfg.backgroundLayer) {
        el.addEventListener('mousedown', function (ev) {
          // Selection modifiers are handled on click; mousedown only focuses
          // plain interactions to avoid double-toggle (mousedown + click).
          if (!(ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey))) {
            _focus(id);
          }
        }, true);
      }

      if (!cfg.backgroundLayer) {
        el.addEventListener('click', function (ev) {
          if (ev && (ev.shiftKey)) {
            // Range select: select from last selected to current
            var lastSelected = _lastSelectedWindowId;
            if (lastSelected && _wins.has(lastSelected)) {
              var allIds = Array.from(_wins.keys());
              var fromIdx = allIds.indexOf(lastSelected);
              var toIdx = allIds.indexOf(id);
              if (fromIdx >= 0 && toIdx >= 0) {
                var start = Math.min(fromIdx, toIdx);
                var end = Math.max(fromIdx, toIdx);
                for (var i = start; i <= end; i++) {
                  if (allIds[i]) setWindowSelected(allIds[i], true);
                }
              }
            } else {
              setWindowSelected(id, true);
            }
            _lastSelectedWindowId = id;
          } else if (ev && (ev.ctrlKey || ev.metaKey)) {
            setWindowSelected(id, !_selectedWindows.has(id));
            _lastSelectedWindowId = id;
          } else if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
            // Click without modifiers: clear selection and focus
            clearWindowSelection();
            _focus(id);
          }
        }, true);
      }
      var minBtn   = el.querySelector('.wm-btn-min');
      var closeBtn = el.querySelector('.wm-btn-close');
      if (minBtn)   minBtn.addEventListener('click',   function (e) { e.stopPropagation(); _minimize(id); });
      if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); close(id); });

      var titlebar = el.querySelector('.wm-titlebar');
      if (titlebar && titlebar.dataset.wmContextBound !== '1') {
        titlebar.dataset.wmContextBound = '1';
        titlebar.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          _focus(id);
          contextMenu(_buildWindowContextMenuItems(id), {
            x: e.clientX,
            y: e.clientY,
            title: cfg.title || id,
          });
        });
      }

      if (!cfg.fullscreenDesktop) {
        _makeDraggable(el);
        _makeResizable(el);
      }
    }

    // ── Internal: focus ───────────────────────────────────────────────────
    function _setFocusedWindow(id, optsFocus) {
      var opts = optsFocus || {};
      var win = _wins.get(id);
      if (!win) return;
      if (opts.promote !== false) {
        _topZ = Math.max(_topZ, _highestNonBackgroundZ()) + 1;
        win.el.style.zIndex = _topZ;
      }
      document.querySelectorAll('.wm-window').forEach(function (w) { w.classList.remove('wm-focused'); });
      document.querySelectorAll('.wm-task-btn').forEach(function (b) { b.classList.remove('wm-task-active'); });
      win.el.classList.add('wm-focused');
      var taskBtn = document.getElementById('wm-task-' + id);
      if (taskBtn) taskBtn.classList.add('wm-task-active');
      _recordFocusHistory(id);
      _syncAllDockGroupUis();
    }

    function _focus(id) {
      _setFocusedWindow(id, { promote: true });
    }

    function _pruneFocusHistory() {
      _focusHistory = _focusHistory.filter(function (id) {
        var win = _wins.get(id);
        return !!(win && win.el && !win.minimized && !(win.cfg && win.cfg.backgroundLayer));
      });
    }

    function _recordFocusHistory(id) {
      var sid = String(id || '').trim();
      if (!sid) return;
      _focusHistory = _focusHistory.filter(function (x) { return x !== sid; });
      _focusHistory.unshift(sid);
      if (_focusHistory.length > 64) _focusHistory = _focusHistory.slice(0, 64);
    }

    function toggleMostRecentWindow() {
      _pruneFocusHistory();
      if (_focusHistory.length < 2) return false;

      var current = _focusHistory[0];
      var target = null;
      for (var i = 1; i < _focusHistory.length; i++) {
        if (_focusHistory[i] !== current) {
          target = _focusHistory[i];
          break;
        }
      }
      if (!target) return false;
      _focus(target);
      return true;
    }

    function _highestNonBackgroundZ() {
      var maxZ = 240;
      _wins.forEach(function (win) {
        if (!win || (win.cfg && win.cfg.backgroundLayer)) return;
        var z = parseInt((win.el && win.el.style && win.el.style.zIndex) || '', 10);
        if (Number.isFinite(z)) maxZ = Math.max(maxZ, z);
      });
      return maxZ;
    }

    function _listFocusableWindowIdsByZ() {
      var rows = [];
      _wins.forEach(function (win, id) {
        if (!win || !win.el) return;
        if (win.minimized) return;
        if (win.cfg && win.cfg.backgroundLayer) return;
        var z = parseInt((win.el.style && win.el.style.zIndex) || '', 10);
        rows.push({ id: id, z: Number.isFinite(z) ? z : 0 });
      });
      rows.sort(function (a, b) { return a.z - b.z; });
      return rows.map(function (r) { return r.id; });
    }

    function _listFocusableWindowIdsByOpenOrder() {
      return Array.from(_wins.keys()).filter(function (id) {
        var win = _wins.get(id);
        if (!win || !win.el) return false;
        if (win.minimized) return false;
        if (win.cfg && win.cfg.backgroundLayer) return false;
        return true;
      });
    }

    function cycleWindowFocusNext() {
      var ids = _listFocusableWindowIdsByZ();
      if (!ids.length) return false;
      if (ids.length === 1) { _focus(ids[0]); return true; }

      var focusedId = null;
      ids.forEach(function (id) {
        var w = _wins.get(id);
        if (w && w.el && w.el.classList.contains('wm-focused')) focusedId = id;
      });

      var idx = focusedId ? ids.indexOf(focusedId) : -1;
      if (idx < 0) idx = ids.length - 1;
      var next = ids[(idx + 1) % ids.length];
      _focus(next);
      return true;
    }

    function cycleWindowFocusPrev() {
      var ids = _listFocusableWindowIdsByZ();
      if (!ids.length) return false;
      if (ids.length === 1) { _focus(ids[0]); return true; }

      var focusedId = null;
      ids.forEach(function (id) {
        var w = _wins.get(id);
        if (w && w.el && w.el.classList.contains('wm-focused')) focusedId = id;
      });

      var idx = focusedId ? ids.indexOf(focusedId) : 0;
      if (idx < 0) idx = 0;
      var prev = ids[(idx - 1 + ids.length) % ids.length];
      _focus(prev);
      return true;
    }

    function cycleWindowLinearNext() {
      var ids = _listFocusableWindowIdsByOpenOrder();
      if (!ids.length) return false;
      if (ids.length === 1) { _setFocusedWindow(ids[0], { promote: false }); return true; }

      var focusedId = null;
      ids.forEach(function (id) {
        var w = _wins.get(id);
        if (w && w.el && w.el.classList.contains('wm-focused')) focusedId = id;
      });

      var idx = focusedId ? ids.indexOf(focusedId) : -1;
      if (idx < 0) idx = ids.length - 1;
      var next = ids[(idx + 1) % ids.length];
      _setFocusedWindow(next, { promote: false });
      return true;
    }

    function cycleWindowLinearPrev() {
      var ids = _listFocusableWindowIdsByOpenOrder();
      if (!ids.length) return false;
      if (ids.length === 1) { _setFocusedWindow(ids[0], { promote: false }); return true; }

      var focusedId = null;
      ids.forEach(function (id) {
        var w = _wins.get(id);
        if (w && w.el && w.el.classList.contains('wm-focused')) focusedId = id;
      });

      var idx = focusedId ? ids.indexOf(focusedId) : 0;
      if (idx < 0) idx = 0;
      var prev = ids[(idx - 1 + ids.length) % ids.length];
      _setFocusedWindow(prev, { promote: false });
      return true;
    }

    function _clampWindowPosition(x, y, width, height, margin) {
      margin = margin != null ? margin : 8;
      var viewportW = Math.max(320, window.innerWidth  || (document.documentElement && document.documentElement.clientWidth)  || 1280);
      var viewportH = Math.max(220, window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 720);
      var insets    = _getViewportInsets();

      var w    = Math.max(0, Number(width  || 0));
      var h    = Math.max(0, Number(height || 0));
      var minX = Math.max(0, margin + insets.left);
      var minY = Math.max(0, margin + insets.top);
      var maxX = Math.max(minX, viewportW - insets.right  - margin - w);
      var maxY = Math.max(minY, viewportH - insets.bottom - margin - h);

      return {
        x: Math.max(minX, Math.min(Number(x || 0), maxX)),
        y: Math.max(minY, Math.min(Number(y || 0), maxY)),
      };
    }

    // ── Internal: minimize / restore ─────────────────────────────────────
    function _minimize(id) {
      var win = _wins.get(id);
      if (!win || win.minimized) return;
      _closeContextMenu();
      win.minimized = true;
      win.el.classList.add('wm-minimized');
      _focusHistory = _focusHistory.filter(function (x) { return x !== String(id); });
      var taskBtn = document.getElementById('wm-task-' + id);
      if (taskBtn) taskBtn.classList.remove('wm-task-active');
      // If this window is the active tab in a dock group, promote next visible tab
      _dockGroups.forEach(function (group) {
        if (group.activeId !== id) return;
        var next = group.tabs.find(function (wid) {
          if (wid === id) return false;
          var w = _wins.get(wid);
          return w && !w.minimized;
        });
        if (next) activateDockTab(group.id, next);
      });
      _persistWindowStateCookie();
    }

    function _restore(id) {
      var win = _wins.get(id);
      if (!win || !win.minimized) return;
      _closeContextMenu();
      win.minimized = false;
      win.el.classList.remove('wm-minimized');
      // Re-show this window in its dock group and make it active
      _dockGroups.forEach(function (group) {
        if (group.tabs.indexOf(id) < 0) return;
        win.el.classList.remove('wm-dock-group-hidden');
        activateDockTab(group.id, id);
      });
      _focus(id);
      _persistWindowStateCookie();
    }

    function isMinimized(id) {
      var sid = String(id || '').trim();
      if (!sid) return false;
      var win = _wins.get(sid);
      return !!(win && win.minimized);
    }

    // ── Internal: recent-closed list ─────────────────────────────────────
    function _removeFromRecentClosed(id) {
      var key = String(id || '').trim();
      if (!key) return;
      _recentClosed = _recentClosed.filter(function (entry) {
        return String((entry && entry.id) || '') !== key;
      });
      _refreshTaskbarSplitButtonState();
    }

    function _pushRecentClosed(id, title) {
      var key = String(id || '').trim();
      if (!key) return;
      var item = { id: key, title: String(title || key), ts: Date.now() };
      _recentClosed = [item].concat(_recentClosed.filter(function (entry) {
        return String((entry && entry.id) || '') !== key;
      }));
      _recentClosed = _recentClosed.slice(0, _recentClosedLimit);
      _refreshTaskbarSplitButtonState();
    }

    // ── Internal: state cookie ────────────────────────────────────────────
    function _parseCookiePayload(raw) {
      try {
        if (!raw) return null;
        var decoded = decodeURIComponent(String(raw));
        var parsed  = JSON.parse(decoded);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (_) { return null; }
    }

    function _readStateCookie() {
      try {
        var cookie = String(document.cookie || '');
        var prefix = _cookieKey + '=';
        var parts  = cookie.split(';');
        var chunk  = null;
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i].trim();
          if (part.indexOf(prefix) === 0) { chunk = part; break; }
        }
        if (!chunk) return null;
        return _parseCookiePayload(chunk.slice(prefix.length));
      } catch (_) { return null; }
    }

    function _writeStateCookie(payload) {
      try {
        var expires = new Date(Date.now() + (_cookieDays * 24 * 60 * 60 * 1000)).toUTCString();
        var value   = encodeURIComponent(JSON.stringify(payload || {}));
        document.cookie = _cookieKey + '=' + value + '; expires=' + expires + '; path=/; SameSite=Lax';
      } catch (_) {}
    }

    function _collectPersistableWindows() {
      var openList = [];
      _wins.forEach(function (win, id) {
        if (!win || !id) return;
        var cfg = win.cfg || _registry.get(id) || _windowDefaults[id] || {};
        if (cfg.persistState === false) return;
        if (cfg.backgroundLayer) return;
        openList.push({ id: String(id), minimized: !!win.minimized });
      });
      return openList;
    }

    function _persistWindowStateCookie() {
      if (_isRestoringState) return;
      var payload = {
        open: _collectPersistableWindows(),
        recentClosed: _recentClosed.slice(0, _recentClosedLimit).map(function (entry) {
          return {
            id:    String((entry && entry.id)    || ''),
            title: String((entry && entry.title) || (entry && entry.id) || ''),
            ts:    Number((entry && entry.ts)    || 0),
          };
        }).filter(function (entry) { return !!entry.id; }),
        ts: Date.now(),
      };
      _writeStateCookie(payload);
    }

    function _restoreRecentClosedFromState(state) {
      var rows = Array.isArray(state && state.recentClosed) ? state.recentClosed : [];
      _recentClosed = rows
        .map(function (entry) {
          return {
            id:    String((entry && entry.id)    || '').trim(),
            title: String((entry && entry.title) || (entry && entry.id) || '').trim(),
            ts:    Number((entry && entry.ts)    || 0),
          };
        })
        .filter(function (entry) { return !!entry.id; })
        .slice(0, _recentClosedLimit);
      _refreshTaskbarSplitButtonState();
    }

    // ── Public: restore windows from cookie ───────────────────────────────
    function restorePersistedState() {
      if (_restoreAttempted) return;
      _restoreAttempted = true;
      _ensureTaskbarSplitButton();

      var state = _readStateCookie();
      if (!state) { _refreshTaskbarSplitButtonState(); return; }

      _restoreRecentClosedFromState(state);
      var openRows = Array.isArray(state.open) ? state.open : [];
      _isRestoringState = true;
      try {
        openRows.forEach(function (row) {
          var id = String((row && row.id) || '').trim();
          if (!id) return;
          if (!_registry.has(id) && !_windowDefaults[id]) return;
          if (!_wins.has(id)) open(id);
          if (row && row.minimized) _minimize(id);
        });
      } finally {
        _isRestoringState = false;
        _persistWindowStateCookie();
        _refreshTaskbarSplitButtonState();
      }
    }

    // ── Internal: recent-closed menu ─────────────────────────────────────
    function _buildRecentClosedMenuItems() {
      var items      = [];
      var candidates = _recentClosed.filter(function (entry) {
        var id = String((entry && entry.id) || '');
        return !!id && (_registry.has(id) || !!_windowDefaults[id]);
      }).slice(0, _recentClosedLimit);

      if (!candidates.length) {
        items.push({ label: _labels.noRecentClosed, disabled: true });
        return items;
      }

      candidates.forEach(function (entry) {
        var id    = String(entry.id    || '');
        var title = String(entry.title || id || 'Window');
        items.push({ label: title, meta: id, onSelect: function () { open(id); } });
      });

      items.push({ type: 'separator' });
      items.push({
        label:    _labels.clearList,
        danger:   true,
        onSelect: function () {
          _recentClosed = [];
          _persistWindowStateCookie();
          _refreshTaskbarSplitButtonState();
        },
      });

      return items;
    }

    function _showRecentClosedMenu(anchorEl) {
      if (!(anchorEl instanceof HTMLElement)) return;
      var rect = anchorEl.getBoundingClientRect();
      contextMenu(_buildRecentClosedMenuItems(), {
        x:     Math.round(rect.left),
        y:     Math.round(rect.bottom + 6),
        title: _labels.recentClosedTitle,
      });
    }

    function _refreshTaskbarSplitButtonState() {
      var btn   = document.getElementById('wm-taskbar-menu-btn');
      var arrow = document.getElementById('wm-taskbar-menu-arrow');
      if (!btn && !arrow) return;
      var enabled = _recentClosed.length > 0;
      if (btn) {
        btn.classList.toggle('has-recent', enabled);
        btn.title = enabled ? _labels.showRecentClosed : _labels.noRecentClosed;
      }
      if (arrow) arrow.disabled = !enabled;
    }

    function _ensureTaskbarSplitButton() {
      var taskbar   = document.getElementById('wm-taskbar');
      if (!taskbar) return;
      var splitWrap = document.getElementById('wm-taskbar-split');
      if (!splitWrap) return;
      if (splitWrap.dataset.wmBound === '1') {
        _refreshTaskbarSplitButtonState();
        return;
      }

      var mainBtn  = document.getElementById('wm-taskbar-menu-btn');
      var arrowBtn = document.getElementById('wm-taskbar-menu-arrow');
      if (mainBtn)  mainBtn.addEventListener('click',  function () { _showRecentClosedMenu(mainBtn); });
      if (arrowBtn) arrowBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        _showRecentClosedMenu(arrowBtn);
      });

      splitWrap.dataset.wmBound = '1';
      _refreshTaskbarSplitButtonState();
    }

    // ── Internal: reset geometry ─────────────────────────────────────────
    function _resetWindowGeometry(id) {
      var win = _wins.get(id);
      if (!win) return;
      var cfg     = win.cfg || _registry.get(id) || _windowDefaults[id] || { w: 600, h: 400 };
      var desktop = _desktop();
      var ds      = _desktopSize(desktop);

      _saveDock(id, null);
      _savePos(id, null, null, null, null);
      _setDockState(win.el, null);

      var width  = Math.max(280, Number(cfg.w  || win.el.offsetWidth  || 600));
      var height = Math.max(180, Number(cfg.h  || win.el.offsetHeight || 400));
      var x      = Number.isFinite(Number(cfg.defaultX)) ? Number(cfg.defaultX) : 48;
      var y      = Number.isFinite(Number(cfg.defaultY)) ? Number(cfg.defaultY) : 48;

      if (cfg.defaultDock === 'right') {
        var rgMargin = Number(cfg.defaultDockMargin != null ? cfg.defaultDockMargin : 12);
        x = Math.max(0, ds.w - width - rgMargin);
        y = Math.max(0, Number(cfg.defaultY != null ? cfg.defaultY : 12));
      } else if (cfg.defaultDock === 'bottom') {
        var btMargin = Number(cfg.defaultDockMargin != null ? cfg.defaultDockMargin : 12);
        var btInset  = Math.max(0, Number(cfg.dockBottomInset != null ? cfg.dockBottomInset : 56));
        x = Number.isFinite(Number(cfg.defaultX))
          ? Number(cfg.defaultX)
          : Math.max(0, Math.floor((ds.w - width) / 2));
        y = Math.max(0, ds.h - height - btMargin - btInset);
      }

      var clamped = _clampWindowPosition(x, y, width, height, 10);
      x = clamped.x;
      y = clamped.y;

      win.el.style.left   = x + 'px';
      win.el.style.top    = y + 'px';
      win.el.style.width  = width  + 'px';
      win.el.style.height = height + 'px';
      _savePos(id, x, y, width, height);
      _focus(id);
    }

    // ── Internal: context menu engine ────────────────────────────────────
    function _getContextMenuRoot() {
      var root = document.getElementById('wm-context-menu-root');
      if (root) return root;
      var host = document.getElementById('context_menu_container') || document.body;
      if (!host) return null;
      root = document.createElement('div');
      root.id        = 'wm-context-menu-root';
      root.className = 'wm-context-menu-root';
      host.appendChild(root);
      return root;
    }

    function _closeContextMenu() {
      var root = document.getElementById('wm-context-menu-root');
      if (root) root.innerHTML = '';
      if (_contextMenuState && _contextMenuState.onPointerDown) {
        document.removeEventListener('mousedown',   _contextMenuState.onPointerDown, true);
        document.removeEventListener('contextmenu', _contextMenuState.onPointerDown, true);
      }
      if (_contextMenuState && _contextMenuState.onKey) {
        document.removeEventListener('keydown', _contextMenuState.onKey, true);
      }
      _contextMenuState = null;
    }

    function _positionContextMenu(menuEl, x, y, parentRect) {
      if (!menuEl) return { x: 0, y: 0 };
      var margin = 8;
      var width  = Math.max(180, menuEl.offsetWidth  || 220);
      var height = Math.max(40,  menuEl.offsetHeight || 100);
      var vw     = window.innerWidth  || 1280;
      var vh     = window.innerHeight || 720;

      var targetX = Number(x || 0);
      var targetY = Number(y || 0);

      if (parentRect) {
        targetX = parentRect.right + 6;
        targetY = parentRect.top;
        if (targetX + width + margin > vw) targetX = parentRect.left - width - 6;
        if (targetY + height + margin > vh) targetY = Math.max(margin, vh - height - margin);
      }

      var maxX   = Math.max(margin, vw - width  - margin);
      var maxY   = Math.max(margin, vh - height - margin);
      var px = Math.max(margin, Math.min(targetX, maxX));
      var py = Math.max(margin, Math.min(targetY, maxY));
      menuEl.style.left = px + 'px';
      menuEl.style.top  = py + 'px';
      return { x: px, y: py };
    }

    function contextMenu(items, opts) {
      items = Array.isArray(items) ? items : [];
      opts  = opts || {};
      if (!items.length) { _closeContextMenu(); return; }

      var root = _getContextMenuRoot();
      if (!root) return;
      _closeContextMenu();

      var menus = [];
      var activeMenu = null;
      var typeAhead = { text: '', ts: 0 };

      function runMenuAction(item) {
        if (!item || item.disabled) return;
        _closeContextMenu();
        if (item.commandId) { executeCommand(item.commandId, { source: 'wm.contextMenu', item: item }); return; }
        if (typeof item.onSelect === 'function') { item.onSelect(); return; }
        if (typeof item.onClick === 'function') item.onClick(item);
      }

      function focusItem(menuState, idx) {
        if (!menuState || !menuState.items.length) return;
        var next = Math.max(0, Math.min(idx, menuState.items.length - 1));
        menuState.activeIndex = next;
        menuState.items.forEach(function (it, i) {
          it.tabIndex = (i === next) ? 0 : -1;
          it.classList.toggle('is-key-focus', i === next);
        });
        menuState.items[next].focus();
        activeMenu = menuState;
      }

      function closeMenusFrom(level) {
        while (menus.length > level) {
          var m = menus.pop();
          if (m && m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
        }
        activeMenu = menus[menus.length - 1] || null;
      }

      function buildMenu(menuItems, anchor, level, title) {
        var menu = document.createElement('section');
        menu.className = 'wm-context-menu' + (level > 0 ? ' wm-context-submenu' : '');
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;
        menu.dataset.level = String(level);

        if (title && level === 0) {
          var titleDiv = document.createElement('div');
          titleDiv.className   = 'wm-context-menu-title';
          titleDiv.textContent = String(title || 'Menu');
          menu.appendChild(titleDiv);
        }

        var state = { el: menu, level: level, items: [], activeIndex: 0, parentButton: anchor || null };

        menuItems.forEach(function (item) {
          if (!item || item.type === 'separator') {
            var sep = document.createElement('div');
            sep.className = 'wm-context-menu-separator';
            menu.appendChild(sep);
            return;
          }

          var btn = document.createElement('button');
          btn.type      = 'button';
          btn.className = 'wm-context-menu-item'
            + (item.danger  ? ' is-danger'  : '')
            + (item.checked ? ' is-checked' : '')
            + (item.items && item.items.length ? ' has-submenu' : '');
          btn.setAttribute('role', 'menuitem');
          if (item.items && item.items.length) btn.setAttribute('aria-haspopup', 'menu');
          btn.disabled = !!item.disabled;

          var metaLabel = item.shortcut || item.meta || '';
          btn.innerHTML =
            '<span class="wm-context-menu-item-main">' + _esc(String(item.label || 'Action')) + '</span>'
            + (metaLabel ? '<span class="wm-context-menu-item-meta">' + _esc(String(metaLabel)) + '</span>' : '');

          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (item.items && item.items.length) {
              openSubmenuForButton(state, btn, item);
              return;
            }
            runMenuAction(item);
          });

          btn.addEventListener('mouseenter', function () {
            var idx = state.items.indexOf(btn);
            if (idx >= 0) focusItem(state, idx);
            if (item.items && item.items.length) openSubmenuForButton(state, btn, item);
            else closeMenusFrom(level + 1);
          });

          btn.__wmItemData = item;
          state.items.push(btn);
          menu.appendChild(btn);
        });

        root.appendChild(menu);
        if (level === 0) _positionContextMenu(menu, opts.x, opts.y);
        else _positionContextMenu(menu, 0, 0, anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null);
        menus.push(state);
        if (state.items.length) focusItem(state, 0);
        return state;
      }

      function openSubmenuForButton(parentState, button, item) {
        closeMenusFrom(parentState.level + 1);
        if (!item || !Array.isArray(item.items) || !item.items.length) return;
        var child = buildMenu(item.items, button, parentState.level + 1, null);
        if (child && child.items.length) focusItem(child, 0);
      }

      var rootMenu = buildMenu(items, null, 0, opts.title);

      var onPointerDown = function (ev) {
        var target = ev.target;
        if (!target) return;
        if (menus.some(function (m) { return m.el.contains(target); })) return;
        _closeContextMenu();
      };

      var onKey = function (ev) {
        if (!activeMenu) {
          if (ev.key === 'Escape') _closeContextMenu();
          return;
        }

        var menuState = activeMenu;
        var idx = menuState.activeIndex;
        var itemEl = menuState.items[idx];
        var itemData = itemEl && itemEl.__wmItemData;

        if (ev.key === 'Escape') {
          ev.preventDefault();
          if (menuState.level > 0 && menuState.parentButton) {
            closeMenusFrom(menuState.level);
            menuState.parentButton.focus();
          } else {
            _closeContextMenu();
          }
          return;
        }

        if (ev.key === 'ArrowDown') { ev.preventDefault(); focusItem(menuState, idx + 1); return; }
        if (ev.key === 'ArrowUp') { ev.preventDefault(); focusItem(menuState, idx - 1); return; }
        if (ev.key === 'Home') { ev.preventDefault(); focusItem(menuState, 0); return; }
        if (ev.key === 'End') { ev.preventDefault(); focusItem(menuState, menuState.items.length - 1); return; }

        if (ev.key === 'ArrowRight') {
          if (itemData && itemData.items && itemData.items.length) {
            ev.preventDefault();
            openSubmenuForButton(menuState, itemEl, itemData);
          }
          return;
        }

        if (ev.key === 'ArrowLeft') {
          if (menuState.level > 0 && menuState.parentButton) {
            ev.preventDefault();
            closeMenusFrom(menuState.level);
            menuState.parentButton.focus();
          }
          return;
        }

        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          if (itemData && itemData.items && itemData.items.length) openSubmenuForButton(menuState, itemEl, itemData);
          else runMenuAction(itemData);
          return;
        }

        if (ev.key && ev.key.length === 1) {
          var now = Date.now();
          if (now - typeAhead.ts > 700) typeAhead.text = '';
          typeAhead.ts = now;
          typeAhead.text += ev.key.toLowerCase();
          var matchIndex = menuState.items.findIndex(function (node) {
            var txt = String((node.__wmItemData && node.__wmItemData.label) || '').toLowerCase();
            return txt.indexOf(typeAhead.text) === 0;
          });
          if (matchIndex >= 0) focusItem(menuState, matchIndex);
        }
      };

      _contextMenuState = { onPointerDown: onPointerDown, onKey: onKey };
      document.addEventListener('mousedown',   onPointerDown, true);
      document.addEventListener('contextmenu', onPointerDown, true);
      document.addEventListener('keydown',     onKey,         true);

      requestAnimationFrame(function () {
        if (rootMenu && rootMenu.items.length) focusItem(rootMenu, 0);
      });
    }

    function _buildWindowContextMenuItems(id) {
      var win = _wins.get(id);
      if (!win) return [];
      var cfg   = win.cfg || {};
      var items = [
        {
          label:    win.minimized ? _labels.restore : _labels.focus,
          onSelect: function () { if (win.minimized) _restore(id); else _focus(id); },
        },
        {
          label:    _labels.minimize,
          disabled: win.minimized,
          onSelect: function () { _minimize(id); },
        },
      ];

      var dockCfg = _getDockConfig(cfg);
      if (!cfg.fullscreenDesktop && dockCfg) {
        items.push({ type: 'separator' });
        items.push({
          label:    _labels.dockLeft,
          checked:  win.el.dataset.wmDocked === 'left',
          onSelect: function () { _applyDockPosition(win.el, cfg, 'left', true); },
        });
        items.push({
          label:    _labels.dockRight,
          checked:  win.el.dataset.wmDocked === 'right',
          onSelect: function () { _applyDockPosition(win.el, cfg, 'right', true); },
        });
        var freshDockCfg = _getDockConfig(cfg);
        if (freshDockCfg && freshDockCfg.sides.indexOf('bottom') !== -1) {
          items.push({
            label:    _labels.dockBottom,
            checked:  win.el.dataset.wmDocked === 'bottom',
            onSelect: function () { _applyDockPosition(win.el, cfg, 'bottom', true); },
          });
        }
        items.push({
          label:    _labels.resetPosition,
          onSelect: function () { _resetWindowGeometry(id); },
        });
      }

      // ── Snap targets ────────────────────────────────────────────────────
      if (!cfg.fullscreenDesktop && !cfg.backgroundLayer) {
        var snapTargets = suggestSnapTargets(id);
        if (snapTargets.length) {
          items.push({ type: 'separator' });
          var snapLabelMap = {
            'left-half':   _labels.snapLeft,
            'right-half':  _labels.snapRight,
            'top-half':    _labels.snapTop,
            'bottom-half': _labels.snapBottom,
          };
          snapTargets.forEach(function (target) {
            var label = snapLabelMap[target.id] || target.id;
            var t = target;
            items.push({
              label:    label,
              onSelect: function () {
                if (!win.el) return;
                win.el.style.left   = t.x + 'px';
                win.el.style.top    = t.y + 'px';
                win.el.style.width  = t.w + 'px';
                win.el.style.height = t.h + 'px';
                _savePos(id, t.x, t.y, t.w, t.h);
                if (win.minimized) _restore(id);
              },
            });
          });
        }
      }

      // ── Multi-select tile / group actions ───────────────────────────────
      var selectedIds = Array.from(_selectedWindows.values()).filter(function (sid) { return _wins.has(sid); });
      if (selectedIds.length >= 2) {
        var inSelection = _selectedWindows.has(id);
        if (inSelection) {
          items.push({ type: 'separator' });
          items.push({
            label:    _labels.tileWithSelected,
            onSelect: function () { tileSelected('2x2'); },
          });
          items.push({
            label:    _labels.createDockGroup,
            onSelect: function () { createDockGroup(selectedIds); clearWindowSelection(); },
          });
        }
      }

      items.push({ type: 'separator' });
      items.push({
        label:    _labels.close,
        danger:   true,
        onSelect: function () { close(id); },
      });
      return items;
    }

    // ── Internal: render callback ─────────────────────────────────────────
    function _callRender(id) {
      var cfg = _registry.get(id);
      if (cfg && cfg.onRender) cfg.onRender(body(id));
    }

    // ── Internal: dock system ─────────────────────────────────────────────
    function _getDockConfig(cfg) {
      cfg = cfg || {};
      if (cfg.fullscreenDesktop || cfg.backgroundLayer) return null;

      var hasExplicitDockable = Object.prototype.hasOwnProperty.call(cfg, 'dockable');
      var dockable = hasExplicitDockable ? !!cfg.dockable : true;
      if (!dockable) return null;

      var sides = Array.isArray(cfg.dockableSides) && cfg.dockableSides.length
        ? cfg.dockableSides.map(function (s) { return String(s || '').toLowerCase(); })
        : ['left', 'right'];
      return {
        sides:      sides,
        threshold:  Math.max(18, Number(cfg.dockMagnetThreshold != null ? cfg.dockMagnetThreshold : 56)),
        margin:     Math.max(0,  Number(cfg.dockMargin          != null ? cfg.dockMargin          : 12)),
        topInset:   Math.max(0,  Number(cfg.dockTopInset        != null ? cfg.dockTopInset        : 12)),
        bottomInset:Math.max(0,  Number(cfg.dockBottomInset     != null ? cfg.dockBottomInset     : 56)),
      };
    }

    function _setDockPreview(side) {
      var root = document.body || document.documentElement;
      if (!root) return;
      root.classList.remove('wm-dock-preview-left', 'wm-dock-preview-right', 'wm-dock-preview-bottom');
      if (side === 'left')   root.classList.add('wm-dock-preview-left');
      if (side === 'right')  root.classList.add('wm-dock-preview-right');
      if (side === 'bottom') root.classList.add('wm-dock-preview-bottom');
    }

    function _clearDockPreview() { _setDockPreview(''); }

    function _setDockState(winEl, side) {
      if (!winEl) return;
      winEl.classList.remove('wm-docked', 'wm-docked-left', 'wm-docked-right', 'wm-docked-bottom');
      if (side === 'left' || side === 'right' || side === 'bottom') {
        winEl.classList.add('wm-docked');
        if (side === 'left')   winEl.classList.add('wm-docked-left');
        if (side === 'right')  winEl.classList.add('wm-docked-right');
        if (side === 'bottom') winEl.classList.add('wm-docked-bottom');
        winEl.dataset.wmDocked = side;
      } else {
        delete winEl.dataset.wmDocked;
      }
    }

    function _saveDock(id, payload) {
      try {
        if (!id) return;
        if (!payload || !payload.side) {
          localStorage.removeItem(_dockPrefix + id);
        } else {
          localStorage.setItem(_dockPrefix + id, JSON.stringify({ side: String(payload.side) }));
        }
      } catch (_) {}
    }

    function _loadDock(id) {
      try {
        var raw    = localStorage.getItem(_dockPrefix + id);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || (parsed.side !== 'left' && parsed.side !== 'right' && parsed.side !== 'bottom')) return null;
        return parsed;
      } catch (_) { return null; }
    }

    function _pickDockSide(cfg, cx, cy) {
      var dockCfg = _getDockConfig(cfg);
      if (!dockCfg) return null;
      var width   = Math.max(320, window.innerWidth  || (document.documentElement && document.documentElement.clientWidth)  || 1280);
      var height  = Math.max(240, window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 720);
      var nearLeft   = cx <= dockCfg.threshold;
      var nearRight  = cx >= (width  - dockCfg.threshold);
      var nearBottom = cy >= (height - dockCfg.threshold);
      if (nearBottom && dockCfg.sides.indexOf('bottom') !== -1) return 'bottom';
      if (nearLeft   && dockCfg.sides.indexOf('left')   !== -1) return 'left';
      if (nearRight  && dockCfg.sides.indexOf('right')  !== -1) return 'right';
      return null;
    }

    function _applyDockPosition(winEl, cfg, side, persist) {
      persist = persist !== false;
      if (!winEl || (side !== 'left' && side !== 'right' && side !== 'bottom')) return false;
      var dockCfg = _getDockConfig(cfg);
      if (!dockCfg || dockCfg.sides.indexOf(side) === -1) return false;

      var desktop = _desktop();
      var ds      = _desktopSize(desktop);
      var insets  = _getViewportInsets();
      var width   = Math.max(200, winEl.offsetWidth  || parseInt(winEl.style.width,  10) || Number((cfg && cfg.w)  || 360));
      var height  = Math.max(140, winEl.offsetHeight || parseInt(winEl.style.height, 10) || Number((cfg && cfg.h)  || 320));

      var x = parseInt(winEl.style.left, 10);
      var y = parseInt(winEl.style.top,  10);

      if (side === 'left' || side === 'right') {
        var topInset    = Math.max(dockCfg.topInset,    insets.top    + dockCfg.margin);
        var botInset    = Math.max(dockCfg.bottomInset, insets.bottom + dockCfg.margin);
        x = side === 'left'
          ? dockCfg.margin
          : Math.max(dockCfg.margin, ds.w - width - dockCfg.margin);
        var fallbackTop = Number.isFinite(Number(cfg && cfg.defaultY)) ? Number(cfg.defaultY) : topInset;
        var maxTop      = Math.max(topInset, ds.h - height - dockCfg.margin - botInset);
        y = Math.min(maxTop, Math.max(topInset, Number.isFinite(y) ? y : fallbackTop));
      } else if (side === 'bottom') {
        var tbTopInset  = Math.max(dockCfg.topInset,    insets.top    + dockCfg.margin);
        var tbBotInset  = Math.max(dockCfg.bottomInset, insets.bottom + dockCfg.margin);
        var fallbackLeft = Number.isFinite(Number(cfg && cfg.defaultX))
          ? Number(cfg.defaultX)
          : Math.floor((ds.w - width) / 2);
        x = Math.min(
          Math.max(dockCfg.margin, Number.isFinite(x) ? x : fallbackLeft),
          Math.max(dockCfg.margin, ds.w - width - dockCfg.margin),
        );
        y = Math.max(tbTopInset, ds.h - height - dockCfg.margin - tbBotInset);
      }

      winEl.style.left = Math.max(0, x) + 'px';
      winEl.style.top  = Math.max(0, y) + 'px';
      _setDockState(winEl, side);

      if (persist) {
        var pid = String((winEl.dataset && winEl.dataset.winid) || '');
        _saveDock(pid, { side: side });
      }
      return true;
    }

    // ── Internal: drag ────────────────────────────────────────────────────
    function _makeDraggable(winEl) {
      var bar = winEl.querySelector('.wm-titlebar');
      if (!bar) return;
      var dragging = false, ox = 0, oy = 0, dockCandidate = null;

      function getWindowConfig() {
        var id = String((winEl.dataset && winEl.dataset.winid) || '');
        var w  = _wins.get(id);
        return (w && w.cfg) || _registry.get(id) || {};
      }

      function clearDockPersistence() {
        var id = String((winEl.dataset && winEl.dataset.winid) || '');
        _saveDock(id, null);
        _setDockState(winEl, null);
      }

      bar.addEventListener('mousedown', function (e) {
        if (_isMobileMode()) return;
        if (e.target.closest('.wm-controls')) return;
        dragging = true;
        ox = e.clientX - winEl.offsetLeft;
        oy = e.clientY - winEl.offsetTop;
        dockCandidate = null;
        _clearDockPreview();
        _setDockState(winEl, null);
        winEl.classList.add('wm-dragging');
        e.preventDefault();
      });

      bar.addEventListener('touchstart', function (e) {
        if (_isMobileMode()) return;
        if (e.target.closest('.wm-controls')) return;
        var t = e.touches[0];
        dragging = true;
        ox = t.clientX - winEl.offsetLeft;
        oy = t.clientY - winEl.offsetTop;
        dockCandidate = null;
        _clearDockPreview();
        _setDockState(winEl, null);
        e.preventDefault();
      }, { passive: false });

      function onMove(cx, cy) {
        if (!dragging) return;
        var desktop = _desktop();
        var ds      = _desktopSize(desktop);
        var insets  = _getViewportInsets();
        var margin  = 8;
        var x  = Math.max(margin, Math.min(cx - ox, ds.w - winEl.offsetWidth - margin));
        var minY = insets.top + margin;
        var maxY = Math.max(minY, ds.h - insets.bottom - winEl.offsetHeight - margin);
        var y    = Math.max(minY, Math.min(cy - oy, maxY));

        var cfg   = getWindowConfig();
        var side  = _pickDockSide(cfg, cx, cy);
        dockCandidate = side;
        if (side) {
          _setDockPreview(side);
          var dc = _getDockConfig(cfg);
          if (dc) {
            if (side === 'left')  x = dc.margin;
            if (side === 'right') x = Math.max(0, ds.w - winEl.offsetWidth - dc.margin);
          }
        } else {
          _clearDockPreview();
        }

        winEl.style.left = x + 'px';
        winEl.style.top  = y + 'px';
      }

      function onEnd() {
        if (!dragging) return;
        dragging = false;
        _clearDockPreview();
        winEl.classList.remove('wm-dragging');
        var id  = winEl.dataset.winid;
        var cfg = getWindowConfig();
        if (dockCandidate) {
          _applyDockPosition(winEl, cfg, dockCandidate, true);
        } else {
          clearDockPersistence();
        }
        _savePos(id, parseInt(winEl.style.left), parseInt(winEl.style.top),
                 winEl.offsetWidth, winEl.offsetHeight);
        dockCandidate = null;
        _syncAllDockGroupUis();
      }

      document.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
      document.addEventListener('mouseup',   onEnd);
      document.addEventListener('touchmove', function (e) {
        var t = e.touches[0]; onMove(t.clientX, t.clientY);
      }, { passive: true });
      document.addEventListener('touchend', onEnd);
    }

    // ── Internal: resize ──────────────────────────────────────────────────
    function _makeResizable(winEl) {
      var handle = winEl.querySelector('.wm-resize-handle');
      if (!handle) return;
      var resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;

      handle.addEventListener('mousedown', function (e) {
        if (_isMobileMode()) return;
        resizing = true;
        sx = e.clientX; sy = e.clientY;
        sw = winEl.offsetWidth; sh = winEl.offsetHeight;
        winEl.classList.add('wm-resizing');
        e.preventDefault();
        e.stopPropagation();
      });

      document.addEventListener('mousemove', function (e) {
        if (!resizing) return;
        var margin   = 8;
        var insets   = _getViewportInsets();
        var viewportW = Math.max(320, window.innerWidth  || (document.documentElement && document.documentElement.clientWidth)  || 1280);
        var viewportH = Math.max(220, window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 720);
        var left = parseInt(winEl.style.left, 10) || winEl.offsetLeft || 0;
        var top  = parseInt(winEl.style.top,  10) || winEl.offsetTop  || 0;
        var maxW = Math.max(280, viewportW - insets.right  - margin - left);
        var maxH = Math.max(180, viewportH - insets.bottom - margin - top);
        var nw   = Math.min(maxW, Math.max(280, sw + (e.clientX - sx)));
        var nh   = Math.min(maxH, Math.max(180, sh + (e.clientY - sy)));
        winEl.style.width  = nw + 'px';
        winEl.style.height = nh + 'px';
      });

      document.addEventListener('mouseup', function () {
        if (!resizing) return;
        resizing = false;
        winEl.classList.remove('wm-resizing');
        var id = winEl.dataset.winid;
        _savePos(id, parseInt(winEl.style.left), parseInt(winEl.style.top),
                 winEl.offsetWidth, winEl.offsetHeight);
        _syncAllDockGroupUis();
      });
    }

    // ── Internal: taskbar button ──────────────────────────────────────────
    function _addTaskBtn(id, title) {
      var taskbar = document.getElementById('wm-taskbar');
      if (!taskbar) return;
      _ensureTaskbarSplitButton();
      var btn = document.createElement('button');
      btn.className = 'wm-task-btn';
      btn.id        = 'wm-task-' + id;
      btn.appendChild(new GQUI.Span().setClass('wm-task-label').setTextContent(title).dom);
      (function (btnId) {
        btn.addEventListener('click', function () {
          var nativeEvent = arguments && arguments[0] ? arguments[0] : null;
          if (nativeEvent && (nativeEvent.ctrlKey || nativeEvent.metaKey)) {
            setWindowSelected(btnId, !_selectedWindows.has(btnId));
            return;
          }
          var win = _wins.get(btnId);
          if (!win) return;
          if (win.minimized) _restore(btnId); else _minimize(btnId);
        });
        btn.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          e.stopPropagation();
          contextMenu(_buildWindowContextMenuItems(btnId), {
            x:     e.clientX,
            y:     e.clientY,
            title: title || btnId,
          });
        });
      })(id);
      var spacer = document.getElementById('wm-taskbar-spacer');
      if (spacer) taskbar.insertBefore(btn, spacer);
      else taskbar.appendChild(btn);
    }

    function _syncFullscreenWindows() {
      var desktop = _desktop();
      var ds      = _desktopSize(desktop);
      _wins.forEach(function (win) {
        if (!win.cfg || !win.cfg.fullscreenDesktop) return;
        win.el.style.left   = '0px';
        win.el.style.top    = '0px';
        win.el.style.width  = ds.w + 'px';
        win.el.style.height = ds.h + 'px';
      });
    }

    // ── Internal: localStorage persistence ───────────────────────────────
    function _savePos(id, x, y, w, h) {
      try {
        if ([x, y, w, h].some(function (v) { return v == null || !Number.isFinite(Number(v)); })) {
          localStorage.removeItem(_posPrefix + id);
          return;
        }
        localStorage.setItem(_posPrefix + id, JSON.stringify({ x: x, y: y, w: w, h: h }));
      } catch (_) {}
    }

    function _loadPos(id) {
      try { return JSON.parse(localStorage.getItem(_posPrefix + id)); }
      catch (_) { return null; }
    }

    // ── Internal: host section ────────────────────────────────────────────
    function _ensureWindowHost(id, desktop) {
      var host = document.getElementById('wm-host-' + id);
      if (host) return host;
      host = document.createElement('section');
      host.id        = 'wm-host-' + id;
      host.className = 'wm-window-host';
      desktop.appendChild(host);
      return host;
    }

    // ── Internal: desktop helpers ─────────────────────────────────────────
    function _desktop() {
      return document.body || document.documentElement;
    }

    function _desktopSize(desktop) {
      if (!desktop) return { w: window.innerWidth || 1280, h: window.innerHeight || 720 };
      if (desktop === document.body || desktop === document.documentElement) {
        return {
          w: Math.max(320, window.innerWidth  || desktop.clientWidth  || 1280),
          h: Math.max(220, window.innerHeight || desktop.clientHeight || 720),
        };
      }
      return {
        w: Math.max(320, desktop.offsetWidth  || desktop.clientWidth  || window.innerWidth  || 1280),
        h: Math.max(220, desktop.offsetHeight || desktop.clientHeight || window.innerHeight || 720),
      };
    }

    // ── Internal: utilities ───────────────────────────────────────────────
    function _esc(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _toWindowTitle(id) {
      var raw = String(id || '').trim();
      if (!raw) return 'Window';
      return raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
    }

    function _attrBool(el, name, fallback) {
      if (!(el instanceof HTMLElement)) return !!fallback;
      var raw = String(el.getAttribute(name) || '').trim().toLowerCase();
      if (!raw) return !!fallback;
      if (raw === '1' || raw === 'true'  || raw === 'yes' || raw === 'on')  return true;
      if (raw === '0' || raw === 'false' || raw === 'no'  || raw === 'off') return false;
      return !!fallback;
    }

    function _attrNum(el, name, fallback) {
      if (!(el instanceof HTMLElement)) return Number(fallback);
      var raw = String(el.getAttribute(name) || '').trim();
      if (!raw) return Number(fallback);
      var n = Number(raw);
      return Number.isFinite(n) ? n : Number(fallback);
    }

    // ── Internal: auto-hydrate data-wm-window elements ───────────────────
    function _autoHydratePrebuiltWindows() {
      if (_prebuiltHydrationDone) return;

      function run() {
        var nodes = Array.from(document.querySelectorAll('[data-wm-window]'));
        if (!nodes.length) return;

        nodes.forEach(function (node) {
          if (!(node instanceof HTMLElement)) return;
          var id = String(node.getAttribute('data-wm-window') || '').trim();
          if (!id || _wins.has(id)) return;

          var host   = node.closest('.wm-window-host') || node.parentElement;
          var hostId = (host instanceof HTMLElement && host.id) ? host.id : '';
          var width          = _attrNum(node, 'data-wm-width',          420);
          var height         = _attrNum(node, 'data-wm-height',         360);
          var defaultY       = _attrNum(node, 'data-wm-default-y',       12);
          var title          = String(node.getAttribute('data-wm-title') || _toWindowTitle(id));
          var defaultDock    = String(node.getAttribute('data-wm-default-dock') || '').trim().toLowerCase();
          var preserveOnClose= _attrBool(node, 'data-wm-preserve-on-close', true);
          var hideTaskButton = _attrBool(node, 'data-wm-hide-task-button',  false);
          var persistState   = _attrBool(node, 'data-wm-persist-state',     false);

          var cfg = {
            title: title, adaptExisting: true,
            prebuiltSelector: '[data-wm-window="' + id + '"]',
            preserveOnClose: preserveOnClose, hideTaskButton: hideTaskButton,
            persistState: persistState, defaultY: defaultY,
            w: Number.isFinite(width)  ? width  : 420,
            h: Number.isFinite(height) ? height : 360,
          };
          if (defaultDock === 'left' || defaultDock === 'right') cfg.defaultDock = defaultDock;
          if (hostId) cfg.sectionId = hostId;

          try {
            adopt(id, cfg);
            if (_wins.has(id)) close(id);
          } catch (_) {}
        });

        _prebuiltHydrationDone = true;
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
        return;
      }
      run();
    }

    // ── Public: modal ─────────────────────────────────────────────────────
    /**
     * wm.modal(sectionId, opts?)
     *   sectionId      – id of the <section class="wm-modal"> element
     *   opts.title     – optional title override
     *   opts.startCard – 0-based card index to start on  (default 0)
     *   opts.onClose   – callback when dialog is dismissed
     */
    function modal(sectionId, opts) {
      opts = opts || {};
      var el = document.getElementById(sectionId);
      if (!el || !el.classList.contains('wm-modal')) return;
      _openModal(el, opts);
    }

    function _closeModal(el) {
      if (!(el instanceof HTMLElement)) return;
      var state = el.__wmModalState;
      el.hidden = true;
      el.classList.remove('wm-modal-open');
      if (state && typeof state.onKey === 'function') {
        document.removeEventListener('keydown', state.onKey);
      }
      var onClose = (state && typeof state.onClose === 'function') ? state.onClose : null;
      if (state) { state.onClose = null; state.onKey = null; }
      if (onClose) onClose();
    }

    function _openModal(el, opts) {
      opts = opts || {};
      var titleEl = el.querySelector('.wm-modal-title');
      if (titleEl && opts.title) titleEl.textContent = opts.title;

      var cards   = Array.from(el.querySelectorAll('[data-wm-card], [data-tooltip-card]'));
      var current = Number.isFinite(Number(opts.startCard)) ? Number(opts.startCard) : 0;
      current     = Math.max(0, Math.min(current, Math.max(0, cards.length - 1)));

      var prevBtn   = el.querySelector('[data-wm-modal-prev]') || el.querySelector('#tooltip-btn-prev');
      var nextBtn   = el.querySelector('[data-wm-modal-next]') || el.querySelector('#tooltip-btn-next');
      var indicator = el.querySelector('[data-wm-modal-indicator]') || el.querySelector('.wm-modal-page-indicator');

      var state = el.__wmModalState || {};
      state.current = current;
      state.onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
      el.__wmModalState = state;

      function showCard(idx) {
        if (!cards.length) return;
        state.current = Math.max(0, Math.min(idx, cards.length - 1));
        cards.forEach(function (c, i) { c.hidden = (i !== state.current); });
        if (prevBtn)   prevBtn.disabled    = state.current === 0;
        if (nextBtn)   nextBtn.disabled    = state.current === cards.length - 1;
        if (indicator) indicator.textContent = (state.current + 1) + ' / ' + cards.length;
      }

      if (prevBtn && !prevBtn.__wmModalBound) {
        prevBtn.__wmModalBound = true;
        prevBtn.addEventListener('click', function () {
          showCard((el.__wmModalState && el.__wmModalState.current != null ? el.__wmModalState.current : 0) - 1);
        });
      }
      if (nextBtn && !nextBtn.__wmModalBound) {
        nextBtn.__wmModalBound = true;
        nextBtn.addEventListener('click', function () {
          showCard((el.__wmModalState && el.__wmModalState.current != null ? el.__wmModalState.current : 0) + 1);
        });
      }

      el.querySelectorAll('[data-wm-modal-close]').forEach(function (btn) {
        if (!btn.__wmCloseBound) {
          btn.__wmCloseBound = true;
          btn.addEventListener('click', function () { _closeModal(el); });
        }
      });

      el.querySelectorAll('[data-wm-modal-action]').forEach(function (btn) {
        if (!btn.__wmActionBound) {
          btn.__wmActionBound = true;
          btn.addEventListener('click', function () {
            var action = String(btn.getAttribute('data-wm-modal-action') || 'action');
            var value  = btn.getAttribute('data-wm-modal-value');
            window.dispatchEvent(new CustomEvent('wm:modal-action', {
              detail: { id: el.id, action: action, value: value },
            }));
            if (btn.hasAttribute('data-wm-modal-close')) _closeModal(el);
          });
        }
      });

      if (state.onKey) document.removeEventListener('keydown', state.onKey);
      state.onKey = function (e) {
        if (!el.classList.contains('wm-modal-open')) return;
        var cur = el.__wmModalState && el.__wmModalState.current != null ? el.__wmModalState.current : 0;
        if (e.key === 'Escape')      _closeModal(el);
        if (e.key === 'ArrowLeft')   showCard(cur - 1);
        if (e.key === 'ArrowRight')  showCard(cur + 1);
      };
      document.addEventListener('keydown', state.onKey);

      if (cards.length) showCard(current);
      el.hidden = false;
      el.classList.add('wm-modal-open');

      requestAnimationFrame(function () {
        var focusable = el.querySelector(
          '.wm-modal-dialog button, .wm-modal-dialog input, .wm-modal-dialog select, .wm-modal-dialog textarea'
        );
        if (focusable) focusable.focus();
      });
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────
    _autoHydratePrebuiltWindows();

    // ── Public API ────────────────────────────────────────────────────────
    return {
      register:              register,
      adopt:                 adopt,
      open:                  open,
      close:                 close,
      refresh:               refresh,
      body:                  body,
      isOpen:                isOpen,
      isMinimized:           isMinimized,
      setTitle:              setTitle,
      modal:                 modal,
      minimize:              _minimize,
      restore:               _restore,
      contextMenu:           contextMenu,
      closeContextMenu:      _closeContextMenu,
      restorePersistedState: restorePersistedState,
      listThemes:            listThemes,
      setTheme:              setTheme,
      getTheme:              getTheme,
      clearTheme:            clearTheme,
      applyTheme:            applyTheme,
      registerCommand:       registerCommand,
      unregisterCommand:     unregisterCommand,
      registerHotkey:        _registerHotkey,
      unregisterHotkey:      _unregisterHotkey,
      executeCommand:        executeCommand,
      listCommands:          listCommands,
      showCommandPalette:    showCommandPalette,
      hideCommandPalette:    hideCommandPalette,
      setWindowSelected:     setWindowSelected,
      clearWindowSelection:  clearWindowSelection,
      getSelectedWindows:    getSelectedWindows,
      suggestSnapTargets:    suggestSnapTargets,
      tileWindows:           tileWindows,
      tileSelected:          tileSelected,
      createDockGroup:       createDockGroup,
      activateDockTab:       activateDockTab,
      reorderDockTab:        reorderDockTab,
      listDockGroups:        listDockGroups,
      cycleDockTabNext:      cycleDockTabNext,
      cycleDockTabPrev:      cycleDockTabPrev,
      cycleWindowFocusNext:  cycleWindowFocusNext,
      cycleWindowFocusPrev:  cycleWindowFocusPrev,
      cycleWindowLinearNext: cycleWindowLinearNext,
      cycleWindowLinearPrev: cycleWindowLinearPrev,
      toggleMostRecentWindow:toggleMostRecentWindow,
      saveLayoutProfile:     saveLayoutProfile,
      loadLayoutProfile:     loadLayoutProfile,
      listLayoutProfiles:    listLayoutProfiles,
      deleteLayoutProfile:   deleteLayoutProfile,
      exportWorkspaceConfig: exportWorkspaceConfig,
      importWorkspaceConfig: importWorkspaceConfig,
      resetScope:            resetScope,
    };
  }

  // ── WMCore module export ───────────────────────────────────────────────────
  return { create: create };

})();

if (typeof window !== 'undefined') {
  window.WMCore = WMCore;
}
