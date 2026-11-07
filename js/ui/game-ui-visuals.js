import { FLEET_MISSIONS } from '../engine/runtime/server-fleet-launch-domain.js';

const paths = {
  spy: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  goods: 'M3 7l9-4 9 4v13H3V7M3 7h18M9 7v5h6V7',
  steel_alloy: 'M3 5h18v4h-7v6h7v4H3v-4h7V9H3V5',
  focus_crystals: 'M12 2l6 10-6 10-6-10 6-10M2 5l3 3M19 16l3 3M2 19l3-3M19 8l3-3',
  reactor_fuel: 'M7 3h10v18H7V3M7 7h10M13 9l-3 5h4l-3 5',
  biocompost: 'M4 13h16l-2 8H6l-2-8M12 13V8M12 9C5 9 6 3 6 3c5 0 6 3 6 6M12 8c0-5 5-6 7-6 0 4-2 6-7 6',
  electronics_components: 'M7 7h10v10H7V7M10 10h4v4h-4v-4M9 2v5M15 2v5M9 17v5M15 17v5M2 9h5M2 15h5M17 9h5M17 15h5',
  consumer_goods: 'M4 8h16l-1 13H5L4 8M8 8V6a4 4 0 0 1 8 0v2',
  luxury_goods: 'M3 6l4 4 5-7 5 7 4-4-3 15H6L3 6M6 17h12',
  military_equipment: 'M12 2l8 4v7c0 5-8 9-8 9s-8-4-8-9V6l8-4M8 8l8 8M16 8l-8 8',
  research_kits: 'M3 8h18v13H3V8M8 8V4h8v4M12 11v7M9 14h6',
  colonization_packs: 'M3 21V10l9-7 9 7v11H3M8 21v-8h8v8M10 8h4',
  neural_implants: 'M8 4C3 4 2 10 5 12c-3 4 1 9 5 7V5l-2-1M16 4c5 0 6 6 3 8 3 4-1 9-5 7V5l2-1M10 9h4M10 15h4',
  quantum_circuits: 'M4 4h16v16H4V4M4 8h5l6 8h5M4 16h5l6-8h5M9 4v4M15 16v4',
  bio_supplements: 'M8 3h8v4l3 4v10H5V11l3-4V3M8 7h8M12 12v6M9 15h6',
  stellar_art: 'M3 3h18v18H3V3M7 17l4-6 3 3 3-4M8 6v3M6 8h4',
  advanced_propulsion: 'M9 3h6l4 10-7 4-7-4L9 3M9 17l-2 5M12 18v4M15 17l2 5',
  void_crystals: 'M12 3l8 6-3 11H7L4 9l8-6M4 9h16M12 3l-2 6 2 11 2-11-2-6',
  synthetic_consciousness: 'M5 5h14v14H5V5M9 9h.01M15 9h.01M8 14c2 2 6 2 8 0M12 2v3M8 19v3M16 19v3M2 8h3M19 8h3',
  temporal_luxuries: 'M6 3h12M6 21h12M8 3v4l8 10v4M16 3v4L8 17v4M9 6h6M9 18h6',
  energy: 'M13 2L4 14h7l-1 8 10-13h-8l1-7',
  star: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  close: 'M6 6l12 12M18 6L6 18',
  happiness: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M8 14c2 3 6 3 8 0M8 9h.01M16 9h.01',
  employment: 'M3 7h18v14H3V7M8 7V3h8v4M3 12h18M10 12v3h4v-3',
  growth: 'M3 18l6-6 4 3 8-11M15 4h6v6',
  warning: 'M12 3l10 18H2L12 3M12 9v5M12 17h.01',
  buildings: 'M3 21V9l9-6 9 6v12H3M8 21v-7h8v7M8 9h.01M16 9h.01',
  research: 'M9 3h6M10 3v7L4 20h16l-6-10V3M8 14h8',
  population: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-3a7 7 0 0 1 14 0v3M17 4a4 4 0 0 1 0 8M19 15a5 5 0 0 1 3 4v2',
  shipyard: 'M3 14h18l-3 6H6l-3-6M7 14V8h10v6M12 8V3M9 5h6',
  fleet: 'M12 2l9 19-9-5-9 5 9-19M12 2v14',
  economy: 'M3 21h18M6 17v-6h3v6M11 17V7h3v10M16 17V3h3v14',
  trade: 'M3 7h17l-4-4M21 17H4l4 4M20 7l-4 4M4 17l4-4',
  planet: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0M3 17c-5-2 8-12 17-11 5 2-8 12-17 11',
  locate: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v4M12 18v4M2 12h4M18 12h4',
  metal: 'M4 8l8-5 8 5v9l-8 4-8-4V8M4 8l8 5 8-5M12 13v8',
  crystal: 'M8 3h8l5 8-9 10-9-10 5-8M8 3l4 18 4-18M3 11h18',
  deuterium: 'M12 2C10 6 5 11 5 15a7 7 0 0 0 14 0c0-4-5-9-7-13M8 15a4 4 0 0 0 4 4',
  food: 'M12 22V10M12 14C3 14 3 8 3 5c6 0 9 3 9 9M12 10c0-7 6-8 9-8 0 6-3 8-9 8',
  rare_earth: 'M12 2l3 6 7 4-7 4-3 6-3-6-7-4 7-4 3-6',
};

export function createGameIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('game-ui-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', Object.hasOwn(paths, name) ? paths[name] : paths.goods);
  svg.append(path);
  return svg;
}

export function decorateGameAction(control, name, label) {
  const caption = document.createElement('span');
  caption.textContent = label;
  control.classList.add('game-visual-action');
  control.title = label;
  control.append(createGameIcon(name), caption);
}

export function createFleetMissionBadge(mission) {
  const icons = {
    transport: 'goods', attack: 'military_equipment', spy: 'spy',
    colonize: 'colonization_packs', harvest: 'metal', survey: 'locate',
  };
  const known = Object.hasOwn(FLEET_MISSIONS, mission);
  const badge = document.createElement('span');
  badge.className = 'game-fleet-mission';
  badge.dataset.mission = known ? mission : 'unknown';
  const caption = document.createElement('span');
  caption.textContent = known ? FLEET_MISSIONS[mission] : `Mission: ${mission.replaceAll('_', ' ')}`;
  badge.append(createGameIcon(known ? icons[mission] : 'fleet'), caption);
  return badge;
}

export function createResourceCostChips(cost, label) {
  const chips = document.createElement('ul');
  chips.className = 'game-development-costs';
  chips.setAttribute('aria-label', label);
  for (const [key, value] of Object.entries(cost)) {
    if (Number(value) === 0) continue;
    const chip = document.createElement('li');
    const measured = (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== ''
      && Number.isFinite(Number(value)) && Number(value) >= 0;
    const caption = document.createElement('span');
    caption.textContent = `${measured ? value : 'Nicht verfügbar'} ${key.replaceAll('_', ' ')}`;
    chip.append(createGameIcon(key), caption);
    chips.append(chip);
  }
  if (!chips.children.length) {
    const empty = document.createElement('li');
    empty.textContent = '0';
    chips.append(empty);
  }
  return chips;
}

const goods = [
  ['metal', 'Metall'], ['crystal', 'Kristall'], ['deuterium', 'Deuterium'],
  ['food', 'Nahrung'], ['rare_earth', 'Seltene Erden'],
];

export function createStockChart(colony) {
  const figure = document.createElement('figure');
  figure.className = 'game-stock-chart';
  const caption = document.createElement('figcaption');
  caption.textContent = 'Lagerbestände';
  const note = document.createElement('p');
  note.textContent = 'Relativ zum größten angezeigten Bestand; keine Lagerkapazität.';
  const values = goods.map(([key]) => {
    const raw = colony?.[key];
    return (typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== ''))
      && Number.isFinite(Number(raw)) ? Number(raw) : null;
  });
  const maximum = Math.max(0, ...values.filter((value) => value !== null));
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
  figure.append(caption);
  goods.forEach(([key, name], index) => {
    const row = document.createElement('div');
    row.className = 'game-stock-row';
    row.dataset.resource = key;
    const label = document.createElement('span');
    label.className = 'game-stock-label';
    label.append(createGameIcon(key), document.createTextNode(name));
    const value = document.createElement('span');
    value.className = 'game-stock-value';
    value.textContent = values[index] === null ? 'Nicht verfügbar' : formatter.format(values[index]);
    const track = document.createElement('span');
    track.className = 'game-stock-track';
    track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    bar.style.width = `${maximum > 0 ? Math.max(0, values[index] ?? 0) / maximum * 100 : 0}%`;
    track.append(bar);
    row.append(label, value, track);
    figure.append(row);
  });
  figure.append(note);
  return figure;
}
