(function (root) {
  'use strict';

  const Descriptor = typeof module !== 'undefined' && module.exports
    ? require('./WorldAssetDescriptor.js') : root.WorldAssetDescriptor;
  const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
  const generatedSets = new WeakSet();
  const mapNames = ['albedo', 'normal', 'roughness', 'metalness', 'emissive'];
  let cacheModule;
  const materialProperties = descriptor => {
    const glass = descriptor.materialFamily === 'glass';
    return { roughness: 1, metalness: descriptor.materialFamily === 'painted-metal' ? 1 : 0,
      transparent: glass, opacity: glass ? 0.35 : 1, depthWrite: !glass,
      emissiveIntensity: CoherentMaterialGenerator.emissiveIntensity(descriptor) };
  };
  const resultFor = (descriptor, size, maps) => {
    const result = { descriptor, width: size, height: size, maps, material: materialProperties(descriptor) };
    generatedSets.add(result);
    return result;
  };

  class CoherentMaterialGenerator {
    static emissiveIntensity(descriptor) {
      const state = descriptor?.effects?.state;
      const activity = Number.isFinite(state?.activity) ? Math.max(0, Math.min(1, state.activity)) : 1;
      const damage = Number.isFinite(state?.damage) ? Math.max(0, Math.min(1, state.damage)) : 0;
      return (descriptor?.materialFamily === 'emissive' ? 1.5 : 0.45) * activity * (1 - damage);
    }

    static resolveSize(descriptor, options = {}) {
      const fallback = { low: 32, medium: 64, high: 128 }[descriptor.quality] || 64;
      return Number.isFinite(options?.size) ? Math.max(8, Math.min(256, Math.floor(options.size))) : fallback;
    }

    static generate(input = {}, options = {}) {
      const Contract = Descriptor || root.WorldAssetDescriptor;
      if (!Contract) throw new Error('WorldAssetDescriptor must be loaded before material generation');
      const descriptor = Contract.normalize(input);
      const size = this.resolveSize(descriptor, options);
      const count = size * size;
      const random = Contract.random(descriptor.seed);
      const phase = random() * Math.PI * 2;
      const height = new Float32Array(count);
      const wear = new Float32Array(count);
      const light = new Uint8Array(count);
      const maps = {};
      for (const [name, metadata] of Object.entries(descriptor.maps)) {
        maps[name] = { ...metadata, width: size, height: size, channels: 4, bytesPerRow: size * 4,
          data: new Uint8Array(count * 4) };
      }
      const family = descriptor.materialFamily;
      const metal = family === 'painted-metal';
      const glass = family === 'glass';
      const glowing = family === 'emissive';
      const cells = 4;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const u = x / size;
          const v = y / size;
          const seam = (u * cells % 1 < 0.065 || v * cells % 1 < 0.065) ? 1 : 0;
          const grain = random();
          const wave = (Math.sin(u * Math.PI * 4 + phase) * Math.cos(v * Math.PI * 6 + phase) + 1) * 0.5;
          wear[i] = Math.max(0, Math.min(1, descriptor.age * (grain * 0.65 + wave * 0.35)));
          light[i] = (glowing ? wave > 0.48 : (metal || glass) && seam && wave > 0.58) ? 1 : 0;
          height[i] = metal || glass
            ? 0.5 - seam * 0.22 + grain * 0.025 - wear[i] * 0.06
            : wave * 0.65 + grain * 0.15 - wear[i] * 0.12;
        }
      }
      const put = (name, i, r, g = r, b = r, a = 1) => {
        maps[name].data.set([byte(r), byte(g), byte(b), byte(a)], i * 4);
      };
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const h = height[i];
          const w = wear[i];
          const lit = light[i];
          const pigment = (metal ? 0.72 : glass ? 0.9 : 0.55) + h * 0.5 - w * 0.28;
          put('albedo', i, ...descriptor.color.map(c => c * pigment));
          // The same exposed substrate drives pigment loss, roughness and conductivity.
          put('roughness', i, glass ? 0.08 + w * 0.17 : metal ? 0.34 + w * 0.45 + (0.5 - h) * 0.2 : 0.72 + w * 0.25);
          put('metalness', i, metal ? 0.12 + w * 0.85 : 0);
          put('emissive', i, ...descriptor.color.map(c => lit * c));
          const left = height[y * size + (x + size - 1) % size];
          const right = height[y * size + (x + 1) % size];
          const down = height[((y + size - 1) % size) * size + x];
          const up = height[((y + 1) % size) * size + x];
          const nx = (left - right) * (glass ? 0.2 : 2);
          const ny = (down - up) * (glass ? 0.2 : 2);
          const length = Math.hypot(nx, ny, 1);
          put('normal', i, nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, 1 / length * 0.5 + 0.5);
        }
      }
      return resultFor(descriptor, size, maps);
    }

    /**
     * Persist only normalized public parameters and fixed-layout map bytes.
     * A synchronous generated fallback can be supplied to avoid a second synthesis.
     */
    static async generateCached(input = {}, options = {}) {
      const Contract = Descriptor || root.WorldAssetDescriptor;
      if (!Contract) throw new Error('WorldAssetDescriptor must be loaded before material generation');
      const descriptor = Contract.normalize(input);
      const size = this.resolveSize(descriptor, options);
      let generated = generatedSets.has(options?.fallback)
        && options.fallback.descriptor.id === descriptor.id && options.fallback.width === size
        ? resultFor(descriptor, size, options.fallback.maps) : null;
      const fallback = () => generated || (generated = this.generate(descriptor, { size }));
      const key = { scope: 'public', version: descriptor.schemaVersion, seed: descriptor.seed,
        parameters: Contract.publicParameters(descriptor), lod: size,
        generatorHash: descriptor.generatorVersion, kind: 'coherent-pbr-rgba' };
      const mapLength = size * size * 4;
      const pack = () => {
        const bytes = new Uint8Array(mapLength * mapNames.length);
        const result = fallback();
        mapNames.forEach((name, i) => bytes.set(result.maps[name].data, i * mapLength));
        return bytes.buffer;
      };
      try {
        let cache = options?.cache;
        if (cache === undefined) {
          cacheModule ||= import('./AssetBinaryCache.js');
          cache = (await cacheModule).publicAssetBinaryCache;
        }
        if (!cache?.getOrLoad) return fallback();
        let buffer = await cache.getOrLoad(key, pack);
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== mapLength * mapNames.length) {
          await cache.delete?.(key);
          buffer = pack();
          await cache.put?.(key, buffer);
        }
        const maps = {};
        mapNames.forEach((name, i) => {
          maps[name] = { ...descriptor.maps[name], width: size, height: size, channels: 4, bytesPerRow: size * 4,
            data: new Uint8Array(buffer.slice(i * mapLength, (i + 1) * mapLength)) };
        });
        return resultFor(descriptor, size, maps);
      } catch {
        return fallback();
      }
    }

    generate(input, options) {
      return CoherentMaterialGenerator.generate(input, options);
    }

    generateCached(input, options) {
      return CoherentMaterialGenerator.generateCached(input, options);
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = CoherentMaterialGenerator;
  if (root) root.CoherentMaterialGenerator = CoherentMaterialGenerator;
})(typeof window !== 'undefined' ? window : globalThis);
