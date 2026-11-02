import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

describe('normal runtime coherent material activation', () => {
  beforeEach(() => {
    vi.resetModules();
    delete window.WorldAssetDescriptor;
    delete window.CoherentMaterialGenerator;
    delete window.GQTextureManager;
  });
  afterEach(() => {
    delete window.WorldAssetDescriptor;
    delete window.CoherentMaterialGenerator;
    delete window.GQTextureManager;
  });

  it('loads contract and generator before texture manager without requiring colony globals', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no backend required'));
    const { loadRuntimeModule } = await import('../../js/runtime/runtime-module-loader.js');
    const pending = loadRuntimeModule('js/rendering/texture-manager.js?v=1');
    expect(loadRuntimeModule('js/rendering/texture-manager.js?v=2')).toBe(pending);
    await pending;
    expect(window.WorldAssetDescriptor).toBeDefined();
    expect(window.CoherentMaterialGenerator).toBeDefined();
    const manager = new window.GQTextureManager({ three: THREE });
    const material = manager.getObjectMaterial({ seed: 0, materialFamily: 'painted-metal' });
    expect(material.map.isDataTexture).toBe(true);
    expect(material.normalMap.isDataTexture).toBe(true);
    expect(material.roughnessMap.isDataTexture).toBe(true);
    expect(material.metalnessMap.isDataTexture).toBe(true);
    expect(material.emissiveMap.isDataTexture).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    material.dispose();
    manager.dispose();
  });
});
