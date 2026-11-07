<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\PirateRaidSimulationTick;

use PDO;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/game_engine.php';

final class PirateRaidSimulationTickTest extends TestCase
{
    public function testRaidNotificationsAreNotReplayedAsUnqueuedEvents(): void
    {
        $db = $this->createMock(PDO::class);
        $db->expects(self::never())->method('query');
        $db->expects(self::never())->method('prepare');
        $db->expects(self::never())->method('beginTransaction');
        $db->expects(self::never())->method('exec');

        self::assertSame([
            'processed' => false,
            'reason' => 'raid_event_queue_not_implemented',
            'raids_resolved' => 0,
            'raids_successful' => 0,
            'damage_total' => 0.0,
            'defenses_destroyed' => 0,
        ], \process_pirate_raid_resolution_tick($db));
    }

    public function testDirectRaidRoutineAppliesLootAndHistoryBeforeCreatingNotification(): void
    {
        $npc = file_get_contents(__DIR__ . '/../../api/npc_ai.php');
        $runtime = file_get_contents(__DIR__ . '/../../api/simulation_runtime.php');
        self::assertIsString($npc);
        self::assertIsString($runtime);

        $raidStart = strpos($npc, 'function maybe_pirate_raid(');
        self::assertNotFalse($raidStart);
        $nextFunction = strpos($npc, "\nfunction ", $raidStart + 1);
        self::assertNotFalse($nextFunction);
        $raidRoutine = substr($npc, $raidStart, $nextFunction - $raidStart);
        $lootMutation = strpos($raidRoutine, 'UPDATE colonies SET metal=GREATEST');
        $notification = strpos($raidRoutine, 'INSERT INTO messages (receiver_id, subject, body)');
        $history = strpos($raidRoutine, 'INSERT INTO pirate_raid_history');
        self::assertNotFalse($lootMutation);
        self::assertNotFalse($notification);
        self::assertNotFalse($history);
        self::assertLessThan(
            $notification,
            $lootMutation
        );
        self::assertStringContainsString('function npc_faction_tick(', $npc);
        self::assertStringContainsString('process_pirate_raid_resolution_tick($db, $force)', $runtime);
    }
}
