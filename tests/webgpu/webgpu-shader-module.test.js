/**
 * tests/webgpu/webgpu-shader-module.test.js
 *
 * Tests for WebGPUShader.compile() — shader-module cache (deduplication).
 * Runs entirely in Node (no real GPU) using a mocked GPUDevice.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebGPUShader } from '../../js/engine/webgpu/WebGPUShader.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockDevice() {
  return {
    createShaderModule: vi.fn(({ code, label }) => ({ _code: code, _label: label })),
  };
}

const WGSL_A = '@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }';
const WGSL_B = '@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }';

// ---------------------------------------------------------------------------
// WebGPUShader.compile — cache deduplication
// ---------------------------------------------------------------------------

describe('WebGPUShader.compile', () => {
  it('returns a GPUShaderModule for a given source', () => {
    const device = makeMockDevice();
    const mod = WebGPUShader.compile(device, WGSL_A);
    expect(mod).toBeDefined();
    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
  });

  it('returns the cached module when called twice with the same source', () => {
    const device = makeMockDevice();
    const mod1 = WebGPUShader.compile(device, WGSL_A);
    const mod2 = WebGPUShader.compile(device, WGSL_A);
    expect(mod1).toBe(mod2);
    expect(device.createShaderModule).toHaveBeenCalledTimes(1);
  });

  it('compiles distinct modules for different sources', () => {
    const device = makeMockDevice();
    const modA = WebGPUShader.compile(device, WGSL_A);
    const modB = WebGPUShader.compile(device, WGSL_B);
    expect(modA).not.toBe(modB);
    expect(device.createShaderModule).toHaveBeenCalledTimes(2);
  });

  it('maintains separate caches per device', () => {
    const deviceX = makeMockDevice();
    const deviceY = makeMockDevice();
    const modX = WebGPUShader.compile(deviceX, WGSL_A);
    const modY = WebGPUShader.compile(deviceY, WGSL_A);
    expect(modX).not.toBe(modY);
    expect(deviceX.createShaderModule).toHaveBeenCalledTimes(1);
    expect(deviceY.createShaderModule).toHaveBeenCalledTimes(1);
  });

  it('passes the source code to createShaderModule', () => {
    const device = makeMockDevice();
    WebGPUShader.compile(device, WGSL_B);
    expect(device.createShaderModule).toHaveBeenCalledWith(
      expect.objectContaining({ code: WGSL_B }),
    );
  });
});
