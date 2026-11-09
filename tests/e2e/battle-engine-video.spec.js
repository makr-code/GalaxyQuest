const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

const enabled = process.env.GQ_RUN_BATTLE_E2E === '1';

test('records native QA battle replay without preview-time server mutations', async (
  { browser, baseURL },
  testInfo,
) => {
  test.skip(!enabled, 'Battle engine video E2E requires explicit opt-in with a live WebGPU game server.');

  const videoDirectory = testInfo.outputPath('battle-video');
  await fs.mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();
  const pageErrors = [];
  const backendWrites = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.addInitScript(() => { window.__GQ_E2E_MODE = true; });
    await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#start-login').click();
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 20_000 });
    await page.locator('#login-username').fill('default_user');
    await page.locator('#login-password').fill('User!23456');
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator('#game-overlay-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });

    const rendererHandle = await page.waitForFunction(() => {
      if (window.galaxy3d) return 'ready';
      const status = document.querySelector('#game-renderer-status');
      const message = status?.textContent || '';
      return status?.getAttribute('role') === 'alert'
        && /webgpu|gpuadapter|requestdevice|dxcompiler/i.test(message) ? 'unavailable' : false;
    }, null, { timeout: 30_000 });
    const rendererState = await rendererHandle.jsonValue();
    test.skip(rendererState !== 'ready', 'A WebGPU renderer is required for the native battle engine.');

    await page.locator('#game-command-toggle').click();
    await expect(page.locator('#topbar-home-btn')).toBeVisible();
    await page.locator('#topbar-home-btn').click();
    await expect(page.locator('#game-camera-view')).toContainText('Sternsystem', { timeout: 30_000 });
    await page.locator('#game-command-toggle').click();
    await expect(page.locator('#game-command-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.waitForFunction(
      () => window.galaxy3d?.getRenderStats?.().cameraControl?.transitioning === false,
      null,
      { timeout: 10_000 },
    );
    expect(await page.evaluate(() =>
      typeof window.__GQ_AUTH_GALAXY_BG_RUNTIME?.renderer?._native?.startHeroBattlePreview === 'function')).toBe(true);

    page.on('request', request => {
      if (request.method() !== 'GET' && request.method() !== 'HEAD') {
        backendWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });



    const initial = await page.evaluate(async () => {
      const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
      const preview = await renderer.startHeroBattlePreview({
        seed: 465192519,
        durationMs: 12_000,
        view: 'near',
        shipCount: 8,
        primitiveBudget: 128,
        audio: false,
        reducedMotion: false,
      });
      window.__GQ_BATTLE_ENGINE_E2E_PREVIEW = preview;
      return preview.getStats();
    });
    expect(initial.ships).toBe(8);
    expect(initial.hero.seed).toBe(465192519);
    expect(initial.hero.view).toBe('near');
    expect(initial.hero.formation).toBe('mixed');
    await page.waitForTimeout(4500);
    await testInfo.attach('battle-engine-frame.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.waitForFunction(
      () => window.__GQ_BATTLE_ENGINE_E2E_PREVIEW?.getStats().stopped === true,
      null,
      { timeout: 30_000 },
    );
    const final = await page.evaluate(async () => {
      const preview = window.__GQ_BATTLE_ENGINE_E2E_PREVIEW;
      const finished = await preview.finished;
      return { finished, stats: preview.getStats() };
    });

    expect(final.finished.cleaned).toBe(true);
    expect(final.stats.hero.replayTime).toBe(12);
    expect(final.stats.hero.shots).toBeGreaterThan(0);
    expect(final.stats.hero.outcomes.miss + final.stats.hero.outcomes.shield
      + final.stats.hero.outcomes.hull).toBe(final.stats.hero.shots);
    expect(final.stats.hero.presentation.enabled).toBe(true);
    expect(final.stats.hero.audio.enabled).toBe(false);
    expect(final.stats.activeEffects).toBe(0);
    expect(backendWrites).toEqual([]);
    expect(pageErrors).toEqual([]);

    await testInfo.attach('battle-engine-result.json', {
      body: Buffer.from(JSON.stringify({ initial, final }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(async () => {
        const preview = window.__GQ_BATTLE_ENGINE_E2E_PREVIEW;
        if (!preview) return;
        preview.stop();
        await preview.finished;
      });
    }
    await context.close();
    if (video) {
      const videoPath = testInfo.outputPath('battle-engine-e2e.webm');
      await video.saveAs(videoPath);
      await testInfo.attach('battle-engine-e2e.webm', { path: videoPath, contentType: 'video/webm' });
    }
  }
});


test('records the Fleet UI encounter replay through the native renderer', async (
  { browser, baseURL },
  testInfo,
) => {
  test.skip(!enabled, 'Battle replay video E2E requires explicit opt-in with a live WebGPU game server.');

  const reportId = 465192520;
  const encounterId = 465192520;
  const videoDirectory = testInfo.outputPath('battle-replay-video');
  await fs.mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
    recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();
  const pageErrors = [];
  const backendWrites = [];
  let reportReads = 0;
  let encounterReads = 0;
  let encounter;
  const reportRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/reports.php')) {
      reportRequests.push(request.url());
    }
  });
  await page.route('**/reports.php*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('action') !== 'battle_reports') {
      await route.continue();
      return;
    }
    reportReads += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        battle_reports: [{
          id: reportId,
          role: 'attacker',
          replay_available: true,
          created_at: '2026-11-08 14:00:00',
          report: { attacker_wins: true },
        }],
      }),
    });
  });
  await page.route('**/fleet.php*', async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('action') !== 'battle_encounter'
      || requestUrl.searchParams.get('report_id') !== String(reportId)) {
      await route.continue();
      return;
    }
    encounterReads += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, encounter }),
    });
  });

  try {
    await page.addInitScript(() => { window.__GQ_E2E_MODE = true; });
    await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#start-login').click();
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 20_000 });
    await page.locator('#login-username').fill('default_user');
    await page.locator('#login-password').fill('User!23456');
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator('#game-overlay-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });

    const rendererHandle = await page.waitForFunction(() => {
      if (window.galaxy3d) return 'ready';
      const status = document.querySelector('#game-renderer-status');
      const message = status?.textContent || '';
      return status?.getAttribute('role') === 'alert'
        && /webgpu|gpuadapter|requestdevice|dxcompiler/i.test(message) ? 'unavailable' : false;
    }, null, { timeout: 30_000 });
    const rendererState = await rendererHandle.jsonValue();
    test.skip(rendererState !== 'ready', 'A WebGPU renderer is required for the native battle replay.');

    await page.locator('#game-command-toggle').click();
    await page.locator('#topbar-home-btn').click();
    await expect(page.locator('#game-camera-view')).toContainText('Sternsystem', { timeout: 30_000 });
    await page.waitForFunction(
      () => window.galaxy3d?.getRenderStats?.().cameraControl?.transitioning === false,
      null,
      { timeout: 10_000 },
    );
    const coordinates = await page.locator('#game-overlay-shell .game-resource-context span').textContent();
    const match = coordinates?.match(/\[(\d+):(\d+):(\d+)\]/);
    expect(match).not.toBeNull();
    const [, galaxy, system, position] = match;
    const target = { galaxy: Number(galaxy), system: Number(system), position: Number(position) };
    encounter = {
      id: encounterId,
      schema_version: 1,
      rule_version: 'legacy-v1',
      status: 'resolved',
      revision: 2,
      battle_report_id: reportId,
      participants: [
        { side: 'attacker', initial_ships: { light_fighter: 2, cruiser: 1 } },
        { side: 'defender', initial_ships: { light_fighter: 2 } },
      ],
      events: [
        { event_type: 'encounter_created', payload: { target } },
        {
          event_type: 'encounter_resolved',
          payload: { battle_report_id: reportId, attacker_wins: true, illustrative_rounds: true },
        },
      ],
      outcome: {
        version: 1,
        attacker_wins: true,
        attacker_ships: { light_fighter: 2, cruiser: 1 },
        attacker_lost: { light_fighter: 1, cruiser: 0 },
        attacker_survivors: { light_fighter: 1, cruiser: 1 },
        defender_ships: { light_fighter: 2 },
        defender_lost: { light_fighter: 1 },
        rounds: [
          { round: 1, attacker_pressure: 12, defender_pressure: 8 },
          { round: 2, attacker_pressure: 10, defender_pressure: 6 },
          { round: 3, attacker_pressure: 9, defender_pressure: 4 },
          { round: 4, attacker_pressure: 7, defender_pressure: 3 },
          { round: 5, attacker_pressure: 5, defender_pressure: 0 },
        ],
      },
    };

    page.on('request', request => {
      if (request.method() !== 'GET' && request.method() !== 'HEAD') {
        backendWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await page.locator('#game-command-toggle').click();
    await expect(page.locator('#game-command-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#game-command-toggle').click();
    await page.locator('[data-window-id="fleet"]').click();
    await page.getByRole('button', { name: 'Schlachtberichte aktualisieren' }).click();
    await page.waitForTimeout(1000);
    expect(reportReads, `Report API requests observed: ${reportRequests.join(', ')}`).toBeGreaterThan(0);
    const replayButton = page.locator(`[data-battle-replay-report="${reportId}"]`);
    await expect(replayButton).toBeVisible({ timeout: 30_000 });
    await replayButton.click();

    const presentation = page.locator(`[data-battle-encounter-presentation="${encounterId}"]`);
    await expect(presentation).toBeVisible({ timeout: 30_000 });
    await expect(presentation).toContainText(`Schlachtbericht #${reportId}`);
    await expect(presentation).toContainText('Aggregierter Druck: R1 Angreifer 12');
    await expect(presentation).toContainText('Angreifer 3 → 2 (1 verloren)');
    await expect(presentation).toContainText('Verteidiger 2 → 1 (1 verloren)');
    await expect(presentation).toContainText('keine einzelnen Schüsse oder Treffer');
    expect(reportReads).toBeGreaterThan(0);
    expect(encounterReads).toBe(1);

    await page.waitForTimeout(3600);
    await testInfo.attach('battle-encounter-replay-frame.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await expect(presentation).toHaveCount(0, { timeout: 15_000 });
    expect(backendWrites).toEqual([]);
    expect(pageErrors).toEqual([]);

    await testInfo.attach('battle-encounter-replay-result.json', {
      body: Buffer.from(JSON.stringify({ target, reportReads, encounterReads }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    if (!page.isClosed()) {
      const closeReplay = page.getByRole('button', { name: 'Replay schließen' });
      if (await closeReplay.count()) await closeReplay.click();
    }
    await context.close();
    if (video) {
      const videoPath = testInfo.outputPath('battle-encounter-replay-e2e.webm');
      await video.saveAs(videoPath);
      await testInfo.attach('battle-encounter-replay-e2e.webm', {
        path: videoPath,
        contentType: 'video/webm',
      });
    }
  }
});
