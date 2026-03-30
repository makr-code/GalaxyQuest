/**
 * WebGPUDevice.js
 *
 * GPU Device & Queue management — wraps GPUAdapter / GPUDevice lifecycle.
 *
 * Inspiration:
 *   - WebGPU Samples (Apache 2.0): requestWebGPU helper
 *     https://github.com/webgpu/webgpu-samples
 *   - Babylon.js (Apache 2.0): WebGPUEngine._initializeContextAsync
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WebGPUDevice {
  constructor() {
    /** @type {GPUAdapter|null} */
    this.adapter = null;
    /** @type {GPUDevice|null} */
    this.device = null;
    /** @type {GPUQueue|null} */
    this.queue = null;
  }

  /**
   * @param {{ powerPreference?: GPUPowerPreference }} [opts]
   * @returns {Promise<void>}
   */
  async request(opts = {}) {
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    this.adapter = await navigator.gpu.requestAdapter({
      powerPreference: opts.powerPreference ?? 'high-performance',
    });
    if (!this.adapter) throw new Error('No WebGPU adapter available');

    const features = /** @type {GPUFeatureName[]} */ ([]);
    for (const f of ['depth32float-stencil8', 'float32-filterable', 'indirect-first-instance']) {
      if (this.adapter.features.has(f)) features.push(f);
    }

    this.device = await this.adapter.requestDevice({ requiredFeatures: features });
    this.queue  = this.device.queue;

    this.device.lost.then((info) => {
      console.warn('[WebGPUDevice] device lost:', info.reason, info.message);
      this.device = null;
      this.queue  = null;
    });
  }

  /** Write raw data into an existing GPUBuffer at byte offset. */
  writeBuffer(buffer, data, byteOffset = 0) {
    this.queue?.writeBuffer(buffer, byteOffset, data);
  }

  /** Write an ImageBitmap / HTMLCanvasElement into a GPUTexture. */
  writeTexture(texture, source, width, height) {
    this.queue?.copyExternalImageToTexture(
      { source },
      { texture },
      [width, height],
    );
  }

  destroy() {
    this.device?.destroy();
    this.device = null;
    this.queue  = null;
    this.adapter = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUDevice };
} else {
  window.GQWebGPUDevice = WebGPUDevice;
}
