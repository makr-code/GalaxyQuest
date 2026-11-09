const { test, expect } = require('@playwright/test');
const { spawn, execFile } = require('node:child_process');
const { randomBytes, randomInt } = require('node:crypto');
const fs = require('node:fs/promises');

function command(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`Isolated Docker command failed: ${stderr || 'command did not complete'}`));
      else resolve(stdout);
    });
  });
}

test('renders real server journal ticks in an isolated WebGPU test', async ({ browser, baseURL }, testInfo) => {
  test.skip(process.env.GQ_RUN_LIVE_SERVER_E2E !== '1', 'Requires explicit opt-in and running Docker services.');
  test.skip(process.env.GQ_LIVE_RENDERER_ISOLATED !== '1',
    'Requires a separate game server and database: game login and on-demand reads can write state.');
  test.setTimeout(120000);
  const username = process.env.GQ_LIVE_RENDERER_USER;
  const passwordForLogin = process.env.GQ_LIVE_RENDERER_PASSWORD;
  if (!username || !passwordForLogin) throw new Error('Isolated renderer test credentials are required.');
  const name = `gq_live_e2e_${randomBytes(8).toString('hex')}`;
  const port = randomInt(20000, 45000);
  const password = await command(['compose', 'exec', '-T', 'db', 'sh', '-c', 'printf %s "$MYSQL_ROOT_PASSWORD"']);
  const env = ['-e', 'DB_HOST=db', '-e', 'DB_PORT=3306', '-e', 'DB_USER=root', '-e', `DB_PASS=${password}`,
    '-e', `DB_NAME=${name}`, '-e', 'XDEBUG_MODE=off'];
  const run = (...args) => command(['compose', 'exec', '-T', ...env, 'web', ...args]);
  let created = false;
  let server = null;
  let serverPid = null;
  let context = null;
  let page = null;
  let video = null;
  let worker = null;
  let workerPid = null;
  let workerExit = null;
  let workerStdout = '';
  let workerStderr = '';
  let workerStopped = false;
  try {
    const fixtureOutput = await run('php', 'tests/e2e/live_battle_server_fixture.php', 'create', name);
    created = true;
    const fixture = JSON.parse(fixtureOutput);
    const inspect = async (id = fixture.id) => JSON.parse(
      await run('php', 'tests/e2e/live_battle_server_fixture.php', 'inspect', name, String(id)),
    );
    server = spawn('docker', ['compose', 'exec', '-T', ...env, '-e', 'LIVE_BATTLE_JOURNAL_READ_ENABLED=1',
      'web', 'sh', '-c', `echo $$; exec php -d session.save_path=/tmp/${name} -S 127.0.0.1:${port} tests/Integration/live_journal_api_router.php`],
    { stdio: ['ignore', 'pipe', 'pipe'] });
    const serverReady = new Promise(resolve => {
      let output = '';
      const timer = setTimeout(() => resolve(new Error('Isolated API server did not start.')), 10000);
      server.stderr.on('data', chunk => {
        output += chunk.toString();
        if (/Development Server .* started/.test(output)) {
          clearTimeout(timer);
          resolve(null);
        }
      });
      server.once('error', error => { clearTimeout(timer); resolve(error); });
      server.once('exit', () => { clearTimeout(timer); resolve(new Error('Isolated API server exited.')); });
    });
    serverPid = await new Promise((resolve, reject) => {
      let output = '';
      server.stdout.on('data', chunk => {
        output += chunk.toString();
        const line = output.split('\n')[0];
        if (output.includes('\n')) {
          if (!/^[1-9][0-9]*$/.test(line.trim())) reject(new Error('Invalid isolated test server PID.'));
          else resolve(Number(line.trim()));
        }
      });
      server.once('error', reject);
      server.once('exit', code => reject(new Error(`Isolated API server exited (${code}).`)));
    });
    const startupError = await serverReady;
    if (startupError) throw startupError;
    await expect.poll(async () => {
      try {
        return (await run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
          `http://127.0.0.1:${port}/api/v1/live_battle_journal.php?action=snapshot&journal_id=${fixture.id}`)).trim();
      } catch {
        return 'not-ready';
      }
    }, { timeout: 10000 }).toBe('401');
    expect(server.exitCode).toBeNull();
    const outsiderStatus = await run('curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
      '-b', `PHPSESSID=${fixture.outsider}`,
      `http://127.0.0.1:${port}/api/v1/live_battle_journal.php?action=snapshot&journal_id=${fixture.id}`);
    expect(outsiderStatus).toBe('404');

    const videoDir = testInfo.outputPath('server-live-video');
    await fs.mkdir(videoDir, { recursive: true });
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 }, serviceWorkers: 'block',
      recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    });
    page = await context.newPage();
    video = page.video();
    const errors = [];
    const writes = [];
    let reads = 0;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/live_battle_journal.php?*', async route => {
      const request = new URL(route.request().url());
      const result = await run('curl', '-sS', '-b', `PHPSESSID=${fixture.session}`,
        '-w', '\n%{http_code}', `http://127.0.0.1:${port}${request.pathname}${request.search}`);
      const split = result.lastIndexOf('\n');
      reads++;
      await route.fulfill({
        status: Number(result.slice(split + 1)), contentType: 'application/json',
        headers: { 'cache-control': 'private, no-store' }, body: result.slice(0, split),
      });
    });
    await page.addInitScript(() => { window.__GQ_E2E_MODE = true; });
    await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#start-login').click();
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(passwordForLogin);
    await page.locator('#login-form button[type="submit"]').click();
    await expect(page.locator('#game-overlay-shell')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30000 });
    await page.waitForFunction(() => window.galaxy3d, null, { timeout: 30000 });
    await page.locator('#game-command-toggle').click();
    await page.locator('#topbar-home-btn').click();
    await expect(page.locator('#game-camera-view')).toContainText('Sternsystem', { timeout: 30000 });
    await page.locator('#game-command-toggle').click();
    await page.waitForFunction(
      () => window.galaxy3d?.getRenderStats?.().cameraControl?.transitioning === false, null, { timeout: 10000 },
    );
    page.on('request', request => {
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method());
    });
    await page.evaluate(async journalId => {
      const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer._native;
      const space = renderer.getSpaceView();
      const body = space.bodies.find(entry => entry.userData.type === 'planet');
      if (!body) throw new Error('No visual anchor body.');
      const pose = { position: space.camera.position.clone(), quaternion: space.camera.quaternion.clone() };
      const center = body.getWorldPosition(space.origin.clone());
      space.camera.position.copy(center).add({ x: 0, y: -body.userData.radius * 18, z: body.userData.radius * 7 });
      space.camera.lookAt(center);
      space.camera.updateMatrixWorld(true);
      const initialIds = new Set(space.spaceEntities.keys());
      const originalFire = space.weaponRenderPass.fire;
      const shots = [];
      space.weaponRenderPass.fire = function (...args) {
        const effect = originalFire.apply(this, args);
        shots.push(effect);
        return effect;
      };
      const api = { get: async endpoint => {
        const response = await fetch(endpoint.replace(/^api\//, '/api/v1/'), { cache: 'no-store' });
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        return response.json();
      } };
      const view = await renderer.startLiveBattleWebGpu(api, journalId, {
        body, onError: ({ error }) => { throw error; },
      });
      window.__GQ_LIVE_SERVER_E2E = { view, space, initialIds, shots, restore: () => {
        space.weaponRenderPass.fire = originalFire;
        space.camera.position.copy(pose.position);
        space.camera.quaternion.copy(pose.quaternion);
        space.camera.updateMatrixWorld(true);
      } };
    }, fixture.id);
    const overlay = page.locator(`[data-live-battle-journal="${fixture.id}"]`);
    await expect(overlay).toContainText('Tick 0', { timeout: 15000 });
    const visible = await page.evaluate(() => {
      const { space, initialIds } = window.__GQ_LIVE_SERVER_E2E;
      return [...space.spaceEntities.values()].filter(entity => !initialIds.has(entity.id)).map(entity => {
        const point = entity.position.clone().sub(space.origin).project(space.camera);
        return { x: point.x, y: point.y, z: point.z };
      });
    });
    expect(visible).toHaveLength(2);
    for (const point of visible) {
      expect(Math.abs(point.x)).toBeLessThan(1);
      expect(Math.abs(point.y)).toBeLessThan(1);
      expect(point.z).toBeGreaterThan(-1);
      expect(point.z).toBeLessThan(1);
    }
    await page.evaluate(() => {
      const fixture = window.__GQ_LIVE_SERVER_E2E;
      fixture.states = [];
      const overlay = document.querySelector('[data-live-battle-journal]');
      fixture.observer = new MutationObserver(() => fixture.states.push(overlay.textContent));
      fixture.observer.observe(overlay, { subtree: true, childList: true, characterData: true });
    });
    await run('php', 'tests/e2e/live_battle_server_fixture.php', 'arm', name);
    const initial = await inspect();
    worker = spawn('docker', [
      'compose', 'exec', '-T', ...env, '-e', 'LIVE_BATTLE_JOURNAL_WORKER_ENABLED=1',
      'web', 'bash', '-c', 'echo $$; exec bash scripts/run_live_battle_journal_worker.sh --limit=1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    worker.stdout.on('data', chunk => { workerStdout += chunk.toString(); });
    worker.stderr.on('data', chunk => { workerStderr += chunk.toString(); });
    workerExit = new Promise(resolve => {
      worker.once('error', error => resolve({ error }));
      worker.once('close', (code, signal) => resolve({ code, signal }));
    });
    await expect.poll(() => workerStdout.includes('\n') || worker.exitCode !== null, { timeout: 10000 }).toBe(true);
    const pidLine = workerStdout.split('\n')[0].trim();
    if (!/^[1-9][0-9]*$/.test(pidLine)) throw new Error('Invalid isolated worker PID.');
    workerPid = Number(pidLine);
    expect(worker.exitCode).toBeNull();
    await expect(overlay).toContainText('Tick 2 · resolved', { timeout: 30000 });
    await expect(overlay).toContainText('defender cruiser: 0');
    expect(worker.exitCode).toBeNull();
    const states = await page.evaluate(() => window.__GQ_LIVE_SERVER_E2E.states);
    expect(states.some(text => text.includes('Tick 1') && text.includes('defender cruiser: 1'))).toBe(true);
    const persisted = await inspect();
    expect(Number(persisted.journal.tick)).toBe(2);
    expect(persisted.journal.status).toBe('resolved');
    expect(persisted.journal.next_tick_at).toBeNull();
    expect(persisted.ticks.map(tick => Number(tick.tick))).toEqual([1, 2]);
    expect(Date.parse(`${persisted.ticks[0].processed_at.replace(' ', 'T')}Z`))
      .toBeGreaterThanOrEqual(Date.parse(`${initial.journal.next_tick_at.replace(' ', 'T')}Z`));
    expect(persisted.ticks.map(tick => tick.events.map(event => ({
      tick: event.tick, hull_damage: event.hull_damage, ships_lost: event.ships_lost,
    })))).toEqual([
      [{ tick: 1, hull_damage: 10, ships_lost: 1 }],
      [{ tick: 2, hull_damage: 10, ships_lost: 1 }],
    ]);
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    const result = await page.evaluate(async () => {
      const test = window.__GQ_LIVE_SERVER_E2E;
      const remainingBefore = [...test.space.spaceEntities.keys()].filter(id => !test.initialIds.has(id)).length;
      test.observer.disconnect();
      test.view.stop();
      const finished = await test.view.finished;
      const remainingAfter = [...test.space.spaceEntities.keys()].filter(id => !test.initialIds.has(id)).length;
      test.restore();
      delete window.__GQ_LIVE_SERVER_E2E;
      return { remainingBefore, remainingAfter, finished, shots: test.shots.length };
    });
    expect(result.remainingBefore).toBe(1);
    expect(result.remainingAfter).toBe(0);
    expect(result.finished.cleaned).toBe(true);
    expect(result.shots).toBeGreaterThanOrEqual(1);
    expect(result.shots).toBeLessThanOrEqual(2);
    await page.close();
    const followup = JSON.parse(await run('php', 'tests/e2e/live_battle_server_fixture.php', 'begin', name));
    expect(followup.id).not.toBe(fixture.id);
    await expect.poll(async () => (await inspect(followup.id)).journal.status, { timeout: 30000 }).toBe('resolved');
    const unattended = await inspect(followup.id);
    expect(unattended.ticks.map(tick => Number(tick.tick))).toEqual([1, 2]);
    expect(unattended.ticks.map(tick => tick.events[0].ships_lost)).toEqual([1, 1]);
    expect(worker.exitCode).toBeNull();
    await expect.poll(() => workerStdout.trim().split('\n').slice(1)
      .filter(Boolean).map(line => JSON.parse(line))
      .reduce((sum, batch) => sum + batch.processed, 0), { timeout: 10000 }).toBe(4);
  } finally {
    const cleanupErrors = [];
    const cleanup = async action => {
      try { await action(); } catch (error) { cleanupErrors.push(error); }
    };
    if (worker) await cleanup(async () => {
      if (workerPid && worker.exitCode === null) await run('kill', '-TERM', String(workerPid));
      if (!workerPid && worker.exitCode === null) throw new Error('Cannot safely stop worker without its PID.');
      let timeout;
      const result = await Promise.race([workerExit, new Promise(resolve => {
        timeout = setTimeout(() => resolve({ error: new Error('Worker did not stop.') }), 10000);
      })]);
      clearTimeout(timeout);
      if (result.error) throw result.error;
      workerStopped = true;
      if (result.code !== 0) throw new Error(`Worker exited (${result.code}, ${result.signal}): ${workerStderr}`);
    });
    if (page && !page.isClosed()) await cleanup(() => page.evaluate(async () => {
      const fixture = window.__GQ_LIVE_SERVER_E2E;
      if (!fixture) return;
      fixture.observer?.disconnect();
      fixture.view.stop();
      try { await fixture.view.finished; } finally { fixture.restore(); }
    }));
    if (context) await cleanup(() => context.close());
    if (video) await cleanup(async () => {
      const path = testInfo.outputPath('server-live-battle.webm');
      await video.saveAs(path);
      await testInfo.attach('server-live-battle.webm', { path, contentType: 'video/webm' });
    });
    if (serverPid && server.exitCode === null) await cleanup(() => run('kill', String(serverPid)));
    if (server && server.exitCode === null) server.kill();
    if (created && (!worker || workerStopped)) {
      await cleanup(() => run('php', 'tests/e2e/live_battle_server_fixture.php', 'drop', name));
    } else if (created) {
      cleanupErrors.push(new Error(`Preserved fixture ${name}: worker termination was not confirmed.`));
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Isolated live battle test cleanup failed.');
  }
});
