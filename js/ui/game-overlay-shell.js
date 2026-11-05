const windowGroups = [
  ['Kolonie', [
    ['buildings', 'Gebäude'],
    ['research', 'Forschung'],
    ['population', 'Bevölkerung'],
    ['shipyard', 'Werft'],
  ]],
  ['Galaxie', [
    ['fleet', 'Flotten'],
  ]],
  ['Wirtschaft', [
    ['economy', 'Wirtschaft'],
    ['trade', 'Markt'],
  ]],
];
const managementWindows = windowGroups.flatMap(([, windows]) => windows);

export function mountGameOverlayShell({ wm = window.WM } = {}) {
  const topbar = document.getElementById('topbar-section');
  const resources = document.getElementById('resource-section');
  const audio = document.getElementById('topbar-player');
  if (!topbar || !resources || !audio) throw new Error('Die Spiel-Overlays fehlen.');
  const gameActions = resources.querySelector('.game-development-actions');
  const gameActionsPlaceholder = gameActions ? document.createComment('game-overlay-actions-position') : null;
  if (gameActions && gameActionsPlaceholder) gameActions.before(gameActionsPlaceholder);
  const taskbar = document.getElementById('taskbar-section');
  const placements = [topbar, resources, audio, ...(taskbar ? [taskbar] : [])].map((element) => {
    const placeholder = document.createComment('game-overlay-position');
    element.before(placeholder);
    return { element, placeholder };
  });
  const root = document.createElement('section');
  root.id = 'game-overlay-shell';
  root.setAttribute('aria-label', 'Spielsteuerung');
  const dockbars = document.createElement('div');
  dockbars.id = 'game-overlay-dockbars';
  dockbars.className = 'game-overlay-dockbars';
  dockbars.setAttribute('aria-hidden', 'true');
  for (const [side, label] of [
    ['top', 'Obere Leiste'],
    ['bottom', 'Untere Leiste'],
    ['left', 'Linke Leiste'],
    ['right', 'Rechte Leiste'],
  ]) {
    const bar = document.createElement('div');
    bar.className = 'game-overlay-dockbar';
    bar.dataset.dockSide = side;
    bar.textContent = `${label} · Fenster hier ablegen`;
    dockbars.append(bar);
  }
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
  const resourceMenu = document.createElement('details');
  resourceMenu.className = 'game-overlay-resource-menu';
  const resourceSummary = document.createElement('summary');
  resourceSummary.textContent = 'Ressourcen';
  resourceMenu.append(resourceSummary, resources);
  const hiddenWindows = new Map();
  const windowPicker = document.createElement('section');
  windowPicker.id = 'game-window-picker';
  windowPicker.setAttribute('aria-label', 'Spiel-Fenster einblenden');
  const windowPickerTitle = document.createElement('strong');
  windowPickerTitle.textContent = 'Fenster einblenden';
  const windowButtons = new Map();
  for (const [groupName, windows] of windowGroups) {
    const group = document.createElement('section');
    group.className = 'game-window-picker-group';
    const heading = document.createElement('strong');
    heading.textContent = groupName;
    const buttons = document.createElement('div');
    buttons.className = 'game-window-picker-buttons';
    for (const [id, label] of windows) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'btn btn-secondary btn-sm';
      control.dataset.windowId = id;
      control.textContent = label;
      control.setAttribute('aria-pressed', 'false');
      control.addEventListener('click', () => {
        if (!wm) return;
        if (wm.isOpen(id) && !wm.isMinimized(id)) {
          wm.minimize(id);
          syncWindows();
          setOpen(false, true);
          return;
        }
        wm.open(id);
        syncWindows();
        if (!wm.isOpen(id) || wm.isMinimized(id)) return;
        setOpen(false);
        const title = document.getElementById(`wm-win-${id}`)?.querySelector('.wm-title');
        if (title) {
          title.tabIndex = -1;
          title.focus({ preventScroll: true });
        } else {
          toggle.focus();
        }
      });
      windowButtons.set(id, control);
      buttons.append(control);
    }
    group.append(heading, buttons);
    windowPicker.append(group);
  }
  windowPicker.prepend(windowPickerTitle);
  const layoutActions = document.createElement('section');
  layoutActions.className = 'game-window-layout-actions';
  layoutActions.setAttribute('aria-label', 'Fensterlayout');
  const layoutStatus = document.createElement('p');
  layoutStatus.className = 'game-window-layout-status';
  layoutStatus.setAttribute('role', 'status');
  layoutStatus.setAttribute('aria-live', 'polite');
  const saveLayout = document.createElement('button');
  saveLayout.type = 'button';
  saveLayout.className = 'btn btn-secondary btn-sm';
  saveLayout.textContent = 'Standardlayout speichern';
  saveLayout.disabled = typeof wm?.saveLayoutProfile !== 'function';
  saveLayout.addEventListener('click', () => {
    const saved = wm?.saveLayoutProfile?.('quick', { scope: 'global' }) === true;
    layoutStatus.textContent = saved
      ? 'Aktuelles Fensterlayout als Standard gespeichert.'
      : 'Das Fensterlayout konnte nicht gespeichert werden.';
  });
  const loadLayout = document.createElement('button');
  loadLayout.type = 'button';
  loadLayout.className = 'btn btn-secondary btn-sm';
  loadLayout.textContent = 'Standardlayout laden';
  loadLayout.disabled = typeof wm?.loadLayoutProfile !== 'function';
  loadLayout.addEventListener('click', () => {
    const loaded = wm?.loadLayoutProfile?.('quick', { scope: 'global' }) === true;
    layoutStatus.textContent = loaded
      ? 'Gespeichertes Standardlayout geladen.'
      : 'Es wurde noch kein Standardlayout gespeichert.';
  });
  layoutActions.append(saveLayout, loadLayout, layoutStatus);
  windowPicker.append(layoutActions);
  function visibleWindows() {
    return managementWindows.map(([id]) => id).filter((id) => wm?.isOpen(id) && !wm.isMinimized(id));
  }
  function syncWindows(event) {
    if (event?.detail?.action === 'close') hiddenWindows.delete(event.detail.id);
    for (const id of hiddenWindows.keys()) {
      if (!wm?.isOpen(id) || !wm.isMinimized(id)) hiddenWindows.delete(id);
    }
    for (const [id, control] of windowButtons) {
      const active = !!wm?.isOpen(id) && !wm.isMinimized(id);
      control.setAttribute('aria-pressed', String(active));
      control.classList.toggle('is-active', active);
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
  drawer.append(close, windowPicker, topbar);
  if (gameActions) drawer.append(gameActions);
  if (taskbar) drawer.append(taskbar);
  dock.append(toggle, field, resourceMenu, audio);
  root.append(dockbars, dock, drawer);
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
    const task = event.target.closest?.('.wm-task-btn');
    if (task) {
      if (event.ctrlKey || event.metaKey) return;
      setOpen(false);
      const id = task.id.slice('wm-task-'.length);
      const title = document.getElementById(`wm-win-${id}`)?.querySelector('.wm-title');
      if (wm?.isOpen(id) && !wm.isMinimized(id) && title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
      } else {
        toggle.focus();
      }
      return;
    }
    if (event.target.closest?.('[data-game-development], [data-game-economy], [data-game-fleets], [data-game-fleet-launch], [data-game-shipyard], [data-game-market], [data-game-population], [data-resource]')) {
      resourceMenu.open = false;
      setOpen(false);
    }
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
    if (gameActions && gameActionsPlaceholder) gameActionsPlaceholder.replaceWith(gameActions);
    for (const { element, placeholder } of placements.reverse()) {
      placeholder.replaceWith(element);
    }
    root.remove();
    document.body.classList.remove('game-overlay-layout');
  };
}
