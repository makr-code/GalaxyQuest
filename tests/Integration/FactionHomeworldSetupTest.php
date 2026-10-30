<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../lib/FactionHomeworldSeeder.php';

final class FactionHomeworldSetupTest extends TestCase {
    private PDO $db;

    protected function setUp(): void {
        $dsn = getenv('GQ_HOMEWORLD_MYSQL_DSN');
        if (!$dsn) self::markTestSkipped('Requires a dedicated disposable MySQL database (GQ_HOMEWORLD_MYSQL_DSN).');
        $this->db = new PDO($dsn, getenv('DB_USER') ?: 'root', getenv('DB_PASS') ?: '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        self::assertSame('galaxyquest', $this->db->query('SELECT DATABASE()')->fetchColumn());
        self::assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()'
        )->fetchColumn(), 'Use an empty, disposable MySQL database, never an existing installation.');
    }

    public function testRealMysqlSetupIsPersistentIdempotentAndCollisionSafe(): void {
        $this->db->exec(file_get_contents(__DIR__ . '/../../sql/schema.sql'));
        $this->db->exec(file_get_contents(__DIR__ . '/../../sql/migrate_fog_of_war.sql'));
        $this->db->exec(file_get_contents(__DIR__ . '/../../sql/migrate_faction_homeworlds_v1.sql'));
        $this->db->exec(file_get_contents(__DIR__ . '/../../sql/migrate_registration_drafts_v1.sql'));
        $this->db->exec(file_get_contents(__DIR__ . '/../../sql/migrate_registration_mentor_drafts_v2.sql'));
        $worlds = FactionHomeworldSeeder::configuredWorlds(
            __DIR__ . '/../../config/faction_homeworlds.json', __DIR__ . '/../../fractions'
        );
        ensure_star_system_columns($this->db);
        ensure_binary_systems_table($this->db);
        ensure_pve_factions_seed($this->db);
        $seeder = new FactionHomeworldSeeder($this->db);
        $first = $seeder->seed($worlds);
        self::assertGreaterThanOrEqual(19, $first['created']);
        self::assertSame(0, $first['reused']);
        $count = (int)$this->db->query('SELECT COUNT(*) FROM faction_homeworlds')->fetchColumn();
        self::assertSame((int)$this->db->query('SELECT COUNT(*) FROM npc_factions')->fetchColumn(), $count);
        self::assertSame($count, (int)$this->db->query(
            "SELECT COUNT(*) FROM faction_homeworlds h JOIN users u ON u.id = h.user_id
             JOIN colonies c ON c.id = h.colony_id JOIN npc_faction_memberships m ON m.user_id = u.id
             WHERE u.control_type = 'npc_engine' AND u.auth_enabled = 0 AND u.password_hash = ''
             AND c.user_id = u.id AND c.is_homeworld = 1 AND m.faction_id = h.faction_id"
        )->fetchColumn());
        self::assertSame($count * 4, (int)$this->db->query('SELECT COUNT(*) FROM ships')->fetchColumn());
        self::assertSame($count * 23, (int)$this->db->query('SELECT COUNT(*) FROM research')->fetchColumn());
        self::assertSame($count, (int)$this->db->query("SELECT COUNT(*) FROM player_system_visibility WHERE level = 'own'")->fetchColumn());
        self::assertSame(0, (int)$this->db->query(
            'SELECT COUNT(*) FROM faction_homeworlds h JOIN colonies c ON c.id = h.colony_id
             JOIN celestial_bodies cb ON cb.id = c.body_id
             LEFT JOIN star_systems s ON s.galaxy_index = cb.galaxy_index AND s.system_index = cb.system_index
             WHERE s.id IS NULL OR (s.x_ly = 0 AND s.y_ly = 0)'
        )->fetchColumn());
        self::assertGreaterThan($count, (int)$this->db->query(
            'SELECT COUNT(*) FROM planets p WHERE NOT EXISTS (
                SELECT 1 FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id
                WHERE cb.galaxy_index = p.galaxy AND cb.system_index = p.`system` AND cb.position = p.position
             )'
        )->fetchColumn());
        $sample = $first['worlds'][0];
        $this->db->prepare('UPDATE colonies SET metal = 17 WHERE id = ?')->execute([$sample['colony_id']]);
        $this->db->prepare("UPDATE ships SET count = 1 WHERE colony_id = ?")->execute([$sample['colony_id']]);
        $second = (new FactionHomeworldSeeder($this->db))->seed($worlds);
        self::assertSame(0, $second['created']);
        self::assertSame($count, $second['reused']);
        self::assertSame($count, (int)$this->db->query('SELECT COUNT(*) FROM users')->fetchColumn());
        $stmt = $this->db->prepare('SELECT metal FROM colonies WHERE id = ?');
        $stmt->execute([$sample['colony_id']]);
        self::assertSame(17.0, (float)$stmt->fetchColumn());
        $stmt = $this->db->prepare('SELECT SUM(count) FROM ships WHERE colony_id = ?');
        $stmt->execute([$sample['colony_id']]);
        self::assertSame(4, (int)$stmt->fetchColumn());

        $this->db->prepare(
            'UPDATE planets p JOIN colonies c ON c.planet_id = p.id SET p.deposit_metal = 123 WHERE c.id = ?'
        )->execute([$sample['colony_id']]);
        $this->db->prepare('DELETE FROM star_systems WHERE galaxy_index = ? AND system_index = ?')
            ->execute([$sample['galaxy'], $sample['system']]);
        $restored = $seeder->seed($worlds);
        self::assertSame(0, $restored['created']);
        $stmt = $this->db->prepare(
            'SELECT p.deposit_metal, p.system_id FROM planets p JOIN colonies c ON c.planet_id = p.id WHERE c.id = ?'
        );
        $stmt->execute([$sample['colony_id']]);
        $restoredPlanet = $stmt->fetch();
        self::assertSame(123, (int)$restoredPlanet['deposit_metal']);
        self::assertGreaterThan(0, (int)$restoredPlanet['system_id']);

        $this->db->exec("INSERT INTO users (username, email, password_hash, control_type, auth_enabled)
                        VALUES ('test_member', 'member@test.invalid', '', 'npc_engine', 0)");
        $member = (int)$this->db->lastInsertId();
        $colonyId = $seeder->createMemberHomeworld($member, (int)$sample['faction_id'], 'Neighbor');
        $stmt = $this->db->prepare('SELECT cb.galaxy_index, cb.system_index FROM colonies c JOIN celestial_bodies cb ON cb.id = c.body_id WHERE c.id = ?');
        $stmt->execute([$colonyId]);
        $neighbor = $stmt->fetch();
        self::assertSame((int)$sample['galaxy'], (int)$neighbor['galaxy_index']);
        self::assertNotSame((int)$sample['system'], (int)$neighbor['system_index']);

        $changed = $worlds;
        $changed['aereth']['system'] = 838;
        try {
            $seeder->seed($changed);
            self::fail('Relocation must require an explicit migration.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('relocation', $error->getMessage());
        }
        $colonyCount = (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn();
        try {
            $seeder->createColony($member, 'Collision', [
                'galaxy' => (int)$sample['galaxy'], 'system' => (int)$sample['system'], 'position' => (int)$sample['position'],
            ]);
            self::fail('An occupied homeworld was overwritten.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('occupied', $error->getMessage());
        }
        self::assertSame($colonyCount, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());

        $usersBefore = (int)$this->db->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $collision = $worlds[$sample['code']];
        $collision['code'] = 'collision_probe';
        try {
            $seeder->seed(['collision_probe' => $collision]);
            self::fail('Faction seed must not steal an occupied world.');
        } catch (RuntimeException $error) {
            self::assertStringContainsString('occupied', $error->getMessage());
        }
        self::assertSame($usersBefore, (int)$this->db->query('SELECT COUNT(*) FROM users')->fetchColumn());
        $this->db->exec("DELETE FROM npc_factions WHERE code = 'collision_probe'");

        $bodiesBefore = (int)$this->db->query('SELECT COUNT(*) FROM celestial_bodies')->fetchColumn();
        $this->db->exec("CREATE TRIGGER gq_test_homeworld_fail BEFORE INSERT ON ships FOR EACH ROW
                        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Test asset failure'");
        try {
            $seeder->createMemberHomeworld($member, (int)$sample['faction_id'], 'Rollback');
            self::fail('Asset creation failure must abort the complete colony.');
        } catch (PDOException $error) {
            self::assertStringContainsString('Test asset failure', $error->getMessage());
        } finally {
            $this->db->exec('DROP TRIGGER gq_test_homeworld_fail');
        }
        self::assertFalse($this->db->inTransaction());
        self::assertSame($colonyCount, (int)$this->db->query('SELECT COUNT(*) FROM colonies')->fetchColumn());
        self::assertSame($bodiesBefore, (int)$this->db->query('SELECT COUNT(*) FROM celestial_bodies')->fetchColumn());

        $process = proc_open(
            [PHP_BINARY, __DIR__ . '/../../setup.php', '--homeworlds-only'],
            [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes
        );
        self::assertIsResource($process);
        $output = stream_get_contents($pipes[1]);
        $errors = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        self::assertSame(0, proc_close($process), $errors);
        self::assertStringContainsString("Faction homeworlds: created=0, reused=$count", $output);
    }
}
