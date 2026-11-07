import { formatSpatialCombatStatus } from './spatial-label-layout.js';

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
const ATLAS_HEIGHT = 768;
const CELL_WIDTH = 256;
const CELL_HEIGHT = 192;
const MAX_LABELS = (ATLAS_WIDTH / CELL_WIDTH) * (ATLAS_HEIGHT / CELL_HEIGHT);
const LABEL_COLORS = {
  system: { background: 'rgba(5, 18, 30, 0.86)', border: '#6ecbf4', text: '#eaf8ff' },
  star: { background: 'rgba(30, 20, 8, 0.88)', border: '#ffd27a', text: '#fff5dc' },
  planet: { background: 'rgba(7, 24, 26, 0.88)', border: '#8de4d1', text: '#effffb' },
  moon: { background: 'rgba(14, 21, 34, 0.88)', border: '#a9c5ff', text: '#f3f6ff' },
};

export class SpatialLabelRenderer {
  constructor({ canvasFactory = () => document.createElement('canvas'), canvas = null } = {}) {
    this.canvasFactory = canvasFactory;
    this.canvas = null;
    this.overlay = null;
    this.domBadges = new Map();
    this.badgeLabels = new WeakMap();
    this.hoveredBadge = null;
    this.focusedBadge = null;
    this.activeBadge = null;
    this.mode = 'webgpu';
    this.callbacks = {};
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
    if (canvas) this.attachCanvas(canvas);
  }

  attachCanvas(canvas) {
    if (!canvas?.parentElement || this.canvas === canvas) return false;
    this._hideOverlay();
    this.overlay?.remove();
    this.canvas = canvas;
    this.overlay = document.createElement('div');
    this.overlay.className = 'gq-spatial-label-overlay';
    this.overlay.setAttribute('aria-label', 'Interaktive räumliche Beschriftungen');
    this.overlay.hidden = this.mode !== 'dom';
    canvas.parentElement.append(this.overlay);
    this.domBadges.clear();
    return true;
  }

  setMode(mode) {
    if (mode !== 'webgpu' && mode !== 'dom') return false;
    this.mode = mode;
    if (mode === 'webgpu') this._hideOverlay();
    else if (this.overlay) this.overlay.hidden = this.domBadges.size === 0;
    return true;
  }

  _hideOverlay() {
    if (!this.overlay) return;
    this.hoveredBadge = null;
    this.focusedBadge = null;
    this._syncHover();
    if (this.overlay.contains(document.activeElement)) this.canvas?.focus({ preventScroll: true });
    this.overlay.hidden = true;
  }

  _syncHover() {
    const badge = this.hoveredBadge || this.focusedBadge;
    if (badge === this.activeBadge) return;
    this.activeBadge = badge;
    this.callbacks.onHover?.(badge ? this.badgeLabels.get(badge) : null);
  }

  setCallbacks(callbacks = {}) {
    this.callbacks = {
      onActivate: typeof callbacks.onActivate === 'function' ? callbacks.onActivate : null,
      onDoubleActivate: typeof callbacks.onDoubleActivate === 'function' ? callbacks.onDoubleActivate : null,
      onHover: typeof callbacks.onHover === 'function' ? callbacks.onHover : null,
      onWheel: typeof callbacks.onWheel === 'function' ? callbacks.onWheel : null,
    };
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
    const key = active.map((label) => `${label.id}:${label.text}:${label.detail || ''}:${Math.round(label.fontSize)}:${label.kind}:`
      + (label.metrics || []).map((metric) => `${metric.key}:${metric.percent}`).join(',')).join('|');
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
      const metrics = Array.isArray(label.metrics) ? label.metrics.slice(0, 3) : [];
      if (detail || metrics.length) {
        const detailFontSize = Math.max(10, Math.round(label.detailFontSize || fontSize * 0.62));
        ctx.textBaseline = 'alphabetic';
        const contentHeight = fontSize + (detail ? detailFontSize + 3 : 0) + (metrics.length ? metrics.length * 11 + 3 : 0);
        const titleY = y + (boxHeight - contentHeight) / 2 + fontSize;
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.fillText(text, left + CELL_WIDTH / 2, titleY, boxWidth - 14);
        let nextY = titleY + 3;
        if (detail) {
          ctx.font = `500 ${detailFontSize}px system-ui, sans-serif`;
          let detailText = detail;
          while (detailText.length > 3 && ctx.measureText(detailText).width > boxWidth - 16) {
            detailText = `${detailText.slice(0, -2)}…`;
          }
          ctx.globalAlpha = 0.82;
          ctx.fillText(detailText, left + CELL_WIDTH / 2, titleY + detailFontSize + 3, boxWidth - 14);
          ctx.globalAlpha = 1;
          nextY += detailFontSize + 3;
        }
        for (const metric of metrics) {
          const rowY = nextY + 6;
          const barX = x + 37;
          const barWidth = Math.max(12, boxWidth - 76);
          ctx.font = '600 9px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = style.text;
          ctx.fillText(metric.short, x + 7, rowY, 26);
          ctx.fillStyle = 'rgba(190, 220, 235, 0.22)';
          ctx.fillRect(barX, rowY - 2, barWidth, 4);
          ctx.fillStyle = metric.color || style.border;
          ctx.fillRect(barX, rowY - 2, barWidth * metric.percent / 100, 4);
          ctx.fillStyle = style.text;
          ctx.textAlign = 'right';
          ctx.fillText(`${metric.percent}%`, x + boxWidth - 7, rowY, 28);
          nextY += 11;
        }
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
    if (this.mode === 'dom') {
      this._renderDom(this.currentLabels, width, height);
      return;
    }
    this._hideOverlay();
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

  _renderDom(labels, width, height) {
    if (!this.overlay || !this.canvas) return;
    if (width <= 0 || height <= 0) {
      this._hideOverlay();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this._hideOverlay();
      return;
    }
    this.overlay.hidden = false;
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const activeIds = new Set();
    for (const label of labels) {
      const id = String(label.id || '');
      if (!id) continue;
      activeIds.add(id);
      let badge = this.domBadges.get(id);
      const labelText = String(label.text || '');
      const detailText = String(label.detail || '');
      const metrics = Array.isArray(label.metrics) ? label.metrics.slice(0, 3) : [];
      const statusText = formatSpatialCombatStatus(metrics).replaceAll('%', 'Prozent').replaceAll(' · ', ', ');
      const ariaParts = [detailText, statusText].filter(Boolean);
      const ariaLabel = ariaParts.length ? `${labelText}: ${ariaParts.join('; ')}` : labelText || 'Objekt';
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'gq-spatial-label';
        badge.dataset.labelId = id;
        const title = document.createElement('span');
        title.className = 'gq-spatial-label-title';
        const detail = document.createElement('span');
        detail.className = 'gq-spatial-label-detail';
        const metricList = document.createElement('span');
        metricList.className = 'gq-spatial-label-metrics';
        metricList.setAttribute('aria-hidden', 'true');
        badge.append(title, detail, metricList);
        badge.setAttribute('aria-keyshortcuts', 'Shift+Enter Escape');
        badge.addEventListener('wheel', (event) => {
          if (!this.callbacks.onWheel) return;
          event.preventDefault();
          event.stopPropagation();
          this.callbacks.onWheel(this.badgeLabels.get(badge), event);
        }, { passive: false });
        badge.addEventListener('pointerenter', () => {
          this.hoveredBadge = badge;
          this._syncHover();
        });
        badge.addEventListener('pointerleave', () => {
          if (this.hoveredBadge === badge) this.hoveredBadge = null;
          this._syncHover();
        });
        badge.addEventListener('focus', () => {
          this.focusedBadge = badge;
          this._syncHover();
        });
        badge.addEventListener('blur', () => {
          if (this.focusedBadge === badge) this.focusedBadge = null;
          this._syncHover();
        });
        badge.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.canvas.focus({ preventScroll: true });
          } else if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) this.callbacks.onDoubleActivate?.(this.badgeLabels.get(badge), event);
          }
        });
        badge.addEventListener('click', (event) => {
          event.stopPropagation();
          this.callbacks.onActivate?.(this.badgeLabels.get(badge), event);
        });
        badge.addEventListener('dblclick', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.callbacks.onDoubleActivate?.(this.badgeLabels.get(badge), event);
        });
        this.domBadges.set(id, badge);
        this.overlay.append(badge);
      }
      this.badgeLabels.set(badge, label);
      const kind = String(label.kind || 'object');
      if (badge.dataset.kind !== kind) badge.dataset.kind = kind;
      if (kind === 'planet') {
        const pressed = String(label.selected === true);
        if (badge.getAttribute('aria-pressed') !== pressed) badge.setAttribute('aria-pressed', pressed);
      } else {
        badge.removeAttribute('aria-pressed');
      }
      const style = {
        left: `${label.x * scaleX}px`,
        top: `${label.y * scaleY}px`,
        width: `${label.width * scaleX}px`,
        minHeight: `${label.height * scaleY}px`,
      };
      for (const [property, value] of Object.entries(style)) {
        if (badge.style[property] !== value) badge.style[property] = value;
      }
      const fontSize = `${(label.fontSize || 18) * scaleY}px`;
      const detailFontSize = `${(label.detailFontSize || 12) * scaleY}px`;
      if (badge.style.getPropertyValue('--badge-font-size') !== fontSize) badge.style.setProperty('--badge-font-size', fontSize);
      if (badge.style.getPropertyValue('--badge-detail-font-size') !== detailFontSize) {
        badge.style.setProperty('--badge-detail-font-size', detailFontSize);
      }
      const title = badge.querySelector('.gq-spatial-label-title');
      if (title.textContent !== labelText) title.textContent = labelText;
      const detail = badge.querySelector('.gq-spatial-label-detail');
      if (detail.textContent !== detailText) detail.textContent = detailText;
      detail.hidden = !detailText;
      const metricList = badge.querySelector('.gq-spatial-label-metrics');
      const existingRows = new Map([...metricList.children].map((row) => [row.dataset.metric, row]));
      for (const metric of metrics) {
        let row = existingRows.get(metric.key);
        if (!row) {
          row = document.createElement('span');
          row.className = 'gq-spatial-label-metric';
          row.dataset.metric = metric.key;
          const labelNode = document.createElement('span');
          labelNode.className = 'gq-spatial-label-metric-name';
          const track = document.createElement('span');
          track.className = 'gq-spatial-label-meter';
          const fill = document.createElement('span');
          fill.className = 'gq-spatial-label-meter-fill';
          track.append(fill);
          const value = document.createElement('span');
          value.className = 'gq-spatial-label-metric-value';
          row.append(labelNode, track, value);
          metricList.append(row);
        }
        existingRows.delete(metric.key);
        row.querySelector('.gq-spatial-label-metric-name').textContent = metric.short;
        const fill = row.querySelector('.gq-spatial-label-meter-fill');
        fill.style.width = `${metric.percent}%`;
        fill.style.backgroundColor = metric.color || '#eaf8ff';
        row.querySelector('.gq-spatial-label-metric-value').textContent = `${metric.percent}%`;
        row.title = `${metric.label}: ${metric.current} von ${metric.maximum}`;
      }
      for (const row of existingRows.values()) row.remove();
      metricList.hidden = metrics.length === 0;
      if (badge.getAttribute('aria-label') !== ariaLabel) badge.setAttribute('aria-label', ariaLabel);
      const titleText = [labelText, detailText, statusText].filter(Boolean).join(' — ');
      if (badge.title !== titleText) badge.title = titleText;
    }
    for (const [id, badge] of this.domBadges) {
      if (activeIds.has(id)) continue;
      if (this.hoveredBadge === badge) this.hoveredBadge = null;
      if (this.focusedBadge === badge) this.focusedBadge = null;
      if (badge === document.activeElement) this.canvas.focus({ preventScroll: true });
      badge.remove();
      this.domBadges.delete(id);
    }
    this._syncHover();
    if (this.overlay.hidden !== (labels.length === 0)) this.overlay.hidden = labels.length === 0;
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
    this._hideOverlay();
    this.overlay?.remove();
    this.overlay = null;
    this.canvas = null;
    this.domBadges.clear();
    this.callbacks = {};
  }
}
