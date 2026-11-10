/**
 * RuntimeAdvisorWidget.js
 *
 * Advisor widget and hints window runtime module.
 */

'use strict';

(function () {
  const HINT_TYPE_CLASSES = new Set(['quest_hint', 'warning', 'tip', 'action_required']);
  const ACTION_WINDOWS = new Set(['colony', 'research', 'buildings', 'leaders', 'quests', 'shipyard', 'factions', 'fleet']);

  function createElement(documentRef, tagName, className = '', text = null) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    if (text !== null) element.textContent = String(text);
    return element;
  }

  function createAdvisorWidget(opts = {}) {
    const api = opts.api;
    const wm = opts.wm;
    const documentRef = opts.documentRef || document;
    const getLeadersController = typeof opts.getLeadersController === 'function' ? opts.getLeadersController : (() => null);

    let advisor = null;
    let hints = [];

    function initWidget() {
      const widget = documentRef.createElement('div');
      widget.id = 'advisor-widget';
      widget.style.display = 'none';
      const bubble = createElement(documentRef, 'div');
      bubble.id = 'advisor-bubble';
      bubble.title = 'Advisor - click for hints';
      bubble.appendChild(createElement(documentRef, 'span', '', 'A')).id = 'advisor-bubble-portrait';
      const info = createElement(documentRef, 'div');
      info.id = 'advisor-bubble-info';
      info.appendChild(createElement(documentRef, 'span', '', 'Advisor')).id = 'advisor-bubble-name';
      info.appendChild(createElement(documentRef, 'span')).id = 'advisor-bubble-badge';
      bubble.appendChild(info);
      widget.appendChild(bubble);
      documentRef.body.appendChild(widget);
      bubble.addEventListener('click', () => {
        wm.open('advisor-hints');
      });
    }

    function renderAdvisorHeader(root) {
      const header = createElement(documentRef, 'div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '0.75rem';
      header.style.marginBottom = '1rem';

      const portrait = createElement(documentRef, 'span', '', advisor.portrait || 'A');
      portrait.style.fontSize = '2rem';
      const details = createElement(documentRef, 'div');
      details.appendChild(createElement(documentRef, 'strong', '', advisor.name || 'Advisor'));
      const tagline = createElement(documentRef, 'div', '', advisor.tagline || '');
      tagline.style.fontSize = '0.75rem';
      tagline.style.color = 'var(--text-secondary)';
      details.appendChild(tagline);
      header.append(portrait, details);
      root.appendChild(header);
    }

    function createRefreshButton(root) {
      const button = createElement(documentRef, 'button', 'btn btn-secondary btn-sm', 'Re-scan');
      button.id = 'advisor-refresh-btn';
      button.type = 'button';
      button.style.marginTop = '0.5rem';
      button.addEventListener('click', async () => {
        const res = await api.advisorTick();
        if (res.success) {
          hints = res.hints || [];
          advisor = res.advisor || advisor;
          updateWidget();
          renderHintsWindow();
        }
      });
      root.appendChild(button);
    }

    function createHintCard(hint) {
      const card = createElement(documentRef, 'div', 'advisor-hint-card');
      const hintType = HINT_TYPE_CLASSES.has(hint.hint_type) ? hint.hint_type : 'tip';
      card.classList.add(`hint-${hintType}`);

      const header = createElement(documentRef, 'div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'flex-start';
      const title = createElement(documentRef, 'div', 'advisor-hint-title', hint.title || '');
      header.appendChild(title);

      const rawId = Number(hint.id);
      const hintId = Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
      if (hintId !== null) {
        card.dataset.hid = String(hintId);
        const dismissButton = createElement(documentRef, 'button', 'btn btn-secondary btn-sm dismiss-hint-btn', 'x');
        dismissButton.type = 'button';
        dismissButton.dataset.hid = String(hintId);
        dismissButton.style.padding = '0 5px';
        dismissButton.style.fontSize = '0.7rem';
        dismissButton.style.marginLeft = '0.5rem';
        dismissButton.addEventListener('click', async () => {
          await api.dismissHint(hintId);
          hints = hints.filter((entry) => Number(entry.id) !== hintId);
          updateWidget();
          renderHintsWindow();
        });
        header.appendChild(dismissButton);
      }

      card.appendChild(header);
      card.appendChild(createElement(documentRef, 'div', 'advisor-hint-body', hint.body || ''));

      const actionWindow = String(hint.action_window || '');
      if (hint.action_label && ACTION_WINDOWS.has(actionWindow)) {
        const actionButton = createElement(
          documentRef,
          'button',
          'btn btn-primary btn-sm hint-action-btn',
          hint.action_label,
        );
        actionButton.type = 'button';
        actionButton.dataset.window = actionWindow;
        actionButton.style.marginTop = '0.4rem';
        actionButton.style.fontSize = '0.75rem';
        actionButton.addEventListener('click', () => wm.open(actionWindow));
        card.appendChild(actionButton);
      }
      return card;
    }

    function renderHintsWindow() {
      const root = wm.body('advisor-hints');
      if (!root) return;

      const leadersController = getLeadersController();
      if (leadersController && typeof leadersController._injectCardStyles === 'function') {
        leadersController._injectCardStyles();
      }

      if (!advisor) {
        root.replaceChildren(createElement(
          documentRef,
          'p',
          'text-muted',
          'No advisor assigned. Hire an Advisor from the Leaders Marketplace.',
        ));
        return;
      }

      root.replaceChildren();
      renderAdvisorHeader(root);
      if (hints.length === 0) {
        root.appendChild(createElement(documentRef, 'p', 'text-muted', 'No active hints. Check back soon.'));
        createRefreshButton(root);
      } else {
        const list = createElement(documentRef, 'div');
        list.id = 'hints-list';
        hints.forEach((hint) => list.appendChild(createHintCard(hint)));
        root.appendChild(list);
        createRefreshButton(root);
      }
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
