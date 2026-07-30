/**
 * physics-worker.js
 *
 * WebWorker for computationally intensive physics calculations.
 * Offloads CPU physics from main render thread to keep framerates stable.
 *
 * Tasks:
 *   - integrateVelocity: Update position based on velocity
 *   - computeGravity: Calculate gravitational forces
 *   - broadcastCollisionPairs: Narrow-phase collision detection
 *   - updateAccelerations: Accumulate forces on entities
 *
 * Usage (in main thread):
 *   const physicsWorker = new WorkerPool({
 *     workerScript: '/js/engine/workers/physics-worker.js',
 *     maxWorkers: 2,
 *   });
 *
 *   const result = await physicsWorker.execute('integrateVelocity', {
 *     entities: [{ id: 1, x: 0, y: 0, vx: 10, vy: 0 }, ...],
 *     dt: 0.016,
 *   });
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// Import protocol
if (typeof WorkerProtocol === 'undefined') {
  importScripts('/js/engine/workers/WorkerProtocol.js');
}

/**
 * Physics constants
 */
const PHYSICS_CONFIG = {
  G: 6.67430e-11,           // Gravitational constant (SI units)
  G_GAME: 1e6,              // Scaled gravitational constant for game units
  MAX_VELOCITY: 1e6,        // Max velocity clamp
  COLLISION_MARGIN: 10,     // Collision detection margin
  VELOCITY_DAMPING: 0.9999, // Velocity decay per frame
};

/**
 * Task handlers
 */
const taskHandlers = {
  /**
   * Integrate velocity and update positions.
   * Standard Verlet or Euler integration.
   *
   * @param {Object} data
   *   - entities: Array<{ id, x, y, z, vx, vy, vz, mass?, radius? }>
   *   - dt: number (time step in seconds)
   *   - damping: number (optional, default 0.9999)
   * @returns {Object} { entities: Array<{id, x, y, z, vx, vy, vz}> }
   */
  'integrateVelocity': (data) => {
    const { entities = [], dt = 0.016, damping = PHYSICS_CONFIG.VELOCITY_DAMPING } = data;

    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    const result = entities.map(entity => {
      const { id, x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0 } = entity;

      // Apply damping (air resistance, energy loss)
      const dampedVx = vx * damping;
      const dampedVy = vy * damping;
      const dampedVz = vz * damping;

      // Clamp velocity to max
      const vMag = Math.sqrt(dampedVx * dampedVx + dampedVy * dampedVy + dampedVz * dampedVz);
      let finalVx = dampedVx;
      let finalVy = dampedVy;
      let finalVz = dampedVz;

      if (vMag > PHYSICS_CONFIG.MAX_VELOCITY) {
        const scale = PHYSICS_CONFIG.MAX_VELOCITY / vMag;
        finalVx *= scale;
        finalVy *= scale;
        finalVz *= scale;
      }

      // Update position: p' = p + v*dt
      const newX = x + finalVx * dt;
      const newY = y + finalVy * dt;
      const newZ = z + finalVz * dt;

      return {
        id,
        x: newX,
        y: newY,
        z: newZ,
        vx: finalVx,
        vy: finalVy,
        vz: finalVz,
      };
    });

    return {
      entities: result,
      integratedCount: result.length,
      dtUsed: dt,
    };
  },

  /**
   * Compute gravitational acceleration between entities.
   * N-body gravity simulation.
   *
   * @param {Object} data
   *   - entities: Array<{ id, x, y, z, mass }>
   *   - G: number (gravitational constant, optional)
   *   - minDistance: number (avoid singularities, default 100)
   * @returns {Object} { accelerations: Array<{ id, ax, ay, az }> }
   */
  'computeGravity': (data) => {
    const {
      entities = [],
      G = PHYSICS_CONFIG.G_GAME,
      minDistance = 100,
    } = data;

    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    const n = entities.length;
    const accelerations = new Array(n).fill(null).map((_, i) => ({
      id: entities[i].id,
      ax: 0,
      ay: 0,
      az: 0,
    }));

    // N-body gravity: for each pair, compute force
    for (let i = 0; i < n; i++) {
      const entity_i = entities[i];
      const { x: x1, y: y1, z: z1, mass: m1 } = entity_i;

      for (let j = i + 1; j < n; j++) {
        const entity_j = entities[j];
        const { x: x2, y: y2, z: z2, mass: m2 } = entity_j;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < minDistance * minDistance) {
          continue; // Avoid singularity
        }

        const dist = Math.sqrt(distSq);
        const force = G * m1 * m2 / distSq;
        const accel = force / (m1 * m2); // Normalized by both masses

        const ax = accel * (dx / dist);
        const ay = accel * (dy / dist);
        const az = accel * (dz / dist);

        // Apply force to both entities (Newton's 3rd law)
        accelerations[i].ax += ax / m1;
        accelerations[i].ay += ay / m1;
        accelerations[i].az += az / m1;

        accelerations[j].ax -= ax / m2;
        accelerations[j].ay -= ay / m2;
        accelerations[j].az -= az / m2;
      }
    }

    return {
      accelerations,
      pairsProcessed: (n * (n - 1)) / 2,
    };
  },

  /**
   * Broad-phase collision detection.
   * Returns pairs of entities that may be colliding.
   *
   * @param {Object} data
   *   - entities: Array<{ id, x, y, z, radius }>
   *   - maxDistance: number (only check pairs within this distance)
   * @returns {Object} { collisionPairs: Array<[id1, id2]> }
   */
  'broadcastCollisionPairs': (data) => {
    const { entities = [], maxDistance = 1000 } = data;

    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    const collisionPairs = [];
    const n = entities.length;

    for (let i = 0; i < n; i++) {
      const entity_i = entities[i];
      const { id: id1, x: x1, y: y1, z: z1, radius: r1 = 10 } = entity_i;

      for (let j = i + 1; j < n; j++) {
        const entity_j = entities[j];
        const { id: id2, x: x2, y: y2, z: z2, radius: r2 = 10 } = entity_j;

        const dx = x2 - x1;
        const dy = y2 - y1;
        const dz = z2 - z1;
        const distSq = dx * dx + dy * dy + dz * dz;

        const minDist = r1 + r2 + PHYSICS_CONFIG.COLLISION_MARGIN;
        if (distSq < minDist * minDist && distSq < maxDistance * maxDistance) {
          collisionPairs.push([id1, id2]);
        }
      }
    }

    return {
      collisionPairs,
      pairCount: collisionPairs.length,
    };
  },

  /**
   * Update velocities from accelerations using Euler integration.
   *
   * @param {Object} data
   *   - entities: Array<{ id, vx, vy, vz, ax, ay, az }>
   *   - dt: number (time step)
   * @returns {Object} { entities: Array<{id, vx, vy, vz}> }
   */
  'updateAccelerations': (data) => {
    const { entities = [], dt = 0.016 } = data;

    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    const result = entities.map(entity => {
      const { id, vx = 0, vy = 0, vz = 0, ax = 0, ay = 0, az = 0 } = entity;

      // v' = v + a*dt
      const newVx = vx + ax * dt;
      const newVy = vy + ay * dt;
      const newVz = vz + az * dt;

      return {
        id,
        vx: newVx,
        vy: newVy,
        vz: newVz,
      };
    });

    return {
      entities: result,
      updatedCount: result.length,
    };
  },

  /**
   * Compute full physics step: gravity + velocity integration.
   * Combined operation for efficiency.
   *
   * @param {Object} data
   *   - entities: Array<{ id, x, y, z, vx, vy, vz, mass, radius }>
   *   - dt: number (time step)
   *   - G: number (gravitational constant, optional)
   * @returns {Object} { entities: Array<{id, x, y, z, vx, vy, vz}> }
   */
  'fullPhysicsStep': async (data) => {
    const { entities = [], dt = 0.016, G = PHYSICS_CONFIG.G_GAME } = data;

    if (!Array.isArray(entities)) {
      throw new Error('entities must be an array');
    }

    // Step 1: Compute gravity
    const gravResult = taskHandlers.computeGravity({
      entities,
      G,
    });

    // Step 2: Update velocities from accelerations
    const accelData = entities.map((e, i) => ({
      id: e.id,
      vx: e.vx || 0,
      vy: e.vy || 0,
      vz: e.vz || 0,
      ax: gravResult.accelerations[i].ax,
      ay: gravResult.accelerations[i].ay,
      az: gravResult.accelerations[i].az,
    }));

    const velResult = taskHandlers.updateAccelerations({
      entities: accelData,
      dt,
    });

    // Step 3: Integrate positions
    const posData = entities.map((e, i) => ({
      id: e.id,
      x: e.x || 0,
      y: e.y || 0,
      z: e.z || 0,
      vx: velResult.entities[i].vx,
      vy: velResult.entities[i].vy,
      vz: velResult.entities[i].vz,
    }));

    const posResult = taskHandlers.integrateVelocity({
      entities: posData,
      dt,
    });

    return {
      entities: posResult.entities,
      pairsProcessed: gravResult.pairsProcessed,
      physicsStepsCompleted: 1,
    };
  },
};

/**
 * Set up message listener
 */
self.onmessage = WorkerProtocol.createMessageHandler(taskHandlers);

console.log('[PhysicsWorker] Initialized');
