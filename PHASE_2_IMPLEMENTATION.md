# Phase 2 Implementation Guide: Multi-Entity Weapon Fire System

## Overview
This guide outlines the architecture for extending weapon-fire effects to ships, debris, wormholes, and beacons in a scalable, efficient way.

---

## 1. Ship Weapon Fire System

### 1.1 Architecture

**Entity Registry**: Maintain a live collection of vessel objects in the renderer
```javascript
this.activeShips = new Map(); // id → { mesh, fxEntries, owner, position }
```

**Handler Method**:
```javascript
_applyWeaponFireToShips(ev, elapsed) {
  if (!this.activeShips || this.activeShips.size === 0) return;
  
  this.activeShips.forEach((ship) => {
    if (ev.sourceOwner && ev.sourceOwner !== String(ship.owner || '')) return;
    if (ev.weaponKind && !this._shipHasWeaponKind(ship, ev.weaponKind)) return;
    
    this._triggerShipWeaponFire(ship, ev, elapsed);
  });
}
```

### 1.2 Hardpoint Resolution

**Ship Model VFX Bridge**:
```javascript
// In each ship 3D model, mark weapon attachment points
{
  hardpoints: [
    { kind: 'laser', attachUuid: '...', position: [0, 0.5, 1.2] },
    { kind: 'beam', attachUuid: '...', position: [0, 0.5, -1] },
    { kind: 'missile', attachUuid: '...', position: [-0.3, 0.2, 0] },
  ]
}
```

**Resolution Logic**:
```javascript
_triggerShipWeaponFire(ship, ev, elapsed) {
  const hardpoints = ship.mesh.userData?.gqResolvedVfx?.hardpoints || [];
  
  hardpoints.forEach((hp) => {
    if (ev.weaponKind && hp.kind !== ev.weaponKind) return;
    
    const attachNode = ship.mesh.getObjectByProperty('uuid', hp.attachUuid);
    const worldPos = new THREE.Vector3();
    attachNode?.getWorldPosition(worldPos);
    
    // Create beam from hardpoint position
    // TODO: Target calculation (search for nearby enemy vessels)
  });
}
```

### 1.3 Beacon Detection & Targeting

Ships should target enemy installations/beacons if available:
```javascript
_findTargetBeaconForShip(ship, ev) {
  // Search nearby installations
  for (const fxEntry of this.systemInstallationWeaponFxEntries) {
    const install = fxEntry.installEntry;
    if (!install || install.owner === ship.owner) continue;
    
    const distance = ship.position.distanceTo(install.position);
    if (distance < 100) return install; // Range check
  }
  return null;
}
```

---

## 2. Debris Destruction System

### 2.1 Debris Registry

**Dynamic Tracking**:
```javascript
this.activeDebris = new Map(); // id → { mesh, position, damage, state }
```

**Damage State Machine**:
```javascript
{
  STATE: 'intact' | 'damaged' | 'critical' | 'destroyed',
  damageLevel: 0.0 ..1.0,
  nextExplosion: timestamp,
  fragmentCount: number,
}
```

### 2.2 Destruction Effects

**Visual Progression**:
```javascript
_triggerDebrisDestructionFx(debris, ev, elapsed) {
  // Increment damage
  debris.damageLevel = Math.min(1.0, debris.damageLevel + 0.2);
  
  // State transition
  if (debris.damageLevel > 0.75) {
    debris.STATE = 'critical';
    this._spawnDebrisFragments(debris, elapsed, 8);
  } else if (debris.damageLevel > 0.4) {
    debris.STATE = 'damaged';
    this._spawnDebrisFragments(debris, elapsed, 3);
  }
  
  // Complete destruction
  if (debris.damageLevel >= 1.0) {
    debris.STATE = 'destroyed';
    this.activeDebris.delete(debris.id);
    // Trigger final explosion
  }
}
```

### 2.3 Fragment Generation

**Procedural Particle System**:
```javascript
_spawnDebrisFragments(debris, elapsed, count) {
  if (!this.systemKineticDebrisGroup) return;
  
  for (let i = 0; i < count; i++) {
    const velocity = this._randomDebrisVelocity();
    const geometry = new THREE.BoxGeometry(
      THREE.MathUtils.randFloat(0.05, 0.2),
      THREE.MathUtils.randFloat(0.05, 0.2),
      THREE.MathUtils.randFloat(0.05, 0.2)
    );
    const material = new THREE.MeshStandardMaterial({ color: 0x8b7355 });
    const fragment = new THREE.Mesh(geometry, material);
    
    fragment.position.copy(debris.position);
    fragment.velocity = velocity;
    fragment.lifetime = 2.5;
    
    this.systemKineticDebrisGroup.add(fragment);
  }
}
```

---

## 3. Wormhole & Beacon System

### 3.1 Wormhole Destabilization

**Event Payload**:
```javascript
{
  sourceType: 'wormhole',
  sourceOwner: 'Beacon Name', // or null for unowned
  weaponKind: 'beam',
  // Destination if targeting linked wormhole
}
```

**Destabilization Animation**:
```javascript
_applyWeaponFireToWormholes(ev, elapsed) {
  this.wormholeEffects.forEach((wh) => {
    if (ev.sourceOwner && wh.name !== ev.sourceOwner) return;
    
    wh.destabilization += 0.15;
    wh.destabilization = Math.min(1.0, wh.destabilization);
    
    if (wh.destabilization > 0.5) {
      this._spawnWormholeDisruptionFx(wh, elapsed);
    }
  });
}
```

**Rupture Effect** (when fully charged):
```javascript
_triggerWormholeRupture(wormhole, elapsed) {
  // Discharge ring
  const ring = this._createDischargeRing(wormhole.position, 50);
  this.systemWormholeDisruptionGroup.add(ring);
  
  // Shockwave
  const shockwave = this._createShockwave(wormhole.position);
  this.systemWormholeDisruptionGroup.add(shockwave);
  
  // Cascade to linked wormhole
  if (wormhole.linkedId) {
    const linked = this.wormholeEffects.find(w => w.id === wormhole.linkedId);
    if (linked) this._triggerWormholeRupture(linked, elapsed);
  }
}
```

---

## 4. Integration Points

### 4.1 Event Listener Setup

**Extend Existing Listener**:
```javascript
_onCombatWeaponFireEvent = (event) => {
  const payload = ev?.detail ?? ev?.payload ?? null;
  this._queueInstallationWeaponFire(payload);
};

// Route within _applyPendingInstallationWeaponFire():
if (eventSourceType === 'ship') {
  this._applyWeaponFireToShips(ev, elapsed);
} else if (eventSourceType === 'debris') {
  this._applyWeaponFireToDebris(ev, elapsed);
} else if (eventSourceType === 'wormhole') {
  this._applyWeaponFireToWormholes(ev, elapsed);
}
```

### 4.2 Game Engine Integration

**Ship Registry Event**:
```javascript
window.dispatchEvent(new CustomEvent('gq:vessel:spawned', {
  detail: {
    shipId: '...',
    owner: 'Player Name',
    mesh: threeObject,
  }
}));

// Renderer listener:
this._onVesselSpawned = (ev) => {
  const { shipId, owner, mesh } = ev.detail;
  this.activeShips.set(shipId, { mesh, owner, position: mesh.position });
};
```

---

## 5. Performance Optimizations

### 5.1 Spatial Partitioning

For large entity counts, use frustum culling:
```javascript
_culledShipsInView(camera) {
  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  );
  
  return Array.from(this.activeShips.values()).filter(ship =>
    frustum.intersectsObject(ship.mesh)
  );
}
```

### 5.2 LOD System

Distance-based effect detail:
```javascript
_getLodLevel(distance) {
  if (distance < 50) return 'high';    // Full particles
  if (distance < 150) return 'medium'  // Reduced particles
  return 'low';                         // Beam only, no particles
}
```

### 5.3 Queue Limiting

Respect frame budget:
```javascript
const MAX_DEBRIS_FRAGMENTS_PER_FRAME = 128;
const MAX_BEAMS_PER_FRAME = 50;

if (this.frameBeamCount >= MAX_BEAMS_PER_FRAME) {
  // Defer to next frame
  this.pendingInstallationWeaponFire.unshift(event);
  return;
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests
- [ ] Ship hardpoint resolution
- [ ] Debris damage state transitions
- [ ] Wormhole cascade effects
- [ ] Targeting filter accuracy

### 6.2 Integration Tests
- [ ] Multi-entity weapon fire events
- [ ] Simultaneous ship + installation fire
- [ ] Debris field generation under load
- [ ] Wormhole rupture chains

### 6.3 Performance Tests
- [ ] 100+ ships firing simultaneously
- [ ] 1000+ debris fragments active
- [ ] Wormhole cascade (10-deep) impact
- [ ] Frame time budgeting

---

## 7. Timeline & Milestones

### Phase 2a: Ship System (Week 1-2)
- [x] Define hardpoint registry format
- [ ] Implement `_applyWeaponFireToShips()`
- [ ] Beacon targeting logic
- [ ] Hardpoint attachment resolution
- [ ] Unit tests

### Phase 2b: Debris System (Week 3)
- [ ] Implement debris registry
- [ ] Damage state machine
- [ ] Fragment generation system
- [ ] Integration tests

### Phase 2c: Wormhole System (Week 4)
- [ ] Wormhole destabilization animation
- [ ] Rupture/discharge effects
- [ ] Cascade chain logic
- [ ] Full E2E testing

### Phase 2d: Optimization & Polish (Week 5)
- [ ] Spatial partitioning
- [ ] LOD system
- [ ] Queue optimization
- [ ] Performance tuning

---

## 8. API Reference

### Event Dispatch Examples

**Ship Weapon Fire**:
```javascript
renderer.enqueueInstallationWeaponFire({
  sourceType: 'ship',
  sourceOwner: 'Player Alpha',
  weaponKind: 'laser',
});
```

**Debris Destruction**:
```javascript
renderer.enqueueInstallationWeaponFire({
  sourceType: 'debris',
  sourcePosition: debrisId,
  targetPos: [x, y, z], // impact point
});
```

**Wormhole Rupture**:
```javascript
renderer.enqueueInstallationWeaponFire({
  sourceType: 'wormhole',
  sourceOwner: 'Beacon Alpha',
  energy: 100, // charge level
});
```

---

## 9. Code Templates

### Debris Manager (Stub)

```javascript
class DebrisManager {
  constructor() {
    this.debris = new Map();
  }

  add(id, position, model = 'generic') {
    this.debris.set(id, {
      id,
      position: new THREE.Vector3(...position),
      model,
      state: 'intact',
      damageLevel: 0,
      fragmentCount: 0,
    });
  }

  applyDamage(id, amount) {
    const d = this.debris.get(id);
    if (d) d.damageLevel = Math.min(1.0, d.damageLevel + amount);
  }

  destroy(id) {
    this.debris.delete(id);
  }
}
```

### Ship Targeting (Stub)

```javascript
class ShipWeaponSystem {
  constructor() {
    this.ships = new Map();
  }

  fire(shipId, targetType = 'nearest-enemy') {
    const ship = this.ships.get(shipId);
    if (!ship) return null;

    let target = null;
    if (targetType === 'nearest-enemy') {
      target = this._findNearestEnemy(ship);
    } else if (targetType === 'nearest-beacon') {
      target = this._findNearestBeacon(ship);
    }

    return target ? { source: ship, target } : null;
  }
}
```

---

**Next Steps**: Review Phase 2a requirements with design team, finalize ship registry format, begin hardpoint implementation.
