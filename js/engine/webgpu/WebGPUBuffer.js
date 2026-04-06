/**
 * WebGPUBuffer.js
 *
 * GPU Buffer abstraction — Vertex, Index, Uniform and Storage buffers.
 *
 * Inspiration:
 *   - WebGPU Samples (Apache 2.0): createBuffer helpers
 *     https://github.com/webgpu/webgpu-samples
 *   - Babylon.js (Apache 2.0): WebGPUDataBuffer
 *     https://github.com/BabylonJS/Babylon.js
 *   - Three.js (MIT): WebGPUBuffer internal
 *     https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

/** Supported buffer roles. */
const BufferType = Object.freeze({
  VERTEX:  'vertex',
  INDEX:   'index',
  UNIFORM: 'uniform',
  STORAGE: 'storage',
});

/** Supported update frequencies. */
const BufferUsage = Object.freeze({
  STATIC:  'static',
  DYNAMIC: 'dynamic',
  STREAM:  'stream',
});

class WebGPUBuffer {
  /**
   * @param {GPUDevice}   device
   * @param {BufferType}  type
   * @param {BufferSource|number} dataOrSize — initial data or byte size
   * @param {BufferUsage} usage
   */
  constructor(device, type, dataOrSize, usage = BufferUsage.STATIC) {
    this._device = device;
    this.type  = type;
    this.usage = usage;

    const isSize = typeof dataOrSize === 'number';
    const size   = isSize ? _align4(dataOrSize) : _align4(dataOrSize.byteLength ?? dataOrSize.length * 4);

    const gpuUsage = _gpuUsage(type, usage);

    if (isSize) {
      this._buffer = device.createBuffer({ size, usage: gpuUsage });
    } else {
      this._buffer = device.createBuffer({ size, usage: gpuUsage, mappedAtCreation: true });
      new Uint8Array(this._buffer.getMappedRange()).set(_toU8(dataOrSize));
      this._buffer.unmap();
    }

    this.size = size;
  }

  /** @returns {GPUBuffer} */
  get gpuBuffer() { return this._buffer; }

  /**
   * Upload new data.  Only valid for DYNAMIC / STREAM buffers.
   * @param {BufferSource} data
   * @param {number} [byteOffset]
   */
  update(data, byteOffset = 0) {
    this._device.queue.writeBuffer(this._buffer, byteOffset, _toU8(data));
  }

  /**
   * Asynchronously read back the entire buffer contents to a CPU ArrayBuffer.
   * The buffer must have COPY_SRC usage (DYNAMIC/STREAM buffers automatically
   * include it; STORAGE buffers always include it).
   *
   * @returns {Promise<ArrayBuffer>}
   */
  async readback() {
    // Staging buffer: MAP_READ | COPY_DST
    const staging = this._device.createBuffer({
      size:  this.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this._device.createCommandEncoder();
    encoder.copyBufferToBuffer(this._buffer, 0, staging, 0, this.size);
    this._device.queue.submit([encoder.finish()]);

    await staging.mapAsync(GPUMapMode.READ);
    const result = staging.getMappedRange(0, this.size).slice(0);
    staging.unmap();
    staging.destroy();
    return result;
  }

  destroy() {
    this._buffer.destroy();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _align4(n) { return (n + 3) & ~3; }

function _toU8(src) {
  if (src instanceof Uint8Array) return src;
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  return new Uint8Array(src);
}

function _gpuUsage(type, usage) {
  const base = {
    [BufferType.VERTEX]:  GPUBufferUsage.VERTEX  | GPUBufferUsage.COPY_DST,
    [BufferType.INDEX]:   GPUBufferUsage.INDEX   | GPUBufferUsage.COPY_DST,
    [BufferType.UNIFORM]: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    [BufferType.STORAGE]: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  }[type] ?? GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;

  if (usage === BufferUsage.DYNAMIC || usage === BufferUsage.STREAM) {
    return base | GPUBufferUsage.COPY_SRC;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUBuffer, BufferType, BufferUsage };
} else {
  window.GQWebGPUBuffer = { WebGPUBuffer, BufferType, BufferUsage };
}
