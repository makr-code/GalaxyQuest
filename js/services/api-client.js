/**
 * ApiClient – unified HTTP client for all API calls.
 *
 * Responsibilities:
 * - Centralize HTTP request/response handling
 * - Parse unified ApiResponse envelope
 * - Handle network errors and retries
 * - Manage request timeouts
 * - Provide request correlation (trace_id)
 *
 * Usage:
 *   const response = await apiClient.get('/api/galaxy/range', { xmin: 0, xmax: 100 });
 *   if (response.success) { console.log(response.data); }
 *   else { console.error(response.error.code, response.error.message); }
 */
class ApiClient {
    /**
     * @param {Object} config Configuration
     * @param {number} config.timeout Request timeout in milliseconds (default: 30000)
     * @param {number} config.retries Max retry attempts on network errors (default: 3)
     */
    constructor(config = {}) {
        this.timeout = config.timeout ?? 30000;
        this.retries = config.retries ?? 3;
        this.traceId = this.generateTraceId();
    }

    /**
     * Execute GET request.
     *
     * @param {string} path API path (e.g., '/api/galaxy/range')
     * @param {Object} params Query parameters
     * @returns {Promise<ApiResponse>}
     */
    async get(path, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${path}?${queryString}` : path;
        return this.request('GET', url, null);
    }

    /**
     * Execute POST request.
     *
     * @param {string} path API path
     * @param {Object} body Request body
     * @returns {Promise<ApiResponse>}
     */
    async post(path, body = {}) {
        return this.request('POST', path, body);
    }

    /**
     * Execute HTTP request with retry logic.
     *
     * @private
     * @param {string} method HTTP method
     * @param {string} path API path
     * @param {Object|null} body Request body (null for GET)
     * @param {number} attempt Current attempt number
     * @returns {Promise<ApiResponse>}
     */
    async request(method, path, body, attempt = 1) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Trace-Id': this.traceId,
            },
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            const response = await fetch(path, {
                ...options,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Parse API response envelope
            const envelope = await response.json();

            // Validate envelope structure
            if (typeof envelope.success !== 'boolean') {
                return this.errorResponse('INVALID_RESPONSE', 'Server returned invalid response format');
            }

            return envelope;
        } catch (error) {
            // Network errors or timeout
            if (attempt < this.retries && this.isRetryableError(error)) {
                console.warn(`Request failed (attempt ${attempt}/${this.retries}), retrying...`, error.message);
                await this.delay(Math.pow(2, attempt) * 100);
                return this.request(method, path, body, attempt + 1);
            }

            return this.errorResponse('NETWORK_UNREACHABLE', error.message || 'Network error');
        }
    }

    /**
     * Check if error is retryable.
     *
     * @private
     */
    isRetryableError(error) {
        if (error.name === 'AbortError') return true;
        if (error instanceof TypeError && error.message.includes('fetch')) return true;
        return false;
    }

    /**
     * Create error response envelope.
     *
     * @private
     */
    errorResponse(code, message) {
        return {
            success: false,
            error: { code, message },
            meta: { trace_id: this.traceId, ts: Date.now() },
        };
    }

    /**
     * Generate unique trace ID.
     *
     * @private
     */
    generateTraceId() {
        return 'trace_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Delay execution.
     *
     * @private
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

if (typeof window !== 'undefined') window.ApiClient = ApiClient;
