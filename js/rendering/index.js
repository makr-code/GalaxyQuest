/**
 * js/rendering/index.js
 *
 * Central export point for all rendering systems.
 * Provides convenient module loading for game initialization.
 *
 * Usage:
 *   const { ViewRenderer, SelectionMarkerSystem, SystemViewRenderer } = 
 *     require('./rendering/index.js');
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// Core base classes
const ViewRenderer = require('./ViewRenderer.js') || window.ViewRenderer;
const SelectionMarkerSystem = require('./SelectionMarkerSystem.js') || window.SelectionMarkerSystem;
const OwnershipVisualsSystem = require('./OwnershipVisualsSystem.js') || window.OwnershipVisualsSystem;

// View-specific renderers
const SystemViewRenderer = require('./SystemViewRenderer.js') || window.SystemViewRenderer;
const ApproachViewRenderer = require('./ApproachViewRenderer.js') || window.ApproachViewRenderer;
const ColonyViewRenderer = require('./ColonyViewRenderer.js') || window.ColonyViewRenderer;

// Module exports
const RenderingModules = {
  // Core systems
  ViewRenderer,
  SelectionMarkerSystem,
  OwnershipVisualsSystem,
  
  // View renderers
  SystemViewRenderer,
  ApproachViewRenderer,
  ColonyViewRenderer,
  
  // Factory methods
  createSystemViewRenderer: (canvas, options) => {
    return new SystemViewRenderer(canvas, options);
  },
  
  createApproachViewRenderer: (canvas, options) => {
    return new ApproachViewRenderer(canvas, options);
  },
  
  createColonyViewRenderer: (canvas, options) => {
    return new ColonyViewRenderer(canvas, options);
  },
  
  createSelectionMarkerSystem: (renderer, options) => {
    return new SelectionMarkerSystem(renderer, options);
  },
  
  createOwnershipVisualsSystem: (renderingManager, options) => {
    return new OwnershipVisualsSystem(renderingManager, options);
  },
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RenderingModules;
}
if (typeof window !== 'undefined') {
  window.RenderingModules = RenderingModules;
}
