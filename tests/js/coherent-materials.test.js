import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AssetBinaryCache } from '../../js/engine/assets/AssetBinaryCache.js';

const require = createRequire(import.meta.url);
const Descriptor = require('../../js/engine/assets/WorldAssetDescriptor.js');
const Generator = require('../../js/engine/assets/CoherentMaterialGenerator.js');
const Manager = require('../../js/rendering/texture-manager.js');
const Factory = require('../../js/rendering/material-factory.js');

describe('deterministic public world asset contract', () => {
  it('is idempotent, frozen, versioned and excludes private arbitrary data', () => {
    const source = { seed: 0, faction: 'Terran', age: 0.6, materialFamily: 'painted-metal',
      password: 'private', inventory: { fuel: 900 }, id: 'database-secret',
      geometry: { kind: 'box', internal: 'secret' }, effects: { profile: 'industrial' } };
    const first = Descriptor.normalize(source);
    expect(Descriptor.normalize(first)).toEqual(first);
    expect(first.seed).toBe(0);
    expect(first.id).toMatch(/^wa1-[0-9a-f]{16}$/);
    expect(first.generatorVersion).toBe('coherent-pbr-1');
    expect(first.schemaVersion).toBe(1);
    expect(JSON.stringify(first)).not.toMatch(/secret|password|inventory|internal/);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.effects.variation)).toBe(true);
    expect(Descriptor.normalize({ ...source, seed: 1 }).id).not.toBe(first.id);
    expect(Descriptor.normalize({ ...source, biome: 'ice' }).id).not.toBe(first.id);
    expect(Descriptor.normalize({ ...source, age: 0.7 }).id).not.toBe(first.id);
  });

  it('bounds allocations, vectors, parameters and normalizes effect directions', () => {
    const descriptor = Descriptor.normalize({
      seed: Infinity, age: NaN, quality: 'unbounded', faction: 'a'.repeat(10000), color: [NaN, 10, -5],
      geometry: { scale: [Infinity, -10, 1e99] },
      lods: Array(1000).fill({ distance: Infinity, detail: -10 }),
      effects: { state: { activity: Infinity, damage: 2 },
        anchors: Array(1000).fill({ position: [1e99, -1e99, NaN], direction: [0, 0, 0], intensity: 1e99 }) },
    });
    expect(descriptor.faction).toHaveLength(48);
    expect(descriptor.lods).toHaveLength(4);
    expect(descriptor.effects.anchors).toHaveLength(16);
    expect(descriptor.effects.anchors[0]).toEqual({
      type: 'vent', position: [1000, -1000, 0], direction: [0, 1, 0], intensity: 4,
    });
    expect(descriptor.geometry.scale).toEqual([1, 0.001, 1000]);
    expect(descriptor.color).toEqual([0.35, 1, 0]);
    expect(JSON.stringify(descriptor)).not.toMatch(/null/);
    expect(Generator.resolveSize(descriptor, { size: Infinity })).toBe(64);
    expect(Generator.resolveSize(descriptor, { size: -10 })).toBe(8);
    expect(Generator.resolveSize(descriptor, { size: 1e99 })).toBe(256);
    expect(Descriptor.normalize(null)).toEqual(Descriptor.normalize());
  });

  it('preserves seed zero and deterministic strings, effects and quality choices', () => {
    const zero = Descriptor.random(0);
    const again = Descriptor.random(0);
    expect([zero(), zero(), zero()]).toEqual([again(), again(), again()]);
    expect(Descriptor.normalize({ seed: 'colony-a' })).toEqual(Descriptor.normalize({ seed: 'colony-a' }));
    expect(Descriptor.normalize({ seed: 0 }).effects.variation)
      .not.toEqual(Descriptor.normalize({ seed: 1 }).effects.variation);
    expect(Generator.resolveSize({ quality: 'low' })).toBe(32);
    expect(Generator.resolveSize({ quality: 'high' })).toBe(128);
  });
});

describe('coherent typed PBR synthesis', () => {
  it.each(['rock', 'painted-metal', 'glass', 'emissive'])('generates repeatable RGBA %s maps', materialFamily => {
    const input = { seed: 0, materialFamily, color: [0.6, 0.7, 0.9] };
    const first = Generator.generate(input, { size: 32 });
    const second = new Generator().generate(input, { size: 32 });
    expect(first).toEqual(second);
    expect(Object.keys(first.maps)).toEqual(['albedo', 'normal', 'roughness', 'metalness', 'emissive']);
    expect(first.maps.ao).toBeUndefined();
    expect(first.maps.bump).toBeUndefined();
    for (const [name, map] of Object.entries(first.maps)) {
      expect(map.data).toBeInstanceOf(Uint8Array);
      expect(map.data.length).toBe(32 * 32 * 4);
      expect(map.bytesPerRow).toBe(128);
      expect(map.format).toBe('rgba8unorm');
      expect(map.colorSpace).toBe(['albedo', 'emissive'].includes(name) ? 'srgb' : 'linear');
      for (let i = 3; i < map.data.length; i += 4) expect(map.data[i]).toBe(255);
    }
    expect(Generator.generate({ ...input, seed: 1 }, { size: 32 }).maps.albedo.data)
      .not.toEqual(first.maps.albedo.data);
  });

  it('derives wear pigment, roughness, conductivity from the same spatial mask', () => {
    const fresh = Generator.generate({ seed: 12, materialFamily: 'painted-metal', age: 0 }, { size: 32 });
    const aged = Generator.generate({ seed: 12, materialFamily: 'painted-metal', age: 1 }, { size: 32 });
    for (let i = 0; i < 32 * 32 * 4; i += 4) {
      expect(aged.maps.albedo.data[i]).toBeLessThanOrEqual(fresh.maps.albedo.data[i]);
      expect(aged.maps.roughness.data[i + 1]).toBeGreaterThanOrEqual(fresh.maps.roughness.data[i + 1]);
      expect(aged.maps.metalness.data[i + 2]).toBeGreaterThanOrEqual(fresh.maps.metalness.data[i + 2]);
    }
    const normal = aged.maps.normal.data;
    for (let i = 0; i < normal.length; i += 4) {
      const length = Math.hypot(...[normal[i], normal[i + 1], normal[i + 2]].map(n => n / 255 * 2 - 1));
      expect(length).toBeCloseTo(1, 2);
      expect(normal[i + 2]).toBeGreaterThan(127);
    }
  });

  it('uses dielectric transparent glass and gates emission by public effect state', () => {
    const glass = Generator.generate({ materialFamily: 'glass' }, { size: 16 });
    expect(glass.material).toMatchObject({ transparent: true, opacity: 0.35, depthWrite: false, metalness: 0 });
    expect(glass.maps.metalness.data.filter((_, i) => i % 4 !== 3).every(n => n === 0)).toBe(true);
    const on = Generator.generate({ materialFamily: 'emissive' }, { size: 16 });
    const off = Generator.generate({ materialFamily: 'emissive', effects: { state: { activity: 0 } } }, { size: 16 });
    expect(on.maps.emissive.data.some((n, i) => i % 4 !== 3 && n > 0)).toBe(true);
    expect(off.maps.emissive.data.filter((_, i) => i % 4 !== 3).every(n => n === 0)).toBe(true);
  });
});

describe('active Three coherent material route and ownership', () => {
  it('creates visible typed maps with correct color roles without double normal/bump or AO', () => {
    const manager = new Manager({ three: THREE });
    const bundle = manager.getCoherentMaterialBundle({ seed: 0, materialFamily: 'painted-metal' }, { size: 16 });
    const material = bundle.material;
    expect(material.map).toBe(bundle.textures.albedo);
    expect(material.normalMap).toBe(bundle.textures.normal);
    expect(material.roughnessMap).toBe(bundle.textures.roughness);
    expect(material.metalnessMap).toBe(bundle.textures.metalness);
    expect(material.emissiveMap).toBe(bundle.textures.emissive);
    expect(material.map.isDataTexture).toBe(true);
    expect(material.map.image.data).toBe(bundle.maps.albedo.data);
    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.emissiveMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.normalMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.metalnessMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.bumpMap).toBeNull();
    expect(material.aoMap).toBeNull();
    material.dispose();
    manager.dispose();
  });

  it('reuses generated pixels and textures but not caller-owned materials', () => {
    const manager = new Manager({ three: THREE });
    const generate = vi.spyOn(Generator, 'generate');
    const first = manager.getCoherentMaterialBundle({ seed: 0 }, { size: 16 });
    const second = manager.getCoherentMaterialBundle({ seed: 0 }, { size: 16 });
    expect(generate).toHaveBeenCalledOnce();
    expect(first.maps).toBe(second.maps);
    expect(first.material).not.toBe(second.material);
    expect(first.material.map).toBe(second.material.map);
    first.material.dispose();
    second.material.dispose();
    manager.dispose();
  });

  it('bounds cache count and defers evicted shared originals until all materials release', () => {
    const manager = new Manager({ three: THREE, coherentMaxEntries: 1 });
    const first = manager.getCoherentMaterialBundle({ seed: 0 }, { size: 8 });
    const alsoFirst = manager.getCoherentMaterialBundle({ seed: 0 }, { size: 8 });
    const dispose = vi.spyOn(first.material.map, 'dispose');
    const second = manager.getCoherentMaterialBundle({ seed: 1 }, { size: 8 });
    expect(manager.coherentTextureCache.size).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
    first.material.dispose();
    first.material.dispose();
    expect(dispose).not.toHaveBeenCalled();
    alsoFirst.material.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    const secondDispose = vi.spyOn(second.material.map, 'dispose');
    manager.dispose();
    manager.dispose();
    expect(secondDispose).not.toHaveBeenCalled();
    second.material.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(new Manager({ three: THREE, coherentMaxEntries: Infinity }).coherentMaxEntries).toBe(24);
    expect(new Manager({ three: THREE, coherentMaxEntries: 1e99 }).coherentMaxEntries).toBe(64);
  });

  it('uses coherent maps in getObjectMaterial and existing material profiles including glass', () => {
    const manager = new Manager({ three: THREE });
    const direct = manager.getObjectMaterial({ materialFamily: 'glass' });
    expect(direct.transparent).toBe(true);
    expect(direct.metalness).toBe(0);
    const bundle = manager.getCoherentMaterialBundle({ materialFamily: 'glass' }, { size: 8 });
    const factory = new Factory({ three: THREE });
    const material = factory.createStationBodyMaterial(0xff0000, bundle);
    expect(material.transparent).toBe(true);
    expect(material.metalness).toBe(0);
    expect(material.map).toBe(bundle.map);
    expect(material.color.getHex()).toBe(0xffffff);
    const withBump = factory.createMoonMaterial(0xffffff, { normalMap: bundle.normalMap, bumpMap: bundle.map });
    expect(withBump.normalMap).toBe(bundle.normalMap);
    expect(withBump.bumpMap).toBeNull();
    material.dispose();
    withBump.dispose();
    bundle.material.dispose();
    direct.dispose();
    factory.dispose();
    manager.dispose();
  });

  it('retains cached originals consumed through the existing role-aware material factory', () => {
    const manager = new Manager({ three: THREE, coherentMaxEntries: 1 });
    const factory = new Factory({ three: THREE });
    const bundle = manager.getCoherentMaterialBundle({ seed: 0 }, { size: 8 });
    const material = factory.createStationBodyMaterial(0xffffff, bundle);
    const dispose = vi.spyOn(bundle.map, 'dispose');
    bundle.material.dispose();
    const next = manager.getCoherentMaterialBundle({ seed: 1 }, { size: 8 });
    expect(dispose).not.toHaveBeenCalled();
    material.dispose();
    material.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    next.material.dispose();
    manager.dispose();
    factory.dispose();
  });
});

describe('persisted coherent public map bytes', () => {
  it('round-trips five typed maps through the binary cache without re-synthesis on a hit', async () => {
    const cache = new AssetBinaryCache({ indexedDB: null, crypto: webcrypto });
    const input = { seed: 0, materialFamily: 'painted-metal', privateInventory: { fuel: 900 } };
    const fallback = Generator.generate(input, { size: 16 });
    const load = vi.spyOn(cache, 'getOrLoad');
    const generate = vi.spyOn(Generator, 'generate');
    const first = await Generator.generateCached(input, { size: 16, cache, fallback });
    const second = await new Generator().generateCached(input, { size: 16, cache });
    expect(first).toEqual(fallback);
    expect(second).toEqual(fallback);
    expect(generate).not.toHaveBeenCalled();
    expect(first.maps.albedo.data).not.toBe(second.maps.albedo.data);
    const key = load.mock.calls[0][0];
    expect(key).toMatchObject({
      scope: 'public', version: 1, seed: 0, lod: 16,
      generatorHash: 'coherent-pbr-1', kind: 'coherent-pbr-rgba',
    });
    expect(JSON.stringify(key)).not.toMatch(/privateInventory|fuel/);
    expect((await cache.get(key)).byteLength).toBe(16 * 16 * 4 * 5);
    cache.close();
  });

  it('isolates seed, dimensions and material parameters in persistent identities', async () => {
    const cache = new AssetBinaryCache({ indexedDB: null, crypto: webcrypto });
    const input = { seed: 0, materialFamily: 'rock' };
    await Generator.generateCached(input, { size: 8, cache });
    await Generator.generateCached({ ...input, seed: 1 }, { size: 8, cache });
    await Generator.generateCached({ ...input, materialFamily: 'glass' }, { size: 8, cache });
    await Generator.generateCached(input, { size: 16, cache });
    expect(cache._memory.size).toBe(4);
    cache.close();
  });

  it('repairs invalid byte lengths and falls back safely when persistence fails', async () => {
    const descriptor = { seed: 8, materialFamily: 'glass' };
    const fallback = Generator.generate(descriptor, { size: 8 });
    const cache = {
      getOrLoad: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      delete: vi.fn(), put: vi.fn(),
    };
    expect(await Generator.generateCached(descriptor, { size: 8, cache, fallback })).toEqual(fallback);
    expect(cache.delete).toHaveBeenCalledOnce();
    expect(cache.put.mock.calls[0][1].byteLength).toBe(8 * 8 * 4 * 5);
    cache.getOrLoad.mockRejectedValue(new Error('quota unavailable'));
    expect(await Generator.generateCached(descriptor, { size: 8, cache, fallback })).toBe(fallback);
    expect(await Generator.generateCached(descriptor, { size: 8, cache: null, fallback })).toBe(fallback);
  });

  it('replaces active Three pixel buffers from persistence and ignores late results after disposal', async () => {
    const cache = new AssetBinaryCache({ indexedDB: null, crypto: webcrypto });
    const manager = new Manager({ three: THREE });
    const initial = manager.getCoherentMaterialBundle({ seed: 0 }, { size: 8 });
    const oldData = initial.material.map.image.data;
    const persisted = await manager.getCoherentMaterialBundleAsync({ seed: 0 }, { size: 8, cache });
    expect(persisted.material.map).toBe(initial.material.map);
    expect(initial.material.map.image.data).not.toBe(oldData);
    expect(initial.material.map.image.data).toEqual(oldData);
    expect(initial.material.map.image.data).toBe(persisted.maps.albedo.data);
    initial.material.dispose();
    persisted.material.dispose();
    let resolve;
    const paused = { getOrLoad: (_key, load) => new Promise(done => { resolve = () => done(load()); }) };
    const pending = manager.getCoherentMaterialBundleAsync({ seed: 1 }, { size: 8, cache: paused });
    manager.dispose();
    resolve();
    expect(await pending).toBeNull();
    expect(manager.coherentTextureCache.size).toBe(0);
    cache.close();
  });
});

describe('browser script and headless CommonJS module boundaries', () => {
  it('loads without window, DOM or Three and exports the same contract', () => {
    const sandbox = vm.createContext({ module: { exports: {} } });
    const descriptorCode = readFileSync(require.resolve('../../js/engine/assets/WorldAssetDescriptor.js'), 'utf8');
    vm.runInContext(descriptorCode, sandbox);
    expect(sandbox.module.exports.normalize({ seed: 0 }).id).toBe(Descriptor.normalize({ seed: 0 }).id);
    expect(sandbox.WorldAssetDescriptor).toBe(sandbox.module.exports);
  });

  it('works as browser scripts without CommonJS or any Three global', () => {
    const browser = vm.createContext({ window: {} });
    for (const file of ['engine/assets/WorldAssetDescriptor', 'engine/assets/CoherentMaterialGenerator',
      'rendering/material-factory', 'rendering/texture-manager']) {
      vm.runInContext(readFileSync(require.resolve(`../../js/${file}.js`), 'utf8'), browser);
    }
    const { WorldAssetDescriptor: Contract, CoherentMaterialGenerator: Engine, GQTextureManager } = browser.window;
    expect(Contract.normalize({ seed: 0 }).id).toBe(Descriptor.normalize({ seed: 0 }).id);
    expect(Engine.generate({ seed: 0 }, { size: 8 }).width).toBe(8);
    expect(new GQTextureManager().getCoherentMaterialBundle()).toBeNull();
  });

  it('resolves a descriptor dependency loaded after the generator browser script', () => {
    const browser = vm.createContext({ window: {} });
    vm.runInContext(readFileSync(require.resolve('../../js/engine/assets/CoherentMaterialGenerator.js'), 'utf8'), browser);
    expect(() => browser.window.CoherentMaterialGenerator.generate()).toThrow('WorldAssetDescriptor');
    vm.runInContext(readFileSync(require.resolve('../../js/engine/assets/WorldAssetDescriptor.js'), 'utf8'), browser);
    expect(browser.window.CoherentMaterialGenerator.generate({ seed: 0 }, { size: 8 }).width).toBe(8);
  });
});
