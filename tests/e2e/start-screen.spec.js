const { test, expect } = require('@playwright/test');
const prologueContent = require('../../config/onboarding_prologue.json');
const cometNarration = require('../../config/onboarding_narration.json');

const apiAction = (file, action) => (url) =>
  url.pathname.endsWith(`/${file}.php`) && url.searchParams.get('action') === action;

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

async function mockApi(page, {
  authenticated = false, expireOnResume = false, twoFactor = false, loginSucceeds = false,
  catalogOutOfOrder = false,
} = {}) {
  let sessionChecks = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    let data = { success: true };
    if (url.pathname.endsWith('/registration_narration.php')) {
      await route.fulfill({ status: 503, json: { success: false, error: 'Narration not prepared in UI test.' } });
      return;
    } else if (url.pathname.endsWith('/developer_blog.php') && action === 'list') {
      data = { success: true, source: 'local', posts: [], flight_targets: [] };
    } else if (url.pathname.endsWith('/server_announcements.php')) {
      data = { success: true, announcements: [] };
    } else if (url.pathname.endsWith('/audio.php') && action === 'list') {
      data = { success: true, tracks: [{ value: 'music/Nebula_Overture.mp3' }] };
    } else if (action === 'me') {
      sessionChecks++;
      const valid = authenticated && !(expireOnResume && sessionChecks > 1);
      data = { success: true, authenticated: valid, user: valid ? { username: 'TestCommander' } : null };
    } else if (action === 'auth_stars') {
      data = { success: true, stars: [], occupied_systems: [], arm_count: 6, pitch_angle_deg: 14 };
    } else if (action === 'csrf') {
      data = { success: true, csrf_token: 'start-screen-test-token', token: 'start-screen-test-token' };
    } else if (action === 'overview') {
      data = { success: true, colonies: [], fleets: [], user_meta: { dark_matter: 0 } };
    } else if (action === 'dev_tools_status') {
      data = { success: true, enabled: false };
    } else if (action === 'login') {
      if (loginSucceeds) {
        authenticated = true;
        data = { success: true, user: { username: 'TestCommander' } };
      } else {
        data = twoFactor
          ? { success: true, requires_2fa: true, totp_session: 'test-challenge' }
          : { success: false, error: 'Test login rejected' };
      }
    } else if (action === 'totp_login_challenge') {
      data = { success: false, error: 'Test code rejected' };
    } else if (action === 'register_catalog') {
      data = { success: true,
        factions: prologueContent.factions.map((entry) => ({ ...entry, homeworld: "Sol'Ryaan", target: registrationTarget, stars: [registrationTarget] })),
        species: mentorDrafts.map((draft, index) => {
          const target = { ...draft.target, system_index: 100 + index, x_ly: -400 - index * 100 };
          return { code: draft.mentor_code, name: draft.mentor_code, description: 'Independent origin',
            homeworld: `${draft.mentor_code} home`, target, stars: [target],
            homeworld_scene: { scene_key: `homeworld:${index}`, target, system_name: `${draft.mentor_code} homeland`,
              position: { galaxy: 1, system: 100 + index, position: target.position },
              star: { temperature_k: 5500, radius_solar: 1 },
              planets: [{ position: target.position, name: `${draft.mentor_code} home`,
                diameter_km: 12000, semi_major_axis_au: 1, inhabited: true }],
            },
          };
        }).sort((a, b) => a.code.localeCompare(b.code)),
        npc_homeworlds: prologueContent.npc_tour.map((entry) => ({
          ...entry, target: registrationTarget, stars: [registrationTarget],
          homeworld_scene: { scene_key: `npc:${entry.code}`, target: registrationTarget,
            system_name: entry.homeworld, position: { galaxy: 1, system: 2, position: 3 },
            star: { temperature_k: 5500, radius_solar: 1 },
            planets: [{ position: 3, name: entry.homeworld,
              diameter_km: 12000, semi_major_axis_au: 1, inhabited: true }],
          },
        })),
      };
      if (catalogOutOfOrder) data.species.reverse();
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
    } else if (action === 'register_character_suggest') {
      data = { success: true, suggestion: { name: 'LoreCommander', background: 'A new commander inspired by the selected species lore.' } };
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
  await page.locator('#start-register').click();
  await waitForFirstHomeworld(page);
  await page.locator('#registration-opening-skip').click();
  await expect(page.locator('#registration-title')).toHaveText('Deine Herkunft');
  await expect(page.locator('#registration-choices button')).toHaveCount(6);
  await expect(page.locator('#registration-choices button').first()).toBeEnabled();
}

async function waitForFirstHomeworld(page) {
  await page.locator('#registration-opening-skip').click();
  await expect(page.locator('#registration-title')).toHaveText('aereth home');
}

test('startup loads audio and galaxy modules without executing unrelated runtime modules', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockApi(page);
  await page.goto('/');

  await expect(page.locator('#start-music-play')).toBeEnabled();
  await expect.poll(() => page.evaluate(() => typeof window.StarfieldWebGPU)).toBe('function');
  await expect.poll(() => page.evaluate(() => typeof window.Galaxy3DView)).toBe('function');
  await expect(page.locator('#start-music-status')).not.toContainText('Audio konnte nicht geladen werden');
  expect(await page.evaluate(() => typeof window.WMCore)).toBe('undefined');
  expect(errors).toEqual([]);
});

test('successful login initializes the window manager and shows the game overlay shell', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /is not defined|before initialization/.test(message.text())) {
      errors.push(message.text());
    }
  });
  await mockApi(page, { loginSucceeds: true });
  await page.goto('/');
  await page.locator('#start-login').click();
  await page.locator('#login-username').fill('TestCommander');
  await page.locator('#login-password').fill('isolated-test-password');
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#game-overlay-shell')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#auth-section')).toBeHidden();
  expect(await page.evaluate(() => typeof window.WM?.open)).toBe('function');
  await page.locator('#game-command-toggle').click();
  await expect(page.locator('#game-command-overlay')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const entry of ['/', '/index.html?logout=1']) {
  test(`start page loads its module graph and opens the login dialog: ${entry}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /module script|module specifier|MIME type/.test(message.text())) {
        errors.push(message.text());
      }
    });
    await mockApi(page);
    await page.goto(entry);
    await page.locator('#start-login').click();
    await expect(page.locator('#start-auth-dialog')).toBeVisible();
    await expect(page.locator('#login-username')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('homeworld chapters offer manual Back and Next before identity selection', async ({ page }) => {
  await mockApi(page, { catalogOutOfOrder: true });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.GQAuthGalaxyBackgroundControl))).toBe(true);
  await page.evaluate(() => { window.GQAuthGalaxyBackgroundControl.playRegistrationShot = () => false; });
  await page.locator('#start-register').click();
  await waitForFirstHomeworld(page);
  await expect(page.locator('#registration-flight-status')).toContainText('Kometenflug ist nicht verfügbar');
  await expect(page.locator('#registration-continue')).toBeVisible();
  await expect(page.locator('#registration-continue')).toBeEnabled();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('kryl_tha home');
  await expect(page.locator('#registration-flight-status')).toContainText('Kometenflug ist nicht verfügbar');
  await page.locator('#registration-back').click();
  await expect(page.locator('#registration-title')).toHaveText('aereth home');
  for (const title of [
    'kryl_tha home', 'syl_nar home', 'vel_ar home', 'vor_tak home', 'zhareen home',
    ...prologueContent.npc_tour.map((entry) => entry.homeworld),
  ]) {
    await expect(page.locator('#registration-flight-status')).toContainText('Kometenflug ist nicht verfügbar');
    await page.locator('#registration-continue').click();
    await expect(page.locator('#registration-title')).toHaveText(title);
  }
  await expect(page.locator('#registration-flight-status')).toContainText('Kometenflug ist nicht verfügbar');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-title')).toHaveText('Deine Herkunft');
  await expect(page.locator('#registration-choices button').first()).toBeEnabled();
  await expect(page.locator('#registration-choices button')).toHaveCount(6);
  await expect(page.locator('#registration-continue')).toBeHidden();
});

test('character step pre-fills editable name and biography from the species lore', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await reachMentorRoom(page);
  await page.locator('[data-choice="vor_tak"]').click();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-character')).toBeVisible();
  await expect(page.locator('#registration-name')).toHaveValue('LoreCommander');
  await expect(page.locator('#registration-background')).toHaveValue(
    'A new commander inspired by the selected species lore.',
  );
  await expect(page.locator('#registration-character-suggest')).toBeEnabled();
  await expect(page.locator('#registration-name')).toBeEnabled();
  await expect(page.locator('#registration-background')).toBeEnabled();
});

test('new campaign opens a pausable cinematic before the arrival on desktop and mobile', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('#registration-prologue')).toBeHidden();
  await page.clock.install();
  await page.locator('#start-register').click();
  await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'opening');
  await expect(page.locator('#registration-title')).toHaveText(prologueContent.opening[0].title);
  await expect(page.locator('#start-menu')).not.toBeVisible();
  await page.locator('#registration-opening-pause').click();
  await page.clock.fastForward(60000);
  await expect(page.locator('#registration-title')).toHaveText(prologueContent.opening[0].title);
  await page.locator('#registration-opening-pause').click();
  await page.clock.fastForward(prologueContent.opening[0].duration_ms);
  await expect(page.locator('#registration-title')).toHaveText('GalaxyQuest');
  await expect.poll(() => page.locator('#registration-story').evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.locator('#registration-opening-pause').click();
  await expect(page.locator('#registration-prologue')).toHaveAttribute('data-slide-motion', 'paused');
  await expect(page.locator('#registration-story')).toHaveCSS('opacity', '1');
  expect(await page.locator('.registration-slide-ghost').evaluateAll((nodes) =>
    nodes.every((node) => getComputedStyle(node).opacity === '0'))).toBe(true);
  await expect.poll(() => page.locator('#registration-title').evaluate((node) => node.getAnimations().length)).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.body.dataset.startReducedMotion = 'true';
    document.body.classList.add('start-reduced-motion');
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: true } }));
  });
  await expect.poll(() => page.locator('#registration-title').evaluate((node) => node.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#registration-opening-skip')).toBeInViewport();
  await page.locator('#registration-opening-skip').click();
  await expect(page.locator('#registration-prologue')).not.toHaveAttribute('data-phase', 'opening');
  if ((await page.locator('#registration-prologue').getAttribute('data-phase')) === 'arrival') {
    await page.locator('#registration-continue').click();
  }
  await expect(page.locator('#registration-title')).toHaveText('aereth home');
  for (let index = 0; index < 4; index++) await page.locator('#registration-back').click();
  await expect(page.locator('#start-register')).toBeFocused();
});

test('menu controls fly out before the cinematic and fly back in on return', async ({ page }) => {
  await mockApi(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('gq_start_reduced_motion', '0'));
  await page.goto('/');
  const menu = page.locator('#start-menu');
  await expect(menu).toHaveAttribute('data-motion-state', 'visible');
  expect(await page.locator('[data-motion-direction]').evaluateAll((nodes) =>
    [...new Set(nodes.map((node) => node.dataset.motionDirection))].sort()))
    .toEqual(['bottom', 'left', 'right', 'top']);
  await page.locator('#start-register').click();
  await expect(menu).toHaveAttribute('data-motion-state', 'exiting');
  await expect(menu).toHaveJSProperty('inert', true);
  await expect(page.locator('#registration-prologue')).toBeHidden();
  await expect.poll(() => page.locator('#start-music-player').evaluate((node) =>
    Number(getComputedStyle(node).opacity))).toBeLessThan(1);
  await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'opening');
  await expect(menu).toHaveAttribute('data-motion-state', 'hidden');
  await page.locator('#registration-back').click();
  await expect(menu).toHaveAttribute('data-motion-state', 'entering');
  await expect(menu).toHaveJSProperty('inert', false);
  await expect(menu).toHaveAttribute('data-motion-state', 'visible');
  expect(await page.locator('.start-title').evaluate((node) =>
    ({ opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform })))
    .toEqual({ opacity: '1', transform: 'none' });
  await page.locator('#start-login').click();
  await expect(page.locator('#login-username')).toBeFocused();
});

test('narrative overlays leave the galaxy center clear on desktop, mobile and landscape', async ({ page }) => {
  await mockApi(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('#start-register').click();
    await page.locator('#registration-opening-pause').click();
    const stage = page.locator('.registration-stage');
    const checkComposition = async () => {
      const bounds = await stage.boundingBox();
      expect(bounds.y).toBeGreaterThanOrEqual(viewport.height * 0.55);
      expect(bounds.height).toBeLessThanOrEqual(viewport.height * 0.44 + 1);
      expect(bounds.width).toBeLessThanOrEqual(760);
      expect(await page.locator('#registration-prologue').evaluate((node) =>
        getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('#registration-continue')).toBeInViewport();
    };
    await checkComposition();
    await expect(page.locator('#registration-opening-source')).not.toHaveAttribute('open');
    await page.locator('#registration-opening-source summary').click();
    await expect(page.locator('#registration-opening-source a')).toBeVisible();
    await page.locator('#registration-opening-source summary').click();
    await page.locator('#registration-opening-skip').click();
    if ((await page.locator('#registration-prologue').getAttribute('data-phase')) === 'arrival') {
      await page.locator('#registration-continue').click();
    }
    await expect(page.locator('#registration-title')).toHaveText('aereth home');
    await checkComposition();
    await page.locator('#registration-back').click();
  }
});

test('registration keeps a large subtitle above accessible icon controls and real progress', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('gq_tts_auto_voice', '0');
    localStorage.setItem('gq_tts_voice', 'en_US-ryan-high');
    localStorage.setItem('gq_start_reduced_motion', '0');
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('#start-register').click();
    await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'opening');
    await expect.poll(() => page.locator('#registration-story').evaluate((node) => node.getAnimations().length)).toBe(0);
    await page.locator('#registration-opening-pause').click();
    await expect(page.locator('#registration-story')).toHaveText(cometNarration.clips['comet-opening-o1'].en);
    await expect(page.locator('#registration-progress')).toBeVisible();
    await expect(page.locator('#registration-progress')).toHaveJSProperty('value', 1);
    const layout = await page.evaluate(() => {
      const bounds = (selector) => document.querySelector(selector).getBoundingClientRect();
      const story = bounds('#registration-story');
      const progress = bounds('#registration-progress');
      const controls = bounds('.registration-stage-actions');
      return {
        storyBottom: story.bottom, progressTop: progress.top, progressBottom: progress.bottom,
        controlsTop: controls.top, storyFont: parseFloat(getComputedStyle(document.querySelector('#registration-story')).fontSize),
        titleClip: getComputedStyle(document.querySelector('#registration-title')).clip,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    expect(layout.storyBottom).toBeLessThanOrEqual(layout.progressTop);
    expect(layout.progressBottom).toBeLessThanOrEqual(layout.controlsTop);
    expect(layout.storyFont).toBeGreaterThanOrEqual(15);
    expect(layout.titleClip).toBe('rect(0px, 0px, 0px, 0px)');
    expect(layout.pageFits).toBe(true);
    for (const id of ['back', 'opening-pause', 'opening-skip', 'continue']) {
      await expect(page.locator(`#registration-${id}`)).toHaveAttribute('aria-label', /.+/);
      await expect(page.locator(`#registration-${id} svg:visible`).first()).toBeVisible();
      await expect(page.locator(`#registration-${id}`)).toBeInViewport();
    }
    await expect(page.locator('#registration-opening-pause')).toHaveAttribute('aria-label', 'Fortsetzen');
    await page.locator('#registration-opening-source summary').click();
    await expect(page.locator('#registration-opening-source a')).toBeVisible();
    await page.locator('#registration-continue').click();
    await expect(page.locator('#registration-progress')).toHaveJSProperty('value', 2);
    await expect(page.locator('#registration-story')).toHaveText(cometNarration.clips['comet-opening-o2'].en);
    await expect(page.locator('#registration-story')).toHaveCSS('opacity', '1');
    await expect(page.locator('#registration-opening-source')).not.toHaveAttribute('open');

    await page.locator('#registration-opening-skip').click();
    await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'homeworlds');
    await page.locator('#registration-opening-skip').click();
    await expect(page.locator('#registration-choices button')).toHaveCount(6);
    await expect(page.locator('#registration-progress')).toBeInViewport();
    const order = await page.evaluate(() =>
      document.querySelector('#registration-choices').getBoundingClientRect().bottom
      <= document.querySelector('#registration-story').getBoundingClientRect().top);
    expect(order).toBe(true);
    await page.locator('[data-choice="aereth"]').click();
    await expect(page.locator('[data-choice="aereth"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#registration-continue')).toHaveAttribute('aria-label', 'Herkunft bestätigen und Namen wählen');
    await page.locator('#registration-continue').click();
    await expect(page.locator('#registration-name')).toBeVisible();
    await page.locator('#registration-name').fill('Commander');
    await page.locator('#registration-background').fill('Explorer');
    await page.locator('#registration-character-form [type="submit"]').click();
    await expect(page.locator('#registration-status')).toContainText('nicht aktiviert');
  }
});

test('comet narration prepares and reuses the next cue during audio playback', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem('gq_start_reduced_motion', '1'));
  const requests = [];
  const audioRequests = [];
  let releaseNext;
  const nextReady = new Promise((resolve) => { releaseNext = resolve; });
  const samples = 8000 * 3;
  const silence = Buffer.alloc(44 + samples * 2);
  silence.write('RIFF', 0);
  silence.writeUInt32LE(silence.length - 8, 4);
  silence.write('WAVEfmt ', 8);
  silence.writeUInt32LE(16, 16);
  silence.writeUInt16LE(1, 20);
  silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(8000, 24);
  silence.writeUInt32LE(16000, 28);
  silence.writeUInt16LE(2, 32);
  silence.writeUInt16LE(16, 34);
  silence.write('data', 36);
  silence.writeUInt32LE(samples * 2, 40);
  await page.route('**/api/registration_narration.php', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body.clip);
    if (body.clip === 'comet-opening-o2') await nextReady;
    const voice = body.voice || 'de_DE-kerstin-low';
    const language = cometNarration.voices[voice];
    const digit = body.clip.match(/o(\d)$/)?.[1] || '9';
    await route.fulfill({ json: {
      success: true, text: cometNarration.clips[body.clip][language], voice,
      audio_url: `generated/tts/${digit.repeat(64)}.mp3`,
    } });
  });
  await page.route('**/generated/tts/*.mp3', (route) => {
    audioRequests.push(route.request().url());
    return route.fulfill({ body: silence, contentType: 'audio/wav' });
  });

  try {
    await page.goto('/');
    await page.locator('#start-register').click();
    await expect.poll(() => requests.slice(0, 2)).toEqual(['comet-opening-o1', 'comet-opening-o2']);
    await expect.poll(() => audioRequests.some((url) => url.includes('1'.repeat(64)))).toBe(true);
    await expect(page.locator('#registration-story')).toHaveText(cometNarration.clips['comet-opening-o1'].de);
    await page.locator('#registration-continue').click();
    await expect(page.locator('#registration-story')).toHaveText(cometNarration.clips['comet-opening-o2'].de);
    expect(requests.filter((clip) => clip === 'comet-opening-o2')).toHaveLength(1);
    releaseNext();
    await expect.poll(() => audioRequests.some((url) => url.includes('2'.repeat(64)))).toBe(true);
    await expect.poll(() => requests.includes('comet-opening-o3')).toBe(true);
  } finally {
    releaseNext();
  }
});

test('comet can be skipped and cancellation restores the captured view', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.GQAuthGalaxyBackgroundControl))).toBe(true);
  await page.evaluate(() => {
    const calls = window.__registrationTransitionCalls = [];
    Object.assign(window.GQAuthGalaxyBackgroundControl, {
      captureRegistrationView: () => { calls.push('capture'); return { marker: 'original' }; },
      beginRegistrationTransition: ({ snapshot }) => {
        calls.push(`begin:${snapshot.marker}`);
        return new Promise((resolve) => { window.__finishRegistrationTransition = resolve; });
      },
      skipRegistrationTransition: () => calls.push('skip'),
      restoreRegistrationView: (snapshot) => calls.push(`restore:${snapshot.marker}`),
    });
  });
  await page.locator('#start-register').click();
  await page.locator('#registration-opening-skip').click();
  await expect(page.locator('#registration-title')).toHaveText('aereth home');
  for (let index = 0; index < 4; index++) await page.locator('#registration-back').click();
  await expect(page.locator('#start-register')).toBeFocused();
  expect(await page.evaluate(() => window.__registrationTransitionCalls)).toEqual([
    'capture', 'restore:original',
  ]);
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
  await expect(page.getByRole('region', { name: 'Log entries' })).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#terminal-section')).not.toHaveAttribute('aria-live');
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 640 }, { width: 360, height: 400 }]) {
  test(`compact system log follows the start menu layout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await mockApi(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    const panel = page.locator('#boot-terminal');
    const toggle = page.locator('#ui-console-expand');
    const log = page.locator('#ui-console-log');
    await page.evaluate(() => window.__GQ_BOOT_PROBE.log('layout-error-check', 'error'));
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(log).toBeVisible();
    await page.evaluate(() => window.__GQ_SET_BOOT_CONSOLE_EXPANDED(false));
    await expect(page.locator('#auth-status-line')).toContainText('layout-error-check');
    await expect(page.locator('#auth-status-line')).toHaveClass(/auth-status-error/);
    await expect(page.locator('#boot-terminal-mode')).toBeHidden();
    await expect(page.locator('#ui-console-filter')).toBeHidden();
    await expect(log).toBeHidden();
    const alignment = await panel.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const navigation = document.querySelector('.start-navigation').getBoundingClientRect();
      return { x: rect.x, width: rect.width, menuX: navigation.x, menuWidth: navigation.width, pageWidth: document.documentElement.scrollWidth };
    });
    expect(alignment.x).toBeCloseTo(alignment.menuX, 0);
    expect(alignment.width).toBeCloseTo(alignment.menuWidth, 0);
    expect(alignment.pageWidth).toBeLessThanOrEqual(viewport.width);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(log).toBeVisible();
    await expect(log).toContainText('layout-error-check');
    await expect(page.locator('#boot-terminal-mode')).toBeVisible();
    await expect(page.locator('#ui-console-filter')).toBeHidden();
    await expect(page.locator('#ui-console-copy')).toBeVisible();
    await expect(page.locator('#ui-console-input-row')).toBeHidden();
    const sizes = await panel.evaluate(element => ({
      panelHeight: element.getBoundingClientRect().height,
      maxHeight: parseFloat(getComputedStyle(element).maxHeight),
      logOverflow: getComputedStyle(document.querySelector('#ui-console-log')).overflowY,
    }));
    expect(sizes.panelHeight).toBeLessThanOrEqual(sizes.maxHeight + 1);
    expect(sizes.maxHeight).toBeLessThanOrEqual(Math.min(viewport.height * 0.64, 480) + 1);
    expect(['auto', 'scroll']).toContain(sizes.logOverflow);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(log).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  });
}

test('long warning and error messages wrap on narrow screens and errors are announced', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 400 });
  await page.goto('/');
  const message = 'long-message-'.repeat(30);
  await page.evaluate(text => window.__GQ_BOOT_PROBE.log(text, 'warn'), message);
  await expect(page.locator('#auth-status-line')).toHaveClass(/auth-status-warn/);
  await expect(page.locator('#auth-status-line')).toContainText(message);
  const status = await page.locator('#auth-status-line').evaluate(element => ({
    height: element.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(element).lineHeight),
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(status.height).toBeGreaterThan(status.lineHeight * 2);
  expect(status.scrollWidth).toBeLessThanOrEqual(360);
  await page.evaluate(text => window.__GQ_BOOT_PROBE.log(text, 'error'), message);
  await expect(page.locator('#auth-log-alert')).toHaveText(`Log error: ${message}`);
  await expect(page.locator('#auth-status-line')).toHaveClass(/auth-status-error/);
  await expect(page.locator('#ui-console-expand')).toHaveAttribute('aria-expanded', 'true');
});

test('closing the startup log preserves the status and allows reopening', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  expect(await page.evaluate(() => window.__GQ_BOOT_TERMINAL_ADAPTER.isFallbackActive())).toBe(true);
  await page.evaluate(() => window.__GQ_BOOT_PROBE.log('reopen-log-check', 'error'));
  const panel = page.locator('#boot-terminal');
  const log = page.locator('#ui-console-log');
  const toggle = page.locator('#ui-console-expand');
  await expect(log).toContainText('reopen-log-check');
  await page.locator('#ui-console-close').click();
  await expect(panel).toBeVisible();
  await expect(log).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(page.locator('#auth-status-line')).toContainText('reopen-log-check');
  await page.keyboard.press('Enter');
  await expect(log).toBeVisible();
  await expect(log).toContainText('reopen-log-check');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('startup log copies literal entries and clears the displayed status', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async text => { window.__copiedBootLog = text; } },
    });
  });
  await page.goto('/');
  await page.evaluate(() => window.__GQ_BOOT_PROBE.log('copy-check <b>literal</b>', 'error'));
  const log = page.locator('#ui-console-log');
  await expect(log).toContainText('copy-check <b>literal</b>');
  await expect(log.locator('b')).toHaveCount(0);
  await page.locator('#ui-console-copy').click();
  await expect.poll(() => page.evaluate(() => window.__copiedBootLog)).toContain('copy-check <b>literal</b>');
  await page.locator('#ui-console-clear').click();
  await expect(log).toBeEmpty();
  await expect(page.locator('#auth-status-line')).toContainText('Terminal log cleared');
  await expect(page.locator('#auth-status-line')).not.toHaveClass(/auth-status-error/);
});

test('startup log reports a rejected legacy clipboard copy and cleans up', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => false;
  });
  await page.goto('/');
  await page.evaluate(() => window.__GQ_BOOT_PROBE.log('copy-failure-check', 'info'));
  await page.locator('#ui-console-expand').click();
  await page.locator('#ui-console-copy').click();
  await expect(page.locator('#auth-status-line')).toContainText('Boot terminal copy failed');
  await expect(page.locator('#auth-status-line')).toHaveClass(/auth-status-error/);
  await expect(page.locator('#ui-console-log')).toContainText('copy-failure-check');
  await expect(page.locator('body > textarea[readonly]')).toHaveCount(0);
});

test('closing the startup log remains reversible after logger takeover', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: async text => { window.__copiedTakeoverLog = text; } },
    });
  });
  await page.goto('/');
  await page.evaluate(() => window.__GQ_BOOT_PROBE.log('before-takeover-check', 'warn'));
  await page.addScriptTag({ url: '/js/ui/terminal.js' });
  await expect.poll(() => page.evaluate(() => window.__GQ_BOOT_TERMINAL_ADAPTER.isFallbackActive())).toBe(false);
  await page.evaluate(() => {
    window.GQLog.info('takeover-reopen-check');
    window.__GQ_SET_BOOT_CONSOLE_EXPANDED(true);
  });
  const toggle = page.locator('#ui-console-expand');
  const log = page.locator('#ui-console-log');
  await expect(log).toContainText('before-takeover-check');
  expect(await page.evaluate(() => window.GQLog.getSessionEntries().filter(entry => entry.text === 'before-takeover-check').length)).toBe(1);
  await expect(log).toContainText('takeover-reopen-check');
  await page.evaluate(() => window.__GQ_BOOT_PROBE.log('probe-after-takeover'));
  await expect(log).toContainText('before-takeover-check');
  await expect(log).toContainText('probe-after-takeover');
  await page.locator('#ui-console-copy').click();
  await expect.poll(() => page.evaluate(() => window.__copiedTakeoverLog)).toContain('takeover-reopen-check');
  await page.locator('#ui-console-close').click();
  await expect(page.locator('#boot-terminal')).toBeVisible();
  await expect(log).toBeHidden();
  await expect(toggle).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(log).toBeVisible();
  await expect(log).toContainText('takeover-reopen-check');
  await page.locator('#ui-console-clear').click();
  await expect(log).not.toContainText('takeover-reopen-check');
  await expect(page.locator('#auth-status-line')).toContainText('Terminal log cleared');
});

for (const takeover of [false, true]) {
  test(`reading older log entries does not jump to the bottom, takeover=${takeover}`, async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    if (takeover) {
      await page.addScriptTag({ url: '/js/ui/terminal.js' });
      await expect.poll(() => page.evaluate(() => window.__GQ_BOOT_TERMINAL_ADAPTER.isFallbackActive())).toBe(false);
    }
    await page.evaluate((useLogger) => {
      for (let i = 0; i < 50; i++) {
        if (useLogger) window.GQLog.info(`scroll-entry-${i}`);
        else window.__GQ_BOOT_PROBE.log(`scroll-entry-${i}`);
      }
      window.__GQ_SET_BOOT_CONSOLE_EXPANDED(true);
    }, takeover);
    const log = page.locator('#ui-console-log');
    await expect(log).toBeVisible();
    expect(await log.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2);
    await log.evaluate(element => { element.scrollTop = 0; });
    await page.evaluate((useLogger) => {
      if (useLogger) window.GQLog.info('new-while-reading');
      else window.__GQ_BOOT_PROBE.log('new-while-reading');
    }, takeover);
    await expect(log).toContainText('new-while-reading');
    expect(await log.evaluate(element => element.scrollTop)).toBe(0);
    await page.evaluate((useLogger) => {
      window.__GQ_SET_BOOT_CONSOLE_EXPANDED(false);
      if (useLogger) window.GQLog.info('new-while-closed');
      else window.__GQ_BOOT_PROBE.log('new-while-closed');
      window.__GQ_SET_BOOT_CONSOLE_EXPANDED(true);
    }, takeover);
    expect(await log.evaluate(element => element.scrollTop)).toBe(0);
    await log.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.evaluate((useLogger) => {
      if (useLogger) window.GQLog.info('new-while-following');
      else window.__GQ_BOOT_PROBE.log('new-while-following');
    }, takeover);
    expect(await log.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2);
  });
}

test('logger takeover preserves the fallback history while reading older entries', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.__GQ_SET_BOOT_CONSOLE_EXPANDED(true);
    for (let i = 0; i < 50; i++) window.__GQ_BOOT_PROBE.log(`handoff-entry-${i}`);
  });
  const log = page.locator('#ui-console-log');
  await log.evaluate(element => { element.scrollTop = 0; });
  await page.addScriptTag({ url: '/js/ui/terminal.js' });
  await expect.poll(() => page.evaluate(() => window.__GQ_BOOT_TERMINAL_ADAPTER.isFallbackActive())).toBe(false);
  await expect(log).toContainText('handoff-entry-0');
  await expect(log).toContainText('handoff-entry-49');
  expect(await log.evaluate(element => element.scrollTop)).toBe(0);
});

test('logger takeover expands startup errors without stealing focus or changing game console state', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.addScriptTag({ url: '/js/ui/terminal.js' });
  await expect.poll(() => page.evaluate(() => window.__GQ_BOOT_TERMINAL_ADAPTER.isFallbackActive())).toBe(false);
  await page.evaluate(() => window.__GQ_SET_BOOT_CONSOLE_EXPANDED(false));
  await page.locator('#start-login').focus();
  await page.evaluate(() => window.GQLog.warn('takeover-warning-check'));
  await expect(page.locator('#ui-console-log')).toBeHidden();
  await page.evaluate(() => window.GQLog.error('takeover-error-check'));
  await expect(page.locator('#ui-console-expand')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#ui-console-log')).toContainText('takeover-error-check');
  await expect(page.locator('#auth-status-line')).toContainText('takeover-error-check');
  await expect(page.locator('#auth-log-alert')).toContainText('takeover-error-check');
  await expect(page.locator('#start-login')).toBeFocused();
  await page.evaluate(() => {
    window.__GQ_SET_BOOT_CONSOLE_EXPANDED(false);
    document.body.classList.replace('auth-page', 'game-page');
    window.GQLog.error('game-error-check');
  });
  await expect(page.locator('#ui-console-expand')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#ui-console-log')).toBeHidden();
});

test('logger takeover reports a rejected legacy clipboard copy', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = () => false;
  });
  await page.goto('/');
  await page.addScriptTag({ url: '/js/ui/terminal.js' });
  await expect.poll(() => page.evaluate(() => window.__GQ_BOOT_TERMINAL_ADAPTER.isFallbackActive())).toBe(false);
  await page.evaluate(() => {
    window.GQLog.info('takeover-copy-failure-check');
    window.__GQ_SET_BOOT_CONSOLE_EXPANDED(true);
  });
  await page.locator('#ui-console-copy').click();
  await expect(page.locator('#auth-status-line')).toContainText('Boot terminal copy failed');
  await expect(page.locator('#auth-status-line')).toHaveClass(/auth-status-error/);
  await expect(page.locator('#ui-console-log')).toContainText('takeover-copy-failure-check');
  await expect(page.locator('body > textarea[readonly]')).toHaveCount(0);
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
  await expect(page.locator('#registration-title')).toHaveText('Wer übernimmt das Kommando?');
  await expect(page.locator('#registration-draft-summary')).toContainText('Frontier Colony');
  await page.locator('#registration-name').fill('Commander');
  await page.locator('#registration-background').fill('Frontier engineer');
  await page.locator('#registration-character-form [type="submit"]').click();
  await expect(page.locator('#registration-status')).toContainText('nicht aktiviert');
  await expect(page.locator('#registration-prologue input[type="email"],#registration-prologue input[type="password"]')).toHaveCount(0);
});

test('registration previews public homeworlds and restores a private character draft on mobile', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  const saved = { ...mentorDrafts[1], selected: true, character: { name: 'SavedCommander', background: 'Explorer' } };
  await page.route(apiAction('auth', 'register_mentor_drafts'), (route) => route.fulfill({ json: { success: true, drafts: [
    ...mentorDrafts.filter((item) => item.mentor_code !== 'vor_tak'), saved,
  ] } }));
  await page.route(apiAction('auth', 'register_select_mentor'), (route) => route.fulfill({ json: { success: true, draft: saved } }));
  await page.route(apiAction('auth', 'register_status'), (route) => route.fulfill({ json: { success: true, draft: saved } }));
  await page.route(apiAction('auth', 'register_profile'), (route) => route.fulfill({ json: { success: true, draft: saved } }));
  await page.goto('/');
  await reachMentorRoom(page);
  await expect(page.locator('#registration-status')).toContainText('private System-Drafts');
  await page.locator('[data-choice="vor_tak"]').click();
  await expect(page.locator('#registration-story')).toContainText('vor_tak home');
  await expect.poll(() => page.evaluate(() =>
    window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer.registrationShots?.at(-1)?.kind)).toBe('comet-world');
  const sceneState = await page.evaluate(() => {
    const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
    return { scene: renderer.scene, shot: renderer.registrationShots.at(-1) };
  });
  expect(sceneState.scene.sceneGraph.type).toBe('galaxy');
  expect(sceneState.scene.sceneGraph.children[0].type).toBe('system');
  expect(sceneState.scene.sceneGraph.children[0].children[0].type).toBe('planet');
  expect(sceneState.scene.sceneGraph.children[0].data.system_index).toBe(101);
  expect(sceneState.shot.destination).toEqual(sceneState.scene.sceneGraph);
  expect(sceneState.shot.duration_ms).toBe(45000);
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-name')).toHaveValue('SavedCommander');
  await expect(page.locator('#registration-background')).toHaveValue('Explorer');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('registration surfaces setup failures and Back cancels the visible flow without late UI changes', async ({ page }) => {
  await mockApi(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route(apiAction('auth', 'register_mentor_drafts'), async (route) => {
    await pending;
    await route.fulfill({ status: 503, json: { success: false, error: 'Registration setup is incomplete.' } });
  });
  await page.goto('/');
  await page.locator('#start-register').click();
  await waitForFirstHomeworld(page);
  await page.locator('#registration-opening-skip').click();
  await expect(page.locator('#registration-status')).toContainText('Systeme werden vorbereitet');
  release();
  await expect(page.locator('#registration-error')).toContainText('Registration setup is incomplete');
  await expect(page.locator('#registration-retry')).toBeVisible();
  await expect(page.locator('#registration-character')).toBeHidden();
  for (let index = 0; index < 10; index++) await page.keyboard.press('Escape');
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
  await page.route(apiAction('audio', 'list'), async (route) => {
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
  await page.route(apiAction('audio', 'list'), (route) => route.fulfill({
    status: 503, json: { success: false, error: 'Catalog unavailable' },
  }));
  await page.goto('/');
  await expect(page.locator('#start-music-play')).toBeEnabled();
  await expect(page.locator('#start-music-status')).toContainText('nur Ersatztitel');
  await expect(page.locator('#start-music-title')).toHaveText('Nebula Overture');
});

test('a confirmed session offers Fortsetzen instead of login but does not auto-enter the game', async ({ page }) => {
  await mockApi(page, { authenticated: true, expireOnResume: true });
  await page.goto('/');
  await expect(page.locator('#start-resume')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fortsetzen', exact: true })).toBeVisible();
  await expect(page.locator('#start-login')).toBeHidden();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(page.locator('#start-session-status')).toContainText('TestCommander');
  await page.locator('#start-resume').click();
  await expect(page.locator('#start-login')).toBeVisible();
  await expect(page.locator('#start-session-status')).toContainText('session expired');
  await expect(page.locator('body')).toHaveClass(/auth-page/);
});

test('Fortsetzen survives a reload and hands control to the existing shell only after an explicit click', async ({ page }) => {
  await mockApi(page, { authenticated: true });
  await page.addInitScript(() => {
    window.__testAuthenticatedEvents = 0;
    window.addEventListener('gq:authenticated', () => { window.__testAuthenticatedEvents++; });
  });
  await page.goto('/');
  await expect(page.locator('#start-resume')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Fortsetzen', exact: true })).toBeVisible();
  await expect(page.locator('#start-login')).toBeHidden();
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
  await expect(page.getByRole('dialog', { name: 'News and transmissions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#ui-console-expand').click();
  await expect(page.locator('#ui-console-log')).toBeVisible();
  await page.locator('#ui-console-close').click();
  await expect(page.locator('#ui-console-log')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('start menu panels expand inline and remain within a narrow viewport', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page.locator('[data-start-panel="news"]').click();
  const newsPanel = page.locator('.start-cascade-panel:has(> #start-panel-news:not([hidden]))');
  await expect(newsPanel).toBeVisible();

  const layout = await newsPanel.evaluate((panel) => {
    const trigger = panel.parentElement.querySelector('[data-start-panel="news"]');
    const panelRect = panel.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    return {
      position: getComputedStyle(panel).position,
      immediatelyAfterTrigger: trigger.nextElementSibling === panel,
      choicesInsidePanel: panel.contains(document.getElementById('start-news-posts')),
      panelX: panelRect.x,
      triggerX: triggerRect.x,
      panelTop: panelRect.top,
      triggerBottom: triggerRect.bottom,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(layout.position).toBe('relative');
  expect(layout.immediatelyAfterTrigger).toBe(true);
  expect(layout.choicesInsidePanel).toBe(true);
  expect(layout.panelX).toBeCloseTo(layout.triggerX);
  expect(layout.panelTop).toBeGreaterThanOrEqual(layout.triggerBottom);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
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
  await page.route(apiAction('auth', 'login'), async (route) => {
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
  await expect(page.locator('#start-galaxy-source')).toContainText('WebGPU is unavailable');
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
          ready: true,
          playRegistrationShot: (shot) => {
            (this.registrationShots ||= []).push(shot);
            if (shot.kind !== 'comet-world') return false;
            this.scene = { stage: 'planet', sceneGraph: shot.destination };
            return new Promise((resolve) => { this.pendingRegistrationShot = resolve; });
          },
          cancelRegistrationShot: () => {
            this.pendingRegistrationShot?.(false);
            this.pendingRegistrationShot = null;
          },
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

test('registration keeps one canvas and requires explicit landing without activating the world', async ({ page }) => {
  await mockApi(page);
  await mockBackgroundRenderer(page);
  const activation = [];
  const draftEntries = [];
  await page.route(apiAction('registration_play', 'enter'), (route) => {
    draftEntries.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { success: false, error: 'Test draft entry rejected' } });
  });
  page.on('request', (request) => {
    if (['register_complete', 'register'].includes(new URL(request.url()).searchParams.get('action'))) activation.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#galaxy-bg-wrapper canvas')).toHaveCount(1);
  await page.evaluate(() => { window.__flightCanvas = document.querySelector('#galaxy-bg-wrapper canvas'); });
  await reachMentorRoom(page);
  await expect(page.locator('.registration-herald-canvas')).toHaveCount(0);
  const sceneStage = () => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer.scene?.stage || 'galaxy');
  await page.locator('[data-choice="vor_tak"]').click();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-character')).toBeVisible();
  await expect.poll(sceneStage).toBe('planet');
  await page.locator('#registration-name').fill('LandingCommander');
  await page.locator('#registration-background').fill('An explorer seeking a new beginning.');
  await page.locator('#registration-character-form [type="submit"]').click();
  await expect(page.locator('#registration-status')).toContainText('nicht aktiviert');
  await expect(page.locator('#registration-title')).toHaveText('Wer übernimmt das Kommando?');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'journey');
  await expect(page.locator('#registration-flight-status')).toContainText('nicht verfügbar');
  await expect(page.locator('#registration-continue')).toHaveText('Ohne Kamera zur Zielprüfung');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-continue')).toHaveText('Bestätigen und landen');
  await expect.poll(sceneStage).toBe('planet');
  expect(draftEntries).toEqual([]);
  expect(await page.evaluate(() => window.__flightCanvas === document.querySelector('#galaxy-bg-wrapper canvas'))).toBe(true);
  await page.locator('#registration-back').click();
  await expect(page.locator('#registration-character')).toBeVisible();
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-continue')).toHaveText('Ohne Kamera zur Zielprüfung');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-continue')).toHaveText('Bestätigen und landen');
  expect(draftEntries).toEqual([]);
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-continue')).toHaveText('Ohne Kamera zum Tutorial');
  expect(draftEntries).toEqual([]);
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-error')).toContainText('Test draft entry rejected');
  expect(draftEntries).toHaveLength(1);
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
  await page.route(apiAction('galaxy', 'auth_stars'), (route) =>
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
  await page.route(apiAction('galaxy', 'auth_stars'), (route) => route.fulfill({ json: {
    success: true, stars: [target], occupied_systems: [], arm_count: 6, pitch_angle_deg: 14,
  } }));
  await page.route(apiAction('galaxy', 'auth_flight_preview'), async (route) => {
    previewRequests.push(route.request().url());
    await route.fulfill({ json: {
      success: true,
      preview_only: true,
      system: { ...target, spectral_class: 'G', temperature_k: 5778, radius_solar: 1, planet_count: 2 },
      planets: [
        { position: 1, name: 'Preview One', planet_class: 'gas_giant', can_colonize: false, semi_major_axis_au: 2.5 },
        { position: 2, name: 'Preview Two', planet_class: 'rocky', can_colonize: true, semi_major_axis_au: 1.0,
          ring_system: { inner_radius_planet_r: 1.5, outer_radius_planet_r: 3.2,
            optical_depth: 0.6, tilt_deg: 12, composition: 'water_ice' } },
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
  expect(previewState.sceneGraph.children[0].children.find((node) =>
    node.type === 'planet' && node.data.position === 2).data.ring_system).toMatchObject({
    inner_radius_planet_r: 1.5,
    outer_radius_planet_r: 3.2,
    composition: 'water_ice',
  });
  expect(await page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.spatialLabelStars.length)).toBe(1);
  expect(await page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer.destinations.slice(0, 3)))
    .toEqual([{ kind: 'system' }, { kind: 'star' }, { kind: 'planet', position: 2 }]);
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

test('login expands inline below its button on desktop and narrow screens', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.locator('#start-login').click();
  const panel = page.locator('#start-auth-dialog');
  await expect(panel).toBeVisible();
  await expect(page.locator('#start-login')).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toHaveCSS('animation-name', 'start-dialog-arrival');
  const buttonBox = await page.locator('#start-login').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(panelBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
  expect(Math.abs(panelBox.x - buttonBox.x)).toBeLessThan(2);
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

test('menu panels expand inline, toggle and switch without leaving multiple panels open', async ({ page }) => {
  await mockApi(page);
  await page.route(apiAction('auth', 'dev_tools_status'), (route) =>
    route.fulfill({ json: { success: true, enabled: true } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  for (const selector of ['[data-start-panel="news"]', '[data-start-panel="settings"]', '#start-dev']) {
    const trigger = page.locator(selector);
    await trigger.click();
    const panel = page.locator('dialog[open]');
    await expect(panel, `open panel for ${selector}`).toHaveCount(1);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await panel.evaluate((element) => element.matches(':modal'))).toBe(false);
    await expect.poll(async () => {
      const buttonBox = await trigger.boundingBox();
      const panelBox = await panel.boundingBox();
      return panelBox.y >= buttonBox.y + buttonBox.height && Math.abs(panelBox.x - buttonBox.x) < 2;
    }).toBe(true);
  }
  await page.locator('#start-dev').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['[data-start-panel="news"]', '[data-start-panel="settings"]', '#start-dev']) {
    const trigger = page.locator(selector);
    await trigger.click();
    const panel = page.locator('dialog[open]');
    await expect.poll(async () => {
      const buttonBox = await trigger.boundingBox();
      const panelBox = await panel.boundingBox();
      return panelBox.y >= buttonBox.y + buttonBox.height && panelBox.x + panelBox.width <= 390;
    }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`accordion triggers switch exclusively and expose their active panel at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await mockApi(page);
    await page.route(apiAction('auth', 'dev_tools_status'), (route) =>
      route.fulfill({ json: { success: true, enabled: true } }));
    await page.setViewportSize(viewport);
    await page.goto('/');
    const selectors = ['#start-login', '#start-dev', '[data-start-panel="news"]', '[data-start-panel="settings"]'];
    for (const selector of selectors) {
      for (const nextSelector of selectors.filter(value => value !== selector)) {
        const trigger = page.locator(selector);
        const next = page.locator(nextSelector);
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'true');
        const panel = page.locator('dialog[open]');
        await expect(panel).toHaveCount(1);
        await expect(trigger).toHaveAttribute('aria-controls', await panel.getAttribute('id'));
        await next.click();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).not.toHaveAttribute('aria-controls');
        await expect(next).toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toHaveCount(1);
        await expect(next).toHaveAttribute('aria-controls', await panel.getAttribute('id'));
        await page.keyboard.press('Escape');
        await expect(next).toBeFocused();
        await expect(next).toHaveAttribute('aria-expanded', 'false');
        await expect(next).not.toHaveAttribute('aria-controls');
        await expect(panel).toHaveCount(0);
      }
    }
  });
}

test('new server messages appear once, can be reopened and do not gate login', async ({ page }) => {
  await mockApi(page);
  await page.route(apiAction('server_announcements', 'list'), (route) => route.fulfill({
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
