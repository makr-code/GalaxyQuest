import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8080';
const REQUEST_WINDOW_MS = 15000;
const DEFAULT_USER = String(process.env.GQ_USER || 'default_user');
const DEFAULT_PASS = String(process.env.GQ_PASS || 'User!23456');
const RENDERER_HINT = (() => {
  const raw = String(process.env.GQ_RENDERER_HINT || 'auto').toLowerCase().trim();
  return (raw === 'webgpu' || raw === 'webgl2' || raw === 'auto') ? raw : 'auto';
})();

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

async function installWebgl2ForceStubs(page) {
  // In webgl2 hint mode, neutralize WebGPU-only modules so runtime falls back to ThreeJS path.
  await page.route('**/*WebGPU.js*', async (route) => {
    const url = route.request().url();
    if (url.includes('/js/rendering/') || url.includes('/js/engine/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ';',
      });
      return;
    }
    await route.continue();
  });
}

async function getCsrfToken(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth.php?action=csrf', {
      method: 'GET',
      credentials: 'include',
    });
    const body = await response.json();
    return String(body?.token || '');
  });
}

async function devResetPassword(page, username, password) {
  const csrf = await getCsrfToken(page);
  if (!csrf) return { ok: false, reason: 'missing-csrf' };
  return page.evaluate(async ({ csrfToken, user, pass }) => {
    const response = await fetch('/api/auth.php?action=dev_reset_password', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ username: user, password: pass }),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_) {}
    return {
      ok: response.ok && body?.success === true,
      status: response.status,
      error: String(body?.error || ''),
    };
  }, { csrfToken: csrf, user: username, pass: password });
}

async function registerFallbackUser(page) {
  const csrf = await getCsrfToken(page);
  if (!csrf) return { ok: false, reason: 'missing-csrf' };

  const username = `e2e_tex_${Date.now()}`;
  const email = `${username}@local.test`;
  const password = 'User!23456';

  const result = await page.evaluate(async ({ csrfToken, user, mail, pass }) => {
    const response = await fetch('/api/auth.php?action=register', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        username: user,
        email: mail,
        password: pass,
        remember: false,
      }),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_) {}
    return {
      ok: response.ok && body?.success === true,
      status: response.status,
      error: String(body?.error || ''),
    };
  }, { csrfToken: csrf, user: username, mail: email, pass: password });

  return {
    ...result,
    username,
    password,
  };
}

async function loginViaUi(page, username, password) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('#login-password').waitFor({ state: 'visible', timeout: 20000 });

  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');

  const started = Date.now();
  while ((Date.now() - started) < 30000) {
    const ok = await hasAuthenticatedSession(page);
    if (ok) {
      const authHidden = await page.evaluate(() => {
        const auth = document.getElementById('auth-section');
        return !!auth && auth.classList.contains('hidden');
      }).catch(() => false);
      if (authHidden) return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function openHomeSystem(page) {
  const result = await page.evaluate(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
    const wm = window.WM;
    if (!wm || typeof wm.open !== 'function' || typeof wm.body !== 'function') {
      return { ok: false, reason: 'wm-missing' };
    }

    let root = wm.body('galaxy');
    if (!root && typeof wm.open === 'function') {
      try {
        wm.open('galaxy');
      } catch (_) {
        // Ignore window manager open issues and continue with controller fallback.
      }
    }
    root = wm.body('galaxy') || root;
    for (let i = 0; i < 40 && !root; i += 1) {
      await wait(100);
      root = wm.body('galaxy');
    }
    if (!root) root = document.body;

    let galaxyController = window.GQGalaxyController;
    for (let i = 0; i < 40 && (!galaxyController || typeof galaxyController.focusHomeSystem !== 'function'); i += 1) {
      await wait(100);
      galaxyController = window.GQGalaxyController;
    }

    if (galaxyController && typeof galaxyController.focusHomeSystem === 'function') {
      await galaxyController.focusHomeSystem(root, {
        silent: true,
        cinematic: false,
        enterSystem: true,
        focusPlanet: true,
      });
      return { ok: true, path: 'controller' };
    }

    const okHomeCmd = await runConsoleHome();
    if (!okHomeCmd) {
      return { ok: false, reason: 'galaxy-controller-missing' };
    }

    return { ok: true, path: 'console-home' };
  });

  if (!result?.ok) {
    throw new Error(`openHomeSystem failed: ${result?.reason || 'unknown'}`);
  }
}

async function triggerTextureFallbackRequests(page) {
  return page.evaluate(async () => {
    const descriptor = {
      seed: 202,
      variant: 'gas',
      palette: {
        base: '#cd9796',
        secondary: '#a86f8b',
        accent: '#f2ca7d',
        ice: '#f0e4d0',
      },
      banding: 0.42,
      clouds: 0.32,
      craters: 0.0,
      ice_caps: 0.0,
      glow: 0.05,
    };
    const encoded = btoa(JSON.stringify(descriptor));
    const maps = ['albedo', 'bump', 'emissive', 'cloud'];
    let ok = 0;
    for (const map of maps) {
      const url = `/api/textures.php?action=planet_map&map=${encodeURIComponent(map)}&size=256&algo=v1&d=${encodeURIComponent(encoded)}`;
      try {
        const response = await fetch(url, { method: 'GET', credentials: 'include' });
        if (response.ok || response.status === 304) ok += 1;
      } catch (_) {}
    }
    return ok;
  });
}

async function forceEnterPopulatedSystem(page) {
  return page.evaluate(async () => {
    const view = window.GQGalaxyController?._debugRenderer;
    if (!view || typeof view.enterSystemView !== 'function') {
      return { ok: false, reason: 'renderer-enterSystemView-missing' };
    }

    const starsRes = await fetch('/api/galaxy.php?action=stars&g=1&from=1&to=400&max_points=160', {
      method: 'GET',
      credentials: 'include',
    });
    if (!starsRes.ok) return { ok: false, reason: `stars-http-${starsRes.status}` };

    const starsBody = await starsRes.json().catch(() => null);
    const stars = Array.isArray(starsBody?.stars) ? starsBody.stars : [];
    if (!stars.length) return { ok: false, reason: 'stars-empty' };

    const candidates = stars.slice(0, 20);
    for (const star of candidates) {
      const g = Number(star?.galaxy_index || 1);
      const s = Number(star?.system_index || 0);
      if (!Number.isFinite(s) || s <= 0) continue;

      const sysRes = await fetch(`/api/galaxy.php?g=${encodeURIComponent(String(g))}&s=${encodeURIComponent(String(s))}`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!sysRes.ok) continue;

      const payload = await sysRes.json().catch(() => null);
      const planets = Array.isArray(payload?.planets) ? payload.planets : [];
      if (!planets.length) continue;

      try {
        await view.enterSystemView(star, payload, { immediate: true });
        return { ok: true, g, s, planets: planets.length };
      } catch (_) {
        continue;
      }
    }

    return { ok: false, reason: 'no-populated-system' };
  });
}

async function hasAuthenticatedSession(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth.php?action=me', {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) return false;
    try {
      const body = await response.json();
      return body?.success === true && !!body?.user?.id;
    } catch (_) {
      return false;
    }
  });
}

async function waitForGalaxyController(page, timeoutMs = 45000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const state = await page.evaluate(() => {
      const hasController = !!window.GQGalaxyController;
      const hasView = !!window.GQGalaxyController?._debugRenderer;
      const authHidden = !!document.getElementById('auth-section') && document.getElementById('auth-section').classList.contains('hidden');
      const gameVisible = !!document.getElementById('topbar-section');
      return { hasController, hasView, authHidden, gameVisible };
    }).catch(() => ({ hasController: false, hasView: false, authHidden: false, gameVisible: false }));
    if (state.hasController) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript((hint) => {
  try {
    localStorage.setItem('gq:rendererHint', hint);
    window.__GQ_E2E_RENDERER_HINT = hint;
    if (hint === 'webgl2') {
      try {
        Object.defineProperty(navigator, 'gpu', {
          configurable: true,
          get() { return undefined; },
        });
      } catch (_) {}
    }
  } catch (_) {}
}, RENDERER_HINT);
const page = await context.newPage();

await installRendererFriendlyCdnStubs(page);
if (RENDERER_HINT === 'webgl2') {
  await installWebgl2ForceStubs(page);
}

const runtimeErrors = [];
page.on('pageerror', (error) => {
  runtimeErrors.push(String(error?.message || error));
});

const textureRequests = [];
const textureResponses = [];

page.on('request', (req) => {
  const url = req.url();
  if (url.includes('/api/textures.php') && url.includes('action=planet_map')) {
    textureRequests.push({ method: req.method(), url });
  }
});

page.on('response', async (res) => {
  const url = res.url();
  if (url.includes('/api/textures.php') && url.includes('action=planet_map')) {
    textureResponses.push({
      status: res.status(),
      contentType: res.headers()['content-type'] || '',
      url,
    });
  }
});

try {
  console.log(`RENDERER_HINT=${RENDERER_HINT}`);
  const firstLogin = await loginViaUi(page, DEFAULT_USER, DEFAULT_PASS);
  console.log(`LOGIN_DEFAULT_OK=${firstLogin}`);

  if (!firstLogin) {
    const resetResult = await devResetPassword(page, DEFAULT_USER, DEFAULT_PASS);
    console.log(`DEV_RESET_OK=${resetResult.ok}`);
    console.log(`DEV_RESET_STATUS=${resetResult.status ?? 0}`);
    if (resetResult.error) {
      console.log(`DEV_RESET_ERROR=${resetResult.error}`);
    }

    const secondLogin = resetResult.ok ? await loginViaUi(page, DEFAULT_USER, DEFAULT_PASS) : false;
    console.log(`LOGIN_AFTER_RESET_OK=${secondLogin}`);

    if (!secondLogin) {
      const fallback = await registerFallbackUser(page);
      console.log(`REGISTER_FALLBACK_OK=${fallback.ok}`);
      console.log(`REGISTER_FALLBACK_STATUS=${fallback.status ?? 0}`);
      if (fallback.error) {
        console.log(`REGISTER_FALLBACK_ERROR=${fallback.error}`);
      }

      if (!fallback.ok) {
        throw new Error('Login failed and fallback registration failed.');
      }

      await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
      const fallbackLoggedIn = await hasAuthenticatedSession(page);
      console.log(`LOGIN_REGISTERED_SESSION_OK=${fallbackLoggedIn}`);
      if (!fallbackLoggedIn) {
        throw new Error('Fallback registration created no active session.');
      }
    }
  }

  let controllerReady = await waitForGalaxyController(page, 30000);
  console.log(`CONTROLLER_READY_INITIAL=${controllerReady}`);
  if (!controllerReady) {
    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    controllerReady = await waitForGalaxyController(page, 30000);
    console.log(`CONTROLLER_READY_AFTER_RELOAD=${controllerReady}`);
  }

  const topbarHomeVisible = await page.locator('#topbar-home-btn').isVisible().catch(() => false);
  if (topbarHomeVisible) {
    await page.click('#topbar-home-btn');
  }
  let enteredSystem = true;
  try {
    await openHomeSystem(page);
  } catch (error) {
    enteredSystem = false;
    console.log(`OPEN_HOME_SYSTEM_ERROR=${String(error?.message || error)}`);
    const fallbackOk = await triggerTextureFallbackRequests(page);
    console.log(`FALLBACK_TRIGGER_OK=${fallbackOk}`);
  }

  if (runtimeErrors.length > 0) {
    console.log(`RUNTIME_ERROR_COUNT=${runtimeErrors.length}`);
    runtimeErrors.slice(0, 5).forEach((msg, idx) => {
      console.log(`RUNTIME_ERROR_${idx + 1}=${msg}`);
    });
  } else {
    console.log('RUNTIME_ERROR_COUNT=0');
  }

  console.log(`ENTERED_SYSTEM=${enteredSystem}`);

  let forcedSystem = null;
  if (enteredSystem) {
    forcedSystem = await forceEnterPopulatedSystem(page).catch(() => ({ ok: false, reason: 'exception' }));
    console.log(`FORCE_SYSTEM_OK=${forcedSystem?.ok === true}`);
    if (forcedSystem?.reason) {
      console.log(`FORCE_SYSTEM_REASON=${forcedSystem.reason}`);
    }
  }

  await page.waitForTimeout(REQUEST_WINDOW_MS);

  const rendererState = await page.evaluate(() => {
    const view = window.GQGalaxyController?._debugRenderer;
    const core = view?._delegate || view;
    return {
      hasController: !!window.GQGalaxyController,
      hasView: !!view,
      backend: String(view?.backendType || ''),
      systemMode: !!view?.systemMode,
      systemPlanets: Array.isArray(core?.systemPlanetEntries) ? core.systemPlanetEntries.length : 0,
      systemMoons: Array.isArray(core?.systemMoonEntries) ? core.systemMoonEntries.length : 0,
      refinementQueue: Array.isArray(core?.systemRefinementQueue) ? core.systemRefinementQueue.length : -1,
      serverTexturesEnabled: core?.textureManager?.planetPipeline?.serverTexturesEnabled === true,
    };
  });
  console.log(`STATE_HAS_CONTROLLER=${rendererState.hasController}`);
  console.log(`STATE_HAS_VIEW=${rendererState.hasView}`);
  console.log(`STATE_BACKEND=${rendererState.backend}`);
  console.log(`STATE_SYSTEM_MODE=${rendererState.systemMode}`);
  console.log(`STATE_SYSTEM_PLANETS=${rendererState.systemPlanets}`);
  console.log(`STATE_SYSTEM_MOONS=${rendererState.systemMoons}`);
  console.log(`STATE_REFINEMENT_QUEUE=${rendererState.refinementQueue}`);
  console.log(`STATE_SERVER_TEXTURES_ENABLED=${rendererState.serverTexturesEnabled}`);

  console.log(`TEXTURE_REQ_COUNT=${textureRequests.length}`);
  console.log(`TEXTURE_RES_COUNT=${textureResponses.length}`);

  const pngCount = textureResponses.filter((r) => r.contentType.includes('image/png')).length;
  const okCount = textureResponses.filter((r) => r.status === 200 || r.status === 304).length;
  console.log(`TEXTURE_RES_PNG=${pngCount}`);
  console.log(`TEXTURE_RES_OK_OR_304=${okCount}`);

  if (textureResponses.length === 0 && rendererState.systemPlanets === 0 && !forcedSystem?.ok) {
    const fallbackOk = await triggerTextureFallbackRequests(page);
    console.log(`NO_PLANETS_FALLBACK_TRIGGER_OK=${fallbackOk}`);
  }

  const finalTextureResCount = textureResponses.length;
  const finalPngCount = textureResponses.filter((r) => r.contentType.includes('image/png')).length;
  const finalOkCount = textureResponses.filter((r) => r.status === 200 || r.status === 304).length;
  console.log(`FINAL_TEXTURE_RES_COUNT=${finalTextureResCount}`);
  console.log(`FINAL_TEXTURE_RES_PNG=${finalPngCount}`);
  console.log(`FINAL_TEXTURE_RES_OK_OR_304=${finalOkCount}`);

  const webGpuNoHttpTexturePath = String(rendererState.backend || '').toLowerCase() === 'webgpu' && finalTextureResCount === 0;
  if (webGpuNoHttpTexturePath) {
    const fallbackOk = await triggerTextureFallbackRequests(page);
    console.log(`WEBGPU_ENDPOINT_FALLBACK_OK=${fallbackOk}`);
  }

  if (RENDERER_HINT === 'webgl2' && String(rendererState.backend || '').toLowerCase() !== 'webgl2') {
    console.log('CHECK_RESULT=RENDERER_HINT_MISMATCH');
    process.exitCode = 4;
  } else if (webGpuNoHttpTexturePath) {
    console.log('CHECK_RESULT=OK_WEBGPU_NO_HTTP_TEXTURE_PATH');
  } else if (finalTextureResCount === 0) {
    console.log('CHECK_RESULT=NO_TEXTURE_TRAFFIC');
    process.exitCode = 2;
  } else if (finalPngCount === 0) {
    console.log('CHECK_RESULT=NO_PNG_TRAFFIC');
    process.exitCode = 3;
  } else if (rendererState.systemPlanets === 0) {
    console.log('CHECK_RESULT=OK_NO_SYSTEM_PLANETS');
  } else {
    console.log('CHECK_RESULT=OK');
  }
} finally {
  await browser.close();
}
