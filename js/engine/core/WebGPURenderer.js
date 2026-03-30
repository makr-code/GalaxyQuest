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

const { IGraphicsRenderer } = typeof require !== 'undefined'
  ? require('./GraphicsContext.js')
  : window.GQGraphicsContext;

class WebGPURenderer extends IGraphicsRenderer {
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

  render(scene, camera) {
    if (!this.ready || !this.device || !this.context) return;

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const passDescriptor = {
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.02, g: 0.04, b: 0.1, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };

    const pass = commandEncoder.beginRenderPass(passDescriptor);
    // Phase 1+: iterate scene objects and issue draw calls
    pass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  resize(width, height) {
    if (!this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  dispose() {
    this._buffers.forEach((b) => b.destroy());
    this._buffers.clear();
    this._textures.forEach((t) => t.destroy());
    this._textures.clear();
    this._shaders.clear();
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
    this.ready = false;
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

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPURenderer };
} else {
  window.GQWebGPURenderer = WebGPURenderer;
}
