import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D, Quaternion, Vector3 } from 'three';
import { PerspectiveSpaceFlight } from '../../js/rendering/perspective-space-flight.js';
import { startSystemBattlePreview } from '../../js/rendering/system-battle-preview.js';

let space;
let frame;
let detach;
let renderer;

beforeEach(() => {
  vi.useFakeTimers();
  space = new PerspectiveSpaceFlight();
  const body = new Object3D();
  body.userData = { type: 'planet', radius: 1e-8 };
  space.bodies.push(body);
  space.registerSpaceVessel = vi.fn(async (descriptor) => {
    space.spaceEntities.set(descriptor.id, {
      id: descriptor.id, position: new Vector3(...descriptor.route[0]), quaternion: new Quaternion(),
      scale: descriptor.visual_scale_ly,
    });
    return true;
  });
  space._removeSpaceEntity = vi.fn((entity) => space.spaceEntities.delete(entity.id));
  detach = vi.fn(() => { frame = null; });
  renderer = { getSpaceView: () => space,
    getSharedZoomBackend: () => ({ addFrameHook: (callback) => { frame = callback; return detach; } }) };
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  space.dispose();
  frame = null;
});

describe('system battle preview', () => {
  it('rejects invalid or non-hero fleet sizes before loading any entities', async () => {
    for (const shipCount of [3, 5, 129, Infinity]) {
      await expect(startSystemBattlePreview(renderer, { hero: true, shipCount })).rejects.toThrow(RangeError);
    }
    await expect(startSystemBattlePreview(renderer, { shipCount: 32 })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, primitiveBudget: 769 })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, formation: 'mixed', shipCount: 4 })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, formation: 'invalid' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, cinematic: false, formation: 'mixed' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, formation: 'classic', tactics: true })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, tactics: 'random' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { scenario: 'convoy' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, formation: 'classic', scenario: 'convoy' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, scenario: 'invalid' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, reinforcements: true })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, scenario: 'convoy', reinforcements: 'yes' })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, durationMs: 300000 })).rejects.toThrow(RangeError);
    await expect(startSystemBattlePreview(renderer, { hero: true, scenario: 'convoy', durationMs: 300001 })).rejects.toThrow(RangeError);
    expect(space.registerSpaceVessel).not.toHaveBeenCalled();
  });
  it('creates only four temporary ships and restores the camera and unrelated effects after timeout', async () => {
    const originalPosition = space.camera.position.clone();
    const existing = { id: 'real-fleet' };
    space.spaceEntities.set(existing.id, existing);
    const effect = space.weaponRenderPass.fire(new Vector3(), new Vector3(1, 0, 0), { time: 0 });
    const preview = await startSystemBattlePreview(renderer, { durationMs: 1000 });
    expect(space.spaceEntities.size).toBe(5);
    expect(preview.getStats().activeEffects).toBe(2);
    await vi.advanceTimersByTimeAsync(700);
    frame();
    expect(preview.getStats().volleys).toBe(2);
    expect(space.effectTime).toBe(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(await preview.finished).toEqual({ volleys: 2, cleaned: true });
    expect(detach).toHaveBeenCalledOnce();
    expect(space.spaceEntities.get(existing.id)).toBe(existing);
    expect(space.spaceEntities.size).toBe(1);
    expect(space.weaponRenderPass.effects).toEqual([effect]);
    expect(space.camera.position.equals(originalPosition)).toBe(true);
    preview.stop();
    expect(detach).toHaveBeenCalledOnce();
  });

  it('stops on system change without restoring an obsolete camera pose', async () => {
    const preview = await startSystemBattlePreview(renderer);
    space.bodies = [];
    space.camera.position.set(4, 5, 6);
    frame();
    expect(await preview.finished).toEqual({ volleys: 1, cleaned: true });
    expect(space.camera.position.toArray()).toEqual([4, 5, 6]);
    expect(space.spaceEntities.size).toBe(0);
  });

  it('cleans partial asset-load failure and allows retry', async () => {
    const register = space.registerSpaceVessel.getMockImplementation();
    space.registerSpaceVessel.mockImplementationOnce(register).mockRejectedValueOnce(new Error('Asset unavailable'));
    await expect(startSystemBattlePreview(renderer)).rejects.toThrow('Asset unavailable');
    expect(space.spaceEntities.size).toBe(0);
    const preview = await startSystemBattlePreview(renderer);
    preview.stop();
    expect((await preview.finished).cleaned).toBe(true);
  });

  it('rejects missing system, invalid duration and overlapping previews explicitly', async () => {
    await expect(startSystemBattlePreview(renderer, { durationMs: Infinity })).rejects.toThrow(RangeError);
    const preview = await startSystemBattlePreview(renderer);
    await expect(startSystemBattlePreview(renderer)).rejects.toThrow('already running');
    preview.stop();
    space.bodies = [];
    await expect(startSystemBattlePreview(renderer)).rejects.toThrow('Enter a rendered system');
  });

  it('cancels slow setup without registering a late frame hook', async () => {
    let finishLoad;
    space.registerSpaceVessel.mockImplementationOnce((descriptor) => {
      space.spaceEntities.set(descriptor.id, {
        id: descriptor.id, position: new Vector3(...descriptor.route[0]), quaternion: new Quaternion(),
        scale: descriptor.visual_scale_ly,
      });
      return new Promise((resolve) => { finishLoad = resolve; });
    });
    const loading = startSystemBattlePreview(renderer, { durationMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(space.spaceEntities.size).toBe(0);
    finishLoad(false);
    const preview = await loading;
    expect(preview.getStats().stopped).toBe(true);
    expect((await preview.finished).cleaned).toBe(true);
    expect(detach).not.toHaveBeenCalled();
  });

  it('fires all six weapon families from moving local muzzles with delayed fixture impacts', async () => {
    const preview = await startSystemBattlePreview(renderer, { reducedMotion: false });
    const initial = [...space.spaceEntities.values()].map((entity) => entity.position.clone());
    const ballistic = space.weaponRenderPass.effects.find((effect) => effect.kind === 'ballistic');
    const launch = ballistic.from.clone();
    await vi.advanceTimersByTimeAsync(700);
    frame();
    expect([...space.spaceEntities.values()].every((entity, index) => !entity.position.equals(initial[index]))).toBe(true);
    expect(ballistic.from.equals(launch)).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    frame();
    expect(new Set(preview.getStats().weaponKinds))
      .toEqual(new Set(['laser', 'ballistic', 'railgun', 'photon', 'plasma', 'missile']));
    const missile = space.weaponRenderPass.effects.find((effect) => effect.kind === 'missile');
    expect(space.weaponRenderPass.sample(missile, missile.time + 1)
      .some((primitive) => primitive.width >= missile.profile.impact)).toBe(false);
    expect(preview.getStats().shots).toBe(6);
    preview.stop();
    expect(preview.getStats().activeEffects).toBe(0);
    expect(space.weaponRenderPass.effects).toHaveLength(0);
  });

  it('keeps ships stationary in reduced-motion mode while weapon flight still advances', async () => {
    const preview = await startSystemBattlePreview(renderer, { reducedMotion: true, weaponKinds: ['missile'] });
    const first = [...space.spaceEntities.values()].map((entity) => entity.position.clone());
    const shot = space.weaponRenderPass.effects[0];
    await vi.advanceTimersByTimeAsync(400);
    frame();
    expect([...space.spaceEntities.values()].every((entity, index) => entity.position.equals(first[index]))).toBe(true);
    expect(space.weaponRenderPass.sample(shot, shot.time + 0.4)).not.toEqual(space.weaponRenderPass.sample(shot, shot.time + 0.1));
    preview.stop();
  });

  it('stops if a preview ship disappears instead of shooting from an invisible source', async () => {
    const preview = await startSystemBattlePreview(renderer);
    space.spaceEntities.delete([...space.spaceEntities.keys()][0]);
    frame();
    expect(preview.getStats().stopped).toBe(true);
    expect(space.spaceEntities.size).toBe(0);
    expect(space.weaponRenderPass.effects).toHaveLength(0);
    expect((await preview.finished).cleaned).toBe(true);
  });

  it('rejects invalid QA profiles without creating ships', async () => {
    await expect(startSystemBattlePreview(renderer, { weaponKinds: [] })).rejects.toThrow(TypeError);
    await expect(startSystemBattlePreview(renderer, { weaponKinds: ['unknown'] })).rejects.toThrow(TypeError);
    await expect(startSystemBattlePreview(renderer, { reducedMotion: 'false' })).rejects.toThrow(TypeError);
    expect(space.registerSpaceVessel).not.toHaveBeenCalled();
  });
});
