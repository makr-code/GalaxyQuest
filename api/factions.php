<?php
/**
 * Factions & Diplomacy API
 *
 * GET  /api/factions.php?action=list                       – all factions + player standing + government forms + alliances
 * GET  /api/factions.php?action=government&faction_id=X    – government form details + alliances
 * GET  /api/factions.php?action=trade_offers&faction_id=X  – available trade offers
 * POST /api/factions.php?action=accept_trade  body: {offer_id, colony_id}
 * GET  /api/factions.php?action=quests&faction_id=X        – available faction quests
 * POST /api/factions.php?action=start_quest   body: {faction_quest_id}
 * POST /api/factions.php?action=check_quests               – auto-complete eligible quests
 * POST /api/factions.php?action=claim_quest   body: {user_quest_id}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';
require_once __DIR__ . '/game_engine.php';
require_once __DIR__ . '/buildings.php';   // verify_colony_ownership
require_once __DIR__ . '/galaxy_seed.php';  // get_faction_government, get_faction_alliances
require_once __DIR__ . '/ollama_client.php';
require_once __DIR__ . '/tts_client.php';
require_once __DIR__ . '/../lib/MiniYamlParser.php';
require_once __DIR__ . '/../api/llm_soc/FactionSpecLoader.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    $uid    = require_auth();

    switch ($action) {

    // ── List all factions with player standing, government forms & alliances ──
    case 'list':
        only_method('GET');
        $db = get_db();
        $cacheKeyParams = ['uid' => $uid];
        $cached = gq_cache_get('factions_list', $cacheKeyParams);
        if (is_array($cached) && isset($cached['factions'])) {
            json_ok($cached);
        }
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
        $factions = $stmt->fetchAll();
        
        // Enrich with government forms and alliances
        $specLoader = new FactionSpecLoader();
        foreach ($factions as &$faction) {
            $fid = (int)$faction['id'];
            $faction['government'] = get_faction_government($db, $fid);
            $faction['alliances'] = get_faction_alliances($db, $fid);
            // Resolve first NPC for the diplomacy chat contact button
            $faction['diplomat_npc'] = null;
            try {
                $spec = $specLoader->loadFactionSpec((string)($faction['code'] ?? ''));
                $npcs = $spec['important_npcs'] ?? [];
                if (is_array($npcs) && !empty($npcs)) {
                    $faction['diplomat_npc'] = (string)($npcs[0]['name'] ?? '');
                }
            } catch (\Throwable $e) {
                // spec not found for this faction – diplomat_npc stays null
            }
        }
        unset($faction);

        // Active global faction event
        $activeEvent = null;
        if (function_exists('app_state_get_int')) {
            $evType  = app_state_get_int($db, 'faction_event:active_type', 0);
            $evSince = app_state_get_int($db, 'faction_event:active_since', 0);
            $evEnds  = app_state_get_int($db, 'faction_event:ends_at', 0);
            if ($evType > 0 && $evEnds > time()) {
                $labels = [1 => 'Galactic War', 2 => 'Trade Boom', 3 => 'Pirate Surge'];
                $icons  = [1 => '\u2694\ufe0f', 2 => '\ud83d\udcc8', 3 => '\u2620\ufe0f'];
                $activeEvent = [
                    'type'  => $evType,
                    'label' => $labels[$evType] ?? 'Unknown',
                    'icon'  => $icons[$evType] ?? '\u2b50',
                    'since' => $evSince,
                    'ends_at' => $evEnds,
                    'ends_in_min' => (int)ceil(($evEnds - time()) / 60),
                ];
            }
        }

        $payload = ['factions' => $factions, 'active_event' => $activeEvent];
        gq_cache_set('factions_list', $cacheKeyParams, $payload, CACHE_TTL_FACTIONS);
        json_ok($payload);
        break;

    // ── Faction government form details & alliances ───────────────────────────
    case 'government':
        only_method('GET');
        $fid = (int)($_GET['faction_id'] ?? 0);
        $db  = get_db();

        $govCacheParams = ['uid' => $uid, 'fid' => $fid];
        $cached = gq_cache_get('faction_government', $govCacheParams);
        if (is_array($cached) && isset($cached['faction'])) {
            json_ok($cached);
        }

        $factionStmt = $db->prepare('SELECT * FROM npc_factions WHERE id = ?');
        $factionStmt->execute([$fid]);
        $faction = $factionStmt->fetch();
        if (!$faction) {
            json_error('Faction not found.', 404);
        }

        $government = get_faction_government($db, $fid);
        $alliances = get_faction_alliances($db, $fid);
        $standing = get_standing($db, $uid, $fid);

        $payload = [
            'faction' => $faction,
            'government' => $government,
            'alliances' => $alliances,
            'player_standing' => $standing,
        ];
        gq_cache_set('faction_government', $govCacheParams, $payload, CACHE_TTL_FACTIONS);
        json_ok($payload);
        break;

    // ── Interactive faction dialogue (LLM-guided RPG conversation) ──────────
    case 'dialogue':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $fid  = (int)($body['faction_id'] ?? 0);
        $db   = get_db();

        if ($fid <= 0) {
            json_error('faction_id is required.');
        }

        $factionStmt = $db->prepare('SELECT * FROM npc_factions WHERE id = ? LIMIT 1');
        $factionStmt->execute([$fid]);
        $faction = $factionStmt->fetch();
        if (!$faction) {
            json_error('Faction not found.', 404);
        }

        ensure_diplomacy_rows($db, $uid);
        $standing = get_standing($db, $uid, $fid);
        $history = faction_dialog_sanitize_history($body['history'] ?? []);
        $playerInput = faction_dialog_trim_text((string)($body['player_input'] ?? ''), 280);

        $openingTurn = true;
        foreach ($history as $entry) {
            if (($entry['speaker'] ?? '') === 'player') {
                $openingTurn = false;
                break;
            }
        }

        if ($playerInput !== '') {
            $history[] = ['speaker' => 'player', 'text' => $playerInput];
        }

        $dialogEffects = faction_dialog_apply_effects($db, $uid, $faction, $standing, $playerInput, $openingTurn);
        $standing = (int)($dialogEffects['standing'] ?? $standing);

        $turn = faction_dialog_generate_turn($faction, $standing, $history, [
            'opening_turn' => $openingTurn,
            'quest_hook' => $dialogEffects['quest_hook'] ?? null,
            'standing_change' => $dialogEffects['standing_change'] ?? null,
            'player_intent' => $dialogEffects['player_intent'] ?? null,
        ]);
        $history[] = ['speaker' => 'npc', 'text' => $turn['npc_message']];

        // ── TTS: pre-render NPC audio when TTS service is available ──────────
        $ttsVoice    = trim((string)($faction['tts_voice'] ?? ''));
        $ttsAudioUrl = null;
        if (tts_is_enabled() && $turn['npc_message'] !== '') {
            $ttsResult = tts_synthesise($turn['npc_message'], ['voice' => $ttsVoice]);
            if ($ttsResult['ok'] ?? false) {
                $ttsAudioUrl = (string)($ttsResult['audio_url'] ?? null);
            }
        }

        json_ok([
            'faction' => [
                'id' => (int)$faction['id'],
                'name' => (string)$faction['name'],
                'icon' => (string)$faction['icon'],
                'color' => (string)$faction['color'],
                'standing' => $standing,
            ],
            'history' => $history,
            'npc_message' => $turn['npc_message'],
            'suggested_replies' => $turn['suggested_replies'],
            'standing_change' => $dialogEffects['standing_change'] ?? null,
            'quest_hook' => $dialogEffects['quest_hook'] ?? null,
            'model' => $turn['model'],
            'fallback' => !empty($turn['fallback']),
            'tts_voice' => $ttsVoice !== '' ? $ttsVoice : null,
            'tts_audio_url' => $ttsAudioUrl,
        ]);
        break;

    // ── Active trade offers from a faction ────────────────────────────────────
    case 'trade_offers':
        only_method('GET');
        $fid = (int)($_GET['faction_id'] ?? 0);
        $db  = get_db();
        $standing = get_standing($db, $uid, $fid);
        $offersCacheParams = ['uid' => $uid, 'fid' => $fid, 'standing' => $standing];
        $cached = gq_cache_get('faction_trade_offers', $offersCacheParams);
        if (is_array($cached) && isset($cached['offers'])) {
            json_ok($cached);
        }
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
           $payload = ['offers' => $stmt->fetchAll(), 'standing' => $standing];
           gq_cache_set('faction_trade_offers', $offersCacheParams, $payload, CACHE_TTL_DEFAULT);
           json_ok($payload);
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

        // Invalidate player-facing faction caches touched by standing/trade counters.
        gq_cache_delete('factions_list', ['uid' => $uid]);
        gq_cache_delete('faction_government', ['uid' => $uid, 'fid' => (int)$offer['fid']]);
        gq_cache_flush('faction_trade_offers');

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
        ensure_precursor_beacon_quest_seed($db);
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
        ensure_precursor_beacon_quest_seed($db);

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
            'INSERT INTO user_faction_quests (user_id, faction_quest_id, status, progress_json)
             VALUES (?, ?, \'active\', ? )'
        )->execute([$uid, $fqid, '{}']);

        json_ok(['message' => "Quest started: {$quest['title']}"]);
        break;

    // ── Auto-check quest completion ───────────────────────────────────────────
    case 'check_quests':
        only_method('POST');
        verify_csrf();
        $db      = get_db();
        ensure_precursor_beacon_quest_seed($db);
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
        ensure_precursor_beacon_quest_seed($db);

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

        if (($row['code'] ?? '') === 'precursor_wormhole_beacon') {
            $db->exec(
                'CREATE TABLE IF NOT EXISTS user_wormhole_unlocks (
                    user_id INT NOT NULL PRIMARY KEY,
                    source_quest_code VARCHAR(64) DEFAULT NULL,
                    unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB'
            );
            $db->prepare(
                'INSERT INTO user_wormhole_unlocks (user_id, source_quest_code, unlocked_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE source_quest_code = VALUES(source_quest_code), unlocked_at = VALUES(unlocked_at)'
            )->execute([$uid, (string)$row['code']]);
        }

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
                                         WHERE br.attacker_id = ? AND u.control_type = \'npc_engine\'
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
            $requiredTech = trim((string)($req['tech'] ?? ''));
            if ($requiredTech !== '') {
                $level = max(1, (int)($req['level'] ?? 1));
                $stmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=? LIMIT 1');
                $stmt->execute([$userId, $requiredTech]);
                return (int)($stmt->fetchColumn() ?: 0) >= $level;
            }
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

function ensure_precursor_beacon_quest_seed(PDO $db): void {
    try {
        $precursorIdStmt = $db->prepare('SELECT id FROM npc_factions WHERE code = ? LIMIT 1');
        $precursorIdStmt->execute(['precursors']);
        $precursorId = (int)($precursorIdStmt->fetchColumn() ?: 0);
        if ($precursorId <= 0) {
            return;
        }

        $db->prepare(
            'INSERT IGNORE INTO faction_quests
                (faction_id, code, title, description, quest_type, requirements_json,
                 reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
                 reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $precursorId,
            'precursor_wormhole_beacon',
            'Unlock the Ancient Beacon',
            'Decode precursor harmonics and stabilize an ancient beacon lattice to unlock permanent wormhole corridors.',
            'research',
            '{"tech":"wormhole_theory","level":5}',
            15000,
            12000,
            9000,
            0,
            500,
            180,
            18,
            80,
            'epic',
            0,
        ]);
    } catch (Throwable $e) {
        // Non-fatal: endpoint should continue even if seed backfill cannot run.
    }
}

function faction_dialog_trim_text(string $text, int $maxLen = 280): string {
    $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
    if ($text === '') {
        return '';
    }
    return strlen($text) > $maxLen ? substr($text, 0, $maxLen) : $text;
}

function faction_dialog_sanitize_history($history): array {
    if (!is_array($history)) {
        return [];
    }

    $clean = [];
    foreach ($history as $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $speaker = strtolower(trim((string)($entry['speaker'] ?? '')));
        if (!in_array($speaker, ['npc', 'player'], true)) {
            continue;
        }
        $text = faction_dialog_trim_text((string)($entry['text'] ?? ''), 280);
        if ($text === '') {
            continue;
        }
        $clean[] = ['speaker' => $speaker, 'text' => $text];
    }

    return array_slice($clean, -10);
}

function faction_dialog_standing_label(int $standing): string {
    if ($standing >= 50) return 'allied';
    if ($standing >= 10) return 'friendly';
    if ($standing >= -10) return 'neutral';
    if ($standing >= -50) return 'hostile';
    return 'war';
}

function faction_dialog_style_profile(array $faction): array {
    $type = strtolower((string)($faction['faction_type'] ?? 'neutral'));
    return match ($type) {
        'military' => [
            'tone' => 'formal, clipped, chain-of-command rhetoric',
            'values' => 'discipline, order, patrol duty, loyalty, strategic leverage',
            'motifs' => 'borders, patrol routes, banners, command, steel resolve',
            'reply_flavors' => 'respectful duty, practical service, stern pushback',
            'positive_keywords' => ['serve', 'duty', 'order', 'patrol', 'ally', 'secure', 'loyal', 'honor'],
            'negative_keywords' => ['chaos', 'refuse', 'smuggle', 'defy', 'pirate', 'raid', 'threaten'],
        ],
        'trade' => [
            'tone' => 'smooth, transactional, profit-minded, polished',
            'values' => 'margin, supply lines, contracts, reliability, leverage',
            'motifs' => 'cargo, ledgers, tariffs, routes, market access',
            'reply_flavors' => 'courteous deal-making, pragmatic bargaining, hard-nosed terms',
            'positive_keywords' => ['trade', 'deal', 'contract', 'cargo', 'profit', 'price', 'route', 'supply'],
            'negative_keywords' => ['steal', 'rob', 'waste', 'free', 'charity', 'threaten', 'raid'],
        ],
        'science' => [
            'tone' => 'precise, analytical, curious, lightly detached',
            'values' => 'evidence, discovery, field data, ruins, controlled risk',
            'motifs' => 'signals, anomalies, archives, probes, proofs',
            'reply_flavors' => 'collaborative inquiry, mission-focused evidence gathering, skeptical challenge',
            'positive_keywords' => ['research', 'data', 'survey', 'analyze', 'probe', 'study', 'discover', 'evidence'],
            'negative_keywords' => ['ignorance', 'superstition', 'destroy', 'burn', 'hide', 'threaten'],
        ],
        'pirate' => [
            'tone' => 'taunting, predatory, swaggering, opportunistic',
            'values' => 'strength, boldness, fear, spoils, fast advantage',
            'motifs' => 'booty, prey, ambush, tribute, blood in the void',
            'reply_flavors' => 'dangerous camaraderie, ruthless profit, blunt intimidation',
            'positive_keywords' => ['raid', 'strike', 'loot', 'spoils', 'tribute', 'strength', 'fear', 'hunt'],
            'negative_keywords' => ['law', 'peace', 'mercy', 'charity', 'weak', 'surrender', 'beg'],
        ],
        'ancient' => [
            'tone' => 'cryptic, ceremonial, patient, immense',
            'values' => 'rites, worthiness, memory, relics, cosmic perspective',
            'motifs' => 'echoes, thresholds, relics, veils, forgotten stars',
            'reply_flavors' => 'reverent petition, purposeful offering, audacious irreverence',
            'positive_keywords' => ['relic', 'offering', 'rite', 'memory', 'ancient', 'worthy', 'threshold', 'awaken'],
            'negative_keywords' => ['demand', 'mock', 'rush', 'cheap', 'threaten', 'break'],
        ],
        default => [
            'tone' => 'measured, political, faction-aware',
            'values' => 'advantage, caution, credibility',
            'motifs' => 'territory, envoys, leverage',
            'reply_flavors' => 'diplomatic, practical, skeptical',
            'positive_keywords' => ['ally', 'help', 'trade', 'trust'],
            'negative_keywords' => ['threat', 'refuse', 'attack'],
        ],
    };
}

function faction_dialog_detect_player_intent(string $playerInput): array {
    $text = strtolower(trim($playerInput));
    if ($text === '') {
        return ['primary' => 'opening', 'signals' => [], 'text' => ''];
    }

    $signals = [];
    $keywordMap = [
        'service' => ['help', 'assist', 'aid', 'support', 'need', 'task', 'job', 'mission', 'contract', 'work'],
        'trade' => ['trade', 'deal', 'price', 'cargo', 'market', 'buy', 'sell', 'profit', 'supply', 'shipment'],
        'research' => ['research', 'data', 'study', 'analyze', 'anomaly', 'survey', 'probe', 'ruin', 'artifact', 'technology'],
        'war' => ['fight', 'attack', 'strike', 'raid', 'battle', 'destroy', 'patrol', 'target', 'hunt'],
        'diplomacy' => ['ally', 'peace', 'trust', 'cooperate', 'treaty', 'negotiate', 'understand', 'respect'],
        'threat' => ['threat', 'extort', 'obey', 'or else', 'submit', 'surrender', 'fear', 'pay me'],
        'disrespect' => ['weak', 'fool', 'coward', 'pathetic', 'worthless', 'liar'],
    ];

    foreach ($keywordMap as $signal => $keywords) {
        foreach ($keywords as $keyword) {
            if (str_contains($text, $keyword)) {
                $signals[$signal] = ($signals[$signal] ?? 0) + 1;
            }
        }
    }

    if (!$signals) {
        return ['primary' => 'general', 'signals' => [], 'text' => $text];
    }

    arsort($signals);
    return ['primary' => (string)array_key_first($signals), 'signals' => $signals, 'text' => $text];
}

function faction_dialog_can_adjust_standing(PDO $db, int $userId, int $factionId, int $cooldownSeconds = 900): bool {
    $stmt = $db->prepare('SELECT last_event, last_event_at FROM diplomacy WHERE user_id=? AND faction_id=? LIMIT 1');
    $stmt->execute([$userId, $factionId]);
    $row = $stmt->fetch();
    if (!$row) {
        return true;
    }

    $lastEvent = (string)($row['last_event'] ?? '');
    $lastEventAt = strtotime((string)($row['last_event_at'] ?? '')) ?: 0;
    if (!str_starts_with($lastEvent, '[dialogue]')) {
        return true;
    }

    return $lastEventAt <= 0 || (time() - $lastEventAt) >= $cooldownSeconds;
}

function faction_dialog_score_standing_delta(array $faction, array $intent): array {
    $type = strtolower((string)($faction['faction_type'] ?? 'neutral'));
    $primary = (string)($intent['primary'] ?? 'general');
    $signals = (array)($intent['signals'] ?? []);
    $text = (string)($intent['text'] ?? '');
    $style = faction_dialog_style_profile($faction);
    $positiveHits = 0;
    foreach ((array)($style['positive_keywords'] ?? []) as $keyword) {
        if ($text !== '' && str_contains($text, strtolower((string)$keyword))) {
            $positiveHits++;
        }
    }
    $negativeHits = 0;
    foreach ((array)($style['negative_keywords'] ?? []) as $keyword) {
        if ($text !== '' && str_contains($text, strtolower((string)$keyword))) {
            $negativeHits++;
        }
    }

    if (isset($signals['disrespect']) || isset($signals['threat'])) {
        return ['delta' => -4, 'reason' => 'Your tone was read as a direct provocation.'];
    }
    if ($primary === 'general') {
        if ($positiveHits > $negativeHits && $positiveHits > 0) {
            return ['delta' => min(3, $positiveHits), 'reason' => 'You spoke in terms this faction instinctively values.'];
        }
        if ($negativeHits > $positiveHits && $negativeHits > 0) {
            return ['delta' => -min(3, $negativeHits), 'reason' => 'Your wording touched exactly the instincts this faction distrusts.'];
        }
    }

    return match ($type) {
        'military' => match ($primary) {
            'service' => ['delta' => 3, 'reason' => 'You spoke in terms of duty and useful service.'],
            'war' => ['delta' => 2, 'reason' => 'They respect clear resolve and readiness for conflict.'],
            'diplomacy' => ['delta' => 1, 'reason' => 'Measured diplomacy earned a cautious nod.'],
            default => ['delta' => 0, 'reason' => ''],
        },
        'trade' => match ($primary) {
            'trade' => ['delta' => 3, 'reason' => 'You approached them like a credible business partner.'],
            'service' => ['delta' => 2, 'reason' => 'Offering concrete help signaled reliability.'],
            'diplomacy' => ['delta' => 1, 'reason' => 'Polite negotiation improved the tone of talks.'],
            'war' => ['delta' => -2, 'reason' => 'Threatening commerce is bad for future margins.'],
            default => ['delta' => 0, 'reason' => ''],
        },
        'science' => match ($primary) {
            'research' => ['delta' => 3, 'reason' => 'Curiosity and evidence-driven language landed well.'],
            'service' => ['delta' => 2, 'reason' => 'You offered useful field support for their work.'],
            'diplomacy' => ['delta' => 1, 'reason' => 'A calm exchange kept them engaged.'],
            'war' => ['delta' => -2, 'reason' => 'Violence-first rhetoric undermined their trust.'],
            default => ['delta' => 0, 'reason' => ''],
        },
        'pirate' => match ($primary) {
            'war' => ['delta' => 3, 'reason' => 'Bold talk of force and spoils impressed them.'],
            'threat' => ['delta' => 1, 'reason' => 'They appreciate nerve, even when it is reckless.'],
            'trade' => ['delta' => 1, 'reason' => 'Profit still speaks in pirate space.'],
            'diplomacy' => ['delta' => -2, 'reason' => 'Soft diplomacy sounded weak to them.'],
            'service' => ['delta' => -1, 'reason' => 'Offering obedience without edge lowered their respect.'],
            default => ['delta' => 0, 'reason' => ''],
        },
        'ancient' => match ($primary) {
            'research' => ['delta' => 2, 'reason' => 'You treated their knowledge with due gravity.'],
            'service' => ['delta' => 2, 'reason' => 'An offering of effort fit their ritual logic.'],
            'diplomacy' => ['delta' => 1, 'reason' => 'Patience and restraint were noticed.'],
            'trade' => ['delta' => -1, 'reason' => 'Purely transactional language felt beneath the moment.'],
            'war' => ['delta' => -2, 'reason' => 'Crude threats clashed with their ceremonial posture.'],
            default => ['delta' => 0, 'reason' => ''],
        },
        default => match ($primary) {
            'diplomacy', 'service' => ['delta' => 1, 'reason' => 'The exchange moved in a constructive direction.'],
            'threat', 'war' => ['delta' => -2, 'reason' => 'Escalation hardened their stance.'],
            default => ['delta' => 0, 'reason' => ''],
        },
    };
}

function faction_dialog_list_hookable_quests(PDO $db, int $userId, int $factionId, int $standing): array {
    $stmt = $db->prepare(
        'SELECT q.*
         FROM faction_quests q
         WHERE q.faction_id = ?
           AND ? >= q.min_standing
           AND NOT EXISTS (
                SELECT 1 FROM user_faction_quests uq
                WHERE uq.user_id = ?
                  AND uq.faction_quest_id = q.id
                  AND uq.status IN (\'active\',\'completed\')
           )
           AND (
                q.repeatable = 1
                OR NOT EXISTS (
                    SELECT 1 FROM user_faction_quests uq2
                    WHERE uq2.user_id = ?
                      AND uq2.faction_quest_id = q.id
                      AND uq2.status = \'claimed\'
                )
           )
         ORDER BY FIELD(q.difficulty, \'easy\', \'medium\', \'hard\', \'epic\'), q.id'
    );
    $stmt->execute([$factionId, $standing, $userId, $userId]);
    return $stmt->fetchAll() ?: [];
}

function faction_dialog_pick_quest_hook(PDO $db, int $userId, array $faction, int $standing, array $intent, bool $openingTurn): ?array {
    $quests = faction_dialog_list_hookable_quests($db, $userId, (int)$faction['id'], $standing);
    if (!$quests) {
        return null;
    }

    $type = strtolower((string)($faction['faction_type'] ?? 'neutral'));
    $primary = (string)($intent['primary'] ?? 'opening');
    $difficultyScore = ['easy' => 4, 'medium' => 3, 'hard' => 2, 'epic' => 1];
    $typePreferences = match ($type) {
        'military' => ['kill', 'deliver', 'spy'],
        'trade' => ['deliver', 'build', 'explore'],
        'science' => ['explore', 'research', 'spy'],
        'pirate' => ['kill', 'spy', 'deliver'],
        'ancient' => ['deliver', 'research', 'explore'],
        default => ['deliver', 'explore', 'kill'],
    };
    $intentPreferences = match ($primary) {
        'service' => ['deliver', 'build', 'explore'],
        'trade' => ['deliver', 'build'],
        'research' => ['research', 'explore', 'spy'],
        'war' => ['kill', 'spy'],
        'diplomacy' => ['deliver', 'explore'],
        default => [],
    };

    $best = null;
    $bestScore = -1;
    foreach ($quests as $quest) {
        $questType = (string)($quest['quest_type'] ?? 'deliver');
        $score = $difficultyScore[(string)($quest['difficulty'] ?? 'medium')] ?? 0;
        $typeIndex = array_search($questType, $typePreferences, true);
        if ($typeIndex !== false) {
            $score += 10 - $typeIndex;
        }
        $intentIndex = array_search($questType, $intentPreferences, true);
        if ($intentIndex !== false) {
            $score += 7 - $intentIndex;
        }
        if ($openingTurn && (string)($quest['difficulty'] ?? '') === 'easy') {
            $score += 3;
        }

        if ($score > $bestScore) {
            $bestScore = $score;
            $best = $quest;
        }
    }

    if (!is_array($best)) {
        return null;
    }

    $hookLead = match ($type) {
        'military' => 'A service record could open more doors immediately.',
        'trade' => 'There is a live contract on the board right now.',
        'science' => 'A field assignment is available if you can produce evidence.',
        'pirate' => 'There is a profitable job if you have the nerve for it.',
        'ancient' => 'A threshold task waits for one deemed worthy.',
        default => 'There is actionable work available now.',
    };

    return [
        'quest_id' => (int)$best['id'],
        'title' => (string)$best['title'],
        'description' => (string)$best['description'],
        'difficulty' => (string)$best['difficulty'],
        'reward_standing' => (int)$best['reward_standing'],
        'hook_text' => $hookLead,
    ];
}

function faction_dialog_reply_templates(array $faction, array $context = []): array {
    $type = strtolower((string)($faction['faction_type'] ?? 'neutral'));
    $questHook = is_array($context['quest_hook'] ?? null) ? $context['quest_hook'] : null;
    $questTitle = trim((string)($questHook['title'] ?? ''));
    $questLead = $questTitle !== '' ? $questTitle : 'that assignment';

    return match ($type) {
        'military' => [
            'Give me the operation and I will execute it with discipline.',
            'Which border or patrol line needs to be secured first?',
            'If I earn your trust, I want clear orders and a real objective.',
            'Point me toward ' . $questLead . ' and I will prove my reliability.',
            'I respect chain of command, but I expect decisive leadership in return.',
        ],
        'trade' => [
            'Put the contract on the table and show me the margin.',
            'Which cargo lane matters enough to earn Guild trust?',
            'I can move the goods, but only if the risk is priced correctly.',
            'If ' . $questLead . ' is live, show me the manifest and the payout.',
            'I am interested in routes, leverage, and terms that benefit both sides.',
        ],
        'science' => [
            'Give me the anomaly coordinates and the data threshold you need.',
            'What evidence would the Collective accept as a valid result?',
            'I will bring back measurements, not guesses or superstition.',
            'If ' . $questLead . ' advances your research, brief me properly.',
            'Point me at the ruins, signal, or probe track worth investigating.',
        ],
        'pirate' => [
            'Name the prey and tell me what cut of the spoils is mine.',
            'Whose convoy bleeds first if we work together?',
            'I can be useful, but I do not raid for scraps.',
            'If ' . $questLead . ' pays in fear or loot, I am listening.',
            'Show me a target bold enough to be worth the risk.',
        ],
        'ancient' => [
            'Name the rite and I will decide whether to cross the threshold.',
            'What offering earns a truthful answer from your kind?',
            'I seek relics, memory, and purpose, not empty spectacle.',
            'If ' . $questLead . ' proves worthiness, speak the terms plainly.',
            'Point me toward the echo or relic that still matters.',
        ],
        default => [
            'Tell me what your faction actually needs from me.',
            'What outcome makes this alliance worth the cost?',
            'If there is an assignment here, name it clearly.',
            'I will cooperate when the terms and stakes are real.',
        ],
    };
}

function faction_dialog_reply_specificity_score(string $reply, array $faction): int {
    $reply = strtolower(trim($reply));
    if ($reply === '') {
        return 0;
    }

    $style = faction_dialog_style_profile($faction);
    $type = strtolower((string)($faction['faction_type'] ?? 'neutral'));
    $lexicon = array_merge(
        (array)($style['positive_keywords'] ?? []),
        (array)($style['negative_keywords'] ?? []),
        match ($type) {
            'military' => ['command', 'border', 'patrol', 'orders', 'frontier'],
            'trade' => ['contract', 'route', 'cargo', 'manifest', 'payout', 'guild'],
            'science' => ['evidence', 'anomaly', 'probe', 'data', 'collective', 'signal'],
            'pirate' => ['spoils', 'prey', 'raid', 'loot', 'tribute', 'convoy'],
            'ancient' => ['rite', 'threshold', 'relic', 'echo', 'worthy', 'memory'],
            default => ['alliance', 'faction', 'terms'],
        }
    );

    $score = 0;
    foreach ($lexicon as $keyword) {
        if (str_contains($reply, strtolower((string)$keyword))) {
            $score += 1;
        }
    }
    if (preg_match('/\b(i|we)\b/', $reply)) {
        $score += 1;
    }
    return $score;
}

function faction_dialog_finalize_replies(array $faction, array $suggested, array $context = []): array {
    $final = [];

    foreach (faction_dialog_reply_templates($faction, $context) as $reply) {
        $reply = faction_dialog_trim_text($reply, 90);
        if ($reply === '' || in_array($reply, $final, true)) {
            continue;
        }
        $final[] = $reply;
        if (count($final) >= 3) {
            break;
        }
    }

    if (count($final) < 3) {
        foreach ($suggested as $reply) {
            if (faction_dialog_reply_specificity_score($reply, $faction) < 3) {
                continue;
            }
            if (!in_array($reply, $final, true)) {
                $final[] = $reply;
            }
            if (count($final) >= 3) {
                break;
            }
        }
    }

    return array_slice($final, 0, 3);
}

function faction_dialog_apply_effects(PDO $db, int $userId, array $faction, int $standing, string $playerInput, bool $openingTurn): array {
    $intent = faction_dialog_detect_player_intent($playerInput);
    $standingChange = null;
    $currentStanding = $standing;

    if ($playerInput !== '' && faction_dialog_can_adjust_standing($db, $userId, (int)$faction['id'])) {
        $score = faction_dialog_score_standing_delta($faction, $intent);
        $delta = (int)($score['delta'] ?? 0);
        $reason = trim((string)($score['reason'] ?? ''));
        if ($delta !== 0 && $reason !== '') {
            update_standing($db, $userId, (int)$faction['id'], $delta, 'dialogue', $reason);
            $currentStanding = get_standing($db, $userId, (int)$faction['id']);
            gq_cache_delete('factions_list', ['uid' => $userId]);
            gq_cache_delete('faction_government', ['uid' => $userId, 'fid' => (int)$faction['id']]);
            gq_cache_flush('faction_trade_offers');
            $standingChange = [
                'delta' => $delta,
                'before' => $standing,
                'after' => $currentStanding,
                'reason' => $reason,
            ];
        }
    }

    $questHook = faction_dialog_pick_quest_hook($db, $userId, $faction, $currentStanding, $intent, $openingTurn);

    return [
        'standing' => $currentStanding,
        'standing_change' => $standingChange,
        'quest_hook' => $questHook,
        'player_intent' => $intent,
    ];
}

function faction_dialog_pick_model(): string {
    $preferred = ['phi3:latest', 'llama3.2:latest', 'llama3:latest', 'llama3.1:8b'];
    $result = ollama_list_models(['timeout' => 10]);
    if (!($result['ok'] ?? false)) {
        return (string) OLLAMA_DEFAULT_MODEL;
    }

    $available = array_map(static fn($name) => strtolower((string)$name), (array)($result['models'] ?? []));
    foreach ($preferred as $name) {
        if (in_array(strtolower($name), $available, true)) {
            return $name;
        }
    }

    return (string) OLLAMA_DEFAULT_MODEL;
}

function faction_dialog_history_to_text(array $history): string {
    if (!$history) {
        return '(opening turn, no prior messages)';
    }

    $lines = [];
    foreach (array_slice($history, -8) as $entry) {
        $prefix = $entry['speaker'] === 'player' ? 'PLAYER' : 'NPC';
        $lines[] = $prefix . ': ' . $entry['text'];
    }
    return implode("\n", $lines);
}

function faction_dialog_parse_payload(string $raw): ?array {
    $raw = trim($raw);
    if ($raw === '') {
        return null;
    }

    $raw = preg_replace('/^```(?:json)?\s*/i', '', $raw) ?? $raw;
    $raw = preg_replace('/\s*```$/', '', $raw) ?? $raw;
    $raw = trim($raw);

    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        return $decoded;
    }

    if (preg_match('/\{.*\}/s', $raw, $match)) {
        $decoded = json_decode($match[0], true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    return null;
}

function faction_dialog_fallback(array $faction, int $standing, array $history, ?array $context = null): array {
    $name = (string)($faction['name'] ?? 'Unknown Faction');
    $type = (string)($faction['faction_type'] ?? 'neutral');
    $standingLabel = faction_dialog_standing_label($standing);
    $style = faction_dialog_style_profile($faction);
    $questHook = is_array($context['quest_hook'] ?? null) ? $context['quest_hook'] : null;
    $lastPlayer = '';
    for ($i = count($history) - 1; $i >= 0; $i--) {
        if (($history[$i]['speaker'] ?? '') === 'player') {
            $lastPlayer = (string)$history[$i]['text'];
            break;
        }
    }

    if ($lastPlayer === '') {
        $npcMessage = sprintf(
            '%s acknowledges your channel in a %s manner. We currently judge you as %s. State your intent clearly.',
            $name,
            $style['tone'],
            $standingLabel
        );
    } else {
        $npcMessage = sprintf(
            '%s weighs your words: "%s". Our posture remains %s, but the channel stays open.',
            $name,
            faction_dialog_trim_text($lastPlayer, 90),
            $standingLabel
        );
    }

    if ($questHook) {
        $npcMessage .= ' ' . faction_dialog_trim_text((string)($questHook['hook_text'] ?? ''), 120);
    }

    $suggestedReplies = match (strtolower($type)) {
        'military' => [
            'Assign me a target and I will prove my discipline.',
            'What operation advances your border right now?',
            'If I help, I expect clear terms and command authority.',
        ],
        'trade' => [
            'Show me the contract and I will price the risk.',
            'Which route or cargo matters most to you?',
            'If I invest effort here, what margin do I secure?',
        ],
        'science' => [
            'Point me toward the anomaly worth investigating.',
            'What evidence would make you trust my report?',
            'I will help, but I want the data and the truth.',
        ],
        'pirate' => [
            'Name the prey and tell me what share is mine.',
            'Who needs to fear us first?',
            'I am listening, but I do not bleed for free.',
        ],
        'ancient' => [
            'Name the rite and I will decide if I cross it.',
            'What offering earns a true answer from you?',
            'Speak plainly: what test stands before me?',
        ],
        default => [
            'Tell me what your faction actually needs.',
            'What do we gain if we cooperate?',
            'Give me one reason to trust your offer.',
        ],
    };

    return [
        'npc_message' => $npcMessage,
        'suggested_replies' => $suggestedReplies,
        'fallback' => true,
    ];
}

function faction_dialog_generate_turn(array $faction, int $standing, array $history, array $context = []): array {
    $model = faction_dialog_pick_model();
    $style = faction_dialog_style_profile($faction);
    $questHook = is_array($context['quest_hook'] ?? null) ? $context['quest_hook'] : null;
    $standingChange = is_array($context['standing_change'] ?? null) ? $context['standing_change'] : null;

    if (!ollama_is_enabled()) {
        $fallback = faction_dialog_fallback($faction, $standing, $history, $context);
        $fallback['model'] = $model;
        return $fallback;
    }

    $standingLabel = faction_dialog_standing_label($standing);
    $isOpeningTurn = (bool)($context['opening_turn'] ?? false);

    $systemPrompt = implode("\n", [
        'You are the in-world diplomatic spokesperson of a GalaxyQuest faction.',
        'Stay fully in character for the faction described below.',
        'Your voice must be unmistakably specific to this faction, not generic sci-fi diplomacy.',
        'You must always return valid JSON and nothing else.',
        'Schema: {"npc_message":"string","suggested_replies":["a","b","c"]}',
        'Rules:',
        '- npc_message: 1 or 2 short sentences, max 320 characters.',
        '- suggested_replies: exactly 3 short player replies, each max 90 characters.',
        '- The three replies must be meaningfully different in tone and still sound tailored to this faction\'s worldview.',
        '- Do not include labels like "diplomatic", "skeptical", or parentheses in the reply text.',
        '- Never write markdown, bullets, code fences, labels, or explanations outside the JSON object.',
        '- The player replies are first-person lines the player could click in an RPG conversation.',
        '- Use the supplied faction voice profile strongly: diction, metaphors, values, and pressure points should be obvious.',
        '- If a quest hook is supplied, you may hint at it naturally in the npc_message, but stay in character.',
    ]);

    $promptLines = [
        'Faction profile:',
        'name=' . (string)$faction['name'],
        'type=' . (string)$faction['faction_type'],
        'description=' . (string)$faction['description'],
        'aggression=' . (int)$faction['aggression'],
        'trade_willingness=' . (int)$faction['trade_willingness'],
        'power_level=' . (int)$faction['power_level'],
        'voice_tone=' . $style['tone'],
        'voice_values=' . $style['values'],
        'voice_motifs=' . $style['motifs'],
        'reply_flavors=' . $style['reply_flavors'],
        'player_standing=' . $standing . ' (' . $standingLabel . ')',
        'turn_type=' . ($isOpeningTurn ? 'opening_npc_starts' : 'follow_up_npc_reacts'),
        'conversation_history=',
        faction_dialog_history_to_text($history),
    ];

    if ($standingChange) {
        $promptLines[] = 'recent_standing_change=' . ($standingChange['delta'] >= 0 ? '+' : '') . (int)$standingChange['delta'] . ' because ' . (string)$standingChange['reason'];
    }
    if ($questHook) {
        $promptLines[] = 'available_quest_hook=' . (string)$questHook['title'] . ' | ' . (string)$questHook['description'];
    }
    if (is_array($context['player_intent'] ?? null)) {
        $promptLines[] = 'player_intent=' . (string)(($context['player_intent']['primary'] ?? 'general'));
    }

    $userPrompt = implode("\n", $promptLines);

    $llm = ollama_chat([
        ['role' => 'system', 'content' => $systemPrompt],
        ['role' => 'user', 'content' => $userPrompt],
    ], [
        'model' => $model,
        'format' => 'json',
        'temperature' => 0.35,
        'timeout' => 35,
        'options' => ['num_predict' => 180],
    ]);

    if (!($llm['ok'] ?? false)) {
        $fallback = faction_dialog_fallback($faction, $standing, $history, $context);
        $fallback['model'] = $model;
        return $fallback;
    }

    $payload = faction_dialog_parse_payload((string)($llm['text'] ?? ''));
    if (!is_array($payload)) {
        $fallback = faction_dialog_fallback($faction, $standing, $history, $context);
        $fallback['model'] = $model;
        return $fallback;
    }

    $npcMessage = faction_dialog_trim_text((string)($payload['npc_message'] ?? ''), 320);
    $suggested = [];
    foreach ((array)($payload['suggested_replies'] ?? []) as $reply) {
        $reply = preg_replace('/\s*\([^)]*\)\s*/', ' ', (string)$reply) ?? (string)$reply;
        $reply = preg_replace('/^["\']+|["\']+$/', '', $reply) ?? $reply;
        $reply = faction_dialog_trim_text($reply, 90);
        if ($reply === '') {
            continue;
        }
        if (!in_array($reply, $suggested, true)) {
            $suggested[] = $reply;
        }
    }

    $suggested = faction_dialog_finalize_replies($faction, $suggested, $context);

    if ($npcMessage === '' || count($suggested) < 3) {
        $fallback = faction_dialog_fallback($faction, $standing, $history, $context);
        $fallback['model'] = $model;
        return $fallback;
    }

    return [
        'npc_message' => $npcMessage,
        'suggested_replies' => array_slice($suggested, 0, 3),
        'model' => $model,
        'fallback' => false,
    ];
}
