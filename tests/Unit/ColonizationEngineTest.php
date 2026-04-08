<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/ColonizationEngine.php';

/**
 * Unit tests for ColonizationEngine.
 *
 * All tests that require DB access use a SQLite in-memory database that
 * mirrors the schema produced by migrate_colonization_v1.sql and v2.sql.
 */
final class ColonizationEngineTest extends TestCase
{
    private PDO $db;

    protected function setUp(): void
    {
        $this->db = new PDO('sqlite::memory:');
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->bootstrapSchema();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Schema helpers
    // ──────────────────────────────────────────────────────────────────────────

    private function bootstrapSchema(): void
    {
        $this->db->exec('
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT
            );
            CREATE TABLE star_systems (
                id INTEGER PRIMARY KEY,
                name TEXT
            );
            CREATE TABLE celestial_bodies (
                id INTEGER PRIMARY KEY,
                system_index INTEGER,
                galaxy_index INTEGER,
                position INTEGER
            );
            CREATE TABLE colonies (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                body_id INTEGER,
                name TEXT DEFAULT "Colony",
                colony_type TEXT DEFAULT "balanced",
                metal REAL DEFAULT 500,
                crystal REAL DEFAULT 300,
                deuterium REAL DEFAULT 100,
                food REAL DEFAULT 200,
                energy INTEGER DEFAULT 0,
                population INTEGER DEFAULT 100,
                max_population INTEGER DEFAULT 500,
                happiness INTEGER DEFAULT 70,
                public_services INTEGER DEFAULT 0,
                is_homeworld INTEGER DEFAULT 0,
                phase INTEGER DEFAULT 0,
                sector_id INTEGER DEFAULT NULL,
                energy_balance INTEGER DEFAULT 0,
                last_update DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE fleets (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                ships_json TEXT DEFAULT "{}",
                `returning` INTEGER DEFAULT 0,
                departure_time DATETIME,
                arrival_time DATETIME
            );
            CREATE TABLE sectors (
                id INTEGER PRIMARY KEY,
                player_id INTEGER,
                name TEXT DEFAULT "New Sector",
                governor_id INTEGER DEFAULT NULL,
                capital_colony_id INTEGER DEFAULT NULL,
                autonomy_level INTEGER DEFAULT 0,
                tax_rate REAL DEFAULT 1.00,
                approval_rating INTEGER DEFAULT 50,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE sector_systems (
                sector_id INTEGER,
                star_system_id INTEGER,
                PRIMARY KEY (sector_id, star_system_id)
            );
            CREATE TABLE governors (
                id INTEGER PRIMARY KEY,
                player_id INTEGER,
                npc_id INTEGER DEFAULT NULL,
                sector_id INTEGER DEFAULT NULL,
                admin_bonus INTEGER DEFAULT 5,
                salary INTEGER DEFAULT 100,
                appointed_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE empire_edicts (
                id INTEGER PRIMARY KEY,
                player_id INTEGER,
                edict_type TEXT,
                active INTEGER DEFAULT 0,
                cost_per_tick INTEGER DEFAULT 0,
                activated_at DATETIME DEFAULT NULL,
                UNIQUE (player_id, edict_type)
            );
            CREATE TABLE empire_sprawl_cache (
                player_id INTEGER PRIMARY KEY,
                sprawl_value REAL DEFAULT 0,
                admin_cap INTEGER DEFAULT 50,
                sprawl_pct INTEGER DEFAULT 0,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        ');

        // Seed: user 1, 3 star systems, celestial bodies (system_index 1/2/3), 2 colonies
        $this->db->exec("INSERT INTO users (id, username) VALUES (1, 'testplayer')");
        $this->db->exec("INSERT INTO star_systems VALUES (1,'Alpha'),(2,'Beta'),(3,'Gamma')");
        $this->db->exec("INSERT INTO celestial_bodies VALUES (10, 1, 1, 1),(20, 2, 1, 2),(30, 3, 1, 3)");
        $this->db->exec("INSERT INTO colonies (id,user_id,body_id,population) VALUES (1,1,10,300),(2,1,20,5000)");
    }

    // ──────────────────────────────────────────────────────────────────────────
    // calcColonyPhase
    // ──────────────────────────────────────────────────────────────────────────

    /** @dataProvider phaseProvider */
    public function testCalcColonyPhase(int $pop, int $expected): void
    {
        $this->assertSame($expected, ColonizationEngine::calcColonyPhase($pop));
    }

    public static function phaseProvider(): array
    {
        return [
            'outpost_zero'       => [0,      0],
            'outpost_edge'       => [500,    0],
            'settlement_min'     => [501,    1],
            'settlement_edge'    => [2000,   1],
            'colony_min'         => [2001,   2],
            'colony_edge'        => [10000,  2],
            'city_min'           => [10001,  3],
            'city_edge'          => [50000,  3],
            'metropolis_min'     => [50001,  4],
            'metropolis_large'   => [1000000,4],
        ];
    }

    // ──────────────────────────────────────────────────────────────────────────
    // getMalusEffects
    // ──────────────────────────────────────────────────────────────────────────

    public function testGetMalusEffectsEfficient(): void
    {
        $m = ColonizationEngine::getMalusEffects(100);
        $this->assertSame('efficient', $m['status']);
        $this->assertSame(5, $m['resource_efficiency_pct']);
        $this->assertFalse($m['rebellion_risk']);
    }

    public function testGetMalusEffectsStrained(): void
    {
        $m = ColonizationEngine::getMalusEffects(110);
        $this->assertSame('strained', $m['status']);
        $this->assertSame(-5, $m['resource_efficiency_pct']);
        $this->assertFalse($m['rebellion_risk']);
    }

    public function testGetMalusEffectsOverstretched(): void
    {
        $m = ColonizationEngine::getMalusEffects(130);
        $this->assertSame('overstretched', $m['status']);
        $this->assertSame(-15, $m['resource_efficiency_pct']);
        $this->assertSame(10, $m['unrest_bonus']);
        $this->assertFalse($m['rebellion_risk']);
    }

    public function testGetMalusEffectsCrisis(): void
    {
        $m = ColonizationEngine::getMalusEffects(170);
        $this->assertSame('crisis', $m['status']);
        $this->assertSame(-30, $m['resource_efficiency_pct']);
        $this->assertTrue($m['rebellion_risk']);
    }

    public function testGetMalusEffectsDissolution(): void
    {
        $m = ColonizationEngine::getMalusEffects(201);
        $this->assertSame('dissolution', $m['status']);
        $this->assertSame(-50, $m['resource_efficiency_pct']);
        $this->assertTrue($m['rebellion_risk']);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // calcAdminCap
    // ──────────────────────────────────────────────────────────────────────────

    public function testCalcAdminCapBaseOnly(): void
    {
        $this->assertSame(ColonizationEngine::BASE_ADMIN_CAP, ColonizationEngine::calcAdminCap($this->db, 1));
    }

    public function testCalcAdminCapWithGovernor(): void
    {
        // Insert governor assigned to a sector
        $this->db->exec("INSERT INTO sectors (id,player_id,name) VALUES (1,1,'S1')");
        $this->db->exec("INSERT INTO governors (id,player_id,sector_id,admin_bonus) VALUES (1,1,1,12)");

        $cap = ColonizationEngine::calcAdminCap($this->db, 1);
        $this->assertSame(ColonizationEngine::BASE_ADMIN_CAP + 12, $cap);
    }

    public function testCalcAdminCapWithAdministrativeEdict(): void
    {
        $this->db->exec("INSERT INTO empire_edicts (player_id,edict_type,active,cost_per_tick)
                         VALUES (1,'administrative_efficiency',1,50)");

        $cap = ColonizationEngine::calcAdminCap($this->db, 1);
        $this->assertSame(ColonizationEngine::BASE_ADMIN_CAP + 15, $cap);
    }

    public function testCalcAdminCapCombined(): void
    {
        $this->db->exec("INSERT INTO sectors (id,player_id,name) VALUES (1,1,'S1')");
        $this->db->exec("INSERT INTO governors (id,player_id,sector_id,admin_bonus) VALUES (1,1,1,8)");
        $this->db->exec("INSERT INTO empire_edicts (player_id,edict_type,active,cost_per_tick)
                         VALUES (1,'administrative_efficiency',1,50)");

        $cap = ColonizationEngine::calcAdminCap($this->db, 1);
        // 50 base + 8 governor + 15 edict = 73
        $this->assertSame(73, $cap);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // recalcSprawl
    // ──────────────────────────────────────────────────────────────────────────

    public function testRecalcSprawlBasic(): void
    {
        // 2 systems (distinct system_index), 2 colonies, 0 large fleets
        // sprawl = 2×1.0 + 2×0.5 = 3.0
        $result = ColonizationEngine::recalcSprawl($this->db, 1);

        $this->assertEqualsWithDelta(3.0, $result['sprawl_value'], 0.001);
        $this->assertSame(ColonizationEngine::BASE_ADMIN_CAP, $result['admin_cap']);
        // sprawl_pct = round(3/50*100) = 6
        $this->assertSame(6, $result['sprawl_pct']);
        $this->assertArrayHasKey('malus', $result);
        $this->assertSame('efficient', $result['malus']['status']);
    }

    public function testRecalcSprawlWritesCache(): void
    {
        ColonizationEngine::recalcSprawl($this->db, 1);

        $row = $this->db->query('SELECT * FROM empire_sprawl_cache WHERE player_id = 1')->fetch();
        $this->assertNotFalse($row);
        $this->assertEqualsWithDelta(3.0, (float)$row['sprawl_value'], 0.001);
    }

    public function testRecalcSprawlCountsLargeFleets(): void
    {
        // Add a large fleet (> 5 ships)
        $this->db->exec("INSERT INTO fleets (id,user_id,ships_json,`returning`) VALUES (1,1,'{\"fighter\":6}',0)");

        $result = ColonizationEngine::recalcSprawl($this->db, 1);
        // 2×1.0 + 2×0.5 + 1×0.3 = 3.3
        $this->assertEqualsWithDelta(3.3, $result['sprawl_value'], 0.001);
    }

    public function testRecalcSprawlDoesNotCountSmallFleets(): void
    {
        $this->db->exec("INSERT INTO fleets (id,user_id,ships_json,`returning`) VALUES (1,1,'{\"fighter\":4}',0)");

        $result = ColonizationEngine::recalcSprawl($this->db, 1);
        $this->assertEqualsWithDelta(3.0, $result['sprawl_value'], 0.001);
    }

    public function testRecalcSprawlDoesNotCountReturningFleets(): void
    {
        $this->db->exec("INSERT INTO fleets (id,user_id,ships_json,`returning`) VALUES (1,1,'{\"fighter\":10}',1)");

        $result = ColonizationEngine::recalcSprawl($this->db, 1);
        // returning=1 → excluded
        $this->assertEqualsWithDelta(3.0, $result['sprawl_value'], 0.001);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // createSector
    // ──────────────────────────────────────────────────────────────────────────

    public function testCreateSector(): void
    {
        $id = ColonizationEngine::createSector($this->db, 1, 'Core Worlds');
        $this->assertGreaterThan(0, $id);

        $row = $this->db->query("SELECT * FROM sectors WHERE id = $id")->fetch();
        $this->assertSame('Core Worlds', $row['name']);
        $this->assertSame('1', (string)$row['player_id']);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // assignSystemToSector
    // ──────────────────────────────────────────────────────────────────────────

    public function testAssignSystemToSector(): void
    {
        $sectorId = ColonizationEngine::createSector($this->db, 1, 'Frontier');
        ColonizationEngine::assignSystemToSector($this->db, 1, 1, $sectorId);

        $row = $this->db->query("SELECT * FROM sector_systems WHERE sector_id = $sectorId AND star_system_id = 1")->fetch();
        $this->assertNotFalse($row);
    }

    public function testAssignSystemToSectorFailsIfNoColony(): void
    {
        $sectorId = ColonizationEngine::createSector($this->db, 1, 'Empty');
        $this->expectException(RuntimeException::class);
        ColonizationEngine::assignSystemToSector($this->db, 1, 99, $sectorId);
    }

    public function testAssignSystemMovesFromOldSector(): void
    {
        $s1 = ColonizationEngine::createSector($this->db, 1, 'S1');
        $s2 = ColonizationEngine::createSector($this->db, 1, 'S2');
        ColonizationEngine::assignSystemToSector($this->db, 1, 1, $s1);
        ColonizationEngine::assignSystemToSector($this->db, 1, 1, $s2);

        $inS1 = $this->db->query("SELECT COUNT(*) FROM sector_systems WHERE sector_id = $s1 AND star_system_id = 1")->fetchColumn();
        $inS2 = $this->db->query("SELECT COUNT(*) FROM sector_systems WHERE sector_id = $s2 AND star_system_id = 1")->fetchColumn();
        $this->assertSame('0', (string)$inS1);
        $this->assertSame('1', (string)$inS2);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // appointGovernor
    // ──────────────────────────────────────────────────────────────────────────

    public function testAppointGovernor(): void
    {
        $sectorId = ColonizationEngine::createSector($this->db, 1, 'Sektor A');
        $this->db->exec("INSERT INTO governors (id,player_id,admin_bonus) VALUES (1,1,10)");
        ColonizationEngine::appointGovernor($this->db, 1, 1, $sectorId);

        $row = $this->db->query("SELECT sector_id FROM governors WHERE id = 1")->fetch();
        $this->assertSame((string)$sectorId, (string)$row['sector_id']);

        $s = $this->db->query("SELECT governor_id FROM sectors WHERE id = $sectorId")->fetch();
        $this->assertSame('1', (string)$s['governor_id']);
    }

    public function testAppointGovernorReplacesExisting(): void
    {
        $sectorId = ColonizationEngine::createSector($this->db, 1, 'Sektor B');
        $this->db->exec("INSERT INTO governors (id,player_id,admin_bonus) VALUES (1,1,5),(2,1,8)");
        ColonizationEngine::appointGovernor($this->db, 1, 1, $sectorId);
        ColonizationEngine::appointGovernor($this->db, 1, 2, $sectorId);

        $old = $this->db->query("SELECT sector_id FROM governors WHERE id = 1")->fetch();
        $new = $this->db->query("SELECT sector_id FROM governors WHERE id = 2")->fetch();
        $this->assertNull($old['sector_id']);
        $this->assertSame((string)$sectorId, (string)$new['sector_id']);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // setEdictActive / listEdicts
    // ──────────────────────────────────────────────────────────────────────────

    public function testActivateEdict(): void
    {
        ColonizationEngine::setEdictActive($this->db, 1, 'martial_law', true);

        $row = $this->db->query("SELECT active FROM empire_edicts WHERE player_id=1 AND edict_type='martial_law'")->fetch();
        $this->assertSame('1', (string)$row['active']);
    }

    public function testDeactivateEdict(): void
    {
        ColonizationEngine::setEdictActive($this->db, 1, 'free_trade', true);
        ColonizationEngine::setEdictActive($this->db, 1, 'free_trade', false);

        $row = $this->db->query("SELECT active FROM empire_edicts WHERE player_id=1 AND edict_type='free_trade'")->fetch();
        $this->assertSame('0', (string)$row['active']);
    }

    public function testActivateUnknownEdictThrows(): void
    {
        $this->expectException(RuntimeException::class);
        ColonizationEngine::setEdictActive($this->db, 1, 'totally_fake_edict', true);
    }

    public function testListEdictsReturnsAllTypes(): void
    {
        $edicts = ColonizationEngine::listEdicts($this->db, 1);
        $this->assertCount(count(ColonizationEngine::EDICTS), $edicts);
    }

    public function testListEdictsShowsActiveStatus(): void
    {
        ColonizationEngine::setEdictActive($this->db, 1, 'research_subsidy', true);
        $edicts = ColonizationEngine::listEdicts($this->db, 1);

        $found = null;
        foreach ($edicts as $e) {
            if ($e['edict_type'] === 'research_subsidy') { $found = $e; break; }
        }
        $this->assertNotNull($found);
        $this->assertTrue($found['active']);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // updateColonyPhase
    // ──────────────────────────────────────────────────────────────────────────

    public function testUpdateColonyPhaseChanges(): void
    {
        $changed = ColonizationEngine::updateColonyPhase($this->db, 1, 3000);
        $this->assertTrue($changed);

        $phase = $this->db->query("SELECT phase FROM colonies WHERE id = 1")->fetchColumn();
        $this->assertSame('2', (string)$phase); // 3000 pop → phase 2
    }

    public function testUpdateColonyPhaseNoChangeIfSame(): void
    {
        // colony 2 has pop=5000 → phase 2; set phase to 2 first
        $this->db->exec("UPDATE colonies SET phase = 2 WHERE id = 2");
        $changed = ColonizationEngine::updateColonyPhase($this->db, 2, 5000);
        $this->assertFalse($changed);
    }
}
