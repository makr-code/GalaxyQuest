/**
 * RuntimeGalaxyStarUiStatus.js
 *
 * Small UI status helpers for galaxy star loading flow.
 */

'use strict';

(function () {
  function setLoadingStatus(detailsEl) {
    if (!detailsEl) return;
    detailsEl.innerHTML = '<span class="text-muted">Loading star cloud...</span>';
  }

  function setCacheStatus(detailsEl, starCount, fullRangeInModel) {
    if (!detailsEl) return;
    detailsEl.innerHTML = `<span class="text-cyan">Cache: ${Number(starCount || 0)} stars loaded${fullRangeInModel ? ' (complete range)' : ''}. Syncing live data...</span>`;
  }

  function setPolicySkipStatus(detailsEl, fromSystem, toSystem) {
    if (!detailsEl) return;
    detailsEl.innerHTML = `<span class="text-cyan">Policy hit: fresh range from cache (${Number(fromSystem || 0)}-${Number(toSystem || 0)}), network refresh skipped.</span>`;
  }

  function setNetworkErrorStatus(detailsEl, type) {
    if (!detailsEl) return;
    const kind = String(type || 'network');
    if (kind === 'auth') {
      detailsEl.innerHTML = '<span class="text-red">Session expired. Please log in again.</span>';
    } else if (kind === 'schema') {
      detailsEl.innerHTML = '<span class="text-red">Could not load stars (schema mismatch).</span>';
    } else if (kind === 'stale') {
      detailsEl.innerHTML = '<span class="text-yellow">Star data is stale.</span>';
    } else {
      detailsEl.innerHTML = '<span class="text-red">Could not load stars (network).</span>';
    }
  }

  function setStaleStatus(detailsEl) {
    if (!detailsEl) return;
    detailsEl.innerHTML = '<span class="text-yellow">Loaded stale star data; resyncing...</span>';
  }

  function setLoadedStatus(detailsEl, starCount, fromSystem, toSystem, stride) {
    if (!detailsEl) return;
    detailsEl.innerHTML = `<span class="text-cyan">Loaded ${Number(starCount || 0)} stars from systems ${Number(fromSystem || 0)}..${Number(toSystem || 0)} (stride ${Number(stride || 0)}).</span>`;
  }

  function setRangeInputMax(root, systemMax) {
    if (!root) return;
    const toInput = root.querySelector('#gal-to');
    const fromInput = root.querySelector('#gal-from');
    const maxValue = String(Number(systemMax || 0));
    if (toInput) toInput.max = maxValue;
    if (fromInput) fromInput.max = maxValue;
  }

  const api = {
    setLoadingStatus,
    setCacheStatus,
    setPolicySkipStatus,
    setNetworkErrorStatus,
    setStaleStatus,
    setLoadedStatus,
    setRangeInputMax,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyStarUiStatus = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();