import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Renderer from '../../js/rendering/SystemSpecialBodiesRenderer.js';
import '../../js/engine/procedural/ProceduralMeshGenerator.js';
import '../../js/rendering/texture-manager.js';
import '../../js/rendering/material-factory.js';

const groups = [];
const build = (params = {}, namespace = THREE) => {
  const group = Renderer.buildAsteroidBeltMesh(namespace, params);
  groups.push(group);
  return group;
};
const find = (group, kind) => {
  let result;
  group.traverse(object => { if (object.userData.kind === kind) result = object; });
  return result;
};
const snapshot = group => {
  const rocks = find(group, 'asteroid-belt-rocks');
  return {
    points: Array.from(find(group, 'asteroid-belt-particles').geometry.attributes.position.array),
    vertices: Array.from(rocks.geometry.attributes.position.array),
    transforms: Array.from(rocks.instanceMatrix.array),
  };
};

beforeEach(() => {
  vi.stubGlobal('THREE', THREE);
});

afterEach(() => {
  for (const group of groups.splice(0)) group.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
    if (object.isInstancedMesh) object.dispose();
  });
  vi.unstubAllGlobals();
});

describe('active asteroid living-world belt', () => {
  it('creates default PBR instances without replacing the renderer namespace or using persistent storage', () => {
    const group = build({ seed: 42 });
    const rocks = find(group, 'asteroid-belt-rocks');
    expect(rocks.isInstancedMesh).toBe(true);
    expect(rocks.count).toBe(96);
    expect(rocks.geometry.attributes.position.count).toBeLessThan(300);
    expect(rocks.material.isMeshStandardMaterial).toBe(true);
    expect(globalThis.THREE).toBe(THREE);
    expect(group.userData).toMatchObject({ kind: 'asteroid_belt', rotationSpeed: 0.018 });
    expect(snapshot(group).transforms.every(Number.isFinite)).toBe(true);
  });

  it.each([0, 'public-belt-42'])('replays seed %s after geometry cache deletion without using random appearance', seed => {
    const first = build({ seed, particleCount: 70 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const generator = new window.GQProceduralMeshGenerator.ProceduralMeshGenerator({ three: THREE });
    generator.generateAsteroid({ seed }).dispose();
    generator.clearCache();
    const second = build({ seed, particleCount: 70 });
    expect(snapshot(second)).toEqual(snapshot(first));
    const other = build({ seed: `${seed}-different`, particleCount: 70 });
    expect(snapshot(other).vertices).not.toEqual(snapshot(first).vertices);
    expect(snapshot(other).transforms).not.toEqual(snapshot(first).transforms);
    generator.dispose();
    random.mockRestore();
  });

  it.each([['low', 32], ['medium', 64], ['high', 128], [undefined, 96], ['__proto__', 96]])(
    'caps instance budget at quality %s', (quality, count) => {
      expect(find(build({ quality, rockCount: 1e9 }), 'asteroid-belt-rocks').count).toBe(count);
    }
  );

  it('keeps bounded transforms and whole point counts for nonfinite inputs', () => {
    const group = build({ seed: Infinity, radius: NaN, tube: Infinity, height: NaN,
      particleCount: 50.8, rockCount: Infinity, rockSize: NaN });
    expect(find(group, 'asteroid-belt-particles').geometry.attributes.position.count).toBe(50);
    const data = snapshot(group);
    expect([...data.points, ...data.vertices, ...data.transforms].every(Number.isFinite)).toBe(true);
    expect(find(group, 'asteroid-belt-rocks').count).toBeLessThanOrEqual(128);
  });

  it('automatically hides near rocks at distance but retains the original point fallback', () => {
    const group = build({ radius: 100 });
    const lod = find(group, 'asteroid-belt-lod');
    const rocks = find(group, 'asteroid-belt-rocks');
    const camera = new THREE.PerspectiveCamera();
    group.updateMatrixWorld(true);
    camera.position.set(0, 100, 0);
    camera.updateMatrixWorld();
    lod.update(camera);
    expect(rocks.visible).toBe(true);
    camera.position.set(0, 2000, 0);
    camera.updateMatrixWorld();
    lod.update(camera);
    expect(rocks.visible).toBe(false);
    expect(find(group, 'asteroid-belt-particles').visible).toBe(true);
  });

  it('retains the two cheap original children when instancing or the generator is unsupported', () => {
    expect(build({}, { ...THREE, InstancedMesh: undefined }).children).toHaveLength(2);
    const original = window.GQProceduralMeshGenerator;
    window.GQProceduralMeshGenerator = { ProceduralMeshGenerator: class {
      generateAsteroid() { throw new Error('Unsupported mock geometry'); }
      dispose() {}
    } };
    try { expect(build().children).toHaveLength(2); } finally { window.GQProceduralMeshGenerator = original; }
  });

  it('uses only public appearance fields and retains borrowed maps across manager eviction', () => {
    const manager = new window.GQTextureManager({ three: THREE, coherentMaxEntries: 1 });
    const factory = new window.GQMaterialFactory({ three: THREE });
    const request = vi.spyOn(manager, 'getCoherentMaterialBundle');
    const group = build({ seed: 9, color: 0x857663, textureManager: manager, materialFactory: factory,
      owner: 'private-player', fleet: { secret: true }, effects: { state: { damage: 1 } } });
    const rocks = find(group, 'asteroid-belt-rocks');
    expect(request).toHaveBeenCalledWith({
      seed: 9, color: 0x857663, materialFamily: 'rock', biome: 'barren',
      geometry: { kind: 'rock' }, quality: 'low',
    }, { size: 32 });
    expect(rocks.material.map).toBeTruthy();
    expect(rocks.material.normalMap).toBeTruthy();
    expect(rocks.material.roughnessMap).toBeTruthy();
    expect(rocks.material.userData.sharedTexture).toBe(true);
    const dispose = vi.spyOn(rocks.material.map, 'dispose');
    manager.getCoherentMaterialBundle({ seed: 10, materialFamily: 'rock' }, { size: 32 });
    manager.dispose();
    expect(dispose).not.toHaveBeenCalled();
    rocks.material.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    factory.dispose();
  });
});
