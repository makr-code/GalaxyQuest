import { blogRequest } from './developer-blog.js';

const CLIP_PATTERN = /^generated\/tts\/[a-f0-9]{64}\.mp3$/;

function playClip(manager, url, onAudio) {
  return new Promise((resolve, reject) => {
    const element = manager.playTtsAudio(url);
    if (!element) {
      reject(new Error('Sprachclip konnte nicht gestartet werden.'));
      return;
    }
    onAudio(element);
    const timer = setTimeout(() => done(new Error('Zeitlimit der Sprachausgabe erreicht.')), 180000);
    const done = error => {
      clearTimeout(timer);
      element.removeEventListener('ended', ended);
      element.removeEventListener('error', failed);
      element.removeEventListener('pause', paused);
      if (error) reject(error); else resolve();
    };
    const ended = () => done();
    const failed = () => done(new Error('Sprachclip konnte nicht abgespielt werden.'));
    const paused = () => done(element.ended ? null : new Error('Sprachausgabe unterbrochen.'));
    element.addEventListener('ended', ended, { once: true });
    element.addEventListener('error', failed, { once: true });
    element.addEventListener('pause', paused, { once: true });
  });
}

export function initializeRadio({ fetchImpl = globalThis.fetch } = {}) {
  const root = document.getElementById('start-radio');
  if (!root) return;
  const play = root.querySelector('#start-radio-play');
  const stop = root.querySelector('#start-radio-stop');
  const status = root.querySelector('#start-radio-status');
  const list = root.querySelector('#start-radio-posts');
  let run = 0;
  let controller = null;
  let audio = null;

  function halt(message) {
    run++;
    controller?.abort();
    controller = null;
    audio?.pause();
    audio = null;
    play.disabled = false;
    stop.disabled = true;
    list.querySelectorAll('li').forEach(item => item.removeAttribute('aria-current'));
    if (message) status.textContent = message;
  }

  async function broadcast() {
    const manager = window.__GQ_AUDIO_MANAGER;
    const state = manager?.snapshot?.();
    if (!manager?.playTtsAudio || state?.masterMuted || state?.ttsMuted
      || state?.masterVolume === 0 || state?.ttsVolume === 0) {
      status.textContent = 'Sprachausgabe nicht bereit oder stummgeschaltet. Bitte Audio einschalten.';
      return;
    }
    halt();
    const current = run;
    controller = new AbortController();
    const { signal } = controller;
    play.disabled = true;
    stop.disabled = false;
    status.textContent = 'Sendung wird geladen …';
    try {
      const data = await blogRequest('radio', null, { signal, fetchImpl });
      if (!Array.isArray(data.posts) || data.posts.length > 5 || !data.posts.every(post => post
        && Number.isSafeInteger(post.id) && post.id > 0 && typeof post.title === 'string'
        && post.title.trim() && typeof post.revision === 'string')) {
        throw new Error('Ungültige Sendungsdaten.');
      }
      if (current !== run) return;
      const items = data.posts.map(post => {
        const item = document.createElement('li');
        item.textContent = post.title;
        return item;
      });
      list.replaceChildren(...items);
      if (!data.posts.length) {
        status.textContent = 'Aktuell keine Sendung. Beiträge brauchen Tag „game-start“ und Kategorie „galaxy-news-radio“.';
        halt();
        return;
      }
      for (const [index, post] of data.posts.entries()) {
        items[index].setAttribute('aria-current', 'true');
        let total = 1;
        for (let chunk = 0; chunk < total; chunk++) {
          status.textContent = `Meldung ${index + 1}/${data.posts.length} wird vorbereitet …`;
          const clip = await blogRequest('narration', { id: post.id, chunk, revision: post.revision },
            { signal, fetchImpl });
          if (current !== run) return;
          if (typeof clip.audio_url !== 'string' || !CLIP_PATTERN.test(clip.audio_url)
            || !Number.isSafeInteger(clip.chunks) || clip.chunks < 1 || clip.chunks > 7 || clip.chunk !== chunk) {
            throw new Error('Ungültige Sprachausgabe.');
          }
          total = clip.chunks;
          status.textContent = `Auf Sendung: ${post.title}`;
          await playClip(manager, clip.audio_url, element => { audio = element; });
          if (current !== run) return;
        }
        items[index].removeAttribute('aria-current');
      }
      halt('Sendung beendet.');
    } catch (error) {
      if (current === run) halt(`Sendung fehlgeschlagen: ${error.message}`);
    }
  }

  play.addEventListener('click', () => { void broadcast(); });
  stop.addEventListener('click', () => halt('Sendung gestoppt.'));
  root.addEventListener('toggle', () => { if (!root.open) halt(); });
  window.addEventListener('gq:start-panel-closed', () => halt());
}
