<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use GalaxyQuest\Combat\LiveBattleLossProjection;
use GalaxyQuest\Combat\LiveBattleRules;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class LiveBattleLossProjectionTest extends TestCase
{
    private function fixture(float $attack = 150.0): array
    {
        $initial = LiveBattleRules::begin([
            'attacker' => ['fighter' => ['count' => 2, 'attack' => $attack, 'shield' => 0, 'hull' => 100]],
            'defender' => ['cruiser' => ['count' => 2, 'attack' => 0, 'shield' => 0, 'hull' => 10]],
        ]);
        $state = $initial;
        $ticks = [];
        while ($state['status'] === 'active') {
            $result = LiveBattleRules::advance($state);
            $state = $result['state'];
            $ticks[] = ['tick' => $state['tick'], 'state' => $state, 'events' => $result['events']];
        }
        return [$initial, $ticks, $state];
    }

    public function testLossesAreDerivedFromVerifiedServerTicksWithoutEncounterIdentityOrLoot(): void
    {
        [$initial, $ticks, $current] = $this->fixture();
        $projection = LiveBattleLossProjection::project(42, $initial, $ticks, $current);
        self::assertSame('attacker_wins', $projection['outcome']);
        self::assertSame(2, $projection['tick']);
        self::assertSame(
            ['initial_count' => 2, 'survivors' => 0, 'lost' => 2],
            $projection['groups']['defender']['cruiser']
        );
        self::assertSame([
            ['journal_id' => 42, 'tick' => 1, 'event_index' => 0, 'target_side' => 'defender',
                'target_group' => 'cruiser', 'ships_lost' => 1],
            ['journal_id' => 42, 'tick' => 2, 'event_index' => 0, 'target_side' => 'defender',
                'target_group' => 'cruiser', 'ships_lost' => 1],
        ], $projection['losses']);
        self::assertArrayNotHasKey('encounter_id', $projection);
        self::assertArrayNotHasKey('contents', $projection);
        self::assertSame($projection, LiveBattleLossProjection::project(
            42,
            json_decode(json_encode($initial, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR),
            json_decode(json_encode($ticks, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR),
            json_decode(json_encode($current, JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR)
        ));
    }

    public function testStalemateProducesNoInventedLosses(): void
    {
        [$initial, $ticks, $current] = $this->fixture(0.0);
        $projection = LiveBattleLossProjection::project(1, $initial, $ticks, $current);
        self::assertSame('stalemate', $projection['outcome']);
        self::assertSame(300, $projection['tick']);
        self::assertSame([], $projection['losses']);
        self::assertSame(
            ['initial_count' => 2, 'survivors' => 2, 'lost' => 0],
            $projection['groups']['attacker']['fighter']
        );
    }

    public function testZeroLossEventsAndSimultaneousLossesKeepOriginalEventOffsets(): void
    {
        $group = ['count' => 1, 'attack' => 150, 'shield' => 0, 'hull' => 10];
        $initial = LiveBattleRules::begin(['attacker' => ['a' => $group], 'defender' => ['b' => $group]]);
        $first = LiveBattleRules::advance($initial);
        $second = LiveBattleRules::advance($first['state']);
        $ticks = [
            ['tick' => 1, 'state' => $first['state'], 'events' => $first['events']],
            ['tick' => 2, 'state' => $second['state'], 'events' => $second['events']],
        ];
        $projection = LiveBattleLossProjection::project(9, $initial, $ticks, $second['state']);
        self::assertSame('mutual_destruction', $projection['outcome']);
        self::assertSame([0, 1], array_column($projection['losses'], 'event_index'));
        self::assertSame([2, 2], array_column($projection['losses'], 'tick'));
        self::assertSame(['defender', 'attacker'], array_column($projection['losses'], 'target_side'));
    }

    public function testObjectKeyOrderDoesNotChangeProjection(): void
    {
        [$initial, $ticks, $current] = $this->fixture();
        $expected = LiveBattleLossProjection::project(1, $initial, $ticks, $current);
        $initial = array_reverse($initial, true);
        $current = array_reverse($current, true);
        foreach ($ticks as &$tick) {
            $tick['state'] = array_reverse($tick['state'], true);
            foreach ($tick['events'] as &$event) {
                $event = array_reverse($event, true);
            }
            unset($event);
        }
        unset($tick);
        self::assertSame($expected, LiveBattleLossProjection::project(1, $initial, $ticks, $current));
    }

    public function testRejectsTruncationTamperingAndInvalidInput(): void
    {
        [$initial, $ticks, $current] = $this->fixture();
        $badInitial = $initial;
        $badInitial['groups']['attacker']['fighter']['count'] = 1;
        $badEvents = $ticks;
        $badEvents[0]['events'][0]['ships_lost'] = 0;
        $badState = $ticks;
        $badState[1]['state']['outcome'] = 'stalemate';
        $badCurrent = $current;
        $badCurrent['groups']['attacker']['fighter']['count'] = 1;
        $gap = $ticks;
        $gap[0]['tick'] = 2;
        $extra = $ticks;
        $extra[] = $ticks[1];
        $cases = [
            [0, $initial, $ticks, $current],
            [1, $badInitial, $ticks, $current],
            [1, $initial, [], $current],
            [1, $initial, [$ticks[0]], $current],
            [1, $initial, $gap, $current],
            [1, $initial, $badEvents, $current],
            [1, $initial, $badState, $current],
            [1, $initial, $ticks, $badCurrent],
            [1, $initial, $extra, $current],
        ];
        foreach ($cases as $case) {
            try {
                LiveBattleLossProjection::project(...$case);
                self::fail('Invalid journal must not produce loss candidates.');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
    }
}
