import {
  Box3, BoxGeometry, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Group, Matrix3, Matrix4,
  Mesh, MeshStandardMaterial, ObjectLoader, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHeroBattleModel } from './hero-battle-models.js';
import { fleetVisualLod } from './fleet-visual-lod.js';
import { isHeroShipActive } from './hero-battle-waves.js';
import * as THREE from 'three';
import './SystemSpecialBodiesRenderer.js';

const VESSEL_SHADER = `
struct VesselUniforms {
  viewProjection: mat4x4<f32>,
  model: mat4x4<f32>,
  tint: vec4<f32>,
  light: vec4<f32>,
  cameraTime: vec4<f32>,
  effects: vec4<f32>,
  contact: vec4<f32>,
  shield: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: VesselUniforms;
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPosition: vec3<f32>,
  @location(2) surface: vec4<f32>,
};
@vertex fn vertexMain(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) surface: vec4<f32>,
) -> VertexOutput {
  let worldPosition = uniforms.model * vec4<f32>(position, 1.0);
  var output: VertexOutput;
  let clip = uniforms.viewProjection * worldPosition;
  output.position = vec4(clip.xy, (clip.z + clip.w) * 0.5, clip.w);
  output.normal = normalize((uniforms.model * vec4<f32>(normal, 0.0)).xyz);
  output.worldPosition = worldPosition.xyz;
  output.surface = surface;
  return output;
}
@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let normal = normalize(input.normal);
  let facing = max(0.0, dot(normal, normalize(uniforms.contact.xyz + vec3(0.000001))));
  if (uniforms.effects.w > 0.5) {
    let distance = acos(clamp(dot(normal, normalize(uniforms.contact.xyz)), -1.0, 1.0));
    let ring = exp(-pow((distance - uniforms.contact.w * 2.8) * 12.0, 2.0));
    let spot = pow(facing, 32.0);
    let viewDirection = normalize(-input.worldPosition);
    let rim = pow(1.0 - abs(dot(normal, viewDirection)), 2.4);
    let shimmer = 0.85 + 0.15 * sin(uniforms.cameraTime.w * 2.0 + normal.y * 18.0 + normal.z * 12.0);
    let ambient = (0.025 + rim * 0.18) * shimmer * uniforms.shield.x;
    return vec4(vec3(0.12, 0.55, 1.6), ambient + (ring * 0.65 + spot * 0.9) * uniforms.effects.y);
  }
  let lightDirection = normalize(uniforms.light.xyz);
  let viewDirection = normalize(uniforms.cameraTime.xyz - input.worldPosition);
  let halfDirection = normalize(lightDirection + viewDirection);
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let specular = pow(max(dot(normal, halfDirection), 0.0), 28.0) * 0.42;
  let rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.6) * 0.28;
  let engine = clamp(input.surface.a, 0.0, 1.0);
  let pulse = uniforms.effects.x * (0.88 + 0.12 * sin(uniforms.cameraTime.w * 13.0));
  let hull = input.surface.rgb * uniforms.tint.rgb
    * (uniforms.light.w + diffuse * 0.9 + specular + rim);
  let emission = input.surface.rgb * (1.1 + pulse * 1.2) * engine;
  let flash = pow(facing, 12.0) * (uniforms.effects.y * vec3(0.25, 0.7, 1.0)
    + uniforms.effects.z * vec3(1.0, 0.32, 0.08));
  return vec4<f32>(hull * (1.0 - engine) + emission + flash, uniforms.tint.a);
}
`;

const VESSEL_PARTICLE_SHADER = `
struct ParticleUniforms {
  viewProjection: mat4x4<f32>,
  model: mat4x4<f32>,
  cameraRight: vec4<f32>,
  cameraUp: vec4<f32>,
  timeScale: vec4<f32>,
};
@group(0) @binding(0) var<uniform> uniforms: ParticleUniforms;
struct ParticleOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) age: f32,
};
@vertex fn vertexMain(
  @builtin(vertex_index) vertex: u32,
  @location(0) particle: vec4<f32>,
) -> ParticleOutput {
  let corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0),
    vec2(-1.0, 1.0), vec2(1.0, -1.0), vec2(1.0, 1.0));
  let uv = corners[vertex];
  let age = fract(uniforms.timeScale.x * particle.z + particle.w);
  let drift = vec2(sin(particle.x * 17.0 + age * 8.0), cos(particle.x * 11.0 + age * 7.0));
  let localCenter = vec3(-0.53 - age * 0.58, drift * (0.035 + age * 0.07));
  let worldCenter = (uniforms.model * vec4(localCenter, 1.0)).xyz;
  let size = particle.y * uniforms.timeScale.y * (0.55 + age * 0.8);
  let worldPosition = worldCenter
    + uniforms.cameraRight.xyz * uv.x * size
    + uniforms.cameraUp.xyz * uv.y * size;
  var output: ParticleOutput;
  output.position = uniforms.viewProjection * vec4(worldPosition, 1.0);
  output.uv = uv;
  output.age = age;
  return output;
}
@fragment fn fragmentMain(input: ParticleOutput) -> @location(0) vec4<f32> {
  let radial = max(0.0, 1.0 - length(input.uv));
  let fade = (1.0 - input.age) * radial * radial;
  let color = mix(vec3(0.45, 0.9, 1.0), vec3(1.0, 0.3, 0.08), input.age * 0.72);
  return vec4(color * 1.8, fade * 0.72);
}
`;

export class SpaceVesselRenderPass {
  constructor({ loaderFactory = () => new GLTFLoader() } = {}) {
    this.loaderFactory = loaderFactory;
    this.assets = new Map();
    this.resources = new Map();
    this.pendingLoads = new Map();
    this.device = null;
    this.format = null;
    this.pipeline = null;
    this.particlePipeline = null;
    this.pipelineVersion = 0;
  }

  initialize(device, format) {
    if (this.device === device && this.format === format) return;
    this._destroyPipelines();
    for (const resource of this.resources.values()) this._destroyInstanceBindings(resource);
    for (const asset of this.assets.values()) this._destroyAssetBuffers(asset);
    this.device = device;
    this.format = format;
    for (const asset of this.assets.values()) {
      if (asset.ready && asset.refCount > 0) this._uploadAsset(asset);
    }
  }

  async load(vessel) {
    if (this.resources.has(vessel.id)) return this.resources.get(vessel.id);
    const pending = { generation: Symbol(vessel.id), asset: null, released: false };
    this.pendingLoads.set(vessel.id, pending);
    const hasEngineEffects = vessel.kind === 'vessel' && vessel.engineEffects !== false;
    const assetKey = `${vessel.modelUrl}#${hasEngineEffects ? 'vessel-effects' : 'static-object'}`;
    try {
      let asset = this.assets.get(assetKey);
      if (!asset) {
        asset = {
          key: assetKey,
          modelUrl: vessel.modelUrl,
          hasEngineEffects,
          refCount: 0,
          ready: false,
          promise: null,
          vertices: null,
          vertexCount: 0,
          engineVertexOffset: 0,
          engineVertexCount: 0,
          particleInstances: null,
          particleCount: 0,
          vertexBuffer: null,
          particleBuffer: null,
        };
        this.assets.set(assetKey, asset);
        asset.promise = this._loadAsset(asset).catch((error) => {
          if (this.assets.get(assetKey) === asset) this.assets.delete(assetKey);
          throw error;
        });
      }
      pending.asset = asset;
      asset.refCount += 1;
      await asset.promise;
      if (this.pendingLoads.get(vessel.id) !== pending || pending.released) {
        if (!pending.released) this._releaseAsset(asset);
        pending.released = true;
        return null;
      }
      const resource = this._createInstanceResource(vessel, asset);
      this.resources.set(vessel.id, resource);
      if (this.device && !asset.vertexBuffer) this._uploadAsset(asset);
      return resource;
    } catch (error) {
      if (pending.asset && !pending.released) {
        pending.released = true;
        this._releaseAsset(pending.asset);
      }
      throw error;
    } finally {
      if (this.pendingLoads.get(vessel.id) === pending) this.pendingLoads.delete(vessel.id);
    }
  }

  remove(id) {
    const vesselId = String(id);
    const pending = this.pendingLoads.get(vesselId);
    if (pending) {
      this.pendingLoads.delete(vesselId);
      if (!pending.released && pending.asset) {
        pending.released = true;
        this._releaseAsset(pending.asset);
      }
    }
    const resource = this.resources.get(vesselId);
    if (!resource) return Boolean(pending);
    this._destroyInstanceBindings(resource);
    this.resources.delete(vesselId);
    this._releaseAsset(resource.asset);
    return true;
  }

  _createInstanceResource(vessel, asset) {
    return {
      id: vessel.id,
      asset,
      uniformBuffer: null,
      bindGroup: null,
      particleUniformBuffer: null,
      particleBindGroup: null,
      pipelineVersion: -1,
    };
  }

  render(pass, vessels, camera, origin, effectTime, depthEnabled = false, lodHeight = null) {
    this.frameStats = { near: 0, middle: 0, far: 0, hidden: 0, drawCalls: 0, vertices: 0, shields: 0 };
    if (!this.device || !vessels.length) return;
    if (this.depthEnabled !== depthEnabled) {
      this.depthEnabled = depthEnabled;
      this._destroyPipelines();
    }
    this._ensurePipelines();
    // Subtract the eye in double precision before uploading planet-scale geometry to f32.
    const viewRotation = camera.matrixWorldInverse.clone().setPosition(0, 0, 0);
    const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, viewRotation);
    const world = camera.matrixWorld.elements;
    for (const vessel of vessels) {
      if (!isHeroShipActive(vessel)) continue;
      const resource = this.resources.get(vessel.id);
      const asset = resource?.asset;
      if (!asset?.vertexBuffer) continue;
      const tier = lodHeight === null ? 'near'
        : fleetVisualLod(vessel.position, vessel.scale, camera, origin, lodHeight, resource.visualTier).tier;
      resource.visualTier = tier;
      this.frameStats[tier]++;
      if (tier === 'hidden') continue;
      const draw = (vertices, instances = 1, firstVertex = 0) => {
        pass.draw(vertices, instances, firstVertex, 0);
        this.frameStats.drawCalls++;
        this.frameStats.vertices += vertices * instances;
      };
      this._ensureBindings(resource);
      const model = new Matrix4().compose(vessel.position.clone().sub(origin).sub(camera.position), vessel.quaternion,
        new Vector3(vessel.scale, vessel.scale, vessel.scale));
      const uniforms = new Float32Array(56);
      uniforms.set(viewProjection.elements, 0);
      uniforms.set(model.elements, 16);
      uniforms.set(vessel.color, 32);
      uniforms.set([0.38, -0.5, 0.78, 0.24], 36);
      uniforms.set([0, 0, 0, effectTime], 40);
      const shieldStrength = vessel.heroStatus?.shield ?? 0;
      const shieldHit = vessel.heroStatus && shieldStrength <= 0 ? 0 : vessel.heroLight?.shield || 0;
      uniforms.set([1, shieldHit, vessel.heroLight?.hull || 0, 0], 44);
      uniforms.set([...(vessel.heroContact?.normal.clone().applyQuaternion(vessel.quaternion).toArray() || [0, 0, 1]),
        vessel.heroContact?.age || 0], 48);
      uniforms.set([shieldStrength, 0, 0, 0], 52);
      this.device.queue.writeBuffer(resource.uniformBuffer, 0, uniforms);
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, resource.bindGroup);
      if (tier === 'far') this._ensureLodBuffer(asset);
      pass.setVertexBuffer(0, tier === 'far' ? asset.lodBuffer : asset.vertexBuffer);
      draw(tier === 'far' ? 36 : asset.vertexCount);
      if (tier !== 'far' && asset.engineVertexCount > 0) {
        draw(asset.engineVertexCount, 1, asset.engineVertexOffset);
      }
      if (tier === 'near' && asset.rig && vessel.turretQuaternion) {
        resource.turret ||= this._createInstanceResource(vessel, asset);
        this._ensureBindings(resource.turret);
        const turretModel = model.clone()
          .multiply(new Matrix4().makeTranslation(...asset.rig.pivot.toArray()))
          .multiply(new Matrix4().makeRotationFromQuaternion(vessel.turretQuaternion))
          .multiply(new Matrix4().makeTranslation(-Math.min(0.04, vessel.turretRecoil || 0), 0, 0));
        const turretUniforms = uniforms.slice();
        turretUniforms.set(turretModel.elements, 16);
        this.device.queue.writeBuffer(resource.turret.uniformBuffer, 0, turretUniforms);
        pass.setBindGroup(0, resource.turret.bindGroup);
        pass.setVertexBuffer(0, asset.turretBuffer);
        draw(asset.rig.vertices.length / 10);
      }
      if (this.shieldPipeline && tier !== 'far' && asset.shieldBuffer && (shieldStrength > 0 || shieldHit > 0.01)) {
        resource.shield ||= this._createInstanceResource(vessel, asset);
        this._ensureBindings(resource.shield);
        const shieldUniforms = uniforms.slice();
        shieldUniforms[47] = 1;
        this.device.queue.writeBuffer(resource.shield.uniformBuffer, 0, shieldUniforms);
        pass.setPipeline(this.shieldPipeline);
        pass.setBindGroup(0, resource.shield.shieldBindGroup);
        pass.setVertexBuffer(0, asset.shieldBuffer);
        draw(asset.shieldVertices.length / 10);
        this.frameStats.shields++;
      }

      if (tier !== 'near' || asset.particleCount === 0) continue;
      const particleUniforms = new Float32Array(44);
      particleUniforms.set(viewProjection.elements, 0);
      particleUniforms.set(model.elements, 16);
      particleUniforms.set([world[0], world[1], world[2], 0], 32);
      particleUniforms.set([world[4], world[5], world[6], 0], 36);
      particleUniforms.set([effectTime, vessel.scale, asset.particleCount, 0], 40);
      this.device.queue.writeBuffer(resource.particleUniformBuffer, 0, particleUniforms);
      pass.setPipeline(this.particlePipeline);
      pass.setBindGroup(0, resource.particleBindGroup);
      pass.setVertexBuffer(0, asset.particleBuffer);
      draw(6, asset.particleCount);
    }
  }

  async _loadAsset(asset) {
    const gltf = await this._loadModel(asset.modelUrl);
    if (asset.refCount === 0 || this.assets.get(asset.key) !== asset) {
      if (this.assets.get(asset.key) === asset) this.assets.delete(asset.key);
      return asset;
    }
    const scene = gltf?.scene;
    scene?.updateMatrixWorld(true);
    const bounds = scene ? new Box3().setFromObject(scene) : null;
    const center = bounds?.getCenter(new Vector3());
    const size = bounds?.getSize(new Vector3());
    const maxDimension = size ? Math.max(size.x, size.y, size.z) : 0;
    const normalization = { center, maxDimension, excludeTurrets: true };
    const hullVertices = this._extractVertices(scene, normalization);
    if (!hullVertices?.length) throw new Error('Space vessel has no triangle geometry.');
    const engineVertices = asset.hasEngineEffects ? this._createEngineFlameVertices() : new Float32Array();
    asset.vertices = new Float32Array(hullVertices.length + engineVertices.length);
    asset.vertices.set(hullVertices);
    asset.vertices.set(engineVertices, hullVertices.length);
    asset.vertexCount = hullVertices.length / 10;
    asset.lodSize = size.clone().divideScalar(maxDimension);
    let turret;
    scene.traverse((node) => { if (node.name === 'turret_primary') turret = node; });
    if (turret) {
      const muzzle = turret.getObjectByName('muzzle_primary');
      if (!muzzle) throw new Error('Model turret_primary requires muzzle_primary');
      const clone = turret.clone();
      clone.position.set(0, 0, 0);
      clone.quaternion.identity();
      clone.scale.set(1, 1, 1);
      const pivot = turret.getWorldPosition(new Vector3()).sub(center).divideScalar(maxDimension);
      const muzzlePosition = muzzle.getWorldPosition(new Vector3())
        .sub(turret.getWorldPosition(new Vector3()))
        .applyQuaternion(turret.getWorldQuaternion(new Quaternion()).invert()).divideScalar(maxDimension);
      asset.rig = { pivot, muzzle: muzzlePosition,
        vertices: this._extractVertices(clone, { center: new Vector3(), maxDimension }) };
      const shieldScene = new Group();
      const geometry = new SphereGeometry(0.65, 32, 24);
      const shieldMesh = new Mesh(geometry);
      shieldScene.add(shieldMesh);
      asset.shieldVertices = this._extractVertices(shieldScene, { center: new Vector3(), maxDimension: 1 });
      geometry.dispose();
      shieldMesh.material.dispose();
    }
    asset.engineVertexOffset = asset.vertexCount;
    asset.engineVertexCount = engineVertices.length / 10;
    asset.particleInstances = asset.hasEngineEffects ? this._buildParticleInstances() : new Float32Array();
    asset.particleCount = asset.particleInstances.length / 4;
    asset.ready = true;
    if (asset.modelUrl.startsWith('procedural:hero-')) {
      const materials = new Set();
      scene.traverse((node) => {
        node.geometry?.dispose();
        if (node.material) {
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
        }
      });
      for (const material of materials) material.dispose();
    }
    if (this.device && asset.refCount > 0) this._uploadAsset(asset);
    if (asset.refCount === 0 && this.assets.get(asset.key) === asset) this.assets.delete(asset.key);
    return asset;
  }

  async _loadModel(modelUrl) {
    if (modelUrl.startsWith('procedural:hero-')) {
      return { scene: createHeroBattleModel(modelUrl.slice('procedural:hero-'.length)) };
    }
    if (modelUrl.startsWith('procedural:')) {
      return { scene: this._createProceduralScene(modelUrl.slice('procedural:'.length)) };
    }
    if (/\.json(?:$|[?#])/i.test(modelUrl)) {
      const response = await fetch(modelUrl);
      if (!response.ok) throw new Error(`Space model request failed with HTTP ${response.status}.`);
      const descriptor = await response.json();
      const loader = new ObjectLoader();
      loader.setResourcePath('/');
      const scene = await new Promise((resolve, reject) => {
        try {
          loader.parse(descriptor, resolve);
        } catch (error) {
          reject(error);
        }
      });
      return { scene };
    }
    return this.loaderFactory().loadAsync(modelUrl);
  }

  _createProceduralScene(kind) {
    if (kind === 'comet') {
      const comet = window.GQSystemSpecialBodiesRenderer.buildCometMesh(THREE, { seed: 5, tailParticles: 30 });
      const nucleus = comet.userData.nucleusMesh;
      nucleus.removeFromParent();
      comet.traverse((node) => {
        node.geometry?.dispose();
        node.material?.dispose();
      });
      nucleus.geometry.dispose();
      nucleus.geometry = new SphereGeometry(0.6, 48, 32);
      const positions = nucleus.geometry.getAttribute('position');
      const colors = [];
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index) / 0.6;
        const y = positions.getY(index) / 0.6;
        const z = positions.getZ(index) / 0.6;
        const strata = Math.sin(x * 7 + Math.sin(z * 5)) * Math.cos(y * 6 - z * 3);
        const coarse = Math.sin(x * 11 + y * 8) * Math.sin(z * 13 - y * 5);
        const fine = Math.sin(x * 27 + z * 19) * Math.cos(y * 23 - x * 12);
        const deformation = 1 + 0.18 * strata + 0.07 * coarse + 0.025 * fine;
        positions.setXYZ(index, x * 0.6 * deformation, y * 0.6 * deformation, z * 0.6 * deformation);
        const ice = Math.max(0, Math.min(1, 0.48 + strata * 0.42 + coarse * 0.3 + fine * 0.12));
        colors.push(0.12 + ice * 0.52, 0.14 + ice * 0.57, 0.16 + ice * 0.6);
      }
      nucleus.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      nucleus.geometry.computeVertexNormals();
      nucleus.material.color.setRGB(1, 1, 1);
      nucleus.material.vertexColors = true;
      return nucleus;
    }
    const root = new Group();
    const hullMaterial = new MeshStandardMaterial({ color: 0x4f8890, metalness: 0.3, roughness: 0.62 });
    const roofMaterial = new MeshStandardMaterial({ color: 0x8db6ad, metalness: 0.16, roughness: 0.48 });
    const lightMaterial = new MeshStandardMaterial({
      color: 0x75f0db, emissive: 0x32bca7, emissiveIntensity: 0.8, roughness: 0.28,
    });
    if (kind === 'colony') {
      const centralHabitat = new Mesh(new SphereGeometry(0.58, 20, 14), roofMaterial);
      centralHabitat.scale.set(1.25, 0.82, 0.86);
      centralHabitat.position.set(0, 0, 0.38);
      root.add(centralHabitat);
      for (const [x, y, scale] of [[-0.8, -0.25, 0.52], [0.76, 0.32, 0.42], [0.12, 0.78, 0.34]]) {
        const dome = new Mesh(new SphereGeometry(scale, 16, 12), hullMaterial);
        dome.scale.z = 0.76;
        dome.position.set(x, y, scale * 0.6);
        root.add(dome);
      }
      const beacon = new Mesh(new SphereGeometry(0.08, 12, 8), lightMaterial);
      beacon.position.set(0, 0, 1.05);
      root.add(beacon);
      return root;
    }
    const base = new Mesh(new BoxGeometry(1.3, 0.9, 0.42), hullMaterial);
    base.position.z = 0.21;
    root.add(base);
    const tower = new Mesh(new CylinderGeometry(0.22, 0.3, 0.85, 10), roofMaterial);
    tower.position.set(0, 0, 0.82);
    root.add(tower);
    const roof = new Mesh(new ConeGeometry(0.34, 0.32, 10), hullMaterial);
    roof.position.set(0, 0, 1.4);
    root.add(roof);
    const beacon = new Mesh(new SphereGeometry(0.09, 12, 8), lightMaterial);
    beacon.position.set(0, 0, 1.67);
    root.add(beacon);
    return root;
  }

  _extractVertices(scene, normalization = {}) {
    if (!scene) return null;
    scene.updateMatrixWorld(true);
    const positions = [];
    const normals = [];
    const surfaceColors = [];
    const bounds = new Box3();
    const position = new Vector3();
    const normal = new Vector3();
    scene.traverse((node) => {
      if (normalization.excludeTurrets) {
        for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
          if (ancestor.name === 'turret_primary') return;
        }
      }
      if (!node.isMesh || !node.geometry?.getAttribute('position')) return;
      const geometry = node.geometry;
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const positionAttribute = geometry.getAttribute('position');
      const normalAttribute = geometry.getAttribute('normal');
      const normalMatrix = new Matrix3().getNormalMatrix(node.matrixWorld);
      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      const colorAttribute = material?.vertexColors ? geometry.getAttribute('color') : null;
      const baseColor = material?.color?.toArray?.() || [0.58, 0.72, 0.84];
      const emissiveColor = material?.emissive?.toArray?.() || [0, 0, 0];
      const hasEmission = emissiveColor.some((channel) => channel > 0);
      const emissionLevel = hasEmission
        ? Math.max(0, Math.min(0.65, (Number(material.emissiveIntensity) || 0) * 0.25))
        : 0;
      const surfaceColor = baseColor.map((channel, index) =>
        channel * (1 - emissionLevel) + emissiveColor[index] * emissionLevel);
      const index = geometry.index;
      const count = index ? index.count : positionAttribute.count;
      for (let offset = 0; offset + 2 < count; offset += 3) {
        for (let corner = 0; corner < 3; corner += 1) {
          const vertexIndex = index ? index.getX(offset + corner) : offset + corner;
          position.fromBufferAttribute(positionAttribute, vertexIndex).applyMatrix4(node.matrixWorld);
          normal.fromBufferAttribute(normalAttribute, vertexIndex).applyMatrix3(normalMatrix).normalize();
          positions.push(position.x, position.y, position.z);
          normals.push(normal.x, normal.y, normal.z);
          surfaceColors.push(
            surfaceColor[0] * (colorAttribute?.getX(vertexIndex) ?? 1),
            surfaceColor[1] * (colorAttribute?.getY(vertexIndex) ?? 1),
            surfaceColor[2] * (colorAttribute?.getZ(vertexIndex) ?? 1), emissionLevel,
          );
          bounds.expandByPoint(position);
        }
      }
    });
    if (!positions.length) return null;
    const center = normalization.center || bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const maxDimension = normalization.maxDimension || Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDimension) || maxDimension <= 0) return null;
    const vertices = new Float32Array((positions.length / 3) * 10);
    for (let index = 0; index < positions.length / 3; index += 1) {
      const positionOffset = index * 3;
      const surfaceOffset = index * 4;
      const vertexOffset = index * 10;
      vertices[vertexOffset] = (positions[positionOffset] - center.x) / maxDimension;
      vertices[vertexOffset + 1] = (positions[positionOffset + 1] - center.y) / maxDimension;
      vertices[vertexOffset + 2] = (positions[positionOffset + 2] - center.z) / maxDimension;
      vertices[vertexOffset + 3] = normals[positionOffset];
      vertices[vertexOffset + 4] = normals[positionOffset + 1];
      vertices[vertexOffset + 5] = normals[positionOffset + 2];
      vertices[vertexOffset + 6] = surfaceColors[surfaceOffset];
      vertices[vertexOffset + 7] = surfaceColors[surfaceOffset + 1];
      vertices[vertexOffset + 8] = surfaceColors[surfaceOffset + 2];
      vertices[vertexOffset + 9] = surfaceColors[surfaceOffset + 3];
    }
    return vertices;
  }

  _createEngineFlameVertices() {
    const values = [];
    const segments = 12;
    const rings = [{ x: -0.48, radius: 0.035 }, { x: -0.68, radius: 0.05 }, { x: -1.08, radius: 0.004 }];
    const colors = [[0.38, 0.85, 1, 0.9], [1, 0.36, 0.1, 1]];
    const point = (ring, angle) => [ring.x, Math.cos(angle) * ring.radius, Math.sin(angle) * ring.radius];
    const appendTriangle = (first, second, third, color) => {
      const a = new Vector3(...first);
      const normal = new Vector3().subVectors(new Vector3(...second), a)
        .cross(new Vector3(...third).sub(a)).normalize();
      for (const vertex of [first, second, third]) values.push(...vertex, normal.x, normal.y, normal.z, ...color);
    };
    for (let segment = 0; segment < segments; segment += 1) {
      const angle0 = (segment / segments) * Math.PI * 2;
      const angle1 = ((segment + 1) / segments) * Math.PI * 2;
      const nozzle0 = point(rings[0], angle0);
      const nozzle1 = point(rings[0], angle1);
      const middle0 = point(rings[1], angle0);
      const middle1 = point(rings[1], angle1);
      const tip0 = point(rings[2], angle0);
      const tip1 = point(rings[2], angle1);
      appendTriangle(nozzle0, middle0, middle1, colors[0]);
      appendTriangle(nozzle0, middle1, nozzle1, colors[0]);
      appendTriangle(middle0, tip0, tip1, colors[1]);
      appendTriangle(middle0, tip1, middle1, colors[1]);
    }
    return new Float32Array(values);
  }

  _buildParticleInstances(count = 18) {
    const instances = new Float32Array(count * 4);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      instances[offset] = index * 0.61803398875;
      instances[offset + 1] = 0.012 + (index % 4) * 0.006;
      instances[offset + 2] = 0.58 + (index % 5) * 0.09;
      instances[offset + 3] = index / count;
    }
    return instances;
  }

  _uploadAsset(asset) {
    if (typeof GPUBufferUsage === 'undefined') return;
    this._destroyAssetBuffers(asset);
    asset.vertexBuffer = this.device.createBuffer({ size: asset.vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(asset.vertexBuffer, 0, asset.vertices);
    if (asset.rig) {
      asset.turretBuffer = this.device.createBuffer({ size: asset.rig.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(asset.turretBuffer, 0, asset.rig.vertices);
      asset.shieldBuffer = this.device.createBuffer({ size: asset.shieldVertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(asset.shieldBuffer, 0, asset.shieldVertices);
    }
    if (asset.particleInstances.byteLength > 0) {
      asset.particleBuffer = this.device.createBuffer({ size: asset.particleInstances.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(asset.particleBuffer, 0, asset.particleInstances);
    }
  }

  _ensureLodBuffer(asset) {
    if (asset.lodBuffer) return;
    const geometry = new BoxGeometry(...asset.lodSize.toArray());
    const material = new MeshStandardMaterial({ color: 0x8295a8 });
    const mesh = new Mesh(geometry, material);
    const vertices = this._extractVertices(mesh, { center: new Vector3(), maxDimension: 1 });
    geometry.dispose();
    material.dispose();
    asset.lodBuffer = this.device.createBuffer({ size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(asset.lodBuffer, 0, vertices);
  }

  _releaseAsset(asset) {
    asset.refCount = Math.max(0, asset.refCount - 1);
    if (asset.refCount > 0 || !asset.ready) return;
    this._destroyAssetBuffers(asset);
    if (this.assets.get(asset.key) === asset) this.assets.delete(asset.key);
  }

  _destroyAssetBuffers(asset) {
    asset.vertexBuffer?.destroy();
    asset.particleBuffer?.destroy();
    asset.turretBuffer?.destroy();
    asset.shieldBuffer?.destroy();
    asset.lodBuffer?.destroy();
    asset.lodBuffer = null;
    asset.shieldBuffer = null;
    asset.turretBuffer = null;
    asset.vertexBuffer = null;
    asset.particleBuffer = null;
  }

  _ensurePipelines() {
    if (this.pipeline) return;
    const device = this.device;
    const shader = device.createShaderModule({ code: VESSEL_SHADER, label: 'space-vessel-mesh' });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vertexMain', buffers: [{
        arrayStride: 40,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x4' },
        ],
      }] },
      fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{
        format: this.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      ...(this.depthEnabled ? { depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less-equal' } } : {}),
    });
    if (this.depthEnabled) this.shieldPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vertexMain', buffers: [{
        arrayStride: 40, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x4' },
        ],
      }] },
      fragment: { module: shader, entryPoint: 'fragmentMain', targets: [{
        format: this.format, blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      ...(this.depthEnabled ? { depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'less-equal' } } : {}),
    });
    const particleShader = device.createShaderModule({ code: VESSEL_PARTICLE_SHADER, label: 'space-vessel-particles' });
    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: particleShader, entryPoint: 'vertexMain', buffers: [{
        arrayStride: 16,
        stepMode: 'instance',
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
      }] },
      fragment: { module: particleShader, entryPoint: 'fragmentMain', targets: [{
        format: this.format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
  }

  _ensureBindings(resource) {
    if (resource.pipelineVersion === this.pipelineVersion) return;
    this._destroyInstanceBindings(resource);
    resource.uniformBuffer = this.device.createBuffer({ size: 224,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    resource.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: resource.uniformBuffer } }] });
    if (this.shieldPipeline) resource.shieldBindGroup = this.device.createBindGroup({ layout: this.shieldPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: resource.uniformBuffer } }] });
    resource.particleUniformBuffer = this.device.createBuffer({ size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    resource.particleBindGroup = this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: resource.particleUniformBuffer } }],
    });
    resource.pipelineVersion = this.pipelineVersion;
  }

  _destroyInstanceBindings(resource) {
    if (resource.turret) this._destroyInstanceBindings(resource.turret);
    if (resource.shield) this._destroyInstanceBindings(resource.shield);
    resource.uniformBuffer?.destroy();
    resource.particleUniformBuffer?.destroy();
    resource.uniformBuffer = null;
    resource.bindGroup = null;
    resource.particleUniformBuffer = null;
    resource.particleBindGroup = null;
    resource.pipelineVersion = -1;
  }

  _destroyPipelines() {
    this.pipeline = null;
    this.shieldPipeline = null;
    this.particlePipeline = null;
    this.pipelineVersion += 1;
  }

  dispose() {
    for (const id of [...this.resources.keys()]) this.remove(id);
    for (const [id, pending] of this.pendingLoads) {
      this.pendingLoads.delete(id);
      if (!pending.released && pending.asset) {
        pending.released = true;
        this._releaseAsset(pending.asset);
      }
    }
    for (const asset of this.assets.values()) this._destroyAssetBuffers(asset);
    this.assets.clear();
    this._destroyPipelines();
    this.device = null;
    this.format = null;
  }
}