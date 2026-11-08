<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class ActorMigrationAdoption
{
    public const CONTRACT = 'actor-current-v1';
    public const SOURCES = [
        'migrate_actor_model_v1.sql' => 'e41c7b24b9c09f2b6fadbb4afe7161ee6364611fd73d77773c9aec862a560988',
        'migrate_actor_model_v2_drop_is_npc.sql' => '3afe7f08b74cb13849070196568d92fbb5fab789b8222fb98f818fc82ba6d648',
    ];

    /** @return array<string, mixed> */
    public static function validate(PDO $db): array
    {
        if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'mysql' || !$db->inTransaction()) {
            throw new RuntimeException('Actor adoption requires a MySQL transaction.');
        }
        $engine = $db->query(
            "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'"
        )->fetchColumn();
        $columns = $db->query(
            "SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'"
        )->fetchAll(PDO::FETCH_UNIQUE | PDO::FETCH_ASSOC);
        if (
            $engine !== 'InnoDB' || isset($columns['is_npc'])
            || ($columns['control_type']['COLUMN_TYPE'] ?? '') !== 'varchar(24)'
            || ($columns['control_type']['IS_NULLABLE'] ?? '') !== 'NO'
            || ($columns['control_type']['COLUMN_DEFAULT'] ?? '') !== 'human'
            || ($columns['auth_enabled']['COLUMN_TYPE'] ?? '') !== 'tinyint(1)'
            || ($columns['auth_enabled']['IS_NULLABLE'] ?? '') !== 'NO'
            || (string)($columns['auth_enabled']['COLUMN_DEFAULT'] ?? '') !== '1'
            || ($columns['deleted_at']['COLUMN_TYPE'] ?? '') !== 'datetime'
        ) {
            throw new RuntimeException('Current actor schema does not satisfy the adoption contract.');
        }
        $index = $db->query(
            "SELECT COLUMN_NAME FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='idx_users_control_type'
             ORDER BY SEQ_IN_INDEX"
        )->fetchAll(PDO::FETCH_COLUMN);
        if ($index !== ['control_type']) {
            throw new RuntimeException('Actor controller index is missing or incompatible.');
        }
        // Lock and inspect every identity; never derive modern controllers from a recreated legacy flag.
        $actors = $db->query(
            'SELECT id,control_type,auth_enabled,deleted_at FROM users ORDER BY id FOR UPDATE'
        )->fetchAll(PDO::FETCH_ASSOC);
        $counts = ['human' => 0, 'npc_engine' => 0];
        foreach ($actors as $actor) {
            $kind = $actor['control_type'];
            $login = (int)$actor['auth_enabled'];
            if (
                !in_array($kind, ['human', 'npc_engine'], true)
                || ($kind === 'npc_engine' && $login !== 0)
                || ($kind === 'human' && !in_array($login, [0, 1], true))
                || ($actor['deleted_at'] !== null && $kind !== 'npc_engine')
            ) {
                throw new RuntimeException('Actor control/authentication invariants reject adoption.');
            }
            $counts[$kind]++;
        }
        return ['contract' => self::CONTRACT, 'schema' => 'current-without-is_npc',
            'actor_count' => count($actors), 'controller_counts' => $counts,
            'identity_sha256' => hash('sha256', json_encode($actors, JSON_THROW_ON_ERROR))];
    }
}
