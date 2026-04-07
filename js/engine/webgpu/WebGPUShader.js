/**
 * WebGPUShader.js
 *
 * WGSL Shader compilation + pipeline caching.
 *
 * Supports:
 *   - Render pipelines (vertex + fragment)
 *   - Compute pipelines
 *   - Auto compilation error reporting via EventBus
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

/** EventBus event name emitted when a shader has compilation errors. */
const SHADER_ERROR_EVENT = 'webgpu:shader-error';

class WebGPUShader {
  /**
   * @param {GPUDevice} device
   * @param {import('../EventBus').EventBus} [eventBus]  Optional bus for error events.
   */
  constructor(device, eventBus) {
    this._device    = device;
    this._eventBus  = eventBus ?? null;
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
   * If the module has compilation errors, a `webgpu:shader-error` event is
   * emitted on the shared EventBus (when provided).
   *
   * @param {GPUDevice} device
   * @param {string}    wgslSource
   * @param {import('../EventBus').EventBus} [eventBus]
   * @returns {GPUShaderModule}
   */
  static compile(device, wgslSource, eventBus) {
    if (!_shaderModuleCache.has(device)) {
      _shaderModuleCache.set(device, new Map());
    }
    const deviceCache = _shaderModuleCache.get(device);
    const key = _hashSrc(wgslSource);
    if (deviceCache.has(key)) return deviceCache.get(key);

    const module = device.createShaderModule({ code: wgslSource, label: `gq:${key}` });
    deviceCache.set(key, module);

    // Asynchronously check for compilation errors and report them.
    _checkShaderErrors(module, key, eventBus ?? null);

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

    _checkShaderErrors(vs, `vs:${key}`, this._eventBus);
    _checkShaderErrors(fs, `fs:${key}`, this._eventBus);

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
    _checkShaderErrors(module, `cs:${key}`, this._eventBus);

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

/**
 * Asynchronously retrieve shader compilation info and emit an error event
 * when errors or warnings are present.
 *
 * @param {GPUShaderModule}                 module
 * @param {string}                          label
 * @param {import('../EventBus').EventBus|null} eventBus
 * @private
 */
function _checkShaderErrors(module, label, eventBus) {
  if (typeof module.getCompilationInfo !== 'function') return;

  module.getCompilationInfo().then((info) => {
    const errors   = info.messages.filter((m) => m.type === 'error');
    const warnings = info.messages.filter((m) => m.type === 'warning');

    if (errors.length > 0 || warnings.length > 0) {
      const payload = {
        label,
        errors:   errors.map((m) => ({ line: m.lineNum, message: m.message })),
        warnings: warnings.map((m) => ({ line: m.lineNum, message: m.message })),
      };

      // Always log to console so errors are visible in DevTools.
      if (errors.length > 0) {
        console.error(`[WebGPUShader] Compilation errors in shader '${label}':`, payload.errors);
      } else {
        console.warn(`[WebGPUShader] Compilation warnings in shader '${label}':`, payload.warnings);
      }

      // Emit structured event when a bus is available.
      if (eventBus && typeof eventBus.emit === 'function') {
        eventBus.emit(SHADER_ERROR_EVENT, payload);
      }

      // Also dispatch a DOM CustomEvent so non-engine listeners can catch it.
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(SHADER_ERROR_EVENT, { detail: payload }));
      }
    }
  }).catch(() => {
    // getCompilationInfo() may not be supported everywhere; fail silently.
  });
}

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
  module.exports = { WebGPUShader, SHADER_ERROR_EVENT };
} else {
  window.GQWebGPUShader = WebGPUShader;
  window.GQWebGPUShaderErrorEvent = SHADER_ERROR_EVENT;
}
