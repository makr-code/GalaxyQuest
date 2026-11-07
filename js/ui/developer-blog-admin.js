import { blogRequest, estimateBlogSpeech, blogIconButton } from '../network/developer-blog.js';

const form = document.getElementById('blog-editor');
const status = document.getElementById('blog-admin-status');
for (const [selector, icon] of [
  ['#blog-new', 'mail'], ['#blog-prev', 'prev'], ['#blog-next', 'next'],
  ['#blog-reload', 'refresh'], ['#blog-editor button[type="submit"]', 'admin'],
]) blogIconButton(document.querySelector(selector), icon);
blogIconButton(document.querySelector('main > a'), 'back');
let id = 0;
let revision = null;
let page = 1;
let pending = false;
function contents() {
  return JSON.stringify({
    title: form.elements.title.value, body: form.elements.body.value,
    published: form.elements.published.checked,
    categories: form.elements.categories.value, tags: form.elements.tags.value,
    target_faction_id: form.elements.target_faction_id.value,
  });
}
let savedContents = contents();
function isDirty() {
  return contents() !== savedContents;
}
function beforeUnload(event) {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
}
function updateDirtyState() {
  const dirty = isDirty();
  document.getElementById('blog-unsaved').textContent = dirty ? 'Ungespeicherte Änderungen' : '';
  window.removeEventListener('beforeunload', beforeUnload);
  if (dirty) window.addEventListener('beforeunload', beforeUnload);
}
function updateCounts() {
  for (const name of ['title', 'body']) {
    const field = form.elements[name];
    const count = Array.from(field.value).length;
    const limit = Number(field.dataset.maxChars);
    document.getElementById(`blog-${name}-count`).textContent = `${count} / ${limit} Zeichen`;
    field.setCustomValidity(count > limit ? `Bitte auf höchstens ${limit} Zeichen kürzen (${count} Zeichen).` : '');
  }
  document.getElementById('blog-speech-estimate').textContent =
    estimateBlogSpeech(form.elements.title.value, form.elements.body.value);
}
function edit(post = { id: 0, title: '', body: '', published_at: null }) {
  if (pending || (isDirty() && !window.confirm('Ungespeicherte Änderungen verwerfen?'))) return;
  id = post.id;
  revision = post.revision ?? null;
  form.elements.title.value = post.title;
  form.elements.body.value = post.body;
  form.elements.published.checked = post.published_at !== null;
  form.elements.categories.value = (post.categories ?? ['entwicklung']).join(', ');
  form.elements.tags.value = (post.tags ?? []).join(', ');
  form.elements.target_faction_id.value = post.target_faction_id == null ? '' : String(post.target_faction_id);
  savedContents = contents();
  updateDirtyState();
  updateCounts();
  form.elements.title.focus();
}
async function load(targetPage = page) {
  const data = await blogRequest(`admin_list&page=${targetPage}`);
  if (!Array.isArray(data.posts) || typeof data.has_more !== 'boolean') {
    throw new Error('Ungültige Redaktionsdaten.');
  }
  page = targetPage;
  const targets = form.elements.target_faction_id;
  const selectedTarget = targets.value;
  targets.replaceChildren(new Option('Kein Flugziel', ''), ...(data.flight_targets ?? []).map(target =>
    new Option(`${target.code} · ${target.homeworld}`, String(target.faction_id))));
  if (selectedTarget && !Array.from(targets.options).some(option => option.value === selectedTarget)) {
    targets.add(new Option('Bisheriges Flugziel nicht verfügbar', selectedTarget));
  }
  targets.value = selectedTarget;
  const list = document.getElementById('blog-admin-posts');
  list.replaceChildren(...data.posts.map(post => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${post.published_at ? 'Veröffentlicht' : 'Entwurf'} · ${post.title}`;
    button.addEventListener('click', () => edit(post));
    return button;
  }));
  document.getElementById('blog-prev').disabled = page === 1;
  document.getElementById('blog-next').disabled = !data.has_more;
}
async function act(action) {
  if (pending) return;
  const focus = document.activeElement;
  pending = true;
  form.inert = true;
  document.querySelectorAll('nav').forEach(nav => { nav.inert = true; });
  status.textContent = 'Anfrage läuft …';
  try { await action(); status.textContent = 'Redaktion aktualisiert.'; }
  catch (error) { status.textContent = error.message; window.GQLog?.error?.('[blog-admin]', error.message); }
  finally {
    pending = false;
    form.inert = false;
    document.querySelectorAll('nav').forEach(nav => { nav.inert = false; });
    if (focus?.isConnected && !focus.disabled) focus.focus();
  }
}
document.getElementById('blog-new').addEventListener('click', () => edit());
document.getElementById('blog-prev').addEventListener('click', () => act(() => load(page - 1)));
document.getElementById('blog-next').addEventListener('click', () => act(() => load(page + 1)));
document.getElementById('blog-reload').addEventListener('click', () => act(() => load()));
form.addEventListener('submit', event => {
  event.preventDefault();
  updateCounts();
  if (!form.reportValidity()) return;
  void act(async () => {
    const data = await blogRequest('save', {
      id, title: form.elements.title.value, body: form.elements.body.value,
      published: form.elements.published.checked,
      revision,
      categories: form.elements.categories.value.split(',').map(term => term.trim()),
      tags: form.elements.tags.value.trim() ? form.elements.tags.value.split(',').map(term => term.trim()) : [],
      target_faction_id: form.elements.target_faction_id.value ? Number(form.elements.target_faction_id.value) : null,
    });
    id = data.id;
    revision = data.revision;
    savedContents = contents();
    updateDirtyState();
    window.dispatchEvent(new Event('gq:blog-updated'));
    try { await load(); }
    catch (error) {
      throw new Error(`Beitrag gespeichert, aber die Beitragsliste konnte nicht aktualisiert werden: ${error.message}`);
    }
  });
});
form.addEventListener('input', () => { updateCounts(); updateDirtyState(); });
form.addEventListener('change', updateDirtyState);
updateCounts();
void act(load);
