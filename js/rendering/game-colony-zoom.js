function exported(module, globalName, name) {
  const value = module.default?.[name] || module[name] || window[globalName]?.[name];
  if (!value) throw new Error(`Zoom module does not expose ${name}.`);
  return value;
}

export async function createGameColonyZoom({ renderer, canvas, getCameraState, onLevel, onReturn, onError, signal }) {
  const backend = renderer.getSharedZoomBackend();
  await Promise.all([
    import('../engine/zoom/IZoomLevelRenderer.js'),
    import('../engine/zoom/RendererRegistry.js'),
    import('../engine/zoom/CameraFlightPath.js'),
    import('./body-material.js'),
  ]);
  const surfaceModule = await import('../engine/zoom/levels/ColonySurfaceLevelWebGPU.js');
  const [planetModule, orchestratorModule] = await Promise.all([
    import('../engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js'),
    import('../engine/zoom/SeamlessZoomOrchestrator.js'),
  ]);
  signal?.throwIfAborted();
  const Surface = exported(surfaceModule, 'GQColonySurfaceLevelWebGPU', 'ColonySurfaceLevelWebGPU');
  const Planet = exported(planetModule, 'GQPersistentBodyPlanetApproach', 'PersistentBodyPlanetApproachRenderer');
  const Orchestrator = exported(orchestratorModule, 'GQSeamlessZoomOrchestrator', 'SeamlessZoomOrchestrator');
  let disposed = false;
  let revision = 0;
  let current = null;
  let approachPending = null;
  const levels = { system: 1, planet: 2, colony: 3, building: 5 };
  class SharedSystemLevel {
    async initialize() {}
    async enter() {}
    async exit() {}
    render() {}
    dispose() {}
  }
  const zoom = new Orchestrator(canvas, {
    requireSharedBackend: true,
    backend: {
      ...backend,
      addFrameHook(hook) {
        return backend.addFrameHook((dt) => {
          if (disposed) return;
          try { hook(dt); } catch (error) {
            backend.setZoomSceneActive(false);
            zoom.dispose();
            disposed = true;
            if (window.__GQ_ZOOM_ORCHESTRATOR === zoom) delete window.__GQ_ZOOM_ORCHESTRATOR;
            onReturn();
            onError(error);
          }
        });
      },
    },
    getCameraState: () => getCameraState(),
  });
  zoom.register(levels.system, { webgpu: SharedSystemLevel });
  zoom.register(levels.planet, { webgpu: Planet });
  zoom.register(levels.colony, { webgpu: Surface });
  zoom.on('enterLevel', (level) => {
    if (disposed) return;
    if (level === levels.system) onReturn();
    else onLevel(Object.keys(levels).find((key) => levels[key] === level));
  });
  await zoom.initialize();
  if (signal?.aborted) { zoom.dispose(); signal.throwIfAborted(); }
  window.__GQ_ZOOM_ORCHESTRATOR = zoom;
  function report(error) {
    if (!disposed && error.name !== 'AbortError') onError(error);
  }
  async function approach(data, from = null) {
    if (disposed) return false;
    const version = ++revision;
    current = data;
    const pending = zoom.zoomTo(levels.planet, data, {
      skipCameraFlight: !from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      cameraFrom: from?.position, cameraTo: getCameraState().position, flyDuration: 1200,
    });
    approachPending = pending;
    try { await pending; }
    finally { if (approachPending === pending) approachPending = null; }
    if (disposed || version !== revision) return false;
    return true;
  }
  return {
    approach,
    async returnTo(level) {
      if (disposed || zoom._transition || !['colony', 'planet'].includes(level)) return false;
      const target = levels[level];
      if (zoom._activeLevel < target) return false;
      if (zoom._activeLevel === levels.building) await zoom.zoomTo(levels.colony, null);
      if (disposed) return false;
      if (target === levels.planet && zoom._activeLevel === levels.colony) {
        await zoom.zoomTo(levels.planet, current, { skipCameraFlight: true });
      }
      return !disposed && zoom._activeLevel === target;
    },
    async surface(loadData) {
      if (disposed) return false;
      const version = ++revision;
      const data = await loadData();
      if (disposed || version !== revision) return false;
      await approachPending;
      if (disposed || version !== revision) return false;
      if (zoom._activeLevel !== levels.planet) {
        await zoom.zoomTo(levels.planet, data, { skipCameraFlight: true });
        if (disposed || version !== revision) return false;
      }
      current = data;
      await zoom.zoomTo(levels.colony, data);
      return !disposed && version === revision;
    },
    back() {
      if (disposed) return;
      if (zoom._activeLevel === levels.building) {
        void zoom.zoomTo(levels.colony, null).catch(report);
      } else if (zoom._activeLevel === levels.colony) {
        void zoom.zoomTo(levels.planet, current, { skipCameraFlight: true }).catch(report);
      } else {
        void zoom.zoomTo(levels.system, null).catch(report);
      }
    },
    reset() {
      zoom._active?.resetView?.();
    },
    rotateView: (dx, dy) => zoom._active?.rotateView?.(dx, dy),
    panView: (dx, dy) => zoom._active?.panView?.(dx, dy),
    zoomBy: (amount) => zoom._active?.zoomBy?.(amount),
    selectAt: (x, y) => zoom._active?.selectAt?.(x, y),
    nudgeZoom: (direction) => zoom._active?.nudgeZoom?.(direction),
    refreshColony(colonyId) {
      if (disposed || ![levels.colony, levels.building].includes(zoom._activeLevel)) return;
      return zoom._active.refreshSnapshot(colonyId);
    },
    getStats() {
      const surface = zoom._activeLevel >= levels.colony ? zoom._active : null;
      return { level: zoom._activeLevel, buildings: surface?._slots?.length || 0,
        terrainVertices: surface?._terrainVertexCount || 0, transition: surface?._camera?.progress ?? null,
        snapshot: surface?._snapshotState || '', selected: surface?._selected?.type || null,
        target: surface?._camera?.target, orbit: surface?._orbit, span: surface?._camera?.span };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision++;
      zoom.dispose();
      if (window.__GQ_ZOOM_ORCHESTRATOR === zoom) delete window.__GQ_ZOOM_ORCHESTRATOR;
    },
  };
}
