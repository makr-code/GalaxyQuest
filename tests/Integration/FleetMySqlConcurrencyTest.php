<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration\FleetMySql;

use DomainException;
use GalaxyQuest\Combat\BattleEncounterService;
use PDO;
use PDOException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class FleetMySqlConcurrencyTest extends TestCase
{
    private ?PDO $db = null;
    private string $database = '';

    protected function setUp(): void
    {
        if (!getenv('GQ_RESOURCE_LEDGER_TEST_DSN')) {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN to run isolated MySQL fleet tests.');
        }
        require_once __DIR__ . '/fleet_mysql_fixture.php';
        load_fleet_functions();
        $this->db = mysql_connection();
        self::assertSame('mysql', $this->db->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_fleet_test_' . bin2hex(random_bytes(8));
        $this->db->exec('CREATE DATABASE `' . $this->database . '`');
        $this->db->exec('USE `' . $this->database . '`');
        create_fleet_schema($this->db);
    }

    protected function tearDown(): void
    {
        if ($this->db !== null) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ($this->database !== '') {
                $this->db->exec('DROP DATABASE `' . $this->database . '`');
            }
        }
        $this->db = null;
    }

    public function testConcurrentLaunchesCannotReserveTheSameShipsTwice(): void
    {
        $results = $this->race('launch');
        self::assertSame('committed', $results[0]['status']);
        self::assertSame(['status' => 'rejected', 'reason' => 'Not enough light_fighter available.'], $results[1]);
        self::assertSame(20, $this->shipCount(1));
        self::assertSame(1, $this->countRows('fleets'));
        self::assertSame('900.0000', $this->db->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
        self::assertSame(1, $this->countRows('fixture_dirty_users'));
    }

    public function testConcurrentDuplicateRequestReturnsOneDurableAcknowledgement(): void
    {
        $results = $this->race('keyed-launch');
        self::assertSame(['committed', 'committed'], array_column($results, 'status'));
        self::assertSame(20, $this->shipCount(1));
        self::assertSame(1, $this->countRows('fleets'));
        self::assertSame(1, $this->countRows('fleet_dispatch_receipts'));
        self::assertSame(1, $this->countRows('fixture_dirty_users'));
        $receipt = $this->db->query('SELECT fleet_id, arrival_time FROM fleet_dispatch_receipts')->fetch();
        $request = launch_request() + ['request_id' => 'fleet-mysql-race-request-1'];
        $result = launch_fleet_dispatch($this->db, 10, $request);
        self::assertSame((int)$receipt['fleet_id'], $result['fleet_id']);
        self::assertSame($receipt['arrival_time'], $result['arrival_time']);
        self::assertSame('900.0000', $this->db->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
    }

    public function testReceiptSurvivesTerminalFleetDeletionAndRejectsChangedPayload(): void
    {
        $request = launch_request() + ['request_id' => 'durable-fleet-request-1'];
        $result = launch_fleet_dispatch($this->db, 10, $request);
        $this->makeDue($result['fleet_id']);
        $this->processDue($result['fleet_id']);
        $this->makeDue($result['fleet_id']);
        $this->processDue($result['fleet_id']);
        self::assertSame(0, $this->countRows('fleets'));
        $before = $this->snapshot();
        self::assertSame($result, launch_fleet_dispatch($this->db, 10, $request));
        self::assertSame($before, $this->snapshot());
        $request['cargo']['metal'] = 101;
        try {
            launch_fleet_dispatch($this->db, 10, $request);
            self::fail('A used request ID must reject a different payload.');
        } catch (\DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        self::assertSame($before, $this->snapshot());
    }

    public function testNontransactionalReceiptTableRejectsKeyedDispatchWithoutBooking(): void
    {
        $this->db->exec('ALTER TABLE fleet_dispatch_receipts DROP FOREIGN KEY fk_dispatch_receipt_user');
        $this->db->exec('ALTER TABLE fleet_dispatch_receipts ENGINE=MyISAM');
        $before = $this->snapshot();
        try {
            launch_fleet_dispatch($this->db, 10, launch_request() + ['request_id' => 'engine-guard-request-1']);
            self::fail('Receipt storage must be transactional.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('InnoDB migration', $error->getMessage());
        }
        self::assertSame($before, $this->snapshot());
    }

    public function testEmpireCooldownSerializesEvenWhenBothFleetsHaveEnoughShips(): void
    {
        $this->db->exec("UPDATE users SET ftl_drive_type='vor_tak' WHERE id=10");
        $results = $this->race('cooldown');
        self::assertSame('committed', $results[0]['status']);
        self::assertSame('rejected', $results[1]['status']);
        self::assertStringStartsWith('K-F Drive recharging.', $results[1]['reason']);
        self::assertSame(50, $this->shipCount(1));
        self::assertSame(1, $this->countRows('fleets'));
        self::assertSame('900.0000', $this->db->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
        self::assertGreaterThan(
            time(),
            strtotime($this->db->query('SELECT ftl_cooldown_until FROM users WHERE id=10')->fetchColumn())
        );
    }

    #[DataProvider('abortedMutations')]
    public function testAbortedWorkerRollsBackUncommittedMutationAndAllowsRetry(string $scenario): void
    {
        $fleetId = 0;
        if ($scenario === 'arrival') {
            $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
            $this->makeDue($fleetId);
        }
        $before = $this->snapshot();
        $worker = $this->startWorker($scenario, $fleetId, true);
        try {
            self::assertSame('READY', $this->readLine($worker['pipes'][1]));
            fwrite($worker['pipes'][0], "GO\n");
            fflush($worker['pipes'][0]);
            self::assertStringStartsWith('STARTING:', $this->readLine($worker['pipes'][1]));
            self::assertSame('LOCKED', $this->readLine($worker['pipes'][1]));
            // No dirty-read of the uncommitted ships, cargo, fleet or publication.
            self::assertSame($before, $this->snapshot());
            fwrite($worker['pipes'][0], "ABORT\n");
            fflush($worker['pipes'][0]);
            fclose($worker['pipes'][0]);
            $stderr = stream_get_contents($worker['pipes'][2]);
            fclose($worker['pipes'][1]);
            fclose($worker['pipes'][2]);
            $exitCode = proc_close($worker['process']);
            $worker['closed'] = true;
            self::assertSame(17, $exitCode, $stderr);
            self::assertSame($before, $this->snapshot());
            if ($scenario === 'arrival') {
                $this->processDue($fleetId);
                self::assertSame(1, $this->countRows('battle_encounters'));
                self::assertSame(2, $this->countRows('battle_encounter_events'));
                self::assertSame(1, $this->countRows('battle_reports'));
            } else {
                launch_fleet_dispatch($this->db, 10, launch_request() + ['request_id' => 'fleet-mysql-race-request-1']);
                self::assertSame(1, $this->countRows('fleet_dispatch_receipts'));
            }
            self::assertSame(1, $this->countRows('fleets'));
            self::assertSame(20, $this->shipCount(1));
        } finally {
            $this->closeWorkers([$worker]);
        }
    }

    public static function abortedMutations(): array
    {
        return [['keyed-launch'], ['arrival']];
    }

    public function testRealLossesAreChargedOnceWhenArrivalAndReturnAreRetried(): void
    {
        $this->db->exec('UPDATE ships SET count=1000 WHERE colony_id=2');
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->processDue($fleetId);
        $report = json_decode($this->db->query('SELECT report_json FROM battle_reports')->fetchColumn(), true);
        self::assertGreaterThan(0, $report['attacker_lost']['light_fighter']);
        self::assertSame(20, $this->shipCount(1));
        self::assertSame(1000 - $report['defender_lost']['light_fighter'], $this->shipCount(2));
        $resolved = $this->snapshot();
        $this->processDue($fleetId);
        self::assertSame($resolved, $this->snapshot());
        $this->makeDue($fleetId);
        $this->processDue($fleetId);
        $returned = $this->snapshot();
        $this->processDue($fleetId);
        self::assertSame($returned, $this->snapshot());
        self::assertSame(60, $this->shipCount(1) + $report['attacker_lost']['light_fighter']);
    }

    #[DataProvider('actorPairs')]
    public function testDuplicateBattleArrivalAndReturnHaveOneEffectForEveryActorPair(
        string $attacker,
        string $defender,
        int $defenderShips
    ): void {
        $this->db->prepare('UPDATE users SET control_type=? WHERE id=10')->execute([$attacker]);
        $this->db->prepare('UPDATE users SET control_type=? WHERE id=20')->execute([$defender]);
        $this->db->prepare('UPDATE ships SET count=? WHERE colony_id=2')->execute([$defenderShips]);
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $results = $this->race('arrival', $fleetId);
        self::assertSame(['committed', 'committed'], array_column($results, 'status'));
        self::assertSame(1, $this->countRows('battle_reports'));
        self::assertSame(2, $this->countRows('messages'));
        $report = json_decode($this->db->query('SELECT report_json FROM battle_reports')->fetchColumn(), true);
        self::assertSame(1, $this->countRows('battle_encounters'));
        self::assertSame(2, $this->countRows('battle_encounter_participants'));
        self::assertSame(2, $this->countRows('battle_encounter_events'));
        $encounterId = (int)$this->db->query('SELECT id FROM battle_encounters')->fetchColumn();
        $encounters = new BattleEncounterService($this->db);
        $journal = $encounters->read(10, $encounterId);
        self::assertSame($journal, $encounters->read(20, $encounterId));
        self::assertSame($journal, $encounters->readByReport(10, $journal['battle_report_id']));
        try {
            $encounters->readByReport(9999, $journal['battle_report_id']);
            self::fail('A non-participant must not read an encounter by report ID.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        self::assertSame('legacy-v1', $journal['rule_version']);
        self::assertSame('resolved', $journal['status']);
        self::assertSame(2, $journal['revision']);
        self::assertSame($fleetId, $journal['source_fleet_id']);
        self::assertSame($report['seed'], $journal['seed']);
        self::assertEquals($report, $journal['outcome']);
        self::assertSame([1, 2], array_column($journal['events'], 'sequence'));
        self::assertSame(['encounter_created', 'encounter_resolved'], array_column($journal['events'], 'event_type'));
        self::assertSame([$attacker, $defender], array_column($journal['participants'], 'controller_kind'));
        self::assertSame(
            [$report['attacker_ships'], $report['defender_ships']],
            array_column($journal['participants'], 'initial_ships')
        );
        self::assertSame(1, $report['version']);
        self::assertSame($defenderShips === 0, $report['attacker_wins']);
        self::assertSame(20, $this->shipCount(1));
        self::assertSame($defenderShips - $report['defender_lost']['light_fighter'], $this->shipCount(2));
        $fleet = $this->db->query('SELECT * FROM fleets')->fetch();
        self::assertSame(1, (int)$fleet['returning']);
        self::assertSame($report['attacker_survivors'], json_decode($fleet['ships_json'], true));
        if ($defender === 'npc_engine') {
            $diplomacy = $this->db->query('SELECT standing, attacks_against FROM diplomacy WHERE user_id=10')->fetch();
            self::assertSame(-5, (int)$diplomacy['standing']);
            self::assertSame(1, (int)$diplomacy['attacks_against']);
        } else {
            self::assertSame(0, $this->countRows('diplomacy'));
        }
        $this->makeDue($fleetId);
        $results = $this->race('arrival', $fleetId);
        self::assertSame(['committed', 'committed'], array_column($results, 'status'));
        self::assertSame(0, $this->countRows('fleets'));
        self::assertSame(60, $this->shipCount(1) + $report['attacker_lost']['light_fighter']);
        self::assertSame(
            900.0 + (float)$fleet['cargo_metal'],
            (float)$this->db->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn()
        );
        self::assertSame(1, $this->countRows('battle_reports'));
        self::assertSame(2, $this->countRows('messages'));
        self::assertSame(4, $this->countRows('fixture_dirty_users'));
        self::assertSame($journal, $encounters->read(10, $encounterId));
        self::assertSame(1, $this->countRows('fixture_dirty_systems'));
        if ($defender === 'npc_engine') {
            self::assertSame(1, (int)$this->db->query('SELECT attacks_against FROM diplomacy')->fetchColumn());
        }
    }

    public static function actorPairs(): array
    {
        $cases = [];
        foreach (['human', 'npc_engine'] as $attacker) {
            foreach (['human', 'npc_engine'] as $defender) {
                foreach ([0, 20] as $ships) {
                    $cases[] = [$attacker, $defender, $ships];
                }
            }
        }
        return $cases;
    }

    #[DataProvider('launchFailures')]
    public function testFailedLaunchCanRetryWithoutPartialDebitsOrCooldown(string $table): void
    {
        $this->db->exec("UPDATE users SET ftl_drive_type='vor_tak' WHERE id=10");
        $before = $this->snapshot();
        $this->rejectInsert($table);
        try {
            launch_fleet_dispatch($this->db, 10, launch_request() + ['request_id' => 'failed-fleet-request-1']);
            self::fail('Injected write failure must propagate.');
        } catch (PDOException $error) {
            self::assertStringContainsString('injected fleet failure', $error->getMessage());
        }
        self::assertSame($before, $this->snapshot());
        self::assertFalse($this->db->inTransaction());
        $this->db->exec('DROP TRIGGER reject_insert');
        launch_fleet_dispatch($this->db, 10, launch_request() + ['request_id' => 'failed-fleet-request-1']);
        self::assertSame(1, $this->countRows('fleets'));
        self::assertSame(20, $this->shipCount(1));
        self::assertSame(1, $this->countRows('fleet_dispatch_receipts'));
        self::assertSame('900.0000', $this->db->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
    }

    public static function launchFailures(): array
    {
        return [['fleets'], ['fixture_dirty_users'], ['fleet_dispatch_receipts']];
    }

    #[DataProvider('battleFailures')]
    public function testFailedBattleAndReturnCanRetryWithoutDuplicatingTerminalEffects(string $table): void
    {
        $this->db->exec("UPDATE users SET control_type='npc_engine' WHERE id=20;
            UPDATE ships SET count=0 WHERE colony_id=2");
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $before = $this->snapshot();
        $this->rejectInsert($table);
        $this->expectArrivalFailure($fleetId);
        self::assertSame($before, $this->snapshot());
        $this->db->exec('DROP TRIGGER reject_insert');
        $this->processDue($fleetId);
        $battle = $this->snapshot();
        $this->processDue($fleetId);
        self::assertSame($battle, $this->snapshot());
        self::assertSame(1, $this->countRows('battle_reports'));
        self::assertSame(2, $this->countRows('messages'));
        self::assertSame(1, (int)$this->db->query('SELECT attacks_against FROM diplomacy')->fetchColumn());

        $this->makeDue($fleetId);
        $beforeReturn = $this->snapshot();
        $this->rejectInsert('fixture_dirty_users');
        $this->expectArrivalFailure($fleetId);
        self::assertSame($beforeReturn, $this->snapshot());
        $this->db->exec('DROP TRIGGER reject_insert');
        $this->processDue($fleetId);
        $returned = $this->snapshot();
        $this->processDue($fleetId);
        self::assertSame($returned, $this->snapshot());
        self::assertSame(0, $this->countRows('fleets'));
        self::assertSame(60, $this->shipCount(1));
    }

    public static function battleFailures(): array
    {
        return [['battle_reports'], ['messages'], ['fixture_dirty_systems'],
            ['battle_encounters'], ['battle_encounter_participants'], ['battle_encounter_events']];
    }

    public function testEncounterReadIsParticipantOnlyAndDoesNotProcessDueReturn(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->processDue($fleetId);
        $this->makeDue($fleetId);
        $id = (int)$this->db->query('SELECT id FROM battle_encounters')->fetchColumn();
        $before = $this->snapshot();
        $service = new BattleEncounterService($this->db);
        self::assertSame($id, $service->read(10, $id)['id']);
        foreach ([$id, $id + 1] as $requested) {
            try {
                $service->read(999, $requested);
                self::fail('Other users must not read encounter data.');
            } catch (\DomainException $error) {
                self::assertSame(404, $error->getCode());
                self::assertSame('Battle encounter not found.', $error->getMessage());
            }
        }
        self::assertSame($before, $this->snapshot());
        self::assertFalse($this->db->inTransaction());
    }

    public function testFinalEncounterEventFailureRollsBackAllBattleEffects(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $before = $this->snapshot();
        $this->db->exec("CREATE TRIGGER reject_insert BEFORE INSERT ON battle_encounter_events FOR EACH ROW
            BEGIN IF NEW.sequence=2 THEN SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT='injected fleet failure'; END IF; END");
        $this->expectArrivalFailure($fleetId);
        self::assertSame($before, $this->snapshot());
        $this->db->exec('DROP TRIGGER reject_insert');
        $this->processDue($fleetId);
        self::assertSame(1, $this->countRows('battle_encounters'));
        self::assertSame(2, $this->countRows('battle_encounter_events'));
    }

    public function testEncounterStorageGuardRejectsNontransactionalEvents(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->db->exec('ALTER TABLE battle_encounter_events DROP FOREIGN KEY fk_encounter_event');
        $this->db->exec('ALTER TABLE battle_encounter_events ENGINE=MyISAM');
        $before = $this->snapshot();
        try {
            $this->processDue($fleetId);
            self::fail('Nontransactional journal must not resolve combat.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('InnoDB', $error->getMessage());
        }
        self::assertSame($before, $this->snapshot());
    }

    public function testMissingEncounterMigrationRejectsBattleWithoutEffects(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->db->exec('RENAME TABLE battle_encounter_events TO hidden_events');
        try {
            $this->processDue($fleetId);
            self::fail('Missing migration must not resolve combat.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('InnoDB', $error->getMessage());
        } finally {
            $this->db->exec('RENAME TABLE hidden_events TO battle_encounter_events');
        }
        self::assertSame(0, $this->countRows('battle_reports'));
        self::assertSame(0, $this->countRows('battle_encounters'));
        self::assertSame(0, $this->countRows('messages'));
        self::assertSame(20, $this->shipCount(2));
        self::assertSame(0, (int)$this->db->query('SELECT returning FROM fleets')->fetchColumn());
    }

    public function testTerminalEncounterCannotCompleteTwiceOrResolveResetFleetAgain(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->processDue($fleetId);
        $id = (int)$this->db->query('SELECT id FROM battle_encounters')->fetchColumn();
        $service = new BattleEncounterService($this->db);
        $journal = $service->read(10, $id);
        $before = $this->snapshot();
        $this->db->beginTransaction();
        try {
            $service->complete($id, $journal['battle_report_id'], $journal['outcome']);
            self::fail('Terminal completion must reject replayed effects.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('unresolved revision', $error->getMessage());
        } finally {
            $this->db->rollBack();
        }
        self::assertSame($before, $this->snapshot());
        $this->db->exec('UPDATE fleets SET returning=0');
        $this->makeDue($fleetId);
        $before = $this->snapshot();
        try {
            $this->processDue($fleetId);
            self::fail('Resetting fleet state must not reapply a terminal encounter.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('already exists', $error->getMessage());
        }
        self::assertSame($before, $this->snapshot());
    }

    public function testEmptyAttackTargetReturnsWithoutCreatingEncounter(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->db->exec('UPDATE celestial_bodies SET system_index=3 WHERE id=2');
        $this->makeDue($fleetId);
        $this->processDue($fleetId);
        self::assertSame(0, $this->countRows('battle_encounters'));
        self::assertSame(0, $this->countRows('battle_reports'));
        self::assertSame(1, (int)$this->db->query('SELECT returning FROM fleets')->fetchColumn());
    }

    public function testDistinctAttackFleetsSerializeTheDefenderSnapshot(): void
    {
        $first = launch_fleet_dispatch($this->db, 10, launch_request(10))['fleet_id'];
        $second = launch_fleet_dispatch($this->db, 10, launch_request(10))['fleet_id'];
        $this->makeDue($first);
        $this->makeDue($second);
        $results = $this->race('arrival', $first, $second);
        self::assertSame(['committed', 'committed'], array_column($results, 'status'));
        $reports = $this->db->query('SELECT report_json FROM battle_reports ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
        self::assertCount(2, $reports);
        [$firstReport, $secondReport] = array_map(
            static fn(string $json): array => json_decode($json, true, 512, JSON_THROW_ON_ERROR),
            $reports
        );
        self::assertSame(
            20 - $firstReport['defender_lost']['light_fighter'],
            $secondReport['defender_ships']['light_fighter']
        );
        self::assertSame(
            20 - $firstReport['defender_lost']['light_fighter'] - $secondReport['defender_lost']['light_fighter'],
            $this->shipCount(2)
        );
        self::assertSame(2, $this->countRows('battle_encounters'));
        self::assertSame(4, $this->countRows('battle_encounter_events'));
    }

    public function testEncounterMutationRequiresAnActiveTransaction(): void
    {
        $before = $this->snapshot();
        try {
            (new BattleEncounterService($this->db))->complete(1, 1, []);
            self::fail('Journal writes without arrival transaction must fail.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('arrival transaction', $error->getMessage());
        }
        self::assertSame($before, $this->snapshot());
    }

    public function testEncounterOutcomeSurvivesLegacyReportCleanup(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->processDue($fleetId);
        $id = (int)$this->db->query('SELECT id FROM battle_encounters')->fetchColumn();
        $service = new BattleEncounterService($this->db);
        $journal = $service->read(10, $id);
        self::assertSame(1, $journal['schema_version']);
        $this->db->exec('DELETE FROM battle_reports');
        self::assertSame($journal, $service->read(20, $id));
        self::assertSame(1, $this->countRows('battle_encounters'));
        self::assertSame(2, $this->countRows('battle_encounter_events'));
    }

    public function testUnsupportedControllerIdentityRollsBackBattle(): void
    {
        $fleetId = launch_fleet_dispatch($this->db, 10, launch_request())['fleet_id'];
        $this->makeDue($fleetId);
        $this->db->exec("UPDATE users SET control_type='unsupported' WHERE id=20");
        $before = $this->snapshot();
        try {
            $this->processDue($fleetId);
            self::fail('A controller must not silently become a human or NPC.');
        } catch (\RuntimeException $error) {
            self::assertStringContainsString('supported server controller', $error->getMessage());
        }
        self::assertSame($before, $this->snapshot());
    }

    private function rejectInsert(string $table): void
    {
        $this->db->exec("CREATE TRIGGER reject_insert BEFORE INSERT ON $table FOR EACH ROW
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected fleet failure'");
    }

    private function expectArrivalFailure(int $fleetId): void
    {
        try {
            $this->processDue($fleetId);
            self::fail('Injected arrival failure must propagate.');
        } catch (PDOException $error) {
            self::assertStringContainsString('injected fleet failure', $error->getMessage());
        }
        self::assertFalse($this->db->inTransaction());
    }

    private function processDue(int $fleetId): void
    {
        $this->db->beginTransaction();
        try {
            process_fleet_arrival_locked($this->db, $fleetId);
            $this->db->commit();
        } catch (\Throwable $error) {
            $this->db->rollBack();
            throw $error;
        }
    }

    private function makeDue(int $fleetId): void
    {
        $this->db->prepare('UPDATE fleets SET departure_time=DATE_SUB(NOW(), INTERVAL 1 HOUR),
            arrival_time=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id=?')->execute([$fleetId]);
    }

    private function shipCount(int $colonyId): int
    {
        $query = $this->db->prepare("SELECT count FROM ships WHERE colony_id=? AND type='light_fighter'");
        $query->execute([$colonyId]);
        return (int)$query->fetchColumn();
    }

    private function countRows(string $table): int
    {
        return (int)$this->db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
    }

    private function snapshot(): array
    {
        $state = [];
        foreach (
            ['users', 'colonies', 'ships', 'fleets', 'battle_reports', 'messages',
            'diplomacy', 'fixture_dirty_users', 'fixture_dirty_systems', 'fleet_dispatch_receipts',
            'battle_encounters', 'battle_encounter_participants', 'battle_encounter_events'] as $table
        ) {
            $state[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY 1,2')->fetchAll();
        }
        return $state;
    }

    private function race(string $scenario, int $fleetId = 0, int $secondFleetId = 0): array
    {
        $workers = [];
        try {
            $workers[] = $this->startWorker($scenario, $fleetId, true);
            $workers[] = $this->startWorker($scenario, $secondFleetId ?: $fleetId, false);
            foreach ($workers as $worker) {
                self::assertSame('READY', $this->readLine($worker['pipes'][1]));
            }
            fwrite($workers[0]['pipes'][0], "GO\n");
            fflush($workers[0]['pipes'][0]);
            self::assertStringStartsWith('STARTING:', $this->readLine($workers[0]['pipes'][1]));
            self::assertSame('LOCKED', $this->readLine($workers[0]['pipes'][1]));
            fwrite($workers[1]['pipes'][0], "GO\n");
            fflush($workers[1]['pipes'][0]);
            $starting = $this->readLine($workers[1]['pipes'][1]);
            self::assertStringStartsWith('STARTING:', $starting);
            $this->assertLockWait((int)substr($starting, strlen('STARTING:')));
            fwrite($workers[0]['pipes'][0], "COMMIT\n");
            fflush($workers[0]['pipes'][0]);
            $results = [];
            foreach ($workers as $worker) {
                $results[] = json_decode($this->readLine($worker['pipes'][1]), true, flags: JSON_THROW_ON_ERROR);
            }
            foreach ($workers as &$worker) {
                fclose($worker['pipes'][0]);
                $stderr = stream_get_contents($worker['pipes'][2]);
                fclose($worker['pipes'][1]);
                fclose($worker['pipes'][2]);
                $exitCode = proc_close($worker['process']);
                $worker['closed'] = true;
                self::assertSame(0, $exitCode, $stderr);
            }
            unset($worker);
            return $results;
        } finally {
            $this->closeWorkers($workers);
        }
    }

    private function closeWorkers(array $workers): void
    {
        foreach ($workers as $worker) {
            if ($worker['closed'] ?? false) {
                continue;
            }
            foreach ($worker['pipes'] as $pipe) {
                if (is_resource($pipe)) {
                    fclose($pipe);
                }
            }
            if (is_resource($worker['process'])) {
                if (proc_get_status($worker['process'])['running']) {
                    proc_terminate($worker['process']);
                }
                proc_close($worker['process']);
            }
        }
    }

    private function startWorker(string $scenario, int $fleetId, bool $hold): array
    {
        $process = proc_open(
            [PHP_BINARY, '-d', 'xdebug.mode=off', __DIR__ . '/fleet_mysql_worker.php'],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
            $pipes,
            dirname(__DIR__, 2),
            array_merge((array)getenv(), [
                'GQ_FLEET_TEST_DATABASE' => $this->database, 'GQ_FLEET_TEST_SCENARIO' => $scenario,
                'GQ_FLEET_TEST_FLEET_ID' => (string)$fleetId, 'GQ_FLEET_TEST_HOLD' => $hold ? '1' : '0',
            ])
        );
        self::assertIsResource($process);
        return ['process' => $process, 'pipes' => $pipes];
    }

    /** @param resource $stream */
    private function readLine($stream): string
    {
        $read = [$stream];
        $write = null;
        $except = null;
        self::assertSame(1, stream_select($read, $write, $except, 15), 'Timed out waiting for fleet worker.');
        $line = fgets($stream);
        self::assertIsString($line);
        return trim($line);
    }

    private function assertLockWait(int $connectionId): void
    {
        $query = $this->db->prepare(
            'SELECT COUNT(*) FROM performance_schema.data_lock_waits waits
             JOIN performance_schema.threads thread ON thread.THREAD_ID=waits.REQUESTING_THREAD_ID
             WHERE thread.PROCESSLIST_ID=?'
        );
        $deadline = hrtime(true) + 5_000_000_000;
        do {
            $query->execute([$connectionId]);
            if ((int)$query->fetchColumn() > 0) {
                self::assertTrue(true);
                return;
            }
            usleep(10_000);
        } while (hrtime(true) < $deadline);
        self::fail('Competing fleet worker did not wait on an InnoDB lock.');
    }
}
