import { createGameIcon } from './game-ui-visuals.js';

const names = { metal: 'Metall', crystal: 'Kristall', deuterium: 'Deuterium', food: 'Nahrung', rare_earth: 'Seltene Erden' };
const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const quantity = (value) => finite(value) ? format.format(value) : 'Nicht verfügbar';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function createEconomyResourceCards(snapshot, { selectedResource, onInspect }) {
  const grid = node('section', undefined, 'game-economy-cards');
  grid.setAttribute('aria-label', 'Ressourcenübersicht');
  const { economy, storage } = snapshot;
  const rates = [...Object.values(economy.production || {}), ...Object.values(economy.consumption || {})];
  const scale = Math.max(0, ...rates.filter(finite).map(Math.abs));
  for (const [good, stock] of Object.entries(economy.stock)) {
    const card = node('article', undefined, 'game-economy-resource-card');
    card.dataset.resourceCard = good;
    card.setAttribute('aria-current', String(good === selectedResource));
    const inspect = node('button', undefined, 'game-visual-action');
    inspect.type = 'button';
    const name = names[good] || good.replaceAll('_', ' ');
    inspect.append(createGameIcon(good), node('span', name));
    inspect.setAttribute('aria-label', `${name} Bestandsdetails`);
    inspect.addEventListener('click', () => onInspect(good));
    const amount = node('strong', quantity(stock), 'game-economy-amount');
    const capacity = storage[good];
    card.append(inspect, amount, node('span', `Kapazität: ${quantity(capacity)}`));
    if (finite(stock) && finite(capacity) && capacity > 0) {
      const meter = node('meter');
      meter.min = 0;
      meter.max = capacity;
      meter.value = Math.max(0, Math.min(capacity, stock));
      meter.setAttribute('aria-label', `${name} Lagerfüllung`);
      card.append(meter);
      if (stock > capacity) card.append(node('span', 'Über Kapazität', 'game-economy-deficit'));
    }
    const production = economy.production?.[good];
    const consumption = economy.consumption?.[good];
    for (const [label, value, type] of [
      ['Produktion/h', production, 'production'], ['Verbrauch/h', consumption, 'consumption'],
    ]) {
      const row = node('div', undefined, 'game-economy-rate');
      row.dataset.rate = type;
      row.append(node('span', label), node('span', quantity(value)));
      const track = node('span', undefined, 'game-economy-rate-track');
      track.setAttribute('aria-hidden', 'true');
      const bar = node('span');
      bar.style.width = `${scale > 0 && finite(value) ? Math.abs(value) / scale * 100 : 0}%`;
      track.append(bar);
      row.append(track);
      card.append(row);
    }
    const net = finite(production) && finite(consumption) ? production - consumption : null;
    const balance = node('p', `Bilanz/h: ${net === null ? 'Nicht verfügbar' : `${net > 0 ? '+' : ''}${quantity(net)}`}`);
    if (net !== null) balance.className = net < 0 ? 'game-economy-deficit' : 'game-economy-surplus';
    card.append(balance);
    grid.append(card);
  }
  const note = node('p', 'Balken: Betrag relativ zur größten gemeldeten Rate, Einheiten/h. Bilanz nur bei vollständigen Raten. Letzter Serverstand, keine Prognose.');
  note.className = 'game-economy-chart-note';
  grid.append(note);
  return grid;
}
