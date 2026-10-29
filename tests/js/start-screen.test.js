import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { initializeStartScreen } from '../../js/network/start-screen.js';

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

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
      ok: true, json: async () => ({ success: true, announcements: [] }),
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

  it('toggles the cascade and closes it on outside interaction', () => {
    initializeStartScreen();
    const button = document.getElementById('start-login');
    button.click();
    button.click();
    expect(document.getElementById('start-auth-dialog')).toBeNull();
    button.click();
    document.getElementById('start-menu').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.getElementById('start-auth-dialog')).toBeNull();
    button.click();
    document.getElementById('start-register').click();
    expect(document.querySelector('#start-auth-dialog')).toBeNull();
    expect(document.getElementById('registration-prologue').hidden).toBe(false);
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the lore without credentials or allocation and restores the menu on Back', () => {
    const request = vi.fn();
    const preview = vi.fn();
    const screen = initializeStartScreen({ onRegistrationRequest: request, onRegistrationPreview: preview });
    document.getElementById('start-register').click();
    expect(document.body.classList.contains('registration-active')).toBe(true);
    expect(document.getElementById('registration-title').textContent).toContain('Sterne');
    expect(document.getElementById('register-form')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    document.getElementById('registration-back').click();
    expect(screen.registration.isActive()).toBe(false);
    expect(document.body.classList.contains('registration-active')).toBe(false);
    expect(document.getElementById('start-register')).toBe(document.activeElement);
    expect(preview).toHaveBeenCalledWith(null);
  });

  it('shows Resume only for a server-confirmed session without auto-resuming', async () => {
    const onResume = vi.fn().mockResolvedValue(undefined);
    const screen = initializeStartScreen({ onResume });
    screen.setSession(true, 'Commander');
    expect(document.getElementById('start-login').hidden).toBe(true);
    expect(document.getElementById('start-register').hidden).toBe(true);
    expect(document.getElementById('start-resume').hidden).toBe(false);
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
