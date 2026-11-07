import { createGameIcon, createResourceCostChips } from './game-ui-visuals.js';
import { createGameWindowView } from './game-window-view.js';

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text, action, disabled = false) {
  const element = node('button', text);
  element.type = 'button';
  element.className = 'btn btn-secondary btn-sm';
  element.disabled = disabled;
  element.addEventListener('click', action);
  return element;
}

export function mountShipyardWindow({ session, domain, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  const view = createGameWindowView(wm, 'shipyard');
  let disposed = false;
  let lastColony = session.getColony()?.id ?? null;
  let quantities = {};
  let validationError = '';
  let searchQuery = '';
  let catalogueFilter = 'all';
  async function command(action, value) {
    validationError = '';
    try { await domain.command(action, value); }
    catch (error) {
      if (disposed || error.name === 'AbortError') return;
      validationError = error.message;
      window.GQLog?.error?.('[shipyard]', error.message);
      window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
    }
    if (!disposed) render();
  }
  function render() {
    if (disposed || !wm.body('shipyard')) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const root = view.begin({ ...state, colony, busy, error: validationError || state.error });
    const locked = busy || state.stale || !state.data || !colony;
    const content = node('section');
    content.className = 'game-development game-shipyard';
    content.dataset.domain = 'shipyard';
    const header = node('header');
    header.className = 'game-shipyard-header';
    const title = node('h2', 'Werft');
    title.prepend(createGameIcon('shipyard'));
    header.append(title, node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    content.append(header);
    const actions = node('div');
    actions.className = 'game-development-actions';
    actions.append(
      button('Werft aktualisieren', () => { validationError = ''; void domain.refresh(); }, busy || !colony),
      button('Flotte im Spielfeld zusammenstellen', () => {
        if (!colony || disposed) return;
        wm.minimize('shipyard');
        session.events.emit('fleet:origin-requested', { colonyId: Number(colony.id) });
      }, busy || !colony),
    );
    content.append(actions);
    view.status(content, { ...state, colony, busy, error: validationError || state.error });
    if (state.stale && state.data) content.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Befehlen aktualisieren.'));
    const production = node('section');
    production.className = 'game-shipyard-production';
    production.setAttribute('aria-label', 'Produktionsaufträge');
    const productionHeader = node('div');
    productionHeader.className = 'game-shipyard-production-header';
    productionHeader.append(node('h3', 'Schiffsbauwarteschlange'),
      button('Fällige Schiffsbauten abschließen', () => { void command('finish'); }, locked));
    production.append(productionHeader);
    content.append(production);
    if (state.data) {
      const count = node('span', `${state.data.queue.length} ${state.data.queue.length === 1 ? 'Auftrag' : 'Aufträge'}`);
      count.className = 'game-shipyard-order-count';
      productionHeader.append(count);
      if (state.data.queue.length) {
        const queue = view.widget('timeline', production, {
          ariaLabel: 'Schiffsbauwarteschlange',
          items: state.data.queue.map((order) => ({
            id: order.id, title: `${order.quantity} ${order.label || order.ship_type.replaceAll('_', ' ')}`,
            state: order.status === 'running' ? 'active' : 'queued',
            stateLabel: order.status === 'running' ? 'Im Bau' : 'Wartet',
            meta: `#${order.position} · ${order.eta ? `${order.eta} (Serverzeit)` : 'Start ausstehend'}`,
          })),
        });
        queue.el.classList.add('game-development-queue', 'game-shipyard-queue');
        [...queue.el.children].forEach((row, index) => { row.dataset.orderState = state.data.queue[index].status; });
      } else view.widget('notice', production, { state: 'empty', title: 'Keine laufenden Schiffsbauten.' });
      content.append(node('h3', 'Schiffe fertigen'));
      const list = node('div');
      list.className = 'game-development-list game-development-catalog';
      const tools = node('section');
      tools.className = 'game-development-filters';
      tools.setAttribute('aria-label', 'Werftkatalog filtern');
      const searchLabel = node('label', 'Schiffe suchen ');
      const search = node('input');
      search.type = 'search';
      search.dataset.gameFocus = 'catalog-search';
      search.value = searchQuery;
      search.setAttribute('aria-label', 'Schiffe suchen');
      searchLabel.append(search);
      const filterLabel = node('label', 'Schiffsauswahl ');
      const filter = node('select');
      filter.dataset.gameFocus = 'catalog-state';
      filter.setAttribute('aria-label', 'Schiffsauswahl');
      for (const [value, label] of [['all', 'Alle Schiffe'], ['stock', 'Mit Bestand'], ['blueprints', 'Baupläne']]) {
        const option = node('option', label);
        option.value = value;
        filter.append(option);
      }
      filter.value = catalogueFilter;
      filterLabel.append(filter);
      const result = node('p');
      result.setAttribute('role', 'status');
      const empty = node('p', 'Keine passenden Schiffe. Filter zurücksetzen, um den gesamten Katalog zu sehen.');
      const reset = button('Werftfilter zurücksetzen', () => {
        if (disposed) return;
        searchQuery = search.value = '';
        catalogueFilter = filter.value = 'all';
        applyFilters();
        search.focus({ preventScroll: true });
      });
      function applyFilters() {
        if (disposed) return;
        const query = searchQuery.trim().toLocaleLowerCase();
        let visible = 0;
        for (const card of list.children) {
          card.hidden = !card.dataset.search.includes(query)
            || (catalogueFilter === 'stock' && card.dataset.hasStock !== 'true')
            || (catalogueFilter === 'blueprints' && card.dataset.blueprint !== 'true');
          if (!card.hidden) visible++;
        }
        result.textContent = `${visible} von ${list.children.length} Schiffstypen angezeigt.`;
        empty.hidden = visible > 0;
        reset.disabled = !searchQuery && catalogueFilter === 'all';
      }
      search.addEventListener('input', () => { if (!disposed) { searchQuery = search.value; applyFilters(); } });
      filter.addEventListener('change', () => { if (!disposed) { catalogueFilter = filter.value; applyFilters(); } });
      tools.append(searchLabel, filterLabel, reset);
      content.append(tools, result, empty);
      for (const ship of state.data.ships) {
        const label = ship.name || ship.type.replaceAll('_', ' ');
        const card = node('article');
        card.className = 'game-development-card game-shipyard-card';
        card.dataset.shipType = ship.type;
        card.dataset.search = `${ship.type} ${label}`.toLocaleLowerCase();
        card.dataset.hasStock = String(Number(ship.count) > 0);
        card.dataset.blueprint = String(ship.id != null);
        const heading = node('header');
        heading.className = 'game-development-card-heading';
        const stock = node('span', `Verfügbar: ${ship.count}`);
        stock.className = 'game-shipyard-stock';
        heading.append(createGameIcon('fleet'), node('h3', label), stock);
        card.append(heading);
        if (ship.id != null) {
          const blueprint = node('p', 'Bauplan');
          blueprint.className = 'game-shipyard-blueprint';
          blueprint.prepend(createGameIcon('research'));
          card.append(blueprint);
        }
        const cost = node('section');
        cost.className = 'game-shipyard-cost';
        cost.append(node('p', 'Basiskosten je Schiff'), createResourceCostChips(ship.cost, 'Basiskosten je Schiff'));
        card.append(cost);
        const form = node('form');
        const fields = node('fieldset');
        fields.disabled = locked;
        const input = node('input');
        input.type = 'number';
        input.dataset.gameFocus = `quantity:${ship.type}`;
        input.min = '1';
        input.step = '1';
        input.required = true;
        input.value = quantities[ship.type] ?? '1';
        input.setAttribute('aria-label', `Baumenge ${label}`);
        input.addEventListener('input', () => { quantities[ship.type] = input.value; });
        view.widget('field', fields, { label: `Baumenge ${label}`, control: input, help: 'Ganze Einheiten · mindestens 1' });
        const submit = node('button', 'Schiffe bauen');
        submit.type = 'submit';
        submit.className = 'btn btn-primary btn-sm';
        fields.append(submit);
        form.append(fields);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (disposed || domain.getState().mutating || !form.reportValidity()) return;
          void command('build', { type: ship.type, count: input.value });
        });
        card.append(form);
        list.append(card);
      }
      applyFilters();
      content.append(list);
    }
    const help = node('details');
    help.className = 'game-shipyard-help';
    help.append(node('summary', 'Baukosten und Abschluss'),
      node('p', 'Basiskosten sind keine Preiszusage: Kolonieboni, Voraussetzungen und Laufzeit prüft der Server. Öffnen und Aktualisieren verarbeiten keine Schiffsbauten. Abschluss erfolgt ausdrücklich oder bei einer serverseitigen On-Demand-Mutation; kein lokaler Timer.'));
    content.append(help);
    view.commit(root, content);
  }
  wm.register('shipyard', { title: 'Werft', w: 680, h: 540,
    onRender() { render(); void domain.load(); } });
  const unsubscribe = domain.subscribe(render);
  const unsubscribeColony = session.events.on('overview:updated', () => {
    const id = session.getColony()?.id ?? null;
    if (id !== lastColony) {
      lastColony = id;
      quantities = {};
      validationError = '';
      if (wm.isOpen('shipyard')) void domain.load();
    }
    render();
  });
  const unsubscribeAccepted = session.events.on('colony:mutation-accepted', (event) => {
    if (!event.allColonies && Number(event.colonyId) !== Number(lastColony)) return;
    if (event.domain === 'shipyard') { quantities = {}; validationError = ''; }
    else if (['fleet-launch', 'fleets'].includes(event.domain) && wm.isOpen('shipyard')) void domain.load();
    render();
  });
  const unsubscribeOpen = session.events.on('shipyard:open-requested', ({ colonyId }) => {
    session.selectColony(colonyId);
    wm.open('shipyard');
  });
  const open = (event) => {
    if (!disposed && event.target.closest?.('[data-game-shipyard]')) wm.open('shipyard');
  };
  document.addEventListener('click', open);
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeColony();
    unsubscribeAccepted();
    unsubscribeOpen();
    document.removeEventListener('click', open);
    wm.close('shipyard');
    view.destroy();
    wm.register('shipyard', { onRender: null });
  };
}
