<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Shared\Http\ApiError;

/**
 * Unit tests for ApiError.
 *
 * Verifies error code registry, serialization, and error creation.
 */
final class ApiErrorTest extends TestCase
{
    public function testCreateErrorWithRegisteredCode(): void
    {
        $error = new ApiError('AUTH_UNAUTHORIZED');

        $this->assertEquals('AUTH_UNAUTHORIZED', $error->getCode());
        $this->assertEquals('User is not authenticated', $error->getMessage());
        $this->assertEquals([], $error->getDetails());
    }

    public function testCreateErrorWithCustomMessage(): void
    {
        $error = new ApiError('VALIDATION_FAILED', 'Email is invalid');

        $this->assertEquals('VALIDATION_FAILED', $error->getCode());
        $this->assertEquals('Email is invalid', $error->getMessage());
    }

    public function testCreateErrorWithDetails(): void
    {
        $details = ['field' => 'email', 'reason' => 'format'];
        $error = new ApiError('VALIDATION_FAILED', null, $details);

        $this->assertEquals($details, $error->getDetails());
    }

    public function testThrowsExceptionForUnknownErrorCode(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Unknown error code: UNKNOWN_CODE');

        new ApiError('UNKNOWN_CODE');
    }

    public function testToArrayWithoutDetails(): void
    {
        $error = new ApiError('AUTH_CSRF_INVALID');
        $array = $error->toArray();

        $this->assertArrayHasKey('code', $array);
        $this->assertArrayHasKey('message', $array);
        $this->assertArrayNotHasKey('details', $array);
        $this->assertEquals('AUTH_CSRF_INVALID', $array['code']);
    }

    public function testToArrayWithDetails(): void
    {
        $details = ['field' => 'password'];
        $error = new ApiError('VALIDATION_FAILED', null, $details);
        $array = $error->toArray();

        $this->assertArrayHasKey('details', $array);
        $this->assertEquals($details, $array['details']);
    }

    public function testGetRegisteredCodes(): void
    {
        $codes = ApiError::getRegisteredCodes();

        $this->assertIsArray($codes);
        $this->assertContains('AUTH_UNAUTHORIZED', $codes);
        $this->assertContains('VALIDATION_FAILED', $codes);
        $this->assertContains('GALAXY_SYSTEM_NOT_FOUND', $codes);
        $this->assertContains('INTERNAL_ERROR', $codes);
    }

    public function testAllRegisteredCodesAreStrings(): void
    {
        $codes = ApiError::getRegisteredCodes();

        foreach ($codes as $code) {
            $this->assertIsString($code);
            $this->assertNotEmpty($code);
        }
    }
}
