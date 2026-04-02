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
const requestFilter = (url) => url.includes('/api/textures.php') && url.includes('action=planet_map');

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

async function tryLogin(username, password, timeoutMs = 20_000) {
  await page.locator('#login-username').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#login-password').waitFor({ state: 'visible', timeout: 30_000 });

  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(password);
  await page.click('#login-form button[type="submit"]');

  try {
    await page.locator('#topbar-section').waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch (_) {
    return false;
  }
}

async function resetPasswordViaDevTab(username, password) {
  await page.locator('.auth-tabs .tab-btn[data-tab="dev"]').click();
  await page.locator('#dev-reset-username').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#dev-reset-password').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('#dev-reset-username').fill(username);
  await page.locator('#dev-reset-password').fill(password);
  await page.locator('#dev-reset-btn').click();

  await page.waitForTimeout(1500);
  await page.locator('.auth-tabs .tab-btn[data-tab="login"]').click();
}

async function registerFallbackUser() {
  const stamp = Date.now();
  const regUser = `texreq_${stamp}`;
  const regEmail = `texreq_${stamp}@example.com`;
  const regPass = 'User!23456';

  await page.locator('.auth-tabs .tab-btn[data-tab="register"]').click();
  await page.locator('#reg-username').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#reg-username').fill(regUser);
  await page.locator('#reg-email').fill(regEmail);
  await page.locator('#reg-password').fill(regPass);
  await page.locator('#reg-remember').check();
  await page.click('#register-form button[type="submit"]');

  const topbar = page.locator('#topbar-section');
  const launchButton = page.locator('#prolog-launch');
  const next3Button = page.locator('#prolog-next3');
  const skipButton = page.locator('#prolog-skip');

  for (let i = 0; i < 80; i += 1) {
    if (await topbar.isVisible().catch(() => false)) return true;
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click().catch(() => {});
    }
    if (await next3Button.isVisible().catch(() => false)) {
      await next3Button.click().catch(() => {});
    }
    if (await launchButton.isVisible().catch(() => false)) {
      await launchButton.click().catch(() => {});
    }
    await page.waitForTimeout(400);
  }

  return await topbar.isVisible().catch(() => false);
}

async function loginDefaultUser() {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  let ok = await tryLogin(USERNAME, PASSWORD, 15_000);
  if (!ok) {
    await resetPasswordViaDevTab(USERNAME, FALLBACK_PASSWORD);
    ok = await tryLogin(USERNAME, FALLBACK_PASSWORD, 20_000);
  }
  if (!ok) {
    ok = await registerFallbackUser();
  }

  if (!ok) {
    throw new Error('authenticated login failed (default + dev reset + register fallback)');
  }
}

async function openHomeSystem() {
  await page.click('#topbar-home-btn');
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

try {
  await loginDefaultUser();
  const navPath = await openHomeSystem();
  await page.waitForTimeout(10_000);

  const pngResponses = responseLog.filter((r) => r.contentType.includes('image/png'));
  const okResponses = responseLog.filter((r) => r.status === 200 || r.status === 304);

  console.log(`AUTH_TEXTURE_NAV_PATH=${navPath}`);
  console.log(`AUTH_TEXTURE_REQ_COUNT=${requestLog.length}`);
  console.log(`AUTH_TEXTURE_RES_COUNT=${responseLog.length}`);
  console.log(`AUTH_TEXTURE_RES_OK_OR_304=${okResponses.length}`);
  console.log(`AUTH_TEXTURE_RES_PNG=${pngResponses.length}`);

  const sample = responseLog.slice(0, 5);
  for (let i = 0; i < sample.length; i += 1) {
    const row = sample[i];
    console.log(`AUTH_TEXTURE_SAMPLE_${i + 1}=status:${row.status};ctype:${row.contentType};etag:${row.etag}`);
  }
} finally {
  await browser.close();
}
