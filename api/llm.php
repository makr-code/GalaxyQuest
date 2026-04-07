<?php
/**
 * LLM orchestration endpoint with separation-of-concerns style modules.
 *
 * GET  /api/llm.php?action=catalog
 * POST /api/llm.php?action=compose            body: {profile_key, input_vars}
 * POST /api/llm.php?action=chat_profile       body: {profile_key, input_vars, model?, temperature?, options?, timeout?}
 * POST /api/llm.php?action=iron_fleet_vars    body: {} – returns composed Iron Fleet {{token}} vars (no LLM call)
 * POST /api/llm.php?action=iron_fleet_compose body: {division_code, input_vars_override?, model?, temperature?, options?, timeout?}
 * POST /api/llm.php?action=chat_npc           body: {faction_code, npc_name, player_message, session_id?, model?, temperature?, options?, timeout?}
 * POST /api/llm.php?action=close_npc_session  body: {session_id, model?}
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/ollama_client.php';
require_once __DIR__ . '/llm_soc/PromptCatalogRepository.php';
require_once __DIR__ . '/llm_soc/LlmPromptService.php';
require_once __DIR__ . '/llm_soc/LlmRequestLogRepository.php';
require_once __DIR__ . '/llm_soc/IronFleetPromptVarsComposer.php';
require_once __DIR__ . '/llm_soc/FactionSpecLoader.php';
require_once __DIR__ . '/llm_soc/NpcChatSessionRepository.php';
require_once __DIR__ . '/../lib/MiniYamlParser.php';

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

// ── Return all Iron Fleet {{token}} vars without sending to LLM ───────────
case 'iron_fleet_vars':
only_method('POST');
verify_csrf();
$composer = new IronFleetPromptVarsComposer();
json_ok(['vars' => $composer->compose()]);
break;

// ── Compose Iron Fleet division briefing and send to LLM ─────────────────
case 'iron_fleet_compose':
only_method('POST');
verify_csrf();
$body = get_json_body();

$divisionCode = strtolower(trim((string) ($body['division_code'] ?? '')));
if ($divisionCode === '') {
json_error('division_code is required.');
}

// Auto-compose Iron Fleet vars, then let the user override specific tokens
$ifComposer  = new IronFleetPromptVarsComposer();
$baseVars    = $ifComposer->compose();
$overrides   = is_array($body['input_vars_override'] ?? null) ? $body['input_vars_override'] : [];

// Map generic iron_fleet_<code>_* vars to the profile's expected tokens
$prefix = 'iron_fleet_' . $divisionCode . '_';
$inputVars = array_merge($baseVars, [
'division_name'    => $baseVars[$prefix . 'name']      ?? $divisionCode,
'division_role'    => $baseVars[$prefix . 'role']      ?? '',
'threat_level'     => $baseVars[$prefix . 'threat']    ?? '',
'intel_quality'    => $baseVars[$prefix . 'intel']     ?? '',
'notable_officer'  => $baseVars[$prefix . 'officer']   ?? '',
'current_objective'=> $baseVars[$prefix . 'objective'] ?? '',
], $overrides);

$composed = $promptService->compose($db, 'iron_fleet_briefing', $inputVars);
if (!($composed['ok'] ?? false)) {
json_error((string) ($composed['error'] ?? 'Failed to compose prompt.'), (int) ($composed['status'] ?? 400));
}

$messages    = is_array($composed['messages'] ?? null) ? $composed['messages'] : [];
$promptPreview = trim((string) ($messages[1]['content'] ?? ''));
$start = microtime(true);

$llm = ollama_chat($messages, [
'model'       => $body['model'] ?? null,
'temperature' => $body['temperature'] ?? null,
'options'     => is_array($body['options'] ?? null) ? $body['options'] : null,
'timeout'     => isset($body['timeout']) ? (int) $body['timeout'] : null,
]);

$latencyMs = (int) round((microtime(true) - $start) * 1000);
$model     = (string) ($llm['model'] ?? (string) OLLAMA_DEFAULT_MODEL);

if (!($llm['ok'] ?? false)) {
$logRepository->log($db, [
'user_id'         => $uid,
'profile_key'     => 'iron_fleet_briefing',
'model'           => $model,
'prompt_hash'     => hash('sha256', $promptPreview),
'prompt_preview'  => substr($promptPreview, 0, 800),
'response_preview'=> '',
'latency_ms'      => $latencyMs,
'status'          => 'error',
'error_message'   => substr((string) ($llm['error'] ?? 'Ollama failed.'), 0, 512),
]);
json_error((string) ($llm['error'] ?? 'Ollama failed.'), (int) ($llm['status'] ?? 502));
}

$text = (string) ($llm['text'] ?? '');
$logRepository->log($db, [
'user_id'         => $uid,
'profile_key'     => 'iron_fleet_briefing',
'model'           => $model,
'prompt_hash'     => hash('sha256', $promptPreview),
'prompt_preview'  => substr($promptPreview, 0, 800),
'response_preview'=> substr($text, 0, 1200),
'latency_ms'      => $latencyMs,
'status'          => 'ok',
'error_message'   => '',
]);

json_ok([
'division_code'  => $divisionCode,
'profile'        => $composed['profile'] ?? [],
'resolved_input' => $composed['resolved_input'] ?? [],
'model'          => $model,
'text'           => $text,
'latency_ms'     => $latencyMs,
'raw'            => $llm['raw'] ?? [],
]);
break;

// ── Direct NPC character chat (file-backed session history) ──────────────
case 'chat_npc':
only_method('POST');
verify_csrf();
$body = get_json_body();

$factionCode   = strtolower(trim((string) ($body['faction_code'] ?? '')));
$npcName       = trim((string) ($body['npc_name'] ?? ''));
$playerMessage = trim((string) ($body['player_message'] ?? ''));
$sessionId     = isset($body['session_id']) ? (int) $body['session_id'] : null;

if ($factionCode === '')    { json_error('faction_code is required.'); }
if ($npcName === '')        { json_error('npc_name is required.'); }
if ($playerMessage === '')  { json_error('player_message is required.'); }

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

$chatSessions = new NpcChatSessionRepository();

// Resolve or create session.
if ($sessionId !== null) {
$session = $chatSessions->loadSession($db, $sessionId, $uid);
if ($session === null) {
json_error('Session not found or access denied.', 404);
}
$isNewSession = false;
} else {
$session      = $chatSessions->createSession($db, $uid, $factionCode, $npcName);
$sessionId    = (int) $session['id'];
$isNewSession = true;
}

$chatFile = (string) $session['chat_file'];

// Build system prompt from spec.
$systemPrompt = $specLoader->buildNpcSystemPrompt($npc, $spec);

// Inject summaries of previous sessions on new session start.
if ($isNewSession) {
$summaries = $chatSessions->loadPreviousSummaries($db, $uid, $factionCode, $npcName);
if (!empty($summaries)) {
$summaryLines = [];
foreach ($summaries as $s) {
$date = substr((string) ($s['started_at'] ?? ''), 0, 10);
$summaryLines[] = '[' . $date . '] ' . (string) ($s['summary'] ?? '');
}
$systemPrompt .= "\n\nBisherige Gespräche (Zusammenfassung):\n" . implode("\n", $summaryLines);
}
}

// Enrich with diplomacy context.
$diplomacyStmt = $db->prepare(
'SELECT d.standing, d.last_event
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

// Enrich with recent faction AI decisions.
$decisionsStmt = $db->prepare(
'SELECT n.action_key, n.reasoning
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

// Load this session's messages from disk and build message array.
$historyMessages = $chatSessions->loadMessages($chatFile);
$messages = [['role' => 'system', 'content' => $systemPrompt]];
foreach ($historyMessages as $row) {
$messages[] = ['role' => (string) ($row['role'] ?? 'user'), 'content' => (string) ($row['content'] ?? '')];
}
$messages[] = ['role' => 'user', 'content' => $playerMessage];

$start = microtime(true);
$llm = ollama_chat($messages, [
'model'       => $body['model'] ?? null,
'temperature' => $body['temperature'] ?? null,
'options'     => is_array($body['options'] ?? null) ? $body['options'] : null,
'timeout'     => isset($body['timeout']) ? (int) $body['timeout'] : null,
]);
$latencyMs = (int) round((microtime(true) - $start) * 1000);
$model     = (string) ($llm['model'] ?? (string) OLLAMA_DEFAULT_MODEL);

if (!($llm['ok'] ?? false)) {
$logRepository->log($db, [
'user_id'          => $uid,
'profile_key'      => 'npc_character_chat',
'model'            => $model,
'prompt_hash'      => hash('sha256', $playerMessage),
'prompt_preview'   => substr($playerMessage, 0, 800),
'response_preview' => '',
'latency_ms'       => $latencyMs,
'status'           => 'error',
'error_message'    => substr((string) ($llm['error'] ?? 'Ollama failed.'), 0, 512),
]);
json_error((string) ($llm['error'] ?? 'Ollama failed.'), (int) ($llm['status'] ?? 502));
}

$npcReply = (string) ($llm['text'] ?? '');

// Persist both turns to the session file on disk.
$chatSessions->appendMessages($db, $sessionId, $chatFile, [
['role' => 'user',      'content' => $playerMessage],
['role' => 'assistant', 'content' => $npcReply],
]);

$logRepository->log($db, [
'user_id'          => $uid,
'profile_key'      => 'npc_character_chat',
'model'            => $model,
'prompt_hash'      => hash('sha256', $playerMessage),
'prompt_preview'   => substr($playerMessage, 0, 800),
'response_preview' => substr($npcReply, 0, 1200),
'latency_ms'       => $latencyMs,
'status'           => 'ok',
'error_message'    => '',
]);

// Generate suggested player reply options via a second lightweight LLM call.
// For yes/no questions the LLM returns ["Ja","Nein"]; otherwise 3 stanced options.
$suggestionsMessages = [
[
'role'    => 'system',
'content' => 'Deine Aufgabe: Analysiere die folgende NPC-Aussage und generiere Antwortoptionen fuer den Spieler. Antworte NUR mit einem gueltigen JSON-Objekt ohne Markdown: {"is_yes_no":bool,"suggestions":["...","...","..."]}. Regel: Wenn die NPC-Aussage eine Ja/Nein-Frage ist, setze is_yes_no=true und suggestions=["Ja","Nein"]. Andernfalls is_yes_no=false und liefere genau 3 kurze Antwortoptionen (max. 80 Zeichen je) mit unterschiedlicher Haltung: eine zustimmende, eine neutrale oder skeptische und eine ablehnende. Formuliere die Optionen in der Sprache des Gespraechs aus Spielerperspektive.',
],
[
'role'    => 'user',
'content' => $npcReply,
],
];

$suggestLlm = ollama_chat($suggestionsMessages, [
'model'       => $body['model'] ?? null,
'temperature' => 0.6,
'options'     => ['num_predict' => 160],
'timeout'     => 15,
]);

$suggestedReplies = [];
$isYesNo = false;
if ($suggestLlm['ok'] ?? false) {
$rawSug = trim((string) ($suggestLlm['text'] ?? ''));
// Strip possible markdown code fences from less-capable models.
$rawSug = (string) preg_replace('/^```(?:json)?\s*/m', '', $rawSug);
$rawSug = (string) preg_replace('/```\s*$/m', '', $rawSug);
$decodedSug = json_decode(trim($rawSug), true);
if (is_array($decodedSug)) {
$isYesNo = (bool) ($decodedSug['is_yes_no'] ?? false);
$rawOpts = $decodedSug['suggestions'] ?? [];
if (is_array($rawOpts)) {
foreach ($rawOpts as $opt) {
$opt = trim((string) $opt);
if ($opt !== '') {
$suggestedReplies[] = $opt;
}
}
}
}
}

json_ok([
'session_id'        => $sessionId,
'faction_code'      => $factionCode,
'npc_name'          => (string) ($npc['name'] ?? $npcName),
'model'             => $model,
'reply'             => $npcReply,
'latency_ms'        => $latencyMs,
'suggested_replies' => $suggestedReplies,
'is_yes_no'         => $isYesNo,
]);
break;

// ── Close an NPC session and generate an LLM summary ─────────────────────
case 'close_npc_session':
only_method('POST');
verify_csrf();
$body = get_json_body();

$sessionId = isset($body['session_id']) ? (int) $body['session_id'] : 0;
if ($sessionId <= 0) {
json_error('session_id is required.');
}

$chatSessions = new NpcChatSessionRepository();
$session = $chatSessions->loadSession($db, $sessionId, $uid);
if ($session === null) {
json_error('Session not found or access denied.', 404);
}

if (!empty($session['summary'])) {
json_ok(['session_id' => $sessionId, 'summary' => (string) $session['summary'], 'already_closed' => true]);
break;
}

$chatFile = (string) $session['chat_file'];
$messages = $chatSessions->loadMessages($chatFile);
if (empty($messages)) {
json_ok(['session_id' => $sessionId, 'summary' => '', 'already_closed' => false]);
break;
}

// Build a condensed transcript for the summary prompt.
$transcriptLines = [];
foreach ($messages as $msg) {
$speaker = (string) ($msg['role'] ?? 'user') === 'assistant'
? (string) ($session['npc_name'] ?? 'NPC')
: 'Spieler';
$transcriptLines[] = $speaker . ': ' . (string) ($msg['content'] ?? '');
}
$transcript = implode("\n", $transcriptLines);

$summaryMessages = [
[
'role'    => 'system',
'content' => 'Fasse das folgende Gespräch in 2-3 Sätzen auf Deutsch zusammen. Schreibe in der dritten Person. Nenne keine Rollennamen wie "Spieler" oder "NPC" – beschreibe stattdessen, was besprochen wurde und welche Entscheidungen oder Eindrücke entstanden sind.',
],
[
'role'    => 'user',
'content' => $transcript,
],
];

$start = microtime(true);
$summaryLlm = ollama_chat($summaryMessages, [
'model'       => $body['model'] ?? null,
'temperature' => 0.3,
'options'     => ['num_predict' => 200],
'timeout'     => 30,
]);
$latencyMs = (int) round((microtime(true) - $start) * 1000);
$model     = (string) ($summaryLlm['model'] ?? (string) OLLAMA_DEFAULT_MODEL);

if (!($summaryLlm['ok'] ?? false)) {
$logRepository->log($db, [
'user_id'          => $uid,
'profile_key'      => 'npc_character_chat',
'model'            => $model,
'prompt_hash'      => hash('sha256', $transcript),
'prompt_preview'   => substr($transcript, 0, 800),
'response_preview' => '',
'latency_ms'       => $latencyMs,
'status'           => 'error',
'error_message'    => substr((string) ($summaryLlm['error'] ?? 'Ollama failed.'), 0, 512),
]);
json_error((string) ($summaryLlm['error'] ?? 'Ollama failed.'), (int) ($summaryLlm['status'] ?? 502));
}

$summary = trim((string) ($summaryLlm['text'] ?? ''));
$chatSessions->saveSessionSummary($db, $sessionId, $summary);

$logRepository->log($db, [
'user_id'          => $uid,
'profile_key'      => 'npc_character_chat',
'model'            => $model,
'prompt_hash'      => hash('sha256', $transcript),
'prompt_preview'   => substr($transcript, 0, 800),
'response_preview' => substr($summary, 0, 1200),
'latency_ms'       => $latencyMs,
'status'           => 'ok',
'error_message'    => '',
]);

json_ok(['session_id' => $sessionId, 'summary' => $summary, 'already_closed' => false]);
break;

default:
json_error('Unknown action');
}
