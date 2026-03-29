/*
 * GQTrajectoryPlanner
 * Shared trajectory planner for camera flights with steering, gravity,
 * and explicit approach/brake phases.
 */
(function () {
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function toVec3(THREE, value, fallback = null) {
    const x = Number(value?.x ?? value?.x_ly ?? NaN);
    const y = Number(value?.y ?? value?.y_ly ?? 0);
    const z = Number(value?.z ?? value?.z_ly ?? NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return fallback;
    return new THREE.Vector3(x, y, z);
  }

  function cubicBezier1D(a, b, c, d, t) {
    const mt = 1 - t;
    return (mt * mt * mt * a)
      + (3 * mt * mt * t * b)
      + (3 * mt * t * t * c)
      + (t * t * t * d);
  }

  class GQTrajectoryPlanner {
    constructor(options = {}) {
      this.THREE = options.three || window.THREE;
      this.physics = options.physics || (window.GQSpacePhysicsEngine && typeof window.GQSpacePhysicsEngine.create === 'function'
        ? window.GQSpacePhysicsEngine.create({
            gravitationalConstant: 9.5e-4,
            softening: 140,
            maxAcceleration: 560,
            defaultDrag: 0.002,
          })
        : null);
      this.plan = null;
      this.telemetry = {
        phase: 'idle',
        progress: 0,
        speed: 0,
        distance: 0,
        eta: 0,
      };
    }

    reset() {
      this.plan = null;
      this.telemetry = {
        phase: 'idle',
        progress: 0,
        speed: 0,
        distance: 0,
        eta: 0,
      };
    }

    hasPlan() {
      return !!this.plan;
    }

    getTelemetry() {
      return Object.assign({}, this.telemetry);
    }

    start(startPosition, target, opts = {}) {
      const THREE = this.THREE;
      if (!THREE) return false;
      const start = toVec3(THREE, startPosition);
      const end = toVec3(THREE, target);
      if (!start || !end) return false;

      const toTarget = end.clone().sub(start);
      const distanceTotal = Math.max(1, toTarget.length());
      const dir = toTarget.clone().normalize();
      const durationSec = Math.max(1.2, Number(opts.durationSec || 4.6));
      const maxSpeedLyPerSec = Math.max(0.05, Number(opts.maxSpeedLyPerSec || 1));
      const cruiseSpeed = clamp(distanceTotal / Math.max(1.2, durationSec), 0.2, maxSpeedLyPerSec);
      const acquireDistance = clamp(distanceTotal * 0.88, 24, distanceTotal);
      const approachDistance = clamp(distanceTotal * 0.32, 52, distanceTotal);
      const brakeDistance = clamp(distanceTotal * 0.15, 24, distanceTotal);
      const arrivalDistance = clamp(distanceTotal * 0.02, 4.5, 18);
      const galaxyCenter = toVec3(THREE, opts.galaxyCenter, new THREE.Vector3(0, 0, 0));
      const maxLinearAccel = Math.max(0.01, Number(opts.maxLinearAccel || 0.16));
      const maxBrakeAccel = Math.max(0.01, Number(opts.maxBrakeAccel || 0.24));
      const maxThrustAccel = Math.max(0.01, Number(opts.maxThrustAccel || 0.28));
      const headingSmoothing = Math.max(0.1, Number(opts.headingSmoothing || 2.1));
      const rollResponsiveness = Math.max(0.1, Number(opts.rollResponsiveness || 2.3));
      const maneuverStrength = Math.max(0, Number(opts.maneuverStrength || 0.075));
      const maneuverFrequency = Math.max(0.05, Number(opts.maneuverFrequency || 0.18));

      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
      right.normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const lateral = right.multiplyScalar((Math.random() - 0.5) * clamp(distanceTotal * 0.15, 25, 180));
      const vertical = up.multiplyScalar((Math.random() - 0.5) * clamp(distanceTotal * 0.07, 14, 90));

      const c1 = start.clone().addScaledVector(dir, distanceTotal * 0.34).add(lateral).add(vertical);
      const c2 = start.clone().addScaledVector(dir, distanceTotal * 0.72).addScaledVector(lateral, -0.75).addScaledVector(vertical, 0.45);

      const body = this.physics && typeof this.physics.createBody === 'function'
        ? this.physics.createBody({
            mass: 1,
            position: { x: start.x, y: start.y, z: start.z },
            velocity: { x: dir.x * Math.min(0.18, cruiseSpeed), y: dir.y * Math.min(0.18, cruiseSpeed), z: dir.z * Math.min(0.18, cruiseSpeed) },
            drag: 0.022,
            maxSpeed: maxSpeedLyPerSec,
          })
        : {
            position: { x: start.x, y: start.y, z: start.z },
            velocity: { x: dir.x * Math.min(0.18, cruiseSpeed), y: dir.y * Math.min(0.18, cruiseSpeed), z: dir.z * Math.min(0.18, cruiseSpeed) },
          };

      this.plan = {
        target: {
          id: Number(target?.id || target?.system_index || 0) || 0,
          label: String(target?.label || target?.name || 'TARGET'),
          end,
        },
        start,
        c1,
        c2,
        phase: 'acquire',
        elapsed: 0,
        galaxyCenter,
        distanceTotal,
        cruiseSpeed,
        maxSpeedLyPerSec,
        maxLinearAccel,
        maxBrakeAccel,
        maxThrustAccel,
        headingSmoothing,
        rollResponsiveness,
        maneuverStrength,
        maneuverFrequency,
        acquireDistance,
        approachDistance,
        brakeDistance,
        arrivalDistance,
        body,
        lastPos: start.clone(),
        baseRight: right.clone(),
        baseUp: up.clone(),
        currentDesiredDir: dir.clone(),
        currentDesiredSpeed: Math.min(0.18, cruiseSpeed),
        currentRoll: 0,
        currentManeuver: new THREE.Vector3(),
        maneuverSeedA: Math.random() * Math.PI * 2,
        maneuverSeedB: Math.random() * Math.PI * 2,
        maneuverSeedC: Math.random() * Math.PI * 2,
      };

      this.telemetry.phase = 'acquire';
      this.telemetry.progress = 0;
      this.telemetry.speed = 0;
      this.telemetry.distance = distanceTotal;
      this.telemetry.eta = durationSec;
      return true;
    }

    _pathPoint(plan, progress) {
      return new this.THREE.Vector3(
        cubicBezier1D(plan.start.x, plan.c1.x, plan.c2.x, plan.target.end.x, progress),
        cubicBezier1D(plan.start.y, plan.c1.y, plan.c2.y, plan.target.end.y, progress),
        cubicBezier1D(plan.start.z, plan.c1.z, plan.c2.z, plan.target.end.z, progress)
      );
    }

    _desiredSpeed(plan, distance) {
      if (plan.phase === 'acquire') return Math.max(0.22, plan.cruiseSpeed * 0.56);
      if (plan.phase === 'cruise') return plan.cruiseSpeed;
      if (plan.phase === 'approach') {
        const t = clamp((distance - plan.brakeDistance) / Math.max(1e-3, plan.approachDistance - plan.brakeDistance), 0, 1);
        return this.THREE.MathUtils.lerp(Math.max(0.14, plan.cruiseSpeed * 0.35), plan.cruiseSpeed * 0.82, t);
      }
      const tBrake = clamp(distance / Math.max(1e-3, plan.brakeDistance), 0, 1);
      return this.THREE.MathUtils.lerp(0, Math.max(0.08, plan.cruiseSpeed * 0.28), tBrake);
    }

    _updatePhase(plan, distance) {
      if (distance <= plan.arrivalDistance && plan.phase !== 'brake') {
        plan.phase = 'brake';
      } else if (distance <= plan.brakeDistance && plan.phase !== 'brake') {
        plan.phase = 'brake';
      } else if (distance <= plan.approachDistance && (plan.phase === 'acquire' || plan.phase === 'cruise')) {
        plan.phase = 'approach';
      } else if (distance <= plan.acquireDistance && plan.phase === 'acquire') {
        plan.phase = 'cruise';
      }
    }

    step(dtSeconds, nowSeconds = 0) {
      const THREE = this.THREE;
      const plan = this.plan;
      if (!THREE || !plan) {
        return { ok: false, done: true };
      }

      const dt = clamp(Number(dtSeconds || 0.016), 1 / 240, 1 / 18);
      plan.elapsed += dt;

      const pos = new THREE.Vector3(plan.body.position.x, plan.body.position.y, plan.body.position.z);
      const velocity = new THREE.Vector3(plan.body.velocity.x, plan.body.velocity.y, plan.body.velocity.z);
      const toTarget = plan.target.end.clone().sub(pos);
      const distance = Math.max(0.0001, toTarget.length());

      this._updatePhase(plan, distance);

      const progress = clamp(1 - (distance / plan.distanceTotal), 0, 1);
      const guide = this._pathPoint(plan, clamp(progress + 0.02, 0, 1));
      const toGuide = guide.sub(pos);
      const guideDir = toGuide.lengthSq() > 1e-6 ? toGuide.normalize() : toTarget.clone().normalize();
      const targetDir = toTarget.clone().normalize();

      const blend = plan.phase === 'brake' ? 0.84 : plan.phase === 'approach' ? 0.62 : 0.38;
      const desiredDirRaw = guideDir.multiplyScalar(1 - blend).add(targetDir.multiplyScalar(blend)).normalize();

      const maneuverFade = plan.phase === 'brake' ? 0.16 : plan.phase === 'approach' ? 0.48 : 1;
      const maneuverAmp = plan.maneuverStrength * maneuverFade * clamp(plan.currentDesiredSpeed / Math.max(0.05, plan.maxSpeedLyPerSec), 0.2, 1);
      const t = plan.elapsed * plan.maneuverFrequency;
      const lateralNoise = (Math.sin((t * 0.9) + plan.maneuverSeedA) * 0.65)
        + (Math.sin((t * 1.7) + plan.maneuverSeedB) * 0.35);
      const verticalNoise = (Math.cos((t * 1.1) + plan.maneuverSeedB) * 0.6)
        + (Math.sin((t * 2.05) + plan.maneuverSeedC) * 0.4);
      const driftNoise = (Math.sin((t * 0.55) + plan.maneuverSeedC) * 0.55)
        + (Math.cos((t * 1.35) + plan.maneuverSeedA) * 0.45);

      const maneuverTarget = plan.baseRight.clone().multiplyScalar(lateralNoise * maneuverAmp)
        .add(plan.baseUp.clone().multiplyScalar(verticalNoise * maneuverAmp * 0.7))
        .add(targetDir.clone().multiplyScalar(driftNoise * maneuverAmp * 0.08));
      const maneuverLerp = clamp((plan.headingSmoothing * 0.55) * dt, 0.025, 0.22);
      plan.currentManeuver.lerp(maneuverTarget, maneuverLerp);

      const desiredDirWithManeuver = desiredDirRaw.clone().add(plan.currentManeuver).normalize();
      const headingLerp = clamp(plan.headingSmoothing * dt, 0.04, 0.5);
      plan.currentDesiredDir.lerp(desiredDirWithManeuver, headingLerp).normalize();

      const targetSpeed = Math.min(plan.maxSpeedLyPerSec, this._desiredSpeed(plan, distance));
      const speedDelta = targetSpeed - plan.currentDesiredSpeed;
      const accelStep = plan.maxLinearAccel * dt;
      const brakeStep = plan.maxBrakeAccel * dt;
      plan.currentDesiredSpeed += clamp(speedDelta, -brakeStep, accelStep);
      plan.currentDesiredSpeed = clamp(plan.currentDesiredSpeed, 0, plan.maxSpeedLyPerSec);

      const desiredVel = plan.currentDesiredDir.clone().multiplyScalar(plan.currentDesiredSpeed);
      const velError = desiredVel.sub(velocity);

      const steeringGain = plan.phase === 'acquire' ? 1.9 : plan.phase === 'cruise' ? 1.4 : plan.phase === 'approach' ? 1.65 : 2.0;
      const thrust = velError.multiplyScalar(steeringGain);
      if (thrust.length() > plan.maxThrustAccel) {
        thrust.setLength(plan.maxThrustAccel);
      }

      const gravitySources = [];
      gravitySources.push({ position: { x: plan.target.end.x, y: plan.target.end.y, z: plan.target.end.z }, mass: 4.8e2 });
      if (distance > 120) {
        gravitySources.push({ position: { x: plan.galaxyCenter.x, y: plan.galaxyCenter.y, z: plan.galaxyCenter.z }, mass: 5.4e3 });
      }

      if (this.physics && typeof this.physics.stepBody === 'function') {
        this.physics.stepBody(plan.body, dt, {
          gravitySources,
          thrust: { x: thrust.x, y: thrust.y, z: thrust.z },
        });
      } else {
        plan.body.velocity.x += thrust.x * dt;
        plan.body.velocity.y += thrust.y * dt;
        plan.body.velocity.z += thrust.z * dt;
        plan.body.position.x += plan.body.velocity.x * dt;
        plan.body.position.y += plan.body.velocity.y * dt;
        plan.body.position.z += plan.body.velocity.z * dt;
      }

      const nextPos = new THREE.Vector3(plan.body.position.x, plan.body.position.y, plan.body.position.z);
      const nextVel = new THREE.Vector3(plan.body.velocity.x, plan.body.velocity.y, plan.body.velocity.z);
      const speed = nextVel.length();
      const moved = nextPos.distanceTo(plan.lastPos);
      plan.lastPos.copy(nextPos);

      const lookAheadDist = clamp(speed * 0.32 + 18, 18, 160);
      const lookTarget = nextPos.clone().add(nextVel.lengthSq() > 1e-6 ? nextVel.clone().normalize().multiplyScalar(lookAheadDist) : toTarget.clone().normalize().multiplyScalar(lookAheadDist));

      const rollBase = Math.sin(nowSeconds * 0.62 + progress * 5.1) * 0.01;
      const bank = clamp((thrust.length() / Math.max(0.05, plan.maxThrustAccel)), 0, 1) * 0.02;
      const maneuverBank = lateralNoise * maneuverAmp * 0.12;
      const targetRoll = rollBase + maneuverBank + (plan.phase === 'brake' ? -bank : bank);
      const rollLerp = clamp(plan.rollResponsiveness * dt, 0.05, 0.5);
      plan.currentRoll += (targetRoll - plan.currentRoll) * rollLerp;

      const done = distance <= plan.arrivalDistance && speed < 0.08;
      if (done) {
        this.telemetry.phase = 'complete';
        this.telemetry.progress = 1;
        this.telemetry.speed = 0;
        this.telemetry.distance = 0;
        this.telemetry.eta = 0;
      } else {
        this.telemetry.phase = plan.phase;
        this.telemetry.progress = progress;
        this.telemetry.speed = speed;
        this.telemetry.distance = distance;
        this.telemetry.eta = speed > 1 ? (distance / speed) : 0;
      }

      return {
        ok: true,
        done,
        phase: plan.phase,
        position: nextPos,
        target: lookTarget,
        roll: plan.currentRoll,
        telemetry: Object.assign({}, this.telemetry, {
          speedVisual: moved / Math.max(1e-4, dt),
        }),
      };
    }
  }

  function createTrajectoryPlanner(options = {}) {
    return new GQTrajectoryPlanner(options);
  }

  window.GQTrajectoryPlanner = {
    GQTrajectoryPlanner,
    create: createTrajectoryPlanner,
  };
})();
