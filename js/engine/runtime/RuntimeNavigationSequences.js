/**
 * RuntimeNavigationSequences.js
 *
 * Defines automatic window open sequences based on user navigation.
 * When a user opens a primary view, related/dependent views can automatically
 * open alongside (if user preference allows).
 *
 * Flow Logic:
 * - Home → Overview (always on startup)
 * - Colony → Buildings, Research (optional dependent stack)
 * - Economy → Economy-Flow, Trade (optional dependent stack)
 * - Messages/Intel → Factions, Wars, Leaders (optional)
 * - Etc.
 */

'use strict';

(function () {
  /**
   * createNavigationSequenceController(opts)
   *
   * Returns an object with methods to manage window open sequences.
   *
   * opts: {
   *   wm: WM instance,
   *   gameLog: logging function,
   *   settingsState: user preferences (e.g., autoOpenRelated: true/false),
   * }
   */
  function createNavigationSequenceController(opts = {}) {
    const {
      wm = null,
      gameLog = () => {},
      settingsState = {},
    } = opts;

    if (!wm) return { registerSequence: () => {} };

    // Flow definitions: primary window → auto-open windows
    const sequences = {
      colony: {
        title: 'Colony Management Stack',
        windows: ['buildings', 'research'],
        parallel: false, // open one at a time
        delay: 200,      // ms between opens
      },
      economy: {
        title: 'Economy Analysis Stack',
        windows: ['economy-flow', 'trade'],
        parallel: false,
        delay: 200,
      },
      messages: {
        title: 'Intelligence Network Stack',
        windows: ['intel', 'leaderboard'],
        parallel: true,
        delay: 0,
      },
      intelligence: {
        title: 'Intelligence Expansion',
        windows: ['factions', 'alliances', 'wars'],
        parallel: true,
        delay: 0,
      },
      traders: {
        title: 'Trade Operations Stack',
        windows: ['trade-routes', 'pirates'],
        parallel: false,
        delay: 200,
      },
    };

    // Window listeners to trigger sequences
    const listenersActive = new Set();

    function shouldAutoOpen() {
      return settingsState?.autoOpenRelatedViews !== false;
    }

    /**
     * Execute a sequence: open dependent windows after primary.
     * sequence: { windows: [...], parallel, delay }
     */
    async function executeSequence(sequence) {
      if (!shouldAutoOpen() || !sequence.windows || !sequence.windows.length) return;

      const { windows, parallel, delay } = sequence;

      if (parallel) {
        windows.forEach((winId) => {
          if (typeof wm.open === 'function') wm.open(winId);
        });
      } else {
        for (const winId of windows) {
          if (typeof wm.open === 'function') wm.open(winId);
          if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        }
      }

      gameLog('info', `[NavSeq] Executed: ${sequence.title}`);
    }

    /**
     * registerSequence(primaryWindowId)
     *
     * Binds a window open event to trigger its sequence.
     * Called once per sequence on init.
     */
    function registerSequence(primaryWindowId) {
      if (!sequences[primaryWindowId] || listenersActive.has(primaryWindowId)) return;

      if (typeof wm.on === 'function') {
        wm.on('open', (id) => {
          if (id === primaryWindowId) {
            executeSequence(sequences[primaryWindowId]);
          }
        });
        listenersActive.add(primaryWindowId);
      }
    }

    /**
     * registerAllSequences()
     *
     * Binds all defined sequences.
     */
    function registerAllSequences() {
      Object.keys(sequences).forEach(registerSequence);
      gameLog('info', '[NavSeq] All sequences registered.');
    }

    /**
     * getSequence(id)
     * Get a sequence definition by primary window ID.
     */
    function getSequence(id) {
      return sequences[id] || null;
    }

    /**
     * listSequences()
     * List all defined sequences.
     */
    function listSequences() {
      return Object.entries(sequences).map(([key, val]) => ({
        primaryWindow: key,
        title: val.title,
        dependentWindows: val.windows,
      }));
    }

    return {
      registerSequence,
      registerAllSequences,
      getSequence,
      listSequences,
      executeSequence,
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createNavigationSequenceController };
  } else {
    window.GQRuntimeNavigationSequences = { createNavigationSequenceController };
  }
})();
