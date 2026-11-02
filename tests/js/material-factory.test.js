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
    expect(material.map).not.toBe(map);
    expect(map.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.emissiveMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(bumpMap.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.roughnessMap.colorSpace).toBe(THREE.NoColorSpace);
    expect(material.userData.sharedTexture).toBe(true);
  });

  it('isolates color/data aliases and reuses the role-specific texture', () => {
    const map = new THREE.Texture();
    const originalDispose = vi.spyOn(map, 'dispose');
    const first = factory.createFleetHullMaterial(0xffffff, { map, bumpMap: map });
    const second = factory.createStationBodyMaterial(0xffffff, { map, bumpMap: map });
    expect(first.map).not.toBe(map);
    expect(first.bumpMap).toBe(map);
    expect(second.map).toBe(first.map);
    expect(second.bumpMap).toBe(first.bumpMap);
    expect(map.colorSpace).toBe(THREE.NoColorSpace);
    expect(first.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
    const cloneDispose = vi.spyOn(first.map, 'dispose');
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
    map.colorSpace = THREE.SRGBColorSpace;
    expect(factory.createFleetHullMaterial(0xffffff, map).map).toBe(map);
    expect(factory.createPlanetFallbackMaterial(0xffffff).envMapIntensity).toBe(1);
    const dark = new window.GQMaterialFactory({ three: THREE, envMapIntensity: 0 });
    expect(dark.createStationBodyMaterial(0xffffff).envMapIntensity).toBe(0);
    const invalid = new window.GQMaterialFactory({ three: THREE, envMapIntensity: -1 });
    expect(invalid.createPlanetFallbackMaterial(0xffffff).envMapIntensity).toBe(1);
  });

  it.each([THREE.NoColorSpace, THREE.SRGBColorSpace])(
    'does not retag borrowed textures shared by two factories (initial space %j)', (colorSpace) => {
      const source = new THREE.Texture();
      source.colorSpace = colorSpace;
      const disposeSource = vi.spyOn(source, 'dispose');
      const other = new window.GQMaterialFactory({ three: THREE });
      const color = factory.createFleetHullMaterial(0xffffff, source);
      const data = other.createStationBodyMaterial(0xffffff, { bumpMap: source });
      expect(source.colorSpace).toBe(colorSpace);
      expect(color.map.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(data.bumpMap.colorSpace).toBe(THREE.NoColorSpace);
      expect(color.map).not.toBe(data.bumpMap);
      const owned = [color.map, data.bumpMap].filter((texture) => texture !== source);
      const disposals = owned.map((texture) => vi.spyOn(texture, 'dispose'));
      factory.dispose();
      other.dispose();
      expect(disposeSource).not.toHaveBeenCalled();
      disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
      expect(source.colorSpace).toBe(colorSpace);
    },
  );

  it('releases a shared owned clone only after its last material and evicts its role cache', () => {
    const source = new THREE.Texture();
    const disposeSource = vi.spyOn(source, 'dispose');
    const first = factory.createFleetHullMaterial(0xffffff, source);
    const second = factory.createStationBodyMaterial(0xffffff, { map: source, emissiveMap: source });
    const clone = first.map;
    const disposeClone = vi.spyOn(clone, 'dispose');
    expect(first.emissiveMap).toBe(clone);
    expect(second.map).toBe(clone);
    expect(second.emissiveMap).toBe(clone);
    first.dispose();
    first.dispose();
    expect(disposeClone).not.toHaveBeenCalled();
    expect(factory._ownedTextures.size).toBe(1);
    second.dispose();
    expect(disposeClone).toHaveBeenCalledOnce();
    expect(factory._ownedTextures.size).toBe(0);
    expect(factory._textureRoles.get(source)?.get(THREE.SRGBColorSpace)).toBeUndefined();
    const replacement = factory.createFleetHullMaterial(0xffffff, source);
    expect(replacement.map).not.toBe(clone);
    expect(replacement.map.colorSpace).toBe(THREE.SRGBColorSpace);
    replacement.dispose();
    factory.dispose();
    expect(disposeClone).toHaveBeenCalledOnce();
    expect(disposeSource).not.toHaveBeenCalled();
  });

  it('keeps per-material clone ownership isolated between factories', () => {
    const source = new THREE.Texture();
    const disposeSource = vi.spyOn(source, 'dispose');
    const other = new window.GQMaterialFactory({ three: THREE });
    const first = factory.createFleetHullMaterial(0xffffff, source);
    const second = other.createFleetHullMaterial(0xffffff, source);
    expect(first.map).not.toBe(second.map);
    const disposeFirst = vi.spyOn(first.map, 'dispose');
    const disposeSecond = vi.spyOn(second.map, 'dispose');
    first.dispose();
    expect(disposeFirst).toHaveBeenCalledOnce();
    expect(disposeSecond).not.toHaveBeenCalled();
    second.dispose();
    factory.dispose();
    other.dispose();
    expect(disposeSecond).toHaveBeenCalledOnce();
    expect(disposeSource).not.toHaveBeenCalled();
  });

  it('makes factory disposal idempotent and late material disposal safe after cache reuse', () => {
    const source = new THREE.Texture();
    const disposeSource = vi.spyOn(source, 'dispose');
    const first = factory.createFleetHullMaterial(0xffffff, source);
    const second = factory.createMoonMaterial(0xffffff, { map: source });
    const disposeOldClone = vi.spyOn(first.map, 'dispose');
    factory.dispose();
    factory.dispose();
    expect(disposeOldClone).toHaveBeenCalledOnce();
    const replacement = factory.createFleetHullMaterial(0xffffff, source);
    expect(replacement.map).not.toBe(first.map);
    const disposeReplacement = vi.spyOn(replacement.map, 'dispose');
    first.dispose();
    second.dispose();
    expect(disposeOldClone).toHaveBeenCalledOnce();
    expect(disposeReplacement).not.toHaveBeenCalled();
    expect(factory._ownedTextures.size).toBe(1);
    replacement.dispose();
    factory.dispose();
    expect(disposeReplacement).toHaveBeenCalledOnce();
    expect(disposeSource).not.toHaveBeenCalled();
  });

  it('never disposes already-compatible borrowed maps when their material is disposed', () => {
    const source = new THREE.Texture();
    source.colorSpace = THREE.SRGBColorSpace;
    const disposeSource = vi.spyOn(source, 'dispose');
    const material = factory.createStationBodyMaterial(0xffffff, { map: source });
    expect(material.map).toBe(source);
    expect(material.userData.sharedTexture).toBe(true);
    material.dispose();
    factory.dispose();
    expect(disposeSource).not.toHaveBeenCalled();
  });
});
