<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class DiplomaticPlaysMethodContractTest extends TestCase
{
    public function testReadActionsAreGetOnlyAndMutationsRequirePostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/diplomatic_plays.php');
        self::assertIsString($source);

        $dispatchOffset = strpos($source, 'switch ($action)');
        self::assertNotFalse($dispatchOffset);
        $dispatch = substr($source, $dispatchOffset);

        foreach (['list', 'trust_threat'] as $action) {
            $case = $this->caseBody($dispatch, $action);
            self::assertStringContainsString("only_method('GET');", $case);
            self::assertStringNotContainsString('verify_csrf();', $case);
        }

        foreach (['propose_play', 'counter_play', 'mobilize', 'resolve'] as $action) {
            $case = $this->caseBody($dispatch, $action);
            self::assertStringContainsString("only_method('POST');", $case);
            self::assertStringContainsString('verify_csrf();', $case);
            self::assertLessThan(
                strpos($case, 'json_response('),
                strpos($case, 'verify_csrf();')
            );
        }
    }

    private function caseBody(string $dispatch, string $action): string
    {
        $caseOffset = strpos($dispatch, "case '" . $action . "':");
        self::assertNotFalse($caseOffset, $action . ' dispatch case must exist.');
        $nextCaseOffset = strpos($dispatch, "\n        case ", $caseOffset + 1);
        if ($nextCaseOffset === false) {
            $nextCaseOffset = strpos($dispatch, "\n        default:", $caseOffset + 1);
        }
        self::assertNotFalse($nextCaseOffset, $action . ' case must have a boundary.');

        return substr($dispatch, $caseOffset, $nextCaseOffset - $caseOffset);
    }
}
