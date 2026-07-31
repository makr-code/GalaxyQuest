<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Shared\Http\ApiResponse;
use GalaxyQuest\Shared\Http\ApiError;

/**
 * GalaxyApiContractTest – Verify API response envelope contract.
 *
 * These tests ensure that all API responses conform to the unified envelope:
 * {
 *   "success": bool,
 *   "data": ?object,
 *   "error": ?object,
 *   "meta": {
 *     "trace_id": string,
 *     "ts": int
 *   }
 * }
 *
 * Contract tests prevent accidental changes to the API contract that would
 * break client code or introduce inconsistencies.
 */
class GalaxyApiContractTest extends TestCase
{
    /**
     * @test
     * Success response has correct structure.
     */
    public function testSuccessResponseStructure(): void
    {
        $data = [
            'systems' => [
                ['id' => 1, 'name' => 'Sol', 'x' => 10, 'y' => 20],
                ['id' => 2, 'name' => 'Sirius', 'x' => 15, 'y' => 25],
            ],
            'total_count' => 2,
        ];

        $response = ApiResponse::success($data);
        $envelope = $response->toArray();

        // Verify envelope structure
        self::assertArrayHasKey('success', $envelope);
        self::assertArrayHasKey('meta', $envelope);
        self::assertArrayHasKey('data', $envelope);

        // Verify success flag
        self::assertTrue($envelope['success']);

        // Verify data is present
        self::assertIsArray($envelope['data']);
        self::assertCount(2, $envelope['data']['systems']);

        // Verify error is not present
        self::assertArrayNotHasKey('error', $envelope);
    }

    /**
     * @test
     * Error response has correct structure.
     */
    public function testErrorResponseStructure(): void
    {
        $error = new ApiError('GALAXY_RANGE_INVALID', 'Coordinates must satisfy xmin <= xmax');
        $response = ApiResponse::error($error);
        $envelope = $response->toArray();

        // Verify envelope structure
        self::assertArrayHasKey('success', $envelope);
        self::assertArrayHasKey('meta', $envelope);
        self::assertArrayHasKey('error', $envelope);

        // Verify success flag
        self::assertFalse($envelope['success']);

        // Verify error content
        self::assertIsArray($envelope['error']);
        self::assertArrayHasKey('code', $envelope['error']);
        self::assertArrayHasKey('message', $envelope['error']);
        self::assertEquals('GALAXY_RANGE_INVALID', $envelope['error']['code']);

        // Verify data is not present
        self::assertArrayNotHasKey('data', $envelope);
    }

    /**
     * @test
     * Metadata is always present and correct.
     */
    public function testMetadataContract(): void
    {
        $response = ApiResponse::success(['test' => 'data']);
        $envelope = $response->toArray();

        $meta = $envelope['meta'];

        // Metadata must have these fields
        self::assertArrayHasKey('trace_id', $meta);
        self::assertArrayHasKey('ts', $meta);

        // Types must be correct
        self::assertIsString($meta['trace_id']);
        self::assertIsInt($meta['ts']);

        // Trace ID should be non-empty hex string
        self::assertNotEmpty($meta['trace_id']);
        self::assertTrue(ctype_xdigit($meta['trace_id']), 'trace_id should be hex');

        // Timestamp should be reasonable (within last 5 seconds)
        $now = (int)(microtime(true) * 1000);
        self::assertLessThan(5000, $now - $meta['ts']);
    }

    /**
     * @test
     * Multiple responses have different trace IDs.
     */
    public function testTraceIdUniqueness(): void
    {
        $response1 = ApiResponse::success(['data' => '1']);
        $response2 = ApiResponse::success(['data' => '2']);

        $traceId1 = $response1->toArray()['meta']['trace_id'];
        $traceId2 = $response2->toArray()['meta']['trace_id'];

        self::assertNotEquals($traceId1, $traceId2, 'Each response should have unique trace_id');
    }

    /**
     * @test
     * Success response with empty data array.
     */
    public function testSuccessResponseWithEmptyData(): void
    {
        $response = ApiResponse::success([]);
        $envelope = $response->toArray();

        self::assertTrue($envelope['success']);
        self::assertIsArray($envelope['data']);
        self::assertCount(0, $envelope['data']);
    }

    /**
     * @test
     * Error response formats correctly for HTTP headers.
     */
    public function testErrorResponseHttpStatus(): void
    {
        $error = new ApiError('GALAXY_SYSTEM_NOT_FOUND', 'System not found');
        $response = ApiResponse::error($error);

        // Should default to 400 for error
        self::assertFalse($response->isSuccess());
    }

    /**
     * @test
     * Range query response contract.
     */
    public function testRangeQueryResponseContract(): void
    {
        $rangeData = [
            'systems' => [
                ['id' => 1, 'name' => 'Sol', 'x' => 10, 'y' => 20],
            ],
            'total_count' => 1,
            'range_min' => ['x' => 5, 'y' => 15],
            'range_max' => ['x' => 20, 'y' => 30],
        ];

        $response = ApiResponse::success($rangeData);
        $envelope = $response->toArray();

        // Verify required fields for range response
        self::assertArrayHasKey('systems', $envelope['data']);
        self::assertArrayHasKey('total_count', $envelope['data']);
        self::assertArrayHasKey('range_min', $envelope['data']);
        self::assertArrayHasKey('range_max', $envelope['data']);

        // Verify types
        self::assertIsArray($envelope['data']['systems']);
        self::assertIsInt($envelope['data']['total_count']);
        self::assertIsArray($envelope['data']['range_min']);
        self::assertIsArray($envelope['data']['range_max']);
    }

    /**
     * @test
     * System detail response contract.
     */
    public function testSystemDetailResponseContract(): void
    {
        $detailData = [
            'x' => 10,
            'y' => 20,
            'payload' => [
                'id' => 1,
                'name' => 'Sol',
                'spectral_class' => 'G2V',
                'temperature_k' => 5778,
                'planet_count' => 8,
            ],
        ];

        $response = ApiResponse::success($detailData);
        $envelope = $response->toArray();

        // Verify required fields for system detail response
        self::assertArrayHasKey('x', $envelope['data']);
        self::assertArrayHasKey('y', $envelope['data']);
        self::assertArrayHasKey('payload', $envelope['data']);

        // Verify types
        self::assertIsInt($envelope['data']['x']);
        self::assertIsInt($envelope['data']['y']);
        self::assertIsArray($envelope['data']['payload']);

        // Verify payload has system data
        $payload = $envelope['data']['payload'];
        self::assertArrayHasKey('id', $payload);
        self::assertArrayHasKey('name', $payload);
    }

    /**
     * @test
     * Error codes are consistent across responses.
     */
    public function testErrorCodeConsistency(): void
    {
        $errorCodes = [
            'INTERNAL_ERROR',
            'GALAXY_RANGE_INVALID',
            'GALAXY_SYSTEM_NOT_FOUND',
            'NETWORK_UNREACHABLE',
            'VALIDATION_FAILED',
        ];

        foreach ($errorCodes as $code) {
            $error = new ApiError($code, 'Test message');
            $response = ApiResponse::error($error);
            $envelope = $response->toArray();

            self::assertEquals($code, $envelope['error']['code']);
            self::assertFalse($envelope['success']);
        }
    }

    /**
     * @test
     * API response can be serialized to JSON.
     */
    public function testApiResponseJsonSerialization(): void
    {
        $response = ApiResponse::success(['test' => 'data']);
        $envelope = $response->toArray();

        // Should be JSON serializable
        $json = json_encode($envelope);
        self::assertIsString($json);

        // Should round-trip
        $decoded = json_decode($json, true);
        self::assertIsArray($decoded);
        self::assertEquals($envelope, $decoded);
    }

    /**
     * @test
     * API response getters work correctly.
     */
    public function testApiResponseGetters(): void
    {
        $data = ['systems' => []];
        $response = ApiResponse::success($data);

        self::assertTrue($response->isSuccess());
        self::assertEquals($data, $response->getData());
        self::assertNull($response->getError());

        $meta = $response->getMeta();
        self::assertArrayHasKey('trace_id', $meta);
        self::assertArrayHasKey('ts', $meta);
    }

    /**
     * @test
     * Error API response getters work correctly.
     */
    public function testErrorApiResponseGetters(): void
    {
        $error = new ApiError('INTERNAL_ERROR', 'Test error message');
        $response = ApiResponse::error($error);

        self::assertFalse($response->isSuccess());
        self::assertNull($response->getData());
        self::assertNotNull($response->getError());
        self::assertEquals('INTERNAL_ERROR', $response->getError()->getCode());
    }
}
