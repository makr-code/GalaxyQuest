export function createGameWindowView(wm, id, { accountWide = false } = {}) {
  if (!wm?.layout || !wm.widgets?.notice || !wm.widgets?.timeline || !wm.widgets?.field) {
    throw new Error('Die gemeinsamen Fensterbausteine sind nicht verfügbar.');
  }
  let frame = null;
  let controllers = [];
  let focus = null;
  const disclosures = new Map();
  const tablePositions = new Map();
  let tableContext;
  function clearWidgets() {
    controllers.forEach((controller) => controller.destroy());
    controllers = [];
  }
  function widget(name, container, options) {
    const controller = wm.widgets[name](container, options);
    controllers.push(controller);
    return controller;
  }
  function canRestoreFocus(target) {
    if (!target || target.matches(':disabled') || target.closest('[hidden]')) return false;
    for (let parent = target.closest('details'); parent; parent = parent.parentElement?.closest('details')) {
      if (!parent.open && !parent.querySelector(':scope > summary')?.contains(target)) return false;
    }
    return true;
  }
  return {
    widget,
    begin({ colony, busy, error, message, data, stale }) {
      const body = wm.body(id);
      if (!body) return null;
      const active = document.activeElement;
      const context = accountWide ? 'account' : colony?.id;
      if (context !== tableContext) {
        tablePositions.clear();
        tableContext = context;
      } else {
        body.querySelectorAll('[data-game-table]').forEach((element) => {
          if (element.clientWidth > 0) tablePositions.set(element.dataset.gameTable, element.scrollLeft);
        });
      }
      body.querySelectorAll('details[data-game-disclosure]').forEach((element) => {
        disclosures.set(element.dataset.gameDisclosure, element.open);
      });
      if (body.contains(active) && active.dataset.gameFocus) {
        focus = { key: active.dataset.gameFocus, start: active.selectionStart, end: active.selectionEnd };
      } else if (active !== frame?.content) focus = null;
      clearWidgets();
      if (!frame || frame.el.parentElement !== body) {
        frame = wm.layout(id, { statusBar: { segments: [{ id: 'context', text: '' }, { id: 'state', text: '' }] } });
        frame.content.tabIndex = -1;
      }
      frame.statusBar.set('context', accountWide ? 'Accountweiter Serverstand'
        : colony ? `${colony.name} [${colony.galaxy}:${colony.system}:${colony.position}]` : 'Keine Kolonie ausgewählt.');
      frame.statusBar.set('state', error ? 'Anfrage fehlgeschlagen' : busy ? 'Serveranfrage läuft ...'
        : stale ? 'Letzter bestätigter Stand · Aktualisierung erforderlich'
          : message || (data ? 'Bestätigter Serverstand' : 'Noch keine Serverdaten geladen.'));
      frame.content.setAttribute('aria-busy', String(!!busy));
      return frame.content;
    },
    status(container, { colony, busy, error, message, data }) {
      if (!error && !busy && (colony || accountWide) && !message && data) return;
      const title = error ? 'Serveranfrage fehlgeschlagen' : busy ? 'Serveranfrage läuft ...'
        : !colony && !accountWide ? 'Keine Kolonie ausgewählt.' : message || 'Noch keine Serverdaten geladen.';
      const notice = widget('notice', container, {
        state: error ? 'error' : busy ? 'loading' : (!colony && !accountWide) || !data ? 'empty' : 'info',
        title, message: error || (busy && data ? 'Letzter bestätigter Stand bleibt sichtbar.' : ''),
      });
      notice.el.setAttribute('role', error ? 'alert' : 'status');
      notice.el.querySelector('.wm-notice-copy').removeAttribute('aria-live');
    },
    commit(root, content) {
      content.querySelectorAll('details[data-game-disclosure]').forEach((element) => {
        if (disclosures.has(element.dataset.gameDisclosure)) element.open = disclosures.get(element.dataset.gameDisclosure);
        const summary = element.querySelector(':scope > summary');
        if (summary && !summary.dataset.gameFocus) {
          summary.dataset.gameFocus = `disclosure:${element.dataset.gameDisclosure}`;
        }
      });
      for (const table of content.querySelectorAll('[data-game-table]')) {
        if (!table.dataset.gameFocus) table.dataset.gameFocus = `table:${table.dataset.gameTable}`;
      }
      for (const control of content.querySelectorAll('button, input, select, textarea')) {
        if (control.dataset.gameFocus) continue;
        const scope = control.closest('[data-ship-type], [data-type]')?.dataset;
        const table = control.closest('[data-game-table]')?.dataset.gameTable;
        const name = (table && control.dataset.tableControl) || control.getAttribute('aria-label') || control.id || control.textContent;
        if (name) control.dataset.gameFocus = `${table ? `table:${table}:` : ''}${scope?.shipType || scope?.type || ''}:${control.tagName}:${name}`;
      }
      root.replaceChildren(content);
      root.querySelectorAll('[data-game-table]').forEach((element) => {
        const key = element.dataset.gameTable;
        const restore = () => {
          if (element.clientWidth > 0 && tablePositions.has(key)) element.scrollLeft = tablePositions.get(key);
        };
        restore();
        const disclosure = element.closest('details');
        if (disclosure && !disclosure.open) {
          const onToggle = () => {
            if (!disclosure.open) return;
            restore();
            disclosure.removeEventListener('toggle', onToggle);
          };
          disclosure.addEventListener('toggle', onToggle);
        }
      });
      if (!focus) return;
      const target = [...root.querySelectorAll('[data-game-focus]')].find((item) => item.dataset.gameFocus === focus.key);
      if (canRestoreFocus(target)) {
        target.focus({ preventScroll: true });
        if (typeof focus.start === 'number' && ['search', 'text', 'tel', 'url', 'password'].includes(target.type)) {
          target.setSelectionRange(focus.start, focus.end);
        }
        focus = null;
      } else root.focus({ preventScroll: true });
    },
    destroy() {
      clearWidgets();
      frame?.destroy();
      frame = null;
      disclosures.clear();
      tablePositions.clear();
    },
  };
}
