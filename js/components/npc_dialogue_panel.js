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
      inputForm: this.containerElement.querySelector('.npc-input-form'),
      inputField: this.containerElement.querySelector('.npc-message-input'),
      sendBtn: this.containerElement.querySelector('.npc-send-btn'),
      closeBtn: this.containerElement.querySelector('.npc-close-btn'),
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
