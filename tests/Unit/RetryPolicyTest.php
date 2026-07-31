<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Shared\Http\RetryPolicy;

/**
 * RetryPolicyTest – Unit tests for RetryPolicy retry mechanism.
 *
 * Tests:
 * - Exponential backoff calculation
 * - Jitter factor application
 * - Retryable error classification
 * - Max retries enforcement
 * - Successful execution on first attempt
 * - Exhausted retries
 */
class RetryPolicyTest extends TestCase
{
    /**
     * @test
     */
    public function testConstructorWithValidConfig(): void
    {
        $policy = new RetryPolicy(
            maxRetries: 5,
            baseDelayMs: 200,
            jitterFactor: 0.2,
        );

        self::assertEquals(5, $policy->getMaxRetries());
        self::assertEquals(200, $policy->getBaseDelayMs());
        self::assertEquals(0.2, $policy->getJitterFactor());
    }

    /**
     * @test
     */
    public function testConstructorWithDefaults(): void
    {
        $policy = new RetryPolicy();

        self::assertEquals(3, $policy->getMaxRetries());
        self::assertEquals(100, $policy->getBaseDelayMs());
        self::assertEquals(0.1, $policy->getJitterFactor());
    }

    /**
     * @test
     */
    public function testInvalidMaxRetries(): void
    {
        self::expectException(\InvalidArgumentException::class);
        new RetryPolicy(maxRetries: -1);
    }

    /**
     * @test
     */
    public function testInvalidBaseDelay(): void
    {
        self::expectException(\InvalidArgumentException::class);
        new RetryPolicy(baseDelayMs: -1);
    }

    /**
     * @test
     */
    public function testInvalidJitterFactor(): void
    {
        self::expectException(\InvalidArgumentException::class);
        new RetryPolicy(jitterFactor: 1.5); // > 1.0
    }

    /**
     * @test
     */
    public function testSuccessfulExecutionFirstAttempt(): void
    {
        $policy = new RetryPolicy();
        $called = 0;

        $result = $policy->execute(function () use (&$called) {
            $called++;
            return 'success';
        });

        self::assertEquals(1, $called);
        self::assertEquals('success', $result);
    }

    /**
     * @test
     */
    public function testRetryOnTransientError(): void
    {
        $policy = new RetryPolicy(maxRetries: 3);
        $called = 0;

        $result = $policy->execute(function () use (&$called) {
            $called++;
            if ($called < 3) {
                throw new \RuntimeException('Connection timeout');
            }
            return 'success';
        });

        self::assertEquals(3, $called);
        self::assertEquals('success', $result);
    }

    /**
     * @test
     */
    public function testExhaustedRetries(): void
    {
        $policy = new RetryPolicy(maxRetries: 2);
        $called = 0;

        self::expectException(\RuntimeException::class);
        self::expectExceptionMessage('Persistent error');

        $policy->execute(function () use (&$called) {
            $called++;
            throw new \RuntimeException('Persistent error');
        });
    }

    /**
     * @test
     */
    public function testNonRetryableError(): void
    {
        $policy = new RetryPolicy(maxRetries: 3);
        $called = 0;

        self::expectException(\InvalidArgumentException::class);

        $policy->execute(function () use (&$called) {
            $called++;
            throw new \InvalidArgumentException('Invalid input');
        });

        // Should not retry, so called only once
        self::assertEquals(1, $called);
    }

    /**
     * @test
     */
    public function testDatabaseConnectionError(): void
    {
        $policy = new RetryPolicy(maxRetries: 3);
        $called = 0;

        $result = $policy->execute(function () use (&$called) {
            $called++;
            if ($called < 2) {
                // PDOException with lost connection message is retryable
                throw new \PDOException('SQLSTATE[HY000]: General error: 2006 MySQL has gone away - lost connection');
            }
            return 'success';
        });

        self::assertEquals(2, $called);
        self::assertEquals('success', $result);
    }

    /**
     * @test
     */
    public function testRetryableErrorClassification(): void
    {
        $policy = new RetryPolicy();

        // Create reflection to access isRetryable (private method)
        $reflection = new \ReflectionClass($policy);
        $method = $reflection->getMethod('isRetryable');
        $method->setAccessible(true);

        // Timeout error - should be retryable
        $e1 = new \RuntimeException('Request timeout after 30s');
        self::assertTrue($method->invoke($policy, $e1));

        // Invalid argument - should NOT be retryable
        $e2 = new \InvalidArgumentException('Invalid input');
        self::assertFalse($method->invoke($policy, $e2));

        // Domain error - should NOT be retryable
        $e3 = new \DomainException('System not found');
        self::assertFalse($method->invoke($policy, $e3));
    }

    /**
     * @test
     */
    public function testExponentialBackoffProgression(): void
    {
        $policy = new RetryPolicy(baseDelayMs: 100, jitterFactor: 0.0); // No jitter for predictability

        $reflection = new \ReflectionClass($policy);
        $method = $reflection->getMethod('calculateDelay');
        $method->setAccessible(true);

        // Exponential backoff: 100 * 2^attempt
        $delay0 = $method->invoke($policy, 0);
        $delay1 = $method->invoke($policy, 1);
        $delay2 = $method->invoke($policy, 2);

        self::assertEquals(100, $delay0);
        self::assertEquals(200, $delay1);
        self::assertEquals(400, $delay2);
    }

    /**
     * @test
     */
    public function testJitterApplication(): void
    {
        $policy = new RetryPolicy(baseDelayMs: 100, jitterFactor: 1.0); // Max jitter

        $reflection = new \ReflectionClass($policy);
        $method = $reflection->getMethod('calculateDelay');
        $method->setAccessible(true);

        // With jitter, delay should be between baseDelay and baseDelay * (1 + jitter)
        $delay = $method->invoke($policy, 0);

        self::assertGreaterThanOrEqual(100, $delay);
        self::assertLessThanOrEqual(200, $delay); // Max: 100 + 100*1.0
    }

    /**
     * @test
     */
    public function testReturnsCorrectDataType(): void
    {
        $policy = new RetryPolicy();

        $array = $policy->execute(fn() => ['key' => 'value']);
        self::assertIsArray($array);
        self::assertEquals(['key' => 'value'], $array);

        $int = $policy->execute(fn() => 42);
        self::assertEquals(42, $int);

        $string = $policy->execute(fn() => 'hello');
        self::assertEquals('hello', $string);
    }

    /**
     * @test
     */
    public function testZeroRetries(): void
    {
        $policy = new RetryPolicy(maxRetries: 0);
        $called = 0;

        self::expectException(\RuntimeException::class);

        $policy->execute(function () use (&$called) {
            $called++;
            throw new \RuntimeException('Failed immediately');
        });

        // With maxRetries=0, should execute once and not retry
        self::assertEquals(1, $called);
    }
}
