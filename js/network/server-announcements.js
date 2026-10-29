export function initializeServerAnnouncements({ beforeOpen = () => true, fetchImpl = globalThis.fetch } = {}) {
  const dialog = document.getElementById('server-announcements-dialog');
  const trigger = document.getElementById('start-announcements');
  const status = document.getElementById('server-announcements-status');
  const list = document.getElementById('server-announcements-list');
  const badge = document.getElementById('start-announcements-status');
  const storageKey = 'gq_seen_server_announcements';
  let announcements = [];
  let seen = new Set();
  let pending = false;
  let automatic = true;
  let returnFocus = null;
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(stored) || !stored.every(Number.isSafeInteger)) throw new Error('Invalid saved announcement state');
    seen = new Set(stored);
  } catch (error) {
    status.textContent = `Read state could not be loaded: ${error.message}`;
    window.GQLog?.warn?.('[announcements]', status.textContent);
  }

  function close() {
    automatic = false;
    if (!dialog.open) return;
    dialog.close();
    trigger.setAttribute('aria-expanded', 'false');
    returnFocus?.focus();
  }

  function autoOpen() {
    if (automatic && announcements.some((item) => !seen.has(item.id))
      && document.body.classList.contains('auth-page') && open()) automatic = false;
  }

  function open() {
    if (dialog.open || !beforeOpen()) return false;
    returnFocus = document.activeElement;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    for (const item of announcements) seen.add(item.id);
    badge.textContent = `${announcements.length} active`;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...seen].slice(-500)));
    } catch (error) {
      status.textContent = `Read state could not be saved: ${error.message}`;
      window.GQLog?.warn?.('[announcements]', status.textContent);
    }
    return true;
  }

  async function refresh() {
    if (pending) return;
    pending = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetchImpl('api/v1/server_announcements.php?action=list', {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.success !== true || !Array.isArray(data.announcements)
        || !data.announcements.every((item) => Number.isSafeInteger(item.id) && item.id > 0
          && typeof item.title === 'string' && typeof item.message === 'string'
          && typeof item.published_at === 'string'
          && ['important', 'maintenance', 'critical'].includes(item.severity))) {
        throw new Error('Invalid server announcement response');
      }
      announcements = data.announcements;
      list.replaceChildren();
      for (const item of announcements) {
        const article = document.createElement('article');
        article.className = 'server-announcement';
        article.dataset.severity = item.severity;
        const heading = document.createElement('h3');
        heading.textContent = item.title;
        const meta = document.createElement('p');
        meta.className = 'start-eyebrow';
        meta.textContent = `${item.severity} / ${item.published_at}`;
        const message = document.createElement('p');
        message.className = 'server-announcement-message';
        message.textContent = item.message;
        article.append(meta, heading, message);
        list.append(article);
      }
      const unread = announcements.filter((item) => !seen.has(item.id)).length;
      badge.textContent = unread ? `${unread} new` : `${announcements.length} active`;
      status.textContent = announcements.length ? '' : 'No active server announcements.';
      autoOpen();
    } catch (error) {
      status.textContent = `Server announcements could not be loaded: ${error.message}`;
      badge.textContent = 'Unavailable';
      window.GQLog?.warn?.('[announcements]', status.textContent);
    } finally {
      clearTimeout(timer);
      pending = false;
    }
  }

  trigger.addEventListener('click', () => {
    automatic = false;
    open();
  });
  dialog.querySelector('[data-announcements-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  document.getElementById('server-announcements-refresh').addEventListener('click', refresh);
  window.addEventListener('gq:authenticated', close);
  window.addEventListener('gq:start-panel-closed', () => queueMicrotask(autoOpen));
  const ready = refresh();
  return { close, ready };
}
