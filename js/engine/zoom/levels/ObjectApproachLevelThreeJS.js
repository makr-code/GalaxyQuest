/**
 * ObjectApproachLevelThreeJS.js
 *
 * IZoomLevelRenderer for ZOOM_LEVEL.OBJECT_APPROACH (Level 4).
 * Three.js (WebGL2) implementation.
 *
 * Handles fly-in to space objects that are not planets:
 *   FLEET                      — renders a formation of vessel silhouettes
 *   VESSEL                     — renders a single detailed vessel mesh
 *   VAGABOND                   — renders a wandering freighter / derelict hull
 *   SOLAR_INSTALLATION_SHIPYARD — renders an orbital dock ring
 *   SOLAR_INSTALLATION_STARGATE — renders a jump-gate torus
 *
 * The correct geometry is chosen at `enter()` time from the payload's
 * `targetType` field (one of the ApproachTargetType enum values).  All
 * heavy construction is deferred until the first `enter()` call so that the
 * initialization path stays lightweight.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

/** @returns {typeof THREE | null} */
function getThree() {
  return (typeof window !== 'undefined' && window.THREE) || null;
}

// ---------------------------------------------------------------------------
// Geometry descriptors per target type
// ---------------------------------------------------------------------------

/**
 * Returns a { geometry, material } pair suited to the given target type.
 * Falls back to a generic octahedron when THREE is unavailable or the type
 * is unknown.
 *
 * @param {typeof THREE} T
 * @param {string}       targetType  — ApproachTargetType value
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material }}
 */
function buildObjectGeometry(T, targetType) {
  switch (targetType) {
    case 'BUILDING': {
      // Compact block silhouette representing a close-up colony structure.
      const geo = new T.BoxGeometry(4.2, 2.8, 4.2);
      const mat = new T.MeshStandardMaterial({ color: 0xccaa66, metalness: 0.25, roughness: 0.78 });
      return { geometry: geo, material: mat };
    }
    case 'FLEET': {
      // A tight cluster of box shapes representing multiple vessels.
      const geo = new T.BoxGeometry(3, 0.6, 6);
      const mat = new T.MeshStandardMaterial({ color: 0x4488cc, metalness: 0.6, roughness: 0.4 });
      return { geometry: geo, material: mat };
    }
    case 'VESSEL': {
      // Sleek hull: elongated box with chamfered look via CylinderGeometry.
      const geo = new T.CylinderGeometry(0.5, 1.2, 8, 8);
      const mat = new T.MeshStandardMaterial({ color: 0x3399ff, metalness: 0.7, roughness: 0.3 });
      return { geometry: geo, material: mat };
    }
    case 'VAGABOND': {
      // Battered freighter: dodecahedron for organic, worn look.
      const geo = new T.DodecahedronGeometry(3, 0);
      const mat = new T.MeshStandardMaterial({ color: 0x887755, metalness: 0.3, roughness: 0.85 });
      return { geometry: geo, material: mat };
    }
    case 'SOLAR_INSTALLATION_SHIPYARD': {
      // Orbital dock ring: torus with flat cross-section.
      const geo = new T.TorusGeometry(7, 1.2, 8, 32);
      const mat = new T.MeshStandardMaterial({ color: 0xaaccff, metalness: 0.8, roughness: 0.2 });
      return { geometry: geo, material: mat };
    }
    case 'SOLAR_INSTALLATION_STARGATE': {
      // Jump-gate: thin torus with glow-like emissive.
      const geo = new T.TorusGeometry(9, 0.6, 8, 64);
      const mat = new T.MeshStandardMaterial({
        color: 0x00ccff,
        emissive: new T.Color(0x003366),
        metalness: 0.9,
        roughness: 0.1,
      });
      return { geometry: geo, material: mat };
    }
    default: {
      const geo = new T.OctahedronGeometry(4, 0);
      const mat = new T.MeshStandardMaterial({ color: 0x88aacc });
      return { geometry: geo, material: mat };
    }
  }
}

// ---------------------------------------------------------------------------
// ObjectApproachLevelThreeJS
// ---------------------------------------------------------------------------

class ObjectApproachLevelThreeJS extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas      = null;
    this._backend     = null;
    this._sceneData   = null;
    this._scene       = null;
    this._camera      = null;
    this._renderer    = null;  // THREE.WebGLRenderer
    this._objectMesh  = null;  // active target mesh
    this._rotation    = 0;
    this._targetType  = null;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const T = getThree();
    if (!T) return;  // test / headless environment

    this._renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);

    this._scene  = new T.Scene();
    this._camera = new T.PerspectiveCamera(
      55,
      (canvas.clientWidth || 800) / (canvas.clientHeight || 600),
      0.1,
      5000,
    );
    this._camera.position.set(0, 8, 30);

    // Static lighting — will be populated per-target in _buildScene().
    const ambient  = new T.AmbientLight(0x334455, 0.8);
    const keyLight = new T.DirectionalLight(0xfff0ee, 1.6);
    keyLight.position.set(40, 60, 80);
    this._scene.add(ambient, keyLight);
  }

  setSceneData(data) {
    this._sceneData = data || null;
  }

  render(dt, cameraState) {
    if (!this._renderer || !this._scene || !this._camera) return;

    const dtS = dt > 1 ? dt / 1000 : dt;
    this._rotation += dtS * 0.08;

    if (this._objectMesh) {
      this._objectMesh.rotation.y = this._rotation;
    }

    if (cameraState && cameraState.position) {
      this._camera.position.set(
        cameraState.position.x || 0,
        cameraState.position.y || 0,
        cameraState.position.z || 30,
      );
    }

    this._renderer.render(this._scene, this._camera);
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._rotation = 0;
    const targetType = transitionPayload && transitionPayload.targetType
      ? transitionPayload.targetType
      : null;
    this._targetType = targetType;
    this._buildScene(targetType);
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    this._clearObjectMesh();
  }

  dispose() {
    this._clearObjectMesh();
    if (this._renderer) {
      try { this._renderer.dispose(); } catch (_) {}
      this._renderer = null;
    }
    this._scene    = null;
    this._camera   = null;
    this._canvas   = null;
    this._backend  = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _buildScene(targetType) {
    const T = getThree();
    if (!T || !this._scene) return;

    this._clearObjectMesh();

    const { geometry, material } = buildObjectGeometry(T, targetType);
    this._objectMesh = new T.Mesh(geometry, material);
    this._scene.add(this._objectMesh);
  }

  _clearObjectMesh() {
    if (!this._objectMesh) return;
    if (this._scene) {
      try { this._scene.remove(this._objectMesh); } catch (_) {}
    }
    try { this._objectMesh.geometry.dispose(); } catch (_) {}
    try { this._objectMesh.material.dispose(); } catch (_) {}
    this._objectMesh = null;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ObjectApproachLevelThreeJS };
} else {
  window.GQObjectApproachLevelThreeJS = { ObjectApproachLevelThreeJS };
}
