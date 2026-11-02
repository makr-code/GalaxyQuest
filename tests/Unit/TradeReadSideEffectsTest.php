<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\TradeReadSideEffects;

use PHPUnit\Framework\TestCase;

final class TradeReadSideEffectsTest extends TestCase
{
    public function testTradeReadRequestsDoNotDispatchRoutesAndExplicitPostRequiresCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trade.php');
        self::assertIsString($source);

        $matchStart = strpos($source, 'match ($action)');
        $dispatchStart = strpos($source, 'function action_dispatch_due(');
        self::assertNotFalse($matchStart);
        self::assertNotFalse($dispatchStart);

        $dispatchEnd = strpos($source, 'function action_create(', $dispatchStart);
        self::assertNotFalse($dispatchEnd);
        $dispatchAction = substr($source, $dispatchStart, $dispatchEnd - $dispatchStart);

        self::assertStringNotContainsString('check_and_dispatch_trade_routes(', substr($source, 0, $matchStart));
        self::assertStringContainsString(
            "'dispatch_due'    => action_dispatch_due",
            substr($source, $matchStart, $dispatchStart - $matchStart)
        );
        self::assertStringContainsString("only_method('POST')", $dispatchAction);
        self::assertStringContainsString('verify_csrf()', $dispatchAction);
        self::assertStringContainsString('check_and_dispatch_trade_routes($db, $uid)', $dispatchAction);
    }
}
