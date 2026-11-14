import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import content from '../../config/onboarding_prologue.json';
import cometNarration from '../../config/onboarding_narration.json';
import { initializeRegistrationPrologue } from '../../js/network/registration-prologue.js';
import { animate } from 'motion/mini';

vi.mock('motion/mini', () => ({
  animate: vi.fn(() => ({
    then: (resolve) => Promise.resolve().then(resolve),
    stop: vi.fn(), complete: vi.fn(), pause: vi.fn(), play: vi.fn(),
  })),
}));

const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
const target = { galaxy_index: 1, system_index: 2, position: 3, x_ly: 40, y_ly: 60, z_ly: 0 };
const species = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen']
  .map((code) => ({ code, name: code, description: `${code} habitat`, homeworld: `${code} home`,
    target, stars: [target], homeworld_scene: { scene_key: `homeworld:${code}`, target,
      position: { galaxy: 1, system: 2, position: 3 }, system_name: `${code} home system`,
      star: { temperature_k: 5500, radius_solar: 1 },
      planets: [{ position: 3, name: `${code} home`, diameter_km: 12000, semi_major_axis_au: 1, inhabited: true }],
    } }));
const npcHomeworlds = content.npc_tour.map((entry, index) => ({
  ...entry, target, stars: [target], homeworld_scene: { ...species[index].homeworld_scene,
    scene_key: `homeworld:${entry.code}` },
}));
const catalog = {
  factions: content.factions.map((entry) => ({ ...entry, homeworld: 'Capital', target, stars: [target] })),
  species, npc_homeworlds: npcHomeworlds,
};
const scriptedTour = cometNarration.stops.map((stop) =>
  [...species, ...npcHomeworlds].find((entry) => entry.code === stop.code));
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
let onEnterDraft;
let onClose;
let camera;

async function endClip() {
  await vi.waitFor(() => expect(audio.onended).toBeTypeOf('function'));
  audio.onended();
}

async function finishTimedTransit(code) {
  const stop = cometNarration.stops.find((entry) => entry.code === code);
  const duration = stop.transit.reduce((total, cue) => total + cue.duration_ms, 2500);
  await vi.advanceTimersByTimeAsync(duration);
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
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      const parsedUrl = new URL(url, 'http://localhost');
      if (parsedUrl.pathname.endsWith('/auth.php')) {
        return { ok: true, json: async () => ({ token: 'registration-test-csrf' }) };
      }
      const requestBody = JSON.parse(options.body || '{}');
      const clipId = parsedUrl.searchParams.get('clip') || requestBody.clip;
      const voice = requestBody.voice || 'de_DE-kerstin-low';
      const language = cometNarration.voices[voice];
      const staticClip = [...content.teaser, ...(content.registration_steps || [])].find((entry) => entry.id === clipId)
        || content.factions.find((entry) => entry.code === clipId);
      const mentorCode = clipId?.match(/^mentor-(.+)$/)?.[1];
      const mentorSpecies = species.find((entry) => entry.code === mentorCode);
      const mentorDraft = mentorDrafts.find((entry) => entry.mentor_code === mentorCode);
      const mentorPlanet = mentorDraft?.planets.find((entry) => entry.position === mentorDraft.target.position);
      const text = staticClip?.text || (mentorSpecies && mentorDraft
        ? `Ich bin der Herold der ${mentorSpecies.name}. ${mentorSpecies.description}\n\nMein System heißt ${mentorDraft.system_name}. Die mögliche Heimatwelt ist ${mentorPlanet?.name || mentorDraft.colony_name}.`
        : cometNarration.clips[clipId]?.[language] || '');
      return { ok: true, json: async () => ({
        success: true, text, voice, audio_url: `generated/tts/${'b'.repeat(64)}.mp3`,
      }) };
    }));
    request = vi.fn(async (action, input) => {
      if (action === 'register_catalog') return catalog;
      if (action === 'register_status') return { draft: null };
      if (action === 'register_mentor_drafts') return { drafts: mentorDrafts };
      if (action === 'register_select_mentor') {
        return { draft: { ...mentorDrafts.find((candidate) => candidate.mentor_code === input.mentor_code), selected: true } };
      }
      if (action === 'register_profile') return { draft: { ...draft, species_code: input.species_code } };
      if (action === 'register_character_suggest') return {
        suggestion: { name: 'DrakThuun', background: 'Auf Drak’Thuun lernte diese Person, Stärke mit Verantwortung zu verbinden.' },
      };
      if (action === 'register_character') return { draft: { ...draft, species_code: 'vor_tak', character: input } };
      if (action === 'register_portrait_status') return { portrait: { status: 'not_generated', error: '', attempts_remaining: 3, retry_after: 0, image_url: null } };
      if (action === 'register_portrait' || action === 'register_portrait_progress') {
        return { portrait: { status: 'pending', error: '', attempts_remaining: 2, retry_after: 0, image_url: null } };
      }
      return { draft };
    });
    preview = vi.fn();
    onEnterDraft = vi.fn(async () => {});
    onClose = vi.fn();
    camera = { play: vi.fn(() => true), pause: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    prologue = initializeRegistrationPrologue({ request, onPreview: preview, onCamera: camera, onEnterDraft, onClose });
  });

  afterEach(() => {
    prologue.close();
    delete window.__GQ_AUDIO_MANAGER;
    delete window.GQTTS;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('tracks narration ducking and releases the active clip on navigation and close', async () => {
    const releases = [];
    window.__GQ_AUDIO_MANAGER = {
      snapshot: () => ({ masterVolume: 0.8, ttsVolume: 0.95 }),
      trackTtsAudio: vi.fn(() => {
        const release = vi.fn();
        releases.push(release);
        return release;
      }),
    };
    prologue.open();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    expect(window.__GQ_AUDIO_MANAGER.trackTtsAudio).toHaveBeenCalledWith(audio);
    el('continue').click();
    expect(releases[0]).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    prologue.close();
    expect(releases[1]).toHaveBeenCalledOnce();
  });
  it('clears the loading status and startup watchdog when speech resolves while paused', async () => {
    vi.useFakeTimers();
    let resolveNarration;
    fetch.mockImplementation(async (url, options = {}) => {
      if (new URL(url, 'http://localhost').pathname.endsWith('/auth.php')) {
        return { ok: true, json: async () => ({ token: 'registration-test-csrf' }) };
      }
      const { clip, voice } = JSON.parse(options.body);
      const selectedVoice = voice || 'de_DE-kerstin-low';
      return new Promise((resolve) => {
        resolveNarration = () => resolve({
          ok: true,
          json: async () => ({
            success: true,
            text: cometNarration.clips[clip][cometNarration.voices[selectedVoice]],
            voice: selectedVoice,
            audio_url: `generated/tts/${'b'.repeat(64)}.mp3`,
          }),
        });
      });
    });

    prologue.open({ opening: true, campaign: true });
    await vi.waitFor(() => expect(resolveNarration).toBeTypeOf('function'));
    el('opening-pause').click();
    resolveNarration();
    await vi.waitFor(() => expect(el('narration-status').textContent).toBe(''));
    await vi.advanceTimersByTimeAsync(10000);

    expect(el('narration-status').textContent).toBe('');
    expect(el('narration-retry').hidden).toBe(true);
  });
  it('shows the opening before starting the arrival and allows manual slide navigation', () => {
    const transition = vi.fn(() => new Promise(() => {}));
    prologue.open({ opening: true, transition });
    expect(el('title').textContent).toBe(content.opening[0].title);
    expect(preview).toHaveBeenLastCalledWith({ stage: 'opening', beat: content.opening[0].id });
    expect(transition).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    el('continue').click();
    expect(el('title').textContent).toBe('GalaxyQuest');
    el('back').click();
    expect(el('title').textContent).toBe(content.opening[0].title);
    for (const slide of content.opening) {
      expect(el('title').textContent).toBe(slide.title);
      el('continue').click();
    }
    expect(transition).toHaveBeenCalledOnce();
    expect(el('title').textContent).toBe('Deine Reise beginnt');
    expect(el('opening-pause').hidden).toBe(true);
    expect(el('progress').hidden).toBe(false);
  });

  it('tours real homelands before identity, departs by shuttle and requires confirmation before landing and handoff', async () => {
    vi.useFakeTimers();
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    let arrive;
    let land;
    camera.play.mockImplementation((shot) => {
      if (shot.kind === 'journey') return new Promise((resolve) => { arrive = resolve; });
      if (shot.kind === 'landing') return new Promise((resolve) => { land = resolve; });
      return true;
    });
    prologue.open({ opening: true, campaign: true });
    expect(camera.play).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'comet' }));
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(el('title').textContent).toBe(species[0].homeworld));
    expect(request).toHaveBeenCalledExactlyOnceWith('register_catalog');
    for (const destination of scriptedTour) {
      await vi.waitFor(() => expect(el('title').textContent).toBe(destination.homeworld));
      expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ draft: destination.homeworld_scene }));
      await finishTimedTransit(destination.code);
      expect(el('prologue').dataset.beat).toBe(`homeworld-${destination.code}-1`);
      el('continue').click();
      el('continue').click();
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.waitFor(() => expect(el('choices').querySelectorAll('button')).toHaveLength(6));
    expect(el('choices').querySelector('[data-choice="iron_fleet"]')).toBeNull();
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    el('continue').click();
    await vi.waitFor(() => expect(el('character').hidden).toBe(false));
    expect(camera.play.mock.calls.some(([shot]) => shot.kind === 'journey')).toBe(false);
    el('name').value = 'New Commander';
    el('background').value = 'Explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('continue').hidden).toBe(false));
    el('continue').click();
    expect(camera.play).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'journey', origin: species[1].homeworld_scene,
    }));
    expect(onEnterDraft).not.toHaveBeenCalled();
    arrive(true);
    await vi.waitFor(() => expect(el('continue').textContent).toBe('Bestätigen und landen'));
    expect(camera.play.mock.calls.some(([shot]) => shot.kind === 'landing')).toBe(false);
    el('continue').click();
    expect(camera.play).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'landing' }));
    expect(onEnterDraft).not.toHaveBeenCalled();
    land(true);
    await vi.waitFor(() => expect(onEnterDraft).toHaveBeenCalledOnce());
    expect(prologue.isActive()).toBe(false);
  });

  it('keeps the comet flight running through transit text until the homeworld is reached', async () => {
    vi.useFakeTimers();
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    let arrive;
    camera.play.mockImplementation((shot) => shot.kind === 'comet-world'
      ? new Promise((resolve) => { arrive = resolve; }) : true);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.waitFor(() => expect(camera.play).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'comet-world', duration_ms: 45000,
    })));
    expect(el('title').textContent).toBe(species[0].homeworld);
    const calls = camera.play.mock.calls.length;
    const cancellations = camera.cancel.mock.calls.length;
    el('continue').click();
    el('continue').click();
    el('continue').click();
    el('continue').click();
    expect(el('title').textContent).toContain(species[0].homeworld);
    expect(el('prologue').dataset.beat).toBe('homeworld-transit-aereth-4');
    expect(el('continue').hidden).toBe(true);
    expect(camera.play).toHaveBeenCalledTimes(calls);
    expect(camera.cancel).toHaveBeenCalledTimes(cancellations);
    el('opening-pause').click();
    expect(camera.pause).toHaveBeenLastCalledWith(true);
    el('opening-pause').click();
    expect(camera.pause).toHaveBeenLastCalledWith(false);
    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.beat).toBe('homeworld-transit-aereth-4');
    await vi.advanceTimersByTimeAsync(20000);
    expect(el('prologue').dataset.beat).toBe('homeworld-aereth-1');
    expect(camera.cancel).toHaveBeenCalledTimes(cancellations);
    el('continue').click();
    el('continue').click();
    expect(camera.play).toHaveBeenCalledTimes(calls + 1);
    expect(camera.play).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'comet-world', destination: species.find((entry) => entry.code === 'kryl_tha').homeworld_scene, duration_ms: 45000,
    }));
  });

  it('requires explicit continuation if a homeworld flight fails', async () => {
    camera.play.mockImplementation((shot) => shot.kind === 'comet-world' ? false : true);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe(species[0].homeworld));
    expect(el('flight-status').textContent).toContain('nicht verfügbar');
    expect(el('continue').hidden).toBe(false);
  });

  it('reports an incompatible homeworld catalog and reloads it on retry', async () => {
    const invalid = { ...catalog, species: [...species.slice(0, 5), { ...species[0] }] };
    request.mockImplementationOnce(async () => invalid);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.waitFor(() => expect(el('error').textContent).toContain('Drehbuch und die Heimatwelt-Reihenfolge'));
    expect(el('retry').hidden).toBe(false);
    expect(camera.play.mock.calls.some(([shot]) => shot.kind === 'comet-world')).toBe(false);
    el('retry').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe(species[0].homeworld));
    expect(request.mock.calls.filter(([action]) => action === 'register_catalog')).toHaveLength(2);
  });

  it('ignores a catalog response from a closed tour after reopening', async () => {
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    const stale = { ...catalog, species: species.map((entry) => entry.code === 'vor_tak'
      ? { ...entry, code: 'unlisted' } : entry) };
    let resolveStale;
    request.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    prologue.close();
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe(species[0].homeworld));
    resolveStale(stale);
    await Promise.resolve();
    el('opening-skip').click();
    await vi.waitFor(() => expect(el('choices').querySelectorAll('button')).toHaveLength(6));
    expect(el('choices').querySelector('[data-choice="vor_tak"]')).not.toBeNull();
  });

  it('reports an unavailable NPC destination instead of inventing a scene', async () => {
    vi.useFakeTimers();
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    const unavailable = { ...catalog, npc_homeworlds: [
      { ...npcHomeworlds[0], homeworld_scene: null }, ...npcHomeworlds.slice(1),
    ] };
    request.mockImplementation(async (action) => action === 'register_catalog' ? unavailable : { drafts: mentorDrafts });
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    for (const entry of scriptedTour.slice(0, species.length)) {
      await vi.waitFor(() => expect(el('title').textContent).toBe(entry.homeworld));
      await finishTimedTransit(entry.code);
      el('continue').click();
      el('continue').click();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(el('title').textContent).toBe('Erde');
    expect(el('flight-status').textContent).toContain('nicht verfügbar');
    expect(el('continue').hidden).toBe(false);
    el('continue').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe('Helion Prime'));
  });

  it('uses the selected English male profile for the opening narration and matching caption', async () => {
    window.GQTTS = {
      getVoice: () => 'en_US-ryan-high',
      isAutoVoiceEnabled: () => true,
    };
    prologue.open({ opening: true, campaign: true });
    expect(el('title').textContent).toBe(cometNarration.opening[0].title.en);
    expect(el('chapter').textContent).toBe(cometNarration.opening[0].label.en);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o1'].en);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      'api/registration_narration.php',
      expect.objectContaining({ body: JSON.stringify({ clip: 'comet-opening-o1', voice: 'en_US-ryan-high' }) }),
    ));
    await vi.waitFor(() => expect(audio.onended).toBeTypeOf('function'));
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url === 'api/registration_narration.php')[1].body).voice)
      .toBe('en_US-ryan-high');
  });

  it('keeps icon controls labelled and advances the slideshow progress with its cues', async () => {
    vi.useFakeTimers();
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);

    const progress = el('progress');
    const totalCues = cometNarration.opening.reduce((total, slide) => total + slide.cues.length, 0)
      + cometNarration.stops.reduce((total, stop) => total + stop.transit.length + stop.arrival.length, 0);
    expect(progress.hidden).toBe(false);
    expect(progress.max).toBe(totalCues + 5);
    expect(progress.value).toBe(1);
    expect(el('title').classList.contains('sr-only')).toBe(true);
    expect(el('story').compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const id of ['back', 'opening-pause', 'opening-skip', 'continue']) {
      expect(el(id).querySelector('svg')).not.toBeNull();
      expect(el(id).getAttribute('aria-label')).toBeTruthy();
    }

    el('continue').click();
    expect(progress.value).toBe(2);
    expect(el('continue').querySelector('svg')).not.toBeNull();
    el('opening-pause').click();
    expect(el('opening-pause').getAttribute('aria-label')).toBe('Fortsetzen');
    el('opening-pause').click();
    expect(el('opening-pause').getAttribute('aria-label')).toBe('Pause');

    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.value).toBe(cometNarration.opening.reduce((total, slide) => total + slide.cues.length, 0) + 1);
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(progress.value).toBe(totalCues + 1);
    expect(el('choices').querySelectorAll('button')).toHaveLength(6);
    expect(el('choices').compareDocumentPosition(el('story')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    el('choices').querySelector('[data-choice="aereth"]').click();
    expect(el('continue').getAttribute('aria-label')).toBe('Herkunft bestätigen und Namen wählen');
    expect(el('continue').querySelector('svg')).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps bilingual timed captions within the documented reading budget', () => {
    const cues = [
      ...cometNarration.opening.flatMap((slide) => slide.cues),
      ...cometNarration.stops.flatMap((stop) => [...stop.transit, ...stop.arrival]),
    ];
    for (const cue of cues) {
      for (const language of ['de', 'en']) {
        const text = cometNarration.clips[cue.id]?.[language];
        expect(text, `${cue.id} (${language})`).toBeTruthy();
        expect([...text].length / (cue.duration_ms / 1000), `${cue.id} (${language})`).toBeLessThanOrEqual(18);
      }
    }
    for (const [key, text] of Object.entries(cometNarration.moments)) {
      expect(cometNarration.clips[`comet-moment-${key}`], key).toEqual(text);
    }
  });

  it('lets a spoken cue finish after its display time and holds the transition while paused', async () => {
    vi.useFakeTimers();
    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    const first = cometNarration.clips['comet-opening-o1'].de;
    const second = cometNarration.clips['comet-opening-o2'].de;
    expect(el('story').textContent).toBe(first);
    expect(audio.onended).toBeTypeOf('function');

    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms);
    expect(el('story').textContent).toBe(first);
    el('opening-pause').click();
    audio.onended();
    expect(el('story').textContent).toBe(first);
    el('opening-pause').click();
    expect(el('story').textContent).toBe(second);
  });

  it('prepares one following cue during playback and reuses an unfinished preparation', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let release;
    let signal;
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php') && JSON.parse(options.body).clip === 'comet-opening-o2') {
        signal = options.signal;
        return new Promise((resolve) => { release = () => resolve(respond(url, options)); });
      }
      return respond(url, options);
    });
    const requestedClips = () => fetch.mock.calls
      .filter(([url]) => url.includes('registration_narration.php'))
      .map(([, options]) => JSON.parse(options.body).clip);

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(requestedClips()).toEqual(['comet-opening-o1', 'comet-opening-o2']);
    expect(release).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms);
    audio.onended();
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
    expect(signal.aborted).toBe(false);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(requestedClips()).toEqual(['comet-opening-o1', 'comet-opening-o2']);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(requestedClips()).toEqual(['comet-opening-o1', 'comet-opening-o2', 'comet-opening-o3']);
  });

  it('cancels a prepared cue when the voice changes and ignores its late response', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let release;
    let oldSignal;
    let voice = 'de_DE-kerstin-low';
    window.GQTTS = { getVoice: () => voice, isAutoVoiceEnabled: () => true };
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php')) {
        const body = JSON.parse(options.body);
        if (body.clip === 'comet-opening-o2' && body.voice === 'de_DE-kerstin-low') {
          oldSignal = options.signal;
          return new Promise((resolve) => { release = () => resolve(respond(url, options)); });
        }
      }
      return respond(url, options);
    });

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf('function');
    voice = 'en_US-ryan-high';
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(oldSignal.aborted).toBe(true);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].en);
    expect(audio.play).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].en);
  });

  it('cancels a consumed preparation when the listener skips it before it is ready', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let release;
    let signal;
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php') && JSON.parse(options.body).clip === 'comet-opening-o2') {
        signal = options.signal;
        return new Promise((resolve) => { release = () => resolve(respond(url, options)); });
      }
      return respond(url, options);
    });

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    el('continue').click();
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(true);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o3'].de);
    expect(audio.play).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o3'].de);
  });

  it('cancels preparation on mute and does not request the next muted cue', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let preparedSignal;
    let muted = false;
    window.__GQ_AUDIO_MANAGER = { snapshot: () => ({ masterMuted: muted }) };
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php') && JSON.parse(options.body).clip === 'comet-opening-o2') {
        preparedSignal = options.signal;
        return new Promise(() => {});
      }
      return respond(url, options);
    });

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(preparedSignal.aborted).toBe(false);
    muted = true;
    window.dispatchEvent(new CustomEvent('gq:audio-state'));
    expect(preparedSignal.aborted).toBe(true);
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.filter(([url]) => url.includes('registration_narration.php'))).toHaveLength(2);
    expect(el('narration-status').textContent).toContain('stummgeschaltet');
  });

  it('reports a failed prepared cue and allows retrying it', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let attempts = 0;
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php') && JSON.parse(options.body).clip === 'comet-opening-o2'
        && ++attempts === 1) return Promise.resolve({ ok: false, status: 503 });
      return respond(url, options);
    });

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms);
    audio.onended();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
    expect(el('narration-status').textContent).toContain('nicht verfügbar');
    expect(el('narration-retry').hidden).toBe(false);
    el('narration-retry').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(el('narration-status').textContent).toBe('');
  });

  it('waits for a slow narration request instead of skipping the spoken cue', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let release;
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php') && JSON.parse(options.body).clip === 'comet-opening-o1') {
        return new Promise((resolve) => { release = () => resolve(respond(url, options)); });
      }
      return respond(url, options);
    });

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms + 2000);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o1'].de);
    expect(el('narration-status').classList.contains('is-loading')).toBe(true);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('narration-status').classList.contains('is-loading')).toBe(false);
    expect(audio.onended).toBeTypeOf('function');
    audio.onended();
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
  });

  it('ignores a delayed narration response after a manual skip', async () => {
    vi.useFakeTimers();
    const respond = fetch.getMockImplementation();
    let release;
    fetch.mockImplementation((url, options = {}) => {
      if (url.includes('registration_narration.php') && JSON.parse(options.body).clip === 'comet-opening-o1') {
        return new Promise((resolve) => { release = () => resolve(respond(url, options)); });
      }
      return respond(url, options);
    });

    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('allows a manual cue skip while ignoring the previous speech completion', async () => {
    vi.useFakeTimers();
    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    const previousEnd = audio.onended;
    expect(previousEnd).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms);
    el('continue').click();
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
    previousEnd();
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
  });

  it('waits for shuttle and landing narration after the camera arrives', async () => {
    vi.useFakeTimers();
    let arrive;
    let land;
    camera.play.mockImplementation((shot) => {
      if (shot.kind === 'journey') return new Promise((resolve) => { arrive = resolve; });
      if (shot.kind === 'landing') return new Promise((resolve) => { land = resolve; });
      return true;
    });
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    el('name').value = 'New Commander';
    el('background').value = 'Explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);

    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.phase).toBe('journey');
    audio.onended();
    expect(el('prologue').dataset.phase).toBe('surface');
    expect(onEnterDraft).not.toHaveBeenCalled();

    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    land(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.phase).toBe('landing');
    expect(onEnterDraft).not.toHaveBeenCalled();
    audio.onended();
    await vi.advanceTimersByTimeAsync(0);
    expect(onEnterDraft).toHaveBeenCalledOnce();
  });

  it('keeps the shuttle narration and flight running while the ID portrait is queued, then lets the comet comment', async () => {
    vi.useFakeTimers();
    const url = `api/auth.php?action=register_portrait_image&revision=${'d'.repeat(32)}`;
    const baseRequest = request.getMockImplementation();
    let portrait = { status: 'not_generated', error: '', attempts_remaining: 3, retry_after: 0, image_url: null };
    request.mockImplementation((action, input) => {
      if (action === 'register_portrait_status') return Promise.resolve({ portrait });
      if (action === 'register_portrait') {
        portrait = { status: 'pending', error: '', attempts_remaining: 2, retry_after: 0, image_url: null };
        return Promise.resolve({ portrait });
      }
      if (action === 'register_portrait_progress') {
        portrait = { status: 'generated', error: '', attempts_remaining: 2, retry_after: 0, image_url: url };
        return Promise.resolve({ portrait });
      }
      return baseRequest(action, input);
    });
    camera.play.mockImplementation((shot) => shot.kind === 'journey' ? new Promise(() => {}) : true);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('portrait-placeholder').hidden).toBe(false);
    expect(el('story').textContent).toBe(cometNarration.moments['commander-name'].de);
    el('name').value = 'NewCommander';
    el('background').value = 'Explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(el('continue').hidden).toBe(false);
    el('continue').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.phase).toBe('journey');
    expect(el('identity-flight').hidden).toBe(false);
    expect(el('identity-flight-placeholder').hidden).toBe(false);
    expect(el('story').textContent).toBe(cometNarration.moments['shuttle-handoff'].de);

    await vi.advanceTimersByTimeAsync(3000);
    expect(el('portrait-image').getAttribute('src')).toBe(url);
    el('portrait-image').dispatchEvent(new Event('load'));
    el('identity-flight-image').dispatchEvent(new Event('load'));
    expect(el('story').textContent).toBe(cometNarration.moments['shuttle-handoff'].de);
    expect(el('identity-flight-placeholder').hidden).toBe(true);
    audio.onended();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('story').textContent).toBe(cometNarration.moments['identity-ready'].de);
    expect(el('prologue').dataset.phase).toBe('journey');
    expect(fetch).toHaveBeenCalledWith('api/registration_narration.php',
      expect.objectContaining({ body: JSON.stringify({ clip: 'comet-moment-identity-ready', voice: 'de_DE-kerstin-low' }) }));
  });

  it('finishes every transit cue after camera arrival without interrupting speech', async () => {
    vi.useFakeTimers();
    let arrive;
    camera.play.mockImplementation((shot) => shot.kind === 'comet-world'
      ? new Promise((resolve) => { arrive = resolve; }) : true);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.beat).toBe('homeworld-transit-aereth-1');
    expect(audio.onended).toBeTypeOf('function');
    await vi.advanceTimersByTimeAsync(cometNarration.stops[0].transit[0].duration_ms);
    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.beat).toBe('homeworld-transit-aereth-1');
    audio.onended();
    for (let i = 1; i < cometNarration.stops[0].transit.length; i++) {
      expect(el('prologue').dataset.beat).toBe(`homeworld-transit-aereth-${i + 1}`);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(cometNarration.stops[0].transit[i].duration_ms);
      expect(audio.onended).toBeTypeOf('function');
      audio.onended();
      if (i === 2) await vi.advanceTimersByTimeAsync(2500);
    }
    expect(el('prologue').dataset.beat).toBe('homeworld-aereth-1');
  });

  it('continues a waiting cue if speech playback fails', async () => {
    vi.useFakeTimers();
    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms);
    expect(audio.onerror).toBeTypeOf('function');
    audio.onerror();
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
  });

  it('continues a waiting cue if resuming paused speech fails', async () => {
    vi.useFakeTimers();
    prologue.open({ opening: true, campaign: true });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(cometNarration.opening[0].cues[0].duration_ms);
    el('opening-pause').click();
    audio.play.mockRejectedValueOnce(new Error('Playback blocked'));
    el('opening-pause').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('story').textContent).toBe(cometNarration.clips['comet-opening-o2'].de);
  });

  it('defers a late camera arrival while the completed transit is paused', async () => {
    vi.useFakeTimers();
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    let arrive;
    camera.play.mockImplementation((shot) => shot.kind === 'comet-world'
      ? new Promise((resolve) => { arrive = resolve; }) : true);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    await finishTimedTransit('aereth');
    expect(el('prologue').dataset.beat).toBe('homeworld-transit-aereth-6');
    el('opening-pause').click();
    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('prologue').dataset.beat).toBe('homeworld-transit-aereth-6');
    el('opening-pause').click();
    expect(el('prologue').dataset.beat).toBe('homeworld-aereth-1');
  });

  it('times transit text independently and waits for arrival before advancing worlds', async () => {
    vi.useFakeTimers();
    window.GQTTS = { isAutoVoiceEnabled: () => false };
    let arrive;
    camera.play.mockImplementation((shot) => shot.kind === 'comet-world'
      ? new Promise((resolve) => { arrive = resolve; }) : true);
    prologue.open({ opening: true, campaign: true });
    el('opening-skip').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(el('title').textContent).toBe(species[0].homeworld);
    await vi.advanceTimersByTimeAsync(10000);
    el('opening-pause').click();
    await vi.advanceTimersByTimeAsync(60000);
    expect(el('title').textContent).toBe(species[0].homeworld);
    el('opening-pause').click();
    await vi.advanceTimersByTimeAsync(12500);
    expect(el('title').textContent).toContain(species[0].homeworld);
    await vi.advanceTimersByTimeAsync(60000);
    expect(camera.play.mock.calls.filter(([shot]) => shot.kind === 'comet-world')).toHaveLength(1);
    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(el('title').textContent).toBe(species[0].homeworld);
    await vi.advanceTimersByTimeAsync(12000);
    expect(camera.play.mock.calls.filter(([shot]) => shot.kind === 'comet-world')).toHaveLength(2);
  });

  it('directs the camera with each slide and shares pause, reduced motion and cancellation', async () => {
    prologue.open({ opening: true });
    expect(preview).toHaveBeenLastCalledWith({ stage: 'opening', beat: content.opening[0].id });
    expect(camera.play).toHaveBeenLastCalledWith(content.opening[0].camera);
    el('opening-pause').click();
    expect(camera.pause).toHaveBeenLastCalledWith(true);
    el('opening-pause').click();
    expect(camera.pause).toHaveBeenLastCalledWith(false);
    el('continue').click();
    expect(camera.cancel).toHaveBeenCalled();
    expect(camera.play).toHaveBeenLastCalledWith(content.opening[1].camera);
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: true } }));
    expect(camera.finish).toHaveBeenCalledOnce();
    prologue.close();
    expect(el('prologue').dataset.cameraState).toBe('idle');
    const calls = camera.play.mock.calls.length;
    await Promise.resolve();
    expect(camera.play).toHaveBeenCalledTimes(calls);
  });

  it('ignores late camera failure after navigation and reports failure of the current shot', async () => {
    let fail;
    camera.play.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = reject; }));
    prologue.open({ opening: true });
    el('continue').click();
    fail(new Error('Old shot'));
    await vi.waitFor(() => expect(el('prologue').dataset.cameraState).toBe('ready'));
    expect(el('flight-status').textContent).not.toContain('Old shot');
    camera.play.mockReturnValueOnce(false);
    el('continue').click();
    await vi.waitFor(() => expect(el('prologue').dataset.cameraState).toBe('unavailable'));
    expect(el('flight-status').textContent).toContain('Kamera-Regie');
    expect(el('continue').disabled).toBe(false);
  });

  it('pauses the opening with its remaining time and stops timers on skip and close', async () => {
    vi.useFakeTimers();
    prologue.open({ opening: true });
    await vi.advanceTimersByTimeAsync(5000);
    el('opening-pause').click();
    expect(el('opening-pause').getAttribute('aria-pressed')).toBe('true');
    await vi.advanceTimersByTimeAsync(60000);
    expect(el('title').textContent).toBe(content.opening[0].title);
    el('opening-pause').click();
    await vi.advanceTimersByTimeAsync(content.opening[0].duration_ms - 5001);
    expect(el('title').textContent).toBe(content.opening[0].title);
    await vi.advanceTimersByTimeAsync(1);
    expect(el('title').textContent).toBe('GalaxyQuest');
    el('opening-skip').click();
    expect(el('title').textContent).toBe(content.teaser[0].title);
    prologue.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(prologue.isActive()).toBe(false);
    prologue.open({ opening: true });
    el('back').click();
    await vi.advanceTimersByTimeAsync(60000);
    expect(prologue.isActive()).toBe(false);
  });

  it('pauses a hidden opening and ignores its old timer after reopening', async () => {
    vi.useFakeTimers();
    prologue.open({ opening: true });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(el('opening-pause').textContent).toBe('Fortsetzen');
    expect(el('title').textContent).toBe(content.opening[0].title);
    prologue.close();
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    prologue.open({ opening: true });
    await vi.advanceTimersByTimeAsync(content.opening[0].duration_ms);
    expect(el('title').textContent).toBe('GalaxyQuest');
    expect(request).not.toHaveBeenCalled();
  });
  it('offers Back and Next during the teaser while synchronizing chapters with speech', async () => {
    prologue.open();
    expect(el('back').hidden).toBe(false);
    expect(el('continue').hidden).toBe(false);
    expect(el('continue').disabled).toBe(false);
    expect(el('title').textContent).toBe(content.teaser[0].title);
    await vi.waitFor(() => expect(animate).toHaveBeenCalledWith(
      el('story'), expect.objectContaining({ opacity: [0, 1] }), expect.objectContaining({ duration: 0.5 }),
    ));
    expect(el('progress').value).toBe(1);
    expect(preview).toHaveBeenLastCalledWith({ stage: 'galaxy', beat: content.teaser[0].id });
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
    expect(preview).toHaveBeenLastCalledWith({ stage: 'galaxy', beat: content.teaser.at(-1).id });
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
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('api/registration_narration.php',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'registration-test-csrf' }),
        body: JSON.stringify({ clip: 'mentor-vor_tak' }),
      })));
    await vi.waitFor(() => expect(audio.onended).toBeTypeOf('function'));
    el('continue').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe('Dein Sternsystem'));
    expect(request).toHaveBeenCalledWith('register_select_mentor', {
      prolog_token: mentorDrafts[1].prolog_token, mentor_code: 'vor_tak',
    });
    expect(el('continue').hidden).toBe(true);
    expect([...el('choices').querySelectorAll('[data-tutorial-planet]')]).toHaveLength(1);
    expect(camera.play).toHaveBeenLastCalledWith({
      kind: 'target', target: { kind: 'system', position: 2 }, duration_ms: 4500,
    });
    el('choices').querySelector('[data-tutorial-planet="2"]').click();
    expect(el('continue').hidden).toBe(false);
    expect(el('continue').textContent).toBe('Planet scannen');
    expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'planet', target: expect.objectContaining({ position: 2 }) }));
    el('continue').click();
    expect(el('title').textContent).toBe('Planetenscan');
    expect(el('story').textContent).toContain('Durchmesser: 12.000 km');
    expect(el('continue').textContent).toBe('Scan akzeptieren und Landeanflug starten');
    expect(request.mock.calls.some(([action]) => action === 'register_prepare')).toBe(false);
    el('continue').click();
    expect(camera.play).toHaveBeenLastCalledWith({
      kind: 'target', target: { kind: 'colony', position: 2 }, duration_ms: 4500,
    });
  });

  it('restores a previously selected mentor without narration leaving navigation busy', async () => {
    const original = request.getMockImplementation();
    request.mockImplementation((action, input) => action === 'register_mentor_drafts'
      ? Promise.resolve({ drafts: mentorDrafts.map((candidate) => ({ ...candidate, selected: candidate.mentor_code === 'vor_tak' })) })
      : original(action, input));
    await reachMentorRoom();
    expect(el('choices').querySelector('[data-choice="vor_tak"]').getAttribute('aria-pressed')).toBe('true');
    expect(el('continue').hidden).toBe(false);
    el('continue').click();
    await vi.waitFor(() => expect(el('title').textContent).toBe('Dein Sternsystem'));
    expect(el('choices').querySelector('[data-tutorial-planet="2"]')).not.toBeNull();
  });

  it('keeps a pending mentor selection valid when failed narration is retried', async () => {
    await reachMentorRoom();
    el('choices').querySelector('[data-choice="vor_tak"]').click();
    await vi.waitFor(() => expect(audio.onerror).toBeTypeOf('function'));
    audio.onerror();
    expect(el('narration-retry').hidden).toBe(false);
    let finish;
    request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    el('continue').click();
    el('narration-retry').click();
    finish({ draft: { ...mentorDrafts[1], selected: true } });
    await vi.waitFor(() => expect(el('title').textContent).toBe('Dein Sternsystem'));
    expect(el('choices').querySelector('[data-tutorial-planet="2"]')).not.toBeNull();
  });

  it('persists species and character privately, never requests activation or credentials', async () => {
    await reachCharacter();
    expect(fetch).toHaveBeenCalledWith('api/registration_narration.php', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'registration-test-csrf' }),
      body: JSON.stringify({ clip: 'character-dossier' }),
    }));
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

  it('prefills an editable lore-based commander suggestion when the character step opens', async () => {
    await reachCharacter();
    await vi.waitFor(() => expect(el('name').value).toBe('DrakThuun'));
    expect(el('background').value).toContain('Drak’Thuun');
    expect(request).toHaveBeenCalledWith('register_character_suggest', { prolog_token: draft.prolog_token });
    expect(el('character-suggest').disabled).toBe(false);
    expect(el('continue').hidden).toBe(true);
  });

  it('preserves a name entered while the lore suggestion is still generating', async () => {
    const original = request.getMockImplementation();
    let resolveSuggestion;
    request.mockImplementation((action, input) => action === 'register_character_suggest'
      ? new Promise((resolve) => { resolveSuggestion = resolve; })
      : original(action, input));
    await reachCharacter();
    await vi.waitFor(() => expect(resolveSuggestion).toBeTypeOf('function'));
    el('name').value = 'MyCommander';
    resolveSuggestion({ suggestion: {
      name: 'DrakThuun', background: 'A new commander shaped by the Vor’Tak spirit of discipline.',
    } });
    await vi.waitFor(() => expect(el('background').value).toContain('Vor’Tak'));
    expect(el('name').value).toBe('MyCommander');
  });

  it('keeps character fields manually editable when Ollama cannot generate a suggestion', async () => {
    const original = request.getMockImplementation();
    request.mockImplementation((action, input) => action === 'register_character_suggest'
      ? Promise.reject(new Error('Ollama is unavailable.'))
      : original(action, input));
    await reachCharacter();
    await vi.waitFor(() => expect(el('suggestion-status').textContent).toContain('manuell eingegeben'));
    expect(el('name').value).toBe('');
    expect(el('background').value).toBe('');
    expect(el('character-suggest').disabled).toBe(false);
    expect(el('name').disabled).toBe(false);
    expect(el('background').disabled).toBe(false);
  });

  it('shows progress and a review before entering the playable draft instead of returning to the menu', async () => {
    await reachCharacter();
    expect(el('progress').value).toBe(9);
    el('name').value = 'Commander';
    el('background').value = 'Grenzforscher';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('status').textContent).toContain('nicht aktiviert'));
    el('continue').click();

    expect(el('progress').value).toBe(10);
    expect(el('review').hidden).toBe(false);
    expect(el('review-origin').textContent).toBe('vor_tak');
    expect(el('review-system').textContent).toBe('vor_tak System');
    expect(el('review-world').textContent).toBe('vor_tak III');
    expect(el('review-commander').textContent).toBe('Commander');
    expect(el('review-background').textContent).toBe('Grenzforscher');
    expect(el('continue').textContent).toBe('Draft-Welt betreten');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      'api/registration_narration.php',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'registration-test-csrf' }),
        body: JSON.stringify({ clip: 'draft-review' }),
      }),
    ));
    el('continue').click();
    await vi.waitFor(() => expect(prologue.isActive()).toBe(false));
    expect(onEnterDraft).toHaveBeenCalledWith(draft.prolog_token);
    expect(preview).toHaveBeenLastCalledWith(null);
    expect(onClose).toHaveBeenCalledWith({ completed: true });
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
    expect(preview).toHaveBeenLastCalledWith({ stage: 'galaxy', beat: content.teaser.at(-1).id });
    expect(request.mock.calls.some(([action]) => /complete|^register$/.test(action))).toBe(false);
  });

  it('reports an unavailable flight independently of portrait and save status', async () => {
    preview.mockReturnValue(false);
    await reachCharacter();
    expect(el('flight-status').textContent).toContain('WebGPU-Flug ist nicht verfügbar');
    expect(el('character').hidden).toBe(false);
  });

  it('queues a saved character portrait without blocking the form and invalidates it on edits', async () => {
    const baseRequest = request.getMockImplementation();
    const url = `api/auth.php?action=register_portrait_image&revision=${'c'.repeat(32)}`;
    let portrait = { status: 'not_generated', error: '', attempts_remaining: 3, retry_after: 0, image_url: null };
    request.mockImplementation((action, input) => {
      if (action === 'register_portrait_status') return Promise.resolve({ portrait });
      if (action === 'register_portrait') {
        portrait = { status: 'pending', error: '', attempts_remaining: 2, retry_after: 0, image_url: null };
        return Promise.resolve({ portrait });
      }
      if (action === 'register_portrait_progress') {
        portrait = { status: 'generated', error: '', attempts_remaining: 2, retry_after: 0, image_url: url };
        return Promise.resolve({ portrait });
      }
      return baseRequest(action, input);
    });
    await reachCharacter();
    expect(el('portrait-generate').disabled).toBe(true);
    expect(el('portrait-placeholder').hidden).toBe(false);
    el('name').value = 'Commander';
    el('background').value = 'Explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('register_portrait', { prolog_token: draft.prolog_token }));
    expect(el('character-form').inert).not.toBe(true);
    expect(el('continue').hidden).toBe(false);
    await vi.waitFor(() => expect(el('portrait-status').textContent).toContain('Warteschlange'));
    el('portrait-refresh').click();
    await vi.waitFor(() => expect(el('portrait-image').getAttribute('src')).toBe(url));
    expect(el('portrait-image').hidden).toBe(true);
    el('portrait-image').dispatchEvent(new Event('load'));
    expect(el('portrait-image').hidden).toBe(false);
    expect(el('portrait-placeholder').hidden).toBe(true);
    el('background').value = 'Changed';
    el('background').dispatchEvent(new Event('input', { bubbles: true }));
    expect(el('portrait-image').hasAttribute('src')).toBe(false);
    expect(el('portrait-image').hidden).toBe(true);
    expect(el('portrait-placeholder').hidden).toBe(false);
    expect(el('portrait-generate').disabled).toBe(true);
  });

  it('reports a portrait backend failure without displaying a successful placeholder', async () => {
    const baseRequest = request.getMockImplementation();
    let failed = false;
    request.mockImplementation((action, input) => {
      if (action === 'register_portrait') {
        failed = true;
        return Promise.reject(new Error('ComfyUI unavailable'));
      }
      if (action === 'register_portrait_status' && failed) {
        return Promise.resolve({ portrait: { status: 'failed', error: 'ComfyUI unavailable', attempts_remaining: 2, retry_after: 30, image_url: null } });
      }
      return baseRequest(action, input);
    });
    await reachCharacter();
    el('name').value = 'Commander';
    el('background').value = 'Frontier explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(el('portrait-status').textContent).toContain('ComfyUI unavailable'));
    expect(el('portrait-image').hidden).toBe(true);
    expect(el('portrait-placeholder').hidden).toBe(false);
    expect(el('portrait-generate').disabled).toBe(true);
    expect(el('portrait-refresh').hidden).toBe(false);
  });

  it('allows Back during queue submission and ignores its late response', async () => {
    const baseRequest = request.getMockImplementation();
    let resolve;
    request.mockImplementation((action, input) => action === 'register_portrait'
      ? new Promise((done) => { resolve = done; }) : baseRequest(action, input));
    await reachCharacter();
    el('name').value = 'Commander';
    el('background').value = 'Frontier explorer';
    el('character-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(el('character-form').inert).not.toBe(true);
    el('back').click();
    resolve({ portrait: { status: 'generated', attempts_remaining: 2, retry_after: 0, image_url: `api/auth.php?action=register_portrait_image&revision=${'c'.repeat(32)}` } });
    await Promise.resolve();
    await Promise.resolve();
    expect(prologue.isActive()).toBe(true);
    expect(el('character').hidden).toBe(true);
    expect(el('portrait-image').hasAttribute('src')).toBe(false);
  });
});
