const LABEL_SHADER = `
@group(0) @binding(0) var labelSampler: sampler;
@group(0) @binding(1) var labelTexture: texture_2d<f32>;
struct Output {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};
@vertex fn vs_main(
  @builtin(vertex_index) vertex: u32,
  @location(0) center: vec2<f32>,
  @location(1) size: vec2<f32>,
  @location(2) atlasRect: vec4<f32>
) -> Output {
  let corners = array<vec2<f32>, 6>(
    vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(0.5, 0.5),
    vec2(-0.5, -0.5), vec2(0.5, 0.5), vec2(-0.5, 0.5),
  );
  let coordinates = array<vec2<f32>, 6>(
    vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(1.0, 0.0),
    vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(0.0, 0.0),
  );
  var output: Output;
  output.position = vec4(center + corners[vertex] * size, 0.0, 1.0);
  output.uv = mix(atlasRect.xy, atlasRect.zw, coordinates[vertex]);
  return output;
}
@fragment fn fs_main(input: Output) -> @location(0) vec4<f32> {
  return textureSample(labelTexture, labelSampler, input.uv);
}`;

const ATLAS_WIDTH = 1024;
const ATLAS_HEIGHT = 384;
const CELL_WIDTH = 256;
const CELL_HEIGHT = 96;
const MAX_LABELS = (ATLAS_WIDTH / CELL_WIDTH) * (ATLAS_HEIGHT / CELL_HEIGHT);
const LABEL_COLORS = {
  system: { background: 'rgba(5, 18, 30, 0.86)', border: '#6ecbf4', text: '#eaf8ff' },
  star: { background: 'rgba(30, 20, 8, 0.88)', border: '#ffd27a', text: '#fff5dc' },
  planet: { background: 'rgba(7, 24, 26, 0.88)', border: '#8de4d1', text: '#effffb' },
  moon: { background: 'rgba(14, 21, 34, 0.88)', border: '#a9c5ff', text: '#f3f6ff' },
};

export class SpatialLabelRenderer {
  constructor({ canvasFactory = () => document.createElement('canvas') } = {}) {
    this.canvasFactory = canvasFactory;
    this.atlasCanvas = null;
    this.atlasContext = null;
    this.texture = null;
    this.pipeline = null;
    this.sampler = null;
    this.bindGroup = null;
    this.instanceBuffer = null;
    this.instanceCapacity = 0;
    this.cacheKey = '';
    this.atlasDirty = false;
    this.currentLabels = [];
  }

  async initialize(device, format) {
    const shader = device.createShaderModule({ code: LABEL_SHADER, label: 'spatial-label-billboards' });
    if (shader.getCompilationInfo) {
      const info = await shader.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length) throw new Error(`Spatial label shader: ${errors.map((error) => error.message).join('; ')}`);
    }
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main', buffers: [{
        arrayStride: 32,
        stepMode: 'instance',
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x2' },
          { shaderLocation: 1, offset: 8, format: 'float32x2' },
          { shaderLocation: 2, offset: 16, format: 'float32x4' },
        ],
      }] },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list' },
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.texture = device.createTexture({
      size: [ATLAS_WIDTH, ATLAS_HEIGHT],
      format: 'rgba8unorm-srgb',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.atlasCanvas = this.canvasFactory();
    this.atlasCanvas.width = ATLAS_WIDTH;
    this.atlasCanvas.height = ATLAS_HEIGHT;
    this.atlasContext = this.atlasCanvas.getContext('2d', { alpha: true });
    if (!this.atlasContext) throw new Error('Spatial label atlas 2D context is unavailable');
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.texture.createView() },
      ],
    });
  }

  _updateAtlas(labels) {
    const active = labels.slice(0, MAX_LABELS);
    const key = active.map((label) => `${label.id}:${label.text}:${label.detail || ''}:${Math.round(label.fontSize)}:${label.kind}`).join('|');
    active.forEach((label, index) => {
      const column = index % (ATLAS_WIDTH / CELL_WIDTH);
      const row = Math.floor(index / (ATLAS_WIDTH / CELL_WIDTH));
      label.atlasRect = [column * CELL_WIDTH / ATLAS_WIDTH, row * CELL_HEIGHT / ATLAS_HEIGHT,
        (column + 1) * CELL_WIDTH / ATLAS_WIDTH, (row + 1) * CELL_HEIGHT / ATLAS_HEIGHT];
    });
    if (key === this.cacheKey) return active;
    this.cacheKey = key;
    const ctx = this.atlasContext;
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    active.forEach((label, index) => {
      const column = index % (ATLAS_WIDTH / CELL_WIDTH);
      const row = Math.floor(index / (ATLAS_WIDTH / CELL_WIDTH));
      const left = column * CELL_WIDTH;
      const top = row * CELL_HEIGHT;
      const style = LABEL_COLORS[label.kind] || LABEL_COLORS.system;
      const boxWidth = Math.min(CELL_WIDTH - 8, Math.max(72, label.width || 120));
      const boxHeight = Math.min(CELL_HEIGHT - 8, Math.max(24, label.height || 28));
      const x = left + (CELL_WIDTH - boxWidth) / 2;
      const y = top + (CELL_HEIGHT - boxHeight) / 2;
      ctx.beginPath();
      ctx.roundRect(x, y, boxWidth, boxHeight, 5);
      ctx.fillStyle = style.background;
      ctx.fill();
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 1;
      ctx.stroke();
      const fontSize = Math.round(label.fontSize || 18);
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = style.text;
      let text = String(label.text || '');
      while (text.length > 3 && ctx.measureText(text).width > boxWidth - 16) text = `${text.slice(0, -2)}…`;
      const detail = String(label.detail || '');
      if (detail) {
        const detailFontSize = Math.max(10, Math.round(label.detailFontSize || fontSize * 0.62));
        ctx.textBaseline = 'alphabetic';
        const contentHeight = fontSize + detailFontSize + 3;
        const titleY = y + (boxHeight - contentHeight) / 2 + fontSize;
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.fillText(text, left + CELL_WIDTH / 2, titleY, boxWidth - 14);
        ctx.font = `500 ${detailFontSize}px system-ui, sans-serif`;
        let detailText = detail;
        while (detailText.length > 3 && ctx.measureText(detailText).width > boxWidth - 16) {
          detailText = `${detailText.slice(0, -2)}…`;
        }
        ctx.globalAlpha = 0.82;
        ctx.fillText(detailText, left + CELL_WIDTH / 2, titleY + detailFontSize + 3, boxWidth - 14);
        ctx.globalAlpha = 1;
      } else {
        ctx.textBaseline = 'middle';
        ctx.fillText(text, left + CELL_WIDTH / 2, top + CELL_HEIGHT / 2, boxWidth - 14);
      }
    });
    this.atlasDirty = true;
    return active;
  }

  render(pass, device, labels, { width, height }) {
    this.currentLabels = labels.slice(0, MAX_LABELS);
    if (!this.pipeline || !this.currentLabels.length || width <= 0 || height <= 0) return;
    const active = this._updateAtlas(this.currentLabels);
    if (this.atlasDirty) {
      device.queue.copyExternalImageToTexture(
        { source: this.atlasCanvas },
        { texture: this.texture },
        [ATLAS_WIDTH, ATLAS_HEIGHT],
      );
      this.atlasDirty = false;
    }
    const instances = new Float32Array(active.length * 8);
    active.forEach((label, index) => {
      const base = index * 8;
      instances.set([
        label.x * 2 / width - 1,
        1 - label.y * 2 / height,
        label.width * 2 / width,
        label.height * 2 / height,
        ...label.atlasRect,
      ], base);
    });
    const byteLength = instances.byteLength;
    if (!this.instanceBuffer || byteLength > this.instanceCapacity) {
      this.instanceBuffer?.destroy();
      this.instanceCapacity = Math.max(256, Math.ceil(byteLength / 256) * 256);
      this.instanceBuffer = device.createBuffer({
        size: this.instanceCapacity,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    device.queue.writeBuffer(this.instanceBuffer, 0, instances);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.instanceBuffer);
    pass.draw(6, active.length, 0, 0);
  }

  dispose() {
    this.instanceBuffer?.destroy();
    this.texture?.destroy();
    this.instanceBuffer = null;
    this.texture = null;
    this.bindGroup = null;
    this.pipeline = null;
    this.atlasCanvas = null;
    this.atlasContext = null;
    this.sampler = null;
    this.instanceCapacity = 0;
    this.cacheKey = '';
    this.atlasDirty = false;
    this.currentLabels = [];
  }
}
