import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import '../../js/rendering/material-factory.js';

describe('shared Three.js material factory', () => {
  let factory;

  beforeEach(() => {
    factory = new window.GQMaterialFactory({ three: THREE });
  });

  it.each([
    'createFleetHullMaterial', 'createStationBodyMaterial', 'createStationPanelMaterial',
    'createHotGlowMaterial', 'createStarMaterial', 'createAnimatedSunMaterial', 'createMoonMaterial',
  ])('assigns color and data texture roles in %s', (method) => {
    const map = new THREE.Texture();
    const emissiveMap = new THREE.Texture();
    const bumpMap = new THREE.Texture();
    const roughnessMap = new THREE.Texture();
    bumpMap.colorSpace = THREE.SRGBColorSpace;
    const material = factory[method](0xffffff, { map, emissiveMap, bumpMap, roughnessMap });
    expect(material.map).toBe(map);
    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.emissiveMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
  });

  it('isolates color/data aliases and reuses the role-specific texture', () => {
    const map = new THREE.Texture();
    const originalDispose = vi.spyOn(map, 'dispose');
    const first = factory.createFleetHullMaterial(0xffffff, { map, bumpMap: map });
    const second = factory.createStationBodyMaterial(0xffffff, { map, bumpMap: map });
    expect(first.map).toBe(map);
    expect(first.bumpMap).not.toBe(map);
    expect(second.bumpMap).toBe(first.bumpMap);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(first.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    const cloneDispose = vi.spyOn(first.bumpMap, 'dispose');
    factory.dispose();
    expect(cloneDispose).toHaveBeenCalledOnce();
    expect(originalDispose).not.toHaveBeenCalled();
  });

  it('does not interpret a data-only bundle as a color texture', () => {
    const normalMap = new THREE.Texture();
    const material = factory.createFleetHullMaterial(0xffffff, { normalMap });
    expect(material.map).toBeNull();
    expect(material.emissiveMap).toBeNull();
    expect(material.normalMap).toBe(normalMap);
  });

  it('preserves direct texture input and optional environment intensity including zero', () => {
    const map = new THREE.Texture();
    expect(factory.createFleetHullMaterial(0xffffff, map).map).toBe(map);
    expect(factory.createPlanetFallbackMaterial(0xffffff).envMapIntensity).toBe(1);
    const dark = new window.GQMaterialFactory({ three: THREE, envMapIntensity: 0 });
    expect(dark.createStationBodyMaterial(0xffffff).envMapIntensity).toBe(0);
    const invalid = new window.GQMaterialFactory({ three: THREE, envMapIntensity: -1 });
    expect(invalid.createPlanetFallbackMaterial(0xffffff).envMapIntensity).toBe(1);
  });
});
