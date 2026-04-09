/**
 * RuntimeUiConsolePanel.js
 *
 * UI console panel controller factory.
 */

'use strict';

(function () {
  function createUiConsoleController(opts = {}) {
    const store = opts.store;
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});
    const esc = typeof opts.esc === 'function' ? opts.esc : ((value) => String(value || ''));
    const documentRef = opts.documentRef || document;
    const windowRef = opts.windowRef || window;
    const navigatorRef = opts.navigatorRef || navigator;
    const wm = opts.wm || null;
    const onRunCommand = typeof opts.onRunCommand === 'function' ? opts.onRunCommand : (async () => {});

    if (!store || typeof store.push !== 'function' || typeof store.getVisibleLines !== 'function') {
      throw new Error('[runtime/ui-console-panel] store with push/getVisibleLines is required.');
    }

    return {
      initialized: false,

      push(line) {
        if (!store.push(line)) return false;
        this.render();
        return true;
      },

      getVisibleLines() {
        return store.getVisibleLines();
      },

      async copyToClipboard() {
        const lines = this.getVisibleLines();
        if (!lines.length) {
          showToast('Keine Console-Zeilen zum Kopieren.', 'info');
          return;
        }
        const payload = lines.join('\n');
        try {
          if (navigatorRef?.clipboard?.writeText) {
            await navigatorRef.clipboard.writeText(payload);
          } else {
            const ta = documentRef.createElement('textarea');
            ta.value = payload;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.left = '-10000px';
            documentRef.body.appendChild(ta);
            ta.select();
            documentRef.execCommand('copy');
            documentRef.body.removeChild(ta);
          }
          showToast(`Console kopiert (${lines.length} Zeilen).`, 'success');
        } catch (err) {
          console.error('[GQ] copyUiConsoleToClipboard failed', err);
          showToast('Kopieren der Console fehlgeschlagen.', 'warning');
        }
      },

      render() {
        const log = documentRef.getElementById('ui-console-log');
        if (!log) return;
        const visibleLines = this.getVisibleLines();
        log.innerHTML = visibleLines.map((line) => `<div>${esc(line)}</div>`).join('');
        log.scrollTop = log.scrollHeight;
      },

      hydrateFromTerminal() {
        if (!(windowRef.GQLog && typeof windowRef.GQLog.getAll === 'function')) return;
        const source = typeof windowRef.GQLog.getSessionEntries === 'function'
          ? windowRef.GQLog.getSessionEntries()
          : windowRef.GQLog.getAll();
        const history = source.slice(-25);
        history.forEach((entry) => {
          const level = String(entry?.level || 'log').toUpperCase();
          const sourceName = String(entry?.source || 'app');
          const text = String(entry?.text || '');
          this.push(`[${level}] [${sourceName}] ${text}`);
        });
      },

      bindTerminalLogStream() {
        if (windowRef.__gqTerminalLogBound) return;
        windowRef.__gqTerminalLogBound = true;
        windowRef.addEventListener('gq:terminal-log', (ev) => {
          const entry = ev?.detail || {};
          const level = String(entry.level || 'log').toUpperCase();
          const source = String(entry.source || 'app');
          const text = String(entry.text || '');
          this.push(`[${level}] [${source}] ${text}`);
        });
      },

      setOpen(open, panel, toggleBtn, input) {
        const hasWm = !!(wm && typeof wm.open === 'function' && typeof wm.close === 'function');
        if (hasWm) {
          panel.classList.remove('hidden');
          if (open) {
            windowRef.GQWindowRegistry?.registerAll?.();
            wm.open('console');
          } else {
            wm.close('console');
          }
          toggleBtn?.classList.toggle('active', !!open);
          if (open) {
            this.render();
            input.focus();
          }
          return;
        }

        panel.classList.toggle('hidden', !open);
        toggleBtn?.classList.toggle('active', !!open);
        if (open) {
          this.render();
          input.focus();
        }
      },

      init() {
        if (this.initialized) return true;
        const panel = documentRef.getElementById('ui-console-panel') || documentRef.getElementById('boot-terminal');
        const toggleBtn = documentRef.getElementById('ui-console-toggle');
        const closeBtn = documentRef.getElementById('ui-console-close');
        const clearBtn = documentRef.getElementById('ui-console-clear');
        const copyBtn = documentRef.getElementById('ui-console-copy');
        const filterSelect = documentRef.getElementById('ui-console-filter');
        const runBtn = documentRef.getElementById('ui-console-run');
        const input = documentRef.getElementById('ui-console-input');
        if (!panel || !toggleBtn || !runBtn || !input) return false;

        panel.classList.add('ui-console-enhanced');
        panel.setAttribute('data-gq-console-enhanced', '1');
        const modeLabel = documentRef.getElementById('boot-terminal-mode');
        if (modeLabel) {
          modeLabel.textContent = 'Mode: UI Console';
        }

        this.hydrateFromTerminal();
        this.bindTerminalLogStream();

        const isConsoleOpen = () => {
          const hasWm = !!(wm && typeof wm.isOpen === 'function');
          if (hasWm) return !!wm.isOpen('console');
          return !panel.classList.contains('hidden');
        };

        toggleBtn.addEventListener('click', () => this.setOpen(!isConsoleOpen(), panel, toggleBtn, input));
        closeBtn?.addEventListener('click', () => this.setOpen(false, panel, toggleBtn, input));
        clearBtn?.addEventListener('click', () => {
          store.clear();
          this.render();
        });
        copyBtn?.addEventListener('click', async () => {
          await this.copyToClipboard();
        });
        filterSelect?.addEventListener('change', () => {
          store.setFilter(filterSelect.value || 'all');
          this.render();
        });
        runBtn.addEventListener('click', async () => {
          const cmd = input.value;
          input.value = '';
          await onRunCommand(cmd);
        });
        input.addEventListener('keydown', async (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const cmd = input.value;
          input.value = '';
          await onRunCommand(cmd);
        });

        toggleBtn.classList.toggle('active', isConsoleOpen());

        const authConsoleToggleBtn = documentRef.getElementById('auth-console-toggle');
        if (authConsoleToggleBtn) {
          authConsoleToggleBtn.addEventListener('click', () => this.setOpen(!isConsoleOpen(), panel, toggleBtn, input));
        }

        windowRef.__gqUiConsoleReady = true;
        if (typeof windowRef.dispatchEvent === 'function') {
          windowRef.dispatchEvent(new CustomEvent('gq:ui-console-ready', {
            detail: { panelId: panel.id, logId: 'ui-console-log' },
          }));
        }

        this.initialized = true;
        return true;
      },
    };
  }

  const api = {
    createUiConsoleController,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeUiConsolePanel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
