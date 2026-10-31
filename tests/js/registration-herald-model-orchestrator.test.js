import { describe, expect, it, vi } from 'vitest';
import { Bone, BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene } from 'three';
import {
  RegistrationHeraldModelOrchestrator,
  selectHeraldAnimationClips,
  selectHeraldLod,
} from '../../js/rendering/registration-herald-model-orchestrator.js';

describe('registration herald model orchestrator', () => {
  it('selects a coarser mesh when the projected figure is small', () => {
    expect(selectHeraldLod(1000, 1, 1.8)).toBe('high');
    expect(selectHeraldLod(600, 1, 1.8)).toBe('medium');
    expect(selectHeraldLod(300, 1, 1.8)).toBe('low');
    expect(selectHeraldLod(844, 1.5, 390 / 844)).toBe('medium');
  });

  it('selects semantic idle and greeting clips from a rigged GLB', () => {
    const idle = { name: 'Idle_Breathing' };
    const greeting = { name: 'Greeting_Wave' };
    const clips = selectHeraldAnimationClips([{ name: 'ArmatureAction' }, greeting, idle]);

    expect(clips).toEqual({ idle, greeting });
  });

  it('leaves procedural idle and greeting available when the GLB has no animations', () => {
    expect(selectHeraldAnimationClips([])).toEqual({ idle: null, greeting: null });
    expect(selectHeraldAnimationClips([{ name: 'ArmatureAction' }])).toEqual({ idle: null, greeting: null });
  });

  it('finds the MPFB game_engine right arm bone and creates six independent actors', () => {
    const orchestrator = new RegistrationHeraldModelOrchestrator();
    const source = new Group();
    const armature = new Group();
    const arm = new Bone();
    arm.name = 'upperarm_r';
    armature.add(arm);
    source.add(armature);
    source.add(new Mesh(new BoxGeometry(1, 2, 0.5), new MeshBasicMaterial()));
    orchestrator.scene = new Scene();
    orchestrator.canvas = { clientWidth: 1280, clientHeight: 720, remove() {} };

    expect(orchestrator.findGreetingBone(source)).toBe(arm);
    orchestrator.addActors({ scene: source, animations: [] }, [
      'aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen',
    ].map((code) => ({ code })));
    expect(orchestrator.actors).toHaveLength(6);
    expect(new Set(orchestrator.actors.map((actor) => actor.model)).size).toBe(6);
    expect(new Set(orchestrator.actors.map((actor) => actor.mixer)).size).toBe(6);
    expect(orchestrator.actors.every((actor) => actor.greetingBone && actor.greetingAction === null)).toBe(true);
    orchestrator.destroy();
  });

  it('falls back cleanly when the development GLB is unavailable', async () => {
    const orchestrator = new RegistrationHeraldModelOrchestrator({
      windowRef: { navigator: { gpu: {} }, GQLog: { info() {} } },
      documentRef: {},
      loaderFactory: () => ({ loadAsync: async () => { throw new Error('not found'); } }),
    });
    await expect(orchestrator.mount({ prepend() {} }, [{ code: 'vor_tak' }])).resolves.toBe(false);
    expect(orchestrator.canvas).toBeNull();
    orchestrator.destroy();
  });

  it('mounts a GLB on WebGPU, clones six rigs and animates the focused MPFB arm', async () => {
    const source = new Group();
    const arm = new Bone();
    arm.name = 'upperarm_r';
    source.add(arm);
    source.add(new Mesh(new BoxGeometry(1, 2, 0.5), new MeshBasicMaterial()));
    const canvas = {
      dataset: {},
      setAttribute() {},
      remove() { this.removed = true; },
      clientWidth: 1280,
      clientHeight: 720,
      parentElement: null,
    };
    const container = {
      prepend(element) { element.parentElement = this; },
      getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    };
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }
    const windowRef = {
      navigator: { gpu: { requestAdapter: async () => ({}) } },
      ResizeObserver: ResizeObserverMock,
      devicePixelRatio: 1,
      performance: { now: () => 1000 },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame() {},
      GQLog: { info() {}, warn() {} },
    };
    const renderer = {
      backend: { isWebGPUBackend: true },
      init: async () => {},
      setPixelRatio() {},
      setSize() {},
      render: vi.fn(),
      dispose() {},
    };
    const documentRef = {
      body: { dataset: {} },
      createElement: () => canvas,
    };
    const orchestrator = new RegistrationHeraldModelOrchestrator({
      windowRef,
      documentRef,
      rendererFactory: () => renderer,
      loaderFactory: () => ({ loadAsync: async () => ({ scene: source, animations: [] }) }),
    });
    const actors = ['aereth', 'vor_tak', 'syl_nar', 'vel_ar', 'kryl_tha', 'zhareen']
      .map((code) => ({ code }));

    await expect(orchestrator.mount(container, actors)).resolves.toBe(true);
    expect(orchestrator.actors).toHaveLength(6);
    expect(new Set(orchestrator.actors.map((actor) => actor.model)).size).toBe(6);
    const focused = orchestrator.actors.find((actor) => actor.code === 'vor_tak');
    const baseRotation = focused.greetingBone.quaternion.clone();
    orchestrator.setVisible(true);
    orchestrator.setFocus('vor_tak');
    orchestrator.render(1016);
    expect(renderer.render).toHaveBeenCalledOnce();
    expect(focused.greetingBone.quaternion.equals(baseRotation)).toBe(false);
    orchestrator.destroy();
    expect(canvas.removed).toBe(true);
  });
});