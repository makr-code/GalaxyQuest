import { describe, expect, it, vi } from 'vitest';

const {
  PersistentBodyPlanetApproachRenderer, planetViewProjection, projectSettlementMarkers, settlementOccluded,
} = require('../../js/engine/zoom/levels/PersistentBodyPlanetApproachRenderer.js');
const geometry = require('../../js/engine/zoom/levels/ColonySurfaceLevelWebGPU.js');

const manifest = {
  seed: 7, radius_km: 6371, biome: 'rock', amplitude_km: 0, persistence: 0.5,
  lacunarity: 2, octaves: 3, shape: { axes: [1, 1, 1], deformation: 0 },
};
function materialVertices(raw) {
  const result = new Float32Array(raw.length / 7 * 12);
  for (let src = 0, dst = 0; src < raw.length; src += 7, dst += 12) result.set(raw.subarray(src, src + 7), dst);
  return result;
}
const vertices = materialVertices(geometry.buildTerrainRegionSphereMesh(manifest, 28, 48).vertices);
const sites = {
  settlements: [
    { id: 'front', direction: [0, 0, 1], height: 0 },
    { id: 'back', direction: [0, 0, -1], height: 0 },
    { id: 'right', direction: [Math.sin(0.5), 0, Math.cos(0.5)], height: 0 },
  ],
};
const frame = () => ({
  rotation: 0, width: 800, height: 400, vertices, eye: [0, 0, 3], opacity: 1,
  matrix: planetViewProjection({ position: { x: 0, y: 0, z: 3 }, target: { x: 0, y: 0, z: 0 } }, 2, 3),
});
const project = overrides => projectSettlementMarkers(sites, manifest, { ...frame(), ...overrides }, geometry);

describe('Orbital settlement marker projection', () => {
  it('projects in CSS pixels and hides the rear hemisphere using the rendered surface', () => {
    const markers = project();
    expect(markers.map(marker => marker.id)).toEqual(['front', 'right']);
    expect(markers[0].x).toBeCloseTo(400);
    expect(markers[0].y).toBeCloseTo(200);
    expect(markers[1].x).toBeGreaterThan(400);
    expect(project({ width: 1600, height: 800 })[1].x).toBeCloseTo(markers[1].x * 2);
  });

  it('rotates canonical sites and occlusion with the same Y rotation as the shader', () => {
    expect(project({ rotation: Math.PI }).map(marker => marker.id)).toEqual(['back']);
    const quarter = project({ rotation: Math.PI / 2 });
    expect(quarter.map(marker => marker.id)).toEqual(['right']);
    expect(quarter[0].x).toBeLessThan(400);
  });

  it('uses the real target/pan and rejects behind-camera and clipped positions', () => {
    const camera = { position: { x: 0, y: 0, z: 3 }, target: { x: 0.3, y: 0, z: 0 } };
    expect(project({ matrix: planetViewProjection(camera, 2, 3) })[0].x).toBeLessThan(400);
    expect(project({ matrix: planetViewProjection({ position: camera.position, target: { x: 0, y: 0, z: 6 } }, 2, 3) })).toEqual([]);
    expect(project({ matrix: planetViewProjection(camera, 2, 3, 0.1, 1) })).toEqual([]);
    expect(project({ width: 0 })).toEqual([]);
    expect(project({ vertices: null })).toEqual([]);
  });

  it('detects an intervening lobe even for a front-facing site and tolerates its own surface', () => {
    const plane = materialVertices(new Float32Array([
      -1, -1, 2, 0, 0, 0, 0, 1, -1, 2, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0,
    ]));
    expect(settlementOccluded([0, 0, 3], [0, 0, 1], plane)).toBe(true);
    expect(settlementOccluded([0, 0, 3], [0, 0, 2], plane)).toBe(false);
    expect(settlementOccluded([0, 0, 3], [0, 0, 2.001], plane)).toBe(false);
    expect(project({ vertices: plane }).some(site => site.id === 'front')).toBe(false);
  });

  it.each([
    { shape: { axes: [0.8, 1.2, 0.7], deformation: 0 } },
    { solid: { version: 1, lobes: [{ axes: [1, 1, 1], center: [0, 0, 0] }], cuts: [], blend: 0.1 } },
  ])('uses the same body shape and solid radius functions as the surface geometry', extra => {
    const shaped = { ...manifest, ...extra };
    const surface = { ...geometry, bodyShapeFactor: vi.fn(geometry.bodyShapeFactor), bodySolidRadius: vi.fn(geometry.bodySolidRadius) };
    const mesh = materialVertices(geometry.buildTerrainRegionSphereMesh(shaped, 28, 48).vertices);
    const result = projectSettlementMarkers(sites, shaped, { ...frame(), vertices: mesh }, surface);
    expect(extra.solid ? surface.bodySolidRadius : surface.bodyShapeFactor).toHaveBeenCalledTimes(3);
    expect(result.find(site => site.id === 'front')).toMatchObject({ x: 400, y: 200 });
    expect(result.every(site => Number.isFinite(site.x) && Number.isFinite(site.y))).toBe(true);
  });
});

describe('View-owned orbital settlement controls', () => {
  function renderer(external = false, owned = true) {
    document.body.innerHTML = '<div style="position:relative"><canvas></canvas></div>';
    const level = new PersistentBodyPlanetApproachRenderer();
    level._canvas = document.querySelector('canvas');
    level._canvas.getBoundingClientRect = () => ({ left: 80, top: 50, width: 800, height: 400 });
    level._backend = { externalCameraControls: external, onSettlementSelect: vi.fn() };
    level._sceneData = { colony: owned ? { id: 8 } : null };
    level._surfacePlan = sites;
    level._terrainManifest = manifest;
    level._markerVertices = vertices;
    level._active = true;
    level._navigation = { surface: vi.fn() };
    level._mountSettlementMarkers();
    level._markerOverlay.getBoundingClientRect = () => ({ left: 30, top: 20 });
    level._updateSettlementMarkers(frame());
    return level;
  }

  it('provides accessible controls at canvas-relative coordinates and lands at the selected site', () => {
    const level = renderer();
    const marker = document.querySelector('[data-settlement-id="front"]');
    expect(marker.getAttribute('aria-label')).toContain('Primary settlement');
    expect(marker.style.left).toBe('450px');
    expect(marker.style.top).toBe('230px');
    expect(level.pickSettlement(480, 250)).toBe('front');
    expect(level.pickSettlement(5, 5)).toBeNull();
    marker.click();
    expect(level._navigation.surface).toHaveBeenCalledWith({
      colony: { id: 8 }, bodyTerrainManifest: manifest, settlement_id: 'front',
    });
    level._updateSettlementMarkers({ ...frame(), rotation: Math.PI });
    expect(marker.hidden).toBe(true);
    expect(level.visitSettlement('front')).toBe(false);
    expect(level.pickSettlement(480, 250)).toBe('back');
    level.dispose();
  });

  it('uses authorized external navigation, never the incomplete direct surface route', () => {
    const level = renderer(true);
    document.querySelector('[data-settlement-id="front"]').click();
    expect(level._backend.onSettlementSelect).toHaveBeenCalledExactlyOnceWith('front');
    expect(level._navigation.surface).not.toHaveBeenCalled();
    level.dispose();
  });

  it('shows foreign sites read-only without private building reads', () => {
    const level = renderer(true, false);
    const marker = document.querySelector('[data-settlement-id="front"]');
    expect(marker.disabled).toBe(true);
    marker.click();
    expect(level.pickSettlement(480, 250)).toBeNull();
    expect(level._backend.onSettlementSelect).not.toHaveBeenCalled();
    level.dispose();
  });

  it('labels retained ruined sites separately and still permits authorized visits', () => {
    const level = renderer(true);
    level._surfacePlan = { ...sites, settlements: sites.settlements.map(site => ({ ...site, ruined: true })) };
    level._updateSettlementMarkers(frame());
    const marker = document.querySelector('[data-settlement-id="front"]');
    expect(marker.getAttribute('aria-label')).toContain('(Ruinen)');
    expect(marker.style.borderColor).not.toBe('rgb(125, 255, 178)');
    marker.click();
    expect(level._backend.onSettlementSelect).toHaveBeenCalledExactlyOnceWith('front');
    level.dispose();
  });

  it('updates localized economic marker labels when the regional mix changes', () => {
    const level = renderer(true);
    level._surfaceModel = require('../../js/rendering/colony-surface-plan.js');
    level._surfacePlan = { ...sites, settlements: sites.settlements.map(site => ({ ...site, weights: [1, 0, 0] })) };
    level._updateSettlementMarkers(frame());
    const marker = document.querySelector('[data-settlement-id="front"]');
    expect(marker.getAttribute('aria-label')).toContain('Landwirtschaft');
    level._surfacePlan.settlements[0].weights = [0, 1, 0];
    level._updateSettlementMarkers(frame());
    expect(marker.title).toContain('Bergbau');
    expect(marker.title).not.toContain('Landwirtschaft');
    level._surfacePlan.settlements[0].ruined = true;
    level._updateSettlementMarkers(frame());
    expect(marker.title).toContain('(Ruinen)');
    expect(marker.title).not.toContain('Bergbau');
    level.dispose();
  });

  it('hides markers during backdrop rendering and fully releases handlers/UI on exit', async () => {
    const level = renderer();
    const marker = document.querySelector('[data-settlement-id="front"]');
    level._updateSettlementMarkers({ ...frame(), opacity: 0.9 });
    expect(marker.hidden).toBe(true);
    expect(level.pickSettlement(480, 250)).toBeNull();
    level._updateSettlementMarkers(frame());
    const remove = vi.spyOn(marker, 'removeEventListener');
    await level.exit();
    expect(remove).toHaveBeenCalledWith('click', marker.visitSettlement);
    expect(document.querySelector('[data-settlement-id]')).toBeNull();
    marker.click();
    expect(level._navigation.surface).not.toHaveBeenCalled();
    expect(level._settlementMarkers.size).toBe(0);
    expect(level._markerVertices).toBeNull();
    level.dispose();
  });

  it('drops old markers on a new snapshot and cannot pick a disposed view', () => {
    const level = renderer();
    level.setSceneData({ colony: { id: 8, population: 0 } });
    expect(level._settlementMarkers.size).toBe(0);
    expect(level.pickSettlement(480, 250)).toBeNull();
    level.dispose();
    expect(level.visitSettlement('front')).toBe(false);
  });
});
