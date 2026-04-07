<?php
/**
 * Achievements / Quest API
 *
 * GET  /api/achievements.php?action=list   – all achievements + user progress
 * POST /api/achievements.php?action=claim  – collect reward for a completed quest
 * POST /api/achievements.php?action=check  – re-evaluate all conditions for current user
 *
 * The check logic is also exported as check_and_update_achievements() so that
 * buildings.php, research.php and fleet.php can trigger it inline after
 * completing relevant actions.
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/cache.php';

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    $uid    = require_auth();

    switch ($action) {
        // ── List all achievements with this user's progress ───────────────────────
        case 'list':
            only_method('GET');
            $db = get_db();
            $cacheKeyParams = ['uid' => $uid];
            $cached = gq_cache_get('achievements_list', $cacheKeyParams);
            if (is_array($cached) && isset($cached['achievements'])) {
                json_ok($cached);
            }
            // Auto-check before returning so the client always sees fresh state
            check_and_update_achievements($db, $uid);
            $payload = ['achievements' => fetch_achievements_for_user($db, $uid)];
            gq_cache_set('achievements_list', $cacheKeyParams, $payload, CACHE_TTL_DEFAULT);
            json_ok($payload);
            break;

        // ── Claim the reward for one completed achievement ────────────────────────
        case 'claim':
            only_method('POST');
            verify_csrf();
            $body = get_json_body();
            $aid  = (int)($body['achievement_id'] ?? 0);
            $db   = get_db();

            // Fetch the user_achievements row
            $stmt = $db->prepare(
                'SELECT ua.id, ua.completed, ua.reward_claimed,
                        a.title, a.reward_metal, a.reward_crystal,
                        a.reward_deuterium, a.reward_dark_matter, a.reward_rank_points
                 FROM user_achievements ua
                 JOIN achievements a ON a.id = ua.achievement_id
                 WHERE ua.user_id = ? AND ua.achievement_id = ?'
            );
            $stmt->execute([$uid, $aid]);
            $row = $stmt->fetch();

            if (!$row) {
                json_error('Achievement not found.', 404);
            }
            if (!$row['completed']) {
                json_error('Achievement not yet completed.');
            }
            if ($row['reward_claimed']) {
                json_error('Reward already claimed.');
            }

            grant_achievement_reward($db, $uid, $aid, $row);
            gq_cache_delete('achievements_list', ['uid' => $uid]);
            json_ok(['message' => '🏆 Reward claimed for: ' . $row['title']]);
            break;

        // ── Re-check all conditions and mark newly completed achievements ─────────
        case 'check':
            only_method('POST');
            verify_csrf();
            $db      = get_db();
            $newlyDone = check_and_update_achievements($db, $uid);
            gq_cache_delete('achievements_list', ['uid' => $uid]);
            json_ok(['newly_completed' => $newlyDone]);
            break;

        default:
            json_error('Unknown action');
    }
}

// ─── Core engine (also used by other API files via require_once) ──────────────

/**
 * Evaluate every achievement condition for $userId and update progress.
 * Returns an array of achievement IDs that were newly completed this call.
 *
 * Safe to call frequently – all queries are indexed and the function only
 * writes when state actually changes.
 */
function check_and_update_achievements(PDO $db, int $userId): array
{
    ensure_user_achievements_seeded($db, $userId);

    $rows = $db->prepare(
        'SELECT ua.id AS ua_id, ua.achievement_id, ua.completed, ua.progress,
                a.code, a.reward_metal, a.reward_crystal,
                a.reward_deuterium, a.reward_dark_matter, a.reward_rank_points,
                a.title
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         WHERE ua.user_id = ? AND ua.completed = 0'
    );
    $rows->execute([$userId]);
    $pending = $rows->fetchAll();

    $newlyCompleted = [];

    foreach ($pending as $row) {
        $result = evaluate_achievement($db, $userId, $row['code']);

        // Update progress even if not yet complete
        if ((int)$result['progress'] !== (int)$row['progress']) {
            $db->prepare(
                'UPDATE user_achievements SET progress = ? WHERE id = ?'
            )->execute([$result['progress'], $row['ua_id']]);
        }

        if ($result['completed']) {
            $db->prepare(
                'UPDATE user_achievements
                 SET completed = 1, completed_at = NOW(), progress = ?
                 WHERE id = ?'
            )->execute([$result['goal'], $row['ua_id']]);

            $newlyCompleted[] = $row['achievement_id'];

            // Send in-game notification message
            send_achievement_notification($db, $userId, $row);
        }
    }

    return $newlyCompleted;
}

/**
 * Seed user_achievements rows for any achievements the user does not yet have.
 */
function ensure_user_achievements_seeded(PDO $db, int $userId): void
{
    $db->prepare(
        'INSERT IGNORE INTO user_achievements (user_id, achievement_id)
         SELECT ?, id FROM achievements'
    )->execute([$userId]);
}

/**
 * Return all achievements with per-user state, grouped by category.
 */
function fetch_achievements_for_user(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        'SELECT a.id, a.code, a.category, a.title, a.description,
                a.reward_metal, a.reward_crystal, a.reward_deuterium,
                a.reward_dark_matter, a.reward_rank_points, a.sort_order,
                COALESCE(ua.completed, 0)      AS completed,
                COALESCE(ua.reward_claimed, 0) AS reward_claimed,
                COALESCE(ua.progress, 0)       AS progress,
                ua.completed_at
         FROM achievements a
         LEFT JOIN user_achievements ua
               ON ua.achievement_id = a.id AND ua.user_id = ?
         ORDER BY a.sort_order ASC'
    );
    $stmt->execute([$userId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Append active / completed faction quests so they appear in the quests window.
    $fqRows = fetch_faction_quests_as_achievements($db, $userId);
    return array_merge($rows, $fqRows);
}

/**
 * Return the player's active and completed-but-unclaimed faction quests shaped
 * as achievement-like rows so they can be rendered in the quests window.
 *
 * Extra fields:
 *   source         = 'faction_quest'   (signals the claim route to the JS layer)
 *   user_quest_id  = user_faction_quests.id  (needed for claimFactionQuest())
 *   goal           = 1                 (faction quests are pass/fail)
 *   reward_standing = fq.reward_standing
 */
function fetch_faction_quests_as_achievements(PDO $db, int $userId): array
{
    // Gracefully return nothing if the table is missing (migration not yet run).
    try {
        $stmt = $db->prepare(
            'SELECT uq.id              AS user_quest_id,
                    uq.status,
                    fq.id              AS id,
                    fq.code,
                    \'faction\'        AS category,
                    fq.title,
                    fq.description,
                    fq.reward_metal, fq.reward_crystal, fq.reward_deuterium,
                    fq.reward_dark_matter, fq.reward_rank_points,
                    fq.reward_standing,
                    999                AS sort_order,  -- faction quests sort after all achievements
                    (uq.status IN (\'completed\',\'claimed\')) AS completed,
                    (uq.status = \'claimed\')                  AS reward_claimed,
                    1                  AS progress,
                    1                  AS goal,
                    uq.completed_at,
                    \'faction_quest\'  AS source
               FROM user_faction_quests uq
               JOIN faction_quests fq ON fq.id = uq.faction_quest_id
              WHERE uq.user_id = ?
                AND uq.status IN (\'active\',\'completed\',\'claimed\')
              ORDER BY uq.id ASC'
        );
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $_) {
        return [];
    }
}

/**
 * Grant resources / dark matter / rank points and mark reward as claimed.
 */
function grant_achievement_reward(PDO $db, int $userId, int $achievementId,
                                  array $row): void
{
    // Credit resources to homeworld colony (or first colony)
    if ($row['reward_metal'] || $row['reward_crystal'] || $row['reward_deuterium']) {
        $cid = $db->prepare(
            'SELECT id FROM colonies WHERE user_id = ?
             ORDER BY is_homeworld DESC, id ASC LIMIT 1'
        );
        $cid->execute([$userId]);
        $colonyId = $cid->fetchColumn();
        if ($colonyId) {
            $db->prepare(
                'UPDATE colonies
                 SET metal     = metal     + ?,
                     crystal   = crystal   + ?,
                     deuterium = deuterium + ?
                 WHERE id = ?'
            )->execute([
                $row['reward_metal'],
                $row['reward_crystal'],
                $row['reward_deuterium'],
                $colonyId,
            ]);
        }
    }

    // Credit dark matter + rank points to user
    $db->prepare(
        'UPDATE users
         SET dark_matter  = dark_matter  + ?,
             rank_points  = rank_points  + ?
         WHERE id = ?'
    )->execute([
        $row['reward_dark_matter'],
        $row['reward_rank_points'],
        $userId,
    ]);

    // Mark claimed
    $db->prepare(
        'UPDATE user_achievements
         SET reward_claimed = 1
         WHERE user_id = ? AND achievement_id = ?'
    )->execute([$userId, $achievementId]);
}

/**
 * Send an in-game message to the player about a newly completed achievement.
 */
function send_achievement_notification(PDO $db, int $userId, array $row): void
{
    $parts = [];
    if ($row['reward_metal'])       $parts[] = "{$row['reward_metal']} Metal";
    if ($row['reward_crystal'])     $parts[] = "{$row['reward_crystal']} Crystal";
    if ($row['reward_deuterium'])   $parts[] = "{$row['reward_deuterium']} Deuterium";
    if ($row['reward_dark_matter']) $parts[] = "{$row['reward_dark_matter']} ◆ Dark Matter";
    if ($row['reward_rank_points']) $parts[] = "{$row['reward_rank_points']} Rank Points";

    $rewardText = $parts ? ' Rewards ready: ' . implode(', ', $parts) . '.' : '';
    $body       = "🏆 Quest completed: \"{$row['title']}\"!{$rewardText} Open the Quests tab to claim your reward.";

    $db->prepare(
        'INSERT INTO messages (receiver_id, subject, body) VALUES (?, ?, ?)'
    )->execute([$userId, '🏆 Quest Completed', $body]);
}

// ─── Achievement condition evaluators ─────────────────────────────────────────

/**
 * Dispatch to the correct evaluator for a given achievement code.
 *
 * @return array{completed: bool, progress: int, goal: int}
 */
function evaluate_achievement(PDO $db, int $userId, string $code): array
{
    return match ($code) {
        'tutorial_mine_3'      => ach_building_level($db, $userId, 'metal_mine',   3),
        'tutorial_solar_3'     => ach_building_level($db, $userId, 'solar_plant',  3),
        'tutorial_spy'         => ach_spy_count($db, $userId, 1),
        'tutorial_transport'   => ach_transport_count($db, $userId, 1),
        'tutorial_research'    => ach_any_research($db, $userId),
        'tutorial_colony'      => ach_colony_count($db, $userId, 2),
        'eco_metal_100k'       => ach_total_metal($db, $userId, 100000),
        'eco_planets_5'        => ach_colony_count($db, $userId, 5),
        'eco_planets_10'       => ach_colony_count($db, $userId, 10),
        'combat_first_win'     => ach_battle_wins($db, $userId, 1),
        'combat_10_wins'       => ach_battle_wins($db, $userId, 10),
        'veteran_deathstar'    => ach_ship_owned($db, $userId, 'death_star', 1),
        'veteran_all_research' => ach_all_research_level1($db, $userId),
        default                => ['completed' => false, 'progress' => 0, 'goal' => 1],
    };
}

// ── Individual condition helpers ──────────────────────────────────────────────

function ach_building_level(PDO $db, int $userId, string $type, int $target): array
{
    $stmt = $db->prepare(
        'SELECT MAX(b.level) AS lv
         FROM buildings b JOIN colonies c ON c.id = b.colony_id
         WHERE c.user_id = ? AND b.type = ?'
    );
    $stmt->execute([$userId, $type]);
    $lv = (int)($stmt->fetchColumn() ?? 0);
    return ['completed' => $lv >= $target, 'progress' => min($lv, $target), 'goal' => $target];
}

function ach_spy_count(PDO $db, int $userId, int $target): array
{
    $stmt = $db->prepare('SELECT COUNT(*) FROM spy_reports WHERE owner_id = ?');
    $stmt->execute([$userId]);
    $cnt = (int)$stmt->fetchColumn();
    return ['completed' => $cnt >= $target, 'progress' => min($cnt, $target), 'goal' => $target];
}

function ach_transport_count(PDO $db, int $userId, int $target): array
{
    // Count fleets currently outbound or returning with mission=transport,
    // plus completed transports approximated via delivered spy/transport
    // messages. We use active fleets as a reliable real-time indicator.
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM fleets
         WHERE user_id = ? AND mission = 'transport'"
    );
    $stmt->execute([$userId]);
    $cnt = (int)$stmt->fetchColumn();
    return ['completed' => $cnt >= $target, 'progress' => min($cnt, $target), 'goal' => $target];
}

function ach_any_research(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM research WHERE user_id = ? AND level >= 1'
    );
    $stmt->execute([$userId]);
    $cnt = (int)$stmt->fetchColumn();
    return ['completed' => $cnt >= 1, 'progress' => min($cnt, 1), 'goal' => 1];
}

function ach_colony_count(PDO $db, int $userId, int $target): array
{
    $stmt = $db->prepare('SELECT COUNT(*) FROM colonies WHERE user_id = ?');
    $stmt->execute([$userId]);
    $cnt = (int)$stmt->fetchColumn();
    return ['completed' => $cnt >= $target, 'progress' => min($cnt, $target), 'goal' => $target];
}

function ach_total_metal(PDO $db, int $userId, int $target): array
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(metal), 0) FROM colonies WHERE user_id = ?'
    );
    $stmt->execute([$userId]);
    $total = (int)$stmt->fetchColumn();
    return ['completed' => $total >= $target, 'progress' => min($total, $target), 'goal' => $target];
}

function ach_battle_wins(PDO $db, int $userId, int $target): array
{
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM battle_reports
         WHERE attacker_id = ?
           AND JSON_EXTRACT(report_json, '$.attacker_wins') = true"
    );
    $stmt->execute([$userId]);
    $cnt = (int)$stmt->fetchColumn();
    return ['completed' => $cnt >= $target, 'progress' => min($cnt, $target), 'goal' => $target];
}

function ach_ship_owned(PDO $db, int $userId, string $shipType, int $target): array
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(s.count), 0)
         FROM ships s JOIN colonies c ON c.id = s.colony_id
         WHERE c.user_id = ? AND s.type = ?'
    );
    $stmt->execute([$userId, $shipType]);
    $cnt = (int)$stmt->fetchColumn();
    return ['completed' => $cnt >= $target, 'progress' => min($cnt, $target), 'goal' => $target];
}

function ach_all_research_level1(PDO $db, int $userId): array
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) AS total,
                SUM(CASE WHEN level >= 1 THEN 1 ELSE 0 END) AS done
         FROM research WHERE user_id = ?'
    );
    $stmt->execute([$userId]);
    $row  = $stmt->fetch();
    $total = (int)($row['total'] ?? 0);
    $done  = (int)($row['done']  ?? 0);
    return ['completed' => $total > 0 && $done >= $total, 'progress' => $done, 'goal' => $total];
}
