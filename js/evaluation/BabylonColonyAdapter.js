const owners = new WeakSet();

export function colonyFixture() {
  return {
    fixture: 'colony-grid-v1', vfx_quality: 'medium',
    slots: Array.from({ length: 64 }, (_, i) => ({
      id: `slot-${i}`, x: (i % 8 - 3.5) * 2.4, z: (Math.floor(i / 8) - 3.5) * 2.4,
      height: 1 + (i * 17 % 7) * 0.3, type: ['reactor', 'factory', 'research'][i % 3],
      r: 0.3, g: 0.55 + (i % 3) * 0.1, b: 0.9,
    })),
  };
}

/** IZoomLevelRenderer-shaped evaluation adapter; backend objects never escape. */
export class BabylonColonyAdapter {
  #engine;
  #scene;
  #camera;
  #runtime;
  #materials = [];
  #active = false;
  #disposed = false;
  #initializing = false;
  #failure = null;
  #time = 0;
  #data = { slots: [] };
  #load;
  #select;
  #replace;
  #focus = () => this.canvas.focus({ preventScroll: true });

  constructor({ load = () => import('./babylon-runtime.js'), onSelect = () => {},
    replaceCanvas = (canvas) => {
      const fresh = canvas.cloneNode(false);
      canvas.replaceWith(fresh);
      return fresh;
    }, forceWebGL = false } = {}) {
    this.#load = load;
    this.#select = onSelect;
    this.#replace = replaceCanvas;
    this.forceWebGL = forceWebGL;
    this.canvas = null;
    this.backend = null;
    this.fallbackReason = null;
  }

  async initialize(canvas, backend = null) {
    if (backend || this.#disposed || this.#initializing || this.canvas || owners.has(canvas)) {
      throw new Error('Evaluation requires an unshared, exclusively owned canvas and no game backend');
    }
    this.#initializing = true;
    this.canvas = canvas;
    const width = canvas.width, height = canvas.height;
    owners.add(canvas);
    try {
      const B = await this.#load();
      this.#assertAlive();
      this.#runtime = B;
      if (!this.forceWebGL && navigator.gpu) {
        try {
          const engine = this.#engine = new B.WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: false });
          try { await engine.initAsync(...B.compilerOptions); } finally {
            // Initialization can allocate resources after a concurrent dispose().
            if (this.#disposed) engine.dispose();
          }
          this.#assertAlive();
          this.backend = 'babylon-webgpu';
        } catch (error) {
          this.#engine?.dispose();
          this.#engine = null;
          this.#assertAlive();
          this.fallbackReason = String(error);
          const fresh = this.#replace(canvas);
          if (!fresh || fresh === canvas || owners.has(fresh)) throw new Error('Fallback requires a fresh canvas');
          owners.delete(canvas);
          owners.add(fresh);
          this.canvas = canvas = fresh;
        }
      }
      if (!this.#engine) {
        this.fallbackReason ||= this.forceWebGL ? 'Explicit WebGL comparison' : 'WebGPU unavailable';
        this.#engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false }, false);
        this.backend = 'babylon-webgl-fallback';
      }
      this.#engine.setSize(width, height);
      this.#engine.onContextLostObservable?.add(() => { this.#failure = 'Rendering context lost; reload the evaluation'; });
      canvas.addEventListener('pointerdown', this.#focus, true);
      this.#build();
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      this.#initializing = false;
    }
  }

  #assertAlive() {
    if (this.#disposed) throw new Error('Adapter disposed during initialization');
  }

  setSceneData(data) {
    this.#assertAlive();
    if (!Array.isArray(data?.slots) || data.slots.length > 1024 ||
      data.slots.some(s => typeof s.id !== 'string' ||
        ![s.x, s.z, s.height, s.r, s.g, s.b].every(Number.isFinite))) {
      throw new TypeError('Expected at most 1024 finite plain-data colony slots with string IDs');
    }
    this.#data = structuredClone(data);
    if (this.#engine) this.#build();
  }

  #build() {
    this.#scene?.dispose();
    this.#materials = [];
    const B = this.#runtime;
    const scene = this.#scene = new B.Scene(this.#engine);
    scene.clearColor = new B.Color4(0.025, 0.04, 0.065, 1);
    this.#camera = new B.ArcRotateCamera('orbit', -Math.PI / 2, 0.85, 32, B.Vector3.Zero(), scene);
    this.#camera.lowerRadiusLimit = 8;
    this.#camera.upperRadiusLimit = 70;
    this.#camera.wheelPrecision = 12;
    new B.HemisphericLight('sky', new B.Vector3(0, 1, 0), scene);
    new B.DirectionalLight('sun', new B.Vector3(-1, -2, 1), scene);
    const ground = B.MeshBuilder.CreateGround('terrain', { width: 24, height: 24 }, scene);
    ground.isPickable = false;
    const terrain = new B.StandardMaterial('terrain', scene);
    terrain.diffuseColor = new B.Color3(0.08, 0.15, 0.13);
    ground.material = terrain;
    for (const slot of this.#data.slots) {
      const mesh = B.MeshBuilder.CreateBox(slot.id, { width: 1.2, depth: 1.2, height: slot.height }, scene);
      mesh.position = new B.Vector3(slot.x, slot.height / 2, slot.z);
      mesh.metadata = { slotId: slot.id };
      const material = new B.StandardMaterial(slot.id, scene);
      material.diffuseColor = new B.Color3(slot.r, slot.g, slot.b);
      mesh.material = material;
      this.#materials.push(material);
    }
    scene.onPointerObservable.add(event => {
      const id = event.pickInfo?.pickedMesh?.metadata?.slotId;
      if (this.#active && event.type === B.PointerEventTypes.POINTERPICK && typeof id === 'string') {
        this.#select(id);
      }
    });
    if (this.#active) this.#camera.attachControl(this.canvas, true);
  }

  async enter() {
    this.#assertAlive();
    if (!this.#scene) throw new Error('Initialize before enter');
    this.#active = true;
    this.#camera.attachControl(this.canvas, true);
  }

  async exit() {
    this.#active = false;
    this.#camera?.detachControl();
  }

  render(dt, cameraState) {
    if (!this.#active || this.#disposed) return;
    if (this.#failure) throw new Error(this.#failure);
    this.#time += Math.max(0, Math.min(Number(dt) || 0, 0.1));
    if (cameraState?.position && cameraState?.target) {
      const B = this.#runtime;
      const p = cameraState.position, t = cameraState.target;
      this.#camera.setPosition(new B.Vector3(p.x, p.y, p.z));
      this.#camera.setTarget(new B.Vector3(t.x, t.y, t.z));
    }
    this.#materials.forEach((material, i) => {
      const pulse = 0.12 + 0.12 * Math.sin(this.#time * 2 + i * 0.4);
      material.emissiveColor.set(0.1 * pulse, 0.65 * pulse, pulse);
    });
    this.#engine.beginFrame();
    try { this.#scene.render(); } finally { this.#engine.endFrame(); }
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active = false;
    this.canvas?.removeEventListener('pointerdown', this.#focus, true);
    try {
      this.#camera?.detachControl();
      this.#scene?.dispose();
    } finally {
      try { this.#engine?.dispose(); } finally {
        if (this.canvas) owners.delete(this.canvas);
        this.#scene = this.#engine = this.#camera = null;
        this.#materials = [];
      }
    }
  }
}
