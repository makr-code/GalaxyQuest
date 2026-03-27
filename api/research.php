<?php
/**
 * Research API
 * GET  /api/research.php?action=list&planet_id=X
 * POST /api/research.php?action=research  body: {planet_id, type}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php'; // get_building_level, verify_planet_ownership

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {
    case 'list':
        only_method('GET');
        $pid = (int)($_GET['planet_id'] ?? 0);
        $db  = get_db();
        verify_planet_ownership($db, $pid, $uid);

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
        $pid  = (int)($body['planet_id'] ?? 0);
        $type = $body['type'] ?? '';
        $db   = get_db();
        verify_planet_ownership($db, $pid, $uid);
        update_planet_resources($db, $pid);

        // Check no other research in progress
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
        if (!$res) {
            json_error('Research type not found.');
        }

        $nextLevel = (int)$res['level'] + 1;
        $cost = research_cost($type, $nextLevel);

        $planet = $db->prepare('SELECT metal, crystal, deuterium FROM planets WHERE id = ?');
        $planet->execute([$pid]);
        $pRes = $planet->fetch();

        if ($pRes['metal'] < $cost['metal'] || $pRes['crystal'] < $cost['crystal']
            || $pRes['deuterium'] < $cost['deuterium']) {
            json_error('Insufficient resources.');
        }

        $labLevel = get_building_level($db, $pid, 'research_lab');
        $secs = research_time($cost, $labLevel);
        $end  = date('Y-m-d H:i:s', time() + $secs);

        $db->prepare(
            'UPDATE planets SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
             WHERE id = ?'
        )->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $pid]);

        $db->prepare(
            'UPDATE research SET research_end = ? WHERE user_id = ? AND type = ?'
        )->execute([$end, $uid, $type]);

        json_ok(['research_end' => $end, 'duration_secs' => $secs]);
        break;

    case 'finish':
        only_method('POST');
        verify_csrf();
        $db = get_db();
        // Complete finished research
        $due = $db->prepare(
            'SELECT type FROM research
             WHERE user_id = ? AND research_end IS NOT NULL AND research_end <= NOW()'
        );
        $due->execute([$uid]);
        foreach ($due->fetchAll() as $r) {
            $db->prepare(
                'UPDATE research SET level = level + 1, research_end = NULL
                 WHERE user_id = ? AND type = ?'
            )->execute([$uid, $r['type']]);
        }
        json_ok();
        break;

    default:
        json_error('Unknown action');
}
