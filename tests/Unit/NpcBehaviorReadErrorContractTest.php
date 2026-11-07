<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class NpcBehaviorReadErrorContractTest extends TestCase
{
    public function testBehaviorScriptAndContextReadersFallbackOnlyForMissingTables(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_behavior_script_executor.php');
        self::assertIsString($source);

        foreach ([
            'function npc_load_behavior_script(',
            'function npc_get_behavior_context(',
        ] as $functionName) {
            $start = strpos($source, $functionName);
            self::assertNotFalse($start);

            $end = strpos($source, "\n}", $start);
            self::assertNotFalse($end);

            $functionBody = substr($source, $start, $end - $start);
            self::assertStringContainsString('catch (PDOException $error)', $functionBody);
            self::assertStringContainsString("if (\$error->getCode() !== '42S02')", $functionBody);
            self::assertStringContainsString('throw $error;', $functionBody);
            self::assertStringNotContainsString('catch (Exception', $functionBody);
        }
    }
}
