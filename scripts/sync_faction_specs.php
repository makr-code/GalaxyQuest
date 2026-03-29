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

// ── 3. Per-faction color/icon/balance overrides (derived from spec visual identity)
$overrides = [
    // ── already seeded by migrate_vessel_blueprints_v3.sql ──
    // included here for idempotency so running this script always wins with
    // the curated values from the spec analysis.
    'iron_fleet'             => ['color' => '#c0392b', 'icon' => '⚔', 'aggression' => 85],
    'aereth'                 => ['color' => '#e6f3ff', 'icon' => '✦', 'aggression' => 25],
    'omniscienta'            => ['color' => '#7f8c8d', 'icon' => '🤖', 'aggression' => 60],
    'vor_tak'                => ['color' => '#6c3483', 'icon' => '◈', 'aggression' => 95, 'base_diplomacy' => -30],
    'syl_nar'                => ['color' => '#f39c12', 'icon' => '⬟'],
    'zhareen'                => ['color' => '#1abc9c', 'icon' => '◆'],
    // ── 11 fractions not yet in npc_factions ──
    'aethernox'              => ['color' => '#c8b8ff', 'icon' => '⚖', 'power_level' => 3500, 'aggression' => 20],
    'architekten_des_lichts' => ['color' => '#f0d060', 'icon' => '✦'],
    'brut_der_ewigkeit'      => ['color' => '#2d7a27', 'icon' => '🧬', 'aggression' => 85],
    'echos_der_leere'        => ['color' => '#330055', 'icon' => '🌑', 'aggression' => 100,
                                 'base_diplomacy' => -50, 'power_level' => 3500],
    'helion_confederation'   => ['color' => '#ffa030', 'icon' => '⬡'],
    'ketzer_von_verath'      => ['color' => '#7a0572', 'icon' => '🔱'],
    'khar_morr_syndicate'    => ['color' => '#8b0000', 'icon' => '☠'],
    'kryl_tha'               => ['color' => '#ffd700', 'icon' => '⬡', 'aggression' => 85],
    'myr_keth'               => ['color' => '#708090', 'icon' => '◈', 'aggression' => 70],
    'nomaden_des_rifts'      => ['color' => '#00bcd4', 'icon' => '🌀', 'power_level' => 2000],
    'vel_ar'                 => ['color' => '#4a90e2', 'icon' => '🎭'],
];

// ── 4. Affinity matrix [ faction_code => [[group, bonus_type, value, min_standing], …] ]
// Values are game-design decisions; reasoning is annotated from fractions/* spec analysis.
$affinityMatrix = [
    // Aethernox: gravimetric hull-monoliths (hull★★★), planetary shields (shield★★), storage cores (utility★★)
    'aethernox' => [
        ['hull',       'stat_mult',       0.10,  5],
        ['shield',     'cost_pct',      -10.0, 10],
        ['utility',    'cost_pct',        -8.0, 15],
    ],
    // Architekten des Lichts: holy data-nodes (utility★★★), light weapons (weapon★★), light-shield (shield★)
    'architekten_des_lichts' => [
        ['utility',    'stat_mult',       0.10,  5],
        ['utility',    'build_time_pct', -15.0, 10],
        ['weapon',     'cost_pct',       -10.0, 15],
    ],
    // Brut der Ewigkeit: living weapons (weapon★★★), bio-armor hull (hull★★★), organic nanites (utility★★)
    'brut_der_ewigkeit' => [
        ['weapon',     'stat_mult',       0.12,  5],
        ['hull',       'stat_mult',       0.10, 10],
        ['utility',    'cost_pct',        -8.0, 15],
    ],
    // Echos der Leere: entropy-manipulation weapons (weapon★★★) – extremely hard to befriend
    'echos_der_leere' => [
        ['weapon',     'stat_mult',       0.15, 20],
        ['weapon',     'cost_pct',       -10.0, 35],
    ],
    // Helion-Konföderation: hyperspace trade routes (propulsion★★★), economic AI / nanofab (utility★★★)
    'helion_confederation' => [
        ['propulsion', 'stat_mult',       0.08,  5],
        ['utility',    'cost_pct',       -15.0, 10],
        ['propulsion', 'cost_pct',       -12.0, 15],
    ],
    // Ketzer von Verath: frequency/bioluminescent weapons (weapon★★★), crystal comms (utility★★★), Syl'Nar biotech hull (hull★★)
    'ketzer_von_verath' => [
        ['weapon',     'cost_pct',       -12.0,  5],
        ['utility',    'stat_mult',       0.08, 10],
        ['hull',       'cost_pct',        -8.0, 15],
    ],
    // Khar'Morr Syndikate: hybrid stolen weapons (weapon★★★), Vel'Ar cloaking shields (shield★★★), fast raiders (propulsion★★)
    'khar_morr_syndicate' => [
        ['weapon',     'build_time_pct', -12.0,  5],
        ['shield',     'cost_pct',       -15.0, 10],
        ['propulsion', 'stat_mult',       0.08, 15],
    ],
    // Kryl'Tha: organic weapons/swarm drones (weapon★★★), chitin self-healing hull (hull★★★), regen exoskeleton (shield★)
    'kryl_tha' => [
        ['weapon',     'stat_mult',       0.10,  5],
        ['hull',       'stat_mult',       0.12, 10],
        ['shield',     'cost_pct',        -5.0, 15],
    ],
    // Myr'Keth: adaptive morphmetal hull (hull★★★), resonance weapons (weapon★★★), swarm AI (utility★★)
    'myr_keth' => [
        ['hull',       'stat_mult',       0.12,  5],
        ['weapon',     'stat_mult',       0.10, 10],
        ['utility',    'build_time_pct', -10.0, 15],
    ],
    // Nomaden des Rifts: phase propulsion (propulsion★★★), phase-shift weapons (weapon★★★), probability manipulation (utility★★★)
    'nomaden_des_rifts' => [
        ['propulsion', 'stat_mult',       0.10,  5],
        ['weapon',     'cost_pct',        -8.0, 10],
        ['utility',    'stat_mult',       0.08, 15],
    ],
    // Vel'Ar: gas-cloud cloaking shields (shield★★★), gas-nanoclouds / identity masks (utility★★★)
    'vel_ar' => [
        ['shield',     'stat_mult',       0.10,  5],
        ['utility',    'cost_pct',       -15.0, 10],
        ['shield',     'cost_pct',       -10.0, 15],
    ],
];

// ── 5. Scan fractions/ and upsert npc_factions ────────────────────────────────
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

    // Merge defaults + per-faction overrides  
    $params = array_merge($typeDefaults[$dbType], $overrides[$code] ?? []);

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

// ── 6. Upsert faction_tech_affinities ─────────────────────────────────────────
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
foreach ($affinityMatrix as $factionCode => $bonuses) {
    foreach ($bonuses as [$groupCode, $bonusType, $bonusValue, $minStanding]) {
        $affinityStmt->execute([$factionCode, $groupCode, $bonusType, $bonusValue, $minStanding]);
        $rc = $affinityStmt->rowCount();
        if ($rc === 1) $affinityNew++;
        $affinityTotal++;
    }
    echo "  · $factionCode  " . count($bonuses) . " bonus(es)\n";
}

// ── 7. Summary ────────────────────────────────────────────────────────────────
echo "\n";
echo "npc_factions:            inserted={$counts['inserted']}  updated={$counts['updated']}  unchanged={$counts['unchanged']}  skipped={$counts['skipped']}\n";
echo "faction_tech_affinities: total={$affinityTotal}  new/changed={$affinityNew}\n";

$total = (int) $db->query('SELECT COUNT(*) FROM npc_factions')->fetchColumn();
echo "\nTotal factions in DB now: $total\n";
