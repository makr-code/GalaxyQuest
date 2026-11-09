<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use InvalidArgumentException;
use LogicException;

/**
 * Experimental aggregate battle rules. This class has no clock, storage, or game-side effects.
 */
final class LiveBattleRules
{
    public const RULE_VERSION = 'live-groups-experimental-v1';
    public const MAX_TICKS = 300;
    private const ATTACK_DIVISOR = 30.0;
    private const SIDES = ['attacker', 'defender'];

    /**
     * Each side is a nonempty map from ship type to count and per-ship stats.
     *
     * @param array<array-key, mixed> $fleets
     * @return array<string, mixed>
     */
    public static function begin(array $fleets): array
    {
        if (count($fleets) !== 2 || !isset($fleets['attacker'], $fleets['defender'])) {
            throw new InvalidArgumentException('A live battle requires exactly two sides.');
        }

        $groups = [];
        foreach (self::SIDES as $side) {
            if (!is_array($fleets[$side]) || $fleets[$side] === []) {
                throw new InvalidArgumentException('Each side requires at least one ship group.');
            }
            $groups[$side] = [];
            foreach ($fleets[$side] as $type => $spec) {
                if (
                    !is_string($type) || trim($type) === '' || !is_array($spec)
                    || !isset($spec['count']) || !is_int($spec['count']) || $spec['count'] < 1
                ) {
                    throw new InvalidArgumentException('Invalid live battle ship group.');
                }
                $attack = self::number($spec['attack'] ?? null, 'attack', false);
                $shield = self::number($spec['shield'] ?? null, 'shield', false);
                $hull = self::number($spec['hull'] ?? null, 'hull', true);
                $totalShield = $shield * $spec['count'];
                $totalHull = $hull * $spec['count'];
                if (
                    !is_finite($totalShield) || !is_finite($totalHull)
                    || !is_finite($attack * $spec['count'])
                ) {
                    throw new InvalidArgumentException('Live battle group stats exceed supported limits.');
                }
                $groups[$side][$type] = [
                    'initial_count' => $spec['count'],
                    'count' => $spec['count'],
                    'attack_per_ship' => $attack,
                    'shield_per_ship' => $shield,
                    'hull_per_ship' => $hull,
                    'shield' => $totalShield,
                    'hull' => $totalHull,
                ];
            }
            ksort($groups[$side], SORT_STRING);
        }

        return [
            'rule_version' => self::RULE_VERSION,
            'tick' => 0,
            'status' => 'active',
            'outcome' => null,
            'groups' => $groups,
        ];
    }

    /**
     * Calculate exactly one simultaneous one-second tick from the persisted snapshot.
     *
     * @param array<string, mixed> $state
     * @return array{state: array<string, mixed>, events: list<array<string, mixed>>}
     */
    public static function advance(array $state): array
    {
        self::validateState($state);
        if ($state['status'] !== 'active') {
            throw new LogicException('A resolved live battle cannot advance.');
        }

        $next = $state;
        $next['tick']++;
        $events = [];
        foreach (self::SIDES as $side) {
            $opponent = $side === 'attacker' ? 'defender' : 'attacker';
            $target = self::firstLivingGroup($state['groups'][$opponent]);
            if ($target === null) {
                continue;
            }
            $damage = 0.0;
            foreach ($state['groups'][$side] as $group) {
                $damage += $group['attack_per_ship'] * $group['count'] / self::ATTACK_DIVISOR;
            }
            if (!is_finite($damage)) {
                throw new InvalidArgumentException('Live battle damage exceeds supported limits.');
            }
            if ($damage <= 0.0) {
                continue;
            }
            $defending = &$next['groups'][$opponent][$target];
            $shieldDamage = min($defending['shield'], $damage);
            $hullDamage = min($defending['hull'], $damage - $shieldDamage);
            $defending['shield'] -= $shieldDamage;
            $defending['hull'] -= $hullDamage;
            $previousCount = $defending['count'];
            $defending['count'] = min(
                $previousCount,
                (int)ceil($defending['hull'] / $defending['hull_per_ship'])
            );
            $defending['shield'] = min(
                $defending['shield'],
                $defending['count'] * $defending['shield_per_ship']
            );
            $events[] = [
                'tick' => $next['tick'],
                'source_side' => $side,
                'target_side' => $opponent,
                'target_group' => $target,
                'shield_damage' => $shieldDamage,
                'hull_damage' => $hullDamage,
                'ships_lost' => $previousCount - $defending['count'],
            ];
            unset($defending);
        }

        $attackerAlive = self::firstLivingGroup($next['groups']['attacker']) !== null;
        $defenderAlive = self::firstLivingGroup($next['groups']['defender']) !== null;
        if (!$attackerAlive || !$defenderAlive || $next['tick'] === self::MAX_TICKS) {
            $next['status'] = 'resolved';
            $next['outcome'] = !$attackerAlive && !$defenderAlive ? 'mutual_destruction'
                : (!$attackerAlive ? 'defender_wins'
                : (!$defenderAlive ? 'attacker_wins' : 'stalemate'));
        }

        return ['state' => $next, 'events' => $events];
    }

    /** @param array<string, array<string, mixed>> $groups */
    private static function firstLivingGroup(array $groups): ?string
    {
        foreach ($groups as $type => $group) {
            if ($group['count'] > 0) {
                return $type;
            }
        }
        return null;
    }

    /** @param array<string, mixed> $state */
    private static function validateState(array $state): void
    {
        if (
            ($state['rule_version'] ?? null) !== self::RULE_VERSION
            || !isset($state['tick']) || !is_int($state['tick'])
            || $state['tick'] < 0 || $state['tick'] > self::MAX_TICKS
            || !in_array($state['status'] ?? null, ['active', 'resolved'], true)
            || !array_key_exists('outcome', $state)
            || !isset($state['groups']) || !is_array($state['groups'])
            || count($state['groups']) !== 2
            || !isset($state['groups']['attacker'], $state['groups']['defender'])
        ) {
            throw new InvalidArgumentException('Invalid live battle state.');
        }
        if (
            ($state['status'] === 'active' && ($state['outcome'] !== null || $state['tick'] >= self::MAX_TICKS))
            || ($state['status'] === 'resolved' && !in_array($state['outcome'], [
                'attacker_wins', 'defender_wins', 'mutual_destruction', 'stalemate',
            ], true))
        ) {
            throw new InvalidArgumentException('Invalid live battle status.');
        }

        foreach (self::SIDES as $side) {
            $groups = $state['groups'][$side];
            if (!is_array($groups) || $groups === [] || array_keys($groups) !== self::sortedKeys($groups)) {
                throw new InvalidArgumentException('Invalid live battle groups.');
            }
            foreach ($groups as $type => $group) {
                if (
                    !is_string($type) || trim($type) === '' || !is_array($group)
                    || !isset($group['initial_count'], $group['count'])
                    || !is_int($group['initial_count']) || $group['initial_count'] < 1
                    || !is_int($group['count']) || $group['count'] < 0
                    || $group['count'] > $group['initial_count']
                ) {
                    throw new InvalidArgumentException('Invalid live battle group count.');
                }
                $attack = self::number($group['attack_per_ship'] ?? null, 'attack', false);
                $shieldPerShip = self::number($group['shield_per_ship'] ?? null, 'shield', false);
                $hullPerShip = self::number($group['hull_per_ship'] ?? null, 'hull', true);
                $shield = self::number($group['shield'] ?? null, 'shield', false);
                $hull = self::number($group['hull'] ?? null, 'hull', false);
                if (
                    !is_finite($attack * $group['initial_count'])
                    || !is_finite($shieldPerShip * $group['initial_count'])
                    || !is_finite($hullPerShip * $group['initial_count'])
                    || $shield > $shieldPerShip * $group['count']
                    || $hull > $hullPerShip * $group['count']
                    || ($group['count'] === 0 && $hull !== 0.0)
                    || ($group['count'] > 0 && ($hull <= 0.0
                        || $hull <= $hullPerShip * ($group['count'] - 1)))
                ) {
                    throw new InvalidArgumentException('Live battle group health is inconsistent.');
                }
            }
        }
        $attackerAlive = self::firstLivingGroup($state['groups']['attacker']) !== null;
        $defenderAlive = self::firstLivingGroup($state['groups']['defender']) !== null;
        if ($state['status'] === 'active' && (!$attackerAlive || !$defenderAlive)) {
            throw new InvalidArgumentException('An active live battle requires both sides.');
        }
        if ($state['status'] === 'resolved') {
            $expected = !$attackerAlive && !$defenderAlive ? 'mutual_destruction'
                : (!$attackerAlive ? 'defender_wins'
                : (!$defenderAlive ? 'attacker_wins'
                : ($state['tick'] === self::MAX_TICKS ? 'stalemate' : null)));
            if ($state['tick'] === 0 || $state['outcome'] !== $expected) {
                throw new InvalidArgumentException('Live battle outcome does not match its groups.');
            }
        }
    }

    /** @param array<string, mixed> $groups
     *  @return list<string>
     */
    private static function sortedKeys(array $groups): array
    {
        $keys = array_keys($groups);
        sort($keys, SORT_STRING);
        return $keys;
    }

    private static function number(mixed $value, string $field, bool $positive): float
    {
        if (
            (!is_int($value) && !is_float($value)) || !is_finite((float)$value)
            || $value < 0 || ($positive && $value <= 0)
        ) {
            throw new InvalidArgumentException("Invalid live battle {$field}.");
        }
        return (float)$value;
    }
}
