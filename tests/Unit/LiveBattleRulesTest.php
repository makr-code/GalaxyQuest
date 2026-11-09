<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use GalaxyQuest\Combat\LiveBattleRules;
use InvalidArgumentException;
use LogicException;
use PHPUnit\Framework\TestCase;

final class LiveBattleRulesTest extends TestCase
{
    private function group(int $count, float $attack, float $shield, float $hull): array
    {
        return compact('count', 'attack', 'shield', 'hull');
    }

    public function testTicksAreSimultaneousAndMutualDestructionIsPossible(): void
    {
        $state = LiveBattleRules::begin([
            'attacker' => ['fighter' => $this->group(1, 300.0, 0.0, 10.0)],
            'defender' => ['fighter' => $this->group(1, 300.0, 0.0, 10.0)],
        ]);
        $result = LiveBattleRules::advance($state);
        self::assertSame(0, $state['tick']);
        self::assertSame(1, $result['state']['tick']);
        self::assertSame('mutual_destruction', $result['state']['outcome']);
        self::assertCount(2, $result['events']);
        self::assertSame(1, $result['events'][0]['ships_lost']);
        self::assertSame(1, $result['events'][1]['ships_lost']);
        self::assertSame(0, $result['state']['groups']['attacker']['fighter']['count']);
        self::assertSame(0, $result['state']['groups']['defender']['fighter']['count']);
    }

    public function testShieldThenHullAndGroupLossesAreConserved(): void
    {
        $state = LiveBattleRules::begin([
            'attacker' => ['frigate' => $this->group(1, 450.0, 0.0, 100.0)],
            'defender' => ['fighter' => $this->group(2, 0.0, 5.0, 10.0)],
        ]);
        $first = LiveBattleRules::advance($state);
        $group = $first['state']['groups']['defender']['fighter'];
        self::assertSame(0.0, $group['shield']);
        self::assertSame(15.0, $group['hull']);
        self::assertSame(2, $group['count']);
        self::assertSame(10.0, $first['events'][0]['shield_damage']);
        self::assertSame(5.0, $first['events'][0]['hull_damage']);

        $second = LiveBattleRules::advance($first['state']);
        $group = $second['state']['groups']['defender']['fighter'];
        self::assertSame(0, $group['count']);
        self::assertSame(2, $second['events'][0]['ships_lost']);
        self::assertSame('attacker_wins', $second['state']['outcome']);
        self::assertSame(2, $group['initial_count']);
    }

    public function testTargetOrderAndReplayAreIndependentOfInputOrder(): void
    {
        $attack = ['frigate' => $this->group(1, 30.0, 0.0, 100.0)];
        $groups = [
            'zeta' => $this->group(1, 0.0, 0.0, 100.0),
            'alpha' => $this->group(1, 0.0, 0.0, 100.0),
        ];
        $left = LiveBattleRules::begin(['attacker' => $attack, 'defender' => $groups]);
        $right = LiveBattleRules::begin(['attacker' => $attack, 'defender' => array_reverse($groups, true)]);
        self::assertSame($left, $right);
        for ($tick = 1; $tick <= 20; $tick++) {
            $leftResult = LiveBattleRules::advance($left);
            $rightResult = LiveBattleRules::advance($right);
            self::assertSame($leftResult, $rightResult);
            self::assertSame('alpha', $leftResult['events'][0]['target_group']);
            $left = $leftResult['state'];
            $right = $rightResult['state'];
        }
    }

    public function testNoDamageTerminatesAtExactly300TicksAsStalemate(): void
    {
        $group = $this->group(1, 0.0, 0.0, 10.0);
        $state = LiveBattleRules::begin(['attacker' => ['a' => $group], 'defender' => ['b' => $group]]);
        for ($tick = 1; $tick <= LiveBattleRules::MAX_TICKS; $tick++) {
            $result = LiveBattleRules::advance($state);
            $state = $result['state'];
            self::assertSame($tick, $state['tick']);
            self::assertSame([], $result['events']);
            if ($tick < LiveBattleRules::MAX_TICKS) {
                self::assertSame('active', $state['status']);
            }
        }
        self::assertSame('resolved', $state['status']);
        self::assertSame('stalemate', $state['outcome']);
        $this->expectException(LogicException::class);
        LiveBattleRules::advance($state);
    }

    public function testPersistedJsonRoundTripAndPartialLossesRemainDeterministic(): void
    {
        $state = LiveBattleRules::begin([
            'attacker' => ['a' => $this->group(1, 180.0, 0.0, 100.0)],
            'defender' => ['b' => $this->group(2, 0.0, 0.0, 10.0)],
        ]);
        $first = LiveBattleRules::advance($state);
        $persisted = json_decode(json_encode($first['state'], JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        $second = LiveBattleRules::advance($persisted);
        self::assertEquals(LiveBattleRules::advance($first['state']), $second);
        self::assertSame(1, $second['state']['groups']['defender']['b']['count']);
        self::assertSame(1, $second['events'][0]['ships_lost']);
        self::assertSame(8.0, $second['state']['groups']['defender']['b']['hull']);
    }

    public function testRejectsInvalidInputsAndCorruptedState(): void
    {
        $group = $this->group(1, 1.0, 0.0, 10.0);
        foreach (
            [
            ['attacker' => ['a' => $this->group(0, 1.0, 0.0, 10.0)], 'defender' => ['b' => $group]],
            ['attacker' => ['a' => $this->group(1, INF, 0.0, 10.0)], 'defender' => ['b' => $group]],
            ['attacker' => ['a' => $this->group(1, 1.0, 0.0, 0.0)], 'defender' => ['b' => $group]],
            ['attacker' => [], 'defender' => ['b' => $group]],
            ] as $fleets
        ) {
            try {
                LiveBattleRules::begin($fleets);
                self::fail('Invalid fleet must be rejected.');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
        $state = LiveBattleRules::begin(['attacker' => ['a' => $group], 'defender' => ['b' => $group]]);
        $state['groups']['attacker']['a']['count'] = 0;
        $this->expectException(InvalidArgumentException::class);
        LiveBattleRules::advance($state);
    }
}
