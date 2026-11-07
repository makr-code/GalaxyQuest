import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

describe('shared window components', () => {
  let widgets;
  let WM;
  const controllers = [];
  beforeEach(() => {
    document.body.innerHTML = '<div id="widgets"></div><div id="wm-taskbar"></div>';
    localStorage.clear();
    for (const file of ['js/ui/gq-ui.js', 'js/runtime/wm.js', 'js/runtime/wm-widgets.js']) {
      window.eval(fs.readFileSync(file, 'utf8'));
    }
    widgets = window.WMWidgets;
    WM = window.WMCore.create({ widgets, storagePrefix: 'widget_test_' });
    window.WM = WM;
  });
  afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.destroy());
    WM.closeContextMenu();
    for (const el of document.querySelectorAll('.wm-window')) WM.close(el.dataset.winid);
  });
  function mount(name, opts) {
    const controller = widgets[name](document.getElementById('widgets'), opts);
    controllers.push(controller);
    return controller;
  }
  function key(target, value) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  }

  function sizedSplit(opts = {}) {
    const ctrl = mount('split', opts);
    Object.defineProperty(ctrl.el, 'clientWidth', { configurable: true, value: 612 });
    Object.defineProperty(ctrl.el, 'clientHeight', { configurable: true, value: 412 });
    const divider = ctrl.el.querySelector('[role="separator"]');
    Object.defineProperty(divider, 'offsetWidth', { value: 12 });
    Object.defineProperty(divider, 'offsetHeight', { value: 12 });
    ctrl.setRatio(opts.ratio ?? 0.5);
    return { ctrl, divider };
  }
  function pointer(target, type, x, y = 0, id = 1, button = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button });
    Object.defineProperties(event, { pointerId: { value: id }, isPrimary: { value: true } });
    target.dispatchEvent(event);
  }

  it('uses accessible axis-specific split keyboard controls and consistent minimum sizes', () => {
    const { ctrl, divider } = sizedSplit({ ratio: 0.5, minA: 120, minB: 120, ariaLabel: 'Resize list' });
    expect(divider.getAttribute('aria-label')).toBe('Resize list');
    expect(divider.getAttribute('aria-controls')).toBe(ctrl.paneA.id);
    expect(divider.getAttribute('aria-valuenow')).toBe('50.00');
    expect(divider.getAttribute('aria-valuemin')).toBe('20.00');
    expect(divider.getAttribute('aria-valuemax')).toBe('80.00');
    key(divider, 'ArrowUp');
    expect(divider.getAttribute('aria-valuenow')).toBe('50.00');
    key(divider, 'ArrowRight');
    expect(divider.getAttribute('aria-valuenow')).toBe('55.00');
    key(divider, 'Home');
    expect(divider.getAttribute('aria-valuenow')).toBe('20.00');
    key(divider, 'End');
    expect(divider.getAttribute('aria-valuenow')).toBe('80.00');
    ctrl.setRatio(0);
    expect(divider.getAttribute('aria-valuenow')).toBe('20.00');
    const vertical = sizedSplit({ direction: 'vertical', minA: 100, minB: 100 });
    key(vertical.divider, 'ArrowDown');
    expect(vertical.divider.getAttribute('aria-valuenow')).toBe('55.00');
    expect(vertical.divider.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('tracks a single split pointer and rolls back on Escape, cancellation and blur', () => {
    const resize = vi.fn();
    const { ctrl, divider } = sizedSplit({ onResize: resize });
    pointer(divider, 'pointerdown', 100, 0, 1, 2);
    pointer(document, 'pointermove', 160);
    expect(divider.getAttribute('aria-valuenow')).toBe('50.00');
    for (const cancel of ['escape', 'pointercancel', 'blur', 'lostpointercapture']) {
      pointer(divider, 'pointerdown', 100);
      pointer(document, 'pointermove', 250, 0, 2);
      expect(divider.getAttribute('aria-valuenow')).toBe('50.00');
      pointer(document, 'pointermove', 160);
      expect(divider.getAttribute('aria-valuenow')).toBe('60.00');
      if (cancel === 'escape') key(divider, 'Escape');
      else if (cancel === 'blur') window.dispatchEvent(new Event('blur'));
      else pointer(cancel === 'lostpointercapture' ? divider : document, cancel, 160);
      expect(divider.getAttribute('aria-valuenow')).toBe('50.00');
      expect(ctrl.el.classList.contains('is-resizing')).toBe(false);
    }
    expect(resize).toHaveBeenCalled();
  });

  it('cleans split document listeners on pointer completion and destruction', () => {
    const resize = vi.fn();
    const { ctrl, divider } = sizedSplit({ onResize: resize });
    pointer(divider, 'pointerdown', 100);
    pointer(document, 'pointermove', 160);
    pointer(document, 'pointerup', 160);
    pointer(document, 'pointermove', 250);
    expect(divider.getAttribute('aria-valuenow')).toBe('60.00');
    pointer(divider, 'pointerdown', 160);
    const remove = vi.spyOn(document, 'removeEventListener');
    ctrl.destroy();
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function), true);
    resize.mockClear();
    pointer(document, 'pointermove', 250);
    expect(resize).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  it('degrades impossible split minima proportionally and rejects invalid ratios', () => {
    const { ctrl, divider } = sizedSplit({ minA: 800, minB: 200 });
    expect(divider.getAttribute('aria-valuenow')).toBe('80.00');
    expect(divider.getAttribute('aria-valuemin')).toBe('80.00');
    expect(divider.getAttribute('aria-valuemax')).toBe('80.00');
    for (const value of [NaN, Infinity, -0.1, 1.1]) expect(() => ctrl.setRatio(value)).toThrow('ratio');
    expect(() => mount('split', { direction: 'unknown' })).toThrow('direction');
    expect(() => mount('split', { minA: -1 })).toThrow('minimum');
  });

  it('switches narrow master/detail panes without losing drafts or leaving focus hidden', () => {
    const ctrl = mount('masterDetail', { masterLabel: 'Orders', detailLabel: 'Order details' });
    let width = 400;
    Object.defineProperty(ctrl.el, 'offsetWidth', { get: () => width });
    const input = document.createElement('input');
    input.value = 'draft';
    const action = document.createElement('button');
    ctrl.master.appendChild(action);
    ctrl.detail.appendChild(input);
    ctrl.refresh();
    expect(ctrl.detail.hidden).toBe(true);
    expect(ctrl.master.hidden).toBe(false);
    action.focus();
    ctrl.showDetail();
    expect(ctrl.master.hidden).toBe(true);
    expect(ctrl.detail.hidden).toBe(false);
    expect(document.activeElement).toBe(ctrl.detail);
    input.focus();
    ctrl.showMaster();
    expect(document.activeElement).toBe(ctrl.master);
    expect(input.value).toBe('draft');
    width = 900;
    ctrl.refresh();
    expect(ctrl.detail.hidden).toBe(false);
    expect(ctrl.master.hidden).toBe(false);
    expect(ctrl.el.classList.contains('is-narrow')).toBe(false);
    expect(ctrl.detail.getAttribute('aria-label')).toBe('Order details');
  });

  it('propagates master/detail renderer failures and removes partial layout', () => {
    expect(() => mount('masterDetail', { renderDetail: () => { throw new Error('render failed'); } })).toThrow('render failed');
    expect(document.querySelector('.wm-masterdetail')).toBeNull();
    expect(() => mount('masterDetail', { breakpoint: 0 })).toThrow('breakpoint');
  });

  it('requests pages without changing the displayed authoritative page itself', () => {
    const onChange = vi.fn();
    const ctrl = mount('pagination', { total: 95, pageSize: 20, page: 1, onChange });
    const buttons = [...ctrl.el.querySelectorAll('button')];
    expect(buttons[0].disabled).toBe(true);
    expect(ctrl.el.querySelector('[aria-current]').textContent).toBe('1');
    ctrl.el.querySelector('[data-page-key="next"]').click();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(ctrl.el.querySelector('[aria-current]').textContent).toBe('1');
    ctrl.el.querySelector('[aria-current]').click();
    expect(onChange).toHaveBeenCalledOnce();
    ctrl.set({ page: 5 });
    expect(ctrl.el.querySelector('[aria-current]').textContent).toBe('5');
    expect(ctrl.el.querySelector('[data-page-key="next"]').disabled).toBe(true);
    expect(ctrl.el.querySelector('.wm-pagination-summary').textContent).toBe('5 / 5 (95)');
    ctrl.el.querySelector('[data-page-key="previous"]').click();
    expect(onChange).toHaveBeenLastCalledWith(4);
  });

  it('bounds pagination DOM size even for very large collections and labels pages accessibly', () => {
    const ctrl = mount('pagination', { total: 1_000_000, pageSize: 1, page: 500_000, onChange: vi.fn(),
      labels: { navigation: 'Seiten', page: page => 'Seite ' + page, summary: (page, pages) => `${page} von ${pages}` },
    });
    expect(ctrl.el.querySelectorAll('button').length).toBeLessThanOrEqual(7);
    expect(ctrl.el.getAttribute('aria-label')).toBe('Seiten');
    expect(ctrl.el.querySelector('[aria-current]').getAttribute('aria-label')).toBe('Seite 500000');
    expect(ctrl.el.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(ctrl.el.querySelector('.wm-pagination-summary').textContent).toBe('500000 von 1000000');
  });

  it('handles empty pagination and busy transitions with deterministic focus fallback', () => {
    const onChange = vi.fn();
    const ctrl = mount('pagination', { total: 40, pageSize: 20, page: 1, onChange });
    ctrl.el.querySelector('[data-page-key="next"]').focus();
    ctrl.set({ page: 2 });
    expect(document.activeElement).toBe(ctrl.el.querySelector('[aria-current]'));
    ctrl.set({ busy: true });
    expect(ctrl.el.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(ctrl.el);
    for (const button of ctrl.el.querySelectorAll('button')) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    expect(onChange).not.toHaveBeenCalled();
    ctrl.set({ busy: false, total: 0, page: 0 });
    expect(ctrl.el.querySelector('[aria-current]')).toBeNull();
    expect(ctrl.el.querySelector('.wm-pagination-summary').textContent).toBe('No entries');
    expect(ctrl.el.querySelectorAll('button')).toHaveLength(2);
    expect([...ctrl.el.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  });

  it('rejects invalid pagination atomically instead of clamping stale page data', () => {
    const ctrl = mount('pagination', { total: 40, pageSize: 20, page: 2, onChange: vi.fn() });
    for (const next of [{ total: -1 }, { total: Infinity }, { pageSize: 0 }, { pageSize: 1.5 }, { page: 3 }, { page: 0 }, { total: 0 }]) {
      expect(() => ctrl.set(next)).toThrow();
      expect(ctrl.el.querySelector('[aria-current]').textContent).toBe('2');
      expect(ctrl.el.querySelector('.wm-pagination-summary').textContent).toBe('2 / 2 (40)');
    }
    expect(() => mount('pagination', {})).toThrow('onChange');
  });

  it('renders explicit timeline states, metadata and text without inferring progression', () => {
    const ctrl = mount('timeline', { ariaLabel: 'Construction', items: [
      { id: 'one', title: '<Complete>', state: 'complete', stateLabel: 'Fertig', meta: 'Serverzeit: 12:00' },
      { id: 'two', title: 'Build', state: 'active', stateLabel: 'Im Bau', content: '<img src=x>' },
      { id: 'three', title: 'Research', state: 'blocked', stateLabel: 'Ressourcen fehlen' },
      { id: 'four', title: 'Ship', state: 'queued', stateLabel: 'Geplant', meta: 0 },
    ] });
    expect(ctrl.el.tagName).toBe('OL');
    expect(ctrl.el.getAttribute('aria-label')).toBe('Construction');
    expect(ctrl.el.children).toHaveLength(4);
    expect(ctrl.el.querySelector('[aria-current="step"] .wm-timeline-title').textContent).toBe('Build');
    expect(ctrl.el.querySelector('img')).toBeNull();
    expect(ctrl.el.querySelectorAll('.wm-timeline-meta')[3].textContent).toBe('0');
    expect(ctrl.el.querySelectorAll('.wm-timeline-meta')[2].hidden).toBe(true);
    expect(ctrl.el.querySelector('.wm-timeline-title').textContent).toBe('<Complete>');
  });

  it('retains keyed timeline content, drafts and focus on status changes and reordering', () => {
    const input = document.createElement('input');
    input.value = '27';
    const render = vi.fn(el => el.appendChild(input));
    const item = { id: 'one', title: 'Order', state: 'active', stateLabel: 'Active', content: render };
    const other = { id: 'two', title: 'Other', state: 'queued', stateLabel: 'Queued' };
    const ctrl = mount('timeline', { ariaLabel: 'Orders', items: [item, other] });
    const row = ctrl.el.firstChild;
    input.focus();
    ctrl.setItems([other, { ...item, state: 'complete', stateLabel: 'Complete' }]);
    expect(ctrl.el.lastChild).toBe(row);
    expect(row.hasAttribute('aria-current')).toBe(false);
    expect(render).toHaveBeenCalledOnce();
    expect(input.value).toBe('27');
    expect(document.activeElement).toBe(input);
    ctrl.setItems([other]);
    expect(document.activeElement).toBe(ctrl.el);
    expect(input.isConnected).toBe(false);
    ctrl.setItems([]);
    expect(ctrl.el.children).toHaveLength(0);
  });

  it('validates timeline updates before mutating rows and propagates renderer failures', () => {
    const item = { id: 'one', title: 'Order', state: 'queued', stateLabel: 'Queued', content: 'Original' };
    const ctrl = mount('timeline', { ariaLabel: 'Orders', items: [item] });
    for (const invalid of [{ ...item, state: 'unknown' }, { ...item, stateLabel: '' }, { ...item, title: '' }]) {
      expect(() => ctrl.setItems([invalid])).toThrow();
      expect(ctrl.el.textContent).toContain('Original');
    }
    expect(() => ctrl.setItems([item, item])).toThrow('unique');
    expect(() => ctrl.setItems([{ ...item, content: () => { throw new Error('render failed'); } }])).toThrow('render failed');
    expect(ctrl.el.textContent).toContain('Original');
    expect(() => mount('timeline', {})).toThrow('label');
  });

  it('renders a semantic table with explicit missing values and text-safe cells', () => {
    const ctrl = mount('dataTable', {
      caption: 'Resources', emptyValue: 'Unknown',
      columns: [{ id: 'name', label: 'Name' }, { id: 'amount', label: 'Amount', numeric: true }],
      items: [{ name: '<img src=x>', amount: 0 }, { name: 'Other', amount: null }],
    });
    expect(ctrl.el.querySelector('caption').textContent).toBe('Resources');
    expect(ctrl.el.getAttribute('aria-labelledby')).toBe(ctrl.el.querySelector('caption').id);
    expect(ctrl.el.querySelectorAll('th[scope="col"]')).toHaveLength(2);
    expect([...ctrl.el.querySelectorAll('td')].map(el => el.textContent)).toEqual(['<img src=x>', '0', 'Other', 'Unknown']);
    expect(ctrl.el.querySelector('img')).toBeNull();
    expect(ctrl.el.querySelector('td.is-numeric').textContent).toBe('0');
    ctrl.setItems([]);
    expect(ctrl.el.querySelector('td').colSpan).toBe(2);
    expect(ctrl.el.querySelector('.wm-table-empty').textContent).toBe('No entries');
    expect(() => mount('dataTable', { caption: 'Empty' })).toThrow('columns');
    expect(() => mount('dataTable', { caption: 'Duplicate', columns: [{ id: 1 }, { id: '1' }] })).toThrow('unique');
    expect(() => mount('dataTable', {})).toThrow('caption');
  });

  it('supports explicit table row headings without making ordinary cells headings', () => {
    const ctrl = mount('dataTable', {
      caption: 'Stock', columns: [{ id: 'name', rowHeader: true }, { id: 'amount', numeric: true }],
      items: [{ name: 'Metal', amount: 0 }],
    });
    expect(ctrl.el.querySelector('tbody th').getAttribute('scope')).toBe('row');
    expect(ctrl.el.querySelector('thead th').classList.contains('wm-table-row-heading')).toBe(true);
    expect(ctrl.el.querySelectorAll('.wm-table-row-heading')).toHaveLength(1);
    expect(ctrl.el.querySelector('tbody th').textContent).toBe('Metal');
    expect(ctrl.el.querySelector('tbody td').textContent).toBe('0');
  });
  it('sorts table rows stably without recreating controls or mutating input data', () => {
    const inputs = new Map();
    const items = [{ name: 'First', amount: 5 }, { name: 'Second', amount: 2 }, { name: 'Third', amount: 5 }];
    const ctrl = mount('dataTable', { caption: 'Inventory', columns: [
      { id: 'name' },
      { id: 'amount', compare: (a, b) => a.amount - b.amount, value: item => item.amount },
      { id: 'draft', render: (cell, item) => {
        const input = document.createElement('input');
        input.value = '27';
        inputs.set(item.name, input);
        cell.appendChild(input);
      } },
    ], items });
    const input = inputs.get('First');
    input.focus();
    ctrl.setSort('amount', 'ascending');
    expect([...ctrl.el.querySelectorAll('tbody tr')].map(row => row.firstChild.textContent)).toEqual(['Second', 'First', 'Third']);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('27');
    expect(items.map(item => item.name)).toEqual(['First', 'Second', 'Third']);
    ctrl.el.querySelector('th button').click();
    expect(ctrl.el.querySelector('[aria-sort]').getAttribute('aria-sort')).toBe('descending');
    expect([...ctrl.el.querySelectorAll('tbody tr')].map(row => row.firstChild.textContent)).toEqual(['First', 'Third', 'Second']);
    ctrl.setItems([{ name: 'New', amount: 0 }]);
    expect(ctrl.el.querySelector('tbody tr').firstChild.textContent).toBe('New');
    expect(ctrl.el.querySelector('[aria-sort]').getAttribute('aria-sort')).toBe('descending');
  });

  it('rejects invalid table sorting and failed rendering without discarding existing rows', () => {
    const ctrl = mount('dataTable', { caption: 'Table', columns: [
      { id: 'value', compare: () => NaN, value: item => {
        if (item.fail) throw new Error('render failed');
        return item.value;
      } },
      { id: 'other' },
    ], items: [{ value: 1 }, { value: 2 }] });
    expect(() => ctrl.setSort('value', 'ascending')).toThrow('finite');
    expect(ctrl.el.querySelector('[aria-sort]').getAttribute('aria-sort')).toBe('none');
    expect(() => ctrl.setSort('other', 'ascending')).toThrow('not sortable');
    expect(() => ctrl.setSort('value', 'invalid')).toThrow('direction');
    expect(() => ctrl.setItems([{ fail: true }])).toThrow('render failed');
    expect(ctrl.el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(ctrl.el.querySelector('td').textContent).toBe('1');
  });

  it('sorts the entire finite numeric range without overflow and keeps missing values last', () => {
    const items = [
      { name: 'Maximum', amount: Number.MAX_VALUE },
      { name: 'Missing', amount: null },
      { name: 'Minimum', amount: -Number.MAX_VALUE },
      { name: 'Zero', amount: 0 },
      { name: 'Maximum again', amount: Number.MAX_VALUE },
      { name: 'Not finite', amount: Infinity },
    ];
    const ctrl = mount('dataTable', { caption: 'Numeric range',
      columns: [{ id: 'name' }, { id: 'amount', numeric: true, sortable: true }], items,
    });
    const names = () => [...ctrl.el.querySelectorAll('tbody tr')].map(row => row.firstChild.textContent);
    ctrl.setSort('amount', 'ascending');
    expect(names()).toEqual(['Minimum', 'Zero', 'Maximum', 'Maximum again', 'Missing', 'Not finite']);
    ctrl.setSort('amount', 'descending');
    expect(names()).toEqual(['Maximum', 'Maximum again', 'Zero', 'Minimum', 'Missing', 'Not finite']);
    ctrl.setSort(null);
    expect(names()).toEqual(items.map(item => item.name));
  });
  it.each(['render', 'search', 'filter', 'compare'])('preserves active table state and focused drafts after a failed %s update', (stage) => {
    const changed = vi.fn();
    const failure = new Error(`${stage} failed`);
    function validate(item, current) {
      if (item.fail && stage === current) throw failure;
      return item.name;
    }
    const ctrl = mount('dataTable', { caption: 'Failed refresh', searchable: true, onStateChange: changed,
      columns: [
        { id: 'name', value: item => validate(item, 'render'),
          searchValue: item => validate(item, 'search'),
          filter: { options: [{ value: 'A' }], value: item => validate(item, 'filter') },
          compare: (a, b) => {
            validate(a, 'compare');
            validate(b, 'compare');
            return a.name.localeCompare(b.name);
          } },
        { id: 'draft', render: cell => cell.append(document.createElement('input')) },
      ], items: [{ name: 'A' }, { name: 'B' }],
      state: { query: 'A', filters: { name: 'A' }, sort: { id: 'name', direction: 'descending' } },
    });
    const rows = [...ctrl.el.querySelectorAll('tbody tr')];
    const draft = ctrl.el.querySelector('tbody tr:not([hidden]) input');
    draft.value = '2.5';
    draft.focus();
    draft.setSelectionRange(1, 2);
    const state = ctrl.getState();
    const markup = ctrl.el.innerHTML;
    expect(() => ctrl.setItems([{ name: 'A' }, { name: 'B', fail: true }])).toThrow(failure);
    expect(ctrl.getState()).toEqual(state);
    expect(ctrl.el.innerHTML).toBe(markup);
    expect([...ctrl.el.querySelectorAll('tbody tr')]).toEqual(rows);
    expect(document.activeElement).toBe(draft);
    expect([draft.value, draft.selectionStart, draft.selectionEnd]).toEqual(['2.5', 1, 2]);
    expect(changed).not.toHaveBeenCalled();
    ctrl.setItems([{ name: 'A' }, { name: 'C' }]);
    expect(ctrl.getState()).toEqual(state);
    expect(ctrl.el.querySelector('.wm-table-result').textContent).toBe('1 of 2 entries');
    expect(document.activeElement).toBe(ctrl.el);
  });
  it('integrates search/reset/count in a toolbar and each filter with its sortable column header', () => {
    const ctrl = mount('dataTable', { caption: 'Stock', searchable: true, labels: { toolbar: 'Stock tools' },
      columns: [{ id: 'name', sortable: true }, { id: 'amount', numeric: true, sortable: true,
        filter: { label: 'Stock filter', options: [{ value: 'zero' }], value: () => 'zero' } }],
      items: [{ name: 'Metal', amount: 0 }],
    });
    const tools = ctrl.el.querySelector('[role="toolbar"]');
    expect(tools.getAttribute('aria-label')).toBe('Stock tools');
    expect(tools.querySelector('input').placeholder).toBe('Search table');
    const searchGroup = tools.querySelector('.wm-table-search');
    expect(searchGroup.querySelector('input')).toBe(tools.querySelector('input'));
    expect(searchGroup.querySelector('[data-table-control="clear-search"]')).not.toBeNull();
    expect(searchGroup.querySelector('label').htmlFor).toBe(tools.querySelector('input').id);
    expect(tools.querySelector('select')).toBeNull();
    expect(tools.querySelector('[role="status"]').textContent).toBe('1 of 1 entries');
    const header = ctrl.el.querySelectorAll('thead th')[1];
    const filter = header.querySelector('select');
    expect(filter.getAttribute('aria-label')).toBe('Stock filter');
    expect(header.querySelector(`label[for="${filter.id}"]`)).not.toBeNull();
    filter.value = 'zero';
    filter.dispatchEvent(new Event('change'));
    expect(header.getAttribute('aria-sort')).toBe('none');
    header.querySelector('button').click();
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(filter.value).toBe('zero');
    tools.querySelector(':scope > button').click();
    expect(filter.value).toBe('');
    expect(header.getAttribute('aria-sort')).toBe('none');
  });
  it('clears search and individual filter chips independently while retaining sort, drafts and focus', () => {
    const ctrl = mount('dataTable', { caption: 'Stock', searchable: true,
      columns: [
        { id: 'name', sortable: true, filter: { options: [{ value: 'Metal' }] } },
        { id: 'amount', filter: { options: [{ value: '0' }] } },
      ], items: [{ name: 'Metal', amount: 0 }],
    });
    ctrl.setSort('name', 'descending');
    ctrl.setFilter('name', 'Metal');
    ctrl.setFilter('amount', '0');
    ctrl.setSearch('Metal');
    const search = ctrl.el.querySelector('input');
    const clear = ctrl.el.querySelector('.wm-table-search-actions button');
    clear.click();
    expect(ctrl.getState()).toEqual({ query: '', filters: { name: 'Metal', amount: '0' },
      sort: { id: 'name', direction: 'descending' } });
    expect(document.activeElement).toBe(search);
    expect(clear.disabled).toBe(true);
    const chips = [...ctrl.el.querySelectorAll('.wm-table-active-filters button')];
    expect(chips[0].getAttribute('aria-label')).toBe('Remove filter: name: Metal');
    expect(ctrl.el.querySelectorAll('thead th.has-filter')).toHaveLength(2);
    chips[0].focus();
    chips[0].click();
    expect(document.activeElement).toBe(search);
    expect(chips[0].hidden).toBe(true);
    expect(chips[1].hidden).toBe(false);
    expect(ctrl.getState().filters).toEqual({ amount: '0' });
    expect(ctrl.getState().sort.direction).toBe('descending');
    ctrl.reset();
    expect(chips.every(chip => chip.hidden)).toBe(true);
    expect(ctrl.el.querySelector('thead .has-filter')).toBeNull();
    const changed = vi.fn();
    const remount = mount('dataTable', { caption: 'Restored', onStateChange: changed,
      columns: [{ id: 'name', filter: { options: [{ value: 'Metal' }] } }],
      items: [{ name: 'Metal' }], state: { filters: { name: 'Metal' } },
    });
    const chip = remount.el.querySelector('.wm-table-active-filters button');
    expect(chip.hidden).toBe(false);
    chip.focus();
    chip.click();
    expect(document.activeElement).toBe(remount.el.querySelector('select'));
    remount.destroy();
    changed.mockClear();
    chip.click();
    expect(changed).not.toHaveBeenCalled();
  });
  it('shows and clears sorting independently in the toolbar without losing search, filters or row drafts', () => {
    const ctrl = mount('dataTable', { caption: 'Stock', searchable: true,
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'Metal' }] } },
        { id: 'draft', render: cell => { cell.append(document.createElement('input')); } }],
      items: [{ name: 'Metal' }, { name: 'Other' }],
      state: { query: 'Metal', filters: { name: 'Metal' }, sort: { id: 'name', direction: 'descending' } },
    });
    const chip = ctrl.el.querySelector('.wm-table-sort-chip');
    const draft = ctrl.el.querySelector('tbody tr:not([hidden]) input');
    draft.value = '2.5';
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toContain('name (descending)');
    ctrl.setSort('name', 'ascending');
    expect(chip.textContent).toContain('name (ascending)');
    chip.focus();
    chip.click();
    expect(ctrl.getState()).toEqual({ query: 'Metal', filters: { name: 'Metal' }, sort: null });
    expect(chip.hidden).toBe(true);
    expect(document.activeElement).toBe(ctrl.el.querySelector('input[type="search"]'));
    expect(ctrl.el.querySelector('tbody input')).toBe(draft);
    expect(draft.value).toBe('2.5');
    expect(ctrl.el.querySelector('[aria-sort]').getAttribute('aria-sort')).toBe('none');
    expect(ctrl.el.querySelector('.wm-table-active-filters').hidden).toBe(false);
    ctrl.reset();
    expect(ctrl.el.querySelector('.wm-table-active-filters').hidden).toBe(true);
    chip.click();
    expect(ctrl.getState().sort).toBeNull();
  });
  it('supports a sort-only toolbar with header focus restoration and detached control cleanup', () => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'Sort only', onStateChange: changed,
      columns: [{ id: 'name', sortable: true }], items: [{ name: 'B' }, { name: 'A' }],
    });
    const tools = ctrl.el.querySelector('[role="toolbar"]');
    expect(tools).not.toBeNull();
    const header = ctrl.el.querySelector('thead button');
    header.click();
    const chip = tools.querySelector('.wm-table-sort-chip');
    expect(chip.hidden).toBe(false);
    chip.focus();
    chip.click();
    expect(document.activeElement).toBe(header);
    expect([...ctrl.el.querySelectorAll('tbody tr')].map(row => row.textContent)).toEqual(['B', 'A']);
    header.click();
    tools.querySelector(':scope > button').focus();
    tools.querySelector(':scope > button').click();
    expect(document.activeElement).toBe(ctrl.el);
    ctrl.destroy();
    changed.mockClear();
    chip.click();
    expect(changed).not.toHaveBeenCalled();
  });
  it('moves focus from toolbar actions invalidated through the table API before notifying callers', () => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'API focus', searchable: true, onStateChange: changed,
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'A' }] } }],
      items: [{ name: 'A' }],
    });
    const search = ctrl.el.querySelector('input[type="search"]');
    const cases = [
      ['clear-search', () => ctrl.setSearch('A'), () => ctrl.setSearch('')],
      ['clear-filter:name', () => ctrl.setFilter('name', 'A'), () => ctrl.setFilter('name', '')],
      ['clear-sort', () => ctrl.setSort('name', 'ascending'), () => ctrl.setSort(null)],
      ['reset', () => ctrl.setSearch('A'), () => ctrl.reset()],
    ];
    for (const [role, activate, clear] of cases) {
      activate();
      ctrl.el.querySelector(`[data-table-control="${role}"]`).focus();
      changed.mockImplementation(() => expect(document.activeElement).toBe(search));
      clear();
      expect(document.activeElement).toBe(search);
      changed.mockReset();
    }
  });
  it('uses the corresponding header control when API changes hide focused chips without search', () => {
    const ctrl = mount('dataTable', { caption: 'Header focus',
      columns: [
        { id: 'first', sortable: true, filter: { options: [{ value: 'A' }] } },
        { id: 'second', sortable: true, filter: { options: [{ value: 'B' }] } },
      ], items: [{ first: 'A', second: 'B' }],
    });
    ctrl.setFilter('second', 'B');
    ctrl.el.querySelector('[data-table-control="clear-filter:second"]').focus();
    ctrl.reset();
    expect(document.activeElement).toBe(ctrl.el.querySelector('[data-table-control="filter:second"]'));
    ctrl.setSort('second', 'ascending');
    ctrl.el.querySelector('[data-table-control="clear-sort"]').focus();
    ctrl.reset();
    expect(document.activeElement).toBe(ctrl.el.querySelector('[data-table-control="sort:second"]'));
  });
  it('does not steal external focus or move focus from toolbar actions that remain available', () => {
    const ctrl = mount('dataTable', { caption: 'Stable focus', searchable: true,
      columns: [{ id: 'name', sortable: true }], items: [{ name: 'A' }],
    });
    ctrl.setSort('name', 'ascending');
    const chip = ctrl.el.querySelector('[data-table-control="clear-sort"]');
    chip.focus();
    ctrl.setSort('name', 'descending');
    expect(document.activeElement).toBe(chip);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    ctrl.reset();
    expect(document.activeElement).toBe(outside);
  });
  it.each(['clear-search', 'reset'])('keeps focus changes made by the %s state callback', (role) => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'Callback focus', searchable: true, onStateChange: changed,
      columns: [{ id: 'name', sortable: true }], items: [{ name: 'A' }],
    });
    const outside = document.createElement('button');
    outside.textContent = 'Application action';
    document.body.append(outside);
    ctrl.setSearch('A');
    const search = ctrl.el.querySelector('input[type="search"]');
    changed.mockImplementation(() => {
      expect(document.activeElement).toBe(search);
      outside.focus();
    });
    const button = ctrl.el.querySelector(`[data-table-control="${role}"]`);
    button.focus();
    button.click();
    expect(document.activeElement).toBe(outside);
    expect(ctrl.getState().query).toBe('');
  });
  it('navigates toolbar actions while skipping inactive chips and preserving native search keys', () => {
    const ctrl = mount('dataTable', { caption: 'Keys', searchable: true,
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'A' }] } }],
      items: [{ name: 'A' }], state: { query: 'A', sort: { id: 'name', direction: 'ascending' } },
    });
    const tools = ctrl.el.querySelector('[role="toolbar"]');
    const search = tools.querySelector('input');
    const clear = tools.querySelector('.wm-table-search-actions button');
    const reset = tools.querySelector(':scope > button');
    const chip = tools.querySelector('.wm-table-sort-chip');
    reset.focus();
    key(reset, 'ArrowRight');
    expect(document.activeElement).toBe(chip);
    key(chip, 'ArrowRight');
    expect(document.activeElement).toBe(search);
    key(search, 'ArrowRight');
    expect(document.activeElement).toBe(search);
    key(clear, 'End');
    expect(document.activeElement).toBe(chip);
    key(chip, 'Home');
    expect(document.activeElement).toBe(search);
    ctrl.setSearch('');
    reset.focus();
    key(reset, 'ArrowLeft');
    expect(document.activeElement).toBe(search);
    tools.style.direction = 'rtl';
    reset.focus();
    key(reset, 'ArrowLeft');
    expect(document.activeElement).toBe(chip);
    const modified = new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true, cancelable: true });
    chip.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(chip);
    const select = ctrl.el.querySelector('thead select');
    select.focus();
    key(select, 'ArrowRight');
    expect(document.activeElement).toBe(select);
    ctrl.destroy();
    const detached = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
    chip.dispatchEvent(detached);
    expect(detached.defaultPrevented).toBe(false);
  });
  it('clears only the search with Escape, leaving IME, modifier shortcuts and empty Escape untouched', () => {
    const ctrl = mount('dataTable', { caption: 'Escape', searchable: true,
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'A' }] } }],
      items: [{ name: 'A' }],
      state: { query: 'A', filters: { name: 'A' }, sort: { id: 'name', direction: 'ascending' } },
    });
    const input = ctrl.el.querySelector('input');
    input.focus();
    for (const options of [{ isComposing: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...options });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(ctrl.getState().query).toBe('A');
    }
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(ctrl.getState()).toEqual({ query: '', filters: { name: 'A' }, sort: { id: 'name', direction: 'ascending' } });
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    const empty = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
  });
  it('cycles header sorting through ascending, descending and source order with next-action descriptions', () => {
    const ctrl = mount('dataTable', { caption: 'Cycle', searchable: true,
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'A' }] } },
        { id: 'amount', numeric: true, sortable: true }],
      items: [{ name: 'B', amount: 10 }, { name: 'A', amount: 2 }],
    });
    const headers = ctrl.el.querySelectorAll('thead th');
    const button = headers[0].querySelector('button');
    const description = () => document.getElementById(button.getAttribute('aria-describedby')).textContent;
    expect(description()).toBe('Sort name: ascending');
    ctrl.setSearch('A');
    ctrl.setFilter('name', 'A');
    button.focus();
    button.click();
    expect(headers[0].getAttribute('aria-sort')).toBe('ascending');
    expect(description()).toBe('Sort name: descending');
    button.click();
    expect(headers[0].getAttribute('aria-sort')).toBe('descending');
    expect(description()).toBe('Remove sorting');
    expect(button.title).toBe(description());
    button.click();
    expect(headers[0].getAttribute('aria-sort')).toBe('none');
    expect(ctrl.getState()).toEqual({ query: 'A', filters: { name: 'A' }, sort: null });
    expect([...ctrl.el.querySelectorAll('tbody tr')].map(row => row.firstChild.textContent)).toEqual(['B', 'A']);
    expect(document.activeElement).toBe(button);
    expect(ctrl.el.querySelector('.wm-table-sort-chip').hidden).toBe(true);
    button.click();
    headers[1].querySelector('button').click();
    expect(ctrl.getState().sort).toEqual({ id: 'amount', direction: 'ascending' });
    expect(description()).toBe('Sort name: ascending');
  });
  it('combines cached accent-insensitive token search and multiple exact column filters without rebuilding rows', () => {
    const render = vi.fn((cell, item) => { cell.textContent = item.name; });
    const changed = vi.fn();
    const ctrl = mount('dataTable', {
      caption: 'Catalog', searchable: true, onStateChange: changed,
      columns: [
        { id: 'name', render },
        { id: 'category', filter: { options: [{ value: 'ore', label: 'Ore' }, { value: 'food', label: 'Food' }] } },
        { id: 'stock', numeric: true, filter: {
          options: [{ value: 'zero', label: 'Empty' }, { value: 'positive', label: 'Available' }],
          value: item => item.stock === 0 ? 'zero' : 'positive',
        } },
      ],
      items: [
        { name: 'Métal rare', category: 'ore', stock: 0 },
        { name: 'Metal common', category: 'ore', stock: 2 },
        { name: '<img src=x>', category: 'food', stock: 0 },
      ],
    });
    const visible = () => [...ctrl.el.querySelectorAll('tbody tr:not([hidden])')].filter(row => !row.querySelector('.wm-table-empty'));
    const first = visible()[0];
    const search = ctrl.el.querySelector('input[type="search"]');
    expect(ctrl.el.querySelector(`label[for="${search.id}"]`).textContent).toBe('Search table');
    search.value = 'RARE   metal';
    search.dispatchEvent(new Event('input'));
    expect(visible()).toEqual([first]);
    expect(ctrl.el.querySelector('[role="status"]').textContent).toBe('1 of 3 entries');
    ctrl.setFilter('category', 'ore');
    ctrl.setFilter('stock', 'positive');
    expect(visible()).toHaveLength(0);
    expect(ctrl.el.querySelector('.wm-table-empty-message').textContent).toBe('No matching entries');
    ctrl.setSearch('metal');
    expect(visible()[0].textContent).toContain('Metal common');
    ctrl.reset();
    expect(visible()).toHaveLength(3);
    expect(visible()[0]).toBe(first);
    expect(render).toHaveBeenCalledTimes(3);
    expect(ctrl.el.querySelector('img')).toBeNull();
    expect(changed).toHaveBeenCalledTimes(5);
    expect(ctrl.getState()).toEqual({ query: '', filters: {}, sort: null });
  });

  it('offers localized no-match recovery without rebuilding drafts or overriding callback focus', () => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'Recovery', searchable: true, onStateChange: changed,
      labels: { noMatches: 'Keine Treffer', reset: 'Zurücksetzen' },
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'A' }] } },
        { id: 'draft', render: cell => cell.append(document.createElement('input')) }],
      items: [{ name: 'B' }, { name: 'A' }],
    });
    const draft = ctrl.el.querySelector('tbody input');
    draft.value = '2.5';
    const rows = [...ctrl.el.querySelectorAll('tbody tr')];
    ctrl.setSort('name', 'ascending');
    ctrl.setFilter('name', 'A');
    ctrl.setSearch('Missing');
    const reset = ctrl.el.querySelector('[data-table-control="empty-reset"]');
    expect(reset.textContent).toBe('Zurücksetzen');
    expect(reset.type).toBe('button');
    expect(reset.parentElement.className).toBe('wm-table-empty-content');
    expect(reset.parentElement.querySelector('.wm-table-empty-message')).not.toBeNull();
    expect(reset.closest('td').colSpan).toBe(2);
    expect(ctrl.el.querySelector('.wm-table-empty-message').textContent).toBe('Keine Treffer');
    const outside = document.createElement('button');
    document.body.append(outside);
    changed.mockImplementation(() => {
      expect(document.activeElement).toBe(ctrl.el.querySelector('input[type="search"]'));
      outside.focus();
    });
    reset.focus();
    reset.click();
    expect(ctrl.getState()).toEqual({ query: '', filters: {}, sort: null });
    expect([...ctrl.el.querySelectorAll('tbody tr')]).toEqual(rows);
    expect(draft.value).toBe('2.5');
    expect(ctrl.el.querySelector('.wm-table-empty')).toBeNull();
    expect(document.activeElement).toBe(outside);
    ctrl.destroy();
    changed.mockClear();
    reset.click();
    expect(changed).not.toHaveBeenCalled();
  });
  it('keeps focus visible when data refresh replaces a focused no-match recovery action', () => {
    const ctrl = mount('dataTable', { caption: 'Recovery refresh', searchable: true,
      columns: [{ id: 'name' }], items: [{ name: 'A' }], state: { query: 'B' },
    });
    ctrl.el.querySelector('[data-table-control="empty-reset"]').focus();
    ctrl.setItems([{ name: 'B' }]);
    expect(ctrl.el.querySelector('.wm-table-empty')).toBeNull();
    expect(document.activeElement).toBe(ctrl.el);
    ctrl.setSearch('Missing');
    ctrl.el.querySelector('[data-table-control="empty-reset"]').focus();
    ctrl.setItems([]);
    expect(ctrl.el.querySelector('[data-table-control="empty-reset"]')).toBeNull();
    expect(ctrl.el.querySelector('.wm-table-empty-message').textContent).toBe('No entries');
    expect(document.activeElement).toBe(ctrl.el);
  });
  it('returns no-match recovery focus to its header filter when search is unavailable', () => {
    const ctrl = mount('dataTable', { caption: 'Filter recovery',
      columns: [{ id: 'name', filter: { options: [{ value: 'B' }] } }],
      items: [{ name: 'A' }], state: { filters: { name: 'B' } },
    });
    const reset = ctrl.el.querySelector('[data-table-control="empty-reset"]');
    reset.focus();
    reset.click();
    expect(document.activeElement).toBe(ctrl.el.querySelector('select'));
    expect(ctrl.getState().filters).toEqual({});
    expect(ctrl.el.querySelector('tbody tr').hidden).toBe(false);
  });
  it('sorts raw numeric and natural text values stably, always putting unknown numbers last', () => {
    const ctrl = mount('dataTable', { caption: 'Amounts', searchable: true,
      columns: [{ id: 'name', sortable: true }, { id: 'amount', sortable: true, numeric: true,
        value: item => item.amount == null ? '—' : `${item.amount} units`, sortValue: item => item.amount }],
      items: [{ name: 'Ship 10', amount: 10 }, { name: 'Ship 2', amount: 2 },
        { name: 'First unknown' }, { name: 'Second unknown', amount: NaN }, { name: 'Zero', amount: 0 }],
    });
    const names = () => [...ctrl.el.querySelectorAll('tbody tr')].map(row => row.firstChild.textContent);
    ctrl.setSort('name', 'ascending');
    expect(names().indexOf('Ship 2')).toBeLessThan(names().indexOf('Ship 10'));
    ctrl.setSort('amount', 'ascending');
    expect(names()).toEqual(['Zero', 'Ship 2', 'Ship 10', 'First unknown', 'Second unknown']);
    ctrl.setSort('amount', 'descending');
    expect(names()).toEqual(['Ship 10', 'Ship 2', 'Zero', 'First unknown', 'Second unknown']);
    ctrl.setSearch('ship');
    expect([...ctrl.el.querySelectorAll('tbody tr:not([hidden])')].map(row => row.firstChild.textContent)).toEqual(['Ship 10', 'Ship 2']);
    ctrl.setSearch('');
    ctrl.setSort(null);
    expect(names()).toEqual(['Ship 10', 'Ship 2', 'First unknown', 'Second unknown', 'Zero']);
  });

  it('preserves row drafts, selection state and focused controls during local search/sort and restores state on remount', () => {
    const opts = { caption: 'Drafts', searchable: true, columns: [
      { id: 'name', sortable: true, filter: { options: [{ value: 'A' }, { value: 'B' }] } },
      { id: 'draft', searchable: false, render: cell => {
        const input = document.createElement('input');
        input.value = '27';
        cell.append(input);
      } },
    ], items: [{ name: 'A' }, { name: 'B' }] };
    const ctrl = mount('dataTable', opts);
    const draft = ctrl.el.querySelector('tbody input');
    draft.value = '2.5';
    draft.focus();
    ctrl.setSort('name', 'descending');
    ctrl.setFilter('name', 'A');
    expect(document.activeElement).toBe(draft);
    ctrl.setSearch('B');
    expect(document.activeElement).toBe(ctrl.el);
    ctrl.setSearch('a');
    expect(ctrl.el.querySelector('tbody input')).not.toBe(draft);
    expect(draft.value).toBe('2.5');
    const state = ctrl.getState();
    const copy = ctrl.getState();
    copy.filters.name = 'B';
    copy.sort.direction = 'ascending';
    expect(ctrl.getState()).toEqual(state);
    ctrl.setItems([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    expect(ctrl.getState()).toEqual(state);
    const remount = mount('dataTable', { ...opts, state });
    expect(remount.getState()).toEqual(state);
    expect(remount.el.querySelector('input[type="search"]').value).toBe('a');
    expect(remount.el.querySelector('select').value).toBe('A');
    expect(remount.el.querySelector('[aria-sort]').getAttribute('aria-sort')).toBe('descending');
  });

  it('validates filters atomically and ignores detached controls after destroy', () => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'Safe filters', searchable: true, onStateChange: changed,
      columns: [{ id: 'name', sortable: true, filter: { options: [{ value: 'A' }] } }], items: [{ name: 'A' }],
    });
    expect(() => ctrl.setFilter('missing', 'A')).toThrow('Unknown table filter');
    expect(() => ctrl.setFilter('name', 'B')).toThrow('Unknown table filter value');
    expect(ctrl.getState().filters).toEqual({});
    expect(() => mount('dataTable', { caption: 'Bad', columns: [{ id: 'name',
      filter: { options: [{ value: '' }] } }] })).toThrow('nonempty');
    expect(() => mount('dataTable', { caption: 'Bad', columns: [{ id: 'name',
      filter: { options: [{ value: 'A' }, { value: 'A' }] } }] })).toThrow('unique');
    const search = ctrl.el.querySelector('input');
    search.value = 'composing';
    search.dispatchEvent(new InputEvent('input', { isComposing: true }));
    expect(ctrl.getState().query).toBe('');
    search.dispatchEvent(new CompositionEvent('compositionend'));
    expect(ctrl.getState().query).toBe('composing');
    const button = ctrl.el.querySelector('th button');
    ctrl.destroy();
    changed.mockClear();
    search.dispatchEvent(new Event('input'));
    button.click();
    expect(changed).not.toHaveBeenCalled();
  });

  it('skips repeated table state changes without resorting, mutating rows or notifying callers', () => {
    const changed = vi.fn();
    const compare = vi.fn((a, b) => a.name.localeCompare(b.name));
    const ctrl = mount('dataTable', { caption: 'Repeated state', searchable: true, onStateChange: changed,
      columns: [{ id: 'name', compare, filter: { options: [{ value: 'A' }] } }],
      items: [{ name: 'B' }, { name: 'A' }],
      state: { query: 'A', filters: { name: 'A' }, sort: { id: 'name', direction: 'ascending' } },
    });
    const input = ctrl.el.querySelector('input');
    input.focus();
    input.setSelectionRange(0, 1);
    const observer = new MutationObserver(() => {});
    observer.observe(ctrl.el, { subtree: true, attributes: true, childList: true, characterData: true });
    try {
      compare.mockClear();
      ctrl.setSearch('A');
      ctrl.setFilter('name', 'A');
      ctrl.setSort('name', 'ascending');
      expect(changed).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
      expect(observer.takeRecords()).toEqual([]);
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
      ctrl.reset();
      expect(changed).toHaveBeenCalledOnce();
      observer.takeRecords();
      changed.mockClear();
      ctrl.setSearch(null);
      ctrl.setFilter('name', null);
      ctrl.setSort(null);
      ctrl.reset();
      expect(changed).not.toHaveBeenCalled();
      expect(observer.takeRecords()).toEqual([]);
      expect(() => ctrl.setSort('name', 'invalid')).toThrow('direction');
      expect(() => ctrl.setFilter('missing', '')).toThrow('Unknown table filter');
    } finally {
      observer.disconnect();
    }
  });
  it('notifies once when compositionend is followed by the same final input event', () => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'Composition', searchable: true, onStateChange: changed,
      columns: [{ id: 'name' }], items: [{ name: 'Metal' }],
    });
    const input = ctrl.el.querySelector('input');
    input.value = 'Metal';
    input.dispatchEvent(new InputEvent('input', { isComposing: true }));
    expect(changed).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent('compositionend'));
    input.dispatchEvent(new InputEvent('input', { isComposing: false }));
    expect(changed).toHaveBeenCalledExactlyOnceWith({ query: 'Metal', filters: {}, sort: null });
    input.value = 'Other';
    input.dispatchEvent(new InputEvent('input'));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(ctrl.el.querySelector('.wm-table-result').textContent).toBe('0 of 1 entries');
  });
  it('restores native controls on no-op setters and reset without reporting a state change', () => {
    const changed = vi.fn();
    const ctrl = mount('dataTable', { caption: 'Native controls', searchable: true, onStateChange: changed,
      columns: [{ id: 'name', filter: { options: [{ value: 'A' }] } }], items: [{ name: 'A' }],
    });
    const input = ctrl.el.querySelector('input');
    const select = ctrl.el.querySelector('select');
    input.value = 'Uncommitted';
    select.value = 'A';
    ctrl.setSearch('');
    ctrl.setFilter('name', '');
    expect(input.value).toBe('');
    expect(select.value).toBe('');
    input.value = 'Uncommitted again';
    select.value = 'A';
    ctrl.reset();
    expect(input.value).toBe('');
    expect(select.value).toBe('');
    expect(changed).not.toHaveBeenCalled();
  });
  it('filters a large catalog using cached search values without rerendering cells or resorting', () => {
    const searchValue = vi.fn(item => item.name);
    const compare = vi.fn((a, b) => a.id - b.id);
    const ctrl = mount('dataTable', { caption: 'Catalog', searchable: true,
      columns: [{ id: 'name', searchValue, compare }],
      items: Array.from({ length: 1000 }, (_, id) => ({ id, name: `Item ${id}` })),
    });
    ctrl.setSort('name', 'descending');
    compare.mockClear();
    for (const query of ['item', 'item 99', 'item 999', 'unmatched']) ctrl.setSearch(query);
    expect(searchValue).toHaveBeenCalledTimes(1000);
    expect(compare).not.toHaveBeenCalled();
    expect(ctrl.el.querySelector('[role="status"]').textContent).toBe('0 of 1000 entries');
    ctrl.reset();
    expect(ctrl.el.querySelectorAll('tbody tr:not([hidden])')).toHaveLength(1000);
  });

  it('links fields to existing labels/descriptions and updates errors without replacing drafts', () => {
    const input = document.createElement('input');
    input.id = 'quantity';
    input.value = '27';
    input.required = true;
    input.setAttribute('aria-describedby', 'existing-help');
    const ctrl = mount('field', { label: 'Quantity', control: input, help: 'Whole units' });
    input.focus();
    ctrl.setError('<Invalid>');
    expect(ctrl.el.querySelector('label').htmlFor).toBe('quantity');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedIds = input.getAttribute('aria-describedby').split(' ');
    expect(describedIds).toContain('existing-help');
    expect(describedIds).toContain(ctrl.el.querySelector('.wm-field-help').id);
    expect(describedIds).toContain(ctrl.el.querySelector('.wm-field-error').id);
    expect(ctrl.el.querySelector('.wm-field-error').textContent).toBe('<Invalid>');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('27');
    expect(input.required).toBe(true);
    ctrl.setError('');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(ctrl.el.querySelector('.wm-field-error').hidden).toBe(true);
    ctrl.destroy();
    ctrl.destroy();
    expect(input.getAttribute('aria-describedby')).toBe('existing-help');
    expect(input.id).toBe('quantity');
    expect(input.value).toBe('27');
  });

  it('generates unique field IDs and restores original accessibility attributes on destruction', () => {
    const a = document.createElement('select');
    const b = document.createElement('textarea');
    a.setAttribute('aria-invalid', 'grammar');
    const first = mount('field', { label: 'Destination', control: a, error: 'Choose destination' });
    const second = mount('field', { label: 'Notes', control: b });
    expect(a.id).not.toBe(b.id);
    first.setError(null);
    expect(a.getAttribute('aria-invalid')).toBe('grammar');
    first.destroy();
    expect(a.hasAttribute('id')).toBe(false);
    expect(a.hasAttribute('aria-describedby')).toBe(false);
    second.destroy();
    expect(b.hasAttribute('id')).toBe(false);
    expect(() => mount('field', { label: 'Invalid', control: document.createElement('div') })).toThrow('native');
    expect(() => mount('field', { control: document.createElement('input') })).toThrow('label');
  });

  it('groups native controls responsively and applies a complete validated error map', () => {
    const input = document.createElement('input');
    input.value = 'draft';
    const select = document.createElement('select');
    const ctrl = mount('formLayout', { legend: 'Order', fields: [
      { id: 'quantity', label: 'Quantity', control: input },
      { id: 'constructor', label: 'Destination', control: select },
    ] });
    expect(ctrl.el.tagName).toBe('FIELDSET');
    expect(ctrl.el.querySelector('legend').textContent).toBe('Order');
    input.focus();
    ctrl.setErrors({ quantity: 'Too many' });
    expect(ctrl.getField('quantity').control).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(select.hasAttribute('aria-invalid')).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('draft');
    expect(() => ctrl.setErrors({ quantity: '', unknown: 'Wrong' })).toThrow('Unknown form field');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    ctrl.setErrors({});
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    ctrl.destroy();
    expect(input.hasAttribute('id')).toBe(false);
  });

  it('rejects duplicate form fields/controls and cleans up fields if later construction fails', () => {
    const a = document.createElement('input');
    expect(() => mount('formLayout', { legend: 'Order', fields: [
      { id: 'a', label: 'A', control: a }, { id: 'a', label: 'B', control: document.createElement('input') },
    ] })).toThrow('unique');
    expect(() => mount('formLayout', { legend: 'Order', fields: [
      { id: 'a', label: 'A', control: a }, { id: 'b', label: 'B', control: a },
    ] })).toThrow('unique');
    expect(() => mount('formLayout', { legend: 'Order', fields: [
      { id: 'a', label: 'A', control: a }, { id: 'b', control: document.createElement('input') },
    ] })).toThrow('label');
    expect(a.hasAttribute('id')).toBe(false);
    expect(document.querySelector('.wm-form-layout')).toBeNull();
    expect(() => mount('formLayout', {})).toThrow('legend');
  });

  it('renders breadcrumb actions with only the final item marked current and retains focus on updates', () => {
    const onSelect = vi.fn();
    const items = [{ id: 'galaxy', label: '<Galaxy>' }, { id: 'system', label: 'System', disabled: true }, { id: 'colony', label: 'Colony' }];
    const path = mount('breadcrumbs', { items, onSelect, ariaLabel: 'Position' });
    const buttons = path.el.querySelectorAll('button');
    expect(path.el.getAttribute('aria-label')).toBe('Position');
    expect(path.el.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(path.el.querySelector('[aria-current]').tagName).toBe('SPAN');
    expect(buttons[0].textContent).toBe('<Galaxy>');
    expect(path.el.querySelector('galaxy')).toBeNull();
    buttons[0].click();
    buttons[1].click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[0]);
    buttons[0].focus();
    path.setItems(items.slice(0, 1));
    expect(document.activeElement).toBe(path.el.querySelector('[aria-current]'));
    expect(() => path.setItems([{ id: 1 }, { id: '1' }])).toThrow('unique');
    expect(path.el.querySelectorAll('li')).toHaveLength(1);
    path.setItems([]);
    expect(path.el.querySelectorAll('li')).toHaveLength(0);
    expect(document.activeElement).toBe(path.el);
  });

  it('exposes an optional breadcrumb region through managed frames and destroys it on replacement', () => {
    WM.register('path', { layout: { breadcrumbs: { items: [{ id: 'home', label: 'Home' }] } } });
    WM.open('path');
    const first = WM.layout('path');
    expect(first.breadcrumbs.el.closest('.wm-frame-breadcrumbs')).not.toBeNull();
    WM.layout('path', {});
    expect(first.breadcrumbs.el.isConnected).toBe(false);
    expect(WM.layout('path').breadcrumbs).toBeUndefined();
  });

  it('represents measured zero, complete and explicitly unknown progress without timers', () => {
    const ctrl = mount('progress', { label: 'Construction', value: 0, max: 40, text: '0 / 40' });
    const meter = ctrl.el.querySelector('progress');
    expect(meter.value).toBe(0);
    expect(meter.hasAttribute('value')).toBe(true);
    expect(meter.max).toBe(40);
    expect(ctrl.el.querySelector('label').htmlFor).toBe(meter.id);
    expect(document.getElementById(meter.getAttribute('aria-describedby')).textContent).toBe('0 / 40');
    ctrl.set({ value: 40, text: 'Complete' });
    expect(meter.position).toBe(1);
    ctrl.set({ value: null, text: 'Waiting for server' });
    expect(meter.hasAttribute('value')).toBe(false);
    expect(meter.position).toBe(-1);
    ctrl.set({ value: 12, text: '' });
    expect(meter.value).toBe(12);
    expect(ctrl.el.querySelector('.wm-progress-text').hidden).toBe(true);
    const second = mount('progress', { label: 'Other' });
    expect(second.el.querySelector('progress').id).not.toBe(meter.id);
  });

  it('rejects invalid progress atomically rather than clamping or inventing a measurement', () => {
    const ctrl = mount('progress', { label: 'Energy', value: 20 });
    for (const next of [{ value: -1 }, { value: 101 }, { value: NaN }, { value: Infinity }, { value: undefined }, { max: 0 }, { max: 10 }, { label: '' }]) {
      expect(() => ctrl.set(next)).toThrow();
      expect(ctrl.el.querySelector('progress').value).toBe(20);
      expect(ctrl.el.querySelector('progress').max).toBe(100);
    }
    expect(() => mount('progress', {})).toThrow('label');
  });

  it('provides explicit empty/loading/error notices and preserves retry focus on text updates', () => {
    const retry = vi.fn();
    const ctrl = mount('notice', { title: 'No entries', live: 'polite' });
    expect(ctrl.el.dataset.state).toBe('empty');
    expect(ctrl.el.querySelector('.wm-notice-copy').getAttribute('aria-live')).toBe('polite');
    ctrl.set({ state: 'error', title: '<Unavailable>', message: '<img src=x>', actions: [{ label: 'Retry', onClick: retry }, { label: 'Locked', disabled: true }] });
    const button = ctrl.el.querySelector('button');
    button.focus();
    button.click();
    ctrl.el.querySelectorAll('button')[1].click();
    expect(retry).toHaveBeenCalledOnce();
    ctrl.set({ state: 'loading', title: 'Reading server data' });
    expect(ctrl.el.querySelector('button')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(ctrl.el.querySelector('img')).toBeNull();
    ctrl.set({ actions: [] });
    expect(document.activeElement).toBe(ctrl.el.querySelector('h3'));
    expect(ctrl.el.querySelector('.wm-notice-actions').hidden).toBe(true);
    expect(() => ctrl.set({ state: 'unrecognised' })).toThrow('state');
    expect(ctrl.el.dataset.state).toBe('loading');
    expect(() => mount('notice', {})).toThrow('title');
  });

  it('makes notice announcements opt-in and does not announce action controls', () => {
    const ctrl = mount('notice', { state: 'info', title: 'Details', actions: [{ label: 'Open' }] });
    expect(ctrl.el.querySelector('[aria-live]').getAttribute('aria-live')).toBe('off');
    expect(ctrl.el.querySelector('[aria-live]').contains(ctrl.el.querySelector('button'))).toBe(false);
    for (const state of ['success', 'warning', 'empty', 'error', 'loading']) {
      ctrl.set({ state });
      expect(ctrl.el.dataset.state).toBe(state);
    }
  });

  it('renders semantic property details, retains zero and preserves other fields during updates', () => {
    const input = document.createElement('input');
    input.value = 'draft';
    const ctrl = mount('properties', { emptyText: 'Unbekannt', items: [
      { id: 'amount', label: 'Amount', value: 0 },
      { id: 'unknown', label: 'Unknown', value: null },
      { id: 'draft', label: 'Quantity', value: input },
    ] });
    expect(ctrl.el.tagName).toBe('DL');
    expect([...ctrl.el.querySelectorAll('dd')].map(el => el.textContent)).toEqual(['0', 'Unbekannt', '']);
    input.focus();
    ctrl.setValue('amount', '<img src=x>');
    expect(ctrl.el.querySelector('dd').textContent).toBe('<img src=x>');
    expect(ctrl.el.querySelector('img')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('draft');
    expect(() => ctrl.setValue('missing', 0)).toThrow('Unknown property');
    expect(() => ctrl.setItems([{ id: 'same' }, { id: 'same' }])).toThrow('unique');
    expect(input.isConnected).toBe(true);
    ctrl.setItems([{ id: 'new', value: el => { el.textContent = 'Rendered'; } }]);
    expect(ctrl.el.querySelector('dd').textContent).toBe('Rendered');
    expect(() => ctrl.setValue('amount', 1)).toThrow('Unknown property');
  });

  it('propagates property renderer errors without replacing an existing details list', () => {
    const ctrl = mount('properties', { items: [{ id: 'a', value: 'Original' }] });
    expect(() => ctrl.setItems([{ id: 'b', value: () => { throw new Error('render failed'); } }])).toThrow('render failed');
    expect(ctrl.el.querySelector('dd').textContent).toBe('Original');
    expect(() => ctrl.setValue('a', () => { throw new Error('update failed'); })).toThrow('update failed');
    expect(ctrl.el.querySelector('dd').textContent).toBe('Original');
    ctrl.setValue('a', 'Still usable');
    expect(ctrl.el.textContent).toContain('Still usable');
  });

  it('composes stable vertical and wrapping horizontal stacks without rebuilding input nodes', () => {
    const input = document.createElement('input');
    input.value = '27';
    const ctrl = mount('stack', { items: [input], gap: 0 });
    input.focus();
    const appended = ctrl.append('<Card>');
    expect(ctrl.el.dataset.direction).toBe('vertical');
    expect(ctrl.el.style.getPropertyValue('--wm-stack-gap')).toBe('0px');
    expect(appended.textContent).toBe('<Card>');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('27');
    const row = mount('stack', { direction: 'horizontal', items: [el => { el.textContent = 'One'; }, 'Two'] });
    expect(row.el.dataset.wrap).toBe('true');
    expect(row.el.children).toHaveLength(2);
    const nowrap = mount('stack', { direction: 'horizontal', wrap: false });
    expect(nowrap.el.dataset.wrap).toBe('false');
    for (const opts of [{ direction: 'invalid' }, { gap: -1 }, { gap: NaN }]) {
      expect(() => mount('stack', opts)).toThrow();
    }
    expect(() => ctrl.append(() => { throw new Error('failed'); })).toThrow('failed');
    expect(ctrl.el.children).toHaveLength(2);
  });

  it('composes all standard regions and cleans up a managed layout on close', () => {
    const render = vi.fn((content) => { content.textContent = 'Content'; });
    WM.register('standard', {
      title: 'Standard', w: 600, h: 400,
      layout: {
        menuBar: { items: [{ label: 'File', items: [{ label: 'Save' }] }] },
        toolbar: { groups: [{ items: [{ id: 'refresh', label: 'Refresh' }] }] },
        sidebar: { items: [{ id: 'colony', label: 'Colony', badge: 0 }] },
        badges: [{ text: 'Read only', tone: 'info' }],
        statusBar: { segments: [{ id: 'state', text: 'Ready' }] },
      },
      onRender: render,
    });
    WM.open('standard');
    const frame = WM.layout('standard');
    expect(render).toHaveBeenLastCalledWith(frame.content, frame);
    expect(frame.content.textContent).toBe('Content');
    expect(frame.el.querySelector('[role="menubar"]')).not.toBeNull();
    expect(frame.el.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(frame.el.querySelector('.wm-sidebar')).not.toBeNull();
    expect(frame.el.querySelector('[role="status"]').textContent).toBe('Ready');
    expect(frame.badges[0].el.textContent).toBe('Read only');
    expect(WM.body('standard').classList.contains('wm-body-framed')).toBe(true);
    expect(WM.body('standard').style.overflow).toBe('hidden');
    WM.minimize('standard');
    WM.restore('standard');
    expect(WM.layout('standard')).toBe(frame);
    expect(render).toHaveBeenCalledOnce();
    WM.close('standard');
    expect(frame.el.isConnected).toBe(false);
    expect(() => WM.layout('standard')).toThrow('closed window');
  });

  it('preserves an adopted frame on close/reopen and safely replaces an explicit layout', () => {
    const host = document.createElement('div');
    host.id = 'adopted-widget-host';
    host.innerHTML = '<section class="wm-adaptable-window"><div class="wm-body"></div></section>';
    document.body.appendChild(host);
    WM.adopt('adopted', { sectionId: host.id, w: 500, h: 350, layout: {} });
    const first = WM.layout('adopted');
    const input = document.createElement('input');
    input.value = 'draft';
    first.content.appendChild(input);
    WM.close('adopted');
    WM.open('adopted');
    expect(WM.layout('adopted')).toBe(first);
    expect(input.value).toBe('draft');
    const second = WM.layout('adopted', { statusBar: { segments: [{ text: 'New layout' }] } });
    first.destroy();
    expect(WM.layout('adopted')).toBe(second);
    expect(WM.body('adopted').classList.contains('wm-body-framed')).toBe(true);
    expect(first.el.isConnected).toBe(false);
  });

  it('renders badges and sidebar labels as text and updates selection without rebuilding drafts', () => {
    const onSelect = vi.fn();
    const ctrl = mount('sidebar', { items: [
      { id: 'first', label: '<img src=x>', badge: 0 },
      { id: 'disabled', label: 'Locked', disabled: true },
      { id: 'last', label: 'Last' },
    ], onSelect });
    const buttons = ctrl.el.querySelectorAll('button');
    expect(ctrl.el.querySelector('img')).toBeNull();
    expect(ctrl.el.querySelector('.wm-badge').textContent).toBe('0');
    expect(buttons[0].getAttribute('aria-current')).toBe('page');
    buttons[0].focus();
    key(buttons[0], 'ArrowDown');
    expect(document.activeElement).toBe(buttons[2]);
    buttons[2].click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'last' }));
    expect(buttons[2].getAttribute('aria-current')).toBe('page');
    expect(() => ctrl.setActive('disabled')).toThrow('unavailable');
    const badge = mount('badge', { text: 0, tone: 'info' });
    badge.set('<svg>', 'warning');
    expect(badge.el.textContent).toBe('<svg>');
    expect(badge.el.querySelector('svg')).toBeNull();
    expect(badge.el.dataset.tone).toBe('warning');
    expect(() => badge.set('x', 'unknown')).toThrow('tone');
  });

  it('provides a responsive cards layout using the existing card factory', () => {
    const clicked = vi.fn();
    const cards = mount('cards', { minCardWidth: 240, items: [
      { title: 'One', body: 'First', actions: [{ label: 'Select', onClick: clicked }] },
      { title: 'Two', body: (el) => { el.textContent = 'Second'; } },
    ] });
    expect(cards.el.style.getPropertyValue('--wm-card-min-width')).toBe('240px');
    expect(cards.el.querySelectorAll('.wm-card')).toHaveLength(2);
    cards.el.querySelector('button').click();
    expect(clicked).toHaveBeenCalledOnce();
    cards.setItems([{ title: 'Replacement' }]);
    expect(cards.el.querySelectorAll('.wm-card')).toHaveLength(1);
    expect(cards.el.textContent).toContain('Replacement');
  });

  it('switches tabs using a roving focus and retains lazily rendered input nodes', () => {
    let input;
    const render = vi.fn((el) => {
      input = document.createElement('input');
      input.value = 'draft';
      el.appendChild(input);
    });
    const tabs = mount('tabs', { tabs: [
      { id: 'a', label: 'A', render },
      { id: 'b', label: 'B', render: (el) => { el.textContent = 'B content'; } },
    ] });
    const [a, b] = tabs.el.querySelectorAll('[role="tab"]');
    expect(document.getElementById(a.getAttribute('aria-controls')).getAttribute('aria-labelledby')).toBe(a.id);
    a.focus();
    key(a, 'ArrowRight');
    expect(document.activeElement).toBe(b);
    expect(b.tabIndex).toBe(0);
    expect(document.getElementById(a.getAttribute('aria-controls')).hidden).toBe(true);
    key(b, 'Home');
    expect(document.activeElement).toBe(a);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('draft');
    expect(render).toHaveBeenCalledOnce();
    tabs.removeTab('a');
    expect(document.activeElement).toBe(b);
    tabs.addTab({ id: 'c', label: 'C' });
    expect(new Set([...tabs.el.querySelectorAll('[role="tab"]')].map((node) => node.id)).size).toBe(2);
  });

  it('gives independent tab instances unique IDs and falls back from an unavailable active tab', () => {
    const one = mount('tabs', { activeTab: 'missing', tabs: [{ id: 'a', label: 'A' }] });
    const two = mount('tabs', { tabs: [{ id: 'a', label: 'A' }] });
    expect(one.el.querySelector('[role="tab"]').getAttribute('aria-selected')).toBe('true');
    expect(one.el.querySelector('[role="tab"]').id).not.toBe(two.el.querySelector('[role="tab"]').id);
  });

  it('hides collapsed accordion contents from focus and supports heading keyboard navigation', () => {
    const accordion = mount('accordion', { singleExpand: true, items: [
      { header: 'A', expanded: true, content: 'A content' },
      { header: 'B', expanded: true, content: 'B content' },
    ] });
    const [a, b] = accordion.el.querySelectorAll('.wm-accordion-header');
    const panels = accordion.el.querySelectorAll('[role="region"]');
    expect(panels[0].hidden).toBe(false);
    expect(panels[1].hidden).toBe(true);
    a.focus();
    key(a, 'ArrowDown');
    expect(document.activeElement).toBe(b);
    b.click();
    expect(panels[0].hidden).toBe(true);
    expect(panels[1].hidden).toBe(false);
    expect(b.getAttribute('aria-controls')).toBe(panels[1].id);
    expect(panels[1].getAttribute('aria-labelledby')).toBe(b.id);
  });

  it('opens menu/submenus through the shared popup engine and restores the menubar focus', () => {
    const clicked = vi.fn();
    const menu = mount('menu', { items: [
      { label: 'File', items: [{ label: 'More', items: [{ label: 'Save', onClick: clicked }] }] },
      { label: 'Locked', disabled: true },
      { label: 'Help', onClick: clicked },
    ] });
    const [file, , help] = menu.el.querySelectorAll('button');
    file.focus();
    key(file, 'ArrowRight');
    expect(document.activeElement).toBe(help);
    key(help, 'Home');
    key(file, 'ArrowDown');
    expect(file.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement.textContent).toBe('More');
    key(document.activeElement, 'ArrowRight');
    expect(document.activeElement.textContent).toBe('Save');
    key(document.activeElement, 'Enter');
    expect(clicked).toHaveBeenCalledOnce();
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(file);
  });

  it('supports split-button keyboard menus and disabled primary actions', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    const split = mount('splitButton', {
      primaryAction: { label: 'Primary', disabled: true, onClick: primary },
      actions: [{ label: 'Locked', disabled: true }, { label: 'Secondary', onClick: secondary }],
    });
    const main = split.el.querySelector('.wm-split-btn-main');
    const arrow = split.el.querySelector('.wm-split-btn-arrow');
    main.click();
    expect(primary).not.toHaveBeenCalled();
    arrow.focus();
    key(arrow, 'ArrowDown');
    expect(arrow.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement.textContent).toBe('Secondary');
    document.activeElement.click();
    expect(secondary).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(arrow);
    key(arrow, 'ArrowDown');
    key(document.activeElement, 'Escape');
    expect(arrow.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles an already open menubar popup with a second native pointer click', () => {
    const menu = mount('menu', { items: [{ label: 'File', items: [{ label: 'Save' }] }] });
    const file = menu.el.querySelector('button');
    file.click();
    expect(file.getAttribute('aria-expanded')).toBe('true');
    file.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    file.click();
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.wm-context-menu')).toHaveLength(0);
  });

  it('keeps standalone menu/submenu behavior and listener cleanup without a global window manager', () => {
    delete window.WM;
    const clicked = vi.fn();
    const menu = mount('menu', { items: [
      { label: 'File', items: [{ label: 'More', items: [{ label: 'Save', onClick: clicked }] }] },
    ] });
    const file = menu.el.querySelector('button');
    file.click();
    key(document.activeElement, 'ArrowRight');
    expect(document.activeElement.textContent).toBe('Save');
    key(document.activeElement, 'Enter');
    expect(clicked).toHaveBeenCalledOnce();
    expect(file.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.wm-context-menu-inline')).toHaveLength(0);
    expect(document.activeElement).toBe(file);
    window.WM = WM;
  });

  it('updates status segments including the existing footer API and arbitrary IDs', () => {
    const status = mount('statusBar', { live: 'polite', items: [{ id: 'state"]', text: 'Ready' }] });
    status.setItemText('state"]', 'Updated');
    expect(status.el.textContent).toBe('Updated');
    expect(status.el.getAttribute('aria-live')).toBe('polite');
    status.setSegments([{ id: 'next', text: 'Next' }]);
    status.set('next', 'Done');
    expect(status.el.textContent).toBe('Done');
  });

  it('keeps toolbar toggle state and destroys split-button document listeners on rerender', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const toolbar = mount('toolbar', { groups: [{ items: [
      { id: 'toggle', type: 'toggle', label: 'Toggle' },
      { id: 'split', type: 'split', label: 'Split', items: [{ label: 'Child' }] },
    ] }] });
    const toggle = toolbar.el.querySelector('.wm-tool-btn');
    toggle.click();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    toolbar.setActive('toggle', false);
    expect(toolbar.el.querySelector('.wm-tool-btn').getAttribute('aria-pressed')).toBe('false');
    expect(remove.mock.calls.some(([name]) => name === 'mousedown')).toBe(true);
    remove.mockRestore();
  });

  it('propagates render errors and rolls back an incomplete frame', () => {
    const container = document.getElementById('widgets');
    const fail = () => { throw new Error('render failed'); };
    expect(() => widgets.frame(container, { statusBar: { segments: [] }, render: fail })).toThrow('render failed');
    expect(container.children).toHaveLength(0);
    expect(container.classList.contains('wm-body-framed')).toBe(false);
    expect(() => widgets.tabs(container, { tabs: [{ id: 'failed', render: fail }] })).toThrow('render failed');
    expect(() => widgets.card(container, { body: fail })).toThrow('render failed');
  });
});
