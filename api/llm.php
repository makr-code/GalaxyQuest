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

	default:
		json_error('Unknown action');
}
