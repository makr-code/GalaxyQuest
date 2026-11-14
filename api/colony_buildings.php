<?php
/**
 * Colony Buildings API
 *
 * GET  /api/colony_buildings.php?action=get_layout&colony_id=N
 *        – All building slots for a colony, keyed by "x,y"
 * POST /api/colony_buildings.php?action=settle
 *        body: {colony_id}
 * POST /api/colony_buildings.php?action=place_building
 *        body: {colony_id, building_type, slot_x, slot_y}
 * POST /api/colony_buildings.php?action=remove_building
 *        body: {colony_id, slot_x, slot_y}
 * POST /api/colony_buildings.php?action=upgrade_slot
 *        body: {colony_id, slot_x, slot_y}
 * GET  /api/colony_buildings.php?action=get_slot_info&colony_id=N&slot_x=X&slot_y=Y
 *        – Slot details + full upgrade history
 *
 * Referenz: docs/gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md
 *           docs/github-issues/09-colony-buildings-backend.md
 */
use GalaxyQuest\Economy\OnDemandEconomy;

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();
$db     = get_db();

if ($action === 'settle') {
    only_method('POST');
    verify_csrf();
    $body = get_json_body();
    $cid = filter_var($body['colony_id'] ?? null, FILTER_VALIDATE_INT);
    if ($cid === false || $cid < 1) {
        json_error('Invalid colony_id.', 400);
    }
    try {
        json_ok((new OnDemandEconomy($db))->settle($cid, $uid));
    } catch (DomainException $error) {
        json_error($error->getMessage(), $error->getCode() ?: 400);
    }
}

$economy = new OnDemandEconomy($db);
try {
    if (in_array($action, ['place_building', 'upgrade_slot', 'remove_building'], true)) {
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid = (int)($body['colony_id'] ?? 0);
        $x = filter_var($body['slot_x'] ?? null, FILTER_VALIDATE_INT);
        $y = filter_var($body['slot_y'] ?? null, FILTER_VALIDATE_INT);
        if ($x === false || $y === false) {
            json_error('Integer slot coordinates required.', 400);
        }
        $snapshot = $economy->settle($cid, $uid);
        if ($action === 'remove_building') {
            $economy->remove($cid, $uid, $x, $y);
            json_ok();
        }
        $type = $body['building_type'] ?? '';
        if ($action === 'upgrade_slot') {
            $type = '';
            foreach ($snapshot['slots'] as $slot) {
                if ((int)$slot['slot_x'] === $x && (int)$slot['slot_y'] === $y) {
                    $type = $slot['building_type'];
                }
            }
        } else {
            foreach ($snapshot['slots'] as $slot) {
                if ((int)$slot['slot_x'] === $x && (int)$slot['slot_y'] === $y) {
                    json_error('Slot already occupied.', 409);
                }
            }
        }
        if (!is_string($type) || $type === '') {
            json_error('Building not found.', 404);
        }
        json_ok($economy->queue($cid, $uid, $type, [$x, $y]));
    }
} catch (DomainException $error) {
    json_error($error->getMessage(), $error->getCode() ?: 400);
}

switch ($action) {

    // ── get_layout ────────────────────────────────────────────────────────────
    case 'get_layout': {
        only_method('GET');
        $colonyId = (int)($_GET['colony_id'] ?? 0);
        if ($colonyId <= 0) {
            json_error('Missing colony_id', 400);
        }
        _assert_colony_owner($db, $uid, $colonyId);

        $stmt = $db->prepare(
            'SELECT id, colony_id, slot_x, slot_y, building_type, level, built_at
             FROM colony_building_slots
             WHERE colony_id = ?
             ORDER BY slot_y ASC, slot_x ASC'
        );
        $stmt->execute([$colonyId]);
        $slots = $stmt->fetchAll();

        // Group into a grid keyed by "x,y" for convenient frontend consumption
        $grid = [];
        foreach ($slots as $slot) {
            $grid[$slot['slot_x'] . ',' . $slot['slot_y']] = $slot;
        }

        json_response(['success' => true, 'colony_id' => $colonyId, 'grid' => $grid, 'slots' => $slots]);
    }

    // ── get_slot_info ─────────────────────────────────────────────────────────
    case 'get_slot_info': {
        only_method('GET');
        $colonyId = (int)($_GET['colony_id'] ?? 0);
        $slotX    = isset($_GET['slot_x']) ? (int)$_GET['slot_x'] : null;
        $slotY    = isset($_GET['slot_y']) ? (int)$_GET['slot_y'] : null;

        if ($colonyId <= 0 || $slotX === null || $slotY === null) {
            json_error('colony_id, slot_x and slot_y required', 400);
        }

        _assert_colony_owner($db, $uid, $colonyId);

        $stmt = $db->prepare(
            'SELECT id, colony_id, slot_x, slot_y, building_type, level, built_at
             FROM colony_building_slots
             WHERE colony_id = ? AND slot_x = ? AND slot_y = ?'
        );
        $stmt->execute([$colonyId, $slotX, $slotY]);
        $slot = $stmt->fetch();
        if (!$slot) {
            json_error('Slot not found', 404);
        }

        $stmt = $db->prepare(
            'SELECT id, from_level, to_level, started_at, completes_at, status
             FROM colony_building_upgrades
             WHERE slot_id = ?
             ORDER BY started_at DESC'
        );
        $stmt->execute([$slot['id']]);
        $slot['upgrade_history'] = $stmt->fetchAll();

        json_response(['success' => true, 'slot' => $slot]);
    }

    default:
        json_error("Unknown action: $action", 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abort with 403 if the authenticated user does not own the colony.
 */
function _assert_colony_owner(PDO $db, int $uid, int $colonyId): void
{
    $stmt = $db->prepare('SELECT id FROM colonies WHERE id = ? AND user_id = ?');
    $stmt->execute([$colonyId, $uid]);
    if (!$stmt->fetch()) {
        json_error('Colony not found or access denied', 403);
    }
}
