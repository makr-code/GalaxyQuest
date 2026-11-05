import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpatialLabelRenderer } from '../../js/rendering/spatial-label-renderer.js';

describe('Spatial label rendering modes', () => {
  let renderer;
  afterEach(() => {
    renderer?.dispose();
    renderer = null;
    document.body.replaceChildren();
  });

  it('creates accessible, safe, interactive DOM badges and switches back to WebGPU', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
    const onActivate = vi.fn();
    const onDoubleActivate = vi.fn();
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setCallbacks({ onActivate, onDoubleActivate });

    expect(renderer.setMode('dom')).toBe(true);
    renderer.render(null, null, [{
      id: 'system:1:10', kind: 'system', text: '<img src=x>', detail: 'G2 | 5,800 K',
      x: 400, y: 300, width: 200, height: 48, fontSize: 20, detailFontSize: 12, data: { system_index: 10 },
    }], { width: 1600, height: 1200 });

    const overlay = host.querySelector('.gq-spatial-label-overlay');
    const badge = overlay.querySelector('button');
    expect(overlay.hidden).toBe(false);
    expect(badge.getAttribute('aria-label')).toBe('<img src=x>: G2 | 5,800 K');
    expect(badge.querySelector('img')).toBeNull();
    expect(badge.querySelector('.gq-spatial-label-title').textContent).toBe('<img src=x>');
    expect(badge.style.left).toBe('200px');
    expect(badge.style.top).toBe('150px');
    badge.click();
    badge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'system:1:10' }), expect.anything());
    expect(onDoubleActivate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'system:1:10' }), expect.anything());

    renderer.render(null, null, [], { width: 1600, height: 1200 });
    expect(overlay.hidden).toBe(true);
    expect(overlay.children).toHaveLength(0);
    expect(renderer.setMode('webgpu')).toBe(true);
    expect(overlay.hidden).toBe(true);
    expect(renderer.setMode('invalid')).toBe(false);
    expect(renderer.mode).toBe('webgpu');
  });

  it('removes its overlay on disposal and tolerates a canvas without a parent', () => {
    renderer = new SpatialLabelRenderer();
    expect(renderer.attachCanvas(document.createElement('canvas'))).toBe(false);
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    renderer.attachCanvas(canvas);
    expect(host.querySelector('.gq-spatial-label-overlay')).not.toBeNull();
    renderer.dispose();
    renderer = null;
    expect(host.querySelector('.gq-spatial-label-overlay')).toBeNull();
  });
  it('preserves badge focus across updates and returns it to the canvas when a badge disappears', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setMode('dom');
    const label = { id: 'planet:3', kind: 'planet', text: 'Home', x: 400, y: 300, width: 120, height: 30 };
    const size = { width: 800, height: 600 };
    renderer.render(null, null, [label], size);
    const badge = host.querySelector('button');
    badge.focus();
    renderer.render(null, null, [{ ...label, text: 'Updated home' }], size);
    expect(document.activeElement).toBe(badge);
    renderer.render(null, null, [], size);
    expect(document.activeElement).toBe(canvas);
  });
  it('returns keyboard focus when switching away from DOM badges without stealing outside focus', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    const toggle = document.createElement('button');
    host.append(canvas, toggle);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setMode('dom');
    renderer.render(null, null, [{
      id: 'system:1:10', kind: 'system', text: 'Home', x: 400, y: 300, width: 120, height: 30,
    }], { width: 800, height: 600 });
    host.querySelector('.gq-spatial-label').focus();
    renderer.setMode('webgpu');
    expect(document.activeElement).toBe(canvas);
    toggle.focus();
    renderer.setMode('dom');
    renderer.setMode('webgpu');
    expect(document.activeElement).toBe(toggle);
  });
});
