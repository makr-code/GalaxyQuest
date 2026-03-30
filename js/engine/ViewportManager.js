/**
 * ViewportManager.js
 *
 * PiP (Picture-in-Picture) viewport system for multiple cameras.
 *
 * Each secondary camera (ship follower, base cam, colony cam) is rendered
 * into a small overlay canvas positioned over the main game canvas.
 *
 * Architecture:
 *
 *   Main Canvas  ← primary renderer output
 *   + <div.gq-viewport-container>
 *       + <div.gq-viewport[name]>  ← one per PiP
 *           + <header>  label + close button
 *           + <canvas>  secondary render target
 *
 * The secondary renderer (WebGL2 / WebGPU) renders each camera's view into an
 * off-screen canvas using the same IGraphicsRenderer.  For the skeleton phase,
 * each PiP canvas gets a CSS-styled placeholder until the renderer supports
 * multi-target output in Phase 4.
 *
 * Drag, resize, and close are handled via pointer events — no external
 * dependencies.
 *
 * Inspired by:
 *   - X4: Foundations  — satellite cameras / docking cam viewports
 *   - Elite Dangerous  — multi-panel cockpit layout
 *   - EVE Online       — multi-window undock interface
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ---------------------------------------------------------------------------
// Default layout constants
// ---------------------------------------------------------------------------

const PIP_DEFAULTS = Object.freeze({
  width:     220,
  height:    150,
  minWidth:  120,
  minHeight: 80,
  padding:   8,       // gap from canvas edge on auto-place
  gap:       8,       // gap between auto-placed viewports
  opacity:   0.92,
});

// ---------------------------------------------------------------------------
// ViewportEntry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ViewportEntry
 * @property {string}  name
 * @property {import('./scene/Camera').Camera} camera
 * @property {string}  label
 * @property {boolean} enabled
 * @property {HTMLElement} root
 * @property {HTMLCanvasElement} canvas
 * @property {number}  x  current left position (px)
 * @property {number}  y  current top position (px)
 * @property {number}  w  current width (px)
 * @property {number}  h  current height (px)
 */

// ---------------------------------------------------------------------------
// ViewportManager
// ---------------------------------------------------------------------------

class ViewportManager {
  /**
   * @param {HTMLCanvasElement}  mainCanvas  The primary game canvas
   * @param {import('./core/GraphicsContext').IGraphicsRenderer} renderer
   * @param {import('./scene/CameraManager').CameraManager} cameraManager
   */
  constructor(mainCanvas, renderer, cameraManager) {
    this._mainCanvas     = mainCanvas;
    this._renderer       = renderer;
    this._cameraManager  = cameraManager;

    /** @type {Map<string, ViewportEntry>} */
    this._viewports      = new Map();
    this._container      = null;
    this._autoPlaceIndex = 0;

    this._attached = false;
  }

  // ---------------------------------------------------------------------------
  // DOM Attachment
  // ---------------------------------------------------------------------------

  /**
   * Create the overlay container and attach it to the DOM.
   * Must be called before add().
   */
  attach() {
    if (this._attached) return;

    // Ensure main canvas parent is position:relative so we can overlay
    const parent = this._mainCanvas.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    this._container = document.createElement('div');
    this._container.className = 'gq-viewport-container';
    this._container.style.cssText = [
      'position:absolute', 'inset:0', 'pointer-events:none',
      'overflow:hidden',   'z-index:10',
    ].join(';');

    parent.appendChild(this._container);
    this._attached = true;
  }

  detach() {
    this._container?.remove();
    this._attached = false;
  }

  // ---------------------------------------------------------------------------
  // Viewport registration
  // ---------------------------------------------------------------------------

  /**
   * Add a PiP viewport for a named camera.
   *
   * @param {string}  name    Must match a key in CameraManager
   * @param {Object}  [opts]
   * @param {string}  [opts.label]         Display title (defaults to name)
   * @param {number}  [opts.x]             Left position in px (auto if omitted)
   * @param {number}  [opts.y]             Top position in px (auto if omitted)
   * @param {number}  [opts.width=220]
   * @param {number}  [opts.height=150]
   * @param {boolean} [opts.draggable=true]
   * @param {boolean} [opts.resizable=true]
   * @param {boolean} [opts.closable=true]
   */
  add(name, opts = {}) {
    if (this._viewports.has(name)) return this;
    if (!this._attached) this.attach();

    const camera = this._cameraManager.get(name);
    if (!camera) {
      console.warn(`[ViewportManager] No camera registered as '${name}'`);
      return this;
    }

    const w     = opts.width  ?? PIP_DEFAULTS.width;
    const h     = opts.height ?? PIP_DEFAULTS.height;
    const [x, y] = this._autoPosition(opts.x, opts.y, w, h);

    // Build DOM elements
    const { root, pipCanvas } = this._buildPipDOM({
      name,
      label:    opts.label    ?? name,
      x, y, w, h,
      draggable: opts.draggable !== false,
      resizable: opts.resizable !== false,
      closable:  opts.closable  !== false,
    });

    this._container.appendChild(root);

    const entry = { name, camera, label: opts.label ?? name, enabled: true, root, canvas: pipCanvas, x, y, w, h };
    this._viewports.set(name, entry);
    this._autoPlaceIndex++;

    return this;
  }

  /** Remove and destroy a viewport. */
  remove(name) {
    const entry = this._viewports.get(name);
    if (!entry) return this;
    entry.root.remove();
    this._viewports.delete(name);
    return this;
  }

  /** Show / hide a viewport without removing it. */
  setVisible(name, visible) {
    const entry = this._viewports.get(name);
    if (!entry) return this;
    entry.enabled = visible;
    entry.root.style.display = visible ? '' : 'none';
    return this;
  }

  /** Move a viewport to new absolute pixel coordinates. */
  move(name, x, y) {
    const entry = this._viewports.get(name);
    if (!entry) return this;
    entry.x = x;
    entry.y = y;
    entry.root.style.left = `${x}px`;
    entry.root.style.top  = `${y}px`;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Render all active PiP viewports.
   * Called by GameEngine._onRender() after the main scene render.
   *
   * @param {import('./scene/SceneGraph').SceneGraph} scene
   */
  render(scene) {
    for (const entry of this._viewports.values()) {
      if (!entry.enabled) continue;

      // Update the camera label if a follow-target's name changed
      this._refreshLabel(entry);

      // Render the secondary camera view into the PiP canvas
      this._renderPip(entry, scene);
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  get count() { return this._viewports.size; }
  has(name)   { return this._viewports.has(name); }
  names()     { return [...this._viewports.keys()]; }

  // ---------------------------------------------------------------------------
  // Private — DOM building
  // ---------------------------------------------------------------------------

  _buildPipDOM({ name, label, x, y, w, h, draggable, resizable, closable }) {
    const root = document.createElement('div');
    root.className   = 'gq-viewport';
    root.dataset.cam = name;
    root.style.cssText = [
      `left:${x}px`, `top:${y}px`,
      `width:${w}px`, `height:${h}px`,
      'position:absolute', 'pointer-events:auto',
      `opacity:${PIP_DEFAULTS.opacity}`,
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.className = 'gq-viewport__header';

    const labelEl = document.createElement('span');
    labelEl.className = 'gq-viewport__label';
    labelEl.textContent = label;

    header.appendChild(labelEl);

    if (closable) {
      const closeBtn = document.createElement('button');
      closeBtn.className   = 'gq-viewport__close';
      closeBtn.textContent = '✕';
      closeBtn.title       = 'Close viewport';
      closeBtn.addEventListener('click', () => this.remove(name));
      header.appendChild(closeBtn);
    }

    // PiP canvas
    const pipCanvas = document.createElement('canvas');
    pipCanvas.className = 'gq-viewport__canvas';
    pipCanvas.width     = w;
    pipCanvas.height    = h - 22; // subtract header height
    pipCanvas.style.cssText = 'display:block;width:100%;height:100%;';

    root.appendChild(header);
    root.appendChild(pipCanvas);

    // Drag behaviour
    if (draggable) this._makeDraggable(root, header, name);

    // Resize behaviour
    if (resizable) this._makeResizable(root, pipCanvas, name);

    return { root, pipCanvas };
  }

  _makeDraggable(root, handle, name) {
    let ox = 0, oy = 0, startX = 0, startY = 0;

    handle.style.cursor = 'grab';

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      handle.setPointerCapture(e.pointerId);
      handle.style.cursor = 'grabbing';
      const entry = this._viewports.get(name);
      ox = entry?.x ?? 0;
      oy = entry?.y ?? 0;
      startX = e.clientX;
      startY = e.clientY;

      const onMove = (me) => {
        const nx = ox + (me.clientX - startX);
        const ny = oy + (me.clientY - startY);
        this.move(name, nx, ny);
      };
      const onUp = () => {
        handle.style.cursor = 'grab';
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',   onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup',   onUp);
    });
  }

  _makeResizable(root, pipCanvas, name) {
    const handle = document.createElement('div');
    handle.className = 'gq-viewport__resize';
    handle.style.cssText = [
      'position:absolute', 'right:0', 'bottom:0',
      'width:12px', 'height:12px', 'cursor:se-resize',
      'pointer-events:auto',
    ].join(';');
    root.appendChild(handle);

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const entry  = this._viewports.get(name);
      const sw     = entry?.w ?? PIP_DEFAULTS.width;
      const sh     = entry?.h ?? PIP_DEFAULTS.height;

      const onMove = (me) => {
        const nw = Math.max(PIP_DEFAULTS.minWidth,  sw + (me.clientX - startX));
        const nh = Math.max(PIP_DEFAULTS.minHeight, sh + (me.clientY - startY));
        root.style.width  = `${nw}px`;
        root.style.height = `${nh}px`;
        pipCanvas.width   = nw;
        pipCanvas.height  = nh - 22;
        if (entry) { entry.w = nw; entry.h = nh; }
      };
      const onUp = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup',   onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup',   onUp);
    });
  }

  _autoPosition(x, y, w, _h) {
    if (x !== undefined && y !== undefined) return [x, y];
    // Stack viewports in the top-right corner
    const padding = PIP_DEFAULTS.padding;
    const gap     = PIP_DEFAULTS.gap;
    const mainW   = this._mainCanvas.width || 800;
    const nx      = mainW - w - padding;
    const ny      = padding + this._autoPlaceIndex * (PIP_DEFAULTS.height + gap);
    return [nx, ny];
  }

  _refreshLabel(entry) {
    const camEntry = this._cameraManager?._cameras?.get(entry.name);
    if (!camEntry) return;
    const target   = camEntry.camera._target;
    const dynLabel = target?.name ?? target?.id ?? null;
    if (dynLabel && dynLabel !== entry.label) {
      entry.label = dynLabel;
      const labelEl = entry.root.querySelector('.gq-viewport__label');
      if (labelEl) labelEl.textContent = dynLabel;
    }
  }

  _renderPip(entry, scene) {
    const ctx = entry.canvas.getContext('2d');
    if (!ctx) return;
    // Placeholder fill — Phase 4 will wire up real GPU sub-pass rendering
    ctx.fillStyle = '#0a0f1a';
    ctx.fillRect(0, 0, entry.canvas.width, entry.canvas.height);

    if (entry.camera) {
      const p = entry.camera.position;
      ctx.fillStyle  = 'rgba(100,200,255,0.5)';
      ctx.font       = '10px monospace';
      ctx.textBaseline = 'top';
      ctx.fillText(`cam: ${entry.name}`, 6, 6);
      if (p) {
        ctx.fillText(
          `pos: (${p.x?.toFixed(0) ?? '?'}, ${p.y?.toFixed(0) ?? '?'}, ${p.z?.toFixed(0) ?? '?'})`,
          6, 20
        );
      }
      const target = entry.camera._target;
      if (target?.name) ctx.fillText(`→ ${target.name}`, 6, 34);
    }
    // Crosshair
    const cw = entry.canvas.width, ch = entry.canvas.height;
    ctx.strokeStyle = 'rgba(100,200,255,0.25)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cw / 2 - 10, ch / 2); ctx.lineTo(cw / 2 + 10, ch / 2);
    ctx.moveTo(cw / 2, ch / 2 - 10); ctx.lineTo(cw / 2, ch / 2 + 10);
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ViewportManager, PIP_DEFAULTS };
} else {
  window.GQViewportManager = { ViewportManager, PIP_DEFAULTS };
}
