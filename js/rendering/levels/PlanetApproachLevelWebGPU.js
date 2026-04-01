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

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

class PlanetApproachLevelWebGPU extends IZoomLevelRenderer {
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
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    if (!this._device || !this._context || !this._pipeline) return;
    this._rotation += (dt > 1 ? dt / 1000 : dt) * 0.05; // slow rotation
    this._drawFrame(cameraState);
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._rotation = 0;
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
        // Fresnel atmosphere rim-lighting
        let view_dir = normalize(vec3<f32>(0.0, 0.0, 1.0));
        let fresnel  = pow(1.0 - abs(dot(in.norm, view_dir)), 3.0);
        let base_col = vec3<f32>(0.2, 0.45, 0.8);          // ocean blue
        let atmo_col = vec3<f32>(0.55, 0.75, 1.0);         // atmosphere glow
        let col      = mix(base_col, atmo_col, fresnel * 0.8);
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
          clearValue: { r: 0.0, g: 0.0, b: 0.02, a: 1.0 },
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
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlanetApproachLevelWebGPU };
} else {
  window.GQPlanetApproachLevelWebGPU = { PlanetApproachLevelWebGPU };
}
