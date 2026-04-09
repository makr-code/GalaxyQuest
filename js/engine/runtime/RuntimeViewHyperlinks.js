/**
 * RuntimeViewHyperlinks.js
 *
 * Provides utilities for action buttons and links that open other WM windows.
 * Enables cross-view navigation: buttons in one view that open related views.
 *
 * Usage:
 * HTML: <button class="view-link" data-open-window="colony">View Colony</button>
 * JS:   ViewHyperlinks.bindAll(container);
 */

'use strict';

(function () {
  const ViewHyperlinks = {
    /**
     * bindAll(containerElement)
     *
     * Scan container for elements with data-open-window and bind click handlers.
     * Supports: <button>, <a>, or any clickable element with data-open-window="windowId".
     */
    bindAll(container) {
      if (!container) return 0;
      let count = 0;

      const elements = container.querySelectorAll('[data-open-window]');
      elements.forEach((el) => {
        if (el.__hyperlink_bound) return;
        const winId = String(el.dataset.openWindow || '').trim();
        if (!winId) return;

        el.addEventListener('click', (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          ViewHyperlinks.openWindow(winId);
        });

        el.__hyperlink_bound = true;
        count++;
      });

      return count;
    },

    /**
     * bindElements(elements, { audio, gameLog })
     *
     * Bind an array/NodeList of specific elements.
     */
    bindElements(elements, opts = {}) {
      const { audio = null, gameLog = () => {} } = opts;

      if (!Array.isArray(elements) && !(elements instanceof NodeList)) return 0;
      let count = 0;

      const els = Array.from(elements);
      els.forEach((el) => {
        if (!el || el.__hyperlink_bound) return;
        const winId = String(el.dataset.openWindow || '').trim();
        if (!winId) return;

        el.addEventListener('click', (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          if (audio && typeof audio.playNavigation === 'function') {
            audio.playNavigation();
          }
          ViewHyperlinks.openWindow(winId, { gameLog });
        });

        el.__hyperlink_bound = true;
        count++;
      });

      return count;
    },

    /**
     * openWindow(windowId, opts)
     *
     * Opens a WM window by ID. Requires window.WM to be available.
     * opts: { gameLog, audio, ...other params }
     */
    openWindow(windowId, opts = {}) {
      const { gameLog = () => {} } = opts;
      const WM = typeof window !== 'undefined' ? window.WM : null;

      if (!WM || typeof WM.open !== 'function') {
        gameLog('warn', '[ViewHyperlinks] WM not available, cannot open window:', windowId);
        return false;
      }

      try {
        WM.open(windowId);
        gameLog('info', `[ViewHyperlinks] Opened window: ${windowId}`);
        return true;
      } catch (err) {
        gameLog('warn', `[ViewHyperlinks] Failed to open window ${windowId}:`, err);
        return false;
      }
    },

    /**
     * createActionButtonsFor(config)
     *
     * Creates a group of action buttons from a config.
     * Returns an HTML fragment ready to append.
     *
     * config: {
     *   actions: [
     *     { label: 'View Colony', windowId: 'colony', className: 'btn-primary' },
     *     { label: 'View Buildings', windowId: 'buildings', className: 'btn-secondary' },
     *   ]
     * }
     */
    createActionButtonsFor(config) {
      const { actions = [] } = config;
      if (!actions.length) return null;

      const frag = document.createDocumentFragment();
      const div = document.createElement('div');
      div.className = 'view-hyperlinks-group';

      actions.forEach((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `view-link ${action.className || 'btn-default'}`;
        btn.textContent = action.label || action.windowId;
        btn.dataset.openWindow = action.windowId;
        btn.title = `Open ${action.windowId} window`;
        div.appendChild(btn);
      });

      frag.appendChild(div);
      return frag;
    },

    /**
     * getRelatedWindows(primaryWindowId)
     *
     * Returns the list of related/dependent windows for a primary window.
     * (Pulled from NavigationSequences if available.)
     */
    getRelatedWindows(primaryWindowId) {
      const navSeq = typeof window !== 'undefined'
        && window.GQNavigationSequences
        ? window.GQNavigationSequences.getSequence(primaryWindowId)
        : null;

      return navSeq ? navSeq.windows : [];
    },

    /**
     * createRelatedActionsFor(primaryWindowId)
     *
     * Auto-generates action buttons for related windows based on NavigationSequences.
     * Returns an array of action configs ready for createActionButtonsFor().
     */
    createRelatedActionsFor(primaryWindowId) {
      const relatedWindows = ViewHyperlinks.getRelatedWindows(primaryWindowId);
      if (!relatedWindows.length) return [];

      return relatedWindows.map((winId) => ({
        label: `Open ${winId.replace(/-/g, ' ').toUpperCase()}`,
        windowId: winId,
        className: 'btn-sm btn-outline-primary',
      }));
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ViewHyperlinks };
  } else {
    window.GQRuntimeViewHyperlinks = { ViewHyperlinks };
  }
})();
