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
  let standingDraft = { side: 'sell', good_type: '', quantity: '', limit_price: '' };
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
      const events = Array.isArray(state.data.events) ? state.data.events : [];
      if (events.length) {
        const worldEvents = node('section');
        worldEvents.className = 'game-market-world-events';
        worldEvents.setAttribute('aria-label', 'Aktive Weltereignisse');
        worldEvents.append(node('h3', 'Weltereignisse'));
        const list = node('ul');
        for (const event of events) {
          const scope = event.system ? `System ${event.galaxy}:${event.system}` : `Galaxie ${event.galaxy}`;
          const good = event.good_type ? ` · ${event.good_type.replaceAll('_', ' ')}` : '';
          const ends = new Date(Number(event.ends_at) * 1000).toLocaleString('de-DE');
          list.append(node('li', `${event.label} (${scope}${good}) · bis ${ends}`));
        }
        worldEvents.append(list);
        content.append(worldEvents);
      }
      const form = node('form');
      form.setAttribute('aria-label', 'Marktübersicht');
      const fields = node('fieldset');
      fields.className = 'game-market-ticket';
      fields.append(node('legend', 'Unverbindliche Marktübersicht'));
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
      catalogue.setAttribute('aria-label', 'Warenauswahl; unverbindliche Richtpreise');
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
          node('span', `Richtpreis ${entry.price} Credits/Einheit`));
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
        for (const [label, value] of [['Bestand', stock], ['Richtpreis', `${entry.price} Credits/Einheit`]]) {
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
      fields.append(info);
      const orderNote = node('p', 'Richtpreise garantieren weder Angebot noch Lieferung. Erstelle unten einen verbindlich finanzierten Auftrag; Waren reisen mit Transportschiffen.');
      orderNote.className = 'game-market-order-note';
      fields.append(orderNote);
      const catalogueFields = node('fieldset');
      catalogueFields.className = 'game-market-catalogue';
      catalogueFields.disabled = fields.disabled;
      catalogueFields.append(node('legend', 'Warenauswahl'), catalogue);
      form.append(catalogueFields, fields);
      form.addEventListener('submit', (event) => event.preventDefault());
      content.append(tools, result, empty, form);
      const requests = node('section');
      requests.className = 'game-market-economic-requests';
      requests.setAttribute('aria-label', 'Freiwillige Wirtschafts-Anfragen');
      requests.append(node('h3', 'Freiwillige Wirtschafts-Anfragen'),
        node('p', 'Ohne Antwort: kostenfreier Verfall, keine Reservierung, keine Strafe. NPCs handeln unabhängig weiter.'),
        node('p', 'Ware liefern: Annehmen reserviert die angezeigte Ware. NPC-Überschuss kaufen: Annehmen reserviert den angezeigten maximalen Gesamtbetrag in Credits. Der endliche NPC-Bestand wird bei Annahme erneut geprüft. Keine sofortige Lieferung: normale Händler erfüllen später, ohne garantierten Liefertermin. Keine zusätzliche Handelssteuer. Stornieren des Auftrags löst nur die noch nicht zugeteilte Paarung; gestartete Lieferungen bleiben verbindlich.'));
      const requestStatuses = { pending: 'Offen', accepted: 'Bestätigt', declined: 'Abgelehnt', expired: 'Abgelaufen', unavailable: 'Nicht verfügbar' };
      for (const request of state.data.requests ?? []) {
        const card = node('article');
        card.id = `economy-request-${request.id}`;
        const status = request.status === 'pending' && state.requestNow >= Number(request.expires_at)
          ? 'expired' : request.status;
        const purchase = request.type === 'purchase';
        card.append(node('h4', `${purchase ? 'NPC-Überschuss kaufen' : 'Ware liefern'} #${request.id}`),
          node('p', `${purchase ? 'Kaufe' : 'Liefere'} ${request.quantity} Einheiten ${request.good_type.replaceAll('_', ' ')} · ${(Number(request.price_cents) / 100).toFixed(2)} Credits/Einheit · ${purchase ? 'maximal' : 'insgesamt'} ${(Number(request.total_cents) / 100).toFixed(2)} Credits`),
          node('p', `Frist: ${new Date(Number(request.expires_at) * 1000).toLocaleString('de-DE')} · ${requestStatuses[status]}`));
        if (status === 'accepted') {
          card.append(node('p', `Bestätigter Auftrag #${request.player_order.id} · ${request.player_order.status} · noch nicht zugeteilt: ${request.player_order.quantity_remaining}. Reservierung bestätigt, keine automatische Wiederholung.`));
        }
        if (status === 'pending') {
          for (const [action, label] of [['accept_request', purchase ? 'Annehmen und Credits reservieren' : 'Annehmen und Waren reservieren'], ['decline_request', 'Kostenfrei ablehnen']]) {
            const button = node('button', label);
            button.type = 'button';
            button.className = 'btn btn-secondary btn-sm';
            button.dataset.economyRequestAction = action;
            button.dataset.expiresAt = String(request.expires_at);
            button.disabled = busy || state.stale || !colony;
            button.addEventListener('click', async () => {
              const current = domain.getState();
              if (disposed || current.loading || current.mutating || current.stale) return;
              validationError = '';
              try {
                await domain.command(action, { request_id: request.id });
              } catch (error) {
                if (disposed || error.name === 'AbortError') return;
                validationError = error.message;
              }
              if (!disposed) render();
            });
            card.append(button);
          }
        }
        requests.append(card);
      }
      if (!(state.data.requests ?? []).length) requests.append(node('p', 'Keine Wirtschafts-Anfragen für diese Kolonie.'));
      content.append(requests);
      const standing = node('section');
      standing.className = 'game-market-standing-orders';
      standing.setAttribute('aria-label', 'Freiwillige NPC-Handelsaufträge');
      standing.append(node('h3', 'Freiwillige NPC-Handelsaufträge'),
        node('p', 'Ohne Auftrag handeln NPCs nicht mit deiner Kolonie. Kauf: Menge × Limitpreis wird sofort als Guthaben reserviert. Verkauf: Waren werden sofort aus dem verfügbaren Bestand reserviert. Lieferung und Bezahlung erfolgen verzögert über Händlerrouten.'),
        node('p', 'Stornieren gibt nur noch nicht zugeteilte Waren bzw. Credits zurück. Bei einer bestätigten Wirtschafts-Anfrage wird die restliche NPC-Paarung ebenfalls freigegeben. Bereits gestartete Lieferungen und ihr Kaufguthaben bleiben verbindlich. Keine automatische Verlängerung, keine zusätzliche Handelssteuer.'));
      const standingForm = node('form');
      standingForm.setAttribute('aria-label', 'NPC-Auftrag erstellen');
      const standingFields = node('fieldset');
      standingFields.disabled = busy || state.stale || !colony;
      standingFields.append(node('legend', 'Endlicher NPC-Auftrag'));
      const side = node('select');
      side.setAttribute('aria-label', 'NPC-Auftragsseite');
      for (const [value, label] of [['sell', 'Verkaufen'], ['buy', 'Kaufen']]) {
        const option = node('option', label);
        option.value = value;
        side.append(option);
      }
      side.value = standingDraft.side;
      side.addEventListener('change', () => { standingDraft.side = side.value; });
      view.widget('field', standingFields, { label: 'Auftragsseite', control: side });
      const standingGood = node('select');
      standingGood.setAttribute('aria-label', 'NPC-Auftragsware');
      for (const entry of state.data.prices) {
        const option = node('option', entry.good_type.replaceAll('_', ' '));
        option.value = entry.good_type;
        standingGood.append(option);
      }
      if (!state.data.prices.some(entry => entry.good_type === standingDraft.good_type)) {
        standingDraft.good_type = state.data.prices[0].good_type;
      }
      standingGood.value = standingDraft.good_type;
      standingGood.addEventListener('change', () => { standingDraft.good_type = standingGood.value; });
      view.widget('field', standingFields, { label: 'Auftragsware', control: standingGood });
      for (const [key, label, minimum, maximum, step, help] of [
        ['quantity', 'NPC-Auftragsmenge', '1', '1000000', '1', 'Ganze Einheiten; höchstens 1000000.'],
        ['limit_price', 'NPC-Limitpreis', '0.01', '1000000', '0.01', 'Credits pro Einheit. Verkauf zum Angebotspreis; Kauf zum zugesagten Limitpreis.'],
      ]) {
        const input = node('input');
        input.type = 'number';
        input.min = minimum;
        input.max = maximum;
        input.step = step;
        input.required = true;
        input.value = standingDraft[key];
        input.setAttribute('aria-label', label);
        input.addEventListener('input', () => { standingDraft[key] = input.value; });
        view.widget('field', standingFields, { label, control: input, help });
      }
      const create = node('button', 'Verbindlich reservieren');
      create.type = 'submit';
      create.className = 'btn btn-primary btn-sm';
      standingFields.append(create);
      standingForm.append(standingFields);
      standingForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const current = domain.getState();
        if (disposed || current.loading || current.mutating || current.stale || !standingForm.reportValidity()) return;
        validationError = '';
        try {
          await domain.command('create_order', { ...standingDraft });
        } catch (error) {
          if (disposed || error.name === 'AbortError') return;
          validationError = error.message;
        }
        if (!disposed) render();
      });
      standing.append(standingForm);
      const standingList = node('ul');
      for (const order of state.data.orders ?? []) {
        const entry = node('li');
        const status = { active: 'Aktiv', filled: 'Vollständig zugeteilt', cancelled: 'Storniert' }[order.status];
        entry.append(node('span', `#${order.id} · ${order.side === 'buy' ? 'Kauf' : 'Verkauf'} · ${order.good_type.replaceAll('_', ' ')} · offen ${order.quantity_remaining}/${order.quantity_initial} · Limit ${Number(order.limit_price_cents) / 100} Credits · reserviertes Guthaben ${Number(order.escrow_cents) / 100} Credits · ${status}`));
        if (order.status === 'active') {
          const cancel = node('button', 'Stornieren');
          cancel.type = 'button';
          cancel.className = 'btn btn-secondary btn-sm';
          cancel.setAttribute('aria-label', `NPC-Auftrag ${order.id} stornieren`);
          cancel.disabled = busy || state.stale || !colony;
          cancel.addEventListener('click', async () => {
            const current = domain.getState();
            if (disposed || current.loading || current.mutating || current.stale) return;
            validationError = '';
            try {
              await domain.command('cancel_order', { order_id: order.id });
            } catch (error) {
              if (disposed || error.name === 'AbortError') return;
              validationError = error.message;
            }
            if (!disposed) render();
          });
          entry.append(cancel);
        }
        standingList.append(entry);
      }
      standing.append((state.data.orders ?? []).length ? standingList : node('p', 'Keine NPC-Aufträge. Automatischer Handel ist deaktiviert.'));
      content.append(standing, node('h3', 'Frühere Kontotransaktionen (nur lesbar)'));
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
      node('p', 'Lokale Serverpreise sind unverbindliche Richtwerte, keine garantierten Angebote. Aufträge reservieren Waren oder Kaufguthaben; Erfüllung erfolgt später durch Transportschiffe. Keine lokale Handelssimulation.'));
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
      standingDraft = { side: 'sell', good_type: '', quantity: '', limit_price: '' };
      validationError = '';
      if (wm.isOpen('trade')) void domain.load();
    }
    render();
  });
  const unsubscribeAccepted = session.events.on('colony:mutation-accepted', ({ domain: name, colonyId }) => {
    if (name === 'market' && Number(colonyId) === Number(lastColony)) {
      draft.quantity = '';
      standingDraft.quantity = '';
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
  const openRequest = () => {
    const match = /^#economy-request-([1-9]\d*)-colony-([1-9]\d*)$/.exec(window.location.hash);
    if (!match || disposed || domain.getState().mutating) return;
    try {
      session.selectColony(Number(match[2]));
      wm.open('trade');
    } catch (error) {
      validationError = error.message;
      render();
    }
  };
  window.addEventListener('hashchange', openRequest);
  openRequest();
  // Disable elapsed invitations without replacing the ticket or stealing focus.
  const deadlineTimer = window.setInterval(() => {
    const state = domain.getState();
    wm.body('trade')?.querySelectorAll('[data-economy-request-action]').forEach(button => {
      if (state.requestNow >= Number(button.dataset.expiresAt)) {
        button.disabled = true;
        button.title = 'Anfrage abgelaufen. Markt aktualisieren.';
      }
    });
  }, 1000);
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeColony();
    unsubscribeAccepted();
    unsubscribeRequested();
    document.removeEventListener('click', open);
    window.removeEventListener('hashchange', openRequest);
    window.clearInterval(deadlineTimer);
    wm.close('trade');
    view.destroy();
    wm.register('trade', { onRender: null });
  };
}
import { createGameIcon, decorateGameAction } from './game-ui-visuals.js';
