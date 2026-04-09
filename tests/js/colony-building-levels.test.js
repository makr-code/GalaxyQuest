import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(import.meta.url), '../../..');

const { ColonyBuildingLevelThreeJS } = require(path.join(root, 'js/engine/zoom/levels/ColonyBuildingLevelThreeJS.js'));
const { ColonyBuildingLevelWebGPU } = require(path.join(root, 'js/engine/zoom/levels/ColonyBuildingLevelWebGPU.js'));

describe('Colony building zoom level renderers', () => {
  it('ColonyBuildingLevelThreeJS forces targetType BUILDING', async () => {
    const level = new ColonyBuildingLevelThreeJS();
    const spy = vi.fn(async () => undefined);
    level._buildScene = vi.fn();
    level.enter = ColonyBuildingLevelThreeJS.prototype.enter.bind({
      ...level,
      _buildScene: vi.fn(),
      _clearObjectMesh: vi.fn(),
      _scene: null,
      _renderer: null,
      _camera: null,
      _rotation: 0,
      _targetType: null,
      _sceneData: null,
      _canvas: null,
      _backend: null,
      __proto__: Object.getPrototypeOf(level),
    });

    // Patch super.enter path by spying on prototype call.
    const baseProto = Object.getPrototypeOf(ColonyBuildingLevelThreeJS.prototype);
    const baseEnterSpy = vi.spyOn(baseProto, 'enter').mockImplementation(spy);

    await level.enter(3, { targetType: 'FLEET' });

    expect(baseEnterSpy).toHaveBeenCalledTimes(1);
    expect(baseEnterSpy.mock.calls[0][1].targetType).toBe('BUILDING');

    baseEnterSpy.mockRestore();
  });

  it('ColonyBuildingLevelWebGPU forces targetType BUILDING', async () => {
    const level = new ColonyBuildingLevelWebGPU();
    const baseProto = Object.getPrototypeOf(ColonyBuildingLevelWebGPU.prototype);
    const baseEnterSpy = vi.spyOn(baseProto, 'enter').mockResolvedValue(undefined);

    await level.enter(3, { targetType: 'FLEET' });

    expect(baseEnterSpy).toHaveBeenCalledTimes(1);
    expect(baseEnterSpy.mock.calls[0][1].targetType).toBe('BUILDING');

    baseEnterSpy.mockRestore();
  });
});
