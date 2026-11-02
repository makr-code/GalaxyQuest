/**
 * EffectComposer.js  (WebGPU port)
 *
 * Renderer-agnostic post-processing chain.
 * Manages ping-pong render targets and routes each pass via the
 * abstract IGraphicsRenderer interface.
 *
 * Existing WebGL PostEffectsManager (js/rendering/post-effects.js) can delegate to
 * this class when WebGPU is available.
 *
 * Pass execution order
 * --------------------
 * Passes execute in insertion order unless explicit dependencies require
 * reordering. Optional metadata on each pass:
 *   id: unique, nonempty string (only required when referenced by another pass).
 *   after: array of registered pass IDs; order after enabled providers.
 *   requires: array of registered pass IDs; providers MUST be enabled.
 * Both fields add ordering edges, not named texture bindings. Missing IDs,
 * duplicate IDs, malformed metadata and enabled dependency cycles throw before
 * any pass executes. Disabled consumers do not enforce their dependencies.
 * Among ready passes, insertion order breaks ties. Metadata and enabled flags
 * are re-evaluated every render; the public pass list stays in insertion order.
 * No implicit IDs, inferred dependencies or default pass changes are applied.
 *
 * Use addPass() / removePass() to manage the chain at runtime. As before,
 * only truthy pass.enabled values participate. Skipped passes do not affect the
 * ping-pong state — the next enabled pass receives the same source texture.
 *
 * Ping-pong framebuffer chain
 * ---------------------------
 * Two internal render targets (rtA, rtB) alternate as source and destination.
 * The final enabled pass writes directly to `mainTarget` (null = screen) so
 * no extra copy is needed.
 *
 * Inspiration:
 *   - Three.js EffectComposer (MIT) — https://github.com/mrdoob/three.js
 *   - Babylon.js PostProcessRenderPipeline (Apache 2.0)
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// GPUTextureUsage: COPY_SRC | TEXTURE_BINDING | RENDER_ATTACHMENT.
const COMPOSER_TARGET_USAGE = 0x01 | 0x04 | 0x10;

class EffectComposer {
  /**
   * @param {import('../core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {number} width
   * @param {number} height
   */
  constructor(renderer, width, height) {
    this._renderer = renderer;
    this._passes   = [];
    this._width    = width;
    this._height   = height;
    this._disposed = false;
    this._targets = new Map();

    // Two render targets for ping-pong
    [this._rtA, this._rtB] = this._acquirePair(width, height);
    this._pingIdx = 0;
  }

  // =========================================================================
  // Pass management
  // =========================================================================

  /**
   * Append a pass to the end of the chain.
   * @param {Object} pass  Any object with a .render(srcTex, dstTex, renderer) method.
   * @returns {this}
   */
  addPass(pass) {
    this._assertActive();
    this._passes.push(pass);
    return this;
  }

  /**
   * Remove a pass from the chain.  No-op if the pass is not present.
   * @param {Object} pass
   * @returns {this}
   */
  removePass(pass) {
    const idx = this._passes.indexOf(pass);
    if (idx !== -1) this._passes.splice(idx, 1);
    return this;
  }

  /**
   * Read-only view of the current pass list (insertion order).
   * @returns {ReadonlyArray<Object>}
   */
  get passes() {
    return this._passes;
  }

  // =========================================================================
  // Rendering
  // =========================================================================

  /**
   * Execute the full pass chain using ping-pong render targets.
   *
   * Only enabled passes participate in the chain.  The last enabled pass
   * renders directly into `mainTarget` to avoid a redundant copy.
   *
   * @param {Object|null} [inputTexture]  Starting source texture for the chain.
   *   When null the first pass reads from the current ping-pong source
   *   (i.e. whatever the previous frame left there).
   * @param {Object|null} [mainTarget]    Final output texture/framebuffer;
   *   null means the last pass renders to the screen / swap-chain.
   */
  render(inputTexture = null, mainTarget = null) {
    this._assertActive();
    const passes = this._orderedPasses();
    const rts = [this._rtA, this._rtB];
    let srcIdx = this._pingIdx;
    let src = inputTexture ?? rts[srcIdx];
    const plan = [];
    for (let i = 0; i < passes.length; i++) {
      const isLast = i === passes.length - 1;
      let dstIdx = srcIdx ^ 1;
      if (!isLast && this._sameTexture(src, rts[dstIdx])) dstIdx ^= 1;
      const dst = isLast ? mainTarget : rts[dstIdx];
      if (this._sameTexture(src, dst)) {
        throw new Error('EffectComposer: source and destination textures alias');
      }
      plan.push({ pass: passes[i], src, dst });
      if (!isLast) srcIdx = dstIdx;
      src = dst;
    }

    // Validate the entire frame before dispatch; failed frames do not commit
    // ping-pong state (already-issued GPU work cannot be rolled back).
    for (const { pass, src, dst } of plan) pass.render(src, dst, this._renderer);
    this._pingIdx = srcIdx;
  }

  /** @private */
  _orderedPasses() {
    const ids = new Map();
    const nodes = this._passes.map((pass, index) => {
      if (!pass || typeof pass.render !== 'function') {
        throw new TypeError(`EffectComposer: pass at index ${index} needs render()`);
      }
      if (pass.id !== undefined) {
        if (typeof pass.id !== 'string' || !pass.id.trim()) {
          throw new TypeError('EffectComposer: pass.id must be a nonempty string');
        }
        if (ids.has(pass.id)) throw new Error(`EffectComposer: duplicate pass ID "${pass.id}"`);
      }
      for (const field of ['after', 'requires']) {
        if (pass[field] !== undefined && (!Array.isArray(pass[field]) ||
            pass[field].some(id => typeof id !== 'string' || !id.trim()))) {
          throw new TypeError(`EffectComposer: ${field} must be an array of nonempty pass IDs`);
        }
      }
      const node = { pass, index, pending: new Set(), consumers: [] };
      if (pass.id !== undefined) ids.set(pass.id, node);
      return node;
    });
    const active = nodes.filter(node => node.pass.enabled);
    for (const node of active) {
      for (const field of ['after', 'requires']) {
        for (const id of node.pass[field] ?? []) {
          const provider = ids.get(id);
          if (!provider) throw new Error(`EffectComposer: missing ${field} provider "${id}"`);
          if (!provider.pass.enabled) {
            if (field === 'requires') {
              throw new Error(`EffectComposer: required provider "${id}" is disabled`);
            }
            continue;
          }
          node.pending.add(provider);
        }
      }
      for (const provider of node.pending) provider.consumers.push(node);
    }
    const ready = active.filter(node => node.pending.size === 0);
    const ordered = [];
    while (ready.length) {
      ready.sort((a, b) => a.index - b.index);
      const node = ready.shift();
      ordered.push(node.pass);
      for (const consumer of node.consumers) {
        consumer.pending.delete(node);
        if (consumer.pending.size === 0) ready.push(consumer);
      }
    }
    if (ordered.length !== active.length) {
      const blocked = active.filter(node => node.pending.size)
        .map(node => node.pass.id ?? `index ${node.index}`);
      throw new Error(`EffectComposer: dependency cycle involving ${blocked.join(', ')}`);
    }
    return ordered;
  }

  // =========================================================================
  // Resize / dispose
  // =========================================================================

  resize(width, height) {
    this._assertActive();
    // Allocate first so a partial allocation failure leaves the old pair usable.
    const [rtA, rtB] = this._acquirePair(width, height);
    const old = [this._rtA, this._rtB];
    this._rtA = rtA;
    this._rtB = rtB;
    this._width  = width;
    this._height = height;
    this._pingIdx = 0;
    this._releaseAll(old);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const passes = new Set(this._passes);
    const targets = [this._rtA, this._rtB];
    this._passes = [];
    this._rtA = this._rtB = null;
    const errors = [];
    for (const pass of passes) {
      try { pass.dispose?.(); } catch (error) { errors.push(error); }
    }
    try { this._releaseAll(targets); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'EffectComposer: disposal failed');
  }

  // =========================================================================
  // Private helpers — resource pool integration
  // =========================================================================

  /**
   * Acquire a render-target texture.  Uses the renderer's resource pool when
   * available (renderer.resourcePool), otherwise falls back to a direct
   * createTexture() call.
   * @private
   */
  _acquireRT(width, height) {
    const pool = this._renderer?.resourcePool;
    const owner = pool && typeof pool.acquireTexture === 'function' &&
      typeof pool.releaseTexture === 'function' ? pool : null;
    const texture = owner
      ? owner.acquireTexture('rgba8unorm', width, height, COMPOSER_TARGET_USAGE)
      : this._renderer.createTexture({ width, height, format: 'rgba8unorm', renderTarget: true });
    if (!texture || this._targets.has(texture)) {
      throw new Error('EffectComposer: renderer must acquire distinct render targets');
    }
    this._targets.set(texture, { pool: owner, width, height });
    return texture;
  }

  /**
   * Return to the acquiring pool with the original dimensions, or destroy a
   * directly-created texture (WebGL render targets use dispose()).
   * @private
   */
  _releaseRT(texture) {
    const ownership = this._targets.get(texture);
    if (!ownership) return;
    this._targets.delete(texture);
    const { pool, width, height } = ownership;
    if (pool) {
      pool.releaseTexture(texture, 'rgba8unorm', width, height, COMPOSER_TARGET_USAGE);
    } else if (typeof texture.destroy === 'function') {
      texture.destroy();
    } else {
      texture.dispose?.();
    }
  }

  /** @private */
  _releaseAll(textures) {
    const errors = [];
    for (const texture of textures) {
      try { this._releaseRT(texture); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'EffectComposer: target release failed');
  }

  /** @private */
  _acquirePair(width, height) {
    let first;
    try {
      first = this._acquireRT(width, height);
      return [first, this._acquireRT(width, height)];
    } catch (error) {
      try { this._releaseRT(first); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'EffectComposer: allocation failed');
      }
      throw error;
    }
  }

  /** @private */
  _assertActive() {
    if (this._disposed) throw new Error('EffectComposer: already disposed');
  }

  /** @private */
  _sameTexture(a, b) {
    if (a == null || b == null) return false;
    return (a.gpuTexture ?? a.texture ?? a) === (b.gpuTexture ?? b.texture ?? b);
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EffectComposer };
} else {
  window.GQEffectComposer = EffectComposer;
}
