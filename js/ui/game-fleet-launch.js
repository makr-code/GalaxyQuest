import { FLEET_MISSIONS, FLEET_MISSION_DESCRIPTIONS, FLEET_TRANSITS } from '../engine/runtime/server-fleet-launch-domain.js';
import { createGameIcon, createFleetMissionBadge } from './game-ui-visuals.js';

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
  let pickingKind = 'target';
  let coordinatesOpen = false;
  let transitDetailsOpen = false;
  let shipSearch = '';
  let selectedOnly = false;
  let draft = emptyDraft();
  let lastColony = session.getColony()?.id ?? null;
  let preserveRouteOnColonyChange = false;
  let validationError = '';
  let handoffNotice = '';
  function emptyDraft() {
    return { mission: 'transport', target_galaxy: '', target_system: '', target_position: '',
      target_name: '', ships: {}, cargo: { metal: '0', crystal: '0', deuterium: '0' } };
  }
  function setPicking(active, kind = 'target') {
    if (picking && (!active || pickingKind !== kind)) {
      session.events.emit(`fleet:${pickingKind}-picking`, { active: false });
    }
    picking = active;
    if (active) pickingKind = kind;
    root.dataset.picking = String(active);
    if (active) session.events.emit(`fleet:${pickingKind}-picking`, { active: true });
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
  function focusPickerControl(kind) {
    const label = kind === 'origin' ? 'Flottenherkunft im 3D-Spielfeld ändern'
      : hasTarget() ? 'Flottenziel im 3D-Spielfeld ändern' : 'Flottenziel im 3D-Spielfeld wählen';
    (root.querySelector(`[aria-label="${label}"]`) || root).focus({ preventScroll: true });
  }
  function hasTarget() {
    return [draft.target_galaxy, draft.target_system, draft.target_position]
      .every((value) => String(value).trim() !== '');
  }
  function hasPartialTarget() {
    return [draft.target_galaxy, draft.target_system, draft.target_position]
      .some((value) => String(value).trim() !== '');
  }
  function hasValidTarget() {
    const galaxy = Number(draft.target_galaxy);
    const system = Number(draft.target_system);
    const position = Number(draft.target_position);
    return [draft.target_galaxy, draft.target_system, draft.target_position]
      .every((value) => String(value).trim() !== '')
      && Number.isSafeInteger(galaxy) && galaxy >= 1 && galaxy <= 9
      && Number.isSafeInteger(system) && system >= 1
      && Number.isSafeInteger(position) && position >= 1;
  }
  function hasSelectedShip() {
    return (domain.getState().data?.ships || []).some((ship) => {
      const raw = draft.ships[ship.type] ?? '0';
      const count = Number(raw);
      return String(raw).trim() !== '' && Number.isSafeInteger(count)
        && count > 0 && count <= Number(ship.count);
    });
  }
  function hasValidShipComposition() {
    return (domain.getState().data?.ships || []).every((ship) => {
      const raw = draft.ships[ship.type] ?? '0';
      const count = Number(raw);
      return String(raw).trim() !== '' && Number.isSafeInteger(count)
        && count >= 0 && count <= Number(ship.count);
    });
  }
  function hasValidCargo() {
    return Object.values(draft.cargo).every((raw) => String(raw).trim() !== ''
      && Number.isFinite(Number(raw)) && Number(raw) >= 0);
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
    const closeButton = node('button');
    closeButton.setAttribute('aria-label', 'Flottensteuerung schließen');
    closeButton.title = 'Flottensteuerung schließen';
    closeButton.append(createGameIcon('close'));
    closeButton.type = 'button';
    closeButton.className = 'btn btn-secondary btn-sm';
    closeButton.disabled = state.mutating;
    closeButton.addEventListener('click', close);
    const heading = node('h2', 'Flottenkommando');
    heading.prepend(createGameIcon('fleet'));
    header.classList.add('game-fleet-command-header');
    header.append(heading, closeButton);
    content.append(header);
    const activeStep = picking && pickingKind === 'origin' ? 1
      : !colony ? 1 : !hasValidTarget() ? 2 : 3;
    const steps = node('ol');
    steps.className = 'game-fleet-command-steps';
    steps.setAttribute('aria-label', 'Schritte zum Flottenbefehl');
    for (const [index, label] of ['Herkunft', 'Ziel', 'Flotte prüfen'].entries()) {
      const step = node('li', `${index + 1}. ${label}`);
      step.dataset.state = index + 1 < activeStep ? 'complete'
        : index + 1 === activeStep ? 'current' : 'upcoming';
      if (index + 1 === activeStep) step.setAttribute('aria-current', 'step');
      steps.append(step);
    }
    content.append(steps);
    const route = node('section');
    route.className = 'game-fleet-route game-fleet-command-route';
    route.setAttribute('aria-label', 'Geplante Route');
    const origin = node('div');
    origin.className = 'game-fleet-endpoint';
    origin.append(createGameIcon('planet'), node('strong', colony ? `Herkunft: ${colony.name}` : 'Keine Kolonie ausgewählt.'),
      node('span', colony ? `[${colony.galaxy}:${colony.system}:${colony.position}]` : 'Herkunft fehlt'));
    if (!picking) {
      const changeOrigin = node('button', 'Herkunft im 3D-Spielfeld ändern');
      changeOrigin.type = 'button';
      changeOrigin.className = 'btn btn-secondary btn-sm';
      changeOrigin.setAttribute('aria-label', 'Flottenherkunft im 3D-Spielfeld ändern');
      changeOrigin.disabled = busy;
      changeOrigin.addEventListener('click', () => {
        if (disposed || domain.getState().mutating) return;
        setPicking(true, 'origin');
        render();
        document.getElementById('starfield')?.focus({ preventScroll: true });
      });
      origin.append(changeOrigin);
    }
    const arrow = node('span', '→');
    arrow.className = 'game-fleet-route-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    const destination = node('div');
    destination.className = 'game-fleet-endpoint';
    const destinationName = node('strong');
    const destinationCoordinates = node('span');
    destination.append(createGameIcon('locate'), destinationName, destinationCoordinates);
    let clearTarget = null;
    function updateRoute() {
      const complete = hasTarget();
      destination.dataset.empty = String(!complete);
      destinationName.textContent = complete
        ? draft.target_name ? `Ziel · ${draft.target_name}` : 'Ziel · Entwurf'
        : 'Ziel wählen';
      destinationCoordinates.textContent = complete
        ? `[${draft.target_galaxy}:${draft.target_system}:${draft.target_position}]` : 'Noch kein vollständiges Ziel';
      if (clearTarget) clearTarget.hidden = !hasPartialTarget();
    }
    updateRoute();
    const pick = node('button', picking
      ? `${pickingKind === 'origin' ? 'Herkunft' : 'Ziel'}wahl abbrechen`
      : hasTarget() ? 'Ziel im Spielfeld ändern' : 'Ziel im Spielfeld wählen');
    pick.type = 'button';
    pick.className = 'btn btn-secondary btn-sm';
    pick.disabled = busy || !colony;
    pick.setAttribute('aria-pressed', String(picking));
    if (!picking) pick.setAttribute('aria-label', hasTarget() ? 'Flottenziel im 3D-Spielfeld ändern' : 'Flottenziel im 3D-Spielfeld wählen');
    pick.addEventListener('click', () => {
      if (disposed || domain.getState().mutating) return;
      const wasPicking = picking;
      const kind = pickingKind;
      setPicking(!wasPicking);
      render();
      if (!wasPicking) document.getElementById('starfield')?.focus({ preventScroll: true });
      else focusPickerControl(kind);
    });
    destination.append(pick);
    if (!picking) {
      clearTarget = node('button', 'Ziel entfernen');
      clearTarget.type = 'button';
      clearTarget.className = 'btn btn-secondary btn-sm';
      clearTarget.setAttribute('aria-label', 'Flottenziel aus dem Entwurf entfernen');
      clearTarget.addEventListener('click', () => {
        if (disposed || domain.getState().mutating) return;
        draft.target_galaxy = '';
        draft.target_system = '';
        draft.target_position = '';
        draft.target_name = '';
        render();
        root.querySelector('[aria-label="Flottenziel im 3D-Spielfeld wählen"]')?.focus({ preventScroll: true });
      });
      clearTarget.hidden = !hasPartialTarget();
      destination.append(clearTarget);
    }
    route.append(origin, arrow, destination);
    content.append(route);
    if (picking) {
      const targetStatus = node('p', pickingKind === 'origin'
        ? 'Schritt 1 von 3: Klicke ein Sternsystem und danach eine eigene Kolonie an. Escape bricht die Herkunftswahl ab.'
        : 'Schritt 2 von 3: Öffne ein Sternsystem per Doppelklick im 3D-Spielfeld oder über die Systemliste und wähle danach den Zielplaneten. Escape bricht die Zielwahl ab. Bis zur ausdrücklichen Startaktion wird kein Befehl gesendet.');
      targetStatus.setAttribute('role', 'status');
      if (pickingKind === 'origin') {
        const originLabel = node('label', 'Oder eigene Kolonie aus der Liste wählen ');
        const originSelect = node('select');
        originSelect.setAttribute('aria-label', 'Eigene Kolonie als Herkunft wählen');
        const placeholder = node('option', 'Kolonie auswählen …');
        placeholder.value = '';
        originSelect.append(placeholder);
        const sessionState = session.getState();
        const colonies = sessionState?.colonies || [];
        for (const owned of colonies) {
          const option = node('option',
            `${owned.name} [${owned.galaxy}:${owned.system}:${owned.position}]`);
          option.value = String(owned.id);
          originSelect.append(option);
        }
        originSelect.disabled = busy || colonies.length === 0;
        originSelect.addEventListener('change', () => {
          if (disposed || !originSelect.value || domain.getState().mutating) return;
          const selectedColony = colonies.find((owned) => Number(owned.id) === Number(originSelect.value));
          if (selectedColony) session.events.emit('fleet:origin-requested', { colonyId: Number(selectedColony.id) });
        });
        originLabel.append(originSelect);
        const originHelp = node('small', colonies.length
          ? 'Die Liste enthält nur deine eigenen Kolonien.'
          : sessionState
            ? 'In den geladenen Serverdaten sind keine eigenen Kolonien verfügbar.'
            : 'Koloniedaten sind derzeit nicht verfügbar.');
        originHelp.setAttribute('role', colonies.length ? 'note' : 'status');
        const cancelOrigin = node('button', 'Herkunftswahl abbrechen');
        cancelOrigin.type = 'button';
        cancelOrigin.className = 'btn btn-secondary btn-sm';
        cancelOrigin.addEventListener('click', () => {
          if (disposed || domain.getState().mutating) return;
          setPicking(false);
          render();
          focusPickerControl('origin');
        });
        content.append(targetStatus, originLabel, originHelp, cancelOrigin);
        root.replaceChildren(content);
        return;
      }
      const coordinatePick = node('button', 'Ziel stattdessen per Koordinaten eingeben');
      coordinatePick.type = 'button';
      coordinatePick.className = 'btn btn-secondary btn-sm';
      coordinatePick.disabled = busy || !colony;
      coordinatePick.addEventListener('click', () => {
        if (disposed || domain.getState().mutating) return;
        setPicking(false);
        coordinatesOpen = true;
        render();
        root.querySelector('[aria-label="Zielgalaxie"]')?.focus({ preventScroll: true });
      });
      content.append(targetStatus, coordinatePick);
      root.replaceChildren(content);
      return;
    }
    const refresh = node('button', 'Schiffsbestand aktualisieren');
    refresh.type = 'button';
    refresh.className = 'btn btn-secondary btn-sm';
    refresh.disabled = busy || !colony;
    refresh.addEventListener('click', () => { if (!disposed) { validationError = ''; void domain.refresh(); } });
    const shipyard = node('button', 'Werft öffnen');
    shipyard.type = 'button';
    shipyard.className = 'btn btn-secondary btn-sm';
    shipyard.disabled = busy || !colony;
    shipyard.addEventListener('click', () => {
      if (disposed || domain.getState().mutating || !colony) return;
      close();
      session.events.emit('shipyard:open-requested', { colonyId: Number(colony.id) });
    });
    const inventoryActions = node('div');
    inventoryActions.className = 'game-development-actions game-fleet-inventory-actions';
    inventoryActions.append(refresh, shipyard);
    content.append(inventoryActions);
    const notice = state.mutating ? handoffNotice : '';
    const status = node('p', validationError || state.error || notice || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', validationError || state.error || notice ? 'alert' : 'status');
    content.append(status);
    if (state.data?.transit) {
      const transit = state.data.transit;
      const [label, description] = FLEET_TRANSITS[transit.ftl_drive_type];
      const info = node('section');
      info.className = 'game-fleet-transit';
      info.dataset.ready = String(transit.ftl_ready);
      info.setAttribute('aria-label', 'Spezies- und Fraktionstransit');
      const title = node('h3', label);
      title.prepend(createGameIcon('fleet'));
      const badge = node('p', transit.ftl_ready ? 'Keine globale Aufladung'
        : `Aufladung · ${transit.ftl_cooldown_remaining_s} s (Serverstand)`);
      badge.className = 'game-fleet-drive-status';
      const details = node('details');
      details.className = 'game-fleet-transit-details';
      details.open = transitDetailsOpen;
      details.addEventListener('toggle', () => { if (!disposed) transitDetailsOpen = details.open; });
      details.append(node('summary', 'Antrieb und Routenprüfung'), node('p', description),
        node('p', 'Routenfreigabe, lokale Knotenaufladung, Reichweite und tatsächliche Ankunft prüft der Server beim Befehl. Keine lokale Flugzeitprognose.'));
      info.append(title, badge, details);
      content.append(info);
    }
    const form = node('form');
    form.setAttribute('aria-label', 'Flottenstart');
    const fields = node('fieldset');
    fields.disabled = busy || !colony;
    const composition = node('section');
    composition.className = 'game-fleet-composition-summary';
    composition.setAttribute('aria-label', 'Auswahlentwurf');
    let submit = null;
    let shipSelectionNotice = null;
    let shipQuantityValidationNotice = null;
    let cargoValidationNotice = null;
    let targetValidationNotice = null;
    let clearCargo = null;
    function updateComposition() {
      if (disposed) return;
      const selected = node('ul');
      selected.className = 'game-development-costs';
      selected.setAttribute('aria-label', 'Gewählte Schiffe');
      let totalShips = 0n;
      let hasInvalidShipQuantity = false;
      for (const ship of state.data?.ships || []) {
        const raw = draft.ships[ship.type] ?? '0';
        const value = Number(raw);
        const valid = String(raw).trim() !== '' && Number.isSafeInteger(value)
          && value >= 0 && value <= Number(ship.count);
        if (valid) totalShips += BigInt(value);
        else hasInvalidShipQuantity = true;
        if (valid && value === 0) continue;
        const item = node('li');
        item.append(createGameIcon('fleet'), node('span',
          `${ship.name || ship.type.replaceAll('_', ' ')}: ${valid ? raw : 'Ungültige Menge'}`));
        if (!valid) item.className = 'game-economy-deficit';
        selected.append(item);
      }
      if (!selected.children.length) selected.append(node('li', 'Keine Schiffe gewählt.'));
      const shipTotal = node('p', hasInvalidShipQuantity
        ? 'Schiffsmengen prüfen.'
        : `Insgesamt ${totalShips.toLocaleString('de-DE')} Schiffe ausgewählt.`);
      shipTotal.setAttribute('aria-label', 'Summe gewählter Schiffe');
      const cargoSummary = node('ul');
      cargoSummary.className = 'game-development-costs';
      cargoSummary.setAttribute('aria-label', 'Gewählte Fracht');
      for (const [key, label] of Object.entries({ metal: 'Metall', crystal: 'Kristall', deuterium: 'Deuterium' })) {
        const raw = draft.cargo[key];
        const valid = String(raw).trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0;
        if (valid && Number(raw) === 0) continue;
        const item = node('li');
        item.append(createGameIcon(key), node('span', `${label}: ${valid ? raw : 'Ungültige Menge'}`));
        if (!valid) item.className = 'game-economy-deficit';
        cargoSummary.append(item);
      }
      if (!cargoSummary.children.length) cargoSummary.append(node('li', 'Keine Fracht gewählt.'));
      composition.replaceChildren(node('h3', 'Auswahlentwurf'), shipTotal, selected, cargoSummary,
        node('small', 'Eingaben, keine Serverbestätigung. Bestand, Ladekapazität und Route prüft der Server beim Start.'));
      const selectedShip = hasSelectedShip();
      const validShipComposition = hasValidShipComposition();
      const validTarget = hasValidTarget();
      const activeStep = picking && pickingKind === 'origin' ? 1
        : !colony ? 1 : !validTarget ? 2 : 3;
      steps.querySelectorAll('li').forEach((step, index) => {
        const stepNumber = index + 1;
        step.dataset.state = stepNumber < activeStep ? 'complete'
          : stepNumber === activeStep ? 'current' : 'upcoming';
        if (stepNumber === activeStep) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      });
      if (submit) {
        submit.disabled = busy || !state.data?.ships.length || state.stale || !colony
          || !hasTarget() || !validTarget || !selectedShip || !validShipComposition || !hasValidCargo();
      }
      if (shipSelectionNotice) {
        shipSelectionNotice.hidden = selectedShip || !hasTarget() || busy || state.stale;
      }
      if (shipQuantityValidationNotice) {
        shipQuantityValidationNotice.hidden = validShipComposition || busy;
      }
      if (cargoValidationNotice) {
        cargoValidationNotice.hidden = hasValidCargo() || busy;
      }
      if (targetValidationNotice) {
        targetValidationNotice.hidden = !hasPartialTarget() || validTarget || busy;
        targetValidationNotice.textContent = hasTarget()
          ? 'Zielkoordinaten müssen innerhalb der gültigen Ganzzahlbereiche liegen.'
          : 'Für ein Koordinatenziel müssen Galaxie, System und Position vollständig sein.';
      }
      if (clearCargo) {
        clearCargo.disabled = busy || Object.values(draft.cargo).every((value) => {
          const amount = Number(value);
          return String(value).trim() !== '' && Number.isFinite(amount) && amount === 0;
        });
      }
    }
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
      input.addEventListener('input', () => {
        if (disposed) return;
        set(input.value);
        updateRoute();
        updateComposition();
      });
      wrapper.append(input);
      container.append(wrapper);
      return wrapper;
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
    const missionPreview = node('div');
    missionPreview.className = 'game-fleet-mission-preview';
    missionPreview.setAttribute('role', 'status');
    const missionDescription = node('p', FLEET_MISSION_DESCRIPTIONS[draft.mission]);
    missionDescription.id = 'fleet-mission-description';
    mission.setAttribute('aria-describedby', missionDescription.id);
    missionPreview.append(createFleetMissionBadge(draft.mission), missionDescription);
    mission.addEventListener('change', () => {
      draft.mission = mission.value;
      missionDescription.textContent = FLEET_MISSION_DESCRIPTIONS[draft.mission];
      missionPreview.replaceChildren(createFleetMissionBadge(draft.mission), missionDescription);
    });
    missionLabel.append(mission);
    fields.append(missionLabel, missionPreview);
    const coordinates = node('details');
    coordinates.open = coordinatesOpen;
    coordinates.append(node('summary', 'Zielkoordinaten (Tastaturalternative)'));
    coordinates.addEventListener('toggle', () => { coordinatesOpen = coordinates.open; });
    const targetGalaxyInput = number('Zielgalaxie', draft.target_galaxy, (value) => {
      draft.target_galaxy = value;
      draft.target_name = '';
    },
    { min: 1, max: 9, container: coordinates, required: false }).querySelector('input');
    const targetSystemInput = number('Zielsystem', draft.target_system, (value) => {
      draft.target_system = value;
      draft.target_name = '';
    },
    { min: 1, container: coordinates, required: false }).querySelector('input');
    const targetPositionInput = number('Zielposition', draft.target_position, (value) => {
      draft.target_position = value;
      draft.target_name = '';
    },
    { min: 1, container: coordinates, required: false }).querySelector('input');
    const targetCoordinateHint = node('small',
      'Galaxie: ganze Zahl von 1 bis 9. System und Position: positive ganze Zahlen.');
    targetCoordinateHint.id = 'fleet-target-coordinate-hint';
    const targetCoordinateInputs = [targetGalaxyInput, targetSystemInput, targetPositionInput];
    for (const input of targetCoordinateInputs) {
      input.setAttribute('aria-describedby', targetCoordinateHint.id);
    }
    const updateTargetCoordinateValidity = () => {
      const partial = hasPartialTarget();
      targetCoordinateHint.textContent = partial && !hasTarget()
        ? 'Für ein Koordinatenziel müssen Galaxie, System und Position vollständig sein.'
        : 'Galaxie: ganze Zahl von 1 bis 9. System und Position: positive ganze Zahlen.';
      const valid = targetCoordinateInputs.map((input) => {
        if (!input.value.trim()) return !partial;
        const value = Number(input.value);
        return Number.isSafeInteger(value) && value >= Number(input.min)
          && (input.max === '' || value <= Number(input.max));
      });
      targetCoordinateInputs.forEach((input, index) => {
        if (valid[index]) input.removeAttribute('aria-invalid');
        else input.setAttribute('aria-invalid', 'true');
      });
    };
    targetCoordinateInputs.forEach((input) => input.addEventListener('input', updateTargetCoordinateValidity));
    updateTargetCoordinateValidity();
    coordinates.append(targetCoordinateHint);
    fields.append(coordinates);
    fields.append(node('h3', 'Verfügbare Schiffe'));
    if (state.stale) fields.append(node('p', 'Bestand aktualisieren, bevor eine weitere Flotte zusammengestellt wird.'));
    if (state.data?.ships.length === 0) fields.append(node('p', 'Keine verfügbaren Schiffe auf dieser Kolonie.'));
    const ships = node('div');
    ships.className = 'game-fleet-selection';
    const tools = node('section');
    tools.className = 'game-development-filters';
    tools.setAttribute('aria-label', 'Flottenbestand filtern');
    const searchLabel = node('label', 'Schiffsbestand durchsuchen ');
    const search = node('input');
    search.type = 'search';
    search.value = shipSearch;
    search.setAttribute('aria-label', 'Schiffsbestand durchsuchen');
    searchLabel.append(search);
    const selectedFilter = node('button', 'Nur gewählte');
    selectedFilter.type = 'button';
    selectedFilter.className = 'btn btn-secondary btn-sm';
    const selectAllShips = node('button', 'Alle verfügbaren übernehmen');
    selectAllShips.type = 'button';
    selectAllShips.className = 'btn btn-secondary btn-sm';
    selectAllShips.disabled = busy || state.stale || !state.data?.ships.length;
    selectAllShips.setAttribute('aria-label', 'Alle verfügbaren Schiffe in den Entwurf übernehmen');
    const clearShips = node('button', 'Schiffsauswahl leeren');
    clearShips.type = 'button';
    clearShips.className = 'btn btn-secondary btn-sm';
    clearShips.disabled = busy || !state.data?.ships.length;
    clearShips.setAttribute('aria-label', 'Schiffsauswahl im Entwurf leeren');
    const result = node('p');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-label', 'Gefilterter Flottenbestand');
    const empty = node('p', 'Keine passenden Schiffstypen. Filter zurücksetzen, um den gesamten Bestand zu sehen.');
    const reset = node('button', 'Flottenfilter zurücksetzen');
    reset.type = 'button';
    reset.className = 'btn btn-secondary btn-sm';
    function applyShipFilters() {
      if (disposed) return;
      const query = shipSearch.trim().toLocaleLowerCase().replaceAll('_', ' ');
      let visible = 0;
      for (const card of ships.children) {
        const raw = draft.ships[card.dataset.shipType] ?? '0';
        const hasDraft = String(raw).trim() === '' || Number(raw) !== 0;
        const quantity = Number(raw);
        const valid = String(raw).trim() !== '' && Number.isSafeInteger(quantity)
          && quantity >= 0 && quantity <= Number(card.dataset.available);
        const selectionStatus = card.querySelector('[data-ship-selection-status]');
        const input = card.querySelector('input');
        if (selectionStatus) {
          selectionStatus.textContent = valid
            ? `${quantity} von ${card.dataset.available} ausgewählt`
            : String(raw).trim() === '' || !Number.isSafeInteger(quantity)
              ? 'Gib eine ganze Zahl ein.'
              : `Gültig: 0 bis ${card.dataset.available}.`;
          selectionStatus.dataset.invalid = String(!valid);
        }
        if (input) {
          if (valid) input.removeAttribute('aria-invalid');
          else input.setAttribute('aria-invalid', 'true');
        }
        card.hidden = !card.dataset.search.includes(query) || (selectedOnly && !hasDraft);
        if (!card.hidden) visible++;
        else if (card.contains(document.activeElement)) search.focus({ preventScroll: true });
      }
      result.textContent = `${visible} von ${ships.children.length} Schiffstypen angezeigt.`;
      empty.hidden = visible > 0;
      selectedFilter.setAttribute('aria-pressed', String(selectedOnly));
      reset.disabled = !shipSearch && !selectedOnly;
    }
    search.addEventListener('input', () => {
      if (disposed) return;
      shipSearch = search.value;
      applyShipFilters();
    });
    selectedFilter.addEventListener('click', () => {
      if (disposed) return;
      selectedOnly = !selectedOnly;
      applyShipFilters();
    });
    selectAllShips.addEventListener('click', () => {
      if (disposed || state.loading || state.mutating || state.stale || !state.data?.ships.length) return;
      draft.ships = Object.fromEntries(state.data.ships.map((ship) => [ship.type, String(ship.count)]));
      for (const card of ships.children) {
        const input = card.querySelector('input');
        if (input) input.value = draft.ships[card.dataset.shipType] || '0';
      }
      updateComposition();
      applyShipFilters();
    });
    clearShips.addEventListener('click', () => {
      if (disposed || state.loading || state.mutating) return;
      draft.ships = {};
      for (const card of ships.children) {
        const input = card.querySelector('input');
        if (input) input.value = '0';
      }
      updateComposition();
      applyShipFilters();
    });
    reset.addEventListener('click', () => {
      if (disposed) return;
      shipSearch = search.value = '';
      selectedOnly = false;
      applyShipFilters();
      search.focus({ preventScroll: true });
    });
    tools.append(searchLabel, selectedFilter, reset, selectAllShips, clearShips);
    content.append(tools, result, empty);
    fields.append(ships);
    for (const ship of state.data?.ships || []) {
      const card = node('div');
      card.className = 'game-fleet-selection-card';
      card.dataset.shipType = ship.type;
      card.dataset.available = String(ship.count);
      card.dataset.search = `${ship.type} ${ship.name || ''}`.toLocaleLowerCase().replaceAll('_', ' ');
      const stock = node('strong', `${ship.count} verfügbar`);
      stock.className = 'game-fleet-selection-stock';
      const shipName = ship.name || ship.type.replaceAll('_', ' ');
      const selectionStatus = node('output', `${draft.ships[ship.type] || '0'} von ${ship.count} ausgewählt`);
      selectionStatus.id = `fleet-ship-selection-status-${ships.children.length}`;
      selectionStatus.dataset.shipSelectionStatus = '';
      selectionStatus.setAttribute('aria-label', `${shipName} Auswahlstatus`);
      selectionStatus.className = 'game-fleet-selection-status';
      card.append(createGameIcon('fleet'), stock, selectionStatus);
      const inputWrapper = number(`${shipName} (${ship.count} verfügbar)`, draft.ships[ship.type] || '0',
        (value) => {
          draft.ships = { ...draft.ships, [ship.type]: value };
          applyShipFilters();
        }, { max: Number(ship.count), container: card });
      const input = inputWrapper.querySelector('input');
        input.setAttribute('aria-describedby', selectionStatus.id);
      const quantityControls = node('div');
      quantityControls.className = 'game-fleet-quantity-controls';
      const decrease = node('button', '−');
      decrease.type = 'button';
      decrease.className = 'btn btn-secondary btn-sm';
      decrease.setAttribute('aria-label', `${shipName} verringern`);
      decrease.title = `${shipName} verringern`;
      const increase = node('button', '+');
      increase.type = 'button';
      increase.className = 'btn btn-secondary btn-sm';
      increase.setAttribute('aria-label', `${shipName} erhöhen`);
      increase.title = `${shipName} erhöhen`;
      const maximum = node('button', 'Max');
      maximum.type = 'button';
      maximum.className = 'btn btn-secondary btn-sm';
      maximum.setAttribute('aria-label', `${shipName} maximal auswählen`);
      maximum.disabled = busy || state.stale || Number(ship.count) === 0;
      const clearType = node('button', 'Leeren');
      clearType.type = 'button';
      clearType.className = 'btn btn-secondary btn-sm';
      clearType.setAttribute('aria-label', `${shipName} Auswahl leeren`);
      const updateQuantityControls = () => {
        const raw = input.value;
        const value = Number(raw);
        const valid = raw.trim() !== '' && Number.isSafeInteger(value)
          && value >= 0 && value <= Number(ship.count);
        decrease.disabled = !valid || value === 0;
        increase.disabled = !valid || value >= Number(ship.count);
        maximum.disabled = busy || state.stale || !valid || value === Number(ship.count);
        clearType.disabled = busy || (valid && value === 0);
      };
      const changeQuantity = (delta) => {
        if (disposed || !input || !Number.isSafeInteger(Number(input.value))) return;
        const next = Number(input.value) + delta;
        if (next < 0 || next > Number(ship.count)) return;
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      decrease.addEventListener('click', () => changeQuantity(-1));
      increase.addEventListener('click', () => changeQuantity(1));
      maximum.addEventListener('click', () => {
        if (disposed || state.loading || state.mutating || state.stale) return;
        input.value = String(ship.count);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      clearType.addEventListener('click', () => {
        if (disposed || state.loading || state.mutating) return;
        input.value = '0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      input.addEventListener('input', updateQuantityControls);
      updateQuantityControls();
      quantityControls.append(decrease, increase, maximum, clearType);
      card.append(quantityControls);
      ships.append(card);
    }
    applyShipFilters();
    fields.append(node('h3', 'Fracht'));
    const cargo = node('div');
    cargo.className = 'game-fleet-selection';
    fields.append(cargo);
    for (const [key, label] of Object.entries({ metal: 'Metall', crystal: 'Kristall', deuterium: 'Deuterium' })) {
      const card = node('div');
      card.className = 'game-fleet-selection-card';
      card.append(createGameIcon(key));
      const inputWrapper = number(`Fracht ${label}`, draft.cargo[key], (value) => {
        draft.cargo[key] = value;
      }, { step: 'any', container: card });
      const input = inputWrapper.querySelector('input');
      const validationHint = node('small', 'Gib eine Zahl größer oder gleich null ein.');
      validationHint.id = `fleet-cargo-validation-${key}`;
      validationHint.hidden = true;
      input.setAttribute('aria-describedby', validationHint.id);
      const updateCargoValidation = () => {
        const valid = input.value.trim() !== '' && Number.isFinite(Number(input.value)) && Number(input.value) >= 0;
        if (valid) input.removeAttribute('aria-invalid');
        else input.setAttribute('aria-invalid', 'true');
        validationHint.hidden = valid;
      };
      input.addEventListener('input', updateCargoValidation);
      updateCargoValidation();
      card.append(validationHint);
      const clearResource = node('button', 'Leeren');
      clearResource.type = 'button';
      clearResource.className = 'btn btn-secondary btn-sm';
      clearResource.setAttribute('aria-label', `${label} aus der Fracht leeren`);
      const updateClearState = () => {
        const amount = Number(input.value);
        const valid = input.value.trim() !== '' && Number.isFinite(amount) && amount >= 0;
        clearResource.disabled = busy || (valid && amount === 0);
      };
      input.addEventListener('input', updateClearState);
      updateClearState();
      clearResource.addEventListener('click', () => {
        if (disposed || state.loading || state.mutating) return;
        input.value = '0';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      card.append(clearResource);
      cargo.append(card);
    }
    clearCargo = node('button', 'Fracht leeren');
    clearCargo.type = 'button';
    clearCargo.className = 'btn btn-secondary btn-sm';
    clearCargo.setAttribute('aria-label', 'Gesamte Fracht im Entwurf leeren');
    clearCargo.addEventListener('click', () => {
      if (disposed || state.loading || state.mutating) return;
      draft.cargo = { metal: '0', crystal: '0', deuterium: '0' };
      for (const [key, label] of Object.entries({ metal: 'Metall', crystal: 'Kristall', deuterium: 'Deuterium' })) {
        const input = root.querySelector(`[aria-label="Fracht ${label}"]`);
        if (input) {
          input.value = '0';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      updateComposition();
    });
    fields.append(clearCargo);
    cargoValidationNotice = node('p', 'Frachtwerte müssen gültige Zahlen größer oder gleich null sein.');
    cargoValidationNotice.setAttribute('role', 'status');
    cargoValidationNotice.hidden = true;
    targetValidationNotice = node('p', 'Zielkoordinaten müssen innerhalb der gültigen Ganzzahlbereiche liegen.');
    targetValidationNotice.setAttribute('role', 'status');
    targetValidationNotice.hidden = true;
    shipQuantityValidationNotice = node('p',
      'Schiffsmengen müssen ganze Zahlen innerhalb des verfügbaren Bestands sein.');
    shipQuantityValidationNotice.setAttribute('role', 'status');
    shipQuantityValidationNotice.hidden = true;
    submit = node('button', 'Flotte serverseitig starten');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = 'Flotte prüfen und serverseitig starten';
    shipSelectionNotice = node('p', 'Wähle mindestens ein verfügbares Schiff für diesen Auftrag.');
    shipSelectionNotice.setAttribute('role', 'status');
    shipSelectionNotice.hidden = true;
    updateComposition();
    fields.append(composition,
      node('small', 'Prüfe Herkunft, Ziel, Mission, Schiffe und Fracht. Erst dieser Button sendet den Auftrag zur Serverprüfung.'),
      shipSelectionNotice, shipQuantityValidationNotice, cargoValidationNotice, targetValidationNotice, submit);
    form.append(fields);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (disposed || state.loading || state.mutating || !hasSelectedShip() || !hasTarget()
        || !form.reportValidity()) return;
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
    const help = node('details');
    help.className = 'game-fleet-transit-details';
    help.append(node('summary', 'Hinweise zum Flottenstart'),
      node('p', 'Transit gemäß serverseitigem Spezies-/Fraktionsantrieb, kein generischer Standardflug. Kein manueller Wurmloch-Override. Öffnen, Zielwahl und Aktualisieren starten keine Mission.'));
    content.append(form, help);
    root.replaceChildren(content);
  }
  const unsubscribe = domain.subscribe(render);
  const unsubscribeColony = session.events.on('overview:updated', () => {
    const id = session.getColony()?.id ?? null;
    if (id === lastColony) return;
    lastColony = id;
    if (preserveRouteOnColonyChange) {
      draft.ships = {};
      preserveRouteOnColonyChange = false;
    } else {
      draft = emptyDraft();
    }
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
  const unsubscribeTarget = session.events.on('fleet:target-requested', ({ galaxy, system, position, targetName }) => {
    if (!canChangeOrder()) return;
    draft.target_galaxy = String(galaxy);
    draft.target_system = String(system);
    draft.target_position = String(position);
    draft.target_name = typeof targetName === 'string' ? targetName : '';
    validationError = '';
    setPicking(false);
    open();
  });
  const unsubscribeTargetCoordinates = session.events.on('fleet:target-coordinate-requested', () => {
    if (!canChangeOrder()) return;
    setPicking(false);
    coordinatesOpen = true;
    render();
    root.querySelector('[aria-label="Zielgalaxie"]')?.focus({ preventScroll: true });
  });
  const unsubscribeOrigin = session.events.on('fleet:origin-requested', ({ colonyId }) => {
    if (!canChangeOrder()) return;
    if (picking && pickingKind === 'origin') setPicking(false, 'origin');
    const previousColonyId = lastColony;
    preserveRouteOnColonyChange = true;
    session.selectColony(colonyId);
    if (lastColony === previousColonyId) preserveRouteOnColonyChange = false;
    open();
    setPicking(true);
    render();
    document.getElementById('starfield')?.focus({ preventScroll: true });
  });
  const unsubscribeOriginPickingCancel = session.events.on('fleet:origin-picking', ({ active }) => {
    if (active || !picking || pickingKind !== 'origin') return;
    picking = false;
    root.dataset.picking = 'false';
    render();
    focusPickerControl('origin');
  });
  const openClick = (event) => {
    if (!disposed && event.target.closest?.('[data-game-fleet-launch]')) open();
  };
  const escape = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing
      || root.hidden || disposed || (!picking && !root.contains(event.target))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (picking) {
      const kind = pickingKind;
      setPicking(false);
      render();
      focusPickerControl(kind);
    }
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
    unsubscribeTargetCoordinates();
    unsubscribeOrigin();
    unsubscribeOriginPickingCancel();
    document.removeEventListener('click', openClick);
    window.removeEventListener('keydown', escape, true);
    root.remove();
  };
}
