/**
 * API Transport Layer
 * Handles low-level fetch, retries, timeouts, and error management.
 */
const APITransport = (() => {
  const API_VERSION = 'v1';

  function _log(level, message, data = null) {
    const lvl = String(level || 'info').toLowerCase();
    const sink = window.GQLog && typeof window.GQLog[lvl] === 'function'
      ? window.GQLog[lvl].bind(window.GQLog)
      : null;
    if (sink) {
      if (data == null) sink('[api-transport]', message);
      else sink('[api-transport]', message, data);
      return;
    }
    const consoleMethod = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) console[consoleMethod]('[GQ][API][transport]', message);
    else console[consoleMethod]('[GQ][API][transport]', message, data);
  }

  function _isAbortError(err) {
    if (!err) return false;
    if (typeof err === 'string') {
      return /abort|cancel|navigation/i.test(err);
    }
    const name = String(err.name || '');
    const message = String(err.message || '');
    const reason = String(err.reason || err.cause?.message || err.cause || '');
    return name === 'AbortError' || /abort|cancel|navigation/i.test(message) || /abort|cancel|navigation/i.test(reason);
  }

  function _createAbortError(message = 'Request cancelled') {
    try {
      return new DOMException(message, 'AbortError');
    } catch (_) {
      const e = new Error(message);
      e.name = 'AbortError';
      return e;
    }
  }

  function _sanitizeSnippet(text, maxLen = 300) {
    const clean = String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim();
    if (!clean) return '';
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen)}...`;
  }

  function _contentTypeOf(response) {
    try {
      return String(response?.headers?.get('content-type') || '').toLowerCase();
    } catch (err) {
      _log('info', 'Content-Type konnte nicht gelesen werden', err);
      return '';
    }
  }

  async function _throwHttpError(endpoint, response, context = '') {
    const status = Number(response?.status || 0);
    const statusText = String(response?.statusText || '').trim();
    const contentType = _contentTypeOf(response);
    const err = new Error(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    err.status = status;
    err.statusText = statusText;
    err.endpoint = endpoint;
    err.context = context;
    err.contentType = contentType || 'unknown';

    try {
      const clone = response.clone();
      const raw = await clone.text();
      const snippet = _sanitizeSnippet(raw, 300);
      if (snippet) err.responseSnippet = snippet;
    } catch (err) {
      _log('info', 'Fehlerantwort konnte nicht fuer Snippet gelesen werden', {
        endpoint,
        status,
        error: err,
      });
    }

    throw err;
  }

  function _isTransientError(err) {
    const status = Number(err?.status || 0);
    if (status > 0) {
      return status >= 500 || status === 408 || status === 429;
    }
    const message = String(err?.message || err || '').toLowerCase();
    return message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('network error')
      || message.includes('timeout')
      || message.includes('temporarily unavailable');
  }

  function _isUnreachableFetchError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('failed to fetch')
      || msg.includes('networkerror')
      || msg.includes('network error')
      || msg.includes('load failed');
  }

  function _toDevPortEndpoint(endpoint) {
    const raw = String(endpoint || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/')) return `http://localhost:8080${raw}`;
    return `http://localhost:8080/${raw.replace(/^\.\//, '')}`;
  }

  function _canRetryViaDevPort(task, err) {
    if (!_isUnreachableFetchError(err)) return false;
    if (task?.init?.signal?.aborted) return false;
    if (typeof window === 'undefined' || !window.location) return false;
    const host = String(window.location.hostname || '').toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1') return false;
    const port = String(window.location.port || '').trim();
    if (port === '8080') return false;
    const endpoint = String(task?.fetchEndpoint || task?.endpoint || '');
    return endpoint.startsWith('api/') || endpoint.startsWith('/api/');
  }

  function _fetchTask(task) {
    const primaryEndpoint = task.fetchEndpoint || task.endpoint;
    return fetch(primaryEndpoint, task.init).catch((err) => {
      if (!_canRetryViaDevPort(task, err)) {
        throw err;
      }
      const fallbackEndpoint = _toDevPortEndpoint(primaryEndpoint);
      if (!fallbackEndpoint || fallbackEndpoint === primaryEndpoint) {
        throw err;
      }
      _log('warn', 'Netzwerk-Fallback aktiv: Retry ueber localhost:8080', {
        endpoint: primaryEndpoint,
        fallbackEndpoint,
      });
      return fetch(fallbackEndpoint, task.init);
    });
  }

  function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function _retryDelayMs(attempt) {
    const base = 220;
    const jitter = Math.floor(Math.random() * 90);
    return Math.min(1800, (base * (2 ** attempt)) + jitter);
  }

  function _versionEndpoint(endpoint) {
    const raw = String(endpoint || '').trim();
    if (!raw) return raw;
    if (/^(https?:)?\/\//i.test(raw)) return raw;

    const normalized = raw.startsWith('/') ? raw.slice(1) : raw;
    if (new RegExp(`^api/${API_VERSION}/`, 'i').test(normalized)) {
      return normalized;
    }
    if (/^api\//i.test(normalized)) {
      return normalized.replace(/^api\//i, `api/${API_VERSION}/`);
    }
    return normalized;
  }

  async function _fetchWithRetry(endpoint, init = {}, options = {}) {
    const method = String(init?.method || 'GET').toUpperCase();
    const idempotent = method === 'GET' || method === 'HEAD';
    const retryCount = idempotent
      ? Math.max(0, Number.isFinite(Number(options.retryCount)) ? Number(options.retryCount) : 2)
      : 0;
    const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));

    let lastErr = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      let timeoutId = null;
      try {
        const timeoutController = new AbortController();
        if (init?.signal && typeof init.signal.addEventListener === 'function') {
          init.signal.addEventListener('abort', () => {
            timeoutController.abort(init.signal.reason || _createAbortError('Request cancelled'));
          }, { once: true });
        }
        if (timeoutMs > 0) {
          timeoutId = setTimeout(() => {
            timeoutController.abort(_createAbortError(`Request timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }

        const queueInit = Object.assign({}, init, { signal: timeoutController.signal });
        const response = await fetch(endpoint, queueInit);
        if (!response || !response.ok) {
          await _throwHttpError(endpoint, response, method);
        }
        return response;
      } catch (err) {
        lastErr = err;
        const abortMessage = String(err?.message || err?.reason || err?.cause?.message || err?.cause || '').toLowerCase();
        const timeoutAbort = _isAbortError(err) && (abortMessage.includes('timeout') || abortMessage.includes('timed out'));
        if (_isAbortError(err) && !timeoutAbort) throw err;
        const transient = timeoutAbort || _isTransientError(err);
        if (!idempotent || !transient || attempt >= retryCount) {
          throw err;
        }
        await _sleep(_retryDelayMs(attempt));
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    throw lastErr || new Error('Network request failed');
  }

  return {
    isAbortError: (err) => _isAbortError(err),
    createAbortError: (message) => _createAbortError(message),
    fetchTask: (task) => _fetchTask(task),
    fetchWithRetry: (endpoint, init, options) => _fetchWithRetry(endpoint, init, options),
    isTransientError: (err) => _isTransientError(err),
    versionEndpoint: (endpoint) => _versionEndpoint(endpoint),
    throwHttpError: (endpoint, response, context) => _throwHttpError(endpoint, response, context),
  };
})();

if (typeof window !== 'undefined') {
  window.APITransport = APITransport;
}
