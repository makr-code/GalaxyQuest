/**
 * tests/webgpu/capabilities.test.js
 *
 * Tests for WebGPUCapabilities:
 *   - tier computation from maxTextureSize + float32Filterable
 *   - feature flag detection via adapter.features.has()
 *   - toString() format
 */

import { describe, it, expect } from 'vitest';
import { WebGPUCapabilities } from '../../js/engine/utils/WebGPUCapabilities.js';

// ---------------------------------------------------------------------------
// Mock adapter + device helpers
// ---------------------------------------------------------------------------

function makeAdapter(features = [], limits = {}) {
  return {
    features: { has: (f) => features.includes(f) },
    limits:   {},
  };
}

function makeDevice(limits = {}) {
  return {
    limits: {
      maxTextureDimension2D:              limits.maxTextureSize             ?? 8192,
      maxBindGroups:                       limits.maxBindGroups              ?? 4,
      maxUniformBufferBindingSize:         limits.maxUniformBufSize          ?? 65536,
      maxStorageBufferBindingSize:         limits.maxStorageBufSize          ?? 134217728,
      maxComputeWorkgroupSizeX:            limits.maxComputeWorkgroupSizeX   ?? 256,
      maxComputeInvocationsPerWorkgroup:   limits.maxComputeInvocations      ?? 256,
    },
  };
}

// ---------------------------------------------------------------------------
// Tier computation
// ---------------------------------------------------------------------------

describe('WebGPUCapabilities — quality tier', () => {
  it('returns "high" for maxTex≥8192 + float32-filterable', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter(['float32-filterable']),
      makeDevice({ maxTextureSize: 8192 }),
    );
    expect(caps.tier).toBe('high');
  });

  it('returns "medium" for maxTex≥4096 without float32-filterable', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter([]),
      makeDevice({ maxTextureSize: 4096 }),
    );
    expect(caps.tier).toBe('medium');
  });

  it('returns "medium" for maxTex=8192 without float32-filterable', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter([]),
      makeDevice({ maxTextureSize: 8192 }),
    );
    expect(caps.tier).toBe('medium');
  });

  it('returns "low" for maxTex<4096', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter(['float32-filterable']),
      makeDevice({ maxTextureSize: 2048 }),
    );
    expect(caps.tier).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

describe('WebGPUCapabilities — feature flags', () => {
  it('detects timestampQuery when feature is present', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter(['timestamp-query']),
      makeDevice(),
    );
    expect(caps.timestampQuery).toBe(true);
  });

  it('timestampQuery is false when feature absent', () => {
    const caps = new WebGPUCapabilities(makeAdapter([]), makeDevice());
    expect(caps.timestampQuery).toBe(false);
  });

  it('computeShaders is always true', () => {
    const caps = new WebGPUCapabilities(makeAdapter([]), makeDevice());
    expect(caps.computeShaders).toBe(true);
  });

  it('detects depth32Stencil8', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter(['depth32float-stencil8']),
      makeDevice(),
    );
    expect(caps.depth32Stencil8).toBe(true);
  });

  it('float32Filterable defaults false without feature', () => {
    const caps = new WebGPUCapabilities(makeAdapter([]), makeDevice());
    expect(caps.float32Filterable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Device limits
// ---------------------------------------------------------------------------

describe('WebGPUCapabilities — device limits', () => {
  it('reads maxTextureSize from device.limits', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter([]),
      makeDevice({ maxTextureSize: 16384 }),
    );
    expect(caps.maxTextureSize).toBe(16384);
  });

  it('reads maxBindGroups', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter([]),
      makeDevice({ maxBindGroups: 8 }),
    );
    expect(caps.maxBindGroups).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// toString()
// ---------------------------------------------------------------------------

describe('WebGPUCapabilities.toString()', () => {
  it('contains tier and key fields', () => {
    const caps = new WebGPUCapabilities(
      makeAdapter(['timestamp-query', 'float32-filterable']),
      makeDevice({ maxTextureSize: 8192 }),
    );
    const s = caps.toString();
    expect(s).toContain('tier=high');
    expect(s).toContain('maxTex=8192');
    expect(s).toContain('timestampQuery=true');
    expect(s).toContain('float32Filterable=true');
  });
});
