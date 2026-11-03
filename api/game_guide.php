<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/llm_soc/GameGuideNPC.php';

header('Content-Type: application/json; charset=utf-8');

$uid = require_auth();
$action = (string)($_GET['action'] ?? $_POST['action'] ?? 'greeting');
$readActions = ['greeting', 'help_topic', 'get_progress'];
$writeActions = ['assess_game_state', 'provide_help', 'record_checkpoint'];

if (in_array($action, $readActions, true)) {
    only_method('GET');
} elseif (in_array($action, $writeActions, true)) {
    only_method('POST');
    verify_csrf();
} else {
    json_error('Unknown action: ' . $action, 400);
}

$db = get_db();
$guide = new GameGuideNPC($db);

switch ($action) {
    case 'greeting':
        $stmt = $db->prepare(
            'SELECT player_level, is_new_player, last_active
             FROM game_guide_state
             WHERE user_id = ?'
        );
        $stmt->execute([$uid]);
        $playerData = $stmt->fetch(PDO::FETCH_ASSOC) ?: [
            'player_level' => 1,
            'is_new_player' => true,
            'last_active' => time(),
        ];
        json_ok(array_merge($guide->getGreeting($uid, $playerData), ['ok' => true, 'status' => 'ok']));

    case 'assess_game_state':
        $gameState = json_decode((string)($_POST['game_state'] ?? '{}'), true);
        if (!is_array($gameState) || $gameState === []) {
            json_error('Missing game_state parameter', 400);
        }
        $assessment = $guide->assessGameState($uid, $gameState);
        updateGuideState($db, $uid, $gameState, $assessment);
        json_ok(array_merge($assessment, ['ok' => true]));

    case 'help_topic':
        $category = trim((string)($_GET['category'] ?? ''));
        if ($category === '') {
            json_error('Missing category parameter', 400);
        }
        $topic = $guide->getHelpTopic($category);
        if (!($topic['ok'] ?? false)) {
            json_error((string)($topic['error'] ?? 'Topic not found'), 404);
        }
        json_ok($topic);

    case 'provide_help':
        $helpType = trim((string)($_POST['help_type'] ?? ''));
        $gameState = json_decode((string)($_POST['game_state'] ?? '{}'), true);
        if ($helpType === '' || !is_array($gameState)) {
            json_error('help_type and game_state are required', 400);
        }
        $result = $guide->provideDirectHelp($uid, $helpType, $gameState);
        if (!($result['ok'] ?? false)) {
            json_error((string)($result['reason'] ?? $result['error'] ?? 'Help is unavailable'), 429);
        }
        $db->prepare(
            'INSERT INTO game_guide_help_usage (user_id, help_type, times_used)
             VALUES (?, ?, 1)
             ON DUPLICATE KEY UPDATE times_used = times_used + 1, last_used_at = NOW()'
        )->execute([$uid, $helpType]);
        json_ok($result);

    case 'record_checkpoint':
        $checkpoint = trim((string)($_POST['checkpoint'] ?? ''));
        if ($checkpoint === '') {
            json_error('Missing checkpoint parameter', 400);
        }
        $guide->recordCheckpointCompletion($uid, $checkpoint);
        json_ok([
            'ok' => true,
            'checkpoint' => $checkpoint,
            'message' => 'Checkpoint recorded successfully',
        ]);

    case 'get_progress':
        $progress = $guide->getTutorialProgress($uid);
        json_ok([
            'ok' => true,
            'progress' => $progress,
            'checkpoint_count' => count($progress),
        ]);
}

function updateGuideState(PDO $db, int $userId, array $gameState, array $assessment): void
{
    $criticalIssue = null;
    if (!empty($assessment['critical_issues'])) {
        $criticalIssue = $assessment['critical_issues'][0]['type'] ?? null;
    }

    $timeHours = (int)($gameState['time_played_hours'] ?? 0);
    $stmt = $db->prepare(
        'INSERT INTO game_guide_state
            (user_id, current_issue_critical, last_assessment_at, time_played_hours)
         VALUES (?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE
            current_issue_critical = VALUES(current_issue_critical),
            last_assessment_at = NOW(),
            time_played_hours = VALUES(time_played_hours)'
    );
    $stmt->execute([$userId, $criticalIssue, $timeHours]);
}
