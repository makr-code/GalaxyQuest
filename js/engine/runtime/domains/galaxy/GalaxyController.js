/**
 * GalaxyController - Manages 3D galaxy, star systems, selection, camera
 * Responsible for: star system data, 3D renderer coordination, selection, camera control
 * Uses: EventBus for communication, State.js for management
 */

import State from '../shared/State.js';

export class GalaxyController {
  constructor({ eventBus, repository, logger } = {}) {
    this.eventBus = eventBus;
    this.repository = repository;
    this.logger = logger;

    // State schema
    this.state = new State({
      starSystems: {}, // { starId: { id, name, x, y, z, type, tier, resources, factions, fleets } }
      sectors: {}, // { sectorId: { id, x, y, z, radius, stars: [] } }
      selectedStarId: null, // Currently selected star
      cameraPosition: { x: 0, y: 0, z: 100 }, // Camera in 3D space
      cameraTarget: { x: 0, y: 0, z: 0 }, // Look-at point
      zoom: 1.0, // Camera zoom level (0.1 to 10.0)
      viewMode: 'galaxy', // 'galaxy', 'sector', 'system'
      rendererReady: false, // Is Three.js renderer initialized?
      visibleStars: [], // Stars currently in viewport
      selectedFleets: [], // Fleets selected for movement
      routes: {}, // { routeId: { from, to, waypoints: [] } }
      isLocked: false,
      lastModified: Date.now(),
      isDirty: false,
    }, {
      zoom: { type: 'number', min: 0.1, max: 10.0 },
      viewMode: { type: 'string' },
      rendererReady: { type: 'boolean' },
    });

    this.calculations = new GalaxyCalculations();
    this._initializeStarSystems(); // Setup default stars
    this.onStateChange = null; // UI callback
    this.onError = null; // Error callback
    this.renderer = null; // Three.js renderer instance
    this.scene = null; // Three.js scene
  }

  /**
   * Initialize default star systems
   * @private
   */
  _initializeStarSystems() {
    const starSystems = {
      'sol': {
        id: 'sol',
        name: 'Sol System',
        x: 0, y: 0, z: 0,
        type: 'yellow-star',
        tier: 2, // Tier 1-5 (difficulty)
        resources: { credits: 5000, minerals: 3000, energy: 2000 },
        factions: ['player'], // Player starts here
        fleets: [],
        planets: ['earth', 'mars', 'venus'],
      },
      'alpha-centauri': {
        id: 'alpha-centauri',
        name: 'Alpha Centauri',
        x: 4.37, y: 0, z: 0,
        type: 'yellow-star',
        tier: 1,
        resources: { credits: 3000, minerals: 2000, energy: 1500 },
        factions: [],
        fleets: [],
        planets: [],
      },
      'sirius': {
        id: 'sirius',
        name: 'Sirius System',
        x: 8.6, y: 2, z: 1,
        type: 'white-star',
        tier: 3,
        resources: { credits: 8000, minerals: 5000, energy: 3000 },
        factions: ['npc_1'],
        fleets: ['npc_1_fleet_1'],
        planets: [],
      },
      'vega': {
        id: 'vega',
        name: 'Vega System',
        x: -25, y: 15, z: 10,
        type: 'blue-star',
        tier: 4,
        resources: { credits: 12000, minerals: 8000, energy: 5000 },
        factions: ['npc_2'],
        fleets: ['npc_2_fleet_1', 'npc_2_fleet_2'],
        planets: [],
      },
      'rigel': {
        id: 'rigel',
        name: 'Rigel System',
        x: 860, y: 200, z: -100,
        type: 'blue-star',
        tier: 5,
        resources: { credits: 20000, minerals: 15000, energy: 10000 },
        factions: ['npc_3'],
        fleets: [],
        planets: [],
      },
    };

    this.state.set('starSystems', starSystems);

    // Initialize sectors (spatial partitioning for performance)
    const sectors = {
      'sector_0_0_0': {
        id: 'sector_0_0_0',
        x: 0, y: 0, z: 0,
        radius: 50,
        stars: ['sol', 'alpha-centauri'],
      },
      'sector_1_0_0': {
        id: 'sector_1_0_0',
        x: 100, y: 0, z: 0,
        radius: 50,
        stars: ['sirius'],
      },
      'sector_neg1_1_0': {
        id: 'sector_neg1_1_0',
        x: -50, y: 50, z: 0,
        radius: 50,
        stars: ['vega'],
      },
      'sector_10_2_neg1': {
        id: 'sector_10_2_neg1',
        x: 1000, y: 200, z: -100,
        radius: 50,
        stars: ['rigel'],
      },
    };

    this.state.set('sectors', sectors);
    this.state.set('selectedStarId', 'sol'); // Start at Sol
  }

  /**
   * Set Three.js renderer (called by UI after setup)
   */
  setRenderer(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.state.set('rendererReady', true);

    if (this.eventBus) {
      this.eventBus.emit('galaxy:renderer-ready', {});
    }
  }

  /**
   * Select a star system
   */
  selectStar(starId) {
    if (this.state.get('isLocked')) {
      throw new Error('Galaxy system is locked');
    }

    const starSystems = this.state.get('starSystems');
    if (!starSystems[starId]) {
      throw new Error(`Star system ${starId} not found`);
    }

    this.state.set('selectedStarId', starId);
    const star = starSystems[starId];

    if (this.eventBus) {
      this.eventBus.emit('galaxy:star-selected', {
        starId,
        starName: star.name,
        x: star.x,
        y: star.y,
        z: star.z,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) {
      this.onStateChange({ type: 'star-selected', star });
    }
  }

  /**
   * Move camera to position and look at target
   */
  moveCamera(toX, toY, toZ, lookAtX = toX, lookAtY = toY, lookAtZ = toZ, duration = 1000) {
    if (this.state.get('isLocked')) {
      throw new Error('Galaxy system is locked');
    }

    const startPos = this.state.get('cameraPosition');

    // Calculate animation frames
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);

      // Interpolate camera position
      const newPos = {
        x: startPos.x + (toX - startPos.x) * progress,
        y: startPos.y + (toY - startPos.y) * progress,
        z: startPos.z + (toZ - startPos.z) * progress,
      };

      this.state.set('cameraPosition', newPos);
      this.state.set('cameraTarget', { x: lookAtX, y: lookAtY, z: lookAtZ });

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (this.eventBus) {
          this.eventBus.emit('galaxy:camera-moved', {
            x: toX, y: toY, z: toZ,
            timestamp: Date.now(),
          });
        }
      }
    };

    animate();
  }

  /**
   * Set camera zoom level
   */
  setZoom(level) {
    if (this.state.get('isLocked')) {
      throw new Error('Galaxy system is locked');
    }

    const clamped = Math.max(0.1, Math.min(10.0, level));
    this.state.set('zoom', clamped);

    if (this.eventBus) {
      this.eventBus.emit('galaxy:zoom-changed', {
        zoom: clamped,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Calculate visible stars based on viewport
   */
  updateVisibleStars(cameraPos, frustumSize) {
    const starSystems = this.state.get('starSystems');
    const visible = [];

    Object.values(starSystems).forEach(star => {
      const distance = this.calculations.calculateDistance(
        cameraPos.x, cameraPos.y, cameraPos.z,
        star.x, star.y, star.z
      );

      // Star is visible if within frustum
      if (distance < frustumSize) {
        visible.push(star.id);
      }
    });

    this.state.set('visibleStars', visible);
  }

  /**
   * Plan fleet route between stars
   */
  planRoute(fromStarId, toStarId, fleetId) {
    if (this.state.get('isLocked')) {
      throw new Error('Galaxy system is locked');
    }

    const starSystems = this.state.get('starSystems');
    const fromStar = starSystems[fromStarId];
    const toStar = starSystems[toStarId];

    if (!fromStar || !toStar) {
      throw new Error('Star system not found');
    }

    // Simple: direct route (no pathfinding)
    const routeId = `route_${fleetId}_${Date.now()}`;
    const distance = this.calculations.calculateDistance(
      fromStar.x, fromStar.y, fromStar.z,
      toStar.x, toStar.y, toStar.z
    );

    const routes = this.state.get('routes');
    routes[routeId] = {
      id: routeId,
      fleetId,
      from: fromStarId,
      to: toStarId,
      waypoints: [
        { x: fromStar.x, y: fromStar.y, z: fromStar.z },
        { x: toStar.x, y: toStar.y, z: toStar.z },
      ],
      distance,
      timeToArrival: Math.ceil(distance / 10), // 10 units per turn
    };
    this.state.set('routes', routes);

    if (this.eventBus) {
      this.eventBus.emit('galaxy:route-planned', {
        routeId,
        fleetId,
        from: fromStarId,
        to: toStarId,
        distance,
        timestamp: Date.now(),
      });
    }

    if (this.onStateChange) {
      this.onStateChange({ type: 'route-planned', routeId });
    }
  }

  /**
   * Get star system details
   */
  getStar(starId) {
    return this.state.get('starSystems')?.[starId] || null;
  }

  /**
   * Get all star systems
   */
  getAllStars() {
    return Object.values(this.state.get('starSystems') || {});
  }

  /**
   * Get sector details
   */
  getSector(sectorId) {
    return this.state.get('sectors')?.[sectorId] || null;
  }

  /**
   * Get all sectors
   */
  getAllSectors() {
    return Object.values(this.state.get('sectors') || {});
  }

  /**
   * Lock/unlock the galaxy system
   */
  lock() {
    this.state.set('isLocked', true);
    if (this.eventBus) this.eventBus.emit('galaxy:locked', {});
    if (this.onStateChange) this.onStateChange({ type: 'locked' });
  }

  unlock() {
    this.state.set('isLocked', false);
    if (this.eventBus) this.eventBus.emit('galaxy:unlocked', {});
    if (this.onStateChange) this.onStateChange({ type: 'unlocked' });
  }

  /**
   * Save galaxy state
   */
  async save() {
    if (!this.repository) return;
    try {
      await this.repository.save('galaxy-state', this.state.clone());
      this.state.set('isDirty', false);
      if (this.eventBus) this.eventBus.emit('galaxy:saved', {});
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  /**
   * Load galaxy state
   */
  async load() {
    if (!this.repository) return;
    try {
      const data = await this.repository.load('galaxy-state');
      if (data) {
        this.state = new State(data, this.state.schema);
      }
    } catch (error) {
      if (this.onError) this.onError(error);
      throw error;
    }
  }

  getState() {
    return this.state.clone();
  }
}

/**
 * GalaxyCalculations - Pure math for galaxy mechanics
 */
class GalaxyCalculations {
  /**
   * Calculate 3D distance between two points
   */
  calculateDistance(x1, y1, z1, x2, y2, z2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Calculate travel time between stars
   */
  calculateTravelTime(distance, shipSpeed = 10) {
    // Turns needed at given speed (units per turn)
    return Math.ceil(distance / shipSpeed);
  }

  /**
   * Calculate star visibility at given zoom level
   */
  calculateStarVisibility(starTier, zoomLevel) {
    // Smaller stars visible only at closer zoom
    // Tier 1 visible at zoom > 5, Tier 5 visible at zoom > 1
    const minZoom = 6 - starTier; // Tier 1 -> 5, Tier 5 -> 1
    return zoomLevel >= minZoom;
  }

  /**
   * Calculate optimal camera distance for viewing star system
   */
  calculateOptimalCameraDistance(systemRadius, fov = 75) {
    // fov in degrees
    return systemRadius / Math.tan((fov / 2) * (Math.PI / 180));
  }

  /**
   * Calculate sector containing a point
   */
  calculateSectorForPoint(x, y, z, sectorSize = 100) {
    const sx = Math.floor(x / sectorSize);
    const sy = Math.floor(y / sectorSize);
    const sz = Math.floor(z / sectorSize);
    return { sx, sy, sz, sectorId: `sector_${sx}_${sy}_${sz}` };
  }

  /**
   * Calculate angle between two 3D points (for rotation)
   */
  calculateRotationAngle(fromX, fromY, fromZ, toX, toY, toZ) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dz = toZ - fromZ;

    // Returns angle in radians
    return Math.atan2(dy, dx);
  }

  /**
   * Interpolate position along path (for smooth camera movement)
   */
  interpolatePosition(from, to, progress) {
    // progress: 0.0 to 1.0
    return {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      z: from.z + (to.z - from.z) * progress,
    };
  }
}

export { GalaxyCalculations };
