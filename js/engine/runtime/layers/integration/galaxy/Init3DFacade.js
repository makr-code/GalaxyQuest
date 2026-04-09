/**
 * RuntimeGalaxyInit3DFacade.js
 * Init3DFacade.js
 *
 * High-level facade for GalaxyController.init3D.
 */

'use strict';

(function () {
  function normalizeBackendLabel(rawBackend) {
    const value = String(rawBackend || '').toLowerCase();
    if (value === 'threejs' || value === 'three-webgl' || value === 'engine-webgl' || value === 'webgl2') {
      return 'webgl-compat';
    }
    if (value === 'webgl1') return 'webgl1-compat';
    return String(rawBackend || 'unknown');
  }

  function diagLog(payload, level = 'info') {
    try {
      const fn = window.GQLog && typeof window.GQLog[level] === 'function' ? window.GQLog[level] : null;
      const line = JSON.stringify(payload || {});
      if (fn) {
        fn('[galaxy-init3d]', line);
      } else {
        console[level]('[GQ][GalaxyInit3D]', payload);
      }
    } catch (_) {}
  }

  const state = {
    windowRef: null,
    documentRef: null,
    getGalaxy3d: null,
    setGalaxy3d: null,
    getGalaxy3dInitReason: null,
    setGalaxy3dInitReason: null,
    setGalaxy3dQualityState: null,
    getGalaxy3dQualityState: null,
    setGalaxyAutoFramedOnce: null,
    getSettingsState: null,
    getUiState: null,
    getZoomOrchestrator: null,
    setZoomOrchestrator: null,
    emitRuntimeEvent: null,
    esc: null,
    gameLog: null,
    showToast: null,
    toggleGalaxyOverlay: null,
    isSharedLevelRenderer: null,
    attachRendererCallbacks: null,
    getPreferredLevelSharedRenderer: null,
    applyRuntimeSettings: null,
    refreshGalaxyDensityMetrics: null,
    updateGalaxyFollowUi: null,
    updateClusterBoundsUi: null,
    syncRendererInputContext: null,
    resolveClusterColorPalette: null,
    commitSelectionState: null,
    updateGalaxyHoverCard: null,
    focusPlanetDetailsInOverlay: null,
    renderGalaxySystemDetails: null,
    applyClusterRangeToControls: null,
    flashGalaxyControlBtn: null,
    logEnterSystemPipeline: null,
    loadGalaxyStars3D: null,
    loadStarSystemPlanets: null,
    transitionOutOfSystemView: null,
    renderGalaxyColonySummary: null,
    isSystemModeActive: null,
    getAudioManager: null,
    getPinnedStar: null,
    setPinnedStar: null,
    getGalaxyStars: null,
    getActiveRange: null,
    getGalaxyRendererBootstrapApi: null,
  };

  function configureGalaxyInit3DFacadeRuntime(opts = {}) {
    Object.keys(state).forEach((key) => {
      state[key] = opts[key] || null;
    });
    if (!state.windowRef) state.windowRef = window;
    if (!state.documentRef) state.documentRef = document;
  }

  function hasCoreThreeCtors(obj) {
    return !!obj
      && (typeof obj === 'object' || typeof obj === 'function')
      && typeof obj.Scene === 'function'
      && typeof obj.Vector3 === 'function';
  }

  function collectThreeCandidates(win, base) {
    const candidates = [];
    const push = (value) => {
      if (!value) return;
      if (candidates.includes(value)) return;
      candidates.push(value);
    };

    push(base);
    if (base && (typeof base === 'object' || typeof base === 'function')) {
      push(base.THREE);
      push(base.default);
      push(base.module);
      push(base.namespace);
    }

    push(win?.__GQ_THREE_RUNTIME || null);
    push(win?.__THREE__ || null);
    push(win?.THREE_NS || null);

    try {
      const names = Object.getOwnPropertyNames(win || {});
      for (const name of names) {
        if (!/three/i.test(String(name || ''))) continue;
        push(win[name]);
      }
    } catch (_) {}

    return candidates;
  }

  function loadScriptOnce(win, src) {
    const key = String(src || '').trim();
    if (!key) return Promise.reject(new Error('missing script src'));
    const existing = win.document?.querySelector?.(`script[src="${key}"]`);
    if (existing) {
      if (hasCoreThreeCtors(win?.THREE)) return Promise.resolve();
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const s = win.document.createElement('script');
      s.src = key;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`script load failed: ${key}`));
      win.document.head.appendChild(s);
    });
  }

  function ensureThreeRuntimeLoaded(win) {
    if (hasCoreThreeCtors(win?.THREE)) return Promise.resolve(true);
    if (win.__GQ_THREE_RECOVERY_PROMISE) return win.__GQ_THREE_RECOVERY_PROMISE;

    const cdnCandidates = [
      'js/vendor/three.min.js',
      'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
      'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js',
    ];

    const job = (async () => {
      for (const src of cdnCandidates) {
        try {
          await loadScriptOnce(win, src);
          const resolved = resolveThreeGlobal(win);
          if (hasCoreThreeCtors(resolved)) return true;
        } catch (_) {}
      }
      return hasCoreThreeCtors(resolveThreeGlobal(win));
    })().finally(() => {
      try { win.__GQ_THREE_RECOVERY_PROMISE = null; } catch (_) {}
    });

    win.__GQ_THREE_RECOVERY_PROMISE = job;
    return job;
  }

  function resolveThreeGlobal(win) {
    const three = win?.THREE || null;
    const candidates = collectThreeCandidates(win, three);
    for (const candidate of candidates) {
      if (!hasCoreThreeCtors(candidate)) continue;
      try {
        win.THREE = candidate;
        win.__GQ_THREE_RUNTIME = candidate;
      } catch (_) {}
      return candidate;
    }
    return null;
  }

  function initGalaxy3D(root) {
    state.emitRuntimeEvent?.('runtime:renderer-init-start', {
      view: 'galaxy',
      ts: Date.now(),
    });

    const holder = state.documentRef.getElementById('galaxy-3d-host');
    const hostWrapper = state.documentRef.getElementById('galaxy-host-wrapper');
    const sharedCanvas = holder?.querySelector('#starfield');
    try {
      diagLog({
        stage: 'init:container-check',
        ts: Date.now(),
        holder: !!holder,
        hostWrapper: !!hostWrapper,
        sharedCanvas: !!sharedCanvas,
        bodyClass: String(state.documentRef?.body?.className || ''),
      });
    } catch (_) {}
    if (!holder) {
      state.emitRuntimeEvent?.('runtime:renderer-init-failed', {
        view: 'galaxy',
        reason: 'missing-host-container',
        ts: Date.now(),
      });
      state.setGalaxy3dInitReason?.('Missing #galaxy-3d-host container');
      const reasonText = state.getGalaxy3dInitReason?.() || 'unknown';
      root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D engine failed to load. Reason: ${state.esc ? state.esc(reasonText) : reasonText}</span>`;
      state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
      return;
    }

    const resolvedThree = resolveThreeGlobal(state.windowRef);
    if (!resolvedThree || typeof resolvedThree.Scene !== 'function') {
      const reason = 'THREE is missing or invalid (Scene constructor unavailable)';
      state.emitRuntimeEvent?.('runtime:renderer-init-failed', {
        view: 'galaxy',
        reason,
        ts: Date.now(),
      });
      state.setGalaxy3dInitReason?.(reason);
      diagLog({
        stage: 'init:three-missing',
        ts: Date.now(),
        reason,
      }, 'warn');

      const canRetry = !state.windowRef.__GQ_THREE_RECOVERY_IN_FLIGHT;
      if (canRetry) {
        state.windowRef.__GQ_THREE_RECOVERY_IN_FLIGHT = true;
        ensureThreeRuntimeLoaded(state.windowRef)
          .then((ok) => {
            const recovered = !!ok && !!resolveThreeGlobal(state.windowRef);
            diagLog({
              stage: 'init:three-recovery-result',
              ts: Date.now(),
              recovered,
            }, recovered ? 'info' : 'warn');
            if (!recovered) return;
            if (state.getGalaxy3d?.()) return;
            state.setGalaxy3dInitReason?.('');
            try {
              initGalaxy3D(root);
            } catch (_) {}
          })
          .finally(() => {
            try { state.windowRef.__GQ_THREE_RECOVERY_IN_FLIGHT = false; } catch (_) {}
          });
      }
      const safeReason = state.esc ? state.esc(reason) : reason;
      root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D renderer unavailable. Fallback list active. Reason: ${safeReason}</span>`;
      state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
      return;
    }

    const GalaxyViewCtor = state.windowRef.Galaxy3DView || state.windowRef.Galaxy3DRendererWebGPU || state.windowRef.Galaxy3DRenderer;
    try {
      diagLog({
        stage: 'init:ctor-resolve',
        ts: Date.now(),
        hasGalaxy3DView: !!state.windowRef.Galaxy3DView,
        hasWebGPU: !!state.windowRef.Galaxy3DRendererWebGPU,
        hasLegacy: !!state.windowRef.Galaxy3DRenderer,
        resolvedCtor: String(GalaxyViewCtor?.name || ''),
      });
    } catch (_) {}

    const existingRenderer = state.getGalaxy3d?.();
    if (existingRenderer) {
      if (state.isSharedLevelRenderer?.(existingRenderer)) {
        state.setGalaxy3d?.(null);
      } else {
        existingRenderer.destroy?.();
        state.setGalaxy3d?.(null);
      }
    }

    state.setGalaxyAutoFramedOnce?.(false);

    try {
      const settingsState = state.getSettingsState?.() || {};
      const uiState = state.getUiState?.() || {};
      const resolvedRendererQuality = state.windowRef.GQGalaxyRendererConfig?.resolveQualityProfile?.({
        requestedProfile: settingsState.renderQualityProfile || 'auto',
      }) || null;
      state.setGalaxy3dQualityState?.(resolvedRendererQuality);

      const authBgControl = state.windowRef.GQAuthGalaxyBackgroundControl || state.windowRef.GQStarfieldControl;
      if (state.windowRef.__GQ_RELEASE_AUTH_BG_ON_BOOT !== false
        && authBgControl
        && typeof authBgControl.releaseCanvasForGame === 'function') {
        try {
          diagLog({
            stage: 'init:release-auth-bg',
            ts: Date.now(),
            control: authBgControl === state.windowRef.GQAuthGalaxyBackgroundControl ? 'auth-bg' : 'starfield',
          });
        } catch (_) {}
        authBgControl.releaseCanvasForGame();
      }

      const stage = root?.querySelector('.galaxy-3d-stage') || state.documentRef.getElementById('galaxy-stage');
      if (stage) {
        stage.style.pointerEvents = 'none';
        stage.style.zIndex = '1';
      }
      if (hostWrapper) {
        hostWrapper.style.display = 'block';
        hostWrapper.style.visibility = 'visible';
        hostWrapper.style.opacity = '1';
      }
      if (holder) {
        holder.style.display = 'block';
        holder.style.visibility = 'visible';
        holder.style.opacity = '1';
      }
      if (sharedCanvas instanceof HTMLCanvasElement) {
        sharedCanvas.style.display = 'block';
        sharedCanvas.style.opacity = '1';
        sharedCanvas.style.visibility = 'visible';
        sharedCanvas.style.pointerEvents = 'auto';
      }

      const gqZoom = state.windowRef.GQSeamlessZoomOrchestrator || {};
      const gqLevels = {
        // Three.js levels remain wired as compatibility backends while WebGPU reaches parity.
        galaxyThreeJS: (state.windowRef.GQGalaxyLevelThreeJS || {}).GalaxyLevelThreeJS,
        galaxyWebGPU: (state.windowRef.GQGalaxyLevelWebGPU || {}).GalaxyLevelWebGPU
          || (state.windowRef.GQGalaxyLevelThreeJS || {}).GalaxyLevelThreeJS,
        systemThreeJS: (state.windowRef.GQSystemLevelThreeJS || {}).SystemLevelThreeJS,
        systemWebGPU: (state.windowRef.GQSystemLevelWebGPU || {}).SystemLevelWebGPU,
        planetThreeJS: (state.windowRef.GQPlanetApproachLevelThreeJS || {}).PlanetApproachLevelThreeJS,
        planetWebGPU: (state.windowRef.GQPlanetApproachLevelWebGPU || {}).PlanetApproachLevelWebGPU,
        colonyThreeJS: (state.windowRef.GQColonySurfaceLevelThreeJS || {}).ColonySurfaceLevelThreeJS,
        colonyWebGPU: (state.windowRef.GQColonySurfaceLevelWebGPU || {}).ColonySurfaceLevelWebGPU,
        objectThreeJS: (state.windowRef.GQObjectApproachLevelThreeJS || {}).ObjectApproachLevelThreeJS,
        objectWebGPU: (state.windowRef.GQObjectApproachLevelWebGPU || {}).ObjectApproachLevelWebGPU,
        colonyBuildingThreeJS: (state.windowRef.GQColonyBuildingLevelThreeJS || {}).ColonyBuildingLevelThreeJS
          || (state.windowRef.GQObjectApproachLevelThreeJS || {}).ObjectApproachLevelThreeJS,
        colonyBuildingWebGPU: (state.windowRef.GQColonyBuildingLevelWebGPU || {}).ColonyBuildingLevelWebGPU
          || (state.windowRef.GQObjectApproachLevelWebGPU || {}).ObjectApproachLevelWebGPU,
      };
      const ZOOM_LEVEL = gqZoom.ZOOM_LEVEL;
      const SPATIAL_DEPTH = gqZoom.SPATIAL_DEPTH;
      const SeamlessZoomOrchestrator = gqZoom.SeamlessZoomOrchestrator;
      const disableWebGpuPath = false;

      const rendererOptions = {
        externalCanvas: sharedCanvas instanceof HTMLCanvasElement ? sharedCanvas : null,
        interactive: true,
        qualityProfile: resolvedRendererQuality?.name || settingsState.renderQualityProfile || 'webgpu',
        onHover: (star, pos) => {
          state.commitSelectionState?.('hover', star, pos, 'hover');
          state.updateGalaxyHoverCard?.(root, star, pos, false);
        },
        onClick: (star, pos) => {
          state.commitSelectionState?.('active', star, pos, 'click');
          if (star?.__kind === 'planet') {
            state.focusPlanetDetailsInOverlay?.(root, star, false, false);
            state.updateGalaxyHoverCard?.(root, star, pos, true);
            return;
          }
          if (star?.__kind === 'cluster') {
            state.setPinnedStar?.(star);
            state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
            state.updateGalaxyHoverCard?.(root, star, pos, true);
            state.renderGalaxySystemDetails?.(root, star, false);
            state.applyClusterRangeToControls?.(root, star, { toast: false });
            state.flashGalaxyControlBtn?.(root, '#gal-cluster-bounds-btn');
            return;
          }
          if (star?.__kind === 'system_fleet' || star?.__kind === 'galaxy_fleet') {
            state.updateGalaxyHoverCard?.(root, star, pos, true);
            return;
          }
          state.setPinnedStar?.(star);
          state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
          state.updateGalaxyHoverCard?.(root, star, pos, true);
          state.renderGalaxySystemDetails?.(root, star, false);
        },
        onDoubleClick: async (star, pos) => {
          state.commitSelectionState?.('active', star, pos, 'doubleClick');
          const galaxy3dForLog = state.getGalaxy3d?.();
          state.logEnterSystemPipeline?.('renderer:onDoubleClick', {
            rendererInstanceId: String(galaxy3dForLog?.getRenderStats?.().instanceId || galaxy3dForLog?.instanceId || ''),
            rendererBackend: normalizeBackendLabel(galaxy3dForLog?.backendType || galaxy3dForLog?.getRenderStats?.().backend || ''),
            rendererHasEnterSystemView: typeof galaxy3dForLog?.enterSystemView === 'function',
            kind: String(star?.__kind || 'star'),
            galaxy: Number(star?.galaxy_index || star?.__sourceStar?.galaxy_index || 0),
            system: Number(star?.system_index || star?.__sourceStar?.system_index || 0),
            starName: String(star?.name || star?.catalog_name || star?.__sourceStar?.name || ''),
            pos: pos ? { x: Number(pos.x || 0), y: Number(pos.y || 0) } : null,
          });
          if (star?.__kind === 'planet') {
            state.focusPlanetDetailsInOverlay?.(root, star, true, true);
            state.updateGalaxyHoverCard?.(root, star, pos, true);
            const currentOrchestrator = state.getZoomOrchestrator?.();
            if (currentOrchestrator && SPATIAL_DEPTH) {
              currentOrchestrator.zoomToTarget(Object.assign({ spatialDepth: SPATIAL_DEPTH.STELLAR_VICINITY }, star)).catch(() => {});
            }
            return;
          }
          if (star?.__kind === 'cluster') {
            state.setPinnedStar?.(star);
            state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
            state.updateGalaxyHoverCard?.(root, star, pos, true);
            state.renderGalaxySystemDetails?.(root, star, true);
            const range = state.applyClusterRangeToControls?.(root, star, { toast: true });
            if (range) {
              state.flashGalaxyControlBtn?.(root, '#gal-cluster-bounds-btn');
              await state.loadGalaxyStars3D?.(root);
            }
            return;
          }
          const audioManager = state.getAudioManager?.();
          if (audioManager && typeof audioManager.setScene === 'function') {
            audioManager.setScene('system', { autoplay: true, transition: 'soft', minHoldMs: 700 });
          }
          state.setPinnedStar?.(star);
          state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
          state.updateGalaxyHoverCard?.(root, star, pos, true);
          state.renderGalaxySystemDetails?.(root, star, true);
          await state.loadStarSystemPlanets?.(root, star);
          const currentOrchestrator = state.getZoomOrchestrator?.();
          if (currentOrchestrator && SPATIAL_DEPTH && star) {
            currentOrchestrator.zoomToTarget(Object.assign({ spatialDepth: SPATIAL_DEPTH.STAR_SYSTEM }, star)).catch(() => {});
          }
        },
        onSystemZoomOut: (star) => {
          const audioManager = state.getAudioManager?.();
          if (audioManager && typeof audioManager.setScene === 'function') {
            audioManager.setScene('galaxy', { autoplay: true, transition: 'soft', minHoldMs: 700 });
          }
          state.transitionOutOfSystemView?.(star, 'renderer:onSystemZoomOut');
          state.setPinnedStar?.(star || null);
          state.renderGalaxySystemDetails?.(root, star, false);
          const panel = root.querySelector('#galaxy-planets-panel');
          if (panel) {
            state.renderGalaxyColonySummary?.(panel, state.getGalaxyStars?.() || [], state.getActiveRange?.() || null);
          }
          const currentOrchestrator = state.getZoomOrchestrator?.();
          if (currentOrchestrator && ZOOM_LEVEL) {
            currentOrchestrator.zoomTo(ZOOM_LEVEL.GALAXY, null).catch(() => {});
          }
        },
        onPlanetZoomOut: (star) => {
          const audioManager = state.getAudioManager?.();
          if (audioManager && typeof audioManager.setScene === 'function') {
            audioManager.setScene('system', { autoplay: true, transition: 'normal', minHoldMs: 500 });
          }
          if (star) state.renderGalaxySystemDetails?.(root, star, true);
          const currentOrchestrator = state.getZoomOrchestrator?.();
          if (currentOrchestrator && ZOOM_LEVEL) {
            currentOrchestrator.zoomTo(ZOOM_LEVEL.SYSTEM, star || null).catch(() => {});
          }
        },
      };

      state.windowRef.__GQ_LEVEL_RENDERER_OPTIONS = rendererOptions;

      const adoptSharedRendererIfAvailable = () => {
        const sharedLevelRenderer = state.getPreferredLevelSharedRenderer?.();
        let galaxy3d = state.getGalaxy3d?.();
        if (!sharedLevelRenderer || galaxy3d === sharedLevelRenderer) return false;
        if (galaxy3d && !state.isSharedLevelRenderer?.(galaxy3d) && typeof galaxy3d.destroy === 'function') {
          try { galaxy3d.destroy(); } catch (_) {}
        }
        galaxy3d = sharedLevelRenderer;
        state.setGalaxy3d?.(galaxy3d);
        state.attachRendererCallbacks?.(galaxy3d, rendererOptions);
        if (galaxy3d?.renderer?.domElement) {
          galaxy3d.renderer.domElement.style.pointerEvents = 'auto';
        }
        state.applyRuntimeSettings?.();
        state.refreshGalaxyDensityMetrics?.(root);
        state.updateGalaxyFollowUi?.(root);
        state.updateClusterBoundsUi?.(root);
        state.syncRendererInputContext?.(galaxy3d);
        state.setGalaxy3dInitReason?.('');
        return true;
      };

      const canBootstrapOrchestrator = !!(
        !disableWebGpuPath &&
        SeamlessZoomOrchestrator && ZOOM_LEVEL &&
        sharedCanvas instanceof HTMLCanvasElement &&
        gqLevels.galaxyThreeJS && gqLevels.galaxyWebGPU
      );
      diagLog({
        stage: 'init:bootstrap-decision',
        ts: Date.now(),
        canBootstrapOrchestrator,
        disableWebGpuPath,
        hasSharedCanvas: sharedCanvas instanceof HTMLCanvasElement,
        hasZoomOrchestratorCtor: !!SeamlessZoomOrchestrator,
        hasZoomLevel: !!ZOOM_LEVEL,
        hasLevelGalaxyThree: !!gqLevels.galaxyThreeJS,
        hasLevelGalaxyWebGPU: !!gqLevels.galaxyWebGPU,
      });

      const initDirectRendererFallback = () => {
        let galaxy3d = state.getGalaxy3d?.();
        if (galaxy3d) return true;
        const directRendererCtor = disableWebGpuPath
          ? (state.windowRef.Galaxy3DRenderer || GalaxyViewCtor)
          : GalaxyViewCtor;
        if (!directRendererCtor) {
          state.setGalaxy3dInitReason?.('No direct renderer constructor available');
          return false;
        }
        try {
          galaxy3d = new directRendererCtor(holder, rendererOptions);
          state.setGalaxy3d?.(galaxy3d);
          if (galaxy3d && typeof galaxy3d.init === 'function') {
            Promise.resolve(galaxy3d.init()).catch((err) => {
              console.warn('[GQ] Galaxy3DRendererWebGPU init fallback:', err?.message || err);
            });
          }
          state.setGalaxy3dInitReason?.('');
          return true;
        } catch (err) {
          console.warn('[GQ] direct renderer fallback init failed:', err?.message || err);
          state.setGalaxy3dInitReason?.(String(err?.message || err || 'direct renderer fallback failed'));
          state.setGalaxy3d?.(null);
          return false;
        }
      };

      const sharedLevelRenderer = state.getPreferredLevelSharedRenderer?.();
      if (sharedLevelRenderer) {
        state.setGalaxy3d?.(sharedLevelRenderer);
        state.attachRendererCallbacks?.(sharedLevelRenderer, rendererOptions);
      } else if (!canBootstrapOrchestrator) {
        initDirectRendererFallback();
      }

      let galaxy3d = state.getGalaxy3d?.();
      if (galaxy3d && galaxy3d.backendType) {
        state.windowRef.__GQ_ACTIVE_RENDERER_BACKEND = galaxy3d.backendType;
      }

      if (galaxy3d && typeof galaxy3d.getQualityProfileState === 'function') {
        state.setGalaxy3dQualityState?.(galaxy3d.getQualityProfileState());
      }
      const galaxy3dQualityState = state.getGalaxy3dQualityState?.();
      if (settingsState.renderQualityProfile === 'auto' && galaxy3dQualityState?.name === 'low') {
        state.showToast?.('Low-End-Rendering aktiv: Pixel Ratio, Cache-Groessen und FX wurden reduziert.', 'warning');
      }
      if (galaxy3d?.renderer?.domElement) {
        galaxy3d.renderer.domElement.style.pointerEvents = 'auto';
      }
      state.setGalaxy3dQualityState?.(null);

      const kickResize = () => {
        try {
          const renderer = state.getGalaxy3d?.();
          if (renderer && typeof renderer.resize === 'function') renderer.resize();
        } catch (err) {
          state.gameLog?.('info', 'Galaxy3D resize kick fehlgeschlagen', err);
        }
      };
      kickResize();
      setTimeout(kickResize, 60);
      setTimeout(kickResize, 220);
      state.setGalaxy3dInitReason?.('');

      galaxy3d = state.getGalaxy3d?.();
      if (galaxy3d && typeof galaxy3d.setClusterColorPalette === 'function') {
        galaxy3d.setClusterColorPalette(state.resolveClusterColorPalette?.(uiState.territory));
      }
      if (galaxy3d) {
        state.applyRuntimeSettings?.();
        state.refreshGalaxyDensityMetrics?.(root);
        state.updateGalaxyFollowUi?.(root);
        state.updateClusterBoundsUi?.(root);
      }

      if (canBootstrapOrchestrator) {
        const bootstrapApi = state.getGalaxyRendererBootstrapApi?.() || null;
        if (bootstrapApi && typeof bootstrapApi.bootstrapSeamlessZoomOrchestrator === 'function') {
          diagLog({
            stage: 'init:bootstrap-start',
            ts: Date.now(),
          });
          const currentOrchestrator = state.getZoomOrchestrator?.();
          const nextOrchestrator = bootstrapApi.bootstrapSeamlessZoomOrchestrator({
            currentOrchestrator,
            setOrchestrator: (next) => {
              state.setZoomOrchestrator?.(next || null);
            },
            getCurrentOrchestrator: () => state.getZoomOrchestrator?.() || null,
            sharedCanvas,
            settingsState,
            SeamlessZoomOrchestrator,
            ZOOM_LEVEL,
            levels: gqLevels,
            adoptSharedRendererIfAvailable,
            initDirectRendererFallback,
            onDisposeError: (disposeErr) => {
              console.warn('[GQ] SeamlessZoomOrchestrator dispose error (non-fatal):', disposeErr?.message || disposeErr);
            },
            onInitFailed: (err) => {
              console.warn('[GQ] SeamlessZoomOrchestrator init failed:', err?.message || err, err?.stack || '');
              diagLog({
                stage: 'init:bootstrap-failed',
                ts: Date.now(),
                error: String(err?.message || err || 'unknown error'),
              }, 'warn');
            },
          });
          state.setZoomOrchestrator?.(nextOrchestrator || null);
          diagLog({
            stage: 'init:bootstrap-dispatched',
            ts: Date.now(),
            hasOrchestrator: !!nextOrchestrator,
          });

          // In some runtime constellations orchestrator init resolves but no
          // shared renderer gets adopted. Guard against an endless "rendererReady=false"
          // state by forcing direct fallback after a short grace period.
          setTimeout(() => {
            try {
              if (state.getGalaxy3d?.()) return;
              if (!state.getZoomOrchestrator?.()) return;
              const reason = state.getGalaxy3dInitReason?.();
              if (reason) return;
              state.setGalaxy3dInitReason?.('Seamless bootstrap timeout (no renderer adopted)');
              diagLog({
                stage: 'init:watchdog-timeout',
                ts: Date.now(),
                reason: state.getGalaxy3dInitReason?.() || '',
              }, 'warn');
              const ok = initDirectRendererFallback();
              if (!ok) {
                console.warn('[GQ] Renderer watchdog fallback failed after seamless bootstrap timeout.');
                diagLog({
                  stage: 'init:watchdog-fallback-failed',
                  ts: Date.now(),
                }, 'warn');
              } else {
                diagLog({
                  stage: 'init:watchdog-fallback-ok',
                  ts: Date.now(),
                });
              }
            } catch (_) {}
          }, 1200);
        } else {
          console.warn('[GQ] GalaxyRendererBootstrap API fehlt; nutze direkten Fallback.');
          diagLog({
            stage: 'init:bootstrap-api-missing',
            ts: Date.now(),
          }, 'warn');
          initDirectRendererFallback();
        }
      }

      if (!adoptSharedRendererIfAvailable() && !canBootstrapOrchestrator) {
        initDirectRendererFallback();
      }

      galaxy3d = state.getGalaxy3d?.();
      if (!galaxy3d && !canBootstrapOrchestrator) {
        const reasonText = state.getGalaxy3dInitReason?.() || 'Renderer bootstrap unavailable';
        const safeReason = state.esc ? state.esc(reasonText) : reasonText;
        root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D renderer unavailable. Fallback list active. Reason: ${safeReason}</span>`;
        state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
      }

      state.emitRuntimeEvent?.('runtime:renderer-init-ready', {
        view: 'galaxy',
        backend: normalizeBackendLabel(galaxy3d?.backendType || galaxy3d?.getRenderStats?.().backend || ''),
        hasRenderer: !!galaxy3d,
        hasOrchestrator: !!state.getZoomOrchestrator?.(),
        ts: Date.now(),
      });
    } catch (err) {
      state.emitRuntimeEvent?.('runtime:renderer-init-failed', {
        view: 'galaxy',
        reason: String(err?.message || err || 'unknown error'),
        ts: Date.now(),
      });
      state.setGalaxy3d?.(null);
      console.error('Galaxy3D init failed:', err);
      const reasonText = String(err?.message || err || 'unknown error');
      state.setGalaxy3dInitReason?.(reasonText);
      const safeReason = state.esc ? state.esc(reasonText) : reasonText;
      root.querySelector('#galaxy-system-details').innerHTML = `<span class="text-red">3D renderer unavailable. Fallback list active. Reason: ${safeReason}</span>`;
      state.toggleGalaxyOverlay?.(root, '#galaxy-info-overlay', true);
    }
  }

  const api = {
    configureGalaxyInit3DFacadeRuntime,
    initGalaxy3D,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyInit3DFacade = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();