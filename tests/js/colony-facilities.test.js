import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { buildReliefMesh } from '../../js/rendering/earth-reference-relief.js';
import { EARTH_FACILITY_BUILDINGS } from '../../js/rendering/earth-reference-settlements.js';

const require = createRequire(import.meta.url);
const model = require('../../js/rendering/colony-surface-plan.js');
const geometry = require('../../js/rendering/colony-facility-geometry.js');
const site = { id: 'test-primary', direction: [1, 0, 0], height: 0.1 };
const manifest = { body_id: 1, seed: 2026, biome: 'terran', radius_km: 6371.0088 };
const stock = level => EARTH_FACILITY_BUILDINGS.map(type => ({ type, level }));
const plan = (level, seed = 2026, outdoor = true, activity = 1) =>
  model.facilityPlan(stock(level), seed, site, manifest.radius_km, outdoor, activity);

describe('Seeded cosmetic facility classes', () => {
  it('covers all surface families and excludes habitats, open-pit mines and all orbital zones', () => {
    const facilities = plan(1);
    expect(facilities.map(f => f.kind)).toEqual(model.FACILITY_KINDS);
    expect(model.facilityLevels([{ type: 'research_lab', level: 999, meta: { zone: 'star_orbit' } },
      { type: 'solar_plant', level: 999, meta: { zone: 'orbital' } }]))
      .toEqual(Object.fromEntries(model.FACILITY_KINDS.map(kind => [kind, 0])));
    expect(model.facilityPlan(['habitat', 'metal_mine', 'crystal_mine', 'shipyard', 'missile_silo',
      'stargate', 'jump_inhibitor', 'relay_station', 'deep_space_radar'].map(type => ({ type, level: 9 })),
    2026, site, manifest.radius_km)).toEqual([]);
    expect(model.facilityLevels([{ type: 'new_recipe', level: 4, meta: { category: 'industry' } }]).industry).toBe(4);
    expect(() => model.facilityLevels([{ type: 'solar_plant', level: NaN }])).toThrow(/level/);
    expect(() => model.facilityPlan(stock(1), NaN, site, 6371)).toThrow(/geography/);
  });

  it('has distinct silhouettes and metre-scale parts for every class, with dark fields and panels', () => {
    const facilities = plan(1);
    const signatures = facilities.map(f => JSON.stringify(f.parts.map(p =>
      [p.shape, p.widthMeters, p.depthMeters, p.heightMeters, p.bottomMeters, p.color])));
    expect(new Set(signatures).size).toBe(16);
    for (const f of facilities) for (const p of f.parts) {
      expect(p.widthMeters).toBeGreaterThan(0);
      expect(p.depthMeters).toBeGreaterThan(0);
      expect(p.heightMeters).toBeGreaterThan(0);
      expect(p.heightMeters + p.bottomMeters).toBeLessThanOrEqual(50);
      expect(Math.abs(p.eastMeters) + p.widthMeters / 2).toBeLessThanOrEqual(f.widthMeters / 2);
      expect(Math.abs(p.northMeters) + p.depthMeters / 2).toBeLessThanOrEqual(f.depthMeters / 2);
      if (p.shape === 3 || p.shape === 4) expect(p.lamp).toBe(0);
    }
    expect(facilities.find(f => f.kind === 'tank').parts.some(p => p.shape === 1)).toBe(true);
    expect(facilities.find(f => f.kind === 'hydroponics').parts.some(p => p.shape === 2)).toBe(true);
    expect(plan(1, 2026, false).find(f => f.kind === 'agriculture').parts.some(p => p.shape === 4)).toBe(false);
  });

  it('adds stable modules, never scales or relocates existing components and stays within fixed budgets', () => {
    const young = plan(1), grown = plan(7);
    expect(plan(0)).toEqual([]);
    expect(plan(7)).toEqual(grown);
    expect(plan(16)).toEqual(grown.map(f => ({ ...f, level: 16 })));
    expect(plan(1, 2027)).not.toEqual(young);
    for (const f of young) {
      const mature = grown.find(other => other.id === f.id);
      expect(mature.direction).toEqual(f.direction);
      for (const part of f.parts) expect(mature.parts.find(other => other.id === part.id)).toEqual(part);
      expect(mature.modules).toBe(3);
    }
    const one = model.facilityPlan([{ type: 'hospital', level: 1 }], 2026, site, manifest.radius_km);
    expect(one[0]).toEqual(young.find(f => f.kind === 'hospital'));
    expect(grown.length).toBeLessThanOrEqual(model.MAX_FACILITIES);
    expect(grown.reduce((sum, f) => sum + f.parts.length, 0)).toBeLessThanOrEqual(model.MAX_FACILITY_PARTS);
  });

  it('wires authorized completed building stock and activity into the shared surface plan and aligned uniforms', () => {
    const data = { colony: { population: 10000, powered: false }, buildings: stock(7) };
    const before = structuredClone(data);
    const surface = model.plan(data, manifest, [site]);
    expect(surface.facilities).toHaveLength(16);
    expect(surface.facilities.every(f => f.activity === 0)).toBe(true);
    const uniform = model.uniforms(surface);
    expect(uniform.byteLength).toBe(26112);
    expect(uniform.byteLength).toBeLessThan(32768);
    expect(uniform[model.FACILITY_OFFSET]).toBe(16);
    expect(uniform.every(Number.isFinite)).toBe(true);
    let partIndex = 0;
    for (const [i, facility] of surface.facilities.entries()) {
      const offset = model.FACILITY_OFFSET + 4 + i * 16;
      expect(Array.from(uniform.slice(offset, offset + 3))).toEqual(Array.from(new Float32Array(facility.direction)));
      expect(uniform[offset + 7]).toBe(partIndex);
      expect(uniform[offset + 11]).toBe(facility.parts.length);
      for (const part of facility.parts) {
        const p = model.FACILITY_PART_OFFSET + partIndex++ * 12;
        expect(uniform[p] * facility.radiusMeters).toBeCloseTo(part.eastMeters, 4);
        expect(uniform[p + 4] * facility.radiusMeters).toBeCloseTo(part.widthMeters, 4);
        expect(uniform[p + 3]).toBe(part.shape);
      }
    }
    expect(Array.from(uniform.slice(model.FACILITY_PART_OFFSET + partIndex * 12)).every(n => n === 0)).toBe(true);
    expect(data).toEqual(before);
    const otherOwner = model.plan({ ...data, colony: { ...data.colony, owner_id: 999 } }, manifest, [site]);
    expect(otherOwner.facilities).toEqual(surface.facilities);
    expect(model.uniforms(null)[model.FACILITY_OFFSET]).toBe(0);
  });

  it('anchors solids to actual triangle foundations, rejects water/blocked sites and preserves metre dimensions', () => {
    const relief = { sample: () => 100 }, settings = { exaggeration: 1, seaLevel: 0, ocean: true };
    const mesh = buildReliefMesh(relief, 32, settings);
    const before = mesh.slice();
    const facilities = plan(1);
    const output = geometry.facilityGeometry(facilities, mesh);
    expect(output.parts.length).toBeGreaterThan(60);
    expect(output.instances.length).toBe(output.parts.length * 24);
    expect(output.instances.every(Number.isFinite)).toBe(true);
    expect(mesh).toEqual(before);
    for (const [i, part] of output.parts.entries()) {
      const radius = facilities[0].radiusMeters;
      expect(output.instances[i * 24 + 3] * radius).toBeCloseTo(part.widthMeters, 4);
      expect(output.instances[i * 24 + 7] * radius).toBeCloseTo(part.depthMeters, 4);
      expect(output.instances[i * 24 + 15]).toBe(part.shape);
      const top = Math.hypot(...part.position) + output.instances[i * 24 + 11] / 2;
      expect((top - part.foundationRadius) * radius).toBeCloseTo(part.heightMeters + part.bottomMeters, 3);
    }
    expect(geometry.facilityGeometry(facilities, mesh, () => false).parts).toEqual([]);
    const wet = buildReliefMesh({ sample: () => -100 }, 32, settings);
    expect(geometry.facilityGeometry(facilities, wet).parts).toEqual([]);
    const region = mesh.slice();
    for (let i = 6; i < region.length; i += 12) region[i] = 1;
    expect(geometry.facilityGeometry(facilities, region).parts).toEqual([]);
    expect(() => geometry.facilityGeometry(facilities, new Float32Array([NaN]))).toThrow(/triangles/);
  });

  it('keeps buffers bounded and releases owned resources once', () => {
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
    const resources = [];
    const device = {
      createShaderModule: vi.fn(() => ({})),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBindGroup: () => ({}), queue: { writeBuffer: vi.fn() },
      createBuffer(descriptor) {
        const buffer = { ...descriptor, destroy: vi.fn() };
        resources.push(buffer);
        return buffer;
      },
    };
    try {
      const renderer = geometry.createFacilityRenderer(device, 'rgba8unorm', model.FACILITY_PATTERN_WGSL);
      const relief = { sample: () => 100 }, settings = { exaggeration: 1, seaLevel: 0, ocean: true };
      const output = geometry.facilityGeometry(plan(1), buildReliefMesh(relief, 32, settings));
      renderer.update(output);
      const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn() };
      const frame = new Float32Array(52);
      frame.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 36);
      frame[34] = 4;
      frame[5] = 2;
      expect(geometry.resolved(plan(1), frame, 1000)).toBe(false);
      frame.set(plan(1)[0].direction.map(n => n * 1.0001), 32);
      expect(geometry.resolved(plan(1), frame, 1000)).toBe(true);
      renderer.draw(pass, frame, true);
      expect(pass.draw).toHaveBeenCalledWith(144, output.parts.length);
      renderer.update({ parts: [], instances: new Float32Array() });
      renderer.dispose();
      renderer.dispose();
      for (const resource of resources) expect(resource.destroy).toHaveBeenCalledTimes(1);
      expect(Math.max(...resources.map(r => r.size))).toBeLessThan(model.MAX_FACILITY_PARTS * 96);
      expect(() => renderer.update(output)).toThrow(/disposed/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
