import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const managerPath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeLifecycleManager.js');

function loadModule() {
  delete window.GQRuntimeLifecycleManager;
  window.eval(fs.readFileSync(managerPath, 'utf8'));
  return window.GQRuntimeLifecycleManager;
}

describe('RuntimeLifecycleManager injected phases API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.GQRuntimeLifecycleManager;
    window.GQRuntimeLifecyclePhases = {
      LIFECYCLE_PHASES: {
        CREATED: 'CREATED',
        BOOTSTRAPPING: 'BOOTSTRAPPING',
        SERVICES_READY: 'SERVICES_READY',
        UI_READY: 'UI_READY',
        RUNNING: 'RUNNING',
        PAUSED: 'PAUSED',
        RESUMING: 'RESUMING',
        SHUTTING_DOWN: 'SHUTTING_DOWN',
        DISPOSED: 'DISPOSED',
        ERROR: 'ERROR',
      },
      getLifecyclePhaseValues: () => [
        'CREATED',
        'BOOTSTRAPPING',
        'SERVICES_READY',
        'UI_READY',
        'RUNNING',
        'PAUSED',
        'RESUMING',
        'SHUTTING_DOWN',
        'DISPOSED',
        'ERROR',
      ],
      isLifecyclePhase: (value) => [
        'CREATED',
        'BOOTSTRAPPING',
        'SERVICES_READY',
        'UI_READY',
        'RUNNING',
        'PAUSED',
        'RESUMING',
        'SHUTTING_DOWN',
        'DISPOSED',
        'ERROR',
      ].includes(value),
    };
  });

  it('uses injected runtimeLifecyclePhasesApi for initial phase and transitions', async () => {
    const mod = loadModule();

    const injectedPhasesApi = {
      LIFECYCLE_PHASES: {
        CREATED: 'X_CREATED',
        RUNNING: 'X_RUNNING',
      },
      getLifecyclePhaseValues: () => ['X_CREATED', 'X_RUNNING'],
      isLifecyclePhase: (value) => value === 'X_CREATED' || value === 'X_RUNNING',
    };

    const manager = mod.createLifecycleManager({
      runtimeLifecyclePhasesApi: injectedPhasesApi,
      registry: {
        getAllSorted: () => [],
        register: vi.fn(),
      },
      logger: vi.fn(),
    });

    expect(manager.getPhase()).toBe('X_CREATED');
    await manager.transitionTo('X_RUNNING', { source: 'test' });
    expect(manager.getPhase()).toBe('X_RUNNING');
  });

  it('rejects unknown phase based on injected validator', async () => {
    const mod = loadModule();

    const injectedPhasesApi = {
      LIFECYCLE_PHASES: {
        CREATED: 'CREATED',
        RUNNING: 'RUNNING',
      },
      getLifecyclePhaseValues: () => ['CREATED', 'RUNNING'],
      isLifecyclePhase: (value) => value === 'CREATED' || value === 'RUNNING',
    };

    const manager = mod.createLifecycleManager({
      runtimeLifecyclePhasesApi: injectedPhasesApi,
      registry: {
        getAllSorted: () => [],
        register: vi.fn(),
      },
      logger: vi.fn(),
    });

    await expect(manager.transitionTo('NOT_A_PHASE')).rejects.toThrow('Unknown lifecycle phase');
  });
});
