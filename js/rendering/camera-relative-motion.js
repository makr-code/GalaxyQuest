function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function measureCameraRelativeMotion({
  positionDelta = {},
  rotationDelta = {},
  zoomRatio = 1,
  deltaSeconds = 1 / 60,
}) {
  const dt = clamp(Number(deltaSeconds) || 0, 0.001, 0.1);
  const dx = Number(positionDelta.x) || 0;
  const dy = Number(positionDelta.y) || 0;
  const dz = Number(positionDelta.z) || 0;
  const translationSpeed = Math.hypot(dx, dy, dz) / dt;
  const angularSpeed = Math.hypot(
    Number(rotationDelta.x) || 0,
    Number(rotationDelta.y) || 0,
    Number(rotationDelta.z) || 0
  ) / dt;
  const zoomRate = Math.abs(Math.log(Math.max(0.01, Number(zoomRatio) || 1))) / dt;

  const translationSignal = translationSpeed / 1.0;
  const rotationSignal = angularSpeed / 0.18;
  const zoomSignal = zoomRate / 0.35;
  const speedNorm = clamp(Math.max(
    translationSignal,
    rotationSignal,
    zoomSignal
  ), 0, 1);

  return {
    speedNorm,
    translationSpeed,
    angularSpeed,
    zoomRate,
    opticalSpeed: Math.max(translationSpeed, angularSpeed * 180, zoomRate * 100),
  };
}