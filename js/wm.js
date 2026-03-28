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
 */
const WM = (() => {
  // ── Registry ────────────────────────────────────────────────────────────────
  /** @type {Map<string, {el:HTMLElement, cfg:object, minimized:boolean}>} */
  const _wins = new Map();
  /** @type {Map<string, object>} */
  const _registry = new Map();

  let _topZ = 100;
  // Cascade offset for newly opened windows
  let _nextX = 60;
  let _nextY = 60;

  window.addEventListener('resize', () => _syncFullscreenWindows());

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

  // ── Public: open or focus a window ──────────────────────────────────────────
  function open(id) {
    if (_wins.has(id)) {
      const win = _wins.get(id);
      if (win.minimized) _restore(id);
      else               _focus(id);
      _callRender(id);
      return;
    }

    const cfg = _registry.get(id) || DEFAULTS[id] || { title: id, w: 600, h: 400 };
    const el  = _buildEl(id, cfg);
    const desktop = _desktop();

    if (cfg.fullscreenDesktop) {
      el.style.left   = '0px';
      el.style.top    = '0px';
      el.style.width  = desktop.offsetWidth + 'px';
      el.style.height = desktop.offsetHeight + 'px';
    } else {
      // Position: restore saved or use cascaded default
      const saved = _loadPos(id);
      let x = saved ? saved.x : _nextX;
      let y = saved ? saved.y : _nextY;

      if (!saved) {
        if (cfg.defaultDock === 'right') {
          const margin = Number(cfg.defaultDockMargin ?? 12);
          const dockY = Number(cfg.defaultY ?? 12);
          x = Math.max(0, desktop.offsetWidth - (cfg.w ?? 600) - margin);
          y = Math.max(0, dockY);
        } else {
          if (Number.isFinite(Number(cfg.defaultX))) x = Number(cfg.defaultX);
          if (Number.isFinite(Number(cfg.defaultY))) y = Number(cfg.defaultY);
        }
      }

      if (!saved) {
        _nextX = (_nextX + 32) % Math.max(100, desktop.offsetWidth  - cfg.w  - 60);
        _nextY = (_nextY + 32) % Math.max(100, desktop.offsetHeight - cfg.h  - 60);
      }

      // Clamp to desktop
      x = Math.max(0, Math.min(x, Math.max(0, desktop.offsetWidth  - cfg.w)));
      y = Math.max(0, Math.min(y, Math.max(0, desktop.offsetHeight - cfg.h)));

      el.style.left   = x + 'px';
      el.style.top    = y + 'px';
      el.style.width  = (saved?.w ?? cfg.w) + 'px';
      el.style.height = (saved?.h ?? cfg.h) + 'px';
    }

    desktop.appendChild(el);
    _wins.set(id, { el, cfg, minimized: false });
    if (!cfg.hideTaskButton) _addTaskBtn(id, cfg.title);
    _focus(id);
    _callRender(id);
  }

  // ── Public: close a window ──────────────────────────────────────────────────
  function close(id) {
    if (!_wins.has(id)) return;
    _wins.get(id).el.remove();
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

  // ── Internal: build window DOM element ──────────────────────────────────────
  function _buildEl(id, cfg) {
    const el = document.createElement('div');
    el.className = 'wm-window' + (cfg.fullscreenDesktop ? ' wm-window-fullscreen' : '');
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

    // Title-bar click → focus
    el.addEventListener('mousedown', () => _focus(id), true);

    // Buttons
    const minBtn = el.querySelector('.wm-btn-min');
    const closeBtn = el.querySelector('.wm-btn-close');
    if (minBtn) minBtn.addEventListener('click', e => { e.stopPropagation(); _minimize(id); });
    if (closeBtn) closeBtn.addEventListener('click', e => { e.stopPropagation(); close(id); });

    if (!cfg.fullscreenDesktop) {
      // Drag
      _makeDraggable(el);
      // Resize
      _makeResizable(el);
    }

    return el;
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
      if (e.target.closest('.wm-controls')) return;
      dragging = true;
      ox = e.clientX - winEl.offsetLeft;
      oy = e.clientY - winEl.offsetTop;
      winEl.classList.add('wm-dragging');
      e.preventDefault();
    });
    // Touch support
    bar.addEventListener('touchstart', e => {
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
      const x = Math.max(0, Math.min(cx - ox, desktop.offsetWidth  - winEl.offsetWidth));
      const y = Math.max(0, Math.min(cy - oy, desktop.offsetHeight - winEl.offsetHeight));
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
    _wins.forEach((win) => {
      if (!win.cfg?.fullscreenDesktop) return;
      win.el.style.left = '0px';
      win.el.style.top = '0px';
      win.el.style.width = desktop.offsetWidth + 'px';
      win.el.style.height = desktop.offsetHeight + 'px';
    });
  }

  // ── Internal: localStorage position persistence ───────────────────────────────
  function _savePos(id, x, y, w, h) {
    try { localStorage.setItem('gq_wpos_' + id, JSON.stringify({ x, y, w, h })); } catch (_) {}
  }
  function _loadPos(id) {
    try { return JSON.parse(localStorage.getItem('gq_wpos_' + id)); } catch (_) { return null; }
  }

  // ── Internal: desktop element reference ─────────────────────────────────────
  function _desktop() { return document.getElementById('wm-desktop'); }

  // ── Internal: minimal HTML escaping ─────────────────────────────────────────
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { register, open, close, refresh, body, isOpen, setTitle };
})();

if (typeof window !== 'undefined') {
  window.WM = WM;
}
