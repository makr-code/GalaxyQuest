import { mountEmpireOutliner } from './game-empire-outliner.js';
import { createGameIcon, decorateGameAction } from './game-ui-visuals.js';

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

export function mountGameOverlayShell({ wm = window.WM, session = null, galaxy = null } = {}) {
  const topbar = document.getElementById('topbar-section');
  const resources = document.getElementById('resource-section');
  const audio = document.getElementById('topbar-player');
  if (!topbar || !resources || !audio) throw new Error('Die Spiel-Overlays fehlen.');
  const gameActions = resources.querySelector('.game-development-actions');
  const gameActionsPlaceholder = gameActions ? document.createComment('game-overlay-actions-position') : null;
  if (gameActions && gameActionsPlaceholder) gameActions.before(gameActionsPlaceholder);
  const taskbar = document.getElementById('taskbar-section');
  const dataStatus = resources.querySelector('#game-data-status');
  const placements = [topbar, resources, audio, ...(taskbar ? [taskbar] : []), ...(dataStatus ? [dataStatus] : [])].map((element) => {
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
  const toggleLabel = document.createElement('span');
  toggleLabel.textContent = 'Kommando';
  const dataBadge = document.createElement('span');
  dataBadge.className = 'game-command-data-badge';
  dataBadge.hidden = true;
  toggle.append(createGameIcon('economy'), toggleLabel, dataBadge);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'game-command-overlay');
  const field = document.createElement('button');
  field.id = 'game-field-toggle';
  field.type = 'button';
  field.className = 'btn btn-secondary btn-sm';
  field.hidden = true;
  const fieldLabel = document.createElement('span');
  field.append(createGameIcon('locate'), fieldLabel);
  const resourceMenu = document.createElement('details');
  resourceMenu.className = 'game-overlay-resource-menu';
  const resourceSummary = document.createElement('summary');
  resourceSummary.append(createGameIcon('goods'), document.createElement('span'));
  resourceSummary.querySelector('span').textContent = 'Ressourcen';
  resourceMenu.append(resourceSummary, resources);
  const resourceContext = document.createElement('header');
  resourceContext.className = 'game-resource-context';
  const resourceColony = document.createElement('strong');
  const resourceCoordinates = document.createElement('span');
  resourceContext.append(createGameIcon('planet'), resourceColony, resourceCoordinates);
  resourceContext.hidden = !session;
  resources.prepend(resourceContext);
  const resourceToolbar = document.createElement('div');
  resourceToolbar.className = 'game-resource-toolbar';
  const resourceTitle = document.createElement('strong');
  resourceTitle.textContent = 'Ressourcen';
  const resourceClose = document.createElement('button');
  resourceClose.type = 'button';
  resourceClose.className = 'btn btn-secondary btn-sm';
  resourceClose.textContent = 'Schließen';
  resourceClose.setAttribute('aria-label', 'Ressourcenmenü schließen');
  resourceToolbar.append(resourceTitle, resourceClose);
  resources.prepend(resourceToolbar);
  function syncResourceContext() {
    if (!session) return;
    const colony = session.getColony();
    resourceColony.textContent = colony ? colony.name : 'Keine aktive Kolonie';
    resourceCoordinates.textContent = colony
      ? `[${colony.galaxy}:${colony.system}:${colony.position}]`
      : 'Kolonie im Kommandomenü auswählen.';
  }
  const unsubscribeResourceContext = session?.events.on('overview:updated', syncResourceContext);
  syncResourceContext();
  const hiddenWindows = new Map();
  const windowPicker = document.createElement('section');
  windowPicker.id = 'game-window-picker';
  windowPicker.setAttribute('aria-label', 'Spiel-Fenster einblenden');
  const windowPickerTitle = document.createElement('strong');
  windowPickerTitle.textContent = 'Fenster einblenden';
  const windowPickerDescription = document.createElement('p');
  windowPickerDescription.className = 'game-window-picker-description';
  windowPickerDescription.textContent = 'Fenster öffnen, fokussieren oder wiederherstellen. Ausblenden über „Spielfeld“ oder die Fenstertitelleiste.';
  const windowStatus = document.createElement('p');
  windowStatus.className = 'game-window-picker-status';
  windowStatus.setAttribute('role', 'status');
  const windowButtons = new Map();
  const windowGroupCounts = [];
  for (const [groupName, windows] of windowGroups) {
    const group = document.createElement('section');
    group.className = 'game-window-picker-group';
    group.setAttribute('aria-label', `${groupName}-Fenster`);
    const heading = document.createElement('strong');
    heading.textContent = groupName;
    const count = document.createElement('span');
    count.className = 'game-window-picker-count';
    count.setAttribute('aria-label', `Geöffnete ${groupName}-Fenster`);
    windowGroupCounts.push({ id: groupName, windows, count });
    const buttons = document.createElement('div');
    buttons.className = 'game-window-picker-buttons';
    for (const [id, label] of windows) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'btn btn-secondary btn-sm';
      control.dataset.windowId = id;
      decorateGameAction(control, id, label);
      control.title = `${label} öffnen oder fokussieren`;
      control.setAttribute('aria-pressed', 'false');
      control.addEventListener('click', () => {
        if (!wm) {
          windowStatus.textContent = `${label} ist derzeit nicht verfügbar.`;
          return;
        }
        wm.open(id);
        syncWindows();
        if (!wm.isOpen(id) || wm.isMinimized(id)) {
          windowStatus.textContent = `${label} konnte nicht geöffnet werden.`;
          return;
        }
        windowStatus.textContent = '';
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
    group.append(heading, count, buttons);
    windowPicker.append(group);
  }
  windowPicker.prepend(windowPickerTitle, windowPickerDescription, windowStatus);
  const layoutMenu = document.createElement('details');
  layoutMenu.className = 'game-window-layout-menu';
  const layoutSummary = document.createElement('summary');
  layoutSummary.textContent = 'Fensterlayout';
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
  layoutMenu.append(layoutSummary, layoutActions);
  windowPicker.append(layoutMenu);
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
    for (const group of windowGroupCounts) {
      const active = group.windows.filter(([id]) => wm?.isOpen(id) && !wm.isMinimized(id)).length;
      group.count.textContent = `${active}/${group.windows.length}`;
    }
    const visible = visibleWindows();
    field.hidden = !visible.length && !hiddenWindows.size;
    fieldLabel.textContent = visible.length ? 'Spielfeld' : `Fenster (${hiddenWindows.size})`;
    field.replaceChildren(createGameIcon(visible.length ? 'close' : 'locate'), fieldLabel);
    const description = visible.length ? 'Verwaltungsfenster ausblenden' : 'Ausgeblendete Verwaltungsfenster wiederherstellen';
    field.setAttribute('aria-label', `${description} · ${visible.length ? visible.length : hiddenWindows.size}`);
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
  const commandToolbar = document.createElement('header');
  commandToolbar.className = 'game-command-toolbar';
  const commandTitle = document.createElement('strong');
  commandTitle.textContent = 'Kommando';
  commandToolbar.append(commandTitle, close);
  drawer.append(commandToolbar, topbar);
  if (dataStatus) drawer.append(dataStatus);
  drawer.append(windowPicker);
  if (gameActions) drawer.append(gameActions);
  if (taskbar) drawer.append(taskbar);
  dock.append(toggle, field, resourceMenu, audio);
  root.append(dockbars, dock, drawer);
  document.body.append(root);
  const unmountOutliner = session && galaxy ? mountEmpireOutliner({
    host: root, session, galaxy, wm, windows: managementWindows.filter(([id]) => id !== 'fleet'),
  }) : null;
  document.body.classList.add('game-overlay-layout');
  const listeners = new AbortController();
  function syncDataStatus() {
    const state = dataStatus?.dataset.state;
    const message = dataStatus?.textContent.trim();
    const caption = state === 'error' ? 'Datenfehler' : state === 'loading' ? 'Lädt' : state === 'empty' ? 'Keine Kolonie' : '';
    const visible = !!caption && !!message;
    dataBadge.hidden = !visible;
    dataBadge.textContent = visible ? caption : '';
    if (visible) {
      toggle.dataset.dataState = state;
      toggle.setAttribute('aria-describedby', dataStatus.id);
      toggle.title = message;
    } else {
      delete toggle.dataset.dataState;
      toggle.removeAttribute('aria-describedby');
      toggle.removeAttribute('title');
    }
  }
  const statusObserver = dataStatus ? new MutationObserver(syncDataStatus) : null;
  statusObserver?.observe(dataStatus, { attributes: true, attributeFilter: ['data-state'], childList: true, characterData: true, subtree: true });
  syncDataStatus();
  function syncMenuPosition() {
    root.style.setProperty('--game-overlay-menu-top', `${dock.getBoundingClientRect().bottom + 8}px`);
  }
  const dockObserver = new ResizeObserver(syncMenuPosition);
  dockObserver.observe(dock);
  window.addEventListener('resize', syncMenuPosition, { signal: listeners.signal });
  syncMenuPosition();
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
    if (open) {
      resourceMenu.open = false;
      syncMenuPosition();
      syncLayer();
    }
    drawer.hidden = !open;
    const outliner = root.querySelector('#game-empire-outliner');
    if (outliner) outliner.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) close.focus();
    else if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(drawer.hidden), { signal: listeners.signal });
  resourceClose.addEventListener('click', () => {
    resourceMenu.open = false;
    resourceSummary.focus({ preventScroll: true });
  }, { signal: listeners.signal });
  resourceSummary.addEventListener('click', () => {
    if (!resourceMenu.open) {
      setOpen(false);
      syncMenuPosition();
      syncLayer();
    }
  }, { signal: listeners.signal });
  resourceMenu.addEventListener('toggle', () => {
    if (resourceMenu.open) {
      const restoreFocus = drawer.contains(document.activeElement);
      setOpen(false);
      syncMenuPosition();
      syncLayer();
      if (restoreFocus) resourceSummary.focus();
    }
  }, { signal: listeners.signal });
  resourceMenu.addEventListener('keydown', (event) => {
    if (!resourceMenu.open || event.defaultPrevented || event.isComposing
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const fromSummary = event.target === resourceSummary;
    if (fromSummary && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...resources.querySelectorAll('button[data-resource]:not(:disabled)')]
      .filter((button) => !button.closest('[hidden]'));
    const index = buttons.indexOf(event.target);
    if (!fromSummary && index < 0) return;
    const next = event.key === 'Home' || (fromSummary && event.key === 'ArrowDown') ? 0
      : event.key === 'End' || (fromSummary && event.key === 'ArrowUp') ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const target = buttons[next];
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, { signal: listeners.signal });
  field.addEventListener('click', () => {
    resourceMenu.open = false;
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
      const fromResources = resources.contains(document.activeElement);
      const fromDrawer = drawer.contains(document.activeElement);
      if (fromResources) resourceSummary.focus({ preventScroll: true });
      else if (fromDrawer) toggle.focus({ preventScroll: true });
      resourceMenu.open = false;
      setOpen(false);
      const resource = event.target.closest?.('[data-resource]')?.dataset.resource;
      const windowId = ['population', 'happiness'].includes(resource) ? 'population'
        : ['metal', 'crystal', 'deuterium', 'food', 'rare_earth', 'energy'].includes(resource) ? 'economy' : null;
      if (fromResources && windowId) {
        requestAnimationFrame(() => {
          if (!root.isConnected || document.activeElement !== resourceSummary
            || !wm?.isOpen(windowId) || wm.isMinimized(windowId)) return;
          const title = document.getElementById(`wm-win-${windowId}`)?.querySelector('.wm-title');
          if (title) {
            title.tabIndex = -1;
            title.focus({ preventScroll: true });
          }
        });
      }
    }
  }, { signal: listeners.signal });
  root.addEventListener('change', (event) => {
    if (event.target.id === 'game-colony-select' && document.getElementById('game-fleet-command')?.hidden === false) {
      setOpen(false);
    }
  }, { signal: listeners.signal });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && (resourceMenu.open || !drawer.hidden)) {
      event.preventDefault();
      event.stopPropagation();
      if (resourceMenu.open) {
        resourceMenu.open = false;
        resourceSummary.focus();
      } else {
        setOpen(false, true);
      }
    }
  }, { signal: listeners.signal });
  document.addEventListener('pointerdown', (event) => {
    if (resourceMenu.open && !resourceMenu.contains(event.target)) {
      const restoreFocus = resources.contains(document.activeElement);
      resourceMenu.open = false;
      if (restoreFocus) resourceSummary.focus();
    }
    if (!drawer.hidden && !drawer.contains(event.target) && !toggle.contains(event.target)) {
      setOpen(false, drawer.contains(document.activeElement));
    }
  }, { signal: listeners.signal });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    listeners.abort();
    dockObserver.disconnect();
    statusObserver?.disconnect();
    unsubscribeResourceContext?.();
    resourceContext.remove();
    resourceToolbar.remove();
    unmountOutliner?.();
    if (gameActions && gameActionsPlaceholder) gameActionsPlaceholder.replaceWith(gameActions);
    for (const { element, placeholder } of placements.reverse()) {
      placeholder.replaceWith(element);
    }
    root.remove();
    document.body.classList.remove('game-overlay-layout');
  };
}
