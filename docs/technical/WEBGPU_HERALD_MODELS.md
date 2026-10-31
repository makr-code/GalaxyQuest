# WebGPU Herald Models

The herald room prefers a local rigged GLB generated from MakeHuman Community via MPFB. The output is development-only and ignored by git.

## Requirements

- Blender 4.4 or newer
- MPFB 2 enabled in Blender
- The bundled MPFB `game_engine` rig

## Export

Run `npm run export:herald-base`, or pass a non-default Blender path with `scripts/export_mpfb_herald_base.ps1 -BlenderPath <path>`. The script writes:

- `generated/dev-only/heralds/generic_humanoid_base.glb`
- `generated/dev-only/heralds/generic_humanoid_base.json`

The GLB contains a skinned mesh and two animation clips: `Idle_Breathing` and `Greeting_Wave`. The browser clones that skeleton once per mentor, applies the clips with Three.js `AnimationMixer`, and renders through Three.js `WebGPURenderer`. If the local GLB is absent, the herald room falls back to its built-in WebGPU meshes and existing species JSON models.

Before using generated models outside development, review the MakeHuman/MPFB asset and redistribution terms and record the applicable credits.