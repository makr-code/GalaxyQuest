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

export function mountPopulationWindow({ session, domain, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  let disposed = false;
  let lastColony = session.getColony()?.id ?? null;
  function render() {
    const root = wm.body('population');
    if (disposed || !root) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const content = node('section');
    content.className = 'game-development';
    content.dataset.domain = 'population';
    content.append(node('h2', 'Bevölkerung und Versorgung'),
      node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'),
      button('Versorgung aktualisieren', () => { void domain.refresh(); }, busy || !colony));
    const status = node('p', state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', state.error ? 'alert' : 'status');
    content.append(status);
    if (state.error && state.data) content.append(node('p', 'Letzter bestätigter Stand. Versorgungsdaten vor weiteren Aktionen aktualisieren.'));
    if (state.data) {
      const { snapshot } = state.data;
      const { economy } = snapshot;
      content.append(
        node('p', `Serverstand: ${new Date(economy.settled_at * 1000).toLocaleString()} · Noch nachzuholen: ${quantity(economy.pending_seconds)} s`),
        node('p', `Bevölkerung: ${quantity(Object.values(snapshot.pop_classes).reduce((sum, count) => sum + count, 0))} · Kapazität: ${quantity(snapshot.colony.max_population)}`),
        node('p', `Zufriedenheit: ${quantity(economy.satisfaction)} · Bevölkerungswachstum/h: ${quantity(economy.population_growth_per_hour)}`),
        node('p', `Arbeitsplatzbesetzung: ${quantity(economy.employment === undefined ? undefined : economy.employment * 100)} %`),
      );
      const classes = node('ul');
      classes.setAttribute('aria-label', 'Bevölkerungsklassen');
      for (const [type, count] of Object.entries(snapshot.pop_classes)) classes.append(node('li', `${label(type)}: ${quantity(count)}`));
      content.append(node('h3', 'Bevölkerungsklassen'), classes, node('h3', 'Versorgungsengpässe'));
      const shortages = node('div');
      shortages.className = 'game-development-list';
      shortages.setAttribute('aria-label', 'Versorgungsengpässe');
      const entries = Object.entries(economy.shortages || {}).filter(([, amount]) => amount > 0);
      for (const [good, amount] of entries) {
        const card = node('article');
        card.className = 'game-development-card';
        card.dataset.good = good;
        const stock = Object.hasOwn(economy.stock, good) ? economy.stock[good] : undefined;
        card.append(node('h4', label(good)),
          node('p', `Fehlmenge/h: ${quantity(amount)} · Bestand: ${quantity(stock)} · Produktion/h: ${quantity(economy.production?.[good])} · Verbrauch/h: ${quantity(economy.consumption?.[good])}`),
          button(`${label(good)} im Markt öffnen`, () => {
            if (disposed || !colony) return;
            wm.minimize('population');
            session.events.emit('market:open-requested', { colonyId: Number(colony.id), goodType: good });
          }, busy || !!state.error || !colony));
        shortages.append(card);
      }
      content.append(shortages);
      if (economy.shortages === undefined) content.append(node('p', 'Keine Engpassmesswerte im Serverstand vorhanden.'));
      else if (!entries.length) content.append(node('p', 'Keine positiven Engpässe im letzten abgerechneten Zeitraum gemeldet.'));
    }
    const economy = node('button', 'Wirtschaft und Politik öffnen');
    economy.type = 'button';
    economy.className = 'btn btn-secondary btn-sm';
    economy.dataset.gameEconomy = '';
    economy.disabled = busy || !colony;
    economy.addEventListener('click', () => { wm.minimize('population'); });
    content.append(economy,
      node('p', 'Werte und Engpassraten stammen aus der letzten serverseitigen On-Demand-Abrechnung, nicht aus einer Prognose. Marktlinks wählen nur das Gut; Menge und Kauf müssen ausdrücklich bestätigt werden. Lohn-, Kultur- und Sicherheitsregler der alten Tick-Politik sind hier nicht aktiv.'));
    root.replaceChildren(content);
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
    wm.register('population', { onRender: null });
  };
}
