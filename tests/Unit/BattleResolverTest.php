<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use GalaxyQuest\Combat\BattleResolver;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class BattleResolverTest extends TestCase
{
    public function testLegacyGoldenOutputsRemainIdentical(): void
    {
        $basic = BattleResolver::outcome(1000, 700, 120, 200, 900, 1100, 'legacy-a');
        self::assertSame([
            'attacker_wins' => true,
            'atk_loss_fraction' => 0.6589224625379078,
            'def_loss_fraction' => 0.6288431370501005,
            'atk_effective_dmg' => 817.4960781651307,
            'def_effective_dmg' => 672.1009117886659,
            'atk_dice_mult' => 0.9083289757390342,
            'def_dice_mult' => 1.0501576746697905,
            'dice_variance_index' => 0.07091434946537817,
        ], $basic);
        $advanced = BattleResolver::outcome(1000, 700, 120, 200, 900, 1100, 'legacy-a', [
            'atk_energy' => 600.0, 'atk_kinetic' => 400.0,
            'def_energy' => 200.0, 'def_kinetic' => 500.0,
            'atk_weapon_factor' => 0.8, 'def_weapon_factor' => 1.1,
            'atk_shield_factor' => 0.9, 'def_shield_factor' => 1.2,
        ]);
        self::assertSame([
            'attacker_wins' => false,
            'atk_loss_fraction' => 0.6864058401701164,
            'def_loss_fraction' => 0.3,
            'atk_effective_dmg' => 275.39592129173593,
            'def_effective_dmg' => 700.1339569735187,
            'atk_dice_mult' => 0.9083289757390342,
            'def_dice_mult' => 1.0501576746697905,
            'dice_variance_index' => 0.07091434946537817,
        ], $advanced);
        self::assertSame($basic, BattleResolver::outcome(1000, 700, 120, 200, 900, 1100, 'legacy-a'));
        self::assertNotSame($basic, BattleResolver::outcome(1000, 700, 120, 200, 900, 1100, 'another'));
    }

    public function testEmptyAndOverwhelmingLegacyOutcomesKeepTheirExistingRules(): void
    {
        $empty = BattleResolver::outcome(0, 0, 0, 0, 0, 0, 'empty');
        self::assertFalse($empty['attacker_wins']);
        self::assertSame(0.0, $empty['atk_loss_fraction']);
        self::assertSame(0.3, $empty['def_loss_fraction']);
        $strong = BattleResolver::outcome(10000, 10, 0, 0, 1000, 10, 'overwhelming');
        self::assertTrue($strong['attacker_wins']);
        self::assertSame(0.9, $strong['def_loss_fraction']);
        self::assertSame(0.010995535578577671, $strong['atk_loss_fraction']);
    }

    public function testAdvancedChannelsDefaultFactorsAndClampsRemainUnchanged(): void
    {
        $energy = BattleResolver::outcome(1000, 0, 0, 200, 100, 100, 'channels', ['atk_energy' => 1000.0]);
        $kinetic = BattleResolver::outcome(1000, 0, 0, 200, 100, 100, 'channels', ['atk_kinetic' => 1000.0]);
        $dice = $energy['atk_dice_mult'];
        self::assertSame((1000 * $dice - 200 * 1.30) * 1.15, $energy['atk_effective_dmg']);
        self::assertSame((1000 * $dice - 200 * 0.75) * 1.20, $kinetic['atk_effective_dmg']);
        $clamped = BattleResolver::outcome(1000, 1000, 0, 0, 100, 100, 'channels', [
            'atk_energy' => -1000.0, 'atk_kinetic' => 1000.0, 'atk_weapon_factor' => -1.0,
            'def_energy' => -1000.0, 'def_kinetic' => -1000.0,
        ]);
        self::assertSame(0.0, $clamped['atk_effective_dmg']);
        self::assertSame(0.0, $clamped['def_effective_dmg']);
    }

    public function testLossPartitionPreservesRoundingAndEveryShipCount(): void
    {
        self::assertSame([
            'lost' => ['fighter' => 1, 'cruiser' => 2, 'empty' => 0],
            'survivors' => ['fighter' => 0, 'cruiser' => 1, 'empty' => 0],
        ], BattleResolver::partitionLosses(['fighter' => 1, 'cruiser' => 3, 'empty' => 0], 0.5));
        foreach ([0.0, 0.3, 0.5, 0.9, 1.0] as $fraction) {
            foreach ([0, 1, 3, 40, 1000000] as $count) {
                $result = BattleResolver::partitionLosses(['fighter' => $count], $fraction);
                self::assertSame($count, $result['lost']['fighter'] + $result['survivors']['fighter']);
                self::assertGreaterThanOrEqual(0, $result['lost']['fighter']);
                self::assertGreaterThanOrEqual(0, $result['survivors']['fighter']);
                self::assertSame((int)round($count * $fraction), $result['lost']['fighter']);
            }
        }
        self::assertSame(['lost' => [], 'survivors' => []], BattleResolver::partitionLosses([], 0.3));
    }

    #[DataProvider('invalidLossInputs')]
    public function testInvalidLossInputsAreExplicitErrors(array $ships, float $fraction): void
    {
        $this->expectException(InvalidArgumentException::class);
        BattleResolver::partitionLosses($ships, $fraction);
    }

    public static function invalidLossInputs(): array
    {
        return [
            [['fighter' => 1], NAN], [['fighter' => 1], INF],
            [['fighter' => 1], -0.1], [['fighter' => 1], 1.1],
            [['fighter' => -1], 0.5], [['fighter' => '4'], 0.5],
            [['fighter' => 1.5], 0.5], [['' => 2], 0.5], [[2], 0.5],
        ];
    }

    public function testProductionAndPreviewKeepTheSharedFacade(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/fleet.php');
        self::assertIsString($source);
        foreach (['simulate_battle_preview', 'matchup_scan', 'resolve_battle'] as $name) {
            $start = strpos($source, 'function ' . $name . '(');
            self::assertNotFalse($start);
            $end = strpos($source, "\nfunction ", $start + 1);
            $body = substr($source, $start, $end - $start);
            self::assertStringContainsString('battle_preview_outcome(', $body);
        }
        self::assertStringContainsString('return BattleResolver::outcome(', $source);
        self::assertStringContainsString('return BattleResolver::randomFloat(', $source);
    }
}
