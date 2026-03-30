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

    createFleetHullMaterial(color, hullTex) {
      const material = new this.THREE.MeshStandardMaterial({
        color,
        map: hullTex,
        emissive: color,
        emissiveMap: hullTex,
        emissiveIntensity: this.profiles.fleetHull.emissiveIntensity,
        roughness: this.profiles.fleetHull.roughness,
        metalness: this.profiles.fleetHull.metalness,
      });
      material.userData = Object.assign({}, material.userData, { sharedTexture: true });
      return material;
    }

    createStationBodyMaterial(color) {
      return new this.THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: this.profiles.stationBody.emissiveIntensity,
        roughness: this.profiles.stationBody.roughness,
        metalness: this.profiles.stationBody.metalness,
      });
    }

    createStationPanelMaterial(color, opacity = 0.88) {
      return new this.THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: this.profiles.stationPanel.emissiveIntensity,
        roughness: this.profiles.stationPanel.roughness,
        metalness: this.profiles.stationPanel.metalness,
        transparent: true,
        opacity,
      });
    }

    createHotGlowMaterial(color, emissiveColor = color) {
      return new this.THREE.MeshStandardMaterial({
        color,
        emissive: emissiveColor,
        emissiveIntensity: this.profiles.glowHot.emissiveIntensity,
        roughness: this.profiles.glowHot.roughness,
        metalness: this.profiles.glowHot.metalness,
      });
    }

    dispose() {
      // Stateless factory, no pooled resources yet.
    }
  }

  window.GQMaterialFactory = GQMaterialFactory;
})();
