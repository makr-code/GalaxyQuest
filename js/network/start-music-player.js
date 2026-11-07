import playIcon from '../../gfx/icons/mono/play.svg?url&no-inline';
import pauseIcon from '../../gfx/icons/mono/pause.svg?url&no-inline';

export function initializeStartMusicPlayer() {
  const root = document.getElementById('start-music-player');
  if (!root) throw new Error('Start music player HTML is missing');
  const title = root.querySelector('#start-music-title');
  const status = root.querySelector('#start-music-status');
  const play = root.querySelector('#start-music-play');
  const mute = root.querySelector('#start-music-mute');
  const buttons = Array.from(root.querySelectorAll('button'));
  const topbar = document.getElementById('topbar-player');
  const topPlay = document.getElementById('topbar-player-toggle');
  const topMute = document.getElementById('audio-toggle-btn');
  const menuToggle = document.getElementById('topbar-player-menu-toggle');
  const menu = document.getElementById('topbar-player-menu');
  const trackSelect = document.getElementById('topbar-player-track');
  const trackList = document.getElementById('topbar-player-track-list');
  const topStatus = document.getElementById('topbar-player-status');
  const ducking = document.getElementById('topbar-player-ducking');
  const duckingStrength = document.getElementById('topbar-player-ducking-strength');
  const volumes = ['start-music-volume', 'topbar-player-volume'].map((id) => document.getElementById(id)).filter(Boolean);
  const bindings = new AbortController();
  let manager = null;
  let pending = false;
  let playlistKey = '';

  function listen(element, type, handler) {
    element?.addEventListener(type, handler, { signal: bindings.signal });
  }
  function trackLabel(url) {
    const rawFilename = String(url || '').split('/').pop().split('?')[0];
    let filename = rawFilename;
    try { filename = decodeURIComponent(rawFilename); }
    catch (error) { window.GQLog?.warn?.('[music-player]', `Invalid track encoding: ${error.message}`); }
    return filename ? filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ') : 'Kein Titel ausgewählt';
  }
  function showError(message) {
    status.textContent = message ? `Musik: ${message}` : '';
    if (topStatus) topStatus.textContent = status.textContent;
  }
  function closeMenu(restoreFocus = false) {
    menu?.classList.add('hidden');
    topbar?.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) menuToggle?.focus();
  }

  function refresh() {
    if (!manager) return;
    const state = manager.snapshot();
    title.textContent = trackLabel(state.musicUrl);
    title.title = title.textContent;
    const label = state.musicPlaying ? 'Musik pausieren' : 'Musik starten';
    for (const control of [play, topPlay].filter(Boolean)) {
      control.setAttribute('aria-label', label);
      control.title = label;
      control.querySelector('use').setAttribute('href', state.musicPlaying
        ? `${pauseIcon}#icon-pause` : `${playIcon}#icon-play`);
    }
    const muteLabel = state.masterMuted ? 'Audio einschalten' : 'Audio stummschalten';
    for (const control of [mute, topMute].filter(Boolean)) {
      control.setAttribute('aria-pressed', String(!!state.masterMuted));
      control.setAttribute('aria-label', muteLabel);
      control.title = muteLabel;
    }
    const controls = [...buttons, topPlay, topMute, trackSelect,
      document.getElementById('topbar-player-prev'), document.getElementById('topbar-player-next-quick')];
    controls.filter(Boolean).forEach((control) => { control.disabled = pending || !state.musicUrl; });
    volumes.forEach((input) => {
      input.disabled = pending;
      input.value = String(Math.round((state.musicVolume ?? 0.55) * 100));
      input.setAttribute('aria-valuetext', `${input.value} %`);
    });
    if (ducking) {
      ducking.disabled = pending;
      ducking.checked = state.musicDuckingEnabled !== false;
    }
    if (duckingStrength) {
      duckingStrength.disabled = pending || !ducking?.checked;
      duckingStrength.value = String(Math.round((state.musicDuckingStrength ?? 0.55) * 100));
      duckingStrength.setAttribute('aria-valuetext', `${duckingStrength.value} % · höher senkt Musik stärker ab`);
    }
    const playlist = state.playlist || (state.musicUrl ? [state.musicUrl] : []);
    const key = JSON.stringify(playlist);
    if (key !== playlistKey) {
      playlistKey = key;
      trackSelect?.replaceChildren(...playlist.map((url) => {
        const option = document.createElement('option');
        option.value = url;
        option.textContent = trackLabel(url);
        return option;
      }));
      trackList?.replaceChildren(...playlist.map((url) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'topbar-player-track-item';
        item.dataset.track = url;
        item.setAttribute('role', 'option');
        item.textContent = trackLabel(url);
        return item;
      }));
    }
    if (trackSelect) trackSelect.value = state.musicUrl;
    trackList?.querySelectorAll('button').forEach((item) => {
      item.disabled = pending;
      item.classList.toggle('is-active', item.dataset.track === state.musicUrl);
      item.setAttribute('aria-selected', String(item.dataset.track === state.musicUrl));
    });
    const current = document.getElementById('topbar-player-current');
    if (current) { current.textContent = title.textContent; current.title = title.textContent; }
    const mode = document.getElementById('topbar-player-mode');
    if (mode) mode.textContent = String(state.musicTransitionMode || 'fade').toUpperCase();
  }

  async function act(action) {
    if (!manager || pending) return;
    pending = true;
    showError('');
    refresh();
    try {
      await action();
    } catch (error) {
      showError(error.message);
      window.GQLog?.warn?.('[start-music-player]', error.message);
    } finally {
      pending = false;
      refresh();
    }
  }

  function applyLiveSetting(action) {
    if (!manager) return;
    showError('');
    try {
      action();
      refresh();
    } catch (error) {
      showError(error?.message || String(error));
      window.GQLog?.warn?.('[start-music-player]', error?.message || String(error));
    }
  }

  const togglePlayback = () => act(async () => {
    if (manager.snapshot().musicPlaying) manager.pauseMusic(false);
    else if (!await manager.playMusic()) throw new Error('Wiedergabe konnte nicht gestartet werden.');
  });
  const toggleMute = () => act(() => {
    manager.setMasterMuted(!manager.snapshot().masterMuted);
  });
  [play, topPlay].forEach((control) => listen(control, 'click', togglePlayback));
  [mute, topMute].forEach((control) => listen(control, 'click', toggleMute));
  for (const [id, direction] of [['start-music-prev', -1], ['start-music-next', 1],
    ['topbar-player-prev', -1], ['topbar-player-next-quick', 1]]) {
    listen(document.getElementById(id), 'click', () => act(async () => {
      if (!await manager.playNextInPlaylist(direction, true)) {
        throw new Error('Titel konnte nicht gestartet werden.');
      }
    }));
  }
  function selectTrack(url) {
    return act(async () => {
      if (!url || !(manager.snapshot().playlist || []).includes(url)) throw new Error('Titel ist nicht in der Playlist.');
      const playing = manager.snapshot().musicPlaying;
      const result = await manager.setMusicTrack(url, playing);
      if (playing && result === false) throw new Error('Titel konnte nicht gestartet werden.');
    });
  }
  listen(trackSelect, 'change', () => selectTrack(trackSelect.value));
  listen(trackList, 'click', (event) => {
    const item = event.target.closest?.('button[data-track]');
    if (item) void selectTrack(item.dataset.track);
  });
  volumes.forEach((input) => listen(input, 'input', () => {
    const volume = Number(input.value) / 100;
    applyLiveSetting(() => manager.setMusicVolume(volume));
  }));
  listen(ducking, 'change', () => {
    const enabled = ducking.checked;
    void act(() => manager.setMusicDuckingEnabled(enabled));
  });
  listen(duckingStrength, 'input', () => {
    const strength = Number(duckingStrength.value) / 100;
    applyLiveSetting(() => manager.setMusicDuckingStrength(strength));
  });
  listen(menuToggle, 'click', () => {
    const open = menu?.classList.contains('hidden');
    closeMenu();
    if (open) {
      menu.classList.remove('hidden');
      topbar.classList.add('open');
      menuToggle.setAttribute('aria-expanded', 'true');
      menu.querySelector('button:not(:disabled), select:not(:disabled)')?.focus();
    }
  });
  listen(document, 'click', (event) => { if (!topbar?.contains(event.target)) closeMenu(); });
  listen(document, 'keydown', (event) => {
    if (menu?.classList.contains('hidden')) return;
    if (event.key === 'Escape') { closeMenu(true); event.preventDefault(); }
    if (event.key === 'Tab') {
      const controls = [...menu.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled)')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
      if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
    }
  });
  listen(window, 'gq:audio-state', refresh);
  listen(window, 'gq:authenticated', refresh);
  [topPlay, topMute, trackSelect, ...volumes].filter(Boolean).forEach((control) => { control.disabled = true; });
  return {
    setManager(value) {
      manager = value;
      showError('');
      refresh();
    },
    setError(message) {
      showError(message);
    },
    destroy() { closeMenu(); bindings.abort(); },
  };
}
