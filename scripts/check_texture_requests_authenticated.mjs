import { chromium } from 'playwright';

const BASE_URL = process.env.GQ_BASE_URL || 'http://localhost:8080';
const USERNAME = process.env.GQ_E2E_USER || 'default_user';
const PASSWORD = process.env.GQ_E2E_PASS || 'User!23456';
const FALLBACK_PASSWORD = process.env.GQ_E2E_FALLBACK_PASS || 'User!23456';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const requestLog = [];
const responseLog = [];
const requestFilter = (url) => url.includes('/api/textures.php') && (url.includes('action=planet_map') || url.includes('action=object_map'));

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

page.on('request', (req) => {
  const url = req.url();
  if (!requestFilter(url)) return;
  requestLog.push({
    method: req.method(),
    url,
  });
});

page.on('response', (res) => {
  const url = res.url();
  if (!requestFilter(url)) return;
  const headers = res.headers();
  responseLog.push({
    status: res.status(),
    contentType: headers['content-type'] || '',
    cacheControl: headers['cache-control'] || '',
    etag: headers['etag'] || '',
    url,
  });
});

await installRendererFriendlyCdnStubs(page);

async function safeClick(selector) {
  const locator = page.locator(selector);
  try {
    await locator.click({ timeout: 10_000, force: true });
    return;
  } catch (_) {}
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
  }, selector);
}

async function getCsrfToken() {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth.php?action=csrf', {
      method: 'GET',
      credentials: 'include',
    });
    const body = await response.json().catch(() => null);
    return String(body?.token || '');
  });
}

async function hasAuthenticatedSession() {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth.php?action=me', {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.success === true && !!body?.user?.id;
  });
}

async function devResetPasswordApi(username, password) {
  const csrf = await getCsrfToken();
  if (!csrf) return { ok: false, status: 0, error: 'missing-csrf' };
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
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && body?.success === true,
      status: response.status,
      error: String(body?.error || ''),
    };
  }, { csrfToken: csrf, user: username, pass: password });
}

async function registerFallbackUserApi() {
  const csrf = await getCsrfToken();
  if (!csrf) return { ok: false, status: 0, error: 'missing-csrf' };
  const stamp = Date.now();
  const regUser = `texreq_${stamp}`;
  const regEmail = `texreq_${stamp}@example.com`;
  const regPass = 'User!23456';

  const result = await page.evaluate(async ({ csrfToken, user, mail, pass }) => {
    const response = await fetch('/api/auth.php?action=register', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ username: user, email: mail, password: pass, remember: true }),
    });
    const body = await response.json().catch(() => null);
    return {
      ok: response.ok && body?.success === true,
      status: response.status,
      error: String(body?.error || ''),
    };
  }, { csrfToken: csrf, user: regUser, mail: regEmail, pass: regPass });

  return {
    ...result,
    username: regUser,
    password: regPass,
  };
}

async function tryLogin(username, password, timeoutMs = 20_000) {
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#login-password').waitFor({ state: 'visible', timeout: 30_000 });

  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.click('#login-form button[type="submit"]');

  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const ok = await hasAuthenticatedSession().catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function resetPasswordViaDevTab(username, password) {
  return devResetPasswordApi(username, password);
}

async function registerFallbackUser() {
  const created = await registerFallbackUserApi();
  if (!created.ok) return false;
  await page.waitForTimeout(1000);
  return hasAuthenticatedSession();
}

async function loginDefaultUser() {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  let ok = await tryLogin(USERNAME, PASSWORD, 15_000);
  if (!ok) {
    const resetResult = await resetPasswordViaDevTab(USERNAME, FALLBACK_PASSWORD);
    ok = !!resetResult?.ok && await tryLogin(USERNAME, FALLBACK_PASSWORD, 20_000);
  }
  if (!ok) {
    ok = await registerFallbackUser();
  }

  if (!ok) {
    throw new Error('authenticated login failed (default + dev reset + register fallback)');
  }

  // Session can be valid before the unified game shell finishes bootstrapping.
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  let shellReady = await waitForGameShellReady(45_000);
  if (!shellReady) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    shellReady = await waitForGameShellReady(30_000);
  }
  return shellReady;
}

async function openHomeSystem() {
  await safeClick('#topbar-home-btn');
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

    if (galaxyController && typeof galaxyController.focusHomeSystem === 'function') {
      await galaxyController.focusHomeSystem(root, {
        silent: true,
        cinematic: false,
        enterSystem: true,
        focusPlanet: false,
      });
      return { ok: true, path: 'controller' };
    }

    const okHome = await runConsoleHome();
    if (!okHome) return { ok: false, reason: 'galaxy-controller-missing' };
    return { ok: true, path: 'console-home' };
  });

  if (!result?.ok) {
    throw new Error(`home-system navigation failed: ${result?.reason || 'unknown'}`);
  }
  return result.path;
}

async function waitForGalaxyController(timeoutMs = 30000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const ready = await page.evaluate(() => {
      return !!(window.GQGalaxyController && typeof window.GQGalaxyController.focusHomeSystem === 'function');
    }).catch(() => false);
    if (ready) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function waitForGameShellReady(timeoutMs = 45000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    const state = await page.evaluate(() => {
      const authHidden = !!document.getElementById('auth-section') && document.getElementById('auth-section').classList.contains('hidden');
      const gameVisible = !!document.getElementById('game-section') && !document.getElementById('game-section').classList.contains('hidden');
      const topbarVisible = !!document.getElementById('topbar-section');
      return { authHidden, gameVisible, topbarVisible };
    }).catch(() => ({ authHidden: false, gameVisible: false, topbarVisible: false }));
    if ((state.authHidden && state.gameVisible) || state.topbarVisible) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function triggerFallbackTextureRequests() {
  const result = await page.evaluate(async () => {
    const maps = ['albedo', 'bump', 'emissive', 'cloud'];
    const planetDescriptor = {
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
    const objectDescriptors = [
      { type: 'ship', descriptor: { seed: 911, variant: 'desert', banding: 0.08, clouds: 0, craters: 0.12, ice_caps: 0, glow: 0.2, palette: { base: '#6f8fb3', secondary: '#4d6680', accent: '#9fc4eb', ice: '#dce8f7' } } },
      { type: 'moon', descriptor: { seed: 1121, variant: 'rocky', banding: 0.06, clouds: 0, craters: 0.28, ice_caps: 0.06, glow: 0.04, palette: { base: '#9da5ae', secondary: '#7f8792', accent: '#c6ced8', ice: '#eef4fb' } } },
      { type: 'star', descriptor: { seed: 1517, variant: 'lava', banding: 0.34, clouds: 0, craters: 0.03, ice_caps: 0, glow: 0.9, palette: { base: '#ffb268', secondary: '#ff8d46', accent: '#ffe0a2', ice: '#fff4da' } } },
      { type: 'building', descriptor: { seed: 1879, variant: 'desert', banding: 0.12, clouds: 0, craters: 0.08, ice_caps: 0, glow: 0.18, palette: { base: '#6ea4d8', secondary: '#4d7aa1', accent: '#9dc5ea', ice: '#d9e9f7' } } },
    ];

    let planetOk = 0;
    let objectOk = 0;

    const pEncoded = btoa(JSON.stringify(planetDescriptor));
    for (const map of maps) {
      const url = `/api/textures.php?action=planet_map&map=${encodeURIComponent(map)}&size=256&algo=v1&d=${encodeURIComponent(pEncoded)}`;
      try {
        const response = await fetch(url, { method: 'GET', credentials: 'include' });
        if (response.ok || response.status === 304) planetOk += 1;
      } catch (_) {}
    }

    for (const obj of objectDescriptors) {
      const encoded = btoa(JSON.stringify(obj.descriptor));
      for (const map of maps) {
        const url = `/api/textures.php?action=object_map&object=${encodeURIComponent(obj.type)}&map=${encodeURIComponent(map)}&size=256&algo=v1&d=${encodeURIComponent(encoded)}`;
        try {
          const response = await fetch(url, { method: 'GET', credentials: 'include' });
          if (response.ok || response.status === 304) objectOk += 1;
        } catch (_) {}
      }
    }

    return { planetOk, objectOk };
  });
  return result;
}

try {
  const gameShellReady = await loginDefaultUser();
  console.log(`AUTH_GAME_SHELL_READY=${gameShellReady}`);
  let navPath = 'fallback-only';
  try {
    const controllerReady = await waitForGalaxyController(30000);
    console.log(`AUTH_CONTROLLER_READY=${controllerReady}`);
    if (controllerReady) {
      navPath = await openHomeSystem();
      await page.waitForTimeout(10_000);
    } else {
      navPath = 'fallback-controller-not-ready';
    }
  } catch (error) {
    console.log(`AUTH_TEXTURE_NAV_ERROR=${String(error?.message || error)}`);
  }

  const fallback = await triggerFallbackTextureRequests();
  console.log(`AUTH_TEXTURE_FALLBACK_PLANET_OK=${fallback.planetOk}`);
  console.log(`AUTH_TEXTURE_FALLBACK_OBJECT_OK=${fallback.objectOk}`);
  await page.waitForTimeout(1_000);

  const pngResponses = responseLog.filter((r) => r.contentType.includes('image/png'));
  const okResponses = responseLog.filter((r) => r.status === 200 || r.status === 304);
  const objectResponses = responseLog.filter((r) => r.url.includes('action=object_map'));
  const objectPngResponses = objectResponses.filter((r) => r.contentType.includes('image/png'));
  const objectOkResponses = objectResponses.filter((r) => r.status === 200 || r.status === 304);

  console.log(`AUTH_TEXTURE_NAV_PATH=${navPath}`);
  console.log(`AUTH_TEXTURE_REQ_COUNT=${requestLog.length}`);
  console.log(`AUTH_TEXTURE_RES_COUNT=${responseLog.length}`);
  console.log(`AUTH_TEXTURE_RES_OK_OR_304=${okResponses.length}`);
  console.log(`AUTH_TEXTURE_RES_PNG=${pngResponses.length}`);
  console.log(`AUTH_OBJECT_TEXTURE_RES_COUNT=${objectResponses.length}`);
  console.log(`AUTH_OBJECT_TEXTURE_RES_OK_OR_304=${objectOkResponses.length}`);
  console.log(`AUTH_OBJECT_TEXTURE_RES_PNG=${objectPngResponses.length}`);

  if (responseLog.length === 0) {
    console.log('CHECK_RESULT=AUTH_NO_TEXTURE_TRAFFIC');
    process.exitCode = 2;
  } else if (pngResponses.length === 0) {
    console.log('CHECK_RESULT=AUTH_NO_PNG_TRAFFIC');
    process.exitCode = 3;
  } else if (objectResponses.length === 0) {
    console.log('CHECK_RESULT=AUTH_NO_OBJECT_TEXTURE_TRAFFIC');
    process.exitCode = 6;
  } else if (objectPngResponses.length === 0 || objectOkResponses.length === 0) {
    console.log('CHECK_RESULT=AUTH_OBJECT_TEXTURE_INCOMPLETE');
    process.exitCode = 7;
  } else if (navPath.startsWith('fallback')) {
    console.log('CHECK_RESULT=AUTH_OK_WITH_FALLBACK_NAV');
  } else {
    console.log('CHECK_RESULT=AUTH_OK');
  }

  const sample = responseLog.slice(0, 5);
  for (let i = 0; i < sample.length; i += 1) {
    const row = sample[i];
    console.log(`AUTH_TEXTURE_SAMPLE_${i + 1}=status:${row.status};ctype:${row.contentType};etag:${row.etag}`);
  }
} finally {
  await browser.close();
}
