<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class NpcChatIntegrationErrorContractTest extends TestCase
{
    public function testBackendFailuresAreLoggedWithoutExposingDetails(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_chat_integration.php');
        self::assertIsString($source);

        self::assertStringContainsString("error_log('NPC chat generation failed: ' . \$error);", $source);
        self::assertStringContainsString("json_error('NPC response service unavailable', 503);", $source);
        self::assertStringContainsString('error_log("NPC chat error: " . $e->getMessage());', $source);
        self::assertStringContainsString("json_error('NPC chat service unavailable', 503);", $source);
        self::assertStringNotContainsString("'error' => \$e->getMessage()", $source);
        self::assertStringNotContainsString("json_error(\$result['error']", $source);
    }

    public function testUnknownAgentRemainsAClientError(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_chat_integration.php');
        self::assertIsString($source);

        self::assertStringContainsString("str_starts_with(\$error, 'Unknown agent type:')", $source);
        self::assertStringContainsString("json_error('Unknown agent type', 400);", $source);
    }
}
