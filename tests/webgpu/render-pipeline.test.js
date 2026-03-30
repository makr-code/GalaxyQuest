/**
 * tests/webgpu/render-pipeline.test.js
 *
 * Unit tests for WebGPU Phase 2:
 *  - WebGPURenderer: _createDepthBuffer, uploadMesh, createRenderPipeline,
 *    beginFrame/endFrame, render() scene iteration
 *  - WebGPURenderPass: drawMesh helper
 *
 * All tests run in Node (no real GPU) via mocked device objects.
 * WebGPU flag constants are provided by tests/webgpu/setup.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebGPURenderPass } from '../../js/engine/webgpu/WebGPURenderPass.js';
import { WebGPURenderer }   from '../../js/engine/core/WebGPURenderer.js';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeGPUBuffer(size) {
  const ab = new ArrayBuffer(size);
  return {
    size,
    _destroyed: false,
    getMappedRange: () => ab,
    unmap:    vi.fn(),
    destroy:  vi.fn(function () { this._destroyed = true; }),
  };
}

function makeMockTexture(spec) {
  return {
    ...spec,
    _destroyed: false,
    createView: vi.fn(() => ({ _type: 'view' })),
    destroy:    vi.fn(function () { this._destroyed = true; }),
  };
}

function makeMockDevice() {
  const device = {
    _lost: new Promise(() => {}),          // never resolves in tests
    get lost() { return this._lost; },
    limits: { maxTextureDimension2D: 8192 },
    features: { has: vi.fn(() => false) },
    createBuffer: vi.fn((spec) => makeGPUBuffer(spec.size)),
    createTexture: vi.fn((spec) => makeMockTexture(spec)),
    createShaderModule: vi.fn((spec) => ({ code: spec.code, label: spec.label })),
    createRenderPipeline: vi.fn((desc) => ({ _desc: desc, _type: 'pipeline' })),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({
        setPipeline:      vi.fn(),
        setVertexBuffer:  vi.fn(),
        setIndexBuffer:   vi.fn(),
        draw:             vi.fn(),
        drawIndexed:      vi.fn(),
        end:              vi.fn(),
      })),
      finish: vi.fn(() => 'commandBuffer'),
    })),
    queue: { submit: vi.fn(), writeBuffer: vi.fn() },
    destroy: vi.fn(),
  };
  return device;
}

function makeMockContext(device) {
  const texture = makeMockTexture({ width: 800, height: 600, format: 'bgra8unorm' });
  return {
    configure: vi.fn(),
    getCurrentTexture: vi.fn(() => texture),
  };
}

/** Build a renderer that is already "initialised" without real WebGPU. */
function makeReadyRenderer() {
  const device  = makeMockDevice();
  const context = makeMockContext(device);
  const canvas  = { width: 800, height: 600, getContext: vi.fn(() => context) };

  const r = new WebGPURenderer();
  r.device          = device;
  r.context         = context;
  r.canvas          = canvas;
  r.ready           = true;
  r.preferredFormat = 'bgra8unorm';

  // Create depth texture + shader manager exactly as initialize() would
  r._createDepthBuffer(800, 600);

  // Minimal WebGPUShader stub
  r._shaderMgr = {
    compileRenderPipeline: vi.fn((spec) => ({ _spec: spec, _type: 'pipeline' })),
    dispose: vi.fn(),
  };

  return { r, device, context, canvas };
}

// ---------------------------------------------------------------------------
// WebGPURenderPass — drawMesh
// ---------------------------------------------------------------------------

describe('WebGPURenderPass.drawMesh', () => {
  function makePass() {
    const device = makeMockDevice();
    const colorView = { _type: 'colorView' };
    const depthView = { _type: 'depthView' };
    const pass = new WebGPURenderPass(device, colorView, depthView);
    pass.begin();
    return { pass, encoder: pass._pass };
  }

  it('sets pipeline and draws with index buffer', () => {
    const { pass, encoder } = makePass();
    const geometry = {
      positions: new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]),
      indices:   new Uint16Array([0, 1, 2]),
      _gpuBuffers: {
        positions: makeGPUBuffer(36),
        indices:   makeGPUBuffer(8),
      },
    };
    const material = { _pipeline: { _type: 'pipeline' } };

    pass.drawMesh(geometry, material);

    expect(encoder.setPipeline).toHaveBeenCalledWith(material._pipeline);
    expect(encoder.setVertexBuffer).toHaveBeenCalledWith(0, geometry._gpuBuffers.positions);
    expect(encoder.setIndexBuffer).toHaveBeenCalledWith(geometry._gpuBuffers.indices, 'uint16');
    expect(encoder.drawIndexed).toHaveBeenCalledWith(3);
  });

  it('uses uint32 index format for Uint32Array indices', () => {
    const { pass, encoder } = makePass();
    const geometry = {
      positions: new Float32Array(9),
      indices:   new Uint32Array([0, 1, 2]),
      _gpuBuffers: {
        positions: makeGPUBuffer(36),
        indices:   makeGPUBuffer(12),
      },
    };
    const material = { _pipeline: { _type: 'pipeline' } };

    pass.drawMesh(geometry, material);
    expect(encoder.setIndexBuffer).toHaveBeenCalledWith(geometry._gpuBuffers.indices, 'uint32');
  });

  it('falls back to draw() when no index buffer is present', () => {
    const { pass, encoder } = makePass();
    const geometry = {
      positions: new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]),
      indices:   null,
      _gpuBuffers: { positions: makeGPUBuffer(36) },
    };
    const material = { _pipeline: { _type: 'pipeline' } };

    pass.drawMesh(geometry, material);

    expect(encoder.setIndexBuffer).not.toHaveBeenCalled();
    expect(encoder.draw).toHaveBeenCalledWith(3);  // 9 floats / 3 = 3 verts
  });

  it('binds optional normal and UV buffers to the correct slots', () => {
    const { pass, encoder } = makePass();
    const geometry = {
      positions: new Float32Array(9),
      normals:   new Float32Array(9),
      uvs:       new Float32Array(6),
      indices:   null,
      _gpuBuffers: {
        positions: makeGPUBuffer(36),
        normals:   makeGPUBuffer(36),
        uvs:       makeGPUBuffer(24),
      },
    };
    const material = { _pipeline: { _type: 'pipeline' } };

    pass.drawMesh(geometry, material);

    expect(encoder.setVertexBuffer).toHaveBeenCalledWith(1, geometry._gpuBuffers.normals);
    expect(encoder.setVertexBuffer).toHaveBeenCalledWith(2, geometry._gpuBuffers.uvs);
  });

  it('does nothing when material has no pipeline', () => {
    const { pass, encoder } = makePass();
    const geometry  = { _gpuBuffers: {} };
    const material  = { _pipeline: null };
    expect(() => pass.drawMesh(geometry, material)).not.toThrow();
    expect(encoder.setPipeline).not.toHaveBeenCalled();
  });

  it('does nothing when pass has not begun', () => {
    const device    = makeMockDevice();
    const pass      = new WebGPURenderPass(device, {}, null);
    // _pass is null — begin() was never called
    const geometry  = { _gpuBuffers: {} };
    const material  = { _pipeline: { _type: 'pipeline' } };
    expect(() => pass.drawMesh(geometry, material)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — _createDepthBuffer
// ---------------------------------------------------------------------------

describe('WebGPURenderer._createDepthBuffer', () => {
  it('creates a depth24plus texture with RENDER_ATTACHMENT usage', () => {
    const { r, device } = makeReadyRenderer();

    // makeReadyRenderer already called _createDepthBuffer once — reset spy
    device.createTexture.mockClear();
    r._createDepthBuffer(1024, 768);

    expect(device.createTexture).toHaveBeenCalledOnce();
    const spec = device.createTexture.mock.calls[0][0];
    expect(spec.format).toBe('depth24plus');
    expect(spec.usage).toBe(GPUTextureUsage.RENDER_ATTACHMENT);
    expect(spec.size).toEqual([1024, 768, 1]);
  });

  it('destroys the previous depth texture before creating a new one', () => {
    const { r } = makeReadyRenderer();
    const oldTexture = r._depthTexture;
    r._createDepthBuffer(512, 512);
    expect(oldTexture.destroy).toHaveBeenCalledOnce();
  });

  it('clamps size to at least 1×1', () => {
    const { r, device } = makeReadyRenderer();
    device.createTexture.mockClear();
    r._createDepthBuffer(0, 0);
    const spec = device.createTexture.mock.calls[0][0];
    expect(spec.size[0]).toBeGreaterThanOrEqual(1);
    expect(spec.size[1]).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — uploadMesh
// ---------------------------------------------------------------------------

describe('WebGPURenderer.uploadMesh', () => {
  it('creates GPU buffers for positions, normals, uvs, and indices', () => {
    const { r } = makeReadyRenderer();

    const geometry = {
      positions: new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]),
      normals:   new Float32Array([0, 0, 1,  0, 0, 1,  0, 0, 1]),
      uvs:       new Float32Array([0, 0,     1, 0,     0, 1]),
      indices:   new Uint16Array([0, 1, 2]),
      _gpuBuffers: {},
    };

    r.uploadMesh(geometry);

    expect(geometry._gpuBuffers.positions).toBeDefined();
    expect(geometry._gpuBuffers.normals).toBeDefined();
    expect(geometry._gpuBuffers.uvs).toBeDefined();
    expect(geometry._gpuBuffers.indices).toBeDefined();
  });

  it('skips already-uploaded buffers (idempotent)', () => {
    const { r, device } = makeReadyRenderer();
    const existing = makeGPUBuffer(36);
    const geometry = {
      positions: new Float32Array(9),
      normals:   null,
      uvs:       null,
      indices:   null,
      _gpuBuffers: { positions: existing },
    };

    device.createBuffer.mockClear();
    r.uploadMesh(geometry);

    expect(device.createBuffer).not.toHaveBeenCalled();
    expect(geometry._gpuBuffers.positions).toBe(existing);
  });

  it('handles geometry with only positions (no normals/uvs/indices)', () => {
    const { r } = makeReadyRenderer();
    const geometry = {
      positions: new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]),
      normals:   null, uvs: null, indices: null,
      _gpuBuffers: {},
    };
    expect(() => r.uploadMesh(geometry)).not.toThrow();
    expect(geometry._gpuBuffers.positions).toBeDefined();
    expect(geometry._gpuBuffers.normals).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — createRenderPipeline
// ---------------------------------------------------------------------------

describe('WebGPURenderer.createRenderPipeline', () => {
  it('delegates to _shaderMgr.compileRenderPipeline and caches on material', () => {
    const { r } = makeReadyRenderer();
    const material = {
      vertexSrc:   'vs src',
      fragmentSrc: 'fs src',
      depthTest:   true,
      needsUpdate: true,
      _pipeline:   null,
    };

    const pipeline = r.createRenderPipeline(material);

    expect(r._shaderMgr.compileRenderPipeline).toHaveBeenCalledOnce();
    const spec = r._shaderMgr.compileRenderPipeline.mock.calls[0][0];
    expect(spec.vertexSrc).toBe('vs src');
    expect(spec.fragmentSrc).toBe('fs src');
    expect(spec.depthTest).toBe(true);
    expect(spec.targetFormat).toBe('bgra8unorm');
    expect(spec.bufferLayouts).toHaveLength(3);

    expect(material._pipeline).toBe(pipeline);
    expect(material.needsUpdate).toBe(false);
  });

  it('passes depthTest:false when material.depthTest is false', () => {
    const { r } = makeReadyRenderer();
    const material = {
      vertexSrc: 'v', fragmentSrc: 'f',
      depthTest: false, needsUpdate: true, _pipeline: null,
    };
    r.createRenderPipeline(material);
    const spec = r._shaderMgr.compileRenderPipeline.mock.calls[0][0];
    expect(spec.depthTest).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — beginFrame / endFrame
// ---------------------------------------------------------------------------

describe('WebGPURenderer.beginFrame / endFrame', () => {
  it('beginFrame creates a WebGPURenderPass with depth view', () => {
    const { r } = makeReadyRenderer();
    const pass = r.beginFrame();
    // duck-type check — pass has begin/end/drawMesh methods
    expect(pass).not.toBeNull();
    expect(typeof pass.end).toBe('function');
    expect(typeof pass.drawMesh).toBe('function');
    expect(r._framePass).toBe(pass);
  });

  it('endFrame calls end() on the pass and clears _framePass', () => {
    const { r } = makeReadyRenderer();
    const pass = r.beginFrame();
    const endSpy = vi.spyOn(pass, 'end');
    r.endFrame();
    expect(endSpy).toHaveBeenCalledOnce();
    expect(r._framePass).toBeNull();
  });

  it('beginFrame returns null when renderer is not ready', () => {
    const { r } = makeReadyRenderer();
    r.ready = false;
    expect(r.beginFrame()).toBeNull();
  });

  it('endFrame is a no-op when no frame is active', () => {
    const { r } = makeReadyRenderer();
    expect(() => r.endFrame()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — render() with scene iteration
// ---------------------------------------------------------------------------

describe('WebGPURenderer.render', () => {
  it('uploads mesh and creates pipeline lazily, then draws', () => {
    const { r } = makeReadyRenderer();

    const geometry = {
      positions: new Float32Array([0, 0, 0,  1, 0, 0,  0, 1, 0]),
      normals:   null, uvs: null,
      indices:   new Uint16Array([0, 1, 2]),
      _gpuBuffers: {},
    };
    const material = {
      vertexSrc: 'v', fragmentSrc: 'f',
      depthTest: true, needsUpdate: true, _pipeline: null,
    };

    const scene = {
      update: () => [{ data: { geometry, material } }],
    };

    r.render(scene, {});

    expect(geometry._gpuBuffers.positions).toBeDefined();
    expect(material._pipeline).toBeDefined();
    expect(r._shaderMgr.compileRenderPipeline).toHaveBeenCalledOnce();
  });

  it('skips nodes without geometry or material', () => {
    const { r } = makeReadyRenderer();
    const scene = {
      update: () => [
        { data: null },
        { data: { geometry: null, material: {} } },
        { data: { geometry: {}, material: null } },
      ],
    };
    expect(() => r.render(scene, {})).not.toThrow();
  });

  it('does nothing when renderer is not ready', () => {
    const { r } = makeReadyRenderer();
    r.ready = false;
    const scene = { update: vi.fn() };
    r.render(scene, {});
    expect(scene.update).not.toHaveBeenCalled();
  });

  it('handles a scene without an update() method gracefully', () => {
    const { r } = makeReadyRenderer();
    expect(() => r.render(null, {})).not.toThrow();
    expect(() => r.render({}, {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — resize recreates depth buffer
// ---------------------------------------------------------------------------

describe('WebGPURenderer.resize', () => {
  it('recreates the depth buffer to the new dimensions', () => {
    const { r, device } = makeReadyRenderer();
    device.createTexture.mockClear();

    r.resize(1920, 1080);

    expect(device.createTexture).toHaveBeenCalledOnce();
    const spec = device.createTexture.mock.calls[0][0];
    expect(spec.size).toEqual([1920, 1080, 1]);
    expect(spec.format).toBe('depth24plus');
  });

  it('does not recreate depth buffer when renderer is not ready', () => {
    const { r, device } = makeReadyRenderer();
    r.ready = false;
    device.createTexture.mockClear();
    r.resize(640, 480);
    expect(device.createTexture).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WebGPURenderer — dispose
// ---------------------------------------------------------------------------

describe('WebGPURenderer.dispose', () => {
  it('destroys depth texture, disposes shaderMgr, destroys device', () => {
    const { r, device } = makeReadyRenderer();
    const depthTex = r._depthTexture;

    r.dispose();

    expect(depthTex.destroy).toHaveBeenCalledOnce();
    expect(r._depthTexture).toBeNull();
    expect(r._shaderMgr).toBeNull();
    expect(device.destroy).toHaveBeenCalledOnce();
    expect(r.ready).toBe(false);
  });
});
