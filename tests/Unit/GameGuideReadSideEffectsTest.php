<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class GameGuideReadSideEffectsTest extends TestCase
{
    public function testGuideEndpointRequiresAuthAndSeparatesReadAndWriteMethods(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game_guide.php');
        self::assertIsString($source);

        $uidOffset = strpos($source, '$uid = require_auth();');
        $readActionsOffset = strpos($source, '$readActions = [');
        $databaseOffset = strpos($source, '$db = get_db();', $readActionsOffset);

        self::assertNotFalse($uidOffset);
        self::assertNotFalse($readActionsOffset);
        self::assertNotFalse($databaseOffset);
        self::assertLessThan($readActionsOffset, $uidOffset);

        $guard = substr($source, $readActionsOffset, $databaseOffset - $readActionsOffset);
        self::assertStringContainsString("['greeting', 'help_topic', 'get_progress']", $guard);
        self::assertStringContainsString("['assess_game_state', 'provide_help', 'record_checkpoint']", $guard);
        self::assertStringContainsString("only_method('GET');", $guard);
        self::assertStringContainsString("only_method('POST');", $guard);
        self::assertStringContainsString('verify_csrf();', $guard);
        self::assertSame(1, preg_match("/only_method\\('POST'\\);\\s*verify_csrf\\(\\);/", $guard));
        self::assertLessThan($databaseOffset, strpos($guard, 'verify_csrf();'));
    }

    public function testGreetingAndGuideConstructionDoNotPersistOrCreateDirectories(): void
    {
        $endpoint = file_get_contents(__DIR__ . '/../../api/game_guide.php');
        $guide = file_get_contents(__DIR__ . '/../../api/llm_soc/GameGuideNPC.php');
        self::assertIsString($endpoint);
        self::assertIsString($guide);

        $greetingStart = strpos($endpoint, "case 'greeting':");
        $greetingEnd = strpos($endpoint, "case 'assess_game_state':", $greetingStart);
        self::assertNotFalse($greetingStart);
        self::assertNotFalse($greetingEnd);
        self::assertStringNotContainsString('INSERT ', substr($endpoint, $greetingStart, $greetingEnd - $greetingStart));
        self::assertStringNotContainsString('mkdir(', substr($guide, 0, strpos($guide, 'private function loadConfig')));
    }
}
