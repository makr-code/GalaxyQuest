<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class WarHistoryMigrationAdoption
{
    public const CONTRACT = 'combat-war-history-v1-npc-v1-verified-v1';
    public const POLICY = 'preserve-existing-war-schema-and-rows-without-replay';
    public const SOURCES = [
        'migrate_combat_v1_wars.sql' => '4af9a6bb51b73fab74194799ca0a0638f773fb0d3d61a8417be00e08af27fbac',
        'migrate_npc_wars_v1.sql' => '76e0dd3593813a4a98e75bb2a1a8729edcc55de2d8b72a0b751f6d2586b7aa53',
    ];

    /** @var array<string, array<string, array{type:string,nullable:string,default:mixed,extra:string}>> */
    private const COLUMNS = [
        'wars' => [
            'id' => ['type' => 'bigint', 'nullable' => 'NO', 'default' => null, 'extra' => 'auto_increment'],
            'attacker_user_id' => ['type' => 'int', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
            'defender_user_id' => ['type' => 'int', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'status' => ['type' => "enum('active','ended')", 'nullable' => 'NO', 'default' => 'active', 'extra' => ''],
            'war_score_att' => ['type' => 'int', 'nullable' => 'NO', 'default' => '0', 'extra' => ''],
            'war_score_def' => ['type' => 'int', 'nullable' => 'NO', 'default' => '0', 'extra' => ''],
            'exhaustion_att' => ['type' => 'decimal(7,2)', 'nullable' => 'NO', 'default' => '0.00', 'extra' => ''],
            'exhaustion_def' => ['type' => 'decimal(7,2)', 'nullable' => 'NO', 'default' => '0.00', 'extra' => ''],
            'casus_belli' => ['type' => 'varchar(120)', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
            'started_at' => [
                'type' => 'datetime',
                'nullable' => 'NO',
                'default' => 'CURRENT_TIMESTAMP',
                'extra' => 'default_generated',
            ],
            'ended_at' => ['type' => 'datetime', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
            'ended_reason' => ['type' => 'varchar(64)', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
            'npc_aggressor_faction_id' => ['type' => 'int', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
        ],
        'war_goals' => [
            'id' => ['type' => 'bigint', 'nullable' => 'NO', 'default' => null, 'extra' => 'auto_increment'],
            'war_id' => ['type' => 'bigint', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'side' => ['type' => "enum('attacker','defender')", 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'goal_type' => ['type' => 'varchar(40)', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'target_id' => ['type' => 'bigint', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
            'target_value' => ['type' => 'varchar(120)', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
            'score_value' => ['type' => 'int', 'nullable' => 'NO', 'default' => '0', 'extra' => ''],
            'created_at' => [
                'type' => 'datetime',
                'nullable' => 'NO',
                'default' => 'CURRENT_TIMESTAMP',
                'extra' => 'default_generated',
            ],
        ],
        'peace_offers' => [
            'id' => ['type' => 'bigint', 'nullable' => 'NO', 'default' => null, 'extra' => 'auto_increment'],
            'war_id' => ['type' => 'bigint', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'from_user_id' => ['type' => 'int', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'terms_json' => ['type' => 'json', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'created_at' => [
                'type' => 'datetime',
                'nullable' => 'NO',
                'default' => 'CURRENT_TIMESTAMP',
                'extra' => 'default_generated',
            ],
            'expires_at' => ['type' => 'datetime', 'nullable' => 'NO', 'default' => null, 'extra' => ''],
            'status' => [
                'type' => "enum('pending','accepted','rejected','expired')",
                'nullable' => 'NO',
                'default' => 'pending',
                'extra' => '',
            ],
            'responded_at' => ['type' => 'datetime', 'nullable' => 'YES', 'default' => null, 'extra' => ''],
        ],
    ];

    /** @var array<string, array<string, array{columns:list<string>,non_unique:int}>> */
    private const INDEXES = [
        'wars' => [
            'PRIMARY' => ['columns' => ['id'], 'non_unique' => 0],
            'idx_wars_status' => ['columns' => ['status'], 'non_unique' => 1],
            'idx_wars_attacker_status' => ['columns' => ['attacker_user_id', 'status'], 'non_unique' => 1],
            'idx_wars_defender_status' => ['columns' => ['defender_user_id', 'status'], 'non_unique' => 1],
            'idx_wars_started_at' => ['columns' => ['started_at'], 'non_unique' => 1],
            'idx_wars_npc_aggressor' => ['columns' => ['npc_aggressor_faction_id'], 'non_unique' => 1],
        ],
        'war_goals' => [
            'PRIMARY' => ['columns' => ['id'], 'non_unique' => 0],
            'idx_war_goals_war_side' => ['columns' => ['war_id', 'side'], 'non_unique' => 1],
            'idx_war_goals_type' => ['columns' => ['goal_type'], 'non_unique' => 1],
        ],
        'peace_offers' => [
            'PRIMARY' => ['columns' => ['id'], 'non_unique' => 0],
            'idx_peace_offers_war' => ['columns' => ['war_id'], 'non_unique' => 1],
            'idx_peace_offers_status_expiry' => ['columns' => ['status', 'expires_at'], 'non_unique' => 1],
            'idx_peace_offers_from_user' => ['columns' => ['from_user_id'], 'non_unique' => 1],
        ],
    ];

    /** @var list<array{name:string,column:string,referenced_table:string,referenced_column:string,delete_rule:string,update_rule:string}> */
    private const FOREIGN_KEYS = [
        ['name' => 'fk_wars_attacker', 'column' => 'attacker_user_id', 'referenced_table' => 'users',
            'referenced_column' => 'id', 'delete_rule' => 'CASCADE', 'update_rule' => 'NO ACTION'],
        ['name' => 'fk_wars_defender', 'column' => 'defender_user_id', 'referenced_table' => 'users',
            'referenced_column' => 'id', 'delete_rule' => 'CASCADE', 'update_rule' => 'NO ACTION'],
        ['name' => 'fk_war_goals_war', 'column' => 'war_id', 'referenced_table' => 'wars',
            'referenced_column' => 'id', 'delete_rule' => 'CASCADE', 'update_rule' => 'NO ACTION'],
        ['name' => 'fk_peace_offers_war', 'column' => 'war_id', 'referenced_table' => 'wars',
            'referenced_column' => 'id', 'delete_rule' => 'CASCADE', 'update_rule' => 'NO ACTION'],
        ['name' => 'fk_peace_offers_from_user', 'column' => 'from_user_id', 'referenced_table' => 'users',
            'referenced_column' => 'id', 'delete_rule' => 'CASCADE', 'update_rule' => 'NO ACTION'],
    ];

    /** @return array<string,mixed> */
    public static function validate(PDO $db): array
    {
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('War-history adoption requires a MySQL transaction.');
        }

        $metadata = [];
        $snapshots = [];
        foreach (array_keys(self::COLUMNS) as $table) {
            $metadata[$table] = self::validateTable($db, $table);
            $rows = $db->query('SELECT * FROM `' . $table . '` ORDER BY id FOR UPDATE');
            $hash = hash_init('sha256');
            $count = 0;
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR) . "\n");
                $count++;
            }
            $rows->closeCursor();
            $snapshots[$table] = ['count' => $count, 'sha256' => hash_final($hash)];
        }

        ksort($metadata);
        ksort($snapshots);
        return [
            'contract' => self::CONTRACT,
            'policy' => self::POLICY,
            'sources' => self::SOURCES,
            'schema_sha256' => hash('sha256', json_encode($metadata, JSON_THROW_ON_ERROR)),
            'identity_sha256' => hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR)),
            'tables' => $snapshots,
        ];
    }

    /** @return array<string,mixed> */
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
            throw new RuntimeException('War-history adoption requires InnoDB: ' . $table);
        }

        $query = $db->prepare(
            'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $columns = $query->fetchAll(PDO::FETCH_ASSOC);
        $expectedColumns = self::COLUMNS[$table];
        if (count($columns) !== count($expectedColumns)) {
            throw new RuntimeException('War-history adoption rejects an incomplete or evolved table: ' . $table);
        }
        foreach ($columns as $column) {
            $expected = $expectedColumns[$column['COLUMN_NAME']] ?? null;
            if ($expected === null) {
                throw new RuntimeException(
                    'War-history adoption schema mismatch: ' . $table . '.' . $column['COLUMN_NAME']
                );
            }
            $actualDefault = $column['COLUMN_DEFAULT'];
            if (is_string($actualDefault)) {
                $actualDefault = strtolower(preg_replace('/\(\)$/', '', $actualDefault) ?? $actualDefault);
            }
            $expectedDefault = $expected['default'];
            if (is_string($expectedDefault)) {
                $expectedDefault = strtolower(preg_replace('/\(\)$/', '', $expectedDefault) ?? $expectedDefault);
            }
            if (
                strtolower((string)$column['COLUMN_TYPE']) !== $expected['type']
                || $column['IS_NULLABLE'] !== $expected['nullable']
                || $actualDefault !== $expectedDefault
                || strtolower((string)$column['EXTRA']) !== $expected['extra']
            ) {
                throw new RuntimeException(
                    'War-history adoption schema mismatch: ' . $table . '.' . $column['COLUMN_NAME']
                );
            }
        }

        $indexes = self::readIndexes($db, $table);
        $expectedIndexes = self::INDEXES[$table];
        ksort($expectedIndexes);
        if ($indexes !== $expectedIndexes) {
            throw new RuntimeException('War-history adoption index mismatch: ' . $table);
        }
        $foreignKeys = self::readForeignKeys($db, $table);
        $expectedForeignKeys = array_values(array_filter(
            self::FOREIGN_KEYS,
            static fn(array $foreignKey): bool => match ($table) {
                'wars' => str_starts_with($foreignKey['name'], 'fk_wars_'),
                'war_goals' => $foreignKey['name'] === 'fk_war_goals_war',
                'peace_offers' => str_starts_with($foreignKey['name'], 'fk_peace_offers_'),
                default => throw new RuntimeException('Unexpected war-history adoption table: ' . $table),
            }
        ));
        usort($expectedForeignKeys, static fn(array $left, array $right): int => $left['name'] <=> $right['name']);
        if ($foreignKeys !== $expectedForeignKeys) {
            throw new RuntimeException('War-history adoption foreign-key mismatch: ' . $table);
        }

        return [
            'engine' => $engine,
            'columns' => $columns,
            'indexes' => $indexes,
            'foreign_keys' => $foreignKeys,
        ];
    }

    /** @return array<string, array{columns:list<string>,non_unique:int}> */
    private static function readIndexes(PDO $db, string $table): array
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
            $name = $row['INDEX_NAME'];
            if ($row['SUB_PART'] !== null) {
                throw new RuntimeException('War-history adoption rejects prefix indexes: ' . $table . '.' . $name);
            }
            $indexes[$name] ??= ['columns' => [], 'non_unique' => (int)$row['NON_UNIQUE']];
            $indexes[$name]['columns'][] = $row['COLUMN_NAME'];
            if ($indexes[$name]['non_unique'] !== (int)$row['NON_UNIQUE']) {
                throw new RuntimeException('War-history adoption index mismatch: ' . $table . '.' . $name);
            }
        }
        ksort($indexes);
        return $indexes;
    }

    /** @return list<array{name:string,column:string,referenced_table:string,referenced_column:string,delete_rule:string,update_rule:string}> */
    private static function readForeignKeys(PDO $db, string $table): array
    {
        $query = $db->prepare(
            'SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
                    r.DELETE_RULE,r.UPDATE_RULE
             FROM information_schema.KEY_COLUMN_USAGE k
             JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME
              AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
             WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME=?
               AND k.REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $foreignKeys = [];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $foreignKeys[] = [
                'name' => $row['CONSTRAINT_NAME'],
                'column' => $row['COLUMN_NAME'],
                'referenced_table' => $row['REFERENCED_TABLE_NAME'],
                'referenced_column' => $row['REFERENCED_COLUMN_NAME'],
                'delete_rule' => $row['DELETE_RULE'],
                'update_rule' => $row['UPDATE_RULE'],
            ];
        }
        return $foreignKeys;
    }

    /** @param array<string,mixed> $evidence */
    public static function validateEvidence(array $evidence): void
    {
        $tables = $evidence['tables'] ?? null;
        $sources = $evidence['sources'] ?? null;
        $expectedTables = array_keys(self::COLUMNS);
        sort($expectedTables);
        $expectedSources = self::SOURCES;
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
            || !hash_equals($evidence['identity_sha256'], hash('sha256', json_encode($tables, JSON_THROW_ON_ERROR)))
        ) {
            throw new RuntimeException('Invalid war-history adoption policy or evidence.');
        }
        foreach ($tables as $snapshot) {
            if (
                !is_array($snapshot) || count($snapshot) !== 2
                || !is_int($snapshot['count'] ?? null) || $snapshot['count'] < 0
                || !is_string($snapshot['sha256'] ?? null)
                || !preg_match('/^[a-f0-9]{64}$/D', $snapshot['sha256'])
            ) {
                throw new RuntimeException('Invalid war-history adoption table evidence.');
            }
        }
    }
}
