<?php
/**
 * Empire API
 *
 * GET  /api/empire.php?action=get_scores          – 7 category scores for current user
 * GET  /api/empire.php?action=get_score_breakdown – detailed breakdown per score
 * GET  /api/empire.php?action=get_espionage_status – agent summary + active missions
 *
 * Referenz: docs/gamedesign/EMPIRE_CATEGORIES.md, docs/github-issues/06
 */
require_once __DIR__ . '/helpers.php';
require_once dirname(__DIR__) . '/scripts/project_user_overview.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();
$db     = get_db();

switch ($action) {

    case 'get_scores': {
        only_method('GET');
        $stmt = $db->prepare(
            'SELECT score_economy, score_military, score_research,
                    score_growth, score_stability, score_diplomacy,
                    score_espionage, total_score, calculated_at
             FROM empire_category_scores WHERE user_id = ?'
        );
        $stmt->execute([$uid]);
        $row = $stmt->fetch();
        if (!$row) {
            // First-time: compute now
            $scores = calc_and_store_empire_scores($db, $uid);
            json_ok(['scores' => $scores, 'fresh' => true]);
        }
        json_ok(['scores' => $row]);
    }

    case 'get_score_breakdown': {
        only_method('GET');
        $scores = calc_and_store_empire_scores($db, $uid);

        // Colony stats
        $stmt = $db->prepare(
            'SELECT COUNT(*) AS colony_count, COALESCE(SUM(population),0) AS total_pop,
                    COALESCE(SUM(metal+crystal+deuterium),0) AS total_resources,
                    COALESCE(AVG(energy_balance),0) AS avg_energy
             FROM colonies WHERE user_id = ?'
        );
        $stmt->execute([$uid]);
        $colonyStats = $stmt->fetch() ?: [];

        // Fleet stats
        $stmt2 = $db->prepare(
            'SELECT COUNT(*) AS fleet_count FROM fleets WHERE user_id = ? AND `returning` = 0'
        );
        $stmt2->execute([$uid]);
        $fleetCount = (int)$stmt2->fetchColumn();

        // Agent stats
        $stmt3 = $db->prepare(
            "SELECT COUNT(*) AS agent_count, COALESCE(AVG(skill_level),0) AS avg_skill
             FROM espionage_agents WHERE user_id = ? AND status != 'retired'"
        );
        $stmt3->execute([$uid]);
        $agentStats = $stmt3->fetch() ?: [];

        json_ok([
            'scores'      => $scores,
            'colony_stats' => $colonyStats,
            'fleet_count'  => $fleetCount,
            'agent_stats'  => $agentStats,
        ]);
    }

    case 'get_espionage_status': {
        only_method('GET');
        $stmt = $db->prepare(
            "SELECT id, name, skill_level, specialization, status, hired_at
             FROM espionage_agents WHERE user_id = ? ORDER BY skill_level DESC"
        );
        $stmt->execute([$uid]);
        $agents = $stmt->fetchAll();

        $stmt2 = $db->prepare(
            "SELECT em.id, em.mission_type, em.status, em.started_at, em.completes_at,
                    ea.name AS agent_name
             FROM espionage_missions em
             JOIN espionage_agents ea ON ea.id = em.agent_id
             WHERE em.owner_user_id = ? AND em.status = 'active'
             ORDER BY em.completes_at ASC"
        );
        $stmt2->execute([$uid]);
        $activeMissions = $stmt2->fetchAll();

        json_ok(['agents' => $agents, 'active_missions' => $activeMissions]);
    }

    default:
        json_error('Unknown action', 400);
}
