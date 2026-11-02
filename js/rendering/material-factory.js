/*
 * GQMaterialFactory
 * Konsistente Materialerstellung fuer PBR-Profile und Emissive/Bloom-Look.
 */
(function () {
  'use strict';

  class GQMaterialFactory {
    constructor(opts = {}) {
      this.THREE = opts.three || window.THREE;
      this.envMapIntensity = Number.isFinite(opts.envMapIntensity) && opts.envMapIntensity >= 0
        ? opts.envMapIntensity : null;
      this._textureRoles = new WeakMap();
      this._ownedTextures = new Map();
      this.profiles = Object.assign({
        planetFallback: { roughness: 0.82, metalness: 0.04, emissiveIntensity: 0.0 },
        fleetHull: { roughness: 0.36, metalness: 0.48, emissiveIntensity: 0.18 },
        stationBody: { roughness: 0.55, metalness: 0.50, emissiveIntensity: 0.28 },
        stationPanel: { roughness: 0.30, metalness: 0.65, emissiveIntensity: 0.35 },
        glowHot: { roughness: 0.10, metalness: 0.85, emissiveIntensity: 1.40 },
      }, opts.profiles || {});
    }

    createPlanetFallbackMaterial(colorHex) {
      return this._createMaterial({
        color: colorHex,
        roughness: this.profiles.planetFallback.roughness,
        metalness: this.profiles.planetFallback.metalness,
        emissiveIntensity: this.profiles.planetFallback.emissiveIntensity,
      });
    }

    createFleetHullMaterial(color, hullTexOrBundle) {
      const bundle = this._isTextureBundle(hullTexOrBundle)
        ? hullTexOrBundle
        : null;
      const hullTex = bundle ? bundle.map || null : hullTexOrBundle || null;
      const material = this._createMaterial({
        color,
        map: hullTex,
        bumpMap: bundle?.bumpMap || null,
        bumpScale: bundle?.bumpMap ? 0.06 : 0,
        emissive: color,
        emissiveMap: bundle?.emissiveMap || hullTex,
        emissiveIntensity: this.profiles.fleetHull.emissiveIntensity,
        roughness: this.profiles.fleetHull.roughness,
        metalness: this.profiles.fleetHull.metalness,
      }, bundle);
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    createStationBodyMaterial(color, textureBundle = null) {
      return this._createMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.045 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || null,
        emissiveIntensity: this.profiles.stationBody.emissiveIntensity,
        roughness: this.profiles.stationBody.roughness,
        metalness: this.profiles.stationBody.metalness,
      }, textureBundle);
    }

    createStationPanelMaterial(color, opacity = 0.88, textureBundle = null) {
      let panelOpacity = opacity;
      let bundle = textureBundle;
      if (opacity && typeof opacity === 'object') {
        bundle = opacity;
        panelOpacity = 0.88;
      }
      return this._createMaterial({
        color: bundle?.map ? 0xffffff : color,
        map: bundle?.map || null,
        bumpMap: bundle?.bumpMap || null,
        bumpScale: bundle?.bumpMap ? 0.03 : 0,
        emissive: color,
        emissiveMap: bundle?.emissiveMap || null,
        emissiveIntensity: this.profiles.stationPanel.emissiveIntensity,
        roughness: this.profiles.stationPanel.roughness,
        metalness: this.profiles.stationPanel.metalness,
        transparent: true,
        opacity: panelOpacity,
      }, bundle);
    }

    createHotGlowMaterial(color, emissiveColor = color, textureBundle = null) {
      let emissive = emissiveColor;
      let bundle = textureBundle;
      if (this._isTextureBundle(emissiveColor)) {
        bundle = emissiveColor;
        emissive = color;
      }
      return this._createMaterial({
        color: bundle?.map ? 0xffffff : color,
        map: bundle?.map || null,
        bumpMap: bundle?.bumpMap || null,
        bumpScale: bundle?.bumpMap ? 0.02 : 0,
        emissive,
        emissiveMap: bundle?.emissiveMap || null,
        emissiveIntensity: this.profiles.glowHot.emissiveIntensity,
        roughness: this.profiles.glowHot.roughness,
        metalness: this.profiles.glowHot.metalness,
      }, bundle);
    }

    createStarMaterial(color, textureBundle = null) {
      const material = this._createMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.02 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || textureBundle?.map || null,
        emissiveIntensity: 0.85,
        roughness: 0.4,
        metalness: 0.02,
      }, textureBundle);
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    /**
     * Create an animated sun material with bloom-friendly emissive properties.
     * Optimized for UnrealBloomPass post-processing.
     *
     * @param {number|THREE.Color} color - Star/sun color
     * @param {object} [textureBundle] - Optional texture bundle
     * @returns {THREE.MeshStandardMaterial}
     */
    createAnimatedSunMaterial(color, textureBundle = null) {
      const material = this._createMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.02 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || textureBundle?.map || null,
        emissiveIntensity: 1.2,  // Higher base for animated pulsation
        roughness: 0.4,
        metalness: 0.02,
        toneMapped: true,
      }, textureBundle);
      material.userData = Object.assign({}, material.userData, { 
        sharedTexture: true,
        animatedSun: true,  // Flag for SunAnimator
      });
      return material;
    }

    createMoonMaterial(color, textureBundle = null) {
      const material = this._createMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.06 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || null,
        emissiveIntensity: textureBundle?.emissiveMap ? 0.2 : 0,
        roughness: 0.88,
        metalness: 0.03,
      }, textureBundle);
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    _isTextureBundle(value) {
      return value && typeof value === 'object'
        && ['map', 'emissiveMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']
          .some((slot) => slot in value);
    }

    _createMaterial(parameters, bundle = null) {
      const dataMaps = ['bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap'];
      const ownedTextures = new Set();
      for (const slot of dataMaps) {
        if (bundle?.[slot]) parameters[slot] = bundle[slot];
      }
      for (const slot of ['map', 'emissiveMap', ...dataMaps]) {
        const texture = parameters[slot];
        if (!texture) continue;
        const colorSpace = slot === 'map' || slot === 'emissiveMap'
          ? this.THREE.SRGBColorSpace : this.THREE.NoColorSpace;
        if (colorSpace === undefined) continue;
        let roles = this._textureRoles.get(texture);
        if (!roles) {
          roles = new Map();
          this._textureRoles.set(texture, roles);
        }
        if (!roles.has(colorSpace)) {
          // Inputs are borrowed and may still be used by another factory or renderer.
          const typedTexture = texture.colorSpace === colorSpace ? texture : texture.clone();
          if (typedTexture !== texture) {
            this._ownedTextures.set(typedTexture, {
              texture: typedTexture, source: texture, colorSpace, roles, references: 0,
            });
          }
          if (typedTexture.colorSpace !== colorSpace) {
            typedTexture.colorSpace = colorSpace;
            typedTexture.needsUpdate = true;
          }
          roles.set(colorSpace, typedTexture);
        }
        parameters[slot] = roles.get(colorSpace);
        const owned = this._ownedTextures.get(parameters[slot]);
        if (owned) ownedTextures.add(owned);
      }
      if (this.envMapIntensity !== null) parameters.envMapIntensity = this.envMapIntensity;
      const material = new this.THREE.MeshStandardMaterial(parameters);
      if (['map', 'emissiveMap', ...dataMaps].some((slot) => parameters[slot])) {
        material.userData.sharedTexture = true;
      }
      if (ownedTextures.size) {
        for (const owned of ownedTextures) owned.references += 1;
        const release = () => {
          material.removeEventListener('dispose', release);
          for (const owned of ownedTextures) {
            if (this._ownedTextures.get(owned.texture) !== owned) continue;
            owned.references -= 1;
            if (owned.references === 0) this._disposeOwnedTexture(owned);
          }
          ownedTextures.clear();
        };
        material.addEventListener('dispose', release);
      }
      return material;
    }

    _disposeOwnedTexture(owned) {
      this._ownedTextures.delete(owned.texture);
      if (owned.roles.get(owned.colorSpace) === owned.texture) owned.roles.delete(owned.colorSpace);
      if (!owned.roles.size) this._textureRoles.delete(owned.source);
      owned.texture.dispose();
    }

    dispose() {
      for (const owned of this._ownedTextures.values()) this._disposeOwnedTexture(owned);
      this._textureRoles = new WeakMap();
    }
  }

  window.GQMaterialFactory = GQMaterialFactory;
})();
