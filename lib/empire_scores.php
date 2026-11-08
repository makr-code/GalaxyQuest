<?php

declare(strict_types=1);

function clamp_score(float $value): int
{
    return (int)max(0, min(100, round($value)));
}

function calc_economy_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(metal + crystal + deuterium), 0)
         FROM colonies WHERE user_id = ?'
    );
    $stmt->execute([$uid]);
    return clamp_score((float)$stmt->fetchColumn() / 200.0);
}

function calc_military_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT ships_json FROM fleets WHERE user_id = ? AND `returning` = 0'
    );
    $stmt->execute([$uid]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $totalShips = 0;
    foreach ($rows as $row) {
        $ships = json_decode((string)($row['ships_json'] ?? '{}'), true);
        if (!is_array($ships)) {
            continue;
        }
        foreach ($ships as $count) {
            $totalShips += max(0, (int)$count);
        }
    }
    return clamp_score($totalShips / 10.0);
}

function calc_research_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        "SELECT
             COUNT(*) AS total_colonies,
             SUM(CASE WHEN colony_type = 'research' THEN 1 ELSE 0 END) AS research_colonies
         FROM colonies WHERE user_id = ?"
    );
    $stmt->execute([$uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return 0;
    }
    $score = ((int)$row['research_colonies'] * 20) + ((int)$row['total_colonies'] * 3);
    return clamp_score((float)$score);
}

function calc_growth_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT COALESCE(SUM(population), 0) FROM colonies WHERE user_id = ?'
    );
    $stmt->execute([$uid]);
    return clamp_score((float)$stmt->fetchColumn() / 100.0);
}

function calc_stability_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM wars
         WHERE (attacker_user_id = ? OR defender_user_id = ?) AND status = 'active'"
    );
    $stmt->execute([$uid, $uid]);
    $warCount = (int)$stmt->fetchColumn();

    $stmt2 = $db->prepare(
        'SELECT COALESCE(AVG(energy_balance), 0) FROM colonies WHERE user_id = ?'
    );
    $stmt2->execute([$uid]);
    $avgEnergy = (float)$stmt2->fetchColumn();

    $warPenalty    = min(100, $warCount * 20);
    $energyBonus   = clamp_score(50.0 + $avgEnergy);
    return clamp_score((float)($energyBonus - $warPenalty));
}

function calc_diplomacy_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*)
         FROM npc_factions f
         LEFT JOIN diplomacy d ON d.faction_id = f.id AND d.user_id = ?
         WHERE COALESCE(d.standing, f.base_diplomacy, 0) > 0'
    );
    $stmt->execute([$uid]);
    $positiveCount = (int)$stmt->fetchColumn();
    return clamp_score($positiveCount * 10.0);
}

function calc_espionage_score(PDO $db, int $uid): int
{
    $stmt = $db->prepare(
        "SELECT COUNT(*) AS agent_count, COALESCE(AVG(skill_level), 0) AS avg_skill
         FROM espionage_agents WHERE user_id = ? AND status != 'retired'"
    );
    $stmt->execute([$uid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return 0;
    }
    return clamp_score((float)$row['agent_count'] * (float)$row['avg_skill']);
}

/** @return array{economy:int,military:int,research:int,growth:int,stability:int,diplomacy:int,espionage:int,total:int} */
function calc_empire_scores(PDO $db, int $uid): array
{
    $economy   = calc_economy_score($db, $uid);
    $military  = calc_military_score($db, $uid);
    $research  = calc_research_score($db, $uid);
    $growth    = calc_growth_score($db, $uid);
    $stability = calc_stability_score($db, $uid);
    $diplomacy = calc_diplomacy_score($db, $uid);
    $espionage = calc_espionage_score($db, $uid);
    $total = $economy + $military + $research + $growth + $stability + $diplomacy + $espionage;

    return compact('economy', 'military', 'research', 'growth', 'stability', 'diplomacy', 'espionage', 'total');
}

/** @return array{economy:int,military:int,research:int,growth:int,stability:int,diplomacy:int,espionage:int,total:int} */
function calc_and_store_empire_scores(PDO $db, int $uid): array
{
    $scores = calc_empire_scores($db, $uid);

    $db->prepare(
        'INSERT INTO empire_category_scores
             (user_id, score_economy, score_military, score_research,
              score_growth, score_stability, score_diplomacy, score_espionage,
              total_score, calculated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
             score_economy   = VALUES(score_economy),
             score_military  = VALUES(score_military),
             score_research  = VALUES(score_research),
             score_growth    = VALUES(score_growth),
             score_stability = VALUES(score_stability),
             score_diplomacy = VALUES(score_diplomacy),
             score_espionage = VALUES(score_espionage),
             total_score     = VALUES(total_score),
             calculated_at   = NOW()'
    )->execute([
        $uid,
        $scores['economy'],
        $scores['military'],
        $scores['research'],
        $scores['growth'],
        $scores['stability'],
        $scores['diplomacy'],
        $scores['espionage'],
        $scores['total'],
    ]);

    return $scores;
}
