<?php

declare(strict_types=1);

namespace GalaxyQuest\Galaxy\Presentation;

use GalaxyQuest\Shared\Http\ApiResponse;
use GalaxyQuest\Shared\Http\ApiError;
use GalaxyQuest\Shared\Http\RequestContext;
use GalaxyQuest\Galaxy\Application\GetStarsRangeService;
use GalaxyQuest\Galaxy\Application\GetSystemPayloadService;

/**
 * GalaxyController – HTTP request handler for galaxy-related endpoints.
 *
 * Responsibilities:
 * - Parse and validate HTTP input
 * - Call appropriate application services
 * - Translate domain exceptions to API errors
 * - Format and send JSON responses
 *
 * Architecture constraint: NO SQL STATEMENTS, NO DIRECT DATABASE ACCESS
 * All data access goes through services/repositories injected in constructor.
 */
final class GalaxyController
{
    public function __construct(
        private GetStarsRangeService $getStarsRangeService,
        private GetSystemPayloadService $getSystemPayloadService,
    ) {
    }

    /**
     * Handle GET /api/galaxy/range?xmin=...&xmax=...&ymin=...&ymax=...
     *
     * @param RequestContext $request Request context (for logging, auth, etc.)
     * @param array<string, string|int> $params Query parameters
     * @return ApiResponse
     */
    public function getStarsRange(RequestContext $request, array $params): ApiResponse
    {
        try {
            // Parse and validate input
            $xMin = (int)($params['xmin'] ?? 0);
            $xMax = (int)($params['xmax'] ?? 0);
            $yMin = (int)($params['ymin'] ?? 0);
            $yMax = (int)($params['ymax'] ?? 0);

            // Call application service
            $result = $this->getStarsRangeService->execute($xMin, $xMax, $yMin, $yMax);

            // Return success response
            return ApiResponse::success($result->toArray());
        } catch (\InvalidArgumentException $e) {
            $error = new ApiError('GALAXY_RANGE_INVALID', $e->getMessage());

            return ApiResponse::error($error);
        } catch (\Exception $e) {
            error_log("GalaxyController::getStarsRange error: " . $e->getMessage());
            $error = new ApiError('INTERNAL_ERROR');

            return ApiResponse::error($error);
        }
    }

    /**
     * Handle GET /api/galaxy/system?x=...&y=...
     *
     * Returns system payload (binary or JSON depending on encoder).
     *
     * @param RequestContext $request Request context
     * @param array<string, string|int> $params Query parameters
     * @return ApiResponse
     */
    public function getSystemPayload(RequestContext $request, array $params): ApiResponse
    {
        try {
            // Parse input
            $x = (int)($params['x'] ?? 0);
            $y = (int)($params['y'] ?? 0);

            // Call application service
            $result = $this->getSystemPayloadService->execute($x, $y);

            // Return success response with raw data
            return ApiResponse::success([
                'x' => $x,
                'y' => $y,
                'payload' => $result->toArray(),
            ]);
        } catch (\DomainException $e) {
            $error = new ApiError('GALAXY_SYSTEM_NOT_FOUND', $e->getMessage());

            return ApiResponse::error($error);
        } catch (\Exception $e) {
            error_log("GalaxyController::getSystemPayload error: " . $e->getMessage());
            $error = new ApiError('INTERNAL_ERROR');

            return ApiResponse::error($error);
        }
    }
}
