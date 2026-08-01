/**
 * NPC Dialogue System
 * Handles NPC chat interactions with AI personality-driven responses
 * Integrates with PHP backend: npc_chat_integration.php
 */

class NpcDialogueSystem {
    constructor(gameState) {
        this.gameState = gameState || {};
        this.apiBaseUrl = `/api/npc_chat_integration.php`;
        this.activeSessions = new Map(); // sessionId -> session state
        this.responseCache = new Map(); // hash -> {response, timestamp}
        this.cacheSettings = {
            ttl: 3600000, // 1 hour in ms
            enabled: true,
        };
    }

    /**
     * Get CSRF token (fallback if not in gameState)
     */
    getCsrfToken() {
        if (this.gameState.csrfToken) {
            return this.gameState.csrfToken;
        }
        // Fallback: try to extract from DOM or use empty string
        const tokenMeta = document.querySelector('meta[name="csrf-token"]');
        return tokenMeta?.content || '';
    }

    /**
     * Start/load a dialogue session with an NPC
     * @param {Object} npc - NPC character data
     * @param {number} playerId - Current player ID
     * @returns {Promise<Object>} Session data
     */
    async loadDialogueSession(npc, playerId) {
        const sessionKey = `player_${playerId}_npc_${npc.id}`;

        // Check if session already loaded
        if (this.activeSessions.has(sessionKey)) {
            return this.activeSessions.get(sessionKey);
        }

        try {
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.gameState.csrfToken || '',
                },
                body: JSON.stringify({
                    action: 'history',
                    npc_id: npc.id,
                    npc_name: npc.name,
                    faction: npc.faction,
                    agent_type: this.determineAgentType(npc),
                }),
            });

            const data = await response.json();
            if (data.ok) {
                this.activeSessions.set(sessionKey, data.session);
                return data.session;
            } else {
                console.error('Failed to load dialogue session:', data.error);
                return null;
            }
        } catch (error) {
            console.error('Error loading dialogue session:', error);
            return null;
        }
    }

    /**
     * Generate NPC response to player message
     * @param {Object} npc - NPC character data
     * @param {number} playerId - Current player ID
     * @param {string} playerMessage - Player's message
     * @param {Object} gameContext - Current game state (factions, tech, etc.)
     * @returns {Promise<Object>} {response, fromCache, latency_ms, agentType}
     */
    async generateNpcResponse(npc, playerId, playerMessage, gameContext = {}) {
        const sessionKey = `player_${playerId}_npc_${npc.id}`;
        const agentType = this.determineAgentType(npc);
        
        // Build game context for AI
        const contextPayload = this.buildGameContext(gameContext, npc.faction);

        // Cache key based on NPC, player, and message
        const cacheKey = this.generateCacheKey(npc.id, playerId, playerMessage);

        // Check response cache
        if (this.cacheSettings.enabled && this.responseCache.has(cacheKey)) {
            const cached = this.responseCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheSettings.ttl) {
                return {
                    ...cached.response,
                    fromCache: true,
                    latency_ms: 0,
                };
            }
        }

        try {
            const startTime = performance.now();
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCsrfToken(),
                },
                body: JSON.stringify({
                    action: 'chat',
                    npc_id: npc.id,
                    npc_name: npc.name,
                    faction: npc.faction,
                    agent_type: agentType,
                    player_message: playerMessage,
                    game_context: contextPayload,
                }),
            });

            const data = await response.json();
            const latency = Math.round(performance.now() - startTime);

            if (data.ok) {
                const result = {
                    response: data.response,
                    fromCache: false,
                    latency_ms: latency,
                    agentType: agentType,
                    sessionId: data.session_id,
                };

                // Cache the response
                if (this.cacheSettings.enabled) {
                    this.responseCache.set(cacheKey, {
                        response: result,
                        timestamp: Date.now(),
                    });
                }

                return result;
            } else {
                console.error('Failed to generate NPC response:', data.error);
                return {
                    response: this.getDefaultResponse(npc),
                    fromCache: false,
                    latency_ms: latency,
                    agentType: agentType,
                    error: data.error,
                };
            }
        } catch (error) {
            console.error('Error generating NPC response:', error);
            return {
                response: this.getDefaultResponse(npc),
                fromCache: false,
                latency_ms: -1,
                agentType: agentType,
                error: error.message,
            };
        }
    }

    /**
     * Get conversation history for an NPC session
     * @param {number} playerId - Player ID
     * @param {string} npcId - NPC ID
     * @returns {Promise<Array>} Message history
     */
    async getConversationHistory(playerId, npcId) {
        try {
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCsrfToken(),
                },
                body: JSON.stringify({
                    action: 'history',
                    npc_id: npcId,
                }),
            });

            const data = await response.json();
            if (data.ok && data.session && data.session.messages) {
                return data.session.messages;
            }
            return [];
        } catch (error) {
            console.error('Error fetching conversation history:', error);
            return [];
        }
    }

    /**
     * Clear dialogue session (start fresh)
     * @param {number} playerId - Player ID
     * @param {string} npcId - NPC ID
     * @returns {Promise<boolean>} Success status
     */
    async clearDialogueSession(playerId, npcId) {
        const sessionKey = `player_${playerId}_npc_${npcId}`;
        this.activeSessions.delete(sessionKey);

        try {
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCsrfToken(),
                },
                body: JSON.stringify({
                    action: 'clear_session',
                    npc_id: npcId,
                }),
            });

            const data = await response.json();
            return data.ok === true;
        } catch (error) {
            console.error('Error clearing dialogue session:', error);
            return false;
        }
    }

    /**
     * Get available NPC agents and their personalities
     * @returns {Promise<Array>} List of available agents
     */
    async getAvailableAgents() {
        try {
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCsrfToken(),
                },
                body: JSON.stringify({
                    action: 'agents',
                }),
            });

            const data = await response.json();
            if (data.ok && data.agents) {
                return data.agents;
            }
            return [];
        } catch (error) {
            console.error('Error fetching available agents:', error);
            return [];
        }
    }

    /**
     * Determine agent type based on NPC characteristics
     * @param {Object} npc - NPC data
     * @returns {string} Agent type: commander, diplomat, merchant, scientist
     */
    determineAgentType(npc) {
        if (!npc) return 'diplomat'; // Default

        // Map NPC roles/titles to agent types
        const role = (npc.role || '').toLowerCase();
        const faction = (npc.faction || '').toLowerCase();

        if (role.includes('commander') || role.includes('admiral') || role.includes('general')) {
            return 'commander';
        }
        if (role.includes('merchant') || role.includes('trader') || role.includes('captain')) {
            return 'merchant';
        }
        if (role.includes('scientist') || role.includes('researcher') || role.includes('engineer')) {
            return 'scientist';
        }
        if (role.includes('diplomat') || role.includes('ambassador') || role.includes('consul')) {
            return 'diplomat';
        }

        // Fallback to diplomat for non-specific roles
        return 'diplomat';
    }

    /**
     * Build game context for AI model
     * Includes faction relations, tech level, recent conflicts, etc.
     * @param {Object} gameContext - Game state snapshot
     * @param {string} npcFaction - NPC's faction
     * @returns {Object} Formatted context for AI
     */
    buildGameContext(gameContext, npcFaction) {
        return {
            player_faction: gameContext.player_faction || 'unknown',
            npc_faction: npcFaction,
            faction_relations: gameContext.faction_relations || {},
            tech_level: gameContext.tech_level || 0,
            recent_conflicts: gameContext.recent_conflicts || [],
            trade_routes: gameContext.trade_routes || [],
            alliance_status: gameContext.alliance_status || 'neutral',
            market_data: gameContext.market_data || {},
        };
    }

    /**
     * Generate cache key for response
     * @param {string} npcId - NPC ID
     * @param {number} playerId - Player ID
     * @param {string} message - Player message
     * @returns {string} Cache key hash
     */
    generateCacheKey(npcId, playerId, message) {
        const combined = `${npcId}:${playerId}:${message}`;
        // Simple hash (in production, use crypto)
        let hash = 0;
        for (let i = 0; i < combined.length; i++) {
            const char = combined.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Get default response when AI system is unavailable
     * @param {Object} npc - NPC data
     * @returns {string} Default response text
     */
    getDefaultResponse(npc) {
        const responses = {
            commander: "I'm unable to process your request at this moment. Please try again.",
            diplomat: "Apologies, I'm currently unavailable for negotiations. Check back later.",
            merchant: "Sorry, my communication systems are temporarily offline. Return soon.",
            scientist: "My analysis systems are offline. I'll resume research when available.",
        };

        const agentType = this.determineAgentType(npc);
        return responses[agentType] || responses.diplomat;
    }

    /**
     * Get cache statistics for admin debugging
     * @returns {Promise<Object>} Cache stats
     */
    async getCacheStats() {
        try {
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCsrfToken(),
                },
                body: JSON.stringify({
                    action: 'cache_stats',
                }),
            });

            const data = await response.json();
            return data.cache_stats || {};
        } catch (error) {
            console.error('Error fetching cache stats:', error);
            return {};
        }
    }

    /**
     * Clear all cached responses (admin only)
     * @returns {Promise<boolean>} Success status
     */
    async clearAllCache() {
        try {
            const response = await fetch(this.apiBaseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this.getCsrfToken(),
                },
                body: JSON.stringify({
                    action: 'cache_clear',
                }),
            });

            const data = await response.json();
            return data.ok === true;
        } catch (error) {
            console.error('Error clearing cache:', error);
            return false;
        }
    }
}

// Export for use in game
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NpcDialogueSystem;
}
