<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TraderReadSideEffectsTest extends TestCase
{
    public function testTraderGetHandlersOnlyReadPersistedProjections(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders.php');
        self::assertIsString($source);

        foreach ([
            'action_list_opportunities',
            'action_list_traders',
            'action_list_routes',
            'action_market_analysis',
        ] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            self::assertStringContainsString("only_method('GET');", $handler, $handlerName);
            self::assertDoesNotMatchRegularExpression(
                '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
                $handler,
                $handlerName
            );
            self::assertDoesNotMatchRegularExpression(
                '/\b(?:recalculate_supply_demand|find_and_rank_opportunities|flush_colony_production)\s*\(/',
                $handler,
                $handlerName
            );
        }
    }

    public function testTraderDispatcherDoesNotExposeBackendErrorsAndWritesRequirePostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders.php');
        self::assertIsString($source);

        self::assertStringContainsString('error_log("traders.php error: " . $e->getMessage());', $source);
        self::assertStringContainsString("json_error('Trader service unavailable', 503);", $source);
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $source);

        foreach (['action_process_trader_tick', 'action_create_trader'] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            self::assertMatchesRegularExpression(
                "/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/",
                $handler,
                $handlerName
            );
        }
    }

    public function testTraderStatusGetDoesNotRunMarketOrRouteTicks(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders_events.php');
        self::assertIsString($source);

        $status = $this->functionBody($source, 'event_status');
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO)\b/i',
            $status
        );
        self::assertDoesNotMatchRegularExpression(
            '/\b(?:update_supply_demand_table|find_and_rank_trade_opportunities|process_route_transitions)\s*\(/',
            $status
        );
        self::assertStringContainsString("\$readEvents = ['status'];", $source);
    }

    public function testManualTraderGameTickUsesTheGlobalSimulationLock(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders_events.php');
        self::assertIsString($source);
        self::assertStringContainsString("require_once __DIR__ . '/simulation_runtime.php';", $source);

        self::assertStringContainsString("if (\$event === 'game_tick')", $source);
        self::assertStringContainsString("if (\$event === 'status')", $source);

        $lockHelper = $this->functionBody($source, 'event_with_global_simulation_lock');
        self::assertStringContainsString("simulation_runtime_with_scope_lock(", $lockHelper);
        self::assertStringContainsString("'global',", $lockHelper);
        self::assertStringContainsString("['executed' => true]", $lockHelper);
        self::assertStringContainsString('json_ok($result)', $lockHelper);

        $event = $this->functionBody($source, 'event_game_tick');
        self::assertStringContainsString('event_with_global_simulation_lock(', $event);
        self::assertStringContainsString("static fn(): array => event_game_tick_run(\$db)", $event);

        $tick = $this->functionBody($source, 'event_game_tick_run');
        self::assertStringContainsString('$db->beginTransaction();', $tick);
        self::assertStringContainsString('$db->commit();', $tick);
        self::assertStringContainsString("'executed' => true", $tick);
        self::assertStringNotContainsString('json_ok(', $tick);
    }

    public function testEveryManualTraderMutationUsesTheGlobalSimulationLock(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders_events.php');
        self::assertIsString($source);

        foreach ([
            'event_market_update',
            'event_opportunity_scan',
            'event_trader_decisions',
            'event_route_process',
            'event_route_create',
            'event_route_complete',
            'event_game_tick',
        ] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            self::assertStringContainsString(
                'event_with_global_simulation_lock(',
                $handler,
                $handlerName . ' must share the global trader lock.'
            );
        }
    }

    public function testManualTraderActionTickUsesTheGlobalSimulationLock(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders.php');
        self::assertIsString($source);
        self::assertStringContainsString("require_once __DIR__ . '/simulation_runtime.php';", $source);

        $tick = $this->functionBody($source, 'action_process_trader_tick');
        self::assertStringContainsString("only_method('POST');", $tick);
        self::assertStringContainsString('verify_csrf();', $tick);
        self::assertStringContainsString('simulation_runtime_with_scope_lock(', $tick);
        self::assertStringContainsString("'global',", $tick);
        self::assertStringContainsString("'executed' => true", $tick);
        self::assertStringContainsString("json_ok(\$result)", $tick);
        self::assertStringContainsString('process_route_transitions($db)', $tick);
        self::assertStringContainsString('execute_trader_decisions($db)', $tick);
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
