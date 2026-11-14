<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use GalaxyQuest\Economy\OnDemandEconomy;

require_once __DIR__ . '/../../api/npc_ai_decision_queue.php';

final class MigrationRunnerMySqlTest extends TestCase
{
    private ?PDO $admin = null;
    private ?PDO $db = null;
    private string $database = '';
    private string $sqlDir = '';

    protected function setUp(): void
    {
        $dsn = getenv('GQ_MIGRATION_TEST_DSN');
        if ($dsn === false || $dsn === '') {
            $this->markTestSkipped('Set GQ_MIGRATION_TEST_DSN to run isolated MySQL migration tests.');
        }

        $this->admin = new PDO(
            $dsn,
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $this->assertSame('mysql', $this->admin->getAttribute(PDO::ATTR_DRIVER_NAME));
        $this->database = 'gq_migration_test_' . bin2hex(random_bytes(8));
        $this->admin->exec(
            'CREATE DATABASE `' . $this->database . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
        );
        $this->db = $this->admin;
        $this->db->exec('USE `' . $this->database . '`');
        $collation = $this->db->query(
            'SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()'
        )->fetchColumn();
        $this->assertSame('utf8mb4_unicode_ci', $collation);
        $this->sqlDir = __DIR__ . '/.fixtures_' . $this->database;
        mkdir($this->sqlDir, 0700);
        copy(__DIR__ . '/../../sql/schema_migrations.sql', $this->sqlDir . '/schema_migrations.sql');
    }

    protected function tearDown(): void
    {
        if ($this->db !== null && $this->db->inTransaction()) {
            $this->db->rollBack();
        }
        if ($this->admin !== null && $this->database !== '') {
            $this->admin->exec('DROP DATABASE IF EXISTS `' . $this->database . '`');
        }
        $this->db = null;
        $this->admin = null;
        if ($this->sqlDir !== '' && is_dir($this->sqlDir)) {
            foreach (glob($this->sqlDir . '/*') as $file) {
                unlink($file);
            }
            rmdir($this->sqlDir);
        }
    }

    private function buildRunner(string $upSql, string|null $downSql = null): MigrationRunner
    {
        file_put_contents($this->sqlDir . '/migration.sql', $upSql);
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migration.sql'];\n");
        if ($downSql !== null) {
            file_put_contents($this->sqlDir . '/migration_down.sql', $downSql);
        }
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testFleetDispatchReceiptMigrationIsRepeatableAndKeepsTerminalAcknowledgements(): void
    {
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO users VALUES (7)');
        $sql = $this->readSqlForTestDatabase('migrate_fleet_dispatch_receipts_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($sql);
        $this->assertSame('InnoDB', $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fleet_dispatch_receipts'"
        )->fetchColumn());
        $insert = $this->db->prepare(
            'INSERT INTO fleet_dispatch_receipts (user_id,request_id,payload_hash,fleet_id,arrival_time)
             VALUES (7,?,?,123,?)'
        );
        $insert->execute(['request-1234567890', str_repeat('a', 64), '2026-11-07 18:00:00']);
        $insert->execute(['REQUEST-1234567890', str_repeat('b', 64), '2026-11-07 18:00:00']);
        $this->assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
        // No fleet foreign key: completed/deleted fleet IDs remain replayable.
        $this->assertSame(123, (int)$this->db->query('SELECT fleet_id FROM fleet_dispatch_receipts LIMIT 1')->fetchColumn());
        $this->db->exec('DELETE FROM users WHERE id=7');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM fleet_dispatch_receipts')->fetchColumn());
    }

    public function testBattleEncounterMigrationIsRepeatableAndPreservesHistoryWithoutFleet(): void
    {
        $sql = $this->readSqlForTestDatabase('migrate_battle_encounters_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($sql);
        $engines = $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'battle_encounter%'"
        )->fetchAll(PDO::FETCH_COLUMN);
        $this->assertCount(3, $engines);
        $this->assertSame(['InnoDB'], array_values(array_unique($engines)));
        $this->db->prepare(
            "INSERT INTO battle_encounters
             (source_fleet_id,target_colony_id,target_body_id,rule_version,seed,status,revision,
              battle_report_id,outcome_json,resolved_at)
             VALUES (42,1,2,'legacy-v1',?,'resolved',2,7,'{}',NOW())"
        )->execute([str_repeat('a', 64)]);
        $id = (int)$this->db->lastInsertId();
        $this->db->prepare(
            "INSERT INTO battle_encounter_participants
             (encounter_id,side,user_id,controller_kind,initial_ships_json) VALUES (?,'attacker',10,'npc_engine','{}')"
        )->execute([$id]);
        $this->db->prepare(
            "INSERT INTO battle_encounter_events
             (encounter_id,sequence,event_type,payload_json) VALUES (?,2,'encounter_resolved','{}')"
        )->execute([$id]);
        $this->assertSame(42, (int)$this->db->query('SELECT source_fleet_id FROM battle_encounters')->fetchColumn());
        $this->db->exec($sql);
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM battle_encounters')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM battle_encounter_events')->fetchColumn());
        try {
            $this->db->exec(
                "INSERT INTO battle_encounters
                 (source_fleet_id,target_colony_id,target_body_id,rule_version,seed,status,revision)
                 SELECT source_fleet_id,target_colony_id,target_body_id,rule_version,seed,'resolving',1
                 FROM battle_encounters"
            );
            $this->fail('One fleet must not create two encounters.');
        } catch (PDOException $error) {
            $this->assertSame('23000', $error->getCode());
        }
    }

    public function testShipWreckMigrationIsRepeatableAndRequiresAnExistingEvent(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('migrate_battle_encounters_v1.sql'));
        $sql = $this->readSqlForTestDatabase('migrate_ship_wreck_fields_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($sql);
        $this->assertSame('InnoDB', $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ship_wreck_fields'"
        )->fetchColumn());
        try {
            $this->db->exec(
                "INSERT INTO ship_wreck_fields (encounter_id,event_sequence,manifest_json,manifest_sha256)
                 VALUES (42,1,'{}',REPEAT('a',64))"
            );
            $this->fail('A wreck requires a persisted encounter event.');
        } catch (PDOException $error) {
            $this->assertSame('23000', $error->getCode());
        }
    }

    public function testLiveBattleJournalMigrationIsRepeatableAndEnforcesTickIdentity(): void
    {
        $sql = $this->readSqlForTestDatabase('migrate_live_battle_journal_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($sql);
        $engines = $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('live_battle_journals','live_battle_journal_ticks')"
        )->fetchAll(PDO::FETCH_COLUMN);
        $this->assertCount(2, $engines);
        $this->assertSame(['InnoDB'], array_values(array_unique($engines)));
        try {
            $this->db->exec(
                "INSERT INTO live_battle_journal_ticks (journal_id,tick,state_json,events_json)
                 VALUES (42,1,'{}','[]')"
            );
            $this->fail('A tick requires an existing journal.');
        } catch (PDOException $error) {
            $this->assertSame('23000', $error->getCode());
        }
    }

    public function testLiveBattleParticipantMigrationIsRepeatableAndRequiresJournal(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('migrate_live_battle_journal_v1.sql'));
        $sql = $this->readSqlForTestDatabase('migrate_live_battle_journal_participants_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($sql);
        $this->assertSame('InnoDB', $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='live_battle_journal_participants'"
        )->fetchColumn());
        try {
            $this->db->exec(
                "INSERT INTO live_battle_journal_participants (journal_id,side,user_id) VALUES (42,'attacker',1)"
            );
            $this->fail('A participant requires an existing journal.');
        } catch (PDOException $error) {
            $this->assertSame('23000', $error->getCode());
        }
    }

    public function testNpcAiWorkerNonceMigrationIsRepeatableAndEnforcesNonceUniqueness(): void
    {
        $sql = $this->readSqlForTestDatabase('migrate_npc_ai_worker_nonce_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->prepare(
            'INSERT INTO npc_ai_worker_nonce (nonce_hash, worker_id) VALUES (?, ?)'
        )->execute([str_repeat('a', 64), 'worker-1']);
        $this->db->exec($sql);
        $duplicate = $this->db->prepare(
            'INSERT IGNORE INTO npc_ai_worker_nonce (nonce_hash, worker_id) VALUES (?, ?)'
        );
        $duplicate->execute([str_repeat('a', 64), 'worker-1']);
        $this->assertSame(0, $duplicate->rowCount());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM npc_ai_worker_nonce')->fetchColumn());
        $this->assertSame('InnoDB', $this->db->query(
            "SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='npc_ai_worker_nonce'"
        )->fetchColumn());
    }

    public function testNpcAiQueueClaimFailureRollsBackAndDoesNotUseAnUnlockedFallback(): void
    {
        $this->db->exec(
            "CREATE TABLE npc_ai_decision_queue (
                id BIGINT PRIMARY KEY,
                status VARCHAR(16) NOT NULL DEFAULT 'queued',
                attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
                max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
                locked_at DATETIME NULL,
                completed_at DATETIME NULL,
                error_message VARCHAR(255) NOT NULL DEFAULT '',
                claimed_by_worker_id VARCHAR(64) NULL,
                claim_token CHAR(64) NULL,
                claim_expires_at DATETIME NULL
             ) ENGINE=InnoDB"
        );

        try {
            npc_ai_decision_queue_claim_with_locking($this->db, 1, 'worker-1');
            $this->fail('A failed locked claim query must be reported.');
        } catch (PDOException $error) {
            $this->assertSame('42S22', $error->getCode());
        }

        $this->assertFalse($this->db->inTransaction());
    }

    public function testNpcAiWorkerClaimRequiresTheLeaseAndFencingSchema(): void
    {
        $this->db->exec(
            "CREATE TABLE npc_ai_decision_queue (
                id BIGINT PRIMARY KEY,
                user_id INT NOT NULL,
                faction_id INT NOT NULL,
                attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
                max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
                payload_json JSON NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'queued',
                available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) ENGINE=InnoDB"
        );
        $this->db->exec(
            "INSERT INTO npc_ai_decision_queue (id, user_id, faction_id) VALUES (1, 1, 1)"
        );

        try {
            npc_ai_decision_queue_claim_with_locking($this->db, 1, 'worker-1');
            $this->fail('A worker must not claim without fencing fields.');
        } catch (RuntimeException $error) {
            $this->assertSame('NPC worker claim schema is unavailable.', $error->getMessage());
        }

        $job = $this->db->query(
            'SELECT status, attempts FROM npc_ai_decision_queue WHERE id = 1'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('queued', $job['status']);
        $this->assertSame(0, (int) $job['attempts']);
        $this->assertFalse($this->db->inTransaction());
    }

    public function testNpcAiQueueClaimRecoversExpiredLeasesWithoutStealingActiveClaims(): void
    {
        $this->db->exec(
            "CREATE TABLE npc_ai_decision_queue (
                id BIGINT PRIMARY KEY,
                user_id INT NOT NULL,
                faction_id INT NOT NULL,
                attempts TINYINT UNSIGNED NOT NULL,
                max_attempts TINYINT UNSIGNED NOT NULL,
                payload_json JSON NULL,
                status VARCHAR(16) NOT NULL,
                available_at DATETIME NOT NULL,
                locked_at DATETIME NULL,
                completed_at DATETIME NULL,
                error_message VARCHAR(255) NOT NULL DEFAULT '',
                claimed_by_worker_id VARCHAR(64) NULL,
                claim_token CHAR(64) NULL,
                claim_expires_at DATETIME NULL,
                INDEX idx_npc_ai_queue_claim_token (claim_token)
             ) ENGINE=InnoDB"
        );
        $insert = $this->db->prepare(
            "INSERT INTO npc_ai_decision_queue
             (id, user_id, faction_id, attempts, max_attempts, status, available_at, locked_at,
              claimed_by_worker_id, claim_token, claim_expires_at)
             VALUES (?, 1, 1, ?, ?, 'processing', NOW(), NOW(), ?, ?, ?)"
        );
        $insert->execute([
            1,
            1,
            3,
            'old-worker',
            str_repeat('a', 64),
            date('Y-m-d H:i:s', time() - 60),
        ]);
        $insert->execute([
            2,
            3,
            3,
            'old-worker',
            str_repeat('b', 64),
            date('Y-m-d H:i:s', time() - 60),
        ]);
        $insert->execute([
            3,
            1,
            3,
            'active-worker',
            str_repeat('c', 64),
            date('Y-m-d H:i:s', time() + 600),
        ]);

        $claimed = npc_ai_decision_queue_claim_with_locking($this->db, 1, 'new-worker');
        $this->assertCount(1, $claimed);
        $this->assertSame(1, (int) $claimed[0]['id']);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $claimed[0]['claim_token']);

        $retryable = $this->db->query(
            'SELECT status, attempts, claimed_by_worker_id, claim_token, claim_expires_at
             FROM npc_ai_decision_queue WHERE id = 1'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('processing', $retryable['status']);
        $this->assertSame(2, (int) $retryable['attempts']);
        $this->assertSame('new-worker', $retryable['claimed_by_worker_id']);
        $this->assertSame($claimed[0]['claim_token'], $retryable['claim_token']);
        $this->assertNotNull($retryable['claim_expires_at']);

        $exhausted = $this->db->query(
            'SELECT status, attempts, completed_at, error_message, claim_token
             FROM npc_ai_decision_queue WHERE id = 2'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('dead', $exhausted['status']);
        $this->assertSame(3, (int) $exhausted['attempts']);
        $this->assertNotNull($exhausted['completed_at']);
        $this->assertSame('Worker claim expired after maximum attempts.', $exhausted['error_message']);
        $this->assertNull($exhausted['claim_token']);

        $active = $this->db->query(
            'SELECT status, attempts, claimed_by_worker_id, claim_token
             FROM npc_ai_decision_queue WHERE id = 3'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('processing', $active['status']);
        $this->assertSame(1, (int) $active['attempts']);
        $this->assertSame('active-worker', $active['claimed_by_worker_id']);
        $this->assertSame(str_repeat('c', 64), $active['claim_token']);
    }

    public function testNpcAiWorkerCannotCompleteAnExpiredClaim(): void
    {
        $this->db->exec(
            "CREATE TABLE npc_ai_decision_queue (
                id BIGINT PRIMARY KEY,
                status VARCHAR(16) NOT NULL,
                attempts TINYINT UNSIGNED NOT NULL,
                max_attempts TINYINT UNSIGNED NOT NULL,
                locked_at DATETIME NULL,
                available_at DATETIME NOT NULL,
                completed_at DATETIME NULL,
                error_message VARCHAR(255) NOT NULL DEFAULT '',
                result_json JSON NULL,
                claimed_by_worker_id VARCHAR(64) NULL,
                claim_token CHAR(64) NULL,
                claim_expires_at DATETIME NULL
             ) ENGINE=InnoDB"
        );
        $insert = $this->db->prepare(
            "INSERT INTO npc_ai_decision_queue
             (id, status, attempts, max_attempts, available_at, claimed_by_worker_id, claim_token, claim_expires_at)
             VALUES (?, 'processing', 1, 3, NOW(), 'worker-1', ?, ?)"
        );
        $expiredToken = str_repeat('d', 64);
        $activeToken = str_repeat('e', 64);
        $insert->execute([1, $expiredToken, date('Y-m-d H:i:s', time() - 60)]);
        $insert->execute([2, $activeToken, date('Y-m-d H:i:s', time() + 600)]);

        $this->assertFalse(npc_ai_decision_queue_complete_claimed(
            $this->db,
            1,
            'worker-1',
            $expiredToken,
            true,
            ['late' => true]
        ));
        $this->assertTrue(npc_ai_decision_queue_complete_claimed(
            $this->db,
            2,
            'worker-1',
            $activeToken,
            true,
            ['accepted' => true]
        ));

        $expired = $this->db->query(
            'SELECT status, result_json, claim_token FROM npc_ai_decision_queue WHERE id = 1'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('processing', $expired['status']);
        $this->assertNull($expired['result_json']);
        $this->assertSame($expiredToken, $expired['claim_token']);

        $active = $this->db->query(
            'SELECT status, result_json, claim_token FROM npc_ai_decision_queue WHERE id = 2'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('done', $active['status']);
        $this->assertSame(['accepted' => true], json_decode((string) $active['result_json'], true));
        $this->assertNull($active['claim_token']);
    }

    public function testNpcAiWorkerFencesSideEffectsAndCompletionInOneTransaction(): void
    {
        $this->db->exec(
            "CREATE TABLE npc_ai_decision_queue (
                id BIGINT PRIMARY KEY,
                status VARCHAR(16) NOT NULL,
                attempts TINYINT UNSIGNED NOT NULL,
                max_attempts TINYINT UNSIGNED NOT NULL,
                locked_at DATETIME NULL,
                available_at DATETIME NOT NULL,
                completed_at DATETIME NULL,
                error_message VARCHAR(255) NOT NULL DEFAULT '',
                result_json JSON NULL,
                claimed_by_worker_id VARCHAR(64) NULL,
                claim_token CHAR(64) NULL,
                claim_expires_at DATETIME NULL
             ) ENGINE=InnoDB"
        );
        $insert = $this->db->prepare(
            "INSERT INTO npc_ai_decision_queue
             (id, status, attempts, max_attempts, available_at, claimed_by_worker_id, claim_token, claim_expires_at)
             VALUES (?, 'processing', 1, 3, NOW(), 'worker-1', ?, ?)"
        );
        $activeToken = str_repeat('f', 64);
        $expiredToken = str_repeat('a', 64);
        $insert->execute([1, $activeToken, date('Y-m-d H:i:s', time() + 30)]);
        $insert->execute([2, $expiredToken, date('Y-m-d H:i:s', time() - 60)]);

        $this->assertTrue(npc_ai_decision_queue_begin_fenced_completion(
            $this->db,
            1,
            'worker-1',
            $activeToken
        ));
        $this->assertTrue($this->db->inTransaction());
        $remainingLease = (int) $this->db->query(
            'SELECT TIMESTAMPDIFF(SECOND, NOW(), claim_expires_at)
             FROM npc_ai_decision_queue WHERE id = 1'
        )->fetchColumn();
        $this->assertGreaterThanOrEqual(59, $remainingLease);

        $this->assertTrue(npc_ai_decision_queue_complete_claimed(
            $this->db,
            1,
            'worker-1',
            $activeToken,
            true,
            ['action' => 'send_message']
        ));
        $this->db->commit();
        $this->assertSame('done', $this->db->query(
            'SELECT status FROM npc_ai_decision_queue WHERE id = 1'
        )->fetchColumn());

        $this->assertFalse(npc_ai_decision_queue_begin_fenced_completion(
            $this->db,
            2,
            'worker-1',
            $expiredToken
        ));
        $this->assertFalse($this->db->inTransaction());
        $this->assertSame('processing', $this->db->query(
            'SELECT status FROM npc_ai_decision_queue WHERE id = 2'
        )->fetchColumn());
    }

    public function testNpcAiQueueEnqueueSerializesDeduplicationAndHonorsLockContention(): void
    {
        $this->db->exec(
            "CREATE TABLE npc_ai_decision_queue (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                faction_id INT NOT NULL,
                source_scope VARCHAR(32) NOT NULL,
                status VARCHAR(16) NOT NULL,
                attempts TINYINT UNSIGNED NOT NULL,
                max_attempts TINYINT UNSIGNED NOT NULL,
                available_at DATETIME NOT NULL,
                dedupe_key VARCHAR(128) NOT NULL,
                payload_json JSON NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             ) ENGINE=InnoDB"
        );
        $payload = ['id' => 7, 'code' => 'test_faction'];
        $first = npc_ai_decision_queue_maybe_enqueue($this->db, 42, $payload);
        $second = npc_ai_decision_queue_maybe_enqueue($this->db, 42, $payload);

        $this->assertTrue($first['queued']);
        $this->assertSame('already_pending', $second['reason']);
        $this->assertSame(1, (int) $this->db->query(
            'SELECT COUNT(*) FROM npc_ai_decision_queue'
        )->fetchColumn());

        $lockName = npc_ai_decision_queue_dedupe_lock_name(npc_ai_decision_dedupe_key(43, 7));
        $contender = new PDO(
            (string) getenv('GQ_MIGRATION_TEST_DSN'),
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $contender->exec('USE `' . $this->database . '`');
        $held = $contender->prepare('SELECT GET_LOCK(?, 0)');
        $held->execute([$lockName]);
        $this->assertSame(1, (int) $held->fetchColumn());

        $blocked = npc_ai_decision_queue_maybe_enqueue($this->db, 43, $payload);
        $this->assertSame(['queued' => false, 'reason' => 'lock_busy'], $blocked);
        $this->assertSame(1, (int) $this->db->query(
            'SELECT COUNT(*) FROM npc_ai_decision_queue'
        )->fetchColumn());

        $release = $contender->prepare('SELECT RELEASE_LOCK(?)');
        $release->execute([$lockName]);
        $this->assertSame(1, (int) $release->fetchColumn());
    }

    private function actorAdoptionRunner(): MigrationRunner
    {
        $this->db->exec(
            "CREATE TABLE users (
                id INT PRIMARY KEY, control_type VARCHAR(24) NOT NULL DEFAULT 'human',
                auth_enabled TINYINT(1) NOT NULL DEFAULT 1, deleted_at DATETIME NULL,
                INDEX idx_users_control_type(control_type)
             ) ENGINE=InnoDB;
             INSERT INTO users VALUES (1,'human',1,NULL),(2,'npc_engine',0,NULL)"
        );
        $names = ['migrate_actor_model_v1.sql', 'migrate_actor_model_v2_drop_is_npc.sql'];
        foreach (array_merge($names, ['schema_migration_adoptions.sql']) as $name) {
            copy(__DIR__ . '/../../sql/' . $name, $this->sqlDir . '/' . $name);
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($names, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testActorAdoptionPreservesIdentitiesAndRecordsDistinctProvenance(): void
    {
        $runner = $this->actorAdoptionRunner();
        $before = $this->db->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $preview = $runner->adoptActorHistory(true);
        $this->assertTrue($preview['dry_run']);
        $this->assertCount(2, $preview['adopted']);
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migration_adoptions'"
        )->fetchColumn());
        $result = $runner->adoptActorHistory(false);
        $this->assertSame(['human' => 1, 'npc_engine' => 1], $result['evidence']['controller_counts']);
        $this->assertSame($before, $this->db->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(2, $this->trackingCount());
        $this->assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
        $this->assertSame(['adopted', 'adopted'], array_column($runner->getStatus(), 'execution_kind'));
        $this->assertSame(2, $runner->verifyDeployment());
        $this->assertSame([], $runner->adoptActorHistory(false)['adopted']);
        $this->assertSame([], $runner->runUp());
        try {
            $runner->runRollback();
            $this->fail('Adopted history must not execute a down migration.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('adopted history', $error->getMessage());
        }
    }

    #[DataProvider('invalidActorAdoptionStates')]
    public function testActorAdoptionRejectsInvalidStatesWithoutTracking(string $mutation): void
    {
        $runner = $this->actorAdoptionRunner();
        $this->db->exec($mutation);
        try {
            $runner->adoptActorHistory(false);
            $this->fail('Invalid actor state must not be adopted.');
        } catch (RuntimeException $error) {
            $this->assertNotSame('', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public static function invalidActorAdoptionStates(): array
    {
        return [
            ["ALTER TABLE users ADD COLUMN is_npc TINYINT NOT NULL DEFAULT 0"],
            ["UPDATE users SET auth_enabled=1 WHERE id=2"],
            ["UPDATE users SET control_type='unrecognized' WHERE id=2"],
            ["UPDATE users SET deleted_at=NOW() WHERE id=1"],
            ["ALTER TABLE users DROP INDEX idx_users_control_type"],
            ["ALTER TABLE users MODIFY control_type VARCHAR(24) NULL DEFAULT 'human'"],
        ];
    }

    public function testActorAdoptionRejectsChangedSourceBeforeAnyWrites(): void
    {
        $runner = $this->actorAdoptionRunner();
        file_put_contents($this->sqlDir . '/migrate_actor_model_v1.sql', "\n-- changed\n", FILE_APPEND);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('changed SQL');
        $runner->adoptActorHistory(false);
    }

    public function testActorAdoptionEvidenceAndTrackingRollBackTogether(): void
    {
        $runner = $this->actorAdoptionRunner();
        $this->db->exec(
            "CREATE TRIGGER reject_tracking BEFORE INSERT ON schema_migrations FOR EACH ROW
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected adoption failure'"
        );
        try {
            $runner->adoptActorHistory(false);
            $this->fail('Tracking failure must roll back evidence.');
        } catch (PDOException $error) {
            $this->assertStringContainsString('injected adoption failure', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
    }

    public function testActorAdoptionRejectsMissingEvidenceAndBlocksLegacyV2Replay(): void
    {
        $runner = $this->actorAdoptionRunner();
        $runner->adoptActorHistory(false);
        copy(__DIR__ . '/../../sql/migrate_v2.sql', $this->sqlDir . '/migrate_v2.sql');
        file_put_contents($this->sqlDir . '/manifest.php',
            "<?php return ['migrate_v2.sql','migrate_actor_model_v1.sql','migrate_actor_model_v2_drop_is_npc.sql'];");
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->runUp(null, true);
            $this->fail('Legacy v2 must not recreate retired flags.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('recreates is_npc', $error->getMessage());
        }
        $this->db->exec('DELETE FROM schema_migration_adoptions');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('provenance');
        $runner->verifyDeployment();
    }

    private function bodyAdoptionRunner(): MigrationRunner
    {
        $source = file_get_contents(__DIR__ . '/../../sql/migrate_unified_bodies_v1.sql');
        $start = strpos($source, 'CREATE TABLE IF NOT EXISTS celestial_bodies');
        $end = strpos($source, ') ENGINE=InnoDB;', $start) + strlen(') ENGINE=InnoDB;');
        $this->db->exec(substr($source, $start, $end - $start));
        $this->db->exec(
            "CREATE TABLE planets (id INT PRIMARY KEY,galaxy INT,`system` INT,position INT) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY,body_id BIGINT UNSIGNED NOT NULL,planet_id INT NULL,
               UNIQUE KEY unique_colony_body(body_id),KEY idx_colonies_body_id(body_id),
               CONSTRAINT fk_colonies_body_id FOREIGN KEY(body_id) REFERENCES celestial_bodies(id) ON DELETE CASCADE
             ) ENGINE=InnoDB;
             CREATE TABLE battle_reports (id INT PRIMARY KEY,body_id BIGINT UNSIGNED NOT NULL,
               KEY idx_battle_body_id(body_id)) ENGINE=InnoDB;
             CREATE TABLE spy_reports (id INT PRIMARY KEY,target_body_id BIGINT UNSIGNED NULL,
               KEY idx_spy_target_body(target_body_id)) ENGINE=InnoDB;
             INSERT INTO celestial_bodies
               (id,body_uid,galaxy_index,system_index,position,body_type,name)
               VALUES (10,'native-planet-10',1,2,1,'planet','Native planet'),
                      (11,'native-moon-11',1,2,NULL,'moon','Native moon');
             UPDATE celestial_bodies SET parent_body_id=10 WHERE id=11;
             INSERT INTO planets VALUES (1,1,2,1),(99,9,9,9);
             INSERT INTO colonies VALUES (1,10,1),(2,11,NULL);
             INSERT INTO battle_reports VALUES (1,10);
             INSERT INTO spy_reports VALUES (1,11),(2,NULL)"
        );
        $names = ['migrate_unified_bodies_v1.sql', 'migrate_unified_bodies_v2_hardcut.sql'];
        foreach (array_merge($names, ['schema_migration_adoptions.sql']) as $name) {
            copy(__DIR__ . '/../../sql/' . $name, $this->sqlDir . '/' . $name);
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($names, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testBodyAdoptionKeepsNativeIdentitiesAndNeverImportsUninhabitedLegacyPlanets(): void
    {
        $runner = $this->bodyAdoptionRunner();
        $before = $this->db->query('SELECT * FROM celestial_bodies ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $preview = $runner->adoptBodyHistory(true);
        $this->assertCount(2, $preview['adopted']);
        $this->assertSame(0, $this->trackingCount());
        $result = $runner->adoptBodyHistory(false);
        $this->assertSame(2, $result['evidence']['body_count']);
        $this->assertSame(2, $result['evidence']['colony_count']);
        $this->assertSame('preserve-native-catalogue-no-uninhabited-legacy-import', $result['evidence']['policy']);
        $this->assertSame($before, $this->db->query('SELECT * FROM celestial_bodies ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(2, $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        $this->assertSame([], $runner->adoptBodyHistory(false)['adopted']);
        $this->assertSame(['adopted', 'adopted'], array_column($runner->getStatus(), 'execution_kind'));
        $this->assertSame(2, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
    }

    #[DataProvider('invalidBodyAdoptionStates')]
    public function testBodyAdoptionRejectsInvalidMappingOrSchema(string $mutation): void
    {
        $runner = $this->bodyAdoptionRunner();
        $this->db->exec($mutation);
        try {
            $runner->adoptBodyHistory(false);
            $this->fail('Incomplete native body state cannot be adopted.');
        } catch (RuntimeException $error) {
            $this->assertNotSame('', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public static function invalidBodyAdoptionStates(): array
    {
        return [
            ["ALTER TABLE colonies MODIFY body_id BIGINT UNSIGNED NULL"],
            ["ALTER TABLE colonies DROP FOREIGN KEY fk_colonies_body_id"],
            ["ALTER TABLE celestial_bodies DROP FOREIGN KEY fk_celestial_parent"],
            ["ALTER TABLE celestial_bodies DROP INDEX idx_body_type"],
            ["ALTER TABLE celestial_bodies MODIFY body_uid VARCHAR(65) NOT NULL"],
            ["ALTER TABLE battle_reports ADD COLUMN planet_id INT NULL"],
            ["UPDATE battle_reports SET body_id=999"],
            ["UPDATE spy_reports SET target_body_id=999"],
            ["UPDATE planets SET position=2 WHERE id=1"],
            ["UPDATE colonies SET planet_id=99 WHERE id=2"],
            ["UPDATE celestial_bodies SET parent_body_id=id WHERE id=11"],
        ];
    }

    public function testBodyAdoptionTrackingFailureRollsBackProvenance(): void
    {
        $runner = $this->bodyAdoptionRunner();
        $this->db->exec(
            "CREATE TRIGGER reject_tracking BEFORE INSERT ON schema_migrations FOR EACH ROW
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected adoption failure'"
        );
        try {
            $runner->adoptBodyHistory(false);
            $this->fail('Evidence must not outlive failed tracking.');
        } catch (PDOException $error) {
            $this->assertStringContainsString('injected adoption failure', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
    }

    public function testBodyAdoptionRejectsWrongContractProvenance(): void
    {
        $runner = $this->bodyAdoptionRunner();
        $runner->adoptBodyHistory(false);
        $this->db->exec("UPDATE schema_migration_adoptions SET contract_id='actor-current-v1'");
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('provenance');
        $runner->verifyDeployment();
    }

    public function testBodyAdoptionRejectsChangedSourceWithoutTracking(): void
    {
        $runner = $this->bodyAdoptionRunner();
        file_put_contents($this->sqlDir . '/migrate_unified_bodies_v1.sql', "\n-- drift\n", FILE_APPEND);
        try {
            $runner->adoptBodyHistory(false);
            $this->fail('New source bytes require a reviewed contract.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('changed SQL', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
    }

    public function testBodyAdoptionRejectsPolicyDriftAndCannotRollBack(): void
    {
        $runner = $this->bodyAdoptionRunner();
        $runner->adoptBodyHistory(false);
        try {
            $runner->runRollback();
            $this->fail('Native body adoption must not execute historical rollback.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('adopted history', $error->getMessage());
        }
        $this->db->exec(
            "UPDATE schema_migration_adoptions
             SET evidence_json=JSON_SET(evidence_json,'$.policy','import-all-legacy-planets')"
        );
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('policy or schema evidence');
        $runner->getStatus();
    }

    private function trackingCount(): int
    {
        return (int)$this->db->query('SELECT COUNT(*) FROM schema_migrations')->fetchColumn();
    }

    private function migrationLockName(): string
    {
        return 'gq:migrations:' . substr(hash('sha256', $this->database), 0, 48);
    }

    private function secondConnection(): PDO
    {
        $connection = new PDO(
            (string)getenv('GQ_MIGRATION_TEST_DSN'),
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $connection->exec('USE `' . $this->database . '`');
        return $connection;
    }

    private function assertMigrationLockFree(): void
    {
        $query = $this->db->prepare('SELECT IS_FREE_LOCK(?)');
        $query->execute([$this->migrationLockName()]);
        $this->assertSame(1, (int)$query->fetchColumn());
        $query->closeCursor();
    }

    /** @return iterable<array{string, bool}> */
    public static function lockedOperations(): iterable
    {
        yield 'up' => ['up', false];
        yield 'up preview' => ['up', true];
        yield 'rollback' => ['rollback', false];
        yield 'rollback preview' => ['rollback', true];
        yield 'bootstrap' => ['bootstrap', false];
        yield 'verify' => ['verify', false];
        yield 'actor adoption' => ['adopt', false];
        yield 'actor adoption preview' => ['adopt', true];
        yield 'body adoption' => ['adopt-bodies', false];
        yield 'body adoption preview' => ['adopt-bodies', true];
        yield 'V2 adoption' => ['adopt-v2', false];
        yield 'V2 adoption preview' => ['adopt-v2', true];
        yield 'economy adoption' => ['adopt-economy', false];
        yield 'economy adoption preview' => ['adopt-economy', true];
        yield 'auth adoption' => ['adopt-auth', false];
        yield 'auth adoption preview' => ['adopt-auth', true];
        yield 'war adoption' => ['adopt-wars', false];
        yield 'war adoption preview' => ['adopt-wars', true];
    }

    #[DataProvider('lockedOperations')]
    public function testCompetingConnectionFailsBeforeAnyTrackingDdl(string $operation, bool $dryRun): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return [];\n");
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $holder = $this->secondConnection();
        $query = $holder->prepare('SELECT GET_LOCK(?, 0)');
        $query->execute([$this->migrationLockName()]);
        $this->assertSame(1, (int)$query->fetchColumn());
        $query->closeCursor();
        try {
            $start = hrtime(true);
            try {
                match ($operation) {
                    'up' => $runner->runUp(null, $dryRun),
                    'rollback' => $runner->runRollback(1, $dryRun),
                    'bootstrap' => $runner->bootstrap(),
                    'verify' => $runner->verifyDeployment(),
                    'adopt' => $runner->adoptActorHistory($dryRun),
                    'adopt-bodies' => $runner->adoptBodyHistory($dryRun),
                    'adopt-v2' => $runner->adoptLegacyV2History($dryRun),
                    'adopt-economy' => $runner->adoptEconomyHistory($dryRun),
                    'adopt-auth' => $runner->adoptAuthHistory($dryRun),
                    'adopt-wars' => $runner->adoptWarHistory($dryRun),
                };
                $this->fail('Expected competing migration rejection.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('Another migration process', $error->getMessage());
            }
            $this->assertLessThan(2, (hrtime(true) - $start) / 1e9);
            $this->assertSame(0, (int)$this->db->query(
                "SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
            )->fetchColumn());
            $query = $holder->prepare('SELECT IS_USED_LOCK(?) = CONNECTION_ID()');
            $query->execute([$this->migrationLockName()]);
            $this->assertSame(1, (int)$query->fetchColumn());
            $query->closeCursor();
        } finally {
            $query = $holder->prepare('SELECT RELEASE_LOCK(?)');
            $query->execute([$this->migrationLockName()]);
            $this->assertSame(1, (int)$query->fetchColumn());
            $query->closeCursor();
        }
        $this->assertSame([], $runner->runUp());
        $this->assertMigrationLockFree();
    }

    public function testLockRemainsOwnedAcrossDdlAndRollbackUntilTrackingCompletes(): void
    {
        $name = $this->db->quote($this->migrationLockName());
        $runner = $this->buildRunner(
            "CREATE TABLE lock_probe (owned INT);
             INSERT INTO lock_probe SELECT IS_USED_LOCK($name) = CONNECTION_ID();",
            "INSERT INTO lock_probe SELECT IS_USED_LOCK($name) = CONNECTION_ID();"
        );
        $this->assertMigrationLockFree();
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([1], array_map('intval', $this->db->query('SELECT owned FROM lock_probe')->fetchAll(PDO::FETCH_COLUMN)));
        $this->assertMigrationLockFree();
        $this->assertSame('rolled_back', $runner->runRollback()[0]['status']);
        $this->assertSame([1, 1], array_map('intval', $this->db->query('SELECT owned FROM lock_probe')->fetchAll(PDO::FETCH_COLUMN)));
        $this->assertSame(0, $this->trackingCount());
        $this->assertMigrationLockFree();
        $this->assertCount(1, $runner->runUp(null, true));
        $this->assertMigrationLockFree();
    }

    public function testLockReleasedAfterUpAndRollbackSqlFailures(): void
    {
        $runner = $this->buildRunner('THIS IS NOT SQL;');
        try {
            $runner->runUp();
            $this->fail('Expected invalid SQL.');
        } catch (RuntimeException $error) {
            $this->assertInstanceOf(PDOException::class, $error->getPrevious());
        }
        $this->assertMigrationLockFree();
        $runner = $this->buildRunner('SELECT 1;', 'THIS IS NOT SQL;');
        $runner->runUp();
        try {
            $runner->runRollback();
            $this->fail('Expected invalid rollback SQL.');
        } catch (RuntimeException $error) {
            $this->assertInstanceOf(PDOException::class, $error->getPrevious());
        }
        $this->assertMigrationLockFree();
        $this->assertSame(1, $this->trackingCount());
    }

    public function testLockReleasedWhenBootstrapSqlFails(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return [];\n");
        file_put_contents($this->sqlDir . '/schema_migrations.sql', 'THIS IS NOT SQL;');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->runUp();
            $this->fail('Expected bootstrap SQL failure.');
        } catch (PDOException $error) {
            $this->assertSame('42000', $error->getCode());
        }
        $this->assertMigrationLockFree();
    }

    public function testCallerTransactionIsRejectedWithoutImplicitCommit(): void
    {
        $runner = $this->buildRunner('SELECT 1;');
        $this->db->exec('CREATE TABLE caller_data (id INT) ENGINE=InnoDB');
        $this->db->beginTransaction();
        $this->db->exec('INSERT INTO caller_data VALUES (42)');
        try {
            $runner->runUp();
            $this->fail('Expected active transaction rejection.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('active transaction', $error->getMessage());
        }
        $this->assertTrue($this->db->inTransaction());
        $this->db->rollBack();
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM caller_data')->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testDatabaseSelectionIsRequiredBeforeLocking(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return [];\n");
        $connection = new PDO(
            (string)getenv('GQ_MIGRATION_TEST_DSN'),
            getenv('GQ_MIGRATION_TEST_USER') ?: 'root',
            getenv('GQ_MIGRATION_TEST_PASSWORD') ?: '',
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
        );
        $runner = new MigrationRunner($connection, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Select a database');
        $runner->bootstrap();
    }

    public function testDifferentDatabasesDoNotBlockEachOther(): void
    {
        $runner = $this->buildRunner('SELECT 1;');
        $holder = $this->secondConnection();
        $otherName = 'gq:migrations:' . substr(hash('sha256', 'another_' . $this->database), 0, 48);
        $query = $holder->prepare('SELECT GET_LOCK(?, 0)');
        $query->execute([$otherName]);
        $this->assertSame(1, (int)$query->fetchColumn());
        $query->closeCursor();
        try {
            $this->assertCount(1, $runner->runUp());
            $this->assertMigrationLockFree();
        } finally {
            $query = $holder->prepare('SELECT RELEASE_LOCK(?)');
            $query->execute([$otherName]);
            $this->assertSame(1, (int)$query->fetchColumn());
            $query->closeCursor();
        }
    }

    /** @return iterable<array{string, bool}> */
    public static function integrityOperations(): iterable
    {
        yield 'up' => ['up', false];
        yield 'up preview' => ['up', true];
        yield 'rollback' => ['rollback', false];
        yield 'rollback preview' => ['rollback', true];
        yield 'verify' => ['verify', false];
    }

    #[DataProvider('integrityOperations')]
    public function testChecksumDriftStopsWritesAndReleasesLock(string $operation, bool $dryRun): void
    {
        $runner = $this->buildRunner(
            'CREATE TABLE integrity_probe (id INT PRIMARY KEY); INSERT INTO integrity_probe VALUES (42);',
            'DELETE FROM integrity_probe;'
        );
        $runner->runUp();
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        file_put_contents($this->sqlDir . '/migration.sql', 'SELECT 2;');
        try {
            if ($operation === 'up') {
                $runner->runUp(null, $dryRun);
            } elseif ($operation === 'verify') {
                $runner->verifyDeployment();
            } else {
                $runner->runRollback(1, $dryRun);
            }
            $this->fail('Expected checksum mismatch.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('checksum mismatch: migration.sql', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(42, (int)$this->db->query('SELECT id FROM integrity_probe')->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testMissingLaterPendingFilePreventsEarlierDdl(): void
    {
        $runner = $this->buildRunner('CREATE TABLE must_not_exist (id INT);');
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migration.sql', 'missing.sql'];\n");
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->runUp();
            $this->fail('Expected missing pending file.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('missing.sql', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'must_not_exist'"
        )->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testRemovedAppliedFileStopsDeploymentAndReleasesLock(): void
    {
        $runner = $this->buildRunner('SELECT 1;');
        $runner->runUp();
        unlink($this->sqlDir . '/migration.sql');
        try {
            $runner->runUp();
            $this->fail('Expected missing applied file.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('migration.sql', $error->getMessage());
        }
        $this->assertSame(1, $this->trackingCount());
        $this->assertMigrationLockFree();
    }

    /** @return iterable<array{bool}> */
    public static function rollbackPreviews(): iterable
    {
        yield [false];
        yield [true];
    }

    #[DataProvider('rollbackPreviews')]
    public function testIrreversibleBarrierPreventsAnySelectedDdlRollback(bool $dryRun): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['older.sql', 'newer.sql'];");
        file_put_contents($this->sqlDir . '/older.sql', 'CREATE TABLE older_probe (id INT);');
        file_put_contents($this->sqlDir . '/newer.sql', 'CREATE TABLE newer_probe (id INT);');
        file_put_contents($this->sqlDir . '/newer_down.sql', 'DROP TABLE newer_probe;');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->runUp();
        $results = $runner->runRollback(2, $dryRun);
        $this->assertSame('no_down_file', $results[0]['status']);
        $this->assertSame('older.sql', $results[0]['name']);
        $this->assertSame(2, $this->trackingCount());
        $this->assertSame(2, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('older_probe', 'newer_probe')"
        )->fetchColumn());
        $this->assertMigrationLockFree();
        file_put_contents($this->sqlDir . '/older_down.sql', 'DROP TABLE older_probe;');
        $this->assertCount(2, $runner->runRollback(2));
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('older_probe', 'newer_probe')"
        )->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testFreshPreviewDoesNotCreateAnyTablesEvenWithInvalidBootstrapSql(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['preview.sql'];");
        file_put_contents($this->sqlDir . '/preview.sql', 'CREATE TABLE preview_data (id INT);');
        file_put_contents($this->sqlDir . '/schema_migrations.sql', 'THIS IS NOT SQL;');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $results = $runner->runUp(null, true);
        $this->assertCount(1, $results);
        $this->assertTrue($results[0]['skipped']);
        $this->assertSame([], $runner->runRollback(1, true));
        $this->assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
        )->fetchColumn());
        $this->assertMigrationLockFree();
        copy(__DIR__ . '/../../sql/schema_migrations.sql', $this->sqlDir . '/schema_migrations.sql');
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertMigrationLockFree();
    }

    public function testTrackingPermissionFailureIsNotReplacedByBootstrap(): void
    {
        $this->buildRunner('SELECT 1;');
        $username = 'gq_probe_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT CREATE ON `' . $this->database . '`.* TO ' . $account);
            $limited = new PDO(
                (string)getenv('GQ_MIGRATION_TEST_DSN'),
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $limited->exec('USE `' . $this->database . '`');
            $runner = new MigrationRunner($limited, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
            // Bootstrap would produce a different error if the denied SELECT were swallowed.
            file_put_contents($this->sqlDir . '/schema_migrations.sql', 'THIS IS NOT SQL;');
            foreach ([false, true] as $dryRun) {
                try {
                    $runner->runUp(null, $dryRun);
                    $this->fail('Expected SELECT privilege failure.');
                } catch (PDOException $error) {
                    $this->assertSame(1142, $error->errorInfo[1]);
                    $this->assertSame('42000', $error->getCode());
                }
                $this->assertMigrationLockFree();
            }
            $this->assertSame(0, $this->trackingCount());
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    private function readSqlForTestDatabase(string $file): string
    {
        $source = file_get_contents(__DIR__ . '/../../sql/' . $file);
        $this->assertNotFalse($source);
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST');
        $statements = array_filter(
            $runner->splitStatements($source),
            static fn(string $statement): bool => $statement !== 'USE galaxyquest'
                && !str_starts_with($statement, 'CREATE DATABASE IF NOT EXISTS galaxyquest ')
        );
        return implode(";\n", $statements) . ';';
    }

    public function testGalaxyMetadataMigrationAndPrecisionRepairPreserveIntendedSeed(): void
    {
        $names = ['migrate_galaxies_metadata.sql', 'migrate_galaxy_metadata_precision_v1.sql'];
        foreach ($names as $name) {
            file_put_contents($this->sqlDir . '/' . $name, $this->readSqlForTestDatabase($name));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($names, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();

        $this->assertCount(2, $runner->runUp());
        $column = $this->db->query(
            "SELECT COLUMN_TYPE,COLUMN_DEFAULT FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='galaxies' AND COLUMN_NAME='smbh_tidal_radius_ly'"
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('decimal(8,2)', $column['COLUMN_TYPE']);
        $this->assertSame('0.15', $column['COLUMN_DEFAULT']);
        $this->assertSame('0.15', $this->db->query(
            'SELECT CAST(smbh_tidal_radius_ly AS CHAR) FROM galaxies WHERE id=1'
        )->fetchColumn());
        $this->assertSame([], $runner->runUp());

        $this->db->exec(
            "INSERT INTO galaxies (id,name,smbh_tidal_radius_ly) VALUES (2,'Custom Galaxy',0.30)"
        );
        $repair = $this->readSqlForTestDatabase('migrate_galaxy_metadata_precision_v1.sql');
        $this->db->exec($repair);
        $this->assertSame('0.15', $this->db->query(
            'SELECT CAST(smbh_tidal_radius_ly AS CHAR) FROM galaxies WHERE id=1'
        )->fetchColumn());
        $this->assertSame('0.30', $this->db->query(
            'SELECT CAST(smbh_tidal_radius_ly AS CHAR) FROM galaxies WHERE id=2'
        )->fetchColumn());
    }

    public function testVerifyFreshDatabaseNeverCreatesTrackingAndReleasesLock(): void
    {
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migration.sql'];");
        file_put_contents($this->sqlDir . '/schema_migrations.sql', 'INVALID BOOTSTRAP');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        try {
            $runner->verifyDeployment();
            $this->fail('Fresh deployment must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('existing migration tracking table', $error->getMessage());
        }
        $this->assertSame(0, (int) $this->db->query(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()'
        )->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testVerifyRejectsPendingAndForeignHistoryWithoutChangingTracking(): void
    {
        $runner = $this->buildRunner('CREATE TABLE verify_probe (id INT); INSERT INTO verify_probe VALUES (42);');
        try {
            $runner->verifyDeployment();
            $this->fail('Pending deployment must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('pending migration: migration.sql', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertMigrationLockFree();
        $runner->runUp();
        $this->assertSame(1, $runner->verifyDeployment());
        $this->db->exec("INSERT INTO schema_migrations (migration_name,checksum) VALUES ('newer.sql','unknown')");
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        try {
            $runner->verifyDeployment();
            $this->fail('Foreign history must block verification.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('absent from the deployment manifest: newer.sql', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(42, (int) $this->db->query('SELECT id FROM verify_probe')->fetchColumn());
        $this->assertMigrationLockFree();
    }

    public function testVerifyWorksWithSelectOnlyAccountAndDoesNotExecuteSql(): void
    {
        $runner = $this->buildRunner('CREATE TABLE verify_probe (id INT); INSERT INTO verify_probe VALUES (42);');
        $runner->runUp();
        $username = 'gq_verify_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $limited = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'),
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            $limited->exec('USE `' . $this->database . '`');
            $readOnlyRunner = new MigrationRunner($limited, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
            $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
            $this->assertSame(1, $readOnlyRunner->verifyDeployment());
            $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame(42, (int) $this->db->query('SELECT id FROM verify_probe')->fetchColumn());
            $this->assertMigrationLockFree();
            $this->admin->exec('REVOKE SELECT ON `' . $this->database . '`.* FROM ' . $account);
            $this->admin->exec('GRANT CREATE ON `' . $this->database . '`.* TO ' . $account);
            $denied = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'),
                $username,
                $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            $denied->exec('USE `' . $this->database . '`');
            $deniedRunner = new MigrationRunner($denied, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
            try {
                $deniedRunner->verifyDeployment();
                $this->fail('Denied SELECT must fail.');
            } catch (PDOException $error) {
                $this->assertSame(1142, $error->errorInfo[1]);
            }
            $this->assertMigrationLockFree();
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testVerifyRejectsActiveCallerTransactionWithoutCommittingIt(): void
    {
        $runner = $this->buildRunner('CREATE TABLE verify_probe (id INT);');
        $runner->runUp();
        $this->db->beginTransaction();
        try {
            $runner->verifyDeployment();
            $this->fail('Caller transaction must not verify.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('without an active transaction', $error->getMessage());
        }
        $this->assertTrue($this->db->inTransaction());
        $this->db->rollBack();
        $this->assertMigrationLockFree();
    }

    public function testCompleteV2MigrationAppliesToCurrentBaseSchema(): void
    {
        $schema = $this->readSqlForTestDatabase('schema.sql');
        $this->db->exec($schema);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_v2.sql'));

        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        $this->assertGreaterThan(0, (int)$this->db->query('SELECT COUNT(*) FROM achievements')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'planets' AND COLUMN_NAME = 'user_id'"
        )->fetchColumn());
    }

    public function testMigrationUseDirectiveCannotRedirectTheSelectedDatabase(): void
    {
        $unselectedDatabase = 'gq_unselected_' . bin2hex(random_bytes(5));
        $runner = $this->buildRunner(
            'USE `' . $unselectedDatabase . '`; CREATE TABLE selected_database_probe (id INT)'
        );

        $this->assertCount(1, $runner->runUp());
        $this->assertSame(
            1,
            (int)$this->db->query(
                "SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'selected_database_probe'"
            )->fetchColumn()
        );
    }

    private function gameplayPoliticsRunner(): MigrationRunner
    {
        $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->db->exec(
            "CREATE TABLE users (
                id INT PRIMARY KEY,control_type VARCHAR(24) NOT NULL DEFAULT 'human',
                auth_enabled TINYINT(1) NOT NULL DEFAULT 1,deleted_at DATETIME NULL
             ) ENGINE=InnoDB;
             CREATE TABLE colonies (
                id INT PRIMARY KEY,user_id INT NOT NULL,metal DECIMAL(20,4) NOT NULL,
                last_update DATETIME NOT NULL
             ) ENGINE=InnoDB;
             INSERT INTO users VALUES (710001,'human',1,NULL),(710002,'npc_engine',0,NULL);
             INSERT INTO colonies VALUES (1,710002,12345.6789,'2026-11-07 10:00:00')"
        );
        $names = ['migrate_gameplay_model_v1.sql', 'migrate_politics_model_v1.sql'];
        foreach ($names as $name) {
            file_put_contents($this->sqlDir . '/' . $name, $this->readSqlForTestDatabase($name));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($names, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testGameplayPoliticsMigrationsCreateCompleteBaselineForBothActorKinds(): void
    {
        $runner = $this->gameplayPoliticsRunner();
        $actors = $this->db->query('SELECT * FROM users ORDER BY id')->fetchAll();
        $colonies = $this->db->query('SELECT * FROM colonies ORDER BY id')->fetchAll();
        $this->assertCount(2, $runner->runUp(null, true));
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_empire_profile'"
        )->fetchColumn());
        $this->assertCount(2, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(2, $runner->verifyDeployment());
        $this->assertSame($actors, $this->db->query('SELECT * FROM users ORDER BY id')->fetchAll());
        $this->assertSame($colonies, $this->db->query('SELECT * FROM colonies ORDER BY id')->fetchAll());
        foreach (['situation_states', 'situation_stage_log', 'faction_approval_history', 'user_empire_modifiers'] as $table) {
            $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn());
        }
        foreach ([710001, 710002] as $id) {
            $query = $this->db->prepare('SELECT faction_key,approval,support,issues_json FROM user_faction_state
                WHERE user_id=? ORDER BY faction_key');
            $query->execute([$id]);
            $this->assertSame([
                ['faction_key' => 'civic_union', 'approval' => '50.00', 'support' => '0.00', 'issues_json' => '[]'],
                ['faction_key' => 'industrialists', 'approval' => '50.00', 'support' => '0.00', 'issues_json' => '[]'],
                ['faction_key' => 'scientists', 'approval' => '50.00', 'support' => '0.00', 'issues_json' => '[]'],
                ['faction_key' => 'security_bloc', 'approval' => '50.00', 'support' => '0.00', 'issues_json' => '[]'],
            ], $query->fetchAll());
            $query = $this->db->prepare('SELECT primary_species_key,government_key,ethic_axis_json
                FROM user_empire_profile WHERE user_id=?');
            $query->execute([$id]);
            $profile = $query->fetch();
            $this->assertSame('adaptive_humans', $profile['primary_species_key']);
            $this->assertSame('stellar_republic', $profile['government_key']);
            $this->assertEquals(
                ['order_vs_freedom' => 0, 'industry_vs_ecology' => 0, 'science_vs_tradition' => 0],
                json_decode($profile['ethic_axis_json'], true, 512, JSON_THROW_ON_ERROR)
            );
            $query = $this->db->prepare('SELECT civic_key,slot_index FROM user_empire_civics
                WHERE user_id=? ORDER BY slot_index');
            $query->execute([$id]);
            $this->assertSame([
                ['civic_key' => 'meritocracy', 'slot_index' => 1],
                ['civic_key' => 'adaptive_bureaucracy', 'slot_index' => 2],
            ], $query->fetchAll());
        }
        $this->assertSame(3, (int)$this->db->query('SELECT COUNT(*) FROM species_profiles')->fetchColumn());
        $this->assertSame(3, (int)$this->db->query('SELECT COUNT(*) FROM government_forms')->fetchColumn());
        $this->assertSame(4, (int)$this->db->query('SELECT COUNT(*) FROM government_civics')->fetchColumn());
        $this->assertSame(10, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND ENGINE='InnoDB'
             AND TABLE_NAME IN ('situation_states','situation_stage_log','user_faction_state','faction_approval_history',
                 'species_profiles','government_forms','government_civics','user_empire_profile',
                 'user_empire_civics','user_empire_modifiers')"
        )->fetchColumn());
    }

    public function testGameplayPoliticsSqlRepeatPreservesCustomizedAssignmentsAndHistory(): void
    {
        $runner = $this->gameplayPoliticsRunner();
        $runner->runUp();
        $this->db->exec(
            "UPDATE user_empire_profile SET primary_species_key='lithoid_miners',government_key='martial_command',
                ethic_axis_json=JSON_OBJECT('order_vs_freedom',5) WHERE user_id=710002;
             UPDATE user_empire_civics SET civic_key='industrial_war_machine' WHERE user_id=710002 AND slot_index=1;
             UPDATE user_faction_state SET approval=23.45,support=67.89,issues_json=JSON_ARRAY('retained')
                WHERE user_id=710002 AND faction_key='scientists';
             INSERT INTO situation_states (user_id,colony_id,situation_type,progress) VALUES (710002,1,'retained',37.50);
             INSERT INTO situation_stage_log (situation_id,user_id,old_stage,new_stage)
                SELECT id,user_id,1,2 FROM situation_states;
             INSERT INTO faction_approval_history (user_id,faction_key,approval_before,approval_after)
                VALUES (710002,'scientists',50,23.45);
             INSERT INTO user_empire_modifiers (user_id,source_type,source_key,modifier_key,modifier_value)
                VALUES (710002,'manual','retained','resource_output_mult',0.1234)"
        );
        $tables = ['users', 'colonies', 'user_empire_profile', 'user_empire_civics', 'user_faction_state',
            'situation_states', 'situation_stage_log', 'faction_approval_history', 'user_empire_modifiers'];
        $before = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll();
        }
        foreach (['migrate_gameplay_model_v1.sql', 'migrate_politics_model_v1.sql'] as $name) {
            $this->db->exec($this->readSqlForTestDatabase($name));
        }
        foreach ($tables as $table) {
            $this->assertSame($before[$table], $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll());
        }
        $this->assertSame(2, $this->trackingCount());
    }

    public function testGameplayPoliticsBaselineEffectsAreExplicitAndDoNotSimulate(): void
    {
        $runner = $this->gameplayPoliticsRunner();
        // Different IDs prevent the existing request-local effects cache from masking the transition.
        $before = empire_dynamic_effects($this->db, 710003);
        $this->assertSame(0.0, $before['resource_output_mult']);
        $this->assertSame(0.0, $before['happiness_flat']);
        $runner->runUp();
        $this->db->exec("INSERT INTO users VALUES (710004,'npc_engine',0,NULL)");
        foreach (['migrate_gameplay_model_v1.sql', 'migrate_politics_model_v1.sql'] as $name) {
            $this->db->exec($this->readSqlForTestDatabase($name));
        }
        $colonyBefore = $this->db->query('SELECT * FROM colonies')->fetchAll();
        $effects = empire_dynamic_effects($this->db, 710004);
        foreach ([
            'resource_output_mult' => 0.06, 'food_output_mult' => 0.03, 'pop_growth_mult' => 0.08,
            'research_speed_mult' => 0.06, 'happiness_flat' => 8.0, 'public_services_flat' => 4.0,
            'faction_pressure_mult' => -0.20, 'faction_pressure_score' => 50.0,
            'fleet_readiness_mult' => 0.0, 'unrest_active' => 0.0,
        ] as $key => $value) {
            $this->assertEqualsWithDelta($value, $effects[$key], 0.000000001, $key);
        }
        $this->assertSame($colonyBefore, $this->db->query('SELECT * FROM colonies')->fetchAll());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM situation_states')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM faction_approval_history')->fetchColumn());
    }

    private function legacyV2AdoptionRunner(bool $repairIcon = true): MigrationRunner
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $parser = new MigrationRunner($this->db, $this->sqlDir, 'TEST');
        foreach ($parser->splitStatements($this->readSqlForTestDatabase('migrate_v2.sql')) as $statement) {
            if (str_starts_with($statement, 'CREATE TABLE IF NOT EXISTS trade_proposals')) {
                $this->db->exec($statement);
            }
        }
        $this->db->exec('ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL');
        $this->db->exec($this->readSqlForTestDatabase('migrate_star_spectral_wd_v1.sql'));
        $this->db->exec(
            "INSERT INTO users (id,username,email,password_hash,control_type,auth_enabled)
             VALUES (1,'test-human','human@example.invalid','fixture','human',1),
                    (2,'test-npc','npc@example.invalid','fixture','npc_engine',0);
             INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name)
             VALUES (1,'native-test-planet',1,2,1,'planet','Native');
             INSERT INTO colonies (id,body_id,user_id) VALUES (1,1,2);
             INSERT INTO buildings (colony_id,type,level) VALUES (1,'metal_mine',3);
             INSERT INTO ships (colony_id,type,count) VALUES (1,'light_fighter',7)"
        );
        if ($repairIcon) {
            $this->db->exec($this->readSqlForTestDatabase('migrate_npc_icon_default_v1.sql'));
        } else {
            $this->db->exec("ALTER TABLE npc_factions ALTER COLUMN icon SET DEFAULT 'bad'");
        }
        foreach (['migrate_v2.sql', 'schema_migration_adoptions.sql'] as $name) {
            copy(__DIR__ . '/../../sql/' . $name, $this->sqlDir . '/' . $name);
        }
        file_put_contents($this->sqlDir . '/manifest.php', "<?php return ['migrate_v2.sql'];");
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testLegacyV2AdoptionRecordsFullProofWithoutReplayOrDataMutation(): void
    {
        $runner = $this->legacyV2AdoptionRunner();
        $before = $this->db->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $preview = $runner->adoptLegacyV2History(true);
        $this->assertSame(['migrate_v2.sql'], $preview['adopted']);
        $this->assertSame(27, count($preview['evidence']['tables']));
        $this->assertSame(13, $preview['evidence']['achievement_seed_count']);
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migration_adoptions'"
        )->fetchColumn());
        $result = $runner->adoptLegacyV2History(false);
        $this->assertSame($preview['evidence'], $result['evidence']);
        $this->assertSame($before, $this->db->query('SELECT * FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(7, (int)$this->db->query('SELECT count FROM ships')->fetchColumn());
        $this->assertSame(['adopted'], array_column($runner->getStatus(), 'execution_kind'));
        $this->assertSame(1, $runner->verifyDeployment());
        $this->assertSame([], $runner->adoptLegacyV2History(false)['adopted']);
        $this->assertSame([], $runner->runUp());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='is_npc'"
        )->fetchColumn());
        try {
            $runner->runRollback();
            $this->fail('Legacy V2 adoption must not execute rollback SQL.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('adopted history', $error->getMessage());
        }
    }

    /** @return iterable<string,array{string,string}> */
    public static function invalidLegacyV2AdoptionStates(): iterable
    {
        yield 'missing quest field' => ['ALTER TABLE faction_quests DROP COLUMN generated_timestamp', 'faction_quests.generated_timestamp'];
        yield 'changed quest default' => ['ALTER TABLE faction_quests ALTER COLUMN active SET DEFAULT 0', 'faction_quests.active'];
        yield 'silent JSON default' => ["ALTER TABLE faction_quests MODIFY requirements_json TEXT NOT NULL DEFAULT ('{}')", 'faction_quests.requirements_json'];
        yield 'invalid JSON' => ["UPDATE faction_quests SET requirements_json='invalid' LIMIT 1", 'Syntax error'];
        yield 'non-object JSON' => ["UPDATE faction_quests SET requirements_json='[]' LIMIT 1", 'explicit JSON objects'];
        yield 'missing seed' => ["DELETE FROM achievements WHERE code='combat_first_win'", 'achievement seed'];
        yield 'changed reward' => ["UPDATE achievements SET reward_metal=99 WHERE code='combat_first_win'", 'achievement seed'];
        yield 'retired flag' => ['ALTER TABLE users ADD COLUMN is_npc TINYINT DEFAULT 0', 'actor schema'];
        yield 'legacy backfill input' => ['ALTER TABLE ships ADD COLUMN planet_id INT', 'retired backfill inputs'];
        yield 'orphan ship' => ['SET FOREIGN_KEY_CHECKS=0; UPDATE ships SET colony_id=999; SET FOREIGN_KEY_CHECKS=1', 'orphan reference'];
        yield 'narrowed star type' => ["ALTER TABLE star_systems MODIFY spectral_class ENUM('O','B','A','F','G','K','M') NOT NULL DEFAULT 'G'", 'star_systems.spectral_class'];
        yield 'invisible composite index' => ['ALTER TABLE achievements ALTER INDEX code INVISIBLE', 'visible index'];
        yield 'unique prefix is insufficient' => [
            'ALTER TABLE achievements DROP INDEX code, ADD UNIQUE KEY partial_code(code(63))', 'visible index',
        ];
        yield 'wider uniqueness is insufficient' => [
            'ALTER TABLE user_achievements ADD UNIQUE KEY wider_unique(user_id,achievement_id,progress),
             DROP INDEX unique_user_achievement', 'visible index',
        ];
        yield 'missing foreign key' => [
            'ALTER TABLE trade_proposals DROP FOREIGN KEY trade_proposals_ibfk_1', 'foreign key mismatch',
        ];
        yield 'invalid player quest progress' => [
            "INSERT INTO user_faction_quests (user_id,faction_quest_id,progress_json)
             SELECT 2,id,'[]' FROM faction_quests LIMIT 1", 'explicit JSON objects',
        ];
        yield 'nontransactional table' => ['ALTER TABLE trade_proposals DROP FOREIGN KEY trade_proposals_ibfk_1,
            DROP FOREIGN KEY trade_proposals_ibfk_2; ALTER TABLE trade_proposals ENGINE=MyISAM', 'InnoDB'];
    }

    #[DataProvider('invalidLegacyV2AdoptionStates')]
    public function testLegacyV2AdoptionRejectsSchemaDataAndSeedDriftWithoutHistory(string $mutation, string $message): void
    {
        $runner = $this->legacyV2AdoptionRunner();
        $this->db->exec($mutation);
        try {
            $runner->adoptLegacyV2History(false);
            $this->fail('Invalid Legacy V2 state must reject adoption.');
        } catch (RuntimeException | JsonException $error) {
            $this->assertStringContainsString($message, $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
        $this->assertFalse($this->db->inTransaction());
        $this->assertMigrationLockFree();
    }

    public function testLegacyV2AdoptionRejectsUncorrectedIconDefault(): void
    {
        $runner = $this->legacyV2AdoptionRunner(false);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('correct NPC icon default');
        $runner->adoptLegacyV2History(true);
    }

    public function testLegacyV2AdoptionRejectsChangedSourceBeforeWrites(): void
    {
        $runner = $this->legacyV2AdoptionRunner();
        file_put_contents($this->sqlDir . '/migrate_v2.sql', "\n-- changed\n", FILE_APPEND);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('changed SQL');
        $runner->adoptLegacyV2History(false);
    }

    public function testLegacyV2AdoptionEvidenceAndTrackingRollBackTogether(): void
    {
        $runner = $this->legacyV2AdoptionRunner();
        $this->db->exec(
            "CREATE TRIGGER reject_tracking BEFORE INSERT ON schema_migrations FOR EACH ROW
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected V2 adoption failure'"
        );
        try {
            $runner->adoptLegacyV2History(false);
            $this->fail('Tracking failure must roll back V2 evidence.');
        } catch (PDOException $error) {
            $this->assertStringContainsString('injected V2 adoption failure', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
    }

    public function testLegacyV2AdoptionStatusRejectsDriftedEvidence(): void
    {
        $runner = $this->legacyV2AdoptionRunner();
        $runner->adoptLegacyV2History(false);
        $proof = $this->db->query('SELECT evidence_json FROM schema_migration_adoptions')->fetchColumn();
        $original = json_decode($proof, true, 512, JSON_THROW_ON_ERROR);
        $mutations = [
            ['policy', 'replay-old-sql'], ['descriptor_sha256', str_repeat('0', 64)],
            ['schema_sha256', 'malformed'], ['achievement_seed_count', 12],
            ['tables', []], ['identity_sha256', str_repeat('0', 64)],
        ];
        foreach ($mutations as [$key, $value]) {
            $evidence = $original;
            $evidence[$key] = $value;
            $this->db->prepare('UPDATE schema_migration_adoptions SET evidence_json=?')
                ->execute([json_encode($evidence, JSON_THROW_ON_ERROR)]);
            try {
                $runner->getStatus();
                $this->fail('Drifted V2 evidence must reject status: ' . $key);
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('Legacy V2', $error->getMessage());
            }
        }
        $this->db->prepare('UPDATE schema_migration_adoptions SET evidence_json=?')->execute([$proof]);
        $this->assertSame(1, $runner->verifyDeployment());
    }

    public function testNpcIconDefaultRepairIsRepeatableAndPreservesExistingValues(): void
    {
        $this->db->exec("CREATE TABLE npc_factions (id INT PRIMARY KEY,icon VARCHAR(4) NOT NULL DEFAULT 'bad') ENGINE=InnoDB");
        $this->db->exec("INSERT INTO npc_factions VALUES (1,'old')");
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_npc_icon_default_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($this->readSqlForTestDatabase('migrate_npc_icon_default_v1.sql'));
        $this->db->exec('INSERT INTO npc_factions (id) VALUES (2)');
        $this->assertSame(['6F6C64', 'F09F91BE'], $this->db->query('SELECT HEX(icon) FROM npc_factions ORDER BY id')->fetchAll(PDO::FETCH_COLUMN));
        $this->assertSame(1, $this->trackingCount());
    }

    /** @return array<string, array{bool}> */
    public static function dailyQuestSchemaProvider(): array
    {
        return ['legacy missing columns' => [true], 'current base schema' => [false]];
    }

    #[DataProvider('dailyQuestSchemaProvider')]
    public function testDailyQuestMigrationPreservesCatalogueWithoutActivatingGeneration(bool $legacy): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        if ($legacy) {
            $this->db->exec(
                'ALTER TABLE faction_quests DROP COLUMN active, DROP COLUMN template_code,
                 DROP COLUMN generated_by_npc, DROP COLUMN generated_timestamp'
            );
        }
        $columns = $this->db->query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='faction_quests' ORDER BY ORDINAL_POSITION"
        )->fetchAll(PDO::FETCH_COLUMN);
        $projection = implode(',', array_map(static fn(string $column): string => '`' . $column . '`', $columns));
        $catalogue = $this->db->query('SELECT ' . $projection . ' FROM faction_quests ORDER BY id')
            ->fetchAll(PDO::FETCH_ASSOC);
        $this->assertNotEmpty($catalogue);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_npc_daily_quests_v2.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->db->exec($this->readSqlForTestDatabase('migrate_npc_daily_quests_v2.sql'));
        $this->assertSame($catalogue, $this->db->query(
            'SELECT ' . $projection . ' FROM faction_quests ORDER BY id'
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM faction_quests
             WHERE active<>1 OR generated_by_npc<>0 OR template_code IS NOT NULL OR generated_timestamp IS NOT NULL'
        )->fetchColumn());
        $this->assertSame(4, (int)$this->db->query('SELECT COUNT(*) FROM quest_templates')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM npc_quest_generation_log')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM user_faction_quests')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='is_npc'"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testLegacyBackfillsPreserveOwnershipResourcesAndExistingLinks(): void
    {
        $this->db->exec(
            "CREATE TABLE planets (
                id INT PRIMARY KEY, user_id INT, name VARCHAR(64), metal INT,
                crystal INT, deuterium INT, energy INT, is_homeworld TINYINT,
                last_update DATETIME
             );
             CREATE TABLE colonies (
                id INT AUTO_INCREMENT PRIMARY KEY, planet_id INT UNIQUE, user_id INT,
                name VARCHAR(64), colony_type VARCHAR(20), metal INT, crystal INT,
                deuterium INT, energy INT, is_homeworld TINYINT, last_update DATETIME
             );
             CREATE TABLE buildings (id INT PRIMARY KEY, planet_id INT, colony_id INT);
             CREATE TABLE ships (id INT PRIMARY KEY, planet_id INT, colony_id INT);
             CREATE TABLE fleets (id INT PRIMARY KEY, origin_planet_id INT, origin_colony_id INT);
             INSERT INTO planets VALUES
                (10, 42, 'Legacy home', 1234, 567, 89, 100, 1, '2026-10-01 12:00:00'),
                (11, NULL, 'Unowned', 0, 0, 0, 0, 0, '2026-10-01 12:00:00'),
                (12, 0, 'Unowned zero', 0, 0, 0, 0, 0, '2026-10-01 12:00:00');
             INSERT INTO buildings VALUES (1, 10, NULL), (2, 10, 999);
             INSERT INTO ships VALUES (1, 10, NULL), (2, 10, 999);
             INSERT INTO fleets VALUES (1, 10, NULL), (2, 10, 999);"
        );
        $runner = $this->buildRunner('SELECT 1;');
        $source = file_get_contents(__DIR__ . '/../../sql/migrate_v2.sql');
        $this->assertNotFalse($source);
        $statements = $runner->splitStatements($source);
        $backfills = [];
        foreach ($statements as $index => $statement) {
            if (str_starts_with($statement, 'SET @sql = IF(')
                && (str_contains($statement, "'INSERT IGNORE INTO colonies ")
                    || preg_match("/'UPDATE (buildings|ships|fleets) /", $statement))) {
                $backfills[] = implode(";\n", array_slice($statements, $index, 4)) . ';';
            }
        }
        $this->assertCount(4, $backfills);
        $runner = $this->buildRunner(implode("\n", $backfills));
        $runner->runUp();

        $colony = $this->db->query('SELECT * FROM colonies')->fetch(PDO::FETCH_ASSOC);
        $this->assertIsArray($colony);
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        foreach ([
            'planet_id' => '10', 'user_id' => '42', 'name' => 'Legacy home',
            'colony_type' => 'balanced', 'metal' => '1234', 'crystal' => '567',
            'deuterium' => '89', 'energy' => '100', 'is_homeworld' => '1',
            'last_update' => '2026-10-01 12:00:00',
        ] as $column => $expected) {
            $this->assertSame($expected, (string)$colony[$column]);
        }
        foreach (['buildings' => 'colony_id', 'ships' => 'colony_id', 'fleets' => 'origin_colony_id'] as $table => $column) {
            $this->assertSame((int)$colony['id'], (int)$this->db->query(
                'SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 1'
            )->fetchColumn());
            $this->assertSame(999, (int)$this->db->query(
                'SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 2'
            )->fetchColumn());
        }

        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame($colony, $this->db->query('SELECT * FROM colonies')->fetch(PDO::FETCH_ASSOC));
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
    }

    public function testColonyBuildingsForeignKeysMatchColonyIdsAndCascade(): void
    {
        $this->db->exec('CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_colony_buildings_v1.sql'));
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO colonies VALUES (42);
             INSERT INTO colony_building_slots (id, colony_id, slot_x, slot_y) VALUES (1, 42, 0, 0);
             INSERT INTO colony_building_upgrades (id, slot_id) VALUES (1, 1);"
        );
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_upgrades')->fetchColumn());
        $this->db->exec('UPDATE colonies SET id = 43 WHERE id = 42');
        $this->assertSame(43, (int)$this->db->query('SELECT colony_id FROM colony_building_slots')->fetchColumn());
        $this->db->exec('DELETE FROM colonies WHERE id = 43');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_slots')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_building_upgrades')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    /** @return iterable<string, array{bool}> */
    public static function reportSchemaModes(): iterable
    {
        yield 'current body identities' => [false];
        yield 'legacy colony identities' => [true];
    }

    #[DataProvider('reportSchemaModes')]
    public function testHardcutMapsLegacyReportsAndPreservesExistingBodyIds(bool $legacy): void
    {
        $this->db->exec(
            "CREATE TABLE planets (id INT PRIMARY KEY, galaxy INT, `system` INT, position INT);
             CREATE TABLE celestial_bodies (id BIGINT UNSIGNED PRIMARY KEY, body_uid VARCHAR(64) UNIQUE) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY, planet_id INT, body_id BIGINT UNSIGNED NULL) ENGINE=InnoDB;
             CREATE TABLE battle_reports (id INT PRIMARY KEY, defender_id INT, body_id BIGINT UNSIGNED NULL);
             CREATE TABLE spy_reports (id INT PRIMARY KEY, target_body_id BIGINT UNSIGNED NULL);
             INSERT INTO planets VALUES (10, 1, 2, 3);
             INSERT INTO celestial_bodies VALUES (100, 'legacy-p-1-2-3'), (200, 'other-body');
             INSERT INTO colonies VALUES (42, 10, NULL);
             INSERT INTO battle_reports VALUES (1, 5, NULL), (2, 5, 200);
             INSERT INTO spy_reports VALUES (1, NULL), (2, 200);"
        );
        if ($legacy) {
            $this->db->exec(
                'ALTER TABLE battle_reports ADD planet_id INT;
                 ALTER TABLE spy_reports ADD target_planet_id INT;
                 UPDATE battle_reports SET planet_id = 42;
                 UPDATE spy_reports SET target_planet_id = 42;'
            );
        }
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_unified_bodies_v2_hardcut.sql'));
        $runner->runUp();
        $this->assertSame(100, (int)$this->db->query('SELECT body_id FROM colonies')->fetchColumn());
        foreach (['battle_reports' => 'body_id', 'spy_reports' => 'target_body_id'] as $table => $column) {
            $value = $this->db->query('SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 1')->fetchColumn();
            if ($legacy) {
                $this->assertSame(100, (int)$value);
            } else {
                $this->assertNull($value);
            }
            $this->assertSame(200, (int)$this->db->query(
                'SELECT ' . $column . ' FROM ' . $table . ' WHERE id = 2'
            )->fetchColumn());
        }
        $this->db->exec('DELETE FROM schema_migrations');
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
    }

    public function testHardcutAddsMissingReportBodyColumns(): void
    {
        $this->db->exec(
            'CREATE TABLE planets (id INT PRIMARY KEY, galaxy INT, `system` INT, position INT);
             CREATE TABLE celestial_bodies (id BIGINT UNSIGNED PRIMARY KEY, body_uid VARCHAR(64)) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY, planet_id INT, body_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB;
             CREATE TABLE battle_reports (id INT PRIMARY KEY, defender_id INT);
             CREATE TABLE spy_reports (id INT PRIMARY KEY);'
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_unified_bodies_v2_hardcut.sql'));
        $runner->runUp();
        $this->assertSame(2, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND ((TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'body_id')
               OR (TABLE_NAME = 'spy_reports' AND COLUMN_NAME = 'target_body_id'))"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testCompleteHardcutAppliesToCurrentBaseSchema(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_unified_bodies_v2_hardcut.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND ((TABLE_NAME = 'battle_reports' AND COLUMN_NAME = 'planet_id')
               OR (TABLE_NAME = 'spy_reports' AND COLUMN_NAME = 'target_planet_id'))"
        )->fetchColumn());
        $this->assertSame('NO', $this->db->query(
            "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             AND TABLE_NAME = 'colonies' AND COLUMN_NAME = 'body_id'"
        )->fetchColumn());
    }

    public function testNpcFtlMigrationBootstrapsMembershipBeforeHomeworldMigration(): void
    {
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY, control_type VARCHAR(24), ftl_drive_type VARCHAR(30)) ENGINE=InnoDB;
             CREATE TABLE npc_factions (id INT PRIMARY KEY, code VARCHAR(32)) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB;'
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_vessel_blueprints_v12_npc_ftl.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM npc_faction_memberships')->fetchColumn());
        $this->db->exec($this->readSqlForTestDatabase('migrate_faction_homeworlds_v1.sql'));
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $runner->runUp());
    }

    public function testMarketplaceMigrationResumesPartialColumnsAndPreservesLeaderData(): void
    {
        $this->db->exec(
            "CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             CREATE TABLE leaders (
                id INT PRIMARY KEY, user_id INT,
                role ENUM('colony_manager','fleet_commander','science_director','diplomacy_officer','trade_director') NOT NULL,
                skill_efficiency TINYINT UNSIGNED NOT NULL DEFAULT 1,
                rarity ENUM('common','uncommon','rare','legendary') NOT NULL DEFAULT 'common'
             ) ENGINE=InnoDB;
             INSERT INTO users VALUES (42);
             INSERT INTO leaders VALUES (1, 42, 'colony_manager', 3, 'rare');"
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_marketplace_advisor.sql'));
        $runner->runUp();
        $this->assertSame('rare', $this->db->query('SELECT rarity FROM leaders')->fetchColumn());
        $this->assertSame('👤', $this->db->query('SELECT portrait FROM leaders')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT skill_guidance FROM leaders')->fetchColumn());
        $this->assertSame(8, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leaders'
               AND COLUMN_NAME IN ('rarity','portrait','tagline','backstory','trait_1','trait_2','skill_guidance','marketplace_source_id')"
        )->fetchColumn());
        $this->db->exec(
            "UPDATE leaders SET role = 'advisor', tagline = 'Keep this profile';
             INSERT INTO leader_marketplace (user_id, name, role, backstory, expires_at)
             VALUES (42, 'Advisor', 'advisor', 'History', '2026-12-01');
             INSERT INTO advisor_hints (user_id, leader_id, title, body) VALUES (42, 1, 'Hint', 'Details');"
        );
        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame('Keep this profile', $this->db->query('SELECT tagline FROM leaders')->fetchColumn());
        $this->assertSame('advisor', $this->db->query('SELECT role FROM leaders')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM leader_marketplace')->fetchColumn());
        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM advisor_hints')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testSpeciesMigrationSeparatesEscapedNamesWithNativePrepares(): void
    {
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_faction_species_v1.sql'));
        $runner->runUp();
        $this->assertSame(6, (int)$this->db->query('SELECT COUNT(*) FROM faction_species')->fetchColumn());
        $this->assertSame("Vor'Tak", $this->db->query(
            "SELECT display_name FROM faction_species WHERE species_code = 'vor_tak'"
        )->fetchColumn());
        $this->assertSame("Vel'Ar", $this->db->query(
            "SELECT display_name FROM faction_species WHERE species_code = 'vel_ar'"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testWorldScenarioMigrationRetainsJsonDefaults(): void
    {
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             CREATE TABLE npc_factions (id INT PRIMARY KEY) ENGINE=InnoDB;'
        );
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_world_scenarios_v1.sql'));
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO world_scenarios (code, title_de, description_de) VALUES ('test', 'Title', 'Description')"
        );
        $this->assertSame(
            ['phases_json' => '[]', 'conclusions_json' => '[]', 'effects_json' => '{}'],
            $this->db->query('SELECT phases_json, conclusions_json, effects_json FROM world_scenarios')->fetch(PDO::FETCH_ASSOC)
        );
        $this->assertSame(1, $this->trackingCount());
    }

    public function testUpdateMigrationUsesUserActorsAndPreservesConfiguration(): void
    {
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO users VALUES (42)');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_updates_system_v1.sql'));
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO update_history (operation_type, admin_user_id) VALUES ('check', 42);
             UPDATE update_configuration SET config_value = 'custom-owner', updated_by = 42 WHERE config_key = 'github_owner';"
        );
        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame('custom-owner', $this->db->query(
            "SELECT config_value FROM update_configuration WHERE config_key = 'github_owner'"
        )->fetchColumn());
        $this->assertSame(10, (int)$this->db->query('SELECT COUNT(*) FROM update_configuration')->fetchColumn());
        $this->db->exec('DELETE FROM users WHERE id = 42');
        $this->assertNull($this->db->query('SELECT admin_user_id FROM update_history')->fetchColumn());
        $this->assertNull($this->db->query(
            "SELECT updated_by FROM update_configuration WHERE config_key = 'github_owner'"
        )->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
    }

    public function testCompleteCanonicalManifestAppliesAndSecondRunIsEmpty(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        foreach ($manifest as $file) {
            file_put_contents($this->sqlDir . '/' . $file, $this->readSqlForTestDatabase($file));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        $results = $runner->runUp();
        $this->assertSame($manifest, array_column($results, 'name'));
        $this->assertSame(count($manifest), $this->trackingCount());
        foreach ($runner->getStatus() as $migration) {
            $this->assertSame('applied', $migration['status']);
            $this->assertSame(md5_file($this->sqlDir . '/' . $migration['name']), $migration['checksum']);
            $this->assertSame('TEST', $migration['environment']);
        }
        $this->assertSame(count($manifest), $runner->verifyDeployment());
        require_once __DIR__ . '/../../lib/GalaxySchema.php';
        \GalaxyQuest\Schema\GalaxySchema::assertStars($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertBinaries($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertPlanets($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertAppState($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertFactions($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertGovernments($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertBuildingQueue($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertShipQueue($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertBuiltVessels($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertHomeworldSupport($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertCharacterProfiles($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertSituations($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertWorldScenarios($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertGlossaryCache($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertAlliances($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertAllianceWars($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertLeaderMarketplace($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertLeaderProfiles($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertWormholes($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertWormholeUnlocks($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertProjectionQueue($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertUserProjection($this->db);
        \GalaxyQuest\Schema\GalaxySchema::assertSystemProjection($this->db);
        $this->assertSame([], $runner->runUp());
        $this->assertFalse($this->db->inTransaction());
    }

    private function economyHistoryRunner(): MigrationRunner
    {
        $manifest = [
            'migrate_economy_v1.sql',
            'migrate_economy_v2.sql',
            'migrate_economy_v3.sql',
            'migrate_economy_policies_v1.sql',
            'migrate_economy_shortage_v1.sql',
        ];
        foreach ($manifest as $file) {
            file_put_contents($this->sqlDir . '/' . $file, $this->readSqlForTestDatabase($file));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testEconomyHistoryRepeatPreservesEvolvedMarketsPoliciesAndInventories(): void
    {
        $this->db->exec('SET SESSION information_schema_stats_expiry=0');
        $runner = $this->economyHistoryRunner();
        $this->assertCount(5, $runner->runUp());
        $this->assertSame(23, (int)$this->db->query('SELECT COUNT(*) FROM economy_market_prices')->fetchColumn());
        $this->db->exec(<<<'SQL'
            UPDATE economy_market_prices SET supply=123.4567,demand=7.8901,price_mult=1.2345;
            INSERT INTO economy_market_prices (good_type,supply,demand,price_mult)
                VALUES ('future_good',12,34,2);
            INSERT INTO economy_policies
                (user_id,global_policy,tax_income,tax_production,tax_trade,subsidy_research)
                VALUES (7,'mercantilism',0.2345,0.1234,0.0678,1);
            INSERT INTO economy_processed_goods
                (colony_id,good_type,quantity,capacity,production_rate_per_hour,
                 consumption_rate_per_hour,last_calculated_at)
                VALUES (3,'steel_alloy',234.5678,6789.1234,12.3456,2.3456,'2026-01-02 03:04:05');
            INSERT INTO economy_pop_classes
                (colony_id,pop_class,count,satisfaction_index,employment_level,migration_rate,
                 wage_requirement,last_satisfaction_calc)
                VALUES (3,'citizen',123,61.23,78.90,1.23,111.2345,'2026-01-02 03:04:05');
            SQL);
        $tables = $this->db->query(
            "SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'economy\\_%' ORDER BY TABLE_NAME"
        )->fetchAll(PDO::FETCH_COLUMN);
        $this->assertCount(11, $tables);
        $before = [];
        $definitions = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            $definitions[$table] = preg_replace(
                '/ AUTO_INCREMENT=\d+/',
                '',
                $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM)[1]
            );
        }
        $marketSequence = (int)$this->db->query(
            "SELECT AUTO_INCREMENT FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='economy_market_prices'"
        )->fetchColumn();
        $this->assertSame([], $runner->runUp());
        // Recreate the untracked-history case, then replay the original scripts without settlement.
        $this->db->exec('DELETE FROM schema_migrations');
        $this->assertCount(5, $runner->runUp());
        $this->assertSame(5, $runner->verifyDeployment());
        foreach ($tables as $table) {
            $this->assertSame($before[$table], $this->db->query(
                'SELECT * FROM ' . $table . ' ORDER BY id'
            )->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame($definitions[$table], preg_replace(
                '/ AUTO_INCREMENT=\d+/',
                '',
                $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM)[1]
            ));
        }
        // INSERT IGNORE retains rows but still allocates IDs for its 23 attempted seed inserts.
        $this->assertSame($marketSequence + 23, (int)$this->db->query(
            "SELECT AUTO_INCREMENT FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='economy_market_prices'"
        )->fetchColumn());
        $columns = $this->db->query(
            "SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='economy_policies'"
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        $this->assertSame('varchar(32)', $columns['global_policy']);
        $this->assertSame('decimal(5,4)', $columns['tax_income']);
        $this->assertArrayHasKey('tax_production', $columns);
        $this->assertArrayNotHasKey('tax_resources', $columns);
        $this->assertArrayNotHasKey('happiness_policy_weight', $columns);
        $this->assertFalse($this->db->inTransaction());
    }

    public function testEconomyPolicyStandaloneDefinitionDoesNotDescribeCanonicalReplay(): void
    {
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_economy_policies_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->db->exec('INSERT INTO users VALUES (7); INSERT INTO economy_policies (user_id) VALUES (7)');
        $row = $this->db->query(
            'SELECT global_policy,tax_income,tax_trade,tax_resources,
                    subsidy_agriculture,subsidy_research,subsidy_military,happiness_policy_weight
             FROM economy_policies'
        )->fetch(PDO::FETCH_ASSOC);
        $this->assertSame([50, 20, 15, 10, 5, 10, 3], array_map('intval', array_slice(array_values($row), 0, 7)));
        $this->assertSame(0.5, (float)$row['happiness_policy_weight']);
        $this->assertSame([], $runner->runUp());
        $this->db->exec('DELETE FROM users WHERE id=7');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_policies')->fetchColumn());
    }

    #[DataProvider('economyMarkerGuardCases')]
    public function testEconomyHistoryMarkerGuardsDoNotProveCompleteSiblingColumns(
        string $table,
        string $marker,
        string $sibling
    ): void {
        $runner = $this->economyHistoryRunner();
        $this->assertCount(5, $runner->runUp());
        $this->db->exec('ALTER TABLE ' . $table . ' DROP COLUMN ' . $sibling);
        $this->db->exec('DELETE FROM schema_migrations');
        $this->assertCount(5, $runner->runUp());
        $q = $this->db->prepare(
            'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?'
        );
        $q->execute([$table]);
        $columns = $q->fetchAll(PDO::FETCH_COLUMN);
        $this->assertContains($marker, $columns);
        $this->assertNotContains($sibling, $columns);
        // A successful replay/verify only checks tracked source bytes, not this missing schema postcondition.
        $this->assertSame(5, $runner->verifyDeployment());
    }

    public static function economyMarkerGuardCases(): array
    {
        return [
            'rate sibling missing' => ['economy_processed_goods', 'last_calculated_at', 'consumption_rate_per_hour'],
            'satisfaction sibling missing' => ['economy_pop_classes', 'satisfaction_index', 'employment_level'],
        ];
    }

    public function testEmpireCategoriesHistoryRequiresSeparateEspionageApiReconciliation(): void
    {
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_empire_categories_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        foreach (['empire_category_scores', 'espionage_agents', 'espionage_missions'] as $table) {
            $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn());
        }
        $this->assertSame([], $runner->runUp());
        $this->db->exec('INSERT INTO empire_category_scores (user_id) VALUES (7)');
        $this->assertSame(0, (int)$this->db->query('SELECT total_score FROM empire_category_scores')->fetchColumn());
        $this->assertSame('D', $this->db->query(
            "SELECT COLLATION FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='empire_category_scores' AND INDEX_NAME='idx_ecs_total'"
        )->fetchColumn());
        $columns = $this->db->query(
            "SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='espionage_missions'"
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        $this->assertArrayHasKey('resolves_at', $columns);
        $this->assertArrayNotHasKey('completes_at', $columns);
        $this->assertSame("enum('active','success','failure','captured')", $columns['status']);
        $this->assertStringNotContainsString('military_recon', $columns['mission_type']);
        try {
            // The retired API projection is incompatible with the immutable historical schema.
            $this->db->query('SELECT id,completes_at FROM espionage_missions');
            $this->fail('Historical tables alone must not be declared API-ready.');
        } catch (PDOException $error) {
            $this->assertSame(1054, $error->errorInfo[1]);
        }
        $this->db->exec(
            "INSERT INTO espionage_agents (id,user_id,name,skill_level) VALUES (1,7,'Preserved agent',6);
             INSERT INTO espionage_missions (agent_id,owner_user_id,mission_type,status,resolves_at)
             VALUES (1,7,'gather_intel','success','2026-01-02 03:04:05')"
        );
        $before = [];
        foreach (['empire_category_scores', 'espionage_agents', 'espionage_missions'] as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        }
        $this->db->exec('DELETE FROM schema_migrations');
        $this->assertCount(1, $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        foreach ($before as $table => $rows) {
            $this->assertSame($rows, $this->db->query(
                'SELECT * FROM ' . $table . ' ORDER BY id'
            )->fetchAll(PDO::FETCH_ASSOC));
        }
        $this->assertSame([], $runner->runUp());
    }

    private function economyAdoptionRunner(): MigrationRunner
    {
        $this->db->exec(
            'SET SESSION information_schema_stats_expiry=0;
             CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY,user_id INT NOT NULL,last_update DATETIME,
                 metal DECIMAL(14,4) NOT NULL DEFAULT 0) ENGINE=InnoDB;
             INSERT INTO users VALUES (7);
             INSERT INTO colonies VALUES (3,7,"2026-01-02 03:04:05",987.6543)'
        );
        $setup = $this->economyHistoryRunner();
        $setup->runUp();
        $this->db->exec(<<<'SQL'
            DELETE FROM schema_migrations;
            UPDATE economy_market_prices SET supply=123.4567,demand=7.8901,price_mult=1.2345;
            INSERT INTO economy_market_prices (good_type,supply,demand,price_mult)
                VALUES ('future_good',12,34,2);
            INSERT INTO economy_policies
                (user_id,global_policy,tax_income,tax_production,tax_trade,subsidy_research)
                VALUES (7,'mercantilism',0.2345,0.1234,0.0678,1);
            INSERT INTO economy_processed_goods
                (colony_id,good_type,quantity,production_rate_per_hour,last_calculated_at)
                VALUES (3,'steel_alloy',234.5678,12.3456,'2026-01-02 03:04:05');
            INSERT INTO economy_pop_classes
                (colony_id,pop_class,count,satisfaction_index,last_satisfaction_calc)
                VALUES (3,'citizen',123,61.23,'2026-01-02 03:04:05');
            SQL);
        foreach (
            [
                'migrate_economy_v1.sql', 'migrate_economy_v2.sql', 'migrate_economy_v3.sql',
                'migrate_economy_policies_v1.sql', 'migrate_economy_shortage_v1.sql', 'schema_migration_adoptions.sql',
            ] as $file
        ) {
            copy(__DIR__ . '/../../sql/' . $file, $this->sqlDir . '/' . $file);
        }
        return new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
    }

    public function testEconomyAdoptionPreservesAllRowsSequencesAndRepeatProofWithoutReplay(): void
    {
        $runner = $this->economyAdoptionRunner();
        $tables = $this->db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        $before = [];
        $definitions = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query(
                'SELECT * FROM `' . $table . '` ORDER BY id'
            )->fetchAll(PDO::FETCH_ASSOC);
            $definitions[$table] = $this->db->query('SHOW CREATE TABLE `' . $table . '`')->fetch(PDO::FETCH_NUM)[1];
        }
        $preview = $runner->adoptEconomyHistory(true);
        $this->assertCount(5, $preview['adopted']);
        $this->assertCount(11, $preview['evidence']['tables']);
        $this->assertSame(23, $preview['evidence']['market_seed_count']);
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migration_adoptions'"
        )->fetchColumn());
        $result = $runner->adoptEconomyHistory(false);
        $this->assertSame($preview['adopted'], $result['adopted']);
        $this->assertSame($preview['evidence'], $result['evidence']);
        $this->assertFalse($result['dry_run']);
        foreach ($tables as $table) {
            if ($table === 'schema_migrations') {
                continue;
            }
            $this->assertSame($before[$table], $this->db->query(
                'SELECT * FROM `' . $table . '` ORDER BY id'
            )->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame($definitions[$table], $this->db->query(
                'SHOW CREATE TABLE `' . $table . '`'
            )->fetch(PDO::FETCH_NUM)[1]);
        }
        $tracking = $this->db->query('SELECT * FROM schema_migrations ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $proofs = $this->db->query(
            'SELECT * FROM schema_migration_adoptions ORDER BY migration_name'
        )->fetchAll(PDO::FETCH_ASSOC);
        $this->assertCount(5, $proofs);
        $this->assertSame(['ADOPTED'], array_values(array_unique(array_column($tracking, 'environment'))));
        $this->assertSame(
            ['adopted'],
            array_values(array_unique(array_column($runner->getStatus(), 'execution_kind')))
        );
        $this->assertSame(5, $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        $repeat = $runner->adoptEconomyHistory(false);
        $this->assertSame([], $repeat['adopted']);
        $this->assertSame($preview['evidence'], $repeat['evidence']);
        $this->assertSame($tracking, $this->db->query(
            'SELECT * FROM schema_migrations ORDER BY id'
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($proofs, $this->db->query(
            'SELECT * FROM schema_migration_adoptions ORDER BY migration_name'
        )->fetchAll(PDO::FETCH_ASSOC));
        try {
            $runner->runRollback();
            $this->fail('Economy adoption must not execute rollback SQL.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('adopted history', $error->getMessage());
        }
        $this->assertFalse($this->db->inTransaction());
        $this->assertMigrationLockFree();
    }

    /** @return iterable<string,array{string,string}> */
    public static function invalidEconomyAdoptionStates(): iterable
    {
        yield 'missing rate sibling' => [
            'ALTER TABLE economy_processed_goods DROP COLUMN consumption_rate_per_hour',
            'economy_processed_goods.consumption_rate_per_hour',
        ];
        yield 'missing satisfaction sibling' => [
            'ALTER TABLE economy_pop_classes DROP COLUMN employment_level', 'economy_pop_classes.employment_level',
        ];
        yield 'wrong tax units' => [
            'ALTER TABLE economy_policies MODIFY tax_income INT NOT NULL DEFAULT 20', 'economy_policies.tax_income',
        ];
        yield 'wrong policy type' => [
            "ALTER TABLE economy_policies MODIFY global_policy VARCHAR(64) NOT NULL DEFAULT 'free_market'",
            'economy_policies.global_policy',
        ];
        yield 'narrowed precision' => [
            'ALTER TABLE economy_processed_goods MODIFY quantity DECIMAL(12,2) NOT NULL DEFAULT 0',
            'economy_processed_goods.quantity',
        ];
        yield 'wrong nullability' => [
            'ALTER TABLE economy_processed_goods MODIFY last_calculated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
            'economy_processed_goods.last_calculated_at',
        ];
        yield 'incomplete unique key' => [
            'ALTER TABLE economy_processed_goods DROP INDEX uq_colony_good,
             ADD UNIQUE KEY partial_good(colony_id,good_type(32))', 'visible index',
        ];
        yield 'widened uniqueness' => [
            'ALTER TABLE economy_processed_goods DROP INDEX uq_colony_good,
             ADD UNIQUE KEY wider_good(colony_id,good_type,quantity)', 'visible index',
        ];
        yield 'invisible lookup' => [
            'ALTER TABLE economy_pop_classes ALTER INDEX idx_satisfaction INVISIBLE', 'visible index',
        ];
        yield 'missing market key' => [
            "DELETE FROM economy_market_prices WHERE good_type='food'", 'market seed key: food',
        ];
        yield 'nontransactional log' => ['ALTER TABLE economy_shortage_events ENGINE=MyISAM', 'InnoDB'];
        yield 'unaudited foreign key' => [
            'ALTER TABLE economy_market_transactions ADD CONSTRAINT extra_actor
             FOREIGN KEY (user_id) REFERENCES economy_policies(user_id)', 'unaudited foreign keys',
        ];
    }

    #[DataProvider('invalidEconomyAdoptionStates')]
    public function testEconomyAdoptionRejectsIncompleteOrUnauditedStateWithoutHistory(
        string $mutation,
        string $message
    ): void {
        $runner = $this->economyAdoptionRunner();
        $this->db->exec($mutation);
        try {
            $runner->adoptEconomyHistory(false);
            $this->fail('Invalid Economy state must reject adoption.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString($message, $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
        $this->assertFalse($this->db->inTransaction());
        $this->assertMigrationLockFree();
    }

    public function testEconomyAdoptionRollsBackWholeFiveFileBatchOnTrackingFailureAndCanRetry(): void
    {
        $runner = $this->economyAdoptionRunner();
        $this->db->exec(
            "CREATE TRIGGER fail_economy_tracking BEFORE INSERT ON schema_migrations FOR EACH ROW
             BEGIN IF NEW.migration_name='migrate_economy_v3.sql' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture tracking failure'; END IF; END"
        );
        $before = $runner->adoptEconomyHistory(true)['evidence'];
        try {
            $runner->adoptEconomyHistory(false);
            $this->fail('Tracking failure must abort the complete batch.');
        } catch (PDOException $error) {
            $this->assertStringContainsString('fixture tracking failure', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
        $this->assertFalse($this->db->inTransaction());
        $this->assertMigrationLockFree();
        $this->db->exec('DROP TRIGGER fail_economy_tracking');
        $result = $runner->adoptEconomyHistory(false);
        $this->assertSame($before, $result['evidence']);
        $this->assertCount(5, $result['adopted']);
        $this->assertSame(5, $runner->verifyDeployment());
    }

    public function testEconomyAdoptionRejectsChangedSourceBeforeAnyEvidenceWrites(): void
    {
        $runner = $this->economyAdoptionRunner();
        file_put_contents($this->sqlDir . '/migrate_economy_v2.sql', "\n-- changed\n", FILE_APPEND);
        try {
            $runner->adoptEconomyHistory(false);
            $this->fail('Changed source must not be adopted.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('changed SQL', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migration_adoptions'"
        )->fetchColumn());
    }

    /** @return iterable<string,array{string}> */
    public static function invalidEconomyProofFields(): iterable
    {
        foreach (
            ['policy', 'descriptor_sha256', 'schema_sha256', 'market_seed_count', 'tables', 'identity_sha256'] as $key
        ) {
            yield $key => [$key];
        }
    }

    #[DataProvider('invalidEconomyProofFields')]
    public function testEconomyAdoptionVerificationRejectsCorruptedProof(string $key): void
    {
        $runner = $this->economyAdoptionRunner();
        $result = $runner->adoptEconomyHistory(false);
        $evidence = $result['evidence'];
        $evidence[$key] = $key === 'tables' ? [] : 'invalid';
        $this->db->prepare(
            'UPDATE schema_migration_adoptions SET evidence_json=? WHERE migration_name=?'
        )->execute([json_encode($evidence, JSON_THROW_ON_ERROR), 'migrate_economy_v2.sql']);
        try {
            $runner->getStatus();
            $this->fail('Status must reject corrupt proof.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('evidence', $error->getMessage());
        }
        $this->expectException(RuntimeException::class);
        $runner->runUp();
    }

    public function testEconomyAdoptionPreservesExecutedSubsetAndFutureGameplayMayEvolve(): void
    {
        $runner = $this->economyAdoptionRunner();
        $this->db->prepare(
            'INSERT INTO schema_migrations (migration_name,checksum,environment,execution_ms) VALUES (?,?,?,?)'
        )->execute(['migrate_economy_v1.sql', md5_file($this->sqlDir . '/migrate_economy_v1.sql'), 'TEST', 123]);
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll(PDO::FETCH_ASSOC);
        $result = $runner->adoptEconomyHistory(false);
        $this->assertCount(4, $result['adopted']);
        $this->assertSame($before, $this->db->query(
            "SELECT * FROM schema_migrations WHERE migration_name='migrate_economy_v1.sql'"
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->db->exec('UPDATE economy_market_prices SET demand=demand+1');
        $this->assertSame(5, $runner->verifyDeployment());
        $repeat = $runner->adoptEconomyHistory(true);
        $this->assertSame([], $repeat['adopted']);
        $this->assertNotSame($result['evidence']['identity_sha256'], $repeat['evidence']['identity_sha256']);
    }

    private function authAdoptionRunner(): MigrationRunner
    {
        $this->db->exec('ALTER DATABASE `' . $this->database . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        $this->db->exec(
            "CREATE TABLE users (id INT PRIMARY KEY,ftl_cooldown_until DATETIME NULL,last_npc_tick DATETIME NULL,
                is_admin TINYINT NOT NULL DEFAULT 0,control_type VARCHAR(32) NOT NULL DEFAULT 'human',
                auth_enabled TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
             INSERT INTO users (id) VALUES (7);
             INSERT INTO users (id,control_type,auth_enabled) VALUES (8,'npc_engine',0)"
        );
        $manifest = ['migrate_security_v1.sql', 'migrate_security_v2_totp.sql', 'migrate_admin_user_crud_v1.sql'];
        $parser = new MigrationRunner($this->db, $this->sqlDir);
        foreach ($manifest as $file) {
            copy(__DIR__ . '/../../sql/' . $file, $this->sqlDir . '/' . $file);
            foreach ($parser->splitStatements($this->readSqlForTestDatabase($file)) as $sql) {
                $this->db->exec($sql);
            }
        }
        copy(__DIR__ . '/../../sql/schema_migration_adoptions.sql', $this->sqlDir . '/schema_migration_adoptions.sql');
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        $this->db->exec(
            "UPDATE users SET totp_enabled=1,totp_secret='synthetic-test-material',
                totp_pending_secret='synthetic-pending-material',deleted_at='2026-01-02 03:04:05',deleted_by=8
                WHERE id=7"
        );
        $this->db->prepare(
            "INSERT INTO login_attempts (ip_hash,attempt_count,locked_until) VALUES (?,7,'2030-01-01 00:00:00')"
        )->execute([str_repeat('a', 64)]);
        $this->db->prepare(
            "INSERT INTO totp_pending_sessions (token,user_id,expires_at,attempts,remember_me)
             VALUES (?,7,'2030-01-01 00:00:00',3,1)"
        )->execute([str_repeat('b', 64)]);
        return $runner;
    }

    public function testAuthAdoptionPreservesAccountsAuthMaterialAndLockoutsWithoutReplay(): void
    {
        $runner = $this->authAdoptionRunner();
        $before = [];
        foreach (['users', 'login_attempts', 'totp_pending_sessions'] as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
        }
        $preview = $runner->adoptAuthHistory(true);
        $this->assertCount(3, $preview['adopted']);
        $this->assertSame(0, $this->trackingCount());
        $result = $runner->adoptAuthHistory(false);
        $this->assertSame($preview['evidence'], $result['evidence']);
        $this->assertStringNotContainsString('synthetic-test-material', json_encode($result['evidence']));
        foreach ($before as $table => $rows) {
            $this->assertSame($rows, $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
        }
        $this->assertSame(3, $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        $proofs = $this->db->query('SELECT * FROM schema_migration_adoptions ORDER BY migration_name')->fetchAll();
        $this->assertSame([], $runner->adoptAuthHistory(false)['adopted']);
        $this->assertSame($proofs, $this->db->query(
            'SELECT * FROM schema_migration_adoptions ORDER BY migration_name'
        )->fetchAll());
        $this->assertSame(
            ['adopted'],
            array_values(array_unique(array_column($runner->getStatus(), 'execution_kind')))
        );
        try {
            $runner->runRollback();
            $this->fail('Adopted auth history must not run down SQL.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('adopted history', $error->getMessage());
        }
        $this->assertFalse($this->db->inTransaction());
        $this->assertMigrationLockFree();
    }

    /** @return iterable<string,array{string,string}> */
    public static function invalidAuthAdoptionStates(): iterable
    {
        yield 'missing soft-delete index behind marker' => [
            'ALTER TABLE users DROP INDEX idx_users_deleted', 'visible index',
        ];
        yield 'missing setup field' => [
            'ALTER TABLE users DROP COLUMN totp_pending_secret', 'users.totp_pending_secret',
        ];
        yield 'wrong TOTP flag default' => [
            'ALTER TABLE users ALTER COLUMN totp_enabled SET DEFAULT 1', 'users.totp_enabled',
        ];
        yield 'missing remember choice' => [
            'ALTER TABLE totp_pending_sessions DROP COLUMN remember_me', 'totp_pending_sessions.remember_me',
        ];
        yield 'short token key' => [
            'ALTER TABLE totp_pending_sessions DROP PRIMARY KEY, ADD UNIQUE KEY partial_token(token(32))',
            'visible index',
        ];
        yield 'invisible lockout lookup' => [
            'ALTER TABLE login_attempts ALTER INDEX idx_locked_until INVISIBLE', 'visible index',
        ];
        yield 'changed FK rule' => [
            'ALTER TABLE totp_pending_sessions DROP FOREIGN KEY totp_pending_sessions_ibfk_1,
             ADD CONSTRAINT alternate_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT',
            'foreign key mismatch',
        ];
        yield 'missing pending FK' => [
            'ALTER TABLE totp_pending_sessions DROP FOREIGN KEY totp_pending_sessions_ibfk_1', 'foreign key mismatch',
        ];
        yield 'orphan pending session' => [
            'SET FOREIGN_KEY_CHECKS=0; UPDATE totp_pending_sessions SET user_id=999; SET FOREIGN_KEY_CHECKS=1',
            'orphan TOTP',
        ];
        yield 'nontransactional lockout' => ['ALTER TABLE login_attempts ENGINE=MyISAM', 'InnoDB'];
    }

    #[DataProvider('invalidAuthAdoptionStates')]
    public function testAuthAdoptionRejectsIncompletePostconditionsWithoutHistory(string $sql, string $message): void
    {
        $runner = $this->authAdoptionRunner();
        $this->db->exec($sql);
        try {
            $runner->adoptAuthHistory(false);
            $this->fail('Incomplete auth schema must reject adoption.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString($message, $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
        $this->assertFalse($this->db->inTransaction());
        $this->assertMigrationLockFree();
    }

    public function testAuthAdoptionWholeBatchRollsBackAndRetryPreservesEarlierExecutedRecord(): void
    {
        $runner = $this->authAdoptionRunner();
        $this->db->prepare(
            'INSERT INTO schema_migrations (migration_name,checksum,environment,execution_ms) VALUES (?,?,?,?)'
        )->execute(['migrate_security_v1.sql', md5_file($this->sqlDir . '/migrate_security_v1.sql'), 'TEST', 123]);
        $before = $this->db->query('SELECT * FROM schema_migrations')->fetchAll();
        $this->db->exec(
            "CREATE TRIGGER fail_auth_tracking BEFORE INSERT ON schema_migrations FOR EACH ROW BEGIN
             IF NEW.migration_name='migrate_admin_user_crud_v1.sql' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='auth fixture write failure'; END IF; END"
        );
        try {
            $runner->adoptAuthHistory(false);
            $this->fail('Tracking failure must abort both new auth pairs.');
        } catch (PDOException $error) {
            $this->assertStringContainsString('auth fixture write failure', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM schema_migrations')->fetchAll());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM schema_migration_adoptions')->fetchColumn());
        $this->db->exec('DROP TRIGGER fail_auth_tracking');
        $this->assertCount(2, $runner->adoptAuthHistory(false)['adopted']);
        $this->assertSame($before, $this->db->query(
            "SELECT * FROM schema_migrations WHERE migration_name='migrate_security_v1.sql'"
        )->fetchAll());
        $this->assertSame(3, $runner->verifyDeployment());
    }

    public function testAuthAdoptionRejectsChangedSourceAndCorruptProof(): void
    {
        $runner = $this->authAdoptionRunner();
        $file = $this->sqlDir . '/migrate_security_v1.sql';
        $original = file_get_contents($file);
        file_put_contents($file, $original . "\n-- modified");
        try {
            $runner->adoptAuthHistory(false);
            $this->fail('Changed SQL must reject adoption.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('changed SQL', $error->getMessage());
        }
        $this->assertSame(0, $this->trackingCount());
        file_put_contents($file, $original);
        $runner->adoptAuthHistory(false);
        $this->db->exec(
            "UPDATE schema_migration_adoptions SET evidence_json=JSON_SET(evidence_json,'$.policy','wrong')"
        );
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('evidence');
        $runner->getStatus();
    }

    public function testRbacInfrastructureSeedsNoAccountRolesAndRepeatPreservesAssignments(): void
    {
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY,is_admin TINYINT NOT NULL DEFAULT 0) ENGINE=InnoDB;
            INSERT INTO users VALUES (7,0),(8,1)');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_rbac_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        foreach (
            ['rbac_groups' => 5, 'rbac_profiles' => 6, 'rbac_group_profiles' => 5, 'rbac_user_groups' => 0] as $t => $c
        ) {
            $this->assertSame($c, (int)$this->db->query('SELECT COUNT(*) FROM ' . $t)->fetchColumn());
        }
        $this->assertSame([0, 1], array_map('intval', $this->db->query(
            'SELECT is_admin FROM users ORDER BY id'
        )->fetchAll(PDO::FETCH_COLUMN)));
        $parents = $this->db->query(
            'SELECT p.profile_key,parent.profile_key FROM rbac_profiles p
             LEFT JOIN rbac_profiles parent ON parent.id=p.parent_profile_id ORDER BY p.profile_key'
        )->fetchAll(PDO::FETCH_KEY_PAIR);
        $this->assertSame(['admin' => 'user', 'base' => null, 'guest' => 'base',
            'root' => 'admin', 'service' => 'base', 'user' => 'base'], $parents);
        $this->db->exec(
            "INSERT INTO rbac_user_groups (user_id,group_id,assigned_by,assigned_reason)
             SELECT 7,id,8,'fixture approved assignment' FROM rbac_groups WHERE group_key='users';
             UPDATE rbac_profiles SET profile_json=JSON_OBJECT('custom',true) WHERE profile_key='user'"
        );
        $assigned = $this->db->query('SELECT * FROM rbac_user_groups')->fetchAll();
        $this->db->exec('DELETE FROM schema_migrations');
        $this->assertCount(1, $runner->runUp());
        $this->assertSame($assigned, $this->db->query('SELECT * FROM rbac_user_groups')->fetchAll());
        $profile = json_decode($this->db->query(
            "SELECT profile_json FROM rbac_profiles WHERE profile_key='user'"
        )->fetchColumn(), true, 512, JSON_THROW_ON_ERROR);
        ksort($profile);
        $this->assertSame(['can_admin' => false, 'can_login' => true, 'ui_scope' => 'player'], $profile);
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        $this->db->exec('DELETE FROM users WHERE id=8');
        $this->assertNull($this->db->query('SELECT assigned_by FROM rbac_user_groups')->fetchColumn());
        $this->db->exec('DELETE FROM users WHERE id=7');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM rbac_user_groups')->fetchColumn());
    }

    public function testAuthAdoptionRejectsMalformedSnapshotProofAndAllowsFutureAccountChanges(): void
    {
        $runner = $this->authAdoptionRunner();
        $evidence = $runner->adoptAuthHistory(false)['evidence'];
        foreach (['descriptor_sha256', 'schema_sha256', 'identity_sha256', 'tables'] as $field) {
            $corrupt = $evidence;
            $corrupt[$field] = $field === 'tables' ? [] : 'invalid';
            try {
                \GalaxyQuest\Migrations\AuthMigrationAdoption::validateEvidence($corrupt);
                $this->fail('Corrupt auth proof field must reject: ' . $field);
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('evidence', $error->getMessage());
            }
        }
        $corrupt = $evidence;
        $corrupt['tables']['users']['count'] = -1;
        try {
            \GalaxyQuest\Migrations\AuthMigrationAdoption::validateEvidence($corrupt);
            $this->fail('Negative snapshot count must reject.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('snapshot evidence', $error->getMessage());
        }
        $this->db->exec('UPDATE login_attempts SET attempt_count=attempt_count+1');
        $this->assertSame(3, $runner->verifyDeployment());
        $repeat = $runner->adoptAuthHistory(true);
        $this->assertSame([], $repeat['adopted']);
        $this->assertNotSame($evidence['identity_sha256'], $repeat['evidence']['identity_sha256']);
    }

    private function colonizationHistoryRunner(): MigrationRunner
    {
        $this->db->exec(
            "CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             CREATE TABLE star_systems (id INT PRIMARY KEY,galaxy_index INT,system_index INT) ENGINE=InnoDB;
             CREATE TABLE celestial_bodies (id BIGINT UNSIGNED PRIMARY KEY,galaxy_index INT,system_index INT)
                ENGINE=InnoDB;
             CREATE TABLE colonies (id INT PRIMARY KEY,user_id INT NOT NULL,body_id BIGINT UNSIGNED NOT NULL,
                population INT NOT NULL,metal DECIMAL(14,4) NOT NULL DEFAULT 123.4567,
                last_update DATETIME NOT NULL DEFAULT '2026-01-02 03:04:05') ENGINE=InnoDB;
             CREATE TABLE fleets (id INT PRIMARY KEY,user_id INT,ships_json JSON,`returning` TINYINT DEFAULT 0)
                ENGINE=InnoDB;
             INSERT INTO users VALUES (7);
             INSERT INTO star_systems VALUES (101,1,1),(201,2,1);
             INSERT INTO celestial_bodies VALUES (11,1,1),(21,2,1),(22,2,1)"
        );
        $manifest = ['migrate_colonization_v1.sql', 'migrate_colonization_v2.sql'];
        foreach ($manifest as $file) {
            file_put_contents($this->sqlDir . '/' . $file, $this->readSqlForTestDatabase($file));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testColonizationHistoryInitializesExactPhaseBoundariesAndPreservesNativeStocks(): void
    {
        $runner = $this->colonizationHistoryRunner();
        $populations = [0, 500, 501, 2000, 2001, 10000, 10001, 50000, 50001];
        foreach ($populations as $index => $population) {
            $this->db->prepare('INSERT INTO colonies (id,user_id,body_id,population) VALUES (?,7,11,?)')
                ->execute([$index + 1, $population]);
        }
        $columns = 'id,user_id,body_id,population,metal,last_update';
        $before = $this->db->query('SELECT ' . $columns . ' FROM colonies ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $this->assertCount(2, $runner->runUp());
        $this->assertSame([0, 0, 1, 1, 2, 2, 3, 3, 4], array_map('intval', $this->db->query(
            'SELECT phase FROM colonies ORDER BY id'
        )->fetchAll(PDO::FETCH_COLUMN)));
        $this->assertSame($before, $this->db->query(
            'SELECT ' . $columns . ' FROM colonies ORDER BY id'
        )->fetchAll(PDO::FETCH_ASSOC));
        foreach (['sectors', 'sector_systems', 'governors', 'empire_edicts', 'empire_sprawl_cache'] as $table) {
            $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn());
        }
        $this->assertSame(0, (int)$this->db->query('SELECT SUM(energy_balance) FROM colonies')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM colonies WHERE sector_id IS NOT NULL'
        )->fetchColumn());
        $this->assertSame(2, $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        try {
            $this->db->exec($this->readSqlForTestDatabase('migrate_colonization_v2.sql'));
            $this->fail('Raw V2 replay must not be mistaken for idempotent tracked Up.');
        } catch (PDOException $error) {
            $this->assertStringContainsString('Duplicate foreign key constraint name', $error->getMessage());
        }
    }

    public function testColonizationNativeSprawlReadsDoNotPersistOrActivateEdicts(): void
    {
        require_once __DIR__ . '/../../lib/ColonizationEngine.php';
        $runner = $this->colonizationHistoryRunner();
        $runner->runUp();
        $this->db->exec(
            "INSERT INTO colonies (id,user_id,body_id,population) VALUES (1,7,11,100),(2,7,21,100),(3,7,22,100)"
        );
        $this->db->exec('SET SESSION TRANSACTION READ ONLY');
        $this->db->beginTransaction();
        try {
            $result = ColonizationEngine::calculateSprawl($this->db, 7);
            $this->assertSame(3.5, $result['sprawl_value']);
            $this->assertSame(50, $result['admin_cap']);
            $this->assertSame(7, $result['sprawl_pct']);
            $edicts = ColonizationEngine::listEdicts($this->db, 7);
            $this->assertCount(6, $edicts);
            $this->assertSame([false], array_values(array_unique(array_column($edicts, 'active'))));
            foreach (['sectors', 'governors', 'empire_edicts', 'empire_sprawl_cache'] as $table) {
                $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn());
            }
        } finally {
            $this->db->rollBack();
            $this->db->exec('SET SESSION TRANSACTION READ WRITE');
        }
    }

    public function testOnDemandEconomyUsesCanonicalMySqlSchemaAndNativePrepares(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $manifest = require __DIR__ . '/../../config/migrations_manifest.php';
        foreach ($manifest as $file) {
            file_put_contents($this->sqlDir . '/' . $file, $this->readSqlForTestDatabase($file));
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($manifest, true) . ';');
        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        $runner->runUp();
        $this->db->exec(<<<'SQL'
            INSERT INTO users (id,username,email,password_hash,credits)
                VALUES (42,'economic_test','economy@example.invalid','not-a-password',100000);
            INSERT INTO planets (id,galaxy,`system`,position) VALUES (42,1,1,1);
            INSERT INTO celestial_bodies (id,body_uid,galaxy_index,system_index,position,body_type,name)
                VALUES (42,'economy-test-body',1,1,1,'planet','Economic test');
            INSERT INTO colonies (id,user_id,body_id,planet_id,metal,crystal,deuterium,food)
                VALUES (42,42,42,42,10000,10000,10000,500);
            INSERT INTO buildings (colony_id,type,level) VALUES
                (42,'solar_plant',10),(42,'metal_mine',1),(42,'hydroponic_farm',1),
                (42,'habitat',1),(42,'hospital',1);
            INSERT INTO research (user_id,type,level) VALUES (42,'energy_tech',1);
            SQL);
        $economy = new OnDemandEconomy($this->db);
        $now = time();
        $snapshot = $economy->settle(42, 42, $now - 3600);
        $this->assertSame(100, array_sum($snapshot['pop_classes']));
        $snapshot = $economy->settle(42, 42, $now);
        $this->assertSame($now, $snapshot['economy']['settled_at']);
        $this->assertGreaterThan(0, $snapshot['economy']['production']['metal']);
        $economy->configure(42, 'tax_income', 0.2);
        $economy->configure(42, 'subsidy_agriculture', true);
        $economy->method(42, 42, 'metallurgy', 'efficient');
        $queue = $economy->queue(42, 42, 'metallurgy', [1, 1]);
        $this->assertSame(1, $queue['target_level']);
        $this->assertGreaterThan(0, $queue['cost']['metal']);
        $before = (float)$this->db->query('SELECT food FROM colonies WHERE id=42')->fetchColumn();
        $economy->exchange(42, 42, 'food', 10, true);
        $this->assertEqualsWithDelta(
            $before + 10,
            (float)$this->db->query('SELECT food FROM colonies WHERE id=42')->fetchColumn(),
            0.1
        );
        $this->assertSame(1, $economy->market(1, 1)['goods']['food']['represented_colonies']);
        $this->assertFalse($this->db->inTransaction());
        $other = $this->secondConnection();
        $other->exec('SET SESSION innodb_lock_wait_timeout=1');
        $this->db->beginTransaction();
        $this->db->query('SELECT id FROM users WHERE id=42 FOR UPDATE')->fetch();
        try {
            (new OnDemandEconomy($other))->exchange(42, 42, 'food', 1, true);
            $this->fail('A concurrent order must not bypass the account lock.');
        } catch (PDOException $error) {
            $this->assertSame(1205, (int)$error->errorInfo[1]);
            $this->assertFalse($other->inTransaction());
        } finally {
            $this->db->rollBack();
        }
        (new OnDemandEconomy($other))->exchange(42, 42, 'food', 1, true);
        $this->assertFalse($other->inTransaction());
        $this->db->exec('DELETE FROM colonies WHERE id=42');
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM colony_economy_state')->fetchColumn());
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM economy_colony_market')->fetchColumn());
    }

    /** @return array{exit:int, output:string, errors:string} */
    private function runProjector(string $worker, string $username, string $password, array $arguments = []): array
    {
        $output = tmpfile();
        $errors = tmpfile();
        $this->assertIsResource($output);
        $this->assertIsResource($errors);
        $dsn = (string) getenv('GQ_MIGRATION_TEST_DSN');
        preg_match('/(?:^|[:;])host=([^;]+)/', $dsn, $hostMatch);
        preg_match('/(?:^|;)port=([^;]+)/', $dsn, $portMatch);
        $environment = array_merge(getenv(), [
            'DB_HOST' => $hostMatch[1] ?? '127.0.0.1', 'DB_PORT' => $portMatch[1] ?? '3306',
            'DB_NAME' => $this->database,
            'DB_USER' => $username, 'DB_PASS' => $password, 'XDEBUG_MODE' => 'off',
        ]);
        try {
            $process = proc_open(
                [PHP_BINARY, __DIR__ . '/../../scripts/' . $worker . '.php', ...$arguments],
                [0 => ['pipe', 'r'], 1 => $output, 2 => $errors],
                $pipes,
                dirname(__DIR__, 2),
                $environment
            );
            $this->assertIsResource($process);
            fclose($pipes[0]);
            $exit = proc_close($process);
            rewind($output);
            rewind($errors);
            return ['exit' => $exit, 'output' => stream_get_contents($output), 'errors' => stream_get_contents($errors)];
        } finally {
            fclose($output);
            fclose($errors);
        }
    }

    public function testProjectorCommandsPreflightBeforeClaimAndDryRunsAreReadOnly(): void
    {
        require_once __DIR__ . '/../../lib/GalaxySchema.php';
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_user_overview_v1.sql'));
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_system_snapshot_v1.sql'));
        $runner = $this->buildRunner(
            $this->readSqlForTestDatabase('migrate_projection_runtime_v2.sql') . "\n" .
            $this->readSqlForTestDatabase('migrate_projection_claim_token_v1.sql')
        );
        $this->assertCount(1, $runner->runUp());
        $this->db->exec("INSERT INTO projection_dirty_queue (entity_type,entity_id,reason)
            VALUES ('user',7,'retained'),('user',8,'retained'),('system',100001,'retained'),('system',100002,'retained');
            INSERT INTO projection_user_overview (user_id,payload_json,version) VALUES (7,'{\"retained\":true}',8);
            INSERT INTO projection_system_snapshot (galaxy,system_index,payload_json,version)
                VALUES (1,1,'{\"retained\":true}',9)");
        $tables = ['projection_dirty_queue', 'projection_user_overview', 'projection_system_snapshot'];
        $before = [];
        $definitions = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
            $definitions[$table] = $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM);
        }
        $username = 'gq_projector_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $reader = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $reader->exec('USE `' . $this->database . '`');
            $reader->beginTransaction();
            \GalaxyQuest\Schema\GalaxySchema::assertProjectionQueue($reader);
            \GalaxyQuest\Schema\GalaxySchema::assertUserProjection($reader);
            \GalaxyQuest\Schema\GalaxySchema::assertSystemProjection($reader);
            \GalaxyQuest\Schema\GalaxySchema::assertProjectionTransactions($reader, 'projection_user_overview');
            \GalaxyQuest\Schema\GalaxySchema::assertProjectionTransactions($reader, 'projection_system_snapshot');
            $this->assertTrue($reader->inTransaction());
            $reader->rollBack();
            foreach (['project_user_overview', 'project_system_snapshots'] as $worker) {
                $invalid = $this->runProjector($worker, $username, $password, ['--dryrun']);
                $this->assertSame(1, $invalid['exit'], $invalid['errors']);
                $this->assertStringContainsString('invalid projection argument', $invalid['errors']);
                $this->assertStringNotContainsString('start ', $invalid['errors']);
                $result = $this->runProjector($worker, $username, $password, ['--dry-run', '--batch=50', '--max-items=1']);
                $this->assertSame(0, $result['exit'], $result['errors']);
                $this->assertStringContainsString('batch_size=50', $result['errors']);
                $this->assertStringContainsString('dry_run', $result['errors']);
                $this->assertStringContainsString('processed=1', $result['errors']);
            }
            foreach ($tables as $table) {
                $this->assertSame($before[$table], $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
                $this->assertSame($definitions[$table], $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM));
            }
            $this->admin->exec('GRANT UPDATE, DELETE ON `' . $this->database . '`.projection_dirty_queue TO ' . $account);
            foreach ($tables as $table) {
                $this->db->exec('ALTER TABLE ' . $table . ' ENGINE=MyISAM');
                $worker = $table === 'projection_system_snapshot' ? 'project_system_snapshots' : 'project_user_overview';
                $result = $this->runProjector($worker, $username, $password);
                $this->assertSame(1, $result['exit'], $result['errors']);
                $this->assertStringContainsString($table . ' must use InnoDB', $result['errors']);
                $this->assertSame($before['projection_dirty_queue'],
                    $this->db->query('SELECT * FROM projection_dirty_queue')->fetchAll(PDO::FETCH_ASSOC));
                $this->db->exec('ALTER TABLE ' . $table . ' ENGINE=InnoDB');
            }
            $result = $this->runProjector('project_user_overview', $username, $password, ['--batch=2', '--max-items=1']);
            $this->assertSame(2, $result['exit'], $result['errors']);
            $this->assertStringContainsString('errors=1', $result['errors']);
            $this->assertSame(1, (int) $this->db->query("SELECT SUM(attempts) FROM projection_dirty_queue WHERE entity_type='user'")->fetchColumn());
            $this->assertSame(0, (int) $this->db->query("SELECT COUNT(*) FROM projection_dirty_queue WHERE status='processing'")->fetchColumn());
            $this->assertSame($before['projection_user_overview'], $this->db->query('SELECT * FROM projection_user_overview')->fetchAll(PDO::FETCH_ASSOC));
            $before['projection_dirty_queue'] = $this->db->query('SELECT * FROM projection_dirty_queue')->fetchAll(PDO::FETCH_ASSOC);
            $this->db->exec('DROP TABLE projection_user_overview; DROP TABLE projection_system_snapshot');
            foreach (['project_user_overview', 'project_system_snapshots'] as $worker) {
                $result = $this->runProjector($worker, $username, $password);
                $this->assertSame(1, $result['exit'], $result['errors']);
                $this->assertStringContainsString('FATAL:', $result['errors']);
                $this->assertStringNotContainsString('finish ', $result['errors']);
                $this->assertStringNotContainsString('claim_batch failed', $result['errors']);
            }
            $this->assertSame($before['projection_dirty_queue'], $this->db->query('SELECT * FROM projection_dirty_queue')->fetchAll(PDO::FETCH_ASSOC));
            $this->db->exec($this->readSqlForTestDatabase('migrate_projection_user_overview_v1.sql'));
            $this->db->exec($this->readSqlForTestDatabase('migrate_projection_system_snapshot_v1.sql'));
            $this->db->exec('ALTER TABLE projection_dirty_queue DROP COLUMN status');
            foreach (['project_user_overview', 'project_system_snapshots'] as $worker) {
                $result = $this->runProjector($worker, $username, $password, ['--dry-run']);
                $this->assertSame(1, $result['exit'], $result['errors']);
                $this->assertStringContainsString('projection_dirty_queue.status', $result['errors']);
            }
            $this->assertSame(4, (int) $this->db->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());
        } finally {
            if (isset($reader) && $reader->inTransaction()) {
                $reader->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testSystemProjectorUsesCanonicalKeysAndRetriesFailedWrites(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_user_overview_v1.sql'));
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_system_snapshot_v1.sql'));
        $runner = $this->buildRunner(
            $this->readSqlForTestDatabase('migrate_projection_runtime_v2.sql') . "\n" .
            $this->readSqlForTestDatabase('migrate_projection_claim_token_v1.sql')
        );
        $this->assertCount(1, $runner->runUp());
        $this->db->exec("CREATE TABLE star_systems (id INT PRIMARY KEY, galaxy_index INT, system_index INT,
                name VARCHAR(64),catalog_name VARCHAR(64),spectral_class VARCHAR(8),subtype INT,
                x_ly DOUBLE,y_ly DOUBLE,z_ly DOUBLE,planet_count INT,hz_inner_au DOUBLE,hz_outer_au DOUBLE);
            INSERT INTO star_systems VALUES (77,1,120,'Test','Retained Star','G',2,1,2,3,4,0.9,1.4);
            CREATE TABLE users (id INT PRIMARY KEY,username VARCHAR(64),empire_color VARCHAR(16));
            INSERT INTO users VALUES (7,'Owner','#123456');
            CREATE TABLE celestial_bodies (id INT PRIMARY KEY,galaxy_index INT,system_index INT);
            INSERT INTO celestial_bodies VALUES (1,1,120);
            CREATE TABLE colonies (id INT PRIMARY KEY,body_id INT,user_id INT,population BIGINT);
            INSERT INTO colonies VALUES (1,1,7,500);
            INSERT INTO projection_dirty_queue (entity_type,entity_id) VALUES ('system',100120),('system',100121)");
        $username = 'gq_projector_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT, INSERT, UPDATE, DELETE ON `' . $this->database . '`.* TO ' . $account);
            $result = $this->runProjector('project_system_snapshots', $username, $password, ['--batch=2', '--max-items=1']);
            $this->assertSame(0, $result['exit'], $result['errors']);
            $this->assertStringContainsString('processed=1', $result['errors']);
            $this->assertSame('queued', $this->db->query('SELECT status FROM projection_dirty_queue')->fetchColumn());
            $snapshot = $this->db->query('SELECT * FROM projection_system_snapshot')->fetch(PDO::FETCH_ASSOC);
            $this->assertSame(1, (int) $snapshot['galaxy']);
            $this->assertSame(120, (int) $snapshot['system_index']);
            $this->assertSame(7, (int) $snapshot['owner_user_id']);
            $this->assertSame(500, (int) $snapshot['colony_population']);
            $this->assertSame(1, (int) $snapshot['version']);
            $payload = json_decode($snapshot['payload_json'], true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('Retained Star', $payload['catalog_name']);
            $this->assertSame('#123456', $payload['colony_owner_color']);
            $result = $this->runProjector('project_system_snapshots', $username, $password);
            $this->assertSame(0, $result['exit'], $result['errors']);
            $this->assertStringContainsString('star_not_ready', $result['errors']);
            $this->assertSame(0, (int) $this->db->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());
            $this->db->exec("INSERT INTO projection_dirty_queue (entity_type,entity_id) VALUES ('system',100120);
                UPDATE projection_system_snapshot SET stale_flag=1");
            $this->admin->exec('REVOKE INSERT, UPDATE, DELETE ON `' . $this->database . '`.* FROM ' . $account);
            $this->admin->exec('GRANT INSERT, UPDATE, DELETE ON `' . $this->database . '`.projection_dirty_queue TO ' . $account);
            $result = $this->runProjector('project_system_snapshots', $username, $password);
            $this->assertSame(2, $result['exit'], $result['errors']);
            $this->assertStringContainsString('errors=1', $result['errors']);
            $queue = $this->db->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
            $this->assertSame('queued', $queue['status']);
            $this->assertSame(1, (int) $queue['attempts']);
            $this->assertStringContainsString('denied', $queue['last_error']);
            $this->assertSame(1, (int) $this->db->query('SELECT version FROM projection_system_snapshot')->fetchColumn());
            $this->assertSame(1, (int) $this->db->query('SELECT stale_flag FROM projection_system_snapshot')->fetchColumn());
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.projection_system_snapshot TO ' . $account);
            $this->db->exec('UPDATE projection_dirty_queue SET next_attempt_at=NOW()');
            $result = $this->runProjector('project_system_snapshots', $username, $password);
            $this->assertSame(0, $result['exit'], $result['errors']);
            $this->assertSame(2, (int) $this->db->query('SELECT version FROM projection_system_snapshot')->fetchColumn());
            $this->assertSame(0, (int) $this->db->query('SELECT stale_flag FROM projection_system_snapshot')->fetchColumn());
            $this->assertSame(0, (int) $this->db->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());
            $this->db->exec("INSERT INTO projection_dirty_queue (entity_type,entity_id) VALUES ('system',100120);
                UPDATE projection_system_snapshot SET stale_flag=1");
            $beforeAckFailure = $this->db->query('SELECT * FROM projection_system_snapshot')->fetch(PDO::FETCH_ASSOC);
            $this->admin->exec('REVOKE DELETE ON `' . $this->database . '`.projection_dirty_queue FROM ' . $account);
            $result = $this->runProjector('project_system_snapshots', $username, $password);
            $this->assertSame(2, $result['exit'], $result['errors']);
            $this->assertStringContainsString('DELETE command denied', $result['errors']);
            $this->assertStringNotContainsString('completion_committed', $result['errors']);
            $this->assertSame($beforeAckFailure,
                $this->db->query('SELECT * FROM projection_system_snapshot')->fetch(PDO::FETCH_ASSOC));
            $queue = $this->db->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
            $this->assertSame('queued', $queue['status']);
            $this->assertSame(1, (int)$queue['attempts']);
            $this->assertNull($queue['claim_token']);
            $this->admin->exec('GRANT DELETE ON `' . $this->database . '`.projection_dirty_queue TO ' . $account);
            $this->db->exec('UPDATE projection_dirty_queue SET next_attempt_at=NOW()');
            $result = $this->runProjector('project_system_snapshots', $username, $password);
            $this->assertSame(0, $result['exit'], $result['errors']);
            $this->assertStringContainsString('completion_committed', $result['errors']);
            $this->assertSame(3, (int)$this->db->query('SELECT version FROM projection_system_snapshot')->fetchColumn());
            $this->db->exec("INSERT INTO projection_dirty_queue (entity_type,entity_id) VALUES ('system',100120);
                DROP TABLE star_systems");
            $result = $this->runProjector('project_system_snapshots', $username, $password);
            $this->assertSame(2, $result['exit'], $result['errors']);
            $this->assertSame('queued', $this->db->query('SELECT status FROM projection_dirty_queue')->fetchColumn());
            $this->assertSame(3, (int) $this->db->query('SELECT version FROM projection_system_snapshot')->fetchColumn());
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testProjectionCompletionFencesWritesAndCommitsAckAtomically(): void
    {
        require_once __DIR__ . '/../../lib/GalaxySchema.php';
        foreach (['migrate_projection_user_overview_v1.sql', 'migrate_projection_system_snapshot_v1.sql',
            'migrate_projection_runtime_v2.sql', 'migrate_projection_claim_token_v1.sql'] as $migration) {
            $this->db->exec($this->readSqlForTestDatabase($migration));
        }
        $producer = $this->secondConnection();
        $producer->exec('SET SESSION innodb_lock_wait_timeout=1');
        foreach (['user', 'system'] as $entityType) {
            $table = $entityType === 'user' ? 'projection_user_overview' : 'projection_system_snapshot';
            \GalaxyQuest\Schema\GalaxySchema::assertProjectionTransactions($this->db, $table);
            $write = static function (PDO $connection, string $revision) use ($entityType): void {
                $payload = ['revision' => $revision, 'colony_population' => 500];
                if ($entityType === 'user') {
                    write_user_overview_projection($connection, 7, $payload, true);
                } else {
                    write_system_snapshot($connection, 1, 120, $payload, true);
                }
            };
            $enqueue = static function (string $reason) use ($entityType, $producer): void {
                if ($entityType === 'user') {
                    enqueue_projection_dirty($producer, 'user', 7, $reason);
                } else {
                    enqueue_dirty_system($producer, 1, 120, $reason);
                }
            };
            $write($this->db, 'retained');
            $before = $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC);
            $enqueue('old');
            $old = claim_batch($this->db, $entityType, 1)[0];
            $enqueue('replacement');
            $new = claim_batch($this->db, $entityType, 1)[0];
            $queueBefore = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);

            // Reproduce the old unfenced write without retaining its effects.
            $this->db->beginTransaction();
            $write($this->db, 'obsolete');
            $this->assertSame(2, (int)$this->db->query('SELECT version FROM ' . $table)->fetchColumn());
            $this->db->rollBack();
            $this->assertFalse(complete_projection_claim(
                $this->db, (int)$old['id'], $old['claim_token'],
                static function (PDO $connection): void { self::fail('Old claim must never write.'); },
            ));
            $this->assertSame($before, $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC));
            $this->assertSame($queueBefore,
                $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));

            try {
                complete_projection_claim($this->db, (int)$new['id'], $new['claim_token'],
                    function (PDO $connection) use ($write, $producer, $table, $before): void {
                        $write($connection, 'rolled back');
                        $this->assertSame($before, $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC));
                        throw new RuntimeException('failure after snapshot write');
                    });
                $this->fail('Write failure must propagate.');
            } catch (RuntimeException $e) {
                $this->assertSame('failure after snapshot write', $e->getMessage());
            }
            $this->assertFalse($this->db->inTransaction());
            $this->assertSame($before, $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC));
            $this->assertSame($queueBefore,
                $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
            $this->assertTrue(complete_projection_claim($this->db, (int)$new['id'], $new['claim_token'],
                function (PDO $connection) use ($write, $producer, $table, $before, $new): void {
                    $write($connection, 'committed');
                    $this->assertSame($before, $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC));
                    try {
                        $producer->exec("UPDATE projection_dirty_queue SET status='queued' WHERE id=" . (int)$new['id']);
                        $this->fail('Producer must wait for the locked claim.');
                    } catch (PDOException $e) {
                        $this->assertSame(1205, $e->errorInfo[1]);
                    }
                }));
            $this->assertSame(0, (int)$producer->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());
            $committed = $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC);
            $this->assertSame(2, (int)$committed['version']);
            $this->assertSame('committed', json_decode($committed['payload_json'], true)['revision']);
            $this->assertFalse(complete_projection_claim($this->db, (int)$new['id'], $new['claim_token'],
                static function (PDO $connection): void { self::fail('Deleted claim must not publish twice.'); }));
            $this->assertSame($committed, $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC));
            $enqueue('after commit');
            $this->assertSame('queued', $producer->query('SELECT status FROM projection_dirty_queue')->fetchColumn());
            $next = claim_batch($this->db, $entityType, 1)[0];
            $this->assertTrue(complete_projection_claim($this->db, (int)$next['id'], $next['claim_token'],
                static function (PDO $connection): void {}));
            $this->assertSame($committed, $producer->query('SELECT * FROM ' . $table)->fetch(PDO::FETCH_ASSOC));
        }
    }

    public function testRetiredShipDesignerSqlInitializerDoesNotDropExistingData(): void
    {
        $this->db->exec("CREATE TABLE vessel_designs (design_id VARCHAR(16) PRIMARY KEY) ENGINE=InnoDB;
            CREATE TABLE generation_queue (queue_id VARCHAR(16) PRIMARY KEY) ENGINE=InnoDB;
            CREATE TABLE asset_generations (generation_id VARCHAR(16) PRIMARY KEY) ENGINE=InnoDB;
            INSERT INTO vessel_designs VALUES ('design-1');
            INSERT INTO generation_queue VALUES ('queue-1');
            INSERT INTO asset_generations VALUES ('generation-1')");
        $tablesBefore = [];
        foreach (['vessel_designs', 'generation_queue', 'asset_generations'] as $table) {
            $tablesBefore[$table] = [
                'definition' => $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM),
                'rows' => $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC),
            ];
        }

        try {
            $this->db->exec($this->readSqlForTestDatabase('init_ship_designer.sql'));
            $this->fail('Retired initializer must fail closed.');
        } catch (PDOException $e) {
            $this->assertStringContainsString('retired', strtolower($e->getMessage()));
        }

        foreach ($tablesBefore as $table => $before) {
            $this->assertSame($before['definition'],
                $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM));
            $this->assertSame($before['rows'],
                $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
        }
    }

    public function testProjectionTokenMigrationPreservesPopulatedLegacyQueue(): void
    {
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_user_overview_v1.sql'));
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_runtime_v2.sql'));
        $this->db->exec("INSERT INTO projection_dirty_queue (entity_type,entity_id,status,attempts,last_error)
            VALUES ('user',7,'processing',3,'retained')");
        $before = $this->db->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_projection_claim_token_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $after = $this->db->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
        $this->assertNull($after['claim_token']);
        unset($after['claim_token']);
        $this->assertSame($before, $after);
        $this->db->exec("UPDATE projection_dirty_queue SET claim_token='" . str_repeat('a', 64) . "'");
        $definition = $this->db->query('SHOW CREATE TABLE projection_dirty_queue')->fetch(PDO::FETCH_NUM);
        $rows = $this->db->query('SELECT * FROM projection_dirty_queue')->fetchAll(PDO::FETCH_ASSOC);
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_claim_token_v1.sql'));
        $this->assertSame($definition, $this->db->query('SHOW CREATE TABLE projection_dirty_queue')->fetch(PDO::FETCH_NUM));
        $this->assertSame($rows, $this->db->query('SELECT * FROM projection_dirty_queue')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame([], $runner->runUp());
    }

    public function testProjectorFailureDoesNotOverwriteRequeuedEvents(): void
    {
        require_once __DIR__ . '/../../lib/projection_runtime.php';
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_user_overview_v1.sql'));
        $runner = $this->buildRunner(
            $this->readSqlForTestDatabase('migrate_projection_runtime_v2.sql') . "\n" .
            $this->readSqlForTestDatabase('migrate_projection_claim_token_v1.sql')
        );
        $this->assertCount(1, $runner->runUp());
        $producer = $this->secondConnection();
        $maximum = defined('PROJECTION_MAX_ATTEMPTS') ? (int)PROJECTION_MAX_ATTEMPTS : 10;
        foreach ([1, $maximum] as $attempt) {
            enqueue_projection_dirty($producer, 'user', 7, 'old event', 'old', '{"revision":1}');
            $claim = claim_batch($this->db, 'user', 1);
            $this->assertCount(1, $claim);
            $id = (int)$claim[0]['id'];
            enqueue_projection_dirty($producer, 'user', 7, 'new event', 'new', '{"revision":2}');
            $before = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
            mark_failed($this->db, $id, $attempt, 'stale failure', 30, $claim[0]['claim_token']);
            $this->assertSame($before, $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
            mark_done($this->db, $id, $claim[0]['claim_token']);
            $this->assertSame($before, $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
            $replacement = claim_batch($this->db, 'user', 1);
            $this->assertCount(1, $replacement);
            $this->assertSame('{"revision":2}', $replacement[0]['payload_json']);
            $this->assertNotSame($claim[0]['claim_token'], $replacement[0]['claim_token']);
            $reclaimed = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
            $this->db->beginTransaction();
            $unfenced = $this->db->prepare("DELETE FROM projection_dirty_queue WHERE id=? AND status='processing'");
            $unfenced->execute([$id]);
            $this->assertSame(1, $unfenced->rowCount());
            $this->db->rollBack();
            mark_done($this->db, $id, $claim[0]['claim_token']);
            mark_failed($this->db, $id, $attempt, 'obsolete claim', 30, $claim[0]['claim_token']);
            $this->assertSame($reclaimed, $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
            mark_done($this->db, $id, $replacement[0]['claim_token']);
            $this->assertSame(0, (int)$producer->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());
        }
        enqueue_projection_dirty($producer, 'user', 8, 'retry');
        $claim = claim_batch($this->db, 'user', 1);
        $id = (int)$claim[0]['id'];
        $this->db->beginTransaction();
        mark_failed($this->db, $id, 1, 'transient', 30, $claim[0]['claim_token']);
        $this->assertTrue($this->db->inTransaction());
        $this->assertSame('queued', $this->db->query('SELECT status FROM projection_dirty_queue')->fetchColumn());
        $this->db->rollBack();
        $this->assertSame('processing', $producer->query('SELECT status FROM projection_dirty_queue')->fetchColumn());
        mark_failed($this->db, $id, 1, 'transient', 30, $claim[0]['claim_token']);
        $retry = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('queued', $retry['status']);
        $this->assertNull($retry['claim_token']);
        $this->assertSame(1, (int)$retry['attempts']);
        $this->assertSame('transient', $retry['last_error']);
        $this->assertGreaterThan(time(), strtotime($retry['next_attempt_at']));
        mark_failed($this->db, $id, $maximum, 'duplicate failure', 30, $claim[0]['claim_token']);
        $this->assertSame($retry, $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
        $this->db->exec('UPDATE projection_dirty_queue SET next_attempt_at=NOW()');
        $claim = claim_batch($this->db, 'user', 1);
        $this->assertCount(1, $claim);
        mark_failed($this->db, $id, $maximum, 'permanent failure', 30, $claim[0]['claim_token']);
        $dead = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('failed', $dead['status']);
        $this->assertNull($dead['claim_token']);
        $this->assertSame($maximum, (int)$dead['attempts']);
        mark_failed($this->db, $id, 1, 'late retry', 30, $claim[0]['claim_token']);
        mark_done($this->db, $id, $claim[0]['claim_token']);
        $this->assertSame($dead, $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
        $this->assertSame([], claim_batch($this->db, 'user', 1));
        enqueue_projection_dirty($producer, 'user', 8, 'revived event');
        $claim = claim_batch($this->db, 'user', 1);
        $this->assertCount(1, $claim);
        mark_done($this->db, $id, $claim[0]['claim_token']);
        mark_failed($this->db, $id, 1, 'deleted row', 30, $claim[0]['claim_token']);
        $this->assertSame(0, (int)$producer->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());

        enqueue_dirty_system($producer, 1, 120, 'system old');
        $old = claim_batch($this->db, 'system', 1);
        $this->assertCount(1, $old);
        $id = (int)$old[0]['id'];
        enqueue_dirty_system($producer, 1, 120, 'system new');
        $queued = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
        $this->assertSame('queued', $queued['status']);
        $this->assertNull($queued['claim_token']);
        $this->assertSame('system new', $queued['reason']);
        $new = claim_batch($this->db, 'system', 1);
        $this->assertCount(1, $new);
        $this->assertNotSame($old[0]['claim_token'], $new[0]['claim_token']);
        $current = $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC);
        mark_done($this->db, $id, $old[0]['claim_token']);
        mark_failed($this->db, $id, 1, 'old system failure', 30, $old[0]['claim_token']);
        mark_failed($this->db, $id, $maximum, 'old system dead letter', 30, $old[0]['claim_token']);
        $this->assertSame($current, $producer->query('SELECT * FROM projection_dirty_queue')->fetch(PDO::FETCH_ASSOC));
        mark_failed($this->db, $id, $maximum, 'current system dead letter', 30, $new[0]['claim_token']);
        $this->assertSame('failed', $producer->query('SELECT status FROM projection_dirty_queue')->fetchColumn());
        enqueue_dirty_system($producer, 1, 120, 'system revived');
        $revived = claim_batch($this->db, 'system', 1);
        $this->assertCount(1, $revived);
        $this->assertSame('system revived', $revived[0]['reason']);
        $this->assertSame(0, (int)$revived[0]['attempts']);
        mark_done($this->db, $id, $revived[0]['claim_token']);
        $this->assertSame(0, (int)$producer->query('SELECT COUNT(*) FROM projection_dirty_queue')->fetchColumn());
    }

    private function prepareWormholeFixture(): MigrationRunner
    {
        $this->db->exec("CREATE TABLE users (id INT PRIMARY KEY, dark_matter INT DEFAULT 0,
                rank_points INT DEFAULT 0) ENGINE=InnoDB;
            INSERT INTO users (id) VALUES (7),(8),(9);
            CREATE TABLE npc_factions (id INT PRIMARY KEY, code VARCHAR(64), base_diplomacy INT DEFAULT 0)
                ENGINE=InnoDB;
            INSERT INTO npc_factions (id,code) VALUES (1,'precursors');
            CREATE TABLE celestial_bodies (id INT PRIMARY KEY, galaxy_index INT, system_index INT)
                ENGINE=InnoDB;
            INSERT INTO celestial_bodies VALUES (1,1,120);
            CREATE TABLE colonies (id INT PRIMARY KEY, user_id INT, body_id INT, is_homeworld INT,
                metal INT DEFAULT 0, crystal INT DEFAULT 0, deuterium INT DEFAULT 0, rare_earth INT DEFAULT 0)
                ENGINE=InnoDB;
            INSERT INTO colonies (id,user_id,body_id,is_homeworld) VALUES (1,7,1,1)");
        $schema = $this->readSqlForTestDatabase('schema.sql');
        foreach (['research', 'faction_quests', 'user_faction_quests', 'diplomacy'] as $table) {
            preg_match('/CREATE TABLE IF NOT EXISTS ' . $table . '\s*\(.*?\) ENGINE=InnoDB;/s', $schema, $matches);
            $this->assertNotEmpty($matches);
            $this->db->exec($matches[0]);
        }
        $this->db->exec("INSERT INTO research (user_id,type,level)
            VALUES (7,'wormhole_theory',5),(8,'wormhole_theory',4),(9,'wormhole_theory',5)");
        $this->db->exec($this->readSqlForTestDatabase('migrate_app_state_v1.sql'));
        $runner = $this->buildRunner(
            $this->readSqlForTestDatabase('migrate_vessel_blueprints_v8_wormholes.sql') . "\n" .
            $this->readSqlForTestDatabase('migrate_vessel_blueprints_v9_wormhole_beacons.sql')
        );
        $this->assertCount(1, $runner->runUp());
        return $runner;
    }

    private function loadWormholeFleetHelpers(): Closure
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        if (!function_exists('resolve_wormhole_route')) {
            require_once __DIR__ . '/../../lib/fleet_launch.php';
        }
        // Keep the actual list body; return its payload instead of exiting via HTTP serialization.
        $start = strpos($source, 'function list_wormholes(');
        $end = strpos($source, 'function list_ftl_status(', $start);
        $this->assertNotFalse($start);
        $this->assertNotFalse($end);
        $listSource = str_replace(
            ['function list_wormholes(', '): never {', 'json_ok(', '__DIR__'],
            ['return static function(', '): array {', 'return (', var_export(realpath(__DIR__ . '/../../api'), true)],
            substr($source, $start, $end - $start)
        );
        return eval(rtrim($listSource) . ';');
    }

    private function requireNpcAiWithoutGlobalErrorHandlers(): void
    {
        $handlersWereInitialized = defined('GQ_API_ERROR_HANDLERS_READY');
        require_once __DIR__ . '/../../api/npc_ai.php';
        if (!$handlersWereInitialized) {
            restore_error_handler();
            restore_exception_handler();
        }
    }

    public function testWormholeRoutesAndRegenerationUseCanonicalStorageWithoutDdl(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        $this->requireNpcAiWithoutGlobalErrorHandlers();
        $list = $this->loadWormholeFleetHelpers();
        $runner = $this->prepareWormholeFixture();
        $this->assertSame([], $runner->runUp());
        $this->db->exec("ALTER TABLE wormholes MODIFY label VARCHAR(160) DEFAULT NULL;
            INSERT INTO user_wormhole_unlocks (user_id,source_quest_code) VALUES (7,'retained');
            UPDATE wormholes SET label='retained route' WHERE is_permanent=1");
        $before = $this->db->query('SELECT * FROM wormholes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $unlocks = $this->db->query('SELECT * FROM user_wormhole_unlocks')->fetchAll(PDO::FETCH_ASSOC);
        $definition = $this->db->query('SHOW CREATE TABLE wormholes')->fetch(PDO::FETCH_NUM);
        $this->db->exec($this->readSqlForTestDatabase('migrate_vessel_blueprints_v8_wormholes.sql'));
        $this->db->exec($this->readSqlForTestDatabase('migrate_vessel_blueprints_v9_wormhole_beacons.sql'));
        $this->assertSame($before, $this->db->query('SELECT * FROM wormholes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($unlocks, $this->db->query('SELECT * FROM user_wormhole_unlocks')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($definition, $this->db->query('SHOW CREATE TABLE wormholes')->fetch(PDO::FETCH_NUM));
        $username = 'gq_wormhole_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $connect = function () use ($username, $password): PDO {
                $connection = new PDO(
                    (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
                );
                $connection->exec('USE `' . $this->database . '`');
                return $connection;
            };
            $reader = $connect();
            $reader->beginTransaction();
            $route = resolve_wormhole_route($reader, 7, 1, 120, 1, 260);
            $this->assertNotNull($route);
            $this->assertSame('retained route', $route['label']);
            $this->assertSame($route['id'], resolve_wormhole_route($reader, 7, 1, 260, 1, 120)['id']);
            $this->assertNull(resolve_wormhole_route($reader, 8, 1, 1, 1, 120));
            $this->assertNull(resolve_wormhole_route($reader, 9, 1, 120, 1, 260));
            $this->assertNotNull(resolve_wormhole_route($reader, 9, 1, 1, 1, 120));
            $payload = $list($reader, 7, 1);
            $this->assertSame(5, $payload['wormhole_theory_level']);
            $this->assertTrue($payload['permanent_unlock']);
            $this->assertCount(2, $payload['wormholes']);
            $this->assertSame([true, true], array_column($payload['wormholes'], 'available'));
            $this->assertSame([false, false], array_column($list($reader, 8, 0)['wormholes'], 'available'));
            $this->assertSame([true, false], array_column($list($reader, 9, 0)['wormholes'], 'available'));
            $this->assertTrue($reader->inTransaction());
            $reader->rollBack();
            $this->assertSame($before, $this->db->query('SELECT * FROM wormholes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = $connect();
            $writer->beginTransaction();
            consume_wormhole_jump($writer, (int) $route['id']);
            $this->assertSame(95, (int) $writer->query('SELECT stability FROM wormholes WHERE is_permanent=1')->fetchColumn());
            $this->assertNull(resolve_wormhole_route($writer, 7, 1, 120, 1, 260));
            $this->assertFalse($list($writer, 7, 1)['wormholes'][1]['available']);
            $this->assertTrue($writer->inTransaction());
            $writer->rollBack();
            $this->assertSame($before, $this->db->query('SELECT * FROM wormholes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
            $writer->beginTransaction();
            $writer->exec('UPDATE wormholes SET stability=9 WHERE is_permanent=1');
            $this->assertNull(resolve_wormhole_route($writer, 7, 1, 120, 1, 260));
            $this->assertFalse($list($writer, 7, 1)['wormholes'][1]['available']);
            $writer->exec('UPDATE wormholes SET stability=10 WHERE is_permanent=1');
            $this->assertNotNull(resolve_wormhole_route($writer, 7, 1, 120, 1, 260));
            $this->assertTrue($list($writer, 7, 1)['wormholes'][1]['available']);
            $writer->exec('UPDATE wormholes SET is_active=0 WHERE is_permanent=1');
            $this->assertNull(resolve_wormhole_route($writer, 7, 1, 120, 1, 260));
            $this->assertCount(1, $list($writer, 7, 1)['wormholes']);
            $writer->rollBack();
            $this->db->exec("UPDATE wormholes SET stability=90, cooldown_until=DATE_SUB(NOW(),INTERVAL 1 MINUTE)
                WHERE is_permanent=1;
                UPDATE wormholes SET stability=99 WHERE is_permanent=0;
                INSERT INTO wormholes (endpoint_a_galaxy,endpoint_a_system,endpoint_b_galaxy,endpoint_b_system,
                    stability,cooldown_until,is_active,label) VALUES
                    (2,1,2,2,90,DATE_ADD(NOW(),INTERVAL 1 HOUR),1,'future cooldown'),
                    (3,1,3,2,90,NULL,0,'inactive')");
            app_state_set_int($this->db, 'wormholes:regen:last_tick', 0);
            $writer->beginTransaction();
            wormhole_regeneration_tick_global($writer);
            $this->assertTrue($writer->inTransaction());
            $this->assertSame(92, (int) $writer->query('SELECT stability FROM wormholes WHERE is_permanent=1')->fetchColumn());
            $this->assertNull($writer->query('SELECT cooldown_until FROM wormholes WHERE is_permanent=1')->fetchColumn());
            $this->assertSame(100, (int) $writer->query('SELECT stability FROM wormholes WHERE id=1')->fetchColumn());
            $this->assertSame(90, (int) $writer->query("SELECT stability FROM wormholes WHERE label='future cooldown'")->fetchColumn());
            $this->assertNotNull($writer->query("SELECT cooldown_until FROM wormholes WHERE label='future cooldown'")->fetchColumn());
            $this->assertSame(90, (int) $writer->query("SELECT stability FROM wormholes WHERE label='inactive'")->fetchColumn());
            $writer->rollBack();
            $this->assertSame(0, app_state_get_int($this->db, 'wormholes:regen:last_tick'));
            wormhole_regeneration_tick_global($writer);
            $after = $this->db->query('SELECT * FROM wormholes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            wormhole_regeneration_tick_global($reader);
            $this->assertSame($after, $this->db->query('SELECT * FROM wormholes ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
            $this->db->exec('ALTER TABLE wormholes DROP COLUMN is_permanent');
            app_state_set_int($this->db, 'wormholes:regen:last_tick', 0);
            foreach ([
                static fn() => resolve_wormhole_route($reader, 7, 1, 120, 1, 260),
                static fn() => $list($reader, 7, 1),
                static fn() => wormhole_regeneration_tick_global($writer),
            ] as $operation) {
                try {
                    $operation();
                    $this->fail('Missing permanence flag must not be repaired or hidden as no route.');
                } catch (RuntimeException $error) {
                    $this->assertStringContainsString('wormholes.is_permanent', $error->getMessage());
                }
            }
            $this->assertSame(0, app_state_get_int($this->db, 'wormholes:regen:last_tick'));
            $this->db->exec('DROP TABLE wormholes');
            try {
                wormhole_regeneration_tick_global($writer);
                $this->fail('Missing wormholes must not consume a tick or recreate storage.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('wormholes.id', $error->getMessage());
            }
            $this->assertSame(0, app_state_get_int($this->db, 'wormholes:regen:last_tick'));
            $this->assertSame($unlocks, $this->db->query('SELECT * FROM user_wormhole_unlocks')->fetchAll(PDO::FETCH_ASSOC));
            $this->db->exec('DELETE FROM users WHERE id=7');
            $this->assertSame(0, (int) $this->db->query('SELECT COUNT(*) FROM user_wormhole_unlocks')->fetchColumn());
        } finally {
            foreach ([$reader ?? null, $writer ?? null] as $connection) {
                if ($connection !== null && $connection->inTransaction()) {
                    $connection->rollBack();
                }
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testBeaconRewardPreflightsUnlockStorageBeforeMutations(): void
    {
        require_once __DIR__ . '/../../api/factions.php';
        $this->loadWormholeFleetHelpers();
        $this->prepareWormholeFixture();
        $questId = (int) $this->db->query("SELECT id FROM faction_quests WHERE code='precursor_wormhole_beacon'")->fetchColumn();
        $this->db->exec("INSERT INTO user_faction_quests (user_id,faction_quest_id,status,progress_json)
            VALUES (7,$questId,'completed','{}')");
        $uqid = (int) $this->db->lastInsertId();
        $row = $this->db->query("SELECT * FROM faction_quests WHERE id=$questId")->fetch(PDO::FETCH_ASSOC);
        $source = file_get_contents(__DIR__ . '/../../api/factions.php');
        $start = strpos($source, '                ensure_faction_quest_reward_schema(');
        $end = strpos($source, '        json_ok([', $start);
        $this->assertNotFalse($start);
        $this->assertNotFalse($end);
        // Execute the actual reward/claim body without authentication or HTTP exit.
        $rewardSource = str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $start, $end - $start));
        $claim = static function (PDO $db, int $uid, int $uqid, array $row) use ($rewardSource): void {
            eval($rewardSource);
        };
        $tables = ['users', 'colonies', 'user_faction_quests', 'diplomacy'];
        $before = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        }
        $this->db->exec('DROP TABLE user_wormhole_unlocks');
        ensure_faction_quest_reward_schema($this->db, 'ordinary_quest');
        try {
            $claim($this->db, 7, $uqid, $row);
            $this->fail('Beacon schema must fail before any reward or claimed status.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('user_wormhole_unlocks.user_id', $error->getMessage());
        }
        foreach ($before as $table => $rows) {
            $this->assertSame($rows, $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
        }
        $this->db->exec($this->readSqlForTestDatabase('migrate_vessel_blueprints_v9_wormhole_beacons.sql'));
        $username = 'gq_beacon_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT, INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
            $writer->exec('USE `' . $this->database . '`');
            $writer->beginTransaction();
            $claim($writer, 7, $uqid, $row);
            $this->assertTrue($writer->inTransaction());
            $this->assertSame('claimed', $writer->query('SELECT status FROM user_faction_quests')->fetchColumn());
            $this->assertSame('precursor_wormhole_beacon', $writer->query('SELECT source_quest_code FROM user_wormhole_unlocks')->fetchColumn());
            $this->assertSame(15000, (int) $writer->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
            $this->assertSame(500, (int) $writer->query('SELECT dark_matter FROM users WHERE id=7')->fetchColumn());
            $this->assertSame(1, (int) $writer->query('SELECT quests_completed FROM diplomacy WHERE user_id=7')->fetchColumn());
            $writer->rollBack();
            foreach ($before as $table => $rows) {
                $this->assertSame($rows, $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
            }
            $this->assertSame(0, (int) $this->db->query('SELECT COUNT(*) FROM user_wormhole_unlocks')->fetchColumn());
            $this->db->exec("INSERT INTO user_wormhole_unlocks (user_id,source_quest_code) VALUES (7,'earlier')");
            $claim($writer, 7, $uqid, $row);
            $this->assertSame(1, (int) $writer->query('SELECT COUNT(*) FROM user_wormhole_unlocks')->fetchColumn());
            $this->assertSame('precursor_wormhole_beacon', $writer->query('SELECT source_quest_code FROM user_wormhole_unlocks')->fetchColumn());
            $this->assertNotNull(resolve_wormhole_route($writer, 7, 1, 120, 1, 260));
            $this->db->exec('DROP TABLE user_wormhole_unlocks');
            try {
                $claim($writer, 7, $uqid, $row);
                $this->fail('Earlier success must not hide missing unlock storage.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('user_wormhole_unlocks.user_id', $error->getMessage());
            }
            $this->assertSame(15000, (int) $writer->query('SELECT metal FROM colonies WHERE id=1')->fetchColumn());
            try {
                resolve_wormhole_route($writer, 7, 1, 120, 1, 260);
                $this->fail('Missing unlock schema must not become an unavailable-route result.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('user_wormhole_unlocks.user_id', $error->getMessage());
            }
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testLeaderMarketplaceGuardsPreserveProfilesWithoutDdl(): void
    {
        if (!function_exists('ensure_leader_marketplace_schema')) {
            $source = file_get_contents(__DIR__ . '/../../api/leaders.php');
            $start = strpos($source, 'function ensure_leader_marketplace_schema(');
            $end = strpos($source, 'function generate_marketplace_candidates(', $start);
            $this->assertNotFalse($start);
            $this->assertNotFalse($end);
            eval(str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $start, $end - $start)));
        }
        $schema = $this->readSqlForTestDatabase('schema.sql');
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO users VALUES (7);
            CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB;
            CREATE TABLE fleets (id INT PRIMARY KEY) ENGINE=InnoDB');
        preg_match('/CREATE TABLE IF NOT EXISTS leaders\s*\(.*?\) ENGINE=InnoDB;/s', $schema, $matches);
        $this->assertNotEmpty($matches);
        $this->db->exec($matches[0]);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_marketplace_advisor.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->db->exec("ALTER TABLE leaders MODIFY tagline VARCHAR(255) NOT NULL DEFAULT '';
            INSERT INTO leaders (user_id,name,role,rarity,tagline,skill_guidance)
                VALUES (7,'Existing','advisor','rare','retained',9);
            INSERT INTO leader_marketplace (user_id,name,role,backstory,expires_at,is_hired)
                VALUES (7,'Candidate','advisor','retained',DATE_ADD(NOW(),INTERVAL 1 DAY),1)");
        $before = [];
        $definitions = [];
        foreach (['leaders', 'leader_marketplace'] as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
            $definitions[$table] = $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM);
        }
        $username = 'gq_leader_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $reader = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $reader->exec('USE `' . $this->database . '`');
            $reader->beginTransaction();
            ensure_leader_marketplace_schema($reader);
            ensure_leaders_marketplace_profile_schema($reader);
            $this->assertTrue($reader->inTransaction());
            $reader->rollBack();
            foreach ($before as $table => $rows) {
                $this->assertSame($rows, $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
                $this->assertSame($definitions[$table], $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM));
            }
            $this->db->exec('ALTER TABLE leaders DROP COLUMN skill_guidance');
            try {
                ensure_leaders_marketplace_profile_schema($reader);
                $this->fail('Missing leader skill must not be added at runtime.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('leaders.skill_guidance', $error->getMessage());
            }
            $this->db->exec('DROP TABLE leader_marketplace');
            try {
                ensure_leader_marketplace_schema($reader);
                $this->fail('Earlier success must not recreate marketplace storage.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('leader_marketplace.id', $error->getMessage());
            }
            $this->assertSame('retained', $this->db->query('SELECT tagline FROM leaders')->fetchColumn());
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                 AND table_name='leader_marketplace'"
            )->fetchColumn());
        } finally {
            if (isset($reader) && $reader->inTransaction()) {
                $reader->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testAllianceWarMigrationPreservesStateAndRuntimeNeedsOnlySelect(): void
    {
        if (!function_exists('aw_ensure_schema')) {
            $source = file_get_contents(__DIR__ . '/../../api/alliance_wars.php');
            $start = strpos($source, 'function aw_ensure_schema(');
            $end = strpos($source, 'function aw_user_leadable_alliances(', $start);
            $this->assertNotFalse($start);
            $this->assertNotFalse($end);
            eval(str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $start, $end - $start)));
        }
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO users VALUES (7);
            CREATE TABLE alliances (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO alliances VALUES (1),(2)');
        try {
            aw_ensure_schema($this->db);
            $this->fail('Missing war storage must not be created.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('alliance_wars.id', $error->getMessage());
        }
        $sql = $this->readSqlForTestDatabase('migrate_alliance_wars_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->db->exec("ALTER TABLE alliance_wars MODIFY name VARCHAR(180) NOT NULL DEFAULT '';
            INSERT INTO alliance_wars (id,name,declared_by_user_id,war_score_a,exhaustion_b)
                VALUES (1,'Retained',7,83,27.50);
            INSERT INTO alliance_war_sides (war_id,alliance_id,side) VALUES (1,1,'a'),(1,2,'b');
            INSERT INTO alliance_war_peace_offers (war_id,from_alliance_id,expires_at)
                VALUES (1,1,DATE_ADD(NOW(),INTERVAL 1 DAY))");
        $tables = ['alliance_wars', 'alliance_war_sides', 'alliance_war_peace_offers'];
        $before = [];
        $definitions = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
            $definitions[$table] = $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM);
        }
        $this->assertSame('[]', $before['alliance_war_peace_offers'][0]['terms_json']);
        $this->db->exec($sql);
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        $username = 'gq_wars_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $reader = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $reader->exec('USE `' . $this->database . '`');
            $reader->beginTransaction();
            aw_ensure_schema($reader);
            $this->assertTrue($reader->inTransaction());
            $reader->rollBack();
            foreach ($tables as $table) {
                $this->assertSame($before[$table], $this->db->query('SELECT * FROM ' . $table . ' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
                $this->assertSame($definitions[$table], $this->db->query('SHOW CREATE TABLE ' . $table)->fetch(PDO::FETCH_NUM));
            }
            $this->db->exec('DELETE FROM alliances WHERE id=1');
            $this->assertSame(1, (int) $reader->query('SELECT COUNT(*) FROM alliance_war_sides')->fetchColumn());
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM alliance_war_peace_offers')->fetchColumn());
            $this->db->exec('DELETE FROM users WHERE id=7');
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM alliance_wars')->fetchColumn());
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM alliance_war_sides')->fetchColumn());
            $this->db->exec('DROP TABLE alliance_war_peace_offers');
            try {
                aw_ensure_schema($reader);
                $this->fail('Missing offers after success must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('alliance_war_peace_offers.id', $error->getMessage());
            }
        } finally {
            if (isset($reader) && $reader->inTransaction()) {
                $reader->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testAllianceRuntimeSchemaPreservesDataAndNeedsNoDdl(): void
    {
        if (!function_exists('ensure_alliance_schema')) {
            $source = file_get_contents(__DIR__ . '/../../api/alliances.php');
            $start = strpos($source, 'function ensure_alliance_schema(');
            $end = strpos($source, 'function action_list(', $start);
            $this->assertNotFalse($start);
            $this->assertNotFalse($end);
            eval(str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $start, $end - $start)));
        }
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
            INSERT INTO users VALUES (7),(8)');
        $schema = $this->readSqlForTestDatabase('schema.sql');
        $tables = ['alliances', 'alliance_members', 'alliance_relations', 'alliance_messages'];
        foreach ($tables as $table) {
            preg_match('/CREATE TABLE IF NOT EXISTS ' . $table . '\s*\(.*?\) ENGINE=InnoDB;/s', $schema, $matches);
            $this->assertNotEmpty($matches);
            $this->db->exec($matches[0]);
        }
        $this->db->exec("INSERT INTO alliances (id,name,tag,leader_user_id,treasury_metal)
            VALUES (1,'Existing','ONE',7,123.4567),(2,'Other','TWO',8,0);
            INSERT INTO alliance_members (alliance_id,user_id,role,contributed_resources) VALUES (1,7,'leader',89.1234);
            INSERT INTO alliance_relations (alliance_id,other_alliance_id,relation_type,declared_by_user_id)
                VALUES (1,2,'nap',7);
            INSERT INTO alliance_messages (alliance_id,author_id,message_text) VALUES (1,7,'retained')");
        $before = [];
        foreach ($tables as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
        }
        $username = 'gq_alliance_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $connection = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $connection->exec('USE `' . $this->database . '`');
            $connection->beginTransaction();
            ensure_alliance_schema($connection);
            $this->assertTrue($connection->inTransaction());
            $connection->rollBack();
            ensure_alliance_schema($connection);
            foreach ($tables as $table) {
                $this->assertSame($before[$table], $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
            }
            $this->db->exec('DELETE FROM alliances WHERE id=2');
            $this->assertNull($this->db->query('SELECT other_alliance_id FROM alliance_relations')->fetchColumn());
            $this->assertSame('123.4567', $connection->query('SELECT treasury_metal FROM alliances')->fetchColumn());
            $this->db->exec('DELETE FROM users WHERE id=7');
            foreach ($tables as $table) {
                $this->assertSame(0, (int) $connection->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn());
            }
            $this->db->exec('DROP TABLE alliance_messages');
            try {
                ensure_alliance_schema($connection);
                $this->fail('Earlier success must not recreate missing messages.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('alliance_messages.id', $error->getMessage());
            }
            $this->db->exec('ALTER TABLE alliances DROP COLUMN treasury_dark_matter');
            try {
                ensure_alliance_schema($connection);
                $this->fail('Missing treasury column must not be silently accepted.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('alliances.treasury_dark_matter', $error->getMessage());
            }
        } finally {
            if (isset($connection) && $connection->inTransaction()) {
                $connection->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testGlossaryMigrationAndRuntimePreserveCacheWithRestrictedRights(): void
    {
        if (!function_exists('ensure_glossary_cache_table')) {
            $source = file_get_contents(__DIR__ . '/../../api/glossary.php');
            $offset = strpos($source, 'function generate_rag_definition(');
            $this->assertNotFalse($offset);
            // The endpoint exits on import; load actual helpers without HTTP dispatch.
            eval(str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $offset)));
        }
        try {
            generate_rag_definition($this->db, 'white_dwarf');
            $this->fail('Missing cache must fail before RAG dependencies are invoked.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('glossary_cache.id', $error->getMessage());
        }
        $sql = $this->readSqlForTestDatabase('migrate_glossary_cache_v1.sql');
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        cache_glossary_definition($this->db, 'white_dwarf', ['definition' => 'retained']);
        $this->db->exec("ALTER TABLE glossary_cache MODIFY term_key VARCHAR(64) NOT NULL");
        $before = $this->db->query('SELECT * FROM glossary_cache')->fetchAll(PDO::FETCH_ASSOC);
        $definition = $this->db->query('SHOW CREATE TABLE glossary_cache')->fetch(PDO::FETCH_NUM);
        $this->db->exec($sql);
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        $this->assertSame($before, $this->db->query('SELECT * FROM glossary_cache')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($definition, $this->db->query('SHOW CREATE TABLE glossary_cache')->fetch(PDO::FETCH_NUM));
        $username = 'gq_glossary_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $connect = function () use ($username, $password): PDO {
                $connection = new PDO(
                    (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
                );
                $connection->exec('USE `' . $this->database . '`');
                return $connection;
            };
            $reader = $connect();
            $this->assertSame([
                'definition' => 'retained', 'cached_at' => $before[0]['generated_at'],
            ], get_glossary_cache($reader, 'white_dwarf'));
            $this->assertNull(get_glossary_cache($reader, 'missing'));
            try {
                cache_glossary_definition($reader, 'denied', ['definition' => 'denied']);
                $this->fail('Denied writes must not be hidden.');
            } catch (PDOException $error) {
                $this->assertSame(1142, (int) $error->errorInfo[1]);
            }
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = $connect();
            $writer->beginTransaction();
            cache_glossary_definition($writer, 'white_dwarf', ['definition' => 'updated']);
            $this->assertTrue($writer->inTransaction());
            $this->assertSame('updated', get_glossary_cache($writer, 'white_dwarf')['definition']);
            $writer->rollBack();
            $this->assertSame($before, $this->db->query('SELECT * FROM glossary_cache')->fetchAll(PDO::FETCH_ASSOC));
            cache_glossary_definition($writer, 'white_dwarf', ['definition' => 'updated']);
            $this->assertSame(1, (int) $reader->query('SELECT COUNT(*) FROM glossary_cache')->fetchColumn());
            $this->assertSame('updated', get_glossary_cache($reader, 'white_dwarf')['definition']);
            $this->db->exec("UPDATE glossary_cache SET generated_at=DATE_SUB(NOW(),INTERVAL 6 DAY)");
            $this->assertNull(get_glossary_cache($reader, 'white_dwarf'));
            $this->db->exec('DROP TABLE glossary_cache');
            try {
                get_glossary_cache($reader, 'white_dwarf');
                $this->fail('Missing storage must not be treated as a cache miss.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('glossary_cache.id', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                 AND table_name='glossary_cache'"
            )->fetchColumn());
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testScenarioTickRejectsMissingSchemaBeforeCooldownAndNeedsNoDdl(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        require_once __DIR__ . '/../../api/llm_soc/ScenarioEngine.php';
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
            CREATE TABLE npc_factions (id INT PRIMARY KEY) ENGINE=InnoDB');
        $this->db->exec($this->readSqlForTestDatabase('migrate_app_state_v1.sql'));
        app_state_set_int($this->db, 'scenario_engine:last_tick', 0);
        $before = $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC);
        try {
            ScenarioEngine::tick($this->db, $this->sqlDir);
            $this->fail('Missing scenario schema must fail before recording a tick.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('galactic_events.id', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC));
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_world_scenarios_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        ScenarioEngine::seedScenario($this->db, [
            'code' => 'retained', 'title_de' => 'Existing', 'description_de' => 'Retained',
        ]);
        $id = (int) $this->db->query("SELECT id FROM world_scenarios WHERE code='retained'")->fetchColumn();
        $this->db->exec("INSERT INTO active_world_events (scenario_id,ends_at,flavor_text)
            VALUES ($id,DATE_ADD(NOW(),INTERVAL 1 DAY),'retained')");
        $tables = ['galactic_events', 'world_scenarios', 'active_world_events'];
        $existing = [];
        foreach ($tables as $table) {
            $existing[$table] = $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
        }
        $username = 'gq_scenario_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $connect = function () use ($username, $password): PDO {
                $connection = new PDO(
                    (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
                );
                $connection->exec('USE `' . $this->database . '`');
                return $connection;
            };
            $reader = $connect();
            $guard = new ReflectionMethod(ScenarioEngine::class, 'ensureTables');
            $guard->invoke(null, $reader);
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = $connect();
            $writer->beginTransaction();
            ScenarioEngine::tick($writer, $this->sqlDir);
            $this->assertTrue($writer->inTransaction());
            $this->assertGreaterThan(0, app_state_get_int($writer, 'scenario_engine:last_tick'));
            $writer->rollBack();
            $this->assertSame($before, $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC));
            ScenarioEngine::tick($writer, $this->sqlDir);
            $cooldown = $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC);
            ScenarioEngine::tick($reader, $this->sqlDir);
            $this->assertSame($cooldown, $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC));
            foreach ($tables as $table) {
                $this->assertSame($existing[$table], $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
            }
            $this->db->exec('DROP TABLE active_world_events');
            app_state_set_int($this->db, 'scenario_engine:last_tick', 0);
            $marker = $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC);
            try {
                ScenarioEngine::tick($writer, $this->sqlDir);
                $this->fail('Missing active events must not consume the cooldown.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('active_world_events.id', $error->getMessage());
            }
            $this->assertSame($marker, $this->db->query('SELECT * FROM app_state')->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                 AND table_name='active_world_events'"
            )->fetchColumn());
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testSituationRuntimeGuardsAndTicksNeedNoDdl(): void
    {
        if (!function_exists('ensure_situations_tables')) {
            $source = file_get_contents(__DIR__ . '/../../api/situations.php');
            $offset = strpos($source, 'function ensure_situations_tables(');
            $this->assertNotFalse($offset);
            // The endpoint dispatches on import; load its actual helper functions only.
            eval(str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $offset)));
        }
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
            INSERT INTO users VALUES (7),(8);
            CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB;
            INSERT INTO colonies VALUES (42)');
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_gameplay_model_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->db->exec("INSERT INTO situation_states
            (user_id,colony_id,situation_type,progress,monthly_deltas_json,started_at)
            VALUES (7,42,'retained',20,JSON_OBJECT('progress_per_hour',20),DATE_SUB(NOW(),INTERVAL 1 HOUR))");
        $id = (int) $this->db->lastInsertId();
        $before = $this->db->query('SELECT * FROM situation_states')->fetchAll(PDO::FETCH_ASSOC);
        $username = 'gq_situation_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $connect = function () use ($username, $password): PDO {
                $connection = new PDO(
                    (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
                );
                $connection->exec('USE `' . $this->database . '`');
                return $connection;
            };
            $reader = $connect();
            ensure_situations_tables($reader);
            $this->assertSame($before[0], load_user_situation($reader, $id, 7));
            $this->assertNull(load_user_situation($reader, $id, 8));
            $this->assertSame($before, $this->db->query('SELECT * FROM situation_states')->fetchAll(PDO::FETCH_ASSOC));
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = $connect();
            $writer->beginTransaction();
            ensure_situations_tables($writer);
            $result = tick_situation($writer, load_user_situation($writer, $id, 7), 7);
            $this->assertTrue($writer->inTransaction());
            $this->assertSame('active', $result['status']);
            $this->assertGreaterThanOrEqual(40.0, $result['progress']);
            $this->assertSame(2, $result['stage']);
            $this->assertSame(1, (int) $writer->query('SELECT COUNT(*) FROM situation_stage_log')->fetchColumn());
            $writer->rollBack();
            $this->assertSame($before, $this->db->query('SELECT * FROM situation_states')->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM situation_stage_log')->fetchColumn());
            tick_situation($writer, load_user_situation($writer, $id, 7), 7);
            $log = $reader->query('SELECT * FROM situation_stage_log')->fetch(PDO::FETCH_ASSOC);
            $this->assertSame(1, (int) $log['old_stage']);
            $this->assertSame(2, (int) $log['new_stage']);
            $this->assertSame('progress_update', $log['reason']);
            $this->db->exec('DELETE FROM colonies WHERE id=42');
            $this->assertNull(load_user_situation($reader, $id, 7)['colony_id']);
            $this->assertSame(1, (int) $reader->query('SELECT COUNT(*) FROM situation_stage_log')->fetchColumn());
            $this->db->exec('DELETE FROM users WHERE id=7');
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM situation_states')->fetchColumn());
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM situation_stage_log')->fetchColumn());
            $this->db->exec('DROP TABLE situation_stage_log');
            try {
                ensure_situations_tables($reader);
                $this->fail('Earlier success must not hide missing stage history.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('situation_stage_log.id', $error->getMessage());
            }
            $this->db->exec('DROP TABLE situation_states');
            try {
                ensure_situations_tables($reader);
                $this->fail('Missing situation storage must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('situation_states.id', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                 AND table_name IN ('situation_states','situation_stage_log')"
            )->fetchColumn());
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testAccountStorageRuntimeNeedsOnlySelectAndPreservesExistingProfiles(): void
    {
        require_once __DIR__ . '/../../api/character_profile_generator.php';
        if (!function_exists('ensure_homeworld_support_tables')) {
            $source = file_get_contents(__DIR__ . '/../../api/auth.php');
            $start = strpos($source, 'function ensure_homeworld_support_tables(');
            $end = strpos($source, 'function render_story_template(', $start);
            $this->assertNotFalse($start);
            $this->assertNotFalse($end);
            // Auth dispatch exits on import; load only the actual helper under test.
            eval(str_replace('__DIR__', var_export(realpath(__DIR__ . '/../../api'), true), substr($source, $start, $end - $start)));
        }
        $schema = $this->readSqlForTestDatabase('schema.sql');
        $this->db->exec('CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
            INSERT INTO users VALUES (7);
            CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB;
            INSERT INTO colonies VALUES (42)');
        foreach (['ships', 'messages', 'user_character_profiles'] as $table) {
            preg_match('/CREATE TABLE IF NOT EXISTS ' . $table . '\s*\(.*?\) ENGINE=InnoDB;/s', $schema, $matches);
            $this->assertNotEmpty($matches);
            $this->db->exec($matches[0]);
        }
        $this->db->exec("INSERT INTO ships (colony_id,type,count) VALUES (42,'small_cargo',17);
            INSERT INTO messages (receiver_id,subject,body,is_read)
                VALUES (7,'retained','existing welcome',1);
            INSERT INTO user_character_profiles
                (user_id,race,profession,stance,vita,profile_json,yaml_path,json_path,storage_dir)
                VALUES (7,'custom','pilot','neutral','retained','{}','fixture/profile.yaml',
                    'fixture/profile.json','fixture')");
        $before = [];
        foreach (['ships', 'messages', 'user_character_profiles'] as $table) {
            $before[$table] = $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC);
        }
        $username = 'gq_account_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $reader = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $reader->exec('USE `' . $this->database . '`');
            $reader->beginTransaction();
            ensure_homeworld_support_tables($reader);
            ensure_character_profile_tables($reader);
            $this->assertSame($before['user_character_profiles'][0], ensure_user_character_profile($reader, 7));
            $this->assertTrue($reader->inTransaction());
            $reader->rollBack();
            ensure_homeworld_support_tables($reader);
            ensure_character_profile_tables($reader);
            foreach ($before as $table => $rows) {
                $this->assertSame($rows, $this->db->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC));
            }
            $this->db->exec('DROP TABLE messages');
            try {
                ensure_homeworld_support_tables($reader);
                $this->fail('Missing message storage must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('messages.id', $error->getMessage());
            }
            $this->db->exec('DROP TABLE ships');
            try {
                ensure_homeworld_support_tables($reader);
                $this->fail('Missing ship storage must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('ships.id', $error->getMessage());
            }
            $this->db->exec('ALTER TABLE user_character_profiles DROP COLUMN last_error');
            try {
                ensure_user_character_profile($reader, 7);
                $this->fail('Incomplete profile schema must not return success or generate assets.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('user_character_profiles.last_error', $error->getMessage());
            }
            $this->assertSame('retained', $this->db->query(
                'SELECT vita FROM user_character_profiles WHERE user_id=7'
            )->fetchColumn());
            $this->db->exec('DROP TABLE user_character_profiles');
            try {
                ensure_user_character_profile($reader, 7);
                $this->fail('Missing profile storage must not generate a success fallback.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('user_character_profiles.id', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                 AND table_name IN ('ships','messages','user_character_profiles')"
            )->fetchColumn());
        } finally {
            if (isset($reader) && $reader->inTransaction()) {
                $reader->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testShipQueueMigrationPreservesPaidWorkAndDefinitions(): void
    {
        $this->db->exec('CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO colonies VALUES (42)');
        $sql = $this->readSqlForTestDatabase('migrate_ship_build_queue_v1.sql');
        $this->db->exec(str_replace('ship_type VARCHAR(64)', 'ship_type VARCHAR(100)', $sql));
        $this->db->exec("INSERT INTO ship_build_queue
            (colony_id,ship_type,quantity,cost_metal,duration_secs,status,eta)
            VALUES (42,'paid_ship',3,789,60,'running','2024-01-01 00:00:00')");
        $before = $this->db->query('SELECT * FROM ship_build_queue')->fetchAll(PDO::FETCH_ASSOC);
        $definition = $this->db->query('SHOW CREATE TABLE ship_build_queue')->fetch(PDO::FETCH_NUM);
        $runner = $this->buildRunner($sql);
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        $this->db->exec($sql);
        $this->assertSame($before, $this->db->query('SELECT * FROM ship_build_queue')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($definition, $this->db->query('SHOW CREATE TABLE ship_build_queue')->fetch(PDO::FETCH_NUM));
    }

    public function testProductionRuntimeGuardsAndVesselSpawnNeedNoDdl(): void
    {
        require_once __DIR__ . '/../../api/buildings.php';
        require_once __DIR__ . '/../../api/shipyard_queue.php';
        $this->db->exec('CREATE TABLE colonies (id INT PRIMARY KEY, user_id INT) ENGINE=InnoDB;
            INSERT INTO colonies VALUES (42,7);
            CREATE TABLE ships (colony_id INT, type VARCHAR(64), count INT,
                UNIQUE KEY unique_ship (colony_id,type)) ENGINE=InnoDB;
            CREATE TABLE vessel_blueprints (id BIGINT PRIMARY KEY, compiled_stats_json JSON) ENGINE=InnoDB;
            INSERT INTO vessel_blueprints VALUES (19,JSON_OBJECT("hull",250))');
        try {
            ensure_ship_build_queue_table($this->db);
            $this->fail('Missing queue must not be created.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('ship_build_queue.id', $error->getMessage());
        }
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_ship_build_queue_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->db->exec($this->readSqlForTestDatabase('migrate_vessel_blueprints_v5.sql'));
        $schema = $this->readSqlForTestDatabase('schema.sql');
        preg_match('/CREATE TABLE IF NOT EXISTS building_upgrade_queue\s*\(.*?\) ENGINE=InnoDB;/s', $schema, $matches);
        $this->assertNotEmpty($matches);
        $this->db->exec($matches[0]);
        $username = 'gq_production_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $connect = function () use ($username, $password): PDO {
                $connection = new PDO(
                    (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
                );
                $connection->exec('USE `' . $this->database . '`');
                return $connection;
            };
            $reader = $connect();
            ensure_building_upgrade_queue_table($reader);
            ensure_ship_build_queue_table($reader);
            ensure_built_vessels_table($reader);
            $this->assertFalse(ship_build_queue_has_pending($reader, 42));
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = $connect();
            $writer->beginTransaction();
            spawn_built_vessels($writer, 42, 7, 19, 2);
            $this->assertTrue($writer->inTransaction());
            $this->assertSame(2, (int) $writer->query('SELECT COUNT(*) FROM built_vessels')->fetchColumn());
            $writer->rollBack();
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM built_vessels')->fetchColumn());
            spawn_built_vessels($writer, 42, 7, 19, 2);
            $rows = $reader->query('SELECT * FROM built_vessels')->fetchAll(PDO::FETCH_ASSOC);
            $this->assertCount(2, $rows);
            foreach ($rows as $row) {
                $this->assertSame('docked', $row['status']);
                $this->assertSame(['hull' => 250], json_decode($row['snapshot_stats_json'], true));
                $this->assertSame(['hp' => 250, 'max_hp' => 250], json_decode($row['hp_state_json'], true));
            }
            $writer->exec("INSERT INTO ship_build_queue
                (colony_id,ship_type,blueprint_id,quantity,duration_secs,status,eta)
                VALUES (42,'small_cargo',19,2,60,'running','2024-01-01 00:00:00')");
            $this->assertTrue(ship_build_queue_has_pending($reader, 42));
            complete_ship_build_queue($writer, 42);
            $this->assertSame(2, (int) $reader->query('SELECT count FROM ships')->fetchColumn());
            $this->assertSame(4, (int) $reader->query('SELECT COUNT(*) FROM built_vessels')->fetchColumn());
            $this->assertFalse(ship_build_queue_has_pending($reader, 42));
            complete_ship_build_queue($writer, 42);
            $this->assertSame(2, (int) $reader->query('SELECT count FROM ships')->fetchColumn());
            $this->assertSame(4, (int) $reader->query('SELECT COUNT(*) FROM built_vessels')->fetchColumn());
            $writer->exec("INSERT INTO ship_build_queue
                (colony_id,ship_type,blueprint_id,quantity,duration_secs,status,eta)
                VALUES (42,'small_cargo',19,2,60,'running','2024-01-01 00:00:00')");
            $this->db->exec('DROP TABLE built_vessels');
            $before = $this->db->query('SELECT * FROM ship_build_queue')->fetchAll(PDO::FETCH_ASSOC);
            try {
                complete_ship_build_queue($writer, 42);
                $this->fail('Completion must not hide missing vessel storage.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('built_vessels.id', $error->getMessage());
            }
            $this->assertSame($before, $this->db->query('SELECT * FROM ship_build_queue')->fetchAll(PDO::FETCH_ASSOC));
            $this->assertSame(2, (int) $reader->query('SELECT count FROM ships')->fetchColumn());
            $this->db->exec('DROP TABLE building_upgrade_queue');
            try {
                ensure_building_upgrade_queue_table($reader);
                $this->fail('Earlier success must not hide missing building storage.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('building_upgrade_queue.id', $error->getMessage());
            }
            $this->db->exec('DELETE FROM colonies WHERE id=42');
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM ship_build_queue')->fetchColumn());
            $this->db->exec('DROP TABLE ship_build_queue');
            try {
                ensure_ship_build_queue_table($reader);
                $this->fail('Earlier success must not hide missing ship storage.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('ship_build_queue.id', $error->getMessage());
            }
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testFactionGovernmentMigrationPreservesPartialLegacyStorage(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $this->db->exec("CREATE TABLE faction_government (
            faction_id INT PRIMARY KEY,
            government_form VARCHAR(64) NOT NULL DEFAULT 'custom',
            stability_score INT NOT NULL DEFAULT 17,
            last_form_change DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB");
        $id = (int) $this->db->query('SELECT MIN(id) FROM npc_factions')->fetchColumn();
        $this->db->exec("INSERT INTO faction_government VALUES ($id,'retained',83,'2024-01-01 00:00:00')");
        $before = $this->db->query('SELECT * FROM faction_government')->fetchAll(PDO::FETCH_ASSOC);
        $definition = $this->db->query('SHOW CREATE TABLE faction_government')->fetch(PDO::FETCH_NUM);
        try {
            ensure_government_tables($this->db);
            $this->fail('Missing alliances must not be created.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('faction_alliances.faction_a_id', $error->getMessage());
        }
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_faction_government_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        ensure_government_tables($this->db);
        $this->assertSame($before, $this->db->query('SELECT * FROM faction_government')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($definition, $this->db->query('SHOW CREATE TABLE faction_government')->fetch(PDO::FETCH_NUM));
        $this->db->exec($this->readSqlForTestDatabase('migrate_faction_government_v1.sql'));
        $this->assertSame($before, $this->db->query('SELECT * FROM faction_government')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
    }

    public function testFactionGovernmentRuntimeAndSeedsNeedNoDdlAndPreserveData(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_faction_government_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $username = 'gq_diplomacy_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $reader = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $reader->exec('USE `' . $this->database . '`');
            ensure_pve_faction_tables($reader);
            ensure_government_tables($reader);
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.* TO ' . $account);
            $writer = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );
            $writer->exec('USE `' . $this->database . '`');
            $writer->beginTransaction();
            ensure_pve_factions_seed($writer);
            ensure_diplomacy_initialized($writer);
            $this->assertTrue($writer->inTransaction());
            $factions = (int) $writer->query('SELECT COUNT(*) FROM npc_factions')->fetchColumn();
            $this->assertGreaterThan(1, $factions);
            $this->assertSame($factions, (int) $writer->query('SELECT COUNT(*) FROM faction_government')->fetchColumn());
            $this->assertSame(intdiv($factions * ($factions - 1), 2), (int) $writer->query(
                'SELECT COUNT(*) FROM faction_alliances'
            )->fetchColumn());
            $writer->rollBack();
            $this->assertSame(0, (int) $reader->query('SELECT COUNT(*) FROM faction_government')->fetchColumn());
            ensure_pve_factions_seed($writer);
            ensure_diplomacy_initialized($writer);
            $this->db->exec('UPDATE faction_government SET stability_score=29');
            $this->db->exec('UPDATE faction_alliances SET alliance_strength=-13');
            $tables = ['npc_factions', 'faction_quests', 'faction_government', 'faction_alliances', 'app_state'];
            $before = [];
            foreach ($tables as $table) {
                $before[$table] = $this->db->query('SELECT * FROM ' . $table . ' ORDER BY 1,2')->fetchAll(PDO::FETCH_ASSOC);
            }
            ensure_pve_factions_seed($writer);
            ensure_diplomacy_initialized($writer);
            $this->db->exec($this->readSqlForTestDatabase('migrate_faction_government_v1.sql'));
            foreach ($tables as $table) {
                $this->assertSame($before[$table], $this->db->query(
                    'SELECT * FROM ' . $table . ' ORDER BY 1,2'
                )->fetchAll(PDO::FETCH_ASSOC), $table . ' must survive repeated seed/migration.');
            }
            $ids = $this->db->query('SELECT id FROM npc_factions ORDER BY id LIMIT 2')->fetchAll(PDO::FETCH_COLUMN);
            $this->db->exec("INSERT INTO faction_standing_adjustments (user_id,faction_id,adjustment,reason)
                VALUES (42,{$ids[0]},9,'retained')");
            $this->db->exec('DELETE FROM npc_factions WHERE id=' . (int) $ids[0]);
            $this->assertSame(0, (int) $this->db->query(
                'SELECT COUNT(*) FROM faction_government WHERE faction_id=' . (int) $ids[0]
            )->fetchColumn());
            $this->assertSame(0, (int) $this->db->query(
                'SELECT COUNT(*) FROM faction_alliances WHERE faction_a_id=' . (int) $ids[0]
                . ' OR faction_b_id=' . (int) $ids[0]
            )->fetchColumn());
            $this->assertSame(0, (int) $this->db->query('SELECT COUNT(*) FROM faction_standing_adjustments')->fetchColumn());
            $this->db->exec('DROP TABLE faction_standing_adjustments');
            try {
                ensure_government_tables($reader);
                $this->fail('Missing adjustments must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('faction_standing_adjustments.id', $error->getMessage());
            }
            $this->db->exec('DROP TABLE IF EXISTS npc_quest_generation_log');
            $this->db->exec('DROP TABLE user_faction_quests');
            $this->db->exec('DROP TABLE faction_quests');
            try {
                ensure_pve_faction_tables($reader);
                $this->fail('Missing quests must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('faction_quests.id', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                 AND table_name IN ('faction_quests','faction_standing_adjustments')"
            )->fetchColumn());
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testAppStateMigrationPreservesExistingDataAndDefinitions(): void
    {
        $this->db->exec("CREATE TABLE app_state (
            state_key VARCHAR(64) PRIMARY KEY,
            state_value VARCHAR(512) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB");
        $this->db->exec("INSERT INTO app_state VALUES
            ('seed:completed','1','2024-01-01 00:00:00'),
            ('custom:payload','retained','2024-01-02 00:00:00')");
        $before = $this->db->query('SELECT * FROM app_state ORDER BY state_key')->fetchAll(PDO::FETCH_ASSOC);
        $definition = $this->db->query('SHOW CREATE TABLE app_state')->fetch(PDO::FETCH_NUM);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_app_state_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        $this->db->exec($this->readSqlForTestDatabase('migrate_app_state_v1.sql'));
        $this->assertSame($before, $this->db->query('SELECT * FROM app_state ORDER BY state_key')->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($definition, $this->db->query('SHOW CREATE TABLE app_state')->fetch(PDO::FETCH_NUM));
    }

    public function testAppStateMigrationAndAccessorsWorkWithoutDdlPrivileges(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        try {
            app_state_get_int($this->db, 'missing', 42);
            $this->fail('Missing storage must fail instead of returning a default.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('app_state.state_key', $error->getMessage());
        }
        $this->assertSame(0, (int) $this->db->query(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='app_state'"
        )->fetchColumn());
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_app_state_v1.sql'));
        $runner->runUp();
        $username = 'gq_state_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.app_state TO ' . $account);
            $connect = function () use ($username, $password): PDO {
                $connection = new PDO(
                    (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
                );
                $connection->exec('USE `' . $this->database . '`');
                return $connection;
            };
            $reader = $connect();
            ensure_app_state_table($reader);
            $this->assertSame(42, app_state_get_int($reader, 'missing', 42));
            $this->db->exec("INSERT INTO app_state VALUES ('nonnumeric','abc',CURRENT_TIMESTAMP)");
            $this->assertSame(7, app_state_get_int($reader, 'nonnumeric', 7));
            try {
                app_state_set_int($reader, 'denied', 1);
                $this->fail('SELECT-only writes must propagate a rights error.');
            } catch (PDOException $error) {
                $this->assertSame(1142, (int) $error->errorInfo[1]);
            }
            $this->admin->exec('GRANT INSERT, UPDATE ON `' . $this->database . '`.app_state TO ' . $account);
            $writer = $connect();
            $writer->beginTransaction();
            app_state_set_int($writer, 'tick:last', -17);
            $this->assertTrue($writer->inTransaction(), 'Runtime preflight must not implicitly commit.');
            $this->assertSame(-17, app_state_get_int($writer, 'tick:last'));
            $writer->rollBack();
            $this->assertSame(99, app_state_get_int($reader, 'tick:last', 99));
            app_state_set_int($writer, 'tick:last', 123);
            app_state_set_int($writer, 'tick:last', 456);
            $this->assertSame(456, app_state_get_int($reader, 'tick:last'));
            $this->assertSame(1, (int) $this->db->query(
                "SELECT COUNT(*) FROM app_state WHERE state_key='tick:last' AND updated_at IS NOT NULL"
            )->fetchColumn());
            $this->db->exec('DROP TABLE app_state');
            try {
                app_state_set_int($writer, 'tick:last', 1);
                $this->fail('Missing storage must not be recreated.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('app_state.state_key', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='app_state'"
            )->fetchColumn());
        } finally {
            if (isset($writer) && $writer->inTransaction()) {
                $writer->rollBack();
            }
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testWhiteDwarfMigrationPreservesStarsAndWorksWithSelectOnlyRuntime(): void
    {
        require_once __DIR__ . '/../../lib/GalaxySchema.php';
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $this->db->exec("INSERT INTO star_systems (galaxy_index,system_index,name,spectral_class)
            VALUES (1,1,'Existing star','G')");
        $before = $this->db->query('SELECT * FROM star_systems')->fetchAll(PDO::FETCH_ASSOC);
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_star_spectral_wd_v1.sql'));
        $runner->runUp();
        $this->assertSame($before, $this->db->query('SELECT * FROM star_systems')->fetchAll(PDO::FETCH_ASSOC));
        $this->db->exec("INSERT INTO star_systems (galaxy_index,system_index,name,spectral_class,stellar_type)
            VALUES (1,2,'White dwarf','WD','white_dwarf')");
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        $username = 'gq_galaxy_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $limited = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            $limited->exec('USE `' . $this->database . '`');
            ensure_star_system_columns($limited);
            ensure_binary_systems_table($limited);
            $this->assertSame(2, (int) $limited->query('SELECT COUNT(*) FROM star_systems')->fetchColumn());
            $this->db->exec('DROP TABLE binary_systems');
            try {
                ensure_binary_systems_table($limited);
                $this->fail('Missing table must not be created by runtime.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('binary_systems.id', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='binary_systems'"
            )->fetchColumn());
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    public function testOutdatedStarSchemaFailsWithoutChangingType(): void
    {
        require_once __DIR__ . '/../../lib/GalaxySchema.php';
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $before = $this->db->query("SHOW COLUMNS FROM star_systems LIKE 'spectral_class'")->fetch(PDO::FETCH_ASSOC);
        try {
            \GalaxyQuest\Schema\GalaxySchema::assertStars($this->db);
            $this->fail('Unmigrated WD schema must not pass.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('Star spectral schema is outdated', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query("SHOW COLUMNS FROM star_systems LIKE 'spectral_class'")->fetch(PDO::FETCH_ASSOC));
    }

    public function testPlanetScienceMigrationUpgradesLegacyAndPreservesPartialData(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        $this->db->exec($this->readSqlForTestDatabase('schema.sql'));
        $this->db->exec("INSERT INTO planets (galaxy,`system`,position,composition_family,habitability_score,species_affinity_json)
            VALUES (1,1,1,'custom_material',73,JSON_OBJECT('species','retained'))");
        $columns = [
            'dominant_surface_material', 'surface_pressure_bar', 'water_state', 'methane_state',
            'ammonia_state', 'dominant_surface_liquid', 'radiation_level', 'life_friendliness',
        ];
        foreach ($columns as $column) {
            $this->db->exec('ALTER TABLE planets DROP COLUMN ' . $column);
        }
        $before = $this->db->query('SELECT * FROM planets')->fetchAll(PDO::FETCH_ASSOC);
        try {
            ensure_planet_science_columns($this->db);
            $this->fail('Missing science schema must not repair itself.');
        } catch (RuntimeException $error) {
            $this->assertStringContainsString('planets.dominant_surface_material', $error->getMessage());
        }
        $this->assertSame($before, $this->db->query('SELECT * FROM planets')->fetchAll(PDO::FETCH_ASSOC));
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_planet_science_v1.sql'));
        $this->assertCount(1, $runner->runUp());
        $row = $this->db->query('SELECT * FROM planets')->fetch(PDO::FETCH_ASSOC);
        foreach ($before[0] as $column => $value) {
            $this->assertSame($value, $row[$column], 'Existing column changed: ' . $column);
        }
        $this->assertSame('basaltic_regolith', $row['dominant_surface_material']);
        $this->assertSame(0.0, (float) $row['surface_pressure_bar']);
        $this->assertSame('solid', $row['water_state']);
        $this->assertSame('gas', $row['methane_state']);
        $this->assertSame('gas', $row['ammonia_state']);
        $this->assertSame('none', $row['dominant_surface_liquid']);
        $this->assertSame('moderate', $row['radiation_level']);
        $this->assertSame('life_hostile', $row['life_friendliness']);
        ensure_planet_science_columns($this->db);
        $this->assertSame([], $runner->runUp());
        $this->assertSame(1, $runner->verifyDeployment());
        // Direct replay must also preserve all existing science values.
        $this->db->exec($this->readSqlForTestDatabase('migrate_planet_science_v1.sql'));
        $this->assertSame($row, $this->db->query('SELECT * FROM planets')->fetch(PDO::FETCH_ASSOC));
    }

    public function testPlanetScienceMigrationAddsAllMissingColumnsAndRuntimeNeedsOnlySelect(): void
    {
        require_once __DIR__ . '/../../api/galaxy_seed.php';
        $this->db->exec('CREATE TABLE planets (id INT PRIMARY KEY, name VARCHAR(32))');
        $this->db->exec("INSERT INTO planets VALUES (42, 'Existing planet')");
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_planet_science_v1.sql'));
        $runner->runUp();
        $row = $this->db->query('SELECT * FROM planets')->fetch(PDO::FETCH_ASSOC);
        $this->assertSame(42, $row['id']);
        $this->assertSame('Existing planet', $row['name']);
        $this->assertSame('silicate_metal', $row['composition_family']);
        $this->assertSame(0, $row['habitability_score']);
        $this->assertNull($row['species_affinity_json']);
        $username = 'gq_planet_' . bin2hex(random_bytes(6));
        $account = $this->admin->quote($username) . "@'%'";
        $password = bin2hex(random_bytes(16));
        $this->admin->exec('CREATE USER ' . $account . ' IDENTIFIED BY ' . $this->admin->quote($password));
        try {
            $this->admin->exec('GRANT SELECT ON `' . $this->database . '`.* TO ' . $account);
            $limited = new PDO(
                (string) getenv('GQ_MIGRATION_TEST_DSN'), $username, $password,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            $limited->exec('USE `' . $this->database . '`');
            ensure_planet_science_columns($limited);
            $this->assertSame($row, $limited->query('SELECT * FROM planets')->fetch(PDO::FETCH_ASSOC));
            $this->db->exec('ALTER TABLE planets DROP COLUMN water_state');
            try {
                ensure_planet_science_columns($limited);
                $this->fail('SELECT-only runtime must reject missing column.');
            } catch (RuntimeException $error) {
                $this->assertStringContainsString('planets.water_state', $error->getMessage());
            }
            $this->assertSame(0, (int) $this->db->query(
                "SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema=DATABASE() AND table_name='planets' AND column_name='water_state'"
            )->fetchColumn());
        } finally {
            $this->admin->exec('DROP USER ' . $account);
        }
    }

    /** @return iterable<string, array{bool}> */
    public static function projectionTimestampModes(): iterable
    {
        yield 'new timestamp column' => [false];
        yield 'existing timestamp column' => [true];
    }

    #[DataProvider('projectionTimestampModes')]
    public function testProjectionMigrationPreservesHistoricalTimestampsInStrictMode(bool $existing): void
    {
        $this->db->exec($this->readSqlForTestDatabase('migrate_projection_system_snapshot_v1.sql'));
        $strictMode = (string)$this->db->query('SELECT @@SESSION.sql_mode')->fetchColumn();
        $this->assertStringContainsString('STRICT_TRANS_TABLES', $strictMode);
        if ($existing) {
            $this->db->exec('ALTER TABLE projection_dirty_queue ADD created_at DATETIME NULL');
        }
        $this->db->exec(
            "INSERT INTO projection_dirty_queue (entity_id, enqueued_at) VALUES
                (1, '2026-01-02 03:04:05'), (2, '2026-02-03 04:05:06');"
        );
        if ($existing) {
            $this->db->exec("UPDATE projection_dirty_queue SET created_at = '2026-03-04 05:06:07' WHERE entity_id = 1");
            $this->db->exec("SET SESSION sql_mode = ''");
            $this->db->exec(
                "INSERT INTO projection_dirty_queue (entity_id, enqueued_at, created_at)
                 VALUES (3, '2026-04-05 06:07:08', '0000-00-00 00:00:00')"
            );
            $this->db->prepare('SET SESSION sql_mode = ?')->execute([$strictMode]);
        }
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_projection_runtime_v2.sql'));
        $runner->runUp();
        $expected = $existing
            ? ['2026-03-04 05:06:07', '2026-02-03 04:05:06', '2026-04-05 06:07:08']
            : ['2026-01-02 03:04:05', '2026-02-03 04:05:06'];
        $this->assertSame($expected, $this->db->query(
            'SELECT created_at FROM projection_dirty_queue ORDER BY entity_id'
        )->fetchAll(PDO::FETCH_COLUMN));
        $this->assertSame($strictMode, $this->db->query('SELECT @@SESSION.sql_mode')->fetchColumn());
        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();
        $this->assertSame($expected, $this->db->query(
            'SELECT created_at FROM projection_dirty_queue ORDER BY entity_id'
        )->fetchAll(PDO::FETCH_COLUMN));
        $this->assertSame(1, $this->trackingCount());
    }

    public function testNpcFtlMigrationAndRuntimeUseMembershipAndPreserveOtherAccounts(): void
    {
        $this->requireNpcAiWithoutGlobalErrorHandlers();
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY, control_type VARCHAR(24), ftl_drive_type VARCHAR(30)) ENGINE=InnoDB;
             CREATE TABLE npc_factions (id INT PRIMARY KEY, code VARCHAR(32)) ENGINE=InnoDB;'
        );
        $this->db->exec($this->readSqlForTestDatabase('migrate_vessel_blueprints_v12_npc_ftl.sql'));
        $codes = [
            'empire' => 'vor_tak', 'pve_empire' => 'vor_tak',
            'science' => 'zhareen', 'pve_science' => 'zhareen',
            'pirates' => 'kryl_tha', 'pve_pirates' => 'kryl_tha',
            'precursors' => 'vel_ar', 'pve_precursors' => 'vel_ar',
            'guild' => 'syl_nar', 'pve_guild' => 'syl_nar',
            'collective' => 'aereth',
        ];
        $expected = [];
        $id = 0;
        foreach ($codes as $code => $drive) {
            $id++;
            $this->db->prepare('INSERT INTO npc_factions VALUES (?, ?)')->execute([$id, $code]);
            $this->db->prepare("INSERT INTO users VALUES (?, 'npc_engine', 'aereth')")->execute([$id]);
            $this->db->prepare('INSERT INTO npc_faction_memberships VALUES (?, ?)')->execute([$id, $id]);
            $expected[$id] = $drive;
        }
        $this->db->exec(
            "INSERT INTO users VALUES (90, 'human', 'aereth'), (91, 'npc_engine', 'vel_ar'), (92, 'npc_engine', 'aereth');
             INSERT INTO npc_faction_memberships VALUES (90, 1), (91, 1);"
        );
        $expected += [90 => 'aereth', 91 => 'vel_ar', 92 => 'aereth'];
        $runner = $this->buildRunner($this->readSqlForTestDatabase('migrate_vessel_blueprints_v12_npc_ftl.sql'));
        $runner->runUp();
        foreach ($expected as $userId => $drive) {
            $this->assertSame($drive, $this->db->query(
                'SELECT ftl_drive_type FROM users WHERE id = ' . $userId
            )->fetchColumn());
        }
        $this->db->exec("UPDATE users SET ftl_drive_type = 'aereth' WHERE id < 90");
        foreach ($expected as $userId => $drive) {
            npc_assign_ftl_drive($this->db, $userId);
            npc_assign_ftl_drive($this->db, $userId);
            $this->assertSame($drive, $this->db->query(
                'SELECT ftl_drive_type FROM users WHERE id = ' . $userId
            )->fetchColumn());
        }
    }

    public function testDdlMigrationIsTrackedAndNotReapplied(): void
    {
        $sql = 'CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB;
                INSERT INTO example VALUES (1);
                ALTER TABLE example ADD label VARCHAR(20);
                UPDATE example SET label = \'ready\';';
        $runner = $this->buildRunner($sql);

        $result = $runner->runUp();

        $this->assertCount(1, $result);
        $this->assertSame(4, $result[0]['statements']);
        $this->assertSame('ready', $this->db->query('SELECT label FROM example')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
        $this->assertSame(md5($sql), $runner->getStatus()[0]['checksum']);
        $this->assertSame([], $runner->runUp());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDdlRollbackRemovesTracking(): void
    {
        $runner = $this->buildRunner(
            'CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB;',
            'DROP TABLE example;'
        );
        $runner->runUp();

        $this->assertSame('rolled_back', $runner->runRollback()[0]['status']);
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame([], $this->db->query("SHOW TABLES LIKE 'example'")->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDdlFailurePreservesOriginalErrorAndDoesNotTrackMigration(): void
    {
        $runner = $this->buildRunner('CREATE TABLE example (id INT); THIS IS NOT SQL;');

        try {
            $runner->runUp();
            $this->fail('Expected migration failure.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Migration "migration.sql" failed:', $e->getMessage());
            $this->assertStringContainsString('Changes may already be committed', $e->getMessage());
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('42000', $e->getPrevious()->getCode());
        }

        $this->assertSame(0, $this->trackingCount());
        $this->assertCount(1, $this->db->query("SHOW TABLES LIKE 'example'")->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDdlRollbackFailureKeepsTrackingAndOriginalError(): void
    {
        $runner = $this->buildRunner(
            'CREATE TABLE example (id INT);',
            'DROP TABLE example; THIS IS NOT SQL;'
        );
        $runner->runUp();

        try {
            $runner->runRollback();
            $this->fail('Expected rollback failure.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Rollback of "migration.sql" failed:', $e->getMessage());
            $this->assertStringContainsString('Changes may already be committed', $e->getMessage());
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('42000', $e->getPrevious()->getCode());
        }

        $this->assertSame(1, $this->trackingCount());
        $this->assertSame([], $this->db->query("SHOW TABLES LIKE 'example'")->fetchAll());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlMigrationCommitsDataAndTracking(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1);');

        $runner->runUp();

        $this->assertSame('1', (string)$this->db->query('SELECT id FROM example')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlFailureRollsBackData(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1); INSERT INTO example VALUES (1);');

        try {
            $runner->runUp();
            $this->fail('Expected duplicate-key failure.');
        } catch (RuntimeException $e) {
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('23000', $e->getPrevious()->getCode());
        }

        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM example')->fetchColumn());
        $this->assertSame(0, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlRollbackCommitsDeletionAndTrackingRemoval(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1);', 'DELETE FROM example;');
        $runner->runUp();

        $this->assertSame('rolled_back', $runner->runRollback()[0]['status']);
        $this->assertSame(0, (int)$this->db->query('SELECT COUNT(*) FROM example')->fetchColumn());
        $this->assertSame(0, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    public function testDmlRollbackFailureRestoresDataAndKeepsTracking(): void
    {
        $this->db->exec('CREATE TABLE example (id INT PRIMARY KEY) ENGINE=InnoDB');
        $runner = $this->buildRunner('INSERT INTO example VALUES (1);', 'DELETE FROM example; THIS IS NOT SQL;');
        $runner->runUp();

        try {
            $runner->runRollback();
            $this->fail('Expected rollback failure.');
        } catch (RuntimeException $e) {
            $this->assertInstanceOf(PDOException::class, $e->getPrevious());
            $this->assertSame('42000', $e->getPrevious()->getCode());
        }

        $this->assertSame(1, (int)$this->db->query('SELECT COUNT(*) FROM example')->fetchColumn());
        $this->assertSame(1, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    /** @return iterable<string, array{string, int}> */
    public static function conditionalAlterFiles(): iterable
    {
        yield 'legacy v2' => ['migrate_v2.sql', 71];
        yield 'colonization' => ['migrate_colonization_v2.sql', 4];
        yield 'FTL drives' => ['migrate_vessel_blueprints_v10_ftl_drives.sql', 2];
        yield 'FTL phase 4' => ['migrate_vessel_blueprints_v11_ftl_phase4.sql', 2];
        yield 'fleet labels' => ['migrate_fleet_labels_v1.sql', 1];
        yield 'projection runtime' => ['migrate_projection_runtime_v2.sql', 8];
    }

    #[DataProvider('conditionalAlterFiles')]
    public function testActualConditionalAltersSupportPartialSchemasAndReexecution(string $file, int $guardCount): void
    {
        foreach ([
            'users' => 'is_admin TINYINT',
            'star_systems' => 'frost_line_au DOUBLE, name VARCHAR(16)',
            'planets' => 'user_id INT, type VARCHAR(20), temp_max INT',
            'buildings' => '',
            'ships' => '',
            'fleets' => '',
            'colonies' => '',
            'battle_reports' => 'attacker_id INT, defender_id INT, created_at DATETIME',
            'research' => 'research_end DATETIME',
            'projection_dirty_queue' => 'entity_id VARCHAR(60), next_attempt_at DATETIME',
        ] as $table => $columns) {
            $this->db->exec(
                'CREATE TABLE ' . $table . ' (id INT PRIMARY KEY'
                . ($columns !== '' ? ', ' . $columns : '') . ') ENGINE=InnoDB'
            );
        }

        $runner = $this->buildRunner('SELECT 1;');
        $source = file_get_contents(__DIR__ . '/../../sql/' . $file);
        $this->assertNotFalse($source);
        $statements = $runner->splitStatements($source);
        $guards = [];
        foreach ($statements as $index => $statement) {
            if (str_starts_with($statement, 'SET @sql = IF(')
                && str_contains($statement, 'information_schema.')) {
                $this->assertSame('PREPARE _stmt FROM @sql', $statements[$index + 1]);
                $this->assertSame('EXECUTE _stmt', $statements[$index + 2]);
                $this->assertSame('DEALLOCATE PREPARE _stmt', $statements[$index + 3]);
                $guards[] = implode(";\n", array_slice($statements, $index, 4)) . ';';
            }
        }
        $this->assertCount($guardCount, $guards);

        // Apply the first guard independently to model an interrupted deployment.
        $this->buildRunner($guards[0])->runUp();
        $alterGuards = array_values(array_filter($guards, static fn(string $guard): bool => str_contains($guard, "'ALTER TABLE ")));
        $this->db->exec('DELETE FROM schema_migrations');
        $runner = $this->buildRunner(implode("\n", $alterGuards));
        $this->assertSame(count($alterGuards) * 4, $runner->runUp()[0]['statements']);
        $this->assertSame(1, $this->trackingCount());
        foreach ($alterGuards as $guard) {
            $this->assertSame(1, preg_match(
                '/\((SELECT COUNT\(\*\) FROM information_schema\.[\s\S]*?)\) = 0,/',
                $guard,
                $match
            ));
            $this->assertGreaterThan(0, (int)$this->db->query($match[1])->fetchColumn());
        }
        if ($file === 'migrate_vessel_blueprints_v11_ftl_phase4.sql') {
            $this->assertSame(
                "Vel'Ar FTL: fleet hidden from enemies until this timestamp",
                $this->db->query(
                    "SELECT COLUMN_COMMENT FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fleets'
                       AND COLUMN_NAME = 'stealth_until'"
                )->fetchColumn()
            );
        }

        $snapshot = $this->db->query(
            'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION'
        )->fetchAll(PDO::FETCH_ASSOC);
        $indexes = $this->db->query(
            'SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'
        )->fetchAll(PDO::FETCH_ASSOC);

        $this->db->exec('DELETE FROM schema_migrations');
        $runner->runUp();

        $this->assertSame($snapshot, $this->db->query(
            'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION'
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame($indexes, $this->db->query(
            'SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX'
        )->fetchAll(PDO::FETCH_ASSOC));
        $this->assertSame(1, $this->trackingCount());
        $this->assertFalse($this->db->inTransaction());
    }

    private function vesselBlueprintAdoptionRunner(): MigrationRunner
    {
        $this->db->exec(
            "CREATE TABLE users (
                id INT PRIMARY KEY,
                control_type VARCHAR(24) NOT NULL DEFAULT 'human',
                ftl_drive_type VARCHAR(30) NOT NULL DEFAULT 'aereth',
                ftl_cooldown_until DATETIME DEFAULT NULL
            ) ENGINE=InnoDB;
            CREATE TABLE fleets (
                id INT PRIMARY KEY,
                mission ENUM('attack','transport','colonize','harvest','spy','recall') NOT NULL DEFAULT 'transport'
            ) ENGINE=InnoDB;
            CREATE TABLE colonies (id INT PRIMARY KEY) ENGINE=InnoDB;
            CREATE TABLE npc_factions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                code VARCHAR(32) NOT NULL UNIQUE,
                name VARCHAR(128) NOT NULL,
                description TEXT NOT NULL,
                faction_type VARCHAR(32) NOT NULL,
                aggression INT NOT NULL,
                trade_willingness INT NOT NULL,
                base_diplomacy INT NOT NULL,
                power_level INT NOT NULL,
                home_galaxy_min INT NOT NULL,
                home_galaxy_max INT NOT NULL,
                color VARCHAR(16) NOT NULL,
                icon VARCHAR(32) NOT NULL,
                tts_voice VARCHAR(64) DEFAULT NULL
            ) ENGINE=InnoDB;
            CREATE TABLE user_character_profiles (
                user_id INT PRIMARY KEY,
                race VARCHAR(80) NOT NULL
            ) ENGINE=InnoDB;
            CREATE TABLE research (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                type VARCHAR(64) NOT NULL,
                level INT NOT NULL DEFAULT 0,
                research_start DATETIME DEFAULT NULL,
                research_end DATETIME DEFAULT NULL,
                UNIQUE KEY uq_research_user_type (user_id,type)
            ) ENGINE=InnoDB;
            CREATE TABLE faction_quests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                faction_id INT NOT NULL,
                code VARCHAR(64) NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT NOT NULL,
                quest_type VARCHAR(32) NOT NULL,
                requirements_json TEXT NOT NULL,
                reward_metal INT NOT NULL DEFAULT 0,
                reward_crystal INT NOT NULL DEFAULT 0,
                reward_deuterium INT NOT NULL DEFAULT 0,
                reward_rare_earth INT NOT NULL DEFAULT 0,
                reward_dark_matter INT NOT NULL DEFAULT 0,
                reward_rank_points INT NOT NULL DEFAULT 0,
                reward_standing INT NOT NULL DEFAULT 0,
                min_standing INT NOT NULL DEFAULT 0,
                difficulty VARCHAR(32) NOT NULL DEFAULT 'normal',
                repeatable TINYINT(1) NOT NULL DEFAULT 1,
                UNIQUE KEY uq_faction_quest (faction_id,code)
            ) ENGINE=InnoDB"
        );
        $this->db->exec(
            "INSERT INTO npc_factions
                (code,name,description,faction_type,aggression,trade_willingness,base_diplomacy,
                 power_level,home_galaxy_min,home_galaxy_max,color,icon)
             VALUES
                ('empire','Empire','fixture','military',50,50,0,100,1,9,'#000000','E'),
                ('guild','Guild','fixture','trade',50,50,0,100,1,9,'#000000','G'),
                ('pirates','Pirates','fixture','military',50,50,0,100,1,9,'#000000','P'),
                ('precursors','Precursors','fixture','ancient',50,50,0,100,1,9,'#000000','A'),
                ('science','Science','fixture','science',50,50,0,100,1,9,'#000000','S')"
        );
        $insertUser = $this->db->prepare(
            "INSERT INTO users (id,control_type,ftl_drive_type) VALUES (?, 'npc_engine', 'aereth')"
        );
        for ($id = 1; $id <= 10; $id++) {
            $insertUser->execute([$id]);
        }

        $names = [
            'migrate_vessel_blueprints_v1.sql',
            'migrate_vessel_blueprints_v2.sql',
            'migrate_vessel_blueprints_v3.sql',
            'migrate_vessel_blueprints_v4.sql',
            'migrate_vessel_blueprints_v5.sql',
            'migrate_vessel_blueprints_v6_planetary_events.sql',
            'migrate_vessel_blueprints_v7_research_phase5.sql',
            'migrate_vessel_blueprints_v8_wormholes.sql',
            'migrate_vessel_blueprints_v9_wormhole_beacons.sql',
            'migrate_vessel_blueprints_v10_ftl_drives.sql',
            'migrate_vessel_blueprints_v11_ftl_phase4.sql',
        ];
        foreach ($names as $name) {
            copy(__DIR__ . '/../../sql/' . $name, $this->sqlDir . '/' . $name);
        }
        copy(__DIR__ . '/../../sql/schema_migration_adoptions.sql', $this->sqlDir . '/schema_migration_adoptions.sql');
        copy(__DIR__ . '/../../sql/schema_migrations.sql', $this->sqlDir . '/schema_migrations.sql');
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($names, true) . ';');
        $parser = new MigrationRunner($this->db, $this->sqlDir, 'TEST');
        foreach ($names as $name) {
            foreach ($parser->splitStatements($this->readSqlForTestDatabase($name)) as $statement) {
                $result = $this->db->query($statement);
                $result->closeCursor();
            }
        }

        $this->db->exec(
            'CREATE TABLE npc_faction_memberships (
                user_id INT NOT NULL PRIMARY KEY,
                faction_id INT NOT NULL,
                KEY idx_npc_membership_faction (faction_id),
                CONSTRAINT fk_npc_membership_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_npc_membership_faction FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
            ) ENGINE=InnoDB'
        );
        $membership = $this->db->prepare(
            'INSERT INTO npc_faction_memberships (user_id,faction_id)
             SELECT ?,id FROM npc_factions WHERE code=?'
        );
        foreach ([
            1 => 'empire', 2 => 'empire',
            3 => 'guild', 4 => 'guild',
            5 => 'pirates', 6 => 'pirates',
            7 => 'precursors', 8 => 'precursors',
            9 => 'science', 10 => 'science',
        ] as $userId => $code) {
            $membership->execute([$userId, $code]);
            $membership->closeCursor();
        }

        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testVesselBlueprintHistoryAdoptionVerifiesWithoutReplayingV12(): void
    {
        $runner = $this->vesselBlueprintAdoptionRunner();
        $beforeUsers = $this->db->query('SELECT id,ftl_drive_type FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
        $preview = $runner->adoptVesselBlueprintHistory(true);
        $this->assertCount(11, $preview['adopted']);
        $this->assertSame(0, $this->trackingCount());
        $this->assertSame(
            $beforeUsers,
            $this->db->query('SELECT id,ftl_drive_type FROM users ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)
        );

        $adopted = $runner->adoptVesselBlueprintHistory(false);
        $this->assertSame($preview['evidence'], $adopted['evidence']);
        $this->assertCount(11, $adopted['adopted']);
        $this->assertSame(11, $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        $this->assertSame([], $runner->adoptVesselBlueprintHistory(false)['adopted']);
        $this->assertSame(10, (int)$this->db->query(
            "SELECT COUNT(*) FROM users
             WHERE control_type='npc_engine' AND ftl_drive_type='aereth'"
        )->fetchColumn());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM schema_migrations
             WHERE migration_name='migrate_vessel_blueprints_v12_npc_ftl.sql'"
        )->fetchColumn());
    }

    private function warHistoryAdoptionRunner(): MigrationRunner
    {
        $this->db->exec(
            'CREATE TABLE users (id INT PRIMARY KEY) ENGINE=InnoDB;
             INSERT INTO users VALUES (1),(2)'
        );
        $names = ['migrate_combat_v1_wars.sql', 'migrate_npc_wars_v1.sql'];
        foreach (array_merge($names, ['schema_migration_adoptions.sql']) as $name) {
            copy(__DIR__ . '/../../sql/' . $name, $this->sqlDir . '/' . $name);
        }
        file_put_contents($this->sqlDir . '/manifest.php', '<?php return ' . var_export($names, true) . ';');
        $parser = new MigrationRunner($this->db, $this->sqlDir, 'TEST');
        foreach ($names as $name) {
            foreach ($parser->splitStatements($this->readSqlForTestDatabase($name)) as $statement) {
                $result = $this->db->query($statement);
                $result->closeCursor();
            }
        }
        $this->db->exec(
            "INSERT INTO wars (attacker_user_id,defender_user_id,status,npc_aggressor_faction_id)
             VALUES (NULL,2,'active',21)"
        );
        $warId = (int)$this->db->lastInsertId();
        $this->db->prepare(
            "INSERT INTO war_goals (war_id,side,goal_type,score_value) VALUES (?,'attacker','occupy',4)"
        )->execute([$warId]);
        $this->db->prepare(
            "INSERT INTO peace_offers (war_id,from_user_id,terms_json,expires_at)
             VALUES (?,2,'{\"status\":\"fixture\"}','2030-01-01 00:00:00')"
        )->execute([$warId]);

        $runner = new MigrationRunner($this->db, $this->sqlDir, 'TEST', $this->sqlDir . '/manifest.php');
        $runner->bootstrap();
        return $runner;
    }

    public function testWarHistoryAdoptionPreservesNpcWarAndRelatedRowsWithoutReplay(): void
    {
        $runner = $this->warHistoryAdoptionRunner();
        $before = [];
        foreach (['wars', 'war_goals', 'peace_offers'] as $table) {
            $before[$table] = $this->db->query('SELECT * FROM `' . $table . '` ORDER BY id')
                ->fetchAll(PDO::FETCH_ASSOC);
        }

        $preview = $runner->adoptWarHistory(true);
        $this->assertSame(['migrate_combat_v1_wars.sql', 'migrate_npc_wars_v1.sql'], $preview['adopted']);
        $this->assertSame(0, $this->trackingCount());

        $adopted = $runner->adoptWarHistory(false);
        $this->assertSame($preview['evidence'], $adopted['evidence']);
        $this->assertSame(2, $runner->verifyDeployment());
        $this->assertSame([], $runner->runUp());
        $this->assertSame([], $runner->adoptWarHistory(false)['adopted']);
        foreach (['wars', 'war_goals', 'peace_offers'] as $table) {
            $this->assertSame(
                $before[$table],
                $this->db->query('SELECT * FROM `' . $table . '` ORDER BY id')->fetchAll(PDO::FETCH_ASSOC)
            );
        }
        $this->assertSame(1, (int)$this->db->query(
            "SELECT COUNT(*) FROM wars
             WHERE attacker_user_id IS NULL AND npc_aggressor_faction_id=21 AND status='active'"
        )->fetchColumn());
        $this->assertSame(0, (int)$this->db->query(
            "SELECT COUNT(*) FROM schema_migrations
             WHERE migration_name IN ('migrate_combat_model_v1.sql','migrate_war_v3.sql')"
        )->fetchColumn());
    }

    public function testWarHistoryAdoptionRejectsSchemaDriftWithoutWritingHistory(): void
    {
        $runner = $this->warHistoryAdoptionRunner();
        $this->db->exec('ALTER TABLE wars DROP INDEX idx_wars_status');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('War-history adoption index mismatch: wars');
        $runner->adoptWarHistory(false);
    }

}
