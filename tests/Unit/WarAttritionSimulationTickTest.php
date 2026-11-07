<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\WarAttritionSimulationTick;

use PDO;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/game_engine.php';

final class WarAttritionSimulationTickTest extends TestCase
{
    public function testUnmodeledAttritionDoesNotCreateFabricatedLossEvents(): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('query');
        $db->expects(self::never())->method('prepare');
        $db->expects(self::never())->method('beginTransaction');
        $db->expects(self::never())->method('exec');

        self::assertSame([
            'processed' => false,
            'reason' => 'troop_force_model_not_implemented',
            'wars_processed' => 0,
            'attrition_events' => 0,
            'total_losses' => 0,
            'elapsed_seconds' => 0,
        ], \process_war_attrition_tick($db));
    }

    public function testDisabledTickHasNoAttritionSqlOrCooldownStateMutation(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($source);
        $start = strpos($source, 'function process_war_attrition_tick(');
        self::assertNotFalse($start);
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $tick = substr($source, $start, $nextFunction === false ? null : $nextFunction - $start);

        self::assertStringNotContainsString('war_attrition_events', $tick);
        self::assertStringNotContainsString('war_supply_lines', $tick);
        self::assertStringNotContainsString('app_state_set_int', $tick);
    }
}
