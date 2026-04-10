/**
 * PlanetApproachLevelWebGPU.js
 *
 * IZoomLevelRenderer — Planet Approach zoom level (Level 2), WebGPU backend.
 *
 * Rendering features
 * ──────────────────
 *  • High-resolution planet sphere (64×64 segments) via custom WGSL shader.
 *  • Procedural animated cloud layer (second sphere, slightly larger).
 *  • Atmosphere rim-lighting via Fresnel term in WGSL.
 *  • Planet rotation during approach.
 *
 * In the live app, raw WebGPU calls are used.  In test / headless environments
 * (no navigator.gpu) the methods are no-ops so the orchestrator tests pass
 * without a GPU context.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

function parseHexColor(hex, fallback) {
  const normalized = String(hex || '').trim();
  return /^#?[0-9a-f]{6}$/i.test(normalized)
    ? `#${normalized.replace(/^#/, '')}`
    : fallback;
}

function hexToRgbFloat(hex) {
  const normalized = parseHexColor(hex, '#7db7ee').replace('#', '');
  return [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255,
  ];
}

class PlanetApproachLevelWebGPU extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas    = null;
    this._backend   = null;
    this._sceneData = null;

    // Runtime GPU state (null until initialize() succeeds with real WebGPU)
    this._device    = null;
    this._context   = null;
    this._pipeline  = null;
    this._rotation  = 0;          // radians accumulated per-frame
    this._visualPalette = {
      base: [0.2, 0.45, 0.8],
      atmo: [0.55, 0.75, 1.0],
      clear: [0.0, 0.0, 0.02],
    };
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          this._device = await adapter.requestDevice();
          this._context = canvas.getContext('webgpu');
          if (this._context && this._device) {
            await this._buildPipeline();
          }
        }
      } catch (_) {
        // Headless / CI — fall through gracefully.
      }
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    this._applySceneDataVisuals(data);
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    if (!this._device || !this._context || !this._pipeline) return;
    this._rotation += (dt > 1 ? dt / 1000 : dt) * 0.05; // slow rotation
    this._drawFrame(cameraState);
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._rotation = 0;
    this._applySceneDataVisuals(transitionPayload || this._sceneData || null);
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Nothing to do — resources stay alive for re-entry.
  }

  dispose() {
    this._pipeline = null;
    if (this._device) {
      // GPUDevice.destroy() is available in modern WebGPU.
      try { this._device.destroy(); } catch (_) {}
      this._device = null;
    }
    this._context = null;
    this._canvas  = null;
    this._backend = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _buildPipeline() {
    if (!this._device) return;

    const base = this._visualPalette.base.map((value) => Number(value).toFixed(4));
    const atmo = this._visualPalette.atmo.map((value) => Number(value).toFixed(4));

    const shaderCode = /* wgsl */`
      struct Uniforms {
        rotation : f32,
        time     : f32,
        pad0     : f32,
        pad1     : f32,
      };
      @group(0) @binding(0) var<uniform> u : Uniforms;

      struct VSOut {
        @builtin(position) pos   : vec4<f32>,
        @location(0)       norm  : vec3<f32>,
        @location(1)       uv    : vec2<f32>,
      };

      // Icosahedron-less quick sphere: latitude/longitude grid, 64 segments.
      // Vertex index encodes (lat, lon) packed as a single u32.
      @vertex
      fn vs_main(@builtin(vertex_index) idx : u32) -> VSOut {
        let segments : u32 = 64u;
        let lat_idx  = idx / (segments + 1u);
        let lon_idx  = idx % (segments + 1u);
        let pi       = 3.14159265358979323846;
        let lat      = (f32(lat_idx) / f32(segments)) * pi - pi * 0.5;
        let lon      = (f32(lon_idx) / f32(segments)) * 2.0 * pi + u.rotation;
        let cosLat   = cos(lat);
        let x        = cosLat * cos(lon);
        let y        = sin(lat);
        let z        = cosLat * sin(lon);
        var out      : VSOut;
        out.pos      = vec4<f32>(x * 0.6, y * 0.6, z * 0.6 - 2.0, 1.0);
        out.norm     = vec3<f32>(x, y, z);
        out.uv       = vec2<f32>(f32(lon_idx) / f32(segments), f32(lat_idx) / f32(segments));
        return out;
      }

      @fragment
      fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
        // Fresnel atmosphere rim-lighting + procedural surface texturing
        fn hash2(p : vec2<f32>) -> f32 {
          return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
        }

        fn noise2(p : vec2<f32>) -> f32 {
          let i = floor(p);
          let f = fract(p);
          let a = hash2(i);
          let b = hash2(i + vec2<f32>(1.0, 0.0));
          let c = hash2(i + vec2<f32>(0.0, 1.0));
          let d = hash2(i + vec2<f32>(1.0, 1.0));
          let u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        fn fbm(p : vec2<f32>) -> f32 {
          var value = 0.0;
          var amp = 0.5;
          var freq = 1.0;
          for (var i = 0; i < 4; i = i + 1) {
            value = value + amp * noise2(p * freq);
            freq = freq * 2.03;
            amp = amp * 0.5;
          }
          return value;
        }

        let view_dir = normalize(vec3<f32>(0.0, 0.0, 1.0));
        let fresnel  = pow(1.0 - abs(dot(in.norm, view_dir)), 3.0);
        let base_col = vec3<f32>(${base[0]}, ${base[1]}, ${base[2]});
        let atmo_col = vec3<f32>(${atmo[0]}, ${atmo[1]}, ${atmo[2]});

        // UV-driven macro/micro detail to avoid flat-color planets.
        let uvLarge = vec2<f32>(in.uv.x * 8.0 + u.rotation * 0.08, in.uv.y * 4.0 + u.time * 0.012);
        let uvFine = vec2<f32>(in.uv.x * 22.0 - u.rotation * 0.03, in.uv.y * 12.0 - u.time * 0.009);
        let terrain = fbm(uvLarge);
        let micro = fbm(uvFine);
        let bands = 0.5 + 0.5 * sin(in.uv.y * 18.0 + terrain * 4.5);
        let craterMask = smoothstep(0.80, 0.97, fbm(uvFine * 1.7 + vec2<f32>(3.1, 9.7)));
        let cloudMask = smoothstep(0.62, 0.90, fbm(uvLarge * 1.2 + vec2<f32>(0.0, u.time * 0.02)));

        var surface = mix(base_col * 0.70, base_col * 1.18, terrain);
        surface = mix(surface, atmo_col * 0.92, bands * 0.22);
        surface = mix(surface, surface * 0.66, craterMask * 0.30);
        surface = surface + vec3<f32>(micro * 0.05);

        let clouds = vec3<f32>(1.0, 1.0, 1.0) * cloudMask * 0.12;
        let lit = surface + clouds;
        let col = mix(lit, atmo_col, fresnel * 0.8);
        return vec4<f32>(col, 1.0);
      }
    `;

    const module = this._device.createShaderModule({ code: shaderCode });
    const format = navigator.gpu.getPreferredCanvasFormat
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'bgra8unorm';

    this._pipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex:   { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });
  }

  _drawFrame(cameraState) { // eslint-disable-line no-unused-vars
    if (!this._device || !this._context || !this._pipeline) return;
    try {
      const encoder = this._device.createCommandEncoder();
      const view    = this._context.getCurrentTexture().createView();
      const pass    = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: this._visualPalette.clear[0], g: this._visualPalette.clear[1], b: this._visualPalette.clear[2], a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      pass.setPipeline(this._pipeline);
      // 65×65 grid = 4225 vertices in triangle-strip
      pass.draw(65 * 65, 1, 0, 0);
      pass.end();
      this._device.queue.submit([encoder.finish()]);
    } catch (_) {}
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    return data.focusPlanet || data.planet || data.colony || data.target || data;
  }

  _applySceneDataVisuals(data) {
    const source = this._resolveVisualSource(data);
    const ownerColor = parseHexColor(
      source?.colony_owner_color || source?.owner_color || source?.faction_color || '',
      '#7db7ee'
    );
    const isOwned = !!String(source?.colony_owner_color || source?.owner_color || source?.faction_color || '').trim();
    const isPlayer = Number(source?.colony_is_player || source?.is_player || 0) === 1;
    const base = hexToRgbFloat(isOwned ? ownerColor : '#3373cc');
    const atmo = hexToRgbFloat(isPlayer ? '#7dffb2' : (isOwned ? ownerColor : '#8cc4ff'));
    this._visualPalette = {
      base,
      atmo,
      clear: isOwned ? [0.02, 0.04, 0.07] : [0.0, 0.0, 0.02],
    };
    if (this._device && this._context) {
      this._buildPipeline().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlanetApproachLevelWebGPU };
} else {
  window.GQPlanetApproachLevelWebGPU = { PlanetApproachLevelWebGPU };
}
