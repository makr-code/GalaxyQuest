const runtimeModules = new Map([
  ['js/runtime/audio.js', () => import('./audio.js')],
  ['js/ui/gq-ui.js', () => import('../ui/gq-ui.js')],
  ['js/runtime/wm.js', () => import('./wm.js')],
  ['js/runtime/wm-widgets.js', () => import('./wm-widgets.js')],
  ['js/runtime/gqwm.js', () => import('./gqwm.js')],
  ['js/runtime/model_registry.js', () => import('./model_registry.js')],
  ['js/vendor/three.min.js', () => import('../three-runtime.js')],
  ['js/rendering/starfield-webgpu.js', () => import('../rendering/starfield-webgpu.js')],
  ['js/rendering/Galaxy3DRendererWebGPU.js', () => import('../rendering/Galaxy3DRendererWebGPU.js')],
  ['js/legacy/galaxy3d-webgpu.js', () => import('../legacy/galaxy3d-webgpu.js')],
  ['js/rendering/galaxy-camera-controller.js', () => import('../rendering/galaxy-camera-controller.js')],
  ['js/engine/assets/WorldAssetDescriptor.js', () => import('../engine/assets/WorldAssetDescriptor.js')],
  ['js/engine/assets/CoherentMaterialGenerator.js', async () => {
    await loadRuntimeModule('js/engine/assets/WorldAssetDescriptor.js');
    return import('../engine/assets/CoherentMaterialGenerator.js');
  }],
  ['js/rendering/texture-manager.js', async () => {
    await loadRuntimeModule('js/engine/assets/CoherentMaterialGenerator.js');
    return import('../rendering/texture-manager.js');
  }],
  ['js/rendering/geometry-manager.js', () => import('../rendering/geometry-manager.js')],
  ['js/rendering/material-factory.js', () => import('../rendering/material-factory.js')],
  ['js/rendering/light-rig-manager.js', () => import('../rendering/light-rig-manager.js')],
  ['js/engine/procedural/ProceduralMeshGenerator.js', () => import('../engine/procedural/ProceduralMeshGenerator.js')],
  ['js/rendering/SystemSpecialBodiesRenderer.js', async () => {
    await loadRuntimeModule('js/engine/procedural/ProceduralMeshGenerator.js');
    return import('../rendering/SystemSpecialBodiesRenderer.js');
  }],
  ['js/rendering/galaxy-renderer-core.js', async () => {
    await loadRuntimeModule('js/runtime/model_registry.js');
    Promise.resolve().then(() => window.__GQ_ModelRegistry.preload())
      .catch((error) => console.warn('[ModelRegistry] background preload failed:', error));
    await loadRuntimeModule('js/rendering/SystemSpecialBodiesRenderer.js');
    return import('../rendering/galaxy-renderer-core.js');
  }],
]);

const loadedModules = new Map();

function normalizeRuntimePath(src) {
  try {
    return new URL(String(src || ''), document.baseURI).pathname
      .replace(/^\/+/, '')
      .replace(/\\/g, '/');
  } catch {
    return '';
  }
}

export function loadRuntimeModule(src) {
  const path = normalizeRuntimePath(src);
  const loader = runtimeModules.get(path);
  if (!loader) return null;

  if (!loadedModules.has(path)) {
    loadedModules.set(path, loader().then(() => undefined));
  }
  return loadedModules.get(path);
}
