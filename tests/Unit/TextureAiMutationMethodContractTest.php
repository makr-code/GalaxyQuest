<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class TextureAiMutationMethodContractTest extends TestCase
{
    public function testTextureGenerationRequiresPostAndCsrfBeforeReadingJson(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        self::assertIsString($source);

        $guardStart = strpos($source, "if (in_array(\$action, \$generationActions, true))");
        $guardEnd = strpos($source, '// Check if AI texture generation is enabled', $guardStart);
        self::assertNotFalse($guardStart);
        self::assertNotFalse($guardEnd);
        $guard = substr($source, $guardStart, $guardEnd - $guardStart);

        $postGuardOffset = strpos($guard, "only_method('POST');");
        $csrfGuardOffset = strpos($guard, 'verify_csrf();');
        $bodyReadOffset = strpos($guard, 'get_json_body()');
        self::assertNotFalse($postGuardOffset);
        self::assertNotFalse($csrfGuardOffset);
        self::assertNotFalse($bodyReadOffset);
        self::assertLessThan($csrfGuardOffset, $postGuardOffset);
        self::assertLessThan($bodyReadOffset, $csrfGuardOffset);

        foreach ([
            'handle_spaceship_texture',
            'handle_planet_texture',
            'handle_atmosphere_texture',
            'handle_detail_texture',
            'handle_batch_pbr',
            'handle_progressive_loading',
        ] as $handler) {
            self::assertStringContainsString($handler . '($textureAiService, $requestData)', $source);
        }
    }

    public function testTextureMonitoringRemainsGetOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-ai.php');
        self::assertIsString($source);

        self::assertSame(
            1,
            preg_match('/else\s*\{\s*only_method\(\'GET\'\);\s*\$requestData = \[\];/', $source)
        );
        self::assertSame(1, preg_match('/case \'status\':\s*handle_status\(\$textureAiService\);/', $source));
        self::assertSame(1, preg_match('/case \'queue\':\s*handle_queue\(\$textureAiService\);/', $source));
        self::assertMatchesRegularExpression(
            '/function handle_status\(GQTextureAiService \$service\): void\s*\{.*?catch \(Throwable \$e\).*?status unavailable/s',
            $source
        );
        self::assertMatchesRegularExpression(
            '/function handle_queue\(GQTextureAiService \$service\): void\s*\{.*?catch \(Throwable \$e\).*?queue unavailable/s',
            $source
        );

        $constructorStart = strpos($source, 'public function __construct()');
        $generateStart = strpos($source, 'public function generateTexture(', $constructorStart);
        self::assertNotFalse($constructorStart);
        self::assertNotFalse($generateStart);
        $constructor = substr($source, $constructorStart, $generateStart - $constructorStart);
        self::assertStringNotContainsString('mkdir(', $constructor);

        $generationStart = strpos($source, 'public function generateTexture(');
        $slotMethodStart = strpos($source, 'private function ensureGenerationDirectories(', $generationStart);
        self::assertNotFalse($slotMethodStart);
        $generationMethod = substr($source, $generationStart, $slotMethodStart - $generationStart);
        self::assertStringContainsString('$this->ensureGenerationDirectories();', $generationMethod);
        self::assertStringContainsString('if ($this->cacheMode === \'disk\' && is_file($cachePath))', $generationMethod);
    }

    public function testAdminCacheMutationsRequirePostAndCsrfWhileReadsRemainGetOnly(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-admin.php');
        self::assertIsString($source);

        $readActionsOffset = strpos($source, '$readActions = [');
        self::assertNotFalse($readActionsOffset);
        self::assertStringContainsString("['list', 'cache_stats']", substr($source, $readActionsOffset, 80));

        $guardStart = strpos($source, 'if (in_array($action, $readActions, true))');
        $guardEnd = strpos($source, '$textureAdmin = new GQTextureAdminService();', $guardStart);
        self::assertNotFalse($guardStart);
        self::assertNotFalse($guardEnd);
        $guard = substr($source, $guardStart, $guardEnd - $guardStart);
        self::assertStringContainsString("only_method('GET');", $guard);
        self::assertStringContainsString("only_method('POST');", $guard);
        self::assertStringContainsString('verify_csrf();', $guard);
        self::assertLessThan(strpos($guard, 'verify_csrf();'), strpos($guard, "only_method('POST');"));
    }

    public function testAdminCacheListAndStatsOnlyReadFilesAndSurfaceScanFailures(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-admin.php');
        self::assertIsString($source);

        $listStart = strpos($source, 'public function getCachedTextures(');
        $regenerateStart = strpos($source, 'public function regenerateTexture(', $listStart);
        $statsStart = strpos($source, 'public function getCacheStats(');
        self::assertNotFalse($listStart);
        self::assertNotFalse($regenerateStart);
        self::assertNotFalse($statsStart);

        $listMethod = substr($source, $listStart, $regenerateStart - $listStart);
        $statsMethod = substr($source, $statsStart);
        foreach ([$listMethod, $statsMethod] as $readMethod) {
            self::assertDoesNotMatchRegularExpression(
                '/\\b(?:file_put_contents|unlink|rename|mkdir|rmdir|exec|shell_exec)\\s*\\(/i',
                $readMethod
            );
        }
        self::assertStringContainsString('if ($files === false)', $listMethod);
        self::assertStringContainsString('if ($stat === false)', $listMethod);
        self::assertStringContainsString('throw new RuntimeException', $listMethod);
        self::assertStringContainsString('$this->getCachedTextures()', $statsMethod);
    }

    public function testTextureAdminHandlersLogExceptionsWithoutReturningDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/textures-admin.php');
        self::assertIsString($source);

        foreach ([
            'handle_list_textures' => ['Texture admin list failed', 'Unable to list cached textures'],
            'handle_regenerate_texture' => ['Texture admin regeneration failed', 'Unable to regenerate texture'],
            'handle_test_prompt' => ['Texture admin prompt test failed', 'Unable to test texture prompt'],
            'handle_batch_regenerate' => ['Texture admin batch regeneration failed', 'Unable to regenerate texture batch'],
            'handle_clear_cache' => ['Texture admin cache clear failed', 'Unable to clear texture cache'],
            'handle_cache_stats' => ['Texture admin cache stats failed', 'Unable to read texture cache statistics'],
        ] as $handler => [$logMessage, $responseMessage]) {
            $body = $this->functionBody($source, $handler);
            self::assertStringContainsString("error_log('" . $logMessage . ": ' . \$e->getMessage());", $body, $handler);
            self::assertStringContainsString("'error' => '" . $responseMessage . "'", $body, $handler);
            self::assertStringNotContainsString("'error' => \$e->getMessage()", $body, $handler);
        }
    }

    private function functionBody(string $source, string $function): string
    {
        $start = strpos($source, 'function ' . $function . '(');
        self::assertNotFalse($start, $function . ' handler must exist.');
        $nextFunction = strpos($source, "\nfunction ", $start + 1);
        $end = $nextFunction === false ? strlen($source) : $nextFunction;
        return substr($source, $start, $end - $start);
    }

    public function testTextureClientsAndAdminUiSendSessionCsrfForGenerationWrites(): void
    {
        $textureManager = file_get_contents(__DIR__ . '/../../js/rendering/texture-manager.js');
        $adminUi = file_get_contents(__DIR__ . '/../../js/admin/texture-admin-ui.js');
        self::assertIsString($textureManager);
        self::assertIsString($adminUi);

        foreach ([$textureManager, $adminUi] as $client) {
            self::assertStringContainsString("method: 'POST'", $client);
            self::assertStringContainsString("'X-CSRF-Token':", $client);
            self::assertStringContainsString("credentials: 'same-origin'", $client);
            self::assertStringContainsString("auth.php?action=csrf", $client);
        }
        self::assertStringContainsString('high_res_request', $textureManager);
        self::assertStringNotContainsString('high_res_url', $textureManager);
    }
}
