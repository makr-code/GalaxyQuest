/*
 * Space Flight HUD Engine
 * Reusable canvas animation engine with galaxy flight pathing and maneuver simulation.
 */
(function () {
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function vec3(x = 0, y = 0, z = 0) {
    return { x, y, z };
  }

  function vec3Add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  function vec3Sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function vec3Scale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  function vec3Length(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  function vec3Normalize(v) {
    const len = vec3Length(v) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  function vec3Distance(a, b) {
    return vec3Length(vec3Sub(a, b));
  }

  function cubicBezier(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const a = mt2 * mt;
    const b = 3 * mt2 * t;
    const c = 3 * mt * t2;
    const d = t * t2;
    return {
      x: p0.x * a + p1.x * b + p2.x * c + p3.x * d,
      y: p0.y * a + p1.y * b + p2.y * c + p3.y * d,
      z: p0.z * a + p1.z * b + p2.z * c + p3.z * d,
    };
  }

  function cubicBezierTangent(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const a = 3 * mt * mt;
    const b = 6 * mt * t;
    const c = 3 * t * t;
    return {
      x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
      y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
      z: a * (p1.z - p0.z) + b * (p2.z - p1.z) + c * (p3.z - p2.z),
    };
  }

  function createFallbackPhysics() {
    return {
      createBody(options = {}) {
        return {
          mass: Math.max(0.0001, Number(options.mass || 1)),
          position: vec3(
            Number(options.position?.x || 0),
            Number(options.position?.y || 0),
            Number(options.position?.z || 0)
          ),
          velocity: vec3(
            Number(options.velocity?.x || 0),
            Number(options.velocity?.y || 0),
            Number(options.velocity?.z || 0)
          ),
          drag: clamp(Number(options.drag || 0.001), 0, 0.2),
          maxSpeed: Math.max(0, Number(options.maxSpeed || 0)),
        };
      },
      computeGravityAt() {
        return vec3(0, 0, 0);
      },
      stepBody(body, dtSeconds, options = {}) {
        if (!body) return body;
        const dt = Math.max(0, Number(dtSeconds || 0));
        if (dt <= 0) return body;
        const thrust = options.thrust || vec3(0, 0, 0);
        body.velocity = vec3Add(body.velocity, vec3Scale(thrust, dt));
        const dragFactor = clamp(1 - ((body.drag || 0.001) * dt), 0, 1);
        body.velocity = vec3Scale(body.velocity, dragFactor);
        body.position = vec3Add(body.position, vec3Scale(body.velocity, dt));
        return body;
      },
    };
  }

  class SpaceFlightHudEngine {
    constructor(options = {}) {
      this.canvas = options.canvas || null;
      this.host = options.host || null;
      this.hudEnabled = options.hudEnabled !== false;
      this.starCount = Math.max(400, Number(options.starCount || 2600));
      this.galaxyRadius = Math.max(2000, Number(options.galaxyRadius || 7600));
      this.focalLengthFactor = clamp(Number(options.focalLengthFactor || 0.72), 0.35, 1.4);
      this.palette = Object.assign({
        bgTop: '#030816',
        bgMid: '#040d22',
        bgBottom: '#02060f',
        star: '170, 220, 255',
        scanline: '120, 170, 255',
        hud: '#9fd0ff',
      }, options.palette || {});
      this.logPrefix = String(options.logPrefix || '[space-flight]');

      this.ctx = null;
      this.width = 0;
      this.height = 0;
      this.centerX = 0;
      this.centerY = 0;
      this.speed = Number(options.initialSpeed || 15);
      this.targetSpeed = this.speed;
      this.speedScale = 1;
      this.currentSpeedNormalized = 0;
      this.timeStart = performance.now();
      this.prevTs = performance.now();

      this.stars = [];
      this.targetStar = null;
      this.navigationTarget = null;
      this.activeCourse = null;

      this.camera = {
        pos: vec3(0, 0, 0),
        prevPos: vec3(0, 0, 0),
        yaw: 0,
        pitch: 0,
        roll: 0,
        prevYaw: 0,
        prevPitch: 0,
        prevRoll: 0,
      };

      this.maneuver = {
        start: 0,
        duration: 0,
        yawAmp: 0,
        pitchAmp: 0,
        rollAmp: 0,
        freq: 0,
        phase: 0,
        speedPulse: 0,
      };
      this.nextManeuverAt = this.timeStart + 1200;

      const physicsFactory = window.GQSpacePhysicsEngine;
      this.physics = physicsFactory && typeof physicsFactory.create === 'function'
        ? physicsFactory.create({
          gravitationalConstant: Number(options.gravitationalConstant || 9.5e-4),
          softening: Number(options.gravitySoftening || 160),
          maxAcceleration: Number(options.maxAcceleration || 420),
          defaultDrag: Number(options.defaultDrag || 0.00075),
        })
        : createFallbackPhysics();
      this.cameraBody = null;

      this.rafId = null;
      this.hudRoot = null;
      this.hudLabel = null;
      this.hudReadout = null;
      this.started = false;

      this._onResizeBound = () => this.resize();
      this.shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : (() => false);
      this.onStop = typeof options.onStop === 'function' ? options.onStop : null;
    }

    _log(level, message) {
      try {
        if (window.GQLog && typeof window.GQLog[level] === 'function') {
          window.GQLog[level](this.logPrefix, String(message || ''));
        }
      } catch (_) {}
    }

    _randomRange(min, max) {
      return min + Math.random() * (max - min);
    }

    _generateGalaxyStar(index) {
      const r = Math.pow(Math.random(), 0.74) * this.galaxyRadius;
      const angle = Math.random() * Math.PI * 2;
      const armTwist = Math.sin(r * 0.0036 + angle * 3.7) * (70 + r * 0.06);
      return {
        id: index + 1,
        x: Math.cos(angle) * r + this._randomRange(-180, 180),
        y: this._randomRange(-420, 420) + armTwist * 0.06,
        z: Math.sin(angle) * r + this._randomRange(-180, 180),
        mag: this._randomRange(0.55, 1.0),
      };
    }

    _seedStars() {
      this.stars.length = 0;
      for (let i = 0; i < this.starCount; i += 1) {
        this.stars.push(this._generateGalaxyStar(i));
      }

      if (!this.cameraBody) {
        this.cameraBody = this.physics.createBody({
          mass: 1,
          position: vec3(0, 0, -this.galaxyRadius * 0.25),
          velocity: vec3(0, 0, 0),
          drag: 0.001,
          maxSpeed: 340,
        });
      }

      this.camera.pos = vec3(
        this.cameraBody.position.x,
        this.cameraBody.position.y,
        this.cameraBody.position.z
      );
      this.camera.prevPos = vec3(
        this.cameraBody.position.x,
        this.cameraBody.position.y,
        this.cameraBody.position.z
      );
    }

    _respawnStarNearCamera(star) {
      const dist = this._randomRange(this.galaxyRadius * 0.2, this.galaxyRadius * 0.95);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(this._randomRange(-1, 1));
      const sinPhi = Math.sin(phi);
      star.x = this.camera.pos.x + Math.cos(theta) * sinPhi * dist;
      star.y = this.camera.pos.y + Math.cos(phi) * dist * 0.35;
      star.z = this.camera.pos.z + Math.sin(theta) * sinPhi * dist;
      star.mag = this._randomRange(0.55, 1.0);
    }

    _pickTargetStar() {
      const minDist = this.galaxyRadius * 0.16;
      const maxDist = this.galaxyRadius * 0.52;
      let best = null;
      for (let i = 0; i < 42; i += 1) {
        const s = this.stars[Math.floor(Math.random() * this.stars.length)];
        if (!s) continue;
        const d = vec3Distance(s, this.camera.pos);
        if (d < minDist || d > maxDist) continue;
        best = s;
        break;
      }
      if (!best) {
        best = this.stars[Math.floor(Math.random() * this.stars.length)] || null;
      }
      return best;
    }

    _currentForward() {
      const cy = Math.cos(this.camera.yaw);
      const sy = Math.sin(this.camera.yaw);
      const cp = Math.cos(this.camera.pitch);
      const sp = Math.sin(this.camera.pitch);
      return vec3Normalize({ x: sy * cp, y: sp, z: cy * cp });
    }

    _planNewCourse(now) {
      if (this.navigationTarget && Number.isFinite(Number(this.navigationTarget?.x_ly))) {
        const tx = Number(this.navigationTarget.x_ly);
        const ty = Number(this.navigationTarget.y_ly || 0);
        const tz = Number(this.navigationTarget.z_ly);
        this.targetStar = {
          id: Number(this.navigationTarget.id || this.navigationTarget.system_index || 0) || 0,
          x: tx,
          y: ty,
          z: tz,
          mag: 1,
          homeworld: true,
        };
      } else {
        this.targetStar = this._pickTargetStar();
      }
      if (!this.targetStar || !this.cameraBody) return;

      const start = vec3(this.cameraBody.position.x, this.cameraBody.position.y, this.cameraBody.position.z);
      const end = vec3(this.targetStar.x, this.targetStar.y, this.targetStar.z);
      const toEnd = vec3Normalize(vec3Sub(end, start));
      const forward = this._currentForward();

      const c1 = vec3Add(
        start,
        vec3Add(
          vec3Scale(forward, this._randomRange(460, 980)),
          vec3(this._randomRange(-420, 420), this._randomRange(-220, 220), this._randomRange(-420, 420))
        )
      );
      const c2 = vec3Add(
        end,
        vec3Add(
          vec3Scale(toEnd, -this._randomRange(380, 860)),
          vec3(this._randomRange(-360, 360), this._randomRange(-180, 180), this._randomRange(-360, 360))
        )
      );

      this.activeCourse = {
        p0: start,
        p1: c1,
        p2: c2,
        p3: end,
        t: 0,
        duration: this._randomRange(6.8, 11.8),
        startedAt: now,
      };
    }

    setNavigationTarget(target = null) {
      if (!target || typeof target !== 'object') {
        this.navigationTarget = null;
        return false;
      }

      const normalized = {
        id: Number(target.id || target.system_index || 0) || 0,
        system_index: Number(target.system_index || target.id || 0) || 0,
        galaxy_index: Number(target.galaxy_index || 0) || 0,
        x_ly: Number(target.x_ly),
        y_ly: Number(target.y_ly || 0),
        z_ly: Number(target.z_ly),
        label: String(target.label || target.name || 'Homeworld target'),
      };

      if (!Number.isFinite(normalized.x_ly) || !Number.isFinite(normalized.z_ly)) {
        return false;
      }

      this.navigationTarget = normalized;
      if (this.started) {
        this._planNewCourse(performance.now());
      }
      return true;
    }

    _startManeuver(now) {
      this.maneuver.start = now;
      this.maneuver.duration = this._randomRange(900, 2400);
      this.maneuver.yawAmp = this._randomRange(-0.11, 0.11);
      this.maneuver.pitchAmp = this._randomRange(-0.075, 0.075);
      this.maneuver.rollAmp = this._randomRange(-0.22, 0.22);
      this.maneuver.freq = this._randomRange(1.3, 3.6);
      this.maneuver.phase = this._randomRange(0, Math.PI * 2);
      this.maneuver.speedPulse = this._randomRange(-0.18, 0.34);
      this.nextManeuverAt = now + this._randomRange(1400, 4300);
    }

    _maneuverOffsets(now) {
      const m = this.maneuver;
      if (!m.duration) return { yaw: 0, pitch: 0, roll: 0, speed: 1 };
      const progress = clamp((now - m.start) / m.duration, 0, 1);
      if (progress >= 1) {
        m.duration = 0;
        return { yaw: 0, pitch: 0, roll: 0, speed: 1 };
      }
      const envelope = Math.sin(progress * Math.PI);
      const osc = Math.sin(now * 0.001 * m.freq + m.phase);
      return {
        yaw: m.yawAmp * envelope * osc,
        pitch: m.pitchAmp * envelope * osc,
        roll: m.rollAmp * envelope * Math.cos(now * 0.001 * m.freq * 1.2 + m.phase * 0.8),
        speed: 1 + m.speedPulse * envelope,
      };
    }

    _updateFlight(now, dt) {
      if (!this.activeCourse) this._planNewCourse(now);
      if (!this.activeCourse || !this.cameraBody) return;

      if (now >= this.nextManeuverAt) {
        this._startManeuver(now);
      }

      const course = this.activeCourse;
      const dtSec = dt * 0.001;
      course.t = clamp(course.t + dtSec / course.duration, 0, 1);

      this.camera.prevPos = vec3(this.camera.pos.x, this.camera.pos.y, this.camera.pos.z);
      this.camera.prevYaw = this.camera.yaw;
      this.camera.prevPitch = this.camera.pitch;
      this.camera.prevRoll = this.camera.roll;

      const lookAheadT = clamp(course.t + 0.02, 0, 1);
      const desiredPos = cubicBezier(course.p0, course.p1, course.p2, course.p3, lookAheadT);
      const tangent = vec3Normalize(cubicBezierTangent(course.p0, course.p1, course.p2, course.p3, course.t));

      const desiredVel = vec3Scale(vec3Normalize(vec3Sub(desiredPos, this.cameraBody.position)), 220);
      const velError = vec3Sub(desiredVel, this.cameraBody.velocity);
      const steering = vec3Scale(velError, 1.35);

      const yawBase = Math.atan2(tangent.x, tangent.z);
      const pitchBase = Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z));
      const m = this._maneuverOffsets(now);

      const gravitySources = [
        { position: vec3(0, 0, 0), mass: 7.8e7 },
      ];
      if (this.targetStar) {
        gravitySources.push({
          position: vec3(this.targetStar.x, this.targetStar.y, this.targetStar.z),
          mass: this.targetStar.homeworld ? 2.8e7 : 1.4e7,
        });
      }

      const lateral = vec3(
        Math.sin(this.camera.yaw) * m.speed * 0.35,
        Math.sin(this.camera.pitch * 1.3) * m.speed * 0.25,
        Math.cos(this.camera.yaw) * m.speed * 0.35
      );

      this.physics.stepBody(this.cameraBody, dtSec, {
        gravitySources,
        thrust: vec3Add(steering, lateral),
      });

      this.camera.pos = vec3(
        this.cameraBody.position.x,
        this.cameraBody.position.y,
        this.cameraBody.position.z
      );
      this.camera.yaw = yawBase + m.yaw;
      this.camera.pitch = pitchBase + m.pitch;
      this.camera.roll = m.roll;

      const courseSpeed = vec3Length(this.cameraBody.velocity);
      this.targetSpeed = courseSpeed * 0.7;
      this.speed += (this.targetSpeed - this.speed) * 0.16;
      this.speedScale += (m.speed - this.speedScale) * 0.14;

      if (course.t >= 1) {
        this._planNewCourse(now);
      }
    }

    _worldToCamera(star, usePrevious = false) {
      const camPos = usePrevious ? this.camera.prevPos : this.camera.pos;
      const yaw = usePrevious ? this.camera.prevYaw : this.camera.yaw;
      const pitch = usePrevious ? this.camera.prevPitch : this.camera.pitch;
      const roll = usePrevious ? this.camera.prevRoll : this.camera.roll;

      const dx = star.x - camPos.x;
      const dy = star.y - camPos.y;
      const dz = star.z - camPos.z;

      const cy = Math.cos(-yaw);
      const sy = Math.sin(-yaw);
      const x1 = cy * dx - sy * dz;
      const z1 = sy * dx + cy * dz;

      const cp = Math.cos(-pitch);
      const sp = Math.sin(-pitch);
      const y2 = cp * dy - sp * z1;
      const z2 = sp * dy + cp * z1;

      const cr = Math.cos(-roll);
      const sr = Math.sin(-roll);
      const x3 = cr * x1 - sr * y2;
      const y3 = sr * x1 + cr * y2;

      return { x: x3, y: y3, z: z2 };
    }

    _projectCamPoint(cp) {
      const z = cp.z;
      if (z <= 10) return null;
      const focal = Math.min(this.width, this.height) * this.focalLengthFactor;
      return {
        x: this.centerX + (cp.x / z) * focal,
        y: this.centerY - (cp.y / z) * focal,
        z,
      };
    }

    _ensureHud() {
      if (!this.hudEnabled || !this.host) return;
      if (this.hudRoot && this.hudRoot.parentElement) return;

      const root = document.createElement('div');
      root.className = 'gq-spaceflight-hud';
      root.style.setProperty('--gq-spaceflight-hud-color', this.palette.hud);

      const topLeft = document.createElement('div');
      topLeft.className = 'gq-spaceflight-hud-label';
      topLeft.textContent = 'GALAXY NAV HUD';
  this.hudLabel = topLeft;

      const topRight = document.createElement('div');
      topRight.className = 'gq-spaceflight-hud-readout';
      topRight.textContent = 'SPD 000.0 | STARS 0000';

      const crosshair = document.createElement('div');
      crosshair.className = 'gq-spaceflight-hud-crosshair';

      const horizontal = document.createElement('div');
      horizontal.className = 'gq-spaceflight-hud-crosshair-h';

      const vertical = document.createElement('div');
      vertical.className = 'gq-spaceflight-hud-crosshair-v';

      crosshair.appendChild(horizontal);
      crosshair.appendChild(vertical);
      root.appendChild(topLeft);
      root.appendChild(topRight);
      root.appendChild(crosshair);

      this.host.style.position = this.host.style.position || 'relative';
      this.host.appendChild(root);
      this.hudRoot = root;
      this.hudReadout = topRight;
    }

    _drawBackground() {
      const grad = this.ctx.createLinearGradient(0, 0, 0, this.height);
      grad.addColorStop(0, this.palette.bgTop);
      grad.addColorStop(0.5, this.palette.bgMid);
      grad.addColorStop(1, this.palette.bgBottom);
      this.ctx.fillStyle = grad;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }

    _drawStars() {
      this.ctx.lineCap = 'round';
      let visible = 0;
      const speedNorm = clamp(this.speed * this.speedScale / 190, 0, 1);
      for (let i = 0; i < this.stars.length; i += 1) {
        const s = this.stars[i];

        if (vec3Distance(s, this.camera.pos) > this.galaxyRadius * 1.25) {
          this._respawnStarNearCamera(s);
        }

        const camNow = this._worldToCamera(s, false);
        const camPrev = this._worldToCamera(s, true);
        const now = this._projectCamPoint(camNow);
        const prev = this._projectCamPoint(camPrev);

        if (!now || !prev) {
          continue;
        }

        if (now.x < -80 || now.x > this.width + 80 || now.y < -80 || now.y > this.height + 80) {
          continue;
        }

        const depthNorm = 1 - clamp(now.z / (this.galaxyRadius * 0.9), 0, 1);
        const intensity = clamp(depthNorm * 1.35 + 0.08, 0.05, 1);
        const alpha = clamp(0.08 + intensity * 0.9, 0.06, 0.95);
        const lineW = 0.3 + intensity * (1.2 + speedNorm * 1.8) * s.mag;
        const trailBoost = 0.35 + speedNorm * 2.6;

        const dx = now.x - prev.x;
        const dy = now.y - prev.y;
        const tx = now.x + dx * trailBoost;
        const ty = now.y + dy * trailBoost;

        this.ctx.strokeStyle = `rgba(${this.palette.star}, ${alpha.toFixed(3)})`;
        this.ctx.lineWidth = lineW;
        this.ctx.beginPath();
        this.ctx.moveTo(tx, ty);
        this.ctx.lineTo(now.x, now.y);
        this.ctx.stroke();

        visible += 1;
      }

      return visible;
    }

    _drawScanlines() {
      this.ctx.strokeStyle = `rgba(${this.palette.scanline}, 0.05)`;
      this.ctx.lineWidth = 1;
      for (let y = 0; y < this.height; y += 3) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y + 0.5);
        this.ctx.lineTo(this.width, y + 0.5);
        this.ctx.stroke();
      }
    }

    _updateHud(visibleStars) {
      if (!this.hudReadout) return;
      const speedValue = Math.max(0, this.speed * this.speedScale * 7.8);
      this.currentSpeedNormalized = clamp(speedValue / 980, 0, 1);
      const targetId = this.targetStar ? String(this.targetStar.id).padStart(4, '0') : '----';
      this.hudReadout.textContent = `SPD ${speedValue.toFixed(1).padStart(6, '0')} | STARS ${String(visibleStars).padStart(4, '0')} | TGT ${targetId}`;

      if (this.hudLabel) {
        const mode = this.currentSpeedNormalized > 0.72
          ? 'WARP'
          : this.currentSpeedNormalized > 0.42
            ? 'CRUISE'
            : 'APPROACH';
        this.hudLabel.textContent = `GALAXY NAV HUD - ${mode}`;
      }
    }

    _frame = (ts) => {
      if (this.shouldStop()) {
        this.destroy();
        if (typeof this.onStop === 'function') this.onStop();
        return;
      }

      const dt = Math.min(40, Math.max(8, ts - this.prevTs));
      this.prevTs = ts;

      this._updateFlight(ts, dt);

      this._drawBackground();
      const visible = this._drawStars();
      this._drawScanlines();
      this._updateHud(visible);

      this.rafId = requestAnimationFrame(this._frame);
    };

    resize() {
      if (!this.canvas || !this.host || !this.ctx) return;

      const rect = this.host.getBoundingClientRect();
      this.width = Math.max(320, Math.floor(rect.width || window.innerWidth));
      this.height = Math.max(220, Math.floor(rect.height || window.innerHeight));
      this.centerX = this.width * 0.5;
      this.centerY = this.height * 0.5;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.floor(this.width * dpr));
      this.canvas.height = Math.max(1, Math.floor(this.height * dpr));
      this.canvas.style.width = this.width + 'px';
      this.canvas.style.height = this.height + 'px';

      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(dpr, dpr);
    }

    start() {
      if (this.started) return true;
      if (!this.canvas || !this.host) return false;

      this.ctx = this.canvas.getContext('2d', { alpha: false });
      if (!this.ctx) return false;

      this.resize();
      this._seedStars();
      this._planNewCourse(performance.now());
      this._ensureHud();

      window.addEventListener('resize', this._onResizeBound);
      this.started = true;
      this.rafId = requestAnimationFrame(this._frame);
      this._log('info', 'space flight animation active');
      return true;
    }

    destroy() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      window.removeEventListener('resize', this._onResizeBound);
      if (this.hudRoot && this.hudRoot.parentElement) {
        this.hudRoot.parentElement.removeChild(this.hudRoot);
      }
      this.hudRoot = null;
      this.hudLabel = null;
      this.hudReadout = null;
      this.targetStar = null;
      this.navigationTarget = null;
      this.activeCourse = null;
      this.cameraBody = null;
      this.started = false;
    }

    isActive() {
      return !!this.rafId && this.started;
    }
  }

  function createSpaceFlightHudEngine(options = {}) {
    return new SpaceFlightHudEngine(options);
  }

  window.GQSpaceFlightHudEngine = {
    SpaceFlightHudEngine,
    create: createSpaceFlightHudEngine,
  };
})();
