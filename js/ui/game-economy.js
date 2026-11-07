import { ECONOMY_METHODS, ECONOMY_POLICIES, ECONOMY_SUBSIDIES, ECONOMY_TAXES } from '../engine/runtime/server-economy-domain.js';
import { createEconomyResourceCards } from './game-economy-visuals.js';
import { createGameIcon } from './game-ui-visuals.js';
import { createGameWindowView } from './game-window-view.js';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function select(options, value, label) {
  const control = node('select');
  control.setAttribute('aria-label', label);
  for (const [key, text] of Object.entries(options)) {
    const option = node('option', text);
    option.value = key;
    control.append(option);
  }
  control.value = value;
  return control;
}

const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const quantity = (value) => typeof value === 'number' && Number.isFinite(value) ? format.format(value) : '\u2014';
const label = (key) => key.replaceAll('_', ' ');

export function mountEconomyWindow({ session, domain, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  const view = createGameWindowView(wm, 'economy');
  let disposed = false;
  let lastColonyId = session.getColony()?.id ?? null;
  let selectedResource = '';
  let focusResource = false;
  let resourceQuery = '';
  let balanceFilter = 'all';
  let tableState = { query: '', filters: {}, sort: null };
  function selectResource(good) {
    selectedResource = good;
    focusResource = true;
    render();
  }
  function render() {
    if (!wm.body('economy') || disposed) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const root = view.begin({ ...state, colony, busy });
    const content = node('section', undefined, 'game-development game-economy');
    content.dataset.domain = 'economy';
    const header = node('header', undefined, 'game-economy-header');
    const title = node('h2', 'Wirtschaft');
    title.prepend(createGameIcon('economy'));
    header.append(title, node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    content.append(header);
    const refresh = node('button', 'Aktualisieren', 'btn btn-secondary btn-sm');
    refresh.type = 'button';
    refresh.disabled = busy || !colony;
    refresh.addEventListener('click', () => { void domain.refresh(); });
    content.append(refresh);
    view.status(content, { ...state, colony, busy });
    if (state.error && state.data) content.append(node('p', 'Letzter bestätigter Stand. Ressourcendaten vor weiteren Aktionen aktualisieren.'));
    const market = node('button', 'Markt öffnen', 'btn btn-secondary btn-sm');
    market.type = 'button';
    market.dataset.gameMarket = '';
    market.disabled = busy || !colony;
    market.addEventListener('click', () => { wm.minimize('economy'); });
    const population = node('button', 'Bevölkerung und Versorgung öffnen', 'btn btn-secondary btn-sm');
    population.type = 'button';
    population.dataset.gamePopulation = '';
    population.disabled = busy || !colony;
    population.addEventListener('click', () => { wm.minimize('economy'); });
    market.prepend(createGameIcon('trade'));
    population.prepend(createGameIcon('population'));
    const navigation = node('nav', undefined, 'game-economy-navigation');
    navigation.setAttribute('aria-label', 'Verwandte Kolonieverwaltung');
    navigation.append(market, population);
    content.append(navigation);
    if (selectedResource) {
      const detail = node('section', undefined, 'game-development-card game-resource-detail');
      detail.dataset.resourceDetail = selectedResource;
      detail.setAttribute('aria-label', 'Ressourcendetails');
      const heading = node('h3', selectedResource === 'energy' ? 'Energie' : label(selectedResource));
      heading.tabIndex = -1;
      const title = node('header', undefined, 'game-development-card-heading');
      title.append(createGameIcon(selectedResource), heading);
      detail.append(title);
      function metric(title, value) {
        const card = node('div', undefined, 'game-resource-metric');
        card.append(node('span', `${title}: `), node('strong',
          typeof value === 'number' && Number.isFinite(value) ? quantity(value) : 'Nicht verfügbar'));
        return card;
      }
      if (state.data) {
        const { snapshot } = state.data;
        if (selectedResource === 'energy') {
          detail.append(node('p', `Energie: ${quantity(snapshot.colony.energy)}`),
            node('p', 'Serverseitige Energiebilanz, kein lagerbares Handelsgut.'));
        } else {
          const measured = Object.hasOwn(snapshot.economy.stock, selectedResource);
          if (!measured) detail.append(node('p', 'Kein Bestandsmesswert für diese Ressource im Serverstand vorhanden.'));
          const metrics = node('div', undefined, 'game-resource-detail-metrics');
          metrics.setAttribute('role', 'group');
          metrics.setAttribute('aria-label', 'Bestätigte Ressourcenmesswerte');
          metrics.append(
            metric('Bestand', snapshot.economy.stock[selectedResource]),
            metric('Kapazität', snapshot.storage[selectedResource]),
            metric('Produktion/h', snapshot.economy.production?.[selectedResource]),
            metric('Verbrauch/h', snapshot.economy.consumption?.[selectedResource]),
          );
          detail.append(metrics, node('p', 'Letzter bestätigter Serverstand, keine Prognose.'));
          const trade = node('button', `${label(selectedResource)} im Markt öffnen`, 'btn btn-secondary btn-sm');
          trade.type = 'button';
          trade.disabled = busy || !!state.error || !colony;
          trade.addEventListener('click', () => {
            if (disposed || !colony) return;
            wm.minimize('economy');
            session.events.emit('market:open-requested', { colonyId: Number(colony.id), goodType: selectedResource });
          });
          detail.append(trade);
        }
      }
      const clear = node('button', 'Ressourcenauswahl aufheben', 'btn btn-secondary btn-sm');
      clear.type = 'button';
      clear.addEventListener('click', () => { selectedResource = ''; focusResource = false; render(); });
      detail.append(clear);
      content.append(detail);
    }
    function setting(title, control, submit, presentation) {
      const form = node('form', undefined, 'game-economy-setting');
      const fieldset = node('fieldset');
      fieldset.disabled = busy || !colony;
      const save = node('button', 'Speichern', 'btn btn-secondary btn-sm');
      save.type = 'submit';
      save.setAttribute('aria-label', `${title} speichern`);
      const legend = node('legend', title);
      fieldset.append(legend);
      if (presentation) {
        form.classList.add('game-economy-policy-card');
        legend.prepend(createGameIcon(presentation.icon));
        fieldset.append(node('p', `Bestätigt: ${presentation.value}`, 'game-economy-confirmed'));
        if (presentation.percent !== undefined) {
          const meter = node('meter');
          meter.min = 0;
          meter.max = 100;
          meter.value = presentation.percent;
          meter.setAttribute('aria-label', `${title}: bestätigter Anteil auf Skala 0 bis 100 Prozent`);
          fieldset.append(meter);
        }
        fieldset.append(node('span', 'Änderung erst nach Speichern', 'game-economy-setting-note'));
      }
      fieldset.append(control, save);
      form.append(fieldset);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity() || busy) return;
        void submit();
      });
      return form;
    }
    if (state.data) {
      const { snapshot, policy } = state.data;
      const economy = snapshot.economy;
      content.append(node('p', `Serverstand: ${new Date(economy.settled_at * 1000).toLocaleString()} · Noch nachzuholen: ${quantity(economy.pending_seconds)} s`,
        'game-economy-serverstand'));
      const resources = node('section', undefined, 'game-economy-workspace-section');
      resources.setAttribute('aria-label', 'Kolonieressourcen');
      resources.append(node('h3', 'Bestände und zuletzt abgerechnete Raten'));
      content.append(resources);
      const cards = createEconomyResourceCards(snapshot, { selectedResource, onInspect: selectResource });
      const tools = node('section', undefined, 'game-development-filters');
      tools.setAttribute('aria-label', 'Ressourcenübersicht filtern');
      const searchLabel = node('label', 'Ressourcen suchen ');
      const search = node('input');
      search.type = 'search';
      search.value = resourceQuery;
      search.setAttribute('aria-label', 'Ressourcen suchen');
      searchLabel.append(search);
      const filterLabel = node('label', 'Stundenbilanz ');
      const filter = select({ all: 'Alle Ressourcen', deficit: 'Negative Bilanz', unknown: 'Bilanz unbekannt' },
        balanceFilter, 'Stundenbilanz filtern');
      filterLabel.append(filter);
      const result = node('p');
      result.setAttribute('role', 'status');
      result.setAttribute('aria-label', 'Ressourcentreffer');
      const empty = node('p', 'Keine passenden Ressourcen im geladenen Bestandskatalog.');
      const reset = node('button', 'Ressourcenfilter zurücksetzen', 'btn btn-secondary btn-sm');
      reset.type = 'button';
      function applyResourceFilters() {
        if (disposed) return;
        const query = resourceQuery.trim().toLocaleLowerCase().replaceAll('_', ' ');
        const entries = cards.querySelectorAll('[data-resource-card]');
        let visible = 0;
        for (const card of entries) {
          const good = card.dataset.resourceCard;
          const production = economy.production?.[good];
          const consumption = economy.consumption?.[good];
          const known = typeof production === 'number' && Number.isFinite(production)
            && typeof consumption === 'number' && Number.isFinite(consumption);
          const text = `${good} ${card.querySelector('button').textContent}`.toLocaleLowerCase().replaceAll('_', ' ');
          card.hidden = !text.includes(query) || (balanceFilter === 'unknown' && known)
            || (balanceFilter === 'deficit' && (!known || production >= consumption));
          if (!card.hidden) visible++;
        }
        result.textContent = `${visible} von ${entries.length} Ressourcen angezeigt.`;
        empty.hidden = visible > 0;
        reset.disabled = !resourceQuery && balanceFilter === 'all';
      }
      search.addEventListener('input', () => {
        if (disposed) return;
        resourceQuery = search.value;
        applyResourceFilters();
      });
      filter.addEventListener('change', () => {
        if (disposed) return;
        balanceFilter = filter.value;
        applyResourceFilters();
      });
      reset.addEventListener('click', () => {
        if (disposed) return;
        resourceQuery = search.value = '';
        balanceFilter = filter.value = 'all';
        applyResourceFilters();
        search.focus({ preventScroll: true });
      });
      applyResourceFilters();
      tools.append(searchLabel, filterLabel, reset);
      resources.append(tools, result, empty, cards);
      const measurements = node('details');
      measurements.className = 'game-economy-measurements';
      measurements.dataset.gameDisclosure = 'economy-measurements';
      measurements.append(node('summary', 'Messwerte als Tabelle'));
      const entries = Object.entries(economy.stock).map(([good, stock]) => ({
        good, stock, capacity: snapshot.storage[good],
        production: economy.production?.[good], consumption: economy.consumption?.[good],
      }));
      const table = view.widget('dataTable', measurements, {
        caption: 'Wirtschaftsbestände', emptyText: 'Keine Bestandsmesswerte im Serverstand.',
        searchable: true, state: tableState,
        onStateChange: (next) => { tableState = next; },
        labels: {
          toolbar: 'Werkzeuge der Bestandstabelle',
          clearSearch: 'Tabellensuche leeren', removeFilter: (column, value) => `Filter entfernen: ${column}: ${value}`,
          ascending: 'aufsteigend', descending: 'absteigend', clearSort: 'Sortierung aufheben',
          sort: (column, direction) => `${column}: ${direction}`,
          nextSort: (column, direction) => `${column} ${direction} sortieren`,
          search: 'Bestandstabelle durchsuchen', reset: 'Tabellenansicht zurücksetzen', all: 'Alle Bestände',
          noMatches: 'Keine Bestandsmesswerte für diese Suche und Filter.',
          results: (visible, total) => `${visible} von ${total} Bestandsmesswerten angezeigt.`,
        },
        columns: [
          { id: 'good', label: 'Gut', rowHeader: true, sortable: true, sortValue: (entry) => label(entry.good), render(cell, entry) {
            const inspect = node('button', label(entry.good), 'btn btn-secondary btn-sm');
            inspect.type = 'button';
            inspect.dataset.tableGood = entry.good;
            inspect.setAttribute('aria-label', `${label(entry.good)} Bestandsdetails`);
            inspect.addEventListener('click', () => selectResource(entry.good));
            cell.append(inspect);
          } },
          ...[['stock', 'Bestand'], ['capacity', 'Kapazität'], ['production', 'Produktion/h'], ['consumption', 'Verbrauch/h']]
            .map(([id, title]) => ({
              id, label: title, numeric: true, sortable: true,
              sortValue: (entry) => entry[id], value: (entry) => quantity(entry[id]),
              ...(id === 'stock' ? { filter: {
                label: 'Tabellenbestand filtern',
                options: [
                  { value: 'positive', label: 'Bestand größer als 0' },
                  { value: 'zero', label: 'Bestand gleich 0' },
                  { value: 'negative', label: 'Bestand kleiner als 0' },
                  { value: 'unknown', label: 'Bestand unbekannt' },
                ],
                value: (entry) => !Number.isFinite(entry.stock) ? 'unknown'
                  : entry.stock > 0 ? 'positive' : entry.stock < 0 ? 'negative' : 'zero',
              } } : {}),
            })),
        ],
        items: entries,
      });
      table.el.classList.add('game-economy-table');
      table.el.dataset.gameTable = 'economy-stock';
      table.el.querySelector('table').classList.add('game-economy-stock');
      table.el.querySelectorAll('tbody tr').forEach((row) => {
        const good = row.querySelector('[data-table-good]')?.dataset.tableGood;
        if (!good) return;
        row.dataset.good = good;
        if (good === selectedResource) row.setAttribute('aria-current', 'true');
      });
      resources.append(measurements);
      const society = node('details', undefined, 'game-economy-society');
      society.append(node('summary', 'Weitere Bevölkerungs- und Versorgungsmesswerte'),
        node('p', `Zufriedenheit: ${quantity(economy.satisfaction)} · Energie: ${quantity(snapshot.colony.energy)} · Bevölkerungswachstum/h: ${quantity(economy.population_growth_per_hour)}`));
      const classes = node('ul');
      classes.setAttribute('aria-label', 'Bevölkerungsklassen');
      for (const [key, count] of Object.entries(snapshot.pop_classes)) classes.append(node('li', `${label(key)}: ${quantity(count)}`));
      society.append(classes);
      const shortages = node('ul');
      shortages.setAttribute('aria-label', 'Versorgungsengpässe');
      for (const [key, amount] of Object.entries(economy.shortages || {})) {
        shortages.append(node('li', `${label(key)}: ${quantity(amount)}/h fehlen`));
      }
      society.append(node('h3', 'Versorgungsengpässe'), shortages);
      resources.append(society);
      const governance = node('section', undefined, 'game-economy-workspace-section game-economy-governance');
      governance.setAttribute('aria-label', 'Imperiumssteuerung');
      const governanceTitle = node('h3', 'Imperiumsweite Politik, Steuern und Subventionen');
      governanceTitle.prepend(createGameIcon('trade'));
      governance.append(governanceTitle, node('p', 'Diese Einstellungen gelten für alle eigenen Kolonien.', 'game-economy-scope'));
      const policies = node('div', undefined, 'game-economy-policy-grid');
      const policySelect = select(ECONOMY_POLICIES, policy.global_policy, 'Wirtschaftspolitik');
      policies.append(setting('Wirtschaftspolitik', policySelect, () => domain.command('policy', policySelect.value),
        { icon: 'economy', value: ECONOMY_POLICIES[policy.global_policy] }));
      for (const [type, config] of Object.entries(ECONOMY_TAXES)) {
        const input = node('input');
        input.type = 'number';
        input.min = '0';
        input.max = String(config.max);
        input.step = String(policy.tax_steps[type] * 100);
        input.required = true;
        input.value = String(Number((policy.taxes[type] * 100).toFixed(2)));
        input.setAttribute('aria-label', `${config.label} (%)`);
        policies.append(setting(`${config.label} (%)`, input, () =>
          domain.command('tax', { type, rate: input.valueAsNumber / 100 }),
        { icon: 'trade', value: `${quantity(policy.taxes[type] * 100)} %`, percent: policy.taxes[type] * 100 }));
      }
      for (const [sector, title] of Object.entries(ECONOMY_SUBSIDIES)) {
        const control = select({ false: 'Aus', true: 'An' }, String(policy.subsidies[sector]), `Subvention ${title}`);
        policies.append(setting(`Subvention ${title}`, control, () =>
          domain.command('subsidy', { sector, enabled: control.value === 'true' }),
        { icon: { agriculture: 'food', research: 'research', military: 'fleet' }[sector],
          value: policy.subsidies[sector] ? 'An' : 'Aus' }));
      }
      governance.append(policies);
      content.append(governance);
      const production = node('section', undefined, 'game-economy-workspace-section');
      production.setAttribute('aria-label', 'Kolonieproduktion');
      const productionTitle = node('h3', 'Produktionsmethoden dieser Kolonie');
      productionTitle.prepend(createGameIcon('buildings'));
      production.append(productionTitle, node('p', 'Gilt für die ausgewählte Kolonie.', 'game-economy-scope'));
      content.append(production);
      const processing = node('div', undefined, 'game-production-catalog');
      let processingCount = 0;
      for (const entry of snapshot.buildings) {
        const recipe = snapshot.catalog[entry.type];
        if (!recipe || entry.level < 1) continue;
        processingCount++;
        const card = node('article', undefined, 'game-development-card game-production-card');
        card.dataset.building = entry.type;
        const heading = node('header', undefined, 'game-development-card-heading');
        heading.append(createGameIcon('buildings'), node('h4', recipe.label),
          node('span', `Stufe ${entry.level}`, 'game-development-level'));
        const flow = node('div', undefined, 'game-production-flow');
        flow.setAttribute('role', 'group');
        flow.setAttribute('aria-label', 'Rezept: Eingänge und Erzeugnis');
        const inputs = node('ul', undefined, 'game-development-costs game-production-inputs');
        inputs.setAttribute('aria-label', 'Rezept-Eingänge');
        for (const [key, amount] of Object.entries(recipe.inputs)) {
          const item = node('li');
          item.append(createGameIcon(key), node('span', `${quantity(amount)} ${label(key)}`));
          inputs.append(item);
        }
        if (!inputs.children.length) inputs.append(node('li', 'Keine Rezept-Eingänge'));
        const arrow = node('span', '→', 'game-production-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        const output = node('div', undefined, 'game-production-output');
        output.append(createGameIcon(recipe.good), node('span', 'Erzeugnis'), node('strong', label(recipe.good)));
        flow.append(inputs, arrow, output);
        card.append(heading, flow,
          node('p', 'Rezeptangaben aus dem Serverkatalog, keine aktuelle Stundenrate oder Produktionsprognose.'));
        card.append(node('p', `Forschung: ${recipe.research}. Freischaltung, Boni und Ressourcen prüft der Server.`));
        const method = select(ECONOMY_METHODS, snapshot.methods[entry.type], `${recipe.label} Methode`);
        card.append(setting(`${recipe.label} Methode`, method, () =>
          domain.command('method', { building_type: entry.type, method: method.value })));
        processing.append(card);
      }
      production.append(processing);
      if (!processingCount) production.append(node('p', 'Keine aktiven Verarbeitungsgebäude auf dieser Kolonie.'));
      const help = node('details', undefined, 'game-economy-help');
      help.append(node('summary', 'Messwerte und Abrechnung'),
        node('p', 'Raten stammen aus dem letzten serverseitig abgerechneten Zeitraum, nicht aus einer lokalen Prognose. Fehlende Messwerte werden als — angezeigt. Fortschritt wird nur bei Anfragen auf dem Server abgerechnet.'));
      content.append(help);
    }
    view.commit(root, content);
    if (focusResource && !busy && wm.isOpen('economy')) {
      const heading = root.querySelector('[data-resource-detail] h3');
      if (heading) {
        focusResource = false;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      }
    }
  }
  wm.register('economy', {
    title: 'Wirtschaft', w: 760, h: 580,
    onRender() { void domain.load(); render(); },
  });
  const unsubscribe = domain.subscribe(render);
  const unsubscribeMarket = session.events.on('colony:mutation-accepted', ({ domain: name, colonyId }) => {
    if (name === 'market' && Number(colonyId) === Number(session.getColony()?.id) && wm.isOpen('economy')) void domain.load();
  });
  const unsubscribeColony = session.events.on('overview:updated', () => {
    const id = session.getColony()?.id ?? null;
    if (id === lastColonyId) return;
    lastColonyId = id;
    selectedResource = '';
    focusResource = false;
    render();
    if (wm.isOpen('economy')) void domain.load();
  });
  const open = (event) => {
    if (disposed) return;
    const resource = event.target.closest?.('#resource-section [data-resource]')?.dataset.resource;
    if (['metal', 'crystal', 'deuterium', 'food', 'rare_earth', 'energy'].includes(resource)) {
      selectedResource = resource;
      focusResource = true;
      wm.open('economy');
      render();
    } else if (event.target.closest?.('[data-game-economy]')) {
      selectedResource = '';
      focusResource = false;
      wm.open('economy');
      render();
    }
  };
  document.addEventListener('click', open);
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeMarket();
    unsubscribeColony();
    document.removeEventListener('click', open);
    wm.close('economy');
    view.destroy();
    wm.register('economy', { onRender: null });
  };
}
