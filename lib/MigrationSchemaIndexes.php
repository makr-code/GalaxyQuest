<?php

declare(strict_types=1);

namespace GalaxyQuest\Migrations;

use PDO;
use RuntimeException;

final class MigrationSchemaIndexes
{
    /** @return list<list<array<string,mixed>>> */
    public static function read(PDO $db, string $table): array
    {
        $query = $db->prepare(
            'SELECT INDEX_NAME,NON_UNIQUE,COLUMN_NAME,COLLATION,SUB_PART,IS_VISIBLE
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
             ORDER BY INDEX_NAME,SEQ_IN_INDEX'
        );
        $query->execute([$table]);
        $indexes = [];
        foreach ($query->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if ($row['IS_VISIBLE'] !== 'YES') {
                continue;
            }
            $name = $row['INDEX_NAME'];
            unset($row['INDEX_NAME'], $row['IS_VISIBLE']);
            $indexes[$name][] = $row;
        }
        return array_values($indexes);
    }

    /** @param list<array<string,mixed>> $required @param list<list<array<string,mixed>>> $indexes */
    public static function requireComplete(string $label, string $table, array $required, array $indexes): void
    {
        foreach ($indexes as $index) {
            if ($required[0]['NON_UNIQUE'] === 0 && count($required) !== count($index)) {
                continue;
            }
            $candidate = array_slice($index, 0, count($required));
            if ($required[0]['NON_UNIQUE'] === 1) {
                foreach ($candidate as &$row) {
                    $row['NON_UNIQUE'] = 1;
                }
                unset($row);
            }
            if ($required === $candidate) {
                return;
            }
        }
        throw new RuntimeException($label . ' adoption requires a complete visible index: ' . $table);
    }
}
