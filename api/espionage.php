<?php
/**
 * Espionage API
 *
 * POST /api/espionage.php?action=hire_agent          body: {name, specialization}
 * POST /api/espionage.php?action=assign_mission      body: {agent_id, mission_type, target_user_id?}
 * GET  /api/espionage.php?action=get_active_missions – list active missions
 * GET  /api/espionage.php?action=mission_result&id=N – result of a completed mission
 *
 * Referenz: docs/gamedesign/EMPIRE_CATEGORIES.md, docs/github-issues/06
 */
require_once __DIR__ . '/helpers.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();
$db     = get_db();

const AGENT_HIRE_COST     = 500;
const MISSION_DURATION_S  = 3600; // 1 hour per mission

$validSpecs = ['sabotage', 'intel', 'counter_intel', 'economic', 'diplomatic', 'military'];
$validMissions = [
    'gather_intel', 'sabotage_production', 'steal_research',
    'counter_intel', 'diplomatic_incident', 'military_recon',
];

switch ($action) {

    case 'hire_agent': {
        only_method('POST');
        $body = get_json_body();
        $name = trim((string)($body['name'] ?? ''));
        $spec = (string)($body['specialization'] ?? 'intel');

        if ($name === '') {
            json_error('Agent name required', 400);
        }
        if (!in_array($spec, $validSpecs, true)) {
            json_error('Invalid specialization', 400);
        }

        $db->prepare(
            'INSERT INTO espionage_agents (user_id, name, skill_level, specialization, hire_cost)
             VALUES (?, ?, 1, ?, ?)'
        )->execute([$uid, $name, $spec, AGENT_HIRE_COST]);

        $agentId = (int)$db->lastInsertId();
        json_ok(['agent_id' => $agentId, 'hire_cost' => AGENT_HIRE_COST]);
    }

    case 'assign_mission': {
        only_method('POST');
        $body       = get_json_body();
        $agentId    = positive_int($body['agent_id'] ?? 0);
        $missionType = (string)($body['mission_type'] ?? '');
        $targetUid  = isset($body['target_user_id']) ? positive_int($body['target_user_id']) : null;

        if ($agentId <= 0) {
            json_error('agent_id required', 400);
        }
        if (!in_array($missionType, $validMissions, true)) {
            json_error('Invalid mission_type', 400);
        }

        // Verify agent belongs to user and is available
        $stmt = $db->prepare(
            "SELECT id, status FROM espionage_agents WHERE id = ? AND user_id = ?"
        );
        $stmt->execute([$agentId, $uid]);
        $agent = $stmt->fetch();
        if (!$agent) {
            json_error('Agent not found', 404);
        }
        if ($agent['status'] !== 'available') {
            json_error('Agent is not available', 409);
        }

        $completesAt = date('Y-m-d H:i:s', time() + MISSION_DURATION_S);

        $db->prepare(
            'INSERT INTO espionage_missions
                 (agent_id, owner_user_id, target_user_id, mission_type, status, started_at, completes_at)
             VALUES (?, ?, ?, ?, \'active\', NOW(), ?)'
        )->execute([$agentId, $uid, $targetUid, $missionType, $completesAt]);

        $missionId = (int)$db->lastInsertId();

        $db->prepare(
            "UPDATE espionage_agents SET status = 'on_mission', mission_id = ? WHERE id = ?"
        )->execute([$missionId, $agentId]);

        json_ok(['mission_id' => $missionId, 'completes_at' => $completesAt]);
    }

    case 'get_active_missions': {
        only_method('GET');
        $stmt = $db->prepare(
            "SELECT em.id, em.mission_type, em.status, em.started_at, em.completes_at,
                    em.target_user_id, ea.name AS agent_name, ea.skill_level
             FROM espionage_missions em
             JOIN espionage_agents ea ON ea.id = em.agent_id
             WHERE em.owner_user_id = ? AND em.status = 'active'
             ORDER BY em.completes_at ASC"
        );
        $stmt->execute([$uid]);
        json_ok(['missions' => $stmt->fetchAll()]);
    }

    case 'mission_result': {
        only_method('GET');
        $missionId = positive_int($_GET['id'] ?? 0);
        if ($missionId <= 0) {
            json_error('Mission id required', 400);
        }

        $stmt = $db->prepare(
            "SELECT em.*, ea.name AS agent_name, ea.skill_level
             FROM espionage_missions em
             JOIN espionage_agents ea ON ea.id = em.agent_id
             WHERE em.id = ? AND em.owner_user_id = ?"
        );
        $stmt->execute([$missionId, $uid]);
        $mission = $stmt->fetch();
        if (!$mission) {
            json_error('Mission not found', 404);
        }

        // If completed and agent still on_mission, mark agent available again
        if ($mission['status'] === 'completed' && $mission['agent_id']) {
            $db->prepare(
                "UPDATE espionage_agents SET status = 'available', mission_id = NULL WHERE id = ?"
            )->execute([$mission['agent_id']]);
        }

        json_ok(['mission' => $mission]);
    }

    default:
        json_error('Unknown action', 400);
}
