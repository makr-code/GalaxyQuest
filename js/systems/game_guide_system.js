/**
 * Game Guide NPC Client
 * Browser-side interaction with the tutorial/help system
 */

class GameGuideSystem {
    constructor(options = {}) {
        this.apiBaseUrl = options.apiBaseUrl || '/api';
        this.userId = options.userId;
        this.debug = options.debug || false;
        this.sessionId = options.sessionId;
        
        this.greetingShown = false;
        this.assessmentRunning = false;
        this.lastAssessment = null;
        this.completedCheckpoints = new Set();
        
        this.log('GameGuideSystem initialized');
    }
    
    /**
     * Get initial greeting from guide
     */
    async getGreeting() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/game_guide.php?action=greeting`, {
                method: 'GET',
                headers: this.getHeaders(),
            });
            
            const data = await response.json();
            
            if (data.ok) {
                this.greetingShown = true;
                this.log('Greeting received:', data.greeting);
                return data;
            } else {
                console.error('Failed to get greeting:', data.error);
                return { ok: false, error: data.error };
            }
        } catch (error) {
            console.error('Error getting greeting:', error);
            return { ok: false, error: error.message };
        }
    }
    
    /**
     * Assess current game state and get recommendations
     */
    async assessGameState(gameState) {
        if (this.assessmentRunning) {
            this.log('Assessment already running, skipping');
            return this.lastAssessment;
        }
        
        this.assessmentRunning = true;
        
        try {
            const formData = new FormData();
            formData.append('action', 'assess_game_state');
            formData.append('game_state', JSON.stringify(gameState));
            formData.append('csrf_token', this.getCsrfToken());
            
            const response = await fetch(`${this.apiBaseUrl}/game_guide.php`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: formData,
            });
            
            const data = await response.json();
            
            if (data.ok) {
                this.lastAssessment = data;
                this.log('Assessment completed', {
                    critical_issues: data.critical_issues?.length || 0,
                    warnings: data.warnings?.length || 0,
                    tips: data.tips?.length || 0,
                });
                return data;
            } else {
                console.error('Assessment failed:', data.error);
                return { ok: false, error: data.error };
            }
        } catch (error) {
            console.error('Error assessing game state:', error);
            return { ok: false, error: error.message };
        } finally {
            this.assessmentRunning = false;
        }
    }
    
    /**
     * Get help for a specific topic
     */
    async getHelpTopic(category) {
        try {
            const response = await fetch(
                `${this.apiBaseUrl}/game_guide.php?action=help_topic&category=${encodeURIComponent(category)}`,
                {
                    method: 'GET',
                    headers: this.getHeaders(),
                }
            );
            
            const data = await response.json();
            
            if (data.ok) {
                this.log(`Help topic loaded: ${category}`);
                return data;
            } else {
                console.error('Failed to load help topic:', data.error);
                return { ok: false, error: data.error };
            }
        } catch (error) {
            console.error('Error getting help topic:', error);
            return { ok: false, error: error.message };
        }
    }
    
    /**
     * Request direct help from the guide
     */
    async requestDirectHelp(helpType, gameState) {
        try {
            const formData = new FormData();
            formData.append('action', 'provide_help');
            formData.append('help_type', helpType);
            formData.append('game_state', JSON.stringify(gameState));
            formData.append('csrf_token', this.getCsrfToken());
            
            const response = await fetch(`${this.apiBaseUrl}/game_guide.php`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: formData,
            });
            
            const data = await response.json();
            
            if (data.ok) {
                this.log(`Direct help provided: ${helpType}`, data.action);
                return data;
            } else {
                console.error('Help request failed:', data.reason || data.error);
                return { ok: false, error: data.reason || data.error };
            }
        } catch (error) {
            console.error('Error requesting help:', error);
            return { ok: false, error: error.message };
        }
    }
    
    /**
     * Record tutorial checkpoint completion
     */
    async recordCheckpoint(checkpointId) {
        if (this.completedCheckpoints.has(checkpointId)) {
            this.log(`Checkpoint already recorded: ${checkpointId}`);
            return { ok: true, already_recorded: true };
        }
        
        try {
            const formData = new FormData();
            formData.append('action', 'record_checkpoint');
            formData.append('checkpoint', checkpointId);
            formData.append('csrf_token', this.getCsrfToken());
            
            const response = await fetch(`${this.apiBaseUrl}/game_guide.php`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: formData,
            });
            
            const data = await response.json();
            
            if (data.ok) {
                this.completedCheckpoints.add(checkpointId);
                this.log(`Checkpoint recorded: ${checkpointId}`);
                return data;
            } else {
                console.error('Failed to record checkpoint:', data.error);
                return { ok: false, error: data.error };
            }
        } catch (error) {
            console.error('Error recording checkpoint:', error);
            return { ok: false, error: error.message };
        }
    }
    
    /**
     * Get player's tutorial progress
     */
    async getProgress() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/game_guide.php?action=get_progress`, {
                method: 'GET',
                headers: this.getHeaders(),
            });
            
            const data = await response.json();
            
            if (data.ok) {
                this.log(`Tutorial progress: ${data.checkpoint_count} checkpoints`);
                
                // Update local tracking
                data.progress.forEach(p => {
                    this.completedCheckpoints.add(p.checkpoint_id);
                });
                
                return data;
            } else {
                console.error('Failed to get progress:', data.error);
                return { ok: false, error: data.error };
            }
        } catch (error) {
            console.error('Error getting progress:', error);
            return { ok: false, error: error.message };
        }
    }
    
    /**
     * Format assessment results for display
     */
    formatAssessmentForDisplay(assessment) {
        const display = {
            critical: [],
            warnings: [],
            recommendations: [],
        };
        
        if (assessment.critical_issues) {
            assessment.critical_issues.forEach(issue => {
                display.critical.push({
                    title: issue.type,
                    message: issue.message,
                    action: issue.action,
                });
            });
        }
        
        if (assessment.warnings) {
            assessment.warnings.forEach(warning => {
                display.warnings.push({
                    title: warning.type,
                    message: warning.message,
                });
            });
        }
        
        if (assessment.tips) {
            assessment.tips.forEach(tip => {
                display.recommendations.push({
                    text: tip.text,
                    priority: tip.priority,
                    action: tip.action,
                });
            });
        }
        
        return display;
    }
    
    /**
     * Get CSRF token from page
     */
    getCsrfToken() {
        // Try multiple sources
        return window.gameState?.csrfToken ||
               document.querySelector('meta[name="csrf-token"]')?.content ||
               '';
    }
    
    /**
     * Get request headers
     */
    getHeaders() {
        return {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Authorization': `Bearer ${this.getAuthToken()}`,
        };
    }
    
    /**
     * Get auth token
     */
    getAuthToken() {
        return window.gameState?.authToken ||
               localStorage.getItem('auth_token') ||
               '';
    }
    
    /**
     * Internal logging
     */
    log(message, data) {
        if (this.debug) {
            console.log(`[GameGuide] ${message}`, data || '');
        }
    }
    
    /**
     * Check if player is new
     */
    isNewPlayer() {
        return !this.completedCheckpoints.has('game_started');
    }
    
    /**
     * Get list of all help categories
     */
    getHelpCategories() {
        return [
            'getting_started',
            'resources_and_production',
            'military_and_fleets',
            'diplomacy_and_factions',
            'technology_and_research',
            'colonization',
            'market_and_trading',
            'events_and_quests',
            'troubleshooting',
        ];
    }
}

// Global instance
window.GameGuideSystem = GameGuideSystem;

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    if (window.gameState?.userId) {
        window.gameGuide = new GameGuideSystem({
            userId: window.gameState.userId,
            debug: window.gameState?.debugGameGuide || false,
        });
        
        // Load initial greeting
        window.gameGuide.getGreeting().then(result => {
            if (result.ok) {
                console.log('Game Guide ready:', result.greeting);
            }
        });
    }
});
