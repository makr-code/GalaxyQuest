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

  function createTextElement(documentRef, tagName, className, text) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    element.textContent = String(text);
    return element;
  }

  function createWidgetContent(documentRef, stats, mapper) {
    const content = documentRef.createElement('div');
    content.className = 'vfx-debug-widget-content';
    content.appendChild(createTextElement(documentRef, 'div', 'vfx-debug-header', 'Colony VFX Stats'));

    const statsSection = documentRef.createElement('div');
    statsSection.className = 'vfx-debug-section';
    [
      ['Backend:', formatBackendLabel(stats?.backend || '?')],
      ['Quality:', stats?.quality || 'auto'],
      ['Emitters:', stats?.emitters || 0],
      ['Particles:', stats?.particles || 0],
      ['Burst:', stats?.burstActive ? 'on' : 'off'],
    ].forEach(([label, value]) => {
      const line = documentRef.createElement('div');
      line.className = 'vfx-stat-line';
      line.appendChild(createTextElement(documentRef, 'strong', '', label));
      line.appendChild(documentRef.createTextNode(` ${String(value)}`));
      statsSection.appendChild(line);
    });
    content.appendChild(statsSection);

    const profileSection = documentRef.createElement('div');
    profileSection.className = 'vfx-debug-section';
    profileSection.appendChild(createTextElement(documentRef, 'div', 'vfx-debug-sublabel', 'Profiles'));
    const profiles = stats?.profileCounts || {};
    const profileEntries = Object.entries(profiles);
    if (profileEntries.length) {
      profileEntries.forEach(([name, count]) => {
        const line = documentRef.createElement('div');
        line.className = 'vfx-stat-line';
        line.appendChild(createTextElement(documentRef, 'span', 'vfx-profile-name', name));
        line.appendChild(documentRef.createTextNode(`: ${String(count)}`));
        profileSection.appendChild(line);
      });
    } else {
      profileSection.appendChild(createTextElement(documentRef, 'div', 'vfx-stat-line', '(none)'));
    }
    content.appendChild(profileSection);

    const mapperSlots = mapper?.stats?.mappedSlots || 0;
    if (mapperSlots > 0) {
      const mapperSection = documentRef.createElement('div');
      mapperSection.className = 'vfx-debug-section';
      mapperSection.appendChild(createTextElement(
        documentRef,
        'div',
        'vfx-debug-sublabel',
        `Mapper: ${mapperSlots} slots`,
      ));

      const mapperLines = documentRef.createElement('div');
      mapperLines.className = 'vfx-stat-line';
      mapperLines.style.fontSize = '0.85em';
      mapperLines.style.flexWrap = 'wrap';
      mapperLines.style.display = 'flex';
      mapperLines.style.gap = '4px';
      const mapperProfiles = Object.entries(mapper?.stats?.profileCounts || {});
      if (mapperProfiles.length) {
        mapperProfiles.forEach(([name, count]) => {
          mapperLines.appendChild(createTextElement(documentRef, 'span', 'vfx-mapper-tag', `${name}=${count}`));
        });
      } else {
        mapperLines.appendChild(documentRef.createTextNode('(none)'));
      }

      mapperSection.appendChild(mapperLines);
      content.appendChild(mapperSection);
    }

    return content;
  }

  function initColonyVfxDebugWidget(opts = {}) {
    const {
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
        widget.replaceChildren();
        widget.style.display = 'none';
        return;
      }

      const changed = JSON.stringify(stats) !== JSON.stringify(lastStats)
        || JSON.stringify(mapper) !== JSON.stringify(lastMapper);
      if (changed || !widget.firstChild) {
        widget.replaceChildren(createWidgetContent(documentRef, stats, mapper));
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