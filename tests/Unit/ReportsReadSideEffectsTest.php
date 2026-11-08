<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ReportsReadSideEffectsTest extends TestCase
{
    public function testReportReadActionsAreGetOnlyAndDoNotWrite(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/reports.php');
        self::assertIsString($source);

        foreach ([
            'action_spy_reports',
            'action_battle_reports',
            'action_battle_detail',
        ] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            self::assertStringContainsString("only_method('GET');", $handler, $handlerName);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $handler,
                $handlerName . ' must not persist state.'
            );
            self::assertStringNotContainsString('update_colony_resources(', $handler);
            self::assertStringNotContainsString('flush_colony_production(', $handler);
        }

        foreach ([
            'build_battle_simulation_context',
            'normalize_battle_report_meta',
            'hydrate_battle_report_payload',
        ] as $helperName) {
            $helper = $this->functionBody($source, $helperName);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $helper,
                $helperName . ' must remain a pure read/transform helper.'
            );
        }
    }

    public function testBattleReplayAvailabilityFailsClosedAndRequiresResolvedParticipants(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/reports.php');
        self::assertIsString($source);
        $helper = $this->functionBody($source, 'battle_report_replay_availability_sql');

        self::assertStringContainsString(
            "defined('BATTLE_ENCOUNTERS_ENABLED') && BATTLE_ENCOUNTERS_ENABLED",
            $helper
        );
        self::assertStringContainsString('if (!$featureEnabled)', $helper);
        self::assertStringContainsString("return '0';", $helper);
        self::assertStringContainsString("ENGINE = ?", $helper);
        self::assertStringContainsString("(int)\$transactionalTableCount !== 3", $helper);
        foreach ([
            "'battle_encounters'",
            "'battle_encounter_participants'",
            "'battle_encounter_events'",
            "e.status = 'resolved'",
            'e.revision = 2',
            "p.side = 'attacker'",
            "p.side = 'defender'",
            'p.user_id = br.attacker_id',
            'p.user_id = br.defender_id',
        ] as $requirement) {
            self::assertStringContainsString($requirement, $helper, $requirement);
        }

        $handler = $this->functionBody($source, 'action_battle_reports');
        self::assertStringContainsString("'replay_available' => (bool)\$row['replay_available']", $handler);
    }

    private function functionBody(string $source, string $functionName): string
    {
        $start = strpos($source, 'function ' . $functionName . '(');
        self::assertNotFalse($start, $functionName . ' must exist.');
        $next = preg_match('/^[ \t]*function\s+/m', $source, $matches, PREG_OFFSET_CAPTURE, $start + 1)
            ? $matches[0][1]
            : strlen($source);
        return substr($source, $start, $next - $start);
    }
}
