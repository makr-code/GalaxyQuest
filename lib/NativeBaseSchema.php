<?php

declare(strict_types=1);

namespace GalaxyQuest\Deployment;

use MigrationRunner;
use RuntimeException;

/**
 * Source-pinned preparation of the canonical base schema for a selected database.
 * This class does not connect to a database or execute statements.
 */
final class NativeBaseSchema
{
    private const SOURCE_SHA256 = 'ae5946f9583fd8ed7f8d4c83e4916a441eaa4101f881baa4d7c3adbda866245b';

    /**
     * @return list<string>
     */
    public static function statements(MigrationRunner $runner, string $sql): array
    {
        $normalized = str_replace("\r\n", "\n", $sql);
        if (!hash_equals(self::SOURCE_SHA256, hash('sha256', $normalized))) {
            throw new RuntimeException('Base schema differs from the reviewed native import contract.');
        }

        $statements = $runner->splitStatements($normalized);
        if (
            array_shift($statements)
                !== 'CREATE DATABASE IF NOT EXISTS galaxyquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
            || array_shift($statements) !== 'USE galaxyquest'
            || $statements === []
        ) {
            throw new RuntimeException('Base schema database preamble does not match the reviewed contract.');
        }

        return $statements;
    }
}
