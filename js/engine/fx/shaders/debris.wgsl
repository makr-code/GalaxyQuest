// GalaxyQuest Engine — debris.wgsl
// GPU compute shader: rigid-body debris chunk simulation (Phase FX-6).
//
// Each invocation processes one debris chunk: integrates linear velocity,
// angular velocity and a global drag coefficient.  The result is written
// back to the storage buffer so the renderer can read chunk positions and
// orientations directly from GPU memory.
//
// Bind-group 0:
//   binding 0 → storage buffer  (read_write) — DebrisChunk pool
//   binding 1 → uniform buffer              — DebrisSimParams
//
// Dispatch: ceil(chunkCount / 64) workgroups along X.
// The shader guards each invocation with arrayLength(), so the host need
// not pad the buffer to a multiple of 64.
//
// Struct byte-layout (96 bytes, 24 × f32):
//   [0-2]   position.xyz         [3]  vx (linear vel x)
//   [4-5]   vy, vz               [6]  rotX  [7]  rotY  [8]  rotZ
//   [9-11]  angVelX, angVelY, angVelZ
//   [12]    scale                [13] drag
//   [14]    lifetime             [15] active (u32-cast f32: 0=dead, 1=alive)
//   [16-23] _pad (8 × f32)       — reserved, keeps struct at 96 bytes
//
// Inspired by:
//   FreeSpace 2 debris simulation (1999, Volition) — tumbling wreckage
//   Homeworld debris physics     (1999, Relic)      — zero-g rigid bodies
//   Unity Physics (MIT API) — rigidbody angular velocity integration
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/**
 * One debris chunk in the GPU pool.
 * 96-byte aligned (24 × f32).
 */
struct DebrisChunk {
  // Linear state
  px        : f32,  // position x
  py        : f32,  // position y
  pz        : f32,  // position z
  vx        : f32,  // velocity x (units/s)

  vy        : f32,  // velocity y
  vz        : f32,  // velocity z
  rotX      : f32,  // Euler angle x (radians) — read by renderer
  rotY      : f32,  // Euler angle y

  rotZ      : f32,  // Euler angle z
  angVelX   : f32,  // angular velocity x (rad/s)
  angVelY   : f32,  // angular velocity y
  angVelZ   : f32,  // angular velocity z

  scale     : f32,  // uniform mesh scale
  drag      : f32,  // linear drag coefficient (velocity lost per second)
  lifetime  : f32,  // remaining lifetime (seconds); 0 = permanent
  active    : f32,  // 1.0 = alive, 0.0 = dead (float for alignment)

  // Reserved
  _r0       : f32,
  _r1       : f32,
  _r2       : f32,
  _r3       : f32,
  _r4       : f32,
  _r5       : f32,
  _r6       : f32,
  _r7       : f32,
}

/** Per-dispatch simulation parameters (16 bytes). */
struct DebrisSimParams {
  dt       : f32,   // fixed delta-time (seconds)
  angDrag  : f32,   // angular drag fraction per second (gyroscopic damping)
  _pad0    : f32,
  _pad1    : f32,
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<storage, read_write> chunks : array<DebrisChunk>;
@group(0) @binding(1) var<uniform>             params : DebrisSimParams;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&chunks)) { return; }

  var c = chunks[i];
  if (c.active < 0.5) { return; }  // skip dead chunks

  let dt = params.dt;

  // --- lifetime ---
  if (c.lifetime > 0.0) {
    c.lifetime -= dt;
    if (c.lifetime <= 0.0) {
      c.active = 0.0;
      chunks[i] = c;
      return;
    }
  }

  // --- linear drag (exponential approximation) ---
  let linDamp = max(0.0, 1.0 - c.drag * dt);
  c.vx *= linDamp;
  c.vy *= linDamp;
  c.vz *= linDamp;

  // --- integrate linear position (Euler) ---
  c.px += c.vx * dt;
  c.py += c.vy * dt;
  c.pz += c.vz * dt;

  // --- angular drag ---
  let angDamp = max(0.0, 1.0 - params.angDrag * dt);
  c.angVelX *= angDamp;
  c.angVelY *= angDamp;
  c.angVelZ *= angDamp;

  // --- integrate Euler angles ---
  c.rotX += c.angVelX * dt;
  c.rotY += c.angVelY * dt;
  c.rotZ += c.angVelZ * dt;

  // Wrap angles to [-π, π] to avoid float precision loss over time
  let PI = 3.14159265358979;
  let TWO_PI = 2.0 * PI;
  c.rotX = c.rotX - TWO_PI * floor((c.rotX + PI) / TWO_PI);
  c.rotY = c.rotY - TWO_PI * floor((c.rotY + PI) / TWO_PI);
  c.rotZ = c.rotZ - TWO_PI * floor((c.rotZ + PI) / TWO_PI);

  chunks[i] = c;
}
