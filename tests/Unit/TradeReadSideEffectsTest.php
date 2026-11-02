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

    public function testTradeDispatchLocksRouteAndUsesResourceLedgerForLegacyCargo(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trade.php');
        self::assertIsString($source);

        $dispatchStart = strpos($source, 'function dispatch_trade_fleet(');
        $dispatchEnd = strpos($source, 'function load_trade_colony_node(', $dispatchStart);
        self::assertNotFalse($dispatchStart);
        self::assertNotFalse($dispatchEnd);
        $dispatch = substr($source, $dispatchStart, $dispatchEnd - $dispatchStart);

        self::assertStringContainsString('beginTransaction()', $dispatch);
        self::assertStringContainsString('SELECT id FROM users WHERE id=? FOR UPDATE', $dispatch);
        self::assertStringContainsString('AND (last_dispatch IS NULL OR DATE_ADD', $dispatch);
        self::assertStringContainsString('FOR UPDATE', $dispatch);
        self::assertStringContainsString('UPDATE trade_routes SET last_dispatch = NOW()', $dispatch);
        self::assertStringContainsString('$db->commit()', $dispatch);

        $reserveStart = strpos($source, 'function reserve_trade_payload_from_origin(');
        $reserveEnd = strpos($source, '// ─── Trade Proposal handlers', $reserveStart);
        self::assertNotFalse($reserveStart);
        self::assertNotFalse($reserveEnd);
        $reserve = substr($source, $reserveStart, $reserveEnd - $reserveStart);

        self::assertStringContainsString('(new ResourceLedger($db))->spend(', $reserve);
        self::assertStringContainsString('quantity >= ?', $reserve);
        self::assertStringContainsString("type = 'large_cargo' AND count >= ?", $reserve);
    }
}
