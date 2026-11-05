<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class OperationalStreamAndMetricsReadSideEffectsTest extends TestCase
{
    public function testServerSentEventsEndpointIsGetOnlyAndUsesReadQueries(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/events.php');
        self::assertIsString($source);

        self::assertMatchesRegularExpression(
            "/require_once __DIR__ \\. '\\/helpers\\.php';\\s*only_method\\('GET'\\);/",
            $source
        );
        self::assertStringContainsString('session_write_close();', $source);
        $this->assertNoPersistentWrites($source);
    }

    public function testPrometheusMetricsEndpointIsGetOnlyAndUsesReadQueries(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/metrics.php');
        self::assertIsString($source);

        self::assertStringContainsString(
            "if ((\$_SERVER['REQUEST_METHOD'] ?? '') !== 'GET')",
            $source
        );
        self::assertStringContainsString("header('Allow: GET');", $source);
        self::assertStringContainsString("exit('Method Not Allowed');", $source);
        $this->assertNoPersistentWrites($source);
    }

    private function assertNoPersistentWrites(string $source): void
    {
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO\\s+[a-z_]+|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM\\s+[a-z_]+|REPLACE\\s+INTO\\s+[a-z_]+|CREATE\\s+TABLE|ALTER\\s+TABLE|DROP\\s+TABLE)\\b/i',
            $source
        );
        self::assertStringNotContainsString('file_put_contents(', $source);
        self::assertStringNotContainsString('unlink(', $source);
    }
}
