/*
 * GQLightRigManager
 * Zentrale Verwaltung umschaltbarer Lichtprofile fuer Auth/Galaxy/System/Cinematic.
 */
(function () {
  'use strict';

  class GQLightRigManager {
    constructor(opts = {}) {
      this.THREE = opts.three || window.THREE;
      this.scene = opts.scene || null;
      this.activeProfile = null;
      this.activeLights = [];
      this.profiles = Object.assign({
        auth: [
          { type: 'ambient', color: 0x8ea8d8, intensity: 0.56 },
          { type: 'directional', color: 0xc4ddff, intensity: 0.84, position: [190, 250, 150] },
          { type: 'directional', color: 0x5f95de, intensity: 0.22, position: [-150, -80, -210] },
        ],
        galaxy: [
          { type: 'ambient', color: 0x9bb5ff, intensity: 0.62 },
          { type: 'directional', color: 0xdde8ff, intensity: 1.18, position: [240, 280, 190] },
          { type: 'directional', color: 0x6da6ff, intensity: 0.28, position: [-180, -90, -220] },
        ],
        system: [
          { type: 'ambient', color: 0xb7c8ff, intensity: 0.58 },
          { type: 'directional', color: 0xffe9c9, intensity: 1.36, position: [140, 220, 95] },
          { type: 'directional', color: 0x7bb4ff, intensity: 0.34, position: [-170, -65, -195] },
        ],
        cinematic: [
          { type: 'ambient', color: 0x96a8c9, intensity: 0.34 },
          { type: 'directional', color: 0xffdfb4, intensity: 1.54, position: [120, 170, 60] },
          { type: 'directional', color: 0x84beff, intensity: 0.44, position: [-115, -70, -140] },
        ],
      }, opts.profiles || {});
    }

    setProfile(profileName, sceneOverride = null) {
      const scene = sceneOverride || this.scene;
      if (!scene) return null;

      const normalized = this._normalizeProfileName(profileName);
      if (this.activeProfile === normalized && this.activeLights.length) {
        this.scene = scene;
        return this.activeProfile;
      }

      this._clearActiveRig();
      this.scene = scene;

      const profileDefs = this.profiles[normalized] || this.profiles.galaxy || [];
      this.activeLights = profileDefs
        .map((def) => this._createLight(def))
        .filter(Boolean);

      this.activeLights.forEach((light) => scene.add(light));
      this.activeProfile = normalized;
      return this.activeProfile;
    }

    _createLight(def) {
      if (!def || !this.THREE) return null;
      const type = String(def.type || 'ambient').toLowerCase();
      if (type === 'directional') {
        const light = new this.THREE.DirectionalLight(def.color, Number(def.intensity || 0));
        const pos = Array.isArray(def.position) ? def.position : [120, 160, 100];
        light.position.set(Number(pos[0] || 0), Number(pos[1] || 0), Number(pos[2] || 0));
        return light;
      }
      return new this.THREE.AmbientLight(def.color, Number(def.intensity || 0));
    }

    _normalizeProfileName(profileName) {
      const key = String(profileName || 'galaxy').toLowerCase();
      return this.profiles[key] ? key : 'galaxy';
    }

    _clearActiveRig() {
      if (!this.scene || !Array.isArray(this.activeLights) || !this.activeLights.length) {
        this.activeLights = [];
        return;
      }
      this.activeLights.forEach((light) => {
        if (light?.parent === this.scene) {
          this.scene.remove(light);
        }
      });
      this.activeLights = [];
    }

    getActiveProfile() {
      return String(this.activeProfile || 'galaxy');
    }

    dispose() {
      this._clearActiveRig();
      this.scene = null;
      this.activeProfile = null;
    }
  }

  window.GQLightRigManager = GQLightRigManager;
})();
