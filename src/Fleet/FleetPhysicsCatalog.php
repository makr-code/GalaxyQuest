<?php

declare(strict_types=1);

namespace GalaxyQuest\Fleet;

use InvalidArgumentException;
use PDO;
use RuntimeException;

final class FleetPhysicsCatalog
{
    public function __construct(private readonly PDO $db)
    {
    }

    /**
     * Load physical specifications for every nonzero ship type in a fleet.
     *
     * @param array<array-key, mixed> $ships
     * @return array<string, array{
     *     mass_kg: float,
     *     thrust_newtons: float,
     *     max_sublight_speed_m_s: float
     * }>
     */
    public function requireFleetSpecifications(array $ships): array
    {
        $types = [];
        foreach ($ships as $type => $count) {
            if (!is_string($type) || $type === '' || !is_int($count) || $count < 0) {
                throw new InvalidArgumentException('Fleet composition must contain named ships and nonnegative integer counts.');
            }
            if ($count > 0) {
                $types[] = $type;
            }
        }
        if ($types === []) {
            throw new InvalidArgumentException('A physical fleet specification requires at least one ship.');
        }

        $placeholders = implode(', ', array_fill(0, count($types), '?'));
        $statement = $this->db->prepare(
            "SELECT ship_type, mass_kg, thrust_newtons, max_sublight_speed_m_s
             FROM ship_physics_specs
             WHERE ship_type IN ({$placeholders})"
        );
        if ($statement === false) {
            throw new RuntimeException('Unable to prepare the ship physics catalog query.');
        }
        if (!$statement->execute($types)) {
            throw new RuntimeException('Unable to read ship physics specifications.');
        }

        $specifications = [];
        foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $type = $row['ship_type'] ?? null;
            if (!is_string($type) || !in_array($type, $types, true)) {
                throw new RuntimeException('The ship physics catalog returned an unexpected ship type.');
            }

            $mass = $row['mass_kg'] ?? null;
            $thrust = $row['thrust_newtons'] ?? null;
            $speed = $row['max_sublight_speed_m_s'] ?? null;
            if (!is_numeric($mass) || !is_numeric($thrust) || !is_numeric($speed)
                || !is_finite((float)$mass) || (float)$mass <= 0.0
                || !is_finite((float)$thrust) || (float)$thrust < 0.0
                || !is_finite((float)$speed) || (float)$speed <= 0.0) {
                throw new RuntimeException("Invalid physical specification stored for ship type {$type}.");
            }

            $specifications[$type] = [
                'mass_kg' => (float)$mass,
                'thrust_newtons' => (float)$thrust,
                'max_sublight_speed_m_s' => (float)$speed,
            ];
        }

        $missing = array_values(array_diff($types, array_keys($specifications)));
        if ($missing !== []) {
            throw new RuntimeException(
                'Missing physical specifications for ship types: ' . implode(', ', $missing)
            );
        }

        return $specifications;
    }
}
