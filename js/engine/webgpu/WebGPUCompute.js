/**
 * WebGPUCompute.js
 *
 * Compute Shader support — dispatch compute passes for NPC AI, particle
 * simulation and post-processing workloads.
 *
 * Phase 5+: NPC pathfinding and fleet decision offloading.
 *
 * Inspiration:
 *   - WebGPU Samples (Apache 2.0): compute shader examples
 *     https://github.com/webgpu/webgpu-samples
 *   - Babylon.js (Apache 2.0): ComputeShader class
 *     https://github.com/BabylonJS/Babylon.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WebGPUCompute {
  /**
   * @param {GPUDevice}          device
   * @param {GPUComputePipeline} pipeline
   */
  constructor(device, pipeline) {
    this._device   = device;
    this._pipeline = pipeline;
    /** @type {Map<number, GPUBindGroup>} */
    this._bindGroups = new Map();
  }

  /**
   * Register a bind group for a specific group index.
   * @param {number}            groupIndex
   * @param {GPUBindGroupEntry[]} entries
   */
  setBindGroup(groupIndex, entries) {
    const layout = this._pipeline.getBindGroupLayout(groupIndex);
    this._bindGroups.set(groupIndex, this._device.createBindGroup({ layout, entries }));
  }

  /**
   * Dispatch the compute shader.
   *
   * @param {number} workgroupsX
   * @param {number} [workgroupsY=1]
   * @param {number} [workgroupsZ=1]
   */
  dispatch(workgroupsX, workgroupsY = 1, workgroupsZ = 1) {
    const encoder   = this._device.createCommandEncoder();
    const pass      = encoder.beginComputePass();

    pass.setPipeline(this._pipeline);
    for (const [index, bg] of this._bindGroups) {
      pass.setBindGroup(index, bg);
    }

    pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    pass.end();

    this._device.queue.submit([encoder.finish()]);
  }

  /**
   * Read back a storage buffer asynchronously (zero-copy transfer pattern).
   * @param {GPUBuffer} srcBuffer
   * @param {number}    byteSize
   * @returns {Promise<ArrayBuffer>}
   */
  async readback(srcBuffer, byteSize) {
    const stagingBuffer = this._device.createBuffer({
      size:  byteSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const encoder = this._device.createCommandEncoder();
    encoder.copyBufferToBuffer(srcBuffer, 0, stagingBuffer, 0, byteSize);
    this._device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const result = stagingBuffer.getMappedRange().slice(0);
    stagingBuffer.unmap();
    stagingBuffer.destroy();
    return result;
  }

  dispose() {
    this._bindGroups.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUCompute };
} else {
  window.GQWebGPUCompute = WebGPUCompute;
}
