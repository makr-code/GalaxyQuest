<?php

declare(strict_types=1);

namespace GalaxyQuest\Combat;

use InvalidArgumentException;

/**
 * An inert description of explicitly supplied wreck contents, not a loot generator or entitlement.
 */
final class ShipWreckManifest
{
    public const SCHEMA_VERSION = 1;
    private const MAX_ENTRIES = 256;
    private const CATEGORIES = ['resource', 'blueprint', 'weapon', 'ammunition'];

    /**
     * The caller must supply an authoritative encounter event sequence and explicitly resolved contents.
     * This method does not verify that the event or catalog entries exist.
     *
     * @param array<string, mixed> $lossEvent
     * @param array<array-key, mixed> $contents
     * @return array<string, mixed>
     */
    public static function fromLoss(int $encounterId, int $eventSequence, array $lossEvent, array $contents): array
    {
        if ($encounterId <= 0 || $eventSequence <= 0) {
            throw new InvalidArgumentException('A wreck requires a positive encounter ID and event sequence.');
        }
        $side = $lossEvent['target_side'] ?? null;
        $group = $lossEvent['target_group'] ?? null;
        $tick = $lossEvent['tick'] ?? null;
        $lost = $lossEvent['ships_lost'] ?? null;
        if (
            !in_array($side, ['attacker', 'defender'], true)
            || !self::validIdentifier($group)
            || !is_int($tick) || $tick <= 0
            || !is_int($lost) || $lost <= 0
        ) {
            throw new InvalidArgumentException('A wreck requires a valid positive group-loss event.');
        }
        if (!array_is_list($contents) || count($contents) > self::MAX_ENTRIES) {
            throw new InvalidArgumentException('Wreck contents must be a bounded list.');
        }

        $entries = [];
        $seen = [];
        foreach ($contents as $entry) {
            if (
                !is_array($entry)
                || count($entry) !== 3
                || !in_array($entry['category'] ?? null, self::CATEGORIES, true)
                || !self::validIdentifier($entry['item_id'] ?? null)
                || !isset($entry['quantity']) || !is_int($entry['quantity']) || $entry['quantity'] <= 0
            ) {
                throw new InvalidArgumentException('Invalid wreck content entry.');
            }
            $key = $entry['category'] . ':' . $entry['item_id'];
            if (isset($seen[$key])) {
                throw new InvalidArgumentException('Duplicate wreck content entries are not allowed.');
            }
            $seen[$key] = true;
            $entries[] = [
                'category' => $entry['category'],
                'item_id' => $entry['item_id'],
                'quantity' => $entry['quantity'],
            ];
        }
        usort($entries, static fn(array $left, array $right): int =>
            strcmp($left['category'], $right['category']) ?: strcmp($left['item_id'], $right['item_id']));

        return [
            'schema_version' => self::SCHEMA_VERSION,
            'source_key' => sprintf('encounter:%d:event:%d', $encounterId, $eventSequence),
            'source' => [
                'encounter_id' => $encounterId,
                'event_sequence' => $eventSequence,
                'tick' => $tick,
                'side' => $side,
                'group' => $group,
                'ships_lost' => $lost,
            ],
            'contents' => $entries,
        ];
    }

    private static function validIdentifier(mixed $value): bool
    {
        return is_string($value)
            && preg_match('/\A[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}\z/D', $value) === 1;
    }
}
