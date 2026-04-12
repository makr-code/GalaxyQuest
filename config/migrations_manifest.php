<?php

declare(strict_types=1);

/**
 * GalaxyQuest — canonical ordered migration manifest.
 *
 * This file defines the complete, ordered list of SQL migration files that
 * make up the GalaxyQuest database schema.  The migration runner
 * (lib/MigrationRunner.php / scripts/migrate.php) uses this order to
 * determine which migrations are pending and to apply them in the correct
 * sequence.
 *
 * Rules:
 *  - New migrations MUST be appended at the END of the list.
 *  - Never re-order or remove an entry; that would break existing deployments.
 *  - The schema.sql base install is handled separately by setup.php and is
 *    NOT included here (it is recorded automatically with the special name
 *    "schema.sql" when the runner bootstraps on a fresh database).
 *  - A down-migration companion file named <basename>_down.sql (same
 *    directory) enables the `rollback` command for that migration.
 *
 * @see scripts/migrate.php
 * @see lib/MigrationRunner.php
 * @see docs/technical/DATABASE_MIGRATIONS.md
 */

return [
    // ── Core schema evolution (legacy v2 path) ────────────────────────────
    'migrate_v2.sql',

    // ── Gameplay / politics base models ──────────────────────────────────
    'migrate_gameplay_model_v1.sql',
    'migrate_politics_model_v1.sql',

    // ── Economy ───────────────────────────────────────────────────────────
    'migrate_economy_v1.sql',
    'migrate_economy_v2.sql',
    'migrate_economy_v3.sql',
    'migrate_economy_policies_v1.sql',
    'migrate_economy_shortage_v1.sql',
    'migrate_empire_categories_v1.sql',

    // ── Security / auth ───────────────────────────────────────────────────
    'migrate_security_v1.sql',
    'migrate_security_v2_totp.sql',
    'migrate_admin_user_crud_v1.sql',
    'migrate_rbac_v1.sql',

    // ── Actor / NPC models ────────────────────────────────────────────────
    'migrate_actor_model_v1.sql',
    'migrate_actor_model_v2_drop_is_npc.sql',

    // ── Colonization ──────────────────────────────────────────────────────
    'migrate_colonization_v1.sql',
    'migrate_colonization_v2.sql',
    'migrate_colony_buildings_v1.sql',

    // ── Galaxy / celestial bodies ─────────────────────────────────────────
    'migrate_unified_bodies_v1.sql',
    'migrate_unified_bodies_v2_hardcut.sql',
    'migrate_orbital_polar_coordinates_v1.sql',
    'migrate_galaxies_metadata.sql',
    'migrate_fog_of_war.sql',

    // ── Vessel blueprints ─────────────────────────────────────────────────
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
    'migrate_vessel_blueprints_v12_npc_ftl.sql',

    // ── Combat / wars ─────────────────────────────────────────────────────
    'migrate_combat_model_v1.sql',
    'migrate_combat_v1_wars.sql',
    'migrate_npc_wars_v1.sql',
    'migrate_war_v3.sql',

    // ── Fleet / transport ─────────────────────────────────────────────────
    'migrate_fleet_labels_v1.sql',
    'migrate_transport_generic_v1.sql',

    // ── Faction / species ─────────────────────────────────────────────────
    'migrate_faction_species_v1.sql',
    'migrate_faction_agreements_v1.sql',

    // ── NPC / PvE ─────────────────────────────────────────────────────────
    'migrate_npc_pve_controller_v1.sql',
    'migrate_npc_pve_controller_v2.sql',

    // ── LLM / NPC-chat ────────────────────────────────────────────────────
    'migrate_llm_soc_v1.sql',
    'migrate_npc_chat_history_v1.sql',

    // ── Pirate system ─────────────────────────────────────────────────────
    'migrate_pirates_v2.sql',
    'migrate_pirates_v3.sql',

    // ── Traders / marketplace ─────────────────────────────────────────────
    'migrate_traders_system_v1.sql',
    'migrate_trade_proposals_v1.sql',
    'migrate_marketplace_advisor.sql',

    // ── Projections ───────────────────────────────────────────────────────
    'migrate_projection_system_snapshot_v1.sql',
    'migrate_projection_user_overview_v1.sql',
    'migrate_projection_runtime_v2.sql',

    // ── TTS ───────────────────────────────────────────────────────────────
    'migrate_tts_v1.sql',

    // ── Onboarding / quests ───────────────────────────────────────────────
    'migrate_prolog_quests_v1.sql',

    // ── World scenarios ───────────────────────────────────────────────────
    'migrate_world_scenarios_v1.sql',
];
