import { createGameIcon, createFleetMissionBadge, decorateGameAction } from './game-ui-visuals.js';
import { createGameWindowView } from './game-window-view.js';

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

export function mountFleetWindow({ domain, galaxy, wm }) {
  if (!wm?.register || !wm?.body) throw new Error('The game window manager is unavailable.');
  const view = createGameWindowView(wm, 'fleet', { accountWide: true });
  let disposed = false;
  let missionFilter = null;
  let directionFilter = 'all';
  let tableState = { query: '', filters: {}, sort: null };
  function showSystem(fleet, prefix) {
    if (disposed) return;
    wm.minimize('fleet');
    void galaxy.navigate(fleet[`${prefix}_galaxy`], fleet[`${prefix}_system`]);
  }
  function render() {
    if (disposed || !wm.body('fleet')) return;
    const state = domain.getState();
    const busy = state.loading || state.mutating;
    const root = view.begin({ ...state, busy, data: state.fleets });
    const content = node('section');
    content.className = 'game-development game-fleet-dashboard';
    content.dataset.domain = 'fleets';
    const header = node('header');
    header.className = 'game-fleet-dashboard-header';
    const title = node('h2', 'Flotten');
    title.prepend(createGameIcon('fleet'));
    header.append(title, node('p', 'Accountweite Einsätze · letzter Serverstand'));
    content.append(header);
    const actions = node('div');
    actions.className = 'game-development-actions';
    actions.append(
      button('Flotten aktualisieren', () => { if (!disposed) void domain.refresh(); }, busy),
    );
    const launch = node('button', 'Neue Flotte zusammenstellen');
    launch.type = 'button';
    launch.className = 'btn btn-primary btn-sm';
    launch.prepend(createGameIcon('fleet'));
    launch.dataset.gameFleetLaunch = '';
    actions.append(launch);
    content.append(actions);
    view.status(content, { ...state, busy, data: state.fleets });
    if (state.stale && state.fleets !== null) content.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Befehlen aktualisieren.'));
    const arrivals = node('section');
    arrivals.className = 'game-fleet-processing';
    arrivals.setAttribute('aria-label', 'Ankunftsverarbeitung');
    const processingTitle = node('h3', 'Ankünfte abrechnen');
    arrivals.append(processingTitle,
      node('p', 'Verarbeitet fällige Missionen auf dem Server. Kein automatischer Abschluss beim Aktualisieren.'),
      button('Fällige Ankünfte verarbeiten', () => { if (!disposed) void domain.command('check'); }, busy || state.stale || state.fleets === null));
    if (state.fleets !== null) {
      const returning = state.fleets.filter(fleet => Number(fleet.returning) === 1).length;
      const summary = view.widget('properties', content, {
        items: [
          { id: 'total', label: 'Missionen', value: String(state.fleets.length) },
          { id: 'outbound', label: 'Hinflug', value: String(state.fleets.length - returning) },
          { id: 'return', label: 'Rückflug', value: String(returning) },
        ],
      }).el;
      summary.classList.add('game-fleet-dashboard-summary');
      summary.setAttribute('aria-label', 'Einsatzübersicht; gesamter Serverstand');
      content.append(summary, arrivals);
      if (!state.fleets.length) view.widget('notice', content, {
        state: 'empty', title: 'Keine laufenden Flottenmissionen.',
      });
      const filters = node('section');
      filters.className = 'game-fleet-filters';
      filters.setAttribute('aria-label', 'Flottenmissionen filtern');
      const missions = [...new Set(state.fleets.map(fleet => fleet.mission))];
      if (missionFilter !== null && !missions.includes(missionFilter)) missions.push(missionFilter);
      const missionControls = node('div');
      missionControls.className = 'game-fleet-filter-missions';
      missionControls.setAttribute('role', 'group');
      missionControls.setAttribute('aria-label', 'Missionstyp; Zähler im gesamten Serverstand');
      [null, ...missions].forEach((mission, index) => {
        const count = mission === null ? state.fleets.length : state.fleets.filter(fleet => fleet.mission === mission).length;
        const control = button('', () => {
          if (disposed) return;
          missionFilter = mission;
          render();
          root.querySelector(`[data-mission-filter-index="${index}"]`)?.focus({ preventScroll: true });
        });
        control.dataset.missionFilterIndex = String(index);
        control.setAttribute('aria-pressed', String(missionFilter === mission));
        control.append(mission === null ? node('span', 'Alle Missionen') : createFleetMissionBadge(mission),
          node('strong', ` (${count})`));
        missionControls.append(control);
      });
      const direction = node('select');
      direction.setAttribute('aria-label', 'Flugrichtung');
      for (const [value, label] of [['all', 'Alle Flugrichtungen'], ['outbound', 'Hinflug'], ['return', 'Rückflug']]) {
        const option = node('option', label);
        option.value = value;
        direction.append(option);
      }
      direction.value = directionFilter;
      direction.addEventListener('change', () => {
        if (disposed) return;
        directionFilter = direction.value;
        render();
        root.querySelector('[aria-label="Flugrichtung"]')?.focus({ preventScroll: true });
      });
      filters.append(missionControls);
      view.widget('field', filters, {
        control: direction, label: 'Flugrichtung',
        help: 'Filtert nur den geladenen Serverstand; erteilt keine Flottenbefehle.',
      });
      content.append(filters);
      const visible = state.fleets.filter(fleet => (missionFilter === null || fleet.mission === missionFilter)
        && (directionFilter === 'all' || (Number(fleet.returning) === 1 ? 'return' : 'outbound') === directionFilter));
      const result = node('p', `${visible.length} von ${state.fleets.length} Missionen angezeigt.`);
      result.setAttribute('role', 'status');
      content.append(result);
      if (state.fleets.length && !visible.length) view.widget('notice', content, {
        state: 'empty', title: 'Keine Missionen für diese Filter.',
        message: 'Filter zurücksetzen, um alle Missionen zu sehen.',
      });
      const reset = button('Filter zurücksetzen', () => {
        if (disposed) return;
        missionFilter = null;
        directionFilter = 'all';
        render();
        root.querySelector('[data-mission-filter-index="0"]')?.focus({ preventScroll: true });
      });
      reset.disabled = missionFilter === null && directionFilter === 'all';
      filters.append(reset);
      const list = node('div');
      list.className = 'game-development-list';
      list.setAttribute('aria-label', 'Flottenmissionen');
      for (const fleet of visible) {
        const returning = Number(fleet.returning) === 1;
        const card = node('article');
        card.className = 'game-development-card game-fleet-card';
        card.dataset.fleetId = String(fleet.id);
        card.dataset.direction = returning ? 'return' : 'outbound';
        const heading = node('header');
        heading.className = 'game-development-card-heading';
        const direction = node('span', returning ? 'Rückflug' : 'Hinflug');
        direction.className = 'game-fleet-direction';
        heading.append(createGameIcon('fleet'), node('h3', fleet.fleet_label || `Flotte ${fleet.id}`), direction);
        card.append(heading, createFleetMissionBadge(fleet.mission));
        const route = node('div');
        route.className = 'game-fleet-route';
        route.setAttribute('role', 'group');
        route.setAttribute('aria-label', returning ? 'Rückflug zur Herkunft' : 'Hinflug zum Ziel');
        const endpoint = (prefix, label) => {
          const element = node('div');
          element.className = 'game-fleet-endpoint';
          element.dataset.endpoint = prefix;
          element.append(createGameIcon('planet'), node('span', label),
            node('strong', `[${fleet[`${prefix}_galaxy`]}:${fleet[`${prefix}_system`]}:${fleet[`${prefix}_position`]}]`));
          if (prefix === 'target' && fleet.target_system_name) element.append(node('span', fleet.target_system_name));
          const map = button('', () => showSystem(fleet, prefix), busy);
          decorateGameAction(map, 'locate', prefix === 'origin' ? 'Herkunft im Spielfeld' : 'Ziel im Spielfeld');
          element.append(map);
          return element;
        };
        const arrow = node('span', returning ? '←' : '→');
        arrow.className = 'game-fleet-route-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        route.append(endpoint('origin', 'Herkunft'), arrow, endpoint('target', 'Ziel'));
        const ships = node('ul');
        ships.className = 'game-development-costs';
        ships.setAttribute('aria-label', 'Schiffe');
        for (const [type, count] of Object.entries(fleet.ships)) {
          if (Number(count) === 0) continue;
          const item = node('li');
          item.append(createGameIcon('fleet'), node('span', `${count} ${type.replaceAll('_', ' ')}`));
          ships.append(item);
        }
        if (!ships.children.length) ships.append(node('li', 'Keine Schiffe'));
        const cargo = node('ul');
        cargo.className = 'game-development-costs';
        cargo.setAttribute('aria-label', 'Fracht');
        for (const [resource, label] of [['metal', 'Metall'], ['crystal', 'Kristall'], ['deuterium', 'Deuterium']]) {
          const item = node('li');
          item.append(createGameIcon(resource), node('span', `${fleet[`cargo_${resource}`]} ${label}`));
          cargo.append(item);
        }
        const arrival = node('p');
        arrival.className = 'game-fleet-arrival';
        arrival.append(node('span', returning ? 'Rückkehr' : 'Ankunft'), node('strong', fleet.arrival_time), node('small', 'Serverzeit'));
        card.append(route, ships, cargo, arrival);
        const details = node('details');
        details.dataset.gameDisclosure = `fleet-times:${fleet.id}`;
        details.append(node('summary', 'Zeitdetails'), node('p', `Abflug: ${fleet.departure_time} (Serverzeit)`));
        card.append(details);
        const controls = node('div');
        controls.className = 'game-development-actions';
        controls.append(
          button('Flotte zurückrufen', () => { if (!disposed) void domain.command('recall', fleet.id); }, busy || state.stale || returning),
        );
        card.append(controls);
        list.append(card);
      }
      content.append(list);
      const measurements = node('details');
      measurements.className = 'game-fleet-measurements';
      measurements.dataset.gameDisclosure = 'fleet-table';
      measurements.append(node('summary', 'Einsätze als Tabelle'),
        node('p', 'Gesamter geladener Accountstand; Tabellenfilter sind unabhängig von den Kartenfiltern. Zeitangaben sind Serverwerte, keine Restzeitprognose.'));
      const tableMissions = [...new Set(state.fleets.map(fleet => fleet.mission))];
      const selectedMission = tableState.filters.mission;
      if (selectedMission && !tableMissions.includes(selectedMission)) tableMissions.push(selectedMission);
      const coordinates = (fleet, prefix) => `[${fleet[`${prefix}_galaxy`]}:${fleet[`${prefix}_system`]}:${fleet[`${prefix}_position`]}]`;
      const compareCoordinates = (prefix) => (a, b) => {
        for (const axis of ['galaxy', 'system', 'position']) {
          const difference = Number(a[`${prefix}_${axis}`]) - Number(b[`${prefix}_${axis}`]);
          if (difference) return difference;
        }
        return 0;
      };
      const table = view.widget('dataTable', measurements, {
        caption: 'Flotteneinsätze · accountweiter Serverstand', searchable: true,
        state: tableState, onStateChange: (next) => { tableState = next; },
        emptyText: 'Keine laufenden Flottenmissionen.',
        labels: {
          toolbar: 'Werkzeuge der Einsatztabelle',
          clearSearch: 'Tabellensuche leeren', removeFilter: (column, value) => `Filter entfernen: ${column}: ${value}`,
          ascending: 'aufsteigend', descending: 'absteigend', clearSort: 'Sortierung aufheben',
          sort: (column, direction) => `${column}: ${direction}`,
          nextSort: (column, direction) => `${column} ${direction} sortieren`,
          search: 'Einsatztabelle durchsuchen', reset: 'Tabellenfilter zurücksetzen', all: 'Alle',
          noMatches: 'Keine Einsätze für diese Tabellensuche und Filter.',
          results: (visible, total) => `${visible} von ${total} Flotteneinsätzen angezeigt.`,
        },
        columns: [
          { id: 'fleet_label', label: 'Flotte', rowHeader: true, sortable: true,
            value: fleet => fleet.fleet_label || `Flotte ${fleet.id}` },
          { id: 'mission', label: 'Mission', sortable: true,
            value: fleet => createFleetMissionBadge(fleet.mission).textContent,
            searchValue: fleet => `${fleet.mission} ${createFleetMissionBadge(fleet.mission).textContent}`,
            render: (cell, fleet) => cell.append(createFleetMissionBadge(fleet.mission)),
            filter: {
              label: 'Tabellenmission',
              options: tableMissions.map(mission => ({ value: mission, label: createFleetMissionBadge(mission).textContent })),
              value: fleet => fleet.mission,
            } },
          { id: 'returning', label: 'Richtung', sortable: true,
            value: fleet => Number(fleet.returning) === 1 ? 'Rückflug' : 'Hinflug',
            filter: {
              label: 'Tabellenflugrichtung',
              options: [{ value: 'outbound', label: 'Hinflug' }, { value: 'return', label: 'Rückflug' }],
              value: fleet => Number(fleet.returning) === 1 ? 'return' : 'outbound',
            } },
          { id: 'origin', label: 'Herkunft', compare: compareCoordinates('origin'), value: fleet => coordinates(fleet, 'origin') },
          { id: 'target', label: 'Ziel', compare: compareCoordinates('target'),
            value: fleet => `${coordinates(fleet, 'target')}${fleet.target_system_name ? ` ${fleet.target_system_name}` : ''}` },
          { id: 'ships', label: 'Schiffe', numeric: true, sortable: true,
            value: fleet => Object.values(fleet.ships).reduce((total, count) => total + Number(count), 0),
            searchValue: fleet => Object.entries(fleet.ships).map(([type, count]) => `${count} ${type.replaceAll('_', ' ')}`).join(' ') },
          { id: 'arrival_time', label: 'Ankunft / Rückkehr (Serverzeit)', sortable: true },
        ],
        items: state.fleets,
      });
      table.el.classList.add('game-fleet-table');
      table.el.dataset.gameTable = 'fleet-missions';
      content.append(measurements);
    } else content.append(arrivals);
    const help = node('details');
    help.className = 'game-fleet-dashboard-help';
    help.dataset.gameDisclosure = 'fleet-help';
    help.append(node('summary', 'Serverstand und Missionsverarbeitung'),
      node('p', 'Accountweite Serverdaten. Öffnen und Aktualisieren verarbeiten keine Ankünfte. Fällige Ankünfte werden nur auf ausdrücklichen Befehl verarbeitet; der Server entscheidet über Fortschritt und Ergebnisse.'));
    content.append(help);
    view.commit(root, content);
  }
  wm.register('fleet', { title: 'Flotten', w: 720, h: 560,
    onRender() { render(); void domain.load(); } });
  const unsubscribe = domain.subscribe(render);
  const open = (event) => {
    if (!disposed && event.target.closest?.('[data-game-fleets]')) wm.open('fleet');
  };
  document.addEventListener('click', open);
  return () => {
    disposed = true;
    unsubscribe();
    document.removeEventListener('click', open);
    wm.close('fleet');
    view.destroy();
    wm.register('fleet', { onRender: null });
  };
}
