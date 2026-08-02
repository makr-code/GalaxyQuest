/**
 * Complex Window Manager für GalaxyQuest Ship Designer
 * Verwaltet dockable, resizable Panels mit Tab-System
 */

class WindowManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.panels = new Map();
    this.activePanel = null;
    this.layout = 'default';
    this.isDraggingResize = false;
    this.resizeState = null;
    
    this.initializeDOM();
    this.loadLayout();
  }

  initializeDOM() {
    // Root layout container
    this.container.innerHTML = `
      <div class="wm-root" data-layout="${this.layout}">
        <div class="wm-workspace">
          <div class="wm-panel-container wm-left-sidebar">
            <div class="wm-panel-tabs"></div>
            <div class="wm-panel-content"></div>
            <div class="wm-resize-handle wm-resize-vertical" data-direction="right"></div>
          </div>
          
          <div class="wm-main-area">
            <div class="wm-panel-container wm-top-panel">
              <div class="wm-panel-tabs"></div>
              <div class="wm-panel-content"></div>
              <div class="wm-resize-handle wm-resize-horizontal" data-direction="down"></div>
            </div>
            
            <div class="wm-panel-container wm-center-panel">
              <div class="wm-panel-tabs"></div>
              <div class="wm-panel-content"></div>
            </div>
          </div>
          
          <div class="wm-panel-container wm-right-sidebar">
            <div class="wm-panel-tabs"></div>
            <div class="wm-panel-content"></div>
            <div class="wm-resize-handle wm-resize-vertical" data-direction="left"></div>
          </div>
        </div>
      </div>
    `;

    this.root = this.container.querySelector('.wm-root');
    this.workspace = this.container.querySelector('.wm-workspace');
    this.setupResizeHandles();
  }

  setupResizeHandles() {
    const handles = this.container.querySelectorAll('.wm-resize-handle');
    handles.forEach(handle => {
      handle.addEventListener('mousedown', (e) => this.startResize(e));
    });
    document.addEventListener('mousemove', (e) => this.onResize(e));
    document.addEventListener('mouseup', (e) => this.stopResize(e));
  }

  startResize(e) {
    this.isDraggingResize = true;
    const handle = e.currentTarget;
    const direction = handle.dataset.direction;
    const panelContainer = handle.closest('.wm-panel-container');
    
    this.resizeState = {
      startX: e.clientX,
      startY: e.clientY,
      direction: direction,
      panelContainer: panelContainer,
      initialWidth: panelContainer.offsetWidth,
      initialHeight: panelContainer.offsetHeight
    };
  }

  onResize(e) {
    if (!this.isDraggingResize || !this.resizeState) return;

    const state = this.resizeState;
    const deltaX = e.clientX - state.startX;
    const deltaY = e.clientY - state.startY;

    if (state.direction === 'right') {
      state.panelContainer.style.width = (state.initialWidth + deltaX) + 'px';
    } else if (state.direction === 'left') {
      state.panelContainer.style.width = (state.initialWidth - deltaX) + 'px';
    } else if (state.direction === 'down') {
      state.panelContainer.style.height = (state.initialHeight + deltaY) + 'px';
    } else if (state.direction === 'up') {
      state.panelContainer.style.height = (state.initialHeight - deltaY) + 'px';
    }
  }

  stopResize() {
    if (this.isDraggingResize && this.resizeState) {
      this.saveLayout();
    }
    this.isDraggingResize = false;
    this.resizeState = null;
  }

  registerPanel(panelId, location, options = {}) {
    const panel = {
      id: panelId,
      location: location,
      title: options.title || panelId,
      component: options.component || null,
      state: options.initialState || {},
      width: options.width,
      height: options.height,
      active: options.active || false,
      closeable: options.closeable !== false,
      resizable: options.resizable !== false,
      tabs: []
    };

    this.panels.set(panelId, panel);
    this.renderPanel(panelId, location);
  }

  registerTab(panelId, tabId, options = {}) {
    const panel = this.panels.get(panelId);
    if (!panel) {
      console.error('[WindowManager] Panel nicht gefunden:', panelId);
      return;
    }

    const tab = {
      id: tabId,
      panelId: panelId,
      title: options.title || tabId,
      icon: options.icon || '',
      component: options.component || null,
      active: options.active === true,
      closeable: options.closeable !== false
    };

    panel.tabs.push(tab);
    this.renderPanelTabs(panelId);
  }

  renderPanel(panelId, location) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    const locationMap = {
      'left': '.wm-left-sidebar',
      'right': '.wm-right-sidebar',
      'top': '.wm-top-panel',
      'center': '.wm-center-panel'
    };

    const panelElement = this.container.querySelector(locationMap[location]);
    if (!panelElement) return;

    const tabsContainer = panelElement.querySelector('.wm-panel-tabs');
    const contentContainer = panelElement.querySelector('.wm-panel-content');

    if (panel.width) {
      panelElement.style.width = panel.width;
    }
    if (panel.height) {
      panelElement.style.height = panel.height;
    }

    this.renderPanelTabs(panelId);
  }

  renderPanelTabs(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    const locationMap = {
      'left': '.wm-left-sidebar',
      'right': '.wm-right-sidebar',
      'top': '.wm-top-panel',
      'center': '.wm-center-panel'
    };

    const panelElement = this.container.querySelector(locationMap[panel.location]);
    const tabsContainer = panelElement?.querySelector('.wm-panel-tabs');
    
    if (!tabsContainer) return;

    tabsContainer.innerHTML = '';
    
    panel.tabs.forEach(tab => {
      const tabButton = document.createElement('button');
      tabButton.className = `wm-tab ${tab.active ? 'active' : ''}`;
      tabButton.innerHTML = `
        <span class="wm-tab-icon">${tab.icon}</span>
        <span class="wm-tab-label">${tab.title}</span>
        ${tab.closeable ? '<span class="wm-tab-close" data-tab-id="' + tab.id + '">✕</span>' : ''}
      `;
      
      tabButton.addEventListener('click', () => this.activateTab(panelId, tab.id));
      tabsContainer.appendChild(tabButton);
    });

    this.renderTabContent(panelId);
  }

  renderTabContent(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    const locationMap = {
      'left': '.wm-left-sidebar',
      'right': '.wm-right-sidebar',
      'top': '.wm-top-panel',
      'center': '.wm-center-panel'
    };

    const panelElement = this.container.querySelector(locationMap[panel.location]);
    const contentContainer = panelElement?.querySelector('.wm-panel-content');
    
    if (!contentContainer) return;

    contentContainer.innerHTML = '';
    
    const activeTab = panel.tabs.find(t => t.active);
    if (activeTab && activeTab.component) {
      contentContainer.appendChild(activeTab.component);
    }
  }

  activateTab(panelId, tabId) {
    const panel = this.panels.get(panelId);
    if (!panel) return;

    panel.tabs.forEach(tab => {
      tab.active = (tab.id === tabId);
    });

    this.renderPanelTabs(panelId);
    this.saveLayout();
  }

  switchLayout(layoutName) {
    this.layout = layoutName;
    this.root.dataset.layout = layoutName;
    this.saveLayout();
    
    // Trigger layout-specific adjustments
    this.onLayoutChange(layoutName);
  }

  onLayoutChange(layoutName) {
    // Implement specific layout behaviors
    console.log('[WindowManager] Layout changed to:', layoutName);
  }

  saveLayout() {
    const layoutState = {
      layout: this.layout,
      panels: Array.from(this.panels.values()).map(p => ({
        id: p.id,
        location: p.location,
        width: p.width,
        height: p.height,
        tabs: p.tabs.map(t => ({
          id: t.id,
          active: t.active
        }))
      }))
    };

    localStorage.setItem('wm_layout_state', JSON.stringify(layoutState));
    console.log('[WindowManager] Layout saved');
  }

  loadLayout() {
    const saved = localStorage.getItem('wm_layout_state');
    if (saved) {
      try {
        const layoutState = JSON.parse(saved);
        this.layout = layoutState.layout;
        console.log('[WindowManager] Layout loaded:', this.layout);
      } catch (e) {
        console.warn('[WindowManager] Failed to load layout:', e);
      }
    }
  }

  getPanelState(panelId) {
    const panel = this.panels.get(panelId);
    return panel ? panel.state : null;
  }

  setPanelState(panelId, state) {
    const panel = this.panels.get(panelId);
    if (panel) {
      panel.state = { ...panel.state, ...state };
      this.saveLayout();
    }
  }

  getActiveTab(panelId) {
    const panel = this.panels.get(panelId);
    return panel ? panel.tabs.find(t => t.active) : null;
  }

  getLayout() {
    return {
      layout: this.layout,
      panels: Array.from(this.panels.entries()).map(([id, p]) => ({
        id,
        location: p.location,
        tabs: p.tabs.map(t => t.id)
      }))
    };
  }
}

window.WindowManager = WindowManager;
