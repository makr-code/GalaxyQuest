export function initializeChronology({ fetchImpl = globalThis.fetch } = {}) {
  const root = document.getElementById('start-chronology');
  if (!root) return;
  const form = root.querySelector('form');
  const list = root.querySelector('#start-chronology-posts');
  const status = root.querySelector('#start-chronology-status');
  const previous = root.querySelector('#start-chronology-previous');
  const next = root.querySelector('#start-chronology-next');
  const pageLabel = root.querySelector('#start-chronology-page');
  let page = 1;
  let pending;
  let generation = 0;
  let filters = { topic: '', from: '', to: '', order: 'desc' };

  async function load(targetPage) {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const current = ++generation;
    previous.disabled = true;
    next.disabled = true;
    status.textContent = 'Chronik wird geladen …';
    const query = new URLSearchParams({ action: 'chronology', page: String(targetPage), ...filters });
    try {
      const response = await fetchImpl(`api/developer_blog.php?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || `HTTP ${response.status}`);
      if (!Array.isArray(data.posts) || data.posts.length > 10 || typeof data.has_more !== 'boolean') {
        throw new Error('Ungültige Chronikdaten.');
      }
      let chapter = '';
      const entries = data.posts.flatMap(post => {
        if (!post || !Number.isSafeInteger(post.id) || post.id < 1
          || typeof post.title !== 'string' || typeof post.summary !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(post.event_date)
          || !['editorial', 'game-event'].includes(post.origin)
          || typeof post.is_correction !== 'boolean'
          || typeof post.url !== 'string') throw new Error('Ungültiger Chronikbeitrag.');
        const url = new URL(post.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('Ungültiger Chroniklink.');
        }
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = post.title;
        const info = document.createElement('p');
        info.textContent = `${post.event_date} UTC · ${post.origin === 'game-event' ? 'Spielereignis' : 'Redaktion / Lore'}${post.is_correction ? ' · Korrektur' : ''}`;
        const summary = document.createElement('p');
        summary.textContent = post.summary;
        item.append(link, info, summary);
        const month = post.event_date.slice(0, 7);
        if (month === chapter) return [item];
        chapter = month;
        const heading = document.createElement('li');
        heading.className = 'chronology-chapter';
        heading.textContent = `Kapitel ${month}`;
        return [heading, item];
      });
      if (current !== generation) return;
      list.replaceChildren(...entries);
      page = targetPage;
      pageLabel.textContent = `Seite ${page}`;
      previous.disabled = page === 1;
      next.disabled = !data.has_more || page >= 9999;
      status.textContent = entries.length ? '' : 'Keine Chronikbeiträge für diese Auswahl.';
    } catch (error) {
      if (current !== generation || controller.signal.aborted) return;
      list.replaceChildren();
      pageLabel.textContent = '';
      status.textContent = `Chronik konnte nicht geladen werden: ${error.message}`;
    }
  }
  root.addEventListener('toggle', () => {
    if (root.open) void load(1);
    else { pending?.abort(); generation++; }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(form);
    filters = { topic: values.get('topic'), from: values.get('from'), to: values.get('to'), order: values.get('order') };
    void load(1);
  });
  previous.addEventListener('click', () => { if (page > 1) void load(page - 1); });
  next.addEventListener('click', () => { if (!next.disabled) void load(page + 1); });
}
