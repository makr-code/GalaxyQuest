// GalaxyQuest Engine — particles.wgsl
// GPU compute shader: particle simulation for weapon fire, explosions & shield impacts.
//
// Each @workgroup_size(64) invocation processes one particle.
// Storage buffer layout mirrors the JS-side Particle struct in ParticleSystem.js.
//
// Bind-group 0:
//   binding 0 → storage buffer  (read_write) — particle pool
//   binding 1 → uniform buffer              — SimParams
//
// Dispatch: ceil(particleCount / 64) workgroups along X.
// The shader uses arrayLength(&particles) to guard each invocation, so
// the host should supply the exact particle buffer length — not a fixed MAX_PARTICLES.
//
// Inspired by:
//   WebGPU Samples (Apache 2.0) — https://github.com/webgpu/webgpu-samples
//   Babylon.js ComputeShader (Apache 2.0) — https://github.com/BabylonJS/Babylon.js
//
// License: MIT — makr-code/GalaxyQuest

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

/**
 * One entry in the GPU particle pool.
 * Byte-layout (64 bytes, 16 × f32):
 *   [0-2]  position.xyz   [3]    lifetime (remaining, seconds)
 *   [4-6]  velocity.xyz   [7]    age (elapsed since spawn, seconds)
 *   [8]    colorR         [9]    colorG    [10]   colorB    [11]   size
 *   [12]   active (u32)   [13-15] _pad (u32)
 */
struct Particle {
  position  : vec3<f32>,
  lifetime  : f32,        // remaining seconds; ≤ 0 → mark inactive
  velocity  : vec3<f32>,
  age       : f32,        // elapsed seconds since spawn
  colorR    : f32,
  colorG    : f32,
  colorB    : f32,
  size      : f32,        // current display radius
  active    : u32,        // 1 = alive, 0 = dead / available
  _pad0     : u32,
  _pad1     : u32,
  _pad2     : u32,
}

/** Per-dispatch simulation parameters. */
struct SimParams {
  dt      : f32,    // fixed time-step (seconds)
  gravity : f32,    // Y-down acceleration (world-units / s²); 0 = space
  drag    : f32,    // velocity damping factor per second (0 = frictionless)
  _pad    : f32,
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform>             params    : SimParams;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) { return; }

  var p = particles[i];
  if (p.active == 0u) { return; }    // skip dead particles

  let dt = params.dt;

  // --- integrate lifetime ---
  p.age      += dt;
  p.lifetime -= dt;

  if (p.lifetime <= 0.0) {
    p.active = 0u;
    particles[i] = p;
    return;
  }

  // --- physics ---
  // Exponential drag approximation (stable for large dt values)
  let damping = max(0.0, 1.0 - params.drag * dt);
  p.velocity  = p.velocity * damping;

  // Gravity (Y-down; set params.gravity = 0 for zero-g space combat)
  p.velocity.y -= params.gravity * dt;

  // Euler integration
  p.position = p.position + p.velocity * dt;

  particles[i] = p;
}
