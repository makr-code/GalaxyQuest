<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Application;

use GalaxyQuest\Galaxy\Domain\Interfaces\GalaxyRepositoryInterface;
use GalaxyQuest\Galaxy\Domain\RangeValidator;

/**
 * GetStarsRangeService – application service for fetching systems within a coordinate range.
 *
 * Orchestrates:
 * - Input validation (via RangeValidator)
 * - Repository query
 * - Error handling and domain translation
 *
 * Used by Presentation layer (API Controller) to handle galaxy range queries.
 */
final class GetStarsRangeService
{
    public function __construct(
        private GalaxyRepositoryInterface $galaxyRepository,
        private RangeValidator $validator = new RangeValidator(),
    ) {
    }

    /**
     * Execute the service.
     *
     * @param int $xMin Minimum X coordinate
     * @param int $xMax Maximum X coordinate
     * @param int $yMin Minimum Y coordinate
     * @param int $yMax Maximum Y coordinate
     * @return GetStarsRangeResult
     *
     * @throws \InvalidArgumentException if range is invalid
     */
    public function execute(int $xMin, int $xMax, int $yMin, int $yMax): GetStarsRangeResult
    {
        // Validate range
        if (!$this->validator->isValidRange($xMin, $xMax, $yMin, $yMax)) {
            $error = $this->validator->getValidationError($xMin, $xMax, $yMin, $yMax);
            throw new \InvalidArgumentException($error ?? 'Invalid range');
        }

        // Fetch systems from repository
        $systems = $this->galaxyRepository->getSystemsInRange($xMin, $xMax, $yMin, $yMax);
        $count = $this->galaxyRepository->countSystemsInRange($xMin, $xMax, $yMin, $yMax);

        return new GetStarsRangeResult(
            systems: $systems,
            totalCount: $count,
            rangeMin: ['x' => $xMin, 'y' => $yMin],
            rangeMax: ['x' => $xMax, 'y' => $yMax],
        );
    }
}

/**
 * GetStarsRangeResult – result DTO for GetStarsRangeService.
 *
 * @phpstan-type SystemPayload array<string, mixed>
 */
final class GetStarsRangeResult
{
    /**
     * @param array<int, array<string, mixed>> $systems Array of system payloads
     * @param int $totalCount Total systems matching the range
     * @param array<string, int> $rangeMin Minimum coordinates of queried range
     * @param array<string, int> $rangeMax Maximum coordinates of queried range
     */
    public function __construct(
        public readonly array $systems,
        public readonly int $totalCount,
        public readonly array $rangeMin,
        public readonly array $rangeMax,
    ) {
    }

    /**
     * Export as associative array for API response.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'systems' => $this->systems,
            'total_count' => $this->totalCount,
            'range_min' => $this->rangeMin,
            'range_max' => $this->rangeMax,
        ];
    }
}
