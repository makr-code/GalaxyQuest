<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class EconomyMigrationAdoption
{
    public const CONTRACT = 'legacy-economy-ordered-v1';
    public const POLICY = 'preserve-string-fractional-policies-evolved-markets-no-replay';
    public const SOURCES = [
        'migrate_economy_v1.sql' => '5b14c11f79bd8bb7fc6db2bd4e0b0b2133513344c64dd04a1c03ee3544a3baf2',
        'migrate_economy_v2.sql' => 'a2bbd71b873fccbc7fb7b6c6a05c4e1b26beef70f3cb80b0201b7c17fa4d150b',
        'migrate_economy_v3.sql' => '03bdca6b0a667c22a725a80b672fb380e570d0467eabc5c0483f33d049e8276e',
        'migrate_economy_policies_v1.sql' => '6510f44a2e14c0808f2f95adb07a91ed41097601111b0491e78f9cd13ba7c41f',
        'migrate_economy_shortage_v1.sql' => '9c23b200a1fd72d5c27142266e7767a826a5274d3f605313db794281fdbdd45d',
    ];
    private const DESCRIPTOR_SHA256 = 'aae751126750f0359b85c4f07da0ea983fc8432c86c025076fc5f3e0e4b6d046';

    /** @return array<string,mixed> */
    public static function validate(PDO $db): array
    {
        require_once __DIR__ . '/MigrationSchemaIndexes.php';
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('Economy adoption requires a MySQL transaction.');
        }
        $descriptor = self::descriptor();
        // Settlement and resource spending lock accounts before colonies and economy state.
        foreach (['users', 'colonies'] as $table) {
            $rows = $db->query('SELECT id FROM `' . $table . '` ORDER BY id FOR UPDATE');
            $rows->fetchAll(PDO::FETCH_COLUMN);
            $rows->closeCursor();
        }
        $metadata = [];
        $snapshots = [];
        $marketKeys = [];
        foreach ($descriptor['tables'] as $table => $expected) {
            $rows = $db->query('SELECT * FROM `' . $table . '` ORDER BY id FOR UPDATE');
            $metadata[$table] = self::validateTable($db, $table, $expected);
            $hash = hash_init('sha256');
            $count = 0;
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                if ($table === 'economy_market_prices') {
                    $marketKeys[] = $row['good_type'];
                }
                hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR) . "\n");
                $count++;
            }
            $rows->closeCursor();
            $snapshots[$table] = ['count' => $count, 'sha256' => hash_final($hash)];
        }
        foreach ($descriptor['market_keys'] as $key) {
            if (!in_array($key, $marketKeys, true)) {
                throw new RuntimeException('Economy adoption requires market seed key: ' . $key);
            }
        }
        return [
            'contract' => self::CONTRACT,
            'policy' => self::POLICY,
            'descriptor_sha256' => self::DESCRIPTOR_SHA256,
            'schema_sha256' => hash('sha256', json_encode($metadata, JSON_THROW_ON_ERROR)),
            'identity_sha256' => hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR)),
            'tables' => $snapshots,
            'market_seed_count' => count($descriptor['market_keys']),
        ];
    }

    /**
     * @return array{sources:array<string,string>,
     *     tables:array<string,array{columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>}>,
     *     market_keys:list<string>}
     */
    private static function descriptor(): array
    {
        $json = file_get_contents(__DIR__ . '/migration_contracts/economy_schema.json');
        if (
            $json === false
            || !hash_equals(self::DESCRIPTOR_SHA256, hash('sha256', str_replace("\r\n", "\n", $json)))
        ) {
            throw new RuntimeException('Economy schema descriptor is missing or changed.');
        }
        /** @var array{sources:array<string,string>,
         *     tables:array<string,array{columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>}>,
         *     market_keys:list<string>} $descriptor */
        $descriptor = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if ($descriptor['sources'] !== self::SOURCES) {
            throw new RuntimeException('Economy schema descriptor source pins do not match.');
        }
        return $descriptor;
    }

    /**
     * @param array{columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>} $expected
     * @return array<string,mixed>
     */
    private static function validateTable(PDO $db, string $table, array $expected): array
    {
        $query = $db->prepare(
            'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?'
        );
        $query->execute([$table]);
        if ($query->fetchColumn() !== 'InnoDB') {
            throw new RuntimeException('Economy adoption requires InnoDB: ' . $table);
        }
        $query = $db->prepare(
            'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $columns = $query->fetchAll(PDO::FETCH_ASSOC);
        $actual = array_column($columns, null, 'COLUMN_NAME');
        foreach ($expected['columns'] as $column) {
            $name = $column['COLUMN_NAME'];
            if ($column !== ($actual[$name] ?? [])) {
                throw new RuntimeException('Economy adoption schema mismatch: ' . $table . '.' . $name);
            }
        }
        if (count($columns) !== count($expected['columns'])) {
            throw new RuntimeException('Economy adoption requires the audited ordered layout: ' . $table);
        }
        $indexes = MigrationSchemaIndexes::read($db, $table);
        foreach ($expected['indexes'] as $index) {
            MigrationSchemaIndexes::requireComplete('Economy', $table, $index, $indexes);
        }
        $query = $db->prepare(
            'SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=?'
        );
        $query->execute([$table]);
        if ((int)$query->fetchColumn() !== 0) {
            throw new RuntimeException('Economy adoption rejects unaudited foreign keys: ' . $table);
        }
        return ['columns' => $columns, 'indexes' => $indexes];
    }

    /** @param array<string,mixed> $evidence */
    public static function validateEvidence(array $evidence): void
    {
        $descriptor = self::descriptor();
        if (
            ($evidence['contract'] ?? '') !== self::CONTRACT
            || ($evidence['policy'] ?? '') !== self::POLICY
            || ($evidence['descriptor_sha256'] ?? '') !== self::DESCRIPTOR_SHA256
            || ($evidence['market_seed_count'] ?? null) !== count($descriptor['market_keys'])
            || !is_array($evidence['tables'] ?? null)
            || !is_string($evidence['schema_sha256'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/D', $evidence['schema_sha256'])
        ) {
            throw new RuntimeException('Invalid Economy adoption policy or descriptor evidence.');
        }
        $snapshots = $evidence['tables'];
        ksort($snapshots);
        if (array_keys($snapshots) !== array_keys($descriptor['tables'])) {
            throw new RuntimeException('Invalid Economy adoption table evidence.');
        }
        foreach ($snapshots as &$table) {
            if (
                !is_array($table) || !is_int($table['count'] ?? null) || $table['count'] < 0
                || !is_string($table['sha256'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $table['sha256'])
                || count($table) !== 2
            ) {
                throw new RuntimeException('Invalid Economy snapshot evidence.');
            }
            ksort($table);
        }
        unset($table);
        if ($snapshots['economy_market_prices']['count'] < count($descriptor['market_keys'])) {
            throw new RuntimeException('Invalid Economy market coverage evidence.');
        }
        if (($evidence['identity_sha256'] ?? '') !== hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR))) {
            throw new RuntimeException('Invalid Economy snapshot identity evidence.');
        }
    }
}
