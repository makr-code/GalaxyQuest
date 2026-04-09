/**
 * RuntimeColonyVfxDebugWidget.js
 *
 * Colony surface VFX debug widget rendering and polling.
 */

'use strict';

(function () {
  function formatBackendLabel(rawBackend) {
    const value = String(rawBackend || '').toLowerCase();
    if (value === 'webgpu') return 'WebGPU';
    if (value === 'three-webgl' || value === 'engine-webgl' || value === 'threejs' || value === 'webgl2') {
      return 'WebGL Compatibility';
    }
    if (value === 'webgl1') return 'WebGL1 Compatibility';
    return String(rawBackend || '?');
  }

  function initColonyVfxDebugWidget(opts = {}) {
    const {
      esc = (value) => String(value || ''),
      documentRef = (typeof document !== 'undefined' ? document : null),
      windowRef = (typeof window !== 'undefined' ? window : null),
      logger = console,
    } = opts;

    let widget = null;
    let updateInterval = null;
    let lastStats = null;
    let lastMapper = null;

    const zoomLevel = windowRef?.GQSeamlessZoomOrchestrator?.ZOOM_LEVEL || { COLONY_SURFACE: 3 };
    const colonySurface = Number(zoomLevel.COLONY_SURFACE || 3);

    function createWidgetHtml(stats, mapper) {
      const backend = formatBackendLabel(stats?.backend || '?');
      const quality = stats?.quality || 'auto';
      const emitters = stats?.emitters || 0;
      const particles = stats?.particles || 0;
      const burstActive = stats?.burstActive ? 'on' : 'off';

      const profiles = stats?.profileCounts || {};
      const profileLines = Object.entries(profiles)
        .map(([name, count]) => `<div class="vfx-stat-line"><span class="vfx-profile-name">${esc(name)}</span>: ${count}</div>`)
        .join('');

      const mapperSlots = mapper?.stats?.mappedSlots || 0;
      const mapperCounts = mapper?.stats?.profileCounts || {};
      const mapperLines = Object.entries(mapperCounts)
        .map(([name, count]) => `<span class="vfx-mapper-tag">${esc(name)}=${count}</span>`)
        .join(' ');

      return `
        <div class="vfx-debug-widget-content">
          <div class="vfx-debug-header">Colony VFX Stats</div>
          <div class="vfx-debug-section">
            <div class="vfx-stat-line"><strong>Backend:</strong> ${esc(backend)}</div>
            <div class="vfx-stat-line"><strong>Quality:</strong> ${esc(quality)}</div>
            <div class="vfx-stat-line"><strong>Emitters:</strong> ${emitters}</div>
            <div class="vfx-stat-line"><strong>Particles:</strong> ${particles}</div>
            <div class="vfx-stat-line"><strong>Burst:</strong> ${burstActive}</div>
          </div>
          <div class="vfx-debug-section">
            <div class="vfx-debug-sublabel">Profiles</div>
            ${profileLines || '<div class="vfx-stat-line">(none)</div>'}
          </div>
          ${mapperSlots > 0 ? `
          <div class="vfx-debug-section">
            <div class="vfx-debug-sublabel">Mapper: ${mapperSlots} slots</div>
            <div class="vfx-stat-line" style="font-size:0.85em; flex-wrap:wrap; display:flex; gap:4px;">
              ${mapperLines || '(none)'}
            </div>
          </div>
          ` : ''}
        </div>
      `;
    }

    function updateWidget() {
      const stats = windowRef?.__GQ_COLONY_VFX_STATS;
      const mapper = windowRef?.__GQ_COLONY_VFX_MAPPER;
      const orchestrator = windowRef?.GQSeamlessZoomOrchestrator;
      const activeLevel = Number(orchestrator?.activeLevel || -1);
      const isColonyLevel = activeLevel === colonySurface;

      if (!widget) {
        widget = documentRef?.getElementById('colony-vfx-debug-widget');
        if (!widget) {
          const overlay = windowRef?.WM?.body?.('galaxy-info')?.querySelector?.('#galaxy-info-overlay')
            || documentRef?.getElementById('galaxy-info-overlay');
          if (!overlay) return;
          widget = documentRef.createElement('div');
          widget.id = 'colony-vfx-debug-widget';
          widget.className = 'colony-vfx-debug-widget';
          overlay.appendChild(widget);
        }
      }

      const hasStats = !!(stats && stats.particles > 0);
      const shouldShow = isColonyLevel && hasStats;

      if (!shouldShow) {
        widget.innerHTML = '';
        widget.style.display = 'none';
        return;
      }

      const changed = JSON.stringify(stats) !== JSON.stringify(lastStats)
        || JSON.stringify(mapper) !== JSON.stringify(lastMapper);
      if (changed || !widget.innerHTML) {
        widget.innerHTML = createWidgetHtml(stats, mapper);
        lastStats = stats;
        lastMapper = mapper;
      }

      widget.style.display = 'block';
    }

    function startUpdating() {
      if (updateInterval) clearInterval(updateInterval);
      updateInterval = setInterval(updateWidget, 150);
    }

    function stopUpdating() {
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }
    }

    setTimeout(startUpdating, 500);
    windowRef.__GQ_VFX_WIDGET_CONTROL = { startUpdating, stopUpdating, updateWidget };

    return { startUpdating, stopUpdating, updateWidget };
  }

  function safeInitColonyVfxDebugWidget(opts = {}) {
    try {
      return initColonyVfxDebugWidget(opts);
    } catch (err) {
      opts.logger?.warn?.('[GQ] VFX debug widget init failed (non-blocking)', err);
      return null;
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { initColonyVfxDebugWidget, safeInitColonyVfxDebugWidget };
  } else {
    window.GQRuntimeColonyVfxDebugWidget = { initColonyVfxDebugWidget, safeInitColonyVfxDebugWidget };
  }
})();