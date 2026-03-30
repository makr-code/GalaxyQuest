/**
 * WebGPURenderPass.js
 *
 * Render Pass Encoder — wraps GPURenderPassEncoder lifecycle.
 *
 * Inspiration:
 *   - WebGPU Samples (Apache 2.0): render pass patterns
 *     https://github.com/webgpu/webgpu-samples
 *   - Babylon.js (Apache 2.0): WebGPURenderTargetWrapper
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WebGPURenderPass {
  /**
   * @param {GPUDevice}        device
   * @param {GPUTextureView}   colorView
   * @param {GPUTextureView}   [depthView]
   * @param {{ r,g,b,a }}      [clearColor]
   */
  constructor(device, colorView, depthView = null, clearColor = { r: 0.02, g: 0.04, b: 0.10, a: 1.0 }) {
    this._device     = device;
    this._colorView  = colorView;
    this._depthView  = depthView;
    this._clearColor = clearColor;
    /** @type {GPUCommandEncoder|null} */
    this._encoder = null;
    /** @type {GPURenderPassEncoder|null} */
    this._pass = null;
  }

  /** Begin the render pass. Must be paired with end(). */
  begin() {
    this._encoder = this._device.createCommandEncoder();

    const colorAttachments = [{
      view:       this._colorView,
      clearValue: this._clearColor,
      loadOp:     'clear',
      storeOp:    'store',
    }];

    const descriptor = { colorAttachments };

    if (this._depthView) {
      descriptor.depthStencilAttachment = {
        view:              this._depthView,
        depthClearValue:   1.0,
        depthLoadOp:       'clear',
        depthStoreOp:      'store',
      };
    }

    this._pass = this._encoder.beginRenderPass(descriptor);
    return this._pass;
  }

  /** @returns {GPURenderPassEncoder} */
  get encoder() { return this._pass; }

  /**
   * Draw a mesh using its uploaded GPU buffers and a compiled pipeline.
   *
   * Expects:
   *   geometry._gpuBuffers.positions — GPUBuffer (slot 0)
   *   geometry._gpuBuffers.normals   — GPUBuffer (slot 1, optional)
   *   geometry._gpuBuffers.uvs       — GPUBuffer (slot 2, optional)
   *   geometry._gpuBuffers.indices   — GPUBuffer (optional; falls back to draw())
   *   material._pipeline             — GPURenderPipeline
   *
   * @param {import('../scene/Geometry.js').Geometry} geometry
   * @param {import('../scene/Material.js').Material} material
   */
  drawMesh(geometry, material) {
    if (!this._pass) return;
    const pipeline = material._pipeline;
    if (!pipeline) return;

    this._pass.setPipeline(pipeline);

    const bufs = geometry._gpuBuffers ?? {};
    if (bufs.positions) this._pass.setVertexBuffer(0, bufs.positions);
    if (bufs.normals)   this._pass.setVertexBuffer(1, bufs.normals);
    if (bufs.uvs)       this._pass.setVertexBuffer(2, bufs.uvs);

    if (bufs.indices) {
      const fmt = geometry.indices instanceof Uint32Array ? 'uint32' : 'uint16';
      this._pass.setIndexBuffer(bufs.indices, fmt);
      this._pass.drawIndexed(geometry.indices.length);
    } else if (geometry.positions) {
      this._pass.draw(geometry.positions.length / 3);
    }
  }

  /** End the render pass and submit to the GPU queue. */
  end() {
    if (!this._pass || !this._encoder) return;
    this._pass.end();
    this._device.queue.submit([this._encoder.finish()]);
    this._pass    = null;
    this._encoder = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPURenderPass };
} else {
  window.GQWebGPURenderPass = WebGPURenderPass;
}
