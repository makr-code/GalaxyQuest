// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

let widgetApi;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="galaxy-info-overlay"></div>';
  delete window.GQRuntimeColonyVfxDebugWidget;
  window.__GQ_COLONY_VFX_STATS = null;
  window.__GQ_COLONY_VFX_MAPPER = null;
  window.WM = null;
  window.GQSeamlessZoomOrchestrator = { activeLevel: 3, ZOOM_LEVEL: { COLONY_SURFACE: 3 } };
  window.eval(readFileSync(path.resolve('js/engine/runtime/RuntimeColonyVfxDebugWidget.js'), 'utf8'));
  widgetApi = window.GQRuntimeColonyVfxDebugWidget;
});

describe('RuntimeColonyVfxDebugWidget DOM rendering', () => {
  it('renders runtime stats and profile names as text nodes', () => {
    window.__GQ_COLONY_VFX_STATS = {
      backend: '<img src=x onerror=alert(1)>',
      quality: '<svg onload=alert(1)>',
      emitters: 4,
      particles: 12,
      burstActive: true,
      profileCounts: { '<iframe src=javascript:alert(1)>': 2 },
    };
    window.__GQ_COLONY_VFX_MAPPER = {
      stats: {
        mappedSlots: 1,
        profileCounts: { '"><img src=x onerror=alert(1)>': 3 },
      },
    };

    const instance = widgetApi.initColonyVfxDebugWidget({
      documentRef: document,
      windowRef: window,
      esc: (value) => String(value ?? ''),
    });
    instance.stopUpdating();
    instance.updateWidget();

    const widget = document.querySelector('#colony-vfx-debug-widget');
    expect(widget.querySelector('img, svg, iframe')).toBeNull();
    expect(widget.querySelector('.vfx-profile-name').textContent)
      .toBe('<iframe src=javascript:alert(1)>');
    expect(widget.querySelector('.vfx-mapper-tag').textContent)
      .toBe('"><img src=x onerror=alert(1)>=3');
    expect(widget.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(widget.textContent).toContain('<svg onload=alert(1)>');
    expect(widget.style.display).toBe('block');
  });

  it('clears and hides the widget when the colony surface is inactive', () => {
    window.__GQ_COLONY_VFX_STATS = { particles: 1 };
    const instance = widgetApi.initColonyVfxDebugWidget({ documentRef: document, windowRef: window });
    instance.stopUpdating();
    instance.updateWidget();

    const widget = document.querySelector('#colony-vfx-debug-widget');
    expect(widget.firstChild).not.toBeNull();

    window.GQSeamlessZoomOrchestrator.activeLevel = 2;
    instance.updateWidget();

    expect(widget.firstChild).toBeNull();
    expect(widget.style.display).toBe('none');
  });
});
