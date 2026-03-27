<?php
/**
 * Factions & Diplomacy API
 *
 * GET  /api/factions.php?action=list                       – all factions + player standing
 * GET  /api/factions.php?action=trade_offers&faction_id=X  – available trade offers
 * POST /api/factions.php?action=accept_trade  body: {offer_id, colony_id}
 * GET  /api/factions.php?action=quests&faction_id=X        – available faction quests
 * POST /api/factions.php?action=start_quest   body: {faction_quest_id}
 * POST /api/factions.php?action=check_quests               – auto-complete eligible quests
 * POST /api/factions.php?action=claim_quest   body: {user_quest_id}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';   // verify_colony_ownership

$action = $_GET['action'] ?? '';
$uid    = require_auth();

switch ($action) {

    // ── List all factions with player standing ────────────────────────────────
    case 'list':
        only_method('GET');
        $db = get_db();
        ensure_diplomacy_rows($db, $uid);
        $stmt = $db->prepare(
            'SELECT f.*,
                    COALESCE(d.standing, f.base_diplomacy)     AS standing,
                    COALESCE(d.trades_completed, 0)            AS trades_done,
                    COALESCE(d.quests_completed, 0)            AS quests_done,
                    d.last_event, d.last_event_at
             FROM npc_factions f
             LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
             ORDER BY f.id'
        );
        $stmt->execute([$uid]);
        json_ok(['factions' => $stmt->fetchAll()]);
        break;

    // ── Active trade offers from a faction ────────────────────────────────────
    case 'trade_offers':
        only_method('GET');
        $fid = (int)($_GET['faction_id'] ?? 0);
        $db  = get_db();
        $standing = get_standing($db, $uid, $fid);
        $stmt = $db->prepare(
            'SELECT t.*, f.name AS faction_name, f.icon
             FROM trade_offers t JOIN npc_factions f ON f.id = t.faction_id
             WHERE t.faction_id = ? AND t.active = 1
               AND t.valid_until > NOW()
               AND t.claims_count < t.max_claims
               AND ? >= t.min_standing
             ORDER BY t.id DESC LIMIT 10'
        );
        $stmt->execute([$fid, $standing]);
        json_ok(['offers' => $stmt->fetchAll(), 'standing' => $standing]);
        break;

    // ── Accept a trade offer ──────────────────────────────────────────────────
    case 'accept_trade':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $oid  = (int)($body['offer_id']  ?? 0);
        $cid  = (int)($body['colony_id'] ?? 0);
        $db   = get_db();

        verify_colony_ownership($db, $cid, $uid);
        update_colony_resources($db, $cid);

        // Load offer
        $offerRow = $db->prepare(
            'SELECT t.*, f.id AS fid
             FROM trade_offers t JOIN npc_factions f ON f.id = t.faction_id
             WHERE t.id = ? AND t.active = 1 AND t.valid_until > NOW()
               AND t.claims_count < t.max_claims'
        );
        $offerRow->execute([$oid]);
        $offer = $offerRow->fetch();
        if (!$offer) { json_error('Trade offer not found or expired.', 404); }

        $standing = get_standing($db, $uid, (int)$offer['fid']);
        if ($standing < (int)$offer['min_standing']) {
            json_error('Insufficient diplomatic standing for this trade.');
        }

        // Check colony has enough of the requested resource
        $resCol = $db->prepare(
            'SELECT metal, crystal, deuterium, rare_earth, food FROM colonies WHERE id = ?'
        );
        $resCol->execute([$cid]);
        $col = $resCol->fetch();

        $reqRes    = $offer['request_resource'];
        $reqAmount = (int)$offer['request_amount'];
        if ((float)$col[$reqRes] < $reqAmount) {
            json_error("Not enough {$reqRes} on this colony ({$col[$reqRes]} < {$reqAmount}).");
        }

        // Execute trade: deduct requested, add offered
        $db->prepare("UPDATE colonies SET {$reqRes} = {$reqRes} - ? WHERE id = ?")
           ->execute([$reqAmount, $cid]);
        $offerRes = $offer['offer_resource'];
        $db->prepare("UPDATE colonies SET {$offerRes} = {$offerRes} + ? WHERE id = ?")
           ->execute([$offer['offer_amount'], $cid]);

        // Increment claim count
        $db->prepare('UPDATE trade_offers SET claims_count = claims_count + 1 WHERE id = ?')
           ->execute([$oid]);

        // Improve diplomacy standing
        update_standing($db, $uid, (int)$offer['fid'], 5, 'trade', "Accepted trade offer #{$oid}");

        json_ok([
            'message'   => "Trade complete! Received {$offer['offer_amount']} {$offerRes}.",
            'new_standing' => get_standing($db, $uid, (int)$offer['fid']),
        ]);
        break;

    // ── List available faction quests ─────────────────────────────────────────
    case 'quests':
        only_method('GET');
        $fid = (int)($_GET['faction_id'] ?? 0);
        $db  = get_db();
        $standing = get_standing($db, $uid, $fid);

        // Already-active quest IDs for this user
        $activeIds = $db->prepare(
            'SELECT faction_quest_id FROM user_faction_quests
             WHERE user_id = ? AND status IN (\'active\',\'completed\')'
        );
        $activeIds->execute([$uid]);
        $taken = array_column($activeIds->fetchAll(), 'faction_quest_id');

        $stmt = $db->prepare(
            'SELECT q.*, f.name AS faction_name, f.icon, f.color
             FROM faction_quests q JOIN npc_factions f ON f.id = q.faction_id
             WHERE q.faction_id = ? AND ? >= q.min_standing
             ORDER BY q.difficulty, q.id'
        );
        $stmt->execute([$fid, $standing]);
        $quests = [];
        foreach ($stmt->fetchAll() as $q) {
            $q['taken']      = in_array((int)$q['id'], $taken, true);
            $q['requirements'] = json_decode($q['requirements_json'], true);
            $quests[] = $q;
        }
        json_ok(['quests' => $quests, 'standing' => $standing]);
        break;

    // ── Start a faction quest ─────────────────────────────────────────────────
    case 'start_quest':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $fqid = (int)($body['faction_quest_id'] ?? 0);
        $db   = get_db();

        $qRow = $db->prepare('SELECT * FROM faction_quests WHERE id = ?');
        $qRow->execute([$fqid]);
        $quest = $qRow->fetch();
        if (!$quest) { json_error('Quest not found.', 404); }

        $standing = get_standing($db, $uid, (int)$quest['faction_id']);
        if ($standing < (int)$quest['min_standing']) {
            json_error('Insufficient diplomatic standing for this quest.');
        }

        // Check not already active (unless repeatable and last was claimed)
        $existing = $db->prepare(
            'SELECT id, status FROM user_faction_quests
             WHERE user_id = ? AND faction_quest_id = ? ORDER BY id DESC LIMIT 1'
        );
        $existing->execute([$uid, $fqid]);
        $ex = $existing->fetch();
        if ($ex && in_array($ex['status'], ['active', 'completed'], true)) {
            json_error('Quest already active or awaiting claim.');
        }
        if ($ex && $ex['status'] !== 'claimed' && !$quest['repeatable']) {
            json_error('Quest already completed.');
        }

        $db->prepare(
            'INSERT INTO user_faction_quests (user_id, faction_quest_id, status) VALUES (?, ?, \'active\')'
        )->execute([$uid, $fqid]);

        json_ok(['message' => "Quest started: {$quest['title']}"]);
        break;

    // ── Auto-check quest completion ───────────────────────────────────────────
    case 'check_quests':
        only_method('POST');
        verify_csrf();
        $db      = get_db();
        $results = check_faction_quests($db, $uid);
        json_ok(['completed' => $results]);
        break;

    // ── Claim a completed quest ───────────────────────────────────────────────
    case 'claim_quest':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $uqid = (int)($body['user_quest_id'] ?? 0);
        $db   = get_db();

        $uqRow = $db->prepare(
            'SELECT uq.*, fq.*,
                    fq.id AS fq_id, uq.id AS uq_id
             FROM user_faction_quests uq
             JOIN faction_quests fq ON fq.id = uq.faction_quest_id
             WHERE uq.id = ? AND uq.user_id = ? AND uq.status = \'completed\''
        );
        $uqRow->execute([$uqid, $uid]);
        $row = $uqRow->fetch();
        if (!$row) { json_error('Quest not found or not yet completed.', 404); }

        // Credit rewards to homeworld colony
        $hw = $db->prepare('SELECT id FROM colonies WHERE user_id=? AND is_homeworld=1 LIMIT 1');
        $hw->execute([$uid]);
        $hwId = $hw->fetchColumn();
        if ($hwId) {
            $db->prepare(
                'UPDATE colonies SET metal=metal+?, crystal=crystal+?, deuterium=deuterium+?,
                                     rare_earth=rare_earth+? WHERE id=?'
            )->execute([$row['reward_metal'], $row['reward_crystal'],
                        $row['reward_deuterium'], $row['reward_rare_earth'], $hwId]);
        }
        // Dark matter + rank points
        $db->prepare('UPDATE users SET dark_matter=dark_matter+?, rank_points=rank_points+? WHERE id=?')
           ->execute([$row['reward_dark_matter'], $row['reward_rank_points'], $uid]);

        // Diplomacy standing reward
        update_standing($db, $uid, (int)$row['faction_id'], (int)$row['reward_standing'],
                        'quest', "Completed quest: {$row['title']}");

        // Mark claimed
        $db->prepare('UPDATE user_faction_quests SET status=\'claimed\', completed_at=NOW() WHERE id=?')
           ->execute([$uqid]);

        // Increment quests_completed in diplomacy
        $db->prepare(
            'UPDATE diplomacy SET quests_completed=quests_completed+1 WHERE user_id=? AND faction_id=?'
        )->execute([$uid, $row['faction_id']]);

        json_ok([
            'message'   => "Reward claimed for: {$row['title']}",
            'new_standing' => get_standing($db, $uid, (int)$row['faction_id']),
        ]);
        break;

    default:
        json_error('Unknown action');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Get player's current standing with a faction.
 * Returns the faction's base_diplomacy if no row yet exists.
 */
function get_standing(PDO $db, int $userId, int $factionId): int {
    $stmt = $db->prepare('SELECT standing FROM diplomacy WHERE user_id=? AND faction_id=?');
    $stmt->execute([$userId, $factionId]);
    $row = $stmt->fetch();
    if ($row) return (int)$row['standing'];

    // Fall back to faction's base
    $base = $db->prepare('SELECT base_diplomacy FROM npc_factions WHERE id=?');
    $base->execute([$factionId]);
    $b = $base->fetch();
    return $b ? (int)$b['base_diplomacy'] : 0;
}

/**
 * Create missing diplomacy rows for all factions (called on list action).
 */
function ensure_diplomacy_rows(PDO $db, int $userId): void {
    $factions = $db->query('SELECT id, base_diplomacy FROM npc_factions')->fetchAll();
    $ins = $db->prepare(
        'INSERT IGNORE INTO diplomacy (user_id, faction_id, standing) VALUES (?, ?, ?)'
    );
    foreach ($factions as $f) {
        $ins->execute([$userId, $f['id'], $f['base_diplomacy']]);
    }
}

/**
 * Update diplomatic standing (clamp to -100..+100).
 */
function update_standing(PDO $db, int $userId, int $factionId,
                          int $delta, string $eventType, string $message): void {
    ensure_diplomacy_rows($db, $userId);
    $cur = get_standing($db, $userId, $factionId);
    $new = max(-100, min(100, $cur + $delta));

    $db->prepare(
        'UPDATE diplomacy
         SET standing=?, last_event=?, last_event_at=NOW()
         WHERE user_id=? AND faction_id=?'
    )->execute([$new, "[{$eventType}] {$message}", $userId, $factionId]);

    if ($eventType === 'trade') {
        $db->prepare('UPDATE diplomacy SET trades_completed=trades_completed+1 WHERE user_id=? AND faction_id=?')
           ->execute([$userId, $factionId]);
    }
}

/**
 * Check all active faction quests for the user and auto-complete eligible ones.
 * Returns array of quest titles that were completed.
 */
function check_faction_quests(PDO $db, int $userId): array {
    $active = $db->prepare(
        'SELECT uq.id AS uq_id, fq.*
         FROM user_faction_quests uq
         JOIN faction_quests fq ON fq.id = uq.faction_quest_id
         WHERE uq.user_id = ? AND uq.status = \'active\''
    );
    $active->execute([$userId]);
    $completed = [];

    foreach ($active->fetchAll() as $q) {
        $req = json_decode($q['requirements_json'], true) ?? [];
        if (is_quest_complete($db, $userId, $q['quest_type'], $req)) {
            $db->prepare(
                'UPDATE user_faction_quests SET status=\'completed\', completed_at=NOW() WHERE id=?'
            )->execute([$q['uq_id']]);
            $completed[] = $q['title'];
        }
    }
    return $completed;
}

/**
 * Check whether a specific quest requirement is met.
 */
function is_quest_complete(PDO $db, int $userId, string $type, array $req): bool {
    switch ($type) {
        case 'deliver':
            // Deliver quests are manually triggered – check colony stockpile
            $res    = $req['resource'] ?? 'metal';
            $amount = (int)($req['amount'] ?? 0);
            $total  = $db->prepare("SELECT COALESCE(SUM({$res}),0) FROM colonies WHERE user_id=?");
            $total->execute([$userId]);
            return (float)$total->fetchColumn() >= $amount;

        case 'kill':
            if (isset($req['faction'])) {
                // Count battle wins against that faction's NPC users
                $stmt = $db->prepare(
                    'SELECT COUNT(*) FROM battle_reports br
                     JOIN users u ON u.id = br.defender_id
                     WHERE br.attacker_id = ? AND u.is_npc = 1
                       AND JSON_EXTRACT(br.report_json,\'$.attacker_wins\') = true'
                );
                $stmt->execute([$userId]);
                return (int)$stmt->fetchColumn() >= (int)($req['count'] ?? 1);
            }
            $stmt = $db->prepare(
                'SELECT COUNT(*) FROM battle_reports
                 WHERE attacker_id=? AND JSON_EXTRACT(report_json,\'$.attacker_wins\')=true'
            );
            $stmt->execute([$userId]);
            return (int)$stmt->fetchColumn() >= (int)($req['battle_wins'] ?? 1);

        case 'explore':
            $stmt = $db->prepare('SELECT COUNT(*) FROM spy_reports WHERE owner_id=?');
            $stmt->execute([$userId]);
            return (int)$stmt->fetchColumn() >= (int)($req['spy_reports'] ?? 1);

        case 'research':
            $level = (int)($req['research_level'] ?? 1);
            $stmt  = $db->prepare('SELECT MAX(level) FROM research WHERE user_id=?');
            $stmt->execute([$userId]);
            return (int)$stmt->fetchColumn() >= $level;

        case 'build':
            $type2 = $req['building'] ?? 'metal_mine';
            $lv    = (int)($req['level'] ?? 1);
            $stmt  = $db->prepare(
                'SELECT MAX(b.level) FROM buildings b JOIN colonies c ON c.id=b.colony_id
                 WHERE c.user_id=? AND b.type=?'
            );
            $stmt->execute([$userId, $type2]);
            return (int)$stmt->fetchColumn() >= $lv;

        case 'spy':
            $stmt = $db->prepare('SELECT COUNT(*) FROM spy_reports WHERE owner_id=?');
            $stmt->execute([$userId]);
            return (int)$stmt->fetchColumn() >= (int)($req['count'] ?? 1);
    }
    return false;
}
