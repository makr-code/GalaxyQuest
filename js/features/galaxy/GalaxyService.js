/**
 * GalaxyService – Business logic wrapper for galaxy API calls.
 *
 * Responsibilities:
 * - Wrap api-client for galaxy-specific calls
 * - Cache query results for performance
 * - Validate input before API calls
 * - Transform API responses to domain objects
 * - Handle galaxy-specific errors
 *
 * Usage:
 *   const service = new GalaxyService(apiClient);
 *   const systems = await service.getSystemsInRange(xmin, xmax, ymin, ymax);
 *   const detail = await service.getSystemDetail(x, y);
 */
class GalaxyService {
    /**
     * @param {ApiClient} apiClient HTTP client instance
     * @param {Object} options Optional configuration
     * @param {number} options.cacheMaxAge Cache TTL in ms (default: 5 minutes)
     * @param {number} options.cacheMaxSize Max cached items (default: 100)
     */
    constructor(apiClient, options = {}) {
        this.apiClient = apiClient;
        this.cacheMaxAge = options.cacheMaxAge ?? 5 * 60 * 1000;  // 5 minutes
        this.cacheMaxSize = options.cacheMaxSize ?? 100;
        this.rangeCache = new Map();  // Key: "xmin,xmax,ymin,ymax" → {data, ts}
        this.detailCache = new Map(); // Key: "x,y" → {data, ts}
    }

    /**
     * Get systems within a coordinate range.
     *
     * Includes caching to avoid repeated queries for the same range.
     *
     * @param {number} xmin Minimum X coordinate
     * @param {number} xmax Maximum X coordinate
     * @param {number} ymin Minimum Y coordinate
     * @param {number} ymax Maximum Y coordinate
     * @returns {Promise<Array>} Array of system objects
     *
     * @throws {Error} If validation fails or API returns error
     */
    async getSystemsInRange(xmin, xmax, ymin, ymax) {
        // Validate inputs
        if (!this.isValidRange(xmin, xmax, ymin, ymax)) {
            throw new Error('Invalid range: coordinates must satisfy xmin <= xmax, ymin <= ymax');
        }

        // Check cache
        const cacheKey = `${xmin},${xmax},${ymin},${ymax}`;
        const cached = this.getCachedResult(this.rangeCache, cacheKey);
        if (cached) {
            console.debug(`[GalaxyService] Cache hit for range ${cacheKey}`);
            return cached;
        }

        // Fetch from API
        console.debug(`[GalaxyService] Fetching range ${cacheKey}`);
        const response = await this.apiClient.get('/api/galaxy.php', {
            action: 'range',
            xmin,
            xmax,
            ymin,
            ymax,
        });

        if (!response.success) {
            throw new Error(`Failed to fetch systems in range: ${response.error.code} - ${response.error.message}`);
        }

        const systems = response.data?.systems ?? [];

        // Cache result
        this.setCachedResult(this.rangeCache, cacheKey, systems);

        return systems;
    }

    /**
     * Get detailed system information at specific coordinates.
     *
     * Includes caching to avoid repeated lookups.
     *
     * @param {number} x X coordinate
     * @param {number} y Y coordinate
     * @returns {Promise<Object>} System detail object
     *
     * @throws {Error} If system not found or API error
     */
    async getSystemDetail(x, y) {
        // Validate inputs
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new Error('Coordinates must be integers');
        }

        // Check cache
        const cacheKey = `${x},${y}`;
        const cached = this.getCachedResult(this.detailCache, cacheKey);
        if (cached) {
            console.debug(`[GalaxyService] Cache hit for detail ${cacheKey}`);
            return cached;
        }

        // Fetch from API
        console.debug(`[GalaxyService] Fetching detail ${cacheKey}`);
        const response = await this.apiClient.get('/api/galaxy.php', {
            action: 'system_detail',
            x,
            y,
        });

        if (!response.success) {
            if (response.error.code === 'GALAXY_SYSTEM_NOT_FOUND') {
                throw new Error(`System not found at (${x}, ${y})`);
            }
            throw new Error(`Failed to fetch system detail: ${response.error.code}`);
        }

        const detail = response.data?.payload ?? response.data;

        // Cache result
        this.setCachedResult(this.detailCache, cacheKey, detail);

        return detail;
    }

    /**
     * Clear all caches.
     *
     * Useful for manual cache invalidation or testing.
     */
    clearCache() {
        this.rangeCache.clear();
        this.detailCache.clear();
        console.debug('[GalaxyService] Cache cleared');
    }

    /**
     * Clear specific cache entry.
     *
     * @param {number} x X coordinate
     * @param {number} y Y coordinate
     */
    clearDetailCache(x, y) {
        this.detailCache.delete(`${x},${y}`);
    }

    /**
     * Get cache statistics.
     *
     * @returns {Object} Cache stats
     */
    getCacheStats() {
        return {
            rangeSize: this.rangeCache.size,
            detailSize: this.detailCache.size,
            maxSize: this.cacheMaxSize,
        };
    }

    /**
     * Validate coordinate range.
     *
     * @private
     */
    isValidRange(xmin, xmax, ymin, ymax) {
        return typeof xmin === 'number' &&
               typeof xmax === 'number' &&
               typeof ymin === 'number' &&
               typeof ymax === 'number' &&
               xmin <= xmax &&
               ymin <= ymax;
    }

    /**
     * Get cached result if not expired.
     *
     * @private
     */
    getCachedResult(cache, key) {
        const entry = cache.get(key);
        if (!entry) return null;

        const age = Date.now() - entry.ts;
        if (age > this.cacheMaxAge) {
            cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Set cached result with automatic eviction.
     *
     * @private
     */
    setCachedResult(cache, key, data) {
        // Evict oldest entry if cache is full
        if (cache.size >= this.cacheMaxSize) {
            const oldestKey = cache.keys().next().value;
            cache.delete(oldestKey);
        }

        cache.set(key, {
            data,
            ts: Date.now(),
        });
    }
}

if (typeof window !== 'undefined') {
    window.GalaxyService = GalaxyService;
}
