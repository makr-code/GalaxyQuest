/**
 * GalaxyController – State management and event emitting for galaxy data.
 *
 * Responsibilities:
 * - Manage galaxy UI state
 * - Coordinate between GalaxyService and UI layers
 * - Emit change events for data updates
 * - Handle loading and error states
 * - Integrate with existing Galaxy UI components
 *
 * Usage:
 *   const controller = new GalaxyController(galaxyService);
 *   controller.on('systemsLoaded', (systems) => { updateUI(systems); });
 *   await controller.loadSystemsInRange(xmin, xmax, ymin, ymax);
 */
class GalaxyController {
    /**
     * @param {GalaxyService} galaxyService Service layer instance
     * @param {Object} options Optional configuration
     */
    constructor(galaxyService, options = {}) {
        this.service = galaxyService;
        this.listeners = new Map();  // event → [callbacks]
        
        // State
        this.currentRange = null;
        this.currentSystems = [];
        this.currentDetail = null;
        this.isLoading = false;
        this.error = null;
        this.selectedSystem = null;
    }

    /**
     * Load systems within a coordinate range.
     *
     * Emits 'loading', 'systemsLoaded', or 'error' events.
     *
     * @param {number} xmin
     * @param {number} xmax
     * @param {number} ymin
     * @param {number} ymax
     * @returns {Promise<Array>} Loaded systems
     */
    async loadSystemsInRange(xmin, xmax, ymin, ymax) {
        this.isLoading = true;
        this.error = null;
        this.emit('loading', { type: 'range' });

        try {
            const systems = await this.service.getSystemsInRange(xmin, xmax, ymin, ymax);
            
            this.currentRange = { xmin, xmax, ymin, ymax };
            this.currentSystems = systems;
            this.error = null;
            this.isLoading = false;

            this.emit('systemsLoaded', systems);
            return systems;
        } catch (err) {
            this.error = err;
            this.isLoading = false;
            this.emit('error', { type: 'range', error: err });
            throw err;
        }
    }

    /**
     * Load detailed system information.
     *
     * Emits 'loading', 'detailLoaded', or 'error' events.
     *
     * @param {number} x
     * @param {number} y
     * @returns {Promise<Object>} System detail
     */
    async loadSystemDetail(x, y) {
        this.isLoading = true;
        this.error = null;
        this.emit('loading', { type: 'detail' });

        try {
            const detail = await this.service.getSystemDetail(x, y);
            
            this.currentDetail = detail;
            this.selectedSystem = { x, y };
            this.error = null;
            this.isLoading = false;

            this.emit('detailLoaded', detail);
            return detail;
        } catch (err) {
            this.error = err;
            this.isLoading = false;
            this.emit('error', { type: 'detail', error: err });
            throw err;
        }
    }

    /**
     * Register event listener.
     *
     * @param {string} event Event name ('loading', 'systemsLoaded', 'detailLoaded', 'error')
     * @param {Function} callback Callback function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);

        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index >= 0) {
                callbacks.splice(index, 1);
            }
        };
    }

    /**
     * Register one-time event listener.
     *
     * @param {string} event Event name
     * @param {Function} callback Callback function
     * @returns {Function} Unsubscribe function
     */
    once(event, callback) {
        const unsubscribe = this.on(event, (...args) => {
            callback(...args);
            unsubscribe();
        });
        return unsubscribe;
    }

    /**
     * Get current state.
     *
     * @returns {Object} Current controller state
     */
    getState() {
        return {
            isLoading: this.isLoading,
            currentRange: this.currentRange,
            currentSystems: this.currentSystems,
            currentDetail: this.currentDetail,
            selectedSystem: this.selectedSystem,
            error: this.error,
        };
    }

    /**
     * Check if systems are currently loaded.
     *
     * @returns {boolean}
     */
    hasSystems() {
        return this.currentSystems.length > 0;
    }

    /**
     * Get count of loaded systems.
     *
     * @returns {number}
     */
    getSystemCount() {
        return this.currentSystems.length;
    }

    /**
     * Clear all state and caches.
     */
    clear() {
        this.currentRange = null;
        this.currentSystems = [];
        this.currentDetail = null;
        this.selectedSystem = null;
        this.error = null;
        this.isLoading = false;
        this.service.clearCache();
        this.emit('cleared');
    }

    /**
     * Emit event to all registered listeners.
     *
     * @private
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event) ?? [];
        for (const callback of callbacks) {
            try {
                callback(data);
            } catch (err) {
                console.error(`Error in ${event} listener:`, err);
            }
        }
    }

    /**
     * Get service instance (for advanced use).
     *
     * @returns {GalaxyService}
     */
    getService() {
        return this.service;
    }
}

if (typeof window !== 'undefined') {
    window.GalaxyController = GalaxyController;
}
