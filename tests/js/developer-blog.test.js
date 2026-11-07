import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { initializeDeveloperBlog, blogRequest, estimateBlogSpeech } from '../../js/network/developer-blog.js';

const html = fs.readFileSync('index.html', 'utf8');
const post = { id: 1, revision: 1, title: '<Neuigkeiten>', body: 'Entwicklungsstand', published_at: '2026-11-06 12:00:00', updated_at: '2026-11-06 12:00:00' };
const url = `generated/tts/${'a'.repeat(64)}.mp3`;
let blog;
let fetchImpl;
let clips;

beforeEach(() => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.body.append(document.importNode(parsed.getElementById('auth-section'), true));
  document.querySelector('[data-start-panel="news"]').addEventListener('click', event => {
    event.currentTarget.setAttribute('aria-expanded', 'true');
    document.getElementById('start-panel-news').hidden = false;
  });
  fetchImpl = vi.fn(async address => ({
    ok: true, json: async () => address.includes('csrf') ? { token: 'csrf-test' }
      : address.includes('narration') ? { success: true, audio_url: url, chunks: 2, chunk: 0 }
        : { success: true, posts: [post, { ...post, id: 2, title: 'Zweiter Beitrag' }] },
  }));
  clips = [];
  window.__GQ_AUDIO_MANAGER = {
    snapshot: () => ({ masterVolume: 0.8, ttsVolume: 0.95 }),
    playTtsAudio: vi.fn(() => {
      const clip = new EventTarget();
      clip.pause = vi.fn();
      clips.push(clip);
      return clip;
    }),
  };
});
afterEach(() => {
  blog?.destroy();
  blog = null;
  delete window.__GQ_AUDIO_MANAGER;
  delete window.GQAuthGalaxyBackgroundControl;
  delete document.body.dataset.startReducedMotion;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('Developer blog', () => {
  it.each([
    ['null post', [null]],
    ['duplicate identity', [post, post]],
    ['missing revision', [{ ...post, revision: undefined }]],
    ['invalid revision', [{ ...post, revision: 'wp:invalid' }]],
    ['overlong title', [{ ...post, title: 'ü'.repeat(161) }]],
    ['overlong body', [{ ...post, body: 'ü'.repeat(3001) }]],
    ['empty body', [{ ...post, body: ' ' }]],
    ['invalid calendar date', [{ ...post, published_at: '2026-02-31 12:00:00' }]],
    ['invalid flight identity', [{ ...post, target_faction_id: '8' }]],
    ['credential link', [{ ...post, original_url: 'https://user:password@example.test/article' }]],
  ])('rejects malformed feed data: %s', async (_label, posts) => {
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ success: true, posts }) });
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.getElementById('start-news-status').textContent).toContain('Ungültige Blogdaten');
    expect(document.querySelectorAll('.start-news-choice')).toHaveLength(0);
    expect(document.getElementById('start-news-read').disabled).toBe(true);
  });
  it('accepts the exact Unicode limits and a valid leap day', async () => {
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ success: true, posts: [{
      ...post, title: '🚀'.repeat(160), body: '🌌'.repeat(3000), published_at: '2024-02-29 12:00:00',
    }] }) });
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.querySelectorAll('.start-news-choice')).toHaveLength(1);
    expect(document.getElementById('start-news-read').disabled).toBe(false);
  });
  it('ignores a feed response after disposal even when transport ignores abort', async () => {
    let finish;
    fetchImpl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    blog = initializeDeveloperBlog({ fetchImpl });
    blog.destroy();
    const before = document.getElementById('start-panel-news').innerHTML;
    finish({ ok: true, json: async () => ({ success: true, posts: [post] }) });
    await blog.ready;
    expect(document.getElementById('start-panel-news').innerHTML).toBe(before);
    expect(document.querySelectorAll('.start-news-choice')).toHaveLength(0);
  });
  it('does not write after cancellation while waiting for a CSRF response', async () => {
    let finish;
    const controller = new AbortController();
    fetchImpl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = blogRequest('narration', { id: 1 }, { fetchImpl, signal: controller.signal });
    controller.abort();
    finish({ ok: true, json: async () => ({ token: 'test-token' }) });
    await expect(pending).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], 'invalid'])('rejects a malformed API envelope explicitly: %s', async data => {
    fetchImpl.mockResolvedValue({ ok: true, json: async () => data });
    await expect(blogRequest('list', null, { fetchImpl })).rejects.toThrow('Ungültige Blogantwort');
  });
  it('keeps reading disabled when selecting a card during a pending refresh', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    let finish;
    fetchImpl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    document.getElementById('start-news-refresh').click();
    document.querySelectorAll('.start-news-choice')[1].click();
    expect(document.getElementById('start-news-read').disabled).toBe(true);
    document.getElementById('start-news-read').dispatchEvent(new Event('click'));
    expect(clips).toHaveLength(0);
    finish({ ok: true, json: async () => ({ success: true, posts: [post] }) });
    await vi.waitFor(() => expect(document.getElementById('start-news-read').disabled).toBe(false));
  });
  it('shows simulated source and original article while forwarding opaque WordPress revisions', async () => {
    const wpPost = { ...post, revision: `wp:${'a'.repeat(64)}`, original_url: 'http://localhost:8081/api/wordpress_sim.php?p=106', tags: ['game-start', 'hero'] };
    fetchImpl.mockImplementation(async address => ({
      ok: true, json: async () => address.includes('csrf') ? { token: 'csrf-test' }
        : address.includes('narration') ? { success: true, audio_url: url, chunks: 1, chunk: 0 }
          : { success: true, source: 'wordpress-simulation', editor_url: 'api/wordpress_sim.php', posts: [wpPost] },
    }));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.getElementById('start-news-source').textContent).toContain('WordPress-Simulation');
    const original = document.getElementById('start-news-original');
    expect(original.hidden).toBe(false);
    expect(original.href).toBe(wpPost.original_url);
    expect(original.rel).toContain('noopener');
    expect(document.querySelector('.start-news-toolbar a').title).toBe('Blog öffnen');
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    const request = fetchImpl.mock.calls.find(([address]) => address.includes('narration'));
    expect(JSON.parse(request[1].body).revision).toBe(wpPost.revision);
  });
  it('keeps the original link hidden for local posts and rejects unsafe external links', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.getElementById('start-news-original').hidden).toBe(true);
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({
      success: true, posts: [{ ...post, original_url: 'javascript:alert(1)' }],
    }) });
    document.getElementById('start-news-refresh').click();
    await vi.waitFor(() => expect(document.getElementById('start-news-status').textContent).toContain('Ungültige Blogdaten'));
    expect(document.getElementById('start-news-original').getAttribute('href')).toBeNull();
  });
  it('groups all article actions in one compact toolbar with accessible icon labels', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const toolbar = document.querySelector('.start-news-toolbar');
    expect(toolbar.getAttribute('aria-label')).toBe('Nachrichtenaktionen');
    expect(toolbar.querySelectorAll('.blog-icon-button')).toHaveLength(5);
    for (const action of toolbar.querySelectorAll('.blog-icon-button')) {
      expect(action.getAttribute('aria-label')).toBe(action.title);
      expect(action.title).not.toBe('');
      expect(action.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(document.querySelector('.start-news-audio')).toBeNull();
  });
  it('uses labeled icon actions and starts only explicitly selected public homeworld flights', async () => {
    const target = { faction_id: 4, code: 'test', homeworld: 'Heimat', galaxy_index: 1, system_index: 42, position: 2, x_ly: 1, y_ly: 2, z_ly: 3 };
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({
      success: true, posts: [{ ...post, target_faction_id: 4 }], flight_targets: [target],
    }) });
    const visit = vi.fn(() => true);
    window.GQAuthGalaxyBackgroundControl = { visitBlogTarget: visit };
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const flight = document.getElementById('start-news-flight');
    expect(flight.getAttribute('aria-label')).toBe('Beitragsziel anfliegen');
    expect(flight.querySelector('svg')).not.toBeNull();
    expect(visit).not.toHaveBeenCalled();
    document.body.dataset.startReducedMotion = 'true';
    flight.click();
    expect(visit).not.toHaveBeenCalled();
    expect(document.getElementById('start-news-flight-status').textContent).toContain('reduzierte Bewegung');
    document.body.dataset.startReducedMotion = 'false';
    flight.click();
    expect(visit).toHaveBeenCalledWith(target);
    expect(document.getElementById('start-flight-tour').checked).toBe(true);
    expect(document.getElementById('start-news-flight-status').textContent).toContain('Heimat');
  });
  it('estimates reading duration without claiming an exact audio duration', () => {
    expect(estimateBlogSpeech('', '')).toContain('Noch kein Text');
    expect(estimateBlogSpeech('Titel', 'Wort '.repeat(129))).toBe('ca. 1 Min. Vorlesedauer');
    expect(estimateBlogSpeech('Titel', 'Wort '.repeat(130))).toBe('ca. 2 Min. Vorlesedauer');
  });
  it('renders direct latest choices safely and selects a post without autoplay', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.querySelectorAll('.start-news-choice')).toHaveLength(2);
    expect(document.querySelector('.start-news-card-title').textContent).toBe('<Neuigkeiten>');
    expect(document.querySelector('#start-news-title neuigkeiten')).toBeNull();
    document.querySelectorAll('.start-news-choice')[1].click();
    expect(document.getElementById('start-news-title').textContent).toBe('Zweiter Beitrag');
    expect(document.activeElement.id).toBe('start-news-title');
    expect(window.__GQ_AUDIO_MANAGER.playTtsAudio).not.toHaveBeenCalled();
  });
  it('navigates choices without changing the article or starting speech', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const buttons = document.querySelectorAll('.start-news-choice');
    const key = value => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    buttons[0].focus();
    key('ArrowDown');
    expect(document.activeElement).toBe(buttons[1]);
    key('ArrowDown');
    expect(document.activeElement).toBe(buttons[1]);
    key('Home');
    expect(document.activeElement).toBe(buttons[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
    key('End');
    key('ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
    expect(document.getElementById('start-news-title').textContent).toBe(post.title);
    expect(window.__GQ_AUDIO_MANAGER.playTtsAudio).not.toHaveBeenCalled();
    for (const options of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true, ...options });
      buttons[0].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(buttons[0]);
    }
    const handled = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    handled.preventDefault();
    buttons[0].dispatchEvent(handled);
    expect(document.activeElement).toBe(buttons[0]);
    expect(key('Tab')).toBe(true);
    expect(key('Enter')).toBe(true);
    expect(key(' ')).toBe(true);
  });
  it('resets article scroll on selection and refresh without moving the surrounding page', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const dialog = document.getElementById('start-content-dialog');
    const menu = document.getElementById('start-menu');
    menu.scrollTop = 90;
    dialog.scrollTop = 600;
    document.querySelectorAll('.start-news-choice')[1].click();
    expect(dialog.scrollTop).toBe(0);
    expect(menu.scrollTop).toBe(90);
    expect(document.activeElement.id).toBe('start-news-title');
    dialog.scrollTop = 400;
    document.getElementById('start-news-refresh').click();
    await vi.waitFor(() => expect(dialog.scrollTop).toBe(0));
    expect(menu.scrollTop).toBe(90);
    expect(document.getElementById('start-news-title').textContent).toBe('Zweiter Beitrag');
    expect(window.__GQ_AUDIO_MANAGER.playTtsAudio).not.toHaveBeenCalled();
  });
  it.each([true, false])('restores a focused card after refresh, retained=%s', async retained => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    let finish;
    fetchImpl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    document.getElementById('start-news-refresh').click();
    document.querySelectorAll('.start-news-choice')[1].focus();
    finish({ ok: true, json: async () => ({ success: true, posts: retained
      ? [{ ...post, id: 2, title: 'Neue Fassung' }, post] : [post] }) });
    await vi.waitFor(() => expect(document.getElementById('start-news-refresh').disabled).toBe(false));
    if (retained) expect(document.activeElement.dataset.postId).toBe('2');
    else expect(document.activeElement.id).toBe('start-news-refresh');
    expect(document.getElementById('start-news-title').textContent).toBe(post.title);
    expect(clips).toHaveLength(0);
  });
  it('does not steal focus moved outside the cards while refresh is pending', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    let finish;
    fetchImpl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    document.querySelector('.start-news-choice').focus();
    document.getElementById('start-news-refresh').click();
    const login = document.getElementById('start-login');
    login.focus();
    finish({ ok: true, json: async () => ({ success: true, posts: [] }) });
    await vi.waitFor(() => expect(document.getElementById('start-news-refresh').disabled).toBe(false));
    expect(document.activeElement).toBe(login);
  });
  it('renders compact dated cards with bounded Unicode-safe plain-text previews', async () => {
    const text = '<img src=x onerror=alert(1)> ' + '🌟'.repeat(150);
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({
      success: true, posts: [{ ...post, body: text, categories: ['audio', 'entwicklung'] }],
    }) });
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const card = document.querySelector('.start-news-choice');
    expect(card.querySelector('time').textContent).toBe('06.11.2026');
    expect(card.querySelector('time').dateTime).toBe('2026-11-06T12:00:00Z');
    expect(card.querySelector('.start-news-card-meta').textContent).toContain('audio');
    const preview = card.querySelector('.start-news-card-excerpt');
    expect(Array.from(preview.textContent)).toHaveLength(141);
    expect(preview.textContent.endsWith('…')).toBe(true);
    expect(preview.textContent).not.toContain('\uFFFD');
    expect(card.querySelector('img')).toBeNull();
    expect(card.getAttribute('aria-labelledby')).toBe(card.querySelector('.start-news-card-title').id);
    preview.click();
    expect(document.getElementById('start-news-body').textContent).toBe(text);
    expect(window.__GQ_AUDIO_MANAGER.playTtsAudio).not.toHaveBeenCalled();
  });
  it('moves focus to stop during preparation and back to read on manual stop', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const read = document.getElementById('start-news-read');
    const stop = document.getElementById('start-news-stop');
    read.focus();
    read.click();
    expect(document.activeElement).toBe(stop);
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    stop.click();
    expect(document.activeElement).toBe(read);
    expect(stop.disabled).toBe(true);
  });
  it('restores focus on completion or failure without stealing focus from another control', async () => {
    fetchImpl.mockImplementation(async address => ({
      ok: true, json: async () => address.includes('csrf') ? { token: 'csrf-test' }
        : address.includes('narration') ? { success: true, audio_url: url, chunks: 1, chunk: 0 }
          : { success: true, posts: [post] },
    }));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const read = document.getElementById('start-news-read');
    for (const event of ['ended', 'error']) {
      read.focus();
      read.click();
      await vi.waitFor(() => expect(document.getElementById('start-news-stop').disabled).toBe(false));
      await vi.waitFor(() => expect(clips).toHaveLength(event === 'ended' ? 1 : 2));
      clips.at(-1).dispatchEvent(new Event(event));
      await vi.waitFor(() => expect(read.disabled).toBe(false));
      expect(document.activeElement).toBe(read);
    }
    read.click();
    await vi.waitFor(() => expect(clips).toHaveLength(3));
    const refresh = document.getElementById('start-news-refresh');
    refresh.focus();
    clips[2].dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(read.disabled).toBe(false));
    expect(document.activeElement).toBe(refresh);
  });
  it('reads sequential sections through shared TTS and sends only persisted post identity', async () => {
    fetchImpl.mockImplementation(async (address, options) => ({
      ok: true, json: async () => address.includes('csrf') ? { token: 'csrf-test' }
        : address.includes('narration') ? {
          success: true, audio_url: url, chunks: 2, chunk: JSON.parse(options.body).chunk,
        } : { success: true, posts: [post] },
    }));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    expect(document.getElementById('start-news-stop').disabled).toBe(false);
    clips[0].ended = true;
    clips[0].dispatchEvent(new Event('pause'));
    clips[0].dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(clips).toHaveLength(2));
    clips[1].dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(document.getElementById('start-news-status').textContent).toContain('vollständig'));
    expect(window.__GQ_AUDIO_MANAGER.playTtsAudio).toHaveBeenCalledWith(url);
    const options = fetchImpl.mock.calls.find(([address]) => address.includes('narration'))[1];
    expect(options.headers['X-CSRF-Token']).toBe('csrf-test');
    expect(JSON.parse(options.body)).toEqual({ id: 1, chunk: 0, revision: post.revision });
  });
  it('stops playing audio and cancels queued sections when closed or switching posts', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    window.dispatchEvent(new Event('gq:start-panel-closed'));
    expect(clips[0].pause).toHaveBeenCalled();
    clips[0].dispatchEvent(new Event('ended'));
    await Promise.resolve();
    expect(clips).toHaveLength(1);
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(clips).toHaveLength(2));
    document.querySelectorAll('.start-news-choice')[1].click();
    expect(clips[1].pause).toHaveBeenCalled();
    expect(document.getElementById('start-news-stop').disabled).toBe(true);
  });
  it('ignores late synthesis responses after stopping', async () => {
    let finish;
    const original = fetchImpl;
    fetchImpl = vi.fn((address, options) => address.includes('narration')
      ? new Promise(resolve => { finish = resolve; }) : original(address, options));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    document.getElementById('start-news-stop').click();
    finish({ ok: true, json: async () => ({ success: true, audio_url: url, chunks: 1, chunk: 0 }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(clips).toHaveLength(0);
  });
  it('shows empty and failed load states with a retry action', async () => {
    fetchImpl.mockResolvedValue({ ok: false, json: async () => ({ error: 'Offline' }) });
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.getElementById('start-news-status').textContent).toContain('Offline');
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ success: true, posts: [] }) });
    document.getElementById('start-news-refresh').click();
    await vi.waitFor(() => expect(document.getElementById('start-news-title').textContent).toContain('keine Beiträge'));
    expect(document.getElementById('start-news-read').disabled).toBe(true);
  });
  it.each([404, 409])('invalidates rejected article actions until a successful refresh (HTTP %i)', async status => {
    const originalFetch = fetchImpl;
    fetchImpl = vi.fn((address, options) => address.includes('narration')
      ? Promise.resolve({ ok: false, status, json: async () => ({ error: 'Bitte Beiträge neu laden.' }) })
      : originalFetch(address, options));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const read = document.getElementById('start-news-read');
    const refresh = document.getElementById('start-news-refresh');
    read.focus();
    read.click();
    await vi.waitFor(() => expect(document.getElementById('start-news-status').textContent).toContain('fehlgeschlagen'));
    expect(read.disabled).toBe(true);
    expect(document.getElementById('start-news-flight').disabled).toBe(true);
    expect(document.activeElement).toBe(refresh);
    document.querySelectorAll('.start-news-choice')[1].click();
    expect(read.disabled).toBe(false);
    document.querySelectorAll('.start-news-choice')[0].click();
    expect(read.disabled).toBe(true);
    expect(document.getElementById('start-news-status').textContent).toContain('nicht mehr aktuell');
    fetchImpl.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Offline' }) });
    refresh.click();
    await vi.waitFor(() => expect(refresh.disabled).toBe(false));
    expect(read.disabled).toBe(true);
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({ success: true, posts: [{ ...post, revision: 2 }] }) });
    refresh.click();
    await vi.waitFor(() => expect(read.disabled).toBe(false));
  });
  it('keeps a temporary narration failure retryable instead of invalidating the article', async () => {
    const originalFetch = fetchImpl;
    fetchImpl = vi.fn((address, options) => address.includes('narration')
      ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'Sprachausgabe nicht verfügbar.' }) })
      : originalFetch(address, options));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const read = document.getElementById('start-news-read');
    read.click();
    await vi.waitFor(() => expect(document.getElementById('start-news-status').textContent).toContain('fehlgeschlagen'));
    expect(read.disabled).toBe(false);
  });
  it('stops audio immediately while refreshing even when the new feed fails', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    let finish;
    fetchImpl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    document.getElementById('start-news-refresh').click();
    expect(clips[0].pause).toHaveBeenCalled();
    expect(document.getElementById('start-news-read').disabled).toBe(true);
    expect(document.getElementById('start-news-stop').disabled).toBe(true);
    finish({ ok: false, status: 503, json: async () => ({ error: 'Offline' }) });
    await vi.waitFor(() => expect(document.getElementById('start-news-status').textContent).toContain('Offline'));
    expect(document.getElementById('start-news-read').disabled).toBe(false);
    expect(clips).toHaveLength(1);
  });
  it('reports muted audio and playback failure explicitly', async () => {
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    window.__GQ_AUDIO_MANAGER.snapshot = () => ({ ttsMuted: true });
    document.getElementById('start-news-read').click();
    expect(document.getElementById('start-news-status').textContent).toContain('stummgeschaltet');
    window.__GQ_AUDIO_MANAGER.snapshot = () => ({ ttsMuted: false });
    document.getElementById('start-news-read').click();
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    clips[0].dispatchEvent(new Event('error'));
    await vi.waitFor(() => expect(document.getElementById('start-news-status').textContent).toContain('fehlgeschlagen'));
    expect(document.getElementById('start-news-read').disabled).toBe(false);
  });
  it('does not send writes without a valid CSRF token', async () => {
    fetchImpl.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(blogRequest('save', { title: 'x' }, { fetchImpl })).rejects.toThrow('CSRF');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('marks bounded legacy content as the shortened display and narration version', async () => {
    fetchImpl.mockResolvedValue({
      ok: true, json: async () => ({ success: true, posts: [{ ...post, body: 'a'.repeat(3000), truncated: true }] }),
    });
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.getElementById('start-news-body').textContent).toHaveLength(3000);
    expect(document.getElementById('start-news-meta').textContent).toContain('Gekürzte Fassung');
  });
  it('displays categories and hero importance without reordering or narrating taxonomy', async () => {
    fetchImpl.mockImplementation(async address => ({
      ok: true, json: async () => address.includes('csrf') ? { token: 'csrf-test' }
        : address.includes('narration') ? { success: true, audio_url: url, chunks: 1, chunk: 0 }
          : { success: true, posts: [
            { ...post, categories: ['entwicklung'], tags: [] },
            { ...post, id: 2, categories: ['audio', 'ui-ux'], tags: ['hero', 'tts'] },
          ] },
    }));
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    const buttons = document.querySelectorAll('.start-news-choice');
    expect(Array.from(buttons, button => button.dataset.postId)).toEqual(['1', '2']);
    expect(buttons[0].classList.contains('start-news-choice-hero')).toBe(false);
    expect(buttons[1].textContent).toContain('Wichtig');
    buttons[1].click();
    expect(document.getElementById('start-news-taxonomy').textContent).toContain('Wichtige Nachricht');
    expect(document.getElementById('start-news-taxonomy').textContent).toContain('Kategorien: audio, ui-ux · Tags: hero, tts');
    expect(document.querySelector('article').classList.contains('start-news-hero')).toBe(true);
    buttons[0].click();
    expect(document.querySelector('article').classList.contains('start-news-hero')).toBe(false);
    expect(document.getElementById('start-news-taxonomy').textContent).not.toContain('hero');
  });
  it('rejects malformed taxonomy responses explicitly', async () => {
    fetchImpl.mockResolvedValue({
      ok: true, json: async () => ({ success: true, posts: [{ ...post, tags: 'hero' }] }),
    });
    blog = initializeDeveloperBlog({ fetchImpl });
    await blog.ready;
    expect(document.getElementById('start-news-status').textContent).toContain('Ungültige Blogdaten');
  });
});
