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

    public function testWorldEventStreamOnlyIgnoresMissingOptionalMigrationTable(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/events.php');
        self::assertIsString($source);

        $start = strpos($source, '// ── Check for world events');
        $end = strpos($source, "\n    } catch (Throwable \$e)", $start);
        self::assertNotFalse($start);
        self::assertNotFalse($end);

        $worldEventRead = substr($source, $start, $end - $start);
        self::assertStringContainsString('catch (PDOException $error)', $worldEventRead);
        self::assertStringContainsString("if (\$error->getCode() !== '42S02')", $worldEventRead);
        self::assertStringContainsString('throw $error;', $worldEventRead);
        self::assertStringNotContainsString('catch (Throwable)', $worldEventRead);
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
        self::assertStringContainsString("error_log('TRELLIS2 metrics collection failed: ' . \$e->getMessage());", $source);
        self::assertStringContainsString("'# ERROR: Metrics collection unavailable'", $source);
        self::assertStringNotContainsString("'# ERROR: ' . str_replace", $source);
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
