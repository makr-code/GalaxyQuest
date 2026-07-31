<?php

declare(strict_types=1);

namespace GalaxyQuest\Shared\Http;

/**
 * ApiResponse – unified API response envelope for all endpoints.
 *
 * Standardizes responses across all bounded contexts:
 * - Success responses contain data and metadata
 * - Error responses contain error info and metadata
 * - All responses include trace_id and timestamp for debugging/correlation
 */
final class ApiResponse
{
    /** @var array<string, mixed> */
    private array $meta;

    /** @param array<string, mixed> $data Response data payload */
    private function __construct(
        private bool $success,
        private ?array $data = null,
        private ?ApiError $error = null,
    ) {
        $this->meta = [
            'trace_id' => $this->generateTraceId(),
            'ts' => (int)(microtime(true) * 1000),
        ];
    }

    /**
     * Create a successful response.
     *
     * @param array<string, mixed> $data Response data
     * @return self
     */
    public static function success(array $data): self
    {
        return new self(true, $data);
    }

    /**
     * Create an error response.
     *
     * @return self
     */
    public static function error(ApiError $error): self
    {
        return new self(false, null, $error);
    }

    /**
     * Serialize response to associative array for JSON encoding.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $response = [
            'success' => $this->success,
            'meta' => $this->meta,
        ];

        if ($this->success) {
            $response['data'] = $this->data ?? [];
        } else {
            $response['error'] = $this->error->toArray();
        }

        return $response;
    }

    /**
     * Send response as JSON with appropriate HTTP status.
     *
     * @param int $httpStatus HTTP status code (optional, defaults to 200 for success, 400 for error)
     * @return void
     */
    public function send(int $httpStatus = 0): void
    {
        if ($httpStatus === 0) {
            $httpStatus = $this->success ? 200 : 400;
        }

        http_response_code($httpStatus);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($this->toArray(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    private function generateTraceId(): string
    {
        return bin2hex(random_bytes(8));
    }

    /**
     * Get metadata (for testing/inspection).
     *
     * @return array<string, mixed>
     */
    public function getMeta(): array
    {
        return $this->meta;
    }

    public function isSuccess(): bool
    {
        return $this->success;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getData(): ?array
    {
        return $this->data;
    }

    public function getError(): ?ApiError
    {
        return $this->error;
    }
}
