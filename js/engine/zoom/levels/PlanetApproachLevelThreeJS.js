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

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js')
  : window.GQIZoomLevelRenderer;

/** @returns {typeof THREE | null} */
function getThree() {
  return (typeof window !== 'undefined' && window.THREE) || null;
}

function parseHexColor(hex, fallback) {
  const normalized = String(hex || '').trim();
  const valid = /^#?[0-9a-f]{6}$/i.test(normalized)
    ? `#${normalized.replace(/^#/, '')}`
    : fallback;
  return valid;
}

class PlanetApproachLevelThreeJS extends ZoomLevelRendererBase {
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
    this._ownershipRing = null;
    this._rotation   = 0;
    this._visualPalette = {
      ownerColor: '#7db7ee',
      isOwned: false,
      isPlayer: false,
      surfaceColor: '#2277bb',
      cloudColor: '#f4fbff',
      atmosphereColor: '#55aaff',
      ringColor: '#ffd47a',
      clearColor: '#040814',
    };
  }

  async initialize(canvas, backend) {
    this._canvas  = canvas;
    this._backend = backend;

    const T = getThree();
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
    this._applySceneDataVisuals(data);
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
    this._applySceneDataVisuals(transitionPayload || this._sceneData || null);
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
    this._ownershipRing = null;
    this._canvas     = null;
    this._backend    = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _buildPlanetMesh(T) {
    // Planet sphere — 64×64 segments for smooth appearance at close range.
    const planetGeo  = new T.SphereGeometry(5, 64, 64);
    const planetMat  = new T.MeshStandardMaterial({ color: this._visualPalette.surfaceColor, roughness: 0.7, metalness: 0.1 });
    this._planetMesh = new T.Mesh(planetGeo, planetMat);
    this._scene.add(this._planetMesh);

    // Cloud layer — slightly larger, semi-transparent.
    const cloudGeo  = new T.SphereGeometry(5.12, 64, 64);
    const cloudMat  = new T.MeshStandardMaterial({
      color: this._visualPalette.cloudColor,
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
      uniforms: { color: { value: new T.Color(this._visualPalette.atmosphereColor) } },
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

    const ringGeo = new T.TorusGeometry(6.2, 0.14, 10, 72);
    const ringMat = new T.MeshBasicMaterial({
      color: this._visualPalette.ringColor,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    this._ownershipRing = new T.Mesh(ringGeo, ringMat);
    this._ownershipRing.rotation.x = Math.PI / 2;
    this._ownershipRing.visible = false;
    this._scene.add(this._ownershipRing);

    // Lighting
    const ambient = new T.AmbientLight(0x333344, 0.6);
    const sunLight = new T.DirectionalLight(0xfff0dd, 1.4);
    sunLight.position.set(50, 30, 80);
    this._scene.add(ambient, sunLight);
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    return data.focusPlanet || data.planet || data.colony || data.target || data;
  }

  _applySceneDataVisuals(data) {
    const T = getThree();
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
      surfaceColor: isOwned ? ownerColor : '#2277bb',
      cloudColor: isOwned ? '#eef7ff' : '#f4fbff',
      atmosphereColor: isOwned ? ownerColor : '#55aaff',
      ringColor: isPlayer ? '#7dffb2' : ownerColor,
      clearColor: isOwned ? '#08101c' : '#040814',
    };
    if (!T) return;
    if (this._scene?.background) {
      this._scene.background.set(this._visualPalette.clearColor);
    } else if (this._scene) {
      this._scene.background = new T.Color(this._visualPalette.clearColor);
    }
    if (this._planetMesh?.material?.color) {
      this._planetMesh.material.color.set(this._visualPalette.surfaceColor);
    }
    if (this._cloudMesh?.material?.color) {
      this._cloudMesh.material.color.set(this._visualPalette.cloudColor);
      this._cloudMesh.material.opacity = isOwned ? 0.42 : 0.35;
    }
    if (this._atmoMesh?.material?.uniforms?.color?.value) {
      this._atmoMesh.material.uniforms.color.value.set(this._visualPalette.atmosphereColor);
    }
    if (this._ownershipRing?.material?.color) {
      this._ownershipRing.material.color.set(this._visualPalette.ringColor);
      this._ownershipRing.material.opacity = isPlayer ? 0.92 : 0.78;
      this._ownershipRing.visible = isOwned;
    }
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
