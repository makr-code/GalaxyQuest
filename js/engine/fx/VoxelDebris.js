/**
 * VoxelDebris.js — Voxel-debris chunk geometry pool (Phase FX-4).
 *
 * Provides a pool of small box-shaped geometry chunks that fly outward from a
 * `SHIP_DESTRUCTION` explosion.  Each chunk is a unit cube scaled and tinted
 * to look like hull fragments.  The simulation mirrors the `DebrisSimulator`
 * rigid-body integration (linear + angular velocity with drag) but tracks
 * additional per-chunk metadata needed for rendering (color, base geometry).
 *
 * Rendering contract:
 *   The renderer iterates `forEach()` to obtain live chunk state:
 *     { px, py, pz, rotX, rotY, rotZ, scale, cr, cg, cb, alpha, geometry }
 *   Each chunk's `geometry` is a shared `Geometry.box()` reference — the
 *   renderer only needs one box VAO/VBO and applies per-chunk transforms via
 *   instanced draw calls or individual matrix uploads.
 *
 * Integration with CombatFX:
 *   After calling `CombatFX.spawnExplosion(pos, ExplosionType.SHIP_DESTRUCTION)`,
 *   pass the explosion position + optional `opts` to
 *   `VoxelDebris.spawnExplosion(pos, opts)` to create the voxel chunk burst.
 *   The two systems run in parallel — the particle cloud provides the soft
 *   glow while VoxelDebris provides the hard geometry.
 *
 * Inspired by:
 *   FreeSpace 2   (Volition, 1999) — hull panel debris
 *   Homeworld     (Relic, 1999)    — zero-g rigid-body wreckage
 *   Minecraft     (Mojang)         — iconic voxel aesthetic
 *   Kerbal Space Program (Squad)   — part destruction chunks
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { Geometry } = typeof require !== 'undefined'
  ? require('../scene/Geometry.js')
  : { Geometry: window.GQGeometry.Geometry ?? window.GQGeometry };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum simultaneously live chunks. */
const DEFAULT_MAX_CHUNKS = 256;

/** Default chunks emitted per explosion. */
const DEFAULT_CHUNKS_PER_EXPLOSION = 24;

/** Hull-metal base colors (hex) for random tinting. */
const HULL_COLORS = [
  0x8899aa,  // steel blue-grey
  0x556677,  // dark gunmetal
  0xaabbcc,  // light alloy
  0x445566,  // dark panel
  0x667788,  // medium hull plate
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _rand()        { return Math.random() * 2 - 1; }
function _randUnit()    { return Math.random(); }

function _hexToRgb(hex) {
  return [
    ((hex >> 16) & 0xff) / 255,
    ((hex >>  8) & 0xff) / 255,
    ( hex        & 0xff) / 255,
  ];
}

const TWO_PI = Math.PI * 2;

function _wrapAngle(a) {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

// ---------------------------------------------------------------------------
// Internal chunk record
// ---------------------------------------------------------------------------

function _makeChunk() {
  return {
    active:  false,
    px: 0, py: 0, pz: 0,
    vx: 0, vy: 0, vz: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    angVelX: 0, angVelY: 0, angVelZ: 0,
    scale:   1,
    drag:    0.05,
    angDrag: 0.02,
    lifetime: 0,
    elapsed:  0,
    cr: 1, cg: 1, cb: 1,
    alpha: 1,
    geometry: null,
  };
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

class VoxelDebris {
  /**
   * @param {object}  [opts]
   * @param {number}  [opts.maxChunks=256]            - Pool capacity
   * @param {number}  [opts.chunksPerExplosion=24]    - Default chunks per burst
   * @param {Geometry}[opts.chunkGeometry]            - Shared box geometry (auto-created if omitted)
   */
  constructor(opts = {}) {
    this._maxChunks         = opts.maxChunks         ?? DEFAULT_MAX_CHUNKS;
    this._chunksPerExplosion = opts.chunksPerExplosion ?? DEFAULT_CHUNKS_PER_EXPLOSION;

    /** Shared box geometry for all chunks — renderer references this once */
    this._geometry = opts.chunkGeometry ?? Geometry.box(1, 1, 1);

    /** @type {Array<object>} flat chunk pool */
    this._pool = Array.from({ length: this._maxChunks }, _makeChunk);

    /** Ring-buffer allocation pointer */
    this._allocHead = 0;

    /** Running count of live chunks */
    this.liveCount = 0;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Emit a burst of voxel chunks from an explosion position.
   *
   * @param {{x,y,z}} position        - World-space centre of explosion
   * @param {object}  [opts]
   * @param {number}  [opts.count]    - Override chunk count
   * @param {number}  [opts.speed=15] - Base outward speed (world-units/s)
   * @param {number}  [opts.speedVariance=0.6] - Speed variance fraction
   * @param {number}  [opts.scale=1]  - Scale multiplier for chunk size and speed
   * @param {number}  [opts.lifetime=2.5] - Chunk lifetime (seconds)
   * @param {number}  [opts.lifetimeVariance=0.8]
   * @param {number}  [opts.drag=0.05]
   * @param {number}  [opts.angSpeed=4] - Base angular velocity (rad/s)
   * @returns {number} Number of chunks successfully spawned
   */
  spawnExplosion(position, opts = {}) {
    const count    = opts.count    ?? this._chunksPerExplosion;
    const speed    = (opts.speed   ?? 15) * (opts.scale ?? 1);
    const speedVar = opts.speedVariance ?? 0.6;
    const baseSize = (opts.scale   ?? 1);
    const lt       = opts.lifetime ?? 2.5;
    const ltVar    = opts.lifetimeVariance ?? 0.8;
    const drag     = opts.drag     ?? 0.05;
    const angSpeed = opts.angSpeed ?? 4;

    let spawned = 0;

    for (let i = 0; i < count; i++) {
      const chunk = this._allocate();
      if (!chunk) break;

      // Random outward direction (uniform sphere)
      const theta = Math.acos(1 - 2 * _randUnit());
      const phi   = _randUnit() * TWO_PI;
      const sinT  = Math.sin(theta);
      const dx = sinT * Math.cos(phi);
      const dy = Math.cos(theta);
      const dz = sinT * Math.sin(phi);

      const s  = speed * (1 + _rand() * speedVar);

      // Random hull color
      const colorHex = HULL_COLORS[Math.floor(_randUnit() * HULL_COLORS.length)];
      const [cr, cg, cb] = _hexToRgb(colorHex);

      const lifetime = Math.max(0.5, lt + _rand() * ltVar);

      chunk.active   = true;
      chunk.px       = position.x + _rand() * 0.5 * baseSize;
      chunk.py       = position.y + _rand() * 0.5 * baseSize;
      chunk.pz       = position.z + _rand() * 0.5 * baseSize;
      chunk.vx       = dx * s;
      chunk.vy       = dy * s;
      chunk.vz       = dz * s;
      chunk.rotX     = _rand() * Math.PI;
      chunk.rotY     = _rand() * Math.PI;
      chunk.rotZ     = _rand() * Math.PI;
      chunk.angVelX  = _rand() * angSpeed;
      chunk.angVelY  = _rand() * angSpeed;
      chunk.angVelZ  = _rand() * angSpeed;
      chunk.scale    = (0.3 + _randUnit() * 0.7) * baseSize;
      chunk.drag     = drag;
      chunk.angDrag  = 0.02;
      chunk.lifetime = lifetime;
      chunk.elapsed  = 0;
      chunk.cr       = cr;
      chunk.cg       = cg;
      chunk.cb       = cb;
      chunk.alpha    = 1;
      chunk.geometry = this._geometry;

      spawned++;
    }

    this.liveCount += spawned;
    return spawned;
  }

  /**
   * Advance all live chunks by `dt` seconds.
   *
   * @param {number} dt - Delta-time in seconds
   */
  update(dt) {
    let live = 0;

    for (let i = 0; i < this._maxChunks; i++) {
      const c = this._pool[i];
      if (!c.active) continue;

      c.elapsed += dt;

      // Lifetime expiry
      if (c.elapsed >= c.lifetime) {
        c.active = false;
        continue;
      }

      // --- linear drag ---
      const linDamp = Math.max(0, 1 - c.drag * dt);
      c.vx *= linDamp;
      c.vy *= linDamp;
      c.vz *= linDamp;

      // --- integrate position ---
      c.px += c.vx * dt;
      c.py += c.vy * dt;
      c.pz += c.vz * dt;

      // --- angular drag ---
      const angDamp = Math.max(0, 1 - c.angDrag * dt);
      c.angVelX *= angDamp;
      c.angVelY *= angDamp;
      c.angVelZ *= angDamp;

      // --- integrate Euler angles ---
      c.rotX = _wrapAngle(c.rotX + c.angVelX * dt);
      c.rotY = _wrapAngle(c.rotY + c.angVelY * dt);
      c.rotZ = _wrapAngle(c.rotZ + c.angVelZ * dt);

      // --- fade out in the last 30 % of lifetime ---
      const progress  = c.elapsed / c.lifetime;
      c.alpha = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1.0;

      live++;
    }

    this.liveCount = live;
  }

  /**
   * Iterate over all live chunks, calling `cb(chunk)` for each.
   * Chunk shape: { px, py, pz, rotX, rotY, rotZ, scale, cr, cg, cb, alpha, geometry }
   *
   * @param {function(object): void} cb
   */
  forEach(cb) {
    for (let i = 0; i < this._maxChunks; i++) {
      if (this._pool[i].active) cb(this._pool[i]);
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** @returns {Geometry} Shared box geometry for all chunks */
  get chunkGeometry() { return this._geometry; }

  /** @returns {number} Pool capacity */
  get maxChunks() { return this._maxChunks; }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  dispose() {
    for (const c of this._pool) { c.active = false; }
    this.liveCount = 0;
    this._allocHead = 0;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /** @private */
  _allocate() {
    const max = this._maxChunks;
    for (let checked = 0; checked < max; checked++) {
      const idx = (this._allocHead + checked) % max;
      if (!this._pool[idx].active) {
        this._allocHead = (idx + 1) % max;
        return this._pool[idx];
      }
    }
    console.warn('[VoxelDebris] Pool full — chunk dropped');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Export (CommonJS + browser global)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VoxelDebris, DEFAULT_MAX_CHUNKS, DEFAULT_CHUNKS_PER_EXPLOSION };
} else {
  window.GQVoxelDebris = { VoxelDebris, DEFAULT_MAX_CHUNKS, DEFAULT_CHUNKS_PER_EXPLOSION };
}
