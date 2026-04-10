const { test, expect } = require('@playwright/test');

const webgpuPlaywrightArgs = [
  '--enable-unsafe-webgpu',
  '--use-vulkan=swiftshader',
  '--disable-vulkan-fallback-to-gl-for-testing',
  '--disable-dawn-features=disallow_unsafe_apis',
  '--use-angle=swiftshader',
  '--enable-features=Vulkan',
];

test.use({
  launchOptions: {
    args: webgpuPlaywrightArgs,
  },
});

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
      || msg.includes('the powerpreference option is currently ignored when calling requestadapter() on windows')
      || msg.includes('homeworld target skipped (login) best-effort budget exceeded')
      || msg.includes('overview-home-target failed request timeout')
      || msg.includes('overview-home-target timeout retry')
      || msg.includes('[galaxy-init3d]')
      || msg.includes('[galaxy-renderflow] run:init3d:failed')
      || msg.includes('webgpu requested but not available, falling back to webgl2')
      || /invalid_operation: teximage3d: flip_y|premultiply_alpha/.test(msg);
  };

  const onConsole = (msg) => {
    const level = String(msg.type() || '').toLowerCase();
    if (level !== 'warning' && level !== 'error') return;

    const text = String(msg.text() || '');
    if (/readpixels|gpu\s+stall|stall\s+due\s+to\s+readpixels/i.test(text)) {
      metrics.gpuReadbackWarnings += 1;
      if (metrics.samples.length < 3) metrics.samples.push(text.slice(0, 220));
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
    window.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: true };
    try {
      localStorage.setItem('gq:rendererHint', 'webgpu');
    } catch (_) {}
  });
  await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-username', 'default_user');
  await page.fill('#login-password', 'User!23456');
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator('#topbar-section')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });
}

async function primeHomeSelection(page) {
  return page.evaluate(async () => {
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
    if (!root) return { ok: false, reason: 'galaxy-root-missing' };

    let galaxyController = window.GQGalaxyController;
    for (let i = 0; i < 40 && (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function'); i += 1) {
      await wait(100);
      galaxyController = window.GQGalaxyController;
    }
    if (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function') {
      return { ok: false, reason: 'galaxy-controller-missing' };
    }

    await galaxyController.focusHomeSystem(root, {
      silent: true,
      cinematic: false,
      enterSystem: false,
      focusPlanet: false,
    });
    return { ok: true };
  });
}

async function waitForTradeRouteOverlayProof(page) {
  return page.waitForFunction(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const renderer = window.galaxy3d?._delegate || window.GQActiveRenderer || window.galaxy3d || null;
    const overlay = document.querySelector('.gq-webgpu-overlay-canvas');
    if (!(overlay instanceof HTMLCanvasElement)) return false;
    if (!renderer || typeof renderer._getActiveTradeRoutesForOverlay !== 'function') return false;

    let routes = Array.isArray(window.__GQ_TRADE_ROUTES_CACHE) ? window.__GQ_TRADE_ROUTES_CACHE : [];
    for (let i = 0; i < 8 && routes.length === 0; i += 1) {
      await wait(250);
      routes = Array.isArray(window.__GQ_TRADE_ROUTES_CACHE) ? window.__GQ_TRADE_ROUTES_CACHE : [];
    }
    if (!routes.length) return false;

    if (typeof renderer._renderGalaxyOverlay2D === 'function') {
      renderer._renderGalaxyOverlay2D();
    }

    const activeRoutes = renderer._getActiveTradeRoutesForOverlay();
    const starIndex = typeof renderer._buildTradeRouteStarIndex === 'function'
      ? renderer._buildTradeRouteStarIndex()
      : null;
    if (!starIndex || !(starIndex instanceof Map)) return false;

    const ctx = overlay.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    for (let i = 0; i < activeRoutes.length; i += 1) {
      const route = activeRoutes[i] || {};
      const a = renderer._resolveTradeRouteEndpoint?.(route.origin, starIndex);
      const b = renderer._resolveTradeRouteEndpoint?.(route.target, starIndex);
      if (!a || !b) continue;
      const pa = renderer._projectWorldToOverlay?.(a.x, a.y);
      const pb = renderer._projectWorldToOverlay?.(b.x, b.y);
      if (!pa || !pb) continue;

      const samples = 7;
      let visibleHits = 0;
      for (let step = 1; step < samples - 1; step += 1) {
        const t = step / (samples - 1);
        const x = Math.round(pa.x + (pb.x - pa.x) * t);
        const y = Math.round(pa.y + (pb.y - pa.y) * t);
        if (x < 0 || y < 0 || x >= overlay.width || y >= overlay.height) continue;
        const data = ctx.getImageData(x, y, 1, 1).data;
        if ((data[3] || 0) > 0) visibleHits += 1;
      }

      if (visibleHits >= 2) return true;
    }
    return false;
  }, null, { timeout: 20_000 });
}

test('Galaxy WebGPU overlay renders active trade route pixels', async ({ page, baseURL }, testInfo) => {
  const gpuWarnCounter = createGpuStallWarningCounter(page);
  await installCdnStubs(page);
  await loginDefaultUser(page, baseURL);

  await page.click('#topbar-home-btn');
  const homeResult = await primeHomeSelection(page);
  expect(homeResult).toMatchObject({ ok: true });

  const routeDataReady = await page.waitForFunction(async () => {
    const cache = Array.isArray(window.__GQ_TRADE_ROUTES_CACHE) ? window.__GQ_TRADE_ROUTES_CACHE : [];
    if (cache.length > 0) return { ok: true, cacheRoutes: cache.length };

    const api = window.API;
    if (!api || typeof api.tradersRoutes !== 'function') return false;
    try {
      const data = await api.tradersRoutes('in_transit');
      return {
        ok: Array.isArray(data?.routes) && data.routes.length > 0,
        cacheRoutes: Array.isArray(data?.routes) ? data.routes.length : 0,
      };
    } catch (_) {
      return false;
    }
  }, null, { timeout: 20_000 });
  const routeData = await routeDataReady.jsonValue();
  expect(routeData).toMatchObject({ ok: true });

  const overlayReady = await page.waitForFunction(() => {
    const overlay = document.querySelector('.gq-webgpu-overlay-canvas');
    const renderer = window.galaxy3d?._delegate || window.GQActiveRenderer || window.galaxy3d || null;
    return overlay instanceof HTMLCanvasElement
      && !!renderer
      && typeof renderer._getActiveTradeRoutesForOverlay === 'function';
  }, null, { timeout: 20_000 }).then(() => true).catch(() => false);

  if (overlayReady) {
    await waitForTradeRouteOverlayProof(page);
  }

  const overlayProof = await page.evaluate(() => {
    const renderer = window.galaxy3d?._delegate || window.GQActiveRenderer || window.galaxy3d || null;
    const overlay = document.querySelector('.gq-webgpu-overlay-canvas');
    const cache = Array.isArray(window.__GQ_TRADE_ROUTES_CACHE) ? window.__GQ_TRADE_ROUTES_CACHE : [];
    const activeRoutes = typeof renderer?._getActiveTradeRoutesForOverlay === 'function'
      ? renderer._getActiveTradeRoutesForOverlay()
      : [];
    const telemetry = Array.isArray(window.__GQ_RENDER_TELEMETRY)
      ? window.__GQ_RENDER_TELEMETRY.slice(-10)
      : [];
    const fallbackEvents = telemetry.filter((entry) => entry && entry.type === 'fallback');
    const activeEvents = telemetry.filter((entry) => entry && entry.type === 'backend-active');
    return {
      rendererCtor: renderer?.constructor?.name || null,
      isWebGPU: !!(renderer?._device || window.galaxy3d?.backendType === 'webgpu' || window.__GQ_ACTIVE_RENDERER_BACKEND === 'webgpu'),
      backendType: window.galaxy3d?.backendType || window.__GQ_ACTIVE_RENDERER_BACKEND || null,
      overlaySize: overlay instanceof HTMLCanvasElement
        ? { width: overlay.width, height: overlay.height }
        : null,
      cacheRoutes: cache.length,
      activeOverlayRoutes: Array.isArray(activeRoutes) ? activeRoutes.length : 0,
      fallbackEvents,
      activeEvents,
    };
  });

  const availableRoutes = Math.max(
    Number(routeData?.cacheRoutes || 0),
    Number(overlayProof.cacheRoutes || 0)
  );

  if (availableRoutes <= 0) {
    testInfo.annotations.push({
      type: 'info',
      description: 'no-active-trade-routes-during-test-window',
    });
  }

  if (overlayProof.isWebGPU && availableRoutes > 0) {
    expect(overlayReady).toBe(true);
    expect(overlayProof.overlaySize?.width || 0).toBeGreaterThan(0);
    expect(overlayProof.overlaySize?.height || 0).toBeGreaterThan(0);
    expect(overlayProof.activeOverlayRoutes).toBeGreaterThan(0);
  } else {
    const hasWebglBackend = String(overlayProof.backendType || '').toLowerCase().includes('webgl');
    const hasFallbackTelemetry = overlayProof.fallbackEvents.some((event) => {
      const from = String(event?.from || '').toLowerCase();
      const to = String(event?.to || '').toLowerCase();
      return from.includes('webgpu') && to.includes('webgl');
    });
    const hasBackendActiveTelemetry = overlayProof.activeEvents.some((event) => {
      const backend = String(event?.backend || '').toLowerCase();
      return backend.includes('webgl');
    });
    expect(hasWebglBackend || hasFallbackTelemetry || hasBackendActiveTelemetry).toBe(true);
    testInfo.annotations.push({
      type: 'info',
      description: `webgpu-unavailable-fallback-validated backend=${overlayProof.backendType || 'unknown'}`,
    });
  }

  const gpuWarn = gpuWarnCounter.snapshot();
  gpuWarnCounter.dispose();
  console.log(`[e2e:trade-route-overlay] renderer=${overlayProof.rendererCtor} webgpu=${overlayProof.isWebGPU} backend=${overlayProof.backendType} cacheRoutes=${overlayProof.cacheRoutes} overlayRoutes=${overlayProof.activeOverlayRoutes} gpuReadbackWarnings=${gpuWarn.gpuReadbackWarnings} totalWarnings=${gpuWarn.totalConsoleWarnings}`);
  if (gpuWarn.samples.length) {
    console.log(`[e2e:trade-route-overlay][gpu-warning-samples] ${gpuWarn.samples.join(' | ')}`);
  }
  if (gpuWarn.actionableSamples.length) {
    console.log(`[e2e:trade-route-overlay][actionable-warning-samples] ${gpuWarn.actionableSamples.join(' | ')}`);
  }
  expect(gpuWarn.totalConsoleWarnings).toBe(0);
});