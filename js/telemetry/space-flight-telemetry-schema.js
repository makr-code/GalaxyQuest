/*
 * Space Flight Telemetry Schema
 * Unified telemetry definition for flight drivers and trajectory planners.
 * Ensures consistent field semantics across all flight modules.
 *
 * @typedef {Object} GQSpaceFlightTelemetry
 * @property {string} phase - Navigation state: 'idle', 'acquire', 'cruise', 'approach', 'brake', 'complete'
 * @property {number} targetId - Target system ID (0 = no active target)
 * @property {string} targetLabel - Target system name/label ('----' if none)
 * @property {number} progress - [0, 1] Bezier curve parameter (0=start, 1=destination), NOT time-based
 * @property {number} distance - LY, remaining distance to target (0 on completion)
 * @property {number} eta - Seconds, estimated time to arrival (0 if distance=0)
 * @property {number} speed - LY/s, smoothed velocity via exponential moving average
 * @property {number} speedRaw - LY/s, unsmoothed instantaneous velocity (diagnostic)
 *
 * SEMANTICS:
 *   - phase: Authoritative source is GQSpaceCameraFlightDriver._navigationState
 *   - progress: Bezier curve parameter from GQTrajectoryPlanner, independent of elapsed time
 *   - speed: Smoothed in FlightDriver (lerp factor 0.22) to reduce visual jitter
 *   - distance: Recalculated each frame from current position to target
 *   - eta: Simple division (distance / max(speed, 1.0)) with 0 guards
 *   - targetId, targetLabel: Set by caller via setTarget(), not by planner
 */

const GQSpaceFlightTelemetrySchema = {
  VERSION: '1.0.0',

  /**
   * Creates an empty telemetry snapshot with all fields initialized.
   * @returns {GQSpaceFlightTelemetry}
   */
  createEmpty() {
    return {
      phase: 'idle',
      targetId: 0,
      targetLabel: '----',
      progress: 0,
      distance: 0,
      eta: 0,
      speed: 0,
      speedRaw: 0,
    };
  },

  /**
   * Validates a telemetry object against schema constraints.
   * Returns { ok: boolean, errors: string[] }
   * @param {Object} telemetry
   * @returns {Object}
   */
  validate(telemetry) {
    const errors = [];

    if (!telemetry) {
      return { ok: false, errors: ['Telemetry object is null/undefined'] };
    }

    const allowedPhases = new Set(['idle', 'acquire', 'cruise', 'approach', 'brake', 'complete']);
    if (!allowedPhases.has(String(telemetry.phase || '').toLowerCase())) {
      errors.push(`Invalid phase: "${telemetry.phase}". Must be one of: ${Array.from(allowedPhases).join(', ')}`);
    }

    const targetId = Number(telemetry.targetId);
    if (!Number.isFinite(targetId) || targetId < 0) {
      errors.push(`Invalid targetId: ${telemetry.targetId}. Must be non-negative number.`);
    }

    const targetLabel = String(telemetry.targetLabel || '').trim();
    if (targetLabel.length === 0) {
      errors.push(`Invalid targetLabel: empty string. Must be non-empty.`);
    }

    const progress = Number(telemetry.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      errors.push(`Invalid progress: ${telemetry.progress}. Must be [0, 1].`);
    }

    const distance = Number(telemetry.distance);
    if (!Number.isFinite(distance) || distance < 0) {
      errors.push(`Invalid distance: ${telemetry.distance}. Must be >= 0.`);
    }

    const eta = Number(telemetry.eta);
    if (!Number.isFinite(eta) || eta < 0) {
      errors.push(`Invalid eta: ${telemetry.eta}. Must be >= 0.`);
    }

    const speed = Number(telemetry.speed);
    if (!Number.isFinite(speed) || speed < 0) {
      errors.push(`Invalid speed: ${telemetry.speed}. Must be >= 0.`);
    }

    const speedRaw = Number(telemetry.speedRaw);
    if (!Number.isFinite(speedRaw) || speedRaw < 0) {
      errors.push(`Invalid speedRaw: ${telemetry.speedRaw}. Must be >= 0.`);
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  },

  /**
   * Normalizes telemetry object to schema:
   * - Coerces types, applies defaults, clamps values
   * - Does NOT fail on validation errors (permissive)
   * @param {Object} telemetry
   * @returns {GQSpaceFlightTelemetry}
   */
  normalize(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') {
      return this.createEmpty();
    }

    const allowedPhases = new Set(['idle', 'acquire', 'cruise', 'approach', 'brake', 'complete']);
    const phase = String(telemetry.phase || 'idle').toLowerCase();
    const normalizedPhase = allowedPhases.has(phase) ? phase : 'idle';

    const targetId = Math.max(0, Number(telemetry.targetId) || 0);
    const targetLabel = String(telemetry.targetLabel || '----').trim() || '----';

    const progress = Math.max(0, Math.min(1, Number(telemetry.progress) || 0));
    const distance = Math.max(0, Number(telemetry.distance) || 0);
    const speed = Math.max(0, Number(telemetry.speed) || 0);
    const speedRaw = Math.max(0, Number(telemetry.speedRaw) || 0);
    const eta = distance > 0 && speed > 0 ? (distance / speed) : 0;

    return {
      phase: normalizedPhase,
      targetId,
      targetLabel,
      progress,
      distance,
      eta,
      speed,
      speedRaw,
    };
  },

  /**
   * Serializes telemetry to JSON-safe format (e.g., for API transport).
   * Filters out undefined/null, rounds numeric values.
   * @param {GQSpaceFlightTelemetry} telemetry
   * @returns {Object}
   */
  serialize(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') {
      return null;
    }

    const normalized = this.normalize(telemetry);
    return {
      phase: normalized.phase,
      targetId: Number(normalized.targetId),
      targetLabel: normalized.targetLabel,
      progress: Number(normalized.progress.toFixed(4)),
      distance: Number(normalized.distance.toFixed(2)),
      eta: Number(normalized.eta.toFixed(2)),
      speed: Number(normalized.speed.toFixed(3)),
      speedRaw: Number(normalized.speedRaw.toFixed(3)),
    };
  },

  /**
   * Compares two telemetry objects for field equality (with numeric tolerance).
   * Useful for detecting meaningful changes vs. floating-point noise.
   * @param {GQSpaceFlightTelemetry} a
   * @param {GQSpaceFlightTelemetry} b
   * @param {Object} opts - { tolerance: number } default 1e-3
   * @returns {boolean}
   */
  areEqual(a, b, opts = {}) {
    if (!a || !b) return a === b;

    const tol = Number(opts.tolerance) || 1e-3;
    return (
      a.phase === b.phase &&
      a.targetId === b.targetId &&
      a.targetLabel === b.targetLabel &&
      Math.abs((a.progress || 0) - (b.progress || 0)) < tol &&
      Math.abs((a.distance || 0) - (b.distance || 0)) < tol &&
      Math.abs((a.eta || 0) - (b.eta || 0)) < tol &&
      Math.abs((a.speed || 0) - (b.speed || 0)) < tol &&
      Math.abs((a.speedRaw || 0) - (b.speedRaw || 0)) < tol
    );
  },

  /**
   * Compares phase field only. Useful for state-change detection.
   * @param {string} phaseA
   * @param {string} phaseB
   * @returns {boolean}
   */
  phaseChanged(phaseA, phaseB) {
    return String(phaseA).toLowerCase() !== String(phaseB).toLowerCase();
  },

  /**
   * Returns human-readable description of telemetry state.
   * @param {GQSpaceFlightTelemetry} telemetry
   * @returns {string}
   */
  describe(telemetry) {
    if (!telemetry) return '(null)';

    const parts = [
      `phase=${telemetry.phase}`,
      `target=${telemetry.targetLabel}(${telemetry.targetId})`,
      `progress=${(telemetry.progress * 100).toFixed(1)}%`,
      `distance=${telemetry.distance.toFixed(1)}LY`,
      `eta=${telemetry.eta.toFixed(1)}s`,
      `speed=${telemetry.speed.toFixed(2)}LY/s`,
    ];
    return `[${parts.join(', ')}]`;
  },
};

// Export to global namespace
if (typeof window !== 'undefined') {
  window.GQSpaceFlightTelemetrySchema = GQSpaceFlightTelemetrySchema;
}

// Export as module if in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GQSpaceFlightTelemetrySchema;
}
