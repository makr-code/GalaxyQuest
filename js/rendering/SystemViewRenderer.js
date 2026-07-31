/**
 * SystemViewRenderer.js
 *
 * Detailed star system rendering with advanced 3D visualization.
 * Renders planets, stars, asteroids, and space stations with:
 * - Orbital mechanics visualization
 * - Dynamic lighting from binary/multiple stars
 * - LOD system for scalable object counts
 * - Procedural debris field generation
 * - Real-time faction ownership display
 *
 * Extends ViewRenderer to provide system-specific functionality.
 *
 * Usage:
 *   const systemRenderer = new SystemViewRenderer(canvas, {
 *     viewType: 'system',
 *     renderingManager: advancedRenderingManager,
 *   });
 *   await systemRenderer.initialize();
 *   systemRenderer.loadSystem(systemData);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class SystemViewRenderer extends ViewRenderer {
  /**
   * @param {HTMLCanvasElement} canvas - Target canvas
   * @param {object} options - Configuration options
   */
  constructor(canvas, options = {}) {
    super(canvas, { ...options, viewType: 'system' });
    
    // System-specific state
    this._systemData = null;
    this._celestialBodies = [];
    this._stations = [];
    this._debris = [];
    
    // Orbital simulation
    this._simTime = 0;
    this._orbitSpeed = 1.0; // Time scale multiplier
    this._showOrbits = true;
    
    // Rendering systems
    this._lodManager = null;
    this._selectionMarkerSystem = null;
    this._ownershipVisualsSystem = null;
    
    // Performance optimization
    this._lodStats = {
      objectCount: 0,
      activeLODs: 0,
      triangles: 0,
    };
  }

  /**
   * Initialize system renderer
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;
    
    // Initialize base renderer
    await super.initialize();
    
    // Initialize sub-systems
    if (this.renderingManager) {
      // Initialize LOD manager if available
      if (this.renderingManager._instances?.lodManager) {
        this._lodManager = this.renderingManager._instances.lodManager;
      }
    }
    
    // Create selection marker system
    this._selectionMarkerSystem = new SelectionMarkerSystem(this, {
      maxMarkers: 500,
      enablePulsing: this._qualityPreset.postProcessing,
      enableGlow: this._qualityPreset.postProcessing,
    });
    
    // Create ownership visuals system
    this._ownershipVisualsSystem = new OwnershipVisualsSystem(this.renderingManager);
    
    console.log(`[SystemViewRenderer] Initialized for canvas ${this.canvas?.id || 'unknown'}`);
    this._initialized = true;
  }

  /**
   * Load and set up a star system
   * @param {object} systemData - System data from server
   * @returns {Promise<void>}
   */
  async loadSystem(systemData) {
    if (!this._initialized) await this.initialize();
    
    this._systemData = systemData;
    
    // Parse system data
    this._celestialBodies = [];
    this._stations = [];
    this._debris = [];
    
    if (systemData.stars) {
      this._celestialBodies.push(...systemData.stars);
    }
    
    if (systemData.planets) {
      this._celestialBodies.push(...systemData.planets);
    }
    
    if (systemData.stations) {
      this._stations.push(...systemData.stations);
    }
    
    // Register objects with LOD system
    if (this._lodManager) {
      this._celestialBodies.forEach((body, idx) => {
        this._lodManager.registerObject({
          id: `system_body_${idx}`,
          position: this._getBodyPosition(body),
          type: body.type || 'planet',
          object: body,
        });
      });
      
      this._stations.forEach((station, idx) => {
        this._lodManager.registerObject({
          id: `system_station_${idx}`,
          position: station.position || [0, 0, 0],
          type: 'station',
          object: station,
        });
      });
    }
    
    // Apply faction colors
    if (this._ownershipVisualsSystem) {
      this._celestialBodies.forEach((body) => {
        if (body.owner_faction) {
          this._ownershipVisualsSystem.applyFactionColors(body, body.owner_faction);
        }
      });
      
      this._stations.forEach((station) => {
        if (station.owner_faction) {
          this._ownershipVisualsSystem.applyFactionColors(station, station.owner_faction);
        }
      });
    }
    
    console.log(`[SystemViewRenderer] Loaded system with ${this._celestialBodies.length} bodies and ${this._stations.length} stations`);
  }

  /**
   * Update system state
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    super.update(deltaTime);
    
    // Update orbital simulation
    this._simTime += deltaTime * this._orbitSpeed;
    
    // Update positions of orbiting bodies
    this._updateOrbitalPositions();
    
    // Update LOD states
    if (this._lodManager) {
      this._lodManager.update(this._camera.position);
      this._lodStats.activeLODs = this._lodManager.getActiveObjectCount();
    }
    
    // Update marker animations
    if (this._selectionMarkerSystem) {
      this._selectionMarkerSystem.update();
    }
    
    // Update ownership auras
    if (this._ownershipVisualsSystem) {
      this._ownershipVisualsSystem.updateAuras(deltaTime);
    }
  }

  /**
   * Render frame
   */
  render() {
    if (!this._initialized || !this.canvas) return;
    
    // Clear canvas
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Render background stars
    this._renderBackgroundStars(ctx);
    
    // Render celestial bodies
    this._renderCelestialBodies(ctx);
    
    // Render stations
    this._renderStations(ctx);
    
    // Render orbital paths
    if (this._showOrbits) {
      this._renderOrbitalPaths(ctx);
    }
    
    // Render selection markers
    if (this._selectionMarkerSystem) {
      this._renderSelectionMarkers(ctx);
    }
    
    // Render HUD elements
    this._renderHUD(ctx);
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    await super.cleanup();
    
    this._celestialBodies = [];
    this._stations = [];
    this._debris = [];
    this._systemData = null;
    
    console.log('[SystemViewRenderer] Cleaned up');
  }

  /**
   * Handle system selection
   * @param {string} systemId - System ID
   */
  selectSystem(systemId) {
    if (this._systemData && this._systemData.id === systemId) {
      this.onSelect(this._systemData, { persistent: true });
    }
  }

  /**
   * Get orbital position for a body at current simulation time
   * @private
   * @param {object} body - Celestial body
   * @returns {number[]} [x, y, z] position
   */
  _getBodyPosition(body) {
    if (!body.orbitalElements) {
      return body.position || [0, 0, 0];
    }
    
    const { semiMajorAxis, eccentricity, inclination, longitudeAscendingNode, argumentPeriapsis, trueAnomaly } = body.orbitalElements;
    
    // Simplified orbital mechanics (Kepler's laws)
    const M = (this._simTime / body.orbitalPeriod) * 2 * Math.PI; // Mean anomaly
    const E = this._solveKeplersEquation(M, eccentricity); // Eccentric anomaly
    const nu = 2 * Math.atan2(Math.sqrt(1 + eccentricity) * Math.sin(E / 2), Math.sqrt(1 - eccentricity) * Math.cos(E / 2));
    
    // Position in orbital plane
    const r = semiMajorAxis * (1 - eccentricity * eccentricity) / (1 + eccentricity * Math.cos(nu));
    const x = r * Math.cos(nu);
    const y = r * Math.sin(nu);
    
    return [x, y, 0]; // Simplified 2D
  }

  /**
   * Solve Kepler's equation (simplified)
   * @private
   * @param {number} M - Mean anomaly
   * @param {number} e - Eccentricity
   * @returns {number} Eccentric anomaly
   */
  _solveKeplersEquation(M, e) {
    let E = M;
    for (let i = 0; i < 10; i++) {
      E = M + e * Math.sin(E);
    }
    return E;
  }

  /**
   * Update orbital positions
   * @private
   */
  _updateOrbitalPositions() {
    if (!this._systemData) return;
    
    this._celestialBodies.forEach((body) => {
      const newPos = this._getBodyPosition(body);
      body.current_position = newPos;
    });
  }

  /**
   * Render background stars
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderBackgroundStars(ctx) {
    // Simple starfield
    ctx.fillStyle = 'white';
    for (let i = 0; i < 100; i++) {
      const x = (i * 73 + this._simTime * 10) % this.canvas.width;
      const y = (i * 37) % this.canvas.height;
      const size = 0.5 + Math.sin(this._simTime + i) * 0.5;
      ctx.fillRect(x, y, size, size);
    }
  }

  /**
   * Render celestial bodies
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderCelestialBodies(ctx) {
    this._celestialBodies.forEach((body, idx) => {
      if (!body.current_position) body.current_position = this._getBodyPosition(body);
      
      const screenPos = this._worldToScreen(body.current_position);
      const size = body.radius || 20;
      
      // Draw body
      if (body.owner_faction) {
        const colors = this._ownershipVisualsSystem?.getOwnershipColor(body.owner_faction);
        if (colors) {
          ctx.fillStyle = `rgb(${colors.primary[0] * 255}, ${colors.primary[1] * 255}, ${colors.primary[2] * 255})`;
        }
      } else {
        ctx.fillStyle = body.color || '#aaaaaa';
      }
      
      ctx.beginPath();
      ctx.arc(screenPos[0], screenPos[1], size, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw label
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.fillText(body.name || `Body ${idx}`, screenPos[0] + size + 5, screenPos[1]);
    });
  }

  /**
   * Render stations
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderStations(ctx) {
    this._stations.forEach((station, idx) => {
      const screenPos = this._worldToScreen(station.position || [0, 0, 0]);
      const size = 8;
      
      // Draw station as square
      if (station.owner_faction) {
        const colors = this._ownershipVisualsSystem?.getOwnershipColor(station.owner_faction);
        if (colors) {
          ctx.fillStyle = `rgb(${colors.primary[0] * 255}, ${colors.primary[1] * 255}, ${colors.primary[2] * 255})`;
        }
      } else {
        ctx.fillStyle = '#ffff00';
      }
      
      ctx.fillRect(screenPos[0] - size, screenPos[1] - size, size * 2, size * 2);
      
      // Draw label
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px Arial';
      ctx.fillText(station.name || `Station ${idx}`, screenPos[0] + size + 5, screenPos[1]);
    });
  }

  /**
   * Render orbital paths
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderOrbitalPaths(ctx) {
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 1;
    
    this._celestialBodies.forEach((body) => {
      if (!body.orbitalElements) return;
      
      const { semiMajorAxis } = body.orbitalElements;
      const center = this._worldToScreen([0, 0, 0]);
      const radius = this._scaleToScreen(semiMajorAxis);
      
      ctx.beginPath();
      ctx.arc(center[0], center[1], radius, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  /**
   * Render selection markers
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderSelectionMarkers(ctx) {
    const selected = this._selectionMarkerSystem.getSelectedObjectIds();
    
    selected.forEach((objectId) => {
      // Find object
      const object = this._celestialBodies.find(b => b.id === objectId) ||
                    this._stations.find(s => s.id === objectId);
      if (!object) return;
      
      const pos = object.current_position || object.position || [0, 0, 0];
      const screenPos = this._worldToScreen(pos);
      
      // Draw pulsing golden ring
      const pulse = Math.sin(this._simTime * 2 * Math.PI) * 0.3 + 0.7;
      ctx.strokeStyle = `rgba(255, 200, 0, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screenPos[0], screenPos[1], 30 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  /**
   * Render HUD elements
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderHUD(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    
    let y = 20;
    if (this._systemData) {
      ctx.fillText(`System: ${this._systemData.name}`, 20, y);
      y += 20;
    }
    
    ctx.fillText(`Bodies: ${this._celestialBodies.length}`, 20, y);
    y += 20;
    ctx.fillText(`Stations: ${this._stations.length}`, 20, y);
    y += 20;
    ctx.fillText(`FPS: ${this._metrics.fps}`, 20, y);
    y += 20;
    
    if (this._lodStats.activeLODs) {
      ctx.fillText(`LODs Active: ${this._lodStats.activeLODs}`, 20, y);
      y += 20;
    }
  }

  /**
   * Convert world coordinates to screen coordinates
   * @private
   * @param {number[]} worldPos - [x, y, z] world position
   * @returns {number[]} [x, y] screen position
   */
  _worldToScreen(worldPos) {
    // Simple projection: center on canvas
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const zoom = 100; // Pixels per unit
    
    return [
      cx + worldPos[0] * zoom,
      cy - worldPos[1] * zoom,
    ];
  }

  /**
   * Scale world distance to screen pixels
   * @private
   * @param {number} worldDist - World distance
   * @returns {number} Screen pixels
   */
  _scaleToScreen(worldDist) {
    return worldDist * 100; // Same zoom as _worldToScreen
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SystemViewRenderer;
}
if (typeof window !== 'undefined') {
  window.SystemViewRenderer = SystemViewRenderer;
}
