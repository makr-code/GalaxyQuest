/**
 * WMWidgets – Shared window components and layouts for WMCore
 *
 * Standalone DOM-widget factories. No dependency on WMCore internals;
 * works with any HTMLElement container.
 * Wired into WM instances by gqwm.js:  WM.widgets.*
 *
 * Widgets
 * -------
 *   WMWidgets.accordion(container, opts)   → AccordionView
 *   WMWidgets.tree(container, opts)        → TreeView
 *   WMWidgets.list(container, opts)        → ListView
 *   WMWidgets.tabs(container, opts)        → TabView
 *   WMWidgets.frame(container, opts)       → Standard window regions
 *   WMWidgets.sidebar(container, opts)     → Navigation sidebar
 *   WMWidgets.badge(container, opts)       → Text/status badge
 *   WMWidgets.cards(container, opts)       → Responsive CardView grid
 *   WMWidgets.breadcrumbs(container, opts) → Context navigation
 *   WMWidgets.progress(container, opts)    → Measured/indeterminate progress
 *   WMWidgets.notice(container, opts)      → Empty/loading/error states
 *   WMWidgets.properties(container, opts)  → Label/value details layout
 *   WMWidgets.stack(container, opts)       → Vertical/horizontal wrapping layout
 *   WMWidgets.dataTable(container, opts)   → Searchable, filterable, sortable data table
 *   WMWidgets.field(container, opts)       → Labelled native form control
 *   WMWidgets.formLayout(container, opts)  → Responsive field group
 *   WMWidgets.pagination(container, opts)  → Controlled list navigation
 *   WMWidgets.timeline(container, opts)    → Keyed sequence/status layout
 *
 * All factories return a controller object with at least:
 *   { el, destroy() }
 *
 * AccordionView
 * -------------
 *   opts.items[]
 *     .header   (string)
 *     .content  (string html | HTMLElement | fn(el))
 *     .expanded (boolean, default false)
 *     .onExpand / .onCollapse  (callbacks)
 *   opts.singleExpand (boolean) – collapse others when one opens
 *
 *   ctrl.expand(i)   ctrl.collapse(i)   ctrl.toggle(i)   ctrl.destroy()
 *
 * TreeView
 * --------
 *   opts.nodes[]
 *     .id        (string, required)
 *     .label     (string)
 *     .icon      (string, emoji/text)
 *     .meta      (string, right-aligned info)
 *     .expanded  (boolean)
 *     .disabled  (boolean)
 *     .children  (nodes[], recursive)
 *   opts.selectedId   (string)
 *   opts.onSelect     (fn(node))
 *   opts.onExpand     (fn(node))
 *   opts.onCollapse   (fn(node))
 *
 *   ctrl.select(id)   ctrl.expand(id)   ctrl.collapse(id)
 *   ctrl.toggle(id)   ctrl.reload(nodes)   ctrl.destroy()
 *
 * ListView
 * --------
 *   opts.items[]                           – data array
 *   opts.renderItem(item, el, idx)         – populate each row element
 *   opts.onSelect(item, idx)               – selection callback
 *   opts.onContextMenu(item, idx, ev)      – right-click callback
 *   opts.keyField     (string)             – unique key field name
 *   opts.multiSelect  (boolean)            – allow multi-select
 *
 *   ctrl.setItems(items)   ctrl.getSelected()   ctrl.refresh()   ctrl.destroy()
 *
 * TabView
 * -------
 *   opts.tabs[]
 *     .id      (string, required)
 *     .label   (string)
 *     .icon    (string, optional emoji/text)
 *     .render  (fn(paneEl), lazy – called once on first activation)
 *   opts.activeTab  (string, default first tab)
 *   opts.onChange   (fn(id))
 *
 *   ctrl.setActive(id)   ctrl.addTab(cfg)   ctrl.removeTab(id)   ctrl.destroy()
 *
 * CardView
 * --------
 *   opts.title     (string)
 *   opts.subtitle  (string, optional)
 *   opts.body      (string html | HTMLElement | fn(el))
 *   opts.actions[] (.label, .onClick, .primary, .danger, .disabled)
 *   opts.image     (string url, optional hero image)
 *   opts.onClick   (fn) – make whole card clickable
 *   opts.elevated  (boolean, default true)
 *   opts.outlined  (boolean) – border only, no shadow
 *
 *   ctrl.setTitle(title)   ctrl.setBody(body)   ctrl.destroy()
 *
 * ChipGroup
 * ---------
 *   opts.chips[]  (.id, .label, .icon, .selected, .disabled)
 *   opts.multiSelect   (boolean) – default single-select (radio)
 *   opts.onChange(selectedIds[])
 *
 *   ctrl.select(id)   ctrl.deselect(id)   ctrl.getSelected()   ctrl.setChips(chips)   ctrl.destroy()
 *
 * BottomSheet
 * -----------
 *   No container parameter – appends to context_menu_container or body.
 *   opts.title     (string, optional)
 *   opts.content   (string html | HTMLElement | fn(el))
 *   opts.height    (number px, default auto)
 *   opts.scrollable (boolean, default true)
 *   opts.backdrop  (boolean, default true)
 *   opts.onClose   (fn)
 *
 *   ctrl.open()   ctrl.close()   ctrl.destroy()
 *
 * SplitView
 * ---------
 *   opts.direction  ('horizontal' | 'vertical', default 'horizontal')
 *   opts.ratio      (0..1, default 0.35) – initial pane-A fraction
 *   opts.minA / .minB  (px, default 120) – minimum pane sizes
 *   opts.onResize   (fn(ratio))
 *
 *   ctrl.paneA   ctrl.paneB   (HTMLElements to populate)
 *   ctrl.setRatio(r)   ctrl.destroy()
 *
 * MasterDetail
 * ------------
 *   opts.masterWidth  (px | string, default 260)
 *   opts.breakpoint   (px, default 600) – below: stack + toggle panels
 *   opts.defaultView  ('master' | 'detail', default 'master')
 *   opts.renderMaster (fn(el))
 *   opts.renderDetail (fn(el))
 *
 *   ctrl.master / .detail   (HTMLElements)
 *   ctrl.showDetail()   ctrl.showMaster()   ctrl.destroy()
 */
const WMWidgets = (() => {
  let _nextId = 0;

  // ── Shared utilities ────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _guard(container, name) {
    if (!(container instanceof HTMLElement)) {
      if (typeof console !== 'undefined') {
        console.warn('WMWidgets.' + name + ': container is not an HTMLElement');
      }
      return false;
    }
    return true;
  }

  function _appendContent(target, content) {
    if (!(target instanceof HTMLElement)) return;
    if (content == null) return;
    if (typeof content === 'function') {
      content(target);
      return;
    }
    if (content instanceof HTMLElement) {
      target.appendChild(content);
      return;
    }
    if (Array.isArray(content)) {
      content.forEach(function (item) { _appendContent(target, item); });
      return;
    }
    target.textContent = String(content);
  }

  function _clearEl(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  function _el(tag, cfg) {
    var node = document.createElement(tag);
    cfg = cfg || {};
    if (cfg.className) node.className = String(cfg.className);
    if (cfg.attrs && typeof cfg.attrs === 'object') {
      Object.keys(cfg.attrs).forEach(function (k) {
        if (cfg.attrs[k] == null) return;
        node.setAttribute(k, String(cfg.attrs[k]));
      });
    }
    if (cfg.dataset && typeof cfg.dataset === 'object') {
      Object.keys(cfg.dataset).forEach(function (k) {
        if (cfg.dataset[k] == null) return;
        node.dataset[k] = String(cfg.dataset[k]);
      });
    }
    if (cfg.text != null) node.textContent = String(cfg.text);
    if (cfg.children != null) _appendContent(node, cfg.children);
    return node;
  }

  // ── AccordionView ───────────────────────────────────────────────────────────
  function accordion(container, opts) {
    if (!_guard(container, 'accordion')) return null;
    opts = opts || {};

    var items        = Array.isArray(opts.items) ? opts.items : [];
    var singleExpand = !!opts.singleExpand;
    var widgetId = 'wm-accordion-' + (++_nextId);
    var expandedFound = false;

    var el = document.createElement('div');
    el.className = 'wm-accordion';

    var itemEls = items.map(function (item, idx) {
      var expanded = !!item.expanded && (!singleExpand || !expandedFound);
      if (expanded) expandedFound = true;
      var itemEl = document.createElement('div');
      itemEl.className = 'wm-accordion-item' + (expanded ? ' is-open' : '');

      var headerBtn = document.createElement('button');
      headerBtn.type      = 'button';
      headerBtn.className = 'wm-accordion-header';
      headerBtn.id = widgetId + '-header-' + idx;
      headerBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      headerBtn.setAttribute('aria-controls', widgetId + '-panel-' + idx);
      headerBtn.innerHTML =
        '<span class="wm-accordion-title">' + _esc(String(item.header != null ? item.header : '')) + '</span>' +
        '<span class="wm-accordion-chevron" aria-hidden="true"></span>';

      var bodyEl = document.createElement('div');
      bodyEl.className = 'wm-accordion-body';
      bodyEl.id = widgetId + '-panel-' + idx;
      bodyEl.setAttribute('role', 'region');
      bodyEl.setAttribute('aria-labelledby', headerBtn.id);
      bodyEl.hidden = !expanded;

      var innerEl = document.createElement('div');
      innerEl.className = 'wm-accordion-body-inner';

      if (typeof item.content === 'function') {
        item.content(innerEl);
      } else if (item.content instanceof HTMLElement) {
        innerEl.appendChild(item.content);
      } else if (item.content != null) {
        innerEl.innerHTML = String(item.content);
      }

      bodyEl.appendChild(innerEl);
      itemEl.appendChild(headerBtn);
      itemEl.appendChild(bodyEl);
      el.appendChild(itemEl);

      (function (i) {
        headerBtn.addEventListener('click', function () { toggle(i); });
        headerBtn.addEventListener('keydown', function (event) {
          var target;
          if (event.key === 'ArrowDown') target = (i + 1) % items.length;
          else if (event.key === 'ArrowUp') target = (i + items.length - 1) % items.length;
          else if (event.key === 'Home') target = 0;
          else if (event.key === 'End') target = items.length - 1;
          if (target !== undefined) {
            event.preventDefault();
            itemEls[target].querySelector('.wm-accordion-header').focus();
          }
        });
      })(idx);

      return itemEl;
    });

    container.appendChild(el);

    function expand(i) {
      if (i < 0 || i >= itemEls.length) return;
      if (singleExpand) {
        itemEls.forEach(function (iel, j) {
          if (j !== i) {
            iel.classList.remove('is-open');
            var h = iel.querySelector('.wm-accordion-header');
            if (h) h.setAttribute('aria-expanded', 'false');
            var panel = iel.querySelector('.wm-accordion-body');
            if (panel.contains(document.activeElement)) itemEls[i].querySelector('.wm-accordion-header').focus();
            panel.hidden = true;
          }
        });
      }
      itemEls[i].classList.add('is-open');
      var hdr = itemEls[i].querySelector('.wm-accordion-header');
      if (hdr) hdr.setAttribute('aria-expanded', 'true');
      itemEls[i].querySelector('.wm-accordion-body').hidden = false;
      var cb = items[i] && items[i].onExpand;
      if (typeof cb === 'function') cb(items[i]);
    }

    function collapse(i) {
      if (i < 0 || i >= itemEls.length) return;
      itemEls[i].classList.remove('is-open');
      var hdr = itemEls[i].querySelector('.wm-accordion-header');
      if (hdr) hdr.setAttribute('aria-expanded', 'false');
      var panel = itemEls[i].querySelector('.wm-accordion-body');
      if (panel.contains(document.activeElement)) hdr.focus();
      panel.hidden = true;
      var cb = items[i] && items[i].onCollapse;
      if (typeof cb === 'function') cb(items[i]);
    }

    function toggle(i) {
      if (i >= 0 && i < itemEls.length) {
        if (itemEls[i].classList.contains('is-open')) collapse(i); else expand(i);
      }
    }

    function destroy() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, expand: expand, collapse: collapse, toggle: toggle, destroy: destroy };
  }

  // ── TreeView ────────────────────────────────────────────────────────────────
  function tree(container, opts) {
    if (!_guard(container, 'tree')) return null;
    opts = opts || {};

    var nodes      = Array.isArray(opts.nodes) ? opts.nodes : [];
    var onSelect   = typeof opts.onSelect   === 'function' ? opts.onSelect   : null;
    var onExpand   = typeof opts.onExpand   === 'function' ? opts.onExpand   : null;
    var onCollapse = typeof opts.onCollapse === 'function' ? opts.onCollapse : null;

    var _selectedId = String(opts.selectedId != null ? opts.selectedId : '');
    var _nodeMap    = Object.create(null);

    var el = document.createElement('div');
    el.className = 'wm-tree';
    el.setAttribute('role', 'tree');

    function _buildList(nodeList, depth) {
      var ul = document.createElement('ul');
      ul.className = 'wm-tree-list' + (depth > 0 ? ' wm-tree-children' : '');
      ul.setAttribute('role', depth === 0 ? 'tree' : 'group');

      nodeList.forEach(function (node) {
        var id          = String(node.id != null ? node.id : '');
        var hasChildren = Array.isArray(node.children) && node.children.length > 0;

        var li = document.createElement('li');
        li.className =
          'wm-tree-node'
          + (hasChildren   ? ' has-children' : '')
          + (node.expanded ? ' is-expanded'  : '')
          + (node.disabled ? ' is-disabled'  : '');
        li.setAttribute('role', 'treeitem');
        li.setAttribute('aria-expanded', hasChildren ? (node.expanded ? 'true' : 'false') : 'undefined');

        var headEl = document.createElement('div');
        headEl.className = 'wm-tree-node-head' + (id === _selectedId ? ' is-selected' : '');

        // Indent spacer for visual depth
        var indent = document.createElement('span');
        indent.className = 'wm-tree-indent';
        indent.style.width = (depth * 16) + 'px';
        indent.setAttribute('aria-hidden', 'true');

        var toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'wm-tree-toggle';
        toggleBtn.setAttribute('tabindex', '-1');
        toggleBtn.disabled = !hasChildren;
        if (hasChildren) toggleBtn.innerHTML = '<span class="wm-tree-toggle-icon"></span>';

        var iconEl = document.createElement('span');
        iconEl.className = 'wm-tree-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        if (node.icon != null) iconEl.textContent = String(node.icon);

        var labelEl = document.createElement('span');
        labelEl.className   = 'wm-tree-label';
        labelEl.textContent = String(node.label != null ? node.label : (node.id != null ? node.id : ''));

        headEl.appendChild(indent);
        headEl.appendChild(toggleBtn);
        headEl.appendChild(iconEl);
        headEl.appendChild(labelEl);

        if (node.meta != null) {
          var metaEl = document.createElement('span');
          metaEl.className   = 'wm-tree-meta';
          metaEl.textContent = String(node.meta);
          headEl.appendChild(metaEl);
        }

        var childListEl = null;
        if (hasChildren) {
          childListEl = _buildList(node.children, depth + 1);
          childListEl.hidden = !node.expanded;
        }

        (function (nodeRef, liRef, childRef) {
          toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!hasChildren) return;
            var expanding = !liRef.classList.contains('is-expanded');
            liRef.classList.toggle('is-expanded', expanding);
            liRef.setAttribute('aria-expanded', expanding ? 'true' : 'false');
            if (childRef) childRef.hidden = !expanding;
            if (expanding  && onExpand)   onExpand(nodeRef);
            if (!expanding && onCollapse) onCollapse(nodeRef);
          });

          headEl.addEventListener('click', function (e) {
            if (e.target === toggleBtn || toggleBtn.contains(e.target)) return;
            if (nodeRef.disabled) return;
            el.querySelectorAll('.wm-tree-node-head.is-selected').forEach(function (h) {
              h.classList.remove('is-selected');
            });
            headEl.classList.add('is-selected');
            _selectedId = id;
            if (onSelect) onSelect(nodeRef);
          });
        })(node, li, childListEl);

        li.appendChild(headEl);
        if (childListEl) li.appendChild(childListEl);
        ul.appendChild(li);

        _nodeMap[id] = { node: node, liEl: li, headEl: headEl, childListEl: childListEl };
      });

      return ul;
    }

    function _render(nodeList) {
      el.innerHTML = '';
      _nodeMap = Object.create(null);
      el.appendChild(_buildList(nodeList, 0));
    }

    _render(nodes);
    container.appendChild(el);

    function select(id) {
      var sid = String(id != null ? id : '');
      el.querySelectorAll('.wm-tree-node-head.is-selected').forEach(function (h) {
        h.classList.remove('is-selected');
      });
      var entry = _nodeMap[sid];
      if (entry && entry.headEl) {
        entry.headEl.classList.add('is-selected');
        _selectedId = sid;
      }
    }

    function expand(id) {
      var entry = _nodeMap[String(id != null ? id : '')];
      if (!entry || !entry.liEl.classList.contains('has-children')) return;
      entry.liEl.classList.add('is-expanded');
      entry.liEl.setAttribute('aria-expanded', 'true');
      if (entry.childListEl) entry.childListEl.hidden = false;
      if (onExpand) onExpand(entry.node);
    }

    function collapse(id) {
      var entry = _nodeMap[String(id != null ? id : '')];
      if (!entry) return;
      entry.liEl.classList.remove('is-expanded');
      entry.liEl.setAttribute('aria-expanded', 'false');
      if (entry.childListEl) entry.childListEl.hidden = true;
      if (onCollapse) onCollapse(entry.node);
    }

    function toggle(id) {
      var entry = _nodeMap[String(id != null ? id : '')];
      if (!entry) return;
      if (entry.liEl.classList.contains('is-expanded')) collapse(id); else expand(id);
    }

    function reload(newNodes) {
      nodes = Array.isArray(newNodes) ? newNodes : [];
      _render(nodes);
    }

    function destroy() {
      if (el.parentNode) el.parentNode.removeChild(el);
      _nodeMap = Object.create(null);
    }

    return { el: el, select: select, expand: expand, collapse: collapse, toggle: toggle, reload: reload, destroy: destroy };
  }

  // ── ListView ────────────────────────────────────────────────────────────────
  function list(container, opts) {
    if (!_guard(container, 'list')) return null;
    opts = opts || {};

    var items       = Array.isArray(opts.items) ? opts.items.slice() : [];
    var renderItem  = typeof opts.renderItem === 'function' ? opts.renderItem : _defaultRenderItem;
    var onSelect    = typeof opts.onSelect       === 'function' ? opts.onSelect       : null;
    var onCtx       = typeof opts.onContextMenu  === 'function' ? opts.onContextMenu  : null;
    var keyField    = opts.keyField != null ? String(opts.keyField) : '';
    var multiSelect = !!opts.multiSelect;
    var virtualize  = !!opts.virtualize;
    var virtualThreshold = Number(opts.virtualThreshold != null ? opts.virtualThreshold : 180);
    var rowHeight   = Math.max(18, Number(opts.rowHeight != null ? opts.rowHeight : 32));
    var _selected   = Object.create(null);

    function _defaultRenderItem(item, el) {
      var label = item == null ? '' : (
        item.label != null ? item.label : (
          item.name  != null ? item.name  : (
            item.title != null ? item.title : String(item))));
      el.textContent = String(label);
    }

    function _getKey(item, idx) {
      if (keyField && item != null && item[keyField] != null) return String(item[keyField]);
      return String(idx);
    }

    var el = document.createElement('div');
    el.className = 'wm-listview';

    var ul = document.createElement('ul');
    ul.className = 'wm-lv-list';
    ul.setAttribute('role', 'listbox');
    ul.setAttribute('aria-multiselectable', multiSelect ? 'true' : 'false');

    var virtualTop = document.createElement('li');
    virtualTop.className = 'wm-lv-spacer wm-lv-spacer-top';
    virtualTop.setAttribute('aria-hidden', 'true');

    var virtualBottom = document.createElement('li');
    virtualBottom.className = 'wm-lv-spacer wm-lv-spacer-bottom';
    virtualBottom.setAttribute('aria-hidden', 'true');

    el.appendChild(ul);

    function _renderRows(startIdx, endIdx) {
      ul.innerHTML = '';
      if (startIdx > 0) {
        virtualTop.style.height = (startIdx * rowHeight) + 'px';
        ul.appendChild(virtualTop);
      }

      items.slice(startIdx, endIdx).forEach(function (item, localIdx) {
        var idx = startIdx + localIdx;
        var key = _getKey(item, idx);
        var li  = document.createElement('li');
        li.className     = 'wm-lv-item' + (_selected[key] != null ? ' is-selected' : '');
        li.dataset.lvKey = key;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', _selected[key] != null ? 'true' : 'false');

        var contentEl = document.createElement('div');
        contentEl.className = 'wm-lv-item-content';
        try { renderItem(item, contentEl, idx); } catch (_) {}
        li.appendChild(contentEl);

        (function (itm, i, k) {
          li.addEventListener('click', function () {
            if (!multiSelect) {
              ul.querySelectorAll('.wm-lv-item.is-selected').forEach(function (row) {
                row.classList.remove('is-selected');
                row.setAttribute('aria-selected', 'false');
              });
              _selected = Object.create(null);
            }
            var nowSelected = !li.classList.contains('is-selected');
            li.classList.toggle('is-selected', nowSelected);
            li.setAttribute('aria-selected', nowSelected ? 'true' : 'false');
            if (nowSelected) _selected[k] = i; else delete _selected[k];
            if (onSelect) onSelect(itm, i);
          });
          if (onCtx) {
            li.addEventListener('contextmenu', function (e) {
              e.preventDefault();
              onCtx(itm, i, e);
            });
          }
        })(item, idx, key);

        ul.appendChild(li);
      });

      var rest = Math.max(0, items.length - endIdx);
      if (rest > 0) {
        virtualBottom.style.height = (rest * rowHeight) + 'px';
        ul.appendChild(virtualBottom);
      }
    }

    function _renderAll() {
      var useVirtual = virtualize && items.length >= virtualThreshold;
      if (!useVirtual) {
        _renderRows(0, items.length);
        return;
      }

      var viewportH = Math.max(rowHeight * 6, el.clientHeight || ul.clientHeight || 320);
      var buffer = 6;
      var scrollTop = Math.max(0, el.scrollTop || 0);
      var start = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
      var end = Math.min(items.length, Math.ceil((scrollTop + viewportH) / rowHeight) + buffer);
      _renderRows(start, end);
    }

    _renderAll();
    el.addEventListener('scroll', function () {
      if (virtualize && items.length >= virtualThreshold) _renderAll();
    }, { passive: true });

    window.addEventListener('resize', _renderAll);
    container.appendChild(el);

    function setItems(newItems) {
      items    = Array.isArray(newItems) ? newItems.slice() : [];
      _selected = Object.create(null);
      _renderAll();
    }

    function getSelected() {
      return Object.keys(_selected).map(function (key) {
        return { key: key, index: _selected[key], item: items[_selected[key]] };
      });
    }

    function refresh()  { _renderAll(); }
    function destroy()  {
      window.removeEventListener('resize', _renderAll);
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, setItems: setItems, getSelected: getSelected, refresh: refresh, destroy: destroy };
  }

  // ── TabView ─────────────────────────────────────────────────────────────────
  function tabs(container, opts) {
    if (!_guard(container, 'tabs')) return null;
    opts = opts || {};

    var tabList  = Array.isArray(opts.tabs) ? opts.tabs.slice() : [];
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    var _activeId = String(opts.activeTab != null ? opts.activeTab
                           : (tabList[0] && tabList[0].id != null ? tabList[0].id : ''));
    var _tabData  = Object.create(null);
    var widgetId = 'wm-tabs-' + (++_nextId);
    var nextTabId = 0;
    if (!tabList.some(function (tab) { return String(tab.id) === _activeId; })) {
      _activeId = tabList.length ? String(tabList[0].id) : '';
    }

    var el = document.createElement('div');
    el.className = 'wm-tabview';

    var barEl = document.createElement('div');
    barEl.className = 'wm-tab-bar';
    barEl.setAttribute('role', 'tablist');
    barEl.setAttribute('aria-label', String(opts.ariaLabel || 'Tabs'));

    var panesEl = document.createElement('div');
    panesEl.className = 'wm-tab-panes';

    el.appendChild(barEl);
    el.appendChild(panesEl);

    function _buildEntry(tabCfg) {
      if (tabCfg.id == null || _tabData[String(tabCfg.id)]) throw new TypeError('Tab IDs must be present and unique.');
      var id       = String(tabCfg.id != null ? tabCfg.id : '');
      var isActive = (id === _activeId);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-tab-item' + (isActive ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('data-tab-id', id);
      btn.id = widgetId + '-tab-' + (++nextTabId);
      btn.tabIndex = isActive ? 0 : -1;

      if (tabCfg.icon != null) {
        var iconEl = document.createElement('span');
        iconEl.className = 'wm-tab-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.textContent = String(tabCfg.icon);
        btn.appendChild(iconEl);
        btn.appendChild(document.createTextNode('\u00a0'));
      }
      btn.appendChild(document.createTextNode(
        String(tabCfg.label != null ? tabCfg.label : id)
      ));

      var pane = document.createElement('div');
      pane.className = 'wm-tab-pane' + (isActive ? ' is-active' : '');
      pane.setAttribute('role', 'tabpanel');
      pane.id = btn.id + '-panel';
      btn.setAttribute('aria-controls', pane.id);
      pane.setAttribute('aria-labelledby', btn.id);
      pane.tabIndex = 0;
      pane.hidden = !isActive;

      var rendered = false;
      if (isActive && typeof tabCfg.render === 'function') {
        tabCfg.render(pane);
        rendered = true;
      }

      btn.addEventListener('click', function () { setActive(id); });
      btn.addEventListener('keydown', function (event) {
        var index = tabList.findIndex(function (tab) { return String(tab.id) === id; });
        var target;
        if (event.key === 'ArrowRight') target = (index + 1) % tabList.length;
        else if (event.key === 'ArrowLeft') target = (index + tabList.length - 1) % tabList.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = tabList.length - 1;
        if (target !== undefined) {
          event.preventDefault();
          var targetId = String(tabList[target].id);
          setActive(targetId);
          _tabData[targetId].btn.focus();
        }
      });

      _tabData[id] = { cfg: tabCfg, btn: btn, pane: pane, rendered: rendered };
      barEl.appendChild(btn);
      panesEl.appendChild(pane);
    }

    tabList.forEach(_buildEntry);
    container.appendChild(el);

    function setActive(id) {
      var sid = String(id != null ? id : '');
      if (!_tabData[sid]) return;
      var previous = _tabData[_activeId];
      var transferFocus = sid !== _activeId && previous
        && (previous.btn === document.activeElement || previous.pane.contains(document.activeElement));
      _activeId = sid;
      Object.keys(_tabData).forEach(function (tid) {
        var entry    = _tabData[tid];
        var isActive = (tid === sid);
        entry.btn.classList.toggle('is-active', isActive);
        entry.btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        entry.btn.tabIndex = isActive ? 0 : -1;
        entry.pane.classList.toggle('is-active', isActive);
        entry.pane.hidden = !isActive;
        if (isActive && !entry.rendered && typeof entry.cfg.render === 'function') {
          entry.cfg.render(entry.pane);
          entry.rendered = true;
        }
      });
      if (transferFocus) _tabData[sid].btn.focus();
      if (onChange) onChange(sid);
    }

    function addTab(tabCfg) {
      if (!tabCfg || tabCfg.id == null) return;
      var sid = String(tabCfg.id);
      if (_tabData[sid]) return;
      tabList.push(tabCfg);
      _buildEntry(tabCfg);
      if (!_activeId) setActive(sid);
    }

    function removeTab(id) {
      var sid   = String(id != null ? id : '');
      var entry = _tabData[sid];
      if (!entry) return;
      var hadFocus = entry.btn === document.activeElement || entry.pane.contains(document.activeElement);
      entry.btn.remove();
      entry.pane.remove();
      delete _tabData[sid];
      tabList = tabList.filter(function (t) { return String(t.id) !== sid; });
      if (_activeId === sid) {
        var firstKey = Object.keys(_tabData)[0];
        _activeId = firstKey || '';
        if (firstKey) {
          setActive(firstKey);
          if (hadFocus) _tabData[firstKey].btn.focus();
        }
      }
    }

    function destroy() {
      if (el.parentNode) el.parentNode.removeChild(el);
      _tabData = Object.create(null);
    }

    return { el: el, setActive: setActive, addTab: addTab, removeTab: removeTab, destroy: destroy };
  }

  // ── CardView ────────────────────────────────────────────────────────────────
  function card(container, opts) {
    if (!_guard(container, 'card')) return null;
    opts = opts || {};

    var el = document.createElement('div');
    el.className = 'wm-card'
      + (opts.elevated !== false && !opts.outlined ? ' is-elevated' : '')
      + (opts.outlined  ? ' is-outlined'  : '')
      + (typeof opts.onClick === 'function' ? ' is-clickable' : '');

    if (opts.image != null) {
      var imgEl = document.createElement('div');
      imgEl.className = 'wm-card-image';
      imgEl.style.backgroundImage = 'url(' + String(opts.image).replace(/[()\"']/g, '') + ')';
      el.appendChild(imgEl);
    }

    var cardBodyEl = document.createElement('div');
    cardBodyEl.className = 'wm-card-body';

    if (opts.title != null) {
      var titleEl = document.createElement('div');
      titleEl.className   = 'wm-card-title';
      titleEl.textContent = String(opts.title);
      cardBodyEl.appendChild(titleEl);
    }

    if (opts.subtitle != null) {
      var subtitleEl = document.createElement('div');
      subtitleEl.className   = 'wm-card-subtitle';
      subtitleEl.textContent = String(opts.subtitle);
      cardBodyEl.appendChild(subtitleEl);
    }

    var contentEl = document.createElement('div');
    contentEl.className = 'wm-card-content';
    if (typeof opts.body === 'function') {
      opts.body(contentEl);
    } else if (opts.body instanceof HTMLElement) {
      contentEl.appendChild(opts.body);
    } else if (opts.body != null) {
      contentEl.innerHTML = String(opts.body);
    }
    cardBodyEl.appendChild(contentEl);
    el.appendChild(cardBodyEl);

    var actions = Array.isArray(opts.actions) ? opts.actions : [];
    if (actions.length) {
      var actionsEl = document.createElement('div');
      actionsEl.className = 'wm-card-actions';
      actions.forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wm-card-action-btn'
          + (action.primary ? ' is-primary' : '')
          + (action.danger  ? ' is-danger'  : '');
        btn.textContent = String(action.label != null ? action.label : '');
        btn.disabled = !!action.disabled;
        if (typeof action.onClick === 'function') {
          (function (fn) {
            btn.addEventListener('click', function (e) { e.stopPropagation(); fn(e); });
          })(action.onClick);
        }
        actionsEl.appendChild(btn);
      });
      el.appendChild(actionsEl);
    }

    if (typeof opts.onClick === 'function') el.addEventListener('click', opts.onClick);
    container.appendChild(el);

    function setTitle(t) {
      var tel = el.querySelector('.wm-card-title');
      if (tel) tel.textContent = String(t);
    }

    function setBody(newBody) {
      var cel = el.querySelector('.wm-card-content');
      if (!cel) return;
      cel.innerHTML = '';
      if (typeof newBody === 'function') {
        newBody(cel);
      } else if (newBody instanceof HTMLElement) {
        cel.appendChild(newBody);
      } else if (newBody != null) {
        cel.innerHTML = String(newBody);
      }
    }

    function destroy() { if (el.parentNode) el.parentNode.removeChild(el); }
    return { el: el, setTitle: setTitle, setBody: setBody, destroy: destroy };
  }

  // ── ChipGroup ───────────────────────────────────────────────────────────────
  function chips(container, opts) {
    if (!_guard(container, 'chips')) return null;
    opts = opts || {};

    var chipList    = Array.isArray(opts.chips) ? opts.chips.slice() : [];
    var multiSelect = !!opts.multiSelect;
    var onChange    = typeof opts.onChange === 'function' ? opts.onChange : null;
    var _selected   = Object.create(null);
    var _chipEls    = Object.create(null);

    chipList.forEach(function (chip) {
      if (chip.selected) _selected[String(chip.id != null ? chip.id : '')] = true;
    });

    var el = document.createElement('div');
    el.className = 'wm-chip-group';

    function _buildChip(chip) {
      var id  = String(chip.id != null ? chip.id : '');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-chip'
        + (_selected[id] ? ' is-selected' : '')
        + (chip.disabled ? ' is-disabled'  : '');
      btn.disabled = !!chip.disabled;
      btn.setAttribute('aria-pressed', _selected[id] ? 'true' : 'false');
      btn.setAttribute('data-chip-id', id);

      if (chip.icon != null) {
        var iconEl = document.createElement('span');
        iconEl.className = 'wm-chip-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.textContent = String(chip.icon);
        btn.appendChild(iconEl);
      }
      var labelEl = document.createElement('span');
      labelEl.className   = 'wm-chip-label';
      labelEl.textContent = String(chip.label != null ? chip.label : id);
      btn.appendChild(labelEl);

      (function (chipId, btnRef) {
        btnRef.addEventListener('click', function () {
          if (chip.disabled) return;
          var wasSelected = !!_selected[chipId];
          if (!multiSelect) {
            Object.keys(_selected).forEach(function (k) { delete _selected[k]; });
            el.querySelectorAll('.wm-chip.is-selected').forEach(function (c) {
              c.classList.remove('is-selected');
              c.setAttribute('aria-pressed', 'false');
            });
          }
          if (wasSelected && multiSelect) {
            delete _selected[chipId];
            btnRef.classList.remove('is-selected');
            btnRef.setAttribute('aria-pressed', 'false');
          } else {
            _selected[chipId] = true;
            btnRef.classList.add('is-selected');
            btnRef.setAttribute('aria-pressed', 'true');
          }
          if (onChange) onChange(getSelected());
        });
      })(id, btn);

      _chipEls[id] = btn;
      el.appendChild(btn);
    }

    chipList.forEach(_buildChip);
    container.appendChild(el);

    function select(id) {
      var sid = String(id != null ? id : '');
      _selected[sid] = true;
      var btn = _chipEls[sid];
      if (btn) { btn.classList.add('is-selected'); btn.setAttribute('aria-pressed', 'true'); }
    }

    function deselect(id) {
      var sid = String(id != null ? id : '');
      delete _selected[sid];
      var btn = _chipEls[sid];
      if (btn) { btn.classList.remove('is-selected'); btn.setAttribute('aria-pressed', 'false'); }
    }

    function getSelected() {
      return Object.keys(_selected).filter(function (k) { return !!_selected[k]; });
    }

    function setChips(newChips) {
      chipList  = Array.isArray(newChips) ? newChips.slice() : [];
      _selected = Object.create(null);
      _chipEls  = Object.create(null);
      el.innerHTML = '';
      chipList.forEach(function (chip) {
        if (chip.selected) _selected[String(chip.id != null ? chip.id : '')] = true;
      });
      chipList.forEach(_buildChip);
    }

    function destroy() {
      if (el.parentNode) el.parentNode.removeChild(el);
      _chipEls = Object.create(null);
    }

    return { el: el, select: select, deselect: deselect, getSelected: getSelected, setChips: setChips, destroy: destroy };
  }

  // ── BottomSheet ─────────────────────────────────────────────────────────────
  // No container parameter; appends to context_menu_container or document.body.
  function bottomSheet(opts) {
    opts = opts || {};
    var onClose     = typeof opts.onClose === 'function' ? opts.onClose : null;
    var useBackdrop = opts.backdrop !== false;
    var _isOpen     = false;
    var _onKey      = null;

    var root = document.createElement('div');
    root.className = 'wm-bottom-sheet-root';
    root.hidden = true;

    if (useBackdrop) {
      var backdropEl = document.createElement('div');
      backdropEl.className = 'wm-bottom-sheet-backdrop';
      backdropEl.addEventListener('click', close);
      root.appendChild(backdropEl);
    }

    var sheetEl = document.createElement('div');
    sheetEl.className = 'wm-bottom-sheet';
    if (typeof opts.height === 'number') sheetEl.style.maxHeight = opts.height + 'px';

    var handleEl = document.createElement('div');
    handleEl.className = 'wm-bottom-sheet-handle';
    handleEl.setAttribute('aria-hidden', 'true');
    sheetEl.appendChild(handleEl);

    if (opts.title != null) {
      var bsHeaderEl = document.createElement('div');
      bsHeaderEl.className = 'wm-bottom-sheet-header';
      var bsTitleEl = document.createElement('div');
      bsTitleEl.className   = 'wm-bottom-sheet-title';
      bsTitleEl.textContent = String(opts.title);
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'wm-bottom-sheet-close wm-btn wm-btn-close';
      closeBtn.textContent = '\u2715';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', close);
      bsHeaderEl.appendChild(bsTitleEl);
      bsHeaderEl.appendChild(closeBtn);
      sheetEl.appendChild(bsHeaderEl);
    }

    var sheetBodyEl = document.createElement('div');
    sheetBodyEl.className = 'wm-bottom-sheet-body' + (opts.scrollable !== false ? ' is-scrollable' : '');
    if (typeof opts.content === 'function') {
      try { opts.content(sheetBodyEl); } catch (_) {}
    } else if (opts.content instanceof HTMLElement) {
      sheetBodyEl.appendChild(opts.content);
    } else if (opts.content != null) {
      sheetBodyEl.innerHTML = String(opts.content);
    }
    sheetEl.appendChild(sheetBodyEl);
    root.appendChild(sheetEl);

    var bsHost = (typeof document !== 'undefined') &&
      (document.getElementById('context_menu_container') || document.body);
    if (bsHost) bsHost.appendChild(root);

    function open() {
      if (_isOpen) return;
      _isOpen = true;
      root.hidden = false;
      requestAnimationFrame(function () { sheetEl.classList.add('is-open'); });
      _onKey = function (e) { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', _onKey);
    }

    function close() {
      if (!_isOpen) return;
      _isOpen = false;
      sheetEl.classList.remove('is-open');
      if (_onKey) { document.removeEventListener('keydown', _onKey); _onKey = null; }
      setTimeout(function () {
        root.hidden = true;
        if (onClose) onClose();
      }, 240);
    }

    function destroy() {
      if (_isOpen) close();
      setTimeout(function () {
        if (root.parentNode) root.parentNode.removeChild(root);
      }, 260);
    }

    return { el: sheetEl, open: open, close: close, destroy: destroy };
  }

  // ── SplitView ───────────────────────────────────────────────────────────────
  function split(container, opts) {
    if (!_guard(container, 'split')) return null;
    opts = opts || {};

    var direction = opts.direction ?? 'horizontal';
    if (!['horizontal', 'vertical'].includes(direction)) throw new RangeError('Unknown split direction.');
    var isHoriz = direction === 'horizontal';
    var ratio = opts.ratio ?? 0.35;
    var minA = opts.minA ?? 120;
    var minB = opts.minB ?? 120;
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) throw new RangeError('Split ratio must be within 0..1.');
    if (![minA, minB].every(function (value) { return Number.isFinite(value) && value >= 0; })) throw new RangeError('Split minimum sizes must be non-negative.');
    var onResize = typeof opts.onResize === 'function' ? opts.onResize : null;

    var el = document.createElement('div');
    el.className = 'wm-split wm-split-' + (isHoriz ? 'h' : 'v');

    var paneA = document.createElement('div');
    paneA.className = 'wm-split-pane wm-split-pane-a';

    var divider = document.createElement('div');
    divider.className = 'wm-split-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', isHoriz ? 'vertical' : 'horizontal');
    divider.setAttribute('tabindex', '0');
    divider.setAttribute('aria-label', opts.ariaLabel || 'Resize panes');
    paneA.id = 'wm-split-pane-' + (++_nextId);
    divider.setAttribute('aria-controls', paneA.id);

    var paneB = document.createElement('div');
    paneB.className = 'wm-split-pane wm-split-pane-b';

    el.appendChild(paneA);
    el.appendChild(divider);
    el.appendChild(paneB);
    container.appendChild(el);

    function size() {
      return Math.max(0, isHoriz ? el.clientWidth - divider.offsetWidth : el.clientHeight - divider.offsetHeight);
    }
    function limits() {
      var available = size();
      if (!available) return [0.05, 0.95];
      if (minA + minB > available) {
        var proportional = minA / (minA + minB);
        return [proportional, proportional];
      }
      return [minA / available, 1 - minB / available];
    }
    function _applyRatio(r) {
      if (!Number.isFinite(r) || r < 0 || r > 1) throw new RangeError('Split ratio must be within 0..1.');
      var bounds = limits();
      ratio = Math.max(bounds[0], Math.min(bounds[1], r));
      var percent = (ratio * 100).toFixed(2);
      paneA.style.flex = '0 0 calc((100% - ' + (isHoriz ? divider.offsetWidth : divider.offsetHeight) + 'px) * ' + ratio + ')';
      divider.setAttribute('aria-valuenow', percent);
      divider.setAttribute('aria-valuemin', (bounds[0] * 100).toFixed(2));
      divider.setAttribute('aria-valuemax', (bounds[1] * 100).toFixed(2));
    }
    _applyRatio(ratio);
    var gesture = null;
    function finish(cancel) {
      if (!gesture) return;
      var prior = gesture;
      gesture = null;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancelled, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', cancelled);
      divider.removeEventListener('lostpointercapture', cancelled);
      if (divider.hasPointerCapture?.(prior.id)) divider.releasePointerCapture(prior.id);
      el.classList.remove('is-resizing');
      if (cancel) {
        _applyRatio(prior.ratio);
        if (onResize) onResize(ratio);
      }
    }
    function move(event) {
      if (!gesture || event.pointerId !== gesture.id) return;
      var available = size();
      if (!available) return;
      var value = gesture.ratio + ((isHoriz ? event.clientX : event.clientY) - gesture.pos) / available;
      _applyRatio(Math.max(0, Math.min(1, value)));
      event.preventDefault();
      if (onResize) onResize(ratio);
    }
    function up(event) { if (gesture && event.pointerId === gesture.id) finish(false); }
    function cancelled(event) {
      if (gesture && (event.type === 'blur' || event.pointerId === gesture.id)) finish(true);
    }
    function escape(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(true);
    }
    divider.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || event.isPrimary === false || gesture) return;
      event.preventDefault();
      divider.focus();
      gesture = { id: event.pointerId, pos: isHoriz ? event.clientX : event.clientY, ratio: ratio };
      el.classList.add('is-resizing');
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', cancelled, true);
      document.addEventListener('keydown', escape, true);
      window.addEventListener('blur', cancelled);
      divider.addEventListener('lostpointercapture', cancelled);
      divider.setPointerCapture?.(event.pointerId);
    });

    divider.addEventListener('keydown', function (e) {
      if (gesture) return;
      var bounds = limits();
      var next;
      if (e.key === (isHoriz ? 'ArrowLeft' : 'ArrowUp')) next = Math.max(0, ratio - 0.05);
      else if (e.key === (isHoriz ? 'ArrowRight' : 'ArrowDown')) next = Math.min(1, ratio + 0.05);
      else if (e.key === 'Home') next = bounds[0];
      else if (e.key === 'End') next = bounds[1];
      if (next !== undefined) { e.preventDefault(); _applyRatio(next); if (onResize) onResize(ratio); }
    });

    var observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { _applyRatio(ratio); }) : null;
    observer?.observe(el);
    function setRatio(r) {
      if (!Number.isFinite(r) || r < 0 || r > 1) throw new RangeError('Split ratio must be within 0..1.');
      finish(false);
      _applyRatio(r);
    }
    function destroy() {
      finish(false);
      observer?.disconnect();
      el.remove();
    }
    return { el: el, paneA: paneA, paneB: paneB, setRatio: setRatio, destroy: destroy };
  }

  // ── MasterDetail ─────────────────────────────────────────────────────────────
  function masterDetail(container, opts) {
    if (!_guard(container, 'masterDetail')) return null;
    opts = opts || {};

    var masterWidth    = opts.masterWidth  != null ? opts.masterWidth  : 260;
    var breakpoint     = Number(opts.breakpoint != null ? opts.breakpoint : 600);
    if (!Number.isFinite(breakpoint) || breakpoint <= 0) throw new RangeError('Master/detail breakpoint must be positive.');
    var renderMasterFn = typeof opts.renderMaster === 'function' ? opts.renderMaster : null;
    var renderDetailFn = typeof opts.renderDetail === 'function' ? opts.renderDetail : null;
    var _showingDetail = !!(opts.defaultView === 'detail');

    var el = document.createElement('div');
    el.className = 'wm-masterdetail';
    el.style.setProperty('--md-master-width',
      typeof masterWidth === 'number' ? masterWidth + 'px' : String(masterWidth));

    var masterEl = document.createElement('div');
    masterEl.className = 'wm-md-master';
    masterEl.tabIndex = -1;
    if (opts.masterLabel) { masterEl.setAttribute('role', 'region'); masterEl.setAttribute('aria-label', opts.masterLabel); }

    var detailEl = document.createElement('div');
    detailEl.className = 'wm-md-detail';
    detailEl.tabIndex = -1;
    if (opts.detailLabel) { detailEl.setAttribute('role', 'region'); detailEl.setAttribute('aria-label', opts.detailLabel); }

    el.appendChild(masterEl);
    el.appendChild(detailEl);
    container.appendChild(el);

    var rendered = false;
    try {
      if (renderMasterFn) renderMasterFn(masterEl);
      if (renderDetailFn) renderDetailFn(detailEl);
      rendered = true;
    } finally {
      if (!rendered) el.remove();
    }

    function _syncVisibility() {
      var narrow = el.offsetWidth > 0 && el.offsetWidth < breakpoint;
      el.classList.toggle('is-narrow', narrow);
      var focusedMaster = masterEl.contains(document.activeElement);
      var focusedDetail = detailEl.contains(document.activeElement);
      masterEl.hidden = narrow && _showingDetail;
      detailEl.hidden = narrow && !_showingDetail;
      masterEl.classList.toggle('is-hidden', masterEl.hidden);
      detailEl.classList.toggle('is-hidden', detailEl.hidden);
      if ((focusedMaster && masterEl.hidden) || (focusedDetail && detailEl.hidden)) {
        (masterEl.hidden ? detailEl : masterEl).focus();
      }
    }

    var _obs = null;
    if (typeof ResizeObserver !== 'undefined') {
      _obs = new ResizeObserver(_syncVisibility);
      _obs.observe(el);
    }
    _syncVisibility();

    function showDetail() { _showingDetail = true;  _syncVisibility(); }
    function showMaster() { _showingDetail = false; _syncVisibility(); }

    function destroy() {
      if (_obs) _obs.disconnect();
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, master: masterEl, detail: detailEl, showDetail: showDetail, showMaster: showMaster, refresh: _syncVisibility, destroy: destroy };
  }

  function badge(container, opts) {
    if (!_guard(container, 'badge')) return null;
    opts = opts || {};
    var el = _el('span', { className: 'wm-badge' });
    if (opts.ariaLabel) el.setAttribute('aria-label', String(opts.ariaLabel));
    function set(value, tone) {
      tone = tone || el.dataset.tone || 'neutral';
      if (!['neutral', 'info', 'success', 'warning', 'danger'].includes(tone)) {
        throw new RangeError('Unknown badge tone: ' + tone);
      }
      el.dataset.tone = tone;
      el.textContent = value == null ? '' : String(value);
    }
    set(opts.text, opts.tone);
    container.appendChild(el);
    return { el: el, set: set, destroy: function () { el.remove(); } };
  }

  function sidebar(container, opts) {
    if (!_guard(container, 'sidebar')) return null;
    opts = opts || {};
    var el = _el('nav', { className: 'wm-sidebar', attrs: { 'aria-label': opts.ariaLabel || 'Sidebar' } });
    var items = [];
    var buttons = new Map();
    var activeId = opts.activeId == null ? null : String(opts.activeId);
    function setActive(id, notify) {
      var sid = String(id);
      var item = items.find(function (entry) { return String(entry.id) === sid; });
      if (!item || item.disabled) throw new RangeError('Sidebar item is unavailable: ' + sid);
      activeId = sid;
      buttons.forEach(function (button, key) {
        button.classList.toggle('is-active', key === sid);
        if (key === sid) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
      if (notify !== false && typeof opts.onSelect === 'function') opts.onSelect(item);
    }
    function setItems(next) {
      var ids = new Set();
      next.forEach(function (item) {
        if (item.id == null || ids.has(String(item.id))) throw new TypeError('Sidebar IDs must be present and unique.');
        ids.add(String(item.id));
      });
      var focusedId = el.contains(document.activeElement) ? document.activeElement.dataset.sidebarId : null;
      items = next.slice();
      buttons.clear();
      _clearEl(el);
      items.forEach(function (item) {
        var id = String(item.id);
        var button = _el('button', {
          className: 'wm-sidebar-item', attrs: { type: 'button' }, dataset: { sidebarId: id },
        });
        button.disabled = !!item.disabled;
        if (item.icon) button.appendChild(_el('span', { className: 'wm-sidebar-icon', text: item.icon, attrs: { 'aria-hidden': 'true' } }));
        button.appendChild(_el('span', { className: 'wm-sidebar-label', text: item.label ?? id }));
        if (item.badge != null) badge(button, { text: item.badge });
        button.addEventListener('click', function () { setActive(id); });
        buttons.set(id, button);
        el.appendChild(button);
      });
      var selected = items.find(function (item) { return !item.disabled && String(item.id) === activeId; })
        || items.find(function (item) { return !item.disabled; });
      if (selected) setActive(selected.id, false);
      else activeId = null;
      if (focusedId && buttons.get(focusedId) && !buttons.get(focusedId).disabled) buttons.get(focusedId).focus();
    }
    el.addEventListener('keydown', function (event) {
      var available = Array.from(buttons.values()).filter(function (button) { return !button.disabled; });
      var index = available.indexOf(document.activeElement);
      if (index < 0) return;
      var target;
      if (event.key === 'ArrowDown') target = (index + 1) % available.length;
      else if (event.key === 'ArrowUp') target = (index + available.length - 1) % available.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = available.length - 1;
      if (target !== undefined) {
        event.preventDefault();
        available[target].focus();
      }
    });
    setItems(opts.items || []);
    container.appendChild(el);
    return { el: el, setActive: setActive, setItems: setItems, destroy: function () { buttons.clear(); el.remove(); } };
  }

  function cards(container, opts) {
    if (!_guard(container, 'cards')) return null;
    opts = opts || {};
    var minWidth = opts.minCardWidth ?? 220;
    if (!Number.isFinite(minWidth) || minWidth <= 0) throw new RangeError('Card width must be a positive number.');
    var el = _el('div', { className: 'wm-cards-layout' });
    el.style.setProperty('--wm-card-min-width', minWidth + 'px');
    var controllers = [];
    function setItems(items) {
      controllers.forEach(function (controller) { controller.destroy(); });
      controllers = [];
      items.forEach(function (item) { controllers.push(card(el, item)); });
    }
    setItems(opts.items || []);
    container.appendChild(el);
    return {
      el: el, setItems: setItems,
      destroy: function () { controllers.forEach(function (controller) { controller.destroy(); }); controllers = []; el.remove(); },
    };
  }

  function breadcrumbs(container, opts) {
    if (!_guard(container, 'breadcrumbs')) return null;
    opts = opts || {};
    var el = _el('nav', { className: 'wm-breadcrumbs', attrs: { 'aria-label': opts.ariaLabel || 'Breadcrumb' } });
    var listEl = _el('ol');
    el.appendChild(listEl);
    function setItems(items) {
      var ids = new Set();
      items.forEach(function (item) {
        if (item.id == null || ids.has(String(item.id))) throw new TypeError('Breadcrumb IDs must be present and unique.');
        ids.add(String(item.id));
      });
      var focusedId = el.contains(document.activeElement) ? document.activeElement.dataset.breadcrumbId : null;
      _clearEl(listEl);
      var focusTarget;
      items.forEach(function (item, index) {
        var current = index === items.length - 1;
        var row = _el('li');
        var control = _el(current ? 'span' : 'button', {
          className: 'wm-breadcrumb-item', text: item.label ?? item.id,
          attrs: current ? { 'aria-current': 'page', tabindex: '-1' } : { type: 'button' },
          dataset: { breadcrumbId: item.id },
        });
        if (!current) {
          control.disabled = !!item.disabled;
          control.addEventListener('click', function () { if (typeof opts.onSelect === 'function') opts.onSelect(item); });
        }
        if (String(item.id) === focusedId && !control.disabled) focusTarget = control;
        row.appendChild(control);
        listEl.appendChild(row);
      });
      if (focusedId !== null) {
        var fallback = focusTarget || listEl.querySelector('[aria-current]');
        if (fallback) fallback.focus();
        else { el.tabIndex = -1; el.focus(); }
      }
    }
    setItems(opts.items || []);
    container.appendChild(el);
    return { el: el, setItems: setItems, destroy: function () { el.remove(); } };
  }

  function progress(container, opts) {
    if (!_guard(container, 'progress')) return null;
    opts = opts || {};
    var el = _el('div', { className: 'wm-progress' });
    var id = 'wm-progress-' + (++_nextId);
    var label = _el('label', { className: 'wm-progress-label', attrs: { for: id } });
    var meter = _el('progress', { attrs: { id: id } });
    var text = _el('span', { className: 'wm-progress-text', attrs: { id: id + '-text' } });
    meter.setAttribute('aria-describedby', text.id);
    el.append(label, meter, text);
    var state = { label: opts.label, value: opts.value ?? null, max: opts.max ?? 100, text: opts.text ?? '' };
    function set(next) {
      var candidate = Object.assign({}, state, next);
      if (typeof candidate.label !== 'string' || !candidate.label.trim()) throw new TypeError('Progress requires a visible label.');
      if (!Number.isFinite(candidate.max) || candidate.max <= 0) throw new RangeError('Progress maximum must be positive.');
      if (candidate.value !== null && (!Number.isFinite(candidate.value) || candidate.value < 0 || candidate.value > candidate.max)) {
        throw new RangeError('Progress value must be null or within 0..max.');
      }
      state = candidate;
      label.textContent = state.label;
      meter.max = state.max;
      if (state.value === null) meter.removeAttribute('value');
      else meter.value = state.value;
      el.dataset.indeterminate = String(state.value === null);
      text.textContent = String(state.text);
      text.hidden = !state.text;
    }
    set({});
    container.appendChild(el);
    return { el: el, set: set, destroy: function () { el.remove(); } };
  }

  function notice(container, opts) {
    if (!_guard(container, 'notice')) return null;
    opts = opts || {};
    var el = _el('section', { className: 'wm-notice' });
    var title = _el('h3', { className: 'wm-notice-title', attrs: { id: 'wm-notice-' + (++_nextId) } });
    var message = _el('p', { className: 'wm-notice-message' });
    var actions = _el('div', { className: 'wm-notice-actions' });
    var copy = _el('div', { className: 'wm-notice-copy' });
    copy.append(title, message);
    el.append(copy, actions);
    el.setAttribute('aria-labelledby', title.id);
    // Keep interactive actions outside the live region to avoid announcing them twice.
    copy.setAttribute('aria-live', opts.live === 'polite' ? 'polite' : 'off');
    copy.setAttribute('aria-atomic', 'true');
    var state = { state: opts.state || 'empty', title: opts.title, message: opts.message ?? '', actions: opts.actions || [] };
    function set(next) {
      var candidate = Object.assign({}, state, next);
      if (!['empty', 'loading', 'error', 'info', 'success', 'warning'].includes(candidate.state)) throw new RangeError('Unknown notice state.');
      if (typeof candidate.title !== 'string' || !candidate.title.trim()) throw new TypeError('Notice requires a visible title.');
      if (!Array.isArray(candidate.actions)) throw new TypeError('Notice actions must be an array.');
      state = candidate;
      el.dataset.state = state.state;
      title.textContent = state.title;
      message.textContent = String(state.message);
      message.hidden = !state.message;
      // Copy-only updates must not replace a focused retry/action button.
      if (Object.hasOwn(next, 'actions') || !actions.childNodes.length) {
        var focusedIndex = Array.from(actions.children).indexOf(document.activeElement);
        _clearEl(actions);
        state.actions.forEach(function (action) {
          var button = _el('button', { className: 'wm-card-action-btn', attrs: { type: 'button' }, text: action.label });
          button.disabled = !!action.disabled;
          button.addEventListener('click', function () { if (typeof action.onClick === 'function') action.onClick(action); });
          actions.appendChild(button);
        });
        if (focusedIndex >= 0) {
          var replacement = actions.children[focusedIndex];
          if (replacement && !replacement.disabled) replacement.focus();
          else { title.tabIndex = -1; title.focus(); }
        }
      }
      actions.hidden = !state.actions.length;
    }
    set({});
    container.appendChild(el);
    return { el: el, set: set, destroy: function () { el.remove(); } };
  }

  function properties(container, opts) {
    if (!_guard(container, 'properties')) return null;
    opts = opts || {};
    var el = _el('dl', { className: 'wm-properties' });
    var values = new Map();
    function write(target, value) {
      var content = _el('div');
      _appendContent(content, value == null ? (opts.emptyText ?? 'Not available') : value);
      target.replaceChildren(...content.childNodes);
    }
    function setItems(items) {
      var ids = new Set();
      items.forEach(function (item) {
        if (item.id == null || ids.has(String(item.id))) throw new TypeError('Property IDs must be present and unique.');
        ids.add(String(item.id));
      });
      var fragment = document.createDocumentFragment();
      var nextValues = new Map();
      items.forEach(function (item) {
        var row = _el('div', { className: 'wm-property-row' });
        var value = _el('dd');
        row.append(_el('dt', { text: item.label ?? item.id }), value);
        write(value, item.value);
        nextValues.set(String(item.id), value);
        fragment.appendChild(row);
      });
      _clearEl(el);
      el.appendChild(fragment);
      values = nextValues;
    }
    function setValue(id, value) {
      var target = values.get(String(id));
      if (!target) throw new RangeError('Unknown property: ' + id);
      write(target, value);
    }
    setItems(opts.items || []);
    container.appendChild(el);
    return { el: el, setItems: setItems, setValue: setValue, destroy: function () { values.clear(); el.remove(); } };
  }

  function stack(container, opts) {
    if (!_guard(container, 'stack')) return null;
    opts = opts || {};
    var direction = opts.direction ?? 'vertical';
    var gap = opts.gap ?? 12;
    if (!['vertical', 'horizontal'].includes(direction)) throw new RangeError('Unknown stack direction.');
    if (!Number.isFinite(gap) || gap < 0) throw new RangeError('Stack gap must be a non-negative number.');
    var el = _el('div', { className: 'wm-stack', dataset: { direction: direction, wrap: String(opts.wrap !== false) } });
    el.style.setProperty('--wm-stack-gap', gap + 'px');
    function append(content) {
      var slot = _el('div', { className: 'wm-stack-item' });
      _appendContent(slot, content);
      el.appendChild(slot);
      return slot;
    }
    (opts.items || []).forEach(append);
    container.appendChild(el);
    return { el: el, append: append, destroy: function () { el.remove(); } };
  }

  function dataTable(container, opts) {
    if (!_guard(container, 'dataTable')) return null;
    opts = opts || {};
    if (typeof opts.caption !== 'string' || !opts.caption.trim()) throw new TypeError('Table requires a visible caption.');
    var columns = opts.columns || [];
    var ids = new Set();
    var filterColumns = new Map();
    if (!columns.length) throw new TypeError('Table requires columns.');
    columns.forEach(function (column) {
      if (column.id == null || ids.has(String(column.id))) throw new TypeError('Table column IDs must be present and unique.');
      ids.add(String(column.id));
      if (column.filter) {
        var choices = new Set();
        (column.filter.options || []).forEach(function (option) {
          var value = String(option.value);
          if (!value || choices.has(value)) throw new TypeError('Table filter values must be nonempty and unique.');
          choices.add(value);
        });
        filterColumns.set(String(column.id), { column: column, choices: choices });
      }
    });
    var labels = Object.assign({
      search: 'Search table', toolbar: 'Table tools', reset: 'Reset table', all: 'All',
      clearSearch: 'Clear search',
      ascending: 'ascending', descending: 'descending',
      sort: function (column, direction) { return 'Sort: ' + column + ' (' + direction + ')'; },
      clearSort: 'Remove sorting',
      nextSort: function (column, direction) { return 'Sort ' + column + ': ' + direction; },
      removeFilter: function (column, value) { return 'Remove filter: ' + column + ': ' + value; },
      noMatches: 'No matching entries', results: function (visible, total) { return visible + ' of ' + total + ' entries'; },
    }, opts.labels);
    var captionId = 'wm-table-' + (++_nextId);
    var el = _el('div', { className: 'wm-data-table', attrs: { tabindex: '0', role: 'region', 'aria-labelledby': captionId } });
    var table = _el('table');
    var caption = _el('caption', { text: opts.caption, attrs: { id: captionId } });
    var head = _el('thead');
    var headerRow = _el('tr');
    var body = _el('tbody');
    var headers = new Map();
    var rows = [];
    var sort = null;
    var query = '';
    var filters = Object.create(null);
    var destroyed = false;
    var controls = new Map();
    var fields = [];
    var search = null;
    var reset = null;
    var result = null;
    var clearSearch = null;
    var filterChips = new Map();
    var sortChip = null;
    var sortFocusTarget = null;
    var activeFilters = null;
    var empty = _el('tr');
    var emptyCell = _el('td', { className: 'wm-table-empty', attrs: { colspan: columns.length } });
    var emptyContent = _el('div', { className: 'wm-table-empty-content' });
    var emptyMessage = _el('p', { className: 'wm-table-empty-message' });
    var emptyReset = _el('button', { text: labels.reset, attrs: { type: 'button' } });
    emptyReset.dataset.tableControl = 'empty-reset';
    emptyReset.addEventListener('click', function () {
      if (destroyed) return;
      (search || controls.values().next().value || el).focus({ preventScroll: true });
      resetView();
    });
    emptyContent.appendChild(emptyMessage);
    emptyCell.appendChild(emptyContent);
    empty.appendChild(emptyCell);
    var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    function normalize(value) {
      return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    }
    function valueOf(column, item) {
      return typeof column.value === 'function' ? column.value(item) : item[column.id];
    }
    function sortable(column) { return column.sortable === true || typeof column.compare === 'function'; }
    function getState() {
      return { query: query, filters: { ...filters }, sort: sort ? Object.assign({}, sort) : null };
    }
    function changed() { if (typeof opts.onStateChange === 'function') opts.onStateChange(getState()); }
    function filterValue(id, value) {
      var config = filterColumns.get(String(id));
      if (!config) throw new RangeError('Unknown table filter: ' + id);
      var text = String(value ?? '');
      if (text && !config.choices.has(text)) throw new RangeError('Unknown table filter value: ' + text);
      return text;
    }
    function sortState(id, direction) {
      if (id == null) return null;
      var sid = String(id);
      var column = columns.find(function (entry) { return String(entry.id) === sid; });
      if (!column || !sortable(column)) throw new RangeError('Table column is not sortable: ' + sid);
      if (!['ascending', 'descending'].includes(direction)) throw new RangeError('Unknown table sort direction.');
      return { id: sid, direction: direction };
    }
    if (opts.state) {
      query = String(opts.state.query ?? '');
      Object.entries(opts.state.filters || {}).forEach(function (entry) {
        var value = filterValue(entry[0], entry[1]);
        if (value) filters[entry[0]] = value;
      });
      if (opts.state.sort) sort = sortState(opts.state.sort.id, opts.state.sort.direction);
    }
    if (opts.searchable || filterColumns.size || columns.some(sortable)) {
      var tools = _el('div', {
        className: 'wm-table-tools',
        attrs: { role: 'toolbar', 'aria-label': labels.toolbar },
      });
      if (opts.searchable) {
        var searchGroup = _el('div', { className: 'wm-table-search' });
        search = _el('input', { attrs: { type: 'search', 'aria-label': labels.search, placeholder: labels.search } });
        search.dataset.tableControl = 'search';
        search.value = query;
        fields.push(field(searchGroup, { control: search, label: labels.search }));
        search.addEventListener('input', function (event) {
          if (!destroyed && !event.isComposing) setSearch(search.value);
        });
        search.addEventListener('compositionend', function () { if (!destroyed) setSearch(search.value); });
        var searchActions = _el('div', { className: 'wm-table-search-actions' });
        clearSearch = _el('button', { text: '\u00d7', attrs: {
          type: 'button', 'aria-label': labels.clearSearch, title: labels.clearSearch,
        } });
        clearSearch.dataset.tableControl = 'clear-search';
        clearSearch.addEventListener('click', function () {
          if (destroyed) return;
          search.focus({ preventScroll: true });
          setSearch('');
        });
        searchActions.appendChild(clearSearch);
        searchGroup.appendChild(searchActions);
        tools.appendChild(searchGroup);
      }
      reset = _el('button', { text: labels.reset, attrs: { type: 'button' } });
      reset.dataset.tableControl = 'reset';
      reset.addEventListener('click', function () {
        if (destroyed) return;
        (search || controls.values().next().value || el).focus({ preventScroll: true });
        resetView();
      });
      tools.appendChild(reset);
      sortChip = _el('button', { className: 'wm-table-sort-chip', attrs: { type: 'button', hidden: '' } });
      sortChip.dataset.tableControl = 'clear-sort';
      sortChip.addEventListener('click', function () {
        if (destroyed || !sort) return;
        setSort(null);
      });
      tools.appendChild(sortChip);
      activeFilters = _el('div', { className: 'wm-table-active-filters' });
      filterColumns.forEach(function (config, id) {
        var chip = _el('button', { attrs: { type: 'button', hidden: '' } });
        chip.dataset.tableControl = 'clear-filter:' + id;
        chip.addEventListener('click', function () {
          if (destroyed) return;
          setFilter(id, '');
        });
        filterChips.set(id, chip);
        activeFilters.appendChild(chip);
      });
      tools.appendChild(activeFilters);
      result = _el('p', { className: 'wm-table-result', attrs: { role: 'status' } });
      tools.appendChild(result);
      tools.addEventListener('keydown', onToolsKey);
      el.appendChild(tools);
    }
    function onToolsKey(event) {
      if (destroyed || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target === search) {
        if (event.key === 'Escape' && query) {
          event.preventDefault();
          event.stopPropagation();
          setSearch('');
        }
        return;
      }
      if (!event.target.matches('button')) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      var actions = Array.from(tools.querySelectorAll('input, button')).filter(function (control) {
        return !control.disabled && !control.closest('[hidden]');
      });
      var index = actions.indexOf(event.target);
      if (index < 0) return;
      var rtl = getComputedStyle(tools).direction === 'rtl';
      var next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
        : (index + ((event.key === 'ArrowRight') !== rtl ? 1 : -1) + actions.length) % actions.length;
      event.preventDefault();
      event.stopPropagation();
      actions[next].focus({ preventScroll: true });
    }
    columns.forEach(function (column) {
      var th = _el('th', { attrs: { scope: 'col' } });
      if (column.rowHeader && !headers.size) th.classList.add('wm-table-row-heading');
      if (column.numeric) th.classList.add('is-numeric');
      if (sortable(column)) {
        var button = _el('button', { text: column.label ?? column.id, attrs: { type: 'button' } });
        button.dataset.tableControl = 'sort:' + column.id;
        th.setAttribute('aria-sort', 'none');
        button.addEventListener('click', function () {
          if (destroyed) return;
          if (sort?.id === String(column.id) && sort.direction === 'descending') setSort(null);
          else setSort(column.id, sort?.id === String(column.id) ? 'descending' : 'ascending');
        });
        th.appendChild(button);
        var hintId = captionId + '-sort-' + headers.size;
        button.setAttribute('aria-describedby', hintId);
        th.appendChild(_el('span', { className: 'wm-table-sort-hint', attrs: { id: hintId } }));
      } else th.textContent = String(column.label ?? column.id);
      var config = filterColumns.get(String(column.id));
      if (config) {
        var select = _el('select', { attrs: { 'aria-label': config.column.filter.label ?? column.label ?? column.id } });
        select.dataset.tableControl = 'filter:' + column.id;
        select.appendChild(_el('option', { text: labels.all, attrs: { value: '' } }));
        config.column.filter.options?.forEach(function (option) {
          select.appendChild(_el('option', { text: option.label ?? option.value, attrs: { value: String(option.value) } }));
        });
        select.value = filters[String(column.id)] || '';
        fields.push(field(th, { control: select, label: config.column.filter.label ?? column.label ?? column.id }));
        controls.set(String(column.id), select);
        select.addEventListener('change', function () {
          if (!destroyed) setFilter(column.id, select.value);
        });
      }
      headers.set(String(column.id), th);
      headerRow.appendChild(th);
    });
    head.appendChild(headerRow);
    table.append(caption, head, body);
    el.appendChild(table);
    function ordered(entries, nextSort) {
      if (!nextSort) return entries.slice();
      var column = columns.find(function (entry) { return String(entry.id) === nextSort.id; });
      return entries.slice().sort(function (a, b) {
        var result;
        if (typeof column.compare === 'function') result = column.compare(a.item, b.item);
        else {
          var av = typeof column.sortValue === 'function' ? column.sortValue(a.item) : valueOf(column, a.item);
          var bv = typeof column.sortValue === 'function' ? column.sortValue(b.item) : valueOf(column, b.item);
          var aMissing = av == null || (column.numeric && (typeof av !== 'number' || !Number.isFinite(av)));
          var bMissing = bv == null || (column.numeric && (typeof bv !== 'number' || !Number.isFinite(bv)));
          if (aMissing || bMissing) return (aMissing === bMissing ? 0 : aMissing ? 1 : -1) || a.index - b.index;
          result = column.numeric ? (av === bv ? 0 : av < bv ? -1 : 1) : collator.compare(String(av), String(bv));
        }
        if (!Number.isFinite(result)) throw new TypeError('Table comparator must return a finite number.');
        return (nextSort.direction === 'descending' ? -result : result) || a.index - b.index;
      });
    }
    function display(entries, reorder) {
      var focused = el.contains(document.activeElement) ? document.activeElement : null;
      var tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
      var activeFilters = Object.entries(filters);
      var visible = 0;
      entries.forEach(function (entry) {
        var match = tokens.every(function (token) { return entry.search.includes(token); })
          && activeFilters.every(function (filter) { return entry.filters[filter[0]] === filter[1]; });
        entry.row.hidden = !match;
        if (match) visible++;
        if (reorder) body.appendChild(entry.row);
      });
      emptyMessage.textContent = rows.length ? labels.noMatches : (opts.emptyText ?? 'No entries');
      if (rows.length && !visible && (query || activeFilters.length)) emptyContent.appendChild(emptyReset);
      else emptyReset.remove();
      if (visible) empty.remove();
      else body.appendChild(empty);
      if (result) result.textContent = labels.results(visible, rows.length);
      if (focused && (!el.contains(focused) || focused.closest('tr')?.hidden)) el.focus({ preventScroll: true });
      else if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
    }
    function updateHeaders() {
      headers.forEach(function (th, key) {
        if (!th.hasAttribute('aria-sort')) return;
        var direction = key === sort?.id ? sort.direction : 'none';
        th.setAttribute('aria-sort', direction);
        var column = columns.find(function (entry) { return String(entry.id) === key; });
        var hint = direction === 'descending' ? labels.clearSort
          : labels.nextSort(column.label ?? column.id, labels[direction === 'ascending' ? 'descending' : 'ascending']);
        th.querySelector('button').title = hint;
        th.querySelector('.wm-table-sort-hint').textContent = hint;
      });
    }
    function setSort(id, direction) {
      var next = sortState(id, direction);
      if (next?.id === sort?.id && next?.direction === sort?.direction) return;
      var sorted = ordered(rows, next);
      sort = next;
      updateHeaders();
      display(sorted, true);
      updateTools();
      changed();
    }
    function setSearch(value) {
      var text = String(value ?? '');
      if (search && search.value !== text) search.value = text;
      if (query === text) return;
      query = text;
      display(rows, false);
      updateTools();
      changed();
    }
    function setFilter(id, value) {
      var text = filterValue(id, value);
      var control = controls.get(String(id));
      if (control.value !== text) control.value = text;
      if ((filters[id] || '') === text) return;
      if (text) filters[id] = text;
      else delete filters[id];
      display(rows, false);
      updateTools();
      changed();
    }
    function resetView() {
      if (search && search.value !== '') search.value = '';
      controls.forEach(function (control) { if (control.value !== '') control.value = ''; });
      if (!query && !Object.keys(filters).length && !sort) return;
      query = '';
      filters = Object.create(null);
      sort = null;
      updateHeaders();
      display(rows, true);
      updateTools();
      changed();
    }
    function updateTools() {
      var focused = el.contains(document.activeElement) ? document.activeElement : null;
      var fallback = search || controls.values().next().value || el;
      if (focused === sortChip) fallback = search || sortFocusTarget || el;
      filterChips.forEach(function (chip, id) {
        if (focused === chip) fallback = search || controls.get(id);
      });
      if (reset) reset.disabled = !query && !Object.keys(filters).length && !sort;
      if (clearSearch) clearSearch.disabled = !query;
      if (sortChip) {
        sortChip.hidden = !sort;
        if (sort) {
          var column = columns.find(function (entry) { return String(entry.id) === sort.id; });
          sortFocusTarget = headers.get(sort.id).querySelector('button');
          var description = labels.sort(column.label ?? column.id, labels[sort.direction]);
          sortChip.textContent = description + ' \u00d7';
          sortChip.setAttribute('aria-label', labels.clearSort + ': ' + description);
        }
      }
      if (activeFilters) activeFilters.hidden = !Object.keys(filters).length;
      filterChips.forEach(function (chip, id) {
        var value = filters[id];
        var config = filterColumns.get(id).column;
        var option = (config.filter.options || []).find(function (entry) { return String(entry.value) === value; });
        chip.hidden = !value;
        headers.get(id).classList.toggle('has-filter', !!value);
        if (value) {
          var title = config.label ?? id;
          var text = option.label ?? option.value;
          chip.textContent = title + ': ' + text + ' \u00d7';
          chip.setAttribute('aria-label', labels.removeFilter(title, text));
        }
      });
      if (focused && (focused.disabled || focused.closest('[hidden]'))) fallback.focus({ preventScroll: true });
    }
    function setItems(items) {
      var next = items.map(function (item, index) {
        var row = _el('tr');
        columns.forEach(function (column) {
          var cell = _el(column.rowHeader ? 'th' : 'td', {
            className: column.numeric ? 'is-numeric' : '',
            attrs: column.rowHeader ? { scope: 'row' } : {},
          });
          if (typeof column.render === 'function') column.render(cell, item);
          else {
            var value = typeof column.value === 'function' ? column.value(item) : item[column.id];
            _appendContent(cell, value == null ? (opts.emptyValue ?? 'Not available') : value);
          }
          row.appendChild(cell);
        });
        var text = columns.filter(function (column) { return column.searchable !== false; }).map(function (column) {
          return typeof column.searchValue === 'function' ? column.searchValue(item)
            : row.children[columns.indexOf(column)].textContent;
        }).join(' ');
        var values = Object.create(null);
        filterColumns.forEach(function (config, id) {
          values[id] = String(typeof config.column.filter.value === 'function'
            ? config.column.filter.value(item) : valueOf(config.column, item));
        });
        return { row: row, item: item, index: index, search: normalize(text), filters: values };
      });
      var sorted = ordered(next, sort);
      var hadFocus = body.contains(document.activeElement);
      body.replaceChildren();
      rows = next;
      display(sorted, true);
      if (hadFocus) el.focus({ preventScroll: true });
    }
    setItems(opts.items || []);
    updateHeaders();
    updateTools();
    container.appendChild(el);
    return {
      el: el, setItems: setItems, setSort: setSort, setSearch: setSearch, setFilter: setFilter,
      getState: getState, reset: resetView,
      destroy: function () {
        destroyed = true;
        if (tools) tools.removeEventListener('keydown', onToolsKey);
        rows = [];
        headers.clear();
        controls.clear();
        fields.forEach(function (controller) { controller.destroy(); });
        el.remove();
      },
    };
  }

  function field(container, opts) {
    if (!_guard(container, 'field')) return null;
    opts = opts || {};
    var control = opts.control;
    if (!(control instanceof HTMLElement) || !control.matches('input:not([type="hidden"]), select, textarea')) {
      throw new TypeError('Field requires a visible native input, select or textarea.');
    }
    if (typeof opts.label !== 'string' || !opts.label.trim()) throw new TypeError('Field requires a visible label.');
    var original = {};
    ['id', 'aria-describedby', 'aria-invalid'].forEach(function (name) { original[name] = control.getAttribute(name); });
    var id = 'wm-field-' + (++_nextId);
    if (!control.id) control.id = id;
    var el = _el('div', { className: 'wm-field' });
    var label = _el('label', { className: 'wm-field-label', text: opts.label, attrs: { for: control.id } });
    var help = _el('div', { className: 'wm-field-help', attrs: { id: id + '-help' }, text: opts.help ?? '' });
    var error = _el('div', { className: 'wm-field-error', attrs: { id: id + '-error' } });
    help.hidden = !opts.help;
    el.append(label, control, help, error);
    function restore(name) {
      if (original[name] === null) control.removeAttribute(name);
      else control.setAttribute(name, original[name]);
    }
    function setError(message) {
      var text = message == null ? '' : String(message);
      error.textContent = text;
      error.hidden = !text;
      el.classList.toggle('has-error', !!text);
      if (text) control.setAttribute('aria-invalid', 'true');
      else restore('aria-invalid');
      var descriptions = (original['aria-describedby'] || '').split(/\s+/).filter(Boolean);
      if (!help.hidden) descriptions.push(help.id);
      if (text) descriptions.push(error.id);
      if (descriptions.length) control.setAttribute('aria-describedby', [...new Set(descriptions)].join(' '));
      else control.removeAttribute('aria-describedby');
    }
    setError(opts.error);
    container.appendChild(el);
    var destroyed = false;
    return {
      el: el, control: control, setError: setError,
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        Object.keys(original).forEach(restore);
        el.remove();
      },
    };
  }

  function formLayout(container, opts) {
    if (!_guard(container, 'formLayout')) return null;
    opts = opts || {};
    if (typeof opts.legend !== 'string' || !opts.legend.trim()) throw new TypeError('Form layout requires a visible legend.');
    var fields = opts.fields || [];
    var ids = new Set();
    var controls = new Set();
    fields.forEach(function (entry) {
      if (entry.id == null || ids.has(String(entry.id))) throw new TypeError('Form field IDs must be present and unique.');
      if (controls.has(entry.control)) throw new TypeError('Form controls must be unique.');
      ids.add(String(entry.id));
      controls.add(entry.control);
    });
    var el = _el('fieldset', { className: 'wm-form-layout' });
    el.appendChild(_el('legend', { text: opts.legend }));
    var content = _el('div', { className: 'wm-form-fields' });
    el.appendChild(content);
    var controllers = new Map();
    var complete = false;
    try {
      fields.forEach(function (entry) { controllers.set(String(entry.id), field(content, entry)); });
      container.appendChild(el);
      complete = true;
    } finally {
      if (!complete) controllers.forEach(function (controller) { controller.destroy(); });
    }
    function getField(id) {
      var controller = controllers.get(String(id));
      if (!controller) throw new RangeError('Unknown form field: ' + id);
      return controller;
    }
    return {
      el: el, getField: getField,
      setErrors: function (errors) {
        Object.keys(errors).forEach(getField);
        controllers.forEach(function (controller, key) { controller.setError(Object.hasOwn(errors, key) ? errors[key] : ''); });
      },
      destroy: function () { controllers.forEach(function (controller) { controller.destroy(); }); controllers.clear(); el.remove(); },
    };
  }

  function pagination(container, opts) {
    if (!_guard(container, 'pagination')) return null;
    opts = opts || {};
    if (typeof opts.onChange !== 'function') throw new TypeError('Pagination requires an onChange handler.');
    var labels = Object.assign({
      navigation: 'Pagination', previous: 'Previous page', next: 'Next page',
      page: function (number) { return 'Page ' + number; },
      summary: function (page, pages, total) { return page + ' / ' + pages + ' (' + total + ')'; },
      empty: 'No entries',
    }, opts.labels);
    var el = _el('nav', { className: 'wm-pagination', attrs: { 'aria-label': labels.navigation, tabindex: '-1' } });
    var controls = _el('div', { className: 'wm-pagination-controls' });
    var summary = _el('span', { className: 'wm-pagination-summary' });
    el.append(controls, summary);
    var state = { total: opts.total ?? 0, pageSize: opts.pageSize ?? 20, page: opts.page ?? (opts.total > 0 ? 1 : 0), busy: !!opts.busy };
    function set(next) {
      var candidate = Object.assign({}, state, next);
      if (!Number.isSafeInteger(candidate.total) || candidate.total < 0) throw new RangeError('Pagination total must be a non-negative safe integer.');
      if (!Number.isSafeInteger(candidate.pageSize) || candidate.pageSize < 1) throw new RangeError('Pagination pageSize must be a positive safe integer.');
      var pages = Math.ceil(candidate.total / candidate.pageSize);
      if (!Number.isSafeInteger(candidate.page) || (pages === 0 ? candidate.page !== 0 : candidate.page < 1 || candidate.page > pages)) {
        throw new RangeError('Pagination page must be in range; empty collections use page zero.');
      }
      var fragment = document.createDocumentFragment();
      var buttons = new Map();
      function button(key, text, target, disabled, current) {
        var node = _el('button', {
          text: text, attrs: { type: 'button', 'aria-label': current == null ? text : labels.page(target), 'aria-current': current ? 'page' : null },
          dataset: { pageKey: key },
        });
        node.disabled = candidate.busy || disabled;
        node.addEventListener('click', function () { if (!node.disabled && target !== state.page) opts.onChange(target); });
        fragment.appendChild(node);
        buttons.set(key, node);
      }
      button('previous', labels.previous, candidate.page - 1, candidate.page <= 1);
      var visible = new Set();
      if (pages) {
        [1, pages, candidate.page - 1, candidate.page, candidate.page + 1].forEach(function (page) {
          if (page >= 1 && page <= pages) visible.add(page);
        });
      }
      var prior = 0;
      [...visible].sort(function (a, b) { return a - b; }).forEach(function (page) {
        if (prior && page - prior > 1) fragment.appendChild(_el('span', { text: '...', attrs: { 'aria-hidden': 'true' } }));
        button(String(page), String(page), page, false, page === candidate.page);
        prior = page;
      });
      button('next', labels.next, candidate.page + 1, !pages || candidate.page >= pages);
      var summaryText = pages ? labels.summary(candidate.page, pages, candidate.total) : labels.empty;
      var focusedKey = controls.contains(document.activeElement) ? document.activeElement.dataset.pageKey : null;
      state = candidate;
      controls.replaceChildren(fragment);
      summary.textContent = String(summaryText);
      el.setAttribute('aria-busy', String(!!state.busy));
      if (focusedKey !== null) {
        var target = buttons.get(focusedKey);
        if (!target || target.disabled) target = buttons.get(String(state.page));
        if (target && !target.disabled) target.focus();
        else el.focus();
      }
    }
    set({});
    container.appendChild(el);
    return { el: el, set: set, destroy: function () { el.remove(); } };
  }

  function timeline(container, opts) {
    if (!_guard(container, 'timeline')) return null;
    opts = opts || {};
    if (typeof opts.ariaLabel !== 'string' || !opts.ariaLabel.trim()) throw new TypeError('Timeline requires an accessible label.');
    var el = _el('ol', { className: 'wm-timeline', attrs: { 'aria-label': opts.ariaLabel, tabindex: '-1' } });
    var entries = new Map();
    function setItems(items) {
      var ids = new Set();
      items.forEach(function (item) {
        if (item.id == null || ids.has(String(item.id))) throw new TypeError('Timeline IDs must be present and unique.');
        if (typeof item.title !== 'string' || !item.title.trim()) throw new TypeError('Timeline items require a visible title.');
        if (!['queued', 'active', 'complete', 'blocked'].includes(item.state)) throw new RangeError('Unknown timeline state.');
        if (typeof item.stateLabel !== 'string' || !item.stateLabel.trim()) throw new TypeError('Timeline items require a visible stateLabel.');
        ids.add(String(item.id));
      });
      var next = new Map();
      // Prepare new content before mutating existing rows so renderer failures preserve the old view.
      var prepared = items.map(function (item) {
        var prior = entries.get(String(item.id));
        var content = null;
        if (!prior || prior.content !== item.content) {
          content = _el('div', { className: 'wm-timeline-content' });
          _appendContent(content, item.content);
        }
        return { item: item, prior: prior, content: content };
      });
      var focused = el.contains(document.activeElement) ? document.activeElement : null;
      prepared.forEach(function (entry) {
        var item = entry.item;
        var row = entry.prior?.row || _el('li', { className: 'wm-timeline-item' });
        if (!entry.prior) {
          row.append(_el('div', { className: 'wm-timeline-title' }), _el('span', { className: 'wm-timeline-state' }), _el('div', { className: 'wm-timeline-meta' }));
        }
        row.dataset.state = item.state;
        if (item.state === 'active') row.setAttribute('aria-current', 'step');
        else row.removeAttribute('aria-current');
        row.querySelector('.wm-timeline-title').textContent = item.title;
        row.querySelector('.wm-timeline-state').textContent = item.stateLabel;
        var meta = row.querySelector('.wm-timeline-meta');
        meta.textContent = item.meta == null ? '' : String(item.meta);
        meta.hidden = item.meta == null || item.meta === '';
        if (entry.content) {
          row.querySelector('.wm-timeline-content')?.remove();
          row.appendChild(entry.content);
        }
        el.appendChild(row);
        next.set(String(item.id), { row: row, content: item.content });
      });
      entries.forEach(function (entry, id) { if (!next.has(id)) entry.row.remove(); });
      entries = next;
      if (focused && document.activeElement !== focused) {
        if (el.contains(focused)) focused.focus({ preventScroll: true });
        else el.focus({ preventScroll: true });
      }
    }
    setItems(opts.items || []);
    container.appendChild(el);
    return { el: el, setItems: setItems, destroy: function () { entries.clear(); el.remove(); } };
  }

  function frame(container, opts) {
    if (!_guard(container, 'frame')) return null;
    opts = opts || {};
    var el = _el('div', { className: 'wm-window-frame', attrs: { 'data-wm-scroll-fix-optout': '' } });
    var controllers = {};
    var badgeControllers = [];
    var middle = _el('div', { className: 'wm-frame-middle' });
    var content = _el('div', { className: 'wm-frame-content' });
    var priorClass = container.classList.contains('wm-body-framed');
    var priorOverflow = container.style.overflow;
    function mount(name, factory, options) {
      var slot = _el('div', { className: 'wm-frame-' + name.toLowerCase() });
      el.appendChild(slot);
      controllers[name] = factory(slot, options);
    }
    var complete = false;
    var destroyed = false;
    try {
      if (opts.menuBar) mount('menuBar', menu, opts.menuBar);
      if (opts.toolbar) mount('toolbar', toolbar, opts.toolbar);
      if (opts.breadcrumbs) mount('breadcrumbs', breadcrumbs, opts.breadcrumbs);
      if (opts.badges?.length) {
        var badges = _el('div', { className: 'wm-frame-badges' });
        opts.badges.forEach(function (item) { badgeControllers.push(badge(badges, item)); });
        el.appendChild(badges);
      }
      el.appendChild(middle);
      if (opts.sidebar) {
        var sidebarSlot = _el('aside', { className: 'wm-frame-sidebar' });
        middle.classList.add('has-sidebar');
        middle.appendChild(sidebarSlot);
        controllers.sidebar = sidebar(sidebarSlot, opts.sidebar);
      }
      middle.appendChild(content);
      if (opts.statusBar) mount('statusBar', statusBar, opts.statusBar);
      if (opts.render) _appendContent(content, opts.render);
      container.classList.add('wm-body-framed');
      container.style.overflow = 'hidden';
      container.appendChild(el);
      complete = true;
    } finally {
      if (!complete) destroy();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      Object.values(controllers).forEach(function (controller) { controller.destroy(); });
      badgeControllers.forEach(function (controller) { controller.destroy(); });
      el.remove();
      if (!priorClass) container.classList.remove('wm-body-framed');
      container.style.overflow = priorOverflow;
    }
    return Object.assign({ el: el, content: content, badges: badgeControllers, destroy: destroy }, controllers);
  }

  // ── Menu / Submenu ─────────────────────────────────────────────────────────
  function menu(container, opts) {
    if (!_guard(container, 'menu')) return null;
    opts = opts || {};

    var entries = Array.isArray(opts.items) ? opts.items.slice() : [];
    var onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : null;
    var bindCommand = typeof opts.executeCommand === 'function'
      ? opts.executeCommand
      : function (id, payload) {
          if (typeof window !== 'undefined' && window.WM && typeof window.WM.executeCommand === 'function') {
            return window.WM.executeCommand(id, payload);
          }
          return false;
        };

    var el = _el('nav', { className: 'wm-menu', attrs: { role: 'menubar', 'aria-label': String(opts.ariaLabel || 'Menu bar') } });
    var buttons = [];
    var _lastFocused = null;
    var popup = null;

    function _execute(item, eventType) {
      if (!item || item.disabled) return;
      if (item.commandId) bindCommand(item.commandId, { source: 'wm.widgets.menu', eventType: eventType, item: item });
      if (typeof item.onClick === 'function') item.onClick(item);
      if (onSelect) onSelect(item);
    }

    function close() {
      if (popup && buttons.some(function (button) { return button.getAttribute('aria-expanded') === 'true'; })) popup.close();
      popup = null;
      buttons.forEach(function (button) { if (button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded', 'false'); });
    }

    function menuItems(items) {
      return items.map(function (item) {
        if (!item || item.separator || item.type === 'separator') return { type: 'separator' };
        return {
          label: item.label, disabled: !!item.disabled, shortcut: item.shortcut, checked: item.checked,
          items: item.items?.length ? menuItems(item.items) : undefined,
          onSelect: function () { _execute(item, 'menu'); },
        };
      });
    }

    function focusButton(button) {
      buttons.forEach(function (entry) { entry.tabIndex = entry === button ? 0 : -1; });
      _lastFocused = button;
      button.focus();
    }

    function open(index, toggle) {
      var entry = entries[index];
      var button = buttons[index];
      if (button.disabled) return;
      if (!entry.items?.length) { _execute(entry, 'click'); return; }
      if (toggle && button.getAttribute('aria-expanded') === 'true') { close(); return; }
      close();
      var rect = button.getBoundingClientRect();
      popup = contextMenu({
        items: menuItems(entry.items), x: rect.left, y: rect.bottom, anchor: button, title: entry.label,
      });
      button.setAttribute('aria-expanded', 'true');
    }

    function _rebuild() {
      close();
      _clearEl(el);
      buttons = [];

      entries.forEach(function (entry, index) {
        var itemBtn = _el('button', {
          className: 'wm-menu-top-item',
          attrs: {
            type: 'button',
            role: 'menuitem',
            'aria-haspopup': entry.items?.length ? 'menu' : null,
            'aria-expanded': entry.items?.length ? 'false' : null,
          },
          text: String(entry && entry.label != null ? entry.label : 'Menu'),
        });

        itemBtn.disabled = !!entry.disabled;
        itemBtn.tabIndex = -1;
        itemBtn.addEventListener('focus', function () { _lastFocused = itemBtn; });
        itemBtn.addEventListener('click', function () { open(index, true); });
        buttons.push(itemBtn);
        el.appendChild(itemBtn);
      });

      var first = buttons.find(function (button) { return !button.disabled; });
      if (first) first.tabIndex = 0;
    }

    el.addEventListener('keydown', function (ev) {
      var available = buttons.filter(function (button) { return !button.disabled; });
      if (!available.length) return;
      var idx = available.indexOf(document.activeElement);
      if (idx < 0) idx = 0;

      if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        focusButton(available[(idx + 1) % available.length]);
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        focusButton(available[(idx - 1 + available.length) % available.length]);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        focusButton(available[0]);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        focusButton(available[available.length - 1]);
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        open(buttons.indexOf(available[idx]));
      } else if (ev.key === 'Escape') {
        close();
      } else if (ev.key && ev.key.length === 1) {
        var ch = ev.key.toLowerCase();
        var match = available.find(function (btn) {
          return String(btn.textContent || '').trim().toLowerCase().indexOf(ch) === 0;
        });
        if (match) focusButton(match);
      }
    });

    _rebuild();
    container.appendChild(el);

    function setItems(items) {
      entries = Array.isArray(items) ? items.slice() : [];
      _rebuild();
    }

    function destroy() {
      close();
      buttons = [];
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, setItems: setItems, close: close, focusLast: function () { if (_lastFocused?.isConnected) focusButton(_lastFocused); }, destroy: destroy };
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  function toolbar(container, opts) {
    if (!_guard(container, 'toolbar')) return null;
    opts = opts || {};

    var groups = Array.isArray(opts.groups) ? opts.groups.slice() : [];
    var overflowStrategy = String(opts.overflowStrategy || 'menu').toLowerCase();
    var _itemMap = Object.create(null);
    var _cleanup = [];

    var bindCommand = typeof opts.executeCommand === 'function'
      ? opts.executeCommand
      : function (id, payload) {
          if (typeof window !== 'undefined' && window.WM && typeof window.WM.executeCommand === 'function') {
            return window.WM.executeCommand(id, payload);
          }
          return false;
        };

    var el = _el('section', { className: 'wm-toolbar', attrs: { role: 'toolbar', 'aria-label': String(opts.ariaLabel || 'Toolbar') } });
    var leftZone = _el('div', { className: 'wm-toolbar-zone wm-toolbar-zone-left' });
    var centerZone = _el('div', { className: 'wm-toolbar-zone wm-toolbar-zone-center' });
    var rightZone = _el('div', { className: 'wm-toolbar-zone wm-toolbar-zone-right' });
    var overflowBtn = _el('button', {
      className: 'wm-toolbar-overflow-btn',
      attrs: { type: 'button', 'aria-label': 'More tools' },
      text: '\u22ef',
    });

    el.appendChild(leftZone);
    el.appendChild(centerZone);
    el.appendChild(rightZone);
    rightZone.appendChild(overflowBtn);

    var _overflowItems = [];
    var _overflowCtx = null;

    function _zoneFor(group) {
      var z = String((group && group.zone) || 'left').toLowerCase();
      if (z === 'center') return centerZone;
      if (z === 'right') return rightZone;
      return leftZone;
    }

    function _decorateToolState(node, item) {
      node.classList.toggle('is-active', !!item.active);
      node.classList.toggle('is-loading', !!item.loading);
      node.disabled = !!item.disabled;
      if (item.type === 'toggle') node.setAttribute('aria-pressed', item.active ? 'true' : 'false');
      if (item.badge != null) node.setAttribute('data-badge', String(item.badge));
      else node.removeAttribute('data-badge');
      if (item.shortcut) node.setAttribute('data-shortcut', String(item.shortcut));
      else node.removeAttribute('data-shortcut');
    }

    function _execute(item, evType) {
      if (!item || item.disabled) return;
      if (item.type === 'toggle') item.active = !item.active;
      if (item.commandId) bindCommand(item.commandId, { source: 'wm.widgets.toolbar', eventType: evType, item: item });
      if (typeof item.onClick === 'function') item.onClick(item);
      var ctrl = _itemMap[String(item.id || '')];
      if (ctrl && ctrl.button) _decorateToolState(ctrl.button, item);
    }

    function _buildButton(item) {
      var btn = _el('button', {
        className: 'wm-tool-btn' + (item.icon && item.label ? ' has-icon-text' : ''),
        attrs: {
          type: 'button',
          role: 'button',
          'aria-pressed': item.type === 'toggle' ? (item.active ? 'true' : 'false') : null,
          title: String(item.tooltip || item.label || item.id || 'Tool'),
        },
      });

      if (item.icon) btn.appendChild(_el('span', { className: 'wm-tool-icon', text: String(item.icon) }));
      if (item.label) btn.appendChild(_el('span', { className: 'wm-tool-label', text: String(item.label) }));
      if (item.loading) btn.appendChild(_el('span', { className: 'wm-tool-spinner', attrs: { 'aria-hidden': 'true' } }));

      _decorateToolState(btn, item);
      btn.addEventListener('click', function () {
        _execute(item, 'click');
        if (item.type === 'toggle') btn.setAttribute('aria-pressed', item.active ? 'true' : 'false');
      });
      return btn;
    }

    function _buildItem(item) {
      if (!item || item.hidden) return null;
      var kind = String(item.type || 'button').toLowerCase();

      if (kind === 'separator') {
        return _el('span', { className: 'wm-tool-separator', attrs: { 'aria-hidden': 'true' } });
      }

      if (kind === 'search') {
        var wrap = _el('label', { className: 'wm-tool-search-wrap' });
        var input = _el('input', {
          className: 'wm-tool-search',
          attrs: { type: 'search', placeholder: String(item.placeholder || 'Search'), 'aria-label': String(item.ariaLabel || item.placeholder || 'Search') },
        });
        if (item.value != null) input.value = String(item.value);
        input.addEventListener('input', function () {
          item.value = input.value;
          if (typeof item.onChange === 'function') item.onChange(input.value, item);
        });
        wrap.appendChild(input);
        _itemMap[String(item.id || ('search_' + Math.random()))] = { item: item, input: input, root: wrap };
        return wrap;
      }

      if (kind === 'split') {
        var splitRoot = _el('div', { className: 'wm-tool-split' });
        var splitCtrl = splitButton(splitRoot, {
          label: item.label,
          primaryAction: { label: item.label, onClick: function () { _execute(item, 'split-main'); }, disabled: !!item.disabled },
          actions: Array.isArray(item.items) ? item.items.map(function (entry) {
            var cmd = Object.assign({}, entry);
            cmd.onClick = function () {
              if (cmd.commandId) bindCommand(cmd.commandId, { source: 'wm.widgets.toolbar.split', item: cmd });
              if (typeof entry.onClick === 'function') entry.onClick(entry);
            };
            return cmd;
          }) : [],
        });
        _itemMap[String(item.id || ('split_' + Math.random()))] = { item: item, split: splitCtrl, root: splitRoot, button: splitRoot.querySelector('.wm-split-btn-main') };
        return splitRoot;
      }

      if (kind === 'dropdown') {
        var dropBtn = _buildButton(item);
        dropBtn.classList.add('is-dropdown');
        dropBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var rect = dropBtn.getBoundingClientRect();
          if (_overflowCtx && _overflowCtx.close) _overflowCtx.close();
          _overflowCtx = contextMenu({
            x: rect.left,
            y: rect.bottom + 6,
            title: item.label || 'Actions',
            items: Array.isArray(item.items) ? item.items.map(function (entry) {
              var next = Object.assign({}, entry);
              if (!next.onClick && next.commandId) {
                next.onClick = function () { bindCommand(next.commandId, { source: 'wm.widgets.toolbar.dropdown', item: next }); };
              }
              return next;
            }) : [],
          });
        });
        _itemMap[String(item.id || ('dropdown_' + Math.random()))] = { item: item, button: dropBtn, root: dropBtn };
        return dropBtn;
      }

      var btn = _buildButton(item);
      _itemMap[String(item.id || ('btn_' + Math.random()))] = { item: item, button: btn, root: btn };
      return btn;
    }

    function _render() {
      Object.values(_itemMap).forEach(function (entry) { if (entry.split) entry.split.destroy(); });
      _clearEl(leftZone);
      _clearEl(centerZone);
      _clearEl(rightZone);
      rightZone.appendChild(overflowBtn);
      _itemMap = Object.create(null);
      _overflowItems = [];

      groups.forEach(function (group, gi) {
        var zone = _zoneFor(group);
        var gEl = _el('div', { className: 'wm-tool-group', attrs: { role: 'group', 'aria-label': String((group && group.label) || ('Group ' + (gi + 1))) } });
        var items = Array.isArray(group && group.items) ? group.items : [];

        items.forEach(function (item) {
          var node = _buildItem(item);
          if (!node) return;
          gEl.appendChild(node);
        });

        zone.appendChild(gEl);
      });

      _refreshOverflow();
    }

    function _refreshOverflow() {
      overflowBtn.hidden = true;
      if (overflowStrategy === 'wrap') {
        el.classList.add('is-wrap');
        return;
      }

      el.classList.remove('is-wrap');
      _overflowItems = [];
      var budget = Math.max(180, el.clientWidth - 56);
      var used = 0;

      var groupsEls = Array.from(el.querySelectorAll('.wm-tool-group'));
      groupsEls.forEach(function (groupEl) {
        Array.from(groupEl.children).forEach(function (child) {
          child.classList.remove('is-overflow-hidden');
          used += (child.offsetWidth || 0);
          if (used > budget && child.classList && !child.classList.contains('wm-tool-separator')) {
            child.classList.add('is-overflow-hidden');
            var id = child.dataset && child.dataset.toolId;
            var fallback = Object.keys(_itemMap).find(function (k) { return _itemMap[k] && _itemMap[k].root === child; });
            if (fallback && _itemMap[fallback]) _overflowItems.push(_itemMap[fallback].item);
          }
        });
      });

      overflowBtn.hidden = _overflowItems.length === 0;
    }

    overflowBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (_overflowCtx && _overflowCtx.close) {
        _overflowCtx.close();
        _overflowCtx = null;
        return;
      }
      var rect = overflowBtn.getBoundingClientRect();
      _overflowCtx = contextMenu({
        x: rect.left,
        y: rect.bottom + 6,
        title: 'More',
        items: _overflowItems.map(function (item) {
          return {
            label: item.label || item.id || 'Item',
            disabled: !!item.disabled,
            checked: !!item.active,
            shortcut: item.shortcut,
            onClick: function () { _execute(item, 'overflow'); },
          };
        }),
      });
    });

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(_refreshOverflow);
      ro.observe(el);
      _cleanup.push(function () { ro.disconnect(); });
    }

    _render();
    container.appendChild(el);

    function _mutateItems(fn) {
      groups.forEach(function (group) {
        (Array.isArray(group && group.items) ? group.items : []).forEach(fn);
      });
      _render();
    }

    function setItems(nextGroups) {
      groups = Array.isArray(nextGroups) ? nextGroups.slice() : [];
      _render();
    }

    function setEnabled(id, enabled) {
      _mutateItems(function (item) { if (String(item.id || '') === String(id || '')) item.disabled = !enabled; });
    }

    function setActive(id, active) {
      _mutateItems(function (item) { if (String(item.id || '') === String(id || '')) item.active = !!active; });
    }

    function setBadge(id, value) {
      _mutateItems(function (item) { if (String(item.id || '') === String(id || '')) item.badge = value; });
    }

    function setLoading(id, loading) {
      _mutateItems(function (item) { if (String(item.id || '') === String(id || '')) item.loading = !!loading; });
    }

    function destroy() {
      if (_overflowCtx && _overflowCtx.close) _overflowCtx.close();
      Object.values(_itemMap).forEach(function (entry) { if (entry.split) entry.split.destroy(); });
      _cleanup.forEach(function (fn) { try { fn(); } catch (_) {} });
      _cleanup = [];
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return {
      el: el,
      setItems: setItems,
      setEnabled: setEnabled,
      setActive: setActive,
      setBadge: setBadge,
      setLoading: setLoading,
      destroy: destroy,
    };
  }

  // ── Split button ───────────────────────────────────────────────────────────
  function splitButton(container, opts) {
    if (!_guard(container, 'splitButton')) return null;
    opts = opts || {};

    var actions = Array.isArray(opts.actions) ? opts.actions.slice() : [];
    var primaryAction = opts.primaryAction || actions[0] || null;

    var el = document.createElement('div');
    el.className = 'wm-split-button';

    var main = _el('button', {
      className: 'wm-split-btn-main',
      attrs: { type: 'button', role: 'button' },
      text: String((primaryAction && primaryAction.label) || opts.label || 'Action'),
    });

    var arrow = _el('button', {
      className: 'wm-split-btn-arrow',
      attrs: { type: 'button', 'aria-label': opts.ariaLabel || 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      text: '\u25be',
    });

    var menuEl = document.createElement('div');
    menuEl.className = 'wm-split-btn-menu';
    menuEl.hidden = true;
    menuEl.id = 'wm-split-menu-' + (++_nextId);
    menuEl.setAttribute('role', 'menu');
    menuEl.setAttribute('aria-label', opts.ariaLabel || 'More actions');
    arrow.setAttribute('aria-controls', menuEl.id);
    arrow.disabled = !actions.some(function (action) { return action && !action.disabled; });
    main.disabled = !!primaryAction?.disabled;

    function closeMenu(restoreFocus) {
      menuEl.hidden = true;
      arrow.setAttribute('aria-expanded', 'false');
      if (restoreFocus) arrow.focus();
    }

    function openMenu(last) {
      if (arrow.disabled) return;
      menuEl.hidden = false;
      arrow.setAttribute('aria-expanded', 'true');
      var available = Array.from(menuEl.querySelectorAll('button:not(:disabled)'));
      (last ? available[available.length - 1] : available[0])?.focus();
    }

    actions.forEach(function (act) {
      var btn = _el('button', {
        className: 'wm-split-btn-menu-item',
        attrs: { type: 'button', role: 'menuitem' },
        text: String(act && act.label != null ? act.label : 'Action'),
      });
      btn.disabled = !!(act && act.disabled);
      btn.tabIndex = -1;
      btn.addEventListener('click', function () {
        closeMenu(true);
        if (act && typeof act.onClick === 'function') act.onClick(act);
      });
      menuEl.appendChild(btn);
    });

    main.addEventListener('click', function () {
      if (primaryAction && typeof primaryAction.onClick === 'function') primaryAction.onClick(primaryAction);
      else if (typeof opts.onClick === 'function') opts.onClick();
    });

    arrow.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menuEl.hidden) openMenu(); else closeMenu(true);
    });
    arrow.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(event.key === 'ArrowUp');
      }
    });
    menuEl.addEventListener('keydown', function (event) {
      var available = Array.from(menuEl.querySelectorAll('button:not(:disabled)'));
      var index = available.indexOf(document.activeElement);
      var target;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); return; }
      if (event.key === 'Tab') { closeMenu(); return; }
      if (event.key === 'ArrowDown') target = (index + 1) % available.length;
      else if (event.key === 'ArrowUp') target = (index - 1 + available.length) % available.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = available.length - 1;
      if (target !== undefined) { event.preventDefault(); available[target].focus(); }
    });

    var onDocClick = function (e) {
      if (!el.contains(e.target)) closeMenu();
    };
    document.addEventListener('mousedown', onDocClick);

    el.appendChild(main);
    el.appendChild(arrow);
    el.appendChild(menuEl);
    container.appendChild(el);

    function setPrimary(action) {
      primaryAction = action || null;
      main.disabled = !!primaryAction?.disabled;
      _clearEl(main);
      _appendContent(main, String((primaryAction && primaryAction.label) || opts.label || 'Action'));
    }

    function destroy() {
      document.removeEventListener('mousedown', onDocClick);
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, setPrimary: setPrimary, openMenu: openMenu, closeMenu: closeMenu, destroy: destroy };
  }

  // ── Hamburger menu ─────────────────────────────────────────────────────────
  function hamburger(container, opts) {
    if (!_guard(container, 'hamburger')) return null;
    opts = opts || {};

    var el = document.createElement('div');
    el.className = 'wm-hamburger';

    var toggle = _el('button', {
      className: 'wm-hamburger-toggle',
      attrs: { type: 'button', 'aria-label': 'Open menu', 'aria-haspopup': 'menu' },
      children: [
        _el('span', {}),
        _el('span', {}),
        _el('span', {}),
      ],
    });

    var panel = document.createElement('div');
    panel.className = 'wm-hamburger-panel';
    panel.hidden = true;

    var menuCtrl = menu(panel, {
      items: Array.isArray(opts.items) ? opts.items : [],
      onSelect: opts.onSelect,
      executeCommand: opts.executeCommand,
    });

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      toggle.classList.toggle('is-open', !panel.hidden);
    });

    var onDocClick = function (e) {
      if (!el.contains(e.target)) {
        panel.hidden = true;
        toggle.classList.remove('is-open');
      }
    };
    document.addEventListener('mousedown', onDocClick);

    el.appendChild(toggle);
    el.appendChild(panel);
    container.appendChild(el);

    function destroy() {
      if (menuCtrl && menuCtrl.destroy) menuCtrl.destroy();
      document.removeEventListener('mousedown', onDocClick);
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, toggle: function () { toggle.click(); }, open: function () { panel.hidden = false; toggle.classList.add('is-open'); }, close: function () { panel.hidden = true; toggle.classList.remove('is-open'); }, destroy: destroy };
  }

  // ── Status bar ─────────────────────────────────────────────────────────────
  function statusBar(container, opts) {
    if (!_guard(container, 'statusBar')) return null;
    opts = opts || {};
    var segments = (opts.segments || opts.items || []).slice();
    var parts = new Map();

    var el = document.createElement('footer');
    el.className = 'wm-statusbar';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', opts.ariaLabel || 'Status');
    el.setAttribute('aria-live', opts.live || 'off');

    function _render() {
      el.innerHTML = '';
      parts.clear();
      segments.forEach(function (seg, idx) {
        var part = document.createElement('div');
        part.className = 'wm-statusbar-segment' + (seg && seg.emphasis ? ' is-emphasis' : '');
        part.setAttribute('data-status-id', String(seg && seg.id != null ? seg.id : idx));
        if (seg?.title) part.title = String(seg.title);
        part.textContent = String(seg && seg.text != null ? seg.text : '');
        parts.set(String(seg?.id ?? idx), part);
        el.appendChild(part);
      });
    }

    _render();
    container.appendChild(el);

    function set(id, text) {
      var sid = String(id != null ? id : '');
      var seg = parts.get(sid);
      if (seg) seg.textContent = String(text != null ? text : '');
    }

    function setSegments(next) {
      segments = Array.isArray(next) ? next.slice() : [];
      _render();
    }

    function destroy() { if (el.parentNode) el.parentNode.removeChild(el); }
    return { el: el, set: set, setItemText: set, setSegments: setSegments, destroy: destroy };
  }

  // ── Lazy loader ────────────────────────────────────────────────────────────
  function lazyLoader(container, opts) {
    if (!_guard(container, 'lazyLoader')) return null;
    opts = opts || {};

    var threshold = Number(opts.threshold != null ? opts.threshold : 0.15);
    var onLoad = typeof opts.onLoad === 'function' ? opts.onLoad : null;
    var loaded = false;

    var el = document.createElement('div');
    el.className = 'wm-lazy-loader' + (opts.placeholderClass ? (' ' + String(opts.placeholderClass)) : '');
    if (opts.placeholderHtml != null) el.innerHTML = String(opts.placeholderHtml);
    container.appendChild(el);

    var obs = null;
    function _doLoad() {
      if (loaded) return;
      loaded = true;
      el.classList.add('is-loaded');
      if (onLoad) onLoad(el);
      if (obs) obs.disconnect();
    }

    if (typeof IntersectionObserver !== 'undefined') {
      obs = new IntersectionObserver(function (entries) {
        if (!entries || !entries[0]) return;
        if (entries[0].isIntersecting) _doLoad();
      }, { threshold: threshold });
      obs.observe(el);
    } else {
      requestAnimationFrame(_doLoad);
    }

    function destroy() {
      if (obs) obs.disconnect();
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, loadNow: _doLoad, isLoaded: function () { return loaded; }, destroy: destroy };
  }

  // ── Help overlay ───────────────────────────────────────────────────────────
  function help(container, opts) {
    if (!_guard(container, 'help')) return null;
    opts = opts || {};

    var steps = Array.isArray(opts.steps) ? opts.steps.slice() : [];
    var index = 0;

    var el = document.createElement('section');
    el.className = 'wm-help-overlay';
    el.hidden = true;

    var cardEl = document.createElement('div');
    cardEl.className = 'wm-help-card';

    var titleEl = document.createElement('h3');
    titleEl.className = 'wm-help-title';

    var bodyEl = document.createElement('div');
    bodyEl.className = 'wm-help-body';

    var actionsEl = document.createElement('div');
    actionsEl.className = 'wm-help-actions';

    var prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'wm-help-btn';
    prevBtn.textContent = 'Back';

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'wm-help-btn is-primary';
    nextBtn.textContent = 'Next';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wm-help-btn';
    closeBtn.textContent = 'Close';

    actionsEl.appendChild(prevBtn);
    actionsEl.appendChild(nextBtn);
    actionsEl.appendChild(closeBtn);
    cardEl.appendChild(titleEl);
    cardEl.appendChild(bodyEl);
    cardEl.appendChild(actionsEl);
    el.appendChild(cardEl);
    container.appendChild(el);

    function _render() {
      var step = steps[index] || {};
      titleEl.textContent = String(step.title != null ? step.title : 'Help');
      if (step.html != null) bodyEl.innerHTML = String(step.html);
      else bodyEl.textContent = String(step.text != null ? step.text : '');
      prevBtn.disabled = index <= 0;
      nextBtn.disabled = index >= steps.length - 1;
    }

    prevBtn.addEventListener('click', function () { if (index > 0) { index -= 1; _render(); } });
    nextBtn.addEventListener('click', function () { if (index < steps.length - 1) { index += 1; _render(); } });
    closeBtn.addEventListener('click', function () { hide(); });

    function show(startIndex) {
      index = Math.max(0, Math.min(steps.length - 1, Number(startIndex != null ? startIndex : index) || 0));
      _render();
      el.hidden = false;
    }
    function hide() { el.hidden = true; }
    function destroy() { if (el.parentNode) el.parentNode.removeChild(el); }

    return { el: el, show: show, hide: hide, destroy: destroy };
  }

  // ── Context menu wrapper ───────────────────────────────────────────────────
  function contextMenu(opts) {
    opts = opts || {};
    var items = Array.isArray(opts.items) ? opts.items : [];

    if (typeof window !== 'undefined' && window.WM && typeof window.WM.contextMenu === 'function') {
      window.WM.contextMenu(items, opts);
      return {
        close: function () {
          if (window.WM && typeof window.WM.closeContextMenu === 'function') window.WM.closeContextMenu();
        }
      };
    }

    var host = (typeof document !== 'undefined') && (document.getElementById('context_menu_container') || document.body);
    if (!host) return null;

    var panels = [];
    function trim(level) {
      while (panels.length > level) {
        var panel = panels.pop();
        panel.anchor?.setAttribute('aria-expanded', 'false');
        panel.el.remove();
      }
    }
    function close() {
      var restore = panels.some(function (panel) { return panel.el.contains(document.activeElement); });
      trim(0);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      opts.anchor?.setAttribute('aria-expanded', 'false');
      if (restore && opts.anchor?.isConnected) opts.anchor.focus();
    }
    function build(entries, level, anchor) {
      trim(level);
      var menuEl = _el('div', {
        className: 'wm-context-menu wm-context-menu-inline',
        attrs: { role: 'menu', 'aria-label': opts.title || 'Menu' },
      });
      var panel = { el: menuEl, anchor: anchor };
      panels.push(panel);
      entries.forEach(function (item) {
        if (!item || item.separator || item.type === 'separator') {
          menuEl.appendChild(_el('div', { className: 'wm-context-menu-separator', attrs: { role: 'separator' } }));
          return;
        }
        var btn = _el('button', {
          className: 'wm-context-menu-item' + (item.items?.length ? ' has-submenu' : ''),
          attrs: { type: 'button', role: 'menuitem', tabindex: '-1' },
          children: _el('span', { className: 'wm-context-menu-item-main', text: item.label ?? 'Action' }),
        });
        btn.disabled = !!item.disabled;
        if (item.items?.length) {
          btn.setAttribute('aria-haspopup', 'menu');
          btn.setAttribute('aria-expanded', 'false');
        }
        btn.addEventListener('click', function () {
          if (item.items?.length) {
            build(item.items, level + 1, btn);
            btn.setAttribute('aria-expanded', 'true');
          } else {
            close();
            if (typeof item.onSelect === 'function') item.onSelect(item);
            else if (typeof item.onClick === 'function') item.onClick(item);
          }
        });
        menuEl.appendChild(btn);
      });
      host.appendChild(menuEl);
      var rect = anchor?.getBoundingClientRect();
      var width = menuEl.offsetWidth || 220;
      var height = menuEl.offsetHeight || 100;
      var x = rect ? rect.right + 4 : Number(opts.x || 0);
      if (rect && x + width > window.innerWidth - 8) x = rect.left - width - 4;
      menuEl.style.left = Math.max(8, Math.min(x, window.innerWidth - width - 8)) + 'px';
      menuEl.style.top = Math.max(8, Math.min(rect ? rect.top : Number(opts.y || 0), window.innerHeight - height - 8)) + 'px';
      menuEl.querySelector('button:not(:disabled)')?.focus();
    }
    function onDown(event) {
      if (opts.anchor?.contains(event.target)) return;
      if (!panels.some(function (panel) { return panel.el.contains(event.target); })) close();
    }
    function onKey(event) {
      var panel = panels.find(function (entry) { return entry.el.contains(document.activeElement); });
      if (!panel) return;
      var available = Array.from(panel.el.querySelectorAll('button:not(:disabled)'));
      var index = available.indexOf(document.activeElement);
      var target;
      if (event.key === 'ArrowDown') target = (index + 1) % available.length;
      else if (event.key === 'ArrowUp') target = (index - 1 + available.length) % available.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = available.length - 1;
      else if (event.key === 'ArrowLeft' && panel.anchor) {
        var anchor = panel.anchor;
        trim(panels.indexOf(panel));
        anchor.focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        close();
        if (event.key === 'Tab') return;
      } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
        if (event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup') !== 'menu') return;
        document.activeElement?.click();
      } else return;
      event.preventDefault();
      event.stopPropagation();
      if (target !== undefined) available[target]?.focus();
    }
    build(items, 0, null);
    opts.anchor?.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return { close: close };
  }

  // ── Module export ────────────────────────────────────────────────────────────
  return { accordion: accordion, tree: tree, list: list, tabs: tabs,
           card: card, cards: cards, badge: badge, sidebar: sidebar, frame: frame,
           breadcrumbs: breadcrumbs, progress: progress, notice: notice, properties: properties, stack: stack,
           dataTable: dataTable, field: field, formLayout: formLayout,
           pagination: pagination, timeline: timeline,
           chips: chips, bottomSheet: bottomSheet,
           split: split, masterDetail: masterDetail,
           menu: menu, toolbar: toolbar, splitButton: splitButton, hamburger: hamburger,
           statusBar: statusBar, lazyLoader: lazyLoader, help: help,
           contextMenu: contextMenu };

})();

if (typeof window !== 'undefined') {
  window.WMWidgets = WMWidgets;
}
