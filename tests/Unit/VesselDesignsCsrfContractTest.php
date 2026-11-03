<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class VesselDesignsCsrfContractTest extends TestCase
{
    public function testEveryDesignWriteVerifiesCsrfBeforeReadingTheBody(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/vessel_designs.php');
        self::assertIsString($source);

        foreach ([
            'Handle CREATE wireframe design',
            'Handle CREATE new design',
            'Handle QUEUE generation',
        ] as $marker) {
            $start = strpos($source, $marker);
            self::assertNotFalse($start, $marker . ' action must exist.');
            $end = strpos($source, 'return;', $start);
            self::assertNotFalse($end, $marker . ' action must be bounded.');
            $handler = substr($source, $start, $end - $start);

            $postGuardOffset = strpos($handler, "only_method('POST');");
            $csrfGuardOffset = strpos($handler, 'verify_csrf();');
            $bodyReadOffset = strpos($handler, "file_get_contents('php://input')");
            self::assertNotFalse($postGuardOffset);
            self::assertNotFalse($csrfGuardOffset);
            self::assertNotFalse($bodyReadOffset);
            self::assertLessThan($csrfGuardOffset, $postGuardOffset);
            self::assertLessThan($bodyReadOffset, $csrfGuardOffset);
        }
    }

    public function testBrowserDesignWritersSendTheSessionCsrfToken(): void
    {
        foreach ([
            __DIR__ . '/../../js/ui/ship-designer.js',
            __DIR__ . '/../../js/ui/ship-designer-trellis2.js',
            __DIR__ . '/../../js/ui/wireframe-editor.js',
        ] as $path) {
            $source = file_get_contents($path);
            self::assertIsString($source);
            self::assertStringContainsString('X-CSRF-Token', $source, $path);
            self::assertStringContainsString('credentials: \'same-origin\'', $source, $path);
            self::assertStringContainsString('auth.php?action=csrf', $source, $path);
        }
    }
}
