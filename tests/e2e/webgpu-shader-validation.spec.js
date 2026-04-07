/**
 * tests/e2e/webgpu-shader-validation.spec.js
 *
 * Hardware-in-Loop CI: validate every WGSL shader in GalaxyQuest by
 * requesting a real GPU device (or software fallback) inside Chromium and
 * calling `device.createShaderModule().compilationInfo()`.
 *
 * What this test proves:
 *   - Each shader module compiles without errors on the actual GPU driver
 *     (or Chrome's SwiftShader software renderer when no GPU is present).
 *   - Entry-point names and struct layouts are accepted by the WGSL validator
 *     built into Chrome/Dawn — the same validator that runs in production.
 *
 * Skipped if `navigator.gpu` is unavailable (e.g. old browser without
 * WebGPU support) — the test is annotated as "skip" rather than "fail" in
 * that case so existing CI passes on headless environments without WebGPU.
 *
 * Run manually:
 *   npx playwright test tests/e2e/webgpu-shader-validation.spec.js
 *
 * Run in CI with software WebGPU (see .github/workflows/webgpu-shader-validation.yml):
 *   GQ_WEBGPU_SHADER_CI=1 npx playwright test tests/e2e/webgpu-shader-validation.spec.js
 */

'use strict';

const { test, expect } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Collect WGSL sources from .wgsl files and inline WGSL in JS modules
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '../..');

/** Load a standalone .wgsl file. */
function loadWgslFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/** Extract the inline WGSL template-literal from a JS module via require(). */
function extractWgslFromModule(relPath, exportedKey) {
  // require() evaluates the template literal, so ${WORKGROUP_SIZE} etc. are
  // already resolved in the returned string.
  const mod = require(path.join(ROOT, relPath));
  return mod[exportedKey];
}

/** Build the catalogue of all shaders to validate. */
function buildShaderCatalogue() {
  return [
    // ── Compute shaders (inline WGSL in JS) ────────────────────────────────
    {
      label: 'WebGPUPhysics — N-body gravity compute',
      type:  'compute',
      source: extractWgslFromModule(
        'js/engine/webgpu/WebGPUPhysics.js',
        'PHYSICS_WGSL',
      ),
    },
    {
      label: 'NPCPathfindingCompute — Seek/Arrive/Separation compute',
      type:  'compute',
      source: extractWgslFromModule(
        'js/engine/webgpu/NPCPathfindingCompute.js',
        'PATHFIND_WGSL',
      ),
    },

    // ── FX render shaders (.wgsl files) ────────────────────────────────────
    {
      label: 'FX — starfield (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/starfield.wgsl'),
    },
    {
      label: 'FX — warp tunnel (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/warp.wgsl'),
    },
    {
      label: 'FX — nebula (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/nebula.wgsl'),
    },
    {
      label: 'FX — particles (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/particles.wgsl'),
    },
    {
      label: 'FX — godray (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/godray.wgsl'),
    },
    {
      label: 'FX — beam (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/beam.wgsl'),
    },
    {
      label: 'FX — debris (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/debris.wgsl'),
    },
    {
      label: 'FX — volumetric scatter (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/fx/shaders/volscatter.wgsl'),
    },

    // ── Post-effect render shaders (.wgsl files) ────────────────────────────
    {
      label: 'PostFX — bloom (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/post-effects/shaders/bloom.wgsl'),
    },
    {
      label: 'PostFX — SSAO (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/post-effects/shaders/ssao.wgsl'),
    },
    {
      label: 'PostFX — chromatic aberration (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/post-effects/shaders/chromatic.wgsl'),
    },
    {
      label: 'PostFX — vignette (vertex + fragment)',
      type:  'render',
      source: loadWgslFile('js/engine/post-effects/shaders/vignette.wgsl'),
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Request a WebGPU device inside the browser context.
 * Tries `forceFallbackAdapter` (software Vulkan/SwiftShader) first so the
 * test works in CI without a physical GPU.
 */
async function acquireWebGPUDevice(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return null;

    // 1. Try software fallback adapter (SwiftShader / WARP)
    let adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });

    // 2. Fall back to any available adapter (real GPU in local dev / CI runners that have one)
    if (!adapter) {
      adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
    }
    if (!adapter) return null;

    const device = await adapter.requestDevice();
    if (!device) return null;

    return { adapterInfo: (await adapter.requestAdapterInfo?.()) ?? {}, available: true };
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('WebGPU WGSL Shader Validation (Hardware-in-Loop)', () => {

  let shaders;

  test.beforeAll(() => {
    shaders = buildShaderCatalogue();
  });

  test('WebGPU is available in the test browser', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await acquireWebGPUDevice(page);

    if (!result) {
      test.skip(true, 'navigator.gpu not available in this browser — skipping shader validation.');
      return;
    }
    expect(result.available).toBe(true);
  });

  test('All WGSL shaders compile without errors', async ({ page }) => {
    await page.setContent('<html><body></body></html>');

    // Check WebGPU availability first
    const deviceCheck = await acquireWebGPUDevice(page);
    if (!deviceCheck) {
      test.skip(true, 'No WebGPU adapter available — skipping shader compilation test.');
      return;
    }

    // Pass shader sources into the page and compile each one
    const results = await page.evaluate(async (shaderList) => {
      if (!navigator.gpu) return [];

      let adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
      if (!adapter) adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
      if (!adapter) return [];

      const device = await adapter.requestDevice();
      if (!device) return [];

      const report = [];

      for (const shader of shaderList) {
        let errors = [];
        let warnings = [];

        try {
          const mod = device.createShaderModule({ label: shader.label, code: shader.source });

          // compilationInfo() is the spec-compliant way to get WGSL errors
          if (typeof mod.getCompilationInfo === 'function') {
            const info = await mod.getCompilationInfo();
            for (const msg of info.messages) {
              if (msg.type === 'error') {
                errors.push(`[${msg.lineNum}:${msg.linePos}] ${msg.message}`);
              } else if (msg.type === 'warning') {
                warnings.push(`[${msg.lineNum}:${msg.linePos}] ${msg.message}`);
              }
            }
          }
        } catch (e) {
          errors.push(String(e));
        }

        report.push({ label: shader.label, errors, warnings });
      }

      device.destroy();
      return report;
    }, shaders.map(s => ({ label: s.label, source: s.source })));

    if (results.length === 0) {
      test.skip(true, 'No WebGPU device available — compilationInfo() not run.');
      return;
    }

    // Report all findings
    const failed = results.filter(r => r.errors.length > 0);

    if (failed.length > 0) {
      const msg = failed.map(r =>
        `\n  ❌ ${r.label}\n${r.errors.map(e => `       ${e}`).join('\n')}`,
      ).join('');
      throw new Error(`${failed.length} WGSL shader(s) failed compilation:${msg}`);
    }

    // Log warnings (informational, not fatal)
    for (const r of results) {
      if (r.warnings.length > 0) {
        console.warn(`  ⚠ ${r.label}: ${r.warnings.join(', ')}`);
      }
    }

    expect(failed.length).toBe(0);
  });

  // One test per shader for granular CI failure reports
  for (const shader of buildShaderCatalogue()) {
    test(`WGSL: ${shader.label}`, async ({ page }) => {
      await page.setContent('<html><body></body></html>');

      const deviceCheck = await acquireWebGPUDevice(page);
      if (!deviceCheck) {
        test.skip(true, 'No WebGPU adapter available.');
        return;
      }

      const result = await page.evaluate(async ({ label, source }) => {
        if (!navigator.gpu) return { skipped: true };

        let adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
        if (!adapter) adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
        if (!adapter) return { skipped: true };

        const device = await adapter.requestDevice();
        if (!device) return { skipped: true };

        let errors = [];
        try {
          const mod = device.createShaderModule({ label, code: source });
          if (typeof mod.getCompilationInfo === 'function') {
            const info = await mod.getCompilationInfo();
            for (const msg of info.messages) {
              if (msg.type === 'error') {
                errors.push(`[${msg.lineNum}:${msg.linePos}] ${msg.message}`);
              }
            }
          }
        } catch (e) {
          errors.push(String(e));
        }

        device.destroy();
        return { skipped: false, errors };
      }, { label: shader.label, source: shader.source });

      if (result.skipped) {
        test.skip(true, 'No WebGPU adapter.');
        return;
      }

      expect(result.errors, `Shader errors in "${shader.label}":`).toEqual([]);
    });
  }
});
