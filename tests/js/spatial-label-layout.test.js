import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { resolveSpatialLabels } from '../../js/rendering/spatial-label-layout.js';

function body(type, position, radius, data = {}) {
  const object = new Object3D();
  object.position.copy(position);
  object.userData = { type, radius, data };
  object.updateMatrixWorld(true);
  return object;
}

describe('Spatial combat status labels', () => {
  it('keeps ordinary galaxy labels working when combat values are absent', () => {
    const camera = new PerspectiveCamera(60, 1000 / 800, 0.1, 1000);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const labels = resolveSpatialLabels({
      camera, bodies: [], origin: new Vector3(), spaceEntities: new Map(),
    }, [{ galaxy_index: 1, system_index: 10, x_ly: 0, y_ly: 0, z_ly: 0, name: 'Home' }],
    { width: 1000, height: 800 }).labels;
    expect(labels).toHaveLength(1);
    expect(labels[0].text).toBe('Home');
    expect(labels[0].metrics).toBeUndefined();
  });

  it('projects server status for in-scene artificial entities without inventing absent metrics', () => {
    const camera = new PerspectiveCamera(60, 1000 / 800, 0.1, 1000);
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const star = body('star', new Vector3(-10, 0, 0), 0.5);
    const planet = body('planet', new Vector3(3, 0, 0), 0.5, { position: 1 });
    const facility = body('facility', new Vector3(3, 4, 0), 0.2, {
      name: 'Relay', combat_status: { shield: { current: 6, maximum: 10 } },
    });
    facility.userData.parentPosition = 1;
    const ship = {
      id: 'fleet-1',
      kind: 'vessel',
      displayName: 'Fleet Alpha',
      combatStatus: { hull: { current: 60, maximum: 100 } },
      position: new Vector3(5, -4, 0),
      scale: 0.2,
    };
    const unnamedStatuslessEntity = {
      id: 'decorative',
      position: new Vector3(1, -3, 0),
      scale: 0.2,
    };
    const labels = resolveSpatialLabels({
      camera,
      bodies: [star, planet, facility],
      origin: new Vector3(),
      spaceEntities: new Map([[ship.id, ship], [unnamedStatuslessEntity.id, unnamedStatuslessEntity]]),
      cameraFollowEntity: ship,
      systemVisualizations: { selection: null },
    }, [], { width: 1000, height: 800 }).labels;

    const facilityLabel = labels.find((label) => label.id === 'facility:1:0');
    const shipLabel = labels.find((label) => label.id === 'entity:fleet-1');
    expect(facilityLabel?.metrics.map((metric) => [metric.key, metric.percent])).toEqual([['shield', 60]]);
    expect(shipLabel?.text).toBe('Fleet Alpha');
    expect(shipLabel?.metrics.map((metric) => [metric.key, metric.percent])).toEqual([['hull', 60]]);
    expect(shipLabel?.metrics.some((metric) => metric.key === 'armor')).toBe(false);
    expect(labels.some((label) => label.id === 'entity:decorative')).toBe(false);
  });
});
