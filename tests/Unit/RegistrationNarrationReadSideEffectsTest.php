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

    public function testNarrationReleasesSessionAfterReadingOwnerBeforeSynthesising(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/registration_narration.php');
        self::assertIsString($source);

        $ownerRead = strpos($source, "\$sessionOwner = \$_SESSION['registration_owner']");
        $release = strpos($source, 'session_write_close()');
        $synthesisCall = strpos($source, '$result = tts_synthesise(');
        self::assertNotFalse($ownerRead);
        self::assertNotFalse($release);
        self::assertNotFalse($synthesisCall);
        self::assertGreaterThan($ownerRead, $release);
        self::assertLessThan($synthesisCall, $release);
    }

    public function testCometNarrationUsesOnlyLocalizedAllowlistedClipsAndVoices(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/registration_narration.php');
        $config = file_get_contents(__DIR__ . '/../../config/onboarding_narration.json');
        self::assertIsString($source);
        self::assertIsString($config);

        $narration = json_decode($config, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame([
            'de_DE-kerstin-low' => 'de',
            'de_DE-thorsten-high' => 'de',
            'en_US-lessac-high' => 'en',
            'en_US-ryan-high' => 'en',
        ], $narration['voices']);
        self::assertStringContainsString("\$narration['clips'][\$id]", $source);
        self::assertStringContainsString("isset(\$narration['voices'][\$requestedVoice])", $source);

        foreach ($narration['opening'] as $slide) {
            foreach ($slide['cues'] as $cue) {
                self::assertArrayHasKey('de', $narration['clips'][$cue['id']]);
                self::assertArrayHasKey('en', $narration['clips'][$cue['id']]);
            }
        }
        foreach ($narration['stops'] as $stop) {
            self::assertCount(6, $stop['transit']);
            self::assertCount(2, $stop['arrival']);
            foreach (array_merge($stop['transit'], $stop['arrival']) as $cue) {
                self::assertArrayHasKey('de', $narration['clips'][$cue['id']]);
                self::assertArrayHasKey('en', $narration['clips'][$cue['id']]);
            }
        }
    }
}
