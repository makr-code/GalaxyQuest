const { test, expect } = require('@playwright/test');

test.skip(process.env.GQ_TRELLIS_SHIP_E2E !== '1', 'Requires the local Docker API, Vite server and TRELLIS2 DEV_ONLY GLB.');

test('campaign renders comet and TRELLIS2 shuttle in the existing WebGPU canvas', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('gq_audio_settings', JSON.stringify({
      masterMuted: true,
      ttsMuted: true,
      masterVolume: 0,
      ttsVolume: 0,
    }));
  });

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const webGpuAvailable = await page.evaluate(async () => {
      if (!navigator.gpu) return false;
      try {
        return Boolean(await navigator.gpu.requestAdapter());
      } catch {
        return false;
      }
    });
    test.skip(!webGpuAvailable, 'This Playwright runner does not expose a WebGPU adapter.');
    await page.locator('#start-register').click();
    await expect(page.locator('#registration-prologue')).toHaveAttribute('data-camera-state', 'ready');
    await page.evaluate(() => { window.__campaignCanvas = document.querySelector('#galaxy-bg-wrapper canvas'); });
    expect(await page.evaluate(() => {
      const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
      const flight = (renderer._native || renderer).getSpaceView();
      return flight.spaceEntities.get('onboarding-comet')?.kind;
    })).toBe('comet');
    await page.locator('#registration-opening-skip').click();
    await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'homeworlds');
    await expect(page.locator('#registration-prologue')).toHaveAttribute('data-camera-state', 'ready', { timeout: 90000 });
    await page.locator('#registration-opening-skip').click();
    await expect(page.locator('#registration-choices button')).toHaveCount(6, { timeout: 120_000 });
    await page.locator('#registration-choices button').first().click();
    await page.locator('#registration-continue').click();
    await page.locator('#registration-name').fill(`Pilot${Date.now()}`);
    await page.locator('#registration-background').fill('An explorer departing for a private frontier world.');
    await page.locator('#registration-character-form [type="submit"]').click();
    await expect(page.locator('#registration-continue')).toHaveText('Shuttle starten');
    await page.locator('#registration-continue').click();
    await expect.poll(() => page.evaluate(() => {
      const renderer = window.__GQ_AUTH_GALAXY_BG_RUNTIME.renderer;
      const flight = (renderer._native || renderer).getSpaceView();
      return Boolean(flight.registrationVoyage && flight.vesselRenderPass.resources.has('onboarding-shuttle'));
    }), { timeout: 90000 }).toBe(true);
    await page.locator('#registration-opening-pause').click();
    const desktop = await page.evaluate(() => ({
      webgpu: Boolean(navigator.gpu),
      sameCanvas: window.__campaignCanvas === document.querySelector('#galaxy-bg-wrapper canvas'),
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    expect(desktop.webgpu).toBe(true);
    expect(desktop.sameCanvas).toBe(true);
    expect(desktop.scrollWidth).toBeLessThanOrEqual(desktop.viewportWidth);
    await page.screenshot({ path: 'test-results/registration-shuttle-desktop.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewportWidth);
    await page.screenshot({ path: 'test-results/registration-shuttle-mobile.png' });
    await page.locator('#registration-continue').click();
    await expect(page.locator('#registration-continue')).toHaveText('Bestätigen und landen');
    await expect(page.locator('#draft-world')).toBeHidden();
    await page.locator('#registration-continue').click();
    await expect(page.locator('#registration-prologue')).toHaveAttribute('data-phase', 'landing');
    await expect(page.locator('#draft-world')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('body')).toHaveClass(/draft-playing/);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.evaluate(async () => {
      try {
        const csrf = await fetch('api/auth.php?action=csrf', { credentials: 'same-origin' }).then((response) => response.json());
        await fetch('api/auth.php?action=register_cancel', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
          body: '{}',
        });
      } catch {}
    }).catch(() => {});
  }
});