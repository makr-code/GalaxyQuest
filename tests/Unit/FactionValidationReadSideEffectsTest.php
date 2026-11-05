<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class FactionValidationReadSideEffectsTest extends TestCase
{
    public function testDebugReportsRequireGetAndOnlyReadTheYamlFile(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/faction_validation.php');
        self::assertIsString($source);

        $entrypoint = strpos($source, "if (basename(__FILE__) === basename(\$_SERVER['SCRIPT_FILENAME'] ?? '')) {");
        $getGuard = strpos($source, "only_method('GET');", $entrypoint);
        $actionRead = strpos($source, "\$action = strtolower", $entrypoint);
        self::assertNotFalse($entrypoint);
        self::assertNotFalse($getGuard);
        self::assertNotFalse($actionRead);
        self::assertLessThan($actionRead, $getGuard);
        self::assertStringContainsString("case 'verify':", $source);
        self::assertStringContainsString("case 'standing_matrix':", $source);
        self::assertStringContainsString("case 'endgame_check':", $source);
        self::assertStringContainsString("file_get_contents(\$yaml_path)", $source);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|fwrite|unlink|rename|copy)\\s*\\(/i',
            $source
        );
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+)\\b/i',
            $source
        );
    }
}
