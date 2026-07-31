<?php

declare(strict_types=1);

namespace GalaxyQuest\Shared\Http;

/**
 * RetryPolicy – Configurable retry mechanism with exponential backoff.
 *
 * Implements exponential backoff strategy for handling transient errors:
 * - Timeouts (client-side)
 * - 5xx server errors (transient)
 * - Network failures
 *
 * NOT retried:
 * - 4xx client errors (validation, auth, not found)
 * - Logic errors
 *
 * Usage:
 *   $policy = new RetryPolicy(maxRetries: 3, baseDelayMs: 100, jitterFactor: 0.1);
 *   $result = $policy->execute(function() {
 *       return $this->galaxyRepository->getSystem($x, $y);
 *   });
 */
final class RetryPolicy
{
    private int $maxRetries;
    private int $baseDelayMs;
    private float $jitterFactor;

    /**
     * @param int $maxRetries Maximum number of retries (default: 3)
     * @param int $baseDelayMs Base delay in milliseconds (default: 100)
     * @param float $jitterFactor Jitter as percentage of delay, 0.0-1.0 (default: 0.1)
     */
    public function __construct(
        int $maxRetries = 3,
        int $baseDelayMs = 100,
        float $jitterFactor = 0.1,
    ) {
        if ($maxRetries < 0) {
            throw new \InvalidArgumentException('maxRetries must be >= 0');
        }
        if ($baseDelayMs < 0) {
            throw new \InvalidArgumentException('baseDelayMs must be >= 0');
        }
        if ($jitterFactor < 0.0 || $jitterFactor > 1.0) {
            throw new \InvalidArgumentException('jitterFactor must be between 0.0 and 1.0');
        }

        $this->maxRetries = $maxRetries;
        $this->baseDelayMs = $baseDelayMs;
        $this->jitterFactor = $jitterFactor;
    }

    /**
     * Execute a callable with retry logic.
     *
     * @template T
     * @param callable(): T $fn Function to execute
     * @return T Result from successful execution
     *
     * @throws \Exception If all retries are exhausted or unretryable error occurs
     */
    public function execute(callable $fn)
    {
        $lastException = null;
        $attempt = 0;

        while ($attempt <= $this->maxRetries) {
            try {
                return $fn();
            } catch (\Exception $e) {
                $lastException = $e;

                // Check if error is retryable
                if (!$this->isRetryable($e) || $attempt >= $this->maxRetries) {
                    throw $e;
                }

                // Calculate delay and sleep
                $delayMs = $this->calculateDelay($attempt);
                usleep($delayMs * 1000); // Convert ms to microseconds

                $attempt++;
            }
        }

        // Should not reach here, but throw last exception just in case
        throw $lastException ?? new \RuntimeException('Retry exhausted');
    }

    /**
     * Check if exception is retryable.
     *
     * @private
     */
    private function isRetryable(\Exception $e): bool
    {
        // Timeout errors (represented as RuntimeException with specific message)
        if ($e instanceof \RuntimeException && strpos($e->getMessage(), 'timeout') !== false) {
            return true;
        }

        // Database connection errors
        if ($e instanceof \PDOException) {
            $code = (string)$e->getCode();
            // SQLSTATE errors for connection issues: 08* are connection errors
            if (strpos($code, '08') === 0) {
                return true;
            }
            // "SQLSTATE" prefix with no/lost connection
            if (strpos($e->getMessage(), 'lost connection') !== false ||
                strpos($e->getMessage(), 'no connection') !== false) {
                return true;
            }
        }

        // HTTP-like errors via custom marker (for future HTTP integration)
        if ($e instanceof \DomainException && strpos($e->getMessage(), '5xx') !== false) {
            return true;
        }

        return false;
    }

    /**
     * Calculate delay with exponential backoff and jitter.
     *
     * Formula: baseDelay * (2^attempt) * (1 + random jitter)
     *
     * @private
     */
    private function calculateDelay(int $attempt): int
    {
        // Exponential backoff: 2^attempt
        $backoffMs = $this->baseDelayMs * (int)pow(2, $attempt);

        // Add jitter: random percentage of delay
        $jitterMs = (int)($backoffMs * $this->jitterFactor * (random_int(0, 100) / 100));

        return $backoffMs + $jitterMs;
    }

    /**
     * Get configured max retries (for testing/inspection).
     *
     * @return int
     */
    public function getMaxRetries(): int
    {
        return $this->maxRetries;
    }

    /**
     * Get configured base delay (for testing/inspection).
     *
     * @return int
     */
    public function getBaseDelayMs(): int
    {
        return $this->baseDelayMs;
    }

    /**
     * Get configured jitter factor (for testing/inspection).
     *
     * @return float
     */
    public function getJitterFactor(): float
    {
        return $this->jitterFactor;
    }
}
