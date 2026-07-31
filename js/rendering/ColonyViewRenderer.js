/**
 * ColonyViewRenderer.js
 *
 * Planetary colony management and visualization renderer.
 * Displays building placement, resource flow, population data, and faction territories.
 *
 * Integrates:
 * - LOD system for building-level detail rendering
 * - Post-processing for atmospheric effects
 * - Ownership visuals for faction territories
 * - Particle systems for industrial activity
 *
 * Usage:
 *   const colonyRenderer = new ColonyViewRenderer(canvas, options);
 *   await colonyRenderer.initialize();
 *   colonyRenderer.loadColony(colonyData);
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class ColonyViewRenderer extends ViewRenderer {
  /**
   * @param {HTMLCanvasElement} canvas - Target canvas
   * @param {object} options - Configuration options
   */
  constructor(canvas, options = {}) {
    super(canvas, { ...options, viewType: 'colony' });
    
    // Colony-specific state
    this._colonyData = null;
    this._buildings = [];
    this._resources = [];
    this._population = [];
    this._tradePaths = [];
    
    // Visualization modes
    this._viewMode = 'overview'; // 'overview', 'building', 'resources', 'population', 'terrain'
    this._selectedBuilding = null;
    this._hoveredBuilding = null;
    
    // Rendering systems
    this._lodManager = null;
    this._selectionMarkerSystem = null;
    this._ownershipVisualsSystem = null;
    
    // Heatmap data
    this._populationHeatmap = null;
    this._productivityHeatmap = null;
    this._pollutionHeatmap = null;
    
    // Camera modes
    this._cameraMode = 'orbit'; // 'orbit', 'topdown', 'firstperson'
    this._orbitAngle = 45;
    this._orbitHeight = 2;
  }

  /**
   * Initialize colony renderer
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this._initialized) return;
    
    await super.initialize();
    
    // Create selection marker system
    this._selectionMarkerSystem = new SelectionMarkerSystem(this, {
      maxMarkers: 300,
      enablePulsing: true,
      enableGlow: true,
    });
    
    // Create ownership visuals system
    this._ownershipVisualsSystem = new OwnershipVisualsSystem(this.renderingManager);
    
    // Apply colony-specific quality preset
    this.applyQualityPreset({
      name: 'colony',
      lodDistance: 500,
      bloomStrength: 0.4,
      maxParticles: 2000,
      shadowQuality: 'high',
      postProcessing: true,
    });
    
    // Initialize heatmaps
    this._populationHeatmap = this._createHeatmap(64, 64);
    this._productivityHeatmap = this._createHeatmap(64, 64);
    this._pollutionHeatmap = this._createHeatmap(64, 64);
    
    console.log('[ColonyViewRenderer] Initialized');
    this._initialized = true;
  }

  /**
   * Load colony data
   * @param {object} colonyData - Colony information from server
   * @returns {Promise<void>}
   */
  async loadColony(colonyData) {
    if (!this._initialized) await this.initialize();
    
    this._colonyData = colonyData;
    
    // Parse colony structures
    this._buildings = colonyData.buildings || [];
    this._resources = colonyData.resources || [];
    this._population = colonyData.population || [];
    this._tradePaths = colonyData.tradePaths || [];
    
    // Update heatmaps
    this._updatePopulationHeatmap();
    this._updateProductivityHeatmap();
    
    // Apply faction colors
    if (this._ownershipVisualsSystem && colonyData.owner_faction) {
      this._ownershipVisualsSystem.applyFactionColors(colonyData, colonyData.owner_faction);
    }
    
    console.log(`[ColonyViewRenderer] Loaded colony with ${this._buildings.length} buildings`);
  }

  /**
   * Update colony state
   * @param {number} deltaTime - Time since last frame
   */
  update(deltaTime) {
    super.update(deltaTime);
    
    // Update building states
    this._buildings.forEach((building) => {
      if (building.update) {
        building.update(deltaTime);
      }
    });
    
    // Update resource flows
    this._updateResourceFlows(deltaTime);
    
    // Update camera
    this._updateCamera(deltaTime);
    
    // Update selection markers
    if (this._selectionMarkerSystem) {
      this._selectionMarkerSystem.update();
    }
    
    // Update ownership auras
    if (this._ownershipVisualsSystem) {
      this._ownershipVisualsSystem.updateAuras(deltaTime);
    }
  }

  /**
   * Render colony view
   */
  render() {
    if (!this._initialized || !this.canvas) return;
    
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = '#0a3a0a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Render based on view mode
    switch (this._viewMode) {
      case 'overview':
        this._renderOverview(ctx);
        break;
      case 'building':
        this._renderBuildingView(ctx);
        break;
      case 'resources':
        this._renderResourcesView(ctx);
        break;
      case 'population':
        this._renderPopulationView(ctx);
        break;
      case 'terrain':
        this._renderTerrainView(ctx);
        break;
    }
    
    // Render HUD
    this._renderHUD(ctx);
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    await super.cleanup();
    
    this._buildings = [];
    this._resources = [];
    this._population = [];
    this._tradePaths = [];
    this._colonyData = null;
    
    console.log('[ColonyViewRenderer] Cleaned up');
  }

  /**
   * Select a building
   * @param {object} building - Building to select
   */
  selectBuilding(building) {
    this._selectedBuilding = building;
    if (this._selectionMarkerSystem) {
      this._selectionMarkerSystem.selectObject(building, { persistent: true });
    }
  }

  /**
   * Set view mode
   * @param {string} mode - View mode name
   */
  setViewMode(mode) {
    if (['overview', 'building', 'resources', 'population', 'terrain'].includes(mode)) {
      this._viewMode = mode;
    }
  }

  /**
   * Set camera mode
   * @param {string} mode - Camera mode name
   */
  setCameraMode(mode) {
    if (['orbit', 'topdown', 'firstperson'].includes(mode)) {
      this._cameraMode = mode;
      this._updateCameraMode();
    }
  }

  /**
   * Render overview of entire colony
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderOverview(ctx) {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    
    // Draw planet circle
    ctx.fillStyle = this._colonyData?.planet_color || '#4444aa';
    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw continents/terrain
    ctx.strokeStyle = '#2a2a6a';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(i * Math.PI / 1.5) * 40,
        cy + Math.sin(i * Math.PI / 1.5) * 40,
        20,
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
    
    // Draw buildings
    this._buildings.forEach((building, idx) => {
      const angle = (idx / this._buildings.length) * Math.PI * 2;
      const dist = 70;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      
      // Color by building type
      const typeColors = {
        'factory': '#ff6600',
        'farm': '#00cc00',
        'power': '#ffff00',
        'residential': '#0099ff',
        'defense': '#ff0000',
        'research': '#9900ff',
      };
      
      ctx.fillStyle = typeColors[building.type] || '#aaaaaa';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      
      // Highlight selected
      if (building === this._selectedBuilding) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 6, y - 6, 12, 12);
      }
    });
    
    // Draw trade paths
    this._tradePaths.forEach((path) => {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(path.from[0], path.from[1]);
      ctx.lineTo(path.to[0], path.to[1]);
      ctx.stroke();
    });
  }

  /**
   * Render building detail view
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderBuildingView(ctx) {
    if (!this._selectedBuilding) return;
    
    const building = this._selectedBuilding;
    
    // Draw building in center
    ctx.fillStyle = this._getBuildingColor(building);
    ctx.fillRect(100, 100, 200, 200);
    
    // Draw building status
    ctx.fillStyle = '#ffffff';
    ctx.font = '16px Arial';
    ctx.fillText(`Building: ${building.name}`, 20, 40);
    ctx.font = '12px Arial';
    ctx.fillText(`Type: ${building.type}`, 20, 60);
    ctx.fillText(`Level: ${building.level || 1}`, 20, 80);
    ctx.fillText(`Health: ${building.health || 100}%`, 20, 100);
    ctx.fillText(`Production: ${building.production || 0}`, 20, 120);
  }

  /**
   * Render resources view with heatmap
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderResourcesView(ctx) {
    // Draw resource distribution heatmap
    this._renderHeatmap(ctx, this._productivityHeatmap, 'hot');
    
    // Draw legend
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.fillText('Productivity: Low (blue) → High (red)', 20, 30);
  }

  /**
   * Render population view with heatmap
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderPopulationView(ctx) {
    // Draw population distribution heatmap
    this._renderHeatmap(ctx, this._populationHeatmap, 'cool');
    
    // Draw statistics
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    let y = 30;
    ctx.fillText('Population: Low (red) → High (blue)', 20, y);
    y += 20;
    
    const totalPop = this._population.reduce((sum, p) => sum + p.count, 0);
    ctx.fillText(`Total Population: ${totalPop}`, 20, y);
  }

  /**
   * Render terrain view
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderTerrainView(ctx) {
    // Draw basic terrain
    ctx.fillStyle = '#443322';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw continents
    ctx.fillStyle = '#228844';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(
        100 + i * 150,
        50 + (i % 2) * 250,
        120,
        200
      );
    }
    
    // Draw water
    ctx.fillStyle = '#2266aa';
    ctx.fillRect(50, 300, this.canvas.width - 100, 100);
  }

  /**
   * Render game HUD
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  _renderHUD(ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    
    let y = 20;
    if (this._colonyData) {
      ctx.fillText(`Colony: ${this._colonyData.name}`, 20, y);
      y += 20;
      ctx.fillText(`Planet: ${this._colonyData.planet_name}`, 20, y);
      y += 20;
    }
    
    ctx.fillText(`Buildings: ${this._buildings.length}`, 20, y);
    y += 20;
    ctx.fillText(`Mode: ${this._viewMode}`, 20, y);
    y += 20;
    ctx.fillText(`Camera: ${this._cameraMode}`, 20, y);
    y += 20;
    ctx.fillText(`FPS: ${this._metrics.fps}`, 20, y);
  }

  /**
   * Create heatmap data structure
   * @private
   * @param {number} width - Heatmap width
   * @param {number} height - Heatmap height
   * @returns {Uint8Array} Heatmap data
   */
  _createHeatmap(width, height) {
    return new Uint8Array(width * height);
  }

  /**
   * Update population heatmap
   * @private
   */
  _updatePopulationHeatmap() {
    // Populate heatmap based on population distribution
    this._population.forEach((pop) => {
      if (pop.gridX !== undefined && pop.gridY !== undefined) {
        const idx = pop.gridY * 64 + pop.gridX;
        this._populationHeatmap[idx] = Math.min(255, pop.count / 10);
      }
    });
  }

  /**
   * Update productivity heatmap
   * @private
   */
  _updateProductivityHeatmap() {
    // Populate heatmap based on building productivity
    this._buildings.forEach((building) => {
      if (building.gridX !== undefined && building.gridY !== undefined) {
        const idx = building.gridY * 64 + building.gridX;
        const productivity = (building.production || 0) / 100;
        this._productivityHeatmap[idx] = Math.min(255, productivity * 255);
      }
    });
  }

  /**
   * Render heatmap to canvas
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Uint8Array} heatmap - Heatmap data
   * @param {string} colorScheme - 'hot' or 'cool'
   */
  _renderHeatmap(ctx, heatmap, colorScheme = 'hot') {
    const cellSize = 8;
    for (let i = 0; i < heatmap.length; i++) {
      const value = heatmap[i] / 255;
      const x = (i % 64) * cellSize;
      const y = Math.floor(i / 64) * cellSize;
      
      // Color based on scheme
      if (colorScheme === 'hot') {
        const r = Math.round(value * 255);
        const g = Math.round(value * 127);
        const b = 0;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      } else if (colorScheme === 'cool') {
        const r = Math.round((1 - value) * 255);
        const g = Math.round((1 - value) * 127);
        const b = Math.round(value * 255);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      }
      
      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }

  /**
   * Update resource flows
   * @private
   * @param {number} deltaTime - Delta time
   */
  _updateResourceFlows(deltaTime) {
    // Animate resource flows along trade paths
    this._tradePaths.forEach((path) => {
      path.progress = (path.progress || 0) + deltaTime * 0.5;
      if (path.progress > 1) {
        path.progress = 0;
      }
    });
  }

  /**
   * Update camera position
   * @private
   * @param {number} deltaTime - Delta time
   */
  _updateCamera(deltaTime) {
    switch (this._cameraMode) {
      case 'orbit':
        this._orbitAngle += deltaTime * 10; // Slow rotation
        break;
      case 'topdown':
        // Fixed top-down view
        break;
      case 'firstperson':
        // First-person view (stationary for now)
        break;
    }
  }

  /**
   * Update camera mode
   * @private
   */
  _updateCameraMode() {
    switch (this._cameraMode) {
      case 'orbit':
        this.setCameraState({
          position: [Math.cos(this._orbitAngle) * 150, 120, Math.sin(this._orbitAngle) * 150],
          target: [0, 0, 0],
          up: [0, 1, 0],
          fov: 60,
        });
        break;
      case 'topdown':
        this.setCameraState({
          position: [0, 200, 0],
          target: [0, 0, 0],
          up: [0, 0, -1],
          fov: 45,
        });
        break;
      case 'firstperson':
        this.setCameraState({
          position: [0, 1.7, 0],
          target: [0, 1.7, 1],
          up: [0, 1, 0],
          fov: 90,
        });
        break;
    }
  }

  /**
   * Get color for building type
   * @private
   * @param {object} building - Building object
   * @returns {string} Color string
   */
  _getBuildingColor(building) {
    const colors = {
      'factory': '#ff6600',
      'farm': '#00cc00',
      'power': '#ffff00',
      'residential': '#0099ff',
      'defense': '#ff0000',
      'research': '#9900ff',
    };
    return colors[building.type] || '#aaaaaa';
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColonyViewRenderer;
}
if (typeof window !== 'undefined') {
  window.ColonyViewRenderer = ColonyViewRenderer;
}
