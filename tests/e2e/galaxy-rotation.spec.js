/**
 * E2E: Galaxy rotation metadata smoke test.
 *
 * Verifies that:
 *  1. The galaxy metadata API returns rotation_direction_ccw = 1 for the default
 *     Milky Way galaxy (CCW rotation from galactic north pole).
 *  2. orbital_velocity_kms matches the expected DB value (≈ 220 km/s).
 *  3. If the 3D renderer initialised in this session, the disk-glow shader
 *     uniform uRotationCcwSign equals +1.0 (CCW).
 *
 * Tests run against the seeded Docker environment (default_user account).
 */
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

test.describe('Galaxy rotation metadata', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('metadata API returns CCW rotation and correct orbital velocity', async ({ page, baseURL }) => {
    await installCdnStubs(page);
    await loginDefaultUser(page, baseURL);

    const result = await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      // ── 1. Fetch galaxy metadata directly from the API ──────────────────────
      let apiMeta = null;
      let apiError = null;
      try {
        const res = await fetch('api/galaxy.php?action=galaxy_meta&galaxy=1');
        if (!res.ok) {
          apiError = `HTTP ${res.status}`;
        } else {
          const json = await res.json();
          if (json && json.success === true && json.metadata) {
            apiMeta = json.metadata;
          } else {
            apiError = json?.error || 'no metadata in response';
          }
        }
      } catch (e) {
        apiError = String(e?.message || e);
      }

      // ── 2. Check live renderer state (available only when THREE.js loaded) ──
      // Wait up to 3 s for GQGalaxyController to appear (it may still be booting)
      let ctrl = window.GQGalaxyController;
      for (let i = 0; i < 30 && !ctrl; i += 1) {
        await wait(100);
        ctrl = window.GQGalaxyController;
      }

      const debugRenderer = ctrl?._debugRenderer ?? null;
      const rendererAvailable = !!debugRenderer;
      let rendererMeta = null;
      let uniformValue = null;

      if (debugRenderer) {
        rendererMeta = debugRenderer.galaxyMetadata
          ? { ...debugRenderer.galaxyMetadata }
          : null;

        const uniforms = debugRenderer.galaxyDiskGlow?.material?.uniforms;
        uniformValue = uniforms?.uRotationCcwSign?.value ?? null;
      }

      return { apiMeta, apiError, rendererAvailable, rendererMeta, uniformValue };
    });

    // ── API assertions ──────────────────────────────────────────────────────
    expect(result.apiError, `metadata API error: ${result.apiError}`).toBeNull();
    expect(result.apiMeta, 'metadata payload missing').not.toBeNull();

    const meta = result.apiMeta;
    // Default Milky Way galaxy must be CCW (rotation_direction_ccw = 1)
    expect(meta.rotation_direction_ccw).toBe(1);
    // Orbital velocity fixed at 220 km/s for Milky Way analog
    expect(meta.orbital_velocity_kms).toBe(220.0);
    // Sanity: arm count and name
    expect(meta.arm_count).toBe(4);

    // ── Renderer assertions (conditional on THREE.js being available) ───────
    // In the Docker test environment THREE.js is CDN-stubbed (empty object),
    // so the renderer may not initialise.  We only assert when it did.
    if (result.rendererAvailable) {
      expect(result.uniformValue, 'uRotationCcwSign uniform should be +1.0 for CCW').toBe(1.0);

      const rm = result.rendererMeta;
      if (rm) {
        expect(rm.rotationDirectionCcw, 'renderer galaxyMetadata.rotationDirectionCcw').toBe(1);
        expect(rm.orbitalVelocityKms, 'renderer orbitalVelocityKms').toBe(220.0);
      }
    } else {
      // Log that renderer was not initialised so the result is informational only
      console.log('[galaxy-rotation] renderer not initialised in test env (THREE.js stubbed) — API checks only');
    }
  });
});
