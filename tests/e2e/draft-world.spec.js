const { test, expect } = require('@playwright/test');
const content = require('../../config/onboarding_prologue.json');
const config = require('../../config/galaxy_config.json');

async function installDraftApi(page) {
  const species = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen'];
  const candidates = species.map((code, index) => ({
    prolog_token: String(index + 1).repeat(64), mentor_code: code, species_code: code,
    colony_name: 'Private Colony', system_name: 'Private System', expires_at: '2099-01-01T00:00:00Z',
    position: { galaxy: 1, system: 2, position: 2 },
    target: { galaxy_index: 1, system_index: 2, position: 2, x_ly: 400, y_ly: 200, z_ly: 0 },
    stars: [],
    planets: [1, 2, 3].map((position) => ({ position, name: `Private ${position}`, class: 'rocky', can_colonize: true,
      diameter_km: 12000, semi_major_axis_au: position })),
    starter: config.starter_homeworld,
  }));
  let selected = candidates[1];
  let playable = null;
  let authenticated = false;
  const orders = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : {};
    let result = { success: true };
    if (url.pathname.endsWith('/registration_narration.php')) {
      await route.fulfill({ status: 503, json: { success: false, error: 'Speech unavailable in UI test.' } });
      return;
    }
    if (url.pathname.endsWith('/registration_play.php')) {
      if (action === 'status') result.draft = playable;
      if (action === 'enter') {
        playable = {
          draft_mode: true, expires_at: null, world: selected, email: null, confirmation_pending: false,
          state: {
            economy: { stock: { metal: 2500, crystal: 1500, deuterium: 800, food: 900 }, classes: { colonist: 1500 }, satisfaction: 78, pending_seconds: 0 },
            buildings: { metal_mine: 2 }, research: { energy_tech: 0 }, ships: { espionage_probe: 2 }, queues: {}, surveyed: [],
          },
          building_options: [{ type: 'metal_mine', label: 'Metal Mine', cost: { metal: 135, crystal: 34 } }],
          research_options: [{ type: 'energy_tech', cost: { crystal: 800, deuterium: 400 } }],
          ship_options: [{ type: 'espionage_probe', cost: { crystal: 1000 } }],
        };
        result.draft = playable;
      }
      if (action === 'play') {
        orders.push(body);
        if (body.kind === 'building') {
          playable.state.economy.stock.metal -= 135;
          playable.state.queues.building = { type: body.type, level: 3, start: 1000, end: 9999999999 };
        }
        result.draft = playable;
      }
      if (action === 'send_confirmation') {
        playable.email = body.email;
        result.sent = true;
      }
      if (action === 'confirm') {
        if (body.token !== 'b'.repeat(64)) {
          await route.fulfill({ status: 410, json: { success: false, error: 'Confirmation link invalid or expired.' } });
          return;
        }
        authenticated = true;
        playable = null;
        result = { success: true, draft_mode: false, user: { id: 123, username: 'DraftCommander' }, colony_id: 42 };
      }
    } else if (action === 'csrf') result.token = 'draft-e2e-csrf';
    else if (action === 'me') result = { success: true, authenticated, user: authenticated ? { id: 123, username: 'DraftCommander' } : null };
    else if (action === 'overview') result = { success: true, colonies: [], fleets: [], user_meta: { dark_matter: 0 } };
    else if (action === 'register_catalog') result = { success: true, factions: content.factions, species: species.map((code, index) => {
      const target = { galaxy_index: 1, system_index: index + 100, position: 2, x_ly: -400 - index * 100, y_ly: 0, z_ly: 0 };
      return { code, name: code, description: 'Homeworld origin', homeworld: `${code} home`, target, stars: [target],
        homeworld_scene: { scene_key: `homeworld:${index}`, target, system_name: `${code} home system`,
          position: { galaxy: 1, system: index + 100, position: 2 }, star: { temperature_k: 5500, radius_solar: 1 },
          planets: [{ position: 2, diameter_km: 12000, semi_major_axis_au: 1, inhabited: true }],
        },
      };
    }) };
    else if (action === 'register_mentor_drafts') result.drafts = candidates;
    else if (action === 'register_select_mentor') { selected = candidates.find((entry) => entry.mentor_code === body.mentor_code); result.draft = selected; }
    else if (action === 'register_profile') result.draft = selected;
    else if (action === 'register_character') { selected.character = { name: body.name, background: body.background }; result.draft = selected; }
    else if (action === 'register_portrait_status') result.portrait = { status: 'not_generated', image_url: null, attempts_remaining: 3, retry_after: 0 };
    else if (action === 'list') result.tracks = [];
    else if (action === 'list_sfx') result.sfx = [];
    else if (action === 'auth_stars') result.stars = [];
    else if (action === 'dev_tools_status') result.enabled = false;
    else if (url.pathname.endsWith('/server_announcements.php')) result.announcements = [];
    await route.fulfill({ json: result });
  });
  return { orders };
}

async function registerIntoDraft(page) {
  await page.goto('/');
  await page.locator('#start-register').click();
  await page.locator('#registration-opening-skip').click();
  await expect(page.locator('#registration-title')).toHaveText('aereth home');
  await page.locator('#registration-opening-skip').click();
  await page.locator('[data-choice="vor_tak"]').click();
  await page.locator('#registration-continue').click();
  await page.locator('#registration-name').fill('DraftCommander');
  await page.locator('#registration-background').fill('Private frontier explorer');
  await page.locator('#registration-character-form button').click();
  await expect(page.locator('#registration-continue')).toHaveText('Shuttle starten');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'journey');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-continue')).toHaveText('Bestätigen und landen', { timeout: 30000 });
  await page.locator('#registration-continue').click();
  await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'landing');
  await page.locator('#registration-continue').click();
  await expect(page.locator('#draft-world')).toBeVisible();
  await expect(page.locator('#registration-prologue')).toBeHidden();
}

test('registration enters a playable persistent draft, not the start menu or shared galaxy', async ({ page }) => {
  const { orders } = await installDraftApi(page);
  await registerIntoDraft(page);
  await expect(page.locator('body')).toHaveClass(/draft-playing/);
  await expect(page.locator('#draft-location')).toContainText('Kein Ablaufdatum');
  await page.locator('#draft-building-form button').click();
  await expect(page.locator('#draft-resources')).toContainText('metal: 2365');
  await expect(page.locator('#draft-queues')).toContainText('metal mine');
  expect(orders).toContainEqual({ kind: 'building', type: 'metal_mine' });
  await page.reload();
  await expect(page.locator('#draft-world')).toBeVisible();
  await expect(page.locator('#draft-resources')).toContainText('metal: 2365');
  await page.locator('#draft-leave').click();
  await expect(page.locator('#start-resume')).toBeVisible();
  await page.locator('#start-resume').click();
  await expect(page.locator('#draft-world')).toBeVisible();
  expect(await page.evaluate(() => !!window.GQGame?.domains?.economy)).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('only confirmed email hands the draft over to the existing shared game shell', async ({ page }) => {
  await installDraftApi(page);
  await registerIntoDraft(page);
  await page.locator('#draft-registration summary').click();
  await page.locator('#draft-email').fill('draft@example.test');
  await page.locator('#draft-password').fill('test-only-long-password');
  await page.locator('#draft-email-form button').click();
  await expect(page.locator('#draft-mail-status')).toContainText('Bestätigung versendet');
  await expect(page.locator('body')).not.toHaveClass(/game-page/);
  await expect(page.locator('#draft-code')).toHaveCount(0);
  await page.goto('/#registration-confirm=' + 'a'.repeat(64));
  await expect(page.locator('#draft-error')).toContainText('Confirmation link invalid');
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('#draft-world')).toBeVisible();
  await page.goto('/?email-link=1#registration-confirm=' + 'b'.repeat(64));
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await expect(page.locator('#draft-world')).toBeHidden();
  expect(new URL(page.url()).hash).toBe('');
});

test('email link confirms in a fresh browser without a draft-owner cookie', async ({ page }) => {
  await installDraftApi(page);
  expect(await page.context().cookies()).toEqual([]);
  await page.goto('/#registration-confirm=' + 'b'.repeat(64));
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await expect(page.locator('#draft-world')).toBeHidden();
  expect(new URL(page.url()).hash).toBe('');
});
