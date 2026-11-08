<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use JsonException;
use RuntimeException;
use stdClass;

final class LegacyV2MigrationAdoption
{
    public const CONTRACT = 'legacy-v2-current-v1';
    public const POLICY = 'current-actors-native-bodies-explicit-quest-json-correct-icon';
    public const SOURCES = [
        'migrate_v2.sql' => 'ae261cb047830139909ebe3266df78dfad5a237718ae0a546ede5940b8cff262',
    ];
    private const DESCRIPTOR_SHA256 = 'fdacde4a5f7e2505f09fe309afb3b1be44220751d572a0f3e8100e76ed43faa8';

    /** @return array<string, mixed> */
    public static function validate(PDO $db): array
    {
        require_once __DIR__ . '/ActorMigrationAdoption.php';
        require_once __DIR__ . '/BodyMigrationAdoption.php';
        require_once __DIR__ . '/MigrationSchemaIndexes.php';
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('Legacy V2 adoption requires a MySQL transaction.');
        }
        $descriptor = self::descriptor();
        $actors = ActorMigrationAdoption::validate($db);
        $bodies = BodyMigrationAdoption::validate($db);
        $metadata = [];
        foreach ($descriptor['tables'] as $table => $expected) {
            $metadata[$table] = self::validateTable($db, $table, $expected);
        }
        self::validateIconDefault($db);
        self::validateCurrentIdentities($db);
        $snapshots = [];
        // Use the established user-before-colony lock order before the remaining V2 surfaces.
        $tables = array_unique(array_merge(
            ['users', 'colonies', 'buildings', 'ships', 'fleets'],
            array_keys($descriptor['tables'])
        ));
        $seeds = [];
        foreach ($tables as $table) {
            $rows = $db->query('SELECT * FROM `' . $table . '` ORDER BY id FOR UPDATE');
            $hash = hash_init('sha256');
            $count = 0;
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                $jsonColumns = ['faction_quests' => 'requirements_json', 'user_faction_quests' => 'progress_json'];
                foreach ($jsonColumns as $t => $c) {
                    if ($table === $t) {
                        try {
                            $value = json_decode($row[$c], false, 512, JSON_THROW_ON_ERROR);
                        } catch (JsonException $error) {
                            throw new RuntimeException('Invalid Legacy V2 JSON: ' . $table . '.' . $c
                                . ': ' . $error->getMessage(), 0, $error);
                        }
                        if (!$value instanceof stdClass) {
                            throw new RuntimeException(
                                'Legacy V2 requires explicit JSON objects: ' . $table . '.' . $c
                            );
                        }
                    }
                }
                if ($table === 'achievements') {
                    $seeds[$row['code']] = $row;
                }
                hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR) . "\n");
                $count++;
            }
            $rows->closeCursor();
            $snapshots[$table] = ['count' => $count, 'sha256' => hash_final($hash)];
        }
        self::validateSeeds($descriptor['achievements'], $seeds);
        ksort($snapshots);
        return [
            'contract' => self::CONTRACT, 'policy' => self::POLICY,
            'descriptor_sha256' => self::DESCRIPTOR_SHA256,
            'schema_sha256' => hash('sha256', json_encode($metadata, JSON_THROW_ON_ERROR)),
            'identity_sha256' => hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR)),
            'actor_identity_sha256' => $actors['identity_sha256'],
            'body_identity_sha256' => $bodies['identity_sha256'],
            'tables' => $snapshots, 'achievement_seed_count' => count($descriptor['achievements']),
        ];
    }

    /**
     * @return array{tables:array<string,array{columns:list<array<string,mixed>>,
     *     indexes:list<list<array<string,mixed>>>,foreign_keys:list<list<array<string,mixed>>>}>,
     *     achievements:list<array<string,mixed>>}
     */
    private static function descriptor(): array
    {
        $json = file_get_contents(__DIR__ . '/migration_contracts/legacy_v2_schema.json');
        if (
            $json === false
            || !hash_equals(self::DESCRIPTOR_SHA256, hash('sha256', str_replace("\r\n", "\n", $json)))
        ) {
            throw new RuntimeException('Legacy V2 schema descriptor is missing or changed.');
        }
        /** @var array{tables:array<string,array{columns:list<array<string,mixed>>,
         *     indexes:list<list<array<string,mixed>>>,foreign_keys:list<list<array<string,mixed>>>}>,
         *     achievements:list<array<string,mixed>>} $descriptor */
        $descriptor = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        return $descriptor;
    }

    /**
     * @param array{columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>,
     *     foreign_keys:list<list<array<string,mixed>>>} $expected
     * @return array<string, mixed>
     */
    private static function validateTable(PDO $db, string $table, array $expected): array
    {
        $query = $db->prepare(
            'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?'
        );
        $query->execute([$table]);
        if ($query->fetchColumn() !== 'InnoDB') {
            throw new RuntimeException('Legacy V2 adoption requires InnoDB: ' . $table);
        }
        $query = $db->prepare(
            'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $columns = $query->fetchAll(PDO::FETCH_UNIQUE | PDO::FETCH_ASSOC);
        foreach ($expected['columns'] as $column) {
            $name = $column['COLUMN_NAME'];
            if ($table === 'users' && $name === 'is_npc') {
                continue;
            }
            $column = self::currentColumn($table, $column);
            unset($column['COLUMN_NAME']);
            $actual = $columns[$name] ?? [];
            $advisorRole = "enum('colony_manager','fleet_commander','science_director',"
                . "'diplomacy_officer','trade_director','advisor')";
            if (
                $table === 'leaders' && $name === 'role'
                && ($actual['COLUMN_TYPE'] ?? '') === $advisorRole
            ) {
                $column['COLUMN_TYPE'] = $actual['COLUMN_TYPE'];
            }
            if ($table === 'npc_factions' && $name === 'icon') {
                // MySQL information_schema replaces supplementary Unicode defaults with '?'.
                unset($column['COLUMN_DEFAULT'], $actual['COLUMN_DEFAULT']);
            }
            if ($column !== $actual) {
                throw new RuntimeException('Legacy V2 adoption schema mismatch: ' . $table . '.' . $name);
            }
        }
        $indexes = MigrationSchemaIndexes::read($db, $table);
        foreach ($expected['indexes'] as $index) {
            if ($table === 'colonies' && $index[0]['COLUMN_NAME'] === 'planet_id') {
                continue;
            }
            MigrationSchemaIndexes::requireComplete('Legacy V2', $table, $index, $indexes);
        }
        MigrationSchemaIndexes::requireComplete('Legacy V2', $table, [
            ['NON_UNIQUE' => 0, 'COLUMN_NAME' => 'id', 'COLLATION' => 'A', 'SUB_PART' => null],
        ], $indexes);
        $query = $db->prepare(
            'SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
             r.UPDATE_RULE,r.DELETE_RULE,k.REFERENCED_TABLE_SCHEMA
             FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
               ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
               AND r.TABLE_NAME=k.TABLE_NAME
             WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL
             ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $foreign = [];
        $database = $db->query('SELECT DATABASE()')->fetchColumn();
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if ($row['REFERENCED_TABLE_SCHEMA'] !== $database) {
                throw new RuntimeException('Legacy V2 foreign key points outside this database: ' . $table);
            }
            $name = $row['CONSTRAINT_NAME'];
            unset($row['CONSTRAINT_NAME'], $row['REFERENCED_TABLE_SCHEMA']);
            $foreign[$name][] = $row;
        }
        if (in_array($table, ['buildings', 'ships', 'fleets'], true)) {
            $expected['foreign_keys'][] = [[
                'COLUMN_NAME' => $table === 'fleets' ? 'origin_colony_id' : 'colony_id',
                'REFERENCED_TABLE_NAME' => 'colonies', 'REFERENCED_COLUMN_NAME' => 'id',
                'UPDATE_RULE' => 'NO ACTION', 'DELETE_RULE' => 'CASCADE',
            ]];
        }
        if ($table === 'fleets') {
            $expected['foreign_keys'][] = [[
                'COLUMN_NAME' => 'user_id', 'REFERENCED_TABLE_NAME' => 'users', 'REFERENCED_COLUMN_NAME' => 'id',
                'UPDATE_RULE' => 'NO ACTION', 'DELETE_RULE' => 'CASCADE',
            ]];
        }
        foreach ($expected['foreign_keys'] as $fk) {
            if ($table === 'colonies' && $fk[0]['COLUMN_NAME'] === 'planet_id') {
                continue;
            }
            if (!in_array($fk, array_values($foreign), true)) {
                throw new RuntimeException('Legacy V2 adoption foreign key mismatch: ' . $table);
            }
            self::validateReferences($db, $table, $fk);
        }
        return ['columns' => $columns, 'indexes' => $indexes, 'foreign_keys' => array_values($foreign)];
    }

    /** @param array<string,mixed> $column @return array<string,mixed> */
    private static function currentColumn(string $table, array $column): array
    {
        $name = $column['COLUMN_NAME'];
        if ($table === 'star_systems' && $name === 'spectral_class') {
            $column['COLUMN_TYPE'] = "enum('O','B','A','F','G','K','M','WD')";
        }
        if ($table === 'planets' && str_starts_with($name, 'deposit_')) {
            $column['COLUMN_TYPE'] = 'decimal(20,6)';
            $column['COLUMN_DEFAULT'] .= '.000000';
        }
        if ($table === 'colonies' && $name === 'planet_id') {
            $column['IS_NULLABLE'] = 'YES';
        }
        if (
            (in_array($table, ['buildings', 'ships'], true) && $name === 'colony_id')
            || ($table === 'fleets' && $name === 'origin_colony_id')
        ) {
            $column['IS_NULLABLE'] = 'NO';
        }
        if ($table === 'npc_factions' && $name === 'faction_type') {
            $column['COLUMN_TYPE'] = "enum('military','trade','science','pirate','ancient','envoy')";
        }
        if ($table === 'colony_events' && $name === 'event_type') {
            $column['COLUMN_TYPE'] = "enum('solar_flare','mineral_vein','disease','archaeological_find')";
        }
        if (
            ($table === 'faction_quests' && $name === 'requirements_json')
            || ($table === 'user_faction_quests' && $name === 'progress_json')
        ) {
            $column['COLUMN_DEFAULT'] = null;
            $column['EXTRA'] = '';
        }
        return $column;
    }

    /** @param list<array<string,mixed>> $foreign */
    private static function validateReferences(PDO $db, string $table, array $foreign): void
    {
        $join = [];
        $present = [];
        foreach ($foreign as $row) {
            $join[] = 's.`' . $row['COLUMN_NAME'] . '`=r.`' . $row['REFERENCED_COLUMN_NAME'] . '`';
            $present[] = 's.`' . $row['COLUMN_NAME'] . '` IS NOT NULL';
        }
        $sql = 'SELECT COUNT(*) FROM `' . $table . '` s LEFT JOIN `' . $foreign[0]['REFERENCED_TABLE_NAME'] . '` r ON '
            . implode(' AND ', $join) . ' WHERE ' . implode(' AND ', $present)
            . ' AND r.`' . $foreign[0]['REFERENCED_COLUMN_NAME'] . '` IS NULL';
        if ((int)$db->query($sql)->fetchColumn() !== 0) {
            throw new RuntimeException('Legacy V2 orphan reference: ' . $table);
        }
    }

    private static function validateCurrentIdentities(PDO $db): void
    {
        $retired = [
            'planets' => 'user_id', 'buildings' => 'planet_id',
            'ships' => 'planet_id', 'fleets' => 'origin_planet_id',
        ];
        foreach ($retired as $table => $column) {
            $query = $db->prepare(
                'SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?'
            );
            $query->execute([$table, $column]);
            if ((int)$query->fetchColumn() !== 0) {
                throw new RuntimeException('Legacy V2 requires retired backfill inputs: ' . $table . '.' . $column);
            }
        }
        $origins = ['buildings' => 'colony_id', 'ships' => 'colony_id', 'fleets' => 'origin_colony_id'];
        foreach ($origins as $table => $column) {
            $query = $db->query(
                'SELECT COUNT(*) FROM `' . $table . '` s LEFT JOIN colonies c ON c.id=s.`' . $column . '`'
                . ' WHERE c.id IS NULL'
            );
            if ((int)$query->fetchColumn() !== 0) {
                throw new RuntimeException('Legacy V2 missing colony identity: ' . $table);
            }
        }
    }
    private static function validateIconDefault(PDO $db): void
    {
        $ddl = $db->query('SHOW CREATE TABLE npc_factions')->fetch(PDO::FETCH_NUM);
        $pattern = "/`icon`[^\\n]*\\bDEFAULT\\s+(?:_utf8mb4\\s*)?"
            . "(?:0xF09F91BE|'\\xF0\\x9F\\x91\\xBE')(?=\\s|,)/i";
        if (!preg_match($pattern, $ddl[1])) {
            throw new RuntimeException(
                'Legacy V2 requires the correct NPC icon default; apply migrate_npc_icon_default_v1.sql.'
            );
        }
    }
    /** @param list<array<string,mixed>> $expected @param array<string,array<string,mixed>> $actual */
    private static function validateSeeds(array $expected, array $actual): void
    {
        $descriptions = [
            'eco_metal_100k' => 'Accumulate 100 000 metal across all colonies.',
            'eco_planets_5' => 'Control 5 colonies simultaneously.',
            'eco_planets_10' => 'Control 10 colonies simultaneously.',
        ];
        foreach ($expected as $seed) {
            $code = $seed['code'];
            if (isset($descriptions[$code])) {
                $seed['description'] = $descriptions[$code];
            }
            $row = $actual[$code] ?? [];
            unset($row['id']);
            // Later schema columns are allowed, but every original seed field must agree.
            foreach ($seed as $column => $value) {
                if (!array_key_exists($column, $row) || $row[$column] !== $value) {
                    throw new RuntimeException('Legacy V2 achievement seed mismatch: ' . $code . '.' . $column);
                }
            }
        }
    }

    /** @param array<string,mixed> $evidence */
    public static function validateEvidence(array $evidence): void
    {
        $descriptor = self::descriptor();
        if (
            ($evidence['policy'] ?? '') !== self::POLICY
            || ($evidence['descriptor_sha256'] ?? '') !== self::DESCRIPTOR_SHA256
            || ($evidence['achievement_seed_count'] ?? null) !== 13
            || !is_array($evidence['tables'] ?? null)
        ) {
            throw new RuntimeException('Invalid Legacy V2 adoption policy or descriptor evidence.');
        }
        $snapshots = $evidence['tables'];
        ksort($snapshots);
        if (array_keys($snapshots) !== array_keys($descriptor['tables'])) {
            throw new RuntimeException('Invalid Legacy V2 adoption table evidence.');
        }
        foreach (['schema_sha256', 'actor_identity_sha256', 'body_identity_sha256'] as $hash) {
            if (!is_string($evidence[$hash] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $evidence[$hash])) {
                throw new RuntimeException('Invalid Legacy V2 adoption hash evidence.');
            }
        }
        foreach ($snapshots as &$table) {
            if (
                !is_array($table) || !is_int($table['count'] ?? null) || $table['count'] < 0
                || !is_string($table['sha256'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $table['sha256'])
            ) {
                throw new RuntimeException('Invalid Legacy V2 snapshot evidence.');
            }
            ksort($table);
        }
        unset($table);
        $identity = hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR));
        if (($evidence['identity_sha256'] ?? '') !== $identity) {
            throw new RuntimeException('Invalid Legacy V2 snapshot identity evidence.');
        }
    }
}
