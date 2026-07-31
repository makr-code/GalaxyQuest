<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Domain\Interfaces;

/**
 * GalaxyRepositoryInterface – contract for persistent galaxy data access.
 *
 * Represents the Aggregate Root repository for all galaxy-related entities.
 * Implementations must handle star systems, coordinates, and system metadata.
 *
 * Note: This interface is independent of storage mechanism (PDO, ThemisDB, etc.)
 * Implementations should be in Infrastructure layer.
 */
interface GalaxyRepositoryInterface
{
    /**
     * Get system payload by coordinates.
     *
     * @param int $x X coordinate
     * @param int $y Y coordinate
     * @return array<string, mixed> System data payload
     *
     * @throws \DomainException if system not found
     */
    public function getSystemByCoordinates(int $x, int $y): array;

    /**
     * Get range of systems within bounding box.
     *
     * @param int $xMin Minimum X coordinate
     * @param int $xMax Maximum X coordinate
     * @param int $yMin Minimum Y coordinate
     * @param int $yMax Maximum Y coordinate
     * @return array<int, array<string, mixed>> Array of system payloads
     */
    public function getSystemsInRange(int $xMin, int $xMax, int $yMin, int $yMax): array;

    /**
     * Count systems in range (used for pagination).
     *
     * @param int $xMin Minimum X coordinate
     * @param int $xMax Maximum X coordinate
     * @param int $yMin Minimum Y coordinate
     * @param int $yMax Maximum Y coordinate
     * @return int
     */
    public function countSystemsInRange(int $xMin, int $xMax, int $yMin, int $yMax): int;

    /**
     * Search systems by name prefix.
     *
     * @param string $prefix Name prefix to search
     * @param int $limit Maximum results to return
     * @return array<int, array<string, mixed>>
     */
    public function searchSystemsByName(string $prefix, int $limit = 50): array;
}
