/**
 * Advisor Tau NPC Integration
 * ============================
 * Integrates the GameGuide Advisor Tau as an NPC in the dialogue system
 * Allows seamless interaction through the unified NPC dialogue interface
 */

class AdvisorNPCIntegration {
  constructor() {
    this.advisorNpcId = 'npc_advisor_tau';
    this.advisorName = 'Advisor Tau';
    this.advisorFaction = 'Neutral';
    this.gameGuideSystem = null;
    this.dialoguePanel = null;
  }

  /**
   * Initialize the advisor NPC integration
   */
  init(gameGuideSystem) {
    this.gameGuideSystem = gameGuideSystem;
    console.log('[advisor-npc] Initialization started');
    
    // Setup resize handlers when DOM is fully ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        console.log('[advisor-npc] DOMContentLoaded - setting up resize handlers');
        this.setupResizeHandlers();
      });
    } else {
      // DOM is already loaded, setup immediately
      console.log('[advisor-npc] DOM already loaded - setting up resize handlers immediately');
      this.setupResizeHandlers();
    }
  }

  /**
   * Open the Advisor in the NPC Dialogue Panel
   * @param {NPCDialoguePanel} dialoguePanel - The NPC dialogue panel instance
   * @param {Object} gameContext - Current game context for assessment
   */
  async openAdvisor(dialoguePanel, gameContext = {}) {
    this.dialoguePanel = dialoguePanel;

    // Switch to advisor NPC
    dialoguePanel.options.npcId = this.advisorNpcId;
    dialoguePanel.options.npcName = this.advisorName;
    dialoguePanel.options.faction = this.advisorFaction;

    // Clear existing messages
    dialoguePanel.state.messages = [];

    // Load greeting message from GameGuide
    let suggestions = []; // Store suggestions for quick replies
    try {
      if (!this.gameGuideSystem) {
        throw new Error('GameGuideSystem not initialized');
      }

      const greeting = await this.gameGuideSystem.getGreeting();
      if (greeting && greeting.ok) {
        // Add greeting as system message (using correct message format)
        dialoguePanel.state.messages.push({
          role: this.advisorName,
          content: greeting.greeting || 'Welcome Commander!',
          timestamp: new Date(),
          type: 'greeting',
          fromCache: false
        });

        // Store suggestions for quick replies
        if (greeting.suggestions && greeting.suggestions.length > 0) {
          suggestions = greeting.suggestions.slice(0, 3);
          
          // Add suggestions message
          const suggestionsText = suggestions
            .map(s => `💡 ${s}`)
            .join('\n');
          
          dialoguePanel.state.messages.push({
            role: this.advisorName,
            content: suggestionsText,
            timestamp: new Date(),
            type: 'suggestions',
            fromCache: false
          });
        }

        // Assess game state
        const assessment = await this.gameGuideSystem.assessGameState(gameContext);
        if (assessment && assessment.ok && assessment.assessment) {
          dialoguePanel.state.messages.push({
            role: this.advisorName,
            content: `📊 Assessment: ${assessment.assessment}`,
            timestamp: new Date(),
            type: 'assessment',
            fromCache: false
          });
        }
      } else {
        // No greeting data, show default
        dialoguePanel.state.messages.push({
          role: this.advisorName,
          content: '👋 Willkommen zu GalaxyQuest! Ich bin Advisor Tau, dein persönlicher Ratgeber. Ich helfe dir, die Galaxie zu erkunden und Erfolg zu haben!',
          timestamp: new Date(),
          type: 'greeting',
          fromCache: false
        });
      }
    } catch (error) {
      console.error('[advisor-npc] Failed to load greeting:', error);
      dialoguePanel.state.messages.push({
        role: this.advisorName,
        content: '👋 Hallo Commander! Willkommen zu GalaxyQuest. Wie kann ich dir heute helfen?',
        timestamp: new Date(),
        type: 'greeting',
        fromCache: false
      });
    }

    // Re-render the message list
    dialoguePanel.renderMessages();

    // Render quick reply suggestions using already-loaded suggestions
    if (suggestions && suggestions.length > 0) {
      const cleanedSuggestions = suggestions
        .map(s => s.replace(/^💡\s*/, '').trim())
        .filter(s => s.length > 0); // Filter out empty strings
      
      dialoguePanel.renderQuickReplies(cleanedSuggestions);
      console.log('[advisor-npc] Quick replies rendered:', cleanedSuggestions);
    } else {
      console.warn('[advisor-npc] No suggestions available for quick replies');
    }

    // Update header info
    if (dialoguePanel.elements.header) {
      dialoguePanel.elements.header.innerHTML = `
        <div class="npc-header-info">
          <h3 class="npc-panel-title">📚 ${this.advisorName}</h3>
          <p class="npc-faction">${this.advisorFaction}</p>
        </div>
        <div class="npc-header-buttons">
          <button class="npc-dock-btn" aria-label="Dock/Undock panel" title="Dock left/right/floating">
            <svg class="icon-dock" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="16" height="16" stroke="currentColor" stroke-width="1.5" rx="1"/>
              <line x1="8" y1="2" x2="8" y2="18" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
          <button class="npc-close-btn">×</button>
        </div>
      `;
      
      // Setup close button
      dialoguePanel.elements.header.querySelector('.npc-close-btn').addEventListener('click', () => {
        dialoguePanel.close();
      });
      
      // Setup dock button
      const dockBtn = dialoguePanel.elements.header.querySelector('.npc-dock-btn');
      if (dockBtn) {
        dockBtn.addEventListener('click', () => dialoguePanel.showDockMenu());
      }
    }

    // Setup response callback to update quick replies after each response
    dialoguePanel.onResponseCallback = async (responseData) => {
      try {
        // Load new suggestions based on updated game state
        const greeting = await this.gameGuideSystem.getGreeting();
        if (greeting && greeting.ok && greeting.suggestions) {
          const cleanedSuggestions = greeting.suggestions
            .map(s => s.replace(/^💡\s*/, '').trim())
            .slice(0, 3);
          dialoguePanel.renderQuickReplies(cleanedSuggestions);
        }
      } catch (error) {
        console.warn('[advisor-npc] Failed to update quick replies:', error);
      }
    };

    // Open the panel
    await dialoguePanel.open(gameContext);

    console.log('[advisor-npc] Advisor opened');
  }

  /**
   * Handle advisor interaction (message sending)
   * @param {string} userMessage - The message from the player
   */
  async handleAdvisorInteraction(userMessage, gameContext = {}) {
    try {
      // Try to match message to help topics
      const helpTopics = await this.gameGuideSystem.getHelpTopics();
      
      // For now, just assess the game state and respond
      const assessment = await this.gameGuideSystem.assessGameState(gameContext);
      
      if (assessment.ok) {
        return {
          ok: true,
          response: assessment.assessment || 'How can I help you commander?',
          type: 'assessment',
        };
      }
    } catch (error) {
      console.error('[advisor-npc] Interaction error:', error);
    }

    return {
      ok: false,
      response: 'Unable to process request. Please try again.',
      type: 'error',
    };
  }

  /**
   * Create an Advisor Tau opener button for the game UI
   */
  createAdvisorButton() {
    const button = document.createElement('button');
    button.id = 'open-advisor-btn';
    button.className = 'advisor-ui-button';
    button.innerHTML = '📚';
    button.title = 'Open Advisor Tau';
    button.setAttribute('aria-label', 'Open Advisor Tau');
    
    return button;
  }

  /**
   * Add advisor button to game UI
   * @param {string} parentSelector - CSS selector for button container
   */
  addAdvisorButtonToUI(parentSelector = '.commander-menu') {
    const parent = document.querySelector(parentSelector);
    if (!parent) {
      console.warn('[advisor-npc] Parent container not found:', parentSelector);
      return false;
    }

    const existingBtn = document.getElementById('open-advisor-btn');
    if (existingBtn) {
      return true; // Already added
    }

    const button = this.createAdvisorButton();
    parent.appendChild(button);
    
    console.log('[advisor-npc] Advisor button added to UI');
    return true;
  }

  /**
   * Setup advisor button click handler
   * @param {Function} onClickCallback - Callback when button is clicked
   */
  setupAdvisorButtonHandler(onClickCallback) {
    const button = document.getElementById('open-advisor-btn');
    if (button) {
      button.addEventListener('click', onClickCallback);
      console.log('[advisor-npc] Advisor button handler setup');
    } else {
      console.warn('[advisor-npc] Advisor button not found');
    }
  }

  /**
   * Setup resize handlers for sidebars
   */
  setupResizeHandlers() {
    this.setupSidebarResizeHandler('left_sidebar');
    this.setupSidebarResizeHandler('right_sidebar');
  }

  /**
   * Setup resize handler for a specific sidebar
   * @param {string} sidebarId - The ID of the sidebar element
   */
  setupSidebarResizeHandler(sidebarId) {
    const sidebar = document.getElementById(sidebarId);
    if (!sidebar) return;

    const resizeHandle = sidebar.querySelector('.wm-resize-handle');
    if (!resizeHandle) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const onPointerDown = (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      
      console.log(`[${sidebarId}] Resize started at ${startX}, initial width: ${startWidth}`);
      
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!isResizing) return;

      const delta = sidebarId === 'left_sidebar' 
        ? e.clientX - startX  // Right direction for left sidebar
        : startX - e.clientX; // Left direction for right sidebar
      
      const newWidth = Math.max(200, Math.min(600, startWidth + delta));
      
      sidebar.style.width = newWidth + 'px';
      sidebar.style.flex = `0 0 ${newWidth}px`;
      
      // Trigger content reflow by dispatching a resize event
      const resizeEvent = new Event('sidebarResized', { bubbles: true });
      resizeEvent.detail = { newWidth, sidebarId };
      sidebar.dispatchEvent(resizeEvent);
    };

    const onPointerUp = () => {
      isResizing = false;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      console.log(`[${sidebarId}] Resize ended, final width: ${sidebar.offsetWidth}px`);
    };

    resizeHandle.addEventListener('pointerdown', onPointerDown);
    console.log(`[advisor-npc] Resize handler setup for ${sidebarId}`);
  }
}
