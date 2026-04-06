/*
 * GQMaterialFactory
 * Konsistente Materialerstellung fuer PBR-Profile und Emissive/Bloom-Look.
 */
(function () {
  'use strict';

  class GQMaterialFactory {
    constructor(opts = {}) {
      this.THREE = opts.three || window.THREE;
      this.profiles = Object.assign({
        planetFallback: { roughness: 0.82, metalness: 0.04, emissiveIntensity: 0.0 },
        fleetHull: { roughness: 0.36, metalness: 0.48, emissiveIntensity: 0.18 },
        stationBody: { roughness: 0.55, metalness: 0.50, emissiveIntensity: 0.28 },
        stationPanel: { roughness: 0.30, metalness: 0.65, emissiveIntensity: 0.35 },
        glowHot: { roughness: 0.10, metalness: 0.85, emissiveIntensity: 1.40 },
      }, opts.profiles || {});
    }

    createPlanetFallbackMaterial(colorHex) {
      return new this.THREE.MeshStandardMaterial({
        color: colorHex,
        roughness: this.profiles.planetFallback.roughness,
        metalness: this.profiles.planetFallback.metalness,
        emissiveIntensity: this.profiles.planetFallback.emissiveIntensity,
      });
    }

    createFleetHullMaterial(color, hullTexOrBundle) {
      const bundle = hullTexOrBundle && typeof hullTexOrBundle === 'object' && ('map' in hullTexOrBundle || 'bumpMap' in hullTexOrBundle || 'emissiveMap' in hullTexOrBundle)
        ? hullTexOrBundle
        : null;
      const hullTex = bundle?.map || hullTexOrBundle || null;
      const material = new this.THREE.MeshStandardMaterial({
        color,
        map: hullTex,
        bumpMap: bundle?.bumpMap || null,
        bumpScale: bundle?.bumpMap ? 0.06 : 0,
        emissive: color,
        emissiveMap: bundle?.emissiveMap || hullTex,
        emissiveIntensity: this.profiles.fleetHull.emissiveIntensity,
        roughness: this.profiles.fleetHull.roughness,
        metalness: this.profiles.fleetHull.metalness,
      });
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    createStationBodyMaterial(color, textureBundle = null) {
      return new this.THREE.MeshStandardMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.045 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || null,
        emissiveIntensity: this.profiles.stationBody.emissiveIntensity,
        roughness: this.profiles.stationBody.roughness,
        metalness: this.profiles.stationBody.metalness,
      });
    }

    createStationPanelMaterial(color, opacity = 0.88, textureBundle = null) {
      let panelOpacity = opacity;
      let bundle = textureBundle;
      if (opacity && typeof opacity === 'object') {
        bundle = opacity;
        panelOpacity = 0.88;
      }
      return new this.THREE.MeshStandardMaterial({
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
      });
    }

    createHotGlowMaterial(color, emissiveColor = color, textureBundle = null) {
      let emissive = emissiveColor;
      let bundle = textureBundle;
      if (emissiveColor && typeof emissiveColor === 'object' && ('map' in emissiveColor || 'bumpMap' in emissiveColor || 'emissiveMap' in emissiveColor)) {
        bundle = emissiveColor;
        emissive = color;
      }
      return new this.THREE.MeshStandardMaterial({
        color: bundle?.map ? 0xffffff : color,
        map: bundle?.map || null,
        bumpMap: bundle?.bumpMap || null,
        bumpScale: bundle?.bumpMap ? 0.02 : 0,
        emissive,
        emissiveMap: bundle?.emissiveMap || null,
        emissiveIntensity: this.profiles.glowHot.emissiveIntensity,
        roughness: this.profiles.glowHot.roughness,
        metalness: this.profiles.glowHot.metalness,
      });
    }

    createStarMaterial(color, textureBundle = null) {
      const material = new this.THREE.MeshStandardMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.02 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || textureBundle?.map || null,
        emissiveIntensity: 0.85,
        roughness: 0.4,
        metalness: 0.02,
      });
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    createMoonMaterial(color, textureBundle = null) {
      const material = new this.THREE.MeshStandardMaterial({
        color: textureBundle?.map ? 0xffffff : color,
        map: textureBundle?.map || null,
        bumpMap: textureBundle?.bumpMap || null,
        bumpScale: textureBundle?.bumpMap ? 0.06 : 0,
        emissive: color,
        emissiveMap: textureBundle?.emissiveMap || null,
        emissiveIntensity: textureBundle?.emissiveMap ? 0.2 : 0,
        roughness: 0.88,
        metalness: 0.03,
      });
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    dispose() {
      // Stateless factory, no pooled resources yet.
    }
  }

  window.GQMaterialFactory = GQMaterialFactory;
})();
