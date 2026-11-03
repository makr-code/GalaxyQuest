import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { initializeDraftWorld } from '../../js/network/draft-world.js';

const html = fs.readFileSync('index.html', 'utf8');
const data = {
  draft_mode: true, expires_at: null, email: null, confirmation_pending: false,
  world: {
    character: { name: 'DraftCommander' }, colony_name: 'Private World', system_name: 'Private System',
    position: { galaxy: 1, system: 2, position: 3 }, target: {}, stars: [],
    planets: [{ name: 'Home', position: 3 }, { name: 'Private IV', position: 4 }],
  },
  state: {
    economy: { stock: { metal: 2500, crystal: 1500 }, classes: { colonist: 1500 }, satisfaction: 78, pending_seconds: 0 },
    buildings: { metal_mine: 2 }, research: { energy_tech: 0 }, ships: { espionage_probe: 2 }, queues: {}, surveyed: [],
  },
  building_options: [{ type: 'metal_mine', label: 'Metal Mine', cost: { metal: 135, crystal: 34 } }],
  research_options: [{ type: 'energy_tech', cost: { crystal: 800 } }],
  ship_options: [{ type: 'espionage_probe', cost: { crystal: 1000 } }],
};

describe('Playable isolated draft world', () => {
  let world;
  let request;
  let onActivate;
  beforeEach(() => {
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').getElementById('draft-world').outerHTML;
    request = vi.fn(async () => ({ draft: structuredClone(data) }));
    onActivate = vi.fn(async () => {});
    world = initializeDraftWorld({ request, onActivate, onPreview: vi.fn(), onLeave: vi.fn() });
  });
  afterEach(() => {
    world.close();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });
  it('enters the private command level and restores server progress after leaving', async () => {
    await world.enter('a'.repeat(64));
    expect(request).toHaveBeenCalledWith('enter', { prolog_token: 'a'.repeat(64) });
    expect(request).toHaveBeenCalledWith('play', { kind: 'settle' });
    expect(document.body.classList.contains('draft-playing')).toBe(true);
    expect(document.getElementById('draft-location').textContent).toContain('Kein Ablaufdatum');
    document.getElementById('draft-leave').click();
    expect(world.hasDraft()).toBe(true);
    expect(world.isActive()).toBe(false);
    await world.restore();
    expect(world.isActive()).toBe(true);
    expect(request).toHaveBeenCalledWith('status');
    expect(onActivate).not.toHaveBeenCalled();
  });
  it('sends gameplay orders exclusively to the draft request callback', async () => {
    await world.enter('a'.repeat(64));
    document.getElementById('draft-building-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('play', { kind: 'building', type: 'metal_mine' }));
    expect(onActivate).not.toHaveBeenCalled();
  });
  it('does not enter the shared galaxy on delivery or verification failures', async () => {
    await world.enter('a'.repeat(64));
    request.mockRejectedValueOnce(new Error('Mail delivery failed'));
    document.getElementById('draft-email').value = 'draft@example.test';
    document.getElementById('draft-password').value = 'test-only-password';
    document.getElementById('draft-email-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('draft-error').textContent).toContain('Mail delivery failed'));
    request.mockRejectedValueOnce(new Error('Confirmation link invalid'));
    await world.confirmLink('b'.repeat(64));
    expect(document.getElementById('draft-error').textContent).toContain('Confirmation link invalid');
    expect(onActivate).not.toHaveBeenCalled();
    expect(world.isActive()).toBe(true);
  });
  it('hands over to the existing game shell only after confirmed promotion', async () => {
    request.mockResolvedValueOnce({ draft_mode: false, user: { id: 42, username: 'DraftCommander' } });
    await world.confirmLink('b'.repeat(64));
    await vi.waitFor(() => expect(onActivate).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledExactlyOnceWith('confirm', { token: 'b'.repeat(64) });
    expect(world.hasDraft()).toBe(false);
    expect(world.isActive()).toBe(false);
  });
  it('sends credentials without a code field and keeps playing while awaiting the link', async () => {
    await world.enter('a'.repeat(64));
    document.getElementById('draft-email').value = 'draft@example.test';
    document.getElementById('draft-password').value = 'test-only-password';
    document.getElementById('draft-email-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(document.getElementById('draft-mail-status').textContent).toContain('Link in deiner E-Mail'));
    expect(document.getElementById('draft-code')).toBeNull();
    expect(world.isActive()).toBe(true);
    expect(onActivate).not.toHaveBeenCalled();
  });
  it('retries a failed link without resetting the private state', async () => {
    request.mockRejectedValueOnce(new Error('Temporary failure'));
    await world.confirmLink('b'.repeat(64));
    request.mockResolvedValueOnce({ draft_mode: false, user: { id: 42 } });
    document.getElementById('draft-confirm-retry').click();
    await vi.waitFor(() => expect(onActivate).toHaveBeenCalledOnce());
    expect(request).toHaveBeenNthCalledWith(2, 'confirm', { token: 'b'.repeat(64) });
  });
  it('resumes the confirmed game when the email link was opened in another tab', async () => {
    await world.enter('a'.repeat(64));
    world.close();
    request.mockResolvedValueOnce({ draft: null, draft_mode: false, user: { id: 42 } });
    expect(await world.restore()).toBe(true);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(world.hasDraft()).toBe(false);
  });
});
