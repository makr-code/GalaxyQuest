<?php
/**
 * Simple NPC chat endpoint for testing Ollama integration
 * POST /api/npc_chat_test.php
 * Body: {player_message: "...", npc_name?: "Commander", faction?: "federation"}
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/ollama_client.php';

header('Content-Type: application/json');

only_method('POST');

try {
    $body = get_json_body();
    $playerMessage = trim((string) ($body['player_message'] ?? ''));
    $npcName = trim((string) ($body['npc_name'] ?? 'Unknown NPC'));
    $faction = trim((string) ($body['faction'] ?? 'Neutral'));

    if ($playerMessage === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'player_message is required']);
        exit;
    }

    // Build system prompt for NPC personality
    $systemPrompt = "You are $npcName from the $faction faction in a space strategy game. Respond naturally and in-character. Keep responses brief (1-3 sentences). Maintain a consistent personality.";

    $messages = [
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $playerMessage],
    ];

    $start = microtime(true);
    $result = ollama_chat($messages, ['model' => 'mistral', 'timeout' => 30, 'temperature' => 0.7]);
    $latency_ms = (int) round((microtime(true) - $start) * 1000);

    if (!($result['ok'] ?? false)) {
        http_response_code(503);
        echo json_encode([
            'ok' => false,
            'error' => $result['error'] ?? 'Ollama API error',
            'status' => $result['status'] ?? 503,
        ]);
        exit;
    }

    // Success
    http_response_code(200);
    echo json_encode([
        'ok' => true,
        'npc_name' => $npcName,
        'faction' => $faction,
        'player_message' => $playerMessage,
        'npc_response' => $result['text'] ?? '',
        'model' => $result['model'] ?? 'mistral',
        'latency_ms' => $latency_ms,
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'error' => $e->getMessage(),
    ]);
}
