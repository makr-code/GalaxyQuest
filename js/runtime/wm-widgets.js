/**
 * WMWidgets – Android-style UI widget library for WMCore
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
      try { content(target); } catch (_) {}
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

    var el = document.createElement('div');
    el.className = 'wm-accordion';

    var itemEls = items.map(function (item, idx) {
      var itemEl = document.createElement('div');
      itemEl.className = 'wm-accordion-item' + (item.expanded ? ' is-open' : '');

      var headerBtn = document.createElement('button');
      headerBtn.type      = 'button';
      headerBtn.className = 'wm-accordion-header';
      headerBtn.setAttribute('aria-expanded', item.expanded ? 'true' : 'false');
      headerBtn.innerHTML =
        '<span class="wm-accordion-title">' + _esc(String(item.header != null ? item.header : '')) + '</span>' +
        '<span class="wm-accordion-chevron" aria-hidden="true"></span>';

      var bodyEl = document.createElement('div');
      bodyEl.className = 'wm-accordion-body';

      var innerEl = document.createElement('div');
      innerEl.className = 'wm-accordion-body-inner';

      if (typeof item.content === 'function') {
        try { item.content(innerEl); } catch (_) {}
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
          }
        });
      }
      itemEls[i].classList.add('is-open');
      var hdr = itemEls[i].querySelector('.wm-accordion-header');
      if (hdr) hdr.setAttribute('aria-expanded', 'true');
      var cb = items[i] && items[i].onExpand;
      if (typeof cb === 'function') cb(items[i]);
    }

    function collapse(i) {
      if (i < 0 || i >= itemEls.length) return;
      itemEls[i].classList.remove('is-open');
      var hdr = itemEls[i].querySelector('.wm-accordion-header');
      if (hdr) hdr.setAttribute('aria-expanded', 'false');
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

    var el = document.createElement('div');
    el.className = 'wm-tabview';

    var barEl = document.createElement('div');
    barEl.className = 'wm-tab-bar';
    barEl.setAttribute('role', 'tablist');

    var panesEl = document.createElement('div');
    panesEl.className = 'wm-tab-panes';

    el.appendChild(barEl);
    el.appendChild(panesEl);

    function _buildEntry(tabCfg) {
      var id       = String(tabCfg.id != null ? tabCfg.id : '');
      var isActive = (id === _activeId);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-tab-item' + (isActive ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('data-tab-id', id);

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
      pane.hidden = !isActive;

      var rendered = false;
      if (isActive && typeof tabCfg.render === 'function') {
        try { tabCfg.render(pane); } catch (_) {}
        rendered = true;
      }

      btn.addEventListener('click', function () { setActive(id); });

      _tabData[id] = { cfg: tabCfg, btn: btn, pane: pane, rendered: rendered };
      barEl.appendChild(btn);
      panesEl.appendChild(pane);
    }

    tabList.forEach(_buildEntry);
    container.appendChild(el);

    function setActive(id) {
      var sid = String(id != null ? id : '');
      if (!_tabData[sid]) return;
      _activeId = sid;
      Object.keys(_tabData).forEach(function (tid) {
        var entry    = _tabData[tid];
        var isActive = (tid === sid);
        entry.btn.classList.toggle('is-active', isActive);
        entry.btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        entry.pane.classList.toggle('is-active', isActive);
        entry.pane.hidden = !isActive;
        if (isActive && !entry.rendered && typeof entry.cfg.render === 'function') {
          try { entry.cfg.render(entry.pane); } catch (_) {}
          entry.rendered = true;
        }
      });
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
      entry.btn.remove();
      entry.pane.remove();
      delete _tabData[sid];
      tabList = tabList.filter(function (t) { return String(t.id) !== sid; });
      if (_activeId === sid) {
        var firstKey = Object.keys(_tabData)[0];
        _activeId = firstKey || '';
        if (firstKey) setActive(firstKey);
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
      try { opts.body(contentEl); } catch (_) {}
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
        try { newBody(cel); } catch (_) {}
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

    var isHoriz  = String(opts.direction || 'horizontal').toLowerCase() !== 'vertical';
    var ratio    = Math.max(0.05, Math.min(0.95, Number(opts.ratio != null  ? opts.ratio : 0.35)));
    var minA     = Math.max(40,   Number(opts.minA   != null ? opts.minA    : 120));
    var minB     = Math.max(40,   Number(opts.minB   != null ? opts.minB    : 120));
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

    var paneB = document.createElement('div');
    paneB.className = 'wm-split-pane wm-split-pane-b';

    el.appendChild(paneA);
    el.appendChild(divider);
    el.appendChild(paneB);
    container.appendChild(el);

    function _applyRatio(r) {
      ratio = Math.max(0.05, Math.min(0.95, r));
      paneA.style.flex = '0 0 ' + (ratio * 100).toFixed(2) + '%';
    }

    _applyRatio(ratio);
    var dragging = false, startPos = 0, startRatio = 0;

    divider.addEventListener('mousedown', function (e) {
      dragging   = true;
      startPos   = isHoriz ? e.clientX : e.clientY;
      startRatio = ratio;
      e.preventDefault();
    });

    divider.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      dragging   = true;
      startPos   = isHoriz ? t.clientX : t.clientY;
      startRatio = ratio;
      e.preventDefault();
    }, { passive: false });

    function _onDragMove(pos) {
      if (!dragging) return;
      var totalSize = isHoriz ? el.offsetWidth : el.offsetHeight;
      if (totalSize < 1) return;
      var minRatA  = minA / totalSize;
      var minRatB  = minB / totalSize;
      var newRatio = Math.max(minRatA, Math.min(1 - minRatB, startRatio + (pos - startPos) / totalSize));
      _applyRatio(newRatio);
      if (onResize) onResize(ratio);
    }

    document.addEventListener('mousemove', function (e) { _onDragMove(isHoriz ? e.clientX : e.clientY); });
    document.addEventListener('mouseup',   function ()  { dragging = false; });
    document.addEventListener('touchmove', function (e) {
      var t = e.touches[0]; _onDragMove(isHoriz ? t.clientX : t.clientY);
    }, { passive: true });
    document.addEventListener('touchend', function () { dragging = false; });

    divider.addEventListener('keydown', function (e) {
      var step = 0.05;
      var acted = false;
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { _applyRatio(ratio - step); acted = true; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  { _applyRatio(ratio + step); acted = true; }
      if (acted) { e.preventDefault(); if (onResize) onResize(ratio); }
    });

    function setRatio(r) { _applyRatio(r); }
    function destroy()   { if (el.parentNode) el.parentNode.removeChild(el); }
    return { el: el, paneA: paneA, paneB: paneB, setRatio: setRatio, destroy: destroy };
  }

  // ── MasterDetail ─────────────────────────────────────────────────────────────
  function masterDetail(container, opts) {
    if (!_guard(container, 'masterDetail')) return null;
    opts = opts || {};

    var masterWidth    = opts.masterWidth  != null ? opts.masterWidth  : 260;
    var breakpoint     = Number(opts.breakpoint != null ? opts.breakpoint : 600);
    var renderMasterFn = typeof opts.renderMaster === 'function' ? opts.renderMaster : null;
    var renderDetailFn = typeof opts.renderDetail === 'function' ? opts.renderDetail : null;
    var _showingDetail = !!(opts.defaultView === 'detail');

    var el = document.createElement('div');
    el.className = 'wm-masterdetail';
    el.style.setProperty('--md-master-width',
      typeof masterWidth === 'number' ? masterWidth + 'px' : String(masterWidth));

    var masterEl = document.createElement('div');
    masterEl.className = 'wm-md-master';

    var detailEl = document.createElement('div');
    detailEl.className = 'wm-md-detail';

    el.appendChild(masterEl);
    el.appendChild(detailEl);
    container.appendChild(el);

    if (renderMasterFn) try { renderMasterFn(masterEl); } catch (_) {}
    if (renderDetailFn) try { renderDetailFn(detailEl); } catch (_) {}

    function _syncVisibility() {
      var narrow = el.offsetWidth > 0 && el.offsetWidth < breakpoint;
      if (narrow) {
        masterEl.classList.toggle('is-hidden',  _showingDetail);
        detailEl.classList.toggle('is-hidden', !_showingDetail);
      } else {
        masterEl.classList.remove('is-hidden');
        detailEl.classList.remove('is-hidden');
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

    return { el: el, master: masterEl, detail: detailEl, showDetail: showDetail, showMaster: showMaster, destroy: destroy };
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
    var _allButtons = [];
    var _lastFocused = null;

    function _registerButton(btn) {
      if (!(btn instanceof HTMLElement)) return;
      _allButtons.push(btn);
      btn.tabIndex = -1;
      btn.addEventListener('focus', function () { _lastFocused = btn; });
    }

    function _focusButton(btn) {
      if (!(btn instanceof HTMLElement)) return;
      _allButtons.forEach(function (b) { b.tabIndex = -1; });
      btn.tabIndex = 0;
      btn.focus();
    }

    function _execute(item, eventType) {
      if (!item || item.disabled) return;
      if (item.commandId) bindCommand(item.commandId, { source: 'wm.widgets.menu', eventType: eventType, item: item });
      if (typeof item.onClick === 'function') item.onClick(item);
      if (onSelect) onSelect(item);
    }

    function _buildSubmenu(items) {
      var list = _el('ul', { className: 'wm-submenu', attrs: { role: 'menu' } });

      (Array.isArray(items) ? items : []).forEach(function (item) {
        if (!item || item.separator) {
          list.appendChild(_el('li', { className: 'wm-menu-separator', attrs: { role: 'separator' } }));
          return;
        }

        var li = _el('li', {
          className: 'wm-menu-item' + (item.disabled ? ' is-disabled' : '') + (item.items && item.items.length ? ' has-submenu' : ''),
          attrs: { role: 'menuitem', 'aria-haspopup': item.items && item.items.length ? 'true' : 'false' },
        });

        var labelWrap = _el('span', { className: 'wm-menu-label-wrap' });
        labelWrap.appendChild(_el('span', { className: 'wm-menu-label', text: String(item.label != null ? item.label : 'Action') }));
        if (item.shortcut) {
          labelWrap.appendChild(_el('span', { className: 'wm-menu-shortcut', text: String(item.shortcut) }));
        }
        li.appendChild(labelWrap);

        if (item.items && item.items.length) {
          li.appendChild(_buildSubmenu(item.items));
        }

        if (!item.disabled) {
          _registerButton(li);
          li.addEventListener('click', function (ev) {
            ev.stopPropagation();
            _execute(item, 'click');
          });
          li.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              _execute(item, 'keyboard');
            }
          });
        }

        list.appendChild(li);
      });

      return list;
    }

    function _rebuild() {
      _clearEl(el);
      _allButtons = [];

      entries.forEach(function (entry) {
        var itemBtn = _el('button', {
          className: 'wm-menu-top-item',
          attrs: {
            type: 'button',
            role: 'menuitem',
            'aria-haspopup': entry && Array.isArray(entry.items) && entry.items.length ? 'true' : 'false',
          },
          text: String(entry && entry.label != null ? entry.label : 'Menu'),
        });

        var wrap = _el('div', { className: 'wm-menu-top' });
        wrap.appendChild(itemBtn);

        if (entry && Array.isArray(entry.items) && entry.items.length) {
          wrap.appendChild(_buildSubmenu(entry.items));
        } else {
          itemBtn.addEventListener('click', function () { _execute(entry || null, 'click'); });
        }

        _registerButton(itemBtn);
        el.appendChild(wrap);
      });

      if (_allButtons.length) _focusButton(_allButtons[0]);
    }

    el.addEventListener('keydown', function (ev) {
      if (!_allButtons.length) return;
      var idx = _allButtons.indexOf(_lastFocused || document.activeElement);
      if (idx < 0) idx = 0;

      if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        _focusButton(_allButtons[(idx + 1) % _allButtons.length]);
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        _focusButton(_allButtons[(idx - 1 + _allButtons.length) % _allButtons.length]);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        _focusButton(_allButtons[0]);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        _focusButton(_allButtons[_allButtons.length - 1]);
      } else if (ev.key && ev.key.length === 1) {
        var ch = ev.key.toLowerCase();
        var match = _allButtons.find(function (btn) {
          return String(btn.textContent || '').trim().toLowerCase().indexOf(ch) === 0;
        });
        if (match) _focusButton(match);
      }
    });

    _rebuild();
    container.appendChild(el);

    function setItems(items) {
      entries = Array.isArray(items) ? items.slice() : [];
      _rebuild();
    }

    function destroy() {
      _allButtons = [];
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, setItems: setItems, focusLast: function () { if (_lastFocused) _focusButton(_lastFocused); }, destroy: destroy };
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
          role: item.type === 'toggle' ? 'switch' : 'button',
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
      attrs: { type: 'button', 'aria-label': 'More actions', role: 'button', 'aria-haspopup': 'menu' },
      text: '\u25be',
    });

    var menuEl = document.createElement('div');
    menuEl.className = 'wm-split-btn-menu';
    menuEl.hidden = true;

    actions.forEach(function (act) {
      var btn = _el('button', {
        className: 'wm-split-btn-menu-item',
        attrs: { type: 'button', role: 'menuitem' },
        text: String(act && act.label != null ? act.label : 'Action'),
      });
      btn.disabled = !!(act && act.disabled);
      btn.addEventListener('click', function () {
        menuEl.hidden = true;
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
      menuEl.hidden = !menuEl.hidden;
    });

    var onDocClick = function (e) {
      if (!el.contains(e.target)) menuEl.hidden = true;
    };
    document.addEventListener('mousedown', onDocClick);

    el.appendChild(main);
    el.appendChild(arrow);
    el.appendChild(menuEl);
    container.appendChild(el);

    function setPrimary(action) {
      primaryAction = action || null;
      _clearEl(main);
      _appendContent(main, String((primaryAction && primaryAction.label) || opts.label || 'Action'));
    }

    function destroy() {
      document.removeEventListener('mousedown', onDocClick);
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    return { el: el, setPrimary: setPrimary, openMenu: function () { menuEl.hidden = false; }, closeMenu: function () { menuEl.hidden = true; }, destroy: destroy };
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
    var segments = Array.isArray(opts.segments) ? opts.segments.slice() : [];

    var el = document.createElement('footer');
    el.className = 'wm-statusbar';

    function _render() {
      el.innerHTML = '';
      segments.forEach(function (seg, idx) {
        var part = document.createElement('div');
        part.className = 'wm-statusbar-segment' + (seg && seg.emphasis ? ' is-emphasis' : '');
        part.setAttribute('data-status-id', String(seg && seg.id != null ? seg.id : idx));
        part.textContent = String(seg && seg.text != null ? seg.text : '');
        el.appendChild(part);
      });
    }

    _render();
    container.appendChild(el);

    function set(id, text) {
      var sid = String(id != null ? id : '');
      var seg = el.querySelector('[data-status-id="' + sid.replace(/"/g, '') + '"]');
      if (seg) seg.textContent = String(text != null ? text : '');
    }

    function setSegments(next) {
      segments = Array.isArray(next) ? next.slice() : [];
      _render();
    }

    function destroy() { if (el.parentNode) el.parentNode.removeChild(el); }
    return { el: el, set: set, setSegments: setSegments, destroy: destroy };
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

    var menuEl = document.createElement('div');
    menuEl.className = 'wm-context-menu wm-context-menu-inline';
    menuEl.style.position = 'fixed';
    menuEl.style.left = String(Number(opts.x || 0)) + 'px';
    menuEl.style.top = String(Number(opts.y || 0)) + 'px';

    items.forEach(function (item) {
      if (!item || item.separator) {
        var sep = document.createElement('div');
        sep.className = 'wm-context-menu-separator';
        menuEl.appendChild(sep);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-context-menu-item';
      btn.textContent = String(item.label != null ? item.label : 'Action');
      btn.disabled = !!item.disabled;
      btn.addEventListener('click', function () {
        if (typeof item.onClick === 'function') item.onClick(item);
        if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
      });
      menuEl.appendChild(btn);
    });

    host.appendChild(menuEl);

    var onDown = function (e) {
      if (!menuEl.contains(e.target)) {
        document.removeEventListener('mousedown', onDown, true);
        if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
      }
    };
    document.addEventListener('mousedown', onDown, true);

    return {
      close: function () {
        document.removeEventListener('mousedown', onDown, true);
        if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
      }
    };
  }

  // ── Module export ────────────────────────────────────────────────────────────
  return { accordion: accordion, tree: tree, list: list, tabs: tabs,
           card: card, chips: chips, bottomSheet: bottomSheet,
           split: split, masterDetail: masterDetail,
           menu: menu, toolbar: toolbar, splitButton: splitButton, hamburger: hamburger,
           statusBar: statusBar, lazyLoader: lazyLoader, help: help,
           contextMenu: contextMenu };

})();

if (typeof window !== 'undefined') {
  window.WMWidgets = WMWidgets;
}
