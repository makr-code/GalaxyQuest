const { test, expect } = require('@playwright/test');

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

async function ensureGameShell(page, baseURL) {
  await page.addInitScript(() => {
    window.__GQ_E2E_MODE = true;
  });

  await page.goto(`${baseURL}/index.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#start-session-status')).not.toHaveText('Checking your session...');
  if (await page.locator('#start-resume').isVisible()) {
    await page.locator('#start-resume').click();
  } else {
    await page.locator('#start-login').click();
  }

  const authVisible = await page.locator('#login-username').isVisible({ timeout: 1500 }).catch(() => false);
  if (authVisible) {
    const username = process.env.GQ_E2E_USER || 'administrator';
    const password = process.env.GQ_E2E_PASSWORD || 'Admin!23456';

    await page.fill('#login-username', username);
    await page.fill('#login-password', password);
    await page.click('#login-form button[type="submit"]');
  }

  await expect(page.locator('#topbar-section')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#auth-section')).toHaveClass(/hidden/, { timeout: 30_000 });
}

test('hidden NPC host does not block shell footer interactions', async ({ page, baseURL }) => {
  await installCdnStubs(page);
  await ensureGameShell(page, baseURL);

  const quickNav = page.locator('#footer-quicknav-btn');
  const orb = page.locator('#footer-nav-orb-btn');
  const map = page.locator('#footer-minimap-btn');
  const commanderMenu = page.locator('#commander-menu-arrow');

  await expect(quickNav).toBeVisible();
  await expect(orb).toBeVisible();
  await expect(map).toBeVisible();
  await expect(commanderMenu).toBeVisible();

  await quickNav.click();
  await orb.click();
  await map.click();
  await commanderMenu.click();

  const runtimeState = await page.evaluate(async () => {
    const meRes = await fetch('api/auth.php?action=me&quiet=1', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const meJson = await meRes.json().catch(() => null);

    const host = document.getElementById('npc-dialogue-panel-host');
    const hostBody = host ? host.querySelector('.wm-body') : null;

    return {
      bodyClass: String(document.body?.className || ''),
      meOk: meRes.ok,
      meAuth: !!(meJson?.authenticated || meJson?.user),
      hostAriaHidden: host ? host.getAttribute('aria-hidden') : null,
      hostPointerEvents: host ? getComputedStyle(host).pointerEvents : null,
      hostBodyPointerEvents: hostBody ? getComputedStyle(hostBody).pointerEvents : null,
      footerButtonsPresent: [
        !!document.getElementById('footer-quicknav-btn'),
        !!document.getElementById('footer-nav-orb-btn'),
        !!document.getElementById('footer-minimap-btn'),
      ].every(Boolean),
    };
  });

  expect(runtimeState.bodyClass).toContain('game-page');
  expect(runtimeState.meOk).toBe(true);
  expect(runtimeState.meAuth).toBe(true);
  expect(runtimeState.footerButtonsPresent).toBe(true);
  expect(runtimeState.hostAriaHidden).toBe('true');
  expect(runtimeState.hostBodyPointerEvents).toBe('none');
});
