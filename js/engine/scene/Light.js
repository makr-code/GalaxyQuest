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

class LightFallbackVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = Number(x || 0);
    this.y = Number(y || 0);
    this.z = Number(z || 0);
  }
}

const { Vector3 } = typeof require !== 'undefined'
  ? require('../math/Vector3.js')
  : { Vector3: window.GQVector3 || LightFallbackVector3 };

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

// ---------------------------------------------------------------------------
// GPU uniform packing
// ---------------------------------------------------------------------------

/** Light type identifiers used in the GPU uniform block. */
const LIGHT_TYPE = Object.freeze({ AMBIENT: 0, DIRECTIONAL: 1, POINT: 2 });

/**
 * Pack up to `maxLights` lights into a Float32Array suitable for a GPU
 * uniform buffer.
 *
 * Buffer layout (std140-compatible):
 *   [0..3]  header: count (f32), pad, pad, pad
 *   Per light (16 floats = 4 × vec4f):
 *     [off+ 0] type      — 0=ambient, 1=directional, 2=point
 *     [off+ 1] colorR
 *     [off+ 2] colorG
 *     [off+ 3] colorB
 *     [off+ 4] intensity
 *     [off+ 5] posX      (PointLight) or 0
 *     [off+ 6] posY
 *     [off+ 7] posZ
 *     [off+ 8] dirX      (DirectionalLight) or 0
 *     [off+ 9] dirY
 *     [off+10] dirZ
 *     [off+11] distance  (PointLight) or 0
 *     [off+12] decay     (PointLight) or 0
 *     [off+13] castShadow  — 1.0 if true
 *     [off+14] visible     — 1.0 if true
 *     [off+15] _pad
 *
 * @param {Light[]} lights
 * @param {number}  [maxLights=8]
 * @returns {Float32Array}
 */
function buildLightUniformBlock(lights, maxLights = 8) {
  const stride = 16;
  const buf    = new Float32Array(4 + maxLights * stride);
  const clipped = lights.slice(0, maxLights);

  buf[0] = clipped.length; // count (remaining 3 floats are padding)

  for (let i = 0; i < clipped.length; i++) {
    const l   = clipped[i];
    const off = 4 + i * stride;

    const typeId = l.type === 'ambient'     ? LIGHT_TYPE.AMBIENT
                 : l.type === 'directional' ? LIGHT_TYPE.DIRECTIONAL
                 :                            LIGHT_TYPE.POINT;

    buf[off]     = typeId;
    buf[off + 1] = l.color.x;
    buf[off + 2] = l.color.y;
    buf[off + 3] = l.color.z;
    buf[off + 4] = l.intensity;
    buf[off + 5] = l.position?.x  ?? 0;
    buf[off + 6] = l.position?.y  ?? 0;
    buf[off + 7] = l.position?.z  ?? 0;
    buf[off + 8] = l.direction?.x ?? 0;
    buf[off + 9] = l.direction?.y ?? (typeId === LIGHT_TYPE.DIRECTIONAL ? -1 : 0);
    buf[off + 10] = l.direction?.z ?? 0;
    buf[off + 11] = l.distance     ?? 0;
    buf[off + 12] = l.decay        ?? 0;
    buf[off + 13] = l.castShadow   ? 1 : 0;
    buf[off + 14] = l.visible      ? 1 : 0;
    // buf[off + 15] = 0 (pad, already zeroed)
  }

  return buf;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Light, AmbientLight, DirectionalLight, PointLight, buildLightUniformBlock, LIGHT_TYPE };
} else {
  window.GQLight = { Light, AmbientLight, DirectionalLight, PointLight, buildLightUniformBlock, LIGHT_TYPE };
}
