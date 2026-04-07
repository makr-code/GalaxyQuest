(function (global) {
  'use strict';

  function createGalaxyClusterRangeControls(options = {}) {
    const getGalaxySystemMax = typeof options.getGalaxySystemMax === 'function'
      ? options.getGalaxySystemMax
      : () => 0;
    const setActiveRange = typeof options.setActiveRange === 'function'
      ? options.setActiveRange
      : function () {};
    const showToast = typeof options.showToast === 'function'
      ? options.showToast
      : function () {};

    function applyClusterRangeToControls(root, clusterPayload, opts = {}) {
      if (!root || !clusterPayload || clusterPayload.__kind !== 'cluster') return null;

      const systems = Array.isArray(clusterPayload.__clusterSystems)
        ? clusterPayload.__clusterSystems
          .map((n) => Number(n || 0))
          .filter((n) => Number.isFinite(n) && n > 0)
        : [];

      const rawFrom = systems.length ? Math.min(...systems) : Number(clusterPayload.from || 0);
      const rawTo = systems.length ? Math.max(...systems) : Number(clusterPayload.to || rawFrom || 0);
      if (!Number.isFinite(rawFrom) || rawFrom <= 0) return null;

      const galaxySystemMax = Math.max(1, Number(getGalaxySystemMax() || 1));
      const from = Math.max(1, Math.min(galaxySystemMax, Math.floor(rawFrom)));
      const to = Math.max(from, Math.min(galaxySystemMax, Math.floor(rawTo || rawFrom)));

      const fromInput = root.querySelector('#gal-from');
      const toInput = root.querySelector('#gal-to');
      if (fromInput) fromInput.value = String(from);
      if (toInput) toInput.value = String(to);
      setActiveRange({ from, to });

      if (opts.toast !== false) {
        const label = String(clusterPayload.label || clusterPayload.name || ('Cluster ' + String(Number(clusterPayload.__clusterIndex || 0) + 1)));
        showToast('Cluster-Range gesetzt: ' + label + ' (' + String(from) + '-' + String(to) + ')', 'info');
      }

      return { from, to };
    }

    return {
      applyClusterRangeToControls,
    };
  }

  global.GQRuntimeGalaxyClusterRangeControls = {
    createGalaxyClusterRangeControls,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.GQRuntimeGalaxyClusterRangeControls;
  }
})(typeof window !== 'undefined' ? window : globalThis);
