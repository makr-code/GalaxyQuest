/**
 * Auth Shell Module
 * Main orchestration layer for authentication flow.
 * Coordinates: session validation, boot/runtime launch, diagnostics logging.
 * Bridges original auth.js with modular backend components.
 */

const AuthShell = (() => {
  let _debugMode = false;
  let _sessionValidationActive = false;
  let _sessionValidationInterval = null;
  let _lastSessionCheck = 0;
  let _sessionCheckThrottleMs = 60000;
  let _bootStarted = false;
  let _bootTimestamp = Date.now();

  /**
   * Enable debug logging
   */
  const enableDebug = () => {
    _debugMode = true;
    authLog('debug mode enabled', 'info');
  };

  /**
   * Disable debug logging
   */
  const disableDebug = () => {
    _debugMode = false;
  };

  /**
   * Auth system logging (with optional console output)
   * @param {string} message - Log message
   * @param {string} level - Log level ('debug', 'info', 'warn', 'error')
   */
  const authLog = (message, level = 'debug') => {
    const timestamp = new Date().toISOString();
    const elapsed = Date.now() - _bootTimestamp;

    if (typeof window !== 'undefined' && window.GQLog) {
      const method = window.GQLog[level] || window.GQLog.debug;
      method('[auth]', `${message} (${elapsed}ms)`, timestamp);
    } else {
      const levels = { debug: 0, info: 1, warn: 2, error: 3 };
      const logLevel = levels[level] ?? levels.debug;
      if (logLevel >= 0) {
        // eslint-disable-next-line no-console
        console[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log']?.(
          `[auth] ${message} (${elapsed}ms) [${timestamp}]`
        );
      }
    }
  };

  /**
   * Auth UI logging (specialized for UI events)
   * @param {string} message - Log message
   * @param {object} data - Additional data
   */
  const authUiLog = (message, data = {}) => {
    if (typeof window !== 'undefined' && window.GQLog?.debug) {
      window.GQLog.debug('[auth-ui]', message, data);
    } else {
      // eslint-disable-next-line no-console
      console.log?.(`[auth-ui] ${message}`, data);
    }
  };

  /**
   * Probe auth API for reachability
   * @returns {Promise<object>} Probe result { ok, statusCode, token, error }
   */
  const authProbe = async () => {
    authLog('probing auth API...', 'debug');

    try {
      // Use auth-reachability module if available
      if (typeof AuthReachability !== 'undefined' && typeof AuthReachability.checkAuthApiReachable === 'function') {
        const result = await AuthReachability.checkAuthApiReachable();
        authLog(`auth probe complete: ${result.ok ? 'OK' : 'FAIL'} (${result.statusCode})`, 'debug');
        return result;
      }

      // Fallback: basic fetch
      const response = await fetch('api/auth.php?action=probe', { method: 'HEAD', timeout: 5000 });
      const statusCode = response.status;
      authLog(`auth probe complete: ${statusCode}`, 'debug');
      return { ok: statusCode < 400, statusCode };
    } catch (error) {
      authLog(
        `auth probe failed: ${String(error?.message || error || 'unknown')}`,
        'warn'
      );
      return { ok: false, error: String(error?.message || error || 'unknown') };
    }
  };

  /**
   * Check if user has active session
   * @returns {Promise<object>} Session check result { active, userId, username }
   */
  const checkSession = async () => {
    const now = Date.now();
    if (now - _lastSessionCheck < _sessionCheckThrottleMs) {
      authLog('session check throttled', 'debug');
      return { throttled: true };
    }

    _lastSessionCheck = now;
    authLog('checking session...', 'debug');

    try {
      // Try to get current user via API
      if (typeof API !== 'undefined' && typeof API.me === 'function') {
        const meData = await API.me();
        const active = !!(meData && meData.user_id && meData.username);
        authLog(`session check: ${active ? 'ACTIVE' : 'INACTIVE'}`, 'debug');
        return {
          active,
          userId: meData?.user_id,
          username: meData?.username,
        };
      }

      // Fallback: check CSRF token
      if (typeof AuthReachability !== 'undefined' && typeof AuthReachability.getCsrfToken === 'function') {
        const token = await AuthReachability.getCsrfToken();
        const active = !!token;
        authLog(`session check via token: ${active ? 'ACTIVE' : 'INACTIVE'}`, 'debug');
        return { active, token };
      }

      authLog('session check: unable to verify (API not available)', 'warn');
      return { active: null };
    } catch (error) {
      authLog(`session check error: ${String(error?.message || error || 'unknown')}`, 'warn');
      return { active: false, error: String(error?.message || error || 'unknown') };
    }
  };

  /**
   * Start periodic session validation
   * @param {number} intervalMs - Check interval in milliseconds
   * @param {Function} onExpired - Callback when session expires
   */
  const startSessionValidation = (intervalMs = 120000, onExpired = null) => {
    if (_sessionValidationActive) {
      authLog('session validation already active', 'debug');
      return;
    }

    _sessionValidationActive = true;
    _sessionCheckThrottleMs = Math.max(5000, intervalMs / 2);

    authLog(`starting session validation (interval: ${intervalMs}ms)`, 'info');

    const tick = async () => {
      const result = await checkSession();
      if (!result.throttled && !result.active && typeof onExpired === 'function') {
        authLog('session expired, firing callback', 'warn');
        onExpired(result);
      }
    };

    // Do initial check immediately
    tick().catch((error) => {
      authLog(`session validation error: ${String(error?.message || error || 'unknown')}`, 'error');
    });

    // Then schedule periodic checks
    _sessionValidationInterval = setInterval(tick, intervalMs);
  };

  /**
   * Stop periodic session validation
   */
  const stopSessionValidation = () => {
    if (!_sessionValidationActive) return;
    _sessionValidationActive = false;

    if (_sessionValidationInterval) {
      clearInterval(_sessionValidationInterval);
      _sessionValidationInterval = null;
    }

    authLog('session validation stopped', 'debug');
  };

  /**
   * Emit preload phase to UI
   * @param {string} phase - Phase name
   * @param {number} progress - Progress percentage (0-100)
   */
  const emitPhaseProgress = (phase, progress = 0) => {
    if (typeof AuthUiState !== 'undefined' && typeof AuthUiState.setPhase === 'function') {
      AuthUiState.setPhase(phase, progress);
    } else if (typeof window !== 'undefined' && window.GQLog?.debug) {
      window.GQLog.debug('[auth-shell]', `phase: ${phase} ${progress}%`);
    }
  };

  /**
   * Boot game runtime after successful auth
   * @param {object} options - Boot options
   * @returns {Promise<void>}
   */
  const bootGameRuntime = async (options = {}) => {
    const timeStart = Date.now();

    try {
      authLog('booting game runtime...', 'info');
      emitPhaseProgress('Booting game...', 50);

      // Hide auth section if UI state module available
      if (typeof AuthUiState !== 'undefined' && typeof AuthUiState.setAuthSectionVisible === 'function') {
        AuthUiState.setAuthSectionVisible(false);
      }

      // Show game section
      if (typeof AuthUiState !== 'undefined' && typeof AuthUiState.setGameSectionVisible === 'function') {
        AuthUiState.setGameSectionVisible(true);
      }

      // Call main boot entry point if available
      if (typeof window !== 'undefined' && typeof window.startGameShell === 'function') {
        emitPhaseProgress('Loading game shell...', 75);
        await window.startGameShell?.();
      }

      // Start session validation
      startSessionValidation(
        options.sessionCheckIntervalMs || 120000,
        options.onSessionExpired || null
      );

      const elapsed = Date.now() - timeStart;
      authLog(`game runtime booted in ${elapsed}ms`, 'info');
      emitPhaseProgress('Game ready', 100);
    } catch (error) {
      authLog(`boot error: ${String(error?.message || error || 'unknown')}`, 'error');
      throw error;
    }
  };

  /**
   * Start authentication session and conditionally boot game
   * @param {object} options - Options { checkOnly, autoBootOnActive }
   * @returns {Promise<object>} Result { active, userId, booted }
   */
  const checkSessionAndBoot = async (options = {}) => {
    const checkOnly = options.checkOnly === true;
    const autoBootOnActive = options.autoBootOnActive !== false;

    authLog(`checking session${checkOnly ? ' (check only)' : ''}...`, 'info');

    try {
      // Probe API reachability first
      const probeResult = await authProbe();
      if (!probeResult.ok) {
        authLog('auth API unreachable, cannot proceed', 'error');
        return { active: false, error: 'API unreachable' };
      }

      // Check for active session
      const sessionResult = await checkSession();
      if (!sessionResult.active) {
        authLog('no active session found', 'info');
        return sessionResult;
      }

      // Session is active
      authLog(`active session found (user: ${sessionResult.username || sessionResult.userId})`, 'info');

      if (checkOnly) {
        return {
          active: true,
          userId: sessionResult.userId,
          username: sessionResult.username,
        };
      }

      // Auto-boot if enabled
      if (autoBootOnActive && !_bootStarted) {
        _bootStarted = true;
        emitPhaseProgress('Session validated', 25);
        await bootGameRuntime(options);
        return {
          active: true,
          userId: sessionResult.userId,
          username: sessionResult.username,
          booted: true,
        };
      }

      return {
        active: true,
        userId: sessionResult.userId,
        username: sessionResult.username,
      };
    } catch (error) {
      authLog(`session and boot check failed: ${String(error?.message || error || 'unknown')}`, 'error');
      return { active: false, error: String(error?.message || error || 'unknown') };
    }
  };

  /**
   * Invalidate session and logout
   * @returns {Promise<void>}
   */
  const invalidateSession = async () => {
    authLog('invalidating session...', 'info');

    try {
      // Stop session validation
      stopSessionValidation();

      // Clear CSRF token if available
      if (typeof AuthReachability !== 'undefined' && typeof AuthReachability.resetCsrfToken === 'function') {
        AuthReachability.resetCsrfToken();
      }

      // Call logout API if available
      if (typeof API !== 'undefined' && typeof API.logout === 'function') {
        await API.logout().catch(() => {
          // Ignore logout API errors
        });
      }

      // Clear UI state
      if (typeof AuthUiState !== 'undefined') {
        AuthUiState.setGameSectionVisible(false);
        AuthUiState.setAuthSectionVisible(true);
        AuthUiState.hideActionModal();
        if (typeof AuthUiState.hideLoginConfirmSection === 'function') {
          await AuthUiState.hideLoginConfirmSection?.({ reset: true });
        }
      }

      authLog('session invalidated', 'info');
    } catch (error) {
      authLog(`logout error: ${String(error?.message || error || 'unknown')}`, 'warn');
    }
  };

  /**
   * Get boot diagnostic info
   * @returns {object} Diagnostic object
   */
  const getBootDiagnostics = () => {
    const elapsed = Date.now() - _bootTimestamp;
    return {
      bootStarted: _bootStarted,
      elapsedMs: elapsed,
      debugMode: _debugMode,
      sessionValidationActive: _sessionValidationActive,
      lastSessionCheck: _lastSessionCheck ? Date.now() - _lastSessionCheck : null,
      modules: {
        AuthReachability: typeof AuthReachability !== 'undefined',
        AuthUiState: typeof AuthUiState !== 'undefined',
        AuthAudio: typeof AuthAudio !== 'undefined',
        AuthBootAssets: typeof AuthBootAssets !== 'undefined',
        API: typeof API !== 'undefined',
      },
    };
  };

  /**
   * Install debug console commands
   */
  const installDebugConsole = () => {
    if (typeof window === 'undefined') return;

    window.authDebug = {
      enable: () => { enableDebug(); },
      disable: () => { disableDebug(); },
      log: authLog,
      check: () => checkSession(),
      probe: () => authProbe(),
      boot: (opts) => bootGameRuntime(opts),
      logout: () => invalidateSession(),
      info: () => getBootDiagnostics(),
    };

    authLog('debug console installed at window.authDebug', 'debug');
  };

  // Install debug console on module load
  if (typeof window !== 'undefined') {
    installDebugConsole();
  }

  // Public exports
  return {
    enableDebug,
    disableDebug,
    authLog,
    authUiLog,
    authProbe,
    checkSession,
    startSessionValidation,
    stopSessionValidation,
    emitPhaseProgress,
    bootGameRuntime,
    checkSessionAndBoot,
    invalidateSession,
    getBootDiagnostics,
    installDebugConsole,
  };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
  window.AuthShell = AuthShell;
}
