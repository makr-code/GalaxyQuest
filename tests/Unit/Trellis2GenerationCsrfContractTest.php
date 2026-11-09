<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class Trellis2GenerationCsrfContractTest extends TestCase
{
    public function testGenerationActionsVerifyCsrfBeforeReadingRequestBody(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_generator.php');
        self::assertIsString($source);

        foreach (['generate_base_hull', 'generate_components', 'generate_avatar'] as $action) {
            $matched = preg_match(
                "/case '" . preg_quote($action, '/') . "':(?<body>.*?)(?=^\\s*(?:case|default)\\b)/ms",
                $source,
                $matches
            );
            self::assertSame(1, $matched, $action . ' action must exist and have a bounded body.');
            $body = $matches['body'];

            $postGuardOffset = strpos($body, "only_method('POST');");
            $csrfGuardOffset = strpos($body, 'verify_csrf();');
            $inputReadOffset = strpos($body, "file_get_contents('php://input')");
            self::assertNotFalse($postGuardOffset);
            self::assertNotFalse($csrfGuardOffset);
            self::assertNotFalse($inputReadOffset);
            self::assertLessThan($csrfGuardOffset, $postGuardOffset);
            self::assertLessThan($inputReadOffset, $csrfGuardOffset);
        }
    }
}
