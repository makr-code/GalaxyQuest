<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GenerationQueueV2ReadSideEffectsTest extends TestCase
{
    public function testStatusGetOnlyReadsTheAuthenticatedUsersJob(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_v2.php');
        self::assertIsString($source);

        $statusStart = strpos($source, "// GET: Get job status");
        $invalidRequestStart = strpos($source, "json_error('Invalid request'", $statusStart);
        self::assertNotFalse($statusStart);
        self::assertNotFalse($invalidRequestStart);

        $statusHandler = substr($source, $statusStart, $invalidRequestStart - $statusStart);
        self::assertStringContainsString("if (\$method === 'GET' && \$queueId)", $statusHandler);
        self::assertStringContainsString("only_method('GET')", $statusHandler);
        self::assertStringContainsString('$uid = require_auth()', $statusHandler);
        self::assertStringContainsString('WHERE id = ? AND user_id = ?', $statusHandler);
        self::assertStringContainsString("\$progress = \$status === 'completed' ? 100 : 0", $statusHandler);
        self::assertStringNotContainsString('UPDATE generation_queue', $statusHandler);
        self::assertStringNotContainsString('tryFindGeneratedGLB(', $statusHandler);
        self::assertStringContainsString("error_log(\"GenerationQueue v2 database error:", $source);
        self::assertStringContainsString("json_error('Queue service unavailable', 503);", $source);
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $source);
    }

    public function testJobCreationRequiresAuthenticationAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue_v2.php');
        self::assertIsString($source);

        $postStart = strpos($source, '// POST: Create new generation job');
        $statusStart = strpos($source, '// GET: Get job status', $postStart);
        self::assertNotFalse($postStart);
        self::assertNotFalse($statusStart);

        $postHandler = substr($source, $postStart, $statusStart - $postStart);
        self::assertStringContainsString('$uid = require_auth()', $postHandler);
        self::assertStringContainsString('verify_csrf()', $postHandler);
        self::assertStringNotContainsString('current_user_id() ?? 1', $postHandler);
    }

    public function testLegacyQueueRequiresAuthenticationAndCsrfAndScopesStatusByOwner(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/generation_queue.php');
        $client = file_get_contents(__DIR__ . '/../../js/ui/unified-designer.js');
        self::assertIsString($source);
        self::assertIsString($client);

        $dispatchStart = strpos($source, "if (basename(__FILE__) === basename");
        $statusStart = strpos($source, "if (\$method === 'GET' && \$queueId)", $dispatchStart);
        $invalidRequestStart = strpos($source, "json_error('Invalid request'", $statusStart);
        self::assertNotFalse($dispatchStart);
        self::assertNotFalse($statusStart);
        self::assertNotFalse($invalidRequestStart);

        $dispatch = substr($source, $dispatchStart);
        $postStart = strpos($dispatch, "if (\$method === 'POST' && !\$queueId)");
        self::assertNotFalse($postStart);
        $postHandler = substr($dispatch, $postStart, $statusStart - $dispatchStart - $postStart);
        self::assertStringContainsString('$uid = require_auth()', $postHandler);
        self::assertStringContainsString('verify_csrf()', $postHandler);
        self::assertStringNotContainsString('current_user_id() ?? 1', $postHandler);

        $statusHandler = substr($source, $statusStart, $invalidRequestStart - $statusStart);
        self::assertStringContainsString('$uid = require_auth()', $statusHandler);
        self::assertStringContainsString('WHERE q.id = ? AND q.user_id = ?', $statusHandler);
        self::assertStringNotContainsString('UPDATE generation_queue', $statusHandler);
        self::assertStringNotContainsString('tryFindGeneratedGLB(', $statusHandler);
        self::assertStringContainsString('error_log("GenerationQueue error: " . $e->getMessage());', $source);
        self::assertStringContainsString("json_error('Generation queue service unavailable', 503);", $source);
        self::assertStringNotContainsString('json_error($e->getMessage(), 500);', $source);
        self::assertStringNotContainsString("'Database error: ' . \$e->getMessage()", $source);
        self::assertStringContainsString("fetch('/api/auth.php?action=csrf'", $client);
        self::assertStringContainsString("'X-CSRF-Token': csrfData.token", $client);
    }

    public function testV3QueueRequiresCsrfToCreateJobsAndScopesStatusReadsToOwner(): void
    {
        $creation = file_get_contents(__DIR__ . '/../../api/generation_queue_v3.php');
        $status = file_get_contents(__DIR__ . '/../../api/generation_queue_status_v3.php');
        self::assertIsString($creation);
        self::assertIsString($status);

        self::assertStringContainsString("only_method('POST')", $creation);
        self::assertStringContainsString('verify_csrf();', $creation);
        self::assertLessThan(
            strpos($creation, '$payload = json_decode'),
            strpos($creation, 'verify_csrf();')
        );
        self::assertStringContainsString("only_method('GET')", $status);
        self::assertStringContainsString('$userId = require_auth()', $status);
        self::assertStringContainsString('WHERE id = ? AND user_id = ?', $status);
        self::assertStringContainsString('$stmt->execute([(int)$queueId, $userId])', $status);
        self::assertStringContainsString("http_response_code(503);", $status);
        self::assertStringContainsString("'error' => 'Queue status unavailable'", $status);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $status);
    }
}
