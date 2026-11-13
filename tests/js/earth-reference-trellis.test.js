import { Box3, Group, Mesh, MeshStandardMaterial, Vector3, BoxGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EARTH_REFERENCE, geographicVector } from '../../js/rendering/earth-reference-geography.js';
import {
  disposeTrellisBuilding,
  placeTrellisBuilding,
  TRELLIS_BUILDING_ASSETS,
  TRELLIS_BUILDING_CANDIDATES,
} from '../../js/rendering/earth-reference-trellis.js';

describe('Earth reference TRELLIS2 building preview', () => {
  it('only exposes the three inspected DEV_ONLY facility pilots', () => {
    expect(Object.keys(TRELLIS_BUILDING_ASSETS).sort()).toEqual(['drilling', 'hydroponics', 'warehouse']);
    expect(Object.values(TRELLIS_BUILDING_ASSETS).every(url => url.endsWith('_trellis2_dev.glb'))).toBe(true);
  });

  it('keeps unapproved cleaned mesh candidates separate from inspected pilots', () => {
    expect(Object.keys(TRELLIS_BUILDING_CANDIDATES).sort()).toEqual(['agriculture', 'command', 'fusion', 'hospital', 'nanotech', 'research', 'school', 'security', 'silo', 'solar', 'tank', 'terraforming']);
    expect(Object.values(TRELLIS_BUILDING_CANDIDATES).every(url => url.endsWith('_zero_area_cleaned.glb'))).toBe(true);
  });

  it('fits a model to the requested display width and aligns its base at the Berlin reference site', () => {
    const geometry = new BoxGeometry(2, 1, 1);
    const material = new MeshStandardMaterial();
    const model = new Group();
    model.add(new Mesh(geometry, material));
    const placement = placeTrellisBuilding(model, 100);
    const normalization = placement.children[0];
    const earthRadiusMeters = EARTH_REFERENCE.radiusKm * 1000;
    const direction = new Vector3(...geographicVector(13.405, 52.52)).normalize();

    expect(normalization.scale.x * 2 * earthRadiusMeters).toBeCloseTo(100, 8);
    expect(normalization.position.y).toBeCloseTo(normalization.scale.y * 0.5, 12);
    expect(placement.position.distanceTo(direction.multiplyScalar(1.004))).toBeLessThan(1e-12);
    expect(new Box3().setFromObject(placement).isEmpty()).toBe(false);
  });

  it('rejects invalid models or widths and releases owned Three.js resources once', () => {
    expect(() => placeTrellisBuilding(null, 100)).toThrow(/model and a positive display width/);
    expect(() => placeTrellisBuilding(new Group(), 100)).toThrow(/visible bounds/);
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial();
    const model = new Mesh(geometry, material);
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const placement = placeTrellisBuilding(model, 100);

    disposeTrellisBuilding(placement);
    disposeTrellisBuilding(placement);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
