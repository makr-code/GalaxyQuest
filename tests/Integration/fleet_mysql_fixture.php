<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\FleetMySql;

use PDO;
use RuntimeException;

const BATTLE_ENCOUNTERS_ENABLED = 1;

function load_fleet_functions(): void
{
    require_once __DIR__ . '/../bootstrap.php';
    if (function_exists(__NAMESPACE__ . '\\launch_fleet_dispatch')) {
        return;
    }
    $handlersWereInitialized = defined('GQ_API_ERROR_HANDLERS_READY');
    require_once dirname(__DIR__, 2) . '/api/factions.php';
    if (!$handlersWereInitialized) {
        restore_error_handler();
        restore_exception_handler();
    }
    $sources = [
        'lib/fleet_launch.php' => ['launch_fleet_dispatch', 'launch_fleet_dispatch_locked',
            'validate_fleet_attack_policy', 'resolve_wormhole_route', 'consume_wormhole_jump'],
        'api/game_engine.php' => ['launch_fleet_for_user'],
        'api/fleet.php' => ['process_fleet_arrival_locked', 'handle_fleet_arrival', 'resolve_battle',
            'return_fleet_to_origin', 'decode_fleet_cargo_payload', 'battle_preview_outcome',
            'battle_rng_float', 'build_battle_rounds_summary', 'compute_relative_impact',
            'compute_energy_combat_profile', 'clampf'],
    ];
    foreach ($sources as $path => $functions) {
        $file = dirname(__DIR__, 2) . '/' . $path;
        $source = file_get_contents($file);
        if ($source === false) {
            throw new RuntimeException('Cannot read fleet fixture source.');
        }
        foreach ($functions as $name) {
            $start = strpos($source, 'function ' . $name . '(');
            if ($start === false) {
                throw new RuntimeException('Missing fleet function: ' . $name);
            }
            $end = strpos($source, "\nfunction ", $start + 1);
            $body = substr($source, $start, ($end === false ? strlen($source) : $end) - $start);
            eval('namespace ' . __NAMESPACE__ . '; use PDO; use DomainException; use PDOException; '
                . 'use GalaxyQuest\\Combat\\FleetDispatchReceipt; '
                . 'use GalaxyQuest\\Combat\\BattleEncounterService; '
                . 'use GalaxyQuest\\Combat\\BattleResolver; use GalaxyQuest\\Economy\\ResourceLedger; '
                . str_replace('__DIR__', var_export(dirname($file), true), $body));
        }
    }
}

// Economy catch-up, build queues and cache IO are independent fixtures;
// the production launch, claim, combat, diplomacy, return SQL and ledger run unchanged.
function update_colony_resources(PDO $db, int $colonyId): void
{
}

// Fleet-focused double for the on-demand ledger: debits the colony row under the
// same transactional ledger lock without requiring the economy schema.
final class OnDemandEconomy
{
    public function __construct(private PDO $db)
    {
    }

    public function spend(int $colonyId, int $userId, array $cost, callable $mutation): mixed
    {
        return (new \GalaxyQuest\Economy\ResourceLedger($this->db))->spend($colonyId, $userId, $cost, $mutation);
    }
}

function complete_ship_build_queue(PDO $db, int $colonyId): void
{
}

function gq_cache_delete(string $type, array $params): void
{
}

function enqueue_dirty_user(PDO $db, int $userId, string $reason = ''): void
{
    $db->prepare('INSERT INTO fixture_dirty_users (user_id, reason) VALUES (?, ?)')
        ->execute([$userId, $reason]);
}

function enqueue_dirty_system(PDO $db, int $galaxy, int $system, string $reason = ''): void
{
    $db->prepare('INSERT INTO fixture_dirty_systems (galaxy, system_index, reason) VALUES (?, ?, ?)')
        ->execute([$galaxy, $system, $reason]);
}

function touch_system_visibility(
    PDO $db,
    int $userId,
    int $galaxy,
    int $system,
    string $level,
    ?string $expiresAt,
    ?array $snapshot
): void {
}

function leaders_attack_skill_column(PDO $db): ?string
{
    return null;
}

function load_combat_modifier_totals(PDO $db, int $attacker, int $defender): array
{
    return ['attacker' => [], 'defender' => []];
}

function combat_modifier_scalar(array $mods, string $key): float
{
    return 1.0;
}

function compute_energy_budget(array $profile, array $mods): array
{
    return ['weapon_factor' => 1.0, 'shield_factor' => 1.0];
}

function build_battle_modifier_breakdown(array $mods): array
{
    return [];
}

function battle_reports_has_combat_meta_columns(PDO $db): bool
{
    return false;
}

function battle_reports_has_fleet_id(PDO $db): bool
{
    return true;
}

function check_and_update_achievements(PDO $db, int $userId): void
{
}

function apply_fleet_payload_to_colony(PDO $db, int $colonyId, array $payload): void
{
    $db->prepare('UPDATE colonies SET metal=metal+?, crystal=crystal+?, deuterium=deuterium+? WHERE id=?')
        ->execute([$payload['metal'] ?? 0, $payload['crystal'] ?? 0, $payload['deuterium'] ?? 0, $colonyId]);
}

function mysql_connection(): PDO
{
    $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
    if (!$dsn) {
        throw new RuntimeException('Missing isolated MySQL test DSN.');
    }
    return new PDO(
        $dsn,
        getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
        getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
}

function create_fleet_schema(PDO $db): void
{
    $db->exec(<<<'SQL'
        CREATE TABLE users (
            id INT PRIMARY KEY, control_type VARCHAR(32), pvp_mode TINYINT DEFAULT 1,
            protection_until DATETIME NULL, ftl_drive_type VARCHAR(32) DEFAULT 'aereth',
            ftl_cooldown_until DATETIME NULL
        ) ENGINE=InnoDB;
        CREATE TABLE celestial_bodies (
            id INT PRIMARY KEY, galaxy_index INT, system_index INT, position INT
        ) ENGINE=InnoDB;
        CREATE TABLE colonies (
            id INT PRIMARY KEY, user_id INT NOT NULL, body_id INT NOT NULL,
            metal DECIMAL(20,4), crystal DECIMAL(20,4), deuterium DECIMAL(20,4),
            rare_earth DECIMAL(20,4), food DECIMAL(20,4), happiness INT,
            colony_type VARCHAR(32), CHECK (metal >= 0),
            FOREIGN KEY (user_id) REFERENCES users(id)
        ) ENGINE=InnoDB;
        CREATE TABLE ships (
            colony_id INT, type VARCHAR(64), count INT, PRIMARY KEY (colony_id,type),
            CHECK (count >= 0), FOREIGN KEY (colony_id) REFERENCES colonies(id)
        ) ENGINE=InnoDB;
        CREATE TABLE star_systems (
            galaxy_index INT, system_index INT, x_ly DOUBLE, y_ly DOUBLE, z_ly DOUBLE
        ) ENGINE=InnoDB;
        CREATE TABLE leaders (
            colony_id INT, role VARCHAR(32), autonomy INT, skill_navigation INT
        ) ENGINE=InnoDB;
        CREATE TABLE research (user_id INT, type VARCHAR(64), level INT) ENGINE=InnoDB;
        CREATE TABLE fleets (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, origin_colony_id INT,
            target_galaxy INT, target_system INT, target_position INT, mission VARCHAR(32),
            ships_json JSON, cargo_metal DECIMAL(20,4), cargo_crystal DECIMAL(20,4),
            cargo_deuterium DECIMAL(20,4), cargo_payload JSON NULL,
            origin_x_ly DOUBLE, origin_y_ly DOUBLE, origin_z_ly DOUBLE,
            origin_radius_ly DOUBLE, origin_theta_rad DOUBLE, origin_height_ly DOUBLE,
            target_x_ly DOUBLE, target_y_ly DOUBLE, target_z_ly DOUBLE,
            target_radius_ly DOUBLE, target_theta_rad DOUBLE, target_height_ly DOUBLE,
            speed_ly_h DOUBLE, distance_ly DOUBLE, departure_time DATETIME,
            arrival_time DATETIME, return_time DATETIME, `returning` TINYINT DEFAULT 0,
            stealth_until DATETIME NULL, hull_damage_pct INT DEFAULT 0
        ) ENGINE=InnoDB;
        CREATE TABLE battle_reports (
            id INT AUTO_INCREMENT PRIMARY KEY, attacker_id INT, defender_id INT,
            body_id INT, fleet_id INT, report_json JSON
        ) ENGINE=InnoDB;
        CREATE TABLE messages (
            id INT AUTO_INCREMENT PRIMARY KEY, receiver_id INT, subject VARCHAR(255), body TEXT
        ) ENGINE=InnoDB;
        CREATE TABLE fixture_dirty_users (
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, reason VARCHAR(64)
        ) ENGINE=InnoDB;
        CREATE TABLE fixture_dirty_systems (
            id INT AUTO_INCREMENT PRIMARY KEY, galaxy INT, system_index INT, reason VARCHAR(64)
        ) ENGINE=InnoDB;
        CREATE TABLE npc_factions (id INT PRIMARY KEY, base_diplomacy INT) ENGINE=InnoDB;
        CREATE TABLE npc_faction_memberships (user_id INT, faction_id INT) ENGINE=InnoDB;
        CREATE TABLE diplomacy (
            user_id INT, faction_id INT, standing INT DEFAULT 0, attacks_against INT DEFAULT 0,
            trades_completed INT DEFAULT 0, quests_completed INT DEFAULT 0,
            last_event TEXT, last_event_at DATETIME NULL, PRIMARY KEY (user_id,faction_id)
        ) ENGINE=InnoDB;
        INSERT INTO users (id,control_type) VALUES (10,'human'),(20,'human');
        INSERT INTO celestial_bodies VALUES (1,1,1,1),(2,1,2,1);
        INSERT INTO colonies VALUES
            (1,10,1,1000,1000,1000,0,0,100,'generic'),(2,20,2,1000,1000,1000,0,0,100,'generic');
        INSERT INTO ships VALUES (1,'light_fighter',60),(2,'light_fighter',20);
        INSERT INTO star_systems VALUES (1,1,0,0,0),(1,2,20,0,0);
        INSERT INTO npc_factions VALUES (1,0);
        INSERT INTO npc_faction_memberships VALUES (20,1);
        SQL);
    $migration = file_get_contents(dirname(__DIR__, 2) . '/sql/migrate_fleet_dispatch_receipts_v1.sql');
    if ($migration === false) {
        throw new RuntimeException('Cannot read dispatch receipt migration.');
    }
    $db->exec(str_replace('USE galaxyquest;', '', $migration));
    $encounterMigration = file_get_contents(dirname(__DIR__, 2) . '/sql/migrate_battle_encounters_v1.sql');
    if ($encounterMigration === false) {
        throw new RuntimeException('Cannot read battle encounter migration.');
    }
    $db->exec(str_replace('USE galaxyquest;', '', $encounterMigration));
}

function launch_request(int $count = 40): array
{
    return [
        'origin_colony_id' => 1, 'target_galaxy' => 1, 'target_system' => 2, 'target_position' => 1,
        'mission' => 'attack', 'ships' => ['light_fighter' => $count], 'cargo' => ['metal' => 100],
    ];
}
