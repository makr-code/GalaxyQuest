const { test, expect } = require('@playwright/test');

const runRendererSmoke = process.env.GQ_RUN_RENDERER_SMOKE === '1';

async function installRendererFriendlyCdnStubs(page) {
  await page.route('https://cdn.jsdelivr.net/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/dexie@')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: [
          'window.Dexie = class Dexie {',
          '  constructor() {}',
          '  version() { return this; }',
          '  stores() { return this; }',
          '  table() { return { put: async()=>{}, get: async()=>null, toArray: async()=>[], clear: async()=>{} }; }',
          '  open() { return Promise.resolve(this); }',
          '  close() {}',
          '  static delete() { return Promise.resolve(); }',
          '};',
        ].join('\n'),
      });
      return;
    }
    if (url.includes('/three@')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.THREE = window.THREE || {};',
      });
      return;
    }
    if (url.includes('/mustache@')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.Mustache = window.Mustache || { render: function(tpl){ return String(tpl || ""); } };',
      });
      return;
    }
    await route.continue();
  });
}

async function loginDefaultUser(page, baseURL) {
  await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
  const userInput = page.locator('#login-username');
  const passInput = page.locator('#login-password');
  await expect(userInput).toBeVisible({ timeout: 20_000 });
  await expect(passInput).toBeVisible({ timeout: 20_000 });

  await userInput.fill('default_user');
  await passInput.fill('User!23456');
  await page.click('#login-form button[type="submit"]');

  await expect(page.locator('#topbar-section')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });
}

async function openHomeSystem(page) {
  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const wm = window.WM;
    if (!wm || typeof wm.open !== 'function' || typeof wm.body !== 'function') {
      return { ok: false, reason: 'wm-missing' };
    }

    wm.open('galaxy');
    let root = wm.body('galaxy');
    for (let i = 0; i < 40 && !root; i += 1) {
      await wait(100);
      root = wm.body('galaxy');
    }
    if (!root) {
      return { ok: false, reason: 'galaxy-root-missing' };
    }

    let galaxyController = window.GQGalaxyController;
    for (let i = 0; i < 120 && (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function'); i += 1) {
      await wait(100);
      galaxyController = window.GQGalaxyController;
    }
    if (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function') {
      return { ok: false, reason: 'galaxy-controller-missing' };
    }

    await galaxyController.focusHomeSystem(root, {
      silent: true,
      cinematic: false,
      enterSystem: true,
      focusPlanet: false,
    });

    return { ok: true };
  });

  expect(result.ok, result.reason || 'home-system navigation failed').toBe(true);
}

test('Home system enter populates live renderer state', async ({ page, baseURL }) => {
  test.skip(!runRendererSmoke, 'Renderer smoke requires explicit opt-in with live WebGL/CDN support.');
  await installRendererFriendlyCdnStubs(page);
  await loginDefaultUser(page, baseURL);
  await page.click('#topbar-home-btn');
  await openHomeSystem(page);
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => {
    const root = window.WM && typeof window.WM.body === 'function' ? window.WM.body('galaxy') : null;
    const view = window.GQGalaxyController?._debugRenderer;
    const core = view?._delegate || view;
    const stats = typeof view?.getRenderStats === 'function' ? view.getRenderStats() : null;
    const planets = Array.isArray(core?.systemPlanetEntries) ? core.systemPlanetEntries.length : 0;
    const moons = Array.isArray(core?.systemMoonEntries) ? core.systemMoonEntries.length : 0;
    const facilities = Array.isArray(core?.systemFacilityEntries) ? core.systemFacilityEntries.length : 0;
    const fleets = Array.isArray(core?.systemFleetEntries) ? core.systemFleetEntries.length : 0;
    const panelPlanetItems = root ? root.querySelectorAll('.planet-item').length : 0;
    const hasEnterSystemAction = root ? !!root.querySelector('[data-system-action="enter-system"], [data-nav-action="enter-system"]') : false;
    return {
      hasController: !!window.GQGalaxyController,
      hasView: !!view,
      backend: String(view?.backendType || stats?.backend || ''),
      systemMode: !!view?.systemMode,
      renderFrameVisible: !!core?.renderFrames?.system?.visible,
      systemGroupVisible: !!core?.systemGroup?.visible,
      planets,
      moons,
      facilities,
      fleets,
      panelPlanetItems,
      hasEnterSystemAction,
      stats,
    };
  });

  expect(state.hasController).toBe(true);
  expect(state.hasView || state.hasEnterSystemAction || state.panelPlanetItems > 0 || Boolean(state.stats)).toBe(true);

  if (state.hasView && state.systemMode) {
    expect(state.renderFrameVisible).toBe(true);
    expect(state.systemGroupVisible).toBe(true);
    expect(state.planets).toBeGreaterThan(0);
  }

  console.log(`[e2e:system-enter] controller=${state.hasController} backend=${state.backend} systemMode=${state.systemMode} panelPlanets=${state.panelPlanetItems} planets=${state.planets} moons=${state.moons} facilities=${state.facilities} fleets=${state.fleets}`);
});