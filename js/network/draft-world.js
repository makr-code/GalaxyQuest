export function initializeDraftWorld({ request, onPreview, onActivate, onLeave }) {
  const root = document.getElementById('draft-world');
  if (!root) throw new Error('Draft-world HTML is missing.');
  const el = (id) => root.querySelector(`#draft-${id}`);
  let current = null;
  let pending = false;
  let active = false;
  let confirmed = false;
  let confirmationToken = null;

  function label(value) { return String(value).replaceAll('_', ' '); }
  function cost(value) {
    return Object.entries(value).filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `${amount} ${label(resource)}`).join(', ');
  }
  function options(id, entries) {
    const select = el(id);
    const selected = select.value;
    select.replaceChildren(...entries.map(({ value, text }) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = text;
      return option;
    }));
    if (entries.some((entry) => String(entry.value) === selected)) select.value = selected;
  }
  function render(data) {
    if (data?.draft_mode !== true || !data.world || !data.state) throw new Error('The server did not return a playable draft.');
    current = data;
    const { world, state } = data;
    el('world-title').textContent = `${world.character.name} / ${world.colony_name}`;
    el('location').textContent = `${world.system_name} [${world.position.galaxy}:${world.position.system}:${world.position.position}] · Privat · Kein Ablaufdatum`;
    el('resources').textContent = Object.entries(state.economy.stock).map(([good, quantity]) => `${label(good)}: ${Math.floor(quantity)}`).join(' · ');
    el('population').textContent = `Bevölkerung: ${Object.values(state.economy.classes).reduce((sum, value) => sum + value, 0)} · Zufriedenheit: ${Math.round(state.economy.satisfaction)}%`;
    el('buildings').textContent = Object.entries(state.buildings).filter(([, level]) => level > 0).map(([type, level]) => `${label(type)} ${level}`).join(' · ');
    el('research-levels').textContent = Object.entries(state.research).filter(([, level]) => level > 0).map(([type, level]) => `${label(type)} ${level}`).join(' · ') || 'Noch keine Forschung abgeschlossen.';
    el('ships').textContent = Object.entries(state.ships).map(([type, count]) => `${label(type)}: ${count}`).join(' · ');
    options('building', data.building_options.map((entry) => ({ value: entry.type, text: `${entry.label} → ${1 + (state.buildings[entry.type] || 0)} (${cost(entry.cost)})` })));
    options('research', data.research_options.map((entry) => ({ value: entry.type, text: `${label(entry.type)} → ${1 + (state.research[entry.type] || 0)} (${cost(entry.cost)})` })));
    options('ship', data.ship_options.map((entry) => ({ value: entry.type, text: `${label(entry.type)} (${cost(entry.cost)} je Schiff)` })));
    options('planet', world.planets.filter((planet) => planet.position !== world.position.position)
      .map((planet) => ({ value: planet.position, text: planet.name })));
    el('queues').replaceChildren(...Object.entries(state.queues).map(([kind, queue]) => {
      const item = document.createElement('li');
      item.textContent = `${label(kind)}: ${label(queue.type)} · ${new Date(queue.end * 1000).toLocaleString()}`;
      return item;
    }));
    el('surveyed').textContent = `Erkundete Positionen: ${state.surveyed.join(', ') || 'noch keine'}`;
    el('status').textContent = state.economy.pending_seconds > 0
      ? 'Offline-Fortschritt wird nachgeholt. Bitte erneut aktualisieren, bevor du Aufträge erteilst.'
      : 'Draft gespeichert. Alle Aufträge bleiben auf deine private Startwelt begrenzt.';
    if (data.email && !el('email').value) el('email').value = data.email;
    if (!el('username').value) el('username').value = state.account_username || world.character.name;
    if (data.confirmation_pending) el('mail-status').textContent = `Bestätigung an ${data.email} angefordert. Dein Draft bleibt bis zur Bestätigung isoliert.`;
    setDisabled();
  }
  function setDisabled() {
    root.querySelectorAll('button').forEach((button) => { button.disabled = pending; });
    el('refresh').disabled = pending || confirmed;
    for (const kind of ['building', 'research', 'ship', 'fleet']) {
      el(`${kind}-form`).querySelector('button').disabled = pending || confirmed
        || !!current?.state.queues[kind] || current?.state.economy.pending_seconds > 0
        || (kind === 'fleet' && !el('planet').options.length);
    }
  }
  async function act(operation) {
    if (pending) return;
    pending = true;
    el('error').textContent = '';
    setDisabled();
    try { await operation(); }
    catch (error) {
      el('error').textContent = error.message;
      window.GQLog?.error?.('[draft-world]', error.message);
    } finally { pending = false; setDisabled(); }
  }
  async function open(data) {
    render(data);
    active = true;
    root.hidden = false;
    document.body.classList.add('draft-playing');
    onPreview({ stage: 'planet', target: data.world.target, stars: data.world.stars, draft: data.world });
    el('world-title').focus();
    render((await request('play', { kind: 'settle' })).draft);
  }
  function close() {
    active = false;
    root.hidden = true;
    document.body.classList.remove('draft-playing');
    onPreview(null);
  }
  async function activate() {
    await onActivate();
    close();
  }
  async function completeConfirmation(result) {
    if (result.draft_mode !== false || !result.user) throw new Error('The server did not confirm world activation.');
    confirmed = true;
    el('confirm-retry').hidden = true;
    el('registration').hidden = true;
    el('activate-retry').hidden = false;
    el('status').textContent = 'E-Mail bestätigt. Dein Fortschritt wurde in die Galaxy übernommen.';
    await activate();
  }
  for (const kind of ['building', 'research', 'ship', 'fleet']) {
    el(`${kind}-form`).addEventListener('submit', (event) => {
      event.preventDefault();
      void act(async () => {
        const input = kind === 'fleet' ? { kind, position: Number(el('planet').value) }
          : { kind, type: el(kind).value, ...(kind === 'ship' ? { count: Number(el('ship-count').value) } : {}) };
        render((await request('play', input)).draft);
      });
    });
  }
  el('refresh').addEventListener('click', () => { void act(async () => render((await request('play', { kind: 'settle' })).draft)); });
  el('leave').addEventListener('click', () => { if (!pending) { close(); onLeave(); } });
  el('email-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void act(async () => {
      await request('send_confirmation', { username: el('username').value.trim(), email: el('email').value.trim(), password: el('password').value });
      el('password').value = '';
      el('mail-status').textContent = 'Bestätigung versendet. Öffne den Link in deiner E-Mail, um deine Adresse zu bestätigen. Du kannst im Draft weiterspielen.';
    });
  });
  async function confirmLink(token) {
    confirmationToken = token;
    active = true;
    root.hidden = false;
    document.body.classList.add('draft-playing');
    el('confirm-retry').hidden = false;
    el('status').textContent = 'Deine E-Mail-Adresse wird bestätigt ...';
    await act(async () => {
      const result = await request('confirm', { token });
      await completeConfirmation(result);
    });
  }
  el('confirm-retry').addEventListener('click', () => { void confirmLink(confirmationToken); });
  el('activate-retry').addEventListener('click', () => { void act(activate); });
  window.addEventListener('gq:draft-entered', () => {
    if (active && current) onPreview({ stage: 'planet', target: current.world.target, stars: current.world.stars, draft: current.world });
  });
  return {
    confirmLink,
    async enter(token) { await open((await request('enter', { prolog_token: token })).draft); },
    async restore() {
      const result = await request('status');
      if (result.draft_mode === false && result.user) {
        await completeConfirmation(result);
        return true;
      }
      if (!result.draft) return false;
      await open(result.draft);
      return true;
    },
    close,
    isActive: () => active,
    hasDraft: () => current !== null && !confirmed,
  };
}
