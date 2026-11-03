import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RegistrationHeraldStage, createHeraldInstanceData, parseNpcJsonMeshDescriptor } from '../../js/rendering/registration-herald-stage-webgpu.js';
import { RegistrationHeraldModelOrchestrator } from '../../js/rendering/registration-herald-model-orchestrator.js';

const actors = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen']
  .map((code) => ({ code, name: code }));
const viewport = {
  halfSpan: 4.8,
  offsetX: 2.2,
  scaleFactor: 1,
  aspect: 1.7,
  distance: 11.2,
  focal: 2.6,
};

describe('registration WebGPU herald stage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('replays the latest focus and selection when the rigged stage finishes mounting', async () => {
    let finish;
    let mountedStage;
    vi.spyOn(RegistrationHeraldModelOrchestrator.prototype, 'mount').mockImplementation(function () {
      mountedStage = this;
      this.canvas = { dataset: {}, remove() {} };
      return new Promise((resolve) => { finish = resolve; });
    });
    const selected = vi.spyOn(RegistrationHeraldModelOrchestrator.prototype, 'setSelected').mockImplementation(() => {});
    const focused = vi.spyOn(RegistrationHeraldModelOrchestrator.prototype, 'setFocus').mockImplementation(() => {});
    const destroy = vi.spyOn(RegistrationHeraldModelOrchestrator.prototype, 'destroy').mockImplementation(() => {});
    const stage = new RegistrationHeraldStage({ windowRef: { navigator: { gpu: {} }, removeEventListener() {} }, documentRef: {} });
    const mounting = stage.mount({}, actors);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    stage.setSelected('aereth');
    stage.setFocus('vor_tak');
    finish(true);
    expect(await mounting).toBe(true);
    expect(stage.riggedOrchestrator).toBe(mountedStage);
    expect(selected).toHaveBeenCalledExactlyOnceWith('aereth');
    expect(focused).toHaveBeenCalledExactlyOnceWith('vor_tak');
    expect(selected.mock.invocationCallOrder[0]).toBeLessThan(focused.mock.invocationCallOrder[0]);
    stage.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('disposes a rigged stage that finishes mounting after leaving registration', async () => {
    let finish;
    vi.spyOn(RegistrationHeraldModelOrchestrator.prototype, 'mount').mockImplementation(function () {
      this.canvas = { dataset: {} };
      return new Promise((resolve) => { finish = resolve; });
    });
    const destroy = vi.spyOn(RegistrationHeraldModelOrchestrator.prototype, 'destroy').mockImplementation(() => {});
    const stage = new RegistrationHeraldStage({ windowRef: { navigator: { gpu: {} }, removeEventListener() {} }, documentRef: {} });
    const mounting = stage.mount({}, actors);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    stage.destroy();
    finish(true);
    expect(await mounting).toBe(false);
    expect(stage.riggedOrchestrator).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('converts the six existing NPC Object JSON models to finite GPU vertex data', async () => {
    for (const actor of actors) {
      const source = fs.readFileSync(path.resolve(process.cwd(), `models/npc_avatars/${actor.code}_npc_bust.json`), 'utf8');
      const meshes = await parseNpcJsonMeshDescriptor(JSON.parse(source));
      expect(meshes.some((mesh) => mesh.name === 'head')).toBe(true);
      expect(meshes.some((mesh) => mesh.name === 'torso')).toBe(true);
      expect(meshes.every((mesh) => mesh.vertices.length > 0 && [...mesh.vertices].every(Number.isFinite))).toBe(true);
    }
  });

  it('builds finite 3D instance data for six complete figures', () => {
    const instances = createHeraldInstanceData(actors, 1.25, null, null, viewport);

    expect(instances).toHaveLength(6 * 11 * 16);
    expect([...instances].every(Number.isFinite)).toBe(true);
    expect(instances[0]).not.toBe(instances[(5 * 11 * 16)]);
  });

  it('raises the focused herald arm while keeping the other figures at idle', () => {
    const idle = createHeraldInstanceData(actors, 0, null, null, viewport);
    const focused = createHeraldInstanceData(actors, 0, 'aereth', null, viewport);
    const rightArmRotationZ = 7 * 16 + 10;

    expect(Math.abs(focused[rightArmRotationZ])).toBeGreaterThan(Math.abs(idle[rightArmRotationZ]) + 0.3);
    expect(focused[11 * 16 + rightArmRotationZ]).toBeCloseTo(idle[11 * 16 + rightArmRotationZ]);
  });
});
