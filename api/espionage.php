<?php
/**
 * Espionage API
 *
 * POST /api/espionage.php?action=hire_agent          body: {name, specialization}
 * POST /api/espionage.php?action=assign_mission      body: {agent_id, mission_type, target_user_id?}
 * GET  /api/espionage.php?action=get_active_missions – list active missions
 * POST /api/espionage.php?action=mission_result      body: {id}
 *
 * Referenz: docs/gamedesign/EMPIRE_CATEGORIES.md, docs/github-issues/06
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/espionage_runtime.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {

    case 'hire_agent': {
        only_method('POST');
        verify_csrf();
        require_espionage_runtime();
    }

    case 'assign_mission': {
        only_method('POST');
        verify_csrf();
        require_espionage_runtime();
    }

    case 'get_active_missions': {
        only_method('GET');
        require_espionage_runtime();
    }

    case 'mission_result': {
        only_method('POST');
        verify_csrf();
        require_espionage_runtime();
    }

    default:
        json_error('Unknown action', 400);
}
