<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\Unit;

use PHPUnit\Framework\TestCase;

final class NpcContextualTriggerReadErrorContractTest extends TestCase
{
    public function testTriggerReadersFallbackOnlyForMissingTables(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_quest_contextual_trigger.php');
        self::assertIsString($source);

        foreach ([
            'function npc_check_low_resources(',
            'function npc_check_standing_shift(',
            'function npc_check_colony_threat(',
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

        self::assertStringContainsString(
            'trade_routes has no persisted disruption state or event history',
            $source
        );
    }

    public function testTriggerDispatchAndQuestCreationPropagateDatabaseFailures(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/npc_quest_contextual_trigger.php');
        self::assertIsString($source);

        $checkStart = strpos($source, 'function npc_quest_contextual_trigger_check(');
        $checkEnd = strpos($source, "\n}", $checkStart);
        self::assertNotFalse($checkStart);
        self::assertNotFalse($checkEnd);
        self::assertStringNotContainsString(
            'catch (',
            substr($source, $checkStart, $checkEnd - $checkStart)
        );

        $createStart = strpos($source, 'function npc_quest_contextual_trigger_create(');
        $createEnd = strpos($source, "\n}", $createStart);
        self::assertNotFalse($createStart);
        self::assertNotFalse($createEnd);
        $create = substr($source, $createStart, $createEnd - $createStart);
        self::assertStringContainsString('npc_insert_generated_quest(', $create);
        self::assertStringContainsString("\$logResult['ok'] === false", $create);
        self::assertStringContainsString('npc_contextual_quest_rollback(', $create);
        self::assertStringNotContainsString('INSERT INTO trade_offers', $source);
        self::assertStringNotContainsString('threat_level > 0', $source);
    }
}
