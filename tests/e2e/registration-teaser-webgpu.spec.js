const { test, expect } = require('@playwright/test');

test.skip(process.env.GQ_TRELLIS_SHIP_E2E !== '1', 'Requires the local Docker API, Vite server and TRELLIS2 DEV_ONLY GLB.');

test('mentor room renders the TRELLIS2 ship in the WebGPU herald scene on desktop and mobile', async ({ page }) => {
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
    for (const title of [
      'Ein Bündnis im Wandel',
      'Eine ungeschriebene Welt',
      'Deine Geschichte beginnt',
      'Die Heroldkammer',
    ]) {
      await page.locator('#registration-continue').click();
      await expect(page.locator('#registration-title')).toHaveText(title);
    }

    await expect(page.locator('#registration-choices button')).toHaveCount(6, { timeout: 120_000 });
    const shipCanvas = page.locator('.registration-herald-canvas-rigged');
    await expect(shipCanvas).toHaveAttribute('data-teaser-ship', 'loaded', { timeout: 120_000 });
    const desktop = await page.evaluate(() => ({
      webgpu: Boolean(navigator.gpu),
      renderer: document.querySelector('.registration-herald-canvas-rigged')?.dataset.renderer,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    expect(desktop.webgpu).toBe(true);
    expect(desktop.renderer).toBe('three-webgpu-gltf');
    expect(desktop.scrollWidth).toBeLessThanOrEqual(desktop.viewportWidth);
    await page.screenshot({ path: 'C:/Users/mkrueger/AppData/Local/Temp/gq-registration-trellis-desktop.png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(shipCanvas).toHaveAttribute('data-teaser-ship', 'loaded');
    const mobile = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      visibleChoices: [...document.querySelectorAll('#registration-choices button')]
        .filter((button) => button.getBoundingClientRect().width > 0).length,
    }));
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewportWidth);
    expect(mobile.visibleChoices).toBe(6);
    await page.screenshot({ path: 'C:/Users/mkrueger/AppData/Local/Temp/gq-registration-trellis-mobile.png' });
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