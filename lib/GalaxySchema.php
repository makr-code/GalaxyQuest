<?php

declare(strict_types=1);

namespace GalaxyQuest\Schema;

use PDO;
use RuntimeException;

final class GalaxySchema
{
    public static function assertProjectionTransactions(PDO $db, string $readModel): void
    {
        if (!in_array($readModel, ['projection_user_overview', 'projection_system_snapshot'], true)) {
            throw new RuntimeException('Unknown projection read-model table.');
        }
        $statement = $db->prepare(
            'SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)'
        );
        try {
            $statement->execute(['projection_dirty_queue', $readModel]);
            $engines = $statement->fetchAll(PDO::FETCH_KEY_PAIR);
        } finally {
            $statement->closeCursor();
        }
        foreach (['projection_dirty_queue', $readModel] as $table) {
            if (($engines[$table] ?? null) !== 'InnoDB') {
                throw new RuntimeException(
                    $table . ' must use InnoDB for atomic projection completion; review migrations.'
                );
            }
        }
    }

    public static function assertProjectionQueue(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'projection_dirty_queue'), 'projection_dirty_queue', [
            'id', 'entity_type', 'entity_id', 'event_type', 'reason', 'payload_json', 'status',
            'enqueued_at', 'attempts', 'last_error', 'next_attempt_at', 'created_at', 'updated_at', 'processed_at',
            'claim_token',
        ]);
    }

    public static function assertUserProjection(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'projection_user_overview'), 'projection_user_overview', [
            'user_id', 'payload_json', 'version', 'updated_at', 'source_tick', 'stale_flag',
        ]);
    }

    public static function assertSystemProjection(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'projection_system_snapshot'), 'projection_system_snapshot', [
            'galaxy', 'system_index', 'payload_json', 'owner_user_id', 'colony_count',
            'colony_population', 'version', 'updated_at', 'source_tick', 'stale_flag',
        ]);
    }

    public static function assertWormholes(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'wormholes'), 'wormholes', [
            'id', 'endpoint_a_galaxy', 'endpoint_a_system', 'endpoint_b_galaxy', 'endpoint_b_system',
            'stability', 'cooldown_until', 'is_active', 'is_permanent', 'label', 'created_at',
        ]);
    }

    public static function assertWormholeUnlocks(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'user_wormhole_unlocks'), 'user_wormhole_unlocks', [
            'user_id', 'source_quest_code', 'unlocked_at',
        ]);
    }

    public static function assertLeaderMarketplace(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'leader_marketplace'), 'leader_marketplace', [
            'id', 'user_id', 'name', 'role', 'rarity', 'portrait', 'tagline', 'backstory', 'trait_1', 'trait_2',
            'skill_production', 'skill_construction', 'skill_tactics', 'skill_navigation',
            'skill_research', 'skill_efficiency', 'skill_guidance', 'hire_metal', 'hire_crystal',
            'hire_deuterium', 'is_hired', 'hired_at', 'expires_at', 'created_at',
        ]);
    }

    public static function assertLeaderProfiles(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'leaders'), 'leaders', [
            'rarity', 'portrait', 'tagline', 'backstory', 'trait_1', 'trait_2',
            'skill_production', 'skill_construction', 'skill_tactics', 'skill_navigation',
            'skill_research', 'skill_efficiency', 'skill_guidance', 'marketplace_source_id',
        ]);
    }

    public static function assertAllianceWars(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'alliance_wars'), 'alliance_wars', [
            'id', 'name', 'status', 'war_score_a', 'war_score_b', 'exhaustion_a', 'exhaustion_b',
            'casus_belli', 'declared_by_user_id', 'started_at', 'ended_at', 'ended_reason',
        ]);
        self::requireColumns(self::columns($db, 'alliance_war_sides'), 'alliance_war_sides', [
            'id', 'war_id', 'alliance_id', 'side', 'joined_at',
        ]);
        self::requireColumns(self::columns($db, 'alliance_war_peace_offers'), 'alliance_war_peace_offers', [
            'id', 'war_id', 'from_alliance_id', 'terms_json', 'status', 'created_at', 'expires_at', 'responded_at',
        ]);
    }

    public static function assertAlliances(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'alliances'), 'alliances', [
            'id', 'name', 'tag', 'leader_user_id', 'description', 'treasury_metal',
            'treasury_crystal', 'treasury_deuterium', 'treasury_dark_matter', 'created_at', 'updated_at',
        ]);
        self::requireColumns(self::columns($db, 'alliance_members'), 'alliance_members', [
            'id', 'alliance_id', 'user_id', 'role', 'joined_at', 'contributed_resources',
        ]);
        self::requireColumns(self::columns($db, 'alliance_relations'), 'alliance_relations', [
            'id', 'alliance_id', 'other_alliance_id', 'other_user_id', 'relation_type',
            'declared_by_user_id', 'declared_at', 'expires_at',
        ]);
        self::requireColumns(self::columns($db, 'alliance_messages'), 'alliance_messages', [
            'id', 'alliance_id', 'author_id', 'message_text', 'created_at',
        ]);
    }

    public static function assertGlossaryCache(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'glossary_cache'), 'glossary_cache', [
            'id', 'term_key', 'definition_json', 'generated_at',
        ]);
    }

    public static function assertWorldScenarios(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'galactic_events'), 'galactic_events', [
            'id', 'event_type', 'faction_id', 'source_user_id', 'description', 'modifier_key',
            'modifier_value', 'affected_scope', 'starts_at', 'ends_at', 'is_visible',
        ]);
        self::requireColumns(self::columns($db, 'world_scenarios'), 'world_scenarios', [
            'id', 'code', 'faction_id', 'title_de', 'description_de', 'duration_hours',
            'trigger_chance', 'trigger_cooldown_hours', 'min_player_progress', 'phases_json',
            'conclusions_json', 'effects_json', 'llm_prompt_key', 'active', 'created_at', 'updated_at',
        ]);
        self::requireColumns(self::columns($db, 'active_world_events'), 'active_world_events', [
            'id', 'scenario_id', 'phase', 'started_at', 'ends_at', 'conclusion_key',
            'resolved_at', 'effects_applied', 'flavor_text',
        ]);
    }

    public static function assertSituations(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'situation_states'), 'situation_states', [
            'id', 'user_id', 'colony_id', 'target_type', 'target_id', 'situation_type',
            'status', 'progress', 'stage', 'approach_key', 'approach_locked', 'payload_json',
            'monthly_deltas_json', 'started_at', 'last_tick_at', 'ended_at', 'updated_at',
        ]);
        self::requireColumns(self::columns($db, 'situation_stage_log'), 'situation_stage_log', [
            'id', 'situation_id', 'user_id', 'old_stage', 'new_stage', 'reason', 'created_at',
        ]);
    }

    public static function assertHomeworldSupport(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'ships'), 'ships', [
            'id', 'colony_id', 'type', 'count',
        ]);
        self::requireColumns(self::columns($db, 'messages'), 'messages', [
            'id', 'sender_id', 'receiver_id', 'subject', 'body', 'is_read', 'sent_at',
        ]);
    }

    public static function assertCharacterProfiles(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'user_character_profiles'), 'user_character_profiles', [
            'id', 'user_id', 'is_npc', 'race', 'profession', 'stance', 'vita', 'profile_json',
            'yaml_path', 'json_path', 'png_path', 'storage_dir', 'generation_status',
            'last_error', 'created_at', 'updated_at',
        ]);
    }

    public static function assertBuildingQueue(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'building_upgrade_queue'), 'building_upgrade_queue', [
            'id', 'colony_id', 'building_type', 'target_level', 'cost_metal',
            'cost_crystal', 'cost_deuterium', 'duration_secs', 'queued_at', 'started_at', 'eta', 'status',
        ]);
    }

    public static function assertShipQueue(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'ship_build_queue'), 'ship_build_queue', [
            'id', 'colony_id', 'ship_type', 'blueprint_id', 'quantity', 'cost_metal',
            'cost_crystal', 'cost_deuterium', 'duration_secs', 'queued_at', 'started_at', 'eta', 'status',
        ]);
    }

    public static function assertBuiltVessels(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'built_vessels'), 'built_vessels', [
            'id', 'owner_user_id', 'colony_id', 'blueprint_id', 'name',
            'snapshot_stats_json', 'hp_state_json', 'status', 'created_at', 'updated_at',
        ]);
    }

    public static function assertFactions(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'npc_factions'), 'npc_factions', [
            'id', 'code', 'name', 'description', 'faction_type', 'aggression',
            'trade_willingness', 'base_diplomacy', 'power_level', 'home_galaxy_min',
            'home_galaxy_max', 'color', 'icon',
        ]);
        self::requireColumns(self::columns($db, 'faction_quests'), 'faction_quests', [
            'id', 'faction_id', 'code', 'title', 'description', 'quest_type',
            'requirements_json', 'reward_metal', 'reward_crystal', 'reward_deuterium',
            'reward_rare_earth', 'reward_dark_matter', 'reward_rank_points',
            'reward_standing', 'min_standing', 'difficulty', 'repeatable',
        ]);
    }

    public static function assertGovernments(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'faction_government'), 'faction_government', [
            'faction_id', 'government_form', 'stability_score', 'last_form_change',
        ]);
        self::requireColumns(self::columns($db, 'faction_alliances'), 'faction_alliances', [
            'faction_a_id', 'faction_b_id', 'alliance_strength', 'last_updated',
        ]);
        self::requireColumns(
            self::columns($db, 'faction_standing_adjustments'),
            'faction_standing_adjustments',
            ['id', 'user_id', 'faction_id', 'adjustment', 'reason', 'created_at']
        );
    }

    public static function assertAppState(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'app_state'), 'app_state', [
            'state_key', 'state_value', 'updated_at',
        ]);
    }

    public static function assertPlanets(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'planets'), 'planets', [
            'composition_family', 'dominant_surface_material', 'surface_pressure_bar',
            'water_state', 'methane_state', 'ammonia_state', 'dominant_surface_liquid',
            'radiation_level', 'habitability_score', 'life_friendliness', 'species_affinity_json',
        ]);
    }

    public static function assertStars(PDO $db): void
    {
        $columns = self::columns($db, 'star_systems');
        self::requireColumns($columns, 'star_systems', [
            'stellar_type', 'age_gyr', 'metallicity_z', 'is_binary', 'is_circumbinary',
            'companion_stellar_type', 'companion_spectral_class', 'companion_subtype',
            'companion_luminosity_class', 'companion_mass_solar', 'companion_radius_solar',
            'companion_temperature_k', 'companion_luminosity_solar', 'companion_separation_au',
            'companion_eccentricity', 'stability_critical_au', 'catalog_name', 'planet_count',
            'spectral_class',
        ]);
        if (!str_contains(strtolower($columns['spectral_class']), "'wd'")) {
            throw new RuntimeException('Star spectral schema is outdated; run canonical migrations before gameplay.');
        }
    }

    public static function assertBinaries(PDO $db): void
    {
        self::requireColumns(self::columns($db, 'binary_systems'), 'binary_systems', [
            'id', 'primary_star_system_id', 'is_circumbinary', 'companion_stellar_type',
            'companion_spectral_class', 'companion_subtype', 'companion_luminosity_class',
            'companion_mass_solar', 'companion_radius_solar', 'companion_temperature_k',
            'companion_luminosity_solar', 'separation_au', 'eccentricity',
            'stability_critical_au', 'mass_ratio', 'created_at', 'updated_at',
        ]);
    }

    /** @return array<string, string> */
    private static function columns(PDO $db, string $table): array
    {
        $query = $db->prepare(
            'SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
        );
        $query->execute([$table]);
        try {
            $columns = [];
            foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $columns[(string) $row['COLUMN_NAME']] = (string) $row['COLUMN_TYPE'];
            }
            return $columns;
        } finally {
            $query->closeCursor();
        }
    }

    /**
     * @param array<string, string> $columns
     * @param list<string> $required
     */
    private static function requireColumns(array $columns, string $table, array $required): void
    {
        foreach ($required as $name) {
            if (!array_key_exists($name, $columns)) {
                throw new RuntimeException(
                    'Missing galaxy schema: ' . $table . '.' . $name
                    . '; run canonical migrations before gameplay.'
                );
            }
        }
    }
}
