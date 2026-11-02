/**
 * Three fallback: existing MeshStandardMaterial with local seeded planet maps,
 * separate moving cloud shell and steady, state-gated night emission.
 */
'use strict';

var { IZoomLevelRenderer: ZoomLevelRendererBase } = typeof require !== 'undefined'
  ? require('../IZoomLevelRenderer.js') : window.GQIZoomLevelRenderer;

class PlanetApproachLevelThreeJS extends ZoomLevelRendererBase {
  constructor() {
    super();
    this._canvas = this._backend = this._sceneData = null;
    this._scene = this._camera = this._renderer = null;
    this._planetMesh = this._cloudMesh = this._atmoMesh = this._ownershipRing = null;
    this._textures = [];
    this._rotation = this._cloudRotation = 0;
    this._unloaded = false;
    this._resourceEpoch = 0;
    this._visualPalette = {
      ownerColor: '#7db7ee', isOwned: false, isPlayer: false, surfaceColor: '#ffffff',
      cloudColor: '#f4fbff', atmosphereColor: '#55aaff', ringColor: '#ffd47a', clearColor: '#040814',
    };
  }

  async initialize(canvas, backend) {
    this._releaseOwned();
    this._unloaded = false;
    const epoch = this._resourceEpoch;
    this._canvas = canvas;
    this._backend = backend;
    const world = await this._loadWorld();
    if (epoch !== this._resourceEpoch || this._unloaded) return;
    this._world = world;
    this._applySceneDataVisuals(this._sceneData);
    this._createScene();
  }

  async _loadWorld() {
    if (typeof require !== 'undefined') return require('./PlanetLivingWorld.js');
    await import('../../../rendering/planet-textures.js');
    await import('./PlanetLivingWorld.js');
    return window.GQPlanetLivingWorld;
  }

  _createScene() {
    const T = typeof window !== 'undefined' && window.THREE;
    if (!T || this._renderer || !this._canvas || this._unloaded) return;
    this._renderer = new T.WebGLRenderer({ canvas: this._canvas, antialias: true });
    this._renderer.outputColorSpace = T.SRGBColorSpace;
    this._renderer.toneMapping = T.ReinhardToneMapping;
    this._renderer.toneMappingExposure = 1;
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this._width = this._canvas.clientWidth || this._canvas.width || 800;
    this._height = this._canvas.clientHeight || this._canvas.height || 600;
    this._renderer.setSize(this._width, this._height, false);
    this._scene = new T.Scene();
    this._scene.background = new T.Color(this._visualPalette.clearColor);
    this._camera = new T.PerspectiveCamera(60, this._width / this._height, 0.1, 2000000);
    this._camera.position.set(0, 0, 20);
    this._buildPlanetMesh(T);
    this._refreshMaps();
    this._updateEffects(this._world.policy(this._sceneData));
  }

  setSceneData(data) {
    this._sceneData = data || null;
    this._applySceneDataVisuals(data);
  }

  render(dt, cameraState) {
    if (this._unloaded || !this._renderer) return;
    const policy = this._world.policy(this._sceneData);
    if (!policy.visible) return;
    if (policy.motion) {
      const seconds = this._world.delta(dt);
      this._rotation = (this._rotation + seconds * 0.05) % (Math.PI * 2);
      this._cloudRotation = (this._cloudRotation + seconds * 0.073) % (Math.PI * 2);
    }
    this._planetMesh.rotation.y = this._rotation;
    this._cloudMesh.rotation.y = this._cloudRotation;
    this._refreshMaps();
    this._updateEffects(policy);
    const width = this._canvas.clientWidth || this._canvas.width || 800;
    const height = this._canvas.clientHeight || this._canvas.height || 600;
    if (width !== this._width || height !== this._height) {
      this._width = width; this._height = height;
      this._renderer.setSize(width, height, false);
      this._camera.aspect = width / Math.max(1, height);
      this._camera.updateProjectionMatrix();
    }
    const safe = (value, fallback) => Number.isFinite(value) ? Math.max(-1e6, Math.min(1e6, value)) : fallback;
    const position = cameraState?.position;
    this._camera.position.set(safe(position?.x, 0), safe(position?.y, 0), safe(position?.z, 20));
    if (this._camera.position.length() < 5.5) this._camera.position.set(0, 0, 20);
    const target = cameraState?.target;
    const aim = new window.THREE.Vector3(safe(target?.x, 0), safe(target?.y, 0), safe(target?.z, 0));
    if (aim.distanceTo(this._camera.position) < 0.001) aim.set(0, 0, 0);
    this._camera.lookAt(aim);
    // The owner indicator is independent of terrain and always faces the viewer.
    this._ownershipRing.quaternion.copy(this._camera.quaternion);
    this._renderer.render(this._scene, this._camera);
  }

  async enter(prevLevel, transitionPayload) {
    const epoch = ++this._resourceEpoch;
    this._unloaded = false;
    this._rotation = this._cloudRotation = 0;
    if (transitionPayload) this._sceneData = transitionPayload;
    if (!this._world) {
      const world = await this._loadWorld();
      if (epoch !== this._resourceEpoch || this._unloaded) return;
      this._world = world;
    }
    if (epoch !== this._resourceEpoch || this._unloaded) return;
    this._applySceneDataVisuals(this._sceneData);
    this._createScene();
  }

  async exit() {
    this._unloaded = true;
    this._releaseOwned();
  }

  _releaseOwned() {
    this._resourceEpoch++;
    const geometries = new Set(), materials = new Set();
    this._scene?.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this._textures.forEach(texture => texture.dispose());
    this._textures = [];
    this._renderer?.dispose();
    this._renderer = this._scene = this._camera = null;
    this._planetMesh = this._cloudMesh = this._atmoMesh = this._ownershipRing = null;
    this._mapKey = null;
  }

  dispose() {
    this._unloaded = true;
    this._releaseOwned();
    this._canvas = this._backend = null;
  }

  _buildPlanetMesh(T) {
    const quality = this._world.policy(this._sceneData).quality;
    const segments = quality === 'high' ? 64 : quality === 'low' ? 24 : 40;
    const planetMat = new T.MeshStandardMaterial({
      color: '#ffffff', roughness: 0.78, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0,
    });
    // Preserve the standard lighting/material path, only gate emission at night.
    this._nightUniform = { value: this._descriptor.variant === 'lava' ? 1 : 0 };
    planetMat.onBeforeCompile = shader => {
      shader.uniforms.gqLava = this._nightUniform;
      shader.vertexShader = `varying vec3 vGQWorldNormal;\n${shader.vertexShader}`
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vGQWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = `varying vec3 vGQWorldNormal;\nuniform float gqLava;\n${shader.fragmentShader}`
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float gqNight = 1.0 - smoothstep(-0.15, 0.2,
            dot(normalize(vGQWorldNormal), normalize(vec3(-0.75, 0.4, 0.38))));
          totalEmissiveRadiance *= mix(gqNight, 1.0, gqLava);`);
    };
    planetMat.customProgramCacheKey = () => 'gq-planet-night-1';
    this._planetMesh = new T.Mesh(new T.SphereGeometry(5, segments, segments), planetMat);
    this._cloudMesh = new T.Mesh(new T.SphereGeometry(5.12, segments, segments),
      new T.MeshStandardMaterial({
        color: '#ffffff', roughness: 1, transparent: true, opacity: 0.8,
        depthWrite: false, alphaTest: 0.02,
      }));
    this._atmoMesh = new T.Mesh(new T.SphereGeometry(5.4, segments, segments), new T.ShaderMaterial({
      transparent: true, depthWrite: false, side: T.BackSide,
      uniforms: { color: { value: new T.Color('#55aaff') }, strength: { value: 0.8 } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vView;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal); vView = -viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }`,
      fragmentShader: `
        uniform vec3 color; uniform float strength; varying vec3 vNormal; varying vec3 vView;
        void main() {
          float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
          gl_FragColor = vec4(color, fresnel * 0.5 * strength);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this._ownershipRing = new T.Mesh(new T.TorusGeometry(6.15, 0.07, 8, 72),
      new T.MeshBasicMaterial({ color: this._visualPalette.ringColor, depthWrite: false }));
    this._scene.add(this._planetMesh, this._cloudMesh, this._atmoMesh, this._ownershipRing);
    this._scene.add(new T.AmbientLight(0xffffff, 0.06));
    const sun = new T.DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(-75, 40, 38);
    this._scene.add(sun);
  }

  _refreshMaps() {
    if (!this._planetMesh) return;
    const T = window.THREE;
    const maps = this._world.maps(this._descriptor, this._world.policy(this._sceneData).size);
    if (maps.key === this._mapKey) return;
    this._textures.forEach(texture => texture.dispose());
    this._textures = ['surface', 'cloud', 'night'].map(name => {
      const texture = new T.DataTexture(maps[name], maps.width, maps.height, T.RGBAFormat);
      texture.wrapS = T.RepeatWrapping;
      texture.wrapT = T.ClampToEdgeWrapping;
      texture.flipY = true;
      texture.magFilter = texture.minFilter = T.LinearFilter;
      texture.colorSpace = name === 'cloud' ? T.NoColorSpace : T.SRGBColorSpace;
      texture.needsUpdate = true;
      return texture;
    });
    this._planetMesh.material.map = this._textures[0];
    this._planetMesh.material.emissiveMap = this._textures[2];
    this._planetMesh.material.needsUpdate = true;
    this._cloudMesh.material.map = this._textures[1];
    this._cloudMesh.material.needsUpdate = true;
    this._mapKey = maps.key;
  }

  _updateEffects(policy) {
    if (!this._planetMesh) return;
    const lava = this._descriptor.variant === 'lava';
    this._planetMesh.material.emissiveIntensity = policy.enabled
      ? lava ? 0.6 : this._world.state(this._sceneData) : 0;
    this._nightUniform.value = lava ? 1 : 0;
    this._cloudMesh.visible = policy.enabled && this._descriptor.clouds > 0;
    this._atmoMesh.visible = policy.enabled && this._descriptor.atmosphere > 0;
    this._atmoMesh.material.uniforms.strength.value = this._descriptor.atmosphere;
    this._ownershipRing.visible = this._visualPalette.isOwned;
    this._ownershipRing.material.color.set(this._visualPalette.ringColor);
  }

  _applySceneDataVisuals(data) {
    if (!this._world) return;
    this._visualPalette = this._world.palette(data);
    this._descriptor = this._world.describe(data);
    if (this._renderer && !this._unloaded) {
      this._refreshMaps();
      this._updateEffects(this._world.policy(data));
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PlanetApproachLevelThreeJS };
else window.GQPlanetApproachLevelThreeJS = { PlanetApproachLevelThreeJS };
