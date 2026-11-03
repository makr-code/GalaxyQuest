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
