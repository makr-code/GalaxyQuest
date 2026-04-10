/**
 * StellarisSystemOverview.js
 *
 * Stellaris-adapted star-system overview panel.
 *
 * Each celestial body (star, planet, moon, asteroid belt …) is rendered as its
 * own WebGPU <canvas>.  All canvases share one GPUDevice so the GPU resource
 * budget stays small even with 20+ bodies.
 *
 * Usage
 * ─────
 *   const sso = new StellarisSystemOverview('stellaris-system-overview');
 *   await sso.init();
 *   sso.updateBodies(systemPayload, rendererRef);
 *   // …later…
 *   sso.destroy();
 *
 * systemPayload shape (subset used here)
 * ──────────────────────────────────────
 *   payload.star_system   → { name, spectral_class }
 *   payload.planets[]     → { position, generated_planet|player_planet }
 *     planet              → { name, planet_class, moons[], … }
 *     moon                → { name, planet_class|body_type, … }
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// ── Colour helpers ───────────────────────────────────────────────────────────

/** Spectral-class → [r,g,b] float (matches galaxy-renderer-core.js) */
function spectralToRgb(spectralClass) {
  const cls = String(spectralClass || '').toUpperCase().charAt(0);
  const map = {
    O: [0.608, 0.690, 1.000],
    B: [0.667, 0.749, 1.000],
    A: [0.792, 0.843, 1.000],
    F: [0.973, 0.969, 1.000],
    G: [1.000, 0.957, 0.918],
    K: [1.000, 0.824, 0.631],
    M: [1.000, 0.800, 0.435],
  };
  return map[cls] || [0.847, 0.902, 1.000];
}

/** Planet class keyword → [r,g,b] float (matches galaxy-renderer-core.js) */
function planetClassToRgb(planetClass) {
  const cls = String(planetClass || '').toLowerCase();
  if (cls.includes('gas'))                         return [0.839, 0.647, 0.435];
  if (cls.includes('ice giant'))                   return [0.498, 0.780, 0.851];
  if (cls.includes('ice') || cls.includes('frozen')) return [0.608, 0.780, 0.910];
  if (cls.includes('lava') || cls.includes('volcan')) return [0.847, 0.427, 0.275];
  if (cls.includes('desert'))                      return [0.788, 0.678, 0.416];
  if (cls.includes('ocean'))                       return [0.290, 0.627, 0.847];
  if (cls.includes('toxic'))                       return [0.553, 0.698, 0.333];
  if (cls.includes('barren') || cls.includes('rocky')) return [0.561, 0.506, 0.451];
  if (cls.includes('terra') || cls.includes('hab')) return [0.431, 0.749, 0.447];
  if (cls.includes('moon'))                        return [0.600, 0.600, 0.620];
  return [0.604, 0.655, 0.722];
}

/** Hex "#rrggbb" or 0xRRGGBB int → [r,g,b] float */
function hexToRgbFloat(hex) {
  if (typeof hex === 'number') {
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
  }
  const n = String(hex || '').replace(/^#/, '');
  if (n.length !== 6) return [0.490, 0.718, 1.000];
  return [
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255,
  ];
}

// ── WGSL shader builders ─────────────────────────────────────────────────────

/**
 * Returns WGSL source for a sphere body.
 *
 * @param {'star'|'planet'|'moon'|'belt'} kind
 * @param {number[]} baseRgb   [r,g,b] float
 * @param {number[]} atmoRgb   [r,g,b] float (atmosphere / glow colour)
 */
function buildBodyShader(kind, baseRgb, atmoRgb) {
  const [br, bg, bb] = baseRgb.map((v) => v.toFixed(4));
  const [ar, ag, ab] = atmoRgb.map((v) => v.toFixed(4));
  const isStar = kind === 'star';

  return /* wgsl */`
struct Uniforms {
  rotation : f32,
  time     : f32,
  pad0     : f32,
  pad1     : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSOut {
  @builtin(position) pos  : vec4<f32>,
  @location(0)       norm : vec3<f32>,
  @location(1)       uv   : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) idx : u32) -> VSOut {
  let SEG : u32  = 48u;
  let pi         = 3.14159265358979;
  let lat_i      = idx / (SEG + 1u);
  let lon_i      = idx % (SEG + 1u);
  let lat        = (f32(lat_i) / f32(SEG)) * pi - pi * 0.5;
  let lon        = (f32(lon_i) / f32(SEG)) * 2.0 * pi + u.rotation;
  let cosL       = cos(lat);
  let x          = cosL * cos(lon);
  let y          = sin(lat);
  let z          = cosL * sin(lon);
  var out        : VSOut;
  out.pos  = vec4<f32>(x * 0.72, y * 0.72, z * 0.72 - 1.5, 1.0);
  out.norm = vec3<f32>(x, y, z);
  out.uv   = vec2<f32>(f32(lon_i) / f32(SEG), f32(lat_i) / f32(SEG));
  return out;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let view   = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let light  = normalize(vec3<f32>(0.55, 0.45, 0.85));
  let diff   = max(dot(in.norm, light), 0.0);
  let fresnel = pow(1.0 - abs(dot(in.norm, view)), ${isStar ? '2.2' : '3.0'});

  let base_col = vec3<f32>(${br}, ${bg}, ${bb});
  let atmo_col = vec3<f32>(${ar}, ${ag}, ${ab});

${isStar ? `
  // Star: pulsing emission + corona rim
  let pulse  = 0.92 + 0.08 * sin(u.time * 2.1 + in.uv.x * 6.28);
  let corona = pow(fresnel, 1.4) * 1.2;
  let col    = mix(base_col * (diff * 0.4 + 0.6) * pulse, atmo_col, corona);
  return vec4<f32>(col, 1.0);
` : `
  // Planet / moon: diffuse + atmosphere rim
  let col = mix(base_col * (diff * 0.55 + 0.45), atmo_col, fresnel * 0.75);
  return vec4<f32>(col, 1.0);
`}
}
`;
}

// ── Canvas size by body kind ─────────────────────────────────────────────────

const CANVAS_SIZE = Object.freeze({
  star:   { w: 100, h: 100 },
  planet: { w:  80, h:  80 },
  moon:   { w:  56, h:  56 },
  belt:   { w:  56, h:  56 },
});

// ── StellarisSystemOverview ───────────────────────────────────────────────────

class StellarisSystemOverview {
  /**
   * @param {string} containerId  id of the <div> that wraps the overview strip
   * @param {{ documentRef?: Document, windowRef?: Window }} [opts]
   */
  constructor(containerId, opts = {}) {
    this._containerId  = String(containerId || 'stellaris-system-overview');
    this._documentRef  = opts.documentRef  || (typeof document !== 'undefined' ? document : null);
    this._windowRef    = opts.windowRef    || (typeof window   !== 'undefined' ? window   : null);

    /** @type {HTMLElement|null} */
    this._container = null;
    /** @type {GPUDevice|null} */
    this._device = null;
    /** @type {string} preferred canvas format */
    this._canvasFormat = 'bgra8unorm';

    /** @type {Array<BodyEntry>} */
    this._entries = [];
    /** @type {number|null} RAF id */
    this._rafId = null;
    /** @type {number} */
    this._lastTs = 0;

    /** @type {Object|null} renderer reference (optional, for camera control) */
    this._renderer = null;

    this._currentFocusedId = null;
    this._clickTimers = new Map();
    this._dblClickMs  = 320;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialise the component.
   * Resolves once the GPU device is ready (or falls back gracefully if unavailable).
   */
  async init() {
    if (this._documentRef) {
      this._container = this._documentRef.getElementById(this._containerId);
    }
    await this._acquireDevice();
    this._startRaf();
  }

  /**
   * Feed system payload and renderer.
   * Can be called repeatedly to update the displayed system.
   *
   * @param {Object}  payload   System payload (star_system, planets[])
   * @param {Object}  [renderer] Galaxy3DRenderer reference (optional)
   */
  updateBodies(payload, renderer) {
    // Lazy-resolve container (allows calling updateBodies without a prior init())
    if (!this._container && this._documentRef) {
      this._container = this._documentRef.getElementById(this._containerId);
    }
    this._renderer = renderer || null;
    this._disposeEntries();
    this._entries = [];
    this._currentFocusedId = null;

    if (!payload) {
      this._renderDom();
      return;
    }

    // 1. Star
    const starData = payload.star_system || payload.star || null;
    if (starData) {
      this._entries.push({
        id:   'star',
        kind: 'star',
        name: String(starData.name || starData.catalog_name || 'Star'),
        body: starData,
        spectralClass: String(starData.spectral_class || starData.spectralClass || 'G'),
        planetClass:   null,
        ownerColor:    null,
        canvas:  null,
        context: null,
        pipeline:    null,
        uniformBuf:  null,
        bindGroup:   null,
        rotation: 0,
      });
    }

    // 2. Planets + moons
    const planets = Array.isArray(payload.planets) ? payload.planets : [];
    planets.forEach((slot, slotIdx) => {
      const planet = slot.generated_planet || slot.player_planet || slot.body || null;
      if (!planet) return;

      const pos      = slot.position || slotIdx;
      const pId      = `planet-${pos}`;
      const pName    = String(planet.name || `Planet ${pos}`);
      const ownerCol = planet.owner_color || slot.player_planet?.owner_color || null;

      this._entries.push({
        id:   pId,
        kind: 'planet',
        name: pName,
        body: planet,
        spectralClass: null,
        planetClass: String(planet.planet_class || ''),
        ownerColor:  ownerCol,
        canvas:  null,
        context: null,
        pipeline:    null,
        uniformBuf:  null,
        bindGroup:   null,
        rotation: 0,
      });

      const moons = Array.isArray(planet.moons) ? planet.moons : [];
      moons.forEach((moon, mi) => {
        const mName = String(moon.name || `${pName} ${String.fromCharCode(97 + mi)}`);
        this._entries.push({
          id:          `moon-${pos}-${mi}`,
          kind:        'moon',
          name:        mName,
          body:        moon,
          spectralClass: null,
          planetClass: String(moon.planet_class || moon.body_type || 'moon'),
          ownerColor:  moon.owner_color || null,
          canvas:  null,
          context: null,
          pipeline:    null,
          uniformBuf:  null,
          bindGroup:   null,
          rotation: 0,
        });
      });
    });

    this._renderDom();
    this._initWebGPUForEntries();
    this._showPanel();
  }

  /** Programmatically focus a body by id. */
  setFocusedBody(bodyId) {
    this._currentFocusedId = bodyId;
    this._updateFocusStyles();
  }

  /** Hide the panel (e.g. on system exit). */
  hide() {
    if (!this._container && this._documentRef) {
      this._container = this._documentRef.getElementById(this._containerId);
    }
    if (this._container) this._container.classList.remove('sso-visible');
  }

  /** Destroy resources and stop the RAF loop. */
  destroy() {
    this._stopRaf();
    this._disposeEntries();
    if (this._container) this._container.innerHTML = '';
    this._container = null;
    this._device    = null;
    this._entries   = [];
  }

  // ── Private: GPU device ────────────────────────────────────────────────────

  async _acquireDevice() {
    const nav = this._windowRef?.navigator ?? (typeof navigator !== 'undefined' ? navigator : null);
    if (!nav?.gpu) return;

    const cached = this._windowRef?.__GQ_WEBGPU_ADAPTER_AVAILABLE;
    if (cached && cached.value === false) return;

    try {
      const ua = String(nav.userAgent || '').toLowerCase();
      const isWindows = ua.includes('windows');
      const adapterOptions = isWindows ? undefined : { powerPreference: 'high-performance' };
      const adapter = await nav.gpu.requestAdapter(adapterOptions);
      if (!adapter) {
        if (this._windowRef) this._windowRef.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: false };
        return;
      }
      if (this._windowRef) this._windowRef.__GQ_WEBGPU_ADAPTER_AVAILABLE = { value: true };
      this._device = await adapter.requestDevice();
      this._canvasFormat = nav.gpu.getPreferredCanvasFormat
        ? nav.gpu.getPreferredCanvasFormat()
        : 'bgra8unorm';
      this._device.addEventListener('uncapturederror', (ev) => {
        // swallow device errors to avoid breaking the rest of the app
        console.warn('[StellarisSystemOverview] WebGPU device error:', ev.error);
      });
    } catch (err) {
      console.warn('[StellarisSystemOverview] WebGPU unavailable:', err);
    }
  }

  // ── Private: DOM rendering ─────────────────────────────────────────────────

  _renderDom() {
    if (!this._container) return;
    this._container.innerHTML = '';

    if (!this._entries.length) return;

    const doc = this._documentRef;
    const strip = doc.createElement('div');
    strip.className = 'sso-strip';
    strip.setAttribute('role', 'list');
    strip.setAttribute('aria-label', 'Stellaris System Overview');

    this._entries.forEach((entry) => {
      const { w, h } = CANVAS_SIZE[entry.kind] || CANVAS_SIZE.planet;

      const card = doc.createElement('div');
      card.className = `sso-card sso-card--${entry.kind}`;
      card.setAttribute('role', 'listitem');
      card.setAttribute('data-sso-id', entry.id);
      card.setAttribute('aria-label', entry.name);
      card.title = entry.name;

      const cvs = doc.createElement('canvas');
      cvs.className  = 'sso-canvas';
      cvs.width      = w;
      cvs.height     = h;
      cvs.setAttribute('aria-hidden', 'true');

      const label = doc.createElement('span');
      label.className   = 'sso-label';
      label.textContent = entry.name;

      const badge = doc.createElement('span');
      badge.className   = 'sso-badge';
      badge.textContent = this._kindLabel(entry);

      card.appendChild(cvs);
      card.appendChild(label);
      card.appendChild(badge);
      strip.appendChild(card);

      entry.canvas = cvs;

      // Click handlers
      card.addEventListener('click', (ev) => {
        ev.preventDefault();
        this._handleCardClick(entry);
      });
    });

    this._container.appendChild(strip);
  }

  _kindLabel(entry) {
    if (entry.kind === 'star')   return String(entry.spectralClass || 'G') + '-Star';
    if (entry.kind === 'moon')   return 'Moon';
    const cls = String(entry.planetClass || '');
    if (cls) return cls.charAt(0).toUpperCase() + cls.slice(1);
    return 'Planet';
  }

  _showPanel() {
    if (this._container) this._container.classList.add('sso-visible');
  }

  _updateFocusStyles() {
    if (!this._container) return;
    this._container.querySelectorAll('.sso-card').forEach((card) => {
      const id = card.getAttribute('data-sso-id');
      card.classList.toggle('sso-card--focused', id === this._currentFocusedId);
    });
  }

  // ── Private: WebGPU per-body pipeline ──────────────────────────────────────

  _initWebGPUForEntries() {
    if (!this._device) return;
    this._entries.forEach((entry) => {
      if (!entry.canvas) return;
      try {
        this._initBodyWebGPU(entry);
      } catch (err) {
        console.warn(`[StellarisSystemOverview] GPU init failed for ${entry.id}:`, err);
      }
    });
  }

  _initBodyWebGPU(entry) {
    const ctx = entry.canvas.getContext('webgpu');
    if (!ctx) return;

    ctx.configure({
      device: this._device,
      format: this._canvasFormat,
      alphaMode: 'opaque',
    });
    entry.context = ctx;

    // Colour palette
    const baseRgb = this._bodyBaseColor(entry);
    const atmoRgb = this._bodyAtmoColor(entry, baseRgb);

    const shaderCode = buildBodyShader(entry.kind, baseRgb, atmoRgb);
    const module = this._device.createShaderModule({ code: shaderCode });

    entry.pipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: this._canvasFormat }] },
      primitive: { topology: 'triangle-strip' },
    });

    // Uniform buffer: rotation(f32) + time(f32) + 2×pad
    entry.uniformBuf = this._device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    entry.bindGroup = this._device.createBindGroup({
      layout: entry.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: entry.uniformBuf } }],
    });
  }

  _bodyBaseColor(entry) {
    if (entry.kind === 'star') return spectralToRgb(entry.spectralClass);
    if (entry.ownerColor)      return hexToRgbFloat(entry.ownerColor);
    return planetClassToRgb(entry.planetClass);
  }

  _bodyAtmoColor(entry, baseRgb) {
    if (entry.kind === 'star') {
      // Brighter / more saturated corona
      return baseRgb.map((v, i) => Math.min(1, v * 1.3 + (i === 0 ? 0.1 : -0.05)));
    }
    if (entry.kind === 'moon') {
      return [0.72, 0.74, 0.78];
    }
    // Planet: blend toward sky blue
    return baseRgb.map((v) => Math.min(1, v * 0.6 + 0.4));
  }

  // ── Private: RAF render loop ───────────────────────────────────────────────

  _startRaf() {
    if (this._rafId !== null) return;
    const raf = this._windowRef?.requestAnimationFrame?.bind(this._windowRef)
      ?? (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
    if (!raf) return;

    const loop = (ts) => {
      const dt  = Math.min((ts - this._lastTs) / 1000, 0.1);
      this._lastTs = ts;
      this._renderAllBodies(dt, ts / 1000);
      this._rafId = raf(loop);
    };
    this._rafId = raf(loop);
  }

  _stopRaf() {
    if (this._rafId === null) return;
    const cancel = this._windowRef?.cancelAnimationFrame?.bind(this._windowRef)
      ?? (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null);
    if (cancel) cancel(this._rafId);
    this._rafId = null;
  }

  _renderAllBodies(dt, time) {
    if (!this._device) return;
    for (const entry of this._entries) {
      if (!entry.context || !entry.pipeline || !entry.uniformBuf || !entry.bindGroup) continue;
      try {
        this._renderBody(entry, dt, time);
      } catch (_) {
        // Silently ignore per-frame errors (e.g. canvas removed from DOM)
      }
    }
  }

  _renderBody(entry, dt, time) {
    // Rotation speed: stars rotate slower, moons faster
    const speed = entry.kind === 'star' ? 0.04 : entry.kind === 'moon' ? 0.12 : 0.07;
    entry.rotation = (entry.rotation + dt * speed) % (2 * Math.PI);

    const uniforms = new Float32Array([entry.rotation, time, 0, 0]);
    this._device.queue.writeBuffer(entry.uniformBuf, 0, uniforms);

    const encoder = this._device.createCommandEncoder();
    const view    = entry.context.getCurrentTexture().createView();
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: this._clearColor(entry.kind),
        loadOp:  'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(entry.pipeline);
    pass.setBindGroup(0, entry.bindGroup);
    // 49×49 grid = 2401 verts in triangle-strip
    pass.draw(49 * 49, 1, 0, 0);
    pass.end();
    this._device.queue.submit([encoder.finish()]);
  }

  _clearColor(kind) {
    if (kind === 'star')  return { r: 0.01, g: 0.02, b: 0.06, a: 1 };
    if (kind === 'moon')  return { r: 0.02, g: 0.02, b: 0.04, a: 1 };
    return { r: 0.00, g: 0.01, b: 0.04, a: 1 };
  }

  // ── Private: Interaction ──────────────────────────────────────────────────

  _handleCardClick(entry) {
    const id  = entry.id;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this._clickTimers.has(id)) {
      const first = this._clickTimers.get(id);
      if (now - first < this._dblClickMs) {
        this._clickTimers.delete(id);
        this._onBodyDoubleClick(entry);
        return;
      }
    }
    this._clickTimers.set(id, now);
    this._onBodySingleClick(entry);
    setTimeout(() => {
      if (this._clickTimers.get(id) === now) this._clickTimers.delete(id);
    }, this._dblClickMs + 50);
  }

  _onBodySingleClick(entry) {
    this.setFocusedBody(entry.id);
    if (!this._renderer) return;
    if (entry.kind === 'star' && typeof this._renderer.focusOnStar === 'function') {
      this._renderer.focusOnStar(entry.body, true);
    } else if (typeof this._renderer.focusOnSystemPlanet === 'function') {
      this._renderer.focusOnSystemPlanet({ body: entry.body, kind: entry.kind, name: entry.name }, true);
    }
  }

  _onBodyDoubleClick(entry) {
    const win = this._windowRef;
    if (!win) return;
    if (entry.kind === 'planet') {
      win.dispatchEvent(new CustomEvent('gq:transmission-to-planet', {
        detail: { planet: entry, position: entry.body?.position },
      }));
    } else if (entry.kind === 'moon') {
      win.dispatchEvent(new CustomEvent('gq:transmission-to-moon', {
        detail: { moon: entry, parentPlanetId: entry._parentPlanetId },
      }));
    }
  }

  // ── Private: cleanup ──────────────────────────────────────────────────────

  _disposeEntries() {
    for (const e of this._entries) {
      try { e.uniformBuf?.destroy(); } catch (_) {}
      e.canvas     = null;
      e.context    = null;
      e.pipeline   = null;
      e.uniformBuf = null;
      e.bindGroup  = null;
    }
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.StellarisSystemOverview = StellarisSystemOverview;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StellarisSystemOverview, spectralToRgb, planetClassToRgb, hexToRgbFloat, buildBodyShader };
}
