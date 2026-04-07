/**
 * GpuDevOverlay.js
 *
 * Developer overlay — floating panel showing renderer type, GPU tier, FPS,
 * and a renderer-hint switcher (forces a reload with the chosen backend).
 *
 * Activated automatically when localStorage key `gq:devOverlay` is truthy,
 * or manually via `GpuDevOverlay.show()`.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const OVERLAY_STYLE = `
  position: fixed; bottom: 12px; right: 12px; z-index: 99999;
  background: rgba(10,12,20,0.88); color: #c8d8f0; font: 12px/1.5 monospace;
  padding: 8px 12px; border: 1px solid #2a4870; border-radius: 6px;
  min-width: 200px; pointer-events: auto; user-select: none;
`;

class GpuDevOverlay {
  /**
   * @param {import('../GameEngine').GameEngine} engine
   * @param {Object} [opts]
   * @param {boolean} [opts.autoAttach=false]  Attach to DOM immediately.
   */
  constructor(engine, opts = {}) {
    this._engine  = engine;
    this._el      = null;
    this._raf     = null;
    this._off     = null;

    if (opts.autoAttach || (typeof localStorage !== 'undefined' && localStorage.getItem('gq:devOverlay'))) {
      this.attach();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  attach() {
    if (typeof document === 'undefined' || this._el) return;

    this._el = document.createElement('div');
    this._el.id = 'gq-dev-overlay';
    this._el.setAttribute('style', OVERLAY_STYLE);
    document.body.appendChild(this._el);

    // Subscribe to frame events for live stats
    this._off = this._engine?.events?.on('render:frame', (p) => this._update(p));

    this._render({});
  }

  detach() {
    this._el?.remove();
    this._el = null;
    this._off?.();
    this._off = null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _update({ fps, frameTimeMs } = {}) {
    this._render({ fps, frameTimeMs });
  }

  _render({ fps, frameTimeMs } = {}) {
    if (!this._el) return;

    const engine   = this._engine;
    const caps     = engine?.renderer?.getCapabilities?.() ?? {};
    const renderer = caps.webgpu ? 'WebGPU' : 'WebGL2';
    const tier     = caps.tier   ?? (caps.webgpu ? 'unknown' : '—');
    const hint     = (typeof localStorage !== 'undefined' && localStorage.getItem('gq:rendererHint')) ?? 'auto';
    const fpsStr   = fps != null ? fps.toFixed(1) : '—';
    const msStr    = frameTimeMs != null ? frameTimeMs.toFixed(2) : '—';
    const physics  = engine?.physicsBackend ?? '—';
    const passes   = engine?.postFx?.passes?.filter(p => p.enabled).length ?? 0;

    this._el.innerHTML = `
      <b>GQ Dev</b>
      <table style="border-collapse:collapse;width:100%">
        <tr><td>Renderer</td><td style="text-align:right">${renderer}</td></tr>
        <tr><td>GPU Tier</td><td style="text-align:right">${tier}</td></tr>
        <tr><td>FPS</td><td style="text-align:right">${fpsStr}</td></tr>
        <tr><td>Frame</td><td style="text-align:right">${msStr} ms</td></tr>
        <tr><td>Physics</td><td style="text-align:right">${physics}</td></tr>
        <tr><td>PostFX passes</td><td style="text-align:right">${passes}</td></tr>
      </table>
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
        ${['auto','webgpu','webgl2'].map(h =>
          `<button data-hint="${h}" style="flex:1;cursor:pointer;padding:2px 4px;${hint===h?'font-weight:bold;background:#1a3060':''}">${h}</button>`
        ).join('')}
      </div>
      <div style="margin-top:4px;font-size:10px;color:#607090">Click hint → reload</div>
    `;

    this._el.querySelectorAll('button[data-hint]').forEach(btn => {
      btn.addEventListener('click', () => {
        const h = btn.dataset.hint;
        if (typeof localStorage !== 'undefined') {
          if (h === 'auto') {
            localStorage.removeItem('gq:rendererHint');
          } else {
            localStorage.setItem('gq:rendererHint', h);
          }
          location.reload();
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GpuDevOverlay };
} else {
  window.GQGpuDevOverlay = GpuDevOverlay;
}
