<?php
/**
 * Politics API (species, government, civics, dynamic effects)
 *
 * GET  /api/politics.php?action=catalog
 * GET  /api/politics.php?action=presets
 * GET  /api/politics.php?action=status
 * POST /api/politics.php?action=configure
 *      body: {primary_species_key, government_key, civic_keys: []}
 * POST /api/politics.php?action=apply_preset
 *      body: {preset_key}
 */
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/game_engine.php';

$action = strtolower((string)($_GET['action'] ?? 'status'));
$uid = require_auth();
$db = get_db();

switch ($action) {
    case 'catalog':
        only_method('GET');
        ensure_empire_profile_row($db, $uid);
        json_ok(load_catalog($db));
        break;

    case 'presets':
        only_method('GET');
        ensure_empire_profile_row($db, $uid);
        json_ok(['presets' => politics_presets()]);
        break;

    case 'status':
        only_method('GET');
        ensure_empire_profile_row($db, $uid);
        $profile = load_user_empire_profile($db, $uid);
        $effects = empire_dynamic_effects($db, $uid);
        $factions = load_user_faction_state_rows($db, $uid);
        json_ok([
            'profile' => $profile,
            'dynamic_effects' => $effects,
            'factions' => $factions,
        ]);
        break;

    case 'configure':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();

        $speciesKey = trim((string)($body['primary_species_key'] ?? ''));
        $governmentKey = trim((string)($body['government_key'] ?? ''));
        $civicKeys = is_array($body['civic_keys'] ?? null) ? $body['civic_keys'] : [];

        if ($speciesKey === '' || $governmentKey === '') {
            json_error('primary_species_key and government_key are required.');
        }

        $catalog = load_catalog($db);
        $speciesMap = array_flip(array_map(static fn($row) => (string)$row['species_key'], $catalog['species']));
        $govMap = array_flip(array_map(static fn($row) => (string)$row['government_key'], $catalog['governments']));

        if (!isset($speciesMap[$speciesKey])) {
            json_error('Unknown primary_species_key.');
        }
        if (!isset($govMap[$governmentKey])) {
            json_error('Unknown government_key.');
        }

        $normalizedCivics = normalize_civic_keys($civicKeys);
        apply_politics_configuration($db, $uid, $speciesKey, $governmentKey, $normalizedCivics, $catalog);

        json_ok([
            'message' => 'Politics profile updated.',
            'profile' => load_user_empire_profile($db, $uid),
            'dynamic_effects' => empire_dynamic_effects($db, $uid),
        ]);
        break;

    case 'apply_preset':
        only_method('POST');
        verify_csrf();
        $body = get_json_body();
        $presetKey = trim((string)($body['preset_key'] ?? ''));
        if ($presetKey === '') {
            json_error('preset_key is required.');
        }

        $presets = politics_presets();
        $preset = null;
        foreach ($presets as $entry) {
            if ((string)($entry['preset_key'] ?? '') === $presetKey) {
                $preset = $entry;
                break;
            }
        }
        if (!$preset) {
            json_error('Unknown preset_key.');
        }

        $catalog = load_catalog($db);
        apply_politics_configuration(
            $db,
            $uid,
            (string)$preset['primary_species_key'],
            (string)$preset['government_key'],
            normalize_civic_keys((array)($preset['civic_keys'] ?? [])),
            $catalog
        );

        json_ok([
            'message' => 'Politics preset applied.',
            'preset_key' => $presetKey,
            'profile' => load_user_empire_profile($db, $uid),
            'dynamic_effects' => empire_dynamic_effects($db, $uid),
        ]);
        break;

    default:
        json_error('Unknown action.');
}

function ensure_empire_profile_row(PDO $db, int $uid): void {
    try {
        $db->prepare(
            'INSERT INTO user_empire_profile (user_id, primary_species_key, government_key, ethic_axis_json)
             VALUES (?, \'adaptive_humans\', \'stellar_republic\',
                     JSON_OBJECT(\'order_vs_freedom\',0,\'industry_vs_ecology\',0,\'science_vs_tradition\',0))
             ON DUPLICATE KEY UPDATE user_id = user_id'
        )->execute([$uid]);

        $db->prepare(
            'INSERT IGNORE INTO user_empire_civics (user_id, civic_key, slot_index)
             VALUES (?, \'meritocracy\', 1)'
        )->execute([$uid]);

        $db->prepare(
            'INSERT IGNORE INTO user_empire_civics (user_id, civic_key, slot_index)
             VALUES (?, \'adaptive_bureaucracy\', 2)'
        )->execute([$uid]);
    } catch (Throwable $e) {
        // Migration may not yet be applied; endpoint callers receive empty data from loaders.
    }
}

function load_catalog(PDO $db): array {
    try {
        $species = $db->query(
            'SELECT species_key, name, description, climate_preference, effects_json
             FROM species_profiles
             ORDER BY id ASC'
        )->fetchAll();

        $governments = $db->query(
            'SELECT government_key, name, description, authority_type, effects_json
             FROM government_forms
             ORDER BY id ASC'
        )->fetchAll();

        $civics = $db->query(
            'SELECT civic_key, name, description, requires_government_key, effects_json
             FROM government_civics
             ORDER BY id ASC'
        )->fetchAll();

        return [
            'species' => $species ?: [],
            'governments' => $governments ?: [],
            'civics' => $civics ?: [],
        ];
    } catch (Throwable $e) {
        return [
            'species' => [],
            'governments' => [],
            'civics' => [],
        ];
    }
}

function load_user_empire_profile(PDO $db, int $uid): array {
    try {
        $stmt = $db->prepare(
            'SELECT user_id, primary_species_key, government_key, ethic_axis_json, created_at, updated_at
             FROM user_empire_profile
             WHERE user_id = ?
             LIMIT 1'
        );
        $stmt->execute([$uid]);
        $profile = $stmt->fetch();
        if (!$profile) {
            return [
                'user_id' => $uid,
                'primary_species_key' => 'adaptive_humans',
                'government_key' => 'stellar_republic',
                'ethic_axis' => [],
                'civics' => [],
            ];
        }

        $civicsStmt = $db->prepare(
            'SELECT civic_key, slot_index
             FROM user_empire_civics
             WHERE user_id = ?
             ORDER BY slot_index ASC, id ASC'
        );
        $civicsStmt->execute([$uid]);

        return [
            'user_id' => (int)$profile['user_id'],
            'primary_species_key' => (string)$profile['primary_species_key'],
            'government_key' => (string)$profile['government_key'],
            'ethic_axis' => decode_json_map($profile['ethic_axis_json'] ?? null),
            'civics' => $civicsStmt->fetchAll() ?: [],
            'created_at' => $profile['created_at'] ?? null,
            'updated_at' => $profile['updated_at'] ?? null,
        ];
    } catch (Throwable $e) {
        return [
            'user_id' => $uid,
            'primary_species_key' => 'adaptive_humans',
            'government_key' => 'stellar_republic',
            'ethic_axis' => [],
            'civics' => [],
        ];
    }
}

function load_user_faction_state_rows(PDO $db, int $uid): array {
    try {
        $stmt = $db->prepare(
            'SELECT faction_key, approval, support, issues_json, last_updated_at
             FROM user_faction_state
             WHERE user_id = ?
             ORDER BY faction_key ASC'
        );
        $stmt->execute([$uid]);
        return $stmt->fetchAll() ?: [];
    } catch (Throwable $e) {
        return [];
    }
}

function normalize_civic_keys(array $civicKeys): array {
    $normalizedCivics = [];
    foreach ($civicKeys as $key) {
        $k = trim((string)$key);
        if ($k !== '' && !in_array($k, $normalizedCivics, true)) {
            $normalizedCivics[] = $k;
        }
    }
    $maxCivics = max(0, (int)(defined('POLITICS_MAX_CIVICS') ? POLITICS_MAX_CIVICS : 2));
    return array_slice($normalizedCivics, 0, $maxCivics);
}

function apply_politics_configuration(
    PDO $db,
    int $uid,
    string $speciesKey,
    string $governmentKey,
    array $normalizedCivics,
    array $catalog
): void {
    $speciesMap = array_flip(array_map(static fn($row) => (string)$row['species_key'], $catalog['species']));
    $govMap = array_flip(array_map(static fn($row) => (string)$row['government_key'], $catalog['governments']));
    if (!isset($speciesMap[$speciesKey])) {
        json_error('Unknown primary_species_key.');
    }
    if (!isset($govMap[$governmentKey])) {
        json_error('Unknown government_key.');
    }

    if ($normalizedCivics) {
        $in = implode(',', array_fill(0, count($normalizedCivics), '?'));
        $stmt = $db->prepare(
            'SELECT civic_key, requires_government_key
             FROM government_civics
             WHERE civic_key IN (' . $in . ')'
        );
        $stmt->execute($normalizedCivics);
        $civicRows = $stmt->fetchAll();
        if (count($civicRows) !== count($normalizedCivics)) {
            json_error('Unknown civic key in civic_keys.');
        }
        foreach ($civicRows as $civic) {
            $requiredGov = trim((string)($civic['requires_government_key'] ?? ''));
            if ($requiredGov !== '' && $requiredGov !== $governmentKey) {
                json_error('Civic ' . $civic['civic_key'] . ' requires government ' . $requiredGov . '.');
            }
        }
    }

    ensure_empire_profile_row($db, $uid);
    $db->beginTransaction();
    try {
        $db->prepare(
            'UPDATE user_empire_profile
             SET primary_species_key = ?, government_key = ?, updated_at = NOW()
             WHERE user_id = ?'
        )->execute([$speciesKey, $governmentKey, $uid]);

        $db->prepare('DELETE FROM user_empire_civics WHERE user_id = ?')->execute([$uid]);
        $slot = 1;
        foreach ($normalizedCivics as $civicKey) {
            $db->prepare(
                'INSERT INTO user_empire_civics (user_id, civic_key, slot_index)
                 VALUES (?, ?, ?)'
            )->execute([$uid, $civicKey, $slot]);
            $slot += 1;
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        json_error('Failed to persist politics configuration.', 500);
    }
}

function politics_presets(): array {
    return [
        [
            'preset_key' => 'balanced_republic',
            'name' => 'Balanced Republic',
            'description' => 'Stable welfare-oriented baseline with moderate growth.',
            'primary_species_key' => 'adaptive_humans',
            'government_key' => 'stellar_republic',
            'civic_keys' => ['meritocracy', 'adaptive_bureaucracy'],
        ],
        [
            'preset_key' => 'industrial_directorate',
            'name' => 'Industrial Directorate',
            'description' => 'Strong output and research at the cost of social pressure.',
            'primary_species_key' => 'lithoid_miners',
            'government_key' => 'directorate',
            'civic_keys' => ['meritocracy', 'adaptive_bureaucracy'],
        ],
        [
            'preset_key' => 'martial_expansion',
            'name' => 'Martial Expansion',
            'description' => 'Fleet-focused doctrine with higher internal tension risk.',
            'primary_species_key' => 'lithoid_miners',
            'government_key' => 'martial_command',
            'civic_keys' => ['industrial_war_machine', 'adaptive_bureaucracy'],
        ],
        [
            'preset_key' => 'bio_welfare_compact',
            'name' => 'Bio Welfare Compact',
            'description' => 'Population and welfare optimized tall-play profile.',
            'primary_species_key' => 'gene_crafters',
            'government_key' => 'stellar_republic',
            'civic_keys' => ['civil_welfare_network', 'adaptive_bureaucracy'],
        ],
    ];
}

function decode_json_map($json): array {
    if (!is_string($json) || trim($json) === '') {
        return [];
    }
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}
