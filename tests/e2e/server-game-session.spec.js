const { test, expect } = require('@playwright/test');

function fleetMission() {
  return { id: 7, mission: 'transport', origin_colony_id: 1,
    origin_galaxy: 1, origin_system: 10, origin_position: 3,
    target_galaxy: 2, target_system: 20, target_position: 4,
    fleet_label: 'Cargo Seven', target_system_name: 'Star 20', ships: { small_cargo: 2 },
    cargo_metal: 100, cargo_crystal: 0, cargo_deuterium: 0, returning: 0,
    departure_time: '2000-01-01 10:00:00', arrival_time: '2000-01-01 11:00:00' };
}

async function mockSession(page, { failBoot = false, audioTracks = [], fleetMissions = [], transitType = 'aereth' } = {}) {
  let requests = 0;
  let failRefresh = false;
  let expired = false;
  const commands = [];
  let metal = 2365.4;
  let buildingQueued = false;
  let buildingLevel = 2;
  let researching = false;
  let researchLevel = 0;
  let rejectCommand = false;
  let policy = 'free_market';
  const taxes = { income: 0.15, production: 0, trade: 0.05 };
  const subsidies = { agriculture: false, research: false, military: false };
  let method = 'standard';
  let galaxyFailed = false;
  let surfaceFailed = false;
  let missions = structuredClone(fleetMissions);
  let fleetListFailed = false;
  let shipCount = 4;
  let blueprintCount = 1;
  let shipQueue = [];
  let marketFailed = false;
  const transactions = [];
  const processedStock = { consumer_goods: 0 };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const action = url.searchParams.get('action');
    if (url.pathname.endsWith('/market.php')) {
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
      } else if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        commands.push({ kind: 'market', action, body, csrf: route.request().headers()['x-csrf-token'] });
        if (rejectCommand) {
          await route.fulfill({ status: 409, json: { success: false, error: 'Autarky blocks imports' } });
          return;
        }
        const change = action === 'buy' ? body.quantity : -body.quantity;
        if (body.good_type === 'metal') metal += change;
        else processedStock[body.good_type] = (processedStock[body.good_type] || 0) + change;
        transactions.unshift({ id: transactions.length + 1, colony_id: body.colony_id, good_type: body.good_type,
          direction: action, quantity: body.quantity, price_per_unit: 10, total_credits: body.quantity * 10,
          trade_tax_rate: 0.05, net_credits: body.quantity * 10, transacted_at: '2026-11-03 12:00:00' });
        await route.fulfill({ json: { success: true } });
      } else if (marketFailed) {
        await route.fulfill({ status: 503, json: { success: false, error: 'Market unavailable' } });
      } else {
        await route.fulfill({ json: action === 'get_prices' ? { success: true, prices: [
          { good_type: 'metal', price: 10, base_price: 10, supply: 100, demand: 100 },
          { good_type: 'food', price: 8, base_price: 8, supply: 20, demand: 10 },
          { good_type: 'consumer_goods', price: 80, base_price: 80, supply: 20, demand: 30 },
        ] } : { success: true, transactions } });
      }
      return;
    }
    if (url.pathname.endsWith('/shipyard.php')) {
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
      } else if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        commands.push({ kind: 'shipyard', action, body, csrf: route.request().headers()['x-csrf-token'] });
        if (rejectCommand) {
          await route.fulfill({ status: 409, json: { success: false, error: 'Shipyard required by server' } });
          return;
        }
        if (action === 'build') {
          metal -= 100;
          shipQueue.push({ id: 100 + shipQueue.length, ship_type: body.type,
            label: body.type === 'bp_7' ? 'Blueprint Scout' : 'small cargo',
            quantity: body.count, position: shipQueue.length + 1,
            status: shipQueue.length ? 'queued' : 'running', eta: '2000-01-01 11:00:00' });
        } else if (action === 'finish') {
          for (const order of shipQueue) {
            if (order.ship_type === 'bp_7') blueprintCount += order.quantity;
            else shipCount += order.quantity;
          }
          shipQueue = [];
        }
        await route.fulfill({ json: { success: true } });
      } else {
        await route.fulfill({ json: { success: true,
          ships: [{ type: 'small_cargo', count: shipCount, cost: { metal: 2000, crystal: 2000, deuterium: 0 } }],
          blueprints: [{ id: 7, type: 'bp_7', name: 'Blueprint Scout', count: blueprintCount, cost: { metal: 100 } }],
          queue: shipQueue } });
      }
      return;
    }
    if (url.pathname.endsWith('/fleet.php')) {
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
        return;
      }
      if (action === 'ftl_status') {
        await route.fulfill({ json: { success: true, ftl_drive_type: transitType,
          ftl_ready: true, ftl_cooldown_remaining_s: 0, gates: [], resonance_nodes: [] } });
        return;
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        commands.push({ kind: 'fleet', action, body, csrf: route.request().headers()['x-csrf-token'] });
        if (rejectCommand) {
          await route.fulfill({ status: 409, json: { success: false, error: 'Recall rejected by server' } });
          return;
        }
        if (action === 'send') {
          shipCount -= Number(body.ships.small_cargo || 0);
          missions.push({ ...fleetMission(), id: 8, origin_colony_id: body.origin_colony_id,
            mission: body.mission, target_galaxy: body.target_galaxy, target_system: body.target_system,
            target_position: body.target_position, ships: body.ships, cargo_metal: body.cargo.metal,
            cargo_crystal: body.cargo.crystal, cargo_deuterium: body.cargo.deuterium });
        } else missions = action === 'recall'
          ? missions.map((fleet) => fleet.id === body.fleet_id ? { ...fleet, returning: 1 } : fleet) : [];
        await route.fulfill({ json: { success: true } });
      } else if (fleetListFailed) {
        await route.fulfill({ status: 503, json: { success: false, error: 'Fleet list unavailable' } });
      } else await route.fulfill({ json: { success: true, fleets: missions } });
      return;
    }
    if (url.pathname.endsWith('/terrain.php')) {
      await route.fulfill({ status: 503, json: { success: false, error: 'Terrain unavailable in this fixture' } });
      return;
    }
    if (url.pathname.endsWith('/galaxy.php') && ['stars', 'system'].includes(action)) {
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
        return;
      }
      if (galaxyFailed) {
        await route.fulfill({ status: 503, json: { success: false, error: 'Galaxy temporarily unavailable' } });
        return;
      }
      const galaxy = Number(url.searchParams.get('galaxy'));
      const system = Number(url.searchParams.get('system') || (galaxy === 1 ? 10 : 20));
      const star = { galaxy_index: galaxy, system_index: system, name: `Star ${system}`,
        x_ly: galaxy * 200, y_ly: 400, z_ly: 0, radius_solar: 1, spectral_class: 'G' };
      await route.fulfill({ json: action === 'stars' ? { success: true, galaxy, stars: [star] } : {
        success: true, galaxy, system, star_system: star, server_ts_ms: system,
        visibility: { level: 'own' }, planets: [
          { position: galaxy === 1 ? 3 : 4, player_planet: {
            id: galaxy === 1 ? 1 : 2, position: galaxy === 1 ? 3 : 4,
            name: 'Owned planet', semi_major_axis_au: 1, diameter_km: 12000,
          } },
          { position: 5, generated_planet: { position: 5, name: 'Uncolonized planet',
            semi_major_axis_au: 2, diameter_km: 18000 } },
        ],
      } });
      return;
    }
    const economy = /\/(colony_economy|economy)\.php$/.exec(url.pathname)?.[1];
    if (economy) {
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
        return;
      }
      if (economy === 'colony_economy' && action === 'snapshot' && surfaceFailed) {
        await route.fulfill({ status: 503, json: { success: false, error: 'Surface snapshot unavailable' } });
        return;
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        commands.push({ kind: economy, action, body, csrf: route.request().headers()['x-csrf-token'] });
        if (rejectCommand) {
          await route.fulfill({ status: 409, json: { success: false, error: 'Research required for this method' } });
          return;
        }
        if (action === 'set_policy') policy = body.policy;
        if (action === 'set_tax') taxes[body.type] = body.rate;
        if (action === 'set_subsidy') subsidies[body.sector] = body.enabled;
        if (action === 'set_method') method = body.method;
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({ json: economy === 'economy' ? {
        success: true, global_policy: policy, taxes, subsidies,
        tax_steps: { income: 0.01, production: 0.01, trade: 0.01 },
      } : {
        success: true, colony: { id: Number(url.searchParams.get('colony_id')), energy: -5, max_population: 5000 },
        economy: { settled_at: 1700000000, pending_seconds: 300, satisfaction: 70,
          employment: 0.8, population_growth_per_hour: -1,
          stock: { metal, food: 123, ...processedStock }, production: { metal: 20 }, consumption: { food: 2 },
          shortages: { consumer_goods: 3 } },
        storage: { metal: 10000, food: 1000 }, pop_classes: { colonist: 100 },
        methods: { metallurgy: method }, buildings: [{ type: 'metallurgy', level: 1 }],
        catalog: { metallurgy: { label: 'Metallurgy', good: 'steel_alloy', research: 'energy_tech', inputs: { metal: 2 } } },
      } });
      return;
    }
    const development = /\/(buildings|research)\.php$/.exec(url.pathname)?.[1];
    if (development) {
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
        return;
      }
      if (route.request().method() === 'POST') {
        commands.push({ kind: development, action, body: route.request().postDataJSON(),
          csrf: route.request().headers()['x-csrf-token'] });
        if (rejectCommand) {
          await route.fulfill({ status: 409, json: { success: false, error: 'Server rejected this order' } });
          return;
        }
        if (action === 'upgrade') { buildingQueued = true; metal -= 135; }
        if (action === 'research') { researching = true; metal -= 100; }
        if (action === 'finish' && development === 'buildings') { buildingLevel = 3; buildingQueued = false; }
        if (action === 'finish' && development === 'research') { researchLevel = 1; researching = false; }
        await route.fulfill({ json: { success: true } });
        return;
      }
      await route.fulfill({ json: development === 'buildings' ? {
        success: true, buildings: [
          { type: 'metal_mine', level: buildingLevel, next_cost: { metal: 135 }, meta: { label: 'Metal mine' },
            upgrade_end: buildingQueued ? '2000-01-01 10:00:00' : null },
        ], upgrade_queue: buildingQueued ? [
          { type: 'metal_mine', target_level: 3, status: 'running', eta: '2000-01-01 10:00:00' },
        ] : [],
      } : {
        success: true, research: [
          { type: 'energy_tech', level: researchLevel, next_cost: { metal: 100 }, can_research: true,
            research_end: researching ? '2000-01-01 10:00:00' : null, missing_prereqs: [] },
          { type: 'laser_tech', level: 0, next_cost: {}, can_research: false,
            missing_prereqs: [{ tech: 'energy_tech', required_level: 1, current_level: 0 }] },
        ],
      } });
      return;
    }
    let data = { success: true };
    if (action === 'me') data.user = { id: 42, username: 'ServerCommander' };
    if (action === 'csrf') data.token = 'session-test';
    if (action === 'overview') {
      requests++;
      if (expired) {
        await route.fulfill({ status: 401, json: { success: false, error: 'Session expired' } });
        return;
      }
      if (failBoot || failRefresh) {
        await route.fulfill({ json: { success: false, error: 'Overview unavailable' } });
        return;
      }
      data = {
        success: true, user_meta: { dark_matter: 15 }, fleets: [],
        colonies: [
          { id: 1, name: 'Home', galaxy: 1, system: 10, position: 3, metal: String(metal), energy: -5, population: 1500 },
          { id: 2, name: 'Frontier', galaxy: 2, system: 20, position: 4, metal: 700, energy: 0 },
        ],
      };
    }
    if (action === 'auth_stars') data.stars = [];
    if (action === 'list' || action === 'list_sfx') { data.tracks = audioTracks; data.sfx = []; }
    if (url.pathname.endsWith('/server_announcements.php')) data.announcements = [];
    await route.fulfill({ json: data });
  });
  return {
    requests: () => requests,
    failRefresh: () => { failRefresh = true; },
    expire: () => { expired = true; },
    recover: () => { failBoot = false; failRefresh = false; },
    commands,
    rejectCommand: () => { rejectCommand = true; },
    allowCommands: () => { rejectCommand = false; },
    failGalaxy: () => { galaxyFailed = true; },
    recoverGalaxy: () => { galaxyFailed = false; },
    failSurface: () => { surfaceFailed = true; },
    recoverSurface: () => { surfaceFailed = false; },
    failFleetList: () => { fleetListFailed = true; },
    recoverFleetList: () => { fleetListFailed = false; },
    failMarket: () => { marketFailed = true; },
    recoverMarket: () => { marketFailed = false; },
  };
}

async function openCommand(page) {
  const toggle = page.locator('#game-command-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

async function openNavigation(page) {
  const navigation = page.locator('#game-galaxy-navigation');
  if (!await navigation.evaluate((element) => element.open)) await navigation.locator('summary').first().click();
}

test('galaxy fills the viewport while persistent UI stays minimal and panels are overlays', async ({ page }) => {
  await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await expect(page.locator('#game-command-overlay')).toBeHidden();
  await expect(page.locator('#resource-section')).toBeHidden();
  await expect(page.locator('#taskbar-section')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Heimatsystem', exact: true })).toBeHidden();
  await expect(page.locator('#game-galaxy-navigation > summary')).toHaveText('Karte & Koordinaten');
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const geometry = () => page.evaluate(() => {
      const rect = document.getElementById('starfield').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    await expect.poll(geometry).toEqual({ x: 0, y: 0, ...viewport, overflow: false });
    await openCommand(page);
    await expect(page.locator('#resource-section')).toBeVisible();
    await expect(page.locator('[data-game-development="buildings"]')).toBeVisible();
    const sections = await page.evaluate(() => ({
      topbar: document.querySelector('#game-command-overlay .topbar').getBoundingClientRect().toJSON(),
      resources: document.getElementById('resource-section').getBoundingClientRect().toJSON(),
    }));
    expect(sections.resources.top).toBeGreaterThanOrEqual(sections.topbar.bottom);
    expect(await geometry()).toEqual({ x: 0, y: 0, ...viewport, overflow: false });
    await page.getByRole('button', { name: 'Kommandomenü schließen' }).click();
    await expect(page.locator('#resource-section')).toBeHidden();
    await openNavigation(page);
    await expect(page.getByRole('button', { name: 'Heimatsystem', exact: true })).toBeVisible();
    await expect(page.getByLabel('Galaxie', { exact: true })).toBeVisible();
    await expect(page.getByLabel('System', { exact: true })).toBeVisible();
    expect(await geometry()).toEqual({ x: 0, y: 0, ...viewport, overflow: false });
    await page.locator('#game-galaxy-navigation > summary').click();
    await page.locator('#topbar-player-menu-toggle').click();
    await expect(page.locator('#topbar-player-menu')).toBeVisible();
    const audioBounds = await page.locator('#topbar-player-menu').boundingBox();
    expect(audioBounds.x).toBeGreaterThanOrEqual(0);
    expect(audioBounds.y).toBeGreaterThanOrEqual(0);
    expect(audioBounds.x + audioBounds.width).toBeLessThanOrEqual(viewport.width);
    expect(audioBounds.y + audioBounds.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
  }
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`window navigation focuses and restores existing drafts without reads: ${viewport.width}`, async ({ page }) => {
    const api = await mockSession(page);
    const reads = [];
    page.on('request', (request) => {
      if (request.method() === 'GET' && /\/api\//.test(request.url())) reads.push(request.url());
    });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('#start-resume').click();
    await openCommand(page);
    await page.locator('[data-game-shipyard]').click();
    const shipyard = page.locator('[data-domain="shipyard"]');
    await shipyard.getByRole('spinbutton', { name: 'Baumenge small cargo', exact: true }).fill('7');
    await openCommand(page);
    await page.locator('[data-game-market]').click();
    const market = page.locator('[data-domain="market"]');
    await market.getByRole('spinbutton').fill('3.25');
    await expect.poll(() => page.evaluate(() => ['market', 'shipyard'].every((name) =>
      !window.GQGame.domains[name].getState().loading))).toBe(true);
    await page.evaluate(() => {
      window.__navigationCanvas = document.getElementById('starfield');
      window.__navigationMarket = document.querySelector('[data-domain="market"] input');
      window.__navigationShipyard = document.querySelector('[data-domain="shipyard"] input');
    });
    const before = reads.length;
    await openCommand(page);
    const shipTask = page.locator('#wm-task-shipyard');
    const marketTask = page.locator('#wm-task-trade');
    await expect(shipTask).toHaveAttribute('aria-pressed', 'false');
    await expect(marketTask).toHaveAttribute('aria-pressed', 'true');
    await shipTask.press('Enter');
    await expect(page.locator('#wm-win-shipyard')).toHaveClass(/wm-focused/);
    await expect(page.locator('#wm-win-shipyard .wm-title')).toBeFocused();
    await expect(page.locator('#game-command-overlay')).toBeHidden();
    await expect(shipyard).toBeVisible();
    await expect(market).toBeVisible();
    await expect(shipTask).toHaveAttribute('aria-pressed', 'true');
    await expect(marketTask).toHaveAttribute('aria-pressed', 'false');
    await openCommand(page);
    await marketTask.click();
    await expect(page.locator('#wm-win-trade .wm-title')).toBeFocused();
    await expect(page.locator('#wm-win-trade')).toHaveClass(/wm-focused/);
    await openCommand(page);
    await marketTask.press('Enter');
    await expect(market).toBeHidden();
    await expect(page.locator('#game-command-toggle')).toBeFocused();
    await expect(marketTask).toHaveAttribute('aria-pressed', 'false');
    await openCommand(page);
    await marketTask.press('Enter');
    await expect(market).toBeVisible();
    await expect(page.locator('#wm-win-trade .wm-title')).toBeFocused();
    await expect(market.getByRole('spinbutton')).toHaveValue('3.25');
    await expect(shipyard.getByRole('spinbutton', { name: 'Baumenge small cargo', exact: true })).toHaveValue('7');
    expect(await page.evaluate(() => window.__navigationCanvas === document.getElementById('starfield')
      && window.__navigationMarket === document.querySelector('[data-domain="market"] input')
      && window.__navigationShipyard === document.querySelector('[data-domain="shipyard"] input'))).toBe(true);
    expect(reads).toHaveLength(before);
    expect(api.commands).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('mobile canvas return preserves window drafts, stack and shared canvas without refetching', async ({ page }) => {
  const api = await mockSession(page);
  const reads = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && /\/api\/(market|shipyard|colony_economy|game)\.php/.test(request.url())) reads.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  const field = page.locator('#game-field-toggle');
  await expect(field).toBeHidden();
  await openCommand(page);
  await page.locator('[data-game-development="research"]').click();
  await expect(page.locator('[data-domain="research"]')).toContainText('energy tech');
  await page.locator('#wm-host-research .wm-btn-min').click();
  await expect(field).toBeHidden();
  await openCommand(page);
  await page.locator('[data-game-fleet-launch]').click();
  const fleet = page.getByRole('region', { name: 'Flottensteuerung', exact: true });
  await fleet.getByRole('button', { name: 'Ziel im Spielfeld wählen', exact: true }).click();
  await expect(page.locator('#wm-galaxy-section')).toHaveClass(/fleet-target-picking/);
  await expect(field).toBeHidden();
  await openCommand(page);
  await page.locator('[data-game-shipyard]').click();
  const shipyard = page.locator('[data-domain="shipyard"]');
  await shipyard.getByRole('spinbutton', { name: 'Baumenge small cargo', exact: true }).fill('7');
  await openCommand(page);
  await page.locator('[data-game-market]').click();
  const market = page.locator('[data-domain="market"]');
  await market.getByRole('spinbutton', { name: 'Handelsmenge', exact: true }).fill('3.25');
  await expect.poll(() => page.evaluate(() => ['market', 'shipyard'].every((name) =>
    !window.GQGame.domains[name].getState().loading))).toBe(true);
  await page.evaluate(() => {
    window.__returnCanvas = document.getElementById('starfield');
    window.__returnMarketInput = document.querySelector('[data-domain="market"] input');
    window.__returnRenderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
  });
  const before = reads.length;
  await field.press('Enter');
  await expect(market).toBeHidden();
  await expect(shipyard).toBeHidden();
  await expect(page.locator('#wm-win-research')).toHaveClass(/wm-minimized/);
  await expect(field).toHaveText('Fenster (2)');
  await expect(field).toBeFocused();
  await expect(page.locator('#starfield')).toBeVisible();
  await expect(fleet).toBeVisible();
  await expect(page.locator('#wm-galaxy-section')).toHaveClass(/fleet-target-picking/);
  await field.press('Enter');
  await expect(market).toBeVisible();
  await expect(shipyard).toBeVisible();
  await expect(page.locator('#wm-win-trade')).toHaveClass(/wm-focused/);
  await expect(page.locator('#wm-win-research')).toHaveClass(/wm-minimized/);
  await expect(market.getByRole('spinbutton')).toHaveValue('3.25');
  await expect(shipyard.getByRole('spinbutton', { name: 'Baumenge small cargo', exact: true })).toHaveValue('7');
  expect(reads).toHaveLength(before);
  expect(api.commands).toHaveLength(0);
  await expect(page.locator('#wm-galaxy-section')).toHaveClass(/fleet-target-picking/);
  expect(await page.evaluate(() => window.__returnCanvas === document.getElementById('starfield')
    && window.__returnRenderer === window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer
    && window.__returnMarketInput === document.querySelector('[data-domain="market"] input'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await field.click();
  await openCommand(page);
  await page.locator('#wm-task-trade').click();
  await expect(market).toBeVisible();
  await expect(field).toHaveText('Spielfeld');
  await page.locator('#wm-host-trade .wm-btn-close').click();
  await expect(field).toHaveText('Fenster (1)');
  await field.click();
  await expect(shipyard).toBeVisible();
  await expect(market).toHaveCount(0);
});

test('window selection does not cancel or repeat a pending trade', async ({ page }) => {
  const api = await mockSession(page);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let pending = false;
  await page.route((url) => url.pathname.endsWith('/market.php') && url.searchParams.get('action') === 'buy', async (route) => {
    pending = true;
    await gate;
    await route.fallback();
  });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-shipyard]').click();
  await expect(page.locator('[data-domain="shipyard"]')).toContainText('small cargo');
  await openCommand(page);
  await page.locator('[data-game-market]').click();
  const market = page.locator('[data-domain="market"]');
  const buy = market.getByRole('button', { name: 'Kaufen', exact: true });
  await market.getByRole('spinbutton').fill('2.5');
  await buy.click();
  await expect.poll(() => pending).toBe(true);
  try {
    await openCommand(page);
    await page.locator('#wm-task-shipyard').press('Enter');
    await expect(page.locator('#wm-win-shipyard .wm-title')).toBeFocused();
    await expect(market).toBeVisible();
    await openCommand(page);
    await page.locator('#wm-task-trade').press('Enter');
    await expect(page.locator('#wm-win-trade .wm-title')).toBeFocused();
    await expect(buy).toBeDisabled();
    expect(api.commands).toHaveLength(0);
  } finally {
    release();
  }
  await expect(market).toContainText('Bestand: 2367.9');
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  expect(api.commands).toEqual([
    { kind: 'market', action: 'buy', body: { colony_id: 1, good_type: 'metal', quantity: 2.5 }, csrf: 'session-test' },
  ]);
});

test('canvas return never cancels or repeats a pending trade and clears the hidden group on expiry', async ({ page }) => {
  const api = await mockSession(page);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let pending = false;
  await page.route((url) => url.pathname.endsWith('/market.php') && url.searchParams.get('action') === 'buy', async (route) => {
    pending = true;
    await gate;
    await route.fallback();
  });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-market]').click();
  const market = page.locator('[data-domain="market"]');
  const field = page.locator('#game-field-toggle');
  await market.getByRole('spinbutton').fill('2.5');
  await market.getByRole('button', { name: 'Kaufen', exact: true }).click();
  await expect.poll(() => pending).toBe(true);
  await expect(market.getByRole('button', { name: 'Kaufen', exact: true })).toBeDisabled();
  await field.click();
  await expect(market).toBeHidden();
  await field.click();
  await expect(market).toBeVisible();
  await expect(market.getByRole('button', { name: 'Kaufen', exact: true })).toBeDisabled();
  expect(api.commands).toHaveLength(0);
  release();
  await expect(market).toContainText('Bestand: 2367.9');
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  expect(api.commands).toEqual([
    { kind: 'market', action: 'buy', body: { colony_id: 1, good_type: 'metal', quantity: 2.5 }, csrf: 'session-test' },
  ]);
  await field.click();
  await expect(field).toHaveText('Fenster (1)');
  api.expire();
  await openCommand(page);
  await page.locator('#topbar-title-btn').click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(field).toHaveCount(0);
  await expect(market).toHaveCount(0);
  expect(api.commands).toHaveLength(1);
});

test('menu and game audio controls share playback, track, pause, volume and mute across login/logout', async ({ page }) => {
  await mockSession(page, { audioTracks: [{ value: 'music/Test_A.mp3' }, { value: 'music/Test_B.mp3' }] });
  await page.addInitScript(() => {
    const playing = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', { get() { return !playing.get(this); } });
    HTMLMediaElement.prototype.play = function () { playing.set(this, true); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { playing.set(this, false); };
    if (!localStorage.getItem('gq_audio_settings')) {
      localStorage.setItem('gq_audio_settings', JSON.stringify({ musicTransitionMode: 'cut' }));
    }
  });
  await page.goto('/');
  await expect(page.locator('#start-music-play')).toBeEnabled();
  await page.locator('#start-music-play').click();
  await expect(page.locator('#start-music-play')).toHaveAttribute('aria-label', 'Musik pausieren');
  await page.evaluate(() => { window.__testAudio = window.__GQ_AUDIO_MANAGER; });
  const track = await page.locator('#start-music-title').textContent();
  await page.locator('#start-resume').click();
  await expect(page.locator('#topbar-player-toggle')).toHaveAttribute('aria-label', 'Musik pausieren');
  expect(await page.evaluate(() => window.__testAudio === window.__GQ_AUDIO_MANAGER)).toBe(true);
  await page.locator('#topbar-player-menu-toggle').click();
  await expect(page.locator('#topbar-player-menu')).toBeVisible();
  await expect(page.locator('#topbar-player-current')).toHaveText(track);
  await expect(page.locator('#topbar-player-track option')).toHaveCount(2);
  await page.locator('#topbar-player-track').selectOption('music/Test_B.mp3');
  await expect(page.locator('#topbar-player-current')).toHaveText('Test B');
  await page.locator('#topbar-player-volume').fill('23');
  await expect(page.locator('#start-music-volume')).toHaveValue('23');
  await page.keyboard.press('Escape');
  await expect(page.locator('#topbar-player-menu')).toBeHidden();
  await page.locator('#audio-toggle-btn').click();
  await expect(page.locator('#audio-toggle-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#topbar-player-toggle').click();
  await expect(page.locator('#topbar-player-toggle')).toHaveAttribute('aria-label', 'Musik starten');
  await openCommand(page);
  await page.locator('#logout-btn').click();
  await expect(page.locator('#start-music-title')).toHaveText('Test B');
  await expect(page.locator('#start-music-play')).toHaveAttribute('aria-label', 'Musik starten');
  await expect(page.locator('#start-music-mute')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#start-music-volume')).toHaveValue('23');
});

test('galaxy playing field navigates server systems, owned colonies, errors and narrow screens', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.evaluate(() => { window.__testMenuCanvas = document.getElementById('starfield'); });
  await page.locator('#start-resume').click();
  await expect(page.locator('#game-galaxy-status')).toContainText('Serverdaten geladen');
  expect(await page.evaluate(() => window.__testMenuCanvas === document.getElementById('starfield'))).toBe(true);
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect(page.locator('#game-galaxy-selection')).toContainText('Star 10');
  await expect(page.getByRole('button', { name: 'Home verwalten', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home verwalten', exact: true }).click();
  await expect(page.locator('[data-domain="buildings"]')).toBeVisible();
  await page.locator('#wm-host-buildings .wm-btn-close').click();
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await expect(page.locator('#game-galaxy-selection')).toContainText('Star 20');
  await expect(page.getByRole('button', { name: 'Frontier verwalten', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Galaxie', exact: true }).click();
  await expect(page.locator('#game-galaxy-selection')).toContainText('Stern im Spielfeld auswählen');
  await page.locator('#game-galaxy-catalog summary').click();
  await page.getByRole('searchbox', { name: 'Sternsysteme filtern' }).fill('20');
  await page.locator('#game-galaxy-system-list button').click();
  await expect(page.locator('#game-galaxy-selection')).toContainText('Star 20');
  api.failGalaxy();
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  await expect(page.locator('#game-galaxy-status')).toContainText('Galaxy temporarily unavailable');
  api.recoverGalaxy();
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  await expect(page.locator('#game-galaxy-status')).toContainText('Serverdaten geladen');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const geometry = await page.evaluate(() => ({
    field: document.getElementById('wm-galaxy-section').getBoundingClientRect().toJSON(),
    viewport: { width: innerWidth, height: innerHeight },
  }));
  expect(geometry.field).toMatchObject({ x: 0, y: 0, width: geometry.viewport.width, height: geometry.viewport.height });
});

test('system star updates replace stale map coordinates and survive map selection', async ({ page }) => {
  const api = await mockSession(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d?.getRenderStats().systemPlanets)).toBe(2);
  const payload = await page.evaluate(() => {
    window.__starSyncCanvas = document.getElementById('starfield');
    window.__staleCatalogStar = window.GQGame.domains.galaxy.getState().stars[0];
    return window.GQGame.domains.galaxy.getState().system;
  });
  payload.star_system = { ...payload.star_system, name: 'Canonical renamed star', x_ly: 450, y_ly: 700, z_ly: 30 };
  await page.route((url) => url.pathname.endsWith('/galaxy.php') && url.searchParams.get('action') === 'system',
    (route) => route.fulfill({ json: payload }));
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  await expect(page.locator('#game-galaxy-selection h3')).toContainText('Canonical renamed star');
  await expect.poll(() => page.evaluate(() => {
    const raw = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
    return raw._spatialLabelStars.map(({ name, x_ly, y_ly, z_ly }) => ({ name, x_ly, y_ly, z_ly }));
  })).toEqual([{ name: 'Canonical renamed star', x_ly: 450, y_ly: 700, z_ly: 30 }]);
  await page.evaluate(() => window.GQGame.domains.galaxy.select(window.__staleCatalogStar));
  await expect(page.locator('#game-galaxy-selection h3')).toContainText('Canonical renamed star');
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('galaxy');
  expect(await page.evaluate(() => window.GQGame.domains.galaxy.getState().selected.x_ly)).toBe(450);
  expect(await page.evaluate(() => window.__starSyncCanvas === document.getElementById('starfield'))).toBe(true);
  expect(api.commands).toHaveLength(0);
});

test('changed planets with an unchanged server timestamp update 3D without rebuilding identical snapshots', async ({ page }) => {
  const api = await mockSession(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d?.getRenderStats().systemPlanets)).toBe(2);
  const payload = await page.evaluate(() => window.GQGame.domains.galaxy.getState().system);
  payload.planets[0].player_planet.name = 'Renamed colony planet';
  payload.planets[1] = { position: 6, generated_planet: {
    position: 6, name: 'Newly revealed planet', semi_major_axis_au: 3, diameter_km: 15000,
  } };
  await page.route((url) => url.pathname.endsWith('/galaxy.php') && url.searchParams.get('action') === 'system',
    (route) => route.fulfill({ json: payload }));
  await page.evaluate(() => {
    const adapter = window.galaxy3d;
    const enter = adapter.enterSystemView.bind(adapter);
    window.__systemRebuilds = 0;
    window.__syncCanvas = document.getElementById('starfield');
    adapter.enterSystemView = (...args) => { window.__systemRebuilds++; return enter(...args); };
  });
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  const bodies = () => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native
    .getSpaceView().bodies.filter((body) => body.userData.type === 'planet')
    .map((body) => ({ name: body.userData.data.name, position: body.userData.data.position })));
  await expect.poll(bodies).toEqual([
    { name: 'Renamed colony planet', position: 3 }, { name: 'Newly revealed planet', position: 6 },
  ]);
  const pose = await page.evaluate(() => {
    window.__syncBody = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView().bodies[0];
    return window.galaxy3d.getRenderStats().cameraControl;
  });
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.GQGame.domains.galaxy.getState().loading)).toBe(false);
  expect(await page.evaluate(() => window.__systemRebuilds)).toBe(1);
  expect(await page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl)).toEqual(pose);
  expect(await page.evaluate(() => window.__syncCanvas === document.getElementById('starfield')
    && window.__syncBody === window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView().bodies[0])).toBe(true);
  payload.planets = [];
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  await expect.poll(bodies).toEqual([]);
  expect(api.commands).toHaveLength(0);
});

test('removing the focused colony planet during refresh leaves no obsolete surface or camera context', async ({ page }) => {
  const api = await mockSession(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Kolonie auf Owned planet ansehen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('colony');
  const payload = await page.evaluate(() => {
    window.__removedFocusCanvas = document.getElementById('starfield');
    return window.GQGame.domains.galaxy.getState().system;
  });
  payload.planets = payload.planets.filter((slot) => slot.position !== 3);
  await page.route((url) => url.pathname.endsWith('/galaxy.php') && url.searchParams.get('action') === 'system',
    (route) => route.fulfill({ json: payload }));
  await openNavigation(page);
  await page.getByRole('button', { name: 'Karte aktualisieren', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('system');
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toHaveCount(0);
  expect(await page.evaluate(() => ({
    position: window.galaxy3d.getRenderStats().cameraControl.planetPosition,
    surface: window.galaxy3d.getRenderStats().colonySurface,
    zoom: !!window.__GQ_ZOOM_ORCHESTRATOR,
    sameCanvas: window.__removedFocusCanvas === document.getElementById('starfield'),
  }))).toEqual({ position: null, surface: null, zoom: false, sameCanvas: true });
  await expect(page.locator('#game-planet-context')).toBeHidden();
  await expect(page.locator('#game-camera-path [aria-current="location"]')).toHaveAttribute('data-level', 'system');
  await expect(page.locator('#game-galaxy-selection')).not.toContainText('Owned planet');
  expect(api.commands).toHaveLength(0);
});

test('a partially initialized 3D view rolls back and retries on the same renderer and latest server system', async ({ page }) => {
  const api = await mockSession(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME?.renderer?.ready)).toBe(true);
  await page.evaluate(() => {
    const control = window.GQAuthGalaxyBackgroundControl;
    const acquire = control.acquireGameView.bind(control);
    window.__recoveryCanvas = document.getElementById('starfield');
    window.__recoveryRenderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
    let first = true;
    control.acquireGameView = async () => {
      const renderer = await acquire();
      if (first) {
        first = false;
        const stats = renderer.getRenderStats;
        renderer.getRenderStats = function () {
          renderer.getRenderStats = stats;
          throw new Error('Test renderer initialization failure');
        };
      }
      return renderer;
    };
  });
  await page.locator('#start-resume').click();
  const status = page.locator('#game-renderer-status');
  await expect(status).toHaveText('Test renderer initialization failure');
  await expect(status).toBeVisible();
  expect(await page.evaluate(() => window.galaxy3d === undefined)).toBe(true);
  await openNavigation(page);
  await page.getByRole('spinbutton', { name: 'Galaxiekoordinate', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Systemkoordinate', exact: true }).fill('20');
  await page.getByRole('button', { name: 'System öffnen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.GQGame.domains.galaxy.getState().system?.system)).toBe(20);
  await page.getByRole('button', { name: '3D erneut starten', exact: true }).click();
  await expect(status).toHaveText('3D aktiv: webgpu');
  await expect(page.locator('#game-galaxy-ui')).toHaveAttribute('data-renderer', 'webgpu');
  await expect.poll(() => page.evaluate(() => window.galaxy3d?.getRenderStats().systemPlanets)).toBe(2);
  expect(await page.evaluate(() => window.__recoveryCanvas === document.getElementById('starfield')
    && window.__recoveryRenderer === window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer
    && window.GQGame.domains.galaxy.getState().system.system === 20)).toBe(true);
  expect(api.commands).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('server navigation stays usable without an adapter and explicit retry restores the hidden shared canvas', async ({ page }) => {
  const api = await mockSession(page);
  await page.addInitScript(() => {
    const gpu = navigator.gpu;
    if (!gpu) return;
    const request = gpu.requestAdapter.bind(gpu);
    window.__allowTestGpu = false;
    gpu.requestAdapter = (...args) => window.__allowTestGpu ? request(...args) : Promise.resolve(null);
  });
  await page.goto('/');
  await expect(page.locator('#start-galaxy-source')).toContainText('WebGPU is unavailable');
  await page.evaluate(() => { window.__recoveryCanvas = document.getElementById('starfield'); });
  await page.locator('#start-resume').click();
  await expect(page.locator('#game-renderer-status')).toContainText('WebGPU is unavailable');
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect(page.locator('#game-galaxy-selection')).toContainText('Owned planet');
  await page.evaluate(() => { window.__allowTestGpu = true; });
  await page.getByRole('button', { name: '3D erneut starten', exact: true }).click();
  await expect(page.locator('#game-renderer-status')).toHaveText('3D aktiv: webgpu');
  await expect(page.locator('#starfield')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.getElementById('starfield');
    const style = getComputedStyle(canvas);
    return window.__recoveryCanvas === canvas && style.visibility === 'visible'
      && Number(style.opacity) === 1 && window.galaxy3d.getRenderStats().systemPlanets === 2;
  })).toBe(true);
  expect(api.commands).toHaveLength(0);
});

test('game retains menu WebGPU renderer and device and actually renders galaxy and server planets', async ({ page }) => {
  await mockSession(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable; run GQ_WEBGPU_SHADER_CI=1 for software GPU validation');
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME?.renderer?.ready)).toBe(true);
  await page.evaluate(() => {
    const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
    window.__testMenuRenderer = renderer;
    window.__testMenuDevice = renderer.device;
    window.__testMenuCanvas = document.getElementById('starfield');
  });
  await page.locator('#start-resume').click();
  await expect(page.locator('#game-renderer-status')).toHaveText('3D aktiv: webgpu');
  expect(await page.evaluate(() => {
    const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
    return renderer === window.__testMenuRenderer && renderer.device === window.__testMenuDevice
      && document.getElementById('starfield') === window.__testMenuCanvas;
  })).toBe(true);
  await openNavigation(page);
  await page.getByRole('button', { name: 'Galaxie', exact: true }).click();
  await page.locator('#game-galaxy-navigation > summary').click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().frameTick)).toBeGreaterThan(3);
  await page.locator('#game-galaxy-ui').evaluate((element) => { element.style.visibility = 'hidden'; });
  const screenshot = await page.locator('#starfield').screenshot();
  const imageStats = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const image = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = image.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const colors = new Set();
    let bright = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
      if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 50) bright++;
    }
    bitmap.close();
    return { colors: colors.size, bright };
  }, screenshot.toString('base64'));
  await page.locator('#game-galaxy-ui').evaluate((element) => { element.style.visibility = ''; });
  expect(imageStats.colors).toBeGreaterThan(128);
  expect(imageStats.bright).toBeGreaterThan(200);
  const starPoint = await page.evaluate(() => {
    const raw = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
    const space = raw.getSpaceView();
    const star = window.GQGame.domains.galaxy.getState().stars[0];
    const projected = space.origin.clone().set(star.x_ly, star.y_ly, star.z_ly).sub(space.origin).project(space.camera);
    const rect = document.getElementById('starfield').getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
  });
  await page.mouse.click(starPoint.x, starPoint.y);
  await expect(page.locator('#game-galaxy-selection h3')).toContainText('Star 10');
  await page.mouse.dblclick(starPoint.x, starPoint.y);
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().systemPlanets)).toBe(2);
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().systemPlanets)).toBe(2);
  expect(await page.evaluate(() => {
    const raw = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
    return raw.getSpaceView().bodies.filter((body) => body.userData.type === 'planet').map((body) => body.userData.data.name);
  })).toEqual(['Owned planet', 'Uncolonized planet']);
  await expect.poll(() => page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView().renderedInstances)).toBeGreaterThan(0);
  await openCommand(page);
  await page.locator('#logout-btn').click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  expect(await page.evaluate(() => !window.GQGame && !window.galaxy3d && !document.getElementById('game-galaxy-ui'))).toBe(true);
  expect(errors).toEqual([]);
});

test('mouse rotates, pans and zooms the same canvas from system to planet and colony with return navigation', async ({ page }) => {
  await mockSession(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await expect(page.locator('#game-renderer-status')).toHaveText('3D aktiv: webgpu');
  await page.evaluate(() => {
    const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
    window.colonySharedTest = { renderer, canvas: renderer.renderer.domElement,
      device: renderer._device, context: renderer._context, errors: [] };
    renderer._device.addEventListener('uncapturederror', (event) => {
      window.colonySharedTest.errors.push(event.error.message);
    });
  });
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('system');
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.transitioning)).toBe(false);
  await page.locator('#game-galaxy-navigation > summary').click();
  await page.locator('#game-galaxy-details > summary').click();
  const camera = () => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl);
  const before = await camera();
  await page.mouse.move(800, 450);
  await page.mouse.down();
  await page.mouse.move(880, 490, { steps: 8 });
  await page.mouse.up();
  const rotated = await camera();
  expect(rotated.quaternion).not.toEqual(before.quaternion);
  expect(rotated.distance / before.distance).toBeCloseTo(1, 6);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(920, 510, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  expect((await camera()).target).not.toEqual(rotated.target);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await camera()).transitioning).toBe(false);
  const centered = await camera();
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await camera()).distance).toBeLessThan(centered.distance);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await camera()).transitioning).toBe(false);
  const point = await page.evaluate(() => {
    const space = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView();
    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const projected = body.getWorldPosition(space.origin.clone()).project(space.camera);
    const rect = document.getElementById('starfield').getBoundingClientRect();
    return { x: (projected.x + 1) * rect.width / 2, y: (1 - projected.y) * rect.height / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(async () => (await camera()).level).toBe('planet');
  expect((await camera()).planetPosition).toBe(3);
  await page.mouse.move(850, 500);
  for (let index = 0; index < 3; index++) await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await camera()).level).toBe('colony');
  expect((await camera()).position.every(Number.isFinite)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const space = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView();
    return [...space.spaceEntities.values()].some((entity) => entity.kind === 'colony'
      && space.vesselRenderPass.resources.has(entity.id));
  })).toBe(true);
  const surface = () => page.evaluate(() => window.galaxy3d.getRenderStats().colonySurface);
  await expect.poll(async () => (await surface()).transition).toBe(1);
  await expect.poll(async () => (await surface()).snapshot).toContain('Server snapshot');
  expect((await surface()).buildings).toBe(1);
  expect((await surface()).terrainVertices).toBeGreaterThan(0);
  const colonyPose = await surface();
  await page.mouse.move(850, 500);
  await page.mouse.down();
  await page.mouse.move(890, 530, { steps: 6 });
  await page.mouse.up();
  expect((await surface()).orbit).not.toEqual(colonyPose.orbit);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(925, 550, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  expect((await surface()).target).not.toEqual(colonyPose.target);
  await page.keyboard.press('Home');
  expect((await surface()).target).toEqual({ x: 0, z: 0 });
  const span = (await surface()).span;
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await surface()).span).toBeLessThan(span);
  expect(await page.evaluate(() => {
    const test = window.colonySharedTest;
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    return { canvas: zoom._canvas === test.canvas, device: zoom._backend.device === test.device,
      context: zoom._backend.context === test.context, hooks: test.renderer._gameFrameHooks.size,
      raf: zoom._rafId, active: test.renderer._gameZoomSceneActive, errors: test.errors };
  })).toEqual({ canvas: true, device: true, context: true, hooks: 1, raf: 0, active: true, errors: [] });
  await page.keyboard.press('Home');
  const building = await page.evaluate(() => {
    const city = window.__GQ_ZOOM_ORCHESTRATOR._active;
    window.colonySharedTest.surface = city;
    window.colonySharedTest.instances = city._instanceBuffer;
    const slot = city._slots[0];
    const radius = city._bodySurface.radius;
    const distance = Math.hypot(slot.x, slot.z);
    const angle = distance / radius;
    const scale = distance > 0.0001 ? Math.sin(angle) / distance : 0;
    const point = [slot.x * scale * (radius + 1), Math.cos(angle) * (radius + 1) - radius, slot.z * scale * (radius + 1)];
    const m = city._viewProjection;
    const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
    const x = (m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12]) / w;
    const y = (m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13]) / w;
    const rect = city._canvas.getBoundingClientRect();
    return { x: rect.left + (x + 1) * rect.width / 2, y: rect.top + (1 - y) * rect.height / 2 };
  });
  await page.mouse.click(building.x, building.y);
  await expect(page.locator('[aria-label="Colony surface simulation"]')).toHaveAttribute('open', '');
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('metal mine · Level 2');
  await page.evaluate(() => {
    window.colonySharedTest.instances = window.__GQ_ZOOM_ORCHESTRATOR._active._instanceBuffer;
  });
  await page.getByRole('button', { name: 'Focus building', exact: true }).click();
  await expect.poll(async () => (await camera()).level).toBe('building');
  await expect.poll(() => page.evaluate(() => {
    const city = window.__GQ_ZOOM_ORCHESTRATOR._active;
    return city._cameraFocus === null && Math.abs(city._camera.span - 9) < 0.001;
  })).toBe(true);
  expect(await page.evaluate(() => {
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    return zoom._active === window.colonySharedTest.surface
      && zoom._active._instanceBuffer === window.colonySharedTest.instances
      && !zoom._registry._instances.has(5);
  })).toBe(true);
  const detailPose = await surface();
  await page.getByRole('button', { name: 'Buildings', exact: true }).click();
  const buildingWindow = page.locator('[data-domain="buildings"]');
  await expect(buildingWindow).toContainText('Stufe 2');
  await expect(buildingWindow.locator('[data-type="metal_mine"]')).toHaveAttribute('aria-current', 'true');
  await expect(buildingWindow.locator('[data-type="metal_mine"] h3')).toBeFocused();
  await buildingWindow.getByRole('button', { name: 'Ausbau beauftragen' }).click();
  await expect.poll(() => page.evaluate(() =>
    window.__GQ_ZOOM_ORCHESTRATOR._active._selected?.upgrade_end)).toBeTruthy();
  expect((await camera()).level).toBe('building');
  expect((await surface()).target).toEqual(detailPose.target);
  expect((await surface()).span).toBeCloseTo(detailPose.span);
  expect((await surface()).orbit).toEqual(detailPose.orbit);
  await expect(buildingWindow.getByRole('list', { name: 'Bauwarteschlange' })).toContainText('metal mine → 3');
  await buildingWindow.getByRole('button', { name: 'Fällige Aufträge abschließen' }).click();
  await expect.poll(() => page.evaluate(() => window.__GQ_ZOOM_ORCHESTRATOR._active._selected?.level)).toBe(3);
  expect(await page.evaluate(() => {
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    return zoom._active === window.colonySharedTest.surface
      && zoom._backend.device === window.colonySharedTest.device
      && zoom._active._terrainBuffer !== null && zoom._rafId === 0;
  })).toBe(true);
  await page.locator('#wm-host-buildings .wm-btn-min').click();
  await page.locator('#starfield').focus();
  const path = page.getByRole('navigation', { name: 'Ansichtspfad', exact: true });
  await expect(path.getByRole('button', { name: 'Gebäude anzeigen', exact: true })).toHaveAttribute('aria-current', 'location');
  await path.getByRole('button', { name: 'Kolonie anzeigen', exact: true }).click();
  await expect.poll(async () => (await camera()).level).toBe('colony');
  await expect(page.locator('#starfield')).toBeFocused();
  await path.getByRole('button', { name: 'Planet anzeigen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const zoom = window.__GQ_ZOOM_ORCHESTRATOR;
    return !!zoom?._active?._departure && zoom._active._camera.progress > 0
      && zoom._active._camera.progress < 1 && !!zoom._active._instanceBuffer;
  })).toBe(true);
  await expect.poll(async () => (await camera()).level).toBe('planet');
  const viewport = page.viewportSize();
  await page.mouse.dblclick(viewport.width / 2, viewport.height / 2);
  await expect.poll(async () => (await camera()).level).toBe('colony');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await camera()).level).toBe('planet');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await camera()).level).toBe('system');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await camera()).level).toBe('galaxy');
  await expect.poll(async () => (await camera()).transitioning).toBe(false);
  expect(await page.evaluate(() => ({
    hooks: window.colonySharedTest.renderer._gameFrameHooks.size,
    active: window.colonySharedTest.renderer._gameZoomSceneActive,
    zoom: !!window.__GQ_ZOOM_ORCHESTRATOR,
  }))).toEqual({ hooks: 0, active: false, zoom: false });
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Kolonie auf Owned planet ansehen', exact: true }).click();
  await expect.poll(async () => (await surface())?.transition).toBe(1);
  await openCommand(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-command-overlay')).toBeHidden();
  expect((await camera()).level).toBe('colony');
  await openCommand(page);
  let logoutCleanup;
  await page.route('**/api/auth.php?action=logout', async (route) => {
    logoutCleanup = await page.evaluate(() => ({
      hooks: window.colonySharedTest.renderer._gameFrameHooks.size,
      active: window.colonySharedTest.renderer._gameZoomSceneActive,
      zoom: !!window.__GQ_ZOOM_ORCHESTRATOR, errors: window.colonySharedTest.errors,
    }));
    await route.fulfill({ json: { success: true } });
  });
  await page.locator('#logout-btn').click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  expect(logoutCleanup).toEqual({ hooks: 0, active: false, zoom: false, errors: [] });
  expect(errors).toEqual([]);
});

test('compact view path returns directly from colony to system and galaxy without resizing the mobile canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Kolonie auf Owned planet ansehen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().colonySurface?.transition)).toBe(1);
  const path = page.getByRole('navigation', { name: 'Ansichtspfad', exact: true });
  await expect(path.getByRole('button', { name: 'Kolonie anzeigen', exact: true })).toHaveAttribute('aria-current', 'location');
  await expect(path.getByRole('button', { name: 'Gebäude anzeigen', exact: true })).toBeHidden();
  expect(await page.evaluate(() => {
    const path = document.getElementById('game-camera-path').getBoundingClientRect();
    const hud = document.querySelector('[aria-label="Colony surface simulation"]').getBoundingClientRect();
    const canvas = document.getElementById('starfield').getBoundingClientRect();
    return { fits: path.right <= innerWidth && path.bottom <= hud.top,
      width: canvas.width, height: canvas.height, overflow: document.documentElement.scrollWidth > innerWidth };
  })).toEqual({ fits: true, width: 390, height: 844, overflow: false });
  await path.getByRole('button', { name: 'System anzeigen', exact: true }).click();
  await expect(path).toHaveAttribute('aria-busy', 'true');
  await expect(path.getByRole('button', { name: 'Galaxie anzeigen', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('system');
  await expect(path).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#starfield')).toBeFocused();
  await path.getByRole('button', { name: 'Galaxie anzeigen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('galaxy');
  await expect(path).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.transitioning)).toBe(false);
  expect(await page.evaluate(() => ({
    zoom: !!window.__GQ_ZOOM_ORCHESTRATOR,
    hooks: window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native._gameFrameHooks.size,
  }))).toEqual({ zoom: false, hooks: 0 });
  expect(errors).toEqual([]);
});

test('canvas planet selection exposes compact owned-colony actions and clears without moving the camera', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await mockSession(page);
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('system');
  await page.locator('#game-galaxy-navigation > summary').click();
  await page.locator('#game-galaxy-details > summary').click();
  const point = await page.evaluate(() => {
    const space = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView();
    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const projected = body.getWorldPosition(space.origin.clone()).project(space.camera);
    const rect = document.getElementById('starfield').getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  const context = page.getByRole('region', { name: 'Planetenauswahl', exact: true });
  await expect(context).toContainText('Owned planet · Position 3');
  await expect(context).toContainText('Eigene Kolonie: Home');
  await expect(page.locator('#game-galaxy-details')).not.toHaveAttribute('open', '');
  await context.getByRole('button', { name: 'Kolonie verwalten', exact: true }).click();
  await expect(page.locator('[data-domain="buildings"]')).toContainText('Home');
  expect(api.commands).toHaveLength(0);
  await page.locator('#wm-host-buildings .wm-btn-min').click();
  await context.getByRole('button', { name: 'Planet annähern', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('planet');
  await context.getByRole('button', { name: 'Kolonieoberfläche öffnen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().colonySurface?.transition)).toBe(1);
  await expect(context).toBeHidden();
  await page.getByRole('navigation', { name: 'Ansichtspfad', exact: true })
    .getByRole('button', { name: 'System anzeigen', exact: true }).click();
  await expect(context).toBeVisible();
  await page.evaluate(() => window.galaxy3d.focusPlanet(5));
  await expect(context).toContainText('Unbesiedelter Planet');
  await expect(context.getByRole('button', { name: 'Kolonieoberfläche öffnen', exact: true })).toBeHidden();
  await expect(context.getByRole('button', { name: 'Kolonie verwalten', exact: true })).toBeHidden();
  const before = await page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl);
  await context.getByRole('button', { name: 'Planetenauswahl aufheben', exact: true }).click();
  await expect(context).toBeHidden();
  await expect(page.locator('#starfield')).toBeFocused();
  expect(await page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('real touch input orbits, pans, pinches and selects on the shared galaxy and colony canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSession(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('system');
  await page.locator('#game-galaxy-navigation > summary').click();
  await page.locator('#game-galaxy-details > summary').click();
  const camera = () => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl);
  const surface = () => page.evaluate(() => window.galaxy3d.getRenderStats().colonySurface);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 });
  const contact = (id, x, y) => ({ id, x, y, radiusX: 1, radiusY: 1, force: 1 });
  const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  async function gesture() {
    await touch('touchStart', [contact(1, 120, 600)]);
    await touch('touchMove', [contact(1, 150, 620)]);
    await touch('touchStart', [contact(1, 150, 620), contact(2, 260, 620)]);
    await touch('touchMove', [contact(1, 150, 620), contact(2, 295, 630)]);
    await touch('touchEnd', []);
  }
  const initial = await camera();
  await gesture();
  const moved = await camera();
  expect(moved.quaternion).not.toEqual(initial.quaternion);
  expect(moved.target).not.toEqual(initial.target);
  expect(moved.distance).toBeLessThan(initial.distance);
  await expect(page.getByRole('region', { name: 'Planetenauswahl', exact: true })).toBeHidden();
  await page.keyboard.press('Home');
  const point = await page.evaluate(() => {
    const space = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView();
    const body = space.bodies.find((entry) => entry.userData.data.position === 3);
    const projected = body.getWorldPosition(space.origin.clone()).project(space.camera);
    const rect = document.getElementById('starfield').getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2 };
  });
  await touch('touchStart', [contact(3, point.x, point.y)]);
  await touch('touchEnd', []);
  const context = page.getByRole('region', { name: 'Planetenauswahl', exact: true });
  await expect(context).toContainText('Owned planet · Position 3');
  await context.getByRole('button', { name: 'Kolonieoberfläche öffnen', exact: true }).click();
  await expect.poll(async () => (await surface())?.transition).toBe(1);
  const before = await surface();
  const parent = await camera();
  await gesture();
  const after = await surface();
  expect(after.orbit).not.toEqual(before.orbit);
  expect(after.target).not.toEqual(before.target);
  expect(after.span).toBeLessThan(before.span);
  expect(after.selected).toBeNull();
  expect(await camera()).toEqual(parent);
  await touch('touchStart', [contact(4, 150, 600)]);
  await touch('touchCancel', []);
  const cancelled = await surface();
  await touch('touchStart', [contact(5, 120, 600)]);
  await touch('touchMove', [contact(5, 145, 610)]);
  await touch('touchEnd', []);
  expect((await surface()).orbit).not.toEqual(cancelled.orbit);
  expect((await surface()).selected).toBeNull();
  await page.keyboard.press('Home');
  const building = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const city = window.__GQ_ZOOM_ORCHESTRATOR._active;
    const slot = city._slots[0];
    const radius = city._bodySurface.radius;
    const distance = Math.hypot(slot.x, slot.z);
    const angle = distance / radius;
    const scale = distance > 0.0001 ? Math.sin(angle) / distance : 0;
    const point = [slot.x * scale * (radius + 1), Math.cos(angle) * (radius + 1) - radius, slot.z * scale * (radius + 1)];
    const m = city._viewProjection;
    const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
    const x = (m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12]) / w;
    const y = (m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13]) / w;
    const rect = city._canvas.getBoundingClientRect();
    return { x: rect.left + (x + 1) * rect.width / 2, y: rect.top + (1 - y) * rect.height / 2 };
  });
  await touch('touchStart', [contact(6, building.x, building.y)]);
  await touch('touchEnd', []);
  await expect.poll(async () => (await surface()).selected).toBe('metal_mine');
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toHaveAttribute('open', '');
  expect(await page.evaluate(() => ({
    hooks: window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native._gameFrameHooks.size,
    raf: window.__GQ_ZOOM_ORCHESTRATOR._rafId,
    canvas: window.__GQ_ZOOM_ORCHESTRATOR._canvas === document.getElementById('starfield'),
    scroll: scrollY,
  }))).toEqual({ hooks: 1, raf: 0, canvas: true, scroll: 0 });
  await cdp.detach();
  expect(errors).toEqual([]);
});

test('surface refresh failures stay explicit and accepted builds refresh even when the overview fails', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const api = await mockSession(page);
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Kolonie auf Owned planet ansehen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().colonySurface?.snapshot)).toContain('Server snapshot');
  const city = () => page.evaluate(() => {
    const surface = window.__GQ_ZOOM_ORCHESTRATOR._active;
    return { span: surface._camera.span, orbit: surface._orbit, target: surface._camera.target,
      buildings: surface._slots.map(({ type, level, upgrade_end }) => ({ type, level, upgrading: !!upgrade_end })) };
  });
  const initial = await city();
  await page.locator('[aria-label="Colony surface simulation"] > summary').click();
  await page.getByRole('button', { name: 'Buildings', exact: true }).click();
  const buildings = page.locator('[data-domain="buildings"]');
  await expect(buildings).toContainText('Stufe 2');
  api.failSurface();
  await buildings.getByRole('button', { name: 'Ausbau beauftragen' }).click();
  await expect(page.locator('#game-renderer-status')).toContainText('Surface snapshot unavailable');
  expect((await city()).buildings).toEqual(initial.buildings);
  expect((await city()).span).toBe(initial.span);
  expect(api.commands).toHaveLength(1);
  api.recoverSurface();
  await page.locator('#wm-host-buildings .wm-btn-min').click();
  await page.locator('#starfield').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await expect(page.locator('#game-renderer-status')).toBeVisible();
  await expect(page.locator('#game-renderer-status')).toContainText('Surface snapshot unavailable');
  await expect(page.locator('#game-renderer-status')).toHaveAttribute('role', 'alert');
  const moved = await city();
  expect(moved.orbit).not.toEqual(initial.orbit);
  await page.getByRole('button', { name: 'Refresh snapshot', exact: true }).click();
  await expect.poll(async () => (await city()).buildings[0].upgrading).toBe(true);
  await expect(page.getByRole('region', { name: 'Colony surface simulation' })).toContainText('Server snapshot');
  await expect(page.locator('#game-renderer-status')).toBeHidden();
  await page.getByRole('button', { name: 'Buildings', exact: true }).click();
  await expect(buildings.getByRole('list', { name: 'Bauwarteschlange' })).toContainText('metal mine → 3');
  api.failRefresh();
  await buildings.getByRole('button', { name: 'Fällige Aufträge abschließen' }).click();
  await expect(buildings.getByRole('alert')).toContainText('Auftrag bestätigt');
  await expect.poll(async () => (await city()).buildings[0].level).toBe(3);
  expect((await city()).buildings[0].upgrading).toBe(false);
  expect((await city()).span).toBe(moved.span);
  expect(api.commands.map(({ action }) => action)).toEqual(['upgrade', 'finish']);
});

test('reduced motion skips shared camera flights and the surface departure blend', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockSession(page);
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Kolonie auf Owned planet ansehen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().colonySurface?.transition)).toBe(1);
  expect(await page.evaluate(() => ({
    flight: window.__GQ_ZOOM_ORCHESTRATOR._flight.isFlying,
    moving: window.galaxy3d.getRenderStats().cameraControl.transitioning,
    hooks: window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native._gameFrameHooks.size,
  }))).toEqual({ flight: false, moving: false, hooks: 1 });
  await page.locator('#starfield').focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('planet');
  expect(await page.evaluate(() => window.__GQ_ZOOM_ORCHESTRATOR._registry._instances.get(3)._departure)).toBeNull();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.level)).toBe('system');
  expect(await page.evaluate(() => window.galaxy3d.getRenderStats().cameraControl.transitioning)).toBe(false);
  expect(await page.evaluate(() => window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native._gameFrameHooks.size)).toBe(0);
});

test('authenticated HUD loads server data, selects colonies and reports failed on-demand refresh', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await expect(page.locator('#start-resume')).toBeVisible();
  expect(api.requests()).toBe(0);
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await openCommand(page);
  await expect(page.locator('#commander-name')).toHaveText('ServerCommander');
  await expect(page.locator('#res-energy')).toHaveText('-5');
  await expect(page.locator('#res-dark-matter')).toHaveText('15');
  await page.locator('#game-colony-select').selectOption('2');
  await expect(page.locator('#res-metal')).toHaveText('700');
  await expect(page.locator('#res-energy')).toHaveText('0');
  await expect(page.locator('#topbar-coords')).toHaveText('[2:20:4]');
  expect(await page.evaluate(() => window.GQGame.domains.overview.getColony().id)).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  api.failRefresh();
  await page.locator('#topbar-title-btn').click();
  await expect(page.locator('#game-data-status')).toContainText('Overview unavailable');
  await expect(page.locator('#res-metal')).toHaveText('700');
  expect(api.requests()).toBe(2);
});

test('building and research windows submit CSRF commands, show queues and refresh authoritative HUD', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await openCommand(page);
  await page.locator('[data-game-development="buildings"]').click();
  const buildings = page.locator('[data-domain="buildings"]');
  await expect(buildings).toContainText('Stufe 2');
  await page.locator('#wm-host-buildings .wm-btn-min').click();
  await expect(buildings).toBeHidden();
  await openCommand(page);
  await page.locator('#wm-task-buildings').click();
  await page.keyboard.press('Escape');
  await expect(buildings).toBeVisible();
  expect(api.commands).toHaveLength(0);
  await buildings.getByRole('button', { name: 'Ausbau beauftragen' }).click();
  await expect(buildings.getByRole('list', { name: 'Bauwarteschlange' })).toContainText('metal mine → 3');
  await expect(page.locator('#res-metal')).toHaveText('2,230');
  expect(api.commands[0]).toEqual({
    kind: 'buildings', action: 'upgrade', body: { colony_id: 1, type: 'metal_mine' }, csrf: 'session-test',
  });
  await buildings.getByRole('button', { name: 'Fällige Aufträge abschließen' }).click();
  await expect(buildings.locator('[data-type="metal_mine"] p').first()).toHaveText(/^Stufe 3 ·/);
  await openCommand(page);
  await page.locator('[data-game-development="research"]').click();
  const research = page.locator('[data-domain="research"]');
  await expect(research.locator('[data-type="laser_tech"]')).toContainText('benötigt 1, vorhanden 0');
  await expect(research.locator('[data-type="laser_tech"] button')).toBeDisabled();
  await research.locator('[data-type="energy_tech"] button').click();
  await expect(research).toContainText('2000-01-01 10:00:00');
  await expect(research.locator('[data-type="energy_tech"] button')).toBeDisabled();
  await expect(page.locator('#res-metal')).toHaveText('2,130');
  await research.getByRole('button', { name: 'Fällige Aufträge abschließen' }).click();
  await expect(research.locator('[data-type="energy_tech"] p').first()).toHaveText(/^Stufe 1 ·/);
  expect(api.commands.map(({ action }) => action)).toEqual(['upgrade', 'finish', 'research', 'finish']);
  expect(api.commands[3].body).toEqual({});
});

test('mobile development windows follow colony selection and surface command rejection without retry', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await openCommand(page);
  await page.locator('[data-game-development="buildings"]').click();
  const buildings = page.locator('[data-domain="buildings"]');
  await expect(buildings).toContainText('Home');
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await expect(buildings).toContainText('Frontier');
  api.rejectCommand();
  await buildings.getByRole('button', { name: 'Ausbau beauftragen' }).click();
  await expect(buildings.getByRole('alert')).toHaveText('Server rejected this order');
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0].body.colony_id).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  api.expire();
  await buildings.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(page.locator('[data-domain="buildings"]')).toHaveCount(0);
  expect(await page.evaluate(() => !!window.GQGame)).toBe(false);
});

test('failed authoritative boot stays on auth and can be retried without a success-shaped fallback', async ({ page }) => {
  const api = await mockSession(page, { failBoot: true });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await expect(page.locator('#start-session-status')).toContainText('Overview unavailable');
  await expect(page.locator('body')).not.toHaveClass(/game-page/);
  expect(await page.evaluate(() => !!window.GQGame)).toBe(false);
  await expect(page.locator('#game-colony-select')).toHaveValue('');
  api.recover();
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await expect(page.locator('#res-energy')).toHaveText('-5');
});

test('session expiry clears account data and UI without waiting for the periodic session probe', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await expect(page.locator('body')).toHaveClass(/game-page/);
  await openCommand(page);
  api.expire();
  await page.locator('#topbar-title-btn').click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  expect(await page.evaluate(() => !!window.GQGame)).toBe(false);
  await expect(page.locator('#res-metal')).toHaveText('\u2014');
  await expect(page.locator('#game-colony-select option')).toHaveCount(0);
});

test('economy uses authoritative stocks and saves policy, one-percent tax, subsidies and methods with CSRF', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-economy]').click();
  const panel = page.locator('[data-domain="economy"]');
  await expect(panel.getByRole('table', { name: 'Wirtschaftsbestände' })).toBeVisible();
  await expect(panel.locator('[data-good="food"] td').nth(2)).toHaveText('—');
  await expect(panel.getByRole('list', { name: 'Versorgungsengpässe' })).toContainText('consumer goods');
  expect(api.commands).toHaveLength(0);
  await panel.getByLabel('Wirtschaftspolitik', { exact: true }).selectOption('autarky');
  await panel.getByRole('button', { name: 'Wirtschaftspolitik speichern' }).click();
  await expect(panel.getByLabel('Wirtschaftspolitik', { exact: true })).toHaveValue('autarky');
  await panel.getByLabel('Einkommensteuer (%)', { exact: true }).fill('1');
  await panel.getByRole('button', { name: 'Einkommensteuer (%) speichern' }).click();
  await expect.poll(() => api.commands.length).toBe(2);
  await expect(panel.getByRole('button', { name: 'Einkommensteuer (%) speichern' })).toBeEnabled();
  expect(api.commands[1].body).toEqual({ type: 'income', rate: 0.01 });
  await panel.getByLabel('Subvention Forschung', { exact: true }).selectOption('true');
  await panel.getByRole('button', { name: 'Subvention Forschung speichern' }).click();
  await expect(panel.getByLabel('Subvention Forschung', { exact: true })).toHaveValue('true');
  await panel.getByLabel('Metallurgy Methode', { exact: true }).selectOption('efficient');
  await panel.getByRole('button', { name: 'Metallurgy Methode speichern' }).click();
  await expect(panel.getByLabel('Metallurgy Methode', { exact: true })).toHaveValue('efficient');
  expect(api.commands.map(({ action }) => action)).toEqual(['set_policy', 'set_tax', 'set_subsidy', 'set_method']);
  expect(api.commands.every(({ csrf }) => csrf === 'session-test')).toBe(true);
  expect(api.commands[3].body).toEqual({ colony_id: 1, building_type: 'metallurgy', method: 'efficient' });
  await panel.getByLabel('Handelssteuer (%)', { exact: true }).fill('26');
  await panel.getByRole('button', { name: 'Handelssteuer (%) speichern' }).click();
  expect(api.commands).toHaveLength(4);
});

test('mobile economy follows selected colony, reports rejected methods and clears on expiry', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-economy]').click();
  const panel = page.locator('[data-domain="economy"]');
  await expect(panel).toContainText('Home');
  await expect(panel.getByLabel('Metallurgy Methode', { exact: true })).toHaveValue('standard');
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await expect(panel).toContainText('Frontier');
  await expect(panel.getByRole('button', { name: 'Metallurgy Methode speichern' })).toBeEnabled();
  api.rejectCommand();
  await panel.getByLabel('Metallurgy Methode', { exact: true }).selectOption('premium');
  await panel.getByRole('button', { name: 'Metallurgy Methode speichern' }).click();
  await expect(panel.getByRole('alert')).toHaveText('Research required for this method');
  await expect(panel.getByLabel('Metallurgy Methode', { exact: true })).toHaveValue('standard');
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0].body.colony_id).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  api.expire();
  await panel.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(panel).toHaveCount(0);
});

test('point-and-click selects stationed ships and destination on the galaxy with faction-specific transit', async ({ page }) => {
  const api = await mockSession(page, { transitType: 'kryl_tha' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const available = await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()));
  if (process.env.GQ_WEBGPU_SHADER_CI === '1') expect(available).toBe(true);
  else test.skip(!available, 'WebGPU adapter unavailable');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.galaxy3d?.getRenderStats().cameraControl.level)).toBe('system');
  await page.locator('#game-galaxy-navigation > summary').click();
  await page.locator('#game-galaxy-details > summary').click();
  async function clickPlanet(position) {
    const point = await page.evaluate((position) => {
      const space = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native.getSpaceView();
      const body = space.bodies.find((entry) => entry.userData.data.position === position);
      const projected = body.getWorldPosition(space.origin.clone()).project(space.camera);
      const rect = document.getElementById('starfield').getBoundingClientRect();
      return { x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2 };
    }, position);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point),
      `Planet ${position} at ${JSON.stringify(point)} must be exposed on the canvas`).toBe('starfield');
    await page.mouse.click(point.x, point.y);
  }
  await clickPlanet(3);
  await page.getByRole('region', { name: 'Planetenauswahl', exact: true })
    .getByRole('button', { name: 'Flotte hier auswählen', exact: true }).click();
  const command = page.getByRole('region', { name: 'Flottensteuerung', exact: true });
  await expect(command).toContainText("Kryl'Tha · Schwarmtunnel");
  await expect(command).toContainText('Hüllenschäden');
  await command.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true }).fill('2');
  await command.getByRole('combobox', { name: 'Mission', exact: true }).selectOption('survey');
  await command.getByRole('button', { name: 'Ziel im Spielfeld wählen', exact: true }).click();
  await expect(page.locator('#wm-galaxy-section')).toHaveClass(/fleet-target-picking/);
  await expect(command.getByRole('form', { name: 'Flottenstart' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#wm-galaxy-section')).not.toHaveClass(/fleet-target-picking/);
  await expect(command).toBeFocused();
  await expect(command.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true })).toHaveValue('2');
  await command.getByRole('button', { name: 'Ziel im Spielfeld wählen', exact: true }).click();
  await page.mouse.move(200, 450);
  await page.mouse.wheel(0, 400);
  await clickPlanet(5);
  await expect(command).toContainText('Ziel [1:10:5]');
  await expect(command).toBeFocused();
  await expect(command).toContainText('Herkunft: Home [1:10:3]');
  await expect(page.locator('#wm-galaxy-section')).not.toHaveClass(/fleet-target-picking/);
  expect(api.commands).toHaveLength(0);
  await command.getByRole('button', { name: 'Flotte serverseitig starten', exact: true }).click();
  await expect(command).toContainText('Auftrag serverseitig bestätigt');
  expect(api.commands).toEqual([{ kind: 'fleet', action: 'send', csrf: 'session-test',
    body: { origin_colony_id: 1, mission: 'survey', target_galaxy: 1, target_system: 10,
      target_position: 5, ships: { small_cargo: 2 }, cargo: { metal: 0, crystal: 0, deuterium: 0 } } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await command.focus();
  await page.keyboard.press('Escape');
  await expect(command).toBeHidden();
  await expect(page.locator('#starfield')).toBeFocused();
  expect(await page.evaluate(() => {
    const rect = document.getElementById('starfield').getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  })).toEqual({ width: 390, height: 844 });
});

test('planet context prefills a canonical fleet launch without changing origin and sends exact CSRF payload', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Uncolonized planet ansehen', exact: true }).click();
  const context = page.getByRole('region', { name: 'Planetenauswahl', exact: true });
  await context.getByRole('button', { name: 'Flotte zu diesem Planeten', exact: true }).click();
  const launch = page.locator('[data-domain="fleet-launch"]');
  await expect(launch).toContainText('Herkunft: Home [1:10:3]');
  await expect(launch.locator('input[aria-label="Zielposition"]')).toHaveValue('5');
  await expect(launch).toContainText('4 verfügbar');
  expect(api.commands).toHaveLength(0);
  await launch.getByRole('combobox', { name: 'Mission', exact: true }).selectOption('survey');
  await launch.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true }).fill('2');
  await launch.getByRole('spinbutton', { name: 'Fracht Metall', exact: true }).fill('12.5');
  await launch.getByRole('button', { name: 'Flotte serverseitig starten', exact: true }).click();
  await expect(launch).toContainText('Auftrag serverseitig bestätigt');
  await expect(launch).toContainText('2 verfügbar');
  await expect(launch.getByRole('spinbutton', { name: 'small cargo (2 verfügbar)', exact: true })).toHaveValue('0');
  await expect(launch.getByRole('spinbutton', { name: 'Fracht Metall', exact: true })).toHaveValue('0');
  expect(api.commands).toEqual([{ kind: 'fleet', action: 'send', csrf: 'session-test',
    body: { origin_colony_id: 1, mission: 'survey', target_galaxy: 1, target_system: 10,
      target_position: 5, ships: { small_cargo: 2 }, cargo: { metal: 12.5, crystal: 0, deuterium: 0 } } }]);
  await launch.getByRole('button', { name: 'Flottensteuerung schließen', exact: true }).click();
  await openCommand(page);
  await page.locator('[data-game-fleets]').click();
  const fleets = page.locator('[data-domain="fleets"]');
  await expect(fleets).toContainText('survey');
  expect(api.commands).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pending fleet dispatch refuses map handoffs without replacing its order or reloading inventory', async ({ page }) => {
  const api = await mockSession(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let sending = false;
  let inventoryReads = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/shipyard.php') && url.searchParams.get('action') === 'list') inventoryReads++;
  });
  await page.route((url) => url.pathname.endsWith('/fleet.php') && url.searchParams.get('action') === 'send',
    async (route) => {
      sending = true;
      await pending;
      await route.fallback();
    });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Uncolonized planet ansehen', exact: true }).click();
  const context = page.getByRole('region', { name: 'Planetenauswahl', exact: true });
  await context.getByRole('button', { name: 'Flotte zu diesem Planeten', exact: true }).click();
  const command = page.getByRole('region', { name: 'Flottensteuerung', exact: true });
  await expect(command).toContainText('4 verfügbar');
  await command.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true }).fill('2');
  await page.getByRole('button', { name: 'System anzeigen', exact: true }).click();
  await page.locator('#game-galaxy-details > summary').click();
  await page.getByRole('button', { name: 'Owned planet ansehen', exact: true }).click();
  await command.getByRole('button', { name: 'Flotte serverseitig starten', exact: true }).click();
  await expect.poll(() => sending).toBe(true);
  const readsBefore = inventoryReads;
  try {
    await context.getByRole('button', { name: 'Flotte zu diesem Planeten', exact: true }).click();
    await expect(command.getByRole('alert')).toContainText('erst danach geändert');
    await context.getByRole('button', { name: 'Flotte hier auswählen', exact: true }).click();
    await expect(command).toContainText('Ziel [1:10:5]');
    await expect(command.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true })).toHaveValue('2');
    await expect(command).toBeFocused();
    expect(inventoryReads).toBe(readsBefore);
    expect(api.commands).toHaveLength(0);
  } finally {
    release();
  }
  await expect(command).toContainText('Auftrag serverseitig bestätigt');
  await expect(command.getByRole('alert')).toHaveCount(0);
  expect(api.commands).toHaveLength(1);
  expect(api.commands[0].body).toMatchObject({ origin_colony_id: 1, target_position: 5, ships: { small_cargo: 2 } });
  await context.getByRole('button', { name: 'Flotte zu diesem Planeten', exact: true }).click();
  await expect(command).toContainText('Ziel [1:10:3]');
});

test('fleet launch preserves rejected drafts, clears accepted quantities on refresh failure and resets on origin change', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-fleet-launch]').click();
  const launch = page.locator('[data-domain="fleet-launch"]');
  await expect(launch).toContainText('4 verfügbar');
  await launch.getByText('Zielkoordinaten (Tastaturalternative)', { exact: true }).click();
  await launch.getByRole('spinbutton', { name: 'Zielgalaxie', exact: true }).fill('2');
  await launch.getByRole('spinbutton', { name: 'Zielsystem', exact: true }).fill('2000');
  await launch.getByRole('spinbutton', { name: 'Zielposition', exact: true }).fill('4');
  await launch.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true }).fill('1');
  api.rejectCommand();
  await launch.getByRole('button', { name: 'Flotte serverseitig starten', exact: true }).click();
  await expect(launch.getByRole('alert')).toHaveText('Recall rejected by server');
  await expect(launch.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true })).toHaveValue('1');
  api.allowCommands();
  api.failRefresh();
  await launch.getByRole('button', { name: 'Flotte serverseitig starten', exact: true }).click();
  await expect(launch.getByRole('alert')).toContainText('Auftrag bestätigt');
  await expect(launch.getByRole('spinbutton', { name: 'small cargo (4 verfügbar)', exact: true })).toHaveValue('0');
  await expect(launch.getByRole('button', { name: 'Flotte serverseitig starten', exact: true })).toBeDisabled();
  expect(api.commands).toHaveLength(2);
  api.recover();
  await launch.getByRole('button', { name: 'Schiffsbestand aktualisieren', exact: true }).click();
  await expect(launch).toContainText('3 verfügbar');
  await expect(launch.getByRole('spinbutton', { name: 'Zielsystem', exact: true })).toHaveValue('2000');
  expect(api.commands).toHaveLength(2);
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await expect(launch).toContainText('Herkunft: Frontier');
  await expect(launch.getByRole('spinbutton', { name: 'Zielsystem', exact: true })).toHaveValue('');
  api.expire();
  await launch.getByRole('button', { name: 'Schiffsbestand aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(page.locator('[data-domain="fleet-launch"]')).toHaveCount(0);
});

test('mobile resource navigation opens canonical details and only preselects requested market goods', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-resource="metal"]').press('Enter');
  const economy = page.locator('[data-domain="economy"]');
  const detail = economy.getByRole('region', { name: 'Ressourcendetails', exact: true });
  await expect(page.locator('#game-command-overlay')).toBeHidden();
  await expect(detail.getByRole('heading', { name: 'metal', exact: true })).toBeFocused();
  await expect(economy.locator('tr[data-good="metal"]')).toHaveAttribute('aria-current', 'true');
  await expect(detail).toContainText('Produktion/h: 20');
  expect(api.commands).toHaveLength(0);
  await economy.getByRole('button', { name: 'consumer goods Bestandsdetails', exact: true }).click();
  await expect(detail.getByRole('heading', { name: 'consumer goods', exact: true })).toBeFocused();
  await expect(detail).toContainText('Bestand: 0');
  await expect(detail).toContainText('Produktion/h: —');
  await detail.getByRole('button', { name: 'consumer goods im Markt öffnen', exact: true }).click();
  const market = page.locator('[data-domain="market"]');
  await expect(economy).toBeHidden();
  await expect(market.getByRole('combobox', { name: 'Handelsgut', exact: true })).toHaveValue('consumer_goods');
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  await openCommand(page);
  await page.locator('[data-resource="crystal"]').click();
  await expect(detail).toContainText('Kein Bestandsmesswert');
  await expect(detail.getByRole('heading', { name: 'crystal', exact: true })).toBeFocused();
  await detail.getByRole('button', { name: 'crystal im Markt öffnen', exact: true }).click();
  await expect(market.getByRole('combobox', { name: 'Handelsgut', exact: true })).toHaveValue('crystal');
  await expect(market.getByRole('alert')).toContainText('nicht handelbar');
  await expect(market.getByRole('button', { name: 'Kaufen', exact: true })).toBeDisabled();
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  await openCommand(page);
  await page.locator('[data-resource="energy"]').click();
  await expect(detail).toContainText('Energie: -5');
  await expect(detail).toContainText('kein lagerbares Handelsgut');
  await expect(detail.getByRole('button', { name: /im Markt öffnen/ })).toHaveCount(0);
  await openCommand(page);
  await page.locator('[data-resource="happiness"]').click();
  await expect(page.locator('[data-domain="population"]')).toContainText('Zufriedenheit: 70');
  await openCommand(page);
  await expect(page.locator('#res-dark-matter')).toHaveText('15');
  await expect(page.locator('#res-dark-matter').locator('..')).not.toHaveAttribute('role', 'button');
  await expect(page.locator('button[data-resource="dark_matter"]')).toHaveCount(0);
  expect(api.commands).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('resource details recover reads, clear on navigation, refresh accepted trades and leave no private view on expiry', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-resource="food"]').click();
  const economy = page.locator('[data-domain="economy"]');
  const detail = economy.getByRole('region', { name: 'Ressourcendetails', exact: true });
  await expect(detail).toContainText('Bestand: 123');
  api.failSurface();
  await economy.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(economy.getByRole('alert')).toHaveText('Surface snapshot unavailable');
  await expect(economy).toContainText('Letzter bestätigter Stand');
  await expect(detail).toContainText('Bestand: 123');
  await expect(detail.getByRole('button', { name: 'food im Markt öffnen', exact: true })).toBeDisabled();
  api.recoverSurface();
  await economy.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(detail.getByRole('button', { name: 'food im Markt öffnen', exact: true })).toBeEnabled();
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await page.keyboard.press('Escape');
  await expect(economy).toContainText('Frontier [2:20:4]');
  await expect(detail).toHaveCount(0);
  await economy.getByRole('button', { name: 'metal Bestandsdetails', exact: true }).click();
  await expect(detail.getByRole('heading', { name: 'metal', exact: true })).toBeFocused();
  await openCommand(page);
  await page.locator('[data-game-economy]').click();
  await expect(detail).toHaveCount(0);
  await economy.getByRole('button', { name: 'metal Bestandsdetails', exact: true }).click();
  await detail.getByRole('button', { name: 'metal im Markt öffnen', exact: true }).click();
  const market = page.locator('[data-domain="market"]');
  await expect(market).toContainText('Frontier [2:20:4]');
  await market.getByRole('spinbutton').fill('2.5');
  await market.getByRole('button', { name: 'Kaufen', exact: true }).click();
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  expect(api.commands).toEqual([
    { kind: 'market', action: 'buy', body: { colony_id: 2, good_type: 'metal', quantity: 2.5 }, csrf: 'session-test' },
  ]);
  await openCommand(page);
  await page.locator('[data-resource="metal"]').click();
  const stock = await page.evaluate(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(2367.9));
  await expect(detail).toContainText(`Bestand: ${stock}`);
  api.expire();
  await economy.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(economy).toHaveCount(0);
  await expect(page.locator('[data-resource-detail]')).toHaveCount(0);
  expect(api.commands).toHaveLength(1);
});

test('mobile population supply links preselect a shortage good without buying and show fresh stock after a confirmed trade', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-resource="population"]').click();
  await expect(page.locator('#game-command-overlay')).toBeHidden();
  const population = page.locator('[data-domain="population"]');
  await expect(population).toContainText('Bevölkerung: 100');
  await expect(population).toContainText('Zufriedenheit: 70');
  await expect(population).toContainText('Arbeitsplatzbesetzung: 80 %');
  const shortage = population.locator('[data-good="consumer_goods"]');
  await expect(shortage).toContainText('Fehlmenge/h: 3');
  await expect(shortage).toContainText('Bestand: 0');
  expect(api.commands).toHaveLength(0);
  await shortage.getByRole('button', { name: 'consumer goods im Markt öffnen', exact: true }).click();
  const market = page.locator('[data-domain="market"]');
  await expect(population).toBeHidden();
  await expect(market.getByRole('combobox', { name: 'Handelsgut', exact: true })).toHaveValue('consumer_goods');
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  expect(api.commands).toHaveLength(0);
  await market.getByRole('spinbutton').fill('4.5');
  await market.getByRole('button', { name: 'Kaufen', exact: true }).click();
  await expect(market).toContainText('Bestand: 4.5');
  expect(api.commands).toEqual([
    { kind: 'market', action: 'buy', body: { colony_id: 1, good_type: 'consumer_goods', quantity: 4.5 }, csrf: 'session-test' },
  ]);
  await openCommand(page);
  await page.locator('[data-game-population]').click();
  await expect(population).toBeVisible();
  const formattedStock = await page.evaluate(() => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(4.5));
  await expect(shortage).toContainText(`Bestand: ${formattedStock}`);
  await expect(population).toContainText('nicht aus einer Prognose');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('owned planet population view retains failed snapshots, follows colony changes and clears on expiry', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Owned planet ansehen', exact: true }).click();
  await page.getByRole('region', { name: 'Planetenauswahl', exact: true })
    .getByRole('button', { name: 'Bevölkerung dieser Kolonie', exact: true }).click();
  const population = page.locator('[data-domain="population"]');
  await expect(population).toContainText('Home [1:10:3]');
  api.failSurface();
  await population.getByRole('button', { name: 'Versorgung aktualisieren', exact: true }).click();
  await expect(population.getByRole('alert')).toHaveText('Surface snapshot unavailable');
  await expect(population).toContainText('Letzter bestätigter Stand');
  await expect(population.getByRole('button', { name: 'consumer goods im Markt öffnen', exact: true })).toBeDisabled();
  api.recoverSurface();
  await population.getByRole('button', { name: 'Versorgung aktualisieren', exact: true }).click();
  await expect(population.getByRole('button', { name: 'consumer goods im Markt öffnen', exact: true })).toBeEnabled();
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await page.keyboard.press('Escape');
  await expect(population).toContainText('Frontier [2:20:4]');
  await population.getByRole('button', { name: 'Wirtschaft und Politik öffnen', exact: true }).click();
  const economy = page.locator('[data-domain="economy"]');
  await expect(population).toBeHidden();
  await economy.getByRole('button', { name: 'Bevölkerung und Versorgung öffnen', exact: true }).click();
  await expect(economy).toBeHidden();
  await expect(population).toBeVisible();
  api.expire();
  await population.getByRole('button', { name: 'Versorgung aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(population).toHaveCount(0);
  expect(api.commands).toHaveLength(0);
});

test('mobile market trades canonical decimal quantities and recovers accepted orders without duplicate trades', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-market]').click();
  await expect(page.locator('#game-command-overlay')).toBeHidden();
  const market = page.locator('[data-domain="market"]');
  await expect(market).toContainText('Bestand: 2365.4');
  await expect(market).toContainText('Marktpreis: 10 Credits/Einheit');
  expect(api.commands).toHaveLength(0);
  await market.getByRole('spinbutton', { name: 'Handelsmenge', exact: true }).fill('2.5');
  api.rejectCommand();
  await market.getByRole('button', { name: 'Kaufen', exact: true }).click();
  await expect(market.getByRole('alert')).toHaveText('Autarky blocks imports');
  await expect(market.getByRole('spinbutton')).toHaveValue('2.5');
  api.allowCommands();
  api.failRefresh();
  await market.getByRole('button', { name: 'Kaufen', exact: true }).click();
  await expect(market.getByRole('alert')).toContainText('Auftrag bestätigt');
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  await expect(market.getByRole('button', { name: 'Kaufen', exact: true })).toBeDisabled();
  api.recover();
  await market.getByRole('button', { name: 'Markt aktualisieren', exact: true }).click();
  await expect(market).toContainText('Bestand: 2367.9');
  await expect(market.getByRole('list', { name: 'Handelshistorie', exact: true })).toContainText('Kauf: 2.5 metal');
  expect(api.commands).toHaveLength(2);
  await market.getByRole('spinbutton').fill('1.25');
  await market.getByRole('button', { name: 'Verkaufen', exact: true }).click();
  await expect(market).toContainText('Bestand: 2366.65');
  await expect(market.getByRole('list', { name: 'Handelshistorie', exact: true })).toContainText('Verkauf: 1.25 metal');
  expect(api.commands).toEqual([
    { kind: 'market', action: 'buy', body: { colony_id: 1, good_type: 'metal', quantity: 2.5 }, csrf: 'session-test' },
    { kind: 'market', action: 'buy', body: { colony_id: 1, good_type: 'metal', quantity: 2.5 }, csrf: 'session-test' },
    { kind: 'market', action: 'sell', body: { colony_id: 1, good_type: 'metal', quantity: 1.25 }, csrf: 'session-test' },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('economy links to market, failed reads stay explicit, and colony changes and expiry clear drafts', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-economy]').click();
  const economy = page.locator('[data-domain="economy"]');
  await economy.getByRole('button', { name: 'Markt öffnen', exact: true }).click();
  const market = page.locator('[data-domain="market"]');
  await expect(economy).toBeHidden();
  await expect(market).toContainText('Home [1:10:3]');
  await market.getByRole('combobox', { name: 'Handelsgut', exact: true }).selectOption('food');
  await market.getByRole('spinbutton').fill('8');
  api.failMarket();
  await market.getByRole('button', { name: 'Markt aktualisieren', exact: true }).click();
  await expect(market.getByRole('alert')).toHaveText('Market unavailable');
  await expect(market.getByRole('button', { name: 'Kaufen', exact: true })).toBeDisabled();
  await expect(market.getByRole('spinbutton')).toHaveValue('8');
  api.recoverMarket();
  await market.getByRole('button', { name: 'Markt aktualisieren', exact: true }).click();
  await expect(market.getByRole('button', { name: 'Kaufen', exact: true })).toBeEnabled();
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await page.keyboard.press('Escape');
  await expect(market).toContainText('Frontier [2:20:4]');
  await expect(market.getByRole('spinbutton')).toHaveValue('');
  api.expire();
  await market.getByRole('button', { name: 'Markt aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(market).toHaveCount(0);
  expect(api.commands).toHaveLength(0);
});

test('mobile shipyard builds through the owned planet, recovers accepted orders and supplies the map fleet inventory', async ({ page }) => {
  const api = await mockSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openNavigation(page);
  await page.getByRole('button', { name: 'Heimatsystem', exact: true }).click();
  await page.getByRole('button', { name: 'Owned planet ansehen', exact: true }).click();
  await page.getByRole('region', { name: 'Planetenauswahl', exact: true })
    .getByRole('button', { name: 'Werft dieser Kolonie öffnen', exact: true }).click();
  const shipyard = page.locator('[data-domain="shipyard"]');
  const cargo = shipyard.locator('[data-ship-type="small_cargo"]');
  await expect(cargo).toContainText('Verfügbar: 4');
  await expect(shipyard).toContainText('Keine laufenden Schiffsbauten.');
  expect(api.commands).toHaveLength(0);
  await cargo.getByRole('spinbutton').fill('2');
  api.rejectCommand();
  await cargo.getByRole('button', { name: 'Schiffe bauen', exact: true }).click();
  await expect(shipyard.getByRole('alert')).toHaveText('Shipyard required by server');
  await expect(cargo.getByRole('spinbutton')).toHaveValue('2');
  api.allowCommands();
  api.failRefresh();
  await cargo.getByRole('button', { name: 'Schiffe bauen', exact: true }).click();
  await expect(shipyard.getByRole('alert')).toContainText('Auftrag bestätigt');
  await expect(cargo.getByRole('spinbutton')).toHaveValue('1');
  await expect(cargo.getByRole('button', { name: 'Schiffe bauen', exact: true })).toBeDisabled();
  api.recover();
  await shipyard.getByRole('button', { name: 'Werft aktualisieren', exact: true }).click();
  await expect(shipyard.getByRole('list', { name: 'Schiffsbauwarteschlange', exact: true })).toContainText('2 small cargo');
  await expect(cargo).toContainText('Verfügbar: 4');
  await expect(page.locator('#res-metal')).toHaveText('2,265');
  expect(api.commands).toHaveLength(2);
  await shipyard.getByRole('button', { name: 'Fällige Schiffsbauten abschließen', exact: true }).click();
  await expect(cargo).toContainText('Verfügbar: 6');
  await expect(shipyard).toContainText('Keine laufenden Schiffsbauten.');
  expect(api.commands[2]).toEqual({ kind: 'shipyard', action: 'finish', body: { colony_id: 1 }, csrf: 'session-test' });
  await shipyard.getByRole('button', { name: 'Flotte im Spielfeld zusammenstellen', exact: true }).click();
  await expect(shipyard).toBeHidden();
  const launch = page.locator('#game-fleet-command');
  await expect(launch).toContainText('6 verfügbar');
  await expect(launch).toContainText('Herkunft: Home [1:10:3]');
  await launch.getByRole('button', { name: 'Werft öffnen', exact: true }).click();
  await expect(launch).toBeHidden();
  await expect(shipyard).toBeVisible();
  expect(api.commands.slice(0, 2)).toEqual([
    { kind: 'shipyard', action: 'build', body: { colony_id: 1, type: 'small_cargo', count: 2 }, csrf: 'session-test' },
    { kind: 'shipyard', action: 'build', body: { colony_id: 1, type: 'small_cargo', count: 2 }, csrf: 'session-test' },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('shipyard builds existing blueprints, follows origin changes and removes private state on expiry', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-shipyard]').click();
  await expect(page.locator('#game-command-overlay')).toBeHidden();
  const shipyard = page.locator('[data-domain="shipyard"]');
  const blueprint = shipyard.locator('[data-ship-type="bp_7"]');
  await expect(blueprint).toContainText('Bauplan');
  await blueprint.getByRole('spinbutton').fill('3');
  await blueprint.getByRole('button', { name: 'Schiffe bauen', exact: true }).click();
  await expect(shipyard.getByRole('list', { name: 'Schiffsbauwarteschlange', exact: true })).toContainText('3 Blueprint Scout');
  expect(api.commands).toEqual([
    { kind: 'shipyard', action: 'build', body: { colony_id: 1, type: 'bp_7', count: 3, blueprint_id: 7 }, csrf: 'session-test' },
  ]);
  await blueprint.getByRole('spinbutton').fill('7');
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await page.keyboard.press('Escape');
  await expect(shipyard).toContainText('Frontier [2:20:4]');
  await expect(blueprint.getByRole('spinbutton')).toHaveValue('1');
  api.expire();
  await shipyard.getByRole('button', { name: 'Werft aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(shipyard).toHaveCount(0);
  expect(await page.evaluate(() => !!window.GQGame)).toBe(false);
  expect(api.commands).toHaveLength(1);
});

test('mobile map fleet endpoints expose canonical missions, guarded recall and explicit arrivals without a window', async ({ page }) => {
  const api = await mockSession(page, { fleetMissions: [fleetMission()] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  const context = page.locator('#game-fleet-context');
  await page.locator('#game-fleet-markers [data-endpoint="1:10:*"]').click();
  await context.getByRole('button', { name: 'Herkunft im Spielfeld', exact: true }).click();
  const origin = page.locator('#game-fleet-markers [data-endpoint="1:10:3"]');
  await expect(origin).toBeVisible();
  await origin.click();
  await expect(context).toContainText('Cargo Seven');
  await expect(context).toContainText('2 small cargo');
  await expect(context).toContainText('100 Metall');
  await expect(context).toContainText('2000-01-01 11:00:00 (Serverzeit)');
  expect(api.commands).toHaveLength(0);
  api.failRefresh();
  await context.getByRole('button', { name: 'Flotte zurückrufen', exact: true }).click();
  await expect(context.getByRole('alert')).toContainText('Befehl bestätigt');
  await expect(context.getByRole('button', { name: 'Flotte zurückrufen', exact: true })).toBeDisabled();
  api.recover();
  await context.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(context).toContainText('Rückflug');
  expect(api.commands).toEqual([
    { kind: 'fleet', action: 'recall', body: { fleet_id: 7 }, csrf: 'session-test' },
  ]);
  await context.getByRole('button', { name: 'Ziel im Spielfeld', exact: true }).click();
  const target = page.locator('#game-fleet-markers [data-endpoint="2:20:4"]');
  await expect(target).toBeVisible();
  await target.click();
  await expect(context).toContainText('Rückflug');
  await page.keyboard.press('Escape');
  await expect(context).toBeHidden();
  await expect(page.locator('#starfield')).toBeFocused();
  await expect(page.locator('#game-camera-path [aria-current="location"]')).toHaveAttribute('data-level', 'system');
  await openCommand(page);
  await page.locator('[data-game-fleet-launch]').click();
  const launch = page.locator('#game-fleet-command');
  await launch.getByRole('button', { name: 'Ziel im Spielfeld wählen', exact: true }).click();
  await expect(page.locator('#game-fleet-markers')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-fleet-markers')).toBeVisible();
  await launch.getByRole('button', { name: 'Flottensteuerung schließen', exact: true }).click();
  await target.click();
  await context.getByRole('button', { name: 'Fällige Ankünfte verarbeiten', exact: true }).click();
  await expect(page.locator('#game-fleet-markers button')).toHaveCount(0);
  await expect(context).toBeHidden();
  await expect.poll(() => page.evaluate(() =>
    window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native._gameFrameHooks.size)).toBe(0);
  expect(api.commands[1]).toEqual({ kind: 'fleet', action: 'check', body: {}, csrf: 'session-test' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('map fleet read failures offer recovery and session expiry removes all endpoint controls', async ({ page }) => {
  const api = await mockSession(page, { fleetMissions: [fleetMission()] });
  api.failFleetList();
  await page.goto('/');
  await page.locator('#start-resume').click();
  const status = page.locator('#game-fleet-map-status');
  await expect(status.getByRole('alert')).toHaveText('Fleet list unavailable');
  await expect(page.locator('#game-fleet-markers button')).toHaveCount(0);
  api.recoverFleetList();
  await status.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(status).toBeHidden();
  await page.locator('#game-fleet-markers button').click();
  const context = page.locator('#game-fleet-context');
  api.expire();
  await context.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(context).toHaveCount(0);
  await expect(page.locator('#game-fleet-markers')).toHaveCount(0);
  await expect(page.locator('#game-fleet-map-status')).toHaveCount(0);
  expect(api.commands).toHaveLength(0);
});

test('fleet overlay shows account-wide missions, opens map targets and submits explicit CSRF commands', async ({ page }) => {
  const api = await mockSession(page, { fleetMissions: [fleetMission()] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-fleets]').click();
  const fleets = page.locator('[data-domain="fleets"]');
  await expect(fleets).toContainText('Cargo Seven');
  await expect(fleets).toContainText('2 small cargo');
  await expect(fleets).toContainText('100 Metall');
  expect(api.commands).toHaveLength(0);
  await openCommand(page);
  await page.locator('#game-colony-select').selectOption('2');
  await expect(fleets).toContainText('Cargo Seven');
  await fleets.getByRole('button', { name: 'Ziel im Spielfeld', exact: true }).click();
  await expect(fleets).toBeHidden();
  await expect(page.locator('#game-galaxy-selection')).toContainText('Star 20');
  await openCommand(page);
  await page.locator('#wm-task-fleet').click();
  await page.keyboard.press('Escape');
  await expect(fleets).toBeVisible();
  await fleets.getByRole('button', { name: 'Flotte zurückrufen', exact: true }).click();
  await expect(fleets).toContainText('Rückflug');
  await expect(fleets.getByRole('button', { name: 'Flotte zurückrufen', exact: true })).toBeDisabled();
  expect(api.commands).toEqual([
    { kind: 'fleet', action: 'recall', body: { fleet_id: 7 }, csrf: 'session-test' },
  ]);
  await fleets.getByRole('button', { name: 'Fällige Ankünfte verarbeiten', exact: true }).click();
  await expect(fleets).toContainText('Keine laufenden Flottenmissionen.');
  expect(api.commands[1]).toEqual({ kind: 'fleet', action: 'check', body: {}, csrf: 'session-test' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('fleet errors remain explicit and accepted recalls are not resubmitted after failed refresh or expiry', async ({ page }) => {
  const api = await mockSession(page, { fleetMissions: [fleetMission()] });
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-fleets]').click();
  const fleets = page.locator('[data-domain="fleets"]');
  await expect(fleets).toContainText('Cargo Seven');
  api.failFleetList();
  await fleets.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(fleets.getByRole('alert')).toHaveText('Fleet list unavailable');
  await expect(fleets).toContainText('Cargo Seven');
  await expect(fleets.getByRole('button', { name: 'Flotte zurückrufen', exact: true })).toBeDisabled();
  api.recoverFleetList();
  await fleets.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(fleets.getByRole('button', { name: 'Flotte zurückrufen', exact: true })).toBeEnabled();
  api.failRefresh();
  await fleets.getByRole('button', { name: 'Flotte zurückrufen', exact: true }).click();
  await expect(fleets.getByRole('alert')).toContainText('Befehl bestätigt, Aktualisierung fehlgeschlagen');
  await expect(fleets.getByRole('alert')).toContainText('nicht erneut beauftragen');
  await expect(fleets.getByRole('button', { name: 'Flotte zurückrufen', exact: true })).toBeDisabled();
  expect(api.commands).toHaveLength(1);
  api.recover();
  await fleets.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(fleets).toContainText('Rückflug');
  expect(api.commands).toHaveLength(1);
  api.rejectCommand();
  await fleets.getByRole('button', { name: 'Fällige Ankünfte verarbeiten', exact: true }).click();
  await expect(fleets.getByRole('alert')).toHaveText('Recall rejected by server');
  await expect(fleets).toContainText('Cargo Seven');
  expect(api.commands).toHaveLength(2);
  api.expire();
  await fleets.getByRole('button', { name: 'Flotten aktualisieren', exact: true }).click();
  await expect(page.locator('body')).toHaveClass(/auth-page/);
  await expect(page.locator('[data-domain="fleets"]')).toHaveCount(0);
  expect(await page.evaluate(() => !!window.GQGame)).toBe(false);
});

test('an accepted economic change with failed HUD refresh is not resubmitted on recovery', async ({ page }) => {
  const api = await mockSession(page);
  await page.goto('/');
  await page.locator('#start-resume').click();
  await openCommand(page);
  await page.locator('[data-game-economy]').click();
  const panel = page.locator('[data-domain="economy"]');
  await expect(panel.getByLabel('Wirtschaftspolitik', { exact: true })).toHaveValue('free_market');
  api.failRefresh();
  await panel.getByLabel('Wirtschaftspolitik', { exact: true }).selectOption('autarky');
  await panel.getByRole('button', { name: 'Wirtschaftspolitik speichern' }).click();
  await expect(panel.getByRole('alert')).toContainText('Auftrag bestätigt');
  api.recover();
  await panel.getByRole('button', { name: 'Aktualisieren', exact: true }).click();
  await expect(panel.getByLabel('Wirtschaftspolitik', { exact: true })).toHaveValue('autarky');
  expect(api.commands).toHaveLength(1);
});
