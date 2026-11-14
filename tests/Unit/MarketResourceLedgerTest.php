<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\MarketResourceLedger;

use PHPUnit\Framework\TestCase;

final class MarketResourceLedgerTest extends TestCase
{
    public function testMarketBuyAndSellAreRetiredWithoutLedgerWrites(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);

        self::assertStringContainsString("'buy', 'sell'       => action_retired_trade()", $source);
        $handler = $this->functionBody($source, 'action_retired_trade');
        self::assertSame(1, preg_match("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/", $handler));
        self::assertStringContainsString('create_order', $handler);
        self::assertStringContainsString('409', $handler);
        self::assertStringNotContainsString('->exchange(', $source);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE)\\b/i', $handler);
    }

    public function testMarketReadsAndMutationsEnforceTheirHttpMethods(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);

        foreach ([
            'action_get_prices' => 'GET',
            'action_get_region_prices' => 'GET',
            'action_get_history' => 'GET',
            'action_get_active_events' => 'GET',
            'action_retired_trade' => 'POST',
            'action_list_orders' => 'GET',
            'action_get_transports' => 'GET',
            'action_create_order' => 'POST',
            'action_cancel_order' => 'POST',
        ] as $handler => $method) {
            self::assertSame(
                1,
                preg_match(
                    '/function ' . preg_quote($handler, '/') . '\\([^)]*\\): never\\s*\\{\\s*only_method\\(\\x27' . $method . '\\x27\\);/',
                    $source
                ),
                $handler . ' must enforce ' . $method
            );
        }
    }

    public function testColonyPriceReadChecksOwnershipWithoutSettlement(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);

        $prices = $this->functionBody($source, 'action_get_prices');
        $ownershipCheck = strpos($prices, 'if (!$stmt->fetch())');
        self::assertNotFalse($ownershipCheck);
        self::assertStringNotContainsString('->settle(', $prices);

        $regionPrices = $this->functionBody($source, 'action_get_region_prices');
        self::assertStringNotContainsString('->settle(', $regionPrices);

        $snapshot = $this->functionBody($source, 'fetch_market_snapshot');
        self::assertStringContainsString('->market(', $snapshot);
        self::assertStringNotContainsString('->settle(', $snapshot);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE)\\b/i', $snapshot);
    }

    public function testStandingOrderMutationsRequireCsrfAndDelegateAuthenticatedOwner(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);
        foreach (['action_create_order', 'action_cancel_order'] as $name) {
            $handler = $this->functionBody($source, $name);
            self::assertSame(1, preg_match("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/", $handler));
            self::assertStringContainsString('(new StandingOrders($db))->', $handler);
            self::assertStringContainsString('$uid', $handler);
            self::assertStringContainsString('catch (DomainException $error)', $handler);
        }
        $list = $this->functionBody($source, 'action_list_orders');
        self::assertStringContainsString('->list($uid,', $list);
        self::assertStringNotContainsString('->settle(', $list);
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
