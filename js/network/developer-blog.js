export function estimateBlogSpeech(title, body) {
  const words = `${title} ${body}`.trim().match(/\S+/gu)?.length ?? 0;
  return words ? `ca. ${Math.max(1, Math.ceil(words / 130))} Min. Vorlesedauer` : 'Noch kein Text zum Vorlesen';
}

export function blogIconButton(button, icon) {
  const label = button.textContent.trim();
  button.title = label;
  button.setAttribute('aria-label', label);
  button.classList.add('blog-icon-button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `gfx/icons/mono/${icon}.svg#icon-${icon}`);
  svg.append(use);
  button.replaceChildren(svg);
}

class BlogRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function blogRequest(action, body = null, { signal, fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, action === 'narration' ? 210000 : 15000);
  try {
    const options = { credentials: 'same-origin', cache: 'no-store', signal: controller.signal };
    if (body !== null) {
      const csrf = await fetchImpl('api/auth.php?action=csrf', options);
      if (!csrf.ok) throw new Error(`CSRF HTTP ${csrf.status}`);
      const token = (await csrf.json())?.token;
      controller.signal.throwIfAborted();
      if (typeof token !== 'string' || !token) throw new Error('CSRF-Token fehlt.');
      Object.assign(options, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify(body),
      });
    }
    const response = await fetchImpl(`api/developer_blog.php?action=${action}`, options);
    const data = await response.json();
    controller.signal.throwIfAborted();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Ungültige Blogantwort.');
    if (!response.ok || data.success !== true) throw new BlogRequestError(
      typeof data.error === 'string' ? data.error : `Blog HTTP ${response.status}`, response.status);
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function initializeDeveloperBlog({ fetchImpl = globalThis.fetch } = {}) {
  const list = document.getElementById('start-news-posts');
  const trigger = document.querySelector('[data-start-panel="news"]');
  const title = document.getElementById('start-news-title');
  const meta = document.getElementById('start-news-meta');
  const taxonomy = document.getElementById('start-news-taxonomy');
  const body = document.getElementById('start-news-body');
  const original = document.getElementById('start-news-original');
  const sourceStatus = document.getElementById('start-news-source');
  const status = document.getElementById('start-news-status');
  const read = document.getElementById('start-news-read');
  const stop = document.getElementById('start-news-stop');
  const refresh = document.getElementById('start-news-refresh');
  const flight = document.getElementById('start-news-flight');
  const flightStatus = document.getElementById('start-news-flight-status');
  blogIconButton(read, 'volume');
  blogIconButton(stop, 'pause');
  blogIconButton(refresh, 'refresh');
  blogIconButton(flight, 'galaxy');
  blogIconButton(document.querySelector('#start-content-dialog [data-start-close]'), 'close');
  const editor = document.querySelector('.start-news-toolbar a');
  blogIconButton(editor, 'admin');
  blogIconButton(original, 'mail');
  const bindings = new AbortController();
  let posts = [];
  let flightTargets = [];
  let selected = null;
  let request = null;
  let audio = null;
  let finishClip = null;
  let revision = 0;
  let loading = false;
  const invalidatedPosts = new Set();
  function canRead(post = selected) {
    return !loading && !bindings.signal.aborted && !!post && !invalidatedPosts.has(post.id);
  }
  function listen(element, event, callback) {
    element.addEventListener(event, callback, { signal: bindings.signal });
  }
  function stopSpeech() {
    const wasSpeaking = request !== null || audio !== null;
    revision++;
    request?.abort();
    request = null;
    audio?.pause();
    audio = null;
    finishClip?.();
    finishClip = null;
    stop.disabled = true;
    read.disabled = !canRead();
    if (wasSpeaking) status.textContent = 'Sprachausgabe gestoppt.';
  }
  function select(post) {
    stopSpeech();
    status.textContent = invalidatedPosts.has(post?.id) ? 'Beitrag nicht mehr aktuell. Bitte Beiträge neu laden.' : '';
    selected = post;
    flight.disabled = !canRead(post) || !flightTargets.some(target => target.faction_id === post?.target_faction_id);
    flightStatus.textContent = '';
    title.textContent = post?.title ?? 'Noch keine Beiträge veröffentlicht.';
    meta.textContent = post ? `Entwicklerblog · ${post.published_at} UTC · ${estimateBlogSpeech(post.title, post.body)}` : '';
    if (post?.truncated) meta.textContent += ' · Gekürzte Fassung für Anzeige und Sprachausgabe';
    const hero = post?.tags?.includes('hero') ?? false;
    title.closest('article').classList.toggle('start-news-hero', hero);
    taxonomy.replaceChildren();
    if (hero) {
      const badge = document.createElement('strong');
      badge.className = 'start-news-hero-badge';
      badge.textContent = 'Wichtige Nachricht';
      taxonomy.append(badge, document.createTextNode(' '));
    }
    if (post) {
      const terms = document.createElement('span');
      terms.textContent = `Kategorien: ${(post.categories ?? ['entwicklung']).join(', ')}${post.tags?.length ? ` · Tags: ${post.tags.join(', ')}` : ''}`;
      taxonomy.append(terms);
    }
    body.textContent = post?.body ?? '';
    original.hidden = !post?.original_url;
    original.removeAttribute('href');
    if (post?.original_url) original.href = post.original_url;
    document.getElementById('start-content-dialog').scrollTop = 0;
    read.disabled = !canRead(post);
    list.querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.postId) === post?.id));
    });
  }
  async function load() {
    if (loading || bindings.signal.aborted) return;
    stopSpeech();
    loading = true;
    read.disabled = true;
    flight.disabled = true;
    refresh.disabled = true;
    status.textContent = 'Beiträge werden geladen …';
    let restoreCardFocus;
    try {
      const data = await blogRequest('list', null, { signal: bindings.signal, fetchImpl });
      const safeLink = link => {
        if (typeof link !== 'string' || !link) return false;
        try {
          const url = new URL(link, window.location.href);
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
        }
        catch { return false; }
      };
      const validTerms = (terms, limit) => terms === undefined || (Array.isArray(terms) && terms.length <= limit
        && terms.every(term => typeof term === 'string' && term.length <= 32));
      if (data.flight_targets !== undefined && (!Array.isArray(data.flight_targets)
        || !data.flight_targets.every(target => target && Number.isSafeInteger(target.faction_id)
          && Number.isInteger(target.position) && target.position > 0
          && [target.galaxy_index, target.system_index, target.x_ly, target.y_ly, target.z_ly].every(Number.isFinite)
          && typeof target.homeworld === 'string' && typeof target.code === 'string'))) {
        throw new Error('Ungültige Flugziele.');
      }
      const validDate = value => {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
        const iso = `${value.replace(' ', 'T')}Z`;
        const date = new Date(iso);
        return Number.isFinite(date.getTime()) && date.toISOString() === iso.replace('Z', '.000Z');
      };
      if (!Array.isArray(data.posts) || data.posts.length > 5 || !data.posts.every(post => post
        && Number.isSafeInteger(post.id) && post.id > 0
        && ((Number.isSafeInteger(post.revision) && post.revision > 0)
          || (typeof post.revision === 'string' && /^wp:[a-f0-9]{64}$/.test(post.revision)))
        && typeof post.title === 'string' && post.title.trim() && Array.from(post.title).length <= 160
        && typeof post.body === 'string' && post.body.trim() && Array.from(post.body).length <= 3000
        && validDate(post.published_at)
        && (post.target_faction_id == null || (Number.isSafeInteger(post.target_faction_id) && post.target_faction_id > 0))
        && validTerms(post.categories, 5) && validTerms(post.tags, 10)
        && (post.original_url === undefined || safeLink(post.original_url)))
        || new Set(data.posts.map(post => post.id)).size !== data.posts.length) {
        throw new Error('Ungültige Blogdaten.');
      }
      if (data.editor_url !== undefined && !safeLink(data.editor_url)) throw new Error('Ungültiger Bloglink.');
      sourceStatus.textContent = data.source === 'wordpress-simulation' ? 'WordPress-Simulation · lokale Testinhalte'
        : data.source === 'wordpress' ? 'WordPress · freigegebene Blogbeiträge' : '';
      editor.href = data.editor_url ?? 'developer-blog-admin.php';
      editor.textContent = data.source && data.source !== 'local' ? 'Blog öffnen' : 'Redaktion (Administratoren)';
      blogIconButton(editor, data.source && data.source !== 'local' ? 'mail' : 'admin');
      posts = data.posts;
      invalidatedPosts.clear();
      flightTargets = data.flight_targets ?? [];
      const focusedCard = document.activeElement?.closest?.('.start-news-choice');
      if (focusedCard && list.contains(focusedCard)) restoreCardFocus = focusedCard.dataset.postId;
      list.replaceChildren(...posts.map(post => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'start-news-choice';
        button.dataset.postId = String(post.id);
        const heading = document.createElement('span');
        heading.className = 'start-news-card-title';
        heading.id = `start-news-card-title-${post.id}`;
        heading.textContent = post.title;
        const details = document.createElement('span');
        details.className = 'start-news-card-meta';
        const date = document.createElement('time');
        date.dateTime = `${post.published_at.replace(' ', 'T')}Z`;
        date.textContent = post.published_at.slice(0, 10).split('-').reverse().join('.');
        const categories = post.categories ?? ['entwicklung'];
        details.append(date, document.createTextNode(` · ${categories[0] ?? 'entwicklung'}`));
        details.title = categories.join(', ');
        const excerpt = document.createElement('span');
        excerpt.className = 'start-news-card-excerpt';
        const preview = Array.from(post.body.replace(/\s+/gu, ' ').trim());
        excerpt.textContent = preview.slice(0, 140).join('') + (preview.length > 140 ? '…' : '');
        excerpt.setAttribute('aria-hidden', 'true');
        button.setAttribute('aria-labelledby', heading.id);
        button.title = post.title;
        button.append(heading, details, excerpt);
        if (post.tags?.includes('hero')) {
          button.classList.add('start-news-choice-hero');
          const badge = document.createElement('strong');
          badge.className = 'start-news-hero-badge';
          badge.textContent = 'Wichtig';
          badge.id = `start-news-card-important-${post.id}`;
          button.setAttribute('aria-labelledby', `${badge.id} ${heading.id}`);
          details.prepend(badge, document.createTextNode(' '));
        }
        return button;
      }));
      select(posts.find(post => post.id === selected?.id) ?? posts[0] ?? null);
      status.textContent = '';
    } catch (error) {
      if (!bindings.signal.aborted) {
        status.textContent = `Beiträge konnten nicht geladen werden: ${error.message}`;
        window.GQLog?.warn?.('[developer-blog]', status.textContent);
      }
    } finally {
      loading = false;
      if (!bindings.signal.aborted) {
        refresh.disabled = false;
        read.disabled = !canRead();
        flight.disabled = !canRead() || !flightTargets.some(target => target.faction_id === selected?.target_faction_id);
        if (restoreCardFocus !== undefined && document.activeElement === document.body) {
          const card = Array.from(list.querySelectorAll('.start-news-choice'))
            .find(button => button.dataset.postId === restoreCardFocus);
          (card ?? refresh).focus({ preventScroll: true });
        }
      }
    }
  }
  listen(list, 'click', event => {
    const button = event.target.closest?.('[data-post-id]');
    const post = posts.find(entry => entry.id === Number(button?.dataset.postId));
    if (!post) return;
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    if (trigger.getAttribute('aria-expanded') !== 'true') return;
    select(post);
    title.focus({ preventScroll: true });
  });
  listen(flight, 'click', () => {
    if (!canRead()) return;
    const target = flightTargets.find(item => item.faction_id === selected?.target_faction_id);
    if (!target) return;
    const reduced = document.body.dataset.startReducedMotion === 'true'
      || (document.body.dataset.startReducedMotion === undefined && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reduced) {
      flightStatus.textContent = 'Flug deaktiviert: reduzierte Bewegung ist eingeschaltet.';
      return;
    }
    if (window.GQAuthGalaxyBackgroundControl?.visitBlogTarget?.(target) !== true) {
      flightStatus.textContent = 'Galaxieanimation ist noch nicht bereit. Bitte erneut versuchen.';
      window.GQLog?.warn?.('[developer-blog]', flightStatus.textContent);
      return;
    }
    flightStatus.textContent = `Anflug auf ${target.homeworld} (${target.code}).`;
    const tour = document.getElementById('start-flight-tour');
    if (tour && !tour.checked) {
      tour.checked = true;
      tour.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  listen(list, 'keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const buttons = Array.from(list.querySelectorAll('button'));
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, buttons.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next].focus();
  });
  listen(read, 'click', async () => {
    if (!canRead() || loading || !stop.disabled) return;
    const manager = window.__GQ_AUDIO_MANAGER;
    const state = manager?.snapshot?.();
    if (!manager?.playTtsAudio || state?.masterMuted || state?.ttsMuted
      || state?.masterVolume === 0 || state?.ttsVolume === 0) {
      status.textContent = 'Sprachausgabe nicht bereit oder stummgeschaltet. Bitte Audio einschalten.';
      return;
    }
    stopSpeech();
    const current = revision;
    const post = selected;
    stop.disabled = false;
    if (document.activeElement === read) stop.focus({ preventScroll: true });
    read.disabled = true;
    request = new AbortController();
    try {
      let total = 1;
      for (let chunk = 0; chunk < total; chunk++) {
        status.textContent = `Sprachausgabe wird vorbereitet (${chunk + 1}) …`;
        const data = await blogRequest('narration', { id: post.id, chunk, revision: post.revision },
          { signal: request.signal, fetchImpl });
        if (current !== revision) return;
        if (typeof data.audio_url !== 'string' || !/^generated\/tts\/[a-f0-9]{64}\.mp3$/.test(data.audio_url)
          || !Number.isSafeInteger(data.chunks) || data.chunks < 1 || data.chunks > 7 || data.chunk !== chunk) {
          throw new Error('Ungültige Sprachausgabe.');
        }
        total = data.chunks;
        status.textContent = `Wird vorgelesen · Abschnitt ${chunk + 1}/${total}`;
        audio = manager.playTtsAudio(data.audio_url);
        if (!audio) throw new Error('Sprachclip konnte nicht gestartet werden.');
        await new Promise((resolve, reject) => {
          const element = audio;
          const done = error => {
            clearTimeout(timer);
            element.removeEventListener('ended', ended);
            element.removeEventListener('error', failed);
            element.removeEventListener('pause', paused);
            finishClip = null;
            if (error) reject(error); else resolve();
          };
          const ended = () => done();
          const failed = () => done(new Error('Sprachclip konnte nicht abgespielt werden.'));
          const paused = () => done(element.ended ? null : new Error('Sprachausgabe unterbrochen.'));
          const timer = setTimeout(() => done(new Error('Zeitlimit der Sprachausgabe erreicht.')), 180000);
          finishClip = () => done();
          element.addEventListener('ended', ended, { once: true });
          element.addEventListener('error', failed, { once: true });
          element.addEventListener('pause', paused, { once: true });
        });
        if (current !== revision) return;
      }
      status.textContent = 'Beitrag vollständig vorgelesen.';
    } catch (error) {
      if (current === revision) {
        if (error instanceof BlogRequestError && [404, 409].includes(error.status)) {
          invalidatedPosts.add(post.id);
          flight.disabled = true;
        }
        status.textContent = `Vorlesen fehlgeschlagen: ${error.message}`;
        window.GQLog?.warn?.('[developer-blog]', status.textContent);
      }
    } finally {
      if (current === revision) {
        audio?.pause();
        audio = null;
        request = null;
        read.disabled = !canRead();
        if (document.activeElement === stop) (read.disabled ? refresh : read).focus({ preventScroll: true });
        stop.disabled = true;
      }
    }
  });
  listen(stop, 'click', () => {
    const restoreFocus = document.activeElement === stop;
    stopSpeech();
    if (restoreFocus && !read.disabled) read.focus({ preventScroll: true });
  });
  listen(refresh, 'click', load);
  listen(window, 'gq:start-panel-closed', stopSpeech);
  listen(window, 'gq:authenticated', stopSpeech);
  const ready = load();
  return { ready, stop: stopSpeech, destroy() { stopSpeech(); bindings.abort(); } };
}
