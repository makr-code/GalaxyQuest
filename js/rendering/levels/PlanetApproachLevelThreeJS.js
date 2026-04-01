/**
 * PlanetApproachLevelThreeJS.js
 *
 * IZoomLevelRenderer — Planet Approach zoom level (Level 2), Three.js fallback.
 *
 * Rendering features
 * ──────────────────
 *  • High-resolution planet mesh (SphereGeometry 64×64 segments).
 *  • Animated cloud layer (second sphere, slightly larger, transparent).
 *  • Atmosphere ShaderMaterial with Fresnel rim-lighting.
 *  • Planet rotation during approach.
 *
 * Delegates to THREE globals already loaded by the page.  In test / headless
 * environments (no THREE) the methods are safe no-ops.
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

class PlanetApproachLevelThreeJS extends IZoomLevelRenderer {
  constructor() {
    super();
    this._canvas     = null;
    this._backend    = null;
    this._sceneData  = null;
    this._scene      = null;
    this._camera     = null;
    this._renderer   = null;  // THREE.WebGLRenderer
    this._planetMesh = null;
    this._cloudMesh  = null;
    this._atmoMesh   = null;
    this._rotation   = 0;
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const T = THREE();
    if (!T) return;  // test / headless environment

    // Minimal Three.js setup — a dedicated renderer for this level.
    this._renderer = new T.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._renderer.setSize(canvas.clientWidth || 800, canvas.clientHeight || 600);

    this._scene  = new T.Scene();
    this._camera = new T.PerspectiveCamera(60, (canvas.clientWidth || 800) / (canvas.clientHeight || 600), 0.1, 2000);
    this._camera.position.set(0, 5, 20);

    this._buildPlanetMesh(T);
  }

  setSceneData(data) {
    this._sceneData = data || null;
  }

  render(dt, cameraState) {
    if (!this._renderer || !this._scene || !this._camera) return;

    const dtS = dt > 1 ? dt / 1000 : dt;
    this._rotation += dtS * 0.05;

    if (this._planetMesh) this._planetMesh.rotation.y = this._rotation;
    if (this._cloudMesh)  this._cloudMesh.rotation.y  = this._rotation * 1.08;

    // Apply camera state from flight path or fallback
    if (cameraState && cameraState.position) {
      this._camera.position.set(
        cameraState.position.x || 0,
        cameraState.position.y || 0,
        cameraState.position.z || 20,
      );
    }

    this._renderer.render(this._scene, this._camera);
  }

  async enter(prevLevel, transitionPayload) { // eslint-disable-line no-unused-vars
    this._rotation = 0;
  }

  async exit(nextLevel) { // eslint-disable-line no-unused-vars
    // Resources kept alive for re-entry.
  }

  dispose() {
    if (this._renderer) {
      try { this._renderer.dispose(); } catch (_) {}
      this._renderer = null;
    }
    this._scene      = null;
    this._camera     = null;
    this._planetMesh = null;
    this._cloudMesh  = null;
    this._atmoMesh   = null;
    this._canvas     = null;
    this._backend    = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _buildPlanetMesh(T) {
    // Planet sphere — 64×64 segments for smooth appearance at close range.
    const planetGeo  = new T.SphereGeometry(5, 64, 64);
    const planetMat  = new T.MeshStandardMaterial({ color: 0x2277bb, roughness: 0.7, metalness: 0.1 });
    this._planetMesh = new T.Mesh(planetGeo, planetMat);
    this._scene.add(this._planetMesh);

    // Cloud layer — slightly larger, semi-transparent.
    const cloudGeo  = new T.SphereGeometry(5.12, 64, 64);
    const cloudMat  = new T.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      roughness: 1.0,
    });
    this._cloudMesh = new T.Mesh(cloudGeo, cloudMat);
    this._scene.add(this._cloudMesh);

    // Atmosphere shell — Fresnel rim-lighting via ShaderMaterial.
    const atmoGeo = new T.SphereGeometry(5.4, 64, 64);
    const atmoMat = new T.ShaderMaterial({
      transparent: true,
      side: T.BackSide,
      uniforms: { color: { value: new T.Color(0x55aaff) } },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        varying vec3 vNormal;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
          gl_FragColor  = vec4(color, fresnel * 0.7);
        }
      `,
    });
    this._atmoMesh = new T.Mesh(atmoGeo, atmoMat);
    this._scene.add(this._atmoMesh);

    // Lighting
    const ambient = new T.AmbientLight(0x333344, 0.6);
    const sunLight = new T.DirectionalLight(0xfff0dd, 1.4);
    sunLight.position.set(50, 30, 80);
    this._scene.add(ambient, sunLight);
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlanetApproachLevelThreeJS };
} else {
  window.GQPlanetApproachLevelThreeJS = { PlanetApproachLevelThreeJS };
}
