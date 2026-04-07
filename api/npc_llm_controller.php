<?php

declare(strict_types=1);

require_once __DIR__ . '/ollama_client.php';

/**
 * Attempts one LLM-guided PvE decision for a single NPC faction and user.
 * Returns ['handled' => bool, 'reason' => string, 'decision' => array].
 */
function npc_pve_llm_controller_try(PDO $db, int $userId, array $faction): array {
    if (!npc_pve_llm_controller_enabled()) {
        return ['handled' => false, 'reason' => 'disabled'];
    }

    $cooldown = max(60, (int) NPC_LLM_CONTROLLER_COOLDOWN_SECONDS);
    if (!npc_pve_llm_cooldown_ready($db, $userId, (int) $faction['id'], $cooldown)) {
        return ['handled' => false, 'reason' => 'cooldown'];
    }

    $standing = npc_pve_get_standing($db, $userId, (int) $faction['id']);
    $snapshot = npc_pve_build_player_snapshot($db, $userId, (int) $faction['id']);
    $prompt = npc_pve_build_prompt($userId, $faction, $standing, $snapshot);

    $llm = ollama_generate($prompt, [
        'timeout' => max(4, (int) NPC_LLM_CONTROLLER_TIMEOUT_SECONDS),
        'temperature' => 0.2,
        'options' => [
            'num_predict' => 220,
        ],
    ]);

    if (!($llm['ok'] ?? false)) {
        npc_pve_log_decision($db, [
            'user_id' => $userId,
            'faction_id' => (int) $faction['id'],
            'faction_code' => (string) ($faction['code'] ?? ''),
            'action_key' => 'none',
            'confidence' => 0.0,
            'standing_before' => $standing,
            'standing_after' => $standing,
            'status' => 'error',
            'reasoning' => substr((string) ($llm['error'] ?? 'LLM error'), 0, 600),
            'raw_output' => '',
            'executed' => 0,
            'error_message' => substr((string) ($llm['error'] ?? 'LLM error'), 0, 255),
        ]);
        return ['handled' => false, 'reason' => 'llm_error'];
    }

    $raw = trim((string) ($llm['text'] ?? ''));
    $decoded = npc_pve_decode_decision($raw);
    if ($decoded === null) {
        npc_pve_log_decision($db, [
            'user_id' => $userId,
            'faction_id' => (int) $faction['id'],
            'faction_code' => (string) ($faction['code'] ?? ''),
            'action_key' => 'none',
            'confidence' => 0.0,
            'standing_before' => $standing,
            'standing_after' => $standing,
            'status' => 'error',
            'reasoning' => 'Invalid JSON decision payload.',
            'raw_output' => substr($raw, 0, 1800),
            'executed' => 0,
            'error_message' => 'invalid_json',
        ]);
        return ['handled' => false, 'reason' => 'invalid_json'];
    }

    $decision = npc_pve_normalize_decision($decoded);
    if (($decision['confidence'] ?? 0.0) < (float) NPC_LLM_CONTROLLER_MIN_CONFIDENCE) {
        npc_pve_log_decision($db, [
            'user_id' => $userId,
            'faction_id' => (int) $faction['id'],
            'faction_code' => (string) ($faction['code'] ?? ''),
            'action_key' => (string) $decision['action'],
            'confidence' => (float) $decision['confidence'],
            'standing_before' => $standing,
            'standing_after' => $standing,
            'status' => 'ok',
            'reasoning' => substr((string) ($decision['reason'] ?? ''), 0, 600),
            'raw_output' => substr($raw, 0, 1800),
            'executed' => 0,
            'error_message' => 'low_confidence',
        ]);
        return ['handled' => false, 'reason' => 'low_confidence', 'decision' => $decision];
    }

    $apply = npc_pve_apply_decision($db, $userId, $faction, $standing, $decision);

    npc_pve_log_decision($db, [
        'user_id' => $userId,
        'faction_id' => (int) $faction['id'],
        'faction_code' => (string) ($faction['code'] ?? ''),
        'action_key' => (string) $decision['action'],
        'confidence' => (float) $decision['confidence'],
        'standing_before' => $standing,
        'standing_after' => (int) ($apply['standing_after'] ?? $standing),
        'status' => ($apply['ok'] ?? false) ? 'ok' : 'error',
        'reasoning' => substr((string) ($decision['reason'] ?? ''), 0, 600),
        'raw_output' => substr($raw, 0, 1800),
        'executed' => !empty($apply['executed']) ? 1 : 0,
        'error_message' => substr((string) ($apply['error'] ?? ''), 0, 255),
    ]);

    return [
        'handled' => !empty($apply['executed']),
        'reason' => (string) ($apply['reason'] ?? 'no_effect'),
        'decision' => $decision,
    ];
}

function npc_pve_llm_controller_enabled(): bool {
    return (int) NPC_LLM_CONTROLLER_ENABLED === 1 && ollama_is_enabled();
}

function npc_pve_llm_cooldown_ready(PDO $db, int $userId, int $factionId, int $cooldown): bool {
    $sql = <<<'SQL'
SELECT created_at
FROM npc_llm_decision_log
WHERE user_id = ? AND faction_id = ?
ORDER BY id DESC
LIMIT 1
SQL;

    try {
        $stmt = $db->prepare($sql);
        $stmt->execute([$userId, $factionId]);
        $last = $stmt->fetchColumn();
        if (!$last) {
            return true;
        }
        $ts = strtotime((string) $last);
        if ($ts === false) {
            return true;
        }
        return (time() - $ts) >= $cooldown;
    } catch (Throwable $e) {
        return true;
    }
}

function npc_pve_get_standing(PDO $db, int $userId, int $factionId): int {
    $stmt = $db->prepare('SELECT standing FROM diplomacy WHERE user_id = ? AND faction_id = ? LIMIT 1');
    $stmt->execute([$userId, $factionId]);
    $row = $stmt->fetch();
    if ($row && isset($row['standing'])) {
        return (int) $row['standing'];
    }

    $base = $db->prepare('SELECT base_diplomacy FROM npc_factions WHERE id = ? LIMIT 1');
    $base->execute([$factionId]);
    return (int) ($base->fetchColumn() ?: 0);
}

function npc_pve_build_player_snapshot(PDO $db, int $userId, int $factionId): array {
    $colony = $db->prepare(
        'SELECT COUNT(*) AS cnt,
                COALESCE(SUM(metal), 0) AS metal,
                COALESCE(SUM(crystal), 0) AS crystal,
                COALESCE(SUM(deuterium), 0) AS deuterium,
                COALESCE(SUM(rare_earth), 0) AS rare_earth,
                COALESCE(SUM(food), 0) AS food,
                COALESCE(AVG(happiness), 0) AS avg_happiness,
                COALESCE(AVG(public_services), 0) AS avg_services
         FROM colonies
         WHERE user_id = ?'
    );
    $colony->execute([$userId]);
    $c = $colony->fetch() ?: [];

    $offers = $db->prepare(
        'SELECT COUNT(*) FROM trade_offers
         WHERE faction_id = ? AND active = 1 AND valid_until > NOW()'
    );
    $offers->execute([$factionId]);

    $quests = $db->prepare(
        'SELECT COUNT(*)
         FROM user_faction_quests uq
         JOIN faction_quests fq ON fq.id = uq.faction_quest_id
         WHERE uq.user_id = ? AND fq.faction_id = ? AND uq.status IN (\'active\', \'completed\')'
    );
    $quests->execute([$userId, $factionId]);

    return [
        'colonies' => (int) ($c['cnt'] ?? 0),
        'resources' => [
            'metal' => (int) ($c['metal'] ?? 0),
            'crystal' => (int) ($c['crystal'] ?? 0),
            'deuterium' => (int) ($c['deuterium'] ?? 0),
            'rare_earth' => (int) ($c['rare_earth'] ?? 0),
            'food' => (int) ($c['food'] ?? 0),
        ],
        'avg_happiness' => round((float) ($c['avg_happiness'] ?? 0), 1),
        'avg_services' => round((float) ($c['avg_services'] ?? 0), 1),
        'active_trade_offers' => (int) $offers->fetchColumn(),
        'active_or_completed_quests' => (int) $quests->fetchColumn(),
    ];
}

function npc_pve_build_prompt(int $userId, array $faction, int $standing, array $snapshot): string {
    $instructions = [
        'You are the PvE controller for non-player factions in GalaxyQuest.',
        'Decide exactly one action for this faction against this player.',
        'Return ONLY strict JSON (no markdown) with keys:',
        '{"action":"none|trade_offer|raid|diplomacy_shift|send_message","confidence":0.0,"delta_standing":0,"subject":"","message":"","reason":""}',
        'Rules:',
        '- Use raid only for pirate factions.',
        '- Use trade_offer primarily for trade/science factions.',
        '- delta_standing range: -8..8 (integers).',
        '- Keep message short and in-universe.',
    ];

    $factionContext = [
        'id' => (int) ($faction['id'] ?? 0),
        'code' => (string) ($faction['code'] ?? ''),
        'name' => (string) ($faction['name'] ?? ''),
        'type' => (string) ($faction['faction_type'] ?? ''),
        'aggression' => (int) ($faction['aggression'] ?? 50),
        'trade_willingness' => (int) ($faction['trade_willingness'] ?? 50),
        'power_level' => (int) ($faction['power_level'] ?? 1000),
        'base_diplomacy' => (int) ($faction['base_diplomacy'] ?? 0),
    ];

    // Enrich with lore data from spec if available.
    $factionCode = (string) ($faction['code'] ?? '');
    if ($factionCode !== '') {
        try {
            require_once __DIR__ . '/llm_soc/FactionSpecLoader.php';
            $specLoader = new FactionSpecLoader();
            $spec = $specLoader->loadFactionSpec($factionCode);
            if (!empty($spec['description'])) {
                $factionContext['lore_description'] = (string) $spec['description'];
            }
            $society = $spec['society'] ?? [];
            if (!empty($society['government'])) {
                $factionContext['lore_government'] = (string) $society['government'];
            }
            if (!empty($society['culture'])) {
                $factionContext['lore_culture'] = (string) $society['culture'];
            }
        } catch (\Throwable $e) {
            // Spec not available – proceed with numeric values only.
        }
    }

    $context = [
        'player_id' => $userId,
        'faction' => $factionContext,
        'standing' => $standing,
        'player_snapshot' => $snapshot,
    ];

    return implode("\n", $instructions) . "\n\nCONTEXT:\n" . json_encode($context, JSON_UNESCAPED_UNICODE);
}

function npc_pve_decode_decision(string $raw): ?array {
    if ($raw === '') {
        return null;
    }

    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        return $decoded;
    }

    if (preg_match('/\{.*\}/s', $raw, $m) !== 1) {
        return null;
    }

    $decoded = json_decode($m[0], true);
    return is_array($decoded) ? $decoded : null;
}

function npc_pve_normalize_decision(array $decision): array {
    $action = strtolower(trim((string) ($decision['action'] ?? 'none')));
    $allowed = ['none', 'trade_offer', 'raid', 'diplomacy_shift', 'send_message'];
    if (!in_array($action, $allowed, true)) {
        $action = 'none';
    }

    $confidence = (float) ($decision['confidence'] ?? 0);
    $confidence = max(0.0, min(1.0, $confidence));

    $delta = (int) ($decision['delta_standing'] ?? 0);
    $delta = max(-8, min(8, $delta));

    $subject = trim((string) ($decision['subject'] ?? 'Faction Transmission'));
    $message = trim((string) ($decision['message'] ?? 'No operational update.'));
    $reason = trim((string) ($decision['reason'] ?? ''));

    return [
        'action' => $action,
        'confidence' => $confidence,
        'delta_standing' => $delta,
        'subject' => $subject,
        'message' => $message,
        'reason' => $reason,
    ];
}

function npc_pve_apply_decision(PDO $db, int $userId, array $faction, int $standingBefore, array $decision): array {
    $fid = (int) $faction['id'];
    $action = (string) ($decision['action'] ?? 'none');
    $type = (string) ($faction['faction_type'] ?? '');

    // Soft policy guardrails by faction type.
    if ($type === 'trade' && $action === 'raid') {
        return ['ok' => true, 'executed' => false, 'reason' => 'trade_faction_no_raid', 'standing_after' => $standingBefore];
    }
    if ($type === 'science' && $action === 'raid') {
        return ['ok' => true, 'executed' => false, 'reason' => 'science_faction_no_raid', 'standing_after' => $standingBefore];
    }
    if ($type === 'military' && $action === 'trade_offer' && (int) ($faction['trade_willingness'] ?? 0) < 40) {
        return ['ok' => true, 'executed' => false, 'reason' => 'military_low_trade_willingness', 'standing_after' => $standingBefore];
    }
    if ($type === 'pirate' && $action === 'trade_offer' && $standingBefore < -40) {
        return ['ok' => true, 'executed' => false, 'reason' => 'pirate_hostile_no_trade', 'standing_after' => $standingBefore];
    }

    switch ($action) {
        case 'trade_offer':
            if ((int) ($faction['trade_willingness'] ?? 0) < 20) {
                return ['ok' => true, 'executed' => false, 'reason' => 'not_trade_ready', 'standing_after' => $standingBefore];
            }

            $activeOffers = npc_pve_count_active_offers($db, $fid);
            if ($activeOffers >= 3) {
                return ['ok' => true, 'executed' => false, 'reason' => 'too_many_active_offers', 'standing_after' => $standingBefore];
            }

            generate_trade_offer($db, $faction);
            npc_pve_send_message(
                $db,
                $userId,
                $decision['subject'] ?: ($faction['name'] . ': New Trade Terms'),
                $decision['message'] ?: 'A new trade opportunity has been issued by our envoys.'
            );
            return ['ok' => true, 'executed' => true, 'reason' => 'trade_offer_created', 'standing_after' => $standingBefore];

        case 'raid':
            if ((string) ($faction['faction_type'] ?? '') !== 'pirate') {
                return ['ok' => true, 'executed' => false, 'reason' => 'invalid_for_faction', 'standing_after' => $standingBefore];
            }
            if ($standingBefore > -15) {
                return ['ok' => true, 'executed' => false, 'reason' => 'standing_not_hostile_enough', 'standing_after' => $standingBefore];
            }
            maybe_pirate_raid($db, $userId, $faction);
            return ['ok' => true, 'executed' => true, 'reason' => 'raid_executed', 'standing_after' => npc_pve_get_standing($db, $userId, $fid)];

        case 'diplomacy_shift':
            require_once __DIR__ . '/factions.php';
            $delta = (int) ($decision['delta_standing'] ?? 0);
            if ($delta === 0) {
                return ['ok' => true, 'executed' => false, 'reason' => 'zero_delta', 'standing_after' => $standingBefore];
            }
            update_standing($db, $userId, $fid, $delta, 'npc_llm', substr((string) ($decision['reason'] ?? 'Diplomatic recalibration.'), 0, 90));
            return ['ok' => true, 'executed' => true, 'reason' => 'standing_updated', 'standing_after' => npc_pve_get_standing($db, $userId, $fid)];

        case 'send_message':
            npc_pve_send_message($db, $userId, $decision['subject'], $decision['message']);
            return ['ok' => true, 'executed' => true, 'reason' => 'message_sent', 'standing_after' => $standingBefore];

        default:
            return ['ok' => true, 'executed' => false, 'reason' => 'none', 'standing_after' => $standingBefore];
    }
}

function npc_pve_count_active_offers(PDO $db, int $factionId): int {
    $stmt = $db->prepare(
        'SELECT COUNT(*)
         FROM trade_offers
         WHERE faction_id = ? AND active = 1 AND valid_until > NOW()'
    );
    $stmt->execute([$factionId]);
    return (int) $stmt->fetchColumn();
}

function npc_pve_send_message(PDO $db, int $userId, string $subject, string $body): void {
    $subject = trim($subject) !== '' ? trim($subject) : 'Faction Transmission';
    $body = trim($body) !== '' ? trim($body) : 'No additional details provided.';

    $db->prepare('INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)')
        ->execute([$userId, substr($subject, 0, 220), substr($body, 0, 1800)]);
}

/**
 * Logs decision metadata. Fails silently if table is not present yet.
 *
 * @param array<string, mixed> $row
 */
function npc_pve_log_decision(PDO $db, array $row): void {
    $sql = <<<'SQL'
INSERT INTO npc_llm_decision_log
(user_id, faction_id, faction_code, action_key, confidence,
 standing_before, standing_after, status, reasoning, raw_output,
 executed, error_message)
VALUES
(:user_id, :faction_id, :faction_code, :action_key, :confidence,
 :standing_before, :standing_after, :status, :reasoning, :raw_output,
 :executed, :error_message)
SQL;

    try {
        $stmt = $db->prepare($sql);
        $stmt->execute([
            ':user_id' => (int) ($row['user_id'] ?? 0),
            ':faction_id' => (int) ($row['faction_id'] ?? 0),
            ':faction_code' => (string) ($row['faction_code'] ?? ''),
            ':action_key' => (string) ($row['action_key'] ?? 'none'),
            ':confidence' => (float) ($row['confidence'] ?? 0),
            ':standing_before' => (int) ($row['standing_before'] ?? 0),
            ':standing_after' => (int) ($row['standing_after'] ?? 0),
            ':status' => (string) ($row['status'] ?? 'ok'),
            ':reasoning' => (string) ($row['reasoning'] ?? ''),
            ':raw_output' => (string) ($row['raw_output'] ?? ''),
            ':executed' => (int) ($row['executed'] ?? 0),
            ':error_message' => (string) ($row['error_message'] ?? ''),
        ]);
    } catch (Throwable $e) {
        // Optional diagnostics only.
    }
}
