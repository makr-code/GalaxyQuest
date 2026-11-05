<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ResearchReadSideEffectsTest extends TestCase
{
    public function testResearchListDoesNotCompleteOrMutateResearch(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/research.php');
        self::assertIsString($source);

        $listStart = strpos($source, "case 'list':");
        $researchStart = strpos($source, "case 'research':", $listStart);
        self::assertNotFalse($listStart);
        self::assertNotFalse($researchStart);
        $listAction = substr($source, $listStart, $researchStart - $listStart);

        self::assertStringContainsString("only_method('GET');", $listAction);
        self::assertStringContainsString('check_research_prereqs(', $listAction);
        self::assertStringNotContainsString('UPDATE research', $listAction);
        self::assertStringNotContainsString('complete_research(', $listAction);

        $prerequisiteHelper = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($prerequisiteHelper);
        $helperStart = strpos($prerequisiteHelper, 'function check_research_prereqs(');
        $helperEnd = strpos($prerequisiteHelper, "\n}", $helperStart);
        self::assertNotFalse($helperStart);
        self::assertNotFalse($helperEnd);
        $helper = substr($prerequisiteHelper, $helperStart, $helperEnd - $helperStart);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i', $helper);
    }

    public function testResearchCompletionRequiresExplicitPostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/research.php');
        self::assertIsString($source);

        $finishStart = strpos($source, "case 'finish':");
        $finishEnd = strpos($source, 'default:', $finishStart);
        self::assertNotFalse($finishStart);
        self::assertNotFalse($finishEnd);
        $finishAction = substr($source, $finishStart, $finishEnd - $finishStart);
        self::assertMatchesRegularExpression(
            "/case 'finish':\\s*only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $finishAction
        );
    }
}
