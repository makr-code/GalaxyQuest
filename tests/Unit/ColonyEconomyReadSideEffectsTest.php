<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class ColonyEconomyReadSideEffectsTest extends TestCase
{
    public function testMacroReadUsesMarketProjectionWithoutSettlingColonies(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/colony_economy.php');
        self::assertIsString($source);

        $macroStart = strpos($source, "if (\$action === 'macro')");
        $snapshotStart = strpos($source, "if (\$action === 'snapshot')", $macroStart);
        self::assertNotFalse($macroStart);
        self::assertNotFalse($snapshotStart);
        $macroAction = substr($source, $macroStart, $snapshotStart - $macroStart);

        self::assertStringContainsString("only_method('GET');", $macroAction);
        self::assertStringContainsString('$service->market($galaxy, $system)', $macroAction);
        self::assertStringNotContainsString('$service->settle(', $macroAction);
    }

    public function testSnapshotGetIsTheExplicitOwnerScopedOnDemandSettlement(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/colony_economy.php');
        self::assertIsString($source);

        $snapshotStart = strpos($source, "if (\$action === 'snapshot')");
        $postStart = strpos($source, "only_method('POST');", $snapshotStart);
        self::assertNotFalse($snapshotStart);
        self::assertNotFalse($postStart);
        $snapshotAction = substr($source, $snapshotStart, $postStart - $snapshotStart);

        self::assertStringContainsString("only_method('GET');", $snapshotAction);
        self::assertStringContainsString('$service->settle($cid, $uid)', $snapshotAction);
        self::assertStringNotContainsString('update_colony_resources(', $snapshotAction);
        self::assertStringNotContainsString('flush_colony_production(', $snapshotAction);
    }

    public function testLegacyEconomyReadsSettleOnceAndKeepLegacySettlementBehindDisabledMode(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/economy.php');
        self::assertIsString($source);

        foreach ([
            ['action_get_overview', '$cid'],
            ['action_get_production', '$colonyId'],
        ] as [$handlerName, $colonyVariable]) {
            $handler = str_replace(
                ["\r\n", "\r"],
                "\n",
                $this->functionBody($source, $handlerName)
            );
            self::assertStringContainsString("only_method('GET');", $handler, $handlerName);
            self::assertSame(1, substr_count($handler, '->settle('), $handlerName);
            self::assertStringContainsString(
                "(new OnDemandEconomy(\$db))->settle({$colonyVariable}, \$uid)",
                $handler
            );
            self::assertMatchesRegularExpression(
                '/if \(ON_DEMAND_ECONOMY_ENABLED\)\s*\{\s*\$settlement = \(new OnDemandEconomy\(\$db\)\)'
                    . '->settle\(' . preg_quote($colonyVariable, '/') . ', \$uid\);\s*\}\s*else\s*\{\s*'
                    . 'update_colony_resources\(\$db, ' . preg_quote($colonyVariable, '/') . '\);\s*'
                    . 'flush_colony_production\(\$db, ' . preg_quote($colonyVariable, '/') . '\);\s*\}/',
                $handler
            );
            self::assertLessThan(
                strpos($handler, '$runtimeRow = fetch_colony_runtime_row'),
                strpos($handler, '->settle('),
                $handlerName . ' must settle before building its response snapshot.'
            );
            self::assertStringContainsString('$settlement', $handler);
        }

        $runtimeHelper = $this->functionBody($source, 'settled_economy_runtime');
        self::assertStringContainsString(
            '$settlement ?? (new OnDemandEconomy($db))->settle($cid)',
            $runtimeHelper
        );
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
