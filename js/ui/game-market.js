import { createGameWindowView } from './game-window-view.js';

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountMarketWindow({ session, domain, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  const view = createGameWindowView(wm, 'trade');
  let disposed = false;
  let lastColony = session.getColony()?.id ?? null;
  let draft = { good_type: '', quantity: '' };
  let validationError = '';
  let searchQuery = '';
  let historyState = { query: '', filters: {}, sort: null };
  function render() {
    if (disposed || !wm.body('trade')) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const root = view.begin({ ...state, colony, busy, error: validationError || state.error });
    const content = node('section');
    content.className = 'game-development game-market';
    content.dataset.domain = 'market';
    const heading = node('h2', 'Markt');
    heading.prepend(createGameIcon('trade'));
    const header = node('header');
    header.className = 'game-market-header';
    header.append(heading,
      node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    content.append(header);
    const refresh = node('button', 'Markt aktualisieren');
    refresh.type = 'button';
    refresh.className = 'btn btn-secondary btn-sm';
    refresh.disabled = busy || !colony;
    refresh.addEventListener('click', () => { validationError = ''; void domain.refresh(); });
    content.append(refresh);
    view.status(content, { ...state, colony, busy, error: validationError || state.error });
    if (state.stale && state.data) content.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Handelsbefehlen aktualisieren.'));
    if (state.data) {
      const form = node('form');
      form.setAttribute('aria-label', 'Markthandel');
      const fields = node('fieldset');
      fields.className = 'game-market-ticket';
      fields.append(node('legend', 'Handelsauftrag'));
      fields.disabled = busy || state.stale || !colony;
      const goods = node('select');
      goods.setAttribute('aria-label', 'Handelsgut');
      for (const entry of state.data.prices) {
        const option = node('option', entry.good_type.replaceAll('_', ' '));
        option.value = entry.good_type;
        goods.append(option);
      }
      if (!draft.good_type) draft.good_type = state.data.prices[0].good_type;
      const available = state.data.prices.some((entry) => entry.good_type === draft.good_type);
      if (!available) {
        const missing = node('option', `${draft.good_type.replaceAll('_', ' ')} (nicht im Serverkatalog)`);
        missing.value = draft.good_type;
        goods.append(missing);
        const error = node('p', 'Das angeforderte Gut ist im aktuellen Serverkatalog nicht handelbar. Anderes Gut auswählen oder Markt aktualisieren.');
        error.setAttribute('role', 'alert');
        content.append(error);
      }
      goods.value = draft.good_type;
      const goodsField = view.widget('field', fields, {
        label: 'Handelsgut', control: goods,
        help: 'Auswahl aus dem bestätigten Serverkatalog.',
        error: available ? '' : 'Dieses Gut ist im aktuellen Serverkatalog nicht handelbar.',
      });
      goodsField.el.classList.add('game-market-native-selection');
      const catalogue = node('div');
      catalogue.className = 'game-market-goods';
      catalogue.setAttribute('role', 'group');
      catalogue.setAttribute('aria-label', 'Warenauswahl; bestätigte Stückpreise');
      const tools = node('section');
      tools.className = 'game-development-filters';
      tools.setAttribute('aria-label', 'Marktwaren filtern');
      const searchLabel = node('label', 'Waren suchen ');
      const search = node('input');
      search.type = 'search';
      search.setAttribute('aria-label', 'Waren suchen');
      search.value = searchQuery;
      searchLabel.append(search);
      const result = node('p');
      result.setAttribute('role', 'status');
      const empty = node('p', 'Keine passenden Waren. Die Handelsauswahl bleibt unverändert.');
      const reset = node('button', 'Warensuche zurücksetzen');
      reset.type = 'button';
      reset.className = 'btn btn-secondary btn-sm';
      function applySearch() {
        if (disposed) return;
        const query = searchQuery.trim().toLocaleLowerCase().replaceAll('_', ' ');
        let visible = 0;
        for (const tile of catalogue.children) {
          tile.hidden = !tile.dataset.search.includes(query);
          if (!tile.hidden) visible++;
        }
        result.textContent = `${visible} von ${catalogue.children.length} Waren angezeigt.`;
        empty.hidden = visible > 0;
        reset.disabled = !searchQuery;
      }
      search.addEventListener('input', () => {
        if (disposed) return;
        searchQuery = search.value;
        applySearch();
      });
      reset.addEventListener('click', () => {
        if (disposed) return;
        searchQuery = search.value = '';
        applySearch();
        search.focus({ preventScroll: true });
      });
      tools.append(searchLabel, reset);
      for (const [index, entry] of state.data.prices.entries()) {
        const tile = node('button');
        tile.type = 'button';
        tile.className = 'game-market-good btn btn-secondary btn-sm';
        tile.dataset.marketGoodIndex = String(index);
        tile.dataset.search = entry.good_type.replaceAll('_', ' ').toLocaleLowerCase();
        tile.setAttribute('aria-pressed', String(entry.good_type === draft.good_type));
        tile.append(createGameIcon(entry.good_type),
          node('strong', entry.good_type.replaceAll('_', ' ')),
          node('span', `${entry.price} Credits/Einheit`));
        tile.addEventListener('click', () => {
          const current = domain.getState();
          if (disposed || current.loading || current.mutating || current.stale || !session.getColony()) return;
          draft.good_type = entry.good_type;
          render();
          root.querySelector(`[data-market-good-index="${index}"]`)?.focus({ preventScroll: true });
        });
        catalogue.append(tile);
      }
      applySearch();
      const info = node('section');
      info.className = 'game-market-summary';
      info.setAttribute('aria-label', 'Bestätigter Marktstand');
      function updateInfo() {
        const entry = state.data.prices.find((item) => item.good_type === goods.value);
        if (!entry) {
          info.textContent = 'Kein bestätigter Marktpreis für dieses Gut.';
          return;
        }
        const heading = node('h3', goods.value.replaceAll('_', ' '));
        heading.prepend(createGameIcon(goods.value));
        const metrics = node('div');
        metrics.className = 'game-market-metrics';
        const stock = Object.hasOwn(state.data.stock, goods.value) ? state.data.stock[goods.value] : 'Nicht verfügbar';
        for (const [label, value] of [['Bestand', stock], ['Marktpreis', `${entry.price} Credits/Einheit`]]) {
          const metric = node('div');
          metric.className = 'game-market-metric';
          metric.append(node('span', `${label}: `), node('strong', value));
          metrics.append(metric);
        }
        const figure = node('figure');
        figure.className = 'game-market-balance';
        figure.append(node('figcaption', 'Angebot / Nachfrage'));
        const maximum = Math.max(Number(entry.supply), Number(entry.demand));
        for (const [key, label] of [['supply', 'Angebot'], ['demand', 'Nachfrage']]) {
          const row = node('div');
          row.className = 'game-market-balance-row';
          row.dataset.measure = key;
          row.append(node('span', label), node('strong', entry[key]));
          const track = node('div');
          track.className = 'game-market-balance-track';
          track.setAttribute('aria-hidden', 'true');
          const bar = node('span');
          bar.style.width = `${maximum > 0 ? Number(entry[key]) / maximum * 100 : 0}%`;
          track.append(bar);
          row.append(track);
          figure.append(row);
        }
        figure.append(node('small', 'Serverwerte auf gemeinsamer relativer Skala; keine Lagerkapazität oder Preisprognose.'));
        info.append(heading, metrics, figure);
      }
      goods.addEventListener('change', () => {
        draft.good_type = goods.value;
        render();
        root.querySelector('[aria-label="Handelsgut"]')?.focus({ preventScroll: true });
      });
      updateInfo();
      const quantity = node('input');
      quantity.type = 'number';
      quantity.min = '0';
      quantity.step = 'any';
      quantity.required = true;
      quantity.value = draft.quantity;
      quantity.setAttribute('aria-label', 'Handelsmenge');
      quantity.addEventListener('input', () => { draft.quantity = quantity.value; });
      const orderActions = node('div');
      orderActions.className = 'game-market-order-actions';
      const quantityField = view.widget('field', orderActions, {
        label: 'Handelsmenge', control: quantity,
        help: 'Menge größer als 0. Preis, Verfügbarkeit und Steuern prüft der Server.',
      });
      quantityField.el.classList.add('game-market-quantity');
      fields.append(info, orderActions);
      for (const [action, label] of [['buy', 'Kaufen'], ['sell', 'Verkaufen']]) {
        const submit = node('button');
        decorateGameAction(submit, 'trade', label);
        submit.type = 'submit';
        submit.value = action;
        submit.classList.add('btn', 'btn-primary', 'btn-sm');
        submit.dataset.tradeAction = action;
        submit.disabled = !available;
        orderActions.append(submit);
      }
      const orderNote = node('p', 'Abrechnung erfolgt zum Serverpreis beim Bestätigen, inklusive Steuern.');
      orderNote.className = 'game-market-order-note';
      fields.append(orderNote);
      const catalogueFields = node('fieldset');
      catalogueFields.className = 'game-market-catalogue';
      catalogueFields.disabled = fields.disabled;
      catalogueFields.append(node('legend', 'Warenauswahl'), catalogue);
      form.append(catalogueFields, fields);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (disposed || domain.getState().mutating || !form.reportValidity()) return;
        validationError = '';
        try {
          await domain.command(event.submitter?.value, { good_type: goods.value, quantity: quantity.value });
        } catch (error) {
          if (disposed || error.name === 'AbortError') return;
          validationError = error.message;
          window.GQLog?.error?.('[market]', error.message);
          window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
        }
        if (!disposed) render();
      });
      content.append(tools, result, empty, form, node('h3', 'Letzte 20 Kontotransaktionen'));
      const history = view.widget('dataTable', content, {
        caption: 'Handelshistorie · letzte 20 Kontotransaktionen', searchable: true,
        emptyText: 'Keine bisherigen Markttransaktionen.', state: historyState,
        onStateChange: (next) => { historyState = next; },
        labels: {
          toolbar: 'Werkzeuge der Handelshistorie',
          clearSearch: 'Tabellensuche leeren', removeFilter: (column, value) => `Filter entfernen: ${column}: ${value}`,
          ascending: 'aufsteigend', descending: 'absteigend', clearSort: 'Sortierung aufheben',
          sort: (column, direction) => `${column}: ${direction}`,
          nextSort: (column, direction) => `${column} ${direction} sortieren`,
          search: 'Handelshistorie durchsuchen', reset: 'Historienfilter zurücksetzen', all: 'Alle Transaktionen',
          noMatches: 'Keine passenden Transaktionen unter den letzten 20 geladenen Kontotransaktionen.',
          results: (visible, total) => `${visible} von ${total} geladenen Kontotransaktionen angezeigt (höchstens letzte 20).`,
        },
        columns: [
          { id: 'good_type', label: 'Ware und Abrechnung', rowHeader: true, sortable: true,
            sortValue: (entry) => entry.good_type.replaceAll('_', ' '),
            searchValue: (entry) => `${entry.good_type} ${entry.good_type.replaceAll('_', ' ')}`,
            render(cell, entry) {
              const heading = node('div');
              heading.className = 'game-market-transaction-heading';
              heading.append(createGameIcon(entry.good_type), node('strong', entry.good_type.replaceAll('_', ' ')));
              const details = node('details');
              details.dataset.transactionId = String(entry.id);
              details.dataset.gameDisclosure = `market-transaction:${entry.id}`;
              details.append(node('summary', 'Abrechnungsdetails'),
                node('p', `${entry.transacted_at} (Serverzeit) · Kolonie ${entry.colony_id} · ${entry.price_per_unit} Credits/Einheit · Handelssteuer ${Number(entry.trade_tax_rate) * 100}%`));
              cell.append(heading, details);
            } },
          { id: 'direction', label: 'Handelsrichtung', sortable: true,
            value: (entry) => entry.direction === 'buy' ? 'Kauf' : 'Verkauf',
            filter: {
              options: [{ value: 'buy', label: 'Käufe' }, { value: 'sell', label: 'Verkäufe' }],
              value: (entry) => entry.direction,
            } },
          { id: 'quantity', label: 'Menge', numeric: true, sortable: true, sortValue: (entry) => Number(entry.quantity) },
          { id: 'net_credits', label: 'Abgerechnete Credits', numeric: true, sortable: true,
            sortValue: (entry) => Number(entry.net_credits), value: (entry) => `${entry.net_credits} Credits abgerechnet` },
          { id: 'colony_id', label: 'Kolonie', numeric: true, sortable: true, sortValue: (entry) => Number(entry.colony_id) },
          { id: 'transacted_at', label: 'Zeitpunkt (Serverzeit)', sortable: true },
        ],
        items: state.data.transactions,
      });
      history.el.classList.add('game-market-history');
      history.el.dataset.gameTable = 'market-history';
      history.el.querySelector('.wm-table-result').setAttribute('aria-label', 'Historientreffer');
      history.el.querySelectorAll('tbody tr').forEach((row) => {
        const id = row.querySelector('[data-transaction-id]')?.dataset.transactionId;
        const entry = state.data.transactions.find((item) => String(item.id) === id);
        if (entry) {
          row.dataset.transactionId = id;
          row.dataset.direction = entry.direction;
        }
      });
    }
    const help = node('details');
    help.className = 'game-market-help';
    help.dataset.gameDisclosure = 'market-help';
    help.append(node('summary', 'Preise und Abrechnung'),
      node('p', 'Lokale Serverpreise sind Momentaufnahmen, keine verbindlichen Angebote. Steuern, Politik, Credits, Bestände und Lagergrenzen prüft der Server beim Handel. Lesen kauft und verkauft nichts; die On-Demand-Abrechnung kann bei der Preisabfrage erfolgen. Keine lokale Simulation.'));
    content.append(help);
    view.commit(root, content);
  }
  wm.register('trade', { title: 'Markt', w: 720, h: 560, onRender() { render(); void domain.load(); } });
  const unsubscribe = domain.subscribe(render);
  const unsubscribeColony = session.events.on('overview:updated', () => {
    const id = session.getColony()?.id ?? null;
    if (id !== lastColony) {
      lastColony = id;
      draft = { good_type: '', quantity: '' };
      validationError = '';
      if (wm.isOpen('trade')) void domain.load();
    }
    render();
  });
  const unsubscribeAccepted = session.events.on('colony:mutation-accepted', ({ domain: name, colonyId }) => {
    if (name === 'market' && Number(colonyId) === Number(lastColony)) {
      draft.quantity = '';
      validationError = '';
    }
    render();
  });
  const unsubscribeRequested = session.events.on('market:open-requested', ({ colonyId, goodType }) => {
    if (disposed) return;
    try {
      if (domain.getState().mutating) throw new Error('Handelsauftrag läuft. Markt danach erneut öffnen.');
      if (!goodType.trim()) throw new Error('Ein Handelsgut muss ausgewählt werden.');
      session.selectColony(colonyId);
      draft = { good_type: goodType, quantity: '' };
      searchQuery = '';
      validationError = '';
      wm.open('trade');
      render();
    } catch (error) {
      validationError = error.message;
      window.GQLog?.error?.('[market]', error.message);
      window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
      render();
    }
  });
  const open = (event) => {
    if (!disposed && event.target.closest?.('[data-game-market]')) wm.open('trade');
  };
  document.addEventListener('click', open);
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeColony();
    unsubscribeAccepted();
    unsubscribeRequested();
    document.removeEventListener('click', open);
    wm.close('trade');
    view.destroy();
    wm.register('trade', { onRender: null });
  };
}
import { createGameIcon, decorateGameAction } from './game-ui-visuals.js';
