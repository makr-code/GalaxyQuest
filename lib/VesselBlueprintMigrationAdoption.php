<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class VesselBlueprintMigrationAdoption
{
    public const CONTRACT = 'vessel-blueprints-ftl-v1-v11-verified-v1';
    public const POLICY = 'adopt-existing-v1-v11-postconditions-without-replay-leave-v12-pending';
    public const SOURCES = [
        'migrate_vessel_blueprints_v1.sql' =>
            'da3c73d324ac3c7e78a55f465aa4688fc839eaf5d374dd6354dc1e26dd39d667',
        'migrate_vessel_blueprints_v2.sql' =>
            'b2d43b8d77401a18f62013142ae8d2dfcb1d3efba921440baafe861d372c1831',
        'migrate_vessel_blueprints_v3.sql' =>
            'bb1b5b5b49cd1c3f9c4b30698b82a5bc8c4cc6aaeff192df4c9f08d067fed18f',
        'migrate_vessel_blueprints_v4.sql' =>
            '706c72592b2036f1c4f2c12e35a74acced6d9e56fa7b3389ad6a92f8bddeae71',
        'migrate_vessel_blueprints_v5.sql' =>
            '18aaf8a0cbdaddf84250563868580ecf3c5f707e84c37b84897d11e66e5bd8fe',
        'migrate_vessel_blueprints_v6_planetary_events.sql' =>
            'a443b7144f3b24062066083188ded7ca45b8274d4df5633dfac4b0a6fcd1d2c7',
        'migrate_vessel_blueprints_v7_research_phase5.sql' =>
            'ea4e641bfb819527820bf7414ddf67aa5844f26021f627cdc2030d5d2a1cb4c3',
        'migrate_vessel_blueprints_v8_wormholes.sql' =>
            'f79bb8d9b80ea32ca7957dc8e792e5198b2dcce5e9a8981748402ad9cf3f927e',
        'migrate_vessel_blueprints_v9_wormhole_beacons.sql' =>
            'bdb1ac80fe514cd6759f7bbbc6e6a0537a9b2e05936372066ecda56ae207fd9a',
        'migrate_vessel_blueprints_v10_ftl_drives.sql' =>
            'f9c2c31e62251cfa700f5face720a96085ab014f479cb2cbaa06c2a95d18a871',
        'migrate_vessel_blueprints_v11_ftl_phase4.sql' =>
            'db953b36569ed4730a3b6cf68202d8dec998eea5c6c5bedbb5f276fbcd41581b',
    ];

    private const TABLES = [
        'vessel_hulls',
        'module_groups',
        'modules',
        'hull_module_compatibility',
        'vessel_blueprints',
        'vessel_blueprint_modules',
        'faction_tech_affinities',
        'built_vessels',
        'fleet_vessel_assignments',
        'colony_events',
        'research',
        'wormholes',
        'user_wormhole_unlocks',
        'ftl_gates',
        'ftl_resonance_nodes',
        'npc_factions',
        'npc_faction_memberships',
        'user_character_profiles',
        'faction_quests',
        'users',
        'fleets',
    ];

    /** @var array<string, int> */
    private const EXACT_COLUMN_COUNTS = [
        'vessel_hulls' => 28,
        'module_groups' => 5,
        'modules' => 18,
        'hull_module_compatibility' => 5,
        'vessel_blueprints' => 16,
        'vessel_blueprint_modules' => 5,
        'faction_tech_affinities' => 6,
        'built_vessels' => 10,
        'fleet_vessel_assignments' => 4,
        'colony_events' => 5,
        'research' => 6,
        'wormholes' => 11,
        'user_wormhole_unlocks' => 3,
        'ftl_gates' => 9,
        'ftl_resonance_nodes' => 6,
        'npc_faction_memberships' => 2,
    ];

    /** @var array<string, array<string, string>> */
    private const REQUIRED_COLUMNS = [
        'vessel_hulls' => [
            'ship_class' => 'varchar(32)',
            'slot_variation_json' => 'json',
            'base_energy_output' => 'decimal(12,2)',
            'base_energy_capacity' => 'decimal(12,2)',
            'base_energy_upkeep' => 'decimal(12,2)',
            'base_weapon_efficiency' => 'decimal(8,4)',
            'base_shield_efficiency' => 'decimal(8,4)',
            'base_attack_energy_share' => 'decimal(6,4)',
        ],
        'module_groups' => ['code' => 'varchar(64)'],
        'modules' => ['code' => 'varchar(64)', 'group_id' => 'bigint'],
        'hull_module_compatibility' => ['hull_id' => 'bigint', 'group_id' => 'bigint'],
        'vessel_blueprints' => [
            'slot_layout_code' => 'varchar(64)',
            'compiled_slot_profile_json' => 'json',
        ],
        'vessel_blueprint_modules' => ['blueprint_id' => 'bigint', 'module_id' => 'bigint'],
        'faction_tech_affinities' => [
            'faction_code' => 'varchar(64)',
            'module_group_code' => 'varchar(64)',
            'bonus_type' => "enum('cost_pct','build_time_pct','stat_mult','unlock_tier')",
            'bonus_value' => 'decimal(10,4)',
            'min_standing' => 'smallint',
        ],
        'built_vessels' => [
            'owner_user_id' => 'int',
            'colony_id' => 'int',
            'blueprint_id' => 'bigint',
            'status' => "enum('docked','assigned','destroyed')",
        ],
        'fleet_vessel_assignments' => ['fleet_id' => 'int', 'built_vessel_id' => 'bigint'],
        'colony_events' => [
            'event_type' => "enum('solar_flare','mineral_vein','disease','archaeological_find')",
        ],
        'research' => ['user_id' => 'int', 'type' => 'varchar(64)', 'level' => 'int'],
        'wormholes' => ['is_permanent' => 'tinyint(1)'],
        'user_wormhole_unlocks' => ['user_id' => 'int'],
        'ftl_gates' => ['owner_user_id' => 'int'],
        'ftl_resonance_nodes' => ['owner_user_id' => 'int'],
        'npc_factions' => ['code' => 'varchar(32)'],
        'npc_faction_memberships' => ['user_id' => 'int', 'faction_id' => 'int'],
        'user_character_profiles' => ['user_id' => 'int', 'race' => 'varchar(80)'],
        'faction_quests' => ['code' => 'varchar(64)', 'requirements_json' => 'text'],
        'users' => [
            'control_type' => 'varchar(24)',
            'ftl_drive_type' => 'varchar(30)',
            'ftl_cooldown_until' => 'datetime',
        ],
        'fleets' => [
            'mission' => "enum('attack','transport','colonize','harvest','spy','recall','survey')",
            'stealth_until' => 'datetime',
            'hull_damage_pct' => 'tinyint unsigned',
        ],
    ];

    /** @var array<string, array{list<string>, bool}> */
    private const REQUIRED_INDEXES = [
        'vessel_hulls.uq_vessel_hulls_code' => [['code'], true],
        'vessel_hulls.idx_vessel_hulls_class' => [['ship_class', 'tier', 'is_active'], false],
        'modules.uq_modules_code' => [['code'], true],
        'modules.idx_modules_group_active' => [['group_id', 'is_active', 'tier'], false],
        'hull_module_compatibility.PRIMARY' => [['hull_id', 'group_id'], true],
        'vessel_blueprints.uq_blueprints_user_code' => [['user_id', 'code'], true],
        'vessel_blueprints.idx_blueprints_hull' => [['hull_id'], false],
        'vessel_blueprint_modules.uq_blueprint_slot' => [['blueprint_id', 'slot_index'], true],
        'faction_tech_affinities.uq_fta' => [['faction_code', 'module_group_code', 'bonus_type'], true],
        'built_vessels.idx_bv_colony' => [['colony_id', 'status'], false],
        'fleet_vessel_assignments.uq_fva_vessel' => [['built_vessel_id'], true],
        'wormholes.idx_wormholes_a' => [['endpoint_a_galaxy', 'endpoint_a_system'], false],
        'wormholes.idx_wormholes_b' => [['endpoint_b_galaxy', 'endpoint_b_system'], false],
        'ftl_gates.idx_gates_a' => [['galaxy_a', 'system_a'], false],
        'ftl_gates.idx_gates_b' => [['galaxy_b', 'system_b'], false],
        'ftl_resonance_nodes.uniq_node' => [['owner_user_id', 'galaxy', 'system'], true],
    ];

    /** @var list<array{string,string,string,string,string}> */
    private const REQUIRED_FOREIGN_KEYS = [
        ['modules', 'group_id', 'module_groups', 'id', 'CASCADE'],
        ['hull_module_compatibility', 'hull_id', 'vessel_hulls', 'id', 'CASCADE'],
        ['hull_module_compatibility', 'group_id', 'module_groups', 'id', 'CASCADE'],
        ['vessel_blueprints', 'user_id', 'users', 'id', 'CASCADE'],
        ['vessel_blueprints', 'hull_id', 'vessel_hulls', 'id', 'RESTRICT'],
        ['vessel_blueprint_modules', 'blueprint_id', 'vessel_blueprints', 'id', 'CASCADE'],
        ['vessel_blueprint_modules', 'module_id', 'modules', 'id', 'RESTRICT'],
        ['built_vessels', 'colony_id', 'colonies', 'id', 'CASCADE'],
        ['built_vessels', 'blueprint_id', 'vessel_blueprints', 'id', 'CASCADE'],
        ['colony_events', 'colony_id', 'colonies', 'id', 'CASCADE'],
        ['user_wormhole_unlocks', 'user_id', 'users', 'id', 'CASCADE'],
        ['ftl_gates', 'owner_user_id', 'users', 'id', 'CASCADE'],
        ['ftl_resonance_nodes', 'owner_user_id', 'users', 'id', 'CASCADE'],
        ['npc_faction_memberships', 'user_id', 'users', 'id', 'CASCADE'],
        ['npc_faction_memberships', 'faction_id', 'npc_factions', 'id', 'CASCADE'],
    ];

    /** @return array<string, mixed> */
    public static function validate(PDO $db): array
    {
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('Vessel adoption requires a MySQL transaction.');
        }

        $schema = [];
        foreach (self::TABLES as $table) {
            $schema[$table] = self::validateTable($db, $table);
        }
        foreach (self::REQUIRED_INDEXES as $key => [$columns, $unique]) {
            [$table, $index] = explode('.', $key, 2);
            self::requireIndex($db, $table, $index, $columns, $unique);
        }
        foreach (self::REQUIRED_FOREIGN_KEYS as [$table, $column, $refTable, $refColumn, $deleteRule]) {
            self::requireForeignKey($db, $table, $column, $refTable, $refColumn, $deleteRule);
        }

        self::validateFactionSeeds($db);
        self::validateResearchSeeds($db);
        self::validateWormholeSeeds($db);
        self::validateFtlState($db);
        self::requireEmptyTables($db, [
            'vessel_hulls',
            'modules',
            'hull_module_compatibility',
            'vessel_blueprints',
            'vessel_blueprint_modules',
            'built_vessels',
            'fleet_vessel_assignments',
            'ftl_gates',
            'ftl_resonance_nodes',
            'user_wormhole_unlocks',
            'colony_events',
        ]);

        $snapshots = self::captureRows($db);
        ksort($snapshots);
        return [
            'contract' => self::CONTRACT,
            'policy' => self::POLICY,
            'sources' => self::SOURCES,
            'schema_sha256' => hash('sha256', json_encode($schema, JSON_THROW_ON_ERROR)),
            'identity_sha256' => hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR)),
            'tables' => $snapshots,
        ];
    }

    /** @return array<string, mixed> */
    private static function validateTable(PDO $db, string $table): array
    {
        $query = $db->prepare(
            'SELECT ENGINE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?'
        );
        $query->execute([$table]);
        $engine = $query->fetchColumn();
        $query->closeCursor();
        if ($engine !== 'InnoDB') {
            throw new RuntimeException('Vessel adoption requires InnoDB: ' . $table);
        }

        $query = $db->prepare(
            'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
             ORDER BY ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $columns = $query->fetchAll(PDO::FETCH_ASSOC);
        if (isset(self::EXACT_COLUMN_COUNTS[$table]) && count($columns) !== self::EXACT_COLUMN_COUNTS[$table]) {
            throw new RuntimeException('Vessel adoption rejects an incomplete or evolved table: ' . $table);
        }
        $byName = array_column($columns, null, 'COLUMN_NAME');
        foreach (self::REQUIRED_COLUMNS[$table] as $name => $type) {
            if (strtolower((string)($byName[$name]['COLUMN_TYPE'] ?? '')) !== $type) {
                throw new RuntimeException('Vessel adoption schema mismatch: ' . $table . '.' . $name);
            }
        }

        $indexes = self::readNamedIndexes($db, $table);
        return [
            'columns' => $columns,
            'indexes' => $indexes,
            'foreign_keys' => self::readForeignKeys($db, $table),
        ];
    }

    /** @return array<string, list<array{column:string,non_unique:int,sub_part:int|null}>> */
    private static function readNamedIndexes(PDO $db, string $table): array
    {
        $query = $db->prepare(
            'SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,SUB_PART
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
             ORDER BY INDEX_NAME,SEQ_IN_INDEX'
        );
        $query->execute([$table]);
        $indexes = [];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $indexes[$row['INDEX_NAME']][] = [
                'column' => $row['COLUMN_NAME'],
                'non_unique' => (int)$row['NON_UNIQUE'],
                'sub_part' => $row['SUB_PART'] === null ? null : (int)$row['SUB_PART'],
            ];
        }
        return $indexes;
    }

    /** @param list<string> $columns */
    private static function requireIndex(PDO $db, string $table, string $name, array $columns, bool $unique): void
    {
        $indexes = self::readNamedIndexes($db, $table);
        $actual = $indexes[$name] ?? [];
        if (
            array_column($actual, 'column') !== $columns
            || array_filter($actual, static fn(array $row): bool => $row['non_unique'] !== ($unique ? 0 : 1)) !== []
        ) {
            throw new RuntimeException('Vessel adoption requires index ' . $table . '.' . $name);
        }
    }

    /** @return list<array{column:string,ref_table:string,ref_column:string,delete_rule:string}> */
    private static function readForeignKeys(PDO $db, string $table): array
    {
        $query = $db->prepare(
            'SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE
             FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
              AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
             WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=?
               AND k.REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $rows = [];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $rows[] = [
                'column' => $row['COLUMN_NAME'],
                'ref_table' => $row['REFERENCED_TABLE_NAME'],
                'ref_column' => $row['REFERENCED_COLUMN_NAME'],
                'delete_rule' => $row['DELETE_RULE'],
            ];
        }
        return $rows;
    }

    private static function requireForeignKey(
        PDO $db,
        string $table,
        string $column,
        string $refTable,
        string $refColumn,
        string $deleteRule
    ): void {
        foreach (self::readForeignKeys($db, $table) as $foreignKey) {
            if (
                $foreignKey['column'] === $column
                && $foreignKey['ref_table'] === $refTable
                && $foreignKey['ref_column'] === $refColumn
                && $foreignKey['delete_rule'] === $deleteRule
            ) {
                return;
            }
        }
        throw new RuntimeException('Vessel adoption requires the foreign key: ' . $table . '.' . $column);
    }

    private static function validateFactionSeeds(PDO $db): void
    {
        // v3 uses INSERT IGNORE, so evolved faction definitions must be preserved.
        $countQuery = $db->query(
            "SELECT COUNT(*) FROM npc_factions
             WHERE code IN ('iron_fleet','aereth','omniscienta','vor_tak','syl_nar','zhareen')"
        );
        $count = (int)$countQuery->fetchColumn();
        $countQuery->closeCursor();
        if ($count !== 6) {
            throw new RuntimeException('Vessel adoption requires all six v3 faction seeds.');
        }

        $affinities = $db->query(
            'SELECT faction_code,module_group_code,bonus_type,bonus_value,min_standing
             FROM faction_tech_affinities ORDER BY faction_code,module_group_code,bonus_type'
        )->fetchAll(PDO::FETCH_NUM);
        if (count($affinities) !== 27) {
            throw new RuntimeException('Vessel adoption requires the complete 27-row v3 affinity seed.');
        }
        foreach ($affinities as &$row) {
            $row[3] = number_format((float)$row[3], 4, '.', '');
            $row[4] = (int)$row[4];
        }
        unset($row);
        $expectedAffinities = [
            ['guild', 'weapon', 'cost_pct', '-10.0000', 10],
            ['guild', 'weapon', 'build_time_pct', '-15.0000', 15],
            ['guild', 'shield', 'cost_pct', '-5.0000', 10],
            ['guild', 'utility', 'cost_pct', '-5.0000', 20],
            ['science', 'utility', 'cost_pct', '-15.0000', 5],
            ['science', 'shield', 'stat_mult', '0.0500', 10],
            ['science', 'weapon', 'build_time_pct', '-8.0000', 15],
            ['empire', 'weapon', 'stat_mult', '0.0800', 10],
            ['empire', 'propulsion', 'build_time_pct', '-10.0000', 5],
            ['iron_fleet', 'weapon', 'stat_mult', '0.1000', 10],
            ['iron_fleet', 'weapon', 'build_time_pct', '-12.0000', 15],
            ['iron_fleet', 'propulsion', 'cost_pct', '-8.0000', 5],
            ['aereth', 'shield', 'stat_mult', '0.0800', 5],
            ['aereth', 'shield', 'cost_pct', '-10.0000', 10],
            ['aereth', 'weapon', 'cost_pct', '-8.0000', 15],
            ['omniscienta', 'utility', 'cost_pct', '-20.0000', 5],
            ['omniscienta', 'utility', 'build_time_pct', '-15.0000', 10],
            ['omniscienta', 'propulsion', 'stat_mult', '0.0600', 10],
            ['vor_tak', 'weapon', 'stat_mult', '0.1200', 10],
            ['vor_tak', 'hull', 'stat_mult', '0.1000', 5],
            ['syl_nar', 'propulsion', 'stat_mult', '0.0800', 5],
            ['syl_nar', 'utility', 'build_time_pct', '-18.0000', 10],
            ['syl_nar', 'propulsion', 'cost_pct', '-10.0000', 15],
            ['zhareen', 'shield', 'stat_mult', '0.1000', 5],
            ['zhareen', 'shield', 'cost_pct', '-12.0000', 10],
            ['zhareen', 'hull', 'stat_mult', '0.0800', 10],
            ['zhareen', 'hull', 'build_time_pct', '-10.0000', 15],
        ];
        usort($affinities, self::compareRows(...));
        usort($expectedAffinities, self::compareRows(...));
        if ($affinities !== $expectedAffinities) {
            throw new RuntimeException('Vessel adoption found changed or missing v3 faction affinities.');
        }
    }

    private static function compareRows(array $left, array $right): int
    {
        $bonusOrder = ['cost_pct' => 0, 'build_time_pct' => 1, 'stat_mult' => 2, 'unlock_tier' => 3];
        return [
            $left[0],
            $left[1],
            $bonusOrder[$left[2]],
            $left[3],
            $left[4],
        ] <=> [
            $right[0],
            $right[1],
            $bonusOrder[$right[2]],
            $right[3],
            $right[4],
        ];
    }

    private static function validateResearchSeeds(PDO $db): void
    {
        $targetTypes = [
            'nano_materials',
            'genetic_engineering',
            'quantum_computing',
            'dark_energy_tap',
            'wormhole_theory',
            'terraforming_tech',
            'stealth_tech',
        ];
        $userCount = (int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn();
        $query = $db->prepare(
            'SELECT COUNT(*),SUM(level<>0) FROM research WHERE type IN ('
            . implode(',', array_fill(0, count($targetTypes), '?')) . ')'
        );
        $query->execute($targetTypes);
        [$count, $nonzero] = $query->fetch(PDO::FETCH_NUM);
        $query->closeCursor();
        $missing = $db->prepare(
            'SELECT COUNT(*) FROM users u CROSS JOIN (SELECT ? AS type UNION ALL SELECT ? UNION ALL SELECT ?
             UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ? UNION ALL SELECT ?) t
             LEFT JOIN research r ON r.user_id=u.id AND r.type=t.type WHERE r.user_id IS NULL'
        );
        $missing->execute($targetTypes);
        $missingCount = (int)$missing->fetchColumn();
        $missing->closeCursor();
        if ((int)$count !== $userCount * count($targetTypes) || (int)$nonzero !== 0 || $missingCount !== 0) {
            throw new RuntimeException('Vessel adoption requires complete level-zero v7 research seeds.');
        }
    }

    private static function validateWormholeSeeds(PDO $db): void
    {
        $routes = $db->query(
            'SELECT endpoint_a_galaxy,endpoint_a_system,endpoint_b_galaxy,endpoint_b_system,
                    stability,is_active,is_permanent,label
             FROM wormholes ORDER BY id'
        )->fetchAll(PDO::FETCH_NUM);
        $expected = [
            [1, 1, 1, 120, 100, 1, 0, 'Sol Transit Gate'],
            [1, 120, 1, 260, 100, 1, 1, 'Precursor Beacon Arc'],
        ];
        foreach ($routes as &$route) {
            for ($index = 0; $index < 7; $index++) {
                $route[$index] = (int)$route[$index];
            }
        }
        unset($route);
        if ($routes !== $expected) {
            throw new RuntimeException('Vessel adoption requires both canonical v8/v9 wormhole routes.');
        }
        $questQuery = $db->query(
            "SELECT title,quest_type,requirements_json FROM faction_quests
             WHERE code='precursor_wormhole_beacon'"
        );
        $quest = $questQuery->fetch(PDO::FETCH_ASSOC);
        $questQuery->closeCursor();
        if (
            !$quest
            || $quest['title'] !== 'Unlock the Ancient Beacon'
            || $quest['quest_type'] !== 'research'
            || json_decode((string)$quest['requirements_json'], true, 512, JSON_THROW_ON_ERROR)
                !== ['tech' => 'wormhole_theory', 'level' => 5]
        ) {
            throw new RuntimeException('Vessel adoption requires the canonical precursor beacon quest.');
        }
    }

    private static function validateFtlState(PDO $db): void
    {
        $mappableQuery = $db->query(
            "SELECT COUNT(*) FROM users u JOIN user_character_profiles p ON p.user_id=u.id
             WHERE u.ftl_drive_type='aereth'
               AND CASE
                   WHEN LOWER(p.race) LIKE '%vor%tak%' THEN 'vor_tak'
                   WHEN LOWER(p.race) LIKE '%syl%nar%' THEN 'syl_nar'
                   WHEN LOWER(p.race) LIKE '%vel%ar%' THEN 'vel_ar'
                   WHEN LOWER(p.race) LIKE '%zhareen%' THEN 'zhareen'
                   WHEN LOWER(p.race) LIKE '%aereth%' THEN 'aereth'
                   WHEN LOWER(p.race) LIKE '%kryl%tha%' THEN 'kryl_tha'
                   ELSE 'aereth'
               END <> u.ftl_drive_type"
        );
        $mappableRaceUpdates = (int)$mappableQuery->fetchColumn();
        $mappableQuery->closeCursor();
        if ($mappableRaceUpdates !== 0) {
            throw new RuntimeException('Vessel adoption found unapplied v10 race-to-drive mappings.');
        }

        $targets = $db->query(
            "SELECT nf.code,COUNT(*) AS total,
                    SUM(u.ftl_drive_type='aereth') AS default_drive
             FROM users u JOIN npc_faction_memberships fm ON fm.user_id=u.id
             JOIN npc_factions nf ON nf.id=fm.faction_id
             WHERE u.control_type='npc_engine'
               AND nf.code IN ('empire','guild','science','pirates','precursors')
             GROUP BY nf.code ORDER BY nf.code"
        )->fetchAll(PDO::FETCH_NUM);
        $expected = [
            ['empire', 2, 2],
            ['guild', 2, 2],
            ['pirates', 2, 2],
            ['precursors', 2, 2],
            ['science', 2, 2],
        ];
        foreach ($targets as &$target) {
            $target[1] = (int)$target[1];
            $target[2] = (int)$target[2];
        }
        unset($target);
        if ($targets !== $expected) {
            throw new RuntimeException('Vessel adoption requires the v12 NPC drive update to remain unapplied.');
        }
    }

    /** @param list<string> $tables */
    private static function requireEmptyTables(PDO $db, array $tables): void
    {
        foreach ($tables as $table) {
            $query = $db->query('SELECT COUNT(*) FROM `' . $table . '`');
            $count = (int)$query->fetchColumn();
            $query->closeCursor();
            if ($count !== 0) {
                throw new RuntimeException('Vessel adoption rejects unexpected rows in ' . $table . '.');
            }
        }
    }

    /** @return array<string, array{count:int,sha256:string}> */
    private static function captureRows(PDO $db): array
    {
        $queries = [
            'vessel_hulls' => 'SELECT * FROM vessel_hulls ORDER BY id',
            'module_groups' => 'SELECT * FROM module_groups ORDER BY id',
            'modules' => 'SELECT * FROM modules ORDER BY id',
            'hull_module_compatibility' => 'SELECT * FROM hull_module_compatibility ORDER BY hull_id,group_id',
            'vessel_blueprints' => 'SELECT * FROM vessel_blueprints ORDER BY id',
            'vessel_blueprint_modules' => 'SELECT * FROM vessel_blueprint_modules ORDER BY id',
            'faction_tech_affinities' => 'SELECT * FROM faction_tech_affinities ORDER BY id',
            'built_vessels' => 'SELECT * FROM built_vessels ORDER BY id',
            'fleet_vessel_assignments' => 'SELECT * FROM fleet_vessel_assignments ORDER BY id',
            'colony_events' => 'SELECT * FROM colony_events ORDER BY id',
            'research' => 'SELECT id,user_id,type,level,research_start,research_end '
                . 'FROM research ORDER BY id',
            'wormholes' => 'SELECT * FROM wormholes ORDER BY id',
            'user_wormhole_unlocks' => 'SELECT user_id,source_quest_code,unlocked_at '
                . 'FROM user_wormhole_unlocks ORDER BY user_id',
            'ftl_gates' => 'SELECT * FROM ftl_gates ORDER BY id',
            'ftl_resonance_nodes' => 'SELECT * FROM ftl_resonance_nodes ORDER BY id',
            'npc_factions' => 'SELECT * FROM npc_factions ORDER BY id',
            'npc_faction_memberships' => 'SELECT user_id,faction_id FROM npc_faction_memberships ORDER BY user_id',
            'user_character_profiles' => 'SELECT user_id,race FROM user_character_profiles ORDER BY user_id',
            'faction_quests' => 'SELECT id,faction_id,code,quest_type,requirements_json '
                . 'FROM faction_quests ORDER BY id',
            'users' => 'SELECT id,control_type,ftl_drive_type,ftl_cooldown_until '
                . 'FROM users ORDER BY id',
            'fleets' => 'SELECT id,mission,stealth_until,hull_damage_pct FROM fleets ORDER BY id',
        ];
        $snapshots = [];
        foreach ($queries as $table => $sql) {
            $rows = $db->query($sql);
            $hash = hash_init('sha256');
            $count = 0;
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR) . "\n");
                $count++;
            }
            $rows->closeCursor();
            $snapshots[$table] = ['count' => $count, 'sha256' => hash_final($hash)];
        }
        return $snapshots;
    }

    /** @param array<string, mixed> $evidence */
    public static function validateEvidence(array $evidence): void
    {
        $tables = $evidence['tables'] ?? null;
        $sources = $evidence['sources'] ?? null;
        $expectedSources = self::SOURCES;
        $expectedTables = self::TABLES;
        sort($expectedTables);
        if (is_array($sources)) {
            ksort($sources);
            ksort($expectedSources);
        }
        if (is_array($tables)) {
            ksort($tables);
        }
        if (
            ($evidence['contract'] ?? '') !== self::CONTRACT
            || ($evidence['policy'] ?? '') !== self::POLICY
            || $sources !== $expectedSources
            || !is_string($evidence['schema_sha256'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/D', $evidence['schema_sha256'])
            || !is_string($evidence['identity_sha256'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/D', $evidence['identity_sha256'])
            || !is_array($tables)
            || array_keys($tables) !== $expectedTables
            || count($evidence) !== 6
            || !hash_equals(
                $evidence['identity_sha256'],
                hash('sha256', json_encode($tables, JSON_THROW_ON_ERROR))
            )
        ) {
            throw new RuntimeException('Invalid Vessel adoption policy or evidence.');
        }
        foreach ($tables as $snapshot) {
            if (
                !is_array($snapshot) || count($snapshot) !== 2
                || !is_int($snapshot['count'] ?? null) || $snapshot['count'] < 0
                || !is_string($snapshot['sha256'] ?? null)
                || !preg_match('/^[a-f0-9]{64}$/D', $snapshot['sha256'])
            ) {
                throw new RuntimeException('Invalid Vessel adoption table evidence.');
            }
        }
    }
}
