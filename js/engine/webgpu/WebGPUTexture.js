/**
 * WebGPUTexture.js
 *
 * Texture management — 2D, 3D, Cubemap and renderable textures.
 *
 * Inspiration:
 *   - Three.js (MIT): WebGPUTextureUtils
 *     https://github.com/mrdoob/three.js
 *   - Babylon.js (Apache 2.0): WebGPUTextureManager
 *     https://github.com/BabylonJS/Babylon.js
 *   - WebGPU Samples (Apache 2.0): texture loading patterns
 *     https://github.com/webgpu/webgpu-samples
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class WebGPUTexture {
  /**
   * @param {GPUDevice} device
   * @param {Object}    spec
   * @param {number}    spec.width
   * @param {number}    spec.height
   * @param {number}    [spec.depth=1]
   * @param {GPUTextureFormat} [spec.format='rgba8unorm']
   * @param {boolean}   [spec.mipMaps=false]
   * @param {boolean}   [spec.renderTarget=false]
   * @param {boolean}   [spec.cubemap=false]
   * @param {string}    [spec.label]
   */
  constructor(device, spec) {
    this._device = device;

    const {
      width, height, depth = 1,
      format = 'rgba8unorm',
      mipMaps = false,
      renderTarget = false,
      cubemap = false,
      label = 'gq-texture',
    } = spec;

    this.width  = width;
    this.height = height;
    this.depth  = cubemap ? 6 : depth;
    this.format = format;
    this.isCubemap = cubemap;

    const mipLevelCount = mipMaps
      ? Math.floor(Math.log2(Math.max(width, height))) + 1
      : 1;

    let usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    if (renderTarget) usage |= GPUTextureUsage.RENDER_ATTACHMENT;
    if (mipMaps)      usage |= GPUTextureUsage.COPY_SRC; // for mip generation

    this._texture = device.createTexture({
      label,
      size: [width, height, this.depth],
      dimension: depth > 1 && !cubemap ? '3d' : '2d',
      format,
      mipLevelCount,
      usage,
    });

    this._sampler = device.createSampler({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter:    'linear',
      minFilter:    'linear',
      mipmapFilter: mipMaps ? 'linear' : 'nearest',
      maxAnisotropy: mipMaps ? 4 : 1,
    });
  }

  /** @returns {GPUTexture} */
  get gpuTexture() { return this._texture; }

  /** @returns {GPUSampler} */
  get sampler() { return this._sampler; }

  /** @returns {GPUTextureView} */
  createView(opts = {}) {
    if (this.isCubemap) {
      return this._texture.createView({ dimension: 'cube', ...opts });
    }
    return this._texture.createView(opts);
  }

  /**
   * Upload an ImageBitmap or HTMLCanvasElement as the texture content.
   * @param {ImageBitmap|HTMLCanvasElement} source
   * @param {number} [layer=0]
   */
  uploadImage(source, layer = 0) {
    this._device.queue.copyExternalImageToTexture(
      { source, flipY: false },
      { texture: this._texture, origin: [0, 0, layer] },
      [this.width, this.height],
    );
  }

  /**
   * Upload raw typed array as texture data.
   * @param {TypedArray} data
   * @param {number} [layer=0]
   */
  uploadData(data, layer = 0) {
    const bytesPerPixel = _formatBytes(this.format);
    this._device.queue.writeTexture(
      { texture: this._texture, origin: [0, 0, layer] },
      data,
      { bytesPerRow: this.width * bytesPerPixel, rowsPerImage: this.height },
      [this.width, this.height, 1],
    );
  }

  destroy() {
    this._texture.destroy();
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function _formatBytes(fmt) {
  if (fmt.startsWith('rgba16') || fmt.startsWith('rg32'))  return 8;
  if (fmt.startsWith('rgba32'))                            return 16;
  if (fmt.startsWith('rg16')   || fmt.startsWith('r32'))  return 4;
  if (fmt.startsWith('r16')    || fmt.startsWith('rg8'))   return 2;
  if (fmt.startsWith('r8'))                                return 1;
  return 4; // default: rgba8
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WebGPUTexture };
} else {
  window.GQWebGPUTexture = WebGPUTexture;
}
