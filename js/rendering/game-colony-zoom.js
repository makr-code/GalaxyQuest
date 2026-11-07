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
  function activeSurface() {
    if (disposed || zoom._transition || ![levels.colony, levels.building].includes(zoom._activeLevel)) return null;
    return zoom._active;
  }
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
            const errors = [error];
            try { dispose(); } catch (cleanupError) { errors.push(cleanupError); }
            try { onReturn(); } catch (returnError) { errors.push(returnError); }
            const failure = errors.length === 1 ? error
              : new AggregateError(errors, 'Colony rendering and recovery failed');
            try { onError(failure); } catch (reportingError) {
              throw new AggregateError([failure, reportingError], 'Colony failure reporting failed');
            }
          }
        });
      },
    },
    getCameraState: () => getCameraState(),
    onError: report,
  });
  zoom.register(levels.system, { webgpu: SharedSystemLevel });
  zoom.register(levels.planet, { webgpu: Planet });
  zoom.register(levels.colony, { webgpu: Surface });
  zoom.on('enterLevel', (level) => {
    if (disposed) return;
    if (level === levels.system) onReturn();
    else onLevel(Object.keys(levels).find((key) => levels[key] === level));
  });
  signal?.addEventListener('abort', abort, { once: true });
  try {
    await zoom.initialize();
    signal?.throwIfAborted();
  } catch (error) {
    try { dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Colony initialization and cleanup failed');
    }
    throw error;
  }
  window.__GQ_ZOOM_ORCHESTRATOR = zoom;
  function abort() {
    try { dispose(); } catch (error) { onError(error); }
  }
  function report(error) {
    if (!disposed && error.name !== 'AbortError') onError(error);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener('abort', abort);
    revision++;
    current = null;
    approachPending = null;
    try {
      zoom.dispose();
    } finally {
      if (window.__GQ_ZOOM_ORCHESTRATOR === zoom) delete window.__GQ_ZOOM_ORCHESTRATOR;
    }
  }
  async function approach(data, from = null) {
    if (disposed || zoom._transition) return false;
    const version = ++revision;
    const pending = zoom.zoomTo(levels.planet, data, {
      skipCameraFlight: !from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      cameraFrom: from?.position, cameraTo: getCameraState().position, flyDuration: 1200,
    });
    approachPending = pending;
    try { await pending; }
    finally { if (approachPending === pending) approachPending = null; }
    if (disposed || version !== revision) return false;
    if (zoom._activeLevel !== levels.planet) return false;
    current = data;
    return true;
  }
  return {
    approach,
    async returnTo(level) {
      if (disposed || zoom._transition || !['colony', 'planet'].includes(level)) return false;
      const target = levels[level];
      if (zoom._activeLevel == null || zoom._activeLevel < target) return false;
      const version = ++revision;
      if (zoom._activeLevel === levels.building) await zoom.zoomTo(levels.colony, null);
      if (disposed || version !== revision) return false;
      if (target === levels.planet && zoom._activeLevel === levels.colony) {
        await zoom.zoomTo(levels.planet, current, { skipCameraFlight: true });
      }
      return !disposed && version === revision && zoom._activeLevel === target;
    },
    async surface(loadData) {
      if (disposed) return false;
      const version = ++revision;
      const data = await loadData();
      if (disposed || version !== revision) return false;
      await approachPending;
      if (disposed || version !== revision || zoom._transition) return false;
      if (zoom._activeLevel !== levels.planet) {
        await zoom.zoomTo(levels.planet, data, { skipCameraFlight: true });
        if (disposed || version !== revision || zoom._activeLevel !== levels.planet) return false;
      }
      await zoom.zoomTo(levels.colony, data);
      if (disposed || version !== revision || zoom._activeLevel !== levels.colony) return false;
      current = data;
      return true;
    },
    back() {
      if (disposed || zoom._transition) return;
      ++revision;
      if (zoom._activeLevel === levels.building) {
        void zoom.zoomTo(levels.colony, null).catch(report);
      } else if (zoom._activeLevel === levels.colony) {
        void zoom.zoomTo(levels.planet, current, { skipCameraFlight: true }).catch(report);
      } else {
        void zoom.zoomTo(levels.system, null).catch(report);
      }
    },
    reset() {
      activeSurface()?.resetView?.();
    },
    rotateView: (dx, dy) => activeSurface()?.rotateView?.(dx, dy),
    panView: (dx, dy) => activeSurface()?.panView?.(dx, dy),
    zoomBy: (amount) => activeSurface()?.zoomBy?.(amount),
    selectAt: (x, y) => activeSurface()?.selectAt?.(x, y),
    nudgeZoom: (direction) => activeSurface()?.nudgeZoom?.(direction),
    refreshColony(colonyId) {
      return activeSurface()?.refreshSnapshot(colonyId);
    },
    getStats() {
      const surface = zoom._activeLevel >= levels.colony ? zoom._active : null;
      return { level: zoom._activeLevel, buildings: surface?._slots?.length || 0,
        terrainVertices: surface?._terrainVertexCount || 0, transition: surface?._camera?.progress ?? null,
        snapshot: surface?._snapshotState || '', selected: surface?._selected?.type || null,
        target: surface?._camera?.target, orbit: surface?._orbit, span: surface?._camera?.span };
    },
    dispose,
  };
}
