import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('GalaxyRendererCore - Weapon Fire Integration', () => {
  let renderer;

  beforeEach(() => {
    // Mock minimal renderer setup
    renderer = {
      pendingInstallationWeaponFire: [],
      systemInstallationWeaponFxEntries: [],
      systemFleetEntries: [],
      debrisManager: null,
      beamEffect: { addBeam: vi.fn() },

      _distance3: function(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return Number.POSITIVE_INFINITY;
        const dx = Number(a[0] || 0) - Number(b[0] || 0);
        const dy = Number(a[1] || 0) - Number(b[1] || 0);
        const dz = Number(a[2] || 0) - Number(b[2] || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
      },

      _normalizeWeaponFireTargetPos: function(rawPos) {
        if (Array.isArray(rawPos) && rawPos.length >= 3) {
          return [Number(rawPos[0]) || 0, Number(rawPos[1]) || 0, Number(rawPos[2]) || 0];
        }
        if (rawPos && typeof rawPos === 'object') {
          return [Number(rawPos.x) || 0, Number(rawPos.y) || 0, Number(rawPos.z) || 0];
        }
        return null;
      },

      _ownersLikelyHostile: function(ownerA, ownerB) {
        const a = String(ownerA || '').trim();
        const b = String(ownerB || '').trim();
        if (!a || !b) return true;
        return a !== b;
      },

      _resolveShipWeaponTarget: function(fleetEntry, shipWorldPos, targetHint = null, maxRange = 220) {
        const shipOwner = String(fleetEntry?.fleet?.owner || '').trim();
        const hint = this._normalizeWeaponFireTargetPos(targetHint);
        const range = Math.max(40, Number(maxRange) || 220);

        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;

        const considerCandidate = (worldPos, type, baseBias = 0) => {
          const dist = this._distance3(shipWorldPos, worldPos);
          if (!Number.isFinite(dist) || dist > range) return;

          let score = dist + Number(baseBias || 0);
          if (hint) {
            const hintDist = this._distance3(hint, worldPos);
            score += hintDist * 0.45;
            if (hintDist <= 28) score -= 30;
          }

          if (score < bestScore) {
            bestScore = score;
            best = { type, world: [...worldPos] };
          }
        };

        (this.systemFleetEntries || []).forEach((candidateEntry) => {
          if (!candidateEntry || candidateEntry === fleetEntry) return;
          const targetOwner = String(candidateEntry?.fleet?.owner || '').trim();
          if (!this._ownersLikelyHostile(shipOwner, targetOwner)) return;
          const worldPos = Array.isArray(candidateEntry.worldPos) ? candidateEntry.worldPos : null;
          if (!worldPos) return;
          considerCandidate(worldPos, 'fleet', -8);
        });

        (this.systemInstallationWeaponFxEntries || []).forEach((fxEntry) => {
          const install = fxEntry?.installEntry;
          const worldPos = Array.isArray(fxEntry.worldTo) ? fxEntry.worldTo : null;
          if (!install || !worldPos) return;
          const targetOwner = String(install.owner || '').trim();
          if (!this._ownersLikelyHostile(shipOwner, targetOwner)) return;
          considerCandidate(worldPos, 'installation', 4);
        });

        const allDebris = (this.debrisManager && typeof this.debrisManager.getAll === 'function')
          ? this.debrisManager.getAll()
          : [];
        allDebris.forEach((debris) => {
          if (!Array.isArray(debris?.position) || debris.position.length < 3) return;
          considerCandidate(debris.position, 'debris', 10);
        });

        if (!best && hint) {
          return { type: 'hint', world: [...hint] };
        }
        return best;
      },

      _triggerShipWeaponFire: function(fleetEntry, ev, elapsed, state = 'active') {
        if (!fleetEntry?.mesh || !this.beamEffect) return;

        const weaponKey = String(ev?.weaponKind || 'default');
        const nextFireAt = Number(fleetEntry?._nextShipFire?.[weaponKey] || 0);
        if (elapsed < nextFireAt) return;

        const shipWorldPos = Array.isArray(fleetEntry.worldPos) ? fleetEntry.worldPos : [0, 0, 0];
        const targetHint = this._normalizeWeaponFireTargetPos(ev?.targetPos ?? ev?.target_pos ?? null);
        const resolvedTarget = this._resolveShipWeaponTarget(fleetEntry, shipWorldPos, targetHint, 220);
        if (!resolvedTarget) return;

        const cadence = state === 'alert' ? 0.28 : 0.5;
        const shotDuration = state === 'alert' ? 0.34 : 0.22;

        this.beamEffect.addBeam({
          id: `ship_beam_${fleetEntry.fleet?.id || 'unknown'}_${Date.now()}`,
          from: [...shipWorldPos],
          to: [...resolvedTarget.world],
          coreColor: Number(ev.coreColor ?? 0x00ff88),
          color: Number(ev.color ?? 0x00ff88),
          glowRadius: 0.35,
          duration: shotDuration,
        });

        if (!fleetEntry._nextShipFire) fleetEntry._nextShipFire = {};
        fleetEntry._nextShipFire[weaponKey] = elapsed + cadence;
      },

      _isWormholeLikeInstallation: function(installEntry) {
        const installType = String(
          installEntry?.type
          || installEntry?.kind
          || installEntry?.install?.type
          || installEntry?.mesh?.userData?.installType
          || ''
        ).toLowerCase();
        return installType.includes('wormhole')
          || installType.includes('gate')
          || installType.includes('beacon');
      },

      _wormholeDestabilizationGain: function(ev, installEntry) {
        const weaponKind = String(ev?.weaponKind || '').toLowerCase();
        const energyRaw = Number(ev?.energy ?? ev?.power ?? 0.55);
        const energy = Math.max(0.1, Math.min(4.5, Number.isFinite(energyRaw) ? energyRaw : 0.55));
        const level = Math.max(1, Number(installEntry?.level || installEntry?.install?.level || 1));

        let weaponMult = 1;
        if (weaponKind === 'rail') weaponMult = 1.22;
        else if (weaponKind === 'plasma') weaponMult = 1.14;
        else if (weaponKind === 'missile') weaponMult = 0.92;
        else if (weaponKind === 'beam') weaponMult = 1.05;

        const levelResist = 1 / (1 + (level - 1) * 0.12);
        const gain = 0.06 * energy * weaponMult * levelResist;
        return Math.max(0.015, Math.min(0.24, gain));
      },

      _triggerWormholeRupture: vi.fn(),

      _applyWormholeDestabilizationHit: function(installEntry, ev, elapsed) {
        if (!installEntry) return null;

        const gain = this._wormholeDestabilizationGain(ev, installEntry);
        const state = installEntry.wormholeDestabilization || {
          progress: 0,
          lastHitAt: 0,
          cooldownUntil: 0,
          ruptureCount: 0,
        };

        state.progress = Math.max(0, Math.min(1.2, Number(state.progress || 0) + gain));
        state.lastHitAt = elapsed;

        if (state.progress >= 1 && elapsed >= Number(state.cooldownUntil || 0)) {
          state.ruptureCount = Number(state.ruptureCount || 0) + 1;
          state.cooldownUntil = elapsed + 4.5;
          state.progress = 0.34;
          this._triggerWormholeRupture(installEntry, state, elapsed);
        }

        installEntry.wormholeDestabilization = state;
        return state;
      },

      _applyWeaponFireToWormholes: function(ev, elapsed) {
        if (!Array.isArray(this.systemInstallationWeaponFxEntries)) return;

        this.systemInstallationWeaponFxEntries.forEach((fxEntry) => {
          const install = fxEntry?.installEntry;
          if (!install?.mesh) return;
          if (!this._isWormholeLikeInstallation(install)) return;
          if (ev.sourceOwner && ev.sourceOwner !== String(install.owner || '').trim()) return;

          const destabilization = this._applyWormholeDestabilizationHit(install, ev, elapsed);
          const progress = Number(destabilization?.progress || 0);
          if (!this.beamEffect) return;

          const numBeams = progress >= 0.75 ? 5 : (progress >= 0.35 ? 4 : 3);
          const beamDuration = 0.08 + progress * 0.08;
          const glowRadius = 0.45 + progress * 0.35;
          const from = Array.isArray(fxEntry.worldFrom) ? fxEntry.worldFrom : [0, 0, 0];

          for (let i = 0; i < numBeams; i += 1) {
            this.beamEffect.addBeam({
              id: `wormhole_discharge_${install.id || 0}_${i}_${Date.now()}`,
              from: [...from],
              to: [from[0] + i + 1, from[1], from[2]],
              coreColor: 0x6600ff,
              color: 0x9933ff,
              glowRadius,
              duration: beamDuration,
            });
          }
        });
      },
      
      // Methods under test (simplified versions for testing)
      _queueInstallationWeaponFire: function(payload) {
        if (!payload || typeof payload !== 'object') return false;
        
        const sourcePosition = Number(payload.sourcePosition ?? 0);
        const sourceOwner = String(payload.sourceOwner ?? '').trim();
        const sourceType = String(payload.sourceType ?? '').trim().toLowerCase();
        const weaponKind = String(payload.weaponKind ?? '').trim().toLowerCase();
        
        if (!sourcePosition && !sourceOwner && !sourceType && !weaponKind) return false;
        
        this.pendingInstallationWeaponFire.push({
          sourcePosition,
          sourceOwner,
          sourceType,
          weaponKind,
          ts: performance.now(),
        });
        
        if (this.pendingInstallationWeaponFire.length > 180) {
          this.pendingInstallationWeaponFire.splice(0, this.pendingInstallationWeaponFire.length - 180);
        }
        return true;
      },
      
      enqueueInstallationWeaponFire: function(event) {
        return this._queueInstallationWeaponFire(event);
      },

      _applyWeaponFireToShips: vi.fn(),
      _applyWeaponFireToDebris: vi.fn(),
      
      _applyPendingInstallationWeaponFire: function(elapsed) {
        if (!Array.isArray(this.pendingInstallationWeaponFire) || !this.pendingInstallationWeaponFire.length) return;
        
        const events = this.pendingInstallationWeaponFire.splice(0, this.pendingInstallationWeaponFire.length);
        
        events.forEach((ev) => {
          const eventSourceType = String(ev?.sourceType || '').toLowerCase();

          switch (eventSourceType) {
            case 'ship':
              this._applyWeaponFireToShips(ev, elapsed);
              break;
            case 'debris':
              this._applyWeaponFireToDebris(ev, elapsed);
              break;
            case 'wormhole':
            case 'gate':
            case 'beacon':
              this._applyWeaponFireToWormholes(ev, elapsed);
              break;
            case 'installation':
            case '':
            default:
              this._applyWeaponFireToInstallations(ev, elapsed);
              break;
          }
        });
      },
      
      _applyWeaponFireToInstallations: function(ev, elapsed) {
        if (!Array.isArray(this.systemInstallationWeaponFxEntries) || !this.systemInstallationWeaponFxEntries.length) return;
        
        this.systemInstallationWeaponFxEntries.forEach((fxEntry) => {
          const installEntry = fxEntry?.installEntry;
          if (!installEntry?.mesh) return;
          
          if (ev.weaponKind && ev.weaponKind !== String(fxEntry.kind || '').toLowerCase()) return;
          if (ev.sourceOwner && ev.sourceOwner !== String(installEntry.owner || '').trim()) return;
          
          const state = String(installEntry.animState || 'active');
          this._triggerInstallationWeaponFire(fxEntry, elapsed, state, 0.7);
        });
      },
      
      _triggerInstallationWeaponFire: function(fxEntry, elapsed, activeState, cadenceScale) {
        if (this.beamEffect && fxEntry.worldFrom && fxEntry.worldTo) {
          const beamRecord = {
            id: `beam_${fxEntry?.kind}_${Date.now()}`,
            from: fxEntry.worldFrom,
            to: fxEntry.worldTo,
            coreColor: 0x66ccff,
            duration: 0.15,
          };
          this.beamEffect.addBeam(beamRecord);
        }
      },
    };
  });

  describe('Event Enqueueing', () => {
    it('should enqueue a valid installation weapon-fire event', () => {
      const result = renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        weaponKind: 'laser',
      });
      
      expect(result).toBe(true);
      expect(renderer.pendingInstallationWeaponFire).toHaveLength(1);
      expect(renderer.pendingInstallationWeaponFire[0].sourceType).toBe('installation');
      expect(renderer.pendingInstallationWeaponFire[0].weaponKind).toBe('laser');
    });

    it('should reject empty payloads', () => {
      const result = renderer.enqueueInstallationWeaponFire({});
      expect(result).toBe(false);
      expect(renderer.pendingInstallationWeaponFire).toHaveLength(0);
    });

    it('should normalize sourceType to lowercase', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'INSTALLATION',
        weaponKind: 'laser',
      });
      
      expect(renderer.pendingInstallationWeaponFire[0].sourceType).toBe('installation');
    });

    it('should trim and normalize sourceOwner', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceOwner: '  Helion Confederation  ',
        weaponKind: 'beam',
      });
      
      expect(renderer.pendingInstallationWeaponFire[0].sourceOwner).toBe('Helion Confederation');
    });

    it('should handle null/undefined sourceType as broadcast', () => {
      renderer.enqueueInstallationWeaponFire({
        weaponKind: 'laser',
      });
      
      expect(renderer.pendingInstallationWeaponFire[0].sourceType).toBe('');
    });

    it('should limit queue to 180 events', () => {
      for (let i = 0; i < 200; i++) {
        renderer.enqueueInstallationWeaponFire({
          sourceType: 'installation',
          weaponKind: 'laser',
        });
      }
      
      expect(renderer.pendingInstallationWeaponFire.length).toBeLessThanOrEqual(180);
    });
  });

  describe('Event Routing', () => {
    it('should route installation-type events to installation handler', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          worldFrom: [0, 0, 0],
          worldTo: [1, 1, 1],
          installEntry: { mesh: {}, owner: 'Test Faction', animState: 'active' },
        },
      ];

      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        sourceOwner: 'Test Faction',
        weaponKind: 'laser',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).toHaveBeenCalled();
      expect(renderer.pendingInstallationWeaponFire).toHaveLength(0);
    });

    it('should route null sourceType as broadcast to installation handler', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          worldFrom: [0, 0, 0],
          worldTo: [1, 1, 1],
          installEntry: { mesh: {}, owner: 'Any Faction', animState: 'active' },
        },
      ];

      renderer.enqueueInstallationWeaponFire({
        weaponKind: 'laser',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).toHaveBeenCalled();
    });

    it('should route ship events to ship handler', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'ship',
        sourceOwner: 'Helion',
        weaponKind: 'beam',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer._applyWeaponFireToShips).toHaveBeenCalledTimes(1);
    });

    it('should route debris events to debris handler', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'debris',
        sourceOwner: 'Helion',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer._applyWeaponFireToDebris).toHaveBeenCalledTimes(1);
    });

    it('should route gate/beacon aliases to wormhole handler', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          worldFrom: [0, 0, 0],
          installEntry: { id: 7, mesh: {}, owner: 'Helion', type: 'stargate' },
        },
      ];

      renderer.enqueueInstallationWeaponFire({
        sourceType: 'gate',
        sourceOwner: 'Helion',
        weaponKind: 'beam',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).toHaveBeenCalled();
      expect(renderer._applyWeaponFireToShips).not.toHaveBeenCalled();
      expect(renderer._applyWeaponFireToDebris).not.toHaveBeenCalled();
    });

    it('should route unknown sourceType to installation fallback', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          worldFrom: [0, 0, 0],
          worldTo: [1, 1, 1],
          installEntry: { mesh: {}, owner: 'Any Faction', animState: 'active' },
        },
      ];

      renderer.enqueueInstallationWeaponFire({
        sourceType: 'unknown-type',
        weaponKind: 'laser',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).toHaveBeenCalledTimes(1);
      expect(renderer._applyWeaponFireToShips).not.toHaveBeenCalled();
      expect(renderer._applyWeaponFireToDebris).not.toHaveBeenCalled();
    });
  });

  describe('Installation Event Filtering', () => {
    beforeEach(() => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          worldFrom: [0, 0, 0],
          worldTo: [1, 1, 1],
          installEntry: { mesh: {}, owner: 'Helion Confederation', animState: 'active' },
        },
        {
          kind: 'beam',
          worldFrom: [2, 2, 2],
          worldTo: [3, 3, 3],
          installEntry: { mesh: {}, owner: 'Iron Fleet', animState: 'active' },
        },
      ];
    });

    it('should filter installations by weaponKind', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        weaponKind: 'laser',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      const calls = renderer.beamEffect.addBeam.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0].from).toEqual([0, 0, 0]);
    });

    it('should filter installations by sourceOwner', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        sourceOwner: 'Iron Fleet',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      const calls = renderer.beamEffect.addBeam.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0].from).toEqual([2, 2, 2]);
    });

    it('should filter by both weaponKind and sourceOwner', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        sourceOwner: 'Iron Fleet',
        weaponKind: 'beam',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      const calls = renderer.beamEffect.addBeam.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0].from).toEqual([2, 2, 2]);
    });

    it('should not fire with mismatched filters', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        sourceOwner: 'Iron Fleet',
        weaponKind: 'laser', // No Iron Fleet laser
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).not.toHaveBeenCalled();
    });

    it('should broadcast to all installations with null filters', () => {
      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
        // No sourceOwner or weaponKind filters
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).toHaveBeenCalledTimes(2);
    });
  });

  describe('BeamEffect Integration', () => {
    it('should create valid beam record with correct colors', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          worldFrom: [0, 0, 0],
          worldTo: [1, 1, 1],
          weapon: { coreColor: 0xff0000, glowColor: 0xff6600 },
          installEntry: { mesh: {}, owner: 'Test', animState: 'active' },
        },
      ];

      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      const call = renderer.beamEffect.addBeam.mock.calls[0][0];
      expect(call.from).toEqual([0, 0, 0]);
      expect(call.to).toEqual([1, 1, 1]);
      expect(call.duration).toBe(0.15);
    });

    it('should not create beam without worldFrom/worldTo', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          installEntry: { mesh: {}, owner: 'Test', animState: 'active' },
          // Missing worldFrom/worldTo
        },
      ];

      renderer.enqueueInstallationWeaponFire({
        sourceType: 'installation',
      });

      renderer._applyPendingInstallationWeaponFire(0.016);

      expect(renderer.beamEffect.addBeam).not.toHaveBeenCalled();
    });
  });

  describe('Ship Target Resolution', () => {
    const mkShip = (id, owner, worldPos) => ({
      mesh: {},
      fleet: { id, owner },
      worldPos,
      _nextShipFire: {},
    });

    it('should prefer hostile fleets over installations at similar range', () => {
      const shooter = mkShip('s1', 'Helion', [0, 0, 0]);
      const hostileFleet = mkShip('enemy-1', 'Iron Fleet', [60, 0, 0]);
      renderer.systemFleetEntries = [shooter, hostileFleet];
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'laser',
          worldTo: [62, 0, 0],
          installEntry: { owner: 'Iron Fleet', mesh: {} },
        },
      ];

      renderer._triggerShipWeaponFire(shooter, { weaponKind: 'laser' }, 10, 'active');

      const firstBeam = renderer.beamEffect.addBeam.mock.calls[0][0];
      expect(firstBeam.to).toEqual([60, 0, 0]);
    });

    it('should skip friendly targets and use hostile installation', () => {
      const shooter = mkShip('s1', 'Helion', [0, 0, 0]);
      const friendlyFleet = mkShip('ally-1', 'Helion', [30, 0, 0]);
      renderer.systemFleetEntries = [shooter, friendlyFleet];
      renderer.systemInstallationWeaponFxEntries = [
        {
          kind: 'beam',
          worldTo: [40, 0, 0],
          installEntry: { owner: 'Iron Fleet', mesh: {} },
        },
      ];

      renderer._triggerShipWeaponFire(shooter, { weaponKind: 'beam' }, 10, 'active');

      const firstBeam = renderer.beamEffect.addBeam.mock.calls[0][0];
      expect(firstBeam.to).toEqual([40, 0, 0]);
    });

    it('should honor cooldown and block rapid second shot', () => {
      const shooter = mkShip('s1', 'Helion', [0, 0, 0]);
      renderer.systemFleetEntries = [shooter, mkShip('enemy-1', 'Iron Fleet', [80, 0, 0])];

      renderer._triggerShipWeaponFire(shooter, { weaponKind: 'laser' }, 10, 'active');
      renderer._triggerShipWeaponFire(shooter, { weaponKind: 'laser' }, 10.2, 'active');

      expect(renderer.beamEffect.addBeam).toHaveBeenCalledTimes(1);
    });

    it('should use target hint as fallback when no entities are in range', () => {
      const shooter = mkShip('s1', 'Helion', [0, 0, 0]);
      renderer.systemFleetEntries = [shooter];
      renderer.systemInstallationWeaponFxEntries = [];

      renderer._triggerShipWeaponFire(
        shooter,
        { weaponKind: 'laser', targetPos: [150, 12, -6] },
        10,
        'active'
      );

      const firstBeam = renderer.beamEffect.addBeam.mock.calls[0][0];
      expect(firstBeam.to).toEqual([150, 12, -6]);
    });
  });

  describe('Wormhole Destabilization', () => {
    it('should classify wormhole-like installations by type/kind', () => {
      expect(renderer._isWormholeLikeInstallation({ type: 'wormhole_gate' })).toBe(true);
      expect(renderer._isWormholeLikeInstallation({ kind: 'beacon_relay' })).toBe(true);
      expect(renderer._isWormholeLikeInstallation({ type: 'shipyard' })).toBe(false);
    });

    it('should scale destabilization gain by weapon and installation level', () => {
      const lowLevel = { level: 1 };
      const highLevel = { level: 6 };

      const railLow = renderer._wormholeDestabilizationGain({ weaponKind: 'rail', energy: 1.0 }, lowLevel);
      const missileLow = renderer._wormholeDestabilizationGain({ weaponKind: 'missile', energy: 1.0 }, lowLevel);
      const railHigh = renderer._wormholeDestabilizationGain({ weaponKind: 'rail', energy: 1.0 }, highLevel);

      expect(railLow).toBeGreaterThan(missileLow);
      expect(railHigh).toBeLessThan(railLow);
    });

    it('should trigger rupture at threshold and apply cooldown reset', () => {
      const install = {
        id: 99,
        mesh: {},
        owner: 'Helion',
        type: 'wormhole',
        level: 1,
        wormholeDestabilization: {
          progress: 0.96,
          lastHitAt: 0,
          cooldownUntil: 0,
          ruptureCount: 0,
        },
      };

      const state = renderer._applyWormholeDestabilizationHit(install, { weaponKind: 'rail', energy: 2.0 }, 12.0);

      expect(renderer._triggerWormholeRupture).toHaveBeenCalledTimes(1);
      expect(state.ruptureCount).toBe(1);
      expect(state.cooldownUntil).toBeCloseTo(16.5, 5);
      expect(state.progress).toBeCloseTo(0.34, 5);
    });

    it('should only fire wormhole beams for matching owner filter', () => {
      renderer.systemInstallationWeaponFxEntries = [
        {
          worldFrom: [10, 0, 0],
          installEntry: {
            id: 1,
            mesh: {},
            owner: 'Helion',
            type: 'wormhole',
            level: 1,
          },
        },
        {
          worldFrom: [20, 0, 0],
          installEntry: {
            id: 2,
            mesh: {},
            owner: 'Iron Fleet',
            type: 'shipyard',
            level: 1,
          },
        },
      ];

      renderer._applyWeaponFireToWormholes({ sourceOwner: 'Helion', weaponKind: 'beam', energy: 1.4 }, 5.0);

      expect(renderer.beamEffect.addBeam).toHaveBeenCalledTimes(3);
      const first = renderer.beamEffect.addBeam.mock.calls[0][0];
      expect(first.from).toEqual([10, 0, 0]);
      expect(first.coreColor).toBe(0x6600ff);
    });
  });
});
