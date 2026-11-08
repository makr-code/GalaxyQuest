# Native WebGPU Hero Battle implementation

## Goal and boundaries

Build a reproducible, client-only quality scene with two ship classes, authored
hardpoints and articulated turrets; distinct weapon sequences; shield/hull
reactions; occlusion, HDR bloom, spatial audio and replay measurements.
Keep Three.js transforms and WebGPU rendering. Do not mutate backend state,
invent production hit records, or introduce a gameplay tick.

## Implementation order

1. **Model contract:** procedural QA frigate/cruiser models with named turret
   pivots and muzzle nodes. Extract normalized model transforms alongside hull
   geometry; render articulated turret geometry with independent instance
   matrices. Preserve existing GLB loading and normalized coordinates.
2. **Weapon sequences:** time-based turret aiming with angular limits,
   charge/discharge/recoil/recovery, deterministic staggered salvos.
   Keep detached projectile launch snapshots and explicit target endpoints.
3. **Impact contract:** fixture-defined miss/shield/hull outcomes only.
   Localized shield contact and surface ripple; hull sparks and persistent
   short-lived glow. No damage calculation or automatic collision hit.
4. **Occlusion and lighting:** shared GPU depth for opaque ship meshes and
   weapon geometry; opaque planetary depth proxy matching the spatial view.
   HDR color target, existing bloom compositor, bounded transient hull light.
   Preserve the normal rendering path when the hero scene is inactive.
5. **Audio:** explicitly enabled, bounded spatial Web Audio voices; camera-
   relative positioning and normalized scene distance; stop/disconnect every
   voice on cleanup. No autoplay or changes to music state.
6. **Replay and measurements:** seed, replay-local monotonic clock, explicit
   near/middle/system view presets, shot/outcome counters, bounded CPU/frame
   samples and asynchronous WebGPU timestamp measurements when supported.
   Report unavailable GPU timing explicitly; CPU time is not a GPU proxy.
7. **Validation:** focused unit/regression tests, ESLint, production build,
   live WebGPU error scopes, moving ships and all weapon families, screenshot,
   deterministic replay checks, cleanup and zero backend mutations.

## Acceptance

- Two visibly distinct QA classes; model-derived muzzle anchors and articulated
  turrets remain coherent under translation, rotation and scale.
- Turret motion is bounded, firing cadence is deterministic and projectiles
  do not remain attached to moving launchers.
- Misses have no impacts; shield/hull cues begin at recorded visual arrival.
- Occluded weapons are hidden; HDR/bloom and transient lighting remain bounded.
- Audio requires opt-in and obeys lifecycle cleanup.
- Replay reports seed, duration, shots, outcome counts, CPU/frame statistics,
  draw/primitive limits and GPU timing availability.
- Stop, expiry, page hiding, system changes and failed setup remove only
  preview-owned objects/resources and restore the original camera when valid.
- Existing production ship rendering and legacy combat routing remain intact.

## Performance targets

Keep the existing 64-shot/768-primitive cap. The initial reference workload is
four QA ships at 1080p. A proposed VFX GPU budget is 2 ms, measured rather than
assumed; it is not a certified threshold until reference hardware is recorded.
Measure near/middle/system presets before extending to large fleet workloads.

## Follow-up, not part of this diagnostic scene

Shared multi-phase combat rules, player orders and LLM NPC preparation remain
planned in
[Battle engine integration](./BATTLE_ENGINE_INTEGRATION_PLAN.md).
That plan covers NPC/player, player/player and NPC/NPC encounters. The
diagnostic Hero preview remains a non-authoritative QA fixture.

Real model art/textures, faction-specific authoring and audio recordings;
fleet-scale LOD and GPU particle simulation; destruction/debris replay.
Aggregated battle reports remain illustrative, not individual shot/hit
evidence.

## Production replay for completed legacy encounters

The fleet window's recent battle reports can open a participant-authorized,
read-only encounter replay. It loads the immutable `legacy-v1` outcome through
`api/fleet.php?action=battle_encounter&report_id=...`, navigates to the
recorded system, and starts `renderer.startBattleEncounterPresentation()`.
Only the stored starting compositions, losses, survivors, winner and aggregate
round-pressure values are shown.

The scene uses capped generic ship proxies and at most one non-impact pressure
cue per side and reported round. It does not infer a ship's weapon, individual
shot, target, hit, shield damage or destruction time. The result overlay
distinguishes exact server counts from illustrative visuals. Replay GETs do
not process a battle, and the feature does not introduce a gameplay tick.

Encounter replay requires the existing battle-encounter migration and
`BATTLE_ENCOUNTERS_ENABLED=1`; the flag remains off by default. Reports without
a journaled encounter, including historical reports, are not replayable. The
battle-reports API marks each report with `replay_available`; it fails closed
when the feature flag is off, a required journal table is missing, or a journal
table is not InnoDB. The fleet UI only offers replay for reports marked
available.

## Implemented diagnostic reference

The seven implementation blocks are present in the native renderer:

- Procedural frigate/cruiser hulls with extracted named hardpoints and separate
  articulated turret geometry.
- Moving muzzle charge-up, bounded turret aiming, recoil/recovery and all six
  weapon families with detached projectile paths.
- Explicit fixture miss/shield/hull outcomes; local moving contact anchors,
  spherical shield waves, hull sparks and transient surface light.
- Opaque ship and spherical celestial depth proxies; depth-tested additive
  VFX; filterable `rgba16float` scene color and the existing bloom compositor.
- Opt-in HRTF audio with shared master/SFX settings and eight-voice limit.
- Seeded 60-Hz presentation replay, three camera presets, bounded reports and
  genuine optional WebGPU timestamp readbacks.
- Owner-scoped asynchronous cleanup, preserved ordinary-effect clocks and
  paused/resumable pre-existing camera flight.

The public entry point is `renderer.startHeroBattlePreview(options)`; its lazy
module is emitted by the production build. Usage and contracts are documented
in [Weapon Fire Integration](WEAPON_FIRE_INTEGRATION.md).

## Validation evidence

- Six focused test files: **146 tests passed**. Coverage includes model/rig
  normalization, turret limits, frame-rate-independent shot logs, moving
  charge/contact anchors, separate effect clocks, camera ownership, preview
  cleanup, real/failed/unsupported timestamps and partial audio-startup cleanup.
- Renderer ESLint passed; production Vite build passed. The build reports its
  large-chunk warning; the QA entry point has its own lazy chunk.
- Live native WebGPU: HDR/bloom enabled, articulated moving ships and distinct
  weapon signatures observed; no validation-scope errors.
- Actual GPU pixel readback, not just a pipeline-descriptor assertion: a red
  beam behind a spherical planet produced red-channel value **0** at the
  occluded center and **193** outside its silhouette. The same beam in front
  produced **193** at the center. No GPU validation errors.
- Seed 42, eight-second near/middle/system replays: identical complete shot
  logs, **20 shots**, **6 misses / 7 shield / 7 hull outcomes** in each preset.
  Original entity IDs and camera position restored after every replay.
- User-gesture audio replay: **52 procedural voices played**, zero voices
  remaining after cleanup; no mutating HTTP requests during the observed replay.
- The final public renderer API was also exercised live and cleaned up without
  GPU validation errors.
- The production fleet-UI replay path was exercised in the local WebGPU browser
  using a temporary synthetic report and encounter. Participant-authorized GET,
  system navigation, generic ship proxies, aggregate pressure cues, and the
  exact-result overlay all completed; the temporary report and encounter rows
  were deleted afterward. This validates the local visual integration only,
  not production rollout or real-combat coverage.
- Live framing was corrected to keep the camera focus in system-local
  coordinates while proxies/effects use origin-adjusted positions; a
  non-zero-origin regression test covers the distinction. The result summary
  now stays compact, with per-class losses and survivors in collapsed details.
- A follow-up Fleet-UI replay exposed a navigation race when a report targeted
  the currently displayed system: replay startup could run against the previous
  system payload while its replacement was still loading, then be cleaned up
  as the renderer rebuilt that system. Startup now waits for navigation to
  finish. The regression test and full local Fleet-UI/API/WebGPU round trip pass;
  its temporary rows were removed.
- Isolated MySQL 8.4 fleet/encounter integration: **35 tests and 1,011
  assertions passed**, including participant-only report lookup, rollback on
  encounter event failures, and retry behavior. The battle-encounter migration
  repeatability test also passed (**1 test, 10 assertions**). Both test commands
  created and dropped their own randomly named databases; they did not use the
  application database for test writes.

### Local measurement snapshot

The shared browser normally has a smaller responsive viewport. For the
following samples, a temporary QA frame hook enforced a **1920 x 1080 GPU
canvas backing size**; it was removed afterward and normal sizing restored.
Each preset collected nine GPU samples and a rolling 240 CPU/frame samples.

| Preset | CPU update average / P95 (ms) | Hero scene GPU average / P95 (ms) |
| --- | --- | --- |
| near | 0.037 / 0.100 | 0.007 / 0.066 |
| middle | 0.038 / 0.100 | 0.051 / 0.459 |
| system | 0.030 / 0.100 | 0.015 / 0.066 |

These are **diagnostic observations, not a performance certificate**. GPU
timestamps were coarsely quantized, including zero-valued samples; adapter
identity was not exposed. Frame presentation averaged about 31.25 ms in this
shared browser. The measured pass includes depth proxies, ships and weapons,
but excludes bloom and the base celestial pass. Neither an isolated 2-ms VFX
budget nor sustained 60 FPS on reference hardware has been established.

## Remaining quality boundaries

This is a working technical Hero-Battle reference, not a claim of X4-equivalent
finished art. The QA scene's ships, projectile paths and outcomes are
procedural fixtures; the separate legacy replay uses generic proxies and
aggregate pressure cues. Celestial occlusion uses spherical proxies rather
than exact impostor surface depth. Professional textures/audio, faction-
specific art, destruction/debris replay and a reproducible reference-hardware
performance gate remain the next blocks.

## Fleet scaling block

The follow-up adds even 4-128-ship fixtures, screen-space near/middle/far LOD,
15% transition hysteresis, offscreen/tiny-ship culling, shared 12-triangle
far hull proxies, priority-aware 64-effect retention and exact per-frame
weapon primitive budgets. Important cues degrade before being discarded.
Timed replays settle at a fixed endpoint after setup; outcome generation and
the bounded shot log remain independent of visual selection.

The ordinary renderer and default four-ship preview stay full-detail.
`fleetLod: false` provides a full-detail stress baseline; defaults/options and
telemetry are described in [Weapon Fire Integration](WEAPON_FIRE_INTEGRATION.md).
This block reduces submitted geometry and visual noise, not the authoritative
economy or combat workload. It introduces no gameplay scheduler.

Fleet-specific tests cover pixel thresholds/hysteresis, conservative viewport
crossing tests, missile simplification, important-cue retention/degradation,
exact budgets, per-model proxy cleanup, invalid options, and bounded identical
128-ship shot logs across different frame cadences.

### Fleet validation results

- **159 focused tests passed** across seven files; renderer ESLint and the
  production build passed. The existing Vite large-chunk warning remains.
- Two live eight-second 128-ship previews produced identical bounded shot
  logs and **642 discharges / 214 outcomes of each kind**. Both restored the
  original entity IDs/camera, cleaned successfully and emitted no mutating
  HTTP requests or GPU validation errors. Their interactive cameras are not
  treated as a controlled performance reference.
- A separate real native GPU workload held the camera fixed, used a
  **1920 x 1080 HDR target**, advanced 81 presentation samples over exactly
  eight replay seconds, and submitted the same vessel/weapon render passes.
  All three runs produced the same logs/counts and no validation errors:

| Workload | Last-frame vessel draws / submitted vertices | Peak weapon primitives |
| --- | --- | --- |
| Full detail, distant camera | 272 / 116,736 | 178 |
| Fleet LOD, same distant camera, budget 32 | 128 / 4,608 | 32 |
| Fleet LOD, closer camera, budget 32 | 268 / 116,016 | 32 |

The distant LOD run rendered all **128 far proxies**, rather than achieving
its reduction by hiding the fleet. Its final weapon frame admitted 32 cues
and budget-skipped 14 effects. The closer run exercised budget degradation
as well as rejection while maintaining the exact 32-primitive maximum.
All retained queues stayed at or below 64.

These are geometry/budget results, **not a certified FPS or GPU-time win**:
the tiny timestamp sample set remained coarsely quantized, including zeros.
The isolated workload excludes bloom/base-world rendering and its sampled
presentation intervals are synthetic, not real frame pacing.

A reusable hardware-in-loop test is provided at
[fleet-vfx-webgpu.spec.js](../../tests/e2e/fleet-vfx-webgpu.spec.js):

```powershell
npx playwright test fleet-vfx-webgpu.spec.js --project=chromium --reporter=line
```

It attaches a JSON benchmark report and asserts replay counts/logs, exact
caps, all 128 visible far proxies, cleanup and actual GPU validation scopes.
It needs the Vite development app and a WebGPU-capable Playwright browser.
The local headless run was explicitly **skipped because no GPU adapter was
available**; the real-GPU workload above was run in the shared VS Code browser.

## Cinematic state and wreck presentation

Hero previews now enable the authored cinematic fixture by default; use
`cinematic: false` for the original comparison workload and its fixed 642-shot
reference. The extension adds role-specific frigate attack/retreat runs and
slow cruiser standoff, projected shield/hull bars, hull fires, explosions,
and six-second drifting debris clouds with rotating metal shards and dust.
Ships marked destroyed by the QA timeline stop moving/firing and leave the
mesh pass. No backend health or combat calculation is introduced.

Damage has its own 64-record / 128-primitive instanced allowance in addition
to the weapon budget. Debris now adds a separate capped 3D-mesh instance batch,
not physical broken source-model parts; dust is additive rather than volumetric
opaque smoke.
See [the cinematic contracts](WEAPON_FIRE_INTEGRATION.md) for state timing,
limits, motion rules and lifecycle details.

Validation includes deterministic cinematic outcomes across frame cadences,
measurable frigate/cruiser motion differences, fire anchoring, detached debris
with copied carrier velocity, bounded primitives/lifetimes, live health-bar
updates, occlusion and HUD cleanup. A live twelve-second four-ship WebGPU
preview showed damaged bars, persistent fires, a destruction explosion and
debris; it reported 76 fire emissions, one explosion and one debris cloud.
GPU validation returned no error; original entities/camera were restored and
no HUD nodes remained after expiry.

Final validation: **163 focused tests passed**, renderer ESLint and production
build passed. A real GPU batch containing 64 fire/explosion/debris records
rendered exactly 128 primitives under the damage cap, including the final
rotating-fragment shader, with no GPU validation errors. The existing Vite
large-chunk warning remains unrelated to the diagnostic effect limits.

## Three-dimensional wreck fragment extension

The cinematic fixture now replaces its shard billboards with twelve seeded
solid armor shards per destruction: varied sizes/aspect ratios, inherited
carrier velocity, independent analytic rotation and decaying hot-metal glow.
Dust remains in the additive damage batch. Mesh fragments render in the
opaque depth pass before weapon/damage VFX, with a final screen-door fade.
The unchanged default standalone billboard API remains available.

The extension is bounded to sixteen retained bursts and 192 mesh instances,
using one shared 12-triangle mesh and one draw call. Subpixel/offscreen shards
are culled. It remains a visual QA sequence without collision, gravity,
procedural hull fracture or salvage state.

Validation:

- **170 focused tests passed** across eight files; renderer ESLint and production
  Vite build passed (existing large-chunk warning retained).
- Tests cover deterministic snapshot transforms, carrier-velocity inheritance,
  rotation/cooling/fade/lifetime, exact 192-instance cap, one mesh draw, LOD,
  camera-relative precision, format changes, failed allocation retry and
  aggregated cleanup errors.
- Actual GPU pixel readback: 16 bursts / 192 fragments rendered **746 lit
  pixels** in a 256-square color target. With an opaque planet proxy in front,
  output was **zero lit pixels**, without GPU validation errors.
- Live cinematic system preview: after destruction, all twelve mesh shards
  were submitted (432 vertices / one draw), while bars/fire/dust remained
  active. On expiry, the original camera/entity IDs were restored, zero bursts
  remained and the HUD was removed; GPU validation returned no error.
- The reusable GPU test now includes the pixel/occlusion check and the shader
  validation catalogue includes the new inline WGSL. Local headless Playwright
  discovered both fleet/mesh tests but skipped them explicitly due to no
  available GPU adapter; real-GPU evidence above is from the VS Code browser.

## Ship-class destruction extension

Implemented compact frigate destruction and a four-stage cruiser explosion
sequence with copied hull-local anchors and inherited motion. Severe cruiser
damage lights three distinct hull regions. Cruiser bursts retain twelve
instances but replace three small shards with larger, slower wreck sections;
two sections carry transient surface fires sampled from their analytic poses.
The QA fixture now destroys a cruiser at 8 seconds as well as a frigate at
6.5 seconds. `cinematic: false` keeps the existing comparison workload.

No budget increase: sixteen retained staged sequences, 192 mesh instances and
128 drawn damage primitives. Burst eviction cancels its remaining staged cues;
stop/expiry cancels all pending cues. This is authored visual presentation, not
server health changes, hull fracture, collision or persistent wreck gameplay.

Validation: **174 focused tests passed**, renderer ESLint and production build
passed. Additional tests assert exact four-stage counts/times, detached moving
anchors, local/surface fire anchors, three enlarged/slower cruiser fragments,
identical output across replay cadences, 128-ship retention limits and early
disposal. The persistent GPU pixel test now uses both classes, including
24 larger cruiser sections within its 192-instance workload.
The same mixed-class workload was read back on the real GPU: **1,270 lit pixels**
without the celestial blocker, **zero** behind it, 6,912 vertices / one draw,
and no validation error. Both local headless tests were explicitly skipped
because that browser had no WebGPU adapter.

A live twelve-second WebGPU system replay reported five detonations, two
debris bursts, 24 submitted mesh instances (864 vertices / one draw), and two
active fragment-anchored fires at 9.4 seconds. Peak damage output was 115 of
128 primitives. On expiry, zero bursts/staged sequences/HUD nodes remained,
the original camera and entity IDs were restored, and GPU validation returned
no error. These figures are diagnostic workload results, not a performance
or final art-quality certification.

## Mixed-class fleet and blue shield extension

The public Hero default is now an eighteen-second, 24-ship mixed fleet scene:
two carriers, four battlecruisers, six corvettes and twelve fighters across two
mirrored wings. Each class has a distinct procedural silhouette, relative
size, HUD label, movement cadence and preferred weapons. Capitals hold the
rear/fire line; corvettes and fighters execute progressively faster attack
runs. No fighter launch, new fleet AI or gameplay damage simulation is added.

`formation: 'classic'` preserves the earlier four-ship cinematic fixture;
`cinematic: false` preserves the original deterministic geometry comparison.
Mixed formations accept 8-128 even ships. Destruction remains bounded to the
existing compact/staged profiles and effect budgets.

Persistent blue shields are driven by explicit QA shield strength, not only
transient impact light: subtle surface shimmer plus a Fresnel edge, stronger
blue contact waves, no ambient shell/stale flash at zero strength. Near and
middle LOD keep the shell; far/hidden omit it. Shield depth writes remain off.
Ordinary vessels without Hero state retain their previous behavior.

Validation:

- **179 focused tests** cover mirrored composition, distinct silhouettes/rigs,
  class sizes/movement, weapon preferences/explicit filters, deterministic
  mixed replay, 128-ship limits, reduced motion, class HUD labels, default vs
  classic preview and strength-driven near/middle/depleted/far shield draws.
- Real GPU pixel readback, without any hit impulse: aggregate blue-channel
  output **78,641 / 92,596 / 106,822** at shield strengths 0 / 0.5 / 1.
  Blue increases substantially more than red; placing a planet in front
  produced zero red/blue output. GPU validation returned no error.
- The live default scene submitted 24 active shield shells at 2.6 seconds.
  Full replay: 272 illustrative shots, 90 miss / 89 shield / 93 hull outcomes,
  twelve detonations and six debris bursts. Observed peaks: 96 weapon
  primitives, 128 damage primitives and 48 mesh fragments.
- Expiry restored original entity IDs/camera and removed all owned HUD nodes,
  bursts and staged sequences; validation scope returned no error.
- Renderer ESLint and production Vite build passed. All three reusable fleet,
  debris and shield pixel tests were discovered; local headless runs explicitly
  skipped them for lack of a WebGPU adapter. Real-GPU evidence above came from
  the shared VS Code browser, not the skipped headless run.

See [the integration contracts](WEAPON_FIRE_INTEGRATION.md) for default options,
role/weapon tables, timing, LOD and limitations.

## Seeded tactical variety

Mixed previews now use random tactical presentation by default. Each wing
independently cycles a seeded shuffled order of flank, focus-fire, escort and
withdrawal strategies, with four-second decisions and smooth 1.2-second
displacement transitions. Individual target selection, firing phase, maneuver
phase and weapon choices vary by seed. Wreck targets are replaced immediately;
focus-fire shares a capital target, escort screens the friendly carrier and
withdrawal includes a brief cease-fire.

Omitted seeds are freshly generated for mixed previews; the effective seed is
returned with the report. Explicit seeds reproduce the same plans/decisions
and shots for the same options/code. `tactics: false` restores the previous
mixed presentation, and classic/non-cinematic previews remain fixed seed 42.
Authored damage and destruction timelines remain unchanged, as requested.
This is still QA visual staging, not server-side fleet AI.

Validation: **184 focused tests passed** across nine files; renderer ESLint
and production build passed. Coverage includes independent plans, all strategy
types, continuous transitions, focus/escort targeting, ally/wreck exclusion,
withdrawal cease-fire, fresh vs explicit seeds, immutable report copies,
frame-cadence replayability and 128-ship/30-second retention limits.

Live eighteen-second WebGPU acceptance:

- Seed **4158731470**: 279 shots, 108 decisions, all four strategies, twelve
  detonations; peak weapon/damage primitives 123 / 128.
- Repeat with the same seed: identical complete retained shot log, decisions
  and outcome totals. GPU validation returned no error on both runs.
- Fresh seed **932776068**: 311 shots and different decisions/shot transforms;
  the same twelve authored detonations remained.
- Both repeat/expiry cleanup restored original camera/entity IDs and removed
  all HUD nodes; no stale replay resources were retained.

## Interactive convoy QA

Implemented an opt-in `scenario: 'convoy'` in the existing public Hero API:
30-second default presentation with a non-firing blue carrier acting as the
convoy, a marked 24-second route and three controllable groups. The default
blue wing assigns two ships to the fire line, six to escort and three to
reserve. Red initially retained seeded tactics; the reactive extension below
now overrides enemy maneuver/target intent in convoy QA only.

The accessible overlay offers group/target selection, priority, convoy escort,
reserve deployment, withdrawal, cancellation and stop. Selected groups are
outlined. Reserve holds position/fire until released; withdrawing groups stop
new fire and blend toward the rear. Orders apply on replay-local steps and
blend movement for 1.2 seconds, with a capped 64-command report supporting
scripted replays. Pending orders are explicitly cancelled on disposal.

No server orders, real damage, mission outcome, transport asset or victory
simulation is added. Existing authored health/death is deliberately unchanged;
the progress indicator says visual progress, not success. Ordinary Hero
previews remain non-interactive unless convoy QA is selected.

Validation:

- **192 focused tests** across ten files, including group assignment, held
  reserve/non-firing convoy, measurable command effects, exact target priority,
  escort distance, withdrawal cease-fire, blend continuity, default restoration,
  invalid/stale/dead-target rejection, immutable/capped command reports,
  cadence-independent scripted replay, reduced motion and 128-ship limits.
- Public API/UI tests exercise selection, command-error notification,
  keyboard isolation, pending-order cancellation and owner cleanup.
- Renderer ESLint, production Vite build and scoped whitespace checks passed;
  the existing large-chunk warning remains unrelated.
- Live real-WebGPU UI clicks applied reserve deployment and target priority
  at steps 430 / 437. The reserve fired eight observed shots after deployment;
  both fire-line shots observed under priority targeted opposing slot 12.
- Subsequent withdrawal/escort clicks at steps 1247 / 1256 produced no new
  withdrawing-group shots; the reserve followed within 2.26 scene radii of
  the convoy and withdrawal reached the rear position at -12 scene radii.
- Early stop at replay time 29.05 restored camera/entity IDs and left no
  command panel, route marker or health HUD; GPU validation returned no error.

See [the interactive contract](WEAPON_FIRE_INTEGRATION.md) for API/options,
replay steps, limits and intentionally absent gameplay effects.

### Reactive convoy opposition

Extended the same opt-in QA scenario with two enemy groups: fast raiders bind
escorts or intercept the exposed convoy; capitals pin the fire line. Releasing
the reserve draws enemy attention to it. Damaged capitals withdraw and stop
new fire. Evaluation occurs every replay-local second with a three-second
strategy cooldown, immediate dead-target replacement at evaluation and
1.2-second pose blends. Seeded attack-run variation and existing VFX budgets
remain in use; ordinary battle previews and authored damage remain unchanged.

The panel now shows convoy shield/hull, nearby protectors and opponents,
assigned convoy attackers and readable enemy orders with exact target slots.
The route marker follows threat coloring. Objective phase and threat counts
are diagnostic only; no server combat or mission-success logic is introduced.
Copied reaction histories are capped at 64 records and retained after cleanup,
while active pose maps are released.

Validation of the reactive extension:

- **195 tests across ten focused files passed**, including measurable enemy
  retasking/movement/fire, three-second cooldown, damage-triggered withdrawal
  bypass, dead-target fallback, unchanged authored damage, copied histories,
  prediction purity, cadence-independent logs/poses and 128-ship budgets.
- Renderer ESLint and the production Vite build passed.
- Live WebGPU button clicks deployed the reserve at step 392; both enemy
  groups countered it at step 420. With reserve/escort withdrawn, raiders
  switched to convoy interception at step 600. Returning the escort to its
  default order restored escort targeting; 73 observed enemy shots targeted
  the convoy during the exposed interval.
- A second scripted live replay verified capital withdrawal at step 660,
  despite retasking at step 600: zero new capital shots were recorded from
  step 660 onward. The panel showed seven assigned convoy attackers and high
  threat, with capitals visibly retreating.
- The overlay was visually inspected. Stop at 27.1 seconds left no panel,
  destination marker or HUD; GPU validation returned no error.

### Larger staged convoy engagements

Implemented the next opt-in QA block, `reinforcements: true`, retaining normal
preview defaults. Wave mode defaults to 48 ships, with 24 initial ships and
12 reinforcements each at 8/16 seconds. Both wings enter from visibly opposing
north/south scene-depth flanks over two seconds. Arrivals inherit group intent
and existing enemy reactions; held reserves still need deployment.

Pending ships have no meshes, shields, HUD, targeting, fire or threat presence.
The fixed authored damage timeline begins relative to scheduled arrival only
in this mode and remains independent of commands. The panel adds all-group
active/pending status, orders and flank-wave countdowns. Setup prepares the
entire capped fleet; entry does not dynamically allocate assets.

Acceptance checks cover exact arrival steps, both entry coordinates, no
pre-entry targeting/fire/damage, two-second fire gating, pending-only command
rejection, arrival-relative health, reserve deployment, copied deterministic
replay telemetry/poses, ordinary-mode compatibility, early-stop preservation
and 128-ship VFX retention limits in both modes. No authoritative simulation
or mission outcome is introduced.

Validation results:

- **201 tests across ten focused files passed**, including small reduced-motion
  wave fleets and immutable arrival reports. Renderer ESLint and production
  Vite build also passed.
- Real WebGPU 48-ship replay delivered twelve arrival records at step 480
  and twelve at step 960. North entry was observed at approximately
  (-12.94, -4.02, -8.93) scene radii at time 8.1 seconds.
- Target options and pending-only reserve controls stayed unavailable before
  entry. The live reserve deployment at step 1065 yielded 59 retained
  reserve shots; no retained shot source or target preceded its arrival.
- Visual inspection confirmed larger formations, entrance motion and the
  all-group/wave overview. The full replay ended at exactly 30 seconds.
- Live peaks: 167 weapon primitives (budget 256), 128 damage primitives
  (budget 128), 51 retained weapon records (limit 64) and 72 debris instances
  (limit 192). No weapon evictions/rejections or GPU validation errors occurred.
- Automatic expiry left no panel, route marker or HUD; copied wave telemetry
  remained available in the cleaned report.

### Continuous five-minute recording

Extended convoy QA to 300 seconds while preserving ordinary preview duration
limits/defaults. Long replays scale the authored route, arrivals and damage
timeline, not flight speed or firing cadence. Five-minute wave times are
80/160 seconds and route completion is at 240 seconds. Seeded tactics cover
the entire replay plus prediction margin; all existing history/VFX caps remain.

The recording fixture uses 48 mixed ships and seed 465192519, with scripted
fire-line priority, escort withdrawal/restoration and late reserve deployment,
escort and withdrawal. Capture comes continuously from the real WebGPU canvas,
with projected health bars and telemetry painted into the 1080p recording
canvas. This is not a loop, time-stretched clip or authoritative battle.

The regression suite includes a full 18000-step test that verifies scaled
arrival/damage timing, late commands, continued firing in the final ten
seconds, route completion and bounded histories/effects.

Recorded and saved `hero-convoy-five-minute.mp4` as a session deliverable:
exactly **300.000 seconds / 9000 frames**, H.264, 1920x1080 at 30 fps.
The source VP9 stream decoded completely before encoding; the final MP4
also decoded completely. The capture ran through step 18000 with 12 scripted
commands, 8,086 shots and both reinforcement waves. Stop/expiry cleanup
completed, no browser/GPU recording error was reported, and no UI overlay
resources remained. The export is silent.

### Battle video archive

All generated battle videos and their original WebM capture streams are
stored under [`assets/hero-battles/`](./assets/hero-battles/). MP4 files
are the playback-ready H.264 versions; WebM files retain the original VP9
browser captures where available.

| Recording | Description | Duration | Files |
|---|---|---:|---|
| Hero battle | Four-ship cinematic fixture | 15.03 s | [MP4](./assets/hero-battles/hero-battle-full.mp4) · [WebM](./assets/hero-battles/hero-battle-full.webm) |
| Mixed fleet | Carrier, battlecruiser, corvette and fighter formation | 17.97 s | [MP4](./assets/hero-battles/hero-mixed-fleet-full.mp4) · [WebM](./assets/hero-battles/hero-mixed-fleet-full.webm) |
| Seeded tactics | Mixed fleet with tactical variation (seed 465192519) | 18.03 s | [MP4](./assets/hero-battles/hero-tactics-465192519.mp4) · [WebM](./assets/hero-battles/hero-tactics-465192519.webm) |
| Convoy breakthrough | 48 ships, reinforcement waves and scripted commands | 300.00 s | [MP4](./assets/hero-battles/hero-convoy-five-minute.mp4) |

Durations and codecs were checked with `ffprobe`; the five-minute MP4 was
decoded end-to-end. The browser WebM captures do not all contain a finalized
container duration, so use the paired MP4 for reliable playback where one is
provided. The recordings are visual QA fixtures, not authoritative combat
outcomes.
