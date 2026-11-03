<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/ColonizationEngine.php';

final class ColonizationReadSideEffectsTest extends TestCase
{
    public function testColonizationGetActionsAreReadOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/colonization.php');
        self::assertIsString($source);

        $actions = [
            'sprawl_status' => 'list_sectors',
            'list_sectors' => 'sector_detail',
            'sector_detail' => 'create_sector',
            'list_governors' => 'appoint_governor',
            'list_edicts' => 'activate_edict',
        ];

        foreach ($actions as $action => $nextAction) {
            $start = strpos($source, "case '" . $action . "':");
            $end = strpos($source, "case '" . $nextAction . "':", $start);
            self::assertNotFalse($start, $action . ' action must exist.');
            self::assertNotFalse($end, $nextAction . ' action must bound the read handler.');

            $handler = substr($source, $start, $end - $start);
            self::assertStringContainsString("only_method('GET');", $handler);
            self::assertDoesNotMatchRegularExpression(
                '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
                $handler
            );
        }

        $listEdicts = new ReflectionMethod(ColonizationEngine::class, 'listEdicts');
        $listEdictsSource = file_get_contents($listEdicts->getFileName());
        self::assertIsString($listEdictsSource);
        $methodSource = substr(
            $listEdictsSource,
            $listEdicts->getStartLine() - 1,
            $listEdicts->getEndLine() - $listEdicts->getStartLine() + 1
        );
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
            $methodSource
        );
    }
}
