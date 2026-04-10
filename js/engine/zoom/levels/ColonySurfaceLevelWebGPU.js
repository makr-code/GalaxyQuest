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

/** Instance buffer layout: 64 bytes = 16 × f32 per slot (see COLONY_BUILDING_WEBGPU_DESIGN.md) */
const BYTES_PER_SLOT = 64;

class ColonySurfaceLevelWebGPU extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas         = null;
    this._backend        = null;
    this._sceneData      = null;
    this._device         = null;
    this._context        = null;
    this._gridPipeline   = null;
    this._meshPipeline   = null;
    this._vfxPipeline    = null;
    this._instanceBuffer = null;
    this._instanceBindGroup = null;
    this._buildingVfxBuffer = null;
    this._buildingVfxVertexCount = 0;
    this._buildingVfxParticles = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
    this._slotCount      = 0;
    this._visualPalette  = {
      owner: [0.49, 0.72, 0.93],
      clear: [0.05, 0.06, 0.04],
    };
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const isWindows = String(navigator.userAgent || '').toLowerCase().includes('windows');
        const adapterOptions = isWindows ? undefined : { powerPreference: 'high-performance' };
        const adapter = await navigator.gpu.requestAdapter(adapterOptions);
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
    this._applySceneDataVisuals(data);
    if (data && Array.isArray(data.slots)) {
      this._uploadSlots(data.slots);
      this._rebuildBuildingVfx(data.slots);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    if (!this._device || !this._context) return;
    this._updateBuildingVfxBuffer(Number(dt) || 0.016);
    this._drawFrame();
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._applySceneDataVisuals(transitionPayload || this._sceneData || null);
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
    if (this._buildingVfxBuffer) {
      try { this._buildingVfxBuffer.destroy(); } catch (_) {}
      this._buildingVfxBuffer = null;
    }
    this._gridPipeline = null;
    this._meshPipeline = null;
    this._vfxPipeline = null;
    this._instanceBindGroup = null;
    this._buildingVfxVertexCount = 0;
    this._buildingVfxParticles = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
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

    const vfxShader = this._device.createShaderModule({
      label: 'building_vfx',
      code: /* wgsl */`
        struct VSOut {
          @builtin(position) pos : vec4<f32>,
          @location(0) col       : vec4<f32>,
        };

        @vertex
        fn vs_main(
          @location(0) inPos : vec2<f32>,
          @location(1) inCol : vec4<f32>
        ) -> VSOut {
          var out : VSOut;
          out.pos = vec4<f32>(inPos, 0.45, 1.0);
          out.col = inCol;
          return out;
        }

        @fragment
        fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
          return in.col;
        }
      `,
    });

    this._vfxPipeline = this._device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: vfxShader,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x4' },
          ],
        }],
      },
      fragment: { module: vfxShader, entryPoint: 'fs_main', targets: [{ format, blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } }] },
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
      const slotColor = hexToRgbFloat(s.owner_color || s.colony_owner_color || s.faction_color || '');
      const tint = slotColor.some((value) => value > 0)
        ? slotColor
        : this._visualPalette.owner;
      // col0 = RGBA color or building type encoded as float
      data[base + 0] = Number(s.r ?? tint[0] ?? 0.6);
      data[base + 1] = Number(s.g ?? tint[1] ?? 0.6);
      data[base + 2] = Number(s.b ?? tint[2] ?? 0.6);
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
    if (this._meshPipeline && this._instanceBuffer) {
      try {
        this._instanceBindGroup = this._device.createBindGroup({
          layout: this._meshPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: this._instanceBuffer } }],
        });
      } catch (_) {
        this._instanceBindGroup = null;
      }
    }
    this._slotCount = count;
  }

  _resolveBuildingVfxQuality(slotCount) {
    const requested = String(this._sceneData?.vfx_quality || this._sceneData?.quality || '').toLowerCase();
    if (requested === 'low' || requested === 'medium' || requested === 'high') return requested;
    if (slotCount > 280) return 'low';
    if (slotCount > 120) return 'medium';
    return 'high';
  }

  _slotKey(slot, index) {
    const sx = Number(slot?.x || 0).toFixed(2);
    const sz = Number(slot?.z || 0).toFixed(2);
    const type = String(slot?.type || slot?.building_type || slot?.category || 'generic');
    return `${index}:${sx}:${sz}:${type}`;
  }

  _ingestUpgradeTransitions(slots) {
    const source = Array.isArray(slots) ? slots : [];
    const next = new Map();
    let detectedTransition = false;
    for (let i = 0; i < source.length; i += 1) {
      const slot = source[i] || {};
      const key = this._slotKey(slot, i);
      const active = !!slot?.upgrade_end;
      next.set(key, active);
      const previous = this._slotUpgradeState.get(key);
      if (typeof previous === 'boolean' && previous !== active) {
        detectedTransition = true;
      }
    }
    this._slotUpgradeState = next;
    if (detectedTransition) {
      this._buildingVfxBurstUntil = Math.max(this._buildingVfxBurstUntil, this._buildingVfxTime + 1.6);
    }
  }

  _slotVfxProfile(slot) {
    const explicitProfile = String(slot?.vfx_profile || slot?.fx_profile || '').toLowerCase();
    const explicitIntensity = Math.max(0.4, Math.min(2.2, Number(slot?.vfx_intensity || slot?.fx_intensity || 1) || 1));
    if (explicitProfile) {
      if (explicitProfile === 'construction' || explicitProfile === 'upgrade') {
        return { profileName: 'construction', particleMul: 1.35 * explicitIntensity, sizeMul: 1.12, opacityAdd: 0.12, driftMul: 1.25, tint: [1.0, 0.70, 0.42] };
      }
      if (explicitProfile === 'industry' || explicitProfile === 'smelter' || explicitProfile === 'refinery') {
        return { profileName: 'industry', particleMul: 1.2 * explicitIntensity, sizeMul: 1.06, opacityAdd: 0.08, driftMul: 1.16, tint: [1.0, 0.79, 0.47] };
      }
      if (explicitProfile === 'power' || explicitProfile === 'reactor') {
        return { profileName: 'power', particleMul: 1.05 * explicitIntensity, sizeMul: 1.0, opacityAdd: 0.06, driftMul: 1.08, tint: [0.54, 0.84, 1.0] };
      }
      if (explicitProfile === 'research' || explicitProfile === 'science') {
        return { profileName: 'research', particleMul: 0.95 * explicitIntensity, sizeMul: 0.92, opacityAdd: 0.05, driftMul: 0.92, tint: [0.62, 0.82, 1.0] };
      }
      if (explicitProfile === 'quiet' || explicitProfile === 'minimal') {
        return { profileName: 'quiet', particleMul: 0.6 * explicitIntensity, sizeMul: 0.82, opacityAdd: -0.05, driftMul: 0.7, tint: null };
      }
    }

    const text = [
      slot?.type,
      slot?.building_type,
      slot?.category,
      slot?.state,
      slot?.status,
      slot?.activity,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    const busy = !!slot?.upgrade_end
      || /construction|building|upgrade|running|queued|active/.test(text);
    const industrial = /mine|factory|refinery|smelter|forge|industry/.test(text);
    const research = /lab|research|science/.test(text);
    const power = /power|reactor|fusion|energy/.test(text);

    if (busy) {
      return { profileName: 'construction', particleMul: 1.35 * explicitIntensity, sizeMul: 1.12, opacityAdd: 0.12, driftMul: 1.25, tint: [1.0, 0.70, 0.42] };
    }
    if (industrial) {
      return { profileName: 'industry', particleMul: 1.2 * explicitIntensity, sizeMul: 1.06, opacityAdd: 0.08, driftMul: 1.16, tint: [1.0, 0.79, 0.47] };
    }
    if (power) {
      return { profileName: 'power', particleMul: 1.05 * explicitIntensity, sizeMul: 1.0, opacityAdd: 0.06, driftMul: 1.08, tint: [0.54, 0.84, 1.0] };
    }
    if (research) {
      return { profileName: 'research', particleMul: 0.95 * explicitIntensity, sizeMul: 0.92, opacityAdd: 0.05, driftMul: 0.92, tint: [0.62, 0.82, 1.0] };
    }
    return { profileName: 'auto', particleMul: 1 * explicitIntensity, sizeMul: 1, opacityAdd: 0, driftMul: 1, tint: null };
  }

  _rebuildBuildingVfx(slots) {
    const source = Array.isArray(slots) ? slots : [];
    this._ingestUpgradeTransitions(source);
    this._buildingVfxParticles = [];
    this._buildingVfxVertexCount = 0;
    if (!source.length) return;

    const quality = this._resolveBuildingVfxQuality(source.length);
    const qualityMap = {
      low: { emitters: 10, particlesPerEmitter: 8, size: 0.11, opacity: 0.16 },
      medium: { emitters: 20, particlesPerEmitter: 10, size: 0.12, opacity: 0.2 },
      high: { emitters: 36, particlesPerEmitter: 14, size: 0.14, opacity: 0.24 },
    };
    const cfg = qualityMap[quality] || qualityMap.medium;
    const profileCounts = {};
    const maxParticles = 900;
    const maxEmittersByCap = Math.max(1, Math.floor(maxParticles / Math.max(1, cfg.particlesPerEmitter)));
    const emitterCount = Math.min(source.length, cfg.emitters, maxEmittersByCap);
    const stride = Math.max(1, Math.floor(source.length / emitterCount));
    let remainingParticles = maxParticles;

    for (let e = 0; e < emitterCount; e += 1) {
      if (remainingParticles <= 0) break;
      const slot = source[Math.min(source.length - 1, e * stride)] || {};
      const profile = this._slotVfxProfile(slot);
      const profileName = String(profile.profileName || 'auto');
      profileCounts[profileName] = (profileCounts[profileName] || 0) + 1;
      const rgb = hexToRgbFloat(slot.owner_color || slot.colony_owner_color || slot.faction_color || '');
      const particleCount = Math.max(3, Math.min(remainingParticles, Math.round(cfg.particlesPerEmitter * profile.particleMul)));
      for (let i = 0; i < particleCount; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.1 + Math.random() * 0.85;
        const tint = profile.tint || rgb;
        this._buildingVfxParticles.push({
          x: Number(slot.x || 0) + Math.cos(angle) * radius,
          y: 0.6 + Math.random() * 1.7,
          z: Number(slot.z || 0) + Math.sin(angle) * radius,
          size: cfg.size * profile.sizeMul * (0.8 + Math.random() * 0.6),
          r: tint[0],
          g: tint[1],
          b: tint[2],
          baseOpacity: Math.max(0.05, Math.min(0.6, cfg.opacity + profile.opacityAdd)),
          pulsePhase: Math.random() * Math.PI * 2,
          drift: (0.14 + Math.random() * 0.22) * profile.driftMul,
        });
      }
      remainingParticles -= particleCount;
    }

    this._buildingVfxVertexCount = this._buildingVfxParticles.length * 6;
    this._ensureBuildingVfxBufferCapacity(this._buildingVfxVertexCount);
    this._buildingVfxStats = {
      backend: 'webgpu',
      quality,
      emitters: emitterCount,
      particles: this._buildingVfxParticles.length,
      profileCounts,
      burstActive: this._buildingVfxBurstUntil > this._buildingVfxTime,
    };
  }

  _ensureBuildingVfxBufferCapacity(vertexCount) {
    if (!this._device) return;
    const bytesNeeded = Math.max(0, Number(vertexCount || 0)) * 24;
    if (!bytesNeeded) return;
    const existing = this._buildingVfxBuffer?.size || 0;
    if (existing >= bytesNeeded) return;
    if (this._buildingVfxBuffer) {
      try { this._buildingVfxBuffer.destroy(); } catch (_) {}
      this._buildingVfxBuffer = null;
    }
    this._buildingVfxBuffer = this._device.createBuffer({
      size: bytesNeeded,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  _updateBuildingVfxBuffer(dt) {
    if (!this._device || !this._buildingVfxVertexCount || !this._buildingVfxBuffer) return;
    const particles = this._buildingVfxParticles;
    if (!particles.length) return;
    this._buildingVfxTime += Math.max(0, Number(dt) || 0.016);
    const t = this._buildingVfxTime;
    const burstT = this._buildingVfxBurstUntil > t
      ? Math.max(0, Math.min(1, (this._buildingVfxBurstUntil - t) / 1.6))
      : 0;
    const out = new Float32Array(this._buildingVfxVertexCount * 6);
    let vp = 0;
    particles.forEach((p, index) => {
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.15 + index * 0.001) + p.pulsePhase);
      const driftY = Math.sin(t * p.drift + p.pulsePhase) * 0.22;
      const cx = (p.x * 0.05);
      const cy = ((p.y + driftY + p.z * 0.02) * 0.05);
      const hs = Math.max(0.002, p.size * 0.05 * (1 + burstT * 0.18));
      const a = Math.max(0.05, Math.min(0.78, p.baseOpacity + pulse * 0.16 + burstT * 0.22));
      const verts = [
        [cx - hs, cy - hs], [cx + hs, cy - hs], [cx - hs, cy + hs],
        [cx - hs, cy + hs], [cx + hs, cy - hs], [cx + hs, cy + hs],
      ];
      for (let i = 0; i < 6; i += 1) {
        out[vp + 0] = verts[i][0];
        out[vp + 1] = verts[i][1];
        out[vp + 2] = p.r;
        out[vp + 3] = p.g;
        out[vp + 4] = p.b;
        out[vp + 5] = a;
        vp += 6;
      }
    });
    this._device.queue.writeBuffer(this._buildingVfxBuffer, 0, out.buffer, 0, out.byteLength);
    if (this._buildingVfxStats) {
      this._buildingVfxStats.burstActive = burstT > 0.001;
    }
    if (typeof window !== 'undefined') {
      window.__GQ_COLONY_VFX_STATS = Object.assign({}, this._buildingVfxStats || {}, {
        ts: Date.now(),
      });
    }
  }

  _drawFrame() {
    if (!this._device || !this._context || !this._gridPipeline) return;
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
      // Ground grid pass
      pass.setPipeline(this._gridPipeline);
      pass.draw(6, 1, 0, 0);
      // Building instances pass
      if (this._meshPipeline && this._slotCount > 0) {
        pass.setPipeline(this._meshPipeline);
        if (this._instanceBindGroup) {
          pass.setBindGroup(0, this._instanceBindGroup);
        }
        pass.draw(8, this._slotCount, 0, 0);
      }
      if (this._vfxPipeline && this._buildingVfxBuffer && this._buildingVfxVertexCount > 0) {
        pass.setPipeline(this._vfxPipeline);
        pass.setVertexBuffer(0, this._buildingVfxBuffer);
        pass.draw(this._buildingVfxVertexCount, 1, 0, 0);
      }
      pass.end();
      this._device.queue.submit([encoder.finish()]);
    } catch (_) {}
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.colony && typeof data.colony === 'object') return data.colony;
    if (Array.isArray(data.slots) && data.slots.length) return data.slots[0];
    return data;
  }

  _applySceneDataVisuals(data) {
    const source = this._resolveVisualSource(data);
    const ownerColor = parseHexColor(
      source?.colony_owner_color || source?.owner_color || source?.faction_color || '',
      '#7db7ee'
    );
    const isOwned = !!String(source?.colony_owner_color || source?.owner_color || source?.faction_color || '').trim();
    this._visualPalette = {
      owner: hexToRgbFloat(ownerColor),
      clear: isOwned ? [0.04, 0.07, 0.05] : [0.05, 0.06, 0.04],
    };
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
