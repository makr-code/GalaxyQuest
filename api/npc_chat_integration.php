<?php
/**
 * NPC Chat Integration API Endpoint
 * Provides unified interface for in-game NPC dialogues
 * 
 * POST /api/npc_chat_integration.php
 * Body: {
 *   action: "chat" | "history" | "clear_session" | "agents" | "cache_stats"
 *   npc_id: "commander_123"
 *   npc_name: "Commander Zyx"
 *   faction: "Federation"
 *   agent_type: "commander"
 *   player_message: "Greetings!"
 *   game_context?: {faction_relations, recent_conflicts, tech_level, ...}
 * }
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/llm_soc/NpcChatService.php';

header('Content-Type: application/json');

only_method('POST');
verify_csrf();

$uid = require_auth();
$body = get_json_body();
$action = strtolower(trim((string) ($body['action'] ?? 'chat')));

$db = get_db();
$service = new NpcChatService($db);

try {
    switch ($action) {
        case 'chat':
            // Main dialogue interaction
            $npcId = trim((string) ($body['npc_id'] ?? ''));
            $npcName = trim((string) ($body['npc_name'] ?? 'NPC'));
            $faction = trim((string) ($body['faction'] ?? 'Neutral'));
            $agentType = trim((string) ($body['agent_type'] ?? 'commander'));
            $playerMessage = trim((string) ($body['player_message'] ?? ''));

            if (!$npcId || !$playerMessage) {
                json_error('npc_id and player_message are required', 400);
            }

            // Optional game context for dynamic prompts
            $gameContext = is_array($body['game_context'] ?? null) ? $body['game_context'] : [];

            $result = $service->generateNpcResponse(
                $uid,
                $npcId,
                $npcName,
                $faction,
                $agentType,
                $playerMessage,
                $gameContext
            );

            if (!($result['ok'] ?? false)) {
                json_error($result['error'] ?? 'Failed to generate response', $result['status'] ?? 500);
            }

            http_response_code(200);
            echo json_encode($result);
            break;

        case 'history':
            // Get conversation history for player-NPC pair
            $npcId = trim((string) ($body['npc_id'] ?? ''));
            $faction = trim((string) ($body['faction'] ?? 'Neutral'));

            if (!$npcId) {
                json_error('npc_id is required', 400);
            }

            $session = $service->getSessionHistory($uid, $npcId, $faction);
            http_response_code(200);
            echo json_encode([
                'ok' => true,
                'session_id' => $session['session_id'] ?? null,
                'messages_count' => count($session['messages'] ?? []),
                'messages' => array_slice($session['messages'] ?? [], -10), // Last 10 messages
                'created_at' => $session['created_at'] ?? null,
                'updated_at' => $session['updated_at'] ?? null,
            ]);
            break;

        case 'clear_session':
            // Clear conversation history for player-NPC pair
            $npcId = trim((string) ($body['npc_id'] ?? ''));
            $faction = trim((string) ($body['faction'] ?? 'Neutral'));

            if (!$npcId) {
                json_error('npc_id is required', 400);
            }

            $service->clearSession($uid, $npcId, $faction);
            http_response_code(200);
            echo json_encode(['ok' => true, 'message' => 'Session cleared']);
            break;

        case 'agents':
            // List available agent types
            $agents = $service->getAvailableAgents();
            $agent_info = [];

            foreach ($agents as $agent_type) {
                $info = $service->getAgentInfo($agent_type);
                if ($info) {
                    $agent_info[] = $info;
                }
            }

            http_response_code(200);
            echo json_encode([
                'ok' => true,
                'agents' => $agent_info,
                'total' => count($agent_info),
            ]);
            break;

        case 'cache_stats':
            // Get cache statistics (admin only)
            if (!(int) env_value('ENABLE_DEV_AUTH_TOOLS', 0)) {
                json_error('Cache stats not available in production', 403);
            }

            $stats = $service->getCacheStats();
            http_response_code(200);
            echo json_encode([
                'ok' => true,
                'cache_stats' => $stats,
            ]);
            break;

        case 'cache_clear':
            // Clear all cached responses (admin only)
            if (!(int) env_value('ENABLE_DEV_AUTH_TOOLS', 0)) {
                json_error('Cache clear not available in production', 403);
            }

            $cleared = $service->clearCache();
            http_response_code(200);
            echo json_encode([
                'ok' => true,
                'cleared_entries' => $cleared,
            ]);
            break;

        case 'cleanup_sessions':
            // Cleanup expired sessions (admin only)
            if (!(int) env_value('ENABLE_DEV_AUTH_TOOLS', 0)) {
                json_error('Cleanup not available in production', 403);
            }

            $deleted = $service->cleanupExpiredSessions();
            http_response_code(200);
            echo json_encode([
                'ok' => true,
                'deleted_sessions' => $deleted,
            ]);
            break;

        default:
            json_error('Unknown action: ' . $action, 400);
    }
} catch (Exception $e) {
    error_log("NPC chat error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
        'status' => 500,
    ]);
}
