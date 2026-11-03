<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class FactionAgreementMethodContractTest extends TestCase
{
    public function testAgreementReadsAreGetOnlyAndMutationsRequirePostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/diplomacy.php');
        self::assertIsString($source);

        $dispatchOffset = strpos($source, 'switch ($action)');
        self::assertNotFalse($dispatchOffset);
        $dispatch = substr($source, $dispatchOffset);

        foreach (['list', 'types'] as $action) {
            $case = $this->caseBody($dispatch, $action);
            self::assertStringContainsString("only_method('GET');", $case);
            self::assertStringNotContainsString('verify_csrf();', $case);
        }

        foreach (['propose', 'respond', 'cancel'] as $action) {
            $case = $this->caseBody($dispatch, $action);
            self::assertStringContainsString("only_method('POST');", $case);
            self::assertStringContainsString('verify_csrf();', $case);
            self::assertLessThan(strpos($case, 'json_response('), strpos($case, 'verify_csrf();'));
        }
    }

    private function caseBody(string $dispatch, string $action): string
    {
        $start = strpos($dispatch, "case '" . $action . "':");
        self::assertNotFalse($start, $action . ' dispatch case must exist.');
        $end = strpos($dispatch, "\n        case ", $start + 1);
        if ($end === false) {
            $end = strpos($dispatch, "\n        default:", $start + 1);
        }
        self::assertNotFalse($end, $action . ' dispatch case must have a boundary.');

        return substr($dispatch, $start, $end - $start);
    }
}
