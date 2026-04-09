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
function getThree() {
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
    this._buildingVfxGroup = null;
    this._buildingVfxEmitters = [];
    this._buildingVfxTime = 0;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'threejs',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
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

    const T = getThree();
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
    this._tickBuildingVfx(Number(dt) || 0.016);
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
    this._clearBuildingVfx(true);
    if (this._renderer) {
      try { this._renderer.dispose(); } catch (_) {}
      this._renderer = null;
    }
    this._instanced = null;
    this._instancedLo = null;
    this._lod       = null;
    this._ground    = null;
    this._ownershipRing = null;
    this._buildingVfxGroup = null;
    this._buildingVfxBurstUntil = 0;
    this._slotUpgradeState = new Map();
    this._buildingVfxStats = {
      backend: 'threejs',
      quality: 'medium',
      emitters: 0,
      particles: 0,
      profileCounts: {},
      burstActive: false,
    };
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

    this._buildingVfxGroup = new T.Group();
    this._scene.add(this._buildingVfxGroup);

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
    const T = getThree();
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
    this._rebuildBuildingVfx(slots);

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

  _resolveBuildingVfxQuality(slotCount) {
    const requested = String(this._sceneData?.vfx_quality || this._sceneData?.quality || '').toLowerCase();
    if (requested === 'low' || requested === 'medium' || requested === 'high') return requested;
    if (slotCount > 280) return 'low';
    if (slotCount > 120) return 'medium';
    return 'high';
  }

  _slotVfxProfile(slot) {
    const explicitProfile = String(slot?.vfx_profile || slot?.fx_profile || '').toLowerCase();
    const explicitIntensity = Math.max(0.4, Math.min(2.2, Number(slot?.vfx_intensity || slot?.fx_intensity || 1) || 1));
    if (explicitProfile) {
      if (explicitProfile === 'construction' || explicitProfile === 'upgrade') {
        return {
          profileName: 'construction',
          particleMul: 1.35 * explicitIntensity,
          sizeMul: 1.12,
          opacityAdd: 0.12,
          heightMul: 1.25,
          driftMul: 1.25,
          colorHex: '#ffb36b',
        };
      }
      if (explicitProfile === 'industry' || explicitProfile === 'smelter' || explicitProfile === 'refinery') {
        return {
          profileName: 'industry',
          particleMul: 1.2 * explicitIntensity,
          sizeMul: 1.06,
          opacityAdd: 0.08,
          heightMul: 1.12,
          driftMul: 1.16,
          colorHex: '#ffc978',
        };
      }
      if (explicitProfile === 'power' || explicitProfile === 'reactor') {
        return {
          profileName: 'power',
          particleMul: 1.05 * explicitIntensity,
          sizeMul: 1,
          opacityAdd: 0.06,
          heightMul: 1,
          driftMul: 1.08,
          colorHex: '#8ad5ff',
        };
      }
      if (explicitProfile === 'research' || explicitProfile === 'science') {
        return {
          profileName: 'research',
          particleMul: 0.95 * explicitIntensity,
          sizeMul: 0.92,
          opacityAdd: 0.05,
          heightMul: 0.92,
          driftMul: 0.92,
          colorHex: '#9fd0ff',
        };
      }
      if (explicitProfile === 'quiet' || explicitProfile === 'minimal') {
        return {
          profileName: 'quiet',
          particleMul: 0.6 * explicitIntensity,
          sizeMul: 0.82,
          opacityAdd: -0.05,
          heightMul: 0.78,
          driftMul: 0.7,
          colorHex: '',
        };
      }
    }

    const text = [
      slot?.type,
      slot?.building_type,
      slot?.category,
      slot?.state,
      slot?.status,
      slot?.activity,
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    const busy = !!slot?.upgrade_end
      || /construction|building|upgrade|running|queued|active/.test(text);
    const industrial = /mine|factory|refinery|smelter|forge|industry/.test(text);
    const research = /lab|research|science/.test(text);
    const power = /power|reactor|fusion|energy/.test(text);

    if (busy) {
      return {
        profileName: 'construction',
        particleMul: 1.35 * explicitIntensity,
        sizeMul: 1.12,
        opacityAdd: 0.12,
        heightMul: 1.25,
        driftMul: 1.25,
        colorHex: '#ffb36b',
      };
    }
    if (industrial) {
      return {
        profileName: 'industry',
        particleMul: 1.2 * explicitIntensity,
        sizeMul: 1.06,
        opacityAdd: 0.08,
        heightMul: 1.12,
        driftMul: 1.16,
        colorHex: '#ffc978',
      };
    }
    if (power) {
      return {
        profileName: 'power',
        particleMul: 1.05 * explicitIntensity,
        sizeMul: 1.0,
        opacityAdd: 0.06,
        heightMul: 1.0,
        driftMul: 1.08,
        colorHex: '#8ad5ff',
      };
    }
    if (research) {
      return {
        profileName: 'research',
        particleMul: 0.95 * explicitIntensity,
        sizeMul: 0.92,
        opacityAdd: 0.05,
        heightMul: 0.92,
        driftMul: 0.92,
        colorHex: '#9fd0ff',
      };
    }
    return {
      profileName: 'auto',
      particleMul: 1 * explicitIntensity,
      sizeMul: 1,
      opacityAdd: 0,
      heightMul: 1,
      driftMul: 1,
      colorHex: '',
    };
  }

  _clearBuildingVfx(disposeMaterials) {
    const T = getThree();
    if (!this._buildingVfxGroup || !T) return;
    while (this._buildingVfxGroup.children.length) {
      const child = this._buildingVfxGroup.children.pop();
      this._buildingVfxGroup.remove(child);
      if (!disposeMaterials) continue;
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }
    this._buildingVfxEmitters = [];
  }

  _slotKey(slot, index) {
    const sx = Number(slot?.x || 0).toFixed(2);
    const sz = Number(slot?.z || 0).toFixed(2);
    const type = String(slot?.type || slot?.building_type || slot?.category || 'generic');
    return `${index}:${sx}:${sz}:${type}`;
  }

  _ingestUpgradeTransitions(slots) {
    const source = Array.isArray(slots) ? slots : [];
    const next = new Map();
    let detectedTransition = false;
    for (let i = 0; i < source.length; i += 1) {
      const slot = source[i] || {};
      const key = this._slotKey(slot, i);
      const active = !!slot?.upgrade_end;
      next.set(key, active);
      const previous = this._slotUpgradeState.get(key);
      if (typeof previous === 'boolean' && previous !== active) {
        detectedTransition = true;
      }
    }
    this._slotUpgradeState = next;
    if (detectedTransition) {
      this._buildingVfxBurstUntil = Math.max(this._buildingVfxBurstUntil, this._buildingVfxTime + 1.6);
    }
  }

  _rebuildBuildingVfx(slots) {
    const T = getThree();
    if (!T || !this._buildingVfxGroup) return;
    this._clearBuildingVfx(true);
    const source = Array.isArray(slots) ? slots : [];
    this._ingestUpgradeTransitions(source);
    if (!source.length) return;

    const quality = this._resolveBuildingVfxQuality(source.length);
    const qualityMap = {
      low: { emitters: 10, particlesPerEmitter: 8, size: 0.18, opacity: 0.18 },
      medium: { emitters: 20, particlesPerEmitter: 10, size: 0.2, opacity: 0.22 },
      high: { emitters: 36, particlesPerEmitter: 14, size: 0.22, opacity: 0.28 },
    };
    const cfg = qualityMap[quality] || qualityMap.medium;
    const profileCounts = {};
    const maxParticles = 900;
    const maxEmittersByCap = Math.max(1, Math.floor(maxParticles / Math.max(1, cfg.particlesPerEmitter)));
    const emitterCount = Math.min(source.length, cfg.emitters, maxEmittersByCap);
    const stride = Math.max(1, Math.floor(source.length / emitterCount));
    let remainingParticles = maxParticles;

    for (let e = 0; e < emitterCount; e += 1) {
      if (remainingParticles <= 0) break;
      const slot = source[Math.min(source.length - 1, e * stride)] || {};
      const profile = this._slotVfxProfile(slot);
      const profileName = String(profile.profileName || 'auto');
      profileCounts[profileName] = (profileCounts[profileName] || 0) + 1;
      const particleCount = Math.max(3, Math.min(remainingParticles, Math.round(cfg.particlesPerEmitter * profile.particleMul)));
      const positions = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i += 1) {
        const idx = i * 3;
        const a = Math.random() * Math.PI * 2;
        const r = 0.12 + Math.random() * 0.82;
        positions[idx] = Math.cos(a) * r;
        positions[idx + 1] = (0.45 + Math.random() * 1.65) * profile.heightMul;
        positions[idx + 2] = Math.sin(a) * r;
      }

      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      const color = parseHexColor(
        profile.colorHex || slot.owner_color || slot.colony_owner_color || slot.faction_color || '',
        this._visualPalette.buildingColor
      );
      const material = new T.PointsMaterial({
        color,
        size: cfg.size * profile.sizeMul,
        transparent: true,
        opacity: Math.max(0.08, Math.min(0.58, cfg.opacity + profile.opacityAdd)),
        blending: T.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new T.Points(geometry, material);
      points.position.set(Number(slot.x || 0), Number(slot.y || 0), Number(slot.z || 0));
      points.userData = Object.assign({}, points.userData, {
        pulsePhase: Math.random() * Math.PI * 2,
        drift: (0.18 + Math.random() * 0.22) * profile.driftMul,
        baseOpacity: Math.max(0.08, Math.min(0.58, cfg.opacity + profile.opacityAdd)),
      });
      this._buildingVfxGroup.add(points);
      this._buildingVfxEmitters.push(points);
      remainingParticles -= particleCount;
    }
    this._buildingVfxStats = {
      backend: 'threejs',
      quality,
      emitters: this._buildingVfxEmitters.length,
      particles: this._buildingVfxEmitters.reduce((sum, emitter) => {
        const count = Number(emitter?.geometry?.getAttribute?.('position')?.count || 0);
        return sum + count;
      }, 0),
      profileCounts,
      burstActive: this._buildingVfxBurstUntil > this._buildingVfxTime,
    };
  }

  _tickBuildingVfx(dt) {
    if (!this._buildingVfxEmitters.length) return;
    this._buildingVfxTime += Math.max(0, Number(dt) || 0.016);
    const t = this._buildingVfxTime;
    const burstT = this._buildingVfxBurstUntil > t
      ? Math.max(0, Math.min(1, (this._buildingVfxBurstUntil - t) / 1.6))
      : 0;
    this._buildingVfxEmitters.forEach((points, index) => {
      const mat = points?.material;
      if (!mat) return;
      const phase = Number(points.userData?.pulsePhase || 0);
      const drift = Number(points.userData?.drift || 0.2);
      const baseOpacity = Number(points.userData?.baseOpacity || 0.2);
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.1 + index * 0.02) + phase);
      points.rotation.y += dt * drift;
      points.rotation.z = Math.sin(t * 0.45 + phase) * 0.06;
      mat.opacity = Math.max(0.08, Math.min(0.72, baseOpacity + pulse * 0.16 + burstT * 0.22));
      points.scale.setScalar(1 + burstT * 0.18);
    });
    if (this._buildingVfxStats) {
      this._buildingVfxStats.burstActive = burstT > 0.001;
    }
    if (typeof window !== 'undefined') {
      window.__GQ_COLONY_VFX_STATS = Object.assign({}, this._buildingVfxStats || {}, {
        ts: Date.now(),
      });
    }
  }

  _resolveVisualSource(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.colony && typeof data.colony === 'object') return data.colony;
    if (Array.isArray(data.slots) && data.slots.length) return data.slots[0];
    return data;
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
