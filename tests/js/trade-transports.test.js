import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createTradeTransports, transportVessel } from '../../js/engine/runtime/trade-transports.js';
import { createSpaceEntity } from '../../js/rendering/space-entity.js';
import { SpaceVesselRenderPass } from '../../js/rendering/space-vessel-render-pass.js';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';

const route = { route_id: 1, fleet_id: 2, source_colony_id: 3, target_colony_id: 4,
  phase: 'outbound', good_type: 'metal', quantity: 5, departure_unix: 100, arrival_unix: 200,
  origin: [10, 20, 30], target: [30, 40, 50] };

describe('physical trade transport', () => {
  it('animates the real transport entity on server time, clamped to its endpoints', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(50_000);
    try {
      const descriptor = transportVessel(route, 0);
      const vessel = createSpaceEntity(descriptor, descriptor.route.map((p) => new Vector3(...p)), new PerspectiveCamera());
      const pass = new SpaceVesselRenderPass();
      expect(vessel.modelUrl).toBe('procedural:transport');
      expect(await pass.load(vessel)).toBeTruthy();
      expect(pass.resources.get(vessel.id).asset.vertexCount).toBeGreaterThan(0);
      expect(vessel.position.toArray()).toEqual([10, 20, 30]);
      now.mockReturnValue(150_000);
      vessel.update(0);
      expect(vessel.position.toArray()).toEqual([20, 30, 40]);
      now.mockReturnValue(210_000);
      vessel.update(0);
      expect(vessel.position.toArray()).toEqual([30, 40, 50]);
      pass.remove(vessel.id);
      expect(pass.resources.size).toBe(0);
      pass.dispose();
    } finally { now.mockRestore(); }
  });

  it('discards stale responses and clears subscribers on shutdown', async () => {
    const pending = [];
    const api = { get: vi.fn(() => new Promise((resolve) => pending.push(resolve))) };
    const session = { events: { on: () => () => {}, emit: vi.fn() } };
    const domain = createTradeTransports({ api, session });
    const listener = vi.fn();
    domain.subscribe(listener);
    const first = domain.refresh();
    const second = domain.refresh();
    pending[1]({ success: true, now_unix: 150, transports: [] });
    await second;
    pending[0]({ success: true, now_unix: 150, transports: [route] });
    await first;
    expect(domain.getState().transports).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    const third = domain.refresh();
    domain.shutdown();
    pending[2]({ success: true, now_unix: 150, transports: [route] });
    await third;
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed or duplicate route identities without publishing them', async () => {
    const data = { success: true, now_unix: 150, transports: [{ ...route, route_id: true }] };
    const api = { get: vi.fn(async () => data) };
    const session = { events: { on: () => () => {}, emit: vi.fn() } };
    const domain = createTradeTransports({ api, session });
    expect(await domain.refresh()).toBe(false);
    data.transports = [route, { ...route, fleet_id: 3 }];
    expect(await domain.refresh()).toBe(false);
    expect(domain.getState().transports).toEqual([]);
    expect(session.events.emit).toHaveBeenCalledTimes(2);
    domain.shutdown();
  });

  it('accepts empty return flights and animates the reversed server route', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(150_000);
    try {
      const returning = { ...route, phase: 'return', good_type: null, quantity: 0,
        origin: route.target, target: route.origin };
      const api = { get: vi.fn(async () => ({ success: true, now_unix: 150, transports: [returning] })) };
      const session = { events: { on: () => () => {}, emit: vi.fn() } };
      const domain = createTradeTransports({ api, session });
      expect(await domain.refresh()).toBe(true);
      const descriptor = transportVessel(returning, domain.getState().offset);
      const vessel = createSpaceEntity(descriptor, descriptor.route.map((p) => new Vector3(...p)), new PerspectiveCamera());
      expect(vessel.position.toArray()).toEqual([20, 30, 40]);
      expect(descriptor.display_name).toContain('Rückflug');
      now.mockReturnValue(210_000);
      vessel.update(0);
      expect(vessel.position.toArray()).toEqual(route.origin);
      domain.shutdown();
    } finally { now.mockRestore(); }
  });

  it('adds and removes a non-controllable transport in the shared flight scene', async () => {
    const scene = new PerspectiveSpaceFlight({ labelRenderer: null });
    const descriptor = transportVessel(route, 0);
    await scene.setGalaxyFleets([descriptor]);
    expect(scene.spaceEntities.has('trade-transport:2')).toBe(true);
    expect(scene.vesselRenderPass.resources.has('trade-transport:2')).toBe(true);
    expect(descriptor).not.toHaveProperty('mission');
    const vessel = scene.spaceEntities.get('trade-transport:2');
    scene.origin.set(20, 30, 40);
    scene.camera.position.set(10000, 0, 0);
    scene._updateSpaceEntities(0);
    expect(vessel.scale).toBe(18);
    scene.camera.position.copy(vessel.position).sub(scene.origin);
    scene._updateSpaceEntities(0);
    expect(vessel.scale).toBe(1e-12);
    await scene.setGalaxyFleets([]);
    expect(scene.spaceEntities.size).toBe(0);
    expect(scene.vesselRenderPass.resources.size).toBe(0);
    scene.dispose();
  });
});
