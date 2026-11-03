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
  let disposed = false;
  function showSystem(fleet, prefix) {
    if (disposed) return;
    wm.minimize('fleet');
    void galaxy.navigate(fleet[`${prefix}_galaxy`], fleet[`${prefix}_system`]);
  }
  function render() {
    const root = wm.body('fleet');
    if (disposed || !root) return;
    const state = domain.getState();
    const busy = state.loading || state.mutating;
    const content = node('section');
    content.className = 'game-development';
    content.dataset.domain = 'fleets';
    content.append(node('h2', 'Flotten'));
    const actions = node('div');
    actions.className = 'game-development-actions';
    actions.append(
      button('Flotten aktualisieren', () => { if (!disposed) void domain.refresh(); }, busy),
      button('Fällige Ankünfte verarbeiten', () => { if (!disposed) void domain.command('check'); }, busy || state.stale || state.fleets === null),
    );
    const launch = node('button', 'Neue Flotte zusammenstellen');
    launch.type = 'button';
    launch.className = 'btn btn-secondary btn-sm';
    launch.dataset.gameFleetLaunch = '';
    actions.append(launch);
    content.append(actions);
    const status = node('p', state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    status.setAttribute('role', state.error ? 'alert' : 'status');
    content.append(status);
    if (state.stale && state.fleets !== null) content.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Befehlen aktualisieren.'));
    if (state.fleets !== null) {
      if (!state.fleets.length) content.append(node('p', 'Keine laufenden Flottenmissionen.'));
      const list = node('div');
      list.className = 'game-development-list';
      list.setAttribute('aria-label', 'Flottenmissionen');
      for (const fleet of state.fleets) {
        const returning = Number(fleet.returning) === 1;
        const card = node('article');
        card.className = 'game-development-card';
        card.dataset.fleetId = String(fleet.id);
        card.append(node('h3', fleet.fleet_label || `Flotte ${fleet.id}`));
        card.append(node('p', `${fleet.mission.replaceAll('_', ' ')} · ${returning ? 'Rückflug' : 'Hinflug'}`));
        card.append(node('p', `Herkunft [${fleet.origin_galaxy}:${fleet.origin_system}:${fleet.origin_position}] → Ziel [${fleet.target_galaxy}:${fleet.target_system}:${fleet.target_position}]${fleet.target_system_name ? ` · ${fleet.target_system_name}` : ''}`));
        card.append(node('p', `Schiffe: ${Object.entries(fleet.ships).map(([type, count]) => `${count} ${type.replaceAll('_', ' ')}`).join(', ') || 'Keine'}`));
        card.append(node('p', `Fracht: ${fleet.cargo_metal} Metall · ${fleet.cargo_crystal} Kristall · ${fleet.cargo_deuterium} Deuterium`));
        card.append(node('p', `Abflug: ${fleet.departure_time} · ${returning ? 'Rückkehr' : 'Ankunft'}: ${fleet.arrival_time} (Serverzeit)`));
        const controls = node('div');
        controls.className = 'game-development-actions';
        controls.append(
          button('Herkunft im Spielfeld', () => showSystem(fleet, 'origin'), busy),
          button('Ziel im Spielfeld', () => showSystem(fleet, 'target'), busy),
          button('Flotte zurückrufen', () => { if (!disposed) void domain.command('recall', fleet.id); }, busy || state.stale || returning),
        );
        card.append(controls);
        list.append(card);
      }
      content.append(list);
    }
    content.append(node('p', 'Accountweite Serverdaten. Öffnen und Aktualisieren verarbeiten keine Ankünfte. Fällige Ankünfte werden nur auf ausdrücklichen Befehl verarbeitet; der Server entscheidet über Fortschritt und Ergebnisse.'));
    root.replaceChildren(content);
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
    wm.register('fleet', { onRender: null });
  };
}
