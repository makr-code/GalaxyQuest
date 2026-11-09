<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use InvalidArgumentException;

/**
 * Verifies an isolated journal and derives loss candidates without creating loot or encounter events.
 */
final class LiveBattleLossProjection
{
    /**
     * The caller must provide a complete, trusted journal read from a consistent database snapshot.
     * Journal IDs and tick/event offsets are not encounter IDs or event sequences.
     *
     * @param array<string, mixed> $initial
     * @param array<array-key, mixed> $ticks
     * @param array<string, mixed> $current
     * @return array<string, mixed>
     */
    public static function project(int $journalId, array $initial, array $ticks, array $current): array
    {
        if (
            $journalId <= 0 || !array_is_list($ticks) || count($ticks) < 1
            || count($ticks) > LiveBattleRules::MAX_TICKS
        ) {
            throw new InvalidArgumentException('A complete bounded live battle journal is required.');
        }
        $fleets = [];
        foreach (['attacker', 'defender'] as $side) {
            $groups = $initial['groups'][$side] ?? null;
            if (!is_array($groups) || $groups === []) {
                throw new InvalidArgumentException('Invalid initial journal groups.');
            }
            foreach ($groups as $type => $group) {
                if (!is_string($type) || !is_array($group)) {
                    throw new InvalidArgumentException('Invalid initial journal group.');
                }
                $fleets[$side][$type] = [
                    'count' => $group['initial_count'] ?? null,
                    'attack' => $group['attack_per_ship'] ?? null,
                    'shield' => $group['shield_per_ship'] ?? null,
                    'hull' => $group['hull_per_ship'] ?? null,
                ];
            }
        }
        $state = LiveBattleRules::begin($fleets);
        if (!self::sameValue($state, $initial)) {
            throw new InvalidArgumentException('Initial journal state does not match its fleet specifications.');
        }
        $losses = [];
        foreach ($ticks as $index => $tick) {
            if (
                ($state['status'] ?? null) !== 'active'
                || !is_array($tick) || ($tick['tick'] ?? null) !== $index + 1
                || !is_array($tick['state'] ?? null) || !is_array($tick['events'] ?? null)
                || !array_is_list($tick['events'])
            ) {
                throw new InvalidArgumentException('Live battle history is incomplete or invalid.');
            }
            $expected = LiveBattleRules::advance($state);
            if (
                !self::sameValue($expected['state'], $tick['state'])
                || !self::sameValue($expected['events'], $tick['events'])
            ) {
                throw new InvalidArgumentException('Live battle tick does not match the recorded rules.');
            }
            foreach ($expected['events'] as $eventIndex => $event) {
                if ($event['ships_lost'] > 0) {
                    $losses[] = [
                        'journal_id' => $journalId,
                        'tick' => $index + 1,
                        'event_index' => $eventIndex,
                        'target_side' => $event['target_side'],
                        'target_group' => $event['target_group'],
                        'ships_lost' => $event['ships_lost'],
                    ];
                }
            }
            $state = $expected['state'];
        }
        if ($state['status'] !== 'resolved' || !self::sameValue($state, $current)) {
            throw new InvalidArgumentException('The journal must be complete and match its terminal snapshot.');
        }
        $groups = [];
        foreach (['attacker', 'defender'] as $side) {
            foreach ($state['groups'][$side] as $type => $group) {
                $groups[$side][$type] = [
                    'initial_count' => $group['initial_count'],
                    'survivors' => $group['count'],
                    'lost' => $group['initial_count'] - $group['count'],
                ];
            }
        }
        return [
            'schema_version' => 1,
            'journal_id' => $journalId,
            'rule_version' => LiveBattleRules::RULE_VERSION,
            'tick' => $state['tick'],
            'outcome' => $state['outcome'],
            'groups' => $groups,
            'losses' => $losses,
        ];
    }

    private static function sameValue(mixed $expected, mixed $actual): bool
    {
        if (is_array($expected) && is_array($actual)) {
            if (count($expected) !== count($actual)) {
                return false;
            }
            foreach ($expected as $key => $value) {
                if (!array_key_exists($key, $actual) || !self::sameValue($value, $actual[$key])) {
                    return false;
                }
            }
            return true;
        }
        if ((is_int($expected) || is_float($expected)) && (is_int($actual) || is_float($actual))) {
            return is_finite((float)$actual) && $expected == $actual;
        }
        return $expected === $actual;
    }
}
