// Minimal Playwright config for local GalaxyQuest UI smoke tests.
/** @type {import('@playwright/test').PlaywrightTestConfig} */

// Extra Chromium launch args for the WebGPU shader validation test.
// When running in CI (GQ_WEBGPU_SHADER_CI=1) or locally with the
// PLAYWRIGHT_CHROMIUM_ARGS env var set, these flags activate Chrome's
// software Vulkan renderer (SwiftShader) so that WebGPU is available
// without a physical GPU.
const webgpuArgs = process.env.GQ_WEBGPU_SHADER_CI === '1' || process.env.PLAYWRIGHT_CHROMIUM_ARGS
  ? [
      '--enable-unsafe-webgpu',
      '--use-vulkan=swiftshader',
      '--disable-vulkan-fallback-to-gl-for-testing',
      '--disable-dawn-features=disallow_unsafe_apis',
      '--use-angle=swiftshader',
      '--enable-features=Vulkan',
    ]
  : [];

module.exports = {
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: process.env.GQ_BASE_URL || 'http://localhost:8080',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: webgpuArgs,
        },
      },
    },
  ],
};
