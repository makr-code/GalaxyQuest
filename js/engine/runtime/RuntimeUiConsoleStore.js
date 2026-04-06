/**
 * RuntimeUiConsoleStore.js
 *
 * Store factory for UI console lines and filtering.
 */

'use strict';

(function () {
  function createUiConsoleStore(options = {}) {
    return {
      maxLines: Math.max(20, Number(options.maxLines || 220)),
      lines: Array.isArray(options.initialLines) && options.initialLines.length
        ? options.initialLines.map((line) => String(line || '').trim()).filter(Boolean)
        : ['[ui] Console ready. Type "help".'],
      filter: String(options.filter || 'all').toLowerCase(),

      push(line) {
        const text = String(line || '').trim();
        if (!text) return false;
        this.lines.push(text);
        if (this.lines.length > this.maxLines) {
          this.lines.splice(0, this.lines.length - this.maxLines);
        }
        return true;
      },

      clear(seedLine = '[ui] Console cleared.') {
        this.lines = [String(seedLine || '[ui] Console cleared.')];
      },

      setFilter(value) {
        this.filter = String(value || 'all').toLowerCase();
      },

      getVisibleLines() {
        const selected = this.filter;
        if (selected === 'all') return this.lines.slice();
        return this.lines.filter((line) => {
          const text = String(line || '').toLowerCase();
          if (selected === 'abort') {
            return text.includes('abort') || text.includes('cancel') || text.includes('navigation') || text.includes('fetchabort');
          }
          if (selected === 'system') {
            return text.includes('[ui]') || text.includes('[system]') || text.includes('[api:');
          }
          return text.includes(`[${selected}]`);
        });
      },
    };
  }

  const api = {
    createUiConsoleStore,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeUiConsoleStore = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();