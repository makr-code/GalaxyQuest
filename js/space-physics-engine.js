/*
 * Space Physics Engine
 * Shared Newtonian-style helpers for spaceflight (gravity, inertia, thrust integration).
 */
(function () {
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function vec3(x = 0, y = 0, z = 0) {
    return { x, y, z };
  }

  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  function scale(v, s) {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  function length(v) {
    return Math.hypot(v.x, v.y, v.z);
  }

  function normalize(v) {
    const len = length(v) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  function limit(v, maxLen) {
    const len = length(v);
    if (!maxLen || len <= maxLen) return v;
    const f = maxLen / Math.max(1e-9, len);
    return scale(v, f);
  }

  class SpacePhysicsEngine {
    constructor(options = {}) {
      this.G = Number(options.gravitationalConstant || 9.5e-4);
      this.softening = Math.max(0.01, Number(options.softening || 180));
      this.maxAcceleration = Math.max(0.001, Number(options.maxAcceleration || 420));
      this.defaultDrag = clamp(Number(options.defaultDrag || 0.0008), 0, 0.2);
      this.bodies = new Map();
      this.nextBodyId = 1;
    }

    createBody(options = {}) {
      const id = this.nextBodyId++;
      const body = {
        id,
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
        thrust: vec3(0, 0, 0),
        drag: clamp(Number(options.drag ?? this.defaultDrag), 0, 0.2),
        maxSpeed: Math.max(0, Number(options.maxSpeed || 0)),
        staticBody: options.staticBody === true,
      };
      this.bodies.set(id, body);
      return body;
    }

    removeBody(bodyOrId) {
      const id = typeof bodyOrId === 'number' ? bodyOrId : Number(bodyOrId?.id || 0);
      if (!id) return;
      this.bodies.delete(id);
    }

    computeGravityAt(position, sources = []) {
      const p = position || vec3(0, 0, 0);
      let acc = vec3(0, 0, 0);

      for (let i = 0; i < sources.length; i += 1) {
        const src = sources[i];
        if (!src || !src.position) continue;
        const mass = Math.max(0, Number(src.mass || 0));
        if (mass <= 0) continue;

        const delta = sub(src.position, p);
        const r2 = (delta.x * delta.x) + (delta.y * delta.y) + (delta.z * delta.z) + (this.softening * this.softening);
        const invR = 1 / Math.sqrt(Math.max(1e-9, r2));
        const invR3 = invR * invR * invR;
        const factor = this.G * mass * invR3;

        acc.x += delta.x * factor;
        acc.y += delta.y * factor;
        acc.z += delta.z * factor;
      }

      return limit(acc, this.maxAcceleration);
    }

    stepBody(body, dtSeconds, options = {}) {
      if (!body || body.staticBody) return body;

      const dt = Math.max(0, Number(dtSeconds || 0));
      if (dt <= 0) return body;

      const gravity = this.computeGravityAt(body.position, Array.isArray(options.gravitySources) ? options.gravitySources : []);
      const external = options.externalAcceleration || vec3(0, 0, 0);
      const thrust = options.thrust || body.thrust || vec3(0, 0, 0);

      const accel = limit(
        add(add(gravity, external), thrust),
        this.maxAcceleration
      );

      body.velocity = add(body.velocity, scale(accel, dt));

      const dragFactor = clamp(1 - (body.drag * dt), 0, 1);
      body.velocity = scale(body.velocity, dragFactor);

      if (body.maxSpeed > 0) {
        body.velocity = limit(body.velocity, body.maxSpeed);
      }

      body.position = add(body.position, scale(body.velocity, dt));
      return body;
    }
  }

  function createSpacePhysicsEngine(options = {}) {
    return new SpacePhysicsEngine(options);
  }

  window.GQSpacePhysicsEngine = {
    SpacePhysicsEngine,
    create: createSpacePhysicsEngine,
    math: { vec3, add, sub, scale, length, normalize, limit },
  };
})();
