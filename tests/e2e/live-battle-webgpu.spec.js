const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

test('renders experimental live journal ticks with native WebGPU and cleans up', async (
  { browser, baseURL }, testInfo,
) => {
  test.skip(process.env.GQ_RUN_BATTLE_E2E !== '1', 'Requires an explicitly enabled WebGPU game server.');
  const videoDirectory = testInfo.outputPath('live-battle-video');
  await fs.mkdir(videoDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
    recordVideo: { dir: videoDirectory, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const video = page.video();
  const errors = [];
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.addInitScript(() => { window.__GQ_E2E_MODE = true; });
    await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#start-login').click();
    await page.locator('#login-username').fill('default_user');
    await page.locator('#login-password').fill('User!23456');
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator('#game-overlay-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });
    await page.waitForFunction(() => window.galaxy3d, null, { timeout: 30_000 });
    await page.locator('#game-command-toggle').click();
    await page.locator('#topbar-home-btn').click();
    await expect(page.locator('#game-camera-view')).toContainText('Sternsystem', { timeout: 30_000 });
    await page.locator('#game-command-toggle').click();
    await page.waitForFunction(
      () => window.galaxy3d?.getRenderStats?.().cameraControl?.transitioning === false,
      null, { timeout: 10_000 },
    );
    page.on('request', request => {
      if (!['GET', 'HEAD'].includes(request.method())) {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });

    await page.evaluate(async () => {
      const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
      const space = renderer.getSpaceView();
      const body = space.bodies.find(entry => entry.userData.type === 'planet');
      if (!body) throw new Error('No planet is available for the test anchor.');
      const center = body.getWorldPosition(space.origin.clone());
      const pose = { position: space.camera.position.clone(), quaternion: space.camera.quaternion.clone() };
      space.camera.position.copy(center).add({ x: 0, y: -body.userData.radius * 18, z: body.userData.radius * 7 });
      space.camera.lookAt(center);
      space.camera.updateMatrixWorld(true);
      const initialIds = new Set(space.spaceEntities.keys());
      const group = count => ({ initial_count: 2, count, shield: 0, hull: count * 10 });
      const state = (tick, defender, status = 'active') => ({
        tick, status, rule_version: 'live-groups-experimental-v1',
        outcome: status === 'active' ? null : 'attacker_wins',
        groups: { attacker: { fighter: group(2) }, defender: { cruiser: group(defender) } },
      });
      let reads = 0;
      const api = {
        get: async endpoint => {
          reads++;
          const params = new URL(endpoint, location.href).searchParams;
          if (params.get('action') === 'snapshot') {
            return { success: true, snapshot: {
              schema_version: 1, journal_id: 17, tick: 0, state: state(0, 2), next_tick_at_utc: null,
            } };
          }
          const previous = Number(params.get('after_tick'));
          const tick = previous + 1;
          const defender = tick === 3 ? 0 : 2;
          return { success: true, page: {
            schema_version: 1, journal_id: 17, latest_tick: tick, next_cursor: tick, has_more: false,
            ticks: [{
              tick, state: state(tick, defender, tick === 3 ? 'resolved' : 'active'),
              events: [{ tick, source_side: 'attacker', target_side: 'defender', target_group: 'cruiser',
                shield_damage: 0, hull_damage: 1, ships_lost: tick === 3 ? 2 : 0 }],
            }],
          } };
        },
      };
      const originalFire = space.weaponRenderPass.fire;
      const shots = [];
      space.weaponRenderPass.fire = function (...args) {
        const effect = originalFire.apply(this, args);
        shots.push(effect);
        return effect;
      };
      const view = await renderer.startLiveBattleWebGpu(api, 17, {
        body, onError: ({ error }) => { throw error; },
      });
      window.__GQ_LIVE_BATTLE_E2E = {
        view, space, initialIds, shots, reads: () => reads,
        restore: () => {
          space.weaponRenderPass.fire = originalFire;
          space.camera.position.copy(pose.position);
          space.camera.quaternion.copy(pose.quaternion);
          space.camera.updateMatrixWorld(true);
        },
      };
    });
    const overlay = page.locator('[data-live-battle-journal="17"]');
    await expect(overlay).toContainText('Tick 0', { timeout: 15_000 });
    const visible = await page.evaluate(() => {
      const { space, initialIds } = window.__GQ_LIVE_BATTLE_E2E;
      return [...space.spaceEntities.values()].filter(entity => !initialIds.has(entity.id)).map(entity => {
        const projected = entity.position.clone().sub(space.origin).project(space.camera);
        return { x: projected.x, y: projected.y, z: projected.z };
      });
    });
    expect(visible).toHaveLength(2);
    for (const point of visible) {
      expect(Math.abs(point.x)).toBeLessThan(1);
      expect(Math.abs(point.y)).toBeLessThan(1);
      expect(point.z).toBeGreaterThan(-1);
      expect(point.z).toBeLessThan(1);
    }
    await expect(overlay).toContainText('Tick 2', { timeout: 15_000 });
    await testInfo.attach('live-battle-frame.png', { body: await page.screenshot(), contentType: 'image/png' });
    await expect(overlay).toContainText('Tick 3 · resolved', { timeout: 15_000 });
    const result = await page.evaluate(async () => {
      const test = window.__GQ_LIVE_BATTLE_E2E;
      const before = {
        shots: test.shots.length,
        reads: test.reads(),
        owned: [...test.space.spaceEntities.keys()].filter(id => !test.initialIds.has(id)).length,
      };
      test.view.stop();
      const finished = await test.view.finished;
      const remaining = [...test.space.spaceEntities.keys()].filter(id => !test.initialIds.has(id)).length;
      test.restore();
      delete window.__GQ_LIVE_BATTLE_E2E;
      return { before, finished, remaining };
    });
    expect(result.before.shots).toBe(3);
    expect(result.before.reads).toBe(4);
    expect(result.before.owned).toBe(1);
    expect(result.finished.cleaned).toBe(true);
    expect(result.remaining).toBe(0);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(async () => {
        const test = window.__GQ_LIVE_BATTLE_E2E;
        if (!test) return;
        test.view.stop();
        try { await test.view.finished; } finally { test.restore(); }
      });
    }
    await context.close();
    if (video) {
      const videoPath = testInfo.outputPath('live-battle-webgpu.webm');
      await video.saveAs(videoPath);
      await testInfo.attach('live-battle-webgpu.webm', { path: videoPath, contentType: 'video/webm' });
    }
  }
});
