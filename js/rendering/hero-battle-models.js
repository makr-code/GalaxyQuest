import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';

export const HERO_SHIP_PROFILES = Object.freeze({
  carrier: { label: 'Traeger', role: 'carrier', scale: 2.2, range: 9, excursion: 0.12,
    period: 20, weapons: ['missile', 'photon'], shotPeriod: 126, destruction: 'cruiser' },
  battlecruiser: { label: 'Schlachtkreuzer', role: 'standoff', scale: 1.65, range: 6.8, excursion: 0.35,
    period: 16, weapons: ['railgun', 'plasma', 'laser'], shotPeriod: 96, destruction: 'cruiser' },
  corvette: { label: 'Korvette', role: 'hit-and-run', scale: 0.65, range: 4, excursion: 2.5,
    period: 4.2, weapons: ['photon', 'missile', 'ballistic'], shotPeriod: 66, destruction: 'frigate' },
  fighter: { label: 'Jaeger', role: 'interceptor', scale: 0.28, range: 2.8, excursion: 3.4,
    period: 2.8, weapons: ['ballistic', 'laser'], shotPeriod: 42, destruction: 'frigate' },
});

const MIXED_WING = ['carrier', 'battlecruiser', 'corvette', 'fighter', 'battlecruiser', 'corvette',
  'fighter', 'corvette', 'fighter', 'fighter', 'fighter', 'fighter'];

export function heroShipClassAt(index, shipCount, formation = 'classic') {
  if (!Number.isInteger(index) || !Number.isInteger(shipCount) || shipCount < 4 || shipCount % 2
    || index < 0 || index >= shipCount || !['classic', 'mixed'].includes(formation)) {
    throw new TypeError('Invalid hero formation slot');
  }
  return formation === 'mixed' ? MIXED_WING[(index % (shipCount / 2)) % MIXED_WING.length]
    : index % 2 ? 'cruiser' : 'frigate';
}

export const HERO_DESTRUCTION_PROFILES = Object.freeze({
  frigate: Object.freeze({
    detonations: Object.freeze([{ delay: 0, offset: [0, 0, 0], size: 0.7, duration: 0.9 }]),
    fireOffsets: Object.freeze([[-0.15, 0.12, 0.12]]),
    majorFragments: 0,
  }),
  cruiser: Object.freeze({
    detonations: Object.freeze([
      { delay: 0, offset: [-0.3, 0, 0], size: 0.7, duration: 0.8 },
      { delay: 0.3, offset: [0.28, 0.08, 0], size: 0.9, duration: 1 },
      { delay: 0.65, offset: [0, 0, 0], size: 1.6, duration: 1.8 },
      { delay: 1, offset: [-0.15, -0.12, 0.08], size: 0.8, duration: 0.9 },
    ]),
    fireOffsets: Object.freeze([[-0.3, 0.1, 0.1], [0.25, -0.12, 0.08], [0, 0.2, 0]]),
    majorFragments: 3,
  }),
});

export function createHeroBattleModel(kind) {
  if (!['frigate', 'cruiser'].includes(kind) && !Object.hasOwn(HERO_SHIP_PROFILES, kind)) {
    throw new TypeError('Unknown hero ship class');
  }
  const root = new Group();
  const cruiser = ['cruiser', 'carrier', 'battlecruiser'].includes(kind);
  const hull = new MeshStandardMaterial({ color: cruiser ? 0x687787 : 0x426e86, metalness: 0.7, roughness: 0.35 });
  const armor = new MeshStandardMaterial({ color: cruiser ? 0xadb3ba : 0x82bed1, metalness: 0.5, roughness: 0.4 });
  const add = (geometry, material, position, parent = root) => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };
  if (kind === 'carrier') {
    add(new BoxGeometry(4, 0.65, 0.6), hull, [0, -0.95, 0]);
    add(new BoxGeometry(4, 0.65, 0.6), hull, [0, 0.95, 0]);
    add(new BoxGeometry(1.1, 2.3, 0.4), armor, [-1.3, 0, 0]);
    add(new BoxGeometry(0.8, 0.6, 0.75), armor, [-0.9, 0.95, 0.45]);
    const hangar = new MeshStandardMaterial({ color: 0x59cfff, emissive: 0x59cfff, emissiveIntensity: 1.5 });
    add(new BoxGeometry(2.8, 0.06, 0.08), hangar, [0.2, -0.59, 0.3]);
    add(new BoxGeometry(2.8, 0.06, 0.08), hangar, [0.2, 0.59, 0.3]);
  } else if (kind === 'fighter') {
    add(new BoxGeometry(2.4, 0.3, 0.25), hull, [0.3, 0, 0]);
    const wingA = add(new BoxGeometry(1.3, 1.4, 0.08), armor, [-0.35, -0.8, 0]);
    const wingB = add(new BoxGeometry(1.3, 1.4, 0.08), armor, [-0.35, 0.8, 0]);
    wingA.rotation.z = -0.4;
    wingB.rotation.z = 0.4;
    add(new BoxGeometry(0.6, 0.25, 0.2), armor, [0.45, 0, 0.2]);
  } else {
    add(new BoxGeometry(4, cruiser ? 1.65 : kind === 'corvette' ? 0.5 : 0.75, 0.55), hull, [0, 0, 0]);
    add(new BoxGeometry(2.1, cruiser ? 1.9 : kind === 'corvette' ? 0.75 : 1.15, 0.18), armor, [-0.3, 0, -0.3]);
    add(new BoxGeometry(0.65, 0.55, cruiser ? 0.55 : 0.3), armor, [-1, 0, 0.4]);
    if (kind === 'battlecruiser') {
      add(new BoxGeometry(2.6, 0.3, 0.25), armor, [-0.2, -1, 0]);
      add(new BoxGeometry(2.6, 0.3, 0.25), armor, [-0.2, 1, 0]);
      add(new BoxGeometry(1.4, 0.7, 0.35), armor, [-0.6, 0, 0.6]);
    }
  }
  const turret = new Group();
  turret.name = 'turret_primary';
  turret.userData.weaponTurret = true;
  turret.position.set(0.3, 0, 0.38);
  const base = add(new CylinderGeometry(0.23, 0.3, 0.18, 12), armor, [0, 0, 0], turret);
  base.rotation.x = Math.PI / 2;
  add(new BoxGeometry(0.7, 0.32, 0.2), armor, [0.18, 0, 0.12], turret);
  add(new BoxGeometry(0.8, 0.07, 0.07), hull, [0.65, -0.11, 0.12], turret);
  add(new BoxGeometry(0.8, 0.07, 0.07), hull, [0.65, 0.11, 0.12], turret);
  const muzzle = new Object3D();
  muzzle.name = 'muzzle_primary';
  muzzle.position.set(1.05, -0.11, 0.12);
  turret.add(muzzle);
  root.add(turret);
  return root;
}

export function aimHeroTurret(entity, targetPosition, deltaSeconds, recoil = 0) {
  const rig = entity.weaponRig;
  if (!rig || !Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(recoil)) {
    throw new TypeError('Invalid hero turret state');
  }
  const localAim = targetPosition.clone().sub(entity.position)
    .applyQuaternion(entity.quaternion.clone().invert()).divideScalar(entity.scale).sub(rig.pivot);
  const yaw = Math.atan2(localAim.y, localAim.x);
  const pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4,
    Math.atan2(localAim.z, Math.hypot(localAim.x, localAim.y))));
  const direction = new Vector3(Math.cos(yaw) * Math.cos(pitch),
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
  const desired = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction);
  entity.turretQuaternion ||= new Quaternion();
  entity.turretQuaternion.rotateTowards(desired, Math.min(deltaSeconds, 0.1) * Math.PI * 2);
  const muzzleOffset = rig.muzzle.clone().add(new Vector3(-Math.max(0, Math.min(0.04, recoil)), 0, 0));
  const position = rig.pivot.clone().multiplyScalar(entity.scale).applyQuaternion(entity.quaternion).add(entity.position);
  const quaternion = entity.quaternion.clone().multiply(entity.turretQuaternion);
  return { position, quaternion, scale: entity.scale, muzzleOffset };
}
