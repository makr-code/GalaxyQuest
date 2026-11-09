<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Integration;

use DomainException;
use GalaxyQuest\Combat\LiveBattleRules;
use GalaxyQuest\Combat\ShipWreckStore;
use PDO;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class ShipWreckStoreMySqlTest extends TestCase
{
    private ?PDO $db = null;
    private string $database = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_RESOURCE_LEDGER_TEST_DSN');
        if (!$dsn) {
            self::markTestSkipped('Set GQ_RESOURCE_LEDGER_TEST_DSN for isolated MySQL wreck tests.');
        }
        $this->db = new PDO(
            $dsn,
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        self::assertSame('mysql', $this->db->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_wreck_test_' . bin2hex(random_bytes(8));
        $this->db->exec('CREATE DATABASE `' . $this->database . '`');
        $this->db->exec('USE `' . $this->database . '`');
        foreach (['migrate_battle_encounters_v1.sql', 'migrate_ship_wreck_fields_v1.sql'] as $filename) {
            $sql = file_get_contents(__DIR__ . '/../../sql/' . $filename);
            if ($sql === false) {
                throw new RuntimeException('Cannot read migration: ' . $filename);
            }
            $sql = preg_replace('/^USE galaxyquest;\s*$/m', '', $sql);
            if ($sql === null) {
                throw new RuntimeException('Cannot prepare migration: ' . $filename);
            }
            $this->db->exec($sql);
            if ($filename === 'migrate_ship_wreck_fields_v1.sql') {
                $this->db->exec($sql);
            }
        }
        $this->db->prepare(
            "INSERT INTO battle_encounters
             (id,source_fleet_id,target_colony_id,target_body_id,rule_version,seed,status,revision)
             VALUES (21,1,1,1,?,?,'resolving',1)"
        )->execute([LiveBattleRules::RULE_VERSION, str_repeat('a', 64)]);
        $this->db->exec(
            "INSERT INTO battle_encounter_participants (encounter_id,side,user_id,controller_kind,initial_ships_json)
             VALUES (21,'attacker',10,'human','{}'),(21,'defender',20,'npc_engine','{}')"
        );
        $this->db->prepare(
            "INSERT INTO battle_encounter_events (encounter_id,sequence,event_type,payload_json)
             VALUES (21,3,'ship_group_loss',?)"
        )->execute([json_encode([
            'tick' => 3, 'target_side' => 'defender', 'target_group' => 'fighter', 'ships_lost' => 2,
        ], JSON_THROW_ON_ERROR)]);
    }

    protected function tearDown(): void
    {
        if ($this->db !== null && $this->database !== '') {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            $this->db->exec('DROP DATABASE `' . $this->database . '`');
        }
        $this->db = null;
    }

    public function testRepeatableSourceAndParticipantOnlyRead(): void
    {
        $store = new ShipWreckStore($this->db);
        $contents = [
            ['category' => 'resource', 'item_id' => 'metal', 'quantity' => 10],
            ['category' => 'weapon', 'item_id' => 'laser', 'quantity' => 1],
        ];
        $this->db->beginTransaction();
        $manifest = $store->record(21, 3, $contents);
        self::assertSame($manifest, $store->record(21, 3, array_reverse($contents)));
        try {
            $store->record(21, 3, [['category' => 'resource', 'item_id' => 'metal', 'quantity' => 11]]);
            self::fail('Conflicting retry must be rejected.');
        } catch (DomainException $error) {
            self::assertSame(409, $error->getCode());
        }
        $this->db->commit();
        self::assertEquals($manifest, $store->readForParticipant(10, 21, 3));
        self::assertEquals($manifest, $store->readForParticipant(20, 21, 3));
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM ship_wreck_fields')->fetchColumn());
        foreach ([[99, 21, 3], [10, 21, 9]] as [$user, $encounter, $sequence]) {
            try {
                $store->readForParticipant($user, $encounter, $sequence);
                self::fail('Nonparticipant or missing source must be rejected.');
            } catch (DomainException $error) {
                self::assertSame(404, $error->getCode());
                self::assertSame('Wreck field not found.', $error->getMessage());
            }
        }
    }

    public function testCallerRollbackRemovesEventAndWreckTogether(): void
    {
        $store = new ShipWreckStore($this->db);
        $this->db->beginTransaction();
        $this->db->prepare(
            "INSERT INTO battle_encounter_events (encounter_id,sequence,event_type,payload_json)
             VALUES (21,4,'ship_group_loss',?)"
        )->execute([json_encode([
            'tick' => 4, 'target_side' => 'attacker', 'target_group' => 'cruiser', 'ships_lost' => 1,
        ], JSON_THROW_ON_ERROR)]);
        $store->record(21, 4, []);
        $this->db->rollBack();
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ship_wreck_fields')->fetchColumn());
        self::assertSame(
            0,
            (int)$this->db->query('SELECT COUNT(*) FROM battle_encounter_events WHERE sequence=4')->fetchColumn()
        );
    }

    public function testRequiresTransactionAndRejectsLegacyAndNonLossEvents(): void
    {
        $store = new ShipWreckStore($this->db);
        try {
            $store->record(21, 3, []);
            self::fail('A transaction is mandatory.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('transaction', $error->getMessage());
        }
        $this->db->beginTransaction();
        $this->db->exec("UPDATE battle_encounter_events SET event_type='encounter_resolved' WHERE encounter_id=21");
        try {
            $store->record(21, 3, []);
            self::fail('Non-loss events cannot create wrecks.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        $this->db->exec("UPDATE battle_encounters SET rule_version='legacy-v1' WHERE id=21");
        try {
            $store->record(21, 3, []);
            self::fail('Legacy encounters cannot create live wrecks.');
        } catch (DomainException $error) {
            self::assertSame(404, $error->getCode());
        }
        $this->db->rollBack();
        self::assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ship_wreck_fields')->fetchColumn());
    }

    public function testConcurrentWriterWaitsAndCanRetryAfterCommit(): void
    {
        $other = new PDO(
            (string)getenv('GQ_RESOURCE_LEDGER_TEST_DSN'),
            getenv('GQ_RESOURCE_LEDGER_TEST_USER') ?: 'root',
            getenv('GQ_RESOURCE_LEDGER_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $other->exec('USE `' . $this->database . '`');
        $other->exec('SET SESSION innodb_lock_wait_timeout=1');
        $contents = [['category' => 'resource', 'item_id' => 'metal', 'quantity' => 10]];
        $this->db->beginTransaction();
        $manifest = (new ShipWreckStore($this->db))->record(21, 3, $contents);
        $other->beginTransaction();
        try {
            (new ShipWreckStore($other))->record(21, 3, $contents);
            self::fail('Concurrent writer must wait for the encounter lock.');
        } catch (\PDOException $error) {
            self::assertSame(1205, $error->errorInfo[1]);
        } finally {
            $other->rollBack();
        }
        $this->db->commit();
        $other->beginTransaction();
        self::assertSame($manifest, (new ShipWreckStore($other))->record(21, 3, $contents));
        $other->commit();
        self::assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM ship_wreck_fields')->fetchColumn());
    }

    public function testRejectsNonTransactionalStorage(): void
    {
        $this->db->exec('ALTER TABLE ship_wreck_fields DROP FOREIGN KEY fk_ship_wreck_loss_event');
        $this->db->exec('ALTER TABLE ship_wreck_fields ENGINE=MyISAM');
        $this->db->beginTransaction();
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('InnoDB');
        (new ShipWreckStore($this->db))->record(21, 3, []);
    }
}
