<?php
/**
 * LLM orchestration endpoint with separation-of-concerns style modules.
 *
 * GET  /api/llm.php?action=catalog
 * POST /api/llm.php?action=compose       body: {profile_key, input_vars}
 * POST /api/llm.php?action=chat_profile  body: {profile_key, input_vars, model?, temperature?, options?, timeout?}
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/ollama_client.php';
require_once __DIR__ . '/llm_soc/PromptCatalogRepository.php';
require_once __DIR__ . '/llm_soc/LlmPromptService.php';
require_once __DIR__ . '/llm_soc/LlmRequestLogRepository.php';
require_once __DIR__ . '/llm_soc/FactionSpecLoader.php';
require_once __DIR__ . '/llm_soc/NpcChatHistoryRepository.php';

$uid = require_auth();
$action = strtolower((string) ($_GET['action'] ?? 'catalog'));
$db = get_db();

$catalogRepository = new PromptCatalogRepository();
$promptService = new LlmPromptService($catalogRepository);
$logRepository = new LlmRequestLogRepository();

switch ($action) {
	case 'catalog':
		only_method('GET');
		json_ok([
			'profiles' => $promptService->catalog($db),
		]);
		break;

	case 'compose':
		only_method('POST');
		verify_csrf();
		$body = get_json_body();

		$profileKey = strtolower(trim((string) ($body['profile_key'] ?? '')));
		$inputVars = is_array($body['input_vars'] ?? null) ? $body['input_vars'] : [];
		if ($profileKey === '') {
			json_error('profile_key is required.');
		}

		$result = $promptService->compose($db, $profileKey, $inputVars);
		if (!($result['ok'] ?? false)) {
			json_error((string) ($result['error'] ?? 'Failed to compose prompt.'), (int) ($result['status'] ?? 400));
		}

		json_ok([
			'profile' => $result['profile'] ?? [],
			'messages' => $result['messages'] ?? [],
			'resolved_input' => $result['resolved_input'] ?? [],
		]);
		break;

	case 'chat_profile':
		only_method('POST');
		verify_csrf();
		$body = get_json_body();

		$profileKey = strtolower(trim((string) ($body['profile_key'] ?? '')));
		$inputVars = is_array($body['input_vars'] ?? null) ? $body['input_vars'] : [];
		if ($profileKey === '') {
			json_error('profile_key is required.');
		}

		$composed = $promptService->compose($db, $profileKey, $inputVars);
		if (!($composed['ok'] ?? false)) {
			json_error((string) ($composed['error'] ?? 'Failed to compose prompt.'), (int) ($composed['status'] ?? 400));
		}

		$messages = is_array($composed['messages'] ?? null) ? $composed['messages'] : [];
		$promptPreview = trim((string) ($messages[1]['content'] ?? ''));
		$start = microtime(true);

		$llm = ollama_chat($messages, [
			'model' => $body['model'] ?? null,
			'temperature' => $body['temperature'] ?? null,
			'options' => is_array($body['options'] ?? null) ? $body['options'] : null,
			'timeout' => isset($body['timeout']) ? (int) $body['timeout'] : null,
		]);

		$latencyMs = (int) round((microtime(true) - $start) * 1000);
		$model = (string) ($llm['model'] ?? (string) OLLAMA_DEFAULT_MODEL);

		if (!($llm['ok'] ?? false)) {
			$logRepository->log($db, [
				'user_id' => $uid,
				'profile_key' => $profileKey,
				'model' => $model,
				'prompt_hash' => hash('sha256', $promptPreview),
				'prompt_preview' => substr($promptPreview, 0, 800),
				'response_preview' => '',
				'latency_ms' => $latencyMs,
				'status' => 'error',
				'error_message' => substr((string) ($llm['error'] ?? 'Ollama failed.'), 0, 512),
			]);
			json_error((string) ($llm['error'] ?? 'Ollama failed.'), (int) ($llm['status'] ?? 502));
		}

		$text = (string) ($llm['text'] ?? '');
		$logRepository->log($db, [
			'user_id' => $uid,
			'profile_key' => $profileKey,
			'model' => $model,
			'prompt_hash' => hash('sha256', $promptPreview),
			'prompt_preview' => substr($promptPreview, 0, 800),
			'response_preview' => substr($text, 0, 1200),
			'latency_ms' => $latencyMs,
			'status' => 'ok',
			'error_message' => '',
		]);

		json_ok([
			'profile' => $composed['profile'] ?? [],
			'resolved_input' => $composed['resolved_input'] ?? [],
			'model' => $model,
			'text' => $text,
			'latency_ms' => $latencyMs,
			'raw' => $llm['raw'] ?? [],
		]);
		break;

	case 'chat_npc':
		only_method('POST');
		verify_csrf();
		$body = get_json_body();

		$factionCode = strtolower(trim((string) ($body['faction_code'] ?? '')));
		$npcName = trim((string) ($body['npc_name'] ?? ''));
		$playerMessage = trim((string) ($body['player_message'] ?? ''));

		if ($factionCode === '') {
			json_error('faction_code is required.');
		}
		if ($npcName === '') {
			json_error('npc_name is required.');
		}
		if ($playerMessage === '') {
			json_error('player_message is required.');
		}

		$specLoader = new FactionSpecLoader();
		try {
			$spec = $specLoader->loadFactionSpec($factionCode);
		} catch (\InvalidArgumentException $e) {
			json_error('Unknown faction: ' . $factionCode, 404);
		}

		$npc = $specLoader->findNpcByName($spec, $npcName);
		if ($npc === null) {
			json_error('NPC not found: ' . $npcName, 404);
		}

		$systemPrompt = $specLoader->buildNpcSystemPrompt($npc, $spec);

		// Enrich system prompt with diplomacy context from DB.
		$diplomacyStmt = $db->prepare(
			'SELECT d.standing, d.last_event, d.last_event_at
			 FROM diplomacy d
			 JOIN npc_factions f ON f.id = d.faction_id
			 WHERE d.user_id = ? AND f.code = ?
			 LIMIT 1'
		);
		$diplomacyStmt->execute([$uid, $factionCode]);
		$diplomacyRow = $diplomacyStmt->fetch();
		if ($diplomacyRow) {
			$standing = (int) $diplomacyRow['standing'];
			$standingLabel = $standing >= 50 ? 'verbündet' : ($standing >= 10 ? 'freundlich' : ($standing >= -10 ? 'neutral' : ($standing >= -50 ? 'feindselig' : 'verfeindet')));
			$systemPrompt .= "\n\nAktueller Diplomatiewert mit diesem Spieler: {$standing} ({$standingLabel}).";
			if (!empty($diplomacyRow['last_event'])) {
				$systemPrompt .= ' Letztes Ereignis: ' . (string) $diplomacyRow['last_event'] . '.';
			}
		}

		// Load recent NPC decisions for this faction as context.
		$decisionsStmt = $db->prepare(
			'SELECT n.action_key, n.reasoning, n.created_at
			 FROM npc_llm_decision_log n
			 JOIN npc_factions f ON f.id = n.faction_id
			 WHERE n.user_id = ? AND f.code = ? AND n.executed = 1
			 ORDER BY n.created_at DESC
			 LIMIT 3'
		);
		$decisionsStmt->execute([$uid, $factionCode]);
		$decisions = $decisionsStmt->fetchAll();
		if (!empty($decisions)) {
			$decisionSummaries = [];
			foreach ($decisions as $dec) {
				$decisionSummaries[] = (string) ($dec['action_key'] ?? '') . ': ' . (string) ($dec['reasoning'] ?? '');
			}
			$systemPrompt .= "\n\nJüngste Fraktionsentscheidungen: " . implode(' | ', $decisionSummaries);
		}

		// Load conversation history from disk (DB holds only the file path).
		$chatHistory = new NpcChatHistoryRepository();
		$chatFile = $chatHistory->ensureRegistered($db, $uid, $factionCode, $npcName);
		$historyMessages = $chatHistory->loadMessages($chatFile);

		// Build message array: system + history from file + current player message.
		$messages = [['role' => 'system', 'content' => $systemPrompt]];
		foreach ($historyMessages as $row) {
			$messages[] = ['role' => (string) ($row['role'] ?? 'user'), 'content' => (string) ($row['content'] ?? '')];
		}
		$messages[] = ['role' => 'user', 'content' => $playerMessage];

		$start = microtime(true);
		$llm = ollama_chat($messages, [
			'model' => $body['model'] ?? null,
			'temperature' => $body['temperature'] ?? null,
			'options' => is_array($body['options'] ?? null) ? $body['options'] : null,
			'timeout' => isset($body['timeout']) ? (int) $body['timeout'] : null,
		]);
		$latencyMs = (int) round((microtime(true) - $start) * 1000);
		$model = (string) ($llm['model'] ?? (string) OLLAMA_DEFAULT_MODEL);
		$profileKey = 'npc_character_chat';

		if (!($llm['ok'] ?? false)) {
			$logRepository->log($db, [
				'user_id' => $uid,
				'profile_key' => $profileKey,
				'model' => $model,
				'prompt_hash' => hash('sha256', $playerMessage),
				'prompt_preview' => substr($playerMessage, 0, 800),
				'response_preview' => '',
				'latency_ms' => $latencyMs,
				'status' => 'error',
				'error_message' => substr((string) ($llm['error'] ?? 'Ollama failed.'), 0, 512),
			]);
			json_error((string) ($llm['error'] ?? 'Ollama failed.'), (int) ($llm['status'] ?? 502));
		}

		$npcReply = (string) ($llm['text'] ?? '');

		// Persist both turns to the JSON file on disk.
		$chatHistory->appendMessages($db, $chatFile, [
			['role' => 'user', 'content' => $playerMessage],
			['role' => 'assistant', 'content' => $npcReply],
		]);

		$logRepository->log($db, [
			'user_id' => $uid,
			'profile_key' => $profileKey,
			'model' => $model,
			'prompt_hash' => hash('sha256', $playerMessage),
			'prompt_preview' => substr($playerMessage, 0, 800),
			'response_preview' => substr($npcReply, 0, 1200),
			'latency_ms' => $latencyMs,
			'status' => 'ok',
			'error_message' => '',
		]);

		json_ok([
			'faction_code' => $factionCode,
			'npc_name' => (string) ($npc['name'] ?? $npcName),
			'model' => $model,
			'reply' => $npcReply,
			'latency_ms' => $latencyMs,
		]);
		break;

	default:
		json_error('Unknown action');
}
