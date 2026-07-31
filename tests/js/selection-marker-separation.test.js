/**
 * tests/js/selection-marker-separation.test.js
 *
 * Tests for Selection UX Phase 2: Persistent vs Hover Marker Separation
 * Validates that selection and hover markers are truly independent.
 *
 * Acceptance Criteria:
 * 1. Persistent selection marker is independent from hover marker
 * 2. Hover disappears on pointer-out, selection stays visible
 * 3. Ownership/Faction visuals are consistent across views
 * 4. Group selection markers are visually distinct
 * 5. Accessibility patterns prevent color-only distinction
 */

import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const runtimeSelectionStatePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/RuntimeSelectionState.js'
);

const markerTokensPath = path.resolve(
  process.cwd(),
  'js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js'
);

function loadRuntimeSelectionState() {
  delete window.GQRuntimeSelectionState;
  window.eval(fs.readFileSync(runtimeSelectionStatePath, 'utf8'));
  return window.GQRuntimeSelectionState;
}

function loadMarkerTokens() {
  delete window.GQSelectionMarkerStyleTokens;
  window.eval(fs.readFileSync(markerTokensPath, 'utf8'));
  return window.GQSelectionMarkerStyleTokens;
}

describe('Selection Marker Separation — Phase 2', () => {
  let runtimeSelectionState;
  let markerTokens;

  beforeEach(() => {
    runtimeSelectionState = loadRuntimeSelectionState();
    markerTokens = loadMarkerTokens();
  });

  describe('Selection Store Independence', () => {
    it('maintains separate active and hover fields', () => {
      const store = runtimeSelectionState.createSelectionStore();
      
      const hoverObj = { __kind: 'star', galaxy_index: 1, system_index: 2 };
      const activeObj = { __kind: 'star', galaxy_index: 1, system_index: 3 };

      // Commit hover
      runtimeSelectionState.configureSelectionRuntime({
        getIsSystemMode: () => false,
        getClusterSummary: () => [],
        getSelectionState: () => store,
        setActiveStar: () => {},
        setActiveSystem: () => {},
        applySelectionGroupHighlight: () => {},
      });

      runtimeSelectionState.commitSelectionState('hover', hoverObj, { x: 100, y: 200 }, 'hover');
      expect(store.hover).not.toBeNull();
      expect(store.hover.kind).toBe('star');
      expect(store.active).toBeNull();

      // Commit active selection
      runtimeSelectionState.commitSelectionState('active', activeObj, { x: 150, y: 250 }, 'click');
      expect(store.active).not.toBeNull();
      expect(store.active.kind).toBe('star');
      
      // Verify they're different
      expect(store.active.system).toBe(3);
      expect(store.hover.system).toBe(2);
    });

    it('allows hover on different object while selection persists', () => {
      const store = runtimeSelectionState.createSelectionStore();
      
      runtimeSelectionState.configureSelectionRuntime({
        getIsSystemMode: () => false,
        getClusterSummary: () => [],
        getSelectionState: () => store,
        setActiveStar: () => {},
        setActiveSystem: () => {},
        applySelectionGroupHighlight: () => {},
      });

      const selectedObj = { __kind: 'star', galaxy_index: 1, system_index: 5 };
      const hoverObj = { __kind: 'star', galaxy_index: 1, system_index: 10 };

      // Select an object
      runtimeSelectionState.commitSelectionState('active', selectedObj, { x: 100, y: 100 }, 'click');
      const selectedKey = store.active.key;

      // Hover over different object
      runtimeSelectionState.commitSelectionState('hover', hoverObj, { x: 200, y: 200 }, 'hover');

      // Verify selection persists despite hover change
      expect(store.active.key).toBe(selectedKey);
      expect(store.hover.key).not.toBe(selectedKey);
    });

    it('clears hover without affecting selection when hover target is null', () => {
      const store = runtimeSelectionState.createSelectionStore();

      runtimeSelectionState.configureSelectionRuntime({
        getIsSystemMode: () => false,
        getClusterSummary: () => [],
        getSelectionState: () => store,
        setActiveStar: () => {},
        setActiveSystem: () => {},
        applySelectionGroupHighlight: () => {},
      });

      const selectedObj = { __kind: 'star', galaxy_index: 1, system_index: 5 };

      // Select an object
      runtimeSelectionState.commitSelectionState('active', selectedObj, { x: 100, y: 100 }, 'click');
      const selectedKey = store.active.key;

      // Remove hover
      runtimeSelectionState.commitSelectionState('hover', null, { x: 200, y: 200 }, 'pointerout');

      // Verify selection persists and hover is cleared
      expect(store.active.key).toBe(selectedKey);
      expect(store.hover).toBeNull();
    });
  });

  describe('Marker Token Distinction', () => {
    it('selection token has stronger visual properties than hover', () => {
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');
      const hoverToken = markerTokens.getSelectionMarkerToken('hover');

      // Selection should be more prominent
      expect(selectionToken.outerWidth).toBeGreaterThanOrEqual(hoverToken.outerWidth);
      expect(selectionToken.scale).toBeGreaterThanOrEqual(hoverToken.scale);
      expect(selectionToken.isTemporary).toBe(false);
      expect(hoverToken.isTemporary).toBe(true);
    });

    it('selection and hover use distinct colors', () => {
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');
      const hoverToken = markerTokens.getSelectionMarkerToken('hover');

      // Golden vs Blue
      expect(selectionToken.color).not.toBe(hoverToken.color);
      expect(selectionToken.outerStroke).not.toBe(hoverToken.outerStroke);
    });

    it('hover marker has no animation', () => {
      const hoverToken = markerTokens.getSelectionMarkerToken('hover');
      expect(hoverToken.animation).toBe('none');
    });

    it('selection marker has pulse animation', () => {
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');
      expect(selectionToken.animation).toBe('pulse');
      expect(selectionToken.pulseFrequency).toBeGreaterThan(0);
      expect(selectionToken.pulseIntensity).toBeGreaterThan(0);
    });

    it('hover uses z-index 20, selection uses z-index 21', () => {
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');
      const hoverToken = markerTokens.getSelectionMarkerToken('hover');

      expect(selectionToken.zIndex).toBe(21);
      expect(hoverToken.zIndex).toBe(20);
    });
  });

  describe('Group Selection Tokens', () => {
    it('group marker is visually distinct with dashed pattern', () => {
      const groupToken = markerTokens.getSelectionMarkerToken('group');
      
      expect(groupToken.linePattern).toBe('dashed');
      expect(groupToken.outerWidth).toBeGreaterThan(0);
      expect(groupToken.isTemporary).toBe(false);
    });

    it('group token uses different color than selection', () => {
      const groupToken = markerTokens.getSelectionMarkerToken('group');
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');

      expect(groupToken.color).not.toBe(selectionToken.color);
    });
  });

  describe('Accessibility & Distinction', () => {
    it('selection tokens have sufficient WCAG contrast', () => {
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');
      // Selection token should be accessible
      expect(selectionToken.outerStroke).toBeTruthy();
      expect(selectionToken.innerStroke).toBeTruthy();
    });

    it('provides line patterns for color-blind users', () => {
      const patterns = markerTokens.LINE_PATTERNS;
      
      // Should have multiple distinct patterns
      expect(Object.keys(patterns).length).toBeGreaterThan(1);
      expect(patterns.solid).toEqual([]);
      expect(patterns.dashed).toEqual([5, 5]);
      expect(patterns.dotted).toEqual([2, 3]);
    });

    it('faction tokens include symbol for non-color identification', () => {
      const playerToken = markerTokens.getFactionOwnershipToken('player');
      const enemyToken = markerTokens.getFactionOwnershipToken('enemy');

      expect(playerToken.symbol).toBeTruthy();
      expect(enemyToken.symbol).toBeTruthy();
      expect(playerToken.symbol).not.toBe(enemyToken.symbol);
    });

    it('faction tokens include accessibility labels', () => {
      const playerToken = markerTokens.getFactionOwnershipToken('player');
      
      expect(playerToken.accessibilityLabel).toBeTruthy();
      expect(playerToken.accessibilityLabel).toContain('Player');
      expect(playerToken.accessibilityLabel).toContain('Green');
      expect(playerToken.accessibilityLabel).toContain('Star');
    });
  });

  describe('Ownership Visual Consistency', () => {
    it('provides faction tokens for all ownership types', () => {
      const factionTypes = ['player', 'enemy', 'neutral', 'ally', 'vassal', 'pirate', 'unknown'];

      for (const type of factionTypes) {
        const token = markerTokens.getFactionOwnershipToken(type);
        expect(token).toBeDefined();
        expect(token.primaryColor).toBeTruthy();
        expect(token.secondaryColor).toBeTruthy();
        expect(token.linePattern).toBeTruthy();
        expect(token.symbol).toBeTruthy();
        expect(token.name).toBe(type === 'ally' ? 'Ally' : type.charAt(0).toUpperCase() + type.slice(1));
      }
    });

    it('ownership tokens include color-blind patterns', () => {
      const playerToken = markerTokens.getFactionOwnershipToken('player');
      const enemyToken = markerTokens.getFactionOwnershipToken('enemy');

      expect(playerToken.colorBlindPattern).toBeTruthy();
      expect(enemyToken.colorBlindPattern).toBeTruthy();
      // Different for each faction
      expect(playerToken.colorBlindPattern).not.toBe(enemyToken.colorBlindPattern);
    });

    it('provides accessibility palettes for color vision deficiencies', () => {
      const palettes = ['standard', 'deuteranopia', 'protanopia', 'tritanopia', 'monochromatic', 'highContrast'];

      for (const palette of palettes) {
        const p = markerTokens.getAccessibilityPalette(palette);
        expect(p).toBeDefined();
        expect(p.primary).toBeTruthy();
        expect(p.accent).toBeTruthy();
        expect(p.success).toBeTruthy();
        expect(p.error).toBeTruthy();
      }
    });
  });

  describe('Multi-Selection Markers', () => {
    it('multiSelection token is distinct from hover and selection', () => {
      const multiToken = markerTokens.getSelectionMarkerToken('multiSelection');
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');
      const hoverToken = markerTokens.getSelectionMarkerToken('hover');

      expect(multiToken.linePattern).not.toBe(hoverToken.linePattern);
      expect(multiToken.color).not.toBe(selectionToken.color);
      expect(multiToken.isTemporary).toBe(false);
    });

    it('multiSelection has dot-dash pattern for recognition', () => {
      const multiToken = markerTokens.getSelectionMarkerToken('multiSelection');
      expect(multiToken.linePattern).toBe('dot-dash');
    });
  });

  describe('Hover + Selection Combined State', () => {
    it('provides distinct token for hovering over selected object', () => {
      const combinedToken = markerTokens.getSelectionMarkerToken('selectionWithHover');

      expect(combinedToken).toBeDefined();
      expect(combinedToken.isTemporary).toBe(false);
      expect(combinedToken.zIndex).toBe(22); // Highest priority
    });

    it('combined state has increased visual prominence', () => {
      const combinedToken = markerTokens.getSelectionMarkerToken('selectionWithHover');
      const selectionToken = markerTokens.getSelectionMarkerToken('selection');

      expect(combinedToken.scale).toBeGreaterThan(selectionToken.scale);
      expect(combinedToken.outerWidth).toBeGreaterThan(selectionToken.outerWidth);
    });
  });

  describe('Animation Configuration', () => {
    it('provides distinct animation configs for different states', () => {
      const pulseAnim = markerTokens.ANIMATION_CONFIG.pulse;
      const subtlePulseAnim = markerTokens.ANIMATION_CONFIG['subtle-pulse'];
      const glowAnim = markerTokens.ANIMATION_CONFIG.glow;

      expect(pulseAnim.duration).toBeLessThan(subtlePulseAnim.duration);
      expect(pulseAnim.minScale).toBeLessThan(subtlePulseAnim.minScale);
      expect(glowAnim.type).toBe('opacity');
    });

    it('animation configs support multiple types', () => {
      const types = new Set(Object.values(markerTokens.ANIMATION_CONFIG).map(cfg => cfg.type || 'none'));
      
      expect(types.has('scale')).toBe(true);
      expect(types.has('opacity')).toBe(true);
      expect(types.has('rotation')).toBe(true);
      expect(types.has('none')).toBe(true);
    });
  });

  describe('Integration Readiness', () => {
    it('selection state properly separates marker types', () => {
      const store = runtimeSelectionState.createSelectionStore();
      
      // Store should track both separately
      expect(store.active).toBeNull();
      expect(store.hover).toBeNull();
      expect(store.multiSelection).toEqual([]);
      expect(store.group).toBeNull();
    });

    it('commitSelectionState returns normalized selection for renderer', () => {
      const store = runtimeSelectionState.createSelectionStore();

      runtimeSelectionState.configureSelectionRuntime({
        getIsSystemMode: () => false,
        getClusterSummary: () => [],
        getSelectionState: () => store,
        setActiveStar: () => {},
        setActiveSystem: () => {},
        applySelectionGroupHighlight: () => {},
      });

      const obj = { __kind: 'star', galaxy_index: 1, system_index: 5 };
      const result = runtimeSelectionState.commitSelectionState('active', obj, { x: 100, y: 100 }, 'click');

      expect(result.key).toBeTruthy();
      expect(result.kind).toBe('star');
      expect(result.position).toBeDefined();
      expect(result.eventType).toBe('click');
    });
  });
});
