<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TraderRequestMethodContractTest extends TestCase
{
    public function testTraderMutationsRequirePostAndCsrfBeforeWorkStarts(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders.php');
        self::assertIsString($source);

        foreach (
            [
            'action_process_trader_tick' => '$db->beginTransaction()',
            'action_create_trader' => '$body = json_decode',
            ] as $function => $firstWork
        ) {
            $functionOffset = strpos($source, 'function ' . $function . '(');
            self::assertNotFalse($functionOffset, $function . ' must exist.');
            $nextFunctionOffset = strpos($source, "\nfunction ", $functionOffset + 1);
            self::assertNotFalse($nextFunctionOffset, $function . ' must have a bounded body.');
            $functionBody = substr($source, $functionOffset, $nextFunctionOffset - $functionOffset);
            $postGuardOffset = strpos($functionBody, "only_method('POST');");
            $csrfGuardOffset = strpos($functionBody, 'verify_csrf();');
            $firstWorkOffset = strpos($functionBody, $firstWork);

            self::assertNotFalse($postGuardOffset, $function . ' must require POST.');
            self::assertNotFalse($csrfGuardOffset, $function . ' must verify CSRF.');
            self::assertNotFalse($firstWorkOffset, $function . ' work marker must exist.');
            self::assertLessThan($csrfGuardOffset, $postGuardOffset);
            self::assertLessThan($firstWorkOffset, $csrfGuardOffset);
        }
    }

    public function testTraderReadActionsAreGetOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders.php');
        self::assertIsString($source);

        foreach ([
            'action_list_opportunities',
            'action_list_traders',
            'action_list_routes',
            'action_market_analysis',
        ] as $function) {
            self::assertSame(
                1,
                preg_match(
                    '/function ' . preg_quote($function, '/') . '\\([^)]*\\): never\\s*\\{\\s*only_method\\(\\x27GET\\x27\\);/',
                    $source
                ),
                $function . ' must be GET-only'
            );
        }
    }

    public function testTraderEventsDispatchAllowsGetOnlyForStatusAndRequiresPostCsrfForMutations(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders_events.php');
        self::assertIsString($source);

        $guardStart = strpos($source, '$readEvents = [');
        $dispatchStart = strpos($source, 'try {', $guardStart);
        self::assertNotFalse($guardStart);
        self::assertNotFalse($dispatchStart);
        $guard = substr($source, $guardStart, $dispatchStart - $guardStart);

        self::assertStringContainsString('$readEvents = [\'status\'];', $guard);
        self::assertStringContainsString("only_method('GET');", $guard);
        self::assertStringContainsString("only_method('POST');", $guard);
        self::assertStringContainsString('verify_csrf();', $guard);
        self::assertSame(1, preg_match("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/", $guard));

        foreach ([
            'market_update',
            'opportunity_scan',
            'trader_decisions',
            'route_process',
            'route_create',
            'route_complete',
            'game_tick',
        ] as $event) {
            self::assertStringContainsString("'" . $event . "'", $guard);
        }
    }

    public function testTraderEventFailuresAreLoggedWithoutExposingExceptionDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/traders_events.php');
        self::assertIsString($source);

        self::assertStringContainsString('error_log("traders_events.php error: " . $e->getMessage());', $source);
        self::assertStringContainsString("json_error('Trader event service unavailable', 503);", $source);
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $source);
    }
}
