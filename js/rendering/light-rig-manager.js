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
      this.activeOptions = null;
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
          { type: 'point', color: 0xffe9c9, intensity: 2.35, position: [0, 0, 0], distance: 920, decay: 1.6, role: 'system-star' },
          { type: 'directional', color: 0x7bb4ff, intensity: 0.34, position: [-170, -65, -195] },
        ],
        cinematic: [
          { type: 'ambient', color: 0x96a8c9, intensity: 0.34 },
          { type: 'directional', color: 0xffdfb4, intensity: 1.54, position: [120, 170, 60] },
          { type: 'directional', color: 0x84beff, intensity: 0.44, position: [-115, -70, -140] },
        ],
      }, opts.profiles || {});
    }

    setProfile(profileName, sceneOverride = null, opts = null) {
      const scene = sceneOverride || this.scene;
      if (!scene) return null;

      const normalized = this._normalizeProfileName(profileName);
      const optionsSignature = this._optionsSignature(opts);
      if (this.activeProfile === normalized && this.activeLights.length && optionsSignature === this._optionsSignature(this.activeOptions)) {
        this.scene = scene;
        return this.activeProfile;
      }

      this._clearActiveRig();
      this.scene = scene;
      this.activeOptions = opts || null;

      const profileDefs = this._resolveProfileDefs(normalized, opts);
      this.activeLights = profileDefs
        .map((def) => this._createLight(def))
        .filter(Boolean);

      this.activeLights.forEach((light) => scene.add(light));
      this.activeProfile = normalized;
      return this.activeProfile;
    }

    getProfileDescriptors(profileName, opts = null) {
      const normalized = this._normalizeProfileName(profileName);
      return this._resolveProfileDefs(normalized, opts)
        .map((def) => Object.assign({}, def));
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
      if (type === 'point') {
        const light = new this.THREE.PointLight(
          def.color,
          Number(def.intensity || 0),
          Number(def.distance || 0),
          Number(def.decay || 2)
        );
        const pos = Array.isArray(def.position) ? def.position : [0, 0, 0];
        light.position.set(Number(pos[0] || 0), Number(pos[1] || 0), Number(pos[2] || 0));
        if (typeof def.castShadow === 'boolean') light.castShadow = def.castShadow;
        return light;
      }
      return new this.THREE.AmbientLight(def.color, Number(def.intensity || 0));
    }

    _resolveProfileDefs(profileName, opts = null) {
      const baseDefs = this.profiles[profileName] || this.profiles.galaxy || [];
      const defs = baseDefs.map((def) => Object.assign({}, def));
      if (profileName !== 'system') return defs;

      const starColor = Number(opts?.starColor || 0);
      const starIntensity = Number(opts?.starIntensity || 0);
      const starPosition = Array.isArray(opts?.starPosition) ? opts.starPosition : null;
      return defs.map((def) => {
        if (String(def.role || '') !== 'system-star') return def;
        const next = Object.assign({}, def);
        if (starColor > 0) next.color = starColor;
        if (starIntensity > 0) next.intensity = starIntensity;
        if (starPosition && starPosition.length >= 3) next.position = starPosition.slice(0, 3);
        return next;
      });
    }

    _optionsSignature(opts = null) {
      if (!opts || typeof opts !== 'object') return '';
      return JSON.stringify({
        starColor: Number(opts.starColor || 0),
        starIntensity: Number(opts.starIntensity || 0),
        starPosition: Array.isArray(opts.starPosition)
          ? opts.starPosition.slice(0, 3).map((value) => Number(Number(value || 0).toFixed(3)))
          : null,
      });
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
      this.activeOptions = null;
    }
  }

  window.GQLightRigManager = GQLightRigManager;
})();
