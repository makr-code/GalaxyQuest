const { test, expect } = require('@playwright/test');
const content = require('../../config/onboarding_prologue.json');
const narration = require('../../config/onboarding_narration.json');

const api = process.env.GQ_REGISTRATION_API_URL;
test.skip(!api, 'Requires an explicitly supplied disposable PHP/MySQL API (GQ_REGISTRATION_API_URL).');

test('the comet identity comment is synthesized for all four configured voices', async ({ playwright }) => {
  test.skip(process.env.GQ_REGISTRATION_TTS_TEST !== '1', 'Requires an explicitly supplied TTS test backend.');
  test.setTimeout(300_000);
  const context = await playwright.request.newContext({ baseURL: api });
  try {
    const csrf = await (await context.get('/api/auth.php?action=csrf')).json();
    for (const [voice, language] of Object.entries(narration.voices)) {
      const response = await context.post('/api/registration_narration.php', {
        data: { clip: 'comet-moment-identity-ready', voice }, headers: { 'X-CSRF-Token': csrf.token }, timeout: 240_000,
      });
      expect(response.ok(), await response.text()).toBe(true);
      const clip = await response.json();
      expect(clip.voice).toBe(voice);
      expect(clip.language).toBe(language);
      expect(clip.text).toBe(narration.moments['identity-ready'][language]);
      const audio = await context.get(`/${clip.audio_url}`);
      expect(audio.ok()).toBe(true);
      expect(audio.headers()['content-type']).toContain('audio/mpeg');
      expect((await audio.body()).length).toBeGreaterThan(0);
    }
  } finally {
    await context.dispose();
  }
});

test('a queued ComfyUI portrait completes in the playable private draft', async ({ playwright }) => {
  test.skip(process.env.GQ_REGISTRATION_COMFY_TEST !== '1', 'Requires an explicitly supplied ComfyUI test backend.');
  test.setTimeout(600_000);
  const context = await playwright.request.newContext({ baseURL: api });
  const other = await playwright.request.newContext({ baseURL: api });
  const endpoint = (action) => `/api/auth.php?action=${action}`;
  try {
    const csrf = await (await context.get(endpoint('csrf'))).json();
    const post = (action, data) => context.post(endpoint(action), { data, headers: { 'X-CSRF-Token': csrf.token } });
    const prepared = await post('register_prepare', { faction_id: 'kernrat' });
    expect(prepared.ok(), await prepared.text()).toBe(true);
    const token = (await prepared.json()).draft.prolog_token;
    const profile = await post('register_profile', { prolog_token: token, species_code: 'aereth' });
    expect(profile.ok(), await profile.text()).toBe(true);
    if (process.env.GQ_REGISTRATION_OLLAMA_TEST === '1') {
      const suggestion = await context.post(endpoint('register_character_suggest'), {
        data: { prolog_token: token }, headers: { 'X-CSRF-Token': csrf.token }, timeout: 310_000,
      });
      expect(suggestion.ok(), await suggestion.text()).toBe(true);
      const proposed = (await suggestion.json()).suggestion;
      expect(proposed.name).toMatch(/^[A-Za-z0-9_]{3,32}$/);
      expect(proposed.background.length).toBeGreaterThan(0);
      expect(proposed.background.length).toBeLessThanOrEqual(500);
    }
    const character = await post('register_character', {
      prolog_token: token, name: 'ComfyTestCommander', background: 'Synthetic private test character',
    });
    expect(character.ok(), await character.text()).toBe(true);
    const queued = await post('register_portrait', { prolog_token: token });
    expect(queued.ok(), await queued.text()).toBe(true);
    expect((await queued.json()).portrait.status).toBe('pending');
    const entered = await context.post('/api/registration_play.php?action=enter', {
      data: { prolog_token: token }, headers: { 'X-CSRF-Token': csrf.token },
    });
    expect(entered.ok(), await entered.text()).toBe(true);
    expect((await entered.json()).draft.draft_mode).toBe(true);

    let portrait;
    await expect.poll(async () => {
      const progress = await post('register_portrait_progress', { prolog_token: token });
      expect(progress.ok(), await progress.text()).toBe(true);
      portrait = (await progress.json()).portrait;
      if (portrait.status === 'failed') throw new Error(portrait.error);
      return portrait.status;
    }, { timeout: 240_000, intervals: [3000] }).toBe('generated');

    const image = await context.get(`/${portrait.image_url}`);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toContain('image/png');
    const bytes = await image.body();
    expect(bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.readUInt32BE(16)).toBe(768);
    expect(bytes.readUInt32BE(20)).toBe(1024);
    expect((await other.get(`/${portrait.image_url}`)).ok()).toBe(false);
  } finally {
    await context.dispose();
    await other.dispose();
  }
});

test('real API persists a private political and character draft but refuses unverified activation', async ({ playwright }) => {
  const browserOne = await playwright.request.newContext({ baseURL: api });
  const browserTwo = await playwright.request.newContext({ baseURL: api });
  const endpoint = (action) => `/api/auth.php?action=${action}${action === 'me' ? '&quiet=1' : ''}`;
  try {
    const csrf = await (await browserOne.get(endpoint('csrf'))).json();
    const csrfTwo = await (await browserTwo.get(endpoint('csrf'))).json();
    const post = (context, action, data, token = csrf.token) =>
      context.post(endpoint(action), { data, headers: { 'X-CSRF-Token': token } });
    const catalog = await (await browserOne.get(endpoint('register_catalog'))).json();
    expect(catalog.factions.map((entry) => entry.code)).toEqual(['schildzirkel', 'lichtbund', 'kernrat', 'schattenzirkel']);
    expect(catalog.species).toHaveLength(6);
    expect((await browserOne.post(endpoint('register_prepare'), { data: { faction_id: 'kernrat' } })).status()).toBe(403);
    const prepared = await post(browserOne, 'register_prepare', { faction_id: 'kernrat' });
    expect(prepared.ok(), await prepared.text()).toBe(true);
    const { draft } = await prepared.json();
    expect(draft.planets.length).toBeGreaterThan(0);
    expect(draft.star.temperature_k).toBeGreaterThan(0);
    expect(draft.star.radius_solar).toBeGreaterThan(0);
    expect(draft.planets.every((planet) => planet.diameter_km > 0 && planet.semi_major_axis_au > 0)).toBe(true);
    expect(draft.stars.length).toBeGreaterThan(0);
    expect((await (await browserTwo.get(endpoint('register_status'))).json()).draft).toBeNull();
    expect((await post(browserTwo, 'register_character_suggest', { prolog_token: draft.prolog_token }, csrfTwo.token)).status()).toBe(410);
    expect((await post(browserOne, 'register_character_suggest', { prolog_token: draft.prolog_token })).status()).toBe(409);
    const character = { prolog_token: draft.prolog_token, name: 'ApiCommander', background: 'Frontier engineer' };
    expect((await post(browserTwo, 'register_character', character, csrfTwo.token)).status()).toBe(410);
    const profile = await post(browserOne, 'register_profile', { prolog_token: draft.prolog_token, species_code: 'syl_nar' });
    expect((await profile.json()).draft.species_code).toBe('syl_nar');
    const saved = await post(browserOne, 'register_character', character);
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await saved.json()).draft.character.name).toBe('ApiCommander');
    const portraitState = await (await browserOne.get(endpoint('register_portrait_status'))).json();
    expect(portraitState.portrait.status).toBe('not_generated');
    expect((await browserOne.post(endpoint('register_portrait'), { data: { prolog_token: draft.prolog_token } })).status()).toBe(403);
    expect((await post(browserTwo, 'register_portrait', { prolog_token: draft.prolog_token }, csrfTwo.token)).status()).toBe(410);
    const unavailable = await post(browserOne, 'register_portrait', { prolog_token: draft.prolog_token });
    expect(unavailable.status()).toBe(503);
    const failed = await (await browserOne.get(endpoint('register_portrait_status'))).json();
    expect(failed.portrait.status).toBe('failed');
    expect(failed.portrait.image_url).toBeNull();
    expect((await post(browserOne, 'register_portrait', { prolog_token: draft.prolog_token })).status()).toBe(429);
    for (const action of ['register', 'register_complete']) {
      const blocked = await post(browserOne, action, { ...character, email: 'draft@example.invalid', password: 'valid-password' });
      expect(blocked.status()).toBe(503);
      expect((await blocked.json()).error).toContain('confirm your email');
    }
    expect((await (await browserOne.get(endpoint('me'))).json()).authenticated).toBe(false);
    expect((await (await browserOne.get(endpoint('register_status'))).json()).draft.character.name).toBe('ApiCommander');
    await post(browserOne, 'register_cancel', {});
  } finally {
    await browserOne.dispose();
    await browserTwo.dispose();
  }
});

test('guest narration synthesizes approved chapters on demand and serves cached audio', async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: api });
  try {
    expect((await context.get('/api/registration_narration.php?clip=anything&text=arbitrary')).status()).toBe(404);
    expect((await context.post('/api/registration_narration.php', { data: { text: 'arbitrary' } })).status()).toBe(403);
    const csrf = await (await context.get('/api/auth.php?action=csrf')).json();
    const headers = { 'X-CSRF-Token': csrf.token };
    expect((await context.post('/api/registration_narration.php', {
      data: { clip: 'anything', text: 'arbitrary' }, headers,
    })).status()).toBe(404);
    for (const step of content.registration_steps) {
      const instruction = await context.post('/api/registration_narration.php', {
        data: { clip: step.id }, headers, timeout: 240_000,
      });
      expect([200, 503]).toContain(instruction.status());
      const instructionBody = await instruction.json();
      if (instruction.status() === 503) {
        expect(instructionBody.error).toContain('unavailable');
      } else {
        expect(instructionBody.success).toBe(true);
        expect(instructionBody.text).toBe(step.text);
        expect(instructionBody.audio_url).toMatch(/^generated\/tts\/[a-f0-9]{64}\.mp3$/);
      }
    }
    const clip = await context.post('/api/registration_narration.php', {
      data: { clip: 'teaser-distance' }, headers, timeout: 240_000,
    });
    expect([200, 503]).toContain(clip.status());
    const body = await clip.json();
    if (clip.status() === 503) {
      expect(body.success).toBe(false);
      expect(body.error).toContain('unavailable');
    } else {
      expect(body.success).toBe(true);
      expect(body.audio_url).toMatch(/^generated\/tts\/[a-f0-9]{64}\.mp3$/);
      const audio = await context.get(`/${body.audio_url}`);
      expect(audio.status()).toBe(200);
      expect(audio.headers()['content-type']).toContain('audio/mpeg');
      const repeated = await context.get('/api/registration_narration.php?clip=teaser-distance');
      expect(repeated.ok()).toBe(true);
      const repeatedBody = await repeated.json();
      expect(repeatedBody.audio_url).toBe(body.audio_url);
      expect(repeatedBody.cached).toBe(true);
    }
  } finally {
    await context.dispose();
  }
});

test('mentor narration speaks only the current session draft and caches its system introduction', async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: api });
  let csrfToken = '';
  try {
    const csrf = await (await context.get('/api/auth.php?action=csrf')).json();
    csrfToken = csrf.token;
    const created = await context.post('/api/auth.php?action=register_mentor_drafts', {
      data: {}, headers: { 'X-CSRF-Token': csrfToken }, timeout: 240_000,
    });
    expect(created.ok(), await created.text()).toBe(true);
    const drafts = (await created.json()).drafts;
    expect(drafts).toHaveLength(6);
    const draft = drafts[0];

    const clip = await context.post('/api/registration_narration.php', {
      data: { clip: `mentor-${draft.mentor_code}` },
      headers: { 'X-CSRF-Token': csrfToken },
      timeout: 240_000,
    });
    expect(clip.ok(), await clip.text()).toBe(true);
    const body = await clip.json();
    expect(body.text).toContain(draft.system_name);
    expect(body.audio_url).toMatch(/^generated\/tts\/[a-f0-9]{64}\.mp3$/);
    const audio = await context.get(`/${body.audio_url}`);
    expect(audio.status()).toBe(200);
    expect(audio.headers()['content-type']).toContain('audio/mpeg');

    const repeated = await (await context.get(`/api/registration_narration.php?clip=mentor-${draft.mentor_code}`)).json();
    expect(repeated.audio_url).toBe(body.audio_url);
    expect(repeated.cached).toBe(true);

    const otherSession = await playwright.request.newContext({ baseURL: api });
    try {
      const forbidden = await otherSession.get(`/api/registration_narration.php?clip=mentor-${draft.mentor_code}`);
      expect(forbidden.status()).toBe(404);
    } finally {
      await otherSession.dispose();
    }
  } finally {
    if (csrfToken) {
      await context.post('/api/auth.php?action=register_cancel', {
        data: {}, headers: { 'X-CSRF-Token': csrfToken },
      }).catch(() => {});
    }
    await context.dispose();
  }
});

test('cinematic UI saves a commander through the actual isolated PHP/MySQL backend', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth.php') || url.pathname.endsWith('/registration_narration.php')) {
      const response = await route.fetch({
        url: `${api}${url.pathname}${url.search}`, headers: await route.request().allHeaders(),
      });
      await route.fulfill({ response });
    } else if (url.pathname.endsWith('/server_announcements.php')) {
      await route.fulfill({ json: { success: true, announcements: [] } });
    } else {
      await route.fulfill({ json: { success: true, stars: [], occupied_systems: [] } });
    }
  });
  await page.goto('/');
  await page.locator('#start-register').click();
  await expect.poll(() => page.locator('#registration-title').textContent(), { timeout: 30_000 })
    .toMatch(/^(Deine Reise beginnt|Jenseits vertrauter Sterne)$/);
  if ((await page.locator('#registration-title').textContent()) !== content.teaser[0].title) {
    await expect(page.locator('#registration-title')).toHaveText(content.teaser[0].title, { timeout: 30_000 });
  }
  await page.clock.install();
  for (const clip of content.teaser) {
    await expect(page.locator('#registration-title')).toHaveText(clip.title);
    await expect(page.locator('#registration-narration-status')).toContainText('nicht verfügbar');
    await page.clock.fastForward(30000);
  }
  await page.locator('#registration-continue').click();
  for (const faction of content.factions) {
    await expect(page.locator('#registration-title')).toHaveText(faction.name);
    await page.locator('#registration-continue').click();
  }
  await expect(page.locator('[data-choice="kernrat"]')).toBeEnabled();
  await page.locator('[data-choice="kernrat"]').click();
  await page.locator('#registration-continue').click();
  await page.locator('[data-choice="vor_tak"]').click();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-character')).toBeVisible();
  await page.locator('#registration-name').fill('BrowserCommander');
  await page.locator('#registration-background').fill('Explorer from the frontier');
  const portraitSubmission = page.waitForResponse('**/auth.php?action=register_portrait');
  await page.locator('#registration-character-form [type="submit"]').click();
  await expect(page.locator('#registration-status')).toContainText('nicht aktiviert');
  const saved = await page.evaluate(async () => (await fetch('api/auth.php?action=register_status')).json());
  expect(saved.draft.character).toEqual({ name: 'BrowserCommander', background: 'Explorer from the frontier' });
  expect(saved.draft.faction_code).toBe('kernrat');
  expect(saved.draft.species_code).toBe('vor_tak');
  const session = await page.evaluate(async () => (await fetch('api/auth.php?action=me&quiet=1')).json());
  expect(session.authenticated).toBe(false);
  await portraitSubmission;
  await expect(page.locator('#registration-portrait-status')).toContainText('Kein KI-Portrait erzeugt');
  await expect(page.locator('#registration-portrait-image')).toBeHidden();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-surface')).toBeVisible();
  await expect(page.locator('#registration-continue')).toBeDisabled();
  const landed = await page.evaluate(async () => (await fetch('api/auth.php?action=me&quiet=1')).json());
  expect(landed.authenticated).toBe(false);
  const resumedPortraitStatus = page.waitForResponse('**/auth.php?action=register_portrait_status');
  await page.locator('#registration-back').click();
  await resumedPortraitStatus;
  await page.locator('#registration-back').click();
  await page.unrouteAll({ behavior: 'wait' });
});

test('private portrait pipeline queues and serves a validated PNG from an isolated ComfyUI fixture', async ({ playwright }) => {
  const fixtureApi = process.env.GQ_REGISTRATION_COMFYUI_FIXTURE_URL;
  test.skip(!fixtureApi, 'Requires a separate disposable API configured against a synthetic ComfyUI fixture.');
  const owner = await playwright.request.newContext({ baseURL: fixtureApi });
  const other = await playwright.request.newContext({ baseURL: fixtureApi });
  const endpoint = (action) => `/api/auth.php?action=${action}`;
  try {
    const csrf = await (await owner.get(endpoint('csrf'))).json();
    const post = (action, data) => owner.post(endpoint(action), { data, headers: { 'X-CSRF-Token': csrf.token } });
    const prepared = await post('register_prepare', { faction_id: 'lichtbund' });
    const { draft } = await prepared.json();
    await post('register_profile', { prolog_token: draft.prolog_token, species_code: 'vor_tak' });
    const character = { prolog_token: draft.prolog_token, name: 'FixtureCommander', background: 'Local test only' };
    await post('register_character', character);
    const queued = await post('register_portrait', { prolog_token: draft.prolog_token });
    expect(queued.status(), await queued.text()).toBe(200);
    expect((await queued.json()).portrait.status).toBe('pending');
    const generated = await post('register_portrait_progress', { prolog_token: draft.prolog_token });
    expect(generated.status(), await generated.text()).toBe(200);
    const { portrait } = await generated.json();
    expect(portrait.status).toBe('generated');
    const image = await owner.get(`/${portrait.image_url}`);
    expect(image.status()).toBe(200);
    expect(image.headers()['content-type']).toContain('image/png');
    expect(image.headers()['cache-control']).toContain('no-store');
    expect((await image.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect((await other.get(`/${portrait.image_url}`)).status()).toBe(410);
    const reused = await (await post('register_portrait', { prolog_token: draft.prolog_token })).json();
    expect(reused.portrait.image_url).toBe(portrait.image_url);
    await post('register_character', { ...character, name: 'ChangedCommander' });
    expect((await owner.get(`/${portrait.image_url}`)).status()).toBe(404);
    expect((await (await owner.get(endpoint('register_portrait_status'))).json()).portrait.status).toBe('not_generated');
    expect((await (await owner.get(`${endpoint('me')}&quiet=1`)).json()).authenticated).toBe(false);
    await post('register_cancel', {});
  } finally {
    await owner.dispose();
    await other.dispose();
  }
});
