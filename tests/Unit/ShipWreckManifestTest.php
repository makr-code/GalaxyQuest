<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use GalaxyQuest\Combat\LiveBattleRules;
use GalaxyQuest\Combat\ShipWreckManifest;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class ShipWreckManifestTest extends TestCase
{
    private function loss(): array
    {
        return ['tick' => 3, 'target_side' => 'defender', 'target_group' => 'fighter', 'ships_lost' => 2];
    }

    public function testManifestPreservesSourceAndExplicitContentsInCanonicalOrder(): void
    {
        $contents = [
            ['category' => 'weapon', 'item_id' => 'laser_mk1', 'quantity' => 1],
            ['category' => 'resource', 'item_id' => 'metal', 'quantity' => 150],
            ['category' => 'ammunition', 'item_id' => 'missile_mk1', 'quantity' => 3],
            ['category' => 'blueprint', 'item_id' => 'hull_design_v1', 'quantity' => 1],
        ];
        $manifest = ShipWreckManifest::fromLoss(21, 7, $this->loss(), $contents);
        self::assertSame([
            'schema_version' => 1,
            'source_key' => 'encounter:21:event:7',
            'source' => [
                'encounter_id' => 21,
                'event_sequence' => 7,
                'tick' => 3,
                'side' => 'defender',
                'group' => 'fighter',
                'ships_lost' => 2,
            ],
            'contents' => [$contents[2], $contents[3], $contents[1], $contents[0]],
        ], $manifest);
        self::assertSame($manifest, ShipWreckManifest::fromLoss(21, 7, $this->loss(), array_reverse($contents)));
        self::assertNotSame(
            $manifest['source_key'],
            ShipWreckManifest::fromLoss(21, 8, $this->loss(), $contents)['source_key']
        );
        self::assertSame([], ShipWreckManifest::fromLoss(21, 7, $this->loss(), [])['contents']);
    }

    public function testAcceptsAnActualExperimentalBattleLossEventWithoutInventingLoot(): void
    {
        $state = LiveBattleRules::begin([
            'attacker' => ['a' => ['count' => 1, 'attack' => 300, 'shield' => 0, 'hull' => 10]],
            'defender' => ['b' => ['count' => 1, 'attack' => 0, 'shield' => 0, 'hull' => 10]],
        ]);
        $event = LiveBattleRules::advance($state)['events'][0];
        $manifest = ShipWreckManifest::fromLoss(21, 9, $event, []);
        self::assertSame('defender', $manifest['source']['side']);
        self::assertSame('b', $manifest['source']['group']);
        self::assertSame(1, $manifest['source']['ships_lost']);
        self::assertSame([], $manifest['contents']);
    }

    public function testRejectsNonLossEventsAndInvalidIdentity(): void
    {
        $valid = $this->loss();
        $invalid = [
            [0, 1, $valid],
            [1, 0, $valid],
            [1, 1, array_replace($valid, ['ships_lost' => 0])],
            [1, 1, array_replace($valid, ['ships_lost' => '2'])],
            [1, 1, array_replace($valid, ['tick' => 0])],
            [1, 1, array_replace($valid, ['target_side' => 'spectator'])],
            [1, 1, array_replace($valid, ['target_group' => '../fighter'])],
        ];
        foreach ($invalid as [$encounter, $sequence, $loss]) {
            try {
                ShipWreckManifest::fromLoss($encounter, $sequence, $loss, []);
                self::fail('Invalid loss source must fail.');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
    }

    public function testRejectsInvalidOrDuplicateContentsWithoutCoercion(): void
    {
        $entry = ['category' => 'resource', 'item_id' => 'metal', 'quantity' => 1];
        $invalidLists = [
            [$entry, $entry],
            [array_replace($entry, ['category' => 'ship'])],
            [array_replace($entry, ['item_id' => ''])],
            [array_replace($entry, ['quantity' => 0])],
            [array_replace($entry, ['quantity' => '1'])],
            [array_replace($entry, ['quantity' => 1.5])],
            [array_merge($entry, ['extra' => true])],
            [1 => $entry],
            array_fill(0, 257, $entry),
        ];
        foreach ($invalidLists as $contents) {
            try {
                ShipWreckManifest::fromLoss(21, 7, $this->loss(), $contents);
                self::fail('Invalid wreck content must fail.');
            } catch (InvalidArgumentException $error) {
                self::assertNotSame('', $error->getMessage());
            }
        }
    }
}
