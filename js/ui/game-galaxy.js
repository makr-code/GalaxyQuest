import { createGameGalaxyRenderer } from '../rendering/game-galaxy-renderer.js';
import { resolvePlanetOrbit } from '../rendering/system-visualization-layer.js';
import { API } from '../api.js';
import { mountFleetMap } from './game-fleet-map.js';
import { createGameIcon, decorateGameAction } from './game-ui-visuals.js';
import { transportVessel } from '../engine/runtime/trade-transports.js';

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
function button(text, action) {
  const element = node('button', text);
  element.type = 'button';
  element.className = 'btn btn-secondary btn-sm';
  element.addEventListener('click', action);
  return element;
}

export function mountGameGalaxy({ session, domain, fleets, tradeTransports, createRenderer = createGameGalaxyRenderer }) {
  const host = document.getElementById('galaxy-3d-host');
  const stage = document.getElementById('wm-galaxy-section');
  const wrapper = document.getElementById('galaxy-bg-wrapper');
  if (!host || !stage || !wrapper) throw new Error('Das Galaxie-Spielfeld fehlt.');
  const canvas = document.getElementById('starfield');
  if (!canvas) throw new Error('Der gemeinsame Galaxie-Canvas fehlt.');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Galaxie-Spielfeld: Ziehen zum Drehen, Umschalt+Ziehen zum Verschieben, Mausrad zum Zoomen, Doppelklick zum Annähern');
  const panel = node('section');
  panel.id = 'game-galaxy-ui';
  panel.setAttribute('aria-label', 'Galaxienavigation');
  const navigation = node('details');
  navigation.id = 'game-galaxy-navigation';
  navigation.append(node('summary', 'Karte & Koordinaten'));
  const toolbar = node('div');
  toolbar.className = 'game-galaxy-toolbar';
  const title = node('strong', 'Galaxie');
  const home = button('Heimatsystem', () => { void domain.home(); });
  const overview = button('Galaxie', () => { void domain.overview(); });
  const refresh = button('Karte aktualisieren', () => { void domain.refresh(); });
  const zoomIn = button('+', () => renderer?.nudgeZoom('in'));
  zoomIn.setAttribute('aria-label', 'Karte vergrößern');
  const zoomOut = button('−', () => renderer?.nudgeZoom('out'));
  zoomOut.setAttribute('aria-label', 'Karte verkleinern');
  const form = node('form');
  form.setAttribute('aria-label', 'Sternsystem direkt öffnen');
  const galaxy = node('input');
  galaxy.id = 'game-galaxy-coordinate';
  galaxy.type = 'number';
  galaxy.min = '1';
  galaxy.max = '9';
  galaxy.required = true;
  galaxy.value = String(session.getColony()?.galaxy || 1);
  galaxy.setAttribute('inputmode', 'numeric');
  const galaxyLabel = node('label', 'Galaxie');
  galaxyLabel.htmlFor = galaxy.id;
  const system = node('input');
  system.id = 'game-system-coordinate';
  system.type = 'number';
  system.min = '1';
  system.required = true;
  system.value = String(session.getColony()?.system || 1);
  system.setAttribute('inputmode', 'numeric');
  const systemLabel = node('label', 'System');
  systemLabel.htmlFor = system.id;
  const go = node('button', 'System öffnen');
  go.type = 'submit';
  go.className = 'btn btn-secondary btn-sm';
  form.append(galaxyLabel, galaxy, systemLabel, system, go);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (form.reportValidity()) void domain.navigate(galaxy.valueAsNumber, system.valueAsNumber);
  });
  const status = node('p');
  status.id = 'game-galaxy-status';
  status.setAttribute('role', 'status');
  const rendererStatus = node('p');
  rendererStatus.id = 'game-renderer-status';
  rendererStatus.setAttribute('role', 'status');
  const sceneErrors = new Map();
  function syncSceneErrors() {
    const messages = [...sceneErrors.values()];
    rendererStatus.hidden = messages.length === 0;
    rendererStatus.setAttribute('role', messages.length ? 'alert' : 'status');
    if (messages.length) rendererStatus.textContent = messages.join('\n');
  }
  function setSceneError(source, message) {
    sceneErrors.set(source, message);
    syncSceneErrors();
  }
  function clearSceneError(source) {
    if (sceneErrors.delete(source)) syncSceneErrors();
  }
  const retry = button('3D erneut starten', () => { void startRenderer(); });
  retry.hidden = true;
  const viewStatus = node('p', 'Ansicht: Galaxie');
  viewStatus.id = 'game-camera-view';
  viewStatus.setAttribute('role', 'status');
  const path = node('nav');
  path.id = 'game-camera-path';
  path.setAttribute('aria-label', 'Ansichtspfad');
  path.hidden = true;
  const pathLevels = ['galaxy', 'system', 'planet', 'colony', 'building'];
  const pathLabels = ['Galaxie', 'System', 'Planet', 'Kolonie', 'Gebäude'];
  let currentCamera = null;
  let pathPending = false;
  const pathButtons = pathLevels.map((level, index) => {
    const element = button(pathLabels[index], () => { void navigatePath(level); });
    element.setAttribute('aria-label', `${pathLabels[index]} anzeigen`);
    element.dataset.level = level;
    path.append(element);
    return element;
  });
  function updatePath(camera = currentCamera) {
    currentCamera = camera;
    if (!camera) return;
    const depth = pathLevels.indexOf(camera.level);
    path.hidden = depth <= 0;
    path.setAttribute('aria-busy', String(pathPending));
    pathButtons.forEach((element, index) => {
      element.hidden = index > depth;
      element.disabled = pathPending || state.loading || index >= depth;
      if (index === depth) element.setAttribute('aria-current', 'location');
      else element.removeAttribute('aria-current');
      element.title = index === 0 ? `Galaxie ${state.galaxy || ''}`
        : index === 1 ? `${state.selected?.name || 'System'} [${state.system?.galaxy || ''}:${state.system?.system || ''}]`
          : index === 2 ? `Planet · Position ${camera.planetPosition}` : pathLabels[index];
    });
  }
  async function navigatePath(level) {
    if (disposed || pathPending || !renderer) return;
    pathPending = true;
    updatePath();
    try {
      if (await renderer.returnTo(level) && !disposed) {
        canvas.focus({ preventScroll: true });
        clearSceneError('navigation');
      }
    }
    catch (error) {
      if (!disposed && error.name !== 'AbortError') {
        setSceneError('navigation', error.message);
        window.GQLog?.error?.('[galaxy-navigation]', error.message);
      }
    } finally {
      if (!disposed) { pathPending = false; updatePath(); }
    }
  }
  const cameraTools = node('details');
  cameraTools.id = 'game-camera-help';
  cameraTools.append(node('summary', 'Kamerasteuerung'),
    node('p', 'Links ziehen: drehen. Rechts/Mitte oder Umschalt+Ziehen: verschieben. Mausrad: Zoom. '
      + 'Doppelklick auf Stern: System; auf Planet: Planet; auf dieselbe bewohnte Welt: Kolonie. '
      + 'Pfeiltasten: drehen; mit Umschalt: verschieben. '
      + 'Touch: ein Finger dreht, Antippen wählt aus; zwei Finger verschieben und zoomen. '
      + 'Esc: eine Ebene zurück. Pos1: Ansicht zentrieren.'));
  const cameraButtons = node('div');
  cameraButtons.className = 'game-galaxy-toolbar';
  cameraButtons.append(
    button('Ansicht zurück', () => renderer?.back()),
    button('Ansicht zentrieren', () => renderer?.resetView()),
    button('Links drehen', () => renderer?.rotateView(-40, 0)),
    button('Rechts drehen', () => renderer?.rotateView(40, 0)),
    button('Nach oben drehen', () => renderer?.rotateView(0, -30)),
    button('Nach unten drehen', () => renderer?.rotateView(0, 30)));
  cameraTools.append(cameraButtons);
  const visualizationOptions = {
    orbits: true, planes: false, distanceLine: false, apsides: false, phaseArc: false, selection: true,
  };
  const badgeTools = node('details');
  badgeTools.id = 'game-spatial-badges';
  badgeTools.append(node('summary', 'Räumliche Badges'));
  const badgeModeLabel = node('label');
  const badgeModeToggle = node('input');
  badgeModeToggle.id = 'game-spatial-badges-dom-toggle';
  badgeModeToggle.type = 'checkbox';
  badgeModeToggle.addEventListener('change', () => {
    renderer?.setSpatialLabelMode?.(badgeModeToggle.checked ? 'dom' : 'webgpu');
  });
  badgeModeLabel.htmlFor = badgeModeToggle.id;
  badgeModeLabel.append(badgeModeToggle, document.createTextNode('Interaktive HTML-Badges'));
  badgeTools.append(badgeModeLabel, node('p',
    'WebGPU-Badges als fokussierbare DOM-Buttons überlagern. Klick/Enter: auswählen; '
      + 'Doppelklick/Umschalt+Enter: annähern; Mausrad: zum Objekt zoomen; '
      + 'Escape: Fokus zurück ins Spielfeld.'));
  const visualizationTools = node('details');
  visualizationTools.id = 'game-system-visualizations';
  visualizationTools.hidden = true;
  visualizationTools.append(node('summary', 'System-Hilfen'));
  function addVisualizationToggle(id, text, key) {
    const label = node('label');
    const input = node('input');
    input.id = id;
    input.type = 'checkbox';
    input.checked = visualizationOptions[key];
    input.addEventListener('change', () => {
    visualizationOptions[key] = input.checked;
    renderer?.setSystemVisualizationOptions?.({ ...visualizationOptions });
    updatePlanetContext();
    });
    label.htmlFor = id;
    label.append(input, document.createTextNode(text));
    visualizationTools.append(label);
  }
  addVisualizationToggle('game-system-orbits-toggle', 'Planetenbahnen', 'orbits');
  addVisualizationToggle('game-system-planes-toggle', 'Bahnebenen', 'planes');
  addVisualizationToggle('game-system-distance-line-toggle', 'Entfernungslinie zum Stern', 'distanceLine');
  addVisualizationToggle('game-system-apsides-toggle', 'Nächste / fernste Bahnpunkte', 'apsides');
  addVisualizationToggle('game-system-phase-arc-toggle', 'Bogen Periapsis bis Planetenposition', 'phaseArc');
  addVisualizationToggle('game-system-selection-toggle', 'Auswahlmarker', 'selection');
  function syncVisualizationTools(camera = currentCamera) {
    visualizationTools.hidden = camera?.level !== 'system';
  }
  const details = node('details');
  details.id = 'game-galaxy-details';
  details.open = false;
  const summary = node('summary', 'Systeminformationen');
  const selection = node('div');
  selection.id = 'game-galaxy-selection';
  details.append(summary, selection);
  const planetContext = node('section');
  planetContext.id = 'game-planet-context';
  planetContext.setAttribute('aria-label', 'Planetenauswahl');
  planetContext.hidden = true;
  const fleetTargetPicker = node('section');
  fleetTargetPicker.id = 'game-fleet-target-picker';
  fleetTargetPicker.setAttribute('aria-label', 'Zielplaneten im ausgewählten System');
  fleetTargetPicker.hidden = true;
  const planetTitle = node('h3');
  const planetInfo = node('p');
  planetInfo.className = 'game-planet-ownership';
  const planetDistance = node('p');
  planetDistance.id = 'game-planet-distance';
  planetDistance.hidden = true;
  const planetActions = node('div');
  planetActions.className = 'game-planet-action-grid';
  planetActions.setAttribute('aria-label', 'Planetaktionen');
  let selectedPosition = null;
  let selectedSystem = null;
  let pickingFleetTarget = false;
  let pickingFleetOrigin = false;
  function fleetTargetPosition(slot) {
    const position = Number(slot?.position ?? slot?.player_planet?.position ?? slot?.generated_planet?.position);
    return Number.isSafeInteger(position) && position > 0 ? position : null;
  }
  function selectedPlanet() {
    if (selectedPosition === null) return undefined;
    return state.system?.planets.find((slot) => fleetTargetPosition(slot) === selectedPosition);
  }
  function ownedColony(position) {
    return session.getState()?.colonies.find((entry) => Number(entry.galaxy) === state.galaxy
      && Number(entry.system) === Number(state.system?.system) && Number(entry.position) === position);
  }
  function openBuildings(colony) {
    session.events.emit('buildings:open-requested', { colonyId: Number(colony.id), buildingType: '' });
  }
  const planetFocus = button('Planet annähern', () => {
    if (!disposed && !state.loading && selectedPlanet()) renderer?.focusPlanet(selectedPosition);
  });
  const colonyFocus = button('Kolonieoberfläche öffnen', () => {
    if (!disposed && !state.loading && selectedPlanet()?.player_planet && ownedColony(selectedPosition)) {
      renderer?.focusColony(selectedPosition);
    }
  });
  const colonyManage = button('Kolonie verwalten', () => {
    const colony = ownedColony(selectedPosition);
    if (!disposed && !state.loading && selectedPlanet() && colony) openBuildings(colony);
  });
  const clearPlanet = button('Planetenauswahl aufheben', () => {
    if (disposed) return;
    selectedPosition = null;
    updatePlanetContext();
    canvas.focus({ preventScroll: true });
  });
  function requestFleetTarget(position) {
    const targetPosition = Number(position);
    const slot = state.system?.planets.find((entry) =>
      fleetTargetPosition(entry) === targetPosition && (entry.player_planet || entry.generated_planet));
    if (disposed || state.loading || !Number.isSafeInteger(targetPosition) || targetPosition < 1 || !slot) return;
    const body = slot?.player_planet || slot?.generated_planet;
    const targetName = [state.selected?.name, body?.name || body?.planet_class]
      .filter((name) => typeof name === 'string' && name.trim())
      .join(' · ');
    session.events.emit('fleet:target-requested', {
      galaxy: Number(state.system.galaxy), system: Number(state.system.system), position: targetPosition,
      targetName,
    });
  }
  const fleetTarget = button('Flotte zu diesem Planeten', () => {
    if (!disposed && !state.loading && selectedPlanet()) requestFleetTarget(selectedPosition);
  });
  const fleetOrigin = button('Flotte hier auswählen', () => {
    const colony = ownedColony(selectedPosition);
    if (!disposed && !state.loading && colony) {
      session.events.emit('fleet:origin-requested', { colonyId: Number(colony.id) });
    }
  });
  const shipyard = button('Werft dieser Kolonie öffnen', () => {
    const colony = ownedColony(selectedPosition);
    if (!disposed && !state.loading && colony) {
      session.events.emit('shipyard:open-requested', { colonyId: Number(colony.id) });
    }
  });
  const population = button('Bevölkerung dieser Kolonie', () => {
    const colony = ownedColony(selectedPosition);
    if (!disposed && !state.loading && colony) {
      session.events.emit('population:open-requested', { colonyId: Number(colony.id) });
    }
  });
  for (const [control, icon] of [
    [planetFocus, 'locate'], [colonyFocus, 'planet'], [colonyManage, 'buildings'],
    [fleetOrigin, 'fleet'], [shipyard, 'shipyard'], [population, 'population'],
    [fleetTarget, 'fleet'], [clearPlanet, 'close'],
  ]) {
    const label = control.textContent;
    control.textContent = '';
    decorateGameAction(control, icon, label);
  }
  const planetHeading = node('div');
  planetHeading.className = 'game-planet-context-heading';
  planetHeading.append(createGameIcon('planet'), planetTitle);
  const actionGroup = (label, controls) => {
    const group = node('section');
    group.className = 'game-planet-action-group';
    group.setAttribute('aria-label', label);
    group.append(node('h4', label), ...controls);
    return group;
  };
  planetActions.append(
    actionGroup('Ansicht', [planetFocus, clearPlanet]),
    actionGroup('Flotte', [fleetTarget, fleetOrigin]),
    actionGroup('Kolonie', [colonyFocus, colonyManage, shipyard, population]),
  );
  planetContext.append(planetHeading, planetInfo, planetDistance, planetActions);
  function updatePlanetContext() {
    const slot = selectedPlanet();
    const body = slot?.player_planet || slot?.generated_planet;
    planetContext.hidden = !body || !['system', 'planet'].includes(currentCamera?.level);
    selection.querySelectorAll('li[data-position]').forEach((item) => {
      const selected = Number(item.dataset.position) === selectedPosition;
      item.classList.toggle('selected', selected);
      if (selected) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
    if (!body) return;
    const colony = ownedColony(selectedPosition);
    planetContext.dataset.ownership = colony ? 'own' : slot.player_planet ? 'settled' : 'unsettled';
    planetTitle.textContent = `${body.name || body.planet_class || 'Planet'} · Position ${selectedPosition}`;
    planetInfo.textContent = colony ? `Eigene Kolonie: ${colony.name}`
      : slot.player_planet ? 'Besiedelter Planet · keine eigene Kolonie'
        : 'Unbesiedelter Planet';
    const showSystemMeasurements = currentCamera?.level === 'system'
      && (visualizationOptions.distanceLine || visualizationOptions.apsides || visualizationOptions.phaseArc);
    planetDistance.hidden = !showSystemMeasurements;
    if (showSystemMeasurements) {
      const orbit = resolvePlanetOrbit(state.selected, { ...body, position: selectedPosition });
      const formatAU = (value) => `${new Intl.NumberFormat('de-DE', {
        maximumFractionDigits: 3,
      }).format(value)} AU`;
      const measurements = [];
      if (visualizationOptions.distanceLine) {
        measurements.push(`Sternabstand: ${formatAU(orbit.distanceAU)}`
          + `${orbit.distanceEstimated ? ' · schematisch geschätzt' : ''}`);
      }
      if (visualizationOptions.apsides) {
        measurements.push(`Periapsis (grün, nächster Punkt): ${formatAU(orbit.periapsisAU)}`
          + ` · Apoapsis (orange gestrichelt, fernster Punkt): ${formatAU(orbit.apoapsisAU)}`
          + `${orbit.apsidesEstimated ? ' · schematisch geschätzt' : ''}`);
      }
      if (visualizationOptions.phaseArc) {
        measurements.push(`Phasenbogen: Periapsis bis Planetenposition`
          + `${orbit.phaseEstimated ? ' · Position schematisch geschätzt' : ''}`);
      }
      planetDistance.textContent = measurements.join(' · ');
    }
    planetFocus.disabled = state.loading;
    colonyFocus.hidden = !colony || !slot.player_planet;
    colonyManage.hidden = !colony;
    colonyFocus.disabled = colonyManage.disabled = state.loading;
    fleetTarget.disabled = state.loading || !session.getColony();
    fleetOrigin.hidden = !colony;
    fleetOrigin.disabled = state.loading;
    shipyard.hidden = !colony;
    shipyard.disabled = state.loading;
    population.hidden = !colony;
    population.disabled = state.loading;
  }
  const catalog = node('details');
  catalog.id = 'game-galaxy-catalog';
  catalog.append(node('summary', 'Sternsysteme suchen'));
  const search = node('input');
  search.type = 'search';
  search.placeholder = 'Name oder Systemnummer';
  search.setAttribute('aria-label', 'Sternsysteme filtern');
  const list = node('div');
  list.id = 'game-galaxy-system-list';
  catalog.append(search, list);
  toolbar.append(title, home, overview, refresh, zoomIn, zoomOut, form);
  navigation.append(toolbar, viewStatus, cameraTools, badgeTools, visualizationTools, catalog);
  panel.append(navigation, path, status, rendererStatus, retry, fleetTargetPicker, planetContext, details);
  let disposed = false;
  let active = false;
  let renderer = null;
  let unmountFleetMap = null;
  let rendererPending = false;
  let rendererAttempt = 0;
  let surfaceContext = null;
  const rendererAbort = new AbortController();
  let lastStars = null;
  let lastSystem = null;
  let displayedSelection = null;
  let state = domain.getState();
  let pendingBattleEncounter = null;
  function renderFleetTargetPicker() {
    fleetTargetPicker.hidden = !pickingFleetTarget
      || (!state.system && !state.loading && !state.error);
    if (fleetTargetPicker.hidden) return;
    const planets = (state.loading || state.error || !state.system ? [] : state.system.planets || []).flatMap((slot) => {
      const body = slot.player_planet || slot.generated_planet;
      const position = fleetTargetPosition(slot);
      if (!body || position === null) return [];
      const label = `${body.name || body.planet_class || 'Planet'} · Position ${position}`;
      const select = button(label, () => requestFleetTarget(position));
      select.disabled = state.loading;
      select.setAttribute('aria-label', `Flottenziel wählen: ${label}`);
      return [select];
    });
    const heading = node('h3', 'Ziel in diesem Sternsystem wählen');
    const hint = node('p', state.error
      ? `Systemziele nicht verfügbar: ${state.error} Koordinaten eingeben oder ein anderes System öffnen.`
      : state.loading
        ? 'Planeten des ausgewählten Sternsystems werden geladen.'
        : !state.system
          ? 'Öffne ein Sternsystem im Spielfeld oder in der Systemliste.'
          : planets.length
            ? 'Wähle einen Planeten aus der Liste oder direkt im 3D-Spielfeld.'
            : 'Für dieses System sind keine Planeten zur Auswahl geladen.');
    hint.setAttribute('role', state.error ? 'alert' : 'status');
    const coordinates = button('Ziel per Koordinaten eingeben', () => {
      session.events.emit('fleet:target-coordinate-requested');
    });
    fleetTargetPicker.replaceChildren(heading, hint, ...planets, coordinates);
  }
  function renderList() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = state.stars.filter((star) => !query || String(star.name || '').toLocaleLowerCase().includes(query)
      || String(star.system_index).includes(query));
    const cards = matches.slice(0, 40).map((star) => {
      const control = button('', () => {
        if (!disposed && !state.loading) void domain.navigate(star.galaxy_index, star.system_index);
      });
      control.classList.add('game-system-catalog-card');
      control.disabled = state.loading;
      control.title = `${star.name || 'System'} [${star.galaxy_index}:${star.system_index}]`;
      const name = node('strong', star.name || 'System');
      const coordinates = node('span', `[${star.galaxy_index}:${star.system_index}]`);
      control.append(createGameIcon('star'), name, coordinates);
      if (Number(star.galaxy_index) === Number(state.selected?.galaxy_index)
        && Number(star.system_index) === Number(state.selected?.system_index)) {
        control.setAttribute('aria-current', 'location');
      }
      return control;
    });
    const count = node('p', `${cards.length} von ${matches.length} Treffern angezeigt; Suche begrenzt auf ${state.stars.length} geladene Serverdaten.`);
    count.setAttribute('role', 'status');
    list.replaceChildren(...cards, count);
    if (!matches.length) list.append(node('p', 'Keine passenden geladenen Sternsysteme.'));
  }
  search.addEventListener('input', renderList);
  function update(next) {
    state = next;
    if (pendingBattleEncounter && state.error && !state.loading) {
      setSceneError('battle', state.error);
      pendingBattleEncounter = null;
    }
    renderFleetTargetPicker();
    const systemKey = state.system ? `${state.system.galaxy}:${state.system.system}` : null;
    if (systemKey !== selectedSystem) selectedPosition = null;
    selectedSystem = systemKey;
    if (!state.loading && selectedPosition !== null && !selectedPlanet()) selectedPosition = null;
    updatePath();
    title.textContent = `Galaxie ${state.galaxy || '—'} · ${state.stars.length} geladene Systeme`;
    status.textContent = state.error || (state.loading ? 'Lade Galaxiedaten ...' : 'Serverdaten geladen. Stern anklicken, doppelklicken zum Öffnen.');
    status.setAttribute('role', state.error ? 'alert' : 'status');
    status.dataset.error = state.error ? 'true' : 'false';
    status.hidden = !state.error && !state.loading;
    details.hidden = !state.selected;
    for (const control of [home, overview, refresh, go]) control.disabled = state.loading;
    selection.replaceChildren();
    const star = state.selected;
    const selectionKey = star ? `${star.galaxy_index}:${star.system_index}` : null;
    if (selectionKey !== displayedSelection) {
      details.open = !!star;
      displayedSelection = selectionKey;
    }
    if (!state.loading && state.galaxy && document.activeElement !== galaxy) galaxy.value = String(state.galaxy);
    if (!state.loading && star && document.activeElement !== system) system.value = String(star.system_index);
    if (star) {
      selection.append(node('h3', `${star.name || 'System'} [${star.galaxy_index}:${star.system_index}]`));
      selection.append(node('p', `${star.spectral_class || 'Stern'} · ${star.x_ly}, ${star.y_ly}, ${star.z_ly} Lj`));
      if (!state.system) selection.append(button('Ausgewähltes System öffnen', () => {
        void domain.navigate(star.galaxy_index, star.system_index);
      }));
      if (state.system) {
        const planets = node('ul');
        planets.className = 'game-system-planets';
        planets.setAttribute('aria-label', 'Systemplaneten');
        for (const slot of state.system.planets) {
          const body = slot.player_planet || slot.generated_planet;
          if (!body) continue;
          const position = Number(slot.position ?? body.position);
          const colony = ownedColony(position);
          const item = node('li');
          item.dataset.position = String(position);
          const heading = node('div');
          heading.className = 'game-system-planet-heading';
          const location = node('span', `Position ${position}`);
          location.className = 'game-development-level';
          heading.append(createGameIcon('planet'), location,
            node('strong', body.name || body.planet_class || 'Planet'));
          item.append(heading);
          if (colony) {
            const ownership = node('span', `Kolonie · ${colony.name}`);
            ownership.className = 'game-system-ownership';
            item.dataset.owned = 'true';
            item.append(ownership);
          }
          const label = body.name || `Planet ${position}`;
          const actions = node('div');
          actions.className = 'game-system-planet-actions';
          const focus = button('', () => renderer?.focusPlanet(position));
          decorateGameAction(focus, 'locate', `${label} ansehen`);
          actions.append(focus);
          if (slot.player_planet && colony) {
            const surface = button('', () => renderer?.focusColony(position));
            decorateGameAction(surface, 'planet', `Kolonie auf ${label} ansehen`);
            actions.append(surface);
          }
          if (colony) {
            const manage = button('', () => {
              openBuildings(colony);
            });
            decorateGameAction(manage, 'buildings', `${colony.name} verwalten`);
            actions.append(manage);
          }
          actions.setAttribute('aria-label', `Aktionen für ${label}`);
          item.append(actions);
          planets.append(item);
        }
        selection.append(node('p', `Sichtbarkeit: ${state.system.visibility?.level || 'Serverdaten'}`), planets);
      }
    } else selection.append(node('p', 'Stern im Spielfeld auswählen oder Koordinaten öffnen.'));
    renderList();
    syncRenderer();
    updatePlanetContext();
  }
  function syncRenderer() {
    if (!renderer || state.galaxy === null) return;
    const starsKey = JSON.stringify(state.stars);
    if (lastStars !== starsKey) {
      renderer.setStars(state.stars, { preserveView: false });
      if (lastStars !== null) renderer.fitCameraToStars(true, true);
      lastStars = starsKey;
    }
    const systemKey = state.system ? JSON.stringify(state.system) : null;
    if (lastSystem !== systemKey) {
      if (state.system) renderer.enterSystemView(state.selected, state.system);
      else { renderer.exitSystemView(true); renderer.fitCameraToStars(true, true); }
      lastSystem = systemKey;
    }
    const transit = tradeTransports?.getState();
    renderer.setGalaxyFleets([
      ...(session.getState()?.fleets || []),
      ...(transit?.transports || []).map((route) => transportVessel(route, transit.offset)),
    ]);
    startPendingBattleEncounter();
  }
  function startPendingBattleEncounter() {
    const pending = pendingBattleEncounter;
    if (!pending || !renderer || state.loading || !state.system
      || Number(state.system.galaxy) !== pending.target.galaxy
      || Number(state.system.system) !== pending.target.system) return;
    const cameraState = renderer.getRenderStats()?.cameraControl;
    if (cameraState?.level !== 'system' || cameraState.transitioning) return;
    pendingBattleEncounter = null;
    Promise.resolve().then(() => renderer.playBattleEncounter(pending.encounter))
      .then((replay) => {
        replay.finished.catch((error) => {
          if (!disposed) setSceneError('battle', error.message);
        });
      })
      .catch((error) => {
        if (!disposed) setSceneError('battle', error.message);
      });
  }
  function showBattleEncounter(event) {
    if (disposed) return;
    const encounter = event.detail;
    const created = encounter?.events?.find((entry) => entry?.event_type === 'encounter_created');
    const target = created?.payload?.target;
    if (!target || !Number.isSafeInteger(target.galaxy) || target.galaxy < 1 || target.galaxy > 9
      || !Number.isSafeInteger(target.system) || target.system < 1
      || !Number.isSafeInteger(target.position) || target.position < 1) {
      setSceneError('battle', 'Der Encounter enthält keine gültigen Zielkoordinaten.');
      return;
    }
    pendingBattleEncounter = { encounter, target };
    clearSceneError('battle');
    void domain.navigate(target.galaxy, target.system);
  }
  async function startRenderer() {
    if (disposed || rendererPending || renderer) return;
    const attempt = ++rendererAttempt;
    const isCurrent = () => !disposed && attempt === rendererAttempt;
    let next = null;
    rendererPending = true;
    retry.disabled = true;
    rendererStatus.hidden = false;
    rendererStatus.setAttribute('role', 'status');
    retry.hidden = true;
    rendererStatus.textContent = 'Starte interaktives Spielfeld ...';
    const findOwnedColony = (position, data) => session.getState()?.colonies.find((entry) =>
      Number(entry.galaxy) === Number(data.systemPayload.galaxy)
      && Number(entry.system) === Number(data.systemPayload.system) && Number(entry.position) === position);
    async function loadBuildingState(colony, signal) {
      signal?.throwIfAborted();
      if (!isCurrent()) throw new DOMException('Renderer changed.', 'AbortError');
      const buildings = await API.get(`api/buildings.php?action=list&colony_id=${colony.id}`, { signal });
      signal?.throwIfAborted();
      if (!isCurrent()) throw new DOMException('Renderer changed.', 'AbortError');
      if (buildings?.success !== true || !Array.isArray(buildings.buildings)) {
        throw new Error('Ungültige Gebäudedaten für die Kolonieoberfläche.');
      }
      return buildings;
    }
    try {
      next = await createRenderer(host, {
        externalCanvas: canvas,
        signal: rendererAbort.signal,
        async loadPlanetData(position, data, signal) {
          const colony = findOwnedColony(position, data);
          if (!colony) return data;
          const buildings = await loadBuildingState(colony, signal);
          return { ...data, ...buildings, colony: { ...data.focusPlanet, ...colony,
            population: buildings.planet?.population ?? colony.population } };
        },
        async loadColonyData(position, data, signal) {
          const colony = findOwnedColony(position, data);
          if (!colony) throw new Error('Die Kolonieoberfläche ist nur für eigene Kolonien verfügbar.');
          const buildings = await loadBuildingState(colony, signal);
          const context = {};
          surfaceContext = context;
          return {
            ...data, ...buildings, colony: { ...data.focusPlanet, ...colony,
              population: buildings.planet?.population ?? colony.population },
            onOpenBuildings: (slot) => {
              session.events.emit('buildings:open-requested', {
                colonyId: Number(colony.id), buildingType: slot?.type || '',
              });
            },
            loadSnapshot: async (id, snapshotSignal) => {
              const [snapshot, updated] = await Promise.all([
                API.get(`api/colony_economy.php?action=snapshot&colony_id=${id}`, { signal: snapshotSignal }),
                API.get(`api/buildings.php?action=list&colony_id=${id}`, { signal: snapshotSignal }),
              ]);
              if (updated?.success !== true || !Array.isArray(updated.buildings)) {
                throw new Error('Ungültige Gebäudedaten für die Kolonieoberfläche.');
              }
              return { ...snapshot, buildings: updated.buildings, layout: updated.layout,
                orbital_facilities: updated.orbital_facilities,
                body_development: updated.body_development ?? snapshot.body_development };
            },
            onError: (error) => {
              if (!isCurrent() || surfaceContext !== context) return;
              setSceneError('surface', error.message);
            },
            onSnapshotLoaded: () => {
              if (!isCurrent() || surfaceContext !== context) return;
              clearSceneError('surface');
            },
          };
        },
        onClick: (star) => {
          if (!isCurrent()) return;
          if (star.__kind === 'planet') {
            selectedPosition = Number(star.position);
            details.open = false;
            updatePlanetContext();
            if (pickingFleetOrigin && !state.loading) {
              const colony = ownedColony(selectedPosition);
              if (colony) session.events.emit('fleet:origin-requested', { colonyId: Number(colony.id) });
            } else if (pickingFleetTarget && selectedPlanet() && !state.loading) fleetTarget.click();
          } else if (!domain.getState().system) {
            if (pickingFleetTarget || pickingFleetOrigin) void domain.navigate(star.galaxy_index, star.system_index);
            else domain.select(star);
          }
        },
        onDoubleClick: (star) => { if (isCurrent()) return domain.navigate(star.galaxy_index, star.system_index); },
        onOverview: () => { if (isCurrent()) return domain.overview(); },
        onViewChange: (camera) => {
          if (!isCurrent()) return;
          const previousCamera = currentCamera;
          updatePath(camera);
          syncVisualizationTools(camera);
          if (previousCamera?.level !== camera.level) {
            clearSceneError('camera');
            if (['colony', 'building'].includes(previousCamera?.level)
              && !['colony', 'building'].includes(camera.level)) {
              surfaceContext = null;
              clearSceneError('surface');
            }
          }
          if (camera.level === 'galaxy') selectedPosition = null;
          else if (camera.level === 'planet' && camera.planetPosition !== null
            && (previousCamera?.level !== 'planet' || previousCamera?.planetPosition !== camera.planetPosition)) {
            selectedPosition = Number(camera.planetPosition);
          }
          if (previousCamera?.level !== camera.level || previousCamera?.planetPosition !== camera.planetPosition) {
            updatePlanetContext();
            if (camera.level === 'planet') details.open = false;
          }
          const labels = { galaxy: 'Galaxie', system: 'Sternsystem', planet: 'Planet', colony: 'Kolonieoberfläche', building: 'Gebäude' };
          viewStatus.textContent = `Ansicht: ${labels[camera.level]}${camera.planetPosition === null ? '' : ` · Position ${camera.planetPosition}`}`;
          panel.dataset.cameraLevel = camera.level;
          if (['colony', 'building'].includes(camera.level)) navigation.open = false;
          if (camera.level === 'system' && !camera.transitioning) startPendingBattleEncounter();
        },
        onError: (error) => {
          if (!isCurrent()) return;
          setSceneError('camera', error.message);
          window.GQLog?.error?.('[galaxy-camera]', error.message);
        },
      });
      if (!isCurrent()) { next.destroy(); return; }
      renderer = next;
      renderer.setSpatialLabelMode?.(badgeModeToggle.checked ? 'dom' : 'webgpu');
      renderer.setSystemVisualizationOptions?.({ ...visualizationOptions });
      const backend = renderer.getRenderStats().backend;
      syncRenderer();
      startPendingBattleEncounter();
      if (fleets) unmountFleetMap = mountFleetMap({ domain: fleets, galaxy: domain, renderer, session, stage });
      window.galaxy3d = renderer;
      rendererStatus.textContent = `3D aktiv: ${backend}`;
      rendererStatus.setAttribute('role', 'status');
      rendererStatus.hidden = true;
      sceneErrors.clear();
      panel.dataset.renderer = backend;
    } catch (error) {
      if (!isCurrent()) return;
      rendererAttempt++;
      unmountFleetMap?.();
      unmountFleetMap = null;
      if (window.galaxy3d === next) delete window.galaxy3d;
      renderer = null;
      lastStars = null;
      lastSystem = null;
      currentCamera = null;
      surfaceContext = null;
      sceneErrors.clear();
      path.hidden = true;
      delete panel.dataset.renderer;
      delete panel.dataset.cameraLevel;
      next?.destroy();
      rendererStatus.textContent = error.message;
      rendererStatus.setAttribute('role', 'alert');
      rendererStatus.hidden = false;
      window.GQLog?.error?.('[galaxy-renderer]', error.message);
      retry.hidden = false;
    } finally {
      rendererPending = false;
      retry.disabled = false;
    }
  }
  const observer = new ResizeObserver(() => renderer?.resize());
  observer.observe(stage);
  const unsubscribe = domain.subscribe(update);
  const unsubscribeTransports = tradeTransports?.subscribe(syncRenderer);
  const unsubscribeOverview = session.events.on('overview:updated', () => {
    syncRenderer();
    updatePlanetContext();
  });
  const unsubscribeMutation = session.events.on('colony:mutation-accepted', ({ colonyId, allColonies }) => {
    void renderer?.refreshColony(allColonies ? null : colonyId);
  });
  const unsubscribeFleetPicking = session.events.on('fleet:target-picking', ({ active }) => {
    pickingFleetTarget = active;
    renderFleetTargetPicker();
    stage.classList.toggle('fleet-target-picking', active);
    if (active) {
      navigation.open = false;
      details.open = false;
      canvas.focus({ preventScroll: true });
    }
  });
  const unsubscribeFleetOriginPicking = session.events.on('fleet:origin-picking', ({ active }) => {
    pickingFleetOrigin = active;
    stage.classList.toggle('fleet-origin-picking', active);
    if (active) {
      navigation.open = false;
      details.open = false;
      canvas.focus({ preventScroll: true });
    }
  });
  window.addEventListener('gq:show-battle-encounter', showBattleEncounter);
  const cancelOriginPicking = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !pickingFleetOrigin) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    session.events.emit('fleet:origin-picking', { active: false });
  };
  window.addEventListener('keydown', cancelOriginPicking, true);
  const homeButton = document.getElementById('topbar-home-btn');
  const goHome = () => { void domain.home(); };
  homeButton?.addEventListener('click', goHome);
  const mapButtons = document.querySelectorAll('[data-game-galaxy-overview]');
  const showMap = () => { void domain.overview(); };
  mapButtons.forEach((element) => element.addEventListener('click', showMap));
  const searchButton = document.getElementById('topbar-search-toggle');
  const showSearch = () => { navigation.open = true; catalog.open = true; search.focus(); };
  searchButton?.addEventListener('click', showSearch);
  function activate() {
    if (disposed || active) return;
    active = true;
    stage.append(panel);
    stage.classList.add('game-field');
    wrapper.setAttribute('aria-hidden', 'false');
    update(domain.getState());
    void startRenderer();
    const target = window.GQAuthGalaxyBackgroundControl?.getViewTarget?.();
    if (Number.isInteger(target?.galaxy) && Number.isInteger(target?.system)
      && target.galaxy > 0 && target.system > 0) void domain.navigate(target.galaxy, target.system);
    else void domain.overview();
  }
  window.addEventListener('gq:authenticated', activate);
  if (document.body.classList.contains('game-page')) activate();
  return () => {
    disposed = true;
    rendererAbort.abort();
    window.removeEventListener('gq:authenticated', activate);
    window.removeEventListener('gq:show-battle-encounter', showBattleEncounter);
    homeButton?.removeEventListener('click', goHome);
    mapButtons.forEach((element) => element.removeEventListener('click', showMap));
    searchButton?.removeEventListener('click', showSearch);
    observer.disconnect();
    unsubscribe();
    unsubscribeTransports?.();
    unsubscribeOverview();
    unsubscribeMutation();
    unsubscribeFleetPicking();
    unsubscribeFleetOriginPicking();
    pendingBattleEncounter = null;
    window.removeEventListener('keydown', cancelOriginPicking, true);
    stage.classList.remove('fleet-target-picking');
    stage.classList.remove('fleet-origin-picking');
    unmountFleetMap?.();
    if (window.galaxy3d === renderer) delete window.galaxy3d;
    renderer?.destroy();
    if (!renderer) window.GQAuthGalaxyBackgroundControl?.returnToMenu?.();
    canvas.removeAttribute('tabindex');
    canvas.removeAttribute('aria-label');
    panel.remove();
    stage.classList.remove('game-field');
    wrapper.setAttribute('aria-hidden', 'true');
  };
}
