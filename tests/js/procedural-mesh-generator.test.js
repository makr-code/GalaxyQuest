import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { webcrypto } from 'node:crypto';
import { AssetBinaryCache } from '../../js/engine/assets/AssetBinaryCache.js';
import '../../js/engine/procedural/ProceduralMeshGenerator.js';

const { ProceduralMeshGenerator } = window.GQProceduralMeshGenerator;
const positions = (geometry) => Array.from(geometry.getAttribute('position').array);

describe('deterministic procedural geometry', () => {
  let generator;
  beforeEach(() => {
    vi.stubGlobal('THREE', THREE);
    generator = new ProceduralMeshGenerator();
    // Three.js UUID allocation uses Math.random; geometry and transforms must not.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
  });
  afterEach(() => {
    generator.dispose();
    vi.unstubAllGlobals();
  });

  it.each([0, 0.125, 'asteroid-42'])('reproduces asteroid and wreck geometry across fresh instances for seed %s', (seed) => {
    const other = new ProceduralMeshGenerator();
    for (const method of ['generateAsteroid', 'generateWreck']) {
      const a = generator[method]({ seed });
      Math.random.mockReturnValue(0.9);
      const b = other[method]({ seed });
      expect(positions(a)).toEqual(positions(b));
      expect(positions(a).every(Number.isFinite)).toBe(true);
      expect(Array.from(a.attributes.normal.array).every(Number.isFinite)).toBe(true);
      expect(a.boundingSphere.radius).toBeGreaterThan(0);
      a.dispose();
      b.dispose();
    }
    other.dispose();
  });

  it('uses the seed for every debris transform and fragment choice, including seed zero', () => {
    const a = generator.generateDebrisField({ seed: 0, count: 4 });
    Math.random.mockReturnValue(0.9);
    const b = generator.generateDebrisField({ seed: 0, count: 4 });
    expect(a.map(({ geometry, ...transform }) => ({ positions: positions(geometry), ...transform })))
      .toEqual(b.map(({ geometry, ...transform }) => ({ positions: positions(geometry), ...transform })));
    const other = generator.generateDebrisField({ seed: 1, count: 1 });
    expect(a[0].position).not.toEqual(other[0].position);
    [...a, ...b, ...other].forEach(({ geometry }) => geometry.dispose());
  });

  it('keeps scale meaningful and complexity/prepared LODs bounded and monotonic', () => {
    const levels = generator.generateAsteroidLODs({ seed: 0, scale: 10 });
    expect(levels.map((level) => level.distance)).toEqual([0, 80, 240]);
    const counts = levels.map(({ geometry }) => geometry.attributes.position.count);
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[0]).toBeLessThan(2000);
    for (const { geometry } of levels) {
      expect(geometry.boundingSphere.radius).toBeLessThan(15);
      expect(geometry.boundingSphere.radius).toBeGreaterThan(5);
      geometry.dispose();
    }
    const invalid = generator.generateAsteroid({ scale: Infinity, complexity: -Infinity });
    expect(positions(invalid).every(Number.isFinite)).toBe(true);
    invalid.dispose();
  });

  it('returns owned clones and disposes only its own evicted LRU geometry', () => {
    generator.dispose();
    generator = new ProceduralMeshGenerator({ maxCacheSize: 2 });
    const a = generator.generateAsteroid({ seed: 1 });
    const aClone = generator.generateAsteroid({ seed: 1 });
    a.attributes.position.array[0] = 9999;
    expect(aClone.attributes.position.array[0]).not.toBe(9999);
    generator.generateAsteroid({ seed: 2 }).dispose();
    const owned = Array.from(generator._meshCache.values());
    const firstDispose = vi.spyOn(owned[0], 'dispose');
    const secondDispose = vi.spyOn(owned[1], 'dispose');
    const borrowedDispose = vi.spyOn(aClone, 'dispose');
    generator.generateAsteroid({ seed: 1 }).dispose();
    generator.generateAsteroid({ seed: 3 }).dispose();
    expect(firstDispose).not.toHaveBeenCalled();
    expect(secondDispose).toHaveBeenCalledOnce();
    generator.clearCache();
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(borrowedDispose).not.toHaveBeenCalled();
    expect(generator.getCacheStats().bytes).toBe(0);
    a.dispose();
    aClone.dispose();
  });

  it('does not retain geometry exceeding the CPU byte budget', () => {
    generator.dispose();
    generator = new ProceduralMeshGenerator({ maxCacheBytes: 1 });
    generator.generateAsteroid({ seed: 0 }).dispose();
    expect(generator.getCacheStats().meshCount).toBe(0);
  });

  it('restores persisted CPU arrays on demand into fresh owned geometry without regenerating', async () => {
    const cache = new AssetBinaryCache({ indexedDB: null, crypto: webcrypto });
    const config = { seed: 0, complexity: 5, scale: 12, lod: 1 };
    const first = await generator.generateAsteroidAsync(config, cache);
    const other = new ProceduralMeshGenerator();
    const generate = vi.spyOn(other, 'generateAsteroid');
    const restored = await other.generateAsteroidAsync(config, cache);
    expect(generate).not.toHaveBeenCalled();
    expect(positions(first)).toEqual(positions(restored));
    expect(Object.keys(restored.attributes).sort()).toEqual(Object.keys(first.attributes).sort());
    for (const [name, attribute] of Object.entries(first.attributes)) {
      expect(restored.attributes[name].itemSize).toBe(attribute.itemSize);
      expect(restored.attributes[name].normalized).toBe(attribute.normalized);
      expect(Array.from(restored.attributes[name].array)).toEqual(Array.from(attribute.array));
    }
    expect(restored.attributes.uv.itemSize).toBe(2);
    expect(restored.index).toBe(first.index);
    expect(first.attributes.position.array).not.toBe(restored.attributes.position.array);
    expect(restored.boundingSphere.radius).toBeGreaterThan(0);
    first.attributes.position.array[0] = 9999;
    expect(restored.attributes.position.array[0]).not.toBe(9999);
    await other.generateAsteroidAsync({ ...config, lod: 2 }, cache).then((geometry) => geometry.dispose());
    expect(generate).toHaveBeenCalledOnce();
    first.dispose();
    restored.dispose();
    other.dispose();
    cache.close();
  });

  it.each(['get', 'put', 'delete'])('returns fresh owned geometry when optional cache %s fails', async (method) => {
    const cache = {
      get: vi.fn(async () => null), put: vi.fn(async () => true), delete: vi.fn(async () => {}),
    };
    cache[method].mockRejectedValue(new Error('Optional cache unavailable'));
    if (method === 'delete') cache.get.mockResolvedValue(new ArrayBuffer(16));
    const generate = vi.spyOn(generator, 'generateAsteroid');
    const geometry = await generator.generateAsteroidAsync({ seed: 0 }, cache);
    expect(generate).toHaveBeenCalledOnce();
    expect(geometry).toBe(generate.mock.results[0].value);
    expect(geometry.attributes.uv.itemSize).toBe(2);
    expect(positions(geometry).every(Number.isFinite)).toBe(true);
    geometry.dispose();
  });

  it('returns ordinary generated geometry if the optional cache module fails to import', async () => {
    vi.doMock('../../js/engine/assets/AssetBinaryCache.js', () => { throw new Error('Module unavailable'); });
    try {
      const generate = vi.spyOn(generator, 'generateAsteroid');
      const geometry = await generator.generateAsteroidAsync({ seed: 0 });
      expect(geometry).toBe(generate.mock.results[0].value);
      expect(geometry.attributes.uv.itemSize).toBe(2);
      geometry.dispose();
    } finally { vi.doUnmock('../../js/engine/assets/AssetBinaryCache.js'); }
  });

  it('regenerates when persisted arrays fail structural validation despite a valid digest', async () => {
    const cache = new AssetBinaryCache({ indexedDB: null, crypto: webcrypto });
    await generator.generateAsteroidAsync({ seed: 0 }, cache).then((geometry) => geometry.dispose());
    const record = cache._memory.values().next().value;
    new DataView(record.bytes).setUint32(0, 0, true);
    record.digest = await cache._digest(record.bytes);
    const generate = vi.spyOn(generator, 'generateAsteroid');
    const geometry = await generator.generateAsteroidAsync({ seed: 0 }, cache);
    expect(generate).toHaveBeenCalledOnce();
    expect(positions(geometry).every(Number.isFinite)).toBe(true);
    geometry.dispose();
    cache.close();
  });
});
