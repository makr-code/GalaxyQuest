<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/MiniYamlParser.php';
require_once __DIR__ . '/../../api/llm_soc/ScenarioEngine.php';

/**
 * Unit tests for ScenarioEngine.
 *
 * All tests are isolated: no live DB, no HTTP, no filesystem side-effects
 * beyond the real scenarios/ directory (read-only YAML parsing).
 */
final class ScenarioEngineTest extends TestCase
{
    // ── Helpers ───────────────────────────────────────────────────────────────

    private string $scenariosDir;

    protected function setUp(): void
    {
        $this->scenariosDir = realpath(__DIR__ . '/../../scenarios')
            ?: (__DIR__ . '/../../scenarios');
    }

    /** Build a minimal PDO mock that returns empty results by default. */
    private function makePdoMock(): \PDO
    {
        return $this->createMock(\PDO::class);
    }

    /** Build a fake world_scenarios DB row from YAML data. */
    private function fakeDbScenario(array $yamlData): array
    {
        $trigger     = is_array($yamlData['trigger'] ?? null) ? $yamlData['trigger'] : [];
        $conclusions = is_array($yamlData['conclusions'] ?? null) ? $yamlData['conclusions'] : [];
        $effects     = is_array($yamlData['effects'] ?? null) ? $yamlData['effects'] : [];
        $phases      = is_array($yamlData['phases'] ?? null) ? $yamlData['phases'] : [];

        return [
            'id'                     => 1,
            'code'                   => $yamlData['code'] ?? 'test_scenario',
            'faction_id'             => null,
            'title_de'               => $yamlData['title_de'] ?? 'Test',
            'description_de'         => $yamlData['description_de'] ?? '',
            'duration_hours'         => $yamlData['duration_hours'] ?? 24,
            'trigger_chance'         => $trigger['chance'] ?? 0.05,
            'trigger_cooldown_hours' => $trigger['cooldown_hours'] ?? 72,
            'min_player_progress'    => $trigger['min_player_progress'] ?? 0,
            'phases_json'            => json_encode($phases),
            'conclusions_json'       => json_encode($conclusions),
            'effects_json'           => json_encode($effects),
            'llm_prompt_key'         => $yamlData['llm_prompt_key'] ?? null,
        ];
    }

    // ── loadScenariosFromYaml ─────────────────────────────────────────────────

    public function testLoadScenariosFromYamlReturnsArrayForValidDir(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        $this->assertIsArray($scenarios);
    }

    public function testLoadScenariosFromYamlFindsIronFleetScenario(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        $codes = array_column($scenarios, 'code');
        $this->assertContains('iron_fleet_global_council', $codes,
            'scenarios/ must contain iron_fleet_global_council.yaml');
    }

    public function testLoadScenariosFromNonExistentDirReturnsEmpty(): void
    {
        $result = ScenarioEngine::loadScenariosFromYaml('/tmp/nonexistent_dir_xyz_redcs');
        $this->assertSame([], $result);
    }

    public function testLoadScenariosSkipsFilesWithoutCodeKey(): void
    {
        $tmp = sys_get_temp_dir() . '/gq_scenario_test_' . getmypid();
        @mkdir($tmp);
        file_put_contents($tmp . '/no_code.yaml', "title_de: \"No code here\"\n");
        file_put_contents($tmp . '/has_code.yaml', "code: valid_code\ntitle_de: \"OK\"\n");

        try {
            $scenarios = ScenarioEngine::loadScenariosFromYaml($tmp);
            $codes = array_column($scenarios, 'code');
            $this->assertNotContains('', $codes);
            $this->assertContains('valid_code', $codes);
        } finally {
            @unlink($tmp . '/no_code.yaml');
            @unlink($tmp . '/has_code.yaml');
            @rmdir($tmp);
        }
    }

    // ── Iron Fleet scenario YAML structure ────────────────────────────────────

    public function testIronFleetScenarioHasRequiredTopLevelKeys(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        $scenario  = null;
        foreach ($scenarios as $s) {
            if (($s['code'] ?? '') === 'iron_fleet_global_council') {
                $scenario = $s;
                break;
            }
        }
        $this->assertNotNull($scenario, 'iron_fleet_global_council scenario must load');

        foreach (['code', 'faction_code', 'title_de', 'description_de', 'trigger',
                  'duration_hours', 'phases', 'conclusions', 'effects'] as $key) {
            $this->assertArrayHasKey($key, $scenario, "Missing key: $key");
        }
    }

    public function testIronFleetScenarioHasThreeConclusions(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        foreach ($scenarios as $s) {
            if (($s['code'] ?? '') === 'iron_fleet_global_council') {
                $this->assertCount(3, $s['conclusions']);
                return;
            }
        }
        $this->fail('iron_fleet_global_council scenario not found');
    }

    public function testIronFleetConclusionWeightsSumToOneHundred(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        foreach ($scenarios as $s) {
            if (($s['code'] ?? '') === 'iron_fleet_global_council') {
                $total = array_sum(array_column($s['conclusions'], 'weight'));
                $this->assertSame(100, (int)$total,
                    'Conclusion weights must sum to 100');
                return;
            }
        }
        $this->fail('iron_fleet_global_council scenario not found');
    }

    public function testIronFleetConclusionKeysAreExpected(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        foreach ($scenarios as $s) {
            if (($s['code'] ?? '') === 'iron_fleet_global_council') {
                $keys = array_column($s['conclusions'], 'key');
                $this->assertContains('internal_collapse', $keys);
                $this->assertContains('diplomatic_rejection', $keys);
                $this->assertContains('unexpected_support', $keys);
                return;
            }
        }
        $this->fail('iron_fleet_global_council scenario not found');
    }

    public function testIronFleetTriggerChanceIsReasonable(): void
    {
        $scenarios = ScenarioEngine::loadScenariosFromYaml($this->scenariosDir);
        foreach ($scenarios as $s) {
            if (($s['code'] ?? '') === 'iron_fleet_global_council') {
                $chance = (float)(($s['trigger'] ?? [])['chance'] ?? 0);
                $this->assertGreaterThan(0.0, $chance);
                $this->assertLessThanOrEqual(1.0, $chance);
                return;
            }
        }
        $this->fail('iron_fleet_global_council scenario not found');
    }

    // ── pickConclusion (via resolveConclusion with mocked event) ──────────────

    /**
     * Expose pickConclusion via a reflector so we can test weighted selection
     * without needing a full DB.
     *
     * @return string|null
     */
    private function callPickConclusion(\PDO $db, array $conclusions): ?string
    {
        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('pickConclusion');
        $m->setAccessible(true);
        return $m->invoke(null, $db, $conclusions);
    }

    public function testPickConclusionReturnsNullForEmptyList(): void
    {
        $db = $this->makePdoMock();
        $result = $this->callPickConclusion($db, []);
        $this->assertNull($result);
    }

    public function testPickConclusionReturnsSingleEligibleConclusion(): void
    {
        $db = $this->makePdoMock();
        $conclusions = [
            ['key' => 'only_option', 'weight' => 100, 'condition' => null],
        ];
        $result = $this->callPickConclusion($db, $conclusions);
        $this->assertSame('only_option', $result);
    }

    public function testPickConclusionSkipsZeroWeightEntries(): void
    {
        $db = $this->makePdoMock();
        $conclusions = [
            ['key' => 'zero_weight', 'weight' => 0, 'condition' => null],
            ['key' => 'real_option', 'weight' => 10, 'condition' => null],
        ];
        $result = $this->callPickConclusion($db, $conclusions);
        $this->assertSame('real_option', $result);
    }

    public function testPickConclusionIsAlwaysOneOfValidKeys(): void
    {
        $db = $this->makePdoMock();
        $conclusions = [
            ['key' => 'alpha', 'weight' => 60, 'condition' => null],
            ['key' => 'beta',  'weight' => 30, 'condition' => null],
            ['key' => 'gamma', 'weight' => 10, 'condition' => null],
        ];
        $seen = [];
        for ($i = 0; $i < 50; $i++) {
            $result = $this->callPickConclusion($db, $conclusions);
            $this->assertNotNull($result);
            $seen[$result] = true;
        }
        foreach (array_keys($seen) as $key) {
            $this->assertContains($key, ['alpha', 'beta', 'gamma']);
        }
    }

    // ── seedScenario ──────────────────────────────────────────────────────────

    public function testSeedScenarioSkipsEmptyCode(): void
    {
        $db   = $this->createMock(\PDO::class);
        $stmt = $this->createMock(\PDOStatement::class);

        // prepare() should NEVER be called when code is empty
        $db->expects($this->never())->method('prepare');

        ScenarioEngine::seedScenario($db, ['code' => '']);
    }

    public function testSeedScenarioCallsPrepareAndExecute(): void
    {
        $stmt = $this->createMock(\PDOStatement::class);
        $stmt->expects($this->once())->method('execute');

        $db = $this->createMock(\PDO::class);
        // resolveFactionId will call prepare once, seedScenario INSERT once → 2 prepares
        $db->expects($this->exactly(2))->method('prepare')->willReturn($stmt);

        $stmt2 = $this->createMock(\PDOStatement::class);
        $stmt2->method('fetchColumn')->willReturn(false);
        $db->method('prepare')->willReturn($stmt);

        ScenarioEngine::seedScenario($db, [
            'code'          => 'test_seed',
            'faction_code'  => '',
            'title_de'      => 'Test',
            'description_de'=> 'Desc',
            'duration_hours'=> 12,
        ]);
    }

    // ── startScenario ─────────────────────────────────────────────────────────

    public function testStartScenarioInsertsActiveWorldEvent(): void
    {
        $stmtInsert = $this->createMock(\PDOStatement::class);
        $stmtInsert->expects($this->once())->method('execute')
            ->with($this->callback(function ($params) {
                return $params[0] === 42; // scenario_id
            }));

        $stmtFetch = $this->createMock(\PDOStatement::class);
        $stmtFetch->method('fetchColumn')->willReturn('2026-04-07 10:00:00');

        $db = $this->createMock(\PDO::class);
        $db->method('lastInsertId')->willReturn('99');
        $db->method('prepare')->willReturnCallback(
            function (string $sql) use ($stmtInsert, $stmtFetch) {
                if (str_contains($sql, 'INSERT INTO active_world_events')) {
                    return $stmtInsert;
                }
                return $stmtFetch;
            }
        );

        // publishSsePending uses app_state_set_int which is not defined here → silently skipped
        ScenarioEngine::startScenario($db, [
            'id'             => 42,
            'code'           => 'test_start',
            'duration_hours' => 24,
        ]);
    }

    // ── applyEffects (standing_delta) ─────────────────────────────────────────

    public function testApplyEffectsStandingDeltaUpdatesAllPlayers(): void
    {
        // resolveConclusion calls applyEffects; test standing_delta via
        // reflection of private applyStandingDelta helper.

        $stmtFetch = $this->createMock(\PDOStatement::class);
        $stmtFetch->method('fetchColumn')->willReturn('7'); // faction id

        $stmtUpdate = $this->createMock(\PDOStatement::class);
        $stmtUpdate->expects($this->once())->method('execute')
            ->with([-5, 7]);

        $db = $this->createMock(\PDO::class);
        $db->method('prepare')->willReturnCallback(
            function (string $sql) use ($stmtFetch, $stmtUpdate) {
                if (str_contains($sql, 'SELECT id FROM npc_factions')) {
                    return $stmtFetch;
                }
                if (str_contains($sql, 'UPDATE diplomacy')) {
                    return $stmtUpdate;
                }
                return $stmtFetch;
            }
        );

        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('applyStandingDelta');
        $m->setAccessible(true);
        $m->invoke(null, $db, [
            'faction_code' => 'iron_fleet',
            'delta'        => -5,
            'scope'        => 'all_players',
        ]);
    }

    public function testApplyEffectsStandingDeltaSkipsZeroDelta(): void
    {
        $db = $this->createMock(\PDO::class);
        $db->expects($this->never())->method('prepare');

        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('applyStandingDelta');
        $m->setAccessible(true);
        $m->invoke(null, $db, [
            'faction_code' => 'iron_fleet',
            'delta'        => 0,
            'scope'        => 'all_players',
        ]);
    }

    public function testApplyEffectsStandingDeltaSkipsEmptyFactionCode(): void
    {
        $db = $this->createMock(\PDO::class);
        $db->expects($this->never())->method('prepare');

        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('applyStandingDelta');
        $m->setAccessible(true);
        $m->invoke(null, $db, [
            'faction_code' => '',
            'delta'        => -5,
            'scope'        => 'all_players',
        ]);
    }

    // ── applyQuestSpawn ───────────────────────────────────────────────────────

    public function testApplyQuestSpawnSkipsEmptyQuestCode(): void
    {
        $db = $this->createMock(\PDO::class);
        $db->expects($this->never())->method('prepare');

        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('applyQuestSpawn');
        $m->setAccessible(true);
        $m->invoke(null, $db, ['quest_code' => '', 'scope' => 'all_players']);
    }

    public function testApplyQuestSpawnSkipsWhenQuestNotInDb(): void
    {
        $stmt = $this->createMock(\PDOStatement::class);
        $stmt->method('fetchColumn')->willReturn(false); // quest not found

        $db = $this->createMock(\PDO::class);
        $db->expects($this->once())->method('prepare')->willReturn($stmt);

        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('applyQuestSpawn');
        $m->setAccessible(true);
        $m->invoke(null, $db, ['quest_code' => 'missing_quest', 'scope' => 'all_players']);
    }

    // ── applyGalacticEvent ────────────────────────────────────────────────────

    public function testApplyGalacticEventInsertsRow(): void
    {
        $stmt = $this->createMock(\PDOStatement::class);
        $stmt->expects($this->once())->method('execute');

        $db = $this->createMock(\PDO::class);
        $db->expects($this->once())->method('prepare')
            ->with($this->stringContains('INSERT INTO galactic_events'))
            ->willReturn($stmt);

        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('applyGalacticEvent');
        $m->setAccessible(true);
        $m->invoke(null, $db,
            [
                'event_type'      => 'scenario_conclusion',
                'affected_scope'  => 'sector',
                'duration_hours'  => 48,
                'description_de'  => 'Test event',
            ],
            ['scenario_faction_id' => null, 'scenario_code' => 'test']
        );
    }

    // ── compareStanding ───────────────────────────────────────────────────────

    /** @dataProvider provideCompareStandingCases */
    public function testCompareStanding(
        int $standing, string $op, int $value, bool $expected
    ): void {
        $r = new \ReflectionClass(ScenarioEngine::class);
        $m = $r->getMethod('compareStanding');
        $m->setAccessible(true);
        $result = (bool)$m->invoke(null, $standing, $op, $value);
        $this->assertSame($expected, $result,
            "Standing $standing $op $value should be " . ($expected ? 'true' : 'false'));
    }

    /** @return list<array{int,string,int,bool}> */
    public static function provideCompareStandingCases(): array
    {
        return [
            [10,  '>=', -20, true],
            [-25, '>=', -20, false],
            [-20, '>=', -20, true],
            [5,   '>',  0,   true],
            [0,   '>',  0,   false],
            [-50, '<=', -20, true],
            [10,  '<=', -20, false],
            [5,   '==', 5,   true],
            [5,   '==', 6,   false],
            [5,   '!=', 6,   true],
            [5,   '!=', 5,   false],
        ];
    }
}
