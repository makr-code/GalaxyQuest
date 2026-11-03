<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class RegistrationNarrationReadSideEffectsTest extends TestCase
{
    public function testNarrationGetOnlyServesValidCachedAudio(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/registration_narration.php');
        self::assertIsString($source);

        $getMissGuard = strpos($source, "if (!\$cached && \$method === 'GET')");
        $synthesisCall = strpos($source, '$result = tts_synthesise(');
        self::assertNotFalse($getMissGuard);
        self::assertNotFalse($synthesisCall);
        self::assertLessThan($synthesisCall, $getMissGuard);
        self::assertStringContainsString('filemtime($path)', $source);
    }

    public function testNarrationGenerationRequiresPostAndCsrf(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/registration_narration.php');
        $client = file_get_contents(__DIR__ . '/../../js/network/registration-prologue.js');
        self::assertIsString($source);
        self::assertIsString($client);

        self::assertStringContainsString("only_method('GET', 'POST')", $source);
        self::assertStringContainsString("if (\$method === 'POST')", $source);
        self::assertStringContainsString('verify_csrf();', $source);
        self::assertStringContainsString("method: 'POST'", $client);
        self::assertStringContainsString("'X-CSRF-Token': csrfData.token", $client);
    }
}
