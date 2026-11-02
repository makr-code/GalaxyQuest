const { test, expect } = require('@playwright/test');

if (process.env.GQ_CHROMIUM_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.GQ_CHROMIUM_EXECUTABLE_PATH,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
}

test('dev reference renders four deterministic swatches and visibly applies every map', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tools/world-material-reference.html');
  await expect(page.locator('html')).toHaveAttribute('data-reference-ready', 'true');
  await expect(page.locator('#reference-viewport canvas')).toBeVisible();
  const snapshot = () => page.evaluate(() => {
    const reference = window.GQMaterialReference;
    reference.render();
    return reference.renderer.domElement.toDataURL();
  });
  const baseline = await snapshot();
  for (const name of ['albedo', 'normal', 'roughness', 'metalness', 'emissive']) {
    const checkbox = page.locator(`input[name="${name}"]`);
    await checkbox.uncheck();
    expect(await snapshot(), `${name} must change rendered pixels`).not.toBe(baseline);
    await checkbox.check();
    expect(await snapshot(), `${name} toggle must be deterministic`).toBe(baseline);
  }
  const families = await page.evaluate(() => window.GQMaterialReference.bundles.map(bundle => ({
    family: bundle.descriptor.materialFamily,
    transparent: bundle.material.transparent,
    metalness: bundle.material.metalness,
    normal: Boolean(bundle.material.normalMap),
    bump: Boolean(bundle.material.bumpMap),
    ao: Boolean(bundle.material.aoMap),
  })));
  expect(families.map(item => item.family)).toEqual(['painted-metal', 'rock', 'glass', 'emissive']);
  expect(families[2]).toMatchObject({ transparent: true, metalness: 0 });
  expect(families.every(item => item.normal && !item.bump && !item.ao)).toBe(true);
  expect(errors).toEqual([]);
});
