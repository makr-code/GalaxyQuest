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
            $start = strpos($source, "case '" . $action . "':");
            self::assertNotFalse($start, $action . ' action must exist.');
            $end = strpos($source, 'break;', $start);
            self::assertNotFalse($end, $action . ' action must have a bounded body.');
            $body = substr($source, $start, $end - $start);

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
