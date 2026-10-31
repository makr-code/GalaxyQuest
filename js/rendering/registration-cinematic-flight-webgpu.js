import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEFAULT_SHIP_URL = 'generated/trellis2/imported/ship/ship_generic_teaser_transfer_lod0_trellis2_dev.glb';
const ROUTE = [
  new Vector3(-1.6, 0.1, -2.6),
  new Vector3(-0.9, 0.35, -0.8),
  new Vector3(0.7, -0.05, 1.2),
  new Vector3(1.6, 0.25, 3.2),
];

export class RegistrationCinematicFlight {
  constructor({
    shipUrl = DEFAULT_SHIP_URL,
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    rendererFactory = (options) => new WebGPURenderer(options),
    loaderFactory = () => new GLTFLoader(),
  } = {}) {
    this.shipUrl = shipUrl;
    this.window = windowRef;
    this.document = documentRef;
    this.rendererFactory = rendererFactory;
    this.loaderFactory = loaderFactory;
    this.canvas = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.ship = null;
    this.beatIndex = 0;
    this.previousTime = 0;
    this.visible = false;
    this.reducedMotion = false;
    this.destroyed = false;
    this.rafId = 0;
    this.resizeObserver = null;
    this.frame = (timestamp) => this.render(timestamp);
  }

  async mount(container) {
    if (!this.window?.navigator?.gpu || !container || this.destroyed) return false;
    try {
      if (!await this.window.navigator.gpu.requestAdapter()) return false;
    } catch {
      return false;
    }

    try {
      const gltf = await this.loaderFactory().loadAsync(this.shipUrl);
      if (this.destroyed || !gltf?.scene) return false;
      this.canvas = this.document.createElement('canvas');
      this.canvas.className = 'registration-transfer-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      container.prepend(this.canvas);
      this.renderer = this.rendererFactory({ canvas: this.canvas, alpha: true, antialias: true });
      await this.renderer.init();
      if (this.destroyed || this.renderer.backend?.isWebGPUBackend !== true) {
        this.destroy();
        return false;
      }

      this.scene = new Scene();
      this.camera = new PerspectiveCamera(38, 1, 0.1, 100);
      this.scene.add(new AmbientLight(0xffffff, 1.6));
      const keyLight = new DirectionalLight(0xffefd7, 3.0);
      keyLight.position.set(-4, 7, 8);
      this.scene.add(keyLight);
      const rimLight = new DirectionalLight(0x9dc6ff, 2.4);
      rimLight.position.set(4, 3, -5);
      this.scene.add(rimLight);

      this.ship = gltf.scene;
      const bounds = new Box3().setFromObject(this.ship);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
        throw new Error('TRELLIS2 transfer ship has empty geometry.');
      }
      const scale = 2.7 / maxDimension;
      this.ship.scale.setScalar(scale);
      this.ship.position.copy(center).multiplyScalar(-scale).add(ROUTE[0]);
      this.ship.rotation.y = Math.PI;
      this.scene.add(this.ship);

      this.resizeObserver = new this.window.ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
      this.reducedMotion = this.document.body?.dataset.startReducedMotion === 'true';
      this.resize();
      this.followShip(1);
      this.previousTime = this.window.performance?.now?.() || performance.now();
      return true;
    } catch (error) {
      this.window.GQLog?.warn?.('[registration-cinematic-flight]', String(error?.message || error));
      this.destroy();
      return false;
    }
  }

  resize() {
    if (!this.canvas || !this.renderer || !this.camera) return;
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    this.renderer.setPixelRatio(Math.min(this.window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / rect.height;
    this.camera.position.set(this.camera.aspect > 1.2 ? -0.7 : -0.15, 1.35, -5.2);
    this.camera.updateProjectionMatrix();
    this.followShip(1);
    if (this.visible) this.scheduleFrame();
  }

  setBeat(index) {
    this.beatIndex = Math.max(0, Math.min(ROUTE.length - 1, Number(index) || 0));
    if (this.ship && this.reducedMotion) {
      const center = new Box3().setFromObject(this.ship).getCenter(new Vector3());
      this.ship.position.add(ROUTE[this.beatIndex].clone().sub(ROUTE[0]));
      this.followShip(1);
      if (this.visible) this.render(this.window.performance?.now?.() || performance.now());
    }
    this.scheduleFrame();
  }

  followShip(alpha) {
    if (!this.ship || !this.camera) return;
    const destination = this.ship.position.clone();
    const offsetX = this.camera.aspect > 1.2 ? -0.7 : -0.15;
    const cameraTarget = destination.clone().add(new Vector3(offsetX, 1.3, -5.2));
    this.camera.position.lerp(cameraTarget, alpha);
    this.camera.lookAt(destination.clone().add(new Vector3(0, 0.15, 1.25)));
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

  scheduleFrame() {
    if (!this.visible || this.rafId || this.destroyed || !this.renderer) return;
    this.rafId = this.window.requestAnimationFrame(this.frame);
  }

  render(timestamp) {
    this.rafId = 0;
    if (!this.visible || this.destroyed || !this.renderer || !this.ship) return;
    const now = Number(timestamp) || this.window.performance?.now?.() || performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - this.previousTime) / 1000));
    this.previousTime = now;
    if (!this.reducedMotion) {
      const drift = new Vector3(0, Math.sin(now / 1700) * 0.045, Math.sin(now / 2600) * 0.08);
      const target = ROUTE[this.beatIndex].clone().add(drift);
      this.ship.position.lerp(target, 1 - Math.exp(-delta * 1.5));
      this.ship.rotation.y = Math.PI + Math.sin(now / 4300) * 0.045;
      this.ship.rotation.z = Math.sin(now / 2300) * 0.018;
      this.followShip(1 - Math.exp(-delta * 2.8));
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
    this.scene?.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material?.dispose?.();
    });
    this.renderer?.dispose?.();
    this.canvas?.remove();
    this.canvas = null;
    this.renderer = null;
    this.ship = null;
  }
}