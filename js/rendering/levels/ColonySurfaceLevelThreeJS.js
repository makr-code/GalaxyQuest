/**
 * ColonySurfaceLevelThreeJS.js
 *
 * IZoomLevelRenderer — Colony Surface zoom level (Level 3), Three.js fallback.
 *
 * Uses THREE.InstancedMesh + THREE.LOD for buildings, as described in
 * COLONY_BUILDING_SYSTEM_DESIGN.md.
 *
 * In headless / test environments (no THREE) all calls are safe no-ops.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

/** @returns {typeof THREE | null} */
function THREE() {
  return (typeof window !== 'undefined' && window.THREE) || null;
}

/** Maximum buildings rendered at once. */
const MAX_BUILDINGS = 512;

class ColonySurfaceLevelThreeJS extends IZoomLevelRenderer {
  constructor() {
    super();
    this._canvas    = null;
    this._backend   = null;
    this._sceneData = null;
    this._scene     = null;
    this._camera    = null;
    this._renderer  = null;
    this._lod       = null;          // THREE.LOD root node
    this._instanced = null;          // THREE.InstancedMesh for buildings
    this._slotCount = 0;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const T = THREE();
    if (!T) return;

    this._renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);

    this._scene  = new T.Scene();
    this._camera = new T.PerspectiveCamera(55, (canvas.clientWidth || 800) / (canvas.clientHeight || 600), 0.1, 1000);
    this._camera.position.set(0, 12, 30);
    this._camera.lookAt(0, 0, 0);

    this._buildScene(T);
  }

  setSceneData(data) {
    this._sceneData = data || null;
    if (data && Array.isArray(data.slots)) {
      this._updateInstances(data.slots);
    }
  }

  render(dt, cameraState) { // eslint-disable-line no-unused-vars
    if (!this._renderer || !this._scene || !this._camera) return;
    if (cameraState && cameraState.position) {
      this._camera.position.set(
        cameraState.position.x || 0,
        cameraState.position.y || 12,
        cameraState.position.z || 30,
      );
    }
    this._renderer.render(this._scene, this._camera);
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    if (transitionPayload && Array.isArray(transitionPayload.slots)) {
      this._updateInstances(transitionPayload.slots);
    }
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Nothing to do.
  }

  dispose() {
    if (this._renderer) {
      try { this._renderer.dispose(); } catch (_) {}
      this._renderer = null;
    }
    this._instanced = null;
    this._lod       = null;
    this._scene     = null;
    this._camera    = null;
    this._canvas    = null;
    this._backend   = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _buildScene(T) {
    // Ground plane
    const ground = new T.Mesh(
      new T.PlaneGeometry(100, 100),
      new T.MeshStandardMaterial({ color: 0x223311, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this._scene.add(ground);

    // LOD root for buildings
    this._lod = new T.LOD();
    this._scene.add(this._lod);

    // High-detail instanced mesh
    const hiGeo = new T.BoxGeometry(1, 2, 1);
    const hiMat = new T.MeshStandardMaterial({ color: 0x446688 });
    this._instanced = new T.InstancedMesh(hiGeo, hiMat, MAX_BUILDINGS);
    this._instanced.count = 0;
    this._lod.addLevel(this._instanced, 0);

    // Low-detail placeholder (same mesh, lower poly in a real impl)
    const loGeo = new T.BoxGeometry(1, 2, 1);
    const loMat = new T.MeshStandardMaterial({ color: 0x446688, wireframe: true });
    const loMesh = new T.InstancedMesh(loGeo, loMat, MAX_BUILDINGS);
    loMesh.count = 0;
    this._lod.addLevel(loMesh, 50);

    // Lighting
    this._scene.add(new T.AmbientLight(0x334455, 0.7));
    const sun = new T.DirectionalLight(0xfff0cc, 1.2);
    sun.position.set(30, 60, 40);
    this._scene.add(sun);
  }

  _updateInstances(slots) {
    if (!this._instanced) return;
    const T = THREE();
    if (!T) return;

    const count = Math.min(slots.length, MAX_BUILDINGS);
    const mat   = new T.Matrix4();

    for (let i = 0; i < count; i++) {
      const s = slots[i] || {};
      mat.makeTranslation(Number(s.x || 0), Number(s.y || 0) + 1, Number(s.z || 0));
      this._instanced.setMatrixAt(i, mat);
    }
    this._instanced.count = count;
    this._instanced.instanceMatrix.needsUpdate = true;
    this._slotCount = count;

    // Sync low-detail LOD level as well.
    const lod = this._lod;
    if (lod && lod.levels && lod.levels[1] && lod.levels[1].object) {
      const lo = lod.levels[1].object;
      for (let i = 0; i < count; i++) {
        lo.setMatrixAt(i, this._instanced.instanceMatrix.array
          ? (() => { const m = new T.Matrix4(); m.fromArray(this._instanced.instanceMatrix.array, i * 16); return m; })()
          : mat);
      }
      lo.count = count;
      lo.instanceMatrix.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColonySurfaceLevelThreeJS };
} else {
  window.GQColonySurfaceLevelThreeJS = { ColonySurfaceLevelThreeJS };
}
