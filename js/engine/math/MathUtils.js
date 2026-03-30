/**
 * MathUtils.js
 *
 * Common math constants and scalar helpers.
 *
 * Inspired by Three.js MathUtils (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const MathUtils = Object.freeze({
  DEG2RAD: Math.PI / 180,
  RAD2DEG: 180 / Math.PI,
  TWO_PI:  Math.PI * 2,
  HALF_PI: Math.PI / 2,
  EPSILON: 1e-7,

  clamp:      (v, lo, hi)        => Math.max(lo, Math.min(hi, v)),
  lerp:       (a, b, t)          => a + (b - a) * t,
  smoothstep: (edge0, edge1, x)  => { const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); },
  degToRad:   (deg)              => deg * MathUtils.DEG2RAD,
  radToDeg:   (rad)              => rad * MathUtils.RAD2DEG,
  isPow2:     (n)                => (n & (n - 1)) === 0,
  nextPow2:   (n)                => { let p = 1; while (p < n) p <<= 1; return p; },

  /** Deterministic pseudo-random in [0,1) from a 32-bit seed. */
  seededRandom(seed) {
    let s = seed >>> 0;
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  },
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MathUtils };
} else {
  window.GQMathUtils = MathUtils;
}
