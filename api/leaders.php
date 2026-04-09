<?php
/**
 * Leaders / Officers API
 *
 * GET  /api/leaders.php?action=list
 * POST /api/leaders.php?action=hire           body: {name, role}
 * POST /api/leaders.php?action=assign         body: {leader_id, colony_id|fleet_id|null}
 * POST /api/leaders.php?action=autonomy       body: {leader_id, autonomy}
 * POST /api/leaders.php?action=dismiss        body: {leader_id}
 * POST /api/leaders.php?action=ai_tick        (run autonomous actions for all auto leaders)
 * GET  /api/leaders.php?action=marketplace    list marketplace candidates (auto-refresh daily)
 * POST /api/leaders.php?action=hire_candidate body: {candidate_id}
 * GET  /api/leaders.php?action=advisor_hints  list active advisor hints
 * POST /api/leaders.php?action=advisor_tick   re-analyse game state, refresh hints
 * POST /api/leaders.php?action=dismiss_hint   body: {hint_id}
 *
 * Leader roles
 * ────────────
 *  colony_manager   – Manages a colony: boosts production, auto-builds
 *  fleet_commander  – Commands a fleet: boosts speed + attack, auto-recalls if empty target
 *  science_director – Manages research: reduces time + cost, auto-starts research
 *  diplomacy_officer – Improves faction relations over time
 *  trade_director   – Generates steady brokerage income on assigned colony
 *  advisor          – Guides the player: quest hints, tips, warnings, action reminders
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
    'diplomacy_officer'=> ['metal' => 4500,  'crystal' => 4500,  'deuterium' => 1500],
    'trade_director'   => ['metal' => 6500,  'crystal' => 3500,  'deuterium' => 2500],
    'advisor'          => ['metal' => 0,     'crystal' => 0,     'deuterium' => 0],
];

// XP awarded per event
const LEADER_XP = [
    'building_complete' => 20,
    'research_complete' => 30,
    'fleet_arrived'     => 15,
    'fleet_won'         => 50,
    'diplomacy_success' => 18,
    'trade_profit'      => 16,
];

switch ($action) {

    // ── List all leaders ──────────────────────────────────────────────────────
    case 'list':
        only_method('GET');
        $db   = get_db();
        $stmt = $db->prepare(
            'SELECT l.*,
                    c.name AS colony_name,
                    CONCAT(cb.galaxy_index,\':\',cb.system_index,\':\',cb.position) AS colony_coords
             FROM leaders l
             LEFT JOIN colonies c ON c.id = l.colony_id
               LEFT JOIN celestial_bodies cb ON cb.id = c.body_id
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
        if (in_array($leader['role'], ['colony_manager', 'science_director', 'diplomacy_officer', 'trade_director'], true) && $fleetId !== null) {
            json_error('This leader role can only be assigned to colonies.');
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
        $exists = $db->prepare('SELECT id FROM leaders WHERE id=? AND user_id=? LIMIT 1');
        $exists->execute([$lid, $uid]);
        if (!$exists->fetch()) { json_error('Leader not found.', 404); }

        $upd = $db->prepare('UPDATE leaders SET autonomy=? WHERE id=? AND user_id=?');
        $upd->execute([$autonomy, $lid, $uid]);

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

    // ── Marketplace: list available candidates (auto-refresh daily) ───────────
    case 'marketplace':
        only_method('GET');
        $db         = get_db();
        ensure_leader_marketplace_schema($db);
        session_write_close();
        $candidates = get_or_refresh_marketplace($db, $uid);
        json_ok(['candidates' => $candidates]);
        break;

    // ── Hire a marketplace candidate ──────────────────────────────────────────
    case 'hire_candidate':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $cid  = (int)($body['candidate_id'] ?? 0);
        $db   = get_db();
        ensure_leader_marketplace_schema($db);
        ensure_leaders_marketplace_profile_schema($db);

        // Load the candidate (must belong to this user and not yet hired)
        $cRow = $db->prepare(
            'SELECT * FROM leader_marketplace WHERE id=? AND user_id=? AND is_hired=0 AND expires_at > NOW()'
        );
        $cRow->execute([$cid, $uid]);
        $candidate = $cRow->fetch();
        if (!$candidate) {
            json_error('Candidate not available (already hired or expired).', 404);
        }

        // Deduct hire cost from homeworld colony (cost is stored on the candidate row)
        $hw = $db->prepare('SELECT id, metal, crystal, deuterium FROM colonies WHERE user_id=? AND is_homeworld=1 LIMIT 1');
        $hw->execute([$uid]);
        $homeworld = $hw->fetch();
        if (!$homeworld) { json_error('No homeworld found.'); }

        $cost = [
            'metal'     => (int)$candidate['hire_metal'],
            'crystal'   => (int)$candidate['hire_crystal'],
            'deuterium' => (int)$candidate['hire_deuterium'],
        ];
        if ($homeworld['metal']     < $cost['metal']
         || $homeworld['crystal']   < $cost['crystal']
         || $homeworld['deuterium'] < $cost['deuterium']) {
            json_error('Insufficient resources on homeworld.');
        }

        if ($cost['metal'] > 0 || $cost['crystal'] > 0 || $cost['deuterium'] > 0) {
            $db->prepare('UPDATE colonies SET metal=metal-?,crystal=crystal-?,deuterium=deuterium-? WHERE id=?')
               ->execute([$cost['metal'], $cost['crystal'], $cost['deuterium'], $homeworld['id']]);
        }

        // Create the leader record
        $db->prepare(
            'INSERT INTO leaders
                (user_id, name, role, rarity, portrait, tagline, backstory, trait_1, trait_2,
                 skill_production, skill_construction, skill_tactics, skill_navigation,
                 skill_research, skill_efficiency, skill_guidance, marketplace_source_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $uid,
            $candidate['name'],
            $candidate['role'],
            $candidate['rarity'],
            $candidate['portrait'],
            $candidate['tagline'],
            $candidate['backstory'],
            $candidate['trait_1'],
            $candidate['trait_2'],
            $candidate['skill_production'],
            $candidate['skill_construction'],
            $candidate['skill_tactics'],
            $candidate['skill_navigation'],
            $candidate['skill_research'],
            $candidate['skill_efficiency'],
            $candidate['skill_guidance'],
            $candidate['id'],
        ]);
        $newLid = (int)$db->lastInsertId();

        // Mark candidate as hired
        $db->prepare('UPDATE leader_marketplace SET is_hired=1, hired_at=NOW() WHERE id=?')
           ->execute([$cid]);

        $newLeader = $db->prepare('SELECT * FROM leaders WHERE id=?');
        $newLeader->execute([$newLid]);
        json_ok([
            'leader'  => $newLeader->fetch(),
            'message' => "{$candidate['name']} hired as " . str_replace('_', ' ', $candidate['role']) . '!',
        ]);
        break;

    // ── Advisor hints: get active (undismissed) hints ─────────────────────────
    case 'advisor_hints':
        only_method('GET');
        $db = get_db();

        // Check if the user has an advisor leader, return empty if not
        $adv = $db->prepare(
            'SELECT id FROM leaders WHERE user_id=? AND role="advisor" ORDER BY level DESC LIMIT 1'
        );
        $adv->execute([$uid]);
        $advisor = $adv->fetch();
        if (!$advisor) {
            json_ok(['hints' => [], 'advisor' => null]);
            break;
        }

        $advFull = $db->prepare('SELECT * FROM leaders WHERE id=? LIMIT 1');
        $advFull->execute([(int)$advisor['id']]);

        $hints = $db->prepare(
            'SELECT * FROM advisor_hints WHERE user_id=? AND dismissed=0 ORDER BY created_at DESC LIMIT 20'
        );
        $hints->execute([$uid]);
        json_ok(['hints' => $hints->fetchAll(), 'advisor' => $advFull->fetch()]);
        break;

    // ── Advisor tick: re-analyse game state, refresh hints ───────────────────
    case 'advisor_tick':
        only_method('POST');
        verify_csrf();
        $db = get_db();

        $adv = $db->prepare(
            'SELECT * FROM leaders WHERE user_id=? AND role="advisor" ORDER BY level DESC LIMIT 1'
        );
        $adv->execute([$uid]);
        $advisor = $adv->fetch();
        if (!$advisor) {
            json_ok(['hints' => [], 'message' => 'No advisor assigned.']);
            break;
        }

        run_advisor_analysis($db, $uid, $advisor);

        $hints = $db->prepare(
            'SELECT * FROM advisor_hints WHERE user_id=? AND dismissed=0 ORDER BY created_at DESC LIMIT 20'
        );
        $hints->execute([$uid]);
        json_ok(['hints' => $hints->fetchAll(), 'advisor' => $advisor]);
        break;

    // ── Dismiss a hint ────────────────────────────────────────────────────────
    case 'dismiss_hint':
        only_method('POST');
        verify_csrf();
        $body   = get_json_body();
        $hintId = (int)($body['hint_id'] ?? 0);
        $db     = get_db();
        $db->prepare('UPDATE advisor_hints SET dismissed=1 WHERE id=? AND user_id=?')
           ->execute([$hintId, $uid]);
        json_ok(['message' => 'Hint dismissed.']);
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

            case 'diplomacy_officer':
                if (!$leader['colony_id']) break;
                $a = ai_diplomacy_officer_tick($db, $leader);
                if ($a) { $actions[] = $a; }
                break;

            case 'trade_director':
                if (!$leader['colony_id']) break;
                $a = ai_trade_director_tick($db, $leader);
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
 *  1. Defensive recall when hostile attack fleets are inbound to home colony.
 *  2. Auto-intercept launch against nearby hostile origin colonies (fighter-heavy).
 *  3. Auto-scout – dispatch a spy probe to nearby stale/unseen non-hostile systems.
 *  4. Auto-logistics transport to weakest sibling colony (cargo-heavy).
 *  5. Auto-intercept – recall returning-empty fleets early for reinforcement.
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
           'SELECT c.id, cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
         FROM colonies c
            JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.id = ? AND c.user_id = ?'
    );
    $colStmt->execute([$cid, $uid]);
    $colony = $colStmt->fetch();
    if (!$colony) return null;

        $action = fc_auto_recall_under_attack($db, $leader, $colony, $uid)
            ?? fc_auto_intercept_launch($db, $leader, $colony, $uid)
            ?? fc_auto_scout($db, $leader, $colony, $uid)
            ?? fc_auto_supply_transport($db, $leader, $colony, $uid)
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

    // Find nearby unscouted/stale systems in the same galaxy and avoid hostile systems.
    $targetStmt = $db->prepare(
                'SELECT cb.system_index AS `system`, ABS(cb.system_index - ?) AS dist
                 FROM celestial_bodies cb
                 WHERE cb.galaxy_index = ?
                     AND cb.system_index != ?
                     AND cb.body_type = "planet"
           AND NOT EXISTS (
               SELECT 1 FROM player_system_visibility v
                             WHERE v.user_id = ? AND v.galaxy = ? AND v.`system` = cb.system_index
                 AND v.level IN ("own","active")
                 AND (v.expires_at IS NULL OR v.expires_at > NOW())
           )
                 GROUP BY cb.system_index
         ORDER BY dist ASC
         LIMIT 16'
    );
    $targetStmt->execute([$s, $g, $s, $uid, $g]);
    $targetSystems = $targetStmt->fetchAll(PDO::FETCH_ASSOC);
    if (!$targetSystems) return null;

    $ts = 0;
    foreach ($targetSystems as $candidate) {
        $candidateSystem = (int)($candidate['system'] ?? 0);
        if ($candidateSystem <= 0) continue;
        if (!fc_is_hostile_system_for_user($db, $uid, $g, $candidateSystem)) {
            $ts = $candidateSystem;
            break;
        }
    }
    if ($ts <= 0) return null;

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

/**
 * If home colony is under imminent hostile attack, recall one outbound fleet early.
 */
function fc_auto_recall_under_attack(PDO $db, array $leader, array $colony, int $uid): ?string {
    $cid = (int)$colony['id'];
    $g = (int)$colony['galaxy'];
    $s = (int)$colony['system'];
    $p = (int)$colony['position'];

    $threatStmt = $db->prepare(
        'SELECT id
         FROM fleets
         WHERE user_id <> ?
           AND returning = 0
           AND mission = "attack"
           AND target_galaxy = ?
           AND target_system = ?
           AND target_position = ?
           AND arrival_time > NOW()
           AND arrival_time <= DATE_ADD(NOW(), INTERVAL 45 MINUTE)
         ORDER BY arrival_time ASC
         LIMIT 1'
    );
    $threatStmt->execute([$uid, $g, $s, $p]);
    $threat = $threatStmt->fetch(PDO::FETCH_ASSOC);
    if (!$threat) {
        return null;
    }

    $ownFleetStmt = $db->prepare(
        'SELECT id, departure_time
         FROM fleets
         WHERE user_id = ?
           AND origin_colony_id = ?
           AND returning = 0
           AND mission IN ("attack", "transport", "harvest", "spy")
           AND arrival_time > NOW()
         ORDER BY arrival_time DESC
         LIMIT 1'
    );
    $ownFleetStmt->execute([$uid, $cid]);
    $fleet = $ownFleetStmt->fetch(PDO::FETCH_ASSOC);
    if (!$fleet) {
        return null;
    }

    $elapsed = max(1, time() - strtotime((string)$fleet['departure_time']));
    $returnTime = date('Y-m-d H:i:s', time() + $elapsed);
    $db->prepare('UPDATE fleets SET returning = 1, arrival_time = ?, return_time = ? WHERE id = ?')
       ->execute([$returnTime, $returnTime, (int)$fleet['id']]);

    return "[{$leader['name']}] Hostile incoming detected. Recalled fleet #{$fleet['id']} to defend home colony.";
}

/**
 * Launches an autonomous interceptor strike with a fighter-heavy composition.
 */
function fc_auto_intercept_launch(PDO $db, array $leader, array $colony, int $uid): ?string {
    $cid = (int)$colony['id'];
    $g = (int)$colony['galaxy'];
    $s = (int)$colony['system'];
    $p = (int)$colony['position'];

    $threatStmt = $db->prepare(
        'SELECT f.user_id, oc.id AS origin_colony_id,
              ob.galaxy_index AS og, ob.system_index AS os, ob.position AS op
         FROM fleets f
         JOIN colonies oc ON oc.id = f.origin_colony_id
          JOIN celestial_bodies ob ON ob.id = oc.body_id
         WHERE f.user_id <> ?
           AND f.returning = 0
           AND f.mission = "attack"
           AND f.target_galaxy = ?
           AND f.target_system = ?
           AND f.target_position = ?
           AND f.arrival_time > NOW()
           AND f.arrival_time <= DATE_ADD(NOW(), INTERVAL 60 MINUTE)
         ORDER BY f.arrival_time ASC
         LIMIT 1'
    );
    $threatStmt->execute([$uid, $g, $s, $p]);
    $threat = $threatStmt->fetch(PDO::FETCH_ASSOC);
    if (!$threat) {
        return null;
    }

    $tg = (int)($threat['og'] ?? 0);
    $ts = (int)($threat['os'] ?? 0);
    $tp = (int)($threat['op'] ?? 0);
    if ($tg <= 0 || $ts <= 0 || $tp <= 0) {
        return null;
    }
    $ships = fc_select_ships_for_mission($db, $cid, 'attack');
    if (empty($ships)) {
        return null;
    }

    $ok = launch_fleet_for_user($db, $uid, $cid, $tg, $ts, $tp, 'attack', $ships, []);
    if (!$ok) {
        return null;
    }

    return "[{$leader['name']}] Auto-intercept launched to [{$tg}:{$ts}:{$tp}] with a combat wing.";
}

/**
 * Sends a small transport to the weakest sibling colony if resources are skewed.
 */
function fc_auto_supply_transport(PDO $db, array $leader, array $colony, int $uid): ?string {
    $cid = (int)$colony['id'];

    $targetStmt = $db->prepare(
        'SELECT c.id, c.metal, c.crystal, c.deuterium,
            cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.user_id = ? AND c.id <> ?
         ORDER BY (c.metal + c.crystal + c.deuterium) ASC
         LIMIT 1'
    );
    $targetStmt->execute([$uid, $cid]);
    $target = $targetStmt->fetch(PDO::FETCH_ASSOC);
    if (!$target) {
        return null;
    }

    $originStmt = $db->prepare('SELECT metal, crystal, deuterium FROM colonies WHERE id = ? AND user_id = ?');
    $originStmt->execute([$cid, $uid]);
    $origin = $originStmt->fetch(PDO::FETCH_ASSOC);
    if (!$origin) {
        return null;
    }

    $originTotal = (float)$origin['metal'] + (float)$origin['crystal'] + (float)$origin['deuterium'];
    $targetTotal = (float)$target['metal'] + (float)$target['crystal'] + (float)$target['deuterium'];
    if ($originTotal < ($targetTotal * 1.30 + 6000.0)) {
        return null;
    }

    $ships = fc_select_ships_for_mission($db, $cid, 'transport');
    if (empty($ships)) {
        return null;
    }

    $capacity = 0.0;
    foreach ($ships as $type => $cnt) {
        $capacity += ship_cargo($type) * (int)$cnt;
    }
    if ($capacity < 500.0) {
        return null;
    }

    $reserveMetal = 12000.0;
    $reserveCrystal = 8000.0;
    $reserveDeut = 5000.0;

    $availMetal = max(0.0, (float)$origin['metal'] - $reserveMetal);
    $availCrystal = max(0.0, (float)$origin['crystal'] - $reserveCrystal);
    $availDeut = max(0.0, (float)$origin['deuterium'] - $reserveDeut);

    $cargoMetal = min($availMetal, $capacity * 0.45);
    $remaining = max(0.0, $capacity - $cargoMetal);
    $cargoCrystal = min($availCrystal, $remaining * 0.55);
    $remaining = max(0.0, $remaining - $cargoCrystal);
    $cargoDeut = min($availDeut, $remaining);

    if (($cargoMetal + $cargoCrystal + $cargoDeut) < 800.0) {
        return null;
    }

    $tg = (int)($target['galaxy'] ?? 0);
    $ts = (int)($target['system'] ?? 0);
    $tp = (int)($target['position'] ?? 0);
    if ($tg <= 0 || $ts <= 0 || $tp <= 0) {
        return null;
    }
    if (fc_is_hostile_system_for_user($db, $uid, $tg, $ts)) {
        return null;
    }

    $ok = launch_fleet_for_user(
        $db,
        $uid,
        $cid,
        $tg,
        $ts,
        $tp,
        'transport',
        $ships,
        ['metal' => $cargoMetal, 'crystal' => $cargoCrystal, 'deuterium' => $cargoDeut]
    );
    if (!$ok) {
        return null;
    }

    return "[{$leader['name']}] Auto-logistics sent relief cargo to colony #{$target['id']}.";
}

/**
 * Mission-specific fleet composition helper.
 */
function fc_select_ships_for_mission(PDO $db, int $colonyId, string $mission): array {
    $rowsStmt = $db->prepare('SELECT type, count FROM ships WHERE colony_id = ? AND count > 0');
    $rowsStmt->execute([$colonyId]);
    $available = [];
    foreach ($rowsStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $available[(string)$row['type']] = (int)$row['count'];
    }

    if ($mission === 'transport') {
        $out = [];
        $large = min(6, (int)($available['large_cargo'] ?? 0));
        $small = min(8, (int)($available['small_cargo'] ?? 0));
        if ($large > 0) $out['large_cargo'] = $large;
        if ($small > 0) $out['small_cargo'] = $small;
        return $out;
    }

    if ($mission === 'attack') {
        $priority = ['battlecruiser', 'battleship', 'cruiser', 'heavy_fighter', 'light_fighter'];
        $limits = [
            'battlecruiser' => 12,
            'battleship' => 16,
            'cruiser' => 18,
            'heavy_fighter' => 32,
            'light_fighter' => 48,
        ];
        $out = [];
        foreach ($priority as $type) {
            $take = min((int)($limits[$type] ?? 10), (int)($available[$type] ?? 0));
            if ($take > 0) {
                $out[$type] = $take;
            }
            if (count($out) >= 3) {
                break;
            }
        }
        return $out;
    }

    return [];
}

/**
 * Lightweight hostile-territory check using alliance war relations.
 */
function fc_is_hostile_system_for_user(PDO $db, int $uid, int $galaxy, int $system): bool {
    try {
        $allianceStmt = $db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ? LIMIT 1');
        $allianceStmt->execute([$uid]);
        $myAllianceId = (int)($allianceStmt->fetchColumn() ?: 0);
        if ($myAllianceId <= 0) {
            return false;
        }

        $warStmt = $db->prepare(
            'SELECT other_alliance_id, other_user_id
             FROM alliance_relations
             WHERE alliance_id = ?
               AND relation_type = "war"
               AND (expires_at IS NULL OR expires_at > NOW())'
        );
        $warStmt->execute([$myAllianceId]);
        $warRows = $warStmt->fetchAll(PDO::FETCH_ASSOC);
        if (!$warRows) {
            return false;
        }

        $enemyAllianceIds = [];
        $enemyUserIds = [];
        foreach ($warRows as $row) {
            $oa = (int)($row['other_alliance_id'] ?? 0);
            $ou = (int)($row['other_user_id'] ?? 0);
            if ($oa > 0) $enemyAllianceIds[] = $oa;
            if ($ou > 0) $enemyUserIds[] = $ou;
        }

        if (!$enemyAllianceIds && !$enemyUserIds) {
            return false;
        }

        $where = ['cb.galaxy_index = ?', 'cb.system_index = ?'];
        $params = [$galaxy, $system];
        $scope = [];

        if ($enemyAllianceIds) {
            $scope[] = 'am.alliance_id IN (' . implode(',', array_fill(0, count($enemyAllianceIds), '?')) . ')';
            $params = array_merge($params, $enemyAllianceIds);
        }
        if ($enemyUserIds) {
            $scope[] = 'c.user_id IN (' . implode(',', array_fill(0, count($enemyUserIds), '?')) . ')';
            $params = array_merge($params, $enemyUserIds);
        }
        if (!$scope) {
            return false;
        }
        $where[] = '(' . implode(' OR ', $scope) . ')';

        $sql = sprintf(
            'SELECT 1
             FROM colonies c
             JOIN celestial_bodies cb ON cb.id = c.body_id
             LEFT JOIN alliance_members am ON am.user_id = c.user_id
             WHERE %s
             LIMIT 1',
            implode(' AND ', $where)
        );
        $checkStmt = $db->prepare($sql);
        $checkStmt->execute($params);
        return (bool)$checkStmt->fetchColumn();
    } catch (Throwable $e) {
        return false;
    }
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

/**
 * Diplomacy officer AI: improves one strained faction relation toward baseline.
 * Rate-limited to one action per 15 minutes per leader.
 */
function ai_diplomacy_officer_tick(PDO $db, array $leader): ?string {
    $uid = (int)$leader['user_id'];

    if ($leader['last_action_at'] && (time() - strtotime($leader['last_action_at'])) < 900) {
        return null;
    }

    $stmt = $db->prepare(
        'SELECT d.faction_id, d.standing, f.base_diplomacy, f.name
         FROM diplomacy d
         JOIN npc_factions f ON f.id = d.faction_id
         WHERE d.user_id = ? AND d.standing < f.base_diplomacy
         ORDER BY (f.base_diplomacy - d.standing) DESC
         LIMIT 1'
    );
    $stmt->execute([$uid]);
    $target = $stmt->fetch(PDO::FETCH_ASSOC);

    // Fallback: if nothing below baseline, reduce one negative standing by +1.
    if (!$target) {
        $fallback = $db->prepare(
            'SELECT d.faction_id, d.standing, f.base_diplomacy, f.name
             FROM diplomacy d
             JOIN npc_factions f ON f.id = d.faction_id
             WHERE d.user_id = ? AND d.standing < 0
             ORDER BY d.standing ASC
             LIMIT 1'
        );
        $fallback->execute([$uid]);
        $target = $fallback->fetch(PDO::FETCH_ASSOC);
        if (!$target) {
            return null;
        }
    }

    $newStanding = max(-100, min(100, (int)$target['standing'] + 1));
    $eventText = sprintf('[diplomacy] %s opened backchannel talks (+1)', (string)$leader['name']);

    $db->prepare(
        'UPDATE diplomacy
         SET standing = ?, last_event = ?, last_event_at = NOW()
         WHERE user_id = ? AND faction_id = ?'
    )->execute([$newStanding, $eventText, $uid, (int)$target['faction_id']]);

    $msg = sprintf('[%s] Improved standing with %s to %d.', (string)$leader['name'], (string)$target['name'], $newStanding);
    $db->prepare('UPDATE leaders SET last_action=?, last_action_at=NOW() WHERE id=?')
       ->execute([$msg, (int)$leader['id']]);

    leader_award_xp($db, (int)$leader['id'], LEADER_XP['diplomacy_success']);
    return $msg;
}

/**
 * Trade director AI: converts market access into passive resource brokerage.
 * Rate-limited to one action per 15 minutes per leader.
 */
function ai_trade_director_tick(PDO $db, array $leader): ?string {
    $cid = (int)$leader['colony_id'];

    if ($leader['last_action_at'] && (time() - strtotime($leader['last_action_at'])) < 900) {
        return null;
    }

    $cStmt = $db->prepare('SELECT id FROM colonies WHERE id=? AND user_id=? LIMIT 1');
    $cStmt->execute([$cid, (int)$leader['user_id']]);
    if (!$cStmt->fetch()) {
        return null;
    }

    $scale = max(1, (int)$leader['level']);
    $gainMetal = 300 * $scale;
    $gainCrystal = 180 * $scale;
    $gainDeuterium = 90 * $scale;

    $db->prepare(
        'UPDATE colonies
         SET metal = metal + ?, crystal = crystal + ?, deuterium = deuterium + ?
         WHERE id = ?'
    )->execute([$gainMetal, $gainCrystal, $gainDeuterium, $cid]);

    $msg = sprintf(
        '[%s] Closed brokerage deals on colony #%d (+%d M, +%d C, +%d D).',
        (string)$leader['name'],
        $cid,
        $gainMetal,
        $gainCrystal,
        $gainDeuterium
    );
    $db->prepare('UPDATE leaders SET last_action=?, last_action_at=NOW() WHERE id=?')
       ->execute([$msg, (int)$leader['id']]);

    leader_award_xp($db, (int)$leader['id'], LEADER_XP['trade_profit']);
    return $msg;
}

// ─── Marketplace helpers ──────────────────────────────────────────────────────

/**
 * Static pool of candidate archetypes used to generate marketplace listings.
 * Each entry: name, role, rarity, portrait, tagline, backstory, trait_1, trait_2,
 *             plus skill weights per role (normalised 1-10).
 */
function marketplace_pool(): array {
    return [
        // ── Colony Managers ───────────────────────────────────────────────────
        ['name'=>'Mira Solvan',        'role'=>'colony_manager','rarity'=>'common',    'portrait'=>'👷',
         'tagline'=>'"Minerals don\'t lie. People do."',
         'backstory'=>'Former mine supervisor on Kerath IV who transformed a failing dig into the system\'s largest metal exporter. Methodical, no-nonsense, always capped with dust.',
         'trait_1'=>'Efficient Planner','trait_2'=>'Early Riser',
         'skills'=>['prod'=>3,'constr'=>2,'tact'=>1,'nav'=>1,'res'=>1,'eff'=>1,'guid'=>1]],

        ['name'=>'Kaer Dustfoot',      'role'=>'colony_manager','rarity'=>'uncommon',  'portrait'=>'🏗️',
         'tagline'=>'"A colony is only as strong as its foundations."',
         'backstory'=>'Built the first pressurised dome on Vel-Kaarn III using salvaged freighter hulls. Known for improvised solutions that somehow always hold.',
         'trait_1'=>'Resourceful','trait_2'=>'Stubborn Optimist',
         'skills'=>['prod'=>4,'constr'=>5,'tact'=>1,'nav'=>1,'res'=>2,'eff'=>2,'guid'=>1]],

        ['name'=>'Dame Vorrix',        'role'=>'colony_manager','rarity'=>'rare',      'portrait'=>'🌱',
         'tagline'=>'"I turned a desert into a garden. Twice."',
         'backstory'=>'Director of the controversial Velkai Terraforming Project — she caused the crisis, then fixed it. Feared, respected, expensive.',
         'trait_1'=>'Master Terraformer','trait_2'=>'Crisis Response',
         'skills'=>['prod'=>6,'constr'=>7,'tact'=>1,'nav'=>1,'res'=>3,'eff'=>4,'guid'=>2]],

        ['name'=>'The Iron Prefect',   'role'=>'colony_manager','rarity'=>'legendary', 'portrait'=>'🤖',
         'tagline'=>'"Fourteen colonies. One directive: prosper."',
         'backstory'=>'A semi-sentient administrative AI originally deployed to manage the outer rim\'s logistics network. Retired. Un-retired. Retired again. Currently available.',
         'trait_1'=>'Parallel Administration','trait_2'=>'Zero Waste Protocol',
         'skills'=>['prod'=>9,'constr'=>8,'tact'=>1,'nav'=>1,'res'=>4,'eff'=>9,'guid'=>3]],

        // ── Fleet Commanders ──────────────────────────────────────────────────
        ['name'=>'Sarik Blaze',        'role'=>'fleet_commander','rarity'=>'common',   'portrait'=>'⚓',
         'tagline'=>'"Speed wins. Everything else is a footnote."',
         'backstory'=>'Former deep-space freighter captain turned privateer. Has outrun three blockades and only lost two ships doing it.',
         'trait_1'=>'Born Navigator','trait_2'=>'Risk Taker',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>2,'nav'=>4,'res'=>1,'eff'=>1,'guid'=>1]],

        ['name'=>'Nyx Korrigan',       'role'=>'fleet_commander','rarity'=>'uncommon', 'portrait'=>'⚔️',
         'tagline'=>'"Two fleets lost. Zero objectives missed."',
         'backstory'=>'Decorated combat veteran with an unconventional tactical doctrine: absorb the first blow, exploit the chaos. Her crew either loves her or quits.',
         'trait_1'=>'Counter-Assault Specialist','trait_2'=>'Iron Will',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>5,'nav'=>3,'res'=>1,'eff'=>1,'guid'=>1]],

        ['name'=>'Admiral Thane Vel',  'role'=>'fleet_commander','rarity'=>'rare',     'portrait'=>'🚀',
         'tagline'=>'"Battle is geometry. I draw the angles."',
         'backstory'=>'Architect of the Rotating Assault Vector doctrine that broke the Syndicate blockade at Myr-7. Sought after by every warlord in three sectors.',
         'trait_1'=>'Tactical Genius','trait_2'=>'Fleet Coordinator',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>7,'nav'=>6,'res'=>2,'eff'=>2,'guid'=>2]],

        ['name'=>'The Void Witch',     'role'=>'fleet_commander','rarity'=>'legendary','portrait'=>'🌌',
         'tagline'=>'"No one knows her name. She wins anyway."',
         'backstory'=>'Unknown origin. Appears in registries under seventeen different names. Has never lost a fleet engagement. Refuses to explain her methods.',
         'trait_1'=>'Void Instinct','trait_2'=>'Legendary Commander',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>10,'nav'=>9,'res'=>1,'eff'=>1,'guid'=>4]],

        // ── Science Directors ─────────────────────────────────────────────────
        ['name'=>'Prof. Aly Zhen',     'role'=>'science_director','rarity'=>'common',  'portrait'=>'🔬',
         'tagline'=>'"Good science is slow science. Mostly."',
         'backstory'=>'Tenured xenobiology professor who pivoted to applied physics after the university was destroyed. Solid fundamentals, reasonable pace.',
         'trait_1'=>'Methodical Researcher','trait_2'=>'Broad Expertise',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>3,'eff'=>2,'guid'=>1]],

        ['name'=>'Dr. Ravan Tosk',     'role'=>'science_director','rarity'=>'uncommon','portrait'=>'⚗️',
         'tagline'=>'"The probability of failure is inversely proportional to my interest."',
         'backstory'=>'Quantum mechanics specialist with an appetite for high-stakes experimentation. Three lab explosions in his file, each resulting in a breakthrough.',
         'trait_1'=>'Risk Researcher','trait_2'=>'Quantum Intuition',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>5,'eff'=>4,'guid'=>1]],

        ['name'=>'CASS-7',             'role'=>'science_director','rarity'=>'rare',    'portrait'=>'🤖',
         'tagline'=>'"Hypothesis confirmed. As predicted."',
         'backstory'=>'Originally a research coordination AI. Gained partial autonomy after the Tessian Singularity incident. Her research queue is never empty.',
         'trait_1'=>'Parallel Processing','trait_2'=>'Efficiency Matrix',
         'skills'=>['prod'=>2,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>7,'eff'=>8,'guid'=>3]],

        ['name'=>'Elara Novum',        'role'=>'science_director','rarity'=>'legendary','portrait'=>'💡',
         'tagline'=>'"I solved the Tessian Equation at nineteen. What have you done?"',
         'backstory'=>'Child prodigy, youngest ever Galactic Academy Fellow, and the most arrogant person in any room she enters. Results justify the attitude.',
         'trait_1'=>'Theoretical Mastery','trait_2'=>'Research Accelerator',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>10,'eff'=>9,'guid'=>2]],

        // ── Diplomacy Officers ────────────────────────────────────────────────
        ['name'=>'Sessa Kaan',         'role'=>'diplomacy_officer','rarity'=>'common', 'portrait'=>'🤝',
         'tagline'=>'"Listening is 90% of diplomacy."',
         'backstory'=>'Longtime trade mediator who gained a reputation by solving minor faction disputes before they escalated. Pleasant, patient, persistent.',
         'trait_1'=>'Active Listener','trait_2'=>'Trust Builder',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>1,'eff'=>2,'guid'=>2]],

        ['name'=>'Ambassador Vreth',   'role'=>'diplomacy_officer','rarity'=>'rare',   'portrait'=>'🕊️',
         'tagline'=>'"I ended three wars with one dinner party."',
         'backstory'=>'Legendary envoy of the old Republic. Responsible for the Vreth Accords, the Khar-Morr Peace Treaty, and the Velkai Non-Aggression Pact. Retired. For now.',
         'trait_1'=>'Master Negotiator','trait_2'=>'Political Architecture',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>2,'eff'=>3,'guid'=>4]],

        // ── Trade Directors ───────────────────────────────────────────────────
        ['name'=>'Olex Brann',         'role'=>'trade_director','rarity'=>'common',    'portrait'=>'💰',
         'tagline'=>'"Buy low. Sell when they\'re desperate."',
         'backstory'=>'Market speculator turned empire advisor. Reads commodity fluctuations like others read faces. Reliable income, modest ambitions.',
         'trait_1'=>'Market Reader','trait_2'=>'Steady Earner',
         'skills'=>['prod'=>2,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>1,'eff'=>3,'guid'=>1]],

        ['name'=>'Rosa Mercanti',      'role'=>'trade_director','rarity'=>'uncommon',  'portrait'=>'🏪',
         'tagline'=>'"Every colony is a hub waiting to happen."',
         'backstory'=>'Turned three failing outer-rim settlements into profitable trade hubs within a year. Understands that logistics is power.',
         'trait_1'=>'Hub Builder','trait_2'=>'Supply Chain Expert',
         'skills'=>['prod'=>3,'constr'=>2,'tact'=>1,'nav'=>1,'res'=>1,'eff'=>5,'guid'=>1]],

        ['name'=>'Silas Vorn',         'role'=>'trade_director','rarity'=>'rare',      'portrait'=>'📊',
         'tagline'=>'"Information is the only commodity that appreciates by selling."',
         'backstory'=>'Former intelligence analyst who discovered that economic leverage outlasts military force. Builds trading empires one data point at a time.',
         'trait_1'=>'Information Broker','trait_2'=>'Strategic Investor',
         'skills'=>['prod'=>4,'constr'=>2,'tact'=>2,'nav'=>2,'res'=>3,'eff'=>7,'guid'=>3]],

        // ── Advisors ──────────────────────────────────────────────────────────
        ['name'=>'Lumis',              'role'=>'advisor','rarity'=>'common',            'portrait'=>'🧙',
         'tagline'=>'"Every great empire began with one good question."',
         'backstory'=>'Wandering counselor of uncertain origin. Has advised frontier commanders, merchant princes, and at least one pirate king. Speaks little, observes everything.',
         'trait_1'=>'Patient Guide','trait_2'=>'Broad Perspective',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>1,'nav'=>1,'res'=>2,'eff'=>1,'guid'=>4]],

        ['name'=>'Protocol-9',         'role'=>'advisor','rarity'=>'uncommon',          'portrait'=>'🤖',
         'tagline'=>'"My projections have a 94.7% success rate. The other 5.3% were instructive."',
         'backstory'=>'Strategic advisory AI module decommissioned after the Velkai War. Reactivated with slightly fewer ethical constraints. Highly analytical, occasionally alarming.',
         'trait_1'=>'Predictive Analytics','trait_2'=>'Cold Logic',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>2,'nav'=>1,'res'=>3,'eff'=>2,'guid'=>6]],

        ['name'=>'High Seer Valara',   'role'=>'advisor','rarity'=>'rare',              'portrait'=>'🔮',
         'tagline'=>'"Fortune-telling and calculated analysis are the same skill."',
         'backstory'=>'Leader of the Omniscienta oracle conclave who abandoned mysticism for probability theory. Her "visions" are statistically rigorous extrapolations.',
         'trait_1'=>'Strategic Foresight','trait_2'=>'Risk Assessment',
         'skills'=>['prod'=>1,'constr'=>1,'tact'=>2,'nav'=>1,'res'=>4,'eff'=>2,'guid'=>8]],

        ['name'=>'The Ancient',        'role'=>'advisor','rarity'=>'legendary',         'portrait'=>'👁️',
         'tagline'=>'"I have advised 47 civilisations. 46 survived."',
         'backstory'=>'Identity and species unknown. Claims to predate the current galactic age. Speaks in layers of meaning. Every piece of advice has three interpretations — all correct.',
         'trait_1'=>'Civilisation Memory','trait_2'=>'Transcendent Guidance',
         'skills'=>['prod'=>2,'constr'=>2,'tact'=>3,'nav'=>2,'res'=>5,'eff'=>3,'guid'=>10]],
    ];
}

/**
 * Get the user's active marketplace candidates, or generate a fresh batch.
 * Batch expires after 24 hours; up to 10 candidates are shown at once.
 */
function get_or_refresh_marketplace(PDO $db, int $uid): array {
    // Count active (non-expired, non-hired) candidates
    $cnt = $db->prepare(
        'SELECT COUNT(*) FROM leader_marketplace WHERE user_id=? AND is_hired=0 AND expires_at > NOW()'
    );
    $cnt->execute([$uid]);
    $active = (int)$cnt->fetchColumn();

    if ($active === 0) {
        generate_marketplace_candidates($db, $uid);
    }

    $rows = $db->prepare(
        'SELECT * FROM leader_marketplace WHERE user_id=? AND expires_at > NOW() ORDER BY is_hired ASC, rarity DESC, created_at ASC'
    );
    $rows->execute([$uid]);
    return $rows->fetchAll();
}

/**
 * Runtime schema guard so marketplace endpoints stay available even when the
 * optional migration has not been applied yet.
 */
function ensure_leader_marketplace_schema(PDO $db): void {
    static $checked = false;
    if ($checked) {
        return;
    }

    $db->exec(
        "CREATE TABLE IF NOT EXISTS leader_marketplace (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            user_id        INT NOT NULL,
            name           VARCHAR(64)  NOT NULL,
            role           ENUM('colony_manager','fleet_commander','science_director','diplomacy_officer','trade_director','advisor') NOT NULL,
            rarity         ENUM('common','uncommon','rare','legendary') NOT NULL DEFAULT 'common',
            portrait       VARCHAR(8)   NOT NULL DEFAULT '👤',
            tagline        VARCHAR(128) NOT NULL DEFAULT '',
            backstory      TEXT         NOT NULL,
            trait_1        VARCHAR(64)  NOT NULL DEFAULT '',
            trait_2        VARCHAR(64)  NOT NULL DEFAULT '',
            skill_production   TINYINT UNSIGNED NOT NULL DEFAULT 1,
            skill_construction TINYINT UNSIGNED NOT NULL DEFAULT 1,
            skill_tactics      TINYINT UNSIGNED NOT NULL DEFAULT 1,
            skill_navigation   TINYINT UNSIGNED NOT NULL DEFAULT 1,
            skill_research     TINYINT UNSIGNED NOT NULL DEFAULT 1,
            skill_efficiency   TINYINT UNSIGNED NOT NULL DEFAULT 1,
            skill_guidance     TINYINT UNSIGNED NOT NULL DEFAULT 1,
            hire_metal         INT UNSIGNED NOT NULL DEFAULT 5000,
            hire_crystal       INT UNSIGNED NOT NULL DEFAULT 3000,
            hire_deuterium     INT UNSIGNED NOT NULL DEFAULT 1000,
            is_hired       TINYINT(1)   NOT NULL DEFAULT 0,
            hired_at       DATETIME     DEFAULT NULL,
            expires_at     DATETIME     NOT NULL,
            created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_mkt_user_exp (user_id, expires_at)
        ) ENGINE=InnoDB"
    );

    $checked = true;
}

/**
 * Runtime schema guard for optional leader profile columns used by
 * marketplace hiring. Keeps API endpoints resilient if migration was skipped.
 */
function ensure_leaders_marketplace_profile_schema(PDO $db): void {
    static $checked = false;
    if ($checked) {
        return;
    }

    $columns = [
        'rarity' => "ENUM('common','uncommon','rare','legendary') NOT NULL DEFAULT 'common'",
        'portrait' => "VARCHAR(16) NOT NULL DEFAULT '👤'",
        'tagline' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'backstory' => 'TEXT NULL',
        'trait_1' => "VARCHAR(128) NOT NULL DEFAULT ''",
        'trait_2' => "VARCHAR(128) NOT NULL DEFAULT ''",
        'skill_production' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'skill_construction' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'skill_tactics' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'skill_navigation' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'skill_research' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'skill_efficiency' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'skill_guidance' => 'TINYINT UNSIGNED NOT NULL DEFAULT 1',
        'marketplace_source_id' => 'INT NULL',
    ];

    $colExists = $db->prepare(
        'SELECT COUNT(*)
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = "leaders"
            AND COLUMN_NAME = ?'
    );

    foreach ($columns as $name => $ddl) {
        $colExists->execute([$name]);
        $exists = (int)$colExists->fetchColumn() > 0;
        if ($exists) {
            continue;
        }
        $db->exec("ALTER TABLE leaders ADD COLUMN {$name} {$ddl}");
    }

    $checked = true;
}

/**
 * Generate a fresh set of 10 marketplace candidates for the given user.
 * Picks randomly from the static pool (weighted by rarity), with skill variance.
 */
function generate_marketplace_candidates(PDO $db, int $uid): void {
    // Delete old expired candidates
    $db->prepare('DELETE FROM leader_marketplace WHERE user_id=? AND expires_at < NOW() AND is_hired=0')
       ->execute([$uid]);

    $pool        = marketplace_pool();
    $expires     = date('Y-m-d H:i:s', time() + 86400); // 24 h
    $count       = 0;
    $maxCandidates = 10;

    // Shuffle so each refresh gives different results
    shuffle($pool);

    // Rarity distribution: ~5 common, 3 uncommon, 2 rare, 0-1 legendary
    $rarityBudget = ['common' => 5, 'uncommon' => 3, 'rare' => 2, 'legendary' => 1];
    $rarityCount  = ['common' => 0, 'uncommon' => 0, 'rare' => 0, 'legendary' => 0];

    // Cost multiplier per rarity
    $costMult = ['common' => 1.0, 'uncommon' => 1.5, 'rare' => 2.5, 'legendary' => 5.0];

    // Base costs per role
    $baseCost = [
        'colony_manager'    => ['metal' => 5000,  'crystal' => 3000,  'deuterium' => 1000],
        'fleet_commander'   => ['metal' => 8000,  'crystal' => 5000,  'deuterium' => 2000],
        'science_director'  => ['metal' => 4000,  'crystal' => 8000,  'deuterium' => 4000],
        'diplomacy_officer' => ['metal' => 4500,  'crystal' => 4500,  'deuterium' => 1500],
        'trade_director'    => ['metal' => 6500,  'crystal' => 3500,  'deuterium' => 2500],
        'advisor'           => ['metal' => 0,     'crystal' => 0,     'deuterium' => 0],
    ];

    foreach ($pool as $tmpl) {
        if ($count >= $maxCandidates) break;

        $rarity = $tmpl['rarity'];
        if ($rarityCount[$rarity] >= $rarityBudget[$rarity]) continue;
        $rarityCount[$rarity]++;
        $count++;

        // Skill variance: ±1 around template values (clamped 1-10)
        $sv = function(int $base) use ($rarity): int {
            $variance = $rarity === 'legendary' ? 0 : random_int(-1, 1);
            return max(1, min(10, $base + $variance));
        };

        $bc  = $baseCost[$tmpl['role']];
        $mult = $costMult[$rarity];
        $db->prepare(
            'INSERT INTO leader_marketplace
                (user_id, name, role, rarity, portrait, tagline, backstory, trait_1, trait_2,
                 skill_production, skill_construction, skill_tactics, skill_navigation,
                 skill_research, skill_efficiency, skill_guidance,
                 hire_metal, hire_crystal, hire_deuterium, expires_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $uid,
            $tmpl['name'],
            $tmpl['role'],
            $tmpl['rarity'],
            $tmpl['portrait'],
            $tmpl['tagline'],
            $tmpl['backstory'],
            $tmpl['trait_1'],
            $tmpl['trait_2'],
            $sv($tmpl['skills']['prod']),
            $sv($tmpl['skills']['constr']),
            $sv($tmpl['skills']['tact']),
            $sv($tmpl['skills']['nav']),
            $sv($tmpl['skills']['res']),
            $sv($tmpl['skills']['eff']),
            $sv($tmpl['skills']['guid']),
            (int)round($bc['metal']     * $mult),
            (int)round($bc['crystal']   * $mult),
            (int)round($bc['deuterium'] * $mult),
            $expires,
        ]);
    }
}

// ─── Advisor Analysis ─────────────────────────────────────────────────────────

/**
 * Examine the player's game state and emit/refresh advisor hints.
 * Hints are identified by hint_code – existing codes are updated, new ones inserted.
 */
function run_advisor_analysis(PDO $db, int $uid, array $advisor): void {
    $lid = (int)$advisor['id'];

    $colonies = $db->prepare(
        'SELECT c.*, cb.galaxy_index AS galaxy, cb.system_index AS `system`, cb.position
         FROM colonies c
         JOIN celestial_bodies cb ON cb.id = c.body_id
         WHERE c.user_id=?'
    );
    $colonies->execute([$uid]);
    $colonies = $colonies->fetchAll();

    foreach ([
        'check_storage_full'     => fn() => adv_check_storage_full($db, $uid, $lid, $colonies),
        'check_no_research'      => fn() => adv_check_no_research($db, $uid, $lid),
        'check_no_buildings'     => fn() => adv_check_no_buildings($db, $uid, $lid, $colonies),
        'check_unassigned_leaders'=> fn()=> adv_check_unassigned_leaders($db, $uid, $lid),
        'check_tutorial_progress'=> fn() => adv_check_tutorial_progress($db, $uid, $lid),
        'check_no_fleet'         => fn() => adv_check_no_fleet($db, $uid, $lid),
        'check_low_diplomacy'    => fn() => adv_check_low_diplomacy($db, $uid, $lid),
        'check_incoming_fleet'   => fn() => adv_check_incoming_fleet($db, $uid, $lid),
    ] as $code => $fn) {
        try {
            $fn();
        } catch (\Throwable $e) {
            // hints are optional; never crash the game
        }
    }
}

function adv_upsert(PDO $db, int $uid, int $lid, string $code, string $type,
                    string $title, string $body,
                    ?string $actionLabel = null, ?string $actionWindow = null): void {
    // Dismiss any old version first, then insert fresh (keeps created_at current)
    $db->prepare(
        'INSERT INTO advisor_hints (user_id, leader_id, hint_code, hint_type, title, body, action_label, action_window)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            hint_type=VALUES(hint_type), title=VALUES(title), body=VALUES(body),
            action_label=VALUES(action_label), action_window=VALUES(action_window),
            dismissed=0, created_at=NOW()'
    )->execute([$uid, $lid, $code, $type, $title, $body, $actionLabel, $actionWindow]);
}

function adv_resolve(PDO $db, int $uid, int $lid, string $code): void {
    $db->prepare('UPDATE advisor_hints SET dismissed=1 WHERE user_id=? AND leader_id=? AND hint_code=?')
       ->execute([$uid, $lid, $code]);
}

function adv_check_storage_full(PDO $db, int $uid, int $lid, array $colonies): void {
    foreach ($colonies as $col) {
        // Storage caps default to 500 000 (upgrade raises cap, but we use a simple heuristic)
        $cap = 500000;
        if ((float)$col['metal'] / $cap > 0.85 || (float)$col['crystal'] / $cap > 0.85) {
            adv_upsert($db, $uid, $lid, 'storage_full_' . $col['id'], 'warning',
                '⚠️ Storage Almost Full',
                "Colony \"{$col['name']}\" [{$col['galaxy']}:{$col['system']}:{$col['position']}] is nearly full. Start a building upgrade or send resources to a colony with space.",
                'Open Colony', 'colony');
            return;
        }
    }
    adv_resolve($db, $uid, $lid, 'storage_full_' . ($colonies[0]['id'] ?? 0));
}

function adv_check_no_research(PDO $db, int $uid, int $lid): void {
    $active = $db->prepare('SELECT COUNT(*) FROM research WHERE user_id=? AND research_end IS NOT NULL');
    $active->execute([$uid]);
    if ((int)$active->fetchColumn() === 0) {
        adv_upsert($db, $uid, $lid, 'no_research', 'tip',
            '🔬 No Research Running',
            'Your laboratories are idle. Open the Research tab and start a new technology to gain advantages.',
            'Open Research', 'research');
    } else {
        adv_resolve($db, $uid, $lid, 'no_research');
    }
}

function adv_check_no_buildings(PDO $db, int $uid, int $lid, array $colonies): void {
    foreach ($colonies as $col) {
        $busy = $db->prepare('SELECT COUNT(*) FROM buildings WHERE colony_id=? AND upgrade_end IS NOT NULL');
        $busy->execute([$col['id']]);
        if ((int)$busy->fetchColumn() === 0) {
            adv_upsert($db, $uid, $lid, 'no_buildings_' . $col['id'], 'tip',
                '🏗️ No Construction in Progress',
                "Colony \"{$col['name']}\" has no active construction. Keep your builders busy — every level of Metal Mine, Crystal Mine and Solar Plant compounds over time.",
                'Open Buildings', 'buildings');
            return;
        }
    }
    // All colonies have something building; resolve the hint
    foreach ($colonies as $col) {
        adv_resolve($db, $uid, $lid, 'no_buildings_' . $col['id']);
    }
}

function adv_check_unassigned_leaders(PDO $db, int $uid, int $lid): void {
    $unassigned = $db->prepare(
        'SELECT COUNT(*) FROM leaders WHERE user_id=? AND role != "advisor" AND colony_id IS NULL AND fleet_id IS NULL'
    );
    $unassigned->execute([$uid]);
    $n = (int)$unassigned->fetchColumn();
    if ($n > 0) {
        adv_upsert($db, $uid, $lid, 'unassigned_leaders', 'action_required',
            '👤 Leaders Awaiting Assignment',
            "You have $n leader(s) not yet assigned to a colony or fleet. Assigned leaders provide passive bonuses even at Autonomy: Off.",
            'Open Leaders', 'leaders');
    } else {
        adv_resolve($db, $uid, $lid, 'unassigned_leaders');
    }
}

function adv_check_tutorial_progress(PDO $db, int $uid, int $lid): void {
    $pending = $db->prepare(
        'SELECT a.title, a.description, a.code, a.reward_metal, a.reward_crystal, a.reward_deuterium
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         WHERE ua.user_id=? AND ua.completed=0 AND a.category="tutorial"
         ORDER BY a.sort_order ASC LIMIT 1'
    );
    $pending->execute([$uid]);
    $quest = $pending->fetch();
    if ($quest) {
        $reward = [];
        if ($quest['reward_metal'])     $reward[] = number_format($quest['reward_metal']) . ' ⬡';
        if ($quest['reward_crystal'])   $reward[] = number_format($quest['reward_crystal']) . ' 💎';
        if ($quest['reward_deuterium']) $reward[] = number_format($quest['reward_deuterium']) . ' 🔵';
        $rewardStr = $reward ? ' Reward: ' . implode(', ', $reward) . '.' : '';
        adv_upsert($db, $uid, $lid, 'tutorial_' . $quest['code'], 'quest_hint',
            '📋 Quest: ' . $quest['title'],
            $quest['description'] . $rewardStr,
            'Open Quests', 'quests');
    } else {
        // All tutorial quests done – emit a congratulations hint (once)
        adv_upsert($db, $uid, $lid, 'tutorial_complete', 'tip',
            '🏆 All Tutorial Quests Complete!',
            'You\'ve finished every tutorial objective. The galaxy is yours to explore. Visit the Quests tab for faction quests and milestone challenges.',
            'Open Quests', 'quests');
    }
}

function adv_check_no_fleet(PDO $db, int $uid, int $lid): void {
    $ships = $db->prepare(
        'SELECT SUM(count) FROM ships s JOIN colonies c ON c.id=s.colony_id WHERE c.user_id=?'
    );
    $ships->execute([$uid]);
    $total = (int)$ships->fetchColumn();
    if ($total === 0) {
        adv_upsert($db, $uid, $lid, 'no_fleet', 'tip',
            '🚀 No Ships Built',
            'Your shipyards are empty. Build fighters, scouts or spy probes to defend your colonies and explore the galaxy.',
            'Open Shipyard', 'shipyard');
    } else {
        adv_resolve($db, $uid, $lid, 'no_fleet');
    }
}

function adv_check_low_diplomacy(PDO $db, int $uid, int $lid): void {
    $bad = $db->prepare(
        'SELECT f.name, d.standing FROM diplomacy d JOIN npc_factions f ON f.id=d.faction_id
         WHERE d.user_id=? AND d.standing < -30 ORDER BY d.standing ASC LIMIT 1'
    );
    $bad->execute([$uid]);
    $faction = $bad->fetch();
    if ($faction) {
        adv_upsert($db, $uid, $lid, 'low_diplomacy', 'warning',
            '⚠️ Hostile Faction',
            "Your standing with {$faction['name']} has fallen to {$faction['standing']}. A Diplomacy Officer or peaceful trade can recover relations before they escalate to war.",
            'Open Factions', 'factions');
    } else {
        adv_resolve($db, $uid, $lid, 'low_diplomacy');
    }
}

function adv_check_incoming_fleet(PDO $db, int $uid, int $lid): void {
    $incoming = $db->prepare(
        'SELECT COUNT(*) FROM fleets f
                 JOIN celestial_bodies cb ON cb.galaxy_index=f.target_galaxy AND cb.system_index=f.target_system AND cb.position=f.target_position
                 JOIN colonies c ON c.body_id=cb.id
         WHERE c.user_id=? AND f.user_id != ? AND f.returning=0 AND f.mission IN ("attack","destroy")
           AND f.arrival_time > NOW()'
    );
    $incoming->execute([$uid, $uid]);
    $n = (int)$incoming->fetchColumn();
    if ($n > 0) {
        adv_upsert($db, $uid, $lid, 'incoming_attack', 'warning',
            '🚨 Incoming Hostile Fleet!',
            "$n hostile fleet(s) are approaching your colonies. Move your ships or deploy defenders immediately.",
            'Open Fleet', 'fleet');
    } else {
        adv_resolve($db, $uid, $lid, 'incoming_attack');
    }
}
