/**
 * NPC Interaction Handler
 * Bridges NPC click events in the game with NPCDialoguePanel
 * 
 * Usage:
 *   const handler = new NpcInteractionHandler({ autoInit: true });
 *   handler.openNpcDialog('npc_commander_01', 'Commander Vex', 'Federation');
 */
class NpcInteractionHandler {
  constructor(options = {}) {
    this.options = {
      autoInit: options.autoInit !== false,
      debug: options.debug === true,
      gameState: options.gameState || window.gameState || {},
      ...options,
    };
    
    this.activePanel = null;
    this.npcCache = new Map();
    this.eventListeners = [];
    
    if (this.options.autoInit) {
      this.init();
    }
  }

  log(message, data) {
    if (!this.options.debug) return;
    console.log(`[NpcInteractionHandler] ${message}`, data || '');
  }

  /**
   * Initialize the handler and register global listeners
   */
  init() {
    this.log('Initializing NPC Interaction Handler');
    
    // Register global API for game to call
    if (window) {
      window.openNpcDialog = this.openNpcDialog.bind(this);
      window.closeNpcDialog = this.closeNpcDialog.bind(this);
      window.getNpcPanel = () => this.activePanel;
    }
    
    // Listen for document-level NPC click events
    this.setupNpcClickListeners();
    
    this.log('Initialization complete');
  }

  /**
   * Setup delegated event listeners for NPC elements
   */
  setupNpcClickListeners() {
    const clickHandler = (ev) => {
      const npcEl = ev.target?.closest('[data-npc-id]');
      if (!npcEl) return;
      
      const npcId = npcEl.getAttribute('data-npc-id');
      const npcName = npcEl.getAttribute('data-npc-name') || npcId;
      const faction = npcEl.getAttribute('data-npc-faction') || 'Neutral';
      
      this.log('NPC clicked', { npcId, npcName, faction });
      
      ev.preventDefault();
      this.openNpcDialog(npcId, npcName, faction);
    };
    
    document.addEventListener('click', clickHandler);
    this.eventListeners.push({ type: 'click', handler: clickHandler });
  }

  /**
   * Open NPC dialogue panel
   * @param {string} npcId - NPC identifier
   * @param {string} npcName - Display name for NPC
   * @param {string} faction - Faction affiliation
   */
  openNpcDialog(npcId, npcName, faction) {
    try {
      this.log(`Opening dialog for ${npcName} (${npcId})`);
      
      // Get player ID from game state or session
      const playerId = this.options.gameState?.playerId 
        || localStorage.getItem('player_id') 
        || '1';
      
      // Close existing panel if any
      if (this.activePanel) {
        this.activePanel.close();
      }
      
      // Instantiate new panel (try global scope first)
      const PanelClass = window.NPCDialoguePanel || NPCDialoguePanel;
      if (!PanelClass) {
        console.error('[NpcInteractionHandler] NPCDialoguePanel class not found in window or global scope');
        return;
      }
      
      this.activePanel = new PanelClass({
        containerId: 'npc-dialogue-panel',
        npcId,
        npcName,
        faction,
        playerId,
        apiBaseUrl: '/api',
        autoLoadHistory: true,
        maxHistoryItems: 50,
      });
      
      // Render and open panel
      this.activePanel.render();
      this.activePanel.open();
      
      // Store in cache for later access
      this.npcCache.set(npcId, {
        npcName,
        faction,
        lastOpened: new Date(),
        panel: this.activePanel,
      });
      
      this.log(`Dialog opened for ${npcName}`, { npcId, faction });
    } catch (error) {
      console.error('[NpcInteractionHandler] Error opening NPC dialog:', error);
    }
  }

  /**
   * Close active NPC dialogue panel
   */
  closeNpcDialog() {
    if (this.activePanel) {
      this.log('Closing active NPC dialog');
      this.activePanel.close();
      this.activePanel = null;
    }
  }

  /**
   * Get NPC history from cache
   * @param {string} npcId
   * @returns {object|null}
   */
  getNpcCache(npcId) {
    return this.npcCache.get(npcId) || null;
  }

  /**
   * Clear NPC cache
   */
  clearNpcCache() {
    this.npcCache.clear();
    this.log('NPC cache cleared');
  }

  /**
   * Attach NPC interaction to an element
   * Convenience method to add data attributes for delegation
   * @param {Element} element
   * @param {string} npcId
   * @param {string} npcName
   * @param {string} faction
   */
  attachToElement(element, npcId, npcName, faction = 'Neutral') {
    if (!element) return false;
    element.setAttribute('data-npc-id', npcId);
    element.setAttribute('data-npc-name', npcName);
    element.setAttribute('data-npc-faction', faction);
    element.style.cursor = 'pointer';
    return true;
  }

  /**
   * Destroy the handler and clean up listeners
   */
  destroy() {
    this.log('Destroying handler');
    this.eventListeners.forEach(({ type, handler }) => {
      document.removeEventListener(type, handler);
    });
    this.eventListeners = [];
    this.closeNpcDialog();
    this.clearNpcCache();
    
    if (window) {
      delete window.openNpcDialog;
      delete window.closeNpcDialog;
      delete window.getNpcPanel;
    }
  }
}

// Auto-initialize if enabled in global config
if (typeof window !== 'undefined' && !window.GQNpcInteractionHandler) {
  window.addEventListener('DOMContentLoaded', () => {
    try {
      if (window.NPCDialoguePanel && window.NpcDialogueSystem) {
        window.GQNpcInteractionHandler = new NpcInteractionHandler({
          autoInit: true,
          debug: false,
        });
        if (window.GQLog && typeof window.GQLog.info === 'function') {
          window.GQLog.info('[NpcInteractionHandler] Auto-initialized');
        }
      }
    } catch (error) {
      console.warn('[NpcInteractionHandler] Auto-init failed:', error);
    }
  });
}
