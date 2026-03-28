(function () {
  class GQPlanetTexturePipeline {
    constructor(opts = {}) {
      this.size = Math.max(128, Number(opts.size || 256));
      this.cache = new Map();
      this.cacheOrder = [];
      this.maxEntries = Math.max(24, Number(opts.maxEntries || 96));
    }

    _hexToRgb(hex, fallback = { r: 160, g: 176, b: 198 }) {
      const value = String(hex || '').trim().replace('#', '');
      if (!/^[0-9a-f]{6}$/i.test(value)) return fallback;
      const intValue = Number.parseInt(value, 16);
      return {
        r: (intValue >> 16) & 255,
        g: (intValue >> 8) & 255,
        b: intValue & 255,
      };
    }

    _mix(a, b, t) {
      const p = Math.max(0, Math.min(1, t));
      return {
        r: Math.round(a.r + (b.r - a.r) * p),
        g: Math.round(a.g + (b.g - a.g) * p),
        b: Math.round(a.b + (b.b - a.b) * p),
      };
    }

    _clampByte(value) {
      return Math.max(0, Math.min(255, Math.round(value)));
    }

    _rng(seed) {
      let state = (Number(seed) || 1) >>> 0;
      return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }

    _noise2(seed, x, y) {
      const sx = Math.sin((x * 12.9898) + (y * 78.233) + (seed * 0.00021)) * 43758.5453;
      return sx - Math.floor(sx);
    }

    _fbm(seed, u, v, octaves = 4) {
      let total = 0;
      let amp = 0.5;
      let freq = 1;
      let norm = 0;
      for (let i = 0; i < octaves; i += 1) {
        total += this._noise2(seed + i * 97, u * freq, v * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.07;
      }
      return norm > 0 ? total / norm : 0;
    }

    _descriptorKey(descriptor) {
      if (!descriptor || typeof descriptor !== 'object') return 'fallback';
      return JSON.stringify({
        v: descriptor.version || 1,
        seed: descriptor.seed || 0,
        variant: descriptor.variant || 'rocky',
        palette: descriptor.palette || null,
        roughness: descriptor.roughness || 0,
        metalness: descriptor.metalness || 0,
        banding: descriptor.banding || 0,
        clouds: descriptor.clouds || 0,
        craters: descriptor.craters || 0,
        iceCaps: descriptor.ice_caps || 0,
        glow: descriptor.glow || 0,
      });
    }

    _rememberCacheKey(key) {
      this.cacheOrder.push(key);
      while (this.cacheOrder.length > this.maxEntries) {
        const stale = this.cacheOrder.shift();
        const entry = stale ? this.cache.get(stale) : null;
        if (entry?.textures) {
          Object.values(entry.textures).forEach((texture) => texture?.dispose?.());
        }
        if (stale) this.cache.delete(stale);
      }
    }

    getPlanetMaterial(body, descriptor, fallbackColor = 0x9aa7b8) {
      const bundle = this.getTextureBundle(descriptor, fallbackColor);
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: bundle.map,
        bumpMap: bundle.bumpMap,
        bumpScale: Math.max(0.01, Math.min(0.18, Number(descriptor?.variant === 'gas' ? 0.025 : 0.085))),
        emissiveMap: bundle.emissiveMap,
        emissive: new THREE.Color(Number(descriptor?.variant === 'lava' ? 0xff7d4d : 0xbfd8ff)),
        emissiveIntensity: Math.max(0, Math.min(0.7, Number(descriptor?.variant === 'lava' ? 0.42 : 0.12) + Number(descriptor?.glow || 0) * 0.7)),
        roughness: Math.max(0.08, Math.min(0.98, Number(descriptor?.roughness ?? 0.82))),
        metalness: Math.max(0, Math.min(0.22, Number(descriptor?.metalness ?? 0.04))),
      });
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    getCloudLayerConfig(descriptor, fallbackColor = 0x9aa7b8) {
      if (!descriptor || typeof descriptor !== 'object') return null;
      const bundle = this.getTextureBundle(descriptor, fallbackColor);
      if (!bundle?.cloudAlphaMap) return null;
      const cloudiness = Math.max(0, Math.min(1, Number(descriptor.clouds || 0)));
      if (cloudiness <= 0.06) return null;
      const palette = descriptor.palette || {};
      return {
        alphaMap: bundle.cloudAlphaMap,
        color: palette.ice || palette.accent || '#f2f6fb',
        opacity: 0.12 + cloudiness * 0.30,
        scale: 1.012 + cloudiness * 0.028,
        rotationSpeed: 0.025 + cloudiness * 0.09,
      };
    }

    getTextureBundle(descriptor, fallbackColor = 0x9aa7b8) {
      const key = this._descriptorKey(descriptor);
      const cached = this.cache.get(key);
      if (cached?.textures) return cached.textures;

      const textures = this._buildTextureBundle(descriptor, fallbackColor);
      this.cache.set(key, { textures });
      this._rememberCacheKey(key);
      return textures;
    }

    getAtmosphereConfig(descriptor) {
      if (!descriptor || typeof descriptor !== 'object') return null;
      const strength = Math.max(0, Math.min(1, Number(descriptor.atmosphere || 0)));
      if (strength <= 0.06) return null;
      const palette = descriptor.palette || {};
      return {
        color: palette.accent || palette.ice || palette.base || '#9fc5ff',
        opacity: 0.08 + strength * 0.18,
        scale: 1.05 + strength * 0.06,
      };
    }

    _buildTextureBundle(descriptor, fallbackColor) {
      const size = this.size;
      const width = size;
      const height = Math.max(64, Math.floor(size / 2));
      const colorCanvas = document.createElement('canvas');
      colorCanvas.width = width;
      colorCanvas.height = height;
      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = width;
      bumpCanvas.height = height;
      const emissiveCanvas = document.createElement('canvas');
      emissiveCanvas.width = width;
      emissiveCanvas.height = height;
      const cloudCanvas = document.createElement('canvas');
      cloudCanvas.width = width;
      cloudCanvas.height = height;
      const ctx = colorCanvas.getContext('2d');
      const bumpCtx = bumpCanvas.getContext('2d');
      const emissiveCtx = emissiveCanvas.getContext('2d');
      const cloudCtx = cloudCanvas.getContext('2d');
      if (!ctx || !bumpCtx || !emissiveCtx || !cloudCtx) {
        const map = new THREE.CanvasTexture(colorCanvas);
        return { map, bumpMap: null, emissiveMap: null, cloudAlphaMap: null };
      }

      const image = ctx.createImageData(width, height);
      const bumpImage = bumpCtx.createImageData(width, height);
      const emissiveImage = emissiveCtx.createImageData(width, height);
      const cloudImage = cloudCtx.createImageData(width, height);
      const data = image.data;
      const bumpData = bumpImage.data;
      const emissiveData = emissiveImage.data;
      const cloudData = cloudImage.data;
      const seed = Number(descriptor?.seed || fallbackColor || 1) >>> 0;
      const variant = String(descriptor?.variant || 'rocky').toLowerCase();
      const palette = descriptor?.palette || {};
      const base = this._hexToRgb(palette.base, this._hexToRgb(fallbackColor.toString(16).padStart(6, '0')));
      const secondary = this._hexToRgb(palette.secondary, base);
      const accent = this._hexToRgb(palette.accent, secondary);
      const ice = this._hexToRgb(palette.ice, { r: 224, g: 236, b: 248 });
      const banding = Math.max(0, Math.min(1, Number(descriptor?.banding ?? 0.16)));
      const clouds = Math.max(0, Math.min(1, Number(descriptor?.clouds ?? 0.18)));
      const craters = Math.max(0, Math.min(1, Number(descriptor?.craters ?? 0.12)));
      const iceCaps = Math.max(0, Math.min(1, Number(descriptor?.ice_caps ?? 0.0)));
      const glow = Math.max(0, Math.min(1, Number(descriptor?.glow ?? 0.0)));
      const rand = this._rng(seed);
      const craterSeeds = [];
      const craterCount = Math.floor(craters * 18);
      for (let i = 0; i < craterCount; i += 1) {
        craterSeeds.push({ x: rand(), y: rand(), r: 0.025 + rand() * 0.09, d: 0.25 + rand() * 0.45 });
      }

      for (let y = 0; y < height; y += 1) {
        const v = y / Math.max(1, height - 1);
        const lat = (v - 0.5) * Math.PI;
        for (let x = 0; x < width; x += 1) {
          const u = x / Math.max(1, width - 1);
          const idx = (y * width + x) * 4;
          const n1 = this._fbm(seed, u * 3.4, v * 3.4, 4);
          const n2 = this._fbm(seed + 177, u * 8.3, v * 8.3, 3);
          const swirls = 0.5 + (Math.sin((u * Math.PI * 2 * (1.2 + banding * 5.2)) + (n1 * 3.4) + seed * 0.0002) * 0.5);
          let tone = n1 * 0.6 + n2 * 0.4;
          if (variant === 'gas') tone = tone * 0.35 + swirls * 0.65;
          else if (variant === 'ocean') tone = tone * 0.55 + (1 - Math.abs(lat) / (Math.PI / 2)) * 0.2;
          else if (variant === 'lava') tone = tone * 0.42 + Math.pow(n2, 1.7) * 0.58;

          let color = this._mix(base, secondary, tone);
          if (variant === 'gas') {
            const accentMix = Math.max(0, (swirls - 0.62) / 0.38) * (0.25 + banding * 0.5);
            color = this._mix(color, accent, accentMix);
          } else if (variant === 'lava') {
            const fissure = Math.max(0, (n2 - 0.72) / 0.28);
            color = this._mix(color, accent, fissure * (0.45 + glow * 0.35));
          } else {
            const ridge = Math.max(0, (n2 - 0.68) / 0.32);
            color = this._mix(color, accent, ridge * 0.32);
          }

          if (iceCaps > 0) {
            const polar = Math.max(0, (Math.abs(lat) - ((1 - iceCaps) * 1.08)) / 0.34);
            if (polar > 0) color = this._mix(color, ice, Math.min(1, polar));
          }

          if (craterSeeds.length && variant !== 'gas' && variant !== 'ocean') {
            let craterMask = 0;
            for (let i = 0; i < craterSeeds.length; i += 1) {
              const crater = craterSeeds[i];
              const dx = u - crater.x;
              const dy = v - crater.y;
              const dist = Math.sqrt(dx * dx + dy * dy) / crater.r;
              if (dist < 1) craterMask = Math.max(craterMask, (1 - dist) * crater.d);
            }
            if (craterMask > 0) {
              color = this._mix(color, { r: color.r * 0.56, g: color.g * 0.56, b: color.b * 0.56 }, craterMask);
            }
          }

          let cloudMask = 0;
          if (clouds > 0.02) {
            cloudMask = Math.max(0, (this._fbm(seed + 911, u * 5.1, v * 5.1, 4) - (0.62 - clouds * 0.22)) / 0.38);
            if (cloudMask > 0) color = this._mix(color, { r: 244, g: 246, b: 250 }, cloudMask * clouds * 0.88);
          }

          const relief = Math.max(0, Math.min(1, (n1 * 0.58) + (n2 * 0.42)));
          const bumpShade = this._clampByte(45 + relief * 210);
          const emissiveStrength = variant === 'lava'
            ? Math.max(0, (n2 - 0.68) / 0.32) * (0.45 + glow * 0.45)
            : (variant === 'ocean' || variant === 'rocky' || variant === 'desert')
              ? Math.max(0, (this._fbm(seed + 1401, u * 11.5, v * 11.5, 3) - 0.83) / 0.17) * glow * 0.45
              : 0;
          const emissiveShade = this._clampByte(emissiveStrength * 255);

          data[idx] = this._clampByte(color.r);
          data[idx + 1] = this._clampByte(color.g);
          data[idx + 2] = this._clampByte(color.b);
          data[idx + 3] = 255;
          bumpData[idx] = bumpShade;
          bumpData[idx + 1] = bumpShade;
          bumpData[idx + 2] = bumpShade;
          bumpData[idx + 3] = 255;
          emissiveData[idx] = emissiveShade;
          emissiveData[idx + 1] = emissiveShade;
          emissiveData[idx + 2] = emissiveShade;
          emissiveData[idx + 3] = 255;
          const cloudShade = this._clampByte(cloudMask * clouds * 255);
          cloudData[idx] = 255;
          cloudData[idx + 1] = 255;
          cloudData[idx + 2] = 255;
          cloudData[idx + 3] = cloudShade;
        }
      }

      ctx.putImageData(image, 0, 0);
      bumpCtx.putImageData(bumpImage, 0, 0);
      emissiveCtx.putImageData(emissiveImage, 0, 0);
      cloudCtx.putImageData(cloudImage, 0, 0);

      const map = new THREE.CanvasTexture(colorCanvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.ClampToEdgeWrapping;
      map.anisotropy = 4;
      map.needsUpdate = true;

      const bumpMap = new THREE.CanvasTexture(bumpCanvas);
      bumpMap.wrapS = THREE.RepeatWrapping;
      bumpMap.wrapT = THREE.ClampToEdgeWrapping;
      bumpMap.anisotropy = 2;
      bumpMap.needsUpdate = true;

      const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
      emissiveMap.wrapS = THREE.RepeatWrapping;
      emissiveMap.wrapT = THREE.ClampToEdgeWrapping;
      emissiveMap.anisotropy = 2;
      emissiveMap.needsUpdate = true;

      const cloudAlphaMap = new THREE.CanvasTexture(cloudCanvas);
      cloudAlphaMap.wrapS = THREE.RepeatWrapping;
      cloudAlphaMap.wrapT = THREE.RepeatWrapping;
      cloudAlphaMap.anisotropy = 2;
      cloudAlphaMap.needsUpdate = true;

      return { map, bumpMap, emissiveMap, cloudAlphaMap };
    }

    dispose() {
      for (const entry of this.cache.values()) {
        if (entry?.textures) {
          Object.values(entry.textures).forEach((texture) => texture?.dispose?.());
        }
      }
      this.cache.clear();
      this.cacheOrder = [];
    }
  }

  window.GQPlanetTexturePipeline = GQPlanetTexturePipeline;
})();