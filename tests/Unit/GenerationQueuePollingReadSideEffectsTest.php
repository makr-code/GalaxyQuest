<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GenerationQueuePollingReadSideEffectsTest extends TestCase
{
    public function testV3StatusPollingIsGetOnlyAndOwnerScoped(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_status_v3.php');
        self::assertIsString($source);

        $methodOffset = strpos($source, "only_method('GET');");
        $authOffset = strpos($source, '$userId = require_auth();');
        self::assertNotFalse($methodOffset);
        self::assertNotFalse($authOffset);
        self::assertLessThan($authOffset, $methodOffset);
        self::assertStringContainsString('WHERE id = ? AND user_id = ?', $source);
        self::assertStringContainsString('$stmt->execute([(int)$queueId, $userId])', $source);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\s+(?:INTO\\s+)?generation_queue\\b/i',
            $source
        );
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_put_contents|unlink|rename|mkdir|sleep)\\s*\\(/',
            $source
        );
        self::assertStringContainsString("http_response_code(503);", $source);
        self::assertStringContainsString("'error' => 'Queue status unavailable'", $source);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $source);
    }

    public function testV2StatusUsesExplicitMethodGuardAndDoesNotExposeInfrastructureErrors(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_v2.php');
        self::assertIsString($source);

        self::assertStringContainsString("only_method('GET', 'POST');", $source);
        $statusStart = strpos($source, '// GET: Get job status');
        $invalidRequestStart = strpos($source, "json_error('Invalid request'", $statusStart);
        self::assertNotFalse($statusStart);
        self::assertNotFalse($invalidRequestStart);
        $statusHandler = substr($source, $statusStart, $invalidRequestStart - $statusStart);
        self::assertStringContainsString("only_method('GET');", $statusHandler);
        self::assertStringContainsString('WHERE id = ? AND user_id = ?', $statusHandler);
        self::assertStringContainsString("json_error('Queue service unavailable', 503);", $source);
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $source);
    }

    public function testV3SubmissionDoesNotExposeDatabaseOrThrowableDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_v3.php');
        self::assertIsString($source);

        self::assertStringContainsString('only_method(\'POST\');', $source);
        self::assertStringContainsString('verify_csrf();', $source);
        self::assertStringContainsString("error_log('Generation queue v3 insert failed:", $source);
        self::assertStringContainsString("error_log('Generation queue v3 submission error: ' . \$e->getMessage());", $source);
        self::assertStringContainsString("'error' => 'Queue service unavailable'", $source);
        self::assertStringNotContainsString("'db_error' =>", $source);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $source);
        self::assertStringNotContainsString("basename(\$e->getFile())", $source);
    }

    public function testQueueMonitorGetHandlersOnlyQueryQueueState(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_monitor.php');
        self::assertIsString($source);

        foreach (['listAllJobs', 'getStats', 'getFilteredJobs'] as $function) {
            $body = $this->functionBody($source, $function);
            self::assertMatchesRegularExpression('/\\bSELECT\\b/i', $body, $function);
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
                $body,
                $function
            );
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir|sleep)\\s*\\(/',
                $body,
                $function
            );
        }
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' function must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }
}
