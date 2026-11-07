<?php

declare(strict_types=1);

namespace GalaxyQuest\Tests\GameEngineTickFailurePropagation;

use PHPUnit\Framework\TestCase;

final class GameEngineTickFailurePropagationTest extends TestCase
{
    private string $source;

    protected function setUp(): void
    {
        $source = file_get_contents(__DIR__ . '/../../api/game_engine.php');
        self::assertIsString($source);
        $this->source = $source;
    }

    public function testDatabaseFailuresAreNotConvertedToMissingWarSchemaOrNoWarProgress(): void
    {
        $schemaProbe = $this->functionSource('has_war_runtime_schema');
        self::assertStringNotContainsString('catch (', $schemaProbe);
        self::assertStringNotContainsString('static $cached', $schemaProbe);

        $goalProgress = $this->functionSource('process_war_goal_progress');
        self::assertStringNotContainsString('catch (', $goalProgress);
        self::assertStringNotContainsString('process_war_goal_progress load wars error', $goalProgress);
    }

    public function testLegacyTicksRollbackAndRethrowFailures(): void
    {
        foreach ([
            'process_war_runtime_tick' => 'war_runtime_tick',
            'process_economy_pop_satisfaction_tick' => 'pop_satisfaction_tick',
            'process_economy_production_tick' => 'economy_production_tick',
        ] as $function => $savepoint) {
            $functionSource = $this->functionSource($function);
            self::assertStringContainsString(
                "game_engine_begin_tick_transaction(\$db, '{$savepoint}')",
                $functionSource,
                $function
            );
            self::assertStringContainsString(
                "game_engine_rollback_tick_transaction(\$db, '{$savepoint}', \$ownsTransaction)",
                $functionSource,
                $function
            );
            self::assertMatchesRegularExpression(
                '/catch \(Throwable \$error\)\s*\{\s*game_engine_rollback_tick_transaction\([^;]+;\s*throw \$error;/',
                $functionSource,
                $function
            );
        }
    }

    private function functionSource(string $name): string
    {
        $start = strpos($this->source, 'function ' . $name . '(');
        self::assertNotFalse($start, "Missing function {$name}.");

        $nextFunction = strpos($this->source, "\nfunction ", $start + 1);
        return substr($this->source, $start, $nextFunction === false ? null : $nextFunction - $start);
    }
}
