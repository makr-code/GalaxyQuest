/**
 * WebGPUShader.js
 *
 * WGSL Shader compilation + pipeline caching.
 *
 * Supports:
 *   - Render pipelines (vertex + fragment)
 *   - Compute pipelines
 *   - Auto compilation error reporting
 *
 * Inspiration:
 *   - Babylon.js (Apache 2.0): WebGPUShaderProcessor / WebGPUPipelineContext
 *     https://github.com/BabylonJS/Babylon.js
 *   - WebGPU Samples (Apache 2.0): shader module creation patterns
 *     https://github.com/webgpu/webgpu-samples
 *   - Three.js (MIT): WebGPUProgrammableStage
 *     https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/**
 * Module-level shader-module cache.
 * WeakMap<GPUDevice, Map<string, GPUShaderModule>> keeps per-device caches
 * and allows the device to be GC'd when no longer referenced.
 *
 * @type {WeakMap<object, Map<string, GPUShaderModule>>}
 */
const _shaderModuleCache = new WeakMap();

class WebGPUShader {
  /**
   * @param {GPUDevice} device
   */
  constructor(device) {
    this._device = device;
    /** @type {Map<string, GPURenderPipeline>} */
    this._renderPipelines = new Map();
    /** @type {Map<string, GPUComputePipeline>} */
    this._computePipelines = new Map();
  }

  // ---------------------------------------------------------------------------
  // Shader module compilation with cache
  // ---------------------------------------------------------------------------

  /**
   * Compile a WGSL source string into a GPUShaderModule, returning the cached
   * module if the same source has already been compiled on this device.
   *
   * @param {GPUDevice} device
   * @param {string}    wgslSource
   * @returns {GPUShaderModule}
   */
  static compile(device, wgslSource) {
    if (!_shaderModuleCache.has(device)) {
      _shaderModuleCache.set(device, new Map());
    }
    const deviceCache = _shaderModuleCache.get(device);
    const key = _hashSrc(wgslSource);
    if (deviceCache.has(key)) return deviceCache.get(key);

    const module = device.createShaderModule({ code: wgslSource, label: `gq:${key}` });
    deviceCache.set(key, module);
    return module;
  }

  // ---------------------------------------------------------------------------
  // Render pipeline
  // ---------------------------------------------------------------------------

  /**
   * Compile a WGSL render pipeline (vertex + fragment).
   *
   * @param {Object} spec
   * @param {string} spec.vertexSrc      WGSL vertex shader source
   * @param {string} spec.fragmentSrc    WGSL fragment shader source
   * @param {GPUVertexBufferLayout[]} [spec.bufferLayouts]
   * @param {GPUTextureFormat}        [spec.targetFormat]
   * @param {boolean}                 [spec.depthTest]
   * @param {GPUBlendState}           [spec.blend]
   * @param {string}                  [spec.cacheKey]
   * @returns {GPURenderPipeline}
   */
  compileRenderPipeline(spec) {
    const { vertexSrc, fragmentSrc, bufferLayouts = [], targetFormat = 'bgra8unorm',
            depthTest = true, blend, cacheKey } = spec;

    const key = cacheKey ?? _hashSrc(vertexSrc + fragmentSrc);
    if (this._renderPipelines.has(key)) return this._renderPipelines.get(key);

    const vs = this._device.createShaderModule({ code: vertexSrc,   label: `vs:${key}` });
    const fs = this._device.createShaderModule({ code: fragmentSrc, label: `fs:${key}` });

    const descriptor = {
      vertex: {
        module: vs,
        entryPoint: 'vs_main',
        buffers: bufferLayouts,
      },
      fragment: {
        module: fs,
        entryPoint: 'fs_main',
        targets: [{ format: targetFormat, blend: blend ?? _defaultBlend() }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    };

    if (depthTest) {
      descriptor.depthStencil = {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      };
    }

    const pipeline = this._device.createRenderPipeline({ layout: 'auto', ...descriptor });
    this._renderPipelines.set(key, pipeline);
    return pipeline;
  }

  // ---------------------------------------------------------------------------
  // Compute pipeline
  // ---------------------------------------------------------------------------

  /**
   * Compile a WGSL compute pipeline.
   *
   * @param {string} computeSrc  WGSL compute shader source
   * @param {string} [cacheKey]
   * @returns {GPUComputePipeline}
   */
  compileComputePipeline(computeSrc, cacheKey) {
    const key = cacheKey ?? _hashSrc(computeSrc);
    if (this._computePipelines.has(key)) return this._computePipelines.get(key);

    const module   = this._device.createShaderModule({ code: computeSrc, label: `cs:${key}` });
    const pipeline = this._device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'cs_main' },
    });

    this._computePipelines.set(key, pipeline);
    return pipeline;
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose() {
    this._renderPipelines.clear();
    this._computePipelines.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _defaultBlend() {
  return {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
  };
}

/** Tiny djb2-style hash for stable cache keys. */
function _hashSrc(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUShader };
} else {
  window.GQWebGPUShader = WebGPUShader;
}
