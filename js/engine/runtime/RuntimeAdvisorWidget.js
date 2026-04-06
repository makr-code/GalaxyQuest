/**
 * RuntimeAdvisorWidget.js
 *
 * Advisor widget and hints window runtime module.
 */

'use strict';

(function () {
  function createAdvisorWidget(opts = {}) {
    const api = opts.api;
    const wm = opts.wm;
    const esc = opts.esc || ((value) => String(value ?? ''));
    const documentRef = opts.documentRef || document;
    const getLeadersController = typeof opts.getLeadersController === 'function' ? opts.getLeadersController : (() => null);

    let advisor = null;
    let hints = [];

    function initWidget() {
      const widget = documentRef.createElement('div');
      widget.id = 'advisor-widget';
      widget.style.display = 'none';
      widget.innerHTML = `<div id="advisor-bubble" title="Advisor - click for hints">
        <span id="advisor-bubble-portrait">A</span>
        <div id="advisor-bubble-info">
          <span id="advisor-bubble-name">Advisor</span>
          <span id="advisor-bubble-badge"></span>
        </div>
      </div>`;
      documentRef.body.appendChild(widget);
      widget.querySelector('#advisor-bubble')?.addEventListener('click', () => {
        wm.open('advisor-hints');
      });
    }

    function renderHintsWindow() {
      const root = wm.body('advisor-hints');
      if (!root) return;

      const leadersController = getLeadersController();
      if (leadersController && typeof leadersController._injectCardStyles === 'function') {
        leadersController._injectCardStyles();
      }

      if (!advisor) {
        root.innerHTML = '<p class="text-muted">No advisor assigned. Hire an Advisor from the Leaders Marketplace.</p>';
        return;
      }

      if (hints.length === 0) {
        root.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
            <span style="font-size:2rem">${esc(advisor.portrait || 'A')}</span>
            <div><strong>${esc(advisor.name)}</strong>
              <div style="font-size:0.75rem;color:var(--text-secondary)">${esc(advisor.tagline || '')}</div></div>
          </div>
          <p class="text-muted">No active hints. Check back soon.</p>
          <button class="btn btn-secondary btn-sm" id="advisor-refresh-btn" style="margin-top:0.5rem">Re-scan</button>`;
      } else {
        root.innerHTML = `
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
            <span style="font-size:2rem">${esc(advisor.portrait || 'A')}</span>
            <div><strong>${esc(advisor.name)}</strong>
              <div style="font-size:0.75rem;color:var(--text-secondary)">${esc(advisor.tagline || '')}</div></div>
          </div>
          <div id="hints-list">
            ${hints.map((h) => `
              <div class="advisor-hint-card hint-${h.hint_type}" data-hid="${h.id}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <div class="advisor-hint-title">${esc(h.title)}</div>
                  <button class="btn btn-secondary btn-sm dismiss-hint-btn" data-hid="${h.id}" style="padding:0 5px;font-size:0.7rem;margin-left:0.5rem">x</button>
                </div>
                <div class="advisor-hint-body">${esc(h.body)}</div>
                ${h.action_label && h.action_window ? `
                  <button class="btn btn-primary btn-sm hint-action-btn" data-window="${h.action_window}" style="margin-top:0.4rem;font-size:0.75rem">
                    ${esc(h.action_label)}
                  </button>` : ''}
              </div>`).join('')}
          </div>
          <button class="btn btn-secondary btn-sm" id="advisor-refresh-btn" style="margin-top:0.5rem">Re-scan</button>`;
      }

      root.querySelector('#advisor-refresh-btn')?.addEventListener('click', async () => {
        const res = await api.advisorTick();
        if (res.success) {
          hints = res.hints || [];
          advisor = res.advisor || advisor;
          updateWidget();
          renderHintsWindow();
        }
      });

      root.querySelectorAll('.dismiss-hint-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const hid = parseInt(btn.dataset.hid, 10);
          await api.dismissHint(hid);
          hints = hints.filter((h) => Number(h.id) !== hid);
          updateWidget();
          renderHintsWindow();
        });
      });

      root.querySelectorAll('.hint-action-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          wm.open(btn.dataset.window);
        });
      });
    }

    function updateWidget() {
      const widget = documentRef.getElementById('advisor-widget');
      if (!widget) return;
      if (!advisor) {
        widget.style.display = 'none';
        return;
      }

      widget.style.display = '';
      const portraitEl = documentRef.getElementById('advisor-bubble-portrait');
      if (portraitEl) portraitEl.textContent = advisor.portrait || 'A';

      const nameEl = documentRef.getElementById('advisor-bubble-name');
      if (nameEl) nameEl.textContent = advisor.name || 'Advisor';

      const badge = documentRef.getElementById('advisor-bubble-badge');
      if (!badge) return;

      if (hints.length > 0) {
        badge.textContent = `${hints.length} hint${hints.length > 1 ? 's' : ''}`;
        badge.style.color = hints.some((h) => h.hint_type === 'warning' || h.hint_type === 'action_required')
          ? '#f59e0b'
          : 'var(--accent,#4a9eff)';
      } else {
        badge.textContent = 'All clear';
        badge.style.color = '#4ade80';
      }

      if (wm.body('advisor-hints')) {
        renderHintsWindow();
      }
    }

    async function load() {
      try {
        const res = await api.advisorHints();
        if (res.success) {
          advisor = res.advisor;
          hints = res.hints || [];
          updateWidget();
        }
      } catch (_) {
        // non-critical
      }
    }

    async function maybeRefresh() {
      setTimeout(load, 800);
    }

    function register() {
      initWidget();
      wm.register('advisor-hints', {
        title: 'Advisor',
        w: 420,
        h: 520,
        defaultDock: 'right',
        defaultY: 44,
        onRender: renderHintsWindow,
      });
    }

    return { load, maybeRefresh, register };
  }

  const api = {
    createAdvisorWidget,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeAdvisorWidget = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
