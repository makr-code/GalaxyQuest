import { createGameIcon } from './game-ui-visuals.js';
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

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const quantity = (value) => typeof value === 'number' && Number.isFinite(value) ? format.format(value) : '—';
const label = (value) => value.replaceAll('_', ' ');

function metric(icon, text, value, maximum = null) {
  const card = node('article');
  card.className = 'game-population-metric';
  card.append(createGameIcon(icon), node('strong', text));
  if (Number.isFinite(value) && Number.isFinite(maximum) && maximum > 0) {
    const meter = node('meter');
    meter.min = 0;
    meter.max = maximum;
    meter.value = Math.max(0, Math.min(maximum, value));
    meter.setAttribute('aria-label', text);
    card.append(meter);
  }
  return card;
}

export function mountPopulationWindow({ session, domain, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  const view = createGameWindowView(wm, 'population');
  let disposed = false;
  let lastColony = session.getColony()?.id ?? null;
  let classTableState = { query: '', filters: {}, sort: null };
  function render() {
    if (disposed || !wm.body('population')) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const root = view.begin({ ...state, colony, busy });
    const content = node('section');
    content.className = 'game-development game-population';
    content.dataset.domain = 'population';
    const header = node('header');
    header.className = 'game-population-header';
    const heading = node('h2', 'Bevölkerung und Versorgung');
    heading.prepend(createGameIcon('population'));
    header.append(heading,
      node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    content.append(header, button('Versorgung aktualisieren', () => { void domain.refresh(); }, busy || !colony));
    view.status(content, { ...state, colony, busy });
    if (state.error && state.data) content.append(node('p', 'Letzter bestätigter Stand. Versorgungsdaten vor weiteren Aktionen aktualisieren.'));
    if (state.data) {
      const { snapshot } = state.data;
      const { economy } = snapshot;
      const timestamp = node('p', `Serverstand: ${new Date(economy.settled_at * 1000).toLocaleString()} · Noch nachzuholen: ${quantity(economy.pending_seconds)} s`);
      timestamp.className = 'game-population-serverstand';
      content.append(timestamp);
      const total = Object.values(snapshot.pop_classes).reduce((sum, count) => sum + count, 0);
      const metrics = node('section');
      metrics.className = 'game-population-metrics';
      metrics.setAttribute('aria-label', 'Bevölkerungskennzahlen');
      const population = metric('population', `Bevölkerung: ${quantity(total)} · Kapazität: ${quantity(snapshot.colony.max_population)}`,
        total, snapshot.colony.max_population);
      if (Number.isFinite(snapshot.colony.max_population) && total > snapshot.colony.max_population) {
        population.append(node('span', 'Über Bevölkerungskapazität'));
        population.classList.add('game-population-deficit');
      }
      const growth = metric('growth', `Bevölkerungswachstum/h: ${quantity(economy.population_growth_per_hour)}`);
      if (economy.population_growth_per_hour < 0) growth.classList.add('game-population-deficit');
      metrics.append(population,
        metric('happiness', `Zufriedenheit: ${quantity(economy.satisfaction)}`, economy.satisfaction, 100),
        metric('employment', `Arbeitsplatzbesetzung: ${quantity(economy.employment === undefined ? undefined : economy.employment * 100)} %`, economy.employment, 1),
        growth);
      const overview = node('section');
      overview.className = 'game-population-overview';
      overview.setAttribute('aria-label', 'Koloniegesellschaft');
      overview.append(node('h3', 'Koloniegesellschaft'), metrics);
      content.append(overview);
      const classes = node('ul');
      classes.setAttribute('aria-label', 'Bevölkerungsklassen');
      classes.className = 'game-population-distribution';
      for (const [type, count] of Object.entries(snapshot.pop_classes)) {
        const row = node('li');
        row.dataset.populationClass = type;
        const percent = total > 0 ? count / total * 100 : 0;
        row.append(node('span', `${label(type)}: ${quantity(count)}`), node('span', `${quantity(percent)} %`));
        const track = node('span');
        track.className = 'game-population-track';
        track.setAttribute('aria-hidden', 'true');
        const bar = node('span');
        bar.style.width = `${percent}%`;
        track.append(bar);
        row.append(track);
        classes.append(row);
      }
      if (!Object.keys(snapshot.pop_classes).length) classes.append(node('li', 'Keine Bevölkerungsklassen gemeldet.'));
      const distribution = node('section');
      distribution.className = 'game-population-classes';
      distribution.append(node('h3', 'Bevölkerungsklassen'), classes);
      const measurements = node('details');
      measurements.className = 'game-population-class-measurements';
      measurements.dataset.gameDisclosure = 'population-classes';
      measurements.append(node('summary', 'Bevölkerungsklassen als Tabelle'),
        node('p', 'Anteile beziehen sich auf die gesamte gemeldete Koloniebevölkerung, auch bei aktiven Filtern.'));
      const table = view.widget('dataTable', measurements, {
        caption: 'Bevölkerungsklassen · letzter Serverstand',
        searchable: true, state: classTableState,
        onStateChange: (next) => { classTableState = next; },
        emptyText: 'Keine Bevölkerungsklassen gemeldet.',
        labels: {
          toolbar: 'Werkzeuge der Bevölkerungstabelle',
          clearSearch: 'Tabellensuche leeren', removeFilter: (column, value) => `Filter entfernen: ${column}: ${value}`,
          ascending: 'aufsteigend', descending: 'absteigend', clearSort: 'Sortierung aufheben',
          sort: (column, direction) => `${column}: ${direction}`,
          nextSort: (column, direction) => `${column} ${direction} sortieren`,
          search: 'Bevölkerungsklassen durchsuchen', reset: 'Klassenfilter zurücksetzen', all: 'Alle Klassen',
          noMatches: 'Keine Bevölkerungsklassen für diese Suche und Filter.',
          results: (visible, total) => `${visible} von ${total} Bevölkerungsklassen angezeigt.`,
        },
        columns: [
          { id: 'type', label: 'Klasse', rowHeader: true, sortable: true,
            value: (entry) => label(entry.type), searchValue: (entry) => `${entry.type} ${label(entry.type)}` },
          { id: 'count', label: 'Einwohner', numeric: true, sortable: true,
            value: (entry) => quantity(entry.count), sortValue: (entry) => entry.count,
            filter: {
              label: 'Klassenbelegung',
              options: [{ value: 'populated', label: 'Mit Einwohnern' }, { value: 'empty', label: 'Ohne Einwohner' }],
              value: (entry) => entry.count > 0 ? 'populated' : 'empty',
            } },
          { id: 'share', label: 'Anteil (%)', numeric: true, sortable: true,
            value: (entry) => quantity(entry.share), sortValue: (entry) => entry.share },
        ],
        items: Object.entries(snapshot.pop_classes).map(([type, count]) => ({
          type, count, share: total > 0 ? count / total * 100 : 0,
        })),
      });
      table.el.classList.add('game-population-class-table');
      table.el.dataset.gameTable = 'population-classes';
      distribution.append(measurements);
      overview.append(distribution);
      const supply = node('section');
      supply.className = 'game-population-supply';
      supply.setAttribute('aria-label', 'Versorgungslage');
      const supplyHeading = node('h3', 'Versorgungsengpässe');
      supplyHeading.prepend(createGameIcon('goods'));
      supply.append(supplyHeading);
      const shortages = node('div');
      shortages.className = 'game-development-list';
      shortages.setAttribute('aria-label', 'Versorgungsengpässe');
      const entries = Object.entries(economy.shortages || {}).filter(([, amount]) => amount > 0);
      for (const [good, amount] of entries) {
        const card = node('article');
        card.className = 'game-development-card game-population-shortage';
        card.dataset.good = good;
        const stock = Object.hasOwn(economy.stock, good) ? economy.stock[good] : undefined;
        const heading = node('h4');
        heading.append(createGameIcon(good), node('span', label(good)));
        const deficit = node('p');
        deficit.className = 'game-population-gap';
        deficit.append(createGameIcon('warning'), node('strong', `Fehlmenge/h: ${quantity(amount)}`));
        const measurements = view.widget('properties', card, {
          items: [
            ['stock', 'Bestand', stock],
            ['production', 'Produktion/h', economy.production?.[good]],
            ['consumption', 'Verbrauch/h', economy.consumption?.[good]],
          ].map(([id, label, value]) => ({
            id, label, value: typeof value === 'number' && Number.isFinite(value) ? quantity(value) : 'Nicht verfügbar',
          })),
        }).el;
        measurements.classList.add('game-supply-measurements');
        const trade = button(`${label(good)} im Markt öffnen`, () => {
            if (disposed || !colony) return;
            wm.minimize('population');
            session.events.emit('market:open-requested', { colonyId: Number(colony.id), goodType: good });
          }, busy || !!state.error || !colony);
        trade.prepend(createGameIcon('trade'));
        card.append(heading, deficit, measurements, trade);
        shortages.append(card);
      }
      supply.append(shortages);
      if (economy.shortages === undefined) view.widget('notice', supply, {
        state: 'info', title: 'Keine Engpassmesswerte im Serverstand vorhanden.',
      });
      else if (!entries.length) view.widget('notice', supply, {
        state: 'empty', title: 'Keine positiven Engpässe im letzten abgerechneten Zeitraum gemeldet.',
      });
      content.append(supply);
    }
    const economy = node('button', 'Wirtschaft und Politik öffnen');
    economy.type = 'button';
    economy.className = 'btn btn-secondary btn-sm';
    economy.dataset.gameEconomy = '';
    economy.disabled = busy || !colony;
    economy.addEventListener('click', () => { wm.minimize('population'); });
    economy.prepend(createGameIcon('economy'));
    const footer = node('div');
    footer.className = 'game-population-footer';
    const help = node('details');
    help.className = 'game-population-help';
    help.dataset.gameDisclosure = 'population-help';
    help.append(node('summary', 'Messwerte und Versorgung'),
      node('p', 'Werte und Engpassraten stammen aus der letzten serverseitigen On-Demand-Abrechnung, nicht aus einer Prognose. Marktlinks wählen nur das Gut; Menge und Kauf müssen ausdrücklich bestätigt werden. Lohn-, Kultur- und Sicherheitsregler der alten Tick-Politik sind hier nicht aktiv.'));
    footer.append(economy, help);
    content.append(footer);
    view.commit(root, content);
  }
  wm.register('population', { title: 'Bevölkerung und Versorgung', w: 680, h: 540,
    onRender() { render(); void domain.load(); } });
  const unsubscribe = domain.subscribe(render);
  const unsubscribeColony = session.events.on('overview:updated', () => {
    const id = session.getColony()?.id ?? null;
    if (id !== lastColony) {
      lastColony = id;
      if (wm.isOpen('population')) void domain.load();
    }
    render();
  });
  const unsubscribeMutation = session.events.on('colony:mutation-accepted', ({ colonyId, allColonies, domain: name }) => {
    if (name !== 'economy' && (allColonies || Number(colonyId) === Number(lastColony))
      && wm.isOpen('population') && !wm.isOpen('economy')) void domain.load();
  });
  const unsubscribeOpen = session.events.on('population:open-requested', ({ colonyId }) => {
    session.selectColony(colonyId);
    wm.open('population');
  });
  const open = (event) => {
    if (!disposed && event.target.closest?.('[data-game-population], [data-resource="population"], [data-resource="happiness"]')) wm.open('population');
  };
  document.addEventListener('click', open);
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeColony();
    unsubscribeMutation();
    unsubscribeOpen();
    document.removeEventListener('click', open);
    wm.close('population');
    view.destroy();
    wm.register('population', { onRender: null });
  };
}
