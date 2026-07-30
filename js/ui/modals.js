/**
 * modals.js – Modern Modal & Dialog System
 * Handles modern modal animations, keyboard shortcuts, and focus management
 */

const GQModals = (() => {
  'use strict';

  /**
   * Initialize modal system
   */
  function init() {
    setupModalTriggers();
    setupKeyboardHandlers();
    setupFocusTrap();
  }

  /**
   * Setup modal open/close triggers
   */
  function setupModalTriggers() {
    // Open modal on button click with data-modal-target
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-modal-target]');
      if (!trigger) return;

      const modalId = trigger.getAttribute('data-modal-target');
      const modal = document.getElementById(modalId);
      if (modal) {
        openModal(modal);
      }
    });

    // Close modal on button click with data-modal-close or close class
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-modal-close], .modal-close, .wm-modal-close-btn');
      if (!closeBtn) return;

      const modal = closeBtn.closest('[role="dialog"], .wm-modal, .modal');
      if (modal) {
        closeModal(modal);
      }
    });
  }

  /**
   * Setup keyboard handlers for modals
   */
  function setupKeyboardHandlers() {
    document.addEventListener('keydown', (e) => {
      // Escape to close topmost modal
      if (e.key === 'Escape') {
        const openModals = document.querySelectorAll('[role="dialog"][open], .wm-modal:not(.hidden), .modal.active');
        if (openModals.length > 0) {
          closeModal(openModals[openModals.length - 1]);
        }
      }

      // Enter to confirm (useful for confirmation dialogs)
      if (e.key === 'Enter' && e.ctrlKey) {
        const modal = document.querySelector('[role="dialog"][open], .wm-modal:not(.hidden), .modal.active');
        if (modal) {
          const confirmBtn = modal.querySelector('[data-modal-confirm], .btn-primary:last-of-type');
          if (confirmBtn) {
            confirmBtn.click();
          }
        }
      }
    });
  }

  /**
   * Setup focus trap inside modal
   */
  function setupFocusTrap() {
    document.addEventListener('focus', (e) => {
      const modal = e.target.closest('[role="dialog"][open], .wm-modal:not(.hidden)');
      if (!modal) return;

      const focusableElements = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.target === lastElement && !e.shiftKey) {
        firstElement.focus();
      } else if (e.target === firstElement && e.shiftKey) {
        lastElement.focus();
      }
    }, true);
  }

  /**
   * Open a modal with animations
   */
  function openModal(modal) {
    if (!modal) return;

    // Show backdrop
    const backdrop = modal.querySelector('.wm-modal-backdrop, .modal-backdrop');
    if (backdrop) {
      backdrop.classList.add('animate-backdrop-in');
    }

    // Show modal with animation
    modal.classList.remove('hidden');
    if (modal.hasAttribute('open') === false) {
      modal.setAttribute('open', '');
    }

    // Add animation class
    const dialog = modal.querySelector('.wm-modal-dialog, .modal-content') || modal;
    dialog.classList.add('animate-modal-in');

    // Set focus to first focusable element
    const firstFocusable = modal.querySelector(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'
    );
    if (firstFocusable) {
      firstFocusable.focus();
    }

    // Disable body scroll
    document.body.style.overflow = 'hidden';

    // Emit event
    modal.dispatchEvent(new CustomEvent('modalopen', { bubbles: true }));
  }

  /**
   * Close a modal with animations
   */
  function closeModal(modal) {
    if (!modal) return;

    const dialog = modal.querySelector('.wm-modal-dialog, .modal-content') || modal;
    dialog.classList.add('animate-modal-out');

    setTimeout(() => {
      modal.classList.add('hidden');
      modal.removeAttribute('open');
      dialog.classList.remove('animate-modal-in', 'animate-modal-out');

      // Re-enable body scroll
      document.body.style.overflow = '';

      // Emit event
      modal.dispatchEvent(new CustomEvent('modalclose', { bubbles: true }));
    }, 300);
  }

  /**
   * Check if any modal is currently open
   */
  function isModalOpen() {
    return document.querySelectorAll('[role="dialog"][open], .wm-modal:not(.hidden), .modal.active').length > 0;
  }

  /**
   * Close all open modals
   */
  function closeAll() {
    const openModals = document.querySelectorAll('[role="dialog"][open], .wm-modal:not(.hidden), .modal.active');
    openModals.forEach((modal) => closeModal(modal));
  }

  // Public API
  return {
    init,
    open: openModal,
    close: closeModal,
    isOpen: isModalOpen,
    closeAll,
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GQModals.init());
} else {
  GQModals.init();
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GQModals = GQModals;
}
