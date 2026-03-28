<?php
/**
 * Leaders / Officers API
 *
 * GET  /api/leaders.php?action=list
 * POST /api/leaders.php?action=hire      body: {name, role}
 * POST /api/leaders.php?action=assign    body: {leader_id, colony_id|fleet_id|null}
 * POST /api/leaders.php?action=autonomy  body: {leader_id, autonomy}
 * POST /api/leaders.php?action=dismiss   body: {leader_id}
 * POST /api/leaders.php?action=ai_tick   (run autonomous actions for all auto leaders)
 *
 * Leader roles
 * ────────────
 *  colony_manager   – Manages a colony: boosts production, auto-builds
 *  fleet_commander  – Commands a fleet: boosts speed + attack, auto-recalls if empty target
 *  science_director – Manages research: reduces time + cost, auto-starts research
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';  // verify_colony_ownership, get_building_level

$action = $_GET['action'] ?? '';
$uid    = require_auth();

// Hiring cost per role (paid from homeworld colony)
const HIRE_COST = [
    'colony_manager'   => ['metal' => 5000,  'crystal' => 3000,  'deuterium' => 1000],
    'fleet_commander'  => ['metal' => 8000,  'crystal' => 5000,  'deuterium' => 2000],
    'science_director' => ['metal' => 4000,  'crystal' => 8000,  'deuterium' => 4000],
];

// XP awarded per event
const LEADER_XP = [
    'building_complete' => 20,
    'research_complete' => 30,
    'fleet_arrived'     => 15,
    'fleet_won'         => 50,
];

switch ($action) {

    // ── List all leaders ──────────────────────────────────────────────────────
    case 'list':
        only_method('GET');
        $db   = get_db();
        $stmt = $db->prepare(
            'SELECT l.*,
                    c.name AS colony_name,
                    CONCAT(p.galaxy,\':\',p.`system`,\':\',p.position) AS colony_coords
             FROM leaders l
             LEFT JOIN colonies c ON c.id = l.colony_id
             LEFT JOIN planets  p ON p.id = c.planet_id
             WHERE l.user_id = ?
             ORDER BY l.role, l.name'
        );
        $stmt->execute([$uid]);
        json_ok(['leaders' => $stmt->fetchAll()]);
        break;

    // ── Hire a new leader ─────────────────────────────────────────────────────
    case 'hire':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $name = trim($body['name'] ?? '');
        $role = $body['role'] ?? '';

        if (!preg_match('/^[\w\s\-\.]{2,48}$/u', $name)) {
            json_error('Leader name must be 2–48 characters (letters, spaces, hyphens, dots).');
        }
        if (!array_key_exists($role, HIRE_COST)) {
            json_error('Unknown leader role.');
        }

        $db   = get_db();
        $cost = HIRE_COST[$role];

        // Deduct from homeworld colony
        $hw = $db->prepare('SELECT id, metal, crystal, deuterium FROM colonies WHERE user_id=? AND is_homeworld=1 LIMIT 1');
        $hw->execute([$uid]);
        $homeworld = $hw->fetch();
        if (!$homeworld) { json_error('No homeworld found.'); }

        if ($homeworld['metal']     < $cost['metal']
         || $homeworld['crystal']   < $cost['crystal']
         || $homeworld['deuterium'] < $cost['deuterium']) {
            json_error('Insufficient resources on homeworld to hire this leader.');
        }

        $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-?, deuterium=deuterium-? WHERE id=?')
           ->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $homeworld['id']]);

        $db->prepare(
            'INSERT INTO leaders (user_id, name, role) VALUES (?, ?, ?)'
        )->execute([$uid, $name, $role]);

        $lid = (int)$db->lastInsertId();
        $leader = $db->prepare('SELECT * FROM leaders WHERE id=?');
        $leader->execute([$lid]);
        json_ok(['leader' => $leader->fetch(), 'message' => "$name hired as " . str_replace('_', ' ', $role) . '!']);
        break;

    // ── Assign a leader to a colony or fleet (or unassign) ───────────────────
    case 'assign':
        only_method('POST');
        verify_csrf();
        $body     = get_json_body();
        $lid      = (int)($body['leader_id'] ?? 0);
        $colonyId = isset($body['colony_id']) ? (int)$body['colony_id'] : null;
        $fleetId  = isset($body['fleet_id'])  ? (int)$body['fleet_id']  : null;

        $db = get_db();

        // Verify ownership
        $lRow = $db->prepare('SELECT * FROM leaders WHERE id=? AND user_id=?');
        $lRow->execute([$lid, $uid]);
        $leader = $lRow->fetch();
        if (!$leader) { json_error('Leader not found.', 404); }

        // Role-specific assignment validation
        // fleet_commanders may be assigned to a colony (acts as home-base for autonomous scouting)
        // or to a fleet (passive speed/attack bonus on that specific fleet).
        if (in_array($leader['role'], ['colony_manager', 'science_director'], true) && $fleetId !== null) {
            json_error('Colony managers and science directors can only be assigned to colonies.');
        }

        // Verify target ownership
        if ($colonyId !== null) {
            $c = $db->prepare('SELECT id FROM colonies WHERE id=? AND user_id=?');
            $c->execute([$colonyId, $uid]);
            if (!$c->fetch()) { json_error('Colony not found.', 404); }
        }
        if ($fleetId !== null) {
            $f = $db->prepare('SELECT id FROM fleets WHERE id=? AND user_id=?');
            $f->execute([$fleetId, $uid]);
            if (!$f->fetch()) { json_error('Fleet not found.', 404); }
        }

        $db->prepare('UPDATE leaders SET colony_id=?, fleet_id=? WHERE id=?')
           ->execute([$colonyId, $fleetId, $lid]);

        $loc = $colonyId ? "colony #$colonyId" : ($fleetId ? "fleet #$fleetId" : 'unassigned');
        json_ok(['message' => "{$leader['name']} assigned to $loc."]);
        break;

    // ── Set autonomy level ────────────────────────────────────────────────────
    case 'autonomy':
        only_method('POST');
        verify_csrf();
        $body     = get_json_body();
        $lid      = (int)($body['leader_id'] ?? 0);
        $autonomy = max(0, min(2, (int)($body['autonomy'] ?? 1)));

        $db = get_db();
        $upd = $db->prepare('UPDATE leaders SET autonomy=? WHERE id=? AND user_id=?');
        $upd->execute([$autonomy, $lid, $uid]);
        if (!$upd->rowCount()) { json_error('Leader not found.', 404); }

        $labels = ['0' => 'inactive', '1' => 'suggest', '2' => 'full auto'];
        json_ok(['message' => "Autonomy set to: " . ($labels[$autonomy] ?? $autonomy)]);
        break;

    // ── Dismiss a leader ──────────────────────────────────────────────────────
    case 'dismiss':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $lid  = (int)($body['leader_id'] ?? 0);
        $db   = get_db();
        $del  = $db->prepare('DELETE FROM leaders WHERE id=? AND user_id=?');
        $del->execute([$lid, $uid]);
        if (!$del->rowCount()) { json_error('Leader not found.', 404); }
        json_ok(['message' => 'Leader dismissed.']);
        break;

    // ── AI tick: run autonomous actions ──────────────────────────────────────
    case 'ai_tick':
        only_method('POST');
        verify_csrf();
        $db      = get_db();
        $actions = run_ai_tick($db, $uid);
        json_ok(['actions' => $actions]);
        break;

    default:
        json_error('Unknown action');
}

// ─── AI Tick Logic ────────────────────────────────────────────────────────────

/**
 * Run all autonomous leader actions for a given user.
 * Returns an array of human-readable action strings (max 20).
 */
function run_ai_tick(PDO $db, int $uid): array {
    $actions = [];

    $leaders = $db->prepare('SELECT * FROM leaders WHERE user_id=? AND autonomy=2 ORDER BY role');
    $leaders->execute([$uid]);

    foreach ($leaders->fetchAll() as $leader) {
        switch ($leader['role']) {

            case 'colony_manager':
                if (!$leader['colony_id']) break;
                $a = ai_colony_manager_tick($db, $leader);
                if ($a) { $actions[] = $a; }
                break;

            case 'science_director':
                if (!$leader['colony_id']) break;
                $a = ai_science_director_tick($db, $leader);
                if ($a) { $actions[] = $a; }
                break;

            case 'fleet_commander':
                // When colony-assigned with autonomy=2: active scouting decisions.
                if (!$leader['colony_id']) break;
                $a = ai_fleet_commander_tick($db, $leader);
                if ($a) { $actions[] = $a; }
                break;
        }

        if (count($actions) >= 20) break;
    }

    return $actions;
}

/**
 * Colony manager AI: starts the cheapest affordable upgrade if nothing is queued.
 * Prioritises: metal_mine → crystal_mine → deuterium_synth → solar_plant.
 */
/**
 * Fleet commander AI (colony-assigned, autonomy=2).
 *
 * Actions (tried in order, at most one per call):
 *  1. Auto-scout – dispatch a spy probe to the nearest stale/unseen system.
 *  2. Auto-intercept – recall any of the user's returning-empty fleets early
 *     if the home colony has surplus fighters for defence.
 *
 * Rate-limited: at most one action per 15 minutes per leader.
 */
function ai_fleet_commander_tick(PDO $db, array $leader): ?string {
    $cid = (int)$leader['colony_id'];
    $uid = (int)$leader['user_id'];

    // Rate-limit: skip if acted within the last 15 minutes.
    if ($leader['last_action_at'] && (time() - strtotime($leader['last_action_at'])) < 900) {
        return null;
    }

    $colStmt = $db->prepare(
        'SELECT c.id, p.galaxy, p.`system`, p.position
         FROM colonies c
         JOIN planets p ON p.id = c.planet_id
         WHERE c.id = ? AND c.user_id = ?'
    );
    $colStmt->execute([$cid, $uid]);
    $colony = $colStmt->fetch();
    if (!$colony) return null;

    $action = fc_auto_scout($db, $leader, $colony, $uid)
           ?? fc_auto_recall_empty($db, $leader, $uid);

    if ($action) {
        $db->prepare('UPDATE leaders SET last_action=?, last_action_at=NOW() WHERE id=?')
           ->execute([$action, (int)$leader['id']]);
        leader_award_xp($db, (int)$leader['id'], LEADER_XP['fleet_arrived']);
    }
    return $action;
}

/**
 * Dispatch one spy probe to the nearest galaxy system not yet fully scouted.
 * Requires: espionage_tech >= 1, at least one spy_probe on the home colony,
 *           and no other spy mission currently in flight from that colony.
 */
function fc_auto_scout(PDO $db, array $leader, array $colony, int $uid): ?string {
    $cid = (int)$colony['id'];
    $g   = (int)$colony['galaxy'];
    $s   = (int)$colony['system'];

    // Require basic espionage research.
    $espStmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type="espionage_tech"');
    $espStmt->execute([$uid]);
    if ((int)($espStmt->fetchColumn() ?: 0) < 1) return null;

    // Require spy probe on home colony.
    $probeStmt = $db->prepare('SELECT count FROM ships WHERE colony_id=? AND type="spy_probe"');
    $probeStmt->execute([$cid]);
    if ((int)($probeStmt->fetchColumn() ?: 0) < 1) return null;

    // No active spy mission in flight from this colony.
    $activeStmt = $db->prepare(
        'SELECT COUNT(*) FROM fleets
         WHERE user_id=? AND origin_colony_id=? AND mission="spy" AND returning=0'
    );
    $activeStmt->execute([$uid, $cid]);
    if ((int)$activeStmt->fetchColumn() > 0) return null;

    // Find nearest unscouted / stale system in the same galaxy.
    $targetStmt = $db->prepare(
        'SELECT p.`system`, ABS(p.`system` - ?) AS dist
         FROM planets p
         WHERE p.galaxy = ?
           AND p.`system` != ?
           AND NOT EXISTS (
               SELECT 1 FROM player_system_visibility v
               WHERE v.user_id = ? AND v.galaxy = ? AND v.`system` = p.`system`
                 AND v.level IN ("own","active")
                 AND (v.expires_at IS NULL OR v.expires_at > NOW())
           )
         GROUP BY p.`system`
         ORDER BY dist ASC
         LIMIT 1'
    );
    $targetStmt->execute([$s, $g, $s, $uid, $g]);
    $target = $targetStmt->fetch();
    if (!$target) return null;

    $ts = (int)$target['system'];
    $tp = random_int(1, POSITION_MAX);

    $launched = launch_fleet_for_user(
        $db, $uid, $cid,
        $g, $ts, $tp,
        'spy',
        ['spy_probe' => 1],
        []
    );
    if (!$launched) return null;

    // Record FoW active-visibility for the destination (active until fleet returns).
    $travelSec = 3600; // rough upper bound; actual arrival will update this.
    $visExpiry = date('Y-m-d H:i:s', time() + $travelSec);
    touch_system_visibility($db, $uid, $g, $ts, 'active', $visExpiry, null);

    return "[{$leader['name']}] Auto-scout dispatched spy probe to [{$g}:{$ts}:{$tp}]";
}

/**
 * Auto-recall: recall any of the user's fleets that are returning with no cargo
 * and whose origin is this colony, freeing the ships faster.
 */
function fc_auto_recall_empty(PDO $db, array $leader, int $uid): ?string {
    $cid = (int)$leader['colony_id'];

    // Find a returning, empty fleet originating from our home colony.
    $stmt = $db->prepare(
        'SELECT id, arrival_time FROM fleets
         WHERE user_id = ? AND origin_colony_id = ? AND returning = 1
           AND cargo_metal = 0 AND cargo_crystal = 0 AND cargo_deuterium = 0
           AND arrival_time > NOW()
         ORDER BY arrival_time DESC
         LIMIT 1'
    );
    $stmt->execute([$uid, $cid]);
    $fleet = $stmt->fetch();
    if (!$fleet) return null;

    // Accelerate return by setting arrival_time to now + 30 seconds.
    $fast = date('Y-m-d H:i:s', time() + 30);
    $db->prepare('UPDATE fleets SET arrival_time=?, return_time=? WHERE id=?')
       ->execute([$fast, $fast, (int)$fleet['id']]);

    return "[{$leader['name']}] Recalled empty fleet #{$fleet['id']} early to reinforce base.";
}

function ai_colony_manager_tick(PDO $db, array $leader): ?string {
    $cid = (int)$leader['colony_id'];

    // Nothing to do if there is already an upgrade in progress
    $busy = $db->prepare('SELECT id FROM buildings WHERE colony_id=? AND upgrade_end IS NOT NULL');
    $busy->execute([$cid]);
    if ($busy->fetch()) return null;

    $colony = $db->prepare('SELECT metal, crystal, deuterium, user_id FROM colonies WHERE id=?');
    $colony->execute([$cid]);
    $c = $colony->fetch();
    if (!$c) return null;

    // Priority list
    $priority = ['metal_mine','crystal_mine','deuterium_synth','solar_plant',
                  'metal_storage','crystal_storage','fusion_reactor'];

    foreach ($priority as $type) {
        $bRow = $db->prepare('SELECT level FROM buildings WHERE colony_id=? AND type=?');
        $bRow->execute([$cid, $type]);
        $building = $bRow->fetch();
        if (!$building) continue;

        $nextLevel = (int)$building['level'] + 1;
        $cost      = building_cost($type, $nextLevel);

        // Apply manager construction bonus to cost check
        $rL  = get_building_level($db, $cid, 'robotics_factory');
        $nL  = get_building_level($db, $cid, 'nanite_factory');
        $sec = building_build_time($cost, $rL, $nL);
        $sec = leader_build_time($sec, (int)$leader['skill_construction']);

        if ($c['metal']     >= $cost['metal']
         && $c['crystal']   >= $cost['crystal']
         && $c['deuterium'] >= $cost['deuterium']) {

            $end = date('Y-m-d H:i:s', time() + $sec);

            $db->prepare('UPDATE colonies SET metal=metal-?,crystal=crystal-?,deuterium=deuterium-? WHERE id=?')
               ->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $cid]);
            $db->prepare('UPDATE buildings SET upgrade_end=? WHERE colony_id=? AND type=?')
               ->execute([$end, $cid, $type]);

            // Log decision
            $msg = "[{$leader['name']}] Auto-upgraded {$type} to Lv{$nextLevel} on colony #{$cid}";
            $db->prepare("UPDATE leaders SET last_action=?, last_action_at=NOW() WHERE id=?")
               ->execute([$msg, $leader['id']]);

            leader_award_xp($db, (int)$leader['id'], LEADER_XP['building_complete']);
            return $msg;
        }
    }

    return null;
}

/**
 * Science director AI: starts the cheapest research if the lab is free.
 * Prioritises: energy_tech → combustion_drive → espionage_tech → weapons_tech.
 */
function ai_science_director_tick(PDO $db, array $leader): ?string {
    $cid = (int)$leader['colony_id'];
    $uid = (int)($db->prepare('SELECT user_id FROM colonies WHERE id=?')->execute([$cid])
                   ?: null);
    // Get user_id
    $cRow = $db->prepare('SELECT user_id FROM colonies WHERE id=?');
    $cRow->execute([$cid]);
    $cData = $cRow->fetch();
    if (!$cData) return null;
    $uid = (int)$cData['user_id'];

    // Lab must be built
    if (get_building_level($db, $cid, 'research_lab') < 1) return null;

    // Nothing if research already in progress
    $busy = $db->prepare('SELECT id FROM research WHERE user_id=? AND research_end IS NOT NULL');
    $busy->execute([$uid]);
    if ($busy->fetch()) return null;

    $colony = $db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id=?');
    $colony->execute([$cid]);
    $c = $colony->fetch();
    if (!$c) return null;

    $priority = ['energy_tech','combustion_drive','espionage_tech','weapons_tech',
                  'armor_tech','shielding_tech','impulse_drive'];

    foreach ($priority as $type) {
        $rRow = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=?');
        $rRow->execute([$uid, $type]);
        $res = $rRow->fetch();
        if (!$res) continue;

        $nextLevel = (int)$res['level'] + 1;
        $cost      = research_cost($type, $nextLevel);
        $cost      = leader_research_cost($cost, (int)$leader['skill_efficiency']);
        $labLevel  = get_building_level($db, $cid, 'research_lab');
        $secs      = leader_research_time(research_time($cost, $labLevel), (int)$leader['skill_research']);

        if ($c['metal']     >= $cost['metal']
         && $c['crystal']   >= $cost['crystal']
         && $c['deuterium'] >= $cost['deuterium']) {

            $end = date('Y-m-d H:i:s', time() + $secs);

            $db->prepare('UPDATE colonies SET metal=metal-?,crystal=crystal-?,deuterium=deuterium-? WHERE id=?')
               ->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $cid]);
            $db->prepare('UPDATE research SET research_end=? WHERE user_id=? AND type=?')
               ->execute([$end, $uid, $type]);

            $msg = "[{$leader['name']}] Auto-researched {$type} Lv{$nextLevel} (completes {$end})";
            $db->prepare("UPDATE leaders SET last_action=?, last_action_at=NOW() WHERE id=?")
               ->execute([$msg, $leader['id']]);

            leader_award_xp($db, (int)$leader['id'], LEADER_XP['research_complete']);
            return $msg;
        }
    }

    return null;
}
