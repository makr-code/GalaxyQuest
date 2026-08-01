<?php
/**
 * Game Guide NPC Manager
 * Intelligenter Onboarding- und Tutorialassistent
 * 
 * Funktionalität:
 * - Kontextuelle Tipps basierend auf Spielerzustand
 * - Automatische Erkennung von Problemen
 * - Tutorial-Progress-Tracking
 * - Adaptive Hilfe für Anfänger, Fortgeschrittene
 * - Direkte Hilfe (Ressourcen, Technologie)
 */

class GameGuideNPC
{
    private \PDO $db;
    private array $config = [];
    private array $help_topics = [];
    private string $cache_dir = __DIR__ . '/../cache/game_guide';

    public function __construct(\PDO $db, string $config_file = null)
    {
        $this->db = $db;
        
        if (!$config_file) {
            // Correct path: from api/llm_soc/, go up two levels to project root, then into config/
            $config_file = __DIR__ . '/../../config/npc_game_guide.yaml';
        }
        
        $this->loadConfig($config_file);
        
        // Ensure cache dir exists
        if (!is_dir($this->cache_dir)) {
            mkdir($this->cache_dir, 0755, true);
        }
    }

    /**
     * Load YAML configuration
     */
    private function loadConfig(string $config_file): void
    {
        if (!file_exists($config_file)) {
            throw new Exception("Game Guide config not found: {$config_file}");
        }

        require_once __DIR__ . '/../../lib/MiniYamlParser.php';
        $parser = new MiniYamlParser();
        $this->config = $parser->parse(file_get_contents($config_file));
        $this->help_topics = $this->config['help_topics'] ?? [];
    }

    /**
     * Get guide greeting and initial assessment
     */
    public function getGreeting(int $user_id, array $player_data): array
    {
        $is_new = $player_data['is_new_player'] ?? true;
        $level = $player_data['player_level'] ?? 1;
        $last_active = $player_data['last_active'] ?? 0;
        
        $greeting = "Hallo! Ich bin Advisor Tau, dein persönlicher Ratgeber.";
        
        if ($is_new) {
            $greeting .= " Willkommen bei GalaxyQuest! Ich werde dir zeigen wie alles funktioniert.";
        } else {
            $days_away = ceil((time() - $last_active) / 86400);
            if ($days_away > 7) {
                $greeting .= " Willkommen zurück! Viel hat sich geändert während du weg warst.";
            } else {
                $greeting .= " Schön dich wiederzusehen! Wie kann ich dir heute helfen?";
            }
        }
        
        return [
            'ok' => true,
            'greeting' => $greeting,
            'player_level' => $level,
            'is_new_player' => $is_new,
        ];
    }

    /**
     * Assess player's current situation and provide contextual advice
     */
    public function assessGameState(int $user_id, array $game_state): array
    {
        $issues = [];
        $recommendations = [];
        
        // Assess resources
        $resource_assessment = $this->assessResources($game_state);
        if ($resource_assessment['issues']) {
            $issues = array_merge($issues, $resource_assessment['issues']);
            $recommendations = array_merge($recommendations, $resource_assessment['recommendations']);
        }
        
        // Assess production
        $production_assessment = $this->assessProduction($game_state);
        if ($production_assessment['issues']) {
            $issues = array_merge($issues, $production_assessment['issues']);
            $recommendations = array_merge($recommendations, $production_assessment['recommendations']);
        }
        
        // Assess military
        $military_assessment = $this->assessMilitary($game_state);
        if ($military_assessment['issues']) {
            $issues = array_merge($issues, $military_assessment['issues']);
            $recommendations = array_merge($recommendations, $military_assessment['recommendations']);
        }
        
        // Assess research
        $research_assessment = $this->assessResearch($game_state);
        if ($research_assessment['issues']) {
            $issues = array_merge($issues, $research_assessment['issues']);
            $recommendations = array_merge($recommendations, $research_assessment['recommendations']);
        }
        
        return [
            'critical_issues' => array_filter($issues, fn($i) => $i['severity'] === 'critical'),
            'warnings' => array_filter($issues, fn($i) => $i['severity'] === 'warning'),
            'tips' => array_slice($recommendations, 0, 3), // Top 3 recommendations
        ];
    }

    /**
     * Check for resource problems
     */
    private function assessResources(array $game_state): array
    {
        $issues = [];
        $recommendations = [];
        
        $food = $game_state['resources']['food'] ?? 0;
        $food_production = $game_state['production']['food'] ?? 0;
        $population = $game_state['population'] ?? 0;
        $food_consumption = $population * 0.5; // Rough estimate
        
        // Critical: Starvation risk
        if ($food < 100 && $food_consumption > $food_production) {
            $issues[] = [
                'type' => 'starvation_risk',
                'severity' => 'critical',
                'message' => 'Deine Bevölkerung hungert! Baue schnell Farmen oder kaufe Nahrung.',
            ];
            
            $recommendations[] = [
                'type' => 'action_needed',
                'action' => 'grant_resources:food=500',
                'text' => 'Ich kann dir schnell helfen mit Notfallnahrung.',
                'priority' => 'critical',
            ];
        }
        
        // Warning: Low production
        if ($food_production < $food_consumption * 1.2) {
            $issues[] = [
                'type' => 'low_production',
                'severity' => 'warning',
                'message' => 'Deine Nahrungsproduktion ist zu niedrig für die Bevölkerung.',
            ];
            
            $recommendations[] = [
                'type' => 'tip',
                'text' => 'Baue mehr Farmen. Jede Farm produziert zusätzliche Nahrung.',
                'priority' => 'high',
            ];
        }
        
        return ['issues' => $issues, 'recommendations' => $recommendations];
    }

    /**
     * Check for production problems
     */
    private function assessProduction(array $game_state): array
    {
        $issues = [];
        $recommendations = [];
        
        $production_buildings = $game_state['buildings'] ?? [];
        $colony_count = $game_state['colony_count'] ?? 1;
        
        if ($colony_count === 1 && count($production_buildings) < 5) {
            $issues[] = [
                'type' => 'underdeveloped',
                'severity' => 'warning',
                'message' => 'Deine erste Kolonie ist noch unterentwickelt.',
            ];
            
            $recommendations[] = [
                'type' => 'tip',
                'text' => 'Baue verschiedene Produktionsgebäude: Farmen, Bergbau, Fabriken.',
                'priority' => 'high',
            ];
        }
        
        return ['issues' => $issues, 'recommendations' => $recommendations];
    }

    /**
     * Check for military vulnerabilities
     */
    private function assessMilitary(array $game_state): array
    {
        $issues = [];
        $recommendations = [];
        
        $fleet_strength = $game_state['fleet_strength'] ?? 0;
        $threats = $game_state['nearby_threats'] ?? 0;
        $defenses = $game_state['defense_buildings'] ?? 0;
        
        if ($threats > 0 && $fleet_strength < 50) {
            $issues[] = [
                'type' => 'military_threat',
                'severity' => 'critical',
                'message' => 'Es gibt Bedrohungen in der Nähe und dein Fleet ist schwach!',
            ];
            
            $recommendations[] = [
                'type' => 'action_needed',
                'action' => 'modify_production:building_type=fleet_factory,multiplier=1.3',
                'text' => 'Lass mich deine Flottenprodukion beschleunigen.',
                'priority' => 'critical',
            ];
        }
        
        if ($fleet_strength === 0 && $colony_count > 1) {
            $issues[] = [
                'type' => 'no_fleet',
                'severity' => 'warning',
                'message' => 'Du hast kein Fleet. Das ist gefährlich mit mehreren Kolonien.',
            ];
            
            $recommendations[] = [
                'type' => 'tip',
                'text' => 'Baue eine Werft und konstruiere dein erstes Kriegsschiff.',
                'priority' => 'high',
            ];
        }
        
        return ['issues' => $issues, 'recommendations' => $recommendations];
    }

    /**
     * Check research status
     */
    private function assessResearch(array $game_state): array
    {
        $issues = [];
        $recommendations = [];
        
        $research_buildings = $game_state['research_buildings'] ?? 0;
        $tech_count = $game_state['technologies_researched'] ?? 0;
        $time_played = $game_state['time_played_hours'] ?? 0;
        
        if ($time_played > 2 && $tech_count === 0) {
            $issues[] = [
                'type' => 'no_research',
                'severity' => 'warning',
                'message' => 'Du hast noch keine Technologie erforscht!',
            ];
            
            $recommendations[] = [
                'type' => 'action_needed',
                'action' => 'add_research:1000',
                'text' => 'Lass mich dir einen Forschungs-Boost geben.',
                'priority' => 'high',
            ];
        }
        
        if ($research_buildings === 0 && $time_played > 1) {
            $recommendations[] = [
                'type' => 'tip',
                'text' => 'Baue ein Forschungslabor um Technologien zu erforschen.',
                'priority' => 'high',
            ];
        }
        
        return ['issues' => $issues, 'recommendations' => $recommendations];
    }

    /**
     * Get specific help topic
     */
    public function getHelpTopic(string $category): array
    {
        $topic = $this->help_topics[$category] ?? null;
        
        if (!$topic) {
            return [
                'ok' => false,
                'error' => "Help topic not found: {$category}",
            ];
        }
        
        return [
            'ok' => true,
            'category' => $category,
            'title' => $topic['title'] ?? '',
            'questions' => $topic['questions'] ?? [],
            'tips' => $topic['tips'] ?? [],
        ];
    }

    /**
     * Provide direct help action
     */
    public function provideDirectHelp(int $user_id, string $help_type, array $game_state): array
    {
        // Check if guide can help this player
        $can_help = $this->checkDirectHelpEligibility($user_id, $help_type, $game_state);
        
        if (!$can_help['eligible']) {
            return [
                'ok' => false,
                'reason' => $can_help['reason'],
            ];
        }
        
        $action = match($help_type) {
            'grant_starting_resources' => $this->createStartingResourcesAction($user_id),
            'grant_research_points' => $this->createResearchPointsAction($user_id),
            'grant_credits_emergency' => $this->createEmergencyCreditsAction($user_id),
            'grant_colony_buildings' => $this->createColonyBuildingsAction($user_id),
            'unlock_tutorial_tech' => $this->createTutorialTechAction($user_id),
            default => null,
        };
        
        if (!$action) {
            return ['ok' => false, 'error' => "Unknown help type: {$help_type}"];
        }
        
        // Log help action
        $this->logGuideAction($user_id, $help_type, $action);
        
        return [
            'ok' => true,
            'action' => $action,
            'message' => "I'm helping you get started!",
        ];
    }

    /**
     * Check if player is eligible for direct help
     */
    private function checkDirectHelpEligibility(int $user_id, string $help_type, array $game_state): array
    {
        // New player help only
        if (!($game_state['is_new_player'] ?? false) && $game_state['time_played_hours'] > 24) {
            return [
                'eligible' => false,
                'reason' => 'You are too experienced for basic help.',
            ];
        }
        
        // Check times used
        $times_used = $this->getDirectHelpUsageCount($user_id, $help_type);
        if ($times_used >= 1) {
            return [
                'eligible' => false,
                'reason' => 'You can only use this help once.',
            ];
        }
        
        return ['eligible' => true];
    }

    /**
     * Get starting resources for new players
     */
    private function createStartingResourcesAction(int $user_id): array
    {
        return [
            'type' => 'grant_resources',
            'resources' => [
                'food' => 500,
                'energy' => 300,
                'minerals' => 200,
            ],
            'message' => 'Starting resources to help you begin!',
        ];
    }

    /**
     * Grant research points for tutorial completion
     */
    private function createResearchPointsAction(int $user_id): array
    {
        return [
            'type' => 'add_research',
            'amount' => 2000,
            'message' => 'Research boost to accelerate your technology progress!',
        ];
    }

    /**
     * Emergency credits for bankruptcy
     */
    private function createEmergencyCreditsAction(int $user_id): array
    {
        return [
            'type' => 'grant_credits',
            'amount' => 5000,
            'message' => 'Emergency funds to get you back on track!',
        ];
    }

    /**
     * Fast-track some buildings for new colonies
     */
    private function createColonyBuildingsAction(int $user_id): array
    {
        return [
            'type' => 'build_building',
            'buildings' => [
                ['type' => 'farm', 'level' => 2],
                ['type' => 'storage', 'level' => 2],
                ['type' => 'research_lab', 'level' => 1],
            ],
            'message' => 'Here are some buildings to jumpstart your colony!',
        ];
    }

    /**
     * Unlock basic tutorial technologies
     */
    private function createTutorialTechAction(int $user_id): array
    {
        return [
            'type' => 'unlock_tech',
            'technologies' => [
                'basic_agriculture',
                'basic_construction',
                'basic_defense',
            ],
            'message' => 'Fundamental technologies to explore!',
        ];
    }

    /**
     * Log guide action for audit trail
     */
    private function logGuideAction(int $user_id, string $help_type, array $action): void
    {
        try {
            $stmt = $this->db->prepare(
                "INSERT INTO npc_action_log 
                (user_id, npc_id, faction_code, action_type, action_params, created_at) 
                VALUES (?, ?, ?, ?, ?, NOW())"
            );
            
            $stmt->execute([
                $user_id,
                'npc_game_guide',
                'Neutral',
                'guide_action_' . $help_type,
                json_encode($action),
            ]);
        } catch (Exception $e) {
            // Log error silently
            error_log("Guide action log failed: " . $e->getMessage());
        }
    }

    /**
     * Track tutorial progress
     */
    public function recordCheckpointCompletion(int $user_id, string $checkpoint): void
    {
        try {
            $stmt = $this->db->prepare(
                "INSERT INTO game_guide_progress 
                (user_id, checkpoint_id, completed_at) 
                VALUES (?, ?, NOW())
                ON DUPLICATE KEY UPDATE completed_at = NOW()"
            );
            
            $stmt->execute([$user_id, $checkpoint]);
        } catch (Exception $e) {
            error_log("Checkpoint recording failed: " . $e->getMessage());
        }
    }

    /**
     * Get player's tutorial progress
     */
    public function getTutorialProgress(int $user_id): array
    {
        try {
            $stmt = $this->db->prepare(
                "SELECT checkpoint_id, completed_at 
                FROM game_guide_progress 
                WHERE user_id = ? 
                ORDER BY completed_at"
            );
            
            $stmt->execute([$user_id]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            return [];
        }
    }

    /**
     * Get help usage count
     */
    private function getDirectHelpUsageCount(int $user_id, string $help_type): int
    {
        try {
            $stmt = $this->db->prepare(
                "SELECT COUNT(*) as count 
                FROM npc_action_log 
                WHERE user_id = ? 
                AND action_type = ? 
                AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)"
            );
            
            $stmt->execute([$user_id, 'guide_action_' . $help_type]);
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            return $result['count'] ?? 0;
        } catch (Exception $e) {
            return 0;
        }
    }

    /**
     * Get guide's system prompt for NPC responses
     */
    public function getSystemPrompt(): string
    {
        return $this->config['guide_agent']['system_prompt'] ?? '';
    }

    /**
     * Get response constraints
     */
    public function getResponseConstraints(): array
    {
        return $this->config['guide_agent']['response_constraints'] ?? [
            'temperature' => 0.6,
            'min_tokens' => 50,
            'max_tokens' => 300,
        ];
    }
}
