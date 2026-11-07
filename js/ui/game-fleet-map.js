import { FLEET_MISSIONS } from '../engine/runtime/server-fleet-launch-domain.js';

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

export function mountFleetMap({ domain, galaxy, renderer, session, stage }) {
  const markers = node('div');
  markers.id = 'game-fleet-markers';
  markers.setAttribute('aria-label', 'Flottenendpunkte');
  const context = node('section');
  context.id = 'game-fleet-context';
  context.setAttribute('aria-label', 'Flotten am Kartenpunkt');
  context.hidden = true;
  const status = node('section');
  status.id = 'game-fleet-map-status';
  status.hidden = true;
  stage.append(markers, context, status);
  let state = domain.getState();
  let selected = null;
  let points = [];
  let picking = false;
  let disposed = false;
  let stopProjection = null;
  const badges = new Map();
  function close(focus = false) {
    const restoreFocus = focus || context.contains(document.activeElement);
    selected = null;
    context.hidden = true;
    status.hidden = picking || !state.error;
    for (const badge of badges.values()) badge.setAttribute('aria-pressed', 'false');
    if (restoreFocus) document.getElementById('starfield')?.focus({ preventScroll: true });
  }
  function renderContext() {
    const point = points.find((entry) => entry.key === selected);
    if (!point || picking) { close(); return; }
    const activeAction = context.contains(document.activeElement)
      ? document.activeElement.dataset.fleetAction : null;
    const busy = state.loading || state.mutating;
    context.hidden = false;
    status.hidden = true;
    const closeButton = button('Flottenauswahl schließen', () => close(true));
    closeButton.dataset.fleetAction = 'close';
    context.replaceChildren(
      node('h3', `Flotten bei [${point.galaxy}:${point.system}${point.position === null ? '' : `:${point.position}`}]`),
      closeButton,
    );
    const message = node('p', state.error || (busy ? 'Serveranfrage läuft ...' : state.message));
    message.setAttribute('role', state.error ? 'alert' : 'status');
    context.append(message);
    if (state.stale) context.append(node('p', 'Letzter bestätigter Stand. Vor weiteren Befehlen aktualisieren.'));
    for (const fleet of state.fleets || []) {
      if (!point.fleetIds.includes(Number(fleet.id))) continue;
      const card = node('article');
      card.dataset.fleetId = String(fleet.id);
      const returning = Number(fleet.returning) === 1;
      const hullDamage = Number(fleet.hull_damage_pct);
      const hullStatus = node('div');
      hullStatus.className = 'game-fleet-hull-status';
      hullStatus.setAttribute('role', 'group');
      hullStatus.setAttribute('aria-label', `Hüllenschaden: ${hullDamage}%; Angriffsmalus: ${hullDamage}%`);
      const hullLabel = node('span', `Hüllenschaden ${hullDamage}%`);
      const hullMeter = node('progress');
      hullMeter.className = 'game-fleet-hull-meter';
      hullMeter.max = 100;
      hullMeter.value = hullDamage;
      hullMeter.setAttribute('aria-label', `Hüllenschaden von Flotte ${fleet.fleet_label || fleet.id}`);
      const hullValue = node('span', `-${hullDamage}% Angriff`);
      hullStatus.append(hullLabel, hullMeter, hullValue);
      card.append(node('h4', fleet.fleet_label || `Flotte ${fleet.id}`),
        node('p', `${FLEET_MISSIONS[fleet.mission] || fleet.mission} · ${returning ? 'Rückflug' : 'Hinflug'}`),
        hullStatus,
        node('p', `Herkunft [${fleet.origin_galaxy}:${fleet.origin_system}:${fleet.origin_position}] → Ziel [${fleet.target_galaxy}:${fleet.target_system}:${fleet.target_position}]`),
        node('p', `Schiffe: ${Object.entries(fleet.ships).map(([type, count]) => `${count} ${type.replaceAll('_', ' ')}`).join(', ')}`),
        node('p', `Fracht: ${fleet.cargo_metal} Metall · ${fleet.cargo_crystal} Kristall · ${fleet.cargo_deuterium} Deuterium`),
        node('p', `${returning ? 'Rückkehr' : 'Ankunft'}: ${fleet.arrival_time} (Serverzeit)`));
      const actions = node('div');
      actions.className = 'game-development-actions';
      for (const [prefix, label] of [['origin', 'Herkunft'], ['target', 'Ziel']]) {
        const navigate = button(`${label} im Spielfeld`, () => {
          close(true);
          void galaxy.navigate(fleet[`${prefix}_galaxy`], fleet[`${prefix}_system`]);
        }, busy);
        navigate.dataset.fleetAction = `${prefix}-${fleet.id}`;
        actions.append(navigate);
      }
      const recall = button('Flotte zurückrufen', () => { void domain.command('recall', fleet.id); },
        busy || state.stale || returning);
      recall.dataset.fleetAction = `recall-${fleet.id}`;
      actions.append(recall);
      card.append(actions);
      context.append(card);
    }
    context.append(
      button('Flotten aktualisieren', () => { void domain.refresh(); }, busy),
      button('Fällige Ankünfte verarbeiten', () => { void domain.command('check'); }, busy || state.stale),
      node('p', 'Markierungen zeigen Herkunft und Ziel, nicht die aktuelle Flugposition oder eine gemeinsame Transitbahn. Ankünfte werden nur auf ausdrücklichen Befehl verarbeitet.'),
    );
    if (activeAction) {
      const replacement = [...context.querySelectorAll('button')]
        .find((item) => item.dataset.fleetAction === activeAction);
      (replacement && !replacement.disabled ? replacement : closeButton).focus({ preventScroll: true });
    }
  }
  function project(next) {
    if (disposed) return;
    const rect = stage.getBoundingClientRect();
    const previousSelection = points.find((point) => point.key === selected)?.fleetIds.join(',');
    points = next;
    const keys = new Set(next.map((point) => point.key));
    let restoreCanvasFocus = false;
    for (const [key, badge] of badges) {
      if (!keys.has(key)) {
        restoreCanvasFocus ||= badge === document.activeElement;
        badge.remove();
        badges.delete(key);
      }
    }
    for (const point of next) {
      let badge = badges.get(point.key);
      if (!badge) {
        badge = button('', () => {
          if (picking || disposed) return;
          selected = point.key;
          for (const [key, element] of badges) element.setAttribute('aria-pressed', String(key === selected));
          renderContext();
          context.querySelector('button')?.focus({ preventScroll: true });
        });
        badge.dataset.endpoint = point.key;
        badges.set(point.key, badge);
        markers.append(badge);
      }
      badge.textContent = `F ${point.fleetIds.length}`;
      badge.setAttribute('aria-label', `Flotten bei ${point.key.replace(':*', '')}: ${point.fleetIds.length} Missionen`);
      badge.setAttribute('aria-pressed', String(point.key === selected));
      badge.style.left = `${Math.max(4, Math.min(rect.width - 60, point.x - rect.left + 18))}px`;
      badge.style.top = `${Math.max(64, Math.min(rect.height - 44, point.y - rect.top - 36))}px`;
    }
    if (selected !== null && !keys.has(selected)) close();
    else if (selected !== null && previousSelection !== points.find((point) => point.key === selected)?.fleetIds.join(',')) {
      renderContext();
    }
    if (restoreCanvasFocus) document.getElementById('starfield')?.focus({ preventScroll: true });
  }
  function update(next) {
    state = next;
    if (state.fleets?.length) {
      if (!stopProjection) stopProjection = renderer.observeFleetEndpoints(() => state.fleets || [], project);
    } else {
      stopProjection?.();
      stopProjection = null;
      project([]);
    }
    status.hidden = picking || selected !== null || !state.error;
    if (state.error) {
      const error = node('p', state.error);
      error.setAttribute('role', 'alert');
      status.replaceChildren(error, button('Flotten aktualisieren', () => { void domain.refresh(); },
        state.loading || state.mutating));
    }
    renderContext();
  }
  const unsubscribe = domain.subscribe(update);
  const unsubscribePicking = session.events.on('fleet:target-picking', ({ active }) => {
    picking = active;
    markers.hidden = active;
    status.hidden = active || !state.error;
    if (active) close();
  });
  const unsubscribeOriginPicking = session.events.on('fleet:origin-picking', ({ active }) => {
    picking = active;
    markers.hidden = active;
    status.hidden = active || !state.error;
    if (active) close();
  });
  const escape = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || selected === null || picking) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close(true);
  };
  window.addEventListener('keydown', escape);
  update(state);
  void domain.load();
  return () => {
    disposed = true;
    stopProjection?.();
    unsubscribe();
    unsubscribePicking();
    unsubscribeOriginPicking();
    window.removeEventListener('keydown', escape);
    markers.remove();
    context.remove();
    status.remove();
  };
}
