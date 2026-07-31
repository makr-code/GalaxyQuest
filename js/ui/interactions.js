/**
 * interactions.js – Modern UX interactions module
 * Handles floating labels, focus effects, keyboard navigation
 */

const GQInteractions = (() => {
  'use strict';

  /**
   * Initialize all interaction enhancements
   */
  function init() {
    setupFormInteractions();
    setupKeyboardShortcuts();
    setupRippleEffects();
    setupFocusManagement();
  }

  /**
   * Form field floating label support
   */
  function setupFormInteractions() {
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="password"], input[type="number"], textarea, select'
    );

    inputs.forEach((input) => {
      const group = input.closest('.form-group');
      if (!group) return;

      const label = group.querySelector('label');
      if (!label) return;

      // Initialize state based on current value
      updateLabelState(input, label);

      // Listen for changes
      input.addEventListener('input', () => updateLabelState(input, label));
      input.addEventListener('focus', () => {
        group.classList.add('focused');
        label?.classList.add('floating');
      });
      input.addEventListener('blur', () => {
        updateLabelState(input, label);
        group.classList.remove('focused');
      });
    });
  }

  /**
   * Update label floating state based on input value
   */
  function updateLabelState(input, label) {
    if (input.value.trim() || input.placeholder) {
      label?.classList.add('floating');
    } else {
      label?.classList.remove('floating');
    }
  }

  /**
   * Ripple effect on button clicks
   */
  function setupRippleEffects() {
    const buttons = document.querySelectorAll('.btn, button');

    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        // Skip if button is disabled
        if (btn.disabled) return;

        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Create ripple element
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        ripple.style.setProperty('--tx', `${x}px`);
        ripple.style.setProperty('--ty', `${y}px`);

        btn.appendChild(ripple);

        // Remove ripple after animation
        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  /**
   * Setup focus ring management for keyboard navigation
   */
  function setupFocusManagement() {
    let isKeyboardUser = false;

    // Detect keyboard navigation
    document.addEventListener('keydown', () => {
      isKeyboardUser = true;
      document.body.classList.add('keyboard-nav');
    });

    document.addEventListener('mousedown', () => {
      isKeyboardUser = false;
      document.body.classList.remove('keyboard-nav');
    });
  }

  /**
   * Keyboard shortcuts support
   */
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Cmd/Ctrl+K for command palette (future feature)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        // TODO: Open command palette
        console.log('Command palette triggered');
      }

      // Escape to close modals/dialogs
      if (e.key === 'Escape') {
        const modal = document.querySelector('[role="dialog"][open], .modal.active, .auth-action-modal');
        if (modal) {
          // Trigger close event or close button
          const closeBtn = modal.querySelector('[aria-label*="Close"], .modal-close');
          closeBtn?.click();
        }
      }
    });
  }

  /**
   * Add a success toast notification
   */
  function showSuccessToast(message, duration = 3000) {
    showToast(message, 'success', duration);
  }

  /**
   * Add an error toast notification
   */
  function showErrorToast(message, duration = 5000) {
    showToast(message, 'error', duration);
  }

  /**
   * Generic toast notification
   */
  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `gq-toast gq-toast-${type} animate-toast-in`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;

    const container = document.getElementById('toast-container') || createToastContainer();
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.remove('animate-toast-in');
      toast.classList.add('animate-toast-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  /**
   * Create toast container if it doesn't exist
   */
  function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'gq-toast-container';
    document.body.appendChild(container);
    return container;
  }

  /**
   * Add loading state to button
   */
  function setButtonLoading(btn, isLoading = true) {
    if (isLoading) {
      btn.disabled = true;
      btn.classList.add('btn-loading');
      btn.dataset.originalText = btn.textContent;
      btn.textContent = ''; // Will show spinner via CSS
      btn.innerHTML = '<span class="btn-spinner animate-spin" aria-hidden="true"></span>';
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  // Public API
  return {
    init,
    showSuccessToast,
    showErrorToast,
    showToast,
    setButtonLoading,
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GQInteractions.init());
} else {
  GQInteractions.init();
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GQInteractions = GQInteractions;
}
