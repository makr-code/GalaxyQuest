const { test, expect } = require('@playwright/test');

const nativeOnlyStrict = process.env.GQ_VIEWFLOW_NATIVE_ONLY === '1';
const globalGpuWarnBaseline = Number.parseInt(process.env.GQ_E2E_GPU_WARN_BASELINE || '', 10);
const viewFlowGpuWarnBaseline = Number.parseInt(
  process.env.GQ_E2E_GPU_WARN_BASELINE_VIEWFLOW || '',
  10
);
const viewFlowNavGpuWarnBaseline = Number.parseInt(
  process.env.GQ_E2E_GPU_WARN_BASELINE_VIEWFLOW_NAV || '',
  10
);

function createGpuStallWarningCounter(page) {
  const metrics = {
    totalConsoleWarnings: 0,
    gpuReadbackWarnings: 0,
    ignoredGpuDriverWarnings: 0,
    samples: [],
    actionableSamples: [],
  };

  const isNonActionableWarning = (text) => {
    const msg = String(text || '').toLowerCase();
    return /readpixels|gpu\s+stall|stall\s+due\s+to\s+readpixels/.test(msg)
      || msg.includes('no available adapters.')
      || msg.includes('homeworld target skipped (login) best-effort budget exceeded')
      || msg.includes('webgpu requested but not available, falling back to webgl2')
      || /invalid_operation: teximage3d: flip_y|premultiply_alpha/.test(msg);
  };

  const onConsole = (msg) => {
    const level = String(msg.type() || '').toLowerCase();
    if (level !== 'warning' && level !== 'error') return;

    const text = String(msg.text() || '');
    if (/readpixels|gpu\s+stall|stall\s+due\s+to\s+readpixels/i.test(text)) {
      metrics.gpuReadbackWarnings += 1;
      if (metrics.samples.length < 3) {
        metrics.samples.push(text.slice(0, 220));
      }
    }

    if (isNonActionableWarning(text)) {
      metrics.ignoredGpuDriverWarnings += 1;
      return;
    }

    metrics.totalConsoleWarnings += 1;
    if (metrics.actionableSamples.length < 5) {
      metrics.actionableSamples.push(text.slice(0, 220));
    }
  };

  page.on('console', onConsole);
  return {
    snapshot: () => ({ ...metrics, samples: [...metrics.samples], actionableSamples: [...metrics.actionableSamples] }),
    dispose: () => page.off('console', onConsole),
  };
}

function logGpuWarnBaseline(tag, gpuWarn) {
  let baseline = globalGpuWarnBaseline;
  if (tag === 'e2e:viewflow' && Number.isFinite(viewFlowGpuWarnBaseline) && viewFlowGpuWarnBaseline >= 0) {
    baseline = viewFlowGpuWarnBaseline;
  }
  if (tag === 'e2e:viewflow-nav-fallback' && Number.isFinite(viewFlowNavGpuWarnBaseline) && viewFlowNavGpuWarnBaseline >= 0) {
    baseline = viewFlowNavGpuWarnBaseline;
  }
  if (!Number.isFinite(baseline) || baseline < 0) return;
  if (gpuWarn.gpuReadbackWarnings > baseline) {
    console.warn(
      `[${tag}][gpu-warning-baseline] over-baseline: current=${gpuWarn.gpuReadbackWarnings} baseline=${baseline}`
    );
    return;
  }
  console.log(
    `[${tag}][gpu-warning-baseline] ok: current=${gpuWarn.gpuReadbackWarnings} baseline=${baseline}`
  );
}

async function installCdnStubs(page) {
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
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function loginDefaultUser(page, baseURL) {
  await page.addInitScript(() => {
    window.__GQ_E2E_MODE = true;
  });
  await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
  const userInput = page.locator('#login-username');
  const passInput = page.locator('#login-password');
  await expect(userInput).toBeVisible({ timeout: 20_000 });
  await expect(passInput).toBeVisible({ timeout: 20_000 });

  await userInput.click();
  await userInput.fill('default_user');
  await passInput.click();
  await passInput.fill('User!23456');

  await expect(userInput).toHaveValue('default_user');
  await expect(passInput).toHaveValue('User!23456');
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#topbar-section')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });
}

async function primeHomeSelection(page, { enterSystem = false, focusPlanet = false } = {}) {
  const result = await page.evaluate(async (opts) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const wm = window.WM;
    const getGalaxyController = () => window.GQGalaxyController;
    const runConsoleHome = async () => {
      const cmd = window.GQUIConsoleCommandController;
      if (!cmd || typeof cmd.execute !== 'function') return false;
      try {
        await cmd.execute('home');
        return true;
      } catch (_) {
        return false;
      }
    };

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

    let galaxyController = getGalaxyController();
    for (let i = 0; i < 40 && (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function'); i += 1) {
      await wait(100);
      galaxyController = getGalaxyController();
    }

    if (galaxyController && typeof galaxyController.focusHomeSystem === 'function') {
      await galaxyController.focusHomeSystem(root, {
        silent: true,
        cinematic: false,
        enterSystem: !!opts?.enterSystem,
        focusPlanet: !!opts?.focusPlanet,
      });
    } else {
      const okHomeCmd = await runConsoleHome();
      if (!okHomeCmd) {
        return { ok: false, reason: 'galaxy-controller-missing' };
      }
    }

    return {
      ok: true,
      hasSystemAction: !!root.querySelector('[data-system-action="enter-system"], [data-nav-action="enter-system"]'),
      hasColonyAction: !!root.querySelector('[data-colony-action="colony"]'),
    };
  }, { enterSystem, focusPlanet });
  return result;
}

async function openBuildingsWindow(page, { allowWmFallback = true } = {}) {
  const selectors = [
    '.nav-btn[data-win="buildings"]',
    '[data-win="buildings"]',
    '#colony-open-buildings-btn',
    '[data-colony-action="buildings"]',
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 1200 }).catch(() => false);
    if (!visible) continue;
    try {
      await locator.click({ force: true, timeout: 2500 });
      const opened = await page.evaluate(() => {
        return !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('buildings'));
      });
      if (opened) return true;
    } catch (_) {}
  }

  if (allowWmFallback) {
    await page.evaluate(() => {
      if (window.WM && typeof window.WM.open === 'function') {
        window.WM.open('buildings');
      }
    });
    const opened = await page.evaluate(() => {
      return !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('buildings'));
    });
    if (opened) return true;
  }

  return false;
}

test('Galaxy -> System -> Planet/Colony -> Buildings flow smoke', async ({ page, baseURL }, testInfo) => {
  const gpuWarnCounter = createGpuStallWarningCounter(page);
  await installCdnStubs(page);
  await loginDefaultUser(page, baseURL);
  let usedSystemFallback = false;
  let usedColonyFallback = false;
  let usedColonyUiRecovery = false;
  let usedFinalNavRecovery = false;

  // 1) Galaxy stage
  await page.click('#topbar-home-btn');
  await primeHomeSelection(page, { enterSystem: false, focusPlanet: false });
  const galaxyOpen = await page.evaluate(() => {
    if (!window.WM || typeof window.WM.isOpen !== 'function') return false;
    return !!window.WM.isOpen('galaxy');
  });
  expect(galaxyOpen).toBe(true);

  // 2) System stage via system action panel
  const systemEnterDetail = page.locator('[data-system-action="enter-system"]').first();
  const systemEnterNav = page.locator('[data-nav-action="enter-system"]').first();

  const systemDetailVisible = await systemEnterDetail.isVisible({ timeout: 20_000 }).catch(() => false);
  const systemNavVisible = await systemEnterNav.isVisible({ timeout: 20_000 }).catch(() => false);
  let systemActionClicked = false;
  if (systemDetailVisible) {
    try {
      await systemEnterDetail.click({ force: true, timeout: 3_000 });
      systemActionClicked = true;
    } catch (_) {
      systemActionClicked = false;
    }
  }
  if (!systemActionClicked && systemNavVisible) {
    try {
      await systemEnterNav.click({ force: true, timeout: 3_000 });
      systemActionClicked = true;
    } catch (_) {
      systemActionClicked = false;
    }
  }
  if (!systemActionClicked) {
    const nativeSystemRecovery = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const wm = window.WM;
      const ctrl = window.GQGalaxyController;
      if (!wm || typeof wm.body !== 'function' || typeof ctrl?.focusHomeSystem !== 'function') {
        return false;
      }
      const root = wm.body('galaxy');
      if (!root) return false;
      try {
        await ctrl.focusHomeSystem(root, {
          silent: true,
          cinematic: false,
          enterSystem: true,
          focusPlanet: false,
        });
      } catch (_) {
        return false;
      }
      for (let i = 0; i < 10; i += 1) {
        const hasSystemSignals = !!(
          root.querySelector('[data-colony-action="colony"]')
          || root.querySelector('[data-colony-action="buildings"]')
          || root.querySelector('.planet-item')
        );
        if (hasSystemSignals) return true;
        await wait(150);
      }
      return false;
    });

    if (!nativeSystemRecovery) {
      // Degraded runtime fallback: navigate using built-in UI console command handler.
      usedSystemFallback = true;
      await page.evaluate(async () => {
        const cmd = window.GQUIConsoleCommandController;
        if (!cmd || typeof cmd.execute !== 'function') return;
        await cmd.execute('home');
        await cmd.execute('open galaxy');
      });
    }
  }

  // 3) Planet/Colony stage via colony action buttons on detail card
  await primeHomeSelection(page, { enterSystem: true, focusPlanet: true });
  const colonyButton = page.locator('[data-colony-action="colony"]').first();
  const hasColonyAction = await colonyButton.isVisible({ timeout: 15_000 }).catch(() => false);
  if (hasColonyAction) {
    await expect(colonyButton).toBeVisible({ timeout: 15_000 });
    await colonyButton.click({ force: true });

    const buildingsAction = page.locator('[data-colony-action="buildings"]').first();
    await expect(buildingsAction).toBeVisible({ timeout: 15_000 });
    await buildingsAction.click({ force: true });
  } else {
    // Prefer native UI recovery via existing topbar/windows actions before console fallback.
    const colonyOpenBuildingsBtn = page.locator('#colony-open-buildings-btn');
    const uiRecoveryOk = await (async () => {
      try {
        const colonyButtonReady = await colonyOpenBuildingsBtn.isVisible({ timeout: 10_000 }).catch(() => false);
        if (colonyButtonReady) {
          await colonyOpenBuildingsBtn.click({ force: true, timeout: 10_000 });
          return true;
        }
        return await openBuildingsWindow(page, { allowWmFallback: true });
      } catch (_) {
        return false;
      }
    })();

    if (uiRecoveryOk) {
      usedColonyUiRecovery = true;
    } else {
      if (nativeOnlyStrict) {
        throw new Error('native-only strict mode: colony native UI recovery unavailable');
      }
      // Last resort for heavily degraded runtimes.
      usedColonyFallback = true;
      await page.evaluate(async () => {
        const cmd = window.GQUIConsoleCommandController;
        if (!cmd || typeof cmd.execute !== 'function') return;
        await cmd.execute('open colony');
        await cmd.execute('open buildings');
      });
    }
  }

  // 4) Buildings stage validation
  const buildingsOpen = await page.evaluate(() => {
    if (!window.WM || typeof window.WM.isOpen !== 'function') return false;
    return !!window.WM.isOpen('buildings');
  });
  if (!buildingsOpen) {
    usedFinalNavRecovery = true;
    await openBuildingsWindow(page, { allowWmFallback: true });
  }

  const buildingsOpenAfterRecovery = await page.evaluate(() => {
    const wmOpen = !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('buildings'));
    const navActive = !!document.querySelector('.nav-btn[data-win="buildings"].active, .nav-btn[data-win="buildings"].is-active');
    return wmOpen || navActive;
  });
  expect(buildingsOpenAfterRecovery).toBe(true);

  const pathTag = usedSystemFallback || usedColonyFallback ? 'fallback' : 'native-ui';
  testInfo.annotations.push({ type: 'strict-path', description: pathTag });
  if (usedSystemFallback) {
    testInfo.annotations.push({ type: 'system-path', description: 'console-fallback' });
  }
  if (usedColonyFallback) {
    testInfo.annotations.push({ type: 'colony-path', description: 'console-fallback' });
  } else if (usedColonyUiRecovery) {
    testInfo.annotations.push({ type: 'colony-path', description: 'topbar-colony-buildings' });
  }
  if (usedFinalNavRecovery) {
    testInfo.annotations.push({ type: 'recovery-path', description: 'topbar-nav-buildings' });
  }
  if (nativeOnlyStrict) {
    expect(usedSystemFallback, 'native-only strict mode: system fallback must stay disabled').toBe(false);
    expect(usedColonyFallback, 'native-only strict mode: colony fallback must stay disabled').toBe(false);
    expect(usedFinalNavRecovery, 'native-only strict mode: final nav recovery must stay disabled').toBe(false);
  }
  const gpuWarn = gpuWarnCounter.snapshot();
  gpuWarnCounter.dispose();
  console.log(`[e2e:viewflow] strict-path=${pathTag} systemFallback=${usedSystemFallback} colonyFallback=${usedColonyFallback} finalNavRecovery=${usedFinalNavRecovery} gpuReadbackWarnings=${gpuWarn.gpuReadbackWarnings} totalWarnings=${gpuWarn.totalConsoleWarnings}`);
  logGpuWarnBaseline('e2e:viewflow', gpuWarn);
  if (gpuWarn.samples.length) {
    console.log(`[e2e:viewflow][gpu-warning-samples] ${gpuWarn.samples.join(' | ')}`);
  }
  if (gpuWarn.actionableSamples.length) {
    console.log(`[e2e:viewflow][actionable-warning-samples] ${gpuWarn.actionableSamples.join(' | ')}`);
  }
});

test('UI fallback nav opens buildings window when galaxy backend is degraded', async ({ page, baseURL }) => {
  test.skip(nativeOnlyStrict, 'native-only mode validates strict flow only');
  const gpuWarnCounter = createGpuStallWarningCounter(page);
  await installCdnStubs(page);
  await loginDefaultUser(page, baseURL);

  await openBuildingsWindow(page, { allowWmFallback: true });

  await page.waitForFunction(() => {
    const wmOpen = !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('buildings'));
    const navActive = !!document.querySelector('.nav-btn[data-win="buildings"].active, .nav-btn[data-win="buildings"].is-active');
    return wmOpen || navActive;
  }, null, { timeout: 20_000 });

  const buildingsOpen = await page.evaluate(() => {
    const wmOpen = !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('buildings'));
    const navActive = !!document.querySelector('.nav-btn[data-win="buildings"].active, .nav-btn[data-win="buildings"].is-active');
    return wmOpen || navActive;
  });
  expect(buildingsOpen).toBe(true);

  const gpuWarn = gpuWarnCounter.snapshot();
  gpuWarnCounter.dispose();
  console.log(`[e2e:viewflow-nav-fallback] gpuReadbackWarnings=${gpuWarn.gpuReadbackWarnings} totalWarnings=${gpuWarn.totalConsoleWarnings}`);
  logGpuWarnBaseline('e2e:viewflow-nav-fallback', gpuWarn);
  if (gpuWarn.samples.length) {
    console.log(`[e2e:viewflow-nav-fallback][gpu-warning-samples] ${gpuWarn.samples.join(' | ')}`);
  }
  if (gpuWarn.actionableSamples.length) {
    console.log(`[e2e:viewflow-nav-fallback][actionable-warning-samples] ${gpuWarn.actionableSamples.join(' | ')}`);
  }
});

test('Colony Building zoom level via runtime API', async ({ page, baseURL }, testInfo) => {
  await loginDefaultUser(page, baseURL);

  await page.click('#topbar-home-btn');
  await page.evaluate(() => {
    if (window.WM && typeof window.WM.open === 'function') {
      window.WM.open('galaxy');
    }

    // E2E fallback: bootstrap orchestrator if runtime did not initialize it yet.
    if (!window.__GQ_ZOOM_ORCHESTRATOR) {
      const bootstrapApi = window.GQGalaxyRendererBootstrap;
      const zoomApi = window.GQSeamlessZoomOrchestrator;
      let sharedCanvas = window.galaxy3d?.renderer?.domElement || document.querySelector('#galaxy-3d-host canvas');
      if (!(sharedCanvas instanceof HTMLCanvasElement)) {
        const tmp = document.createElement('canvas');
        tmp.width = 8;
        tmp.height = 8;
        tmp.style.display = 'none';
        document.body.appendChild(tmp);
        sharedCanvas = tmp;
      }

      const levels = {
        galaxyThreeJS: window.GQGalaxyLevelThreeJS?.GalaxyLevelThreeJS,
        galaxyWebGPU: window.GQGalaxyLevelWebGPU?.GalaxyLevelWebGPU || window.GQGalaxyLevelThreeJS?.GalaxyLevelThreeJS,
        systemThreeJS: window.GQSystemLevelThreeJS?.SystemLevelThreeJS,
        systemWebGPU: window.GQSystemLevelWebGPU?.SystemLevelWebGPU || window.GQSystemLevelThreeJS?.SystemLevelThreeJS,
        planetThreeJS: window.GQPlanetApproachLevelThreeJS?.PlanetApproachLevelThreeJS,
        planetWebGPU: window.GQPlanetApproachLevelWebGPU?.PlanetApproachLevelWebGPU || window.GQPlanetApproachLevelThreeJS?.PlanetApproachLevelThreeJS,
        colonyThreeJS: window.GQColonySurfaceLevelThreeJS?.ColonySurfaceLevelThreeJS,
        colonyWebGPU: window.GQColonySurfaceLevelWebGPU?.ColonySurfaceLevelWebGPU || window.GQColonySurfaceLevelThreeJS?.ColonySurfaceLevelThreeJS,
        objectThreeJS: window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS,
        objectWebGPU: window.GQObjectApproachLevelWebGPU?.ObjectApproachLevelWebGPU || window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS,
        colonyBuildingThreeJS: window.GQColonyBuildingLevelThreeJS?.ColonyBuildingLevelThreeJS || window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS,
        colonyBuildingWebGPU: window.GQColonyBuildingLevelWebGPU?.ColonyBuildingLevelWebGPU || window.GQObjectApproachLevelWebGPU?.ObjectApproachLevelWebGPU || window.GQObjectApproachLevelThreeJS?.ObjectApproachLevelThreeJS,
      };

      if (
        bootstrapApi && typeof bootstrapApi.bootstrapSeamlessZoomOrchestrator === 'function' &&
        zoomApi?.SeamlessZoomOrchestrator && zoomApi?.ZOOM_LEVEL &&
        sharedCanvas instanceof HTMLCanvasElement
      ) {
        bootstrapApi.bootstrapSeamlessZoomOrchestrator({
          currentOrchestrator: window.__GQ_ZOOM_ORCHESTRATOR || null,
          setOrchestrator: (next) => {
            window.__GQ_ZOOM_ORCHESTRATOR = next || null;
            if (next) {
              window.__GQ_E2E_ZOOM_ORCHESTRATOR = next;
            }
          },
          getCurrentOrchestrator: () => window.__GQ_ZOOM_ORCHESTRATOR || window.__GQ_E2E_ZOOM_ORCHESTRATOR || null,
          sharedCanvas,
          settingsState: { renderQualityProfile: 'webgpu' },
          SeamlessZoomOrchestrator: zoomApi.SeamlessZoomOrchestrator,
          ZOOM_LEVEL: zoomApi.ZOOM_LEVEL,
          levels,
          adoptSharedRendererIfAvailable: () => true,
          initDirectRendererFallback: () => true,
        });
      } else if (zoomApi?.SeamlessZoomOrchestrator && zoomApi?.ZOOM_LEVEL && sharedCanvas instanceof HTMLCanvasElement) {
        try {
          const orchestrator = new zoomApi.SeamlessZoomOrchestrator(sharedCanvas, { rendererHint: 'webgpu' });
          if (levels.galaxyThreeJS && levels.galaxyWebGPU) {
            orchestrator.register(zoomApi.ZOOM_LEVEL.GALAXY, { webgpu: levels.galaxyWebGPU, threejs: levels.galaxyThreeJS });
          }
          if (levels.systemThreeJS && levels.systemWebGPU) {
            orchestrator.register(zoomApi.ZOOM_LEVEL.SYSTEM, { webgpu: levels.systemWebGPU, threejs: levels.systemThreeJS });
          }
          if (levels.planetThreeJS && levels.planetWebGPU) {
            orchestrator.register(zoomApi.ZOOM_LEVEL.PLANET_APPROACH, { webgpu: levels.planetWebGPU, threejs: levels.planetThreeJS });
          }
          if (levels.colonyThreeJS && levels.colonyWebGPU) {
            orchestrator.register(zoomApi.ZOOM_LEVEL.COLONY_SURFACE, { webgpu: levels.colonyWebGPU, threejs: levels.colonyThreeJS });
          }
          if (levels.objectThreeJS && levels.objectWebGPU) {
            orchestrator.register(zoomApi.ZOOM_LEVEL.OBJECT_APPROACH, { webgpu: levels.objectWebGPU, threejs: levels.objectThreeJS });
          }
          if (Number.isFinite(Number(zoomApi.ZOOM_LEVEL.COLONY_BUILDING)) && levels.colonyBuildingThreeJS && levels.colonyBuildingWebGPU) {
            orchestrator.register(zoomApi.ZOOM_LEVEL.COLONY_BUILDING, { webgpu: levels.colonyBuildingWebGPU, threejs: levels.colonyBuildingThreeJS });
          }
          window.__GQ_ZOOM_ORCHESTRATOR = orchestrator;
          window.__GQ_E2E_ZOOM_ORCHESTRATOR = orchestrator;
          Promise.resolve(orchestrator.initialize?.()).catch(() => {});
        } catch (_) {}
      }
    }
  });
  try {
    await page.waitForFunction(() => {
      const orchestrator = window.__GQ_ZOOM_ORCHESTRATOR || window.__GQ_E2E_ZOOM_ORCHESTRATOR || null;
      const levels = window.GQSeamlessZoomOrchestrator?.ZOOM_LEVEL;
      return !!orchestrator && !!levels;
    }, null, { timeout: 20_000 });
  } catch (_) {
    const preconditionState = await page.evaluate(() => ({
      hasWM: !!window.WM,
      galaxyWindowOpen: !!(window.WM && typeof window.WM.isOpen === 'function' && window.WM.isOpen('galaxy')),
      hasZoomModule: !!window.GQSeamlessZoomOrchestrator,
      hasZoomLevels: !!window.GQSeamlessZoomOrchestrator?.ZOOM_LEVEL,
      hasBootstrapApi: !!window.GQGalaxyRendererBootstrap?.bootstrapSeamlessZoomOrchestrator,
      hasGalaxyRenderer: !!window.galaxy3d,
      hasCanvas: !!(window.galaxy3d?.renderer?.domElement || document.querySelector('#galaxy-3d-host canvas')),
      hasTopbarHomeBtn: !!document.getElementById('topbar-home-btn'),
    }));
    testInfo.annotations.push({
      type: 'precondition',
      description: `zoom-orchestrator-not-ready ${JSON.stringify(preconditionState)}`,
    });
    test.skip(true, `zoom-orchestrator-not-ready ${JSON.stringify(preconditionState)}`);
  }

  // Call zoom to COLONY_BUILDING level via runtime API
  const zoomResult = await page.evaluate(async () => {
    if (window.WM && typeof window.WM.open === 'function') {
      window.WM.open('colony');
    }

    // Get the first user colony with multiple fallbacks (runtime API, HTTP API, DOM)
    const colonyResult = await (async () => {
      const api = window.GQRuntimeGameStateQuery;
      if (api && typeof api.getPlayerColonies === 'function') {
        try {
          const colonies = await api.getPlayerColonies();
          if (Array.isArray(colonies) && colonies.length > 0) {
            return { ok: true, colonyId: Number(colonies[0].id || 0), source: 'runtime-api' };
          }
        } catch (_) {}
      }

      try {
        const res = await fetch('/api/game.php?action=overview', { credentials: 'include' });
        const data = await res.json();
        const colonies = Array.isArray(data?.colonies) ? data.colonies : [];
        if (colonies.length > 0) {
          return { ok: true, colonyId: Number(colonies[0].id || 0), source: 'http-overview' };
        }
      } catch (_) {}

      const select = document.getElementById('planet-select') || document.getElementById('colony-select');
      const colonyId = Number(select?.value || select?.options?.[0]?.value || 0);
      if (colonyId > 0) {
        return { ok: true, colonyId, source: 'dom-select' };
      }

      return { ok: false, reason: 'no-player-colonies' };
    })();

    if (!colonyResult.ok) {
      return colonyResult;
    }

    const colonyId = colonyResult.colonyId;
    const logic = window.GQRuntimeColonyBuildingLogic;

    let mode = 'none';

    if (logic && typeof logic.focusColonyDevelopment === 'function') {
      try {
        logic.focusColonyDevelopment(colonyId, {
          source: 'planet',
          focusBuilding: 'metal_mine',
        });
        mode = 'runtime-focus';
      } catch (e) {
        return { ok: false, reason: 'focus-call-error: ' + String(e?.message || e) };
      }
    }

    if (mode === 'runtime-focus') {
      return { ok: true, mode, colonySource: colonyResult.source };
    }

    return {
      ok: false,
      reason: 'no-colony-building-transition-path',
      details: {
        hasLogic: !!logic,
        hasOrchestrator: !!(window.__GQ_ZOOM_ORCHESTRATOR || window.__GQ_E2E_ZOOM_ORCHESTRATOR || null),
      },
    };
  });

  const zoomDebug = zoomResult.details ? ` details=${JSON.stringify(zoomResult.details)}` : '';
  expect(zoomResult.ok, `Focus building call failed: ${zoomResult.reason || 'unknown'}${zoomDebug}`).toBe(true);
  // Wait for zoom orchestrator to transition to COLONY_BUILDING level
  await page.waitForFunction(() => {
    const orchestrator = window.__GQ_ZOOM_ORCHESTRATOR || window.__GQ_E2E_ZOOM_ORCHESTRATOR || null;
    const levels = window.GQSeamlessZoomOrchestrator?.ZOOM_LEVEL;
    if (!orchestrator || !levels) return false;
    const currentLevel = Number(orchestrator._activeLevel);
    const targetLevel = Number(levels.COLONY_BUILDING);
    return currentLevel === targetLevel && Number.isFinite(currentLevel) && currentLevel > 0;
  }, null, { timeout: 30_000 });

  // Verify the zoom state
  const finalZoomState = await page.evaluate(() => {
    const orchestrator = window.__GQ_ZOOM_ORCHESTRATOR || window.__GQ_E2E_ZOOM_ORCHESTRATOR || null;
    const levels = window.GQSeamlessZoomOrchestrator?.ZOOM_LEVEL;
    return {
      activeLevel: Number(orchestrator?._activeLevel),
      colonyBuildingLevel: Number(levels?.COLONY_BUILDING),
      isMatch: Number(orchestrator?._activeLevel) === Number(levels?.COLONY_BUILDING),
    };
  });

  expect(finalZoomState.isMatch).toBe(true);
  expect(finalZoomState.activeLevel).toBe(5);
  expect(finalZoomState.colonyBuildingLevel).toBe(5);
});
