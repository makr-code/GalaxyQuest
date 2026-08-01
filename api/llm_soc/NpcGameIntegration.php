/**
 * NPC Game Integration System
 * 
 * Allows NPCs to influence game state through dialogue:
 * - Grant resources/credits
 * - Modify production settings
 * - Build/upgrade buildings
 * - Add research points
 * - Adjust diplomacy
 * - Trigger events
 */

namespace GalaxyQuest\NPC;

use GalaxyQuest\API\GameEngine;
use GalaxyQuest\API\Economy;
use GalaxyQuest\API\Buildings;
use GalaxyQuest\API\Research;
use GalaxyQuest\API\Diplomacy;

class NpcGameIntegration {
    
    // Action types that NPCs can trigger
    const ACTION_GRANT_CREDITS = 'grant_credits';
    const ACTION_GRANT_RESOURCES = 'grant_resources';
    const ACTION_MODIFY_PRODUCTION = 'modify_production';
    const ACTION_BUILD_BUILDING = 'build_building';
    const ACTION_ADD_RESEARCH = 'add_research';
    const ACTION_ADJUST_STANDING = 'adjust_standing';
    const ACTION_TRIGGER_EVENT = 'trigger_event';
    const ACTION_UNLOCK_TECH = 'unlock_tech';
    const ACTION_GRANT_FLEET = 'grant_fleet';
    const ACTION_MODIFY_TAX = 'modify_tax';
    const ACTION_SABOTAGE_COLONY = 'sabotage_colony';
    
    private $db;
    private $gameEngine;
    private $logger;
    
    // Constraints: max values per action type
    private $actionConstraints = [
        self::ACTION_GRANT_CREDITS => ['max' => 100000, 'per_day' => 300000],
        self::ACTION_GRANT_RESOURCES => ['max' => 10000, 'per_type_day' => 50000],
        self::ACTION_MODIFY_PRODUCTION => ['max_multiplier' => 1.5, 'min_multiplier' => 0.5],
        self::ACTION_BUILD_BUILDING => ['buildings_per_day' => 3, 'max_level_boost' => 2],
        self::ACTION_ADD_RESEARCH => ['max_points' => 5000, 'per_day' => 10000],
        self::ACTION_ADJUST_STANDING => ['max_change' => 10, 'per_day' => 20],
        self::ACTION_UNLOCK_TECH => ['max_tech_per_day' => 1],
        self::ACTION_GRANT_FLEET => ['max_ships' => 5, 'per_day' => 10],
        self::ACTION_MODIFY_TAX => ['max_change' => 0.1], // ±10%
        self::ACTION_SABOTAGE_COLONY => ['enabled' => false], // Requires special faction relation
    ];
    
    public function __construct($db, GameEngine $gameEngine, $logger = null) {
        $this->db = $db;
        $this->gameEngine = $gameEngine;
        $this->logger = $logger;
    }
    
    /**
     * Parse NPC response and extract game actions
     * 
     * @param string $npcId NPC identifier
     * @param string $factionCode Faction code
     * @param int $userId User ID
     * @param string $npcResponse The NPC's dialogue response
     * @return array Actions to execute
     */
    public function parseActionsFromResponse($npcId, $factionCode, $userId, $npcResponse) {
        $actions = [];
        
        // Parse response for action tags/patterns
        // Format: [ACTION_TYPE:params]
        // Examples:
        //   [grant_credits:50000]
        //   [grant_resources:food=1000,energy=500]
        //   [adjust_standing:+5]
        //   [trigger_event:trade_opportunity]
        
        $pattern = '/\[([a-z_]+):([^\]]+)\]/i';
        if (preg_match_all($pattern, $npcResponse, $matches)) {
            foreach ($matches[1] as $idx => $actionType) {
                $params = $matches[2][$idx];
                $action = $this->parseAction($actionType, $params);
                if ($action) {
                    $actions[] = $action;
                }
            }
        }
        
        // Also detect implicit actions from sentiment/keywords
        $implicitActions = $this->detectImplicitActions($factionCode, $npcResponse);
        $actions = array_merge($actions, $implicitActions);
        
        return $actions;
    }
    
    /**
     * Validate and execute an action
     */
    public function executeAction($userId, $npcId, $factionCode, $action) {
        try {
            // Validate action format
            if (!isset($action['type'])) {
                throw new \Exception('Action missing type');
            }
            
            // Check rate limiting
            if (!$this->checkRateLimit($userId, $npcId, $action['type'])) {
                return [
                    'ok' => false,
                    'reason' => 'Rate limit exceeded for action: ' . $action['type'],
                ];
            }
            
            // Check constraints
            if (!$this->validateConstraints($factionCode, $action)) {
                return [
                    'ok' => false,
                    'reason' => 'Action violates constraints',
                ];
            }
            
            // Execute based on type
            $result = null;
            switch ($action['type']) {
                case self::ACTION_GRANT_CREDITS:
                    $result = $this->actionGrantCredits($userId, $action);
                    break;
                case self::ACTION_GRANT_RESOURCES:
                    $result = $this->actionGrantResources($userId, $action);
                    break;
                case self::ACTION_MODIFY_PRODUCTION:
                    $result = $this->actionModifyProduction($userId, $action);
                    break;
                case self::ACTION_ADJUST_STANDING:
                    $result = $this->actionAdjustStanding($userId, $factionCode, $action);
                    break;
                case self::ACTION_ADD_RESEARCH:
                    $result = $this->actionAddResearch($userId, $action);
                    break;
                case self::ACTION_TRIGGER_EVENT:
                    $result = $this->actionTriggerEvent($userId, $factionCode, $action);
                    break;
                default:
                    return ['ok' => false, 'reason' => 'Unknown action type'];
            }
            
            // Log action
            $this->logNpcAction($userId, $npcId, $factionCode, $action, $result);
            
            return $result ?? ['ok' => false, 'reason' => 'Action not implemented'];
        } catch (\Exception $e) {
            $this->log('error', 'Action execution failed: ' . $e->getMessage());
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Grant credits to player
     */
    private function actionGrantCredits($userId, $action) {
        $amount = (int) ($action['amount'] ?? 0);
        
        if ($amount <= 0 || $amount > $this->actionConstraints[self::ACTION_GRANT_CREDITS]['max']) {
            return ['ok' => false, 'reason' => 'Invalid amount'];
        }
        
        try {
            $query = "UPDATE users SET credits = credits + ? WHERE id = ?";
            $stmt = $this->db->prepare($query);
            $stmt->execute([$amount, $userId]);
            
            return [
                'ok' => true,
                'action' => 'credits_granted',
                'amount' => $amount,
                'message' => "Received {$amount} credits from NPC",
            ];
        } catch (\Exception $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Grant resources to player
     */
    private function actionGrantResources($userId, $action) {
        $resources = $action['resources'] ?? [];
        if (empty($resources)) {
            return ['ok' => false, 'reason' => 'No resources specified'];
        }
        
        $colonyId = (int) ($action['colony_id'] ?? 0);
        if ($colonyId <= 0) {
            return ['ok' => false, 'reason' => 'Colony ID required'];
        }
        
        try {
            $updates = [];
            foreach ($resources as $type => $amount) {
                if ($amount <= 0 || $amount > $this->actionConstraints[self::ACTION_GRANT_RESOURCES]['max']) {
                    continue;
                }
                
                $safeType = preg_replace('/[^a-z_]/', '', strtolower($type));
                $updates[] = "{$safeType} = {$safeType} + {$amount}";
            }
            
            if (empty($updates)) {
                return ['ok' => false, 'reason' => 'No valid resources'];
            }
            
            $query = "UPDATE colonies SET " . implode(', ', $updates) . " WHERE id = ? AND user_id = ?";
            $stmt = $this->db->prepare($query);
            $stmt->execute([$colonyId, $userId]);
            
            return [
                'ok' => true,
                'action' => 'resources_granted',
                'resources' => $resources,
                'colony_id' => $colonyId,
            ];
        } catch (\Exception $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Modify colony production settings
     */
    private function actionModifyProduction($userId, $action) {
        $colonyId = (int) ($action['colony_id'] ?? 0);
        $buildingType = $action['building_type'] ?? '';
        $multiplier = (float) ($action['multiplier'] ?? 1.0);
        
        if ($colonyId <= 0 || empty($buildingType)) {
            return ['ok' => false, 'reason' => 'Colony ID and building type required'];
        }
        
        if ($multiplier < 0.5 || $multiplier > 1.5) {
            return ['ok' => false, 'reason' => 'Multiplier out of range'];
        }
        
        try {
            $query = "UPDATE colony_buildings 
                     SET production_multiplier = production_multiplier * ? 
                     WHERE colony_id = ? AND building_type = ? 
                     AND (SELECT user_id FROM colonies WHERE id = ?) = ?";
            
            $stmt = $this->db->prepare($query);
            $stmt->execute([$multiplier, $colonyId, $buildingType, $colonyId, $userId]);
            
            return [
                'ok' => true,
                'action' => 'production_modified',
                'building_type' => $buildingType,
                'multiplier' => $multiplier,
            ];
        } catch (\Exception $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Adjust faction standing
     */
    private function actionAdjustStanding($userId, $factionCode, $action) {
        $change = (int) ($action['change'] ?? 0);
        
        if (abs($change) > $this->actionConstraints[self::ACTION_ADJUST_STANDING]['max_change']) {
            return ['ok' => false, 'reason' => 'Standing change too large'];
        }
        
        try {
            $query = "UPDATE faction_relations 
                     SET standing = standing + ? 
                     WHERE user_id = ? AND faction_code = ?";
            
            $stmt = $this->db->prepare($query);
            $stmt->execute([$change, $userId, $factionCode]);
            
            return [
                'ok' => true,
                'action' => 'standing_adjusted',
                'faction' => $factionCode,
                'change' => $change,
                'message' => $change > 0 
                    ? "Faction standing improved: +{$change}"
                    : "Faction standing declined: {$change}",
            ];
        } catch (\Exception $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Add research points
     */
    private function actionAddResearch($userId, $action) {
        $points = (int) ($action['points'] ?? 0);
        $techKey = $action['tech_key'] ?? null;
        
        if ($points <= 0 || $points > $this->actionConstraints[self::ACTION_ADD_RESEARCH]['max_points']) {
            return ['ok' => false, 'reason' => 'Invalid research points'];
        }
        
        try {
            if ($techKey) {
                // Add to specific tech
                $query = "UPDATE user_research 
                         SET points = points + ? 
                         WHERE user_id = ? AND tech_key = ?";
                $stmt = $this->db->prepare($query);
                $stmt->execute([$points, $userId, $techKey]);
            } else {
                // Add to general research pool
                $query = "UPDATE users 
                         SET research_points = research_points + ? 
                         WHERE id = ?";
                $stmt = $this->db->prepare($query);
                $stmt->execute([$points, $userId]);
            }
            
            return [
                'ok' => true,
                'action' => 'research_added',
                'points' => $points,
                'tech' => $techKey,
            ];
        } catch (\Exception $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Trigger a game event
     */
    private function actionTriggerEvent($userId, $factionCode, $action) {
        $eventType = $action['event_type'] ?? '';
        $eventData = $action['event_data'] ?? [];
        
        if (empty($eventType)) {
            return ['ok' => false, 'reason' => 'Event type required'];
        }
        
        try {
            // Create event in database
            $query = "INSERT INTO game_events (user_id, faction_code, event_type, event_data, created_at) 
                     VALUES (?, ?, ?, ?, NOW())";
            
            $stmt = $this->db->prepare($query);
            $stmt->execute([
                $userId,
                $factionCode,
                $eventType,
                json_encode($eventData),
            ]);
            
            return [
                'ok' => true,
                'action' => 'event_triggered',
                'event_type' => $eventType,
                'message' => "New event: {$eventType}",
            ];
        } catch (\Exception $e) {
            return ['ok' => false, 'error' => $e->getMessage()];
        }
    }
    
    /**
     * Parse action string into action array
     */
    private function parseAction($actionType, $params) {
        $action = ['type' => $actionType];
        
        // Parse params: key=value,key=value or just a number
        if (is_numeric($params)) {
            $action['amount'] = (int) $params;
        } else {
            $parts = explode(',', $params);
            foreach ($parts as $part) {
                if (strpos($part, '=') !== false) {
                    [$key, $value] = explode('=', $part, 2);
                    $action[trim($key)] = is_numeric($value) ? (int) $value : trim($value);
                } else {
                    $action['value'] = trim($part);
                }
            }
        }
        
        return $action;
    }
    
    /**
     * Detect implicit actions from NPC personality and response
     */
    private function detectImplicitActions($factionCode, $response) {
        $actions = [];
        $responseLower = strtolower($response);
        
        // Merchant NPCs offer discounts on resources
        if (strpos($factionCode, 'merchant') !== false || strpos($factionCode, 'trader') !== false) {
            if (preg_match('/discount|trade|offer|deal|sell|buy/i', $response)) {
                // Could implicitly offer a small resource grant
                $actions[] = [
                    'type' => self::ACTION_GRANT_RESOURCES,
                    'resources' => ['credits' => rand(1000, 5000)],
                ];
            }
        }
        
        // Diplomat NPCs improve standing
        if (strpos($factionCode, 'diplomat') !== false || strpos($factionCode, 'embassy') !== false) {
            if (preg_match('/alliance|friend|good|peace|respect/i', $response)) {
                $actions[] = [
                    'type' => self::ACTION_ADJUST_STANDING,
                    'change' => rand(1, 5),
                ];
            }
        }
        
        // Scientist NPCs give research
        if (strpos($factionCode, 'scientist') !== false || strpos($factionCode, 'research') !== false) {
            if (preg_match('/discover|research|technology|innovation/i', $response)) {
                $actions[] = [
                    'type' => self::ACTION_ADD_RESEARCH,
                    'points' => rand(100, 1000),
                ];
            }
        }
        
        // Commander NPCs can grant military resources
        if (strpos($factionCode, 'commander') !== false || strpos($factionCode, 'military') !== false) {
            if (preg_match('/support|military|fleet|defense|aid/i', $response)) {
                $actions[] = [
                    'type' => self::ACTION_GRANT_RESOURCES,
                    'resources' => ['military_supplies' => rand(500, 2000)],
                ];
            }
        }
        
        return $actions;
    }
    
    /**
     * Check rate limiting
     */
    private function checkRateLimit($userId, $npcId, $actionType) {
        $cacheKey = "npc_action_{$userId}_{$npcId}_{$actionType}";
        
        // Simple rate limit: max 3 major actions per NPC per day
        $query = "SELECT COUNT(*) as count FROM npc_action_log 
                 WHERE user_id = ? AND npc_id = ? AND action_type = ? 
                 AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)";
        
        $stmt = $this->db->prepare($query);
        $stmt->execute([$userId, $npcId, $actionType]);
        $result = $stmt->fetch(\PDO::FETCH_ASSOC);
        
        $maxActionsPerDay = $this->actionConstraints[$actionType]['per_day'] ?? 3;
        return ($result['count'] ?? 0) < $maxActionsPerDay;
    }
    
    /**
     * Validate action against faction constraints
     */
    private function validateConstraints($factionCode, $action) {
        $constraints = $this->actionConstraints[$action['type']] ?? [];
        
        if (empty($constraints)) {
            return true; // No constraints
        }
        
        // Type-specific validation
        switch ($action['type']) {
            case self::ACTION_GRANT_CREDITS:
                return ($action['amount'] ?? 0) <= $constraints['max'];
            
            case self::ACTION_GRANT_RESOURCES:
                foreach (($action['resources'] ?? []) as $amount) {
                    if ($amount > $constraints['max']) return false;
                }
                return true;
            
            case self::ACTION_MODIFY_PRODUCTION:
                $mult = $action['multiplier'] ?? 1.0;
                return $mult >= $constraints['min_multiplier'] 
                    && $mult <= $constraints['max_multiplier'];
            
            case self::ACTION_ADJUST_STANDING:
                return abs($action['change'] ?? 0) <= $constraints['max_change'];
        }
        
        return true;
    }
    
    /**
     * Log NPC action for audit trail
     */
    private function logNpcAction($userId, $npcId, $factionCode, $action, $result) {
        try {
            $query = "INSERT INTO npc_action_log 
                     (user_id, npc_id, faction_code, action_type, action_params, result, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, NOW())";
            
            $stmt = $this->db->prepare($query);
            $stmt->execute([
                $userId,
                $npcId,
                $factionCode,
                $action['type'],
                json_encode($action),
                json_encode($result),
            ]);
        } catch (\Exception $e) {
            $this->log('warning', 'Failed to log NPC action: ' . $e->getMessage());
        }
    }
    
    /**
     * Simple logging
     */
    private function log($level, $message) {
        if ($this->logger) {
            $this->logger->log($level, "[NpcGameIntegration] $message");
        } else {
            error_log("[NpcGameIntegration] [$level] $message");
        }
    }
}
