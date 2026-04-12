<?php
/**
 * Diplomatic Plays API — Sprint 3.2: 4-Phase Escalation System
 *
 * Implements the escalation model:
 *   Cooperation → Threat → Ultimatum → War
 *
 * GET  ?action=list                      – all active plays for the current user
 * GET  ?action=list&faction_id=N         – plays with a specific faction
 * GET  ?action=trust_threat&faction_id=N – trust / threat axes for one faction
 * POST ?action=propose_play              – open a play (Cooperation phase)
 * POST ?action=counter_play              – escalate to Threat phase
 * POST ?action=mobilize                  – escalate to Ultimatum phase
 * POST ?action=resolve                   – resolve the play (deal or war)
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';

require_auth();
$uid    = $_SESSION['user_id'];
$action = sanitize_input($_REQUEST['action'] ?? '');

// ── Constants ─────────────────────────────────────────────────────────────────

const DP_TRUST_TRADE_BONUS        =  5;   // per active trade agreement
const DP_TRUST_COOPERATION_BONUS  =  3;   // for successful cooperation phase
const DP_TRUST_MAX                = 100.0;
const DP_TRUST_MIN                = -100.0;

const DP_THREAT_WAR_DECLARATION   = 25;   // +25 when war is declared
const DP_THREAT_ULTIMATUM         = 10;   // +10 on entering ultimatum
const DP_THREAT_MAX               = 100.0;
const DP_THREAT_MIN               =   0.0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function dp_get_trust_threat(PDO $db, int $uid, int $faction_id): array
{
    $stmt = $db->prepare('
        SELECT trust_level, threat_level
        FROM   diplomacy
        WHERE  user_id = ? AND faction_id = ?
    ');
    $stmt->execute([$uid, $faction_id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return [
        'trust'  => $row ? (float)$row['trust_level']  : 0.0,
        'threat' => $row ? (float)$row['threat_level'] : 0.0,
    ];
}

function dp_update_trust_threat(PDO $db, int $uid, int $faction_id,
                                float $trust_delta, float $threat_delta): void
{
    if ($trust_delta === 0.0 && $threat_delta === 0.0) {
        return;
    }
    $db->prepare('
        INSERT INTO diplomacy (user_id, faction_id, standing, trust_level, threat_level)
        VALUES (:uid, :fid, 0, :tr, :th)
        ON DUPLICATE KEY UPDATE
            trust_level  = LEAST(:tmax, GREATEST(:tmin, trust_level  + :trd)),
            threat_level = LEAST(:thmax, GREATEST(:thmin, threat_level + :thd))
    ')->execute([
        'uid'   => $uid,
        'fid'   => $faction_id,
        'tr'    => min(DP_TRUST_MAX,  max(DP_TRUST_MIN,  $trust_delta)),
        'th'    => min(DP_THREAT_MAX, max(DP_THREAT_MIN, $threat_delta)),
        'trd'   => $trust_delta,
        'thd'   => $threat_delta,
        'tmax'  => DP_TRUST_MAX,
        'tmin'  => DP_TRUST_MIN,
        'thmax' => DP_THREAT_MAX,
        'thmin' => DP_THREAT_MIN,
    ]);
}

function dp_get_faction(PDO $db, int $faction_id): ?array
{
    $stmt = $db->prepare('SELECT id, name, icon, color, aggression FROM npc_factions WHERE id = ?');
    $stmt->execute([$faction_id]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

function dp_get_play(PDO $db, int $play_id, int $uid): ?array
{
    $stmt = $db->prepare('
        SELECT dp.*, nf.name AS faction_name, nf.icon AS faction_icon, nf.aggression
        FROM   diplomatic_plays dp
        JOIN   npc_factions nf ON nf.id = dp.faction_id
        WHERE  dp.id = ? AND dp.initiator_uid = ?
    ');
    $stmt->execute([$play_id, $uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }
    $row['player_demands']  = json_decode($row['player_demands'],  true) ?? [];
    $row['faction_demands'] = json_decode($row['faction_demands'], true) ?? [];
    return $row;
}

/**
 * Simple AI acceptance model for diplomatic plays.
 *
 * Returns probability 0–100 that the NPC accepts the player's demands.
 */
function dp_ai_accept_pct(float $trust, float $threat, int $aggression, string $phase): int
{
    // Base from trust (positive trust helps; negative trust hurts)
    $base = 50 + (int)($trust * 0.3);

    // Threat makes faction less cooperative
    $base -= (int)($threat * 0.25);

    // Phase modifier: each escalation makes acceptance harder
    $phase_penalty = match ($phase) {
        'cooperation' => 0,
        'threat'      => 15,
        'ultimatum'   => 30,
        default       => 50,
    };
    $base -= $phase_penalty;

    // Aggressive factions are always harder to deal with
    $base -= (int)(($aggression / 100) * 20);

    return max(5, min(95, (int)$base));
}

// ── Action handlers ───────────────────────────────────────────────────────────

function handle_list(PDO $db, int $uid): array
{
    $faction_id = isset($_GET['faction_id']) ? (int)$_GET['faction_id'] : 0;

    $sql = '
        SELECT dp.*,
               nf.name  AS faction_name,
               nf.icon  AS faction_icon,
               nf.color AS faction_color
        FROM   diplomatic_plays dp
        JOIN   npc_factions nf ON nf.id = dp.faction_id
        WHERE  dp.initiator_uid = :uid
    ';
    $params = ['uid' => $uid];
    if ($faction_id > 0) {
        $sql   .= ' AND dp.faction_id = :fid';
        $params['fid'] = $faction_id;
    }
    $sql .= ' ORDER BY dp.updated_at DESC LIMIT 50';

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$row) {
        $row['player_demands']  = json_decode($row['player_demands'],  true) ?? [];
        $row['faction_demands'] = json_decode($row['faction_demands'], true) ?? [];
    }
    unset($row);

    return ['success' => true, 'plays' => $rows];
}

function handle_trust_threat(PDO $db, int $uid): array
{
    $faction_id = isset($_GET['faction_id']) ? (int)$_GET['faction_id'] : 0;
    if ($faction_id <= 0) {
        return ['success' => false, 'error' => 'Invalid faction_id'];
    }
    $axes = dp_get_trust_threat($db, $uid, $faction_id);
    return ['success' => true, 'faction_id' => $faction_id] + $axes;
}

function handle_propose_play(PDO $db, int $uid): array
{
    $body           = json_decode(file_get_contents('php://input'), true) ?? [];
    $faction_id     = (int)($body['faction_id'] ?? 0);
    $goal_type      = trim((string)($body['goal_type'] ?? 'diplomatic'));
    $player_demands = is_array($body['player_demands']  ?? null) ? $body['player_demands']  : [];
    $faction_demands= is_array($body['faction_demands'] ?? null) ? $body['faction_demands'] : [];

    $valid_goals = ['diplomatic', 'territorial', 'tribute', 'release_claims', 'humiliation'];
    if ($faction_id <= 0) {
        return ['success' => false, 'error' => 'Invalid faction_id'];
    }
    if (!in_array($goal_type, $valid_goals, true)) {
        return ['success' => false, 'error' => 'Unknown goal_type'];
    }

    if (!dp_get_faction($db, $faction_id)) {
        return ['success' => false, 'error' => 'Faction not found'];
    }

    // Only one active play per faction at a time
    $dup = $db->prepare('
        SELECT id FROM diplomatic_plays
        WHERE initiator_uid = ? AND faction_id = ? AND status = "active"
        LIMIT 1
    ');
    $dup->execute([$uid, $faction_id]);
    if ($dup->fetchColumn()) {
        return ['success' => false, 'error' => 'An active diplomatic play already exists with this faction.'];
    }

    $axes = dp_get_trust_threat($db, $uid, $faction_id);
    $now  = date('Y-m-d H:i:s');

    $ins = $db->prepare('
        INSERT INTO diplomatic_plays
            (initiator_uid, faction_id, phase, status, goal_type,
             player_demands, faction_demands,
             cooperation_at, trust_snapshot, threat_snapshot)
        VALUES
            (:uid, :fid, "cooperation", "active", :goal,
             :pd, :fd,
             :now, :tr, :th)
    ');
    $ins->execute([
        'uid'  => $uid,
        'fid'  => $faction_id,
        'goal' => $goal_type,
        'pd'   => json_encode($player_demands),
        'fd'   => json_encode($faction_demands),
        'now'  => $now,
        'tr'   => $axes['trust'],
        'th'   => $axes['threat'],
    ]);
    $play_id = (int)$db->lastInsertId();

    // Cooperation phase: small trust boost
    dp_update_trust_threat($db, $uid, $faction_id, DP_TRUST_COOPERATION_BONUS, 0.0);

    return ['success' => true, 'play_id' => $play_id, 'phase' => 'cooperation'];
}

function handle_counter_play(PDO $db, int $uid): array
{
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $play_id = (int)($body['play_id'] ?? 0);
    $counter_demands = is_array($body['counter_demands'] ?? null) ? $body['counter_demands'] : [];

    if ($play_id <= 0) {
        return ['success' => false, 'error' => 'Invalid play_id'];
    }
    $play = dp_get_play($db, $play_id, $uid);
    if (!$play) {
        return ['success' => false, 'error' => 'Play not found'];
    }
    if ($play['status'] !== 'active') {
        return ['success' => false, 'error' => 'Play is not active'];
    }
    if ($play['phase'] !== 'cooperation') {
        return ['success' => false, 'error' => 'Can only issue a counter from the cooperation phase'];
    }

    $now = date('Y-m-d H:i:s');
    $db->prepare('
        UPDATE diplomatic_plays
        SET phase = "threat", threat_at = ?, faction_demands = ?, updated_at = ?
        WHERE id = ?
    ')->execute([$now, json_encode($counter_demands), $now, $play_id]);

    // Escalating to threat phase increases threat level, reduces trust
    dp_update_trust_threat($db, $uid, (int)$play['faction_id'], -5.0, 10.0);

    return ['success' => true, 'play_id' => $play_id, 'phase' => 'threat'];
}

function handle_mobilize(PDO $db, int $uid): array
{
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $play_id = (int)($body['play_id'] ?? 0);

    if ($play_id <= 0) {
        return ['success' => false, 'error' => 'Invalid play_id'];
    }
    $play = dp_get_play($db, $play_id, $uid);
    if (!$play) {
        return ['success' => false, 'error' => 'Play not found'];
    }
    if ($play['status'] !== 'active') {
        return ['success' => false, 'error' => 'Play is not active'];
    }
    if ($play['phase'] !== 'threat') {
        return ['success' => false, 'error' => 'Can only mobilize from the threat phase'];
    }

    $now = date('Y-m-d H:i:s');
    $db->prepare('
        UPDATE diplomatic_plays
        SET phase = "ultimatum", ultimatum_at = ?, updated_at = ?
        WHERE id = ?
    ')->execute([$now, $now, $play_id]);

    // Ultimatum: significant threat spike, trust erosion
    dp_update_trust_threat($db, $uid, (int)$play['faction_id'], -10.0, DP_THREAT_ULTIMATUM);

    return ['success' => true, 'play_id' => $play_id, 'phase' => 'ultimatum'];
}

function handle_resolve(PDO $db, int $uid): array
{
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $play_id = (int)($body['play_id'] ?? 0);
    $choice  = trim((string)($body['choice'] ?? ''));   // 'deal' | 'war' | 'withdrawal'

    $valid_choices = ['deal', 'war', 'withdrawal'];
    if ($play_id <= 0) {
        return ['success' => false, 'error' => 'Invalid play_id'];
    }
    if (!in_array($choice, $valid_choices, true)) {
        return ['success' => false, 'error' => 'choice must be deal, war, or withdrawal'];
    }

    $play = dp_get_play($db, $play_id, $uid);
    if (!$play) {
        return ['success' => false, 'error' => 'Play not found'];
    }
    if ($play['status'] !== 'active') {
        return ['success' => false, 'error' => 'Play is not active'];
    }

    $faction = dp_get_faction($db, (int)$play['faction_id']);

    // ── AI decides whether to accept the deal ────────────────────────────────
    $ai_accepted = false;
    if ($choice === 'deal') {
        $axes    = dp_get_trust_threat($db, $uid, (int)$play['faction_id']);
        $accept_pct = dp_ai_accept_pct(
            $axes['trust'], $axes['threat'],
            (int)($faction['aggression'] ?? 50),
            $play['phase'],
        );
        $ai_accepted = mt_rand(1, 100) <= $accept_pct;
        if (!$ai_accepted) {
            // AI rejects the deal → auto-escalate toward war
            $choice = 'war';
        }
    }

    $now     = date('Y-m-d H:i:s');
    $outcome = $choice === 'deal' ? 'deal' : ($choice === 'war' ? 'war' : 'withdrawal');

    $db->prepare('
        UPDATE diplomatic_plays
        SET status = "resolved", phase = "war", outcome = ?, resolved_at = ?, updated_at = ?
        WHERE id = ?
    ')->execute([$outcome, $now, $now, $play_id]);

    // Apply game-system effects
    $standing_delta = 0;
    $trust_delta    = 0.0;
    $threat_delta   = 0.0;

    switch ($outcome) {
        case 'deal':
            $standing_delta = 15;
            $trust_delta    = 10.0;
            $threat_delta   = -5.0;
            break;
        case 'war':
            $standing_delta = -30;
            $trust_delta    = -20.0;
            $threat_delta   = DP_THREAT_WAR_DECLARATION;
            // Insert war record if wars table exists
            _dp_declare_war($db, $uid, (int)$play['faction_id'], $play_id);
            break;
        case 'withdrawal':
            $standing_delta = -5;
            $trust_delta    = -3.0;
            break;
    }

    // Apply standing change
    if ($standing_delta !== 0) {
        $db->prepare('
            INSERT INTO diplomacy (user_id, faction_id, standing, last_event, last_event_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                standing      = LEAST(100, GREATEST(-100, standing + VALUES(standing))),
                last_event    = VALUES(last_event),
                last_event_at = VALUES(last_event_at)
        ')->execute([
            $uid,
            $play['faction_id'],
            $standing_delta,
            'Diplomatic play resolved: ' . $outcome,
            $now,
        ]);
    }

    dp_update_trust_threat($db, $uid, (int)$play['faction_id'], $trust_delta, $threat_delta);

    return [
        'success'        => true,
        'play_id'        => $play_id,
        'outcome'        => $outcome,
        'standing_delta' => $standing_delta,
        'trust_delta'    => $trust_delta,
        'threat_delta'   => $threat_delta,
        'ai_accepted'    => $ai_accepted,
    ];
}

/**
 * Attempt to insert a war record when a play resolves as war.
 * Gracefully skips if the wars table does not exist or the record is a duplicate.
 */
function _dp_declare_war(PDO $db, int $uid, int $faction_id, int $play_id): void
{
    try {
        // Check if pvp_conflicts / wars table exists (combat module optional)
        $check = $db->query("SHOW TABLES LIKE 'wars'")->fetchColumn();
        if (!$check) {
            return;
        }
        $db->prepare('
            INSERT IGNORE INTO wars
                (attacker_uid, defender_faction_id, status, cause, cause_ref_id, started_at)
            VALUES
                (?, ?, "active", "diplomatic_play", ?, NOW())
        ')->execute([$uid, $faction_id, $play_id]);
    } catch (Throwable) {
        // Non-fatal: war table may have a different schema
    }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

try {
    $db = get_db();
    switch ($action) {
        case 'list':          json_out(handle_list($db, $uid));          break;
        case 'trust_threat':  json_out(handle_trust_threat($db, $uid));  break;
        case 'propose_play':  json_out(handle_propose_play($db, $uid));  break;
        case 'counter_play':  json_out(handle_counter_play($db, $uid));  break;
        case 'mobilize':      json_out(handle_mobilize($db, $uid));      break;
        case 'resolve':       json_out(handle_resolve($db, $uid));       break;
        default:              json_out(['success' => false, 'error' => 'Unknown action']);
    }
} catch (Throwable $e) {
    json_out(['success' => false, 'error' => $e->getMessage()]);
}
