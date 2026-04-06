/**
 * GalaxyQuest – Window Manager (WM)
 *
 * Provides a desktop-style floating window system.
 * Depends on: GQUI (js/ui/gq-ui.js) for DOM construction.
 *
 * Public API
 * ----------
 *   WM.open(id)              – open or focus a named window
 *   WM.close(id)             – close a window
 *   WM.refresh(id)           – re-run the registered render function
 *   WM.body(id)              – returns the window's content <div> or null
 *   WM.isOpen(id)            – true if window exists and is not closed
 *   WM.setTitle(id, title)   – update a window's title bar text
 *   WM.register(id, cfg)     – register config without opening (called by game.js)
 *   WM.adopt(id, cfg)        – register+open using an existing section/container
 */
const WM = (() => {
  // ── Registry ────────────────────────────────────────────────────────────────
  /** @type {Map<string, {el:HTMLElement, hostEl:HTMLElement, cfg:object, minimized:boolean, adopted:boolean, preserveOnClose:boolean, hostManaged:boolean}>} */
  const _wins = new Map();
  /** @type {Map<string, object>} */
  const _registry = new Map();

  let _topZ = 100;
  // Cascade offset for newly opened windows
  let _nextX = 60;
  let _nextY = 60;
  let _contextMenuState = null;
  let _restoreAttempted = false;
  let _isRestoringState = false;
  let _recentClosed = [];
  let _prebuiltHydrationDone = false;

  const WM_MOBILE_BREAKPOINT = 800;
  const WM_DOCK_STORAGE_PREFIX = 'gq_wdock_';
  const WM_STATE_COOKIE_KEY = 'gq_wm_state_v1';
  const WM_STATE_COOKIE_DAYS = 60;
  const WM_RECENT_CLOSED_LIMIT = 10;

  function _isMobileMode() {
    return (window.innerWidth || 0) < WM_MOBILE_BREAKPOINT;
  }

  function _syncResponsiveClass() {
    const root = document.body || document.documentElement;
    if (!root) return;
    root.classList.toggle('wm-mobile', _isMobileMode());
  }

  window.addEventListener('resize', () => {
    _syncResponsiveClass();
    _syncFullscreenWindows();
  });
  _syncResponsiveClass();

  // ── Default window configurations ───────────────────────────────────────────
  const DEFAULTS = {
    overview:    { title: 'Overview',          w: 860, h: 540 },
    buildings:   { title: 'Buildings',         w: 680, h: 540 },
    research:    { title: 'Research',          w: 680, h: 540 },
    shipyard:    { title: 'Shipyard',          w: 740, h: 540 },
    fleet:       { title: 'Fleet',             w: 640, h: 640 },
    galaxy:      { title: 'Galaxy Map',        w: 860, h: 540 },
    messages:    { title: 'Messages',          w: 640, h: 520 },
    quests:      { title: 'Quests',            w: 860, h: 620 },
    leaderboard: { title: 'Leaderboard',       w: 540, h: 480 },
  };

  // ── Public: register a window with a render callback ────────────────────────
  function register(id, cfg) {
    _registry.set(id, Object.assign({}, DEFAULTS[id] || {}, cfg));
  }

  // ── Public: register and open an existing section/container as WM window ───
  function adopt(id, cfg = {}) {
    const nextCfg = Object.assign({ adaptExisting: true }, cfg || {});
    register(id, nextCfg);
    open(id);
  }

  // ── Public: open or focus a window ──────────────────────────────────────────
  function open(id) {
    if (_wins.has(id)) {
      const win = _wins.get(id);
      if (win.minimized) _restore(id);
      else if (!win.cfg?.backgroundLayer) _focus(id);
      _callRender(id);
      return;
    }

    const cfg = _registry.get(id) || DEFAULTS[id] || { title: id, w: 600, h: 400 };
    const desktop = _desktop();
    if (!desktop) return;
    const ds = _desktopSize(desktop);

    const { el, hostEl, adopted, hostManaged } = _resolveWindowElement(id, cfg, desktop);
    if (!el || !hostEl) return;

    el.classList.remove('wm-closed');

    if (cfg.fullscreenDesktop) {
      el.style.left   = '0px';
      el.style.top    = '0px';
      el.style.width  = ds.w + 'px';
      el.style.height = ds.h + 'px';
    } else if (!cfg.keepExistingGeometry) {
      // Position: restore saved or use cascaded default
      const saved = _loadPos(id);
      let x = saved ? saved.x : _nextX;
      let y = saved ? saved.y : _nextY;

      if (!saved) {
        if (cfg.defaultDock === 'right') {
          const margin = Number(cfg.defaultDockMargin ?? 12);
          const dockY = Number(cfg.defaultY ?? 12);
          x = Math.max(0, ds.w - (cfg.w ?? 600) - margin);
          y = Math.max(0, dockY);
        } else if (cfg.defaultDock === 'bottom') {
          const margin = Number(cfg.defaultDockMargin ?? 12);
          const bottomInset = Math.max(0, Number(cfg.dockBottomInset ?? 56));
          x = Number.isFinite(Number(cfg.defaultX))
            ? Number(cfg.defaultX)
            : Math.max(0, Math.floor((ds.w - (cfg.w ?? 600)) / 2));
          y = Math.max(0, ds.h - (cfg.h ?? 400) - margin - bottomInset);
        } else {
          if (Number.isFinite(Number(cfg.defaultX))) x = Number(cfg.defaultX);
          if (Number.isFinite(Number(cfg.defaultY))) y = Number(cfg.defaultY);
        }
      }

      if (!saved) {
        _nextX = (_nextX + 32) % Math.max(100, ds.w - cfg.w - 60);
        _nextY = (_nextY + 32) % Math.max(100, ds.h - cfg.h - 60);
      }

      // Clamp to desktop
      x = Math.max(0, Math.min(x, Math.max(0, ds.w - cfg.w)));
      y = Math.max(0, Math.min(y, Math.max(0, ds.h - cfg.h)));

      el.style.left   = x + 'px';
      el.style.top    = y + 'px';
      el.style.width  = (saved?.w ?? cfg.w) + 'px';
      el.style.height = (saved?.h ?? cfg.h) + 'px';
    }

    if (el.parentElement !== hostEl) hostEl.appendChild(el);
    _wins.set(id, {
      el,
      hostEl,
      cfg,
      minimized: false,
      adopted: !!adopted,
      preserveOnClose: !!(adopted && cfg.preserveOnClose !== false),
      hostManaged: !!hostManaged,
    });

    _removeFromRecentClosed(id);

    const savedDock = _loadDock(id);
    if (savedDock?.side) {
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
  }

  // ── Public: close a window ──────────────────────────────────────────────────
  function close(id) {
    if (!_wins.has(id)) return;
    const win = _wins.get(id);
    const cfg = win?.cfg || _registry.get(id) || DEFAULTS[id] || {};
    if (win?.preserveOnClose) {
      win.el.classList.add('wm-closed');
      win.el.classList.remove('wm-focused');
      win.el.classList.remove('wm-minimized');
    } else {
      if (win?.el) win.el.remove();
      if (win?.hostManaged && win?.hostEl) win.hostEl.remove();
    }
    _wins.delete(id);
    document.getElementById('wm-task-' + id)?.remove();
    _pushRecentClosed(id, cfg?.title || id);
    _persistWindowStateCookie();
  }

  // ── Public: re-render contents of an open window ────────────────────────────
  function refresh(id) {
    if (!_wins.has(id) || _wins.get(id).minimized) return;
    _callRender(id);
  }

  // ── Public: get the content div of an open window ───────────────────────────
  function body(id) {
    return _wins.get(id)?.el.querySelector('.wm-body') ?? null;
  }

  // ── Public: is the window currently open (not closed)? ──────────────────────
  function isOpen(id) { return _wins.has(id); }

  // ── Public: update a window's title bar text ────────────────────────────────
  function setTitle(id, title) {
    const el = document.getElementById('wm-win-' + id);
    if (el) el.querySelector('.wm-title').textContent = title;
    const tb = document.getElementById('wm-task-' + id);
    if (tb) tb.querySelector('.wm-task-label').textContent = title;
  }

  // ── Internal: decide whether to build new window or adapt existing container
  function _resolveWindowElement(id, cfg, desktop) {
    const host = _resolveHostSection(id, cfg, desktop);
    if (!host) return { el: null, hostEl: null, adopted: false, hostManaged: false };

    let el = null;
    if (cfg.adaptExisting !== false) {
      el = _findAdaptableWindow(id, cfg, host);
      if (el) {
        _prepareAdaptedWindow(el, id, cfg);
      }
    }
    if (!el) el = _buildEl(id, cfg);

    _wireWindowInteractions(el, id, cfg);
    return {
      el,
      hostEl: host,
      adopted: !!cfg.adaptExisting && !!_isAdaptedWindow(el),
      hostManaged: host.classList.contains('wm-window-host'),
    };
  }

  function _resolveHostSection(id, cfg, desktop) {
    if (cfg.sectionId) {
      const explicit = document.getElementById(String(cfg.sectionId));
      if (explicit) return explicit;
    }
    if (cfg.hostSectionId) {
      const explicitHost = document.getElementById(String(cfg.hostSectionId));
      if (explicitHost) return explicitHost;
    }
    return _ensureWindowHost(id, desktop);
  }

  function _findAdaptableWindow(id, cfg, host) {
    const selectors = [];
    if (cfg.prebuiltSelector) selectors.push(String(cfg.prebuiltSelector));
    selectors.push(`[data-wm-window="${id}"]`, '.wm-window', '.wm-adaptable-window');
    for (const sel of selectors) {
      const found = host.querySelector(sel);
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
    if (cfg.backgroundLayer) el.classList.add('wm-window-background');
    if (!el.id) el.id = 'wm-win-' + id;
    el.setAttribute('data-winid', id);

    let body = el.querySelector(':scope > .wm-body');
    const titlebar = el.querySelector(':scope > .wm-titlebar');
    const resizeHandle = el.querySelector(':scope > .wm-resize-handle');

    if (!cfg.fullscreenDesktop && !titlebar) {
      const minBtn   = new GQUI.Button('\u2013').setClass('wm-btn wm-btn-min');
      minBtn.dom.title = 'Minimise';
      const closeBtn = new GQUI.Button('\u2715').setClass('wm-btn wm-btn-close');
      closeBtn.dom.title = 'Close';
      const head = new GQUI.Div()
        .setClass('wm-titlebar')
        .add(new GQUI.Span().setClass('wm-title').setTextContent(cfg.title || id))
        .add(new GQUI.Div().setClass('wm-controls').add(minBtn, closeBtn));
      el.insertBefore(head.dom, el.firstChild);
    }

    if (!body) {
      body = document.createElement('div');
      body.className = 'wm-body';
      const moveNodes = Array.from(el.childNodes).filter((node) => {
        if (!(node instanceof HTMLElement)) return true;
        return !node.classList.contains('wm-titlebar') && !node.classList.contains('wm-resize-handle');
      });
      moveNodes.forEach((node) => body.appendChild(node));
      const existingResize = el.querySelector(':scope > .wm-resize-handle');
      if (existingResize) el.insertBefore(body, existingResize);
      else el.appendChild(body);
    }

    if (!cfg.fullscreenDesktop && !resizeHandle) {
      const handle = document.createElement('div');
      handle.className = 'wm-resize-handle';
      handle.title = 'Resize';
      el.appendChild(handle);
    }
  }

  function _isAdaptedWindow(el) {
    return !!(el && el.classList && el.classList.contains('wm-window-adapted'));
  }

  // ── Internal: build window DOM element ──────────────────────────────────────
  function _buildEl(id, cfg) {
    const el = document.createElement('section');
    el.className = 'wm-window'
      + (cfg.fullscreenDesktop ? ' wm-window-fullscreen' : '')
      + (cfg.backgroundLayer ? ' wm-window-background' : '');
    el.id        = 'wm-win-' + id;
    el.setAttribute('data-winid', id);
    if (!cfg.fullscreenDesktop) {
      const minBtn   = new GQUI.Button('\u2013').setClass('wm-btn wm-btn-min');
      minBtn.dom.title = 'Minimise';
      const closeBtn = new GQUI.Button('\u2715').setClass('wm-btn wm-btn-close');
      closeBtn.dom.title = 'Close';
      el.appendChild(new GQUI.Div()
        .setClass('wm-titlebar')
        .add(new GQUI.Span().setClass('wm-title').setTextContent(cfg.title))
        .add(new GQUI.Div().setClass('wm-controls').add(minBtn, closeBtn))
        .dom);
    }
    el.appendChild(new GQUI.Div().setClass('wm-body').dom);
    if (!cfg.fullscreenDesktop) {
      const handle = new GQUI.Div().setClass('wm-resize-handle');
      handle.dom.title = 'Resize';
      el.appendChild(handle.dom);
    }

    return el;
  }

  function _wireWindowInteractions(el, id, cfg) {
    if (!el || el.dataset.wmInteractiveBound === '1') return;
    el.dataset.wmInteractiveBound = '1';

    if (!cfg.backgroundLayer) {
      el.addEventListener('mousedown', () => _focus(id), true);
    }

    const minBtn = el.querySelector('.wm-btn-min');
    const closeBtn = el.querySelector('.wm-btn-close');
    if (minBtn) minBtn.addEventListener('click', e => { e.stopPropagation(); _minimize(id); });
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); close(id); });

    const titlebar = el.querySelector('.wm-titlebar');
    if (titlebar && titlebar.dataset.wmContextBound !== '1') {
      titlebar.dataset.wmContextBound = '1';
      titlebar.addEventListener('contextmenu', (e) => {
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

  // ── Internal: focus (bring to front) ────────────────────────────────────────
  function _focus(id) {
    const win = _wins.get(id);
    if (!win) return;
    _topZ++;
    win.el.style.zIndex = _topZ;
    document.querySelectorAll('.wm-window').forEach(w => w.classList.remove('wm-focused'));
    document.querySelectorAll('.wm-task-btn').forEach(b => b.classList.remove('wm-task-active'));
    win.el.classList.add('wm-focused');
    document.getElementById('wm-task-' + id)?.classList.add('wm-task-active');
  }

  // ── Internal: minimise ───────────────────────────────────────────────────────
  function _minimize(id) {
    const win = _wins.get(id);
    if (!win || win.minimized) return;
    _closeContextMenu();
    win.minimized = true;
    win.el.classList.add('wm-minimized');
    document.getElementById('wm-task-' + id)?.classList.remove('wm-task-active');
    _persistWindowStateCookie();
  }

  // ── Internal: restore from minimised ────────────────────────────────────────
  function _restore(id) {
    const win = _wins.get(id);
    if (!win || !win.minimized) return;
    _closeContextMenu();
    win.minimized = false;
    win.el.classList.remove('wm-minimized');
    _focus(id);
    _persistWindowStateCookie();
  }

  function _removeFromRecentClosed(id) {
    const key = String(id || '').trim();
    if (!key) return;
    _recentClosed = _recentClosed.filter((entry) => String(entry?.id || '') !== key);
    _refreshTaskbarSplitButtonState();
  }

  function _pushRecentClosed(id, title) {
    const key = String(id || '').trim();
    if (!key) return;
    const item = {
      id: key,
      title: String(title || key),
      ts: Date.now(),
    };
    _recentClosed = [item].concat(_recentClosed.filter((entry) => String(entry?.id || '') !== key));
    _recentClosed = _recentClosed.slice(0, WM_RECENT_CLOSED_LIMIT);
    _refreshTaskbarSplitButtonState();
  }

  function _parseCookiePayload(raw) {
    try {
      if (!raw) return null;
      const decoded = decodeURIComponent(String(raw));
      const parsed = JSON.parse(decoded);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function _readStateCookie() {
    try {
      const cookie = String(document.cookie || '');
      const prefix = `${WM_STATE_COOKIE_KEY}=`;
      const chunk = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
      if (!chunk) return null;
      return _parseCookiePayload(chunk.slice(prefix.length));
    } catch (_) {
      return null;
    }
  }

  function _writeStateCookie(payload) {
    try {
      const expires = new Date(Date.now() + (WM_STATE_COOKIE_DAYS * 24 * 60 * 60 * 1000)).toUTCString();
      const value = encodeURIComponent(JSON.stringify(payload || {}));
      document.cookie = `${WM_STATE_COOKIE_KEY}=${value}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function _collectPersistableWindows() {
    const open = [];
    _wins.forEach((win, id) => {
      if (!win || !id) return;
      const cfg = win.cfg || _registry.get(id) || DEFAULTS[id] || {};
      if (cfg.persistState === false) return;
      if (cfg.backgroundLayer) return;
      open.push({
        id: String(id),
        minimized: !!win.minimized,
      });
    });
    return open;
  }

  function _persistWindowStateCookie() {
    if (_isRestoringState) return;
    const payload = {
      open: _collectPersistableWindows(),
      recentClosed: _recentClosed.slice(0, WM_RECENT_CLOSED_LIMIT).map((entry) => ({
        id: String(entry?.id || ''),
        title: String(entry?.title || entry?.id || ''),
        ts: Number(entry?.ts || 0),
      })).filter((entry) => !!entry.id),
      ts: Date.now(),
    };
    _writeStateCookie(payload);
  }

  function _restoreRecentClosedFromState(state) {
    const rows = Array.isArray(state?.recentClosed) ? state.recentClosed : [];
    _recentClosed = rows
      .map((entry) => ({
        id: String(entry?.id || '').trim(),
        title: String(entry?.title || entry?.id || '').trim(),
        ts: Number(entry?.ts || 0),
      }))
      .filter((entry) => !!entry.id)
      .slice(0, WM_RECENT_CLOSED_LIMIT);
    _refreshTaskbarSplitButtonState();
  }

  function restorePersistedState() {
    if (_restoreAttempted) return;
    _restoreAttempted = true;
    _ensureTaskbarSplitButton();

    const state = _readStateCookie();
    if (!state) {
      _refreshTaskbarSplitButtonState();
      return;
    }

    _restoreRecentClosedFromState(state);
    const openRows = Array.isArray(state.open) ? state.open : [];
    _isRestoringState = true;
    try {
      openRows.forEach((row) => {
        const id = String(row?.id || '').trim();
        if (!id) return;
        if (!_registry.has(id) && !DEFAULTS[id]) return;
        if (!_wins.has(id)) open(id);
        if (row?.minimized) _minimize(id);
      });
    } finally {
      _isRestoringState = false;
      _persistWindowStateCookie();
      _refreshTaskbarSplitButtonState();
    }
  }

  function _buildRecentClosedMenuItems() {
    const items = [];
    const candidates = _recentClosed
      .filter((entry) => {
        const id = String(entry?.id || '');
        return !!id && (_registry.has(id) || !!DEFAULTS[id]);
      })
      .slice(0, WM_RECENT_CLOSED_LIMIT);

    if (!candidates.length) {
      items.push({
        label: 'Keine zuletzt geschlossenen Fenster',
        disabled: true,
      });
      return items;
    }

    candidates.forEach((entry) => {
      const id = String(entry.id || '');
      const title = String(entry.title || id || 'Window');
      items.push({
        label: title,
        meta: id,
        onSelect: () => open(id),
      });
    });

    items.push({ type: 'separator' });
    items.push({
      label: 'Liste leeren',
      danger: true,
      onSelect: () => {
        _recentClosed = [];
        _persistWindowStateCookie();
        _refreshTaskbarSplitButtonState();
      },
    });

    return items;
  }

  function _showRecentClosedMenu(anchorEl) {
    if (!(anchorEl instanceof HTMLElement)) return;
    const rect = anchorEl.getBoundingClientRect();
    contextMenu(_buildRecentClosedMenuItems(), {
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 6),
      title: 'Zuletzt geschlossen',
    });
  }

  function _refreshTaskbarSplitButtonState() {
    const btn = document.getElementById('wm-taskbar-menu-btn');
    const arrow = document.getElementById('wm-taskbar-menu-arrow');
    if (!btn && !arrow) return;
    const enabled = _recentClosed.length > 0;
    if (btn) {
      btn.classList.toggle('has-recent', enabled);
      btn.title = enabled ? 'Zuletzt geschlossene Fenster anzeigen' : 'Keine zuletzt geschlossenen Fenster';
    }
    if (arrow) arrow.disabled = !enabled;
  }

  function _ensureTaskbarSplitButton() {
    const taskbar = document.getElementById('wm-taskbar');
    if (!taskbar) return;

    const splitWrap = document.getElementById('wm-taskbar-split');
    if (!splitWrap) return;
    if (splitWrap.dataset.wmBound === '1') {
      _refreshTaskbarSplitButtonState();
      return;
    }

    const mainBtn = document.getElementById('wm-taskbar-menu-btn');
    const arrowBtn = document.getElementById('wm-taskbar-menu-arrow');
    if (mainBtn) {
      mainBtn.addEventListener('click', () => {
        _showRecentClosedMenu(mainBtn);
      });
    }
    if (arrowBtn) {
      arrowBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _showRecentClosedMenu(arrowBtn);
      });
    }

    splitWrap.dataset.wmBound = '1';
    _refreshTaskbarSplitButtonState();
  }

  function _resetWindowGeometry(id) {
    const win = _wins.get(id);
    if (!win) return;
    const cfg = win.cfg || _registry.get(id) || DEFAULTS[id] || { w: 600, h: 400 };
    const desktop = _desktop();
    const ds = _desktopSize(desktop);

    _saveDock(id, null);
    _savePos(id, null, null, null, null);
    _setDockState(win.el, null);

    const width = Math.max(280, Number(cfg.w || win.el.offsetWidth || 600));
    const height = Math.max(180, Number(cfg.h || win.el.offsetHeight || 400));
    let x = Number.isFinite(Number(cfg.defaultX)) ? Number(cfg.defaultX) : 48;
    let y = Number.isFinite(Number(cfg.defaultY)) ? Number(cfg.defaultY) : 48;

    if (cfg.defaultDock === 'right') {
      const margin = Number(cfg.defaultDockMargin ?? 12);
      x = Math.max(0, ds.w - width - margin);
      y = Math.max(0, Number(cfg.defaultY ?? 12));
    } else if (cfg.defaultDock === 'bottom') {
      const margin = Number(cfg.defaultDockMargin ?? 12);
      const bottomInset = Math.max(0, Number(cfg.dockBottomInset ?? 56));
      x = Number.isFinite(Number(cfg.defaultX))
        ? Number(cfg.defaultX)
        : Math.max(0, Math.floor((ds.w - width) / 2));
      y = Math.max(0, ds.h - height - margin - bottomInset);
    }

    x = Math.max(0, Math.min(x, Math.max(0, ds.w - width)));
    y = Math.max(0, Math.min(y, Math.max(0, ds.h - height)));

    win.el.style.left = x + 'px';
    win.el.style.top = y + 'px';
    win.el.style.width = width + 'px';
    win.el.style.height = height + 'px';
    _savePos(id, x, y, width, height);
    _focus(id);
  }

  function _getContextMenuRoot() {
    let root = document.getElementById('wm-context-menu-root');
    if (root) return root;
    const host = document.getElementById('context_menu_container') || document.body;
    if (!host) return null;
    root = document.createElement('div');
    root.id = 'wm-context-menu-root';
    root.className = 'wm-context-menu-root';
    host.appendChild(root);
    return root;
  }

  function _closeContextMenu() {
    const root = document.getElementById('wm-context-menu-root');
    if (root) root.innerHTML = '';
    if (_contextMenuState?.onPointerDown) {
      document.removeEventListener('mousedown', _contextMenuState.onPointerDown, true);
      document.removeEventListener('contextmenu', _contextMenuState.onPointerDown, true);
    }
    if (_contextMenuState?.onKey) {
      document.removeEventListener('keydown', _contextMenuState.onKey, true);
    }
    _contextMenuState = null;
  }

  function _positionContextMenu(menuEl, x, y) {
    if (!menuEl) return;
    const margin = 8;
    const width = Math.max(180, menuEl.offsetWidth || 220);
    const height = Math.max(40, menuEl.offsetHeight || 100);
    const maxX = Math.max(margin, (window.innerWidth || 1280) - width - margin);
    const maxY = Math.max(margin, (window.innerHeight || 720) - height - margin);
    menuEl.style.left = Math.max(margin, Math.min(Number(x || 0), maxX)) + 'px';
    menuEl.style.top = Math.max(margin, Math.min(Number(y || 0), maxY)) + 'px';
  }

  function contextMenu(items = [], opts = {}) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      _closeContextMenu();
      return;
    }

    const root = _getContextMenuRoot();
    if (!root) return;
    _closeContextMenu();

    const menu = document.createElement('section');
    menu.className = 'wm-context-menu';
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;

    if (opts.title) {
      const title = document.createElement('div');
      title.className = 'wm-context-menu-title';
      title.textContent = String(opts.title || 'Menu');
      menu.appendChild(title);
    }

    rows.forEach((item) => {
      if (!item || item.type === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'wm-context-menu-separator';
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-context-menu-item' + (item.danger ? ' is-danger' : '') + (item.checked ? ' is-checked' : '');
      btn.setAttribute('role', 'menuitem');
      btn.disabled = !!item.disabled;
      btn.innerHTML = `
        <span class="wm-context-menu-item-main">${_esc(String(item.label || 'Action'))}</span>
        ${item.meta ? `<span class="wm-context-menu-item-meta">${_esc(String(item.meta || ''))}</span>` : ''}`;
      btn.addEventListener('click', () => {
        _closeContextMenu();
        if (typeof item.onSelect === 'function' && !item.disabled) item.onSelect();
      });
      menu.appendChild(btn);
    });

    root.appendChild(menu);
    _positionContextMenu(menu, opts.x, opts.y);

    const onPointerDown = (ev) => {
      if (menu.contains(ev.target)) return;
      _closeContextMenu();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') _closeContextMenu();
    };

    _contextMenuState = { onPointerDown, onKey };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('contextmenu', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);

    requestAnimationFrame(() => {
      _positionContextMenu(menu, opts.x, opts.y);
      menu.focus();
    });
  }

  function _buildWindowContextMenuItems(id) {
    const win = _wins.get(id);
    if (!win) return [];
    const cfg = win.cfg || {};
    const items = [
      {
        label: win.minimized ? 'Wiederherstellen' : 'Fokussieren',
        onSelect: () => {
          if (win.minimized) _restore(id);
          else _focus(id);
        },
      },
      {
        label: 'Minimieren',
        disabled: win.minimized,
        onSelect: () => _minimize(id),
      },
    ];

    if (!cfg.fullscreenDesktop && _getDockConfig(cfg)) {
      items.push({ type: 'separator' });
      items.push({
        label: 'Links andocken',
        checked: win.el.dataset.wmDocked === 'left',
        onSelect: () => _applyDockPosition(win.el, cfg, 'left', true),
      });
      items.push({
        label: 'Rechts andocken',
        checked: win.el.dataset.wmDocked === 'right',
        onSelect: () => _applyDockPosition(win.el, cfg, 'right', true),
      });
      if (_getDockConfig(cfg)?.sides.includes('bottom')) {
        items.push({
          label: 'Unten andocken',
          checked: win.el.dataset.wmDocked === 'bottom',
          onSelect: () => _applyDockPosition(win.el, cfg, 'bottom', true),
        });
      }
      items.push({
        label: 'Position zuruecksetzen',
        onSelect: () => _resetWindowGeometry(id),
      });
    }

    items.push({ type: 'separator' });
    items.push({
      label: 'Schliessen',
      danger: true,
      onSelect: () => close(id),
    });
    return items;
  }

  // ── Internal: call the registered render callback ────────────────────────────
  function _callRender(id) {
    const cfg = _registry.get(id);
    if (cfg?.onRender) cfg.onRender(body(id));
  }

  function _getDockConfig(cfg = {}) {
    if (cfg.fullscreenDesktop || cfg.backgroundLayer) return null;

    const hasExplicitDockable = Object.prototype.hasOwnProperty.call(cfg, 'dockable');
    const dockable = hasExplicitDockable ? !!cfg.dockable : true;
    if (!dockable) return null;

    const sides = Array.isArray(cfg.dockableSides) && cfg.dockableSides.length
      ? cfg.dockableSides.map((side) => String(side || '').toLowerCase())
      : ['left', 'right'];
    return {
      sides,
      threshold: Math.max(18, Number(cfg.dockMagnetThreshold ?? 56)),
      margin: Math.max(0, Number(cfg.dockMargin ?? 12)),
      topInset: Math.max(0, Number(cfg.dockTopInset ?? 12)),
      bottomInset: Math.max(0, Number(cfg.dockBottomInset ?? 56)),
    };
  }

  function _setDockPreview(side) {
    const root = document.body || document.documentElement;
    if (!root) return;
    root.classList.remove('wm-dock-preview-left', 'wm-dock-preview-right', 'wm-dock-preview-bottom');
    if (side === 'left') root.classList.add('wm-dock-preview-left');
    if (side === 'right') root.classList.add('wm-dock-preview-right');
    if (side === 'bottom') root.classList.add('wm-dock-preview-bottom');
  }

  function _clearDockPreview() {
    _setDockPreview('');
  }

  function _setDockState(winEl, side) {
    if (!winEl) return;
    winEl.classList.remove('wm-docked', 'wm-docked-left', 'wm-docked-right', 'wm-docked-bottom');
    if (side === 'left' || side === 'right' || side === 'bottom') {
      winEl.classList.add('wm-docked');
      if (side === 'left') winEl.classList.add('wm-docked-left');
      if (side === 'right') winEl.classList.add('wm-docked-right');
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
        localStorage.removeItem(WM_DOCK_STORAGE_PREFIX + id);
      } else {
        localStorage.setItem(WM_DOCK_STORAGE_PREFIX + id, JSON.stringify({
          side: String(payload.side),
        }));
      }
    } catch (_) {}
  }

  function _loadDock(id) {
    try {
      const raw = localStorage.getItem(WM_DOCK_STORAGE_PREFIX + id);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || (parsed.side !== 'left' && parsed.side !== 'right' && parsed.side !== 'bottom')) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function _pickDockSide(cfg, cx, cy) {
    const dockCfg = _getDockConfig(cfg);
    if (!dockCfg) return null;
    const width = Math.max(320, window.innerWidth || document.documentElement?.clientWidth || 1280);
    const height = Math.max(240, window.innerHeight || document.documentElement?.clientHeight || 720);
    const nearLeft = cx <= dockCfg.threshold;
    const nearRight = cx >= (width - dockCfg.threshold);
    const nearBottom = cy >= (height - dockCfg.threshold);
    if (nearBottom && dockCfg.sides.includes('bottom')) return 'bottom';
    if (nearLeft && dockCfg.sides.includes('left')) return 'left';
    if (nearRight && dockCfg.sides.includes('right')) return 'right';
    return null;
  }

  function _applyDockPosition(winEl, cfg, side, persist = true) {
    if (!winEl || (side !== 'left' && side !== 'right' && side !== 'bottom')) return false;
    const dockCfg = _getDockConfig(cfg);
    if (!dockCfg) return false;
    if (!dockCfg.sides.includes(side)) return false;

    const desktop = _desktop();
    const ds = _desktopSize(desktop);
    const width = Math.max(200, winEl.offsetWidth || parseInt(winEl.style.width, 10) || Number(cfg?.w || 360));
    const height = Math.max(140, winEl.offsetHeight || parseInt(winEl.style.height, 10) || Number(cfg?.h || 320));

    let x = parseInt(winEl.style.left, 10);
    let y = parseInt(winEl.style.top, 10);

    if (side === 'left' || side === 'right') {
      x = side === 'left'
        ? dockCfg.margin
        : Math.max(dockCfg.margin, ds.w - width - dockCfg.margin);
      const fallbackTop = Number.isFinite(Number(cfg?.defaultY)) ? Number(cfg.defaultY) : dockCfg.topInset;
      const maxTop = Math.max(dockCfg.topInset, ds.h - height - dockCfg.margin - dockCfg.bottomInset);
      y = Math.min(
        maxTop,
        Math.max(dockCfg.topInset, Number.isFinite(y) ? y : fallbackTop),
      );
    } else if (side === 'bottom') {
      const fallbackLeft = Number.isFinite(Number(cfg?.defaultX))
        ? Number(cfg.defaultX)
        : Math.floor((ds.w - width) / 2);
      x = Math.min(
        Math.max(dockCfg.margin, Number.isFinite(x) ? x : fallbackLeft),
        Math.max(dockCfg.margin, ds.w - width - dockCfg.margin),
      );
      y = Math.max(dockCfg.topInset, ds.h - height - dockCfg.margin - dockCfg.bottomInset);
    }

    winEl.style.left = Math.max(0, x) + 'px';
    winEl.style.top = Math.max(0, y) + 'px';
    _setDockState(winEl, side);

    if (persist) {
      const id = String(winEl.dataset.winid || '');
      _saveDock(id, { side });
    }
    return true;
  }

  // ── Internal: drag-by-titlebar ───────────────────────────────────────────────
  function _makeDraggable(winEl) {
    const bar = winEl.querySelector('.wm-titlebar');
    if (!bar) return;
    let dragging = false, ox = 0, oy = 0;
    let dockCandidate = null;

    const getWindowConfig = () => {
      const id = String(winEl.dataset.winid || '');
      return _wins.get(id)?.cfg || _registry.get(id) || {};
    };

    const clearDockPersistence = () => {
      const id = String(winEl.dataset.winid || '');
      _saveDock(id, null);
      _setDockState(winEl, null);
    };

    bar.addEventListener('mousedown', e => {
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
    // Touch support
    bar.addEventListener('touchstart', e => {
      if (_isMobileMode()) return;
      if (e.target.closest('.wm-controls')) return;
      const t = e.touches[0];
      dragging = true;
      ox = t.clientX - winEl.offsetLeft;
      oy = t.clientY - winEl.offsetTop;
      dockCandidate = null;
      _clearDockPreview();
      _setDockState(winEl, null);
      e.preventDefault();
    }, { passive: false });

    const onMove = (cx, cy) => {
      if (!dragging) return;
      const desktop = _desktop();
      const ds = _desktopSize(desktop);
      let x = Math.max(0, Math.min(cx - ox, ds.w - winEl.offsetWidth));
      const y = Math.max(0, Math.min(cy - oy, ds.h - winEl.offsetHeight));

      const cfg = getWindowConfig();
      const side = _pickDockSide(cfg, cx, cy);
      dockCandidate = side;
      if (side) {
        _setDockPreview(side);
        const dockCfg = _getDockConfig(cfg);
        if (dockCfg) {
          if (side === 'left') {
            x = dockCfg.margin;
          } else if (side === 'right') {
            x = Math.max(0, ds.w - winEl.offsetWidth - dockCfg.margin);
          }
        }
      } else {
        _clearDockPreview();
      }

      winEl.style.left = x + 'px';
      winEl.style.top  = y + 'px';
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      _clearDockPreview();
      winEl.classList.remove('wm-dragging');
      const id = winEl.dataset.winid;

      const cfg = getWindowConfig();
      if (dockCandidate) {
        _applyDockPosition(winEl, cfg, dockCandidate, true);
      } else {
        clearDockPersistence();
      }

      _savePos(id, parseInt(winEl.style.left), parseInt(winEl.style.top),
               winEl.offsetWidth, winEl.offsetHeight);
      dockCandidate = null;
    };

    document.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    document.addEventListener('mouseup',   onEnd);
    document.addEventListener('touchmove', e => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: true });
    document.addEventListener('touchend',  onEnd);
  }

  // ── Internal: resize by SE corner handle ─────────────────────────────────────
  function _makeResizable(winEl) {
    const handle = winEl.querySelector('.wm-resize-handle');
    if (!handle) return;
    let resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;

    handle.addEventListener('mousedown', e => {
      if (_isMobileMode()) return;
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      sw = winEl.offsetWidth; sh = winEl.offsetHeight;
      winEl.classList.add('wm-resizing');
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const nw = Math.max(280, sw + (e.clientX - sx));
      const nh = Math.max(180, sh + (e.clientY - sy));
      winEl.style.width  = nw + 'px';
      winEl.style.height = nh + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      winEl.classList.remove('wm-resizing');
      const id = winEl.dataset.winid;
      _savePos(id, parseInt(winEl.style.left), parseInt(winEl.style.top),
               winEl.offsetWidth, winEl.offsetHeight);
    });
  }

  // ── Internal: taskbar button ─────────────────────────────────────────────────
  function _addTaskBtn(id, title) {
    const taskbar = document.getElementById('wm-taskbar');
    if (!taskbar) return;
    _ensureTaskbarSplitButton();
    const btn = document.createElement('button');
    btn.className = 'wm-task-btn';
    btn.id        = 'wm-task-' + id;
    btn.appendChild(new GQUI.Span().setClass('wm-task-label').setTextContent(title).dom);
    btn.addEventListener('click', () => {
      const win = _wins.get(id);
      if (!win) return;
      win.minimized ? _restore(id) : _minimize(id);
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenu(_buildWindowContextMenuItems(id), {
        x: e.clientX,
        y: e.clientY,
        title: title || id,
      });
    });
    // Insert before the spacer so task buttons stay left of the footer-actions
    const spacer = document.getElementById('wm-taskbar-spacer');
    if (spacer) taskbar.insertBefore(btn, spacer);
    else taskbar.appendChild(btn);
  }

  function _syncFullscreenWindows() {
    const desktop = _desktop();
    const ds = _desktopSize(desktop);
    _wins.forEach((win) => {
      if (!win.cfg?.fullscreenDesktop) return;
      win.el.style.left = '0px';
      win.el.style.top = '0px';
      win.el.style.width = ds.w + 'px';
      win.el.style.height = ds.h + 'px';
    });
  }

  // ── Internal: localStorage position persistence ───────────────────────────────
  function _savePos(id, x, y, w, h) {
    try {
      if ([x, y, w, h].some((value) => value == null || !Number.isFinite(Number(value)))) {
        localStorage.removeItem('gq_wpos_' + id);
        return;
      }
      localStorage.setItem('gq_wpos_' + id, JSON.stringify({ x, y, w, h }));
    } catch (_) {}
  }
  function _loadPos(id) {
    try { return JSON.parse(localStorage.getItem('gq_wpos_' + id)); } catch (_) { return null; }
  }

  // ── Internal: create a dedicated host section for each window ──────────────
  function _ensureWindowHost(id, desktop) {
    let host = document.getElementById('wm-host-' + id);
    if (host) return host;
    host = document.createElement('section');
    host.id = 'wm-host-' + id;
    host.className = 'wm-window-host';
    desktop.appendChild(host);
    return host;
  }

  // ── Internal: desktop element reference ─────────────────────────────────────
  function _desktop() {
    return document.body || document.documentElement;
  }

  function _desktopSize(desktop) {
    if (!desktop) return { w: window.innerWidth || 1280, h: window.innerHeight || 720 };
    if (desktop === document.body || desktop === document.documentElement) {
      return {
        w: Math.max(320, window.innerWidth || desktop.clientWidth || 1280),
        h: Math.max(220, window.innerHeight || desktop.clientHeight || 720),
      };
    }
    return {
      w: Math.max(320, desktop.offsetWidth || desktop.clientWidth || window.innerWidth || 1280),
      h: Math.max(220, desktop.offsetHeight || desktop.clientHeight || window.innerHeight || 720),
    };
  }

  // ── Internal: minimal HTML escaping ─────────────────────────────────────────
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _toWindowTitle(id) {
    const raw = String(id || '').trim();
    if (!raw) return 'Window';
    return raw
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  function _attrBool(el, name, fallback) {
    if (!(el instanceof HTMLElement)) return !!fallback;
    const raw = String(el.getAttribute(name) || '').trim().toLowerCase();
    if (!raw) return !!fallback;
    if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
    if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
    return !!fallback;
  }

  function _attrNum(el, name, fallback) {
    if (!(el instanceof HTMLElement)) return Number(fallback);
    const raw = String(el.getAttribute(name) || '').trim();
    if (!raw) return Number(fallback);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number(fallback);
  }

  function _autoHydratePrebuiltWindows() {
    if (_prebuiltHydrationDone) return;

    const run = () => {
      const nodes = Array.from(document.querySelectorAll('[data-wm-window]'));
      if (!nodes.length) return;

      nodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        const id = String(node.getAttribute('data-wm-window') || '').trim();
        if (!id) return;
        if (_wins.has(id)) return;

        const host = node.closest('.wm-window-host') || node.parentElement;
        const hostId = host instanceof HTMLElement && host.id ? host.id : '';
        const width = _attrNum(node, 'data-wm-width', 420);
        const height = _attrNum(node, 'data-wm-height', 360);
        const defaultY = _attrNum(node, 'data-wm-default-y', 12);
        const title = String(node.getAttribute('data-wm-title') || _toWindowTitle(id));
        const defaultDock = String(node.getAttribute('data-wm-default-dock') || '').trim().toLowerCase();
        const preserveOnClose = _attrBool(node, 'data-wm-preserve-on-close', true);
        const hideTaskButton = _attrBool(node, 'data-wm-hide-task-button', false);
        const persistState = _attrBool(node, 'data-wm-persist-state', false);

        const cfg = {
          title,
          adaptExisting: true,
          prebuiltSelector: `[data-wm-window="${id}"]`,
          preserveOnClose,
          hideTaskButton,
          persistState,
          defaultY,
          w: Number.isFinite(width) ? width : 420,
          h: Number.isFinite(height) ? height : 360,
        };
        if (defaultDock === 'left' || defaultDock === 'right') {
          cfg.defaultDock = defaultDock;
        }
        if (hostId) cfg.sectionId = hostId;

        try {
          adopt(id, cfg);
          if (_wins.has(id)) close(id);
        } catch (_) {
          // Best-effort only: explicit runtime registrations can still take over.
        }
      });

      _prebuiltHydrationDone = true;
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
      return;
    }
    run();
  }

  // ── Public: show a <section class="wm-modal"> as a card-paging dialog ───────
  /**
   * WM.modal(sectionId, opts?)
   *   sectionId  – id of the <section class="wm-modal"> element
   *   opts.title – optional title override
   *   opts.startCard – 0-based index of card to start on (default 0)
   *   opts.onClose   – callback when dialog is dismissed
   */
  function modal(sectionId, opts = {}) {
    const el = document.getElementById(sectionId);
    if (!el || !el.classList.contains('wm-modal')) return;
    _openModal(el, opts);
  }

  function _closeModal(el) {
    if (!(el instanceof HTMLElement)) return;
    const state = el.__wmModalState;
    el.hidden = true;
    el.classList.remove('wm-modal-open');
    if (state && typeof state.onKey === 'function') {
      document.removeEventListener('keydown', state.onKey);
    }
    const onClose = state && typeof state.onClose === 'function' ? state.onClose : null;
    if (state) {
      state.onClose = null;
      state.onKey = null;
    }
    if (onClose) onClose();
  }

  function _openModal(el, opts = {}) {
    // Title override
    const titleEl = el.querySelector('.wm-modal-title');
    if (titleEl && opts.title) titleEl.textContent = opts.title;

    // Collect cards: new generic marker first, legacy tooltip marker as fallback
    const cards = Array.from(el.querySelectorAll('[data-wm-card], [data-tooltip-card]'));
    let current = Number.isFinite(Number(opts.startCard)) ? Number(opts.startCard) : 0;
    current = Math.max(0, Math.min(current, Math.max(0, cards.length - 1)));

    const prevBtn = el.querySelector('[data-wm-modal-prev]') || el.querySelector('#tooltip-btn-prev');
    const nextBtn = el.querySelector('[data-wm-modal-next]') || el.querySelector('#tooltip-btn-next');
    const indicator = el.querySelector('[data-wm-modal-indicator]') || el.querySelector('.wm-modal-page-indicator');

    const state = el.__wmModalState || {};
    state.current = current;
    state.onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
    el.__wmModalState = state;

    function showCard(idx) {
      if (!cards.length) return;
      state.current = Math.max(0, Math.min(idx, cards.length - 1));
      cards.forEach((c, i) => { c.hidden = (i !== state.current); });
      if (prevBtn) prevBtn.disabled = state.current === 0;
      if (nextBtn) nextBtn.disabled = state.current === cards.length - 1;
      if (indicator) indicator.textContent = `${state.current + 1} / ${cards.length}`;
    }

    // Wire nav buttons (guard against duplicate binding)
    if (prevBtn && !prevBtn.__wmModalBound) {
      prevBtn.__wmModalBound = true;
      prevBtn.addEventListener('click', () => showCard((el.__wmModalState?.current ?? 0) - 1));
    }
    if (nextBtn && !nextBtn.__wmModalBound) {
      nextBtn.__wmModalBound = true;
      nextBtn.addEventListener('click', () => showCard((el.__wmModalState?.current ?? 0) + 1));
    }

    // Wire close targets (backdrop + close button)
    el.querySelectorAll('[data-wm-modal-close]').forEach((btn) => {
      if (!btn.__wmCloseBound) {
        btn.__wmCloseBound = true;
        btn.addEventListener('click', () => _closeModal(el));
      }
    });

    // Wire action targets (optional)
    el.querySelectorAll('[data-wm-modal-action]').forEach((btn) => {
      if (!btn.__wmActionBound) {
        btn.__wmActionBound = true;
        btn.addEventListener('click', () => {
          const action = String(btn.getAttribute('data-wm-modal-action') || 'action');
          const value = btn.getAttribute('data-wm-modal-value');
          window.dispatchEvent(new CustomEvent('wm:modal-action', {
            detail: { id: el.id, action, value },
          }));
          if (btn.hasAttribute('data-wm-modal-close')) _closeModal(el);
        });
      }
    });

    if (state.onKey) {
      document.removeEventListener('keydown', state.onKey);
    }
    state.onKey = function onKey(e) {
      if (!el.classList.contains('wm-modal-open')) return;
      if (e.key === 'Escape') _closeModal(el);
      if (e.key === 'ArrowLeft') showCard((el.__wmModalState?.current ?? 0) - 1);
      if (e.key === 'ArrowRight') showCard((el.__wmModalState?.current ?? 0) + 1);
    };
    document.addEventListener('keydown', state.onKey);

    // Show at requested card
    if (cards.length) showCard(current);
    el.hidden = false;
    el.classList.add('wm-modal-open');

    // Focus first focusable element inside dialog
    requestAnimationFrame(() => {
      const focusable = el.querySelector('.wm-modal-dialog button, .wm-modal-dialog input, .wm-modal-dialog select, .wm-modal-dialog textarea');
      focusable?.focus();
    });
  }

  _autoHydratePrebuiltWindows();

  return { register, adopt, open, close, refresh, body, isOpen, setTitle, modal, contextMenu, closeContextMenu: _closeContextMenu };
})();

if (typeof window !== 'undefined') {
  window.WM = WM;
}
