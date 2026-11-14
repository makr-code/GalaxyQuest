import { Quaternion, Vector3 } from 'three';

export const COMET_PARTICLE_COUNT = 384;
export const COMET_ION_PARTICLE_COUNT = 192;
export const COMET_COMA_PARTICLE_COUNT = 96;
export const COMET_STAR_RANGE_LY = 100 / 63241.07708426628;

export function createCometTail() {
  return Array.from({ length: COMET_PARTICLE_COUNT }, (_, index) => ({
    phase: (index * 0.7548776662466927) % 1,
    angle: index * 2.399963229728653,
    spread: 0.06 + ((index * 0.414213562373095) % 1) * 0.12,
  }));
}

export function createCometIonTail() {
  return Array.from({ length: COMET_ION_PARTICLE_COUNT }, (_, index) => ({
    phase: (index * 0.618033988749895) % 1,
    strand: index % 5,
  }));
}

export function resolveCometTailAxes(entity, starPosition) {
  const forward = entity.getForwardDirection();
  const axis = starPosition ? entity.position.clone().sub(starPosition) : forward.clone().negate();
  const nearStar = starPosition && axis.lengthSq() > 0
    && axis.lengthSq() <= COMET_STAR_RANGE_LY ** 2;
  const fallback = forward.clone().negate().normalize();
  if (nearStar) {
    const distance = axis.length();
    axis.normalize();
    const weight = Math.max(0, Math.min(1, (COMET_STAR_RANGE_LY - distance) / (COMET_STAR_RANGE_LY * 0.5)));
    const rotation = new Quaternion().setFromUnitVectors(fallback, axis);
    axis.copy(fallback).applyQuaternion(new Quaternion().slerp(rotation, weight));
  } else axis.copy(fallback);
  const sideways = forward.clone().addScaledVector(axis, -forward.dot(axis)).negate();
  const reference = Math.abs(axis.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const side = new Vector3().crossVectors(axis, reference).normalize();
  const up = new Vector3().crossVectors(axis, side).normalize();
  return { axis, sideways, side, up, nearStar: !!nearStar };
}

export function createCometComa() {
  return Array.from({ length: COMET_COMA_PARTICLE_COUNT }, (_, index) => ({
    phase: (index * 0.618033988749895) % 1,
    angle: index * 2.399963229728653,
    height: 1 - 2 * ((index * 0.7548776662466927) % 1),
    size: (index * 0.5698402909980532) % 1,
  }));
}

export function sampleCometComaParticle(particle, entity, time, result = new Vector3()) {
  const age = (particle.phase + time * 0.05) % 1;
  const radius = 0.62 + age * 1.8;
  const angle = particle.angle + time * (0.25 + particle.phase * 0.3);
  const ring = Math.sqrt(1 - particle.height * particle.height);
  result.set(Math.cos(angle) * ring, Math.sin(angle) * ring, particle.height)
    .multiplyScalar(radius * entity.scale).applyQuaternion(entity.quaternion).add(entity.position);
  return { position: result, radius: entity.scale * (0.008 + particle.size * 0.018),
    opacity: (0.16 + particle.size * 0.16) * Math.min(1, (1 - age) * 5) };
}

export function sampleCometParticle(particle, entity, time, axes, result = new Vector3()) {
  const age = (particle.phase + time * 0.16) % 1;
  const length = 1.2 + age * 38;
  const spread = length * particle.spread;
  result.copy(entity.position).addScaledVector(axes.axis, length * entity.scale)
    .addScaledVector(axes.sideways, age * age * 14 * entity.scale)
    .addScaledVector(axes.side, Math.cos(particle.angle + age) * spread * entity.scale)
    .addScaledVector(axes.up, Math.sin(particle.angle + age) * spread * entity.scale);
  return { position: result, radius: entity.scale * (0.025 + age * 0.09), opacity: (1 - age) * 0.48 };
}

export function sampleCometIonParticle(particle, entity, time, axes, result = new Vector3()) {
  const age = (particle.phase + time * 0.22) % 1;
  const length = 1.4 + age * 56;
  const wave = Math.sin(age * 8 + time * 0.8 + particle.strand * 1.7);
  result.copy(entity.position).addScaledVector(axes.axis, length * entity.scale)
    .addScaledVector(axes.side, ((particle.strand - 2) * 0.15 + wave * age * 0.5) * entity.scale)
    .addScaledVector(axes.up, Math.cos(particle.strand * 2.4 + age * 6) * age * 0.35 * entity.scale);
  return { position: result, radius: entity.scale * (0.045 + age * 0.12), opacity: (1 - age) * 0.42 };
}
