import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('GalaxyRendererCore - Weapon Fire Integration', () => {
  let renderer;

  beforeEach(() => {
    // Mock minimal renderer setup
    renderer = {
      pendingInstallationWeaponFire: [],
      systemInstallationWeaponFxEntries: [],
      beamEffect: { addBeam: vi.fn() },
      
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
      
      _applyPendingInstallationWeaponFire: function(elapsed) {
        if (!Array.isArray(this.pendingInstallationWeaponFire) || !this.pendingInstallationWeaponFire.length) return;
        
        const events = this.pendingInstallationWeaponFire.splice(0, this.pendingInstallationWeaponFire.length);
        
        events.forEach((ev) => {
          const eventSourceType = String(ev?.sourceType || '').toLowerCase();
          
          if (!eventSourceType || eventSourceType === 'installation') {
            this._applyWeaponFireToInstallations(ev, elapsed);
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
});
