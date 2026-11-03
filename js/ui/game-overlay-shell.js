const managementWindows = ['buildings', 'research', 'economy', 'population', 'fleets', 'shipyard', 'trade'];

export function mountGameOverlayShell({ wm = window.WM } = {}) {
  const topbar = document.getElementById('topbar-section');
  const resources = document.getElementById('resource-section');
  const audio = document.getElementById('topbar-player');
  if (!topbar || !resources || !audio) throw new Error('Die Spiel-Overlays fehlen.');
  const taskbar = document.getElementById('taskbar-section');
  const placements = [topbar, resources, audio, ...(taskbar ? [taskbar] : [])].map((element) => {
    const placeholder = document.createComment('game-overlay-position');
    element.before(placeholder);
    return { element, placeholder };
  });
  const root = document.createElement('section');
  root.id = 'game-overlay-shell';
  root.setAttribute('aria-label', 'Spielsteuerung');
  const dock = document.createElement('nav');
  dock.className = 'game-overlay-dock';
  dock.setAttribute('aria-label', 'Schnellzugriff');
  const toggle = document.createElement('button');
  toggle.id = 'game-command-toggle';
  toggle.type = 'button';
  toggle.className = 'btn btn-secondary btn-sm';
  toggle.textContent = 'Kommando';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'game-command-overlay');
  const field = document.createElement('button');
  field.id = 'game-field-toggle';
  field.type = 'button';
  field.className = 'btn btn-secondary btn-sm';
  field.hidden = true;
  const hiddenWindows = new Map();
  function visibleWindows() {
    return managementWindows.filter((id) => wm?.isOpen(id) && !wm.isMinimized(id));
  }
  function syncWindows(event) {
    if (event?.detail?.action === 'close') hiddenWindows.delete(event.detail.id);
    for (const id of hiddenWindows.keys()) {
      if (!wm?.isOpen(id) || !wm.isMinimized(id)) hiddenWindows.delete(id);
    }
    const visible = visibleWindows();
    field.hidden = !visible.length && !hiddenWindows.size;
    field.textContent = visible.length ? 'Spielfeld' : `Fenster (${hiddenWindows.size})`;
    const description = visible.length ? 'Verwaltungsfenster ausblenden' : 'Ausgeblendete Verwaltungsfenster wiederherstellen';
    field.setAttribute('aria-label', description);
    field.title = description;
  }
  const drawer = document.createElement('section');
  drawer.id = 'game-command-overlay';
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Kommandomenü');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-secondary btn-sm';
  close.textContent = 'Schließen';
  close.setAttribute('aria-label', 'Kommandomenü schließen');
  drawer.append(close, topbar, resources);
  if (taskbar) drawer.append(taskbar);
  dock.append(toggle, field, audio);
  root.append(dock, drawer);
  document.body.append(root);
  document.body.classList.add('game-overlay-layout');
  const listeners = new AbortController();
  function syncLayer() {
    const windowLayers = Array.from(document.querySelectorAll('.wm-window'), (element) =>
      Number.parseInt(window.getComputedStyle(element).zIndex, 10) || 0);
    root.style.zIndex = String(Math.max(150, ...windowLayers) + 1);
  }
  window.addEventListener('wm:focus-changed', syncLayer, { signal: listeners.signal });
  window.addEventListener('wm:window-state-changed', syncWindows, { signal: listeners.signal });
  syncLayer();
  syncWindows();
  function setOpen(open, restoreFocus = false) {
    if (open) syncLayer();
    drawer.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) close.focus();
    else if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(drawer.hidden), { signal: listeners.signal });
  field.addEventListener('click', () => {
    setOpen(false);
    const visible = visibleWindows();
    if (visible.length) {
      for (const id of visible) {
        const element = document.getElementById(`wm-win-${id}`);
        const layer = element ? Number.parseInt(window.getComputedStyle(element).zIndex, 10) || 0 : 0;
        hiddenWindows.set(id, layer);
        wm.minimize(id);
      }
    } else {
      const restore = [...hiddenWindows].sort((a, b) => a[1] - b[1]);
      hiddenWindows.clear();
      for (const [id] of restore) {
        if (wm.isOpen(id) && wm.isMinimized(id)) wm.restore(id);
      }
    }
    syncWindows();
    if (field.hidden) toggle.focus();
    else field.focus();
  }, { signal: listeners.signal });
  close.addEventListener('click', () => setOpen(false, true), { signal: listeners.signal });
  root.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-game-development], [data-game-economy], [data-game-fleets], [data-game-fleet-launch], [data-game-shipyard], [data-game-market], [data-game-population], [data-resource], .wm-task-btn')) setOpen(false);
  }, { signal: listeners.signal });
  root.addEventListener('change', (event) => {
    if (event.target.id === 'game-colony-select' && document.getElementById('game-fleet-command')?.hidden === false) {
      setOpen(false);
    }
  }, { signal: listeners.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !drawer.hidden) {
      setOpen(false, true);
    }
  }, { signal: listeners.signal });
  document.addEventListener('pointerdown', (event) => {
    if (!drawer.hidden && !root.contains(event.target)) setOpen(false);
  }, { signal: listeners.signal });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    for (const { element, placeholder } of placements.reverse()) {
      placeholder.replaceWith(element);
    }
    root.remove();
    document.body.classList.remove('game-overlay-layout');
  };
}
