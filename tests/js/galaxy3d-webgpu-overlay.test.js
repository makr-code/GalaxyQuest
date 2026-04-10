import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const rendererPath = path.resolve(process.cwd(), 'js/rendering/Galaxy3DRendererWebGPU.js');

function loadRendererScript() {
  const src = fs.readFileSync(rendererPath, 'utf8');
  window.eval(src);
  return window.Galaxy3DRendererWebGPU;
}

class MockOverlayCanvas {
  constructor(width = 400, height = 240) {
    this.width = width;
    this.height = height;
    this.clientWidth = width;
    this.clientHeight = height;
  }
}

class MockOverlayContext {
  constructor() {
    this.calls = [];
  }

  clearRect(x, y, w, h) { this.calls.push({ type: 'clearRect', x, y, w, h }); }
  beginPath() { this.calls.push({ type: 'beginPath' }); }
  moveTo(x, y) { this.calls.push({ type: 'moveTo', x, y }); }
  lineTo(x, y) { this.calls.push({ type: 'lineTo', x, y }); }
  stroke() { this.calls.push({ type: 'stroke' }); }
  fill() { this.calls.push({ type: 'fill' }); }
  arc(x, y, r, a1, a2) { this.calls.push({ type: 'arc', x, y, r, a1, a2 }); }

  set strokeStyle(value) { this.calls.push({ type: 'strokeStyle', value }); }
  set lineWidth(value) { this.calls.push({ type: 'lineWidth', value }); }
  set fillStyle(value) { this.calls.push({ type: 'fillStyle', value }); }
}

describe('Galaxy3DRendererWebGPU trade route overlay', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.__GQ_TRADE_ROUTES_CACHE = undefined;
    window.Galaxy3DRendererWebGPU = undefined;
    window.GQGalaxy3DRendererWebGPU = undefined;
  });

  it('draws deduplicated active trade route lines from the merged runtime cache', () => {
    const Galaxy3DRendererWebGPU = loadRendererScript();
    const host = document.createElement('div');
    document.body.appendChild(host);

    const renderer = new Galaxy3DRendererWebGPU(host, {});
    const overlay = new MockOverlayCanvas(400, 240);
    const ctx = new MockOverlayContext();

    renderer._canvas = {
      clientWidth: 400,
      clientHeight: 240,
      getBoundingClientRect() {
        return { width: 400, height: 240 };
      },
    };
    renderer._overlayCanvas = overlay;
    renderer._overlayCtx = ctx;
    renderer._aspect = 1;
    renderer._starScale = 0.01;
    renderer._view = { panX: 0, panY: 0, zoom: 1 };
    renderer._rawStars = [
      { galaxy_index: 1, system_index: 101, x_ly: -60, y_ly: -20 },
      { galaxy_index: 1, system_index: 202, x_ly: 55, y_ly: 40 },
    ];

    window.__GQ_TRADE_ROUTES_CACHE = [
      {
        id: 'npc-1',
        origin: { galaxy: 1, system: 101 },
        target: { galaxy: 1, system: 202 },
        interval_hours: 12,
        is_active: true,
      },
      {
        id: 'npc-2',
        origin: { galaxy: 1, system: 202 },
        target: { galaxy: 1, system: 101 },
        interval_hours: 12,
        is_active: true,
      },
      {
        id: 'npc-3',
        origin: { galaxy: 1, system: 101 },
        target: { galaxy: 1, system: 202 },
        interval_hours: 6,
        is_active: false,
      },
    ];

    renderer._renderGalaxyOverlay2D();

    const moveCalls = ctx.calls.filter((call) => call.type === 'moveTo');
    const lineCalls = ctx.calls.filter((call) => call.type === 'lineTo');
    const strokeCalls = ctx.calls.filter((call) => call.type === 'stroke');
    const strokeStyles = ctx.calls.filter((call) => call.type === 'strokeStyle').map((call) => call.value);

    expect(moveCalls).toHaveLength(2);
    expect(lineCalls).toHaveLength(2);
    expect(strokeCalls).toHaveLength(2);
    expect(strokeStyles).toContain('rgba(255, 209, 102, 0.82)');
    expect(strokeStyles).toContain('rgba(255, 209, 102, 0.22)');
  });

  it('derives cluster overlay geometry from systems and renders colony heartbeat rings', () => {
    const Galaxy3DRendererWebGPU = loadRendererScript();
    const host = document.createElement('div');
    document.body.appendChild(host);

    const renderer = new Galaxy3DRendererWebGPU(host, {});
    const overlay = new MockOverlayCanvas(520, 320);
    const ctx = new MockOverlayContext();

    renderer._canvas = {
      clientWidth: 520,
      clientHeight: 320,
      getBoundingClientRect() {
        return { width: 520, height: 320 };
      },
    };
    renderer._overlayCanvas = overlay;
    renderer._overlayCtx = ctx;
    renderer._aspect = 1;
    renderer._starScale = 0.01;
    renderer._view = { panX: 0, panY: 0, zoom: 1 };
    renderer._rawStars = [
      { galaxy_index: 1, system_index: 11, x_ly: -80, y_ly: -20 },
      { galaxy_index: 1, system_index: 22, x_ly: 10, y_ly: 40 },
      { galaxy_index: 1, system_index: 33, x_ly: 80, y_ly: -30 },
    ];

    renderer.setClusterAuras([
      {
        id: 1,
        systems: [11, 22, 33],
        color_hex: '#66ccff',
      },
    ]);
    renderer.setEmpireHeartbeatSystems([22]);

    window.__GQ_TRADE_ROUTES_CACHE = [];
    renderer._renderGalaxyOverlay2D();

    const arcCalls = ctx.calls.filter((call) => call.type === 'arc');
    const strokeCalls = ctx.calls.filter((call) => call.type === 'stroke');
    const strokeStyles = ctx.calls.filter((call) => call.type === 'strokeStyle').map((call) => call.value);

    // At least one cluster circle + one heartbeat ring must be drawn.
    expect(arcCalls.length).toBeGreaterThanOrEqual(2);
    expect(strokeCalls.length).toBeGreaterThan(0);
    expect(strokeStyles).toContain('rgba(255, 208, 95, 0.92)');
  });
});