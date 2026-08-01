/**
 * Erweiterte NPC Chat API mit Game Integration
 * 
 * Neue Endpoint: /api/npc_chat_integration.php?action=chat_with_consequences
 * 
 * Response-Beispiel:
 * {
 *   "ok": true,
 *   "response": "NPC dialogue text",
 *   "session_id": "sess_...",
 *   "latency_ms": 150,
 *   "from_cache": false,
 *   "actions": [
 *     {
 *       "type": "grant_credits",
 *       "amount": 50000,
 *       "ok": true,
 *       "message": "Received 50000 credits from NPC"
 *     },
 *     {
 *       "type": "adjust_standing",
 *       "faction": "Federation",
 *       "change": 5,
 *       "ok": true,
 *       "message": "Faction standing improved: +5"
 *     }
 *   ],
 *   "game_changes": {
 *     "credits_gained": 50000,
 *     "standing_changes": { "Federation": 5 },
 *     "resources_gained": { },
 *     "events_triggered": ["trade_opportunity"]
 *   }
 * }
 */

// In api/npc_chat_integration.php, add this new action handler:

case 'chat_with_consequences':
  // Like 'chat', but includes game action processing
  handleNpcChatWithConsequences($db, $npc_manager, $auth_token, $user_id, $csrf_token);
  break;

function handleNpcChatWithConsequences($db, $npc_manager, $auth_token, $user_id, $csrf_token) {
  require_once __DIR__ . '/llm_soc/NpcGameIntegration.php';
  
  $npc_id = $_POST['npc_id'] ?? null;
  $npc_name = $_POST['npc_name'] ?? null;
  $faction = $_POST['faction'] ?? 'Neutral';
  $player_message = $_POST['message'] ?? '';
  $game_context = $_POST['game_context'] ?? [];
  
  if (!$npc_id || !$npc_name || empty($player_message)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Missing required parameters']);
    return;
  }
  
  try {
    // Get NPC response as before
    $npc_service = new NpcChatService($db);
    
    // Detect agent type from NPC ID or faction
    $agent_type = detectAgentType($faction, $npc_id);
    
    $response_result = $npc_service->generateNpcResponse(
      $user_id,
      $npc_id,
      $npc_name,
      $faction,
      $agent_type,
      $player_message,
      (array) $game_context
    );
    
    if (!$response_result['ok']) {
      http_response_code(500);
      echo json_encode($response_result);
      return;
    }
    
    // NEW: Parse and execute game actions
    $game_integration = new NpcGameIntegration($db, null, null);
    $npc_response = $response_result['text'] ?? '';
    
    // Parse actions from response
    $actions_to_execute = $game_integration->parseActionsFromResponse(
      $npc_id,
      $faction,
      $user_id,
      $npc_response
    );
    
    // Execute actions with constraints
    $executed_actions = [];
    $game_changes = [
      'credits_gained' => 0,
      'standing_changes' => [],
      'resources_gained' => [],
      'events_triggered' => [],
    ];
    
    foreach ($actions_to_execute as $action) {
      $action_result = $game_integration->executeAction(
        $user_id,
        $npc_id,
        $faction,
        $action
      );
      
      $executed_actions[] = array_merge(
        $action,
        $action_result
      );
      
      // Track changes for client
      if ($action_result['ok'] ?? false) {
        switch ($action['type']) {
          case 'grant_credits':
            $game_changes['credits_gained'] += $action_result['amount'] ?? 0;
            break;
          case 'adjust_standing':
            $game_changes['standing_changes'][$faction] = 
              ($game_changes['standing_changes'][$faction] ?? 0) + ($action_result['change'] ?? 0);
            break;
          case 'grant_resources':
            $game_changes['resources_gained'] = array_merge(
              $game_changes['resources_gained'],
              $action_result['resources'] ?? []
            );
            break;
          case 'trigger_event':
            $game_changes['events_triggered'][] = $action_result['event_type'] ?? 'unknown';
            break;
        }
      }
    }
    
    // Return enhanced response
    http_response_code(200);
    echo json_encode([
      'ok' => true,
      'response' => $npc_response,
      'session_id' => $response_result['session_id'] ?? null,
      'latency_ms' => $response_result['latency_ms'] ?? 0,
      'from_cache' => $response_result['from_cache'] ?? false,
      'actions' => $executed_actions,
      'game_changes' => $game_changes,
      'message' => 'Response generated with ' . count($executed_actions) . ' actions executed',
    ]);
    
  } catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
      'ok' => false,
      'error' => $e->getMessage(),
      'code' => 'GAME_INTEGRATION_ERROR',
    ]);
  }
}

function detectAgentType($faction, $npc_id) {
  $faction_lower = strtolower($faction);
  $npc_id_lower = strtolower($npc_id);
  
  if (strpos($npc_id_lower, 'commander') !== false || strpos($npc_id_lower, 'military') !== false) {
    return 'commander';
  }
  if (strpos($npc_id_lower, 'diplomat') !== false || strpos($npc_id_lower, 'envoy') !== false) {
    return 'diplomat';
  }
  if (strpos($npc_id_lower, 'merchant') !== false || strpos($npc_id_lower, 'trader') !== false) {
    return 'merchant';
  }
  if (strpos($npc_id_lower, 'scientist') !== false || strpos($npc_id_lower, 'dr') !== false) {
    return 'scientist';
  }
  
  return 'diplomat'; // Default
}
