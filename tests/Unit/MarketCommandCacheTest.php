<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class MarketCommandCacheTest extends TestCase
{
    public function testMarketExchangesInvalidateTradeCachesBeforeAcknowledging(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);
        foreach (['buy' => 'sell', 'sell' => 'invalidate_market_trade_cache'] as $action => $next) {
            $start = strpos($source, "function action_{$action}(");
            $end = strpos($source, $next === 'sell' ? 'function action_sell(' : 'function invalidate_market_trade_cache(', $start);
            self::assertNotFalse($start);
            self::assertNotFalse($end);
            $handler = substr($source, $start, $end - $start);
            self::assertStringContainsString("only_method('POST')", $handler);
            self::assertStringContainsString('verify_csrf()', $handler);
            self::assertSame(1, substr_count($handler, 'invalidate_market_trade_cache($uid, $colonyId)'));
            self::assertMatchesRegularExpression('/exchange\([\s\S]*?\);[\s\S]*?invalidate_market_trade_cache\(\$uid, \$colonyId\);\s*json_ok\(\$result\)/', $handler);
        }
        self::assertStringContainsString("gq_cache_delete('game_overview', ['uid' => \$uid])", $source);
        self::assertStringContainsString("gq_cache_delete('game_resources', ['uid' => \$uid, 'cid' => \$colonyId])", $source);
    }

    public function testPriceAndHistoryReadsDoNotTrade(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/market.php');
        self::assertIsString($source);
        foreach (['get_prices', 'get_history'] as $action) {
            $start = strpos($source, "function action_{$action}(");
            self::assertNotFalse($start);
            $end = strpos($source, "\n}", $start);
            self::assertNotFalse($end);
            $handler = substr($source, $start, $end + 2 - $start);
            self::assertStringContainsString("only_method('GET')", $handler);
            self::assertStringNotContainsString('->exchange(', $handler);
            self::assertStringNotContainsString('ResourceLedger', $handler);
        }
    }
}
