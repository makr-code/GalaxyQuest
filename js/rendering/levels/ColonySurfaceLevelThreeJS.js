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

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

/** @returns {typeof THREE | null} */
function THREE() {
  return (typeof window !== 'undefined' && window.THREE) || null;
}

function parseHexColor(hex, fallback) {
  const normalized = String(hex || '').trim();
  return /^#?[0-9a-f]{6}$/i.test(normalized)
    ? `#${normalized.replace(/^#/, '')}`
    : fallback;
}

/** Maximum buildings rendered at once. */
const MAX_BUILDINGS = 512;

class ColonySurfaceLevelThreeJS extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas    = null;
    this._backend   = null;
    this._sceneData = null;
    this._scene     = null;
    this._camera    = null;
    this._renderer  = null;
    this._ground    = null;
    this._lod       = null;          // THREE.LOD root node
    this._instanced = null;          // THREE.InstancedMesh for buildings
    this._instancedLo = null;
    this._ownershipRing = null;
    this._slotCount = 0;
    this._visualPalette = {
      ownerColor: '#7db7ee',
      isOwned: false,
      isPlayer: false,
      groundColor: '#223311',
      buildingColor: '#446688',
      ringColor: '#ffd47a',
      clearColor: '#090d07',
    };
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
    this._applySceneDataVisuals(data);
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
    this._applySceneDataVisuals(transitionPayload || this._sceneData || null);
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
    this._instancedLo = null;
    this._lod       = null;
    this._ground    = null;
    this._ownershipRing = null;
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
      new T.MeshStandardMaterial({ color: this._visualPalette.groundColor, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this._scene.add(ground);
    this._ground = ground;

    const ownershipRing = new T.Mesh(
      new T.RingGeometry(16, 21, 80),
      new T.MeshBasicMaterial({
        color: this._visualPalette.ringColor,
        transparent: true,
        opacity: 0.32,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    ownershipRing.rotation.x = -Math.PI / 2;
    ownershipRing.position.y = 0.08;
    ownershipRing.visible = false;
    this._scene.add(ownershipRing);
    this._ownershipRing = ownershipRing;

    // LOD root for buildings
    this._lod = new T.LOD();
    this._scene.add(this._lod);

    // High-detail instanced mesh
    const hiGeo = new T.BoxGeometry(1, 2, 1);
    const hiMat = new T.MeshStandardMaterial({ color: this._visualPalette.buildingColor, vertexColors: true });
    this._instanced = new T.InstancedMesh(hiGeo, hiMat, MAX_BUILDINGS);
    this._instanced.count = 0;
    this._lod.addLevel(this._instanced, 0);

    // Low-detail placeholder (same mesh, lower poly in a real impl)
    const loGeo = new T.BoxGeometry(1, 2, 1);
    const loMat = new T.MeshStandardMaterial({ color: this._visualPalette.buildingColor, wireframe: true, vertexColors: true });
    const loMesh = new T.InstancedMesh(loGeo, loMat, MAX_BUILDINGS);
    loMesh.count = 0;
    this._lod.addLevel(loMesh, 50);
    this._instancedLo = loMesh;

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
    const color = new T.Color();

    for (let i = 0; i < count; i++) {
      const s = slots[i] || {};
      mat.makeTranslation(Number(s.x || 0), Number(s.y || 0) + 1, Number(s.z || 0));
      this._instanced.setMatrixAt(i, mat);
      color.set(parseHexColor(s.owner_color || s.colony_owner_color || s.faction_color || '', this._visualPalette.buildingColor));
      this._instanced.setColorAt(i, color);
    }
    this._instanced.count = count;
    this._instanced.instanceMatrix.needsUpdate = true;
    if (this._instanced.instanceColor) this._instanced.instanceColor.needsUpdate = true;
    this._slotCount = count;

    // Sync low-detail LOD level as well.
    const lo = this._instancedLo;
    if (lo) {
      for (let i = 0; i < count; i++) {
        const s = slots[i] || {};
        lo.setMatrixAt(i, this._instanced.instanceMatrix.array
          ? (() => { const m = new T.Matrix4(); m.fromArray(this._instanced.instanceMatrix.array, i * 16); return m; })()
          : mat);
        color.set(parseHexColor(s.owner_color || s.colony_owner_color || s.faction_color || '', this._visualPalette.buildingColor));
        lo.setColorAt(i, color);
      }
      lo.count = count;
      lo.instanceMatrix.needsUpdate = true;
      if (lo.instanceColor) lo.instanceColor.needsUpdate = true;
    }
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.colony && typeof data.colony === 'object') return data.colony;
    if (Array.isArray(data.slots) && data.slots.length) return data.slots[0];
    return data;
  }

  _applySceneDataVisuals(data) {
    const T = THREE();
    const source = this._resolveVisualSource(data);
    const ownerColor = parseHexColor(
      source?.colony_owner_color || source?.owner_color || source?.faction_color || '',
      '#7db7ee'
    );
    const isOwned = !!String(source?.colony_owner_color || source?.owner_color || source?.faction_color || '').trim();
    const isPlayer = Number(source?.colony_is_player || source?.is_player || 0) === 1;
    this._visualPalette = {
      ownerColor,
      isOwned,
      isPlayer,
      groundColor: isOwned ? '#16211a' : '#223311',
      buildingColor: isOwned ? ownerColor : '#446688',
      ringColor: isPlayer ? '#7dffb2' : ownerColor,
      clearColor: isOwned ? '#0b120d' : '#090d07',
    };
    if (!T) return;
    if (this._scene?.background) {
      this._scene.background.set(this._visualPalette.clearColor);
    } else if (this._scene) {
      this._scene.background = new T.Color(this._visualPalette.clearColor);
    }
    if (this._ground?.material?.color) {
      this._ground.material.color.set(this._visualPalette.groundColor);
    }
    if (this._instanced?.material?.color) {
      this._instanced.material.color.set(this._visualPalette.buildingColor);
    }
    if (this._instancedLo?.material?.color) {
      this._instancedLo.material.color.set(this._visualPalette.buildingColor);
    }
    if (this._ownershipRing?.material?.color) {
      this._ownershipRing.material.color.set(this._visualPalette.ringColor);
      this._ownershipRing.material.opacity = isPlayer ? 0.42 : 0.32;
      this._ownershipRing.visible = isOwned;
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
