<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit\Combat;

use DomainException;
use GalaxyQuest\Combat\BattleEncounterService;
use PDO;
use PHPUnit\Framework\TestCase;

final class BattleEncounterServiceReadTest extends TestCase
{
    public function testReadByReportReturnsServerOutcomeForParticipants(): void
    {
        $service = new BattleEncounterService($this->createEncounterDatabase());

        $encounter = $service->readByReport(10, 42);

        self::assertSame(9, $encounter['id']);
        self::assertSame(42, $encounter['battle_report_id']);
        self::assertSame(['attacker_wins' => true], $encounter['outcome']);
        self::assertSame([10, 20], array_column($encounter['participants'], 'user_id'));
        self::assertSame('encounter_resolved', $encounter['events'][1]['event_type']);
    }

    public function testReadByReportUsesSameNotFoundResponseForNonParticipantsAndUnknownReports(): void
    {
        $service = new BattleEncounterService($this->createEncounterDatabase());

        foreach ([[30, 42], [10, 999]] as [$userId, $reportId]) {
            try {
                $service->readByReport($userId, $reportId);
                self::fail('An unavailable encounter must not be readable.');
            } catch (DomainException $error) {
                self::assertSame(404, $error->getCode());
                self::assertSame('Battle encounter not found.', $error->getMessage());
            }
        }
    }

    private function createEncounterDatabase(): PDO
    {
        $db = new PDO('sqlite::memory:');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec(
            "CREATE TABLE battle_encounters (
                id INTEGER PRIMARY KEY, source_fleet_id INTEGER, target_colony_id INTEGER,
                target_body_id INTEGER, rule_version TEXT, seed TEXT, status TEXT, revision INTEGER,
                battle_report_id INTEGER, outcome_json TEXT, created_at TEXT, resolved_at TEXT
            )"
        );
        $db->exec(
            "CREATE TABLE battle_encounter_participants (
                encounter_id INTEGER, side TEXT, user_id INTEGER, controller_kind TEXT,
                initial_ships_json TEXT, PRIMARY KEY (encounter_id, side)
            )"
        );
        $db->exec(
            "CREATE TABLE battle_encounter_events (
                encounter_id INTEGER, sequence INTEGER, event_type TEXT, payload_json TEXT,
                created_at TEXT, PRIMARY KEY (encounter_id, sequence)
            )"
        );
        $db->exec(
            "INSERT INTO battle_encounters VALUES
                (9, 4, 22, 33, 'legacy-v1', 'seed', 'resolved', 2, 42,
                 '{\"attacker_wins\":true}', '2026-11-08', '2026-11-08')"
        );
        $db->exec(
            "INSERT INTO battle_encounter_participants VALUES
                (9, 'attacker', 10, 'human', '{\"fighter\":2}'),
                (9, 'defender', 20, 'npc_engine', '{\"fighter\":1}')"
        );
        $db->exec(
            "INSERT INTO battle_encounter_events VALUES
                (9, 1, 'encounter_created', '{}', '2026-11-08'),
                (9, 2, 'encounter_resolved', '{}', '2026-11-08')"
        );
        return $db;
    }
}
