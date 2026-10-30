const { test, expect } = require('@playwright/test');
const prologueContent = require('../../config/onboarding_prologue.json');

const registrationTarget = { galaxy_index: 1, system_index: 2, position: 3, x_ly: 400, y_ly: 200, z_ly: 0 };
const registrationDraft = {
  prolog_token: 'a'.repeat(64), faction_code: 'kernrat', colony_name: 'Frontier Colony', system_name: 'Frontier',
  position: { galaxy: 1, system: 2, position: 3 }, target: registrationTarget, stars: [registrationTarget],
  planets: [{ name: 'Frontier III', position: 3, class: 'rocky', can_colonize: true }],
  starter: { ships: { small_cargo: 2, light_fighter: 4 } }, expires_at: '2099-01-01T12:00:00Z',
};
const mentorDrafts = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen'].map((code, index) => {
  const target = { ...registrationTarget, system_index: index + 10, position: index + 1, x_ly: registrationTarget.x_ly + index * 10 };
  return {
    ...registrationDraft, prolog_token: String(index + 1).repeat(64), mentor_code: code, species_code: code,
    selected: false, system_name: `${code} System`, target, stars: [target],
    position: { galaxy: 1, system: index + 10, position: index + 1 },
    planets: [{ name: `${code} III`, position: index + 1, class: 'rocky', can_colonize: true }],
  };
});

async function mockApi(page, { authenticated = false, expireOnResume = false, twoFactor = false } = {}) {
  let sessionChecks = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    let data = { success: true };
    if (url.pathname.endsWith('/registration_narration.php')) {
      await route.fulfill({ status: 503, json: { success: false, error: 'Narration not prepared in UI test.' } });
      return;
    } else if (url.pathname.endsWith('/server_announcements.php')) {
      data = { success: true, announcements: [] };
    } else if (action === 'me') {
      sessionChecks++;
      const valid = authenticated && !(expireOnResume && sessionChecks > 1);
      data = { success: true, authenticated: valid, user: valid ? { username: 'TestCommander' } : null };
    } else if (action === 'auth_stars') {
      data = { success: true, stars: [], occupied_systems: [], arm_count: 6, pitch_angle_deg: 14 };
    } else if (action === 'csrf') {
      data = { success: true, csrf_token: 'start-screen-test-token', token: 'start-screen-test-token' };
    } else if (action === 'dev_tools_status') {
      data = { success: true, enabled: false };
    } else if (action === 'login') {
      data = twoFactor
        ? { success: true, requires_2fa: true, totp_session: 'test-challenge' }
        : { success: false, error: 'Test login rejected' };
    } else if (action === 'totp_login_challenge') {
      data = { success: false, error: 'Test code rejected' };
    } else if (action === 'register_catalog') {
      data = { success: true,
        factions: prologueContent.factions.map((entry) => ({ ...entry, homeworld: "Sol'Ryaan", target: registrationTarget, stars: [registrationTarget] })),
        species: mentorDrafts.map((draft) => ({ code: draft.mentor_code, name: draft.mentor_code, description: 'Independent origin', homeworld: `${draft.mentor_code} home` })),
      };
    } else if (action === 'register_status') {
      data = { success: true, draft: null };
    } else if (action === 'register_mentor_drafts') {
      data = { success: true, drafts: mentorDrafts };
    } else if (action === 'register_select_mentor') {
      const body = route.request().postDataJSON();
      data = { success: true, draft: { ...mentorDrafts.find((draft) => draft.mentor_code === body.mentor_code), selected: true } };
    } else if (action === 'register_prepare') {
      data = { success: true, draft: registrationDraft };
    } else if (action === 'register_profile') {
      data = { success: true, draft: { ...registrationDraft, ...route.request().postDataJSON() } };
    } else if (action === 'register_character') {
      data = { success: true, draft: { ...registrationDraft, character: route.request().postDataJSON() } };
    } else if (action === 'register_portrait_status') {
      data = { success: true, portrait: { status: 'not_generated', image_url: null, error: '', attempts_remaining: 3, retry_after: 0 } };
    } else if (action === 'register_complete') {
      data = { success: false, error: 'Test registration rejected' };
    }
    await route.fulfill({ json: data });
  });
}

async function reachMentorRoom(page) {
  await page.clock.install();
  await page.locator('#start-register').click();
  for (const clip of prologueContent.teaser) {
    await expect(page.locator('#registration-title')).toHaveText(clip.title);
    await expect(page.locator('#registration-narration-status')).toContainText('nicht verfügbar');
    await page.clock.fastForward(30000);
  }
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('Die Heroldkammer');
  await expect(page.locator('#registration-choices button')).toHaveCount(6);
  await expect(page.locator('#registration-choices button').first()).toBeEnabled();
}

test('narration chapters offer manual Back and Next without waiting for speech', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.locator('#start-register').click();
  await expect(page.locator('#registration-continue')).toBeVisible();
  await expect(page.locator('#registration-continue')).toBeEnabled();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText(prologueContent.teaser[1].title);
  await page.locator('#registration-back').click();
  await expect(page.locator('#registration-title')).toHaveText(prologueContent.teaser[0].title);
  for (let index = 0; index < prologueContent.teaser.length; index++) await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('Die Heroldkammer');
  await expect(page.locator('#registration-choices button').first()).toBeEnabled();
  await expect(page.locator('#registration-choices button')).toHaveCount(6);
  await expect(page.locator('#registration-continue')).toBeHidden();
});

test('front-page status row mirrors the latest log entry and expands the same log', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('#auth-status-line')).toContainText(/\[(INFO|WARN|ERROR)\]/);
  await page.evaluate(() => window.__GQ_BOOT_PROBE.log('front-page-log-sync-check'));
  await expect(page.locator('#auth-status-line')).toContainText('front-page-log-sync-check');
  await page.evaluate(() => window.__GQ_SET_BOOT_CONSOLE_EXPANDED(false));
  await expect(page.locator('#ui-console-log')).toBeHidden();
  await page.locator('#ui-console-expand').click();
  await expect(page.locator('#ui-console-log')).toBeVisible();
  await expect(page.locator('#ui-console-log')).toContainText('front-page-log-sync-check');
  await expect(page.locator('#ui-console-expand')).toHaveAttribute('aria-expanded', 'true');
});

test('guest menu opens lazy login and cinematic private registration without credentials', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('#start-login')).toBeVisible();
  await expect(page.locator('#start-session-status')).toContainText('next chapter');
  await expect(page.locator('#login-form')).toHaveCount(0);
  await expect(page.locator('[data-wm-window="auth"]')).toHaveCount(0);
  await page.locator('#start-login').click();
  await expect(page.locator('#start-auth-dialog')).toBeVisible();
  await expect(page.locator('#login-username')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-auth-dialog')).toHaveCount(0);
  await expect(page.locator('#start-login')).toBeFocused();

  await reachMentorRoom(page);
  await expect(page.locator('#start-menu')).toBeHidden();
  await expect(page.locator('#start-music-player')).toBeHidden();
  await expect(page.locator('#auth-status-section')).toBeHidden();
  await expect(page.locator('#boot-terminal')).toBeHidden();
  await expect(page.locator('#start-auth-dialog')).toHaveCount(0);
  await expect.poll(() => page.locator('#registration-choices svg').evaluateAll(
    (symbols) => symbols.filter((symbol) => symbol.getBBox().width > 0).length,
  )).toBe(6);
  await page.locator('[data-choice="syl_nar"]').click();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('Dein Sternsystem');
  await expect(page.locator('#registration-continue')).toBeHidden();
  await page.locator('[data-tutorial-planet="3"]').click();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('Planetenscan');
  await expect(page.locator('#registration-story')).toContainText('Status: kolonialisierbar');
  await expect(page.locator('#registration-continue')).toContainText('Landeanflug starten');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('Landeanflug');
  await expect(page.locator('#registration-continue')).toHaveText('Landeanflug bestätigen');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-draft-summary')).toContainText('Frontier Colony');
  await page.locator('#registration-name').fill('Commander');
  await page.locator('#registration-background').fill('Frontier engineer');
  await page.locator('#registration-character-form [type="submit"]').click();
  await expect(page.locator('#registration-status')).toContainText('nicht aktiviert');
  await expect(page.locator('#registration-prologue input[type="email"],#registration-prologue input[type="password"]')).toHaveCount(0);
});

test('registration previews mentor systems and restores a private character draft on mobile', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  const saved = { ...mentorDrafts[1], selected: true, character: { name: 'SavedCommander', background: 'Explorer' } };
  await page.route('**/auth.php?action=register_mentor_drafts', (route) => route.fulfill({ json: { success: true, drafts: [
    ...mentorDrafts.filter((item) => item.mentor_code !== 'vor_tak'), saved,
  ] } }));
  await page.route('**/auth.php?action=register_select_mentor', (route) => route.fulfill({ json: { success: true, draft: saved } }));
  await page.route('**/auth.php?action=register_status', (route) => route.fulfill({ json: { success: true, draft: saved } }));
  await page.route('**/auth.php?action=register_profile', (route) => route.fulfill({ json: { success: true, draft: saved } }));
  await page.goto('/');
  await reachMentorRoom(page);
  await expect(page.locator('#registration-status')).toContainText('private System-Drafts');
  await page.locator('[data-choice="vor_tak"]').click();
  await expect(page.locator('#registration-story')).toContainText('vor_tak System');
  await expect.poll(() => page.evaluate(() => document.getElementById('start-galaxy-source').textContent)).toContain('WEBGPU FLIGHT');
  const sceneState = await page.evaluate(() => {
    const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
    return { scene: renderer.scene, destinations: renderer.destinations };
  });
  expect(sceneState.scene.sceneGraph.type).toBe('galaxy');
  expect(sceneState.scene.sceneGraph.children[0].type).toBe('system');
  expect(sceneState.scene.sceneGraph.children[0].children[0].type).toBe('planet');
  expect(sceneState.destinations).toContainEqual({ kind: 'planet', position: 2 });
  await page.locator('#registration-continue').click();
  await page.locator('[data-tutorial-planet="2"]').click();
  await page.locator('#registration-continue').click();
  await page.locator('#registration-continue').click();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-name')).toHaveValue('SavedCommander');
  await expect(page.locator('#registration-background')).toHaveValue('Explorer');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('registration surfaces setup failures and Back cancels the visible flow without late UI changes', async ({ page }) => {
  await mockApi(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route('**/auth.php?action=register_mentor_drafts', async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { success: false, error: 'Registration setup is incomplete.' } });
  });
  await page.goto('/');
  await page.clock.install();
  await page.locator('#start-register').click();
  for (const clip of prologueContent.teaser) await page.clock.fastForward(30000);
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-status')).toContainText('Systeme werden vorbereitet');
  release();
  await expect(page.locator('#registration-error')).toContainText('Registration setup is incomplete');
  await expect(page.locator('#registration-retry')).toBeVisible();
  await expect(page.locator('#registration-character')).toBeHidden();
  for (let index = 0; index <= prologueContent.teaser.length; index++) await page.keyboard.press('Escape');
  await expect(page.locator('#registration-prologue')).toBeHidden();
  await expect(page.locator('#start-menu')).toBeVisible();
  await expect(page.locator('#start-register')).toBeFocused();
  await expect(page.locator('#registration-prologue')).toBeHidden();
});

test('compact music overlay stays top right on desktop and mobile and uses shared audio', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    const state = { musicUrl: '', musicPlaying: false, musicPaused: true, masterMuted: false };
    window.__testMusicActions = [];
    window.__GQ_AUDIO_MANAGER = {
      snapshot: () => ({ ...state }),
      setScene() {},
      setSceneTrack() {},
      setMusicTrack(url) { state.musicUrl = url; },
      setMusicPlaylist() {},
      async playMusic() { state.musicPlaying = true; window.__testMusicActions.push('play'); return true; },
      pauseMusic() { state.musicPlaying = false; window.__testMusicActions.push('pause'); },
      setMasterMuted(value) { state.masterMuted = value; },
      async playNextInPlaylist(direction) { window.__testMusicActions.push(direction); return true; },
    };
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const player = page.locator('#start-music-player');
  const play = page.locator('#start-music-play');
  await expect(player).toBeVisible();
  await expect(play).toBeEnabled();
  await expect(page.locator('#start-music-title')).toHaveText('Nebula Overture');
  const desktop = await player.boundingBox();
  expect(desktop.y).toBeLessThan(30);
  expect(desktop.x + desktop.width).toBeGreaterThan(1240);
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Musik pausieren');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Musik starten');
  await page.locator('#start-music-mute').click();
  await expect(page.locator('#start-music-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#start-music-next').click();
  await expect.poll(() => page.evaluate(() => window.__testMusicActions.includes(1))).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await player.boundingBox();
  expect(mobile.x).toBeGreaterThanOrEqual(0);
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
  const heading = await page.locator('.start-title').boundingBox();
  expect(heading.y).toBeGreaterThan(mobile.y + mobile.height);
});

test('local audio catalog exposes every real music file and title switching uses the full playlist', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/audio.php?action=list', async (route) => {
    await route.fulfill({ response: await route.fetch() });
  });
  await page.addInitScript(() => {
    localStorage.setItem('gq_audio_settings', JSON.stringify({ masterMuted: true }));
  });
  const catalog = await page.request.get('/api/audio.php?action=list');
  expect(catalog.ok()).toBe(true);
  expect(catalog.headers()['content-type']).toContain('application/json');
  const data = await catalog.json();
  expect(data.success).toBe(true);
  const fs = require('node:fs');
  const path = require('node:path');
  const files = fs.readdirSync(path.resolve('music')).filter((name) => /\.(mp3|ogg|wav|m4a|flac|aac|webm)$/i.test(name));
  expect(data.tracks.map((entry) => entry.file).sort()).toEqual(files.sort());
  expect(data.tracks.length).toBeGreaterThan(1);
  for (const track of data.tracks) {
    expect((await page.request.head(`/${track.value}`)).ok()).toBe(true);
  }
  const errors = [];
  page.on('console', (message) => { if (message.text().includes('audio list fetch failed')) errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('#start-music-play')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__GQ_AUDIO_MANAGER?._playlist.length)).toBe(files.length);
  const initial = await page.locator('#start-music-title').textContent();
  await page.locator('#start-music-next').click();
  await expect(page.locator('#start-music-title')).not.toHaveText(initial);
  await expect(page.locator('#start-music-title')).not.toContainText('%20');
  await expect(page.locator('#start-music-status')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('failed playlist responses explicitly identify the single fallback track', async ({ page }) => {
  await mockApi(page);
  await page.route('**/api/audio.php?action=list', (route) => route.fulfill({
    status: 503, json: { success: false, error: 'Catalog unavailable' },
  }));
  await page.goto('/');
  await expect(page.locator('#start-music-play')).toBeEnabled();
  await expect(page.locator('#start-music-status')).toContainText('nur Ersatztitel');
  await expect(page.locator('#start-music-title')).toHaveText('Nebula Overture');
});

test('a confirmed session offers Resume but does not auto-enter the game', async ({ page }) => {
  await mockApi(page, { authenticated: true, expireOnResume: true });
  await page.goto('/');
  await expect(page.locator('#start-resume')).toBeVisible();
  await expect(page.locator('#start-login')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(page.locator('#start-session-status')).toContainText('TestCommander');
  await page.locator('#start-resume').click();
  await expect(page.locator('#start-login')).toBeVisible();
  await expect(page.locator('#start-session-status')).toContainText('session expired');
  await expect(page.locator('body')).toHaveClass(/auth-page/);
});

test('Resume hands control to the existing shell bootstrap only after an explicit click', async ({ page }) => {
  await mockApi(page, { authenticated: true });
  await page.addInitScript(() => {
    window.__testAuthenticatedEvents = 0;
    window.addEventListener('gq:authenticated', () => { window.__testAuthenticatedEvents++; });
  });
  await page.goto('/');
  await expect(page.locator('#start-resume')).toBeVisible();
  expect(await page.evaluate(() => window.__testAuthenticatedEvents)).toBe(0);
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  expect(await page.evaluate(() => window.__testAuthenticatedEvents)).toBe(1);
  await expect(page.locator('#auth-section')).toBeHidden();
  await expect(page.locator('#start-auth-dialog')).toHaveCount(0);
});

test('settings, content links and the log bar work on narrow screens', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('[data-start-panel="settings"]').click();
  await page.locator('#start-reduced-motion').check();
  await expect(page.locator('body')).toHaveClass(/start-reduced-motion/);
  await expect(page.locator('#start-settings-status')).toContainText('saved');
  await page.keyboard.press('Escape');
  await page.locator('[data-start-panel="news"]').click();
  await expect(page.getByRole('link', { name: 'Read the changelog' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#auth-console-toggle').click();
  await expect(page.locator('#boot-terminal')).toBeVisible();
  await page.locator('#ui-console-close').click();
  await expect(page.locator('#boot-terminal')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('2FA cancellation resets the challenge before the lazy dialog is reopened', async ({ page }) => {
  await mockApi(page, { twoFactor: true });
  await page.goto('/');
  await page.locator('#start-login').click();
  await page.locator('#login-username').fill('Commander');
  await page.locator('#login-password').fill('test-password-123');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#auth-2fa-code')).toBeVisible();
  await page.locator('#auth-2fa-code').fill('123456');
  await page.locator('#auth-2fa-submit').click();
  await expect(page.locator('#auth-2fa-error')).toContainText('Test code rejected');
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-auth-dialog')).toHaveCount(0);
  await page.locator('#start-login').click();
  await expect(page.locator('#login-form')).toBeVisible();
  await expect(page.locator('#auth-2fa-panel')).toBeHidden();
  await expect(page.locator('#login-password')).toHaveValue('');
});

test('login progress is visible in the modal and Escape cannot detach an in-flight form', async ({ page }) => {
  await mockApi(page);
  let releaseLogin;
  const pending = new Promise((resolve) => { releaseLogin = resolve; });
  await page.route('**/auth.php?action=login', async (route) => {
    await pending;
    await route.fulfill({ json: { success: false, error: 'Test login rejected' } });
  });
  await page.goto('/');
  await page.locator('#start-login').click();
  await page.locator('#login-username').fill('Commander');
  await page.locator('#login-password').fill('test-password-123');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('.start-auth-activity')).toContainText('Signing in...');
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-auth-dialog')).toBeVisible();
  releaseLogin();
  await expect(page.locator('#login-error')).toContainText('Test login rejected');
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-auth-dialog')).toHaveCount(0);
});

test('unsupported WebGPU reports an unavailable background without loading the legacy renderer', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => { window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: false }; });
  const legacyRequests = [];
  page.on('request', (request) => {
    if (/three\.min\.js|galaxy-renderer\.js/.test(request.url())) legacyRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#auth-status-line')).toContainText('WebGPU is unavailable');
  await expect(page.locator('#start-login')).toBeVisible();
  expect(legacyRequests).toEqual([]);
});

async function mockBackgroundRenderer(page) {
  await page.addInitScript(() => {
    window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: true };
    window.__flightRestoreCalls = [];
    window.Galaxy3DView = class {
      backendType = 'webgpu';
      constructor() {
        this.flightCoordinates = null;
        this._native = {
          setFlightScene: (scene) => { this.scene = scene; return true; },
          setSpatialLabelStars: (stars) => { this._native.spatialLabelStars = stars.slice(); return stars.length; },
          getFlightTelemetry: () => ({ spatial: true, phase: 'idle' }),
          getFlightCoordinates: () => this.flightCoordinates,
          restoreFlightCoordinates: (coordinates) => {
            window.__flightRestoreCalls.push(coordinates);
            this.flightCoordinates = coordinates;
            return true;
          },
          navigateTo: async (target) => {
            (this.destinations ||= []).push(target);
            this.flightCoordinates = {
              start: this.flightCoordinates?.destination || [1, 2, 3],
              destination: target.kind === 'point' ? [target.x_ly, target.y_ly, target.z_ly] : [4, 5, 6],
            };
            return true;
          },
        };
      }
      async init() {}
      setStars(stars) { this.stars = stars; }
      setRegionPreview(target) { this.region = target; return true; }
      setRegistrationScene(scene) { this.scene = scene; return true; }
      destroy() {}
    };
  });
}

test('registration flies galaxy to surface and back without replacing its canvas or activating the world', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  const activation = [];
  page.on('request', (request) => {
    if (['register_complete', 'register'].includes(new URL(request.url()).searchParams.get('action'))) activation.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#galaxy-bg-wrapper canvas')).toHaveCount(1);
  await page.evaluate(() => { window.__flightCanvas = document.querySelector('#galaxy-bg-wrapper canvas'); });
  await reachMentorRoom(page);
  const hasWebGpuAdapter = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (hasWebGpuAdapter) {
    const heraldCanvas = page.locator('.registration-herald-canvas');
    await expect(heraldCanvas).toHaveCount(1, { timeout: 20000 });
    await page.locator('[data-choice="vor_tak"]').focus();
    await expect.poll(() => heraldCanvas.getAttribute('data-focused-herald'), { timeout: 20000 }).toBe('vor_tak');
    await page.screenshot({ path: 'test-results/registration-herald-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/registration-herald-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  const sceneStage = () => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer.scene?.stage || 'galaxy');
  await page.locator('[data-choice="vor_tak"]').click();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-continue').click();
  await expect.poll(sceneStage).toBe('system');
  await expect(page.locator('#registration-continue')).toBeHidden();
  await page.locator('[data-tutorial-planet="2"]').click();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-continue').click();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-continue').click();
  await expect.poll(sceneStage).toBe('surface');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-character')).toBeVisible();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-name').fill('LandingCommander');
  await page.locator('#registration-background').fill('An explorer seeking a new beginning.');
  await page.locator('#registration-character-form [type="submit"]').click();
  await expect(page.locator('#registration-status')).toContainText('nicht aktiviert');
  await expect(page.locator('#registration-title')).toHaveText('Wer übernimmt das Kommando?');
  expect(await page.evaluate(() => window.__flightCanvas === document.querySelector('#galaxy-bg-wrapper canvas'))).toBe(true);
  await page.locator('#registration-back').click();
  await expect.poll(sceneStage).toBe('surface');
  await page.locator('#registration-back').click();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-back').click();
  await expect.poll(sceneStage).toBe('system');
  await page.locator('#registration-back').click();
  await expect.poll(sceneStage).toBe('galaxy');
  expect(activation).toEqual([]);
});

test('the galaxy backdrop is black and procedural loading points are explicitly labeled', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  await page.goto('/');
  await expect(page.locator('#start-galaxy-source')).toContainText('not DB data');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('#galaxy-bg-wrapper')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('#galaxy-bg-wrapper')).toHaveCSS('background-image', 'none');
});

test('database systems stay authoritative while an illustrative visual field remains separate', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  const stars = [
    { system_index: 1, galaxy_index: 1, x_ly: 400, y_ly: 200 },
    { system_index: 2, galaxy_index: 1, x_ly: -600, y_ly: 100 },
  ];
  await page.route('**/galaxy.php?action=auth_stars**', (route) =>
    route.fulfill({ json: { success: true, stars, occupied_systems: [], arm_count: 5, pitch_angle_deg: 14 } }));
  await page.goto('/');
  await expect(page.locator('#start-galaxy-source')).toContainText('Database galaxy sample: 2');
  const state = await page.evaluate(() => {
    const runtime = window.__GQ_AUTH_GALAXY_BG_RUNTIME;
    return {
      source: runtime.starSource,
      stars: runtime.stars,
      visualStars: runtime.visualStars,
      visualOnly: runtime.visualStars.every((star) => star.visual_only === true),
      armCount: runtime.armCount,
      pitchAngleDeg: runtime.pitchAngleDeg,
      renderedArms: new Set(runtime.visualStars.map((star) => star.arm_index).filter((arm) => arm !== null)).size,
    };
  });
  expect(state.source).toBe('database');
  expect(state.stars).toEqual(stars);
  expect(state.visualStars.length).toBeGreaterThan(32);
  expect(state.visualOnly).toBe(true);
  expect(state.armCount).toBe(5);
  expect(state.pitchAngleDeg).toBe(14);
  expect(state.renderedArms).toBe(5);
});

test('settings flight tour visits DB system preview stages without writing world state', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  const target = { id: 17, galaxy_index: 1, system_index: 17, name: 'DB System 17', x_ly: 120, y_ly: -15, z_ly: 210 };
  const previewRequests = [];
  const writeRequests = [];
  await page.route('**/galaxy.php?action=auth_stars**', (route) => route.fulfill({ json: {
    success: true, stars: [target], occupied_systems: [], arm_count: 6, pitch_angle_deg: 14,
  } }));
  await page.route('**/galaxy.php?action=auth_flight_preview**', async (route) => {
    previewRequests.push(route.request().url());
    await route.fulfill({ json: {
      success: true,
      preview_only: true,
      system: { ...target, spectral_class: 'G', temperature_k: 5778, radius_solar: 1, planet_count: 2 },
      planets: [
        { position: 1, name: 'Preview One', planet_class: 'gas_giant', can_colonize: false, semi_major_axis_au: 2.5 },
        { position: 2, name: 'Preview Two', planet_class: 'rocky', can_colonize: true, semi_major_axis_au: 1.0 },
      ],
    } });
  });
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /colony|register_prepare|register_profile|register_complete/.test(request.url())) {
      writeRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME?.starSource)).toBe('database');
  await page.locator('[data-start-panel="settings"]').click();
  const toggle = page.locator('#start-flight-tour');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME?.renderer?.scene?.stage), { timeout: 20000 }).toBe('surface');

  const previewState = await page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer.scene);
  expect(previewState.flightTour).toBe(true);
  expect(previewState.draft.preview_only).toBe(true);
  expect(await page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.spatialLabelStars.length)).toBe(1);
  expect(await page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer.destinations.slice(0, 3)))
    .toEqual([{ kind: 'system' }, { kind: 'planet', position: 2 }, { kind: 'surface', position: 2 }]);
  expect(previewRequests.length).toBeGreaterThan(0);
  expect(writeRequests).toEqual([]);
  const savedState = await page.evaluate(() => {
    const cookie = document.cookie.split('; ').find((part) => part.startsWith('gq_galaxy_flight='));
    return cookie ? JSON.parse(decodeURIComponent(cookie.slice('gq_galaxy_flight='.length))) : null;
  });
  expect(Object.keys(savedState).sort()).toEqual(['destination', 'start']);
  expect(savedState.start).toHaveLength(3);
  expect(savedState.destination).toHaveLength(3);
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.__flightRestoreCalls.length), { timeout: 20000 }).toBe(1);
  expect(await page.evaluate(() => window.__flightRestoreCalls[0])).toEqual(savedState);
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME?.renderer?.destinations
    ?.some((destination) => destination.kind === 'point')), { timeout: 20000 }).toBe(true);
  await page.locator('[data-start-panel="settings"]').click();
  const toggleAfterReload = page.locator('#start-flight-tour');
  await expect(toggleAfterReload).toBeChecked();

  await toggleAfterReload.uncheck();
  await expect(page.locator('#start-flight-status')).toContainText('off');
  await expect.poll(() => page.evaluate(() => document.cookie.includes('gq_galaxy_flight='))).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME?.renderer?.scene), { timeout: 5000 }).toBeNull();
});

test('login cascades beside its button on desktop and below it on narrow screens', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.locator('#start-login').click();
  const panel = page.locator('#start-auth-dialog');
  await expect(panel).toBeVisible();
  await expect(page.locator('#start-login')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toHaveCSS('animation-name', 'start-login-slide');
  const buttonBox = await page.locator('#start-login').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(panelBox.x).toBeGreaterThan(buttonBox.x + buttonBox.width);
  expect(Math.abs(panelBox.y - buttonBox.y)).toBeLessThan(2);
  expect(await panel.evaluate((element) => element.matches(':modal'))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#start-login')).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#start-login').click();
  await expect(panel).toBeVisible();
  const narrowButton = await page.locator('#start-login').boundingBox();
  const narrowPanel = await panel.boundingBox();
  expect(narrowPanel.y).toBeGreaterThanOrEqual(narrowButton.y + narrowButton.height);
  expect(Math.abs(narrowPanel.x - narrowButton.x)).toBeLessThan(2);
  expect(narrowPanel.x + narrowPanel.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await page.locator('#start-register').click();
  await expect(page.locator('#start-auth-dialog')).toHaveCount(0);
  await expect(page.locator('#registration-prologue')).toBeVisible();
  await expect(page.locator('#registration-back')).toBeVisible();
  await page.locator('#registration-back').click();
  await expect(page.locator('#start-register')).toBeFocused();
});

test('all other menu panels cascade, toggle and switch without leaving multiple panels open', async ({ page }) => {
  await mockApi(page);
  await page.route('**/auth.php?action=dev_tools_status', (route) =>
    route.fulfill({ json: { success: true, enabled: true } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  for (const selector of ['[data-start-panel="news"]', '[data-start-panel="blog"]', '[data-start-panel="settings"]', '#start-dev']) {
    const trigger = page.locator(selector);
    await trigger.click();
    const panel = page.locator('dialog[open]');
    await expect(panel).toHaveCount(1);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await panel.evaluate((element) => element.matches(':modal'))).toBe(false);
    const buttonBox = await trigger.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(panelBox.x).toBeGreaterThan(buttonBox.x + buttonBox.width);
    expect(Math.abs(panelBox.y - buttonBox.y)).toBeLessThan(2);
  }
  await page.locator('#start-dev').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['[data-start-panel="news"]', '[data-start-panel="blog"]', '[data-start-panel="settings"]', '#start-dev']) {
    const trigger = page.locator(selector);
    await trigger.click();
    const panel = page.locator('dialog[open]');
    const buttonBox = await trigger.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(panelBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

test('new server messages appear once, can be reopened and do not gate login', async ({ page }) => {
  await mockApi(page);
  await page.route('**/server_announcements.php?action=list', (route) => route.fulfill({
    json: { success: true, announcements: [{
      id: 7, title: 'Scheduled restart', message: 'Test announcement, not a real outage.',
      severity: 'maintenance', published_at: '2026-10-29 12:00:00',
    }] },
  }));
  await page.goto('/');
  const overlay = page.locator('#server-announcements-dialog');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Scheduled restart');
  await page.keyboard.press('Escape');
  await page.locator('#start-login').click();
  await expect(page.locator('#login-form')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('#start-announcements-status')).toHaveText('1 active');
  await expect(overlay).toBeHidden();
  await page.locator('#start-announcements').click();
  await expect(overlay).toBeVisible();
  await overlay.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(overlay).toBeHidden();
});
