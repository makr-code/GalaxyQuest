<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class EspionageReadSideEffectsTest extends TestCase
{
    public function testMissionResultMutationRequiresPostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/espionage.php');
        self::assertIsString($source);

        $start = strpos($source, "case 'mission_result':");
        $end = strpos($source, "\n    default:", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);
        $handler = substr($source, $start, $end - $start);

        $postOffset = strpos($handler, "only_method('POST');");
        $csrfOffset = strpos($handler, 'verify_csrf();');
        $gateOffset = strpos($handler, 'require_espionage_runtime();');
        self::assertNotFalse($postOffset);
        self::assertNotFalse($csrfOffset);
        self::assertNotFalse($gateOffset);
        self::assertLessThan($csrfOffset, $postOffset);
        self::assertLessThan($gateOffset, $csrfOffset);
        self::assertStringNotContainsString('UPDATE espionage_agents', $handler);
    }

    public function testEspionageReadActionsRemainGetOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/espionage.php');
        self::assertIsString($source);

        $activeStart = strpos($source, "case 'get_active_missions':");
        $resultStart = strpos($source, "case 'mission_result':");
        self::assertNotFalse($activeStart);
        self::assertNotFalse($resultStart);
        $activeHandler = substr($source, $activeStart, $resultStart - $activeStart);
        self::assertStringContainsString("only_method('GET');", $activeHandler);
        self::assertStringNotContainsString('verify_csrf();', $activeHandler);
    }

    public function testEspionageMutationsRequireCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/espionage.php');
        self::assertIsString($source);

        foreach (['hire_agent', 'assign_mission', 'mission_result'] as $action) {
            $start = strpos($source, "case '" . $action . "':");
            $this->assertNotFalse($start, $action . ' action must exist.');
            $csrfOffset = strpos($source, 'verify_csrf();', $start);
            $this->assertNotFalse($csrfOffset, $action . ' must verify CSRF.');
            $nextCaseOffset = strpos($source, "\n    case ", $start + 1);
            if ($nextCaseOffset !== false) {
                self::assertLessThan($nextCaseOffset, $csrfOffset);
            }
        }
    }
}
