/**
 * WebGPUCapabilities.js
 *
 * Device capability detection — probes adapter features and limits to
 * enable/disable render paths at startup.
 *
 * Inspired by Three.js WebGLCapabilities (MIT) and
 * Babylon.js WebGPUEngine.initializeLimits (Apache 2.0)
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WebGPUCapabilities {
  /**
   * @param {GPUAdapter} adapter
   * @param {GPUDevice}  device
   */
  constructor(adapter, device) {
    this.adapter = adapter;
    this.device  = device;

    // Feature flags
    this.computeShaders      = true; // always available in WebGPU
    this.float32Filterable   = adapter.features.has('float32-filterable');
    this.depth32Stencil8     = adapter.features.has('depth32float-stencil8');
    this.indirectFirstInstance = adapter.features.has('indirect-first-instance');
    this.timestampQuery      = adapter.features.has('timestamp-query');
    this.clipDistances       = adapter.features.has('clip-distances');

    // Limits
    this.maxTextureSize      = device.limits.maxTextureDimension2D;
    this.maxBindGroups       = device.limits.maxBindGroups;
    this.maxUniformBufSize   = device.limits.maxUniformBufferBindingSize;
    this.maxStorageBufSize   = device.limits.maxStorageBufferBindingSize;
    this.maxComputeWorkgroupSizeX = device.limits.maxComputeWorkgroupSizeX;
    this.maxComputeInvocations    = device.limits.maxComputeInvocationsPerWorkgroup;

    // Derived quality tiers
    this.tier = this._computeTier();
  }

  _computeTier() {
    if (this.maxTextureSize >= 8192 && this.float32Filterable) return 'high';
    if (this.maxTextureSize >= 4096)                           return 'medium';
    return 'low';
  }

  /** Human-readable summary for logging. */
  toString() {
    return [
      `[WebGPUCapabilities] tier=${this.tier}`,
      `maxTex=${this.maxTextureSize}`,
      `float32Filterable=${this.float32Filterable}`,
      `computeShaders=${this.computeShaders}`,
      `timestampQuery=${this.timestampQuery}`,
    ].join(' | ');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUCapabilities };
} else {
  window.GQWebGPUCapabilities = WebGPUCapabilities;
}
