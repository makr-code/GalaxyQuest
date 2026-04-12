<?php
/**
 * Faction Agreements / Treaty API
 *
 * Victoria 3-inspired bilateral contract system between a player and NPC factions.
 *
 * GET  ?action=list                    – all agreements for the current user
 * GET  ?action=list&faction_id=N       – agreements with a specific faction
 * GET  ?action=types                   – static catalogue of agreement types
 * POST ?action=propose                 – draft + submit a new agreement
 * POST ?action=respond                 – NPC AI auto-responds (accept/reject)
 * POST ?action=cancel                  – cancel an active agreement
 */

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';

require_auth();
$uid = $_SESSION['user_id'];
$action = sanitize_input($_REQUEST['action'] ?? '');

// ─── Static catalogue ────────────────────────────────────────────────────────

function get_agreement_types(): array {
    return [
        [
            'code'                => 'non_aggression',
            'label'               => 'Non-Aggression Pact',
            'icon'                => '🤝',
            'description'         => 'Both parties agree not to attack each other for the duration.',
            'min_standing'        => -30,
            'standing_reward'     => 8,
            'default_duration'    => 3,
            'player_offer_slots'  => [],
            'faction_demand_templates' => [
                ['term' => 'no_attacks', 'label' => 'No military incursions'],
            ],
        ],
        [
            'code'                => 'trade',
            'label'               => 'Trade Agreement',
            'icon'                => '💰',
            'description'         => 'Establishes preferential trade terms. Improves resource exchange rates.',
            'min_standing'        => -10,
            'standing_reward'     => 12,
            'default_duration'    => 3,
            'player_offer_slots'  => [
                ['term' => 'trade_route', 'label' => 'Open trade route'],
                ['term' => 'resource_metal',    'label' => 'Metal per cycle',    'resource' => 'metal'],
                ['term' => 'resource_crystal',  'label' => 'Crystal per cycle',  'resource' => 'crystal'],
            ],
            'faction_demand_templates' => [
                ['term' => 'trade_route',     'label' => 'Reciprocal trade route'],
                ['term' => 'resource_access', 'label' => 'Raw material access'],
            ],
        ],
        [
            'code'                => 'research',
            'label'               => 'Research Agreement',
            'icon'                => '🔬',
            'description'         => 'Joint research cooperation. Boosts research speed for both parties.',
            'min_standing'        => 10,
            'standing_reward'     => 15,
            'default_duration'    => 6,
            'player_offer_slots'  => [
                ['term' => 'research_data', 'label' => 'Share research data'],
                ['term' => 'scientist_exchange', 'label' => 'Scientist exchange program'],
            ],
            'faction_demand_templates' => [
                ['term' => 'tech_sharing',  'label' => 'Technology sharing'],
                ['term' => 'lab_access',    'label' => 'Laboratory access'],
            ],
        ],
        [
            'code'                => 'alliance',
            'label'               => 'Military Alliance',
            'icon'                => '⚔️',
            'description'         => 'Full military alliance. Mutual defence, fleet coordination, shared intelligence.',
            'min_standing'        => 50,
            'standing_reward'     => 25,
            'default_duration'    => null,
            'player_offer_slots'  => [
                ['term' => 'mutual_defence',    'label' => 'Mutual defence clause'],
                ['term' => 'transit_rights',    'label' => 'Transit rights'],
                ['term' => 'fleet_support',     'label' => 'Fleet support pledge'],
            ],
            'faction_demand_templates' => [
                ['term' => 'mutual_defence',    'label' => 'Mutual defence clause'],
                ['term' => 'military_access',   'label' => 'Military base access'],
            ],
        ],
    ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fa_get_standing(PDO $db, int $uid, int $faction_id): int {
    $stmt = $db->prepare('SELECT standing FROM diplomacy WHERE user_id = ? AND faction_id = ?');
    $stmt->execute([$uid, $faction_id]);
    return (int)($stmt->fetchColumn() ?? 0);
}

function fa_get_type(string $code): ?array {
    foreach (get_agreement_types() as $t) {
        if ($t['code'] === $code) return $t;
    }
    return null;
}

/**
 * Simple AI acceptance model:
 *   base = type min_standing threshold × 0.5
 *   standing delta from faction's min_standing  → positive push
 *   leverage_score (player debt) → negative modifier
 *   aggression of faction        → negative modifier
 *   trust_level (0–100)          → positive modifier (up to +15)
 *   threat_level (0–100)         → negative modifier (up to -20)
 */
function fa_ai_acceptance(array $type, int $standing, int $leverage, int $aggression,
                          float $trust = 0.0, float $threat = 0.0): int {
    $min = (int)($type['min_standing'] ?? 0);
    $gap = $standing - $min;                       // how far above the gate
    $base = 40 + min(40, max(-40, $gap));           // 0–80
    $base -= (int)($leverage * 0.3);               // leverage reduces willingness
    $base -= (int)(($aggression / 100) * 20);      // aggressive factions are harder
    $base += (int)(($trust  / 100) * 15);          // high trust boosts acceptance
    $base -= (int)(($threat / 100) * 20);          // high threat reduces acceptance
    return max(5, min(95, (int)$base));
}

// ─── Action handlers ─────────────────────────────────────────────────────────

function handle_list(PDO $db, int $uid): array {
    $faction_id = isset($_GET['faction_id']) ? (int)$_GET['faction_id'] : 0;

    $sql = '
        SELECT fa.*, nf.name AS faction_name, nf.icon AS faction_icon, nf.color AS faction_color
        FROM   faction_agreements fa
        JOIN   npc_factions nf ON nf.id = fa.faction_id
        WHERE  fa.user_id = :uid
    ';
    $params = ['uid' => $uid];
    if ($faction_id > 0) {
        $sql .= ' AND fa.faction_id = :fid';
        $params['fid'] = $faction_id;
    }
    $sql .= ' ORDER BY fa.proposed_at DESC LIMIT 100';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Decode JSON blobs
    foreach ($rows as &$row) {
        $row['player_offer']   = json_decode($row['player_offer'],   true) ?? [];
        $row['faction_demand'] = json_decode($row['faction_demand'],  true) ?? [];
    }
    unset($row);

    return ['success' => true, 'agreements' => $rows];
}

function handle_types(): array {
    return ['success' => true, 'types' => get_agreement_types()];
}

function handle_propose(PDO $db, int $uid): array {
    $body          = json_decode(file_get_contents('php://input'), true) ?? [];
    $faction_id    = (int)($body['faction_id'] ?? 0);
    $type_code     = trim(strval($body['agreement_type'] ?? ''));
    $player_offer  = is_array($body['player_offer'] ?? null)  ? $body['player_offer']  : [];
    $faction_demand= is_array($body['faction_demand'] ?? null) ? $body['faction_demand'] : [];
    $duration      = isset($body['duration_cycles']) && $body['duration_cycles'] !== null
                     ? max(1, min(12, (int)$body['duration_cycles'])) : null;

    if ($faction_id <= 0)  return ['success' => false, 'error' => 'Invalid faction_id'];
    $type = fa_get_type($type_code);
    if (!$type)            return ['success' => false, 'error' => 'Unknown agreement type'];

    // Standing gate
    $standing = fa_get_standing($db, $uid, $faction_id);
    if ($standing < (int)$type['min_standing']) {
        return ['success' => false, 'error' => sprintf(
            'Insufficient standing (%d). Minimum required: %d.', $standing, $type['min_standing']
        )];
    }

    // Threat gate for alliance: very high threat blocks war alliances
    // (Both sides view each other as a threat – alliances impossible)
    if ($type_code === 'alliance') {
        $ttStmt = $db->prepare('SELECT threat_level FROM diplomacy WHERE user_id = ? AND faction_id = ? LIMIT 1');
        $ttStmt->execute([$uid, $faction_id]);
        $threatRow = $ttStmt->fetch(PDO::FETCH_ASSOC);
        $threat_level = (float)($threatRow['threat_level'] ?? 0.0);
        if ($threat_level >= 75.0) {
            return ['success' => false, 'error' => sprintf(
                'Cannot form an alliance while threat level is critical (%.0f/100). Reduce hostilities first.', $threat_level
            )];
        }
    }

    // Block duplicate active/proposed agreement of same type
    $dup = $db->prepare('
        SELECT id FROM faction_agreements
        WHERE user_id = ? AND faction_id = ? AND agreement_type = ? AND status IN ("proposed","active")
        LIMIT 1
    ');
    $dup->execute([$uid, $faction_id, $type_code]);
    if ($dup->fetchColumn()) {
        return ['success' => false, 'error' => 'An active or proposed agreement of this type already exists.'];
    }

    // Fetch faction aggression for AI model
    $fstmt = $db->prepare('SELECT aggression FROM npc_factions WHERE id = ?');
    $fstmt->execute([$faction_id]);
    $faction = $fstmt->fetch(PDO::FETCH_ASSOC);
    if (!$faction) return ['success' => false, 'error' => 'Faction not found'];

    // Fetch trust/threat for AI acceptance model
    $ttStmt2 = $db->prepare('SELECT trust_level, threat_level FROM diplomacy WHERE user_id = ? AND faction_id = ? LIMIT 1');
    $ttStmt2->execute([$uid, $faction_id]);
    $ttRow2 = $ttStmt2->fetch(PDO::FETCH_ASSOC);
    $propose_trust  = (float)($ttRow2['trust_level']  ?? 0.0);
    $propose_threat = (float)($ttRow2['threat_level'] ?? 0.0);

    // Placeholder leverage: could be tied to real debt table later
    $leverage = 0;
    $ai_pct   = fa_ai_acceptance($type, $standing, $leverage, (int)($faction['aggression'] ?? 50),
                                 $propose_trust, $propose_threat);

    $expires_at = null;
    if ($duration !== null) {
        // 1 cycle ≈ 1 day for now
        $expires_at = date('Y-m-d H:i:s', strtotime("+{$duration} days"));
    }

    $ins = $db->prepare('
        INSERT INTO faction_agreements
            (user_id, faction_id, agreement_type, status,
             player_offer, faction_demand,
             duration_cycles, standing_requirement, standing_reward,
             leverage_score, ai_acceptance_pct, expires_at)
        VALUES
            (:uid, :fid, :type, "proposed",
             :offer, :demand,
             :dur, :min_s, :reward,
             :lev, :ai_pct, :exp)
    ');
    $ins->execute([
        'uid'    => $uid,
        'fid'    => $faction_id,
        'type'   => $type_code,
        'offer'  => json_encode($player_offer),
        'demand' => json_encode($faction_demand),
        'dur'    => $duration,
        'min_s'  => (int)$type['min_standing'],
        'reward' => (int)$type['standing_reward'],
        'lev'    => $leverage,
        'ai_pct' => $ai_pct,
        'exp'    => $expires_at,
    ]);
    $agreement_id = (int)$db->lastInsertId();

    return ['success' => true, 'agreement_id' => $agreement_id, 'ai_acceptance_pct' => $ai_pct];
}

function handle_respond(PDO $db, int $uid): array {
    $body         = json_decode(file_get_contents('php://input'), true) ?? [];
    $agreement_id = (int)($body['agreement_id'] ?? 0);

    if ($agreement_id <= 0) return ['success' => false, 'error' => 'Invalid agreement_id'];

    $stmt = $db->prepare('
        SELECT fa.*, nf.aggression
        FROM   faction_agreements fa
        JOIN   npc_factions nf ON nf.id = fa.faction_id
        WHERE  fa.id = ? AND fa.user_id = ? AND fa.status = "proposed"
    ');
    $stmt->execute([$agreement_id, $uid]);
    $agreement = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$agreement) return ['success' => false, 'error' => 'Agreement not found or not in proposed state'];

    // AI auto-respond based on acceptance probability
    $pct = (int)($agreement['ai_acceptance_pct'] ?? 50);
    $roll = mt_rand(1, 100);
    $accepted = $roll <= $pct;

    if ($accepted) {
        $now = date('Y-m-d H:i:s');
        $db->prepare('
            UPDATE faction_agreements
            SET status = "active", accepted_at = ?
            WHERE id = ?
        ')->execute([$now, $agreement_id]);

        // Apply standing reward
        $reward = (int)($agreement['standing_reward'] ?? 0);
        if ($reward !== 0) {
            $db->prepare('
                INSERT INTO diplomacy (user_id, faction_id, standing, last_event, last_event_at)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    standing = LEAST(100, GREATEST(-100, standing + VALUES(standing))),
                    last_event    = VALUES(last_event),
                    last_event_at = VALUES(last_event_at)
            ')->execute([$uid, $agreement['faction_id'], $reward,
                         'Agreement signed: ' . $agreement['agreement_type'], $now]);
        }

        // Trust gain: successful agreements build bilateral trust
        // trade +5, research +8, alliance +10, non_aggression +3
        $trust_gain_map = [
            'trade'          => 5.0,
            'research'       => 8.0,
            'alliance'       => 10.0,
            'non_aggression' => 3.0,
        ];
        $trust_gain = $trust_gain_map[$agreement['agreement_type']] ?? 3.0;
        $db->prepare('
            UPDATE diplomacy
            SET trust_level = LEAST(100, GREATEST(0, trust_level + ?)),
                last_event    = ?,
                last_event_at = ?
            WHERE user_id = ? AND faction_id = ?
        ')->execute([$trust_gain,
                     'Agreement signed (trust +' . $trust_gain . '): ' . $agreement['agreement_type'],
                     $now, $uid, $agreement['faction_id']]);

        return [
            'success'       => true,
            'outcome'       => 'accepted',
            'standing_gain' => $reward,
            'trust_gain'    => $trust_gain,
        ];
    } else {
        $db->prepare('UPDATE faction_agreements SET status = "rejected" WHERE id = ?')
           ->execute([$agreement_id]);
        return ['success' => true, 'outcome' => 'rejected'];
    }
}

function handle_cancel(PDO $db, int $uid): array {
    $body         = json_decode(file_get_contents('php://input'), true) ?? [];
    $agreement_id = (int)($body['agreement_id'] ?? 0);

    if ($agreement_id <= 0) return ['success' => false, 'error' => 'Invalid agreement_id'];

    $stmt = $db->prepare('
        SELECT id, faction_id, standing_reward, agreement_type
        FROM   faction_agreements
        WHERE  id = ? AND user_id = ? AND status = "active"
    ');
    $stmt->execute([$agreement_id, $uid]);
    $agreement = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$agreement) return ['success' => false, 'error' => 'Active agreement not found'];

    $db->prepare('UPDATE faction_agreements SET status = "cancelled" WHERE id = ?')
       ->execute([$agreement_id]);

    // Penalty: lose the standing reward that was granted
    $penalty = -(int)($agreement['standing_reward'] ?? 0);
    $now = date('Y-m-d H:i:s');
    if ($penalty !== 0) {
        $db->prepare('
            INSERT INTO diplomacy (user_id, faction_id, standing, last_event, last_event_at)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                standing = LEAST(100, GREATEST(-100, standing + VALUES(standing))),
                last_event    = VALUES(last_event),
                last_event_at = VALUES(last_event_at)
        ')->execute([$uid, $agreement['faction_id'], $penalty,
                     'Agreement cancelled: ' . $agreement['agreement_type'], $now]);
    }

    // Trust penalty on cancellation: breaking an agreement hurts trust
    $trust_penalty = -5.0;
    // Cancelling an alliance hurts more
    if ($agreement['agreement_type'] === 'alliance') {
        $trust_penalty = -15.0;
    }
    $db->prepare('
        UPDATE diplomacy
        SET trust_level = LEAST(100, GREATEST(0, trust_level + ?)),
            last_event    = ?,
            last_event_at = ?
        WHERE user_id = ? AND faction_id = ?
    ')->execute([$trust_penalty,
                 'Agreement cancelled (trust ' . $trust_penalty . '): ' . $agreement['agreement_type'],
                 $now, $uid, $agreement['faction_id']]);

    return ['success' => true, 'standing_penalty' => abs($penalty), 'trust_penalty' => abs($trust_penalty)];
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

try {
    $db = get_db();
    switch ($action) {
        case 'list':    json_out(handle_list($db, $uid));    break;
        case 'types':   json_out(handle_types());            break;
        case 'propose': json_out(handle_propose($db, $uid)); break;
        case 'respond': json_out(handle_respond($db, $uid)); break;
        case 'cancel':  json_out(handle_cancel($db, $uid));  break;
        default:        json_out(['success' => false, 'error' => 'Unknown action']);
    }
} catch (Throwable $e) {
    json_out(['success' => false, 'error' => $e->getMessage()]);
}
