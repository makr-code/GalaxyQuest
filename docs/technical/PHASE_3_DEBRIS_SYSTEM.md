# Phase 3: Advanced Debris & Damage State System (Planning)

## Status
Phase 2 Implementation: ✅ COMPLETE
- Multi-entity routing working
- Ship weapon fire with targeting
- Wormhole discharge effects
- CombatVfxBridge enhancements

**Date Started**: 2 April 2026
**Scope**: Realistic debris destruction mechanics

---

## Phase 3 Objectives

### 1. Debris Management System ✅ ASSIGNED

**Create**: `DebrisManager` class in `js/engine/DebrisManager.js`

**Responsibilities**:
- Registry of active debris objects
- Damage accumulation per debris piece
- State transitions (intact → damaged → critical → destroyed)
- Lifecycle management (spawn → age → despawn)

**Data Structure**:
```javascript
{
  id: 'debris_asteroid_123',
  position: [x, y, z],
  state: 'intact' | 'damaged' | 'critical' | 'destroyed',
  damageLevel: 0.0..1.0,      // Cumulative health
  health: 100,
  maxHealth: 100,
  model: 'asteroid_large',    // Reference for visuals
  fragmentCount: 0,
  lastHit: timestamp,
}
```

### 2. Damage Thresholds & Transitions ✅ ASSIGNED

**Implementation**: Automatic state progression in weapon handler

```javascript
function _updateDebrisState(debris, damageIncrement) {
  debris.damageLevel = Math.min(1.0, debris.damageLevel + damageIncrement);
  
  // State transitions
  if (debris.damageLevel >= 0.9) {
    debris.state = 'destroyed';    // Complete destruction
    fragments = 24;
  } else if (debris.damageLevel >= 0.65) {
    debris.state = 'critical';     // Heavy damage
    fragments = 12;
  } else if (debris.damageLevel >= 0.35) {
    debris.state = 'damaged';      // Medium damage
    fragments = 6;
  }
}
```

**Thresholds**:
- **Damaged**: 35% health → 6 fragments
- **Critical**: 65% health → 12 fragments  
- **Destroyed**: 90% health → 24 fragments + removal

### 3. Fragment Cascade System ✅ ASSIGNED

**Feature**: Progressive particle emissions as damage accumulates

**Cascade Pattern**:
```
Hit 1: 6 particles, angle spread 0.2π
  ↓
Hit 2: +3 particles, spread 0.3π
  ↓
Hit 3: +8 particles (critical), spread 0.5π
  ↓
Final: +16 particles (destroyed explosion)
```

**Physics**:
- Radial velocity: 5-15 m/s
- Lifetime: 1.2-2.5 seconds
- Size: 0.05-0.15 units
- Color: Debris material color + darkening
- Rotation: Random angular velocity

### 4. Secondary Explosion Events ✅ ASSIGNED

**Trigger**: On `state → 'destroyed'`

**Effect**:
1. Burst emitter at debris center (high intensity)
2. Shockwave ring expanding at 20 m/s
3. Audio event dispatch (if audio system active)
4. Secondary debris spawning (100 fragments)
5. Registry cleanup

```javascript
_triggerDebrisExplosion(debris, elapsed) {
  // 1. Max burst
  this._spawnDebrisFragments(debris, 100, 'explosion');
  
  // 2. Shockwave
  const shockwave = this._createShockwaveRing(debris.position);
  this.systemDebrisExplosionGroup.add(shockwave);
  
  // 3. Audio event
  window.dispatchEvent(new CustomEvent('debris:explosion', {
    detail: { position: debris.position }
  }));
  
  // 4. Cleanup
  this.debrisManager.destroy(debris.id);
}
```

### 5. Visual Damage Progression ✅ ASSIGNED

**Mesh Material Updates**:
- **Intact** (0-35%): Full brightness, original color
- **Damaged** (35-65%): 0.7×brightness, slight orange tint
- **Critical** (65-90%): 0.4×brightness, heavy orange/red
- **Destroyed** (90%+): Fade out + removal

```javascript
_updateDebrisMaterial(debris, damageLevel) {
  const material = debris.mesh?.material;
  if (!material) return;
  
  const colorShift = new THREE.Color(1, 0.5, 0.2); // Orange
  const factor = Math.min(1.0, damageLevel * 1.5);
  
  material.color.lerp(colorShift, factor * 0.3);
  material.emissive.lerp(colorShift, factor * 0.5);
  material.emissiveIntensity = factor * 0.8;
}
```

### 6. Accumulation Tracking ✅ ASSIGNED

**Data Storage**:
- Total damage received per impact event
- Hit timestamp for time-decay (optional)
- Attacker info (faction that dealt damage)
- Cooperative damage (multiple attackers)

```javascript
{
  damageHistory: [
    { timestamp, amount, attacker: 'Iron Fleet', type: 'laser' },
    { timestamp, amount, attacker: 'Helion Confederation', type: 'beam' },
  ],
  totalDamage: 34,
  cooperativeAttack: true,
}
```

---

## Implementation Timeline

### Week 1: Core Debris System
- [ ] Create `DebrisManager` class
- [ ] Registry operations (add, update, remove)
- [ ] State transitions
- [ ] Unit tests (5-10 cases)

### Week 2: Damage & Events
- [ ] Damage accumulation logic
- [ ] Fragment spawning system
- [ ] Shockwave effects
- [ ] Integration tests

### Week 3: Visual Polish
- [ ] Material damage progression
- [ ] Particle physics
- [ ] Audio integration hook
- [ ] Performance optimization

### Week 4: Testing & Refinement
- [ ] Load testing (500+ concurrent debris)
- [ ] Frame time profiling
- [ ] Memory usage analysis
- [ ] Tuning parameters

---

## Files to Modify/Create

| File | Type | Changes |
|------|------|---------|
| `js/engine/DebrisManager.js` | NEW | Debris registry + state machine |
| `js/rendering/galaxy-renderer-core.js` | MOD | Enhanced debris handler |
| `tests/Unit/debris-manager.test.js` | NEW | Unit tests |
| `tests/js/debris-system.integration.test.js` | NEW | Integration tests |

**Estimated LOC**:
- DebrisManager: ~300 lines
- Enhanced handler: ~100 lines
- Tests: ~250 lines
- Total: ~650 lines

---

## Performance Budgeting

### Memory (estimate)
- Per debris object: ~150 bytes
- 500 active debris: ~75 KB (acceptable)
- Fragment pool: 1000 particles × 50 bytes = 50 KB

### CPU (per frame)
- Damage check + state update: 0.2ms (500 debris)
- Fragment spawning: 0.5ms (if triggered)
- Material updates: 0.3ms
- Total: ~1ms for 500 debris at 60fps

### GPU
- Fragment particles: Instanced (O(1) submission)
- Material updates: Per-debris (minor overhead)
- Shockwave: Single mesh per event

---

## Integration Points

### Event Dispatch
```javascript
// Debris hit event
renderer.enqueueInstallationWeaponFire({
  sourceType: 'debris',
  targetPos: [100, 50, -150],
  damageAmount: 25,          // NEW
});

// Listen for explosions
window.addEventListener('debris:explosion', (ev) => {
  console.log('Debris destroyed at', ev.detail.position);
});
```

### DebrisManager Usage
```javascript
const debrisManager = new DebrisManager();

// Spawn
debrisManager.add('asteroid_1', [0, 0, 0], { health: 100 });

// Damage
debrisManager.applyDamage('asteroid_1', 30);

// Query state
const debris = debrisManager.get('asteroid_1');
console.log(debris.state); // 'damaged'

// Listen for state changes
debrisManager.on('state-changed', (debris) => {
  if (debris.state === 'destroyed') {
    renderer._triggerDebrisExplosion(debris);
  }
});
```

---

## Future Enhancements (Phase 4+)

- [ ] Physics-based fragment trajectories
- [ ] Damage reflection to nearby entities
- [ ] Debris field hazard avoidance
- [ ] Procedural asteroid mesh generation
- [ ] Debris collection/mining mechanics
- [ ] Long-term debris persistence (database)
- [ ] Environmental damage (asteroids → planet damage)
- [ ] Real-time destruction visualization streaming

---

## Success Criteria

✅ Acceptance Tests:
- [ ] Debris takes cumulative damage from multiple hits
- [ ] State transitions happen at correct thresholds
- [ ] Fragments spawn with correct counts per state
- [ ] Explosions trigger cleanly
- [ ] No memory leaks during 10-minute sustained scenario
- [ ] Frame rate stable (60+ FPS) with 500+ debris
- [ ] Materials update smoothly
- [ ] Audio events dispatch correctly

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Memory leak in debris tracking | Implement proper cleanup, track object lifecycle |
| Frame drop under particle load | Implement LOD, distance culling |
| State machine bugs | Comprehensive unit tests, state diagram validation |
| Physics unrealistic | Tunable parameters, visual polish separate from realism |
| Integration conflicts | Strong API boundaries, event-driven design |

---

## Dependencies

- ✅ Phase 1: BeamEffect integration complete
- ✅ Phase 2: Multi-entity routing complete
- ✅ ES6 classes, THREE.js API
- ⏳ Audio system (optional, event hook ready)

---

## Ownership & Review

**Owner**: [Assign]
**Reviewers**: [Assign]  
**QA Lead**: [Assign]

**Kickoff Date**: 2 April 2026
**Target Completion**: 3 weeks (19 April 2026)

---

## Notes

- Keep debris system independent from ships/installations (clean separation)
- Event-driven approach allows other systems to hook in
- Fragment count tuning is visual/gameplay decision
- Performance profiling required before full production merge
