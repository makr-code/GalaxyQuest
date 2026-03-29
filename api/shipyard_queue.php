<?php

function ensure_ship_build_queue_table(PDO $db): void {
    static $ready = false;
    if ($ready) {
        return;
    }

    $db->exec(
        "CREATE TABLE IF NOT EXISTS ship_build_queue (
            id INT AUTO_INCREMENT PRIMARY KEY,
            colony_id INT NOT NULL,
            ship_type VARCHAR(64) NOT NULL,
            blueprint_id INT DEFAULT NULL,
            quantity INT NOT NULL DEFAULT 1,
            cost_metal INT NOT NULL DEFAULT 0,
            cost_crystal INT NOT NULL DEFAULT 0,
            cost_deuterium INT NOT NULL DEFAULT 0,
            duration_secs INT NOT NULL,
            queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at DATETIME DEFAULT NULL,
            eta DATETIME DEFAULT NULL,
            status ENUM('queued','running','done','cancelled') NOT NULL DEFAULT 'queued',
            FOREIGN KEY (colony_id) REFERENCES colonies(id) ON DELETE CASCADE,
            INDEX idx_sbq_colony_status (colony_id, status),
            INDEX idx_sbq_eta (eta)
        ) ENGINE=InnoDB"
    );

    $ready = true;
}

function estimate_ship_build_duration(PDO $db, int $colonyId, string $shipType, int $count): int {
    $count = max(1, $count);
    $unitCost = ship_cost($shipType);
    $totalCost = [
        'metal' => (int)($unitCost['metal'] ?? 0) * $count,
        'crystal' => (int)($unitCost['crystal'] ?? 0) * $count,
        'deuterium' => (int)($unitCost['deuterium'] ?? 0) * $count,
    ];

    $shipyardLevel = max(1, get_building_level($db, $colonyId, 'shipyard'));
    $naniteLevel = max(0, get_building_level($db, $colonyId, 'nanite_factory'));
    $secs = building_build_time($totalCost, $shipyardLevel, $naniteLevel);

    $blueprintId = blueprint_id_from_ship_type($shipType);
    if ($blueprintId !== null && vessel_blueprint_tables_exist($db)) {
        $stmt = $db->prepare('SELECT compiled_time_secs FROM vessel_blueprints WHERE id = ? LIMIT 1');
        $stmt->execute([$blueprintId]);
        $compiled = (int)$stmt->fetchColumn();
        if ($compiled > 0) {
            $secs = max($secs, $compiled * $count);
        }
    }

    $manager = get_colony_leader($db, $colonyId, 'colony_manager');
    if ($manager) {
        $secs = leader_build_time($secs, (int)$manager['skill_construction']);
    }

    $colonyStmt = $db->prepare('SELECT colony_type FROM colonies WHERE id = ?');
    $colonyStmt->execute([$colonyId]);
    $colonyRow = $colonyStmt->fetch(PDO::FETCH_ASSOC);
    if ($colonyRow && ($colonyRow['colony_type'] ?? '') === 'industrial') {
        $secs = max(1, (int)round($secs * 0.9));
    }

    return max(1, $secs);
}

function start_next_ship_build_queue(PDO $db, int $colonyId): ?array {
    ensure_ship_build_queue_table($db);

    $runningStmt = $db->prepare(
        'SELECT id FROM ship_build_queue WHERE colony_id = ? AND status = \'running\' ORDER BY id ASC LIMIT 1'
    );
    $runningStmt->execute([$colonyId]);
    if ($runningStmt->fetchColumn()) {
        return null;
    }

    $nextStmt = $db->prepare(
        'SELECT id, ship_type, blueprint_id, quantity, duration_secs
         FROM ship_build_queue
         WHERE colony_id = ? AND status = \'queued\'
         ORDER BY id ASC LIMIT 1'
    );
    $nextStmt->execute([$colonyId]);
    $next = $nextStmt->fetch(PDO::FETCH_ASSOC);
    if (!$next) {
        return null;
    }

    $shipType = (string)($next['ship_type'] ?? '');
    if ($shipType === '' || !ship_exists_runtime($shipType, $db)) {
        $db->prepare('UPDATE ship_build_queue SET status = \'cancelled\' WHERE id = ?')->execute([(int)$next['id']]);
        return start_next_ship_build_queue($db, $colonyId);
    }

    $eta = date('Y-m-d H:i:s', time() + max(1, (int)($next['duration_secs'] ?? 1)));
    $db->prepare(
        'UPDATE ship_build_queue
         SET status = \'running\', started_at = NOW(), eta = ?
         WHERE id = ?'
    )->execute([$eta, (int)$next['id']]);

    return [
        'queue_id' => (int)$next['id'],
        'ship_type' => $shipType,
        'blueprint_id' => isset($next['blueprint_id']) ? (int)$next['blueprint_id'] : null,
        'quantity' => (int)($next['quantity'] ?? 1),
        'duration_secs' => (int)($next['duration_secs'] ?? 1),
        'eta' => $eta,
    ];
}

function ensure_built_vessels_table(PDO $db): void {
    static $ready = false;
    if ($ready) {
        return;
    }
    try {
        $db->exec(
            'CREATE TABLE IF NOT EXISTS built_vessels (
                id             BIGINT AUTO_INCREMENT PRIMARY KEY,
                owner_user_id  INT NOT NULL,
                colony_id      INT NOT NULL,
                blueprint_id   BIGINT NOT NULL,
                name           VARCHAR(100) DEFAULT NULL,
                snapshot_stats_json JSON NOT NULL,
                hp_state_json       JSON NOT NULL,
                status         ENUM(\'docked\',\'assigned\',\'destroyed\') NOT NULL DEFAULT \'docked\',
                created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (colony_id)    REFERENCES colonies(id) ON DELETE CASCADE,
                FOREIGN KEY (blueprint_id) REFERENCES vessel_blueprints(id) ON DELETE CASCADE,
                INDEX idx_bv_colony (colony_id, status),
                INDEX idx_bv_user   (owner_user_id, status)
            ) ENGINE=InnoDB'
        );
        $ready = true;
    } catch (PDOException $e) {
        // vessel_blueprints table not yet present — skip silently
    }
}

function spawn_built_vessels(PDO $db, int $colonyId, int $ownerId, int $blueprintId, int $quantity): void {
    ensure_built_vessels_table($db);

    // fetch snapshot stats from the blueprint
    $stmtBp = $db->prepare(
        'SELECT compiled_stats_json FROM vessel_blueprints WHERE id = ? LIMIT 1'
    );
    $stmtBp->execute([$blueprintId]);
    $statsJson = $stmtBp->fetchColumn();
    if ($statsJson === false) {
        return; // blueprint gone — skip
    }

    $stats    = json_decode($statsJson, true) ?: [];
    $maxHp    = max(1, (int)($stats['hull'] ?? $stats['hp'] ?? 100));
    $hpState  = json_encode(['hp' => $maxHp, 'max_hp' => $maxHp], JSON_THROW_ON_ERROR);

    $insStmt = $db->prepare(
        'INSERT INTO built_vessels
            (owner_user_id, colony_id, blueprint_id, snapshot_stats_json, hp_state_json, status)
         VALUES (?, ?, ?, ?, ?, \'docked\')'
    );
    for ($i = 0; $i < $quantity; $i++) {
        $insStmt->execute([$ownerId, $colonyId, $blueprintId, $statsJson, $hpState]);
    }
}

function complete_ship_build_queue(PDO $db, int $colonyId): void {
    ensure_ship_build_queue_table($db);

    $dueStmt = $db->prepare(
        'SELECT id, ship_type, blueprint_id, quantity
         FROM ship_build_queue
         WHERE colony_id = ? AND status = \'running\' AND eta IS NOT NULL AND eta <= NOW()
         ORDER BY id ASC'
    );
    $dueStmt->execute([$colonyId]);
    $dueRows = $dueStmt->fetchAll(PDO::FETCH_ASSOC);

    // fetch colony owner once (needed for built_vessels)
    $ownerId = 0;
    if ($dueRows) {
        $ownerStmt = $db->prepare('SELECT user_id FROM colonies WHERE id = ? LIMIT 1');
        $ownerStmt->execute([$colonyId]);
        $ownerId = (int)$ownerStmt->fetchColumn();
    }

    foreach ($dueRows as $row) {
        $shipType    = (string)($row['ship_type'] ?? '');
        $blueprintId = isset($row['blueprint_id']) && $row['blueprint_id'] !== null
            ? (int)$row['blueprint_id'] : null;
        $quantity    = max(1, (int)($row['quantity'] ?? 1));

        if ($shipType !== '' && ship_exists_runtime($shipType, $db)) {
            // legacy aggregated counter (kept for fleet compatibility)
            $db->prepare(
                'INSERT INTO ships (colony_id, type, count) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
            )->execute([$colonyId, $shipType, $quantity]);

            // individual vessel records for blueprint builds
            if ($blueprintId !== null && $ownerId > 0) {
                try {
                    spawn_built_vessels($db, $colonyId, $ownerId, $blueprintId, $quantity);
                } catch (Throwable $e) {
                    // non-fatal: built_vessels table might not exist yet
                }
            }

            $db->prepare('UPDATE ship_build_queue SET status = \'done\' WHERE id = ?')
                ->execute([(int)$row['id']]);
        } else {
            $db->prepare('UPDATE ship_build_queue SET status = \'cancelled\' WHERE id = ?')
                ->execute([(int)$row['id']]);
        }
    }

    if ($dueRows) {
        if (function_exists('gq_cache_delete') && $ownerId > 0) {
            gq_cache_delete('shipyard_list', ['uid' => $ownerId, 'cid' => $colonyId]);
        }
    }

    start_next_ship_build_queue($db, $colonyId);
}

function ship_build_queue_has_pending(PDO $db, int $colonyId): bool {
    ensure_ship_build_queue_table($db);
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM ship_build_queue WHERE colony_id = ? AND status IN (\'queued\', \'running\')'
    );
    $stmt->execute([$colonyId]);
    return ((int)$stmt->fetchColumn()) > 0;
}

function list_ship_build_queue(PDO $db, int $colonyId): array {
    ensure_ship_build_queue_table($db);

    $stmt = $db->prepare(
        'SELECT id, ship_type, blueprint_id, quantity, cost_metal, cost_crystal, cost_deuterium,
                duration_secs, queued_at, started_at, eta, status
         FROM ship_build_queue
         WHERE colony_id = ? AND status IN (\'queued\', \'running\')
         ORDER BY id ASC'
    );
    $stmt->execute([$colonyId]);

    $queue = [];
    $position = 0;
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $position++;
        $shipType = (string)($row['ship_type'] ?? '');
        $definition = $shipType !== '' ? ship_runtime_definition($shipType, $db) : null;
        $queue[] = [
            'id' => (int)$row['id'],
            'ship_type' => $shipType,
            'blueprint_id' => isset($row['blueprint_id']) && $row['blueprint_id'] !== null ? (int)$row['blueprint_id'] : null,
            'label' => is_array($definition) ? (string)($definition['label'] ?? $shipType) : $shipType,
            'quantity' => (int)($row['quantity'] ?? 1),
            'cost' => [
                'metal' => (int)($row['cost_metal'] ?? 0),
                'crystal' => (int)($row['cost_crystal'] ?? 0),
                'deuterium' => (int)($row['cost_deuterium'] ?? 0),
            ],
            'duration_secs' => (int)($row['duration_secs'] ?? 0),
            'queued_at' => $row['queued_at'] ?? null,
            'started_at' => $row['started_at'] ?? null,
            'eta' => $row['eta'] ?? null,
            'status' => (string)($row['status'] ?? 'queued'),
            'position' => $position,
        ];
    }

    return $queue;
}

function summarize_ship_build_queue(array $queue): array {
    $summary = [];
    foreach ($queue as $entry) {
        $shipType = (string)($entry['ship_type'] ?? '');
        if ($shipType === '') {
            continue;
        }
        if (!isset($summary[$shipType])) {
            $summary[$shipType] = [
                'queued_count' => 0,
                'running_count' => 0,
                'active_eta' => null,
                'active_position' => null,
            ];
        }
        $qty = max(1, (int)($entry['quantity'] ?? 1));
        if (($entry['status'] ?? '') === 'running') {
            $summary[$shipType]['running_count'] += $qty;
            $summary[$shipType]['active_eta'] = $entry['eta'] ?? null;
            $summary[$shipType]['active_position'] = (int)($entry['position'] ?? 1);
        } else {
            $summary[$shipType]['queued_count'] += $qty;
            if ($summary[$shipType]['active_position'] === null) {
                $summary[$shipType]['active_position'] = (int)($entry['position'] ?? 1);
            }
        }
    }

    return $summary;
}