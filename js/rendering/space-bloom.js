const BLOOM_THRESHOLD = 0.72;
const BLOOM_STRENGTH = 0.48;
const BLOOM_SCALE = 0.5;

export class PerspectiveBloom {
  constructor() {
    this.sceneFormat = 'rgba16float';
    this.width = 0;
    this.height = 0;
    this.sceneTexture = null;
    this.brightTexture = null;
    this.blurTexture = null;
  }

  async initialize(device, outputFormat, bloomSource, compositeSource, sceneFormat = 'rgba16float') {
    this.device = device;
    this.sceneFormat = sceneFormat;
    const bloomShader = device.createShaderModule({ code: bloomSource, label: 'solar-bloom' });
    const compositeShader = device.createShaderModule({ code: compositeSource, label: 'solar-bloom-composite' });
    for (const shader of [bloomShader, compositeShader]) {
      if (!shader.getCompilationInfo) continue;
      const info = await shader.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length) throw new Error(`Bloom shader: ${errors.map((error) => error.message).join('; ')}`);
    }
    this.thresholdPipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: bloomShader, entryPoint: 'vs_main' },
      fragment: { module: bloomShader, entryPoint: 'fs_threshold', targets: [{ format: this.sceneFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    this.blurPipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: bloomShader, entryPoint: 'vs_main' },
      fragment: { module: bloomShader, entryPoint: 'fs_blur', targets: [{ format: this.sceneFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    this.compositePipeline = device.createRenderPipeline({
      layout: 'auto', vertex: { module: compositeShader, entryPoint: 'vs_main' },
      fragment: { module: compositeShader, entryPoint: 'fs_main', targets: [{ format: outputFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    this.thresholdBuffer = device.createBuffer({ size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurBuffer = device.createBuffer({ size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.blurVerticalBuffer = device.createBuffer({ size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.compositeBuffer = device.createBuffer({ size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.thresholdParams = new Float32Array([BLOOM_THRESHOLD, 1, 0, 0]);
    this.blurHorizontal = new Float32Array([BLOOM_THRESHOLD, 1, 1.4, 1]);
    this.blurVertical = new Float32Array([BLOOM_THRESHOLD, 1, 1.4, 0]);
    this.compositeParams = new Float32Array([BLOOM_STRENGTH, this.sceneFormat === 'rgba16float' ? 1 : 0, 0, 0]);
    device.queue.writeBuffer(this.thresholdBuffer, 0, this.thresholdParams);
    device.queue.writeBuffer(this.blurBuffer, 0, this.blurHorizontal);
    device.queue.writeBuffer(this.blurVerticalBuffer, 0, this.blurVertical);
    device.queue.writeBuffer(this.compositeBuffer, 0, this.compositeParams);
  }

  resize(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (this.width === nextWidth && this.height === nextHeight && this.sceneTexture) return;
    this._destroyTargets();
    this.width = nextWidth;
    this.height = nextHeight;
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const bloomSize = [Math.max(1, Math.ceil(nextWidth * BLOOM_SCALE)),
      Math.max(1, Math.ceil(nextHeight * BLOOM_SCALE))];
    this.sceneTexture = this.device.createTexture({ size: [nextWidth, nextHeight], format: this.sceneFormat, usage });
    this.brightTexture = this.device.createTexture({ size: bloomSize, format: this.sceneFormat, usage });
    this.blurTexture = this.device.createTexture({ size: bloomSize, format: this.sceneFormat, usage });
    this.thresholdBindGroup = this.device.createBindGroup({
      layout: this.thresholdPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sceneTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.thresholdBuffer } },
      ],
    });
    this.blurBrightBindGroup = this._createBlurBindGroup(this.brightTexture, this.blurBuffer);
    this.blurHorizontalBindGroup = this._createBlurBindGroup(this.blurTexture, this.blurVerticalBuffer);
    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sceneTexture.createView() },
        { binding: 1, resource: this.brightTexture.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.compositeBuffer } },
      ],
    });
  }

  _createBlurBindGroup(texture, uniformBuffer) {
    return this.device.createBindGroup({
      layout: this.blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });
  }

  encode(encoder, outputView) {
    const thresholdPass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.brightTexture.createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }] });
    thresholdPass.setPipeline(this.thresholdPipeline);
    thresholdPass.setBindGroup(0, this.thresholdBindGroup);
    thresholdPass.draw(6);
    thresholdPass.end();

    const horizontalPass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.blurTexture.createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }] });
    horizontalPass.setPipeline(this.blurPipeline);
    horizontalPass.setBindGroup(0, this.blurBrightBindGroup);
    horizontalPass.draw(6);
    horizontalPass.end();

    const verticalPass = encoder.beginRenderPass({ colorAttachments: [{
      view: this.brightTexture.createView(), loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
    }] });
    verticalPass.setPipeline(this.blurPipeline);
    verticalPass.setBindGroup(0, this.blurHorizontalBindGroup);
    verticalPass.draw(6);
    verticalPass.end();

    const compositePass = encoder.beginRenderPass({ colorAttachments: [{
      view: outputView, loadOp: 'clear', storeOp: 'store',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    }] });
    compositePass.setPipeline(this.compositePipeline);
    compositePass.setBindGroup(0, this.compositeBindGroup);
    compositePass.draw(6);
    compositePass.end();
  }

  _destroyTargets() {
    for (const texture of [this.sceneTexture, this.brightTexture, this.blurTexture]) texture?.destroy();
    this.sceneTexture = null;
    this.brightTexture = null;
    this.blurTexture = null;
  }

  dispose() {
    this._destroyTargets();
    for (const buffer of [this.thresholdBuffer, this.blurBuffer, this.blurVerticalBuffer, this.compositeBuffer]) buffer?.destroy();
    this.thresholdBuffer = null;
    this.blurBuffer = null;
    this.blurVerticalBuffer = null;
    this.compositeBuffer = null;
    this.thresholdBindGroup = null;
    this.blurBrightBindGroup = null;
    this.blurHorizontalBindGroup = null;
    this.compositeBindGroup = null;
    this.thresholdPipeline = null;
    this.blurPipeline = null;
    this.compositePipeline = null;
    this.device = null;
  }
}
