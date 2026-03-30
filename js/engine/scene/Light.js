/**
 * Light.js
 *
 * Point, Directional and Ambient light descriptors.
 * Values are uploaded to a uniform buffer each frame.
 *
 * Inspired by Three.js Light hierarchy (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { Vector3 } = typeof require !== 'undefined'
  ? require('../math/Vector3.js')
  : { Vector3: window.GQVector3 };

class Light {
  constructor(type) {
    this.type      = type;
    this.color     = new Vector3(1, 1, 1);
    this.intensity = 1.0;
    this.visible   = true;
  }
}

class AmbientLight extends Light {
  constructor(colorHex = 0x404040, intensity = 0.5) {
    super('ambient');
    _hexToV3(colorHex, this.color);
    this.intensity = intensity;
  }
}

class DirectionalLight extends Light {
  constructor(colorHex = 0xffffff, intensity = 1.0) {
    super('directional');
    _hexToV3(colorHex, this.color);
    this.intensity  = intensity;
    this.direction  = new Vector3(0, -1, 0);
    this.castShadow = false;
  }
}

class PointLight extends Light {
  constructor(colorHex = 0xffffff, intensity = 1.0, distance = 0, decay = 2) {
    super('point');
    _hexToV3(colorHex, this.color);
    this.intensity = intensity;
    this.position  = new Vector3(0, 0, 0);
    this.distance  = distance;
    this.decay     = decay;
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _hexToV3(hex, v3) {
  v3.x = ((hex >> 16) & 0xff) / 255;
  v3.y = ((hex >>  8) & 0xff) / 255;
  v3.z = ( hex        & 0xff) / 255;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Light, AmbientLight, DirectionalLight, PointLight };
} else {
  window.GQLight = { Light, AmbientLight, DirectionalLight, PointLight };
}
