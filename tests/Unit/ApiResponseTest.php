<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Shared\Http\ApiResponse;
use GalaxyQuest\Shared\Http\ApiError;

/**
 * Unit tests for ApiResponse.
 *
 * Verifies success/error envelope serialization, metadata, and response sending.
 */
final class ApiResponseTest extends TestCase
{
    public function testSuccessResponseWithData(): void
    {
        $data = ['name' => 'Earth', 'x' => 100, 'y' => 200];
        $response = ApiResponse::success($data);

        $this->assertTrue($response->isSuccess());
        $this->assertEquals($data, $response->getData());
        $this->assertNull($response->getError());
    }

    public function testSuccessResponseWithEmptyData(): void
    {
        $response = ApiResponse::success([]);

        $this->assertTrue($response->isSuccess());
        $this->assertEquals([], $response->getData());
    }

    public function testErrorResponse(): void
    {
        $error = new ApiError('GALAXY_SYSTEM_NOT_FOUND');
        $response = ApiResponse::error($error);

        $this->assertFalse($response->isSuccess());
        $this->assertNull($response->getData());
        $this->assertEquals($error, $response->getError());
    }

    public function testResponseHasMetadataWithTraceId(): void
    {
        $response = ApiResponse::success(['test' => 'data']);
        $meta = $response->getMeta();

        $this->assertArrayHasKey('trace_id', $meta);
        $this->assertArrayHasKey('ts', $meta);
        $this->assertIsString($meta['trace_id']);
        $this->assertIsInt($meta['ts']);
        $this->assertGreaterThan(0, $meta['ts']);
        $this->assertGreaterThan(0, strlen($meta['trace_id']));
    }

    public function testSuccessResponseToArray(): void
    {
        $data = ['system' => 'Alpha Centauri'];
        $response = ApiResponse::success($data);
        $array = $response->toArray();

        $this->assertArrayHasKey('success', $array);
        $this->assertArrayHasKey('data', $array);
        $this->assertArrayHasKey('meta', $array);
        $this->assertTrue($array['success']);
        $this->assertEquals($data, $array['data']);
        $this->assertArrayNotHasKey('error', $array);
    }

    public function testErrorResponseToArray(): void
    {
        $error = new ApiError('VALIDATION_FAILED', null, ['field' => 'range']);
        $response = ApiResponse::error($error);
        $array = $response->toArray();

        $this->assertArrayHasKey('success', $array);
        $this->assertArrayHasKey('error', $array);
        $this->assertArrayHasKey('meta', $array);
        $this->assertFalse($array['success']);
        $this->assertArrayNotHasKey('data', $array);
        $this->assertEquals('VALIDATION_FAILED', $array['error']['code']);
    }

    public function testMetadataConsistency(): void
    {
        $response = ApiResponse::success(['test' => true]);
        $meta1 = $response->getMeta();
        $meta2 = $response->getMeta();

        // Same trace_id, same timestamp (called within microseconds)
        $this->assertEquals($meta1['trace_id'], $meta2['trace_id']);
        $this->assertEquals($meta1['ts'], $meta2['ts']);
    }

    public function testJsonSerializationOfSuccessResponse(): void
    {
        $data = ['id' => 1, 'name' => 'Sol'];
        $response = ApiResponse::success($data);
        $json = json_encode($response->toArray());

        $this->assertIsString($json);
        $decoded = json_decode($json, true);

        $this->assertTrue($decoded['success']);
        $this->assertEquals($data, $decoded['data']);
    }

    public function testJsonSerializationOfErrorResponse(): void
    {
        $error = new ApiError('NETWORK_UNREACHABLE');
        $response = ApiResponse::error($error);
        $json = json_encode($response->toArray());

        $this->assertIsString($json);
        $decoded = json_decode($json, true);

        $this->assertFalse($decoded['success']);
        $this->assertEquals('NETWORK_UNREACHABLE', $decoded['error']['code']);
    }
}
