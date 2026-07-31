<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Domain;

/**
 * RangeValidator – domain service for validating galaxy coordinate ranges.
 *
 * Encapsulates business rules for valid galaxy ranges:
 * - Minimum/maximum coordinate boundaries
 * - Range size constraints
 * - Precision requirements
 *
 * This is a pure domain service (no external dependencies).
 */
final class RangeValidator
{
    /**
     * Minimum valid coordinate.
     */
    private const MIN_COORD = 0;

    /**
     * Maximum valid coordinate.
     */
    private const MAX_COORD = 10000;

    /**
     * Maximum range width/height.
     */
    private const MAX_RANGE_SIZE = 500;

    /**
     * Validate coordinate bounds and range size.
     *
     * @param int $xMin Minimum X coordinate
     * @param int $xMax Maximum X coordinate
     * @param int $yMin Minimum Y coordinate
     * @param int $yMax Maximum Y coordinate
     * @return bool True if range is valid
     */
    public function isValidRange(int $xMin, int $xMax, int $yMin, int $yMax): bool
    {
        // Ensure min <= max
        if ($xMin > $xMax || $yMin > $yMax) {
            return false;
        }

        // Check coordinate bounds
        if ($xMin < self::MIN_COORD || $xMax > self::MAX_COORD) {
            return false;
        }

        if ($yMin < self::MIN_COORD || $yMax > self::MAX_COORD) {
            return false;
        }

        // Check range size
        $xRange = $xMax - $xMin;
        $yRange = $yMax - $yMin;

        if ($xRange > self::MAX_RANGE_SIZE || $yRange > self::MAX_RANGE_SIZE) {
            return false;
        }

        return true;
    }

    /**
     * Get validation error message (if invalid).
     *
     * @param int $xMin Minimum X coordinate
     * @param int $xMax Maximum X coordinate
     * @param int $yMin Minimum Y coordinate
     * @param int $yMax Maximum Y coordinate
     * @return string|null Error message, or null if valid
     */
    public function getValidationError(int $xMin, int $xMax, int $yMin, int $yMax): ?string
    {
        if ($xMin > $xMax || $yMin > $yMax) {
            return 'Min coordinate must be <= max coordinate';
        }

        if ($xMin < self::MIN_COORD || $xMax > self::MAX_COORD) {
            return "X coordinates must be between {$_MIN_COORD} and " . self::MAX_COORD;
        }

        if ($yMin < self::MIN_COORD || $yMax > self::MAX_COORD) {
            return "Y coordinates must be between {$_MIN_COORD} and " . self::MAX_COORD;
        }

        $xRange = $xMax - $xMin;
        $yRange = $yMax - $yMin;

        if ($xRange > self::MAX_RANGE_SIZE || $yRange > self::MAX_RANGE_SIZE) {
            return "Range size must not exceed " . self::MAX_RANGE_SIZE;
        }

        return null;
    }

    /**
     * Get maximum range size constraint.
     *
     * @return int
     */
    public static function getMaxRangeSize(): int
    {
        return self::MAX_RANGE_SIZE;
    }

    /**
     * Get minimum valid coordinate.
     *
     * @return int
     */
    public static function getMinCoordinate(): int
    {
        return self::MIN_COORD;
    }

    /**
     * Get maximum valid coordinate.
     *
     * @return int
     */
    public static function getMaxCoordinate(): int
    {
        return self::MAX_COORD;
    }
}
