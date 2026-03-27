<?php
/**
 * NPC AI tick – called from game.php overview action.
 * Handles: trade offer generation, pirate raids, diplomacy time-decay.
 * All operations are fast (< 50 ms) and idempotent for repeated calls.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

/**
 * Run the NPC AI tick for a specific user.
 * Safe to call on every overview load (rate-limited internally via DB timestamps).
 */
function npc_ai_tick(PDO $db, int $userId): void {
    // Only run once per 5 minutes per user (stored in user meta as last_npc_tick)
    $uRow = $db->prepare('SELECT last_npc_tick FROM users WHERE id=?');
    $uRow->execute([$userId]);
    $u = $uRow->fetch();
    // If column doesn't exist yet (pre-migration), skip silently
    if (!$u || !array_key_exists('last_npc_tick', $u)) return;

    $lastTick = $u['last_npc_tick'] ? strtotime($u['last_npc_tick']) : 0;
    if (time() - $lastTick < 300) return; // 5-minute cooldown

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
}

function npc_faction_tick(PDO $db, int $userId, array $faction): void {
    $fid = (int)$faction['id'];

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
        'SELECT id, metal, crystal FROM colonies
         WHERE user_id=? AND is_homeworld=0 ORDER BY RAND() LIMIT 1'
    );
    $col->execute([$userId]);
    $target = $col->fetch();
    if (!$target) return;

    // Steal up to 5% of metal/crystal
    $stealM = (int)min((float)$target['metal']   * 0.05, 500);
    $stealC = (int)min((float)$target['crystal'] * 0.05, 300);

    if ($stealM > 0 || $stealC > 0) {
        $db->prepare('UPDATE colonies SET metal=metal-?, crystal=crystal-? WHERE id=?')
           ->execute([$stealM, $stealC, $target['id']]);

        $msg = "[{$faction['icon']} {$faction['name']}] A pirate raid struck your colony! "
             . "Lost: {$stealM} metal, {$stealC} crystal. "
             . "Improve your diplomatic standing or build defences to deter future raids.";
        $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)')
           ->execute([$userId, 'Pirate Raid!', $msg]);

        // Reduce standing slightly
        require_once __DIR__ . '/factions.php';
        update_standing($db, $userId, (int)$faction['id'], -3, 'raid', 'Pirate raid on colony');
    }
}
