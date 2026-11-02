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

        self::assertStringContainsString('transactionWithColony(', $buy);
        self::assertStringContainsString('credits >= ?', $buy);
        self::assertStringContainsString('quantity + ? <= capacity', $buy);
        self::assertStringContainsString('economy_market_transactions', $buy);

        self::assertStringContainsString('transactionWithColony(', $sell);
        self::assertStringContainsString('quantity >= ?', $sell);
        self::assertStringContainsString('UPDATE users SET credits = credits + ?', $sell);
        self::assertStringContainsString('economy_market_transactions', $sell);
    }
}
