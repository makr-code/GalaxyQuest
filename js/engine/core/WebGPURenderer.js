/**
 * WebGPURenderer.js
 *
 * Primary WebGPU Renderer — implements IGraphicsRenderer for WebGPU.
 *
 * Phase 0: Skeleton + device initialisation.
 * Phase 1+: Full buffer/texture/shader/render-pass implementation.
 *
 * Inspiration:
 *   - WebGPU Samples (Apache 2.0): Device init, swap-chain setup
 *     https://github.com/webgpu/webgpu-samples
 *   - Babylon.js (Apache 2.0): WebGPUEngine device management
 *     https://github.com/BabylonJS/Babylon.js
 *   - Three.js (MIT): WebGPURenderer (r157+)
 *     https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IGraphicsRenderer: BaseGraphicsRenderer } = typeof require !== 'undefined'
  ? require('./GraphicsContext.js')
  : window.GQGraphicsContext;

const WebGPURenderPassCtor = typeof require !== 'undefined'
  ? require('../webgpu/WebGPURenderPass.js').WebGPURenderPass
  : window.GQWebGPURenderPass;

const WebGPUShaderCtor = typeof require !== 'undefined'
  ? require('../webgpu/WebGPUShader.js').WebGPUShader
  : window.GQWebGPUShader;

class WebGPURenderer extends BaseGraphicsRenderer {
  constructor() {
    super();
    /** @type {GPUAdapter|null} */
    this.adapter = null;
    /** @type {GPUDevice|null} */
    this.device = null;
    /** @type {GPUCanvasContext|null} */
    this.context = null;
    /** @type {GPUTextureFormat} */
    this.preferredFormat = 'bgra8unorm';
    /** @type {HTMLCanvasElement|null} */
    this.canvas = null;
    /** @type {boolean} */
    this.ready = false;
    /** @type {Map<string,GPUBuffer>} */
    this._buffers = new Map();
    /** @type {Map<string,GPUTexture>} */
    this._textures = new Map();
    /** @type {Map<string,GPUShaderModule>} */
    this._shaders = new Map();
    /** @type {GPUTexture|null} */
    this._depthTexture = null;
    /** @type {WebGPUShader|null} */
    this._shaderMgr = null;
    /** @type {WebGPURenderPass|null} */
    this._framePass = null;
  }

  // ---------------------------------------------------------------------------
  // IGraphicsRenderer implementation
  // ---------------------------------------------------------------------------

  async initialize(canvas) {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported in this browser');
    }

    this.canvas = canvas;

    // 1. Request adapter (prefer high-performance discrete GPU if available)
    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    if (!this.adapter) {
      throw new Error('No WebGPU adapter found');
    }

    // 2. Request device with required features
    const requiredFeatures = [];
    if (this.adapter.features.has('depth32float-stencil8')) {
      requiredFeatures.push('depth32float-stencil8');
    }

    this.device = await this.adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxTextureDimension2D: Math.min(
          8192,
          this.adapter.limits.maxTextureDimension2D
        ),
      },
    });

    // 3. Handle device loss gracefully (pattern from WebGPU Samples)
    this.device.lost.then((info) => {
      if (info.reason !== 'destroyed') {
        console.warn('[WebGPURenderer] Device lost:', info.message, '— attempting reinit');
        this.ready = false;
        this.initialize(canvas).catch(console.error);
      }
    });

    // 4. Configure canvas context
    this.context = canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('Could not acquire WebGPU canvas context');
    }

    this.preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.preferredFormat,
      alphaMode: 'premultiplied',
    });

    this.ready = true;
    if (typeof window !== 'undefined' && window.GQLog?.info) {
      window.GQLog.info('[WebGPURenderer] Initialised — adapter:', this.adapter.info?.description ?? 'unknown');
    }

    // 5. Depth buffer (depth24plus) sized to canvas
    this._createDepthBuffer(canvas.width || 300, canvas.height || 150);

    // 6. Shader pipeline manager
    this._shaderMgr = new WebGPUShaderCtor(this.device);
  }

  getCapabilities() {
    if (!this.adapter || !this.device) {
      return {
        webgpu: false, webgl2: false, computeShaders: false,
        float32Textures: false, depthTextures: false,
        maxTextureSize: 0, maxAnisotropy: 1,
      };
    }
    return {
      webgpu: true,
      webgl2: false,
      computeShaders: true,
      float32Textures: this.adapter.features.has('float32-filterable'),
      depthTextures: true,
      maxTextureSize: this.device.limits.maxTextureDimension2D,
      maxAnisotropy: 16,
    };
  }

  /**
   * @param {'vertex'|'index'|'uniform'|'storage'} type
   * @param {BufferSource} data
   * @param {'static'|'dynamic'|'stream'} usage
   */
  createBuffer(type, data, usage = 'static') {
    if (!this.device) throw new Error('WebGPURenderer not initialised');

    const usageFlags = _bufferUsageFlags(type, usage);
    const size = _alignTo4(data.byteLength || data.length * 4);

    const buffer = this.device.createBuffer({
      size,
      usage: usageFlags | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });

    const dst = new Uint8Array(buffer.getMappedRange());
    dst.set(new Uint8Array(data.buffer ?? data));
    buffer.unmap();

    return buffer;
  }

  /**
   * @param {{ width: number, height: number, format?: GPUTextureFormat,
   *            mipMaps?: boolean, renderTarget?: boolean }} spec
   */
  createTexture(spec) {
    if (!this.device) throw new Error('WebGPURenderer not initialised');

    const { width, height, format = 'rgba8unorm', mipMaps = false, renderTarget = false } = spec;
    const mipLevelCount = mipMaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      | (renderTarget ? GPUTextureUsage.RENDER_ATTACHMENT : 0);

    return this.device.createTexture({ size: [width, height], format, mipLevelCount, usage });
  }

  /**
   * @param {string} vertexSrc   WGSL source
   * @param {string} fragmentSrc WGSL source
   */
  createShader(vertexSrc, fragmentSrc) {
    if (!this.device) throw new Error('WebGPURenderer not initialised');

    const vs = this.device.createShaderModule({ code: vertexSrc });
    const fs = this.device.createShaderModule({ code: fragmentSrc });
    return { vs, fs };
  }

  createRenderPass(config = {}) {
    if (!this.device) throw new Error('WebGPURenderer not initialised');
    // Returns a descriptor; actual encoder is created per-frame in render()
    return { ...config, _type: 'webgpu-render-pass' };
  }

  // ---------------------------------------------------------------------------
  // Phase 2 — render pipeline + depth buffer
  // ---------------------------------------------------------------------------

  /**
   * Build (and cache) a GPURenderPipeline for the given Material.
   * The result is stored in `material._pipeline` so subsequent frames reuse it.
   *
   * @param {import('../scene/Material.js').Material} material
   * @returns {GPURenderPipeline}
   */
  createRenderPipeline(material) {
    if (!this.device || !this._shaderMgr) throw new Error('WebGPURenderer not initialised');

    material._pipeline = this._shaderMgr.compileRenderPipeline({
      vertexSrc:     material.vertexSrc,
      fragmentSrc:   material.fragmentSrc,
      bufferLayouts: _defaultVertexBufferLayouts(),
      targetFormat:  this.preferredFormat,
      depthTest:     material.depthTest ?? true,
      cacheKey:      material.vertexSrc + '|' + material.fragmentSrc,
    });

    material.needsUpdate = false;
    return material._pipeline;
  }

  /**
   * Upload a Geometry's CPU-side arrays to GPU buffers.
   * Buffers are stored on `geometry._gpuBuffers` and reused on subsequent calls.
   *
   * @param {import('../scene/Geometry.js').Geometry} geometry
   */
  uploadMesh(geometry) {
    if (!this.device) throw new Error('WebGPURenderer not initialised');

    const bufs = geometry._gpuBuffers;
    if (geometry.positions && !bufs.positions) {
      bufs.positions = this.createBuffer('vertex', geometry.positions);
    }
    if (geometry.normals && !bufs.normals) {
      bufs.normals = this.createBuffer('vertex', geometry.normals);
    }
    if (geometry.uvs && !bufs.uvs) {
      bufs.uvs = this.createBuffer('vertex', geometry.uvs);
    }
    if (geometry.indices && !bufs.indices) {
      bufs.indices = this.createBuffer('index', geometry.indices);
    }
  }

  /**
   * Begin a new GPU frame.  Creates a WebGPURenderPass backed by the current
   * swap-chain texture and the depth buffer.
   *
   * Must be paired with endFrame().
   *
   * @returns {WebGPURenderPass|null}
   */
  beginFrame() {
    if (!this.ready || !this.device || !this.context) return null;

    const colorView = this.context.getCurrentTexture().createView();
    const depthView = this._depthTexture ? this._depthTexture.createView() : null;

    this._framePass = new WebGPURenderPassCtor(this.device, colorView, depthView);
    this._framePass.begin();
    return this._framePass;
  }

  /**
   * End the active GPU frame and submit all commands to the device queue.
   */
  endFrame() {
    if (!this._framePass) return;
    this._framePass.end();
    this._framePass = null;
  }

  render(scene, camera) {
    if (!this.ready || !this.device || !this.context) return;

    const pass = this.beginFrame();
    if (!pass) return;

    const nodes = scene?.update ? scene.update() : [];
    for (const node of nodes) {
      const { geometry, material } = node.data ?? {};
      if (!geometry || !material) continue;

      if (!geometry._gpuBuffers?.positions) this.uploadMesh(geometry);
      if (!material._pipeline || material.needsUpdate) this.createRenderPipeline(material);

      pass.drawMesh(geometry, material);
    }

    this.endFrame();
  }

  resize(width, height) {
    if (!this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.ready && this.device) {
      this._createDepthBuffer(width, height);
    }
  }

  dispose() {
    this._buffers.forEach((b) => b.destroy());
    this._buffers.clear();
    this._textures.forEach((t) => t.destroy());
    this._textures.clear();
    this._shaders.clear();
    if (this._depthTexture) {
      this._depthTexture.destroy();
      this._depthTexture = null;
    }
    if (this._shaderMgr) {
      this._shaderMgr.dispose();
      this._shaderMgr = null;
    }
    this._framePass = null;
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.ready = false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * (Re-)create the depth buffer sized to the canvas.  Called during
   * initialisation and whenever the canvas is resized.
   *
   * @param {number} width
   * @param {number} height
   */
  _createDepthBuffer(width, height) {
    if (this._depthTexture) {
      this._depthTexture.destroy();
      this._depthTexture = null;
    }
    this._depthTexture = this.device.createTexture({
      size:   [Math.max(1, width), Math.max(1, height), 1],
      format: 'depth24plus',
      usage:  GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _alignTo4(n) { return (n + 3) & ~3; }

function _bufferUsageFlags(type, usage) {
  const base = {
    vertex:  GPUBufferUsage.VERTEX,
    index:   GPUBufferUsage.INDEX,
    uniform: GPUBufferUsage.UNIFORM,
    storage: GPUBufferUsage.STORAGE,
  }[type] ?? GPUBufferUsage.VERTEX;

  // dynamic/stream buffers additionally get MAP_WRITE so they can be updated
  if (usage === 'dynamic' || usage === 'stream') {
    return base | GPUBufferUsage.COPY_SRC;
  }
  return base;
}

/**
 * Standard GQ vertex buffer layout — three separate slots for positions,
 * normals, and UVs, matching the attributes in built-in WGSL shaders.
 */
function _defaultVertexBufferLayouts() {
  return [
    // slot 0: positions (vec3<f32>)
    { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
    // slot 1: normals (vec3<f32>)
    { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
    // slot 2: UVs (vec2<f32>)
    { arrayStride:  8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
  ];
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPURenderer };
} else {
  window.GQWebGPURenderer = WebGPURenderer;
}
