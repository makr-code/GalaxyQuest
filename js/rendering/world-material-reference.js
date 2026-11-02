import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import '../engine/assets/WorldAssetDescriptor.js';
import '../engine/assets/CoherentMaterialGenerator.js';
import './texture-manager.js';

const slots = { albedo: 'map', normal: 'normalMap', roughness: 'roughnessMap',
  metalness: 'metalnessMap', emissive: 'emissiveMap' };
const families = ['painted-metal', 'rock', 'glass', 'emissive'];
const colors = [0x537fa4, 0x8c8275, 0xa2c8dc, 0xe59a42];

export function createMaterialReference(viewport, controls) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  viewport.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x777777);
  const camera = new THREE.OrthographicCamera(-6, 6, 2, -2, 0.1, 30);
  camera.position.set(0, 0.3, 10);
  camera.lookAt(0, 0, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(-3, 5, 6);
  scene.add(light);
  const manager = new window.GQTextureManager({ three: THREE });
  const geometry = new THREE.SphereGeometry(1.05, 64, 32);
  const bundles = families.map((materialFamily, index) => {
    const bundle = manager.getCoherentMaterialBundle({
      seed: 42, materialFamily, age: 0.7, color: colors[index],
      effects: { profile: 'energy', state: { activity: 1, damage: 0 } },
    }, { size: 64 });
    const mesh = new THREE.Mesh(geometry, bundle.material);
    mesh.position.x = -4.5 + index * 3;
    mesh.rotation.y = 0.4;
    scene.add(mesh);
    return bundle;
  });
  let disposed = false;
  const render = () => {
    if (!disposed) renderer.render(scene, camera);
  };
  const resize = () => {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);
    renderer.setSize(width, height, false);
    const halfHeight = Math.max(1.5, 6 * height / width);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    render();
  };
  const update = () => {
    for (const [name, slot] of Object.entries(slots)) {
      const enabled = controls.querySelector(`input[name="${name}"]`).checked;
      for (const bundle of bundles) {
        bundle.material[slot] = enabled ? bundle[slot] : null;
        if (name === 'emissive') bundle.material.emissiveIntensity = enabled ? bundle.coherentMaterial.emissiveIntensity : 0;
        bundle.material.needsUpdate = true;
      }
    }
    render();
  };
  controls.addEventListener('change', update);
  window.addEventListener('resize', resize);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controls.removeEventListener('change', update);
    window.removeEventListener('resize', resize);
    bundles.forEach(bundle => bundle.material.dispose());
    manager.dispose();
    geometry.dispose();
    environment.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  resize();
  return { renderer, scene, bundles, render, dispose };
}

const viewport = document.getElementById('reference-viewport');
const controls = document.getElementById('map-controls');
const status = document.getElementById('reference-status');
if (viewport && controls && status) {
  try {
    const reference = createMaterialReference(viewport, controls);
    window.GQMaterialReference = reference;
    window.addEventListener('pagehide', reference.dispose, { once: true });
    status.textContent = 'Ready · 4 families · 5 coherent maps · 64 × 64 RGBA · fixed neutral environment';
    document.documentElement.dataset.referenceReady = 'true';
  } catch (error) {
    status.textContent = `Reference unavailable: ${error.message}`;
    document.documentElement.dataset.referenceReady = 'error';
  }
}
