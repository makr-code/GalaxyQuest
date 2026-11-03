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
  let disposed = false;
  let lastColony = session.getColony()?.id ?? null;
  let quantities = {};
  let validationError = '';
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
    const root = wm.body('shipyard');
    if (disposed || !root) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const locked = busy || state.stale || !state.data || !colony;
    const content = node('section');
    content.className = 'game-development';
    content.dataset.domain = 'shipyard';
    content.append(node('h2', 'Werft'),
      node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    const actions = node('div');
    actions.className = 'game-development-actions';
    actions.append(
      button('Werft aktualisieren', () => { validationError = ''; void domain.refresh(); }, busy || !colony),
      button('Fällige Schiffsbauten abschließen', () => { void command('finish'); }, locked),
      button('Flotte im Spielfeld zusammenstellen', () => {
        if (!colony || disposed) return;
        wm.minimize('shipyard');
        session.events.emit('fleet:origin-requested', { colonyId: Number(colony.id) });
      }, busy || !colony),
    );
    content.append(actions);
    const status = node('p', validationError || state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', validationError || state.error ? 'alert' : 'status');
    content.append(status);
    if (state.stale && state.data) content.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Befehlen aktualisieren.'));
    if (state.data) {
      const queue = node('ol');
      queue.setAttribute('aria-label', 'Schiffsbauwarteschlange');
      for (const order of state.data.queue) {
        queue.append(node('li', `${order.position}: ${order.quantity} ${order.label || order.ship_type.replaceAll('_', ' ')} · ${order.status === 'running' ? 'im Bau' : 'wartet'} · ${order.eta ? `${order.eta} (Serverzeit)` : 'Start ausstehend'}`));
      }
      content.append(node('h3', 'Schiffsbauwarteschlange'), queue);
      if (!state.data.queue.length) content.append(node('p', 'Keine laufenden Schiffsbauten.'));
      const list = node('div');
      list.className = 'game-development-list';
      for (const ship of state.data.ships) {
        const label = ship.name || ship.type.replaceAll('_', ' ');
        const card = node('article');
        card.className = 'game-development-card';
        card.dataset.shipType = ship.type;
        card.append(node('h3', label), node('p', `Verfügbar: ${ship.count}${ship.id != null ? ' · Bauplan' : ''}`),
          node('p', `Basiskosten je Schiff: ${Object.entries(ship.cost).map(([key, amount]) => `${amount} ${key.replaceAll('_', ' ')}`).join(', ') || '0'}`));
        const form = node('form');
        const fields = node('fieldset');
        fields.disabled = locked;
        const wrapper = node('label', 'Menge ');
        const input = node('input');
        input.type = 'number';
        input.min = '1';
        input.step = '1';
        input.required = true;
        input.value = quantities[ship.type] ?? '1';
        input.setAttribute('aria-label', `Baumenge ${label}`);
        input.addEventListener('input', () => { quantities[ship.type] = input.value; });
        wrapper.append(input);
        const submit = node('button', 'Schiffe bauen');
        submit.type = 'submit';
        submit.className = 'btn btn-primary btn-sm';
        fields.append(wrapper, submit);
        form.append(fields);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          if (disposed || domain.getState().mutating || !form.reportValidity()) return;
          void command('build', { type: ship.type, count: input.value });
        });
        card.append(form);
        list.append(card);
      }
      content.append(list);
    }
    content.append(node('p', 'Basiskosten sind keine Preiszusage: Kolonieboni, Voraussetzungen und Laufzeit prüft der Server. Öffnen und Aktualisieren verarbeiten keine Schiffsbauten. Abschluss erfolgt ausdrücklich oder bei einer serverseitigen On-Demand-Mutation; kein lokaler Timer.'));
    root.replaceChildren(content);
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
    wm.register('shipyard', { onRender: null });
  };
}
