/**
 * Auth UI State Module
 * Manages login/register forms, modals, preload panel, and tab navigation.
 * Provides UI state management for the authentication flow.
 */

const AuthUiState = (() => {
  let _uiElements = null;
  let _lastPhaseBucket = 0;
  let _preloadPanelSuppressed = false;

  /**
   * Initialize UI element references from DOM
   * @returns {object} UI elements object
   */
  const initializeElements = () => {
    if (_uiElements) return _uiElements;

    _uiElements = {
      // Main sections
      authSection: document.getElementById('auth-section'),
      gameSection: document.getElementById('game-section') 
        || document.getElementById('wm-galaxy-section')
        || document.getElementById('wm-host-galaxy'),

      // Forms
      loginForm: document.getElementById('login-form'),
      registerForm: document.getElementById('register-form'),

      // Preload panel
      preloadPanel: document.getElementById('auth-preload-panel'),
      preloadBar: document.getElementById('auth-preload-bar'),
      preloadLabel: document.getElementById('auth-preload-label'),
      preloadMeta: document.getElementById('auth-preload-meta'),

      // Action modal
      actionModal: document.getElementById('auth-action-modal'),
      actionSpinner: document.getElementById('auth-action-spinner'),
      actionTitle: document.getElementById('auth-action-title'),
      actionText: document.getElementById('auth-action-text'),

      // Login confirm section
      loginConfirmSection: document.getElementById('auth-login-confirm-section'),
      loginConfirmTitle: document.getElementById('auth-login-confirm-title'),
      loginConfirmText: document.getElementById('auth-login-confirm-text'),
      loginConfirmBar: document.getElementById('auth-login-confirm-bar'),
      loginConfirmMeta: document.getElementById('auth-login-confirm-meta'),

      // Checkboxes
      loginRemember: document.getElementById('login-remember'),
      regRemember: document.getElementById('reg-remember'),

      // Tabs
      tabs: document.querySelectorAll?.('.auth-tabs .tab-btn') || [],

      // Dev tools
      devTools: document.getElementById('dev-auth-tools'),
      devTabButton: document.getElementById('auth-dev-tab'),
    };

    return _uiElements;
  };

  /**
   * Bind Enter key submission to a form
   * @param {HTMLFormElement} form - Form element
   */
  const bindEnterSubmit = (form) => {
    if (!form || form.__gqEnterSubmitBound) return;
    form.__gqEnterSubmitBound = true;

    form.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.key !== 'Enter') return;
      const target = ev.target;
      if (!target) return;
      const tag = String(target.tagName || '').toLowerCase();
      if (tag === 'textarea') return;
      if (ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return;

      ev.preventDefault();
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      } else {
        form.submit();
      }
    });
  };

  /**
   * Update boot progress display
   * @param {string} label - Progress label
   * @param {number} pct - Progress percentage (0-100)
   */
  const setPhase = (label, pct) => {
    const el = initializeElements();
    const clamped = Math.max(0, Math.min(100, Number(pct || 0)));
    const authVisible = !!(el.authSection && !el.authSection.classList.contains('hidden'));
    const loginConfirmVisible = !!(el.loginConfirmSection && !el.loginConfirmSection.classList.contains('hidden'));

    // Update preload panel
    if (el.preloadLabel) el.preloadLabel.textContent = String(label || 'Loading...');
    if (el.preloadMeta) el.preloadMeta.textContent = `${clamped.toFixed(0)}%`;
    if (el.preloadBar) el.preloadBar.style.width = `${clamped}%`;

    // Show/hide preload panel based on visibility
    if (!_preloadPanelSuppressed && !authVisible && !loginConfirmVisible) {
      el.preloadPanel?.classList.remove('hidden');
    } else {
      el.preloadPanel?.classList.add('hidden');
    }

    // Update login confirm section
    if (el.loginConfirmBar) el.loginConfirmBar.style.width = `${clamped}%`;
    if (el.loginConfirmSection) {
      el.loginConfirmSection.classList.toggle('is-complete', clamped >= 100);
    }

    if (el.loginConfirmSection && !el.loginConfirmSection.classList.contains('hidden') && el.loginConfirmMeta) {
      if (clamped >= 100) {
        if (el.loginConfirmTitle) el.loginConfirmTitle.textContent = 'Ready';
        if (el.loginConfirmText) el.loginConfirmText.textContent = 'Entering game...';
        el.loginConfirmMeta.textContent = '100% • Starting';
      } else {
        el.loginConfirmMeta.textContent = `${clamped.toFixed(0)}% • ${String(label || 'Loading...')}`;
      }
    }

    // Log progress in buckets to keep console clean
    const bucket = Math.floor(clamped / 25);
    if (bucket !== _lastPhaseBucket) {
      _lastPhaseBucket = bucket;
      if (typeof window !== 'undefined' && window.GQLog?.debug) {
        window.GQLog.debug('[auth-ui]', `boot progress ${clamped.toFixed(0)}%`, String(label || 'Loading...'));
      }
    }
  };

  /**
   * Hide the preload panel
   * @param {boolean} reset - Reset panel to initial state
   */
  const hidePreloadPanel = (reset = false) => {
    const el = initializeElements();
    el.preloadPanel?.classList.add('hidden');

    if (typeof window !== 'undefined' && window.GQLog?.debug) {
      window.GQLog.debug('[auth-ui]', `preload panel hidden${reset ? ' (reset)' : ''}`);
    }

    if (!reset) return;

    if (el.preloadBar) el.preloadBar.style.width = '0%';
    if (el.preloadLabel) el.preloadLabel.textContent = 'System check...';
    if (el.preloadMeta) el.preloadMeta.textContent = '0%';
  };

  /**
   * Suppress preload panel visibility
   * @param {boolean} suppressed - Whether to suppress
   */
  const setPreloadPanelSuppressed = (suppressed) => {
    _preloadPanelSuppressed = !!suppressed;
  };

  /**
   * Show action modal (blocking)
   * @param {string} title - Modal title
   * @param {string} text - Modal text
   * @param {boolean} showSpinner - Show loading spinner
   */
  const showActionModal = (title, text, showSpinner = true) => {
    const el = initializeElements();
    if (el.actionModal) {
      el.actionModal.classList.remove('hidden');
      if (el.actionTitle) el.actionTitle.textContent = String(title || '');
      if (el.actionText) el.actionText.textContent = String(text || '');
      if (el.actionSpinner) {
        el.actionSpinner.classList.toggle('hidden', !showSpinner);
      }
    }
  };

  /**
   * Hide action modal
   */
  const hideActionModal = () => {
    const el = initializeElements();
    if (el.actionModal) {
      el.actionModal.classList.add('hidden');
    }
  };

  /**
   * Show login confirmation section
   * @param {string} title - Confirmation title
   * @param {string} text - Confirmation text
   */
  const showLoginConfirmSection = (title, text) => {
    const el = initializeElements();
    if (el.loginConfirmSection) {
      if (el.loginConfirmTitle) el.loginConfirmTitle.textContent = String(title || 'Logging in...');
      if (el.loginConfirmText) el.loginConfirmText.textContent = String(text || '');
      el.loginConfirmSection.classList.remove('hidden');
    }
  };

  /**
   * Hide login confirmation section
   * @param {object} options - Options (reset)
   * @returns {Promise<void>}
   */
  const hideLoginConfirmSection = async (options = {}) => {
    const el = initializeElements();
    if (el.loginConfirmSection) {
      el.loginConfirmSection.classList.add('hidden');
      if (typeof window !== 'undefined' && window.GQLog?.debug) {
        window.GQLog.debug('[auth-ui]', 'login confirm hidden');
      }
    }

    if (!options.reset) return;

    // Reset to initial state
    if (el.loginConfirmBar) el.loginConfirmBar.style.width = '0%';
    if (el.loginConfirmTitle) el.loginConfirmTitle.textContent = '';
    if (el.loginConfirmText) el.loginConfirmText.textContent = '';
    if (el.loginConfirmMeta) el.loginConfirmMeta.textContent = '';
  };

  /**
   * Display error on a form
   * @param {HTMLElement} errorElement - Error display element
   * @param {Error} error - Error object
   * @param {string} userFacingMessage - User-friendly message
   */
  const setAuthError = (errorElement, error, userFacingMessage) => {
    if (!errorElement) return;
    const msg = String(userFacingMessage || error?.message || error || 'Error');
    errorElement.textContent = msg;

    if (typeof window !== 'undefined' && window.GQLog?.debug) {
      window.GQLog.debug('[auth-ui]', 'auth error:', msg);
    }
  };

  /**
   * Activate a specific auth tab
   * @param {string} tabName - Tab name ('login', 'register', 'dev')
   */
  const activateAuthTab = (tabName) => {
    const el = initializeElements();
    if (!el.tabs) return;

    // Update tab buttons
    el.tabs.forEach((btn) => {
      const isTarget = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', isTarget);
    });

    // Update form visibility
    if (el.loginForm) {
      el.loginForm.classList.toggle('hidden', tabName !== 'login');
    }
    if (el.registerForm) {
      el.registerForm.classList.toggle('hidden', tabName !== 'register');
    }
    if (el.devTools) {
      el.devTools.classList.toggle('hidden', tabName !== 'dev');
    }
  };

  /**
   * Show/hide auth section
   * @param {boolean} visible - Show or hide
   */
  const setAuthSectionVisible = (visible) => {
    const el = initializeElements();
    if (el.authSection) {
      el.authSection.classList.toggle('hidden', !visible);
    }
  };

  /**
   * Show/hide game section
   * @param {boolean} visible - Show or hide
   */
  const setGameSectionVisible = (visible) => {
    const el = initializeElements();
    if (el.gameSection) {
      el.gameSection.classList.toggle('hidden', !visible);
    }
  };

  /**
   * Get UI element
   * @param {string} elementId - Element ID
   * @returns {HTMLElement|null} Element or null
   */
  const getElement = (elementId) => {
    const el = initializeElements();
    return el[elementId] || null;
  };

  // Public exports
  return {
    initializeElements,
    bindEnterSubmit,
    setPhase,
    hidePreloadPanel,
    setPreloadPanelSuppressed,
    showActionModal,
    hideActionModal,
    showLoginConfirmSection,
    hideLoginConfirmSection,
    setAuthError,
    activateAuthTab,
    setAuthSectionVisible,
    setGameSectionVisible,
    getElement,
  };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
  window.AuthUiState = AuthUiState;
}
