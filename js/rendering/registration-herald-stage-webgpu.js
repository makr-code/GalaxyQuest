import { Matrix3, ObjectLoader, Vector3 } from 'three';

const HERALD_COLORS = {
  aereth: [0.18, 0.68, 0.88],
  vor_tak: [0.78, 0.34, 0.22],
  syl_nar: [0.22, 0.62, 0.48],
  vel_ar: [0.55, 0.38, 0.78],
  kryl_tha: [0.62, 0.68, 0.24],
  zhareen: [0.86, 0.66, 0.28],
};

const PART_COUNT = 11;
const INSTANCE_FLOATS = 16;
const CAMERA_FLOATS = 20;
const SPHERE_SEGMENTS = 12;
const SPHERE_RINGS = 8;

const HERALD_SHADER = `
struct Camera {
  position: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  forward: vec4<f32>,
  projection: vec4<f32>,
};
@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) alpha: f32,
};

fn rotateByQuaternion(rotation: vec4<f32>, value: vec3<f32>) -> vec3<f32> {
  let vector = rotation.xyz;
  let first = 2.0 * cross(vector, value);
  return value + rotation.w * first + cross(vector, first);
}

@vertex fn vertexMain(
  @location(0) localPosition: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @location(2) center: vec4<f32>,
  @location(3) scale: vec4<f32>,
  @location(4) rotation: vec4<f32>,
  @location(5) tint: vec4<f32>,
) -> VertexOutput {
  let worldPosition = center.xyz + rotateByQuaternion(rotation, localPosition * scale.xyz);
  let relative = worldPosition - camera.position.xyz;
  let depth = dot(relative, camera.forward.xyz);
  let nearPlane = camera.projection.z;
  let farPlane = camera.projection.w;
  let depthClip = depth * farPlane / (farPlane - nearPlane)
    - farPlane * nearPlane / (farPlane - nearPlane);
  var output: VertexOutput;
  output.position = vec4<f32>(
    dot(relative, camera.right.xyz) * camera.projection.x / camera.projection.y,
    dot(relative, camera.up.xyz) * camera.projection.x,
    depthClip,
    depth
  );
  output.normal = normalize(rotateByQuaternion(rotation, localNormal / scale.xyz));
  output.color = tint.rgb;
  output.alpha = tint.a;
  return output;
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  if (input.alpha < 0.5) { discard; }
  let lightDirection = normalize(vec3<f32>(-0.35, 0.75, 0.58));
  let diffuse = max(dot(normalize(input.normal), lightDirection), 0.0);
  let rim = pow(1.0 - abs(normalize(input.normal).z), 2.0);
  let light = 0.28 + diffuse * 0.72 + rim * 0.16;
  return vec4<f32>(input.color * light, 1.0);
}
`;

function normalize3(value) {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return value.map((component) => component / length);
}

export function parseNpcJsonMeshDescriptor(descriptor, objectLoader = new ObjectLoader()) {
  return new Promise((resolve, reject) => {
    try {
      objectLoader.parse(descriptor, (root) => {
        root.updateMatrixWorld(true);
        const meshes = [];
        root.traverse((node) => {
          if (!node.isMesh || !node.geometry) return;
          const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
          if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
          const positions = geometry.getAttribute('position');
          const normals = geometry.getAttribute('normal');
          const normalMatrix = new Matrix3().getNormalMatrix(node.matrixWorld);
          const material = Array.isArray(node.material) ? node.material[0] : node.material;
          const color = material?.color?.toArray?.() || [1, 1, 1];
          const vertices = new Float32Array(positions.count * 6);
          const position = new Vector3();
          const normal = new Vector3();
          for (let index = 0; index < positions.count; index += 1) {
            position.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld);
            normal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();
            const offset = index * 6;
            vertices.set([position.x, position.y, position.z, normal.x, normal.y, normal.z], offset);
          }
          meshes.push({ name: node.name || '', vertices, color });
          geometry.dispose();
        });
        resolve(meshes);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function cross3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function quaternionFromEuler(yaw, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cx = Math.cos(pitch * 0.5);
  const sx = Math.sin(pitch * 0.5);
  const cz = Math.cos(roll * 0.5);
  const sz = Math.sin(roll * 0.5);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

function rotate2D(x, y, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [x * cosine - y * sine, x * sine + y * cosine];
}

function sphereVertexData() {
  const vertices = [];
  const point = (ring, segment) => {
    const latitude = (ring / SPHERE_RINGS) * Math.PI;
    const longitude = (segment / SPHERE_SEGMENTS) * Math.PI * 2;
    const normal = [
      Math.sin(latitude) * Math.cos(longitude),
      Math.cos(latitude),
      Math.sin(latitude) * Math.sin(longitude),
    ];
    return [...normal, ...normal];
  };
  for (let ring = 0; ring < SPHERE_RINGS; ring += 1) {
    for (let segment = 0; segment < SPHERE_SEGMENTS; segment += 1) {
      const a = point(ring, segment);
      const b = point(ring + 1, segment);
      const c = point(ring + 1, segment + 1);
      const d = point(ring, segment + 1);
      vertices.push(...a, ...b, ...d, ...b, ...c, ...d);
    }
  }
  return new Float32Array(vertices);
}

function appendPart(output, center, scale, rotation, color, visible = true) {
  output.push(
    center[0], center[1], center[2], 1,
    scale[0], scale[1], scale[2], 0,
    rotation[0], rotation[1], rotation[2], rotation[3],
    color[0], color[1], color[2], visible ? 1 : 0,
  );
}

function createActorInstances(actor, index, timeSeconds, focusCode, selectedCode, viewport, modelCodes) {
  const color = HERALD_COLORS[actor.code] || [0.45, 0.65, 0.78];
  const accent = color.map((component) => Math.min(1, component * 1.28 + 0.12));
  const dim = color.map((component) => component * 0.54 + 0.08);
  const spacing = viewport.halfSpan * 2 / Math.max(1, viewport.count - 1);
  const x = viewport.offsetX - viewport.halfSpan + spacing * index;
  const arc = index / Math.max(1, viewport.count - 1) * 2 - 1;
  const z = 0.6 * (1 - arc * arc);
  const scaleFactor = viewport.scaleFactor * (1 - Math.abs(arc) * 0.08);
  const focused = actor.code === focusCode;
  const selected = actor.code === selectedCode;
  const idle = Math.sin(timeSeconds * 1.7 + index * 0.7);
  const greet = focused || selected;
  const wristWave = greet ? Math.sin(timeSeconds * 5.2 + index) * 0.045 : 0;
  const torsoScale = [0.34 * scaleFactor, (0.56 + idle * 0.012) * scaleFactor, 0.22 * scaleFactor];
  const rootY = idle * 0.018 * scaleFactor;
  const yaw = arc * -0.13;
  const groupRotation = quaternionFromEuler(yaw);
  const partPosition = (local) => [
    x + local[0] * Math.cos(yaw) + local[2] * Math.sin(yaw),
    local[1] + rootY,
    z - local[0] * Math.sin(yaw) + local[2] * Math.cos(yaw),
  ];
  const partRotation = (roll = 0, pitch = 0) => quaternionFromEuler(yaw, pitch, roll);
  const output = [];

  const hasModel = modelCodes.has(actor.code);
  appendPart(output, partPosition([0, 1.34, 0]), torsoScale, groupRotation, dim, !hasModel);
  appendPart(output, partPosition([0, 2.08 + rootY, 0]), [0.27 * scaleFactor, 0.32 * scaleFactor, 0.25 * scaleFactor],
    partRotation(Math.sin(timeSeconds * 1.3 + index) * 0.035, idle * 0.025), accent, !hasModel);
  appendPart(output, partPosition([0, 1.82, 0]), [0.13 * scaleFactor, 0.17 * scaleFactor, 0.13 * scaleFactor], groupRotation, color, !hasModel);
  appendPart(output, partPosition([0, 0.72, 0]), [0.31 * scaleFactor, 0.25 * scaleFactor, 0.2 * scaleFactor], groupRotation, dim, !hasModel);
  appendPart(output, partPosition([0, 1.42, 0.205]), [0.095 * scaleFactor, 0.14 * scaleFactor, 0.055 * scaleFactor], groupRotation, accent, !hasModel);

  for (const side of [-1, 1]) {
    const shoulder = [side * 0.37, 1.62, 0];
    const raising = side > 0 && greet;
    const armVector = raising ? [0.27, 0.22] : [side * 0.08, -0.34];
    const angle = raising ? Math.atan2(-armVector[0], armVector[1]) : 0;
    const armCenter = [shoulder[0] + armVector[0] * 0.5, shoulder[1] + armVector[1] * 0.5, 0];
    appendPart(output, partPosition(armCenter), [0.13 * scaleFactor, 0.42 * scaleFactor, 0.13 * scaleFactor],
      partRotation(angle), color);
    const handY = shoulder[1] + armVector[1] * 1.25 + wristWave;
    appendPart(output, partPosition([shoulder[0] + armVector[0] * 1.25, handY, 0]),
      [0.12 * scaleFactor, 0.13 * scaleFactor, 0.12 * scaleFactor], partRotation(angle + wristWave), accent);
  }

  for (const side of [-1, 1]) {
    appendPart(output, partPosition([side * 0.17, 0.28, 0]), [0.15 * scaleFactor, 0.48 * scaleFactor, 0.16 * scaleFactor],
      partRotation(side * 0.015), dim);
  }
  return output;
}

export function createHeraldInstanceData(actors, timeSeconds, focusCode, selectedCode, viewport, modelCodes = new Set()) {
  const output = [];
  actors.forEach((actor, index) => {
    output.push(...createActorInstances(actor, index, timeSeconds, focusCode, selectedCode, {
      ...viewport,
      count: actors.length,
    }, modelCodes));
  });
  return new Float32Array(output);
}

export function createHeraldModelInstanceData(models, actors, timeSeconds, viewport) {
  const output = [];
  for (const model of models) {
    const index = model.actorIndex;
    const actor = actors[index];
    if (!actor) continue;
    const arc = index / Math.max(1, actors.length - 1) * 2 - 1;
    const x = viewport.offsetX - viewport.halfSpan + (viewport.halfSpan * 2 / Math.max(1, actors.length - 1)) * index;
    const z = 0.6 * (1 - arc * arc);
    const scaleFactor = viewport.scaleFactor * (1 - Math.abs(arc) * 0.08) * 0.82;
    const rootY = Math.sin(timeSeconds * 1.7 + index * 0.7) * 0.018 * scaleFactor;
    const yaw = arc * -0.13;
    const headMotion = model.name === 'head'
      ? Math.sin(timeSeconds * 1.3 + index) * 0.018 : 0;
    appendPart(output, [x, 1.52 + rootY, z], [scaleFactor, scaleFactor, scaleFactor],
      quaternionFromEuler(yaw, headMotion), model.color);
  }
  return new Float32Array(output);
}

export class RegistrationHeraldStage {
  constructor({ windowRef = globalThis.window, documentRef = globalThis.document } = {}) {
    this.window = windowRef;
    this.document = documentRef;
    this.canvas = null;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.depthTexture = null;
    this.cameraBuffer = null;
    this.instanceBuffer = null;
    this.vertexBuffer = null;
    this.modelMeshes = [];
    this.modelCodes = new Set();
    this.bindGroup = null;
    this.resizeObserver = null;
    this.rafId = 0;
    this.visible = false;
    this.destroyed = false;
    this.actors = [];
    this.focusCode = null;
    this.selectedCode = null;
    this.startTime = 0;
    this.lastTime = 0;
    this.resizeHandler = () => this.resize();
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.vertexCount = 0;
    this.riggedOrchestrator = null;
    this._frame = (timestamp) => this.render(timestamp);
  }

  async mount(container, actors) {
    if (!this.window?.navigator?.gpu || !container || this.destroyed) return false;
    this.actors = Array.isArray(actors) ? actors.slice() : [];
    if (!this.actors.length) return false;
    const { RegistrationHeraldModelOrchestrator } = await import('./registration-herald-model-orchestrator.js');
    const riggedOrchestrator = new RegistrationHeraldModelOrchestrator({
      windowRef: this.window,
      documentRef: this.document,
    });
    if (await riggedOrchestrator.mount(container, this.actors)) {
      this.riggedOrchestrator = riggedOrchestrator;
      this.canvas = riggedOrchestrator.canvas;
      this.canvas.dataset.renderer = 'three-webgpu-gltf';
      return true;
    }
    riggedOrchestrator.destroy();
    if (this.destroyed) return false;
    const fetchImpl = this.window.fetch?.bind(this.window) || globalThis.fetch;
    const loadedModels = await Promise.all(this.actors.map(async (actor, actorIndex) => {
      try {
        const response = await fetchImpl(`models/npc_avatars/${encodeURIComponent(actor.code)}_npc_bust.json`, {
          credentials: 'same-origin', cache: 'force-cache',
        });
        if (!response.ok) return [];
        const meshes = await parseNpcJsonMeshDescriptor(await response.json());
        return meshes.map((mesh) => ({ ...mesh, actorCode: actor.code, actorIndex }));
      } catch (error) {
        this.window.GQLog?.warn?.('[registration-herald-json]', `${actor.code}: ${String(error?.message || error)}`);
        return [];
      }
    }));
    this.modelMeshes = loadedModels.flat();
    this.modelCodes = new Set(this.modelMeshes.map((mesh) => mesh.actorCode));
    if (this.destroyed) return false;
    const adapter = await this.window.navigator.gpu.requestAdapter();
    if (!adapter || this.destroyed) return false;
    const device = await adapter.requestDevice();
    if (this.destroyed) {
      device.destroy();
      return false;
    }
    this.device = device;
    this.canvas = this.document.createElement('canvas');
    this.canvas.className = 'registration-herald-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.focusedHerald = this.focusCode || '';
    this.canvas.dataset.selectedHerald = this.selectedCode || '';
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      this.destroy();
      return false;
    }
    container.prepend(this.canvas);
    if (this.window.ResizeObserver) {
      this.resizeObserver = new this.window.ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    } else {
      this.window.addEventListener('resize', this.resizeHandler);
    }
    this.resize();
    try {
      this.initializePipeline();
    } catch (error) {
      this.window.GQLog?.warn?.('[registration-herald-webgpu]', String(error?.message || error));
      this.destroy();
      return false;
    }
    this.startTime = this.window.performance?.now?.() || performance.now();
    return true;
  }

  initializePipeline() {
    const device = this.device;
    const shader = device.createShaderModule({ code: HERALD_SHADER, label: 'registration-heralds' });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shader,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 24,
            stepMode: 'vertex',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
          {
            arrayStride: INSTANCE_FLOATS * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 2, offset: 0, format: 'float32x4' },
              { shaderLocation: 3, offset: 16, format: 'float32x4' },
              { shaderLocation: 4, offset: 32, format: 'float32x4' },
              { shaderLocation: 5, offset: 48, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fragmentMain',
        targets: [{
          format: this.window.navigator.gpu.getPreferredCanvasFormat(),
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    this.cameraBuffer = device.createBuffer({
      size: CAMERA_FLOATS * 4,
      usage: this.window.GPUBufferUsage.UNIFORM | this.window.GPUBufferUsage.COPY_DST,
    });
    this.instanceBuffer = device.createBuffer({
      size: (this.actors.length * PART_COUNT + this.modelMeshes.length) * INSTANCE_FLOATS * 4,
      usage: this.window.GPUBufferUsage.VERTEX | this.window.GPUBufferUsage.COPY_DST,
    });
    const vertices = sphereVertexData();
    this.vertexCount = vertices.length / 6;
    this.vertexBuffer = device.createBuffer({
      size: vertices.byteLength,
      usage: this.window.GPUBufferUsage.VERTEX | this.window.GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
    this.modelMeshes = this.modelMeshes.map((mesh) => {
      const vertexBuffer = device.createBuffer({
        size: mesh.vertices.byteLength,
        usage: this.window.GPUBufferUsage.VERTEX | this.window.GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
      return { ...mesh, vertexBuffer, vertexCount: mesh.vertices.length / 6 };
    });
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.cameraBuffer } }],
    });
  }

  resize() {
    if (!this.canvas || !this.context || !this.device) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    this.pixelRatio = Math.min(this.window.devicePixelRatio || 1, 1.5);
    this.width = Math.max(1, Math.floor(rect.width * this.pixelRatio));
    this.height = Math.max(1, Math.floor(rect.height * this.pixelRatio));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.context.configure({
      device: this.device,
      format: this.window.navigator.gpu.getPreferredCanvasFormat(),
      alphaMode: 'premultiplied',
    });
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [this.width, this.height, 1],
      format: 'depth24plus',
      usage: this.window.GPUTextureUsage.RENDER_ATTACHMENT,
    });
    if (this.visible) this.scheduleFrame();
  }

  setVisible(visible) {
    this.visible = visible === true;
    if (this.riggedOrchestrator) {
      this.riggedOrchestrator.setVisible(this.visible);
      return;
    }
    if (this.canvas) this.canvas.hidden = !this.visible;
    if (!this.visible) {
      if (this.rafId) this.window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      return;
    }
    this.scheduleFrame();
  }

  setFocus(code) {
    this.focusCode = code || null;
    if (this.riggedOrchestrator) {
      this.riggedOrchestrator.setFocus(this.focusCode);
      return;
    }
    if (this.canvas) this.canvas.dataset.focusedHerald = this.focusCode || '';
    this.scheduleFrame();
  }

  setSelected(code) {
    this.selectedCode = code || null;
    this.focusCode = code || this.focusCode;
    if (this.riggedOrchestrator) {
      this.riggedOrchestrator.setSelected(this.selectedCode);
      return;
    }
    if (this.canvas) {
      this.canvas.dataset.focusedHerald = this.focusCode || '';
      this.canvas.dataset.selectedHerald = this.selectedCode || '';
    }
    this.scheduleFrame();
  }

  scheduleFrame() {
    if (!this.visible || this.rafId || this.destroyed || !this.device) return;
    this.rafId = this.window.requestAnimationFrame(this._frame);
  }

  render(timestamp) {
    this.rafId = 0;
    if (!this.visible || !this.device || !this.canvas || this.destroyed) return;
    const now = Number(timestamp) || this.window.performance?.now?.() || performance.now();
    const reducedMotion = this.document.body?.dataset.startReducedMotion === 'true';
    const timeSeconds = reducedMotion ? 0 : (now - this.startTime) / 1000;
    this.lastTime = now;
    const baseData = createHeraldInstanceData(
      this.actors, timeSeconds, this.focusCode, this.selectedCode, this.viewport(), this.modelCodes,
    );
    const modelData = createHeraldModelInstanceData(this.modelMeshes, this.actors, timeSeconds, this.viewport());
    const data = new Float32Array(baseData.length + modelData.length);
    data.set(baseData);
    data.set(modelData, baseData.length);
    this.device.queue.writeBuffer(this.instanceBuffer, 0, data);
    this.updateCameraUniform();
    const encoder = this.device.createCommandEncoder({ label: 'registration-herald-frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.setVertexBuffer(1, this.instanceBuffer);
    pass.draw(this.vertexCount, this.actors.length * PART_COUNT);
    const firstModelInstance = this.actors.length * PART_COUNT;
    this.modelMeshes.forEach((mesh, index) => {
      pass.setVertexBuffer(0, mesh.vertexBuffer);
      pass.draw(mesh.vertexCount, 1, 0, firstModelInstance + index);
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    if (!reducedMotion) this.scheduleFrame();
  }

  viewport() {
    const aspect = this.width / Math.max(1, this.height);
    const distance = 11.2;
    const focal = 1 / Math.tan((42 * Math.PI / 180) * 0.5);
    const halfWidth = distance * aspect / focal;
    return {
      halfSpan: Math.min(4.8, halfWidth * (aspect > 1.25 ? 0.43 : 0.76)),
      offsetX: aspect > 1.25 ? halfWidth * 0.3 : 0,
      scaleFactor: aspect < 0.62 ? 0.78 : aspect < 0.9 ? 0.88 : 1,
      aspect,
      distance,
      focal,
      count: this.actors.length,
    };
  }

  updateCameraUniform() {
    const viewport = this.viewport();
    const position = [0, 2.55, viewport.distance];
    const target = [0, 1.18, 0];
    const forward = normalize3([target[0] - position[0], target[1] - position[1], target[2] - position[2]]);
    const right = normalize3(cross3(forward, [0, 1, 0]));
    const up = normalize3(cross3(right, forward));
    const nearPlane = 0.1;
    const farPlane = 60;
    const uniform = new Float32Array([
      ...position, 0,
      ...right, 0,
      ...up, 0,
      ...forward, 0,
      viewport.focal, viewport.aspect, nearPlane, farPlane,
    ]);
    this.device.queue.writeBuffer(this.cameraBuffer, 0, uniform);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    this.riggedOrchestrator?.destroy();
    this.riggedOrchestrator = null;
    if (this.rafId) this.window.cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.window.removeEventListener('resize', this.resizeHandler);
    this.depthTexture?.destroy();
    this.vertexBuffer?.destroy();
    this.modelMeshes.forEach((mesh) => mesh.vertexBuffer?.destroy());
    this.instanceBuffer?.destroy();
    this.cameraBuffer?.destroy();
    this.device?.destroy();
    this.canvas?.remove();
    this.canvas = null;
  }
}
