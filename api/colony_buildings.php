<?php
/**
 * Colony Buildings API
 *
 * GET  /api/colony_buildings.php?action=get_layout&colony_id=N
 *        – All building slots for a colony, keyed by "x,y"
 * POST /api/colony_buildings.php?action=place_building
 *        body: {colony_id, building_type, slot_x, slot_y}
 * POST /api/colony_buildings.php?action=remove_building
 *        body: {colony_id, slot_x, slot_y}
 * POST /api/colony_buildings.php?action=upgrade_slot
 *        body: {colony_id, slot_x, slot_y, completes_in_seconds?}
 * GET  /api/colony_buildings.php?action=get_slot_info&colony_id=N&slot_x=X&slot_y=Y
 *        – Slot details + full upgrade history
 *
 * Referenz: docs/gamedesign/COLONY_BUILDING_SYSTEM_DESIGN.md
 *           docs/github-issues/09-colony-buildings-backend.md
 */
require_once __DIR__ . '/helpers.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();
$db     = get_db();

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

    // ── place_building ────────────────────────────────────────────────────────
    case 'place_building': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];

        $colonyId     = (int)($body['colony_id'] ?? 0);
        $buildingType = trim($body['building_type'] ?? '');
        $slotX        = (int)($body['slot_x'] ?? PHP_INT_MIN);
        $slotY        = (int)($body['slot_y'] ?? PHP_INT_MIN);

        if ($colonyId <= 0) {
            json_error('Missing colony_id', 400);
        }
        if ($buildingType === '' || mb_strlen($buildingType) > 64) {
            json_error('building_type required (max 64 chars)', 400);
        }
        if ($body['slot_x'] === null || $body['slot_y'] === null) {
            json_error('slot_x and slot_y required', 400);
        }

        _assert_colony_owner($db, $uid, $colonyId);

        // Verify slot is currently empty
        $stmt = $db->prepare(
            'SELECT id FROM colony_building_slots
             WHERE colony_id = ? AND slot_x = ? AND slot_y = ?'
        );
        $stmt->execute([$colonyId, $slotX, $slotY]);
        if ($stmt->fetch()) {
            json_error('Slot already occupied', 409);
        }

        $db->prepare(
            'INSERT INTO colony_building_slots
                 (colony_id, slot_x, slot_y, building_type, level, built_at)
             VALUES (?, ?, ?, ?, 1, NOW())'
        )->execute([$colonyId, $slotX, $slotY, $buildingType]);

        json_response(['success' => true, 'slot_id' => (int)$db->lastInsertId()]);
    }

    // ── remove_building ───────────────────────────────────────────────────────
    case 'remove_building': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];

        $colonyId = (int)($body['colony_id'] ?? 0);
        $slotX    = isset($body['slot_x']) ? (int)$body['slot_x'] : null;
        $slotY    = isset($body['slot_y']) ? (int)$body['slot_y'] : null;

        if ($colonyId <= 0 || $slotX === null || $slotY === null) {
            json_error('colony_id, slot_x and slot_y required', 400);
        }

        _assert_colony_owner($db, $uid, $colonyId);

        $stmt = $db->prepare(
            'SELECT id FROM colony_building_slots
             WHERE colony_id = ? AND slot_x = ? AND slot_y = ?'
        );
        $stmt->execute([$colonyId, $slotX, $slotY]);
        $row = $stmt->fetch();
        if (!$row) {
            json_error('Slot not found', 404);
        }

        $db->prepare('DELETE FROM colony_building_slots WHERE id = ?')
           ->execute([$row['id']]);

        json_response(['success' => true]);
    }

    // ── upgrade_slot ──────────────────────────────────────────────────────────
    case 'upgrade_slot': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];

        $colonyId          = (int)($body['colony_id'] ?? 0);
        $slotX             = isset($body['slot_x']) ? (int)$body['slot_x'] : null;
        $slotY             = isset($body['slot_y']) ? (int)$body['slot_y'] : null;
        $completesInSec    = max(1, (int)($body['completes_in_seconds'] ?? 60));

        if ($colonyId <= 0 || $slotX === null || $slotY === null) {
            json_error('colony_id, slot_x and slot_y required', 400);
        }

        _assert_colony_owner($db, $uid, $colonyId);

        $stmt = $db->prepare(
            'SELECT id, level FROM colony_building_slots
             WHERE colony_id = ? AND slot_x = ? AND slot_y = ?'
        );
        $stmt->execute([$colonyId, $slotX, $slotY]);
        $slot = $stmt->fetch();
        if (!$slot) {
            json_error('Slot not found', 404);
        }

        // Ensure no pending upgrade exists for this slot
        $stmt = $db->prepare(
            "SELECT id FROM colony_building_upgrades
             WHERE slot_id = ? AND status = 'pending'"
        );
        $stmt->execute([$slot['id']]);
        if ($stmt->fetch()) {
            json_error('Upgrade already pending for this slot', 409);
        }

        $fromLevel = (int)$slot['level'];
        $toLevel   = $fromLevel + 1;

        $db->prepare(
            'INSERT INTO colony_building_upgrades
                 (slot_id, from_level, to_level, started_at, completes_at, status)
             VALUES (?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), \'pending\')'
        )->execute([$slot['id'], $fromLevel, $toLevel, $completesInSec]);

        json_response([
            'success'            => true,
            'upgrade_id'         => (int)$db->lastInsertId(),
            'from_level'         => $fromLevel,
            'to_level'           => $toLevel,
            'completes_in_sec'   => $completesInSec,
        ]);
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
