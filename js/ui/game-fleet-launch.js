import { FLEET_MISSIONS, FLEET_TRANSITS } from '../engine/runtime/server-fleet-launch-domain.js';

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountFleetCommandOverlay({ domain, fleets, session }) {
  const stage = document.getElementById('wm-galaxy-section');
  if (!stage) throw new Error('Das Galaxie-Spielfeld fehlt.');
  const root = node('section');
  root.id = 'game-fleet-command';
  root.setAttribute('aria-label', 'Flottensteuerung');
  root.tabIndex = -1;
  root.hidden = true;
  stage.append(root);
  let disposed = false;
  let picking = false;
  let coordinatesOpen = false;
  let draft = emptyDraft();
  let lastColony = session.getColony()?.id ?? null;
  let validationError = '';
  let handoffNotice = '';
  function emptyDraft() {
    return { mission: 'transport', target_galaxy: '', target_system: '', target_position: '',
      ships: {}, cargo: { metal: '0', crystal: '0', deuterium: '0' } };
  }
  function setPicking(active) {
    picking = active;
    root.dataset.picking = String(active);
    session.events.emit('fleet:target-picking', { active });
  }
  function close() {
    if (disposed || domain.getState().mutating) return;
    setPicking(false);
    root.hidden = true;
    document.getElementById('starfield')?.focus({ preventScroll: true });
  }
  function open() {
    if (disposed || !canChangeOrder()) return;
    root.hidden = false;
    void domain.load();
    render();
    root.focus({ preventScroll: true });
  }
  function canChangeOrder() {
    if (!domain.getState().mutating) return true;
    handoffNotice = 'Flottenbefehl wird verarbeitet. Herkunft und Ziel können erst danach geändert werden.';
    render();
    root.focus({ preventScroll: true });
    return false;
  }
  function render() {
    if (disposed) return;
    const state = domain.getState();
    const colony = session.getColony();
    const busy = state.loading || state.mutating;
    const content = node('section');
    content.className = 'game-development';
    content.dataset.domain = 'fleet-launch';
    const header = node('div');
    header.className = 'game-development-actions';
    const closeButton = node('button', 'Flottensteuerung schließen');
    closeButton.type = 'button';
    closeButton.className = 'btn btn-secondary btn-sm';
    closeButton.disabled = state.mutating;
    closeButton.addEventListener('click', close);
    header.append(node('h2', 'Flotte im Spielfeld steuern'), closeButton);
    content.append(header,
      node('p', colony ? `Herkunft: ${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.'));
    const pick = node('button', picking ? 'Zielwahl abbrechen' : 'Ziel im Spielfeld wählen');
    pick.type = 'button';
    pick.className = 'btn btn-secondary btn-sm';
    pick.disabled = busy || !colony;
    pick.setAttribute('aria-pressed', String(picking));
    pick.addEventListener('click', () => {
      if (disposed || domain.getState().mutating) return;
      setPicking(!picking);
      render();
      if (!picking) root.focus({ preventScroll: true });
    });
    content.append(pick);
    const target = draft.target_system
      ? `Ziel [${draft.target_galaxy}:${draft.target_system}:${draft.target_position}]`
      : 'Noch kein Ziel gewählt.';
    const targetStatus = node('p', picking ? 'Zielwahl: Sternsystem anklicken, dann Zielplanet anklicken. Es wird noch kein Befehl gesendet.' : target);
    targetStatus.setAttribute('role', 'status');
    content.append(targetStatus);
    if (picking) {
      root.replaceChildren(content);
      return;
    }
    const refresh = node('button', 'Schiffsbestand aktualisieren');
    refresh.type = 'button';
    refresh.className = 'btn btn-secondary btn-sm';
    refresh.disabled = busy || !colony;
    refresh.addEventListener('click', () => { if (!disposed) { validationError = ''; void domain.refresh(); } });
    content.append(refresh);
    const shipyard = node('button', 'Werft öffnen');
    shipyard.type = 'button';
    shipyard.className = 'btn btn-secondary btn-sm';
    shipyard.disabled = busy || !colony;
    shipyard.addEventListener('click', () => {
      if (disposed || domain.getState().mutating || !colony) return;
      close();
      session.events.emit('shipyard:open-requested', { colonyId: Number(colony.id) });
    });
    content.append(shipyard);
    const notice = state.mutating ? handoffNotice : '';
    const status = node('p', validationError || state.error || notice || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', validationError || state.error || notice ? 'alert' : 'status');
    content.append(status);
    if (state.data?.transit) {
      const transit = state.data.transit;
      const [label, description] = FLEET_TRANSITS[transit.ftl_drive_type];
      const info = node('section');
      info.setAttribute('aria-label', 'Spezies- und Fraktionstransit');
      info.append(node('h3', label), node('p', description),
        node('p', transit.ftl_ready ? 'Serverstatus: keine globale Antriebsaufladung.'
          : `Serverstatus: Aufladung · ${transit.ftl_cooldown_remaining_s} s verbleibend (letzte Abfrage).`),
        node('p', 'Routenfreigabe, lokale Knotenaufladung, Reichweite und tatsächliche Ankunft prüft der Server beim Befehl. Keine lokale Flugzeitprognose.'));
      content.append(info);
    }
    const form = node('form');
    form.setAttribute('aria-label', 'Flottenstart');
    const fields = node('fieldset');
    fields.disabled = busy || !colony;
    function number(label, value, set, { min = 0, max, step = '1', container = fields, required = true } = {}) {
      const wrapper = node('label', `${label} `);
      const input = node('input');
      input.type = 'number';
      input.required = required;
      input.min = String(min);
      if (max !== undefined) input.max = String(max);
      input.step = step;
      input.value = String(value);
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => set(input.value));
      wrapper.append(input);
      container.append(wrapper);
    }
    const missionLabel = node('label', 'Mission ');
    const mission = node('select');
    mission.setAttribute('aria-label', 'Mission');
    for (const [value, label] of Object.entries(FLEET_MISSIONS)) {
      const option = node('option', label);
      option.value = value;
      mission.append(option);
    }
    mission.value = draft.mission;
    mission.addEventListener('change', () => { draft.mission = mission.value; });
    missionLabel.append(mission);
    fields.append(missionLabel);
    const coordinates = node('details');
    coordinates.open = coordinatesOpen;
    coordinates.append(node('summary', 'Zielkoordinaten (Tastaturalternative)'));
    coordinates.addEventListener('toggle', () => { coordinatesOpen = coordinates.open; });
    number('Zielgalaxie', draft.target_galaxy, (value) => { draft.target_galaxy = value; },
      { min: 1, max: 9, container: coordinates, required: false });
    number('Zielsystem', draft.target_system, (value) => { draft.target_system = value; },
      { min: 1, container: coordinates, required: false });
    number('Zielposition', draft.target_position, (value) => { draft.target_position = value; },
      { min: 1, container: coordinates, required: false });
    fields.append(coordinates);
    fields.append(node('h3', 'Verfügbare Schiffe'));
    if (state.stale) fields.append(node('p', 'Bestand aktualisieren, bevor eine weitere Flotte zusammengestellt wird.'));
    if (state.data?.ships.length === 0) fields.append(node('p', 'Keine verfügbaren Schiffe auf dieser Kolonie.'));
    for (const ship of state.data?.ships || []) {
      number(`${ship.name || ship.type.replaceAll('_', ' ')} (${ship.count} verfügbar)`, draft.ships[ship.type] || '0',
        (value) => { draft.ships = { ...draft.ships, [ship.type]: value }; }, { max: Number(ship.count) });
    }
    fields.append(node('h3', 'Fracht'));
    for (const [key, label] of Object.entries({ metal: 'Metall', crystal: 'Kristall', deuterium: 'Deuterium' })) {
      number(`Fracht ${label}`, draft.cargo[key], (value) => { draft.cargo[key] = value; }, { step: 'any' });
    }
    const submit = node('button', 'Flotte serverseitig starten');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.disabled = busy || !state.data?.ships.length || state.stale || !colony;
    fields.append(submit);
    form.append(fields);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (disposed || state.loading || state.mutating || !form.reportValidity()) return;
      validationError = '';
      handoffNotice = '';
      try {
        await domain.command('send', { ...draft, cargo: { ...draft.cargo },
          ships: Object.fromEntries(Object.entries(draft.ships).filter(([, value]) => Number(value) !== 0)) });
      } catch (error) {
        if (disposed || error.name === 'AbortError') return;
        validationError = error.message;
        if (!draft.target_galaxy || !draft.target_system || !draft.target_position) coordinatesOpen = true;
        window.GQLog?.error?.('[fleet-launch]', error.message);
        window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
      }
      if (!disposed) render();
    });
    content.append(form, node('p', 'Transit gemäß serverseitigem Spezies-/Fraktionsantrieb, kein generischer Standardflug. Kein manueller Wurmloch-Override. Öffnen, Zielwahl und Aktualisieren starten keine Mission.'));
    root.replaceChildren(content);
  }
  const unsubscribe = domain.subscribe(render);
  const unsubscribeColony = session.events.on('overview:updated', () => {
    const id = session.getColony()?.id ?? null;
    if (id === lastColony) return;
    lastColony = id;
    draft = emptyDraft();
    validationError = '';
    setPicking(false);
    if (!root.hidden) void domain.load();
    render();
  });
  const unsubscribeAccepted = session.events.on('colony:mutation-accepted', ({ domain: name, colonyId }) => {
    if (['shipyard', 'fleets'].includes(name)) {
      if (!root.hidden && !domain.getState().mutating && domain.getState().stale) void domain.load();
      return;
    }
    if (name !== 'fleet-launch') return;
    setPicking(false);
    if (Number(colonyId) === Number(lastColony)) {
      draft.ships = {};
      draft.cargo = { metal: '0', crystal: '0', deuterium: '0' };
    }
    void fleets.load();
  });
  const unsubscribeTarget = session.events.on('fleet:target-requested', ({ galaxy, system, position }) => {
    if (!canChangeOrder()) return;
    draft.target_galaxy = String(galaxy);
    draft.target_system = String(system);
    draft.target_position = String(position);
    validationError = '';
    setPicking(false);
    open();
  });
  const unsubscribeOrigin = session.events.on('fleet:origin-requested', ({ colonyId }) => {
    if (!canChangeOrder()) return;
    session.selectColony(colonyId);
    setPicking(false);
    open();
  });
  const openClick = (event) => {
    if (!disposed && event.target.closest?.('[data-game-fleet-launch]')) open();
  };
  const escape = (event) => {
    if (event.key !== 'Escape' || root.hidden || disposed || (!picking && !root.contains(event.target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (picking) { setPicking(false); render(); root.focus({ preventScroll: true }); }
    else close();
  };
  document.addEventListener('click', openClick);
  window.addEventListener('keydown', escape, true);
  return () => {
    setPicking(false);
    disposed = true;
    unsubscribe();
    unsubscribeColony();
    unsubscribeAccepted();
    unsubscribeTarget();
    unsubscribeOrigin();
    document.removeEventListener('click', openClick);
    window.removeEventListener('keydown', escape, true);
    root.remove();
  };
}
