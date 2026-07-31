/**
 * API Session Management
 * Handles session expiry hooks, CSRF token management, and redirect triggers.
 */
const APISession = (() => {
  let _csrfToken = null;
  let _sessionExpired = false;
  const _authErrorGate = { ts: 0, key: '' };
  let _onSessionExpired = null;

  function _log(level, message, data = null) {
    const lvl = String(level || 'info').toLowerCase();
    const sink = window.GQLog && typeof window.GQLog[lvl] === 'function'
      ? window.GQLog[lvl].bind(window.GQLog)
      : null;
    if (sink) {
      if (data == null) sink('[api-session]', message);
      else sink('[api-session]', message, data);
      return;
    }
    const consoleMethod = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) console[consoleMethod]('[GQ][API][session]', message);
    else console[consoleMethod]('[GQ][API][session]', message, data);
  }

  function _shouldGateAuth(httpStatus) {
    const now = Date.now();
    const timeSinceLastGate = now - _authErrorGate.ts;
    if (timeSinceLastGate > 5000) {
      _authErrorGate.ts = now;
      _authErrorGate.key = '';
      return false;
    }
    return true;
  }

  function _handleAuthError(httpStatus, endpoint) {
    if (_shouldGateAuth(httpStatus)) {
      _log('debug', `Auth error gated (${httpStatus})`, { endpoint });
      return;
    }

    if (_sessionExpired) {
      _log('debug', 'Session already expired, skipping redirect', { endpoint, status: httpStatus });
      return;
    }

    if (httpStatus === 401 || httpStatus === 403) {
      _sessionExpired = true;
      _authErrorGate.ts = Date.now();
      _authErrorGate.key = `${httpStatus}`;
      _log('error', `Session expired (${httpStatus})`, { endpoint });
      
      if (typeof _onSessionExpired === 'function') {
        try {
          _onSessionExpired(httpStatus, endpoint);
        } catch (err) {
          _log('error', 'Session expiry callback failed', err);
        }
      }
    }
  }

  function _setCsrfToken(token) {
    _csrfToken = String(token || '').trim();
  }

  function _getCsrfToken() {
    return _csrfToken;
  }

  function _isSessionExpired() {
    return _sessionExpired;
  }

  function _resetSessionState() {
    _sessionExpired = false;
    _csrfToken = null;
    _authErrorGate.ts = 0;
    _authErrorGate.key = '';
  }

  function _setSessionExpiredCallback(callback) {
    _onSessionExpired = typeof callback === 'function' ? callback : null;
  }

  async function _fetchCsrfToken(endpoint = 'api/auth.php?action=csrf') {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        _log('warn', `CSRF fetch returned ${response.status}`, { endpoint });
        return null;
      }

      const data = await response.json();
      if (data?.token) {
        _setCsrfToken(data.token);
        return data.token;
      }

      _log('warn', 'No CSRF token in response', { endpoint, data });
      return null;
    } catch (err) {
      _log('warn', 'CSRF fetch failed', { endpoint, error: err });
      return null;
    }
  }

  return {
    setCsrfToken: (token) => _setCsrfToken(token),
    getCsrfToken: () => _getCsrfToken(),
    isSessionExpired: () => _isSessionExpired(),
    resetSessionState: () => _resetSessionState(),
    setSessionExpiredCallback: (callback) => _setSessionExpiredCallback(callback),
    fetchCsrfToken: (endpoint) => _fetchCsrfToken(endpoint),
    handleAuthError: (httpStatus, endpoint) => _handleAuthError(httpStatus, endpoint),
  };
})();

if (typeof window !== 'undefined') {
  window.APISession = APISession;
}
