/**
 * Auth 2FA Module
 * Handles two-factor authentication (TOTP/SMS) challenge flow.
 * Provides UI and submission handlers for 2FA verification during login.
 */

const Auth2FA = (() => {
  let _2faPanel = null;
  let _2faInFlight = false;

  /**
   * Initialize 2FA panel references
   */
  const initializePanelElements = () => {
    if (!_2faPanel) {
      _2faPanel = {
        container: document.getElementById('auth-2fa-panel'),
        codeInput: document.getElementById('auth-2fa-code'),
        submitBtn: document.getElementById('auth-2fa-submit'),
        cancelBtn: document.getElementById('auth-2fa-cancel'),
        errorEl: document.getElementById('auth-2fa-error'),
      };
    }
    return _2faPanel;
  };

  /**
   * Show 2FA challenge panel
   * @param {object} options - Display options (title, message)
   * @returns {Promise<string|null>} Resolves with code on success, null on cancel
   */
  const show2FAChallenge = (options = {}) => {
    return new Promise((resolve) => {
      const panel = initializePanelElements();
      if (!panel?.container) {
        if (typeof window !== 'undefined' && window.GQLog?.error) {
          window.GQLog.error('[auth-2fa]', '2FA panel elements not found in DOM');
        }
        resolve(null);
        return;
      }

      // Reset state
      _2faInFlight = false;
      if (panel.codeInput) panel.codeInput.value = '';
      if (panel.errorEl) panel.errorEl.textContent = '';
      panel.container.classList.remove('hidden');

      // Focus code input
      if (panel.codeInput) {
        setTimeout(() => panel.codeInput.focus(), 100);
      }

      // Handle submit
      const handleSubmit = async (ev) => {
        if (ev) ev.preventDefault();
        if (_2faInFlight) return;

        const code = panel.codeInput?.value?.trim() || '';
        if (!code || code.length < 5) {
          if (panel.errorEl) panel.errorEl.textContent = 'Please enter your 2FA code (at least 5 characters)';
          return;
        }

        cleanup();
        resolve(code);
      };

      // Handle cancel
      const handleCancel = () => {
        cleanup();
        resolve(null);
      };

      // Handle Enter key
      const handleKeydown = (ev) => {
        if (ev.key === 'Enter' && !_2faInFlight) {
          handleSubmit(ev);
        }
      };

      const cleanup = () => {
        if (panel.submitBtn) panel.submitBtn.removeEventListener('click', handleSubmit);
        if (panel.cancelBtn) panel.cancelBtn.removeEventListener('click', handleCancel);
        if (panel.codeInput) panel.codeInput.removeEventListener('keydown', handleKeydown);
        if (panel.container) panel.container.classList.add('hidden');
      };

      // Bind handlers
      if (panel.submitBtn) panel.submitBtn.addEventListener('click', handleSubmit);
      if (panel.cancelBtn) panel.cancelBtn.addEventListener('click', handleCancel);
      if (panel.codeInput) panel.codeInput.addEventListener('keydown', handleKeydown);
    });
  };

  /**
   * Verify TOTP code with auth backend
   * @param {object} loginData - Login response data containing session info
   * @param {string} code - TOTP code from user
   * @returns {Promise<object>} Login result { success, user, token, error }
   */
  const verifyTotpCode = async (loginData, code) => {
    if (!loginData || !code) {
      return { success: false, error: '2FA data missing' };
    }

    if (!AuthReachability) {
      return { success: false, error: '2FA module not initialized' };
    }

    try {
      _2faInFlight = true;

      const response = await AuthReachability.fetchWithTimeout('api/auth.php?action=verify_2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: loginData.session_id || loginData.temp_session,
          code: String(code).trim(),
          type: loginData.challenge_type || 'totp',
        }),
        credentials: 'same-origin',
      }, { timeoutMs: 15000, tag: '2fa-verify' });

      if (!response.ok) {
        const data = await AuthReachability.parseApiJson(response);
        return {
          success: false,
          error: data?.error || `Authentication failed (${response.status})`,
          status: response.status,
        };
      }

      const data = await response.json();
      if (data?.success) {
        return {
          success: true,
          user: data.user,
          token: data.token,
        };
      }

      return {
        success: false,
        error: data?.error || 'Invalid 2FA code',
      };
    } catch (error) {
      return {
        success: false,
        error: `2FA verification failed: ${String(error?.message || error || 'unknown')}`,
      };
    } finally {
      _2faInFlight = false;
    }
  };

  /**
   * Complete 2FA flow: show challenge and verify code
   * @param {object} loginData - Login response data
   * @returns {Promise<object>} Verified login result { success, user, token, error }
   */
  const doTotpChallenge = async (loginData) => {
    if (!loginData) {
      return { success: false, error: 'No login data provided' };
    }

    // Show 2FA challenge panel and get code from user
    const code = await show2FAChallenge({
      title: '2-Factor Authentication',
      message: 'Please enter your 2FA code to complete login',
    });

    if (!code) {
      return { success: false, error: 'User cancelled 2FA' };
    }

    // Verify the code
    return verifyTotpCode(loginData, code);
  };

  /**
   * Hide 2FA panel
   */
  const hide2FAChallenge = () => {
    const panel = initializePanelElements();
    if (panel?.container) {
      panel.container.classList.add('hidden');
    }
  };

  /**
   * Show error message in 2FA panel
   * @param {string} message - Error message
   */
  const setError = (message) => {
    const panel = initializePanelElements();
    if (panel?.errorEl) {
      panel.errorEl.textContent = String(message || '');
    }
  };

  /**
   * Clear 2FA panel error
   */
  const clearError = () => {
    const panel = initializePanelElements();
    if (panel?.errorEl) {
      panel.errorEl.textContent = '';
    }
  };

  // Public exports
  return {
    show2FAChallenge,
    verifyTotpCode,
    doTotpChallenge,
    hide2FAChallenge,
    setError,
    clearError,
  };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
  window.Auth2FA = Auth2FA;
}
