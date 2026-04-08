<?php
/**
 * Colonization API
 *
 * GET  /api/colonization.php?action=sprawl_status      – Aktueller Sprawl + Malus-Effekte
 * GET  /api/colonization.php?action=list_sectors        – Alle Sektoren mit Gouverneur + Systemen
 * GET  /api/colonization.php?action=sector_detail&id=N  – Sektor-Details inkl. Kolonien, Budget
 * POST /api/colonization.php?action=create_sector       body: {name}
 * POST /api/colonization.php?action=update_sector       body: {sector_id, name?, tax_rate?, autonomy_level?}
 * POST /api/colonization.php?action=delete_sector       body: {sector_id}
 * POST /api/colonization.php?action=assign_system       body: {sector_id, star_system_id}
 * POST /api/colonization.php?action=remove_system       body: {sector_id, star_system_id}
 * GET  /api/colonization.php?action=list_governors      – Alle Gouverneure (frei + zugewiesen)
 * POST /api/colonization.php?action=appoint_governor    body: {governor_id, sector_id}
 * POST /api/colonization.php?action=dismiss_governor    body: {governor_id}
 * GET  /api/colonization.php?action=list_edicts         – Alle Edikte mit Status
 * POST /api/colonization.php?action=activate_edict      body: {edict_type}
 * POST /api/colonization.php?action=deactivate_edict    body: {edict_type}
 *
 * Referenz: docs/gamedesign/COLONIZATION_SYSTEM_DESIGN.md
 *           docs/github-issues/01-colonization-db-backend.md
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../lib/ColonizationEngine.php';

$action = $_GET['action'] ?? '';
$uid    = require_auth();
$db     = get_db();

switch ($action) {
    // ── Sprawl ────────────────────────────────────────────────────────────────
    case 'sprawl_status':
        only_method('GET');
        json_response(ColonizationEngine::recalcSprawl($db, $uid));

    // ── Sektoren ──────────────────────────────────────────────────────────────
    case 'list_sectors': {
        only_method('GET');
        $stmt = $db->prepare(
            'SELECT s.id, s.name, s.autonomy_level, s.tax_rate, s.approval_rating,
                    s.governor_id, s.capital_colony_id,
                    g.admin_bonus AS governor_admin_bonus,
                    g.salary      AS governor_salary,
                    COUNT(ss.star_system_id) AS system_count
             FROM sectors s
             LEFT JOIN governors g ON g.id = s.governor_id
             LEFT JOIN sector_systems ss ON ss.sector_id = s.id
             WHERE s.player_id = ?
             GROUP BY s.id
             ORDER BY s.name'
        );
        $stmt->execute([$uid]);
        json_response(['success' => true, 'sectors' => $stmt->fetchAll()]);
    }

    case 'sector_detail': {
        only_method('GET');
        $sectorId = (int)($_GET['id'] ?? 0);
        if ($sectorId <= 0) {
            json_error('Missing sector id', 400);
        }

        $stmt = $db->prepare(
            'SELECT s.*, g.admin_bonus AS governor_admin_bonus, g.salary AS governor_salary
             FROM sectors s
             LEFT JOIN governors g ON g.id = s.governor_id
             WHERE s.id = ? AND s.player_id = ?'
        );
        $stmt->execute([$sectorId, $uid]);
        $sector = $stmt->fetch();
        if (!$sector) {
            json_error('Sector not found', 404);
        }

        // Systeme im Sektor
        $stmt = $db->prepare(
            'SELECT ss.star_system_id, st.name AS system_name
             FROM sector_systems ss
             LEFT JOIN star_systems st ON st.id = ss.star_system_id
             WHERE ss.sector_id = ?'
        );
        $stmt->execute([$sectorId]);
        $sector['systems'] = $stmt->fetchAll();

        // Kolonien im Sektor
        $stmt = $db->prepare(
            'SELECT c.id, c.name, c.colony_type, c.phase, c.population,
                    c.metal, c.crystal, c.deuterium, c.energy_balance
             FROM colonies c
             WHERE c.sector_id = ? AND c.user_id = ?'
        );
        $stmt->execute([$sectorId, $uid]);
        $sector['colonies'] = $stmt->fetchAll();

        json_response(['success' => true, 'sector' => $sector]);
    }

    case 'create_sector': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $name = trim($body['name'] ?? '');
        if ($name === '' || mb_strlen($name) > 64) {
            json_error('Sector name required (max 64 chars)', 400);
        }
        $sectorId = ColonizationEngine::createSector($db, $uid, $name);
        json_response(['success' => true, 'sector_id' => $sectorId]);
    }

    case 'update_sector': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $sectorId = (int)($body['sector_id'] ?? 0);
        if ($sectorId <= 0) {
            json_error('Missing sector_id', 400);
        }

        $allowed = ['name', 'tax_rate', 'autonomy_level'];
        $updates = [];
        $params  = [];
        foreach ($allowed as $field) {
            if (!isset($body[$field])) continue;
            if ($field === 'name') {
                $v = trim($body[$field]);
                if ($v === '' || mb_strlen($v) > 64) {
                    json_error('Invalid name', 400);
                }
                $updates[] = 'name = ?';
                $params[]  = $v;
            } elseif ($field === 'tax_rate') {
                $v = round((float)$body[$field], 2);
                if ($v < 0.5 || $v > 1.5) {
                    json_error('tax_rate must be between 0.50 and 1.50', 400);
                }
                $updates[] = 'tax_rate = ?';
                $params[]  = $v;
            } elseif ($field === 'autonomy_level') {
                $v = max(0, min(100, (int)$body[$field]));
                $updates[] = 'autonomy_level = ?';
                $params[]  = $v;
            }
        }
        if (empty($updates)) {
            json_error('Nothing to update', 400);
        }
        $params[] = $sectorId;
        $params[] = $uid;
        $db->prepare(
            'UPDATE sectors SET ' . implode(', ', $updates)
            . ' WHERE id = ? AND player_id = ?'
        )->execute($params);
        json_response(['success' => true]);
    }

    case 'delete_sector': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $sectorId = (int)($body['sector_id'] ?? 0);
        if ($sectorId <= 0) {
            json_error('Missing sector_id', 400);
        }
        // Kolonien-Sektor-Zuordnung zurücksetzen
        $db->prepare('UPDATE colonies SET sector_id = NULL WHERE sector_id = ? AND user_id = ?')
           ->execute([$sectorId, $uid]);
        // Gouverneur freistellen
        $db->prepare('UPDATE governors SET sector_id = NULL WHERE sector_id = ? AND player_id = ?')
           ->execute([$sectorId, $uid]);
        $db->prepare('DELETE FROM sectors WHERE id = ? AND player_id = ?')
           ->execute([$sectorId, $uid]);
        json_response(['success' => true]);
    }

    case 'assign_system': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $sectorId    = (int)($body['sector_id'] ?? 0);
        $starSystemId = (int)($body['star_system_id'] ?? 0);
        if ($sectorId <= 0 || $starSystemId <= 0) {
            json_error('Missing sector_id or star_system_id', 400);
        }
        try {
            ColonizationEngine::assignSystemToSector($db, $uid, $starSystemId, $sectorId);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 400);
        }
        json_response(['success' => true]);
    }

    case 'remove_system': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $sectorId    = (int)($body['sector_id'] ?? 0);
        $starSystemId = (int)($body['star_system_id'] ?? 0);
        if ($sectorId <= 0 || $starSystemId <= 0) {
            json_error('Missing sector_id or star_system_id', 400);
        }
        // Ownership-Check
        $stmt = $db->prepare('SELECT COUNT(*) FROM sectors WHERE id = ? AND player_id = ?');
        $stmt->execute([$sectorId, $uid]);
        if ((int)$stmt->fetchColumn() === 0) {
            json_error('Sector not found', 404);
        }
        $db->prepare(
            'DELETE FROM sector_systems WHERE sector_id = ? AND star_system_id = ?'
        )->execute([$sectorId, $starSystemId]);
        json_response(['success' => true]);
    }

    // ── Gouverneure ───────────────────────────────────────────────────────────
    case 'list_governors': {
        only_method('GET');
        $stmt = $db->prepare(
            'SELECT g.id, g.npc_id, g.sector_id, g.admin_bonus, g.salary, g.appointed_at,
                    s.name AS sector_name
             FROM governors g
             LEFT JOIN sectors s ON s.id = g.sector_id
             WHERE g.player_id = ?
             ORDER BY g.appointed_at DESC'
        );
        $stmt->execute([$uid]);
        json_response(['success' => true, 'governors' => $stmt->fetchAll()]);
    }

    case 'appoint_governor': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $governorId = (int)($body['governor_id'] ?? 0);
        $sectorId   = (int)($body['sector_id'] ?? 0);
        if ($governorId <= 0 || $sectorId <= 0) {
            json_error('Missing governor_id or sector_id', 400);
        }
        try {
            ColonizationEngine::appointGovernor($db, $uid, $governorId, $sectorId);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 400);
        }
        json_response(['success' => true]);
    }

    case 'dismiss_governor': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $governorId = (int)($body['governor_id'] ?? 0);
        if ($governorId <= 0) {
            json_error('Missing governor_id', 400);
        }
        // Sektor-Rückreferenz bereinigen
        $stmt = $db->prepare('SELECT sector_id FROM governors WHERE id = ? AND player_id = ?');
        $stmt->execute([$governorId, $uid]);
        $row = $stmt->fetch();
        if (!$row) {
            json_error('Governor not found', 404);
        }
        if ($row['sector_id']) {
            $db->prepare('UPDATE sectors SET governor_id = NULL WHERE id = ? AND player_id = ?')
               ->execute([$row['sector_id'], $uid]);
        }
        $db->prepare('UPDATE governors SET sector_id = NULL WHERE id = ? AND player_id = ?')
           ->execute([$governorId, $uid]);
        json_response(['success' => true]);
    }

    // ── Edikte ────────────────────────────────────────────────────────────────
    case 'list_edicts': {
        only_method('GET');
        json_response(['success' => true, 'edicts' => ColonizationEngine::listEdicts($db, $uid)]);
    }

    case 'activate_edict': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $edictType = trim($body['edict_type'] ?? '');
        if ($edictType === '') {
            json_error('Missing edict_type', 400);
        }
        try {
            ColonizationEngine::setEdictActive($db, $uid, $edictType, true);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 400);
        }
        json_response(['success' => true]);
    }

    case 'deactivate_edict': {
        only_method('POST');
        verify_csrf();
        $body = json_decode(file_get_contents('php://input'), true) ?: [];
        $edictType = trim($body['edict_type'] ?? '');
        if ($edictType === '') {
            json_error('Missing edict_type', 400);
        }
        try {
            ColonizationEngine::setEdictActive($db, $uid, $edictType, false);
        } catch (RuntimeException $e) {
            json_error($e->getMessage(), 400);
        }
        json_response(['success' => true]);
    }

    default:
        json_error("Unknown action: $action", 404);
}
