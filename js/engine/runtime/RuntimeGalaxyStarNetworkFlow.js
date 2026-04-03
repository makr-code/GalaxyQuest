/**
 * RuntimeGalaxyStarNetworkFlow.js
 *
 * Encapsulates network fetch/adaptation and payload merge for galaxy star loading.
 */

'use strict';

(function () {
  const state = {
    apiGalaxyStars: null,
    apiGalaxyFallback: null,
    normalizeStarListVisibility: null,
    normalizeStarVisibility: null,
    mergeGalaxyStarsBySystem: null,
  };

  function configureGalaxyStarNetworkFlowRuntime(opts = {}) {
    state.apiGalaxyStars = typeof opts.apiGalaxyStars === 'function' ? opts.apiGalaxyStars : null;
    state.apiGalaxyFallback = typeof opts.apiGalaxyFallback === 'function' ? opts.apiGalaxyFallback : null;
    state.normalizeStarListVisibility = typeof opts.normalizeStarListVisibility === 'function' ? opts.normalizeStarListVisibility : null;
    state.normalizeStarVisibility = typeof opts.normalizeStarVisibility === 'function' ? opts.normalizeStarVisibility : null;
    state.mergeGalaxyStarsBySystem = typeof opts.mergeGalaxyStarsBySystem === 'function' ? opts.mergeGalaxyStarsBySystem : null;
  }

  async function fetchAdaptedGalaxyStars(opts = {}) {
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const fromSystem = Number(opts.fromSystem || 0);
    const toSystem = Number(opts.toSystem || 0);
    const requestMaxPoints = Number(opts.requestMaxPoints || 0);
    const clusterPreset = String(opts.clusterPreset || 'auto');
    const systemMax = Number(opts.systemMax || 0);
    const assetsManifestVersion = opts.assetsManifestVersion;
    const renderDataAdapter = opts.renderDataAdapter || null;

    const dataRaw = (typeof state.apiGalaxyStars === 'function')
      ? await state.apiGalaxyStars(galaxyIndex, fromSystem, toSystem, requestMaxPoints, {
          streamPriority: 'critical',
          requestPriority: 'critical',
          prefetch: false,
          chunkHint: requestMaxPoints,
          clusterPreset,
          includeClusterLod: false,
        })
      : await state.apiGalaxyFallback(galaxyIndex, fromSystem);

    const adapted = (typeof renderDataAdapter?.adaptGalaxyStars === 'function')
      ? renderDataAdapter.adaptGalaxyStars(dataRaw, {
          galaxy: galaxyIndex,
          from: fromSystem,
          to: toSystem,
          systemMax,
          assetsManifestVersion,
        })
      : { ok: true, data: dataRaw };

    if (!adapted?.ok || !adapted.data?.success) {
      const cls = (typeof renderDataAdapter?.classifyRenderError === 'function')
        ? renderDataAdapter.classifyRenderError(adapted)
        : { type: 'schema' };
      return {
        ok: false,
        cls,
        adapted,
      };
    }

    return {
      ok: true,
      data: adapted.data,
      adapted,
    };
  }

  function mergeNetworkPayloadIntoStars(opts = {}) {
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const currentStars = Array.isArray(opts.currentStars) ? opts.currentStars : [];
    const data = opts.data && typeof opts.data === 'object' ? opts.data : {};

    const normalizeList = typeof state.normalizeStarListVisibility === 'function'
      ? state.normalizeStarListVisibility
      : (stars) => (Array.isArray(stars) ? stars : []);
    const normalizeSingle = typeof state.normalizeStarVisibility === 'function'
      ? state.normalizeStarVisibility
      : (star) => (star || null);
    const mergeBySystem = typeof state.mergeGalaxyStarsBySystem === 'function'
      ? state.mergeGalaxyStarsBySystem
      : ((existingStars, incomingStars) => (Array.isArray(incomingStars) ? incomingStars : existingStars));

    let nextStars;
    if (Array.isArray(data.stars)) {
      nextStars = mergeBySystem(currentStars, normalizeList(data.stars), galaxyIndex);
    } else if (data.star_system) {
      const single = normalizeSingle(Object.assign({}, data.star_system, {
        galaxy_index: Number(data.galaxy || galaxyIndex),
        system_index: Number(data.system || 0),
      }));
      nextStars = mergeBySystem(currentStars, [single], galaxyIndex);
    } else {
      nextStars = [];
    }

    const reportedSystemMax = Number(data.system_max || 0);
    return {
      stars: nextStars,
      reportedSystemMax,
    };
  }

  const api = {
    configureGalaxyStarNetworkFlowRuntime,
    fetchAdaptedGalaxyStars,
    mergeNetworkPayloadIntoStars,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarNetworkFlow = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();