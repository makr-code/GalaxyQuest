/**
 * Auth Reachability Module
 * Handles CSRF token management, API reachability checks, and network health probes.
 * Provides utilities for detecting transient network errors and ensuring auth API availability.
 */

const AuthReachability = (() => {
  let _csrfToken = null;
  let _csrfFetchInFlight = false;
  let _csrfFetchPromise = null;

  /**
   * Check if an error is a timeout error
   * @param {Error} error - Error object
   * @returns {boolean} True if error is a timeout
   */
  const isTimeoutError = (error) => {
    if (!error) return false;
    const msg = String(error?.message || '').toLowerCase();
    return msg.includes('timeout') || error?.name === 'TimeoutError';
  };

  /**
   * Check if an error is transient (retryable)
   * @param {Error} error - Error object
   * @returns {boolean} True if error is transient
   */
  const isTransientAuthFetchError = (error) => {
    if (!error) return false;

    // Timeout is transient
    if (isTimeoutError(error)) return true;

    // Network errors are transient
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connection')) {
      return true;
    }

    // Abort errors are transient (user-initiated)
    if (error?.name === 'AbortError') return true;

    return false;
  };

  /**
   * Fetch with timeout wrapper
   * @param {string} endpoint - API endpoint
   * @param {object} init - Fetch options
   * @param {object} options - Additional options (timeoutMs, tag)
   * @returns {Promise<Response>} Fetch response
   */
  const fetchWithTimeout = async (endpoint, init = {}, options = {}) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 30000;
    const tag = String(options.tag || 'auth-fetch');

    const controller = new AbortController();
    const signal = controller.signal;
    const timeoutHandle = setTimeout(() => {
      controller.abort(new Error(`${tag}: timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    try {
      const response = await fetch(endpoint, {
        ...init,
        signal,
        credentials: init.credentials || 'same-origin',
      });
      clearTimeout(timeoutHandle);
      return response;
    } catch (error) {
      clearTimeout(timeoutHandle);
      throw error;
    }
  };

  /**
   * Fetch with retry logic for transient errors
   * @param {string} endpoint - API endpoint
   * @param {object} init - Fetch options
   * @param {number} maxRetries - Max retry attempts
   * @returns {Promise<Response>} Fetch response
   */
  const fetchWithRetry = async (endpoint, init = {}, maxRetries = 3) => {
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fetchWithTimeout(endpoint, init, { timeoutMs: 30000, tag: `auth-fetch-retry-${attempt}` });
      } catch (error) {
        lastError = error;

        if (!isTransientAuthFetchError(error)) {
          throw error;
        }

        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delayMs = Math.min(1000, 100 * Math.pow(2, attempt));
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError || new Error('Fetch failed after retries');
  };

  /**
   * Get the current CSRF token
   * @returns {string|null} CSRF token or null
   */
  const getCsrfToken = () => _csrfToken;

  /**
   * Set the CSRF token
   * @param {string} token - CSRF token
   */
  const setCsrfToken = (token) => {
    if (token && typeof token === 'string') {
      _csrfToken = token;
    }
  };

  /**
   * Clear CSRF token
   */
  const clearCsrfToken = () => {
    _csrfToken = null;
  };

  /**
   * Fetch CSRF token from auth API
   * @returns {Promise<string|null>} CSRF token
   */
  const fetchCsrfToken = async () => {
    // Return existing in-flight request if available
    if (_csrfFetchInFlight && _csrfFetchPromise) {
      return _csrfFetchPromise;
    }

    _csrfFetchInFlight = true;
    _csrfFetchPromise = (async () => {
      try {
        const response = await fetchWithTimeout('api/auth.php?action=csrf', {
          method: 'GET',
          credentials: 'same-origin',
        }, { timeoutMs: 10000, tag: 'csrf-fetch' });

        if (!response.ok) {
          throw new Error(`CSRF fetch failed: ${response.status}`);
        }

        const data = await response.json();
        const token = data?.token;
        if (token && typeof token === 'string') {
          _csrfToken = token;
          return token;
        }

        throw new Error('No CSRF token in response');
      } catch (error) {
        // Log but don't propagate CSRF errors - requests can still work
        if (typeof window !== 'undefined' && window.GQLog?.warn) {
          window.GQLog.warn('[auth-reachability]', `CSRF fetch error: ${String(error?.message || error || 'unknown')}`);
        }
        return null;
      } finally {
        _csrfFetchInFlight = false;
        _csrfFetchPromise = null;
      }
    })();

    return _csrfFetchPromise;
  };

  /**
   * Parse API response JSON with error handling
   * @param {Response} response - Fetch response
   * @returns {Promise<object>} Parsed JSON or error object
   */
  const parseApiJson = async (response) => {
    try {
      const text = await response.text();
      if (!text) return { error: 'empty response' };
      return JSON.parse(text);
    } catch (error) {
      return { error: `parse error: ${String(error?.message || error || 'unknown')}` };
    }
  };

  /**
   * Check if auth API is reachable
   * @returns {Promise<object>} Reachability check result { ok, reason }
   */
  const checkAuthApiReachable = async () => {
    try {
      const response = await fetchWithTimeout('api/auth.php?action=me&quiet=1', {
        method: 'GET',
        credentials: 'same-origin',
      }, { timeoutMs: 5000, tag: 'api-reachability-check' });

      if (!response.ok) {
        const status = Number(response.status || 0);
        return {
          ok: false,
          status,
          reason: `API returned ${status}`,
        };
      }

      return {
        ok: true,
        reason: 'API is reachable',
      };
    } catch (error) {
      if (isTransientAuthFetchError(error)) {
        return {
          ok: false,
          transient: true,
          reason: `transient: ${String(error?.message || error || 'unknown')}`,
        };
      }

      return {
        ok: false,
        transient: false,
        reason: `fatal: ${String(error?.message || error || 'unknown')}`,
      };
    }
  };

  // Public exports
  return {
    isTimeoutError,
    isTransientAuthFetchError,
    fetchWithTimeout,
    fetchWithRetry,
    getCsrfToken,
    setCsrfToken,
    clearCsrfToken,
    fetchCsrfToken,
    parseApiJson,
    checkAuthApiReachable,
  };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
  window.AuthReachability = AuthReachability;
}
