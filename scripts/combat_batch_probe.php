<?php

declare(strict_types=1);

/**
 * Combat batch probe (CLI)
 *
 * Usage:
 *   php scripts/combat_batch_probe.php --fleet=123 --target=456 --iterations=500 --seed=my_seed
 *   php scripts/combat_batch_probe.php --fleet=123 --targets=456,789,790 --iterations=500
 *
 * Optional:
 *   --target omitted => uses fleet target coordinates.
 */

require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../api/game_engine.php';

function usage(): never {
    echo "Usage: php scripts/combat_batch_probe.php --fleet=<fleet_id> [--target=<colony_id>] [--targets=<id,id,...>] [--iterations=<1..5000>] [--seed=<text>]" . PHP_EOL;
    exit(1);
}

function arg_value(array $argv, string $name): ?string {
    foreach ($argv as $arg) {
        if (str_starts_with($arg, "--{$name}=")) {
            return substr($arg, strlen($name) + 3);
        }
    }
    return null;
}

function rng_float(string $seed, string $key): float {
    $hash = hash('sha256', $seed . '|' . $key);
    $num = hexdec(substr($hash, 0, 8));
    return $num / 4294967295.0;
}

function preview_outcome(
    float $atkAtk,
    float $defAtk,
    float $atkShield,
    float $defShield,
    float $atkHull,
    float $defHull,
    string $seed
): array {
    $atkDiceMult = 0.9 + rng_float($seed, 'atk_dmg') * 0.2;
    $defDiceMult = 0.9 + rng_float($seed, 'def_dmg') * 0.2;

    $atkEffectiveDmg = max(0.0, ($atkAtk - $defShield * 0.5) * $atkDiceMult);
    $defEffectiveDmg = max(0.0, ($defAtk - $atkShield * 0.5) * $defDiceMult);
    $attackerWins = $atkEffectiveDmg > ($defHull * 0.5 + $defShield * 0.2);

    $atkLossFraction = $defEffectiveDmg > 0
        ? min(0.9, $defEffectiveDmg / max(1.0, $atkHull + $atkShield))
        : 0.0;
    $defLossFraction = $attackerWins
        ? min(0.9, $atkEffectiveDmg / max(1.0, $defHull + $defShield))
        : 0.3;

    return [
        'attacker_wins' => $attackerWins,
        'atk_loss_fraction' => $atkLossFraction,
        'def_loss_fraction' => $defLossFraction,
        'dice_variance_index' => (abs($atkDiceMult - 1.0) + abs($defDiceMult - 1.0)) / 2.0,
    ];
}

function parse_target_ids(string $csv): array {
    if ($csv === '') {
        return [];
    }
    $parts = explode(',', $csv);
    $result = [];
    foreach ($parts as $p) {
        $id = (int)trim($p);
        if ($id > 0) {
            $result[] = $id;
        }
    }
    return array_values(array_unique($result));
}

function resolve_target_colony(PDO $db, array $fleet, int $targetColonyId): ?array {
    if ($targetColonyId > 0) {
        $stmt = $db->prepare('SELECT c.id, c.user_id FROM colonies c WHERE c.id = ? LIMIT 1');
        $stmt->execute([$targetColonyId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    $stmt = $db->prepare(
        'SELECT c.id, c.user_id
         FROM colonies c JOIN planets p ON p.id = c.planet_id
         WHERE p.galaxy = ? AND p.`system` = ? AND p.position = ?
         LIMIT 1'
    );
    $stmt->execute([(int)$fleet['target_galaxy'], (int)$fleet['target_system'], (int)$fleet['target_position']]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function compute_attacker_stats(PDO $db, array $fleet, array $ships): array {
    $atkWpnStmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $atkWpnStmt->execute([(int)$fleet['user_id']]);
    $atkWpnLevel = (int)($atkWpnStmt->fetchColumn() ?? 0);

    $atkShStmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $atkShStmt->execute([(int)$fleet['user_id']]);
    $atkShldLevel = (int)($atkShStmt->fetchColumn() ?? 0);

    $atkAtk = 0.0;
    $atkHull = 0.0;
    $atkShield = 0.0;
    foreach ($ships as $type => $cnt) {
        $s = SHIP_STATS[$type] ?? [];
        $atkAtk += (($s['attack'] ?? 0) * (int)$cnt) * (1.0 + $atkWpnLevel * 0.1);
        $atkHull += ($s['hull'] ?? 0) * (int)$cnt;
        $atkShield += (($s['shield'] ?? 0) * (int)$cnt) * (1.0 + $atkShldLevel * 0.1);
    }

    return ['atk' => $atkAtk, 'hull' => $atkHull, 'shield' => $atkShield];
}

function compute_defender_stats(PDO $db, int $targetUserId, int $targetColonyId): array {
    $defWpnStmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'weapons_tech\'');
    $defWpnStmt->execute([$targetUserId]);
    $defWpnLevel = (int)($defWpnStmt->fetchColumn() ?? 0);

    $defShStmt = $db->prepare('SELECT level FROM research WHERE user_id=? AND type=\'shielding_tech\'');
    $defShStmt->execute([$targetUserId]);
    $defShldLevel = (int)($defShStmt->fetchColumn() ?? 0);

    $defShipsStmt = $db->prepare('SELECT type, count FROM ships WHERE colony_id=?');
    $defShipsStmt->execute([$targetColonyId]);

    $defAtk = 0.0;
    $defHull = 0.0;
    $defShield = 0.0;
    foreach ($defShipsStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $s = SHIP_STATS[$row['type']] ?? [];
        $cnt = (int)$row['count'];
        $defAtk += (($s['attack'] ?? 0) * $cnt) * (1.0 + $defWpnLevel * 0.1);
        $defHull += ($s['hull'] ?? 0) * $cnt;
        $defShield += (($s['shield'] ?? 0) * $cnt) * (1.0 + $defShldLevel * 0.1);
    }

    return ['atk' => $defAtk, 'hull' => $defHull, 'shield' => $defShield];
}

function run_target_probe(
    int $fleetId,
    int $targetColonyId,
    int $iterations,
    string $baseSeed,
    array $attacker,
    array $defender
): array {
    $wins = 0;
    $sumDiceVar = 0.0;
    $sumAtkLoss = 0.0;
    $sumDefLoss = 0.0;

    for ($i = 1; $i <= $iterations; $i++) {
        $iterSeed = hash('sha256', $baseSeed . '|target|' . $targetColonyId . '|iter|' . $i);
        $out = preview_outcome(
            $attacker['atk'],
            $defender['atk'],
            $attacker['shield'],
            $defender['shield'],
            $attacker['hull'],
            $defender['hull'],
            $iterSeed
        );
        if ($out['attacker_wins']) {
            $wins++;
        }
        $sumDiceVar += (float)$out['dice_variance_index'];
        $sumAtkLoss += (float)$out['atk_loss_fraction'];
        $sumDefLoss += (float)$out['def_loss_fraction'];
    }

    return [
        'fleet_id' => $fleetId,
        'target_colony_id' => $targetColonyId,
        'iterations' => $iterations,
        'attacker_winrate_estimate' => round($wins / max(1, $iterations), 4),
        'dice_variance_avg' => round($sumDiceVar / max(1, $iterations), 4),
        'expected_loss_fraction_avg' => [
            'attacker' => round($sumAtkLoss / max(1, $iterations), 4),
            'defender' => round($sumDefLoss / max(1, $iterations), 4),
        ],
        'power_rating' => [
            'attacker' => (int)round($attacker['atk'] + $attacker['shield'] * 0.2 + $attacker['hull'] * 0.1),
            'defender' => (int)round($defender['atk'] + $defender['shield'] * 0.2 + $defender['hull'] * 0.1),
        ],
    ];
}

$fleetId = (int)(arg_value($argv, 'fleet') ?? 0);
$targetColonyId = (int)(arg_value($argv, 'target') ?? 0);
$targetsCsv = (string)(arg_value($argv, 'targets') ?? '');
$iterations = (int)(arg_value($argv, 'iterations') ?? 100);
$iterations = max(1, min(5000, $iterations));
$seedInput = (string)(arg_value($argv, 'seed') ?? '');
$seedInput = preg_replace('/[^a-zA-Z0-9_\-]/', '', $seedInput) ?? '';

if ($fleetId <= 0) {
    usage();
}

$db = get_db();

$fleetStmt = $db->prepare('SELECT * FROM fleets WHERE id = ? LIMIT 1');
$fleetStmt->execute([$fleetId]);
$fleet = $fleetStmt->fetch(PDO::FETCH_ASSOC);
if (!$fleet) {
    fwrite(STDERR, "Fleet not found: {$fleetId}" . PHP_EOL);
    exit(1);
}

$ships = json_decode((string)($fleet['ships_json'] ?? '{}'), true) ?: [];
if (empty($ships)) {
    fwrite(STDERR, 'Fleet has no ships.' . PHP_EOL);
    exit(1);
}

$targetIds = parse_target_ids($targetsCsv);
if ($targetColonyId > 0) {
    $targetIds[] = $targetColonyId;
}
$targetIds = array_values(array_unique($targetIds));

if (empty($targetIds)) {
    $fallbackTarget = resolve_target_colony($db, $fleet, 0);
    if (!$fallbackTarget) {
        fwrite(STDERR, 'Target colony not found.' . PHP_EOL);
        exit(1);
    }
    $targetIds = [(int)$fallbackTarget['id']];
}
$attacker = compute_attacker_stats($db, $fleet, $ships);

$baseSeed = $seedInput !== ''
    ? hash('sha256', $seedInput)
    : hash('sha256', implode('|', ['batch_probe', $fleetId]));

$results = [];
foreach ($targetIds as $tid) {
    $target = resolve_target_colony($db, $fleet, (int)$tid);
    if (!$target) {
        $results[] = [
            'fleet_id' => $fleetId,
            'target_colony_id' => (int)$tid,
            'error' => 'target_not_found',
        ];
        continue;
    }

    $defender = compute_defender_stats($db, (int)$target['user_id'], (int)$target['id']);
    $results[] = run_target_probe(
        $fleetId,
        (int)$target['id'],
        $iterations,
        $baseSeed,
        $attacker,
        $defender
    );
}

$ranking = array_values(array_filter($results, static fn(array $r): bool => isset($r['attacker_winrate_estimate'])));
usort($ranking, static fn(array $a, array $b): int => ($b['attacker_winrate_estimate'] <=> $a['attacker_winrate_estimate']));

$result = [
    'fleet_id' => $fleetId,
    'iterations' => $iterations,
    'seed' => $baseSeed,
    'targets_scanned' => count($results),
    'results' => $results,
    'ranking' => $ranking,
];

echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
