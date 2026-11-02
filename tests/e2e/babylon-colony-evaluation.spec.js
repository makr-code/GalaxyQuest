const { test, expect } = require('@playwright/test');

for (const [mode, backend] of [
  ['webgl', 'babylon-webgl-fallback'],
  ['babylon', 'babylon-webgpu'],
  ['native', 'native-colony-webgpu'],
]) {
  test(`isolated evaluation: ${backend}`, async ({ playwright }, testInfo) => {
    test.skip(mode !== 'webgl' && process.env.GQ_WEBGPU_SHADER_CI !== '1',
      'Enable existing SwiftShader configuration for deterministic WebGPU smoke');
    const browser = await playwright.chromium.launch({
      ...testInfo.project.use.launchOptions,
      ...(process.env.GQ_EVALUATION_BROWSER_PATH
        ? { executablePath: process.env.GQ_EVALUATION_BROWSER_PATH } : {}),
    });
    try {
      const page = await browser.newPage();
      const errors = [], external = [];
      const base = testInfo.project.use.baseURL;
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
      });
      page.on('request', request => {
        if (new URL(request.url()).origin !== new URL(base).origin) external.push(request.url());
      });
      await page.goto(`${base}/tools/babylon-colony-evaluation.html`);
      await expect(page.locator('#status')).toContainText('No GPU work before opt-in');
      await page.selectOption('#backend', mode);
      await page.locator('#start').click();
      await expect(page.locator('#status')).toContainText(`${backend}`, { timeout: 60000 });
      await expect(page.locator('#status')).toContainText('Ready.');
      await expect(page.locator('#view')).toHaveAttribute('width', '960');
      await expect(page.locator('#view')).toHaveAttribute('height', '600');
      if (mode !== 'native') {
        await page.locator('#view').scrollIntoViewIfNeeded();
        const bounds = await page.locator('#view').boundingBox();
        for (const [x, y] of [[.5, .5], [.45, .5], [.55, .5], [.4, .6], [.6, .6]]) {
          await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
          if ((await page.locator('#selection').textContent()).startsWith('Selected slot-')) break;
        }
        await expect(page.locator('#selection')).toContainText('Selected slot-');
      }
      await page.locator('#measure').click();
      await expect(page.locator('#status')).toContainText('Capture complete', { timeout: 40000 });
      const result = await page.locator('#results').evaluate(element => JSON.parse(element.textContent)[0]);
      expect(result.metadata.backend).toBe(backend);
      expect(result.metadata.visualParity).toBe(false);
      expect(result.samples).toBe(240);
      expect(result.valid).toBe(true);
      expect(result.gpuTimeMs).toBeNull();
      expect(Number.isFinite(result.frameIntervalMs.p95)).toBe(true);
      expect(Number.isFinite(result.synchronousRenderCallMs.p95)).toBe(true);
      if (mode === 'webgl') {
        await page.locator('#measure').click();
        await page.locator('#view').evaluate(canvas => {
          const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
          if (!extension) throw new Error('WEBGL_lose_context is required for the loss regression');
          extension.loseContext();
        });
        await expect(page.locator('#status')).toContainText('reload the renderer');
        await expect(page.locator('#measure')).toBeDisabled();
        await expect(page.locator('#cancel')).toBeDisabled();
        expect(await page.locator('#results').evaluate(element => JSON.parse(element.textContent).length)).toBe(1);
      }
      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
