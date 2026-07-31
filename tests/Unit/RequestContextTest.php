<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;
use GalaxyQuest\Shared\Http\RequestContext;

/**
 * Unit tests for RequestContext.
 *
 * Verifies authentication state, CSRF token handling, and context creation.
 */
final class RequestContextTest extends TestCase
{
    public function testCreateAuthenticatedContext(): void
    {
        $context = RequestContext::create(userId: 42, csrfToken: 'token123', sessionId: 'sess_xyz');

        $this->assertTrue($context->isAuthenticated());
        $this->assertEquals(42, $context->getUserId());
        $this->assertEquals('token123', $context->getCsrfToken());
        $this->assertEquals('sess_xyz', $context->getSessionId());
    }

    public function testCreateAnonymousContext(): void
    {
        $context = RequestContext::anonymous();

        $this->assertFalse($context->isAuthenticated());
        $this->assertNull($context->tryGetUserId());
        $this->assertNull($context->tryGetCsrfToken());
    }

    public function testGetUserIdThrowsWhenNotAuthenticated(): void
    {
        $context = RequestContext::anonymous();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('User is not authenticated');

        $context->getUserId();
    }

    public function testGetCsrfTokenThrowsWhenNotSet(): void
    {
        $context = RequestContext::create(userId: 1);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('CSRF token not available');

        $context->getCsrfToken();
    }

    public function testTryGetUserIdReturnsNull(): void
    {
        $context = RequestContext::anonymous();

        $this->assertNull($context->tryGetUserId());
    }

    public function testTryGetCsrfTokenReturnsNull(): void
    {
        $context = RequestContext::anonymous();

        $this->assertNull($context->tryGetCsrfToken());
    }

    public function testTraceIdIsGenerated(): void
    {
        $context = RequestContext::create();
        $traceId = $context->getTraceId();

        $this->assertIsString($traceId);
        $this->assertGreaterThan(0, strlen($traceId));
    }

    public function testTraceIdIsConsistent(): void
    {
        $context = RequestContext::create();
        $traceId1 = $context->getTraceId();
        $traceId2 = $context->getTraceId();

        $this->assertEquals($traceId1, $traceId2);
    }

    public function testHeaders(): void
    {
        $headers = ['Authorization' => '******', 'Content-Type' => 'application/json'];
        $context = RequestContext::create(headers: $headers);

        $this->assertEquals('******', $context->getHeader('Authorization'));
        $this->assertEquals('application/json', $context->getHeader('Content-Type'));
    }

    public function testHeaderCaseInsensitivity(): void
    {
        $headers = ['X-Custom-Header' => 'value123'];
        $context = RequestContext::create(headers: $headers);

        $this->assertEquals('value123', $context->getHeader('x-custom-header'));
        $this->assertEquals('value123', $context->getHeader('X-CUSTOM-HEADER'));
        $this->assertEquals('value123', $context->getHeader('X-Custom-Header'));
    }

    public function testGetHeaderReturnsNullForMissing(): void
    {
        $context = RequestContext::create(headers: ['Content-Type' => 'application/json']);

        $this->assertNull($context->getHeader('X-Missing'));
    }

    public function testGetAllHeaders(): void
    {
        $headers = ['Authorization' => '******', 'User-Agent' => 'TestClient'];
        $context = RequestContext::create(headers: $headers);

        $this->assertEquals($headers, $context->getAllHeaders());
    }

    public function testCreateWithPartialParameters(): void
    {
        $context = RequestContext::create(userId: 99);

        $this->assertTrue($context->isAuthenticated());
        $this->assertEquals(99, $context->getUserId());
        $this->assertNull($context->tryGetCsrfToken());
        $this->assertNull($context->getSessionId());
    }
}
