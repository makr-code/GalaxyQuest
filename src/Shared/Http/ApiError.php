<?php

declare(strict_types=1);

namespace GalaxyQuest\Shared\Http;

/**
 * ApiError – unified error representation for API responses.
 *
 * Maps application errors into standardized error codes and messages for API consumers.
 * Includes optional details for debugging (not exposed to public API).
 */
final class ApiError
{
    /**
     * Error code registry (Bounded Context error codes).
     *
     * @var string[]
     */
    private const ERROR_CODES = [
        'AUTH_UNAUTHORIZED'         => 'User is not authenticated',
        'AUTH_CSRF_INVALID'         => 'CSRF token is invalid or expired',
        'VALIDATION_FAILED'         => 'Input validation failed',
        'GALAXY_RANGE_INVALID'      => 'Requested galaxy range is invalid',
        'GALAXY_SYSTEM_NOT_FOUND'   => 'System not found in galaxy',
        'COLONY_NOT_FOUND'          => 'Colony not found',
        'FLEET_NOT_FOUND'           => 'Fleet not found',
        'NETWORK_UNREACHABLE'       => 'External network service is unreachable',
        'INTERNAL_ERROR'            => 'An internal error occurred',
    ];

    private string $code;
    private string $message;
    /** @var array<string, mixed> */
    private array $details;

    /**
     * @param string $code Error code from registry
     * @param string|null $message Override default message for code
     * @param array<string, mixed> $details Additional debug information
     *
     * @throws \InvalidArgumentException if code is not registered
     */
    public function __construct(string $code, ?string $message = null, array $details = [])
    {
        if (!isset(self::ERROR_CODES[$code])) {
            throw new \InvalidArgumentException("Unknown error code: {$code}");
        }

        $this->code = $code;
        $this->message = $message ?? self::ERROR_CODES[$code];
        $this->details = $details;
    }

    public function getCode(): string
    {
        return $this->code;
    }

    public function getMessage(): string
    {
        return $this->message;
    }

    /**
     * @return array<string, mixed>
     */
    public function getDetails(): array
    {
        return $this->details;
    }

    /**
     * Serialize to array for JSON response.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $result = [
            'code' => $this->code,
            'message' => $this->message,
        ];

        if (!empty($this->details)) {
            $result['details'] = $this->details;
        }

        return $result;
    }

    /**
     * Get all registered error codes.
     *
     * @return string[]
     */
    public static function getRegisteredCodes(): array
    {
        return array_keys(self::ERROR_CODES);
    }
}
