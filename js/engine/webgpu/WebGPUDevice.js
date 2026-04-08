/**
 * WebGPUDevice.js
 *
 * GPU Device & Queue management — wraps GPUAdapter / GPUDevice lifecycle.
 * Includes device-loss detection and automatic reconnect with exponential
 * backoff (up to MAX_RECONNECT_ATTEMPTS retries).
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

/** Maximum automatic reconnect attempts after device loss. */
const MAX_RECONNECT_ATTEMPTS = 4;
/** Base backoff delay in ms — doubles each attempt. */
const RECONNECT_BACKOFF_BASE_MS = 500;

class WebGPUDevice {
  constructor() {
    /** @type {GPUAdapter|null} */
    this.adapter = null;
    /** @type {GPUDevice|null} */
    this.device = null;
    /** @type {GPUQueue|null} */
    this.queue = null;
    /** @type {Object} Options passed to request() — saved for reconnects. */
    this._requestOpts = {};
    /** @type {number} Consecutive reconnect attempts since last successful init. */
    this._reconnectAttempts = 0;
    /**
     * Callback invoked immediately when the device is unexpectedly lost
     * (before any reconnect attempt).  Not fired for intentional `destroy()`.
     * @type {((reason: string) => void)|null}
     */
    this.onDeviceLost = null;
    /**
     * Callback invoked after a successful reconnect.
     * @type {((device: GPUDevice) => void)|null}
     */
    this.onReconnect = null;
    /**
     * Callback invoked when the device is permanently lost
     * (exhausted all reconnect attempts).
     * @type {((reason: string) => void)|null}
     */
    this.onLost = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Request a new WebGPU adapter + device.
   *
   * @param {{ powerPreference?: GPUPowerPreference, onReconnect?: Function, onLost?: Function }} [opts]
   * @returns {Promise<void>}
   */
  async request(opts = {}) {
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    if (opts.onDeviceLost) this.onDeviceLost = opts.onDeviceLost;
    if (opts.onReconnect)  this.onReconnect  = opts.onReconnect;
    if (opts.onLost)       this.onLost       = opts.onLost;
    this._requestOpts = opts;

    await this._acquireDevice(opts.powerPreference ?? 'high-performance');
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

  /**
   * Asynchronously read back the entire contents of a GPU buffer to a CPU
   * ArrayBuffer.  The buffer must have GPUBufferUsage.COPY_SRC.
   *
   * @param {GPUBuffer} gpuBuffer
   * @param {number}    byteSize
   * @returns {Promise<ArrayBuffer>}
   */
  async readbackBuffer(gpuBuffer, byteSize) {
    if (!this.device) throw new Error('WebGPUDevice: no device available');

    // Staging buffer (MAP_READ + COPY_DST)
    const staging = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(gpuBuffer, 0, staging, 0, byteSize);
    this.device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const result = staging.getMappedRange(0, byteSize).slice(0);
    staging.unmap();
    staging.destroy();
    return result;
  }

  destroy() {
    this._reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // prevent further reconnects
    this.device?.destroy();
    this.device  = null;
    this.queue   = null;
    this.adapter = null;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  async _acquireDevice(powerPreference) {
    this.adapter = await navigator.gpu.requestAdapter({ powerPreference });
    if (!this.adapter) throw new Error('No WebGPU adapter available');

    const features = /** @type {GPUFeatureName[]} */ ([]);
    for (const f of ['depth32float-stencil8', 'float32-filterable', 'indirect-first-instance']) {
      if (this.adapter.features.has(f)) features.push(f);
    }

    this.device = await this.adapter.requestDevice({ requiredFeatures: features });
    this.queue  = this.device.queue;
    this._reconnectAttempts = 0;

    // Device-loss handler — attempt automatic reconnect
    this.device.lost.then((info) => this._handleDeviceLost(info));
  }

  _handleDeviceLost(info) {
    console.warn('[WebGPUDevice] device lost:', info.reason, info.message);
    this.device = null;
    this.queue  = null;

    if (info.reason === 'destroyed') {
      // Intentional destruction — do not reconnect.
      return;
    }

    // Notify the owner that the device was unexpectedly lost.
    if (typeof this.onDeviceLost === 'function') this.onDeviceLost(info.reason);

    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebGPUDevice] exceeded max reconnect attempts — WebGPU unavailable');
      if (typeof this.onLost === 'function') this.onLost(info.reason);
      return;
    }

    const delay = RECONNECT_BACKOFF_BASE_MS * Math.pow(2, this._reconnectAttempts);
    this._reconnectAttempts++;
    console.info(`[WebGPUDevice] reconnecting in ${delay}ms (attempt ${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    setTimeout(() => {
      const pp = this._requestOpts.powerPreference ?? 'high-performance';
      this._acquireDevice(pp)
        .then(() => {
          console.info('[WebGPUDevice] reconnected successfully');
          if (typeof this.onReconnect === 'function') this.onReconnect(this.device);
        })
        .catch((err) => {
          console.error('[WebGPUDevice] reconnect failed:', err.message);
          if (typeof this.onLost === 'function') this.onLost(err.message);
        });
    }, delay);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUDevice, MAX_RECONNECT_ATTEMPTS, RECONNECT_BACKOFF_BASE_MS };
} else {
  window.GQWebGPUDevice = { WebGPUDevice, MAX_RECONNECT_ATTEMPTS, RECONNECT_BACKOFF_BASE_MS };
}
