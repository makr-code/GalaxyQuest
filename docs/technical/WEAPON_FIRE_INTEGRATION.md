# Weapon Fire Integration Architecture

## Overview
Complete weapon-fire event routing system for galaxy rendering, supporting multi-entity-type targeting with BeamEffect instanced rendering integration.

## Combat event fidelity

`fleet_arrived` and `incoming_attack` notifications no longer create weapon
discharges. The combat resolver links each new battle report to its attacking
fleet; the authenticated SSE stream sends the report's bounded round summary to
both combatants. The bridge schedules visual salvos from those round summaries,
using the exact attacker fleet ID and target body slot. Defender salvos are
routed to installations at that slot and can target the recorded attacker fleet.

The report stores aggregate round pressure, not individual shots, weapon
hardpoints, hit events, or projectile trajectories. These VFX are therefore
round-level visualizations of the resolved outcome, not a reconstruction of
individual firing decisions. The renderer accepts `sourceFleetId` and
`targetFleetId` (or `sourceEntityId` / `targetEntityId` aliases); explicit fleet
or body-slot targets are not silently replaced by a different nearby target.

### Resolved-battle event flow

1. `resolve_battle()` stores the arriving fleet ID on its report.
2. The authenticated SSE stream detects newly committed reports for either
   participant and emits a bounded round summary with fleet and body-slot IDs.
3. `CombatVfxBridge` schedules one visual cue per round with positive pressure
   for the connected participant; fleet-arrival and inbound-warning events do
   not create weapon discharges.
4. The renderer resolves the attacker fleet and target body slot, or the
   defender installation and exact attacker fleet, before creating the beam.

Run `migrate_battle_report_fleet_link_v1.sql` before expecting resolved-battle
VFX on an existing database. Existing reports intentionally remain unlinked.

## Native WebGPU visual QA

The unified command shell uses `PerspectiveSpaceFlight`, not the legacy
`GalaxyRendererCore` event listener. The legacy battle-event path above does
not imply that this native view already consumes battle SSE summaries.

For a client-only visual test, open a system in the Vite development app and
run this in the browser console:

```javascript
const { startSystemBattlePreview } = await import('/js/rendering/system-battle-preview.js');
const renderer = await GQAuthGalaxyBackgroundControl.acquireGameView();
const preview = await startSystemBattlePreview(renderer, { reducedMotion: false });
// Optional early stop:
preview.stop();
await preview.finished;
```

Omit the early-stop lines to watch the default twelve-second preview.
Four temporary GLB ships maneuver near a planet and cycle through six weapon
families, with local muzzle anchors, trails and delayed impact cues.
The explicit `reducedMotion: false` above opts into the moving QA demonstration;
omitting it respects the OS reduced-motion preference and keeps ships stationary.
A bounded, instanced additive
WebGPU render pass uses world-space endpoints and the existing camera/render
loop; it creates no extra animation loop or server requests for gameplay.
Effect expiry uses a monotonic clock, independent of the spatial-motion clock,
so frozen ship/camera motion cannot leave a laser or flash permanently visible.
These are diagnostic effects, not recorded hits or an authoritative combat
simulation. Ship size is deliberately enlarged for visual inspection.

`getStats()` reports volleys, shots, weapon kinds, temporary ships, active and
drawn primitives, and motion mode. `weaponKinds: ['missile']` isolates one family.
Timeout, page hiding, system changes, setup failure and `stop()` remove only
preview-owned ships/effects and detach its frame hook. Camera restoration is
limited to the original system. Concurrent previews are rejected. Production
SSE-to-native-entity mapping remains a separate integration task.

### Native weapon families and moving hardpoints

| Kind | Visual signature | Default flight time |
| --- | --- | --- |
| `laser` | Short, thin blue beam attached to the moving muzzle | Instant; 0.16 s pulse |
| `ballistic` | Amber tracer and small kinetic slug | 0.7 s |
| `railgun` | Very fast, thin violet tracer and impact ring | 0.25 s |
| `photon` | Cyan pulse with luminous halo and short trail | 0.9 s |
| `plasma` | Larger, slower green energy bolt and glow trail | 1.4 s |
| `missile` | Launch-heading curve, segmented fading exhaust, bright nose and detonation ring | 2 s |

These times and pixel widths are cinematic readability defaults, not combat
balance or physical speeds. The renderer retains at most 64 effects, each with
at most 12 primitives, and batches them into one instanced draw call.
Misses expire without impact flashes; future-dated effects are not drawn early.

`SpaceWeaponRenderPass.fireWeapon(kind, source, aimPoint, options)` uses an
explicit `SpaceEntity` source, world-space `Vector3` aim point and normalized
local-model `muzzleOffset` (default `[0.5, 0, 0]`). Its transform is
`source.position + source.quaternion * (muzzleOffset * source.scale)`.
Positions use light-years; `sourceVelocity` uses light-years per second.
An authored model can supply its actual hardpoint instead of the default bow.

Laser muzzle flashes and beams track the current source pose during their
short pulse. An explicit `target` can anchor a beam endpoint to a moving target;
there is no nearest-ship substitution. Ballistic, rail, photon and plasma shots
snapshot the muzzle and supplied endpoint at launch and follow straight paths.
Missiles additionally snapshot forward orientation and carrier velocity to
shape a cubic launch/approach curve ending at the supplied endpoint. This is
visual steering, not an autonomous target-seeking or collision simulation.

Callers supply the desired impact point, optional projectile `flightSeconds`
(0.05–5 seconds), and `impact: true` only when an impact cue is authorized.
The default is **no impact**. The QA fixture explicitly defines illustrative
hit/miss outcomes and leads its known moving target paths; neither prediction
nor invented hits are applied to gameplay. Projectile impacts start at arrival,
not discharge. Ordinary effects use a monotonic wall clock; hero-fixture effects
use their replay-local clock without changing the lifetime of ordinary effects.

### Hero battle: articulated ships, impacts and measurements

The native renderer exposes a lazy-loaded QA API, also included in the Vite
production build. Enter a system, then use:

```javascript
const renderer = await GQAuthGalaxyBackgroundControl.acquireGameView();
const preview = await renderer.startHeroBattlePreview({
  seed: 42, durationMs: 8000, view: 'near', reducedMotion: false,
});
preview.getStats(); // Live counts, shot log, CPU/frame samples and GPU timing.
await preview.finished; // Includes the final report after asynchronous cleanup.
```

`view` accepts `near`, `middle` or `system`. The scene creates four procedural
QA ships in two classes, extracts `turret_primary` / `muzzle_primary` nodes,
and renders turret geometry separately from the hull. Aiming has angular and
turn-speed limits; charge-up follows the moving muzzle, then discharge,
recoil/recovery and detached projectiles follow the six existing profiles.
An existing camera flight is paused while the hero fixture owns the camera.
Its original pose and flight state remain available after cleanup.

`impactKind: 'shield' | 'hull'` requires an explicitly authorized impact.
`impactOffset` can provide a normalized local-model contact anchor for an
explicit `target`, rather than deriving an offset from its future world-space
position. Shield contacts produce a localized patch and a traveling spherical
surface wave; hull contacts produce directional sparks and a decaying surface
glow. Contact locations rotate with the target. These are fixture outcomes,
not damage, collision or shield-state calculations.

The hero pass uses `depth32float`: opaque hulls/turrets write depth, additive
weapons/shields test depth without writing it. Planets, moons and stars supply
spherical depth proxies; rings and atmospheres are not opaque occluders.
The scene target is `rgba16float`, which is filterable in core WebGPU, with the
existing bloom compositor. Labels and lens flares remain overlay passes.

Audio is off by default. To enable it, call
`renderer.startHeroBattlePreview({ audio: true, ... })` from a real button-click
handler, after acquiring the renderer. The fixture reads the existing audio
manager's master/SFX volume and mute settings, uses at most eight HRTF voices,
and closes only its own AudioContext. Sounds are procedural placeholders;
music playback/settings are not changed.

The seeded fixture advances fixed 60-Hz **presentation** steps, not gameplay
ticks. Its bounded report includes shots/outcomes, launch/end snapshots,
CPU-update/frame-interval Average/P95, and optional real GPU timestamps.
`gpuScenePass` measures the hero depth-proxy/ship/weapon pass, **not isolated
VFX, bloom or total-frame GPU cost**. Unsupported/failed timing is reported
explicitly. Readbacks, depth textures, model buffers and voices are released
before `finished` resolves; check its `cleaned` field for cleanup failure.

See [the implementation plan and validation results](HERO_BATTLE_IMPLEMENTATION.md)
for acceptance evidence and remaining production-art/performance work.

### Fleet LOD and bounded stress replay

The same diagnostic API accepts even `shipCount` values from 4 to 128:

```javascript
const renderer = await GQAuthGalaxyBackgroundControl.acquireGameView();
const preview = await renderer.startHeroBattlePreview({
  shipCount: 128, seed: 42, durationMs: 8000, view: 'system',
  reducedMotion: false, primitiveBudget: 128, cinematic: false,
});
const report = await preview.finished;
console.table(report.hero.fleet);
```

`fleetLod` defaults to true when `shipCount > 4`. Set it explicitly to false
for a same-seed full-detail comparison, and use `cinematic: false` to reproduce
the original geometry-only stress fixture. The classic four-ship fixture and
normal production rendering remain full-detail. Fleet LOD is diagnostic-only until
production entity/event routing is defined.

LOD uses normalized model size projected into GPU backing pixels, not absolute
light-year distances. Near/middle transitions have 15% hysteresis:

| Projected size | Ships | Weapons |
| --- | --- | --- |
| >= 24 px | Full hull, turret, shield and engine details | Full sequence |
| 8-24 px | Hull and engine mesh, active shield; no turret or particles | Up to two primitives; merged missile trail plus nose |
| 1-8 px | Shared per-model bounding-box proxy: 12 triangles | One trajectory/contact cue; bounded flash width |
| < 1 px / outside view | Ship culled | Visible weapon segments can remain as one cue |

Weapon frustum tests preserve beams crossing the viewport even when both
endpoints are outside it. Culling/LOD never creates hit cues or changes launch
and impact timestamps. Charge-up detail is omitted outside the near tier.
The existing near-plane-crossing rule is preserved.

Every effect can carry explicit `priority: 0 | 1 | 2`. Queue overflow evicts
the oldest lowest-priority effect; lower-priority arrivals cannot replace a
queue filled with higher-priority effects. Equal priorities retain FIFO.
The fixture marks the first ship on each side as priority 2. This is QA
selection, not automatic gameplay ownership or targeting.

Within each frame, visible effects are sorted by priority, projected size and
stable insertion order. `primitiveBudget` (1-768, default 256 for fleet LOD)
is an exact GPU-instance cap within the one weapon draw call. An important
effect can degrade to a simpler cue to fit remaining capacity; excess effects
are skipped for that frame rather than changing their recorded outcome.
The retained queue still has its separate 64-effect hard limit.

`report.hero.fleet` exposes near/middle/far/hidden counts, vessel vertices and
draw calls, weapon primitive counts, frame budget drops/reductions, queue
evictions/rejections and observed peaks. Per-model proxy buffers are lazy and
released with their assets. Opaque vessel draws remain per-ship, not yet
multi-ship GPU instancing.

Timed hero replays start their duration after successful setup, retain a
bounded setup timeout, and finish at the exact requested presentation step.
This avoids asset-load time and callback cadence changing stress-test shot
counts. Early stop, hiding or system changes do not fast-forward the fixture.

### Cinematic damage, health bars and ship roles

Hero previews now default to `cinematic: true`, `formation: 'mixed'`, 24 ships
and 18 seconds. Use `formation: 'classic'` for the previous four-ship cinematic
fixture. Ordinary system previews and
direct `HeroBattleSession` construction keep their previous fixture unless
explicitly enabled. This is a **QA state timeline**, not client-side damage
simulation. Server combat rules and actual ship health are unchanged.

The **classic** authored timeline lowers shields at 1.5 s, hull at 3 s and 4.5 s, then
destroys every fourth fixture ship at 6.5 s; cruiser states are offset by
0.25 s. Cruisers with fixture index `index % 4 === 1` additionally reach zero
hull at 8 s, so the classic four-ship replay demonstrates both destruction
classes. Remaining ships retain 22% hull. HUD shield/hull bars update from these
states and follow projected ship positions. At most 32 statuses are visible;
offscreen/subpixel statuses and those behind spherical celestial bodies are
hidden. The pointer-transparent HUD is removed during preview cleanup.

Small QA frigates execute 4.2-second attack/withdrawal runs with large lateral
excursions and fire only during the close portion of their run. Large cruisers
hold roughly seven scene radii of standoff range with slow drift and face the
opposing formation. Reduced-motion previews keep both classes stationary.
Destroyed ships stop maneuvering/firing and disappear from the mesh pass;
the fixture can select another surviving opposing target. No production
target is substituted by this diagnostic-only behavior.

Hull damage produces refreshed, locally anchored fire plumes and surface glow.
Destruction emits a short HDR fireball, expanding ring and sparks, followed by
a six-second debris cloud: twelve rotating three-dimensional metal shards and
five expanding additive dust billboards. Debris snapshots its origin, hull
orientation and carrier velocity, then disperses independently of the destroyed
ship. These are procedural VFX, not dynamically fractured source models,
opaque/volumetric smoke, physical debris collisions or resource-bearing wrecks.

Damage uses a separate bounded depth-tested batch: **64 records / 128 drawn
primitives / one additional draw call**, with at most 12 primitives per
record. It does not consume the weapon queue, so flames cannot erase weapon
salvos. Thus fleet VFX can draw up to `primitiveBudget + 128` primitives;
the full-detail weapon limit remains 768 plus the damage allowance. Mesh debris
has a separate instance budget described below.
Far damage cues simplify through the same screen-space selection logic.
`hero.presentation` reports fire/explosion/debris counts and each fixture
ship's displayed shield/hull/destruction state. All owned buffers, billboards
and HUD nodes are cleared on stop/expiry/system change.

### Instanced three-dimensional wreck fragments

`HeroDebrisRenderPass` renders solid skewed armor shards using one shared
12-triangle mesh. Each fragment has a seeded scale/aspect ratio, radial launch
velocity, independent spin axis and decaying hot-metal emission. Position and
rotation are sampled analytically from replay time, not integrated from frame
delta. Hull pose/carrier velocity are copied at destruction; later changes to
the ship do not affect the fragment cloud.

The mesh pass is ordered **before additive weapons, flames and dust** and writes
`depth32float`. Fragments therefore occlude each other and later weapon VFX;
planets and hulls occlude fragments. Normals account for nonuniform scale.
Camera/origin translation is subtracted in JavaScript doubles before GPU upload.
A screen-door fade during the final 1.5 seconds preserves opaque depth behavior
without transparent-instance sorting.

Limits: **16 retained destruction bursts / 12 shards per burst / 192 mesh
instances / 6,912 submitted vertices / one additional draw call**. A new burst
evicts the oldest when the limit is reached; expired bursts are discarded.
Offscreen or subpixel shards are culled using the existing screen-space helper.
There is no pixel-size inflation for distant debris. Buffers are allocated
lazily, recreated on device/format change and released with the session.

Hero destruction suppresses its old shard billboards via
`firePresentation('debris', source, { fragments: false, ... })`; the damage batch
now supplies dust only for that record. Standalone presentation calls still
default to their original billboard signature. `hero.presentation.meshDebris`
reports current/peak mesh instances, submitted vertices, draw calls, culling,
retained bursts, evictions and limits. After disposal, `bursts` is zero; frame
draw counters preserve the last observed frame for the final QA report.

### Ship-class destruction sequences

`HERO_DESTRUCTION_PROFILES` defines the two QA classes:

- Frigate: one compact 0.9-second detonation and twelve dispersed armor shards.
  Hull damage has one local fire anchor.
- Cruiser: detonations at destruction age **0 / 0.3 / 0.65 / 1 seconds**, at
  separate hull-local anchors. The central blast is 1.6 times the default
  presentation size. Severe hull damage activates three separate fire anchors.
  Three of its twelve fragments are larger wreck sections (3x linear size),
  with 0.35x relative dispersal and 0.2x spin. Carrier velocity is unchanged.

Detonations use the copied destruction pose and ballistic carrier translation,
including translation throughout each explosion's lifetime. They never follow
the hidden ship or infer new damage. Two major cruiser fragments emit brief
surface-anchored fire; their transforms continue to follow the analytic mesh
samples, including rotation, until the final fire expires. New wreck fire stops
after 2.4 seconds. These are still procedural plate-like parts, not fractured
sections of the original mesh.

Staged sequences share the sixteen-burst retention limit. Evicting a burst
cancels its remaining staged cues; expiry and early preview disposal remove
all pending sequences without fast-forwarding detonations. `activeDestructions`
reports retained sequences. The existing 64-record / 128-damage-primitive and
192-mesh-instance limits remain unchanged. Standalone presentation callers
retain their old size/lifetime defaults; explicit `size` (0 < size <= 4) and
`duration` (0 < duration <= 6 seconds) are validated.

### Mixed-class fleet and continuous shields

The default Hero replay contains two mirrored twelve-ship wings. Each wing
has one carrier, two battlecruisers, three corvettes and six fighters, with
distinct procedural silhouettes, normalized turret/muzzle rigs and HUD labels.
Mixed formations accept even ship counts from 8 to 128; the twelve-slot wing
pattern repeats independently on both sides.

| Class | Relative size | Presentation motion | Preferred weapons |
| --- | --- | --- | --- |
| Carrier | 2.2 | Rear line at nine scene radii, very slow drift | Missile, photon |
| Battlecruiser | 1.65 | Standoff at 6.8 scene radii, slow drift | Railgun, plasma, laser |
| Corvette | 0.65 | 4.2-second attack/retreat runs | Photon, missile, ballistic |
| Fighter | 0.28 | Fast 2.8-second crossing/withdrawal runs | Ballistic, laser |

Ships fire from moving normalized muzzles. Capitals face the opposing line;
fast classes orient along their analytic trajectories and fire in the close
part of the run. Firing cadence varies by class. An explicit `weaponKinds`
filter restricts all fire; classes prefer the intersection with their own
weapon list, using the requested list when the intersection is empty.
Reduced motion freezes ship positions but not projectile flight.
These roles and formations are authored QA presentation, not fleet AI or
server-authoritative combat rules. No fighter-launch sequence is included.

Mixed capitals retain shields through 8 seconds. At 11 seconds, carriers retain
25% shield / 80% hull, while battlecruisers lose their shield. Small ships use
the classic early shield/hull keyframes. On each side, one fighter is destroyed
at 7 seconds, one corvette at 9 and one battlecruiser at 12. Other ships remain.
Small hulls reuse compact destruction and capitals reuse staged cruiser
destruction. The 18-second replay includes the final six-second debris lifetime.

Active Hero shields now render even with **no shield-hit impulse**: a faint
blue surface tint and brighter Fresnel edge, with a slow spatial shimmer.
The ambient term is proportional to `heroStatus.shield`; zero shield suppresses
both the ambient shell and stale hit flashes. Active hits add a stronger blue
surface wave. The shield shell is available at near and middle LOD, absent
for far/hidden ships, and uses additive blending with depth testing but no
depth writes. Production vessels without an explicit Hero status do not gain
a persistent shield. The expanded WGSL uniform layout is 224 bytes.

`hero.formation` identifies the selected fixture; ship reports include class,
label and role. Vessel frame telemetry additionally reports `shields`.
The existing weapon/damage/debris budgets and preview cleanup remain unchanged.

### Randomized tactical presentation

Mixed Hero previews now default to `tactics: true` and a **fresh crypto-generated
32-bit seed** when `seed` is omitted. Reports expose the effective `hero.seed`.
Supply that seed to repeat a video; set `tactics: false` for the earlier fixed
mixed-class maneuver/target fixture. Classic/non-cinematic previews still default
to seed 42 with tactics disabled. Enabling tactics requires a mixed formation.

```javascript
const renderer = await GQAuthGalaxyBackgroundControl.acquireGameView();
const preview = await renderer.startHeroBattlePreview({ reducedMotion: false });
console.info('Replay seed:', preview.getStats().hero.seed);
const report = await preview.finished;
// Reproduce the same presentation with the same options and effective seed:
const repeat = await renderer.startHeroBattlePreview({
  reducedMotion: false, seed: report.hero.seed,
});
```

Each wing independently chooses a seeded random order of four presentation
strategies per sixteen-second block, without immediate repeats:

- **Flank:** fast craft move around a randomly chosen flank; capitals drift
  slightly, while individual ships choose opposing surviving targets.
- **Focus fire:** the wing shares one seeded surviving capital target (falls
  back to a surviving opponent when no capitals remain).
- **Escort:** fast craft shift toward the rear carrier screen and select
  among the three opponents closest to the surviving friendly carrier.
- **Withdraw:** craft pull back with individual dispersion and suspend firing
  during the first 1.5 seconds of the phase, then cover the withdrawal.

Decisions occur every four replay seconds; displacement changes blend over
1.2 seconds using a smoothstep curve, not teleportation. Ship-specific seeded
phase offsets, firing offsets and weapon choices break synchronized volleys.
Targets remain stable within a phase but are reselected immediately when
destroyed. Target selection never chooses allies or destroyed ships and stops
when no opponent remains. Effects still originate from animated local muzzles.
Reduced motion freezes positions; tactical targeting/cadence can still change.

Random choices are keyed by seed/wing/phase/slot/channel, not mutable frame RNG.
Prediction samples cannot consume randomness or alter later decisions. The
maximum-duration fixture retains nine plans per wing and at most 1,152 decision
records (with FIFO retention on additional target replacements).
`hero.tactics` reports enabled state, plans and copied decision records;
shot logs additionally carry strategy and phase. Replayability requires the
same seed, options and code version, not just the seed.

**The authored shield/hull/destruction keyframes are unchanged.** Strategies,
targets and visual motion do not calculate damage, change server fleet orders
or introduce gameplay AI. Existing miss/shield/hull cues remain illustrative;
random targeting is not evidence of authoritative hits.

### Interactive convoy QA prototype

The interactive prototype is opt-in; ordinary Hero previews remain unchanged:

```javascript
const renderer = await GQAuthGalaxyBackgroundControl.acquireGameView();
const preview = await renderer.startHeroBattlePreview({
  scenario: 'convoy', seed: 42, reducedMotion: false,
});
```

It uses the mixed formation, defaults to 24 ships and 30 seconds, and supports
the existing even 8-128 ship range. The first blue carrier represents a
non-firing QA convoy, following a fixed 24-second route through the marked
destination. Remaining blue ships form **fire line / escort / reserve** groups.
For the default fleet their initial sizes are 2 / 6 / 3. Red uses reactive
QA orders with seeded maneuver variation (see below). The convoy keeps the carrier's authored
health timeline and mesh; it is not a new production transport class.

The pointer-interactive overlay provides group selection, exact opposing
ship-slot selection and these commands:

- **Target priority:** group weapons prioritize the selected live opponent;
  destruction of that target restores seeded fallback targeting.
- **Escort convoy:** follows the moving convoy and prioritizes its nearest
  live opponent. If the convoy is destroyed, targeting falls back to automatics.
- **Deploy reserve:** releases the initially stationary, non-firing reserve
  into the seeded maneuver/target fixture.
- **Withdraw:** moves the group toward the rear position and prevents new
  shots/charge effects. Already launched effects continue.
- **Cancel order:** returns to the group's default behavior, including held
  reserve and automatic convoy escort.

Player orders override the blue group's random maneuver/firing restrictions.
Movement blends from the sampled current pose over 1.2 seconds without
teleportation. Reduced motion freezes positions and route progress, while
target/firing commands remain available. Ships remain represented after
withdrawal; there is no disengagement immunity or automatic removal.
Selected-group health entries receive an outline. The panel reports survivors,
the current order, unavailable targets and command errors; a projected marker
shows the route endpoint. It blocks click/keyboard propagation into gameplay
controls without preventing native select/button interaction.

`preview.issueCommand({ group, action, target?, step? })` exposes the same
validated local interface. Groups are `line | escort | reserve`; actions are
`priority | escort | deploy | withdraw | auto`. `deploy` is reserve-only;
`target` is an exact opposing entity-array index and is only accepted for
`priority`. Commands reject allied/out-of-range/already-destroyed targets,
groups without surviving members and past steps. Without `step`, the command
applies at the next replay presentation step. Explicit future steps allow
scripted QA playback. At most **64 commands** are retained; excess commands
produce an explicit error rather than losing history.

`hero.command` records route progress, selected group, group statuses and
copied command records (`step`, `applied`, `cancelled`). Reproducing an
interactive replay requires its command script as well as seed/options/code:

```javascript
preview.issueCommand({ group: 'reserve', action: 'deploy', step: 120 });
preview.issueCommand({ group: 'line', action: 'priority', target: 12, step: 180 });
```

**No mission victory, damage calculation, protection bonus, real fleet order
or backend mutation is introduced.** Route completion is labeled visual
progress, not success. The shield/hull/destruction timeline is unchanged even
when the player changes orders. Stop, expiry, page hiding and failed setup
remove owned panels/markers/HUD/resources, cancel pending commands without
fast-forwarding, and preserve command history in the final QA report.

#### Reactive opposition and objective telemetry

Convoy QA now divides red ships into fast **raiders** and capital **screen**
groups. Once per replay-local second, the presentation evaluates surviving,
fire-enabled blue groups. A released reserve causes both enemy groups to
counter it. Otherwise raiders bind the escort; withdrawing the escort exposes
the convoy to direct interception. Capitals bind the fire line. If their
average authored hull falls below 50%, surviving capitals withdraw to the rear
and cease new fire for the rest of the presentation.

Reactions hold for at least three seconds before changing to a new strategy
(damage-triggered capital withdrawal bypasses this cooldown);
destroyed targets are replaced at the next one-second evaluation without
waiting for that cooldown. Targets are live blue slots only. When the preferred
blue group has no eligible members, targeting falls back to surviving blue
ships. With no live opponents, no new enemy shots are emitted. Withdrawal
has no target. Decisions blend for 1.2 seconds from copied current poses;
fast ships make seeded attack runs around their target, while capitals hold
seven scene radii of separation. These local orders override the unrelated
random phase's fire restrictions; seeded weapon/cadence variation remains.
Prediction sampling cannot create or advance decisions.

`hero.command.enemies` exposes current group/action/label/target/step;
`hero.command.reactions` retains at most 64 copied transition records.
Enemy shot logs carry a separate `reaction` field; `strategy` still identifies
the underlying seeded plan. Identical seeds, command steps, options and code
reproduce reaction history, positions and weapon logs across render cadences.

`hero.command.objective` reports phase (`transit`, `stationary`,
`route-complete`, `destroyed`), authored shield/hull, nearby enemies within
4.5 scene radii, nearby fire-enabled blue protectors within 3.5 radii and the
number of live fire-enabled enemies assigned to attack the convoy.
Threat is `high` when attackers are assigned or nearby enemies outnumber
protectors, `guarded` for remaining nearby enemies and `low` otherwise;
convoy destruction produces `destroyed`. The panel displays these counts,
health and both enemy intents; the route marker adopts the threat color.
These are presentation diagnostics, **not** weapon-range checks, damage
forecasts, collision avoidance, protection bonuses or mission outcomes.
Reduced motion still freezes positions/progress, not reaction evaluation.
Cleanup releases reaction pose maps but retains the copied transition history.

#### Staged reinforcements

Use the opt-in wave mode for a larger convoy presentation:

```javascript
const preview = await renderer.startHeroBattlePreview({
  scenario: 'convoy', reinforcements: true, seed: 42, reducedMotion: false,
});
```

The wave mode defaults to **48 total ships**, still within the existing even
8-128 range. Each wing starts with its first `ceil(wingSize / 2)` ships;
the remainder is split evenly (rounded up for the first wave) between
reinforcements at **8 and 16 seconds**, on exact presentation steps 480/960.
At the default size this is 24 initial ships and two 12-ship waves.
The convoy remains in the initial group. All assets are prepared during setup;
arrivals allocate no extra model or GPU resources and do not exceed the
requested total fleet size.

Pending ships are excluded from mesh/shield rendering, health HUD, weapon
sources, all target selection and threat counts. Target controls reject them;
groups with no arrived survivors cannot receive orders. The reserve is
initially entirely pending in the default 48-ship formation. Arrivals inherit
existing group intent. A held reserve still requires deployment after arrival.
The overview lists every blue group's active/pending count and order, plus
wave counts and countdowns.

North/south reinforcements appear at opposite scene-depth flanks (-9/+9
scene radii), at x=-13 for blue or +13 for red. They blend into their
ordered positions over two seconds and cannot emit new fire during that
entry interval. This is a presentation entrance, not a hyperspace effect,
new transit mechanic, physical collision avoidance or invulnerability.
Reduced motion disables the spatial entrance but still releases waves at
their scheduled times; convoy route progress remains stationary.

Only in wave mode, each ship's fixed authored shield/hull/death keyframes are
offset by its scheduled arrival time. Pending ships therefore cannot burn or
die before entry. This pre-authored timeline is independent of commands and
shot outcomes. Existing previews without `reinforcements: true` retain their
previous defaults and timing. No backend mutations or mission result exist.

`hero.waves` reports `enabled`, three wave summaries
(`wave`, `at`, `flank`, `total`, `pending`, `active`) and copied arrival events
(`index`, `wave`, `at`, `flank`, `step`). `hero.presentation.ships` includes
`arrival` and `flank` in wave mode. Events are bounded by the requested
ship count and retained in the final report. Stop never releases pending
waves or fast-forwards their damage. Seeds and command steps reproduce
arrivals, maneuver samples and weapon logs across render cadences.

#### Continuous five-minute capture

Convoy QA accepts `durationMs` up to **300000**. Other preview scenarios
remain capped at 30000 ms; existing defaults are unchanged.
For convoy durations over 30 seconds, the authored timeline scale is
`durationSeconds / 30`: the convoy route and per-ship damage keyframes stretch
by that factor, as do scheduled wave arrivals. Movement periods, weapon
cadences, 1.2-second order blends and two-second entries retain real-time
speed. At five minutes, reinforcements enter at 80/160 seconds and the convoy
finishes its route at 240 seconds. Damage remains pre-authored, not simulated.

Seeded tactics prepare enough four-second phases for the full duration plus
four seconds of projectile prediction. Future command steps are bounded by
the configured replay duration (18000 at five minutes). Existing caps for
command/reaction history, retained shot/decision logs, metrics and VFX remain
unchanged. Short direct sessions default to the previous 30-second ceiling.

The five-minute recording uses the actual WebGPU canvas at 1920x1080,
MediaRecorder VP9 capture and a separate recording canvas that paints the
projected shield/hull HUD plus seed/time/orders/threat/wave telemetry.
It is a continuous real-time replay, not repeated clips or slowed footage.
The export is silent; no music or sound assets are copied into the video.

## Phase 1: Installation Weapon Fire ✅ **COMPLETE**

### Event Flow
1. **Enqueue**: `enqueueInstallationWeaponFire(event)` (public API)
   - Validates & normalizes event payload
   - Limits queue to 180 pending events max
   - Calls internal `_queueInstallationWeaponFire()`

2. **Apply**: `_applyPendingInstallationWeaponFire(elapsed)` 
   - Routes by entity type (sourceType field)
   - Installation: `→ _applyWeaponFireToInstallations()`
   - Future entity types routed to Phase 2 handlers

3. **Installation Handler**: `_applyWeaponFireToInstallations(ev, elapsed)`
   - Filters FX entries by:
     - weaponKind (optional)
     - sourceOwner (optional)
   - Triggers shot: `_triggerInstallationWeaponFire()`

4. **Trigger Shot**: `_triggerInstallationWeaponFire(fxEntry, elapsed, state, cadenceScale)`
   - Calculates cadence & shot duration
   - Creates BeamEffect record with colors/geometry
   - Calls `this.beamEffect.addBeam(record)`
   - Spawns burst particles (muzzle, impact, debris, trail)

### Event Payload Structure
```javascript
{
  sourceType: 'installation',     // Routing key (null = broadcast)
  sourceOwner: 'Faction Name',    // Filter by faction (null = all)
  sourcePosition: 0,              // [Reserved] target index
  weaponKind: 'laser',            // Filter by weapon type (null = all)
  targetPos: [x, y, z],           // [Unused] future impact particles
  energy: 100,                    // [Unused] future HUD display
}
```

### Integration Points
- **Event Listeners**: `gq:combat:weapon-fire`, `gq:weapon-fire` windows events
- **BeamEffect Pool**: Instanced beam rendering via `this.beamEffect.addBeam()`
- **Installation Registry**: `this.systemInstallationWeaponFxEntries[]`
- **Burst Emitters**: Muzzle, impact, debris, trail particles

---

## Phase 2: Multi-Entity Weapon Fire (PARTIAL)

### Ships/Vessels
**Handler**: `_applyWeaponFireToShips(ev, elapsed)`
- Exact source fleet and body-slot targeting for resolved battle-round cues
- Current procedural fleet formations fire from the formation origin; authored
  hardpoint transforms and weapon-specific projectile paths remain future work

### Debris/Wreckage  
**Handler**: `_applyWeaponFireToDebris(ev, elapsed)`
- Track debris objects and positions
- Animate destruction progression
- Accumulate damage state
- Trigger secondary explosions at threshold

### Wormholes/Gateways
**Handler**: `_applyWeaponFireToWormholes(ev, elapsed)`
- Visualize destabilization patterns
- Animate energy discharge sequences
- Handle beacon unlock/rupture effects
- Trigger environmental hazards

---

## Usage Examples

### Broadcast Laser Fire
```javascript
renderer.enqueueInstallationWeaponFire({
  sourceType: 'installation',
  weaponKind: 'laser',
  // No sourceOwner → fires on ALL installations
});
```

### Faction-Specific Beam Fire
```javascript
renderer.enqueueInstallationWeaponFire({
  sourceType: 'installation',
  sourceOwner: 'Helion Confederation',
  weaponKind: 'beam',
});
```

### Game Event Trigger
```javascript
window.dispatchEvent(new CustomEvent('gq:combat:weapon-fire', {
  detail: {
    sourceType: 'installation',
    sourceOwner: 'Iron Fleet',
    weaponKind: 'missile',
  }
}));
```

---

## Technical Details

### Cadence & Shot Duration Config
- **Installation Kind Lookup**: `_installationWeaponFxCadence()`, `_installationWeaponFxShotDuration()`
- **Animation State**: 'active', 'dormant', 'damaged', 'destroyed'
- **Cadence Scale**: Per-event multiplier (1.0 = default, 0.7 = slower)

### BeamEffect Record Schema
```javascript
{
  id: 'beam_laser_123456',           // Unique ID
  from: [x, y, z],                   // Start position (world coords)
  to: [x, y, z],                     // End position
  coreColor: 0x66ccff,               // Core beam color (RGB int)
  color: 0x66ccff,                   // Glow color
  glowRadius: 0.4,                   // Bloom size
  duration: 0.15,                    // Shot lifetime (seconds)
}
```

### Queue Management
- **Max Pending**: 180 events (configurable)
- **FIFO Processing**: All accumulated events per frame
- **Timestamp**: `performance.now()` recorded for debug

---

## Performance Considerations

1. **BeamEffect Pooling**: Instanced rendering = O(1) per beam
2. **Event Filtering**: Early-out on sourceType/weaponKind mismatch
3. **Entity Iteration**: Linear scan of FX entries (feasible <1000 installations)
4. **Burst Emitters**: Only spawned when cooldown expires
5. **Queue Limiting**: Prevents unlimited accumulation during lag spikes

---

## Debug & Testing

### Inspect Queue
```javascript
console.log(renderer.pendingInstallationWeaponFire);
```

### Manual Fire Trigger
```javascript
renderer.enqueueInstallationWeaponFire({
  sourceType: 'installation',
  weaponKind: 'laser',
});
```

### Check Active Beams
```javascript
console.log(renderer.beamEffect?.beams?.size);
```

---

## Future Enhancements

- [ ] Ship hardpoint targeting system
- [ ] Debris destruction state machine
- [ ] Wormhole destabilization animations
- [ ] Target impact prediction (collision-based)
- [ ] Weapon charge-up sequences
- [ ] Electromagnetic interference VFX
- [ ] Chain-reaction damage propagation
