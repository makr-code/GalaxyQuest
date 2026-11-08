<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class BodyMigrationAdoption
{
    public const CONTRACT = 'body-native-v1';
    public const SOURCES = [
        'migrate_unified_bodies_v1.sql' => '129451622e22fb98fed3a7105553da98053342217a1a0c3bbfb4b724b4ad2480',
        'migrate_unified_bodies_v2_hardcut.sql' => '1974d43647a5261f5f16d6e8a874374568f4a8b724eeb60434824686906af73c',
    ];

    /** @return array<string, mixed> */
    public static function validate(PDO $db): array
    {
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('Body adoption requires a MySQL transaction.');
        }
        $requirements = [
            'celestial_bodies' => [
                'id' => ['bigint unsigned', 'NO'], 'body_uid' => ['varchar(64)', 'NO'],
                'galaxy_index' => ['int unsigned', 'NO'], 'system_index' => ['int unsigned', 'NO'],
                'position' => ['smallint unsigned', 'YES'], 'parent_body_id' => ['bigint unsigned', 'YES'],
                'body_type' => ["enum('planet','moon','comet','rogue_planet','ring_system')", 'NO'],
                'parent_body_type' => ["enum('star','planet','moon','none')", 'NO'],
                'name' => ['varchar(96)', 'NO'], 'planet_class' => ['varchar(32)', 'YES'],
                'can_colonize' => ['tinyint(1)', 'NO'], 'diameter_km' => ['int unsigned', 'YES'],
                'atmosphere_type' => ['varchar(32)', 'YES'], 'ring_composition' => ['varchar(32)', 'YES'],
                'payload_json' => ['json', 'YES'], 'created_at' => ['datetime', 'NO'],
                'updated_at' => ['datetime', 'NO'],
            ],
            'colonies' => ['body_id' => ['bigint unsigned', 'NO']],
            'battle_reports' => ['body_id' => ['bigint unsigned', 'NO']],
            'spy_reports' => ['target_body_id' => ['bigint unsigned', 'YES']],
        ];
        foreach (
            ['orbit_ref_au', 'semi_major_axis_au', 'semi_major_axis_parent_r', 'orbital_period_days',
             'orbital_eccentricity', 'mass_earth', 'surface_gravity_g', 'eq_temp_k',
             'ring_inner_radius_planet_r', 'ring_outer_radius_planet_r', 'ring_optical_depth', 'ring_tilt_deg'] as $name
        ) {
            $requirements['celestial_bodies'][$name] = ['double', 'YES'];
        }
        $metadata = [];
        foreach ($requirements as $table => $required) {
            $query = $db->prepare(
                'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?'
            );
            $query->execute([$table]);
            if ($query->fetchColumn() !== 'InnoDB') {
                throw new RuntimeException('Body adoption requires InnoDB: ' . $table);
            }
            $query = $db->prepare(
                'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY COLUMN_NAME'
            );
            $query->execute([$table]);
            $columns = $query->fetchAll(PDO::FETCH_UNIQUE | PDO::FETCH_ASSOC);
            foreach ($required as $column => [$type, $nullable]) {
                if (
                    ($columns[$column]['COLUMN_TYPE'] ?? '') !== $type
                    || ($columns[$column]['IS_NULLABLE'] ?? '') !== $nullable
                ) {
                    throw new RuntimeException('Body adoption schema mismatch: ' . $table . '.' . $column);
                }
            }
            if (
                ($table === 'battle_reports' && isset($columns['planet_id']))
                || ($table === 'spy_reports' && isset($columns['target_planet_id']))
            ) {
                throw new RuntimeException('Legacy report identity must be reconciled before body adoption.');
            }
            $metadata[$table] = $columns;
        }
        foreach (
            ['celestial_bodies' => [
                ['PRIMARY', ['id'], 0], ['uq_body_uid', ['body_uid'], 0],
                ['idx_body_system', ['galaxy_index', 'system_index'], 1],
                ['idx_body_type', ['body_type'], 1], ['idx_parent_body_id', ['parent_body_id'], 1],
            ], 'colonies' => [
                ['unique_colony_body', ['body_id'], 0], ['idx_colonies_body_id', ['body_id'], 1],
            ], 'battle_reports' => [['idx_battle_body_id', ['body_id'], 1]],
             'spy_reports' => [['idx_spy_target_body', ['target_body_id'], 1]]] as $table => $indexes
        ) {
            foreach ($indexes as [$name, $columns, $nonUnique]) {
                $query = $db->prepare(
                    'SELECT COLUMN_NAME,NON_UNIQUE,SUB_PART FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX'
                );
                $query->execute([$table, $name]);
                $index = $query->fetchAll(PDO::FETCH_ASSOC);
                if (
                    array_column($index, 'COLUMN_NAME') !== $columns
                    || array_unique(array_column($index, 'NON_UNIQUE')) !== [$nonUnique]
                    || array_filter(array_column($index, 'SUB_PART'), static fn(mixed $part): bool => $part !== null)
                ) {
                    throw new RuntimeException('Body adoption requires the complete index: ' . $table . '.' . $name);
                }
            }
        }
        foreach (
            [['celestial_bodies', 'fk_celestial_parent', 'parent_body_id', 'SET NULL'],
             ['colonies', 'fk_colonies_body_id', 'body_id', 'CASCADE']] as [$table, $name, $column, $deleteRule]
        ) {
            $query = $db->prepare(
                'SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE
                 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
                 AND r.TABLE_NAME=k.TABLE_NAME
                 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.CONSTRAINT_NAME=?'
            );
            $query->execute([$table, $name]);
            if (
                $query->fetchAll(PDO::FETCH_ASSOC) !== [[
                'COLUMN_NAME' => $column, 'REFERENCED_TABLE_NAME' => 'celestial_bodies',
                'REFERENCED_COLUMN_NAME' => 'id', 'DELETE_RULE' => $deleteRule,
                ]]
            ) {
                throw new RuntimeException('Body adoption foreign key mismatch: ' . $name);
            }
        }
        $colonies = $db->query('SELECT id,body_id,planet_id FROM colonies ORDER BY id FOR UPDATE')
            ->fetchAll(PDO::FETCH_ASSOC);
        $battles = $db->query('SELECT id,body_id FROM battle_reports ORDER BY id FOR UPDATE')
            ->fetchAll(PDO::FETCH_ASSOC);
        $spies = $db->query('SELECT id,target_body_id FROM spy_reports ORDER BY id FOR UPDATE')
            ->fetchAll(PDO::FETCH_ASSOC);
        foreach (
            ['SELECT COUNT(*) FROM colonies c LEFT JOIN celestial_bodies b ON b.id=c.body_id WHERE b.id IS NULL',
             'SELECT COUNT(*) FROM battle_reports r LEFT JOIN celestial_bodies b ON b.id=r.body_id WHERE b.id IS NULL',
             'SELECT COUNT(*) FROM spy_reports r LEFT JOIN celestial_bodies b ON b.id=r.target_body_id
              WHERE r.target_body_id IS NOT NULL AND b.id IS NULL',
             'SELECT COUNT(*) FROM celestial_bodies b LEFT JOIN celestial_bodies p ON p.id=b.parent_body_id
              WHERE b.parent_body_id IS NOT NULL AND (p.id IS NULL OR p.id=b.id)',
             'SELECT COUNT(*) FROM colonies c LEFT JOIN planets p ON p.id=c.planet_id
              JOIN celestial_bodies b ON b.id=c.body_id WHERE c.planet_id IS NOT NULL AND
              (p.id IS NULL OR b.body_type<>\'planet\' OR b.galaxy_index<>p.galaxy
               OR b.system_index<>p.`system` OR NOT(b.position <=> p.position))'] as $sql
        ) {
            if ((int)$db->query($sql)->fetchColumn() !== 0) {
                throw new RuntimeException('Native body/report/legacy-colony mapping is incomplete or inconsistent.');
            }
        }
        return ['contract' => self::CONTRACT, 'schema' => 'native-body-authoritative',
            'policy' => 'preserve-native-catalogue-no-uninhabited-legacy-import',
            'body_count' => (int)$db->query('SELECT COUNT(*) FROM celestial_bodies')->fetchColumn(),
            'colony_count' => count($colonies), 'battle_report_count' => count($battles),
            'spy_report_count' => count($spies),
            'identity_sha256' => hash('sha256', json_encode([$colonies, $battles, $spies], JSON_THROW_ON_ERROR)),
            'schema_sha256' => hash('sha256', json_encode($metadata, JSON_THROW_ON_ERROR))];
    }
}
