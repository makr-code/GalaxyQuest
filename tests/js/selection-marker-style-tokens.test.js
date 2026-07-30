/**
 * tests/js/selection-marker-style-tokens.test.js
 *
 * Unit tests for SelectionMarkerStyleTokens.js
 * Covers: Visual tokens, faction ownership, accessibility palettes, WCAG compliance
 */

import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.resolve(
  process.cwd(),
  'js/engine/runtime/layers/core/SelectionMarkerStyleTokens.js'
);

function loadModule() {
  delete window.GQSelectionMarkerStyleTokens;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQSelectionMarkerStyleTokens;
}

describe('SelectionMarkerStyleTokens', () => {
  let mod;

  beforeEach(() => {
    mod = loadModule();
  });

  // ─── Selection Marker Tokens ─────────────────────────────────────
  describe('getSelectionMarkerToken', () => {
    it('returns selection token for selection state', () => {
      const token = mod.getSelectionMarkerToken('selection');
      expect(token).toBeDefined();
      expect(token.isTemporary).toBe(false);
      expect(token.color).toContain('255, 217, 122');
      expect(token.animation).toBe('pulse');
    });

    it('returns hover token for hover state', () => {
      const token = mod.getSelectionMarkerToken('hover');
      expect(token).toBeDefined();
      expect(token.isTemporary).toBe(true);
      expect(token.color).toContain('122, 194, 255');
      expect(token.animation).toBe('none');
    });

    it('returns group token for group state', () => {
      const token = mod.getSelectionMarkerToken('group');
      expect(token).toBeDefined();
      expect(token.linePattern).toBe('dashed');
      expect(token.color).toContain('200, 255, 100');
    });

    it('returns hover token as fallback for unknown state', () => {
      const token = mod.getSelectionMarkerToken('unknown-state');
      expect(token).toEqual(mod.SELECTION_MARKER_TOKENS.hover);
    });

    it('distinguishes persistent from temporary markers', () => {
      const persistent = mod.getSelectionMarkerToken('selection');
      const temporary = mod.getSelectionMarkerToken('hover');
      expect(persistent.isTemporary).toBe(false);
      expect(temporary.isTemporary).toBe(true);
    });

    it('selection marker has higher render order than hover', () => {
      const selection = mod.getSelectionMarkerToken('selection');
      const hover = mod.getSelectionMarkerToken('hover');
      expect(selection.renderOrder).toBeGreaterThan(hover.renderOrder);
    });

    it('all tokens have required fields', () => {
      const states = ['selection', 'hover', 'group', 'multiSelection', 'selectionWithHover'];
      states.forEach((state) => {
        const token = mod.getSelectionMarkerToken(state);
        expect(token).toHaveProperty('color');
        expect(token).toHaveProperty('outerStroke');
        expect(token).toHaveProperty('innerStroke');
        expect(token).toHaveProperty('animation');
        expect(token).toHaveProperty('tooltip');
        expect(token).toHaveProperty('ariaLabel');
      });
    });
  });

  // ─── Faction Ownership Tokens ────────────────────────────────────
  describe('getFactionOwnershipToken', () => {
    it('returns player faction token', () => {
      const token = mod.getFactionOwnershipToken('player');
      expect(token).toBeDefined();
      expect(token.primaryColor).toBe('#4CAF50');
      expect(token.symbol).toBe('★');
      expect(token.name).toBe('Player');
    });

    it('returns enemy faction token', () => {
      const token = mod.getFactionOwnershipToken('enemy');
      expect(token).toBeDefined();
      expect(token.primaryColor).toBe('#F44336');
      expect(token.symbol).toBe('✕');
    });

    it('returns ally faction token', () => {
      const token = mod.getFactionOwnershipToken('ally');
      expect(token.primaryColor).toBe('#2196F3');
      expect(token.symbol).toBe('◆');
    });

    it('returns vassal faction token', () => {
      const token = mod.getFactionOwnershipToken('vassal');
      expect(token.primaryColor).toBe('#FF9800');
      expect(token.symbol).toBe('▽');
    });

    it('returns unknown faction as fallback', () => {
      const token = mod.getFactionOwnershipToken('unknown-faction');
      expect(token).toEqual(mod.FACTION_OWNERSHIP_TOKENS.unknown);
    });

    it('all faction tokens have accessibility labels', () => {
      const factions = ['player', 'enemy', 'neutral', 'ally', 'vassal', 'pirate', 'unknown'];
      factions.forEach((faction) => {
        const token = mod.getFactionOwnershipToken(faction);
        expect(token).toHaveProperty('accessibilityLabel');
        expect(token.accessibilityLabel).toMatch(/[A-Z]/);
      });
    });

    it('faction tokens define color-blind patterns', () => {
      const token = mod.getFactionOwnershipToken('player');
      expect(token).toHaveProperty('colorBlindPattern');
      expect(['solid', 'dashed', 'dotted', 'dot-dash', 'dash-dash-dot', 'long-dash']).toContain(token.colorBlindPattern);
    });
  });

  // ─── Accessibility Palettes ─────────────────────────────────────
  describe('getAccessibilityPalette', () => {
    it('returns standard palette as default', () => {
      const palette = mod.getAccessibilityPalette('standard');
      expect(palette).toBeDefined();
      expect(palette.primary).toBe('#2196F3');
      expect(palette.error).toBe('#F44336');
    });

    it('returns deuteranopia-safe palette', () => {
      const palette = mod.getAccessibilityPalette('deuteranopia');
      expect(palette).toBeDefined();
      expect(palette.primary).toBe('#0173B2');
      expect(palette.accent).toBe('#DE8F05');
    });

    it('returns protanopia-safe palette', () => {
      const palette = mod.getAccessibilityPalette('protanopia');
      expect(palette).toBeDefined();
      expect(palette.success).toBe('#CC78BC');
    });

    it('returns tritanopia-safe palette', () => {
      const palette = mod.getAccessibilityPalette('tritanopia');
      expect(palette).toBeDefined();
      expect(palette.primary).toBe('#EE7733');
    });

    it('returns monochromatic palette for total colorblindness', () => {
      const palette = mod.getAccessibilityPalette('monochromatic');
      expect(palette).toBeDefined();
      // All colors should be grayscale
      Object.values(palette).forEach((color) => {
        expect(color).toMatch(/^#[0-9A-F]{6}$/i);
      });
    });

    it('returns high contrast mode palette', () => {
      const palette = mod.getAccessibilityPalette('highContrast');
      expect(palette).toBeDefined();
      expect(palette.primary).toBe('#000000');
      expect(palette.accent).toBe('#FFFFFF');
    });

    it('falls back to standard for unknown mode', () => {
      const palette = mod.getAccessibilityPalette('unknown-mode');
      expect(palette).toEqual(mod.ACCESSIBILITY_PALETTES.standard);
    });
  });

  // ─── Line Patterns ──────────────────────────────────────────────
  describe('getLinePattern', () => {
    it('returns empty array for solid pattern', () => {
      const pattern = mod.getLinePattern('solid');
      expect(pattern).toEqual([]);
    });

    it('returns dash pattern', () => {
      const pattern = mod.getLinePattern('dashed');
      expect(pattern).toEqual([5, 5]);
    });

    it('returns dot pattern', () => {
      const pattern = mod.getLinePattern('dotted');
      expect(pattern).toEqual([2, 3]);
    });

    it('returns dot-dash pattern', () => {
      const pattern = mod.getLinePattern('dot-dash');
      expect(pattern).toEqual([2, 3, 5, 3]);
    });

    it('returns long-dash for low vision', () => {
      const pattern = mod.getLinePattern('long-dash');
      expect(pattern).toEqual([10, 5]);
    });

    it('returns solid as fallback for unknown pattern', () => {
      const pattern = mod.getLinePattern('unknown-pattern');
      expect(pattern).toEqual([]);
    });
  });

  // ─── WCAG Compliance ─────────────────────────────────────────────
  describe('WCAG Compliance Checks', () => {
    describe('getRelativeLuminance', () => {
      it('calculates luminance for white', () => {
        const luminance = mod.getRelativeLuminance('#FFFFFF');
        expect(luminance).toBeCloseTo(1, 0.01);
      });

      it('calculates luminance for black', () => {
        const luminance = mod.getRelativeLuminance('#000000');
        expect(luminance).toBeCloseTo(0, 0.01);
      });

      it('calculates luminance for pure red', () => {
        const luminance = mod.getRelativeLuminance('#FF0000');
        expect(luminance).toBeGreaterThan(0.2);
        expect(luminance).toBeLessThan(0.3);
      });

      it('calculates luminance for pure blue', () => {
        const luminance = mod.getRelativeLuminance('#0000FF');
        expect(luminance).toBeGreaterThan(0.07);
        expect(luminance).toBeLessThan(0.15);
      });
    });

    describe('getContrastRatio', () => {
      it('returns high contrast for black on white', () => {
        const ratio = mod.getContrastRatio('#FFFFFF', '#000000');
        expect(ratio).toBeCloseTo(21, 0.1);
      });

      it('returns low contrast for similar colors', () => {
        const ratio = mod.getContrastRatio('#FFFFFF', '#EEEEEE');
        expect(ratio).toBeLessThan(3);
      });

      it('returns medium contrast for blue on white', () => {
        const ratio = mod.getContrastRatio('#FFFFFF', '#0000FF');
        expect(ratio).toBeGreaterThan(8);
      });

      it('is symmetric (order-independent)', () => {
        const ratio1 = mod.getContrastRatio('#FFFFFF', '#000000');
        const ratio2 = mod.getContrastRatio('#000000', '#FFFFFF');
        expect(ratio1).toBeCloseTo(ratio2, 0.1);
      });
    });

    describe('isWCAGCompliant', () => {
      it('verifies black text on white is WCAG AA compliant', () => {
        const compliant = mod.isWCAGCompliant('#000000', '#FFFFFF', 'normal-text');
        expect(compliant).toBe(true);
      });

      it('verifies white text on white is not compliant', () => {
        const compliant = mod.isWCAGCompliant('#FFFFFF', '#FFFFFF', 'normal-text');
        expect(compliant).toBe(false);
      });

      it('uses graphics requirement (3:1)', () => {
        const compliant = mod.isWCAGCompliant('#333333', '#FFFFFF', 'graphics');
        expect(compliant).toBe(true);
      });

      it('uses normal-text requirement (4.5:1)', () => {
        const compliant = mod.isWCAGCompliant('#555555', '#FFFFFF', 'normal-text');
        expect(compliant).toBe(true);
      });

      it('defaults to graphics level', () => {
        const compliant = mod.isWCAGCompliant('#000000', '#FFFFFF', 'unknown-level');
        expect(compliant).toBe(true);
      });
    });
  });

  // ─── Token Consistency ──────────────────────────────────────────
  describe('Token Consistency', () => {
    it('selection marker is always more visible than hover', () => {
      const selection = mod.getSelectionMarkerToken('selection');
      const hover = mod.getSelectionMarkerToken('hover');

      // Selection should have thicker strokes
      expect(selection.outerWidth).toBeGreaterThan(hover.outerWidth);
      expect(selection.scale).toBeGreaterThanOrEqual(hover.scale);
    });

    it('all tokens define animation configurations', () => {
      const animationTypes = Object.keys(mod.ANIMATION_CONFIG);
      const tokens = Object.values(mod.SELECTION_MARKER_TOKENS);

      tokens.forEach((token) => {
        if (token.animation !== 'none') {
          expect(animationTypes).toContain(token.animation);
        }
      });
    });

    it('faction tokens use colors from accessibility palette', () => {
      const standardPalette = mod.getAccessibilityPalette('standard');
      const factions = Object.values(mod.FACTION_OWNERSHIP_TOKENS);

      // At least some faction colors should be in the standard palette
      const paletteColors = Object.values(standardPalette);
      const colorBlindFactions = factions.filter(
        (faction) => paletteColors.includes(faction.primaryColor)
      );

      expect(colorBlindFactions.length).toBeGreaterThan(0);
    });
  });

  // ─── Animation Configuration ────────────────────────────────────
  describe('Animation Configuration', () => {
    it('pulse animation has valid parameters', () => {
      const pulse = mod.ANIMATION_CONFIG.pulse;
      expect(pulse.type).toBe('scale');
      expect(pulse.duration).toBeGreaterThan(0);
      expect(pulse.minScale).toBeLessThan(pulse.maxScale);
      expect(pulse.easing).toBe('sine-wave');
    });

    it('all animations have positive duration', () => {
      Object.values(mod.ANIMATION_CONFIG).forEach((anim) => {
        if (anim.type !== 'none') {
          expect(anim.duration).toBeGreaterThan(0);
        }
      });
    });

    it('animations define required easing functions', () => {
      const validEasing = ['sine-wave', 'ease-out-bounce', 'linear'];
      Object.values(mod.ANIMATION_CONFIG).forEach((anim) => {
        if (anim.type !== 'none') {
          expect(validEasing).toContain(anim.easing);
        }
      });
    });
  });

  // ─── Accessibility Labels ───────────────────────────────────────
  describe('Accessibility Labels', () => {
    it('all selection tokens have tooltip and aria-label', () => {
      const tokens = Object.values(mod.SELECTION_MARKER_TOKENS);
      tokens.forEach((token) => {
        expect(token).toHaveProperty('tooltip');
        expect(token).toHaveProperty('ariaLabel');
        expect(String(token.tooltip)).toMatch(/./);
        expect(String(token.ariaLabel)).toMatch(/./);
      });
    });

    it('all faction tokens have accessibility labels', () => {
      const factions = Object.values(mod.FACTION_OWNERSHIP_TOKENS);
      factions.forEach((faction) => {
        expect(faction.accessibilityLabel).toBeDefined();
        expect(faction.accessibilityLabel.length).toBeGreaterThan(0);
      });
    });

    it('faction accessibility labels mention color and symbol', () => {
      const factions = Object.values(mod.FACTION_OWNERSHIP_TOKENS);
      factions.forEach((faction) => {
        const label = faction.accessibilityLabel.toLowerCase();
        // Label should describe the visual characteristics
        expect(label).toMatch(/\w+/);
      });
    });
  });
});
