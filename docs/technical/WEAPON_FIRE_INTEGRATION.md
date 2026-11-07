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
