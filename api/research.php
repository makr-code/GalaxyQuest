<?php
/**
 * Research API
 * GET  /api/research.php?action=list&colony_id=X
 * POST /api/research.php?action=research  body: {colony_id, type}
 * POST /api/research.php?action=finish
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';
require_once __DIR__ . '/achievements.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        $cid = (int)($_GET['colony_id'] ?? 0);
        $db  = get_db();
        verify_colony_ownership($db, $cid, $uid);
        $cacheKeyParams = ['uid' => $uid, 'cid' => $cid];
        $cached = gq_cache_get('research_list', $cacheKeyParams);
        if (is_array($cached) && isset($cached['research'])) {
            json_ok($cached);
        }

        $rows = $db->prepare(
            'SELECT type, level, research_start, research_end FROM research WHERE user_id = ? ORDER BY type'
        );
        $rows->execute([$uid]);
        $list = [];
        foreach ($rows->fetchAll() as $r) {
            $next = $r['level'] + 1;
            $cost = research_cost($r['type'], $next);
            $prereqCheck = check_research_prereqs($db, $uid, $r['type']);
            $list[] = [
                'type'              => $r['type'],
                'level'             => (int)$r['level'],
                'research_start'    => $r['research_start'],
                'research_end'      => $r['research_end'],
                'next_cost'         => $cost,
                'can_research'      => $prereqCheck['can_research'],
                'missing_prereqs'   => $prereqCheck['missing_prereqs'],
            ];
        }
        $payload = ['research' => $list];
        gq_cache_set('research_list', $cacheKeyParams, $payload, CACHE_TTL_DEFAULT);
        json_ok($payload);
        break;

    case 'research':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid  = (int)($body['colony_id'] ?? 0);
        $type = $body['type'] ?? '';
        $db   = get_db();
        verify_colony_ownership($db, $cid, $uid);
        update_colony_resources($db, $cid);

        $busy = $db->prepare(
            'SELECT id FROM research WHERE user_id = ? AND research_end IS NOT NULL'
        );
        $busy->execute([$uid]);
        if ($busy->fetch()) {
            json_error('Another research is already in progress.');
        }

        $rRow = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = ?');
        $rRow->execute([$uid, $type]);
        $res = $rRow->fetch();
        if (!$res) { json_error('Research type not found.'); }

        // Check prerequisites
        $prereqCheck = check_research_prereqs($db, $uid, $type);
        if (!$prereqCheck['can_research']) {
            $missing = $prereqCheck['missing_prereqs'];
            $missing_str = implode('; ', array_map(function($m) {
                return $m['tech'] . ' Lv' . $m['required_level'] . ' (have ' . $m['current_level'] . ')';
            }, $missing));
            json_error('Prerequisites not met: ' . $missing_str);
        }

        $nextLevel = (int)$res['level'] + 1;
        $cost      = research_cost($type, $nextLevel);

        $colony = $db->prepare('SELECT metal, crystal, deuterium, colony_type FROM colonies WHERE id = ?');
        $colony->execute([$cid]);
        $cRes = $colony->fetch();

        if ($cRes['metal'] < $cost['metal'] || $cRes['crystal'] < $cost['crystal']
            || $cRes['deuterium'] < $cost['deuterium']) {
            json_error('Insufficient resources.');
        }

        $labLevel  = get_building_level($db, $cid, 'research_lab');
        $secs      = research_time($cost, $labLevel);

        // Apply science director bonuses (time + cost reduction)
        $sciDir = get_colony_leader($db, $cid, 'science_director');
        if ($sciDir) {
            $secs = leader_research_time($secs, (int)$sciDir['skill_research']);
            $cost = leader_research_cost($cost, (int)$sciDir['skill_efficiency']);
        }
        
        // Apply colony-type research time bonus (research colony −15%)
        $colonyType = $cRes['colony_type'] ?? 'balanced';
        if ($colonyType === 'research') {
            $secs = max(1, (int)round($secs * 0.85));
        }

        // Quantum Computing reduces research time by 20%
        $qStmt = $db->prepare('SELECT level FROM research WHERE user_id = ? AND type = "quantum_computing" LIMIT 1');
        $qStmt->execute([$uid]);
        $quantumLevel = (int)($qStmt->fetchColumn() ?: 0);
        if ($quantumLevel >= 1) {
            $secs = max(1, (int)round($secs * 0.80));
        }

        // Science Vessel orbit bonus: −10% research time per vessel, max 3 vessels (−30%)
        try {
            $svStmt = $db->prepare(
                'SELECT COALESCE(SUM(count), 0) FROM ships WHERE colony_id = ? AND type = \'science_vessel\''
            );
            $svStmt->execute([$cid]);
            $sciVessels = min(3, (int)$svStmt->fetchColumn());
            if ($sciVessels > 0) {
                $secs = max(1, (int)round($secs * (1.0 - 0.10 * $sciVessels)));
            }
        } catch (Throwable $e) { /* ignore pre-migration */ }
        $end      = date('Y-m-d H:i:s', time() + $secs);

        $db->prepare(
            'UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?'
        )->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $cid]);

        $db->prepare(
            'UPDATE research SET research_start=NOW(), research_end=? WHERE user_id=? AND type=?'
        )->execute([$end, $uid, $type]);

        gq_cache_flush('research_list');

        json_ok(['research_end' => $end, 'duration_secs' => $secs]);
        break;

    case 'finish':
        only_method('POST');
        verify_csrf();
        $db = get_db();
        $completed = [];
        $due = $db->prepare(
            'SELECT type FROM research
             WHERE user_id=? AND research_end IS NOT NULL AND research_end <= NOW()'
        );
        $due->execute([$uid]);
        foreach ($due->fetchAll() as $r) {
            $completed[] = (string)$r['type'];
            $db->prepare(
                'UPDATE research SET level=level+1, research_end=NULL WHERE user_id=? AND type=?'
            )->execute([$uid, $r['type']]);
        }
        gq_cache_flush('research_list');
        check_and_update_achievements($db, $uid);
        json_ok(['completed' => $completed]);
        break;

    default:
        json_error('Unknown action');
}
