/**
 * GalaxyService – application service for galaxy API calls.
 *
 * Orchestrates API client calls with proper error mapping and result transformation.
 */
class GalaxyService {
    /**
     * @param {ApiClient} apiClient API client instance
     */
    constructor(apiClient) {
        this.apiClient = apiClient;
    }

    /**
     * Fetch systems within coordinate range.
     *
     * @param {Object} params
     * @param {number} params.xMin Minimum X coordinate
     * @param {number} params.xMax Maximum X coordinate
     * @param {number} params.yMin Minimum Y coordinate
     * @param {number} params.yMax Maximum Y coordinate
     * @returns {Promise<{error?: Object, data?: Object}>}
     */
    async getStarsRange(params) {
        try {
            const response = await this.apiClient.get('/api/galaxy/range', {
                xmin: params.xMin,
                xmax: params.xMax,
                ymin: params.yMin,
                ymax: params.yMax,
            });

            if (!response.success) {
                return {
                    error: {
                        code: response.error.code,
                        message: response.error.message,
                        details: response.error.details,
                    },
                };
            }

            return {
                data: {
                    systems: response.data.systems || [],
                    totalCount: response.data.total_count || 0,
                    rangeMin: response.data.range_min || { x: params.xMin, y: params.yMin },
                    rangeMax: response.data.range_max || { x: params.xMax, y: params.yMax },
                },
            };
        } catch (error) {
            return {
                error: {
                    code: 'INTERNAL_ERROR',
                    message: error.message || 'Unexpected error',
                },
            };
        }
    }

    /**
     * Fetch single system by coordinates.
     *
     * @param {Object} params
     * @param {number} params.x X coordinate
     * @param {number} params.y Y coordinate
     * @returns {Promise<{error?: Object, data?: Object}>}
     */
    async getSystemPayload(params) {
        try {
            const response = await this.apiClient.get('/api/galaxy/system', {
                x: params.x,
                y: params.y,
            });

            if (!response.success) {
                return {
                    error: {
                        code: response.error.code,
                        message: response.error.message,
                        details: response.error.details,
                    },
                };
            }

            return {
                data: {
                    x: response.data.x,
                    y: response.data.y,
                    system: response.data.payload.system || {},
                },
            };
        } catch (error) {
            return {
                error: {
                    code: 'INTERNAL_ERROR',
                    message: error.message || 'Unexpected error',
                },
            };
        }
    }
}

if (typeof window !== 'undefined') window.GalaxyService = GalaxyService;
