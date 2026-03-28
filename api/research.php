<?php
/**
 * Research API
 * GET  /api/research.php?action=list&colony_id=X
 * POST /api/research.php?action=research  body: {colony_id, type}
 * POST /api/research.php?action=finish
 */
require_once __DIR__ . '/helpers.php';
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

        $rows = $db->prepare(
            'SELECT type, level, research_end FROM research WHERE user_id = ? ORDER BY type'
        );
        $rows->execute([$uid]);
        $list = [];
        foreach ($rows->fetchAll() as $r) {
            $next = $r['level'] + 1;
            $cost = research_cost($r['type'], $next);
            $list[] = [
                'type'         => $r['type'],
                'level'        => (int)$r['level'],
                'research_end' => $r['research_end'],
                'next_cost'    => $cost,
            ];
        }
        json_ok(['research' => $list]);
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

        $nextLevel = (int)$res['level'] + 1;
        $cost      = research_cost($type, $nextLevel);

        $colony = $db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id = ?');
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
        $end      = date('Y-m-d H:i:s', time() + $secs);

        $db->prepare(
            'UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?'
        )->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $cid]);

        $db->prepare(
            'UPDATE research SET research_end=? WHERE user_id=? AND type=?'
        )->execute([$end, $uid, $type]);

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
        check_and_update_achievements($db, $uid);
        json_ok(['completed' => $completed]);
        break;

    default:
        json_error('Unknown action');
}
