/**
 * GalaxyQuest – Window Manager (WM)
 *
 * Provides a desktop-style floating window system.
 * No dependencies – pure vanilla JS and CSS.
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

  const WM_MOBILE_BREAKPOINT = 800;

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
    overview:    { title: '🌍 Overview',       w: 860, h: 540 },
    buildings:   { title: '🏗 Buildings',      w: 680, h: 540 },
    research:    { title: '🔬 Research',       w: 680, h: 540 },
    shipyard:    { title: '🚀 Shipyard',       w: 740, h: 540 },
    fleet:       { title: '⚡ Fleet',          w: 640, h: 640 },
    galaxy:      { title: '🌌 Galaxy Map',     w: 860, h: 540 },
    messages:    { title: '✉ Messages',        w: 640, h: 520 },
    quests:      { title: '📋 Quests',         w: 860, h: 620 },
    leaderboard: { title: '🏆 Leaderboard',    w: 540, h: 480 },
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
    if (!cfg.hideTaskButton) _addTaskBtn(id, cfg.title);
    if (cfg.backgroundLayer) {
      el.style.zIndex = '1';
    } else {
      _focus(id);
    }
    _callRender(id);
  }

  // ── Public: close a window ──────────────────────────────────────────────────
  function close(id) {
    if (!_wins.has(id)) return;
    const win = _wins.get(id);
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
    el.classList.add('wm-window', 'wm-window-adapted');
    if (cfg.fullscreenDesktop) el.classList.add('wm-window-fullscreen');
    if (cfg.backgroundLayer) el.classList.add('wm-window-background');
    if (!el.id) el.id = 'wm-win-' + id;
    el.setAttribute('data-winid', id);

    let body = el.querySelector(':scope > .wm-body');
    const titlebar = el.querySelector(':scope > .wm-titlebar');
    const resizeHandle = el.querySelector(':scope > .wm-resize-handle');

    if (!cfg.fullscreenDesktop && !titlebar) {
      const head = document.createElement('div');
      head.className = 'wm-titlebar';
      head.innerHTML = `
        <span class="wm-title">${_esc(cfg.title || id)}</span>
        <div class="wm-controls">
          <button class="wm-btn wm-btn-min" title="Minimise">&#8211;</button>
          <button class="wm-btn wm-btn-close" title="Close">&#x2715;</button>
        </div>`;
      el.insertBefore(head, el.firstChild);
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
    const titlebar = cfg.fullscreenDesktop ? '' : `
      <div class="wm-titlebar">
        <span class="wm-title">${_esc(cfg.title)}</span>
        <div class="wm-controls">
          <button class="wm-btn wm-btn-min"   title="Minimise">&#8211;</button>
          <button class="wm-btn wm-btn-close" title="Close">&#x2715;</button>
        </div>
      </div>`;
    const resizeHandle = cfg.fullscreenDesktop ? '' : '<div class="wm-resize-handle" title="Resize"></div>';
    el.innerHTML = `${titlebar}
      <div class="wm-body"></div>
      ${resizeHandle}`;

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
    win.minimized = true;
    win.el.classList.add('wm-minimized');
    document.getElementById('wm-task-' + id)?.classList.remove('wm-task-active');
  }

  // ── Internal: restore from minimised ────────────────────────────────────────
  function _restore(id) {
    const win = _wins.get(id);
    if (!win || !win.minimized) return;
    win.minimized = false;
    win.el.classList.remove('wm-minimized');
    _focus(id);
  }

  // ── Internal: call the registered render callback ────────────────────────────
  function _callRender(id) {
    const cfg = _registry.get(id);
    if (cfg?.onRender) cfg.onRender(body(id));
  }

  // ── Internal: drag-by-titlebar ───────────────────────────────────────────────
  function _makeDraggable(winEl) {
    const bar = winEl.querySelector('.wm-titlebar');
    if (!bar) return;
    let dragging = false, ox = 0, oy = 0;

    bar.addEventListener('mousedown', e => {
      if (_isMobileMode()) return;
      if (e.target.closest('.wm-controls')) return;
      dragging = true;
      ox = e.clientX - winEl.offsetLeft;
      oy = e.clientY - winEl.offsetTop;
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
      e.preventDefault();
    }, { passive: false });

    const onMove = (cx, cy) => {
      if (!dragging) return;
      const desktop = _desktop();
      const ds = _desktopSize(desktop);
      const x = Math.max(0, Math.min(cx - ox, ds.w - winEl.offsetWidth));
      const y = Math.max(0, Math.min(cy - oy, ds.h - winEl.offsetHeight));
      winEl.style.left = x + 'px';
      winEl.style.top  = y + 'px';
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      winEl.classList.remove('wm-dragging');
      const id = winEl.dataset.winid;
      _savePos(id, parseInt(winEl.style.left), parseInt(winEl.style.top),
               winEl.offsetWidth, winEl.offsetHeight);
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
    const btn = document.createElement('button');
    btn.className = 'wm-task-btn';
    btn.id        = 'wm-task-' + id;
    btn.innerHTML = `<span class="wm-task-label">${_esc(title)}</span>`;
    btn.addEventListener('click', () => {
      const win = _wins.get(id);
      if (!win) return;
      win.minimized ? _restore(id) : _minimize(id);
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
    try { localStorage.setItem('gq_wpos_' + id, JSON.stringify({ x, y, w, h })); } catch (_) {}
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

  return { register, adopt, open, close, refresh, body, isOpen, setTitle, modal };
})();

if (typeof window !== 'undefined') {
  window.WM = WM;
}
