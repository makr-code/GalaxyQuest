import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initializeStartMusicPlayer } from '../../js/network/start-music-player.js';

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

describe('Start music player', () => {
  let state;
  let manager;
  let player;
  beforeEach(() => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.append(document.importNode(parsed.getElementById('start-music-player'), true));
    document.body.append(document.importNode(parsed.getElementById('topbar-player'), true));
    state = { musicUrl: 'music/Nebula_Overture.mp3', musicPlaying: false, masterMuted: false,
      musicVolume: 0.55, playlist: ['music/Nebula_Overture.mp3', 'music/Second_Track.mp3'] };
    manager = {
      snapshot: () => state,
      playMusic: vi.fn(async () => { state.musicPlaying = true; return true; }),
      pauseMusic: vi.fn(() => { state.musicPlaying = false; }),
      setMasterMuted: vi.fn((muted) => { state.masterMuted = muted; }),
      playNextInPlaylist: vi.fn(async () => true),
      setMusicTrack: vi.fn(async (url, autoplay) => { state.musicUrl = url; state.musicPlaying = autoplay; return true; }),
      setMusicVolume: vi.fn((volume) => { state.musicVolume = volume; }),
      setMusicDuckingEnabled: vi.fn((value) => { state.musicDuckingEnabled = value; }),
      setMusicDuckingStrength: vi.fn((value) => { state.musicDuckingStrength = value; }),
    };
  });
  afterEach(() => {
    player?.destroy();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps controls disabled until the shared manager is ready and updates title safely', () => {
    player = initializeStartMusicPlayer();
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

  it('exposes persisted speech ducking controls and reflects external changes', async () => {
    player = initializeStartMusicPlayer();
    const enabled = document.getElementById('topbar-player-ducking');
    const strength = document.getElementById('topbar-player-ducking-strength');
    expect(enabled.disabled).toBe(true);
    player.setManager(manager);
    expect(enabled.checked).toBe(true);
    expect(strength.value).toBe('55');
    enabled.click();
    await vi.waitFor(() => expect(strength.disabled).toBe(true));
    expect(manager.setMusicDuckingEnabled).toHaveBeenCalledWith(false);
    enabled.click();
    await vi.waitFor(() => expect(strength.disabled).toBe(false));
    strength.value = '70';
    strength.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(manager.setMusicDuckingStrength).toHaveBeenCalledWith(0.7));
    state.musicDuckingStrength = 0.3;
    window.dispatchEvent(new Event('gq:audio-state'));
    expect(strength.value).toBe('30');
    player.destroy();
    enabled.click();
    expect(manager.setMusicDuckingEnabled).toHaveBeenCalledTimes(2);
  });
  it('plays, pauses without rewinding, mutes and switches both directions', async () => {
    player = initializeStartMusicPlayer();
    player.setManager(manager);
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
    player = initializeStartMusicPlayer();
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
    player = initializeStartMusicPlayer();
    player.setManager(manager);
    document.querySelector('#start-music-next').click();
    document.querySelector('#start-music-next').click();
    expect(manager.playNextInPlaylist).toHaveBeenCalledOnce();
    expect(document.querySelector('#start-music-play').disabled).toBe(true);
    finish(true);
    await vi.waitFor(() => expect(document.querySelector('#start-music-play').disabled).toBe(false));
  });

  it('shares play/pause, mute, playlist and volume across both surfaces', async () => {
    player = initializeStartMusicPlayer();
    player.setManager(manager);
    document.querySelector('#topbar-player-toggle').click();
    await vi.waitFor(() => expect(document.querySelector('#start-music-play').getAttribute('aria-label')).toBe('Musik pausieren'));
    document.querySelector('#audio-toggle-btn').click();
    await vi.waitFor(() => expect(document.querySelector('#start-music-mute').getAttribute('aria-pressed')).toBe('true'));
    const select = document.querySelector('#topbar-player-track');
    expect(select.options).toHaveLength(2);
    select.value = 'music/Second_Track.mp3';
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('#start-music-title').textContent).toBe('Second Track'));
    expect(manager.setMusicTrack).toHaveBeenCalledWith('music/Second_Track.mp3', true);
    const volume = document.querySelector('#topbar-player-volume');
    volume.value = '23';
    volume.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(document.querySelector('#start-music-volume').value).toBe('23'));
    expect(manager.setMusicVolume).toHaveBeenCalledWith(0.23);
    expect(document.querySelector('#topbar-player-current').textContent).toBe('Second Track');
  });

  it('keeps live sliders enabled while applying every input update', () => {
    player = initializeStartMusicPlayer();
    player.setManager(manager);
    const volume = document.querySelector('#topbar-player-volume');
    const strength = document.querySelector('#topbar-player-ducking-strength');

    volume.value = '21';
    volume.dispatchEvent(new Event('input'));
    expect(volume.disabled).toBe(false);
    volume.value = '43';
    volume.dispatchEvent(new Event('input'));
    expect(volume.disabled).toBe(false);
    expect(manager.setMusicVolume.mock.calls).toEqual([[0.21], [0.43]]);

    strength.value = '35';
    strength.dispatchEvent(new Event('input'));
    expect(strength.disabled).toBe(false);
    strength.value = '72';
    strength.dispatchEvent(new Event('input'));
    expect(strength.disabled).toBe(false);
    expect(manager.setMusicDuckingStrength.mock.calls).toEqual([[0.35], [0.72]]);
  });

  it('keeps a paused track paused when selected and reports failures on both players', async () => {
    player = initializeStartMusicPlayer();
    player.setManager(manager);
    document.querySelector('#topbar-player-track-list button:last-child').click();
    await vi.waitFor(() => expect(manager.setMusicTrack).toHaveBeenCalledWith('music/Second_Track.mp3', false));
    manager.playMusic.mockResolvedValue(false);
    await vi.waitFor(() => expect(document.querySelector('#topbar-player-toggle').disabled).toBe(false));
    document.querySelector('#topbar-player-toggle').click();
    await vi.waitFor(() => expect(document.querySelector('#topbar-player-status').textContent).toContain('nicht gestartet'));
    expect(document.querySelector('#start-music-status').textContent).toBe(document.querySelector('#topbar-player-status').textContent);
  });

  it('opens the accessible menu, closes on Escape, and removes all bindings on disposal', () => {
    player = initializeStartMusicPlayer();
    player.setManager(manager);
    const toggle = document.querySelector('#topbar-player-menu-toggle');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    player.destroy();
    document.querySelector('#topbar-player-toggle').click();
    expect(manager.playMusic).not.toHaveBeenCalled();
  });
});
