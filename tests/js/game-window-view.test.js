import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { createGameWindowView } from '../../js/ui/game-window-view.js';
import { mountShipyardWindow } from '../../js/ui/game-shipyard.js';
import { mountDevelopmentWindows } from '../../js/ui/game-development.js';
import { mountEconomyWindow } from '../../js/ui/game-economy.js';
import { mountMarketWindow } from '../../js/ui/game-market.js';
import { mountPopulationWindow } from '../../js/ui/game-population.js';
import { mountFleetWindow } from '../../js/ui/game-fleets.js';

describe('live management window components', () => {
  let wm;
  const views = [];
  beforeEach(() => {
    document.body.innerHTML = '<div id="wm-taskbar"></div>';
    for (const file of ['js/ui/gq-ui.js', 'js/runtime/wm.js', 'js/runtime/wm-widgets.js']) {
      window.eval(fs.readFileSync(file, 'utf8'));
    }
    wm = window.WMCore.create({ widgets: window.WMWidgets, storagePrefix: 'live_widget_test_' });
    wm.widgets = window.WMWidgets;
  });
  afterEach(() => {
    views.splice(0).forEach(view => view.destroy());
    for (const el of document.querySelectorAll('.wm-window')) wm.close(el.dataset.winid);
    localStorage.clear();
  });
  function makeView(options) {
    wm.register('test', { title: 'Test' });
    wm.open('test');
    const view = createGameWindowView(wm, 'test', options);
    views.push(view);
    return view;
  }
  const colony = { id: 1, name: 'Home', galaxy: 1, system: 2, position: 3 };
  function renderInput(view, { busy = false, error = '', type = 'search' } = {}) {
    const root = view.begin({ colony, busy, error, data: {} });
    const content = document.createElement('section');
    const fields = document.createElement('fieldset');
    fields.disabled = busy;
    const input = document.createElement('input');
    input.type = type;
    input.dataset.gameFocus = 'quantity';
    input.value = '27';
    view.widget('field', fields, { label: 'Quantity', control: input });
    content.appendChild(fields);
    view.status(content, { colony, busy, error, data: {} });
    view.commit(root, content);
    return input;
  }
  it('uses the real WM frame and reuses it on updates, then recreates it after close/reopen', () => {
    const view = makeView();
    renderInput(view);
    const first = wm.layout('test');
    expect(first.content.closest('.wm-body')).toBe(wm.body('test'));
    expect(first.statusBar.el.textContent).toContain('Home [1:2:3]');
    renderInput(view, { error: 'Offline' });
    expect(wm.layout('test')).toBe(first);
    expect(first.statusBar.el.textContent).toContain('fehlgeschlagen');
    expect(first.content.querySelector('[role="alert"] .wm-notice-message').textContent).toBe('Offline');
    wm.close('test');
    expect(view.begin({ colony })).toBeNull();
    wm.open('test');
    renderInput(view);
    expect(wm.layout('test')).not.toBe(first);
    expect(first.el.isConnected).toBe(false);
  });
  it('restores input focus and selection after a busy disabled-fieldset roundtrip', () => {
    const view = makeView();
    const first = renderInput(view);
    first.focus();
    first.setSelectionRange(1, 2);
    const pending = renderInput(view, { busy: true });
    expect(pending.matches(':disabled')).toBe(true);
    expect(document.activeElement).toBe(wm.layout('test').content);
    const updated = renderInput(view);
    expect(document.activeElement).toBe(updated);
    expect(updated.selectionStart).toBe(1);
    expect(updated.selectionEnd).toBe(2);
    expect(updated.value).toBe('27');
  });
  it('does not steal focus if the player moves to another control while loading', () => {
    const view = makeView();
    renderInput(view).focus();
    renderInput(view, { busy: true });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    renderInput(view);
    expect(document.activeElement).toBe(outside);
  });
  it('does not invent successful data and distinguishes accountwide from colony context', () => {
    const view = makeView({ accountWide: true });
    const root = view.begin({ data: null });
    view.status(root, { data: null });
    expect(root.querySelector('.wm-notice').dataset.state).toBe('empty');
    expect(wm.layout('test').statusBar.el.textContent).toContain('Accountweiter Serverstand');
    expect(wm.layout('test').statusBar.el.textContent).not.toContain('Bestätigter Serverstand');
    expect(root.textContent).not.toContain('Keine Kolonie');
  });
  it('uses stable action focus keys and destroys child widgets on updates and teardown', () => {
    const view = makeView();
    let root = view.begin({ colony, data: {} });
    const content = document.createElement('section');
    const button = document.createElement('button');
    button.textContent = 'Refresh';
    content.appendChild(button);
    const field = view.widget('field', content, { label: 'Quantity', control: document.createElement('input') });
    const destroy = vi.spyOn(field, 'destroy');
    view.commit(root, content);
    button.focus();
    root = view.begin({ colony, data: {} });
    expect(destroy).toHaveBeenCalledOnce();
    const next = document.createElement('section');
    const replacement = document.createElement('button');
    replacement.textContent = 'Refresh';
    next.appendChild(replacement);
    view.commit(root, next);
    expect(document.activeElement).toBe(replacement);
    view.destroy();
    view.destroy();
    expect(wm.body('test').querySelector('.wm-window-frame')).toBeNull();
  });
  it('fails explicitly when the widget framework is missing', () => {
    expect(() => createGameWindowView({ body: () => null }, 'test')).toThrow('Fensterbausteine');
  });
  function renderTable(view, { selectedColony = colony, visible = true, open = true } = {}) {
    const root = view.begin({ colony: selectedColony, data: {} });
    const content = document.createElement('section');
    const disclosure = document.createElement('details');
    disclosure.dataset.gameDisclosure = 'measurements';
    disclosure.open = open;
    const table = view.widget('dataTable', disclosure, {
      caption: 'Measurements', columns: [{ id: 'value' }], items: [{ value: 1 }],
    }).el;
    table.dataset.gameTable = 'measurements';
    Object.defineProperty(table, 'clientWidth', { configurable: true, get: () => visible ? 300 : 0 });
    content.append(disclosure);
    view.commit(root, content);
    return { table, disclosure };
  }
  it('retains table horizontal position through rerenders but resets it when colony context changes', () => {
    const view = makeView();
    const first = renderTable(view).table;
    first.scrollLeft = 240;
    const second = renderTable(view).table;
    expect(second.scrollLeft).toBe(240);
    second.scrollLeft = 120;
    expect(renderTable(view).table.scrollLeft).toBe(120);
    expect(renderTable(view, { selectedColony: { ...colony, id: 2 } }).table.scrollLeft).toBe(0);
    expect(first.isConnected).toBe(false);
  });
  it('restores keyboard focus to a replaced table scroll region without stealing external focus', () => {
    const view = makeView();
    const first = renderTable(view).table;
    first.focus();
    first.scrollLeft = 160;
    const next = renderTable(view).table;
    expect(document.activeElement).toBe(next);
    expect(next.scrollLeft).toBe(160);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    renderTable(view);
    expect(document.activeElement).toBe(outside);
  });
  it('scopes identical controls to their table and retains the correct search selection', () => {
    const view = makeView();
    function render() {
      const root = view.begin({ colony, data: {} });
      const content = document.createElement('section');
      for (const id of ['first', 'second']) {
        const table = view.widget('dataTable', content, {
          caption: 'Measurements', searchable: true, state: { query: 'draft' },
          columns: [{ id: 'value', sortable: true }], items: [{ value: 1 }],
        });
        table.el.dataset.gameTable = id;
      }
      view.commit(root, content);
      return content;
    }
    let content = render();
    const input = content.querySelector('[data-game-table="second"] input');
    input.value = 'draft';
    input.focus();
    input.setSelectionRange(1, 3);
    content = render();
    expect(document.activeElement).toBe(content.querySelector('[data-game-table="second"] input'));
    expect(document.activeElement.selectionStart).toBe(1);
    expect(document.activeElement.selectionEnd).toBe(3);
    const secondButton = content.querySelector('[data-game-table="second"] thead button');
    secondButton.focus();
    content = render();
    expect(document.activeElement).toBe(content.querySelector('[data-game-table="second"] thead button'));
  });
  it('does not restore focus into a collapsed table until it is visible again', () => {
    const view = makeView();
    const first = renderTable(view);
    first.table.focus();
    first.disclosure.open = false;
    const next = renderTable(view, { open: false });
    expect(document.activeElement).toBe(wm.layout('test').content);
    expect(next.disclosure.open).toBe(false);
    next.disclosure.open = true;
    const visible = renderTable(view);
    expect(document.activeElement).toBe(visible.table);
  });
  it('restores disclosure summary focus by identity when labels and open state change', () => {
    const view = makeView();
    function render(label = 'Details') {
      const root = view.begin({ colony, data: {} });
      const content = document.createElement('section');
      for (const id of ['one', 'two']) {
        const details = document.createElement('details');
        details.dataset.gameDisclosure = id;
        const summary = document.createElement('summary');
        summary.textContent = label;
        details.append(summary);
        content.append(details);
      }
      view.commit(root, content);
      return content.querySelector('[data-game-disclosure="two"]');
    }
    let details = render();
    details.querySelector('summary').focus();
    details = render('Updated');
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector('summary'));
    details.open = true;
    details = render();
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(details.querySelector('summary'));
  });
  it('does not focus nested summaries inside a collapsed ancestor or a filtered-out row', () => {
    const view = makeView();
    function render(hidden = false) {
      const root = view.begin({ colony, data: {} });
      const content = document.createElement('section');
      const outer = document.createElement('details');
      outer.dataset.gameDisclosure = 'outer';
      outer.open = true;
      const outerSummary = document.createElement('summary');
      outerSummary.textContent = 'Outer';
      const wrapper = document.createElement('div');
      wrapper.hidden = hidden;
      const inner = document.createElement('details');
      inner.dataset.gameDisclosure = 'inner';
      const summary = document.createElement('summary');
      summary.textContent = 'Inner';
      inner.append(summary);
      wrapper.append(inner);
      outer.append(outerSummary, wrapper);
      content.append(outer);
      view.commit(root, content);
      return { outer, summary };
    }
    let elements = render();
    elements.summary.focus();
    elements = render(true);
    expect(document.activeElement).toBe(wm.layout('test').content);
    elements = render();
    expect(document.activeElement).toBe(elements.summary);
    elements.outer.open = false;
    render();
    expect(document.activeElement).toBe(wm.layout('test').content);
  });
  it('retains table action focus when sort direction, filter labels and translated captions change', () => {
    const view = makeView();
    function render({ direction = 'ascending', value = 'A', label = 'Name', localized = false } = {}) {
      const root = view.begin({ colony, data: {} });
      const content = document.createElement('section');
      for (const id of ['first', 'second']) {
        const table = view.widget('dataTable', content, {
          caption: 'Measurements', searchable: true,
          labels: localized ? { search: 'Suche', reset: 'Zurücksetzen' } : {},
          state: { sort: { id: 'name', direction }, filters: { name: value } },
          columns: [{ id: 'name', label, sortable: true,
            filter: { label: localized ? 'Namensfilter' : 'Name filter', options: [{ value: 'A' }, { value: 'B' }] } }],
          items: [{ name: 'A' }, { name: 'B' }],
        });
        table.el.dataset.gameTable = id;
      }
      view.commit(root, content);
      return content.querySelector('[data-game-table="second"]');
    }
    let table = render();
    table.querySelector('.wm-table-sort-chip').focus();
    table = render({ direction: 'descending' });
    expect(document.activeElement).toBe(table.querySelector('.wm-table-sort-chip'));
    table.querySelector('.wm-table-active-filters button').focus();
    table = render({ value: 'B', label: 'New caption' });
    expect(document.activeElement).toBe(table.querySelector('.wm-table-active-filters button'));
    table.querySelector('thead button').focus();
    table = render({ label: 'Translated name', localized: true });
    expect(document.activeElement).toBe(table.querySelector('thead button'));
    table.querySelector('select').focus();
    table = render();
    expect(document.activeElement).toBe(table.querySelector('select'));
    table.querySelector('input').focus();
    table = render({ localized: true });
    expect(document.activeElement).toBe(table.querySelector('input'));
  });
  it('does not overwrite saved scroll positions with hidden table zeroes and restores when expanded', () => {
    const view = makeView();
    const first = renderTable(view);
    first.table.scrollLeft = 220;
    renderTable(view);
    const hidden = renderTable(view, { visible: false });
    hidden.disclosure.open = false;
    const next = renderTable(view, { visible: false, open: false });
    expect(next.table.scrollLeft).toBe(0);
    Object.defineProperty(next.table, 'clientWidth', { value: 300 });
    next.disclosure.dispatchEvent(new Event('toggle'));
    expect(next.table.scrollLeft).toBe(0);
    next.disclosure.open = true;
    next.disclosure.dispatchEvent(new Event('toggle'));
    expect(next.table.scrollLeft).toBe(220);
  });
  it('keeps accountwide table positions across colony changes and clears them on destroy', () => {
    const view = makeView({ accountWide: true });
    renderTable(view).table.scrollLeft = 180;
    expect(renderTable(view, { selectedColony: { ...colony, id: 2 } }).table.scrollLeft).toBe(180);
    view.destroy();
    expect(renderTable(view).table.scrollLeft).toBe(0);
  });
  it.each([
    ['buildings', mountDevelopmentWindows], ['research', mountDevelopmentWindows],
    ['economy', mountEconomyWindow], ['trade', mountMarketWindow],
    ['population', mountPopulationWindow], ['fleet', mountFleetWindow],
  ])('wires the actual %s view into real WM frame, error and close/reopen lifecycles', (id, mount) => {
    const listeners = new Set();
    const state = { data: null, fleets: null, loading: false, mutating: false, stale: false, error: '', message: '' };
    const domain = { getState: () => state, load: vi.fn(), refresh: vi.fn(), command: vi.fn(),
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
    const session = { getColony: () => colony, events: { on: () => () => {} } };
    const unmount = mount({ wm, domain, domains: { buildings: domain, research: domain }, session, galaxy: {} });
    try {
      wm.open(id);
      const first = wm.layout(id);
      expect(first.statusBar.el.textContent).toContain(id === 'fleet' ? 'Accountweiter' : 'Home [1:2:3]');
      expect(first.content.querySelector('.wm-notice[data-state="empty"]')).not.toBeNull();
      state.error = 'Read offline';
      listeners.forEach(fn => fn());
      expect(wm.layout(id)).toBe(first);
      expect(first.content.querySelector('[role="alert"]').textContent).toContain('Read offline');
      wm.close(id);
      state.error = '';
      wm.open(id);
      expect(wm.layout(id)).not.toBe(first);
      expect(wm.layout(id).content.querySelector('.wm-notice[data-state="empty"]')).not.toBeNull();
      expect(domain.command).not.toHaveBeenCalled();
    } finally { unmount(); }
    expect(listeners.size).toBe(0);
    expect(wm.isOpen(id)).toBe(false);
  });
  it('mounts the actual shipyard with real WM lifecycle and keeps quantity/filter drafts after read errors', () => {
    const listeners = new Set();
    const state = { loading: false, mutating: false, stale: false, error: '', message: '',
      data: { queue: [{ id: 1, position: 1, ship_type: 'cargo', quantity: 2, status: 'running', eta: '2030-01-01' }],
        ships: [{ type: 'cargo', name: 'Cargo', count: 1, cost: { metal: 10 } }] } };
    const emit = () => listeners.forEach(fn => fn());
    const domain = { getState: () => state, load: vi.fn(), refresh: vi.fn(), command: vi.fn(),
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
    const session = { getColony: () => colony, events: { on: () => () => {} } };
    const unmount = mountShipyardWindow({ wm, domain, session });
    try {
      wm.open('shipyard');
      expect(domain.load).toHaveBeenCalledOnce();
      const body = () => wm.body('shipyard');
      expect(body().querySelector('.wm-timeline[aria-label="Schiffsbauwarteschlange"]')).not.toBeNull();
      const input = body().querySelector('input[type="number"]');
      input.value = '27';
      input.dispatchEvent(new Event('input'));
      input.focus();
      state.loading = true;
      emit();
      state.loading = false;
      state.error = 'Offline';
      state.stale = true;
      emit();
      expect(body().querySelector('input[type="number"]').value).toBe('27');
      expect(body().querySelector('fieldset').disabled).toBe(true);
      expect(body().querySelector('.wm-notice[data-state="error"]').textContent).toContain('Offline');
      state.stale = false;
      state.error = '';
      emit();
      expect(document.activeElement).toBe(body().querySelector('input[type="number"]'));
      wm.close('shipyard');
      wm.open('shipyard');
      expect(body().querySelector('input[type="number"]').value).toBe('27');
      expect(domain.command).not.toHaveBeenCalled();
    } finally { unmount(); }
    expect(listeners.size).toBe(0);
    expect(wm.isOpen('shipyard')).toBe(false);
  });
});
