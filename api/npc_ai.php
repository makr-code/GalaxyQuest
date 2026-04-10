<?php
/**
 * NPC AI tick – called from game.php overview action.
 * Handles: trade offer generation, pirate raids, diplomacy time-decay.
 * All operations are fast (< 50 ms) and idempotent for repeated calls.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/npc_llm_controller.php';
require_once __DIR__ . '/character_profile_generator.php';
require_once __DIR__ . '/../lib/MiniYamlParser.php';
require_once __DIR__ . '/llm_soc/ScenarioEngine.php';

/**
 * Run the NPC AI tick for a specific user.
 * Safe to call on every overview load (rate-limited internally via DB timestamps).
 */
function npc_ai_tick(PDO $db, int $userId, bool $force = false): void {
    // Only run once per 5 minutes per user (stored in user meta as last_npc_tick)
    $uRow = $db->prepare('SELECT last_npc_tick FROM users WHERE id=?');
    $uRow->execute([$userId]);
    $u = $uRow->fetch();
    // If column doesn't exist yet (pre-migration), skip silently
    if (!$u || !array_key_exists('last_npc_tick', $u)) return;

    $lastTick = $u['last_npc_tick'] ? strtotime($u['last_npc_tick']) : 0;
    if (!$force && (time() - $lastTick < 300)) return; // 5-minute cooldown

    $db->prepare('UPDATE users SET last_npc_tick=NOW() WHERE id=?')->execute([$userId]);

    $factions = $db->query('SELECT * FROM npc_factions')->fetchAll();
    foreach ($factions as $faction) {
        npc_faction_tick($db, $userId, $faction);
    }

    // Slight diplomacy time-decay toward faction's base (±1 point per tick, max once per hour)
    $db->prepare(
        'UPDATE diplomacy d
         JOIN npc_factions f ON f.id = d.faction_id
         SET d.standing = d.standing + SIGN(f.base_diplomacy - d.standing)
         WHERE d.user_id = ? AND ABS(d.standing - f.base_diplomacy) > 5'
    )->execute([$userId]);

    // Global NPC player accounts tick (build/research/ships).
    // Triggered opportunistically by active player traffic, rate-limited via app_state.
    try {
        npc_player_accounts_tick_global($db, $force);
    } catch (Throwable $e) {
        error_log('npc_player_accounts_tick_global error: ' . $e->getMessage());
    }

    // Dynamic faction events (galactic war, trade boom, pirate surge).
    try {
        faction_events_tick_global($db);
    } catch (Throwable $e) {
        error_log('faction_events_tick_global error: ' . $e->getMessage());
    }

    // REDCS: Random-Event-Driven-Conclusion System scenario tick.
    try {
        $scenariosDir = realpath(__DIR__ . '/../scenarios') ?: (__DIR__ . '/../scenarios');
        ScenarioEngine::tick($db, $scenariosDir);
    } catch (Throwable $e) {
        error_log('ScenarioEngine::tick error: ' . $e->getMessage());
    }

    // Planetary random events (solar flare, mineral vein, disease).
    try {
        colony_events_tick_global($db);
    } catch (Throwable $e) {
        error_log('colony_events_tick_global error: ' . $e->getMessage());
    }

    // Wormhole network maintenance (stability regeneration + cooldown clear).
    try {
        wormhole_regeneration_tick_global($db);
    } catch (Throwable $e) {
        error_log('wormhole_regeneration_tick_global error: ' . $e->getMessage());
    }

    // NPC Trader lifecycle: route transitions, supply/demand recalc, new opportunities.
    try {
        trader_tick_global($db);
    } catch (Throwable $e) {
        error_log('trader_tick_global error: ' . $e->getMessage());
    }
}

/**
 * Run the NPC trader economy tick globally.
 * Cooldown: 15 minutes, stored in app_state as 'trader_tick:last_unix'.
 * Safe to skip if tables are not yet created (pre-migration).
 */
function trader_tick_global(PDO $db, bool $force = false): void {
    $now = time();
    $stateKey = 'trader_tick:last_unix';
    $cooldown = 900; // 15 minutes

    if (function_exists('app_state_get_int') && function_exists('app_state_set_int')) {
        $last = app_state_get_int($db, $stateKey, 0);
        if (!$force && ($now - $last) < $cooldown) {
            return;
        }
        app_state_set_int($db, $stateKey, $now);
    }

    // Guard: tables might not exist on pre-migration DBs
    try {
        $db->query('SELECT 1 FROM npc_traders LIMIT 1');
    } catch (Throwable $e) {
        return; // Migration not applied yet
    }

    if (!defined('TRADERS_LIB_MODE')) {
        define('TRADERS_LIB_MODE', true);
    }
    require_once __DIR__ . '/traders.php';
    require_once __DIR__ . '/market_analysis.php';

    // 1. Refresh supply/demand
    update_supply_demand_table($db);

    // 2. Discover / refresh trade opportunities (5% min margin for autonomous tick)
    find_and_rank_trade_opportunities($db, 5.0);

    // 3. Advance all active routes through lifecycle
    process_route_transitions($db);

    // 4. Let traders decide new routes
    execute_trader_decisions($db);
}

function npc_faction_tick(PDO $db, int $userId, array $faction): void {
    $fid = (int)$faction['id'];

    // Optional LLM steering path for PvE controller.
    $llm = npc_pve_llm_controller_try($db, $userId, $faction);
    if (!empty($llm['handled'])) {
        return;
    }

    // ── Generate trade offers if none active ─────────────────────────────
    if ((int)$faction['trade_willingness'] >= 30) {
        $existing = $db->prepare(
            'SELECT COUNT(*) FROM trade_offers
             WHERE faction_id=? AND active=1 AND valid_until > NOW()'
        );
        $existing->execute([$fid]);
        if ((int)$existing->fetchColumn() < 2) {
            generate_trade_offer($db, $faction);
        }
    }

    // ── Pirate raids on low-protection players ────────────────────────────
    if ($faction['faction_type'] === 'pirate' && (int)$faction['aggression'] >= 70) {
        $standing = get_faction_standing($db, $userId, $fid);
        if ($standing < -20) {
            maybe_pirate_raid($db, $userId, $faction);
        }
    }

    // ── Empire diplomatic pressure ────────────────────────────────────────
    if ($faction['faction_type'] === 'military') {
        $standing = get_faction_standing($db, $userId, $fid);
        // If player has no colonies above galaxy 3, ignore
        // (simplified: just drift standing)
    }

    // ── PHASE 2.4: NPC War declaration & counter-alliance reactions ────────
    npc_check_war_reaction($db, $userId, $faction);
}

/**
 * PHASE 2.4 — Evaluate whether an NPC faction should declare war or join a
 * counter-alliance based on the player's recent aggression / active wars.
 *
 * Triggers:
 *  - military factions with standing < -30 check if they should declare war
 *  - if player has ≥ 3 recent pirate raids, allied factions band together
 */
function npc_check_war_reaction(PDO $db, int $userId, array $faction): void {
    // Rate-limit: factions only re-evaluate once per hour
    $coolKey = "npc_war_reaction_{$userId}_{$faction['id']}";
    $coolStmt = $db->prepare(
        "SELECT state_value FROM app_state WHERE state_key = ? AND updated_at > DATE_SUB(NOW(), INTERVAL 60 MINUTE)"
    );
    $coolStmt->execute([$coolKey]);
    if ($coolStmt->fetchColumn() !== false) return;

    $factionType = $faction['faction_type'];
    $aggression  = (int)$faction['aggression'];
    $fid         = (int)$faction['id'];
    $standing    = get_faction_standing($db, $userId, $fid);

    // ── 1. Military factions declaring war on hostile players ─────────────
    if ($factionType === 'military' && $standing < -30 && $aggression >= 50) {
        $activeWar = $db->prepare(
            'SELECT id FROM wars WHERE defender_user_id = ? AND npc_aggressor_faction_id = ? AND status = ? LIMIT 1'
        );
        $activeWar->execute([$userId, $fid, 'active']);
        $hasWar = $activeWar->fetchColumn();

        if (!$hasWar) {
            npc_declare_war_against_user($db, $userId, $faction);
        }
    }

    // ── 2. Counter-alliance: if player raided ≥ 3 times in 24h, allied NPCs unite ──
    $hasPirateHistory = $db->query("SHOW TABLES LIKE 'pirate_raid_history'")->fetchColumn();
    if ($hasPirateHistory) {
        $raidCount = $db->prepare(
            'SELECT COUNT(*) FROM pirate_raid_history
             WHERE colony_id IN (SELECT id FROM colonies WHERE user_id = ?)
               AND raid_date >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
             AND raid_success = 1'
        );
        $raidCount->execute([$userId]);
        $raids = (int)$raidCount->fetchColumn();

        if ($raids >= 3 && $factionType === 'military' && $aggression >= 40 && $standing < 0) {
            // Form a visible alliance event via message; add minor standing penalty
            $db->prepare(
                'INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)'
            )->execute([
                $userId,
                "Counter-Alliance Warning: {$faction['name']}",
                "[{$faction['icon']} {$faction['name']}] Due to the escalating raider crisis in this sector, "
                . "our faction has entered a joint defence pact with neighbouring powers. "
                . "Further aggression will be met with combined force.",
            ]);
            require_once __DIR__ . '/factions.php';
            update_standing($db, $userId, $fid, -5, 'counter_alliance', 'Counter-alliance formed due to raid escalation');
        }
    }

    // Mark cooldown
    $db->prepare(
        'INSERT INTO app_state (state_key, state_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE state_value=VALUES(state_value), updated_at=NOW()'
    )->execute([$coolKey, '1']);
}

/**
 * Declare war on behalf of an NPC faction against a player.
 * Inserts a war record and sends a declaration message.
 */
function npc_declare_war_against_user(PDO $db, int $userId, array $faction): void {
    $hasWars = $db->query("SHOW TABLES LIKE 'wars'")->fetchColumn();
    if (!$hasWars) return;

    // Insert war record: NPC faction is aggressor, player is defender.
    // attacker_user_id = NULL  (no player entity for the NPC faction),
    // npc_aggressor_faction_id stores the faction reference.
    $warStmt = $db->prepare(
        'INSERT INTO wars
         (attacker_user_id, defender_user_id, npc_aggressor_faction_id, status, casus_belli)
         VALUES (NULL, ?, ?, \'active\', \'subjugation\')'
    );
    $warStmt->execute([
        $userId,
        (int)$faction['id'],
    ]);
    $warId = (int)$db->lastInsertId();

    // Notify the player
    $db->prepare(
        'INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)'
    )->execute([
        $userId,
        "War Declared: {$faction['name']}",
        "[{$faction['icon']} {$faction['name']}] Our patience is exhausted. "
        . "Your hostility has crossed the line. As of this moment, a state of war exists between "
        . "our faction and your empire. Expect retaliation. (War #$warId)",
    ]);

    require_once __DIR__ . '/factions.php';
    update_standing($db, $userId, (int)$faction['id'], -15, 'war_declaration', 'NPC faction declared war');
}

function get_faction_standing(PDO $db, int $userId, int $factionId): int {
    $stmt = $db->prepare('SELECT standing FROM diplomacy WHERE user_id=? AND faction_id=?');
    $stmt->execute([$userId, $factionId]);
    $row = $stmt->fetch();
    if ($row) return (int)$row['standing'];
    $base = $db->prepare('SELECT base_diplomacy FROM npc_factions WHERE id=?');
    $base->execute([$factionId]);
    $b = $base->fetch();
    return $b ? (int)$b['base_diplomacy'] : 0;
}

/**
 * Generate a new trade offer for a faction.
 * Offers are randomised but faction-type-appropriate.
 */
function generate_trade_offer(PDO $db, array $faction): void {
    static $pairs = [
        // [offer_resource, request_resource, ratio_offer_per_request]
        ['metal',      'crystal',    2.0],
        ['crystal',    'deuterium',  1.5],
        ['deuterium',  'metal',      0.5],
        ['rare_earth', 'metal',      20.0],
        ['food',       'crystal',    1.0],
        ['metal',      'rare_earth', 0.05],
    ];

    // Faction-specific preference
    $preferredPairs = match ($faction['faction_type']) {
        'trade'   => [0, 1, 2, 3],
        'science' => [3, 5],
        'pirate'  => [0, 2],
        'military'=> [1, 2],
        default   => [0, 1, 2],
    };

    $idx  = $preferredPairs[array_rand($preferredPairs)];
    [$offerRes, $reqRes, $ratio] = $pairs[$idx];

    $baseAmt   = 2000 + (int)($faction['power_level'] / 10);
    $offerAmt  = (int)($baseAmt * $ratio);
    $reqAmt    = $baseAmt;
    $minStand  = match ($faction['faction_type']) {
        'pirate' => -80, 'military' => -20, default => -50,
    };

    $db->prepare(
        'INSERT INTO trade_offers
         (faction_id, offer_resource, offer_amount, request_resource, request_amount,
          min_standing, max_claims, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))'
    )->execute([
        $faction['id'], $offerRes, $offerAmt,
        $reqRes, $reqAmt, $minStand, 5,
    ]);
}

/**
 * Pirate raid: send an in-game message warning of an attack (simulated).
 * Does not create a real fleet — just an immediate small resource drain + message.
 */
function maybe_pirate_raid(PDO $db, int $userId, array $faction): void {
    // Only raid if user has at least one colony and not under newbie protection
    $protect = $db->prepare('SELECT protection_until FROM users WHERE id=?');
    $protect->execute([$userId]);
    $u = $protect->fetch();
    if ($u && $u['protection_until'] && strtotime($u['protection_until']) > time()) return;

    // Pick a random non-homeworld colony
    $col = $db->prepare(
        'SELECT id, metal, crystal, deuterium, population FROM colonies
         WHERE user_id=? AND is_homeworld=0 ORDER BY RAND() LIMIT 1'
    );
    $col->execute([$userId]);
    $target = $col->fetch();
    if (!$target) return;

    $colId = (int)$target['id'];
    $fid   = (int)$faction['id'];

    // ── Countermeasure effectiveness check ────────────────────────────────
    $cmStmt = $db->prepare(
        'SELECT COALESCE(MAX(effectiveness), 0) AS max_eff
         FROM raid_countermeasures
         WHERE colony_id = ?
           AND (pirate_faction_id IS NULL OR pirate_faction_id = ?)
           AND expires_at > NOW()'
    );
    $cmStmt->execute([$colId, $fid]);
    $cmRow = $cmStmt->fetch(PDO::FETCH_ASSOC);
    $countermeasureEff = (float)($cmRow['max_eff'] ?? 0); // 0–100

    // Defense infrastructure bonus
    $infraStmt = $db->prepare(
        'SELECT COALESCE(SUM(effectiveness * ((100 - damage_current) / 100.0)), 0) AS infra_eff
         FROM colony_defense_infrastructure
         WHERE colony_id = ?'
    );
    $infraStmt->execute([$colId]);
    $infraRow = $infraStmt->fetch(PDO::FETCH_ASSOC);
    $infraEff = (float)($infraRow['infra_eff'] ?? 0);

    // Combined effectiveness caps at 95% block chance
    $blockChance = min(95.0, $countermeasureEff + $infraEff * 0.5);

    // Random roll — if blocked, log a failed raid and exit
    if ($blockChance > 0 && (mt_rand(0, 99) < (int)$blockChance)) {
        $tableExists = $db->query("SHOW TABLES LIKE 'pirate_raid_history'")->fetchColumn();
        if ($tableExists) {
            $db->prepare(
                'INSERT INTO pirate_raid_history
                 (colony_id, pirate_faction_id, raid_intensity, defense_level, raid_success, goods_stolen, casualties, damage_percent)
                 VALUES (?, ?, ?, ?, 0, 0, 0, 0)'
            )->execute([$colId, $fid, (int)$faction['aggression'], (int)$blockChance]);
        }
        return; // Raid successfully blocked
    }

    // ── Calculate loot (reduced by partial defense effectiveness) ─────────
    $lootReduction = max(0.0, 1.0 - ($blockChance / 100.0));
    $stealM = (int)min((float)$target['metal']    * 0.05 * $lootReduction, 500);
    $stealC = (int)min((float)$target['crystal']  * 0.05 * $lootReduction, 300);
    $stealD = (int)min((float)$target['deuterium'] * 0.03 * $lootReduction, 100);

    if ($stealM > 0 || $stealC > 0 || $stealD > 0) {
        $db->prepare('UPDATE colonies SET metal=GREATEST(0,metal-?), crystal=GREATEST(0,crystal-?), deuterium=GREATEST(0,deuterium-?) WHERE id=?')
           ->execute([$stealM, $stealC, $stealD, $colId]);

        $goodsTotal = $stealM + $stealC + $stealD;
        $lootDesc = implode(', ', array_filter([
            $stealM > 0 ? "{$stealM} metal"      : null,
            $stealC > 0 ? "{$stealC} crystal"    : null,
            $stealD > 0 ? "{$stealD} deuterium"  : null,
        ]));

        $msg = "[{$faction['icon']} {$faction['name']}] A pirate raid struck your colony! "
             . "Lost: {$lootDesc}. "
             . "Improve your diplomatic standing or build defences to deter future raids.";
        $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)')
           ->execute([$userId, 'Pirate Raid!', $msg]);

        // ── Log to pirate_raid_history ─────────────────────────────────────
        $tableExists = $db->query("SHOW TABLES LIKE 'pirate_raid_history'")->fetchColumn();
        if ($tableExists) {
            $db->prepare(
                'INSERT INTO pirate_raid_history
                 (colony_id, pirate_faction_id, raid_intensity, defense_level, raid_success, goods_stolen, casualties, damage_percent)
                 VALUES (?, ?, ?, ?, 1, ?, 0, 0.00)'
            )->execute([$colId, $fid, (int)$faction['aggression'], (int)$blockChance, $goodsTotal]);
        }

        // Reduce standing slightly
        require_once __DIR__ . '/factions.php';
        update_standing($db, $userId, $fid, -3, 'raid', 'Pirate raid on colony');
    }
}

// ─── NPC player accounts (Phase 4.1) ────────────────────────────────────────

/**
 * Run strategic AI for all NPC player accounts.
 * Cooldown defaults to 3 minutes and is stored in app_state.
 */
function npc_player_accounts_tick_global(PDO $db, bool $force = false): void {
    $now = time();
    $stateKey = 'npc_player_tick:last_unix';
    $cooldown = 180;

    if (function_exists('app_state_get_int') && function_exists('app_state_set_int')) {
        $last = app_state_get_int($db, $stateKey, 0);
        if (!$force && ($now - $last) < $cooldown) {
            return;
        }
        app_state_set_int($db, $stateKey, $now);
    }

    $stmt = $db->query("SELECT id FROM users WHERE control_type = 'npc_engine' ORDER BY id ASC LIMIT 64");
    $npcIds = $stmt ? $stmt->fetchAll(PDO::FETCH_COLUMN) : [];
    foreach ($npcIds as $npcIdRaw) {
        $npcId = (int)$npcIdRaw;
        if ($npcId <= 0) {
            continue;
        }
        npc_player_account_tick($db, $npcId);
    }
}

/**
 * Single NPC account tick: one build action, one research action, one ship action.
 */
function npc_player_account_tick(PDO $db, int $npcUserId): void {
    try {
        ensure_user_character_profile($db, $npcUserId, true);
    } catch (Throwable $e) {
        error_log('npc character profile generation failed for user ' . $npcUserId . ': ' . $e->getMessage());
    }

    // OD-3: Assign faction-specific FTL drive if still on default 'aereth'
    npc_assign_ftl_drive($db, $npcUserId);

    // Finish due research first so progression can continue.
    $due = $db->prepare(
        'SELECT type FROM research
         WHERE user_id = ? AND research_end IS NOT NULL AND research_end <= NOW()'
    );
    $due->execute([$npcUserId]);
    foreach ($due->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $type = (string)($row['type'] ?? '');
        if ($type === '') {
            continue;
        }
        $db->prepare(
            'UPDATE research SET level = level + 1, research_end = NULL WHERE user_id = ? AND type = ?'
        )->execute([$npcUserId, $type]);
    }

    $colStmt = $db->prepare(
        'SELECT id, colony_type, metal, crystal, deuterium
         FROM colonies WHERE user_id = ?
         ORDER BY is_homeworld DESC, (metal + crystal + deuterium) DESC LIMIT 1'
    );
    $colStmt->execute([$npcUserId]);
    $colony = $colStmt->fetch(PDO::FETCH_ASSOC);
    if (!$colony) {
        return;
    }

    $colonyId = (int)$colony['id'];
    update_colony_resources($db, $colonyId);

    // Refresh resource snapshot after resource tick.
    $snapStmt = $db->prepare('SELECT metal, crystal, deuterium, colony_type FROM colonies WHERE id = ?');
    $snapStmt->execute([$colonyId]);
    $snap = $snapStmt->fetch(PDO::FETCH_ASSOC);
    if (!$snap) {
        return;
    }

    $resources = [
        'metal' => (float)$snap['metal'],
        'crystal' => (float)$snap['crystal'],
        'deuterium' => (float)$snap['deuterium'],
    ];
    $colonyType = (string)($snap['colony_type'] ?? 'balanced');

    npc_try_building_upgrade($db, $colonyId, $colonyType, $resources);
    npc_try_start_research($db, $npcUserId, $colonyId, $colonyType, $resources);
    npc_try_build_ships($db, $colonyId, $colonyType, $resources);
    npc_try_fleet_actions($db, $npcUserId, $colonyType);
}

function npc_try_building_upgrade(PDO $db, int $colonyId, string $colonyType, array &$resources): void {
    $priorityByType = [
        'mining' => ['metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant', 'robotics_factory', 'shipyard', 'research_lab'],
        'research' => ['research_lab', 'crystal_mine', 'solar_plant', 'metal_mine', 'deuterium_synth', 'robotics_factory', 'shipyard'],
        'military' => ['shipyard', 'metal_mine', 'crystal_mine', 'solar_plant', 'robotics_factory', 'research_lab', 'deuterium_synth'],
        'industrial' => ['metal_mine', 'robotics_factory', 'shipyard', 'crystal_mine', 'solar_plant', 'deuterium_synth', 'research_lab'],
        'agricultural' => ['hydroponic_farm', 'food_silo', 'metal_mine', 'crystal_mine', 'solar_plant', 'deuterium_synth', 'research_lab'],
        'balanced' => ['metal_mine', 'crystal_mine', 'solar_plant', 'deuterium_synth', 'research_lab', 'shipyard', 'robotics_factory'],
    ];
    $caps = [
        'metal_mine' => 18,
        'crystal_mine' => 16,
        'deuterium_synth' => 14,
        'solar_plant' => 16,
        'fusion_reactor' => 8,
        'robotics_factory' => 8,
        'shipyard' => 8,
        'research_lab' => 10,
        'hydroponic_farm' => 10,
        'food_silo' => 8,
    ];
    $order = $priorityByType[$colonyType] ?? $priorityByType['balanced'];

    $bStmt = $db->prepare('SELECT type, level FROM buildings WHERE colony_id = ?');
    $bStmt->execute([$colonyId]);
    $levels = [];
    foreach ($bStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $levels[(string)$row['type']] = (int)$row['level'];
    }

    foreach ($order as $type) {
        $current = (int)($levels[$type] ?? 0);
        $cap = (int)($caps[$type] ?? 10);
        if ($current >= $cap) {
            continue;
        }
        $cost = building_cost($type, $current + 1);
        if (!npc_can_afford($resources, $cost)) {
            continue;
        }
        npc_spend_colony_resources($db, $colonyId, $resources, $cost);

        if ($current > 0) {
            $db->prepare('UPDATE buildings SET level = level + 1, upgrade_end = NULL WHERE colony_id = ? AND type = ?')
               ->execute([$colonyId, $type]);
        } else {
            $db->prepare('INSERT INTO buildings (colony_id, type, level, upgrade_end) VALUES (?, ?, 1, NULL)')
               ->execute([$colonyId, $type]);
        }
        break;
    }
}

function npc_try_start_research(PDO $db, int $npcUserId, int $colonyId, string $colonyType, array &$resources): void {
    $runningStmt = $db->prepare('SELECT COUNT(*) FROM research WHERE user_id = ? AND research_end IS NOT NULL');
    $runningStmt->execute([$npcUserId]);
    if ((int)$runningStmt->fetchColumn() > 0) {
        return;
    }

    $researchOrder = [
        'energy_tech',
        'computer_tech',
        'combustion_drive',
        'weapons_tech',
        'espionage_tech',
        'laser_tech',
        'impulse_drive',
        'shielding_tech',
        'armor_tech',
        'hyperspace_tech',
        'nano_materials',
        'genetic_engineering',
        'quantum_computing',
        'terraforming_tech',
        'dark_energy_tap',
        'wormhole_theory',
        'stealth_tech',
    ];
    if ($colonyType === 'research') {
        $researchOrder = [
            'energy_tech', 'computer_tech', 'espionage_tech', 'laser_tech', 'ion_tech',
            'impulse_drive', 'hyperspace_tech', 'astrophysics', 'weapons_tech', 'shielding_tech',
        ];
    }

    $rStmt = $db->prepare('SELECT type, level FROM research WHERE user_id = ?');
    $rStmt->execute([$npcUserId]);
    $levels = [];
    foreach ($rStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $levels[(string)$row['type']] = (int)$row['level'];
    }

    $labLevel = get_building_level($db, $colonyId, 'research_lab');
    if ($labLevel <= 0) {
        return;
    }

    foreach ($researchOrder as $tech) {
        $current = (int)($levels[$tech] ?? 0);
        if ($current >= 10) {
            continue;
        }
        $pr = check_research_prereqs($db, $npcUserId, $tech);
        if (empty($pr['can_research'])) {
            continue;
        }
        $next = $current + 1;
        $cost = research_cost($tech, $next);
        if (!npc_can_afford($resources, $cost)) {
            continue;
        }

        $secs = research_time($cost, $labLevel);
        if ($colonyType === 'research') {
            $secs = max(1, (int)round($secs * 0.85));
        }
        $end = date('Y-m-d H:i:s', time() + $secs);

        npc_spend_colony_resources($db, $colonyId, $resources, $cost);

        if ($current > 0) {
            $db->prepare('UPDATE research SET research_start = NOW(), research_end = ? WHERE user_id = ? AND type = ?')
               ->execute([$end, $npcUserId, $tech]);
        } else {
            $db->prepare(
                'INSERT INTO research (user_id, type, level, research_start, research_end)
                 VALUES (?, ?, 0, NOW(), ?)
                 ON DUPLICATE KEY UPDATE research_start = NOW(), research_end = VALUES(research_end)'
            )->execute([$npcUserId, $tech, $end]);
        }
        break;
    }
}

function npc_try_build_ships(PDO $db, int $colonyId, string $colonyType, array &$resources): void {
    $shipyardLevel = get_building_level($db, $colonyId, 'shipyard');
    if ($shipyardLevel <= 0) {
        return;
    }

    $shipOrder = ['small_cargo', 'light_fighter', 'heavy_fighter'];
    if ($colonyType === 'military') {
        $shipOrder = ['light_fighter', 'heavy_fighter', 'cruiser', 'small_cargo'];
    } elseif ($colonyType === 'industrial' || $colonyType === 'mining') {
        $shipOrder = ['small_cargo', 'large_cargo', 'light_fighter'];
    }

    foreach ($shipOrder as $type) {
        $per = ship_cost($type);
        if (!npc_can_afford($resources, $per)) {
            continue;
        }

        $qty = 1;
        if ($type === 'small_cargo' || $type === 'light_fighter') {
            $maxByMetal = (int)floor(max(0, $resources['metal']) / max(1, (int)$per['metal']));
            $maxByCrystal = (int)floor(max(0, $resources['crystal']) / max(1, (int)$per['crystal']));
            $maxByDeut = (int)floor(max(0, $resources['deuterium']) / max(1, (int)$per['deuterium']));
            $qty = max(1, min(5, $maxByMetal, $maxByCrystal, $maxByDeut));
        }

        $total = [
            'metal' => (int)$per['metal'] * $qty,
            'crystal' => (int)$per['crystal'] * $qty,
            'deuterium' => (int)$per['deuterium'] * $qty,
        ];
        if (!npc_can_afford($resources, $total)) {
            continue;
        }

        npc_spend_colony_resources($db, $colonyId, $resources, $total);
        $db->prepare(
            'INSERT INTO ships (colony_id, type, count)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE count = count + VALUES(count)'
        )->execute([$colonyId, $type, $qty]);
        break;
    }
}

function npc_try_fleet_actions(PDO $db, int $npcUserId, string $colonyType): void {
    $fleetCountStmt = $db->prepare('SELECT COUNT(*) FROM fleets WHERE user_id = ?');
    $fleetCountStmt->execute([$npcUserId]);
    if ((int)$fleetCountStmt->fetchColumn() >= 2) {
        return;
    }

    $gate = ($colonyType === 'military') ? 55 : 35;
    if (mt_rand(1, 100) > $gate) {
        return;
    }

    if (npc_try_launch_colonization_mission($db, $npcUserId)) {
        return;
    }
    npc_try_balance_transport_mission($db, $npcUserId);
}

function npc_try_launch_colonization_mission(PDO $db, int $npcUserId): bool {
    $countStmt = $db->prepare('SELECT COUNT(*) FROM colonies WHERE user_id = ?');
    $countStmt->execute([$npcUserId]);
    $colonyCount = (int)$countStmt->fetchColumn();
    if ($colonyCount >= 5) {
        return false;
    }

    $originStmt = $db->prepare(
        'SELECT c.id, cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         JOIN ships s ON s.colony_id = c.id AND s.type = "colony_ship" AND s.count > 0
         WHERE c.user_id = ?
         ORDER BY c.is_homeworld DESC, s.count DESC, c.id ASC
         LIMIT 1'
    );
    $originStmt->execute([$npcUserId]);
    $origin = $originStmt->fetch(PDO::FETCH_ASSOC);
    if (!$origin) {
        return false;
    }

    $g = (int)$origin['galaxy'];
    $s = (int)$origin['system'];
    $nearStmt = $db->prepare(
                'SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
                 FROM celestial_bodies cb
                 LEFT JOIN colonies c ON c.body_id = cb.id
         WHERE c.id IS NULL
                     AND cb.body_type = "planet"
                     AND cb.can_colonize = 1
                     AND cb.galaxy_index = ?
                     AND cb.system_index BETWEEN ? AND ?
                 ORDER BY ABS(cb.system_index - ?) ASC, RAND()
         LIMIT 1'
    );
    $nearStmt->execute([$g, max(1, $s - 8), min(galaxy_system_limit(), $s + 8), $s]);
    $target = $nearStmt->fetch(PDO::FETCH_ASSOC);

    if (!$target) {
        $fallbackStmt = $db->prepare(
                        'SELECT cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
                         FROM celestial_bodies cb
                         LEFT JOIN colonies c ON c.body_id = cb.id
                         WHERE c.id IS NULL
                             AND cb.body_type = "planet"
                             AND cb.can_colonize = 1
                             AND cb.galaxy_index = ?
             ORDER BY RAND()
             LIMIT 1'
        );
        $fallbackStmt->execute([$g]);
        $target = $fallbackStmt->fetch(PDO::FETCH_ASSOC);
    }
    if (!$target) {
        return false;
    }

    return npc_launch_fleet(
        $db,
        $npcUserId,
        (int)$origin['id'],
        (int)$target['galaxy'],
        (int)$target['system'],
        (int)$target['position'],
        'colonize',
        ['colony_ship' => 1],
        ['metal' => 0, 'crystal' => 0, 'deuterium' => 0]
    );
}

function npc_try_balance_transport_mission(PDO $db, int $npcUserId): bool {
    $colsStmt = $db->prepare(
        'SELECT c.id, c.metal, c.crystal, c.deuterium,
            cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.user_id = ?'
    );
    $colsStmt->execute([$npcUserId]);
    $colonies = $colsStmt->fetchAll(PDO::FETCH_ASSOC);
    if (count($colonies) < 2) {
        return false;
    }

    $source = null;
    $target = null;
    $maxTotal = -1.0;
    $minTotal = PHP_FLOAT_MAX;
    foreach ($colonies as $col) {
        $total = (float)$col['metal'] + (float)$col['crystal'] + (float)$col['deuterium'];
        if ($total > $maxTotal) {
            $maxTotal = $total;
            $source = $col;
        }
        if ($total < $minTotal) {
            $minTotal = $total;
            $target = $col;
        }
    }

    if (!$source || !$target || (int)$source['id'] === (int)$target['id']) {
        return false;
    }
    if ($maxTotal < $minTotal * 1.2 + 2000) {
        return false;
    }

    $shipStmt = $db->prepare(
        'SELECT type, count
         FROM ships
         WHERE colony_id = ? AND type IN ("large_cargo", "small_cargo")
         ORDER BY FIELD(type, "large_cargo", "small_cargo")'
    );
    $shipStmt->execute([(int)$source['id']]);
    $ships = $shipStmt->fetchAll(PDO::FETCH_ASSOC);

    $shipType = null;
    $available = 0;
    foreach ($ships as $row) {
        $cnt = (int)$row['count'];
        if ($cnt <= 0) {
            continue;
        }
        $shipType = (string)$row['type'];
        $available = $cnt;
        break;
    }
    if (!$shipType || $available <= 0) {
        return false;
    }

    $sendCount = min(5, $available);
    $capacity = ship_cargo($shipType) * $sendCount;
    if ($capacity <= 0) {
        return false;
    }

    $reserveMetal = 8000.0;
    $reserveCrystal = 5000.0;
    $reserveDeut = 2500.0;
    $availMetal = max(0.0, (float)$source['metal'] - $reserveMetal);
    $availCrystal = max(0.0, (float)$source['crystal'] - $reserveCrystal);
    $availDeut = max(0.0, (float)$source['deuterium'] - $reserveDeut);

    $cargoMetal = min($availMetal, $capacity * 0.5);
    $remaining = max(0.0, $capacity - $cargoMetal);
    $cargoCrystal = min($availCrystal, $remaining * 0.6);
    $remaining = max(0.0, $remaining - $cargoCrystal);
    $cargoDeut = min($availDeut, $remaining);

    if (($cargoMetal + $cargoCrystal + $cargoDeut) < 1000.0) {
        return false;
    }

    return npc_launch_fleet(
        $db,
        $npcUserId,
        (int)$source['id'],
        (int)$target['galaxy'],
        (int)$target['system'],
        (int)$target['position'],
        'transport',
        [$shipType => $sendCount],
        ['metal' => $cargoMetal, 'crystal' => $cargoCrystal, 'deuterium' => $cargoDeut]
    );
}

function npc_launch_fleet(
    PDO $db,
    int $npcUserId,
    int $originColonyId,
    int $targetGalaxy,
    int $targetSystem,
    int $targetPosition,
    string $mission,
    array $ships,
    array $cargo
): bool {
    return launch_fleet_for_user(
        $db, $npcUserId, $originColonyId,
        $targetGalaxy, $targetSystem, $targetPosition,
        $mission, $ships, $cargo
    );
}

// ─── Phase 4.3: Dynamic Faction Events ──────────────────────────────────────

/**
 * Periodically triggers a random galaxy-wide faction event.
 * Cooldown: 30 min. Event duration: 90–180 min. State persisted in app_state.
 *
 * Event types:
 *   galactic_war  – military/pirate factions gain aggression; standing decays faster
 *   trade_boom    – trade factions gain trade_willingness; pirate aggression lowered
 *   pirate_surge  – all pirate factions gain aggression heavily
 */
function faction_events_tick_global(PDO $db): void {
    if (!function_exists('app_state_get_int') || !function_exists('app_state_set_int')) {
        return;
    }

    $now = time();

    // Check if an active event has expired → clear it
    $activeType   = app_state_get_int($db, 'faction_event:active_type', 0);
    $endsAt       = app_state_get_int($db, 'faction_event:ends_at', 0);
    if ($activeType > 0 && $endsAt > 0 && $now >= $endsAt) {
        // Revert temporary faction modifiers
        faction_event_revert($db, $activeType);
        app_state_set_int($db, 'faction_event:active_type', 0);
        app_state_set_int($db, 'faction_event:active_since', 0);
        app_state_set_int($db, 'faction_event:ends_at', 0);
        $activeType = 0;
    }

    // Only one global event at a time
    if ($activeType > 0) {
        return;
    }

    // Cooldown: 30 min since last event ended
    $lastEventEnd = app_state_get_int($db, 'faction_event:last_end_unix', 0);
    if (($now - $lastEventEnd) < 1800) {
        return;
    }

    // 20 % chance per tick to actually fire
    if (mt_rand(1, 100) > 20) {
        return;
    }

    // Pick random event (1=galactic_war 2=trade_boom 3=pirate_surge)
    $eventType = mt_rand(1, 3);

    $durations = [1 => 7200, 2 => 10800, 3 => 5400]; // seconds
    $duration  = $durations[$eventType];
    $endsAt    = $now + $duration;

    // Apply temporary modifiers to npc_factions
    faction_event_apply($db, $eventType);

    app_state_set_int($db, 'faction_event:active_type', $eventType);
    app_state_set_int($db, 'faction_event:active_since', $now);
    app_state_set_int($db, 'faction_event:ends_at', $endsAt);

    // Broadcast to all recently-active players
    $labels = [1 => 'Galactic War', 2 => 'Trade Boom', 3 => 'Pirate Surge'];
    $icons  = [1 => '⚔️', 2 => '📈', 3 => '☠️'];
    $bodies = [
        1 => 'War has broken out across the galaxy. Military and pirate factions are far more aggressive. Watch your borders.',
        2 => 'A wave of interstellar trade is sweeping the galaxy. Trade factions offer better deals and pirates are lying low.',
        3 => 'Pirate clans are surging in numbers and boldness. All colonies face elevated raid risk.',
    ];
    $subject = $icons[$eventType] . ' Galactic Event: ' . $labels[$eventType];
    $body    = $bodies[$eventType] . ' (Active for ' . round($duration / 3600, 1) . 'h)';

    $db->prepare(
        'INSERT INTO messages (receiver_id, subject, body)
         SELECT id, ?, ? FROM users
         WHERE control_type = \'human\' AND auth_enabled = 1
           AND deleted_at IS NULL
           AND last_login > DATE_SUB(NOW(), INTERVAL 7 DAY)'
    )->execute([$subject, $body]);
}

function faction_event_apply(PDO $db, int $eventType): void {
    // Store originals in app_state is complex; instead apply named delta columns.
    // We mark with faction_event_mod so revert can undo by mirroring the delta.
    switch ($eventType) {
        case 1: // galactic_war
            $db->prepare(
                "UPDATE npc_factions SET aggression = LEAST(100, aggression + 25)
                 WHERE faction_type IN ('military','pirate')"
            )->execute();
            break;
        case 2: // trade_boom
            $db->prepare(
                "UPDATE npc_factions SET trade_willingness = LEAST(100, trade_willingness + 30)
                 WHERE faction_type = 'trade'"
            )->execute();
            $db->prepare(
                "UPDATE npc_factions SET aggression = GREATEST(0, aggression - 15)
                 WHERE faction_type = 'pirate'"
            )->execute();
            break;
        case 3: // pirate_surge
            $db->prepare(
                "UPDATE npc_factions SET aggression = LEAST(100, aggression + 40)
                 WHERE faction_type = 'pirate'"
            )->execute();
            break;
    }
    app_state_set_int($db, 'faction_event:last_end_unix', 0); // reset so cooldown starts on revert
}

function faction_event_revert(PDO $db, int $eventType): void {
    switch ($eventType) {
        case 1:
            $db->prepare(
                "UPDATE npc_factions SET aggression = GREATEST(0, aggression - 25)
                 WHERE faction_type IN ('military','pirate')"
            )->execute();
            break;
        case 2:
            $db->prepare(
                "UPDATE npc_factions SET trade_willingness = GREATEST(0, trade_willingness - 30)
                 WHERE faction_type = 'trade'"
            )->execute();
            $db->prepare(
                "UPDATE npc_factions SET aggression = LEAST(100, aggression + 15)
                 WHERE faction_type = 'pirate'"
            )->execute();
            break;
        case 3:
            $db->prepare(
                "UPDATE npc_factions SET aggression = GREATEST(0, aggression - 40)
                 WHERE faction_type = 'pirate'"
            )->execute();
            break;
    }
    app_state_set_int($db, 'faction_event:last_end_unix', time());
}

// ─────────────────────────────────────────────────────────────────────────────

function npc_can_afford(array $resources, array $cost): bool {
    return (float)($resources['metal'] ?? 0) >= (float)($cost['metal'] ?? 0)
        && (float)($resources['crystal'] ?? 0) >= (float)($cost['crystal'] ?? 0)
        && (float)($resources['deuterium'] ?? 0) >= (float)($cost['deuterium'] ?? 0);
}

function npc_spend_colony_resources(PDO $db, int $colonyId, array &$resources, array $cost): void {
    $m = (float)($cost['metal'] ?? 0);
    $c = (float)($cost['crystal'] ?? 0);
    $d = (float)($cost['deuterium'] ?? 0);
    $db->prepare(
        'UPDATE colonies
         SET metal = metal - ?, crystal = crystal - ?, deuterium = deuterium - ?
         WHERE id = ?'
    )->execute([$m, $c, $d, $colonyId]);

    $resources['metal'] = max(0.0, (float)($resources['metal'] ?? 0) - $m);
    $resources['crystal'] = max(0.0, (float)($resources['crystal'] ?? 0) - $c);
    $resources['deuterium'] = max(0.0, (float)($resources['deuterium'] ?? 0) - $d);
}

// ─── Phase 4.4 – Planetary random events ─────────────────────────────────────

/**
 * Per-colony random event tick.
 * Rate-limited to once every 15 minutes (via app_state).
 * Each colony without an active event has a 10 % chance per tick to receive one.
 *
 * Event types & effects (applied in update_colony_resources):
 *   solar_flare         – 2 h  – energy production −30 %
 *   mineral_vein        – 6 h  – metal production +20 %
 *   disease             – until hospital lv3 – happiness −25
 *   archaeological_find – 6 h  – one-time +500 dark matter (requires science standing >= 20)
 */
function colony_events_tick_global(PDO $db): void {
    if (!function_exists('app_state_get_int') || !function_exists('app_state_set_int')) {
        return;
    }

    $now = time();

    // Rate-limit: once per 15 minutes
    $lastTick = app_state_get_int($db, 'colony_events:last_tick', 0);
    if (($now - $lastTick) < 900) {
        return;
    }
    app_state_set_int($db, 'colony_events:last_tick', $now);

    // Clean up expired events
    try {
        $db->exec("DELETE FROM colony_events WHERE expires_at < NOW()");
    } catch (Throwable $e) {
        return; // table may not exist yet (pre-migration)
    }

        // Load all active colonies owned by login-enabled human actors.
    $stmt = $db->prepare(
        'SELECT c.id AS colony_id, c.name AS colony_name, c.user_id
         FROM colonies c
         JOIN users u ON u.id = c.user_id
            WHERE u.control_type = \'human\' AND u.auth_enabled = 1 AND u.deleted_at IS NULL
         ORDER BY RAND()'
    );
    $stmt->execute();
    $colonies = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($colonies)) {
        return;
    }

    // Load colony IDs that already have an active event
    $activeStmt = $db->query('SELECT colony_id FROM colony_events WHERE expires_at > NOW()');
    $activeSet  = array_flip(
        array_column($activeStmt->fetchAll(PDO::FETCH_ASSOC), 'colony_id')
    );

    $eventMeta = [
        'solar_flare'  => ['duration' => 7200,  'label' => 'Solar Flare',   'icon' => '☀️',
                           'body' => 'A powerful solar flare is disrupting reactor output. Colony energy production reduced by 30 % for 2 hours.'],
        'mineral_vein' => ['duration' => 21600, 'label' => 'Mineral Vein',  'icon' => '⛏️',
                           'body' => 'Miners struck a rich mineral vein! Metal production is boosted by 20 % for 6 hours.'],
        'disease'      => ['duration' => 259200, 'label' => 'Disease Outbreak', 'icon' => '🦠',
                           'body' => 'An outbreak is sweeping through the population. Happiness is reduced by 25 until your Hospital reaches level 3.'],
        'archaeological_find' => ['duration' => 21600, 'label' => 'Archaeological Find', 'icon' => '🏺',
                           'body' => 'A precursor dig site has been uncovered. You gained +500 Dark Matter.'],
    ];
    $eventKeys = array_keys($eventMeta);

    $insertStmt = $db->prepare(
        'INSERT IGNORE INTO colony_events (colony_id, event_type, started_at, expires_at)
         VALUES (?, ?, NOW(), FROM_UNIXTIME(?))'
    );
    $msgStmt = $db->prepare(
        'INSERT INTO messages (sender_id, receiver_id, subject, body, is_system, created_at)
         VALUES (NULL, ?, ?, ?, 1, NOW())'
    );

    // Science Collective faction id for archaeological-find eligibility
    $scienceFactionId = 0;
    try {
        $sf = $db->prepare('SELECT id FROM npc_factions WHERE faction_type = "science" ORDER BY id ASC LIMIT 1');
        $sf->execute();
        $scienceFactionId = (int)($sf->fetchColumn() ?: 0);
    } catch (Throwable $e) {
        $scienceFactionId = 0;
    }

    foreach ($colonies as $col) {
        $cid = (int)$col['colony_id'];
        if (isset($activeSet[$cid])) {
            continue; // already has an active event
        }
        if (mt_rand(1, 100) > 10) {
            continue; // 10 % trigger chance
        }

        $eligibleEventKeys = $eventKeys;
        if ($scienceFactionId > 0) {
            $st = $db->prepare('SELECT standing FROM diplomacy WHERE user_id = ? AND faction_id = ? LIMIT 1');
            $st->execute([(int)$col['user_id'], $scienceFactionId]);
            $scienceStanding = (int)($st->fetchColumn() ?: 0);
            if ($scienceStanding < 20) {
                $eligibleEventKeys = array_values(array_filter(
                    $eligibleEventKeys,
                    static fn(string $k): bool => $k !== 'archaeological_find'
                ));
            }
        } else {
            $eligibleEventKeys = array_values(array_filter(
                $eligibleEventKeys,
                static fn(string $k): bool => $k !== 'archaeological_find'
            ));
        }
        if (empty($eligibleEventKeys)) {
            continue;
        }

        $type   = $eligibleEventKeys[array_rand($eligibleEventKeys)];
        $meta   = $eventMeta[$type];
        $expiry = $now + $meta['duration'];

        $insertStmt->execute([$cid, $type, $expiry]);

        if ($type === 'archaeological_find') {
            $db->prepare('UPDATE users SET dark_matter = dark_matter + 500 WHERE id = ?')
               ->execute([(int)$col['user_id']]);
        }

        // Notify the player
        $subject = $meta['icon'] . ' ' . $meta['label'] . ' – ' . $col['colony_name'];
        $msgStmt->execute([(int)$col['user_id'], $subject, $meta['body']]);
    }
}

// ─── Phase 5.3 – Wormhole network maintenance ───────────────────────────────

/**
 * Regenerates wormhole stability over time and clears expired cooldown windows.
 * Rate-limited to once every 10 minutes via app_state.
 */
function wormhole_regeneration_tick_global(PDO $db): void {
    if (!function_exists('app_state_get_int') || !function_exists('app_state_set_int')) {
        return;
    }

    $now = time();
    $lastTick = app_state_get_int($db, 'wormholes:regen:last_tick', 0);
    if (($now - $lastTick) < 600) {
        return;
    }
    app_state_set_int($db, 'wormholes:regen:last_tick', $now);

    try {
        $db->exec(
            'CREATE TABLE IF NOT EXISTS wormholes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                endpoint_a_galaxy INT NOT NULL,
                endpoint_a_system INT NOT NULL,
                endpoint_b_galaxy INT NOT NULL,
                endpoint_b_system INT NOT NULL,
                stability INT NOT NULL DEFAULT 100,
                cooldown_until DATETIME DEFAULT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                label VARCHAR(80) DEFAULT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_wormholes_a (endpoint_a_galaxy, endpoint_a_system),
                INDEX idx_wormholes_b (endpoint_b_galaxy, endpoint_b_system)
            ) ENGINE=InnoDB'
        );
    } catch (Throwable $e) {
        return;
    }

    $db->exec(
        'UPDATE wormholes
         SET
            cooldown_until = CASE
                WHEN cooldown_until IS NOT NULL AND cooldown_until <= NOW() THEN NULL
                ELSE cooldown_until
            END,
            stability = LEAST(
                100,
                stability + CASE
                    WHEN cooldown_until IS NULL OR cooldown_until <= NOW() THEN 2
                    ELSE 0
                END
            )
         WHERE is_active = 1
           AND (stability < 100 OR cooldown_until IS NOT NULL)'
    );
}

/**
 * Assign a faction-specific FTL drive to an NPC user if they still have
 * the default 'aereth' drive (OD-3: NPC factions get race-specific FTL).
 *
 * Mapping:
 *  empire / pve_empire   → vor_tak   (strategic jump drives)
 *  science / pve_science → zhareen   (resonance network)
 *  pirates / pve_pirates → kryl_tha  (swarm tunnels)
 *  precursors            → vel_ar    (stealth jumps)
 *  guild / pve_guild     → syl_nar   (gate network)
 *  collective / others   → aereth    (default Alcubierre)
 */
function npc_assign_ftl_drive(PDO $db, int $npcUserId): void {
    $uRow = $db->prepare('SELECT ftl_drive_type FROM users WHERE id = ? LIMIT 1');
    $uRow->execute([$npcUserId]);
    $u = $uRow->fetch();
    if (!$u || $u['ftl_drive_type'] !== 'aereth') {
        return; // already assigned
    }

    // Determine which NPC faction this user is primarily affiliated with
    // via faction_colonies (NPC factions seed colonies linked to NPC users)
    try {
        $fcStmt = $db->prepare(
            'SELECT nf.code FROM faction_colonies fc
               JOIN npc_factions nf ON nf.id = fc.faction_id
               JOIN colonies c ON c.id = fc.colony_id
              WHERE c.user_id = ? LIMIT 1'
        );
        $fcStmt->execute([$npcUserId]);
        $fc = $fcStmt->fetch();
    } catch (\Throwable) {
        return; // table not yet migrated, skip silently
    }

    if (!$fc) return;

    $code = strtolower((string)($fc['code'] ?? ''));
    $driveMap = [
        'empire'        => 'vor_tak',
        'pve_empire'    => 'vor_tak',
        'science'       => 'zhareen',
        'pve_science'   => 'zhareen',
        'pirates'       => 'kryl_tha',
        'pve_pirates'   => 'kryl_tha',
        'precursors'    => 'vel_ar',
        'guild'         => 'syl_nar',
        'pve_guild'     => 'syl_nar',
    ];

    $drive = $driveMap[$code] ?? 'aereth';
    if ($drive === 'aereth') return; // no change needed

    $db->prepare('UPDATE users SET ftl_drive_type = ? WHERE id = ?')
       ->execute([$drive, $npcUserId]);
}
