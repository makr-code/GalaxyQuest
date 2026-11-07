import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpatialLabelRenderer } from '../../js/rendering/spatial-label-renderer.js';
import { formatSpatialCombatStatus, normalizeSpatialCombatStatus } from '../../js/rendering/spatial-label-layout.js';

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

  it('renders only authoritative combat metrics as visible bars and accessible status text', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setMode('dom');
    const metrics = normalizeSpatialCombatStatus({
      shield: { current: 75, maximum: 100 },
      armor: { current: 0, maximum: 50 },
      hull: { current: 20, maximum: 40 },
      energy: { current: 99, maximum: 100 },
    });
    expect(metrics.map(({ key, percent }) => [key, percent])).toEqual([
      ['shield', 75], ['armor', 0], ['hull', 50],
    ]);
    expect(normalizeSpatialCombatStatus({ shield: { current: 4, maximum: 0 } })).toEqual([]);
    expect(formatSpatialCombatStatus(metrics)).toBe('Schild 75 % (75/100) · Panzerung 0 % (0/50) · Hülle 50 % (20/40)');

    renderer.render(null, null, [{
      id: 'facility:1', kind: 'facility', text: 'Relay', metrics,
      x: 400, y: 300, width: 220, height: 76, fontSize: 18, detailFontSize: 12,
    }], { width: 800, height: 600 });
    const badge = host.querySelector('.gq-spatial-label');
    expect(badge.getAttribute('aria-label')).toBe(
      'Relay: Schild 75 Prozent (75/100), Panzerung 0 Prozent (0/50), Hülle 50 Prozent (20/40)',
    );
    expect(badge.querySelectorAll('.gq-spatial-label-metric')).toHaveLength(3);
    expect(badge.querySelector('[data-metric="shield"] .gq-spatial-label-meter-fill').style.width).toBe('75%');
    expect(badge.querySelector('[data-metric="armor"] .gq-spatial-label-meter-fill').style.width).toBe('0%');
  });

  it('draws the same named status meters into the WebGPU label atlas', () => {
    const fillRect = vi.fn();
    renderer = new SpatialLabelRenderer();
    renderer.atlasContext = {
      clearRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
      measureText: (text) => ({ width: String(text).length * 5 }), fillText: vi.fn(), fillRect,
    };
    const metrics = normalizeSpatialCombatStatus({ shield: { current: 4, maximum: 5 } });
    renderer._updateAtlas([{ id: 'station:1', kind: 'object', text: 'Station', metrics, width: 180, height: 48 }]);
    expect(fillRect).toHaveBeenCalledTimes(2);
    expect(fillRect.mock.calls[0][2]).toBeGreaterThan(0);
    expect(fillRect.mock.calls[1][2]).toBeCloseTo(fillRect.mock.calls[0][2] * 0.8);
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
  it('supports keyboard approach and Escape without repeating actions or blocking native Enter selection', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    const onDoubleActivate = vi.fn();
    const onActivate = vi.fn();
    const parentKeydown = vi.fn();
    host.addEventListener('keydown', parentKeydown);
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setCallbacks({ onDoubleActivate, onActivate });
    renderer.setMode('dom');
    const label = { id: 'planet:3', kind: 'planet', text: 'Home', x: 400, y: 300, width: 120, height: 30 };
    renderer.render(null, null, [label], { width: 800, height: 600 });
    const badge = host.querySelector('button');
    badge.focus();
    const key = (name, extra = {}) => {
      const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
      badge.dispatchEvent(event);
      return event;
    };
    expect(badge.getAttribute('aria-keyshortcuts')).toBe('Shift+Enter Escape');
    expect(key('Enter').defaultPrevented).toBe(false);
    expect(onDoubleActivate).not.toHaveBeenCalled();
    parentKeydown.mockClear();
    expect(key('Enter', { shiftKey: true }).defaultPrevented).toBe(true);
    key('Enter', { shiftKey: true, repeat: true });
    expect(onDoubleActivate).toHaveBeenCalledExactlyOnceWith(label, expect.any(KeyboardEvent));
    expect(onActivate).not.toHaveBeenCalled();
    expect(parentKeydown).not.toHaveBeenCalled();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(canvas);
    expect(parentKeydown).not.toHaveBeenCalled();
  });
  it('combines pointer and keyboard hover and clears markers on removal, mode switch and disposal', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    const onHover = vi.fn();
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setCallbacks({ onHover });
    renderer.setMode('dom');
    const label = { id: 'planet:3', kind: 'planet', text: 'Home', x: 400, y: 300, width: 120, height: 30 };
    const size = { width: 800, height: 600 };
    renderer.render(null, null, [label], size);
    const badge = host.querySelector('button');
    badge.focus();
    expect(onHover).toHaveBeenCalledExactlyOnceWith(label);
    badge.dispatchEvent(new Event('pointerenter'));
    badge.dispatchEvent(new Event('pointerleave'));
    expect(onHover).toHaveBeenCalledTimes(1);
    canvas.focus();
    expect(onHover).toHaveBeenLastCalledWith(null);
    badge.dispatchEvent(new Event('pointerenter'));
    renderer.render(null, null, [], size);
    expect(onHover).toHaveBeenLastCalledWith(null);
    renderer.render(null, null, [label], size);
    host.querySelector('button').focus();
    expect(onHover).toHaveBeenLastCalledWith(label);
    renderer.setMode('webgpu');
    expect(onHover).toHaveBeenLastCalledWith(null);
    renderer.setMode('dom');
    host.querySelector('button').focus();
    expect(onHover).toHaveBeenLastCalledWith(label);
    renderer.dispose();
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(canvas);
  });
  it('forwards badge wheel events with current label data without scrolling the surrounding UI', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    const parentWheel = vi.fn();
    host.addEventListener('wheel', parentWheel);
    const onWheel = vi.fn();
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setMode('dom');
    const label = { id: 'planet:3', kind: 'planet', text: 'Home', x: 400, y: 300, width: 120, height: 30 };
    const size = { width: 800, height: 600 };
    renderer.render(null, null, [label], size);
    const badge = host.querySelector('button');
    const unhandled = new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true });
    badge.dispatchEvent(unhandled);
    expect(unhandled.defaultPrevented).toBe(false);
    expect(parentWheel).toHaveBeenCalledOnce();
    parentWheel.mockClear();
    renderer.setCallbacks({ onWheel });
    const updated = { ...label, data: { position: 3, inhabited: true } };
    renderer.render(null, null, [updated], size);
    const event = new WheelEvent('wheel', {
      deltaY: -3, deltaMode: 1, clientX: 410, clientY: 310, bubbles: true, cancelable: true,
    });
    badge.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(parentWheel).not.toHaveBeenCalled();
    expect(onWheel).toHaveBeenCalledExactlyOnceWith(updated, event);
    renderer.dispose();
    badge.dispatchEvent(event);
    expect(onWheel).toHaveBeenCalledTimes(1);
  });
  it('updates planet selection from layout data without inferring it from clicks or moving focus', () => {
    const host = document.createElement('div');
    const canvas = document.createElement('canvas');
    host.append(canvas);
    document.body.append(host);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    renderer = new SpatialLabelRenderer({ canvas });
    renderer.setMode('dom');
    const label = { id: 'planet:3', kind: 'planet', text: 'Home', x: 400, y: 300, width: 120, height: 30 };
    const size = { width: 800, height: 600 };
    renderer.render(null, null, [label], size);
    const badge = host.querySelector('button');
    expect(badge.getAttribute('aria-pressed')).toBe('false');
    badge.focus();
    badge.click();
    expect(badge.getAttribute('aria-pressed')).toBe('false');
    renderer.render(null, null, [{ ...label, selected: true }], size);
    expect(badge.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(badge);
    renderer.render(null, null, [label], size);
    expect(badge.getAttribute('aria-pressed')).toBe('false');
    renderer.render(null, null, [{ ...label, kind: 'system', selected: true }], size);
    expect(badge.hasAttribute('aria-pressed')).toBe(false);
  });
});
