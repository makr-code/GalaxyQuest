<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class LeaderAndAllianceReadSideEffectsTest extends TestCase
{
    public function testLeaderMarketplaceAndAdvisorReadsDoNotGenerateOrRefreshState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/leaders.php');
        self::assertIsString($source);

        foreach ([
            ["case 'list':", "case 'hire':"],
            ["case 'marketplace':", "case 'refresh_marketplace':"],
            ["case 'advisor_hints':", "case 'advisor_tick':"],
        ] as [$action, $nextAction]) {
            $handler = $this->caseBody($source, $action, $nextAction);
            self::assertStringContainsString("only_method('GET');", $handler);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $handler,
                $action
            );
            self::assertStringNotContainsString('ensure_marketplace_candidates(', $handler, $action);
            self::assertStringNotContainsString('run_advisor_analysis(', $handler, $action);
        }

        $refresh = $this->caseBody($source, "case 'refresh_marketplace':", "case 'hire_candidate':");
        self::assertMatchesRegularExpression(
            "/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $refresh
        );
        self::assertStringContainsString('ensure_marketplace_candidates($db, $uid)', $refresh);

        $advisorTick = $this->caseBody($source, "case 'advisor_tick':", "case 'dismiss_hint':");
        self::assertMatchesRegularExpression(
            "/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $advisorTick
        );
        self::assertStringContainsString('run_advisor_analysis($db, $uid, $advisor)', $advisorTick);

        $marketplaceRead = $this->functionBody($source, 'fetch_marketplace_candidates');
        self::assertMatchesRegularExpression('/\\bSELECT\\b/i', $marketplaceRead);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i', $marketplaceRead);

        $schemaGuard = $this->functionBody($source, 'ensure_leader_marketplace_schema');
        self::assertStringContainsString('GalaxySchema::assertLeaderMarketplace($db)', $schemaGuard);
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE)\b/i',
            $schemaGuard
        );
        $marketplace = $this->caseBody($source, "case 'marketplace':", "case 'refresh_marketplace':");
        self::assertStringContainsString('ensure_leader_marketplace_schema($db)', $marketplace);
        self::assertStringNotContainsString('ensure_marketplace_candidates(', $marketplace);
    }

    public function testAutonomousFleetHostilityChecksDoNotTreatDatabaseErrorsAsSafeTerritory(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/leaders.php');
        self::assertIsString($source);

        $hostilityCheck = $this->functionBody($source, 'fc_is_hostile_system_for_user');
        self::assertStringContainsString('FROM alliance_members', $hostilityCheck);
        self::assertStringContainsString('FROM alliance_relations', $hostilityCheck);
        self::assertStringContainsString('FROM colonies c', $hostilityCheck);
        self::assertStringNotContainsString('catch (', $hostilityCheck);

        $aiTick = $this->caseBody($source, "case 'ai_tick':", "case 'marketplace':");
        self::assertMatchesRegularExpression(
            "/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
            $aiTick
        );
        self::assertStringContainsString('run_ai_tick($db, $uid)', $aiTick);
        self::assertStringContainsString('simulation_runtime_with_scope_lock(', $aiTick);
        self::assertStringContainsString("'user',", $aiTick);
        self::assertStringContainsString('(string)$uid,', $aiTick);
        self::assertStringContainsString("'executed' => true", $aiTick);
        self::assertStringContainsString("require_once __DIR__ . '/simulation_runtime.php';", $source);
        self::assertSame(2, substr_count($source, 'fc_is_hostile_system_for_user($db,'));

        $controller = file_get_contents(__DIR__ . '/../../js/engine/runtime/RuntimeLeadersController.js');
        self::assertIsString($controller);
        self::assertStringContainsString('response.executed === false', $controller);
        self::assertStringContainsString('Leader AI skipped because another simulation is running.', $controller);
    }

    public function testAllianceReadHandlersOnlyReadAllianceState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/alliances.php');
        self::assertIsString($source);

        foreach ([
            'action_list',
            'action_details',
            'action_relations',
            'action_war_map',
            'action_get_messages',
        ] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $handler,
                $handlerName
            );
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir|touch)\\s*\\(/',
                $handler,
                $handlerName
            );
        }

        self::assertStringContainsString("only_method('GET');", $source);
    }

    private function caseBody(string $source, string $action, string $nextAction): string
    {
        $start = strpos($source, $action);
        self::assertNotFalse($start, $action . ' action must exist.');
        $end = strpos($source, $nextAction, $start + strlen($action));
        self::assertNotFalse($end, $action . ' action must have a bounded body.');
        return substr($source, $start, $end - $start);
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
