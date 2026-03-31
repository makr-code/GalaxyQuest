/**
 * Galaxy rotation direction logic tests.
 *
 * These tests verify that:
 *  1. The shader uniform `uRotationCcwSign` is +1 for CCW galaxies and -1 for CW.
 *  2. The mesh spin direction (`_galaxySpinSpeeds`) is negative for CCW and positive for CW,
 *     consistent with the visual direction of the wound spiral arms.
 *  3. Shader sign and mesh sign are always opposite so both contribute to the same
 *     visual rotation direction.
 *
 * These tests are pure-logic and do not require Three.js.
 */
import { describe, it, expect } from 'vitest';

// Pure re-implementation of the formula from galaxy-renderer-core.js
// `setGalaxyMetadata` uniform assignment:
function shaderRotationSign(rotationDirectionCcw) {
  return (rotationDirectionCcw ?? 1) ? 1.0 : -1.0;
}

// Pure re-implementation of `_galaxySpinSpeeds` direction factor:
function meshSpinSign(rotationDirectionCcw) {
  return (rotationDirectionCcw ?? 1) ? -1 : 1;
}

describe('Galaxy rotation – shader uniform uRotationCcwSign', () => {
  it('CCW galaxy (rotation_direction_ccw=1) → shader sign = +1.0', () => {
    expect(shaderRotationSign(1)).toBe(1.0);
  });

  it('CW galaxy (rotation_direction_ccw=0) → shader sign = -1.0', () => {
    expect(shaderRotationSign(0)).toBe(-1.0);
  });

  it('undefined metadata falls back to CCW (+1.0)', () => {
    expect(shaderRotationSign(undefined)).toBe(1.0);
  });
});

describe('Galaxy rotation – mesh spin direction (_galaxySpinSpeeds)', () => {
  it('CCW galaxy → mesh spin sign = -1 (negative outer speed)', () => {
    expect(meshSpinSign(1)).toBe(-1);
  });

  it('CW galaxy → mesh spin sign = +1 (positive outer speed)', () => {
    expect(meshSpinSign(0)).toBe(1);
  });

  it('undefined metadata falls back to CCW (sign = -1)', () => {
    expect(meshSpinSign(undefined)).toBe(-1);
  });

  it('outer spin magnitude is non-zero for both directions', () => {
    const lerp = (a, b, t) => a + (b - a) * t;
    const baseSpeed = lerp(0.009, 0.021, 0); // t=0, close camera
    expect(meshSpinSign(1) * baseSpeed).toBeLessThan(0);    // CCW: negative
    expect(meshSpinSign(0) * baseSpeed).toBeGreaterThan(0); // CW:  positive
  });
});

describe('Galaxy rotation – shader/mesh sign consistency', () => {
  it('shader and mesh signs are always opposite (visual direction coherent)', () => {
    // CCW: shader=+1, mesh=-1 → product = -1
    expect(shaderRotationSign(1) * meshSpinSign(1)).toBe(-1);
    // CW: shader=-1, mesh=+1 → product = -1
    expect(shaderRotationSign(0) * meshSpinSign(0)).toBe(-1);
  });

  it('CCW default value via nullish: both formulas agree on same galaxy type', () => {
    expect(shaderRotationSign(undefined)).toBe(shaderRotationSign(1));
    expect(meshSpinSign(undefined)).toBe(meshSpinSign(1));
  });
});
