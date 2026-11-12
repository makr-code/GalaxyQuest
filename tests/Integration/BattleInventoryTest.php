<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\BattleInventory;

use GalaxyQuest\Combat\BattleResolver;
use PDO;
use PDOException;
use PDOStatement;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

// Isolate the real API functions from authentication and unrelated infrastructure.
function leaders_attack_skill_column(PDO $db): ?string
{
    return null;
}

function complete_ship_build_queue(PDO $db, int $colonyId): void
{
}

function compute_energy_combat_profile(array $ships, PDO $db): array
{
    $count = array_sum($ships);
    return ['attack_energy' => $count * 100.0, 'attack_kinetic' => $count * 50.0,
        'hull' => $count * 300.0, 'shield' => $count * 10.0];
}

function load_combat_modifier_totals(PDO $db, int $attacker, int $defender): array
{
    return ['attacker' => [], 'defender' => []];
}

function combat_modifier_scalar(array $mods, string $prefix): float
{
    return 1.0;
}

function compute_energy_budget(array $profile, array $mods): array
{
    return ['weapon_factor' => 1.0, 'shield_factor' => 1.0];
}

function ship_cargo(string $type): int
{
    return 100;
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
    return false;
}

final class BattleEncounterService
{
    public function __construct(PDO $db)
    {
    }

    public function begin(
        array $fleet,
        array $target,
        array $attackerShips,
        array $defenderShips,
        string $seed
    ): ?int {
        return null;
    }

    public function complete(int $id, int $reportId, array $report): void
    {
    }
}

function check_and_update_achievements(PDO $db, int $userId): void
{
}

function enqueue_dirty_user(PDO $db, int $userId, string $reason): void
{
}

function enqueue_dirty_system(PDO $db, int $galaxy, int $system, string $reason): void
{
}

function decode_fleet_cargo_payload(array $fleet): array
{
    return ['metal' => 0, 'crystal' => 0, 'deuterium' => 0];
}

function apply_fleet_payload_to_colony(PDO $db, int $colonyId, array $payload): void
{
}

final class BattleInventoryTest extends TestCase
{
    public static function setUpBeforeClass(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        foreach (
            ['resolve_battle', 'return_fleet_to_origin', 'battle_preview_outcome',
            'battle_rng_float', 'build_battle_rounds_summary', 'compute_relative_impact'] as $name
        ) {
            $start = strpos($source, 'function ' . $name . '(');
            self::assertNotFalse($start);
            $end = strpos($source, "\nfunction ", $start + 1);
            self::assertNotFalse($end);
            eval('namespace ' . __NAMESPACE__ . '; use PDO; use GalaxyQuest\\Combat\\BattleResolver; '
                . substr($source, $start, $end - $start));
        }
    }

    private function database(int $defenderCount = 100, string $attackerControl = 'human'): PDO
    {
        $db = new class ('sqlite::memory:') extends PDO {
            public function prepare(string $query, array $options = []): PDOStatement|false
            {
                // Adapt MySQL syntax only; mutations still execute against the test database.
                $query = str_replace(
                    'ON DUPLICATE KEY UPDATE count=count+?',
                    'ON CONFLICT(colony_id,type) DO UPDATE SET count=count+?',
                    $query
                );
                $query = str_ireplace(' FOR UPDATE', '', $query);
                return parent::prepare($query, $options);
            }
        };
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->sqliteCreateFunction('GREATEST', static fn($a, $b) => max($a, $b), 2);
        $db->exec('CREATE TABLE colonies (id INTEGER PRIMARY KEY, body_id INTEGER, user_id INTEGER,
            metal REAL, crystal REAL, deuterium REAL, rare_earth REAL, happiness REAL, colony_type TEXT);
            CREATE TABLE celestial_bodies (id INTEGER PRIMARY KEY, galaxy_index INTEGER,
                system_index INTEGER, position INTEGER);
            CREATE TABLE research (user_id INTEGER, type TEXT, level INTEGER);
            CREATE TABLE ships (colony_id INTEGER, type TEXT, count INTEGER, UNIQUE(colony_id, type));
            CREATE TABLE users (id INTEGER PRIMARY KEY, control_type TEXT);
            CREATE TABLE battle_reports (id INTEGER PRIMARY KEY, attacker_id INTEGER,
                defender_id INTEGER, body_id INTEGER, report_json TEXT);
            CREATE TABLE messages (receiver_id INTEGER, subject TEXT, body TEXT);
            CREATE TABLE fleets (id INTEGER PRIMARY KEY, user_id INTEGER, origin_colony_id INTEGER,
                target_galaxy INTEGER, target_system INTEGER, target_position INTEGER,
                departure_time TEXT, arrival_time TEXT, return_time TEXT, "returning" INTEGER,
                ships_json TEXT, cargo_metal REAL, cargo_crystal REAL, cargo_deuterium REAL);
            INSERT INTO celestial_bodies VALUES (1,1,1,1),(2,1,1,2);
            INSERT INTO colonies VALUES (1,1,10,0,0,0,0,100,"generic"),
                (2,2,20,0,0,0,0,100,"generic");
            INSERT INTO users VALUES (10,"human"),(20,"human");
            INSERT INTO ships VALUES (1,"fighter",100),(2,"fighter",100);
            INSERT INTO fleets VALUES (7,10,1,1,1,2,"2026-11-07 00:00:00",
                "2026-11-07 01:00:00",NULL,0,\'{"fighter":40}\',0,0,0)');
        // Model the real launch debit before combat begins.
        $db->exec('UPDATE ships SET count = count - 40 WHERE colony_id = 1');
        $db->prepare('UPDATE ships SET count = ? WHERE colony_id = 2')->execute([$defenderCount]);
        $db->prepare('UPDATE users SET control_type = ? WHERE id = 10')->execute([$attackerControl]);
        return $db;
    }

    #[DataProvider('inventoryCases')]
    public function testActualResolverDebitsOnlyDefendersAndReturnsOnlyAttackerSurvivors(
        int $defenderCount,
        string $attackerControl
    ): void {
        $db = $this->database($defenderCount, $attackerControl);
        $fleet = $db->query('SELECT * FROM fleets WHERE id = 7')->fetch(PDO::FETCH_ASSOC);
        $db->beginTransaction();
        resolve_battle($db, $fleet, ['fighter' => 40]);
        $db->commit();
        $report = json_decode($db->query('SELECT report_json FROM battle_reports')->fetchColumn(), true);
        self::assertSame(1, $report['version']);
        self::assertSame($defenderCount === 20, $report['attacker_wins']);
        self::assertGreaterThan(0, $report['attacker_lost']['fighter']);
        self::assertSame(60, (int)$db->query('SELECT count FROM ships WHERE colony_id = 1')->fetchColumn());
        self::assertSame(
            $defenderCount - $report['defender_lost']['fighter'],
            (int)$db->query('SELECT count FROM ships WHERE colony_id = 2')->fetchColumn()
        );
        $returning = $db->query('SELECT * FROM fleets WHERE id = 7')->fetch(PDO::FETCH_ASSOC);
        self::assertSame(1, (int)$returning['returning']);
        self::assertSame($report['attacker_survivors'], json_decode($returning['ships_json'], true));
        $db->beginTransaction();
        return_fleet_to_origin($db, $returning, json_decode($returning['ships_json'], true));
        $db->commit();
        $remaining = (int)$db->query('SELECT count FROM ships WHERE colony_id = 1')->fetchColumn();
        self::assertSame(100, $remaining + $report['attacker_lost']['fighter']);
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM fleets')->fetchColumn());
        self::assertSame(1, (int)$db->query('SELECT COUNT(*) FROM battle_reports')->fetchColumn());
    }

    public static function inventoryCases(): array
    {
        return [[20, 'human'], [100, 'human'], [20, 'npc_engine'], [100, 'npc_engine']];
    }

    public function testReportFailureRollsBackLossesAndKeepsTheFleetAvailable(): void
    {
        $db = $this->database();
        $fleet = $db->query('SELECT * FROM fleets WHERE id = 7')->fetch(PDO::FETCH_ASSOC);
        $db->exec("CREATE TRIGGER reject_report BEFORE INSERT ON battle_reports
            BEGIN SELECT RAISE(ABORT, 'test report write failure'); END");
        $db->beginTransaction();
        try {
            resolve_battle($db, $fleet, ['fighter' => 40]);
            self::fail('The injected report failure must propagate.');
        } catch (PDOException $error) {
            $db->rollBack();
            self::assertStringContainsString('test report write failure', $error->getMessage());
        }
        self::assertSame(60, (int)$db->query('SELECT count FROM ships WHERE colony_id = 1')->fetchColumn());
        self::assertSame(100, (int)$db->query('SELECT count FROM ships WHERE colony_id = 2')->fetchColumn());
        self::assertSame($fleet, $db->query('SELECT * FROM fleets WHERE id = 7')->fetch(PDO::FETCH_ASSOC));
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM battle_reports')->fetchColumn());
        self::assertSame(0, (int)$db->query('SELECT COUNT(*) FROM messages')->fetchColumn());
    }
}
