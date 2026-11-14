import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { animate } from 'motion/mini';
import { initializeStartScreen } from '../../js/network/start-screen.js';

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

vi.mock('motion/mini', () => ({
  animate: vi.fn(() => ({
    then: (resolve) => Promise.resolve().then(resolve),
    stop: vi.fn(),
    complete: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
  })),
}));

async function startCampaign() {
  document.getElementById('start-register').click();
  await vi.waitFor(() => {
    expect(document.getElementById('registration-prologue').hidden).toBe(false);
    expect(document.getElementById('registration-prologue').dataset.phase).toBe('opening');
  });
}

describe('Start-screen menu', () => {
  beforeEach(() => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['auth-section', 'auth-forms-template', 'auth-status-section', 'boot-terminal', 'server-announcements-dialog', 'registration-prologue']) {
      document.body.append(document.importNode(parsed.getElementById(id), true));
    }
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.stubGlobal('Audio', class {
      pause() {}
      load() {}
      removeAttribute() {}
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, announcements: [], posts: [] }),
    }));
    HTMLDialogElement.prototype.showModal = vi.fn(function () {
      this.open = true;
    });
    HTMLDialogElement.prototype.show = vi.fn(function () {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function () {
      this.open = false;
    });
    localStorage.clear();
  });

  afterEach(() => {
    document.querySelectorAll('button:disabled').forEach((button) => { button.disabled = false; });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.show;
    delete HTMLDialogElement.prototype.close;
    document.body.innerHTML = '';
    document.body.className = '';
    delete document.body.dataset.startReducedMotion;
    localStorage.clear();
  });

  it('keeps forms out of the active DOM until a menu button opens the overlay', () => {
    initializeStartScreen();
    expect(document.getElementById('login-form')).toBeNull();
    expect(document.querySelector('#start-auth-dialog')).toBeNull();

    document.getElementById('start-login').click();

    expect(document.querySelector('#start-auth-dialog').open).toBe(true);
    expect(document.getElementById('login-form').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('login-username')).toBe(document.activeElement);
    expect(document.querySelector('[data-wm-window="auth"]')).toBeNull();
    expect(document.querySelector('#start-auth-dialog').parentElement).toBe(document.querySelector('.start-panel-anchor'));
    expect(document.getElementById('start-login').getAttribute('aria-expanded')).toBe('true');
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('#start-auth-dialog')).toBeNull();
    expect(document.getElementById('start-login').getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves form handlers across close and reopen and clears passwords', () => {
    const screen = initializeStartScreen();
    const submit = vi.fn((event) => event.preventDefault());
    screen.authRoot.querySelector('#login-form').addEventListener('submit', submit);
    document.getElementById('start-login').click();
    document.getElementById('login-password').value = 'temporary-password';
    screen.closeAuth();
    expect(document.getElementById('login-form')).toBeNull();
    expect(screen.authRoot.querySelector('#login-password').value).toBe('');

    document.getElementById('start-login').click();
    document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('toggles the cascade and closes it on outside interaction', async () => {
    initializeStartScreen();
    const button = document.getElementById('start-login');
    button.click();
    button.click();
    expect(document.getElementById('start-auth-dialog')).toBeNull();
    button.click();
    document.getElementById('start-menu').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.getElementById('start-auth-dialog')).toBeNull();
    button.click();
    await startCampaign();
    expect(document.querySelector('#start-auth-dialog')).toBeNull();
    expect(document.getElementById('registration-prologue').hidden).toBe(false);
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the lore without credentials or allocation and restores the menu on Back', async () => {
    const request = vi.fn();
    const preview = vi.fn();
    const screen = initializeStartScreen({ onRegistrationRequest: request, onRegistrationPreview: preview });
    await startCampaign();
    expect(document.body.classList.contains('registration-active')).toBe(true);
    expect(document.getElementById('registration-title').textContent).toBe('Eine Galaxie');
    expect(document.getElementById('register-form')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    document.getElementById('registration-back').click();
    expect(screen.registration.isActive()).toBe(false);
    expect(document.body.classList.contains('registration-active')).toBe(false);
    expect(document.getElementById('start-register')).toBe(document.activeElement);
    expect(preview).toHaveBeenCalledWith(null);
  });

  it('starts the cinematic only on a new campaign and restores the captured view on early exit', async () => {
    const snapshot = { camera: 'before-opening' };
    const transition = {
      capture: vi.fn(() => snapshot),
      begin: vi.fn(),
      restore: vi.fn(() => true),
    };
    const request = vi.fn();
    const screen = initializeStartScreen({ onRegistrationTransition: transition, onRegistrationRequest: request });
    expect(screen.registration.isActive()).toBe(false);
    document.getElementById('start-login').click();
    expect(screen.registration.isActive()).toBe(false);
    document.getElementById('start-register').click();
    await vi.waitFor(() => expect(screen.registration.isActive()).toBe(true));
    expect(document.getElementById('registration-prologue').dataset.phase).toBe('opening');
    expect(transition.capture).toHaveBeenCalledOnce();
    expect(transition.begin).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    document.getElementById('registration-back').click();
    expect(transition.restore).toHaveBeenCalledWith(snapshot);
    expect(screen.registration.isActive()).toBe(false);
    expect(document.getElementById('start-register')).toBe(document.activeElement);
  });

  it('guards repeated campaign clicks and cancels an unfinished exit with Escape', async () => {
    const transition = { capture: vi.fn(() => ({})), restore: vi.fn(() => true), begin: vi.fn() };
    const screen = initializeStartScreen({ onRegistrationTransition: transition });
    await vi.waitFor(() => expect(document.getElementById('start-menu').dataset.motionState).toBe('visible'));
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    animate.mockImplementationOnce(() => ({
      then: finished.then.bind(finished), stop: vi.fn(), complete: vi.fn(finish),
    }));
    document.getElementById('start-register').click();
    document.getElementById('start-register').click();
    expect(transition.capture).toHaveBeenCalledOnce();
    expect(screen.registration.isActive()).toBe(false);
    expect(document.getElementById('start-menu').inert).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(transition.restore).toHaveBeenCalledOnce();
    expect(document.getElementById('start-menu').inert).toBe(false);
    finish();
    await vi.waitFor(() => expect(document.getElementById('start-menu').dataset.motionState).toBe('visible'));
    expect(screen.registration.isActive()).toBe(false);
    expect(transition.begin).not.toHaveBeenCalled();
  });

  it('pauses the automatic galaxy tour during registration and resumes it without changing its preference', async () => {
    localStorage.setItem('gq_start_flight_tour', '1');
    const onFlightTour = vi.fn(() => true);
    initializeStartScreen({ onFlightTour });
    expect(onFlightTour).toHaveBeenNthCalledWith(1, true);

    await startCampaign();
    expect(onFlightTour).toHaveBeenNthCalledWith(2, false);
    expect(localStorage.getItem('gq_start_flight_tour')).toBe('1');

    document.getElementById('registration-back').click();
    expect(onFlightTour).toHaveBeenNthCalledWith(3, true);
    expect(localStorage.getItem('gq_start_flight_tour')).toBe('1');
  });

  it('captures the current view before pausing and restores it when the opening is cancelled', async () => {
    localStorage.setItem('gq_start_flight_tour', '1');
    const calls = [];
    const snapshot = { camera: 'current-view' };
    const onRegistrationTransition = {
      capture: vi.fn(() => { calls.push('capture'); return snapshot; }),
      begin: vi.fn(),
      skip: vi.fn(),
      restore: vi.fn(() => calls.push('restore')),
    };
    const onFlightTour = vi.fn((enabled) => { calls.push(enabled ? 'tour-start' : 'tour-stop'); return true; });
    const preview = vi.fn();
    initializeStartScreen({ onFlightTour, onRegistrationTransition, onRegistrationPreview: preview });

    await startCampaign();
    expect(calls.slice(0, 3)).toEqual(['tour-start', 'capture', 'tour-stop']);
    expect(onRegistrationTransition.begin).not.toHaveBeenCalled();
    expect(document.getElementById('registration-prologue').dataset.phase).toBe('opening');
    expect(document.getElementById('registration-prologue').dataset.transitionReady).toBe('true');
    expect(preview).toHaveBeenCalledWith({ stage: 'opening', beat: 'opening-galaxy' });

    document.getElementById('registration-back').click();
    expect(onRegistrationTransition.restore).toHaveBeenCalledWith(snapshot);
    expect(calls.slice(-2)).toEqual(['restore', 'tour-start']);
    await Promise.resolve();
    expect(document.getElementById('registration-prologue').hidden).toBe(true);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview).toHaveBeenCalledWith(null);
  });

  it('skips the comet into the public homeland tour without allocating drafts', async () => {
    const snapshot = { camera: 'current-view' };
    const onRegistrationTransition = {
      capture: vi.fn(() => snapshot),
      begin: vi.fn(),
      skip: vi.fn(),
      restore: vi.fn(),
    };
    const preview = vi.fn();
    const request = vi.fn(async () => ({
      species: ['aereth', 'kryl_tha', 'syl_nar', 'vel_ar', 'vor_tak', 'zhareen'].map((code, index) => ({
        code, name: `Species ${index}`, homeworld: `Home ${index}`, description: 'Homeworld',
        target: { position: 1 }, stars: [{}], homeworld_scene: { scene_key: `home:${index}` },
      })),
      npc_homeworlds: ['iron_fleet', 'helion_confederation', 'ketzer_von_verath'].map((code) => ({ code })),
    }));
    initializeStartScreen({ onRegistrationTransition, onRegistrationPreview: preview, onRegistrationRequest: request });
    await startCampaign();
    document.getElementById('registration-opening-skip').click();
    await vi.waitFor(() => expect(document.getElementById('registration-title').textContent).toBe('Home 0'));
    expect(request).toHaveBeenCalledExactlyOnceWith('register_catalog');
    expect(onRegistrationTransition.begin).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet' }));
  });

  it('uses the reduced-motion preference for the comet opening', async () => {
    localStorage.setItem('gq_start_reduced_motion', '1');
    const onRegistrationTransition = {
      capture: vi.fn(() => ({})),
      begin: vi.fn(() => true),
      skip: vi.fn(),
      restore: vi.fn(),
    };
    const camera = { play: vi.fn(() => true), pause: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    initializeStartScreen({ onRegistrationTransition, onRegistrationCamera: camera });
    await startCampaign();
    expect(document.body.dataset.startReducedMotion).toBe('true');
    expect(camera.play).toHaveBeenCalledWith(expect.objectContaining({ kind: 'comet' }));
  });

  it('restarts the comet instead of invoking the obsolete teaser arrival', async () => {
    const pending = [];
    const onRegistrationTransition = {
      capture: vi.fn(() => ({})),
      begin: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
      skip: vi.fn(),
      restore: vi.fn(),
    };
    const preview = vi.fn();
    initializeStartScreen({ onRegistrationTransition, onRegistrationPreview: preview });
    await startCampaign();
    document.getElementById('registration-back').click();
    await startCampaign();
    expect(pending).toHaveLength(0);
    expect(document.getElementById('registration-prologue').dataset.phase).toBe('opening');
    expect(preview).toHaveBeenLastCalledWith({ stage: 'opening', beat: 'opening-galaxy' });
  });

  it('keeps the comet opening navigable when its camera fails', async () => {
    const warn = vi.fn();
    window.GQLog = { warn };
    const onRegistrationTransition = {
      capture: vi.fn(() => ({})),
      begin: vi.fn(() => Promise.reject(new Error('camera unavailable'))),
      skip: vi.fn(),
      restore: vi.fn(),
    };
    const camera = { play: vi.fn(() => Promise.reject(new Error('camera unavailable'))), pause: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    initializeStartScreen({ onRegistrationTransition, onRegistrationCamera: camera });
    await startCampaign();
    await Promise.resolve();
    expect(document.getElementById('registration-title').textContent).toBe('Eine Galaxie');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[registration-camera]', 'camera unavailable'));
    expect(document.getElementById('registration-flight-status').textContent).toContain('nicht verfügbar');
    delete window.GQLog;
  });

  it('reports an unavailable camera transition and keeps the prologue usable', async () => {
    const onRegistrationTransition = {
      capture: vi.fn(() => ({})),
      begin: vi.fn(() => false),
      skip: vi.fn(),
      restore: vi.fn(() => false),
    };
    const camera = { play: vi.fn(() => false), pause: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    initializeStartScreen({ onRegistrationTransition, onRegistrationCamera: camera });
    await startCampaign();
    await Promise.resolve();
    expect(document.getElementById('registration-title').textContent).toBe('Eine Galaxie');
    expect(document.getElementById('registration-flight-status').textContent).toContain('nicht verfügbar');
    document.getElementById('registration-back').click();
    expect(document.getElementById('start-session-status').textContent).toContain('nicht wiederhergestellt');
  });

  it('reports the fallback after the opening when no current view can be captured', async () => {
    const onRegistrationTransition = {
      capture: vi.fn(() => null),
      begin: vi.fn(),
      skip: vi.fn(),
      restore: vi.fn(),
    };
    const camera = { play: vi.fn(() => false), pause: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    initializeStartScreen({ onRegistrationTransition, onRegistrationCamera: camera });
    await startCampaign();
    await Promise.resolve();
    expect(onRegistrationTransition.begin).not.toHaveBeenCalled();
    expect(document.getElementById('registration-title').textContent).toBe('Eine Galaxie');
    expect(document.getElementById('registration-flight-status').textContent).toContain('nicht verfügbar');
  });

  it('shows Fortsetzen instead of login only for a server-confirmed session without auto-resuming', async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    const screen = initializeStartScreen({ onResume });
    screen.setSession(true, 'Commander');
    expect(document.getElementById('start-login').hidden).toBe(true);
    expect(document.getElementById('start-register').hidden).toBe(true);
    expect(document.getElementById('start-resume').hidden).toBe(false);
    expect(document.getElementById('start-resume').textContent).toBe('Fortsetzen');
    expect(document.getElementById('start-session-status').textContent).toContain('Commander');
    expect(onResume).not.toHaveBeenCalled();
    document.getElementById('start-resume').click();
    await vi.waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    screen.setSession(false);
    expect(document.getElementById('start-login').hidden).toBe(false);
  });

  it('keeps the settings mute checkbox in sync with shared player changes', () => {
    initializeStartScreen();
    window.dispatchEvent(new CustomEvent('gq:audio-state', { detail: { masterMuted: true } }));
    expect(document.getElementById('start-mute').checked).toBe(true);
    window.dispatchEvent(new CustomEvent('gq:audio-state', { detail: { masterMuted: false } }));
    expect(document.getElementById('start-mute').checked).toBe(false);
  });

  it('starts and stops the optional flight tour from Settings and respects reduced motion', async () => {
    const onFlightTour = vi.fn().mockResolvedValue(true);
    initializeStartScreen({ onFlightTour });
    const toggle = document.getElementById('start-flight-tour');
    toggle.click();
    await vi.waitFor(() => expect(onFlightTour).toHaveBeenLastCalledWith(true));
    expect(localStorage.getItem('gq_start_flight_tour')).toBe('1');
    toggle.click();
    await vi.waitFor(() => expect(onFlightTour).toHaveBeenLastCalledWith(false));
    expect(localStorage.getItem('gq_start_flight_tour')).toBe('0');

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    document.body.innerHTML = '';
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['auth-section', 'auth-forms-template', 'auth-status-section', 'boot-terminal', 'server-announcements-dialog', 'registration-prologue']) {
      document.body.append(document.importNode(parsed.getElementById(id), true));
    }
    localStorage.clear();
    const blockedTour = vi.fn();
    initializeStartScreen({ onFlightTour: blockedTour });
    const blockedToggle = document.getElementById('start-flight-tour');
    blockedToggle.checked = true;
    blockedToggle.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(blockedTour).not.toHaveBeenCalled();
    expect(blockedToggle.checked).toBe(false);
    expect(document.getElementById('start-flight-status').textContent).toContain('Reduce motion');
  });

  it('opens the existing HTML content panels and saves motion preferences', () => {
    initializeStartScreen();
    document.querySelector('[data-start-panel="settings"]').click();
    expect(document.getElementById('start-content-dialog').open).toBe(true);
    expect(document.getElementById('start-panel-settings').hidden).toBe(false);
    expect(document.getElementById('start-panel-news').hidden).toBe(true);
    document.getElementById('start-reduced-motion').click();
    expect(localStorage.getItem('gq_start_reduced_motion')).toBe('1');
    expect(document.body.classList.contains('start-reduced-motion')).toBe(true);
  });

  it('defaults to the female German TTS voice and saves voice changes from the start menu', () => {
    initializeStartScreen();
    const voice = document.getElementById('start-tts-voice');
    expect(voice.value).toBe('de_DE-kerstin-low');
    expect([...voice.options].map((option) => option.value)).toEqual([
      'de_DE-kerstin-low',
      'de_DE-thorsten-high',
      'en_US-lessac-high',
      'en_US-ryan-high',
    ]);
    document.querySelector('[data-start-panel="settings"]').click();
    voice.value = 'en_US-ryan-high';
    voice.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('gq_tts_voice')).toBe('en_US-ryan-high');
    expect(document.getElementById('start-settings-status').textContent).toContain('saved');
  });

  it('reports Resume errors instead of entering the game', async () => {
    const screen = initializeStartScreen({ onResume: vi.fn().mockRejectedValue(new Error('Session expired')) });
    screen.setSession(true);
    document.getElementById('start-resume').click();
    await vi.waitFor(() => expect(document.getElementById('start-session-status').textContent).toContain('Session expired'));
    expect(document.getElementById('start-resume').disabled).toBe(false);
  });

  it('lets an explicit motion preference override the system default', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    localStorage.setItem('gq_start_reduced_motion', '0');
    initializeStartScreen();
    expect(document.getElementById('start-reduced-motion').checked).toBe(false);
    expect(document.body.dataset.startReducedMotion).toBe('false');
  });

  it('reports storage failures while still applying motion for this session', () => {
    initializeStartScreen();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    document.getElementById('start-reduced-motion').click();
    expect(document.body.classList.contains('start-reduced-motion')).toBe(true);
    expect(document.getElementById('start-settings-status').textContent).toContain('Storage unavailable');
  });

  it('keeps pending authentication open and shows its progress inside the dialog', () => {
    const screen = initializeStartScreen();
    document.getElementById('start-login').click();
    const submit = screen.authRoot.querySelector('#login-form button[type="submit"]');
    submit.disabled = true;
    screen.setActivity('Signing in...', 'Verifying session.');
    screen.closeAuth();
    expect(document.querySelector('#start-auth-dialog .start-auth-activity').textContent).toContain('Verifying session');
    submit.disabled = false;
    screen.closeAuth();
    expect(document.getElementById('start-auth-dialog')).toBeNull();
  });
});
