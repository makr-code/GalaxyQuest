import {
  AmbientLight,
  AnimationMixer,
  Box3,
  Color,
  DirectionalLight,
  Group,
  LoopOnce,
  LoopRepeat,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const IDLE_CLIP = /idle|breathe|breath|stand|rest/i;
const GREETING_CLIP = /greet|wave|salute|hello|talk/i;
const BONE_NAME = /(?:right|_r|\.r).*?(?:arm|shoulder)|(?:arm|shoulder).*?(?:right|_r|\.r)/i;
const MODEL_URLS = {
  high: 'generated/dev-only/heralds/generic_humanoid_base.glb',
  medium: 'generated/dev-only/heralds/generic_humanoid_base_lod_medium.glb',
  low: 'generated/dev-only/heralds/generic_humanoid_base_lod_low.glb',
};
const COLORS = {
  aereth: 0x2eadd8,
  vor_tak: 0xc75639,
  syl_nar: 0x38a77d,
  vel_ar: 0x8c61c5,
  kryl_tha: 0x9cae3d,
  zhareen: 0xdca94a,
};

export function selectHeraldAnimationClips(clips = []) {
  const idle = clips.find((clip) => IDLE_CLIP.test(clip.name)) || null;
  const greeting = clips.find((clip) => GREETING_CLIP.test(clip.name) && clip !== idle) || null;
  return { idle, greeting };
}

export function selectHeraldLod(height, pixelRatio = 1, aspect = 1) {
  const widthScale = aspect < 0.8 ? 0.66 : aspect < 1.2 ? 0.82 : 1;
  const projectedHeight = Math.max(0, height) * Math.min(1.5, Math.max(1, pixelRatio))
    * 2.45 * widthScale / (2 * 10.8 * Math.tan((38 * Math.PI / 180) * 0.5));
  if (projectedHeight >= 280) return 'high';
  if (projectedHeight >= 145) return 'medium';
  return 'low';
}

export class RegistrationHeraldModelOrchestrator {
  constructor({
    modelUrl = null,
    modelUrls = MODEL_URLS,
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    rendererFactory = (options) => new WebGPURenderer(options),
    loaderFactory = () => new GLTFLoader(),
    skeletonClone = SkeletonUtils.clone,
  } = {}) {
    this.modelUrls = modelUrl
      ? { high: modelUrl, medium: modelUrl, low: modelUrl }
      : { ...MODEL_URLS, ...modelUrls };
    this.window = windowRef;
    this.document = documentRef;
    this.rendererFactory = rendererFactory;
    this.loaderFactory = loaderFactory;
    this.skeletonClone = skeletonClone;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.actors = [];
    this.actorDefinitions = [];
    this.currentQuality = null;
    this.qualityLoadPromise = null;
    this.pendingQuality = null;
    this.visible = false;
    this.destroyed = false;
    this.focusCode = null;
    this.selectedCode = null;
    this.resizeObserver = null;
    this.rafId = 0;
    this.previousTime = 0;
    this.reducedMotion = false;
    this._frame = (timestamp) => this.render(timestamp);
  }

  async mount(container, actors) {
    if (!this.window?.navigator?.gpu || !container || this.destroyed) return false;
    try {
      if (!await this.window.navigator.gpu.requestAdapter()) return false;
    } catch {
      return false;
    }
    this.container = container;
    this.actorDefinitions = actors.slice();
    const loaded = await this.loadModel(this.selectQuality());
    if (!loaded) return false;
    const { gltf } = loaded;
    if (this.destroyed || !gltf?.scene) return false;
    this.currentQuality = loaded.quality;

    this.canvas = this.document.createElement('canvas');
    this.canvas.className = 'registration-herald-canvas registration-herald-canvas-rigged';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.focusedHerald = this.focusCode || '';
    this.canvas.dataset.selectedHerald = this.selectedCode || '';
    container.prepend(this.canvas);

    try {
      this.renderer = this.rendererFactory({ canvas: this.canvas, alpha: true, antialias: true });
      await this.renderer.init();
      if (this.renderer.backend?.isWebGPUBackend !== true) {
        this.window.GQLog?.info?.('[registration-herald-webgpu]', 'Three.js selected a non-WebGPU backend; using the native WebGPU mesh stage.');
        this.destroy();
        return false;
      }
      if (this.destroyed) {
        this.destroy();
        return false;
      }
      this.scene = new Scene();
      this.camera = new PerspectiveCamera(38, 1, 0.1, 100);
      this.scene.add(new AmbientLight(0xffffff, 1.8));
      const keyLight = new DirectionalLight(0xffefd7, 3.2);
      keyLight.position.set(-4, 7, 8);
      this.scene.add(keyLight);
      const rimLight = new DirectionalLight(0x9dc6ff, 2.2);
      rimLight.position.set(4, 4, -5);
      this.scene.add(rimLight);
      this.addActors(gltf, actors);
      this.resizeObserver = new this.window.ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
      this.resize();
      this.previousTime = this.window.performance?.now?.() || performance.now();
      this.reducedMotion = this.document.body?.dataset.startReducedMotion === 'true';
      this.render(this.previousTime);
      return true;
    } catch (error) {
      this.window.GQLog?.warn?.('[registration-herald-webgpu]', String(error?.message || error));
      this.destroy();
      return false;
    }
  }

  selectQuality() {
    const rect = this.container?.getBoundingClientRect();
    if (!rect) return 'high';
    return selectHeraldLod(rect.height, this.window.devicePixelRatio || 1, rect.width / Math.max(1, rect.height));
  }

  async loadModel(quality) {
    const qualities = [...new Set([quality, 'high', 'medium', 'low'])];
    let lastError = null;
    for (const candidate of qualities) {
      const url = this.modelUrls[candidate];
      if (!url) continue;
      try {
        const gltf = await this.loaderFactory().loadAsync(url);
        return { gltf, quality: candidate };
      } catch (error) {
        lastError = error;
      }
    }
    this.window.GQLog?.info?.('[registration-herald-glb]', `No GLB LOD available; using built-in mesh stage: ${String(lastError?.message || lastError)}`);
    return null;
  }

  addActors(gltf, actors = []) {
    const sourceBounds = new Box3().setFromObject(gltf.scene);
    const sourceHeight = Math.max(0.001, sourceBounds.max.y - sourceBounds.min.y);
    const scale = 2.45 / sourceHeight;
    const spacing = actors.length > 1 ? 1.0 : 0;
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const horizontalScale = aspect < 0.8 ? 0.66 : aspect < 1.2 ? 0.82 : 1;

    actors.forEach((actor, index) => {
      const root = new Group();
      const model = this.skeletonClone(gltf.scene);
      model.scale.setScalar(scale * horizontalScale);
      model.position.y = -sourceBounds.min.y * scale * horizontalScale;
      const accent = new Color(COLORS[actor.code] || 0xbce6ff);
      model.traverse((object) => {
        if (!object.isMesh) return;
        const tintMaterial = (material) => {
          if (!material?.color) return material;
          const clone = material.clone();
          clone.color.lerp(accent, 0.12);
          return clone;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(tintMaterial)
          : tintMaterial(object.material);
      });
      root.add(model);
      const arc = index / Math.max(1, actors.length - 1) * 2 - 1;
      const x = (index - (actors.length - 1) * 0.5) * spacing * horizontalScale;
      root.position.set(x, 0, 0.28 * (1 - arc * arc));
      root.rotation.y = -x * 0.035;
      this.scene.add(root);

      const mixer = new AnimationMixer(model);
      const { idle, greeting } = selectHeraldAnimationClips(gltf.animations);
      const idleAction = idle ? mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play() : null;
      const greetingAction = greeting ? mixer.clipAction(greeting).setLoop(LoopOnce, 1) : null;
      const greetingBone = this.findGreetingBone(model);
      this.actors.push({
        code: actor.code,
        root,
        model,
        mixer,
        idleAction,
        greetingAction,
        greetingBone,
        greetingBase: greetingBone?.quaternion.clone() || null,
        greetingStarted: false,
        accent,
      });
    });
  }

  findGreetingBone(model) {
    const bones = [];
    model.traverse((node) => {
      if (node.isBone && BONE_NAME.test(node.name)) bones.push(node);
    });
    return bones.find((bone) => /upperarm_r|right.*upperarm/i.test(bone.name)) || bones[0] || null;
  }

  clearActors() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    for (const actor of this.actors) {
      actor.mixer.stopAllAction();
      actor.mixer.uncacheRoot(actor.model);
      this.scene?.remove(actor.root);
      actor.model.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        }
      });
    }
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    this.actors = [];
  }

  async loadQuality(quality) {
    if (this.destroyed || quality === this.currentQuality) return;
    if (this.qualityLoadPromise) {
      this.pendingQuality = quality;
      return this.qualityLoadPromise;
    }
    this.qualityLoadPromise = (async () => {
      const loaded = await this.loadModel(quality);
      if (this.destroyed || !loaded) return;
      this.clearActors();
      this.addActors(loaded.gltf, this.actorDefinitions);
      this.currentQuality = loaded.quality;
      const focusedActor = this.actors.find((actor) => actor.code === this.focusCode);
      if (focusedActor?.greetingAction && !this.reducedMotion) {
        focusedActor.idleAction?.stop();
        focusedActor.greetingAction.reset().play();
        focusedActor.greetingStarted = true;
      }
      if (this.visible) this.render(this.window.performance?.now?.() || performance.now());
    })().finally(() => {
      this.qualityLoadPromise = null;
      const pendingQuality = this.pendingQuality;
      this.pendingQuality = null;
      if (pendingQuality && pendingQuality !== this.currentQuality) void this.loadQuality(pendingQuality);
    });
    return this.qualityLoadPromise;
  }

  resize() {
    if (!this.canvas || !this.renderer) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const desiredQuality = this.selectQuality();
    if (this.currentQuality && desiredQuality !== this.currentQuality) void this.loadQuality(desiredQuality);
    const pixelRatio = Math.min(this.window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.position.set(this.camera.aspect > 1.2 ? 1.5 : 0, 2.05, 10.8);
    this.camera.lookAt(this.camera.aspect > 1.2 ? 1.1 : 0, 1.2, 0);
    this.camera.updateProjectionMatrix();
  }

  setVisible(visible) {
    this.visible = visible === true;
    if (this.canvas) this.canvas.hidden = !this.visible;
    if (!this.visible) {
      if (this.rafId) this.window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      return;
    }
    this.scheduleFrame();
  }

  setFocus(code) {
    const previous = this.actors.find((item) => item.code === this.focusCode);
    if (previous && previous.code !== code) {
      previous.greetingAction?.stop();
      previous.greetingStarted = false;
      previous.greetingBone?.quaternion.copy(previous.greetingBase);
      previous.idleAction?.reset().play();
    }
    this.focusCode = code || null;
    if (this.canvas) this.canvas.dataset.focusedHerald = this.focusCode || '';
    const actor = this.actors.find((item) => item.code === this.focusCode);
    if (!this.reducedMotion && actor?.greetingAction && !actor.greetingAction.isRunning()) {
      actor.idleAction?.stop();
      actor.greetingAction.reset().play();
      actor.greetingStarted = true;
    }
    this.scheduleFrame();
  }

  setSelected(code) {
    this.selectedCode = code || null;
    this.setFocus(code);
    if (this.canvas) this.canvas.dataset.selectedHerald = this.selectedCode || '';
  }

  scheduleFrame() {
    if (!this.visible || this.rafId || this.destroyed || !this.renderer) return;
    this.rafId = this.window.requestAnimationFrame(this._frame);
  }

  render(timestamp) {
    this.rafId = 0;
    if (!this.visible || this.destroyed || !this.renderer) return;
    const now = Number(timestamp) || this.window.performance?.now?.() || performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - this.previousTime) / 1000));
    this.previousTime = now;
    if (!this.reducedMotion) {
      for (const actor of this.actors) {
        actor.mixer.update(delta);
        actor.root.position.y = Math.sin(now / 580 + actor.root.position.x) * 0.018;
        actor.root.rotation.y = -actor.root.position.x * 0.035 + Math.sin(now / 1700 + actor.root.position.x) * 0.025;
        if (actor.code === this.focusCode && !actor.greetingAction && actor.greetingBone && actor.greetingBase) {
          const wave = 0.75 + Math.sin(now / 170) * 0.12;
          actor.greetingBone.quaternion.copy(actor.greetingBase)
            .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -wave));
        } else if (actor.code !== this.focusCode && actor.greetingBone && actor.greetingBase) {
          actor.greetingBone.quaternion.copy(actor.greetingBase);
        }
        if (actor.greetingStarted && actor.greetingAction && !actor.greetingAction.isRunning()) {
          actor.greetingStarted = false;
          actor.idleAction?.reset().play();
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (!this.reducedMotion) this.scheduleFrame();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    if (this.rafId) this.window.cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.clearActors();
    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose?.();
    });
    this.renderer?.dispose?.();
    this.canvas?.remove();
    this.renderer = null;
    this.canvas = null;
    this.actors = [];
  }
}