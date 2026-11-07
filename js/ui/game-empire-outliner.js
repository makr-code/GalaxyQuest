import { createGameIcon, createStockChart, decorateGameAction } from './game-ui-visuals.js';

function node(tag, text = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

export function mountEmpireOutliner({ host, session, galaxy, wm = null, windows = [] }) {
  const panel = node('details');
  panel.id = 'game-empire-outliner';
  panel.open = true;
  const summary = node('summary');
  const summaryIcon = createGameIcon('planet');
  const summaryLabel = node('span');
  summary.append(summaryIcon, summaryLabel);
  const content = node('section');
  content.setAttribute('aria-label', 'Imperiumsübersicht');
  const label = node('label', 'Kolonien');
  label.className = 'game-empire-search-label';
  const search = node('input');
  search.id = 'game-empire-search';
  search.type = 'search';
  search.placeholder = 'Name oder Koordinaten';
  search.setAttribute('aria-label', 'Kolonien nach Name oder Koordinaten durchsuchen');
  search.setAttribute('aria-keyshortcuts', 'ArrowDown ArrowUp');
  search.title = 'Pfeil runter: erster Treffer. Pfeil hoch: letzter Treffer. Enter auf einem Treffer wählt die Kolonie.';
  label.htmlFor = search.id;
  const searchTools = node('div');
  searchTools.className = 'game-empire-search-tools';
  const clearSearch = node('button', '×');
  clearSearch.type = 'button';
  clearSearch.setAttribute('aria-label', 'Koloniesuche löschen');
  clearSearch.title = 'Koloniesuche löschen';
  searchTools.append(search, clearSearch);
  const list = node('ul');
  list.setAttribute('aria-label', 'Eigene Kolonien');
  const empty = node('div');
  empty.className = 'game-empire-outliner-empty';
  const emptyMessage = node('p');
  const recover = node('button', 'Alle Kolonien anzeigen');
  recover.type = 'button';
  empty.append(emptyMessage, recover);
  const results = node('p');
  results.className = 'game-empire-search-results';
  results.setAttribute('aria-live', 'polite');
  results.setAttribute('aria-atomic', 'true');
  const searchHeader = node('div');
  searchHeader.className = 'game-empire-search-header';
  searchHeader.append(label, searchTools, results);
  const status = node('p');
  status.id = 'game-empire-navigation-status';
  status.className = 'game-empire-status';
  status.setAttribute('role', 'status');
  const rows = new Map();
  const management = node('section');
  management.className = 'game-empire-management';
  management.setAttribute('aria-label', 'Aktive Kolonie verwalten');
  const managementHeader = node('header');
  managementHeader.className = 'game-empire-management-header';
  managementHeader.append(createGameIcon('planet'));
  const managementTitle = node('strong');
  const managementCoordinates = node('span');
  managementCoordinates.className = 'game-empire-coordinates';
  managementHeader.append(managementTitle, managementCoordinates);
  const tools = node('div');
  const actionStatus = node('p');
  actionStatus.className = 'game-empire-status';
  actionStatus.setAttribute('role', 'status');
  const controls = new Map();
  for (const [id, title] of windows) {
    const control = node('button');
    decorateGameAction(control, id, title);
    control.type = 'button';
    control.dataset.empireWindow = id;
    control.setAttribute('aria-pressed', 'false');
    controls.set(id, control);
    tools.append(control);
  }
  const stock = node('section');
  stock.setAttribute('aria-label', 'Lagerübersicht der aktiven Kolonie');
  management.append(managementHeader, tools, stock, actionStatus);
  let disposed = false;
  let query = '';
  let composing = false;
  let lastColonyId = null;
  function normalize(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  }
  function syncWindows() {
    if (disposed) return;
    for (const [id, control] of controls) {
      control.setAttribute('aria-pressed', String(!!wm?.isOpen(id) && !wm.isMinimized(id)));
    }
  }
  function render() {
    if (disposed) return;
    const colonies = session.getState()?.colonies ?? [];
    const activeId = Number(session.getColony()?.id);
    const colony = session.getColony();
    if (lastColonyId !== colony?.id) actionStatus.textContent = '';
    lastColonyId = colony?.id;
    management.hidden = !wm || !windows.length || !colony;
    if (management.hidden && management.contains(document.activeElement)) search.focus({ preventScroll: true });
    managementTitle.textContent = colony ? `Verwalten: ${colony.name}` : '';
    managementCoordinates.textContent = colony
      ? `[${colony.galaxy}:${colony.system}:${colony.position}]` : '';
    stock.replaceChildren(...(colony ? [createStockChart(colony)] : []));
    for (const control of controls.values()) control.disabled = !colony;
    syncWindows();
    const state = galaxy.getState();
    list.setAttribute('aria-busy', String(!!state.loading));
    const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
    const ids = new Set(colonies.map((colony) => String(colony.id)));
    summaryLabel.textContent = `Imperium · ${colonies.length} ${colonies.length === 1 ? 'Kolonie' : 'Kolonien'}`;
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      if (row.contains(document.activeElement)) search.focus({ preventScroll: true });
      row.remove();
      rows.delete(id);
    }
    let visible = 0;
    let nextRow = list.firstElementChild;
    for (const colony of colonies) {
      const id = String(colony.id);
      const coordinates = `[${colony.galaxy}:${colony.system}:${colony.position}]`;
      let row = rows.get(id);
      if (!row) {
        row = node('li');
        row.dataset.colonyId = id;
        const choose = node('button');
        choose.type = 'button';
        choose.dataset.empireAction = 'select';
        choose.setAttribute('aria-keyshortcuts', 'ArrowDown ArrowUp Home End');
        const colonyName = node('span');
        const activeBadge = node('span', 'Aktiv');
        activeBadge.className = 'game-empire-active-badge';
        activeBadge.hidden = true;
        choose.append(createGameIcon('planet'), colonyName, activeBadge);
        const location = node('span');
        location.className = 'game-empire-coordinates';
        const locate = node('button');
        decorateGameAction(locate, 'locate', 'Ansehen');
        locate.type = 'button';
        locate.dataset.empireAction = 'locate';
        locate.setAttribute('aria-keyshortcuts', 'ArrowDown ArrowUp Home End');
        locate.setAttribute('aria-describedby', status.id);
        row.append(choose, location, locate);
        rows.set(id, row);
        list.append(row);
      }
      const choose = row.querySelector('[data-empire-action="select"]');
      choose.querySelector(':scope > span').textContent = colony.name;
      choose.title = `${colony.name} als aktive Kolonie verwalten`;
      const active = Number(colony.id) === activeId;
      row.dataset.active = String(active);
      choose.setAttribute('aria-pressed', String(active));
      choose.setAttribute('aria-label', active ? `${colony.name}, aktive Kolonie` : `${colony.name} als Kolonie auswählen`);
      row.querySelector('.game-empire-active-badge').hidden = !active;
      row.querySelector('.game-empire-coordinates').textContent = coordinates;
      const locate = row.querySelector('[data-empire-action="locate"]');
      locate.setAttribute('aria-label', `${colony.name} ${coordinates} im Spielfeld ansehen`);
      if (state.loading && document.activeElement === locate) choose.focus({ preventScroll: true });
      locate.disabled = state.loading;
      const text = normalize(`${colony.name} ${coordinates}`);
      row.hidden = !tokens.every((token) => text.includes(token));
      if (row.hidden && row.contains(document.activeElement)) search.focus({ preventScroll: true });
      if (row !== nextRow) {
        const focused = row.contains(document.activeElement) ? document.activeElement : null;
        list.insertBefore(row, nextRow);
        if (focused && panel.open && !row.hidden) focused.focus({ preventScroll: true });
      }
      nextRow = row.nextElementSibling;
      if (!row.hidden) visible++;
    }
    if ((!search.value && document.activeElement === clearSearch)
      || ((visible > 0 || !colonies.length) && document.activeElement === recover)) search.focus({ preventScroll: true });
    clearSearch.disabled = !search.value;
    results.textContent = `${visible} von ${colonies.length} Kolonien`;
    empty.hidden = visible > 0;
    emptyMessage.textContent = colonies.length ? 'Keine passenden Kolonien.' : 'Keine Kolonien vorhanden.';
    recover.hidden = !colonies.length || !search.value;
    status.textContent = state.loading ? 'Kartenansicht wird geladen ...' : state.error || '';
  }
  function act(event) {
    const button = event.target.closest?.('[data-empire-action]');
    if (!button || button.disabled) return;
    const id = button.closest('[data-colony-id]')?.dataset.colonyId;
    const colony = session.getState()?.colonies.find((entry) => String(entry.id) === id);
    if (!colony) return;
    if (button.dataset.empireAction === 'select') {
      if (Number(session.getColony()?.id) !== Number(colony.id)) session.selectColony(colony.id);
    } else {
      void galaxy.navigate(colony.galaxy, colony.system);
    }
  }
  function updateSearch(event) {
    if (disposed || composing || event.isComposing || query === search.value) return;
    query = search.value;
    render();
  }
  function startComposition() { composing = true; }
  function endComposition(event) {
    composing = false;
    updateSearch(event);
  }
  search.addEventListener('input', updateSearch);
  search.addEventListener('compositionstart', startComposition);
  search.addEventListener('compositionend', endComposition);
  function focusResult(event) {
    if (disposed || !panel.open || composing || event.isComposing || event.defaultPrevented
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const fromSearch = event.target === search;
    if (fromSearch && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const action = fromSearch ? 'select' : event.target.closest?.('[data-empire-action]')?.dataset.empireAction;
    if (!['select', 'locate'].includes(action)) return;
    const matches = [...list.querySelectorAll(`li:not([hidden]) [data-empire-action="${action}"]:not(:disabled)`)];
    const index = fromSearch ? -1 : matches.indexOf(event.target.closest('[data-empire-action]'));
    if (!fromSearch && index < 0) return;
    const next = event.key === 'Home' || (fromSearch && event.key === 'ArrowDown') ? 0
      : event.key === 'End' || (fromSearch && event.key === 'ArrowUp') ? matches.length - 1
        : Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const target = matches[next];
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    target.focus();
  }
  search.addEventListener('keydown', focusResult);
  list.addEventListener('keydown', focusResult);
  function resetSearch() {
    if (disposed) return;
    search.value = '';
    query = '';
    composing = false;
    search.focus({ preventScroll: true });
    render();
  }
  clearSearch.addEventListener('click', resetSearch);
  recover.addEventListener('click', resetSearch);
  list.addEventListener('click', act);
  function openWindow(event) {
    const control = event.target.closest?.('[data-empire-window]');
    if (disposed || !control || control.disabled || !session.getColony() || !wm) return;
    const id = control.dataset.empireWindow;
    if (!controls.has(id)) return;
    wm.open(id);
    syncWindows();
    if (!wm.isOpen(id) || wm.isMinimized(id)) {
      actionStatus.textContent = `${control.textContent} konnte nicht geöffnet werden.`;
      return;
    }
    actionStatus.textContent = '';
    const title = document.getElementById(`wm-win-${id}`)?.querySelector('.wm-title');
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
  }
  tools.addEventListener('click', openWindow);
  window.addEventListener('wm:window-state-changed', syncWindows);
  panel.addEventListener('keydown', escape);
  function escape(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || composing || !panel.open) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.target === search && search.value) {
      resetSearch();
      return;
    }
    panel.open = false;
    summary.focus({ preventScroll: true });
  }
  content.append(searchHeader, list, empty, status, management);
  panel.append(summary, content);
  host.append(panel);
  const unsubscribeOverview = session.events.on('overview:updated', render);
  const unsubscribeGalaxy = galaxy.subscribe(render);
  render();
  return () => {
    disposed = true;
    unsubscribeOverview();
    unsubscribeGalaxy();
    search.removeEventListener('input', updateSearch);
    search.removeEventListener('compositionstart', startComposition);
    search.removeEventListener('compositionend', endComposition);
    search.removeEventListener('keydown', focusResult);
    list.removeEventListener('keydown', focusResult);
    clearSearch.removeEventListener('click', resetSearch);
    recover.removeEventListener('click', resetSearch);
    list.removeEventListener('click', act);
    tools.removeEventListener('click', openWindow);
    window.removeEventListener('wm:window-state-changed', syncWindows);
    panel.removeEventListener('keydown', escape);
    panel.remove();
  };
}
