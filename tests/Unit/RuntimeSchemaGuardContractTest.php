<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class RuntimeSchemaGuardContractTest extends TestCase
{
    public function testAllianceSchemaAssertionRunsBeforeActionDispatch(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/alliances.php');
        self::assertIsString($source);

        $guardOffset = strpos($source, 'ensure_alliance_schema($db);');
        $actionOffset = strpos($source, '$action = $_GET');
        $dispatchOffset = strpos($source, 'match ($action)');
        self::assertNotFalse($guardOffset);
        self::assertNotFalse($actionOffset);
        self::assertNotFalse($dispatchOffset);
        self::assertLessThan($actionOffset, $guardOffset);
        self::assertLessThan($dispatchOffset, $guardOffset);

        $guardStart = strpos($source, 'function ensure_alliance_schema(');
        $guardEnd = strpos($source, 'function action_list(', $guardStart);
        self::assertNotFalse($guardStart);
        self::assertNotFalse($guardEnd);
        $guard = substr($source, $guardStart, $guardEnd - $guardStart);
        self::assertStringContainsString('GalaxySchema::assertAlliances($db)', $guard);
        self::assertDoesNotMatchRegularExpression('/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|DATABASE|INDEX)\b/i', $guard);
    }

    public function testSituationSchemaAssertionRunsBeforeRequestDispatch(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/situations.php');
        self::assertIsString($source);

        $guardOffset = strpos($source, 'ensure_situations_tables($db);');
        $switchOffset = strpos($source, 'switch ($action)');
        self::assertNotFalse($guardOffset);
        self::assertNotFalse($switchOffset);
        self::assertLessThan($switchOffset, $guardOffset);

        $guardStart = strpos($source, 'function ensure_situations_tables(');
        $guardEnd = strpos($source, 'function load_user_situation(', $guardStart);
        self::assertNotFalse($guardStart);
        self::assertNotFalse($guardEnd);
        $guard = substr($source, $guardStart, $guardEnd - $guardStart);
        self::assertStringContainsString('GalaxySchema::assertSituations($db)', $guard);
        self::assertDoesNotMatchRegularExpression('/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|DATABASE|INDEX)\b/i', $guard);
    }
}
