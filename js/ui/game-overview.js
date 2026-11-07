export function mountGameOverview(session, user) {
  const el = (id) => document.getElementById(id);
  const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const number = (value) => value !== null && value !== undefined && value !== ''
    && Number.isFinite(Number(value)) ? formatter.format(Number(value)) : '\u2014';
  const select = el('game-colony-select');
  const status = el('game-data-status');
  const refresh = el('topbar-title-btn');
  const setStatus = (message, state) => {
    status.textContent = message;
    status.dataset.state = state;
  };
  const resources = {
    metal: 'metal', crystal: 'crystal', deuterium: 'deuterium', food: 'food',
    'rare-earth': 'rare_earth', population: 'population', happiness: 'happiness', energy: 'energy',
  };
  let disposed = false;
  let pending = false;
  function render() {
    const state = session.getState();
    const colony = session.getColony();
    select.replaceChildren(...(state?.colonies ?? []).map((entry) => {
      const option = document.createElement('option');
      option.value = String(entry.id);
      option.textContent = `${entry.name} [${entry.galaxy}:${entry.system}:${entry.position}]`;
      return option;
    }));
    select.disabled = !state?.colonies.length;
    if (colony) select.value = String(colony.id);
    el('commander-name').textContent = user.username;
    el('topbar-coords').textContent = colony ? `[${colony.galaxy}:${colony.system}:${colony.position}]` : '';
    for (const [id, key] of Object.entries(resources)) {
      el(`res-${id}`).textContent = number(colony?.[key]);
    }
    el('res-dark-matter').textContent = number(state?.user_meta?.dark_matter);
    setStatus(!state ? '' : colony ? 'Serverdaten geladen.' : 'Keine Kolonie vorhanden.', !state ? 'idle' : colony ? 'ready' : 'empty');
  }
  async function reload() {
    if (pending) return;
    pending = true;
    refresh.disabled = true;
    refresh.setAttribute('aria-busy', 'true');
    refresh.classList.add('is-refreshing');
    setStatus('Serverdaten werden aktualisiert ...', 'loading');
    try {
      await session.refresh();
    } catch (error) {
      if (!disposed) {
        setStatus(`Aktualisierung fehlgeschlagen: ${error.message}`, 'error');
        window.GQLog?.error?.('[game-overview]', error.message);
        window.dispatchEvent(new CustomEvent('gq:game-data-error', { detail: { error } }));
      }
    } finally {
      pending = false;
      if (!disposed) {
        refresh.disabled = false;
        refresh.removeAttribute('aria-busy');
        refresh.classList.remove('is-refreshing');
      }
    }
  }
  const choose = () => session.selectColony(select.value);
  select.addEventListener('change', choose);
  refresh.addEventListener('click', reload);
  const unsubscribe = session.events.on('overview:updated', render);
  render();
  return () => {
    disposed = true;
    unsubscribe();
    select.removeEventListener('change', choose);
    refresh.removeEventListener('click', reload);
    refresh.disabled = false;
    refresh.removeAttribute('aria-busy');
    refresh.classList.remove('is-refreshing');
    for (const id of [...Object.keys(resources), 'dark-matter']) el(`res-${id}`).textContent = '\u2014';
    select.replaceChildren();
    select.disabled = true;
    el('commander-name').textContent = '';
    el('topbar-coords').textContent = '';
    setStatus('', 'idle');
  };
}
