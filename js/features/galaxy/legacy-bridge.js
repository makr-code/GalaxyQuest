/**
 * GalaxyLegacyBridge – adapter to integrate new Galaxy feature with legacy game.js.
 *
 * Pattern: Strangler Fig – gradually replace old code with new.
 */
class GalaxyLegacyBridge {
    /**
     * @param {Object} config Configuration
     */
    constructor(config = {}) {
        this.apiClient = config.apiClient || new ApiClient();
        this.galaxyService = new GalaxyService(this.apiClient);
        this.galaxyController = new GalaxyController(this.galaxyService, {
            containerSelector: config.containerSelector || '#galaxy-container',
        });
        this.legacyGame = config.legacyGame || window.game;
        this.useNewImplementation = true;

        console.log('[GalaxyBridge] Initialized');
    }

    /**
     * Load and display stars in range (bridge for old galaxy.loadStars call).
     *
     * @param {Object} params
     * @returns {Promise<boolean>}
     */
    async loadStars(params) {
        if (!this.useNewImplementation) {
            return this.legacyLoadStars(params);
        }

        try {
            return await this.galaxyController.loadViewport({
                xMin: params.xMin,
                xMax: params.xMax,
                yMin: params.yMin,
                yMax: params.yMax,
            });
        } catch (error) {
            console.error('[GalaxyBridge] loadStars failed, falling back:', error);
            this.useNewImplementation = false;
            return this.legacyLoadStars(params);
        }
    }

    /**
     * Display system detail (bridge for old galaxy.showSystem call).
     *
     * @param {number} x
     * @param {number} y
     * @returns {Promise<boolean>}
     */
    async showSystem(x, y) {
        if (!this.useNewImplementation) {
            return this.legacyShowSystem(x, y);
        }

        try {
            return await this.galaxyController.displaySystemDetail(x, y);
        } catch (error) {
            console.error('[GalaxyBridge] showSystem failed, falling back:', error);
            this.useNewImplementation = false;
            return this.legacyShowSystem(x, y);
        }
    }

    /**
     * Fallback to legacy implementation.
     *
     * @private
     */
    async legacyLoadStars(params) {
        if (!this.legacyGame || !this.legacyGame.galaxy) {
            console.error('[GalaxyBridge] Legacy game not available');
            return false;
        }

        return this.legacyGame.galaxy.loadStars(params);
    }

    /**
     * Fallback to legacy implementation.
     *
     * @private
     */
    async legacyShowSystem(x, y) {
        if (!this.legacyGame || !this.legacyGame.galaxy) {
            console.error('[GalaxyBridge] Legacy game not available');
            return false;
        }

        return this.legacyGame.galaxy.showSystem(x, y);
    }

    /**
     * Force fallback to legacy implementation.
     *
     * @param {boolean} force
     */
    setUseLegacy(force) {
        this.useNewImplementation = !force;
        console.log(`[GalaxyBridge] Use legacy: ${force}`);
    }
}

if (typeof window !== 'undefined') window.GalaxyLegacyBridge = GalaxyLegacyBridge;
