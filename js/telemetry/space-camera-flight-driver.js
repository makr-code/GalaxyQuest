/*
 * Space Camera Flight Driver
 * Reusable camera driver for Galaxy3DRenderer cinematic flights.
 */
(function () {
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function cubicBezier1D(a, b, c, d, t) {
    const mt = 1 - t;
    return (mt * mt * mt * a)
      + (3 * mt * mt * t * b)
      + (3 * mt * t * t * c)
      + (t * t * t * d);
  }

  class SpaceCameraFlightDriver {
    constructor(options = {}) {
      this.THREE = options.three || window.THREE;
      this.onTelemetry = typeof options.onTelemetry === 'function' ? options.onTelemetry : null;
      this.consumeAutoNav = options.consumeAutoNav !== false;
      this.updateControls = options.updateControls !== false;
      this.priority = Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0;
      this.physicsFactory = window.GQSpacePhysicsEngine;
      const tuning = options.physicsTuning && typeof options.physicsTuning === 'object'
        ? options.physicsTuning
        : {};
      this.physicsTuning = {
        gravitationalConstant: Number.isFinite(Number(tuning.gravitationalConstant)) ? Number(tuning.gravitationalConstant) : 9.5e-4,
        softening: Number.isFinite(Number(tuning.softening)) ? Number(tuning.softening) : 140,
        maxAcceleration: Number.isFinite(Number(tuning.maxAcceleration)) ? Number(tuning.maxAcceleration) : 560,
        defaultDrag: Number.isFinite(Number(tuning.defaultDrag)) ? Number(tuning.defaultDrag) : 0.002,
      };
      const constraints = options.motionConstraints && typeof options.motionConstraints === 'object'
        ? options.motionConstraints
        : {};
      this.motionConstraints = {
        maxSpeedLyPerSec: Number.isFinite(Number(constraints.maxSpeedLyPerSec))
          ? Math.max(0.05, Number(constraints.maxSpeedLyPerSec))
          : 1,
        maxLinearAccel: Number.isFinite(Number(constraints.maxLinearAccel))
          ? Math.max(0.01, Number(constraints.maxLinearAccel))
          : 0.16,
        maxBrakeAccel: Number.isFinite(Number(constraints.maxBrakeAccel))
          ? Math.max(0.01, Number(constraints.maxBrakeAccel))
          : 0.24,
        maxThrustAccel: Number.isFinite(Number(constraints.maxThrustAccel))
          ? Math.max(0.01, Number(constraints.maxThrustAccel))
          : 0.28,
        headingSmoothing: Number.isFinite(Number(constraints.headingSmoothing))
          ? Math.max(0.1, Number(constraints.headingSmoothing))
          : 2.1,
        rollResponsiveness: Number.isFinite(Number(constraints.rollResponsiveness))
          ? Math.max(0.1, Number(constraints.rollResponsiveness))
          : 2.3,
        maneuverStrength: Number.isFinite(Number(constraints.maneuverStrength))
          ? Math.max(0, Number(constraints.maneuverStrength))
          : 0.075,
        maneuverFrequency: Number.isFinite(Number(constraints.maneuverFrequency))
          ? Math.max(0.05, Number(constraints.maneuverFrequency))
          : 0.18,
      };
      this.telemetrySchema = window.GQSpaceFlightTelemetrySchema || null;
      // Initialize telemetry using schema if available, else fallback to manual definition
      this.telemetry = (this.telemetrySchema && typeof this.telemetrySchema.createEmpty === 'function')
        ? this.telemetrySchema.createEmpty()
        : {
          phase: 'idle',
          targetId: 0,
          targetLabel: '----',
          progress: 0,
          distance: 0,
          eta: 0,
          speed: 0,
          speedRaw: 0,
        };
      this.flight = {
        target: null,
        t: 0,
        duration: 8,
        start: null,
        c1: null,
        c2: null,
        end: null,
        prevPos: null,
      };
      this.randomStars = [];
      this.galaxyCenter = { x: 0, y: 0, z: 0 };
      this.trajectoryPlanner = null;
      this.navigationState = 'idle';
    }

    _setNavigationState(state) {
      const key = String(state || '').toLowerCase();
      const allowed = new Set(['idle', 'acquire', 'cruise', 'approach', 'brake']);
      this.navigationState = allowed.has(key) ? key : 'idle';
      this.telemetry.phase = this.navigationState;
    }

    getNavigationState() {
      return this.navigationState;
    }

    setRandomStars(stars) {
      this.randomStars = Array.isArray(stars) ? stars : [];
    }

    setGalaxyCenter(center) {
      const x = Number(center?.x ?? center?.x_ly ?? 0);
      const y = Number(center?.y ?? center?.y_ly ?? 0);
      const z = Number(center?.z ?? center?.z_ly ?? 0);
      this.galaxyCenter = {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        z: Number.isFinite(z) ? z : 0,
      };
      this._resetTrajectoryPlanner();
    }

    setTarget(target, opts = {}) {
      if (!this.THREE || !target) return false;
      const x = Number(target.x_ly);
      const y = Number(target.y_ly || 0);
      const z = Number(target.z_ly);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false;

      const durationSec = Math.max(1.5, Number(opts.durationSec || (7.2 + Math.random() * 4.2)));
      this.flight.target = {
        id: Number(target.id || target.system_index || 0) || 0,
        x,
        y,
        z,
        label: String(target.label || target.name || 'TARGET'),
      };
      this.flight.t = 0;
      this.flight.duration = durationSec;
      this.telemetry.targetId = this.flight.target.id;
      this.telemetry.targetLabel = this.flight.target.label;
      this._setNavigationState('acquire');
      this._resetTrajectoryPlanner();
      return true;
    }

    setRandomTarget() {
      if (!this.randomStars.length) return false;
      const star = this.randomStars[Math.floor(Math.random() * this.randomStars.length)];
      if (!star) return false;
      return this.setTarget({
        id: star.id,
        x_ly: star.x_ly,
        y_ly: star.y_ly,
        z_ly: star.z_ly,
        label: `SYS-${String(star.system_index || star.id || '').padStart(4, '0')}`,
      });
    }

    getTelemetry() {
      // Return normalized telemetry if schema is available, else raw
      const telem = Object.assign({}, this.telemetry);
      if (this.telemetrySchema && typeof this.telemetrySchema.normalize === 'function') {
        return this.telemetrySchema.normalize(telem);
      }
      return telem;
    }

    _emitTelemetry() {
      if (!this.onTelemetry) return;
      try {
        this.onTelemetry(this.getTelemetry());
      } catch (_) {}
    }

    _resetTrajectoryPlanner() {
      if (this.trajectoryPlanner && typeof this.trajectoryPlanner.reset === 'function') {
        this.trajectoryPlanner.reset();
      }
    }

    _getTrajectoryPlanner() {
      if (this.trajectoryPlanner) return this.trajectoryPlanner;
      const plannerFactory = window.GQTrajectoryPlanner;
      if (!plannerFactory || typeof plannerFactory.create !== 'function') return null;

      const physics = this.physicsFactory && typeof this.physicsFactory.create === 'function'
        ? this.physicsFactory.create({
            gravitationalConstant: this.physicsTuning.gravitationalConstant,
            softening: this.physicsTuning.softening,
            maxAcceleration: this.physicsTuning.maxAcceleration,
            defaultDrag: this.physicsTuning.defaultDrag,
          })
        : null;

      this.trajectoryPlanner = plannerFactory.create({
        three: this.THREE,
        physics,
      });
      return this.trajectoryPlanner;
    }

    _clearFlightState() {
      this.flight.target = null;
      this.flight.start = null;
      this.flight.c1 = null;
      this.flight.c2 = null;
      this.flight.end = null;
      this.flight.prevPos = null;
      this.flight.t = 0;
      this._setNavigationState('idle');
      this.telemetry.speed = 0;
      this.telemetry.speedRaw = 0;
      this.telemetry.distance = 0;
      this.telemetry.eta = 0;
      this._resetTrajectoryPlanner();
    }

    _updateWithPlanner(renderer, dtSec, nowMs) {
      const planner = this._getTrajectoryPlanner();
      const flight = this.flight;
      if (!planner || !flight.target || !renderer?.camera?.position) return null;

      if (!planner.hasPlan || !planner.start || !planner.step) return null;
      if (!planner.hasPlan()) {
        const started = planner.start(renderer.camera.position.clone(), {
          id: flight.target.id,
          x_ly: flight.target.x,
          y_ly: flight.target.y,
          z_ly: flight.target.z,
          label: flight.target.label,
        }, {
          durationSec: flight.duration,
          galaxyCenter: this.galaxyCenter,
          maxSpeedLyPerSec: this.motionConstraints.maxSpeedLyPerSec,
          maxLinearAccel: this.motionConstraints.maxLinearAccel,
          maxBrakeAccel: this.motionConstraints.maxBrakeAccel,
          maxThrustAccel: this.motionConstraints.maxThrustAccel,
          headingSmoothing: this.motionConstraints.headingSmoothing,
          rollResponsiveness: this.motionConstraints.rollResponsiveness,
          maneuverStrength: this.motionConstraints.maneuverStrength,
          maneuverFrequency: this.motionConstraints.maneuverFrequency,
        });
        if (!started) return null;
      }

      const result = planner.step(dtSec, nowMs * 0.001);
      if (!result || result.ok !== true || !result.position || !result.target) return null;

      const t = result.telemetry || {};
      const speedVisual = Number(t.speedVisual || t.speed || 0);
      this.telemetry.speedRaw = speedVisual;
      this.telemetry.speed = this.THREE.MathUtils.lerp(this.telemetry.speed || 0, speedVisual, 0.22);
      this.telemetry.progress = clamp(Number(t.progress || 0), 0, 1);
      this._setNavigationState(String(t.phase || result.phase || 'cruise'));
      this.telemetry.distance = Math.max(0, Number(t.distance || 0));
      this.telemetry.eta = Math.max(0, Number(t.eta || 0));

      if (result.done) {
        this._clearFlightState();
      }

      return {
        position: result.position,
        target: result.target,
        roll: Number(result.roll || 0),
      };
    }

    _updateLegacy(dtSec, now) {
      const THREE = this.THREE;
      const flight = this.flight;
      if (!(flight.target && flight.start && flight.c1 && flight.c2 && flight.end)) return null;

      flight.t = Math.min(1, flight.t + (dtSec / Math.max(1.5, flight.duration)));

      const p = new THREE.Vector3(
        cubicBezier1D(flight.start.x, flight.c1.x, flight.c2.x, flight.end.x, flight.t),
        cubicBezier1D(flight.start.y, flight.c1.y, flight.c2.y, flight.end.y, flight.t),
        cubicBezier1D(flight.start.z, flight.c1.z, flight.c2.z, flight.end.z, flight.t)
      );
      const t2 = Math.min(1, flight.t + 0.015);
      const q = new THREE.Vector3(
        cubicBezier1D(flight.start.x, flight.c1.x, flight.c2.x, flight.end.x, t2),
        cubicBezier1D(flight.start.y, flight.c1.y, flight.c2.y, flight.end.y, t2),
        cubicBezier1D(flight.start.z, flight.c1.z, flight.c2.z, flight.end.z, t2)
      );

      const manYaw = Math.sin(now * 0.00075) * 0.013 + Math.sin(now * 0.0019) * 0.008;
      const manPitch = Math.cos(now * 0.00063) * 0.010;
      const manRoll = Math.sin(now * 0.0012) * 0.015;

      const d = q.clone().sub(p).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(d, up).normalize();
      const lifted = p.clone()
        .add(right.multiplyScalar(manYaw * 280))
        .add(new THREE.Vector3(0, manPitch * 210, 0));
      const lookAt = q.clone().add(new THREE.Vector3(manYaw * 120, manPitch * 70, 0));

      const moved = lifted.distanceTo(flight.prevPos || lifted);
      const speed = moved / Math.max(0.0001, dtSec);
      this.telemetry.speedRaw = speed;
      this.telemetry.speed = THREE.MathUtils.lerp(this.telemetry.speed || 0, speed, 0.22);
      this.telemetry.progress = clamp(flight.t, 0, 1);
      this._setNavigationState('cruise');
      this.telemetry.distance = 0;
      this.telemetry.eta = 0;
      flight.prevPos = lifted.clone();

      if (flight.t >= 1) {
        this._clearFlightState();
      }

      return {
        position: lifted,
        target: lookAt,
        roll: manRoll,
      };
    }

    update({ renderer, dt, now }) {
      const THREE = this.THREE;
      if (!renderer || !THREE) return false;

      const flight = this.flight;
      if (!flight.target) {
        this.setRandomTarget();
      }
      if (!(flight.target && flight.start && flight.c1 && flight.c2 && flight.end)) {
        if (flight.target && renderer?.camera?.position) {
          flight.start = renderer.camera.position.clone();
          flight.c1 = flight.start.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 860,
            (Math.random() - 0.5) * 320,
            (Math.random() - 0.5) * 860
          ));
          flight.c2 = new THREE.Vector3(flight.target.x, flight.target.y, flight.target.z).add(new THREE.Vector3(
            (Math.random() - 0.5) * 720,
            (Math.random() - 0.5) * 260,
            (Math.random() - 0.5) * 720
          ));
          flight.end = new THREE.Vector3(flight.target.x, flight.target.y, flight.target.z);
        } else {
          this._emitTelemetry();
          return true;
        }
      }

      const dtSec = Math.max(0.001, Number(dt || 0.016));
      const plannerPose = this._updateWithPlanner(renderer, dtSec, now);
      const pose = plannerPose || this._updateLegacy(dtSec, now);

      this._emitTelemetry();
      if (!pose) return true;
      return {
        position: pose.position,
        target: pose.target,
        roll: pose.roll,
      };
    }
  }

  function createSpaceCameraFlightDriver(options = {}) {
    return new SpaceCameraFlightDriver(options);
  }

  window.GQSpaceCameraFlightDriver = {
    SpaceCameraFlightDriver,
    create: createSpaceCameraFlightDriver,
  };
})();
