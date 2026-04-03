/**
 * RuntimeGalaxyStarBootstrapPreflight.js
 *
 * Encapsulates bootstrap/preflight phase for galaxy star loading.
 */

'use strict';

(function () {
  const state = {
    apiGalaxyBootstrap: null,
  };

  function configureGalaxyStarBootstrapPreflightRuntime(opts = {}) {
    state.apiGalaxyBootstrap = typeof opts.apiGalaxyBootstrap === 'function' ? opts.apiGalaxyBootstrap : null;
  }

  async function runBootstrapPreflight(opts = {}) {
    const root = opts.root || null;
    const details = opts.details || null;
    const galaxyIndex = Number(opts.galaxyIndex || 0);
    const fromSystem = Number(opts.fromSystem || 0);
    let toSystem = Number(opts.toSystem || 0);
    let requestMaxPoints = Number(opts.requestMaxPoints || 0);
    let galaxySystemMax = Number(opts.galaxySystemMax || 0);
    let assetsManifestVersion = Number(opts.assetsManifestVersion || 0);
    const expectedAssetsManifestVersion = Number(opts.expectedAssetsManifestVersion || 1);
    const renderDataAdapter = opts.renderDataAdapter || null;

    if (typeof state.apiGalaxyBootstrap !== 'function') {
      return {
        toSystem,
        requestMaxPoints,
        galaxySystemMax,
        assetsManifestVersion,
        rangeChanged: false,
      };
    }

    let rangeChanged = false;
    try {
      const bootstrapRaw = await state.apiGalaxyBootstrap(galaxyIndex, fromSystem, toSystem, requestMaxPoints);
      const bootstrapRes = (typeof renderDataAdapter?.adaptGalaxyBootstrap === 'function')
        ? renderDataAdapter.adaptGalaxyBootstrap(bootstrapRaw, {
            galaxy: galaxyIndex,
            from: fromSystem,
            to: toSystem,
            maxPoints: requestMaxPoints,
          })
        : { ok: true, data: bootstrapRaw };

      if (bootstrapRes?.ok && bootstrapRes.data) {
        const bootstrap = bootstrapRes.data;
        const reportedSystemMax = Number(bootstrap.system_max || 0);
        if (reportedSystemMax > 0) {
          galaxySystemMax = Math.max(galaxySystemMax, reportedSystemMax);
        }

        const init = bootstrap.initial_range || {};
        const recommendedTo = Math.max(fromSystem, Number(init.to || toSystem));
        if (toSystem <= fromSystem && recommendedTo > toSystem) {
          toSystem = recommendedTo;
          rangeChanged = true;
          const toInput = root?.querySelector?.('#gal-to');
          if (toInput) {
            toInput.value = String(toSystem);
          }
        }

        requestMaxPoints = Math.max(100, Math.min(50000, Number(init.max_points || requestMaxPoints)));
        const bootstrapAssetsManifestVersion = Number(bootstrap.assets_manifest_version || 0);
        if (bootstrapAssetsManifestVersion > 0) {
          assetsManifestVersion = bootstrapAssetsManifestVersion;
        }

        if (bootstrap.assets_manifest_ok === false) {
          console.warn('[GQ] loadGalaxyStars3D: assets manifest mismatch', {
            expected: expectedAssetsManifestVersion,
            received: bootstrapAssetsManifestVersion,
          });
          if (details) {
            details.innerHTML = '<span class="text-yellow">Asset manifest mismatch; forcing fresh asset paths.</span>';
          }
        }

        if (bootstrap.stale && details) {
          details.innerHTML = '<span class="text-yellow">Bootstrap data is stale; refreshing live stars...</span>';
        }
      } else if (bootstrapRes?.errorType === 'schema') {
        const issueList = Array.isArray(bootstrapRes.issues) ? bootstrapRes.issues.join(', ') : 'invalid payload';
        console.warn('[GQ] loadGalaxyStars3D: bootstrap schema mismatch', issueList);
        const cls = (typeof renderDataAdapter?.classifyRenderError === 'function')
          ? renderDataAdapter.classifyRenderError(bootstrapRes)
          : { type: 'schema' };
        if (details && cls.type === 'schema') {
          details.innerHTML = '<span class="text-yellow">Bootstrap schema mismatch; using fallback stars endpoint.</span>';
        }
      }
    } catch (bootstrapErr) {
      console.warn('[GQ] loadGalaxyStars3D: bootstrap request failed', bootstrapErr);
      const cls = (typeof renderDataAdapter?.classifyRenderError === 'function')
        ? renderDataAdapter.classifyRenderError(bootstrapErr)
        : { type: 'network' };
      if (details && cls.type === 'auth') {
        details.innerHTML = '<span class="text-red">Session expired. Please log in again.</span>';
      }
    }

    return {
      toSystem,
      requestMaxPoints,
      galaxySystemMax,
      assetsManifestVersion,
      rangeChanged,
    };
  }

  const api = {
    configureGalaxyStarBootstrapPreflightRuntime,
    runBootstrapPreflight,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarBootstrapPreflight = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();