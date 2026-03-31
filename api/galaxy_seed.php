<?php

require_once __DIR__ . '/galaxy_gen.php';

function galaxy_system_limit(): int {
    $cfg = galaxy_config();
    $configured = (int)($cfg['galaxy']['systems_per_galaxy'] ?? (defined('SYSTEM_MAX') ? SYSTEM_MAX : 499));
    return max(1, $configured);
}

function galaxy_bootstrap_config(): array {
    $cfg = galaxy_config();
    $defaults = [
        'initial_galaxy_index' => 1,
        'initial_systems' => min(25000, galaxy_system_limit()),
        'auto_seed_batch_size' => 250,
        'per_user_systems' => 50,
        'seed_planets' => true,
    ];

    $bootstrap = is_array($cfg['bootstrap'] ?? null) ? $cfg['bootstrap'] : [];
    $merged = array_replace($defaults, $bootstrap);
    $merged['initial_galaxy_index'] = max(1, min(GALAXY_MAX, (int)$merged['initial_galaxy_index']));
    $merged['initial_systems'] = max(0, min(galaxy_system_limit(), (int)$merged['initial_systems']));
    $merged['auto_seed_batch_size'] = max(1, (int)$merged['auto_seed_batch_size']);
    $merged['per_user_systems'] = max(0, (int)$merged['per_user_systems']);
    $merged['seed_planets'] = !array_key_exists('seed_planets', $merged) || (bool)$merged['seed_planets'];
    return $merged;
}

function ensure_app_state_table(PDO $db): void {
    $db->exec(
        'CREATE TABLE IF NOT EXISTS app_state (
            state_key VARCHAR(64) PRIMARY KEY,
            state_value VARCHAR(255) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB'
    );
}

function ensure_planet_science_columns(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }

    $columns = [
        'composition_family' => "ALTER TABLE planets ADD COLUMN composition_family VARCHAR(64) NOT NULL DEFAULT 'silicate_metal'",
        'dominant_surface_material' => "ALTER TABLE planets ADD COLUMN dominant_surface_material VARCHAR(64) NOT NULL DEFAULT 'basaltic_regolith'",
        'surface_pressure_bar' => "ALTER TABLE planets ADD COLUMN surface_pressure_bar DOUBLE NOT NULL DEFAULT 0.0",
        'water_state' => "ALTER TABLE planets ADD COLUMN water_state VARCHAR(32) NOT NULL DEFAULT 'solid'",
        'methane_state' => "ALTER TABLE planets ADD COLUMN methane_state VARCHAR(32) NOT NULL DEFAULT 'gas'",
        'ammonia_state' => "ALTER TABLE planets ADD COLUMN ammonia_state VARCHAR(32) NOT NULL DEFAULT 'gas'",
        'dominant_surface_liquid' => "ALTER TABLE planets ADD COLUMN dominant_surface_liquid VARCHAR(32) NOT NULL DEFAULT 'none'",
        'radiation_level' => "ALTER TABLE planets ADD COLUMN radiation_level VARCHAR(32) NOT NULL DEFAULT 'moderate'",
        'habitability_score' => "ALTER TABLE planets ADD COLUMN habitability_score TINYINT UNSIGNED NOT NULL DEFAULT 0",
        'life_friendliness' => "ALTER TABLE planets ADD COLUMN life_friendliness VARCHAR(32) NOT NULL DEFAULT 'life_hostile'",
        'species_affinity_json' => "ALTER TABLE planets ADD COLUMN species_affinity_json JSON DEFAULT NULL",
    ];

    $check = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );

    foreach ($columns as $name => $ddl) {
        $check->execute(['planets', $name]);
        if ((int)$check->fetchColumn() === 0) {
            $db->exec($ddl);
        }
    }

    $done = true;
}

function ensure_star_system_columns(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }

    $columns = [
        'stellar_type' => "ALTER TABLE star_systems ADD COLUMN stellar_type ENUM('main_sequence','white_dwarf','brown_dwarf','neutron_star','giant','subdwarf') NOT NULL DEFAULT 'main_sequence'",
        'age_gyr' => "ALTER TABLE star_systems ADD COLUMN age_gyr DECIMAL(4,2) NOT NULL DEFAULT 5.0",
        'metallicity_z' => "ALTER TABLE star_systems ADD COLUMN metallicity_z DECIMAL(6,4) NOT NULL DEFAULT 0.0200",
        'is_binary' => "ALTER TABLE star_systems ADD COLUMN is_binary TINYINT(1) NOT NULL DEFAULT 0",
        'is_circumbinary' => "ALTER TABLE star_systems ADD COLUMN is_circumbinary TINYINT(1) NOT NULL DEFAULT 0",
        'companion_stellar_type' => "ALTER TABLE star_systems ADD COLUMN companion_stellar_type ENUM('main_sequence','white_dwarf','brown_dwarf','neutron_star','giant','subdwarf') DEFAULT NULL",
        'companion_spectral_class' => "ALTER TABLE star_systems ADD COLUMN companion_spectral_class VARCHAR(4) DEFAULT NULL",
        'companion_subtype' => "ALTER TABLE star_systems ADD COLUMN companion_subtype TINYINT UNSIGNED DEFAULT NULL",
        'companion_luminosity_class' => "ALTER TABLE star_systems ADD COLUMN companion_luminosity_class VARCHAR(4) DEFAULT NULL",
        'companion_mass_solar' => "ALTER TABLE star_systems ADD COLUMN companion_mass_solar DOUBLE DEFAULT NULL",
        'companion_radius_solar' => "ALTER TABLE star_systems ADD COLUMN companion_radius_solar DOUBLE DEFAULT NULL",
        'companion_temperature_k' => "ALTER TABLE star_systems ADD COLUMN companion_temperature_k MEDIUMINT UNSIGNED DEFAULT NULL",
        'companion_luminosity_solar' => "ALTER TABLE star_systems ADD COLUMN companion_luminosity_solar DOUBLE DEFAULT NULL",
        'companion_separation_au' => "ALTER TABLE star_systems ADD COLUMN companion_separation_au DOUBLE DEFAULT NULL",
        'companion_eccentricity' => "ALTER TABLE star_systems ADD COLUMN companion_eccentricity DOUBLE DEFAULT NULL",
        'stability_critical_au' => "ALTER TABLE star_systems ADD COLUMN stability_critical_au DOUBLE DEFAULT NULL",
        'catalog_name' => "ALTER TABLE star_systems ADD COLUMN catalog_name VARCHAR(32) NOT NULL DEFAULT ''",
        'planet_count' => "ALTER TABLE star_systems ADD COLUMN planet_count TINYINT UNSIGNED NOT NULL DEFAULT 0",
    ];

    $check = $db->prepare(
        'SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );

    foreach ($columns as $name => $ddl) {
        $check->execute(['star_systems', $name]);
        if ((int)$check->fetchColumn() === 0) {
            $db->exec($ddl);
        }
    }

    // White dwarfs are generated with spectral_class='WD'.
    // Older schemas use ENUM('O','B','A','F','G','K','M') and would throw
    // "Data truncated for column spectral_class" on insert.
    $enumStmt = $db->prepare(
        'SELECT COLUMN_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?'
    );
    $enumStmt->execute(['star_systems', 'spectral_class']);
    $columnType = strtolower((string)$enumStmt->fetchColumn());
    if ($columnType !== '' && strpos($columnType, "'wd'") === false) {
        $db->exec("ALTER TABLE star_systems MODIFY COLUMN spectral_class ENUM('O','B','A','F','G','K','M','WD') NOT NULL DEFAULT 'G'");
    }

    $done = true;
}

function ensure_binary_systems_table(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }

    $db->exec(
        "CREATE TABLE IF NOT EXISTS binary_systems (
            id INT AUTO_INCREMENT PRIMARY KEY,
            primary_star_system_id INT NOT NULL UNIQUE,
            is_circumbinary TINYINT(1) NOT NULL DEFAULT 0,
            companion_stellar_type ENUM('main_sequence','white_dwarf','brown_dwarf','neutron_star','giant','subdwarf') DEFAULT NULL,
            companion_spectral_class VARCHAR(4) DEFAULT NULL,
            companion_subtype TINYINT UNSIGNED DEFAULT NULL,
            companion_luminosity_class VARCHAR(4) DEFAULT NULL,
            companion_mass_solar DOUBLE DEFAULT NULL,
            companion_radius_solar DOUBLE DEFAULT NULL,
            companion_temperature_k MEDIUMINT UNSIGNED DEFAULT NULL,
            companion_luminosity_solar DOUBLE DEFAULT NULL,
            separation_au DOUBLE NOT NULL DEFAULT 1.0,
            eccentricity DOUBLE NOT NULL DEFAULT 0.0,
            stability_critical_au DOUBLE DEFAULT NULL,
            mass_ratio DOUBLE DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (primary_star_system_id) REFERENCES star_systems(id) ON DELETE CASCADE,
            INDEX idx_binary_sep (separation_au),
            INDEX idx_binary_type (companion_stellar_type)
        ) ENGINE=InnoDB"
    );

    $done = true;
}

function upsert_binary_system_row(PDO $db, int $starSystemId, array $system): void {
    $isBinary = !empty($system['is_binary']);
    if (!$isBinary) {
        $db->prepare('DELETE FROM binary_systems WHERE primary_star_system_id = ?')->execute([$starSystemId]);
        return;
    }

    $m1 = max(0.08, (float)($system['mass_solar'] ?? 1.0));
    $m2 = max(0.08, (float)($system['companion_mass_solar'] ?? 0.4));
    $massRatio = round($m2 / max(0.16, $m1 + $m2), 6);

    $db->prepare(
        'INSERT INTO binary_systems
             (primary_star_system_id, is_circumbinary,
              companion_stellar_type, companion_spectral_class, companion_subtype, companion_luminosity_class,
              companion_mass_solar, companion_radius_solar, companion_temperature_k, companion_luminosity_solar,
              separation_au, eccentricity, stability_critical_au, mass_ratio)
         VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
             is_circumbinary = VALUES(is_circumbinary),
             companion_stellar_type = VALUES(companion_stellar_type),
             companion_spectral_class = VALUES(companion_spectral_class),
             companion_subtype = VALUES(companion_subtype),
             companion_luminosity_class = VALUES(companion_luminosity_class),
             companion_mass_solar = VALUES(companion_mass_solar),
             companion_radius_solar = VALUES(companion_radius_solar),
             companion_temperature_k = VALUES(companion_temperature_k),
             companion_luminosity_solar = VALUES(companion_luminosity_solar),
             separation_au = VALUES(separation_au),
             eccentricity = VALUES(eccentricity),
             stability_critical_au = VALUES(stability_critical_au),
             mass_ratio = VALUES(mass_ratio),
             updated_at = CURRENT_TIMESTAMP'
    )->execute([
        $starSystemId,
        !empty($system['is_circumbinary']) ? 1 : 0,
        (string)($system['companion_stellar_type'] ?? ''),
        (string)($system['companion_spectral_class'] ?? ''),
        $system['companion_subtype'] !== null ? (int)$system['companion_subtype'] : null,
        (string)($system['companion_luminosity_class'] ?? ''),
        $system['companion_mass_solar'] !== null ? (float)$system['companion_mass_solar'] : null,
        $system['companion_radius_solar'] !== null ? (float)$system['companion_radius_solar'] : null,
        $system['companion_temperature_k'] !== null ? (int)$system['companion_temperature_k'] : null,
        $system['companion_luminosity_solar'] !== null ? (float)$system['companion_luminosity_solar'] : null,
        (float)($system['companion_separation_au'] ?? 1.0),
        (float)($system['companion_eccentricity'] ?? 0.0),
        $system['stability_critical_au'] !== null ? (float)$system['stability_critical_au'] : null,
        $massRatio,
    ]);
}

// ============================================================================
// GOVERNMENT FORM & ALLIANCE ACCESSORS (for API)
// ============================================================================

function get_faction_government(PDO $db, int $factionId): ?array {
    $stmt = $db->prepare(
        'SELECT fg.*, nf.code, nf.name, nf.icon, nf.color
         FROM faction_government fg
         JOIN npc_factions nf ON nf.id = fg.faction_id
         WHERE fg.faction_id = ?'
    );
    $stmt->execute([$factionId]);
    $row = $stmt->fetch();
    
    if (!$row) {
        return null;
    }
    
    $form = (string)($row['government_form'] ?? 'democracy');
    $cfg = government_form_config();
    $formCfg = $cfg['forms'][$form] ?? [];
    
    return [
        'faction_id' => (int)$factionId,
        'faction_code' => $row['code'],
        'faction_name' => $row['name'],
        'form' => $form,
        'form_label' => $formCfg['label'] ?? $form,
        'form_icon' => $formCfg['icon'] ?? '⚖️',
        'form_color' => $formCfg['color'] ?? '#888888',
        'stability_score' => (int)($row['stability_score'] ?? 75),
        'bonuses' => get_government_bonuses($form),
        'last_form_change' => $row['last_form_change'],
    ];
}

function get_faction_alliances(PDO $db, int $factionId): array {
    $stmt = $db->prepare(
        'SELECT faction_a_id, faction_b_id, alliance_strength,
                (CASE WHEN faction_a_id = ? THEN faction_b_id ELSE faction_a_id END) AS ally_id,
                (SELECT name FROM npc_factions WHERE id = (CASE WHEN faction_a_id = ? THEN faction_b_id ELSE faction_a_id END)) AS ally_name
         FROM faction_alliances
         WHERE faction_a_id = ? OR faction_b_id = ?'
    );
    $stmt->execute([$factionId, $factionId, $factionId, $factionId]);
    $rows = $stmt->fetchAll();
    
    $alliances = [];
    foreach ($rows as $row) {
        $strength = (int)($row['alliance_strength'] ?? 0);
        $status = match (true) {
            $strength > 50 => 'allied',
            $strength > 10 => 'friendly',
            $strength > -30 => 'neutral',
            $strength > -80 => 'hostile',
            default => 'enemy',
        };
        
        $alliances[] = [
            'ally_faction_id' => (int)$row['ally_id'],
            'ally_name' => $row['ally_name'],
            'strength' => $strength,
            'status' => $status,
        ];
    }
    
    return $alliances;
}

function app_state_get_int(PDO $db, string $key, int $default = 0): int {
    ensure_app_state_table($db);
    $stmt = $db->prepare('SELECT state_value FROM app_state WHERE state_key = ?');
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    if ($value === false || !is_numeric((string)$value)) {
        return $default;
    }
    return (int)$value;
}

function app_state_set_int(PDO $db, string $key, int $value): void {
    ensure_app_state_table($db);
    $db->prepare(
        'INSERT INTO app_state (state_key, state_value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), updated_at = CURRENT_TIMESTAMP'
    )->execute([$key, (string)$value]);
}

function slugify_code(string $value): string {
    $value = strtolower($value);
    $value = preg_replace('/[^a-z0-9]+/', '_', $value) ?? $value;
    $value = trim($value, '_');
    return $value === '' ? 'pve' : $value;
}

function pve_faction_defaults(): array {
    return [
        'enabled' => true,
        'count' => 8,
        'seed_galaxy_min' => 1,
        'seed_galaxy_max' => GALAXY_MAX,
        'archetype_weights' => [
            'ancient' => 0.18,
            'raider' => 0.2,
            'merchant' => 0.22,
            'helpers' => 0.2,
            'evil' => 0.2,
        ],
        'non_expansive' => true,
        'max_power_level' => 2200,
        'quest_reward_scale' => 1.0,
    ];
}

function ensure_pve_faction_tables(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS npc_factions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(32) NOT NULL UNIQUE,
            name VARCHAR(64) NOT NULL,
            description TEXT NOT NULL,
            faction_type ENUM('military','trade','science','pirate','ancient') NOT NULL,
            aggression TINYINT UNSIGNED NOT NULL DEFAULT 50,
            trade_willingness TINYINT UNSIGNED NOT NULL DEFAULT 50,
            base_diplomacy SMALLINT NOT NULL DEFAULT 0,
            power_level INT UNSIGNED NOT NULL DEFAULT 1000,
            home_galaxy_min TINYINT UNSIGNED NOT NULL DEFAULT 1,
            home_galaxy_max TINYINT UNSIGNED NOT NULL DEFAULT 9,
            color VARCHAR(7) NOT NULL DEFAULT '#888888',
            icon VARCHAR(4) NOT NULL DEFAULT '👾'
        ) ENGINE=InnoDB"
    );

    $db->exec(
        "CREATE TABLE IF NOT EXISTS faction_quests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            faction_id INT NOT NULL,
            code VARCHAR(64) NOT NULL UNIQUE,
            title VARCHAR(128) NOT NULL,
            description TEXT NOT NULL,
            quest_type ENUM('kill','deliver','explore','build','research','spy') NOT NULL,
            requirements_json TEXT NOT NULL,
            reward_metal INT UNSIGNED NOT NULL DEFAULT 0,
            reward_crystal INT UNSIGNED NOT NULL DEFAULT 0,
            reward_deuterium INT UNSIGNED NOT NULL DEFAULT 0,
            reward_rare_earth INT UNSIGNED NOT NULL DEFAULT 0,
            reward_dark_matter INT UNSIGNED NOT NULL DEFAULT 0,
            reward_rank_points INT UNSIGNED NOT NULL DEFAULT 0,
            reward_standing SMALLINT NOT NULL DEFAULT 10,
            min_standing SMALLINT NOT NULL DEFAULT -100,
            difficulty ENUM('easy','medium','hard','epic') NOT NULL DEFAULT 'medium',
            repeatable TINYINT(1) NOT NULL DEFAULT 0,
            FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB"
    );
}

function pve_faction_config(): array {
    $cfg = galaxy_config();
    $runtime = is_array($cfg['pve_factions'] ?? null) ? $cfg['pve_factions'] : [];
    $merged = array_replace_recursive(pve_faction_defaults(), $runtime);
    $merged['count'] = max(0, (int)$merged['count']);
    $merged['seed_galaxy_min'] = max(1, min(GALAXY_MAX, (int)$merged['seed_galaxy_min']));
    $merged['seed_galaxy_max'] = max($merged['seed_galaxy_min'], min(GALAXY_MAX, (int)$merged['seed_galaxy_max']));
    $merged['max_power_level'] = max(400, (int)$merged['max_power_level']);
    $merged['quest_reward_scale'] = max(0.4, min(3.0, (float)$merged['quest_reward_scale']));
    $merged['non_expansive'] = (bool)$merged['non_expansive'];
    return $merged;
}

function pick_archetype(array $weights, int ...$seeds): string {
    $entries = [];
    foreach ($weights as $key => $weight) {
        $entries[] = ['value' => (string)$key, 'weight' => max(0.0, (float)$weight)];
    }
    if (count($entries) === 0) {
        return 'helpers';
    }
    return weighted_pick($entries, ...$seeds);
}

function archetype_style(string $archetype): array {
    return match ($archetype) {
        'ancient' => [
            'prefixes' => ['Ancient', 'Eternal', 'Precursor'],
            'title' => 'Custodians',
            'faction_type' => 'ancient',
            'icon' => '🌀',
            'color' => '#7d5cff',
            'aggression' => 25,
            'trade' => 35,
            'base_diplomacy' => 5,
            'description' => 'An elusive elder enclave focused on relic stewardship and balance, not territorial expansion.',
        ],
        'raider' => [
            'prefixes' => ['Raiders', 'Clans', 'Marauders'],
            'title' => 'Pack',
            'faction_type' => 'pirate',
            'icon' => '💀',
            'color' => '#d26a2f',
            'aggression' => 85,
            'trade' => 25,
            'base_diplomacy' => -35,
            'description' => 'Fast-strike raiders seeking tribute and skirmishes instead of sustained imperial growth.',
        ],
        'merchant' => [
            'prefixes' => ['Guild', 'Consortium', 'Exchange'],
            'title' => 'Collective',
            'faction_type' => 'trade',
            'icon' => '💰',
            'color' => '#d8a223',
            'aggression' => 12,
            'trade' => 92,
            'base_diplomacy' => 15,
            'description' => 'Profit-driven caravan blocs stabilizing sectors through contracts, markets, and negotiated logistics.',
        ],
        'helpers' => [
            'prefixes' => ['Aid', 'Relief', 'Civic'],
            'title' => 'Network',
            'faction_type' => 'science',
            'icon' => '🤝',
            'color' => '#3fb6aa',
            'aggression' => 5,
            'trade' => 75,
            'base_diplomacy' => 30,
            'description' => 'Cooperative support groups offering infrastructure and rescue programs rather than conquest.',
        ],
        'evil' => [
            'prefixes' => ['Dread', 'Umbra', 'Void'],
            'title' => 'Cabal',
            'faction_type' => 'military',
            'icon' => '☠',
            'color' => '#9d2f38',
            'aggression' => 78,
            'trade' => 18,
            'base_diplomacy' => -45,
            'description' => 'Coercive war-cults preferring sabotage, fear, and ritual objectives over broad colonisation.',
        ],
        default => archetype_style('helpers'),
    };
}

function generate_pve_faction_display_name(string $archetype, int $index): string {
    $style = archetype_style($archetype);
    $prefix = weighted_pick($style['prefixes'], 88001, $index);
    $root = generate_star_name(1 + (($index - 1) % max(1, GALAXY_MAX)), 1000 + $index, 'G');
    $title = (string)($style['title'] ?? 'Order');
    $name = trim($prefix . ' ' . $root . ' ' . $title);
    return strlen($name) > 64 ? substr($name, 0, 64) : $name;
}

function insert_pve_faction_quest(PDO $db, int $factionId, string $factionCode, array $quest, float $scale): void {
    $code = $factionCode . '_' . $quest['code_suffix'];
    $reward = is_array($quest['reward'] ?? null) ? $quest['reward'] : [];

    $db->prepare(
        'INSERT IGNORE INTO faction_quests
            (faction_id, code, title, description, quest_type,
             requirements_json,
             reward_metal, reward_crystal, reward_deuterium, reward_rare_earth,
             reward_dark_matter, reward_rank_points, reward_standing, min_standing, difficulty, repeatable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $factionId,
        $code,
        (string)$quest['title'],
        (string)$quest['description'],
        (string)$quest['quest_type'],
        json_encode($quest['requirements'] ?? [], JSON_UNESCAPED_SLASHES),
        (int)round(((int)($reward['metal'] ?? 0)) * $scale),
        (int)round(((int)($reward['crystal'] ?? 0)) * $scale),
        (int)round(((int)($reward['deuterium'] ?? 0)) * $scale),
        (int)round(((int)($reward['rare_earth'] ?? 0)) * $scale),
        (int)round(((int)($reward['dark_matter'] ?? 0)) * $scale),
        (int)round(((int)($reward['rank_points'] ?? 0)) * $scale),
        (int)($quest['standing'] ?? 10),
        (int)($quest['min_standing'] ?? -100),
        (string)($quest['difficulty'] ?? 'medium'),
        !empty($quest['repeatable']) ? 1 : 0,
    ]);
}

function seed_pve_faction_quests(PDO $db, int $factionId, string $factionCode, string $archetype, float $rewardScale): void {
    $templates = match ($archetype) {
        'ancient' => [
            [
                'code_suffix' => 'relic_survey',
                'title' => 'Relic Survey Mandate',
                'description' => 'Submit two probe reports from remote systems to support precursor archive reconstruction.',
                'quest_type' => 'explore',
                'requirements' => ['spy_reports' => 2],
                'reward' => ['crystal' => 8000, 'deuterium' => 4000, 'dark_matter' => 40, 'rank_points' => 120],
                'standing' => 18,
                'difficulty' => 'medium',
                'repeatable' => 1,
            ],
        ],
        'raider' => [
            [
                'code_suffix' => 'tribute_run',
                'title' => 'Tribute Intercept',
                'description' => 'Deliver 7000 metal and 2000 deuterium to satisfy local raider tribute demands.',
                'quest_type' => 'deliver',
                'requirements' => ['resource' => 'metal', 'amount' => 7000],
                'reward' => ['crystal' => 5000, 'rare_earth' => 120, 'rank_points' => 80],
                'standing' => 14,
                'difficulty' => 'easy',
                'repeatable' => 1,
            ],
            [
                'code_suffix' => 'skirmish_mark',
                'title' => 'Skirmish Mark',
                'description' => 'Win one battle to prove combat readiness to the pack.',
                'quest_type' => 'kill',
                'requirements' => ['battle_wins' => 1],
                'reward' => ['metal' => 6000, 'deuterium' => 2000, 'rank_points' => 100],
                'standing' => 16,
                'difficulty' => 'medium',
                'repeatable' => 1,
            ],
        ],
        'merchant' => [
            [
                'code_suffix' => 'contract_fulfillment',
                'title' => 'Contract Fulfillment',
                'description' => 'Deliver 6000 crystal to complete a secured merchant corridor contract.',
                'quest_type' => 'deliver',
                'requirements' => ['resource' => 'crystal', 'amount' => 6000],
                'reward' => ['metal' => 9000, 'deuterium' => 3000, 'dark_matter' => 20, 'rank_points' => 90],
                'standing' => 12,
                'difficulty' => 'easy',
                'repeatable' => 1,
            ],
        ],
        'helpers' => [
            [
                'code_suffix' => 'aid_shipment',
                'title' => 'Aid Shipment Program',
                'description' => 'Deliver 5000 food-equivalent logistics support to vulnerable colonies.',
                'quest_type' => 'deliver',
                'requirements' => ['resource' => 'food', 'amount' => 5000],
                'reward' => ['metal' => 4000, 'crystal' => 4000, 'rare_earth' => 80, 'rank_points' => 110],
                'standing' => 20,
                'difficulty' => 'easy',
                'repeatable' => 1,
            ],
            [
                'code_suffix' => 'research_support',
                'title' => 'Research Support Initiative',
                'description' => 'Reach research level 4 in any technology to assist regional stabilization protocols.',
                'quest_type' => 'research',
                'requirements' => ['research_level' => 4],
                'reward' => ['crystal' => 9000, 'deuterium' => 5000, 'dark_matter' => 30, 'rank_points' => 140],
                'standing' => 22,
                'difficulty' => 'medium',
                'repeatable' => 0,
            ],
        ],
        'evil' => [
            [
                'code_suffix' => 'coercive_tribute',
                'title' => 'Coercive Tribute',
                'description' => 'Pay 8000 metal to avoid punitive raids from the cabal.',
                'quest_type' => 'deliver',
                'requirements' => ['resource' => 'metal', 'amount' => 8000],
                'reward' => ['deuterium' => 3500, 'rare_earth' => 100, 'rank_points' => 85],
                'standing' => 10,
                'difficulty' => 'easy',
                'repeatable' => 1,
            ],
            [
                'code_suffix' => 'intimidation_trial',
                'title' => 'Intimidation Trial',
                'description' => 'Complete one victorious battle to earn temporary protection marks.',
                'quest_type' => 'kill',
                'requirements' => ['battle_wins' => 1],
                'reward' => ['metal' => 7000, 'crystal' => 2000, 'dark_matter' => 15, 'rank_points' => 95],
                'standing' => 12,
                'difficulty' => 'medium',
                'repeatable' => 1,
            ],
        ],
        default => [],
    };

    foreach ($templates as $quest) {
        insert_pve_faction_quest($db, $factionId, $factionCode, $quest, $rewardScale);
    }
}

function infer_pve_archetype_from_code(string $code): string {
    foreach (['ancient', 'raider', 'merchant', 'helpers', 'evil'] as $kind) {
        if (str_contains($code, '_' . $kind . '_')) {
            return $kind;
        }
    }
    return 'helpers';
}

function backfill_pve_quests_for_existing(PDO $db, float $rewardScale): void {
    $rows = $db->query("SELECT id, code FROM npc_factions WHERE code LIKE 'pve_%'")->fetchAll();
    foreach ($rows as $row) {
        $factionId = (int)($row['id'] ?? 0);
        $code = (string)($row['code'] ?? '');
        if ($factionId <= 0 || $code === '') {
            continue;
        }
        $archetype = infer_pve_archetype_from_code($code);
        seed_pve_faction_quests($db, $factionId, $code, $archetype, $rewardScale);
    }
}

function ensure_pve_factions_seed(PDO $db): void {
    ensure_pve_faction_tables($db);

    $cfg = pve_faction_config();
    if (!$cfg['enabled'] || $cfg['count'] <= 0) {
        return;
    }

    $doneKey = 'pve_factions_seeded_v1';
    $rewardScale = (float)$cfg['quest_reward_scale'];
    if (app_state_get_int($db, $doneKey, 0) === 1) {
        backfill_pve_quests_for_existing($db, $rewardScale);
        return;
    }

    $weights = is_array($cfg['archetype_weights'] ?? null) ? $cfg['archetype_weights'] : [];
    $seedMin = (int)$cfg['seed_galaxy_min'];
    $seedMax = (int)$cfg['seed_galaxy_max'];

    for ($i = 1; $i <= (int)$cfg['count']; $i++) {
        $archetype = pick_archetype($weights, 87001, $i);
        $style = archetype_style($archetype);
        $displayName = generate_pve_faction_display_name($archetype, $i);
        $code = substr(slugify_code('pve_' . $archetype . '_' . $displayName . '_' . $i), 0, 32);

        $homeGalaxy = $seedMin + (int)floor(gen_rand(87011, $i) * max(1, ($seedMax - $seedMin + 1)));
        $homeGalaxy = max($seedMin, min($seedMax, $homeGalaxy));

        $powerCeil = max(400, (int)$cfg['max_power_level']);
        $power = 600 + (int)floor(gen_rand(87021, $i) * max(1, $powerCeil - 600));

        $db->prepare(
            'INSERT IGNORE INTO npc_factions
                (code, name, description, faction_type, aggression, trade_willingness,
                 base_diplomacy, power_level, home_galaxy_min, home_galaxy_max, color, icon)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([
            $code,
            $displayName,
            (string)$style['description'],
            (string)$style['faction_type'],
            (int)$style['aggression'],
            (int)$style['trade'],
            (int)$style['base_diplomacy'],
            $power,
            $homeGalaxy,
            $homeGalaxy,
            (string)$style['color'],
            (string)$style['icon'],
        ]);

        $idStmt = $db->prepare('SELECT id FROM npc_factions WHERE code = ? LIMIT 1');
        $idStmt->execute([$code]);
        $factionId = (int)($idStmt->fetchColumn() ?: 0);
        if ($factionId > 0) {
            seed_pve_faction_quests($db, $factionId, $code, $archetype, $rewardScale);
        }
    }

    backfill_pve_quests_for_existing($db, $rewardScale);

    app_state_set_int($db, $doneKey, 1);
}

// ============================================================================
// GOVERNMENT FORMS & DIPLOMATIC ALLIANCES
// ============================================================================

function government_form_defaults(): array {
    return [
        'enabled' => true,
        'forms' => [
            'monarchy' => [
                'label' => 'Königreich',
                'description' => 'Hierarchische Autorität unter einem Herrscher',
                'icon' => '👑',
                'color' => '#FFD700',
                'decision_speed' => 0.95,
                'diplomacy_decay' => 0.02,
                'alliance_affinity' => ['monarchy' => 0.25, 'oligarchy' => 0.15, 'democracy' => -0.1],
                'quest_bonus' => 1.15,
                'diplomacy_bonus' => 1.05,
                'stability_base' => 70,
                'base_aggression' => 55,
            ],
            'oligarchy' => [
                'label' => 'Oligarchie',
                'description' => 'Macht durch kleine herrschende Klasse verteilt',
                'icon' => '⚖️',
                'color' => '#C0C0C0',
                'decision_speed' => 0.75,
                'diplomacy_decay' => 0.03,
                'alliance_affinity' => ['monarchy' => 0.15, 'oligarchy' => 0.3, 'democracy' => 0.05],
                'quest_bonus' => 1.08,
                'diplomacy_bonus' => 1.02,
                'stability_base' => 60,
                'base_aggression' => 60,
            ],
            'democracy' => [
                'label' => 'Demokratie',
                'description' => 'Kollektive Entscheidungsfindung durch Konsens',
                'icon' => '🗳️',
                'color' => '#4169E1',
                'decision_speed' => 0.5,
                'diplomacy_decay' => 0.01,
                'alliance_affinity' => ['monarchy' => -0.1, 'oligarchy' => 0.05, 'democracy' => 0.35],
                'quest_bonus' => 1.0,
                'diplomacy_bonus' => 1.2,
                'stability_base' => 80,
                'base_aggression' => 35,
            ],
        ],
        'archetype_form_mapping' => [
            'ancient' => ['monarchy' => 0.5, 'oligarchy' => 0.3, 'democracy' => 0.2],
            'raider' => ['monarchy' => 0.4, 'oligarchy' => 0.45, 'democracy' => 0.15],
            'merchant' => ['monarchy' => 0.2, 'oligarchy' => 0.5, 'democracy' => 0.3],
            'helpers' => ['monarchy' => 0.1, 'oligarchy' => 0.2, 'democracy' => 0.7],
            'evil' => ['monarchy' => 0.6, 'oligarchy' => 0.35, 'democracy' => 0.05],
        ],
        'alliance_decay_per_turn' => 0.015,
        'diplomacy_change_threshold' => 5,
        'min_alliance_strength' => -50,
        'max_alliance_strength' => 100,
    ];
}

function government_form_config(): array {
    $cfg = galaxy_config();
    $runtime = is_array($cfg['government_forms'] ?? null) ? $cfg['government_forms'] : [];
    $merged = array_replace_recursive(government_form_defaults(), $runtime);
    $merged['enabled'] = (bool)$merged['enabled'];
    $merged['alliance_decay_per_turn'] = max(0.0, (float)$merged['alliance_decay_per_turn']);
    $merged['diplomacy_change_threshold'] = max(1, (int)$merged['diplomacy_change_threshold']);
    return $merged;
}

function ensure_government_tables(PDO $db): void {
    $db->exec(
        "CREATE TABLE IF NOT EXISTS faction_government (
            faction_id INT PRIMARY KEY,
            government_form VARCHAR(32) NOT NULL DEFAULT 'democracy',
            stability_score INT NOT NULL DEFAULT 75,
            last_form_change DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB"
    );

    $db->exec(
        "CREATE TABLE IF NOT EXISTS faction_alliances (
            faction_a_id INT NOT NULL,
            faction_b_id INT NOT NULL,
            alliance_strength INT NOT NULL DEFAULT 0,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (faction_a_id, faction_b_id),
            FOREIGN KEY (faction_a_id) REFERENCES npc_factions(id) ON DELETE CASCADE,
            FOREIGN KEY (faction_b_id) REFERENCES npc_factions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB"
    );

    $db->exec(
        "CREATE TABLE IF NOT EXISTS faction_standing_adjustments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            faction_id INT NOT NULL,
            adjustment INT NOT NULL,
            reason VARCHAR(128) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
        ) ENGINE=InnoDB"
    );
}

function pick_government_form(string $archetype, int ...$seeds): string {
    $cfg = government_form_config();
    $mapping = $cfg['archetype_form_mapping'][$archetype] ?? [];
    if (empty($mapping)) {
        $mapping = ['democracy' => 0.5, 'monarchy' => 0.3, 'oligarchy' => 0.2];
    }
    
    $entries = [];
    foreach ($mapping as $form => $weight) {
        $entries[] = ['value' => $form, 'weight' => max(0.0, (float)$weight)];
    }
    
    if (count($entries) === 0) {
        return 'democracy';
    }
    
    return weighted_pick($entries, ...$seeds);
}

function get_government_bonuses(string $form): array {
    $cfg = government_form_config();
    $formCfg = $cfg['forms'][$form] ?? null;
    if ($formCfg === null) {
        $forms = $cfg['forms'];
        $formCfg = reset($forms);
    }
    
    return [
        'quest_bonus' => (float)($formCfg['quest_bonus'] ?? 1.0),
        'diplomacy_bonus' => (float)($formCfg['diplomacy_bonus'] ?? 1.0),
        'stability_base' => (int)($formCfg['stability_base'] ?? 75),
        'base_aggression' => (int)($formCfg['base_aggression'] ?? 50),
        'decision_speed' => (float)($formCfg['decision_speed'] ?? 1.0),
        'diplomacy_decay' => (float)($formCfg['diplomacy_decay'] ?? 0.02),
    ];
}

function seed_faction_governments(PDO $db): void {
    ensure_government_tables($db);
    
    $cfg = government_form_config();
    if (!$cfg['enabled']) {
        return;
    }

    $doneKey = 'faction_governments_seeded_v1';
    if (app_state_get_int($db, $doneKey, 0) === 1) {
        return;
    }

    $factions = $db->query('SELECT id, code FROM npc_factions')->fetchAll();
    foreach ($factions as $row) {
        $factionId = (int)$row['id'];
        $code = (string)$row['code'];
        
        $archetype = infer_pve_archetype_from_code($code);
        $form = pick_government_form($archetype, 87100, $factionId);
        
        $db->prepare(
            'INSERT IGNORE INTO faction_government (faction_id, government_form, stability_score)
             VALUES (?, ?, ?)'
        )->execute([$factionId, $form, 75]);
    }

    app_state_set_int($db, $doneKey, 1);
}

function seed_faction_alliances(PDO $db): void {
    ensure_government_tables($db);
    
    $cfg = government_form_config();
    if (!$cfg['enabled']) {
        return;
    }

    $doneKey = 'faction_alliances_seeded_v1';
    if (app_state_get_int($db, $doneKey, 0) === 1) {
        return;
    }

    $factions = $db->query('SELECT id, code FROM npc_factions ORDER BY id')->fetchAll();
    $count = count($factions);
    
    for ($i = 0; $i < $count; $i++) {
        for ($j = $i + 1; $j < $count; $j++) {
            $factionA = (int)$factions[$i]['id'];
            $factionB = (int)$factions[$j]['id'];
            
            // Get government forms
            $stmtA = $db->prepare('SELECT government_form FROM faction_government WHERE faction_id = ?');
            $stmtA->execute([$factionA]);
            $formA = (string)($stmtA->fetchColumn() ?: 'democracy');
            
            $stmtB = $db->prepare('SELECT government_form FROM faction_government WHERE faction_id = ?');
            $stmtB->execute([$factionB]);
            $formB = (string)($stmtB->fetchColumn() ?: 'democracy');
            
            // Calculate alliance affinity based on government forms
            $cfg = government_form_config();
            $affinityA = $cfg['forms'][$formA]['alliance_affinity'][$formB] ?? 0.0;
            $affinityB = $cfg['forms'][$formB]['alliance_affinity'][$formA] ?? 0.0;
            $baseAffinity = (float)(($affinityA + $affinityB) / 2);
            
            // Add random variation
            $seed = 87200 + $i * 100 + $j;
            $variation = (gen_rand($seed, 1) - 0.5) * 20;
            $strength = (int)($baseAffinity * 50 + $variation);
            $strength = max($cfg['min_alliance_strength'], min($cfg['max_alliance_strength'], $strength));
            
            $db->prepare(
                'INSERT IGNORE INTO faction_alliances (faction_a_id, faction_b_id, alliance_strength)
                 VALUES (?, ?, ?)'
            )->execute([$factionA, $factionB, $strength]);
        }
    }

    app_state_set_int($db, $doneKey, 1);
}

function ensure_diplomacy_initialized(PDO $db): void {
    seed_faction_governments($db);
    seed_faction_alliances($db);
}

function galaxy_bootstrap_state_key(int $galaxyIdx): string {
    return 'galaxy_bootstrap:' . $galaxyIdx . ':last_seeded_system';
}

function detect_last_contiguous_seeded_system(PDO $db, int $galaxyIdx, int $target): int {
    $stmt = $db->prepare(
        'SELECT system_index
         FROM star_systems
         WHERE galaxy_index = ? AND system_index BETWEEN 1 AND ?
         ORDER BY system_index ASC'
    );
    $stmt->execute([$galaxyIdx, $target]);
    $expected = 1;
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $systemIndex) {
        $current = (int)$systemIndex;
        if ($current !== $expected) {
            break;
        }
        $expected++;
    }
    return $expected - 1;
}

function seed_planet_class_to_type(string $planetClass): string {
    return match ($planetClass) {
        'lava' => 'volcanic',
        'gas_giant', 'hot_jupiter' => 'gas_giant',
        'ice_giant', 'ice_dwarf', 'comet_belt' => 'ice',
        default => 'terrestrial',
    };
}

function fetch_star_system_row_id(PDO $db, int $galaxyIdx, int $systemIdx): int {
    $stmt = $db->prepare(
        'SELECT id FROM star_systems WHERE galaxy_index = ? AND system_index = ?'
    );
    $stmt->execute([$galaxyIdx, $systemIdx]);
    return (int)($stmt->fetchColumn() ?: 0);
}

function upsert_generated_planets(PDO $db, int $galaxyIdx, int $systemIdx, int $systemId, array $planets): void {
    ensure_planet_science_columns($db);
    $insert = $db->prepare(
        'INSERT INTO planets
            (system_id, galaxy, `system`, position, type, planet_class, diameter,
             temp_min, temp_max, semi_major_axis_au, orbital_period_days,
             orbital_eccentricity, surface_gravity_g, in_habitable_zone,
             atmosphere_type, richness_metal, richness_crystal, richness_deuterium,
             richness_rare_earth, deposit_metal, deposit_crystal,
             deposit_deuterium, deposit_rare_earth, composition_family,
             dominant_surface_material, surface_pressure_bar, water_state,
             methane_state, ammonia_state, dominant_surface_liquid,
             radiation_level, habitability_score, life_friendliness, species_affinity_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            system_id = VALUES(system_id),
            type = VALUES(type),
            planet_class = VALUES(planet_class),
            diameter = VALUES(diameter),
            temp_min = VALUES(temp_min),
            temp_max = VALUES(temp_max),
            semi_major_axis_au = VALUES(semi_major_axis_au),
            orbital_period_days = VALUES(orbital_period_days),
            orbital_eccentricity = VALUES(orbital_eccentricity),
            surface_gravity_g = VALUES(surface_gravity_g),
            in_habitable_zone = VALUES(in_habitable_zone),
            atmosphere_type = VALUES(atmosphere_type),
            richness_metal = VALUES(richness_metal),
            richness_crystal = VALUES(richness_crystal),
            richness_deuterium = VALUES(richness_deuterium),
            richness_rare_earth = VALUES(richness_rare_earth),
            deposit_metal = VALUES(deposit_metal),
            deposit_crystal = VALUES(deposit_crystal),
            deposit_deuterium = VALUES(deposit_deuterium),
                deposit_rare_earth = VALUES(deposit_rare_earth),
                composition_family = VALUES(composition_family),
                dominant_surface_material = VALUES(dominant_surface_material),
                surface_pressure_bar = VALUES(surface_pressure_bar),
                water_state = VALUES(water_state),
                methane_state = VALUES(methane_state),
                ammonia_state = VALUES(ammonia_state),
                dominant_surface_liquid = VALUES(dominant_surface_liquid),
                radiation_level = VALUES(radiation_level),
                habitability_score = VALUES(habitability_score),
                life_friendliness = VALUES(life_friendliness),
                species_affinity_json = VALUES(species_affinity_json)'
    );

    foreach ($planets as $planet) {
        if (!is_array($planet)) {
            continue;
        }
        $planetClass = (string)($planet['planet_class'] ?? 'rocky');
        $insert->execute([
            $systemId,
            $galaxyIdx,
            $systemIdx,
            (int)($planet['position'] ?? 1),
            seed_planet_class_to_type($planetClass),
            $planetClass,
            (int)($planet['diameter_km'] ?? 12742),
            (int)($planet['temp_min'] ?? -20),
            (int)($planet['temp_max'] ?? 40),
            (float)($planet['semi_major_axis_au'] ?? 1.0),
            (float)($planet['orbital_period_days'] ?? 365.25),
            (float)($planet['orbital_eccentricity'] ?? 0.02),
            (float)($planet['surface_gravity_g'] ?? 1.0),
            !empty($planet['in_habitable_zone']) ? 1 : 0,
            (string)($planet['atmosphere_type'] ?? 'nitrogen_oxygen'),
            (float)($planet['richness_metal'] ?? 1.0),
            (float)($planet['richness_crystal'] ?? 1.0),
            (float)($planet['richness_deuterium'] ?? 1.0),
            (float)($planet['richness_rare_earth'] ?? 0.5),
            (int)($planet['deposit_metal'] ?? 5000000),
            (int)($planet['deposit_crystal'] ?? 2000000),
            (int)($planet['deposit_deuterium'] ?? 1000000),
            (int)($planet['deposit_rare_earth'] ?? 200000),
            (string)($planet['composition_family'] ?? 'silicate_metal'),
            (string)($planet['dominant_surface_material'] ?? 'basaltic_regolith'),
            (float)($planet['surface_pressure_bar'] ?? 0.0),
            (string)($planet['water_state'] ?? 'solid'),
            (string)($planet['methane_state'] ?? 'gas'),
            (string)($planet['ammonia_state'] ?? 'gas'),
            (string)($planet['dominant_surface_liquid'] ?? 'none'),
            (string)($planet['radiation_level'] ?? 'moderate'),
            (int)($planet['habitability_score'] ?? 0),
            (string)($planet['life_friendliness'] ?? 'life_hostile'),
            json_encode($planet['species_suitability'] ?? [], JSON_UNESCAPED_SLASHES),
        ]);
    }
}

function cache_generated_system(PDO $db, int $galaxyIdx, int $systemIdx, bool $seedPlanets = true): array {
    $stmt = $db->prepare(
        'SELECT * FROM star_systems WHERE galaxy_index = ? AND system_index = ?'
    );
    $stmt->execute([$galaxyIdx, $systemIdx]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row) {
        if (preg_match('/^GQ-\d+-\d+$/', (string)($row['name'] ?? '')) === 1) {
            $newName = generate_star_name($galaxyIdx, $systemIdx);
            $db->prepare(
                'UPDATE star_systems SET name = ? WHERE id = ?'
            )->execute([$newName, (int)$row['id']]);
            $row['name'] = $newName;
        }
        $system = $row;
        $system['planets'] = generate_planets([
            'spectral_class' => $row['spectral_class'],
            'subtype' => (int)$row['subtype'],
            'luminosity_class' => $row['luminosity_class'],
            'mass_solar' => (float)$row['mass_solar'],
            'radius_solar' => (float)$row['radius_solar'],
            'temperature_k' => (int)$row['temperature_k'],
            'luminosity_solar' => (float)$row['luminosity_solar'],
        ], $galaxyIdx, $systemIdx, (string)$row['name'], [
            'is_binary' => !empty($row['is_binary']) ? 1 : 0,
            'is_circumbinary' => !empty($row['is_circumbinary']) ? 1 : 0,
            'companion_mass_solar' => $row['companion_mass_solar'] ?? null,
            'companion_separation_au' => $row['companion_separation_au'] ?? null,
            'companion_eccentricity' => $row['companion_eccentricity'] ?? null,
        ]);

        $planetCount = count($system['planets']);
        if (!isset($system['catalog_name']) || (string)$system['catalog_name'] === '') {
            $system['catalog_name'] = (string)($system['name'] ?? '');
        }
        $system['planet_count'] = (int)($system['planet_count'] ?? $planetCount);
        if ((int)$system['planet_count'] <= 0 || (string)$system['catalog_name'] === '') {
            $db->prepare(
                'UPDATE star_systems
                 SET catalog_name = COALESCE(NULLIF(catalog_name, ""), ?),
                     planet_count = ?
                 WHERE id = ?'
            )->execute([
                (string)$system['catalog_name'],
                $planetCount,
                (int)$row['id'],
            ]);
            $system['planet_count'] = $planetCount;
        }

        if ($seedPlanets) {
            upsert_generated_planets($db, $galaxyIdx, $systemIdx, (int)$row['id'], $system['planets']);
        }
        upsert_binary_system_row($db, (int)$row['id'], $system);
        return $system;
    }

    $system = generate_star_system($galaxyIdx, $systemIdx);
    $db->prepare(
        'INSERT INTO star_systems
             (galaxy_index, system_index, x_ly, y_ly, z_ly,
              galactic_radius_ly, galactic_theta_rad, galactic_height_ly,
              spectral_class, subtype, luminosity_class,
              mass_solar, radius_solar, temperature_k, luminosity_solar,
              age_gyr, metallicity_z, stellar_type,
                            is_binary, is_circumbinary,
                            companion_stellar_type, companion_spectral_class, companion_subtype, companion_luminosity_class,
                            companion_mass_solar, companion_radius_solar, companion_temperature_k, companion_luminosity_solar,
                            companion_separation_au, companion_eccentricity, stability_critical_au,
              hz_inner_au, hz_outer_au, frost_line_au, name, catalog_name, planet_count)
                        VALUES (?,?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?, ?,?, ?,?,?,?, ?,?,?,?, ?,?, ?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
            x_ly = VALUES(x_ly),
            y_ly = VALUES(y_ly),
            z_ly = VALUES(z_ly),
            galactic_radius_ly = VALUES(galactic_radius_ly),
            galactic_theta_rad = VALUES(galactic_theta_rad),
            galactic_height_ly = VALUES(galactic_height_ly),
            spectral_class = VALUES(spectral_class),
            subtype = VALUES(subtype),
            luminosity_class = VALUES(luminosity_class),
            mass_solar = VALUES(mass_solar),
            radius_solar = VALUES(radius_solar),
            temperature_k = VALUES(temperature_k),
            luminosity_solar = VALUES(luminosity_solar),
            age_gyr = VALUES(age_gyr),
            metallicity_z = VALUES(metallicity_z),
            stellar_type = VALUES(stellar_type),
            is_binary = VALUES(is_binary),
            is_circumbinary = VALUES(is_circumbinary),
            companion_stellar_type = VALUES(companion_stellar_type),
            companion_spectral_class = VALUES(companion_spectral_class),
            companion_subtype = VALUES(companion_subtype),
            companion_luminosity_class = VALUES(companion_luminosity_class),
            companion_mass_solar = VALUES(companion_mass_solar),
            companion_radius_solar = VALUES(companion_radius_solar),
            companion_temperature_k = VALUES(companion_temperature_k),
            companion_luminosity_solar = VALUES(companion_luminosity_solar),
            companion_separation_au = VALUES(companion_separation_au),
            companion_eccentricity = VALUES(companion_eccentricity),
            stability_critical_au = VALUES(stability_critical_au),
            hz_inner_au = VALUES(hz_inner_au),
            hz_outer_au = VALUES(hz_outer_au),
            frost_line_au = VALUES(frost_line_au),
            name = VALUES(name),
            catalog_name = VALUES(catalog_name),
            planet_count = VALUES(planet_count)'
    )->execute([
        $galaxyIdx,
        $systemIdx,
        $system['x_ly'],
        $system['y_ly'],
        $system['z_ly'],
        $system['galactic_radius_ly'] ?? null,
        $system['galactic_theta_rad'] ?? null,
        $system['galactic_height_ly'] ?? null,
        $system['spectral_class'],
        $system['subtype'],
        $system['luminosity_class'],
        $system['mass_solar'],
        $system['radius_solar'],
        $system['temperature_k'],
        $system['luminosity_solar'],
        $system['age_gyr'] ?? 0.0,
        $system['metallicity_z'] ?? 0.02,
        $system['stellar_type'] ?? 'main_sequence',
        !empty($system['is_binary']) ? 1 : 0,
        !empty($system['is_circumbinary']) ? 1 : 0,
        $system['companion_stellar_type'] ?? null,
        $system['companion_spectral_class'] ?? null,
        $system['companion_subtype'] ?? null,
        $system['companion_luminosity_class'] ?? null,
        $system['companion_mass_solar'] ?? null,
        $system['companion_radius_solar'] ?? null,
        $system['companion_temperature_k'] ?? null,
        $system['companion_luminosity_solar'] ?? null,
        $system['companion_separation_au'] ?? null,
        $system['companion_eccentricity'] ?? null,
        $system['stability_critical_au'] ?? null,
        $system['hz_inner_au'],
        $system['hz_outer_au'],
        $system['frost_line_au'],
        $system['name'],
        $system['catalog_name'] ?? $system['name'],
        count($system['planets'] ?? []),
    ]);

    $systemId = fetch_star_system_row_id($db, $galaxyIdx, $systemIdx);
    if ($systemId > 0) {
        upsert_binary_system_row($db, $systemId, $system);
    }

    if ($seedPlanets) {
        if ($systemId > 0) {
            upsert_generated_planets($db, $galaxyIdx, $systemIdx, $systemId, $system['planets']);
        }
    }

    return $system;
}

function ensure_galaxy_bootstrap_progress(PDO $db, bool $forceComplete = false): array {
    ensure_star_system_columns($db);
    ensure_binary_systems_table($db);
    ensure_pve_factions_seed($db);
    ensure_diplomacy_initialized($db);

    $cfg = galaxy_bootstrap_config();
    $galaxyIdx = (int)$cfg['initial_galaxy_index'];
    $targetSystems = (int)$cfg['initial_systems'];

    if ($targetSystems <= 0) {
        return ['galaxy' => $galaxyIdx, 'seeded' => 0, 'complete' => true, 'target' => 0];
    }

    $stateKey = galaxy_bootstrap_state_key($galaxyIdx);
    $lastSeeded = app_state_get_int($db, $stateKey, -1);
    if ($lastSeeded < 0) {
        // First-ever run: initialize progress from existing contiguous cache.
        // Full bootstrap should only happen when explicitly requested.
        $lastSeeded = detect_last_contiguous_seeded_system($db, $galaxyIdx, $targetSystems);
        app_state_set_int($db, $stateKey, $lastSeeded);
    }

    if ($lastSeeded >= $targetSystems) {
        return ['galaxy' => $galaxyIdx, 'seeded' => 0, 'complete' => true, 'target' => $targetSystems];
    }

    $batchSize = $forceComplete ? ($targetSystems - $lastSeeded) : (int)$cfg['auto_seed_batch_size'];
    $endSystem = min($targetSystems, $lastSeeded + max(1, $batchSize));
    $seededCount = 0;
    for ($systemIdx = $lastSeeded + 1; $systemIdx <= $endSystem; $systemIdx++) {
        cache_generated_system($db, $galaxyIdx, $systemIdx, (bool)$cfg['seed_planets']);
        $seededCount++;
    }
    app_state_set_int($db, $stateKey, $endSystem);

    return [
        'galaxy' => $galaxyIdx,
        'seeded' => $seededCount,
        'complete' => $endSystem >= $targetSystems,
        'target' => $targetSystems,
        'last_seeded_system' => $endSystem,
    ];
}

function systems_around_center(int $centerSystem, int $count, int $maxSystem): array {
    $systems = [];
    if ($count <= 0) {
        return $systems;
    }

    $systems[] = max(1, min($maxSystem, $centerSystem));
    for ($offset = 1; count($systems) < $count && $offset <= $maxSystem; $offset++) {
        $left = $centerSystem - $offset;
        $right = $centerSystem + $offset;
        if ($left >= 1) {
            $systems[] = $left;
            if (count($systems) >= $count) {
                break;
            }
        }
        if ($right <= $maxSystem) {
            $systems[] = $right;
        }
    }

    return array_values(array_unique(array_slice($systems, 0, $count)));
}

function seed_user_start_region(PDO $db, int $galaxyIdx, int $centerSystem): array {
    $cfg = galaxy_bootstrap_config();
    $systems = systems_around_center($centerSystem, (int)$cfg['per_user_systems'], galaxy_system_limit());
    foreach ($systems as $systemIdx) {
        cache_generated_system($db, $galaxyIdx, $systemIdx, (bool)$cfg['seed_planets']);
    }
    return $systems;
}