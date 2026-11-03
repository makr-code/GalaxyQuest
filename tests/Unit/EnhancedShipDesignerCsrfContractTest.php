<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class EnhancedShipDesignerCsrfContractTest extends TestCase
{
    public function testMutatingActionsVerifyCsrfBeforeReadingRequestBody(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/ship_designer_enhanced.php');
        self::assertIsString($source);

        foreach (["customize_ship", "refine_with_trellis2"] as $action) {
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

    public function testBrowserClientSendsSessionCsrfTokenForBothMutations(): void
    {
        $source = file_get_contents(__DIR__ . '/../../js/ui/ship-designer-enhanced.js');
        self::assertIsString($source);

        foreach (["action=customize_ship", "action=refine_with_trellis2"] as $action) {
            $start = strpos($source, $action);
            self::assertNotFalse($start, $action . ' request must exist.');
            $requestStart = strrpos(substr($source, 0, $start), 'fetch(');
            self::assertNotFalse($requestStart);
            $nextRequest = strpos($source, 'fetch(', $start + strlen($action));
            $request = substr($source, $requestStart, $nextRequest === false ? null : $nextRequest - $requestStart);
            self::assertStringContainsString('credentials: \'same-origin\'', $request);
            self::assertStringContainsString('\'X-CSRF-Token\': csrfToken', $request);
        }
    }
}
