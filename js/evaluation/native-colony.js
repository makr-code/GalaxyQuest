/** Actual native zoom renderer; deliberately no RendererFactory changes. */
export async function createNativeColony(canvas) {
  if (!navigator.gpu) throw new Error('Native colony requires WebGPU; choose Babylon WebGL fallback on this device');
  await import('../engine/zoom/IZoomLevelRenderer.js');
  const nativeModule = await import('../engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
  // Vite build converts the legacy CommonJS branch; dev uses its browser global.
  const Renderer = nativeModule.default?.ColonySurfaceLevelWebGPU ??
    nativeModule.ColonySurfaceLevelWebGPU ?? window.GQColonySurfaceLevelWebGPU?.ColonySurfaceLevelWebGPU;
  if (!Renderer) throw new Error('Native colony module did not expose its renderer');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  let context, renderer;
  let disposed = false;
  let validationFailure = null;
  const onError = event => { validationFailure = event.error; };
  device.addEventListener('uncapturederror', onError);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    device.removeEventListener('uncapturederror', onError);
    try { renderer?.dispose(); } finally {
      try { context?.unconfigure(); } finally { device.destroy(); }
    }
  };
  try {
    context = canvas.getContext('webgpu');
    renderer = new Renderer();
    if (!context) throw new Error('Cannot create native WebGPU context');
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    device.pushErrorScope('validation');
    await renderer.initialize(canvas, { device, context });
    const error = await device.popErrorScope();
    if (error) throw new Error(`Native pipeline validation failed: ${error.message}`);
    return {
      canvas, backend: 'native-colony-webgpu',
      setSceneData: data => renderer.setSceneData(data),
      enter: (...args) => renderer.enter(...args), exit: (...args) => renderer.exit(...args),
      render: (...args) => {
        if (validationFailure) throw new Error(`Native GPU validation failed: ${validationFailure.message}`);
        renderer.render(...args);
      }, dispose,
      // Native implementation catches frame errors internally; expose device loss as a hard failure.
      lost: device.lost,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
