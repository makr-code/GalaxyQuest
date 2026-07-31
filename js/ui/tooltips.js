/**
 * tooltips.js – Modern Tooltip System
 * Provides lightweight, animated tooltips with keyboard shortcut hints
 */

const GQTooltips = (() => {
  'use strict';

  const config = {
    delay: 500,
    duration: 300,
    position: 'top', // top, bottom, left, right
  };

  /**
   * Initialize tooltips
   */
  function init() {
    setupTooltips();
  }

  /**
   * Setup all elements with data-tooltip attribute
   */
  function setupTooltips() {
    const tooltipElements = document.querySelectorAll('[data-tooltip]');

    tooltipElements.forEach((el) => {
      let hoverTimeout;

      el.addEventListener('mouseenter', () => {
        hoverTimeout = setTimeout(() => {
          showTooltip(el);
        }, config.delay);
      });

      el.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimeout);
        hideTooltip(el);
      });

      // Show tooltip on focus for keyboard users
      el.addEventListener('focus', () => {
        showTooltip(el);
      });

      el.addEventListener('blur', () => {
        hideTooltip(el);
      });
    });
  }

  /**
   * Show tooltip for an element
   */
  function showTooltip(el) {
    const existing = el.querySelector('.gq-tooltip');
    if (existing) return;

    const text = el.getAttribute('data-tooltip');
    const shortcut = el.getAttribute('data-tooltip-shortcut');

    const tooltip = document.createElement('div');
    tooltip.className = 'gq-tooltip animate-tooltip-in';
    tooltip.setAttribute('role', 'tooltip');

    let content = text;
    if (shortcut) {
      content += ` <kbd>${shortcut}</kbd>`;
    }

    tooltip.innerHTML = content;

    // Position tooltip
    const position = el.getAttribute('data-tooltip-position') || config.position;
    tooltip.classList.add(`gq-tooltip-${position}`);

    el.appendChild(tooltip);

    // Trigger animation
    requestAnimationFrame(() => {
      tooltip.classList.add('show');
    });
  }

  /**
   * Hide tooltip for an element
   */
  function hideTooltip(el) {
    const tooltip = el.querySelector('.gq-tooltip');
    if (!tooltip) return;

    tooltip.classList.remove('show');
    setTimeout(() => {
      tooltip.remove();
    }, config.duration);
  }

  /**
   * Create tooltip for element programmatically
   */
  function setTooltip(el, text, position = 'top', shortcut = null) {
    el.setAttribute('data-tooltip', text);
    el.setAttribute('data-tooltip-position', position);
    if (shortcut) {
      el.setAttribute('data-tooltip-shortcut', shortcut);
    }
  }

  // Public API
  return {
    init,
    setTooltip,
    show: showTooltip,
    hide: hideTooltip,
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GQTooltips.init());
} else {
  GQTooltips.init();
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GQTooltips = GQTooltips;
}
