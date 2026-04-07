/**
 * tests/webgpu/compute.test.js
 *
 * Tests for ComputePass dispatch:
 *   - calls renderer.dispatchCompute() when enabled and shaderSrc is set
 *   - no-op when disabled or shaderSrc is empty
 *   - setBindGroup / removeBindGroup bookkeeping
 *   - dispose clears pipeline + bindGroups
 */

import { describe, it, expect, vi } from 'vitest';
import { ComputePass } from '../../js/engine/post-effects/passes/ComputePass.js';

const WGSL = `@compute @workgroup_size(64) fn cs_main() {}`;

function makeRenderer() {
  return { dispatchCompute: vi.fn() };
}

describe('ComputePass construction', () => {
  it('sets defaults', () => {
    const p = new ComputePass({ label: 'test', shaderSrc: WGSL });
    expect(p.enabled).toBe(true);
    expect(p.label).toBe('test');
    expect(p.workgroupsX).toBe(1);
    expect(p.workgroupsY).toBe(1);
    expect(p.workgroupsZ).toBe(1);
    expect(p._pipeline).toBeNull();
  });

  it('stores custom workgroup counts', () => {
    const p = new ComputePass({ shaderSrc: WGSL, workgroupsX: 8, workgroupsY: 4, workgroupsZ: 2 });
    expect(p.workgroupsX).toBe(8);
    expect(p.workgroupsY).toBe(4);
    expect(p.workgroupsZ).toBe(2);
  });
});

describe('ComputePass.render()', () => {
  it('calls renderer.dispatchCompute when enabled with shaderSrc', () => {
    const r = makeRenderer();
    const p = new ComputePass({ label: 'x', shaderSrc: WGSL });
    p.render(null, null, r);
    expect(r.dispatchCompute).toHaveBeenCalledOnce();
    expect(r.dispatchCompute).toHaveBeenCalledWith(p);
  });

  it('does NOT call dispatchCompute when disabled', () => {
    const r = makeRenderer();
    const p = new ComputePass({ shaderSrc: WGSL });
    p.enabled = false;
    p.render(null, null, r);
    expect(r.dispatchCompute).not.toHaveBeenCalled();
  });

  it('does NOT call dispatchCompute when shaderSrc is empty', () => {
    const r = makeRenderer();
    const p = new ComputePass({ shaderSrc: '' });
    p.render(null, null, r);
    expect(r.dispatchCompute).not.toHaveBeenCalled();
  });

  it('does NOT throw when renderer has no dispatchCompute', () => {
    const p = new ComputePass({ shaderSrc: WGSL });
    expect(() => p.render(null, null, {})).not.toThrow();
  });

  it('does NOT throw when renderer is null', () => {
    const p = new ComputePass({ shaderSrc: WGSL });
    expect(() => p.render(null, null, null)).not.toThrow();
  });
});

describe('ComputePass bind group management', () => {
  it('setBindGroup stores the bind group', () => {
    const p = new ComputePass({ shaderSrc: WGSL });
    const bg = { label: 'mock-bg' };
    p.setBindGroup(0, bg);
    expect(p._bindGroups.get(0)).toBe(bg);
  });

  it('removeBindGroup removes the bind group', () => {
    const p = new ComputePass({ shaderSrc: WGSL });
    const bg = {};
    p.setBindGroup(0, bg);
    p.removeBindGroup(0);
    expect(p._bindGroups.has(0)).toBe(false);
  });

  it('multiple groups tracked independently', () => {
    const p  = new ComputePass({ shaderSrc: WGSL });
    const b0 = { label: 'bg0' };
    const b1 = { label: 'bg1' };
    p.setBindGroup(0, b0);
    p.setBindGroup(1, b1);
    expect(p._bindGroups.size).toBe(2);
    expect(p._bindGroups.get(0)).toBe(b0);
    expect(p._bindGroups.get(1)).toBe(b1);
  });
});

describe('ComputePass.dispose()', () => {
  it('clears pipeline and bindGroups', () => {
    const p = new ComputePass({ shaderSrc: WGSL });
    p._pipeline = { label: 'fake' };
    p.setBindGroup(0, {});
    p.dispose();
    expect(p._pipeline).toBeNull();
    expect(p._bindGroups.size).toBe(0);
  });
});
