import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { startLiveBattleWebGpu } from '../../js/rendering/live-battle-webgpu.js';

const group = (count) => ({ initial_count: 2, count, shield: 0, hull: count * 10 });
const state = (tick, defender = 2, status = 'active') => ({
  tick, status, rule_version: 'live-groups-experimental-v1',
  outcome: status === 'active' ? null : 'attacker_wins',
  groups: { attacker: { fighter: group(2) }, defender: { cruiser: group(defender) } },
});
const snapshot = () => ({
  success: true,
  snapshot: { schema_version: 1, journal_id: 17, tick: 0, state: state(0), next_tick_at_utc: null },
});
const page = () => ({
  success: true,
  page: {
    schema_version: 1, journal_id: 17, latest_tick: 2, next_cursor: 2, has_more: false,
    ticks: [1, 2].map((tick) => ({
      tick, state: state(tick, tick === 2 ? 0 : 1, tick === 2 ? 'resolved' : 'active'),
      events: [{ tick, source_side: 'attacker', target_side: 'defender', target_group: 'cruiser',
        shield_damage: 0, hull_damage: 10, ships_lost: 1 }],
    })),
  },
});

function fixture() {
  const body = { userData: { radius: 2 }, getWorldPosition: (out) => out.set(1, 2, 3) };
  const hooks = new Set();
  const effects = new Set();
  const entities = new Map();
  const space = {
    root: {}, origin: new Vector3(100, 200, 300), bodies: [body], spaceEntities: entities,
    registerSpaceVessel: vi.fn((options) => {
      entities.set(options.id, { id: options.id, position: new Vector3().fromArray(options.route[0]) });
      return Promise.resolve(true);
    }),
    _removeSpaceEntity: vi.fn((entity) => entities.delete(entity.id)),
    weaponRenderPass: {
      fire: vi.fn((source, target, options) => {
        const effect = { source, target, ...options };
        effects.add(effect);
        return effect;
      }),
      remove: vi.fn((items) => { for (const effect of items) effects.delete(effect); }),
    },
  };
  const renderer = {
    getSpaceView: () => space,
    getSharedZoomBackend: () => ({ addFrameHook: (hook) => { hooks.add(hook); return () => hooks.delete(hook); } }),
  };
  return { body, space, renderer, entities, effects, hooks };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('experimental WebGPU live battle presentation', () => {
  it('renders aggregate group proxies, suppresses catch-up effects and cleans only its own resources', async () => {
    const { body, renderer, entities, effects, hooks, space } = fixture();
    entities.set('existing', { id: 'existing' });
    const api = { get: vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(page()) };
    const view = startLiveBattleWebGpu(renderer, api, 17, { body, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(entities.size).toBe(3);
    expect(document.querySelector('[data-live-battle-journal="17"]').textContent).toContain('defender cruiser: 2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(space.weaponRenderPass.fire).toHaveBeenCalledTimes(1);
    expect(effects.size).toBe(1);
    expect(entities.size).toBe(2);
    expect(document.querySelector('[data-live-battle-journal="17"]').textContent).toContain('attacker_wins');
    view.stop();
    await expect(view.finished).resolves.toEqual({ journalId: 17, cleaned: true });
    expect([...entities.keys()]).toEqual(['existing']);
    expect(effects.size).toBe(0);
    expect(hooks.size).toBe(0);
    expect(document.querySelector('[data-live-battle-journal="17"]')).toBeNull();
  });

  it('stops and removes owned resources on system change', async () => {
    const { body, renderer, space, entities, hooks } = fixture();
    const view = startLiveBattleWebGpu(renderer, { get: vi.fn().mockResolvedValue(snapshot()) }, 17, {
      body, onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    space.bodies = [];
    for (const hook of hooks) hook();
    await view.finished;
    expect(entities.size).toBe(0);
    expect(hooks.size).toBe(0);
  });

  it('cleans up and rejects when proxy setup fails', async () => {
    const { body, renderer, space, entities } = fixture();
    space.registerSpaceVessel.mockImplementation((options) => {
      entities.set(options.id, { id: options.id, position: new Vector3() });
      return Promise.reject(new Error('asset failed'));
    });
    const view = startLiveBattleWebGpu(renderer, { get: vi.fn().mockResolvedValue(snapshot()) }, 17, {
      body, onError: vi.fn(),
    });
    const failure = expect(view.finished).rejects.toThrow('asset failed');
    await vi.advanceTimersByTimeAsync(0);
    await failure;
    expect(entities.size).toBe(0);
  });

  it('rejects invalid targets and refuses simultaneous presentations', async () => {
    const { body, renderer } = fixture();
    expect(() => startLiveBattleWebGpu(renderer, {}, 17, { body: {}, onError: vi.fn() })).toThrow();
    const view = startLiveBattleWebGpu(renderer, { get: vi.fn().mockResolvedValue(snapshot()) }, 17, {
      body, onError: vi.fn(),
    });
    expect(() => startLiveBattleWebGpu(renderer, {}, 17, { body, onError: vi.fn() })).toThrow('already active');
    view.stop();
    await view.finished;
  });

  it('cleans an in-flight proxy load without showing later groups', async () => {
    const { body, renderer, space, entities } = fixture();
    let release;
    space.registerSpaceVessel.mockImplementation((options) => {
      entities.set(options.id, { id: options.id, position: new Vector3() });
      return new Promise((resolve) => { release = resolve; });
    });
    const view = startLiveBattleWebGpu(renderer, { get: vi.fn().mockResolvedValue(snapshot()) }, 17, {
      body, onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(entities.size).toBe(1);
    view.stop();
    release(false);
    await view.finished;
    await vi.advanceTimersByTimeAsync(0);
    expect(entities.size).toBe(0);
    expect(space.registerSpaceVessel).toHaveBeenCalledTimes(1);
  });

  it('reports transport errors and rejects without leaving presentation resources', async () => {
    const { body, renderer, entities } = fixture();
    const error = Object.assign(new Error('not authorized'), { status: 401 });
    const onError = vi.fn();
    const view = startLiveBattleWebGpu(renderer, { get: vi.fn().mockRejectedValue(error) }, 17, {
      body, onError,
    });
    const failure = expect(view.finished).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);
    await failure;
    expect(onError).toHaveBeenCalledWith({ error, attempt: 1, retryInMs: null });
    expect(entities.size).toBe(0);
    expect(document.querySelector('[data-live-battle-journal="17"]')).toBeNull();
  });

  it('limits visible groups while retaining all server counts in the summary', async () => {
    const { body, renderer, entities } = fixture();
    const initial = snapshot();
    initial.snapshot.state.groups.attacker = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`ship${String(index).padStart(2, '0')}`, group(2)]),
    );
    const view = startLiveBattleWebGpu(renderer, { get: vi.fn().mockResolvedValue(initial) }, 17, {
      body, onError: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(entities.size).toBe(13);
    const text = document.querySelector('[data-live-battle-journal="17"]').textContent;
    expect(text).toContain('max. 12 je Seite');
    expect(text).toContain('attacker ship19: 2');
    view.stop();
    await view.finished;
  });
});
