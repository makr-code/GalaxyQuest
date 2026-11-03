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
}
