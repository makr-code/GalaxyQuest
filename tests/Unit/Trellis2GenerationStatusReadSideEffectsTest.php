<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class Trellis2GenerationStatusReadSideEffectsTest extends TestCase
{
    public function testStatusGetReadsJobStatusWithoutFinalizingOutput(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_generator.php');
        self::assertIsString($source);

        $statusStart = strpos($source, "case 'generation_status':");
        $finalizeStart = strpos($source, "case 'finalize_generation':", $statusStart);
        self::assertNotFalse($statusStart);
        self::assertNotFalse($finalizeStart);

        $statusHandler = substr($source, $statusStart, $finalizeStart - $statusStart);
        self::assertStringContainsString("only_method('GET')", $statusHandler);
        self::assertStringContainsString('$generator->getJobStatus($jobId)', $statusHandler);
        self::assertStringNotContainsString('$generator->finalizeJob(', $statusHandler);

        $readMethodStart = strpos($source, 'public function getJobStatus(');
        $finalizeMethodStart = strpos($source, 'public function finalizeJob(', $readMethodStart);
        self::assertNotFalse($readMethodStart);
        self::assertNotFalse($finalizeMethodStart);

        $readMethod = substr($source, $readMethodStart, $finalizeMethodStart - $readMethodStart);
        self::assertStringNotContainsString('file_put_contents(', $readMethod);
        self::assertStringNotContainsString('UPDATE trellis2_generation_queue', $readMethod);
        self::assertStringContainsString(
            '\'ready_to_finalize\' => $jobStatus === \'done\'',
            $readMethod
        );
    }

    public function testFinalizationIsPostAndCsrfProtected(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_generator.php');
        self::assertIsString($source);

        $finalizeStart = strpos($source, "case 'finalize_generation':");
        $nextActionStart = strpos($source, "case 'base_components':", $finalizeStart);
        self::assertNotFalse($finalizeStart);
        self::assertNotFalse($nextActionStart);

        $handler = substr($source, $finalizeStart, $nextActionStart - $finalizeStart);
        self::assertStringContainsString("only_method('POST')", $handler);
        self::assertStringContainsString('verify_csrf()', $handler);
        self::assertStringContainsString('$generator->finalizeJob($jobId)', $handler);
    }

    public function testAssetGenerationGetRoutesToAuthenticatedReadHandler(): void
    {
        $rewriteRules = file_get_contents(__DIR__ . '/../../.htaccess');
        $legacyEndpoint = file_get_contents(__DIR__ . '/../../api/asset_generations.php');
        $assetManager = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');
        $authHelpers = file_get_contents(__DIR__ . '/../../api/auth_helpers.php');

        self::assertIsString($rewriteRules);
        self::assertIsString($legacyEndpoint);
        self::assertIsString($assetManager);
        self::assertIsString($endpoint);
        self::assertIsString($authHelpers);
        self::assertStringContainsString(
            'RewriteRule ^api/asset_generations(/.*)?$ /api/trellis2_endpoints.php',
            $rewriteRules
        );
        self::assertStringNotContainsString('INSERT INTO asset_generations', $legacyEndpoint);
        self::assertStringContainsString('json_error(', $legacyEndpoint);
        self::assertStringContainsString(
            'id, user_id, generation_uuid, status, glb_path',
            $assetManager
        );
        self::assertStringContainsString(
            'generation_uuid, status, glb_path, glb_file_size',
            $assetManager
        );
        self::assertStringContainsString(
            'WHERE id = ? AND user_id = ? AND is_deleted = 0',
            $assetManager
        );
        self::assertStringContainsString(
            '$manager->getGenerationStatus($generation_id, $user_id)',
            $endpoint
        );
        self::assertStringNotContainsString(
            'if ((int)$generation[\'user_id\'] !== $user_id)',
            $endpoint
        );
        self::assertStringNotContainsString('function getCurrentUserId(', $endpoint);
        self::assertStringContainsString('function getCurrentUserId(', $authHelpers);
    }

    public function testApiKeyDatabaseErrorsAreNotReportedAsInvalidCredentials(): void
    {
        $authHelpers = file_get_contents(__DIR__ . '/../../api/auth_helpers.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');

        self::assertIsString($authHelpers);
        self::assertIsString($endpoint);
        self::assertStringContainsString(
            "throw new GQApiKeyVerificationException('API key verification unavailable', 0, \$e);",
            $authHelpers
        );
        self::assertStringNotContainsString('// Silently fail', $authHelpers);

        $verificationError = strpos($endpoint, 'catch (GQApiKeyVerificationException $e)');
        $unauthorized = strpos($endpoint, 'if (!$user_id)');
        self::assertNotFalse($verificationError);
        self::assertNotFalse($unauthorized);
        self::assertLessThan($unauthorized, $verificationError);
        self::assertStringContainsString("http_response_code(503);", substr($endpoint, $verificationError, $unauthorized - $verificationError));
        self::assertStringContainsString(
            "echo json_encode(['error' => 'Authentication service unavailable']);",
            substr($endpoint, $verificationError, $unauthorized - $verificationError)
        );
    }

    public function testAssetManagerConstructorDoesNotCreateStorageOnReadRequests(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        self::assertIsString($source);

        $constructorStart = strpos($source, 'public function __construct(');
        $createDesignStart = strpos($source, 'public function createDesign(', $constructorStart);
        self::assertNotFalse($constructorStart);
        self::assertNotFalse($createDesignStart);

        $constructor = substr($source, $constructorStart, $createDesignStart - $constructorStart);
        self::assertStringNotContainsString('mkdir(', $constructor);

        $createDesignEnd = strpos($source, 'public function getDesign(', $createDesignStart);
        self::assertNotFalse($createDesignEnd);
        $createDesign = substr($source, $createDesignStart, $createDesignEnd - $createDesignStart);
        self::assertStringContainsString('mkdir($designDirectory', $createDesign);
        self::assertStringContainsString('Failed to write vessel design file', $createDesign);
    }

    public function testQueueStatusReadIsOwnerScopedAndIncludesTerminalStatuses(): void
    {
        $assetManager = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');
        self::assertIsString($assetManager);
        self::assertIsString($endpoint);

        $readStart = strpos($assetManager, 'public function getQueueStatus(');
        $readEnd = strpos($assetManager, 'public function getGenerationStatus(', $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($readEnd);
        $readMethod = substr($assetManager, $readStart, $readEnd - $readStart);

        self::assertStringContainsString('int $queue_id, int $user_id', $readMethod);
        self::assertStringContainsString('WHERE queue.id = ? AND queue.user_id = ?', $readMethod);
        self::assertStringContainsString('$stmt->execute([$queue_id, $user_id])', $readMethod);
        self::assertStringContainsString(
            'queue.estimated_completion_ms, queue.generation_id, queue.error_message',
            $readMethod
        );
        self::assertStringNotContainsString('WHERE queue.id = ? AND queue.status IN', $readMethod);
        self::assertStringContainsString("WHEN queue.status = \\'queued\\'", $readMethod);
        self::assertStringContainsString(
            "active.status IN (\\'queued\\', \\'processing\\')",
            $readMethod
        );
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
            $readMethod
        );

        $handlerStart = strpos($endpoint, 'function handleGetQueueStatus(');
        $handlerEnd = strpos($endpoint, 'function handleGetGeneration(', $handlerStart);
        self::assertNotFalse($handlerStart);
        self::assertNotFalse($handlerEnd);
        $handler = substr($endpoint, $handlerStart, $handlerEnd - $handlerStart);
        self::assertStringContainsString('$manager->getQueueStatus($queue_id, $user_id)', $handler);
        self::assertStringContainsString("'generation_id' => \$status['generation_id'] ?? null", $handler);
        self::assertStringContainsString("'error_message' => \$status['error_message'] ?? null", $handler);
        self::assertStringContainsString("catch (PDOException \$e)", $handler);
        self::assertStringContainsString("http_response_code(503);", $handler);
        self::assertStringNotContainsString('$status[\'user_id\']', $handler);
    }

    public function testQuotaReadReturnsCompleteFieldsWithoutWritingAndHandlesZeroLimit(): void
    {
        $assetManager = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');
        self::assertIsString($assetManager);
        self::assertIsString($endpoint);

        $readStart = strpos($assetManager, 'public function getUserQuota(');
        $readEnd = strpos($assetManager, 'private function logAuditEvent(', $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($readEnd);
        $readMethod = substr($assetManager, $readStart, $readEnd - $readStart);

        foreach ([
            'storage_limit_gb',
            'storage_used_gb',
            'monthly_generation_limit',
            'monthly_generations_used',
            'priority_level',
            'design_count',
            'generation_count',
        ] as $field) {
            self::assertStringContainsString($field, $readMethod);
        }
        self::assertStringContainsString('LEFT JOIN user_asset_quotas AS quota', $readMethod);
        self::assertStringContainsString('throw new \\RuntimeException(\'Quota data unavailable\')', $readMethod);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
            $readMethod
        );

        $handlerStart = strpos($endpoint, 'function handleGetQuota(');
        self::assertNotFalse($handlerStart);
        $handler = substr($endpoint, $handlerStart);
        self::assertStringContainsString('$quota[\'monthly_generation_limit\']', $handler);
        self::assertStringContainsString('$storageLimit > 0', $handler);
        self::assertStringContainsString("http_response_code(503);", $handler);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $handler);
    }

    public function testDesignReadIsOwnerScopedBeforeAnyFilesystemAccess(): void
    {
        $assetManager = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');
        self::assertIsString($assetManager);
        self::assertIsString($endpoint);

        $readStart = strpos($assetManager, 'public function getDesign(');
        $readEnd = strpos($assetManager, 'public function queueGeneration(', $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($readEnd);
        $readMethod = substr($assetManager, $readStart, $readEnd - $readStart);

        self::assertStringContainsString('int $design_id, ?int $user_id = null', $readMethod);
        self::assertStringContainsString('$query .= \' AND user_id = ?\';', $readMethod);
        self::assertStringContainsString('$stmt->execute($params)', $readMethod);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:file_exists|file_get_contents|file_put_contents|unlink|rename)\\s*\\(/',
            $readMethod
        );

        $handlerStart = strpos($endpoint, 'function handleGetDesign(');
        $handlerEnd = strpos($endpoint, 'function handleQueueGeneration(', $handlerStart);
        self::assertNotFalse($handlerStart);
        self::assertNotFalse($handlerEnd);
        $handler = substr($endpoint, $handlerStart, $handlerEnd - $handlerStart);
        self::assertStringContainsString('$manager->getDesign($design_id, $user_id)', $handler);
        self::assertStringContainsString('catch (OutOfBoundsException $e)', $handler);
        self::assertStringContainsString('catch (PDOException $e)', $handler);
        self::assertStringContainsString('http_response_code(503);', $handler);
        self::assertStringNotContainsString("['user_id'] !==", $handler);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $handler);
    }

    public function testGenerationStatusReadIsOwnerScopedAndIncludesTerminalStatuses(): void
    {
        $assetManager = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        $endpoint = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');
        self::assertIsString($assetManager);
        self::assertIsString($endpoint);

        $readStart = strpos($assetManager, 'public function getGenerationStatus(');
        $readEnd = strpos($assetManager, 'public function registerGeneration(', $readStart);
        self::assertNotFalse($readStart);
        self::assertNotFalse($readEnd);
        $readMethod = substr($assetManager, $readStart, $readEnd - $readStart);

        self::assertStringContainsString('int $generation_id, int $user_id', $readMethod);
        self::assertStringContainsString(
            'WHERE id = ? AND user_id = ? AND is_deleted = 0',
            $readMethod
        );
        self::assertStringContainsString(
            '$stmt->execute([$generation_id, $user_id])',
            $readMethod
        );
        self::assertStringNotContainsString('status IN', $readMethod);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT|UPDATE|DELETE|REPLACE)\\b/i',
            $readMethod
        );

        $handlerStart = strpos($endpoint, 'function handleGetGeneration(');
        $handlerEnd = strpos($endpoint, 'function handleGetQuota(', $handlerStart);
        self::assertNotFalse($handlerStart);
        self::assertNotFalse($handlerEnd);
        $handler = substr($endpoint, $handlerStart, $handlerEnd - $handlerStart);
        self::assertStringContainsString(
            '$manager->getGenerationStatus($generation_id, $user_id)',
            $handler
        );
        self::assertStringContainsString('catch (PDOException $e)', $handler);
        self::assertStringContainsString('http_response_code(503);', $handler);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $handler);
    }

    public function testDesignListAndGenerationHistoryReadsAreOwnerScopedAndReadOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_asset_manager.php');
        self::assertIsString($source);

        $designsStart = strpos($source, 'public function getUserDesigns(');
        $deleteStart = strpos($source, 'public function deleteDesign(', $designsStart);
        self::assertNotFalse($designsStart);
        self::assertNotFalse($deleteStart);
        $designsMethod = substr($source, $designsStart, $deleteStart - $designsStart);
        self::assertStringContainsString('WHERE design.user_id = ? AND design.is_deleted = 0', $designsMethod);
        self::assertStringContainsString('generation.user_id = design.user_id', $designsMethod);
        self::assertStringContainsString('generation.is_deleted = 0', $designsMethod);
        self::assertStringContainsString('$limit = max(1, min(100, $limit))', $designsMethod);
        self::assertStringContainsString('$stmt->bindValue(2, $limit, \\PDO::PARAM_INT)', $designsMethod);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
            $designsMethod
        );

        $historyStart = strpos($source, 'public function getDesignGenerations(');
        self::assertNotFalse($historyStart);
        $historyMethod = substr($source, $historyStart);
        self::assertStringContainsString('int $design_id, int $user_id', $historyMethod);
        self::assertStringContainsString('design.user_id = generation.user_id', $historyMethod);
        self::assertStringContainsString('design.user_id = ?', $historyMethod);
        self::assertStringContainsString('generation.user_id = ?', $historyMethod);
        self::assertStringContainsString('$stmt->execute([$design_id, $user_id, $user_id])', $historyMethod);
        self::assertDoesNotMatchRegularExpression(
            '/\\b(?:INSERT\\s+INTO|UPDATE\\s+[a-z_]+\\s+SET|DELETE\\s+FROM|REPLACE\\s+INTO)\\b/i',
            $historyMethod
        );
    }

    public function testRestRoutesEnforceMethodsAndSessionCsrfBeforeMutations(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/trellis2_endpoints.php');
        self::assertIsString($source);

        foreach ([
            ["if (\$path === 'vessel_designs')", 'handleCreateDesign($manager, $user_id);'],
            [
                "elseif (preg_match('#^vessel_designs/(\\d+)/generate$#', \$path, \$m))",
                'handleQueueGeneration($manager, $user_id, (int)$m[1]);',
            ],
        ] as [$route, $dispatch]) {
            $start = strpos($source, $route);
            self::assertNotFalse($start, $route . ' route must exist.');
            $dispatchOffset = strpos($source, $dispatch, $start);
            self::assertNotFalse($dispatchOffset);
            $guard = substr($source, $start, $dispatchOffset - $start);
            self::assertStringContainsString("only_method('POST');", $guard);
            self::assertStringContainsString("if (isset(\$_SESSION['user_id']))", $guard);
            self::assertStringContainsString('verify_csrf();', $guard);
            self::assertLessThan(strpos($guard, 'verify_csrf();'), strpos($guard, "only_method('POST');"));
        }

        foreach ([
            ["elseif (preg_match('#^vessel_designs/", 'handleGetDesign($manager, $user_id,'],
            ["elseif (preg_match('#^generation_queue/", 'handleGetQueueStatus($manager, $user_id,'],
            ["elseif (preg_match('#^asset_generations/", 'handleGetGeneration($manager, $user_id,'],
            ["elseif (\$path === 'user/quota')", 'handleGetQuota($manager, $user_id);'],
        ] as [$route, $dispatch]) {
            $start = strpos($source, $route);
            self::assertNotFalse($start, $route . ' route must exist.');
            $methodGuard = strpos($source, "only_method('GET');", $start);
            $dispatchOffset = strpos($source, $dispatch, $start);
            self::assertNotFalse($methodGuard);
            self::assertNotFalse($dispatchOffset);
            self::assertLessThan($dispatchOffset, $methodGuard);
        }
        $exceptionHandlerStart = strpos($source, 'set_exception_handler(');
        $bootstrapStart = strpos($source, '// ─────────────────────────────────────────────────────────────────────────────', $exceptionHandlerStart);
        self::assertNotFalse($exceptionHandlerStart);
        self::assertNotFalse($bootstrapStart);
        $exceptionHandler = substr($source, $exceptionHandlerStart, $bootstrapStart - $exceptionHandlerStart);
        self::assertStringContainsString(
            "echo json_encode(['error' => 'Internal server error']);",
            $exceptionHandler
        );
        self::assertStringNotContainsString(
            "echo json_encode(['error' => \$e->getMessage()]);",
            $exceptionHandler
        );
    }
}
