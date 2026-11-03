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
            'if ((int)$generation[\'user_id\'] !== $user_id)',
            $endpoint
        );
        self::assertStringNotContainsString('function getCurrentUserId(', $endpoint);
        self::assertStringContainsString('function getCurrentUserId(', $authHelpers);
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
}
