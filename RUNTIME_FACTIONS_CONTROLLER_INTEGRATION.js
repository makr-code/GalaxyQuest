/**
 * INTEGRATION HELPER: RuntimeFactionsController
 * 
 * How to integrate the new NPC Dialogue Panel into your faction UI
 * 
 * BEFORE: Your existing code looks like:
 *   async openNpcChat(root, fid) {
 *     const faction = this.getFactionById(fid);
 *     // ... old API.chatNpc() call ...
 *   }
 * 
 * AFTER: Replace with this implementation:
 */

// Step 1: Find the openNpcChat method in RuntimeFactionsController (around line 545)
// Step 2: Replace the method body with:

async openNpcChat(root, fid) {
  try {
    const faction = this.getFactionById(fid);
    if (!faction) {
      showToast('Faction not found', 'error');
      return;
    }

    // Extract NPC info from faction
    const npcId = 'npc_' + String(faction.code || '').toLowerCase() + '_01';
    const npcName = String(faction.diplomat_npc || 'Diplomat');
    const factionCode = String(faction.code || 'Neutral');

    // Get current player ID from game state
    const playerId = getCurrentColony()?.user_id || '1';

    // NEW: Use the new NPC Dialogue Panel if available
    if (window.openNpcDialog && typeof window.openNpcDialog === 'function') {
      window.openNpcDialog(npcId, npcName, factionCode);
      showToast(`Opening dialogue with ${npcName}...`, 'info');
      return;
    }

    // FALLBACK: Keep old implementation if new panel not available
    // ... existing code ...
  } catch (error) {
    console.error('[RuntimeFactionsController] Error opening NPC chat:', error);
    showToast('Failed to open dialogue', 'error');
  }
}

/**
 * Alternative Implementation: Using handler directly
 * 
 * If you want more control or need to customize the panel:
 */

async openNpcChatAdvanced(root, fid) {
  try {
    const faction = this.getFactionById(fid);
    if (!faction) return;

    const npcId = 'npc_' + String(faction.code).toLowerCase() + '_01';
    const npcName = String(faction.diplomat_npc || 'Diplomat');
    const factionCode = String(faction.code);

    // Use handler directly
    if (window.GQNpcInteractionHandler) {
      // This will create a new panel or reuse existing one
      window.GQNpcInteractionHandler.openNpcDialog(npcId, npcName, factionCode);
      
      // Get the active panel for additional customization
      const panel = window.getNpcPanel();
      if (panel) {
        // Optional: Inject game context into panel
        panel.gameContext = {
          faction: faction,
          colony: getCurrentColony(),
          currentTime: Date.now(),
        };
        
        // Optional: Listen for custom events
        document.addEventListener('npcDialogClosed', (e) => {
          console.log(`NPC ${e.detail.npcId} dialog closed`);
        });
      }
      
      showToast(`Chatting with ${npcName}`, 'success');
    }
  } catch (error) {
    console.error('[RuntimeFactionsController] Error:', error);
  }
}

/**
 * DATA MAPPING: How to extract data from your faction object
 * 
 * Typical faction structure:
 * {
 *   id: 1,
 *   name: "Federation",
 *   code: "FED",
 *   diplomat_npc: "Commander Vex",
 *   standing: 75,
 *   ... other properties
 * }
 * 
 * NPC ID Format:
 *   npc_[FACTION_CODE_LOWERCASE]_[AGENT_TYPE]
 *   Examples:
 *   - npc_fed_commander
 *   - npc_emp_diplomat
 *   - npc_neutral_merchant
 *   - npc_fed_scientist
 */

/**
 * HTML INTEGRATION: If using faction card/button UI
 */

// In your HTML template:
/*
<button 
  class="faction-diplomat-button"
  onclick="handleFactionDiplomatClick(this, factionId)"
  data-faction-id="${faction.id}"
>
  Talk to ${faction.diplomat_npc}
</button>
*/

// In your JavaScript:
function handleFactionDiplomatClick(button, factionId) {
  // Get faction data
  const faction = factionsController.getFactionById(factionId);
  if (!faction) return;

  // Open dialogue
  window.openNpcDialog(
    'npc_' + String(faction.code).toLowerCase() + '_01',
    faction.diplomat_npc,
    faction.code
  );
}

/**
 * EVENT HANDLING: Listen for NPC dialogue events
 */

document.addEventListener('DOMContentLoaded', () => {
  // Closed dialogue event
  document.addEventListener('npcDialogClosed', (event) => {
    const { npcId, npcName } = event.detail;
    console.log(`Dialogue with ${npcName} ended`);
    // Refresh faction status if needed
    // factionsController.refresh();
  });

  // Optional: Message sent event
  if (window.NPCDialoguePanel) {
    // Hook into panel's sendMessage method if you need custom handling
  }
});

/**
 * TESTING: Quick test implementation
 */

function testNpcDialogueIntegration() {
  console.log('Testing NPC Dialogue Integration...');
  
  // Check if systems are loaded
  console.assert(window.openNpcDialog, 'openNpcDialog function not found');
  console.assert(window.GQNpcInteractionHandler, 'Handler not found');
  console.assert(window.getNpcPanel, 'getNpcPanel function not found');
  
  // Test opening a dialogue
  try {
    window.openNpcDialog('npc_fed_commander', 'Commander Vex', 'Federation');
    console.log('✓ Dialogue opened successfully');
    
    // Get panel and verify
    const panel = window.getNpcPanel();
    console.assert(panel, 'Panel not created');
    console.assert(panel.npcName === 'Commander Vex', 'NPC name mismatch');
    console.log('✓ Panel verified');
    
    // Close dialogue
    window.closeNpcDialog();
    console.log('✓ Dialogue closed');
    
    console.log('✓ All tests passed!');
  } catch (error) {
    console.error('✗ Test failed:', error);
  }
}

// Run test: testNpcDialogueIntegration();

/**
 * TROUBLESHOOTING
 * 
 * Q: Dialog doesn't open
 * A: Check browser console for errors. Make sure scripts loaded:
 *    - npc_dialogue_system.js
 *    - npc_dialogue_panel.js
 *    - npc_interaction_handler.js
 * 
 * Q: NPCDialoguePanel class not found
 * A: The scripts may not have loaded yet. Add to DOMContentLoaded:
 *    document.addEventListener('DOMContentLoaded', () => { ... })
 * 
 * Q: API calls return 403
 * A: Missing CSRF token. Check that CSRFToken is set in gameState
 * 
 * Q: Dialog doesn't respond to clicks
 * A: Check event delegation is working. Enable debug:
 *    window.GQNpcInteractionHandler.options.debug = true;
 */
