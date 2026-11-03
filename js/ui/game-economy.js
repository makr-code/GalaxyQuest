import { ECONOMY_METHODS, ECONOMY_POLICIES, ECONOMY_SUBSIDIES, ECONOMY_TAXES } from '../engine/runtime/server-economy-domain.js';

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
  let disposed = false;
  let lastColonyId = session.getColony()?.id ?? null;
  let selectedResource = '';
  let focusResource = false;
  function selectResource(good) {
    selectedResource = good;
    focusResource = true;
    render();
  }
  function render() {
    const root = wm.body('economy');
    if (!root || disposed) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const content = node('section', undefined, 'game-development game-economy');
    content.dataset.domain = 'economy';
    content.append(node('h2', 'Wirtschaft'));
    content.append(node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    const refresh = node('button', 'Aktualisieren', 'btn btn-secondary btn-sm');
    refresh.type = 'button';
    refresh.disabled = busy || !colony;
    refresh.addEventListener('click', () => { void domain.refresh(); });
    const status = node('p', state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', state.error ? 'alert' : 'status');
    content.append(refresh, status);
    if (state.error && state.data) content.append(node('p', 'Letzter bestätigter Stand. Ressourcendaten vor weiteren Aktionen aktualisieren.'));
    const market = node('button', 'Markt öffnen', 'btn btn-secondary btn-sm');
    market.type = 'button';
    market.dataset.gameMarket = '';
    market.disabled = busy || !colony;
    market.addEventListener('click', () => { wm.minimize('economy'); });
    content.append(market);
    const population = node('button', 'Bevölkerung und Versorgung öffnen', 'btn btn-secondary btn-sm');
    population.type = 'button';
    population.dataset.gamePopulation = '';
    population.disabled = busy || !colony;
    population.addEventListener('click', () => { wm.minimize('economy'); });
    content.append(population);
    if (selectedResource) {
      const detail = node('section', undefined, 'game-development-card');
      detail.dataset.resourceDetail = selectedResource;
      detail.setAttribute('aria-label', 'Ressourcendetails');
      const heading = node('h3', selectedResource === 'energy' ? 'Energie' : label(selectedResource));
      heading.tabIndex = -1;
      detail.append(heading);
      if (state.data) {
        const { snapshot } = state.data;
        if (selectedResource === 'energy') {
          detail.append(node('p', `Energie: ${quantity(snapshot.colony.energy)}`),
            node('p', 'Serverseitige Energiebilanz, kein lagerbares Handelsgut.'));
        } else {
          const measured = Object.hasOwn(snapshot.economy.stock, selectedResource);
          detail.append(node('p', measured
            ? `Bestand: ${quantity(snapshot.economy.stock[selectedResource])} · Kapazität: ${quantity(snapshot.storage[selectedResource])} · Produktion/h: ${quantity(snapshot.economy.production?.[selectedResource])} · Verbrauch/h: ${quantity(snapshot.economy.consumption?.[selectedResource])}`
            : 'Kein Bestandsmesswert für diese Ressource im Serverstand vorhanden.'));
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
    function setting(title, control, submit) {
      const form = node('form', undefined, 'game-economy-setting');
      const fieldset = node('fieldset');
      fieldset.disabled = busy || !colony;
      const save = node('button', 'Speichern', 'btn btn-secondary btn-sm');
      save.type = 'submit';
      save.setAttribute('aria-label', `${title} speichern`);
      fieldset.append(node('legend', title), control, save);
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
      content.append(node('p', `Serverstand: ${new Date(economy.settled_at * 1000).toLocaleString()} · Noch nachzuholen: ${quantity(economy.pending_seconds)} s`));
      content.append(node('h3', 'Bestände und zuletzt abgerechnete Raten'));
      const table = node('table', undefined, 'game-economy-stock');
      table.setAttribute('aria-label', 'Wirtschaftsbestände');
      const header = node('tr');
      for (const title of ['Gut', 'Bestand', 'Kapazität', 'Produktion/h', 'Verbrauch/h']) {
        const cell = node('th', title);
        cell.scope = 'col';
        header.append(cell);
      }
      const head = node('thead');
      head.append(header);
      table.append(head);
      const body = node('tbody');
      for (const [good, stock] of Object.entries(economy.stock)) {
        const row = node('tr');
        row.dataset.good = good;
        if (good === selectedResource) row.setAttribute('aria-current', 'true');
        const name = node('th');
        name.scope = 'row';
        const inspect = node('button', label(good), 'btn btn-secondary btn-sm');
        inspect.type = 'button';
        inspect.setAttribute('aria-label', `${label(good)} Bestandsdetails`);
        inspect.addEventListener('click', () => selectResource(good));
        name.append(inspect);
        row.append(name);
        for (const value of [stock, snapshot.storage[good], economy.production?.[good], economy.consumption?.[good]]) {
          row.append(node('td', quantity(value)));
        }
        body.append(row);
      }
      table.append(body);
      const scroll = node('div', undefined, 'game-economy-table');
      scroll.append(table);
      content.append(scroll);
      content.append(node('p', `Zufriedenheit: ${quantity(economy.satisfaction)} · Energie: ${quantity(snapshot.colony.energy)} · Bevölkerungswachstum/h: ${quantity(economy.population_growth_per_hour)}`));
      const classes = node('ul');
      classes.setAttribute('aria-label', 'Bevölkerungsklassen');
      for (const [key, count] of Object.entries(snapshot.pop_classes)) classes.append(node('li', `${label(key)}: ${quantity(count)}`));
      content.append(classes);
      const shortages = node('ul');
      shortages.setAttribute('aria-label', 'Versorgungsengpässe');
      for (const [key, amount] of Object.entries(economy.shortages || {})) {
        shortages.append(node('li', `${label(key)}: ${quantity(amount)}/h fehlen`));
      }
      content.append(node('h3', 'Versorgungsengpässe'), shortages);
      content.append(node('h3', 'Imperiumsweite Politik, Steuern und Subventionen'));
      content.append(node('p', 'Diese Einstellungen gelten für alle eigenen Kolonien.'));
      const policySelect = select(ECONOMY_POLICIES, policy.global_policy, 'Wirtschaftspolitik');
      content.append(setting('Wirtschaftspolitik', policySelect, () => domain.command('policy', policySelect.value)));
      for (const [type, config] of Object.entries(ECONOMY_TAXES)) {
        const input = node('input');
        input.type = 'number';
        input.min = '0';
        input.max = String(config.max);
        input.step = String(policy.tax_steps[type] * 100);
        input.required = true;
        input.value = String(Number((policy.taxes[type] * 100).toFixed(2)));
        input.setAttribute('aria-label', `${config.label} (%)`);
        content.append(setting(`${config.label} (%)`, input, () =>
          domain.command('tax', { type, rate: input.valueAsNumber / 100 })));
      }
      for (const [sector, title] of Object.entries(ECONOMY_SUBSIDIES)) {
        const control = select({ false: 'Aus', true: 'An' }, String(policy.subsidies[sector]), `Subvention ${title}`);
        content.append(setting(`Subvention ${title}`, control, () =>
          domain.command('subsidy', { sector, enabled: control.value === 'true' })));
      }
      content.append(node('h3', 'Produktionsmethoden dieser Kolonie'));
      let processingCount = 0;
      for (const entry of snapshot.buildings) {
        const recipe = snapshot.catalog[entry.type];
        if (!recipe || entry.level < 1) continue;
        processingCount++;
        const card = node('article', undefined, 'game-development-card');
        card.dataset.building = entry.type;
        card.append(node('h4', `${recipe.label} · Stufe ${entry.level}`));
        card.append(node('p', `${Object.entries(recipe.inputs).map(([key, amount]) => `${quantity(amount)} ${label(key)}`).join(' + ')} → ${label(recipe.good)}`));
        card.append(node('p', `Forschung: ${recipe.research}. Freischaltung, Boni und Ressourcen prüft der Server.`));
        const method = select(ECONOMY_METHODS, snapshot.methods[entry.type], `${recipe.label} Methode`);
        card.append(setting(`${recipe.label} Methode`, method, () =>
          domain.command('method', { building_type: entry.type, method: method.value })));
        content.append(card);
      }
      if (!processingCount) content.append(node('p', 'Keine aktiven Verarbeitungsgebäude auf dieser Kolonie.'));
      content.append(node('p', 'Raten stammen aus dem letzten serverseitig abgerechneten Zeitraum, nicht aus einer lokalen Prognose. Fehlende Messwerte werden als — angezeigt. Fortschritt wird nur bei Anfragen auf dem Server abgerechnet.'));
    }
    root.replaceChildren(content);
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
    wm.register('economy', { onRender: null });
  };
}
