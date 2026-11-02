import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../../js/rendering/light-rig-manager.js';

function pmrem() {
  const map = new THREE.Texture();
  map.mapping = THREE.CubeUVReflectionMapping;
  return map;
}

describe('shared Three.js light rig lifecycle', () => {
  it('moves an unchanged profile to the requested scene and releases old shadows', () => {
    const original = new THREE.Scene();
    const next = new THREE.Scene();
    const manager = new window.GQLightRigManager({ three: THREE, scene: original });
    manager.setProfile('galaxy');
    const oldLights = manager.activeLights.slice();
    const shadowDisposals = oldLights.filter((light) => light.shadow)
      .map((light) => vi.spyOn(light.shadow, 'dispose'));
    manager.setProfile('galaxy', next);
    expect(original.children).toHaveLength(0);
    expect(next.children).toHaveLength(3);
    oldLights.forEach((light) => expect(light.parent).toBeNull());
    shadowDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(manager.activeLights).not.toEqual(oldLights);
    const active = manager.activeLights.slice();
    manager.setProfile('galaxy', next);
    expect(manager.activeLights).toEqual(active);
  });

  it('keeps shadows opt-in and disposes allocated shadow render targets once', () => {
    const scene = new THREE.Scene();
    const manager = new window.GQLightRigManager({
      three: THREE, scene,
      profiles: { custom: [
        { type: 'directional', intensity: 1, castShadow: true },
        { type: 'point', intensity: 1, castShadow: true },
        { type: 'directional', intensity: 0.5 },
      ] },
    });
    manager.setProfile('custom');
    expect(manager.activeLights.map((light) => light.castShadow)).toEqual([true, true, false]);
    const target = new THREE.WebGLRenderTarget(16, 16);
    const mapDispose = vi.spyOn(target, 'dispose');
    manager.activeLights[0].shadow.map = target;
    manager.dispose();
    manager.dispose();
    expect(mapDispose).toHaveBeenCalledOnce();
    expect(scene.children).toHaveLength(0);
  });

  it('leaves scene environments and default light profiles unchanged without configuration', () => {
    const scene = new THREE.Scene();
    const existing = pmrem();
    scene.environment = existing;
    scene.environmentIntensity = 0.7;
    const manager = new window.GQLightRigManager({ three: THREE, scene });
    manager.setProfile('galaxy');
    expect(scene.environment).toBe(existing);
    expect(scene.environmentIntensity).toBe(0.7);
    expect(manager.activeLights.map((light) => light.intensity)).toEqual([0.62, 1.18, 0.28]);
    expect(manager.activeLights.every((light) => !light.castShadow)).toBe(true);
    manager.dispose();
    expect(scene.environment).toBe(existing);
  });

  it('applies only supplied PMREM maps, restores scene settings, and never disposes borrowed textures', () => {
    const scene = new THREE.Scene();
    const previous = pmrem();
    const borrowed = pmrem();
    scene.environment = previous;
    scene.environmentIntensity = 1.5;
    const dispose = vi.spyOn(borrowed, 'dispose');
    const manager = new window.GQLightRigManager({
      three: THREE, scene, environmentMap: borrowed, environmentIntensity: 0,
    });
    manager.setProfile('galaxy');
    expect(scene.environment).toBe(borrowed);
    expect(scene.environmentIntensity).toBe(0);
    manager.setProfile('system', null, { environmentMap: null });
    expect(scene.environment).toBe(previous);
    expect(scene.environmentIntensity).toBe(1.5);
    manager.dispose();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('preserves environment changes made by another owner while the rig is active', () => {
    const scene = new THREE.Scene();
    const manager = new window.GQLightRigManager({ three: THREE, scene });
    manager.setProfile('galaxy', scene, { environmentMap: pmrem(), environmentIntensity: 2 });
    const external = pmrem();
    scene.environment = external;
    scene.environmentIntensity = 3;
    manager.dispose();
    expect(scene.environment).toBe(external);
    expect(scene.environmentIntensity).toBe(3);
  });

  it('detects changed supplied environments and mutated options without disturbing invalid requests', () => {
    const scene = new THREE.Scene();
    const manager = new window.GQLightRigManager({ three: THREE, scene });
    const options = { environmentMap: pmrem(), environmentIntensity: 1, starIntensity: 2 };
    manager.setProfile('system', scene, options);
    options.environmentMap = pmrem();
    options.starIntensity = 3;
    options.environmentIntensity = 0.4;
    manager.setProfile('system', scene, options);
    expect(scene.environment).toBe(options.environmentMap);
    expect(scene.environmentIntensity).toBe(0.4);
    expect(manager.activeLights.find((light) => light.isPointLight).intensity).toBe(3);
    const lights = manager.activeLights.slice();
    expect(() => manager.setProfile('galaxy', scene, { environmentMap: new THREE.Texture() }))
      .toThrow('prefiltered PMREM');
    expect(manager.activeLights).toEqual(lights);
  });
});
