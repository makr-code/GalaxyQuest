import { describe, expect, it } from 'vitest';

const model = require('../../js/rendering/colony-surface-plan.js');
const manifest = { body_id: 12, seed: 35, biome: 'terran', radius_km: 6371, amplitude_km: 8 };
const sites = ['primary', 'second', 'third'].map((id, index) => ({
  id, height: 1, slope: 0.01, direction: [Math.sin(index * 0.5), 0, Math.cos(index * 0.5)],
}));
const route = { id: 'regional-link', from: 'second', to: 'primary', activation: 1,
  points: [sites[1].direction, sites[0].direction] };
const scene = { colony: { population: 4000 }, buildings: [{ type: 'farm', level: 8 }] };
const network = { routes: [route], disconnected: [{ id: 'third', reason: 'no-land-route' }] };
const policy = { visible: true, motion: true };
const plan = (data = scene, geography = manifest, roads = network) => model.plan(data, geography, sites, roads);

describe('Selected settlement inspection read model', () => {
  it('describes both ends of a connection with a visual mix, not invented local gameplay totals', () => {
    const surface = plan();
    const original = structuredClone(surface);
    const primary = model.inspectSettlement(surface, 'primary', policy);
    expect(primary).toMatchObject({
      index: 0, specialization: 'Agriculture', weights: [1, 0, 0], activity: 1,
      cultivation: 'outdoor', routeStatus: 'available', transport: 'decorative',
      connections: [{ id: route.id, peerId: 'second', peerIndex: 1, ruined: false }],
    });
    expect(model.inspectSettlement(surface, 'second', policy).connections[0]).toMatchObject({ peerId: 'primary', peerIndex: 0 });
    for (const key of ['population', 'production', 'consumption', 'buildings', 'capacity']) expect(primary).not.toHaveProperty(key);
    primary.weights[0] = 0;
    expect(surface).toEqual(original);
  });

  it('distinguishes routing exclusions, absent links, and links received despite an omitted founding connection', () => {
    const surface = plan();
    expect(model.inspectSettlement(surface, 'third', policy)).toMatchObject({
      connections: [], routeStatus: 'no-land-route', transport: 'no-active-route',
    });
    const budget = plan(scene, manifest, { ...network, disconnected: [{ id: 'second', reason: 'segment-budget' }] });
    expect(model.inspectSettlement(budget, 'second', policy)).toMatchObject({
      routeStatus: 'segment-budget', transport: 'decorative',
    });
    const composite = plan(scene, manifest, { routes: [], disconnected: [], unsupported: true });
    expect(model.inspectSettlement(composite, 'primary', policy)).toMatchObject({
      routeStatus: 'unsupported', transport: 'unsupported',
    });
    expect(model.inspectSettlement(plan(scene, manifest, { routes: [], disconnected: [] }), 'primary', policy))
      .toMatchObject({ connections: [], routeStatus: 'available', transport: 'no-active-route' });
  });

  it('explains inactive transport without confusing visual policy and colony activity', () => {
    const surface = plan();
    expect(model.inspectSettlement(surface, 'second', { ...policy, motion: false }).transport).toBe('motion-disabled');
    expect(model.inspectSettlement(surface, 'second', { ...policy, visible: false }).transport).toBe('hidden');
    expect(model.inspectSettlement(plan({ ...scene, buildings: [] }), 'second', policy).transport).toBe('no-capacity');
    const inactive = plan({ ...scene, colony: { population: 4000, powered: false } });
    expect(model.inspectSettlement(inactive, 'second', policy)).toMatchObject({ activity: 0, transport: 'inactive' });
    const damaged = plan({ ...scene, colony: { population: 4000, activity: 0.8, damage: 0.5 } });
    expect(model.inspectSettlement(damaged, 'second', policy).activity).toBeCloseTo(0.4);
    expect(model.inspectSettlement(plan(scene, { ...manifest, biome: 'ice' }), 'second', policy).cultivation).toBe('protected');
  });

  it('retains abandoned connections but removes ruin activity and economic claims until recovery', () => {
    const history = { body_id: 12, version: 1, founded_count: 3, peak_population: 4000 };
    const declined = plan({ ...scene, colony: { population: 1000 }, body_development: history });
    expect(model.inspectSettlement(declined, 'second', policy)).toMatchObject({
      ruined: true, activity: 0, weights: [0, 0, 0], specialization: '',
      cultivation: 'none', transport: 'ruins', connections: [{ ruined: true }],
    });
    expect(model.inspectSettlement(declined, 'primary', policy).transport).toBe('no-active-route');
    const recovered = plan({ ...scene, body_development: history });
    expect(model.inspectSettlement(recovered, 'second', policy)).toEqual(model.inspectSettlement(plan(), 'second', policy));
    expect(() => model.inspectSettlement(recovered, 'missing', policy)).toThrow('unknown');
    expect(() => model.inspectSettlement(null, 'primary', policy)).toThrow('unknown');
  });
});
