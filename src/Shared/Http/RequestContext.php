<?php

declare(strict_types=1);

namespace GalaxyQuest\Shared\Http;

/**
 * RequestContext – encapsulates HTTP request metadata and session information.
 *
 * Provides a single object for passing authenticated user context, CSRF tokens,
 * and request metadata through the application layers without coupling to $_SESSION/$_COOKIE.
 *
 * Intended to be populated by authentication middleware and injected into controllers.
 */
final class RequestContext
{
    private function __construct(
        private ?int $userId = null,
        private ?string $csrfToken = null,
        private ?string $sessionId = null,
        private string $traceId = '',
        /** @var array<string, string> */
        private array $headers = [],
    ) {
        if (empty($this->traceId)) {
            $this->traceId = bin2hex(random_bytes(8));
        }
    }

    /**
     * Create a RequestContext from current HTTP request and session.
     *
     * Typically called by authentication middleware early in request pipeline.
     *
     * @param int|null $userId Authenticated user ID, or null if not logged in
     * @param string|null $csrfToken CSRF token from session or request
     * @param string|null $sessionId Session ID
     * @param array<string, string> $headers Optional request headers
     * @return self
     */
    public static function create(
        ?int $userId = null,
        ?string $csrfToken = null,
        ?string $sessionId = null,
        array $headers = [],
    ): self {
        return new self($userId, $csrfToken, $sessionId, '', $headers);
    }

    /**
     * Create an anonymous (unauthenticated) request context.
     *
     * @return self
     */
    public static function anonymous(): self
    {
        return new self();
    }

    /**
     * Check if user is authenticated.
     *
     * @return bool
     */
    public function isAuthenticated(): bool
    {
        return $this->userId !== null;
    }

    /**
     * Get authenticated user ID.
     *
     * @throws \RuntimeException if user is not authenticated
     */
    public function getUserId(): int
    {
        if ($this->userId === null) {
            throw new \RuntimeException('User is not authenticated');
        }

        return $this->userId;
    }

    /**
     * Try to get user ID, returning null if not authenticated.
     *
     * @return int|null
     */
    public function tryGetUserId(): ?int
    {
        return $this->userId;
    }

    /**
     * Get CSRF token.
     *
     * @throws \RuntimeException if no CSRF token is available
     */
    public function getCsrfToken(): string
    {
        if ($this->csrfToken === null) {
            throw new \RuntimeException('CSRF token not available in context');
        }

        return $this->csrfToken;
    }

    /**
     * Try to get CSRF token, returning null if not available.
     *
     * @return string|null
     */
    public function tryGetCsrfToken(): ?string
    {
        return $this->csrfToken;
    }

    /**
     * Get session ID.
     *
     * @return string|null
     */
    public function getSessionId(): ?string
    {
        return $this->sessionId;
    }

    /**
     * Get unique trace ID for request correlation and logging.
     *
     * @return string
     */
    public function getTraceId(): string
    {
        return $this->traceId;
    }

    /**
     * Get specific request header value.
     *
     * @param string $name Header name (case-insensitive)
     * @return string|null
     */
    public function getHeader(string $name): ?string
    {
        $lower = strtolower($name);
        foreach ($this->headers as $key => $value) {
            if (strtolower($key) === $lower) {
                return $value;
            }
        }

        return null;
    }

    /**
     * @return array<string, string>
     */
    public function getAllHeaders(): array
    {
        return $this->headers;
    }
}
