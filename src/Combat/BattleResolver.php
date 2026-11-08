<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use InvalidArgumentException;

final class BattleResolver
{
    public const RULE_VERSION = 'legacy-v1';

    public static function randomFloat(string $seed, string $key): float
    {
        $hash = hash('sha256', $seed . '|' . $key);
        $num = hexdec(substr($hash, 0, 8));
        return $num / 4294967295.0;
    }

    /**
     * @param array<string, float>|null $advanced
     * @return array{attacker_wins: bool, atk_loss_fraction: float, def_loss_fraction: float,
     *     atk_effective_dmg: float, def_effective_dmg: float, atk_dice_mult: float,
     *     def_dice_mult: float, dice_variance_index: float}
     */
    public static function outcome(
        float $atkAtk,
        float $defAtk,
        float $atkShield,
        float $defShield,
        float $atkHull,
        float $defHull,
        string $battleSeed,
        ?array $advanced = null
    ): array {
        $atkDiceMult = 0.9 + self::randomFloat($battleSeed, 'atk_dmg') * 0.2;
        $defDiceMult = 0.9 + self::randomFloat($battleSeed, 'def_dmg') * 0.2;

        if (is_array($advanced)) {
            $atkEnergy = max(0.0, (float)($advanced['atk_energy'] ?? 0.0))
                * max(0.0, (float)($advanced['atk_weapon_factor'] ?? 1.0));
            $atkKinetic = max(0.0, (float)($advanced['atk_kinetic'] ?? 0.0))
                * max(0.0, (float)($advanced['atk_weapon_factor'] ?? 1.0));
            $defEnergy = max(0.0, (float)($advanced['def_energy'] ?? 0.0))
                * max(0.0, (float)($advanced['def_weapon_factor'] ?? 1.0));
            $defKinetic = max(0.0, (float)($advanced['def_kinetic'] ?? 0.0))
                * max(0.0, (float)($advanced['def_weapon_factor'] ?? 1.0));

            $atkShieldFactor = max(0.0, (float)($advanced['atk_shield_factor'] ?? 1.0));
            $defShieldFactor = max(0.0, (float)($advanced['def_shield_factor'] ?? 1.0));
            $atkEnergyRaw = $atkEnergy * $atkDiceMult;
            $atkKineticRaw = $atkKinetic * $atkDiceMult;
            $defEnergyRaw = $defEnergy * $defDiceMult;
            $defKineticRaw = $defKinetic * $defDiceMult;

            $defShieldVsEnergy = $defShield * 1.30 * $defShieldFactor;
            $defShieldVsKinetic = $defShield * 0.75 * $defShieldFactor;
            $atkShieldVsEnergy = $atkShield * 1.30 * $atkShieldFactor;
            $atkShieldVsKinetic = $atkShield * 0.75 * $atkShieldFactor;
            $atkLeakEnergy = max(0.0, $atkEnergyRaw - $defShieldVsEnergy);
            $atkLeakKinetic = max(0.0, $atkKineticRaw - $defShieldVsKinetic);
            $defLeakEnergy = max(0.0, $defEnergyRaw - $atkShieldVsEnergy);
            $defLeakKinetic = max(0.0, $defKineticRaw - $atkShieldVsKinetic);

            $atkEffectiveDmg = max(0.0, $atkLeakEnergy * 1.15 + $atkLeakKinetic * 1.20);
            $defEffectiveDmg = max(0.0, $defLeakEnergy * 1.15 + $defLeakKinetic * 1.20);
        } else {
            $atkEffectiveDmg = max(0, ($atkAtk - $defShield * 0.5) * $atkDiceMult);
            $defEffectiveDmg = max(0, ($defAtk - $atkShield * 0.5) * $defDiceMult);
        }
        $attackerWins = $atkEffectiveDmg > ($defHull * 0.5 + $defShield * 0.2);
        $atkLossFraction = $defEffectiveDmg > 0
            ? min(0.9, $defEffectiveDmg / max(1, $atkHull + $atkShield))
            : 0.0;
        $defLossFraction = $attackerWins
            ? min(0.9, $atkEffectiveDmg / max(1, $defHull + $defShield)) : 0.3;

        return [
            'attacker_wins' => $attackerWins,
            'atk_loss_fraction' => (float)$atkLossFraction,
            'def_loss_fraction' => (float)$defLossFraction,
            'atk_effective_dmg' => (float)$atkEffectiveDmg,
            'def_effective_dmg' => (float)$defEffectiveDmg,
            'atk_dice_mult' => (float)$atkDiceMult,
            'def_dice_mult' => (float)$defDiceMult,
            'dice_variance_index' => (float)((abs($atkDiceMult - 1.0) + abs($defDiceMult - 1.0)) / 2.0),
        ];
    }

    /**
     * @param array<array-key, mixed> $ships Composition loaded from persisted fleet JSON.
     * @return array{lost: array<string, int>, survivors: array<string, int>}
     */
    public static function partitionLosses(array $ships, float $fraction): array
    {
        if (!is_finite($fraction) || $fraction < 0.0 || $fraction > 1.0) {
            throw new InvalidArgumentException('Battle loss fraction must be finite and between zero and one.');
        }
        $lost = [];
        $survivors = [];
        foreach ($ships as $type => $count) {
            if (!is_string($type) || $type === '' || !is_int($count) || $count < 0) {
                throw new InvalidArgumentException('Battle composition requires named nonnegative integer counts.');
            }
            $lost[$type] = min($count, (int)round($count * $fraction));
            $survivors[$type] = $count - $lost[$type];
        }
        return ['lost' => $lost, 'survivors' => $survivors];
    }
}
