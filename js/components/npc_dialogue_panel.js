/**
 * NPC Dialogue Panel Component
 * ============================
 * Unified dialogue interface for interacting with NPCs
 * Integrates with NpcDialogueSystem for backend communication
 * 
 * Usage:
 *   const panel = new NPCDialoguePanel({
 *     containerId: 'npc-panel',
 *     npcId: 'npc_commander_01',
 *     npcName: 'Commander Vex',
 *     faction: 'Federation'
 *   });
 *   panel.render();
 */

class NPCDialoguePanel {
  constructor(options = {}) {
    this.options = {
      containerId: options.containerId || 'npc-dialogue-panel',
      npcId: options.npcId || 'npc_unknown',
      npcName: options.npcName || 'Unknown NPC',
      faction: options.faction || 'Neutral',
      playerId: options.playerId || localStorage.getItem('player_id') || '1',
      apiBaseUrl: options.apiBaseUrl || '/api',
      maxHistoryItems: options.maxHistoryItems || 50,
      autoLoadHistory: options.autoLoadHistory !== false,
    };

    this.state = {
      isOpen: false,
      isLoading: false,
      messages: [],
      sessionId: null,
      agentInfo: null,
      cacheStats: { hits: 0, misses: 0 },
      error: null,
    };

    this.elements = {};
    this.dialogueSystem = null;
    this.onResponseCallback = null; // Callback after response is generated
    this.init();
  }

  init() {
    // Initialize dialogue system
    this.dialogueSystem = new NpcDialogueSystem();
    
    // Validate container exists
    const container = document.getElementById(this.options.containerId);
    if (!container) {
      console.error(`NPCDialoguePanel: Container #${this.options.containerId} not found`);
      return;
    }

    this.containerElement = container;
    this.setupElements();
    
    if (this.options.autoLoadHistory) {
      this.loadHistory();
    }
  }

  setupElements() {
    this.containerElement.innerHTML = this.getTemplate();
    
    // Cache DOM references
    this.elements = {
      panel: this.containerElement.querySelector('.npc-panel'),
      header: this.containerElement.querySelector('.npc-panel-header'),
      content: this.containerElement.querySelector('.npc-panel-content'),
      messageList: this.containerElement.querySelector('.npc-messages-list'),
      quickReplies: this.containerElement.querySelector('.npc-quick-replies'),
      inputForm: this.containerElement.querySelector('.npc-input-form'),
      inputField: this.containerElement.querySelector('.npc-message-input'),
      sendBtn: this.containerElement.querySelector('.npc-send-btn'),
      closeBtn: this.containerElement.querySelector('.npc-close-btn'),
      dockBtn: this.containerElement.querySelector('.npc-dock-btn'),
      statusBar: this.containerElement.querySelector('.npc-status-bar'),
      typingIndicator: this.containerElement.querySelector('.npc-typing-indicator'),
      agentBadge: this.containerElement.querySelector('.npc-agent-badge'),
      cacheIndicator: this.containerElement.querySelector('.npc-cache-indicator'),
    };

    // Attach event listeners
    this.attachListeners();
  }

  attachListeners() {
    // Send message
    this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
    this.elements.inputForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendMessage();
    });

    // Close panel
    this.elements.closeBtn.addEventListener('click', () => this.close());

    // Dock panel
    if (this.elements.dockBtn) {
      this.elements.dockBtn.addEventListener('click', () => this.showDockMenu());
    }

    // Input handling
    this.elements.inputField.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-scroll to latest message
    this.elements.messageList.addEventListener('DOMNodeInserted', () => {
      this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
    });
  }

  getTemplate() {
    return `
      <div class="npc-panel npc-panel-closed">
        <!-- Header -->
        <div class="npc-panel-header">
          <div class="npc-header-info">
            <h3 class="npc-name">${this.escape(this.options.npcName)}</h3>
            <div class="npc-meta">
              <span class="npc-faction">${this.escape(this.options.faction)}</span>
              <span class="npc-agent-badge" title="Agent type">—</span>
              <span class="npc-cache-indicator" title="Cache status">○</span>
            </div>
          </div>
          <button class="npc-close-btn" aria-label="Close dialogue" title="Close (Esc)">
            <svg class="icon-close" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="npc-dock-btn" aria-label="Dock/Undock panel" title="Dock left/right/floating">
            <svg class="icon-dock" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="16" height="16" stroke="currentColor" stroke-width="1.5" rx="1"/>
              <line x1="8" y1="2" x2="8" y2="18" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>

        <!-- Messages -->
        <div class="npc-panel-content">
          <div class="npc-messages-list"></div>
          <div class="npc-typing-indicator" style="display: none;">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>

        <!-- Quick Replies -->
        <div class="npc-quick-replies"></div>

        <!-- Input -->
        <form class="npc-input-form">
          <textarea 
            class="npc-message-input" 
            placeholder="Ask the NPC something..."
            rows="3"
            autocomplete="off"
          ></textarea>
          <div class="npc-input-controls">
            <span class="npc-char-count">0</span>
            <button class="npc-send-btn" type="submit" aria-label="Send message">
              <svg class="icon-send" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M2 9L16 2L9 16L8 10L2 9Z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </form>

        <!-- Status Bar -->
        <div class="npc-status-bar">
          <span class="npc-status-text">Ready</span>
          <span class="npc-latency-indicator" title="Response time">—</span>
        </div>
      </div>
    `;
  }

  async open(gameContext = {}) {
    if (this.state.isOpen) return;

    this.state.isOpen = true;
    this.elements.panel.classList.remove('npc-panel-closed');
    
    // Load agent info
    await this.loadAgentInfo();
    
    // Focus input
    this.elements.inputField.focus();
    
    this.updateStatus('Ready for dialogue');
  }

  close() {
    if (!this.state.isOpen) return;

    this.state.isOpen = false;
    this.elements.panel.classList.add('npc-panel-closed');
    this.updateStatus('Dialogue closed');
  }

  async sendMessage() {
    const text = this.elements.inputField.value.trim();
    
    if (!text) return;
    if (this.state.isLoading) return;

    // Add user message to UI
    this.addMessage('user', text);
    this.elements.inputField.value = '';
    this.updateCharCount();

    this.state.isLoading = true;
    this.showTypingIndicator(true);
    this.updateStatus('Generating response...');

    try {
      const startTime = performance.now();

      // Call backend
      const response = await this.dialogueSystem.generateNpcResponse(
        this.options.npcId,
        this.options.playerId,
        text,
        { faction: this.options.faction }
      );

      const latency = Math.round(performance.now() - startTime);
      this.state.messages.push(...(response.messages || []));

      // Add assistant response
      this.addMessage('assistant', response.response, {
        fromCache: response.from_cache,
        latency: latency,
        sessionId: response.session_id,
      });

      // Update cache stats
      if (response.from_cache) {
        this.state.cacheStats.hits++;
      } else {
        this.state.cacheStats.misses++;
      }

      this.updateCacheIndicator();
      this.updateLatency(latency);
      this.updateStatus(`Response received (${latency}ms)`);

      // Call response callback if set (e.g., for updating quick replies)
      if (typeof this.onResponseCallback === 'function') {
        this.onResponseCallback({
          userMessage: text,
          assistantResponse: response.response,
          npcId: this.options.npcId,
          playerId: this.options.playerId,
          latency: latency,
        });
      }

    } catch (error) {
      console.error('NPC dialogue error:', error);
      this.addMessage('system', `Error: ${error.message || 'Failed to generate response'}`);
      this.updateStatus(`Error: ${error.message}`);
    } finally {
      this.state.isLoading = false;
      this.showTypingIndicator(false);
    }
  }

  addMessage(role, content, metadata = {}) {
    const messageEl = document.createElement('div');
    messageEl.className = `npc-message npc-message-${role}`;
    
    const roleClass = {
      'user': 'user-message',
      'assistant': 'npc-response',
      'system': 'system-message'
    }[role] || 'message';

    messageEl.innerHTML = `
      <div class="message-bubble ${roleClass}">
        <div class="message-content">${this.escape(content)}</div>
        ${metadata.latency ? `<div class="message-meta">↻ ${metadata.latency}ms</div>` : ''}
        ${metadata.fromCache ? `<div class="message-meta cache">⚡ cached</div>` : ''}
      </div>
    `;

    this.elements.messageList.appendChild(messageEl);

    // Store in state
    this.state.messages.push({
      role,
      content,
      timestamp: Date.now(),
      ...metadata
    });

    // Limit history
    if (this.state.messages.length > this.options.maxHistoryItems) {
      this.state.messages.shift();
      this.elements.messageList.firstChild?.remove();
    }
  }

  async loadHistory() {
    try {
      const history = await this.dialogueSystem.getConversationHistory(
        this.options.playerId,
        this.options.npcId
      );

      if (history && Array.isArray(history)) {
        this.state.messages = history;
        this.renderMessages();
      }
    } catch (error) {
      console.warn('Failed to load conversation history:', error);
    }
  }

  async loadAgentInfo() {
    try {
      const agents = await this.dialogueSystem.getAvailableAgents();
      const agentInfo = agents.find(a => 
        a.type === this.getAgentTypeFromNpcId(this.options.npcId)
      );

      if (agentInfo) {
        this.state.agentInfo = agentInfo;
        this.updateAgentBadge();
      }
    } catch (error) {
      console.warn('Failed to load agent info:', error);
    }
  }

  renderMessages() {
    this.elements.messageList.innerHTML = '';
    this.state.messages.forEach(msg => {
      this.addMessage(msg.role, msg.content, {
        fromCache: msg.fromCache,
        latency: msg.latency
      });
    });
  }

  /**
   * Render quick reply suggestions
   * @param {Array<string>} suggestions - Array of suggestion texts
   */
  renderQuickReplies(suggestions = []) {
    this.elements.quickReplies.innerHTML = '';
    
    if (!suggestions || suggestions.length === 0) {
      return;
    }

    const container = document.createElement('div');
    container.className = 'npc-quick-replies-container';
    
    suggestions.forEach(suggestion => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'npc-quick-reply-btn';
      btn.textContent = suggestion;
      btn.addEventListener('click', () => {
        this.elements.inputField.value = suggestion;
        this.sendMessage();
      });
      container.appendChild(btn);
    });

    this.elements.quickReplies.appendChild(container);
  }

  /**
   * Clear quick replies
   */
  clearQuickReplies() {
    this.elements.quickReplies.innerHTML = '';
  }

  updateAgentBadge() {
    if (!this.state.agentInfo) return;
    const type = this.state.agentInfo.type || 'agent';
    this.elements.agentBadge.textContent = type.substring(0, 1).toUpperCase();
    this.elements.agentBadge.title = `Agent: ${this.state.agentInfo.name || type}`;
  }

  updateCacheIndicator() {
    const ratio = this.state.cacheStats.hits / 
                  (this.state.cacheStats.hits + this.state.cacheStats.misses) || 0;
    
    if (ratio > 0.7) {
      this.elements.cacheIndicator.textContent = '⚡';
      this.elements.cacheIndicator.title = `Cache hit rate: ${Math.round(ratio * 100)}%`;
    } else if (ratio > 0.3) {
      this.elements.cacheIndicator.textContent = '◐';
      this.elements.cacheIndicator.title = `Cache hit rate: ${Math.round(ratio * 100)}%`;
    } else {
      this.elements.cacheIndicator.textContent = '○';
      this.elements.cacheIndicator.title = `Cache hit rate: ${Math.round(ratio * 100)}%`;
    }
  }

  updateLatency(ms) {
    const indicator = this.containerElement.querySelector('.npc-latency-indicator');
    if (indicator) {
      indicator.textContent = `${ms}ms`;
      indicator.style.color = ms < 1000 ? '#4fbf73' : ms < 2000 ? '#ffd37f' : '#ff9f9f';
    }
  }

  updateStatus(text) {
    const statusText = this.containerElement.querySelector('.npc-status-text');
    if (statusText) {
      statusText.textContent = text;
    }
  }

  showTypingIndicator(show) {
    this.elements.typingIndicator.style.display = show ? 'flex' : 'none';
  }

  updateCharCount() {
    const count = this.elements.inputField.value.length;
    const charCount = this.containerElement.querySelector('.npc-char-count');
    if (charCount) {
      charCount.textContent = count;
    }
  }

  /**
   * Show dock position menu
   */
  showDockMenu() {
    // Show custom menu with direct callbacks, not WM contextMenu
    this.showDockMenuCustom();
  }

  /**
   * Custom dock menu with direct fallbackDock callbacks
   */
  showDockMenuCustom() {
    const menuItems = [
      { label: '⬅️ Dock Left', action: 'left' },
      { label: '➡️ Dock Right', action: 'right' },
      { label: '⬇️ Dock Bottom', action: 'bottom' },
      { label: '🪟 Floating', action: 'floating' }
    ];

    // Create menu
    const menu = document.createElement('div');
    menu.style.position = 'fixed';
    menu.style.background = 'rgba(10, 25, 45, 0.98)';
    menu.style.border = '1px solid rgba(79, 191, 115, 0.3)';
    menu.style.borderRadius = '4px';
    menu.style.zIndex = '99999';
    menu.style.padding = '8px 0';
    menu.style.minWidth = '180px';
    menu.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
    
    const dockBtn = this.elements?.dockBtn;
    if (dockBtn) {
      const rect = dockBtn.getBoundingClientRect();
      menu.style.left = (rect.left + rect.width / 2 - 90) + 'px';
      menu.style.top = (rect.bottom + 8) + 'px';
    }

    menuItems.forEach(item => {
      const option = document.createElement('div');
      option.style.padding = '10px 16px';
      option.style.cursor = 'pointer';
      option.style.color = '#e8f4f8';
      option.style.userSelect = 'none';
      option.style.transition = 'background 0.2s';
      option.style.fontSize = '14px';
      option.textContent = item.label;
      
      option.addEventListener('mouseover', () => {
        option.style.background = 'rgba(79, 191, 115, 0.25)';
      });
      option.addEventListener('mouseout', () => {
        option.style.background = 'transparent';
      });
      option.addEventListener('click', () => {
        console.log(`[npc-panel] Menu action clicked: ${item.action}`);
        this.fallbackDock(item.action);  // DIRECT CALL TO FALLBACK DOCK
        document.body.removeChild(menu);
      });
      
      menu.appendChild(option);
    });

    document.body.appendChild(menu);

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== dockBtn) {
        if (document.body.contains(menu)) {
          document.body.removeChild(menu);
        }
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  /**
   * Fallback dock menu if WM is not available
   */
  showFallbackDockMenu() {
    const menuItems = [
      { label: '⬅️ Dock Left', action: 'left' },
      { label: '➡️ Dock Right', action: 'right' },
      { label: '⬇️ Dock Bottom', action: 'bottom' },
      { label: '🪟 Floating', action: 'floating' }
    ];

    // Create simple menu
    const menu = document.createElement('div');
    menu.style.position = 'fixed';
    menu.style.background = 'rgba(10, 25, 45, 0.98)';
    menu.style.border = '1px solid rgba(79, 191, 115, 0.3)';
    menu.style.borderRadius = '4px';
    menu.style.zIndex = '99999';
    menu.style.padding = '8px 0';
    menu.style.minWidth = '150px';
    
    const dockBtn = this.elements?.dockBtn;
    const rect = dockBtn?.getBoundingClientRect();
    menu.style.left = (rect?.left || 0) + 'px';
    menu.style.top = (rect?.bottom || 0) + 8 + 'px';

    menuItems.forEach(item => {
      const option = document.createElement('div');
      option.style.padding = '8px 16px';
      option.style.cursor = 'pointer';
      option.style.color = '#e8f4f8';
      option.style.userSelect = 'none';
      option.style.transition = 'background 0.2s';
      option.textContent = item.label;
      
      option.addEventListener('mouseover', () => {
        option.style.background = 'rgba(79, 191, 115, 0.15)';
      });
      option.addEventListener('mouseout', () => {
        option.style.background = 'transparent';
      });
      option.addEventListener('click', () => {
        this.fallbackDock(item.action);
        document.body.removeChild(menu);
      });
      
      menu.appendChild(option);
    });

    document.body.appendChild(menu);

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menu.contains(e.target) && e.target !== dockBtn) {
        document.body.removeChild(menu);
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  /**
   * Fallback docking if Window Manager methods not available
   */
  fallbackDock(position) {
    const container = this.containerElement;
    const panel = this.elements.panel;
    if (!container || !panel) {
      console.warn('[npc-panel] fallbackDock: container or panel not found');
      return;
    }

    const windowId = 'npc-dialogue';

    console.log(`[npc-panel] fallbackDock: Attempting to dock to "${position}"`);
    console.log('[npc-panel] fallbackDock: container=', container, 'panel=', panel);

    if (position === 'left') {
      try {
        // Move panel to left sidebar
        const leftSidebar = document.getElementById('left_sidebar');
        console.log('[npc-panel] leftSidebar found:', !!leftSidebar);
        if (leftSidebar) {
          // Create a flex wrapper in the sidebar
          const sidebarContainer = document.createElement('div');
          sidebarContainer.className = 'npc-sidebar-dock';
          sidebarContainer.style.display = 'flex';
          sidebarContainer.style.flexDirection = 'column';
          sidebarContainer.style.height = '100%';
          sidebarContainer.style.width = '100%';
          
          // Move the container into the sidebar
          console.log('[npc-panel] Moving container to sidebar');
          
          // Save existing resize handle if present
          const oldResizeHandle = leftSidebar.querySelector('.wm-resize-handle');
          
          leftSidebar.innerHTML = '';
          sidebarContainer.appendChild(container);
          leftSidebar.appendChild(sidebarContainer);
          
          // Recreate resize handle
          const resizeHandle = document.createElement('div');
          resizeHandle.className = 'wm-resize-handle';
          resizeHandle.title = 'Resize';
          leftSidebar.appendChild(resizeHandle);
          
          // Update panel to dock styling
          container.classList.add('wm-adaptable-window');
          container.classList.remove('npc-panel-floating');
          panel.classList.remove('npc-panel-floating');
          panel.style.position = 'relative';
          panel.style.width = '100%';
          panel.style.maxHeight = 'none';
          panel.style.bottom = 'auto';
          panel.style.right = 'auto';
          
          console.log('[npc-panel] ✅ Docked to left sidebar');
        }
      } catch (e) {
        console.error('[npc-panel] Failed to dock left:', e);
      }
    } 
    else if (position === 'right') {
      try {
        const rightSidebar = document.getElementById('right_sidebar');
        console.log('[npc-panel] rightSidebar found:', !!rightSidebar);
        if (rightSidebar) {
          const sidebarContainer = document.createElement('div');
          sidebarContainer.className = 'npc-sidebar-dock';
          sidebarContainer.style.display = 'flex';
          sidebarContainer.style.flexDirection = 'column';
          sidebarContainer.style.height = '100%';
          sidebarContainer.style.width = '100%';
          
          rightSidebar.innerHTML = '';
          sidebarContainer.appendChild(container);
          rightSidebar.appendChild(sidebarContainer);
          
          // Recreate resize handle
          const resizeHandle = document.createElement('div');
          resizeHandle.className = 'wm-resize-handle';
          resizeHandle.title = 'Resize';
          rightSidebar.appendChild(resizeHandle);
          
          container.classList.add('wm-adaptable-window');
          container.classList.remove('npc-panel-floating');
          panel.classList.remove('npc-panel-floating');
          panel.style.position = 'relative';
          panel.style.width = '100%';
          panel.style.maxHeight = 'none';
          panel.style.bottom = 'auto';
          panel.style.right = 'auto';
          
          console.log('[npc-panel] ✅ Docked to right sidebar');
        }
      } catch (e) {
        console.error('[npc-panel] Failed to dock right:', e);
      }
    } 
    else if (position === 'floating') {
      // Move back to NPC panel host
      try {
        const panelHost = document.getElementById('npc-dialogue-panel-host');
        console.log('[npc-panel] panelHost found:', !!panelHost);
        if (panelHost) {
          panelHost.innerHTML = '';
          panelHost.appendChild(container);
          
          container.classList.remove('wm-adaptable-window');
          container.classList.add('npc-panel-floating');
          panel.classList.add('npc-panel-floating');
          panel.style.position = 'fixed';
          panel.style.width = '380px';
          panel.style.maxHeight = '600px';
          panel.style.bottom = '20px';
          panel.style.right = '20px';
          
          console.log('[npc-panel] ✅ Returned to floating mode');
        }
      } catch (e) {
        console.error('[npc-panel] Failed to return to floating:', e);
      }
    }
    
    // Setup resize handlers if we docked to a sidebar
    if ((position === 'left' || position === 'right') && window.advisorNPC && typeof window.advisorNPC.setupResizeHandlers === 'function') {
      console.log('[npc-panel] Setting up resize handlers for sidebar');
      window.advisorNPC.setupResizeHandlers();
    }
  }

  getAgentTypeFromNpcId(npcId) {
    // Extract agent type from NPC ID (e.g., "npc_commander_01" -> "commander")
    const match = npcId.match(/npc_(\w+)_/);
    return match ? match[1] : 'merchant';
  }

  escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  render() {
    // Panel is already rendered via setupElements
    return this.containerElement;
  }

  destroy() {
    this.elements.sendBtn?.removeEventListener('click', this.sendMessage);
    this.elements.inputForm?.removeEventListener('submit', this.sendMessage);
    this.containerElement.innerHTML = '';
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NPCDialoguePanel;
}
