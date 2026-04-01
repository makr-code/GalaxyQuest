/**
 * ObjectApproachLevelWebGPU.js
 *
 * IZoomLevelRenderer for ZOOM_LEVEL.OBJECT_APPROACH (Level 4).
 * WebGPU backend.
 *
 * Like the ThreeJS counterpart, this level handles fly-in to non-planet
 * space objects.  The WebGPU path uses the IGraphicsRenderer interface
 * (passes constructed meshes through the backend's draw-call API) rather
 * than instantiating a separate WebGLRenderer, so both renderers can share
 * the same swap-chain texture.
 *
 * Visual features per ApproachTargetType
 * ────────────────────────────────────────
 *   FLEET                       — 3–5 instanced vessel quads with subtle
 *                                 directional light
 *   VESSEL                      — single high-detail hull mesh + specular
 *                                 highlight pass
 *   VAGABOND                    — low-poly hull + rust/worn PBR override
 *   SOLAR_INSTALLATION_SHIPYARD — torus ring mesh + docking-arm accents
 *   SOLAR_INSTALLATION_STARGATE — large torus + additive bloom emissive pass
 *
 * In environments without a real WebGPU context (Node, unit tests) all
 * methods are graceful no-ops so the test suite can run without a GPU.
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { IZoomLevelRenderer } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

// ---------------------------------------------------------------------------
// GPU mesh descriptors per target type
// ---------------------------------------------------------------------------

/**
 * Returns a lightweight descriptor that the IGraphicsRenderer backend can
 * use to construct the scene geometry.  These descriptors avoid importing
 * any specific 3D library so this file stays pure WebGPU / backend-agnostic.
 *
 * @param {string} targetType  — ApproachTargetType value
 * @returns {{ shape: string, color: [number,number,number], emissive: [number,number,number], metalness: number, roughness: number }}
 */
function meshDescriptorFor(targetType) {
  switch (targetType) {
    case 'FLEET':
      return { shape: 'box',         color: [0.27, 0.53, 0.80], emissive: [0, 0, 0],           metalness: 0.6, roughness: 0.4 };
    case 'VESSEL':
      return { shape: 'cylinder',    color: [0.20, 0.60, 1.00], emissive: [0, 0, 0],           metalness: 0.7, roughness: 0.3 };
    case 'VAGABOND':
      return { shape: 'dodecahedron',color: [0.53, 0.47, 0.33], emissive: [0, 0, 0],           metalness: 0.3, roughness: 0.85 };
    case 'SOLAR_INSTALLATION_SHIPYARD':
      return { shape: 'torus',       color: [0.67, 0.80, 1.00], emissive: [0, 0, 0],           metalness: 0.8, roughness: 0.2 };
    case 'SOLAR_INSTALLATION_STARGATE':
      return { shape: 'torus_large', color: [0.00, 0.80, 1.00], emissive: [0.00, 0.20, 0.40],  metalness: 0.9, roughness: 0.1 };
    default:
      return { shape: 'octahedron',  color: [0.53, 0.67, 0.80], emissive: [0, 0, 0],           metalness: 0.5, roughness: 0.5 };
  }
}

// ---------------------------------------------------------------------------
// ObjectApproachLevelWebGPU
// ---------------------------------------------------------------------------

class ObjectApproachLevelWebGPU extends IZoomLevelRenderer {
  constructor() {
    super();
    this._canvas      = null;
    this._backend     = null;   // IGraphicsRenderer (WebGPU)
    this._sceneData   = null;
    this._targetType  = null;
    this._meshHandle  = null;   // opaque handle from backend.createMesh()
    this._rotation    = 0;
    this._cameraState = null;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;
  }

  setSceneData(data) {
    this._sceneData = data || null;
  }

  render(dt, cameraState) {
    if (!this._backend) return;

    const dtS = dt > 1 ? dt / 1000 : dt;
    this._rotation  += dtS * 0.08;
    this._cameraState = cameraState || null;

    // Update the mesh transform through the backend abstraction if available.
    if (this._meshHandle && typeof this._backend.setMeshRotation === 'function') {
      this._backend.setMeshRotation(this._meshHandle, { y: this._rotation });
    }

    // Apply camera state.
    if (cameraState && cameraState.position && typeof this._backend.setCameraPosition === 'function') {
      this._backend.setCameraPosition(cameraState.position);
    }

    // Trigger a frame draw.
    if (typeof this._backend.renderFrame === 'function') {
      this._backend.renderFrame();
    }
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._rotation   = 0;
    this._targetType = transitionPayload && transitionPayload.targetType
      ? transitionPayload.targetType
      : null;

    if (this._backend && typeof this._backend.createMesh === 'function') {
      // Clear any previous mesh.
      this._releaseMesh();

      const descriptor = meshDescriptorFor(this._targetType);
      this._meshHandle = await this._backend.createMesh(descriptor);
    }
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    this._releaseMesh();
  }

  dispose() {
    this._releaseMesh();
    this._canvas  = null;
    this._backend = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _releaseMesh() {
    if (!this._meshHandle) return;
    if (this._backend && typeof this._backend.destroyMesh === 'function') {
      try { this._backend.destroyMesh(this._meshHandle); } catch (_) {}
    }
    this._meshHandle = null;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ObjectApproachLevelWebGPU, meshDescriptorFor };
} else {
  window.GQObjectApproachLevelWebGPU = { ObjectApproachLevelWebGPU, meshDescriptorFor };
}
