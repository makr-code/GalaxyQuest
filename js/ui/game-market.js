function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountMarketWindow({ session, domain, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  let disposed = false;
  let lastColony = session.getColony()?.id ?? null;
  let draft = { good_type: '', quantity: '' };
  let validationError = '';
  function render() {
    const root = wm.body('trade');
    if (disposed || !root) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const content = node('section');
    content.className = 'game-development game-market';
    content.dataset.domain = 'market';
    content.append(node('h2', 'Markt'),
      node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    const refresh = node('button', 'Markt aktualisieren');
    refresh.type = 'button';
    refresh.className = 'btn btn-secondary btn-sm';
    refresh.disabled = busy || !colony;
    refresh.addEventListener('click', () => { validationError = ''; void domain.refresh(); });
    const status = node('p', validationError || state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', validationError || state.error ? 'alert' : 'status');
    content.append(refresh, status);
    if (state.stale && state.data) content.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Handelsbefehlen aktualisieren.'));
    if (state.data) {
      const form = node('form');
      form.setAttribute('aria-label', 'Markthandel');
      const fields = node('fieldset');
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
      const info = node('p');
      function updateInfo() {
        const entry = state.data.prices.find((item) => item.good_type === goods.value);
        if (!entry) {
          info.textContent = 'Kein bestätigter Marktpreis für dieses Gut.';
          return;
        }
        const stock = Object.hasOwn(state.data.stock, goods.value) ? state.data.stock[goods.value] : '—';
        info.textContent = `Bestand: ${stock} · Marktpreis: ${entry.price} Credits/Einheit · Angebot: ${entry.supply} · Nachfrage: ${entry.demand}`;
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
      fields.append(goods, info, quantity);
      for (const [action, label] of [['buy', 'Kaufen'], ['sell', 'Verkaufen']]) {
        const submit = node('button', label);
        submit.type = 'submit';
        submit.value = action;
        submit.className = 'btn btn-primary btn-sm';
        submit.disabled = !available;
        fields.append(submit);
      }
      form.append(fields);
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
      content.append(form, node('h3', 'Letzte 20 Kontotransaktionen'));
      const history = node('ol');
      history.setAttribute('aria-label', 'Handelshistorie');
      for (const entry of state.data.transactions) {
        history.append(node('li', `${entry.transacted_at} (Serverzeit) · Kolonie ${entry.colony_id} · ${entry.direction === 'buy' ? 'Kauf' : 'Verkauf'}: ${entry.quantity} ${entry.good_type.replaceAll('_', ' ')} · ${entry.price_per_unit} Credits/Einheit · ${entry.net_credits} Credits abgerechnet · Handelssteuer ${Number(entry.trade_tax_rate) * 100}%`));
      }
      if (!state.data.transactions.length) content.append(node('p', 'Keine bisherigen Markttransaktionen.'));
      content.append(history);
    }
    content.append(node('p', 'Lokale Serverpreise sind Momentaufnahmen, keine verbindlichen Angebote. Steuern, Politik, Credits, Bestände und Lagergrenzen prüft der Server beim Handel. Lesen kauft und verkauft nichts; die On-Demand-Abrechnung kann bei der Preisabfrage erfolgen. Keine lokale Simulation.'));
    root.replaceChildren(content);
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
    wm.register('trade', { onRender: null });
  };
}
