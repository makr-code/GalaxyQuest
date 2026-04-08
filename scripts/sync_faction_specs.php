<?php
/**
 * GalaxyQuest – Faction spec sync
 *
 * Reads fractions/*\/spec.json (priority) or spec.yaml and upserts into:
 *   - npc_factions             (code, name, description, faction_type + game parameters)
 *   - faction_tech_affinities  (module-group bonuses derived from spec analysis)
 *
 * Idempotent – safe to run multiple times (INSERT … ON DUPLICATE KEY UPDATE).
 * Run: docker compose exec -T web php scripts/sync_faction_specs.php
 */

declare(strict_types=1);
require_once __DIR__ . '/../api/helpers.php';

// ── Simple YAML field extractor (used when PHP yaml extension is absent) ──────
function parse_yaml_simple(string $path): array
{
    if (function_exists('yaml_parse_file')) {
        $r = yaml_parse_file($path);
        return is_array($r) ? $r : [];
    }
    $result = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([a-zA-Z_][a-zA-Z0-9_]*):\s*["\']?([^"\'#\n\r]+?)["\']?\s*$/', trim($line), $m)) {
            $result[$m[1]] = trim($m[2]);
        }
    }
    return $result;
}

// ── 1. Spec faction_type strings → DB ENUM(military,trade,science,pirate,ancient)
$typeMap = [
    'military'               => 'military',
    'military_dictatorship'  => 'military',
    'human_military'         => 'military',
    'biomechanical_hivemind' => 'military',
    'metamorphic_swarm'      => 'military',
    'hive_military'          => 'military',
    'trade'                  => 'trade',
    'trade_mercantile'       => 'trade',
    'scientific'             => 'science',
    'science'                => 'science',
    'research'               => 'science',
    'schismatic_spiritual'   => 'science',
    'espionage'              => 'science',
    'pirate'                 => 'pirate',
    'pirate_multispecie'     => 'pirate',
    'pirate_multispezies'    => 'pirate',
    'primal_ai'              => 'ancient',
    'elder_tech_cult'        => 'ancient',
    'void_manifestation'     => 'ancient',
    'dimensional_nomadic'    => 'ancient',
    'ancient'                => 'ancient',
    'archive'                => 'ancient',
    'production'             => 'military',  // Kryl'Tha seed_faction_species uses 'production'
    'diplomacy'              => 'trade',     // Syl'Nar uses 'diplomacy'
    'spiritual'              => 'trade',     // Syl'Nar spec.json uses 'spiritual'
    'post_organic_ai'        => 'science',   // Omniscienta spec.json
    'archival'               => 'ancient',   // Zhareen spec.json
    'nomadic'                => 'trade',
    'cultural'               => 'trade',
];

// ── 2. Game-balance defaults by faction_type ──────────────────────────────────
$typeDefaults = [
    'military' => ['aggression' => 80, 'trade_willingness' => 20, 'base_diplomacy' => -10, 'power_level' => 1400,
                   'home_min' =>  1, 'home_max' => 6, 'color' => '#c0392b', 'icon' => '⚔'],
    'trade'    => ['aggression' => 15, 'trade_willingness' => 85, 'base_diplomacy' =>  10, 'power_level' =>  900,
                   'home_min' =>  1, 'home_max' => 9, 'color' => '#f39c12', 'icon' => '💰'],
    'science'  => ['aggression' => 25, 'trade_willingness' => 60, 'base_diplomacy' =>   5, 'power_level' => 1100,
                   'home_min' =>  2, 'home_max' => 8, 'color' => '#4488cc', 'icon' => '🔬'],
    'pirate'   => ['aggression' => 90, 'trade_willingness' => 40, 'base_diplomacy' => -40, 'power_level' =>  800,
                   'home_min' =>  1, 'home_max' => 9, 'color' => '#aa5500', 'icon' => '💀'],
    'ancient'  => ['aggression' => 30, 'trade_willingness' => 30, 'base_diplomacy' =>   0, 'power_level' => 2500,
                   'home_min' =>  3, 'home_max' => 9, 'color' => '#9944cc', 'icon' => '🌀'],
];

// ── 3. Per-faction display / game_balance overrides and tech_affinities are now
//       stored in each fractions/{code}/spec.json (blocks "display", "game_balance",
//       and "tech_affinities").  The $overrides and $affinityMatrix arrays that used
//       to live here have been removed.

// ── 4. Scan fractions/ and upsert npc_factions ────────────────────────────────
$fractionsDir = realpath(__DIR__ . '/../fractions');
if (!$fractionsDir || !is_dir($fractionsDir)) {
    fwrite(STDERR, "ERROR: fractions/ directory not found at expected path.\n");
    exit(1);
}

$db = get_db();
$counts = ['inserted' => 0, 'updated' => 0, 'unchanged' => 0, 'skipped' => 0];

echo "Syncing npc_factions from fractions/ spec files...\n\n";

foreach (scandir($fractionsDir) as $entry) {
    if ($entry[0] === '.') continue;
    $dir = $fractionsDir . DIRECTORY_SEPARATOR . $entry;
    if (!is_dir($dir)) continue;

    // Prefer spec.json, fall back to spec.yaml
    $specData = null;
    if (file_exists($dir . '/spec.json')) {
        $raw = file_get_contents($dir . '/spec.json');
        $specData = json_decode($raw, true);
    } elseif (file_exists($dir . '/spec.yaml')) {
        $specData = parse_yaml_simple($dir . '/spec.yaml');
    }

    if (!is_array($specData) || empty($specData)) {
        echo "  skip  $entry  (no parseable spec file)\n";
        $counts['skipped']++;
        continue;
    }

    // Resolve code
    $code = trim(
        $specData['faction_code'] ??
        $specData['species_code'] ??
        $entry
    );

    // Resolve display name; truncate to 64 chars, cut at dash/em-dash if needed
    $rawName = $specData['faction_name'] ?? $specData['display_name'] ?? ucwords(str_replace(['_', '-'], ' ', $code));
    $name    = trim(preg_replace('/\s*[–—-].*$/', '', $rawName));
    $name    = mb_substr($name, 0, 64);

    // Resolve description
    $desc = trim($specData['description'] ?? $specData['agenda'] ?? '');
    $desc = mb_substr($desc, 0, 255);

    // Resolve faction_type → DB ENUM
    $rawType = strtolower(trim($specData['faction_type'] ?? 'ancient'));
    $dbType  = $typeMap[$rawType] ?? 'ancient';

    // Merge type defaults, then apply per-faction overrides from spec's
    // "display" and "game_balance" blocks.
    $params = $typeDefaults[$dbType];
    $specDisplay      = is_array($specData['display']       ?? null) ? $specData['display']       : [];
    $specGameBalance  = is_array($specData['game_balance']   ?? null) ? $specData['game_balance']   : [];
    if (isset($specDisplay['color']))        $params['color']          = (string) $specDisplay['color'];
    if (isset($specDisplay['icon']))         $params['icon']           = (string) $specDisplay['icon'];
    if (isset($specGameBalance['aggression']))      $params['aggression']      = (int) $specGameBalance['aggression'];
    if (isset($specGameBalance['base_diplomacy']))  $params['base_diplomacy']  = (int) $specGameBalance['base_diplomacy'];
    if (isset($specGameBalance['power_level']))     $params['power_level']     = (int) $specGameBalance['power_level'];
    if (isset($specGameBalance['trade_willingness'])) $params['trade_willingness'] = (int) $specGameBalance['trade_willingness'];

    $stmt = $db->prepare('
        INSERT INTO npc_factions
            (code, name, description, faction_type,
             aggression, trade_willingness, base_diplomacy, power_level,
             home_galaxy_min, home_galaxy_max, color, icon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            name              = VALUES(name),
            description       = VALUES(description),
            faction_type      = VALUES(faction_type),
            aggression        = VALUES(aggression),
            trade_willingness = VALUES(trade_willingness),
            base_diplomacy    = VALUES(base_diplomacy),
            power_level       = VALUES(power_level),
            home_galaxy_min   = VALUES(home_galaxy_min),
            home_galaxy_max   = VALUES(home_galaxy_max),
            color             = VALUES(color),
            icon              = VALUES(icon)
    ');
    $stmt->execute([
        $code, $name, $desc, $dbType,
        $params['aggression'],       $params['trade_willingness'],
        $params['base_diplomacy'],   $params['power_level'],
        $params['home_min'],         $params['home_max'],
        $params['color'],            $params['icon'],
    ]);

    // rowCount: 0=unchanged, 1=inserted, 2=updated (ON DUPLICATE KEY)
    $rc     = $stmt->rowCount();
    $action = match ($rc) { 0 => 'unchanged', 1 => 'inserted', default => 'updated' };
    $counts[$action]++;
    $mark = $action === 'inserted' ? '✚' : ($action === 'updated' ? '↺' : '·');
    echo "  $mark $code  ($dbType)  [$action]\n";
}

// ── 5. Upsert faction_tech_affinities ─────────────────────────────────────────
echo "\nSeeding faction_tech_affinities...\n\n";
$affinityStmt = $db->prepare('
    INSERT INTO faction_tech_affinities
        (faction_code, module_group_code, bonus_type, bonus_value, min_standing)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
        bonus_value  = VALUES(bonus_value),
        min_standing = VALUES(min_standing)
');

$affinityTotal  = 0;
$affinityNew    = 0;
foreach (scandir($fractionsDir) as $affinEntry) {
    if ($affinEntry[0] === '.') continue;
    $affinDir = $fractionsDir . DIRECTORY_SEPARATOR . $affinEntry;
    if (!is_dir($affinDir)) continue;
    $affinJsonPath = $affinDir . '/spec.json';
    if (!is_file($affinJsonPath)) continue;
    $raw = file_get_contents($affinJsonPath);
    $affinSpec = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($affinSpec)) continue;
    $factionCode = (string) ($affinSpec['faction_code'] ?? $affinSpec['species_code'] ?? $affinEntry);
    $bonuses = $affinSpec['tech_affinities'] ?? null;
    if (!is_array($bonuses) || empty($bonuses)) continue;
    foreach ($bonuses as $bonus) {
        if (!is_array($bonus)) continue;
        $groupCode    = (string) ($bonus['group']         ?? '');
        $bonusType    = (string) ($bonus['bonus_type']    ?? '');
        $bonusValue   = (float)  ($bonus['bonus_value']   ?? 0.0);
        $minStanding  = (int)    ($bonus['min_standing']  ?? 0);
        if ($groupCode === '' || $bonusType === '') continue;
        $affinityStmt->execute([$factionCode, $groupCode, $bonusType, $bonusValue, $minStanding]);
        $rc = $affinityStmt->rowCount();
        if ($rc === 1) $affinityNew++;
        $affinityTotal++;
    }
    echo "  · $factionCode  " . count($bonuses) . " bonus(es)\n";
}

// ── 6. Summary ────────────────────────────────────────────────────────────────
echo "\n";
echo "npc_factions:            inserted={$counts['inserted']}  updated={$counts['updated']}  unchanged={$counts['unchanged']}  skipped={$counts['skipped']}\n";
echo "faction_tech_affinities: total={$affinityTotal}  new/changed={$affinityNew}\n";

$total = (int) $db->query('SELECT COUNT(*) FROM npc_factions')->fetchColumn();
echo "\nTotal factions in DB now: $total\n";
