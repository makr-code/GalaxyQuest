import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initializeStartMusicPlayer } from '../../js/network/start-music-player.js';

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

describe('Start music player', () => {
  let state;
  let manager;
  beforeEach(() => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(document.importNode(parsed.getElementById('start-music-player'), true));
    state = { musicUrl: 'music/Nebula_Overture.mp3', musicPlaying: false, masterMuted: false };
    manager = {
      snapshot: () => state,
      playMusic: vi.fn(async () => { state.musicPlaying = true; return true; }),
      pauseMusic: vi.fn(() => { state.musicPlaying = false; }),
      setMasterMuted: vi.fn((muted) => { state.masterMuted = muted; }),
      playNextInPlaylist: vi.fn(async () => true),
    };
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps controls disabled until the shared manager is ready and updates title safely', () => {
    const player = initializeStartMusicPlayer();
    expect(document.querySelector('#start-music-play').disabled).toBe(true);
    player.setManager(manager);
    expect(document.querySelector('#start-music-play').disabled).toBe(false);
    expect(document.querySelector('#start-music-title').textContent).toBe('Nebula Overture');
    state.musicUrl = 'music/<img>.mp3';
    window.dispatchEvent(new Event('gq:audio-state'));
    expect(document.querySelector('#start-music-title').textContent).toBe('<img>');
    expect(document.querySelector('#start-music-title img')).toBeNull();
    state.musicUrl = 'music/Stellar_Ascension%20trance%20v1.mp3';
    window.dispatchEvent(new Event('gq:audio-state'));
    expect(document.querySelector('#start-music-title').textContent).toBe('Stellar Ascension trance v1');
  });

  it('plays, pauses without rewinding, mutes and switches both directions', async () => {
    initializeStartMusicPlayer().setManager(manager);
    const play = document.querySelector('#start-music-play');
    play.click();
    await vi.waitFor(() => expect(play.getAttribute('aria-label')).toBe('Musik pausieren'));
    expect(manager.playMusic).toHaveBeenCalledOnce();
    expect(play.querySelector('use').getAttribute('href')).toContain('#icon-pause');
    play.click();
    await vi.waitFor(() => expect(play.disabled).toBe(false));
    expect(manager.pauseMusic).toHaveBeenCalledWith(false);
    document.querySelector('#start-music-mute').click();
    await vi.waitFor(() => expect(document.querySelector('#start-music-mute').getAttribute('aria-pressed')).toBe('true'));
    expect(manager.setMasterMuted).toHaveBeenCalledWith(true);
    document.querySelector('#start-music-next').click();
    await vi.waitFor(() => expect(play.disabled).toBe(false));
    expect(manager.playNextInPlaylist).toHaveBeenCalledWith(1, true);
    document.querySelector('#start-music-prev').click();
    await vi.waitFor(() => expect(manager.playNextInPlaylist).toHaveBeenCalledWith(-1, true));
  });

  it('reflects external audio changes and surfaces blocked playback', async () => {
    const player = initializeStartMusicPlayer();
    player.setManager(manager);
    state.masterMuted = true;
    state.musicPlaying = true;
    window.dispatchEvent(new Event('gq:audio-state'));
    expect(document.querySelector('#start-music-mute').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#start-music-play').getAttribute('aria-label')).toBe('Musik pausieren');
    state.musicPlaying = false;
    manager.playMusic.mockResolvedValue(false);
    document.querySelector('#start-music-play').click();
    await vi.waitFor(() => expect(document.querySelector('#start-music-status').textContent).toContain('nicht gestartet'));
    expect(document.querySelector('#start-music-play').disabled).toBe(false);
    player.setError('Audio nicht verfügbar.');
    expect(document.querySelector('#start-music-status').textContent).toContain('Audio nicht verfügbar');
  });

  it('prevents overlapping commands while a track switch is pending', async () => {
    let finish;
    manager.playNextInPlaylist.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    initializeStartMusicPlayer().setManager(manager);
    document.querySelector('#start-music-next').click();
    document.querySelector('#start-music-next').click();
    expect(manager.playNextInPlaylist).toHaveBeenCalledOnce();
    expect(document.querySelector('#start-music-play').disabled).toBe(true);
    finish(true);
    await vi.waitFor(() => expect(document.querySelector('#start-music-play').disabled).toBe(false));
  });
});
