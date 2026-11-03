<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\MarketResourceLedger;

use PHPUnit\Framework\TestCase;

final class MarketResourceLedgerTest extends TestCase
{
    public function testLegacyMarketBuyAndSellUseLockedAtomicTransactions(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);

        $buyStart = strpos($source, 'function action_buy(');
        $sellStart = strpos($source, 'function action_sell(', $buyStart);
        $historyStart = strpos($source, 'function action_get_history(', $sellStart);
        self::assertNotFalse($buyStart);
        self::assertNotFalse($sellStart);
        self::assertNotFalse($historyStart);

        $buy = substr($source, $buyStart, $sellStart - $buyStart);
        $sell = substr($source, $sellStart, $historyStart - $sellStart);

        self::assertSame(1, preg_match("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/", $buy));
        self::assertSame(1, preg_match("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/", $sell));
        self::assertStringContainsString('transactionWithColony(', $buy);
        self::assertStringContainsString('credits >= ?', $buy);
        self::assertStringContainsString('quantity + ? <= capacity', $buy);
        self::assertStringContainsString('economy_market_transactions', $buy);

        self::assertStringContainsString('transactionWithColony(', $sell);
        self::assertStringContainsString('quantity >= ?', $sell);
        self::assertStringContainsString('UPDATE users SET credits = credits + ?', $sell);
        self::assertStringContainsString('economy_market_transactions', $sell);
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
            'action_buy' => 'POST',
            'action_sell' => 'POST',
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

    public function testColonyPriceReadUsesOnlyTheExplicitOwnedColonySettlement(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);

        $prices = $this->functionBody($source, 'action_get_prices');
        $ownershipCheck = strpos($prices, 'if (!$stmt->fetch())');
        $settlement = strpos($prices, '(new OnDemandEconomy($db))->settle($colonyId, $uid)');
        self::assertNotFalse($ownershipCheck);
        self::assertNotFalse($settlement);
        self::assertLessThan($settlement, $ownershipCheck);

        $regionPrices = $this->functionBody($source, 'action_get_region_prices');
        self::assertStringNotContainsString('->settle(', $regionPrices);

        $snapshot = $this->functionBody($source, 'fetch_market_snapshot');
        self::assertStringContainsString('->market(', $snapshot);
        self::assertStringNotContainsString('->settle(', $snapshot);
        self::assertDoesNotMatchRegularExpression('/\\b(?:INSERT|UPDATE|DELETE)\\b/i', $snapshot);
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
