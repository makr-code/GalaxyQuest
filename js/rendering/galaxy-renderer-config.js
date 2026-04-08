/*
 * Galaxy Renderer Config
 * Centralizes defaults and runtime tuning for Galaxy3DRenderer.
 */
(function () {
  const OPTION_DEFAULTS = {
    onHover: null,
    onClick: null,
    onDoubleClick: null,
    interactive: true,
    qualityProfile: 'auto',
  };

  const RUNTIME_TUNING = {
    zoomThresholds: {
      galaxyEnterSystem: 145,
      galaxyResetSystem: 210,
      systemEnterPlanet: 50,
      systemResetPlanet: 86,
      planetExitToSystem: 108,
      planetResetExit: 66,
      systemExitToGalaxy: 330,
      systemResetExit: 230,
    },
    focusDamping: {
      galaxy: 1.65,
      system: 2.1,
      planet: 2.65,
    },
  };

  const QUALITY_PROFILES = {
    low: {
      label: 'Low',
      renderer: {
        antialias: false,
        maxPixelRatio: 1,
      },
      textures: {
        planetTextureSize: 128,
        planetMaxEntries: 48,
        proceduralMaxEntries: 48,
      },
      geometry: {
        vesselMaxEntries: 48,
        instancingUseThreshold: 3,
      },
      features: {
        dynamicClusterLod: true,
        galacticCoreFx: false,
        postEffects: false,
      },
      clusterDensityMode: 'max',
    },
    medium: {
      label: 'Medium',
      renderer: {
        antialias: true,
        maxPixelRatio: 1.25,
      },
      textures: {
        planetTextureSize: 192,
        planetMaxEntries: 96,
        proceduralMaxEntries: 96,
      },
      geometry: {
        vesselMaxEntries: 72,
        instancingUseThreshold: 4,
      },
      features: {
        dynamicClusterLod: true,
        galacticCoreFx: true,
        postEffects: false,
      },
      clusterDensityMode: 'max',
    },
    high: {
      label: 'High',
      renderer: {
        antialias: true,
        maxPixelRatio: 1.5,
      },
      textures: {
        planetTextureSize: 256,
        planetMaxEntries: 128,
        proceduralMaxEntries: 128,
      },
      geometry: {
        vesselMaxEntries: 96,
        instancingUseThreshold: 4,
      },
      features: {
        dynamicClusterLod: true,
        galacticCoreFx: true,
        postEffects: false,
      },
      clusterDensityMode: 'max',
    },
    ultra: {
      label: 'Ultra',
      renderer: {
        antialias: true,
        maxPixelRatio: 2,
      },
      textures: {
        planetTextureSize: 256,
        planetMaxEntries: 128,
        proceduralMaxEntries: 128,
      },
      geometry: {
        vesselMaxEntries: 96,
        instancingUseThreshold: 4,
      },
      features: {
        dynamicClusterLod: true,
        galacticCoreFx: true,
        postEffects: true,
      },
      clusterDensityMode: 'max',
    },
  };

  function cloneProfile(name, reason = '') {
    const base = QUALITY_PROFILES[name] || QUALITY_PROFILES.medium;
    return {
      name,
      label: String(base.label || name),
      reason: String(reason || ''),
      renderer: Object.assign({}, base.renderer),
      textures: Object.assign({}, base.textures),
      geometry: Object.assign({}, base.geometry),
      features: Object.assign({}, base.features),
      clusterDensityMode: String(base.clusterDensityMode || 'auto'),
    };
  }

  function normalizeProfileName(name) {
    const normalized = String(name || 'auto').toLowerCase();
    if (normalized === 'auto') return 'auto';
    return QUALITY_PROFILES[normalized] ? normalized : 'medium';
  }

  function detectQualityProfile() {
    try {
      const nav = navigator || {};
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
      const cores = Number(nav.hardwareConcurrency || 0);
      const mem = Number(nav.deviceMemory || 0);
      const saveData = !!conn.saveData;
      const effectiveType = String(conn.effectiveType || '').toLowerCase();
      const weakNetwork = effectiveType === 'slow-2g' || effectiveType === '2g';

      if (saveData || weakNetwork || (cores > 0 && cores <= 4) || (mem > 0 && mem <= 4)) {
        return cloneProfile(
          'low',
          `Auto: constrained device/network (cores=${cores || 'n/a'}, mem=${mem || 'n/a'}GB, net=${effectiveType || 'unknown'}, saveData=${saveData ? 'on' : 'off'})`
        );
      }
      if ((cores >= 12) || (mem >= 16)) {
        return cloneProfile('ultra', `Auto: high-end device (cores=${cores || 'n/a'}, mem=${mem || 'n/a'}GB)`);
      }
      if ((cores >= 8) || (mem >= 8)) {
        return cloneProfile('high', `Auto: strong device (cores=${cores || 'n/a'}, mem=${mem || 'n/a'}GB)`);
      }
      return cloneProfile('medium', `Auto: balanced device (cores=${cores || 'n/a'}, mem=${mem || 'n/a'}GB)`);
    } catch (_) {
      return cloneProfile('medium', 'Auto: fallback (device capabilities unavailable).');
    }
  }

  function resolveQualityProfile(opts = {}) {
    const requested = normalizeProfileName(opts.requestedProfile);
    if (requested !== 'auto') {
      return cloneProfile(requested, `Manual: ${requested}`);
    }
    return detectQualityProfile();
  }

  function getOptionDefaults() {
    return Object.assign({}, OPTION_DEFAULTS);
  }

  function getRuntimeTuning() {
    return {
      zoomThresholds: Object.assign({}, RUNTIME_TUNING.zoomThresholds),
      focusDamping: Object.assign({}, RUNTIME_TUNING.focusDamping),
    };
  }

  function applyControlTuning(controls) {
    if (!controls || typeof controls !== 'object') return;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 40;
    controls.maxDistance = 2400;
  }

  window.GQGalaxyRendererConfig = {
    getOptionDefaults,
    getRuntimeTuning,
    applyControlTuning,
    resolveQualityProfile,
    detectQualityProfile,
  };
})();
