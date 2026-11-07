import { Vector3 } from 'three';

function screenTier(pixels, previous, hideTiny = true) {
  const thresholds = { near: 24, middle: 8, far: 1 };
  const tier = pixels >= 24 ? 'near' : pixels >= 8 ? 'middle' : pixels >= 1 || !hideTiny ? 'far' : 'hidden';
  const order = ['hidden', 'far', 'middle', 'near'];
  if (previous && previous !== 'hidden' && tier !== 'hidden') {
    const boundary = thresholds[order[Math.max(order.indexOf(previous), order.indexOf(tier))]];
    if (previous !== tier && Math.abs(pixels - boundary) < boundary * 0.15) return previous;
  }
  return tier;
}

// Screen-space thresholds use GPU backing pixels, not galactic distances.
export function fleetVisualLod(position, scale, camera, origin, height, previous = null) {
  const view = position.clone().sub(origin).sub(camera.position)
    .applyQuaternion(camera.quaternion.clone().invert());
  const depth = -view.z;
  const radius = scale;
  const projection = camera.projectionMatrix.elements;
  if (depth + radius < camera.near || depth - radius > camera.far
    || Math.abs(view.x) > (Math.max(depth, camera.near) + radius) / projection[0] + radius
    || Math.abs(view.y) > (Math.max(depth, camera.near) + radius) / projection[5] + radius) {
    return { tier: 'hidden', pixels: 0 };
  }
  const pixels = scale * projection[5] * height / Math.max(depth, camera.near);
  return { tier: screenTier(pixels, previous), pixels };
}

export function visibleWeaponPrimitive(primitive, camera, origin, width, height) {
  const inverse = camera.quaternion.clone().invert();
  const from = primitive.from.clone().sub(origin).sub(camera.position).applyQuaternion(inverse);
  const to = primitive.to.clone().sub(origin).sub(camera.position).applyQuaternion(inverse);
  if (from.z >= -camera.near || to.z >= -camera.near) return false;
  if (-from.z > camera.far && -to.z > camera.far) return false;
  const projection = camera.projectionMatrix.elements;
  const padX = primitive.width * 2 / width;
  const padY = primitive.width * 2 / height;
  for (const [axis, factor, pad] of [['x', projection[0], padX], ['y', projection[5], padY]]) {
    const a = from[axis] * factor / -from.z;
    const b = to[axis] * factor / -to.z;
    if (Math.min(a, b) > 1 + pad || Math.max(a, b) < -1 - pad) return false;
  }
  return true;
}

export function simplifyWeaponPrimitives(effect, primitives, tier) {
  if (tier === 'near') return primitives;
  if (effect.charge || tier === 'hidden' || !primitives.length) return [];
  if (effect.profile?.mode === 'missile' && primitives[0].shape === 0) {
    const ribbons = primitives.filter((primitive) => primitive.shape === 0);
    const nose = ribbons.at(-1);
    if (tier === 'far' || ribbons.length === 1) return [nose];
    return [{ ...ribbons[0], to: ribbons[0].to.clone(),
      from: ribbons.at(-2).from.clone() }, nose];
  }
  if (tier === 'far') {
    const cue = primitives.find((primitive) => primitive.shape === 1) || primitives[0];
    return [{ ...cue, width: Math.min(cue.width, 3) }];
  }
  return primitives.slice(0, 2);
}

export function weaponVisualLod(effect, primitives, camera, origin, height) {
  if (!primitives.length) return { tier: 'hidden', pixels: 0 };
  const center = new Vector3().addVectors(primitives[0].from, primitives[0].to).multiplyScalar(0.5);
  const view = center.sub(origin).sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());
  const pixels = (effect.source?.scale || 1e-12) * camera.projectionMatrix.elements[5] * height
    / Math.max(-view.z, camera.near);
  const result = { tier: screenTier(pixels, effect.visualTier, false), pixels };
  effect.visualTier = result.tier;
  return result;
}
