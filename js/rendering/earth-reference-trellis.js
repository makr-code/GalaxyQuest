import { Box3, Group, Matrix4, Vector3 } from 'three';
import { EARTH_REFERENCE, geographicVector } from './earth-reference-geography.js';

const EARTH_RADIUS_METERS = EARTH_REFERENCE.radiusKm * 1000;
const BUILDING_SITE_RADIUS = 1.004;
const disposedBuildings = new WeakSet();

export const TRELLIS_BUILDING_ASSETS = Object.freeze({
  warehouse: new URL('../../generated/trellis2/imported/building/building_generic_warehouse_pilot_v2_normals_lod0_trellis2_dev.glb', import.meta.url).href,
  drilling: new URL('../../generated/trellis2/imported/building/building_generic_drilling_pilot_v2_normals_lod0_trellis2_dev.glb', import.meta.url).href,
  hydroponics: new URL('../../generated/trellis2/imported/building/building_generic_hydroponics_pilot_v2_normals_lod0_trellis2_dev.glb', import.meta.url).href,
});

export const TRELLIS_BUILDING_CANDIDATES = Object.freeze({
  agriculture: new URL('../../generated/comfyui/output/gq_trellis2/building_agriculture_pilot_v1_00002__zero_area_cleaned.glb', import.meta.url).href,
  command: new URL('../../generated/comfyui/output/gq_trellis2/building_command_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  fusion: new URL('../../generated/comfyui/output/gq_trellis2/building_fusion_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  industry: new URL('../../generated/comfyui/output/gq_trellis2/building_industry_pilot_v1_00002__zero_area_cleaned.glb', import.meta.url).href,
  industry_512: new URL('../../generated/comfyui/output/gq_trellis2/building_industry_pilot_v1_00003__zero_area_cleaned.glb', import.meta.url).href,
  industry_512_no_meshlib: new URL('../../generated/comfyui/output/gq_trellis2/building_industry_pilot_v1_00004__zero_area_cleaned.glb', import.meta.url).href,
  nanotech: new URL('../../generated/comfyui/output/gq_trellis2/building_nanotech_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  research: new URL('../../generated/comfyui/output/gq_trellis2/building_research_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  school: new URL('../../generated/comfyui/output/gq_trellis2/building_school_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  security: new URL('../../generated/comfyui/output/gq_trellis2/building_security_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  solar: new URL('../../generated/comfyui/output/gq_trellis2/building_solar_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  tank: new URL('../../generated/comfyui/output/gq_trellis2/building_tank_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  silo: new URL('../../generated/comfyui/output/gq_trellis2/building_silo_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  hospital: new URL('../../generated/comfyui/output/gq_trellis2/building_hospital_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
  terraforming: new URL('../../generated/comfyui/output/gq_trellis2/building_terraforming_pilot_v1_00001__zero_area_cleaned.glb', import.meta.url).href,
});

export function placeTrellisBuilding(scene, widthMeters) {
  if (!scene || !Number.isFinite(widthMeters) || widthMeters <= 0) {
    throw new TypeError('TRELLIS2 preview requires a model and a positive display width');
  }
  scene.removeFromParent();
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  if (bounds.isEmpty()) throw new TypeError('TRELLIS2 preview model has no visible bounds');
  const size = bounds.getSize(new Vector3());
  const horizontalExtent = Math.max(size.x, size.z);
  if (!Number.isFinite(horizontalExtent) || horizontalExtent <= 0 || !Number.isFinite(bounds.min.y)) {
    throw new TypeError('TRELLIS2 preview model has invalid bounds');
  }
  const scale = widthMeters / (horizontalExtent * EARTH_RADIUS_METERS);
  const center = bounds.getCenter(new Vector3());
  const normalization = new Group();
  normalization.scale.setScalar(scale);
  normalization.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  normalization.add(scene);

  const placement = new Group();
  const upValues = geographicVector(13.405, 52.52);
  const up = new Vector3(...upValues).normalize();
  const east = new Vector3(-up.z, 0, up.x).normalize();
  const south = new Vector3().crossVectors(east, up).normalize();
  placement.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(east, up, south));
  placement.position.copy(up).multiplyScalar(BUILDING_SITE_RADIUS);
  placement.add(normalization);
  return placement;
}

export function disposeTrellisBuilding(root) {
  if (!root || disposedBuildings.has(root)) return;
  disposedBuildings.add(root);
  root.removeFromParent();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
