/**
 * RuntimeGalaxyStarUiStatus.js
 *
 * Small UI status helpers for galaxy star loading flow.
 */

'use strict';

(function () {
  function setStatus(detailsEl, className, message) {
    if (!detailsEl) return;
    const status = detailsEl.ownerDocument.createElement('span');
    status.className = className;
    status.textContent = message;
    detailsEl.replaceChildren(status);
  }

  function setLoadingStatus(detailsEl) {
    if (!detailsEl) return;
    setStatus(detailsEl, 'text-muted', 'Loading star cloud...');
  }

  function setCacheStatus(detailsEl, starCount, fullRangeInModel) {
    if (!detailsEl) return;
    setStatus(
      detailsEl,
      'text-cyan',
      `Cache: ${Number(starCount || 0)} stars loaded${fullRangeInModel ? ' (complete range)' : ''}. Syncing live data...`
    );
  }

  function setPolicySkipStatus(detailsEl, fromSystem, toSystem) {
    if (!detailsEl) return;
    setStatus(
      detailsEl,
      'text-cyan',
      `Policy hit: fresh range from cache (${Number(fromSystem || 0)}-${Number(toSystem || 0)}), network refresh skipped.`
    );
  }

  function setNetworkErrorStatus(detailsEl, type) {
    if (!detailsEl) return;
    const kind = String(type || 'network');
    if (kind === 'auth') {
      setStatus(detailsEl, 'text-red', 'Session expired. Please log in again.');
    } else if (kind === 'schema') {
      setStatus(detailsEl, 'text-red', 'Could not load stars (schema mismatch).');
    } else if (kind === 'stale') {
      setStatus(detailsEl, 'text-yellow', 'Star data is stale.');
    } else {
      setStatus(detailsEl, 'text-red', 'Could not load stars (network).');
    }
  }

  function setStaleStatus(detailsEl) {
    if (!detailsEl) return;
    setStatus(detailsEl, 'text-yellow', 'Loaded stale star data; resyncing...');
  }

  function setLoadedStatus(detailsEl, starCount, fromSystem, toSystem, stride) {
    if (!detailsEl) return;
    setStatus(
      detailsEl,
      'text-cyan',
      `Loaded ${Number(starCount || 0)} stars from systems ${Number(fromSystem || 0)}..${Number(toSystem || 0)} (stride ${Number(stride || 0)}).`
    );
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