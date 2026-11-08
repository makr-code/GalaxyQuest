<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class AuthMigrationAdoption
{
    public const CONTRACT = 'legacy-auth-current-v1';
    public const POLICY = 'preserve-accounts-totp-material-lockouts-no-rbac-activation';
    public const SOURCES = [
        'migrate_security_v1.sql' => 'b9f20711cfef795651ae827e0ebeedcce9ad64eb95f8578d63e146e4bcfb2478',
        'migrate_security_v2_totp.sql' => '758130798edf1ba1da08814fc4c9bdb5c4b2956619cd4d17896cbbc7e052a171',
        'migrate_admin_user_crud_v1.sql' => 'ef6a41ffe1268e4de12a2d685b433ae31672dcb40c761a027547afd15c7f1566',
    ];
    private const DESCRIPTOR_SHA256 = '550ad2c2a800196ac36789ba32bc71322cb11e3bb59d34be3e4c639f39aec7e2';

    /** @return array<string,mixed> */
    public static function validate(PDO $db): array
    {
        require_once __DIR__ . '/MigrationSchemaIndexes.php';
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('Auth adoption requires a MySQL transaction.');
        }
        $descriptor = self::descriptor();
        $metadata = [];
        $snapshots = [];
        foreach (['users', 'login_attempts', 'totp_pending_sessions'] as $table) {
            $key = match ($table) {
                'login_attempts' => 'ip_hash',
                'totp_pending_sessions' => 'token',
                default => 'id',
            };
            $rows = $db->query('SELECT * FROM `' . $table . '` ORDER BY `' . $key . '` FOR UPDATE');
            $hash = hash_init('sha256');
            $count = 0;
            while ($row = $rows->fetch(PDO::FETCH_ASSOC)) {
                hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR) . "\n");
                $count++;
            }
            $rows->closeCursor();
            $metadata[$table] = self::validateTable($db, $table, $descriptor['tables'][$table]);
            $snapshots[$table] = ['count' => $count, 'sha256' => hash_final($hash)];
        }
        if (
            (int)$db->query(
                'SELECT COUNT(*) FROM totp_pending_sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL'
            )->fetchColumn() !== 0
        ) {
            throw new RuntimeException('Auth adoption rejects orphan TOTP pending sessions.');
        }
        ksort($metadata);
        ksort($snapshots);
        return [
            'contract' => self::CONTRACT,
            'policy' => self::POLICY,
            'descriptor_sha256' => self::DESCRIPTOR_SHA256,
            'schema_sha256' => hash('sha256', json_encode($metadata, JSON_THROW_ON_ERROR)),
            'identity_sha256' => hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR)),
            'tables' => $snapshots,
        ];
    }

    /**
     * @return array{sources:array<string,string>,tables:array<string,array{
     *     columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>,
     *     foreign_keys:list<array<string,mixed>>}>}
     */
    private static function descriptor(): array
    {
        $json = file_get_contents(__DIR__ . '/migration_contracts/auth_schema.json');
        if (
            $json === false
            || !hash_equals(self::DESCRIPTOR_SHA256, hash('sha256', str_replace("\r\n", "\n", $json)))
        ) {
            throw new RuntimeException('Auth schema descriptor is missing or changed.');
        }
        /** @var array{sources:array<string,string>,tables:array<string,array{
         *     columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>,
         *     foreign_keys:list<array<string,mixed>>}>} $descriptor */
        $descriptor = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        if ($descriptor['sources'] !== self::SOURCES) {
            throw new RuntimeException('Auth descriptor source pins do not match.');
        }
        return $descriptor;
    }

    /**
     * @param array{columns:list<array<string,mixed>>,indexes:list<list<array<string,mixed>>>,
     *     foreign_keys:list<array<string,mixed>>} $expected
     * @return array<string,mixed>
     */
    private static function validateTable(PDO $db, string $table, array $expected): array
    {
        $query = $db->prepare(
            'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?'
        );
        $query->execute([$table]);
        if ($query->fetchColumn() !== 'InnoDB') {
            throw new RuntimeException('Auth adoption requires InnoDB: ' . $table);
        }
        $query = $db->prepare(
            'SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $columns = $query->fetchAll(PDO::FETCH_ASSOC);
        $actual = array_column($columns, null, 'COLUMN_NAME');
        foreach ($expected['columns'] as $column) {
            if (($actual[$column['COLUMN_NAME']] ?? []) !== $column) {
                throw new RuntimeException('Auth adoption schema mismatch: ' . $table . '.' . $column['COLUMN_NAME']);
            }
        }
        if ($table !== 'users' && count($columns) !== count($expected['columns'])) {
            throw new RuntimeException('Auth adoption rejects unaudited columns: ' . $table);
        }
        $indexes = MigrationSchemaIndexes::read($db, $table);
        foreach ($expected['indexes'] as $index) {
            foreach ($index as &$column) {
                unset($column['IS_VISIBLE']);
            }
            unset($column);
            MigrationSchemaIndexes::requireComplete('Auth', $table, $index, $indexes);
        }
        if ($table === 'users') {
            MigrationSchemaIndexes::requireComplete('Auth', $table, [
                ['NON_UNIQUE' => 0, 'COLUMN_NAME' => 'id', 'COLLATION' => 'A', 'SUB_PART' => null],
            ], $indexes);
            return ['columns' => $expected['columns'], 'indexes' => $indexes];
        }
        $query = $db->prepare(
            'SELECT k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE,
                    k.REFERENCED_TABLE_SCHEMA
             FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
             ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
                AND r.TABLE_NAME=k.TABLE_NAME
             WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION'
        );
        $query->execute([$table]);
        $foreign = $query->fetchAll(PDO::FETCH_ASSOC);
        $database = $db->query('SELECT DATABASE()')->fetchColumn();
        foreach ($foreign as &$row) {
            if ($row['REFERENCED_TABLE_SCHEMA'] !== $database) {
                throw new RuntimeException('Auth foreign key points outside this database: ' . $table);
            }
            unset($row['REFERENCED_TABLE_SCHEMA']);
        }
        unset($row);
        if ($foreign !== $expected['foreign_keys']) {
            throw new RuntimeException('Auth adoption foreign key mismatch: ' . $table);
        }
        return ['columns' => $columns, 'indexes' => $indexes, 'foreign_keys' => $foreign];
    }

    /** @param array<string,mixed> $evidence */
    public static function validateEvidence(array $evidence): void
    {
        $descriptor = self::descriptor();
        if (
            ($evidence['contract'] ?? '') !== self::CONTRACT
            || ($evidence['policy'] ?? '') !== self::POLICY
            || ($evidence['descriptor_sha256'] ?? '') !== self::DESCRIPTOR_SHA256
            || !is_array($evidence['tables'] ?? null)
            || !is_string($evidence['schema_sha256'] ?? null)
            || !preg_match('/^[a-f0-9]{64}$/D', $evidence['schema_sha256'])
        ) {
            throw new RuntimeException('Invalid Auth adoption policy or descriptor evidence.');
        }
        $snapshots = $evidence['tables'];
        ksort($snapshots);
        if (array_keys($snapshots) !== array_keys($descriptor['tables'])) {
            throw new RuntimeException('Invalid Auth adoption table evidence.');
        }
        foreach ($snapshots as &$table) {
            if (
                !is_array($table) || count($table) !== 2
                || !is_int($table['count'] ?? null) || $table['count'] < 0
                || !is_string($table['sha256'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $table['sha256'])
            ) {
                throw new RuntimeException('Invalid Auth snapshot evidence.');
            }
            ksort($table);
        }
        unset($table);
        if (($evidence['identity_sha256'] ?? '') !== hash('sha256', json_encode($snapshots, JSON_THROW_ON_ERROR))) {
            throw new RuntimeException('Invalid Auth snapshot identity evidence.');
        }
    }
}
