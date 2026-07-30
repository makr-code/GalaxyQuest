/**
 * Trajectory Renderer
 *
 * Renders animated trajectories, flight paths, and orbital mechanics on 2D canvas overlays.
 * Supports linear, Bezier curves (quadratic & cubic), and elliptical orbits (Kepler).
 *
 * Usage:
 *   const renderer = new TrajectoryRenderer();
 *   renderer.drawTrajectory(ctx, trajectory, progress, viewport);
 */

(function () {
  'use strict';

  // ── Bezier Interpolation ───────────────────────────────────────────────────

  /**
   * Linear interpolation between two points
   */
  function linearInterpolate(p0, p1, t) {
    return {
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
    };
  }

  /**
   * Quadratic Bézier interpolation: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
   */
  function quadraticBezier(p0, p1, p2, t) {
    const mt = 1 - t;
    const a = mt * mt;
    const b = 2 * mt * t;
    const c = t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x,
      y: a * p0.y + b * p1.y + c * p2.y,
    };
  }

  /**
   * Cubic Bézier interpolation: B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
   */
  function cubicBezier(p0, p1, p2, p3, t) {
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    return {
      x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    };
  }

  /**
   * Catmull-Rom spline interpolation (smooth curve through points)
   */
  function catmullRom(p0, p1, p2, p3, t) {
    const v0 = (p2.x - p0.x) * 0.5;
    const v1 = (p3.x - p1.x) * 0.5;
    const y0 = (p2.y - p0.y) * 0.5;
    const y1 = (p3.y - p1.y) * 0.5;

    const t2 = t * t;
    const t3 = t * t2;

    return {
      x: (2 * p1.x - 2 * p2.x + v0 + v1) * t3 + (3 * p2.x - 3 * p1.x - 2 * v0 - v1) * t2 + v0 * t + p1.x,
      y: (2 * p1.y - 2 * p2.y + y0 + y1) * t3 + (3 * p2.y - 3 * p1.y - 2 * y0 - y1) * t2 + y0 * t + p1.y,
    };
  }

  // ── Kepler Orbital Mechanics ───────────────────────────────────────────────

  /**
   * Compute Mean Anomaly -> True Anomaly using Newton-Raphson method
   */
  function solveKeplerEquation(M, e, maxIterations = 5) {
    let E = M; // Initial guess
    for (let i = 0; i < maxIterations; i++) {
      const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      if (Math.abs(dE) < 1e-6) break;
      E -= dE;
    }
    // True Anomaly from Eccentric Anomaly
    const cosE = Math.cos(E);
    const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    return nu;
  }

  /**
   * Compute position on elliptical orbit
   * @param {number} t - Progress [0, 1]
   * @param {number} a - Semi-major axis (au or pixels)
   * @param {number} e - Eccentricity [0, 1)
   * @param {number} M0 - Mean anomaly at t=0 (radians)
   * @param {number} i - Inclination (radians)
   * @param {number} w - Argument of periapsis (radians)
   * @param {number} Omega - Longitude of ascending node (radians)
   * @returns {{x, y}} Position in 2D
   */
  function ellipticalOrbitPosition(t, a, e, M0, i = 0, w = 0, Omega = 0) {
    const M = M0 + 2 * Math.PI * t; // Mean anomaly at time t
    const nu = solveKeplerEquation(M, e); // True anomaly

    // Distance from focus
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));

    // Position in orbital plane
    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);
    const xOrb = r * cosNu;
    const yOrb = r * sinNu;

    // Rotate by argument of periapsis
    const cosW = Math.cos(w);
    const sinW = Math.sin(w);
    const xp = xOrb * cosW - yOrb * sinW;
    const yp = xOrb * sinW + yOrb * cosW;

    // Rotate by inclination (simplified 2D projection)
    const cosI = Math.cos(i);
    const sinI = Math.sin(i);
    const xpp = xp;
    const ypp = yp * cosI;

    // Rotate by longitude of ascending node
    const cosOmega = Math.cos(Omega);
    const sinOmega = Math.sin(Omega);
    const x = xpp * cosOmega - ypp * sinOmega;
    const y = xpp * sinOmega + ypp * cosOmega;

    return { x, y };
  }

  // ── Trajectory Renderer ────────────────────────────────────────────────────

  class TrajectoryRenderer {
    constructor() {
      this.segmentCache = new Map();
    }

    /**
     * Interpolate position on trajectory
     * @param {Object} trajectory - Trajectory config
     * @param {number} progress - [0, 1]
     * @returns {{x, y}} Position
     */
    interpolatePosition(trajectory, progress) {
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const points = trajectory.points || [];

      if (points.length === 0) return { x: 0, y: 0 };
      if (points.length === 1) return { x: points[0].x || 0, y: points[0].y || 0 };

      const type = String(trajectory.type || 'linear').toLowerCase();

      switch (type) {
        case 'linear':
          return this._interpolateLinear(points, clampedProgress);
        case 'quadratic-bezier':
          return this._interpolateQuadraticBezier(points, clampedProgress);
        case 'cubic-bezier':
          return this._interpolateCubicBezier(points, clampedProgress);
        case 'catmull-rom':
          return this._interpolateCatmullRom(points, clampedProgress);
        case 'ellipse':
          return this._interpolateEllipse(trajectory, clampedProgress);
        default:
          return this._interpolateLinear(points, clampedProgress);
      }
    }

    _interpolateLinear(points, progress) {
      if (points.length === 0) return { x: 0, y: 0 };
      if (points.length === 1) return points[0];

      const scaledProgress = progress * (points.length - 1);
      const segmentIndex = Math.floor(scaledProgress);
      const segmentProgress = scaledProgress - segmentIndex;

      const p0 = points[segmentIndex];
      const p1 = points[Math.min(segmentIndex + 1, points.length - 1)];

      return linearInterpolate(p0, p1, segmentProgress);
    }

    _interpolateQuadraticBezier(points, progress) {
      if (points.length < 3) return this._interpolateLinear(points, progress);

      // Use all points as control points
      const scaledProgress = progress * (points.length - 2);
      const segmentIndex = Math.floor(scaledProgress);
      const segmentProgress = scaledProgress - segmentIndex;

      const p0 = points[segmentIndex];
      const p1 = points[segmentIndex + 1];
      const p2 = points[Math.min(segmentIndex + 2, points.length - 1)];

      return quadraticBezier(p0, p1, p2, segmentProgress);
    }

    _interpolateCubicBezier(points, progress) {
      if (points.length < 4) return this._interpolateLinear(points, progress);

      const scaledProgress = progress * (Math.floor(points.length / 2) - 1);
      const segmentIndex = Math.floor(scaledProgress);
      const segmentProgress = scaledProgress - segmentIndex;

      const idx = segmentIndex * 2;
      const p0 = points[idx];
      const p1 = points[Math.min(idx + 1, points.length - 1)];
      const p2 = points[Math.min(idx + 2, points.length - 1)];
      const p3 = points[Math.min(idx + 3, points.length - 1)];

      return cubicBezier(p0, p1, p2, p3, segmentProgress);
    }

    _interpolateCatmullRom(points, progress) {
      if (points.length < 4) return this._interpolateLinear(points, progress);

      const scaledProgress = progress * (points.length - 3);
      const segmentIndex = Math.floor(scaledProgress);
      const segmentProgress = scaledProgress - segmentIndex;

      const p0 = points[Math.max(segmentIndex - 1, 0)];
      const p1 = points[segmentIndex];
      const p2 = points[Math.min(segmentIndex + 1, points.length - 1)];
      const p3 = points[Math.min(segmentIndex + 2, points.length - 1)];

      return catmullRom(p0, p1, p2, p3, segmentProgress);
    }

    _interpolateEllipse(trajectory, progress) {
      const a = Number(trajectory.semiMajorAxis || 100);
      const e = Math.max(0, Math.min(0.999, Number(trajectory.eccentricity || 0)));
      const M0 = Number(trajectory.meanAnomalyStart || 0);
      const i = Number(trajectory.inclination || 0);
      const w = Number(trajectory.argumentOfPeriapsis || 0);
      const Omega = Number(trajectory.longitudeOfNode || 0);

      const center = trajectory.center || { x: 0, y: 0 };
      const pos = ellipticalOrbitPosition(progress, a, e, M0, i, w, Omega);

      return {
        x: center.x + pos.x,
        y: center.y + pos.y,
      };
    }

    /**
     * Draw complete trajectory path
     */
    drawTrajectory(ctx, trajectory, viewport = {}) {
      const style = trajectory.style || {};
      const color = style.trailColor || 'rgba(100, 200, 255, 0.6)';
      const lineWidth = Number(style.trailWidth || 2);
      const segments = Math.max(10, Number(trajectory.pathSegments || 50));

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      let firstPoint = true;
      for (let i = 0; i <= segments; i++) {
        const progress = i / segments;
        const point = this.interpolatePosition(trajectory, progress);

        if (firstPoint) {
          ctx.moveTo(point.x, point.y);
          firstPoint = false;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }

      ctx.stroke();
    }

    /**
     * Draw trail from start to current progress
     */
    drawTrail(ctx, trajectory, progress, viewport = {}) {
      const style = trajectory.style || {};
      const color = style.trailColor || 'rgba(100, 200, 255, 0.6)';
      const lineWidth = Number(style.trailWidth || 2);
      const segments = Math.max(10, Number(trajectory.pathSegments || 50));

      const trailSegments = Math.ceil(segments * Math.max(0, Math.min(1, progress)));

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      let firstPoint = true;
      for (let i = 0; i <= trailSegments; i++) {
        const p = i / segments;
        const point = this.interpolatePosition(trajectory, p);

        if (firstPoint) {
          ctx.moveTo(point.x, point.y);
          firstPoint = false;
        } else {
          ctx.lineTo(point.x, point.y);
        }
      }

      ctx.stroke();
    }

    /**
     * Draw animated head/marker at current position
     */
    drawMovingHead(ctx, trajectory, progress, viewport = {}) {
      const style = trajectory.style || {};
      const headColor = style.headColor || 'rgba(100, 200, 255, 1)';
      const headRadius = Number(style.headRadius || 4);
      const glowColor = style.glowColor || 'rgba(100, 200, 255, 0.4)';
      const glowWidth = Number(style.glowWidth || 8);

      const pos = this.interpolatePosition(trajectory, progress);

      // Glow
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, glowWidth, 0, Math.PI * 2);
      ctx.fill();

      // Head dot
      ctx.fillStyle = headColor;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, headRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    /**
     * Draw velocity vector (arrow) at current position
     */
    drawVelocityVector(ctx, trajectory, progress, scale = 1.0, viewport = {}) {
      const dt = 0.02; // Small delta for derivative
      const p1 = this.interpolatePosition(trajectory, Math.max(0, progress - dt));
      const p2 = this.interpolatePosition(trajectory, Math.min(1, progress + dt));

      const dx = (p2.x - p1.x) * scale;
      const dy = (p2.y - p1.y) * scale;
      const len = Math.hypot(dx, dy);

      if (len < 1) return;

      const style = trajectory.style || {};
      const color = style.velocityColor || 'rgba(255, 100, 100, 0.8)';
      const arrowLen = Math.max(6, len * 0.4);
      const arrowHalfWidth = 3;

      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;

      const pos = this.interpolatePosition(trajectory, progress);
      const tipX = pos.x + dx;
      const tipY = pos.y + dy;
      const baseX = tipX - ux * arrowLen;
      const baseY = tipY - uy * arrowLen;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(baseX + nx * arrowHalfWidth, baseY + ny * arrowHalfWidth);
      ctx.lineTo(baseX - nx * arrowHalfWidth, baseY - ny * arrowHalfWidth);
      ctx.closePath();
      ctx.fill();
    }

    /**
     * Draw full trajectory with trail and moving head
     */
    render(ctx, trajectory, progress, viewport = {}) {
      if (!trajectory || !ctx) return;

      const showTrail = trajectory.showTrail !== false;
      const showPath = trajectory.showPath !== false;
      const showHead = trajectory.showHead !== false;
      const showVelocity = trajectory.showVelocity === true;

      if (showPath) {
        this.drawTrajectory(ctx, trajectory, viewport);
      }

      if (showTrail) {
        this.drawTrail(ctx, trajectory, progress, viewport);
      }

      if (showHead) {
        this.drawMovingHead(ctx, trajectory, progress, viewport);
      }

      if (showVelocity) {
        this.drawVelocityVector(ctx, trajectory, progress, 1.0, viewport);
      }
    }

    /**
     * Add trajectory to overlay data
     */
    static fromFleetData(fleet, options = {}) {
      const origin = fleet.pos || fleet.origin || fleet.from || { x: 0, y: 0 };
      const target = fleet.target || fleet.to || fleet.destination || { x: 0, y: 0 };

      return {
        id: fleet.id || `fleet-${Date.now()}`,
        points: [origin, target],
        type: 'linear',
        style: {
          trailColor: options.trailColor || 'rgba(120, 255, 215, 0.6)',
          trailWidth: options.trailWidth || 2,
          headColor: options.headColor || 'rgba(120, 255, 215, 1)',
          headRadius: options.headRadius || 3,
          glowColor: options.glowColor || 'rgba(120, 255, 215, 0.3)',
          glowWidth: options.glowWidth || 8,
        },
        animated: true,
        showTrail: true,
        showHead: true,
        showPath: false,
        showVelocity: false,
      };
    }

    clear() {
      this.segmentCache.clear();
    }

    destroy() {
      this.clear();
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    window.TrajectoryRenderer = TrajectoryRenderer;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrajectoryRenderer;
  }
})();
