import { createGameGalaxyRenderer } from '../rendering/game-galaxy-renderer.js';
import { API } from '../api.js';
import { mountFleetMap } from './game-fleet-map.js';

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

export function mountGameGalaxy({ session, domain, fleets, createRenderer = createGameGalaxyRenderer }) {
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
  navigation.append(node('summary', 'Navigation'));
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
  const galaxy = node('input');
  galaxy.type = 'number';
  galaxy.min = '1';
  galaxy.max = '9';
  galaxy.required = true;
  galaxy.value = String(session.getColony()?.galaxy || 1);
  galaxy.setAttribute('aria-label', 'Galaxiekoordinate');
  const system = node('input');
  system.type = 'number';
  system.min = '1';
  system.required = true;
  system.value = String(session.getColony()?.system || 1);
  system.setAttribute('aria-label', 'Systemkoordinate');
  const go = node('button', 'System öffnen');
  go.type = 'submit';
  go.className = 'btn btn-secondary btn-sm';
  form.append(galaxy, system, go);
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
  let pathError = null;
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
        if (pathError !== null && rendererStatus.textContent === pathError) {
          rendererStatus.hidden = true;
          rendererStatus.setAttribute('role', 'status');
          pathError = null;
        }
      }
    }
    catch (error) {
      if (!disposed && error.name !== 'AbortError') {
        pathError = error.message;
        rendererStatus.textContent = error.message;
        rendererStatus.setAttribute('role', 'alert');
        rendererStatus.hidden = false;
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
      + 'Doppelklick: System, Planet, Kolonie. Pfeiltasten: drehen; mit Umschalt: verschieben. '
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
  const planetTitle = node('h3');
  const planetInfo = node('p');
  const planetActions = node('div');
  planetActions.className = 'game-galaxy-toolbar';
  let selectedPosition = null;
  let selectedSystem = null;
  let pickingFleetTarget = false;
  function selectedPlanet() {
    return state.system?.planets.find((slot) =>
      Number(slot.position ?? slot.player_planet?.position ?? slot.generated_planet?.position) === selectedPosition);
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
  const fleetTarget = button('Flotte zu diesem Planeten', () => {
    if (disposed || state.loading || !selectedPlanet()) return;
    session.events.emit('fleet:target-requested', {
      galaxy: Number(state.system.galaxy), system: Number(state.system.system), position: selectedPosition,
    });
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
  planetActions.append(planetFocus, colonyFocus, colonyManage, fleetOrigin, shipyard, population, fleetTarget, clearPlanet);
  planetContext.append(planetTitle, planetInfo, planetActions);
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
    planetTitle.textContent = `${body.name || body.planet_class || 'Planet'} · Position ${selectedPosition}`;
    planetInfo.textContent = colony ? `Eigene Kolonie: ${colony.name}`
      : slot.player_planet ? 'Besiedelter Planet · keine eigene Kolonie'
        : 'Unbesiedelter Planet';
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
  navigation.append(toolbar, viewStatus, cameraTools, catalog);
  panel.append(navigation, path, status, rendererStatus, retry, planetContext, details);
  let disposed = false;
  let active = false;
  let renderer = null;
  let unmountFleetMap = null;
  let rendererPending = false;
  const rendererAbort = new AbortController();
  let lastStars = null;
  let lastSystem = null;
  let displayedSelection = null;
  let state = domain.getState();
  function renderList() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = state.stars.filter((star) => !query || String(star.name || '').toLocaleLowerCase().includes(query)
      || String(star.system_index).includes(query)).slice(0, 40);
    list.replaceChildren(...matches.map((star) => button(`${star.name || 'System'} [${star.galaxy_index}:${star.system_index}]`, () => {
      void domain.navigate(star.galaxy_index, star.system_index);
    })));
    list.append(node('p', `${matches.length} angezeigt; Suche begrenzt auf geladene Serverdaten.`));
  }
  search.addEventListener('input', renderList);
  function update(next) {
    state = next;
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
        planets.setAttribute('aria-label', 'Systemplaneten');
        for (const slot of state.system.planets) {
          const body = slot.player_planet || slot.generated_planet;
          if (!body) continue;
          const position = Number(slot.position ?? body.position);
          const colony = ownedColony(position);
          const item = node('li');
          item.dataset.position = String(position);
          item.append(node('span', `${position}: ${body.name || body.planet_class || 'Planet'}`));
          const label = body.name || `Planet ${position}`;
          item.append(button(`${label} ansehen`, () => renderer?.focusPlanet(position)));
          if (slot.player_planet && colony) {
            item.append(button(`Kolonie auf ${label} ansehen`, () => renderer?.focusColony(position)));
          }
          if (colony) {
            item.append(button(`${colony.name} verwalten`, () => {
              openBuildings(colony);
            }));
          }
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
    const systemKey = state.system ? `${state.system.galaxy}:${state.system.system}:${state.system.server_ts_ms}` : null;
    if (lastSystem !== systemKey) {
      if (state.system) renderer.enterSystemView(state.selected, state.system);
      else { renderer.exitSystemView(true); renderer.fitCameraToStars(true, true); }
      lastSystem = systemKey;
    }
    renderer.setGalaxyFleets(session.getState()?.fleets || []);
  }
  async function startRenderer() {
    if (disposed || rendererPending || renderer) return;
    rendererPending = true;
    rendererStatus.hidden = false;
    retry.hidden = true;
    rendererStatus.textContent = 'Starte interaktives Spielfeld ...';
    try {
      const next = await createRenderer(host, {
        externalCanvas: canvas,
        signal: rendererAbort.signal,
        async loadColonyData(position, data, signal) {
          const colony = session.getState()?.colonies.find((entry) =>
            Number(entry.galaxy) === Number(data.systemPayload.galaxy)
            && Number(entry.system) === Number(data.systemPayload.system) && Number(entry.position) === position);
          if (!colony) throw new Error('Die Kolonieoberfläche ist nur für eigene Kolonien verfügbar.');
          const buildings = await API.get(`api/buildings.php?action=list&colony_id=${colony.id}`, { signal });
          if (buildings?.success !== true || !Array.isArray(buildings.buildings)) {
            throw new Error('Ungültige Gebäudedaten für die Kolonieoberfläche.');
          }
          let snapshotError = null;
          return {
            ...data, ...buildings, colony: { ...data.focusPlanet, ...colony },
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
              return { ...snapshot, buildings: updated.buildings, layout: updated.layout };
            },
            onError: (error) => {
              snapshotError = error.message;
              rendererStatus.textContent = error.message;
              rendererStatus.setAttribute('role', 'alert');
              rendererStatus.hidden = false;
            },
            onSnapshotLoaded: () => {
              if (snapshotError !== null && rendererStatus.textContent === snapshotError) rendererStatus.hidden = true;
              snapshotError = null;
            },
          };
        },
        onClick: (star) => {
          if (star.__kind === 'planet') {
            selectedPosition = Number(star.position);
            details.open = false;
            updatePlanetContext();
            if (pickingFleetTarget && selectedPlanet() && !state.loading) fleetTarget.click();
          } else if (!domain.getState().system) {
            if (pickingFleetTarget) void domain.navigate(star.galaxy_index, star.system_index);
            else domain.select(star);
          }
        },
        onDoubleClick: (star) => domain.navigate(star.galaxy_index, star.system_index),
        onOverview: () => domain.overview(),
        onViewChange: (camera) => {
          const previousCamera = currentCamera;
          updatePath(camera);
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
          rendererStatus.hidden = true;
        },
        onError: (error) => {
          rendererStatus.textContent = error.message;
          rendererStatus.setAttribute('role', 'alert');
          rendererStatus.hidden = false;
          window.GQLog?.error?.('[galaxy-camera]', error.message);
        },
      });
      if (disposed) { next.destroy(); return; }
      renderer = next;
      window.galaxy3d = renderer;
      const backend = renderer.getRenderStats().backend;
      rendererStatus.textContent = `3D aktiv: ${backend}`;
      rendererStatus.setAttribute('role', 'status');
      rendererStatus.hidden = true;
      panel.dataset.renderer = backend;
      syncRenderer();
      if (fleets) unmountFleetMap = mountFleetMap({ domain: fleets, galaxy: domain, renderer, session, stage });
    } catch (error) {
      if (disposed) return;
      rendererStatus.textContent = error.message;
      rendererStatus.setAttribute('role', 'alert');
      window.GQLog?.error?.('[galaxy-renderer]', error.message);
      retry.hidden = false;
    } finally {
      rendererPending = false;
    }
  }
  const observer = new ResizeObserver(() => renderer?.resize());
  observer.observe(stage);
  const unsubscribe = domain.subscribe(update);
  const unsubscribeOverview = session.events.on('overview:updated', () => {
    syncRenderer();
    updatePlanetContext();
  });
  const unsubscribeMutation = session.events.on('colony:mutation-accepted', ({ colonyId, allColonies }) => {
    void renderer?.refreshColony(allColonies ? null : colonyId);
  });
  const unsubscribeFleetPicking = session.events.on('fleet:target-picking', ({ active }) => {
    pickingFleetTarget = active;
    stage.classList.toggle('fleet-target-picking', active);
    if (active) {
      navigation.open = false;
      details.open = false;
      canvas.focus({ preventScroll: true });
    }
  });
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
    homeButton?.removeEventListener('click', goHome);
    mapButtons.forEach((element) => element.removeEventListener('click', showMap));
    searchButton?.removeEventListener('click', showSearch);
    observer.disconnect();
    unsubscribe();
    unsubscribeOverview();
    unsubscribeMutation();
    unsubscribeFleetPicking();
    stage.classList.remove('fleet-target-picking');
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
