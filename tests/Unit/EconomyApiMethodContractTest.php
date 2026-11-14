<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class EconomyApiMethodContractTest extends TestCase
{
    public function testEconomyReadHandlersRequireGet(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        foreach ([
            'action_get_overview',
            'action_get_production',
            'action_get_policy',
            'action_get_pop_classes',
            'action_get_pop_status',
            'action_get_bottleneck',
            'action_get_shortage_events',
            'action_get_shortage_summary',
        ] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            self::assertStringContainsString("only_method('GET');", $handler, $handlerName);
        }
    }

    public function testEveryEconomyMutationRequiresPostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        foreach ([
            'action_set_production_method',
            'action_set_policy',
            'action_set_tax',
            'action_set_subsidy',
            'action_set_pop_policy',
        ] as $handlerName) {
            $handler = $this->functionBody($source, $handlerName);
            $postGuard = strpos($handler, "only_method('POST');");
            $csrfGuard = strpos($handler, 'verify_csrf();');
            self::assertNotFalse($postGuard, $handlerName . ' must require POST.');
            self::assertNotFalse($csrfGuard, $handlerName . ' must verify CSRF.');
            self::assertLessThan($csrfGuard, $postGuard, $handlerName . ' must check method before CSRF.');
            self::assertSame(
                1,
                preg_match_all('/verify_csrf\\(\\);/', $handler),
                $handlerName . ' should verify CSRF exactly once.'
            );
        }
    }

    public function testPopClassSettlementRequiresGetBeforeSettlingOwnedColonies(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        $popClasses = $this->functionBody($source, 'action_get_pop_classes');
        $methodGuard = strpos($popClasses, "only_method('GET');");
        $settlement = strpos($popClasses, '$economy->settle((int)$ownedColonyId, $uid)');
        self::assertNotFalse($methodGuard);
        self::assertNotFalse($settlement);
        self::assertLessThan($settlement, $methodGuard);
        self::assertStringContainsString('WHERE user_id=?', $popClasses);
    }

    public function testPopPolicyMutationIsUnavailableInTheOnDemandEconomy(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        $handler = $this->functionBody($source, 'action_set_pop_policy');
        self::assertStringContainsString(
            "json_error('Population policy controls are unavailable in the on-demand economy.', 503);",
            $handler
        );
        self::assertStringNotContainsString('UPDATE economy_pop_classes', $handler);
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
