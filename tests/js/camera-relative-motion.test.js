import { describe, expect, it } from 'vitest';
import { measureCameraRelativeMotion } from '../../js/rendering/camera-relative-motion.js';

describe('camera-relative motion signal', () => {
  it('stays idle when position, rotation, zoom and telemetry do not change', () => {
    const motion = measureCameraRelativeMotion({ deltaSeconds: 1 / 60 });
    expect(motion.speedNorm).toBe(0);
    expect(motion.opticalSpeed).toBe(0);
  });

  it('reacts to translation, camera rotation, and zoom independently', () => {
    expect(measureCameraRelativeMotion({
      positionDelta: { x: 0.5, y: 0, z: 0 }, deltaSeconds: 0.5,
    }).speedNorm).toBeGreaterThan(0.9);
    expect(measureCameraRelativeMotion({
      rotationDelta: { x: 0, y: 0.1, z: 0 }, deltaSeconds: 0.5,
    }).speedNorm).toBeGreaterThan(0.9);
    expect(measureCameraRelativeMotion({
      zoomRatio: 1.3, deltaSeconds: 0.5,
    }).speedNorm).toBeGreaterThan(0.9);
  });

  it('normalizes measured translation, rotation, and zoom to a bounded signal', () => {
    const motion = measureCameraRelativeMotion({
      positionDelta: { x: 0.2, y: 0.1, z: 0 },
      rotationDelta: { x: 0, y: 0.02, z: 0 },
      deltaSeconds: 0.1,
    });
    expect(motion.speedNorm).toBe(1);
    expect(motion.translationSpeed).toBeGreaterThan(0);
    expect(motion.opticalSpeed).toBeGreaterThan(motion.translationSpeed);
    expect(measureCameraRelativeMotion({ deltaSeconds: 1 / 60, telemetrySpeed: 1 }).speedNorm).toBe(0);
  });
});