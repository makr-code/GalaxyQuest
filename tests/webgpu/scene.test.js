/**
 * tests/webgpu/scene.test.js
 *
 * Phase 2 — Scene Graph & Camera tests:
 *   - Frustum: plane extraction, sphere containment
 *   - SceneGraph: frustum culling via optional camera param
 *   - Light: buildLightUniformBlock() packing
 *   - Geometry: uploadToGPU() via WebGPUBuffer
 *
 * All tests run in Node (no real GPU required).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Frustum, PerspectiveCamera } from '../../js/engine/scene/Camera.js';
import { SceneNode, SceneGraph }      from '../../js/engine/scene/SceneGraph.js';
import { AmbientLight, DirectionalLight, PointLight,
         buildLightUniformBlock, LIGHT_TYPE } from '../../js/engine/scene/Light.js';
import { Geometry }   from '../../js/engine/scene/Geometry.js';
import { WebGPUBuffer, BufferType }  from '../../js/engine/webgpu/WebGPUBuffer.js';

// ===========================================================================
// Mock helpers
// ===========================================================================

/** Minimal GPUDevice for WebGPUBuffer tests. */
function makeMockDevice() {
  return {
    _buffers: [],
    createBuffer({ size, usage, mappedAtCreation }) {
      const ab  = new ArrayBuffer(size);
      const buf = {
        size, usage,
        _data: ab,
        getMappedRange: () => ab,
        unmap:   vi.fn(),
        destroy: vi.fn(),
      };
      this._buffers.push(buf);
      return buf;
    },
    queue: { writeBuffer: vi.fn() },
  };
}

/** Build a SceneNode with an optional bounding sphere. */
function makeNode(name, boundsRadius = null) {
  const n = new SceneNode(name);
  if (boundsRadius !== null) {
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    n.bounds = { center: new Vector3(0, 0, 0), radius: boundsRadius };
  }
  return n;
}

// ===========================================================================
// Frustum — construction
// ===========================================================================

describe('Frustum — construction', () => {
  it('creates 6 planes', () => {
    const f = new Frustum();
    expect(f.planes.length).toBe(6);
  });

  it('each plane is a Float32Array of 4 elements', () => {
    const f = new Frustum();
    for (const p of f.planes) {
      expect(p).toBeInstanceOf(Float32Array);
      expect(p.length).toBe(4);
    }
  });
});

// ===========================================================================
// Frustum — setFromMatrix
// ===========================================================================

describe('Frustum — setFromMatrix', () => {
  it('returns this for chaining', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    cam.update();
    const { Matrix4 } = require('../../js/engine/math/Matrix4.js');
    const pv = new Matrix4().multiplyMatrices(cam.projMatrix, cam.viewMatrix);
    const f = new Frustum();
    expect(f.setFromMatrix(pv)).toBe(f);
  });

  it('normalises plane normals (length ≈ 1)', () => {
    const cam = new PerspectiveCamera(60, 1.777, 0.1, 1000);
    cam.update();
    const { Matrix4 } = require('../../js/engine/math/Matrix4.js');
    const pv = new Matrix4().multiplyMatrices(cam.projMatrix, cam.viewMatrix);
    const f  = new Frustum();
    f.setFromMatrix(pv);
    for (const p of f.planes) {
      const len = Math.sqrt(p[0]*p[0] + p[1]*p[1] + p[2]*p[2]);
      expect(len).toBeCloseTo(1.0, 4);
    }
  });
});

// ===========================================================================
// Frustum — containsSphere
// ===========================================================================

describe('Frustum — containsSphere', () => {
  let cam, frustum;

  beforeEach(() => {
    cam = new PerspectiveCamera(90, 1, 1, 100);
    cam.update();
    frustum = cam._frustum;
  });

  it('returns true for a sphere at the camera origin (inside)', () => {
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    // Camera is at (0,0,5) looking down -Z by default; sphere at (0,0,0) should be inside
    expect(frustum.containsSphere(new Vector3(0, 0, 0), 1)).toBe(true);
  });

  it('returns false for a sphere far behind the camera', () => {
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    // Very far in front (+Z) relative to the default camera position at (0,0,5)
    // Looking down -Z, anything at +Z+100 is behind the far plane
    expect(frustum.containsSphere(new Vector3(0, 0, 10000), 1)).toBe(false);
  });

  it('returns false for a sphere far off to the side', () => {
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    expect(frustum.containsSphere(new Vector3(5000, 0, 0), 1)).toBe(false);
  });

  it('large-radius sphere spanning the entire frustum is visible', () => {
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    expect(frustum.containsSphere(new Vector3(0, 0, 0), 10000)).toBe(true);
  });
});

// ===========================================================================
// Camera — frustum auto-update
// ===========================================================================

describe('Camera — frustum integration', () => {
  it('PerspectiveCamera creates _frustum after update()', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    expect(cam._frustum).toBeNull();
    cam.update();
    expect(cam._frustum).toBeInstanceOf(Frustum);
  });

  it('PerspectiveCamera updates _frustum after lookAt()', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    cam.lookAt(new Vector3(0, 0, 0));
    expect(cam._frustum).toBeInstanceOf(Frustum);
  });

  it('_frustum is updated after setAspect()', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    cam.update();
    const oldPlane0 = cam._frustum.planes[0].slice();
    cam.setAspect(2.0);
    cam.update();
    // Changing aspect changes left/right planes
    const newPlane0 = cam._frustum.planes[0];
    expect(Array.from(newPlane0)).not.toEqual(Array.from(oldPlane0));
  });
});

// ===========================================================================
// SceneGraph — frustum culling
// ===========================================================================

describe('SceneGraph — update without camera (no culling)', () => {
  it('all visible nodes included when no camera is provided', () => {
    const sg = new SceneGraph();
    sg.add(new SceneNode('a'));
    sg.add(new SceneNode('b'));
    const list = sg.update();
    expect(list.length).toBe(2);
  });
});

describe('SceneGraph — update with camera (frustum culling)', () => {
  it('includes all nodes when no bounds are set', () => {
    const cam = new PerspectiveCamera(90, 1, 1, 100);
    cam.update();
    const sg = new SceneGraph();
    sg.add(new SceneNode('a'));
    sg.add(new SceneNode('b'));
    const list = sg.update(cam);
    expect(list.length).toBe(2);
  });

  it('includes in-frustum bounded nodes', () => {
    const cam = new PerspectiveCamera(90, 1, 1, 100);
    cam.update();
    const sg = new SceneGraph();
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    // Camera at (0,0,5) facing -Z; sphere at (0,0,0) with large radius should be visible
    const node = new SceneNode('visible');
    node.bounds = { center: new Vector3(0, 0, 0), radius: 2 };
    sg.add(node);
    const list = sg.update(cam);
    expect(list).toContain(node);
  });

  it('excludes out-of-frustum bounded nodes', () => {
    const cam = new PerspectiveCamera(90, 1, 1, 100);
    cam.update();
    const sg = new SceneGraph();
    const { Vector3 } = require('../../js/engine/math/Vector3.js');
    const node = new SceneNode('culled');
    node.bounds = { center: new Vector3(0, 0, 10000), radius: 1 };
    sg.add(node);
    const list = sg.update(cam);
    expect(list).not.toContain(node);
  });

  it('mixes bounded and unbounded nodes correctly', () => {
    const cam = new PerspectiveCamera(90, 1, 1, 100);
    cam.update();
    const sg = new SceneGraph();
    const { Vector3 } = require('../../js/engine/math/Vector3.js');

    const unbounded = new SceneNode('unbounded'); // always visible
    const inFrustum = new SceneNode('in');
    inFrustum.bounds = { center: new Vector3(0, 0, 0), radius: 2 };
    const outFrustum = new SceneNode('out');
    outFrustum.bounds = { center: new Vector3(0, 0, 10000), radius: 1 };

    sg.add(unbounded).add(inFrustum).add(outFrustum);
    const list = sg.update(cam);

    expect(list).toContain(unbounded);
    expect(list).toContain(inFrustum);
    expect(list).not.toContain(outFrustum);
  });

  it('culled parent suppresses its children', () => {
    const cam = new PerspectiveCamera(90, 1, 1, 100);
    cam.update();
    const sg = new SceneGraph();
    const { Vector3 } = require('../../js/engine/math/Vector3.js');

    const parent = new SceneNode('parent');
    parent.bounds = { center: new Vector3(0, 0, 10000), radius: 1 };
    const child = new SceneNode('child'); // no bounds

    parent.add(child);
    sg.add(parent);

    const list = sg.update(cam);
    expect(list).not.toContain(parent);
    expect(list).not.toContain(child);
  });
});

// ===========================================================================
// buildLightUniformBlock
// ===========================================================================

describe('buildLightUniformBlock — structure', () => {
  it('returns a Float32Array', () => {
    expect(buildLightUniformBlock([])).toBeInstanceOf(Float32Array);
  });

  it('total size is 4 + maxLights×16 floats', () => {
    const block = buildLightUniformBlock([], 8);
    expect(block.length).toBe(4 + 8 * 16);
  });

  it('header [0] = light count', () => {
    const lights = [new AmbientLight(), new AmbientLight()];
    const block  = buildLightUniformBlock(lights);
    expect(block[0]).toBe(2);
  });

  it('empty list gives count = 0', () => {
    expect(buildLightUniformBlock([])[0]).toBe(0);
  });

  it('clamps lights to maxLights', () => {
    const lights = Array.from({ length: 10 }, () => new AmbientLight());
    const block  = buildLightUniformBlock(lights, 4);
    expect(block[0]).toBe(4);
  });
});

describe('buildLightUniformBlock — AmbientLight', () => {
  it('encodes type as LIGHT_TYPE.AMBIENT (0)', () => {
    const block = buildLightUniformBlock([new AmbientLight(0xffffff, 0.5)]);
    expect(block[4]).toBe(LIGHT_TYPE.AMBIENT);
  });

  it('encodes colour correctly', () => {
    const block = buildLightUniformBlock([new AmbientLight(0xff0000, 1)]);
    expect(block[4 + 1]).toBeCloseTo(1.0, 4); // R
    expect(block[4 + 2]).toBeCloseTo(0.0, 4); // G
    expect(block[4 + 3]).toBeCloseTo(0.0, 4); // B
  });

  it('encodes intensity at offset 4', () => {
    const block = buildLightUniformBlock([new AmbientLight(0xffffff, 0.75)]);
    expect(block[4 + 4]).toBeCloseTo(0.75, 4);
  });

  it('visible flag is 1 for default light', () => {
    const block = buildLightUniformBlock([new AmbientLight()]);
    expect(block[4 + 14]).toBe(1);
  });
});

describe('buildLightUniformBlock — DirectionalLight', () => {
  it('encodes type as LIGHT_TYPE.DIRECTIONAL (1)', () => {
    const block = buildLightUniformBlock([new DirectionalLight()]);
    expect(block[4]).toBe(LIGHT_TYPE.DIRECTIONAL);
  });

  it('encodes direction (default 0,-1,0)', () => {
    const block = buildLightUniformBlock([new DirectionalLight()]);
    expect(block[4 + 8]).toBeCloseTo(0,  4);  // dirX
    expect(block[4 + 9]).toBeCloseTo(-1, 4);  // dirY
    expect(block[4 + 10]).toBeCloseTo(0, 4);  // dirZ
  });

  it('encodes custom direction', () => {
    const d = new DirectionalLight();
    d.direction.set(1, 0, 0);
    const block = buildLightUniformBlock([d]);
    expect(block[4 + 8]).toBeCloseTo(1, 4);
    expect(block[4 + 9]).toBeCloseTo(0, 4);
  });
});

describe('buildLightUniformBlock — PointLight', () => {
  it('encodes type as LIGHT_TYPE.POINT (2)', () => {
    const block = buildLightUniformBlock([new PointLight()]);
    expect(block[4]).toBe(LIGHT_TYPE.POINT);
  });

  it('encodes position', () => {
    const p = new PointLight();
    p.position.set(1, 2, 3);
    const block = buildLightUniformBlock([p]);
    expect(block[4 + 5]).toBeCloseTo(1, 4);
    expect(block[4 + 6]).toBeCloseTo(2, 4);
    expect(block[4 + 7]).toBeCloseTo(3, 4);
  });

  it('encodes distance and decay', () => {
    const p = new PointLight(0xffffff, 1, 50, 1.5);
    const block = buildLightUniformBlock([p]);
    expect(block[4 + 11]).toBeCloseTo(50,  4);  // distance
    expect(block[4 + 12]).toBeCloseTo(1.5, 4);  // decay
  });
});

describe('buildLightUniformBlock — multiple lights', () => {
  it('encodes two lights with correct offsets', () => {
    const a = new AmbientLight(0xffffff, 0.3);
    const d = new DirectionalLight(0x0000ff, 1.0);
    const block = buildLightUniformBlock([a, d]);

    expect(block[0]).toBe(2);                     // count
    expect(block[4]).toBe(LIGHT_TYPE.AMBIENT);     // first light type
    expect(block[4 + 16]).toBe(LIGHT_TYPE.DIRECTIONAL); // second light type
    // Blue colour on second light
    expect(block[4 + 16 + 3]).toBeCloseTo(1.0, 4);
  });
});

// ===========================================================================
// Geometry — uploadToGPU
// ===========================================================================

describe('Geometry — uploadToGPU', () => {
  it('uploads positions as a VERTEX buffer', () => {
    const device = makeMockDevice();
    const g = Geometry.screenQuad();
    g.uploadToGPU(device, { WebGPUBuffer, BufferType });
    expect(g._gpuBuffers.positions).toBeDefined();
    expect(device._buffers.length).toBeGreaterThanOrEqual(1);
  });

  it('uploads indices as an INDEX buffer', () => {
    const device = makeMockDevice();
    const g = Geometry.screenQuad();
    g.uploadToGPU(device, { WebGPUBuffer, BufferType });
    expect(g._gpuBuffers.indices).toBeDefined();
  });

  it('uploads UVs when present', () => {
    const device = makeMockDevice();
    const g = Geometry.screenQuad();
    g.uploadToGPU(device, { WebGPUBuffer, BufferType });
    expect(g._gpuBuffers.uvs).toBeDefined();
  });

  it('skips normals when not present', () => {
    const device = makeMockDevice();
    const g = Geometry.screenQuad(); // screenQuad has no normals
    g.uploadToGPU(device, { WebGPUBuffer, BufferType });
    expect(g._gpuBuffers.normals).toBeUndefined();
  });

  it('uploads normals when present', () => {
    const device = makeMockDevice();
    const g = new Geometry();
    g.positions = new Float32Array([0, 0, 0, 1, 0, 0]);
    g.normals   = new Float32Array([0, 1, 0, 0, 1, 0]);
    g.uploadToGPU(device, { WebGPUBuffer, BufferType });
    expect(g._gpuBuffers.normals).toBeDefined();
    expect(g._gpuBuffers.positions).toBeDefined();
  });

  it('returns this for chaining', () => {
    const device = makeMockDevice();
    const g = Geometry.screenQuad();
    expect(g.uploadToGPU(device, { WebGPUBuffer, BufferType })).toBe(g);
  });

  it('box geometry uploads positions and indices', () => {
    const device = makeMockDevice();
    const g = Geometry.box(2, 2, 2);
    g.uploadToGPU(device, { WebGPUBuffer, BufferType });
    expect(g._gpuBuffers.positions).toBeDefined();
    expect(g._gpuBuffers.indices).toBeDefined();
  });
});
