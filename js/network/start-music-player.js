import playIcon from '../../gfx/icons/mono/play.svg?url';
import pauseIcon from '../../gfx/icons/mono/pause.svg?url';

export function initializeStartMusicPlayer() {
  const root = document.getElementById('start-music-player');
  if (!root) throw new Error('Start music player HTML is missing');
  const title = root.querySelector('#start-music-title');
  const status = root.querySelector('#start-music-status');
  const play = root.querySelector('#start-music-play');
  const mute = root.querySelector('#start-music-mute');
  const buttons = Array.from(root.querySelectorAll('button'));
  let manager = null;
  let pending = false;

  function refresh() {
    if (!manager) return;
    const state = manager.snapshot();
    const rawFilename = String(state.musicUrl || '').split('/').pop().split('?')[0];
    let filename = rawFilename;
    try {
      filename = decodeURIComponent(rawFilename);
    } catch (error) {
      window.GQLog?.warn?.('[start-music-player]', `Invalid track encoding: ${error.message}`);
    }
    title.textContent = filename ? filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ') : 'Kein Titel ausgewählt';
    title.title = title.textContent;
    const label = state.musicPlaying ? 'Musik pausieren' : 'Musik starten';
    play.setAttribute('aria-label', label);
    play.title = label;
    play.querySelector('use').setAttribute('href', state.musicPlaying
      ? `${pauseIcon}#icon-pause` : `${playIcon}#icon-play`);
    mute.setAttribute('aria-pressed', String(!!state.masterMuted));
    const muteLabel = state.masterMuted ? 'Audio einschalten' : 'Audio stummschalten';
    mute.setAttribute('aria-label', muteLabel);
    mute.title = muteLabel;
    buttons.forEach((button) => { button.disabled = pending || !state.musicUrl; });
  }

  async function act(action) {
    if (!manager || pending) return;
    pending = true;
    status.textContent = '';
    refresh();
    try {
      await action();
    } catch (error) {
      status.textContent = `Musik: ${error.message}`;
      window.GQLog?.warn?.('[start-music-player]', error.message);
    } finally {
      pending = false;
      refresh();
    }
  }

  play.addEventListener('click', () => act(async () => {
    if (manager.snapshot().musicPlaying) manager.pauseMusic(false);
    else if (!await manager.playMusic()) throw new Error('Wiedergabe konnte nicht gestartet werden.');
  }));
  mute.addEventListener('click', () => act(() => {
    manager.setMasterMuted(!manager.snapshot().masterMuted);
  }));
  for (const [id, direction] of [['start-music-prev', -1], ['start-music-next', 1]]) {
    root.querySelector(`#${id}`).addEventListener('click', () => act(async () => {
      if (!await manager.playNextInPlaylist(direction, true)) {
        throw new Error('Titel konnte nicht gestartet werden.');
      }
    }));
  }
  window.addEventListener('gq:audio-state', refresh);
  return {
    setManager(value) {
      manager = value;
      status.textContent = '';
      refresh();
    },
    setError(message) {
      status.textContent = `Musik: ${message}`;
    },
  };
}
