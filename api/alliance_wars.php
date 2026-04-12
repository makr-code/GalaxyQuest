<?php
/**
 * Alliance Wars API — N-vs-M multi-alliance war scenarios
 *
 * Supports wars between arbitrarily many alliances on each side (e.g. 2v2, 3v4).
 *
 * GET  /api/alliance_wars.php?action=list
 * GET  /api/alliance_wars.php?action=get_status&war_id=X
 * POST /api/alliance_wars.php?action=declare       body: {name?, side_a:[int,...], side_b:[int,...], casus_belli?}
 * POST /api/alliance_wars.php?action=offer_peace   body: {war_id, from_alliance_id, terms?}
 * POST /api/alliance_wars.php?action=respond_peace body: {offer_id, alliance_id, accept}
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

header('Content-Type: application/json; charset=utf-8');

// ── Schema ────────────────────────────────────────────────────────────────────

function aw_ensure_schema(PDO $db): void {
    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliance_wars (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(120) NOT NULL DEFAULT '',
            status ENUM('active','ended','stalemate') NOT NULL DEFAULT 'active',
            war_score_a INT NOT NULL DEFAULT 0,
            war_score_b INT NOT NULL DEFAULT 0,
            exhaustion_a DECIMAL(6,2) NOT NULL DEFAULT 0,
            exhaustion_b DECIMAL(6,2) NOT NULL DEFAULT 0,
            casus_belli VARCHAR(200) DEFAULT NULL,
            declared_by_user_id INT NOT NULL,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME DEFAULT NULL,
            ended_reason VARCHAR(80) DEFAULT NULL,
            FOREIGN KEY (declared_by_user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    SQL);

    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliance_war_sides (
            id INT AUTO_INCREMENT PRIMARY KEY,
            war_id INT NOT NULL,
            alliance_id INT NOT NULL,
            side ENUM('a','b') NOT NULL,
            joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (war_id) REFERENCES alliance_wars(id) ON DELETE CASCADE,
            FOREIGN KEY (alliance_id) REFERENCES alliances(id) ON DELETE CASCADE,
            UNIQUE KEY unique_side (war_id, alliance_id)
        ) ENGINE=InnoDB
    SQL);

    $db->exec(<<<SQL
        CREATE TABLE IF NOT EXISTS alliance_war_peace_offers (
            id INT AUTO_INCREMENT PRIMARY KEY,
            war_id INT NOT NULL,
            from_alliance_id INT NOT NULL,
            terms_json TEXT NOT NULL DEFAULT '[]',
            status ENUM('pending','accepted','rejected','expired') NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            responded_at DATETIME DEFAULT NULL,
            FOREIGN KEY (war_id) REFERENCES alliance_wars(id) ON DELETE CASCADE,
            FOREIGN KEY (from_alliance_id) REFERENCES alliances(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
    SQL);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the set of alliance IDs the user leads or is a diplomat of. */
function aw_user_leadable_alliances(PDO $db, int $uid): array {
    $st = $db->prepare(
        "SELECT am.alliance_id
         FROM alliance_members am
         WHERE am.user_id = ?
           AND am.role IN ('leader','diplomat')"
    );
    $st->execute([$uid]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
}

/** Returns all alliance IDs the user belongs to. */
function aw_user_alliance_ids(PDO $db, int $uid): array {
    $st = $db->prepare('SELECT alliance_id FROM alliance_members WHERE user_id = ?');
    $st->execute([$uid]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
}

/** Returns all war IDs where at least one alliance of the user appears. */
function aw_wars_for_user(PDO $db, int $uid): array {
    $myAlliances = aw_user_alliance_ids($db, $uid);
    if (!$myAlliances) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($myAlliances), '?'));
    $st = $db->prepare(
        "SELECT DISTINCT war_id FROM alliance_war_sides WHERE alliance_id IN ($placeholders)"
    );
    $st->execute($myAlliances);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
}

function aw_load_sides(PDO $db, int $warId): array {
    $st = $db->prepare(
        'SELECT aws.side, aws.alliance_id, a.name, a.tag
         FROM alliance_war_sides aws
         JOIN alliances a ON a.id = aws.alliance_id
         WHERE aws.war_id = ?
         ORDER BY aws.side, aws.alliance_id'
    );
    $st->execute([$warId]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $sides = ['a' => [], 'b' => []];
    foreach ($rows as $row) {
        $sides[$row['side']][] = [
            'alliance_id' => (int)$row['alliance_id'],
            'name'        => (string)$row['name'],
            'tag'         => (string)$row['tag'],
        ];
    }
    return $sides;
}

function aw_normalize_terms(mixed $raw): array {
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $t) {
        if (!is_array($t)) {
            continue;
        }
        $type = trim((string)($t['type'] ?? ''));
        if ($type === '') {
            continue;
        }
        $entry = ['type' => substr($type, 0, 40)];
        foreach ($t as $k => $v) {
            if ($k !== 'type' && (is_scalar($v) || $v === null)) {
                $entry[(string)$k] = $v;
            }
        }
        $out[] = $entry;
        if (count($out) >= 10) {
            break;
        }
    }
    return $out;
}

function aw_mark_expired_offers(PDO $db, int $warId): void {
    $db->prepare(
        'UPDATE alliance_war_peace_offers
         SET status = "expired", responded_at = NOW()
         WHERE war_id = ? AND status = "pending" AND expires_at <= NOW()'
    )->execute([$warId]);
}

/** Returns a summary of score + exhaustion for a given war row. */
function aw_war_summary(array $war): array {
    return [
        'war_score_a'   => (int)$war['war_score_a'],
        'war_score_b'   => (int)$war['war_score_b'],
        'exhaustion_a'  => (float)$war['exhaustion_a'],
        'exhaustion_b'  => (float)$war['exhaustion_b'],
        'score_balance' => (int)$war['war_score_a'] - (int)$war['war_score_b'],
    ];
}

// ── Action: declare ───────────────────────────────────────────────────────────

function aw_action_declare(PDO $db, int $uid): never {
    only_method('POST');
    verify_csrf();

    $body       = get_json_body();
    $name       = substr(trim((string)($body['name'] ?? '')), 0, 120);
    $sideA      = array_values(array_unique(array_map('intval', (array)($body['side_a'] ?? []))));
    $sideB      = array_values(array_unique(array_map('intval', (array)($body['side_b'] ?? []))));
    $casusBelli = substr(trim((string)($body['casus_belli'] ?? '')), 0, 200);

    if (count($sideA) === 0 || count($sideB) === 0) {
        json_error('side_a and side_b must each contain at least one alliance ID.', 400);
    }

    // Validate no overlap between sides
    $overlap = array_intersect($sideA, $sideB);
    if (count($overlap) > 0) {
        json_error('An alliance cannot be on both sides of a war.', 400);
    }

    // Validate cap (max 8 per side to avoid abuse)
    if (count($sideA) > 8 || count($sideB) > 8) {
        json_error('Maximum 8 alliances per side.', 400);
    }

    // User must lead or be diplomat in at least one alliance on side_a
    $leadable = aw_user_leadable_alliances($db, $uid);
    $hasSideA = count(array_intersect($sideA, $leadable)) > 0;
    if (!$hasSideA) {
        json_error('You must be leader or diplomat of at least one alliance on side A to declare war.', 403);
    }

    // Verify all alliances exist
    $allIds   = array_merge($sideA, $sideB);
    $holders  = implode(',', array_fill(0, count($allIds), '?'));
    $st       = $db->prepare("SELECT id FROM alliances WHERE id IN ($holders)");
    $st->execute($allIds);
    $existing = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)) ?: [];
    $missing  = array_diff($allIds, $existing);
    if (count($missing) > 0) {
        json_error('Some alliance IDs do not exist: ' . implode(', ', $missing), 404);
    }

    // Prevent duplicate active war between the exact same sets of alliances
    // (simplified: check if any side_a alliance is already at war with any side_b alliance in an active war)
    $sideAPlaceholders = implode(',', array_fill(0, count($sideA), '?'));
    $sideBPlaceholders = implode(',', array_fill(0, count($sideB), '?'));
    $dupeCheck = $db->prepare(
        "SELECT COUNT(*) FROM alliance_war_sides aws_a
         JOIN alliance_war_sides aws_b ON aws_b.war_id = aws_a.war_id
         JOIN alliance_wars aw ON aw.id = aws_a.war_id
         WHERE aw.status = 'active'
           AND aws_a.side = 'a' AND aws_a.alliance_id IN ($sideAPlaceholders)
           AND aws_b.side = 'b' AND aws_b.alliance_id IN ($sideBPlaceholders)"
    );
    $dupeCheck->execute(array_merge($sideA, $sideB));
    if ((int)$dupeCheck->fetchColumn() > 0) {
        json_error('An active war already exists between some of these alliances.', 409);
    }

    if ($name === '') {
        // Auto-generate name from first alliance tags
        $tagsA = [];
        $tagsB = [];
        $tagSt = $db->prepare("SELECT id, tag FROM alliances WHERE id IN ($holders)");
        $tagSt->execute($allIds);
        $tagMap = [];
        foreach ($tagSt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $tagMap[(int)$row['id']] = $row['tag'];
        }
        foreach ($sideA as $aid) {
            $tagsA[] = '[' . ($tagMap[$aid] ?? '?') . ']';
        }
        foreach ($sideB as $aid) {
            $tagsB[] = '[' . ($tagMap[$aid] ?? '?') . ']';
        }
        $name = implode('+', $tagsA) . ' vs ' . implode('+', $tagsB);
        $name = substr($name, 0, 120);
    }

    $db->beginTransaction();
    try {
        $ins = $db->prepare(
            'INSERT INTO alliance_wars
                (name, status, war_score_a, war_score_b, exhaustion_a, exhaustion_b, casus_belli, declared_by_user_id)
             VALUES (?, "active", 0, 0, 0, 0, ?, ?)'
        );
        $ins->execute([$name, $casusBelli !== '' ? $casusBelli : null, $uid]);
        $warId = (int)$db->lastInsertId();

        $sideIns = $db->prepare(
            'INSERT INTO alliance_war_sides (war_id, alliance_id, side) VALUES (?, ?, ?)'
        );
        foreach ($sideA as $aid) {
            $sideIns->execute([$warId, $aid, 'a']);
        }
        foreach ($sideB as $aid) {
            $sideIns->execute([$warId, $aid, 'b']);
        }

        $db->commit();
        json_ok([
            'war_id'  => $warId,
            'name'    => $name,
            'status'  => 'active',
            'side_a'  => $sideA,
            'side_b'  => $sideB,
        ]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

// ── Action: list ──────────────────────────────────────────────────────────────

function aw_action_list(PDO $db, int $uid): never {
    only_method('GET');

    $warIds = aw_wars_for_user($db, $uid);
    if (!$warIds) {
        json_ok(['wars' => []]);
    }

    $holders = implode(',', array_fill(0, count($warIds), '?'));
    $st = $db->prepare(
        "SELECT id, name, status, war_score_a, war_score_b, exhaustion_a, exhaustion_b,
                casus_belli, started_at, ended_at, ended_reason
         FROM alliance_wars
         WHERE id IN ($holders)
         ORDER BY id DESC"
    );
    $st->execute($warIds);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $myAllianceIds = aw_user_alliance_ids($db, $uid);

    $wars = [];
    foreach ($rows as $row) {
        $sides      = aw_load_sides($db, (int)$row['id']);
        $myAlliancesOnA = array_filter($sides['a'], fn($s) => in_array($s['alliance_id'], $myAllianceIds, true));
        $mySide     = count($myAlliancesOnA) > 0 ? 'a' : 'b';
        $wars[] = [
            'war_id'      => (int)$row['id'],
            'name'        => (string)$row['name'],
            'status'      => (string)$row['status'],
            'my_side'     => $mySide,
            'side_a'      => $sides['a'],
            'side_b'      => $sides['b'],
            'war_score_a' => (int)$row['war_score_a'],
            'war_score_b' => (int)$row['war_score_b'],
            'exhaustion_a'=> (float)$row['exhaustion_a'],
            'exhaustion_b'=> (float)$row['exhaustion_b'],
            'started_at'  => (string)$row['started_at'],
            'ended_at'    => $row['ended_at'],
            'ended_reason'=> $row['ended_reason'],
            'summary'     => aw_war_summary($row),
        ];
    }

    json_ok(['wars' => $wars]);
}

// ── Action: get_status ────────────────────────────────────────────────────────

function aw_action_get_status(PDO $db, int $uid): never {
    only_method('GET');

    $warId = (int)($_GET['war_id'] ?? 0);
    if ($warId <= 0) {
        json_error('war_id is required.', 400);
    }

    // Verify the user participates in this war
    $myAllianceIds = aw_user_alliance_ids($db, $uid);
    if (!$myAllianceIds) {
        json_error('War not found or access denied.', 403);
    }

    $holders = implode(',', array_fill(0, count($myAllianceIds), '?'));
    $access  = $db->prepare(
        "SELECT 1 FROM alliance_war_sides
         WHERE war_id = ? AND alliance_id IN ($holders)
         LIMIT 1"
    );
    $access->execute(array_merge([$warId], $myAllianceIds));
    if (!$access->fetchColumn()) {
        json_error('War not found or access denied.', 403);
    }

    $st = $db->prepare(
        'SELECT * FROM alliance_wars WHERE id = ? LIMIT 1'
    );
    $st->execute([$warId]);
    $war = $st->fetch(PDO::FETCH_ASSOC);
    if (!is_array($war)) {
        json_error('War not found.', 404);
    }

    aw_mark_expired_offers($db, $warId);
    $sides = aw_load_sides($db, $warId);

    $offerSt = $db->prepare(
        'SELECT id, from_alliance_id, status, terms_json, created_at, expires_at, responded_at
         FROM alliance_war_peace_offers
         WHERE war_id = ?
         ORDER BY id DESC
         LIMIT 20'
    );
    $offerSt->execute([$warId]);
    $offers = [];
    foreach ($offerSt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $offer) {
        $decoded = json_decode((string)$offer['terms_json'], true);
        $offers[] = [
            'id'              => (int)$offer['id'],
            'from_alliance_id'=> (int)$offer['from_alliance_id'],
            'status'          => (string)$offer['status'],
            'terms'           => is_array($decoded) ? $decoded : [],
            'created_at'      => (string)$offer['created_at'],
            'expires_at'      => (string)$offer['expires_at'],
            'responded_at'    => $offer['responded_at'],
        ];
    }

    $myAlliancesOnA = array_filter($sides['a'], fn($s) => in_array($s['alliance_id'], $myAllianceIds, true));
    $mySide         = count($myAlliancesOnA) > 0 ? 'a' : 'b';

    json_ok([
        'war_id'       => (int)$war['id'],
        'name'         => (string)$war['name'],
        'status'       => (string)$war['status'],
        'my_side'      => $mySide,
        'side_a'       => $sides['a'],
        'side_b'       => $sides['b'],
        'war_score_a'  => (int)$war['war_score_a'],
        'war_score_b'  => (int)$war['war_score_b'],
        'exhaustion_a' => (float)$war['exhaustion_a'],
        'exhaustion_b' => (float)$war['exhaustion_b'],
        'casus_belli'  => $war['casus_belli'],
        'started_at'   => (string)$war['started_at'],
        'ended_at'     => $war['ended_at'],
        'ended_reason' => $war['ended_reason'],
        'peace_offers' => $offers,
        'summary'      => aw_war_summary($war),
    ]);
}

// ── Action: offer_peace ───────────────────────────────────────────────────────

function aw_action_offer_peace(PDO $db, int $uid): never {
    only_method('POST');
    verify_csrf();

    $body           = get_json_body();
    $warId          = (int)($body['war_id'] ?? 0);
    $fromAllianceId = (int)($body['from_alliance_id'] ?? 0);
    $terms          = aw_normalize_terms($body['terms'] ?? []);

    if ($warId <= 0 || $fromAllianceId <= 0) {
        json_error('war_id and from_alliance_id are required.', 400);
    }

    // Verify user is leader/diplomat in the from_alliance
    $leadable = aw_user_leadable_alliances($db, $uid);
    if (!in_array($fromAllianceId, $leadable, true)) {
        json_error('You are not a leader or diplomat of the specified alliance.', 403);
    }

    // Verify alliance is in the war
    $inWar = $db->prepare(
        'SELECT 1 FROM alliance_war_sides WHERE war_id = ? AND alliance_id = ? LIMIT 1'
    );
    $inWar->execute([$warId, $fromAllianceId]);
    if (!$inWar->fetchColumn()) {
        json_error('Alliance is not a participant in this war.', 403);
    }

    // Verify war is active
    $warSt = $db->prepare("SELECT status FROM alliance_wars WHERE id = ? LIMIT 1");
    $warSt->execute([$warId]);
    $warRow = $warSt->fetch(PDO::FETCH_ASSOC);
    if (!$warRow || (string)$warRow['status'] !== 'active') {
        json_error('War is not active.', 409);
    }

    aw_mark_expired_offers($db, $warId);

    $ttl       = 86400 * 3; // 3 days
    $expiresAt = date('Y-m-d H:i:s', time() + $ttl);

    $ins = $db->prepare(
        'INSERT INTO alliance_war_peace_offers
            (war_id, from_alliance_id, terms_json, expires_at)
         VALUES (?, ?, ?, ?)'
    );
    $ins->execute([$warId, $fromAllianceId, json_encode($terms), $expiresAt]);

    json_ok([
        'offer_id'   => (int)$db->lastInsertId(),
        'expires_at' => $expiresAt,
    ]);
}

// ── Action: respond_peace ─────────────────────────────────────────────────────

function aw_action_respond_peace(PDO $db, int $uid): never {
    only_method('POST');
    verify_csrf();

    $body           = get_json_body();
    $offerId        = (int)($body['offer_id'] ?? 0);
    $respondingAlId = (int)($body['alliance_id'] ?? 0);
    $accept         = filter_var($body['accept'] ?? null, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

    if ($offerId <= 0 || $respondingAlId <= 0) {
        json_error('offer_id and alliance_id are required.', 400);
    }
    if ($accept === null) {
        json_error('accept must be a boolean.', 400);
    }

    // Verify user is leader/diplomat of responding alliance
    $leadable = aw_user_leadable_alliances($db, $uid);
    if (!in_array($respondingAlId, $leadable, true)) {
        json_error('You are not a leader or diplomat of the specified alliance.', 403);
    }

    $offerSt = $db->prepare(
        'SELECT awpo.*, aw.status AS war_status
         FROM alliance_war_peace_offers awpo
         JOIN alliance_wars aw ON aw.id = awpo.war_id
         WHERE awpo.id = ?
         LIMIT 1'
    );
    $offerSt->execute([$offerId]);
    $offer = $offerSt->fetch(PDO::FETCH_ASSOC);
    if (!is_array($offer)) {
        json_error('Peace offer not found.', 404);
    }

    // Verify responding alliance is in the war (on the opposing side of the offer sender)
    $inWar = $db->prepare(
        'SELECT side FROM alliance_war_sides
         WHERE war_id = ? AND alliance_id = ?
         LIMIT 1'
    );
    $inWar->execute([(int)$offer['war_id'], $respondingAlId]);
    $sideRow = $inWar->fetch(PDO::FETCH_ASSOC);
    if (!$sideRow) {
        json_error('Your alliance is not a participant in this war.', 403);
    }

    // Offer author cannot accept their own offer
    if ((int)$offer['from_alliance_id'] === $respondingAlId) {
        json_error('Offer author cannot respond to own peace offer.', 403);
    }

    if ((string)$offer['status'] !== 'pending') {
        json_error('Peace offer is no longer pending.', 409);
    }
    if (strtotime((string)$offer['expires_at']) <= time()) {
        $db->prepare('UPDATE alliance_war_peace_offers SET status = "expired", responded_at = NOW() WHERE id = ?')
           ->execute([$offerId]);
        json_error('Peace offer has expired.', 409);
    }
    if ((string)$offer['war_status'] !== 'active') {
        json_error('War is not active.', 409);
    }

    $db->beginTransaction();
    try {
        if ($accept) {
            $db->prepare('UPDATE alliance_war_peace_offers SET status = "accepted", responded_at = NOW() WHERE id = ?')
               ->execute([$offerId]);
            $db->prepare('UPDATE alliance_wars SET status = "ended", ended_at = NOW(), ended_reason = "peace_accepted" WHERE id = ?')
               ->execute([(int)$offer['war_id']]);
            $db->commit();
            json_ok(['war_status' => 'ended', 'new_state' => 'peace_accepted']);
        }

        $db->prepare('UPDATE alliance_war_peace_offers SET status = "rejected", responded_at = NOW() WHERE id = ?')
           ->execute([$offerId]);
        $db->commit();
        json_ok(['war_status' => 'active', 'new_state' => 'offer_rejected']);
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

// ── Router ────────────────────────────────────────────────────────────────────

$uid = require_auth();
$db  = get_db();
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
aw_ensure_schema($db);

$action = $_GET['action'] ?? '';

match ($action) {
    'declare'        => aw_action_declare($db, $uid),
    'list'           => aw_action_list($db, $uid),
    'get_status'     => aw_action_get_status($db, $uid),
    'offer_peace'    => aw_action_offer_peace($db, $uid),
    'respond_peace'  => aw_action_respond_peace($db, $uid),
    default          => json_error('Unknown action: ' . htmlspecialchars($action), 400),
};
