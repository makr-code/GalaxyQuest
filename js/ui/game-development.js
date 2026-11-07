import { createGameIcon, createResourceCostChips } from './game-ui-visuals.js';
import { createGameWindowView } from './game-window-view.js';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, onClick, disabled = false) {
  const element = node('button', text, 'btn btn-secondary btn-sm');
  element.type = 'button';
  element.disabled = disabled;
  element.addEventListener('click', onClick);
  return element;
}

export function mountDevelopmentWindows({ session, domains, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  let disposed = false;
  let buildingSelection = null;
  let focusPending = false;
  const filters = {
    buildings: { query: '', status: 'all' },
    research: { query: '', status: 'all' },
  };
  const unsubscribers = [];
  const views = Object.fromEntries(['buildings', 'research'].map((kind) => [kind, createGameWindowView(wm, kind)]));
  function render(kind) {
    if (!wm.body(kind) || disposed) return;
    const state = domains[kind].getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const view = views[kind];
    const root = view.begin({ ...state, colony, busy });
    const content = node('section', undefined, 'game-development game-development-workspace');
    content.dataset.domain = kind;
    const header = node('header', undefined, 'game-development-workspace-header');
    const heading = node('h2', kind === 'buildings' ? 'Gebäude' : 'Forschung');
    heading.prepend(createGameIcon(kind));
    header.append(heading, node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    content.append(header);
    const actions = node('div', undefined, 'game-development-actions');
    actions.append(
      button('Aktualisieren', () => { void domains[kind].refresh(); }, busy || !colony),
    );
    content.append(actions);
    if (kind === 'buildings' && buildingSelection) {
      actions.append(button('Gebäudeauswahl aufheben', () => {
        buildingSelection = null;
        focusPending = false;
        render(kind);
      }));
    }
    view.status(content, { ...state, colony, busy });
    const orders = node('section', undefined, 'game-development-orders');
    orders.setAttribute('aria-label', kind === 'buildings' ? 'Bauaufträge' : 'Forschungsaufträge');
    const ordersHeader = node('div', undefined, 'game-development-orders-header');
    ordersHeader.append(node('h3', kind === 'buildings' ? 'Bauwarteschlange' : 'Aktuelle Forschung'),
      button('Fällige Aufträge abschließen', () => { void domains[kind].command('finish'); }, busy || !colony));
    orders.append(ordersHeader);
    content.append(orders);
    if (state.data) {
      if (kind === 'buildings') {
        if (state.data.upgrade_queue.length) {
          const queue = view.widget('timeline', orders, {
            ariaLabel: 'Bauwarteschlange',
            items: state.data.upgrade_queue.map((order, index) => ({
              id: order.id ?? `${order.type}:${index}`,
              title: `${order.type.replaceAll('_', ' ')} → ${order.target_level}`,
              state: order.status === 'running' ? 'active' : order.status === 'queued' ? 'queued' : 'blocked',
              stateLabel: order.status === 'running' ? 'Im Bau' : order.status === 'queued' ? 'Wartet' : order.status,
              meta: order.eta ? `${order.eta} (Serverzeit)` : 'Start ausstehend',
            })),
          });
          queue.el.classList.add('game-development-queue');
        } else view.widget('notice', orders, { state: 'empty', title: 'Keine Bauaufträge.' }).el.classList.add('game-development-queue');
      } else {
        const running = state.data.research.filter((entry) => entry.research_end);
        if (running.length) {
          view.widget('timeline', orders, { ariaLabel: 'Laufende Forschung', items: running.map((entry) => ({
            id: entry.type, title: `${entry.meta?.label || entry.type.replaceAll('_', ' ')} → ${entry.level + 1}`,
            state: 'active', stateLabel: 'In Arbeit', meta: `${entry.research_end} (Serverzeit)`,
          })) }).el.classList.add('game-development-queue');
        } else view.widget('notice', orders, { state: 'empty', title: 'Keine laufende Forschung.' }).el.classList.add('game-development-queue');
      }
      content.append(node('h3', kind === 'buildings' ? 'Gebäude ausbauen' : 'Forschung entwickeln'));
      const list = node('div', undefined, 'game-development-list game-development-catalog');
      const filter = filters[kind];
      const tools = node('section', undefined, 'game-development-filters');
      tools.setAttribute('aria-label', 'Katalog filtern');
      const searchLabel = node('label', 'Katalog durchsuchen ');
      const search = node('input');
      search.type = 'search';
      search.dataset.gameFocus = 'catalog-search';
      search.setAttribute('aria-label', 'Katalog durchsuchen');
      search.value = filter.query;
      searchLabel.append(search);
      const statusLabel = node('label', 'Auftragsstatus ');
      const statusSelect = node('select');
      statusSelect.dataset.gameFocus = 'catalog-state';
      statusSelect.setAttribute('aria-label', 'Auftragsstatus');
      for (const [value, title] of [
        ['all', 'Alle Zustände'], ['running', 'In Arbeit'], ['request', 'Auftrag anfragen'],
        ...(kind === 'research' ? [['blocked', 'Voraussetzungen fehlen']] : []),
      ]) {
        const option = node('option', title);
        option.value = value;
        statusSelect.append(option);
      }
      statusSelect.value = filter.status;
      statusLabel.append(statusSelect);
      const result = node('p');
      result.setAttribute('role', 'status');
      const empty = node('p', 'Keine passenden Einträge. Filter zurücksetzen, um den gesamten Katalog zu sehen.');
      const reset = button('Katalogfilter zurücksetzen', () => {
        if (disposed) return;
        filter.query = search.value = '';
        filter.status = statusSelect.value = 'all';
        applyFilters();
        search.focus({ preventScroll: true });
      });
      function applyFilters() {
        if (disposed) return;
        const query = filter.query.trim().toLocaleLowerCase();
        let visible = 0;
        for (const card of list.children) {
          card.hidden = !(card.dataset.search.includes(query)
            && (filter.status === 'all' || card.dataset.catalogState === filter.status));
          if (!card.hidden) visible++;
        }
        result.textContent = `${visible} von ${list.children.length} Einträgen angezeigt.`;
        empty.hidden = visible !== 0;
        reset.disabled = !filter.query && filter.status === 'all';
      }
      search.addEventListener('input', () => { filter.query = search.value; applyFilters(); });
      statusSelect.addEventListener('change', () => { filter.status = statusSelect.value; applyFilters(); });
      tools.append(searchLabel, statusLabel, reset);
      content.append(tools, result, empty);
      const researchBusy = kind === 'research' && state.data.research.some((entry) => entry.research_end);
      for (const entry of state.data[kind]) {
        const card = node('article', undefined, 'game-development-card game-development-project-card');
        card.dataset.type = entry.type;
        const heading = node('h3', entry.meta?.label || entry.type.replaceAll('_', ' '));
        if (kind === 'buildings' && buildingSelection?.type === entry.type
            && Number(buildingSelection.colonyId) === Number(state.colonyId)) {
          card.setAttribute('aria-current', 'true');
          heading.tabIndex = -1;
        }
        const title = node('header', undefined, 'game-development-card-heading');
        title.append(createGameIcon(kind), heading, node('span', `Stufe ${entry.level}`, 'game-development-level'));
        card.append(title);
        const costs = node('section', undefined, 'game-development-project-costs');
        costs.append(node('p', `Kosten für Stufe ${entry.level + 1}`),
          createResourceCostChips(entry.next_cost, 'Kosten der nächsten Stufe'));
        card.append(costs);
        const end = kind === 'buildings' ? entry.upgrade_end : entry.research_end;
        const blocked = kind === 'research' && entry.can_research !== true;
        const stateBadge = node('p', end ? 'In Arbeit' : blocked ? 'Voraussetzungen fehlen' : 'Auftrag anfragen',
          'game-development-state');
        stateBadge.dataset.orderState = end ? 'running' : blocked ? 'blocked' : 'request';
        card.dataset.catalogState = stateBadge.dataset.orderState;
        card.dataset.search = `${entry.type} ${heading.textContent}`.toLocaleLowerCase();
        card.append(stateBadge);
        if (end) card.append(node('p', `Läuft bis ${end} (Serverzeit)`));
        if (entry.missing_prereqs?.length) {
          const prerequisites = node('ul', undefined, 'game-research-prerequisites');
          prerequisites.setAttribute('aria-label', 'Fehlende Forschungsvoraussetzungen');
          for (const missing of entry.missing_prereqs) {
            const prerequisite = node('li');
            const level = (value) => (typeof value === 'number' || typeof value === 'string')
              && String(value).trim() !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0;
            const required = level(missing.required_level) ? Number(missing.required_level) : null;
            const current = level(missing.current_level) ? Number(missing.current_level) : null;
            const name = node('strong', missing.tech);
            name.prepend(createGameIcon('research'));
            prerequisite.append(name,
              node('span', `Benötigt: Stufe ${required ?? 'Nicht verfügbar'}`),
              node('span', `Vorhanden: Stufe ${current ?? 'Nicht verfügbar'}`));
            if (required !== null && required > 0 && current !== null) {
              const meter = node('meter');
              meter.min = 0;
              meter.max = required;
              meter.value = Math.min(current, required);
              meter.setAttribute('aria-label', `${missing.tech}: vorhandene Stufe ${current} von benötigter Stufe ${required}`);
              prerequisite.append(meter);
            }
            prerequisites.append(prerequisite);
          }
          card.append(prerequisites);
        }
        card.append(button(kind === 'buildings' ? 'Ausbau beauftragen' : 'Forschung starten',
          () => { void domains[kind].command('start', entry.type); },
          busy || !colony || !!researchBusy || (kind === 'research' && entry.can_research !== true)));
        list.append(card);
      }
      applyFilters();
      content.append(list);
      if (kind === 'buildings' && buildingSelection && !busy
          && !state.data.buildings.some((entry) => entry.type === buildingSelection.type)) {
        const unavailable = node('p', 'Das ausgewählte Gebäude ist in dieser Kolonie nicht mehr verfügbar.');
        unavailable.setAttribute('role', 'status');
        content.append(unavailable);
        focusPending = false;
      }
    }
    const help = node('details', undefined, 'game-development-help');
    help.append(node('summary', 'Kosten und Auftragsabschluss'),
      node('p', 'Warteschlange und Boni können die Auftragspreise ändern. Kosten, Voraussetzungen und Laufzeiten prüft der Server. Öffnen und Aktualisieren senden keine Abschlussbefehle; fälligen Fortschritt kann der Server bei der On-Demand-Abrechnung übernehmen.'));
    content.append(help);
    view.commit(root, content);
    if (kind === 'buildings' && focusPending && !busy && wm.isOpen(kind)) {
      const heading = root.querySelector('[aria-current="true"] h3');
      if (heading) {
        focusPending = false;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      }
    }
  }
  for (const kind of ['buildings', 'research']) {
    wm.register(kind, {
      title: kind === 'buildings' ? 'Gebäude' : 'Forschung', w: 680, h: 540,
      onRender() {
        void domains[kind].load();
        render(kind);
      },
    });
    unsubscribers.push(domains[kind].subscribe(() => render(kind)));
  }
  const lastIds = new Map(['buildings', 'research'].map((kind) => [kind, session.getColony()?.id ?? null]));
  unsubscribers.push(session.events.on('overview:updated', () => {
    for (const kind of ['buildings', 'research']) {
      const id = session.getColony()?.id ?? null;
      if (id !== lastIds.get(kind)) {
        if (kind === 'buildings') { buildingSelection = null; focusPending = false; }
        lastIds.set(kind, id);
        if (wm.isOpen(kind)) void domains[kind].load();
      }
      render(kind);
    }
  }));
  unsubscribers.push(session.events.on('buildings:open-requested', ({ colonyId, buildingType }) => {
    session.selectColony(colonyId);
    buildingSelection = buildingType ? { colonyId, type: buildingType } : null;
    if (buildingType) filters.buildings = { query: '', status: 'all' };
    focusPending = !!buildingSelection;
    wm.open('buildings');
    render('buildings');
  }));
  const open = (event) => {
    const target = event.target.closest?.('[data-game-development]');
    if (target && !disposed) wm.open(target.dataset.gameDevelopment);
  };
  document.addEventListener('click', open);
  return () => {
    disposed = true;
    document.removeEventListener('click', open);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    for (const kind of ['buildings', 'research']) {
      wm.close(kind);
      views[kind].destroy();
      wm.register(kind, { onRender: null });
    }
  };
}
