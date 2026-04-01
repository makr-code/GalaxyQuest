/**
 * ColonySurfaceLevelWebGPU.js
 *
 * IZoomLevelRenderer — Colony Surface zoom level (Level 3), WebGPU backend.
 *
 * Uses the instanced rendering shaders defined in COLONY_BUILDING_WEBGPU_DESIGN.md:
 *   • building_grid.wgsl  — ground tile grid
 *   • building_mesh.wgsl  — building mesh instances (64 bytes/slot)
 *
 * In headless / test environments (no navigator.gpu) all GPU calls are
 * guarded and become safe no-ops so the orchestrator tests pass without
 * a real GPU context.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

/** Instance buffer layout: 64 bytes = 16 × f32 per slot (see COLONY_BUILDING_WEBGPU_DESIGN.md) */
const BYTES_PER_SLOT = 64;

class ColonySurfaceLevelWebGPU extends IZoomLevelRenderer {
  constructor() {
    super();
    this._canvas         = null;
    this._backend        = null;
    this._sceneData      = null;
    this._device         = null;
    this._context        = null;
    this._gridPipeline   = null;
    this._meshPipeline   = null;
    this._instanceBuffer = null;
    this._slotCount      = 0;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) {
          this._device  = await adapter.requestDevice();
          this._context = canvas.getContext('webgpu');
          if (this._device && this._context) {
            await this._buildPipelines();
          }
        }
      } catch (_) { /* headless / CI */ }
    }
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (data && Array.isArray(data.slots)) {
      this._uploadSlots(data.slots);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    if (!this._device || !this._context) return;
    this._drawFrame();
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    // Colony data injected via setSceneData prior to enter().
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Resources kept alive for re-entry.
  }

  dispose() {
    if (this._instanceBuffer) {
      try { this._instanceBuffer.destroy(); } catch (_) {}
      this._instanceBuffer = null;
    }
    this._gridPipeline = null;
    this._meshPipeline = null;
    if (this._device) {
      try { this._device.destroy(); } catch (_) {}
      this._device = null;
    }
    this._context = null;
    this._canvas  = null;
    this._backend = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async _buildPipelines() {
    if (!this._device) return;

    // building_grid.wgsl — ground tile full-screen pass (simplified inline).
    const gridShader = this._device.createShaderModule({
      label: 'building_grid',
      code: /* wgsl */`
        @vertex
        fn vs_main(@builtin(vertex_index) idx : u32) -> @builtin(position) vec4<f32> {
          var pos = array<vec2<f32>, 6>(
            vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
            vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
          );
          return vec4<f32>(pos[idx], 0.5, 1.0);
        }
        @fragment
        fn fs_main() -> @location(0) vec4<f32> {
          return vec4<f32>(0.08, 0.09, 0.07, 1.0);  // dark ground
        }
      `,
    });

    const format = (navigator.gpu && navigator.gpu.getPreferredCanvasFormat)
      ? navigator.gpu.getPreferredCanvasFormat()
      : 'bgra8unorm';

    this._gridPipeline = this._device.createRenderPipeline({
      layout:   'auto',
      vertex:   { module: gridShader, entryPoint: 'vs_main' },
      fragment: { module: gridShader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    // building_mesh.wgsl — instanced building pass (simplified inline).
    const meshShader = this._device.createShaderModule({
      label: 'building_mesh',
      code: /* wgsl */`
        struct Instance {
          // 16 × f32 = 64 bytes per slot
          col0 : vec4<f32>,
          col1 : vec4<f32>,
          col2 : vec4<f32>,
          col3 : vec4<f32>,
        };
        @group(0) @binding(0) var<storage, read> instances : array<Instance>;

        struct VSOut {
          @builtin(position) pos : vec4<f32>,
          @location(0) col       : vec4<f32>,
        };

        @vertex
        fn vs_main(
          @builtin(vertex_index)   vidx : u32,
          @builtin(instance_index) iidx : u32,
        ) -> VSOut {
          let inst = instances[iidx];
          // Simple unit-cube vertices offset by col3 (translation column)
          var cubeVerts = array<vec3<f32>, 8>(
            vec3<f32>(-0.5, 0.0, -0.5), vec3<f32>( 0.5, 0.0, -0.5),
            vec3<f32>( 0.5, 0.0,  0.5), vec3<f32>(-0.5, 0.0,  0.5),
            vec3<f32>(-0.5, 1.0, -0.5), vec3<f32>( 0.5, 1.0, -0.5),
            vec3<f32>( 0.5, 1.0,  0.5), vec3<f32>(-0.5, 1.0,  0.5),
          );
          let v   = cubeVerts[vidx % 8u];
          let wp  = v + vec3<f32>(inst.col3.x, inst.col3.y, inst.col3.z);
          var out : VSOut;
          out.pos = vec4<f32>(wp.x * 0.05, wp.y * 0.05, 0.5, 1.0);
          out.col = inst.col0;
          return out;
        }

        @fragment
        fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
          return in.col;
        }
      `,
    });

    this._meshPipeline = this._device.createRenderPipeline({
      layout:   'auto',
      vertex:   { module: meshShader, entryPoint: 'vs_main' },
      fragment: { module: meshShader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }

  _uploadSlots(slots) {
    if (!this._device) return;
    const count  = slots.length;
    const size   = count * BYTES_PER_SLOT;
    if (size === 0) return;

    if (this._instanceBuffer) {
      try { this._instanceBuffer.destroy(); } catch (_) {}
    }
    this._instanceBuffer = this._device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Pack slot data: each slot contributes 16 f32 values.
    const data = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      const s = slots[i] || {};
      const base = i * 16;
      // col0 = RGBA color or building type encoded as float
      data[base + 0] = Number(s.r || 0.6);
      data[base + 1] = Number(s.g || 0.6);
      data[base + 2] = Number(s.b || 0.6);
      data[base + 3] = 1.0;
      // col1–col2 = rotation matrix rows (identity by default)
      data[base + 4] = 1; data[base + 5] = 0; data[base + 6] = 0; data[base + 7] = 0;
      data[base + 8] = 0; data[base + 9] = 1; data[base +10] = 0; data[base +11] = 0;
      // col3 = translation
      data[base +12] = Number(s.x || 0);
      data[base +13] = 0;
      data[base +14] = Number(s.z || 0);
      data[base +15] = 1;
    }
    this._device.queue.writeBuffer(this._instanceBuffer, 0, data.buffer, 0, data.byteLength);
    this._slotCount = count;
  }

  _drawFrame() {
    if (!this._device || !this._context || !this._gridPipeline) return;
    try {
      const encoder = this._device.createCommandEncoder();
      const view    = this._context.getCurrentTexture().createView();
      const pass    = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.05, g: 0.06, b: 0.04, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      // Ground grid pass
      pass.setPipeline(this._gridPipeline);
      pass.draw(6, 1, 0, 0);
      // Building instances pass
      if (this._meshPipeline && this._slotCount > 0) {
        pass.setPipeline(this._meshPipeline);
        pass.draw(8, this._slotCount, 0, 0);
      }
      pass.end();
      this._device.queue.submit([encoder.finish()]);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColonySurfaceLevelWebGPU };
} else {
  window.GQColonySurfaceLevelWebGPU = { ColonySurfaceLevelWebGPU };
}
