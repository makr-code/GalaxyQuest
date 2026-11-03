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

function costText(cost) {
  return Object.entries(cost).filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${value} ${key.replaceAll('_', ' ')}`).join(', ') || '0';
}

export function mountDevelopmentWindows({ session, domains, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  let disposed = false;
  let buildingSelection = null;
  let focusPending = false;
  const unsubscribers = [];
  function render(kind) {
    const root = wm.body(kind);
    if (!root || disposed) return;
    const state = domains[kind].getState();
    const colony = session.getColony();
    const content = node('section', undefined, 'game-development');
    content.dataset.domain = kind;
    content.append(node('h2', kind === 'buildings' ? 'Gebäude' : 'Forschung'));
    content.append(node('p', colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    const actions = node('div', undefined, 'game-development-actions');
    const busy = state.loading || state.mutating;
    actions.append(
      button('Aktualisieren', () => { void domains[kind].refresh(); }, busy || !colony),
      button('Fällige Aufträge abschließen', () => { void domains[kind].command('finish'); }, busy || !colony),
    );
    content.append(actions);
    if (kind === 'buildings' && buildingSelection) {
      actions.append(button('Gebäudeauswahl aufheben', () => {
        buildingSelection = null;
        focusPending = false;
        render(kind);
      }));
    }
    const status = node('p', state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', state.error ? 'alert' : 'status');
    content.append(status);
    if (state.data) {
      if (kind === 'buildings') {
        const queue = node('ul');
        queue.setAttribute('aria-label', 'Bauwarteschlange');
        for (const order of state.data.upgrade_queue) {
          queue.append(node('li', `${order.type.replaceAll('_', ' ')} → ${order.target_level} · ${order.status} · ${order.eta || 'wartet'}`));
        }
        content.append(node('h3', 'Bauwarteschlange'), queue);
      }
      const list = node('div', undefined, 'game-development-list');
      const researchBusy = kind === 'research' && state.data.research.some((entry) => entry.research_end);
      for (const entry of state.data[kind]) {
        const card = node('article', undefined, 'game-development-card');
        card.dataset.type = entry.type;
        const heading = node('h3', entry.meta?.label || entry.type.replaceAll('_', ' '));
        if (kind === 'buildings' && buildingSelection?.type === entry.type
            && Number(buildingSelection.colonyId) === Number(state.colonyId)) {
          card.setAttribute('aria-current', 'true');
          heading.tabIndex = -1;
        }
        card.append(heading);
        card.append(node('p', `Stufe ${entry.level} · Kosten für Stufe ${entry.level + 1}: ${costText(entry.next_cost)}`));
        const end = kind === 'buildings' ? entry.upgrade_end : entry.research_end;
        if (end) card.append(node('p', `Läuft bis ${end} (Serverzeit)`));
        for (const missing of entry.missing_prereqs || []) {
          card.append(node('p', `${missing.tech}: benötigt ${missing.required_level}, vorhanden ${missing.current_level}`));
        }
        card.append(button(kind === 'buildings' ? 'Ausbau beauftragen' : 'Forschung starten',
          () => { void domains[kind].command('start', entry.type); },
          busy || !colony || !!researchBusy || (kind === 'research' && entry.can_research !== true)));
        list.append(card);
      }
      content.append(list);
      if (kind === 'buildings' && buildingSelection && !busy
          && !state.data.buildings.some((entry) => entry.type === buildingSelection.type)) {
        const unavailable = node('p', 'Das ausgewählte Gebäude ist in dieser Kolonie nicht mehr verfügbar.');
        unavailable.setAttribute('role', 'status');
        content.append(unavailable);
        focusPending = false;
      }
    }
    content.append(node('p', 'Warteschlange und Boni können die Auftragspreise ändern. Kosten, Voraussetzungen und Laufzeiten prüft der Server. Öffnen und Aktualisieren senden keine Abschlussbefehle; fälligen Fortschritt kann der Server bei der On-Demand-Abrechnung übernehmen.'));
    root.replaceChildren(content);
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
      wm.register(kind, { onRender: null });
    }
  };
}
