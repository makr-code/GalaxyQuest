<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GameStatusReadSideEffectsTest extends TestCase
{
    public function testHealthAndLeaderboardAreGetOnlyAndDoNotPersistState(): void
    {
        $gameApi = file_get_contents(__DIR__ . '/../../api/game.php');
        $galaxySeed = file_get_contents(__DIR__ . '/../../api/galaxy_seed.php');
        $galaxySchema = file_get_contents(__DIR__ . '/../../lib/GalaxySchema.php');
        self::assertIsString($gameApi);
        self::assertIsString($galaxySeed);
        self::assertIsString($galaxySchema);
        $galaxySeed = str_replace(["\r\n", "\r"], "\n", $galaxySeed);
        $galaxySchema = str_replace(["\r\n", "\r"], "\n", $galaxySchema);

        foreach ([
            ['health', 'rename_colony'],
            ['leaderboard', 'set_ftl_drive'],
        ] as [$action, $nextAction]) {
            $handler = $this->caseBody($gameApi, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler, $action);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
                $handler,
                $action
            );
            self::assertStringNotContainsString('enqueue_dirty_user(', $handler, $action);
            self::assertStringNotContainsString('simulation_tick(', $handler, $action);
        }

        self::assertMatchesRegularExpression(
            '/function ensure_star_system_columns\(PDO \$db\): void\s*\{\s*'
                . 'require_once __DIR__ \. \'\/\.\.\/lib\/GalaxySchema\.php\';\s*'
                . '\\\\GalaxyQuest\\\\Schema\\\\GalaxySchema::assertStars\(\$db\);/s',
            $galaxySeed
        );
        self::assertStringContainsString('public static function assertStars(PDO $db): void', $galaxySchema);
        $assertStars = $this->functionBody($galaxySchema, 'assertStars');
        $columns = $this->functionBody($galaxySchema, 'columns');
        self::assertStringContainsString('$columns = self::columns($db, \'star_systems\');', $assertStars);
        self::assertStringContainsString('self::requireColumns($columns, \'star_systems\'', $assertStars);
        self::assertStringContainsString('SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS', $columns);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\\b/i',
            $assertStars . $columns
        );
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = strpos($source, "case '" . $nextAction . "':", $start + 1);
        self::assertNotFalse($end, $action . ' action must be bounded.');
        return substr($source, $start, $end - $start);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = preg_match(
            '/\n    (?:public|protected|private) static function\s+/m',
            $source,
            $matches,
            PREG_OFFSET_CAPTURE,
            $start + 1
        ) ? $matches[0][1] : false;
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
