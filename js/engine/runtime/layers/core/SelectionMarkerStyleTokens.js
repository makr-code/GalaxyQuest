/**
 * SelectionMarkerStyleTokens.js
 *
 * Unified visual token system for selection markers across all views.
 * Provides:
 * - Selection state visual tokens (persistent vs hover)
 * - Faction/ownership coloring system
 * - Accessibility patterns (color-blind safe, high contrast)
 * - Animation configurations
 *
 * License: MIT - makr-code/GalaxyQuest
 */

'use strict';

(function () {
  /**
   * Selection marker visual tokens
   * Defines appearance of selection (persistent), hover (temporary), and group states
   */
  const SELECTION_MARKER_TOKENS = {
    // Persistent selection state (always visible, golden)
    selection: {
      isTemporary: false,
      color: 'rgba(255, 217, 122, 0.88)',
      outerStroke: 'rgba(255, 217, 122, 0.88)',
      innerStroke: 'rgba(255, 246, 214, 0.76)',
      outerWidth: 4,
      innerWidth: 2,
      outerRadius: 0.33,        // As fraction of marker size
      innerRadius: 0.11,
      linePattern: 'solid',
      animation: 'pulse',
      pulseFrequency: 0.5,       // Hz (0.5 = 2-second cycle)
      pulseIntensity: 0.15,      // 15% scale variation
      renderOrder: 21,
      scale: 1.0,
      zIndex: 21,
      tooltip: 'Selected',
      ariaLabel: 'Persistent selection marker',
    },

    // Temporary hover state (ephemeral, blue)
    hover: {
      isTemporary: true,
      color: 'rgba(122, 194, 255, 0.72)',
      outerStroke: 'rgba(122, 194, 255, 0.72)',
      innerStroke: 'rgba(214, 238, 255, 0.52)',
      outerWidth: 3,
      innerWidth: 1.5,
      outerRadius: 0.29,
      innerRadius: 0.14,
      linePattern: 'solid',
      animation: 'none',
      renderOrder: 20,
      scale: 0.85,
      zIndex: 20,
      tooltip: 'Hover',
      ariaLabel: 'Hover marker',
    },

    // Group/cluster selection (green with dashes)
    group: {
      isTemporary: false,
      color: 'rgba(200, 255, 100, 0.65)',
      outerStroke: 'rgba(200, 255, 100, 0.65)',
      innerStroke: 'rgba(220, 255, 150, 0.50)',
      outerWidth: 3.5,
      innerWidth: 2,
      outerRadius: 0.35,
      innerRadius: 0.15,
      linePattern: 'dashed',
      animation: 'subtle-pulse',
      pulseFrequency: 0.3,       // Slower pulse for groups
      pulseIntensity: 0.08,
      renderOrder: 19,
      scale: 1.2,
      zIndex: 19,
      tooltip: 'Group Selected',
      ariaLabel: 'Group selection marker',
    },

    // Multi-selection (multiple objects selected)
    multiSelection: {
      isTemporary: false,
      color: 'rgba(150, 200, 255, 0.75)',
      outerStroke: 'rgba(150, 200, 255, 0.75)',
      innerStroke: 'rgba(200, 230, 255, 0.60)',
      outerWidth: 3,
      innerWidth: 1.5,
      outerRadius: 0.31,
      innerRadius: 0.12,
      linePattern: 'dot-dash',
      animation: 'pulse',
      pulseFrequency: 0.6,
      pulseIntensity: 0.12,
      renderOrder: 20,
      scale: 1.05,
      zIndex: 20,
      tooltip: 'Multi-Selected',
      ariaLabel: 'Multi-selection marker',
    },

    // Hover on selected object (both states)
    selectionWithHover: {
      isTemporary: false,
      color: 'rgba(255, 200, 100, 0.90)',
      outerStroke: 'rgba(255, 200, 100, 0.90)',
      innerStroke: 'rgba(255, 230, 180, 0.80)',
      outerWidth: 5,
      innerWidth: 2.5,
      outerRadius: 0.35,
      innerRadius: 0.12,
      linePattern: 'solid',
      animation: 'pulse',
      pulseFrequency: 0.7,
      pulseIntensity: 0.20,
      renderOrder: 22,
      scale: 1.1,
      zIndex: 22,
      tooltip: 'Selected & Hovered',
      ariaLabel: 'Selection with hover marker',
    },
  };

  /**
   * Line pattern definitions for accessibility
   * Each object specifies the dash pattern for ctx.setLineDash()
   */
  const LINE_PATTERNS = {
    solid: [],                    // No dashes
    dashed: [5, 5],              // 5px dash, 5px gap
    dotted: [2, 3],              // 2px dot, 3px gap
    'dot-dash': [2, 3, 5, 3],    // 2px dot, 3px gap, 5px dash, 3px gap
    'dash-dash-dot': [5, 3, 5, 3, 2, 3], // Complex pattern
    'long-dash': [10, 5],        // Long dashes for low vision
  };

  /**
   * Faction/Ownership visual tokens
   * Provides consistent coloring and patterns for ownership across all views
   */
  const FACTION_OWNERSHIP_TOKENS = {
    // Player empire
    player: {
      primaryColor: '#4CAF50',           // Green
      secondaryColor: '#66BB6A',         // Light green
      linePattern: 'solid',
      colorBlindPattern: 'dotted',
      symbol: '★',                      // Star (distinctive shape)
      name: 'Player',
      accessibilityLabel: 'Player-owned (Green, Star)',
    },

    // Enemy/hostile faction
    enemy: {
      primaryColor: '#F44336',           // Red
      secondaryColor: '#EF5350',         // Light red
      linePattern: 'dashed',
      colorBlindPattern: 'dash-dash-dot',
      symbol: '✕',                      // X mark
      name: 'Enemy',
      accessibilityLabel: 'Enemy-owned (Red, X)',
    },

    // Neutral (unclaimed or independent)
    neutral: {
      primaryColor: '#9E9E9E',           // Grey
      secondaryColor: '#BDBDBD',         // Light grey
      linePattern: 'solid',
      colorBlindPattern: 'dotted',
      symbol: '○',                      // Circle
      name: 'Neutral',
      accessibilityLabel: 'Neutral (Grey, Circle)',
    },

    // Allied faction
    ally: {
      primaryColor: '#2196F3',           // Blue
      secondaryColor: '#64B5F6',         // Light blue
      linePattern: 'solid',
      colorBlindPattern: 'dotted',
      symbol: '◆',                      // Diamond
      name: 'Ally',
      accessibilityLabel: 'Allied (Blue, Diamond)',
    },

    // Vassal/subjugated faction
    vassal: {
      primaryColor: '#FF9800',           // Orange
      secondaryColor: '#FFB74D',         // Light orange
      linePattern: 'dashed',
      colorBlindPattern: 'dot-dash',
      symbol: '▽',                      // Triangle
      name: 'Vassal',
      accessibilityLabel: 'Vassal (Orange, Triangle)',
    },

    // Pirate faction
    pirate: {
      primaryColor: '#9C27B0',           // Purple
      secondaryColor: '#BA68C8',         // Light purple
      linePattern: 'dash-dash-dot',
      colorBlindPattern: 'long-dash',
      symbol: '☠',                      // Skull
      name: 'Pirate',
      accessibilityLabel: 'Pirate (Purple, Skull)',
    },

    // Unknown/fog of war
    unknown: {
      primaryColor: '#607D8B',           // Blue-grey
      secondaryColor: '#78909C',         // Light blue-grey
      linePattern: 'dotted',
      colorBlindPattern: 'dotted',
      symbol: '?',                      // Question mark
      name: 'Unknown',
      accessibilityLabel: 'Unknown faction (Grey-Blue, Question)',
    },
  };

  /**
   * Accessibility color palettes
   * Ensures visibility and distinction for users with color vision deficiency
   */
  const ACCESSIBILITY_PALETTES = {
    // Standard (no color vision deficiency)
    standard: {
      primary: '#2196F3',        // Blue
      accent: '#FF9800',         // Orange
      success: '#4CAF50',        // Green
      warning: '#FFEB3B',        // Yellow
      error: '#F44336',          // Red
      neutral: '#9E9E9E',        // Grey
    },

    // Deuteranopia (red-green colorblind, ~1% of males)
    deuteranopia: {
      primary: '#0173B2',        // Blue (very visible)
      accent: '#DE8F05',         // Orange (visible)
      success: '#56B4E9',        // Light blue
      warning: '#F8766D',        // Red-ish (still somewhat visible)
      error: '#E76BF3',          // Purple
      neutral: '#A6A6A6',        // Grey
    },

    // Protanopia (red-green colorblind, ~1% of males)
    protanopia: {
      primary: '#0173B2',        // Blue
      accent: '#DE8F05',         // Orange
      success: '#CC78BC',        // Purple
      warning: '#FB8500',        // Orange-brown
      error: '#D62828',          // Dark red
      neutral: '#606060',        // Dark grey
    },

    // Tritanopia (blue-yellow colorblind, very rare)
    tritanopia: {
      primary: '#EE7733',        // Orange
      accent: '#0077BB',         // Blue
      success: '#33BBEE',        // Cyan
      warning: '#CC3311',        // Red
      error: '#BB3311',          // Dark red
      neutral: '#777777',        // Medium grey
    },

    // Monochromatic (total colorblindness)
    monochromatic: {
      primary: '#333333',        // Dark grey
      accent: '#666666',         // Medium grey
      success: '#222222',        // Very dark
      warning: '#AAAAAA',        // Light grey
      error: '#000000',          // Black
      neutral: '#CCCCCC',        // Very light grey
    },

    // High contrast mode (for low vision users)
    highContrast: {
      primary: '#000000',        // Black
      accent: '#FFFFFF',         // White
      success: '#008000',        // Dark green
      warning: '#FF0000',        // Bright red
      error: '#FF0000',          // Bright red
      neutral: '#FFFFFF',        // White
    },
  };

  /**
   * Animation configurations
   * Defines animation parameters for marker states
   */
  const ANIMATION_CONFIG = {
    pulse: {
      type: 'scale',
      duration: 2.0,             // seconds
      minScale: 0.95,
      maxScale: 1.15,
      easing: 'sine-wave',
    },

    'subtle-pulse': {
      type: 'scale',
      duration: 3.0,
      minScale: 0.98,
      maxScale: 1.08,
      easing: 'sine-wave',
    },

    'glow': {
      type: 'opacity',
      duration: 1.5,
      minOpacity: 0.6,
      maxOpacity: 1.0,
      easing: 'sine-wave',
    },

    'bounce': {
      type: 'position-y-offset',
      duration: 0.5,
      amplitude: 2,              // pixels
      easing: 'ease-out-bounce',
    },

    'rotate': {
      type: 'rotation',
      duration: 4.0,
      minRotation: 0,
      maxRotation: Math.PI * 2,
      easing: 'linear',
    },

    'none': {
      type: 'none',
    },
  };

  /**
   * Contrast ratios (WCAG 2.1 compliance)
   * Ensures marker colors have sufficient contrast
   */
  const CONTRAST_REQUIREMENTS = {
    'normal-text': 4.5,         // 4.5:1 for text
    'large-text': 3.0,          // 3:1 for large text
    'graphics': 3.0,            // 3:1 for UI components and graphics
    'focus-indicator': 3.0,     // 3:1 for focus indicators
  };

  /**
   * Retrieves a selection marker token by state
   * @param {string} state - 'selection', 'hover', 'group', 'multiSelection', 'selectionWithHover'
   * @returns {object} Token object with visual properties
   */
  function getSelectionMarkerToken(state) {
    return SELECTION_MARKER_TOKENS[state] || SELECTION_MARKER_TOKENS.hover;
  }

  /**
   * Retrieves faction ownership token
   * @param {string|number} factionId - Faction identifier
   * @returns {object} Ownership token with colors and patterns
   */
  function getFactionOwnershipToken(factionId) {
    const factionType = String(factionId || 'unknown').toLowerCase();
    return FACTION_OWNERSHIP_TOKENS[factionType] || FACTION_OWNERSHIP_TOKENS.unknown;
  }

  /**
   * Retrieves accessibility palette for current user preference
   * @param {string} mode - 'standard', 'deuteranopia', 'protanopia', 'tritanopia', 'monochromatic', 'highContrast'
   * @returns {object} Color palette
   */
  function getAccessibilityPalette(mode) {
    return ACCESSIBILITY_PALETTES[mode] || ACCESSIBILITY_PALETTES.standard;
  }

  /**
   * Gets line pattern array for ctx.setLineDash()
   * @param {string} pattern - Pattern name
   * @returns {number[]} Line dash pattern array
   */
  function getLinePattern(pattern) {
    return LINE_PATTERNS[pattern] || LINE_PATTERNS.solid;
  }

  /**
   * Calculates relative luminance for contrast ratio
   * @param {string} hex - Hex color code
   * @returns {number} Luminance value (0-1)
   */
  function getRelativeLuminance(hex) {
    const rgb = parseInt(hex.slice(1), 16);
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;

    const [rs, gs, bs] = [r, g, b].map((val) => {
      const v = val / 255;
      return v <= 0.03928
        ? v / 12.92
        : Math.pow((v + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }

  /**
   * Calculates contrast ratio between two colors
   * @param {string} color1 - Hex color code
   * @param {string} color2 - Hex color code
   * @returns {number} Contrast ratio (1-21)
   */
  function getContrastRatio(color1, color2) {
    const lum1 = getRelativeLuminance(color1);
    const lum2 = getRelativeLuminance(color2);
    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);

    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Verifies WCAG 2.1 contrast compliance
   * @param {string} foregroundColor - Hex color
   * @param {string} backgroundColor - Hex color
   * @param {string} level - 'normal-text', 'large-text', 'graphics'
   * @returns {boolean} True if compliant
   */
  function isWCAGCompliant(foregroundColor, backgroundColor, level) {
    const requiredRatio = CONTRAST_REQUIREMENTS[level] || 3.0;
    const actualRatio = getContrastRatio(foregroundColor, backgroundColor);
    return actualRatio >= requiredRatio;
  }

  // Export for CommonJS environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SELECTION_MARKER_TOKENS,
      LINE_PATTERNS,
      FACTION_OWNERSHIP_TOKENS,
      ACCESSIBILITY_PALETTES,
      ANIMATION_CONFIG,
      CONTRAST_REQUIREMENTS,
      getSelectionMarkerToken,
      getFactionOwnershipToken,
      getAccessibilityPalette,
      getLinePattern,
      getRelativeLuminance,
      getContrastRatio,
      isWCAGCompliant,
    };
  } else {
    // Export for browser
    window.GQSelectionMarkerStyleTokens = {
      SELECTION_MARKER_TOKENS,
      LINE_PATTERNS,
      FACTION_OWNERSHIP_TOKENS,
      ACCESSIBILITY_PALETTES,
      ANIMATION_CONFIG,
      CONTRAST_REQUIREMENTS,
      getSelectionMarkerToken,
      getFactionOwnershipToken,
      getAccessibilityPalette,
      getLinePattern,
      getRelativeLuminance,
      getContrastRatio,
      isWCAGCompliant,
    };
  }
})();
