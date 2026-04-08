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

const WebGPUDeviceCtor = typeof require !== 'undefined'
  ? require('../webgpu/WebGPUDevice.js').WebGPUDevice
  : (window.GQWebGPUDevice && window.GQWebGPUDevice.WebGPUDevice) || null;

const WebGPUBufferCtor = typeof require !== 'undefined'
  ? require('../webgpu/WebGPUBuffer.js').WebGPUBuffer
  : (window.GQWebGPUBuffer && window.GQWebGPUBuffer.WebGPUBuffer) || null;

const WebGPUTextureCtor = typeof require !== 'undefined'
  ? require('../webgpu/WebGPUTexture.js').WebGPUTexture
  : window.GQWebGPUTexture || null;

class WebGPURenderer extends BaseGraphicsRenderer {
  constructor() {
    super();
    /** @type {WebGPUDevice|null} */
    this._gpuDevice = null;
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

    /**
     * Called when the device is permanently lost (all reconnect attempts
     * exhausted).  Receives the GPUDeviceLostInfo reason string.
     * @type {((reason: string) => void)|null}
     */
    this.onLost = null;
  }

  // ---------------------------------------------------------------------------
  // IGraphicsRenderer implementation
  // ---------------------------------------------------------------------------

  async initialize(canvas) {
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported in this browser');
    }
    if (!WebGPUDeviceCtor) {
      throw new Error('WebGPU device helper is not available');
    }

    this.canvas = canvas;

    // 1. Acquire adapter + device via WebGPUDevice (handles exponential-backoff
    //    reconnect on unexpected device loss).
    this._gpuDevice = new WebGPUDeviceCtor();
    await this._gpuDevice.request({
      powerPreference: 'high-performance',
      onDeviceLost: () => {
        this.ready  = false;
        this.device = null;
      },
      onReconnect: (newDevice) => {
        this.device  = newDevice;
        this.adapter = this._gpuDevice.adapter;
        this._configureContext();
        this._createDepthBuffer(this.canvas.width || 300, this.canvas.height || 150);
        this._shaderMgr?.dispose();
        this._shaderMgr = new WebGPUShaderCtor(newDevice);
        this.ready = true;
        console.info('[WebGPURenderer] Device successfully restored.');
      },
      onLost: (reason) => {
        console.error('[WebGPURenderer] Max reconnect attempts reached — giving up.');
        if (typeof this.onLost === 'function') this.onLost(reason ?? 'unknown');
      },
    });

    this.adapter = this._gpuDevice.adapter;
    this.device  = this._gpuDevice.device;

    // 2. Configure canvas context
    this.context = canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('Could not acquire WebGPU canvas context');
    }

    this.preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    this._configureContext();

    this.ready = true;
    if (typeof window !== 'undefined' && window.GQLog?.info) {
      window.GQLog.info('[WebGPURenderer] Initialised — adapter:', this.adapter.info?.description ?? 'unknown');
    }

    // 3. Depth buffer (depth24plus) sized to canvas
    this._createDepthBuffer(canvas.width || 300, canvas.height || 150);

    // 4. Shader pipeline manager
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
    return new WebGPUBufferCtor(this.device, type, data, usage).gpuBuffer;
  }

  /**
   * @param {{ width: number, height: number, format?: GPUTextureFormat,
   *            mipMaps?: boolean, renderTarget?: boolean }} spec
   */
  createTexture(spec) {
    if (!this.device) throw new Error('WebGPURenderer not initialised');
    return new WebGPUTextureCtor(this.device, spec);
  }

  /**
   * @param {string} vertexSrc   WGSL source
   * @param {string} fragmentSrc WGSL source
   */
  createShader(vertexSrc, fragmentSrc) {
    if (!this.device) throw new Error('WebGPURenderer not initialised');
    const vs = WebGPUShaderCtor.compile(this.device, vertexSrc);
    const fs = WebGPUShaderCtor.compile(this.device, fragmentSrc);
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

  // ---------------------------------------------------------------------------
  // Phase 2+ — compute dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a compute shader described by a ComputePass.
   * Pipeline compilation is delegated to `_shaderMgr.compileComputePipeline()`
   * which deduplicates by content hash across all passes.
   *
   * @param {import('../post-effects/passes/ComputePass').ComputePass} computePass
   */
  dispatchCompute(computePass) {
    if (!this.ready || !this.device || !this._shaderMgr) return;
    if (!computePass.shaderSrc) return;

    const pipeline = this._shaderMgr.compileComputePipeline(computePass.shaderSrc);

    const encoder = this.device.createCommandEncoder({ label: `gq-compute-enc:${computePass.label}` });
    const pass    = encoder.beginComputePass({ label: `gq-compute-pass:${computePass.label}` });
    pass.setPipeline(pipeline);

    for (const [index, bg] of computePass._bindGroups) {
      pass.setBindGroup(index, bg);
    }

    pass.dispatchWorkgroups(
      computePass.workgroupsX,
      computePass.workgroupsY,
      computePass.workgroupsZ,
    );
    pass.end();
    this.device.queue.submit([encoder.finish()]);
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
    if (this._gpuDevice) {
      this._gpuDevice.destroy();
      this._gpuDevice = null;
    } else if (this.device) {
      // Fallback for manually constructed instances (e.g. in tests) where
      // _gpuDevice was never created.
      this.device.destroy();
    }
    this.device  = null;
    this.adapter = null;
    this.ready   = false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * (Re-)apply the canvas context configuration to the current device.
   * Called once during initialisation and again after every device reconnect.
   * @private
   */
  _configureContext() {
    if (!this.context || !this.device) return;
    this.context.configure({
      device:    this.device,
      format:    this.preferredFormat,
      alphaMode: 'premultiplied',
    });
  }

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
