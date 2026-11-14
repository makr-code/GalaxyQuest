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

    public function testProposalListProjectsExpiredStatusWithoutWriting(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trade.php');
        self::assertIsString($source);

        $readStart = strpos($source, 'function action_list_proposals(');
        $readEnd = strpos($source, 'function action_propose(', $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($readEnd);
        $readAction = substr($source, $readStart, $readEnd - $readStart);

        self::assertStringContainsString("only_method('GET')", $readAction);
        self::assertMatchesRegularExpression(
            '/CASE WHEN tp\.status = \'pending\' AND tp\.expires_at <= NOW\(\)\s+'
                . 'THEN \'expired\' ELSE tp\.status END AS status/',
            $readAction
        );
        self::assertStringNotContainsString('UPDATE trade_proposals', $readAction);
        $acceptAction = substr($source, strpos($source, 'function action_accept('));
        self::assertStringContainsString("strtotime(\$p['expires_at']) < time()", $acceptAction);
        self::assertStringContainsString("status = \\'expired\\'", $acceptAction);
    }

    public function testTradeReadHandlersAreGetOnlyAndMutationsRequirePostBeforeCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trade.php');
        self::assertIsString($source);

        foreach ([
            'action_list',
            'action_list_suggestions',
            'action_goods_flow',
            'action_list_proposals',
        ] as $handlerName) {
            $handler = $this->handlerBody($source, $handlerName);
            self::assertStringContainsString("only_method('GET');", $handler, $handlerName);
        }

        foreach ([
            'action_dispatch_due',
            'action_create',
            'action_delete',
            'action_toggle',
            'action_apply_suggestion',
            'action_propose',
            'action_accept',
            'action_reject',
            'action_cancel',
        ] as $handlerName) {
            $handler = $this->handlerBody($source, $handlerName);
            $postGuard = strpos($handler, "only_method('POST');");
            $csrfGuard = strpos($handler, 'verify_csrf();');
            self::assertNotFalse($postGuard, $handlerName . ' must require POST.');
            self::assertNotFalse($csrfGuard, $handlerName . ' must verify CSRF.');
            self::assertLessThan($csrfGuard, $postGuard, $handlerName . ' must check method before CSRF.');
        }
    }

    public function testTradeDispatchLocksRouteAndSpendsCargoThroughTheOnDemandLedger(): void
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

        $launchStart = strpos($source, 'function launch_trade_transport_fleet(');
        $launchEnd = strpos($source, '// ─── Trade Proposal handlers', $launchStart);
        self::assertNotFalse($launchStart);
        self::assertNotFalse($launchEnd);
        $launch = substr($source, $launchStart, $launchEnd - $launchStart);
        self::assertStringContainsString('(new OnDemandEconomy($db))->spend(', $launch);
        self::assertStringContainsString("type='large_cargo' AND count>=?", $launch);
        self::assertStringNotContainsString('ResourceLedger', $source);
    }

    private function handlerBody(string $source, string $handlerName): string
    {
        $start = strpos($source, 'function ' . $handlerName . '(');
        self::assertNotFalse($start, $handlerName . ' must exist.');
        $next = preg_match('/^[ \t]*function\s+/m', $source, $matches, PREG_OFFSET_CAPTURE, $start + 1)
            ? $matches[0][1]
            : strlen($source);
        return substr($source, $start, $next - $start);
    }
}
