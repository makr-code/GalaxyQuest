<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class PiratesReadSideEffectsTest extends TestCase
{
    public function testPirateReadActionsAreGetOnlyAndDoNotRunFactionTicks(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/pirates.php');
        self::assertIsString($source);

        foreach ([
            ['status', 'recent_raids'],
            ['recent_raids', 'forecast'],
            ['forecast', 'run_tick'],
            ['get_countermeasures', 'propose_contract'],
            ['list_contracts', 'default'],
        ] as [$action, $nextAction]) {
            $body = $this->caseBody($source, $action, $nextAction);

            self::assertStringContainsString("only_method('GET');", $body, $action);
            self::assertStringNotContainsString('npc_faction_tick(', $body, $action);
            self::assertStringNotContainsString('npc_ai_tick(', $body, $action);
        }

        $runTick = $this->caseBody($source, 'run_tick', 'set_defense_budget');
        self::assertStringContainsString('simulation_runtime_with_scope_lock(', $runTick);
        self::assertStringContainsString("'user',", $runTick);
        self::assertStringContainsString('(string)$uid,', $runTick);
        self::assertStringContainsString('npc_faction_tick($db, $uid, $faction);', $runTick);
        self::assertStringContainsString("'executed' => true", $runTick);
    }

    public function testPirateTickRequiresPostAndCsrfBeforeLoadingFactions(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/pirates.php');
        self::assertIsString($source);
        $runTick = $this->caseBody($source, 'run_tick', 'set_defense_budget');

        $postGuardOffset = strpos($runTick, "only_method('POST');");
        $csrfGuardOffset = strpos($runTick, 'verify_csrf();');
        $queryOffset = strpos($runTick, '$pirateStmt = $db->prepare(');

        self::assertNotFalse($postGuardOffset);
        self::assertNotFalse($csrfGuardOffset);
        self::assertNotFalse($queryOffset);
        self::assertLessThan($csrfGuardOffset, $postGuardOffset);
        self::assertLessThan($queryOffset, $csrfGuardOffset);

        $controller = file_get_contents(
            __DIR__ . '/../../js/engine/runtime/layers/domain/pirates/RuntimePiratesController.js'
        );
        self::assertIsString($controller);
        self::assertStringContainsString('tickRes?.executed === false', $controller);
        self::assertStringContainsString('another simulation is running.', $controller);
    }

    public function testRecentRaidCountHelperUsesAReadOnlyQuery(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/pirates.php');
        self::assertIsString($source);

        $helperOffset = strpos($source, 'function pirates_count_recent_raids(');
        self::assertNotFalse($helperOffset);
        $helper = substr($source, $helperOffset);

        self::assertStringContainsString('SELECT COUNT(*)', $helper);
        self::assertStringNotContainsString('INSERT ', $helper);
        self::assertStringNotContainsString('UPDATE ', $helper);
        self::assertStringNotContainsString('DELETE ', $helper);
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $actionOffset = strpos($source, "case '" . $action . "':");
        self::assertNotFalse($actionOffset, $action . ' action must exist.');

        $nextActionOffset = $nextAction === 'default'
            ? strpos($source, 'default:', $actionOffset)
            : strpos($source, "case '" . $nextAction . "':", $actionOffset);
        self::assertNotFalse($nextActionOffset, $nextAction . ' action must exist.');

        return substr($source, $actionOffset, $nextActionOffset - $actionOffset);
    }
}
