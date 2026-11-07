import { Matrix4, SphereGeometry, Vector3 } from 'three';

const SHADER = `
struct Uniforms { viewProjection: mat4x4<f32>, model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@vertex fn vs_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
  let clip = uniforms.viewProjection * uniforms.model * vec4(position, 1.0);
  return vec4(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4(0.0); }
`;

export class HeroBattleDepth {
  constructor() {
    this.resources = new Map();
    this.width = 0;
    this.height = 0;
  }

  prepare(device, format, width, height) {
    if (this.device !== device || this.format !== format) {
      this.dispose();
      this.device = device;
      this.format = format;
      const module = device.createShaderModule({ code: SHADER, label: 'hero-planet-depth' });
      this.pipeline = device.createRenderPipeline({ layout: 'auto',
        vertex: { module, entryPoint: 'vs_main', buffers: [{ arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
        fragment: { module, entryPoint: 'fs_main', targets: [{ format, writeMask: 0 }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
      });
      const indexed = new SphereGeometry(1, 48, 32);
      const geometry = indexed.toNonIndexed();
      indexed.dispose();
      const vertices = geometry.getAttribute('position').array;
      this.vertexCount = vertices.length / 3;
      this.vertexBuffer = device.createBuffer({ size: vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
      geometry.dispose();
    }
    if (this.width !== width || this.height !== height || !this.texture) {
      this.texture?.destroy();
      this.texture = device.createTexture({ size: [width, height], format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.width = width;
      this.height = height;
    }
    return this.texture.createView();
  }

  render(pass, bodies, camera) {
    const viewProjection = camera.projectionMatrix.clone()
      .multiply(camera.matrixWorldInverse.clone().setPosition(0, 0, 0));
    const desired = new Set();
    for (const body of bodies) {
      if (!['planet', 'moon', 'star'].includes(body.userData.type)) continue;
      desired.add(body);
      let resource = this.resources.get(body);
      if (!resource) {
        const buffer = this.device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        resource = { buffer, bindGroup: this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }],
        }) };
        this.resources.set(body, resource);
      }
      const position = body.getWorldPosition(new Vector3()).sub(camera.position);
      const model = new Matrix4().makeScale(body.userData.radius, body.userData.radius, body.userData.radius);
      model.setPosition(position);
      this.device.queue.writeBuffer(resource.buffer, 0, new Float32Array([...viewProjection.elements, ...model.elements]));
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, resource.bindGroup);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.draw(this.vertexCount);
    }
    for (const [body, resource] of this.resources) {
      if (!desired.has(body)) { resource.buffer.destroy(); this.resources.delete(body); }
    }
  }

  dispose() {
    for (const resource of this.resources.values()) resource.buffer.destroy();
    this.resources.clear();
    this.vertexBuffer?.destroy();
    this.texture?.destroy();
    this.vertexBuffer = null;
    this.texture = null;
    this.pipeline = null;
    this.device = null;
  }
}
