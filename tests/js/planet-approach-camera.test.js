import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SeamlessZoomOrchestrator, ZOOM_LEVEL } =
  require('../../js/engine/zoom/SeamlessZoomOrchestrator.js');

describe('settled planet approach camera', () => {
  let orchestrator;
  let level;

  beforeEach(() => {
    level = {
      initialize: vi.fn().mockResolvedValue(),
      enter: vi.fn().mockResolvedValue(),
      exit: vi.fn().mockResolvedValue(),
      render: vi.fn(),
      dispose: vi.fn(),
    };
    orchestrator = new SeamlessZoomOrchestrator(document.createElement('canvas'));
    orchestrator.register(ZOOM_LEVEL.PLANET_APPROACH, { threejs: class { constructor() { return level; } } });
    orchestrator.register(ZOOM_LEVEL.GALAXY, { threejs: class { constructor() { return level; } } });
    orchestrator._flight.flyTo = vi.fn().mockResolvedValue();
    orchestrator._flight.tick = vi.fn(() => null);
  });

  it('keeps the approach endpoint after the flight ends instead of returning to galaxy distance', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {});
    orchestrator.tick(0.016);
    expect(level.render).toHaveBeenLastCalledWith(0.016, {
      position: { x: 0, y: 0, z: 15 },
      target: { x: 0, y: 0, z: 0 },
      roll: 0, t: 1,
    });
  });

  it('copies a custom endpoint and does not expose mutable camera state to renderers', async () => {
    const cameraTo = { x: 4, y: 3, z: 18 };
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { cameraTo });
    cameraTo.z = 999;
    orchestrator.tick(0.016);
    const state = level.render.mock.lastCall[1];
    expect(state.position).toEqual({ x: 4, y: 3, z: 18 });
    state.position.x = 999;
    state.target.z = 999;
    orchestrator.tick(0.016);
    expect(level.render.mock.lastCall[1].position).toEqual({ x: 4, y: 3, z: 18 });
    expect(level.render.mock.lastCall[1].target).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('keeps interpolated flight cameras authoritative while a flight is active', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {});
    const state = { position: { x: 0, y: 0, z: 30 }, target: { x: 0, y: 0, z: 0 }, t: 0.5 };
    orchestrator._flight.tick.mockReturnValue(state);
    orchestrator.tick(0.016);
    expect(level.render.mock.lastCall[1]).toBe(state);
  });

  it('uses a finite default for an invalid endpoint', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {}, { cameraTo: { x: NaN, y: 0, z: Infinity } });
    expect(orchestrator._getFallbackCameraState().position).toEqual({ x: 0, y: 0, z: 15 });
  });

  it('does not change the fallback camera of other levels', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {});
    await orchestrator.zoomTo(ZOOM_LEVEL.GALAXY, {});
    orchestrator.tick(0.016);
    expect(level.render.mock.lastCall[1].position.z).toBe(500);
    expect(orchestrator._planetCameraState).toBeNull();
  });

  it('clears the settled camera when disposed', async () => {
    await orchestrator.zoomTo(ZOOM_LEVEL.PLANET_APPROACH, {});
    orchestrator.dispose();
    expect(orchestrator._planetCameraState).toBeNull();
  });
});
