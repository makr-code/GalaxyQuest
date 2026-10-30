import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import content from '../../config/onboarding_prologue.json';
import { initializeRegistrationPrologue } from '../../js/network/registration-prologue.js';

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const target = { galaxy_index: 1, system_index: 2, position: 3, x_ly: 40, y_ly: 60, z_ly: 0 };
const species = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen']
  .map((code) => ({ code, name: code, description: `${code} habitat`, homeworld: `${code} home` }));
const catalog = {
  factions: content.factions.map((entry) => ({ ...entry, homeworld: 'Capital', target, stars: [target] })),
  species,
};
const mentorDrafts = species.map((entry, index) => {
  const mentorTarget = { ...target, system_index: index + 10, position: index + 1, x_ly: target.x_ly + index * 10 };
  return {
    mentor_code: entry.code, species_code: entry.code, selected: false,
    prolog_token: String(index + 1).repeat(64), colony_name: `${entry.name} Colony`,
    system_name: `${entry.name} System`, target: mentorTarget, stars: [mentorTarget],
    planets: [{ name: `${entry.name} III`, position: index + 1, class: 'rocky', can_colonize: true,
      semi_major_axis_au: 1.4, diameter_km: 12000 }],
    position: { galaxy: 1, system: index + 10, position: index + 1 }, expires_at: '2099-01-01T00:00:00Z',
  };
});
const draft = { ...mentorDrafts[1], faction_code: null,
  planets: [{ name: 'Draft III', position: 3, class: 'rocky', semi_major_axis_au: 1.4, diameter_km: 12000 }],
};
const el = (id) => document.getElementById(`registration-${id}`);
let audio;
let prologue;
let request;
let preview;

async function endClip() {
  await vi.waitFor(() => expect(audio.onended).toBeTypeOf('function'));
  audio.onended();
}

async function reachMentorRoom() {
  prologue.open();
  for (let i = 0; i < content.teaser.length; i++) await endClip();
  el('continue').click();
  await vi.waitFor(() => expect(el('choices').querySelectorAll('button')).toHaveLength(6));
  await vi.waitFor(() => expect(el('choices').querySelector('button').disabled).toBe(false));
}

async function reachCharacter() {
  await reachMentorRoom();
  el('choices').querySelector('[data-choice="vor_tak"]').click();
  el('continue').click();
  await vi.waitFor(() => expect(el('title').textContent).toBe('Dein Sternsystem'));
  expect(el('continue').hidden).toBe(true);
  el('choices').querySelector('[data-tutorial-planet="2"]').click();
  el('continue').click();
  el('continue').click();
  el('continue').click();
  await vi.waitFor(() => expect(el('character').hidden).toBe(false));
}

describe('Cinematic draft registration', () => {
  beforeEach(() => {
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').getElementById('registration-prologue').outerHTML;
    vi.stubGlobal('Audio', class {
      constructor() { audio = this; }
      pause = vi.fn();
      load = vi.fn();
      removeAttribute = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const id = new URL(url, 'http://localhost').searchParams.get('clip');
      const clip = content.teaser.find((entry) => entry.id === id) || content.factions.find((entry) => entry.code === id);
      return { ok: true, json: async () => ({ success: true, text: clip.text, audio_url: `generated/tts/${'b'.repeat(64)}.mp3` }) };
    }));
    request = vi.fn(async (action, input) => {
      if (action === 'register_catalog') return catalog;
      if (action === 'register_status') return { draft: null };
      if (action === 'register_mentor_drafts') return { drafts: mentorDrafts };
      if (action === 'register_select_mentor') {
        return { draft: { ...mentorDrafts.find((candidate) => candidate.mentor_code === input.mentor_code), selected: true } };
      }
      if (action === 'register_profile') return { draft: { ...draft, species_code: input.species_code } };
      if (action === 'register_character') return { draft: { ...draft, species_code: 'vor_tak', character: input } };
      if (action === 'register_portrait_status') return { portrait: { status: 'not_generated', error: '', attempts_remaining: 3, retry_after: 0, image_url: null } };
      return { draft };
    });
    preview = vi.fn();
    prologue = initializeRegistrationPrologue({ request, onPreview: preview });
  });

  afterEach(() => {
    prologue.close();
    delete window.__GQ_AUDIO_MANAGER;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('offers Back and Next during the teaser while synchronizing chapters with speech', async () => {
    prologue.open();
    expect(el('back').hidden).toBe(false);
    expect(el('continue').hidden).toBe(false);
    expect(el('continue').disabled).toBe(false);
    expect(el('title').textContent).toBe(content.teaser[0].title);
    await endClip();
    expect(el('title').textContent).toBe(content.teaser[1].title);
    expect(audio.pause).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('moves from the introduction directly to the mentor room and ignores old speech completion', async () => {
    prologue.open();
    await vi.waitFor(() => expect(audio.onended).toBeTypeOf('function'));
    const lateEnd = audio.onended;
    el('continue').click();
    lateEnd();
    expect(el('title').textContent).toBe(content.teaser[1].title);
    el('back').click();
    expect(el('title').textContent).toBe(content.teaser[0].title);
    for (let index = 0; index < content.teaser.length; index++) {
      expect(el('title').textContent).toBe(content.teaser[index].title);
      expect(el('continue').hidden).toBe(false);
      el('continue').click();
    }
    expect(el('title').textContent).toBe('Die Heroldkammer');
    await vi.waitFor(() => expect(el('choices').querySelectorAll('button')).toHaveLength(6));
    expect(request.mock.calls.some(([action]) => action === 'register_prepare')).toBe(false);
  });

  it('does not expose mentor choices while the six system drafts are loading', async () => {
    let resolveDrafts;
    const baseRequest = request.getMockImplementation();
    request.mockImplementation((action, input) => action === 'register_mentor_drafts'
      ? new Promise((resolve) => { resolveDrafts = resolve; })
      : baseRequest(action, input));
    prologue.open();
    for (let index = 0; index < content.teaser.length; index++) el('continue').click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('register_mentor_drafts', {}));
    await Promise.resolve();
    expect(el('choices').querySelectorAll('button')).toHaveLength(0);
    resolveDrafts({ drafts: mentorDrafts });
    await vi.waitFor(() => expect(el('choices').querySelectorAll('button')).toHaveLength(6));
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    expect(el('continue').disabled).toBe(false);
  });

  it('presents six mentor systems and focuses the selected species homeworld', async () => {
    await reachMentorRoom();
    expect([...el('choices').querySelectorAll('button')].map((button) => button.dataset.choice)).toEqual(species.map((entry) => entry.code));
    expect(el('continue').hidden).toBe(true);
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet', draft: expect.objectContaining({ mentor_code: 'vor_tak' }) }));
    expect(el('story').textContent).toContain('vor_tak System');
    expect(el('continue').textContent).toContain('Tutorial starten');
    el('continue').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe('Dein Sternsystem'));
    expect(request).toHaveBeenCalledWith('register_select_mentor', {
      prolog_token: mentorDrafts[1].prolog_token, mentor_code: 'vor_tak',
    });
    expect(el('continue').hidden).toBe(true);
    expect([...el('choices').querySelectorAll('[data-tutorial-planet]')]).toHaveLength(1);
    el('choices').querySelector('[data-tutorial-planet="2"]').click();
    expect(el('continue').hidden).toBe(false);
    expect(el('continue').textContent).toBe('Planet scannen');
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet', target: expect.objectContaining({ position: 2 }) }));
    el('continue').click();
    expect(el('title').textContent).toBe('Planetenscan');
    expect(el('story').textContent).toContain('Durchmesser: 12.000 km');
    expect(el('continue').textContent).toBe('Scan akzeptieren und Landeanflug starten');
    expect(request.mock.calls.some(([action]) => action === 'register_prepare')).toBe(false);
  });

  it('persists species and character privately, never requests activation or credentials', async () => {
    await reachCharacter();
    expect(request).toHaveBeenCalledWith('register_select_mentor', expect.objectContaining({ mentor_code: 'vor_tak' }));
    expect(request).toHaveBeenCalledWith('register_profile', { prolog_token: draft.prolog_token, species_code: 'vor_tak' });
    el('name').value = 'Commander';
    el('background').value = 'Grenzforscher';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('status').textContent).toContain('nicht aktiviert'));
    expect(request).toHaveBeenCalledWith('register_character', { prolog_token: draft.prolog_token, name: 'Commander', background: 'Grenzforscher' });
    expect(request.mock.calls.some(([action]) => /complete|^register$/.test(action))).toBe(false);
    expect(document.querySelector('input[type="email"],input[type="password"]')).toBeNull();
  });

  it('keeps API failures visible and does not advance to character', async () => {
    await reachMentorRoom();
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    request.mockRejectedValueOnce(new Error('Setup incomplete'));
    el('continue').click();
    await vi.waitFor(() => expect(el('error').textContent).toContain('Setup incomplete'));
    expect(el('character').hidden).toBe(true);
    expect(el('continue').disabled).toBe(false);
  });

  it('surfaces missing speech and continues with timed readable text', async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValue({ ok: false, status: 503 });
    prologue.open();
    await vi.advanceTimersByTimeAsync(1);
    expect(el('narration-status').textContent).toContain('nicht verfügbar');
    expect(el('narration-retry').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(25000);
    expect(el('title').textContent).not.toBe(content.teaser[0].title);
  });

  it('cancels stale narration and ignores late replies after Back', async () => {
    let resolve;
    fetch.mockReturnValue(new Promise((done) => { resolve = done; }));
    prologue.open();
    const signal = fetch.mock.calls[0][1].signal;
    el('back').click();
    expect(signal.aborted).toBe(true);
    resolve({ ok: true, json: async () => ({ success: true, text: content.teaser[0].text, audio_url: `generated/tts/${'b'.repeat(64)}.mp3` }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(audio.play).not.toHaveBeenCalled();
    expect(prologue.isActive()).toBe(false);
    expect(preview).toHaveBeenLastCalledWith(null);
  });

  it('does not hang the teaser when audio playback never becomes ready', async () => {
    vi.useFakeTimers();
    audio.play.mockImplementation(() => new Promise(() => {}));
    prologue.open();
    await vi.advanceTimersByTimeAsync(10001);
    expect(el('narration-status').textContent).toContain('nicht verfügbar');
    expect(el('narration-retry').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(25000);
    expect(el('title').textContent).not.toBe(content.teaser[0].title);
  });

  it('honors shared mute and leaves an existing private draft intact when closing', async () => {
    window.__GQ_AUDIO_MANAGER = { snapshot: () => ({ masterMuted: true }) };
    prologue.open();
    expect(fetch).not.toHaveBeenCalled();
    expect(el('narration-status').textContent).toContain('stummgeschaltet');
    prologue.close();
    expect(request.mock.calls.some(([action]) => action === 'register_cancel')).toBe(false);
  });

  it('ignores a late allocation after closing and reopening the prologue', async () => {
    await reachMentorRoom();
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    let resolve;
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    el('continue').click();
    prologue.close();
    prologue.open();
    resolve({ draft });
    await Promise.resolve();
    await Promise.resolve();
    expect(el('title').textContent).toBe(content.teaser[0].title);
    expect(el('character').hidden).toBe(true);
  });

  it('flies through every private scale and reverses the same stages with Back', async () => {
    await reachCharacter();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet', draft: expect.objectContaining({ planets: draft.planets }) }));
    expect(preview.mock.calls.some(([scene]) => scene?.stage === 'system')).toBe(true);
    el('name').value = 'Commander';
    el('background').value = 'Frontier explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('continue').hidden).toBe(false));
    el('continue').click();
    expect(el('surface').hidden).toBe(false);
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'surface' }));
    el('back').click();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet' }));
    el('back').click();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'surface' }));
    el('back').click();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet' }));
    el('back').click();
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'system' }));
    el('back').click();
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(request.mock.calls.some(([action]) => /complete|^register$/.test(action))).toBe(false);
  });

  it('reports an unavailable flight independently of portrait and save status', async () => {
    preview.mockReturnValue(false);
    await reachCharacter();
    expect(el('flight-status').textContent).toContain('WebGPU-Flug ist nicht verfügbar');
    expect(el('character').hidden).toBe(false);
  });

  it('generates a private portrait only for the saved character and invalidates the displayed image on edits', async () => {
    await reachCharacter();
    expect(el('portrait-generate').disabled).toBe(true);
    el('name').value = 'Commander';
    el('background').value = 'Explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('portrait-generate').disabled).toBe(false));
    const url = `api/auth.php?action=register_portrait_image&revision=${'c'.repeat(32)}`;
    request.mockResolvedValueOnce({ portrait: { status: 'generated', attempts_remaining: 2, retry_after: 0, image_url: url } });
    el('portrait-generate').click();
    await vi.waitFor(() => expect(el('portrait-image').getAttribute('src')).toBe(url));
    expect(request).toHaveBeenCalledWith('register_portrait', { prolog_token: draft.prolog_token });
    expect(el('portrait-image').hidden).toBe(true);
    el('portrait-image').dispatchEvent(new Event('load'));
    expect(el('portrait-image').hidden).toBe(false);
    el('background').value = 'Changed';
    el('background').dispatchEvent(new Event('input', { bubbles: true }));
    expect(el('portrait-image').hasAttribute('src')).toBe(false);
    expect(el('portrait-image').hidden).toBe(true);
    expect(el('portrait-generate').disabled).toBe(true);
  });

  it('reports a portrait backend failure without displaying a successful placeholder', async () => {
    await reachCharacter();
    el('name').value = 'Commander';
    el('background').value = 'Frontier explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('portrait-generate').disabled).toBe(false));
    request.mockRejectedValueOnce(new Error('SwarmUI unavailable'));
    request.mockResolvedValueOnce({ portrait: { status: 'failed', error: 'SwarmUI unavailable', attempts_remaining: 2, retry_after: 30, image_url: null } });
    el('portrait-generate').click();
    await vi.waitFor(() => expect(el('portrait-status').textContent).toContain('SwarmUI unavailable'));
    expect(el('portrait-image').hidden).toBe(true);
    expect(el('portrait-generate').disabled).toBe(true);
    expect(el('portrait-refresh').hidden).toBe(false);
  });

  it('ignores a late generated portrait after Back exits the pending flow', async () => {
    await reachCharacter();
    el('name').value = 'Commander';
    el('background').value = 'Frontier explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('portrait-generate').disabled).toBe(false));
    let resolve;
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    el('portrait-generate').click();
    expect(el('character-form').inert).toBe(true);
    el('back').click();
    resolve({ portrait: { status: 'generated', attempts_remaining: 2, retry_after: 0, image_url: `api/auth.php?action=register_portrait_image&revision=${'c'.repeat(32)}` } });
    await Promise.resolve();
    await Promise.resolve();
    expect(prologue.isActive()).toBe(false);
    expect(el('portrait-image').hasAttribute('src')).toBe(false);
  });
});
