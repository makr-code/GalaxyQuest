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

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
