<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PirateMutationMethodContractTest extends TestCase
{
    public function testPirateMutationsRequirePostAndCsrfBeforeReadingInputOrDatabase(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/pirates.php');
        self::assertIsString($source);

        foreach ([
            'set_defense_budget' => '$colonyId',
            'propose_contract' => '$factionId',
            'run_tick' => '$beforeRaids',
        ] as $action => $firstWork) {
            $caseOffset = strpos($source, "case '" . $action . "':");
            self::assertNotFalse($caseOffset, $action . ' action must exist.');
            $nextCaseOffset = strpos($source, "case '", $caseOffset + 1);
            self::assertNotFalse($nextCaseOffset, $action . ' must have a bounded body.');
            $actionBody = substr($source, $caseOffset, $nextCaseOffset - $caseOffset);

            $postGuardOffset = strpos($actionBody, "only_method('POST');");
            $csrfGuardOffset = strpos($actionBody, 'verify_csrf();');
            $firstWorkOffset = strpos($actionBody, $firstWork);

            self::assertNotFalse($postGuardOffset, $action . ' must require POST.');
            self::assertNotFalse($csrfGuardOffset, $action . ' must verify CSRF.');
            self::assertNotFalse($firstWorkOffset, $action . ' work marker must exist.');
            self::assertLessThan($csrfGuardOffset, $postGuardOffset);
            self::assertLessThan($firstWorkOffset, $csrfGuardOffset);
        }
    }
}
