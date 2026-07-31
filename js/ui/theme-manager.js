/**
 * theme-manager.js – Dark/Light Theme Toggle System
 * Manages theme switching with smooth CSS transitions
 */

const GQThemeManager = (() => {
  'use strict';

  const STORAGE_KEY = 'gq-theme-preference';
  const THEME_CLASS = 'theme-dark';

  // Theme definitions with CSS variables
  const themes = {
    dark: {
      class: 'theme-dark',
      label: 'Dark',
      icon: '🌙',
      colors: {
        '--bg-deep': '#050a1a',
        '--bg-panel': '#0d1b2e',
        '--text-primary': '#c8d8e8',
        '--text-secondary': '#7a9bbf',
        '--accent-blue': '#3aa0ff',
      },
    },
    light: {
      class: 'theme-light',
      label: 'Light',
      icon: '☀️',
      colors: {
        '--bg-deep': '#f5f7fa',
        '--bg-panel': '#ffffff',
        '--text-primary': '#1a2a3a',
        '--text-secondary': '#506080',
        '--accent-blue': '#0052cc',
      },
    },
  };

  /**
   * Initialize theme manager
   */
  function init() {
    const savedTheme = localStorage.getItem(STORAGE_KEY) || 'dark';
    setTheme(savedTheme);
    setupThemeToggleButtons();
    observeSystemThemePreference();
  }

  /**
   * Set the active theme
   */
  function setTheme(themeName) {
    const theme = themes[themeName];
    if (!theme) return;

    // Add transition class
    document.documentElement.classList.add('theme-transitioning');

    // Remove all theme classes
    Object.keys(themes).forEach((key) => {
      document.documentElement.classList.remove(themes[key].class);
    });

    // Add new theme class
    document.documentElement.classList.add(theme.class);

    // Apply theme colors as CSS variables
    Object.entries(theme.colors).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });

    // Save preference
    localStorage.setItem(STORAGE_KEY, themeName);

    // Trigger animation
    document.documentElement.classList.add('is-theme-changing');
    setTimeout(() => {
      document.documentElement.classList.remove('is-theme-changing');
      document.documentElement.classList.remove('theme-transitioning');
    }, 360);

    // Emit event
    window.dispatchEvent(
      new CustomEvent('themechange', {
        detail: { theme: themeName },
      })
    );
  }

  /**
   * Get current theme
   */
  function getTheme() {
    return localStorage.getItem(STORAGE_KEY) || 'dark';
  }

  /**
   * Toggle between themes
   */
  function toggleTheme() {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
  }

  /**
   * Setup theme toggle buttons
   */
  function setupThemeToggleButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-toggle]');
      if (!btn) return;

      const theme = btn.getAttribute('data-theme-toggle');
      if (theme) {
        setTheme(theme);
      } else {
        toggleTheme();
      }
    });
  }

  /**
   * Observe system theme preference (prefers-color-scheme)
   */
  function observeSystemThemePreference() {
    if (!window.matchMedia) return;

    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');

    darkModeQuery.addListener((e) => {
      const savedTheme = localStorage.getItem(STORAGE_KEY);

      // Only auto-switch if no saved preference
      if (!savedTheme) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  /**
   * Get available themes
   */
  function getAvailableThemes() {
    return Object.entries(themes).map(([key, theme]) => ({
      id: key,
      ...theme,
    }));
  }

  /**
   * Check if theme is currently active
   */
  function isThemeActive(themeName) {
    return getTheme() === themeName;
  }

  // Public API
  return {
    init,
    setTheme,
    getTheme,
    toggleTheme,
    getAvailableThemes,
    isThemeActive,
  };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => GQThemeManager.init());
} else {
  GQThemeManager.init();
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.GQThemeManager = GQThemeManager;
}
