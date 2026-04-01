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

  /**
   * Generate all mip levels for this texture using a blit-chain render pass.
   *
   * The texture must have been created with mipMaps=true (which sets
   * mipLevelCount>1 and adds COPY_SRC | RENDER_ATTACHMENT usage).
   *
   * The WGSL blit shader samples mip N and writes to mip N+1 via a
   * fullscreen triangle draw.  This matches the approach used by
   * Babylon.js WebGPUTextureManager.generateMipmaps (Apache 2.0).
   */
  generateMipmaps() {
    if (this.isCubemap) {
      for (let layer = 0; layer < 6; layer++) {
        this._generateMipmapForLayer(layer);
      }
    } else {
      this._generateMipmapForLayer(0);
    }
  }

  _generateMipmapForLayer(layer) {
    const device = this._device;
    const mipCount = this._texture.mipLevelCount ?? 1;
    if (mipCount <= 1) return;

    // Lazily build the mip-gen pipeline once per device.
    // Store on the device object to share across textures.
    if (!device.__gqMipPipeline) {
      device.__gqMipPipeline = _buildMipGenPipeline(device);
    }
    const { pipeline, sampler } = device.__gqMipPipeline;

    for (let srcMip = 0; srcMip < mipCount - 1; srcMip++) {
      const srcView = this._texture.createView({
        dimension: '2d',
        baseMipLevel: srcMip,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      });
      const dstView = this._texture.createView({
        dimension: '2d',
        baseMipLevel: srcMip + 1,
        mipLevelCount: 1,
        baseArrayLayer: layer,
        arrayLayerCount: 1,
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: srcView },
        ],
      });

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: dstView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3); // fullscreen triangle
      pass.end();
      device.queue.submit([encoder.finish()]);
    }
  }

  destroy() {
    this._texture.destroy();
  }
}

// ---------------------------------------------------------------------------
// Mip-gen pipeline builder
// ---------------------------------------------------------------------------

const MIP_GEN_WGSL = /* wgsl */`
  @group(0) @binding(0) var uSampler  : sampler;
  @group(0) @binding(1) var uTexture  : texture_2d<f32>;

  struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };

  @vertex
  fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
    let uv = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    var out: VSOut;
    out.pos = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv  = vec2<f32>(uv.x, 1.0 - uv.y);
    return out;
  }

  @fragment
  fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    return textureSample(uTexture, uSampler, in.uv);
  }
`;

function _buildMipGenPipeline(device) {
  const shader = device.createShaderModule({ code: MIP_GEN_WGSL, label: 'gq:mipgen' });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: shader, entryPoint: 'vs_main' },
    fragment: {
      module: shader,
      entryPoint: 'fs_main',
      targets: [{ format: 'rgba8unorm' }],
    },
    primitive: { topology: 'triangle-list' },
  });
  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  return { pipeline, sampler };
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
