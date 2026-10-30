import { Matrix4, PerspectiveCamera, Vector3, Vector4 } from 'three';
import { generateGalaxyNebulae } from './loading-galaxy.js';

export class GalaxyNebulaField {
  constructor(options = {}) {
    this.entries = [];
    this.pipelines = new Map();
    this.configure(options);
    this.rayCamera = new PerspectiveCamera(58, 1, 0.0001, 40);
    this.visibleVolumes = 0;
  }

  configure({ radiusLy = 50000, armCount = 6, pitchAngleDeg = 14 } = {}) {
    const key = JSON.stringify([radiusLy, armCount, pitchAngleDeg]);
    if (this.configurationKey === key) return;
    for (const entry of this.entries) entry?.buffer.destroy();
    this.entries = [];
    this.configurationKey = key;
    this.radiusLy = Math.max(1, Number(radiusLy) || 50000);
    this.volumes = generateGalaxyNebulae({ radiusLy: this.radiusLy, armCount, pitchAngleDeg });
  }

  async init(device, format, source, additionalFormat = null) {
    if (!source) {
      const response = await fetch(new URL('../engine/fx/shaders/nebula.wgsl', import.meta.url));
      if (!response.ok) throw new Error(`Nebula shader: HTTP ${response.status}`);
      source = await response.text();
    }
    const shader = device.createShaderModule({ code: source, label: 'galaxy-nebula-volume' });
    if (shader.getCompilationInfo) {
      const info = await shader.getCompilationInfo();
      const errors = info.messages.filter((message) => message.type === 'error');
      if (errors.length) throw new Error(`Nebula shader: ${errors.map((error) => error.message).join('; ')}`);
    }
    this.device = device;
    this.shaderSource = source;
    this.defaultFormat = format;
    this._createPipeline(format);
    if (additionalFormat && additionalFormat !== format) this._createPipeline(additionalFormat);
  }

  _createPipeline(format) {
    const shader = this.device.createShaderModule({ code: this.shaderSource, label: `galaxy-nebula-volume-${format}` });
    const pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list' },
    });
    this.pipelines.set(format, pipeline);
    this.pipeline = pipeline;
  }

  overviewProjection({ scale, zoom, rotation, panX, panY, aspect }) {
    const scaleX = this.radiusLy * scale * zoom * 1.6 / aspect;
    const scaleY = this.radiusLy * scale * zoom * 0.85;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    return new Matrix4().set(
      cosine * scaleX, -sine * scaleX, 0, panX * zoom * 1.6 / aspect + 0.4,
      sine * scaleY, cosine * scaleY, 0, panY * zoom * 0.85,
      0, 0, -0.25, 0,
      0, 0, 0, 1,
    );
  }

  perspectiveProjection(camera, origin) {
    camera.updateMatrixWorld(true);
    this.rayCamera.fov = camera.fov;
    this.rayCamera.aspect = camera.aspect;
    this.rayCamera.updateProjectionMatrix();
    const world = camera.matrixWorld.clone();
    world.setPosition(camera.position.clone().add(origin).divideScalar(this.radiusLy));
    return this.rayCamera.projectionMatrix.clone().multiply(world.invert());
  }

  projectBounds(volume, projection) {
    const center = volume.center.map((value) => value / this.radiusLy);
    const radius = volume.radius / this.radiusLy;
    const corners = [];
    for (const offsetX of [-1, 1]) for (const offsetY of [-1, 1]) for (const offsetZ of [-1, 1]) {
      corners.push(new Vector4(center[0] + offsetX * radius, center[1] + offsetY * radius,
        center[2] + offsetZ * radius, 1).applyMatrix4(projection));
    }
    if (corners.every((corner) => corner.w <= 0)) return null;
    if (corners.some((corner) => corner.w <= 0)) return [-1, -1, 1, 1];
    const bounds = [Math.max(-1, Math.min(...corners.map((corner) => corner.x / corner.w))),
      Math.max(-1, Math.min(...corners.map((corner) => corner.y / corner.w))),
      Math.min(1, Math.max(...corners.map((corner) => corner.x / corner.w))),
      Math.min(1, Math.max(...corners.map((corner) => corner.y / corner.w)))];
    return bounds[0] < bounds[2] && bounds[1] < bounds[3] ? bounds : null;
  }

  render(pass, device, projection, { width, height, time = 0, format = this.defaultFormat }) {
    this.visibleVolumes = 0;
    const pipeline = this.pipelines.get(format) || this.pipeline;
    if (!pipeline) return;
    const inverse = projection.clone().invert();
    const eye = new Vector3(0, 0, -1).applyMatrix4(inverse);
    const ordered = this.volumes.map((volume, index) => ({ volume, index,
      distance: new Vector3(...volume.center).divideScalar(this.radiusLy).distanceToSquared(eye) }))
      .sort((left, right) => right.distance - left.distance);
    pass.setPipeline(pipeline);
    for (const { volume, index } of ordered) {
      const bounds = this.projectBounds(volume, projection);
      if (!bounds || (bounds[2] - bounds[0]) * width < 2 || (bounds[3] - bounds[1]) * height < 2) continue;
      let entry = this.entries[index];
      if (!entry) {
        const buffer = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        entry = { buffer, params: new Float32Array(36), bindGroups: new Map() };
        this.entries[index] = entry;
      }
      if (!entry.bindGroups.has(format)) {
        entry.bindGroups.set(format, device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: entry.buffer } }],
        }));
      }
      entry.params.set([...volume.center.map((value) => value / this.radiusLy), volume.radius / this.radiusLy]);
      entry.params.set([...volume.colorInner, 1.8], 4);
      entry.params.set([...volume.colorOuter, 0.65], 8);
      entry.params.set(inverse.elements, 12);
      entry.params.set(bounds, 28);
      entry.params.set([time, volume.opacity, width < 700 ? 10 : 16, 0.7], 32);
      device.queue.writeBuffer(entry.buffer, 0, entry.params);
      pass.setBindGroup(0, entry.bindGroups.get(format));
      pass.draw(6);
      this.visibleVolumes++;
    }
  }

  dispose() {
    for (const entry of this.entries) entry?.buffer.destroy();
    this.entries = [];
    this.pipeline = null;
    this.pipelines.clear();
    this.device = null;
  }
}