const { test, expect } = require('@playwright/test');

// Requires the existing Vite dev server. GQ_CHROMIUM_EXECUTABLE_PATH can select
// an already-installed system Chromium instead of Playwright's bundled browser.
test('native instancing preserves selected IDs after culling and resolves optional GPU timestamps', async ({ playwright, baseURL }, testInfo) => {
  const browser = await playwright.chromium.launch({
    ...testInfo.project.use.launchOptions,
    ...(process.env.GQ_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.GQ_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.route('**/__native-render-smoke', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><div id="host" style="position:relative;width:800px;height:600px"></div>',
    }));
    await page.goto(`${baseURL}/__native-render-smoke`);
    const available = await page.evaluate(async () => !!navigator.gpu && !!await navigator.gpu.requestAdapter());
    test.skip(!available, 'No WebGPU adapter available; no rendering assertions performed.');

    const result = await page.evaluate(async () => {
      await import('/js/runtime/galaxy-chunk-utils.js');
      await import('/js/rendering/Galaxy3DRendererWebGPU.js');
      const renderer = new window.Galaxy3DRendererWebGPU(document.getElementById('host'), {
        performanceBudget: { sampleIntervalMs: 96 },
      });
      await renderer.init();
      if (renderer.backendType !== 'webgpu') throw new Error('Native WebGPU initialization failed');
      renderer._running = false;
      cancelAnimationFrame(renderer._rafId);
      renderer._resizeObserver?.disconnect();
      const device = renderer._device;
      const validationErrors = [];
      device.addEventListener('uncapturederror', event => validationErrors.push(event.error.message));
      device.pushErrorScope('validation');
      // Test-only readback usage. Production canvas usage remains unchanged.
      renderer._context.configure({
        device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      renderer.setStars([
        { x_ly: 100, y_ly: 0, spectral_class: 'M' },
        { x_ly: -100, y_ly: 0, spectral_class: 'G' },
        { x_ly: 100, y_ly: 0, spectral_class: 'M' },
      ]);
      Object.assign(renderer._view, { panX: -1, targetPanX: -1, zoom: 6, targetZoom: 6 });
      const pixels = [];
      for (const index of [-1, 2]) {
        await new Promise(requestAnimationFrame);
        renderer._selectedIdx = index;
        renderer._renderFrame(performance.now());
        const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: renderer._context.getCurrentTexture(), origin: { x: 400, y: 300 } },
          { buffer, bytesPerRow: 256 }, { width: 1, height: 1 },
        );
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        pixels.push(Array.from(new Uint8Array(buffer.getMappedRange()).slice(0, 4)));
        buffer.unmap();
        buffer.destroy();
      }
      await device.queue.onSubmittedWorkDone();
      // The profiler's asynchronous mapping must settle before inspecting it.
      for (let i = 0; i < 50 && renderer._gpuProfiler._activeSpans.size; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      renderer._renderFrame(performance.now() + 96);
      await device.queue.onSubmittedWorkDone();
      const scoped = await device.popErrorScope();
      if (scoped) validationErrors.push(scoped.message);
      const stats = renderer.getRenderStats();
      const snapshot = {
        backend: renderer.backendType, selectedIndex: renderer.selectedIndex,
        submittedStars: stats.submittedStars, residentBytes: stats.residentStarBytes,
        memoryMB: stats.performance.memoryAvgMB, gpuBudgetMs: stats.performance.gpuTimeAvgMs,
        pixels, validationErrors,
        timestampEnabled: device.features.has('timestamp-query'), gpuTimings: stats.gpuTimings,
      };
      renderer.dispose();
      return snapshot;
    });
    expect(pageErrors).toEqual([]);
    expect(result.validationErrors).toEqual([]);
    expect(result.backend).toBe('webgpu');
    expect(result.selectedIndex).toBe(2);
    expect(result.submittedStars).toBe(2);
    expect(result.residentBytes).toBe(56);
    expect(result.memoryMB).toBeNull();
    expect(result.pixels[0][3]).toBe(255);
    expect(result.pixels[1][3]).toBe(255);
    expect(result.pixels[1].slice(0, 3).reduce((sum, channel) => sum + channel, 0))
      .toBeGreaterThan(result.pixels[0].slice(0, 3).reduce((sum, channel) => sum + channel, 0));
    if (result.timestampEnabled) {
      expect(result.gpuBudgetMs).not.toBeNull();
      expect(result.gpuTimings['main-pass'].samples).toBeGreaterThan(0);
      expect(result.gpuTimings['main-pass'].avgMs).toBeGreaterThanOrEqual(0);
    } else {
      expect(result.gpuTimings).toEqual({});
    }
  } finally {
    await browser.close();
  }
});
