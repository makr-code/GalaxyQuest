<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use GalaxyQuest\Schema\GalaxySchema;
use PDO;
use PDOException;
use PDOStatement;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use RuntimeException;

require_once dirname(__DIR__, 2) . '/lib/GalaxySchema.php';

final class GalaxySchemaTest extends TestCase
{
    public static function missingFactionTables(): iterable
    {
        $warTables = [
            'alliance_wars' => ['id', 'name', 'status', 'war_score_a', 'war_score_b', 'exhaustion_a',
                'exhaustion_b', 'casus_belli', 'declared_by_user_id', 'started_at', 'ended_at', 'ended_reason'],
            'alliance_war_sides' => ['id', 'war_id', 'alliance_id', 'side', 'joined_at'],
            'alliance_war_peace_offers' => ['id', 'war_id', 'from_alliance_id', 'terms_json',
                'status', 'created_at', 'expires_at', 'responded_at'],
        ];
        $existingWars = [];
        foreach ($warTables as $table => $columns) {
            yield $table => ['assertAllianceWars', $table, $existingWars, 'id'];
            $existingWars[$table] = $columns;
        }
        $allianceTables = [
            'alliances' => ['id', 'name', 'tag', 'leader_user_id', 'description', 'treasury_metal',
                'treasury_crystal', 'treasury_deuterium', 'treasury_dark_matter', 'created_at', 'updated_at'],
            'alliance_members' => ['id', 'alliance_id', 'user_id', 'role', 'joined_at', 'contributed_resources'],
            'alliance_relations' => ['id', 'alliance_id', 'other_alliance_id', 'other_user_id', 'relation_type',
                'declared_by_user_id', 'declared_at', 'expires_at'],
            'alliance_messages' => ['id', 'alliance_id', 'author_id', 'message_text', 'created_at'],
        ];
        $existing = [];
        foreach ($allianceTables as $table => $columns) {
            yield 'player ' . $table => ['assertAlliances', $table, $existing, 'id'];
            $existing[$table] = $columns;
        }
        $events = ['id', 'event_type', 'faction_id', 'source_user_id', 'description', 'modifier_key',
            'modifier_value', 'affected_scope', 'starts_at', 'ends_at', 'is_visible'];
        $scenarios = ['id', 'code', 'faction_id', 'title_de', 'description_de', 'duration_hours',
            'trigger_chance', 'trigger_cooldown_hours', 'min_player_progress', 'phases_json',
            'conclusions_json', 'effects_json', 'llm_prompt_key', 'active', 'created_at', 'updated_at'];
        yield 'galactic events' => ['assertWorldScenarios', 'galactic_events', [], 'id'];
        yield 'world scenarios' => ['assertWorldScenarios', 'world_scenarios', ['galactic_events' => $events], 'id'];
        yield 'active world events' => ['assertWorldScenarios', 'active_world_events', [
            'galactic_events' => $events, 'world_scenarios' => $scenarios,
        ], 'id'];
        yield 'situation states' => ['assertSituations', 'situation_states', [], 'id'];
        yield 'situation log' => ['assertSituations', 'situation_stage_log', [
            'situation_states' => ['id', 'user_id', 'colony_id', 'target_type', 'target_id', 'situation_type',
                'status', 'progress', 'stage', 'approach_key', 'approach_locked', 'payload_json',
                'monthly_deltas_json', 'started_at', 'last_tick_at', 'ended_at', 'updated_at'],
        ], 'id'];
        yield 'homeworld ships' => ['assertHomeworldSupport', 'ships', [], 'id'];
        yield 'homeworld messages' => ['assertHomeworldSupport', 'messages', [
            'ships' => ['id', 'colony_id', 'type', 'count'],
        ], 'id'];
        yield 'factions' => ['assertFactions', 'npc_factions', [], 'id'];
        yield 'quests' => ['assertFactions', 'faction_quests', [
            'npc_factions' => ['id', 'code', 'name', 'description', 'faction_type', 'aggression',
                'trade_willingness', 'base_diplomacy', 'power_level', 'home_galaxy_min',
                'home_galaxy_max', 'color', 'icon'],
        ], 'id'];
        yield 'government' => ['assertGovernments', 'faction_government', [], 'faction_id'];
        yield 'alliances' => ['assertGovernments', 'faction_alliances', [
            'faction_government' => ['faction_id', 'government_form', 'stability_score', 'last_form_change'],
        ], 'faction_a_id'];
        yield 'adjustments' => ['assertGovernments', 'faction_standing_adjustments', [
            'faction_government' => ['faction_id', 'government_form', 'stability_score', 'last_form_change'],
            'faction_alliances' => ['faction_a_id', 'faction_b_id', 'alliance_strength', 'last_updated'],
        ], 'id'];
    }

    #[DataProvider('missingFactionTables')]
    public function testMissingFactionStorageFailsWithoutDdl(
        string $method,
        string $missing,
        array $existing,
        string $column
    ): void {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('exec');
        $db->expects(self::exactly(count($existing) + 1))->method('prepare')
            ->with(self::stringContains('information_schema.COLUMNS'))
            ->willReturnCallback(function () use ($existing, $missing): PDOStatement {
                $table = '';
                $statement = $this->createMock(PDOStatement::class);
                $statement->expects(self::once())->method('execute')
                    ->willReturnCallback(function (array $arguments) use (&$table, $existing, $missing): bool {
                        $table = $arguments[0];
                        self::assertTrue(isset($existing[$table]) || $table === $missing);
                        return true;
                    });
                $statement->method('fetchAll')->willReturnCallback(static function () use (&$table, $existing): array {
                    return array_map(
                        static fn(string $name): array => ['COLUMN_NAME' => $name, 'COLUMN_TYPE' => 'int'],
                        $existing[$table] ?? []
                    );
                });
                $statement->expects(self::once())->method('closeCursor');
                return $statement;
            });
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage($missing . '.' . $column);
        GalaxySchema::$method($db);
    }

    private function database(array $columns, string $table = 'star_systems'): PDO
    {
        $statement = $this->createMock(PDOStatement::class);
        $statement->expects(self::once())->method('execute')->with([$table]);
        $statement->method('fetchAll')->willReturn(array_map(
            static fn(string $name, string $type): array => ['COLUMN_NAME' => $name, 'COLUMN_TYPE' => $type],
            array_keys($columns),
            array_values($columns)
        ));
        $statement->expects(self::once())->method('closeCursor');
        $db = $this->createMock(PDO::class);
        $db->expects(self::once())->method('prepare')
            ->with(self::stringContains('information_schema.COLUMNS'))->willReturn($statement);
        $db->expects(self::never())->method('exec');
        return $db;
    }

    public static function productionStorage(): iterable
    {
        yield 'projection queue' => ['assertProjectionQueue', 'projection_dirty_queue', [
            'id', 'entity_type', 'entity_id', 'event_type', 'reason', 'payload_json', 'status',
            'enqueued_at', 'attempts', 'last_error', 'next_attempt_at', 'created_at', 'updated_at', 'processed_at',
            'claim_token',
        ]];
        yield 'user projection' => ['assertUserProjection', 'projection_user_overview', [
            'user_id', 'payload_json', 'version', 'updated_at', 'source_tick', 'stale_flag',
        ]];
        yield 'system projection' => ['assertSystemProjection', 'projection_system_snapshot', [
            'galaxy', 'system_index', 'payload_json', 'owner_user_id', 'colony_count',
            'colony_population', 'version', 'updated_at', 'source_tick', 'stale_flag',
        ]];
        yield 'wormholes' => ['assertWormholes', 'wormholes', [
            'id', 'endpoint_a_galaxy', 'endpoint_a_system', 'endpoint_b_galaxy', 'endpoint_b_system',
            'stability', 'cooldown_until', 'is_active', 'is_permanent', 'label', 'created_at',
        ]];
        yield 'wormhole unlocks' => ['assertWormholeUnlocks', 'user_wormhole_unlocks', [
            'user_id', 'source_quest_code', 'unlocked_at',
        ]];
        yield 'leader marketplace' => ['assertLeaderMarketplace', 'leader_marketplace', [
            'id', 'user_id', 'name', 'role', 'rarity', 'portrait', 'tagline', 'backstory', 'trait_1', 'trait_2',
            'skill_production', 'skill_construction', 'skill_tactics', 'skill_navigation',
            'skill_research', 'skill_efficiency', 'skill_guidance', 'hire_metal', 'hire_crystal',
            'hire_deuterium', 'is_hired', 'hired_at', 'expires_at', 'created_at',
        ]];
        yield 'leader profiles' => ['assertLeaderProfiles', 'leaders', [
            'rarity', 'portrait', 'tagline', 'backstory', 'trait_1', 'trait_2',
            'skill_production', 'skill_construction', 'skill_tactics', 'skill_navigation',
            'skill_research', 'skill_efficiency', 'skill_guidance', 'marketplace_source_id',
        ]];
        yield 'glossary cache' => ['assertGlossaryCache', 'glossary_cache', [
            'id', 'term_key', 'definition_json', 'generated_at',
        ]];
        yield 'character profiles' => ['assertCharacterProfiles', 'user_character_profiles', [
            'id', 'user_id', 'is_npc', 'race', 'profession', 'stance', 'vita', 'profile_json',
            'yaml_path', 'json_path', 'png_path', 'storage_dir', 'generation_status',
            'last_error', 'created_at', 'updated_at',
        ]];
        yield 'buildings' => ['assertBuildingQueue', 'building_upgrade_queue', [
            'id', 'colony_id', 'building_type', 'target_level', 'cost_metal', 'cost_crystal',
            'cost_deuterium', 'duration_secs', 'queued_at', 'started_at', 'eta', 'status',
        ]];
        yield 'ships' => ['assertShipQueue', 'ship_build_queue', [
            'id', 'colony_id', 'ship_type', 'blueprint_id', 'quantity', 'cost_metal', 'cost_crystal',
            'cost_deuterium', 'duration_secs', 'queued_at', 'started_at', 'eta', 'status',
        ]];
        yield 'vessels' => ['assertBuiltVessels', 'built_vessels', [
            'id', 'owner_user_id', 'colony_id', 'blueprint_id', 'name', 'snapshot_stats_json',
            'hp_state_json', 'status', 'created_at', 'updated_at',
        ]];
    }

    #[DataProvider('productionStorage')]
    public function testProductionStorageRequiresOnlyMetadata(string $method, string $table, array $columns): void
    {
        GalaxySchema::$method($this->database(array_fill_keys($columns, 'int'), $table));
    }

    #[DataProvider('productionStorage')]
    public function testMissingProductionColumnFailsWithoutRepair(string $method, string $table, array $columns): void
    {
        $missing = array_pop($columns);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage($table . '.' . $missing);
        GalaxySchema::$method($this->database(array_fill_keys($columns, 'int'), $table));
    }

    #[DataProvider('productionStorage')]
    public function testProductionSuccessIsNotCachedAcrossDatabases(string $method, string $table, array $columns): void
    {
        GalaxySchema::$method($this->database(array_fill_keys($columns, 'int'), $table));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage($table . '.' . $columns[0]);
        GalaxySchema::$method($this->database([], $table));
    }

    private function starColumns(): array
    {
        return array_fill_keys([
            'stellar_type', 'age_gyr', 'metallicity_z', 'is_binary', 'is_circumbinary',
            'companion_stellar_type', 'companion_spectral_class', 'companion_subtype',
            'companion_luminosity_class', 'companion_mass_solar', 'companion_radius_solar',
            'companion_temperature_k', 'companion_luminosity_solar', 'companion_separation_au',
            'companion_eccentricity', 'stability_critical_au', 'catalog_name', 'planet_count',
        ], 'varchar(32)') + ['spectral_class' => "enum('O','B','A','F','G','K','M','WD')"];
    }

    private function planetColumns(): array
    {
        return array_fill_keys([
            'composition_family', 'dominant_surface_material', 'surface_pressure_bar',
            'water_state', 'methane_state', 'ammonia_state', 'dominant_surface_liquid',
            'radiation_level', 'habitability_score', 'life_friendliness', 'species_affinity_json',
        ], 'varchar(64)');
    }

    public function testPlanetScienceUsesOnlyMetadataSelect(): void
    {
        GalaxySchema::assertPlanets($this->database($this->planetColumns(), 'planets'));
    }

    public function testAppStateUsesOnlyMetadataSelect(): void
    {
        GalaxySchema::assertAppState($this->database(
            array_fill_keys(['state_key', 'state_value', 'updated_at'], 'varchar(64)'),
            'app_state'
        ));
    }

    public function testMissingAppStateTimestampFailsWithoutRepair(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('app_state.updated_at');
        GalaxySchema::assertAppState($this->database(
            array_fill_keys(['state_key', 'state_value'], 'varchar(64)'),
            'app_state'
        ));
    }

    public function testAppStateSuccessDoesNotApproveAnotherDatabase(): void
    {
        GalaxySchema::assertAppState($this->database(
            array_fill_keys(['state_key', 'state_value', 'updated_at'], 'varchar(64)'),
            'app_state'
        ));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('app_state.state_key');
        GalaxySchema::assertAppState($this->database([], 'app_state'));
    }

    public function testMissingPlanetScienceColumnFailsWithoutRepair(): void
    {
        $columns = $this->planetColumns();
        unset($columns['species_affinity_json']);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('planets.species_affinity_json');
        GalaxySchema::assertPlanets($this->database($columns, 'planets'));
    }

    public function testPlanetSchemaSuccessDoesNotApproveAnotherConnection(): void
    {
        GalaxySchema::assertPlanets($this->database($this->planetColumns(), 'planets'));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('planets.composition_family');
        GalaxySchema::assertPlanets($this->database([], 'planets'));
    }

    public function testMigratedStarsRequireOnlyMetadataSelect(): void
    {
        GalaxySchema::assertStars($this->database($this->starColumns()));
    }

    public function testOutdatedSpectralEnumIsNotAlteredAtRuntime(): void
    {
        $columns = $this->starColumns();
        $columns['spectral_class'] = "enum('O','B','A','F','G','K','M')";
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Star spectral schema is outdated');
        GalaxySchema::assertStars($this->database($columns));
    }

    public function testMissingColumnIsNotAddedAtRuntime(): void
    {
        $columns = $this->starColumns();
        unset($columns['companion_temperature_k']);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('star_systems.companion_temperature_k');
        GalaxySchema::assertStars($this->database($columns));
    }

    public function testSchemaCheckIsRepeatedAcrossConnectionsRatherThanGlobalSuccess(): void
    {
        GalaxySchema::assertStars($this->database($this->starColumns()));
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('star_systems.stellar_type');
        GalaxySchema::assertStars($this->database([]));
    }

    public function testBinaryTableIsNotCreatedAtRuntime(): void
    {
        $statement = $this->createMock(PDOStatement::class);
        $statement->expects(self::once())->method('execute')->with(['binary_systems']);
        $statement->method('fetchAll')->willReturn([]);
        $statement->expects(self::once())->method('closeCursor');
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($statement);
        $db->expects(self::never())->method('exec');
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('binary_systems.id');
        GalaxySchema::assertBinaries($db);
    }

    public function testMetadataErrorPropagatesWithoutDdlFallback(): void
    {
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willThrowException(new PDOException('metadata permission denied'));
        $db->expects(self::never())->method('exec');
        $this->expectException(PDOException::class);
        $this->expectExceptionMessage('metadata permission denied');
        GalaxySchema::assertStars($db);
    }

    public static function projectionEngines(): iterable
    {
        yield 'transactional user' => ['projection_user_overview', 'InnoDB', 'InnoDB', true];
        yield 'transactional system' => ['projection_system_snapshot', 'InnoDB', 'InnoDB', true];
        yield 'nontransactional queue' => ['projection_user_overview', 'MyISAM', 'InnoDB', false];
        yield 'nontransactional target' => ['projection_system_snapshot', 'InnoDB', 'MyISAM', false];
        yield 'missing target' => ['projection_system_snapshot', 'InnoDB', null, false];
    }

    #[DataProvider('projectionEngines')]
    public function testProjectionCompletionRequiresTransactionalStorage(
        string $table, string $queueEngine, string|null $targetEngine, bool $valid
    ): void {
        $statement = $this->createMock(PDOStatement::class);
        $statement->expects(self::once())->method('execute')->with(['projection_dirty_queue', $table])->willReturn(true);
        $statement->method('fetchAll')->with(PDO::FETCH_KEY_PAIR)->willReturn([
            'projection_dirty_queue' => $queueEngine, $table => $targetEngine,
        ]);
        $statement->expects(self::once())->method('closeCursor');
        $db = $this->createMock(PDO::class);
        $db->expects(self::once())->method('prepare')->with(self::stringContains('information_schema.TABLES'))
            ->willReturn($statement);
        $db->expects(self::never())->method('exec');
        if (!$valid) {
            $this->expectException(RuntimeException::class);
            $this->expectExceptionMessage('must use InnoDB');
        }
        GalaxySchema::assertProjectionTransactions($db, $table);
    }

    public function testProjectionEngineMetadataErrorsAreNotHidden(): void
    {
        $statement = $this->createMock(PDOStatement::class);
        $statement->method('execute')->willThrowException(new PDOException('metadata denied'));
        $statement->expects(self::once())->method('closeCursor');
        $db = $this->createMock(PDO::class);
        $db->method('prepare')->willReturn($statement);
        $this->expectException(PDOException::class);
        GalaxySchema::assertProjectionTransactions($db, 'projection_user_overview');
    }
}
